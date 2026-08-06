// api/niveis-estoque.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';
import { obterEmpresaIdDoContexto } from './contexto-empresa.js';

const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.POSTGRES_URL && !/(127\.0\.0\.1|localhost)/.test(process.env.POSTGRES_URL)
        ? { rejectUnauthorized: false }
        : undefined,
    timezone: 'UTC',
});
const SECRET_KEY = process.env.JWT_SECRET;

// Middleware de autenticação e permissão
router.use(async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Token não fornecido' });
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token mal formatado' });
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.usuarioLogado = decoded;
        req.empresaId = obterEmpresaIdDoContexto(req);
        const dbClient = await pool.connect();
        try {
            const permissoesUsuario = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id, req.empresaId);
            if (!permissoesUsuario.includes('gerenciar-niveis-alerta-estoque')) {
                return res.status(403).json({ error: 'Permissão negada para gerenciar níveis de alerta de estoque.' });
            }
            next();
        } finally {
            dbClient.release();
        }
    } catch (err) {
        res.status(401).json({ error: 'Token inválido ou expirado', details: err.name });
    }
});

// GET /api/niveis-estoque - Listar todas as configurações de níveis
router.get('/', async (req, res) => {
    const empresaId = obterEmpresaIdDoContexto(req);
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(`SELECT * FROM produto_niveis_estoque_alerta WHERE empresa_id = $1 AND ativo = TRUE`, [empresaId]);
        res.status(200).json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar configurações de níveis', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/niveis-estoque/:produtoRefId - Obter configuração para um produto
router.get('/:produtoRefId', async (req, res) => {
    // Esta rota pode não ser mais necessária com a lógica de lote, mas mantemos por enquanto.
    const { produtoRefId } = req.params;
    const empresaId = obterEmpresaIdDoContexto(req);
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query('SELECT * FROM produto_niveis_estoque_alerta WHERE empresa_id = $1 AND produto_ref_id = $2 AND ativo = TRUE LIMIT 1', [empresaId, produtoRefId]);
        res.status(200).json(result.rows.length > 0 ? result.rows[0] : null);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar configuração de nível do produto', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/niveis-estoque/batch - Criar/Atualizar configurações em lote (ATUALIZADO)
router.post('/batch', async (req, res) => {
    const empresaId = obterEmpresaIdDoContexto(req);
    const { configs } = req.body;
    if (!Array.isArray(configs) || configs.length === 0) {
        return res.status(400).json({ error: 'Array de configurações "configs" é obrigatório.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const resultados = [];
        for (const config of configs) {
            const { produto_ref_id, nivel_estoque_baixo, nivel_reposicao_urgente, nivel_estoque_ideal, ativo } = config;

            // Validação
            if (!produto_ref_id) { throw new Error('Dados incompletos, produto_ref_id é obrigatório.'); }
            
            const nivelBaixo = nivel_estoque_baixo !== null ? parseInt(nivel_estoque_baixo) : null;
            const nivelUrgente = nivel_reposicao_urgente !== null ? parseInt(nivel_reposicao_urgente) : null;
            const nivelIdeal = nivel_estoque_ideal !== null ? parseInt(nivel_estoque_ideal) : null;

            if ((nivelBaixo !== null && (isNaN(nivelBaixo) || nivelBaixo < 0)) ||
                (nivelUrgente !== null && (isNaN(nivelUrgente) || nivelUrgente < 0)) ||
                (nivelIdeal !== null && (isNaN(nivelIdeal) || nivelIdeal < 0))) {
                throw new Error(`Níveis inválidos para ${produto_ref_id}. Devem ser números não negativos.`);
            }
            if (nivelUrgente !== null && nivelBaixo !== null && nivelUrgente > nivelBaixo) {
                throw new Error(`Para ${produto_ref_id}, nível urgente não pode ser > nível baixo.`);
            }
            if (nivelBaixo !== null && nivelIdeal !== null && nivelBaixo > nivelIdeal) {
                throw new Error(`Para ${produto_ref_id}, nível baixo não pode ser > nível ideal.`);
            }
            
            const produtoExiste = await dbClient.query(`
                SELECT 1
                  FROM produtos p
                 WHERE p.empresa_id = $1
                   AND (
                       p.sku = $2
                       OR EXISTS (
                           SELECT 1
                             FROM jsonb_to_recordset(COALESCE(p.grade, '[]'::jsonb)) AS g(sku TEXT)
                            WHERE g.sku = $2
                       )
                   )
                 LIMIT 1
            `, [empresaId, produto_ref_id]);
            if (produtoExiste.rowCount === 0) {
                throw new Error(`Produto ${produto_ref_id} não encontrado na empresa ativa.`);
            }

            const query = `
                INSERT INTO produto_niveis_estoque_alerta 
                    (empresa_id, produto_ref_id, nivel_estoque_baixo, nivel_reposicao_urgente, nivel_estoque_ideal, ativo)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (empresa_id, produto_ref_id)
                DO UPDATE SET 
                    nivel_estoque_baixo = EXCLUDED.nivel_estoque_baixo,
                    nivel_reposicao_urgente = EXCLUDED.nivel_reposicao_urgente,
                    nivel_estoque_ideal = EXCLUDED.nivel_estoque_ideal,
                    ativo = EXCLUDED.ativo,
                    atualizado_em = CURRENT_TIMESTAMP
                RETURNING *;
            `;
            const values = [empresaId, produto_ref_id, nivelBaixo, nivelUrgente, nivelIdeal, ativo === undefined ? true : Boolean(ativo)];
            const result = await dbClient.query(query, values);
            resultados.push(result.rows[0]);
        }

        await dbClient.query('COMMIT');
        res.status(201).json({ message: `${configs.length} configurações salvas.`, data: resultados });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API/niveis-estoque POST /batch] Erro:', error);
        res.status(400).json({ error: 'Erro ao salvar configurações em lote', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ROTA para atualizar prioridades em lote
router.post('/prioridade', async (req, res) => {
    const empresaId = obterEmpresaIdDoContexto(req);
    // Espera um array de objetos: [{ produto_ref_id: 'SKU123', prioridade: 1 }, { produto_ref_id: 'SKU456', prioridade: 2 }, ...]
    const { prioridades } = req.body;

    if (!Array.isArray(prioridades) || prioridades.length === 0) {
        return res.status(400).json({ error: 'O corpo da requisição deve conter um array "prioridades".' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        // Uma forma eficiente de fazer múltiplos updates no PostgreSQL
        const query = `
            UPDATE produto_niveis_estoque_alerta as pnea SET
                prioridade = c.prioridade
            FROM (VALUES
                ${prioridades.map((_, i) => `($${i*2 + 1}::text, $${i*2 + 2}::integer)`).join(', ')}
            ) AS c(produto_ref_id, prioridade)
            WHERE c.produto_ref_id = pnea.produto_ref_id
              AND pnea.empresa_id = $${prioridades.length * 2 + 1};
        `;

        const values = [...prioridades.flatMap(p => [p.produto_ref_id, p.prioridade]), empresaId];

        await dbClient.query(query, values);
        
        await dbClient.query('COMMIT');
        res.status(200).json({ message: 'Prioridades atualizadas com sucesso.' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API/niveis-estoque POST /prioridade] Erro:', error);
        res.status(500).json({ error: 'Erro ao atualizar prioridades.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
