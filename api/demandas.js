// api/demandas.js

import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;
import jwt from 'jsonwebtoken';
import express from 'express';
import { obterEmpresaIdDoContexto } from './contexto-empresa.js';
import { gerarDiagnosticoCompleto, limparAtribuicoesOrfas } from './utils/diagnosticoProducao.js';


// 1. Inicialização do Express Router e do Pool de Conexão com o Banco
const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
});
const SECRET_KEY = process.env.JWT_SECRET;

// 2. Middleware de Autenticação (copiado de outras APIs para consistência)
// Garante que apenas usuários logados possam acessar as rotas deste arquivo.
router.use((req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Token não fornecido' });
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token mal formatado' });
    }
    try {
        const tokenClaims = jwt.verify(token, SECRET_KEY);
        req.usuarioLogado = {
            ...tokenClaims,
            ...(req.usuarioLogado || {}),
            id: req.usuarioLogado?.id || tokenClaims.id,
            nome: req.usuarioLogado?.nome || tokenClaims.nome,
        };
        obterEmpresaIdDoContexto(req);
        next();
    } catch (err) {
        res.status(401).json({ error: 'Token inválido ou expirado' });
    }
});

function exigirCadeiaLegada(req, res) {
    if (req.empresaAtiva?.eh_legada === true) return true;
    res.status(403).json({
        error: 'A cadeia produtiva ainda não está disponível para a empresa ativa.',
        codigo: 'CADEIA_PRODUTIVA_NAO_MIGRADA',
    });
    return false;
}


