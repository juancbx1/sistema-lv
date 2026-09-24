// api/ordens-de-producao.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';
import { obterEmpresaIdDoContexto } from './contexto-empresa.js';

// Importar a função de buscar permissões completas
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';
import { registrarAuditoria } from './audit.js';
import { construirEtapasCanonicas, etapaEhLiberacaoAutomatica } from './utils/etapas-produto.js';
import { registrarLiberacaoAutomaticaProdutoPronto } from './utils/origens-produto-pronto.js';
import { finalizarOrdemProducao } from './utils/finalizar-op.js';
import {
    atualizarImpedimentoMonitoramento,
    consultarMonitoramentoOps,
    erroMonitoramento,
    MONITORAMENTO_OPS_PERMISSOES,
    obterEstruturaMonitoramentoOps,
    registrarAdiamentoMonitoramento,
    registrarImpedimentoMonitoramento,
    usuarioPodeAcessarMonitoramento,
    usuarioPodeOperarMonitoramento,
} from './utils/monitoramento-ops.js';

const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    timezone: 'UTC',
});
const SECRET_KEY = process.env.JWT_SECRET;

function responderErroMonitoramento(res, error, contexto) {
    const status = Number(error?.statusCode) || 500;
    if (status >= 500) console.error(contexto, error);
    return res.status(status).json({
        error: error?.message || 'Erro no monitoramento de OPs.',
        codigo: error?.codigo || (status >= 500 ? 'MONITORAMENTO_OPS_ERRO_INTERNO' : 'MONITORAMENTO_OPS_INVALIDO'),
    });
}

const verificarTokenOriginal = (reqOriginal) => {
    const authHeader = reqOriginal.headers.authorization;
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
    }
    catch (err) {
        const error = new Error('Token inválido ou expirado');
        error.statusCode = 401;
        if (err.name === 'TokenExpiredError') error.details = 'jwt expired';
        throw error;
    }
};

// Middleware para este router: Apenas autentica o token.
router.use(async (req, res, next) => {
    try {
        const tokenClaims = verificarTokenOriginal(req);
        req.usuarioLogado = {
            ...tokenClaims,
            ...(req.usuarioLogado || {}),
            id: req.usuarioLogado?.id || tokenClaims.id,
            nome: req.usuarioLogado?.nome || tokenClaims.nome,
        };
        obterEmpresaIdDoContexto(req);
        next();
    } catch (error) {
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({ error: error.message, details: error.details });
    }
});

