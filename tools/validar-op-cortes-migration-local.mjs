import pg from 'pg';

const connectionString = process.argv[2];
const mode = process.argv[3] || 'apply';
if (!connectionString || (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost'))) {
    throw new Error('Informe uma URL PostgreSQL local.');
}

const pool = new pg.Pool({ connectionString });
async function rows(text, values = []) {
    return (await pool.query(text, values)).rows;
}

try {
    const colunas = await rows(`
        SELECT table_name, column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('ordens_de_producao', 'cortes')
          AND column_name = 'empresa_id'
        ORDER BY table_name
    `);
    const counts = (await rows(
        mode === 'apply'
            ? `
                SELECT
                    (SELECT count(*)::int FROM ordens_de_producao) AS ops,
                    (SELECT count(*)::int FROM ordens_de_producao WHERE empresa_id IS NULL) AS ops_sem_empresa,
                    (SELECT count(*)::int FROM cortes) AS cortes,
                    (SELECT count(*)::int FROM cortes WHERE empresa_id IS NULL) AS cortes_sem_empresa,
                    (SELECT count(*)::int FROM ordens_de_producao op LEFT JOIN demandas_producao d ON d.id = op.demanda_id WHERE op.demanda_id IS NOT NULL AND d.id IS NULL) AS ops_sem_demanda_pai,
                    (SELECT count(*)::int FROM cortes c LEFT JOIN demandas_producao d ON d.id = c.demanda_id WHERE c.demanda_id IS NOT NULL AND d.id IS NULL) AS cortes_sem_demanda_pai,
                    (SELECT count(*)::int FROM cortes c LEFT JOIN ordens_de_producao op ON op.numero = c.op WHERE c.op IS NOT NULL AND op.id IS NULL) AS cortes_sem_op_pai
            `
            : `
                SELECT
                    (SELECT count(*)::int FROM ordens_de_producao) AS ops,
                    (SELECT count(*)::int FROM cortes) AS cortes
            `
    ))[0];
    const constraints = await rows(`
        SELECT conname, contype, convalidated
        FROM pg_constraint
        WHERE conname = ANY($1::text[])
        ORDER BY conname
    `, [[
        'uq_ops_empresa_id', 'uq_ops_empresa_numero', 'uq_ops_empresa_edit_id',
        'uq_cortes_empresa_id', 'uq_cortes_empresa_pn',
        'fk_ops_empresa', 'fk_ops_produto_empresa', 'fk_ops_demanda_empresa',
        'fk_cortes_empresa', 'fk_cortes_produto_empresa', 'fk_cortes_demanda_empresa',
    ]]);
    const indices = await rows(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = ANY($1::text[])
        ORDER BY indexname
    `, [[
        'idx_ops_empresa_status', 'idx_ops_empresa_produto', 'idx_ops_empresa_demanda',
        'idx_cortes_empresa_status', 'idx_cortes_empresa_produto',
        'idx_cortes_empresa_demanda', 'idx_cortes_empresa_op',
    ]]);
    const marker = await rows(
        'SELECT id FROM sistema_migrations WHERE id = $1',
        ['multiempresas-fase8-op-cortes-ensaio-v1']
    );

    const aprovado = mode === 'apply'
        ? colunas.length === 2
            && counts.ops_sem_empresa === 0
            && counts.cortes_sem_empresa === 0
            && constraints.length === 11
            && indices.length === 7
            && marker.length === 1
        : colunas.length === 0
            && constraints.length === 0
            && indices.length === 0
            && marker.length === 0;

    console.log(JSON.stringify({
        mode,
        connectionString,
        colunas,
        counts,
        orphanPolicy: {
            opsSemDemandaPai: counts.ops_sem_demanda_pai,
            cortesSemDemandaPai: counts.cortes_sem_demanda_pai,
            cortesSemOpPai: counts.cortes_sem_op_pai,
            acao: 'preservados para classificação; não remapeados automaticamente',
        },
        constraints,
        indices,
        marker,
        aprovado,
    }, null, 2));
    if (!aprovado) process.exitCode = 1;
} finally {
    await pool.end();
}
