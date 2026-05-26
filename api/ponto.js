// api/ponto.js
// API de Ponto Dinâmico — exceções manuais e liberação antecipada para intervalos.
// As entradas automáticas (almoço/pausa detectados ao finalizar tarefa) são feitas
// diretamente em api/producoes.js via detectarIntervaloAoFinalizar().

import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';
import { registrarAuditoria } from './audit.js';

const router = express.Router();
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const SECRET_KEY = process.env.JWT_SECRET;

// Middleware de autenticação (padrão do projeto)
router.use(async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) throw new Error('Token não fornecido');
        req.usuarioLogado = jwt.verify(token, SECRET_KEY);
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token inválido ou expirado' });
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
 *   motivo: string       // texto livre do supervisor (opcional)
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

        const dataHojeSP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        const campoHorario = tipo_excecao === 'ATRASO' ? 'horario_real_e1' : 'horario_real_s3';

        await dbClient.query(
            `INSERT INTO ponto_diario (funcionario_id, data, ${campoHorario}, tipo_excecao, motivo_excecao, registrado_por)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (funcionario_id, data) DO UPDATE SET
                 ${campoHorario}    = EXCLUDED.${campoHorario},
                 tipo_excecao      = EXCLUDED.tipo_excecao,
                 motivo_excecao    = EXCLUDED.motivo_excecao,
                 registrado_por    = EXCLUDED.registrado_por,
                 updated_at        = NOW()`,
            [funcionario_id, dataHojeSP, horarioFinal, tipo_excecao, motivo || null, supervisor]
        );

        // Saída antecipada: força status FORA_DO_HORARIO e cancela sessão ativa
        if (tipo_excecao === 'SAIDA_ANTECIPADA') {
            await dbClient.query(
                `UPDATE usuarios
                 SET status_atual = 'FORA_DO_HORARIO',
                     status_data_modificacao = (NOW() AT TIME ZONE 'America/Sao_Paulo'),
                     id_sessao_trabalho_atual = NULL
                 WHERE id = $1`,
                [funcionario_id]
            );
            await dbClient.query(
                `UPDATE sessoes_trabalho_producao
                 SET status = 'CANCELADA', data_fim = NOW()
                 WHERE funcionario_id = $1 AND status = 'EM_ANDAMENTO'`,
                [funcionario_id]
            );
        }

        await dbClient.query('COMMIT');
        res.status(200).json({ message: `Exceção '${tipo_excecao}' registrada.` });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /ponto/excecao] Erro:', error);
        res.status(500).json({ error: error.message });
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

        const agora = new Date();
        const horaAtualSP = agora.toLocaleTimeString('en-GB', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
        });
        const dataHojeSP = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

        // Busca horários E verifica se está PRODUZINDO (tem sessão ativa)
        // v1.8: se PRODUZINDO, só grava ponto_diario — não toca status nem sessão
        const horRes = await dbClient.query(
            `SELECT horario_saida_1, horario_entrada_2, horario_saida_2, horario_entrada_3,
                    id_sessao_trabalho_atual FROM usuarios WHERE id = $1`,
            [funcionario_id]
        );
        const horarios = horRes.rows[0] || {};
        const isProduzindo = !!horarios.id_sessao_trabalho_atual;
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
            `INSERT INTO ponto_diario (funcionario_id, data, ${campoSaida}, ${campoRetorno}, registrado_por)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (funcionario_id, data) DO UPDATE SET
                 ${campoSaida}   = COALESCE(ponto_diario.${campoSaida},   EXCLUDED.${campoSaida}),
                 ${campoRetorno} = COALESCE(ponto_diario.${campoRetorno}, EXCLUDED.${campoRetorno}),
                 registrado_por  = COALESCE(ponto_diario.registrado_por,  EXCLUDED.registrado_por),
                 updated_at      = NOW()`,
            [funcionario_id, dataHojeSP, horaAtualSP, horarioRetorno, supervisor]
        );

        // v1.8: se PRODUZINDO, não altera status nem sessão.
        // O frontend congela o timer via calcularTempoEfetivo ao detectar o ponto_diario.
        // Se LIVRE, atualiza status para ALMOCO/PAUSA normalmente.
        if (!isProduzindo) {
            await dbClient.query(
                `UPDATE usuarios
                 SET status_atual = $1,
                     status_data_modificacao = (NOW() AT TIME ZONE 'America/Sao_Paulo'),
                     id_sessao_trabalho_atual = NULL
                 WHERE id = $2`,
                [novoStatus, funcionario_id]
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
        res.status(500).json({ error: error.message });
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

        const dataHojeSP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

        // Verifica se existe saída antecipada hoje (não desfeita)
        const pontoRes = await dbClient.query(
            `SELECT id, horario_real_s3 FROM ponto_diario
             WHERE funcionario_id = $1 AND data = $2 AND horario_real_s3 IS NOT NULL AND (saida_desfeita IS NULL OR saida_desfeita = FALSE)`,
            [funcionario_id, dataHojeSP]
        );

        if (!pontoRes.rows.length) {
            return res.status(400).json({ error: 'Nenhuma saída antecipada ativa registrada hoje para este funcionário.' });
        }

        // Marca como desfeita — NÃO remove horario_real_s3 (preservar para auditoria)
        await dbClient.query(
            `UPDATE ponto_diario SET
                saida_desfeita     = TRUE,
                saida_desfeita_em  = NOW(),
                saida_desfeita_por = $1,
                updated_at         = NOW()
             WHERE funcionario_id = $2 AND data = $3`,
            [supervisor + (motivo ? ` — ${motivo}` : ''), funcionario_id, dataHojeSP]
        );

        // Volta status do funcionário para LIVRE
        await dbClient.query(
            `UPDATE usuarios
             SET status_atual = 'LIVRE',
                 status_data_modificacao = (NOW() AT TIME ZONE 'America/Sao_Paulo')
             WHERE id = $1`,
            [funcionario_id]
        );

        await dbClient.query('COMMIT');
        res.status(200).json({ message: `Saída antecipada desfeita para funcionário ${funcionario_id}.` });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /ponto/desfazer-saida] Erro:', error);
        res.status(500).json({ error: error.message });
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
        // Reseta status para 'LIVRE' (sem LIVRE_MANUAL com data).
        // O cálculo automático em determinarStatusFinalServidor usará o ponto_diario
        // para detectar que ainda estamos na janela de almoço/pausa → retorna ALMOCO/PAUSA.
        await dbClient.query(
            `UPDATE usuarios
             SET status_atual = 'LIVRE',
                 status_data_modificacao = (NOW() AT TIME ZONE 'America/Sao_Paulo')
             WHERE id = $1`,
            [funcionario_id]
        );
        res.status(200).json({ message: 'Liberação desfeita — intervalo restaurado.' });
    } catch (error) {
        console.error('[API POST /ponto/desfazer-liberacao] Erro:', error);
        res.status(500).json({ error: error.message });
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
    const { funcionario_id, tipo } = req.body;

    if (!funcionario_id || !['ALMOCO', 'PAUSA'].includes(tipo)) {
        return res.status(400).json({ error: 'Campos obrigatórios: funcionario_id, tipo (ALMOCO|PAUSA).' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();

        const agora = new Date();
        const horaAtualSP = agora.toLocaleTimeString('en-GB', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
        });
        const dataHojeSP = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        const campoRetorno = tipo === 'ALMOCO' ? 'horario_real_e2' : 'horario_real_e3';
        const campoRetornoPrevisto = tipo === 'ALMOCO' ? 'horario_real_e2' : 'horario_real_e3';

        // Busca retorno previsto (e2/e3 já gravado) e horário agendado para calcular desvio
        const dadosRes = await dbClient.query(
            `SELECT u.nome, u.horario_entrada_2, u.horario_entrada_3,
                    p.${campoRetornoPrevisto} AS retorno_previsto_db
             FROM usuarios u
             LEFT JOIN ponto_diario p ON p.funcionario_id = u.id AND p.data = $2
             WHERE u.id = $1`,
            [funcionario_id, dataHojeSP]
        );
        const dados = dadosRes.rows[0] || {};
        const funcNome = dados.nome || `ID ${funcionario_id}`;

        // Atualiza o campo de retorno para "agora" → frontend descongela o contador
        await dbClient.query(
            `UPDATE ponto_diario
             SET ${campoRetorno} = $1, updated_at = NOW()
             WHERE funcionario_id = $2 AND data = $3`,
            [horaAtualSP, funcionario_id, dataHojeSP]
        );

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

        registrarAuditoria(null, req.usuarioLogado, 'ponto.trabalho_retomado', 'funcionario', funcionario_id, {
            funcionario_nome: funcNome,
            tipo_intervalo: tipo,
            retorno_previsto: horarioPrevisto,
            retorno_real: horaAtualSP,
            desvio_min: desvioMin,
            status: desvioMin === null ? 'sem_horario' : desvioMin > 1 ? 'atrasado' : desvioMin < -1 ? 'adiantado' : 'no_horario',
        });

        res.status(200).json({ message: `Retomada registrada para ${tipo}.`, horario_retorno: horaAtualSP });

    } catch (error) {
        console.error('[API POST /ponto/retomar-trabalho] Erro:', error);
        res.status(500).json({ error: error.message });
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

        const dataHojeSP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        const campoRetorno = tipo === 'ALMOCO' ? 'horario_real_e2' : 'horario_real_e3';

        // Reseta o campo para NULL → contador recongelará via calcularTempoEfetivo
        await dbClient.query(
            `UPDATE ponto_diario
             SET ${campoRetorno} = NULL, updated_at = NOW()
             WHERE funcionario_id = $1 AND data = $2`,
            [funcionario_id, dataHojeSP]
        );

        res.status(200).json({ message: 'Retomada desfeita — intervalo restaurado.' });

    } catch (error) {
        console.error('[API POST /ponto/desfazer-retomada] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
