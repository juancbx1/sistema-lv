// api/ordens-de-producao.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';

// Importar a função de buscar permissões completas
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';

const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    timezone: 'UTC',
});
const SECRET_KEY = process.env.JWT_SECRET;

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
        req.usuarioLogado = verificarTokenOriginal(req);
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
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoesCompletas.includes('acesso-ordens-de-producao')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        if (query.getNextNumber === 'true') {
            const result = await dbClient.query(`SELECT numero FROM ordens_de_producao ORDER BY CAST(NULLIF(REGEXP_REPLACE(numero, '\\D', '', 'g'), '') AS INTEGER) DESC NULLS LAST, numero DESC`);
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
            LEFT JOIN produtos p ON op.produto_id = p.id
        `;
        
        let whereClauses = [];
        let params = [];
        let paramIndex = 1;

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
        
        const countQuery = `SELECT COUNT(op.id) FROM ordens_de_producao op LEFT JOIN produtos p ON op.produto_id = p.id ${whereCondition}`;
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
            WHERE status = 'finalizado'
              AND data_final IS NOT NULL
              AND data_entrega IS NOT NULL
              AND data_final >= '2026-01-01'
        `);

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

// GET /api/ordens-de-producao/prontas-para-encerrar
router.get('/prontas-para-encerrar', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;

    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoes.includes('acesso-ordens-de-producao')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const result = await dbClient.query(`
            SELECT
                op.id, op.edit_id, op.numero, op.variante, op.quantidade,
                op.etapas, op.status, op.data_entrega, op.observacoes,
                op.produto_id,
                p.nome AS produto_nome,
                COALESCE(
                    CASE WHEN p.grade IS NOT NULL THEN
                        (SELECT (elem->>'imagem')
                         FROM jsonb_array_elements(p.grade) AS elem
                         WHERE (elem->>'variacao') = op.variante
                           AND (elem->>'imagem') IS NOT NULL
                           AND (elem->>'imagem') != ''
                         LIMIT 1)
                    END,
                    p.imagem
                ) AS produto_imagem,
                (
                    SELECT MAX(prod.data)
                    FROM producoes prod
                    WHERE prod.op_numero = op.numero
                ) AS ultima_producao_em,
                (
                    SELECT COALESCE(SUM(prod.quantidade), 0)
                    FROM producoes prod
                    WHERE prod.op_numero = op.numero
                      AND prod.etapa_index = jsonb_array_length(op.etapas) - 1
                ) AS quantidade_feita_ultima_etapa
            FROM ordens_de_producao op
            LEFT JOIN produtos p ON op.produto_id = p.id
            WHERE op.status IN ('em-aberto', 'produzindo')
              AND op.etapas IS NOT NULL
              AND jsonb_array_length(op.etapas) > 0
              AND (
                  SELECT COUNT(DISTINCT prod.etapa_index)
                  FROM producoes prod
                  WHERE prod.op_numero = op.numero
              ) >= jsonb_array_length(op.etapas)
            ORDER BY ultima_producao_em ASC NULLS LAST
        `);

        const agora = new Date();
        const ops = result.rows.map(row => {
            const etapas = row.etapas || [];
            const ultima = row.ultima_producao_em ? new Date(row.ultima_producao_em) : null;
            return {
                // campos para OPModalLote (PUT /api/ordens-de-producao)
                id: row.id,
                edit_id: row.edit_id,
                numero: row.numero,
                variante: row.variante,
                quantidade: row.quantidade,
                etapas: row.etapas,
                status: row.status,
                data_entrega: row.data_entrega,
                observacoes: row.observacoes,
                produto_id: row.produto_id,
                // campos para display
                produto_nome: row.produto_nome,
                produto_imagem: row.produto_imagem,
                etapa_final: etapas.length > 0 ? (etapas[etapas.length - 1]?.processo ?? null) : null,
                ultima_producao_em: row.ultima_producao_em,
                horas_aguardando: ultima ? Math.round((agora - ultima) / 360000) / 10 : 0,
                quantidade_feita_ultima_etapa: parseInt(row.quantidade_feita_ultima_etapa || 0),
            };
        });

        res.status(200).json(ops);

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
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoes.includes('acesso-ordens-de-producao')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        // 1. Busca a OP principal E as configurações originais do produto
        // Note o p.etapas as etapas_config
        const opQuery = `
            SELECT op.*, p.nome as produto, p.etapas as etapas_config
            FROM ordens_de_producao op
            LEFT JOIN produtos p ON op.produto_id = p.id
            WHERE op.edit_id = $1 OR op.numero = $1
        `;
        const opResult = await dbClient.query(opQuery, [opIdentifier]);

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

        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoes.includes('criar-op')) {
            throw new Error('Permissão negada.');
        }
        
        // MUDANÇA: Adicionado 'quantidade' na extração
        const { numero, data_entrega, observacoes, corte_origem_id, demanda_id, quantidade } = req.body;
        
        if (!numero || !data_entrega || !corte_origem_id) {
            throw new Error('Dados incompletos.');
        }
        
        // 1. BUSCAR E TRAVAR O CORTE DE ORIGEM
        const corteResult = await dbClient.query('SELECT * FROM cortes WHERE id = $1 FOR UPDATE', [corte_origem_id]);
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
        const produtoResult = await dbClient.query('SELECT etapas FROM produtos WHERE id = $1', [corte.produto_id]);
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
            `INSERT INTO ordens_de_producao (numero, produto_id, variante, quantidade, data_entrega, observacoes, status, edit_id, etapas, demanda_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [
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
                `UPDATE cortes SET op = $1, status = 'usado', quantidade = $2 WHERE id = $3`, 
                [opCriada.numero, qtdUsada, corte_origem_id]
            );

            // --- INÍCIO DA SUBSTITUIÇÃO (5b) ---
            
            // 5b. Cria um NOVO registro de corte com o saldo restante
            // Lógica de PN Limpo: Mantém a raiz do PN original e adiciona sufixo único
            const pnRaiz = corte.pn.split('-S')[0]; 
            const novoPn = `${pnRaiz}-S${Date.now().toString().slice(-5)}`; // Ex: 13935-S59281

            await dbClient.query(
                `INSERT INTO cortes (produto_id, variante, quantidade, data, status, pn, cortador, demanda_id)
                 VALUES ($1, $2, $3, $4, 'cortados', $5, $6, NULL)`,
                [corte.produto_id, corte.variante, saldoRestante, corte.data, novoPn, corte.cortador]
            );
            
            // --- FIM DA SUBSTITUIÇÃO ---

        } else {
            // CENÁRIO: Consumo Total
            await dbClient.query(
                `UPDATE cortes SET op = $1, status = 'usado' WHERE id = $2`, 
                [opCriada.numero, corte_origem_id]
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
                `INSERT INTO producoes (id, op_numero, etapa_index, processo, produto_id, variacao, maquina, quantidade, funcionario, funcionario_id, data, lancado_por)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [idProducaoTexto, opCriada.numero, etapaCorteIndex, 'Corte', corte.produto_id, corte.variante, maquinaDoCorte, opPayload.quantidade, nomeCortador, cortadorId, corte.data, usuarioLogado.nome]
            );
        }
        
        // 7. ATUALIZAR STATUS DA DEMANDA (Se houver vínculo)
        if (demandaIdFinal) {
             await dbClient.query(`UPDATE demandas_producao SET status = 'em_producao' WHERE id = $1`, [demandaIdFinal]);
        }

        await dbClient.query('COMMIT');
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
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoesCompletas.includes('acesso-ordens-de-producao')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }
        
        const textoBusca = `OP gerada em conjunto com a OP mãe #${numeroMae}`;

        const query = `
            SELECT EXISTS (
                SELECT 1 
                FROM ordens_de_producao 
                WHERE observacoes = $1 AND status NOT IN ('cancelada', 'excluido')
            ) as "filhaExiste";
        `;
        
        const result = await dbClient.query(query, [textoBusca]);
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

        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        
        const opData = req.body;
        const { edit_id, numero, status, produto_id } = opData;

        if (!edit_id) {
            throw new Error('O campo "edit_id" é obrigatório para atualização.');
        }
        if (!produto_id && status !== 'cancelada') {
            throw new Error('O campo "produto_id" é obrigatório para atualização.');
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
                 WHERE op_numero = $1 AND status = 'EM_ANDAMENTO'`, 
                [numero]
            );
            
            if (sessoesAtivasResult.rows.length > 0) {
                const idsSessoes = sessoesAtivasResult.rows.map(r => r.id);
                // 2. Agora podemos usar ::int[] com segurança, pois estamos comparando
                // id_sessao_trabalho_atual (Inteiro) com idsSessoes (Inteiros).
                const updateUserResult = await dbClient.query(
                    `UPDATE usuarios 
                     SET status_atual = 'LIVRE', id_sessao_trabalho_atual = NULL 
                     WHERE id_sessao_trabalho_atual = ANY($1::int[])`,
                    [idsSessoes]
                );
                
                // 3. Opcional: Marcar essas sessões como CANCELADAS ou FINALIZADAS no banco
                // para não ficarem "EM_ANDAMENTO" para sempre órfãs.
                await dbClient.query(
                    `UPDATE sessoes_trabalho_producao 
                     SET status = 'FINALIZADA_FORCADA', data_fim = NOW() 
                     WHERE id = ANY($1::int[])`,
                    [idsSessoes]
                );

            }
        }
        // --- FIM DA NOVA LÓGICA DE LIMPEZA DE STATUS ---

        // --- RECALCULO DE ETAPAS NA FINALIZAÇÃO ---
        // Quando finaliza, sempre recalcula as quantidades das etapas direto das 'producoes'.
        // Isso garante que o saldo de arremate fique correto independente do que o frontend mandou.
        if (status === 'finalizado') {
            const etapasDBResult = await dbClient.query(
                `SELECT etapas FROM ordens_de_producao WHERE edit_id = $1`, [edit_id]
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
        }
        // ------------------------------------------

        let finalizedChildrenNumbers = [];
        if (status === 'cancelada') {
            await dbClient.query(`UPDATE cortes SET status = 'excluido' WHERE op = $1`, [numero]);
        } else if (status === 'finalizado') {
            const textoBusca = `OP gerada em conjunto com a OP mãe #${numero}`;
            const filhasResult = await dbClient.query(
                `UPDATE ordens_de_producao SET status = 'finalizado', data_final = CURRENT_TIMESTAMP WHERE observacoes = $1 AND status != 'finalizado' RETURNING numero`,
                [textoBusca]
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
             WHERE edit_id = $10 RETURNING *`;
        
        const values = [
            opData.numero, parseInt(produto_id), opData.variante || null, parseInt(opData.quantidade), 
            opData.data_entrega, opData.observacoes || '', status, 
            JSON.stringify(opData.etapas || []), opData.data_final || null, edit_id
        ];

        const result = await dbClient.query(queryText, values);

        if (result.rows.length === 0) {
            throw new Error('Ordem de Produção não encontrada para atualização.');
        }

        const opAtualizada = { ...result.rows[0], finalizedChildren: finalizedChildrenNumbers };
        
        await dbClient.query('COMMIT'); // <<< 2. CONFIRMA TUDO NO FINAL
        res.status(200).json(opAtualizada);

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK'); // <<< 3. DESFAZ TUDO EM CASO DE ERRO
        console.error('[router/ordens-de-producao PUT] Erro:', error);
        // O res.status(403) já é enviado antes, aqui tratamos outros erros.
        if (!res.headersSent) {
            res.status(500).json({ error: 'Erro ao atualizar Ordem de Produção.', details: error.message });
        }
    } finally {
        if (dbClient) {
            dbClient.release();
        }
    }
});

export default router;