import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Client } = pg;
const [baseUrl, connectionString, jwtSecret] = process.argv.slice(2);

if (!baseUrl || !connectionString || !jwtSecret) {
    throw new Error('Informe base URL, URL do PostgreSQL temporário e JWT secret.');
}

const dbClient = new Client({ connectionString });
await dbClient.connect();

async function chamar(caminho, token) {
    const response = await fetch(`${baseUrl}${caminho}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
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
    return {
        status: response.status,
        payload,
    };
}

try {
    const usuario = (
        await dbClient.query(
            `SELECT id FROM usuarios ORDER BY id LIMIT 1`
        )
    ).rows[0];
    const empresaSecundaria = (
        await dbClient.query(
            `SELECT id FROM empresas WHERE codigo = 'empresa-teste-contexto'`
        )
    ).rows[0];

    assert.ok(usuario);
    assert.ok(empresaSecundaria);

    const tokenLegado = jwt.sign(
        { id: usuario.id },
        jwtSecret,
        { expiresIn: '1h' }
    );
    const tokenSecundaria = jwt.sign(
        { id: usuario.id, empresa_id: empresaSecundaria.id },
        jwtSecret,
        { expiresIn: '1h' }
    );

    const ping = await chamar('/api/ping');
    assert.equal(ping.status, 200);

    const contexto = await chamar('/api/contexto-empresa', tokenLegado);
    assert.equal(contexto.status, 200);
    assert.equal(contexto.payload.empresaAtiva.codigo, 'lojas-variara');
    assert.equal(contexto.payload.tokenLegado, true);

    const financeiroSecundaria = await chamar('/api/financeiro', tokenSecundaria);
    assert.equal(financeiroSecundaria.status, 403);
    assert.equal(
        financeiroSecundaria.payload.codigo,
        'MODULO_NAO_DISPONIVEL_EMPRESA'
    );

    const rotaFuturaLegada = await chamar('/api/rota-futura', tokenLegado);
    assert.equal(rotaFuturaLegada.status, 404);

    console.log(JSON.stringify({
        passed: true,
        checks: {
            serverJsAtivo: true,
            tokenLegadoResolveEmpresaPrincipal: true,
            empresaSecundariaBloqueada: true,
            empresaLegadaMantemCompatibilidade: true,
        },
    }, null, 2));
} finally {
    await dbClient.end();
}
