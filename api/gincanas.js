// api/gincanas.js
import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';

const { Pool } = pg;
const router = express.Router();
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const SECRET_KEY = process.env.JWT_SECRET;

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
router.use((req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) throw new Error('Token não fornecido');
        const token = authHeader.split(' ')[1];
        req.usuarioLogado = jwt.verify(token, SECRET_KEY);
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
});

// ---------------------------------------------------------------------------
// Helpers — fase calculada em runtime
// ---------------------------------------------------------------------------

function calcularSemanaAtual(gincana, agora) {
    const campanhaInicio = new Date(gincana.datetime_inicio);
    const horaInicio = gincana.hora_inicio_semana || '07:00';
    const horaFim    = gincana.hora_fim_semana    || '18:00';

    const agoraSP = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const diaSemana = agoraSP.getDay();
    const diasAteSeg = diaSemana === 0 ? -6 : 1 - diaSemana;

    const inicioSemanaLocal = new Date(agoraSP);
    inicioSemanaLocal.setDate(agoraSP.getDate() + diasAteSeg);
    inicioSemanaLocal.setHours(...horaInicio.split(':').map(Number), 0, 0);

    const fimSemanaLocal = new Date(inicioSemanaLocal);
    fimSemanaLocal.setDate(inicioSemanaLocal.getDate() + 4);
    fimSemanaLocal.setHours(...horaFim.split(':').map(Number), 0, 0);

    const msDesdeInicio = inicioSemanaLocal - campanhaInicio;
    const numeroSemana = Math.max(1, Math.ceil(msDesdeInicio / (7 * 24 * 3600 * 1000)));

    // Segunda-feira da semana para usar como semana_ref
    const semanaRef = new Date(inicioSemanaLocal);
    semanaRef.setHours(0, 0, 0, 0);
    const semanaRefStr = semanaRef.toISOString().split('T')[0];

    return { inicioSemana: inicioSemanaLocal, fimSemana: fimSemanaLocal, numeroSemana, semanaRef: semanaRefStr };
}

function calcularFase(gincana) {
    const agora = new Date();
    const inicio = new Date(gincana.datetime_inicio);
    const fim    = new Date(gincana.datetime_fim);

    if (gincana.tipo_recorrencia === 'unica') {
        // Corrida encerrada com ganhador fica como 'encerrada' imediatamente
        if (gincana.encerrada_com_ganhador) {
            return {
                fase: 'encerrada',
                segundos_para_inicio: null,
                segundos_para_fim: null,
                semana_label: null,
                janela_inicio: inicio,
                janela_fim: fim,
                semana_ref: null,
            };
        }

        if (agora < inicio) {
            return {
                fase: 'proxima',
                segundos_para_inicio: Math.floor((inicio - agora) / 1000),
                segundos_para_fim: null,
                semana_label: null,
                janela_inicio: inicio,
                janela_fim: fim,
                semana_ref: null,
            };
        }
        if (agora <= fim) {
            return {
                fase: 'ao_vivo',
                segundos_para_inicio: null,
                segundos_para_fim: Math.floor((fim - agora) / 1000),
                semana_label: null,
                janela_inicio: inicio,
                janela_fim: fim,
                semana_ref: null,
            };
        }
        const horas48depois = new Date(fim.getTime() + 48 * 3600 * 1000);
        return {
            fase: agora < horas48depois ? 'encerrada' : 'arquivada',
            segundos_para_inicio: null,
            segundos_para_fim: null,
            semana_label: null,
            janela_inicio: inicio,
            janela_fim: fim,
            semana_ref: null,
        };
    }

    // Semanal
    if (agora < inicio) {
        return {
            fase: 'proxima',
            segundos_para_inicio: Math.floor((inicio - agora) / 1000),
            segundos_para_fim: null,
            semana_label: null,
            janela_inicio: inicio,
            janela_fim: fim,
            semana_ref: null,
        };
    }
    if (agora > fim) {
        const horas48depois = new Date(fim.getTime() + 48 * 3600 * 1000);
        return {
            fase: agora < horas48depois ? 'encerrada' : 'arquivada',
            segundos_para_inicio: null,
            segundos_para_fim: null,
            semana_label: null,
            janela_inicio: inicio,
            janela_fim: fim,
            semana_ref: null,
        };
    }

    const { inicioSemana, fimSemana, numeroSemana, semanaRef } = calcularSemanaAtual(gincana, agora);

    if (agora < inicioSemana) {
        return {
            fase: 'proxima',
            segundos_para_inicio: Math.floor((inicioSemana - agora) / 1000),
            segundos_para_fim: null,
            semana_label: `Semana ${numeroSemana}`,
            janela_inicio: inicioSemana,
            janela_fim: fimSemana,
            semana_ref: semanaRef,
        };
    }
    if (agora <= fimSemana) {
        return {
            fase: 'ao_vivo',
            segundos_para_inicio: null,
            segundos_para_fim: Math.floor((fimSemana - agora) / 1000),
            semana_label: `Semana ${numeroSemana} (ao vivo)`,
            janela_inicio: inicioSemana,
            janela_fim: fimSemana,
            semana_ref: semanaRef,
        };
    }
    const horas48depois = new Date(fimSemana.getTime() + 48 * 3600 * 1000);
    return {
        fase: agora < horas48depois ? 'encerrada_semana' : 'proxima',
        segundos_para_inicio: null,
        segundos_para_fim: null,
        semana_label: `Semana ${numeroSemana} encerrada`,
        janela_inicio: inicioSemana,
        janela_fim: fimSemana,
        semana_ref: semanaRef,
    };
}

