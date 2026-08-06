// api/ponto.js
// API de Ponto Dinâmico — exceções manuais e liberação antecipada para intervalos.
// Com o livro de eventos ativo, as transições ordinárias são decididas pelo
// motor; as rotas abaixo registram somente confirmações e exceções auditadas.

import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';
import { registrarAuditoria } from './audit.js';
import { obterEmpresaIdDoContexto } from './contexto-empresa.js';
import {
    carregarContextoJornada,
    exigirTransicaoOrdinaria,
    dataLocalSaoPaulo,
    horaLocalSaoPaulo,
} from './jornada.js';
import {
    pontoEventosDisponivel,
    ORIGENS_PONTO,
    registrarEventoPonto,
    registrarEventoTarefa,
    TIPOS_EVENTO_PONTO,
    TIPOS_EVENTO_TAREFA,
} from './ponto-eventos.js';
import { confirmarSaidaIntervaloPendente } from './ponto-motor.js';

const router = express.Router();
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const SECRET_KEY = process.env.JWT_SECRET;

async function exigirVinculoAtivo(dbClient, usuarioId, empresaId) {
    const result = await dbClient.query(`
        SELECT 1
        FROM usuarios_empresas
        WHERE usuario_id = $1
          AND empresa_id = $2
          AND ativo = TRUE
    `, [usuarioId, empresaId]);
    if (result.rowCount === 0) {
        const error = new Error('Funcionário não encontrado na empresa ativa.');
        error.statusCode = 404;
        throw error;
    }
}

// Middleware de autenticação (padrão do projeto)
router.use(async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) throw new Error('Token não fornecido');
        req.usuarioLogado = jwt.verify(token, SECRET_KEY);
        req.empresaId = obterEmpresaIdDoContexto(req);
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token inválido ou expirado' });
    }
});

/**
 * POST /api/ponto/falta
 * Registra a falta explícita do empregado e cancela as sessões de produção
 * ainda em andamento. A projeção preserva os horários já existentes; o novo
 * motor de eventos será adicionado sem apagar esse histórico.
 */
