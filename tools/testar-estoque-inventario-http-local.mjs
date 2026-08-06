import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const connectionString = process.argv[2];
if (!connectionString || !/^postgresql:\/\/(postgres@)?(127\.0\.0\.1|localhost):\d+\//.test(connectionString)) {
  throw new Error('O smoke aceita somente uma URL PostgreSQL local explicita.');
}

const pool = new pg.Pool({ connectionString, max: 8 });
const jwtSecret = process.env.JWT_SECRET || 'segredo-local-teste-cadeia-producao';
let server;
let actorId;
let empresaTesteId;
let manualFixtureId;
let loteFixtureId;
let estornoFixtureId;
let inventarioFixtureId;
const flagsOriginais = [];

function tokenParaEmpresa(empresaId) {
  return jwt.sign({ id: actorId, empresa_id: empresaId, superadministrador: false }, jwtSecret, { expiresIn: '1h' });
}

async function request(baseUrl, path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, payload };
}

function assertStatus(response, expected, label) {
  assert.equal(response.status, expected, `${label}: esperado HTTP ${expected}, recebido ${response.status}: ${JSON.stringify(response.payload)}`);
}

try {
  const actor = (await pool.query(`
    SELECT u.id
      FROM usuarios u
      JOIN usuarios_empresas ue ON ue.usuario_id = u.id AND ue.empresa_id = 1 AND ue.ativo
     WHERE 'administrador' = ANY(ue.tipos)
     ORDER BY u.id
     LIMIT 1
  `)).rows[0];
  assert.ok(actor, 'Administrador ativo na empresa legada e obrigatorio.');
  actorId = actor.id;

  for (const codigo of ['estoque', 'inventario']) {
    const modulo = (await pool.query(
      'SELECT codigo, multiempresa_pronto FROM modulos_sistema WHERE codigo = $1',
      [codigo],
    )).rows[0];
    assert.ok(modulo, `Modulo ${codigo} ausente no catalogo local.`);
    flagsOriginais.push(modulo);
    await pool.query(
      'UPDATE modulos_sistema SET multiempresa_pronto = TRUE, atualizado_em = NOW() WHERE codigo = $1',
      [codigo],
    );
  }

  empresaTesteId = (await pool.query(`
    INSERT INTO empresas (codigo, razao_social, nome_fantasia, ativa, eh_legada)
    VALUES ($1, 'Empresa Smoke Estoque', 'Empresa Smoke Estoque', TRUE, FALSE)
    RETURNING id
  `, [`empresa-smoke-estoque-${Date.now()}`])).rows[0].id;
  await pool.query(`
    INSERT INTO usuarios_empresas (usuario_id, empresa_id, tipos, permissoes, ativo, empresa_principal)
    VALUES ($1, $2, ARRAY['administrador'], '{}'::text[], TRUE, FALSE)
  `, [actorId, empresaTesteId]);
  for (const codigo of ['estoque', 'inventario']) {
    await pool.query(`
      INSERT INTO empresas_modulos (empresa_id, modulo_codigo, habilitado, habilitado_em, atualizado_em)
      VALUES ($1, $2, TRUE, NOW(), NOW())
    `, [empresaTesteId, codigo]);
  }

  const produto = (await pool.query(`
    SELECT id, sku
      FROM produtos
     WHERE empresa_id = 1 AND sku IS NOT NULL
     ORDER BY id
     LIMIT 1
  `)).rows[0];
  assert.ok(produto, 'Produto legado com SKU e obrigatorio para o smoke.');

  process.env.POSTGRES_URL = connectionString;
  process.env.JWT_SECRET = jwtSecret;
  const { default: app } = await import(`../api/index.js?estoque-inventario-http=${Date.now()}`);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenLegada = tokenParaEmpresa(1);
  const tokenSecundaria = tokenParaEmpresa(empresaTesteId);

  for (const [rota, label] of [
    ['/estoque/saldo', 'saldo'],
    ['/estoque/movimentos?page=1&limit=2', 'movimentos'],
    ['/estoque/arquivados', 'arquivados'],
    ['/niveis-estoque', 'niveis'],
    ['/inventario/sessoes', 'sessoes'],
  ]) {
    const legado = await request(baseUrl, rota, tokenLegada);
    assertStatus(legado, 200, `${label} legado`);
    const secundario = await request(baseUrl, rota, tokenSecundaria);
    assertStatus(secundario, 200, `${label} secundario`);
    if (label === 'movimentos') assert.equal(secundario.payload?.rows?.length || 0, 0, `${label} secundario isolado`);
    if (label !== 'movimentos') assert.equal(Array.isArray(secundario.payload) ? secundario.payload.length : (secundario.payload?.historico?.length || 0), 0, `${label} secundario isolado`);
  }

  const manualKey = `smoke-estoque-manual-${Date.now()}`;
  const manualPayload = {
    produto_id: produto.id,
    variante_nome: '-',
    quantidade_movimentada: 2,
    tipo_operacao: 'ENTRADA_MANUAL',
    observacao: 'smoke estoque idempotencia',
  };
  const manualPrimeiro = await request(baseUrl, '/estoque/movimento-manual', tokenLegada, {
    method: 'POST', headers: { 'Idempotency-Key': manualKey }, body: JSON.stringify(manualPayload),
  });
  assertStatus(manualPrimeiro, 201, 'movimento manual primeiro');
  manualFixtureId = manualPrimeiro.payload?.movimentoRegistrado?.id;
  assert.ok(manualFixtureId);
  const manualSegundo = await request(baseUrl, '/estoque/movimento-manual', tokenLegada, {
    method: 'POST', headers: { 'Idempotency-Key': manualKey }, body: JSON.stringify(manualPayload),
  });
  assertStatus(manualSegundo, 200, 'movimento manual repetido');
  assert.equal(manualSegundo.payload?.idempotente, true);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM estoque_movimentos WHERE empresa_id = 1 AND idempotency_key = $1', [manualKey])).rows[0].n, 1);

  const manualSecundario = await request(baseUrl, '/estoque/movimento-manual', tokenSecundaria, {
    method: 'POST', headers: { 'Idempotency-Key': `secundario-${Date.now()}` }, body: JSON.stringify(manualPayload),
  });
  assertStatus(manualSecundario, 404, 'movimento manual nao aceita produto de outra empresa');

  const loteKey = `smoke-estoque-lote-${Date.now()}`;
  const lotePayload = { itens: [{ produto_id: produto.id, variante_nome: '-', quantidade_movimentada: 1 }], tipo_operacao: 'SAIDA_PEDIDO_SMOKE', observacao: 'smoke lote' };
  const lotePrimeiro = await request(baseUrl, '/estoque/movimento-em-lote', tokenLegada, {
    method: 'POST', headers: { 'Idempotency-Key': loteKey }, body: JSON.stringify(lotePayload),
  });
  assertStatus(lotePrimeiro, 201, 'movimento em lote primeiro');
  loteFixtureId = (await pool.query('SELECT id FROM estoque_movimentos WHERE empresa_id = 1 AND idempotency_key = $1', [`${loteKey}:0`])).rows[0]?.id;
  assert.ok(loteFixtureId);
  const loteSegundo = await request(baseUrl, '/estoque/movimento-em-lote', tokenLegada, {
    method: 'POST', headers: { 'Idempotency-Key': loteKey }, body: JSON.stringify(lotePayload),
  });
  assertStatus(loteSegundo, 200, 'movimento em lote repetido');
  assert.equal(loteSegundo.payload?.idempotente, true);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM estoque_movimentos WHERE empresa_id = 1 AND idempotency_key = $1', [`${loteKey}:0`])).rows[0].n, 1);

  const estornoKey = `smoke-estoque-estorno-${Date.now()}`;
  const estornoPrimeiro = await request(baseUrl, '/estoque/estornar-movimento', tokenLegada, {
    method: 'POST', headers: { 'Idempotency-Key': estornoKey }, body: JSON.stringify({ id_movimento_original: loteFixtureId, quantidade_a_estornar: 1 }),
  });
  assertStatus(estornoPrimeiro, 201, 'estorno primeiro');
  estornoFixtureId = estornoPrimeiro.payload?.movimentoDeEstorno?.id;
  assert.ok(estornoFixtureId);
  const estornoSegundo = await request(baseUrl, '/estoque/estornar-movimento', tokenLegada, {
    method: 'POST', headers: { 'Idempotency-Key': estornoKey }, body: JSON.stringify({ id_movimento_original: loteFixtureId, quantidade_a_estornar: 1 }),
  });
  assertStatus(estornoSegundo, 200, 'estorno repetido');
  assert.equal(estornoSegundo.payload?.idempotente, true);

  const inventarioKey = `smoke-inventario-${Date.now()}`;
  const inventarioPrimeiro = await request(baseUrl, '/inventario/iniciar', tokenLegada, {
    method: 'POST', headers: { 'Idempotency-Key': inventarioKey }, body: JSON.stringify({ observacoes: 'smoke inventario' }),
  });
  assertStatus(inventarioPrimeiro, 201, 'iniciar inventario');
  inventarioFixtureId = inventarioPrimeiro.payload?.sessao?.id;
  assert.ok(inventarioFixtureId);
  const inventarioSegundo = await request(baseUrl, '/inventario/iniciar', tokenLegada, {
    method: 'POST', headers: { 'Idempotency-Key': inventarioKey }, body: JSON.stringify({ observacoes: 'smoke inventario' }),
  });
  assertStatus(inventarioSegundo, 200, 'iniciar inventario repetido');
  assert.equal(inventarioSegundo.payload?.idempotente, true);
  const detalhes = await request(baseUrl, `/inventario/sessoes/${inventarioFixtureId}`, tokenLegada);
  assertStatus(detalhes, 200, 'detalhes inventario');
  const primeiroItem = detalhes.payload?.itens?.[0];
  assert.ok(primeiroItem, 'Inventario deve fotografar ao menos um item.');
  const contagem = await request(baseUrl, `/inventario/sessoes/${inventarioFixtureId}/contar`, tokenLegada, {
    method: 'POST', body: JSON.stringify({ produto_ref_id: primeiroItem.produto_ref_id, quantidade_contada: primeiroItem.quantidade_sistema }),
  });
  assertStatus(contagem, 200, 'contagem inventario');
  const finalizar = await request(baseUrl, `/inventario/sessoes/${inventarioFixtureId}/finalizar`, tokenLegada, { method: 'POST', body: '{}' });
  assertStatus(finalizar, 200, 'finalizar inventario');
  const detalheSecundario = await request(baseUrl, `/inventario/sessoes/${inventarioFixtureId}`, tokenSecundaria);
  assertStatus(detalheSecundario, 404, 'detalhe inventario de outra empresa');

  console.log(JSON.stringify({
    aprovado: true,
    banco: connectionString,
    verificacoes: {
      leiturasIsoladas: 5,
      bodyNaoTrocaEmpresa: true,
      movimentoManualIdempotente: true,
      loteIdempotente: true,
      estornoIdempotente: true,
      inventarioIdempotenteEIsolado: true,
    },
  }, null, 2));
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (inventarioFixtureId) await pool.query('DELETE FROM inventario_sessoes WHERE id = $1 AND empresa_id = 1', [inventarioFixtureId]);
  const movimentoFixtureIds = [estornoFixtureId, loteFixtureId, manualFixtureId].filter(Boolean).map(String);
  if (movimentoFixtureIds.length > 0) {
    await pool.query(
      `DELETE FROM auditoria_eventos
        WHERE empresa_id = 1
          AND entidade = 'Estoque'
          AND detalhes->>'movimento_id' = ANY($1::text[])`,
      [movimentoFixtureIds],
    );
  }
  for (const id of movimentoFixtureIds) {
    await pool.query('DELETE FROM estoque_movimentos WHERE id = $1 AND empresa_id = 1', [id]);
  }
  if (empresaTesteId) {
    await pool.query('DELETE FROM empresas_modulos WHERE empresa_id = $1', [empresaTesteId]);
    await pool.query('DELETE FROM usuarios_empresas WHERE empresa_id = $1', [empresaTesteId]);
    await pool.query('DELETE FROM empresas WHERE id = $1', [empresaTesteId]);
  }
  for (const flag of flagsOriginais) {
    await pool.query('UPDATE modulos_sistema SET multiempresa_pronto = $1 WHERE codigo = $2', [flag.multiempresa_pronto, flag.codigo]);
  }
  await pool.end();
}
