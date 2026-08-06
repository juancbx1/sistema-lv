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
let auditFixtureId;
const flagsOriginais = [];

function tokenParaEmpresa(empresaId) {
  return jwt.sign({ id: actorId, empresa_id: empresaId, superadministrador: false }, jwtSecret, { expiresIn: '1h' });
}

async function request(baseUrl, path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
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

  for (const codigo of ['permissoes', 'estoque']) {
    const modulo = (await pool.query(
      'SELECT codigo, multiempresa_pronto FROM modulos_sistema WHERE codigo = $1',
      [codigo],
    )).rows[0];
    assert.ok(modulo, `Módulo ${codigo} ausente no catálogo local.`);
    flagsOriginais.push(modulo);
    await pool.query(
      'UPDATE modulos_sistema SET multiempresa_pronto = TRUE, atualizado_em = NOW() WHERE codigo = $1',
      [codigo],
    );
  }

  empresaTesteId = (await pool.query(`
    INSERT INTO empresas (codigo, razao_social, nome_fantasia, ativa, eh_legada)
    VALUES ($1, 'Empresa Smoke Transversal', 'Empresa Smoke Transversal', TRUE, FALSE)
    RETURNING id
  `, [`empresa-smoke-transversal-${Date.now()}`])).rows[0].id;
  await pool.query(`
    INSERT INTO usuarios_empresas (usuario_id, empresa_id, tipos, permissoes, ativo, empresa_principal)
    VALUES ($1, $2, ARRAY['administrador'], '{}'::text[], TRUE, FALSE)
  `, [actorId, empresaTesteId]);
  for (const codigo of ['permissoes', 'estoque']) {
    await pool.query(`
      INSERT INTO empresas_modulos (empresa_id, modulo_codigo, habilitado, habilitado_em, atualizado_em)
      VALUES ($1, $2, TRUE, NOW(), NOW())
    `, [empresaTesteId, codigo]);
  }

  process.env.POSTGRES_URL = connectionString;
  process.env.JWT_SECRET = jwtSecret;
  process.env.NODE_ENV = 'test';
  const { default: app } = await import(`../api/index.js?transversal-http=${Date.now()}`);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenLegada = tokenParaEmpresa(1);
  const tokenSecundaria = tokenParaEmpresa(empresaTesteId);

  const auditLegada = await request(baseUrl, '/audit-log?page=1&limit=3', tokenLegada);
  assertStatus(auditLegada, 200, 'audit-log legado');
  assert.ok((auditLegada.payload?.logs || []).every((row) => row.empresa_id === 1), 'audit-log legado vazou empresa');

  const auditSecundaria = await request(baseUrl, '/audit-log?page=1&limit=3', tokenSecundaria);
  assertStatus(auditSecundaria, 200, 'audit-log secundário');
  assert.equal(auditSecundaria.payload?.logs?.length || 0, 0, 'audit-log secundário recebeu histórico legado');

  const usuariosLegada = await request(baseUrl, '/audit-log/usuarios', tokenLegada);
  assertStatus(usuariosLegada, 200, 'usuários do audit-log legado');
  const usuariosSecundaria = await request(baseUrl, '/audit-log/usuarios', tokenSecundaria);
  assertStatus(usuariosSecundaria, 200, 'usuários do audit-log secundário');
  assert.ok(
    usuariosSecundaria.payload?.every((row) => row.usuario_id === actorId),
    'lista de usuários do audit-log secundário cruzou vínculos'
  );

  const estoqueLegado = await request(baseUrl, '/estoque/auditoria?page=1&limit=3', tokenLegada);
  assertStatus(estoqueLegado, 200, 'auditoria de estoque legada');
  assert.ok((estoqueLegado.payload?.rows || []).every((row) => row.empresa_id === 1), 'auditoria de estoque legada vazou empresa');

  const estoqueSecundario = await request(baseUrl, '/estoque/auditoria?page=1&limit=3', tokenSecundaria);
  assertStatus(estoqueSecundario, 200, 'auditoria de estoque secundária');
  assert.equal(estoqueSecundario.payload?.rows?.length || 0, 0, 'auditoria de estoque secundária recebeu histórico legado');

  const { registrarAuditoria } = await import(`../api/audit.js?transversal-audit=${Date.now()}`);
  await registrarAuditoria(
    null,
    { id: actorId, nome: 'Smoke Transversal', empresa_id: empresaTesteId },
    'transversal.smoke',
    'smoke',
    `transversal-${Date.now()}`,
    { empresa_id: empresaTesteId },
  );
  const auditFixture = (await pool.query(`
    SELECT id, empresa_id
      FROM audit_log
     WHERE empresa_id = $1 AND acao = 'transversal.smoke'
     ORDER BY id DESC
     LIMIT 1
  `, [empresaTesteId])).rows[0];
  assert.ok(auditFixture, 'helper de auditoria não gravou evento empresarial');
  auditFixtureId = auditFixture.id;
  assert.equal(auditFixture.empresa_id, empresaTesteId);

  console.log(JSON.stringify({
    aprovado: true,
    banco: connectionString,
    verificacoes: {
      auditLogLegadoIsolado: true,
      auditLogSecundarioVazio: true,
      usuariosDoAuditLogContextuais: true,
      auditoriaEstoqueLegadaIsolada: true,
      auditoriaEstoqueSecundariaVazia: true,
      writerAuditLogEmpresarial: true,
    },
  }, null, 2));
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (auditFixtureId) await pool.query('DELETE FROM audit_log WHERE id = $1', [auditFixtureId]);
  if (empresaTesteId) {
    await pool.query('DELETE FROM empresas_modulos WHERE empresa_id = $1', [empresaTesteId]);
    await pool.query('DELETE FROM usuarios_empresas WHERE empresa_id = $1', [empresaTesteId]);
    await pool.query('DELETE FROM empresas WHERE id = $1', [empresaTesteId]);
  }
  for (const modulo of flagsOriginais) {
    await pool.query(
      'UPDATE modulos_sistema SET multiempresa_pronto = $1, atualizado_em = NOW() WHERE codigo = $2',
      [modulo.multiempresa_pronto, modulo.codigo],
    );
  }
  await pool.end();
}