// Calcula o valor do usuário na janela (pontos ou unidades físicas conforme escopo)
async function calcularProgressoIndividual(dbClient, userId, escopo, janelaInicio, janelaFim, produtoId = null) {
    if (escopo === 'produto_especifico') {
        if (!produtoId) return 0;
        const res = await dbClient.query(
            `SELECT COALESCE(SUM(quantidade), 0) AS valor
             FROM producoes
             WHERE funcionario_id = $1
               AND data BETWEEN $2 AND $3
               AND produto_id = $4`,
            [userId, janelaInicio, janelaFim, produtoId]
        );
        return parseFloat(res.rows[0].valor);
    }

    let pontos = 0;

    if (escopo === 'tudo' || escopo === 'apenas_processos_op') {
        const res = await dbClient.query(
            `SELECT COALESCE(SUM(pontos_gerados), 0) AS valor
             FROM producoes
             WHERE funcionario_id = $1
               AND data BETWEEN $2 AND $3`,
            [userId, janelaInicio, janelaFim]
        );
        pontos += parseFloat(res.rows[0].valor);
    }

    if (escopo === 'tudo' || escopo === 'apenas_arremates') {
        const res = await dbClient.query(
            `SELECT COALESCE(SUM(pontos_gerados), 0) AS valor
             FROM arremates
             WHERE usuario_tiktik_id = $1
               AND data_lancamento BETWEEN $2 AND $3
               AND tipo_lancamento = 'PRODUCAO'`,
            [userId, janelaInicio, janelaFim]
        );
        pontos += parseFloat(res.rows[0].valor);
    }

    return Math.round(pontos * 100) / 100;
}

// Ranking completo — suporta produto_especifico além dos escopos de pontos
async function calcularRankingBulk(dbClient, participantes, escopo, janelaInicio, janelaFim, produtoId = null) {
    let tipoFiltro;
    if (participantes === 'costureiras') tipoFiltro = `'costureira' = ANY(u.tipos)`;
    else if (participantes === 'tiktiks') tipoFiltro = `'tiktik' = ANY(u.tipos)`;
    else tipoFiltro = `('costureira' = ANY(u.tipos) OR 'tiktik' = ANY(u.tipos))`;

    let query, params;

    if (escopo === 'produto_especifico') {
        query = `
            SELECT
                u.id   AS usuario_id,
                u.nome,
                COALESCE((
                    SELECT SUM(p.quantidade)
                    FROM producoes p
                    WHERE p.funcionario_id = u.id
                      AND p.data BETWEEN $1 AND $2
                      AND p.produto_id = $3
                ), 0) AS valor
            FROM usuarios u
            WHERE ${tipoFiltro}
              AND (u.is_test IS FALSE OR u.is_test IS NULL)
              AND NOT ('prestador_externo' = ANY(u.tipos))
              AND u.data_demissao IS NULL
        `;
        params = [janelaInicio, janelaFim, produtoId];
    } else {
        const producoesSub = (escopo === 'tudo' || escopo === 'apenas_processos_op')
            ? `COALESCE((
                   SELECT SUM(p.pontos_gerados)
                   FROM producoes p
                   WHERE p.funcionario_id = u.id
                     AND p.data BETWEEN $1 AND $2
               ), 0)`
            : `0`;

        const arrematesSub = (escopo === 'tudo' || escopo === 'apenas_arremates')
            ? `COALESCE((
                   SELECT SUM(a.pontos_gerados)
                   FROM arremates a
                   WHERE a.usuario_tiktik_id = u.id
                     AND a.data_lancamento BETWEEN $1 AND $2
                     AND a.tipo_lancamento = 'PRODUCAO'
               ), 0)`
            : `0`;

        query = `
            SELECT
                u.id   AS usuario_id,
                u.nome,
                (${producoesSub} + ${arrematesSub}) AS valor
            FROM usuarios u
            WHERE ${tipoFiltro}
              AND (u.is_test IS FALSE OR u.is_test IS NULL)
              AND NOT ('prestador_externo' = ANY(u.tipos))
              AND u.data_demissao IS NULL
        `;
        params = [janelaInicio, janelaFim];
    }

    const res = await dbClient.query(query, params);
    return res.rows
        .map(r => ({ ...r, valor: parseFloat(r.valor) }))
        .sort((a, b) => b.valor - a.valor);
}

function calcularNivelGanho(premiacoes, valor) {
    const ordenadas = [...premiacoes].sort((a, b) =>
        parseFloat(a.meta_valor) - parseFloat(b.meta_valor)
    );
    let nivelGanho = null;
    let proximaMeta = null;

    for (const p of ordenadas) {
        if (valor >= parseFloat(p.meta_valor)) {
            nivelGanho = p;
        } else if (!proximaMeta) {
            proximaMeta = p;
        }
    }
    return { nivelGanho, proximaMeta };
}

