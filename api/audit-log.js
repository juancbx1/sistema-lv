// api/audit-log.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';

const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    timezone: 'UTC',
});
const SECRET_KEY = process.env.JWT_SECRET;

const verificarToken = (req) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) { const e = new Error('Token não fornecido'); e.statusCode = 401; throw e; }
    try { return jwt.verify(token, SECRET_KEY); }
    catch (err) { const e = new Error('Token inválido ou expirado'); e.statusCode = 401; throw e; }
};

router.use(async (req, res, next) => {
    try { req.usuarioLogado = verificarToken(req); next(); }
    catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});

// GET /api/audit-log
// Query params: usuario_id, acao, entidade, data_inicio, data_fim, page (default 1), limit (default 50)
// Permissão: acesso-permissoes-usuarios
router.get('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoes.includes('acesso-permissoes-usuarios')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const { usuario_id, acao, entidade, data_inicio, data_fim, page = 1, limit = 50 } = req.query;
        const params = [];
        const where = [];
        let i = 1;

        if (usuario_id) { where.push(`usuario_id = $${i++}`); params.push(parseInt(usuario_id)); }
        if (acao)        { where.push(`acao = $${i++}`); params.push(acao); }
        if (entidade)    { where.push(`entidade = $${i++}`); params.push(entidade); }
        if (data_inicio) { where.push(`criado_em >= $${i++}`); params.push(data_inicio); }
        if (data_fim)    { where.push(`criado_em < $${i++}`); params.push(data_fim); }

        const whereStr = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const offset = (Number(page) - 1) * Number(limit);

        const [countResult, dataResult] = await Promise.all([
            dbClient.query(`SELECT COUNT(*) FROM audit_log ${whereStr}`, params),
            dbClient.query(
                `SELECT * FROM audit_log ${whereStr} ORDER BY criado_em DESC LIMIT $${i} OFFSET $${i + 1}`,
                [...params, Number(limit), offset]
            ),
        ]);

        const total = parseInt(countResult.rows[0].count);
        res.status(200).json({
            logs: dataResult.rows,
            total,
            pagina: Number(page),
            totalPaginas: Math.ceil(total / Number(limit)),
        });
    } catch (error) {
        console.error('[GET /api/audit-log]', error);
        res.status(500).json({ error: 'Erro ao buscar logs de auditoria.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/audit-log/usuarios — lista todos os usuários ativos (para o filtro de select)
router.get('/usuarios', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoes.includes('acesso-permissoes-usuarios')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }
        const result = await dbClient.query(
            `SELECT id AS usuario_id, nome AS usuario_nome
             FROM usuarios
             WHERE data_demissao IS NULL
               AND NOT ('is_test' = ANY(COALESCE(tipos, '{}')))
               AND NOT ('prestador_externo' = ANY(COALESCE(tipos, '{}')))
             ORDER BY nome`
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[GET /api/audit-log/usuarios]', error);
        res.status(500).json({ error: 'Erro ao buscar usuários.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
