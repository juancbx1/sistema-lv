import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcrypt';
import pg from 'pg';
import { permissoesValidas } from '../public/js/utils/permissoes.js';

const { Pool } = pg;
const router = express.Router();
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

const TIPOS_VALIDOS = new Set([
    'administrador',
    'supervisor',
    'lider_setor',
    'costureira',
    'tiktik',
    'cortador',
    'socio',
    'ex_socio',
    'prestador_externo',
]);

function erro(statusCode, mensagem) {
    const error = new Error(mensagem);
    error.statusCode = statusCode;
    return error;
}

function inteiroPositivo(valor, nome) {
    const numero = Number(valor);
    if (!Number.isSafeInteger(numero) || numero <= 0) {
        throw erro(400, `${nome} inválido.`);
    }
    return numero;
}

function texto(valor, maximo = 500) {
    if (valor === undefined || valor === null) return null;
    const normalizado = String(valor).trim();
    return normalizado ? normalizado.slice(0, maximo) : null;
}

function numeroNaoNegativo(valor, padrao = 0) {
    if (valor === undefined || valor === null || valor === '') return padrao;
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero < 0) {
        throw erro(400, 'Os valores financeiros não podem ser negativos.');
    }
    return numero;
}

function inteiroOpcional(valor, nome) {
    if (valor === undefined || valor === null || valor === '') return null;
    const numero = Number(valor);
    if (!Number.isSafeInteger(numero) || numero < 0) {
        throw erro(400, `${nome} inválido.`);
    }
    return numero;
}

function dataOpcional(valor, nome) {
    const data = texto(valor, 10);
    if (!data) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(`${data}T12:00:00Z`))) {
        throw erro(400, `${nome} inválida.`);
    }
    return data;
}

function normalizarTipos(valor) {
    if (!Array.isArray(valor)) throw erro(400, 'Informe ao menos uma função.');
    const tipos = [...new Set(valor.map((item) => String(item).trim()).filter(Boolean))];
    if (!tipos.length || tipos.some((item) => !TIPOS_VALIDOS.has(item))) {
        throw erro(400, 'Uma ou mais funções são inválidas.');
    }
    return tipos;
}

function normalizarPermissoes(valor) {
    if (valor === undefined || valor === null) return [];
    if (!Array.isArray(valor)) throw erro(400, 'Permissões inválidas.');
    return [...new Set(valor.filter((item) => permissoesValidas.has(item)))];
}

function gerarCodigoEmpresa(nomeFantasia) {
    const codigo = String(nomeFantasia || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50)
        .replace(/-+$/g, '');
    if (!codigo) {
        throw erro(400, 'O nome fantasia precisa gerar um código interno válido.');
    }
    return codigo;
}

function normalizarCnpj(valor) {
    const cnpj = String(valor || '').replace(/\D/g, '');
    if (!cnpj) return null;
    if (cnpj.length !== 14) throw erro(400, 'O CNPJ deve conter 14 números.');
    return cnpj;
}

function normalizarCep(valor) {
    const cep = String(valor || '').replace(/\D/g, '');
    if (!cep) return null;
    if (cep.length !== 8) throw erro(400, 'O CEP deve conter 8 números.');
    return cep;
}

