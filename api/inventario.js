// api/inventario.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';

// Importar a função de buscar permissões completas
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';
import { obterEmpresaIdDoContexto } from './contexto-empresa.js';

const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    timezone: 'UTC',
});
const SECRET_KEY = process.env.JWT_SECRET;

// --- Middleware de Autenticação e Permissão para este router ---
router.use(async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Token não fornecido' });
        const token = authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Token mal formatado' });

        const decoded = jwt.verify(token, SECRET_KEY);
        req.usuarioLogado = decoded;
        req.empresaId = obterEmpresaIdDoContexto(req);

        // VERIFICAÇÃO DE PERMISSÃO CENTRALIZADA
        const dbClient = await pool.connect();
        try {
            const permissoesUsuario = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id, req.empresaId);
            if (!permissoesUsuario.includes('fazer-inventario')) { // A permissão que definimos!
                return res.status(403).json({ error: 'Permissão negada para gerenciar inventários.' });
            }
            // Se tem permissão, anexa o cliente do banco na requisição para ser usado nas rotas
            req.dbClient = dbClient;
            next();
        } catch (error) {
            dbClient.release(); // Libera o cliente em caso de erro na verificação
            throw error; // Propaga o erro
        }
    } catch (err) {
        console.error('[API/inventario Middleware] Erro de autenticação/permissão:', err);
        res.status(401).json({ error: 'Token inválido, expirado ou permissão insuficiente.', details: err.name });
    }
});


