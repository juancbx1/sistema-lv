import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.argv[2];

if (!connectionString) {
    throw new Error('Informe a URL do PostgreSQL temporário.');
}

const jwtSecret = 'segredo-local-teste-contexto-empresa';
process.env.POSTGRES_URL = connectionString;
process.env.JWT_SECRET = jwtSecret;

const dbClient = new Client({ connectionString });
await dbClient.connect();

let server;

async function requisicao(baseUrl, caminho, { token, method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${caminho}`, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const texto = await response.text();
    let payload = null;
    if (texto) {
        try {
            payload = JSON.parse(texto);
        } catch {
            payload = texto;
        }
    }
    return { status: response.status, payload };
}

try {
    const usuario = (
        await dbClient.query(
            `
                SELECT id, nome, nome_usuario, tipos
                FROM usuarios
                ORDER BY id
                LIMIT 1
            `
        )
    ).rows[0];
    assert.ok(usuario);

    const empresaLegada = (
        await dbClient.query(
            `SELECT id FROM empresas WHERE codigo = 'lojas-variara'`
        )
    ).rows[0];
    assert.ok(empresaLegada);

    const empresaSecundaria = (
        await dbClient.query(
            `
                INSERT INTO empresas (
                    codigo,
                    razao_social,
                    nome_fantasia,
                    ativa,
                    eh_legada
                )
                VALUES (
                    'empresa-teste-contexto',
                    'Empresa Teste Contexto',
                    'Empresa Teste Contexto',
                    TRUE,
                    FALSE
                )
                RETURNING id
            `
        )
    ).rows[0];

    await dbClient.query(
        `
            INSERT INTO usuarios_empresas (
                usuario_id,
                empresa_id,
                tipos,
                permissoes,
                ativo,
                empresa_principal
            )
            VALUES ($1, $2, ARRAY['supervisor'], '{}'::text[], TRUE, FALSE)
        `,
        [usuario.id, empresaSecundaria.id]
    );

    const empresaSemVinculo = (
        await dbClient.query(
            `
                INSERT INTO empresas (
                    codigo,
                    razao_social,
                    nome_fantasia,
                    ativa,
                    eh_legada
                )
                VALUES (
                    'empresa-sem-vinculo',
                    'Empresa Sem Vinculo',
                    'Empresa Sem Vinculo',
                    TRUE,
                    FALSE
                )
                RETURNING id
            `
        )
    ).rows[0];

    const senhaTeste = 'senha-local-multiempresa';
    const senhaHash = await bcrypt.hash(senhaTeste, 4);
    const sufixoTeste = Date.now();
    const usuarioLogin = (
        await dbClient.query(
            `
                INSERT INTO usuarios (
                    nome,
                    nome_usuario,
                    email,
                    senha,
                    tipos,
                    permissoes,
                    nivel
                )
                VALUES (
                    'Usuário Login Multiempresa',
                    $1,
                    $2,
                    $3,
                    ARRAY['costureira'],
                    '{}'::text[],
                    1
                )
                RETURNING id, nome, nome_usuario
            `,
            [
                `teste_login_multiempresa_${sufixoTeste}`,
                `teste_login_multiempresa_${sufixoTeste}@local.invalid`,
                senhaHash,
            ]
        )
    ).rows[0];

    const vinculoLogin = (
        await dbClient.query(
            `
                INSERT INTO usuarios_empresas (
                    usuario_id,
                    empresa_id,
                    tipos,
                    permissoes,
                    ativo,
                    empresa_principal
                )
                VALUES ($1, $2, ARRAY['administrador'], '{}'::text[], TRUE, TRUE)
                RETURNING id
            `,
            [usuarioLogin.id, empresaLegada.id]
        )
    ).rows[0];

    await dbClient.query(
        `
            INSERT INTO usuarios_empresas (
                usuario_id,
                empresa_id,
                tipos,
                permissoes,
                ativo,
                empresa_principal
            )
            VALUES ($1, $2, ARRAY['supervisor'], '{}'::text[], TRUE, FALSE)
        `,
        [usuarioLogin.id, empresaSecundaria.id]
    );

    const usuarioImpersonado = (
        await dbClient.query(
            `
                INSERT INTO usuarios (
                    nome,
                    nome_usuario,
                    email,
                    senha,
                    tipos,
                    permissoes,
                    nivel
                )
                VALUES (
                    'Usuário Impersonado Multiempresa',
                    $1,
                    $2,
                    $3,
                    ARRAY['supervisor'],
                    '{}'::text[],
                    1
                )
                RETURNING id
            `,
            [
                `teste_impersonado_${sufixoTeste}`,
                `teste_impersonado_${sufixoTeste}@local.invalid`,
                senhaHash,
            ]
        )
    ).rows[0];

    const vinculoImpersonado = (
        await dbClient.query(
            `
                INSERT INTO usuarios_empresas (
                    usuario_id,
                    empresa_id,
                    tipos,
                    permissoes,
                    ativo,
                    empresa_principal
                )
                VALUES ($1, $2, ARRAY['costureira'], '{}'::text[], TRUE, TRUE)
                RETURNING id
            `,
            [usuarioImpersonado.id, empresaLegada.id]
        )
    ).rows[0];

    const usuarioSemEmpresa = (
        await dbClient.query(
            `
                INSERT INTO usuarios (
                    nome,
                    nome_usuario,
                    email,
                    senha,
                    tipos,
                    permissoes,
                    nivel
                )
                VALUES (
                    'Usuário Sem Empresa',
                    $1,
                    $2,
                    $3,
                    ARRAY['costureira'],
                    '{}'::text[],
                    1
                )
                RETURNING id, nome_usuario
            `,
            [
                `teste_sem_empresa_${sufixoTeste}`,
                `teste_sem_empresa_${sufixoTeste}@local.invalid`,
                senhaHash,
            ]
        )
    ).rows[0];

    const usuarioDesligado = (
        await dbClient.query(
            `
                INSERT INTO usuarios (
                    nome,
                    nome_usuario,
                    email,
                    senha,
                    tipos,
                    permissoes,
                    nivel
                )
                VALUES (
                    'Usuário Desligado',
                    $1,
                    $2,
                    $3,
                    ARRAY['costureira'],
                    '{}'::text[],
                    1
                )
                RETURNING id, nome_usuario
            `,
            [
                `teste_desligado_${sufixoTeste}`,
                `teste_desligado_${sufixoTeste}@local.invalid`,
                senhaHash,
            ]
        )
    ).rows[0];

    await dbClient.query(
        `
            INSERT INTO usuarios_empresas (
                usuario_id,
                empresa_id,
                tipos,
                permissoes,
                data_admissao,
                data_demissao,
                ativo,
                empresa_principal
            )
            VALUES (
                $1,
                $2,
                ARRAY['costureira'],
                '{}'::text[],
                CURRENT_DATE - 30,
                CURRENT_DATE - 1,
                FALSE,
                TRUE
            )
        `,
        [usuarioDesligado.id, empresaLegada.id]
    );

    let baseUrl = process.env.TEST_BASE_URL;
    if (!baseUrl) {
        const { default: app } = await import(`../api/index.js?teste=${Date.now()}`);
        server = app.listen(0, '127.0.0.1');
        await new Promise((resolve, reject) => {
            server.once('listening', resolve);
            server.once('error', reject);
        });

        const endereco = server.address();
        baseUrl = `http://127.0.0.1:${endereco.port}`;
    }
    const tokenLegado = jwt.sign(
        {
            id: usuario.id,
            nome: usuario.nome,
            nome_usuario: usuario.nome_usuario,
            tipos: usuario.tipos || [],
        },
        jwtSecret,
        { expiresIn: '1h' }
    );

    const login = await requisicao(baseUrl, '/login', {
        method: 'POST',
        body: {
            nomeUsuario: usuarioLogin.nome_usuario,
            senha: senhaTeste,
            manterConectado: false,
        },
    });
    assert.equal(login.status, 200);
    const claimsLogin = jwt.verify(login.payload.token, jwtSecret);
    assert.equal(claimsLogin.empresa_id, empresaLegada.id);
    assert.equal(claimsLogin.vinculo_empresa_id, vinculoLogin.id);
    assert.deepEqual(claimsLogin.tipos, ['administrador']);
    assert.ok(claimsLogin.exp - claimsLogin.iat >= 30 * 24 * 60 * 60 - 1);
    assert.equal(login.payload.empresaAtiva.codigo, 'lojas-variara');

    const loginLongo = await requisicao(baseUrl, '/login', {
        method: 'POST',
        body: {
            nomeUsuario: usuarioLogin.nome_usuario,
            senha: senhaTeste,
            manterConectado: true,
        },
    });
    assert.equal(loginLongo.status, 200);
    const claimsLoginLongo = jwt.verify(loginLongo.payload.token, jwtSecret);
    assert.ok(claimsLoginLongo.exp - claimsLoginLongo.iat >= 30 * 24 * 60 * 60 - 1);

    const perfilContextual = await requisicao(baseUrl, '/usuarios/me', {
        token: login.payload.token,
    });
    assert.equal(perfilContextual.status, 200);
    assert.equal(perfilContextual.payload.empresa_id, empresaLegada.id);
    assert.equal(perfilContextual.payload.vinculo_empresa_id, vinculoLogin.id);
    assert.equal(perfilContextual.payload.empresa_ativa.codigo, 'lojas-variara');
    assert.deepEqual(perfilContextual.payload.tipos, ['administrador']);

    const impersonacao = await requisicao(
        baseUrl,
        `/usuarios/${usuarioImpersonado.id}/impersonar`,
        {
            token: login.payload.token,
            method: 'POST',
        }
    );
    assert.equal(impersonacao.status, 200);
    const claimsImpersonacao = jwt.verify(impersonacao.payload.token, jwtSecret);
    assert.equal(claimsImpersonacao.empresa_id, empresaLegada.id);
    assert.equal(
        claimsImpersonacao.vinculo_empresa_id,
        vinculoImpersonado.id
    );
    assert.deepEqual(claimsImpersonacao.tipos, ['costureira']);
    assert.equal(claimsImpersonacao.impersonadoPor, usuarioLogin.id);

    const loginSemEmpresa = await requisicao(baseUrl, '/login', {
        method: 'POST',
        body: {
            nomeUsuario: usuarioSemEmpresa.nome_usuario,
            senha: senhaTeste,
            manterConectado: false,
        },
    });
    assert.equal(loginSemEmpresa.status, 403);
    assert.equal(loginSemEmpresa.payload.error, 'SEM_EMPRESA_ATIVA');

    const loginDesligado = await requisicao(baseUrl, '/login', {
        method: 'POST',
        body: {
            nomeUsuario: usuarioDesligado.nome_usuario,
            senha: senhaTeste,
            manterConectado: false,
        },
    });
    assert.equal(loginDesligado.status, 403);
    assert.equal(loginDesligado.payload.error, 'CONTRATO_ENCERRADO');

    const semToken = await requisicao(baseUrl, '/contexto-empresa');
    assert.equal(semToken.status, 401);
    assert.equal(semToken.payload.codigo, 'AUTENTICACAO_OBRIGATORIA');

    const contextoLegado = await requisicao(baseUrl, '/contexto-empresa', {
        token: tokenLegado,
    });
    assert.equal(contextoLegado.status, 200);
    assert.equal(contextoLegado.payload.empresaAtiva.codigo, 'lojas-variara');
    assert.equal(contextoLegado.payload.tokenLegado, true);
    assert.equal(contextoLegado.payload.empresas.length, 2);

    const trocaLegada = await requisicao(baseUrl, '/contexto-empresa/trocar', {
        token: tokenLegado,
        method: 'POST',
        body: { empresaId: empresaLegada.id },
    });
    assert.equal(trocaLegada.status, 200);
    const claimsLegada = jwt.verify(trocaLegada.payload.token, jwtSecret);
    assert.equal(claimsLegada.empresa_id, empresaLegada.id);
    assert.ok(claimsLegada.vinculo_empresa_id);

    const trocaSecundaria = await requisicao(baseUrl, '/contexto-empresa/trocar', {
        token: trocaLegada.payload.token,
        method: 'POST',
        body: { empresaId: empresaSecundaria.id },
    });
    assert.equal(trocaSecundaria.status, 200);
    const tokenSecundaria = trocaSecundaria.payload.token;
    const claimsSecundaria = jwt.verify(tokenSecundaria, jwtSecret);
    assert.equal(claimsSecundaria.empresa_id, empresaSecundaria.id);
    assert.deepEqual(claimsSecundaria.tipos, ['supervisor']);
    assert.ok(claimsSecundaria.exp <= claimsLegada.exp);
    assert.ok(claimsSecundaria.exp >= claimsLegada.exp - 2);

    const contextoSecundaria = await requisicao(baseUrl, '/contexto-empresa', {
        token: tokenSecundaria,
    });
    assert.equal(contextoSecundaria.status, 200);
    assert.equal(
        contextoSecundaria.payload.empresaAtiva.codigo,
        'empresa-teste-contexto'
    );

    const perfilSecundaria = await requisicao(baseUrl, '/usuarios/me', {
        token: tokenSecundaria,
    });
    assert.equal(perfilSecundaria.status, 200);
    assert.equal(perfilSecundaria.payload.empresa_id, empresaSecundaria.id);
    assert.deepEqual(perfilSecundaria.payload.tipos, ['supervisor']);

    const financeiroBloqueado = await requisicao(baseUrl, '/financeiro', {
        token: tokenSecundaria,
    });
    assert.equal(financeiroBloqueado.status, 403);
    assert.equal(
        financeiroBloqueado.payload.codigo,
        'MODULO_NAO_DISPONIVEL_EMPRESA'
    );

    const rotaFuturaBloqueada = await requisicao(baseUrl, '/rota-futura', {
        token: tokenSecundaria,
    });
    assert.equal(rotaFuturaBloqueada.status, 403);
    assert.equal(
        rotaFuturaBloqueada.payload.codigo,
        'MODULO_NAO_DISPONIVEL_EMPRESA'
    );

    const rotaFuturaLegada = await requisicao(baseUrl, '/rota-futura', {
        token: trocaLegada.payload.token,
    });
    assert.equal(rotaFuturaLegada.status, 404);

    const trocaSemVinculo = await requisicao(baseUrl, '/contexto-empresa/trocar', {
        token: trocaLegada.payload.token,
        method: 'POST',
        body: { empresaId: empresaSemVinculo.id },
    });
    assert.equal(trocaSemVinculo.status, 403);
    assert.equal(trocaSemVinculo.payload.codigo, 'EMPRESA_NAO_AUTORIZADA');

    const tokenInvalido = await requisicao(baseUrl, '/contexto-empresa', {
        token: 'token-invalido',
    });
    assert.equal(tokenInvalido.status, 401);
    assert.equal(tokenInvalido.payload.codigo, 'TOKEN_INVALIDO');

    console.log(JSON.stringify({
        passed: true,
        checks: {
            tokenLegadoCompativel: true,
            loginEmiteJwtContextual: true,
            loginUsaTiposDoVinculo: true,
            loginMultiplasEmpresasUsaPrincipal: true,
            loginSemprePreservaTrintaDias: true,
            usuarioSemEmpresaBloqueado: true,
            desligamentoDoVinculoPreservaDespedida: true,
            perfilMeContextual: true,
            empresaPrincipalResolvida: true,
            trocaEmpresaEmiteNovoJwt: true,
            trocaEmpresaNaoProlongaSessao: true,
            tiposSaoDoVinculo: true,
            impersonacaoRespeitaEmpresa: true,
            empresaSemVinculoBloqueada: true,
            moduloNaoMigradoBloqueado: true,
            rotaNovaFalhaFechada: true,
            empresaLegadaMantemCompatibilidade: true,
            tokenInvalidoBloqueado: true,
        },
    }, null, 2));
} finally {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    await dbClient.end();
}
