// /api/real-producao.js

import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';
import { obterEmpresaIdDoContexto } from './contexto-empresa.js';

const router = express.Router();
const pool = new Pool({ connectionString: process.env.POSTGRES_URL, timezone: 'UTC' });
const SECRET_KEY = process.env.JWT_SECRET;

router.use(async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token ausente.' });
        req.usuarioLogado = jwt.verify(authHeader.split(' ')[1], SECRET_KEY);
        req.empresaId = obterEmpresaIdDoContexto(req);
        next();
    } catch {
        res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
});

// ==========================================================================
// GET /diaria — dados completos para o painel de produção geral
// ==========================================================================
router.get('/diaria', async (req, res) => {
    let dbClient;
    try {
        const dataQuery = req.query.data;
        const dataReferencia = dataQuery ? new Date(`${dataQuery}T12:00:00.000Z`) : new Date();
        const dataFiltroSQL = dataReferencia.toISOString().split('T')[0];

        const ontem = new Date(dataReferencia);
        ontem.setDate(ontem.getDate() - 1);
        const ontemSQL = ontem.toISOString().split('T')[0];

        // Limites para comparativo semanal (SP timezone via cálculo em JS)
        const dow = dataReferencia.getDay();
        const daysFromMon = dow === 0 ? 6 : dow - 1;
        const mondayDate = new Date(dataReferencia);
        mondayDate.setDate(dataReferencia.getDate() - daysFromMon);
        const mondayStr = mondayDate.toISOString().split('T')[0];

        const lastMondayDate = new Date(mondayDate);
        lastMondayDate.setDate(mondayDate.getDate() - 7);
        const lastMondayStr = lastMondayDate.toISOString().split('T')[0];

        const tomorrowDate = new Date(dataReferencia);
        tomorrowDate.setDate(dataReferencia.getDate() + 1);
        const tomorrowStr = tomorrowDate.toISOString().split('T')[0];

        // fim exclusivo da semana passada = mesmo dia da semana passada + 1
        const lastWeekEndDate = new Date(dataReferencia);
        lastWeekEndDate.setDate(dataReferencia.getDate() - 6);
        const lastWeekEndStr = lastWeekEndDate.toISOString().split('T')[0];

        dbClient = await pool.connect();

        // ── Último dia útil com produção antes de dataReferencia ──────────
        // Evita comparar com feriados, folgas ou fins de semana não trabalhados.
        // Olhamos até 14 dias atrás para cobrir semanas-ponte e feriados prolongados.
        // Cruza com calendario_empresa para garantir que o dia é realmente útil.
        const { rows: ultimoDiaRows } = await dbClient.query(`
            WITH dias_com_producao AS (
                SELECT DISTINCT (data AT TIME ZONE 'America/Sao_Paulo')::date AS d
                FROM producoes
                WHERE data AT TIME ZONE 'America/Sao_Paulo' <  $1::date
                  AND data AT TIME ZONE 'America/Sao_Paulo' >= ($1::date - INTERVAL '14 days')
                UNION
                SELECT DISTINCT (data_lancamento AT TIME ZONE 'America/Sao_Paulo')::date
                FROM arremates
                WHERE data_lancamento AT TIME ZONE 'America/Sao_Paulo' <  $1::date
                  AND data_lancamento AT TIME ZONE 'America/Sao_Paulo' >= ($1::date - INTERVAL '14 days')
                  AND tipo_lancamento = 'PRODUCAO'
            ),
            nao_uteis AS (
                SELECT data FROM calendario_empresa
                WHERE data >= ($1::date - INTERVAL '14 days')
                  AND data <  $1::date
                  AND empresa_id = $2
                  AND tipo IN ('feriado_nacional', 'feriado_regional', 'folga_empresa')
                  AND funcionario_id IS NULL
            ),
            trabalho_extra AS (
                SELECT data FROM calendario_empresa
                WHERE data >= ($1::date - INTERVAL '14 days')
                  AND data <  $1::date
                  AND empresa_id = $2
                  AND tipo = 'trabalho_extra'
                  AND funcionario_id IS NULL
            )
            SELECT MAX(d)::text AS ultimo_dia
            FROM dias_com_producao
            WHERE
                d NOT IN (SELECT data FROM nao_uteis)
                AND (
                    EXTRACT(DOW FROM d) NOT IN (0, 6)   -- seg–sex são úteis por padrão
                    OR d IN (SELECT data FROM trabalho_extra)  -- sáb/dom explicitamente trabalhados
                )
        `, [dataFiltroSQL, req.empresaId]);
        // Fallback para ontem caso não haja produção nos últimos 14 dias (sistema recém-iniciado)
        const ultimoDiaUtilSQL = ultimoDiaRows[0]?.ultimo_dia || ontemSQL;

        // ── Bulk fetch paralelo ────────────────────────────────────────────
        const [
            atividadesHoje,
            ontemPorFunc,
            ontemGlobal,
            usuariosAtivos,
            pontoDiario,
            versaoResult,
            historicoResult,
            semanalResult,
            diaUtilResult,
        ] = await Promise.all([

            // 1. Atividades detalhadas de hoje (costureiras + tiktiks)
            dbClient.query(`
                WITH producoes_dia AS (
                    SELECT p.funcionario_id,
                           u.nome AS nome_funcionario, u.avatar_url, u.foto_oficial,
                           ue.tipos AS tipo_funcionario, ue.nivel, ue.status_atual,
                           'processo'   AS tipo_atividade,
                           p.processo   AS nome_atividade,
                           prod.nome    AS nome_produto,
                           p.quantidade, p.pontos_gerados, p.data AS data_hora, p.variacao,
                           COALESCE(
                               (SELECT g.value->>'imagem' FROM jsonb_array_elements(prod.grade) g
                                WHERE g.value->>'variacao' = p.variacao LIMIT 1),
                               prod.imagem
                           ) AS imagem_url
                    FROM producoes p
                    JOIN usuarios u    ON p.funcionario_id = u.id
                    JOIN usuarios_empresas ue
                      ON ue.usuario_id = u.id
                     AND ue.empresa_id = $2
                     AND ue.ativo = TRUE
                    JOIN produtos prod ON p.produto_id     = prod.id
                    WHERE p.data AT TIME ZONE 'America/Sao_Paulo' >= $1::date
                      AND p.data AT TIME ZONE 'America/Sao_Paulo' <  ($1::date + INTERVAL '1 day')
                      AND ue.tipos && ARRAY['costureira','tiktik']
                      AND ue.data_admissao IS NOT NULL
                      AND ue.data_admissao::date <= $1::date
                      AND (ue.data_demissao IS NULL OR ue.data_demissao::date > $1::date)
                ),
                arremates_dia AS (
                    SELECT a.usuario_tiktik_id AS funcionario_id,
                           u.nome AS nome_funcionario, u.avatar_url, u.foto_oficial,
                           ue.tipos AS tipo_funcionario, ue.nivel, ue.status_atual,
                           'arremate'             AS tipo_atividade,
                           'Arremate'             AS nome_atividade,
                           prod.nome              AS nome_produto,
                           a.quantidade_arrematada AS quantidade, a.pontos_gerados,
                           a.data_lancamento AS data_hora, a.variante AS variacao,
                           COALESCE(
                               (SELECT g.value->>'imagem' FROM jsonb_array_elements(prod.grade) g
                                WHERE g.value->>'variacao' = a.variante LIMIT 1),
                               prod.imagem
                           ) AS imagem_url
                    FROM arremates a
                    JOIN usuarios u    ON a.usuario_tiktik_id = u.id
                    JOIN usuarios_empresas ue
                      ON ue.usuario_id = u.id
                     AND ue.empresa_id = $2
                     AND ue.ativo = TRUE
                    JOIN produtos prod ON a.produto_id        = prod.id
                    WHERE a.data_lancamento AT TIME ZONE 'America/Sao_Paulo' >= $1::date
                      AND a.data_lancamento AT TIME ZONE 'America/Sao_Paulo' <  ($1::date + INTERVAL '1 day')
                      AND a.tipo_lancamento = 'PRODUCAO'
                      AND ue.data_admissao IS NOT NULL
                      AND ue.data_admissao::date <= $1::date
                      AND (ue.data_demissao IS NULL OR ue.data_demissao::date > $1::date)
                ),
                pontos_extras_dia AS (
                    SELECT
                        pe.funcionario_id,
                        u.nome AS nome_funcionario, u.avatar_url, u.foto_oficial,
                        ue.tipos AS tipo_funcionario, ue.nivel, ue.status_atual,
                        'pontos_extra'  AS tipo_atividade,
                        'Pontos Extras' AS nome_atividade,
                        'Bônus'         AS nome_produto,
                        0::int          AS quantidade,
                        pe.pontos       AS pontos_gerados,
                        pe.data_lancamento AS data_hora,
                        NULL::text      AS variacao,
                        NULL::text      AS imagem_url
                    FROM pontos_extras pe
                    JOIN usuarios u ON u.id = pe.funcionario_id
                    JOIN usuarios_empresas ue
                      ON ue.usuario_id = u.id
                     AND ue.empresa_id = pe.empresa_id
                     AND ue.ativo = TRUE
                    WHERE pe.data_referencia = $1::date
                      AND pe.empresa_id = $2
                      AND pe.cancelado = FALSE
                      AND ue.data_admissao IS NOT NULL
                      AND ue.data_admissao::date <= $1::date
                      AND (ue.data_demissao IS NULL OR ue.data_demissao::date > $1::date)
                )
                SELECT * FROM producoes_dia
                UNION ALL SELECT * FROM arremates_dia
                UNION ALL SELECT * FROM pontos_extras_dia
                ORDER BY data_hora DESC
            `, [dataFiltroSQL, req.empresaId]),

            // 2. Totais do último dia útil com produção, por funcionário (badges individuais)
            dbClient.query(`
                SELECT funcionario_id,
                       SUM(quantidade)::int      AS pecas,
                       SUM(pontos_gerados)::float AS pontos
                FROM (
                    SELECT funcionario_id, quantidade, pontos_gerados
                    FROM producoes
                    WHERE data AT TIME ZONE 'America/Sao_Paulo' >= $1::date
                      AND data AT TIME ZONE 'America/Sao_Paulo' <  ($1::date + INTERVAL '1 day')
                    UNION ALL
                    SELECT usuario_tiktik_id, quantidade_arrematada, pontos_gerados
                    FROM arremates
                    WHERE data_lancamento AT TIME ZONE 'America/Sao_Paulo' >= $1::date
                      AND data_lancamento AT TIME ZONE 'America/Sao_Paulo' <  ($1::date + INTERVAL '1 day')
                      AND tipo_lancamento = 'PRODUCAO'
                ) t
                GROUP BY funcionario_id
            `, [ultimoDiaUtilSQL]),

            // 3. Totais globais do último dia útil com produção (KPI bar da equipe)
            dbClient.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN ue.tipos @> ARRAY['costureira'] THEN t.quantidade ELSE 0 END), 0)::int   AS pecas_costura,
                    COALESCE(SUM(CASE WHEN ue.tipos @> ARRAY['tiktik'] AND t.tipo_atividade = 'processo' THEN t.quantidade ELSE 0 END), 0)::int AS pecas_tiktik,
                    COALESCE(SUM(CASE WHEN t.tipo_atividade = 'arremate' THEN t.quantidade ELSE 0 END), 0)::int    AS arremates,
                    COALESCE(SUM(t.pontos_gerados), 0)::float AS pontos_total
                FROM (
                    SELECT funcionario_id, quantidade, pontos_gerados, 'processo' AS tipo_atividade
                    FROM producoes
                    WHERE data AT TIME ZONE 'America/Sao_Paulo' >= $1::date
                      AND data AT TIME ZONE 'America/Sao_Paulo' <  ($1::date + INTERVAL '1 day')
                    UNION ALL
                    SELECT usuario_tiktik_id, quantidade_arrematada, pontos_gerados, 'arremate' AS tipo_atividade
                    FROM arremates
                    WHERE data_lancamento AT TIME ZONE 'America/Sao_Paulo' >= $1::date
                      AND data_lancamento AT TIME ZONE 'America/Sao_Paulo' <  ($1::date + INTERVAL '1 day')
                      AND tipo_lancamento = 'PRODUCAO'
                ) t
                JOIN usuarios u ON t.funcionario_id = u.id
                JOIN usuarios_empresas ue
                  ON ue.usuario_id = u.id
                 AND ue.empresa_id = $2
                 AND ue.ativo = TRUE
            `, [ultimoDiaUtilSQL, req.empresaId]),

            // 4. Todos os usuários ativos costureira/tiktik (com vínculo RH ativo)
            dbClient.query(`
                SELECT u.id, u.nome, u.avatar_url, u.foto_oficial,
                       ue.nivel, ue.tipos, ue.status_atual
                FROM usuarios u
                JOIN usuarios_empresas ue
                  ON ue.usuario_id = u.id
                 AND ue.empresa_id = $1
                 AND ue.ativo = TRUE
                WHERE ue.tipos && ARRAY['costureira','tiktik']
                  AND ue.data_admissao IS NOT NULL
                  AND ue.data_demissao IS NULL
                  AND (is_test IS FALSE OR is_test IS NULL)
                  AND (u.arquivado IS FALSE OR u.arquivado IS NULL)
                ORDER BY u.nome
            `, [req.empresaId]),

            // 5. Ponto diário de hoje
            dbClient.query(`
                SELECT funcionario_id, horario_real_s1, horario_real_e2, horario_real_s2, horario_real_e3
                FROM ponto_diario
                WHERE data = $1::date
                  AND empresa_id = $2
            `, [dataFiltroSQL, req.empresaId]),

            // 6. Versão vigente das metas (só o id — regras buscadas depois)
            dbClient.query(`
                SELECT id FROM metas_versoes
                WHERE data_inicio_vigencia <= $1
                  AND empresa_id = $2
                ORDER BY data_inicio_vigencia DESC LIMIT 1
            `, [dataFiltroSQL, req.empresaId]),

            // 8. Média histórica: pontos por dia dos últimos 30 dias (exclui dias sem produção)
            dbClient.query(`
                SELECT
                    (data AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
                    SUM(pontos_gerados) AS pontos_dia
                FROM (
                    SELECT data, pontos_gerados
                    FROM producoes
                    WHERE data AT TIME ZONE 'America/Sao_Paulo' >= ($1::date - INTERVAL '30 days')
                      AND data AT TIME ZONE 'America/Sao_Paulo' <  $1::date
                    UNION ALL
                    SELECT data_lancamento, pontos_gerados
                    FROM arremates
                    WHERE data_lancamento AT TIME ZONE 'America/Sao_Paulo' >= ($1::date - INTERVAL '30 days')
                      AND data_lancamento AT TIME ZONE 'America/Sao_Paulo' <  $1::date
                      AND tipo_lancamento = 'PRODUCAO'
                ) t
                GROUP BY (data AT TIME ZONE 'America/Sao_Paulo')::date
                HAVING SUM(pontos_gerados) > 0
            `, [dataFiltroSQL]),

            // 7. Comparativo semanal
            //    atual:   Mon desta semana → fim de hoje
            //    passada: Mon semana passada → fim do mesmo dia da semana passada
            dbClient.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN t.ts AT TIME ZONE 'America/Sao_Paulo' >= $1::timestamp
                                       AND t.ts AT TIME ZONE 'America/Sao_Paulo' <  $2::timestamp
                                  THEN t.quantidade    END), 0)::int   AS semana_atual_pecas,
                    COALESCE(SUM(CASE WHEN t.ts AT TIME ZONE 'America/Sao_Paulo' >= $1::timestamp
                                       AND t.ts AT TIME ZONE 'America/Sao_Paulo' <  $2::timestamp
                                  THEN t.pontos_gerados END), 0)::float AS semana_atual_pontos,
                    COALESCE(SUM(CASE WHEN t.ts AT TIME ZONE 'America/Sao_Paulo' >= $3::timestamp
                                       AND t.ts AT TIME ZONE 'America/Sao_Paulo' <  $4::timestamp
                                  THEN t.quantidade    END), 0)::int   AS semana_passada_pecas,
                    COALESCE(SUM(CASE WHEN t.ts AT TIME ZONE 'America/Sao_Paulo' >= $3::timestamp
                                       AND t.ts AT TIME ZONE 'America/Sao_Paulo' <  $4::timestamp
                                  THEN t.pontos_gerados END), 0)::float AS semana_passada_pontos
                FROM (
                    SELECT data AS ts, quantidade, pontos_gerados
                    FROM producoes
                    WHERE data AT TIME ZONE 'America/Sao_Paulo' >= $3::timestamp
                      AND data AT TIME ZONE 'America/Sao_Paulo' <  $2::timestamp
                    UNION ALL
                    SELECT data_lancamento, quantidade_arrematada, pontos_gerados
                    FROM arremates
                    WHERE data_lancamento AT TIME ZONE 'America/Sao_Paulo' >= $3::timestamp
                      AND data_lancamento AT TIME ZONE 'America/Sao_Paulo' <  $2::timestamp
                      AND tipo_lancamento = 'PRODUCAO'
                ) t
            `, [mondayStr, tomorrowStr, lastMondayStr, lastWeekEndStr]),

            // 9. Verifica se o dia de referência é útil (feriado / folga / trabalho_extra)
            //    Filtra apenas eventos gerais (funcionario_id IS NULL).
            //    trabalho_extra tem prioridade sobre feriado/folga (ORDER BY caso).
            dbClient.query(`
                SELECT tipo, descricao
                FROM calendario_empresa
                WHERE data = $1::date
                  AND empresa_id = $2
                  AND tipo IN ('feriado_nacional', 'feriado_regional', 'folga_empresa', 'trabalho_extra')
                  AND funcionario_id IS NULL
                ORDER BY CASE tipo WHEN 'trabalho_extra' THEN 0 ELSE 1 END ASC
                LIMIT 1
            `, [dataFiltroSQL, req.empresaId]),
        ]);

        // ── Média histórica 30 dias ────────────────────────────────────────
        const diasHistorico = historicoResult.rows;
        const mediaDiaria30d = diasHistorico.length > 0
            ? diasHistorico.reduce((s, r) => s + parseFloat(r.pontos_dia), 0) / diasHistorico.length
            : 0;

        // ── Dia útil ou não? ───────────────────────────────────────────────
        const eventoCal = diaUtilResult.rows[0] || null;
        const dowRef    = dataReferencia.getDay(); // 0=Dom, 6=Sáb
        let diaUtil       = true;
        let motivoNaoUtil = null;

        if (eventoCal?.tipo === 'trabalho_extra') {
            // Marcado explicitamente como dia trabalhado — mesmo que seja fim de semana
            diaUtil       = true;
            motivoNaoUtil = null;
        } else if (eventoCal?.tipo === 'feriado_nacional') {
            diaUtil       = false;
            motivoNaoUtil = eventoCal.descricao || 'Feriado nacional';
        } else if (eventoCal?.tipo === 'feriado_regional') {
            diaUtil       = false;
            motivoNaoUtil = eventoCal.descricao || 'Feriado regional';
        } else if (eventoCal?.tipo === 'folga_empresa') {
            diaUtil       = false;
            motivoNaoUtil = eventoCal.descricao || 'Folga da empresa';
        } else if (dowRef === 0) {
            diaUtil       = false;
            motivoNaoUtil = 'Domingo';
        } else if (dowRef === 6) {
            diaUtil       = false;
            motivoNaoUtil = 'Sábado';
        }

        // ── Regras de metas (sequencial — depende do id da versão) ────────
        let metasBruto = [];
        if (versaoResult.rows.length > 0) {
            const { rows } = await dbClient.query(`
                SELECT tipo_usuario, nivel, pontos_meta, valor_comissao, descricao_meta
                FROM metas_regras
                WHERE id_versao = $1
                  AND empresa_id = $2
                ORDER BY tipo_usuario, nivel, pontos_meta ASC
            `, [versaoResult.rows[0].id, req.empresaId]);
            metasBruto = rows;
        }

        // ── Construir mapas ────────────────────────────────────────────────

        // metasDiarias: menor threshold (bronze) por tipo+nivel
        // todasMetas: todos os thresholds por tipo+nivel (para chips no modal)
        const metasDiarias = {};
        const todasMetas = {};
        for (const r of metasBruto) {
            const tipo  = r.tipo_usuario.toLowerCase().trim();
            const nivel = r.nivel;
            const pts   = parseInt(r.pontos_meta, 10);
            if (!metasDiarias[tipo])           metasDiarias[tipo] = {};
            if (!metasDiarias[tipo][nivel])    metasDiarias[tipo][nivel] = pts; // primeiro = mínimo (ORDER ASC)
            if (!todasMetas[tipo])             todasMetas[tipo] = {};
            if (!todasMetas[tipo][nivel])      todasMetas[tipo][nivel] = [];
            todasMetas[tipo][nivel].push(pts);
        }

        const ontemFuncMap = new Map(
            ontemPorFunc.rows.map(r => [r.funcionario_id, { pecas: r.pecas || 0, pontos: parseFloat(r.pontos) || 0 }])
        );

        const pontoMap = new Map(
            pontoDiario.rows.map(r => [r.funcionario_id, {
                horario_real_s1: r.horario_real_s1,
                horario_real_e2: r.horario_real_e2,
                horario_real_s2: r.horario_real_s2,
                horario_real_e3: r.horario_real_e3,
            }])
        );

        const usuariosMap = new Map(usuariosAtivos.rows.map(u => [u.id, u]));

        // ── Agregar atividades de hoje por funcionário ─────────────────────
        let pecasCosturaHoje = 0, pecasTiktikHoje = 0, arrematesTotaisHoje = 0, pontosTotalHoje = 0;
        const funcAggMap = new Map();

        for (const a of atividadesHoje.rows) {
            const fid = a.funcionario_id;
            if (!funcAggMap.has(fid)) {
                funcAggMap.set(fid, {
                    id: fid,
                    nome: a.nome_funcionario,
                    avatar_url: a.avatar_url,
                    foto_oficial: a.foto_oficial,
                    nivel: a.nivel,
                    tipos: a.tipo_funcionario,
                    status_atual: a.status_atual,
                    pecas_hoje: 0,
                    pontos_hoje: 0,
                    primeiro_lancamento: a.data_hora,
                    ultimo_lancamento:   a.data_hora,
                });
            }
            const f   = funcAggMap.get(fid);
            const qtd = parseInt(a.quantidade, 10);
            const pts = parseFloat(a.pontos_gerados);
            f.pecas_hoje   += qtd;
            f.pontos_hoje  += pts;
            if (new Date(a.data_hora) < new Date(f.primeiro_lancamento)) f.primeiro_lancamento = a.data_hora;
            if (new Date(a.data_hora) > new Date(f.ultimo_lancamento))   f.ultimo_lancamento   = a.data_hora;

            const tipos = Array.isArray(a.tipo_funcionario) ? a.tipo_funcionario : [];
            if (tipos.includes('costureira'))                               pecasCosturaHoje    += qtd;
            if (tipos.includes('tiktik') && a.tipo_atividade === 'processo') pecasTiktikHoje   += qtd;
            if (a.tipo_atividade === 'arremate')                            arrematesTotaisHoje += qtd;
            pontosTotalHoje += pts;
        }

        // ── Construir funcionarios[] ────────────────────────────────────────
        const funcionarios = [];
        for (const [fid, f] of funcAggMap) {
            const tipos       = Array.isArray(f.tipos) ? f.tipos : [];
            const tipoPrimario = tipos[0]?.toLowerCase() || 'costureira';
            const metaRef     = metasDiarias[tipoPrimario]?.[f.nivel] || 0;
            const pctMeta     = metaRef > 0 ? (f.pontos_hoje / metaRef) * 100 : 0;
            const ontemF      = ontemFuncMap.get(fid) || { pecas: 0, pontos: 0 };
            const uAtivo      = usuariosMap.get(fid);

            funcionarios.push({
                id:           fid,
                nome:         f.nome,
                avatar_url:   f.avatar_url,
                foto_oficial: f.foto_oficial,
                nivel:        f.nivel,
                tipos:        f.tipos,
                status_atual: uAtivo?.status_atual ?? f.status_atual,
                pecas_hoje:   f.pecas_hoje,
                pontos_hoje:  parseFloat(f.pontos_hoje.toFixed(2)),
                meta_pontos:  metaRef,
                pct_meta:     parseFloat(pctMeta.toFixed(1)),
                primeiro_lancamento: f.primeiro_lancamento,
                ultimo_lancamento:   f.ultimo_lancamento,
                pontos_ontem: ontemF.pontos,
                pecas_ontem:  ontemF.pecas,
                ponto_hoje:   pontoMap.get(fid) || null,
            });
        }

        funcionarios.sort((a, b) => b.pontos_hoje - a.pontos_hoje);

        // Todos os funcionários ativos (com ou sem produção hoje) — para o modal de pontos extras
        const funcPontosMap = new Map(funcionarios.map(f => [f.id, f.pontos_hoje]));
        const todosAtivos = usuariosAtivos.rows.map(u => ({
            id:          u.id,
            nome:        u.nome,
            avatar_url:  u.avatar_url,
            foto_oficial:u.foto_oficial,
            nivel:       u.nivel,
            tipos:       u.tipos,
            pontos_hoje: funcPontosMap.get(u.id) || 0,
        }));

        const og     = ontemGlobal.rows[0] || {};
        const semana = semanalResult.rows[0] || {};

        const tiktikTotalOntem  = (parseInt(og.pecas_tiktik || 0)) + (parseInt(og.arremates || 0));
        const producaoTotalOntem = (parseInt(og.pecas_costura || 0)) + tiktikTotalOntem;

        res.status(200).json({
            dataReferencia: dataFiltroSQL,

            equipeHoje: {
                pecasCostura:         pecasCosturaHoje,
                pecasTiktik:          pecasTiktikHoje,
                arremates:            arrematesTotaisHoje,
                producaoTiktikTotal:  pecasTiktikHoje + arrematesTotaisHoje,
                producaoTotal:        pecasCosturaHoje + pecasTiktikHoje + arrematesTotaisHoje,
                pontosTotal:          parseFloat(pontosTotalHoje.toFixed(1)),
                funcionariosAtivos:   funcAggMap.size,
            },

            equipeOntem: {
                pecasCostura:        parseInt(og.pecas_costura || 0),
                pecasTiktik:         parseInt(og.pecas_tiktik  || 0),
                arremates:           parseInt(og.arremates      || 0),
                producaoTiktikTotal: tiktikTotalOntem,
                producaoTotal:       producaoTotalOntem,
                pontosTotal:         parseFloat(og.pontos_total || 0),
            },

            comparativoSemana: {
                semanaAtualPecas:    parseInt(semana.semana_atual_pecas    || 0),
                semanaPassadaPecas:  parseInt(semana.semana_passada_pecas  || 0),
                semanaAtualPontos:   parseFloat(semana.semana_atual_pontos  || 0),
                semanaPassadaPontos: parseFloat(semana.semana_passada_pontos || 0),
            },

            funcionarios,

            atividades: atividadesHoje.rows.map(a => ({
                funcionario_id:  a.funcionario_id,
                nome_funcionario: a.nome_funcionario,
                tipo_atividade:  a.tipo_atividade,
                nome_produto:    a.nome_produto,
                processo:        a.nome_atividade,
                quantidade:      parseInt(a.quantidade, 10),
                pontos_gerados:  parseFloat(a.pontos_gerados),
                data_hora:       a.data_hora,
                variacao:        a.variacao,
                imagem_url:      a.imagem_url,
            })),

            metasDiarias,
            todasMetas,
            mediaDiaria30d: parseFloat(mediaDiaria30d.toFixed(1)),
            todosAtivos,
            diaUtil,
            motivoNaoUtil,
            diaAnteriorRef: ultimoDiaUtilSQL, // data efetivamente usada na comparação "vs. ontem"
        });

    } catch (error) {
        console.error('[API /real-producao/diaria] Erro:', error.message, error.stack);
        res.status(500).json({ error: 'Erro interno do servidor ao buscar dados da produção.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ==========================================================================
// GET /desempenho-historico — média PPH dos últimos 7 dias de um funcionário
// ==========================================================================
router.get('/desempenho-historico', async (req, res) => {
    let dbClient;
    try {
        const { funcionarioId } = req.query;
        if (!funcionarioId) return res.status(400).json({ error: 'funcionarioId obrigatório.' });

        dbClient = await pool.connect();

        const vinculoResult = await dbClient.query(`
            SELECT 1
            FROM usuarios_empresas
            WHERE usuario_id = $1
              AND empresa_id = $2
              AND ativo = TRUE
        `, [funcionarioId, req.empresaId]);
        if (vinculoResult.rowCount === 0) {
            return res.status(404).json({ error: 'Funcionário não encontrado nesta empresa.' });
        }

        const { rows } = await dbClient.query(`
            WITH atividades AS (
                SELECT data AS ts, pontos_gerados FROM producoes
                WHERE funcionario_id = $1 AND data >= NOW() - INTERVAL '7 days'
                UNION ALL
                SELECT data_lancamento, pontos_gerados FROM arremates
                WHERE usuario_tiktik_id = $1 AND data_lancamento >= NOW() - INTERVAL '7 days'
            ),
            por_dia AS (
                SELECT
                    ts::date AS dia,
                    SUM(pontos_gerados) AS total_pts,
                    EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts))) / 3600.0 AS horas
                FROM atividades GROUP BY dia
            )
            SELECT AVG(CASE WHEN horas > 0.1 THEN total_pts / horas END) AS media_pph
            FROM por_dia
        `, [funcionarioId]);

        res.status(200).json({
            funcionarioId,
            mediaPphHistorica: rows[0]?.media_pph ? parseFloat(rows[0].media_pph) : null,
        });

    } catch (error) {
        console.error('[API /desempenho-historico] Erro:', error.message);
        res.status(500).json({ error: 'Erro interno ao buscar desempenho histórico.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
