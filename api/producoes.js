// api/producoes.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';
// Importe a função de buscar permissões completas
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';
import { verificarGincanasAposProducao } from './gincanas.js';
import { registrarAuditoria } from './audit.js';



const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    timezone: 'UTC',
});
const SECRET_KEY = process.env.JWT_SECRET;

// ─────────────────────────────────────────────────────────────────────────────
// BUG-15b — Tolerância máxima de atraso para detecção automática de intervalo.
// Se a tarefa for finalizada além de (S1/S2 + TOLERANCIA), o sistema NÃO registra
// mais o almoço/pausa automaticamente — a rede de segurança em
// GET /status-funcionarios assume e grava o horário agendado como fallback.
// Regra operacional de chão de fábrica (reunião com equipe): proibido tirar
// almoço/pausa após 30min do horário agendado.
// ─────────────────────────────────────────────────────────────────────────────
const TOLERANCIA_ATRASO_INTERVALO_MIN = 30;

// Converte 'HH:MM' em minutos desde meia-noite. Retorna null se inválido.
const hhmmParaMin = (hhmm) => {
    if (!hhmm || typeof hhmm !== 'string' || hhmm.length < 5) return null;
    const [h, m] = hhmm.substring(0, 5).split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
};

/**
 * Detecta se a finalização de uma tarefa ocorre durante/após uma janela de intervalo.
 * Se sim, registra os horários reais no ponto_diario e retorna o novo status.
 * Deve ser chamada DENTRO de uma transaction já aberta.
 *
 * @param {object} dbClient - Conexão ativa com o banco (dentro da transaction)
 * @param {number} funcionarioId - ID do funcionário
 * @param {object} horarios - Campos horario_* do usuário
 * @param {string} dataHojeSP - Data de hoje em São Paulo: 'YYYY-MM-DD'
 * @param {string} horaAtualSP - Hora atual em São Paulo: 'HH:MM'
 * @returns {Promise<string>} Novo status: 'ALMOCO', 'PAUSA' ou 'LIVRE'
 */
async function detectarIntervaloAoFinalizar(dbClient, funcionarioId, horarios, dataHojeSP, horaAtualSP) {
    const n = (t) => t ? String(t).substring(0, 5) : null;

    const s1Agendado = n(horarios.horario_saida_1);
    const s2Agendado = n(horarios.horario_saida_2);
    const e3Agendado = n(horarios.horario_entrada_3);

    if (!s1Agendado) return 'LIVRE'; // Sem horário de saída para almoço → não tem intervalos

    // Busca ponto_diario de hoje para verificar se o intervalo já foi registrado
    const pontoRes = await dbClient.query(
        `SELECT horario_real_s1, horario_real_e2, horario_real_s2, horario_real_e3
         FROM ponto_diario
         WHERE funcionario_id = $1 AND data = $2`,
        [funcionarioId, dataHojeSP]
    );
    const pontoHoje = pontoRes.rows[0] || null;

    // Pré-cálculo em minutos para comparações com tolerância
    const horaAtualMin = hhmmParaMin(horaAtualSP);
    const s1Min = hhmmParaMin(s1Agendado);
    const s2Min = hhmmParaMin(s2Agendado);

    // ── CASO 1: Detecção de ALMOÇO ──────────────────────────────────────────
    // BUG-15: limite superior — se já passou do S2, não registrar almoço retroativo.
    // BUG-15b: janela reduzida a [S1, S1+30min]. Além disso → cai para rede de segurança.
    // Funcionária que não almoçou via sistema e finaliza tarefa às 16h (hora da pausa)
    // não deve ganhar um almoço falso; cai direto no CASO 2 (pausa) ou rede de segurança.
    const dentroJanelaAlmoco =
        s1Min !== null && horaAtualMin !== null &&
        horaAtualMin >= s1Min &&
        horaAtualMin <= s1Min + TOLERANCIA_ATRASO_INTERVALO_MIN &&
        (s2Min === null || horaAtualMin < s2Min);

    if (dentroJanelaAlmoco && !pontoHoje?.horario_real_s1) {
        // Duração do almoço: E2 - S1 do cadastro. Default: 60 min.
        const e2Agendado = n(horarios.horario_entrada_2);
        let duracaoAlmocoMin = 60;
        if (s1Agendado && e2Agendado) {
            const [s1h, s1m] = s1Agendado.split(':').map(Number);
            const [e2h, e2m] = e2Agendado.split(':').map(Number);
            const delta = (e2h * 60 + e2m) - (s1h * 60 + s1m);
            if (delta > 0) duracaoAlmocoMin = delta;
        }
        const [h, m] = horaAtualSP.split(':').map(Number);
        const totalMin = h * 60 + m + duracaoAlmocoMin;
        const e2Dinamico = `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;

        await dbClient.query(
            `INSERT INTO ponto_diario (funcionario_id, data, horario_real_s1, horario_real_e2)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (funcionario_id, data) DO UPDATE SET
                 horario_real_s1 = EXCLUDED.horario_real_s1,
                 horario_real_e2 = EXCLUDED.horario_real_e2,
                 updated_at = NOW()`,
            [funcionarioId, dataHojeSP, horaAtualSP, e2Dinamico]
        );

        console.log(`[PONTO] Almoço registrado para func ${funcionarioId}: saiu ${horaAtualSP} → volta ${e2Dinamico}`);
        return 'ALMOCO';
    }

    // ── CASO 2: Detecção de PAUSA (café/lanche) ──────────────────────────────
    // BUG-15b: janela reduzida a [S2, S2+30min]. Além disso → rede de segurança.
    const dentroJanelaPausa =
        s2Min !== null && horaAtualMin !== null &&
        horaAtualMin >= s2Min &&
        horaAtualMin <= s2Min + TOLERANCIA_ATRASO_INTERVALO_MIN;

    if (dentroJanelaPausa && !pontoHoje?.horario_real_s2) {
        // Garante que o almoço já terminou antes de registrar a pausa
        const e2Real = n(pontoHoje?.horario_real_e2) || n(horarios.horario_entrada_2);
        if (!e2Real || horaAtualSP < e2Real) return 'LIVRE'; // Almoço ainda não acabou

        // Duração da pausa = E3 - S2 do cadastro. Default: 15 min.
        let duracaoPausaMin = 15;
        if (e3Agendado && s2Agendado) {
            const [s2h, s2m] = s2Agendado.split(':').map(Number);
            const [e3h, e3m] = e3Agendado.split(':').map(Number);
            const delta = (e3h * 60 + e3m) - (s2h * 60 + s2m);
            if (delta > 0) duracaoPausaMin = delta;
        }

        const [h, m] = horaAtualSP.split(':').map(Number);
        const totalMin = h * 60 + m + duracaoPausaMin;
        const e3Dinamico = `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;

        await dbClient.query(
            `INSERT INTO ponto_diario (funcionario_id, data, horario_real_s2, horario_real_e3)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (funcionario_id, data) DO UPDATE SET
                 horario_real_s2 = EXCLUDED.horario_real_s2,
                 horario_real_e3 = EXCLUDED.horario_real_e3,
                 updated_at = NOW()`,
            [funcionarioId, dataHojeSP, horaAtualSP, e3Dinamico]
        );

        console.log(`[PONTO] Pausa registrada para func ${funcionarioId}: saiu ${horaAtualSP} → volta ${e3Dinamico}`);
        return 'PAUSA';
    }

    return 'LIVRE';
}

