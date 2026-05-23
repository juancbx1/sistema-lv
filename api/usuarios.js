// api/usuarios.js
import 'dotenv/config';
import pg from 'pg'; // Modificado
const { Pool, types } = pg; // Modificado
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import express from 'express';
import multer from 'multer';
import { put } from '@vercel/blob';
import { permissoesDisponiveis as frontendPermissoesDisponiveis, permissoesPorTipo as frontendPermissoesPorTipo } from '../public/js/utils/permissoes.js';
import { registrarAuditoria } from './audit.js';

types.setTypeParser(1114, str => str);
// --- FIM DA CORREÇÃO ---

const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
});

const uploadMulter = multer({ storage: multer.memoryStorage() });


const SECRET_KEY = process.env.JWT_SECRET;

const STATUS = {
    PRODUZINDO: 'PRODUZINDO',
    LIVRE: 'LIVRE',
    ALMOCO: 'ALMOCO',
    PAUSA: 'PAUSA',
    FORA_DO_HORARIO: 'FORA_DO_HORARIO',
    FALTOU: 'FALTOU',
    PAUSA_MANUAL: 'PAUSA_MANUAL',
    ALOCADO_EXTERNO: 'ALOCADO_EXTERNO'
};

export function determinarStatusFinalServidor(usuario, pontoDiario = null) {
    // 1. PRODUZINDO ganha de tudo
    if (usuario.status_atual === STATUS.PRODUZINDO) return STATUS.PRODUZINDO;

    // 2. Status manuais fortes — valem SOMENTE no dia em que foram definidos
    // Se foram definidos em outro dia, ignorar e recalcular pelo automático abaixo
    if ([STATUS.FALTOU, STATUS.ALOCADO_EXTERNO, 'LIVRE_MANUAL'].includes(usuario.status_atual)) {
        const hojeSP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        // Suporta tanto string ('2026-04-12 14:30:00') quanto objeto Date (coluna timestamptz)
        const rawTs = usuario.status_data_modificacao;
        const dataModificacao = rawTs
            ? (typeof rawTs === 'string'
                ? rawTs.substring(0, 10)
                : new Date(rawTs).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }))
            : null;
        if (hojeSP === dataModificacao) {
            return usuario.status_atual === 'LIVRE_MANUAL' ? STATUS.LIVRE : usuario.status_atual;
        }
        // Modificação de dia anterior — cai no cálculo automático (não retorna aqui)
    }

    // 3. Pausa Manual — sem expiração, persiste até o supervisor liberar
    if (usuario.status_atual === STATUS.PAUSA_MANUAL) return STATUS.PAUSA_MANUAL;

    // 4. Cálculo automático (inclui verificação de dias de trabalho)
    const agora = new Date();
    const horaAtualStr = agora.toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const { horario_entrada_1, horario_saida_1, horario_entrada_2, horario_saida_2, horario_entrada_3, horario_saida_3, dias_trabalho } = usuario;

    // Verifica se hoje é dia de trabalho (fallback Mon-Sex se coluna dias_trabalho não existir ainda)
    const diasTrabalhoEfetivo = dias_trabalho || { '1': true, '2': true, '3': true, '4': true, '5': true };
    const hojeSPStr = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const [yr, mo, dy] = hojeSPStr.split('-').map(Number);
    const diaKey = String(new Date(Date.UTC(yr, mo - 1, dy, 12)).getDay()); // 0=Dom...6=Sáb

    // LIVRE_MANUAL = supervisor liberou explicitamente. Vence dias de folga e janelas de intervalo.
    // DEVE ser declarado ANTES de qualquer early return para que os overrides funcionem.
    // O step 2 já trata o caso principal (data bate); esse bloco é o fallback robusto quando
    // o step 2 falha por qualquer motivo (ex: edge case de timezone entre meia-noite e 3h SP).
    const ehLivreManual = usuario.status_atual === 'LIVRE_MANUAL';

    if (!diasTrabalhoEfetivo[diaKey]) {
        if (ehLivreManual) return STATUS.LIVRE; // folga atípica autorizada pelo supervisor
        return STATUS.FORA_DO_HORARIO;
    }

    const n = (t) => t ? String(t).substring(0, 5) : null;
    const inicioAlmoco  = n(pontoDiario?.horario_real_s1) || n(horario_saida_1);
    const fimAlmoco     = n(pontoDiario?.horario_real_e2) || n(horario_entrada_2);
    const inicioPausa   = n(pontoDiario?.horario_real_s2) || n(horario_saida_2);
    const fimPausa      = n(pontoDiario?.horario_real_e3) || n(horario_entrada_3);
    // Se saida_desfeita = true, ignorar horario_real_s3 (saída foi cancelada pelo supervisor)
    const saidaFinal    = (!pontoDiario?.saida_desfeita && n(pontoDiario?.horario_real_s3))
        || n(horario_saida_3) || n(horario_saida_2) || n(horario_saida_1) || '23:59';
    const entradaInicial = n(horario_entrada_1) || '00:00';

    if (horaAtualStr < entradaInicial || horaAtualStr >= saidaFinal) {
        if (ehLivreManual) return STATUS.LIVRE; // horas extras autorizadas pelo supervisor
        return STATUS.FORA_DO_HORARIO;
    }
    if (inicioAlmoco && fimAlmoco && horaAtualStr >= inicioAlmoco && horaAtualStr < fimAlmoco) {
        if (ehLivreManual) return STATUS.LIVRE; // supervisor antecipou retorno do almoço
        return STATUS.ALMOCO;
    }
    if (inicioPausa  && fimPausa  && horaAtualStr >= inicioPausa  && horaAtualStr < fimPausa) {
        if (ehLivreManual) return STATUS.LIVRE; // supervisor antecipou retorno da pausa
        return STATUS.PAUSA;
    }
    return STATUS.LIVRE;
}

