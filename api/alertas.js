// NOVO ARQUIVO: api/alertas.js

import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';
import { obterEmpresaIdDoContexto } from './contexto-empresa.js';

const { Pool } = pg;
const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
});

const SECRET_KEY = process.env.JWT_SECRET;

function formatarMinutos(totalMinutos) {
    if (totalMinutos < 60) {
        return `${Math.floor(totalMinutos)} min`;
    }
    const horas = Math.floor(totalMinutos / 60);
    const minutos = Math.floor(totalMinutos % 60);
    return `${horas}h ${minutos}min`;
}

function exigirCadeiaProdutivaLegada(req, res) {
    if (req.moduloEmpresa?.multiempresa_pronto && req.moduloEmpresa?.habilitado) return true;
    res.status(403).json({
        error: 'Os alertas da cadeia produtiva ainda nao estao disponiveis para a empresa ativa.',
        codigo: 'CADEIA_PRODUTIVA_NAO_MIGRADA',
    });
    return false;
}

async function buscarConfiguracoesDaEmpresa(dbClient, empresaId, somenteAtivas = false) {
    const filtroAtivo = somenteAtivas ? 'AND cea.ativo = TRUE' : '';
    const result = await dbClient.query(`
        SELECT
            ca.id,
            ca.tipo_alerta,
            ca.descricao,
            cea.ativo,
            cea.gatilho_minutos,
            cea.acao_popup,
            cea.acao_notificacao,
            cea.atualizado_em,
            cea.intervalo_repeticao_minutos,
            cea.peso_risco
        FROM configuracoes_alertas ca
        JOIN configuracoes_alertas_empresas cea
          ON cea.configuracao_id = ca.id
         AND cea.empresa_id = $1
        WHERE TRUE ${filtroAtivo}
        ORDER BY ca.id
    `, [empresaId]);
    return result.rows;
}

// Middleware de Autenticação (pode ser copiado de outros arquivos de API)
router.use(async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) throw new Error('Token não fornecido');
        const token = authHeader.split(' ')[1];
        req.usuarioLogado = jwt.verify(token, SECRET_KEY);
        req.empresaId = obterEmpresaIdDoContexto(req);
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
});

