// api/arremates.js
import 'dotenv/config';
import pg from 'pg'; // Modificado
const { Pool, types } = pg; // Modificado
import jwt from 'jsonwebtoken';
import express from 'express';
import { getPermissoesCompletasUsuarioDB, atualizarStatusUsuarioDB } from './usuarios.js';
import { registrarAuditoria } from './audit.js';

// --- INÍCIO DA CORREÇÃO DE FUSO HORÁRIO ---
types.setTypeParser(1114, str => str);
// --- FIM DA CORREÇÃO ---

const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
});

const SECRET_KEY = process.env.JWT_SECRET;

const verificarTokenInterna = (reqOriginal) => {
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
        const decoded = jwt.verify(token, SECRET_KEY, { ignoreExpiration: false });
        return decoded;
    } catch (error) {
        const newError = new Error(error.name === 'TokenExpiredError' ? 'Token expirado' : 'Token inválido');
        newError.statusCode = 401;
        if (error.name === 'TokenExpiredError') newError.details = 'jwt expired';
        throw newError;
    }
};

/**
 * Calcula o tempo total em segundos que um usuário esteve em pausa
 * dentro de um intervalo de tempo de uma tarefa.
 * @param {object} horariosUsuario - Objeto com os horários (horario_entrada_1, horario_saida_1, etc.)
 * @param {Date} dataInicioTarefa - A data/hora de início da tarefa.
 * @param {Date} dataFimTarefa - A data/hora de fim da tarefa (ou o momento atual se a tarefa está em andamento).
 * @returns {number} - O total de segundos de pausa no intervalo.
 */
function calcularTempoDePausa(horariosUsuario, dataInicioTarefa, dataFimTarefa) {
    let segundosPausa = 0;
    const { horario_saida_1, horario_entrada_2, horario_saida_2, horario_entrada_3 } = horariosUsuario;

    const pausas = [];
    if (horario_saida_1 && horario_entrada_2) pausas.push({ inicio: horario_saida_1, fim: horario_entrada_2 }); // Pausa do almoço
    if (horario_saida_2 && horario_entrada_3) pausas.push({ inicio: horario_saida_2, fim: horario_entrada_3 }); // Pausa da tarde

    for (const pausa of pausas) {
        // Constrói as datas completas para a pausa no dia da tarefa
        const inicioPausa = new Date(dataInicioTarefa);
        const [h_inicio, m_inicio] = pausa.inicio.split(':');
        inicioPausa.setHours(h_inicio, m_inicio, 0, 0);

        const fimPausa = new Date(dataInicioTarefa);
        const [h_fim, m_fim] = pausa.fim.split(':');
        fimPausa.setHours(h_fim, m_fim, 0, 0);

        // Calcula a sobreposição (interseção) entre o período da tarefa e o período da pausa
        const inicioIntersecao = new Date(Math.max(dataInicioTarefa, inicioPausa));
        const fimIntersecao = new Date(Math.min(dataFimTarefa, fimPausa));

        if (fimIntersecao > inicioIntersecao) {
            segundosPausa += (fimIntersecao - inicioIntersecao) / 1000;
        }
    }
    return Math.round(segundosPausa);
}

// Middleware para este router: Apenas autentica o token.
// A gestão de conexão DB e verificação de permissões detalhadas fica em cada rota.
router.use(async (req, res, next) => {
    try {
        req.usuarioLogado = verificarTokenInterna(req); 
        next(); 
    } catch (error) {
        console.error('[router/arremates MID] Erro no middleware:', error.message, error.stack ? error.stack.substring(0,500) : '');
        const statusCode = error.statusCode || 500;
        const errorMsg = (error.message === 'jwt expired' || error.message === 'Token expirado' || error.message === 'Token inválido') 
                       ? 'Sessão inválida ou expirada. Faça login novamente.' 
                       : error.message;
        res.status(statusCode).json({ error: errorMsg });
    }
});

