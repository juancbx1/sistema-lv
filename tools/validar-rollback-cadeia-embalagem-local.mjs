import pg from 'pg';

const baselineUrl = process.argv[2];
const rollbackUrl = process.argv[3];
if (![baselineUrl, rollbackUrl].every((url) => url && (url.includes('127.0.0.1') || url.includes('localhost'))) ) {
  throw new Error('Informe duas conexoes PostgreSQL locais.');
}

const tabelas = ['embalagens_realizadas', 'estoque_movimentos', 'arremates'];

async function fingerprint(url) {
  const pool = new pg.Pool({ connectionString: url });
  try {
    const resultado = {};
    for (const tabela of tabelas) {
      const result = await pool.query(`
        SELECT
          COUNT(*)::int AS total,
          md5(COALESCE(string_agg(row_to_json(t)::text, E'\\n' ORDER BY t.id), '')) AS hash
          FROM (SELECT * FROM ${tabela} ORDER BY id) t
      `);
      resultado[tabela] = result.rows[0];
    }
    return resultado;
  } finally {
    await pool.end();
  }
}

const baseline = await fingerprint(baselineUrl);
const rollback = await fingerprint(rollbackUrl);
const aprovado = tabelas.every(
  (tabela) => baseline[tabela].total === rollback[tabela].total
    && baseline[tabela].hash === rollback[tabela].hash,
);

console.log(JSON.stringify({ aprovado, baseline, rollback }, null, 2));
if (!aprovado) process.exitCode = 1;
