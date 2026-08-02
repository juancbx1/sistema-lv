// api/configuracao-pontos.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';

// Importar a função de buscar permissões completas
import { getPermissoesCompletasUsuarioDB } from './usuarios.js'; // Verifique o caminho

const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    timezone: 'UTC', // Adicionado
});
const SECRET_KEY = process.env.JWT_SECRET;

// Função verificarToken (mantenha ou centralize)
const verificarToken = (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) throw new Error('Token não fornecido');
    const token = authHeader.split(' ')[1];
    if (!token) throw new Error('Token mal formatado');
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
        req.usuarioLogado = verificarToken(req);
        next();
    } catch (error) {
        console.error('[router/configuracao-pontos MID] Erro no middleware:', error.message);
        const statusCode = error.statusCode || 500;
        const responseError = { error: error.message };
        if (error.details) responseError.details = error.details;
        res.status(statusCode).json(responseError);
    }
});

router.get('/padrao', async (req, res) => {
    const { usuarioLogado } = req;
    const empresaId = req.empresaId;
    let dbCliente;
    try {
        dbCliente = await pool.connect();
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbCliente, usuarioLogado.id, empresaId);

        if (!permissoesCompletas.includes('acesso-ponto-por-processo')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }
        
        // AGORA RECEBE produto_id ou produto_nome (para busca textual se necessário)
        const { produto_id, produto_nome_busca, processo_nome, tipo_atividade, ativo } = req.query;
        let query = `
            SELECT 
                cpp.id, 
                cpp.produto_id, 
                p.nome AS produto_nome,  -- Nome do produto vindo da tabela 'produtos'
                cpp.processo_nome, 
                cpp.tipo_atividade, 
                cpp.pontos_padrao, 
                cpp.ativo, 
                cpp.data_criacao, 
                cpp.data_atualizacao, 
                cpp.atualizado_em 
            FROM configuracoes_pontos_processos cpp
            LEFT JOIN produtos p ON cpp.produto_id = p.id  -- JOIN para buscar o nome
        `;
        const queryParams = [empresaId];
        const conditions = ['cpp.empresa_id = $1'];
        let paramIndex = 2;

        if (produto_id) { // Filtro primário por ID
            queryParams.push(parseInt(produto_id));
            conditions.push(`cpp.produto_id = $${paramIndex++}`);
        } else if (produto_nome_busca) { // Filtro secundário por nome (para pesquisa textual)
            queryParams.push(`%${produto_nome_busca}%`);
            conditions.push(`p.nome ILIKE $${paramIndex++}`); // Busca no nome do produto da tabela 'produtos'
        }

        if (processo_nome) {
            queryParams.push(`%${processo_nome}%`);
            conditions.push(`cpp.processo_nome ILIKE $${paramIndex++}`);
        }
        if (tipo_atividade) {
            queryParams.push(tipo_atividade);
            conditions.push(`cpp.tipo_atividade = $${paramIndex++}`);
        }
        if (ativo !== undefined) {
            queryParams.push(ativo === 'true');
            conditions.push(`cpp.ativo = $${paramIndex++}`);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        // Ordenar pelo nome do produto (da tabela produtos)
        query += ' ORDER BY p.nome, cpp.tipo_atividade, cpp.processo_nome';

        const result = await dbCliente.query(query, queryParams);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[API GET /configuracao-pontos/padrao] Erro:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message });
    } finally {
        if (dbCliente) dbCliente.release();
    }
});