// POST /api/arremates/
router.post('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient; 

    try {
        dbClient = await pool.connect();
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoesCompletas.includes('lancar-arremate')) {
            return res.status(403).json({ error: 'Permissão negada para lançar arremate.' });
        }

        const { 
            op_numero, op_edit_id, produto_id, variante, quantidade_arrematada, 
            usuario_tiktik, // Nome do Tiktik
            usuario_tiktik_id // <<< NOVO: ID do Tiktik
        } = req.body;
        
        // <<< MUDANÇA: Adicionada validação para usuario_tiktik_id >>>
        if (!op_numero || !produto_id || quantidade_arrematada === undefined || !usuario_tiktik || !usuario_tiktik_id) {
            return res.status(400).json({ error: 'Dados incompletos: op_numero, produto_id, quantidade, tiktik e tiktik_id são obrigatórios.' });
        }
        
        const quantidadeNum = parseInt(quantidade_arrematada);
        if (isNaN(quantidadeNum) || quantidadeNum <= 0) {
            return res.status(400).json({ error: 'Quantidade arrematada deve ser um número positivo.' });
        }

        // --- LÓGICA DE PONTOS ---
        let valorPontoAplicado = 1.00;
        const configPontosQuery = `
            SELECT pontos_padrao FROM configuracoes_pontos_processos
            WHERE produto_id = $1 AND tipo_atividade = 'arremate_tiktik' AND ativo = TRUE LIMIT 1;
        `;
        const configResult = await dbClient.query(configPontosQuery, [produto_id]);

        if (configResult.rows.length > 0 && configResult.rows[0].pontos_padrao !== null) {
            valorPontoAplicado = parseFloat(configResult.rows[0].pontos_padrao);
        }
        const pontosGerados = quantidadeNum * valorPontoAplicado;
        
        const nomeDoLancador = usuarioLogado.nome || 'Sistema';

        const result = await dbClient.query(
    `INSERT INTO arremates (op_numero, op_edit_id, produto_id, variante, quantidade_arrematada, usuario_tiktik, usuario_tiktik_id, lancado_por, valor_ponto_aplicado, pontos_gerados, tipo_lancamento)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
        op_numero, op_edit_id || null, parseInt(produto_id), variante || null,
        quantidadeNum, usuario_tiktik, usuario_tiktik_id, nomeDoLancador,
        valorPontoAplicado, pontosGerados,
        'PRODUCAO'
    ]
    );
        await registrarAuditoria(dbClient, usuarioLogado, 'arremate.lancado', 'arremate', result.rows[0].id, {
            op_numero,
            funcionario_nome: usuario_tiktik,
            quantidade: quantidadeNum,
        });
        res.status(201).json(result.rows[0]);

    } catch (error) {
        console.error('[API Arremates POST] Erro:', error);
        res.status(500).json({ error: 'Erro interno ao salvar arremate.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/arremates/
router.get('/', async (req, res) => {
    const { 
        produto_id, 
        variante,
        fetchAll = 'false',
        page = 1,
        limit = 6,
        tipo_lancamento  
    } = req.query;

    const varianteDecodificada = variante ? variante.replace(/\+/g, ' ') : null;

    let dbClient;
    try {
        dbClient = await pool.connect();
        
        // A base da query agora não tem mais o filtro de saldo,
        // pois fetchAll pode precisar de todos, e a paginação só dos com saldo.
        let whereClauses = []; 
        let queryParams = [];
        let paramIndex = 1;

        if (produto_id) {
            whereClauses.push(`a.produto_id = $${paramIndex++}`);
            queryParams.push(parseInt(produto_id));
        }

        if (varianteDecodificada && varianteDecodificada !== '-') {
            whereClauses.push(`a.variante = $${paramIndex++}`);
            queryParams.push(varianteDecodificada);
        } else if (variante === '-') {
            whereClauses.push(`(a.variante IS NULL OR a.variante = '-' OR a.variante = '')`);
        }

        if (fetchAll === 'true') {
            // ADICIONA A LÓGICA PARA FILTRAR POR TIPO DE LANÇAMENTO
            if (tipo_lancamento) {
                whereClauses.push(`a.tipo_lancamento = $${paramIndex++}`);
                queryParams.push(tipo_lancamento);
            }
            const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
            
            const dataQuery = `
                SELECT a.*, p.nome as produto 
                FROM arremates a 
                JOIN produtos p ON a.produto_id = p.id
                ${whereString}
                ORDER BY a.data_lancamento DESC
            `;
            
            const dataResult = await dbClient.query(dataQuery, queryParams);

            // **RETORNA NO FORMATO ANTIGO E ESPERADO PELO fetchAll**
            return res.status(200).json({ rows: dataResult.rows });

        } else {
            // LÓGICA NOVA PARA A PAGINAÇÃO NA ABA "VOLTAR PARA ARREMATE"
            // Adiciona o filtro de saldo aqui, pois esta chamada só quer itens pendentes
            whereClauses.push("(a.quantidade_arrematada - a.quantidade_ja_embalada) > 0");
            whereClauses.push("a.tipo_lancamento = 'PRODUCAO'");
            
            const whereString = `WHERE ${whereClauses.join(' AND ')}`;

            const countQuery = `SELECT COUNT(a.id) as total_count FROM arremates a ${whereString}`;
            const countResult = await dbClient.query(countQuery, queryParams);
            const totalItems = parseInt(countResult.rows[0].total_count, 10);
            
            const limitNum = parseInt(limit);
            const totalPages = Math.ceil(totalItems / limitNum) || 1;
            const offset = (parseInt(page) - 1) * limitNum;

            const dataQuery = `
                SELECT 
                    a.*, 
                    COALESCE(op.numero, a.op_numero) as op_numero 
                FROM arremates a 
                LEFT JOIN ordens_de_producao op ON a.op_numero = op.numero
                ${whereString}
                ORDER BY a.data_lancamento DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;
            queryParams.push(limitNum, offset);
            
            const dataResult = await dbClient.query(dataQuery, queryParams);
            
            // **RETORNA NO FORMATO NOVO ESPERADO PELA PAGINAÇÃO**
            return res.status(200).json({
                rows: dataResult.rows,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: totalPages,
                    totalItems: totalItems
                }
            });
        }
    } catch (error) {
        console.error('[API Arremates GET / Híbrido] Erro:', error);
        res.status(500).json({ error: 'Erro interno ao buscar arremates.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ROTA: GET /api/arremates/historico
router.get('/historico', async (req, res) => {    
    const { 
        busca,
        tipoEvento = 'todos',
        periodo = '7d',
        page = 1,
        limit = 10
    } = req.query;
    
    let dbClient;
    try {
        dbClient = await pool.connect();
        
        let queryParams = [];
        let whereClauses = [];

        // Filtro de Período
        if (periodo === 'hoje') {
            whereClauses.push(`a.data_lancamento >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')`);
        } else if (periodo === '30d') {
            whereClauses.push(`a.data_lancamento >= NOW() - INTERVAL '30 days'`);
        } else if (periodo === 'mes_atual') {
            whereClauses.push(`date_trunc('month', a.data_lancamento AT TIME ZONE 'America/Sao_Paulo') = date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo')`);
        } else {
            whereClauses.push(`a.data_lancamento >= NOW() - INTERVAL '7 days'`);
        }
        
        // Filtro por Tipo de Evento
        if (tipoEvento !== 'todos') {
            if (tipoEvento === 'ESTORNO') {
                whereClauses.push(`a.tipo_lancamento IN ('ESTORNO', 'PRODUCAO_ANULADA')`);
            } else {
                whereClauses.push(`a.tipo_lancamento = $${queryParams.length + 1}`);
                queryParams.push(tipoEvento);
            }
        } else {
             whereClauses.push(`a.tipo_lancamento IN ('PRODUCAO', 'PERDA', 'ESTORNO', 'PRODUCAO_ANULADA')`);
        }
        
        // Filtro de Busca por Texto
        if (busca) {
            const searchTerm = `%${busca}%`;
            whereClauses.push(`(p.nome ILIKE $${queryParams.length + 1} OR a.usuario_tiktik ILIKE $${queryParams.length + 1} OR a.lancado_por ILIKE $${queryParams.length + 1})`);
            queryParams.push(searchTerm);
        }
        
        const whereString = `WHERE ${whereClauses.join(' AND ')}`;

        // Query de Contagem
        const countQuery = `SELECT COUNT(*) FROM arremates a LEFT JOIN produtos p ON a.produto_id = p.id ${whereString}`;
        const countResult = await dbClient.query(countQuery, queryParams);
        const totalItems = parseInt(countResult.rows[0].count, 10);

        // Query de Dados com Paginação
        const limitNum = parseInt(limit);
        const offset = (parseInt(page) - 1) * limitNum;
        const totalPages = Math.ceil(totalItems / limitNum) || 1;
        
        const finalQueryParams = [...queryParams, limitNum, offset];
        
        const dataQuery = `
            SELECT a.*, p.nome as produto, p.imagem as produto_imagem
            FROM arremates a
            LEFT JOIN produtos p ON a.produto_id = p.id
            ${whereString}
            ORDER BY a.data_lancamento DESC
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
        
        
        const dataResult = await dbClient.query(dataQuery, finalQueryParams);
        
        res.status(200).json({
            rows: dataResult.rows,
            pagination: { currentPage: parseInt(page), totalPages, totalItems }
        });

    } catch (error) {
        console.error('[API /arremates/historico] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico de arremates.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PUT /api/arremates/:id_arremate/registrar-embalagem
router.put('/:id_arremate/registrar-embalagem', async (req, res) => {
    const { usuarioLogado } = req; // Do token
    const { id_arremate } = req.params;
    const { quantidade_que_foi_embalada_desta_vez } = req.body;
    let dbClient;

    try {

        dbClient = await pool.connect(); // Obtém conexão para esta rota
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);

        if (!permissoesCompletas.includes('lancar-embalagem')) { // Ou uma permissão mais específica se necessário
            return res.status(403).json({ error: 'Permissão negada para registrar embalagem de arremate.' });
        }

        if (quantidade_que_foi_embalada_desta_vez === undefined) {
            return res.status(400).json({ error: 'Campo obrigatório: quantidade_que_foi_embalada_desta_vez.' });
        }
        const qtdEmbaladaNestaVez = parseInt(quantidade_que_foi_embalada_desta_vez);
        if (isNaN(qtdEmbaladaNestaVez) || qtdEmbaladaNestaVez <= 0) {
            return res.status(400).json({ error: 'Quantidade embalada deve ser um número positivo.' });
        }
        const idArremateNum = parseInt(id_arremate);
        if (isNaN(idArremateNum)) {
            return res.status(400).json({ error: 'ID do arremate inválido.' });
        }

        await dbClient.query('BEGIN'); 

        const arremateResult = await dbClient.query(
            'SELECT id, quantidade_arrematada, quantidade_ja_embalada FROM arremates WHERE id = $1 FOR UPDATE',
            [idArremateNum]
        );

        if (arremateResult.rows.length === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: `Arremate com ID ${idArremateNum} não encontrado.` });
        }

        const arremate = arremateResult.rows[0];
        const { quantidade_arrematada, quantidade_ja_embalada } = arremate;

        if (quantidade_ja_embalada + qtdEmbaladaNestaVez > quantidade_arrematada) {
            await dbClient.query('ROLLBACK');
            return res.status(400).json({ 
                error: 'Quantidade a embalar excede o saldo disponível neste arremate.',
                saldoDisponivel: quantidade_arrematada - quantidade_ja_embalada,
                tentativaEmbalar: qtdEmbaladaNestaVez
            });
        }

        const novaQtdJaEmbalada = quantidade_ja_embalada + qtdEmbaladaNestaVez;
        // ***** CORREÇÃO AQUI: Removido data_atualizacao *****
        const updateResult = await dbClient.query(
            'UPDATE arremates SET quantidade_ja_embalada = $1 WHERE id = $2 RETURNING *',
            [novaQtdJaEmbalada, idArremateNum]
        );

        await dbClient.query('COMMIT'); 

        res.status(200).json({
            message: 'Arremate atualizado com sucesso.',
            arremateAtualizado: updateResult.rows[0]
        });

    } catch (error) {
        if (dbClient) { // Só tenta rollback se dbClient foi conectado
            try {
                await dbClient.query('ROLLBACK');

            } catch (rollbackError) {
                console.error('[router/arremates PUT /:id/registrar-embalagem] Erro ao tentar executar ROLLBACK:', rollbackError);
            }
        }
        console.error(`[router/arremates PUT /:id/registrar-embalagem] Erro Arremate ID ${id_arremate}:`, error.message, error.stack ? error.stack.substring(0,500):"");
        // Evita enviar uma nova resposta se uma já foi enviada (ex: pelo rollback de saldo insuficiente)
        if (!res.headersSent) {
            res.status(500).json({ error: 'Erro ao atualizar arremate.', details: error.message });
        }
    } finally {
        if (dbClient) {
            dbClient.release();
        }
    }
});

//ENDPOINT PARA TIKTIK ASSINAR UM LOTE DE ARREMATES
router.put('/assinar-lote', async (req, res) => {
    const { usuarioLogado } = req;
    // NOVO: Recebe o objeto 'dadosColetados'
    const { ids_arremates, dadosColetados } = req.body;
    let dbClient;

    if (!Array.isArray(ids_arremates) || ids_arremates.length === 0) {
        return res.status(400).json({ error: 'Lista de IDs de arremates é obrigatória.' });
    }

    try {
        dbClient = await pool.connect();
        const permissoesUsuario = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);

        // Assumi que você criará esta permissão
        if (!permissoesUsuario.includes('assinar-arremate-tiktik')) {
             return res.status(403).json({ error: 'Permissão negada para assinar arremates.' });
        }

        // Inicia a transação
        await dbClient.query('BEGIN');

        // 1. Atualiza todos os arremates do lote para 'assinada = true'
        const updateResult = await dbClient.query(
            `UPDATE arremates SET assinada = TRUE 
             WHERE id = ANY($1::int[]) 
             AND usuario_tiktik = $2 
             AND assinada = FALSE -- Garante que não estamos re-assinando
             RETURNING id, assinada`,
            [ids_arremates, usuarioLogado.nome] 
        );

        if (updateResult.rowCount === 0) {
            // Se nenhum registro foi atualizado, pode ser que já estivessem assinados ou não pertencem ao usuário.
            // Não é um erro, então não damos rollback, apenas informamos.
            await dbClient.query('COMMIT'); // Finaliza a transação vazia
            return res.status(200).json({ 
                message: 'Nenhum arremate novo foi assinado. Eles podem já ter sido assinados ou os IDs são inválidos.',
                atualizados: []
            });
        }
        
        // 2. Para cada arremate que foi efetivamente atualizado, insere um log
        const idsAtualizados = updateResult.rows.map(r => r.id);
        const logInsertPromises = idsAtualizados.map(arremateId => {
            return dbClient.query(
                `INSERT INTO log_assinaturas (id_usuario, id_arremate, dados_coletados) VALUES ($1, $2, $3)`,
                [usuarioLogado.id, arremateId, dadosColetados || null]
            );
        });

        // Executa todas as inserções de log em paralelo
        await Promise.all(logInsertPromises);

        // Confirma a transação
        await dbClient.query('COMMIT');
        
        res.status(200).json({ 
            message: `${updateResult.rowCount} arremate(s) assinado(s) com sucesso.`,
            atualizados: updateResult.rows 
        });

    } catch (error) {
        // Se der erro, desfaz a transação
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /arremates/assinar-lote PUT] Erro:', error.message);
        res.status(500).json({ error: 'Erro interno ao assinar arremates.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.post('/registrar-perda', async (req, res) => {
    const { usuarioLogado } = req;
    const { produto_id, variante, quantidadePerdida, motivo, observacao, opsOrigem } = req.body;
    let dbClient;

    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoes.includes('registrar-perda-arremate')) {
            return res.status(403).json({ error: 'Permissão negada para registrar perdas.' });
        }
        
        if (!produto_id || !motivo || !quantidadePerdida || quantidadePerdida <= 0 || !Array.isArray(opsOrigem) || opsOrigem.length === 0) {
            // Adicionamos uma validação mais robusta para opsOrigem
            console.error('[API /registrar-perda] ERRO: Dados incompletos. opsOrigem é crucial.');
            return res.status(400).json({ error: "Dados para registro de perda estão incompletos (produto_id, motivo, quantidade, opsOrigem)." });
        }
        
        const produtoInfo = await dbClient.query('SELECT nome FROM produtos WHERE id = $1', [produto_id]);
        if (produtoInfo.rows.length === 0) {
            throw new Error(`Produto com ID ${produto_id} não encontrado.`);
        }
        const nomeDoProduto = produtoInfo.rows[0].nome;
;
        await dbClient.query('BEGIN');

        // 1. Insere o registro na tabela de perdas
        const perdaQuery = `
            INSERT INTO arremate_perdas (produto_nome, variante_nome, quantidade_perdida, motivo, observacao, usuario_responsavel)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id;
        `;
        const perdaResult = await dbClient.query(perdaQuery, [
            nomeDoProduto, variante, quantidadePerdida, motivo,
            observacao, usuarioLogado.nome || 'Sistema'
        ]);
        const perdaId = perdaResult.rows[0].id;

        // 2. Cria um lançamento de arremate do tipo 'PERDA' para abater do saldo
        let quantidadeRestanteParaAbater = quantidadePerdida;
        const opsOrdenadas = opsOrigem.sort((a, b) => a.numero - b.numero);

        for (const op of opsOrdenadas) {
            if (quantidadeRestanteParaAbater <= 0) {
                break;
            }
            
            // O nome da propriedade era 'saldo_op' no frontend, vamos usar esse padrão
            const qtdAbaterDaOP = Math.min(quantidadeRestanteParaAbater, op.saldo_op);

            if (qtdAbaterDaOP > 0) {
                const lancamentoPerdaQuery = `
                    INSERT INTO arremates (op_numero, produto_id, variante, quantidade_arrematada, usuario_tiktik, lancado_por, tipo_lancamento, id_perda_origem, assinada)
                    VALUES ($1, $2, $3, $4, 'Sistema (Perda)', $5, 'PERDA', $6, TRUE);
                `;
                await dbClient.query(lancamentoPerdaQuery, [
                    op.numero, produto_id, variante, qtdAbaterDaOP,
                    usuarioLogado.nome, perdaId
                ]);
                quantidadeRestanteParaAbater -= qtdAbaterDaOP;
            }
        }
        
        await dbClient.query('COMMIT');
        res.status(201).json({ message: 'Registro de perda efetuado com sucesso.' });

    } catch (error) {
        if (dbClient) {
            console.error('[API /registrar-perda] ERRO DETECTADO! Dando ROLLBACK na transação.');
            await dbClient.query('ROLLBACK');
        }
        console.error('[API /arremates/registrar-perda] Stack de erro:', error);
        res.status(500).json({ error: 'Erro ao registrar a perda.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.get('/fila', async (req, res) => {
    const { 
        search, 
        sortBy = 'data_op_mais_recente', 
        page = 1, 
        limit = 6,
        fetchAll = 'false'
    } = req.query;

    let dbClient;
    try {
        dbClient = await pool.connect();

        const mediasQuery = `
            SELECT 
                produto_id,
                AVG((EXTRACT(EPOCH FROM (data_fim - data_inicio)) - tempo_pausado_segundos) / NULLIF(quantidade_finalizada, 0)) as media_tempo_por_peca
            FROM sessoes_trabalho_arremate
            WHERE status = 'FINALIZADA' AND quantidade_finalizada > 0
            GROUP BY produto_id;
        `;
        const mediasResult = await dbClient.query(mediasQuery);
        const mapaDeMedias = new Map(mediasResult.rows.map(row => [row.produto_id, parseFloat(row.media_tempo_por_peca)]));
        
        const opsQuery = `
            SELECT 
                op.produto_id, op.variante, p.nome as produto, 
                p.imagem as imagem_produto, p.grade,
                op.etapas, op.quantidade, op.data_final, op.numero, op.edit_id
            FROM ordens_de_producao op
            JOIN produtos p ON op.produto_id = p.id
            WHERE op.status = 'finalizado';
        `;
        const opsResult = await dbClient.query(opsQuery);
        const opsFinalizadas = opsResult.rows;

        const arrematesQuery = `
            SELECT produto_id, variante, op_numero, SUM(quantidade_arrematada) as total_arrematado
            FROM arremates
            WHERE tipo_lancamento IN ('PRODUCAO', 'PERDA')
            GROUP BY produto_id, variante, op_numero;
        `;
        const arrematesResult = await dbClient.query(arrematesQuery);
        
        const arrematadoPorOp = new Map();
        arrematesResult.rows.forEach(arr => {
            const chave = `${arr.op_numero}|${arr.variante || '-'}`;
            arrematadoPorOp.set(chave, parseInt(arr.total_arrematado, 10));
        });

        // --- NOVA LÓGICA: Buscar tarefas ativas ---
        const sessoesAtivasQuery = `
            SELECT 
                s.produto_id,
                s.variante,
                s.quantidade_entregue,
                u.nome as tiktik_nome
            FROM sessoes_trabalho_arremate s
            JOIN usuarios u ON s.usuario_tiktik_id = u.id
            WHERE s.status = 'EM_ANDAMENTO'
        `;
        const sessoesAtivasResult = await dbClient.query(sessoesAtivasQuery);
        const emTrabalhoAgregado = new Map();
        
        sessoesAtivasResult.rows.forEach(sessao => {
            const chaveAgregada = `${sessao.produto_id}|${sessao.variante || '-'}`;
            if (!emTrabalhoAgregado.has(chaveAgregada)) {
                emTrabalhoAgregado.set(chaveAgregada, { quantidade: 0, tiktiks: [] });
            }
            const item = emTrabalhoAgregado.get(chaveAgregada);
            item.quantidade += sessao.quantidade_entregue;
            item.tiktiks.push(sessao.tiktik_nome);
        });
        
        const obterQuantidadeFinalProduzida = (op) => {
            if (!op || !op.etapas || !Array.isArray(op.etapas) || op.etapas.length === 0) return parseInt(op?.quantidade) || 0;
            for (let i = op.etapas.length - 1; i >= 0; i--) {
                const etapa = op.etapas[i];
                if (etapa && etapa.lancado && typeof etapa.quantidade !== 'undefined' && etapa.quantidade !== null) {
                    const qtdEtapa = parseInt(etapa.quantidade, 10);
                    if (!isNaN(qtdEtapa) && qtdEtapa >= 0) return qtdEtapa;
                }
            }
            return parseInt(op.quantidade) || 0;
        };
        
        const pendenciasAgregadas = new Map();
        opsFinalizadas.forEach(op => {
            const qtdProduzida = obterQuantidadeFinalProduzida(op);
            const chaveOp = `${op.numero}|${op.variante || '-'}`;
            const qtdArrematada = arrematadoPorOp.get(chaveOp) || 0;
            const saldoOpBruto = qtdProduzida - qtdArrematada;

            if (saldoOpBruto > 0) {
                const chaveAgregada = `${op.produto_id}|${op.variante || '-'}`;
                if (!pendenciasAgregadas.has(chaveAgregada)) {
                    // --- NOVA LÓGICA: Incluir dados das tarefas ativas ---
                    const tarefaAtivaInfo = emTrabalhoAgregado.get(chaveAgregada);
                    const qtdEmTrabalho = tarefaAtivaInfo ? tarefaAtivaInfo.quantidade : 0;
                    
                    pendenciasAgregadas.set(chaveAgregada, {
                        produto_id: op.produto_id,
                        produto_nome: op.produto,
                        imagem: op.imagem_produto,
                        grade: op.grade,
                        variante: op.variante || '-',
                        saldo_total_bruto: 0,
                        quantidade_em_trabalho: qtdEmTrabalho, // Quantidade em tarefas ativas
                        tarefa_ativa_por: tarefaAtivaInfo ? tarefaAtivaInfo.tiktiks.join(', ') : null, // Nomes dos tiktiks
                        ops_detalhe: [],
                        data_op_mais_recente: new Date(0),
                        data_op_mais_antiga: new Date('2999-12-31'),
                        media_tempo_por_peca: mapaDeMedias.get(op.produto_id) || null
                    });
                }

                const item = pendenciasAgregadas.get(chaveAgregada);
                item.saldo_total_bruto += saldoOpBruto;
                const dataOp = op.data_final ? new Date(op.data_final) : new Date(0);
                
                item.ops_detalhe.push({
                    numero: op.numero,
                    edit_id: op.edit_id,
                    saldo_op: saldoOpBruto, // Saldo bruto da OP
                    data_final: dataOp.toISOString()
                });
                
                if (dataOp > item.data_op_mais_recente) item.data_op_mais_recente = dataOp;
                if (dataOp < item.data_op_mais_antiga) item.data_op_mais_antiga = dataOp;
            }
        });
        
        let resultadosFinais = Array.from(pendenciasAgregadas.values()).map(item => {
            // O `saldo_para_arrematar` agora é o saldo real disponível para novas tarefas
            const saldo_para_arrematar = item.saldo_total_bruto - item.quantidade_em_trabalho;
            return { ...item, saldo_para_arrematar };
        }).filter(item => item.saldo_total_bruto > 0); // Mostra o item mesmo se o saldo disponível for zero, mas houver peças em trabalho
        
        const totalGruposDeProdutos = resultadosFinais.length;
        const totalPecasPendentes = resultadosFinais.reduce((total, item) => total + item.saldo_para_arrematar, 0);

        if (search) {
            const searchTermLower = search.toLowerCase();
            resultadosFinais = resultadosFinais.filter(item =>
                item.produto_nome.toLowerCase().includes(searchTermLower) ||
                (item.variante && item.variante.toLowerCase().includes(searchTermLower))
            );
        }

        switch (sortBy) {
            case 'maior_quantidade': resultadosFinais.sort((a, b) => b.saldo_para_arrematar - a.saldo_para_arrematar); break;
            case 'menor_quantidade': resultadosFinais.sort((a, b) => a.saldo_para_arrematar - b.saldo_para_arrematar); break;
            case 'alfabetica': resultadosFinais.sort((a, b) => a.produto_nome.localeCompare(b.produto_nome)); break;
            default: resultadosFinais.sort((a, b) => new Date(b.data_op_mais_recente) - new Date(a.data_op_mais_recente)); break;
        }

        if (fetchAll === 'true') {
            // Agora usamos a variável correta
            res.status(200).json({ rows: resultadosFinais });
        } else {
            const limitNum = parseInt(limit);
            const offset = (parseInt(page) - 1) * limitNum;
            // E aqui também
            const totalPages = Math.ceil(resultadosFinais.length / limitNum) || 1;
            const paginatedResults = resultadosFinais.slice(offset, offset + limitNum);

            res.status(200).json({
                rows: paginatedResults,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: totalPages,
                    totalItems: totalGruposDeProdutos,
                    totalPecas: totalPecasPendentes,
                    limit: limitNum
                }
            });
        }
    } catch (error) {
        console.error('[API GET /arremates/fila] Erro na lógica JS do backend:', error.message, error.stack);
        res.status(500).json({ error: 'Erro ao processar a fila de arremates.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

//GET /api/arremates/status-tiktiks
router.get('/status-tiktiks', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        if (!permissoes.includes('acesso-ordens-de-arremates')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        // 1. Resetar status manuais de dias anteriores
        await dbClient.query(`
            UPDATE usuarios 
            SET 
                status_atual = 'LIVRE', 
                status_data_modificacao = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date 
            WHERE status_atual IN ('FALTOU', 'ALOCADO_EXTERNO', 'LIVRE_MANUAL')
                AND status_data_modificacao IS NOT NULL
                AND status_data_modificacao < (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
        `);
        
        const temposResult = await dbClient.query('SELECT produto_id, tempo_segundos_por_peca FROM tempos_padrao_arremate');
        const temposMap = new Map(temposResult.rows.map(row => [row.produto_id, parseFloat(row.tempo_segundos_por_peca)]));


        // 2. Buscar todos os usuários Tiktik com seus dados e sessões atuais
        const query = `
            SELECT
                u.id, u.nome, COALESCE(u.avatar_url, $1) as avatar_url, u.foto_oficial,
                u.nivel, u.tipos, u.dias_trabalho, u.status_atual,
                u.status_data_modificacao, u.horario_entrada_1, u.horario_saida_1,
                u.horario_entrada_2, u.horario_saida_2, u.horario_entrada_3, u.horario_saida_3
            FROM usuarios u
            WHERE
                'tiktik' = ANY(u.tipos)
                AND u.data_demissao IS NULL
                AND (u.is_test IS FALSE OR u.is_test IS NULL)
                AND NOT EXISTS (
                    SELECT 1
                    FROM ferias_empregados fe
                    WHERE fe.id_usuario = u.id AND CURRENT_DATE BETWEEN fe.data_inicio AND fe.data_fim
                )
            ORDER BY u.nome ASC;
        `;
        const result = await dbClient.query(query, [process.env.DEFAULT_AVATAR_URL]);
        const tiktiksBase = result.rows;

        // Agora, buscamos TODAS as sessões ativas de TODOS os tiktiks de uma vez
        const sessoesAtivasResult = await dbClient.query(`
            SELECT
                s.id as id_sessao, s.usuario_tiktik_id, s.produto_id, s.variante,
                s.quantidade_entregue, s.data_inicio, s.dados_ops,
                p.nome as produto_nome,
                COALESCE(g.imagem, p.imagem) as imagem
            FROM sessoes_trabalho_arremate s
            LEFT JOIN produtos p ON s.produto_id = p.id
            LEFT JOIN LATERAL (
                SELECT gr.imagem
                FROM jsonb_to_recordset(
                    CASE WHEN jsonb_typeof(p.grade) = 'array' THEN p.grade ELSE '[]'::jsonb END
                ) AS gr(sku TEXT, variacao TEXT, imagem TEXT)
                WHERE gr.variacao = s.variante
                LIMIT 1
            ) g ON true
            WHERE s.status = 'EM_ANDAMENTO' AND s.usuario_tiktik_id = ANY($1::int[])
        `, [tiktiksBase.map(t => t.id)]);

        // Agrupamos as sessões por usuário para o caso de lotes
        const sessoesPorUsuario = sessoesAtivasResult.rows.reduce((acc, sessao) => {
            if (!acc[sessao.usuario_tiktik_id]) {
                acc[sessao.usuario_tiktik_id] = [];
            }
            acc[sessao.usuario_tiktik_id].push(sessao);
            return acc;
        }, {});

        // Busca ponto_diario e sessoes_hoje em paralelo (bulk — sem N+1)
        const tiktikIds = tiktiksBase.map(t => t.id);
        const [pontoDiarioResult, sessoesHojeResult] = await Promise.all([
            dbClient.query(`
                SELECT funcionario_id, horario_real_s1, horario_real_e2,
                       horario_real_s2, horario_real_e3, horario_real_s3,
                       saida_desfeita, saida_desfeita_por
                FROM ponto_diario
                WHERE data = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
                  AND funcionario_id = ANY($1::int[])
            `, [tiktikIds]),
            dbClient.query(`
                SELECT
                    s.usuario_tiktik_id,
                    json_agg(
                        json_build_object(
                            'inicio',       to_char(s.data_inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
                            'fim',          to_char(s.data_fim    AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
                            'produto_id',   s.produto_id,
                            'produto_nome', p.nome,
                            'variante',     s.variante,
                            'quantidade',   s.quantidade_entregue
                        ) ORDER BY s.data_inicio
                    ) AS sessoes
                FROM sessoes_trabalho_arremate s
                LEFT JOIN produtos p ON s.produto_id = p.id
                WHERE (s.data_inicio AT TIME ZONE 'America/Sao_Paulo')::date
                          = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
                  AND s.status IN ('FINALIZADA', 'EM_ANDAMENTO')
                  AND s.usuario_tiktik_id = ANY($1::int[])
                GROUP BY s.usuario_tiktik_id
            `, [tiktikIds])
        ]);
        const pontoDiarioMap = new Map(pontoDiarioResult.rows.map(p => [p.funcionario_id, p]));
        const sessoesHojeMap = new Map(sessoesHojeResult.rows.map(r => [r.usuario_tiktik_id, r.sessoes || []]));

        const tiktiksComStatus = await Promise.all(tiktiksBase.map(async (tiktik) => {
            const sessoesDoTiktik = sessoesPorUsuario[tiktik.id] || [];
            let tiktikComSessao = { ...tiktik, is_lote: false }; // Garante que is_lote sempre exista

            if (sessoesDoTiktik.length > 0) {
                tiktikComSessao.sessoes = sessoesDoTiktik; // Passa o array completo de sessões para o frontend
                // É LOTE se houver mais de uma sessão ou se a única sessão tiver mais de uma OP.
                const isLoteDefinido = sessoesDoTiktik.length > 1; // Simplificamos a detecção de lote

                if (isLoteDefinido) {
                    tiktikComSessao.is_lote = true;
                    tiktikComSessao.quantidade_entregue = sessoesDoTiktik.reduce((sum, s) => sum + s.quantidade_entregue, 0);
                    tiktikComSessao.data_inicio = sessoesDoTiktik.sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio))[0].data_inicio;
                    tiktikComSessao.dados_ops = sessoesDoTiktik.map(s => s.dados_ops).flat();
                    tiktikComSessao.id_sessao = sessoesDoTiktik.map(s => s.id_sessao);
                } else { // Tarefa individual
                    tiktikComSessao = { ...tiktik, ...sessoesDoTiktik[0], is_lote: false };
                }
            }

            let tempo_decor_real_segundos = null;
            let tpe_tarefa = null;

            if (tiktikComSessao.status_atual === 'PRODUZINDO' && tiktikComSessao.data_inicio) {
                const dataInicio = new Date(tiktikComSessao.data_inicio);
                const agora = new Date();
                tempo_decor_real_segundos = Math.max(0, (agora - dataInicio) / 1000 - calcularTempoDePausa(tiktikComSessao, dataInicio, agora));
                
                // --- AQUI ESTÁ A NOVA LÓGICA DE CÁLCULO DO TPE ---
                if (tiktikComSessao.is_lote) {
                    let tempoTotalEstimadoLote = 0;
                    let pecasTotaisLote = 0;
                    
                    // Itera sobre cada sessão que compõe o lote
                    for (const sessao of sessoesDoTiktik) {
                        const tpeProduto = temposMap.get(sessao.produto_id);
                        if (tpeProduto) { // Apenas calcula se o TPE estiver definido
                            tempoTotalEstimadoLote += tpeProduto * sessao.quantidade_entregue;
                            pecasTotaisLote += sessao.quantidade_entregue;
                        }
                    }

                    // Calcula o TPE médio ponderado, evitando divisão por zero
                    if (pecasTotaisLote > 0 && tempoTotalEstimadoLote > 0) {
                        tpe_tarefa = tempoTotalEstimadoLote / pecasTotaisLote;
                    } else {
                        tpe_tarefa = null; // Se nenhum produto no lote tiver TPE, o TPE do lote é nulo
                    }

                } else { // Lógica para tarefa individual (continua a mesma)
                    tpe_tarefa = temposMap.get(tiktikComSessao.produto_id) || null;
                }
            }
            
            return {
                ...tiktikComSessao,
                tempo_decorrido_real_segundos: tempo_decor_real_segundos,
                tpe_tarefa,
                ponto_hoje:   pontoDiarioMap.get(tiktik.id) || null,
                sessoes_hoje: sessoesHojeMap.get(tiktik.id) || [],
            };
        }));
        
        res.status(200).json(tiktiksComStatus);

    } catch (error) {
        console.error('[API /status-tiktiks] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar status dos Tiktiks.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ROTA: POST /api/arremates/sessoes/iniciar
router.post('/sessoes/iniciar', async (req, res) => {
    let dbClient;
    try {
        const { usuario_tiktik_id, produto_id, variante, quantidade_entregue, dados_ops } = req.body;
        
        const qtdEntregueNum = parseInt(quantidade_entregue);
        if (!usuario_tiktik_id || !produto_id || isNaN(qtdEntregueNum) || qtdEntregueNum <= 0 || !Array.isArray(dados_ops) || dados_ops.length === 0) {
            return res.status(400).json({ error: 'Dados insuficientes. Verifique todos os campos.' });
        }

        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        // --- INÍCIO DA NOVA LÓGICA DE BLOQUEIO DE USUÁRIO ---
        const userStatusResult = await dbClient.query(
            'SELECT id_sessao_trabalho_atual FROM usuarios WHERE id = $1 FOR UPDATE',
            [usuario_tiktik_id]
        );
        if (userStatusResult.rows.length === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: `Tiktik com ID ${usuario_tiktik_id} não encontrado.` });
        }
        if (userStatusResult.rows[0].id_sessao_trabalho_atual !== null) {
            await dbClient.query('ROLLBACK');
            return res.status(409).json({ error: 'Este Tiktik já está ocupado em outra tarefa.' });
        }
        // --- FIM DA NOVA LÓGICA DE BLOQUEIO DE USUÁRIO ---

        // --- TRAVA DE CONCORRÊNCIA (ESSENCIAL) ---
        const varianteAsNumber = variante ? variante.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : 0;
        const lockKey = parseInt(produto_id) + varianteAsNumber;
        const lockResult = await dbClient.query('SELECT pg_try_advisory_xact_lock(12345, $1)', [lockKey]);
        if (!lockResult.rows[0].pg_try_advisory_xact_lock) {
            await dbClient.query('ROLLBACK');
            return res.status(409).json({ error: `Este produto está sendo atribuído por outro supervisor. Por favor, tente novamente em alguns segundos.` });
        }
        
        // --- CÁLCULO DE SALDO REAL E PRECISO (NOVA LÓGICA) ---
        const opNumeros = dados_ops.map(op => op.numero);
        
        // 1. Pega o total produzido das OPs
        const opsResult = await dbClient.query(`SELECT numero, etapas, quantidade FROM ordens_de_producao WHERE numero = ANY($1::varchar[])`, [opNumeros]);
        
        
        // 2. Pega o total já arrematado (finalizado)
        const arrematadoResult = await dbClient.query(`SELECT op_numero, SUM(quantidade_arrematada) as total_arrematado FROM arremates WHERE op_numero = ANY($1::varchar[]) AND tipo_lancamento IN ('PRODUCAO', 'PERDA') GROUP BY op_numero`, [opNumeros]);

        const arrematadoMap = new Map(arrematadoResult.rows.map(r => [r.op_numero, parseInt(r.total_arrematado, 10)]));
        
        // 3. Pega o total que está EM TRABALHO agora
        const sessoesAtivasResult = await dbClient.query(
            `SELECT quantidade_entregue 
             FROM sessoes_trabalho_arremate 
             WHERE status = 'EM_ANDAMENTO' 
             AND produto_id = $1 
             AND (variante = $2 OR (variante IS NULL AND $2 IS NULL))`, 
            [produto_id, variante]
        );

        // Somamos diretamente a quantidade entregue de cada sessão ativa.
        const quantidadeEmTrabalho = sessoesAtivasResult.rows.reduce(
            (total, sessao) => total + (sessao.quantidade_entregue || 0), 
            0
        );

        let saldoBrutoTotal = 0;
        const obterQuantidadeFinalProduzida = (op) => {
            if (!op || !op.etapas || !Array.isArray(op.etapas) || op.etapas.length === 0) return parseInt(op?.quantidade) || 0;
            for (let i = op.etapas.length - 1; i >= 0; i--) {
                const etapa = op.etapas[i];
                if (etapa && etapa.lancado && typeof etapa.quantidade !== 'undefined' && etapa.quantidade !== null) {
                    const qtdEtapa = parseInt(etapa.quantidade, 10);
                    if (!isNaN(qtdEtapa) && qtdEtapa >= 0) return qtdEtapa;
                }
            }
            return parseInt(op.quantidade) || 0;
        };
        
        opsResult.rows.forEach(op => {
            const produzido = obterQuantidadeFinalProduzida(op);
            const jaArrematado = arrematadoMap.get(op.numero) || 0;
            saldoBrutoTotal += (produzido - jaArrematado);
        });

        const saldoRealDisponivel = saldoBrutoTotal - quantidadeEmTrabalho;

        // --- A VALIDAÇÃO FINAL E CRÍTICA ---
        if (qtdEntregueNum > saldoRealDisponivel) {
            await dbClient.query('ROLLBACK');
            return res.status(409).json({
                error: `Conflito de saldo! A quantidade solicitada (${qtdEntregueNum}) é maior que o saldo disponível real (${saldoRealDisponivel}). Atualize a página e tente novamente.`
            });
        }

        // Se passou, continua com a criação da sessão...
        const op_numero_ref = dados_ops[0].numero;
        const op_edit_id_ref = dados_ops[0].edit_id;
        
        const sessaoQuery = `INSERT INTO sessoes_trabalho_arremate (usuario_tiktik_id, produto_id, variante, quantidade_entregue, op_numero, op_edit_id, dados_ops) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`;
        const sessaoParams = [usuario_tiktik_id, produto_id, variante, qtdEntregueNum, op_numero_ref, op_edit_id_ref, JSON.stringify(dados_ops)];
        const sessaoResult = await dbClient.query(sessaoQuery, sessaoParams);
        const novaSessaoId = sessaoResult.rows[0].id;
        
        // --- INÍCIO DA LÓGICA DE ATUALIZAÇÃO DE STATUS ---
        await dbClient.query(
            `UPDATE usuarios SET status_atual = 'PRODUZINDO', id_sessao_trabalho_atual = $1 WHERE id = $2`,
            [novaSessaoId, usuario_tiktik_id]
        );
        // --- FIM DA LÓGICA DE ATUALIZAÇÃO DE STATUS ---

        await dbClient.query('COMMIT');
        res.status(201).json({ message: 'Sessão iniciada com sucesso!', sessaoId: novaSessaoId });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /sessoes/iniciar] Erro:', error);
        res.status(500).json({ error: 'Erro ao iniciar sessão.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// ROTA: POST /api/arremates/sessoes/finalizar
router.post('/sessoes/finalizar', async (req, res) => {
    let dbClient;
    const { detalhes_finalizacao } = req.body;

    if (!Array.isArray(detalhes_finalizacao) || detalhes_finalizacao.length === 0) {
        return res.status(400).json({ error: 'Detalhes de finalização são obrigatórios.' });
    }
    
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const idsParaFinalizar = detalhes_finalizacao.map(d => d.id_sessao);

        const sessoesResult = await dbClient.query(
            `SELECT * FROM sessoes_trabalho_arremate WHERE id = ANY($1::int[]) FOR UPDATE`,
            [idsParaFinalizar]
        );

        if (sessoesResult.rows.length !== idsParaFinalizar.length) {
            throw new Error('Uma ou mais sessões não foram encontradas ou os IDs são inconsistentes.');
        }

        const sessoes = sessoesResult.rows;
        const usuarioTiktikId = sessoes[0].usuario_tiktik_id;

        const userTiktikResult = await dbClient.query(`SELECT * FROM usuarios WHERE id = $1`, [usuarioTiktikId]);
        const lancadorResult = await dbClient.query(`SELECT nome FROM usuarios WHERE id = $1`, [req.usuarioLogado.id]);
        if (userTiktikResult.rows.length === 0 || lancadorResult.rows.length === 0) throw new Error('Usuário Tiktik ou Lançador não encontrado.');
        const nomeTiktik = userTiktikResult.rows[0].nome;
        const nomeLancador = lancadorResult.rows[0].nome;
        
        const dataFim = new Date();

        for (const detalhe of detalhes_finalizacao) {
            const sessaoCorrespondente = sessoes.find(s => s.id === detalhe.id_sessao);
            if (!sessaoCorrespondente || sessaoCorrespondente.status === 'FINALIZADA') continue;

            const qtdFinalizadaNestaSessao = detalhe.quantidade_finalizada;
            
            if (qtdFinalizadaNestaSessao < 0 || qtdFinalizadaNestaSessao > sessaoCorrespondente.quantidade_entregue) {
                throw new Error(`Quantidade finalizada inválida para o produto ${sessaoCorrespondente.produto_nome}.`);
            }

            if (qtdFinalizadaNestaSessao > 0) {
                
                // --- NOVA LÓGICA DE CÁLCULO DE PONTOS ---
                let valorPontoAplicado = 1.00; // Valor padrão
                
                // Busca a configuração de pontos para este produto específico
                const configPontosResult = await dbClient.query(
                    `SELECT pontos_padrao FROM configuracoes_pontos_processos
                     WHERE produto_id = $1 AND tipo_atividade = 'arremate_tiktik' AND ativo = TRUE LIMIT 1`,
                    [sessaoCorrespondente.produto_id]
                );

                if (configPontosResult.rows.length > 0 && configPontosResult.rows[0].pontos_padrao !== null) {
                    valorPontoAplicado = parseFloat(configPontosResult.rows[0].pontos_padrao);
                }
                // ----------------------------------------

                let quantidadeRestanteParaLancar = qtdFinalizadaNestaSessao;
                const opsDeOrigem = (sessaoCorrespondente.dados_ops || []);
                
                for (const op of opsDeOrigem) {
                    if (quantidadeRestanteParaLancar <= 0) break;
                    const qtdParaEstaOP = Math.min(quantidadeRestanteParaLancar, op.saldo_op);
                    
                    if (qtdParaEstaOP > 0) {
                        // Calcula os pontos proporcionais para esta fração da OP
                        const pontosGerados = qtdParaEstaOP * valorPontoAplicado;

                        // CORREÇÃO: ADICIONADO valor_ponto_aplicado E pontos_gerados NO INSERT
                        await dbClient.query(
                            `INSERT INTO arremates (op_numero, op_edit_id, produto_id, variante, quantidade_arrematada, usuario_tiktik_id, usuario_tiktik, lancado_por, tipo_lancamento, id_sessao_origem, valor_ponto_aplicado, pontos_gerados)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PRODUCAO', $9, $10, $11)`,
                            [
                                op.numero, 
                                op.edit_id, 
                                sessaoCorrespondente.produto_id, 
                                sessaoCorrespondente.variante, 
                                qtdParaEstaOP, 
                                usuarioTiktikId, 
                                nomeTiktik, 
                                nomeLancador, 
                                sessaoCorrespondente.id,
                                valorPontoAplicado, // $10
                                pontosGerados       // $11
                            ]
                        );
                        quantidadeRestanteParaLancar -= qtdParaEstaOP;
                    }
                }
            }
            
            const tempoPausaSegundos = calcularTempoDePausa(userTiktikResult.rows[0], new Date(sessaoCorrespondente.data_inicio), dataFim);
            await dbClient.query(
                `UPDATE sessoes_trabalho_arremate SET data_fim = $1, status = 'FINALIZADA', quantidade_finalizada = $2, tempo_pausado_segundos = $3 WHERE id = $4`,
                [dataFim, qtdFinalizadaNestaSessao, tempoPausaSegundos, sessaoCorrespondente.id]
            );
        }

        const outraSessaoAtivaResult = await dbClient.query(
            `SELECT 1 FROM sessoes_trabalho_arremate WHERE usuario_tiktik_id = $1 AND status = 'EM_ANDAMENTO' LIMIT 1`,
            [usuarioTiktikId]
        );

        if (outraSessaoAtivaResult.rowCount === 0) {
            await dbClient.query(
                `UPDATE usuarios SET status_atual = 'LIVRE', id_sessao_trabalho_atual = NULL WHERE id = $1`,
                [usuarioTiktikId]
            );
        }

        // --- LÓGICA DE ALERTA DE META BATIDA (VERSÃO CORRIGIDA) ---
        try {
            const configsAtivasResult = await dbClient.query("SELECT * FROM configuracoes_alertas WHERE ativo = TRUE");
            const configMetaBatida = configsAtivasResult.rows.find(c => c.tipo_alerta === 'META_BATIDA_ARREMATE');

            if (configMetaBatida) {
                for (const sessao of sessoes) {
                    const tpeResult = await dbClient.query("SELECT tempo_segundos_por_peca FROM tempos_padrao_arremate WHERE produto_id = $1", [sessao.produto_id]);
                    const tpe = tpeResult.rows[0]?.tempo_segundos_por_peca;
                    
                    const detalheDaSessao = detalhes_finalizacao.find(d => d.id_sessao === sessao.id);
                    const quantidadeRealFinalizada = detalheDaSessao ? detalheDaSessao.quantidade_finalizada : 0;
                    
                    if (tpe && quantidadeRealFinalizada > 0) {
                        const tempoPausaSegundos = calcularTempoDePausa(userTiktikResult.rows[0], new Date(sessao.data_inicio), dataFim);
                        const tempoDecorridoSegundos = (dataFim - new Date(sessao.data_inicio)) / 1000 - tempoPausaSegundos;
                        const tempoRealPorPeca = tempoDecorridoSegundos / quantidadeRealFinalizada;
                        const eficiencia = (parseFloat(tpe) / tempoRealPorPeca);

                        if (eficiencia >= 1.25) {
                            const mensagem = `🚀 Excelente Performance! ${nomeTiktik} concluiu a tarefa de ${sessao.produto_nome || 'produto'} com ${Math.round(eficiencia * 100)}% de eficiência!`;
                            await dbClient.query(`INSERT INTO eventos_sistema (tipo_evento, mensagem) VALUES ($1, $2)`, ['META_BATIDA_ARREMATE', mensagem]);
                        }
                    }
                }
            } 
        } catch (logError) {
            console.error("ERRO DENTRO DA LÓGICA DE LOG DE META BATIDA:", logError.message);
        }
                
        await dbClient.query('COMMIT');
        res.status(200).json({ message: 'Tarefa(s) finalizada(s) e arremate(s) registrado(s) com sucesso!' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /sessoes/finalizar] Erro:', error);
        res.status(500).json({ error: 'Erro ao finalizar sessão.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ROTA: POST /api/arremates/sessoes/cancelar
router.post('/sessoes/cancelar', async (req, res) => {
    const { usuarioLogado } = req;
    const { id_sessao, ids_sessoes } = req.body;
    let dbClient;

    const idsParaCancelar = Array.isArray(ids_sessoes) ? ids_sessoes : (id_sessao ? [id_sessao] : []);

    if (idsParaCancelar.length === 0) {
        return res.status(400).json({ error: 'O ID da sessão ou uma lista de IDs são obrigatórios.' });
    }

    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoes.includes('cancelar-tarefa-arremate')) {
            return res.status(403).json({ error: 'Permissão negada para cancelar tarefas.' });
        }
        
        await dbClient.query('BEGIN');

        const sessoesResult = await dbClient.query(
            `SELECT id, usuario_tiktik_id, status FROM sessoes_trabalho_arremate WHERE id = ANY($1::int[]) FOR UPDATE`,
            [idsParaCancelar]
        );

        if (sessoesResult.rows.length === 0) {
            await dbClient.query('COMMIT');
            return res.status(404).json({ error: 'Nenhuma sessão de trabalho encontrada.' });
        }

        const usuarioTiktikId = sessoesResult.rows[0].usuario_tiktik_id;
        for (const sessao of sessoesResult.rows) {
            if (sessao.status !== 'EM_ANDAMENTO') {
                await dbClient.query('ROLLBACK');
                return res.status(409).json({ error: `A tarefa já foi '${sessao.status.toLowerCase()}'.` });
            }
        }
        
        const updateResult = await dbClient.query(
            `UPDATE sessoes_trabalho_arremate SET status = 'CANCELADA', data_fim = NOW() WHERE id = ANY($1::int[])`,
            [idsParaCancelar]
        );

        if (updateResult.rowCount === 0) {
            await dbClient.query('ROLLBACK');
            throw new Error('Falha ao atualizar o status da sessão para CANCELADA.');
        }

        const outraSessaoAtivaResult = await dbClient.query(
            `SELECT 1 FROM sessoes_trabalho_arremate WHERE usuario_tiktik_id = $1 AND status = 'EM_ANDAMENTO' LIMIT 1`,
            [usuarioTiktikId]
        );
        
        if (outraSessaoAtivaResult.rowCount === 0) {
            await atualizarStatusUsuarioDB(usuarioTiktikId, 'LIVRE');
        }



        await dbClient.query('COMMIT');
        
        res.status(200).json({ message: 'Tarefa(s) cancelada(s) com sucesso!' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /sessoes/cancelar] Erro:', error);
        res.status(500).json({ error: 'Erro interno ao cancelar a tarefa.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ROTA: POST /api/arremates/sessoes/estornar
router.post('/sessoes/estornar', async (req, res) => {
    const { usuarioLogado } = req;
    const { id_sessao } = req.body;

    if (!id_sessao) {
        return res.status(400).json({ error: 'O ID da sessão é obrigatório para o estorno.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();

        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        // Vamos usar a mesma permissão de estorno geral
        if (!permissoes.includes('estornar-arremate')) {
            return res.status(403).json({ error: 'Permissão negada para estornar lançamentos.' });
        }

        await dbClient.query('BEGIN');

        // 1. Mudar o status da sessão para 'ESTORNADA'
        // Isso a remove dos cálculos de performance imediatamente.
        const updateSessaoResult = await dbClient.query(
            `UPDATE sessoes_trabalho_arremate SET status = 'ESTORNADA' WHERE id = $1 AND status = 'FINALIZADA' RETURNING *`,
            [id_sessao]
        );

        if (updateSessaoResult.rowCount === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Sessão não encontrada ou já não estava com status "FINALIZADA".' });
        }

        // 2. Encontrar todos os lançamentos de arremate gerados por esta sessão
        const arrematesOriginaisResult = await dbClient.query(
            `SELECT * FROM arremates WHERE id_sessao_origem = $1 AND tipo_lancamento = 'PRODUCAO'`,
            [id_sessao]
        );

        const arrematesParaEstornar = arrematesOriginaisResult.rows;

        // 3. Para cada lançamento, aplicar a lógica de estorno que você já criou
        for (const arremateOriginal of arrematesParaEstornar) {
            // 3a. Cria um novo registro de log do tipo 'ESTORNO'
            await dbClient.query(
                `INSERT INTO arremates (op_numero, produto_id, variante, quantidade_arrematada, usuario_tiktik, usuario_tiktik_id, lancado_por, tipo_lancamento, assinada)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'ESTORNO', true)`,
                [
                    arremateOriginal.op_numero,
                    arremateOriginal.produto_id,
                    arremateOriginal.variante,
                    arremateOriginal.quantidade_arrematada,
                    arremateOriginal.usuario_tiktik,
                    arremateOriginal.usuario_tiktik_id,
                    usuarioLogado.nome || 'Sistema'
                ]
            );

            // 3b. APAGA o registro de arremate original
            await dbClient.query(`DELETE FROM arremates WHERE id = $1`, [arremateOriginal.id]);
        }

        await dbClient.query('COMMIT');

        res.status(200).json({ message: `Lançamento estornado com sucesso. ${arrematesParaEstornar.length} registro(s) revertido(s).` });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /sessoes/estornar] Erro:', error);
        res.status(500).json({ error: 'Erro interno ao estornar a sessão.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// POST /api/arremates/estornar - ENDPOINT PARA ESTORNAR UM LANÇAMENTO
router.post('/estornar', async (req, res) => {
    const { usuarioLogado } = req;
    const { id_arremate } = req.body;
    let dbClient;

    if (!id_arremate) {
        return res.status(400).json({ error: "O ID do arremate a ser estornado é obrigatório." });
    }

    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoes.includes('estornar-arremate')) {
            return res.status(403).json({ error: 'Permissão negada para estornar arremates.' });
        }

        await dbClient.query('BEGIN');

        // 1. Busca o registro original.
        const arremateResult = await dbClient.query(`SELECT * FROM arremates WHERE id = $1`, [id_arremate]);
        if (arremateResult.rows.length === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Lançamento de arremate não encontrado.' });
        }
        const arremateOriginal = arremateResult.rows[0];
        
        // Validações ...

        // 2. CRIA UM NOVO REGISTRO DE LOG DO TIPO 'ESTORNO'
        const logEstornoQuery = `
            INSERT INTO arremates 
                (op_numero, op_edit_id, produto_id, variante, quantidade_arrematada, 
                 usuario_tiktik, usuario_tiktik_id, lancado_por, tipo_lancamento, assinada, id_perda_origem)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ESTORNO', true, $9)
        `;

        // <<< A CORREÇÃO ESTÁ AQUI >>>
        await dbClient.query(logEstornoQuery, [
            arremateOriginal.op_numero,
            arremateOriginal.op_edit_id,
            arremateOriginal.produto_id,
            arremateOriginal.variante,
            arremateOriginal.quantidade_arrematada,
            arremateOriginal.usuario_tiktik,
            arremateOriginal.usuario_tiktik_id,
            usuarioLogado.nome || 'Sistema',
            null // CORRIGIDO: id_perda_origem deve ser nulo para um estorno.
        ]);
        
        // 3. APAGA o registro de arremate original.
        const deleteResult = await dbClient.query(`DELETE FROM arremates WHERE id = $1`, [id_arremate]);
        if (deleteResult.rowCount === 0) {
            throw new Error("Falha ao apagar o registro de arremate original.");
        }
        
        await dbClient.query('COMMIT');
        await registrarAuditoria(dbClient, usuarioLogado, 'arremate.estornado', 'arremate', id_arremate, {
            id: id_arremate,
            op_numero: arremateOriginal.op_numero,
        });
        res.status(200).json({ message: 'Arremate estornado com sucesso!' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /arremates/estornar - LÓGICA LOG + DELETE] Erro:', error.message, error.stack);
        res.status(500).json({ error: 'Erro interno ao estornar o arremate.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/arremates/contagem-hoje - ENDPOINT PARA O DASHBOARD
router.get('/contagem-hoje', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        
        // A query soma a 'quantidade_arrematada' de todos os lançamentos
        // do tipo PRODUCAO que foram criados hoje.
        // Usamos a conversão de timezone para 'America/Sao_Paulo' para garantir
        // que o "hoje" seja calculado corretamente, independentemente do servidor.
        const query = `
            SELECT COALESCE(SUM(quantidade_arrematada), 0) as total
            FROM arremates
            WHERE 
                tipo_lancamento = 'PRODUCAO' AND
                data_lancamento >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AND
                data_lancamento < date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day';
        `;
        
        const result = await dbClient.query(query);
        const totalArrematadoHoje = parseInt(result.rows[0].total) || 0;

        res.status(200).json({ total: totalArrematadoHoje });

    } catch (error) {
        console.error('[API /arremates/contagem-hoje] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar contagem de arremates de hoje.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/arremates/historico-produto - PARA A ABA DE HISTÓRICO DA TELA DE DETALHES
router.get('/historico-produto', async (req, res) => {
    const { 
        produto_id, 
        variante,
        page = 1,
        limit = 8 // Um limite baixo, ideal para uma aba de modal
    } = req.query;

    if (!produto_id) {
        return res.status(400).json({ error: "ID do produto é obrigatório." });
    }

    const varianteDecodificada = variante ? variante.replace(/\+/g, ' ') : null;

    let dbClient;
    try {
        dbClient = await pool.connect();
        
        let whereClauses = ['produto_id = $1'];
        const params = [parseInt(produto_id)];
        let paramIndex = 2;

        if (varianteDecodificada && varianteDecodificada !== '-') {
            whereClauses.push(`variante = $${paramIndex++}`);
            params.push(varianteDecodificada);
        } else {
            whereClauses.push("(variante IS NULL OR variante = '' OR variante = '-')");
        }
        
        const whereString = `WHERE ${whereClauses.join(' AND ')}`;

        // Query de Contagem
        const countQuery = `SELECT COUNT(*) FROM arremates ${whereString}`;
        const countResult = await dbClient.query(countQuery, params);
        const totalItems = parseInt(countResult.rows[0].count, 10);

        // Query de Dados com Paginação
        const limitNum = parseInt(limit);
        const offset = (parseInt(page) - 1) * limitNum;
        const totalPages = Math.ceil(totalItems / limitNum) || 1;
        
        const dataQuery = `
            SELECT data_lancamento, tipo_lancamento, quantidade_arrematada, usuario_tiktik, op_numero 
            FROM arremates 
            ${whereString}
            ORDER BY data_lancamento DESC 
            LIMIT $${paramIndex++} OFFSET $${paramIndex++}
        `;
        params.push(limitNum, offset);

        const result = await dbClient.query(dataQuery, params);
        
        // Retorna a resposta no formato paginado
        res.status(200).json({
            rows: result.rows,
            pagination: {
                currentPage: parseInt(page),
                totalPages: totalPages,
                totalItems: totalItems
            }
        });

    } catch (error) {
        console.error("[API /historico-produto] Erro:", error.message);
        res.status(500).json({ error: "Erro ao buscar histórico do produto." });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.get('/desempenho-diario/:usuarioId', async (req, res) => {
    const { usuarioId } = req.params;
    const { data } = req.query; // Permite buscar por uma data específica, ex: '2024-08-23'
    let dbClient;

    try {
        dbClient = await pool.connect();
        
        // Determina a data de referência no fuso horário do Brasil
        // Se uma data for fornecida, usa ela. Senão, usa a data de 'hoje'.
        const dataReferencia = data ? data : (new Date()).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

        // 1. Busca todas as sessões do usuário para a data específica
        const sessoesQuery = `
            SELECT 
                s.*,
                p.nome as produto_nome
            FROM sessoes_trabalho_arremate s
            JOIN produtos p ON s.produto_id = p.id
            WHERE 
                s.usuario_tiktik_id = $1 AND
                s.data_inicio::date = $2::date
            ORDER BY s.data_inicio ASC;
        `;
        const sessoesResult = await dbClient.query(sessoesQuery, [usuarioId, dataReferencia]);
        const sessoesDoDia = sessoesResult.rows;

        // 2. Busca os horários de jornada do usuário
        const usuarioQuery = `
            SELECT nome, horario_entrada_1, horario_saida_1, horario_entrada_2, horario_saida_2, horario_entrada_3, horario_saida_3 
            FROM usuarios WHERE id = $1;
        `;
        const usuarioResult = await dbClient.query(usuarioQuery, [usuarioId]);
        if (usuarioResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }
        const dadosUsuario = usuarioResult.rows[0];

        // 3. Processar os dados para gerar métricas e a timeline (LÓGICA NO BACKEND)
        let totalPecas = 0;
        let tempoTrabalhadoTotalSegundos = 0;
        const timeline = [];

        sessoesDoDia.forEach(sessao => {
            if (sessao.status === 'FINALIZADA' && sessao.data_fim) {
                const qtd = sessao.quantidade_finalizada || 0;
                totalPecas += qtd;

                const duracaoSegundos = (new Date(sessao.data_fim) - new Date(sessao.data_inicio)) / 1000;
                tempoTrabalhadoTotalSegundos += duracaoSegundos;
                
                // Adiciona o bloco de trabalho à timeline
                timeline.push({
                    tipo: 'TRABALHO',
                    inicio: sessao.data_inicio,
                    fim: sessao.data_fim,
                    duracao: duracaoSegundos,
                    detalhes: `${qtd}x ${sessao.produto_nome} (${sessao.variante || 'Padrão'})`
                });
            }
        });
        
        // Calcula a eficiência média do dia
        const eficienciaMediaHoje = totalPecas > 0 ? tempoTrabalhadoTotalSegundos / totalPecas : 0;

        const responsePayload = {
            usuario: {
                id: usuarioId,
                nome: dadosUsuario.nome,
                jornada: {
                    entrada1: dadosUsuario.horario_entrada_1, saida1: dadosUsuario.horario_saida_1,
                    entrada2: dadosUsuario.horario_entrada_2, saida2: dadosUsuario.horario_saida_2,
                    entrada3: dadosUsuario.horario_entrada_3, saida3: dadosUsuario.horario_saida_3,
                }
            },
            metricas: {
                totalPecasArrematadas: totalPecas,
                tempoTotalTrabalhadoSegundos: tempoTrabalhadoTotalSegundos,
                eficienciaMediaPorPecaSegundos: eficienciaMediaHoje
            },
            sessoes: sessoesDoDia, // Envia as sessões brutas também
            // A timeline de pausas e ociosidade será calculada no frontend para maior precisão visual
        };

        res.status(200).json(responsePayload);

    } catch (error) {
        console.error(`[API /desempenho-diario/${usuarioId}] Erro:`, error);
        res.status(500).json({ error: 'Erro ao buscar dados de desempenho.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ROTA: POST /api/arremates/sessoes/iniciar-lote
router.post('/sessoes/iniciar-lote', async (req, res) => {
    const { usuarioLogado } = req;
    const { tiktikId, itens } = req.body;
    let dbClient;

    if (!tiktikId || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Dados insuficientes. ID do Tiktik e lista de itens são obrigatórios.' });
    }
    const obterQuantidadeFinalProduzida = (op) => {
        if (!op || !op.etapas || !Array.isArray(op.etapas) || op.etapas.length === 0) {
            return parseInt(op?.quantidade) || 0;
        }
        for (let i = op.etapas.length - 1; i >= 0; i--) {
            const etapa = op.etapas[i];
            if (etapa && etapa.lancado && typeof etapa.quantidade !== 'undefined' && etapa.quantidade !== null) {
                const qtdEtapa = parseInt(etapa.quantidade, 10);
                if (!isNaN(qtdEtapa) && qtdEtapa >= 0) {
                    return qtdEtapa;
                }
            }
        }
        return parseInt(op.quantidade) || 0;
    };

    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoes.includes('lancar-arremate')) {
            return res.status(403).json({ error: 'Permissão negada para atribuir tarefas.' });
        }

        await dbClient.query('BEGIN');

        for (const item of itens) {
            const { produto_id, variante, saldo_para_arrematar, ops_detalhe, produto_nome } = item;
            
            const opNumeros = ops_detalhe.map(op => op.numero);
            const opsResult = await dbClient.query(`SELECT numero, etapas, quantidade FROM ordens_de_producao WHERE numero = ANY($1::varchar[])`, [opNumeros]);
            const arrematadoResult = await dbClient.query(`SELECT op_numero, SUM(quantidade_arrematada) as total_arrematado FROM arremates WHERE op_numero = ANY($1::varchar[]) AND tipo_lancamento IN ('PRODUCAO', 'PERDA') GROUP BY op_numero`, [opNumeros]);
            const sessoesAtivasResult = await dbClient.query(`SELECT quantidade_entregue FROM sessoes_trabalho_arremate WHERE status = 'EM_ANDAMENTO' AND produto_id = $1 AND (variante = $2 OR (variante IS NULL AND $2 IS NULL))`, [produto_id, variante === '-' ? null : variante]);

            const arrematadoMap = new Map(arrematadoResult.rows.map(r => [r.op_numero, parseInt(r.total_arrematado, 10)]));
            const quantidadeEmTrabalho = sessoesAtivasResult.rows.reduce((total, sessao) => total + (sessao.quantidade_entregue || 0), 0);

            let saldoBrutoTotal = 0;
            opsResult.rows.forEach(op => {
                // AQUI CHAMAMOS A FUNÇÃO COMPLETA
                const produzido = obterQuantidadeFinalProduzida(op);
                const jaArrematado = arrematadoMap.get(op.numero) || 0;
                saldoBrutoTotal += (produzido - jaArrematado);
            });
            const saldoRealDisponivel = saldoBrutoTotal - quantidadeEmTrabalho;

            if (saldo_para_arrematar > saldoRealDisponivel) {
                await dbClient.query('ROLLBACK');
                return res.status(409).json({
                    error: `Conflito de saldo no produto '${produto_nome}'. A quantidade solicitada (${saldo_para_arrematar}) é maior que o saldo disponível real (${saldoRealDisponivel}). A operação em lote foi cancelada. Atualize a página.`
                });
            }

            const sessaoQuery = `INSERT INTO sessoes_trabalho_arremate (usuario_tiktik_id, produto_id, variante, quantidade_entregue, op_numero, op_edit_id, dados_ops) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`;
            await dbClient.query(sessaoQuery, [tiktikId, produto_id, variante === '-' ? null : variante, saldo_para_arrematar, ops_detalhe[0].numero, ops_detalhe[0].edit_id, JSON.stringify(ops_detalhe)]);
        }

        await atualizarStatusUsuarioDB(tiktikId, 'PRODUZINDO'); 
        
        await dbClient.query('COMMIT');
        
        res.status(201).json({ message: 'Lote atribuído com sucesso!', totalItens: itens.length });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /sessoes/iniciar-lote] Erro:', error);
        res.status(500).json({ error: 'Erro ao atribuir lote.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/arremates/tempos-padrao - Busca todos os tempos padrão configurados
router.get('/tempos-padrao', async (req, res) => {
    // let dbClient; aqui para que o finally possa acessá-la
    let dbClient; 
    try {
        // Conecta ao banco no início da rota
        dbClient = await pool.connect(); 
        
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        if (!permissoes.includes('acesso-ordens-de-arremates')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const query = `SELECT produto_id, tempo_segundos_por_peca FROM tempos_padrao_arremate`;
        const result = await dbClient.query(query);
        
        const temposMap = result.rows.reduce((acc, row) => {
            acc[row.produto_id] = parseFloat(row.tempo_segundos_por_peca);
            return acc;
        }, {});

        res.status(200).json(temposMap);

    } catch (error) {
        console.error('[API /tempos-padrao GET] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar tempos padrão.' });
    } finally {
        // Libera a conexão
        if (dbClient) dbClient.release(); 
    }
});

// POST /api/arremates/tempos-padrao - Salva os tempos padrão em lote
router.post('/tempos-padrao', async (req, res) => {
    // Mesma lógica: define a variável fora do try
    let dbClient; 
    const { tempos } = req.body;

    if (!tempos || typeof tempos !== 'object' || Object.keys(tempos).length === 0) {
        return res.status(400).json({ error: 'Dados de tempos inválidos ou ausentes.' });
    }
    
    try {
        // Conecta ao banco
        dbClient = await pool.connect(); 
        
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        if (!permissoes.includes('gerenciar-permissoes')) {
            return res.status(403).json({ error: 'Permissão negada para configurar tempos padrão.' });
        }

        await dbClient.query('BEGIN');

        const query = `
            INSERT INTO tempos_padrao_arremate (produto_id, tempo_segundos_por_peca)
            SELECT * FROM UNNEST($1::int[], $2::numeric[])
            ON CONFLICT (produto_id) 
            DO UPDATE SET 
                tempo_segundos_por_peca = EXCLUDED.tempo_segundos_por_peca,
                atualizado_em = CURRENT_TIMESTAMP;
        `;

        const produtoIds = Object.keys(tempos).map(id => parseInt(id)).filter(id => !isNaN(id));
        const temposValores = produtoIds.map(id => parseFloat(tempos[id])).filter(tempo => !isNaN(tempo) && tempo > 0);

        // Adiciona uma verificação para evitar erro com arrays vazios
        if (produtoIds.length !== temposValores.length || produtoIds.length === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(400).json({ error: 'Dados de tempos inválidos. Verifique se todos os valores são números positivos.' });
        }
        
        await dbClient.query(query, [produtoIds, temposValores]);
        
        await dbClient.query('COMMIT');
        
        res.status(200).json({ message: 'Tempos padrão atualizados com sucesso!' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /tempos-padrao POST] Erro:', error);
        res.status(500).json({ error: 'Erro ao salvar tempos padrão.', details: error.message });
    } finally {
        // Libera a conexão
        if (dbClient) dbClient.release(); 
    }
});

// GET /api/arremates/externos-recentes — últimos lançamentos externos (freelance tiktik) das últimas 24h
router.get('/externos-recentes', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(`
            SELECT
                a.id, a.op_numero, a.variante,
                a.quantidade_arrematada, a.data_lancamento, a.lancado_por,
                p.nome AS produto_nome,
                u.nome AS freelance_nome, u.tipos AS freelance_tipos
            FROM arremates a
            JOIN usuarios u ON u.id = a.usuario_tiktik_id AND u.is_freelance = true
            LEFT JOIN produtos p ON p.id = a.produto_id
            WHERE a.data_lancamento >= NOW() - INTERVAL '24 hours'
              AND a.tipo_lancamento = 'PRODUCAO'
            ORDER BY a.data_lancamento DESC
            LIMIT 20
        `);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[API GET /arremates/externos-recentes] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/arremates/externo — lançamento de arremate realizado por prestador externo (freelance tiktik)
router.post('/externo', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        if (!permissoes.includes('lancar-arremate')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const { itens } = req.body;
        if (!Array.isArray(itens) || itens.length === 0) {
            return res.status(400).json({ error: 'Dados insuficientes.' });
        }

        const freelanceRes = await dbClient.query(
            `SELECT id, nome FROM usuarios WHERE is_freelance = true AND 'tiktik' = ANY(tipos) LIMIT 1`
        );
        if (freelanceRes.rows.length === 0) {
            throw new Error('Nenhum usuário freelance TikTik cadastrado. Verifique o cadastro de usuários.');
        }
        const freelance = freelanceRes.rows[0];

        for (const item of itens) {
            const { op_numero, op_edit_id, produto_id, variante, quantidade_arrematada } = item;
            const qtd = parseInt(quantidade_arrematada);
            if (!op_numero || !produto_id || !qtd || qtd <= 0) continue;

            let valorPontoAplicado = 1.00;
            const configRes = await dbClient.query(`
                SELECT pontos_padrao FROM configuracoes_pontos_processos
                WHERE produto_id = $1 AND tipo_atividade = 'arremate_tiktik' AND ativo = TRUE LIMIT 1
            `, [produto_id]);
            if (configRes.rows.length > 0 && configRes.rows[0].pontos_padrao !== null) {
                valorPontoAplicado = parseFloat(configRes.rows[0].pontos_padrao);
            }
            const pontosGerados = qtd * valorPontoAplicado;

            await dbClient.query(
                `INSERT INTO arremates
                    (op_numero, op_edit_id, produto_id, variante, quantidade_arrematada,
                     usuario_tiktik, usuario_tiktik_id, lancado_por, valor_ponto_aplicado, pontos_gerados, tipo_lancamento)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PRODUCAO')`,
                [
                    op_numero, op_edit_id || null, parseInt(produto_id), variante || null, qtd,
                    freelance.nome, freelance.id, req.usuarioLogado.nome || 'Sistema',
                    valorPontoAplicado, pontosGerados
                ]
            );
        }

        await dbClient.query('COMMIT');
        res.status(201).json({ ok: true });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /arremates/externo] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;