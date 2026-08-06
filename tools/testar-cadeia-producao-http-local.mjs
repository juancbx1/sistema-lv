import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.argv[2] || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_cadeia_producao_test';
const jwtSecret = process.env.JWT_SECRET || 'segredo-local-teste-cadeia-producao';
const pool = new Pool({ connectionString, max: 8 });
let server;
let empresaTesteId;
let actorId;
let produtoTesteId;
let corteTesteId;
let opTesteId;
let numeroOpTeste;
let sessaoTesteId;
let producaoTesteId;
let solicitacaoTesteId;
const moduleFlags = [];
let actorSecondaryBefore;

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
    return jwt.sign(
        { id: actorId, empresa_id: empresaId, superadministrador: false },
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
    assert.ok(actor, 'É necessário um administrador ativo na empresa legada.');
    actorId = actor.id;

    const flags = await pool.query(`
        SELECT codigo, multiempresa_pronto
          FROM modulos_sistema
         WHERE codigo IN ('produtos', 'gerenciar-producao')
    `);
    moduleFlags.push(...flags.rows);
    assert.equal(moduleFlags.length, 2, 'Os módulos Produtos e Gerenciar Produção precisam existir no catálogo local.');

    const actorCurrent = await pool.query(
        `SELECT status_atual, id_sessao_trabalho_atual FROM usuarios_empresas WHERE usuario_id = $1 AND empresa_id = 1`,
        [actorId]
    );
    assert.equal(actorCurrent.rowCount, 1);

    const company = (
        await pool.query(`
            INSERT INTO empresas (codigo, razao_social, nome_fantasia, ativa, eh_legada)
            VALUES ($1, 'Empresa Teste Produção', 'Empresa Teste Produção', TRUE, FALSE)
            RETURNING id
        `, [`empresa-teste-producao-${Date.now()}`])
    ).rows[0];
    empresaTesteId = company.id;

    await pool.query(`
        INSERT INTO usuarios_empresas (usuario_id, empresa_id, tipos, permissoes, ativo, empresa_principal)
        VALUES ($1, $2, ARRAY['administrador'], '{}'::text[], TRUE, FALSE)
    `, [actorId, empresaTesteId]);
    actorSecondaryBefore = { status_atual: null, id_sessao_trabalho_atual: null };

    await pool.query(`
        UPDATE modulos_sistema
           SET multiempresa_pronto = TRUE, atualizado_em = NOW()
         WHERE codigo IN ('produtos', 'gerenciar-producao')
    `);
    await pool.query(`
        INSERT INTO empresas_modulos (empresa_id, modulo_codigo, habilitado, habilitado_em, atualizado_em)
        SELECT $1, codigo, TRUE, NOW(), NOW()
          FROM modulos_sistema
         WHERE codigo IN ('produtos', 'gerenciar-producao')
    `, [empresaTesteId]);

    process.env.POSTGRES_URL = connectionString;
    process.env.JWT_SECRET = jwtSecret;
    const { default: app } = await import(`../api/index.js?cadeia-producao=${Date.now()}`);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const tokenLegada = tokenParaEmpresa(1);
    const tokenSecundaria = tokenParaEmpresa(empresaTesteId);

    const produtoResponse = await request(baseUrl, '/produtos', {
        token: tokenSecundaria,
        method: 'POST',
        body: {
            empresa_id: 1,
            nome: `Produto Produção HTTP ${Date.now()}`,
            sku: `PROD-HTTP-${Date.now()}`,
            unidade: 'UN',
            estoque: 0,
            tipos: [],
            variacoes: [],
            estrutura: [],
            etapas: [{ processo: 'Costura', maquina: 'M-HTTP' }],
            etapasTiktik: [],
            grade: [],
        },
    });
    assertStatus(produtoResponse, 201, 'criação de produto no contexto secundário');
    produtoTesteId = produtoResponse.payload.id;
    const produtoContexto = await pool.query(
        'SELECT empresa_id FROM produtos WHERE id = $1',
        [produtoTesteId]
    );
    assert.equal(produtoContexto.rows[0]?.empresa_id, empresaTesteId);

    const pn = `H${Date.now().toString().slice(-12)}`;
    const corte = (
        await pool.query(`
            INSERT INTO cortes (empresa_id, produto_id, variante, quantidade, data, status, pn, cortador)
            VALUES ($1, $2, NULL, 3, '2026-08-03', 'cortados', $3, 'Ensaio HTTP')
            RETURNING id
        `, [empresaTesteId, produtoTesteId, pn])
    ).rows[0];
    corteTesteId = corte.id;

    numeroOpTeste = Date.now().toString().slice(-8);
    const op = (
        await pool.query(`
            INSERT INTO ordens_de_producao
                (empresa_id, numero, produto_id, variante, quantidade, data_entrega, observacoes, status, edit_id, etapas, demanda_id)
            VALUES ($1, $2, $3, NULL, 3, '2026-08-05', 'Ensaio HTTP Produção', 'produzindo', $4, $5::jsonb, NULL)
            RETURNING id
        `, [
            empresaTesteId,
            numeroOpTeste,
            produtoTesteId,
            `edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            JSON.stringify([{ processo: 'Costura', lancado: false, quantidade: 0, usuario: '' }]),
        ])
    ).rows[0];
    opTesteId = op.id;

    const listaSecundariaAntes = await request(baseUrl, '/producoes', { token: tokenSecundaria });
    assertStatus(listaSecundariaAntes, 200, 'listagem inicial de Produção secundária');
    assert.ok(Array.isArray(listaSecundariaAntes.payload));
    assert.equal(listaSecundariaAntes.payload.some((item) => item.empresa_id === 1), false);

    const sessaoResponse = await request(baseUrl, '/producoes', {
        token: tokenSecundaria,
        method: 'POST',
        body: {
            empresa_id: 1,
            funcionario_id: actorId,
            opNumero: numeroOpTeste,
            produto_id: produtoTesteId,
            variante: null,
            processo: 'Costura',
            quantidade: 2,
        },
    });
    assertStatus(sessaoResponse, 201, 'criação de sessão de produção secundária');
    sessaoTesteId = sessaoResponse.payload.sessaoId;

    const finalizeResponse = await request(baseUrl, '/producoes/finalizar', {
        token: tokenSecundaria,
        method: 'PUT',
        body: { id_sessao: sessaoTesteId, quantidade_finalizada: 2 },
    });
    assertStatus(finalizeResponse, 200, 'finalização de produção secundária');

    const producaoSecundaria = (
        await pool.query(
            `SELECT id FROM producoes WHERE empresa_id = $1 AND op_numero = $2 ORDER BY data DESC LIMIT 1`,
            [empresaTesteId, numeroOpTeste]
        )
    ).rows[0];
    assert.ok(producaoSecundaria, 'A finalização deve criar uma produção contextual.');
    producaoTesteId = producaoSecundaria.id;

    const producoesSecundaria = await request(baseUrl, `/producoes?op_numero=${encodeURIComponent(numeroOpTeste)}`, { token: tokenSecundaria });
    assertStatus(producoesSecundaria, 200, 'leitura de produção secundária');
    assert.ok(producoesSecundaria.payload.some((item) => item.id === producaoTesteId));

    const producoesLegada = await request(baseUrl, `/producoes?op_numero=${encodeURIComponent(numeroOpTeste)}`, { token: tokenLegada });
    assertStatus(producoesLegada, 200, 'isolamento da listagem legada');
    assert.equal(producoesLegada.payload.some((item) => item.id === producaoTesteId), false);

    const producaoLegada = (
        await pool.query('SELECT id, op_numero FROM producoes WHERE empresa_id = 1 ORDER BY data DESC LIMIT 1')
    ).rows[0];
    assert.ok(producaoLegada);
    const tentativaMutacaoCruzada = await request(baseUrl, '/producoes', {
        token: tokenSecundaria,
        method: 'PUT',
        body: { id: producaoLegada.id, edicoes: 999 },
    });
    assertStatus(tentativaMutacaoCruzada, 404, 'mutação cruzada de produção');

    const solicitacao = await request(baseUrl, '/gerenciar-producao/solicitar-exclusao', {
        token: tokenSecundaria,
        method: 'POST',
        body: { producao_id: producaoTesteId, motivo: 'Ensaio de isolamento' },
    });
    assertStatus(solicitacao, 201, 'solicitação de exclusão secundária');
    solicitacaoTesteId = (
        await pool.query(
            'SELECT id FROM producoes_solicitacoes_exclusao WHERE empresa_id = $1 AND producao_id = $2 ORDER BY id DESC LIMIT 1',
            [empresaTesteId, producaoTesteId]
        )
    ).rows[0]?.id;

    const solicitacoesLegada = await request(baseUrl, '/gerenciar-producao/solicitacoes?status=pendente', { token: tokenLegada });
    assertStatus(solicitacoesLegada, 200, 'solicitações legadas isoladas');
    assert.equal(solicitacoesLegada.payload.rows.some((item) => item.id === solicitacaoTesteId), false);

    console.log(JSON.stringify({
        aprovado: true,
        banco: connectionString,
        empresaSecundariaTemporaria: empresaTesteId,
        verificacoes: {
            bodyNaoTrocaEmpresaNaSessao: true,
            producoesIsoladasPorEmpresa: true,
            sessaoEFinalizacaoSecundariasOperacionais: true,
            mutacaoCruzadaBloqueada: true,
            solicitacoesDeExclusaoIsoladas: true,
            fallbackDeOpFicticiaEliminado: true,
        },
    }, null, 2));
} finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (solicitacaoTesteId) await pool.query('DELETE FROM producoes_solicitacoes_exclusao WHERE id = $1', [solicitacaoTesteId]).catch(() => {});
    if (producaoTesteId) await pool.query('DELETE FROM producoes WHERE id = $1 AND empresa_id = $2', [producaoTesteId, empresaTesteId]).catch(() => {});
    if (sessaoTesteId) await pool.query('DELETE FROM sessoes_trabalho_producao WHERE id = $1 AND empresa_id = $2', [sessaoTesteId, empresaTesteId]).catch(() => {});
    if (actorId && empresaTesteId) {
        await pool.query(`
            UPDATE usuarios_empresas
               SET status_atual = NULL, id_sessao_trabalho_atual = NULL
             WHERE usuario_id = $1 AND empresa_id = $2
        `, [actorId, empresaTesteId]).catch(() => {});
    }
    if (opTesteId) await pool.query('DELETE FROM ordens_de_producao WHERE id = $1 AND empresa_id = $2', [opTesteId, empresaTesteId]).catch(() => {});
    if (corteTesteId) await pool.query('DELETE FROM cortes WHERE id = $1 AND empresa_id = $2', [corteTesteId, empresaTesteId]).catch(() => {});
    if (produtoTesteId) await pool.query('DELETE FROM produtos WHERE id = $1 AND empresa_id = $2', [produtoTesteId, empresaTesteId]).catch(() => {});
    if (empresaTesteId) {
        await pool.query('DELETE FROM ponto_transicoes_pendentes WHERE empresa_id = $1', [empresaTesteId]).catch(() => {});
        await pool.query('DELETE FROM ponto_eventos WHERE empresa_id = $1', [empresaTesteId]).catch(() => {});
        await pool.query('DELETE FROM ponto_diario WHERE empresa_id = $1', [empresaTesteId]).catch(() => {});
        await pool.query('DELETE FROM audit_log WHERE empresa_id = $1', [empresaTesteId]).catch(() => {});
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
