import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.argv[2];
if (!connectionString || !/^postgresql:\/\/(postgres@)?(127\.0\.0\.1|localhost):\d+\//.test(connectionString)) {
    throw new Error('O smoke aceita somente uma URL PostgreSQL local explícita.');
}

const jwtSecret = process.env.JWT_SECRET || 'segredo-local-teste-cadeia-producao';
const pool = new Pool({ connectionString, max: 8 });
let server;
let actorId;
let empresaTesteId;
const flagsOriginais = [];

const rotasDashboard = [
    '/dashboard/desempenho',
    '/dashboard/atividades',
    '/dashboard/minha-tabela-pontos',
    '/dashboard/ranking-semana',
    '/dashboard/ranking-semana?semana=anterior',
    '/dashboard/streak',
    '/dashboard/conquistas-ciclo',
];

function tokenParaEmpresa(empresaId) {
    return jwt.sign(
        { id: actorId, empresa_id: empresaId, superadministrador: false },
        jwtSecret,
        { expiresIn: '1h' },
    );
}

async function request(baseUrl, path, token) {
    const response = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }
    return { status: response.status, payload };
}

function assertStatus(response, expected, label) {
    assert.equal(
        response.status,
        expected,
        `${label}: esperado HTTP ${expected}, recebido ${response.status}: ${JSON.stringify(response.payload)}`,
    );
}

try {
    const actor = (await pool.query(`
        SELECT u.id
        FROM usuarios u
        JOIN usuarios_empresas ue
          ON ue.usuario_id = u.id
         AND ue.empresa_id = 1
         AND ue.ativo
        WHERE 'administrador' = ANY(ue.tipos)
        ORDER BY u.id
        LIMIT 1
    `)).rows[0];
    assert.ok(actor, 'Administrador ativo na empresa legada é obrigatório.');
    actorId = actor.id;

    const modulos = (await pool.query(
        `SELECT codigo, multiempresa_pronto FROM modulos_sistema WHERE codigo = ANY($1::text[]) ORDER BY codigo`,
        [['dashboard', 'producao-geral']],
    )).rows;
    assert.equal(modulos.length, 2, 'Módulos dashboard/produção-geral ausentes no catálogo local.');
    flagsOriginais.push(...modulos);
    await pool.query(
        `UPDATE modulos_sistema SET multiempresa_pronto = TRUE, atualizado_em = NOW() WHERE codigo = ANY($1::text[])`,
        [['dashboard', 'producao-geral']],
    );

    const empresa = (await pool.query(`
        INSERT INTO empresas (codigo, razao_social, nome_fantasia, ativa, eh_legada)
        VALUES ($1, 'Empresa Smoke Dashboard', 'Empresa Smoke Dashboard', TRUE, FALSE)
        RETURNING id
    `, [`empresa-smoke-dashboard-${Date.now()}`])).rows[0];
    empresaTesteId = empresa.id;

    await pool.query(`
        INSERT INTO usuarios_empresas (usuario_id, empresa_id, tipos, permissoes, ativo, empresa_principal)
        VALUES ($1, $2, ARRAY['administrador'], '{}'::text[], TRUE, FALSE)
    `, [actorId, empresaTesteId]);
    await pool.query(`
        INSERT INTO empresas_modulos (empresa_id, modulo_codigo, habilitado, habilitado_em, atualizado_em)
        VALUES ($1, 'dashboard', TRUE, NOW(), NOW()),
               ($1, 'producao-geral', TRUE, NOW(), NOW())
    `, [empresaTesteId]);

    process.env.POSTGRES_URL = connectionString;
    process.env.JWT_SECRET = jwtSecret;
    const { default: app } = await import(`../api/index.js?dashboard-consumers=${Date.now()}`);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const tokenLegada = tokenParaEmpresa(1);
    const tokenSecundaria = tokenParaEmpresa(empresaTesteId);

    for (const rota of rotasDashboard) {
        const legado = await request(baseUrl, rota, tokenLegada);
        assertStatus(legado, 200, `${rota} legado`);

        const secundario = await request(baseUrl, rota, tokenSecundaria);
        assertStatus(secundario, 403, `${rota} secundário`);
        assert.equal(secundario.payload?.codigo, 'CADEIA_PRODUTIVA_NAO_MIGRADA', `${rota} secundário`);
    }

    for (const rota of [
        `/real-producao/diaria?data=${new Date().toISOString().slice(0, 10)}`,
        `/real-producao/desempenho-historico?funcionarioId=${actorId}`,
    ]) {
        const legado = await request(baseUrl, rota, tokenLegada);
        assertStatus(legado, 200, `${rota} legado`);

        const secundario = await request(baseUrl, rota, tokenSecundaria);
        assertStatus(secundario, 403, `${rota} secundário`);
        assert.equal(secundario.payload?.codigo, 'CADEIA_PRODUTIVA_NAO_MIGRADA', `${rota} secundário`);
    }

    console.log(JSON.stringify({
        aprovado: true,
        banco: connectionString,
        verificacoes: {
            dashboardLegadoSemVazamentoDeContexto: true,
            dashboardSecundarioFalhaFechado: true,
            relatoriosProducaoLegado: true,
            relatoriosProducaoSecundarioFalhaFechado: true,
        },
    }, null, 2));
} finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (empresaTesteId) {
        await pool.query('DELETE FROM empresas_modulos WHERE empresa_id = $1', [empresaTesteId]);
        await pool.query('DELETE FROM usuarios_empresas WHERE empresa_id = $1', [empresaTesteId]);
        await pool.query('DELETE FROM empresas WHERE id = $1', [empresaTesteId]);
    }
    for (const flag of flagsOriginais) {
        await pool.query(
            `UPDATE modulos_sistema SET multiempresa_pronto = $1, atualizado_em = NOW() WHERE codigo = $2`,
            [flag.multiempresa_pronto, flag.codigo],
        );
    }
    await pool.end();
}
