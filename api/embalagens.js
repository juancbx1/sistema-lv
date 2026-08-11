// api/embalagens.js

import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';
import { obterEmpresaIdDoContexto } from './contexto-empresa.js';
import { getPermissoesCompletasUsuarioDB } from './usuarios.js'; // Ajuste o caminho se necessário
import { verificarEAtualizarDemandasPorSKU } from './utils/diagnosticoProducao.js';
import {
    alocarOrigensProdutoPronto,
    auditarOrigensProdutoPronto,
    construirCteOrigensProdutoPronto,
    estornarAlocacoesEmbalagem,
    listarOrigensProdutoProntoDisponiveis,
    obterEstruturaOrigensProdutoPronto,
    registrarAlocacoesEmbalagem,
    serializarAlocacoesCompativeis,
} from './utils/origens-produto-pronto.js';
import {
    converterConsertoEmAvaria,
    listarOcorrenciasConserto,
    registrarOcorrenciaEmbalagem,
    retornarConsertoEmbalagem,
    verificarAcessoOcorrenciasEmbalagem,
} from './utils/ocorrencias-embalagem.js';

const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    timezone: 'UTC',
});
const SECRET_KEY = process.env.JWT_SECRET;

// --- Função de Verificação de Token (pode ser centralizada em um arquivo 'utils' no futuro) ---
const verificarToken = (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        const error = new Error('Token não fornecido');
        error.statusCode = 401;
        throw error;
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
        const error = new Error('Token mal formatado');
        error.statusCode = 401;
        throw error;
    }
    try {
        return jwt.verify(token, SECRET_KEY);
    } catch (err) {
        const error = new Error('Token inválido ou expirado');
        error.statusCode = 401;
        if (err.name === 'TokenExpiredError') error.details = 'jwt expired';
        throw error;
    }
};

// --- Middleware de Autenticação para este Router ---
router.use(async (req, res, next) => {
    try {
        req.usuarioLogado = verificarToken(req);
        req.empresaId = obterEmpresaIdDoContexto(req);
        next();
    } catch (error) {
        const statusCode = error.statusCode || 500;
        const responseError = { error: error.message };
        if (error.details) responseError.details = error.details;
        res.status(statusCode).json(responseError);
    }
});

