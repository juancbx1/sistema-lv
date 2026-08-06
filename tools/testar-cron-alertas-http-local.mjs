import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.argv[2]
    || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_cadeia_alertas_test';
const jwtSecret = process.env.JWT_SECRET || 'segredo-local-teste-cadeia-alertas';
const pool = new Pool({ connectionString, max: 8 });
let server;
let actorId;
let empresaTesteId;
let demandaTesteId;
let eventoTesteId;
let historicoTesteIds = [];
let horaExtraEventoId;
let horaExtraHistoricoId;
let config;
let configOriginal;
let configEmpresaOriginal;
let diasOriginal;
let pollingOriginal;
let flagAlertaOriginal;

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
    process.env.POSTGRES_URL = connectionString;
    process.env.JWT_SECRET = jwtSecret;
    process.env.NODE_ENV = 'test';

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
    assert.ok(actor, 'Administrador ativo na empresa legada e obrigatorio.');
    actorId = actor.id;

    config = (await pool.query(`
        SELECT id, ativo, gatilho_minutos, acao_popup, acao_notificacao,
               intervalo_repeticao_minutos, peso_risco
          FROM configuracoes_alertas
         WHERE tipo_alerta = 'DEMANDA_NORMAL'
    `)).rows[0];
    assert.ok(config, 'Configuracao DEMANDA_NORMAL obrigatoria.');
    configOriginal = config;
    configEmpresaOriginal = (await pool.query(`
        SELECT ativo, gatilho_minutos, acao_popup, acao_notificacao,
               intervalo_repeticao_minutos, peso_risco
          FROM configuracoes_alertas_empresas
         WHERE empresa_id = 1 AND configuracao_id = $1
    `, [config.id])).rows[0];
    assert.ok(configEmpresaOriginal, 'Override empresarial de alerta obrigatorio.');

    const diasRows = await pool.query(`
        SELECT chave, valor, horario_inicio, horario_fim
          FROM alertas_configuracoes_gerais
         WHERE empresa_id = 1
         ORDER BY chave
    `);
    diasOriginal = diasRows.rows.find(row => row.chave === 'dias_de_trabalho');
    pollingOriginal = diasRows.rows.find(row => row.chave === 'janela_polling');
    assert.ok(diasOriginal && pollingOriginal, 'Configuracoes gerais de alertas incompletas.');

    const empresa = (await pool.query(`
        INSERT INTO empresas (codigo, razao_social, nome_fantasia, ativa, eh_legada)
        VALUES ($1, 'Empresa Teste Alertas', 'Empresa Teste Alertas', TRUE, FALSE)
        RETURNING id
    `, [`empresa-teste-alertas-${Date.now()}`])).rows[0];
    empresaTesteId = empresa.id;
    await pool.query(`
        INSERT INTO usuarios_empresas (usuario_id, empresa_id, tipos, permissoes, ativo, empresa_principal)
        VALUES ($1, $2, ARRAY['administrador'], '{}'::text[], TRUE, FALSE)
    `, [actorId, empresaTesteId]);
    flagAlertaOriginal = (await pool.query(
        "SELECT multiempresa_pronto FROM modulos_sistema WHERE codigo = 'alertas'"
    )).rows[0];
    assert.ok(flagAlertaOriginal, 'Modulo alertas obrigatorio.');
    await pool.query(
        "UPDATE modulos_sistema SET multiempresa_pronto = TRUE, atualizado_em = NOW() WHERE codigo = 'alertas'"
    );
    await pool.query(`
        INSERT INTO empresas_modulos (empresa_id, modulo_codigo, habilitado, habilitado_em, atualizado_em)
        VALUES ($1, 'alertas', TRUE, NOW(), NOW())
    `, [empresaTesteId]);

    const { default: app } = await import(`../api/index.js?cron-alertas=${Date.now()}`);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const tokenLegada = tokenParaEmpresa(1);
    const tokenSecundaria = tokenParaEmpresa(empresaTesteId);

    const configuracoes = await request(baseUrl, '/alertas/configuracoes', { token: tokenLegada });
    assertStatus(configuracoes, 200, 'configuracoes legadas');
    assert.equal(configuracoes.payload.length, 8);
    assert.equal(configuracoes.payload.find(row => row.id === config.id).ativo, configEmpresaOriginal.ativo);

    const configAtualizada = {
        ...configuracoes.payload.find(row => row.id === config.id),
        empresa_id: empresaTesteId,
        peso_risco: Number(configEmpresaOriginal.peso_risco || 0) + 1,
    };
    const salvarConfig = await request(baseUrl, '/alertas/configuracoes', {
        token: tokenLegada,
        method: 'PUT',
        body: [configAtualizada],
    });
    assertStatus(salvarConfig, 200, 'salvamento contextual de configuracao');
    const configDepois = (await pool.query(
        'SELECT peso_risco FROM configuracoes_alertas_empresas WHERE empresa_id = 1 AND configuracao_id = $1',
        [config.id]
    )).rows[0];
    const catalogoDepois = (await pool.query(
        'SELECT peso_risco FROM configuracoes_alertas WHERE id = $1',
        [config.id]
    )).rows[0];
    assert.equal(Number(configDepois.peso_risco), Number(configEmpresaOriginal.peso_risco || 0) + 1);
    assert.equal(Number(catalogoDepois.peso_risco || 0), Number(configOriginal.peso_risco || 0));

    const dias = await request(baseUrl, '/alertas/dias-trabalho', { token: tokenLegada });
    assertStatus(dias, 200, 'dias de trabalho legados');
    assert.equal(dias.payload.empresa_id, undefined, 'resposta nao deve expor empresa de outra origem');

    const salvarDias = await request(baseUrl, '/alertas/dias-trabalho', {
        token: tokenLegada,
        method: 'PUT',
        body: {
            empresa_id: empresaTesteId,
            valor: diasOriginal.valor,
            horario_inicio: String(diasOriginal.horario_inicio).slice(0, 5),
            horario_fim: String(diasOriginal.horario_fim).slice(0, 5),
            janela_poll_inicio: String(pollingOriginal.horario_inicio).slice(0, 5),
            janela_poll_fim: String(pollingOriginal.horario_fim).slice(0, 5),
        },
    });
    assertStatus(salvarDias, 200, 'salvamento contextual de dias');
    const diasDepois = (await pool.query(
        "SELECT empresa_id FROM alertas_configuracoes_gerais WHERE empresa_id = 1 AND chave = 'dias_de_trabalho'"
    )).rows;
    assert.equal(diasDepois.length, 1);

    const demanda = (await pool.query(`
        INSERT INTO demandas_producao
            (empresa_id, produto_id, produto_sku, quantidade_solicitada,
             solicitado_por, status, data_conclusao, criado_em)
        SELECT 1, p.id, p.sku, 1, 'Smoke Cron Alertas', 'concluida',
               '2020-01-01T12:00:00Z', NOW()
          FROM produtos p
         WHERE p.empresa_id = 1
         ORDER BY p.id
         LIMIT 1
        RETURNING id
    `)).rows[0];
    assert.ok(demanda, 'Demanda de smoke do cron nao criada.');
    demandaTesteId = demanda.id;

    const arquivar = await request(baseUrl, '/cron/arquivar-concluidas');
    assertStatus(arquivar, 200, 'cron de arquivamento');
    assert.ok(Number(arquivar.payload.archived_count) >= 1);
    const demandaArquivada = (await pool.query(
        'SELECT status FROM demandas_producao WHERE id = $1 AND empresa_id = 1',
        [demandaTesteId]
    )).rows[0];
    assert.equal(demandaArquivada.status, 'arquivada');

    const mensagemEvento = `Smoke alerta contextual ${Date.now()}`;
    eventoTesteId = (await pool.query(`
        INSERT INTO eventos_sistema
            (empresa_id, tipo_evento, mensagem, lido, dados_extras)
        VALUES (1, 'DEMANDA_NORMAL', $1, false, jsonb_build_object('empresa_id', 1))
        RETURNING id
    `, [mensagemEvento])).rows[0].id;
    await pool.query(
        'UPDATE configuracoes_alertas_empresas SET ativo = TRUE WHERE empresa_id = 1 AND configuracao_id = $1',
        [config.id]
    );
    const verificar = await request(baseUrl, '/alertas/verificar-status', { token: tokenLegada });
    assertStatus(verificar, 200, 'verificacao de status legada');
    assert.ok(verificar.payload.some(alerta => alerta.mensagem === mensagemEvento));
    const eventoLido = (await pool.query(
        'SELECT lido, empresa_id FROM eventos_sistema WHERE id = $1',
        [eventoTesteId]
    )).rows[0];
    assert.equal(eventoLido.lido, true);
    assert.equal(eventoLido.empresa_id, 1);
    for (let tentativa = 0; tentativa < 20 && historicoTesteIds.length === 0; tentativa += 1) {
        historicoTesteIds = (await pool.query(
            'SELECT id FROM historico_alertas WHERE empresa_id = 1 AND mensagem = $1',
            [mensagemEvento]
        )).rows.map(row => row.id);
        if (historicoTesteIds.length === 0) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    }
    assert.ok(historicoTesteIds.length >= 1);

    const historico = await request(baseUrl, '/alertas/historico', { token: tokenLegada });
    assertStatus(historico, 200, 'historico contextual legado');
    assert.ok(historico.payload.every(row => row.empresa_id === undefined));

    const horaExtraMensagem = `Smoke hora extra contextual ${Date.now()}`;
    const horaExtra = await request(baseUrl, '/alertas/hora-extra', {
        token: tokenLegada,
        method: 'POST',
        body: {
            funcionario_id: actorId,
            funcionario_nome: 'Smoke',
            produto_nome: horaExtraMensagem,
            processo: 'Smoke',
            quantidade: 1,
        },
    });
    assertStatus(horaExtra, 200, 'hora extra legada');
    const horaExtraEvento = (await pool.query(
        'SELECT id, empresa_id FROM eventos_sistema WHERE mensagem LIKE $1 ORDER BY id DESC LIMIT 1',
        [`%${horaExtraMensagem}%`]
    )).rows[0];
    const horaExtraHistorico = (await pool.query(
        'SELECT id, empresa_id FROM historico_alertas WHERE mensagem LIKE $1 ORDER BY id DESC LIMIT 1',
        [`%${horaExtraMensagem}%`]
    )).rows[0];
    assert.equal(horaExtraEvento.empresa_id, 1);
    assert.equal(horaExtraHistorico.empresa_id, 1);
    horaExtraEventoId = horaExtraEvento.id;
    horaExtraHistoricoId = horaExtraHistorico.id;

    for (const [path, label] of [
        ['/alertas/configuracoes', 'configuracoes secundarias'],
        ['/alertas/dias-trabalho', 'dias secundarios'],
        ['/alertas/verificar-status', 'status secundario'],
        ['/alertas/historico', 'historico secundario'],
        ['/alertas/hora-extra', 'hora extra secundaria'],
    ]) {
        const blocked = await request(baseUrl, path, {
            token: tokenSecundaria,
            method: path.endsWith('hora-extra') ? 'POST' : 'GET',
            body: path.endsWith('hora-extra') ? { funcionario_id: actorId } : undefined,
        });
        assertStatus(blocked, 403, label);
        assert.equal(blocked.payload.codigo, 'CADEIA_PRODUTIVA_NAO_MIGRADA', label);
    }

    console.log(JSON.stringify({
        aprovado: true,
        banco: connectionString,
        verificacoes: {
            cronArquivaDemandasEmpresariais: true,
            configuracoesOperacionaisPorEmpresa: true,
            diasEJanelaPorEmpresa: true,
            eventosEHistoricoPorEmpresa: true,
            secundariosFalhamFechados: true,
            bodyNaoTrocaEmpresa: true,
        },
    }, null, 2));
} finally {
    if (eventoTesteId) await pool.query('DELETE FROM eventos_sistema WHERE id = $1', [eventoTesteId]);
    if (horaExtraEventoId) await pool.query('DELETE FROM eventos_sistema WHERE id = $1', [horaExtraEventoId]);
    if (historicoTesteIds.length > 0) await pool.query('DELETE FROM historico_alertas WHERE id = ANY($1::int[])', [historicoTesteIds]);
    if (horaExtraHistoricoId) await pool.query('DELETE FROM historico_alertas WHERE id = $1', [horaExtraHistoricoId]);
    if (demandaTesteId) await pool.query('DELETE FROM demandas_producao WHERE id = $1', [demandaTesteId]);
    if (configOriginal && configEmpresaOriginal) {
        await pool.query(`
            UPDATE configuracoes_alertas_empresas
               SET ativo = $1,
                   gatilho_minutos = $2,
                   acao_popup = $3,
                   acao_notificacao = $4,
                   intervalo_repeticao_minutos = $5,
                   peso_risco = $6,
                   atualizado_em = NOW()
             WHERE empresa_id = 1 AND configuracao_id = $7
        `, [
            configEmpresaOriginal.ativo,
            configEmpresaOriginal.gatilho_minutos,
            configEmpresaOriginal.acao_popup,
            configEmpresaOriginal.acao_notificacao,
            configEmpresaOriginal.intervalo_repeticao_minutos,
            configEmpresaOriginal.peso_risco,
            config.id,
        ]);
    }
    if (diasOriginal && pollingOriginal) {
        await pool.query(`
            UPDATE alertas_configuracoes_gerais
               SET valor = $1, horario_inicio = $2, horario_fim = $3
             WHERE empresa_id = 1 AND chave = 'dias_de_trabalho'
        `, [diasOriginal.valor, diasOriginal.horario_inicio, diasOriginal.horario_fim]);
        await pool.query(`
            UPDATE alertas_configuracoes_gerais
               SET valor = $1, horario_inicio = $2, horario_fim = $3
             WHERE empresa_id = 1 AND chave = 'janela_polling'
        `, [pollingOriginal.valor, pollingOriginal.horario_inicio, pollingOriginal.horario_fim]);
    }
    if (empresaTesteId) {
        await pool.query('DELETE FROM empresas_modulos WHERE empresa_id = $1', [empresaTesteId]);
        await pool.query('DELETE FROM usuarios_empresas WHERE empresa_id = $1', [empresaTesteId]);
        await pool.query('DELETE FROM empresas WHERE id = $1', [empresaTesteId]);
    }
    if (flagAlertaOriginal) {
        await pool.query(
            "UPDATE modulos_sistema SET multiempresa_pronto = $1, atualizado_em = NOW() WHERE codigo = 'alertas'",
            [flagAlertaOriginal.multiempresa_pronto]
        );
    }
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
}
