// api/cortes.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';

// Importar a função de buscar permissões completas
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';
import { registrarAuditoria } from './audit.js';

const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    timezone: 'UTC',
});
const SECRET_KEY = process.env.JWT_SECRET;

// Função verificarTokenOriginal (mantenha a sua ou use uma centralizada)
const verificarTokenOriginal = (reqOriginal) => {
    const token = reqOriginal.headers.authorization?.split(' ')[1];
    if (!token) throw new Error('Token não fornecido');
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        return decoded;
    } catch (err) {
        const error = new Error('Token inválido ou expirado');
        error.statusCode = 401;
        if (err.name === 'TokenExpiredError') error.details = 'jwt expired';
        throw error;
    }
};

// Middleware para este router: Apenas autentica o token.
router.use(async (req, res, next) => {
    try {
        req.usuarioLogado = verificarTokenOriginal(req);
        next();
    } catch (error) {
        console.error('[router/cortes MID] Erro no middleware:', error.message);
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({ error: error.message, details: error.details });
    }
});

// GET /api/cortes/radar — Pulso do setor + déficit de estoque
router.get('/radar', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);

        if (!permissoesCompletas.includes('acesso-ordens-de-producao')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        // 1. Estatísticas gerais do estoque de cortes
        // NOTA: usa campo `data` (enviado pelo cliente na criação) para lancamentos_hoje,
        // pois `data_atualizacao` só é preenchido em UPDATEs — não em INSERTs novos.
        const statsResult = await dbClient.query(`
            SELECT
                COALESCE(SUM(quantidade) FILTER (WHERE status = 'cortados' AND op IS NULL), 0)::int AS total_pecas_estoque,
                COUNT(*) FILTER (WHERE status = 'cortados' AND op IS NULL)::int AS total_cortes_disponiveis,
                COUNT(*) FILTER (WHERE data::date = CURRENT_DATE AND status != 'excluido')::int AS lancamentos_hoje
            FROM cortes
            WHERE status != 'excluido'
        `);

        // 2. Último lançamento — ordena por id DESC para pegar o mais recente mesmo sem data_atualizacao
        const ultimoResult = await dbClient.query(`
            SELECT c.cortador, c.data, p.nome AS produto_nome
            FROM cortes c
            LEFT JOIN produtos p ON c.produto_id = p.id
            WHERE c.status != 'excluido'
            ORDER BY c.id DESC
            LIMIT 1
        `);

        // 3. Alertas de déficit: demandas ativas sem corte suficiente em estoque
        // Wrapped in try/catch — se a estrutura da tabela demandas_producao mudar, não quebra o endpoint
        let alertasDeficit = [];
        try {
            const deficitResult = await dbClient.query(`
                WITH estoque AS (
                    SELECT
                        produto_id,
                        COALESCE(variante, '') AS variante,
                        SUM(quantidade)::int AS disponiveis
                    FROM cortes
                    WHERE status = 'cortados' AND op IS NULL
                    GROUP BY produto_id, variante
                ),
                demandas_ativas AS (
                    SELECT
                        p.id AS produto_id,
                        p.nome AS produto_nome,
                        COALESCE(
                            (SELECT g->>'variacao'
                             FROM jsonb_array_elements(
                                 CASE WHEN jsonb_typeof(p.grade) = 'array' THEN p.grade ELSE '[]'::jsonb END
                             ) g
                             WHERE g->>'sku' = dp.produto_sku
                             LIMIT 1),
                            ''
                        ) AS variante,
                        SUM(dp.quantidade_solicitada)::int AS necessarias
                    FROM demandas_producao dp
                    JOIN produtos p ON (
                        p.sku = dp.produto_sku
                        OR EXISTS (
                            SELECT 1 FROM jsonb_array_elements(
                                CASE WHEN jsonb_typeof(p.grade) = 'array' THEN p.grade ELSE '[]'::jsonb END
                            ) g
                            WHERE g->>'sku' = dp.produto_sku
                        )
                    )
                    WHERE p.is_kit = false
                      AND dp.status NOT IN ('em_producao', 'concluida', 'cancelada', 'arquivada', 'finalizada')
                    GROUP BY p.id, p.nome, variante
                )
                SELECT
                    d.produto_id,
                    d.produto_nome,
                    CASE WHEN d.variante = '' THEN NULL ELSE d.variante END AS variante,
                    d.necessarias AS pecas_necessarias,
                    COALESCE(e.disponiveis, 0) AS pecas_em_estoque
                FROM demandas_ativas d
                LEFT JOIN estoque e
                    ON e.produto_id = d.produto_id
                    AND e.variante = d.variante
                WHERE COALESCE(e.disponiveis, 0) < d.necessarias
                ORDER BY d.produto_nome
            `);
            alertasDeficit = deficitResult.rows;
        } catch (deficitErr) {
            console.warn('[Radar/cortes] Erro ao calcular déficit:', deficitErr.message);
        }

        const stats = statsResult.rows[0];
        const ultimo = ultimoResult.rows[0] || null;

        res.json({
            totalPecasEstoque: stats.total_pecas_estoque,
            totalCortesDisponiveis: stats.total_cortes_disponiveis,
            lancamentosHoje: stats.lancamentos_hoje,
            ultimoLancamento: ultimo ? {
                cortador: ultimo.cortador || 'Sistema',
                data: ultimo.data,   // campo 'data' = data do corte (enviado no INSERT)
                produto: ultimo.produto_nome
            } : null,
            alertasDeficit
        });

    } catch (error) {
        console.error('[API Cortes GET /radar] Erro:', error);
        res.status(500).json({ error: 'Erro ao gerar radar de cortes.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.get('/next-pc-number', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        
        // CORREÇÃO DEFINITIVA COM LIMITADOR:
        // 1. pn ~ '^[0-9]+$': Pega apenas PNs que são puramente números (sem letras, sem traços).
        // 2. LENGTH(pn) < 10: FATOR LIMITADOR. Ignora qualquer número absurdo (maior que 999 milhões).
        // Isso impede que erros ou timestamps entrem na conta.
        const query = `
            SELECT pn FROM cortes 
            WHERE pn ~ '^[0-9]+$' 
            AND LENGTH(pn) < 10
            ORDER BY pn::integer DESC
            LIMIT 1;
        `;
        const result = await dbClient.query(query);

        let nextNumber = 10000; // Começa em 10.000 se não tiver nada
        
        if (result.rows.length > 0) {
            const lastPn = parseInt(result.rows[0].pn, 10);
            if (!isNaN(lastPn)) {
                nextNumber = lastPn + 1;
            }
        }
        
        // Retorna como string para manter padrão
        res.status(200).json({ nextPC: nextNumber.toString() });

    } catch (error) {
        console.error('[API Cortes GET /next-pc-number] Erro:', error);
        res.status(500).json({ error: 'Erro ao gerar próximo número de PC.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/cortes
router.get('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        
        if (!permissoesCompletas.includes('acesso-ordens-de-producao')) {
            return res.status(403).json({ error: 'Permissão negada para visualizar cortes.' });
        }

        const { status } = req.query;

       const baseSelect = `
            SELECT 
                c.id, c.pn, c.variante, c.quantidade, c.data, c.cortador,
                c.status, c.op, c.data_atualizacao, c.produto_id,
                p.nome AS produto,
                p.imagem AS imagem_produto
            FROM cortes c
            LEFT JOIN produtos p ON c.produto_id = p.id
        `;

        let queryText = `${baseSelect} WHERE c.status != $1`;
        let queryParams = ['excluido'];

        if (status) {
            queryText += ' AND c.status = $2';
            queryParams.push(status);
        }

        queryText += ' ORDER BY c.data DESC, c.id DESC';
        
        const result = await dbClient.query(queryText, queryParams);
        res.status(200).json(result.rows);

    } catch (error) {
        console.error('[router/cortes GET] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar cortes.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/cortes
router.post('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);

        // Permite criar corte se tiver permissão específica ou se estiver criando uma OP
        if (!permissoesCompletas.includes('registrar-corte') && !permissoesCompletas.includes('criar-op')) {
            return res.status(403).json({ error: 'Permissão negada para registrar corte.' });
        }

        const {
            produto_id,
            variante,
            quantidade,
            data,
            status = 'pendente',
            op = null,
            pn,        // opcional: se não enviado, gerado pela sequence cortes_pn_seq
            cortador,
            demanda_id
        } = req.body;

        if (!produto_id || quantidade === undefined || !data || !status) {
            return res.status(400).json({ error: 'Dados incompletos: produto_id, quantidade, data e status são obrigatórios.' });
        }

        const parsedQuantidade = parseInt(quantidade, 10);
        if (isNaN(parsedQuantidade) || parsedQuantidade <= 0) {
            return res.status(400).json({ error: 'Quantidade deve ser um número positivo.' });
        }

        const varianteFinal = (variante === undefined || variante === null || String(variante).trim() === '') ? null : String(variante).trim();

        // pn gerado atomicamente pela sequence quando não enviado pelo cliente
        const queryText = `
            INSERT INTO cortes (produto_id, variante, quantidade, data, status, op, pn, cortador, demanda_id)
            VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, nextval('cortes_pn_seq')::text), $8, $9)
            RETURNING *
        `;
        const values = [
            parseInt(produto_id),
            varianteFinal,
            parsedQuantidade,
            data,
            status,
            op,
            pn || null,
            cortador,
            demanda_id || null
        ];

        const result = await dbClient.query(queryText, values);
        const corteRegistrado = result.rows[0];
        await registrarAuditoria(dbClient, req.usuarioLogado, 'corte.registrado', 'corte', corteRegistrado.pn, {
            pn: corteRegistrado.pn,
            produto_id: corteRegistrado.produto_id,
            variante: corteRegistrado.variante,
            quantidade: corteRegistrado.quantidade,
            origem: pn ? 'wizard' : 'quick_log',
        });
        res.status(201).json(corteRegistrado);

    } catch (error) {
        console.error('[router/cortes POST] Erro:', error);
        if (error.code === '23505') { // Erro de violação de chave única (ex: pn duplicado)
            return res.status(409).json({ error: 'Conflito de dados. O Pedido de Corte (PC/PN) já existe.', details: error.detail });
        }
        res.status(500).json({ error: 'Erro interno ao criar o corte.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PUT /api/cortes
router.put('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        
        if (!permissoesCompletas.includes('marcar-como-cortado') && !permissoesCompletas.includes('editar-op')) {
            return res.status(403).json({ error: 'Permissão negada para atualizar este corte.' });
        }

        const { id, status, cortador, op, quantidade, produto_id, variante } = req.body;

        if (!id) {
            return res.status(400).json({ error: 'ID do corte é obrigatório para atualização.' });
        }

        const fieldsToUpdate = [];
        const updateValues = [];
        let paramCount = 1;

        if (status !== undefined) { fieldsToUpdate.push(`status = $${paramCount++}`); updateValues.push(status); }
        if (cortador !== undefined) { fieldsToUpdate.push(`cortador = $${paramCount++}`); updateValues.push(cortador); }
        if (op !== undefined) { fieldsToUpdate.push(`op = $${paramCount++}`); updateValues.push(op); }
        if (quantidade !== undefined) { fieldsToUpdate.push(`quantidade = $${paramCount++}`); updateValues.push(parseInt(quantidade)); }
        if (produto_id !== undefined) { fieldsToUpdate.push(`produto_id = $${paramCount++}`); updateValues.push(parseInt(produto_id)); }
        if (variante !== undefined) { fieldsToUpdate.push(`variante = $${paramCount++}`); updateValues.push(variante === '' ? null : variante); }

        if (fieldsToUpdate.length === 0) {
            return res.status(400).json({ error: 'Nenhum campo fornecido para atualização.' });
        }

        fieldsToUpdate.push(`data_atualizacao = CURRENT_TIMESTAMP`);
        updateValues.push(id);
        
        const queryText = `UPDATE cortes SET ${fieldsToUpdate.join(', ')} WHERE id = $${paramCount} RETURNING *`;

        const result = await dbClient.query(queryText, updateValues);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Corte não encontrado.' });
        }
        res.status(200).json(result.rows[0]);

    } catch (error) {
        console.error('[router/cortes PUT] Erro:', error);
        res.status(500).json({ error: 'Erro ao atualizar corte', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// DELETE /api/cortes
router.delete('/', async (req, res) => {
    const { usuarioLogado } = req;
    const { id } = req.body;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        
        if (!id) return res.status(400).json({ error: 'ID do corte é obrigatório.' });

        // 1. "Soft delete" do corte e pega seus dados completos
        const result = await dbClient.query(
            `UPDATE cortes SET status = 'excluido' WHERE id = $1 RETURNING *`,
            [id]
        );

        if (result.rowCount === 0) return res.status(404).json({ error: 'Corte não encontrado.' });

        const corteExcluido = result.rows[0];        
        // 2. LÓGICA DE CASCATA
        const opNumeroParaCancelar = corteExcluido.op;

        if (opNumeroParaCancelar) {            
            const opCancelResult = await dbClient.query(
                `UPDATE ordens_de_producao SET status = 'cancelada' WHERE numero = $1 AND status NOT IN ('finalizado', 'cancelada')`,
                [String(opNumeroParaCancelar)] // Força para string por segurança
            );

            if (opCancelResult.rowCount > 0) {
            } else {
                console.warn(`[API Cortes DELETE] AVISO: A OP #${opNumeroParaCancelar} não foi encontrada ou já estava finalizada/cancelada.`);
            }
        } else {
        }

        res.status(200).json({ message: 'Corte marcado como excluído.', corte: corteExcluido });

    } catch (error) {
        console.error('[router/cortes DELETE] Erro:', error);
        res.status(500).json({ error: 'Erro interno na exclusão do corte.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.delete('/', async (req, res) => {
    const { usuarioLogado } = req;
    const { id } = req.body;
    let dbClient;

    try {
        dbClient = await pool.connect();        
        if (!id) {
            return res.status(400).json({ error: 'ID do corte é obrigatório.' });
        }

        // 1. FAZEMOS O "SOFT DELETE" E PEGAMOS OS DADOS DO CORTE
        const result = await dbClient.query(
            `UPDATE cortes SET status = 'excluido' WHERE id = $1 RETURNING *`,
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Corte não encontrado para exclusão.' });
        }

        const corteExcluido = result.rows[0];

        // 2. LÓGICA DE CASCATA REFORÇADA
        // A OP associada está no campo `corteExcluido.op`.
        // Vamos verificar se ele existe e não é uma string vazia ou nula.
        const opNumeroParaCancelar = corteExcluido.op;

        if (opNumeroParaCancelar) {            
            // Query para cancelar a OP associada.
            // A condição `status NOT IN ('finalizado', 'cancelada')` é CRUCIAL para não
            // reabrir ou alterar uma OP que já foi concluída ou cancelada por outro motivo.
            const opCancelResult = await dbClient.query(
                `UPDATE ordens_de_producao 
                 SET status = 'cancelada' 
                 WHERE numero = $1 AND status NOT IN ('finalizado', 'cancelada')`,
                [opNumeroParaCancelar]
            );

            if(opCancelResult.rowCount > 0) {
            } else {
                console.warn(`[API Cortes DELETE] AVISO: A OP #${opNumeroParaCancelar} associada não foi encontrada para cancelamento ou seu status já era 'finalizado' ou 'cancelada'.`);
            }
        } else {
        }

        // 3. Responde ao frontend com sucesso.
        res.status(200).json({ message: 'Corte marcado como excluído com sucesso.', corte: corteExcluido });

    } catch (error) {
        console.error('[router/cortes DELETE] Erro ao marcar corte como excluído:', error);
        res.status(500).json({ error: 'Erro interno ao processar a exclusão do corte.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});


export default router;