import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.argv[2];
if (!connectionString || !/^postgresql:\/\/(postgres@)?(127\.0\.0\.1|localhost):\d+\//.test(connectionString)) {
  throw new Error('O smoke aceita somente uma URL PostgreSQL local explicita.');
}

const jwtSecret = process.env.JWT_SECRET || 'segredo-local-teste-cadeia-producao';
const pool = new Pool({ connectionString, max: 8 });
let server;
let actorId;
let empresaTesteId;
let embalagemFixtureId;
let movimentoFixtureId;
let estornoFixtureId;
let estornoOrigemMovimentoId;
let estornoMovimentoFixtureId;
let estornoArremateId;
let estornoArremateQuantidadeOriginal;
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
    SELECT u.id, u.nome
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

  for (const codigo of ['embalagem', 'estoque', 'produtos']) {
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

  const empresa = (await pool.query(`
    INSERT INTO empresas (codigo, razao_social, nome_fantasia, ativa, eh_legada)
    VALUES ($1, 'Empresa Smoke Embalagem', 'Empresa Smoke Embalagem', TRUE, FALSE)
    RETURNING id
  `, [`empresa-smoke-embalagem-${Date.now()}`])).rows[0];
  empresaTesteId = empresa.id;
  await pool.query(`
    INSERT INTO usuarios_empresas (usuario_id, empresa_id, tipos, permissoes, ativo, empresa_principal)
    VALUES ($1, $2, ARRAY['administrador'], '{}'::text[], TRUE, FALSE)
  `, [actorId, empresaTesteId]);
  for (const codigo of ['embalagem', 'estoque', 'produtos']) {
    await pool.query(`
      INSERT INTO empresas_modulos (empresa_id, modulo_codigo, habilitado, habilitado_em, atualizado_em)
      VALUES ($1, $2, TRUE, NOW(), NOW())
    `, [empresaTesteId, codigo]);
  }

  const produto = (await pool.query(`
    SELECT id, sku
      FROM produtos
     WHERE empresa_id = 1
       AND sku IS NOT NULL
     ORDER BY id
     LIMIT 1
  `)).rows[0];
  assert.ok(produto, 'Produto legado com SKU e obrigatorio para o smoke.');

  process.env.POSTGRES_URL = connectionString;
  process.env.JWT_SECRET = jwtSecret;
  const { default: app } = await import(`../api/index.js?embalagem-http=${Date.now()}`);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const tokenLegada = tokenParaEmpresa(1);
  const tokenSecundaria = tokenParaEmpresa(empresaTesteId);

  const rotas = [
    `/embalagens/historico?produto_ref_id=${encodeURIComponent(produto.sku)}&page=1&limit=1`,
    '/embalagens/contagem-hoje',
    '/embalagens/fila?todos=true',
    '/embalagens/historico-geral?periodo=7d&page=1&limit=1',
    '/embalagens/fila/contagem-antigos',
    `/embalagens/sugestao-estoque?produto_id=${produto.id}&produto_ref_id=${encodeURIComponent(produto.sku)}&variante=-`,
    '/ops-para-embalagem?all=true',
  ];
  for (const rota of rotas) {
    const legado = await request(baseUrl, rota, tokenLegada);
    assertStatus(legado, 200, `${rota} legado`);
    const secundario = await request(baseUrl, rota, tokenSecundaria);
    assertStatus(secundario, 403, `${rota} secundario`);
    assert.equal(secundario.payload?.codigo, 'CADEIA_PRODUTIVA_NAO_MIGRADA', `${rota} secundario`);
  }

  const payloadEntrada = {
    produto_id: produto.id,
    variante_nome: '-',
    quantidade_entrada: 1,
    produto_ref_id: produto.sku,
    empresa_id: empresaTesteId,
    observacao: 'smoke embalagem idempotencia',
  };
  const idempotencyKey = `smoke-embalagem-${Date.now()}`;
  const primeiraEntrada = await request(baseUrl, '/estoque/entrada-producao', tokenLegada, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payloadEntrada),
  });
  assertStatus(primeiraEntrada, 201, 'POST /estoque/entrada-producao legado');
  movimentoFixtureId = primeiraEntrada.payload?.movimento_estoque_id;
  assert.ok(movimentoFixtureId, 'A entrada deve retornar o movimento temporario.');

  const segundaEntrada = await request(baseUrl, '/estoque/entrada-producao', tokenLegada, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payloadEntrada),
  });
  assertStatus(segundaEntrada, 200, 'repeticao idempotente de entrada');
  assert.equal(segundaEntrada.payload?.idempotente, true);
  assert.equal(segundaEntrada.payload?.movimento_estoque_id, movimentoFixtureId);

  const fixture = (await pool.query(
    'SELECT id, empresa_id FROM embalagens_realizadas WHERE empresa_id = 1 AND idempotency_key = $1',
    [idempotencyKey],
  )).rows;
  assert.equal(fixture.length, 1, 'A repeticao nao pode duplicar embalagens_realizadas.');
  embalagemFixtureId = fixture[0].id;
  assert.equal(fixture[0].empresa_id, 1, 'O body nao pode trocar a empresa da embalagem.');

  const arremateEstorno = (await pool.query(`
    SELECT id, produto_id, variante, quantidade_ja_embalada
      FROM arremates
     WHERE empresa_id = 1
       AND tipo_lancamento = 'PRODUCAO'
     ORDER BY id
     LIMIT 1
  `)).rows[0];
  assert.ok(arremateEstorno, 'Arremate legado para estorno e obrigatorio.');
  estornoArremateId = arremateEstorno.id;
  estornoArremateQuantidadeOriginal = arremateEstorno.quantidade_ja_embalada;
  estornoOrigemMovimentoId = (await pool.query(`
    INSERT INTO estoque_movimentos
      (empresa_id, produto_id, variante_nome, quantidade, tipo_movimento, origem_arremate_id, usuario_responsavel, observacao)
    VALUES (1, $1, $2, 1, 'ENTRADA_PRODUCAO', $3, $4, 'smoke embalagem estorno origem')
    RETURNING id
  `, [arremateEstorno.produto_id, arremateEstorno.variante, arremateEstorno.id, actor.nome])).rows[0].id;
  estornoFixtureId = (await pool.query(`
    INSERT INTO embalagens_realizadas
      (empresa_id, tipo_embalagem, produto_embalado_id, variante_embalada_nome, quantidade_embalada,
       usuario_responsavel_id, observacao, movimento_estoque_id, status)
    VALUES (1, 'UNIDADE', $1, $2, 1, $3, 'smoke embalagem estorno', $4, 'ATIVO')
    RETURNING id
  `, [arremateEstorno.produto_id, arremateEstorno.variante, actorId, estornoOrigemMovimentoId])).rows[0].id;
  const estorno = await request(baseUrl, '/embalagens/estornar', tokenLegada, {
    method: 'POST',
    body: JSON.stringify({ id_embalagem_realizada: estornoFixtureId }),
  });
  assertStatus(estorno, 200, 'POST /embalagens/estornar legado');
  const estadoEstorno = (await pool.query(
    'SELECT status FROM embalagens_realizadas WHERE id = $1 AND empresa_id = 1',
    [estornoFixtureId],
  )).rows[0];
  assert.equal(estadoEstorno?.status, 'ESTORNADO');
  estornoMovimentoFixtureId = (await pool.query(
    'SELECT id FROM estoque_movimentos WHERE empresa_id = 1 AND idempotency_key = $1',
    [`embalagem-estorno:1:${estornoFixtureId}`],
  )).rows[0]?.id || estornoMovimentoFixtureId;

  const escritaSecundaria = await request(baseUrl, '/estoque/entrada-producao', tokenSecundaria, {
    method: 'POST',
    headers: { 'Idempotency-Key': `secundaria-${Date.now()}` },
    body: JSON.stringify(payloadEntrada),
  });
  assertStatus(escritaSecundaria, 403, 'POST /estoque/entrada-producao secundario');
  assert.equal(escritaSecundaria.payload?.codigo, 'CADEIA_PRODUTIVA_NAO_MIGRADA');

  const kitSecundario = await request(baseUrl, '/kits/montar', tokenSecundaria, {
    method: 'POST',
    body: JSON.stringify({ kit_produto_id: produto.id, empresa_id: empresaTesteId }),
  });
  assertStatus(kitSecundario, 403, 'POST /kits/montar secundario');
  assert.equal(kitSecundario.payload?.codigo, 'CADEIA_PRODUTIVA_NAO_MIGRADA');

  console.log(JSON.stringify({
    aprovado: true,
    banco: connectionString,
    verificacoes: {
      rotasLegadasComContexto: rotas.length,
      rotasSecundariasFalhamFechado: rotas.length,
      bodyNaoTrocaEmpresa: true,
      entradaIdempotente: true,
      estornoEmpresarial: true,
      escritaSecundariaBloqueada: true,
      montagemKitSecundariaBloqueada: true,
    },
  }, null, 2));
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (embalagemFixtureId) {
    await pool.query('DELETE FROM embalagens_realizadas WHERE id = $1 AND empresa_id = 1', [embalagemFixtureId]);
  }
  if (estornoFixtureId) {
    await pool.query('DELETE FROM embalagens_realizadas WHERE id = $1 AND empresa_id = 1', [estornoFixtureId]);
  }
  if (movimentoFixtureId) {
    await pool.query('DELETE FROM estoque_movimentos WHERE id = $1', [movimentoFixtureId]);
  }
  if (estornoOrigemMovimentoId) {
    await pool.query('DELETE FROM estoque_movimentos WHERE id = $1', [estornoOrigemMovimentoId]);
  }
  if (estornoMovimentoFixtureId && estornoMovimentoFixtureId !== estornoOrigemMovimentoId) {
    await pool.query('DELETE FROM estoque_movimentos WHERE id = $1', [estornoMovimentoFixtureId]);
  }
  if (estornoArremateId !== undefined && estornoArremateQuantidadeOriginal !== undefined) {
    await pool.query(
      'UPDATE arremates SET quantidade_ja_embalada = $1 WHERE id = $2 AND empresa_id = 1',
      [estornoArremateQuantidadeOriginal, estornoArremateId],
    );
  }
  if (empresaTesteId) {
    await pool.query('DELETE FROM empresas_modulos WHERE empresa_id = $1', [empresaTesteId]);
    await pool.query('DELETE FROM usuarios_empresas WHERE empresa_id = $1', [empresaTesteId]);
    await pool.query('DELETE FROM empresas WHERE id = $1', [empresaTesteId]);
  }
  for (const flag of flagsOriginais) {
    await pool.query(
      'UPDATE modulos_sistema SET multiempresa_pronto = $1, atualizado_em = NOW() WHERE codigo = $2',
      [flag.multiempresa_pronto, flag.codigo],
    );
  }
  await pool.end();
}
