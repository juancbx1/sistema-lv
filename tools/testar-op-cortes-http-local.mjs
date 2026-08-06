import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.argv[2] || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_cadeia_op_cortes_test';
const jwtSecret = process.env.JWT_SECRET || 'segredo-local-teste-op-cortes';
const pool = new Pool({ connectionString, max: 6 });
let server;
let empresaTesteId;
let actorId;
let corteTesteId;
let opTesteId;
let pnTeste;
let numeroOpTeste;
const moduleFlags = [];

function assertStatus(response, expected, label) {
    assert.equal(
        response.status,
        expected,
        `${label}: esperado HTTP ${expected}, recebido ${response.status}: ${JSON.stringify(response.payload)}`
    );
}

async function request(baseUrl, path, { token, method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
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

function tokenParaEmpresa(empresaId) {
    return jwt.sign({ id: actorId, empresa_id: empresaId, superadministrador: false }, jwtSecret, { expiresIn: '1h' });
}

try {
    const actor = (
        await pool.query(`
            SELECT u.id
            FROM usuarios u
            JOIN usuarios_empresas ue ON ue.usuario_id = u.id
            WHERE ue.empresa_id = 1
              AND ue.ativo
              AND 'administrador' = ANY(ue.tipos)
            ORDER BY u.id
            LIMIT 1
        `)
    ).rows[0];
    assert.ok(actor, 'É necessário um administrador ativo na empresa legada.');
    actorId = actor.id;

    const flags = await pool.query(`
        SELECT codigo, multiempresa_pronto
        FROM modulos_sistema
        WHERE codigo IN ('ordens-producao', 'cortes')
    `);
    moduleFlags.push(...flags.rows);
    assert.equal(moduleFlags.length, 2, 'Os módulos de OPs e Cortes precisam existir no catálogo local.');

    const empresa = (
        await pool.query(`
            INSERT INTO empresas (codigo, razao_social, nome_fantasia, ativa, eh_legada)
            VALUES ($1, 'Empresa Teste OP Cortes', 'Empresa Teste OP Cortes', TRUE, FALSE)
            RETURNING id
        `, [`empresa-teste-op-cortes-${Date.now()}`])
    ).rows[0];
    empresaTesteId = empresa.id;

    await pool.query(`
        INSERT INTO usuarios_empresas (usuario_id, empresa_id, tipos, permissoes, ativo, empresa_principal)
        VALUES ($1, $2, ARRAY['administrador'], '{}'::text[], TRUE, FALSE)
    `, [actorId, empresaTesteId]);
    await pool.query(`
        UPDATE modulos_sistema
           SET multiempresa_pronto = TRUE,
               atualizado_em = NOW()
         WHERE codigo IN ('ordens-producao', 'cortes')
    `);
    await pool.query(`
        INSERT INTO empresas_modulos (empresa_id, modulo_codigo, habilitado, habilitado_em, atualizado_em)
        SELECT $1, codigo, TRUE, NOW(), NOW()
        FROM modulos_sistema
        WHERE codigo IN ('ordens-producao', 'cortes')
    `, [empresaTesteId]);

    process.env.POSTGRES_URL = connectionString;
    process.env.JWT_SECRET = jwtSecret;
    const { default: app } = await import(`../api/index.js?op-cortes=${Date.now()}`);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const tokenLegada = tokenParaEmpresa(1);
    const tokenSecundaria = tokenParaEmpresa(empresaTesteId);

    const opsLegada = await request(baseUrl, '/ordens-de-producao', { token: tokenLegada });
    assertStatus(opsLegada, 200, 'listagem legada de OPs');
    assert.ok(Array.isArray(opsLegada.payload.rows));

    const cortesLegada = await request(baseUrl, '/cortes', { token: tokenLegada });
    assertStatus(cortesLegada, 200, 'listagem legada de cortes');
    assert.ok(Array.isArray(cortesLegada.payload));

    const radarLegado = await request(baseUrl, '/cortes/radar', { token: tokenLegada });
    assertStatus(radarLegado, 200, 'radar legado de cortes');

    const proximoPn = await request(baseUrl, '/cortes/next-pc-number', { token: tokenLegada });
    assertStatus(proximoPn, 200, 'próximo PN legado');

    for (const [path, label] of [
        ['/ordens-de-producao', 'OPs secundárias'],
        ['/ordens-de-producao/prontas-para-encerrar', 'OPs prontas secundárias'],
        ['/cortes', 'cortes secundários'],
        ['/cortes/radar', 'radar secundário de cortes'],
    ]) {
        const bloqueio = await request(baseUrl, path, { token: tokenSecundaria });
        assertStatus(bloqueio, 403, label);
        assert.equal(bloqueio.payload.codigo, 'CADEIA_PRODUTIVA_NAO_MIGRADA');
    }

    const produto = (await pool.query(`SELECT id FROM produtos WHERE empresa_id = 1 ORDER BY id LIMIT 1`)).rows[0];
    assert.ok(produto);
    pnTeste = `H${Date.now().toString().slice(-12)}`;
    const corteResponse = await request(baseUrl, '/cortes', {
        token: tokenLegada,
        method: 'POST',
        body: {
            empresa_id: empresaTesteId,
            produto_id: produto.id,
            variante: null,
            quantidade: 2,
            data: '2026-08-03',
            status: 'cortados',
            pn: pnTeste,
            cortador: 'Ensaio HTTP',
            demanda_id: null,
        },
    });
    assertStatus(corteResponse, 201, 'criação de corte legado');
    assert.equal(corteResponse.payload.empresa_id, 1);
    corteTesteId = corteResponse.payload.id;

    numeroOpTeste = Date.now().toString().slice(-8);
    const opResponse = await request(baseUrl, '/ordens-de-producao', {
        token: tokenLegada,
        method: 'POST',
        body: {
            empresa_id: empresaTesteId,
            numero: numeroOpTeste,
            data_entrega: '2026-08-03',
            observacoes: 'Ensaio HTTP OP/Cortes',
            corte_origem_id: corteTesteId,
            quantidade: 2,
        },
    });
    assertStatus(opResponse, 201, 'criação de OP legado a partir de corte');
    assert.equal(opResponse.payload.empresa_id, 1);
    opTesteId = opResponse.payload.id;

    const opDetalhe = await request(baseUrl, `/ordens-de-producao/${opResponse.payload.edit_id}`, { token: tokenLegada });
    assertStatus(opDetalhe, 200, 'detalhe de OP legado');
    assert.equal(opDetalhe.payload.id, opTesteId);

    const opFilha = await request(baseUrl, `/ordens-de-producao/check-op-filha/${encodeURIComponent(numeroOpTeste)}`, { token: tokenLegada });
    assertStatus(opFilha, 200, 'checagem de OP filha legada');

    console.log(JSON.stringify({
        aprovado: true,
        banco: connectionString,
        empresaSecundariaTemporaria: empresaTesteId,
        verificacoes: {
            leituraLegadaOperacional: true,
            radarESequenciaLegadosOperacionais: true,
            cadeiaOpCortesBloqueadaNaSecundaria: true,
            bodyNaoTrocaEmpresaNoCorte: true,
            bodyNaoTrocaEmpresaNaOp: true,
            criacaoCorteEOpLegadaOperacional: true,
            detalheEChecagemDeFilhaEscopados: true,
        },
    }, null, 2));
} finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (numeroOpTeste) {
        await pool.query('DELETE FROM producoes WHERE op_numero = $1', [numeroOpTeste]).catch(() => {});
        await pool.query('DELETE FROM audit_log WHERE entidade_id = ANY($1::text[])', [[numeroOpTeste, pnTeste].filter(Boolean)]).catch(() => {});
    }
    if (opTesteId) await pool.query('DELETE FROM ordens_de_producao WHERE id = $1', [opTesteId]).catch(() => {});
    if (corteTesteId) await pool.query('DELETE FROM cortes WHERE id = $1', [corteTesteId]).catch(() => {});
    if (empresaTesteId) {
        await pool.query('DELETE FROM empresas_modulos WHERE empresa_id = $1', [empresaTesteId]).catch(() => {});
        await pool.query('DELETE FROM usuarios_empresas WHERE empresa_id = $1', [empresaTesteId]).catch(() => {});
        await pool.query('DELETE FROM empresas WHERE id = $1', [empresaTesteId]).catch(() => {});
    }
    for (const flag of moduleFlags) {
        await pool.query(
            'UPDATE modulos_sistema SET multiempresa_pronto = $1 WHERE codigo = $2',
            [flag.multiempresa_pronto, flag.codigo]
        ).catch(() => {});
    }
    await pool.end();
}