// POST /api/configuracao-pontos/padrao
// ROTA ATUALIZADA PARA INCLUIR tipo_atividade e usar "Arremate (Config)"
router.post('/padrao', async (req, res) => {
    const { usuarioLogado } = req;
    const empresaId = req.empresaId;
    let dbCliente;
    try {
        dbCliente = await pool.connect();
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbCliente, usuarioLogado.id, empresaId);
        if (!permissoesCompletas.includes('acesso-ponto-por-processo')) {
            return res.status(403).json({ error: 'Permissão negada para gerenciar configurações de pontos.' });
        }

        // AGORA RECEBE produto_id
        const { produto_id, processo_nome, pontos_padrao, tipo_atividade, ativo = true } = req.body;

        // VALIDAÇÃO para produto_id
        if (!produto_id || !pontos_padrao || !tipo_atividade) {
            return res.status(400).json({ error: 'Campos produto_id, tipo_atividade e pontos_padrao são obrigatórios.' });
        }
        const produtoIdNum = parseInt(produto_id);
        if (isNaN(produtoIdNum) || produtoIdNum <= 0) {
            return res.status(400).json({ error: 'produto_id inválido.'});
        }
        
        if (tipo_atividade !== 'arremate_tiktik' && !processo_nome) {
            return res.status(400).json({ error: 'Campo processo_nome é obrigatório para este tipo de atividade.' });
        }

        const pontosFloat = parseFloat(pontos_padrao);
        if (isNaN(pontosFloat) || pontosFloat <= 0) {
            return res.status(400).json({ error: 'pontos_padrao deve ser um número positivo.' });
        }

        const finalProcessoNome = (tipo_atividade === 'arremate_tiktik') 
                                    ? "Arremate (Config)" // Ou null se preferir, mas a constraint UNIQUE precisa lidar com isso
                                    : processo_nome;

        // Query UPSERT usando produto_id
        const upsertQuery = `
            INSERT INTO configuracoes_pontos_processos 
                (empresa_id, produto_id, processo_nome, tipo_atividade, pontos_padrao, ativo, data_criacao, data_atualizacao, atualizado_em)
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), NOW())
            ON CONFLICT (empresa_id, produto_id, processo_nome, tipo_atividade)
            DO UPDATE SET 
                pontos_padrao = EXCLUDED.pontos_padrao, 
                ativo = EXCLUDED.ativo, 
                data_atualizacao = CURRENT_TIMESTAMP,
                atualizado_em = CURRENT_TIMESTAMP
            RETURNING *;`; 
            // Para retornar o nome do produto, faríamos um JOIN após o RETURNING ou em uma query separada,
            // mas para o POST, geralmente só o objeto inserido/atualizado da tabela principal é suficiente.
            // A lista (GET) trará o nome.

        const result = await dbCliente.query(upsertQuery,
            [empresaId, produtoIdNum, finalProcessoNome, tipo_atividade, pontosFloat, ativo]
        );
        
        // Para retornar com o nome do produto (opcional, mas bom para consistência)
        const configRetornada = result.rows[0];
        const produtoInfo = await dbCliente.query('SELECT nome FROM produtos WHERE id = $1', [configRetornada.produto_id]);
        configRetornada.produto_nome = produtoInfo.rows.length > 0 ? produtoInfo.rows[0].nome : 'Produto Desconhecido';
        res.status(201).json(configRetornada);

    } catch (error) {
        console.error('[API POST /configuracao-pontos/padrao] Erro:', error.message);
        const statusCode = error.statusCode || (error.code === '23505' ? 409 : 500); 
        const errorMessage = error.code === '23505' 
            ? 'Erro de conflito: Já existe uma configuração para este produto, processo e tipo de atividade.' 
            : error.message;
        res.status(statusCode).json({ error: errorMessage, details: error.detail });
    } finally {
        if (dbCliente) dbCliente.release();
    }
});

