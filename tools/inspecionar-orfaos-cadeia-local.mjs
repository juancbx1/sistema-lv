import pg from 'pg';

const connectionString = process.argv[2] || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_ponto_motor_test';
if (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost')) {
    throw new Error('Este inspetor aceita somente uma conexão PostgreSQL local.');
}

const pool = new pg.Pool({ connectionString });

try {
    const [cortes, ops, referencias, produtos] = await Promise.all([
        pool.query(`
            SELECT
                c.status,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE op.id IS NOT NULL)::int AS com_op_do_mesmo_numero,
                MIN(c.id)::int AS menor_id,
                MAX(c.id)::int AS maior_id,
                MIN(c.data) AS menor_data,
                MAX(c.data) AS maior_data
            FROM cortes c
            LEFT JOIN demandas_producao d ON d.id = c.demanda_id
            LEFT JOIN ordens_de_producao op ON op.numero = c.op
            WHERE c.demanda_id IS NOT NULL AND d.id IS NULL
            GROUP BY c.status
            ORDER BY c.status
        `),
        pool.query(`
            SELECT
                op.status,
                COUNT(*)::int AS total,
                MIN(op.id)::int AS menor_id,
                MAX(op.id)::int AS maior_id,
                MIN(op.data_criacao) AS menor_criacao,
                MAX(op.data_criacao) AS maior_criacao
            FROM ordens_de_producao op
            LEFT JOIN demandas_producao d ON d.id = op.demanda_id
            WHERE op.demanda_id IS NOT NULL AND d.id IS NULL
            GROUP BY op.status
            ORDER BY op.status
        `),
        pool.query(`
            SELECT origem, produto_ref_id, COUNT(*)::int AS total,
                   MIN(criado_em) AS primeiro_registro,
                   MAX(atualizado_em) AS ultimo_registro
            FROM (
                SELECT 'produto_composicao_mp' AS origem, produto_ref_id, criado_em, atualizado_em
                FROM produto_composicao_mp
                UNION ALL
                SELECT 'produto_custo_mao_de_obra', produto_ref_id, criado_em, atualizado_em
                FROM produto_custo_mao_de_obra
                UNION ALL
                SELECT 'produto_precificacao_configs', produto_ref_id, NULL, atualizado_em
                FROM produto_precificacao_configs
            ) refs
            GROUP BY origem, produto_ref_id
            ORDER BY origem
        `),
        pool.query('SELECT id, sku, nome FROM produtos ORDER BY id'),
    ]);

    console.log(JSON.stringify({
        connection: connectionString,
        cortes_orfaos_por_status: cortes.rows,
        ops_orfas_por_status: ops.rows,
        referencias_textuais: referencias.rows,
        produtos_disponiveis: produtos.rows,
    }, null, 2));
} finally {
    await pool.end();
}