// Rota para iniciar uma nova sessão de inventário
router.post('/iniciar', async (req, res) => {
    const { usuarioLogado, dbClient, empresaId } = req;
    const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotency_key || '').trim() || null;

    if (idempotencyKey && idempotencyKey.length > 200) {
        return res.status(400).json({ error: 'Idempotency-Key excede o limite de 200 caracteres.' });
    }
    const { observacoes } = req.body; // Permite que o frontend envie uma observação inicial

    try {
        await dbClient.query('BEGIN'); // Inicia a transação

        // 1. Verifica se já existe um inventário em andamento para evitar duplicidade
        if (idempotencyKey) {
            await dbClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${empresaId}:${idempotencyKey}`]);
            const repeticao = await dbClient.query(
                `SELECT id, status, data_inicio
                   FROM inventario_sessoes
                  WHERE empresa_id = $1 AND idempotency_key = $2
                  FOR UPDATE`,
                [empresaId, idempotencyKey],
            );
            if (repeticao.rowCount > 0) {
                await dbClient.query('COMMIT');
                return res.status(200).json({
                    message: 'Sessao de inventario ja iniciada anteriormente.',
                    sessao: repeticao.rows[0],
                    idempotente: true,
                });
            }
        }

        const checkExistente = await dbClient.query(
            "SELECT id FROM inventario_sessoes WHERE empresa_id = $1 AND status = 'EM_ANDAMENTO' LIMIT 1",
            [empresaId]
        );

        if (checkExistente.rows.length > 0) {
            // Lança um erro com status 409 (Conflict)
            const err = new Error('Já existe um inventário em andamento. Finalize-o antes de iniciar um novo.');
            err.statusCode = 409;
            throw err;
        }

        // 2. Cria a nova sessão de inventário
        const novaSessaoResult = await dbClient.query(
            `INSERT INTO inventario_sessoes (empresa_id, idempotency_key, usuario_responsavel_id, status, observacoes)
             VALUES ($1, $2, $3, 'EM_ANDAMENTO', $4)
             RETURNING id, status, data_inicio`,
            [empresaId, idempotencyKey, usuarioLogado.id, observacoes || null]
        );
        const novaSessao = novaSessaoResult.rows[0];

        // 3. Busca o saldo atual de TODOS os itens de estoque ativos
        // Esta query é a mesma do seu endpoint /saldo, garantindo consistência.
        const querySaldoText = `
            WITH SaldosAgregados AS (
                SELECT
                    produto_id,
                    variante_nome,
                    SUM(
                        CASE 
                            WHEN tipo_movimento LIKE 'ENTRADA%' OR tipo_movimento = 'AJUSTE_BALANCO_POSITIVO' OR tipo_movimento LIKE 'ESTORNO%' THEN quantidade
                            WHEN tipo_movimento LIKE 'SAIDA%' OR tipo_movimento = 'AJUSTE_BALANCO_NEGATIVO' THEN -ABS(quantidade) 
                            ELSE 0 
                        END
                    ) AS saldo_atual
                FROM estoque_movimentos
                WHERE empresa_id = $1
                GROUP BY produto_id, variante_nome
            )
            SELECT
                s.produto_id,
                p.nome AS produto_nome,
                COALESCE(s.variante_nome, '-') AS variante_nome,
                s.saldo_atual,
                COALESCE(g.sku, p.sku, p.id::text) AS produto_ref_id
            FROM SaldosAgregados s
            JOIN produtos p ON s.produto_id = p.id AND p.empresa_id = $1
            LEFT JOIN jsonb_to_recordset(p.grade) AS g(sku TEXT, variacao TEXT) ON g.variacao = s.variante_nome
            WHERE COALESCE(g.sku, p.sku, p.id::text) NOT IN (
                SELECT produto_ref_id FROM estoque_itens_arquivados WHERE empresa_id = $1
            )
              AND s.saldo_atual IS NOT NULL;
        `;
        
        const saldoResult = await dbClient.query(querySaldoText, [empresaId]);
        const itensEmEstoque = saldoResult.rows;

        // 4. Insere cada item na tabela 'inventario_itens' como a "fotografia" inicial
        if (itensEmEstoque.length > 0) {
            // Monta uma única query de inserção em lote para performance
            const insertItensQuery = `
                INSERT INTO inventario_itens (empresa_id, id_sessao_inventario, produto_ref_id, quantidade_sistema, quantidade_contada)
                VALUES ${itensEmEstoque.map((_, i) => `($${i*4 + 1}, $${i*4 + 2}, $${i*4 + 3}, $${i*4 + 4}, NULL)`).join(', ')}
            `;
            const insertItensValues = itensEmEstoque.flatMap(item => [empresaId, novaSessao.id, item.produto_ref_id, item.saldo_atual]);
            
            await dbClient.query(insertItensQuery, insertItensValues);
        }

        await dbClient.query('COMMIT'); // Confirma todas as operações
        
        // Retorna a sessão criada para o frontend poder trabalhar com ela
        res.status(201).json({
            message: 'Nova sessão de inventário iniciada com sucesso.',
            sessao: novaSessao,
            totalItens: itensEmEstoque.length
        });

    } catch (error) {
        await dbClient.query('ROLLBACK').catch(() => undefined); // Desfaz tudo em caso de erro
        console.error('[API POST /inventario/iniciar] Erro:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao iniciar nova sessão de inventário.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// Rota para listar sessões de inventário existentes
router.get('/sessoes', async (req, res) => {
    const { dbClient, empresaId } = req;
    try {
        // Query para buscar as sessões e juntar com a tabela de usuários para pegar o nome do responsável
        const query = `
            SELECT 
                s.id, 
                s.status, 
                s.data_inicio, 
                s.data_fim, 
                u.nome_usuario AS usuario_responsavel
            FROM inventario_sessoes s
            JOIN usuarios u ON s.usuario_responsavel_id = u.id
            WHERE s.empresa_id = $1
            ORDER BY s.id DESC;
        `;

        const result = await dbClient.query(query, [empresaId]);

        // Opcional: Separar a sessão em andamento das demais para facilitar no frontend
        const sessaoEmAndamento = result.rows.find(s => s.status === 'EM_ANDAMENTO') || null;
        const historicoSessoes = result.rows.filter(s => s.status !== 'EM_ANDAMENTO');
        
        res.status(200).json({
            sessaoEmAndamento: sessaoEmAndamento,
            historico: historicoSessoes
        });

    } catch (error) {
        console.error('[API GET /inventario/sessoes] Erro:', error);
        res.status(500).json({ error: 'Erro ao listar sessões de inventário.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// Rota para buscar os detalhes de UMA sessão de inventário
router.get('/sessoes/:id', async (req, res) => {
    const { dbClient, empresaId } = req;
    const { id } = req.params;

    try {
        await dbClient.query('BEGIN');

        // 1. Busca os dados da sessão, JÁ INCLUINDO o nome do usuário
        const sessaoQuery = `
            SELECT s.*, u.nome_usuario AS usuario_responsavel
            FROM inventario_sessoes s
            JOIN usuarios u ON s.usuario_responsavel_id = u.id
            WHERE s.id = $1 AND s.empresa_id = $2
        `;
        const sessaoResult = await dbClient.query(sessaoQuery, [id, empresaId]);
        if (sessaoResult.rows.length === 0) {
            const err = new Error('Sessão de inventário não encontrada.');
            err.statusCode = 404;
            throw err;
        }
        const sessao = sessaoResult.rows[0];

        // 2. Busca os itens da sessão, enriquecendo com dados dos produtos
        const itensQuery = `
            SELECT
                ii.produto_ref_id,
                ii.quantidade_sistema,
                ii.quantidade_contada,
                COALESCE(p.nome, p_grade.nome) AS produto_nome,
                COALESCE(g.variacao, '-') AS variante_nome,
                COALESCE(g.imagem, p.imagem, p_grade.imagem) as imagem
            FROM 
                inventario_itens ii
            LEFT JOIN produtos p ON p.sku = ii.produto_ref_id AND p.empresa_id = $2
            LEFT JOIN (
                SELECT p_sub.id as produto_id, p_sub.empresa_id, gr.sku, gr.variacao, gr.imagem
                FROM produtos p_sub, jsonb_to_recordset(p_sub.grade) AS gr(sku TEXT, variacao TEXT, imagem TEXT)
            ) AS g ON g.sku = ii.produto_ref_id AND g.empresa_id = $2
            LEFT JOIN produtos p_grade ON p_grade.id = g.produto_id AND p_grade.empresa_id = $2
            WHERE ii.empresa_id = $2 AND ii.id_sessao_inventario = $1
            ORDER BY produto_nome, variante_nome;
        `;
        const itensResult = await dbClient.query(itensQuery, [id, empresaId]);

        await dbClient.query('COMMIT');

        res.status(200).json({
            sessao: sessao,
            itens: itensResult.rows
        });

    } catch (error) {
        await dbClient.query('ROLLBACK').catch(() => undefined);
        console.error(`[API GET /inventario/sessoes/${id}] Erro:`, error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao buscar detalhes da sessão.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// Rota para salvar a contagem de um ou mais itens
router.post('/sessoes/:id/contar', async (req, res) => {
    const { dbClient, empresaId } = req;
    const { id: idSessao } = req.params;
    const { produto_ref_id, quantidade_contada } = req.body; // Recebe dados de um único item

    // Validação dos dados recebidos
    if (!produto_ref_id || quantidade_contada === undefined) {
        return res.status(400).json({ error: 'produto_ref_id e quantidade_contada são obrigatórios.' });
    }

    const qtd = parseInt(quantidade_contada, 10);
    if (isNaN(qtd) || qtd < 0) {
        return res.status(400).json({ error: 'A quantidade contada deve ser um número não negativo.' });
    }

    try {
        // Query para atualizar a contagem do item específico na sessão correta
        // A cláusula WHERE garante que só atualizemos o item na sessão correta.
        const updateQuery = `
            UPDATE inventario_itens
            SET 
                quantidade_contada = $1,
                data_contagem = CURRENT_TIMESTAMP
            WHERE 
                empresa_id = $3 AND id_sessao_inventario = $2 AND produto_ref_id = $4;
        `;

        const result = await dbClient.query(updateQuery, [qtd, idSessao, empresaId, produto_ref_id]);

        if (result.rowCount === 0) {
            // Isso não deveria acontecer se a sessão foi criada corretamente, mas é uma boa verificação de segurança.
            const err = new Error('Item não encontrado nesta sessão de inventário.');
            err.statusCode = 404;
            throw err;
        }

        res.status(200).json({ message: 'Contagem salva com sucesso.' });

    } catch (error) {
        console.error(`[API POST /inventario/sessoes/${idSessao}/contar] Erro:`, error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao salvar contagem.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// Rota para finalizar e aplicar os ajustes do inventário
router.post('/sessoes/:id/finalizar', async (req, res) => {
    const { usuarioLogado, dbClient, empresaId } = req;
    const { id: idSessao } = req.params;

    try {
        await dbClient.query('BEGIN');

        // 1. Valida a sessão
        const sessaoResult = await dbClient.query(
            "SELECT * FROM inventario_sessoes WHERE id = $1 AND empresa_id = $2 FOR UPDATE", // 'FOR UPDATE' trava a linha para evitar finalizações simultâneas
            [idSessao, empresaId]
        );
        if (sessaoResult.rows.length === 0) throw new Error('Sessão de inventário não encontrada.');
        if (sessaoResult.rows[0].status !== 'EM_ANDAMENTO') throw new Error('Esta sessão de inventário não está em andamento e não pode ser finalizada.');

        // 2. Busca todos os itens que foram contados na sessão
        const itensContadosResult = await dbClient.query(
            `SELECT * FROM inventario_itens WHERE empresa_id = $2 AND id_sessao_inventario = $1 AND quantidade_contada IS NOT NULL`,
            [idSessao, empresaId]
        );
        const itensContados = itensContadosResult.rows;

        let ajustesRealizados = 0;
        const usuarioResponsavelNome = usuarioLogado.nome || usuarioLogado.nome_usuario;

        // 3. Itera sobre os itens contados para criar os movimentos de ajuste
        for (const item of itensContados) {
            const diferenca = item.quantidade_contada - item.quantidade_sistema;

            // Só cria movimento se houver diferença
            if (diferenca !== 0) {
                ajustesRealizados++;
                const tipoMovimento = diferenca > 0 ? 'AJUSTE_BALANCO_POSITIVO' : 'AJUSTE_BALANCO_NEGATIVO';
                const observacao = `Ajuste do Inventário #${idSessao}. Sistema: ${item.quantidade_sistema}, Contado: ${item.quantidade_contada}.`;

                // Busca o produto_id e variante_nome correspondentes ao produto_ref_id
                const produtoInfoQuery = `
                    SELECT 
                        COALESCE(p.id, p_grade.id) AS produto_id,
                        COALESCE(g.variacao, NULL) AS variante_nome
                    FROM (SELECT 1) dummy -- Tabela dummy para garantir que sempre haja uma linha
                        LEFT JOIN produtos p ON p.sku = $1 AND p.empresa_id = $2
                    LEFT JOIN (
                            SELECT p_sub.id as produto_id, p_sub.empresa_id, gr.sku, gr.variacao
                            FROM produtos p_sub, jsonb_to_recordset(p_sub.grade) AS gr(sku TEXT, variacao TEXT)
                        ) AS g ON g.sku = $1 AND g.empresa_id = $2
                        LEFT JOIN produtos p_grade ON p_grade.id = g.produto_id AND p_grade.empresa_id = $2;
                `;
                const produtoInfoResult = await dbClient.query(produtoInfoQuery, [item.produto_ref_id, empresaId]);
                if (!produtoInfoResult.rows[0].produto_id) {
                    // Se não encontrar o produto, lança um erro para cancelar a transação
                    throw new Error(`Produto com SKU ${item.produto_ref_id} não encontrado no sistema.`);
                }
                const { produto_id, variante_nome } = produtoInfoResult.rows[0];
                
                // Insere o movimento no estoque
                await dbClient.query(
                    `INSERT INTO estoque_movimentos (empresa_id, idempotency_key, produto_id, variante_nome, quantidade, tipo_movimento, usuario_responsavel, observacao)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [empresaId, `inventario:${empresaId}:${idSessao}:${item.id}`, produto_id, variante_nome, diferenca, tipoMovimento, usuarioResponsavelNome, observacao]
                );
            }
        }

        // 4. Atualiza o status e a data de fim da sessão de inventário
        await dbClient.query(
            "UPDATE inventario_sessoes SET status = 'FINALIZADO', data_fim = CURRENT_TIMESTAMP WHERE id = $1 AND empresa_id = $2",
            [idSessao, empresaId]
        );

        await dbClient.query('COMMIT');

        res.status(200).json({
            message: `Inventário #${idSessao} finalizado com sucesso. ${ajustesRealizados} itens tiveram seus saldos ajustados.`,
            ajustesRealizados: ajustesRealizados,
        });

    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error(`[API POST /inventario/sessoes/${idSessao}/finalizar] Erro:`, error);
        res.status(error.statusCode || 500).json({ error: 'Erro ao finalizar inventário.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});


export default router;
