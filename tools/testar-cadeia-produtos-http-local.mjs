import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.argv[2] || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_cadeia_produtos_test';
const jwtSecret = process.env.JWT_SECRET || 'segredo-local-teste-cadeia-produtos';
const pool = new Pool({ connectionString, max: 6 });
let server;
let empresaTesteId;
let produtoTesteId;
let demandaTesteId;
let actorId;
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
            Authorization: `Bearer ${token}`,
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
    return jwt.sign(
        {
            id: actorId,
            empresa_id: empresaId,
            superadministrador: false,
        },
        jwtSecret,
        { expiresIn: '1h' }
    );
}

try {
    const actor = (
        await pool.query(`
            SELECT u.id
            FROM usuarios u
            JOIN usuarios_empresas ue
              ON ue.usuario_id = u.id
             AND ue.empresa_id = 1
             AND ue.ativo
            WHERE 'administrador' = ANY(ue.tipos)
            ORDER BY u.id
            LIMIT 1
        `)
    ).rows[0];
    assert.ok(actor, 'A restauração local precisa de um administrador ativo na empresa legada.');
    actorId = actor.id;

    const flags = await pool.query(`
        SELECT codigo, multiempresa_pronto
        FROM modulos_sistema
        WHERE codigo IN ('produtos', 'ordens-producao')
    `);
    moduleFlags.push(...flags.rows);
    assert.equal(moduleFlags.length, 2, 'Os módulos Produtos e Ordens de Produção precisam existir no catálogo local.');

    const company = (
        await pool.query(`
            INSERT INTO empresas (codigo, razao_social, nome_fantasia, ativa, eh_legada)
            VALUES ($1, 'Empresa Teste Cadeia Produtos', 'Empresa Teste Cadeia Produtos', TRUE, FALSE)
            RETURNING id
        `, [`empresa-teste-cadeia-${Date.now()}`])
    ).rows[0];
    empresaTesteId = company.id;

    await pool.query(`
        INSERT INTO usuarios_empresas (
            usuario_id, empresa_id, tipos, permissoes, ativo, empresa_principal
        )
        VALUES ($1, $2, ARRAY['administrador'], '{}'::text[], TRUE, FALSE)
    `, [actorId, empresaTesteId]);

    await pool.query(`
        UPDATE modulos_sistema
           SET multiempresa_pronto = TRUE,
               atualizado_em = NOW()
         WHERE codigo IN ('produtos', 'ordens-producao')
    `);
    await pool.query(`
        INSERT INTO empresas_modulos (empresa_id, modulo_codigo, habilitado, habilitado_em, atualizado_em)
        SELECT $1, codigo, TRUE, NOW(), NOW()
        FROM modulos_sistema
        WHERE codigo IN ('produtos', 'ordens-producao')
    `, [empresaTesteId]);

    process.env.POSTGRES_URL = connectionString;
    process.env.JWT_SECRET = jwtSecret;
    const { default: app } = await import(`../api/index.js?cadeia-produtos=${Date.now()}`);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const tokenLegada = tokenParaEmpresa(1);
    const tokenSecundaria = tokenParaEmpresa(empresaTesteId);

    const produtosLegadaAntes = await request(baseUrl, '/produtos', { token: tokenLegada });
    assertStatus(produtosLegadaAntes, 200, 'listagem legada de produtos');
    assert.ok(produtosLegadaAntes.payload.some((produto) => produto.sku === 'SX-01000'));

    const nomeProduto = `Produto Isolado HTTP ${Date.now()}`;
    const produtoResponse = await request(baseUrl, '/produtos', {
        token: tokenSecundaria,
        method: 'POST',
        body: {
            empresa_id: 1,
            nome: nomeProduto,
            sku: `HTTP-${Date.now()}`,
            unidade: 'UN',
            estoque: 0,
            tipos: [],
            variacoes: [],
            estrutura: [],
            etapas: [],
            etapasTiktik: [],
            grade: [],
        },
    });
    assertStatus(produtoResponse, 201, 'criação de produto no contexto secundário');
    assert.equal(produtoResponse.payload.nome, nomeProduto);
    produtoTesteId = produtoResponse.payload.id;

    const produtosSecundaria = await request(baseUrl, '/produtos', { token: tokenSecundaria });
    assertStatus(produtosSecundaria, 200, 'listagem secundária de produtos');
    assert.ok(produtosSecundaria.payload.some((produto) => produto.id === produtoTesteId));
    assert.ok(!produtosSecundaria.payload.some((produto) => produto.sku === 'SX-01000'));

    const produtosLegadaDepois = await request(baseUrl, '/produtos', { token: tokenLegada });
    assertStatus(produtosLegadaDepois, 200, 'listagem legada após criação secundária');
    assert.ok(!produtosLegadaDepois.payload.some((produto) => produto.id === produtoTesteId));

    const skuTeste = produtoResponse.payload.sku;
    const demandaResponse = await request(baseUrl, '/demandas', {
        token: tokenSecundaria,
        method: 'POST',
        body: {
            empresa_id: 1,
            produto_sku: skuTeste,
            quantidade_solicitada: 7,
            observacoes: 'Ensaio de isolamento HTTP',
            prioridade: 1,
        },
    });
    assertStatus(demandaResponse, 201, 'criação de demanda no contexto secundário');
    assert.equal(demandaResponse.payload.empresa_id, empresaTesteId);
    assert.equal(demandaResponse.payload.produto_id, produtoTesteId);
    demandaTesteId = demandaResponse.payload.id;

    const demandasSecundaria = await request(baseUrl, '/demandas', { token: tokenSecundaria });
    assertStatus(demandasSecundaria, 200, 'listagem secundária de demandas');
    assert.ok(demandasSecundaria.payload.some((demanda) => demanda.id === demandaTesteId));

    const demandasLegada = await request(baseUrl, '/demandas', { token: tokenLegada });
    assertStatus(demandasLegada, 200, 'listagem legada após criação secundária');
    assert.ok(!demandasLegada.payload.some((demanda) => demanda.id === demandaTesteId));

    const tentativaAlterarDemandaDeOutraEmpresa = await request(
        baseUrl,
        `/demandas/${demandaTesteId}/quantidade`,
        {
            token: tokenLegada,
            method: 'PATCH',
            body: { nova_quantidade: 99 },
        }
    );
    assertStatus(tentativaAlterarDemandaDeOutraEmpresa, 404, 'alteração cruzada de demanda');

    const diagnosticoLegada = await request(baseUrl, '/demandas/diagnostico-completo', { token: tokenLegada });
    assertStatus(diagnosticoLegada, 200, 'diagnóstico produtivo legado');

    const diagnosticoSecundaria = await request(baseUrl, '/demandas/diagnostico-completo', { token: tokenSecundaria });
    assertStatus(diagnosticoSecundaria, 403, 'diagnóstico produtivo secundário');
    assert.equal(diagnosticoSecundaria.payload.codigo, 'CADEIA_PRODUTIVA_NAO_MIGRADA');

    const buscaArremateSecundaria = await request(baseUrl, '/produtos/search-arremate?q=HTTP');
    assertStatus(buscaArremateSecundaria, 401, 'busca de arremate sem autenticação');

    const buscaArremateComContexto = await request(baseUrl, '/produtos/search-arremate?q=HTTP', { token: tokenSecundaria });
    assertStatus(buscaArremateComContexto, 403, 'busca de arremate secundária');
    assert.equal(buscaArremateComContexto.payload.codigo, 'CADEIA_PRODUTIVA_NAO_MIGRADA');

    console.log(JSON.stringify({
        aprovado: true,
        banco: connectionString,
        empresaSecundariaTemporaria: empresaTesteId,
        verificacoes: {
            produtoBodyNaoTrocaEmpresa: true,
            produtosIsoladosPorEmpresa: true,
            demandaBodyNaoTrocaEmpresa: true,
            demandasIsoladasPorEmpresa: true,
            mutacaoCruzadaBloqueada: true,
            diagnosticoLegadoContinuaOperacional: true,
            cadeiaLegadaBloqueiaDiagnosticoSecundario: true,
            cadeiaLegadaBloqueiaBuscaArremateSecundaria: true,
        },
    }, null, 2));
} finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (empresaTesteId) {
        await pool.query(`DELETE FROM eventos_sistema WHERE dados_extras->>'empresa_id' = $1`, [String(empresaTesteId)]).catch(() => {});
        await pool.query('DELETE FROM demandas_componentes_atribuidos WHERE empresa_id = $1', [empresaTesteId]).catch(() => {});
        await pool.query('DELETE FROM demandas_producao WHERE empresa_id = $1', [empresaTesteId]).catch(() => {});
        await pool.query('DELETE FROM produtos WHERE empresa_id = $1', [empresaTesteId]).catch(() => {});
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
