import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

const sourceConnection = process.argv[2];
const rollbackConnection = process.argv[3];
if (!sourceConnection || !rollbackConnection) throw new Error('Informe origem e rollback locais.');
for (const connection of [sourceConnection, rollbackConnection]) {
  if (!connection.includes('127.0.0.1') && !connection.includes('localhost')) throw new Error('Somente PostgreSQL local.');
}

const source = new pg.Pool({ connectionString: sourceConnection });
const rollback = new pg.Pool({ connectionString: rollbackConnection });
const tabelas = [
  ['comissoes_pagas', 'id'],
  ['audit_log', 'id'],
  ['auditoria_eventos', 'id'],
  ['eventos_sistema', 'id'],
  ['historico_alertas', 'id'],
  ['alertas_configuracoes_gerais', 'chave'],
];

function hashRows(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

async function snapshot(pool, table, orderBy) {
  const rows = (await pool.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`)).rows;
  return { rows, hash: hashRows(rows) };
}

async function hasColumn(pool, table, column) {
  return (await pool.query(`
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
  `, [table, column])).rowCount === 1;
}

async function hasTable(pool, table) {
  return (await pool.query(`
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1
  `, [table])).rowCount === 1;
}

try {
  const comparacao = {};
  for (const [table, orderBy] of tabelas) {
    const origem = await snapshot(source, table, orderBy);
    const aposRollback = await snapshot(rollback, table, orderBy);
    assert.deepEqual(aposRollback.rows, origem.rows, `Linhas divergentes em ${table}`);
    assert.equal(aposRollback.hash, origem.hash, `Hash divergente em ${table}`);
    comparacao[table] = { hash: origem.hash, linhas: origem.rows.length };
  }

  for (const table of ['comissoes_pagas', 'audit_log', 'auditoria_eventos', 'eventos_sistema', 'historico_alertas', 'alertas_configuracoes_gerais']) {
    assert.equal(await hasColumn(rollback, table, 'empresa_id'), false, `${table}.empresa_id ainda existe`);
  }
  assert.equal(await hasTable(rollback, 'configuracoes_alertas_empresas'), false, 'overrides de alertas ainda existem');

  const markers = (await rollback.query(`
    SELECT id FROM sistema_migrations
     WHERE id IN ('multiempresas-fase8-alertas-ensaio-v1', 'multiempresas-fase8-transversais-ensaio-v1')
  `)).rows;
  assert.equal(markers.length, 0, 'marcadores do ensaio ainda existem');

  console.log(JSON.stringify({ aprovado: true, comparacao }, null, 2));
} finally {
  await source.end();
  await rollback.end();
}