// POST /api/demandas/
router.post('/', async (req, res) => {
    const { usuarioLogado } = req;
    const empresaId = obterEmpresaIdDoContexto(req);
    let dbClient;

    try {
        dbClient = await pool.connect();
        const { produto_sku, quantidade_solicitada, observacoes, prioridade } = req.body;

        // Validação
        if (!produto_sku || !quantidade_solicitada) {
            return res.status(400).json({ error: 'SKU e quantidade são obrigatórios.' });
        }
        
        // Conversão forçada para garantir
        const prioridadeFinal = (parseInt(prioridade) === 1) ? 1 : 2; 
        
        const produtoResult = await dbClient.query(`
            SELECT id, nome, imagem, grade
            FROM produtos
            WHERE empresa_id = $1
              AND (
                    sku = $2
                    OR EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements(COALESCE(grade, '[]'::jsonb)) g
                        WHERE g->>'sku' = $2
                    )
                )
        `, [empresaId, produto_sku]);
        if (produtoResult.rowCount === 0) {
            return res.status(404).json({ error: 'Produto não encontrado na empresa ativa.' });
        }
        if (produtoResult.rowCount > 1) {
            return res.status(409).json({ error: 'O SKU informado corresponde a mais de um produto na empresa ativa.' });
        }
        const produtoId = produtoResult.rows[0].id;

        const insertQuery = `
            INSERT INTO demandas_producao
                (empresa_id, produto_id, produto_sku, quantidade_solicitada, solicitado_por, observacoes, prioridade)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *;
        `;

        const result = await dbClient.query(insertQuery, [
            empresaId,
            produtoId,
            produto_sku,
            parseInt(quantidade_solicitada),
            usuarioLogado.nome,
            observacoes || null,
            prioridadeFinal
        ]);

        const novaDemanda = result.rows[0];

        // Notificar supervisores sobre nova demanda (best-effort — não falha o POST)
        try {
            // Buscar dados visuais do produto para exibir no sino (nome, imagem, variante)
            const produtoVisualResult = await dbClient.query(`
                SELECT
                    p.nome,
                    COALESCE(
                        (SELECT g->>'imagem' FROM jsonb_array_elements(p.grade) g WHERE g->>'sku' = $1 LIMIT 1),
                        p.imagem
                    ) AS imagem,
                    (SELECT g->>'variacao' FROM jsonb_array_elements(p.grade) g WHERE g->>'sku' = $1 LIMIT 1) AS variante
                FROM produtos p
                WHERE p.empresa_id = $2
                  AND (p.sku = $1
                   OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p.grade, '[]'::jsonb)) g WHERE g->>'sku' = $1))
                LIMIT 1
            `, [produto_sku, empresaId]);

            const pv = produtoVisualResult.rows[0];
            const nomeLegivel = pv
                ? (pv.variante ? `${pv.nome} — ${pv.variante}` : pv.nome)
                : produto_sku; // fallback para o SKU se produto não encontrado
            const qtd = parseInt(quantidade_solicitada);
            const dadosExtras = pv ? {
                empresa_id: empresaId,
                demanda_id: novaDemanda.id,
                sku:          produto_sku,
                produto_nome: pv.nome,
                variante:     pv.variante || null,
                imagem:       pv.imagem   || null,
                quantidade:   qtd,
            } : null;

            const configNova = await dbClient.query(
                `SELECT cea.ativo
                   FROM configuracoes_alertas ca
                   JOIN configuracoes_alertas_empresas cea
                     ON cea.configuracao_id = ca.id
                    AND cea.empresa_id = $1
                  WHERE ca.tipo_alerta = 'DEMANDA_NORMAL'
                  LIMIT 1`,
                [empresaId]
            );
            if (configNova.rows[0]?.ativo) {
                await dbClient.query(
                    `INSERT INTO eventos_sistema
                        (empresa_id, tipo_evento, mensagem, lido, dados_extras)
                     VALUES ($1, $2, $3, false, $4)`,
                    [empresaId, 'DEMANDA_NORMAL', `Nova demanda: ${nomeLegivel} — ${qtd} peça${qtd !== 1 ? 's' : ''} aguardando início.`, dadosExtras]
                );
            }
            if (prioridadeFinal === 1) {
                const configPrioritaria = await dbClient.query(
                    `SELECT cea.ativo
                       FROM configuracoes_alertas ca
                       JOIN configuracoes_alertas_empresas cea
                         ON cea.configuracao_id = ca.id
                        AND cea.empresa_id = $1
                      WHERE ca.tipo_alerta = 'DEMANDA_PRIORITARIA'
                      LIMIT 1`,
                    [empresaId]
                );
                if (configPrioritaria.rows[0]?.ativo) {
                    await dbClient.query(
                        `INSERT INTO eventos_sistema
                            (empresa_id, tipo_evento, mensagem, lido, dados_extras)
                         VALUES ($1, $2, $3, false, $4)`,
                        [empresaId, 'DEMANDA_PRIORITARIA', `Demanda PRIORITÁRIA: ${nomeLegivel} — ${qtd} peça${qtd !== 1 ? 's' : ''}.`, dadosExtras]
                    );
                }
            }
        } catch (eventoErr) {
            console.warn('[POST /demandas] Falha ao registrar evento de alerta (não crítico):', eventoErr.message);
        }

        res.status(201).json(novaDemanda);

    } catch (error) {
        console.error('[API /demandas POST] Erro:', error);
        res.status(500).json({ error: 'Erro interno.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/demandas/
router.get('/', async (req, res) => {
    let dbClient;

    try {
        dbClient = await pool.connect();

        // A query busca todas as demandas que não estão com o status 'concluidas'.
        // A ordenação é a chave para o nosso painel de prioridades:
        // 1. Ordena pelo campo 'prioridade' em ordem crescente (1, 2, 3...).
        // 2. Se duas demandas tiverem a mesma prioridade, a mais antiga (data_solicitacao) aparece primeiro.
        const empresaId = obterEmpresaIdDoContexto(req);
        const selectQuery = `
            SELECT * FROM demandas_producao
            WHERE empresa_id = $1
              AND status IN ('pendente', 'em_atendimento', 'concluida')
            ORDER BY prioridade ASC, data_solicitacao ASC;
        `;

        const result = await dbClient.query(selectQuery, [empresaId]);

        // Retorna o status 200 (OK) e a lista de demandas encontradas em formato JSON
        res.status(200).json(result.rows);

    } catch (error) {
        console.error('[API /demandas GET] Erro ao listar demandas:', error);
        res.status(500).json({ error: 'Erro interno ao listar as demandas.', details: error.message });
    } finally {
        if (dbClient) {
            dbClient.release();
        }
    }
});


// GET /api/demandas/diagnostico-completo
router.get('/diagnostico-completo', async (req, res) => {
    if (!exigirCadeiaLegada(req, res)) return;
    const empresaId = obterEmpresaIdDoContexto(req);
    let dbClient;
    try {
        dbClient = await pool.connect();

        // 1. Chama a função centralizada (Balanço Hídrico)
        const diagnostico = await gerarDiagnosticoCompleto(dbClient, empresaId);

        // 2. REMOVEMOS A AUTO-CONCLUSÃO AUTOMÁTICA AQUI.
        // A lógica antiga estava baseada em estoque estático e causava sumiço de demandas.
        // Agora, o Painel mostra o Balanço. Se o supervisor ver que está tudo verde, ele pode concluir manualmente.
        
        // (Opcional) Podemos reativar uma limpeza de orfãs se necessário, 
        // mas vamos manter simples por enquanto para estabilizar.
        // limparAtribuicoesOrfas(dbClient).catch(...) 

        // 3. Envia a resposta final para o frontend
        res.status(200).json(diagnostico);

    } catch (error) {
        console.error('[API /demandas/diagnostico-completo GET] Erro:', error);
        res.status(500).json({ error: 'Erro interno ao gerar diagnóstico.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// DELETE /api/demandas/:id
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const empresaId = obterEmpresaIdDoContexto(req);
    let dbClient;

    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        // 1. Deleta a demanda
        const deleteResult = await dbClient.query(
            'DELETE FROM demandas_producao WHERE id = $1 AND empresa_id = $2',
            [id, empresaId]
        );

        if (deleteResult.rowCount === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Demanda não encontrada.' });
        }

        // 2. Chama a função de limpeza para remover quaisquer atribuições que se tornaram órfãs
        await limparAtribuicoesOrfas(dbClient);

        // 3. Limpa eventos de alerta pendentes relacionados à demanda deletada
        // (evita que o sino continue disparando para uma demanda que não existe mais)
        await dbClient.query(`
            UPDATE eventos_sistema
            SET lido = true
            WHERE tipo_evento IN ('DEMANDA_NORMAL', 'DEMANDA_PRIORITARIA')
              AND lido = false
              AND empresa_id = $1
              AND criado_em >= NOW() - INTERVAL '2 hours'
              AND dados_extras->>'demanda_id' = $2
        `, [empresaId, String(id)]);

        await dbClient.query('COMMIT');
        res.status(200).json({ message: 'Demanda removida e atribuições limpas com sucesso.' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /demandas DELETE] Erro ao deletar demanda:', error);
        res.status(500).json({ error: 'Erro interno ao remover a demanda.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ROTA PARA UM SUPERVISOR "ASSUMIR" A PRODUÇÃO DE UM COMPONENTE
// Agora ela também "congela" a meta de produção no momento da atribuição.
router.put('/assumir-producao-componente', async (req, res) => {
    const { usuarioLogado } = req;
    const empresaId = obterEmpresaIdDoContexto(req);
    // Recebe a chave do componente E a necessidade de produção calculada pelo frontend
    const { componente_chave, necessidade_producao } = req.body;

    // Validação robusta dos dados de entrada
    if (!componente_chave || necessidade_producao === undefined) {
        return res.status(400).json({ error: 'A chave do componente e a necessidade de produção são obrigatórias.' });
    }

    const necessidadeNum = parseInt(necessidade_producao);
    if (isNaN(necessidadeNum) || necessidadeNum < 0) {
        return res.status(400).json({ error: 'A necessidade de produção deve ser um número válido.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();

        // Query de inserção/atualização na tabela de atribuições
        const insertQuery = `
            INSERT INTO demandas_componentes_atribuidos 
                (empresa_id, componente_chave, atribuida_a, necessidade_producao_no_momento)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (empresa_id, componente_chave) DO UPDATE SET
                atribuida_a = EXCLUDED.atribuida_a,
                data_atribuicao = NOW();
                -- Propositalmente NÃO atualizamos a 'necessidade_producao_no_momento' em um conflito (ON CONFLICT).
                -- Isso garante que a meta original "congelada" no primeiro clique seja mantida,
                -- mesmo que outro supervisor assuma a tarefa depois.
        `;

        await dbClient.query(insertQuery, [
            empresaId,
            componente_chave,
            usuarioLogado.nome,
            necessidadeNum
        ]);

        // Passo Adicional: Atualizar o status de TODAS as demandas dependentes para 'em_producao'
        // Primeiro, precisamos encontrar os IDs das demandas.
        // (Esta lógica é uma simplificação; idealmente, ela viria do frontend, mas faremos aqui para garantir)
        const demandasAfetadasQuery = `
            SELECT id FROM (
                SELECT d.id, p.id as produto_id, g.variacao
                FROM demandas_producao d
                JOIN produtos p ON p.sku = d.produto_sku OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p.grade) as gr(sku TEXT) WHERE gr.sku = d.produto_sku)
                LEFT JOIN jsonb_to_recordset(p.grade) as g(sku TEXT, variacao TEXT) ON g.sku = d.produto_sku
                WHERE d.empresa_id = $3
                  AND p.empresa_id = $3
                  AND d.status = 'pendente' AND p.is_kit = FALSE
                
                UNION
                
                SELECT d.id, (comp->>'produto_id')::int as produto_id, comp->>'variacao' as variacao
                FROM demandas_producao d
                JOIN produtos p ON p.sku = d.produto_sku OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p.grade) as gr(sku TEXT) WHERE gr.sku = d.produto_sku)
                JOIN jsonb_to_recordset(p.grade) as g(composicao JSONB) ON p.is_kit = TRUE
                CROSS JOIN jsonb_array_elements(g.composicao) as comp
                WHERE d.empresa_id = $3
                  AND p.empresa_id = $3
                  AND d.status = 'pendente'
            ) as subquery
            WHERE subquery.produto_id = $1 AND (subquery.variacao = $2 OR (subquery.variacao IS NULL AND $2 IS NULL));
        `;
        const [produtoId, variacao] = componente_chave.split('|');
        const resDemandas = await dbClient.query(demandasAfetadasQuery, [produtoId, variacao === '-' ? null : variacao, empresaId]);
        const idsDemandasAfetadas = resDemandas.rows.map(r => r.id);

        if (idsDemandasAfetadas.length > 0) {
            await dbClient.query(
                `UPDATE demandas_producao SET status = 'em_producao' WHERE id = ANY($1::int[]) AND empresa_id = $2`,
                [idsDemandasAfetadas, empresaId]
            );
        }

        res.status(200).json({ 
            message: `Produção do componente ${componente_chave} foi atribuída a ${usuarioLogado.nome} com a meta de ${necessidadeNum} pçs.`
        });

    } catch (error) {
        console.error('[API /assumir-producao-componente PUT] Erro:', error);
        res.status(500).json({ error: 'Erro interno ao atribuir produção do componente.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ROTA PARA ATUALIZAR A META DE PRODUÇÃO DE UM COMPONENTE JÁ ASSUMIDO
router.put('/atualizar-meta-componente', async (req, res) => {
    const { usuarioLogado } = req;
    const empresaId = obterEmpresaIdDoContexto(req);
    const { componente_chave, valor_a_adicionar } = req.body;

    if (!componente_chave || valor_a_adicionar === undefined) {
        return res.status(400).json({ error: 'A chave do componente e o valor a adicionar são obrigatórios.' });
    }
    const valorNum = parseInt(valor_a_adicionar);
    if (isNaN(valorNum) || valorNum < 0) {
        return res.status(400).json({ error: 'O valor a adicionar deve ser um número positivo.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();

        // Query que atualiza a meta somando o valor adicional
        const updateQuery = `
            UPDATE demandas_componentes_atribuidos
            SET necessidade_producao_no_momento = necessidade_producao_no_momento + $1
            WHERE empresa_id = $2
              AND componente_chave = $3
            RETURNING *;
        `;

        const result = await dbClient.query(updateQuery, [valorNum, empresaId, componente_chave]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Atribuição para este componente não encontrada. Não foi possível atualizar a meta.' });
        }

        res.status(200).json({ 
            message: `Meta para ${componente_chave} atualizada com sucesso.`,
            atribuicaoAtualizada: result.rows[0]
        });

    } catch (error) {
        console.error('[API /atualizar-meta-componente PUT] Erro:', error);
        res.status(500).json({ error: 'Erro interno ao atualizar a meta de produção.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/demandas/tem-prioridade
// Endpoint leve para o FAB (polling a cada 3 min).
// - totalUrgentes: prioridade=1 E status='pendente' (ninguém começou ainda → alerta escandaloso)
// - totalAtivas: todas as demandas não concluídas/canceladas (pipeline rodando → badge discreto)
router.get('/tem-prioridade', async (req, res) => {
    const empresaId = obterEmpresaIdDoContexto(req);
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(`
            SELECT
                COUNT(*) FILTER (
                    WHERE prioridade = 1 AND status = 'pendente'
                )::int AS total_urgentes,
                COUNT(*) FILTER (
                    WHERE status NOT IN ('concluida', 'cancelada')
                )::int AS total_ativas
            FROM demandas_producao
            WHERE empresa_id = $1
        `, [empresaId]);
        const { total_urgentes, total_ativas } = result.rows[0];
        res.status(200).json({
            totalUrgentes: total_urgentes,
            totalAtivas: total_ativas
        });
    } catch (error) {
        console.error('[GET /demandas/tem-prioridade] Erro:', error);
        res.status(500).json({ error: 'Erro interno.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PATCH /api/demandas/arquivar-lote
// Arquiva uma lista de demandas (concluídas ou com divergência) ao final do dia.
// Body: { itens: [{ id: number, status_final: 'CONCLUIDO' | 'DIVERGENCIA' }] }
router.patch('/arquivar-lote', async (req, res) => {
    const { itens } = req.body;
    const empresaId = obterEmpresaIdDoContexto(req);
    if (!Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Nenhum item para arquivar.' });
    }
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');
        for (const item of itens) {
            await dbClient.query(
                `UPDATE demandas_producao
                 SET arquivada_em = NOW(), status_final = $1
                 WHERE id = $2 AND empresa_id = $3 AND arquivada_em IS NULL`,
                [item.status_final, item.id, empresaId]
            );
        }
        await dbClient.query('COMMIT');
        res.status(200).json({ message: `${itens.length} demanda(s) arquivada(s).` });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[PATCH /demandas/arquivar-lote] Erro:', error);
        res.status(500).json({ error: 'Erro ao arquivar demandas.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/demandas/historico-arquivado
// Retorna demandas já arquivadas com info básica do produto, ordenadas por data de arquivamento.
router.get('/historico-arquivado', async (req, res) => {
    const empresaId = obterEmpresaIdDoContexto(req);
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(`
            SELECT
                d.id,
                d.produto_sku,
                d.quantidade_solicitada,
                d.solicitado_por,
                d.data_solicitacao,
                d.arquivada_em,
                d.status_final,
                d.observacoes,
                p.nome AS produto_nome,
                COALESCE(
                    (SELECT g->>'imagem' FROM jsonb_array_elements(p.grade) g WHERE g->>'sku' = d.produto_sku LIMIT 1),
                    p.imagem
                ) AS imagem,
                (SELECT g->>'variacao' FROM jsonb_array_elements(p.grade) g WHERE g->>'sku' = d.produto_sku LIMIT 1) AS variante
            FROM demandas_producao d
            LEFT JOIN produtos p ON p.empresa_id = d.empresa_id
                AND (p.sku = d.produto_sku
                OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements(p.grade) g WHERE g->>'sku' = d.produto_sku
                ))
            WHERE d.empresa_id = $1
              AND d.arquivada_em IS NOT NULL
            ORDER BY d.arquivada_em DESC
            LIMIT 200
        `, [empresaId]);
        res.status(200).json({ itens: result.rows });
    } catch (error) {
        console.error('[GET /demandas/historico-arquivado] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/demandas/buscar-produto?termo=...
// Migrado de api/radar-producao.js (GET /buscar) — usado no modal de criação de demandas
router.get('/buscar-produto', async (req, res) => {
    const { termo, page = 1, limit = 5 } = req.query;
    if (!exigirCadeiaLegada(req, res)) return;
    const empresaId = obterEmpresaIdDoContexto(req);
    if (!termo) {
        return res.status(400).json({
            rows: [],
            pagination: { currentPage: 1, totalPages: 1, totalItems: 0 }
        });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();

        const termoPrincipal = `%${termo.replace(/\s+/g, '%')}%`;
        let termoAlternativo = null;

        if (termo.toLowerCase().includes('sortido')) {
            termoAlternativo = `%${termo.toLowerCase().replace('sortido', 'sortida').replace(/\s+/g, '%')}%`;
        } else if (termo.toLowerCase().includes('sortida')) {
            termoAlternativo = `%${termo.toLowerCase().replace('sortida', 'sortido').replace(/\s+/g, '%')}%`;
        }

        const limitNum = parseInt(limit);
        const offset = (parseInt(page) - 1) * limitNum;

        const params = [termoPrincipal];
        if (termoAlternativo) params.push(termoAlternativo);
        const empresaParamIndex = params.length + 1;
        params.push(empresaId);

        const baseQuery = `
            FROM produtos p
            INNER JOIN (
                SELECT DISTINCT produto_id, variante
                  FROM arremates
                 WHERE empresa_id = $${empresaParamIndex}
                UNION
                SELECT DISTINCT produto_embalado_id as produto_id, variante_embalada_nome as variante
                  FROM embalagens_realizadas
                 WHERE empresa_id = $${empresaParamIndex}
                UNION
                SELECT DISTINCT produto_id, variante_nome as variante
                  FROM estoque_movimentos
                 WHERE empresa_id = $${empresaParamIndex}
            ) AS ativos ON p.id = ativos.produto_id
            LEFT JOIN jsonb_to_recordset(p.grade) AS g(sku TEXT, variacao TEXT, imagem TEXT)
                ON (g.variacao = ativos.variante OR (g.variacao IS NULL AND ativos.variante IS NULL))
            WHERE
                p.empresa_id = $${empresaParamIndex}
                AND
                g.sku NOT IN (
                    SELECT produto_ref_id
                      FROM estoque_itens_arquivados
                     WHERE empresa_id = $${empresaParamIndex}
                )
                AND (
                    (
                        unaccent(g.variacao) ILIKE unaccent($1)
                        OR unaccent(p.nome || ' ' || g.variacao) ILIKE unaccent($1)
                        OR unaccent(g.sku) ILIKE unaccent($1)
                    )
                    ${termoAlternativo ? `
                    OR (
                        unaccent(g.variacao) ILIKE unaccent($2)
                        OR unaccent(p.nome || ' ' || g.variacao) ILIKE unaccent($2)
                        OR unaccent(g.sku) ILIKE unaccent($2)
                    )
                    ` : ''}
                )
        `;

        const countQuery = `SELECT COUNT(*) ${baseQuery}`;
        const countResult = await dbClient.query(countQuery, params);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limitNum) || 1;

        const dataParams = [...params, limitNum, offset];
        const limitPlaceholder = `$${params.length + 1}`;
        const offsetPlaceholder = `$${params.length + 2}`;

        const dataQuery = `
            SELECT p.id as produto_id, p.nome, g.variacao as variante, g.sku, COALESCE(g.imagem, p.imagem) as imagem
            ${baseQuery}
            ORDER BY p.nome, g.variacao
            LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder};
        `;
        const dataResult = await dbClient.query(dataQuery, dataParams);

        res.status(200).json({
            rows: dataResult.rows,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalItems
            }
        });

    } catch (error) {
        console.error('[GET /demandas/buscar-produto] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar produtos.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/demandas/pendentes-por-produto?produto_id=X&variante=Y
// Retorna demandas pendentes para o produto+variante informados, sem OP já criada.
// Usado pelo OPCriarModal para sugerir vínculo de demanda ao criar OP pelo estoque de cortes.
// - Filtra pela variante exata do corte (resolve produto_sku → variacao via grade)
// - Exclui demandas que já possuem uma OP vinculada
// - Retorna nome do produto e nome da variação para display legível no dropdown
router.get('/pendentes-por-produto', async (req, res) => {
    const { produto_id, variante } = req.query;
    if (!exigirCadeiaLegada(req, res)) return;
    const empresaId = obterEmpresaIdDoContexto(req);
    if (!produto_id) return res.status(400).json({ error: 'produto_id obrigatório.' });

    // Normaliza a variante: null / undefined / '-' / '' → null
    const varianteAlvo = (!variante || variante === '-' || variante.trim() === '') ? null : variante.trim();

    let dbClient;
    try {
        dbClient = await pool.connect();

        // Busca nome do produto para o display
        const produtoResult = await dbClient.query(
            `SELECT nome, grade FROM produtos WHERE id = $1 AND empresa_id = $2`, [produto_id, empresaId]
        );
        if (produtoResult.rows.length === 0) return res.json([]);
        const produto = produtoResult.rows[0];
        const grade = (() => {
            if (!produto.grade) return [];
            if (typeof produto.grade === 'string') try { return JSON.parse(produto.grade); } catch(e) { return []; }
            return Array.isArray(produto.grade) ? produto.grade : [];
        })();

        // Determina os SKUs do grade que correspondem à variante alvo
        // Se varianteAlvo é null → só SKUs de grade onde variacao é null/vazio (produto sem variante)
        // Se varianteAlvo é string → SKUs onde variacao === varianteAlvo
        const skusAlvo = grade
            .filter(g => {
                const gVariacao = (!g.variacao || g.variacao === '-' || g.variacao.trim() === '') ? null : g.variacao.trim();
                return gVariacao === varianteAlvo;
            })
            .map(g => g.sku)
            .filter(Boolean);

        // Se não há entradas de grade, tenta o sku principal do produto
        // (produtos sem variantes podem ter demandas pelo sku principal)
        let skusProdutoPrincipal = [];
        if (skusAlvo.length === 0 && varianteAlvo === null) {
            const skuPrinc = await dbClient.query(`SELECT sku FROM produtos WHERE id = $1 AND empresa_id = $2`, [produto_id, empresaId]);
            if (skuPrinc.rows[0]?.sku) skusProdutoPrincipal = [skuPrinc.rows[0].sku];
        }

        const todosSkus = [...skusAlvo, ...skusProdutoPrincipal];
        if (todosSkus.length === 0) return res.json([]); // nenhum SKU → sem demandas possíveis

        const result = await dbClient.query(`
            SELECT
                dp.id,
                dp.produto_sku,
                dp.quantidade_solicitada,
                dp.data_solicitacao,
                dp.observacoes,
                dp.prioridade,
                $2::text  AS produto_nome,
                $3::text  AS variacao
            FROM demandas_producao dp
              WHERE dp.empresa_id = $4
                AND dp.produto_sku = ANY($1::text[])
              AND dp.status IN ('pendente', 'em_atendimento')
              AND dp.arquivada_em IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM ordens_de_producao op
                  WHERE op.demanda_id = dp.id
              )
            ORDER BY dp.prioridade ASC, dp.data_solicitacao ASC
        `, [todosSkus, produto.nome, varianteAlvo, empresaId]);

        res.json(result.rows);
    } catch (err) {
        console.error('[GET /demandas/pendentes-por-produto]', err);
        res.status(500).json({ error: err.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/demandas/lote
// Cria múltiplas demandas de uma vez (Demanda Express).
// Usa Promise.allSettled por item — uma falha não cancela as outras.
router.post('/lote', async (req, res) => {
    const { usuarioLogado } = req;
    const empresaId = obterEmpresaIdDoContexto(req);
    const { itens } = req.body;
    if (!Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Nenhum item no lote.' });
    }

    const resultados = await Promise.allSettled(
        itens.map(async (item) => {
            const { produto_sku, quantidade_solicitada, prioridade } = item;
            const qtd = parseInt(quantidade_solicitada);
            if (!produto_sku || !qtd || qtd < 1) throw new Error('Dados inválidos.');
            const prioridadeFinal = parseInt(prioridade) === 1 ? 1 : 2;
            const r = await pool.query(
                `INSERT INTO demandas_producao (empresa_id, produto_id, produto_sku, quantidade_solicitada, solicitado_por, prioridade)
                 SELECT $1, p.id, $2, $3, $4, $5
                 FROM produtos p
                 WHERE p.empresa_id = $1
                   AND (p.sku = $2 OR EXISTS (
                       SELECT 1 FROM jsonb_array_elements(COALESCE(p.grade, '[]'::jsonb)) g
                       WHERE g->>'sku' = $2
                   ))
                 RETURNING id`,
                [empresaId, produto_sku.trim(), qtd, usuarioLogado.nome, prioridadeFinal]
            );
            if (r.rowCount !== 1) throw new Error('Produto não encontrado na empresa ativa.');
            return { sku: produto_sku, id: r.rows[0].id };
        })
    );

    const sucesso = resultados.filter(r => r.status === 'fulfilled').map(r => r.value);
    const falhas  = resultados.filter(r => r.status === 'rejected').map(r => r.reason?.message);

    res.status(201).json({
        totalCriadas: sucesso.length,
        totalErros: falhas.length,
        message: `${sucesso.length} demanda(s) criada(s).${falhas.length > 0 ? ` ${falhas.length} com erro.` : ''}`,
        sucesso,
        falhas
    });
});

// PATCH /api/demandas/:id/concluir
router.patch('/:id/concluir', async (req, res) => {
    const { id } = req.params;
    const { usuarioLogado } = req;
    const empresaId = obterEmpresaIdDoContexto(req);
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(`
            UPDATE demandas_producao
            SET status = 'concluida',
                data_conclusao = NOW(),
                concluida_manualmente_por = $1
            WHERE id = $2 AND empresa_id = $3
            RETURNING *
        `, [usuarioLogado.nome, id, empresaId]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Demanda não encontrada.' });
        res.status(200).json({ message: 'Demanda concluída manualmente.', demanda: result.rows[0] });
    } catch (error) {
        console.error('[PATCH /demandas/:id/concluir] Erro:', error);
        res.status(500).json({ error: 'Erro interno.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/demandas/verificar-duplicata?sku=...
// Retorna demandas ativas (não concluídas/canceladas) para o mesmo SKU.
// Inclui estagio_atual: AGUARDANDO | COSTURA | ARREMATE
router.get('/verificar-duplicata', async (req, res) => {
    const { sku } = req.query;
    if (!exigirCadeiaLegada(req, res)) return;
    const empresaId = obterEmpresaIdDoContexto(req);
    if (!sku) return res.status(400).json({ error: 'SKU obrigatório.' });
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(`
            SELECT dp.id, dp.produto_sku, dp.quantidade_solicitada, dp.prioridade,
                   dp.status, dp.data_solicitacao, dp.solicitado_por,
                   CASE
                     WHEN EXISTS (
                       SELECT 1 FROM ordens_de_producao op
                       WHERE op.demanda_id = dp.id
                         AND op.status IN ('em-aberto', 'produzindo')
                     ) THEN 'COSTURA'
                     WHEN EXISTS (
                       SELECT 1 FROM ordens_de_producao op
                       WHERE op.demanda_id = dp.id
                         AND op.status = 'finalizado'
                     ) THEN 'ARREMATE'
                     ELSE 'AGUARDANDO'
                   END as estagio_atual
            FROM demandas_producao dp
             WHERE dp.empresa_id = $2
               AND dp.produto_sku = $1
              AND dp.status NOT IN ('concluida', 'cancelada')
              AND dp.arquivada_em IS NULL
            ORDER BY dp.data_solicitacao DESC
            LIMIT 5
        `, [sku.trim(), empresaId]);
        res.status(200).json({
            temDuplicata: result.rows.length > 0,
            demandasAtivas: result.rows
        });
    } catch (error) {
        console.error('[GET /demandas/verificar-duplicata] Erro:', error);
        res.status(500).json({ error: 'Erro interno.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PATCH /api/demandas/:id/prioridade
router.patch('/:id/prioridade', async (req, res) => {
    const { id } = req.params;
    const empresaId = obterEmpresaIdDoContexto(req);
    const { nova_prioridade } = req.body;
    const prioridade = parseInt(nova_prioridade) === 1 ? 1 : 2;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(
            `UPDATE demandas_producao SET prioridade = $1 WHERE id = $2 AND empresa_id = $3 RETURNING *`,
            [prioridade, id, empresaId]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Demanda não encontrada.' });
        // Registra evento de alerta (best-effort — não falha se a tabela não existir)
        if (prioridade === 1) {
            dbClient.query(
                `INSERT INTO eventos_sistema
                    (empresa_id, tipo_evento, mensagem, lido, dados_extras)
                 VALUES ($1, 'DEMANDA_PRIORITARIA', $2, false,
                         jsonb_build_object('empresa_id', $1, 'demanda_id', $3))`,
                [empresaId, `Demanda #${id} promovida a PRIORIDADE — verificar painel imediatamente!`, Number(id)]
            ).catch(() => {});
        }
        res.status(200).json({ message: 'Prioridade atualizada.', demanda: result.rows[0] });
    } catch (error) {
        console.error('[PATCH /demandas/:id/prioridade] Erro:', error);
        res.status(500).json({ error: 'Erro interno.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PATCH /api/demandas/:id/quantidade
router.patch('/:id/quantidade', async (req, res) => {
    const { id } = req.params;
    const empresaId = obterEmpresaIdDoContexto(req);
    const qtd = parseInt(req.body.nova_quantidade);
    if (!qtd || qtd < 1) return res.status(400).json({ error: 'Quantidade inválida.' });
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(
            `UPDATE demandas_producao SET quantidade_solicitada = $1 WHERE id = $2 AND empresa_id = $3 RETURNING *`,
            [qtd, id, empresaId]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Demanda não encontrada.' });
        res.status(200).json({ message: 'Quantidade atualizada.', demanda: result.rows[0] });
    } catch (error) {
        console.error('[PATCH /demandas/:id/quantidade] Erro:', error);
        res.status(500).json({ error: 'Erro interno.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