// POST /api/embalagens/ocorrencias
// Consome saldo pronto para embalagem sem alterar Produções, POS_OP ou pontos.
router.post('/ocorrencias', async (req, res) => {
    const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
    let dbClient;
    try {
        if (!idempotencyKey) {
            return res.status(400).json({ error: 'Idempotency-Key é obrigatória para registrar uma ocorrência.' });
        }
        dbClient = await pool.connect();
        const resultado = await registrarOcorrenciaEmbalagem({
            dbClient,
            usuarioLogado: req.usuarioLogado,
            empresaId: req.empresaId,
            payload: req.body,
            idempotencyKey,
        });
        return res.status(resultado.idempotente ? 200 : 201).json(resultado);
    } catch (error) {
        console.error('[API POST /embalagens/ocorrencias] Erro:', error);
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao registrar ocorrência na Embalagem.',
            ...(error.codigo ? { codigo: error.codigo } : {}),
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/embalagens/ocorrencias/consertos
router.get('/ocorrencias/consertos', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        await verificarAcessoOcorrenciasEmbalagem(
            dbClient,
            req.usuarioLogado,
            req.empresaId,
        );
        const rows = await listarOcorrenciasConserto({
            dbClient,
            empresaId: req.empresaId,
        });
        return res.status(200).json({ rows });
    } catch (error) {
        console.error('[API GET /embalagens/ocorrencias/consertos] Erro:', error);
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao buscar consertos pendentes.',
            ...(error.codigo ? { codigo: error.codigo } : {}),
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/embalagens/ocorrencias/:id/retornar-conserto
router.post('/ocorrencias/:id/retornar-conserto', async (req, res) => {
    let dbClient;
    try {
        const ocorrenciaId = Number(req.params.id);
        if (!Number.isInteger(ocorrenciaId) || ocorrenciaId <= 0) {
            return res.status(400).json({ error: 'ID de ocorrência inválido.' });
        }
        dbClient = await pool.connect();
        const resultado = await retornarConsertoEmbalagem({
            dbClient,
            usuarioLogado: req.usuarioLogado,
            empresaId: req.empresaId,
            ocorrenciaId,
            payload: req.body,
        });
        return res.status(200).json(resultado);
    } catch (error) {
        console.error('[API POST /embalagens/ocorrencias/:id/retornar-conserto] Erro:', error);
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao retornar produto do conserto.',
            ...(error.codigo ? { codigo: error.codigo } : {}),
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/embalagens/ocorrencias/:id/converter-avaria
router.post('/ocorrencias/:id/converter-avaria', async (req, res) => {
    let dbClient;
    try {
        const ocorrenciaId = Number(req.params.id);
        if (!Number.isInteger(ocorrenciaId) || ocorrenciaId <= 0) {
            return res.status(400).json({ error: 'ID de ocorrência inválido.' });
        }
        dbClient = await pool.connect();
        const resultado = await converterConsertoEmAvaria({
            dbClient,
            usuarioLogado: req.usuarioLogado,
            empresaId: req.empresaId,
            ocorrenciaId,
            payload: req.body,
        });
        return res.status(200).json(resultado);
    } catch (error) {
        console.error('[API POST /embalagens/ocorrencias/:id/converter-avaria] Erro:', error);
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao encerrar conserto como avaria.',
            ...(error.codigo ? { codigo: error.codigo } : {}),
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- Rota GET /api/embalagens/historico ---
router.get('/historico', async (req, res) => {
    const { usuarioLogado } = req;
    const { produto_ref_id, page = 1, limit = 5 } = req.query;

    if (!produto_ref_id) {
        return res.status(400).json({ error: "O SKU (produto_ref_id) é obrigatório." });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        if (!permissoes.includes('acesso-embalagem-de-produtos')) {
            return res.status(403).json({ error: 'Permissão negada para visualizar o histórico.' });
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        // --- QUERY COM UNION PARA JUNTAR OS DOIS TIPOS DE HISTÓRICO ---
        const queryBase = `
            -- Parte 1: Embalagens DESTE produto (apenas se for UNIDADE)
            SELECT id FROM embalagens_realizadas
            WHERE produto_ref_id = $1 AND empresa_id = $2 AND tipo_embalagem = 'UNIDADE'

            UNION

            -- Parte 2: Embalagens de KITS que usaram este produto como COMPONENTE
            SELECT id FROM embalagens_realizadas
            WHERE empresa_id = $2 AND tipo_embalagem = 'KIT' AND
                  jsonb_path_exists(componentes_consumidos, '$[*] ? (@.sku == $sku)', jsonb_build_object('sku', $1))
        `;

        // Query de Contagem
        const countQuery = `SELECT COUNT(*) as total_count FROM (${queryBase}) as subquery`;
        const countResult = await dbClient.query(countQuery, [produto_ref_id, req.empresaId]);
        const total = parseInt(countResult.rows[0].total_count) || 0;
        const totalPages = Math.ceil(total / parseInt(limit)) || 1;

        // Query de Dados
        const dataQuery = `
            SELECT 
                er.id, er.tipo_embalagem, er.quantidade_embalada, er.data_embalagem, er.observacao, er.status, 
                p.nome as produto_embalado_nome, er.variante_embalada_nome, u.nome as usuario_responsavel
            FROM embalagens_realizadas er
            JOIN produtos p ON er.produto_embalado_id = p.id
            LEFT JOIN usuarios u ON er.usuario_responsavel_id = u.id
            WHERE er.id IN (${queryBase}) -- Filtra pelos IDs encontrados nas duas condições
              AND er.empresa_id = $2
            ORDER BY er.data_embalagem DESC
            LIMIT $3 OFFSET $4;
        `;
        
        const result = await dbClient.query(dataQuery, [produto_ref_id, req.empresaId, parseInt(limit), offset]);
        
        res.status(200).json({ rows: result.rows, total: total, page: parseInt(page), pages: totalPages });

    } catch (error) {
        console.error('[API /embalagens/historico] Erro na query:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico de embalagens.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.post('/estornar', async (req, res) => {
    const { usuarioLogado } = req;
    const { id_embalagem_realizada } = req.body;

    if (!id_embalagem_realizada) {
        return res.status(400).json({ error: "O ID da embalagem a ser estornada é obrigatório." });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        
        // A permissão para estornar pode ser a mesma de lançar uma embalagem
        if (!permissoes.includes('lancar-embalagem')) {
            return res.status(403).json({ error: 'Permissão negada para estornar embalagens.' });
        }

        // Inicia a transação para garantir a atomicidade das operações
        await dbClient.query('BEGIN');

        // 1. Busca os detalhes da embalagem que será estornada.
        //    Trava a linha (FOR UPDATE) para evitar que a mesma embalagem seja estornada duas vezes simultaneamente.
        const embalagemOriginalRes = await dbClient.query(
            `SELECT * FROM embalagens_realizadas WHERE id = $1 AND empresa_id = $2 FOR UPDATE`,
            [id_embalagem_realizada, req.empresaId]
        );

        if (embalagemOriginalRes.rows.length === 0) {
            // Se não encontrou, o ID não existe no banco.
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Registro de embalagem não encontrado.' });
        }

        const embalagemOriginal = embalagemOriginalRes.rows[0];

        // 2. VERIFICA O STATUS: Impede o estorno se já foi estornado.
        if (embalagemOriginal.status === 'ESTORNADO') {
            await dbClient.query('ROLLBACK');
            // Retorna um erro 409 Conflict, que é o código HTTP correto para "conflito com o estado atual do recurso".
            return res.status(409).json({ error: 'Esta embalagem já foi estornada anteriormente e não pode ser revertida novamente.' });
        }
        
        // 3. Cria um novo movimento de ESTOQUE de SAÍDA para reverter a entrada original.
        const { produto_embalado_id, variante_embalada_nome, quantidade_embalada, movimento_estoque_id, tipo_embalagem, componentes_consumidos } = embalagemOriginal;
        
        const estornoMovimentoQuery = `
            INSERT INTO estoque_movimentos 
                (empresa_id, idempotency_key, produto_id, variante_nome, quantidade, tipo_movimento, usuario_responsavel, observacao)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        await dbClient.query(estornoMovimentoQuery, [
            req.empresaId,
            `embalagem-estorno:${req.empresaId}:${id_embalagem_realizada}`,
            produto_embalado_id,
            variante_embalada_nome,
            -Math.abs(quantidade_embalada), // Garante que a quantidade seja negativa
            `ESTORNO_${tipo_embalagem}`, // Ex: 'ESTORNO_UNIDADE' ou 'ESTORNO_KIT'
            (usuarioLogado.nome || usuarioLogado.nome_usuario),
            `Estorno referente à embalagem #${id_embalagem_realizada}`
        ]);

        // 4. Devolve o saldo às origens canônicas ou, na ausência delas, aos
        // lotes legados. As alocações normalizadas são a autoridade nova.
        const estornoCanonico = await estornarAlocacoesEmbalagem(dbClient, {
            empresaId: req.empresaId,
            embalagemId: id_embalagem_realizada,
        });
        if (!estornoCanonico && tipo_embalagem === 'UNIDADE') {
            const movEstoqueOriginalRes = await dbClient.query(
                `SELECT em.origem_arremate_id
                   FROM estoque_movimentos em
                   JOIN arremates a ON a.id = em.origem_arremate_id
                                      AND a.empresa_id = $2
                  WHERE em.id = $1`,
                [movimento_estoque_id, req.empresaId]
            );
            if (movEstoqueOriginalRes.rows.length > 0 && movEstoqueOriginalRes.rows[0].origem_arremate_id) {
                const arremateOrigemId = movEstoqueOriginalRes.rows[0].origem_arremate_id;
                await dbClient.query(
                    `UPDATE arremates SET quantidade_ja_embalada = quantidade_ja_embalada - $1 WHERE id = $2 AND empresa_id = $3`,
                    [quantidade_embalada, arremateOrigemId, req.empresaId]
                );
            } else if (Array.isArray(componentes_consumidos) && componentes_consumidos.length > 0) {
                for (const componente of componentes_consumidos) {
                    if (!componente.id_arremate || !componente.quantidade_usada) continue;
                    await dbClient.query(
                        `UPDATE arremates
                            SET quantidade_ja_embalada = quantidade_ja_embalada - $1
                          WHERE id = $2
                            AND empresa_id = $3
                            AND quantidade_ja_embalada >= $1`,
                        [componente.quantidade_usada, componente.id_arremate, req.empresaId],
                    );
                }
            } else {
                throw new Error(`Não foi possível rastrear a origem para a embalagem de UNIDADE #${id_embalagem_realizada}.`);
            }
        } else if (!estornoCanonico && tipo_embalagem === 'KIT' && componentes_consumidos) {
            // Se for KIT, itera sobre o JSON de componentes salvos para reverter cada um.
            for(const componente of componentes_consumidos) {
                // A lógica aqui assume que `componentes_consumidos` é um array de objetos com `{id_arremate, quantidade_usada}`
                if (!componente.id_arremate || !componente.quantidade_usada) {
                    throw new Error(`Componente malformado no JSON da embalagem de KIT #${id_embalagem_realizada}.`);
                }
                await dbClient.query(
                    `UPDATE arremates SET quantidade_ja_embalada = quantidade_ja_embalada - $1 WHERE id = $2 AND empresa_id = $3`,
                    [componente.quantidade_usada, componente.id_arremate, req.empresaId]
                );
            }
        } else if (!estornoCanonico) {
             // Lança um erro se não for possível rastrear a origem, forçando o ROLLBACK.
             throw new Error(`Não foi possível rastrear a origem dos arremates para a embalagem #${id_embalagem_realizada}.`);
        }

        // 5. Marca a embalagem original como estornada.
        await dbClient.query(
            `UPDATE embalagens_realizadas SET status = 'ESTORNADO' WHERE id = $1 AND empresa_id = $2`,
            [id_embalagem_realizada, req.empresaId]
        );

        // 6. Confirma a transação
        await dbClient.query('COMMIT');
        
        res.status(200).json({ message: 'Embalagem estornada com sucesso!' });

    } catch (error) {
        if (dbClient) {
            // Em caso de qualquer erro no bloco try, desfaz todas as operações
            console.error(`[API /embalagens/estornar] Erro na transação para embalagem ID ${id_embalagem_realizada}. Executando ROLLBACK. Erro:`, error.message);
            await dbClient.query('ROLLBACK');
        }
        res.status(500).json({ error: 'Erro interno ao estornar a embalagem.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/embalagens/unidade
// Consome as origens FIFO, cria a embalagem e registra a entrada no estoque
// na mesma transação. O endpoint antigo de estoque permanece compatível.
router.post('/unidade', async (req, res) => {
    const { usuarioLogado } = req;
    const empresaId = req.empresaId;
    const idempotencyKey = String(
        req.get('Idempotency-Key') || req.body?.idempotency_key || '',
    ).trim();
    const {
        produto_id,
        variante_nome,
        quantidade_embalada,
        observacao,
    } = req.body || {};

    if (!idempotencyKey) {
        return res.status(400).json({ error: 'Idempotency-Key é obrigatória para registrar a embalagem.' });
    }
    if (idempotencyKey.length > 200) {
        return res.status(400).json({ error: 'Idempotency-Key excede o limite de 200 caracteres.' });
    }

    const quantidade = Number(quantidade_embalada);
    if (!Number.isInteger(quantidade) || quantidade <= 0 || !produto_id) {
        return res.status(400).json({ error: 'Produto e quantidade inteira positiva são obrigatórios.' });
    }

    let dbClient;
    let transacaoAberta = false;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(
            dbClient,
            usuarioLogado.id,
            empresaId,
        );
        if (!permissoes.includes('lancar-embalagem')) {
            return res.status(403).json({ error: 'Permissão negada para registrar embalagem.' });
        }

        const produtoResult = await dbClient.query(
            'SELECT id, sku, grade FROM produtos WHERE id = $1 AND empresa_id = $2',
            [Number(produto_id), empresaId],
        );
        if (produtoResult.rowCount === 0) {
            return res.status(404).json({ error: 'Produto não encontrado na empresa ativa.' });
        }
        const produto = produtoResult.rows[0];
        const varianteBanco = !variante_nome || variante_nome === '-' ? null : String(variante_nome);
        const grade = Array.isArray(produto.grade) ? produto.grade : [];
        const gradeSelecionada = grade.find((item) => (
            String(item?.variacao || '') === String(varianteBanco || '')
        ));
        const produtoRefId = gradeSelecionada?.sku || produto.sku;
        if (!produtoRefId) {
            return res.status(409).json({ error: 'O produto não possui SKU para entrada no estoque.' });
        }

        await dbClient.query('BEGIN');
        transacaoAberta = true;
        await dbClient.query(
            'SELECT pg_advisory_xact_lock(hashtext($1))',
            [`embalagem:${empresaId}:${idempotencyKey}`],
        );
        const repeticao = await dbClient.query(`
            SELECT id, movimento_estoque_id, produto_embalado_id,
                   variante_embalada_nome, quantidade_embalada
              FROM embalagens_realizadas
             WHERE empresa_id = $1
               AND idempotency_key = $2
             FOR UPDATE
        `, [empresaId, idempotencyKey]);
        if (repeticao.rowCount > 0) {
            const existente = repeticao.rows[0];
            if (
                existente.produto_embalado_id !== Number(produto_id)
                || existente.variante_embalada_nome !== varianteBanco
                || existente.quantidade_embalada !== quantidade
            ) {
                const error = new Error('Idempotency-Key já utilizada com outro payload.');
                error.statusCode = 409;
                throw error;
            }
            await dbClient.query('COMMIT');
            transacaoAberta = false;
            return res.status(200).json({
                message: 'Embalagem já registrada anteriormente.',
                embalagem_id: existente.id,
                movimento_estoque_id: existente.movimento_estoque_id,
                idempotente: true,
            });
        }

        const { estrutura, alocacoes } = await alocarOrigensProdutoPronto(dbClient, {
            empresaId,
            produtoId: Number(produto_id),
            variante: varianteBanco,
            quantidade,
        });
        const origensCompat = serializarAlocacoesCompativeis(alocacoes);
        const embalagemResult = await dbClient.query(`
            INSERT INTO embalagens_realizadas (
                empresa_id,
                idempotency_key,
                tipo_embalagem,
                produto_embalado_id,
                variante_embalada_nome,
                produto_ref_id,
                quantidade_embalada,
                usuario_responsavel_id,
                observacao,
                status,
                componentes_consumidos
            )
            VALUES ($1, $2, 'UNIDADE', $3, $4, $5, $6, $7, $8, 'ATIVO', $9)
            RETURNING id
        `, [
            empresaId,
            idempotencyKey,
            Number(produto_id),
            varianteBanco,
            produtoRefId,
            quantidade,
            usuarioLogado.id,
            observacao || null,
            JSON.stringify(origensCompat),
        ]);
        const embalagemId = embalagemResult.rows[0].id;

        await registrarAlocacoesEmbalagem(dbClient, {
            empresaId,
            embalagemId,
            alocacoes,
            estrutura,
        });

        const movimentoQuery = estrutura.estoqueEmbalagem
            ? `INSERT INTO estoque_movimentos (
                    empresa_id, idempotency_key, produto_id, variante_nome,
                    quantidade, tipo_movimento, embalagem_origem_id,
                    usuario_responsavel, observacao
               ) VALUES ($1, $2, $3, $4, $5, 'ENTRADA_PRODUCAO', $6, $7, $8)
               RETURNING id`
            : `INSERT INTO estoque_movimentos (
                    empresa_id, idempotency_key, produto_id, variante_nome,
                    quantidade, tipo_movimento, usuario_responsavel, observacao
               ) VALUES ($1, $2, $3, $4, $5, 'ENTRADA_PRODUCAO', $6, $7)
               RETURNING id`;
        const movimentoParams = estrutura.estoqueEmbalagem
            ? [
                empresaId, idempotencyKey, Number(produto_id), varianteBanco,
                quantidade, embalagemId,
                usuarioLogado.nome || usuarioLogado.nome_usuario,
                observacao || `Embalagem de ${quantidade} unidade(s)`,
            ]
            : [
                empresaId, idempotencyKey, Number(produto_id), varianteBanco,
                quantidade,
                usuarioLogado.nome || usuarioLogado.nome_usuario,
                observacao || `Embalagem de ${quantidade} unidade(s)`,
            ];
        const movimentoResult = await dbClient.query(movimentoQuery, movimentoParams);
        const movimentoId = movimentoResult.rows[0].id;
        await dbClient.query(`
            UPDATE embalagens_realizadas
               SET movimento_estoque_id = $1
             WHERE id = $2
               AND empresa_id = $3
        `, [movimentoId, embalagemId, empresaId]);

        await dbClient.query('COMMIT');
        transacaoAberta = false;
        verificarEAtualizarDemandasPorSKU(pool, Number(produto_id), varianteBanco)
            .catch((error) => console.error('[BACKGROUND-TASK] Falha após embalagem:', error));
        return res.status(201).json({
            message: 'Embalagem registrada e entrada no estoque concluída.',
            embalagem_id: embalagemId,
            movimento_estoque_id: movimentoId,
            origens_consumidas: alocacoes.length,
        });
    } catch (error) {
        if (dbClient && transacaoAberta) {
            await dbClient.query('ROLLBACK').catch(() => undefined);
        }
        console.error('[API POST /embalagens/unidade] Erro:', error);
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao registrar embalagem.',
            ...(error.saldoDisponivel !== undefined
                ? { saldoDisponivel: error.saldoDisponivel }
                : {}),
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.get('/contagem-hoje', async (req, res) => {
    // Não precisa de verificação de permissão tão granular,
    // pois a página principal já é protegida. Mas podemos adicionar se quiser.
    // const { usuarioLogado } = req;

    let dbClient;
    try {
        dbClient = await pool.connect();

        // A query conta a soma de 'quantidade_embalada' de todos os registros
        // na tabela 'embalagens_realizadas' que foram criados hoje.
        // Usamos 'data_embalagem::date = NOW()::date' para comparar apenas a parte da data,
        // ignorando a hora, o que é eficiente em PostgreSQL.
        const query = `
            SELECT COALESCE(SUM(quantidade_embalada), 0) as total
            FROM embalagens_realizadas
            WHERE empresa_id = $1
              AND
                data_embalagem >= date_trunc('day', NOW()) AND
                data_embalagem < date_trunc('day', NOW()) + interval '1 day' AND
                status = 'ATIVO'; -- Conta apenas embalagens que não foram estornadas
        `;
        
        const result = await dbClient.query(query, [req.empresaId]);
        const totalEmbaladoHoje = parseInt(result.rows[0].total) || 0;

        res.status(200).json({ total: totalEmbaladoHoje });

    } catch (error) {
        console.error('[API /embalagens/contagem-hoje] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar a contagem de embalagens de hoje.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/embalagens/origens
// Contrato único para a UI: fontes canônicas novas e arremates ainda legados.
router.get('/origens', async (req, res) => {
    const { produto_id, variante } = req.query;
    if (!produto_id) {
        return res.status(400).json({ error: 'produto_id é obrigatório.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(
            dbClient,
            req.usuarioLogado.id,
            req.empresaId,
        );
        if (!permissoes.includes('acesso-embalagem-de-produtos')) {
            return res.status(403).json({ error: 'Permissão negada para visualizar origens de embalagem.' });
        }

        const { rows } = await listarOrigensProdutoProntoDisponiveis(dbClient, {
            empresaId: req.empresaId,
            produtoId: Number(produto_id),
            variante,
        });
        return res.status(200).json({
            rows: rows.map((origem) => ({
                ...origem,
                quantidade_arrematada: origem.quantidade_disponibilizada,
                quantidade_ja_embalada: origem.quantidade_consumida,
                data_lancamento: origem.data_disponibilizacao,
            })),
        });
    } catch (error) {
        console.error('[API GET /embalagens/origens] Erro:', error);
        return res.status(500).json({ error: 'Erro ao buscar origens para embalagem.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/embalagens/origens/auditoria
// Leitura operacional para conferir referências canônicas sem alterar dados.
router.get('/origens/auditoria', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(
            dbClient,
            req.usuarioLogado.id,
            req.empresaId,
        );
        if (!permissoes.includes('acesso-embalagem-de-produtos')) {
            return res.status(403).json({ error: 'Permissão negada para auditar origens de embalagem.' });
        }
        const resultado = await auditarOrigensProdutoPronto(dbClient, req.empresaId);
        return res.status(200).json(resultado);
    } catch (error) {
        console.error('[API GET /embalagens/origens/auditoria] Erro:', error);
        return res.status(500).json({
            error: 'Erro ao auditar origens de embalagem.',
            details: error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// GET /api/embalagens/fila - NOVO ENDPOINT DEDICADO PARA A FILA DE EMBALAGEM
router.get('/fila', async (req, res) => {
    const { 
        search, 
        sortBy = 'mais_recentes', 
        page = 1, 
        limit = 6, // Este será ignorado se 'todos=true'
        todos
    } = req.query;

    let dbClient;
    try {
        dbClient = await pool.connect();
        const estrutura = await obterEstruturaOrigensProdutoPronto(dbClient);
        const cteOrigens = construirCteOrigensProdutoPronto(estrutura.origens);
        
        let queryParams = [req.empresaId];
        let paramIndex = 2;
        
        // --- ETAPA 1: Construir a Query Base ---
        let baseQuery = `
            ${cteOrigens},
            OrigensComSaldo AS (
                SELECT
                    empresa_id,
                    produto_id, 
                    variante, 
                    op_numero,
                    data_disponibilizacao,
                    (quantidade_disponibilizada - quantidade_consumida) AS saldo
                FROM OrigensProdutoProntoCompat
                WHERE empresa_id = $1
                  AND (quantidade_disponibilizada - quantidade_consumida) > 0
            )
            SELECT
                ars.produto_id,
                p.nome as produto,
                ars.variante,
                SUM(ars.saldo)::integer as total_disponivel_para_embalar,
                MIN(COALESCE(op.data_final, ars.data_disponibilizacao)) as data_lancamento_mais_antiga,
                MAX(COALESCE(op.data_final, ars.data_disponibilizacao)) as data_lancamento_mais_recente
            FROM OrigensComSaldo ars
            JOIN produtos p ON ars.produto_id = p.id AND p.empresa_id = ars.empresa_id
            LEFT JOIN ordens_de_producao op ON ars.op_numero = op.numero AND op.empresa_id = ars.empresa_id
            GROUP BY ars.empresa_id, ars.produto_id, p.nome, ars.variante
        `;
        let fromClause = `FROM (${baseQuery}) as subquery`;

        // --- ETAPA 2: Adicionar Filtros ---
        let whereClause = '';
        if (search) {
            whereClause = ` WHERE unaccent(produto) ILIKE unaccent($${paramIndex++}) OR unaccent(variante) ILIKE unaccent($${paramIndex++})`;
            queryParams.push(`%${search}%`, `%${search}%`);
        }

        // --- ETAPA 3: Ordenação ---
        let orderByClause;
        switch (sortBy) {
            case 'mais_antigos': orderByClause = 'ORDER BY data_lancamento_mais_antiga ASC'; break;
            case 'maior_quantidade': orderByClause = 'ORDER BY total_disponivel_para_embalar DESC'; break;
            case 'menor_quantidade': orderByClause = 'ORDER BY total_disponivel_para_embalar ASC'; break;
            default: orderByClause = 'ORDER BY data_lancamento_mais_recente DESC'; break;
        }

        // --- ETAPA 4: Execução da Query ---
        let finalQuery;

        if (todos === 'true') {
            // Se 'todos=true', montamos a query SEM LIMIT e OFFSET
            finalQuery = `SELECT * ${fromClause} ${whereClause} ${orderByClause}`;
        } else {
            // Se não, montamos a query COM LIMIT e OFFSET
            const limitNum = parseInt(limit, 10);
            const offset = (parseInt(page, 10) - 1) * limitNum;
            queryParams.push(limitNum, offset);
            finalQuery = `SELECT * ${fromClause} ${whereClause} ${orderByClause} LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        }

        const filtrosParams = [...queryParams];
        const dataResult = await dbClient.query(finalQuery, queryParams);
        
        // A contagem total é feita DEPOIS, de forma separada, para garantir consistência
        const countQuery = `SELECT COUNT(*) ${fromClause} ${whereClause}`;
        // Usamos os parâmetros de filtro (se houver), mas não os de paginação
        const countResult = await dbClient.query(countQuery, filtrosParams);
        const totalItems = parseInt(countResult.rows[0].count, 10);

        res.status(200).json({
            rows: dataResult.rows,
            pagination: { }
        });

    } catch (error) {
        console.error('[API GET /api/embalagens/fila] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar a fila de embalagem.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/embalagens/historico-geral - ENDPOINT DE AUDITORIA COMPLETA
router.get('/historico-geral', async (req, res) => {
    const { 
        tipoEvento = 'todos',
        usuarioId = 'todos',
        periodo = '7d',
        page = 1,
        limit = 10
    } = req.query;

    let dbClient;
    try {
        dbClient = await pool.connect();
        
        // --- CONSTRUÇÃO DA QUERY COM UNION ALL ---
        // Vamos buscar 3 tipos de eventos e uni-los.
        
        // 1. Embalagens de Unidade e Montagens de Kit (da tabela 'embalagens_realizadas')
        const embalagensQuery = `
            SELECT
                er.id,
                er.data_embalagem as data_evento,
                CASE 
                    WHEN er.tipo_embalagem = 'UNIDADE' THEN 'embalagem_unidade'
                    WHEN er.tipo_embalagem = 'KIT' THEN 'montagem_kit'
                    ELSE 'desconhecido'
                END as tipo_evento,
                p.nome as produto_nome,
                er.variante_embalada_nome as variante_nome,
                er.quantidade_embalada as quantidade,
                u.nome as usuario_nome,
                er.observacao,
                er.status
            FROM embalagens_realizadas er
            JOIN produtos p ON er.produto_embalado_id = p.id
                           AND p.empresa_id = er.empresa_id
                             AND p.empresa_id = er.empresa_id
            JOIN usuarios u ON er.usuario_responsavel_id = u.id
            WHERE er.empresa_id = ${req.empresaId}
        `;

        // 2. Estornos de Arremate (feitos a partir da página de embalagem, da tabela 'arremates')
        const estornosArremateQuery = `
            SELECT
                a.id,
                a.data_lancamento as data_evento,
                'estorno_arremate' as tipo_evento,
                p.nome as produto_nome,
                a.variante as variante_nome,
                a.quantidade_arrematada as quantidade,
                a.lancado_por as usuario_nome,
                'Estorno do lote ' || a.id_perda_origem as observacao,
                'ATIVO' as status
            FROM arremates a
            JOIN produtos p ON a.produto_id = p.id
                             AND p.empresa_id = a.empresa_id
            WHERE a.empresa_id = ${req.empresaId}
              AND a.tipo_lancamento = 'ESTORNO'
        `;

        // 3. Estornos de Estoque (da tabela 'estoque_movimentos')
        const estornosEstoqueQuery = `
            SELECT
                em.id,
                em.data_movimento as data_evento,
                'estorno_estoque' as tipo_evento,
                p.nome as produto_nome,
                em.variante_nome,
                em.quantidade,
                em.usuario_responsavel as usuario_nome,
                em.observacao,
                'ATIVO' as status
            FROM estoque_movimentos em
            JOIN produtos p ON em.produto_id = p.id AND p.empresa_id = em.empresa_id
            WHERE em.empresa_id = ${req.empresaId}
              AND em.tipo_movimento LIKE 'ESTORNO_%'
        `;

        // Junta tudo em uma única query
        const fullQuery = `
            SELECT * FROM (
                (${embalagensQuery})
                UNION ALL
                (${estornosArremateQuery})
                UNION ALL
                (${estornosEstoqueQuery})
            ) as historico
        `;

        // --- APLICAÇÃO DOS FILTROS ---
        let whereClauses = [];
        let queryParams = [];
        let paramIndex = 1;

        // Filtro de Período
        if (periodo === 'hoje') {
            whereClauses.push(`data_evento >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')`);
        } else if (periodo === '30d') {
            whereClauses.push(`data_evento >= NOW() - INTERVAL '30 days'`);
        } else if (periodo === 'mes_atual') {
            whereClauses.push(`date_trunc('month', data_evento) = date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo')`);
        } else { // Padrão: 7d
            whereClauses.push(`data_evento >= NOW() - INTERVAL '7 days'`);
        }
        
        // Filtro por Tipo de Evento
        if (tipoEvento !== 'todos') {
            whereClauses.push(`tipo_evento = $${paramIndex++}`);
            queryParams.push(tipoEvento);
        }
        
        // Filtro por Usuário
        if (usuarioId !== 'todos') {
            // Precisamos buscar o nome do usuário a partir do ID
            const userResult = await dbClient.query(
                `SELECT u.nome
                   FROM usuarios u
                   JOIN usuarios_empresas ue
                     ON ue.usuario_id = u.id
                    AND ue.empresa_id = $2
                  WHERE u.id = $1`,
                [usuarioId, req.empresaId]
            );
            if (userResult.rows.length > 0) {
                whereClauses.push(`usuario_nome = $${paramIndex++}`);
                queryParams.push(userResult.rows[0].nome);
            }
        }
        
        const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        
        // Query de Contagem
        const countQuery = `SELECT COUNT(*) FROM (${fullQuery}) as sub ${whereString}`;
        const countResult = await dbClient.query(countQuery, queryParams);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        
        // Query de Dados com Paginação
        const limitNum = parseInt(limit);
        const offset = (parseInt(page) - 1) * limitNum;
        const totalPages = Math.ceil(totalItems / limitNum) || 1;
        
        queryParams.push(limitNum, offset);
        const dataQuery = `${fullQuery} ${whereString} ORDER BY data_evento DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        
        const dataResult = await dbClient.query(dataQuery, queryParams);
        
        res.status(200).json({
            rows: dataResult.rows,
            pagination: {
                currentPage: parseInt(page),
                totalPages: totalPages,
                totalItems: totalItems
            }
        });

    } catch (error) {
        console.error('[API /embalagens/historico-geral] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar o histórico geral.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.get('/fila/contagem-antigos', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const estrutura = await obterEstruturaOrigensProdutoPronto(dbClient);
        const cteOrigens = construirCteOrigensProdutoPronto(estrutura.origens);
        
        const query = `
            ${cteOrigens}
            SELECT COUNT(*)
            FROM (
                SELECT 1
                FROM OrigensProdutoProntoCompat o
                WHERE o.empresa_id = $1
                  AND o.data_disponibilizacao < NOW() - INTERVAL '2 days'
                GROUP BY o.produto_id, o.variante
                HAVING SUM(o.quantidade_disponibilizada - o.quantidade_consumida) > 0
            ) as subquery;
        `;
        
        const result = await dbClient.query(query, [req.empresaId]);
        res.status(200).json({ total: parseInt(result.rows[0].count, 10) || 0 });

    } catch (error) {
        console.error('[API /fila/contagem-antigos] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar contagem de itens antigos.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.get('/sugestao-estoque', async (req, res) => {
    const { produto_id, variante, produto_ref_id } = req.query; // Recebe os 3, mas prioriza ID e variante

    // Decodifica o '+' para espaço e trata o caso de ser nulo ou '-'
    const varianteDecodificada = (variante === '-' || !variante) 
                                  ? null 
                                  : variante.replace(/\+/g, ' ');

    if (!produto_id || !produto_ref_id) {
        return res.status(400).json({ error: "O ID do produto e o SKU (produto_ref_id) são obrigatórios." });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();

        // 1. Encontrar todos os KITS que usam este SKU como componente
        const kitsQueUsamOComponenteQuery = `
            SELECT 
                p.id as kit_id,
                p.nome as kit_nome,
                p_grade.variacao as kit_variacao,
                p_grade.sku as kit_sku,
                p_grade.composicao
            FROM 
                produtos p,
                jsonb_to_recordset(p.grade) AS p_grade(sku TEXT, variacao TEXT, composicao JSONB)
            WHERE 
                p.is_kit = TRUE AND
                p.empresa_id = $3 AND
                jsonb_path_exists(p_grade.composicao, 
                    '$[*] ? (@.produto_id == $prod_id && @.variacao == $prod_var)', 
                    jsonb_build_object('prod_id', $1::int, 'prod_var', $2::text)
                );
        `;
        const kitsResult = await dbClient.query(
            kitsQueUsamOComponenteQuery,
            [produto_id, varianteDecodificada, req.empresaId]
        );
        const kitsEncontrados = kitsResult.rows;

        // 2. Coletar os SKUs de que precisamos: o item principal E os KITS relacionados.
            const todosSkusNecessarios = new Set([produto_ref_id]); // Começa com o SKU principal
            kitsEncontrados.forEach(kit => {
                if (kit.kit_sku) {
                    todosSkusNecessarios.add(kit.kit_sku);
                }
            });

        // 3. Buscar o saldo em estoque para TODOS os SKUs coletados de uma só vez
            let saldosMap = new Map(); // Inicia o mapa como vazio

            // **NOVA PROTEÇÃO:** Só executa a query se tivermos SKUs para buscar
            if (todosSkusNecessarios.size > 0) {
                const saldosQuery = `
            WITH saldos_por_item AS (
                -- Primeiro, calcula o saldo por produto_id e variante_nome
                SELECT 
                    produto_id,
                    variante_nome,
                    SUM(quantidade) as saldo_atual
                FROM estoque_movimentos
                WHERE empresa_id = $2
                GROUP BY produto_id, variante_nome
            )
            -- Agora, fazemos o JOIN para encontrar o SKU correspondente
            SELECT
                COALESCE(g.sku, p.sku) as produto_ref_id,
                s.saldo_atual
            FROM saldos_por_item s
            JOIN produtos p ON s.produto_id = p.id
            LEFT JOIN jsonb_to_recordset(p.grade) AS g(sku TEXT, variacao TEXT) 
                ON p.grade IS NOT NULL AND g.variacao = s.variante_nome
            WHERE p.empresa_id = $2
              AND COALESCE(g.sku, p.sku) = ANY($1::text[]);
        `;
        const saldosResult = await dbClient.query(
            saldosQuery,
            [Array.from(todosSkusNecessarios), req.empresaId]
        );
        // Preenche o mapa com os resultados
        saldosMap = new Map(saldosResult.rows.map(item => [item.produto_ref_id, parseInt(item.saldo_atual, 10) || 0]));
    }
        // 4. Montar a resposta final
        const saldoItemPrincipal = saldosMap.get(produto_ref_id) || 0;

        // Mapeia os kits para a resposta, buscando o saldo deles no nosso 'saldosMap'
        // Não dependemos mais da variável 'todosOsProdutosCadastrados'
        const kitsRelacionadosInfo = kitsEncontrados.map(kit => {
            return {
                kit_id: kit.kit_id,
                kit_nome: kit.kit_nome,
                kit_variacao: kit.kit_variacao,
                kit_sku: kit.kit_sku,
                saldo_em_estoque: saldosMap.get(kit.kit_sku) || 0
                // A imagem será buscada pelo frontend, que já tem o cache de produtos.
            };
        });

        res.status(200).json({
            sku_principal: produto_ref_id,
            saldo_em_estoque_principal: saldoItemPrincipal,
            kits_relacionados: kitsRelacionadosInfo
        });
        // --- FIM DA CORREÇÃO ---

    } catch (error) {
        console.error('[API /sugestao-estoque] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar sugestões de estoque.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
