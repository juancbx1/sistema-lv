import pg from 'pg';

const { Pool } = pg;
const database = process.argv[2] || 'sistema_lv_cadeia_arremates_test';
const connectionString = `postgresql://postgres@127.0.0.1:55432/${database}`;
const pool = new Pool({ connectionString });

const tabelas = [
  'arremates',
  'arremate_perdas',
  'sessoes_trabalho_arremate',
  'tempos_padrao_arremate',
  'embalagens_realizadas',
  'log_assinaturas',
  'log_divergencias',
];

try {
  const resultado = {};
  for (const tabela of tabelas) {
    const colunas = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [tabela],
    );
    const contagem = await pool.query(`SELECT COUNT(*)::int AS total FROM public.${tabela}`);
    const constraints = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'public.${tabela}'::regclass
        ORDER BY conname`,
    );
    const indices = await pool.query(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1
        ORDER BY indexname`,
      [tabela],
    );
    resultado[tabela] = {
      colunas: colunas.rows,
      total: contagem.rows[0].total,
      constraints: constraints.rows,
      indices: indices.rows,
    };
  }

  for (const tabela of ['arremates', 'arremate_perdas', 'tempos_padrao_arremate']) {
    const amostra = await pool.query(`SELECT * FROM public.${tabela} ORDER BY 1 LIMIT 3`);
    resultado[tabela].amostra = amostra.rows;
  }

  console.log(JSON.stringify({ database, tabelas: resultado }, null, 2));
} finally {
  await pool.end();
}
