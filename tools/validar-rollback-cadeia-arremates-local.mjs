import crypto from 'node:crypto';
import pg from 'pg';

const [sourceUrl, rollbackUrl] = process.argv.slice(2);
if (!sourceUrl || !rollbackUrl) throw new Error('Informe base fonte e base após rollback.');
for (const url of [sourceUrl, rollbackUrl]) {
  if (!url.includes('127.0.0.1') && !url.includes('localhost')) throw new Error('Somente bases locais são aceitas.');
}

const tabelas = [
  'arremates',
  'arremate_perdas',
  'sessoes_trabalho_arremate',
  'tempos_padrao_arremate',
  'log_assinaturas',
  'log_divergencias',
];
const pools = [new pg.Pool({ connectionString: sourceUrl }), new pg.Pool({ connectionString: rollbackUrl })];

function hashRows(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

async function snapshot(pool, table) {
  const result = await pool.query(`SELECT * FROM ${table} ORDER BY id`);
  return { total: result.rowCount, hash: hashRows(result.rows) };
}

async function schemaState(pool) {
  const columns = await pool.query(`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])
       AND column_name = 'empresa_id'
  `, [tabelas]);
  const names = [
    'uq_arremates_empresa_id', 'uq_arremate_perdas_empresa_id', 'uq_sessoes_arremate_empresa_id',
    'uq_tempos_arremate_empresa_id', 'uq_log_assinaturas_empresa_id', 'uq_log_divergencias_empresa_id',
    'fk_arremates_empresa', 'fk_arremates_produto_empresa', 'fk_arremates_op_empresa',
    'fk_arremates_usuario_empresa', 'fk_arremates_perda_empresa', 'fk_arremates_sessao_empresa',
    'fk_arremate_perdas_empresa', 'fk_sessoes_arremate_empresa', 'fk_sessoes_arremate_produto_empresa',
    'fk_sessoes_arremate_op_empresa', 'fk_sessoes_arremate_usuario_empresa', 'fk_sessoes_arremate_gerado_empresa',
    'fk_tempos_arremate_empresa', 'fk_tempos_arremate_produto_empresa', 'fk_log_assinaturas_empresa',
    'fk_log_assinaturas_arremate_empresa', 'fk_log_assinaturas_producao_empresa', 'fk_log_assinaturas_usuario_empresa',
    'fk_log_divergencias_empresa', 'fk_log_divergencias_arremate_empresa', 'fk_log_divergencias_producao_empresa',
    'fk_log_divergencias_reportou_empresa', 'fk_log_divergencias_resolveu_empresa',
  ];
  const constraints = await pool.query('SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])', [names]);
  const indices = await pool.query(`
    SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = ANY($1::text[])
  `, [[
    'idx_arremates_empresa_data', 'idx_arremates_empresa_op', 'idx_arremates_empresa_produto_variante',
    'idx_arremates_empresa_usuario_data', 'idx_arremate_perdas_empresa_data', 'idx_sessoes_arremate_empresa_status',
    'idx_sessoes_arremate_empresa_usuario', 'idx_sessoes_arremate_empresa_produto_variante',
    'idx_tempos_arremate_empresa_produto', 'idx_log_assinaturas_empresa_data', 'idx_log_divergencias_empresa_data',
  ]]);
  const marker = await pool.query('SELECT id FROM sistema_migrations WHERE id = $1', ['multiempresas-fase8-arremates-ensaio-v1']);
  return { columns: columns.rows, constraints: constraints.rows, indices: indices.rows, marker: marker.rows };
}

try {
  const comparacoes = {};
  for (const tabela of tabelas) {
    const [source, rollback] = await Promise.all(pools.map((pool) => snapshot(pool, tabela)));
    comparacoes[tabela] = { source, rollback, iguais: source.total === rollback.total && source.hash === rollback.hash };
  }
  const estado = await schemaState(pools[1]);
  const aprovado = Object.values(comparacoes).every((item) => item.iguais)
    && estado.columns.length === 0
    && estado.constraints.length === 0
    && estado.indices.length === 0
    && estado.marker.length === 0;
  console.log(JSON.stringify({ sourceUrl, rollbackUrl, comparacoes, estado, aprovado }, null, 2));
  if (!aprovado) process.exitCode = 2;
} finally {
  await Promise.all(pools.map((pool) => pool.end()));
}
