import assert from 'node:assert/strict';
import pg from 'pg';

const connectionString = process.argv[2];
if (!connectionString || (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost'))) {
  throw new Error('Informe uma URL PostgreSQL local.');
}
const pool = new pg.Pool({ connectionString });

try {
  const origem = (await pool.query(`
    SELECT op.numero, op.edit_id, op.produto_id, op.variante,
           (SELECT id FROM usuarios WHERE id IN (SELECT usuario_id FROM usuarios_empresas WHERE empresa_id = 1 AND ativo) ORDER BY id LIMIT 1) AS usuario_id,
           (SELECT id FROM arremates WHERE empresa_id = 1 ORDER BY id LIMIT 1) AS arremate_id
      FROM ordens_de_producao op
     WHERE op.empresa_id = 1
     ORDER BY op.id
     LIMIT 1
  `)).rows[0];
  assert.ok(origem?.numero && origem.produto_id && origem.usuario_id && origem.arremate_id, 'Origem legada incompleta.');

  const casos = [];
  for (const [nome, sql, valores] of [
    [
      'arremate-nao-troca-empresa',
      `UPDATE arremates SET empresa_id = 2 WHERE id = $1`,
      [origem.arremate_id],
    ],
    [
      'sessao-nao-cruza-produto-empresa',
      `INSERT INTO sessoes_trabalho_arremate (empresa_id, usuario_tiktik_id, produto_id, quantidade_entregue, op_numero)
       VALUES (2, $1, $2, 1, $3)`,
      [origem.usuario_id, origem.produto_id, origem.numero],
    ],
    [
      'assinatura-nao-cruza-arremate-empresa',
      `INSERT INTO log_assinaturas (empresa_id, id_usuario, id_arremate) VALUES (2, $1, $2)`,
      [origem.usuario_id, origem.arremate_id],
    ],
  ]) {
    await pool.query('BEGIN');
    try {
      await pool.query(sql, valores);
      throw new Error(`O caso ${nome} deveria ter sido rejeitado.`);
    } catch (error) {
      if (error.message === `O caso ${nome} deveria ter sido rejeitado.`) throw error;
      assert.equal(error.code, '23503', `${nome} deveria falhar por FK empresarial.`);
      casos.push({ nome, codigo: error.code });
    } finally {
      await pool.query('ROLLBACK');
    }
  }

  console.log(JSON.stringify({ aprovado: true, banco: connectionString, casos }, null, 2));
} finally {
  await pool.end();
}