/**
 * Calcula os pontos de uma produção com base nos parâmetros fornecidos.
 * @param {object} dbClient - A conexão ativa com o banco de dados.
 * @param {number} produto_id - O ID do produto.
 * @param {string} processo - O nome do processo (ex: "Bainha").
 * @param {number} quantidade - A quantidade produzida.
 * @param {number} funcionario_id - O ID do funcionário que realizou a tarefa.
 * @returns {Promise<object>} Uma promessa que resolve para um objeto { pontosGerados, valorPontoAplicado }.
 */
async function calcularPontosProducao(dbClient, produto_id, processo, quantidade, funcionario_id) {
    // Validação de segurança
    if (!produto_id || !processo || quantidade < 0 || !funcionario_id) {
        console.warn('[calcularPontosProducao] Dados de entrada inválidos. Retornando 0 pontos.');
        return { pontosGerados: 0, valorPontoAplicado: 0 };
    }

    const funcionarioInfoResult = await dbClient.query(
        'SELECT tipos FROM usuarios WHERE id = $1 LIMIT 1',
        [funcionario_id]
    );

    let tipoAtividadeParaConfigPontos;
    if (funcionarioInfoResult.rows.length > 0 && funcionarioInfoResult.rows[0].tipos) {
        const tiposFuncionario = funcionarioInfoResult.rows[0].tipos;
        if (tiposFuncionario.includes('costureira')) {
            tipoAtividadeParaConfigPontos = 'costura_op_costureira';
        } else if (tiposFuncionario.includes('tiktik')) {
            tipoAtividadeParaConfigPontos = 'processo_op_tiktik';
        }
    }

    let valorPontoAplicado = 1.00;
    if (quantidade > 0 && tipoAtividadeParaConfigPontos) {
        const configPontosResult = await dbClient.query(
            `SELECT pontos_padrao FROM configuracoes_pontos_processos
             WHERE produto_id = $1 AND processo_nome = $2 AND tipo_atividade = $3 AND ativo = TRUE LIMIT 1;`,
            [produto_id, processo, tipoAtividadeParaConfigPontos]
        );

        if (configPontosResult.rows.length > 0 && configPontosResult.rows[0].pontos_padrao !== null) {
            valorPontoAplicado = parseFloat(configPontosResult.rows[0].pontos_padrao);
        } 
    } else if (quantidade === 0) {
        valorPontoAplicado = 0;
    }

    const pontosGerados = quantidade * valorPontoAplicado;

    return {
        pontosGerados: parseFloat(pontosGerados.toFixed(2)),
        valorPontoAplicado: parseFloat(valorPontoAplicado.toFixed(2))
    };
}


// Atualiza TPP de cada etapa unificada proporcionalmente ao peso histórico de cada uma
async function atualizarTPPProporcionado(dbClient, produto_id, etapas, duracaoSegPorPeca) {
    if (!duracaoSegPorPeca || duracaoSegPorPeca <= 0) return;
    const processos = etapas.map(e => e.processo);
    const tppResult = await dbClient.query(
        `SELECT processo, tempo_segundos FROM tempos_padrao_producao WHERE produto_id = $1 AND processo = ANY($2::text[])`,
        [produto_id, processos]
    );
    const tppMap = new Map(tppResult.rows.map(r => [r.processo, parseFloat(r.tempo_segundos)]));
    const tppSoma = etapas.reduce((acc, e) => acc + (tppMap.get(e.processo) || duracaoSegPorPeca), 0);
    for (const etapa of etapas) {
        const tppExistente = tppMap.get(etapa.processo) || duracaoSegPorPeca;
        const proporcao = tppSoma > 0 ? tppExistente / tppSoma : 1 / etapas.length;
        const tempoProporcionado = duracaoSegPorPeca * proporcao;
        await dbClient.query(`
            INSERT INTO tempos_padrao_producao (produto_id, processo, tempo_segundos)
            VALUES ($1, $2, $3)
            ON CONFLICT (produto_id, processo) DO UPDATE SET
                tempo_segundos = EXCLUDED.tempo_segundos
        `, [produto_id, etapa.processo, tempoProporcionado]);
    }
}

// Função verificarToken
const verificarToken = (reqOriginal) => {
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
        console.error('[router/producoes MID] Erro no middleware:', error.message);
        const statusCode = error.statusCode || 500;
        const responseError = { error: error.message };
        if (error.details) responseError.details = error.details;
        res.status(statusCode).json(responseError);
    }
});

