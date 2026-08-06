import pg from 'pg';

const baselineUrl = process.argv[2];
const rollbackUrl = process.argv[3];
if (![baselineUrl, rollbackUrl].every((url) => url && (url.includes('127.0.0.1') || url.includes('localhost')))) {
  throw new Error('Informe duas conexoes PostgreSQL locais.');
}

const tabelas = [
  'estoque_movimentos',
  'estoque_itens_arquivados',
  'produto_niveis_estoque_alerta',
  'inventario_sessoes',
  'inventario_itens',
  'log_montagem_kits',
];

async function fingerprint(url) {
  const pool = new pg.Pool({ connectionString: url });
  try {
    const resultado = {};
    for (const tabela of tabelas) {
      const result = await pool.query(`
        SELECT COUNT(*)::int AS total,
               md5(COALESCE(string_agg(row_to_json(t)::text, E'\\n' ORDER BY t.id), '')) AS hash
          FROM (SELECT * FROM ${tabela} ORDER BY id) t
      `);
      const columns = await pool.query(`
        SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position
      `, [tabela]);
      resultado[tabela] = { ...result.rows[0], columns: columns.rows };
    }
    return resultado;
  } finally {
    await pool.end();
  }
}

const baseline = await fingerprint(baselineUrl);
const rollback = await fingerprint(rollbackUrl);
const aprovado = tabelas.every((tabela) =>
  baseline[tabela].total === rollback[tabela].total
  && baseline[tabela].hash === rollback[tabela].hash
  && JSON.stringify(baseline[tabela].columns) === JSON.stringify(rollback[tabela].columns));

console.log(JSON.stringify({ aprovado, baseline, rollback }, null, 2));
if (!aprovado) process.exitCode = 1;
