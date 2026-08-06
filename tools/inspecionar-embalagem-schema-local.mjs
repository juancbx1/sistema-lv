import pg from 'pg';

const { Pool } = pg;
const database = process.argv[2] || 'sistema_lv_cadeia_embalagem_test';
if (!database || database.includes('/') || database.includes('\\')) {
  throw new Error('Informe apenas o nome de uma base local.');
}
const connectionString = `postgresql://postgres@127.0.0.1:55432/${database}`;
const pool = new Pool({ connectionString });

const tabelas = [
  'embalagens_realizadas',
  'estoque_movimentos',
  'estoque_itens_arquivados',
  'kits',
  'arremates',
  'ordens_de_producao',
  'produtos',
];

try {
  const resultado = {};
  for (const tabela of tabelas) {
    const existe = await pool.query(
      `SELECT to_regclass($1) IS NOT NULL AS existe`,
      [`public.${tabela}`],
    );
    if (!existe.rows[0].existe) {
      resultado[tabela] = { existe: false };
      continue;
    }
    const colunas = await pool.query(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
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
      existe: true,
      colunas: colunas.rows,
      total: contagem.rows[0].total,
      constraints: constraints.rows,
      indices: indices.rows,
    };
  }

  const amostras = {};
  for (const [tabela, query] of Object.entries({
    embalagens_realizadas: `SELECT * FROM public.embalagens_realizadas ORDER BY id LIMIT 3`,
    estoque_movimentos: `SELECT * FROM public.estoque_movimentos ORDER BY id LIMIT 3`,
    estoque_itens_arquivados: `SELECT * FROM public.estoque_itens_arquivados ORDER BY 1 LIMIT 3`,
    arremates: `SELECT id, produto_id, variante, op_numero, tipo_lancamento, quantidade_arrematada, quantidade_ja_embalada FROM public.arremates ORDER BY id LIMIT 3`,
    ordens_de_producao: `SELECT id, numero, produto_id, status, empresa_id FROM public.ordens_de_producao ORDER BY id LIMIT 3`,
    produtos: `SELECT id, nome, sku, empresa_id, is_kit FROM public.produtos ORDER BY id LIMIT 3`,
  })) {
    if (resultado[tabela]?.existe) {
      amostras[tabela] = (await pool.query(query)).rows;
    }
  }

  console.log(JSON.stringify({ database, tabelas: resultado, amostras }, null, 2));
} finally {
  await pool.end();
}
