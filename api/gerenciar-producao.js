// api/gerenciar-producao.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';
import { registrarAuditoria } from './audit.js';

const router = express.Router();
const pool = new Pool({ connectionString: process.env.POSTGRES_URL, timezone: 'UTC' });
const SECRET_KEY = process.env.JWT_SECRET;

const verificarToken = (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) { const e = new Error('Token não fornecido'); e.statusCode = 401; throw e; }
    const token = authHeader.split(' ')[1];
    if (!token) { const e = new Error('Token mal formatado'); e.statusCode = 401; throw e; }
    try {
        return jwt.verify(token, SECRET_KEY);
    } catch (err) {
        const e = new Error('Token inválido ou expirado');
        e.statusCode = 401;
        if (err.name === 'TokenExpiredError') e.details = 'jwt expired';
        throw e;
    }
};

router.use(async (req, res, next) => {
    try {
        req.usuarioLogado = verificarToken(req);
        next();
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

// GET /api/gerenciar-producao/funcionarios-ativos
router.get('/funcionarios-ativos', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(`
            SELECT id, nome, tipos
            FROM usuarios
            WHERE data_demissao IS NULL
              AND is_test = false
              AND (
                'costureira' = ANY(tipos)
                OR 'tiktik'   = ANY(tipos)
                OR 'cortador'  = ANY(tipos)
              )
            ORDER BY nome ASC
        `);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[API GET /gerenciar-producao/funcionarios-ativos] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/gerenciar-producao/solicitar-exclusao
router.post('/solicitar-exclusao', async (req, res) => {
    const { usuarioLogado } = req;
    const { producao_id, motivo } = req.body;
    let dbClient;
    try {
        if (!producao_id) return res.status(400).json({ error: 'producao_id é obrigatório.' });

        dbClient = await pool.connect();

        const producaoRes = await dbClient.query(`
            SELECT pr.*, p.nome AS produto
            FROM producoes pr
            LEFT JOIN produtos p ON pr.produto_id = p.id
            WHERE pr.id = $1
        `, [producao_id]);
        if (producaoRes.rows.length === 0) {
            return res.status(404).json({ error: 'Registro de produção não encontrado.' });
        }

        const pendente = await dbClient.query(
            `SELECT id FROM producoes_solicitacoes_exclusao WHERE producao_id = $1 AND status = 'pendente'`,
            [producao_id]
        );
        if (pendente.rows.length > 0) {
            return res.status(409).json({ error: 'Já existe uma solicitação pendente para este registro. Aguarde a decisão do aprovador.' });
        }

        const producao = producaoRes.rows[0];
        const snapshot = {
            id: producao.id,
            funcionario: producao.funcionario,
            funcionario_id: producao.funcionario_id,
            produto: producao.produto,
            produto_id: producao.produto_id,
            processo: producao.processo,
            maquina: producao.maquina,
            quantidade: producao.quantidade,
            variacao: producao.variacao,
            pontos_gerados: producao.pontos_gerados,
            valor_ponto_aplicado: producao.valor_ponto_aplicado,
            op_numero: producao.op_numero,
            data: producao.data,
            lancado_por: producao.lancado_por,
            assinada: producao.assinada,
            edicoes: producao.edicoes,
        };

        await dbClient.query(`
            INSERT INTO producoes_solicitacoes_exclusao
                (producao_id, snapshot, solicitado_por_id, solicitado_por_nome, motivo)
            VALUES ($1, $2, $3, $4, $5)
        `, [
            producao_id,
            JSON.stringify(snapshot),
            usuarioLogado.id,
            usuarioLogado.nome || usuarioLogado.nome_usuario,
            motivo || null,
        ]);

        await registrarAuditoria(dbClient, usuarioLogado, 'producao.exclusao_solicitada', 'producao', producao_id, {
            funcionario_nome: producao.funcionario,
            quantidade: producao.quantidade,
            op_numero: producao.op_numero,
            motivo: motivo || null,
        });

        res.status(201).json({ ok: true });
    } catch (error) {
        console.error('[API POST /gerenciar-producao/solicitar-exclusao] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/gerenciar-producao/solicitacoes/contagem
router.get('/solicitacoes/contagem', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(
            `SELECT COUNT(*) FROM producoes_solicitacoes_exclusao WHERE status = 'pendente'`
        );
        res.status(200).json({ pendentes: parseInt(result.rows[0].count) });
    } catch (error) {
        console.error('[API GET /gerenciar-producao/solicitacoes/contagem] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/gerenciar-producao/solicitacoes
router.get('/solicitacoes', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const { status, page, limit } = req.query;

        let whereClause;
        if (status === 'pendente') {
            whereClause = `WHERE status = 'pendente'`;
        } else if (status === 'aprovada' || status === 'rejeitada' || status === 'cancelada') {
            whereClause = `WHERE status = '${status}'`;
        } else {
            // historico = tudo que não é pendente
            whereClause = `WHERE status != 'pendente'`;
        }

        if (!page) {
            // Sem paginação (usado para pendentes)
            const result = await dbClient.query(
                `SELECT * FROM producoes_solicitacoes_exclusao ${whereClause} ORDER BY solicitado_em DESC`
            );
            return res.status(200).json({ rows: result.rows });
        }

        const pageNum  = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 10));
        const offset   = (pageNum - 1) * limitNum;

        const [countRes, dataRes] = await Promise.all([
            dbClient.query(`SELECT COUNT(*) FROM producoes_solicitacoes_exclusao ${whereClause}`),
            dbClient.query(
                `SELECT * FROM producoes_solicitacoes_exclusao ${whereClause}
                 ORDER BY solicitado_em DESC LIMIT $1 OFFSET $2`,
                [limitNum, offset]
            ),
        ]);

        const total = parseInt(countRes.rows[0].count);
        res.status(200).json({
            rows: dataRes.rows,
            total,
            pagina: pageNum,
            totalPaginas: Math.ceil(total / limitNum),
        });
    } catch (error) {
        console.error('[API GET /gerenciar-producao/solicitacoes] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/gerenciar-producao/solicitacoes/:id/decidir
router.post('/solicitacoes/:id/decidir', async (req, res) => {
    const { usuarioLogado } = req;
    const { id } = req.params;
    const { decisao, motivo_decisao } = req.body;
    let dbClient;
    try {
        if (!['aprovada', 'rejeitada'].includes(decisao)) {
            return res.status(400).json({ error: 'decisao deve ser "aprovada" ou "rejeitada".' });
        }

        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const solRes = await dbClient.query(
            `SELECT * FROM producoes_solicitacoes_exclusao WHERE id = $1 FOR UPDATE`,
            [id]
        );
        if (solRes.rows.length === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Solicitação não encontrada.' });
        }

        const sol = solRes.rows[0];
        if (sol.status !== 'pendente') {
            await dbClient.query('ROLLBACK');
            return res.status(409).json({ error: 'Esta solicitação já foi decidida.' });
        }

        let acaoAudit;

        if (decisao === 'aprovada') {
            // Tenta deletar a produção
            const deleteRes = await dbClient.query(
                `DELETE FROM producoes WHERE id = $1 RETURNING id, funcionario, quantidade, op_numero`,
                [sol.producao_id]
            );

            if (deleteRes.rowCount === 0) {
                // Produção já foi deletada por outro meio — marca como cancelada
                await dbClient.query(
                    `UPDATE producoes_solicitacoes_exclusao
                     SET status = 'cancelada', decidido_por_id = $1, decidido_por_nome = $2,
                         decidido_em = NOW(), motivo_decisao = 'Registro já havia sido excluído'
                     WHERE id = $3`,
                    [usuarioLogado.id, usuarioLogado.nome || usuarioLogado.nome_usuario, id]
                );
                await dbClient.query('COMMIT');
                return res.status(200).json({ ok: true, aviso: 'O registro já havia sido excluído anteriormente. Solicitação marcada como cancelada.' });
            }

            acaoAudit = 'producao.exclusao_aprovada';
        } else {
            acaoAudit = 'producao.exclusao_rejeitada';
        }

        await dbClient.query(
            `UPDATE producoes_solicitacoes_exclusao
             SET status = $1, decidido_por_id = $2, decidido_por_nome = $3,
                 decidido_em = NOW(), motivo_decisao = $4
             WHERE id = $5`,
            [decisao, usuarioLogado.id, usuarioLogado.nome || usuarioLogado.nome_usuario, motivo_decisao || null, id]
        );

        await dbClient.query('COMMIT');

        const snap = sol.snapshot || {};
        await registrarAuditoria(dbClient, usuarioLogado, acaoAudit, 'producao', sol.producao_id, {
            funcionario_nome: snap.funcionario,
            quantidade: snap.quantidade,
            op_numero: snap.op_numero,
            solicitado_por: sol.solicitado_por_nome,
            motivo_decisao: motivo_decisao || null,
        });

        res.status(200).json({ ok: true });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /gerenciar-producao/solicitacoes/:id/decidir] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
