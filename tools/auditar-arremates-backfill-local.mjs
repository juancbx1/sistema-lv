import pg from 'pg';

const { Pool } = pg;
const database = process.argv[2] || 'sistema_lv_cadeia_arremates_test';
const pool = new Pool({ connectionString: `postgresql://postgres@127.0.0.1:55432/${database}` });

try {
  const queries = {
    empresas: `
      SELECT id, codigo, nome_fantasia, eh_legada
        FROM empresas
       ORDER BY id`,
    arremates: `
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE op.empresa_id IS NOT NULL)::int AS por_op,
             COUNT(*) FILTER (WHERE op.empresa_id IS NULL AND p.empresa_id IS NOT NULL)::int AS por_produto,
             COUNT(*) FILTER (WHERE op.empresa_id IS NULL AND p.empresa_id IS NULL)::int AS sem_origem,
             COUNT(*) FILTER (WHERE op.id IS NULL)::int AS op_inexistente,
             COUNT(*) FILTER (WHERE p.id IS NULL)::int AS produto_inexistente
        FROM arremates a
        LEFT JOIN ordens_de_producao op ON op.numero = a.op_numero
        LEFT JOIN produtos p ON p.id = a.produto_id`,
    sessoes: `
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE op.empresa_id IS NOT NULL)::int AS por_op,
             COUNT(*) FILTER (WHERE op.empresa_id IS NULL AND p.empresa_id IS NOT NULL)::int AS por_produto,
             COUNT(*) FILTER (WHERE op.empresa_id IS NULL AND p.empresa_id IS NULL AND ue.empresa_id IS NOT NULL)::int AS por_vinculo,
             COUNT(*) FILTER (WHERE op.empresa_id IS NULL AND p.empresa_id IS NULL AND ue.empresa_id IS NULL)::int AS sem_origem
        FROM sessoes_trabalho_arremate s
        LEFT JOIN ordens_de_producao op ON op.numero = s.op_numero
        LEFT JOIN produtos p ON p.id = s.produto_id
        LEFT JOIN LATERAL (
          SELECT uex.empresa_id
            FROM usuarios_empresas uex
           WHERE uex.usuario_id = s.usuario_tiktik_id AND uex.ativo
           ORDER BY uex.empresa_id
           LIMIT 1
        ) ue ON TRUE`,
    perdas: `
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE COALESCE(op.empresa_id, p.empresa_id) IS NOT NULL)::int AS por_arremate,
             COUNT(*) FILTER (WHERE COALESCE(op.empresa_id, p.empresa_id) IS NULL)::int AS sem_arremate
        FROM arremate_perdas ap
        LEFT JOIN LATERAL (
          SELECT a.op_numero, a.produto_id
            FROM arremates a
           WHERE a.id_perda_origem = ap.id
           ORDER BY a.id
           LIMIT 1
        ) a ON TRUE
        LEFT JOIN ordens_de_producao op ON op.numero = a.op_numero
        LEFT JOIN produtos p ON p.id = a.produto_id`,
    tempos: `
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE p.empresa_id IS NOT NULL)::int AS com_produto,
             COUNT(*) FILTER (WHERE p.empresa_id IS NULL)::int AS sem_produto
        FROM tempos_padrao_arremate t
        LEFT JOIN produtos p ON p.id = t.produto_id`,
    conflitos_op: `
      SELECT numero, COUNT(DISTINCT empresa_id)::int AS empresas
        FROM ordens_de_producao
       WHERE numero IS NOT NULL
       GROUP BY numero
      HAVING COUNT(DISTINCT empresa_id) > 1
       ORDER BY numero
       LIMIT 20`,
    amostras_sem_origem: `
      SELECT a.id, a.op_numero, a.produto_id
        FROM arremates a
        LEFT JOIN ordens_de_producao op ON op.numero = a.op_numero
        LEFT JOIN produtos p ON p.id = a.produto_id
       WHERE op.empresa_id IS NULL AND p.empresa_id IS NULL
       ORDER BY a.id
       LIMIT 20`,
  };

  const resultado = {};
  for (const [nome, sql] of Object.entries(queries)) {
    const queryResult = await pool.query(sql);
    resultado[nome] = queryResult.rows;
  }
  console.log(JSON.stringify({ database, ...resultado }, null, 2));
} finally {
  await pool.end();
}
