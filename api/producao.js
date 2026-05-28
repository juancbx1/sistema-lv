// api/producao.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';
import { getPermissoesCompletasUsuarioDB, determinarStatusFinalServidor } from './usuarios.js';

const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
});
const SECRET_KEY = process.env.JWT_SECRET;

// Converte 'HH:MM' (ou 'HH:MM:SS') em minutos desde meia-noite. Null se inválido.
const hhmmParaMin = (hhmm) => {
    if (!hhmm || typeof hhmm !== 'string' || hhmm.length < 5) return null;
    const [h, m] = hhmm.substring(0, 5).split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
};

// Middleware de autenticação (pode ser copiado de outros arquivos de API)
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

// GET /api/producao/meu-status — status do próprio usuário logado (para o FAB da dashboard)
router.get('/meu-status', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const userId = req.usuarioLogado.id;

        const [usuarioResult, pontoResult, pontosHojeResult] = await Promise.all([
            dbClient.query(`
                SELECT
                    u.id, u.nome, u.tipos, u.status_atual, u.status_data_modificacao,
                    u.horario_entrada_1, u.horario_saida_1,
                    u.horario_entrada_2, u.horario_saida_2,
                    u.horario_entrada_3, u.horario_saida_3,
                    u.dias_trabalho,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'id_sessao',   s.id,
                                'op_numero',   s.op_numero,
                                'produto_id',  s.produto_id,
                                'variante',    s.variante,
                                'processo',    s.processo,
                                'quantidade',  s.quantidade_atribuida,
                                'data_inicio', s.data_inicio,
                                'produto_nome', p.nome,
                                'imagem',      COALESCE(g.imagem, p.imagem),
                                'valor_ponto', cpp.pontos_padrao,
                                'tpp',         tpp_ref.tempo_segundos
                            ) ORDER BY s.id ASC
                        ) FILTER (WHERE s.id IS NOT NULL),
                        '[]'
                    ) AS tarefas_ativas
                FROM usuarios u
                LEFT JOIN sessoes_trabalho_producao s
                    ON u.id = s.funcionario_id AND s.status = 'EM_ANDAMENTO'
                LEFT JOIN produtos p ON s.produto_id = p.id
                LEFT JOIN LATERAL (
                    SELECT gr.imagem
                    FROM jsonb_to_recordset(
                        CASE WHEN jsonb_typeof(p.grade) = 'array' THEN p.grade ELSE '[]'::jsonb END
                    ) AS gr(sku TEXT, variacao TEXT, imagem TEXT)
                    WHERE gr.variacao = s.variante
                    LIMIT 1
                ) g ON true
                LEFT JOIN configuracoes_pontos_processos cpp
                    ON cpp.produto_id = s.produto_id
                    AND cpp.processo_nome = s.processo
                    AND cpp.tipo_atividade = 'costura_op_costureira'
                    AND cpp.ativo = TRUE
                LEFT JOIN tempos_padrao_producao tpp_ref
                    ON tpp_ref.produto_id = s.produto_id
                    AND tpp_ref.processo = s.processo
                WHERE u.id = $1
                GROUP BY u.id
            `, [userId]),
            dbClient.query(`
                SELECT horario_real_s1, horario_real_e2,
                       horario_real_s2, horario_real_e3, horario_real_s3
                FROM ponto_diario
                WHERE funcionario_id = $1
                  AND data = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
            `, [userId]),
            dbClient.query(`
                SELECT COALESCE(SUM(pontos_gerados), 0)::numeric(10,2) AS pontos_hoje
                FROM producoes
                WHERE funcionario_id = $1
                  AND (data AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
            `, [userId]),
        ]);

        if (usuarioResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const row = usuarioResult.rows[0];
        const pontoDiario = pontoResult.rows[0] || null;
        const tarefas = row.tarefas_ativas || [];
        const temTarefa = tarefas.length > 0;
        const pontosHoje = parseFloat(pontosHojeResult.rows[0]?.pontos_hoje || 0);

        let statusFinal = determinarStatusFinalServidor(row, pontoDiario);
        if (temTarefa) statusFinal = 'PRODUZINDO';

        res.status(200).json({
            id: row.id,
            nome: row.nome,
            tipos: row.tipos,
            status_atual: statusFinal,
            pontos_hoje: pontosHoje,
            horario_saida_1:   row.horario_saida_1,
            horario_entrada_2: row.horario_entrada_2,
            horario_saida_2:   row.horario_saida_2,
            horario_entrada_3: row.horario_entrada_3,
            ponto_hoje: pontoDiario ? {
                horario_real_s1: pontoDiario.horario_real_s1,
                horario_real_e2: pontoDiario.horario_real_e2,
                horario_real_s2: pontoDiario.horario_real_s2,
                horario_real_e3: pontoDiario.horario_real_e3,
                horario_real_s3: pontoDiario.horario_real_s3,
            } : null,
            tarefa_atual:   temTarefa ? tarefas[0] : null,
            proxima_tarefa: tarefas.length > 1 ? tarefas[1] : null,
        });
    } catch (error) {
        console.error('[API /producao/meu-status] Erro:', error);
        res.status(500).json({ error: 'Erro ao carregar status.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ========= NOSSO NOVO ENDPOINT =========
router.get('/status-funcionarios', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        if (!permissoes.includes('acesso-ordens-de-producao')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        // MUDANÇA NA QUERY: Removemos o LEFT JOIN simples e fazemos um agrupamento de sessões
        // Buscamos usuários e suas sessões ativas (agregadas em JSON array)
        const query = `
            SELECT 
                u.id, u.nome, u.avatar_url, u.foto_oficial, u.nivel, u.status_atual, u.status_data_modificacao,
                u.horario_entrada_1, u.horario_saida_1, u.horario_entrada_2, u.horario_saida_2,
                u.horario_entrada_3, u.horario_saida_3, u.dias_trabalho,
                u.tipos,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id_sessao', s.id,
                            'op_numero', s.op_numero,
                            'produto_id', s.produto_id,
                            'variante', s.variante,
                            'processo', s.processo,
                            'quantidade', s.quantidade_atribuida,
                            'data_inicio', s.data_inicio,
                            'produto_nome', p.nome,
                            'imagem', COALESCE(g.imagem, p.imagem),
                            'etapas_unificadas', s.etapas_unificadas
                        ) ORDER BY s.id ASC
                    ) FILTER (WHERE s.id IS NOT NULL),
                    '[]'
                ) as tarefas_ativas
            FROM usuarios u
            LEFT JOIN sessoes_trabalho_producao s ON u.id = s.funcionario_id AND s.status = 'EM_ANDAMENTO'
            LEFT JOIN produtos p ON s.produto_id = p.id
            LEFT JOIN LATERAL (
                SELECT gr.imagem
                FROM jsonb_to_recordset(
                    CASE WHEN jsonb_typeof(p.grade) = 'array' THEN p.grade ELSE '[]'::jsonb END
                ) AS gr(sku TEXT, variacao TEXT, imagem TEXT)
                WHERE gr.variacao = s.variante
                LIMIT 1
            ) g ON true
            WHERE u.data_demissao IS NULL
            AND ('costureira' = ANY(u.tipos) OR 'tiktik' = ANY(u.tipos))
            AND (u.is_test IS FALSE OR u.is_test IS NULL)
            AND NOT ('prestador_externo' = ANY(u.tipos))
            GROUP BY u.id
            ORDER BY u.nome ASC;
        `;
        
        const result = await dbClient.query(query);

        // Busca ponto_diario e sessoes_hoje em paralelo (bulk — sem N+1)
        const [pontoDiarioResult, sessoesHojeResult, feriadoHojeResult] = await Promise.all([
            dbClient.query(
                `SELECT funcionario_id, horario_real_s1, horario_real_e2,
                        horario_real_s2, horario_real_e3, horario_real_s3,
                        saida_desfeita, saida_desfeita_por, saida_desfeita_em
                 FROM ponto_diario
                 WHERE data = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`
            ),
            dbClient.query(
                `SELECT
                    s.funcionario_id,
                    json_agg(
                        json_build_object(
                            'inicio',       to_char(s.data_inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
                            'fim',          to_char(s.data_fim    AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
                            'op_numero',    s.op_numero,
                            'produto_id',   s.produto_id,
                            'produto_nome', p.nome,
                            'variante',     s.variante,
                            'processo',     s.processo,
                            'quantidade',   s.quantidade_atribuida,
                            'imagem',       COALESCE(g.imagem, p.imagem)
                        ) ORDER BY s.data_inicio
                    ) AS sessoes
                 FROM sessoes_trabalho_producao s
                 LEFT JOIN produtos p ON s.produto_id = p.id
                 LEFT JOIN LATERAL (
                     SELECT gr.imagem
                     FROM jsonb_to_recordset(
                         CASE WHEN jsonb_typeof(p.grade) = 'array' THEN p.grade ELSE '[]'::jsonb END
                     ) AS gr(sku TEXT, variacao TEXT, imagem TEXT)
                     WHERE gr.variacao = s.variante
                     LIMIT 1
                 ) g ON true
                 WHERE (s.data_inicio AT TIME ZONE 'America/Sao_Paulo')::date
                           = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
                   AND s.status IN ('FINALIZADA', 'EM_ANDAMENTO')
                 GROUP BY s.funcionario_id`
            ),
            dbClient.query(`
                SELECT descricao
                FROM calendario_empresa
                WHERE data = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
                  AND tipo IN ('feriado_nacional', 'feriado_regional', 'folga_empresa')
                  AND NOT EXISTS (
                      SELECT 1 FROM calendario_empresa c2
                      WHERE c2.data = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
                        AND c2.tipo = 'trabalho_extra'
                  )
                LIMIT 1
            `),
        ]);
        const pontoDiarioMap  = new Map(pontoDiarioResult.rows.map(p => [p.funcionario_id, p]));
        const sessoesHojeMap  = new Map(sessoesHojeResult.rows.map(r => [r.funcionario_id, r.sessoes || []]));

        // ─────────────────────────────────────────────────────────────────────
        // BUG-15b — Rede de segurança pós-E2/E3
        // Garante que TODO funcionário com evidência de atividade hoje tenha
        // registro no ponto_diario, mesmo que o supervisor não tenha clicado
        // no botão de liberar e nenhuma tarefa tenha sido finalizada dentro da
        // janela de tolerância de 30min.
        // Usa horários AGENDADOS (S1/E2/S2/E3 do cadastro) como fallback.
        // Precisão: limitada pela janela de polling do frontend (~4-10min).
        // Aceitável para este cenário raro (supervisor distraído + tarefa longa).
        // ─────────────────────────────────────────────────────────────────────
        const agoraSP = new Date().toLocaleTimeString('en-GB', {
            timeZone: 'America/Sao_Paulo', hour12: false, hour: '2-digit', minute: '2-digit'
        });
        const dataHojeSP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        const agoraMin = hhmmParaMin(agoraSP);
        const safetyNetInserts = [];
        const n5 = (t) => t ? String(t).substring(0, 5) : null;

        for (const row of result.rows) {
            // Pula status explícitos de ausência — se o supervisor marcou,
            // o empregado não estava lá pra ir no almoço.
            if (row.status_atual === 'FALTOU' || row.status_atual === 'ALOCADO_EXTERNO') continue;

            // Só aplica safety net se há evidência de atividade hoje
            // (sessão finalizada/ativa). Senão, não há razão para gravar ponto.
            const temAtividadeHoje =
                (sessoesHojeMap.get(row.id)?.length || 0) > 0 ||
                (row.tarefas_ativas && row.tarefas_ativas.length > 0);
            if (!temAtividadeHoje) continue;

            const ponto = pontoDiarioMap.get(row.id) || null;
            const s1 = n5(row.horario_saida_1);
            const e2 = n5(row.horario_entrada_2);
            const s2 = n5(row.horario_saida_2);
            const e3 = n5(row.horario_entrada_3);

            // Fallback ALMOÇO: agora passou de S1 e não há registro de s1
            // v1.8: gatilho antecipado — dispara no S1 (não após E2), para que
            // calcularTempoEfetivo no frontend congele o timer imediatamente.
            if (s1 && e2 && !ponto?.horario_real_s1) {
                const s1Min = hhmmParaMin(s1);
                if (agoraMin !== null && s1Min !== null && agoraMin >= s1Min) {
                    safetyNetInserts.push(
                        dbClient.query(
                            `INSERT INTO ponto_diario (funcionario_id, data, horario_real_s1, horario_real_e2)
                             VALUES ($1, $2, $3, $4)
                             ON CONFLICT (funcionario_id, data) DO UPDATE SET
                                 horario_real_s1 = COALESCE(ponto_diario.horario_real_s1, EXCLUDED.horario_real_s1),
                                 horario_real_e2 = COALESCE(ponto_diario.horario_real_e2, EXCLUDED.horario_real_e2),
                                 updated_at = NOW()`,
                            [row.id, dataHojeSP, s1, e2]
                        )
                    );
                    // Atualiza em memória para refletir na resposta
                    if (!ponto) {
                        pontoDiarioMap.set(row.id, {
                            funcionario_id: row.id,
                            horario_real_s1: s1, horario_real_e2: e2,
                            horario_real_s2: null, horario_real_e3: null, horario_real_s3: null,
                            saida_desfeita: false, saida_desfeita_por: null, saida_desfeita_em: null,
                        });
                    } else {
                        ponto.horario_real_s1 = s1;
                        ponto.horario_real_e2 = e2;
                    }
                    console.log(`[SAFETY-NET] Almoço fallback func ${row.id} (${row.nome}): ${s1}→${e2} (agendado)`);
                }
            }

            // Fallback PAUSA: agora passou de S2 e não há registro de s2
            // v1.8: gatilho antecipado — dispara no S2 (não após E3).
            const pontoAtual = pontoDiarioMap.get(row.id) || null;
            if (s2 && e3 && !pontoAtual?.horario_real_s2) {
                const s2Min = hhmmParaMin(s2);
                if (agoraMin !== null && s2Min !== null && agoraMin >= s2Min) {
                    safetyNetInserts.push(
                        dbClient.query(
                            `INSERT INTO ponto_diario (funcionario_id, data, horario_real_s2, horario_real_e3)
                             VALUES ($1, $2, $3, $4)
                             ON CONFLICT (funcionario_id, data) DO UPDATE SET
                                 horario_real_s2 = COALESCE(ponto_diario.horario_real_s2, EXCLUDED.horario_real_s2),
                                 horario_real_e3 = COALESCE(ponto_diario.horario_real_e3, EXCLUDED.horario_real_e3),
                                 updated_at = NOW()`,
                            [row.id, dataHojeSP, s2, e3]
                        )
                    );
                    if (!pontoAtual) {
                        pontoDiarioMap.set(row.id, {
                            funcionario_id: row.id,
                            horario_real_s1: null, horario_real_e2: null,
                            horario_real_s2: s2, horario_real_e3: e3, horario_real_s3: null,
                            saida_desfeita: false, saida_desfeita_por: null, saida_desfeita_em: null,
                        });
                    } else {
                        pontoAtual.horario_real_s2 = s2;
                        pontoAtual.horario_real_e3 = e3;
                    }
                    console.log(`[SAFETY-NET] Pausa fallback func ${row.id} (${row.nome}): ${s2}→${e3} (agendado)`);
                }
            }
        }

        if (safetyNetInserts.length > 0) {
            // Não-fatal: se o safety net falhar, o restante da resposta ainda é válido.
            try {
                await Promise.all(safetyNetInserts);
            } catch (err) {
                console.error('[SAFETY-NET] Falha ao gravar fallback de ponto:', err);
            }
        }

        const resultadoFinal = result.rows.map(row => {
            const pontoDiario  = pontoDiarioMap.get(row.id)  || null;
            const sessoesHoje  = sessoesHojeMap.get(row.id)  || [];
            let statusCalculado = determinarStatusFinalServidor(row, pontoDiario);

            // Se tem tarefas no array, status é PRODUZINDO
            const tarefas = row.tarefas_ativas || [];
            const temTarefa = tarefas.length > 0;

            let statusFinal = statusCalculado;

            if (temTarefa) {
                statusFinal = 'PRODUZINDO';
            }

            // Pegamos a primeira tarefa como "principal" para compatibilidade com código antigo
            const tarefaPrincipal = temTarefa ? tarefas[0] : null;

            return {
                id: row.id,
                nome: row.nome,
                avatar_url: row.avatar_url && !row.avatar_url.includes('image.jfif') ? row.avatar_url : null,
                foto_oficial: row.foto_oficial,
                nivel: row.nivel,
                tipos: row.tipos,
                status_atual: statusFinal,
                // Horários de jornada (usados pelo OPStatusCard para indicadores de intervalo)
                horario_entrada_1: row.horario_entrada_1,
                horario_saida_1:   row.horario_saida_1,
                horario_entrada_2: row.horario_entrada_2,
                horario_saida_2:   row.horario_saida_2,
                horario_entrada_3: row.horario_entrada_3,
                horario_saida_3:   row.horario_saida_3,
                dias_trabalho:     row.dias_trabalho,
                // Ponto do dia (horários reais de intervalo — null quando não há registro)
                ponto_hoje: pontoDiario ? {
                    horario_real_s1:    pontoDiario.horario_real_s1,
                    horario_real_e2:    pontoDiario.horario_real_e2,
                    horario_real_s2:    pontoDiario.horario_real_s2,
                    horario_real_e3:    pontoDiario.horario_real_e3,
                    horario_real_s3:    pontoDiario.horario_real_s3,
                    saida_desfeita:     pontoDiario.saida_desfeita || false,
                    saida_desfeita_por: pontoDiario.saida_desfeita_por || null,
                    saida_desfeita_em:  pontoDiario.saida_desfeita_em || null,
                } : null,
                tarefa_atual: tarefaPrincipal,
                tarefas: tarefas,
                sessoes_hoje: sessoesHoje,
            };
        });

        const feriadoHoje = feriadoHojeResult.rows[0] || null;
        if (feriadoHoje) {
            const resultadoComFeriado = resultadoFinal.map(func =>
                func.status_atual === 'PRODUZINDO' || func.status_atual === 'LIVRE_MANUAL'
                    ? func
                    : { ...func, status_atual: 'FORA_DO_HORARIO' }
            );
            res.status(200).json({
                is_feriado_hoje: true,
                nome_feriado: feriadoHoje.descricao,
                funcionarios: resultadoComFeriado,
            });
        } else {
            res.status(200).json(resultadoFinal);
        }
    } catch (error) {
        console.error('[API /producao/status-funcionarios] Erro:', error);
        res.status(500).json({ error: 'Erro ao carregar status dos funcionários.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/producao/grupos-unificaveis — detecta etapas consecutivas unificáveis para um tipo de funcionário
router.get('/grupos-unificaveis', async (req, res) => {
    const { produto_id, tipo_funcionario } = req.query;
    if (!produto_id || !tipo_funcionario) {
        return res.status(400).json({ error: 'produto_id e tipo_funcionario são obrigatórios.' });
    }
    let dbClient;
    try {
        dbClient = await pool.connect();
        const prodRes = await dbClient.query('SELECT etapas FROM produtos WHERE id = $1', [produto_id]);
        const etapas = prodRes.rows[0]?.etapas || [];

        const grupos = [];
        let grupoAtual = null;

        for (let i = 0; i < etapas.length; i++) {
            const e = etapas[i];
            const feitoPor = typeof e === 'object' ? e.feitoPor : null;
            const processo = typeof e === 'object' ? e.processo : e;
            const maquina = typeof e === 'object' ? (e.maquina || null) : null;

            if (feitoPor === tipo_funcionario) {
                if (grupoAtual) {
                    grupoAtual.etapas.push({ etapa_index: i, processo, maquina, feitoPor });
                } else {
                    grupoAtual = {
                        grupo_id: `${produto_id}-${i}`,
                        etapas: [{ etapa_index: i, processo, maquina, feitoPor }],
                    };
                }
            } else {
                if (grupoAtual && grupoAtual.etapas.length >= 2) {
                    grupos.push({ ...grupoAtual, muda_maquina: grupoAtual.etapas.some((ep, j) => j > 0 && ep.maquina !== grupoAtual.etapas[j - 1].maquina) });
                }
                grupoAtual = null;
            }
        }
        if (grupoAtual && grupoAtual.etapas.length >= 2) {
            grupos.push({ ...grupoAtual, muda_maquina: grupoAtual.etapas.some((ep, j) => j > 0 && ep.maquina !== grupoAtual.etapas[j - 1].maquina) });
        }

        res.status(200).json(grupos);
    } catch (error) {
        console.error('[API GET /producao/grupos-unificaveis] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.get('/fila-de-tarefas', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        
        // 1. "Pegar as Prateleiras de Dados" - Buscamos tudo em paralelo
        const [opsResult, producoesResult, sessoesResult, produtosResult] = await Promise.all([
            // Prateleira 1: Todas as OPs ativas (FIFO: Ordenadas por número para consumir as antigas primeiro)
            dbClient.query(`SELECT numero, produto_id, variante, quantidade, etapas FROM ordens_de_producao WHERE status IN ('em-aberto', 'produzindo') ORDER BY numero ASC`),
            
            // Prateleira 2: Todos os lançamentos de produção já feitos
            dbClient.query(`SELECT op_numero, etapa_index, SUM(quantidade) as total_lancado FROM producoes GROUP BY op_numero, etapa_index`),
            
            // Prateleira 3: Sessões EM ANDAMENTO — inclui etapas_unificadas para abatimento correto
            dbClient.query(`
                SELECT produto_id, variante, processo, quantidade_atribuida, etapas_unificadas
                FROM sessoes_trabalho_producao
                WHERE status = 'EM_ANDAMENTO'
            `),
            
            // Prateleira 4: Produtos (com grade para buscar imagem da variante)
            dbClient.query(`SELECT id, nome, imagem, grade FROM produtos`)
        ]);

        // 2. Mapas de Acesso Rápido
        const lancamentosMap = new Map(producoesResult.rows.map(r => [`${r.op_numero}-${r.etapa_index}`, parseInt(r.total_lancado, 10)]));
        const produtosMap = new Map(produtosResult.rows.map(p => [p.id, p]));
        
        // Mapa de Trabalho Global: Chave "ProdID-Variante-Processo" -> Quantidade Total sendo feita na fábrica
        const emTrabalhoGlobalMap = new Map();
        sessoesResult.rows.forEach(r => {
            const qtd = parseInt(r.quantidade_atribuida, 10);
            const chave = `${r.produto_id}-${r.variante || '-'}-${r.processo}`;
            emTrabalhoGlobalMap.set(chave, (emTrabalhoGlobalMap.get(chave) || 0) + qtd);
            // Sessões unificadas: abater também os processos secundários da fila
            if (Array.isArray(r.etapas_unificadas)) {
                r.etapas_unificadas.forEach(eu => {
                    if (eu.processo !== r.processo) {
                        const chaveUnif = `${r.produto_id}-${r.variante || '-'}-${eu.processo}`;
                        emTrabalhoGlobalMap.set(chaveUnif, (emTrabalhoGlobalMap.get(chaveUnif) || 0) + qtd);
                    }
                });
            }
        });

        // 3. Processamento (Cozinha)
        const tarefasDisponiveis = [];

        for (const op of opsResult.rows) {
            if (!op.etapas || op.etapas.length === 0) continue;

            for (let i = 0; i < op.etapas.length; i++) {
                const etapaConfig = op.etapas[i];
                const processo = etapaConfig.processo || etapaConfig;
                const chaveLancamento = `${op.numero}-${i}`;

                // A. Quanto entrou nesta etapa? (Vindo da etapa anterior ou do corte inicial)
                let saldoEntrada = 0;
                if (i === 0) {
                    // Corte: Entra o total da OP
                    saldoEntrada = parseInt(op.quantidade, 10);
                } else {
                    // Outras: Entra o que foi finalizado na etapa anterior
                    const chaveLancamentoAnterior = `${op.numero}-${i - 1}`;
                    saldoEntrada = lancamentosMap.get(chaveLancamentoAnterior) || 0;
                }

                // B. Quanto já saiu desta etapa? (Já finalizado)
                const jaProduzidoNestaEtapa = lancamentosMap.get(chaveLancamento) || 0;

                // C. Saldo Líquido da OP (Disponível fisicamente, sem contar quem está trabalhando nela agora)
                let saldoLiquidoOP = Math.max(0, saldoEntrada - jaProduzidoNestaEtapa);

                // D. Abatimento Global (Waterfall Virtual)
                // Verifica se há gente trabalhando nisso na fábrica e desconta desta OP se tiver saldo.
                const chaveGlobal = `${op.produto_id}-${op.variante || '-'}-${processo}`;
                let emTrabalhoGlobal = emTrabalhoGlobalMap.get(chaveGlobal) || 0;

                // Se tem gente trabalhando, abate deste saldo
                const descontoTrabalho = Math.min(saldoLiquidoOP, emTrabalhoGlobal);
                
                // O Saldo Real é o que sobra
                const saldoRealDisponivel = saldoLiquidoOP - descontoTrabalho;

                // Atualiza o "Bolo Global" de trabalho para a próxima OP da fila
                // (Se descontamos 7 daqui, sobram 2 para descontar da próxima OP)
                if (descontoTrabalho > 0) {
                     emTrabalhoGlobalMap.set(chaveGlobal, emTrabalhoGlobal - descontoTrabalho);
                }
                
                // Se sobrou saldo real, adiciona na lista de tarefas
                if (saldoRealDisponivel > 0) {
                    const produtoInfo = produtosMap.get(op.produto_id);
                    // Busca imagem da variante no grade; fallback para imagem do produto
                    let imagemProduto = produtoInfo?.imagem || null;
                    if (op.variante && Array.isArray(produtoInfo?.grade)) {
                        const gradeItem = produtoInfo.grade.find(g => g.variacao === op.variante);
                        if (gradeItem?.imagem) imagemProduto = gradeItem.imagem;
                    }
                    tarefasDisponiveis.push({
                        produto_id: op.produto_id,
                        produto_nome: produtoInfo?.nome || 'Produto Desconhecido',
                        imagem_produto: imagemProduto,
                        variante: op.variante,
                        processo: processo,
                        quantidade_disponivel: saldoRealDisponivel,
                        origem_ops: [op.numero]
                    });
                }
            }
        }

        // 4. Agrupamento Final
        const filaAgrupada = tarefasDisponiveis.reduce((acc, tarefa) => {
            const chaveAgrupamento = `${tarefa.produto_id}-${tarefa.variante}-${tarefa.processo}`;
            if (!acc[chaveAgrupamento]) {
                acc[chaveAgrupamento] = { ...tarefa };
            } else {
                acc[chaveAgrupamento].quantidade_disponivel += tarefa.quantidade_disponivel;
                acc[chaveAgrupamento].origem_ops.push(...tarefa.origem_ops);
            }
            return acc;
        }, {});

        res.status(200).json(Object.values(filaAgrupada));

    } catch (error) {
        console.error('[API /producao/fila-de-tarefas V3] Erro:', error);
        res.status(500).json({ error: 'Erro ao montar a fila de tarefas de produção.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ROTA POST: Sugestão inteligente de tarefa para um funcionário
// Recebe a lista de candidatas já filtradas pelo frontend e devolve a melhor pontuada.
router.post('/sugestao-tarefa', async (req, res) => {
    const { funcionario_id, candidatas } = req.body;
    if (!funcionario_id || !Array.isArray(candidatas) || candidatas.length === 0) {
        return res.status(200).json({ sugestao: null, candidatas: [] });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();

        // 1. Histórico de especialidade: sessões deste funcionário por produto+processo (últimos 90 dias)
        // funcionario_id em sessoes_trabalho_producao é INTEGER — sem cast
        const historicoResult = await dbClient.query(`
            SELECT produto_id, processo, COUNT(*) AS contagem
            FROM sessoes_trabalho_producao
            WHERE funcionario_id = $1
              AND data_inicio > NOW() - INTERVAL '90 days'
            GROUP BY produto_id, processo
        `, [funcionario_id]);

        const historicoMap = new Map();
        historicoResult.rows.forEach(row => {
            historicoMap.set(`${row.produto_id}-${row.processo}`, parseInt(row.contagem));
        });

        // 2. Datas de abertura das OPs (data_entrega = data de criação, per CLAUDE.md)
        // numero em ordens_de_producao é character varying — cast ::text[]
        const todasOps = [...new Set(candidatas.flatMap(c => c.origem_ops || []).map(String))];
        const opDatesMap = new Map(); // chave = string do numero da OP

        if (todasOps.length > 0) {
            const opDatesResult = await dbClient.query(
                'SELECT numero, data_entrega FROM ordens_de_producao WHERE numero = ANY($1::text[])',
                [todasOps]
            );
            opDatesResult.rows.forEach(row => {
                opDatesMap.set(String(row.numero), new Date(row.data_entrega));
            });
        }

        const agora = new Date();

        // 3. Pontuar cada candidata
        const scoradas = candidatas.map(tarefa => {
            const chave = `${tarefa.produto_id}-${tarefa.processo}`;

            // Especialidade: normalizado 0–1 (10 sessões = especialista pleno)
            const sessoes = historicoMap.get(chave) || 0;
            const scoreEspecialidade = Math.min(sessoes / 10, 1.0);

            // Antiguidade: normalizado 0–1 (30+ dias = urgência máxima)
            // origem_ops pode conter números ou strings → normalizar para string antes de buscar no Map
            const datasOps = (tarefa.origem_ops || []).map(n => opDatesMap.get(String(n))).filter(Boolean);
            let scoreAntiguidade = 0;
            if (datasOps.length > 0) {
                const maisAntiga = new Date(Math.min(...datasOps.map(d => d.getTime())));
                const dias = (agora.getTime() - maisAntiga.getTime()) / (1000 * 60 * 60 * 24);
                scoreAntiguidade = Math.min(dias / 30, 1.0);
            }

            const scoreFinal = 0.60 * scoreEspecialidade + 0.40 * scoreAntiguidade;

            const motivos = [];
            if (scoreEspecialidade >= 0.5) motivos.push('especialista');
            if (scoreAntiguidade >= 0.5) motivos.push('urgente');

            return { ...tarefa, scoreFinal, scoreEspecialidade, scoreAntiguidade, motivos, sessoesHistorico: sessoes };
        });

        scoradas.sort((a, b) => b.scoreFinal - a.scoreFinal);
        const melhor = scoradas[0];
        const sugestao = (melhor && melhor.scoreFinal >= 0.30) ? melhor : null;

        res.status(200).json({ sugestao, candidatas: scoradas });

    } catch (error) {
        console.error('[API /producao/sugestao-tarefa] Erro:', error);
        res.status(500).json({ error: 'Erro ao calcular sugestão.', sugestao: null });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ROTA GET: Busca todos os tempos padrão salvos
router.get('/tempos-padrao', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        // Não precisa de permissão específica, pois é um dado de configuração geral
        // para quem já tem acesso à página.

        const result = await dbClient.query('SELECT produto_id, processo, tempo_segundos FROM tempos_padrao_producao');
        
        // Transforma o array em um objeto para fácil acesso no frontend
        // Ex: { "1-Fechamento": 30.00, "1-Finalização": 25.50 }
        const temposObjeto = result.rows.reduce((acc, row) => {
            const chave = `${row.produto_id}-${row.processo}`;
            acc[chave] = parseFloat(row.tempo_segundos);
            return acc;
        }, {});

        res.status(200).json(temposObjeto);

    } catch (error) {
        console.error('[API /producao/tempos-padrao GET] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar tempos padrão.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// ROTA POST: Salva ou atualiza os tempos padrão
router.post('/tempos-padrao', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        // Requer uma permissão específica para evitar que qualquer um altere os tempos
        if (!permissoes.includes('gerenciar-permissoes')) { // Usando uma permissão de admin/supervisor
            return res.status(403).json({ error: 'Permissão negada para configurar tempos padrão.' });
        }

        const tempos = req.body.tempos; // Espera um objeto como { "1-Fechamento": "30" }
        if (typeof tempos !== 'object' || tempos === null) {
            return res.status(400).json({ error: 'Formato de dados inválido.' });
        }

        await dbClient.query('BEGIN');

        for (const chave in tempos) {
            const [produto_id_str, ...processoParts] = chave.split('-');
            const processo = processoParts.join('-'); // Junta o resto, caso o processo tenha hífens
            const produto_id = parseInt(produto_id_str, 10);
            const tempo_segundos = parseFloat(tempos[chave]);

            if (!isNaN(produto_id) && processo && !isNaN(tempo_segundos) && tempo_segundos >= 0) {
                // ON CONFLICT (produto_id, processo) DO UPDATE -> Isso é um "UPSERT".
                // Se a combinação já existe, ele atualiza (UPDATE). Se não, ele insere (INSERT).
                await dbClient.query(`
                    INSERT INTO tempos_padrao_producao (produto_id, processo, tempo_segundos)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (produto_id, processo)
                    DO UPDATE SET tempo_segundos = EXCLUDED.tempo_segundos;
                `, [produto_id, processo, tempo_segundos]);
            }
        }

        await dbClient.query('COMMIT');

        res.status(200).json({ message: 'Tempos padrão salvos com sucesso!' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /producao/tempos-padrao POST] Erro:', error);
        res.status(500).json({ error: 'Erro ao salvar tempos padrão.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// ========= ROTA PARA CANCELAR UMA SESSÃO DE PRODUÇÃO =========
router.put('/sessoes/cancelar', async (req, res) => {
    const { usuarioLogado } = req;
    const { id_sessao } = req.body;
    let dbClient;

    if (!id_sessao) {
        return res.status(400).json({ error: 'ID da sessão é obrigatório.' });
    }

    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const sessaoResult = await dbClient.query('SELECT * FROM sessoes_trabalho_producao WHERE id = $1 FOR UPDATE', [id_sessao]);
        if (sessaoResult.rows.length === 0) throw new Error('Sessão de trabalho não encontrada.');
        const sessao = sessaoResult.rows[0];
        if (sessao.status !== 'EM_ANDAMENTO') throw new Error('Esta tarefa não está mais em andamento.');

        // Atualiza a sessão para CANCELADA
        await dbClient.query(`UPDATE sessoes_trabalho_producao SET status = 'CANCELADA', data_fim = NOW() WHERE id = $1`, [id_sessao]);

        // Verifica se há outras sessões em andamento para este funcionário
        const restantesResult = await dbClient.query(
            `SELECT id FROM sessoes_trabalho_producao
             WHERE funcionario_id = $1 AND status = 'EM_ANDAMENTO' AND id != $2
             ORDER BY id ASC LIMIT 1`,
            [sessao.funcionario_id, id_sessao]
        );

        if (restantesResult.rows.length > 0) {
            const proximaId = restantesResult.rows[0].id;
            // Reinicia o cronômetro da próxima tarefa a partir de agora
            await dbClient.query(
                `UPDATE sessoes_trabalho_producao SET data_inicio = NOW() WHERE id = $1`,
                [proximaId]
            );
            // Funcionário continua PRODUZINDO na próxima tarefa
            await dbClient.query(
                `UPDATE usuarios SET status_atual = 'PRODUZINDO', id_sessao_trabalho_atual = $1 WHERE id = $2`,
                [proximaId, sessao.funcionario_id]
            );
        } else {
            // Sem mais tarefas — libera o funcionário
            await dbClient.query(
                `UPDATE usuarios SET status_atual = 'LIVRE', id_sessao_trabalho_atual = NULL WHERE id = $1`,
                [sessao.funcionario_id]
            );
        }

        await dbClient.query('COMMIT');
        res.status(200).json({ message: 'Tarefa cancelada com sucesso!' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /producao/sessoes/cancelar PUT] Erro:', error);
        res.status(500).json({ error: 'Erro ao cancelar tarefa.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});


export default router;