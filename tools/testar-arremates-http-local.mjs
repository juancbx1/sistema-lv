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
let arremateFixtureId;
const flagsOriginais = [];

function tokenParaEmpresa(empresaId) {
  return jwt.sign({ id: actorId, empresa_id: empresaId, superadministrador: false }, jwtSecret, { expiresIn: '1h' });
}

async function request(baseUrl, path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
  assert.ok(actor, 'Administrador ativo na empresa legada é obrigatório.');
  actorId = actor.id;

  const modulo = (await pool.query(
    `SELECT codigo, multiempresa_pronto FROM modulos_sistema WHERE codigo = 'arremates'`,
  )).rows[0];
  assert.ok(modulo, 'Módulo arremates ausente no catálogo local.');
  flagsOriginais.push(modulo);
  await pool.query(
    `UPDATE modulos_sistema SET multiempresa_pronto = TRUE, atualizado_em = NOW() WHERE codigo = 'arremates'`,
  );

  const empresa = (await pool.query(`
    INSERT INTO empresas (codigo, razao_social, nome_fantasia, ativa, eh_legada)
    VALUES ($1, 'Empresa Smoke Arremates', 'Empresa Smoke Arremates', TRUE, FALSE)
    RETURNING id
  `, [`empresa-smoke-arremates-${Date.now()}`])).rows[0];
  empresaTesteId = empresa.id;
  await pool.query(`
    INSERT INTO usuarios_empresas (usuario_id, empresa_id, tipos, permissoes, ativo, empresa_principal)
    VALUES ($1, $2, ARRAY['administrador'], '{}'::text[], TRUE, FALSE)
  `, [actorId, empresaTesteId]);
  await pool.query(`
    INSERT INTO empresas_modulos (empresa_id, modulo_codigo, habilitado, habilitado_em, atualizado_em)
    VALUES ($1, 'arremates', TRUE, NOW(), NOW())
  `, [empresaTesteId]);

  const origem = (await pool.query(`
    SELECT op.numero, op.edit_id, op.produto_id, op.variante
      FROM ordens_de_producao op
     WHERE op.empresa_id = 1
       AND op.produto_id IS NOT NULL
     ORDER BY op.id
     LIMIT 1
  `)).rows[0];
  assert.ok(origem, 'OP legada com produto é obrigatória para o smoke de escrita.');

  process.env.POSTGRES_URL = connectionString;
  process.env.JWT_SECRET = jwtSecret;
  const { default: app } = await import(`../api/index.js?arremates-http=${Date.now()}`);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const tokenLegada = tokenParaEmpresa(1);
  const tokenSecundaria = tokenParaEmpresa(empresaTesteId);

  const payloadEscrita = {
    op_numero: origem.numero,
    op_edit_id: origem.edit_id,
    produto_id: origem.produto_id,
    variante: origem.variante || '-',
    quantidade_arrematada: 1,
    usuario_tiktik: actor.nome,
    usuario_tiktik_id: actorId,
    empresa_id: empresaTesteId,
  };
  const criacao = await request(baseUrl, '/arremates', tokenLegada, {
    method: 'POST',
    body: JSON.stringify(payloadEscrita),
  });
  assertStatus(criacao, 201, 'POST /arremates legado');
  arremateFixtureId = criacao.payload?.id;
  assert.ok(arremateFixtureId, 'O smoke precisa identificar o arremate temporário.');
  assert.equal(criacao.payload?.empresa_id, 1, 'O body não pode trocar a empresa do arremate.');

  const rotas = [
    `/arremates?fetchAll=true&limit=1`,
    `/arremates/historico?periodo=7d&page=1&limit=1`,
    `/arremates/fila?fetchAll=true`,
    `/arremates/status-tiktiks`,
    `/arremates/tempos-padrao`,
    `/arremates/contagem-hoje`,
    `/arremates/historico-produto?produto_id=${origem.produto_id}&variante=-&page=1&limit=1`,
    `/arremates/desempenho-diario/${actorId}`,
    `/arremates/externos-recentes`,
  ];
  for (const rota of rotas) {
    const legado = await request(baseUrl, rota, tokenLegada);
    assertStatus(legado, 200, `${rota} legado`);
    const secundario = await request(baseUrl, rota, tokenSecundaria);
    assertStatus(secundario, 403, `${rota} secundário`);
    assert.equal(secundario.payload?.codigo, 'CADEIA_PRODUTIVA_NAO_MIGRADA', `${rota} secundário`);
  }

  const escritaSecundaria = await request(baseUrl, '/arremates', tokenSecundaria, {
    method: 'POST',
    body: JSON.stringify(payloadEscrita),
  });
  assertStatus(escritaSecundaria, 403, 'POST /arremates secundário');
  assert.equal(escritaSecundaria.payload?.codigo, 'CADEIA_PRODUTIVA_NAO_MIGRADA');

  console.log(JSON.stringify({
    aprovado: true,
    banco: connectionString,
    verificacoes: {
      rotasLegadasComContexto: rotas.length,
      rotasSecundariasFalhamFechado: rotas.length,
      criacaoIgnoraEmpresaDoBody: true,
      escritaSecundariaBloqueada: true,
    },
  }, null, 2));
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (arremateFixtureId) {
    await pool.query('DELETE FROM audit_log WHERE entidade = $1 AND entidade_id = $2', ['arremate', String(arremateFixtureId)]);
    await pool.query('DELETE FROM arremates WHERE id = $1 AND empresa_id = 1', [arremateFixtureId]);
  }
  if (empresaTesteId) {
    await pool.query('DELETE FROM empresas_modulos WHERE empresa_id = $1', [empresaTesteId]);
    await pool.query('DELETE FROM usuarios_empresas WHERE empresa_id = $1', [empresaTesteId]);
    await pool.query('DELETE FROM empresas WHERE id = $1', [empresaTesteId]);
  }
  for (const flag of flagsOriginais) {
    await pool.query('UPDATE modulos_sistema SET multiempresa_pronto = $1, atualizado_em = NOW() WHERE codigo = $2', [flag.multiempresa_pronto, flag.codigo]);
  }
  await pool.end();
}