router.post('/falta', async (req, res) => {
    const { funcionario_id, motivo } = req.body;
    const supervisor = req.usuarioLogado?.nome || 'Supervisor';

    if (!funcionario_id) {
        return res.status(400).json({ error: 'funcionario_id é obrigatório.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');
        const eventosPontoAtivos = await pontoEventosDisponivel(dbClient);
        await exigirVinculoAtivo(dbClient, funcionario_id, req.empresaId);

        const dataHojeSP = dataLocalSaoPaulo();
        const contexto = await carregarContextoJornada(
            dbClient,
            funcionario_id,
            req.empresaId,
            dataHojeSP
        );
        if (contexto.falta_ativa) {
            await dbClient.query('COMMIT');
            return res.status(200).json({ message: 'A falta já estava registrada hoje.', ja_registrada: true });
        }
        exigirTransicaoOrdinaria(contexto, 'o registro de falta');

        const sessoesCanceladas = await dbClient.query(
            `UPDATE sessoes_trabalho_producao
             SET status = 'CANCELADA', data_fim = COALESCE(data_fim, NOW())
             WHERE funcionario_id = $1
               AND empresa_id = $2
               AND status = 'EM_ANDAMENTO'
             RETURNING id`,
            [funcionario_id, req.empresaId]
        );

        // A tabela legada de arremates ainda não possui empresa_id. Só a
        // tocamos no contexto da empresa legada, que é o único contexto em que
        // a cadeia de arremates está habilitada.
        let sessoesArremateCanceladas = { rows: [] };
        if (req.empresaAtiva?.eh_legada === true) {
            sessoesArremateCanceladas = await dbClient.query(
                `UPDATE sessoes_trabalho_arremate
                 SET status = 'CANCELADA', data_fim = COALESCE(data_fim, NOW())
                 WHERE usuario_tiktik_id = $1
                   AND empresa_id = $2
                   AND status = 'EM_ANDAMENTO'
                 RETURNING id`,
                [funcionario_id, req.empresaId]
            );
        }

        await dbClient.query(
            `INSERT INTO ponto_diario
                (funcionario_id, data, tipo_excecao, motivo_excecao, registrado_por, empresa_id)
             VALUES ($1, $2, 'FALTA', $3, $4, $5)
             ON CONFLICT (empresa_id, funcionario_id, data) DO UPDATE SET
                 tipo_excecao = 'FALTA',
                 motivo_excecao = EXCLUDED.motivo_excecao,
                 registrado_por = EXCLUDED.registrado_por,
                 updated_at = NOW()`,
            [funcionario_id, dataHojeSP, motivo || null, supervisor, req.empresaId]
        );

        await dbClient.query(
            `UPDATE usuarios_empresas
             SET status_atual = 'FALTOU',
                 status_data_modificacao = (NOW() AT TIME ZONE 'America/Sao_Paulo'),
                 id_sessao_trabalho_atual = NULL,
                 atualizado_em = NOW()
             WHERE usuario_id = $1
               AND empresa_id = $2
               AND ativo`,
            [funcionario_id, req.empresaId]
        );

        if (eventosPontoAtivos) {
            const autorId = req.usuarioLogado?.id || null;
            const autorNome = req.usuarioLogado?.nome || supervisor;
            const compromissosCancelados = await dbClient.query(
                `UPDATE ponto_transicoes_pendentes
                    SET status = 'CANCELADA',
                        autor_resolucao_id = $1,
                        autor_resolucao_nome = $2,
                        motivo_resolucao = COALESCE($3, 'Falta registrada'),
                        atualizado_em = NOW()
                  WHERE empresa_id = $4
                    AND funcionario_id = $5
                    AND data_jornada = $6::date
                    AND status = 'PENDENTE'
                RETURNING id, tipo_intervalo, horario_saida_planejado, horario_retorno_planejado`,
                [
                    autorId,
                    autorNome,
                    motivo || 'Falta registrada',
                    req.empresaId,
                    funcionario_id,
                    dataHojeSP,
                ]
            );
            const sessoesProducaoIds = sessoesCanceladas.rows.map((row) => row.id);
            const sessoesArremateIds = sessoesArremateCanceladas.rows.map((row) => row.id);
            const compromissosIds = compromissosCancelados.rows.map((row) => row.id);

            await registrarEventoPonto(dbClient, {
                empresaId: req.empresaId,
                funcionarioId: funcionario_id,
                dataJornada: dataHojeSP,
                tipoEvento: TIPOS_EVENTO_PONTO.FALTA_REGISTRADA,
                idempotencyKey: `falta:${dataHojeSP}:${funcionario_id}`,
                origem: ORIGENS_PONTO.SUPERVISOR,
                autorId,
                autorNome,
                motivo: motivo || null,
                payload: {
                    sessoes_producao_canceladas: sessoesProducaoIds,
                    sessoes_arremate_canceladas: sessoesArremateIds,
                    transicoes_canceladas: compromissosIds,
                },
            });

            for (const transicao of compromissosCancelados.rows) {
                await registrarEventoPonto(dbClient, {
                    empresaId: req.empresaId,
                    funcionarioId: funcionario_id,
                    dataJornada: dataHojeSP,
                    tipoEvento: TIPOS_EVENTO_PONTO.COMPROMISSO_CANCELADO,
                    idempotencyKey: `falta:${dataHojeSP}:${funcionario_id}:transicao:${transicao.id}`,
                    origem: ORIGENS_PONTO.SUPERVISOR,
                    transicaoTipo: transicao.tipo_intervalo,
                    transicaoId: transicao.id,
                    horarioPlanejado: transicao.horario_saida_planejado,
                    autorId,
                    autorNome,
                    motivo: motivo || 'Falta registrada',
                    payload: {
                        causa: `falta:${dataHojeSP}:${funcionario_id}`,
                        horario_retorno_planejado: transicao.horario_retorno_planejado,
                    },
                });
            }

            for (const sessaoId of sessoesProducaoIds) {
                await registrarEventoPonto(dbClient, {
                    empresaId: req.empresaId,
                    funcionarioId: funcionario_id,
                    dataJornada: dataHojeSP,
                    tipoEvento: TIPOS_EVENTO_PONTO.COMPROMISSO_CANCELADO,
                    idempotencyKey: `falta:${dataHojeSP}:${funcionario_id}:sessao-producao:${sessaoId}`,
                    origem: ORIGENS_PONTO.SUPERVISOR,
                    autorId,
                    autorNome,
                    motivo: motivo || 'Falta registrada',
                    payload: {
                        causa: `falta:${dataHojeSP}:${funcionario_id}`,
                        tipo_compromisso: 'SESSAO_PRODUCAO',
                        sessao_id: sessaoId,
                    },
                });
                await registrarEventoTarefa(dbClient, {
                    empresaId: req.empresaId,
                    funcionarioId: funcionario_id,
                    dataJornada: dataHojeSP,
                    tipoEvento: TIPOS_EVENTO_TAREFA.CANCELADA,
                    tarefaTipo: 'PRODUCAO',
                    tarefaId: sessaoId,
                    idempotencyKey: `tarefa:PRODUCAO:${sessaoId}:cancelada:falta:${dataHojeSP}`,
                    origem: ORIGENS_PONTO.SUPERVISOR,
                    autorId,
                    autorNome,
                    motivo: motivo || 'Falta registrada',
                    payload: {
                        causa: `falta:${dataHojeSP}:${funcionario_id}`,
                        sessao_id: sessaoId,
                    },
                });
            }

            for (const sessaoId of sessoesArremateIds) {
                await registrarEventoTarefa(dbClient, {
                    empresaId: req.empresaId,
                    funcionarioId: funcionario_id,
                    dataJornada: dataHojeSP,
                    tipoEvento: TIPOS_EVENTO_TAREFA.CANCELADA,
                    tarefaTipo: 'ARREMATE',
                    tarefaId: sessaoId,
                    idempotencyKey: `tarefa:ARREMATE:${sessaoId}:cancelada:falta:${dataHojeSP}`,
                    origem: ORIGENS_PONTO.SUPERVISOR,
                    autorId,
                    autorNome,
                    motivo: motivo || 'Falta registrada',
                    payload: {
                        causa: `falta:${dataHojeSP}:${funcionario_id}`,
                        sessao_id: sessaoId,
                    },
                });
            }
        }

        await dbClient.query('COMMIT');

        const sessoesCanceladasIds = [
            ...sessoesCanceladas.rows.map(row => row.id),
            ...sessoesArremateCanceladas.rows.map(row => row.id),
        ];

        registrarAuditoria(null, req.usuarioLogado, 'ponto.falta_registrada', 'funcionario', funcionario_id, {
            data_jornada: dataHojeSP,
            motivo: motivo || null,
            sessoes_canceladas: sessoesCanceladasIds,
        });

        res.status(200).json({
            message: 'Falta registrada e compromissos ativos cancelados.',
            sessoes_canceladas: sessoesCanceladasIds,
        });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /ponto/falta] Erro:', error);
        res.status(error.statusCode || 500).json({ error: error.message, codigo: error.codigo });
    } finally {
        if (dbClient) dbClient.release();
    }
});

