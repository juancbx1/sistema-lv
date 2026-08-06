import pg from 'pg';

const connectionString = process.argv[2];
if (!connectionString || (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost'))) {
  throw new Error('Informe uma conexao PostgreSQL local.');
}
const pool = new pg.Pool({ connectionString });
try {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM empresas WHERE codigo LIKE 'empresa-smoke-embalagem-%') AS empresas_smoke,
      (SELECT COUNT(*)::int FROM empresas WHERE codigo LIKE 'empresa-constraints-embalagem-%') AS empresas_constraints,
      (SELECT COUNT(*)::int FROM embalagens_realizadas WHERE idempotency_key LIKE 'smoke-%') AS embalagens_smoke,
      (SELECT COUNT(*)::int FROM estoque_movimentos WHERE observacao LIKE 'smoke embalagem%') AS movimentos_smoke,
      (SELECT COUNT(*)::int FROM estoque_movimentos WHERE tipo_movimento = 'ESTORNO_UNIDADE' AND observacao LIKE 'Estorno referente%') AS estornos_smoke_residuais
  `);
  const amostras = await pool.query(`
    SELECT id, tipo_movimento, observacao
      FROM estoque_movimentos
     WHERE tipo_movimento = 'ESTORNO_UNIDADE'
     ORDER BY id DESC
     LIMIT 8
  `);
  const dados = result.rows[0];
  const aprovado = Object.values(dados).every((valor) => Number(valor) === 0);
  console.log(JSON.stringify({ aprovado, banco: connectionString, dados, amostras: amostras.rows }, null, 2));
  if (!aprovado) process.exitCode = 1;
} finally {
  await pool.end();
}