// Tenta registrar vencedor de corrida atomicamente — retorna true se ganhou, false se alguém ganhou antes
async function tentarRegistrarVencedorCorrida(dbClient, gincanaId, userId, premiacoes, semanaRef, ganhoEm = null) {
    const melhorPremiacao = premiacoes.length > 0
        ? [...premiacoes].sort((a, b) => parseFloat(b.meta_valor) - parseFloat(a.meta_valor))[0]
        : null;
    if (!melhorPremiacao) return false;

    const lockRes = await dbClient.query(
        `UPDATE gincanas
         SET vencedor_id = $1, encerrada_com_ganhador = TRUE, atualizado_em = NOW()
         WHERE id = $2 AND encerrada_com_ganhador = FALSE
         RETURNING id`,
        [userId, gincanaId]
    );

    if (!lockRes.rows.length) return false;

    await dbClient.query(
        `INSERT INTO gincanas_premios_ganhos
             (gincana_id, usuario_id, nivel_label, descricao_premio, semana_ref, ganho_em)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
         ON CONFLICT DO NOTHING`,
        [gincanaId, userId, melhorPremiacao.nivel_label, melhorPremiacao.descricao_premio, semanaRef || null, ganhoEm || null]
    );

    return true;
}

// Recupera vencedor de corrida que encerrou sem detecção em tempo real (post-mortem)
async function recuperarVencedorCorridaPostMortem(dbClient, gincana, premiacoes, janelaInicio, janelaFim) {
    if (!premiacoes.length) return;
    const metaValor = parseFloat(premiacoes[0].meta_valor);
    if (!metaValor) return;

    const ranking = await calcularRankingBulk(
        dbClient, gincana.participantes, gincana.escopo_atividade, janelaInicio, janelaFim, gincana.produto_id
    );
    const candidatos = ranking.filter(r => r.valor >= metaValor);
    if (!candidatos.length) return;

    const candidato = candidatos[0]; // maior valor = proxy do vencedor

    // Encontrar timestamp exato do cruzamento em producoes
    let ganhoEm = janelaFim;
    try {
        const col = gincana.escopo_atividade === 'produto_especifico' ? 'quantidade' : 'pontos_gerados';
        const params = gincana.escopo_atividade === 'produto_especifico'
            ? [candidato.usuario_id, janelaInicio, janelaFim, gincana.produto_id]
            : [candidato.usuario_id, janelaInicio, janelaFim];
        const extra = gincana.escopo_atividade === 'produto_especifico' ? 'AND produto_id = $4' : '';
        const prodsRes = await dbClient.query(
            `SELECT ${col} AS val, data FROM producoes
             WHERE funcionario_id = $1 AND data BETWEEN $2 AND $3 ${extra}
             ORDER BY data ASC`,
            params
        );
        let acum = 0;
        for (const p of prodsRes.rows) {
            acum += parseFloat(p.val);
            if (acum >= metaValor) { ganhoEm = p.data; break; }
        }
    } catch (_) {}

    await dbClient.query('BEGIN');
    try {
        await tentarRegistrarVencedorCorrida(dbClient, gincana.id, candidato.usuario_id, premiacoes, null, ganhoEm);
        await dbClient.query('COMMIT');
    } catch (e) {
        await dbClient.query('ROLLBACK');
    }
}