router.post('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient; 
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        let { funcionario_id, opNumero, produto_id, variante, processo, quantidade, funcionario } = req.body;

        // Validação básica
        if (!funcionario_id || !opNumero || !produto_id || !processo || !quantidade) {
            throw new Error("Dados insuficientes para iniciar sessão.");
        }

        // Verifica se usuário já está ocupado
        const userStatusResult = await dbClient.query('SELECT id_sessao_trabalho_atual FROM usuarios WHERE id = $1 FOR UPDATE', [funcionario_id]);
        if (userStatusResult.rows[0]?.id_sessao_trabalho_atual !== null) {
            throw new Error('Empregado já ocupado.');
        }

        // Busca nome se não vier
        if (!funcionario) {
             const u = await dbClient.query('SELECT nome FROM usuarios WHERE id = $1', [funcionario_id]);
             funcionario = u.rows[0]?.nome || 'Desconhecido';
        }

        // CRIA A SESSÃO (Vinculada à OP principal, mas com qtd total)
        // O "Abatimento Global" na rota /fila-de-tarefas cuidará de descontar o saldo corretamente
        const sessaoQuery = `
            INSERT INTO sessoes_trabalho_producao 
                (funcionario_id, op_numero, produto_id, variante, processo, quantidade_atribuida, status, data_inicio)
            VALUES ($1, $2, $3, $4, $5, $6, 'EM_ANDAMENTO', NOW())
            RETURNING id;
        `;
        const sessaoResult = await dbClient.query(sessaoQuery, [
            funcionario_id, opNumero, produto_id, variante || null, processo, quantidade
        ]);
        const novaSessaoId = sessaoResult.rows[0].id;

        // Atualiza status do usuário
        await dbClient.query(
            `UPDATE usuarios SET status_atual = 'PRODUZINDO', id_sessao_trabalho_atual = $1 WHERE id = $2`,
            [novaSessaoId, funcionario_id]
        );

        await dbClient.query('COMMIT');
        await registrarAuditoria(dbClient, usuarioLogado, 'producao.lancada', 'producao', novaSessaoId, {
            op_numero: opNumero,
            funcionario_nome: funcionario,
            etapa_processo: processo,
            quantidade,
        });
        res.status(201).json({ message: 'Sessão iniciada!', sessaoId: novaSessaoId });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /producoes] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/producoes/lote (Atribuição Múltipla)