/**
 * POST /api/ponto/excecao
 * Registra uma exceção manual: chegada atrasada ou saída antecipada.
 *
 * Body: {
 *   funcionario_id: number,
 *   tipo_excecao: 'ATRASO' | 'SAIDA_ANTECIPADA',
 *   horario: 'HH:MM',   // para ATRASO = hora real de chegada; para SAIDA_ANTECIPADA = hora atual (enviada pelo frontend)
 *   motivo: string       // texto livre do supervisor (obrigatório)
 * }
 */
router.post('/excecao', async (req, res) => {
    const { funcionario_id, tipo_excecao, horario, motivo } = req.body;
    const supervisor = req.usuarioLogado?.nome || 'Supervisor';

    if (!funcionario_id || !tipo_excecao) {
        return res.status(400).json({ error: 'Campos obrigatórios: funcionario_id, tipo_excecao.' });
    }
    if (!['ATRASO', 'SAIDA_ANTECIPADA'].includes(tipo_excecao)) {
        return res.status(400).json({ error: 'tipo_excecao deve ser ATRASO ou SAIDA_ANTECIPADA.' });
    }
    if (!String(motivo || '').trim()) {
        return res.status(400).json({ error: 'O motivo é obrigatório para registrar uma exceção.' });
    }
    if (tipo_excecao === 'ATRASO' && !horario) {
        return res.status(400).json({ error: 'Para ATRASO, o campo horario é obrigatório.' });
    }

    // BUG-13: para SAIDA_ANTECIPADA usar sempre o relógio do servidor (tablet pode estar dessincronizado).
    // Para ATRASO: usar o horário informado pelo supervisor (é dado manual intencional).
    const horarioFinal = tipo_excecao === 'SAIDA_ANTECIPADA'
        ? new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
        : horario;

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');
        await exigirVinculoAtivo(dbClient, funcionario_id, req.empresaId);

        const dataHojeSP = dataLocalSaoPaulo();
        const contexto = await carregarContextoJornada(
            dbClient,
            funcionario_id,
            req.empresaId,
            dataHojeSP
        );
        exigirTransicaoOrdinaria(contexto, `a exceção ${tipo_excecao}`);
        const campoHorario = tipo_excecao === 'ATRASO' ? 'horario_real_e1' : 'horario_real_s3';

        await dbClient.query(
            `INSERT INTO ponto_diario
                (funcionario_id, data, ${campoHorario}, tipo_excecao,
                 motivo_excecao, registrado_por, empresa_id)
             SELECT $1, $2, $3, $4, $5, $6, $7
             FROM usuarios_empresas
             WHERE usuario_id = $1
               AND empresa_id = $7
               AND ativo
             ON CONFLICT (empresa_id, funcionario_id, data) DO UPDATE SET
                 ${campoHorario}    = EXCLUDED.${campoHorario},
                 tipo_excecao      = EXCLUDED.tipo_excecao,
                 motivo_excecao    = EXCLUDED.motivo_excecao,
                 registrado_por    = EXCLUDED.registrado_por,
                 updated_at        = NOW()`,
            [
                funcionario_id,
                dataHojeSP,
                horarioFinal,
                tipo_excecao,
                motivo || null,
                supervisor,
                req.empresaId,
            ]
        );

        // Saída antecipada: força status FORA_DO_HORARIO e cancela sessão ativa
        let sessoesCanceladas = { rows: [] };
        if (tipo_excecao === 'SAIDA_ANTECIPADA') {
            await dbClient.query(
                `UPDATE usuarios_empresas
                 SET status_atual = 'FORA_DO_HORARIO',
                     status_data_modificacao = (NOW() AT TIME ZONE 'America/Sao_Paulo'),
                     id_sessao_trabalho_atual = NULL
                 WHERE usuario_id = $1
                   AND empresa_id = $2
                   AND ativo`,
                [funcionario_id, req.empresaId]
            );
            sessoesCanceladas = await dbClient.query(
                `UPDATE sessoes_trabalho_producao
                 SET status = 'CANCELADA', data_fim = NOW()
                 WHERE funcionario_id = $1
                   AND empresa_id = $2
                   AND status = 'EM_ANDAMENTO'
                 RETURNING id`,
                [funcionario_id, req.empresaId]
            );
        }

        if (await pontoEventosDisponivel(dbClient)) {
            const autorId = req.usuarioLogado?.id || null;
            const autorNome = req.usuarioLogado?.nome || supervisor;
            await registrarEventoPonto(dbClient, {
                empresaId: req.empresaId,
                funcionarioId: funcionario_id,
                dataJornada: dataHojeSP,
                tipoEvento: TIPOS_EVENTO_PONTO.EXCECAO_MANUAL,
                idempotencyKey: `excecao:${dataHojeSP}:${funcionario_id}:${tipo_excecao}`,
                origem: ORIGENS_PONTO.SUPERVISOR,
                horarioPlanejado: tipo_excecao === 'ATRASO'
                    ? contexto.horario_entrada_1
                    : contexto.horario_saida_1,
                horarioEfetivo: horarioFinal,
                autorId,
                autorNome,
                motivo: motivo || null,
                payload: {
                    tipo_excecao,
                    campo_horario: campoHorario,
                    horario_informado: horario,
                    sessoes_canceladas: sessoesCanceladas.rows.map((row) => row.id),
                },
            });

            for (const sessao of sessoesCanceladas.rows) {
                await registrarEventoTarefa(dbClient, {
                    empresaId: req.empresaId,
                    funcionarioId: funcionario_id,
                    dataJornada: dataHojeSP,
                    tipoEvento: TIPOS_EVENTO_TAREFA.CANCELADA,
                    tarefaTipo: 'PRODUCAO',
                    tarefaId: sessao.id,
                    idempotencyKey: `tarefa:PRODUCAO:${sessao.id}:cancelada:excecao:${dataHojeSP}`,
                    origem: ORIGENS_PONTO.SUPERVISOR,
                    autorId,
                    autorNome,
                    motivo: motivo || 'Saída antecipada registrada',
                    payload: {
                        causa: `excecao:${dataHojeSP}:${funcionario_id}:SAIDA_ANTECIPADA`,
                        tipo_excecao,
                    },
                });
            }
        }

        await dbClient.query('COMMIT');
        res.status(200).json({ message: `Exceção '${tipo_excecao}' registrada.` });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /ponto/excecao] Erro:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

/**
 * POST /api/ponto/liberar-intervalo
 * Supervisor libera um funcionário para almoço ou pausa antes do horário agendado.
 * Registra o horário real de saída e calcula o retorno dinâmico.
 *
 * Body: { funcionario_id: number, tipo: 'ALMOCO' | 'PAUSA' }
 */
router.post('/liberar-intervalo', async (req, res) => {
    const { funcionario_id, tipo } = req.body;
    const supervisor = req.usuarioLogado?.nome || 'Supervisor';

    if (!funcionario_id || !['ALMOCO', 'PAUSA'].includes(tipo)) {
        return res.status(400).json({ error: 'Campos obrigatórios: funcionario_id, tipo (ALMOCO|PAUSA).' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        if (await pontoEventosDisponivel(dbClient)) {
            const agora = new Date();
            const dataHojeSP = dataLocalSaoPaulo(agora);
            const confirmacao = await confirmarSaidaIntervaloPendente(dbClient, {
                empresaId: req.empresaId,
                funcionarioId: funcionario_id,
                dataJornada: dataHojeSP,
                tipoIntervalo: tipo,
                agora,
                autorId: req.usuarioLogado?.id || null,
                autorNome: supervisor,
            });
            await dbClient.query('COMMIT');
            return res.status(200).json({
                message: `Saída para ${tipo} confirmada pelo motor de jornada.`,
                retorno_previsto: String(confirmacao.horario_retorno_planejado).substring(0, 5),
                motor: 'ponto-eventos-v1',
                ja_resolvida: confirmacao.ja_resolvida || false,
            });
        }

        const agora = new Date();
        const horaAtualSP = horaLocalSaoPaulo(agora);
        const dataHojeSP = dataLocalSaoPaulo(agora);
        const contexto = await carregarContextoJornada(
            dbClient,
            funcionario_id,
            req.empresaId,
            dataHojeSP
        );
        exigirTransicaoOrdinaria(contexto, `a saída para ${tipo}`);

        // Busca horários e verifica se está PRODUZINDO (tem sessão ativa).
        // v1.8: se PRODUZINDO, só grava ponto_diario — não toca status nem sessão.
        const horarios = contexto;
        const isProduzindo = !!contexto.id_sessao_trabalho_atual;
        const n = (t) => t ? String(t).substring(0, 5) : null;

        let campoSaida, campoRetorno, horarioRetorno, novoStatus;

        if (tipo === 'ALMOCO') {
            campoSaida   = 'horario_real_s1';
            campoRetorno = 'horario_real_e2';
            // Duração do almoço: E2 - S1 do cadastro. Default: 60 min.
            const s1 = n(horarios.horario_saida_1);
            const e2 = n(horarios.horario_entrada_2);
            let duracaoAlmocoMin = 60;
            if (s1 && e2) {
                const [s1h, s1m] = s1.split(':').map(Number);
                const [e2h, e2m] = e2.split(':').map(Number);
                const delta = (e2h * 60 + e2m) - (s1h * 60 + s1m);
                if (delta > 0) duracaoAlmocoMin = delta;
            }
            const [h, m] = horaAtualSP.split(':').map(Number);
            const total = h * 60 + m + duracaoAlmocoMin;
            horarioRetorno = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
            novoStatus = 'ALMOCO';
        } else { // PAUSA
            campoSaida   = 'horario_real_s2';
            campoRetorno = 'horario_real_e3';
            // Duração da pausa calculada do cadastro: E3 - S2. Default: 15 min.
            let duracaoMin = 15;
            const s2 = n(horarios.horario_saida_2);
            const e3 = n(horarios.horario_entrada_3);
            if (s2 && e3) {
                const [s2h, s2m] = s2.split(':').map(Number);
                const [e3h, e3m] = e3.split(':').map(Number);
                const delta = (e3h * 60 + e3m) - (s2h * 60 + s2m);
                if (delta > 0) duracaoMin = delta;
            }
            const [h, m] = horaAtualSP.split(':').map(Number);
            const total = h * 60 + m + duracaoMin;
            horarioRetorno = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
            novoStatus = 'PAUSA';
        }

        // COALESCE: se o cron server-side já gravou o horário agendado, não sobrescreve.
        // Isso garante que o timer automático do frontend (60s) não corrija retroativamente
        // um horário já correto gravado pelo cron enquanto a tela estava fechada.
        // Ação manual do supervisor (botão "Liberar") chega sempre ANTES de S1/S2,
        // portanto neste momento o campo ainda é NULL — o COALESCE não interfere.
        await dbClient.query(
            `INSERT INTO ponto_diario
                (funcionario_id, data, ${campoSaida}, ${campoRetorno},
                 registrado_por, empresa_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (empresa_id, funcionario_id, data) DO UPDATE SET
                 ${campoSaida}   = COALESCE(ponto_diario.${campoSaida},   EXCLUDED.${campoSaida}),
                 ${campoRetorno} = COALESCE(ponto_diario.${campoRetorno}, EXCLUDED.${campoRetorno}),
                 registrado_por  = COALESCE(ponto_diario.registrado_por,  EXCLUDED.registrado_por),
                 updated_at      = NOW()`,
            [
                funcionario_id,
                dataHojeSP,
                horaAtualSP,
                horarioRetorno,
                supervisor,
                req.empresaId,
            ]
        );

        // v1.8: se PRODUZINDO, não altera status nem sessão.
        // O frontend congela o timer via calcularTempoEfetivo ao detectar o ponto_diario.
        // Se LIVRE, atualiza status para ALMOCO/PAUSA normalmente.
        if (!isProduzindo) {
            await dbClient.query(
                `UPDATE usuarios_empresas
                 SET status_atual = $1,
                     status_data_modificacao = (NOW() AT TIME ZONE 'America/Sao_Paulo'),
                     id_sessao_trabalho_atual = NULL
                 WHERE usuario_id = $2
                   AND empresa_id = $3
                   AND ativo`,
                [novoStatus, funcionario_id, req.empresaId]
            );
        }

        await dbClient.query('COMMIT');

        // Auditoria: calcula desvio em relação ao horário programado
        const horarioProgramado = tipo === 'ALMOCO' ? n(horarios.horario_saida_1) : n(horarios.horario_saida_2);
        let desvioMin = null;
        if (horarioProgramado) {
            const [ph, pm] = horarioProgramado.split(':').map(Number);
            const [ah2, am2] = horaAtualSP.split(':').map(Number);
            desvioMin = (ah2 * 60 + am2) - (ph * 60 + pm); // negativo = antecipado
        }

        // Busca o nome do funcionário para o log
        const funcNomeRes = await dbClient.query('SELECT nome FROM usuarios WHERE id = $1', [funcionario_id]).catch(() => ({ rows: [] }));
        const funcNome = funcNomeRes.rows[0]?.nome || `ID ${funcionario_id}`;

        registrarAuditoria(null, req.usuarioLogado, 'ponto.intervalo_liberado', 'funcionario', funcionario_id, {
            funcionario_nome: funcNome,
            tipo_intervalo: tipo,
            horario_programado: horarioProgramado,
            horario_real: horaAtualSP,
            retorno_previsto: horarioRetorno,
            desvio_min: desvioMin,
            status: desvioMin === null ? 'sem_horario' : desvioMin < 0 ? 'antecipado' : desvioMin === 0 ? 'no_horario' : 'apos_horario',
            era_produzindo: isProduzindo,
        });

        res.status(200).json({
            message: `Funcionário liberado para ${tipo}.`,
            retorno_previsto: horarioRetorno,
            era_produzindo: isProduzindo,
        });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /ponto/liberar-intervalo] Erro:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

/**
 * POST /api/ponto/desfazer-saida
 * Desfaz uma saída antecipada lançada por engano.
 * Preserva o horario_real_s3 original para auditoria — apenas marca saida_desfeita = true.
 *
 * Body: { funcionario_id: number, motivo: string (opcional) }
 */
router.post('/desfazer-saida', async (req, res) => {
    const { funcionario_id, motivo } = req.body;
    const supervisor = req.usuarioLogado?.nome || 'Supervisor';

    if (!funcionario_id) {
        return res.status(400).json({ error: 'funcionario_id obrigatório.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');
        await exigirVinculoAtivo(dbClient, funcionario_id, req.empresaId);

        const dataHojeSP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

        // Verifica se existe saída antecipada hoje (não desfeita)
        const pontoRes = await dbClient.query(
            `SELECT id, horario_real_s3, tipo_excecao FROM ponto_diario
             WHERE funcionario_id = $1
               AND data = $2
               AND empresa_id = $3
               AND tipo_excecao = 'SAIDA_ANTECIPADA'
               AND horario_real_s3 IS NOT NULL
               AND (saida_desfeita IS NULL OR saida_desfeita = FALSE)`,
            [funcionario_id, dataHojeSP, req.empresaId]
        );

        if (!pontoRes.rows.length) {
            const error = new Error('Nenhuma saída antecipada ativa registrada hoje para este funcionário.');
            error.statusCode = 400;
            throw error;
        }

        // Marca como desfeita — NÃO remove horario_real_s3 (preservar para auditoria)
        await dbClient.query(
            `UPDATE ponto_diario SET
                saida_desfeita     = TRUE,
                saida_desfeita_em  = NOW(),
                saida_desfeita_por = $1,
                updated_at         = NOW()
             WHERE funcionario_id = $2
               AND data = $3
               AND empresa_id = $4`,
            [
                supervisor + (motivo ? ` — ${motivo}` : ''),
                funcionario_id,
                dataHojeSP,
                req.empresaId,
            ]
        );

        // Volta status do funcionário para LIVRE
        const result = await dbClient.query(
            `UPDATE usuarios_empresas
             SET status_atual = 'LIVRE',
                 status_data_modificacao = (NOW() AT TIME ZONE 'America/Sao_Paulo')
             WHERE usuario_id = $1
               AND empresa_id = $2
               AND ativo`,
            [funcionario_id, req.empresaId]
        );

        if (await pontoEventosDisponivel(dbClient)) {
            await registrarEventoPonto(dbClient, {
                empresaId: req.empresaId,
                funcionarioId: funcionario_id,
                dataJornada: dataHojeSP,
                tipoEvento: TIPOS_EVENTO_PONTO.CORRECAO_MANUAL,
                idempotencyKey: `correcao:${dataHojeSP}:${funcionario_id}:saida-antecipada`,
                origem: ORIGENS_PONTO.SUPERVISOR,
                autorId: req.usuarioLogado?.id || null,
                autorNome: req.usuarioLogado?.nome || supervisor,
                motivo: motivo || 'Saída antecipada desfeita',
                payload: {
                    acao: 'DESFAZER_SAIDA_ANTECIPADA',
                    horario_anterior: pontoRes.rows[0].horario_real_s3,
                },
            });
        }

        await dbClient.query('COMMIT');
        res.status(200).json({ message: `Saída antecipada desfeita para funcionário ${funcionario_id}.` });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /ponto/desfazer-saida] Erro:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

/**
 * POST /api/ponto/desfazer-liberacao
 * Desfaz a liberação manual de um funcionário que estava em ALMOCO ou PAUSA.
 * Resets status para 'LIVRE' (neutro) → determinarStatusFinalServidor recalcula
 * e retorna ALMOCO/PAUSA automaticamente se ainda estivermos na janela do intervalo.
 *
 * Body: { funcionario_id: number }
 */
router.post('/desfazer-liberacao', async (req, res) => {
    const { funcionario_id } = req.body;
    if (!funcionario_id) {
        return res.status(400).json({ error: 'funcionario_id obrigatório.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await exigirVinculoAtivo(dbClient, funcionario_id, req.empresaId);
        // Reseta status para 'LIVRE' (sem LIVRE_MANUAL com data).
        // O cálculo automático em determinarStatusFinalServidor usará o ponto_diario
        // para detectar que ainda estamos na janela de almoço/pausa → retorna ALMOCO/PAUSA.
        const result = await dbClient.query(
            `UPDATE usuarios_empresas
             SET status_atual = 'LIVRE',
                 status_data_modificacao = (NOW() AT TIME ZONE 'America/Sao_Paulo')
             WHERE usuario_id = $1
               AND empresa_id = $2
               AND ativo`,
            [funcionario_id, req.empresaId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({
                error: 'Funcionário não encontrado na empresa ativa.',
            });
        }
        res.status(200).json({ message: 'Liberação desfeita — intervalo restaurado.' });
    } catch (error) {
        console.error('[API POST /ponto/desfazer-liberacao] Erro:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

/**
 * POST /api/ponto/retomar-trabalho
 * Supervisor libera antecipadamente o contador de um funcionário PRODUZINDO que está
 * com o cronômetro congelado por almoço/pausa detectado (cronoPausadoAuto = true).
 * Registra o horário real de retorno no ponto_diario → calcularTempoEfetivo detecta
 * agora >= e2/e3 e descongela o contador automaticamente na próxima atualização.
 *
 * NÃO altera status nem sessão — o funcionário continua PRODUZINDO normalmente.
 *
 * Body: { funcionario_id: number, tipo: 'ALMOCO' | 'PAUSA' }
 */
router.post('/retomar-trabalho', async (req, res) => {
    const { funcionario_id, tipo, motivo } = req.body;

    if (!funcionario_id || !['ALMOCO', 'PAUSA'].includes(tipo)) {
        return res.status(400).json({ error: 'Campos obrigatórios: funcionario_id, tipo (ALMOCO|PAUSA).' });
    }
    if (!String(motivo || '').trim()) {
        return res.status(400).json({ error: 'O motivo é obrigatório para registrar um retorno excepcional.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const agora = new Date();
        const horaAtualSP = horaLocalSaoPaulo(agora);
        const dataHojeSP = dataLocalSaoPaulo(agora);
        const contexto = await carregarContextoJornada(
            dbClient,
            funcionario_id,
            req.empresaId,
            dataHojeSP
        );
        exigirTransicaoOrdinaria(contexto, `o retorno antecipado de ${tipo}`);
        const campoRetorno = tipo === 'ALMOCO' ? 'horario_real_e2' : 'horario_real_e3';
        const campoRetornoPrevisto = tipo === 'ALMOCO' ? 'horario_real_e2' : 'horario_real_e3';

        // Busca retorno previsto (e2/e3 já gravado) e horário agendado para calcular desvio
        const dadosRes = await dbClient.query(
            `SELECT u.nome, ue.horario_entrada_2, ue.horario_entrada_3,
                    p.${campoRetornoPrevisto} AS retorno_previsto_db
             FROM usuarios u
             JOIN usuarios_empresas ue
               ON ue.usuario_id = u.id
              AND ue.empresa_id = $3
              AND ue.ativo
             LEFT JOIN ponto_diario p
               ON p.funcionario_id = u.id
              AND p.data = $2
              AND p.empresa_id = ue.empresa_id
             WHERE u.id = $1`,
            [funcionario_id, dataHojeSP, req.empresaId]
        );
        if (dadosRes.rows.length === 0) {
            const error = new Error('Funcionário não encontrado na empresa ativa.');
            error.statusCode = 404;
            throw error;
        }
        const dados = dadosRes.rows[0];
        const funcNome = dados.nome || `ID ${funcionario_id}`;

        // Atualiza o campo de retorno para "agora" → frontend descongela o contador
        const pontoAtualizado = await dbClient.query(
            `UPDATE ponto_diario
             SET ${campoRetorno} = $1, updated_at = NOW()
             WHERE funcionario_id = $2
               AND data = $3
               AND empresa_id = $4`,
            [horaAtualSP, funcionario_id, dataHojeSP, req.empresaId]
        );
        if (pontoAtualizado.rowCount === 0) {
            throw new Error('Nenhum registro de ponto do dia foi encontrado para registrar o retorno.');
        }

        // Auditoria: calcula desvio em relação ao retorno previsto (e2/e3 programado no cadastro)
        const horarioPrevisto = dados.retorno_previsto_db
            || (tipo === 'ALMOCO' ? (dados.horario_entrada_2 ? String(dados.horario_entrada_2).substring(0, 5) : null)
                                  : (dados.horario_entrada_3 ? String(dados.horario_entrada_3).substring(0, 5) : null));
        let desvioMin = null;
        if (horarioPrevisto) {
            const [ph, pm] = String(horarioPrevisto).substring(0, 5).split(':').map(Number);
            const [ah, am] = horaAtualSP.split(':').map(Number);
            desvioMin = (ah * 60 + am) - (ph * 60 + pm); // positivo = atrasado
        }

        if (await pontoEventosDisponivel(dbClient)) {
            await registrarEventoPonto(dbClient, {
                empresaId: req.empresaId,
                funcionarioId: funcionario_id,
                dataJornada: dataHojeSP,
                tipoEvento: TIPOS_EVENTO_PONTO.RETORNO_MANUAL,
                idempotencyKey: `retorno-manual:${dataHojeSP}:${funcionario_id}:${tipo}`,
                origem: ORIGENS_PONTO.SUPERVISOR,
                transicaoTipo: tipo,
                horarioPlanejado: horarioPrevisto,
                horarioEfetivo: horaAtualSP,
                autorId: req.usuarioLogado?.id || null,
                autorNome: req.usuarioLogado?.nome || 'Supervisor',
                motivo,
                payload: {
                    tipo_intervalo: tipo,
                    retorno_previsto: horarioPrevisto,
                    retorno_real: horaAtualSP,
                    desvio_min: desvioMin,
                },
            });
        }

        registrarAuditoria(null, req.usuarioLogado, 'ponto.trabalho_retomado', 'funcionario', funcionario_id, {
            funcionario_nome: funcNome,
            tipo_intervalo: tipo,
            retorno_previsto: horarioPrevisto,
            retorno_real: horaAtualSP,
            desvio_min: desvioMin,
            status: desvioMin === null ? 'sem_horario' : desvioMin > 1 ? 'atrasado' : desvioMin < -1 ? 'adiantado' : 'no_horario',
        });

        await dbClient.query('COMMIT');
        res.status(200).json({ message: `Retomada registrada para ${tipo}.`, horario_retorno: horaAtualSP });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /ponto/retomar-trabalho] Erro:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

/**
 * POST /api/ponto/desfazer-retomada
 * Desfaz uma retomada antecipada de um funcionário PRODUZINDO.
 * Reseta horario_real_e2 (ou e3) para NULL → calcularTempoEfetivo volta a detectar
 * que agora < e2 (nulo) e recongelará o contador automaticamente.
 *
 * Body: { funcionario_id: number, tipo: 'ALMOCO' | 'PAUSA' }
 */
router.post('/desfazer-retomada', async (req, res) => {
    const { funcionario_id, tipo } = req.body;

    if (!funcionario_id || !['ALMOCO', 'PAUSA'].includes(tipo)) {
        return res.status(400).json({ error: 'Campos obrigatórios: funcionario_id, tipo (ALMOCO|PAUSA).' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');
        await exigirVinculoAtivo(dbClient, funcionario_id, req.empresaId);

        const dataHojeSP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        const campoRetorno = tipo === 'ALMOCO' ? 'horario_real_e2' : 'horario_real_e3';

        const retornoAnteriorResult = await dbClient.query(
            `SELECT ${campoRetorno} AS horario_retorno
             FROM ponto_diario
             WHERE funcionario_id = $1
               AND data = $2
               AND empresa_id = $3`,
            [funcionario_id, dataHojeSP, req.empresaId]
        );

        // Reseta o campo para NULL → contador recongelará via calcularTempoEfetivo
        const retornoDesfeito = await dbClient.query(
            `UPDATE ponto_diario
             SET ${campoRetorno} = NULL, updated_at = NOW()
             WHERE funcionario_id = $1
               AND data = $2
               AND empresa_id = $3`,
            [funcionario_id, dataHojeSP, req.empresaId]
        );
        if (retornoDesfeito.rowCount === 0) {
            throw new Error('Nenhum registro de ponto do dia foi encontrado para desfazer o retorno.');
        }

        if (await pontoEventosDisponivel(dbClient)) {
            await registrarEventoPonto(dbClient, {
                empresaId: req.empresaId,
                funcionarioId: funcionario_id,
                dataJornada: dataHojeSP,
                tipoEvento: TIPOS_EVENTO_PONTO.CORRECAO_MANUAL,
                idempotencyKey: `correcao:${dataHojeSP}:${funcionario_id}:retorno:${tipo}`,
                origem: ORIGENS_PONTO.SUPERVISOR,
                transicaoTipo: tipo,
                horarioEfetivo: retornoAnteriorResult.rows[0]?.horario_retorno || null,
                autorId: req.usuarioLogado?.id || null,
                autorNome: req.usuarioLogado?.nome || 'Supervisor',
                payload: {
                    acao: 'DESFAZER_RETORNO_MANUAL',
                    tipo_intervalo: tipo,
                    horario_anterior: retornoAnteriorResult.rows[0]?.horario_retorno || null,
                },
            });
        }

        await dbClient.query('COMMIT');
        res.status(200).json({ message: 'Retomada desfeita — intervalo restaurado.' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /ponto/desfazer-retomada] Erro:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