// GET /api/ordens-de-producao/ (Listar OPs com filtros e paginação)
router.get('/', async (req, res) => {
    const { usuarioLogado } = req;
    const { query } = req;
    let dbClient; 

    try {
        dbClient = await pool.connect();
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(
            dbClient,
            usuarioLogado.id,
            req.empresaId
        );
        if (!permissoesCompletas.includes('acesso-ordens-de-producao')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        if (query.getNextNumber === 'true') {
            const result = await dbClient.query(`SELECT numero FROM ordens_de_producao WHERE empresa_id = $1 ORDER BY CAST(NULLIF(REGEXP_REPLACE(numero, '\\D', '', 'g'), '') AS INTEGER) DESC NULLS LAST, numero DESC`, [req.empresaId]);
            return res.status(200).json(result.rows.map(row => row.numero));
        }

        const page = parseInt(query.page) || 1;
        const limit = parseInt(query.limit) || 10;
        const offset = (page - 1) * limit;

        // 1. QUERY PRINCIPAL (MANTIDA)
        const queryTextBase = `
            SELECT 
                op.id, op.numero, op.variante, op.quantidade, op.data_entrega, 
                op.observacoes, op.status, op.edit_id, op.etapas, op.data_final,
                op.produto_id, 
                p.nome AS produto,
                p.imagem AS imagem_produto -- Já trazemos a imagem aqui se possível
            FROM ordens_de_producao op
            LEFT JOIN produtos p ON op.produto_id = p.id AND p.empresa_id = op.empresa_id
        `;
        
        let whereClauses = ['op.empresa_id = $1'];
        let params = [req.empresaId];
        let paramIndex = 2;

        // --- A LÓGICA DO FILTRO CORRIGIDA ESTÁ AQUI ---
        if (query.status && query.status !== 'todas') {
            // Se um status específico (e diferente de 'todas') for enviado, use-o
            whereClauses.push(`op.status = $${paramIndex++}`);
            params.push(query.status);
        } else {
            // Se o status for 'todas' ou se nenhum status for enviado,
            // aplica o filtro padrão para mostrar apenas 'em-aberto' e 'produzindo'.
            whereClauses.push(`op.status IN ('em-aberto', 'produzindo')`);
        }

        if (query.search) {
            const searchTerm = `%${query.search}%`;
            whereClauses.push(`(op.numero ILIKE $${paramIndex} OR p.nome ILIKE $${paramIndex + 1} OR op.variante ILIKE $${paramIndex + 2})`);
            params.push(searchTerm, searchTerm, searchTerm);
            paramIndex += 3;
        }
        
        const whereCondition = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
        
        const countQuery = `SELECT COUNT(op.id) FROM ordens_de_producao op LEFT JOIN produtos p ON op.produto_id = p.id AND p.empresa_id = op.empresa_id ${whereCondition}`;
        const orderBy = query.status === 'finalizado' ? 'op.data_final DESC NULLS LAST' : 'op.id DESC';
        const dataQuery = `${queryTextBase} ${whereCondition} ORDER BY ${orderBy} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        
        const countParams = params.slice();
        params.push(limit, offset);

        const totalResult = await dbClient.query(countQuery, countParams);
        const total = parseInt(totalResult.rows[0].count);
        const result = await dbClient.query(dataQuery, params);
        
        let ops = result.rows;

        // --- OTIMIZAÇÃO VERCEL (N+1 KILLER) ---
        // Se houver OPs na lista, buscamos o progresso delas em UMA única consulta agregada.
        if (ops.length > 0) {
            const numerosOps = ops.map(o => o.numero);
            
            // Busca quanto foi produzido em cada etapa para essas OPs
            const progressoResult = await dbClient.query(`
                SELECT op_numero, etapa_index, SUM(quantidade) as total_feito
                FROM producoes 
                WHERE op_numero = ANY($1::text[])
                GROUP BY op_numero, etapa_index
            `, [numerosOps]);

            // Cria um mapa para acesso rápido: "NumeroOP-IndexEtapa" -> Quantidade
            const mapaProgresso = new Map();
            progressoResult.rows.forEach(row => {
                mapaProgresso.set(`${row.op_numero}-${row.etapa_index}`, parseInt(row.total_feito || 0));
            });

            // Enriquece as OPs com a info se estão prontas
            ops = ops.map(op => {
                if (!op.etapas || !Array.isArray(op.etapas)) return op;

                const etapasEnriquecidas = op.etapas.map((etapa, index) => {
                    const totalFeito = mapaProgresso.get(`${op.numero}-${index}`) || 0;
                    // Consideramos "lançado" se o total feito for >= quantidade da OP (ou lógica de negócio específica)
                    // Mas para o card "Amarelo", o importante é saber se a etapa existe.
                    return {
                        ...etapa,
                        lancado: totalFeito > 0, // Simplificação para o card: se tem produção, teve movimento
                        quantidade_feita: totalFeito
                    };
                });

                return {
                    ...op,
                    etapas: etapasEnriquecidas
                };
            });
        }
        // ---------------------------------------

        // --- RADAR DE TEMPO (Bulk Data) ---
        // Busca histórico de OPs finalizadas desde 01/01/2026 para calcular médias por produto
        const radarResult = await dbClient.query(`
            SELECT produto_id, data_entrega, data_final
            FROM ordens_de_producao
            WHERE empresa_id = $1
              AND status = 'finalizado'
              AND data_final IS NOT NULL
              AND data_entrega IS NOT NULL
              AND data_final >= '2026-01-01'
        `, [req.empresaId]);

        // Agrupa por produto_id somando horas e contando OPs
        const somaHorasPorProduto = new Map();
        const contagemPorProduto = new Map();
        radarResult.rows.forEach(row => {
            const horas = (new Date(row.data_final) - new Date(row.data_entrega)) / 3600000;
            if (horas > 0) {
                somaHorasPorProduto.set(row.produto_id, (somaHorasPorProduto.get(row.produto_id) || 0) + horas);
                contagemPorProduto.set(row.produto_id, (contagemPorProduto.get(row.produto_id) || 0) + 1);
            }
        });

        // Calcula médias (mínimo 5 OPs para ter amostra válida)
        const mediasRadar = new Map();
        somaHorasPorProduto.forEach((soma, produtoId) => {
            const contagem = contagemPorProduto.get(produtoId);
            if (contagem >= 5) mediasRadar.set(produtoId, soma / contagem);
        });

        // Enriquece cada OP com dados do radar
        const agora = new Date();
        ops = ops.map(op => {
            if (op.status === 'cancelada') return { ...op, radar: null };
            const mediaHoras = mediasRadar.get(op.produto_id);
            if (!mediaHoras) return { ...op, radar: null };

            const horasAbertas = (agora - new Date(op.data_entrega)) / 3600000;
            const multiplo = horasAbertas / mediaHoras;

            let faixa = 'normal';
            if (multiplo >= 3) faixa = 'critico';
            else if (multiplo >= 1.5) faixa = 'atencao';

            return {
                ...op,
                radar: {
                    horas_abertas: Math.round(horasAbertas),
                    media_horas: Math.round(mediaHoras),
                    multiplo: parseFloat(multiplo.toFixed(1)),
                    faixa
                }
            };
        });
        // ----------------------------------

        res.status(200).json({
            rows: ops,
            total: total,
            page: page,
            pages: Math.ceil(total / limit) || 1,
        });

    } catch (error) {
        // ... (catch mantido)
        console.error('[router/ordens-de-producao GET /] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar ordens de produção.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/ordens-de-producao/monitoramento
router.get('/monitoramento', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(
            dbClient,
            usuarioLogado.id,
            req.empresaId,
        );
        if (!usuarioPodeAcessarMonitoramento(permissoes)) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }
        const resultado = await consultarMonitoramentoOps(dbClient, {
            empresaId: req.empresaId,
            usuarioId: usuarioLogado.id,
            podeFinalizar: usuarioPodeOperarMonitoramento(permissoes),
        });
        return res.status(200).json(resultado);
    } catch (error) {
        return responderErroMonitoramento(res, error, '[GET /monitoramento]');
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/ordens-de-producao/monitoramento/adiar
router.post('/monitoramento/adiar', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        if (!usuarioPodeOperarMonitoramento(permissoes)) {
            throw erroMonitoramento('Permissão negada.', 403, 'PERMISSAO_NEGADA');
        }
        const adiamento = await registrarAdiamentoMonitoramento(dbClient, {
            empresaId: req.empresaId,
            usuarioId: usuarioLogado.id,
            idempotencyKey: req.body?.idempotency_key,
        });
        await registrarAuditoria(
            dbClient,
            { ...usuarioLogado, empresa_id: req.empresaId },
            'op.monitoramento_adiado',
            'monitoramento_op',
            adiamento.id,
            { vence_em: adiamento.vence_em },
        );
        await dbClient.query('COMMIT');
        return res.status(201).json({
            id: Number(adiamento.id),
            vence_em: new Date(adiamento.vence_em).toISOString(),
        });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK').catch(() => undefined);
        return responderErroMonitoramento(res, error, '[POST /monitoramento/adiar]');
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/ordens-de-producao/monitoramento/impedimentos
router.post('/monitoramento/impedimentos', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        if (!usuarioPodeAcessarMonitoramento(permissoes)) {
            throw erroMonitoramento('Permissão negada.', 403, 'PERMISSAO_NEGADA');
        }
        const resultado = await registrarImpedimentoMonitoramento(dbClient, {
            empresaId: req.empresaId,
            usuarioId: usuarioLogado.id,
            opId: req.body?.op_id,
            motivo: req.body?.motivo,
        });
        await registrarAuditoria(
            dbClient,
            { ...usuarioLogado, empresa_id: req.empresaId },
            'op.monitoramento_impedimento_registrado',
            'op',
            resultado.op.numero,
            { op_id: resultado.op.id, motivo: resultado.impedimento.motivo },
        );
        await dbClient.query('COMMIT');
        return res.status(201).json(resultado.impedimento);
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK').catch(() => undefined);
        return responderErroMonitoramento(res, error, '[POST /monitoramento/impedimentos]');
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PATCH /api/ordens-de-producao/monitoramento/impedimentos/:id
router.patch('/monitoramento/impedimentos/:id', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        if (!usuarioPodeAcessarMonitoramento(permissoes)) {
            throw erroMonitoramento('Permissão negada.', 403, 'PERMISSAO_NEGADA');
        }
        const impedimento = await atualizarImpedimentoMonitoramento(dbClient, {
            empresaId: req.empresaId,
            usuarioId: usuarioLogado.id,
            impedimentoId: req.params.id,
            acao: req.body?.acao,
            motivo: req.body?.motivo,
        });
        await registrarAuditoria(
            dbClient,
            { ...usuarioLogado, empresa_id: req.empresaId },
            req.body?.acao === 'resolver'
                ? 'op.monitoramento_impedimento_resolvido'
                : 'op.monitoramento_impedimento_atualizado',
            'op',
            impedimento.op_id,
            { impedimento_id: impedimento.id },
        );
        await dbClient.query('COMMIT');
        return res.status(200).json(impedimento);
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK').catch(() => undefined);
        return responderErroMonitoramento(res, error, '[PATCH /monitoramento/impedimentos]');
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/ordens-de-producao/monitoramento/finalizar-lote
router.post('/monitoramento/finalizar-lote', async (req, res) => {
    const { usuarioLogado } = req;
    const opIds = Array.isArray(req.body?.op_ids)
        ? [...new Set(req.body.op_ids.map(Number).filter(Number.isSafeInteger))]
        : [];
    const idempotencyKey = String(req.body?.idempotency_key || '').trim();
    if (opIds.length === 0 || opIds.length > 100) {
        return res.status(400).json({ error: 'Informe entre 1 e 100 OPs.', codigo: 'LOTE_OPS_INVALIDO' });
    }
    if (idempotencyKey.length < 8 || idempotencyKey.length > 120) {
        return res.status(400).json({ error: 'Chave de idempotência inválida.', codigo: 'IDEMPOTENCY_KEY_INVALIDA' });
    }

    let controleClient;
    let loteId = null;
    try {
        controleClient = await pool.connect();
        await controleClient.query('BEGIN');
        const permissoes = await getPermissoesCompletasUsuarioDB(
            controleClient,
            usuarioLogado.id,
            req.empresaId,
        );
        if (!usuarioPodeOperarMonitoramento(permissoes)) {
            throw erroMonitoramento('Permissão negada.', 403, 'PERMISSAO_NEGADA');
        }
        const estrutura = await obterEstruturaMonitoramentoOps(controleClient);
        if (!estrutura.lotes) {
            throw erroMonitoramento(
                'A persistência do monitoramento ainda não está disponível.',
                503,
                'MONITORAMENTO_OPS_SCHEMA_INDISPONIVEL',
            );
        }
        const insertLote = await controleClient.query(`
            INSERT INTO op_monitoramento_lotes (
                empresa_id,
                usuario_id,
                idempotency_key,
                op_ids,
                status
            ) VALUES ($1, $2, $3, $4::integer[], 'PROCESSANDO')
            ON CONFLICT (empresa_id, usuario_id, idempotency_key) DO NOTHING
            RETURNING id
        `, [req.empresaId, usuarioLogado.id, idempotencyKey, opIds]);

        if (!insertLote.rows[0]) {
            const existente = await controleClient.query(`
                SELECT id, status, resultado, op_ids
                  FROM op_monitoramento_lotes
                 WHERE empresa_id = $1
                   AND usuario_id = $2
                   AND idempotency_key = $3
                 FOR UPDATE
            `, [req.empresaId, usuarioLogado.id, idempotencyKey]);
            const loteExistente = existente.rows[0];
            const idsExistentes = Array.isArray(loteExistente?.op_ids)
                ? loteExistente.op_ids.map(Number)
                : [];
            const mesmaRequisicao = idsExistentes.length === opIds.length
                && idsExistentes.every((id, index) => id === opIds[index]);
            await controleClient.query('COMMIT');
            if (!mesmaRequisicao) {
                return res.status(409).json({
                    error: 'A chave de idempotência já foi usada com outro conjunto de OPs.',
                    codigo: 'IDEMPOTENCY_KEY_REUTILIZADA',
                });
            }
            if (loteExistente?.status === 'CONCLUIDO') {
                return res.status(200).json({ ...loteExistente.resultado, reutilizado: true });
            }
            return res.status(409).json({
                error: 'Este lote já está sendo processado.',
                codigo: 'LOTE_EM_PROCESSAMENTO',
            });
        }
        loteId = Number(insertLote.rows[0].id);
        await controleClient.query('COMMIT');
        controleClient.release();
        controleClient = null;

        const detalhes = [];
        for (const opId of opIds) {
            let opClient;
            try {
                opClient = await pool.connect();
                await opClient.query('BEGIN');
                const op = await finalizarOrdemProducao(opClient, {
                    empresaId: req.empresaId,
                    usuarioLogado,
                    opId,
                });
                await opClient.query('COMMIT');
                detalhes.push({
                    op_id: opId,
                    numero: op.numero,
                    ok: true,
                    ja_finalizada: Boolean(op.ja_finalizada),
                });
            } catch (error) {
                if (opClient) await opClient.query('ROLLBACK').catch(() => undefined);
                detalhes.push({
                    op_id: opId,
                    ok: false,
                    codigo: error?.codigo || 'FINALIZACAO_OP_FALHOU',
                    erro: error?.message || 'Erro ao finalizar OP.',
                });
            } finally {
                if (opClient) opClient.release();
            }
        }

        const resultado = {
            lote_id: loteId,
            sucesso: detalhes.filter((item) => item.ok).length,
            erro: detalhes.filter((item) => !item.ok).length,
            detalhes,
        };
        controleClient = await pool.connect();
        await controleClient.query(`
            UPDATE op_monitoramento_lotes
               SET status = 'CONCLUIDO',
                   resultado = $2::jsonb,
                   concluido_em = CURRENT_TIMESTAMP,
                   atualizado_em = CURRENT_TIMESTAMP
             WHERE id = $1
               AND empresa_id = $3
        `, [loteId, JSON.stringify(resultado), req.empresaId]);
        await registrarAuditoria(
            controleClient,
            { ...usuarioLogado, empresa_id: req.empresaId },
            'op.monitoramento_lote_finalizado',
            'monitoramento_op_lote',
            loteId,
            { sucesso: resultado.sucesso, erro: resultado.erro, op_ids: opIds },
        );
        return res.status(200).json(resultado);
    } catch (error) {
        if (controleClient) await controleClient.query('ROLLBACK').catch(() => undefined);
        if (loteId) {
            let falhaClient;
            try {
                falhaClient = await pool.connect();
                await falhaClient.query(`
                    UPDATE op_monitoramento_lotes
                       SET status = 'FALHOU',
                           atualizado_em = CURRENT_TIMESTAMP
                     WHERE id = $1
                       AND empresa_id = $2
                `, [loteId, req.empresaId]);
            } catch {
                // A resposta original é mais importante que a atualização auxiliar.
            } finally {
                if (falhaClient) falhaClient.release();
            }
        }
        return responderErroMonitoramento(res, error, '[POST /monitoramento/finalizar-lote]');
    } finally {
        if (controleClient) controleClient.release();
    }
});

// Compatibilidade temporária: usa a mesma fonte canônica do v2 e a nova
// permissão. Consumidores novos devem usar GET /monitoramento.
router.get('/prontas-para-encerrar', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;

    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        if (!usuarioPodeAcessarMonitoramento(permissoes)) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }
        const monitoramento = await consultarMonitoramentoOps(dbClient, {
            empresaId: req.empresaId,
            usuarioId: usuarioLogado.id,
            podeFinalizar: usuarioPodeOperarMonitoramento(permissoes),
        });
        return res.status(200).json(
            monitoramento.ops.filter((op) => op.faixa !== 'ACOMPANHAMENTO'),
        );

    } catch (error) {
        console.error('[GET /prontas-para-encerrar]', error);
        res.status(500).json({ error: 'Erro ao buscar OPs prontas.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/ordens-de-producao/:id
router.get('/:id', async (req, res) => {
    const { usuarioLogado } = req;
    const opIdentifier = req.params.id;
    let dbClient; 

    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        if (!permissoes.includes('acesso-ordens-de-producao')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        // 1. Busca a OP principal E as configurações originais do produto
        // Note o p.etapas as etapas_config
        const opQuery = `
            SELECT op.*, p.nome as produto, p.etapas as etapas_config
            FROM ordens_de_producao op
            LEFT JOIN produtos p ON op.produto_id = p.id AND p.empresa_id = op.empresa_id
            WHERE op.empresa_id = $2
              AND (op.edit_id = $1 OR op.numero = $1)
        `;
        const opResult = await dbClient.query(opQuery, [opIdentifier, req.empresaId]);

        if (opResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ordem de Produção não encontrada.' });
        }
        
        let op = opResult.rows[0];

        // 2. Busca lançamentos detalhados
        const lancamentosResult = await dbClient.query(
            `SELECT id, etapa_index, processo, quantidade, funcionario, funcionario_id, data 
             FROM producoes 
             WHERE op_numero = $1 
             ORDER BY data DESC`,
            [op.numero]
        );
        op.lancamentos_detalhados = lancamentosResult.rows;

        // 3. Agrupa e Enriquece as Etapas
        const lancamentosPorEtapa = lancamentosResult.rows.reduce((acc, lancamento) => {
            const index = lancamento.etapa_index;
            if (!acc[index]) acc[index] = { quantidadeTotal: 0 };
            acc[index].quantidadeTotal += lancamento.quantidade;
            return acc;
        }, {});

        if (Array.isArray(op.etapas)) {
            op.etapas = op.etapas.map((etapa, index) => {
                // Tenta achar a configuração original para pegar a máquina
                // O 'etapa' salvo na OP pode ser string ou objeto simples.
                const nomeProcesso = etapa.processo || etapa;
                
                // Busca no config do produto
                let configOriginal = null;
                if (op.etapas_config && Array.isArray(op.etapas_config)) {
                    configOriginal = op.etapas_config.find(c => (c.processo || c) === nomeProcesso);
                }

                const lancamentoInfo = lancamentosPorEtapa[index];
                
                return {
                    ...etapa,
                    processo: nomeProcesso, // Garante nome
                    maquina: configOriginal?.maquina || 'Não Definida', // <--- AQUI ESTÁ O OURO
                    feitoPor: configOriginal?.feitoPor || 'indefinido', // <--- Importante para saber se é costureira
                    lancado: !!lancamentoInfo,
                    quantidade: lancamentoInfo ? lancamentoInfo.quantidadeTotal : 0
                };
            });
        }

        // Removemos etapas_config do retorno final para limpar o JSON
        delete op.etapas_config;

        res.status(200).json(op);

    } catch (error) {
        console.error(`[router/ordens-de-producao GET /:id] Erro:`, error);
        res.status(500).json({ error: 'Erro ao buscar detalhes da OP.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/ordens-de-producao/ (Criar nova OP)
router.post('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;

    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        if (!permissoes.includes('gerar-op')) {
            throw new Error('Permissão negada.');
        }
        
        // MUDANÇA: Adicionado 'quantidade' na extração
        const { numero, data_entrega, observacoes, corte_origem_id, demanda_id, quantidade } = req.body;
        
        if (!numero || !data_entrega || !corte_origem_id) {
            throw new Error('Dados incompletos.');
        }
        
        // 1. BUSCAR E TRAVAR O CORTE DE ORIGEM
        const corteResult = await dbClient.query('SELECT * FROM cortes WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [corte_origem_id, req.empresaId]);
        if (corteResult.rows.length === 0) throw new Error('Corte de origem não encontrado.');
        const corte = corteResult.rows[0];
        if (corte.op) throw new Error(`Este corte (PC: ${corte.pn}) já foi utilizado na OP #${corte.op}.`);

        // VALIDAÇÃO DE QUANTIDADE (SPLIT)
        // Se o frontend mandou quantidade, usa ela. Se não, usa o total do corte.
        let qtdFinalOP = parseInt(quantidade);
        if (!qtdFinalOP || isNaN(qtdFinalOP)) {
            qtdFinalOP = corte.quantidade; // Fallback
        }

        if (qtdFinalOP > corte.quantidade) {
            throw new Error(`Quantidade solicitada (${qtdFinalOP}) é maior que a disponível no corte (${corte.quantidade}).`);
        }

        // 2. DETERMINAR O DEMANDA_ID FINAL (A REDE DE SEGURANÇA)
        // Se o frontend mandou, usa. Se não, tenta pegar do corte salvo no banco. Se não tiver, é null.
        const demandaIdFinal = demanda_id || corte.demanda_id || null;

        // 3. BUSCAR DETALHES DO PRODUTO (ETAPAS)
        const produtoResult = await dbClient.query('SELECT etapas FROM produtos WHERE id = $1 AND empresa_id = $2', [corte.produto_id, req.empresaId]);
        if (produtoResult.rows.length === 0) throw new Error('Produto do corte não encontrado.');
        const etapasConfig = produtoResult.rows[0].etapas || [];

        // 4. CRIAR A NOVA OP
        const opPayload = {
            numero,
            produto_id: corte.produto_id,
            variante: corte.variante,
            quantidade: qtdFinalOP,
            data_entrega,
            observacoes,
            status: 'produzindo', 
            edit_id: `${Date.now()}${Math.random().toString(36).substring(2, 7)}`,
            etapas: etapasConfig.map(e => ({ processo: (e.processo || e), lancado: false, quantidade: 0, usuario: '' })),
            demanda_id: demandaIdFinal // Usa o ID calculado
        };

        const opInsertResult = await dbClient.query(
            `INSERT INTO ordens_de_producao (empresa_id, numero, produto_id, variante, quantidade, data_entrega, observacoes, status, edit_id, etapas, demanda_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [
                req.empresaId,
                opPayload.numero, 
                opPayload.produto_id, 
                opPayload.variante, 
                opPayload.quantidade, 
                opPayload.data_entrega, 
                opPayload.observacoes, 
                opPayload.status, 
                opPayload.edit_id, 
                JSON.stringify(opPayload.etapas),
                opPayload.demanda_id
            ]
        );
        const opCriada = opInsertResult.rows[0];

        // 5. LÓGICA DE FRACIONAMENTO DE CORTE (SPLIT)
        const qtdUsada = opPayload.quantidade;
        const qtdOriginalCorte = corte.quantidade;

        if (qtdUsada < qtdOriginalCorte) {
            // CENÁRIO: Consumo Parcial (Sobra saldo)
            const saldoRestante = qtdOriginalCorte - qtdUsada;
            // 5a. Atualiza o corte original (que virou OP)
            await dbClient.query(
                `UPDATE cortes SET op = $1, status = 'usado', quantidade = $2 WHERE id = $3 AND empresa_id = $4`,
                [opCriada.numero, qtdUsada, corte_origem_id, req.empresaId]
            );

            // --- INÍCIO DA SUBSTITUIÇÃO (5b) ---
            
            // 5b. Cria um NOVO registro de corte com o saldo restante
            // Lógica de PN Limpo: Mantém a raiz do PN original e adiciona sufixo único
            const pnRaiz = corte.pn.split('-S')[0]; 
            const novoPn = `${pnRaiz}-S${Date.now().toString().slice(-5)}`; // Ex: 13935-S59281

            await dbClient.query(
                `INSERT INTO cortes (empresa_id, produto_id, variante, quantidade, data, status, pn, cortador, demanda_id)
                 VALUES ($1, $2, $3, $4, $5, 'cortados', $6, $7, NULL)`,
                [req.empresaId, corte.produto_id, corte.variante, saldoRestante, corte.data, novoPn, corte.cortador]
            );
            
            // --- FIM DA SUBSTITUIÇÃO ---

        } else {
            // CENÁRIO: Consumo Total
            await dbClient.query(
                `UPDATE cortes SET op = $1, status = 'usado' WHERE id = $2 AND empresa_id = $3`,
                [opCriada.numero, corte_origem_id, req.empresaId]
            );
        }

        // 6. LANÇAR AUTOMATICAMENTE A ETAPA DE CORTE NA TABELA 'producoes'
        const etapaCorteIndex = etapasConfig.findIndex(e => (e.processo || e).toLowerCase() === 'corte');
        
        if (etapaCorteIndex !== -1) {
            const etapaConfigCorte = etapasConfig[etapaCorteIndex];
            const maquinaDoCorte = etapaConfigCorte?.maquina || 'Não Definida';
            const nomeCortador = corte.cortador || usuarioLogado.nome;
            const cortadorInfo = await dbClient.query('SELECT id FROM usuarios WHERE nome ILIKE $1', [nomeCortador]);
            const cortadorId = cortadorInfo.rows.length > 0 ? cortadorInfo.rows[0].id : null;

            const idProducaoTexto = `prod_${Date.now()}`;

            await dbClient.query(
                `INSERT INTO producoes (id, op_numero, etapa_index, processo, produto_id, variacao, maquina, quantidade, funcionario, funcionario_id, data, lancado_por, empresa_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                [idProducaoTexto, opCriada.numero, etapaCorteIndex, 'Corte', corte.produto_id, corte.variante || '-', maquinaDoCorte, opPayload.quantidade, nomeCortador, cortadorId, corte.data, usuarioLogado.nome, req.empresaId]
            );
        }
        
        // 7. ATUALIZAR STATUS DA DEMANDA (Se houver vínculo)
        if (demandaIdFinal) {
             const demandaVinculo = await dbClient.query(
                 `SELECT id FROM demandas_producao WHERE id = $1 AND empresa_id = $2`,
                 [demandaIdFinal, req.empresaId]
             );
             if (demandaVinculo.rowCount === 0) throw new Error('Demanda não encontrada na empresa ativa.');
             await dbClient.query(`UPDATE demandas_producao SET status = 'em_producao' WHERE id = $1 AND empresa_id = $2`, [demandaIdFinal, req.empresaId]);
        }

        await dbClient.query('COMMIT');
        await registrarAuditoria(dbClient, usuarioLogado, 'op.gerada_do_estoque', 'op', opCriada.numero, {
            numero: opCriada.numero,
            produto_id: opCriada.produto_id,
            variante: opCriada.variante,
            quantidade: opCriada.quantidade,
            corte_pn: corte.pn,
        });
        res.status(201).json(opCriada);

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST OP V5 - ERRO]', error);
        res.status(500).json({ error: 'Erro ao criar Ordem de Produção.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

//GET /api/ordens-de-producao/check-op-filha/:numeroMae
router.get('/check-op-filha/:numeroMae', async (req, res) => {
    const { usuarioLogado } = req; // <<< Verifique se o middleware está passando isso
    const { numeroMae } = req.params;
    let dbClient;

    try {
        dbClient = await pool.connect();
        
        // Verificação de permissão (opcional, mas bom ter)
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        if (!permissoesCompletas.includes('acesso-ordens-de-producao')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }
        
        const textoBusca = `OP gerada em conjunto com a OP mãe #${numeroMae}`;

        const query = `
            SELECT EXISTS (
                SELECT 1 
                FROM ordens_de_producao 
                WHERE empresa_id = $2
                  AND observacoes = $1 AND status NOT IN ('cancelada', 'excluido')
            ) as "filhaExiste";
        `;

        const result = await dbClient.query(query, [textoBusca, req.empresaId]);
        const { filhaExiste } = result.rows[0];

        res.status(200).json({ existe: filhaExiste });

    } catch (error) {
        console.error(`[API check-op-filha] Erro ao verificar OP filha para mãe #${numeroMae}:`, error);
        // Não retorne o erro HTML, retorne um JSON de erro
        res.status(500).json({ error: 'Erro ao verificar OP filha.', existe: true });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// PUT /api/ordens-de-producao/ (Atualizar OP existente)
router.put('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN'); // <<< 1. INICIA A TRANSAÇÃO NO COMEÇO

        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(
            dbClient,
            usuarioLogado.id,
            req.empresaId
        );
        
        const opData = req.body;
        const { edit_id, numero, status, produto_id } = opData;

        if (!edit_id) {
            throw new Error('O campo "edit_id" é obrigatório para atualização.');
        }

        // A finalização não confia mais no objeto completo enviado pelo
        // navegador. O serviço relê, trava e recalcula a OP na empresa ativa.
        if (status === 'finalizado') {
            if (!permissoesCompletas.includes(MONITORAMENTO_OPS_PERMISSOES.finalizar)) {
                await dbClient.query('ROLLBACK');
                return res.status(403).json({ error: 'Permissão negada para finalizar esta OP.' });
            }
            const opFinalizada = await finalizarOrdemProducao(dbClient, {
                empresaId: req.empresaId,
                usuarioLogado,
                editId: edit_id,
            });
            await dbClient.query('COMMIT');
            return res.status(200).json(opFinalizada);
        }

        if (!produto_id && status !== 'cancelada') {
            throw new Error('O campo "produto_id" é obrigatório para atualização.');
        }

        if (produto_id && status !== 'cancelada') {
            const produtoVinculo = await dbClient.query(
                'SELECT id FROM produtos WHERE id = $1 AND empresa_id = $2',
                [produto_id, req.empresaId]
            );
            if (produtoVinculo.rowCount === 0) {
                throw new Error('Produto não encontrado na empresa ativa.');
            }
        }

        let permissaoConcedida = false;
        if (status === 'cancelada' && permissoesCompletas.includes('cancelar-op')) permissaoConcedida = true;
        else if (status === 'finalizado' && permissoesCompletas.includes('finalizar-op')) permissaoConcedida = true;
        else if (permissoesCompletas.includes('editar-op')) permissaoConcedida = true;

        if (!permissaoConcedida) {
            return res.status(403).json({ error: 'Permissão negada para realizar esta alteração.' });
        }
        
        // --- INÍCIO DA NOVA LÓGICA DE LIMPEZA DE STATUS ---
        if (status === 'finalizado' || status === 'cancelada') {            
            // 1. Buscamos SESSÕES de trabalho ativas (Inteiros), não produções passadas (Texto).
            // Isso corrige o erro de tipo "integer = text".
            const sessoesAtivasResult = await dbClient.query(
                `SELECT id, funcionario_id FROM sessoes_trabalho_producao 
                 WHERE op_numero = $1
                   AND empresa_id = $2
                   AND status = 'EM_ANDAMENTO'`,
                [numero, req.empresaId]
            );
            
            if (sessoesAtivasResult.rows.length > 0) {
                const idsSessoes = sessoesAtivasResult.rows.map(r => r.id);
                // 2. Agora podemos usar ::int[] com segurança, pois estamos comparando
                // id_sessao_trabalho_atual (Inteiro) com idsSessoes (Inteiros).
                const updateUserResult = await dbClient.query(
                    `UPDATE usuarios_empresas
                        SET status_atual = 'LIVRE',
                            id_sessao_trabalho_atual = NULL,
                            status_data_modificacao =
                                (NOW() AT TIME ZONE 'America/Sao_Paulo')
                      WHERE id_sessao_trabalho_atual = ANY($1::int[])
                        AND empresa_id = $2
                        AND ativo`,
                    [idsSessoes, req.empresaId]
                );
                
                // 3. Opcional: Marcar essas sessões como CANCELADAS ou FINALIZADAS no banco
                // para não ficarem "EM_ANDAMENTO" para sempre órfãs.
                await dbClient.query(
                    `UPDATE sessoes_trabalho_producao 
                     SET status = 'FINALIZADA_FORCADA', data_fim = NOW() 
                     WHERE id = ANY($1::int[])
                       AND empresa_id = $2`,
                    [idsSessoes, req.empresaId]
                );

            }
        }
        // --- FIM DA NOVA LÓGICA DE LIMPEZA DE STATUS ---

        // --- RECALCULO DE ETAPAS NA FINALIZAÇÃO ---
        // Quando finaliza, sempre recalcula as quantidades das etapas direto das 'producoes'.
        // Isso garante que o saldo de arremate fique correto independente do que o frontend mandou.
        if (status === 'finalizado') {
            const etapasDBResult = await dbClient.query(
                `SELECT etapas FROM ordens_de_producao WHERE edit_id = $1 AND empresa_id = $2`, [edit_id, req.empresaId]
            );
            const etapasBase = etapasDBResult.rows[0]?.etapas || opData.etapas || [];

            const lancsResult = await dbClient.query(
                `SELECT etapa_index, SUM(quantidade) as total FROM producoes WHERE op_numero = $1 GROUP BY etapa_index`,
                [numero]
            );
            const lancsMap = new Map();
            lancsResult.rows.forEach(r => lancsMap.set(parseInt(r.etapa_index), parseInt(r.total)));

            opData.etapas = etapasBase.map((etapa, index) => ({
                ...etapa,
                lancado: lancsMap.has(index),
                quantidade: lancsMap.get(index) || 0
            }));

            // Alguns produtos saem prontos da Ãºltima etapa OP. A etapa POS_OP
            // permanece como gate de embalagem, mas pode ser explicitamente
            // marcada como liberaÃ§Ã£o automÃ¡tica, sem tarefa ou pontos.
            const produtoEtapasResult = await dbClient.query(
                `SELECT etapas, "etapastiktik" AS etapas_tiktik
                   FROM produtos
                  WHERE id = $1
                    AND empresa_id = $2`,
                [produto_id, req.empresaId],
            );
            const etapasCanonicas = construirEtapasCanonicas({
                etapas: produtoEtapasResult.rows[0]?.etapas,
                etapasTiktik: produtoEtapasResult.rows[0]?.etapas_tiktik,
            }).etapasCanonicas;
            const etapasPosOp = etapasCanonicas.filter((etapa) => etapa.fase === 'POS_OP');
            const etapasAutomaticas = etapasPosOp.filter(etapaEhLiberacaoAutomatica);

            if (etapasAutomaticas.length > 1 || (etapasAutomaticas.length > 0 && etapasAutomaticas.length !== etapasPosOp.length)) {
                throw new Error('Configure apenas uma etapa POS_OP, manual ou automÃ¡tica, para este produto.');
            }

            if (etapasAutomaticas.length === 1) {
                const etapaFinal = opData.etapas[opData.etapas.length - 1];
                const quantidadeFinal = Number(etapaFinal?.quantidade) || 0;
                await registrarLiberacaoAutomaticaProdutoPronto(dbClient, {
                    empresaId: req.empresaId,
                    produtoId: produto_id,
                    variante: opData.variante,
                    opNumero: opData.numero,
                    opEditId: opData.edit_id,
                    etapa: etapasAutomaticas[0],
                    quantidade: quantidadeFinal,
                });
            }
        }
        // ------------------------------------------

        let finalizedChildrenNumbers = [];
        if (status === 'cancelada') {
            await dbClient.query(`UPDATE cortes SET status = 'excluido' WHERE op = $1 AND empresa_id = $2`, [numero, req.empresaId]);
        } else if (status === 'finalizado') {
            const textoBusca = `OP gerada em conjunto com a OP mãe #${numero}`;
            const filhasResult = await dbClient.query(
                `UPDATE ordens_de_producao SET status = 'finalizado', data_final = CURRENT_TIMESTAMP WHERE empresa_id = $2 AND observacoes = $1 AND status != 'finalizado' RETURNING numero`,
                [textoBusca, req.empresaId]
            );
            if (filhasResult.rowCount > 0) {
                finalizedChildrenNumbers = filhasResult.rows.map(r => r.numero);
            }
        }
        
        const queryText = `
            UPDATE ordens_de_producao
             SET numero = $1, produto_id = $2, variante = $3, quantidade = $4, data_entrega = $5,
                 observacoes = $6, status = $7, etapas = $8, data_final = $9, 
                 data_atualizacao = CURRENT_TIMESTAMP
             WHERE edit_id = $10 AND empresa_id = $11 RETURNING *`;
        
        const values = [
            opData.numero, parseInt(produto_id), opData.variante || null, parseInt(opData.quantidade), 
            opData.data_entrega, opData.observacoes || '', status, 
            JSON.stringify(opData.etapas || []), opData.data_final || null, edit_id, req.empresaId
        ];

        const result = await dbClient.query(queryText, values);

        if (result.rows.length === 0) {
            throw new Error('Ordem de Produção não encontrada para atualização.');
        }

        const opAtualizada = { ...result.rows[0], finalizedChildren: finalizedChildrenNumbers };

        await dbClient.query('COMMIT'); // <<< 2. CONFIRMA TUDO NO FINAL

        if (status === 'finalizado') {
            await registrarAuditoria(dbClient, usuarioLogado, 'op.encerrada', 'op', opAtualizada.numero, {
                numero: opAtualizada.numero,
                produto_id: opAtualizada.produto_id,
                variante: opAtualizada.variante,
                quantidade: opAtualizada.quantidade,
            });
        } else if (status === 'cancelada') {
            await registrarAuditoria(dbClient, usuarioLogado, 'op.cancelada', 'op', opAtualizada.numero, {
                numero: opAtualizada.numero,
                produto_id: opAtualizada.produto_id,
                variante: opAtualizada.variante,
                motivo: opAtualizada.observacoes || '',
            });
        }

        res.status(200).json(opAtualizada);

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK'); // <<< 3. DESFAZ TUDO EM CASO DE ERRO
        console.error('[router/ordens-de-producao PUT] Erro:', error);
        // O res.status(403) já é enviado antes, aqui tratamos outros erros.
        if (!res.headersSent) {
            const statusCode = Number(error?.statusCode) || 500;
            res.status(statusCode).json({
                error: statusCode >= 500 ? 'Erro ao atualizar Ordem de Produção.' : error.message,
                details: error.message,
                codigo: error?.codigo,
            });
        }
    } finally {
        if (dbClient) {
            dbClient.release();
        }
    }
});

export default router;