router.post('/lote', async (req, res) => {
    const { usuarioLogado } = req;
    const { itens, funcionario_id, funcionario_nome } = req.body; // 'itens' é o array de tarefas
    let dbClient;

    try {
        if (!itens || !Array.isArray(itens) || itens.length === 0) {
            throw new Error("Nenhum item enviado para o lote.");
        }
        if (!funcionario_id) throw new Error("Funcionário não identificado.");

        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        // 1. Verifica se usuário já está ocupado (opcional, mas bom manter a regra)
        const userStatusResult = await dbClient.query('SELECT id_sessao_trabalho_atual FROM usuarios WHERE id = $1 FOR UPDATE', [funcionario_id]);
        // Se sua regra de negócio permitir acumular, remova essa verificação. 
        // Assumindo que "Atribuir Lote" substitui ou inicia uma nova rodada.
        
        const idsSessoesCriadas = [];

        // 2. Loop para criar cada sessão
        for (const item of itens) {
            const { opNumero, produto_id, variante, processo, quantidade, etapas_unificadas } = item;

            const sessaoQuery = `
                INSERT INTO sessoes_trabalho_producao
                    (funcionario_id, op_numero, produto_id, variante, processo, quantidade_atribuida, status, data_inicio, etapas_unificadas)
                VALUES ($1, $2, $3, $4, $5, $6, 'EM_ANDAMENTO', NOW(), $7)
                RETURNING id;
            `;
            const sessaoResult = await dbClient.query(sessaoQuery, [
                funcionario_id, opNumero, produto_id, variante || null, processo, quantidade,
                etapas_unificadas ? JSON.stringify(etapas_unificadas) : null,
            ]);
            idsSessoesCriadas.push(sessaoResult.rows[0].id);
        }

        // 3. Atualiza status do usuário
        // OBS: Como o banco só guarda UM id_sessao_trabalho_atual, vamos salvar o ID da ÚLTIMA sessão criada
        // apenas para que ele fique "Ocupado". O Painel de Atividades precisará buscar TODAS as sessões ativas.
        const ultimoId = idsSessoesCriadas[idsSessoesCriadas.length - 1];
        
        await dbClient.query(
            `UPDATE usuarios SET status_atual = 'PRODUZINDO', id_sessao_trabalho_atual = $1 WHERE id = $2`,
            [ultimoId, funcionario_id]
        );

        await dbClient.query('COMMIT');
        res.status(201).json({ message: `${idsSessoesCriadas.length} tarefas atribuídas com sucesso!`, ids: idsSessoesCriadas });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /producoes/lote] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// GET /api/producoes/
router.get('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;

    try {
        dbClient = await pool.connect();
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        const podeGerenciarTudo = permissoesCompletas.includes('acesso-gerenciar-producao');
        const podeVerProprias = permissoesCompletas.includes('ver-proprias-producoes');

        if (!podeGerenciarTudo && !podeVerProprias) {
            return res.status(403).json({ error: 'Permissão negada para visualizar produções.' });
        }

        // <<< MUDANÇA: Adicionada a coluna "funcionario_id" na query SELECT >>>
        const baseSelect = `
        SELECT 
            pr.id, 
            pr.op_numero, 
            pr.etapa_index, 
            pr.processo, 
            pr.variacao,
            pr.maquina, 
            pr.quantidade, 
            pr.funcionario, 
            pr.funcionario_id, -- <<< ADICIONADO
            pr.data, 
            pr.lancado_por,
            pr.valor_ponto_aplicado,
            pr.pontos_gerados,
            p.nome AS produto
        FROM producoes pr
        LEFT JOIN produtos p ON pr.produto_id = p.id
    `;

        let queryText;
        let queryParams = [];
        const { op_numero: opNumero } = req.query;

        if (opNumero) {
            queryText = `${baseSelect} WHERE pr.op_numero = $1 ORDER BY pr.data DESC`;
            queryParams = [opNumero];
        } else if (podeGerenciarTudo) {
            queryText = `${baseSelect} ORDER BY pr.data DESC`;
        } else if (podeVerProprias) {
            // <<< MUDANÇA: Filtra pelo ID do usuário logado, não pelo nome >>>
            const idFuncionario = usuarioLogado.id;
            if (!idFuncionario) {
                return res.status(400).json({ error: "Falha ao identificar ID do usuário para filtro." });
            }
            queryText = `${baseSelect} WHERE pr.funcionario_id = $1 ORDER BY pr.data DESC`;
            queryParams = [idFuncionario];
        } else {
            return res.status(403).json({ error: 'Configuração de acesso inválida.' });
        }
        
        const result = await dbClient.query(queryText, queryParams);
        res.status(200).json(result.rows);

    } catch (error) {
        console.error('[API Producoes GET /] Erro na rota:', error);
        res.status(500).json({ error: 'Erro interno ao buscar produções.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PUT /api/producoes/
router.put('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoesDoUsuario = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        
        // <<< MUDANÇA: Adicionamos o 'id' ao nome do funcionário para clareza >>>
        const { id, quantidade, edicoes, assinada, funcionario: novoNomeFuncionario, dadosColetados } = req.body;

        if (!id) {
            return res.status(400).json({ error: 'ID da produção é obrigatório.' });
        }

        // <<< MUDANÇA: Buscamos mais dados do registro original >>>
        const producaoResult = await dbClient.query(
            'SELECT * FROM producoes WHERE id = $1', 
            [id]
        );

        if (producaoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Produção não encontrada para atualização.' });
        }

        const producaoOriginal = producaoResult.rows[0];
        const nomeUsuarioLogado = usuarioLogado.nome || usuarioLogado.nome_usuario;
        
        const isOwner = producaoOriginal.funcionario === nomeUsuarioLogado;
        const isAttemptingToSignOnly = (assinada === true && quantidade === undefined && novoNomeFuncionario === undefined);
        const podeEditarGeral = permissoesDoUsuario.includes('editar-registro-producao');
        const podeAssinarPropria = permissoesDoUsuario.includes('assinar-producao-costureira');

        // CASO 1: Assinatura de Costureira
        if (isOwner && isAttemptingToSignOnly && podeAssinarPropria) {
            if (producaoOriginal.assinada) {
                return res.status(400).json({ error: 'Este item já foi assinado.' });
            }
            await dbClient.query('BEGIN');
            const updateResult = await dbClient.query(`UPDATE producoes SET assinada = TRUE WHERE id = $1 RETURNING *`, [id]);
            await dbClient.query(`INSERT INTO log_assinaturas (id_usuario, id_producao, dados_coletados) VALUES ($1, $2, $3)`, [usuarioLogado.id, id, dadosColetados || null]);
            await dbClient.query('COMMIT');
            return res.status(200).json(updateResult.rows[0]);
        } 
        
        // CASO 2: Edição Geral (Admin/Supervisor) - AQUI ESTÁ A CORREÇÃO!
        else if (podeEditarGeral) {
            const updateFields = [];
            const updateValues = [];
            let paramIndex = 1;

            let recalcularPontos = false;
            let idFuncionarioParaCalculo = producaoOriginal.funcionario_id;
            let quantidadeParaCalculo = producaoOriginal.quantidade;

            if (quantidade !== undefined && quantidade !== producaoOriginal.quantidade) {
                updateFields.push(`quantidade = $${paramIndex++}`);
                updateValues.push(quantidade);
                quantidadeParaCalculo = quantidade; // Usa a nova quantidade para o cálculo
                recalcularPontos = true;
            }
            
            // <<< MUDANÇA: Lógica para quando o funcionário é alterado >>>
            if (novoNomeFuncionario !== undefined && novoNomeFuncionario !== producaoOriginal.funcionario) {
                const novoFuncionarioResult = await dbClient.query('SELECT id FROM usuarios WHERE nome = $1', [novoNomeFuncionario]);
                if (novoFuncionarioResult.rows.length === 0) {
                    return res.status(404).json({ error: `Funcionário '${novoNomeFuncionario}' não encontrado.` });
                }
                const novoFuncionarioId = novoFuncionarioResult.rows[0].id;

                updateFields.push(`funcionario = $${paramIndex++}`);
                updateValues.push(novoNomeFuncionario);
                updateFields.push(`funcionario_id = $${paramIndex++}`);
                updateValues.push(novoFuncionarioId);
                
                idFuncionarioParaCalculo = novoFuncionarioId; // Usa o novo funcionário para o cálculo
                recalcularPontos = true;
            }

            if (edicoes !== undefined) {
                updateFields.push(`edicoes = $${paramIndex++}`);
                updateValues.push(edicoes);
            }
            
            // <<< MUDANÇA: Se precisa recalcular, chama a nossa nova função! >>>
            if (recalcularPontos) {
                const { pontosGerados, valorPontoAplicado } = await calcularPontosProducao(
                    dbClient,
                    producaoOriginal.produto_id,
                    producaoOriginal.processo,
                    quantidadeParaCalculo,
                    idFuncionarioParaCalculo
                );

                updateFields.push(`pontos_gerados = $${paramIndex++}`);
                updateValues.push(pontosGerados);
                updateFields.push(`valor_ponto_aplicado = $${paramIndex++}`);
                updateValues.push(valorPontoAplicado);
            }

            // O resto da lógica de assinatura continua igual
            if (assinada !== undefined) {
                updateFields.push(`assinada = $${paramIndex++}`);
                updateValues.push(assinada);
            }

            if (updateFields.length === 0) {
                return res.status(200).json(producaoOriginal); // Nenhuma alteração, retorna o original
            }

            updateValues.push(id);
            const queryUpdate = `UPDATE producoes SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
            const result = await dbClient.query(queryUpdate, updateValues);
            await registrarAuditoria(dbClient, usuarioLogado, 'producao.editada', 'producao', id, {
                id,
                op_numero: producaoOriginal.op_numero,
                funcionario_nome: producaoOriginal.funcionario,
                quantidade_antes: producaoOriginal.quantidade,
                quantidade_depois: result.rows[0].quantidade,
            });
            return res.status(200).json(result.rows[0]);
        }
        
        // CASO 3: Permissão negada
        else {
            return res.status(403).json({ error: 'Permissão negada para alterar este registro de produção.' });
        }

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[router/producoes PUT] Erro:', error.message, error.stack ? error.stack.substring(0,500):"");
        res.status(500).json({ error: 'Erro ao atualizar produção.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// DELETE /api/producoes/
router.delete('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN'); // <<< 1. INICIA A TRANSAÇÃO

        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoesCompletas.includes('excluir-registro-producao')) {
            await dbClient.query('ROLLBACK');
            return res.status(403).json({ error: 'Permissão negada para excluir registro de produção.' });
        }

        const { id } = req.body;
        if (!id) {
            await dbClient.query('ROLLBACK');
            return res.status(400).json({ error: 'ID não fornecido.' });
        }

        const deleteResult = await dbClient.query('DELETE FROM producoes WHERE id = $1 RETURNING *', [id]);
        
        if (deleteResult.rowCount === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Produção não encontrada para exclusão.' });
        }

        const producaoExcluida = deleteResult.rows[0];

        // --- INÍCIO DA NOVA LÓGICA DE LIMPEZA ---
        await dbClient.query(
            `UPDATE usuarios 
             SET status_atual = 'LIVRE', id_sessao_trabalho_atual = NULL 
             WHERE id = $1 AND id_sessao_trabalho_atual = $2`,
            [producaoExcluida.funcionario_id, producaoExcluida.id]
        );
        // --- FIM DA NOVA LÓGICA DE LIMPEZA ---

        await dbClient.query('COMMIT'); // <<< 2. CONFIRMA AS ALTERAÇÕES
        await registrarAuditoria(dbClient, usuarioLogado, 'producao.excluida', 'producao', producaoExcluida.id, {
            id: producaoExcluida.id,
            op_numero: producaoExcluida.op_numero,
            funcionario_nome: producaoExcluida.funcionario,
            quantidade: producaoExcluida.quantidade,
        });
        res.status(200).json(producaoExcluida);

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK'); // <<< 3. DESFAZ EM CASO DE ERRO
        console.error('[router/producoes DELETE] Erro:', error.message);
        res.status(500).json({ error: 'Erro ao excluir produção.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

//ENDPOINT PARA TIKTIK ASSINAR UMA OP (PRODUÇÃO)
router.put('/assinar-tiktik-op', async (req, res) => {
    const { usuarioLogado } = req;
    // NOVO: Recebe o objeto 'dadosColetados'
    const { id_producao_op, dadosColetados } = req.body;
    let dbClient;

    if (!id_producao_op) {
        return res.status(400).json({ error: 'ID da produção da OP é obrigatório.' });
    }

    try {
        dbClient = await pool.connect();
        const permissoesUsuario = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        
        // Assumi que você criará esta permissão como planejado
        if (!permissoesUsuario.includes('assinar-producao-tiktik')) {
             return res.status(403).json({ error: 'Permissão negada para assinar esta produção de OP.' });
        }

        const producaoResult = await dbClient.query(
            'SELECT funcionario, assinada_por_tiktik FROM producoes WHERE id = $1',
            [id_producao_op]
        );

        if (producaoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Produção da OP não encontrada.' });
        }

        const { funcionario, assinada_por_tiktik } = producaoResult.rows[0];
        if (funcionario !== usuarioLogado.nome) {
            return res.status(403).json({ error: 'Você só pode assinar produções de OP feitas por você.' });
        }
        if (assinada_por_tiktik) {
            return res.status(400).json({ error: 'Esta produção de OP já foi assinada por você.' });
        }

        // Inicia a transação
        await dbClient.query('BEGIN');
        
        // 1. Atualiza a produção
        const updateResult = await dbClient.query(
            'UPDATE producoes SET assinada_por_tiktik = TRUE WHERE id = $1 RETURNING *',
            [id_producao_op]
        );
        
        // 2. Insere o log da assinatura
        await dbClient.query(
            'INSERT INTO log_assinaturas (id_usuario, id_producao, dados_coletados) VALUES ($1, $2, $3)',
            [usuarioLogado.id, id_producao_op, dadosColetados || null]
        );

        // Confirma a transação
        await dbClient.query('COMMIT');

        res.status(200).json({ message: 'Produção da OP assinada com sucesso pelo Tiktik.', producao: updateResult.rows[0] });

    } catch (error) {
        // Se der erro, desfaz a transação
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /producoes/assinar-tiktik-op PUT] Erro:', error.message);
        res.status(500).json({ error: 'Erro interno ao assinar produção da OP.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ========= NOVA ROTA PARA FINALIZAR UMA TAREFA DE PRODUÇÃO (OTIMIZADA) =========
router.put('/finalizar', async (req, res) => {
    const { usuarioLogado } = req;
    const { id_sessao, quantidade_finalizada, pausa_manual_ms = 0 } = req.body;
    let dbClient;

    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');
        
        // 1. Busca a sessão e trava
        const sessaoResult = await dbClient.query('SELECT * FROM sessoes_trabalho_producao WHERE id = $1 FOR UPDATE', [id_sessao]);
        if (sessaoResult.rows.length === 0) throw new Error('Sessão não encontrada.');
        const sessao = sessaoResult.rows[0];
        if (sessao.status !== 'EM_ANDAMENTO') throw new Error('Tarefa já finalizada.');

        // 2. Busca dados do funcionário (UMA VEZ SÓ)
        const funcRes = await dbClient.query('SELECT nome, tipos FROM usuarios WHERE id = $1', [sessao.funcionario_id]);
        const dadosFuncionario = funcRes.rows[0] || { nome: 'Desconhecido', tipos: [] };
        const nomeFuncionario = dadosFuncionario.nome;

        // 3. Define Configuração de Pontos (Inferência de Tipo)
        let tipoAtividadeParaConfig = null;
        if (dadosFuncionario.tipos.includes('costureira')) tipoAtividadeParaConfig = 'costura_op_costureira';
        else if (dadosFuncionario.tipos.includes('tiktik')) tipoAtividadeParaConfig = 'processo_op_tiktik';

        // 4. Busca Máquina Correta
        const produtoResult = await dbClient.query('SELECT etapas FROM produtos WHERE id = $1', [sessao.produto_id]);
        const etapasDoProduto = produtoResult.rows[0]?.etapas || [];
        const etapaConfigProduto = etapasDoProduto.find(e => (e.processo || e) === sessao.processo);
        const maquinaCorreta = (etapaConfigProduto && typeof etapaConfigProduto === 'object') ? (etapaConfigProduto.maquina || 'Não Definida') : 'Não Definida';

        // ─── SESSÃO UNIFICADA — insere producoes por etapa + TPP proporcional ────────────
        const etapasUnificadas = Array.isArray(sessao.etapas_unificadas) && sessao.etapas_unificadas.length >= 2
            ? sessao.etapas_unificadas : null;

        if (etapasUnificadas) {
            const duracaoTotalMs = Date.now() - new Date(sessao.data_inicio).getTime();
            const pausaMs = Math.max(0, parseInt(pausa_manual_ms) || 0);
            const duracaoSegPorPeca = parseInt(quantidade_finalizada) > 0
                ? Math.max(0, duracaoTotalMs - pausaMs) / 1000 / parseInt(quantidade_finalizada)
                : 0;

            for (const etapaUnif of etapasUnificadas) {
                const idxUnif = etapasDoProduto.findIndex(e => (e.processo || e) === etapaUnif.processo);
                const { pontosGerados, valorPontoAplicado } = await calcularPontosProducao(
                    dbClient, sessao.produto_id, etapaUnif.processo, parseInt(quantidade_finalizada), sessao.funcionario_id
                );
                await dbClient.query(
                    `INSERT INTO producoes (id, op_numero, etapa_index, processo, produto_id, variacao, maquina, quantidade, funcionario, funcionario_id, data, lancado_por, valor_ponto_aplicado, pontos_gerados)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13)`,
                    [
                        `prod_unif_${Date.now()}_${Math.random().toString(36).substr(2,4)}`,
                        sessao.op_numero, idxUnif, etapaUnif.processo, sessao.produto_id,
                        sessao.variante, etapaUnif.maquina || 'Não Definida',
                        parseInt(quantidade_finalizada), nomeFuncionario, sessao.funcionario_id,
                        usuarioLogado.nome, valorPontoAplicado, pontosGerados,
                    ]
                );
            }
            await atualizarTPPProporcionado(dbClient, sessao.produto_id, etapasUnificadas, duracaoSegPorPeca);
        } else {
        // ─── SESSÃO NORMAL — distribuição por múltiplas OPs ──────────────────────────────

        let quantidadeRestante = parseInt(quantidade_finalizada);

        // 5. Busca OPs candidatas
        const opsDisponiveisResult = await dbClient.query(`
            SELECT numero, etapas, quantidade 
            FROM ordens_de_producao 
            WHERE produto_id = $1 
              AND (variante = $2 OR ($2 IS NULL AND variante IS NULL))
              AND status IN ('em-aberto', 'produzindo')
            ORDER BY numero ASC
        `, [sessao.produto_id, sessao.variante]);
        
        const opsCandidatas = opsDisponiveisResult.rows;

        // SE NÃO TIVER OP DISPONÍVEL, TEMOS QUE LANÇAR SEM OP OU NA OP ORIGINAL MESMO QUE FECHADA
        // Para evitar erro 500, vamos buscar a OP original se ela não veio na lista de abertas
        let opOriginalFallback = null;
        if (opsCandidatas.length === 0) {
             const opOrigRes = await dbClient.query('SELECT numero, etapas FROM ordens_de_producao WHERE numero = $1', [sessao.op_numero]);
             if (opOrigRes.rows.length > 0) opOriginalFallback = opOrigRes.rows[0];
        }

        // 6. Mapeia saldos
        const numerosOps = opsCandidatas.map(op => op.numero);
        let mapaSaldo = new Map();
        
        if (numerosOps.length > 0) {
            const lancamentosAnt = await dbClient.query(`
                SELECT op_numero, etapa_index, SUM(quantidade) as total
                FROM producoes WHERE op_numero = ANY($1::text[]) GROUP BY op_numero, etapa_index
            `, [numerosOps]);
            lancamentosAnt.rows.forEach(r => mapaSaldo.set(`${r.op_numero}-${r.etapa_index}`, parseInt(r.total)));
        }

        const logAuditoria = []; 

        // 7. Distribuição (Só roda se tiver OPs ativas)
        for (const op of opsCandidatas) {
            if (quantidadeRestante <= 0) break;

            const etapaIndex = op.etapas.findIndex(e => (e.processo || e) === sessao.processo);
            if (etapaIndex === -1) continue;

            let entrada = (etapaIndex === 0) ? parseInt(op.quantidade) : (mapaSaldo.get(`${op.numero}-${etapaIndex - 1}`) || 0);
            let saida = mapaSaldo.get(`${op.numero}-${etapaIndex}`) || 0;
            
            const disponivel = Math.max(0, entrada - saida);

            if (disponivel > 0) {
                const qtdLancar = Math.min(quantidadeRestante, disponivel);
                const { pontosGerados, valorPontoAplicado } = await calcularPontosProducao(dbClient, sessao.produto_id, sessao.processo, qtdLancar, sessao.funcionario_id);

                await dbClient.query(
                    `INSERT INTO producoes (id, op_numero, etapa_index, processo, produto_id, variacao, maquina, quantidade, funcionario, funcionario_id, data, lancado_por, valor_ponto_aplicado, pontos_gerados)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13)`,
                    [`prod_${Date.now()}_${Math.random().toString(36).substr(2,4)}`, op.numero, etapaIndex, sessao.processo, sessao.produto_id, sessao.variante, maquinaCorreta, qtdLancar, nomeFuncionario, sessao.funcionario_id, usuarioLogado.nome, valorPontoAplicado, pontosGerados]
                );
                logAuditoria.push(`OP #${op.numero}: ${qtdLancar}`);
                quantidadeRestante -= qtdLancar;
                mapaSaldo.set(`${op.numero}-${etapaIndex}`, saida + qtdLancar);
            }
        }

        // 8. Sobra (Estouro)
        if (quantidadeRestante > 0) {
             // Tenta achar a OP original nas candidatas, ou usa o fallback (mesmo que fechada)
             const opAlvo = opsCandidatas.find(o => o.numero === sessao.op_numero) || opsCandidatas[0] || opOriginalFallback;
             
             if (opAlvo) { // <--- VERIFICAÇÃO DE SEGURANÇA
                const idx = opAlvo.etapas.findIndex(e => (e.processo || e) === sessao.processo);

                const { pontosGerados, valorPontoAplicado } = await calcularPontosProducao(
                    dbClient, sessao.produto_id, sessao.processo, quantidadeRestante, sessao.funcionario_id
                );

                await dbClient.query(
                    `INSERT INTO producoes (id, op_numero, etapa_index, processo, produto_id, variacao, maquina, quantidade, funcionario, funcionario_id, data, lancado_por, valor_ponto_aplicado, pontos_gerados)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13)`,
                    [`prod_force_${Date.now()}`, opAlvo.numero, idx, sessao.processo, sessao.produto_id, sessao.variante, maquinaCorreta, quantidadeRestante, nomeFuncionario, sessao.funcionario_id, usuarioLogado.nome, valorPontoAplicado, pontosGerados]
                );
                
                logAuditoria.push(`FORÇADO OP #${opAlvo.numero}: ${quantidadeRestante}`);
             } else {
                 // Caso extremo: Não achou NENHUMA OP (nem a original existe mais?).
                 // Lança sem OP ou dá erro? Vamos lançar com OP '0000' para não perder a produção.
                 console.warn("Nenhuma OP encontrada para lançar a sobra. Usando OP de contingência.");
                 const { pontosGerados, valorPontoAplicado } = await calcularPontosProducao(dbClient, sessao.produto_id, sessao.processo, quantidadeRestante, sessao.funcionario_id);
                 
                 await dbClient.query(
                    `INSERT INTO producoes (id, op_numero, etapa_index, processo, produto_id, variacao, maquina, quantidade, funcionario, funcionario_id, data, lancado_por, valor_ponto_aplicado, pontos_gerados)
                     VALUES ($1, '0000', -1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11)`,
                    [`prod_orphan_${Date.now()}`, sessao.processo, sessao.produto_id, sessao.variante, maquinaCorreta, quantidadeRestante, nomeFuncionario, sessao.funcionario_id, usuarioLogado.nome, valorPontoAplicado, pontosGerados]
                );
             }
        }
        } // fim sessão normal

        // 9. Finaliza sessão — detecta intervalo e define o novo status
        const agoraSP = new Date();
        const horaAtualSP = agoraSP.toLocaleTimeString('en-GB', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
        });
        const dataHojeSP = agoraSP.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

        const horariosRes = await dbClient.query(
            `SELECT horario_saida_1, horario_entrada_2, horario_saida_2,
                    horario_entrada_3, horario_saida_3, status_atual
             FROM usuarios WHERE id = $1`,
            [sessao.funcionario_id]
        );
        const horariosFuncionario = horariosRes.rows[0] || {};

        // BUG-14: se o supervisor fez LIVRE_MANUAL (liberou manualmente durante intervalo),
        // preservar esse override. Não detectar intervalo automático — evita loop
        // "supervisor libera → finaliza tarefa → sistema volta ALMOCO".
        let novoStatusFinal;
        if (horariosFuncionario.status_atual === 'LIVRE_MANUAL') {
            novoStatusFinal = 'LIVRE_MANUAL'; // respeitar o override do supervisor
        } else {
            novoStatusFinal = await detectarIntervaloAoFinalizar(
                dbClient,
                sessao.funcionario_id,
                horariosFuncionario,
                dataHojeSP,
                horaAtualSP
            );
        }

        await dbClient.query(
            `UPDATE sessoes_trabalho_producao
             SET status = 'FINALIZADA', data_fim = NOW(), quantidade_finalizada = $1,
                 pausa_manual_ms = $3
             WHERE id = $2`,
            [quantidade_finalizada, id_sessao, Math.max(0, parseInt(pausa_manual_ms) || 0)]
        );

        // Reinicia o cronômetro da próxima tarefa na fila (se houver)
        await dbClient.query(`
            UPDATE sessoes_trabalho_producao
            SET data_inicio = NOW()
            WHERE id = (
                SELECT id FROM sessoes_trabalho_producao
                WHERE funcionario_id = $1 AND status = 'EM_ANDAMENTO' AND id != $2
                ORDER BY id ASC LIMIT 1
            )
        `, [sessao.funcionario_id, id_sessao]);

        // Status pode ser LIVRE, ALMOCO ou PAUSA — não hardcodar 'LIVRE'
        await dbClient.query(
            `UPDATE usuarios
             SET status_atual = $1,
                 status_data_modificacao = (NOW() AT TIME ZONE 'America/Sao_Paulo'),
                 id_sessao_trabalho_atual = NULL
             WHERE id = $2`,
            [novoStatusFinal, sessao.funcionario_id]
        );

        await dbClient.query('COMMIT');

        res.status(200).json({ message: 'Tarefa finalizada e distribuída com pontos calculados!' });

        // Hook de gincanas — apenas costureiras (tiktiks: aguardar fase posterior, seção 4.9 plano v4.0)
        if (dadosFuncionario.tipos.includes('costureira')) {
            try {
                await verificarGincanasAposProducao(dbClient, sessao.funcionario_id, new Date());
            } catch (err) {
                console.error('[GINCANA HOOK]', err.message);
            }
        }

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API PUT /finalizar] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/producoes/externos-recentes — últimos lançamentos externos das últimas 24h
router.get('/externos-recentes', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(`
            SELECT
                p.id, p.op_numero, p.variacao, p.processo, p.quantidade,
                p.data, p.lancado_por,
                prod.nome AS produto_nome,
                u.nome AS freelance_nome, u.tipos AS freelance_tipos
            FROM producoes p
            JOIN usuarios u ON u.id = p.funcionario_id AND u.is_freelance = true
            LEFT JOIN produtos prod ON prod.id = p.produto_id
            WHERE p.data >= NOW() - INTERVAL '24 hours'
            ORDER BY p.data DESC
            LIMIT 20
        `);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[API GET /producoes/externos-recentes] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// DELETE /api/producoes/externo/:id — desfaz um lançamento externo (producao + sessao)
router.delete('/externo/:id', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id);
        if (!permissoes.includes('acesso-ordens-de-producao')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        // Verifica que é realmente um lançamento externo (freelance)
        const producaoRes = await dbClient.query(`
            SELECT p.id, p.funcionario_id, p.op_numero, p.produto_id, p.processo
            FROM producoes p
            JOIN usuarios u ON u.id = p.funcionario_id AND u.is_freelance = true
            WHERE p.id = $1
        `, [req.params.id]);

        if (producaoRes.rows.length === 0) {
            return res.status(404).json({ error: 'Lançamento externo não encontrado.' });
        }

        const p = producaoRes.rows[0];

        // Remove a sessão FINALIZADA correspondente (a mais recente que bate com os dados)
        await dbClient.query(`
            DELETE FROM sessoes_trabalho_producao
            WHERE id = (
                SELECT id FROM sessoes_trabalho_producao
                WHERE funcionario_id = $1 AND op_numero = $2 AND produto_id = $3 AND processo = $4 AND status = 'FINALIZADA'
                ORDER BY data_inicio DESC
                LIMIT 1
            )
        `, [p.funcionario_id, p.op_numero, p.produto_id, p.processo]);

        // Remove o registro de producao
        await dbClient.query('DELETE FROM producoes WHERE id = $1', [p.id]);

        await dbClient.query('COMMIT');
        res.status(200).json({ ok: true });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API DELETE /producoes/externo/:id] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/producoes/externo — lançamento de produção realizada por prestador externo (freelance)
router.post('/externo', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const { freelance_tipo, itens } = req.body;
        if (!freelance_tipo || !Array.isArray(itens) || itens.length === 0) {
            return res.status(400).json({ error: 'Dados insuficientes.' });
        }

        const freelanceRes = await dbClient.query(
            `SELECT id, nome FROM usuarios WHERE is_freelance = true AND $1 = ANY(tipos) LIMIT 1`,
            [freelance_tipo]
        );
        if (freelanceRes.rows.length === 0) {
            throw new Error(`Nenhum usuário freelance do tipo "${freelance_tipo}" cadastrado. Verifique o cadastro de usuários.`);
        }
        const freelance = freelanceRes.rows[0];

        for (let i = 0; i < itens.length; i++) {
            const { op_numero, produto_id, variante, processo, quantidade, etapas_unificadas } = itens[i];

            const produtoRes = await dbClient.query('SELECT etapas FROM produtos WHERE id = $1', [produto_id]);
            const etapasDoProduto = produtoRes.rows[0]?.etapas || [];
            const etapaIndex = etapasDoProduto.findIndex(e => (e.processo || e) === processo);
            const etapaConfig = etapasDoProduto[etapaIndex];
            const maquina = (etapaConfig && typeof etapaConfig === 'object') ? (etapaConfig.maquina || 'Não Definida') : 'Não Definida';

            await dbClient.query(`
                INSERT INTO sessoes_trabalho_producao
                    (funcionario_id, op_numero, produto_id, variante, processo, quantidade_atribuida, quantidade_finalizada, status, data_inicio, data_fim)
                VALUES ($1, $2, $3, $4, $5, $6, $6, 'FINALIZADA', NOW(), NOW())
            `, [freelance.id, op_numero, produto_id, variante || null, processo, parseInt(quantidade)]);

            const etapasParaRegistrar = Array.isArray(etapas_unificadas) && etapas_unificadas.length >= 2
                ? etapas_unificadas
                : [{ etapa_index: etapaIndex, processo, maquina }];

            // Distribuição waterfall — mesmo algoritmo do PUT /finalizar.
            // Busca todas as OPs ativas do produto/variante e distribui em FIFO,
            // respeitando o saldo de cada etapa. Corrige o bug onde tudo ia para
            // op_numero[0] sem olhar as demais OPs do grupo.
            const opsDisponiveisResult = await dbClient.query(`
                SELECT numero, etapas, quantidade
                FROM ordens_de_producao
                WHERE produto_id = $1
                  AND (variante = $2 OR ($2 IS NULL AND variante IS NULL))
                  AND status IN ('em-aberto', 'produzindo')
                ORDER BY numero ASC
            `, [produto_id, variante || null]);
            const opsCandidatas = opsDisponiveisResult.rows;

            // Fallback: se não há OPs ativas, usa a OP original (mesmo que fechada)
            let opOriginalFallback = null;
            if (opsCandidatas.length === 0) {
                const opOrigRes = await dbClient.query(
                    'SELECT numero, etapas FROM ordens_de_producao WHERE numero = $1', [op_numero]
                );
                if (opOrigRes.rows.length > 0) opOriginalFallback = opOrigRes.rows[0];
            }

            // Mapa de saldos já lançados (op_numero-etapa_index → total)
            const numerosOps = opsCandidatas.map(op => op.numero);
            const mapaSaldo = new Map();
            if (numerosOps.length > 0) {
                const lancamentosAnt = await dbClient.query(`
                    SELECT op_numero, etapa_index, SUM(quantidade) as total
                    FROM producoes WHERE op_numero = ANY($1::text[])
                    GROUP BY op_numero, etapa_index
                `, [numerosOps]);
                lancamentosAnt.rows.forEach(r =>
                    mapaSaldo.set(`${r.op_numero}-${r.etapa_index}`, parseInt(r.total))
                );
            }

            for (const etapaUnif of etapasParaRegistrar) {
                const idxUnif = typeof etapaUnif.etapa_index === 'number' ? etapaUnif.etapa_index : etapaIndex;
                const maquinaUnif = etapaUnif.maquina || maquina;
                const processoUnif = etapaUnif.processo || processo;

                let quantidadeRestante = parseInt(quantidade);

                // Loop de distribuição por OP (FIFO)
                for (const op of opsCandidatas) {
                    if (quantidadeRestante <= 0) break;

                    const etapaIdxNaOp = op.etapas.findIndex(e => (e.processo || e) === processoUnif);
                    if (etapaIdxNaOp === -1) continue;

                    const entrada = etapaIdxNaOp === 0
                        ? parseInt(op.quantidade)
                        : (mapaSaldo.get(`${op.numero}-${etapaIdxNaOp - 1}`) || 0);
                    const saida = mapaSaldo.get(`${op.numero}-${etapaIdxNaOp}`) || 0;
                    const disponivel = Math.max(0, entrada - saida);

                    if (disponivel > 0) {
                        const qtdLancar = Math.min(quantidadeRestante, disponivel);
                        const { pontosGerados, valorPontoAplicado } = await calcularPontosProducao(
                            dbClient, produto_id, processoUnif, qtdLancar, freelance.id
                        );
                        await dbClient.query(
                            `INSERT INTO producoes (id, op_numero, etapa_index, processo, produto_id, variacao, maquina, quantidade, funcionario, funcionario_id, data, lancado_por, valor_ponto_aplicado, pontos_gerados)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13)`,
                            [
                                `prod_ext_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 4)}`,
                                op.numero, etapaIdxNaOp, processoUnif, produto_id, variante || null, maquinaUnif,
                                qtdLancar, freelance.nome, freelance.id,
                                req.usuarioLogado.nome, valorPontoAplicado, pontosGerados,
                            ]
                        );
                        quantidadeRestante -= qtdLancar;
                        mapaSaldo.set(`${op.numero}-${etapaIdxNaOp}`, saida + qtdLancar);
                    }
                }

                // Estouro: peças além do saldo disponível vão para a OP de referência
                if (quantidadeRestante > 0) {
                    const opAlvo = opsCandidatas.find(o => o.numero === op_numero) || opsCandidatas[0] || opOriginalFallback;
                    if (opAlvo) {
                        const idx = opAlvo.etapas.findIndex(e => (e.processo || e) === processoUnif);
                        const { pontosGerados, valorPontoAplicado } = await calcularPontosProducao(
                            dbClient, produto_id, processoUnif, quantidadeRestante, freelance.id
                        );
                        await dbClient.query(
                            `INSERT INTO producoes (id, op_numero, etapa_index, processo, produto_id, variacao, maquina, quantidade, funcionario, funcionario_id, data, lancado_por, valor_ponto_aplicado, pontos_gerados)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13)`,
                            [
                                `prod_ext_force_${Date.now()}_${i}`,
                                opAlvo.numero, idx, processoUnif, produto_id, variante || null, maquinaUnif,
                                quantidadeRestante, freelance.nome, freelance.id,
                                req.usuarioLogado.nome, valorPontoAplicado, pontosGerados,
                            ]
                        );
                    }
                }
            }
        }

        await dbClient.query('COMMIT');
        for (const item of itens) {
            await registrarAuditoria(dbClient, req.usuarioLogado, 'tarefa_freelance.atribuida', 'tarefa', item.op_numero, {
                op_numero: item.op_numero,
                funcionario_nome: freelance.nome,
                tipo: freelance_tipo,
                etapa: item.processo,
                quantidade: item.quantidade,
            });
        }
        res.status(201).json({ ok: true });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /producoes/externo] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