// Registra todos os vencedores de uma gincana tipo 'meta' encerrada
async function registrarVencedoresMeta(dbClient, gincanaId, ranking, premiacoes, semanaRef) {
    for (const r of ranking) {
        const { nivelGanho } = calcularNivelGanho(premiacoes, r.valor);
        if (!nivelGanho) continue;

        await dbClient.query(
            `INSERT INTO gincanas_premios_ganhos
                 (gincana_id, usuario_id, nivel_label, descricao_premio, semana_ref)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [gincanaId, r.usuario_id, nivelGanho.nivel_label, nivelGanho.descricao_premio, semanaRef || null]
        );
    }
}

// ---------------------------------------------------------------------------
// GET /api/gincanas — lista admin
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
    const { filtro = 'ativas' } = req.query;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        if (!permissoes.includes('acesso-ponto-por-processo')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const result = await dbClient.query(
            `SELECT g.*,
                    pr.nome AS produto_nome,
                    array_agg(
                        json_build_object(
                            'id', gp.id,
                            'nivel_label', gp.nivel_label,
                            'emoji_icone', gp.emoji_icone,
                            'meta_valor', gp.meta_valor,
                            'descricao_premio', gp.descricao_premio,
                            'valor_premio_reais', gp.valor_premio_reais,
                            'ordem', gp.ordem
                        ) ORDER BY gp.ordem, gp.meta_valor
                    ) FILTER (WHERE gp.id IS NOT NULL) AS premiacoes
             FROM gincanas g
             LEFT JOIN produtos pr ON pr.id = g.produto_id
             LEFT JOIN gincanas_premiacoes gp ON gp.gincana_id = g.id
             GROUP BY g.id, pr.nome
             ORDER BY g.criado_em DESC`
        );

        const gincanas = result.rows.map(g => {
            if (g.status === 'cancelada' || g.status === 'rascunho') {
                return { ...g, fase: g.status, segundos_para_inicio: null, segundos_para_fim: null, semana_label: null };
            }
            const faseInfo = calcularFase(g);
            return { ...g, ...faseInfo };
        });

        let filtradas;
        if (filtro === 'ativas') {
            filtradas = gincanas.filter(g =>
                g.status === 'publicada' &&
                (g.fase === 'ao_vivo' || g.fase === 'encerrada_semana')
            );
        } else if (filtro === 'proximas') {
            filtradas = gincanas.filter(g => g.status === 'publicada' && g.fase === 'proxima');
        } else if (filtro === 'rascunhos') {
            filtradas = gincanas.filter(g => g.status === 'rascunho');
        } else if (filtro === 'arquivo') {
            filtradas = gincanas.filter(g =>
                g.status === 'cancelada' ||
                (g.status === 'publicada' && (g.fase === 'encerrada' || g.fase === 'arquivada'))
            );
        } else {
            filtradas = gincanas;
        }

        res.json(filtradas);
    } catch (error) {
        console.error('[GET /api/gincanas] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar gincanas.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// GET /api/gincanas/dashboard — funcionárias (progresso individual + corrida detection)
// ---------------------------------------------------------------------------
router.get('/dashboard', async (req, res) => {
    const usuario = req.usuarioLogado;
    let dbClient;
    try {
        dbClient = await pool.connect();

        const tipos = Array.isArray(usuario.tipos) ? usuario.tipos : [];
        const ehCostureira = tipos.includes('costureira');
        const ehTiktik     = tipos.includes('tiktik');

        const result = await dbClient.query(
            `SELECT g.id, g.nome, g.descricao, g.banner_emoji, g.participantes,
                    g.escopo_atividade, g.tipo_recorrencia, g.modalidade, g.tipo_premiacao,
                    g.status, g.visivel_dashboard, g.produto_id,
                    g.vencedor_id, g.encerrada_com_ganhador,
                    g.datetime_inicio, g.datetime_fim, g.hora_inicio_semana, g.hora_fim_semana,
                    pr.nome AS produto_nome,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'id', gp.id,
                                'nivel_label', gp.nivel_label,
                                'emoji_icone', gp.emoji_icone,
                                'meta_valor', gp.meta_valor,
                                'descricao_premio', gp.descricao_premio,
                                'valor_premio_reais', gp.valor_premio_reais,
                                'ordem', gp.ordem
                            ) ORDER BY gp.ordem ASC, gp.meta_valor ASC
                        ) FILTER (WHERE gp.id IS NOT NULL),
                        '[]'::json
                    ) AS premiacoes
             FROM gincanas g
             LEFT JOIN produtos pr ON pr.id = g.produto_id
             LEFT JOIN gincanas_premiacoes gp ON gp.gincana_id = g.id
             WHERE g.status = 'publicada'
               AND g.visivel_dashboard = TRUE
               AND g.datetime_fim > NOW() - INTERVAL '48 hours'
             GROUP BY g.id, pr.nome
             ORDER BY g.datetime_inicio ASC`
        );

        const resposta = [];

        for (const g of result.rows) {
            const participantes = g.participantes;
            if (participantes === 'costureiras' && !ehCostureira) continue;
            if (participantes === 'tiktiks'     && !ehTiktik)     continue;

            const faseInfo = calcularFase(g);
            const premiacoes = Array.isArray(g.premiacoes) ? g.premiacoes : [];
            const ehCorrida = g.tipo_premiacao === 'corrida';
            const ehEquipe  = g.modalidade === 'equipe';

            let meuValor = 0;
            let valorEquipe = null;
            let minhaPosicao = null;
            let totalParticipantes = 0;
            let nivelGanho = null;
            let proximaMeta = null;
            let souVencedor = false;
            let premioRegistrado = false;
            let premioPago = false;
            let ganhoEm = null;

            const janelaInicio = faseInfo.janela_inicio;
            const janelaFim    = faseInfo.janela_fim;

            if (janelaInicio && janelaFim) {
                meuValor = await calcularProgressoIndividual(
                    dbClient, usuario.id, g.escopo_atividade, janelaInicio, janelaFim, g.produto_id
                );

                const ranking = await calcularRankingBulk(
                    dbClient, g.participantes, g.escopo_atividade, janelaInicio, janelaFim, g.produto_id
                );
                totalParticipantes = ranking.length;

                if (ehEquipe) {
                    valorEquipe = ranking.reduce((acc, r) => acc + r.valor, 0);
                    const { nivelGanho: ng, proximaMeta: pm } = calcularNivelGanho(premiacoes, valorEquipe);
                    nivelGanho = ng;
                    proximaMeta = pm;
                } else {
                    const minhaPos = ranking.findIndex(r => r.usuario_id == usuario.id);
                    minhaPosicao = minhaPos >= 0 ? minhaPos + 1 : null;
                    const { nivelGanho: ng, proximaMeta: pm } = calcularNivelGanho(premiacoes, meuValor);
                    nivelGanho = ng;
                    proximaMeta = pm;
                }

                // Race detection para corridas ao vivo
                if (ehCorrida && faseInfo.fase === 'ao_vivo' && !g.encerrada_com_ganhador) {
                    if (meuValor >= parseFloat(premiacoes[0]?.meta_valor || 0) && premiacoes.length > 0) {
                        await dbClient.query('BEGIN');
                        try {
                            souVencedor = await tentarRegistrarVencedorCorrida(
                                dbClient, g.id, usuario.id, premiacoes, faseInfo.semana_ref, new Date()
                            );
                            await dbClient.query('COMMIT');
                        } catch (e) {
                            await dbClient.query('ROLLBACK');
                        }
                    }
                }

                // Post-mortem: corrida encerrada sem ganhador registrado
                if (ehCorrida && !g.encerrada_com_ganhador && faseInfo.fase === 'encerrada') {
                    try {
                        await recuperarVencedorCorridaPostMortem(dbClient, g, premiacoes, janelaInicio, janelaFim);
                        const gAtt = await dbClient.query(
                            'SELECT vencedor_id, encerrada_com_ganhador FROM gincanas WHERE id = $1', [g.id]
                        );
                        if (gAtt.rows[0]?.encerrada_com_ganhador) {
                            g.encerrada_com_ganhador = true;
                            g.vencedor_id = gAtt.rows[0].vencedor_id;
                        }
                    } catch (err) {
                        console.error('[POST-MORTEM]', err.message);
                    }
                }

                // Para corridas já encerradas com ganhador
                if (ehCorrida && g.encerrada_com_ganhador) {
                    souVencedor = g.vencedor_id == usuario.id;
                }

                // Verificar se prêmio foi registrado e seu status de pagamento
                const premioRes = await dbClient.query(
                    `SELECT pago_em, ganho_em FROM gincanas_premios_ganhos
                     WHERE gincana_id = $1 AND usuario_id = $2
                       AND ($3::date IS NULL OR semana_ref = $3::date)
                     LIMIT 1`,
                    [g.id, usuario.id, faseInfo.semana_ref || null]
                );
                if (premioRes.rows.length) {
                    premioRegistrado = true;
                    premioPago = !!premioRes.rows[0].pago_em;
                    ganhoEm = premioRes.rows[0].ganho_em || null;
                }

                // Registrar vencedores de meta quando encerrada (lazy)
                if (!ehCorrida && (faseInfo.fase === 'encerrada' || faseInfo.fase === 'encerrada_semana')) {
                    const ranking2 = await calcularRankingBulk(
                        dbClient, g.participantes, g.escopo_atividade, janelaInicio, janelaFim, g.produto_id
                    );
                    try {
                        await dbClient.query('BEGIN');
                        await registrarVencedoresMeta(dbClient, g.id, ranking2, premiacoes, faseInfo.semana_ref);
                        await dbClient.query('COMMIT');
                    } catch (_) {
                        await dbClient.query('ROLLBACK');
                    }
                }
            }

            resposta.push({
                id: g.id,
                nome: g.nome,
                descricao: g.descricao,
                banner_emoji: g.banner_emoji,
                participantes: g.participantes,
                escopo_atividade: g.escopo_atividade,
                tipo_recorrencia: g.tipo_recorrencia,
                modalidade: g.modalidade || 'individual',
                tipo_premiacao: g.tipo_premiacao || 'meta',
                produto_id: g.produto_id,
                produto_nome: g.produto_nome,
                datetime_inicio: g.datetime_inicio,
                datetime_fim: g.datetime_fim,
                hora_inicio_semana: g.hora_inicio_semana,
                hora_fim_semana: g.hora_fim_semana,
                vencedor_id: g.vencedor_id,
                encerrada_com_ganhador: g.encerrada_com_ganhador,
                fase: faseInfo.fase,
                segundos_para_inicio: faseInfo.segundos_para_inicio,
                segundos_para_fim: faseInfo.segundos_para_fim,
                semana_label: faseInfo.semana_label,
                meu_valor: meuValor,
                valor_equipe: valorEquipe,
                minha_posicao: minhaPosicao,
                total_participantes: totalParticipantes,
                meu_nivel_ganho: nivelGanho ? nivelGanho.nivel_label : null,
                proxima_meta: proximaMeta ? {
                    nivel_label: proximaMeta.nivel_label,
                    meta_valor: proximaMeta.meta_valor,
                    descricao_premio: proximaMeta.descricao_premio,
                    emoji_icone: proximaMeta.emoji_icone,
                } : null,
                sou_vencedor: souVencedor,
                premio_registrado: premioRegistrado,
                premio_pago: premioPago,
                ganho_em: ganhoEm,
                premiacoes,
            });
        }

        res.json(resposta);
    } catch (error) {
        console.error('[GET /api/gincanas/dashboard] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar gincanas.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// GET /api/gincanas/:id — detalhes + premiações (admin)
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        if (!permissoes.includes('acesso-ponto-por-processo')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const gRes = await dbClient.query(
            `SELECT g.*, pr.nome AS produto_nome
             FROM gincanas g
             LEFT JOIN produtos pr ON pr.id = g.produto_id
             WHERE g.id = $1`,
            [req.params.id]
        );
        if (!gRes.rows.length) return res.status(404).json({ error: 'Gincana não encontrada.' });

        const pRes = await dbClient.query(
            'SELECT * FROM gincanas_premiacoes WHERE gincana_id = $1 ORDER BY ordem, meta_valor',
            [req.params.id]
        );

        const g = gRes.rows[0];
        const faseInfo = calcularFase(g);
        res.json({ ...g, ...faseInfo, premiacoes: pRes.rows });
    } catch (error) {
        console.error('[GET /api/gincanas/:id] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar gincana.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// GET /api/gincanas/:id/ranking — ranking completo (admin)
// ---------------------------------------------------------------------------
router.get('/:id/ranking', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        if (!permissoes.includes('acesso-ponto-por-processo')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const gRes = await dbClient.query(
            `SELECT g.*, pr.nome AS produto_nome
             FROM gincanas g
             LEFT JOIN produtos pr ON pr.id = g.produto_id
             WHERE g.id = $1`,
            [req.params.id]
        );
        if (!gRes.rows.length) return res.status(404).json({ error: 'Gincana não encontrada.' });

        const g = gRes.rows[0];
        const faseInfo = calcularFase(g);

        const pRes = await dbClient.query(
            'SELECT * FROM gincanas_premiacoes WHERE gincana_id = $1 ORDER BY ordem, meta_valor',
            [req.params.id]
        );
        const premiacoes = pRes.rows;

        const janelaInicio = faseInfo.janela_inicio;
        const janelaFim    = faseInfo.janela_fim;

        if (!janelaInicio || !janelaFim) {
            return res.json({
                gincana: { ...g, ...faseInfo },
                premiacoes,
                ranking: [],
                semana_label: faseInfo.semana_label,
                total_equipe: null,
            });
        }

        const ranking = await calcularRankingBulk(
            dbClient, g.participantes, g.escopo_atividade, janelaInicio, janelaFim, g.produto_id
        );

        const ehEquipe = g.modalidade === 'equipe';
        const totalEquipe = ehEquipe ? ranking.reduce((acc, r) => acc + r.valor, 0) : null;

        // Para meta encerrada: registrar vencedores (lazy, idempotente)
        const ehCorrida = g.tipo_premiacao === 'corrida';
        if (!ehCorrida && (faseInfo.fase === 'encerrada' || faseInfo.fase === 'encerrada_semana' || faseInfo.fase === 'arquivada')) {
            try {
                await dbClient.query('BEGIN');
                await registrarVencedoresMeta(dbClient, g.id, ranking, premiacoes, faseInfo.semana_ref);
                await dbClient.query('COMMIT');
            } catch (_) {
                await dbClient.query('ROLLBACK');
            }
        }

        // Post-mortem: corrida encerrada sem ganhador registrado
        if (ehCorrida && !g.encerrada_com_ganhador && (faseInfo.fase === 'encerrada' || faseInfo.fase === 'arquivada') && janelaInicio && janelaFim) {
            try {
                await recuperarVencedorCorridaPostMortem(dbClient, g, premiacoes, janelaInicio, janelaFim);
                const gAtt = await dbClient.query(
                    'SELECT vencedor_id, encerrada_com_ganhador FROM gincanas WHERE id = $1', [g.id]
                );
                if (gAtt.rows[0]?.encerrada_com_ganhador) {
                    g.encerrada_com_ganhador = true;
                    g.vencedor_id = gAtt.rows[0].vencedor_id;
                }
            } catch (err) {
                console.error('[POST-MORTEM RANKING]', err.message);
            }
        }

        // Anotar nível ganho e status de pagamento por participante
        const premiosPagosRes = await dbClient.query(
            `SELECT usuario_id, pago_em, ganho_em
             FROM gincanas_premios_ganhos
             WHERE gincana_id = $1
               AND ($2::date IS NULL OR semana_ref = $2::date)`,
            [g.id, faseInfo.semana_ref || null]
        );
        const mapaPremiados = new Map(premiosPagosRes.rows.map(r => [r.usuario_id, r]));

        const valorBase = ehEquipe ? totalEquipe : null;

        const rankingComNivel = ranking.map((r, idx) => {
            const valorParaMeta = ehEquipe ? (valorBase || 0) : r.valor;
            const { nivelGanho } = calcularNivelGanho(premiacoes, valorParaMeta);
            const premInfo = mapaPremiados.get(r.usuario_id);
            return {
                ...r,
                posicao: idx + 1,
                nivel_ganho: nivelGanho?.nivel_label || null,
                premio_registrado: !!premInfo,
                premio_pago: !!premInfo?.pago_em,
                ganho_em: premInfo?.ganho_em || null,
            };
        });

        res.json({
            gincana: { ...g, ...faseInfo },
            premiacoes,
            ranking: rankingComNivel,
            semana_label: faseInfo.semana_label,
            total_equipe: totalEquipe,
        });
    } catch (error) {
        console.error('[GET /api/gincanas/:id/ranking] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar ranking.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// POST /api/gincanas — cria em rascunho
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        if (!permissoes.includes('gerenciar-gincanas')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const {
            nome, descricao, banner_emoji = '🏆',
            participantes = 'ambos',
            modalidade = 'individual',
            tipo_premiacao = 'meta',
            escopo_atividade = 'tudo',
            produto_id = null,
            tipo_recorrencia = 'unica',
            datetime_inicio, datetime_fim,
            hora_inicio_semana = null, hora_fim_semana = null,
            visivel_dashboard = true,
            premiacoes = [],
        } = req.body;

        if (!nome || !datetime_inicio || !datetime_fim) {
            return res.status(400).json({ error: 'nome, datetime_inicio e datetime_fim são obrigatórios.' });
        }
        if (escopo_atividade === 'produto_especifico' && !produto_id) {
            return res.status(400).json({ error: 'produto_id é obrigatório quando escopo_atividade = produto_especifico.' });
        }

        await dbClient.query('BEGIN');

        const gRes = await dbClient.query(
            `INSERT INTO gincanas
             (nome, descricao, banner_emoji, participantes, modalidade, tipo_premiacao,
              escopo_atividade, produto_id, tipo_recorrencia, datetime_inicio, datetime_fim,
              hora_inicio_semana, hora_fim_semana, visivel_dashboard, criado_por)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             RETURNING *`,
            [nome, descricao || null, banner_emoji, participantes, modalidade, tipo_premiacao,
             escopo_atividade, produto_id || null, tipo_recorrencia, datetime_inicio, datetime_fim,
             hora_inicio_semana, hora_fim_semana, visivel_dashboard, req.usuarioLogado.id]
        );
        const gincana = gRes.rows[0];

        for (const p of premiacoes) {
            await dbClient.query(
                `INSERT INTO gincanas_premiacoes
                     (gincana_id, nivel_label, emoji_icone, meta_valor, descricao_premio, valor_premio_reais, ordem)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [gincana.id, p.nivel_label, p.emoji_icone || '🏅', p.meta_valor, p.descricao_premio, p.valor_premio_reais || null, p.ordem || 0]
            );
        }

        await dbClient.query('COMMIT');

        const pRes = await dbClient.query(
            'SELECT * FROM gincanas_premiacoes WHERE gincana_id = $1 ORDER BY ordem, meta_valor',
            [gincana.id]
        );
        res.status(201).json({ ...gincana, premiacoes: pRes.rows });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[POST /api/gincanas] Erro:', error);
        res.status(500).json({ error: 'Erro ao criar gincana.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// PUT /api/gincanas/:id — edita (só rascunho)
// ---------------------------------------------------------------------------
router.put('/:id', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        if (!permissoes.includes('gerenciar-gincanas')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const gRes = await dbClient.query('SELECT status FROM gincanas WHERE id = $1', [req.params.id]);
        if (!gRes.rows.length) return res.status(404).json({ error: 'Gincana não encontrada.' });
        if (gRes.rows[0].status !== 'rascunho') {
            return res.status(400).json({ error: 'Só é possível editar gincanas em rascunho.' });
        }

        const {
            nome, descricao, banner_emoji,
            participantes, modalidade, tipo_premiacao,
            escopo_atividade, produto_id,
            tipo_recorrencia, datetime_inicio, datetime_fim,
            hora_inicio_semana, hora_fim_semana, visivel_dashboard,
            premiacoes = [],
        } = req.body;

        await dbClient.query('BEGIN');

        const updated = await dbClient.query(
            `UPDATE gincanas SET
             nome=$1, descricao=$2, banner_emoji=$3, participantes=$4, modalidade=$5,
             tipo_premiacao=$6, escopo_atividade=$7, produto_id=$8,
             tipo_recorrencia=$9, datetime_inicio=$10, datetime_fim=$11,
             hora_inicio_semana=$12, hora_fim_semana=$13, visivel_dashboard=$14,
             atualizado_em=NOW()
             WHERE id=$15 RETURNING *`,
            [nome, descricao || null, banner_emoji, participantes, modalidade || 'individual',
             tipo_premiacao || 'meta', escopo_atividade, produto_id || null,
             tipo_recorrencia, datetime_inicio, datetime_fim,
             hora_inicio_semana || null, hora_fim_semana || null, visivel_dashboard,
             req.params.id]
        );

        await dbClient.query('DELETE FROM gincanas_premiacoes WHERE gincana_id = $1', [req.params.id]);
        for (const p of premiacoes) {
            await dbClient.query(
                `INSERT INTO gincanas_premiacoes
                     (gincana_id, nivel_label, emoji_icone, meta_valor, descricao_premio, valor_premio_reais, ordem)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [req.params.id, p.nivel_label, p.emoji_icone || '🏅', p.meta_valor, p.descricao_premio, p.valor_premio_reais || null, p.ordem || 0]
            );
        }

        await dbClient.query('COMMIT');

        const pRes = await dbClient.query(
            'SELECT * FROM gincanas_premiacoes WHERE gincana_id = $1 ORDER BY ordem, meta_valor',
            [req.params.id]
        );
        res.json({ ...updated.rows[0], premiacoes: pRes.rows });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[PUT /api/gincanas/:id] Erro:', error);
        res.status(500).json({ error: 'Erro ao editar gincana.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// PATCH /api/gincanas/:id/publicar
// ---------------------------------------------------------------------------
router.patch('/:id/publicar', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        if (!permissoes.includes('gerenciar-gincanas')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const gRes = await dbClient.query('SELECT * FROM gincanas WHERE id = $1', [req.params.id]);
        if (!gRes.rows.length) return res.status(404).json({ error: 'Gincana não encontrada.' });

        const g = gRes.rows[0];
        if (g.status !== 'rascunho') {
            return res.status(400).json({ error: 'Só é possível publicar gincanas em rascunho.' });
        }

        const pRes = await dbClient.query(
            'SELECT * FROM gincanas_premiacoes WHERE gincana_id = $1', [g.id]
        );
        if (!pRes.rows.length) {
            return res.status(400).json({ error: 'A gincana precisa ter pelo menos uma premiação para ser publicada.' });
        }

        const { notificar = true } = req.body;

        await dbClient.query('BEGIN');

        await dbClient.query(
            'UPDATE gincanas SET status=$1, atualizado_em=NOW() WHERE id=$2',
            ['publicada', g.id]
        );

        if (notificar) {
            const destinatariosMap = { costureiras: 'costureiras', tiktiks: 'tiktiks', ambos: 'todos' };
            const destinatarios = destinatariosMap[g.participantes] || 'todos';

            // Busca o modelo "Gincana no Ar" para usar como base visual do aviso
            const tplRes = await dbClient.query(
                `SELECT tipo, cor_fundo, url_imagem, urgente
                 FROM avisos_popup
                 WHERE is_template = TRUE AND titulo ILIKE '%Gincana no Ar%'
                 LIMIT 1`
            );
            const tpl = tplRes.rows[0] || null;

            await dbClient.query(
                `INSERT INTO avisos_popup
                    (titulo, tipo, mensagem, url_imagem, cor_fundo, destinatarios,
                     ids_individuais, urgente, ativo, is_template, data_inicio, data_fim, criado_por)
                 VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,TRUE,FALSE,$8,NULL,$9)`,
                [
                    `${g.banner_emoji} Nova Gincana: ${g.nome}`,
                    tpl?.tipo       || 'texto',
                    g.descricao     || `Participe da gincana "${g.nome}"!`,
                    tpl?.url_imagem || null,
                    tpl?.cor_fundo  || 'azul',
                    destinatarios,
                    tpl?.urgente    ?? false,
                    new Date().toISOString().split('T')[0],
                    req.usuarioLogado.id,
                ]
            );
        }

        await dbClient.query('COMMIT');

        const updated = await dbClient.query('SELECT * FROM gincanas WHERE id = $1', [g.id]);
        res.json(updated.rows[0]);
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[PATCH /api/gincanas/:id/publicar] Erro:', error);
        res.status(500).json({ error: 'Erro ao publicar gincana.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// PATCH /api/gincanas/:id/cancelar
// ---------------------------------------------------------------------------
router.patch('/:id/cancelar', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        if (!permissoes.includes('gerenciar-gincanas')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const gRes = await dbClient.query('SELECT status FROM gincanas WHERE id = $1', [req.params.id]);
        if (!gRes.rows.length) return res.status(404).json({ error: 'Gincana não encontrada.' });
        if (gRes.rows[0].status === 'cancelada') {
            return res.status(400).json({ error: 'Gincana já está cancelada.' });
        }

        await dbClient.query(
            'UPDATE gincanas SET status=$1, atualizado_em=NOW() WHERE id=$2',
            ['cancelada', req.params.id]
        );
        res.json({ ok: true });
    } catch (error) {
        console.error('[PATCH /api/gincanas/:id/cancelar] Erro:', error);
        res.status(500).json({ error: 'Erro ao cancelar gincana.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// DELETE /api/gincanas/:id — só rascunho ou cancelada
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        if (!permissoes.includes('gerenciar-gincanas')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const gRes = await dbClient.query('SELECT status FROM gincanas WHERE id = $1', [req.params.id]);
        if (!gRes.rows.length) return res.status(404).json({ error: 'Gincana não encontrada.' });

        const status = gRes.rows[0].status;
        if (status !== 'rascunho' && status !== 'cancelada') {
            return res.status(400).json({ error: 'Só é possível deletar gincanas em rascunho ou canceladas.' });
        }

        await dbClient.query('DELETE FROM gincanas WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (error) {
        console.error('[DELETE /api/gincanas/:id] Erro:', error);
        res.status(500).json({ error: 'Erro ao deletar gincana.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// Hook pós-produção — chamado por api/producoes.js após COMMIT (seção 4.2 do plano v4.0)
// Detecta cruzamento de meta no momento do lançamento (apenas costureiras por ora)
// ---------------------------------------------------------------------------
export async function verificarGincanasAposProducao(dbClient, funcionarioId, timestampProducao) {
    const gRes = await dbClient.query(
        `SELECT g.id, g.nome, g.participantes, g.modalidade, g.tipo_premiacao,
                g.escopo_atividade, g.produto_id, g.tipo_recorrencia,
                g.datetime_inicio, g.datetime_fim, g.hora_inicio_semana, g.hora_fim_semana,
                g.vencedor_id, g.encerrada_com_ganhador,
                COALESCE(json_agg(
                    json_build_object(
                        'id', gp.id, 'nivel_label', gp.nivel_label, 'emoji_icone', gp.emoji_icone,
                        'meta_valor', gp.meta_valor, 'descricao_premio', gp.descricao_premio,
                        'valor_premio_reais', gp.valor_premio_reais, 'ordem', gp.ordem
                    ) ORDER BY gp.ordem ASC, gp.meta_valor ASC
                ) FILTER (WHERE gp.id IS NOT NULL), '[]'::json) AS premiacoes
         FROM gincanas g
         LEFT JOIN gincanas_premiacoes gp ON gp.gincana_id = g.id
         WHERE g.status = 'publicada'
           AND g.participantes IN ('costureiras', 'ambos')
           AND g.escopo_atividade IN ('tudo', 'apenas_processos_op', 'produto_especifico')
           AND g.datetime_inicio <= $1
           AND g.datetime_fim >= $1
           AND g.encerrada_com_ganhador = FALSE
         GROUP BY g.id`,
        [timestampProducao]
    );

    for (const g of gRes.rows) {
        const faseInfo = calcularFase(g);
        if (faseInfo.fase !== 'ao_vivo') continue;

        const premiacoes = Array.isArray(g.premiacoes) ? g.premiacoes : [];
        if (!premiacoes.length) continue;

        const { janela_inicio: janelaInicio, janela_fim: janelaFim, semana_ref: semanaRef } = faseInfo;

        const valorAtual = await calcularProgressoIndividual(
            dbClient, funcionarioId, g.escopo_atividade, janelaInicio, janelaFim, g.produto_id
        );

        const { nivelGanho } = calcularNivelGanho(premiacoes, valorAtual);
        if (!nivelGanho) continue;

        if (g.tipo_premiacao === 'corrida') {
            await dbClient.query('BEGIN');
            try {
                await tentarRegistrarVencedorCorrida(
                    dbClient, g.id, funcionarioId, premiacoes, semanaRef || null, timestampProducao
                );
                await dbClient.query('COMMIT');
            } catch (e) {
                await dbClient.query('ROLLBACK');
            }
        } else {
            // Meta: registra nível atingido com ganho_em = timestamp da produção
            await dbClient.query(
                `INSERT INTO gincanas_premios_ganhos
                     (gincana_id, usuario_id, nivel_label, descricao_premio, semana_ref, ganho_em)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT DO NOTHING`,
                [g.id, funcionarioId, nivelGanho.nivel_label, nivelGanho.descricao_premio,
                 semanaRef || null, timestampProducao]
            );
        }
    }
}

export default router;
