// api/gincanas-pagamentos.js
import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';

const { Pool } = pg;
const router = express.Router();
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const SECRET_KEY = process.env.JWT_SECRET;

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
// GET /api/gincanas-pagamentos/fila
// Prêmios pendentes de pagamento — agrupados por semana (padrão: semana atual)
// ---------------------------------------------------------------------------
router.get('/fila', async (req, res) => {
    const empresaId = req.empresaId;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id, empresaId);
        if (!permissoes.includes('gerenciar-gincanas')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        // semana_ref: segunda-feira da semana corrente (SP)
        const agora = new Date();
        const agoraSP = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const diaSemana = agoraSP.getDay();
        const diasAteSeg = diaSemana === 0 ? -6 : 1 - diaSemana;
        const segunda = new Date(agoraSP);
        segunda.setDate(agoraSP.getDate() + diasAteSeg);
        segunda.setHours(0, 0, 0, 0);
        const semanaAtualStr = segunda.toISOString().split('T')[0];

        // Prêmios pendentes: sem pago_em
        const result = await dbClient.query(
            `SELECT
                gpg.id,
                gpg.gincana_id,
                gpg.usuario_id,
                gpg.nivel_label,
                gpg.descricao_premio,
                gpg.valor_reais,
                gpg.ganho_em,
                gpg.semana_ref,
                u.nome AS usuario_nome,
                g.nome AS gincana_nome,
                g.banner_emoji,
                g.tipo_premiacao
             FROM gincanas_premios_ganhos gpg
             JOIN usuarios u ON u.id = gpg.usuario_id
             JOIN gincanas g ON g.id = gpg.gincana_id AND g.empresa_id = gpg.empresa_id
             WHERE gpg.empresa_id = $1
               AND gpg.pago_em IS NULL
             ORDER BY gpg.ganho_em ASC`,
            [empresaId]
        );

        // Separar semana atual vs anteriores pendentes
        const semanaAtual = result.rows.filter(r => {
            if (!r.semana_ref) return true; // gincanas únicas vão para a fila atual
            return r.semana_ref.toISOString?.().split('T')[0] === semanaAtualStr ||
                   String(r.semana_ref).startsWith(semanaAtualStr);
        });
        const atrasados = result.rows.filter(r => !semanaAtual.includes(r));

        res.json({
            semana_ref: semanaAtualStr,
            pendentes_semana_atual: semanaAtual,
            pendentes_atrasados: atrasados,
            total_pendente: result.rows.length,
        });
    } catch (error) {
        console.error('[GET /api/gincanas-pagamentos/fila] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar fila de pagamentos.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// GET /api/gincanas-pagamentos/historico
// Prêmios já pagos, paginados por semana
// ---------------------------------------------------------------------------
router.get('/historico', async (req, res) => {
    const empresaId = req.empresaId;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id, empresaId);
        if (!permissoes.includes('gerenciar-gincanas')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const result = await dbClient.query(
            `SELECT
                gpg.id,
                gpg.gincana_id,
                gpg.usuario_id,
                gpg.nivel_label,
                gpg.descricao_premio,
                gpg.valor_reais,
                gpg.ganho_em,
                gpg.pago_em,
                gpg.semana_ref,
                u.nome AS usuario_nome,
                g.nome AS gincana_nome,
                g.banner_emoji,
                pg_user.nome AS pago_por_nome
             FROM gincanas_premios_ganhos gpg
             JOIN usuarios u ON u.id = gpg.usuario_id
             JOIN gincanas g ON g.id = gpg.gincana_id AND g.empresa_id = gpg.empresa_id
             LEFT JOIN usuarios pg_user ON pg_user.id = gpg.pago_por
             WHERE gpg.empresa_id = $1
               AND gpg.pago_em IS NOT NULL
             ORDER BY gpg.pago_em DESC
             LIMIT 200`,
            [empresaId]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('[GET /api/gincanas-pagamentos/historico] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// POST /api/gincanas-pagamentos/pagar-lote
// Paga todos os prêmios pendentes da fila (ou de uma semana específica)
// ---------------------------------------------------------------------------
router.post('/pagar-lote', async (req, res) => {
    const empresaId = req.empresaId;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id, empresaId);
        if (!permissoes.includes('gerenciar-gincanas')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const { ids } = req.body; // array de IDs a pagar; se omitido, paga todos os pendentes

        let query, params;
        if (Array.isArray(ids) && ids.length > 0) {
            const idsNormalizados = [...new Set(ids.map(Number))];
            if (idsNormalizados.some(id => !Number.isInteger(id) || id <= 0)) {
                return res.status(400).json({ error: 'A lista de prêmios contém IDs inválidos.' });
            }

            // Valida todos os IDs antes da mutação. Assim, uma lista montada
            // em outro contexto empresarial não vira uma baixa parcial.
            const idsEmpresa = await dbClient.query(
                `SELECT id
                 FROM gincanas_premios_ganhos
                 WHERE id = ANY($1::int[])
                   AND empresa_id = $2`,
                [idsNormalizados, empresaId]
            );
            if (idsEmpresa.rows.length !== idsNormalizados.length) {
                return res.status(404).json({ error: 'Um ou mais prêmios não pertencem à empresa ativa.' });
            }

            query = `UPDATE gincanas_premios_ganhos
                     SET pago_em = NOW(), pago_por = $1
                      WHERE id = ANY($2)
                        AND empresa_id = $3
                        AND pago_em IS NULL
                      RETURNING id`;
            params = [req.usuarioLogado.id, idsNormalizados, empresaId];
        } else {
            query = `UPDATE gincanas_premios_ganhos
                     SET pago_em = NOW(), pago_por = $1
                      WHERE empresa_id = $2
                        AND pago_em IS NULL
                      RETURNING id`;
            params = [req.usuarioLogado.id, empresaId];
        }

        const result = await dbClient.query(query, params);
        res.json({ pagos: result.rows.length, ids: result.rows.map(r => r.id) });
    } catch (error) {
        console.error('[POST /api/gincanas-pagamentos/pagar-lote] Erro:', error);
        res.status(500).json({ error: 'Erro ao pagar lote.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// POST /api/gincanas-pagamentos/:id/pagar
// Paga um prêmio individualmente (antecipação)
// ---------------------------------------------------------------------------
router.post('/:id/pagar', async (req, res) => {
    const empresaId = req.empresaId;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id, empresaId);
        if (!permissoes.includes('gerenciar-gincanas')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const result = await dbClient.query(
            `UPDATE gincanas_premios_ganhos
             SET pago_em = NOW(), pago_por = $1
             WHERE id = $2
               AND empresa_id = $3
               AND pago_em IS NULL
             RETURNING *`,
            [req.usuarioLogado.id, req.params.id, empresaId]
        );

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Prêmio não encontrado ou já foi pago.' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('[POST /api/gincanas-pagamentos/:id/pagar] Erro:', error);
        res.status(500).json({ error: 'Erro ao pagar prêmio.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// GET /api/gincanas-pagamentos/meus-premios
// Premiações da funcionária logada (para o "bolso de premiações" na dashboard)
// ---------------------------------------------------------------------------
router.get('/meus-premios', async (req, res) => {
    const empresaId = req.empresaId;
    let dbClient;
    try {
        dbClient = await pool.connect();

        const result = await dbClient.query(
            `SELECT
                gpg.id,
                gpg.nivel_label,
                gpg.descricao_premio,
                gpg.valor_reais,
                gpg.ganho_em,
                gpg.pago_em,
                gpg.semana_ref,
                g.nome AS gincana_nome,
                g.banner_emoji
             FROM gincanas_premios_ganhos gpg
             JOIN gincanas g ON g.id = gpg.gincana_id AND g.empresa_id = gpg.empresa_id
             WHERE gpg.usuario_id = $1
               AND gpg.empresa_id = $2
             ORDER BY gpg.ganho_em DESC
             LIMIT 50`,
            [req.usuarioLogado.id, empresaId]
        );

        const pendentes = result.rows.filter(r => !r.pago_em);
        const pagos = result.rows.filter(r => !!r.pago_em);

        res.json({
            pendentes,
            pagos,
            total_pendentes: pendentes.length,
            total_pagos: pagos.length,
        });
    } catch (error) {
        console.error('[GET /api/gincanas-pagamentos/meus-premios] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar prêmios.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
