import pg from 'pg';

const database = process.argv[2] || 'sistema_lv_cadeia_estoque_test';
if (!database || database.includes('/') || database.includes('\\')) throw new Error('Informe apenas o nome da base local.');
const pool = new pg.Pool({ connectionString: `postgresql://postgres@127.0.0.1:55432/${database}` });
const tabelas = [
  'estoque_movimentos',
  'estoque_itens_arquivados',
  'produto_niveis_estoque_alerta',
  'inventario_sessoes',
  'inventario_itens',
  'log_montagem_kits',
];

try {
  const resultado = {};
  for (const tabela of tabelas) {
    const existe = (await pool.query('SELECT to_regclass($1) IS NOT NULL AS existe', [`public.${tabela}`])).rows[0].existe;
    if (!existe) {
      resultado[tabela] = { existe: false };
      continue;
    }
    const colunas = await pool.query(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`, [tabela],
    );
    const total = await pool.query(`SELECT COUNT(*)::int AS total FROM public.${tabela}`);
    const constraints = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'public.${tabela}'::regclass
        ORDER BY conname`,
    );
    const indices = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1 ORDER BY indexname`, [tabela],
    );
    resultado[tabela] = { existe: true, total: total.rows[0].total, colunas: colunas.rows, constraints: constraints.rows, indices: indices.rows };
  }

  const amostras = {};
  for (const tabela of tabelas) {
    if (resultado[tabela]?.existe) {
      amostras[tabela] = (await pool.query(`SELECT * FROM public.${tabela} ORDER BY 1 LIMIT 3`)).rows;
    }
  }
  console.log(JSON.stringify({ database, tabelas: resultado, amostras }, null, 2));
} finally {
  await pool.end();
}
