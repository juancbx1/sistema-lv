// /api/pontos-extras.js

import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';

const router = express.Router();
const pool = new Pool({ connectionString: process.env.POSTGRES_URL, timezone: 'UTC' });
const SECRET_KEY = process.env.JWT_SECRET;

router.use(async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token ausente.' });
        req.usuarioLogado = jwt.verify(authHeader.split(' ')[1], SECRET_KEY);
        next();
    } catch {
        res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
});

// ==========================================================================
// POST / — Lançar pontos extras
// ==========================================================================
router.post('/', async (req, res) => {
    const empresaId = req.empresaId;
    let dbClient;
    try {
        const { funcionario_id, pontos, motivo, data_referencia } = req.body;
        const supervisor_id = req.usuarioLogado.id;

        if (!funcionario_id) return res.status(400).json({ error: 'funcionario_id é obrigatório.' });
        if (!pontos || Number(pontos) <= 0) return res.status(400).json({ error: 'pontos deve ser um número maior que zero.' });
        if (!motivo || motivo.trim().length < 10) return res.status(400).json({ error: 'motivo é obrigatório (mínimo 10 caracteres).' });
        if (!data_referencia) return res.status(400).json({ error: 'data_referencia é obrigatória.' });

        const hoje = new Date().toLocaleDateString('sv', { timeZone: 'America/Sao_Paulo' });
        if (data_referencia > hoje) return res.status(400).json({ error: 'data_referencia não pode ser uma data futura.' });

        dbClient = await pool.connect();

        const funcResult = await dbClient.query(
            `SELECT u.id, u.nome
             FROM usuarios u
             JOIN usuarios_empresas ue
               ON ue.usuario_id = u.id
              AND ue.empresa_id = $2
              AND ue.ativo
             WHERE u.id = $1
               AND ue.data_admissao IS NOT NULL
               AND ue.data_demissao IS NULL`,
            [funcionario_id, empresaId]
        );
        if (!funcResult.rows.length) return res.status(404).json({ error: 'Funcionário não encontrado ou inativo.' });

        const result = await dbClient.query(`
            INSERT INTO pontos_extras (empresa_id, funcionario_id, supervisor_id, pontos, motivo, data_referencia)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [empresaId, funcionario_id, supervisor_id, Number(pontos), motivo.trim(), data_referencia]);

        res.status(201).json(result.rows[0]);

    } catch (error) {
        console.error('[POST /api/pontos-extras] Erro:', error.message);
        res.status(500).json({ error: 'Erro interno ao lançar pontos extras.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ==========================================================================
// GET /historico — Histórico de lançamentos de uma data
// ==========================================================================
router.get('/historico', async (req, res) => {
    const empresaId = req.empresaId;
    let dbClient;
    try {
        const data = req.query.data || new Date().toLocaleDateString('sv', { timeZone: 'America/Sao_Paulo' });

        dbClient = await pool.connect();

        const { rows } = await dbClient.query(`
            SELECT
                pe.id,
                pe.pontos,
                pe.motivo,
                pe.data_referencia,
                pe.data_lancamento,
                pe.cancelado,
                pe.motivo_cancelamento,
                pe.data_cancelamento,
                uf.nome            AS funcionario_nome,
                uf.tipos           AS funcionario_tipos,
                us.nome            AS supervisor_nome,
                uc.nome            AS cancelado_por_nome
            FROM pontos_extras pe
            JOIN usuarios uf ON uf.id = pe.funcionario_id
            JOIN usuarios us ON us.id = pe.supervisor_id
            LEFT JOIN usuarios uc ON uc.id = pe.cancelado_por
            WHERE pe.empresa_id = $1
              AND pe.data_referencia = $2
            ORDER BY pe.data_lancamento DESC
        `, [empresaId, data]);

        res.json(rows);

    } catch (error) {
        console.error('[GET /api/pontos-extras/historico] Erro:', error.message);
        res.status(500).json({ error: 'Erro interno ao buscar histórico de pontos extras.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ==========================================================================
// PATCH /:id/cancelar — Soft-delete com audit trail
// ==========================================================================
router.patch('/:id/cancelar', async (req, res) => {
    const empresaId = req.empresaId;
    let dbClient;
    try {
        dbClient = await pool.connect();

        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id, empresaId);
        if (!permissoes.includes('cancelar-pontos-extras')) {
            return res.status(403).json({
                error: 'Você não tem permissão para cancelar pontos extras. Solicite ao gerente.'
            });
        }

        const { motivo_cancelamento } = req.body;
        if (!motivo_cancelamento?.trim()) {
            return res.status(400).json({ error: 'Informe o motivo do cancelamento.' });
        }

        const result = await dbClient.query(`
            UPDATE pontos_extras
            SET cancelado = TRUE,
                cancelado_por = $1,
                data_cancelamento = NOW(),
                motivo_cancelamento = $2
            WHERE id = $3
              AND empresa_id = $4
              AND cancelado = FALSE
            RETURNING *
        `, [req.usuarioLogado.id, motivo_cancelamento.trim(), req.params.id, empresaId]);

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Lançamento não encontrado ou já cancelado.' });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error('[PATCH /api/pontos-extras/:id/cancelar] Erro:', error.message);
        res.status(500).json({ error: 'Erro interno ao cancelar lançamento.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
