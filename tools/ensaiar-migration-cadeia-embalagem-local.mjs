import fs from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.argv[2];
const sqlPath = process.argv[3] || '_planejamento/migration-cadeia-fase8-embalagem-ensaio.sql';
const mode = process.argv[4] || 'apply';

if (!connectionString || (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost'))) {
  throw new Error('Informe uma conexao PostgreSQL local.');
}

const pool = new pg.Pool({ connectionString });
const constraintNames = [
  'uq_embalagens_realizadas_empresa_id',
  'fk_embalagens_realizadas_empresa',
  'fk_embalagens_realizadas_produto_empresa',
  'fk_embalagens_realizadas_usuario_empresa',
];
const indexNames = [
  'idx_embalagens_empresa_data',
  'idx_embalagens_empresa_produto_ref',
  'idx_embalagens_empresa_movimento',
  'uq_embalagens_empresa_idempotency',
];

async function rows(text, values = []) {
  return (await pool.query(text, values)).rows;
}

try {
  const sql = await fs.readFile(sqlPath, 'utf8');
  await pool.query(sql);
  const dados = (await rows(mode === 'apply'
    ? `
        SELECT
          (SELECT COUNT(*)::int FROM embalagens_realizadas) AS embalagens,
          (SELECT COUNT(*)::int FROM embalagens_realizadas WHERE empresa_id IS NULL) AS embalagens_sem_empresa,
          (SELECT COUNT(*)::int FROM embalagens_realizadas er JOIN produtos p ON p.id = er.produto_embalado_id WHERE p.empresa_id IS NULL OR p.empresa_id <> er.empresa_id) AS embalagens_produto_cruzado,
          (SELECT COUNT(*)::int FROM embalagens_realizadas WHERE empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada)) AS embalagens_legadas
      `
    : `SELECT COUNT(*)::int AS embalagens FROM embalagens_realizadas`))[0];
  const colunas = await rows(`
    SELECT column_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'embalagens_realizadas'
       AND column_name = 'empresa_id'
  `);
  const idempotencia = await rows(`
    SELECT column_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'embalagens_realizadas'
       AND column_name = 'idempotency_key'
  `);
  const constraints = await rows(
    'SELECT conname, contype, convalidated FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname',
    [constraintNames],
  );
  const indices = await rows(
    'SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2::text[]) ORDER BY indexname',
    ['public', indexNames],
  );
  const migration = await rows(
    'SELECT id, detalhes FROM sistema_migrations WHERE id = $1',
    ['multiempresas-fase8-embalagem-ensaio-v1'],
  );

  const aprovado = mode === 'apply'
    ? colunas.length === 1
      && colunas[0].is_nullable === 'NO'
      && idempotencia.length === 1
      && idempotencia[0].is_nullable === 'YES'
      && dados.embalagens_sem_empresa === 0
      && dados.embalagens_produto_cruzado === 0
      && constraints.length === constraintNames.length
      && indices.length === indexNames.length
      && migration.length === 1
    : colunas.length === 0 && idempotencia.length === 0 && constraints.length === 0 && indices.length === 0 && migration.length === 0;

  console.log(JSON.stringify({ mode, connectionString, dados, colunas, idempotencia, constraints, indices, migration, aprovado }, null, 2));
  if (!aprovado) process.exitCode = 1;
} finally {
  await pool.end();
}
