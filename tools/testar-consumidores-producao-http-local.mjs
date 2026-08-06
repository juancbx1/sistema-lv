import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.argv[2]
    || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_cadeia_consumidores_http_test';
const jwtSecret = process.env.JWT_SECRET || 'segredo-local-teste-cadeia-producao';
const pool = new Pool({ connectionString, max: 8 });
let server;
let actorId;
let empresaTesteId;
let promessaTesteId;
let promessaAnterior;
let tempoTesteProcesso;
let produtoTesteId;
const flagsOriginais = [];

function tokenParaEmpresa(empresaId) {
    return jwt.sign(
        { id: actorId, empresa_id: empresaId, superadministrador: false },
        jwtSecret,
        { expiresIn: '1h' }
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

function assertStatus(response, expected, label) {
    assert.equal(
        response.status,
        expected,
        `${label}: esperado HTTP ${expected}, recebido ${response.status}: ${JSON.stringify(response.payload)}`
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
    assert.ok(actor, 'Administrador ativo na empresa legada Ã© obrigatÃ³rio.');
    actorId = actor.id;

    const flags = (await pool.query(`
        SELECT codigo, multiempresa_pronto
        FROM modulos_sistema
        WHERE codigo IN ('gerenciar-producao', 'producao-geral', 'ordens-producao')
        ORDER BY codigo
    `)).rows;
    assert.equal(flags.length, 3, 'CatÃ¡logo dos mÃ³dulos de ProduÃ§Ã£o incompleto.');
    flagsOriginais.push(...flags);

    const empresa = (await pool.query(`
        INSERT INTO empresas (codigo, razao_social, nome_fantasia, ativa, eh_legada)
        VALUES ($1, 'Empresa Teste Consumidores ProduÃ§Ã£o', 'Empresa Teste Consumidores ProduÃ§Ã£o', TRUE, FALSE)
        RETURNING id
    `, [`empresa-teste-consumidores-${Date.now()}`])).rows[0];
    empresaTesteId = empresa.id;

    await pool.query(`
        INSERT INTO usuarios_empresas (usuario_id, empresa_id, tipos, permissoes, ativo, empresa_principal)
        VALUES ($1, $2, ARRAY['administrador'], '{}'::text[], TRUE, FALSE)
    `, [actorId, empresaTesteId]);
    await pool.query(`
        UPDATE modulos_sistema
           SET multiempresa_pronto = TRUE, atualizado_em = NOW()
         WHERE codigo = ANY($1::text[])
    `, [['gerenciar-producao', 'producao-geral', 'ordens-producao']]);
    await pool.query(`
        INSERT INTO empresas_modulos (empresa_id, modulo_codigo, habilitado, habilitado_em, atualizado_em)
        SELECT $1, codigo, TRUE, NOW(), NOW()
        FROM modulos_sistema
        WHERE codigo = ANY($2::text[])
    `, [empresaTesteId, ['gerenciar-producao', 'producao-geral', 'ordens-producao']]);

    const produto = (await pool.query(`
        SELECT id, sku
        FROM produtos
        WHERE empresa_id = 1
        ORDER BY id
        LIMIT 1
    `)).rows[0];
    assert.ok(produto?.sku, 'Produto legado com SKU obrigatÃ³rio.');
    produtoTesteId = produto.id;
    promessaAnterior = (await pool.query(
        'SELECT * FROM producao_promessas WHERE empresa_id = 1 AND produto_ref_id = $1',
        [produto.sku]
    )).rows[0] || null;
    assert.equal(promessaAnterior, null, 'O SKU escolhido deve estar livre para o ensaio da promessa.');

    process.env.POSTGRES_URL = connectionString;
    process.env.JWT_SECRET = jwtSecret;
    const { default: app } = await import(`../api/index.js?consumidores-producao=${Date.now()}`);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const tokenLegada = tokenParaEmpresa(1);
    const tokenSecundaria = tokenParaEmpresa(empresaTesteId);

    const status = await request(baseUrl, '/producao/meu-status', { token: tokenLegada });
    assertStatus(status, 200, 'status individual legado');
    assert.equal(status.payload.empresaId, undefined, 'O endpoint nÃ£o deve depender de empresa_id do body.');

    const grupos = await request(baseUrl, `/producao/grupos-unificaveis?produto_id=${produto.id}&tipo_funcionario=costureira`, {
        token: tokenLegada,
    });
    assertStatus(grupos, 200, 'grupos unificÃ¡veis legados');
    assert.ok(Array.isArray(grupos.payload));

    const fila = await request(baseUrl, '/producao/fila-de-tarefas', { token: tokenLegada });
    assertStatus(fila, 200, 'fila de tarefas legada');
    assert.ok(Array.isArray(fila.payload));
    assert.equal(fila.payload.some((item) => item.produto_id !== undefined && item.produto_id !== produto.id), true);

    const op = (await pool.query(`
        SELECT numero, produto_id
        FROM ordens_de_producao
        WHERE empresa_id = 1
        ORDER BY id
        LIMIT 1
    `)).rows[0];
    assert.ok(op, 'OP legada obrigatÃ³ria para o ensaio da sugestÃ£o.');
    const sugestao = await request(baseUrl, '/producao/sugestao-tarefa', {
        token: tokenLegada,
        method: 'POST',
        body: {
            funcionario_id: actorId,
            candidatas: [{ produto_id: op.produto_id, processo: 'Costura', origem_ops: [op.numero] }],
        },
    });
    assertStatus(sugestao, 200, 'sugestÃ£o de tarefa legada');
    assert.ok(Array.isArray(sugestao.payload.candidatas));

    const tempos = await request(baseUrl, '/producao/tempos-padrao', { token: tokenLegada });
    assertStatus(tempos, 200, 'tempos padrÃ£o legados');
    assert.equal(typeof tempos.payload, 'object');

    tempoTesteProcesso = `Ensaio isolamento ${Date.now()}`;
    const tempoCriado = await request(baseUrl, '/producao/tempos-padrao', {
        token: tokenLegada,
        method: 'POST',
        body: {
            empresa_id: empresaTesteId,
            tempos: { [`${produto.id}-${tempoTesteProcesso}`]: 12.5 },
        },
    });
    assertStatus(tempoCriado, 200, 'gravaÃ§Ã£o contextual de tempo padrÃ£o');
    const tempoPersistido = await pool.query(
        'SELECT 1 FROM tempos_padrao_producao WHERE produto_id = $1 AND processo = $2',
        [produto.id, tempoTesteProcesso]
    );
    assert.equal(tempoPersistido.rowCount, 1);

    const promessa = await request(baseUrl, '/producao-promessas', { token: tokenLegada });
    assertStatus(promessa, 200, 'listagem de promessas legadas');
    assert.ok(Array.isArray(promessa.payload));

    const promessaCriada = await request(baseUrl, '/producao-promessas', {
        token: tokenLegada,
        method: 'POST',
        body: { produto_ref_id: produto.sku, empresa_id: empresaTesteId },
    });
    assertStatus(promessaCriada, 201, 'criaÃ§Ã£o de promessa contextual');
    promessaTesteId = promessaCriada.payload.id;
    assert.equal(promessaCriada.payload.empresa_id, 1);
    const promessaExcluida = await request(baseUrl, `/producao-promessas/${promessaTesteId}`, {
        token: tokenLegada,
        method: 'DELETE',
    });
    assertStatus(promessaExcluida, 200, 'exclusÃ£o contextual de promessa');
    promessaTesteId = null;

    const historico = await request(baseUrl, `/real-producao/desempenho-historico?funcionarioId=${actorId}`, {
        token: tokenLegada,
    });
    assertStatus(historico, 200, 'histÃ³rico de desempenho legado');

    for (const [path, label] of [
        ['/producao/meu-status', 'status secundÃ¡rio'],
        ['/producao/fila-de-tarefas', 'fila secundÃ¡ria'],
        ['/real-producao/desempenho-historico?funcionarioId=' + actorId, 'histÃ³rico secundÃ¡rio'],
        ['/producao-promessas', 'promessas secundÃ¡rias'],
    ]) {
        const blocked = await request(baseUrl, path, { token: tokenSecundaria });
        assertStatus(blocked, 403, label);
        assert.equal(blocked.payload.codigo, 'CADEIA_PRODUTIVA_NAO_MIGRADA', label);
    }

    console.log(JSON.stringify({
        aprovado: true,
        banco: connectionString,
        verificacoes: {
            statusGruposFilaSugestaoTemposLegados: true,
            promessasListagemCriacaoExclusaoContextuais: true,
            realProducaoHistoricoLegado: true,
            consumidoresSecundariosFalhamFechados: true,
            bodyNaoTrocaEmpresa: true,
        },
    }, null, 2));
} finally {
    if (promessaTesteId) {
        await pool.query('DELETE FROM producao_promessas WHERE id = $1', [promessaTesteId]);
    }
    if (tempoTesteProcesso) {
        await pool.query(
            'DELETE FROM tempos_padrao_producao WHERE produto_id = $1 AND processo = $2',
            [produtoTesteId, tempoTesteProcesso]
        );
    }
    if (promessaAnterior) {
        await pool.query(`
            INSERT INTO producao_promessas (id, produto_ref_id, data_promessa, data_expiracao, usuario_id, usuario_nome)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE SET
                produto_ref_id = EXCLUDED.produto_ref_id,
                data_promessa = EXCLUDED.data_promessa,
                data_expiracao = EXCLUDED.data_expiracao,
                usuario_id = EXCLUDED.usuario_id,
                usuario_nome = EXCLUDED.usuario_nome
        `, [
            promessaAnterior.id,
            promessaAnterior.produto_ref_id,
            promessaAnterior.data_promessa,
            promessaAnterior.data_expiracao,
            promessaAnterior.usuario_id,
            promessaAnterior.usuario_nome,
        ]);
    }
    if (empresaTesteId) {
        await pool.query('DELETE FROM empresas_modulos WHERE empresa_id = $1', [empresaTesteId]);
        await pool.query('DELETE FROM usuarios_empresas WHERE empresa_id = $1', [empresaTesteId]);
        await pool.query('DELETE FROM empresas WHERE id = $1', [empresaTesteId]);
    }
    for (const flag of flagsOriginais) {
        await pool.query(
            'UPDATE modulos_sistema SET multiempresa_pronto = $1, atualizado_em = NOW() WHERE codigo = $2',
            [flag.multiempresa_pronto, flag.codigo]
        );
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
}
