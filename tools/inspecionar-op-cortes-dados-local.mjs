import pg from 'pg';

const connectionString = process.argv[2] || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_cadeia_produtos_test';
if (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost')) {
    throw new Error('Este inspetor aceita somente PostgreSQL local.');
}

const pool = new pg.Pool({ connectionString });
try {
    const result = await pool.query(`
        SELECT jsonb_build_object(
            'produtos', (SELECT count(*) FROM produtos),
            'demandas', (SELECT count(*) FROM demandas_producao),
            'ops', (SELECT count(*) FROM ordens_de_producao),
            'ops_sem_produto', (SELECT count(*) FROM ordens_de_producao op LEFT JOIN produtos p ON p.id = op.produto_id WHERE op.produto_id IS NULL OR p.id IS NULL),
            'ops_sem_demanda_pai', (SELECT count(*) FROM ordens_de_producao op LEFT JOIN demandas_producao d ON d.id = op.demanda_id WHERE op.demanda_id IS NOT NULL AND d.id IS NULL),
            'cortes', (SELECT count(*) FROM cortes),
            'cortes_sem_produto', (SELECT count(*) FROM cortes c LEFT JOIN produtos p ON p.id = c.produto_id WHERE c.produto_id IS NOT NULL AND p.id IS NULL),
            'cortes_sem_demanda_pai', (SELECT count(*) FROM cortes c LEFT JOIN demandas_producao d ON d.id = c.demanda_id WHERE c.demanda_id IS NOT NULL AND d.id IS NULL),
            'cortes_sem_op_pai', (SELECT count(*) FROM cortes c LEFT JOIN ordens_de_producao op ON op.numero = c.op WHERE c.op IS NOT NULL AND op.id IS NULL),
            'ops_numero_duplicado', (SELECT count(*) FROM (SELECT numero FROM ordens_de_producao GROUP BY numero HAVING count(*) > 1) duplicados),
            'ops_edit_id_duplicado', (SELECT count(*) FROM (SELECT edit_id FROM ordens_de_producao GROUP BY edit_id HAVING count(*) > 1) duplicados),
            'cortes_pn_duplicado', (SELECT count(*) FROM (SELECT pn FROM cortes GROUP BY pn HAVING count(*) > 1) duplicados),
            'ops_com_demanda_empresa_diferente', (SELECT count(*) FROM ordens_de_producao op JOIN demandas_producao d ON d.id = op.demanda_id JOIN produtos p ON p.id = op.produto_id WHERE d.empresa_id <> p.empresa_id),
            'cortes_com_demanda_empresa_diferente', (SELECT count(*) FROM cortes c JOIN demandas_producao d ON d.id = c.demanda_id JOIN produtos p ON p.id = c.produto_id WHERE d.empresa_id <> p.empresa_id)
        ) AS resumo
    `);
    console.log(JSON.stringify({ connectionString, resumo: result.rows[0].resumo }, null, 2));
} finally {
    await pool.end();
}
