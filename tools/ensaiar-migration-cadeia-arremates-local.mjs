import fs from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.argv[2];
const sqlPath = process.argv[3] || '_planejamento/migration-cadeia-fase8-arremates-ensaio.sql';
const mode = process.argv[4] || 'apply';

if (!connectionString || (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost'))) {
  throw new Error('Informe uma conexão PostgreSQL local.');
}

const pool = new pg.Pool({ connectionString });
const nomesConstraints = [
  'uq_arremates_empresa_id',
  'uq_arremate_perdas_empresa_id',
  'uq_sessoes_arremate_empresa_id',
  'uq_tempos_arremate_empresa_id',
  'uq_log_assinaturas_empresa_id',
  'uq_log_divergencias_empresa_id',
  'fk_arremates_empresa',
  'fk_arremates_produto_empresa',
  'fk_arremates_op_empresa',
  'fk_arremates_usuario_empresa',
  'fk_arremates_perda_empresa',
  'fk_arremates_sessao_empresa',
  'fk_arremate_perdas_empresa',
  'fk_sessoes_arremate_empresa',
  'fk_sessoes_arremate_produto_empresa',
  'fk_sessoes_arremate_op_empresa',
  'fk_sessoes_arremate_usuario_empresa',
  'fk_sessoes_arremate_gerado_empresa',
  'fk_tempos_arremate_empresa',
  'fk_tempos_arremate_produto_empresa',
  'fk_log_assinaturas_empresa',
  'fk_log_assinaturas_arremate_empresa',
  'fk_log_assinaturas_producao_empresa',
  'fk_log_assinaturas_usuario_empresa',
  'fk_log_divergencias_empresa',
  'fk_log_divergencias_arremate_empresa',
  'fk_log_divergencias_producao_empresa',
  'fk_log_divergencias_reportou_empresa',
  'fk_log_divergencias_resolveu_empresa',
];
const nomesIndices = [
  'idx_arremates_empresa_data',
  'idx_arremates_empresa_op',
  'idx_arremates_empresa_produto_variante',
  'idx_arremates_empresa_usuario_data',
  'idx_arremate_perdas_empresa_data',
  'idx_sessoes_arremate_empresa_status',
  'idx_sessoes_arremate_empresa_usuario',
  'idx_sessoes_arremate_empresa_produto_variante',
  'idx_tempos_arremate_empresa_produto',
  'idx_log_assinaturas_empresa_data',
  'idx_log_divergencias_empresa_data',
];

async function rows(text, values = []) {
  return (await pool.query(text, values)).rows;
}

try {
  const sql = await fs.readFile(sqlPath, 'utf8');
  await pool.query(sql);
  const dados = mode === 'apply'
    ? await rows(`
        SELECT
          (SELECT COUNT(*)::int FROM arremates) AS arremates,
          (SELECT COUNT(*)::int FROM arremates WHERE empresa_id IS NULL) AS arremates_sem_empresa,
          (SELECT COUNT(*)::int FROM arremate_perdas) AS perdas,
          (SELECT COUNT(*)::int FROM arremate_perdas WHERE empresa_id IS NULL) AS perdas_sem_empresa,
          (SELECT COUNT(*)::int FROM sessoes_trabalho_arremate) AS sessoes,
          (SELECT COUNT(*)::int FROM sessoes_trabalho_arremate WHERE empresa_id IS NULL) AS sessoes_sem_empresa,
          (SELECT COUNT(*)::int FROM tempos_padrao_arremate) AS tempos,
          (SELECT COUNT(*)::int FROM tempos_padrao_arremate WHERE empresa_id IS NULL) AS tempos_sem_empresa,
          (SELECT COUNT(*)::int FROM log_assinaturas) AS log_assinaturas,
          (SELECT COUNT(*)::int FROM log_assinaturas WHERE empresa_id IS NULL) AS log_assinaturas_sem_empresa,
          (SELECT COUNT(*)::int FROM log_divergencias) AS log_divergencias,
          (SELECT COUNT(*)::int FROM log_divergencias WHERE empresa_id IS NULL) AS log_divergencias_sem_empresa,
          (SELECT COUNT(*)::int FROM arremates a LEFT JOIN ordens_de_producao op ON op.numero = a.op_numero WHERE op.id IS NULL) AS arremates_sem_op_pai,
          (SELECT COUNT(*)::int FROM sessoes_trabalho_arremate s LEFT JOIN ordens_de_producao op ON op.numero = s.op_numero WHERE s.op_numero IS NOT NULL AND op.id IS NULL) AS sessoes_sem_op_pai,
          (SELECT COUNT(*)::int FROM arremate_perdas ap LEFT JOIN arremates a ON a.id_perda_origem = ap.id WHERE a.id IS NULL) AS perdas_sem_arremate_origem
      `)
    : await rows(`
        SELECT
          (SELECT COUNT(*)::int FROM arremates) AS arremates,
          (SELECT COUNT(*)::int FROM arremate_perdas) AS perdas,
          (SELECT COUNT(*)::int FROM sessoes_trabalho_arremate) AS sessoes,
          (SELECT COUNT(*)::int FROM tempos_padrao_arremate) AS tempos,
          (SELECT COUNT(*)::int FROM log_assinaturas) AS log_assinaturas,
          (SELECT COUNT(*)::int FROM log_divergencias) AS log_divergencias
      `);
  const colunas = await rows(`
    SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])
       AND column_name = 'empresa_id'
     ORDER BY table_name
  `, [['arremates', 'arremate_perdas', 'sessoes_trabalho_arremate', 'tempos_padrao_arremate', 'log_assinaturas', 'log_divergencias']]);
  const constraints = await rows(
    'SELECT conname, contype, convalidated FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname',
    [nomesConstraints],
  );
  const indices = await rows(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[]) ORDER BY indexname`,
    [nomesIndices],
  );
  const migration = await rows(
    'SELECT id, detalhes FROM sistema_migrations WHERE id = $1',
    ['multiempresas-fase8-arremates-ensaio-v1'],
  );
  const resultado = {
    mode,
    connectionString,
    dados: dados[0],
    colunas,
    constraints,
    indices,
    migration,
    aprovado: mode === 'apply'
      ? colunas.length === 6
        && colunas.every((c) => c.is_nullable === 'NO')
        && Object.entries(dados[0]).filter(([chave]) => chave.endsWith('_sem_empresa')).every(([, valor]) => valor === 0)
        && dados[0].arremates_sem_op_pai === 0
        && dados[0].sessoes_sem_op_pai === 0
        && dados[0].perdas_sem_arremate_origem === 2
        && constraints.length === nomesConstraints.length
        && indices.length === nomesIndices.length
        && migration.length === 1
      : colunas.length === 0 && constraints.length === 0 && indices.length === 0 && migration.length === 0,
  };
  console.log(JSON.stringify(resultado, null, 2));
  if (!resultado.aprovado) process.exitCode = 1;
} finally {
  await pool.end();
}
