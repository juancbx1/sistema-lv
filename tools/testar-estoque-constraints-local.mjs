import assert from 'node:assert/strict';
import pg from 'pg';

const connectionString = process.argv[2];
if (!connectionString || !connectionString.includes('127.0.0.1')) throw new Error('Somente banco local.');
const pool = new pg.Pool({ connectionString });
const tabelas = [
  'estoque_movimentos',
  'estoque_itens_arquivados',
  'produto_niveis_estoque_alerta',
  'inventario_sessoes',
  'inventario_itens',
  'log_montagem_kits',
];

try {
  const nulos = {};
  const empresas = {};
  for (const tabela of tabelas) {
    nulos[tabela] = (await pool.query(`SELECT COUNT(*)::int AS n FROM ${tabela} WHERE empresa_id IS NULL`)).rows[0].n;
    empresas[tabela] = (await pool.query(`SELECT empresa_id, COUNT(*)::int AS n FROM ${tabela} GROUP BY empresa_id ORDER BY empresa_id`)).rows;
    assert.equal(nulos[tabela], 0, `${tabela} possui empresa_id nulo`);
  }

  const migration = (await pool.query("SELECT id FROM sistema_migrations WHERE id = 'multiempresas-fase8-estoque-ensaio-v1'")).rows;
  assert.equal(migration.length, 1, 'marcador da migration ausente');

  await pool.query('BEGIN');
  let empresaTemporaria;
  try {
    empresaTemporaria = (await pool.query(`
      INSERT INTO empresas (codigo, razao_social, nome_fantasia, ativa, eh_legada)
      VALUES ('constraint-smoke-estoque', 'Constraint Smoke', 'Constraint Smoke', TRUE, FALSE)
      RETURNING id
    `)).rows[0].id;
    await assert.rejects(
      pool.query(`
        INSERT INTO estoque_movimentos (empresa_id, produto_id, quantidade, tipo_movimento)
        VALUES ($1, 1, 1, 'ENTRADA_MANUAL')
      `, [empresaTemporaria]),
      (error) => error.code === '23503',
      'FK composto de movimento/produto deveria bloquear troca de empresa',
    );
  } finally {
    await pool.query('ROLLBACK');
  }

  await pool.query('BEGIN');
  try {
    const key = `constraint-idempotency-${Date.now()}`;
    await pool.query(`
      INSERT INTO estoque_movimentos (empresa_id, idempotency_key, produto_id, quantidade, tipo_movimento)
      VALUES (1, $1, 1, 1, 'ENTRADA_MANUAL')
    `, [key]);
    await assert.rejects(
      pool.query(`
        INSERT INTO estoque_movimentos (empresa_id, idempotency_key, produto_id, quantidade, tipo_movimento)
        VALUES (1, $1, 1, 1, 'ENTRADA_MANUAL')
      `, [key]),
      (error) => error.code === '23505',
      'indice de idempotencia dos movimentos deveria bloquear duplicata',
    );
  } finally {
    await pool.query('ROLLBACK');
  }

  console.log(JSON.stringify({ aprovado: true, banco: connectionString, nulos, empresas, migration: migration[0].id }, null, 2));
} finally {
  await pool.end();
}
