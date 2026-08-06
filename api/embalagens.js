// api/embalagens.js

import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';
import { obterEmpresaIdDoContexto } from './contexto-empresa.js';
import { getPermissoesCompletasUsuarioDB } from './usuarios.js'; // Ajuste o caminho se necessário

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
        if (req.empresaAtiva?.eh_legada !== true) {
            return res.status(403).json({
                error: 'A cadeia de embalagem ainda nao esta disponivel para a empresa ativa.',
                codigo: 'CADEIA_PRODUTIVA_NAO_MIGRADA',
            });
        }
        next();
    } catch (error) {
        const statusCode = error.statusCode || 500;
        const responseError = { error: error.message };
        if (error.details) responseError.details = error.details;
        res.status(statusCode).json(responseError);
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

        // 4. ATUALIZA OS ARREMATES para "devolver" a quantidade ao saldo "Pronto para Embalar".
        if (tipo_embalagem === 'UNIDADE') {
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
            } else {
                throw new Error(`Não foi possível rastrear o arremate de origem para a embalagem de UNIDADE #${id_embalagem_realizada}.`);
            }
        } else if (tipo_embalagem === 'KIT' && componentes_consumidos) {
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
        } else {
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
        
        let queryParams = [req.empresaId];
        let paramIndex = 2;
        
        // --- ETAPA 1: Construir a Query Base ---
        let baseQuery = `
            WITH ArrematesComSaldo AS (
                -- Primeiro, encontramos os arremates que ainda têm saldo
                SELECT
                    empresa_id,
                    produto_id, 
                    variante, 
                    op_numero,
                    (quantidade_arrematada - quantidade_ja_embalada) as saldo
                FROM arremates
                WHERE empresa_id = $1
                  AND tipo_lancamento = 'PRODUCAO'
                  AND (quantidade_arrematada - quantidade_ja_embalada) > 0
            )
            -- Agora, usamos esses arremates para buscar as informações corretas
            SELECT
                ars.produto_id,
                p.nome as produto,
                ars.variante,
                SUM(ars.saldo)::integer as total_disponivel_para_embalar,
                -- A MUDANÇA CRUCIAL: Usamos a data_final da OP como base para a data mais antiga
                MIN(op.data_final) as data_lancamento_mais_antiga,
                MAX(op.data_final) as data_lancamento_mais_recente
            FROM ArrematesComSaldo ars
            JOIN produtos p ON ars.produto_id = p.id AND p.empresa_id = ars.empresa_id
            -- Usamos LEFT JOIN para o caso de uma OP ter sido deletada mas o arremate ainda existir
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
        
        const query = `
            SELECT COUNT(*)
            FROM (
                SELECT 1
                FROM arremates a
                WHERE a.empresa_id = $1
                  AND a.tipo_lancamento = 'PRODUCAO'
                  AND a.data_lancamento < NOW() - INTERVAL '2 days'
                GROUP BY a.produto_id, a.variante
                HAVING SUM(a.quantidade_arrematada - a.quantidade_ja_embalada) > 0
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