function normalizarCor(valor) {
    const cor = texto(valor, 7);
    if (!cor) return null;
    if (!/^#[0-9A-Fa-f]{6}$/.test(cor)) throw erro(400, 'A cor de identificação é inválida.');
    return cor.toUpperCase();
}

function normalizarEstado(valor) {
    const estado = texto(valor, 2)?.toUpperCase() || null;
    if (estado && !/^[A-Z]{2}$/.test(estado)) throw erro(400, 'O estado deve ser uma UF válida.');
    return estado;
}

function dadosEmpresa(body, { criacao = false } = {}) {
    const nomeFantasia = texto(body.nome_fantasia, 120);
    if (criacao && !nomeFantasia) throw erro(400, 'Nome fantasia é obrigatório.');

    return {
        codigo: criacao ? gerarCodigoEmpresa(nomeFantasia) : undefined,
        razao_social: texto(body.razao_social, 160),
        nome_fantasia: nomeFantasia,
        cnpj: normalizarCnpj(body.cnpj),
        logo_url: texto(body.logo_url, 2000),
        cor_identificacao: normalizarCor(body.cor_identificacao),
        telefone: texto(body.telefone, 30),
        email: texto(body.email, 160)?.toLowerCase() || null,
        cep: normalizarCep(body.cep),
        logradouro: texto(body.logradouro, 180),
        numero_endereco: texto(body.numero_endereco, 30),
        complemento: texto(body.complemento, 120),
        bairro: texto(body.bairro, 100),
        cidade: texto(body.cidade, 100),
        estado: normalizarEstado(body.estado),
        timezone: texto(body.timezone, 60) || 'America/Sao_Paulo',
        prefixo_op: texto(body.prefixo_op, 20)?.toUpperCase() || null,
        numero_inicial_op: inteiroPositivo(body.numero_inicial_op || 1, 'Número inicial da OP'),
        ativa: body.ativa === undefined ? true : Boolean(body.ativa),
    };
}

function dadosVinculo(body) {
    const ativo = body.ativo === undefined ? true : Boolean(body.ativo);
    const dataDemissao = texto(body.data_demissao, 10);
    if (ativo && dataDemissao) throw erro(400, 'Um vínculo ativo não pode ter data de desligamento.');
    const tipos = normalizarTipos(body.tipos);
    const administrador = tipos.includes('administrador');
    const socio = tipos.some((tipo) => tipo === 'socio' || tipo === 'ex_socio');
    const prestador = !socio && (tipos.includes('prestador_externo') || Boolean(body.is_freelance));

    return {
        tipos,
        permissoes: administrador ? [] : normalizarPermissoes(body.permissoes),
        nivel: inteiroOpcional(body.nivel, 'Nível'),
        salario_fixo: socio || prestador ? 0 : numeroNaoNegativo(body.salario_fixo),
        valor_passagem_diaria: numeroNaoNegativo(body.valor_passagem_diaria),
        elegivel_pagamento: body.elegivel_pagamento === undefined
            ? true
            : Boolean(body.elegivel_pagamento),
        desconto_inss_percentual: prestador ? 0 : numeroNaoNegativo(body.desconto_inss_percentual, 9),
        desconto_vt_percentual: prestador ? 0 : numeroNaoNegativo(body.desconto_vt_percentual, 6),
        data_admissao: dataOpcional(
            body.data_admissao,
            socio ? 'Início da sociedade' : prestador ? 'Início da prestação de serviços' : 'Data de admissão'
        ),
        data_demissao: dataOpcional(dataDemissao, 'Data de desligamento'),
        is_freelance: prestador,
        ativo,
        empresa_principal: Boolean(body.empresa_principal),
    };
}

function dadosIdentidade(body) {
    const nome = texto(body.nome, 160);
    const nomeUsuario = texto(body.nome_usuario, 100);
    const email = texto(body.email, 160)?.toLowerCase();
    const senha = String(body.senha || '');
    if (!nome || !nomeUsuario || !email) {
        throw erro(400, 'Nome, usuário e e-mail são obrigatórios.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw erro(400, 'E-mail inválido.');
    }
    if (senha && senha.length < 6) {
        throw erro(400, 'A nova senha deve ter ao menos 6 caracteres.');
    }
    return {
        nome,
        nome_completo: texto(body.nome_completo, 200),
        nome_usuario: nomeUsuario,
        email,
        senha,
    };
}

async function atualizarIdentidade(client, usuarioId, identidade) {
    const senhaHash = identidade.senha
        ? await bcrypt.hash(identidade.senha, 10)
        : null;
    const result = await client.query(
        `UPDATE usuarios
         SET nome = $1,
             nome_completo = $2,
             nome_usuario = $3,
             email = $4,
             senha = CASE WHEN $5::text IS NULL THEN senha ELSE $5 END
         WHERE id = $6
         RETURNING id`,
        [
            identidade.nome,
            identidade.nome_completo,
            identidade.nome_usuario,
            identidade.email,
            senhaHash,
            usuarioId,
        ]
    );
    if (!result.rows[0]) throw erro(404, 'Pessoa não encontrada.');
}

async function buscarEmpresa(client, empresaId, { somenteAtiva = false } = {}) {
    const result = await client.query(
        `SELECT id, nome_fantasia, ativa, eh_legada
         FROM empresas
         WHERE id = $1
           AND ($2::boolean = FALSE OR ativa = TRUE)`,
        [empresaId, somenteAtiva]
    );
    if (!result.rows[0]) throw erro(404, 'Empresa não encontrada.');
    return result.rows[0];
}

async function sincronizarLegado(client, usuarioId, vinculo, empresa) {
    if (!empresa.eh_legada) return;
    await client.query(
        `UPDATE usuarios
         SET tipos = $1,
             permissoes = $2,
             nivel = $3,
             salario_fixo = $4,
             valor_passagem_diaria = $5,
             elegivel_pagamento = $6,
             desconto_inss_percentual = $7,
             desconto_vt_percentual = $8,
             data_admissao = $9,
             data_demissao = $10
         WHERE id = $11`,
        [
            vinculo.tipos,
            vinculo.permissoes,
            vinculo.nivel,
            vinculo.salario_fixo,
            vinculo.valor_passagem_diaria,
            vinculo.elegivel_pagamento,
            vinculo.desconto_inss_percentual,
            vinculo.desconto_vt_percentual,
            vinculo.data_admissao,
            vinculo.data_demissao,
            usuarioId,
        ]
    );
}

async function definirPrincipal(client, usuarioId, vinculoId, principal) {
    if (!principal) return;
    await client.query(
        `UPDATE usuarios_empresas
         SET empresa_principal = FALSE, atualizado_em = NOW()
         WHERE usuario_id = $1
           AND id <> $2
           AND empresa_principal = TRUE`,
        [usuarioId, vinculoId]
    );
}

router.use((req, res, next) => {
    if (!req.usuarioLogado?.id || !req.empresaId) {
        return res.status(401).json({ error: 'Sessão empresarial inválida.' });
    }
    next();
});

router.get('/empresas', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(
            `SELECT
                e.*,
                COUNT(ue.id) FILTER (
                    WHERE ue.ativo
                      AND COALESCE(u.arquivado, FALSE) = FALSE
                      AND COALESCE(u.is_test, FALSE) = FALSE
                )::integer AS total_membros,
                COUNT(ue.id) FILTER (
                    WHERE ue.ativo
                      AND COALESCE(u.arquivado, FALSE) = FALSE
                      AND COALESCE(u.is_test, FALSE) = FALSE
                      AND ue.tipos && ARRAY['administrador', 'supervisor', 'lider_setor']::text[]
                )::integer AS total_gestores
             FROM empresas e
             LEFT JOIN usuarios_empresas ue ON ue.empresa_id = e.id
             LEFT JOIN usuarios u ON u.id = ue.usuario_id
             GROUP BY e.id
             ORDER BY e.ativa DESC, e.eh_legada DESC, e.nome_fantasia ASC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error('[gestao-organizacional/empresas GET]', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao listar empresas.' });
    } finally {
        client?.release();
    }
});

router.post('/empresas', async (req, res) => {
    let client;
    try {
        const empresa = dadosEmpresa(req.body, { criacao: true });
        client = await pool.connect();
        await client.query('BEGIN');
        const codigoExistente = await client.query(
            'SELECT id FROM empresas WHERE codigo = $1 LIMIT 1',
            [empresa.codigo]
        );
        if (codigoExistente.rows[0]) {
            throw erro(409, `Já existe uma empresa com o código interno "${empresa.codigo}".`);
        }
        const result = await client.query(
            `INSERT INTO empresas (
                codigo, razao_social, nome_fantasia, cnpj, logo_url, cor_identificacao,
                telefone, email, cep, logradouro, numero_endereco, complemento, bairro,
                cidade, estado, timezone, prefixo_op, numero_inicial_op, ativa
             ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                $14, $15, $16, $17, $18, $19
             )
             RETURNING *`,
            [
                empresa.codigo, empresa.razao_social, empresa.nome_fantasia, empresa.cnpj,
                empresa.logo_url, empresa.cor_identificacao, empresa.telefone, empresa.email,
                empresa.cep, empresa.logradouro, empresa.numero_endereco, empresa.complemento,
                empresa.bairro, empresa.cidade, empresa.estado, empresa.timezone,
                empresa.prefixo_op, empresa.numero_inicial_op, empresa.ativa,
            ]
        );
        const criada = result.rows[0];
        await client.query(
            `INSERT INTO empresas_modulos (empresa_id, modulo_codigo, habilitado, habilitado_em)
             SELECT
                $1,
                codigo,
                codigo = 'gestao-organizacional' AND multiempresa_pronto,
                CASE
                    WHEN codigo = 'gestao-organizacional' AND multiempresa_pronto THEN NOW()
                    ELSE NULL
                END
             FROM modulos_sistema
             ON CONFLICT (empresa_id, modulo_codigo) DO NOTHING`,
            [criada.id]
        );
        await client.query('COMMIT');
        res.status(201).json(criada);
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('[gestao-organizacional/empresas POST]', error);
        const status = error.code === '23505' ? 409 : (error.statusCode || 500);
        res.status(status).json({
            error: error.code === '23505'
                ? (error.constraint === 'empresas_codigo_key'
                    ? 'Já existe uma empresa com esse código interno.'
                    : 'Já existe uma empresa com esse CNPJ.')
                : (error.message || 'Erro ao criar empresa.'),
        });
    } finally {
        client?.release();
    }
});

router.put('/empresas/:id', async (req, res) => {
    let client;
    try {
        const empresaId = inteiroPositivo(req.params.id, 'Empresa');
        const empresa = dadosEmpresa(req.body);
        client = await pool.connect();
        const atual = await buscarEmpresa(client, empresaId);
        if (atual.eh_legada && empresa.ativa === false) {
            throw erro(409, 'A empresa legada não pode ser desativada durante a migração.');
        }
        if (empresaId === req.empresaId && empresa.ativa === false) {
            throw erro(409, 'Troque de empresa antes de desativar a empresa ativa.');
        }
        const result = await client.query(
            `UPDATE empresas
             SET razao_social = $1,
                 nome_fantasia = $2,
                 cnpj = $3,
                 logo_url = $4,
                 cor_identificacao = $5,
                 telefone = $6,
                 email = $7,
                 cep = $8,
                 logradouro = $9,
                 numero_endereco = $10,
                 complemento = $11,
                 bairro = $12,
                 cidade = $13,
                 estado = $14,
                 timezone = $15,
                 prefixo_op = $16,
                 numero_inicial_op = $17,
                 ativa = $18,
                 atualizada_em = NOW()
             WHERE id = $19
             RETURNING *`,
            [
                empresa.razao_social, empresa.nome_fantasia, empresa.cnpj, empresa.logo_url,
                empresa.cor_identificacao, empresa.telefone, empresa.email, empresa.cep,
                empresa.logradouro, empresa.numero_endereco, empresa.complemento, empresa.bairro,
                empresa.cidade, empresa.estado, empresa.timezone, empresa.prefixo_op,
                empresa.numero_inicial_op, empresa.ativa, empresaId,
            ]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error('[gestao-organizacional/empresas PUT]', error);
        const status = error.code === '23505' ? 409 : (error.statusCode || 500);
        res.status(status).json({
            error: error.code === '23505'
                ? 'Já existe uma empresa com esse CNPJ.'
                : (error.message || 'Erro ao atualizar empresa.'),
        });
    } finally {
        client?.release();
    }
});

router.get('/pessoas', async (req, res) => {
    let client;
    try {
        const escopoGlobal = req.query.escopo === 'global';
        const busca = texto(req.query.busca, 120);
        client = await pool.connect();
        const result = await client.query(
            `WITH pessoas_escopo AS (
                SELECT DISTINCT u.id
                FROM usuarios u
                LEFT JOIN usuarios_empresas ue_escopo ON ue_escopo.usuario_id = u.id
                WHERE COALESCE(u.arquivado, FALSE) = FALSE
                  AND COALESCE(u.is_test, FALSE) = FALSE
                  AND ($1::boolean OR ue_escopo.empresa_id = $2)
                  AND (
                    $3::text IS NULL
                    OR LOWER(COALESCE(u.nome, '')) LIKE LOWER('%' || $3 || '%')
                    OR LOWER(COALESCE(u.nome_usuario, '')) LIKE LOWER('%' || $3 || '%')
                    OR LOWER(COALESCE(u.email, '')) LIKE LOWER('%' || $3 || '%')
                  )
             )
             SELECT
                u.id,
                u.nome,
                u.nome_completo,
                u.nome_usuario,
                u.email,
                u.avatar_url,
                u.foto_oficial,
                COALESCE(
                    jsonb_agg(
                        jsonb_build_object(
                            'id', ue.id,
                            'empresa_id', e.id,
                            'empresa_nome', e.nome_fantasia,
                            'empresa_codigo', e.codigo,
                            'empresa_cor', e.cor_identificacao,
                            'empresa_logo_url', e.logo_url,
                            'empresa_ativa', e.ativa,
                            'tipos', ue.tipos,
                            'permissoes', CASE
                                WHEN 'administrador' = ANY(ue.tipos) THEN ARRAY[]::text[]
                                ELSE ue.permissoes
                            END,
                            'nivel', ue.nivel,
                            'salario_fixo', ue.salario_fixo,
                            'valor_passagem_diaria', ue.valor_passagem_diaria,
                            'elegivel_pagamento', ue.elegivel_pagamento,
                            'desconto_inss_percentual', ue.desconto_inss_percentual,
                            'desconto_vt_percentual', ue.desconto_vt_percentual,
                            'data_admissao', ue.data_admissao,
                            'data_demissao', ue.data_demissao,
                            'is_freelance', ue.is_freelance,
                            'ativo', ue.ativo,
                            'empresa_principal', ue.empresa_principal
                        )
                        ORDER BY ue.empresa_principal DESC, ue.ativo DESC, e.nome_fantasia
                    ) FILTER (WHERE ue.id IS NOT NULL),
                    '[]'::jsonb
                ) AS vinculos
             FROM pessoas_escopo pe
             JOIN usuarios u ON u.id = pe.id
             LEFT JOIN usuarios_empresas ue ON ue.usuario_id = u.id
             LEFT JOIN empresas e ON e.id = ue.empresa_id
             GROUP BY u.id
             ORDER BY u.nome ASC`,
            [escopoGlobal, req.empresaId, busca]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('[gestao-organizacional/pessoas GET]', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao listar pessoas.' });
    } finally {
        client?.release();
    }
});

router.post('/pessoas', async (req, res) => {
    let client;
    try {
        const nome = texto(req.body.nome, 160);
        const nomeUsuario = texto(req.body.nome_usuario, 100);
        const email = texto(req.body.email, 160)?.toLowerCase();
        const senha = String(req.body.senha || '');
        const empresaId = inteiroPositivo(req.body.empresa_id || req.empresaId, 'Empresa');
        const vinculo = dadosVinculo(req.body.vinculo || {});
        if (!nome || !nomeUsuario || !email || senha.length < 6) {
            throw erro(400, 'Nome, usuário, e-mail e senha de ao menos 6 caracteres são obrigatórios.');
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw erro(400, 'E-mail inválido.');

        client = await pool.connect();
        await client.query('BEGIN');
        const empresa = await buscarEmpresa(client, empresaId, { somenteAtiva: true });
        const senhaHash = await bcrypt.hash(senha, 10);
        const pessoaResult = await client.query(
            `INSERT INTO usuarios (
                nome, nome_completo, nome_usuario, email, senha, tipos, permissoes,
                nivel, salario_fixo, valor_passagem_diaria, elegivel_pagamento,
                desconto_inss_percentual, desconto_vt_percentual, data_admissao, data_demissao
             ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
             )
             RETURNING id, nome, nome_completo, nome_usuario, email`,
            [
                nome, texto(req.body.nome_completo, 200), nomeUsuario, email, senhaHash,
                vinculo.tipos, vinculo.permissoes, vinculo.nivel, vinculo.salario_fixo,
                vinculo.valor_passagem_diaria, vinculo.elegivel_pagamento,
                vinculo.desconto_inss_percentual, vinculo.desconto_vt_percentual,
                vinculo.data_admissao, vinculo.data_demissao,
            ]
        );
        const pessoa = pessoaResult.rows[0];
        const vinculoResult = await client.query(
            `INSERT INTO usuarios_empresas (
                usuario_id, empresa_id, tipos, permissoes, nivel, salario_fixo,
                valor_passagem_diaria, elegivel_pagamento, desconto_inss_percentual,
                desconto_vt_percentual, data_admissao, data_demissao, is_freelance,
                ativo, empresa_principal
             ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, TRUE
             )
             RETURNING *`,
            [
                pessoa.id, empresaId, vinculo.tipos, vinculo.permissoes, vinculo.nivel,
                vinculo.salario_fixo, vinculo.valor_passagem_diaria,
                vinculo.elegivel_pagamento, vinculo.desconto_inss_percentual,
                vinculo.desconto_vt_percentual, vinculo.data_admissao,
                vinculo.data_demissao, vinculo.is_freelance, vinculo.ativo,
            ]
        );
        await sincronizarLegado(client, pessoa.id, vinculo, empresa);
        await client.query('COMMIT');
        res.status(201).json({ ...pessoa, vinculo: vinculoResult.rows[0] });
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('[gestao-organizacional/pessoas POST]', error);
        const status = error.code === '23505' ? 409 : (error.statusCode || 500);
        res.status(status).json({
            error: error.code === '23505'
                ? 'Nome de usuário ou e-mail já cadastrado.'
                : (error.message || 'Erro ao criar pessoa.'),
        });
    } finally {
        client?.release();
    }
});

router.put('/pessoas/:id', async (req, res) => {
    let client;
    try {
        const usuarioId = inteiroPositivo(req.params.id, 'Pessoa');
        const nome = texto(req.body.nome, 160);
        const nomeUsuario = texto(req.body.nome_usuario, 100);
        const email = texto(req.body.email, 160)?.toLowerCase();
        if (!nome || !nomeUsuario || !email) {
            throw erro(400, 'Nome, usuário e e-mail são obrigatórios.');
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw erro(400, 'E-mail inválido.');
        const senha = String(req.body.senha || '');
        if (senha && senha.length < 6) throw erro(400, 'A nova senha deve ter ao menos 6 caracteres.');
        client = await pool.connect();
        const senhaHash = senha ? await bcrypt.hash(senha, 10) : null;
        const result = await client.query(
            `UPDATE usuarios
             SET nome = $1,
                 nome_completo = $2,
                 nome_usuario = $3,
                 email = $4,
                 senha = CASE WHEN $5::text IS NULL THEN senha ELSE $5 END
             WHERE id = $6
             RETURNING id, nome, nome_completo, nome_usuario, email`,
            [nome, texto(req.body.nome_completo, 200), nomeUsuario, email, senhaHash, usuarioId]
        );
        if (!result.rows[0]) throw erro(404, 'Pessoa não encontrada.');
        res.json(result.rows[0]);
    } catch (error) {
        console.error('[gestao-organizacional/pessoas PUT]', error);
        const status = error.code === '23505' ? 409 : (error.statusCode || 500);
        res.status(status).json({
            error: error.code === '23505'
                ? 'Nome de usuário ou e-mail já cadastrado.'
                : (error.message || 'Erro ao atualizar pessoa.'),
        });
    } finally {
        client?.release();
    }
});

router.post('/pessoas/:id/vinculos', async (req, res) => {
    let client;
    try {
        const usuarioId = inteiroPositivo(req.params.id, 'Pessoa');
        const empresaId = inteiroPositivo(req.body.empresa_id, 'Empresa');
        const vinculo = dadosVinculo(req.body);
        client = await pool.connect();
        await client.query('BEGIN');
        const empresa = await buscarEmpresa(client, empresaId, { somenteAtiva: true });
        const pessoa = await client.query('SELECT id FROM usuarios WHERE id = $1', [usuarioId]);
        if (!pessoa.rows[0]) throw erro(404, 'Pessoa não encontrada.');
        const quantidade = await client.query(
            'SELECT COUNT(*)::integer AS total FROM usuarios_empresas WHERE usuario_id = $1',
            [usuarioId]
        );
        const principal = vinculo.empresa_principal || quantidade.rows[0].total === 0;
        if (principal) {
            await client.query(
                `UPDATE usuarios_empresas
                 SET empresa_principal = FALSE, atualizado_em = NOW()
                 WHERE usuario_id = $1
                   AND empresa_principal = TRUE`,
                [usuarioId]
            );
        }
        const result = await client.query(
            `INSERT INTO usuarios_empresas (
                usuario_id, empresa_id, tipos, permissoes, nivel, salario_fixo,
                valor_passagem_diaria, elegivel_pagamento, desconto_inss_percentual,
                desconto_vt_percentual, data_admissao, data_demissao, is_freelance,
                ativo, empresa_principal
             ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
             )
             RETURNING *`,
            [
                usuarioId, empresaId, vinculo.tipos, vinculo.permissoes, vinculo.nivel,
                vinculo.salario_fixo, vinculo.valor_passagem_diaria,
                vinculo.elegivel_pagamento, vinculo.desconto_inss_percentual,
                vinculo.desconto_vt_percentual, vinculo.data_admissao,
                vinculo.data_demissao, vinculo.is_freelance, vinculo.ativo, principal,
            ]
        );
        await sincronizarLegado(client, usuarioId, vinculo, empresa);
        await client.query('COMMIT');
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('[gestao-organizacional/vinculos POST]', error);
        const status = error.code === '23505' ? 409 : (error.statusCode || 500);
        res.status(status).json({
            error: error.code === '23505'
                ? 'Essa pessoa já possui vínculo com a empresa.'
                : (error.message || 'Erro ao criar vínculo.'),
        });
    } finally {
        client?.release();
    }
});

router.put('/vinculos/:id', async (req, res) => {
    let client;
    try {
        const vinculoId = inteiroPositivo(req.params.id, 'Vínculo');
        const vinculo = dadosVinculo(req.body);
        const identidade = req.body.pessoa ? dadosIdentidade(req.body.pessoa) : null;
        client = await pool.connect();
        await client.query('BEGIN');
        const atualResult = await client.query(
            `SELECT ue.usuario_id, ue.empresa_id, ue.empresa_principal, e.nome_fantasia, e.ativa, e.eh_legada
             FROM usuarios_empresas ue
             JOIN empresas e ON e.id = ue.empresa_id
             WHERE ue.id = $1
             FOR UPDATE`,
            [vinculoId]
        );
        const atual = atualResult.rows[0];
        if (!atual) throw erro(404, 'Vínculo não encontrado.');
        if (identidade) {
            await atualizarIdentidade(client, atual.usuario_id, identidade);
        }
        let vinculoPrincipalSubstitutoId = null;
        if (atual.empresa_principal && !vinculo.empresa_principal) {
            const substituto = await client.query(
                `SELECT id
                 FROM usuarios_empresas
                 WHERE usuario_id = $1
                   AND id <> $2
                   AND ativo = TRUE
                 ORDER BY criado_em ASC
                 LIMIT 1`,
                [atual.usuario_id, vinculoId]
            );
            if (substituto.rows[0]) {
                vinculoPrincipalSubstitutoId = substituto.rows[0].id;
            } else {
                vinculo.empresa_principal = true;
            }
        }
        await definirPrincipal(client, atual.usuario_id, vinculoId, vinculo.empresa_principal);
        const result = await client.query(
            `UPDATE usuarios_empresas
             SET tipos = $1,
                 permissoes = $2,
                 nivel = $3,
                 salario_fixo = $4,
                 valor_passagem_diaria = $5,
                 elegivel_pagamento = $6,
                 desconto_inss_percentual = $7,
                 desconto_vt_percentual = $8,
                 data_admissao = $9,
                 data_demissao = $10,
                 is_freelance = $11,
                 ativo = $12,
                 empresa_principal = $13,
                 atualizado_em = NOW()
             WHERE id = $14
             RETURNING *`,
            [
                vinculo.tipos, vinculo.permissoes, vinculo.nivel, vinculo.salario_fixo,
                vinculo.valor_passagem_diaria, vinculo.elegivel_pagamento,
                vinculo.desconto_inss_percentual, vinculo.desconto_vt_percentual,
                vinculo.data_admissao, vinculo.data_demissao, vinculo.is_freelance,
                vinculo.ativo, vinculo.empresa_principal, vinculoId,
            ]
        );
        if (vinculoPrincipalSubstitutoId) {
            await client.query(
                `UPDATE usuarios_empresas
                 SET empresa_principal = TRUE, atualizado_em = NOW()
                 WHERE id = $1`,
                [vinculoPrincipalSubstitutoId]
            );
        }
        await sincronizarLegado(client, atual.usuario_id, vinculo, atual);
        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('[gestao-organizacional/vinculos PUT]', error);
        const status = error.code === '23505' ? 409 : (error.statusCode || 500);
        res.status(status).json({
            error: error.code === '23505'
                ? 'Nome de usuário ou e-mail já cadastrado.'
                : (error.message || 'Erro ao atualizar vínculo.'),
        });
    } finally {
        client?.release();
    }
});

router.post('/vinculos/:id/encerrar', async (req, res) => {
    let client;
    try {
        const vinculoId = inteiroPositivo(req.params.id, 'Vínculo');
        client = await pool.connect();
        await client.query('BEGIN');
        const atualResult = await client.query(
            `SELECT
                ue.*,
                e.eh_legada,
                e.nome_fantasia,
                e.ativa AS empresa_ativa,
                (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date AS data_demissao_sistema,
                ue.data_admissao > (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date
                    AS admissao_posterior_demissao
             FROM usuarios_empresas ue
             JOIN empresas e ON e.id = ue.empresa_id
             WHERE ue.id = $1
             FOR UPDATE`,
            [vinculoId]
        );
        const atual = atualResult.rows[0];
        if (!atual) throw erro(404, 'Vínculo não encontrado.');
        if (!atual.ativo) throw erro(409, 'Esse vínculo já foi encerrado.');
        if (atual.usuario_id === req.usuarioLogado.id && atual.empresa_id === req.empresaId) {
            throw erro(409, 'Você não pode encerrar seu próprio vínculo com a empresa ativa.');
        }
        const socio = (atual.tipos || []).some((tipo) => tipo === 'socio' || tipo === 'ex_socio');
        const prestador = !socio && (
            (atual.tipos || []).includes('prestador_externo')
            || Boolean(atual.is_freelance)
        );
        if (atual.admissao_posterior_demissao) {
            throw erro(
                409,
                socio
                    ? 'O início da sociedade não pode ser posterior à data de saída da empresa.'
                    : prestador
                        ? 'O início da prestação de serviços não pode ser posterior ao encerramento da prestação.'
                        : 'A data de admissão não pode ser posterior à data da demissão.'
            );
        }
        const dataDemissao = atual.data_demissao_sistema;
        const result = await client.query(
            `UPDATE usuarios_empresas
             SET ativo = FALSE,
                 data_demissao = $1,
                 empresa_principal = FALSE,
                 atualizado_em = NOW()
             WHERE id = $2
             RETURNING *`,
            [dataDemissao, vinculoId]
        );
        if (atual.empresa_principal) {
            await client.query(
                `UPDATE usuarios_empresas
                 SET empresa_principal = TRUE, atualizado_em = NOW()
                 WHERE id = (
                    SELECT id
                    FROM usuarios_empresas
                    WHERE usuario_id = $1
                      AND ativo = TRUE
                      AND id <> $2
                    ORDER BY criado_em ASC
                    LIMIT 1
                 )`,
                [atual.usuario_id, vinculoId]
            );
        }
        await sincronizarLegado(client, atual.usuario_id, {
            ...atual,
            ativo: false,
            data_demissao: dataDemissao,
        }, { eh_legada: atual.eh_legada });
        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('[gestao-organizacional/vinculos encerrar]', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao encerrar vínculo.' });
    } finally {
        client?.release();
    }
});

export default router;
