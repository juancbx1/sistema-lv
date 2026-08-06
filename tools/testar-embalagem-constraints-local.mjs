import assert from 'node:assert/strict';
import pg from 'pg';

const connectionString = process.argv[2];
if (!connectionString || (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost'))) {
  throw new Error('Informe uma conexao PostgreSQL local.');
}
const pool = new pg.Pool({ connectionString });
let empresaTesteId;

try {
  const produto = (await pool.query(
    'SELECT id FROM produtos WHERE empresa_id = 1 ORDER BY id LIMIT 1',
  )).rows[0];
  const actor = (await pool.query(
    `SELECT usuario_id FROM usuarios_empresas
      WHERE empresa_id = 1 AND ativo
      ORDER BY usuario_id LIMIT 1`,
  )).rows[0];
  assert.ok(produto && actor, 'Produto e vinculo legados sao obrigatorios.');

  empresaTesteId = (await pool.query(`
    INSERT INTO empresas (codigo, razao_social, nome_fantasia, ativa, eh_legada)
    VALUES ($1, 'Empresa Constraints Embalagem', 'Empresa Constraints Embalagem', TRUE, FALSE)
    RETURNING id
  `, [`empresa-constraints-embalagem-${Date.now()}`])).rows[0].id;

  const rejeicoes = [];
  for (const [nome, query, values] of [
    [
      'insert-produto-de-outra-empresa',
      `INSERT INTO embalagens_realizadas
        (empresa_id, tipo_embalagem, produto_embalado_id, quantidade_embalada)
       VALUES ($1, 'UNIDADE', $2, 1)`,
      [empresaTesteId, produto.id],
    ],
    [
      'update-empresa-de-outra-empresa',
      'UPDATE embalagens_realizadas SET empresa_id = $1 WHERE id = $2',
      [empresaTesteId, (await pool.query('SELECT id FROM embalagens_realizadas WHERE empresa_id = 1 ORDER BY id LIMIT 1')).rows[0].id],
    ],
  ]) {
    try {
      await pool.query('BEGIN');
      await pool.query(query, values);
      await pool.query('ROLLBACK');
      throw new Error(`${nome} deveria ter sido rejeitado.`);
    } catch (error) {
      await pool.query('ROLLBACK').catch(() => {});
      assert.equal(error.code, '23503', `${nome}: codigo PostgreSQL inesperado`);
      rejeicoes.push({ nome, codigo: error.code });
    }
  }

  console.log(JSON.stringify({ aprovado: true, banco: connectionString, rejeicoes }, null, 2));
} finally {
  if (empresaTesteId) await pool.query('DELETE FROM empresas WHERE id = $1', [empresaTesteId]);
  await pool.end();
}
