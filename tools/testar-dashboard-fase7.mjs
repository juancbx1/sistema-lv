import assert from 'node:assert/strict';
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const baseUrl = process.env.FASE7_API_URL || 'http://127.0.0.1:3017/api';
const connectionString =
    process.env.FASE7_POSTGRES_URL
    || 'postgresql://postgres@127.0.0.1:55437/sistema_lv_fase7';
const banco = new URL(connectionString);

if (
    !['127.0.0.1', 'localhost'].includes(banco.hostname)
    || banco.port !== '55437'
    || banco.pathname !== '/sistema_lv_fase7'
) {
    throw new Error(
        'Teste recusado: use exclusivamente a restauração local sistema_lv_fase7 na porta 55437.'
    );
}
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET não configurado.');

const pool = new Pool({ connectionString });
const resultados = [];
let estadosModulos = [];

function registrar(nome) {
    resultados.push(nome);
}

async function requisicao(caminho, { token, method = 'GET' } = {}) {
    const resposta = await fetch(`${baseUrl}${caminho}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
    });
    const texto = await resposta.text();
    let payload;
    try {
        payload = texto ? JSON.parse(texto) : null;
    } catch {
        payload = texto;
    }
    return { status: resposta.status, payload };
}

async function tokenEmpresa(dbClient, empresaId) {
    const { rows } = await dbClient.query(`
        SELECT u.id, u.nome, u.nome_usuario, ue.id AS vinculo_empresa_id, ue.tipos
        FROM usuarios u
        JOIN usuarios_empresas ue ON ue.usuario_id = u.id
        WHERE u.id = 2
          AND ue.empresa_id = $1
          AND ue.ativo = TRUE
    `, [empresaId]);
    assert.equal(rows.length, 1);
    return jwt.sign({
        id: rows[0].id,
        nome: rows[0].nome,
        nome_usuario: rows[0].nome_usuario,
        tipos: rows[0].tipos,
        empresa_id: empresaId,
        vinculo_empresa_id: rows[0].vinculo_empresa_id,
    }, process.env.JWT_SECRET, { expiresIn: '30m' });
}

async function executar() {
    const dbClient = await pool.connect();
    try {
        const bancoResult = await dbClient.query(`
            SELECT current_database() AS banco, inet_server_addr()::text AS host,
                   inet_server_port() AS porta
        `);
        assert.equal(bancoResult.rows[0].banco, 'sistema_lv_fase7');
        assert.match(bancoResult.rows[0].host, /^127\.0\.0\.1(?:\/32)?$/);
        assert.equal(bancoResult.rows[0].porta, 55437);

        const codigos = ['dashboard', 'arremates', 'gerenciar-producao'];
        const modulosResult = await dbClient.query(`
            SELECT ms.codigo, ms.multiempresa_pronto, em.habilitado
            FROM modulos_sistema ms
            JOIN empresas_modulos em
              ON em.modulo_codigo = ms.codigo
             AND em.empresa_id = 2
            WHERE ms.codigo = ANY($1::text[])
            ORDER BY ms.codigo
        `, [codigos]);
        assert.equal(modulosResult.rows.length, codigos.length);
        estadosModulos = modulosResult.rows;

        await dbClient.query(`
            UPDATE modulos_sistema
               SET multiempresa_pronto = TRUE
             WHERE codigo = ANY($1::text[])
        `, [codigos]);
        await dbClient.query(`
            UPDATE empresas_modulos
               SET habilitado = TRUE
             WHERE empresa_id = 2
               AND modulo_codigo = ANY($1::text[])
        `, [codigos]);

        const tokenLojas = await tokenEmpresa(dbClient, 1);
        const tokenNeila = await tokenEmpresa(dbClient, 2);

        const desempenhoLegado = await requisicao('/dashboard/desempenho', {
            token: tokenLojas,
        });
        assert.equal(
            desempenhoLegado.status,
            200,
            JSON.stringify(desempenhoLegado.payload)
        );
        registrar('dashboard legada continua disponível');

        for (const caminho of [
            '/dashboard/desempenho',
            '/dashboard/streak',
            '/dashboard/atividades',
            '/producao/meu-status',
            '/arremates/status-tiktiks',
        ]) {
            const bloqueio = await requisicao(caminho, { token: tokenNeila });
            assert.equal(bloqueio.status, 403, `${caminho}: ${JSON.stringify(bloqueio.payload)}`);
            assert.equal(
                bloqueio.payload?.codigo,
                'CADEIA_PRODUTIVA_NAO_MIGRADA',
                `${caminho}: ${JSON.stringify(bloqueio.payload)}`
            );
            registrar(`${caminho} bloqueada na empresa secundária`);
        }

        process.stdout.write(`${JSON.stringify({
            aprovado: true,
            banco: 'sistema_lv_fase7@127.0.0.1:55437',
            cenarios: resultados.length,
            resultados,
        }, null, 2)}\n`);
    } finally {
        for (const estado of estadosModulos) {
            await dbClient.query(`
                UPDATE modulos_sistema
                   SET multiempresa_pronto = $1
                 WHERE codigo = $2
            `, [estado.multiempresa_pronto, estado.codigo]);
            await dbClient.query(`
                UPDATE empresas_modulos
                   SET habilitado = $1
                 WHERE empresa_id = 2
                   AND modulo_codigo = $2
            `, [estado.habilitado, estado.codigo]);
        }
        dbClient.release();
        await pool.end();
    }
}

executar().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
