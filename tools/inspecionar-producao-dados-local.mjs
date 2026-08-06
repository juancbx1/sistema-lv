import pg from 'pg';

const connectionString = process.argv[2];
if (!connectionString || (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost'))) {
    throw new Error('Informe uma URL PostgreSQL local.');
}

const pool = new pg.Pool({ connectionString });

async function one(text, values = []) {
    const result = await pool.query(text, values);
    return result.rows[0] || {};
}

try {
    const resumo = await one(`
        SELECT
            (SELECT COUNT(*)::int FROM producoes) AS producoes,
            (SELECT COUNT(*)::int FROM producoes WHERE op_numero IS NULL OR btrim(op_numero) = '') AS producoes_sem_op_numero,
            (SELECT COUNT(*)::int
               FROM producoes p
               LEFT JOIN ordens_de_producao op ON op.numero = p.op_numero
              WHERE op.id IS NULL) AS producoes_sem_op_pai,
            (SELECT COUNT(*)::int
               FROM producoes p
               LEFT JOIN produtos pr ON pr.id = p.produto_id
              WHERE pr.id IS NULL) AS producoes_sem_produto,
            (SELECT COUNT(*)::int
               FROM producoes p
               LEFT JOIN usuarios_empresas ue
                 ON ue.usuario_id = p.funcionario_id
                AND ue.empresa_id = (
                    SELECT op.empresa_id
                      FROM ordens_de_producao op
                     WHERE op.numero = p.op_numero
                     LIMIT 1
                )
              WHERE p.funcionario_id IS NOT NULL
                AND ue.usuario_id IS NULL) AS producoes_sem_vinculo_funcionario,
            (SELECT COUNT(*)::int
               FROM producoes p
               JOIN ordens_de_producao op ON op.numero = p.op_numero
               JOIN produtos pr ON pr.id = p.produto_id
              WHERE op.empresa_id <> pr.empresa_id) AS producoes_op_produto_empresa_diferente,
            (SELECT COUNT(*)::int FROM sessoes_trabalho_producao) AS sessoes,
            (SELECT COUNT(*)::int FROM sessoes_trabalho_producao WHERE empresa_id IS NULL) AS sessoes_sem_empresa,
            (SELECT COUNT(*)::int
               FROM sessoes_trabalho_producao s
               LEFT JOIN ordens_de_producao op ON op.numero = s.op_numero
              WHERE op.id IS NULL) AS sessoes_sem_op_pai,
            (SELECT COUNT(*)::int
               FROM sessoes_trabalho_producao s
               JOIN ordens_de_producao op ON op.numero = s.op_numero
              WHERE s.empresa_id <> op.empresa_id) AS sessoes_op_empresa_diferente,
            (SELECT COUNT(*)::int
               FROM sessoes_trabalho_producao s
               LEFT JOIN usuarios_empresas ue
                 ON ue.usuario_id = s.funcionario_id
                AND ue.empresa_id = s.empresa_id
              WHERE ue.usuario_id IS NULL) AS sessoes_sem_vinculo_funcionario,
            (SELECT COUNT(*)::int
               FROM sessoes_trabalho_producao s
               LEFT JOIN produtos pr ON pr.id = s.produto_id
              WHERE pr.id IS NULL) AS sessoes_sem_produto,
            (SELECT COUNT(*)::int
               FROM sessoes_trabalho_producao s
               JOIN produtos pr ON pr.id = s.produto_id
              WHERE s.empresa_id <> pr.empresa_id) AS sessoes_produto_empresa_diferente,
            (SELECT COUNT(*)::int FROM producoes_solicitacoes_exclusao) AS solicitacoes_exclusao,
            (SELECT COUNT(*)::int
               FROM producoes_solicitacoes_exclusao x
               LEFT JOIN producoes p ON p.id = x.producao_id
              WHERE p.id IS NULL) AS solicitacoes_sem_producao,
            (SELECT COUNT(*)::int
               FROM producoes_solicitacoes_exclusao x
               JOIN producoes p ON p.id = x.producao_id
               LEFT JOIN ordens_de_producao op ON op.numero = p.op_numero
              WHERE op.id IS NULL) AS solicitacoes_producao_sem_op_pai
    `);

    const porOperacao = await pool.query(`
        SELECT
            COALESCE(op.empresa_id::text, 'SEM_OP') AS empresa_op,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE p.produto_id IS NULL)::int AS sem_produto,
            COUNT(*) FILTER (WHERE pr.id IS NULL)::int AS produto_inexistente,
            COUNT(*) FILTER (WHERE p.op_numero IS NULL OR btrim(p.op_numero) = '')::int AS sem_op_numero
        FROM producoes p
        LEFT JOIN ordens_de_producao op ON op.numero = p.op_numero
        LEFT JOIN produtos pr ON pr.id = p.produto_id
        GROUP BY COALESCE(op.empresa_id::text, 'SEM_OP')
        ORDER BY empresa_op
    `);

    const sessoesSemOpAmostra = await pool.query(`
        SELECT s.op_numero, COUNT(*)::int AS total
          FROM sessoes_trabalho_producao s
          LEFT JOIN ordens_de_producao op ON op.numero = s.op_numero
         WHERE op.id IS NULL
         GROUP BY s.op_numero
         ORDER BY total DESC, s.op_numero
         LIMIT 20
    `);

    const producoesSemOpAmostra = await pool.query(`
        SELECT p.op_numero, COUNT(*)::int AS total
          FROM producoes p
          LEFT JOIN ordens_de_producao op ON op.numero = p.op_numero
         WHERE op.id IS NULL
         GROUP BY p.op_numero
         ORDER BY total DESC, p.op_numero
         LIMIT 20
    `);

    const colunas = await pool.query(`
        SELECT table_name, column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
           AND table_name IN ('producoes', 'producoes_solicitacoes_exclusao', 'sessoes_trabalho_producao', 'tempos_padrao_producao')
         ORDER BY table_name, ordinal_position
    `);

    console.log(JSON.stringify({
        connectionString,
        resumo,
        porOperacao: porOperacao.rows,
        producoesSemOpAmostra: producoesSemOpAmostra.rows,
        sessoesSemOpAmostra: sessoesSemOpAmostra.rows,
        colunas: colunas.rows,
    }, null, 2));
} finally {
    await pool.end();
}