// PUT /api/configuracao-pontos/padrao/:id
router.put('/padrao/:id', async (req, res) => {
    const { usuarioLogado } = req;
    const empresaId = req.empresaId;
    let dbCliente;
    try {
        dbCliente = await pool.connect();
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbCliente, usuarioLogado.id, empresaId);

        if (!permissoesCompletas.includes('acesso-ponto-por-processo')) {
            return res.status(403).json({ error: 'Permissão negada para atualizar configuração de pontos.' });
        }

        const configId = parseInt(req.params.id, 10);
        // AGORA SÓ ACEITA pontos_padrao e ativo para atualização via ID
        const { pontos_padrao, ativo } = req.body;

        if (isNaN(configId)) {
            return res.status(400).json({ error: 'ID inválido fornecido na URL.' });
        }

        if (pontos_padrao === undefined && ativo === undefined) {
            return res.status(400).json({ error: 'Nenhum campo (pontos_padrao ou ativo) para atualizar fornecido.' });
        }

        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;

        if (pontos_padrao !== undefined) {
            const pontosFloat = parseFloat(pontos_padrao);
            if (isNaN(pontosFloat) || pontosFloat <= 0) {
                return res.status(400).json({ error: 'pontos_padrao deve ser um número positivo.' });
            }
            updateFields.push(`pontos_padrao = $${paramIndex++}`);
            updateValues.push(pontosFloat);
        }
        if (ativo !== undefined) {
            if (typeof ativo !== 'boolean') {
                return res.status(400).json({ error: 'ativo deve ser um booleano (true ou false).' });
            }
            updateFields.push(`ativo = $${paramIndex++}`);
            updateValues.push(ativo);
        }
        
        updateFields.push(`data_atualizacao = CURRENT_TIMESTAMP`);
        updateFields.push(`atualizado_em = CURRENT_TIMESTAMP`);

        updateValues.push(configId); 
        
        const queryText = `
            UPDATE configuracoes_pontos_processos 
            SET ${updateFields.join(', ')} 
             WHERE id = $${paramIndex}
               AND empresa_id = $${paramIndex + 1}
             RETURNING *;`;
        updateValues.push(empresaId);
        const result = await dbCliente.query(queryText, updateValues);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Configuração de pontos não encontrada para atualização.' });
        }

        // Para retornar com o nome do produto
        const configRetornada = result.rows[0];
        const produtoInfo = await dbCliente.query('SELECT nome FROM produtos WHERE id = $1', [configRetornada.produto_id]);
        configRetornada.produto_nome = produtoInfo.rows.length > 0 ? produtoInfo.rows[0].nome : 'Produto Desconhecido';

        res.status(200).json(configRetornada);

    } catch (error) {
        console.error(`[API PUT /configuracao-pontos/padrao/${req.params.id}] Erro:`, error.message);
        res.status(error.statusCode || 500).json({ error: 'Erro interno ao atualizar configuração de pontos.', details: error.message });
    } finally {
        if (dbCliente) dbCliente.release();
    }
});

// DELETE /api/configuracao-pontos/padrao/:id
router.delete('/padrao/:id', async (req, res) => {
    const { usuarioLogado } = req;
    const empresaId = req.empresaId;
    let dbCliente;
    try {
        dbCliente = await pool.connect();
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbCliente, usuarioLogado.id, empresaId);

        if (!permissoesCompletas.includes('acesso-ponto-por-processo')) { // Ou 'excluir-ponto-por-processo'
            return res.status(403).json({ error: 'Permissão negada para excluir configuração de pontos.' });
        }

        const configId = parseInt(req.params.id, 10);
        if (isNaN(configId)) {
            return res.status(400).json({ error: 'ID inválido fornecido na URL.' });
        }
        const result = await dbCliente.query(
            'DELETE FROM configuracoes_pontos_processos WHERE id = $1 AND empresa_id = $2 RETURNING *;',
            [configId, empresaId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Configuração de pontos padrão não encontrada.' });
        }
        res.status(200).json({ message: 'Configuração de pontos padrão excluída com sucesso.', deletedItem: result.rows[0] });
    } catch (error) {
        console.error('[API DELETE /configuracao-pontos/padrao/:id] Erro:', error.message, error.stack ? error.stack.substring(0,300):"");
        res.status(error.statusCode || 500).json({ error: error.message });
    } finally {
        if (dbCliente) dbCliente.release();
    }
});

export default router;