// GET /api/alertas/configuracoes - Busca todas as configurações de alerta
router.get('/configuracoes', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        // Qualquer usuário logado pode ler as configurações para o motor de alertas funcionar
        res.status(200).json(await buscarConfiguracoesDaEmpresa(dbClient, req.empresaId));
    } catch (error) {
        console.error('[API /alertas/configuracoes GET] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar configurações de alerta.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PUT /api/alertas/configuracoes - Salva as configurações em lote
router.put('/configuracoes', async (req, res) => {
    let dbClient;
    const configuracoes = req.body; // Espera um array de objetos de configuração

    if (!Array.isArray(configuracoes) || configuracoes.length === 0) {
        return res.status(400).json({ error: 'Formato de dados inválido. Esperado um array de configurações.' });
    }

    try {
        dbClient = await pool.connect();
        // Apenas usuários com alta permissão podem alterar as configurações
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id, req.empresaId);
        if (!permissoes.includes('gerenciar-permissoes')) { // Reutilizando permissão de admin
            return res.status(403).json({ error: 'Permissão negada para alterar configurações de alerta.' });
        }

        await dbClient.query('BEGIN');

        // Itera sobre cada configuração e executa um "UPSERT"
        for (const config of configuracoes) {
        const { id, ativo, gatilho_minutos, acao_popup, acao_notificacao, intervalo_repeticao_minutos, peso_risco } = config;

        const query = `
            INSERT INTO configuracoes_alertas_empresas
                (empresa_id, configuracao_id, ativo, gatilho_minutos,
                 acao_popup, acao_notificacao, intervalo_repeticao_minutos,
                 peso_risco, atualizado_em)
            SELECT $1, ca.id, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP
              FROM configuracoes_alertas ca
             WHERE ca.id = $8
            ON CONFLICT (empresa_id, configuracao_id) DO UPDATE SET
                ativo = EXCLUDED.ativo,
                gatilho_minutos = EXCLUDED.gatilho_minutos,
                acao_popup = EXCLUDED.acao_popup,
                acao_notificacao = EXCLUDED.acao_notificacao,
                intervalo_repeticao_minutos = EXCLUDED.intervalo_repeticao_minutos,
                peso_risco = EXCLUDED.peso_risco,
                atualizado_em = CURRENT_TIMESTAMP
        `;
        await dbClient.query(query, [
            req.empresaId,
            Boolean(ativo),
            parseInt(gatilho_minutos) || 5,
            Boolean(acao_popup),
            Boolean(acao_notificacao),
            parseInt(intervalo_repeticao_minutos) || 15,
            parseInt(peso_risco) || 0,
            parseInt(id)
        ]);
    }

        await dbClient.query('COMMIT');
        res.status(200).json({ message: 'Configurações de alerta salvas com sucesso!' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /alertas/configuracoes PUT] Erro:', error);
        res.status(500).json({ error: 'Erro ao salvar configurações.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/alertas/dias-trabalho
// Retorna configurações de calendário/horário: dias de trabalho, horário de expediente e janela de polling.
router.get('/dias-trabalho', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        // Busca as duas chaves em paralelo
        const [diasResult, pollResult] = await Promise.all([
            dbClient.query("SELECT valor, horario_inicio, horario_fim FROM alertas_configuracoes_gerais WHERE empresa_id = $1 AND chave = 'dias_de_trabalho'", [req.empresaId]),
            dbClient.query("SELECT horario_inicio, horario_fim FROM alertas_configuracoes_gerais WHERE empresa_id = $1 AND chave = 'janela_polling'", [req.empresaId]),
        ]);

        const diasRow = diasResult.rows[0];
        const pollRow = pollResult.rows[0];

        res.status(200).json({
            chave: 'dias_de_trabalho',
            valor:         diasRow?.valor        || {},
            horario_inicio: diasRow?.horario_inicio ? diasRow.horario_inicio.substring(0, 5) : '07:00',
            horario_fim:    diasRow?.horario_fim    ? diasRow.horario_fim.substring(0, 5)    : '18:00',
            // Janela de polling (quando o frontend faz chamadas à API)
            janela_poll_inicio: pollRow?.horario_inicio ? pollRow.horario_inicio.substring(0, 5) : '06:00',
            janela_poll_fim:    pollRow?.horario_fim    ? pollRow.horario_fim.substring(0, 5)    : '23:00',
        });
    } catch (error) {
        console.error('[API /dias-trabalho GET] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar dias de trabalho.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PUT /api/alertas/dias-trabalho
// Salva dias de trabalho, horário de expediente e janela de polling em lote.
router.put('/dias-trabalho', async (req, res) => {
    let dbClient;
    const { valor, horario_inicio, horario_fim, janela_poll_inicio, janela_poll_fim } = req.body;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id, req.empresaId);
        if (!permissoes.includes('gerenciar-permissoes')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        await Promise.all([
            // Dias de trabalho + horário de expediente
            dbClient.query(`
                INSERT INTO alertas_configuracoes_gerais
                    (empresa_id, chave, valor, horario_inicio, horario_fim)
                VALUES ($1, 'dias_de_trabalho', $2, $3, $4)
                ON CONFLICT (empresa_id, chave) DO UPDATE SET
                    valor = EXCLUDED.valor,
                    horario_inicio = EXCLUDED.horario_inicio,
                    horario_fim = EXCLUDED.horario_fim
            `, [req.empresaId, valor, horario_inicio || '07:00', horario_fim || '18:00']),

            // Janela de polling
            dbClient.query(`
                INSERT INTO alertas_configuracoes_gerais
                    (empresa_id, chave, valor, horario_inicio, horario_fim)
                VALUES ($1, 'janela_polling', '{}', $2, $3)
                ON CONFLICT (empresa_id, chave) DO UPDATE SET
                    horario_inicio = EXCLUDED.horario_inicio,
                    horario_fim = EXCLUDED.horario_fim
            `, [req.empresaId, janela_poll_inicio || '06:00', janela_poll_fim || '23:00']),
        ]);

        res.status(200).json({ message: 'Configurações de calendário atualizadas.' });

    } catch (error) {
        console.error('[API /dias-trabalho PUT] Erro:', error);
        res.status(500).json({ error: 'Erro ao salvar dias de trabalho.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/alertas/verificar-status - O motor principal de verificação de alertas
router.get('/verificar-status', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();

        const diasTrabalhoResult = await dbClient.query(
            "SELECT valor FROM alertas_configuracoes_gerais WHERE empresa_id = $1 AND chave = 'dias_de_trabalho'",
            [req.empresaId]
        );
        const hoje = new Date();
        const diaDaSemana = hoje.getDay();
        const diasDeTrabalho = diasTrabalhoResult.rows[0]?.valor || {};
        // Se não configurado (objeto vazio), considera sempre dia de trabalho
        const diasConfigurados = Object.keys(diasDeTrabalho).length > 0;
        const ehDiaDeTrabalho = !diasConfigurados || !!diasDeTrabalho[diaDaSemana.toString()];
        // Alertas baseados em eventos (DEMANDA_NORMAL, DEMANDA_PRIORITARIA etc.) sempre disparam independente do dia.
        // Apenas os alertas de tempo (ociosidade, lentidão) respeitam o calendário.

        // ── Verificar horário de expediente ──────────────────────────────────
        // Tenta ler horario_inicio/horario_fim da tabela; se as colunas não existirem
        // ainda (migração pendente), usa os padrões 07:00–18:00 silenciosamente.
        let horaInicioExpediente = 7;
        let horaFimExpediente    = 18;
        try {
            const horarioResult = await dbClient.query(
                `SELECT horario_inicio, horario_fim
                   FROM alertas_configuracoes_gerais
                  WHERE empresa_id = $1
                    AND chave = 'dias_de_trabalho'
                  LIMIT 1`,
                [req.empresaId]
            );
            const row = horarioResult.rows[0];
            if (row?.horario_inicio) horaInicioExpediente = parseInt(row.horario_inicio.toString().split(':')[0]);
            if (row?.horario_fim)    horaFimExpediente    = parseInt(row.horario_fim.toString().split(':')[0]);
        } catch {
            // colunas ainda não existem no banco — padrão 07h–18h
        }
        // ⚠️ CORREÇÃO: usar hora em São Paulo, não UTC (servidor roda em TZ=UTC)
        // Comparação usa hora+minuto como número inteiro (ex: 14h30 = 1430)
        // para evitar o problema de "23 < 23 = false" com horários de fim exatos
        const horaAtualStr = hoje.toLocaleTimeString('en-GB', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
        }); // ex: "14:30"
        const [hAtual, mAtual] = horaAtualStr.split(':').map(Number);
        const horaAtualMinutos = hAtual * 60 + mAtual; // ex: 870 (= 14h30)

        // horaInicioExpediente e horaFimExpediente são horas inteiras (ex: 7, 18)
        // Converter para minutos para comparação consistente
        const inicioExpedienteMin = horaInicioExpediente * 60;
        const fimExpedienteMin    = horaFimExpediente    * 60 + 59; // inclui toda a hora final
        const estaNoExpediente = horaAtualMinutos >= inicioExpedienteMin && horaAtualMinutos <= fimExpedienteMin;

        const configs = await buscarConfiguracoesDaEmpresa(dbClient, req.empresaId, true);

        const alertasParaDisparar = [];
        const queriesDeAtualizacao = [];

        // =====================================================================
        // ALERTAS DE TEMPO — só verificar em dias e horários de trabalho
        // =====================================================================
        if (ehDiaDeTrabalho && estaNoExpediente) {

        // ─── Arremate ───────────────────────────────────────────────────────
        const configOciosidade = configs.find(c => c.tipo_alerta === 'OCIOSIDADE_ARREMATE');
        const configLentidao = configs.find(c => c.tipo_alerta === 'LENTIDAO_CRITICA_ARREMATE');

        if (configOciosidade || configLentidao) {
            const tiktiksResult = await dbClient.query(`
                SELECT 
                    u.id, u.nome, ue.status_atual, ue.status_data_modificacao,
                    ue.ultimo_alerta_ociosidade_em, ue.ultimo_alerta_lentidao_em,
                    s.data_inicio, s.produto_id, s.quantidade_entregue,
                    (
                        SELECT MAX(s2.data_fim) 
                        FROM sessoes_trabalho_arremate s2 
                        WHERE s2.usuario_tiktik_id = u.id 
                          AND s2.empresa_id = ue.empresa_id
                          AND s2.status = 'FINALIZADA'
                          AND s2.data_fim >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
                    ) as data_ultima_tarefa_finalizada_hoje
                FROM usuarios u
                JOIN usuarios_empresas ue
                  ON ue.usuario_id = u.id
                 AND ue.empresa_id = $1
                 AND ue.ativo
                LEFT JOIN sessoes_trabalho_arremate s
                  ON ue.id_sessao_trabalho_atual = s.id
                 AND s.empresa_id = ue.empresa_id
                WHERE 'tiktik' = ANY(ue.tipos)
                  AND ue.data_demissao IS NULL
            `, [req.empresaId]);
            const tiktiks = tiktiksResult.rows;

            const temposResult = await dbClient.query('SELECT produto_id, tempo_segundos_por_peca FROM tempos_padrao_arremate WHERE empresa_id = $1', [req.empresaId]);
            const temposMap = new Map(temposResult.rows.map(row => [row.produto_id, parseFloat(row.tempo_segundos_por_peca)]));

            for (const tiktik of tiktiks) {
                // --- Verificação de Ociosidade (LÓGICA CORRIGIDA) ---
                if (configOciosidade && tiktik.status_atual === 'LIVRE') {
                    const agoraMs = hoje.getTime();
                    const ultimoAlerta = tiktik.ultimo_alerta_ociosidade_em ? new Date(tiktik.ultimo_alerta_ociosidade_em).getTime() : 0;
                    const minutosDesdeUltimoAlerta = (agoraMs - ultimoAlerta) / (1000 * 60);

                    if (minutosDesdeUltimoAlerta >= configOciosidade.intervalo_repeticao_minutos) {
                        
                        // --- LÓGICA DE PONTO DE PARTIDA CORRIGIDA (VERSÃO FINAL) ---
                        
                        const dataModificacao = tiktik.status_data_modificacao ? new Date(tiktik.status_data_modificacao).getTime() : 0;
                        const dataUltimaTarefa = tiktik.data_ultima_tarefa_finalizada_hoje ? new Date(tiktik.data_ultima_tarefa_finalizada_hoje).getTime() : 0;

                        // O início da ociosidade é o evento MAIS RECENTE que aconteceu
                        const inicioOciosidadeMs = Math.max(dataModificacao, dataUltimaTarefa);

                        if (inicioOciosidadeMs > 0) {
                            const minutosOcioso = (agoraMs - inicioOciosidadeMs) / (1000 * 60);

                            if (minutosOcioso >= configOciosidade.gatilho_minutos) {
                                alertasParaDisparar.push({
                                    tipo: 'OCIOSIDADE_ARREMATE',
                                    mensagem: `Atenção: ${tiktik.nome} está ocioso(a) há mais de ${formatarMinutos(minutosOcioso)}.`,
                                    config: configOciosidade,
                                    nivel: 'critico'
                                });
                                queriesDeAtualizacao.push(
                                    dbClient.query(
                                        `UPDATE usuarios_empresas
                                            SET ultimo_alerta_ociosidade_em = NOW()
                                          WHERE usuario_id = $1
                                            AND empresa_id = $2`,
                                        [tiktik.id, req.empresaId]
                                    )
                                );
                            }
                        }
                    }
                }

                // --- Verificação de Lentidão Crítica ---
                if (configLentidao && tiktik.status_atual === 'PRODUZINDO' && tiktik.data_inicio) {
                    const agoraMs = hoje.getTime();
                    const ultimoAlerta = tiktik.ultimo_alerta_lentidao_em ? new Date(tiktik.ultimo_alerta_lentidao_em).getTime() : 0;
                    const minutosDesdeUltimoAlerta = (agoraMs - ultimoAlerta) / (1000 * 60);

                    if (minutosDesdeUltimoAlerta >= configLentidao.intervalo_repeticao_minutos) {
                        const tpe = temposMap.get(tiktik.produto_id);
                        const dataInicio = new Date(tiktik.data_inicio);
                        const minutosEmTarefa = (agoraMs - dataInicio.getTime()) / (1000 * 60);

                        // --- LOG DE DIAGNÓSTICO (remover após confirmar funcionamento) ---
                        console.log('[DEBUG LENTIDAO_ARREMATE]', {
                            nome:             tiktik.nome,
                            status:           tiktik.status_atual,
                            produto_id:       tiktik.produto_id,
                            quantidade:       tiktik.quantidade_entregue,
                            minutos_em_tarefa: minutosEmTarefa.toFixed(1),
                            tpe_segundos:     tpe ?? 'NÃO CADASTRADO',
                        });

                        if (!tpe) {
                            console.warn(`[LENTIDAO_ARREMATE] TPP não cadastrado para produto_id=${tiktik.produto_id}. Cadastre em Arremate > Tempos Padrão.`);
                        } else if (minutosEmTarefa >= configLentidao.gatilho_minutos) {
                            const tempoDecorridoSegundos = minutosEmTarefa * 60;
                            const tempoTotalEstimado     = tpe * (tiktik.quantidade_entregue || 1);
                            const progressoTempo         = (tempoDecorridoSegundos / tempoTotalEstimado) * 100;

                            console.log('[DEBUG LENTIDAO_ARREMATE] progressoTempo:', progressoTempo.toFixed(1) + '%',
                                '| estimado:', (tempoTotalEstimado / 60).toFixed(1) + 'min');

                            if (progressoTempo >= 120) {
                                alertasParaDisparar.push({
                                    tipo: 'LENTIDAO_CRITICA_ARREMATE',
                                    mensagem: `🐢 Performance Baixa: ${tiktik.nome} está com ritmo lento — ${formatarMinutos(minutosEmTarefa)} na tarefa (estimado: ${formatarMinutos(tempoTotalEstimado / 60)}).`,
                                    config: configLentidao,
                                    nivel: 'aviso'
                                });
                                queriesDeAtualizacao.push(
                                    dbClient.query(
                                        `UPDATE usuarios_empresas
                                            SET ultimo_alerta_lentidao_em = NOW()
                                          WHERE usuario_id = $1
                                            AND empresa_id = $2`,
                                        [tiktik.id, req.empresaId]
                                    )
                                );
                            }
                        }
                    }
                }
            }
        }
        
        // =====================================================================
        // VERIFICAÇÃO DE ALERTAS DE COSTURA
        // =====================================================================

        const configOciosidadeCostureira = configs.find(c => c.tipo_alerta === 'OCIOSIDADE_COSTUREIRA');
        const configLentidaoCostureira   = configs.find(c => c.tipo_alerta === 'LENTIDAO_COSTUREIRA');

        if (configOciosidadeCostureira || configLentidaoCostureira) {
            const costureirasResult = await dbClient.query(`
                SELECT
                    u.id, u.nome, ue.status_atual, ue.status_data_modificacao,
                    ue.ultimo_alerta_ociosidade_em, ue.ultimo_alerta_lentidao_em,
                    s.data_inicio      AS sessao_data_inicio,
                    s.produto_id       AS sessao_produto_id,
                    s.processo         AS sessao_processo,
                    s.quantidade_atribuida AS sessao_quantidade,
                    (
                        SELECT MAX(s2.data_fim)
                        FROM sessoes_trabalho_producao s2
                        WHERE s2.funcionario_id = u.id
                          AND s2.empresa_id = ue.empresa_id
                          AND s2.status IN ('FINALIZADA', 'FINALIZADA_FORCADA')
                          AND s2.data_fim >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
                    ) AS data_ultima_tarefa_finalizada_hoje
                FROM usuarios u
                JOIN usuarios_empresas ue
                  ON ue.usuario_id = u.id
                 AND ue.empresa_id = $1
                 AND ue.ativo
                LEFT JOIN sessoes_trabalho_producao s
                  ON ue.id_sessao_trabalho_atual = s.id
                 AND s.empresa_id = ue.empresa_id
                WHERE 'costureira' = ANY(ue.tipos)
                  AND ue.data_demissao IS NULL
            `, [req.empresaId]);

            // Busca TPP de produção — chave composta: produto_id + processo
            const tppProducaoResult = await dbClient.query(
                'SELECT produto_id, processo, tempo_segundos FROM tempos_padrao_producao'
            );
            const tppProducaoMap = new Map(
                tppProducaoResult.rows.map(r => [`${r.produto_id}-${r.processo}`, parseFloat(r.tempo_segundos)])
            );

            for (const costureira of costureirasResult.rows) {
                // --- Ociosidade (lógica inalterada) ---
                if (configOciosidadeCostureira && costureira.status_atual === 'LIVRE') {
                    const agoraMs = hoje.getTime();
                    const ultimoAlerta = costureira.ultimo_alerta_ociosidade_em
                        ? new Date(costureira.ultimo_alerta_ociosidade_em).getTime() : 0;
                    const minutosDesdeUltimoAlerta = (agoraMs - ultimoAlerta) / (1000 * 60);

                    if (minutosDesdeUltimoAlerta >= configOciosidadeCostureira.intervalo_repeticao_minutos) {
                        const dataModificacao = costureira.status_data_modificacao
                            ? new Date(costureira.status_data_modificacao).getTime() : 0;
                        const dataUltimaTarefa = costureira.data_ultima_tarefa_finalizada_hoje
                            ? new Date(costureira.data_ultima_tarefa_finalizada_hoje).getTime() : 0;
                        const inicioOciosidadeMs = Math.max(dataModificacao, dataUltimaTarefa);

                        if (inicioOciosidadeMs > 0) {
                            const minutosOciosa = (agoraMs - inicioOciosidadeMs) / (1000 * 60);
                            if (minutosOciosa >= configOciosidadeCostureira.gatilho_minutos) {
                                alertasParaDisparar.push({
                                    tipo: 'OCIOSIDADE_COSTUREIRA',
                                    mensagem: `Atenção: ${costureira.nome} está ociosa há mais de ${formatarMinutos(minutosOciosa)}.`,
                                    config: configOciosidadeCostureira,
                                    nivel: 'critico'
                                });
                                queriesDeAtualizacao.push(
                                    dbClient.query(
                                        `UPDATE usuarios_empresas
                                            SET ultimo_alerta_ociosidade_em = NOW()
                                          WHERE usuario_id = $1
                                            AND empresa_id = $2`,
                                        [costureira.id, req.empresaId]
                                    )
                                );
                            }
                        }
                    }
                }

                // --- Lentidão baseada em TPP (mesma lógica do arremate) ---
                if (configLentidaoCostureira && costureira.status_atual === 'PRODUZINDO' && costureira.sessao_data_inicio) {
                    const agoraMs = hoje.getTime();
                    const ultimoAlerta = costureira.ultimo_alerta_lentidao_em
                        ? new Date(costureira.ultimo_alerta_lentidao_em).getTime() : 0;
                    const minutosDesdeUltimoAlerta = (agoraMs - ultimoAlerta) / (1000 * 60);

                    if (minutosDesdeUltimoAlerta >= configLentidaoCostureira.intervalo_repeticao_minutos) {
                        const minutosEmTarefa = (agoraMs - new Date(costureira.sessao_data_inicio).getTime()) / (1000 * 60);

                        // Só verifica lentidão depois do gatilho mínimo de tempo
                        if (minutosEmTarefa >= configLentidaoCostureira.gatilho_minutos) {
                            const chaveTPP = `${costureira.sessao_produto_id}-${costureira.sessao_processo}`;
                            const tpp = tppProducaoMap.get(chaveTPP);

                            // --- LOG DE DIAGNÓSTICO (remover após confirmar funcionamento) ---
                            console.log('[DEBUG LENTIDAO_COSTUREIRA]', {
                                nome:              costureira.nome,
                                status:            costureira.status_atual,
                                sessao_inicio:     costureira.sessao_data_inicio,
                                produto_id:        costureira.sessao_produto_id,
                                processo:          costureira.sessao_processo,
                                quantidade:        costureira.sessao_quantidade,
                                minutos_em_tarefa: minutosEmTarefa.toFixed(1),
                                tpp_segundos:      tpp ?? 'NÃO CADASTRADO',
                                chave_tpp:         chaveTPP,
                            });

                            if (tpp) {
                                const tempoDecorridoSeg   = minutosEmTarefa * 60;
                                const tempoEstimadoSeg    = tpp * (costureira.sessao_quantidade || 1);
                                const progressoTempo      = (tempoDecorridoSeg / tempoEstimadoSeg) * 100;

                                console.log('[DEBUG LENTIDAO_COSTUREIRA] progressoTempo:', progressoTempo.toFixed(1) + '%',
                                    '| estimado:', (tempoEstimadoSeg / 60).toFixed(1) + 'min');

                                if (progressoTempo >= 120) { // Passou 20% acima do tempo esperado
                                    alertasParaDisparar.push({
                                        tipo: 'LENTIDAO_COSTUREIRA',
                                        mensagem: `🐢 Performance Baixa: ${costureira.nome} está com ritmo lento — ${formatarMinutos(minutosEmTarefa)} na tarefa (estimado: ${formatarMinutos(tempoEstimadoSeg / 60)}).`,
                                        config: configLentidaoCostureira,
                                        nivel: 'aviso'
                                    });
                                    queriesDeAtualizacao.push(
                                        dbClient.query(
                                            `UPDATE usuarios_empresas
                                                SET ultimo_alerta_lentidao_em = NOW()
                                              WHERE usuario_id = $1
                                                AND empresa_id = $2`,
                                            [costureira.id, req.empresaId]
                                        )
                                    );
                                }
                            } else {
                                // TPP não cadastrado — loga mas não dispara alerta
                                console.warn(`[LENTIDAO_COSTUREIRA] TPP não cadastrado para: produto_id=${costureira.sessao_produto_id}, processo="${costureira.sessao_processo}". Cadastre em Produção > Tempos Padrão.`);
                            }
                        }
                    }
                }
            }
        }

        // ─── Demandas não iniciadas ──────────────────────────────────────────
        const configDemandaNaoIniciada = configs.find(c => c.tipo_alerta === 'DEMANDA_NAO_INICIADA');

        if (configDemandaNaoIniciada) {
            const demandasParadasResult = await dbClient.query(`
                SELECT COUNT(*) as total
                FROM demandas_producao
                WHERE status = 'pendente'
                  AND empresa_id = $1
                  AND criado_em < NOW() - INTERVAL '${parseInt(configDemandaNaoIniciada.gatilho_minutos)} minutes'
            `, [req.empresaId]);
            const totalParadas = parseInt(demandasParadasResult.rows[0]?.total || 0);

            if (totalParadas > 0) {
                const mensagem = totalParadas === 1
                    ? `1 demanda aguardando início há mais de ${configDemandaNaoIniciada.gatilho_minutos} minutos.`
                    : `${totalParadas} demandas aguardando início há mais de ${configDemandaNaoIniciada.gatilho_minutos} minutos.`;
                alertasParaDisparar.push({
                    tipo: 'DEMANDA_NAO_INICIADA',
                    mensagem,
                    config: configDemandaNaoIniciada,
                    nivel: 'aviso'
                });
            }
        }

        // =====================================================================
        // FIM DOS ALERTAS DE TEMPO (dias e horário de trabalho)
        // =====================================================================
        } // end if (ehDiaDeTrabalho && estaNoExpediente)

        // =====================================================================
        // ALERTAS DE EVENTOS — sempre disparam (independente do dia)
        // =====================================================================
        // Busca todos os eventos não lidos e os agrupa por tipo (evita flood de N alertas iguais)
        const eventosResult = await dbClient.query(
            "SELECT * FROM eventos_sistema WHERE empresa_id = $1 AND lido = false ORDER BY criado_em ASC",
            [req.empresaId]
        );
        if (eventosResult.rows.length > 0) {
            console.log(`[LOG EVENTOS] ${eventosResult.rows.length} evento(s) não lido(s) encontrado(s).`);
            const idsEventosLidos = [];

            // Agrupa por tipo para não disparar 10x o mesmo alerta
            const eventosPorTipo = new Map();
            for (const evento of eventosResult.rows) {
                if (!eventosPorTipo.has(evento.tipo_evento)) {
                    eventosPorTipo.set(evento.tipo_evento, []);
                }
                eventosPorTipo.get(evento.tipo_evento).push(evento);
            }

            for (const [tipoEvento, eventosDoTipo] of eventosPorTipo) {
                const configDoEvento = configs.find(c => c.tipo_alerta === tipoEvento);
                if (!configDoEvento) continue;

                const nivel = tipoEvento === 'META_BATIDA_ARREMATE'  ? 'info'    :
                              tipoEvento === 'DEMANDA_PRIORITARIA'   ? 'critico' :
                              tipoEvento === 'HORA_EXTRA_LANCADA'    ? 'critico' :
                              tipoEvento === 'DEMANDA_NORMAL'        ? 'aviso'   : 'aviso';
                // DEMANDA_NORMAL é 'aviso' (não dispara popup/som) — só DEMANDA_PRIORITARIA é 'critico'.

                let mensagem;
                if (eventosDoTipo.length === 1) {
                    mensagem = eventosDoTipo[0].mensagem;
                } else {
                    // Mensagem agrupada — mostra as 2 mais recentes para o supervisor saber o que chegou
                    const exemplos = eventosDoTipo.slice(-2).map(e => e.mensagem.split('—')[0].replace('Nova demanda: ', '').trim()).join(', ');
                    mensagem = `${eventosDoTipo.length} novas demandas aguardando início (últimas: ${exemplos}…)`;
                }

                // dados_extras (mini-card visual) só faz sentido para 1 evento específico.
                // Para múltiplos eventos agrupados, o mini-card mostraria a variante errada
                // (sempre a primeira, ignorando as demais). Nesses casos usamos só a mensagem de texto.
                const dadosExtras = eventosDoTipo.length === 1 ? (eventosDoTipo[0]?.dados_extras || null) : null;
                alertasParaDisparar.push({ tipo: tipoEvento, mensagem, config: configDoEvento, nivel, dados_extras: dadosExtras });
                eventosDoTipo.forEach(e => idsEventosLidos.push(e.id));
                console.log(`[LOG EVENTOS] Tipo "${tipoEvento}": ${eventosDoTipo.length} evento(s) → 1 alerta agrupado.`);
            }

            if (idsEventosLidos.length > 0) {
                await dbClient.query(
                    "UPDATE eventos_sistema SET lido = true WHERE empresa_id = $1 AND id = ANY($2::int[])",
                    [req.empresaId, idsEventosLidos]
                );
            }
        }

        if (queriesDeAtualizacao.length > 0) {
            await Promise.all(queriesDeAtualizacao);
        }

        if (alertasParaDisparar.length > 0) {
            console.log(`[API /verificar-status] Enviando ${alertasParaDisparar.length} alerta(s) para o frontend:`, alertasParaDisparar);
            // Gravar no histórico (fire-and-forget — não bloqueia a resposta)
            Promise.all(alertasParaDisparar.map(a =>
                dbClient.query(
                    `INSERT INTO historico_alertas
                        (empresa_id, tipo_alerta, mensagem, nivel)
                     VALUES ($1, $2, $3, $4)`,
                    [req.empresaId, a.tipo, a.mensagem, a.nivel]
                ).catch(() => {}) // silencioso caso a tabela ainda não exista
            ));
        }

        res.status(200).json(alertasParaDisparar);

    } catch (error) {
        console.error('[API /alertas/verificar-status GET] Erro:', error);
        res.status(500).json({ error: 'Erro ao verificar status para alertas.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/alertas/historico — alertas disparados hoje
router.get('/historico', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(`
            SELECT id, tipo_alerta, mensagem, nivel, disparado_em
            FROM historico_alertas
            WHERE empresa_id = $1
              AND disparado_em >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
            ORDER BY disparado_em DESC
        `, [req.empresaId]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[API /alertas/historico GET] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico de alertas.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/alertas/hora-extra — registra hora extra autorizada pelo supervisor
router.post('/hora-extra', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const { funcionario_id, funcionario_nome, produto_nome, processo, quantidade } = req.body;
        const supervisor = req.usuarioLogado;

        const mensagem = `Hora extra: supervisor "${supervisor.nome}" autorizou ${funcionario_nome} — ${quantidade}x ${produto_nome} (${processo})`;

        await Promise.all([
            dbClient.query(`
                INSERT INTO eventos_sistema
                    (empresa_id, tipo_evento, mensagem, lido, dados_extras, criado_em)
                VALUES ($1, 'HORA_EXTRA_LANCADA', $2, false, $3, NOW())
            `, [req.empresaId, mensagem, JSON.stringify({ empresa_id: req.empresaId, supervisor_id: supervisor.id, supervisor_nome: supervisor.nome, funcionario_id, funcionario_nome, produto_nome, processo, quantidade })]),

            dbClient.query(`
                INSERT INTO historico_alertas
                    (empresa_id, tipo_alerta, mensagem, nivel, disparado_em)
                VALUES ($1, 'HORA_EXTRA_LANCADA', $2, 'critico', NOW())
            `, [req.empresaId, mensagem]),
        ]);

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('[API POST /alertas/hora-extra] Erro:', error);
        res.status(500).json({ error: 'Erro ao registrar hora extra.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
