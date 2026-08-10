import 'dotenv/config';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { obterEmpresaIdDoContexto } from './contexto-empresa.js';
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';

const { Pool } = pg;
const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.POSTGRES_URL
        && !process.env.POSTGRES_URL.includes('127.0.0.1')
        && !process.env.POSTGRES_URL.includes('localhost')
        ? { rejectUnauthorized: false }
        : undefined,
});
const SECRET_KEY = process.env.JWT_SECRET;

function erro(statusCode, mensagem, codigo = null) {
    const error = new Error(mensagem);
    error.statusCode = statusCode;
    if (codigo) error.codigo = codigo;
    return error;
}

function textoObrigatorio(valor, campo, maximo = 120) {
    const texto = String(valor ?? '').trim();
    if (!texto) throw erro(400, `${campo} é obrigatório.`);
    if (texto.length > maximo) throw erro(400, `${campo} deve ter no máximo ${maximo} caracteres.`);
    return texto;
}

function idPositivo(valor) {
    const id = Number(valor);
    if (!Number.isSafeInteger(id) || id <= 0) throw erro(400, 'Identificador de processo inválido.');
    return id;
}

function normalizarBooleano(valor, campo) {
    if (typeof valor === 'boolean') return valor;
    if (valor === 'true' || valor === '1') return true;
    if (valor === 'false' || valor === '0') return false;
    throw erro(400, `${campo} deve ser booleano.`);
}

export function gerarCodigoProcesso(nome) {
    const codigo = String(nome)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    if (!codigo) throw erro(400, 'O nome precisa gerar um código válido.');
    return codigo;
}

function autenticar(req, res, next) {
    try {
        const authorization = req.headers.authorization || '';
        const [tipo, token] = authorization.split(' ');
        if (tipo !== 'Bearer' || !token) throw erro(401, 'Token ausente ou malformado.');
        req.usuarioLogado = jwt.verify(token, SECRET_KEY);
        req.empresaId = obterEmpresaIdDoContexto(req);
        next();
    } catch (error) {
        res.status(error.statusCode || 401).json({
            error: error.message || 'Token inválido ou expirado.',
            codigo: error.codigo || undefined,
        });
    }
}

router.use(autenticar);

async function exigirPermissaoCatalogo(req, dbClient, permissao, mensagem) {
    const permissoes = await getPermissoesCompletasUsuarioDB(
        dbClient,
        req.usuarioLogado.id,
        req.empresaId,
    );
    if (!permissoes.includes(permissao)) throw erro(403, mensagem);
}

const SELECT_PROCESSO = `
    SELECT id, empresa_id, codigo, nome, ativo, criado_em, atualizado_em, inativado_em
      FROM processos_producao
`;

router.get('/', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        await exigirPermissaoCatalogo(
            req,
            dbClient,
            'ver-lista-produtos',
            'Permissão negada para consultar o catálogo de processos.',
        );
        const incluirInativos = String(req.query.incluir_inativos).toLowerCase() === 'true';
        const result = await dbClient.query(
            `${SELECT_PROCESSO}
             WHERE empresa_id = $1
               AND ($2::boolean OR ativo = TRUE)
             ORDER BY ativo DESC, nome ASC`,
            [req.empresaId, incluirInativos]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[API /processos-producao GET] Erro:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao buscar processos.' });
    } finally {
        dbClient?.release();
    }
});

router.post('/', async (req, res) => {
    let dbClient;
    try {
        const nome = textoObrigatorio(req.body?.nome, 'Nome do processo');
        const codigo = gerarCodigoProcesso(nome);
        dbClient = await pool.connect();
        await exigirPermissaoCatalogo(
            req,
            dbClient,
            'gerenciar-produtos',
            'Permissão negada para criar processos do catálogo.',
        );
        const result = await dbClient.query(
            `INSERT INTO processos_producao (empresa_id, codigo, nome)
             VALUES ($1, $2, $3)
             RETURNING id, empresa_id, codigo, nome, ativo, criado_em, atualizado_em, inativado_em`,
            [req.empresaId, codigo, nome]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('[API /processos-producao POST] Erro:', error);
        const status = error.code === '23505' ? 409 : (error.statusCode || 500);
        const mensagem = error.code === '23505'
            ? 'Já existe um processo ativo ou um código igual nesta empresa.'
            : (error.message || 'Erro ao criar processo.');
        res.status(status).json({ error: mensagem });
    } finally {
        dbClient?.release();
    }
});

router.put('/:id', async (req, res) => {
    let dbClient;
    try {
        const id = idPositivo(req.params.id);
        const nome = req.body?.nome === undefined
            ? null
            : textoObrigatorio(req.body.nome, 'Nome do processo');
        const ativo = req.body?.ativo === undefined ? null : normalizarBooleano(req.body.ativo, 'Ativo');
        if (nome === null && ativo === null) throw erro(400, 'Informe o novo nome ou o status do processo.');

        dbClient = await pool.connect();
        await exigirPermissaoCatalogo(
            req,
            dbClient,
            'gerenciar-produtos',
            'Permissão negada para editar processos do catálogo.',
        );
        const result = await dbClient.query(
            `UPDATE processos_producao
                SET nome = COALESCE($1, nome),
                    ativo = COALESCE($2, ativo),
                    inativado_em = CASE
                        WHEN COALESCE($2, ativo) = TRUE THEN NULL
                        WHEN inativado_em IS NULL THEN NOW()
                        ELSE inativado_em
                    END,
                    atualizado_em = NOW()
              WHERE id = $3
                AND empresa_id = $4
             RETURNING id, empresa_id, codigo, nome, ativo, criado_em, atualizado_em, inativado_em`,
            [nome, ativo, id, req.empresaId]
        );
        if (result.rowCount === 0) throw erro(404, 'Processo não encontrado nesta empresa.');
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('[API /processos-producao PUT] Erro:', error);
        const status = error.code === '23505' ? 409 : (error.statusCode || 500);
        const mensagem = error.code === '23505'
            ? 'Já existe outro processo ativo com este nome nesta empresa.'
            : (error.message || 'Erro ao atualizar processo.');
        res.status(status).json({ error: mensagem });
    } finally {
        dbClient?.release();
    }
});

export default router;