export async function atualizarStatusUsuarioDB(usuarioId, novoStatus) {
    // ATENÇÃO: Esta função agora ignora o dbClient passado e pega sua própria conexão.
    
    if (!usuarioId || !novoStatus) {
        console.error('[ATOMIC-HAMMER] ERRO: usuarioId e novoStatus são obrigatórios.');
        return;
    }

    let localClient; // Conexão local para esta operação
    try {
        localClient = await pool.connect();

        const statusQueLimpamSessao = ['LIVRE', 'FALTOU', 'ALOCADO_EXTERNO'];
        let query;
        const params = [novoStatus, usuarioId];
        const timestampSQL = `(NOW() AT TIME ZONE 'America/Sao_Paulo')`;

        if (statusQueLimpamSessao.includes(novoStatus)) {
            query = `UPDATE usuarios SET status_atual = $1, status_data_modificacao = ${timestampSQL}, id_sessao_trabalho_atual = NULL WHERE id = $2`;
        } else {
            query = `UPDATE usuarios SET status_atual = $1, status_data_modificacao = ${timestampSQL} WHERE id = $2`;
        }

        await localClient.query(query, params);

    } catch (error) {
        console.error(`[ATOMIC-HAMMER] ERRO ao atualizar status para usuário ${usuarioId}:`, error);
        throw error; // Propaga para o caller retornar erro HTTP adequado
    } finally {
        if (localClient) {
            localClient.release(); // Garante que a conexão local seja sempre liberada.
        }
    }
}

// ---------------------------------------------------------------
// NOVA FUNÇÃO: getPermissoesCompletasUsuarioDB
// ---------------------------------------------------------------
const backendPermissoesValidas = new Set(frontendPermissoesDisponiveis.map(p => p.id));

export async function getPermissoesCompletasUsuarioDB(dbClient, usuarioId) {
    let localClient = dbClient; // Usa o cliente passado, se houver
    let clientGerenciadoLocalmente = false;

    try {
        if (!localClient) { // Se nenhum cliente foi passado, conecta um novo
            localClient = await pool.connect();
            clientGerenciadoLocalmente = true;
        }

        const userResult = await localClient.query('SELECT tipos, permissoes FROM usuarios WHERE id = $1', [usuarioId]);
        if (userResult.rows.length === 0) {
            console.error(`[getPermissoesCompletasUsuarioDB] Usuário ID ${usuarioId} não encontrado no DB.`);
            throw new Error('Usuário não encontrado no DB para buscar permissões.');
        }
        const usuarioDB = userResult.rows[0];

        const tipos = Array.isArray(usuarioDB.tipos) ? usuarioDB.tipos : (typeof usuarioDB.tipos === 'string' ? [usuarioDB.tipos] : []);
        const tipoMap = {
            'administrador': 'admin', 'tiktik': 'tiktik', 'cortador': 'cortador',
            'costureira': 'costureira', 'lider_setor': 'lider_setor', 'supervisor': 'supervisor',
        };
        const tiposMapeados = tipos.map(tipo => tipoMap[tipo.toLowerCase()] || tipo.toLowerCase());
        const isAdmin = tiposMapeados.includes('admin');

        let permissoesBase = new Set();
        tiposMapeados.forEach(tipoMapeado => {
            (frontendPermissoesPorTipo[tipoMapeado] || []).forEach(p => permissoesBase.add(p));
        });

        (usuarioDB.permissoes || []).forEach(p => permissoesBase.add(p));

        if (isAdmin) { // Garante que admin (tipo) sempre tenha todas as permissões definidas para 'admin' em permissoesPorTipo
            (frontendPermissoesPorTipo['admin'] || []).forEach(permissao => permissoesBase.add(permissao));
        }
        
        const permissoesFinais = Array.from(permissoesBase).filter(p => backendPermissoesValidas.has(p));
        return permissoesFinais;

    } catch (error) {
        console.error(`[getPermissoesCompletasUsuarioDB] Erro ao buscar permissões para usuário ID ${usuarioId}:`, error.message, error.stack);
        throw error; // Re-lança o erro para ser tratado por quem chamou
    } finally {
        if (clientGerenciadoLocalmente && localClient) {
            localClient.release();
        }
    }
}
// ---------------------------------------------------------------

// Função verificarToken (usada pelo middleware deste router)
const verificarTokenOriginal = (reqOriginal) => {
    const token = reqOriginal.headers.authorization?.split(' ')[1];
    if (!token) {
        const error = new Error('Token não fornecido');
        error.statusCode = 401;
        throw error;
    }
    try {
        // Retorna o payload decodificado, que deve incluir pelo menos o ID do usuário
        return jwt.verify(token, SECRET_KEY);
    } catch (err) {
        const error = new Error('Token inválido ou expirado');
        error.statusCode = 401;
        if (err.name === 'TokenExpiredError') error.details = 'jwt expired';
        throw error;
    }
};

