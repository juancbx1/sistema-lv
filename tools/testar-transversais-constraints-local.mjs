import assert from 'node:assert/strict';
import pg from 'pg';

const connectionString = process.argv[2];
if (!connectionString || !connectionString.includes('127.0.0.1')) throw new Error('Somente banco local.');
const pool = new pg.Pool({ connectionString });
const tabelas = [
  'comissoes_pagas',
  'audit_log',
  'auditoria_eventos',
  'eventos_sistema',
  'historico_alertas',
  'alertas_configuracoes_gerais',
  'configuracoes_alertas_empresas',
];

try {
  const nulos = {};
  const empresas = {};
  for (const tabela of tabelas) {
    nulos[tabela] = (await pool.query(`SELECT COUNT(*)::int AS n FROM ${tabela} WHERE empresa_id IS NULL`)).rows[0].n;
    empresas[tabela] = (await pool.query(`
      SELECT empresa_id, COUNT(*)::int AS n
        FROM ${tabela}
       GROUP BY empresa_id
       ORDER BY empresa_id
    `)).rows;
    assert.equal(nulos[tabela], 0, `${tabela} possui empresa_id nulo`);
    assert.ok(empresas[tabela].every((row) => Number(row.empresa_id) === 1), `${tabela} possui empresa inesperada`);
  }

  const markers = (await pool.query(`
    SELECT id
      FROM sistema_migrations
     WHERE id IN ('multiempresas-fase8-alertas-ensaio-v1', 'multiempresas-fase8-transversais-ensaio-v1')
     ORDER BY id
  `)).rows.map((row) => row.id);
  assert.deepEqual(markers, ['multiempresas-fase8-alertas-ensaio-v1', 'multiempresas-fase8-transversais-ensaio-v1']);

  const constraintNames = [
    'fk_comissoes_pagas_empresa',
    'uq_comissoes_pagas_empresa_costureira_ciclo',
    'fk_audit_log_empresa',
    'fk_auditoria_eventos_empresa',
    'fk_eventos_sistema_empresa',
    'fk_historico_alertas_empresa',
    'fk_alertas_configuracoes_gerais_empresa',
    'fk_config_alertas_empresas_empresa',
  ];
  const constraints = (await pool.query(
    'SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname',
    [constraintNames],
  )).rows;
  assert.deepEqual(constraints.map((row) => row.conname), [...constraintNames].sort());

  await pool.query('BEGIN');
  try {
    await assert.rejects(
      pool.query(`
        INSERT INTO audit_log (empresa_id, usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes)
        VALUES (999999, NULL, 'smoke', 'smoke', 'smoke', NULL, '{}'::jsonb)
      `),
      (error) => error.code === '23503',
    );
    await assert.rejects(
      pool.query(`
        INSERT INTO auditoria_eventos (empresa_id, usuario_id, usuario_nome, tipo_evento, entidade, entidade_id, detalhes)
        VALUES (999999, NULL, 'smoke', 'SMOKE', 'smoke', NULL, '{}'::jsonb)
      `),
      (error) => error.code === '23503',
    );
    await assert.rejects(
      pool.query(`
        INSERT INTO comissoes_pagas
          (empresa_id, costureira_nome, ciclo_nome, ciclo_inicio, ciclo_fim,
           valor_pago, data_prevista_pagamento, data_pagamento_efetivo,
           confirmado_por_nome, observacoes, usuario_id)
        SELECT 999999, 'Smoke Transversal', 'Ciclo Smoke Transversal', ciclo_inicio, ciclo_fim,
               valor_pago, data_prevista_pagamento, data_pagamento_efetivo,
               confirmado_por_nome, observacoes, usuario_id
          FROM comissoes_pagas
         LIMIT 1
      `),
      (error) => error.code === '23503',
    );
  } finally {
    await pool.query('ROLLBACK');
  }

  console.log(JSON.stringify({
    aprovado: true,
    banco: connectionString,
    nulos,
    empresas,
    constraints,
    markers,
  }, null, 2));
} finally {
  await pool.end();
}