// Middleware para este router (usuarios)
router.use(async (req, res, next) => {
    let cliente;
    try {
        req.usuarioLogado = verificarTokenOriginal(req); // Decodifica o token
        cliente = await pool.connect();
        req.dbCliente = cliente;
        // Não buscamos permissões completas aqui no middleware de /usuarios,
        // pois cada rota pode precisar ou não delas, ou de formas diferentes.
        // A rota específica (ou uma função chamada por ela) buscará se necessário.
        next();
    } catch (error) {
        console.error('[router/usuarios MID] Erro no middleware:', error.message);
        if (cliente) cliente.release();
        const statusCode = error.statusCode || 500;
        const responseError = { error: error.message };
        if (error.details) responseError.details = error.details;
        res.status(statusCode).json(responseError);
    }
});

// GET /api/usuarios/me
router.get('/me', async (req, res) => {
    const { usuarioLogado, dbCliente } = req; // usuarioLogado tem o ID do token
    try {
        // Busca o usuário do banco para garantir dados atualizados (seu código original)
        const result = await dbCliente.query(
            'SELECT id, nome, nome_usuario, email, tipos, nivel, permissoes FROM usuarios WHERE id = $1',
            [usuarioLogado.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado no DB.' });
        }
        
        let usuarioCompleto = result.rows[0];
        
        // --- INÍCIO DA MODIFICAÇÃO ---

        // Passo 1: Busca o avatar ativo usando a mesma conexão `dbCliente`
        const resultAvatar = await dbCliente.query(
            'SELECT url_blob FROM avatares_usuarios WHERE id_usuario = $1 AND ativo = TRUE LIMIT 1',
            [usuarioLogado.id]
        );
        
        // Passo 2: Adiciona a URL do avatar ao objeto de usuário
        usuarioCompleto.avatar_url = resultAvatar.rows.length > 0 ? resultAvatar.rows[0].url_blob : null;
        
        // --- FIM DA MODIFICAÇÃO ---

        // Sincroniza/calcula as permissões totais do usuário (seu código original)
        usuarioCompleto.permissoes = await getPermissoesCompletasUsuarioDB(dbCliente, usuarioLogado.id);
        
        res.status(200).json(usuarioCompleto);

    } catch (error) {
        console.error('[router/usuarios/me] Erro:', error.message, error.stack);
        res.status(500).json({ error: 'Erro ao buscar dados do usuário', details: error.message });
    } finally {
        if (dbCliente) dbCliente.release();
    }
});

router.put('/me/avatar', async (req, res) => {
    // O middleware de autenticação deste router já deve ter verificado o token
    // e adicionado 'req.usuarioLogado'
    const { id: usuarioId } = req.usuarioLogado;
    const { avatarUrl } = req.body;
    let dbClient;

    if (!avatarUrl || typeof avatarUrl !== 'string') {
        return res.status(400).json({ error: 'A URL do avatar (avatarUrl) é obrigatória e deve ser uma string.' });
    }

    try {
        dbClient = await pool.connect();

        const queryText = `
            UPDATE usuarios
            SET avatar_url = $1
            WHERE id = $2
            RETURNING id, nome, email, avatar_url;
        `;

        const result = await dbClient.query(queryText, [avatarUrl, usuarioId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado para atualizar.' });
        }

        res.status(200).json({
            message: 'Avatar atualizado com sucesso!',
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('[API PUT /me/avatar] Erro na rota:', error);
        res.status(500).json({ error: 'Erro interno do servidor ao atualizar o avatar.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/usuarios
router.get('/', async (req, res) => {
    const { dbCliente } = req;
    try {
        const query = `
            SELECT 
                u.id, u.nome, u.nome_completo,
                u.nome_usuario, u.email, u.tipos, u.nivel, u.permissoes,
                u.salario_fixo, u.valor_passagem_diaria, u.elegivel_pagamento,
                u.desconto_inss_percentual, 
                u.desconto_vt_percentual,
                u.id_contato_financeiro, u.data_admissao,
                u.data_demissao,
                u.horario_entrada_1, u.horario_saida_1,
                u.horario_entrada_2, u.horario_saida_2,
                u.horario_entrada_3, u.horario_saida_3,
                u.dias_trabalho,
                COALESCE(u.avatar_url, $1) as avatar_url,
                u.foto_oficial,
                c.nome AS nome_contato_financeiro,
                COALESCE(
                    (SELECT array_agg(ucv.concessionaria_id) 
                    FROM usuario_concessionaria_vt ucv 
                    WHERE ucv.usuario_id = u.id),
                    '{}'
                ) AS concessionarias_vt,
                -- LÓGICA PARA VERIFICAR SE O USUÁRIO ESTÁ DE FÉRIAS HOJE --
                EXISTS (
                    SELECT 1
                    FROM ferias_empregados fe
                    WHERE fe.id_usuario = u.id AND CURRENT_DATE BETWEEN fe.data_inicio AND fe.data_fim
                ) AS esta_de_ferias
            FROM usuarios u
            LEFT JOIN fc_contatos c ON u.id_contato_financeiro = c.id
            WHERE (u.arquivado IS FALSE OR u.arquivado IS NULL) -- <<< ESCONDE OS ARQUIVADOS
              AND (u.is_test IS FALSE OR u.is_test IS NULL)   -- <<< ESCONDE USUÁRIOS DE TESTE
            ORDER BY u.nome ASC;
        `;
    // Passamos a variável de ambiente como um parâmetro para a query
    const result = await dbCliente.query(query, [process.env.DEFAULT_AVATAR_URL]);

    res.status(200).json(result.rows);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[router/usuarios GET] Erro:', error);
        res.status(500).json({ error: 'Erro ao listar usuários', details: error.message });
    } finally {
        if (dbCliente) dbCliente.release();
    }
});

// POST /api/usuarios
router.post('/', async (req, res) => {
    const { usuarioLogado, dbCliente } = req;
    try {
        const permissoesUsuarioAtual = await getPermissoesCompletasUsuarioDB(dbCliente, usuarioLogado.id);
        if (!permissoesUsuarioAtual.includes('acesso-cadastrar-usuarios')) {
            return res.status(403).json({ error: 'Permissão negada para criar usuários' });
        }
        
        const { 
            nome, nomeUsuario, email, senha, tipos, nivel, 
            salario_fixo, valor_passagem_diaria, 
            desconto_inss_percentual, desconto_vt_percentual, // Novos campos
            concessionaria_ids // Array de IDs de concessionárias
        } = req.body;

        if (!nome || !nomeUsuario || !email || !senha || !tipos) {
            return res.status(400).json({ error: "Campos obrigatórios ausentes." });
        }
        
        await dbCliente.query('BEGIN');

        // 1. Cria o usuário principal
        const senhaHash = await bcrypt.hash(senha, 10);
        const userResult = await dbCliente.query(
            `INSERT INTO usuarios (
                nome, nome_usuario, email, senha, 
                tipos, nivel, salario_fixo, valor_passagem_diaria, permissoes,
                desconto_inss_percentual, desconto_vt_percentual
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [
                nome, nomeUsuario, email, senhaHash, 
                tipos, nivel, salario_fixo || 0, valor_passagem_diaria || 0, [],
                desconto_inss_percentual || 9.00, desconto_vt_percentual || 6.00
            ] 
        );
        const novoUsuarioId = userResult.rows[0].id;

        // 2. Vínculo com Concessionárias de VT
        if (concessionaria_ids && Array.isArray(concessionaria_ids) && concessionaria_ids.length > 0) {
            const valuesClauses = concessionaria_ids.map((_, i) => `($1, $${i + 2})`).join(', ');
            const insertVinculosQuery = `INSERT INTO usuario_concessionaria_vt (usuario_id, concessionaria_id) VALUES ${valuesClauses}`;
            await dbCliente.query(insertVinculosQuery, [novoUsuarioId, ...concessionaria_ids]);
        }

        // 3. Cria Contato Financeiro (Lógica existente mantida)
        const ehEmpregado = tipos.includes('costureira') || tipos.includes('tiktik') || tipos.includes('cortador') || tipos.includes('supervisor');
        if (ehEmpregado) {
            let contatoId;
            const existingContactRes = await dbCliente.query(
                "SELECT id FROM fc_contatos WHERE nome = $1 AND tipo = 'EMPREGADO' LIMIT 1",
                [nome]
            );

            if (existingContactRes.rows.length > 0) {
                contatoId = existingContactRes.rows[0].id;
            } else {
                const newContactRes = await dbCliente.query(
                    "INSERT INTO fc_contatos (nome, tipo, ativo) VALUES ($1, 'EMPREGADO', TRUE) RETURNING id",
                    [nome]
                );
                contatoId = newContactRes.rows[0].id;
            }

            await dbCliente.query(
                "UPDATE usuarios SET id_contato_financeiro = $1 WHERE id = $2",
                [contatoId, novoUsuarioId]
            );
        }
        
        await dbCliente.query('COMMIT');
        
        const finalUserRes = await dbCliente.query('SELECT * FROM usuarios WHERE id = $1', [novoUsuarioId]);
        res.status(201).json(finalUserRes.rows[0]);

    } catch (error) {
        if (dbCliente) await dbCliente.query('ROLLBACK');
        console.error('[router/usuarios POST] Erro:', error);
        if (error.code === '23505') {
             res.status(409).json({ error: 'Usuário ou email já cadastrado.', details: error.detail });
        } else {
            res.status(500).json({ error: 'Erro ao criar usuário', details: error.message });
        }
    } finally {
        if (dbCliente) dbCliente.release();
    }
});

// PUT /api/usuarios (para atualizar um usuário por ID no corpo)
router.put('/', async (req, res) => {
    const { usuarioLogado, dbCliente } = req;
    try {
        const permissoesUsuarioAtual = await getPermissoesCompletasUsuarioDB(dbCliente, usuarioLogado.id);
        if (!permissoesUsuarioAtual.includes('editar-usuarios')) {
            return res.status(403).json({ error: 'Permissão negada para editar usuários' });
        }
        
        // Recebemos todos os campos do corpo da requisição
        const {
            id, nome, nomeUsuario, email, tipos, nivel,
            nome_completo,
            salario_fixo, valor_passagem_diaria,
            elegivel_pagamento, id_contato_financeiro, concessionaria_ids,
            permissoes: permissoesIndividuais,
            data_admissao,
            data_demissao,
            horario_entrada_1,
            horario_saida_1,
            horario_entrada_2,
            horario_saida_2,
            horario_entrada_3,
            horario_saida_3,
            foto_oficial
        } = req.body;

        if (!id) {
            return res.status(400).json({ error: "O ID do usuário é obrigatório para atualização." });
        }

        // Captura permissões anteriores para o diff de auditoria (antes do BEGIN)
        let oldPermissoesIndividuais = [];
        if (permissoesIndividuais !== undefined) {
            const oldInfoRes = await dbCliente.query('SELECT permissoes FROM usuarios WHERE id = $1', [id]);
            oldPermissoesIndividuais = oldInfoRes.rows[0]?.permissoes || [];
        }

        await dbCliente.query('BEGIN'); // Inicia a transação

        // --- 1. Lógica para atualizar a tabela 'usuarios' ---
        const fieldsToUpdate = [];
        const values = [];
        let paramIndex = 1;

        if (nome !== undefined) { fieldsToUpdate.push(`nome = $${paramIndex++}`); values.push(nome); }
        if (nome_completo !== undefined) { 
            fieldsToUpdate.push(`nome_completo = $${paramIndex++}`); 
            values.push(nome_completo); 
        }
        if (nomeUsuario !== undefined) { fieldsToUpdate.push(`nome_usuario = $${paramIndex++}`); values.push(nomeUsuario); }
        if (email !== undefined) { fieldsToUpdate.push(`email = $${paramIndex++}`); values.push(email); }
        if (tipos !== undefined) { fieldsToUpdate.push(`tipos = $${paramIndex++}`); values.push(tipos); }
        if (nivel !== undefined) { fieldsToUpdate.push(`nivel = $${paramIndex++}`); values.push(nivel); }
        
        if (salario_fixo !== undefined) { fieldsToUpdate.push(`salario_fixo = $${paramIndex++}`); values.push(salario_fixo); }
        if (valor_passagem_diaria !== undefined) { fieldsToUpdate.push(`valor_passagem_diaria = $${paramIndex++}`); values.push(valor_passagem_diaria); }
        
        if (req.body.desconto_inss_percentual !== undefined) { fieldsToUpdate.push(`desconto_inss_percentual = $${paramIndex++}`); values.push(req.body.desconto_inss_percentual); }
        if (req.body.desconto_vt_percentual !== undefined) { fieldsToUpdate.push(`desconto_vt_percentual = $${paramIndex++}`); values.push(req.body.desconto_vt_percentual); }
        
        if (elegivel_pagamento !== undefined) { fieldsToUpdate.push(`elegivel_pagamento = $${paramIndex++}`); values.push(elegivel_pagamento); }
        
        if (id_contato_financeiro !== undefined) { fieldsToUpdate.push(`id_contato_financeiro = $${paramIndex++}`); values.push(id_contato_financeiro); }
        if (permissoesIndividuais !== undefined) {
            const permissoesValidas = permissoesIndividuais.filter(p => backendPermissoesValidas.has(p));
            fieldsToUpdate.push(`permissoes = $${paramIndex++}`);
            values.push(permissoesValidas);
        }
        if (data_admissao !== undefined) { fieldsToUpdate.push(`data_admissao = $${paramIndex++}`); 
            // Se a data vier vazia, salva como nulo
            values.push(data_admissao || null); 
        }
        if (data_demissao !== undefined) { fieldsToUpdate.push(`data_demissao = $${paramIndex++}`); values.push(data_demissao || null); }
        if (horario_entrada_1 !== undefined) { fieldsToUpdate.push(`horario_entrada_1 = $${paramIndex++}`); values.push(horario_entrada_1 || null); }
        if (horario_saida_1 !== undefined) { fieldsToUpdate.push(`horario_saida_1 = $${paramIndex++}`); values.push(horario_saida_1 || null); }
        if (horario_entrada_2 !== undefined) { fieldsToUpdate.push(`horario_entrada_2 = $${paramIndex++}`); values.push(horario_entrada_2 || null); }
        if (horario_saida_2 !== undefined) { fieldsToUpdate.push(`horario_saida_2 = $${paramIndex++}`); values.push(horario_saida_2 || null); }
        if (horario_entrada_3 !== undefined) { fieldsToUpdate.push(`horario_entrada_3 = $${paramIndex++}`); values.push(horario_entrada_3 || null); }
        if (horario_saida_3 !== undefined) { fieldsToUpdate.push(`horario_saida_3 = $${paramIndex++}`); values.push(horario_saida_3 || null); }
        if (req.body.dias_trabalho !== undefined) { fieldsToUpdate.push(`dias_trabalho = $${paramIndex++}`); values.push(req.body.dias_trabalho); }
        if (foto_oficial !== undefined) { fieldsToUpdate.push(`foto_oficial = $${paramIndex++}`); values.push(foto_oficial || null); }

        if (fieldsToUpdate.length > 0) {
            values.push(id);
            const queryText = `UPDATE usuarios SET ${fieldsToUpdate.join(', ')} WHERE id = $${paramIndex}`;
            await dbCliente.query(queryText, values);
        }

        // --- 2. Lógica para atualizar a tabela 'usuario_concessionaria_vt' ---
        if (concessionaria_ids && Array.isArray(concessionaria_ids)) {
            await dbCliente.query('DELETE FROM usuario_concessionaria_vt WHERE usuario_id = $1', [id]);
            if (concessionaria_ids.length > 0) {
                const valuesClauses = concessionaria_ids.map((_, i) => `($1, $${i + 2})`).join(', ');
                const insertVinculosQuery = `INSERT INTO usuario_concessionaria_vt (usuario_id, concessionaria_id) VALUES ${valuesClauses}`;
                await dbCliente.query(insertVinculosQuery, [id, ...concessionaria_ids]);
            }
        }

        await dbCliente.query('COMMIT'); // Finaliza a transação

        // Retorna o usuário atualizado para consistência no frontend
        const finalUserRes = await dbCliente.query('SELECT * FROM usuarios WHERE id = $1', [id]);
        let usuarioAtualizado = finalUserRes.rows[0];
        usuarioAtualizado.permissoes_totais = await getPermissoesCompletasUsuarioDB(dbCliente, usuarioAtualizado.id);

        if (permissoesIndividuais !== undefined) {
            const permissoesValidasParaSalvar = permissoesIndividuais.filter(p => backendPermissoesValidas.has(p));
            await registrarAuditoria(null, usuarioLogado, 'permissoes.alteradas', 'usuario', id, {
                usuario_alvo_id: id,
                usuario_alvo_nome: usuarioAtualizado?.nome || String(id),
                permissoes_adicionadas: permissoesValidasParaSalvar.filter(p => !oldPermissoesIndividuais.includes(p)),
                permissoes_removidas: oldPermissoesIndividuais.filter(p => !permissoesValidasParaSalvar.includes(p)),
            });
        }

        res.status(200).json(usuarioAtualizado);

    } catch (error) {
        if (dbCliente) await dbCliente.query('ROLLBACK');
        console.error('[router/usuarios PUT] Erro:', error);
        if (error.code === '23505') {
             res.status(409).json({ error: 'Nome de usuário ou email já em uso por outro usuário.', details: error.detail });
        } else {
            res.status(500).json({ error: 'Erro ao atualizar usuário', details: error.message });
        }
    } finally {
        if (dbCliente) dbCliente.release();
    }
});

// PUT /api/usuarios/batch (atualizar permissões em lote)
// Esta rota parece ser para definir as *permissões individuais* de vários usuários.
router.put('/batch', async (req, res) => {
    const { usuarioLogado, dbCliente } = req;
    try {
        const permissoesUsuarioAtual = await getPermissoesCompletasUsuarioDB(dbCliente, usuarioLogado.id);
        if (!permissoesUsuarioAtual.includes('gerenciar-permissoes')) {
            return res.status(403).json({ error: 'Permissão negada para gerenciar permissões em lote' });
        }
        const usuariosParaAtualizar = req.body; // Espera um array de { id, permissoes: [...] }
        if (!Array.isArray(usuariosParaAtualizar) || usuariosParaAtualizar.length === 0) {
            return res.status(400).json({ error: 'Corpo da requisição inválido: esperado um array de usuários' });
        }

        await dbCliente.query('BEGIN');
        try {
            const auditDiffs = [];
            for (const usuario of usuariosParaAtualizar) {
                const { id, permissoes: permissoesIndividuaisNovas } = usuario;
                if (id === undefined || !Array.isArray(permissoesIndividuaisNovas)) {
                    throw new Error('Formato inválido: id ou permissoes ausentes/inválidos para um dos usuários.');
                }
                // Filtra para garantir que apenas permissões válidas sejam salvas
                const permissoesValidasParaSalvar = permissoesIndividuaisNovas.filter(p => backendPermissoesValidas.has(p));

                // Busca nome e permissões anteriores para o diff de auditoria
                const infoResult = await dbCliente.query('SELECT nome, permissoes FROM usuarios WHERE id = $1', [id]);
                const infoUsuario = infoResult.rows[0];
                const oldPermissoes = infoUsuario?.permissoes || [];
                auditDiffs.push({
                    id,
                    nome: infoUsuario?.nome || String(id),
                    permissoes_adicionadas: permissoesValidasParaSalvar.filter(p => !oldPermissoes.includes(p)),
                    permissoes_removidas: oldPermissoes.filter(p => !permissoesValidasParaSalvar.includes(p)),
                });

                await dbCliente.query(
                    'UPDATE usuarios SET permissoes = $1 WHERE id = $2',
                    [permissoesValidasParaSalvar, id]
                );
            }
            await dbCliente.query('COMMIT');
            for (const diff of auditDiffs) {
                await registrarAuditoria(null, usuarioLogado, 'permissoes.alteradas', 'usuario', diff.id, {
                    usuario_alvo_id: diff.id,
                    usuario_alvo_nome: diff.nome,
                    permissoes_adicionadas: diff.permissoes_adicionadas,
                    permissoes_removidas: diff.permissoes_removidas,
                });
            }
            res.status(200).json({ message: 'Permissões individuais dos usuários atualizadas com sucesso' });
        } catch (transactionError) {
            await dbCliente.query('ROLLBACK');
            console.error('[router/usuarios/batch] Erro na transação:', transactionError);
            const message = transactionError.message.startsWith('Formato inválido:') ? transactionError.message : 'Erro ao salvar permissões durante a transação.';
            res.status(400).json({ error: message, details: transactionError.message });
        }
    } catch (error) {
        console.error('[router/usuarios/batch] Erro geral:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    } finally {
        if (dbCliente) dbCliente.release();
    }
});

// DELETE /api/usuarios (Agora faz SOFT DELETE / ARQUIVAMENTO)
router.delete('/', async (req, res) => {
    const { usuarioLogado, dbCliente } = req;
    try {
        const permissoesUsuarioAtual = await getPermissoesCompletasUsuarioDB(dbCliente, usuarioLogado.id);
        if (!permissoesUsuarioAtual.includes('excluir-usuarios')) {
            return res.status(403).json({ error: 'Permissão negada para excluir usuários' });
        }
        const { id } = req.body;
        if (!id) {
             return res.status(400).json({ error: 'ID do usuário é obrigatório.' });
        }

        // --- LÓGICA DE ARQUIVAMENTO (SOFT DELETE) ---
        // 1. Marca como arquivado
        // 2. Define data de demissão para hoje (se não tiver)
        // 3. Altera nome_usuario e email para liberar o uso para futuros cadastros
        // 4. Limpa status e sessão
        
        const timestamp = Date.now();
        const query = `
            UPDATE usuarios 
            SET 
                arquivado = TRUE,
                status_atual = 'LIVRE',
                id_sessao_trabalho_atual = NULL,
                data_demissao = COALESCE(data_demissao, CURRENT_DATE),
                nome_usuario = nome_usuario || '_arq_' || $2,
                email = email || '_arq_' || $2
            WHERE id = $1 
            RETURNING id, nome
        `;

        const result = await dbCliente.query(query, [id, timestamp]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado para arquivamento.' });
        }
        
        res.status(200).json({ message: 'Usuário arquivado com sucesso.', id: result.rows[0].id });

    } catch (error) {
        console.error('[router/usuarios DELETE] Erro:', error);
        res.status(500).json({ error: 'Erro ao arquivar usuário', details: error.message });
    } finally {
        if (dbCliente) dbCliente.release();
    }
});


// GET /api/usuarios/buscar-contatos-empregado?q=termo
router.get('/buscar-contatos-empregado', async (req, res) => {
    const { usuarioLogado, dbCliente } = req;
    const termoBusca = req.query.q;

    try {
        const permissoesUsuarioAtual = await getPermissoesCompletasUsuarioDB(dbCliente, usuarioLogado.id);
        if (!permissoesUsuarioAtual.includes('editar-usuarios')) {
            return res.status(403).json({ error: 'Permissão negada para buscar contatos.' });
        }

        if (!termoBusca || termoBusca.trim().length < 3) {
            return res.status(200).json([]);
        }

        const query = `
            SELECT id, nome, tipo 
            FROM fc_contatos 
            WHERE 
                nome ILIKE $1 
                AND tipo = 'EMPREGADO' 
                AND ativo = true 
            ORDER BY nome LIMIT 10
        `;
        const params = [`%${termoBusca.trim()}%`];

        const result = await dbCliente.query(query, params);
        
        
        res.status(200).json(result.rows);

    } catch (error) {
        console.error('[BACKEND] ERRO CRÍTICO na rota /buscar-contatos-empregado:', error);
        res.status(500).json({ error: 'Erro interno ao buscar contatos.', details: error.message });
    } finally {
        if (dbCliente) dbCliente.release();
    }
});

// NOVA ROTA: PUT /api/usuarios/:id/status
router.put('/:id/status', async (req, res) => {
    const { usuarioLogado } = req;
    const { id: idUsuarioParaAtualizar } = req.params;
    const { status: novoStatus } = req.body;

    let dbClient;

    try {
        dbClient = await pool.connect();
        
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoes.includes('gerenciar-permissoes')) {
            return res.status(403).json({ error: 'Permissão negada para alterar status de usuários.' });
        }

        const validStatus = ['LIVRE', 'FALTOU', 'PAUSA_MANUAL', 'ALOCADO_EXTERNO', 'LIVRE_MANUAL'];
        if (!novoStatus || !validStatus.includes(novoStatus)) {
            console.error('[BACKEND-VALIDACAO] ERRO: Status inválido!');
            return res.status(400).json({ error: 'Status fornecido é inválido.' });
        }
        
        // CORREÇÃO AQUI: A função atômica não precisa mais do dbClient.
        await atualizarStatusUsuarioDB(idUsuarioParaAtualizar, novoStatus);
        
        res.status(200).json({ message: `Status do usuário ${idUsuarioParaAtualizar} atualizado para ${novoStatus}.` });

    } catch (error) {
        console.error(`[API /usuarios/:id/status] Erro:`, error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Erro interno ao atualizar status.' });
        }
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/usuarios/:id/ferias - Busca o histórico de férias de um usuário
router.get('/:id/ferias', async (req, res) => {
    const { dbCliente } = req;
    const { id: idUsuario } = req.params;

    try {
        // Para visualizar o histórico, exigimos a mesma permissão de "editar usuários",
        // pois são informações sensíveis de RH.
        const permissoes = await getPermissoesCompletasUsuarioDB(dbCliente, req.usuarioLogado.id);
        if (!permissoes.includes('editar-usuarios')) {
            return res.status(403).json({ error: 'Permissão negada para visualizar o histórico de férias.' });
        }

        const query = `
            SELECT id, data_inicio, data_fim, observacoes 
            FROM ferias_empregados 
            WHERE id_usuario = $1 
            ORDER BY data_inicio DESC
        `;
        const result = await dbCliente.query(query, [idUsuario]);
        res.status(200).json(result.rows);

    } catch (error) {
        console.error(`[API /usuarios/:id/ferias GET] Erro:`, error);
        res.status(500).json({ error: 'Erro ao buscar histórico de férias.' });
    } finally {
        if (dbCliente) dbCliente.release();
    }
});

// POST /api/usuarios/:id/ferias - Adiciona um novo período de férias
router.post('/:id/ferias', async (req, res) => {
    const { dbCliente } = req;
    const { id: idUsuario } = req.params;
    const { data_inicio, data_fim, observacoes } = req.body;

    // --- Validação dos dados de entrada ---
    if (!data_inicio || !data_fim) {
        return res.status(400).json({ error: 'Data de início e data de fim são obrigatórias.' });
    }
    if (new Date(data_fim) < new Date(data_inicio)) {
        return res.status(400).json({ error: 'A data de fim não pode ser anterior à data de início.' });
    }

    try {
        // Verificação de permissão específica
        const permissoes = await getPermissoesCompletasUsuarioDB(dbCliente, req.usuarioLogado.id);
        if (!permissoes.includes('adicionar-ferias')) { 
            return res.status(403).json({ error: 'Permissão negada para adicionar férias.' });
        }

        const query = `
            INSERT INTO ferias_empregados (id_usuario, data_inicio, data_fim, observacoes)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;
        const result = await dbCliente.query(query, [idUsuario, data_inicio, data_fim, observacoes]);
        
        res.status(201).json(result.rows[0]); // Retorna o registro criado

    } catch (error) { 
        console.error(`[API /usuarios/:id/ferias POST] Erro:`, error);
        res.status(500).json({ error: 'Erro ao registrar férias.' });
    } finally {
        if (dbCliente) dbCliente.release();
    }
});

// POST /api/usuarios/:id/foto-oficial — upload da foto de admissão pelo admin
router.post('/:id/foto-oficial', uploadMulter.single('foto'), async (req, res) => {
    const { usuarioLogado } = req;
    const { id: idAlvo } = req.params;

    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo recebido.' });

    let dbClient;
    try {
        dbClient = await pool.connect();

        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoes.includes('editar-usuarios')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }

        const blob = await put(
            `fotos-oficiais/usuario-${idAlvo}-${req.file.originalname}`,
            req.file.buffer,
            { access: 'public', addRandomSuffix: true, token: process.env.BLOB_READ_WRITE_TOKEN }
        );

        await dbClient.query(
            'UPDATE usuarios SET foto_oficial = $1 WHERE id = $2',
            [blob.url, idAlvo]
        );

        res.status(200).json({ url: blob.url });
    } catch (error) {
        console.error('[foto-oficial] Erro:', error);
        res.status(500).json({ error: 'Falha no upload da foto.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/usuarios/:id/impersonar — gera token temporário para admin visualizar como funcionário
router.post('/:id/impersonar', async (req, res) => {
    const { usuarioLogado } = req;
    const { id: idAlvo } = req.params;
    let dbClient;
    try {
        dbClient = await pool.connect();

        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id);
        if (!permissoes.includes('gerenciar-permissoes')) {
            return res.status(403).json({ error: 'Permissão negada. Apenas administradores podem usar impersonação.' });
        }

        const result = await dbClient.query(
            `SELECT id, nome, nome_usuario, tipos
             FROM usuarios
             WHERE id = $1 AND (arquivado IS FALSE OR arquivado IS NULL) AND data_demissao IS NULL`,
            [idAlvo]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado ou já desligado.' });
        }
        const alvo = result.rows[0];

        const tiposAlvo = alvo.tipos || [];
        const ehProdutivo = tiposAlvo.includes('costureira') || tiposAlvo.includes('tiktik');
        if (!ehProdutivo) {
            return res.status(400).json({ error: 'Impersonação disponível apenas para costureiras e tiktiks.' });
        }

        const tokenImpersonacao = jwt.sign(
            {
                id: alvo.id,
                nome_usuario: alvo.nome_usuario,
                nome: alvo.nome,
                tipos: tiposAlvo,
                impersonando: true,
                impersonadoPor: usuarioLogado.id,
            },
            SECRET_KEY,
            { expiresIn: '2h' }
        );

        res.json({ token: tokenImpersonacao, nome: alvo.nome });
    } catch (error) {
        console.error('[impersonar] Erro:', error);
        res.status(500).json({ error: 'Erro ao gerar token de impersonação.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;