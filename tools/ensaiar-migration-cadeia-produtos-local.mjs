import fs from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.argv[2];
const sqlPath = process.argv[3] || '_planejamento/migration-cadeia-fase8-produtos-demandas-ensaio.sql';
const mode = process.argv[4] || 'apply';

if (!connectionString || (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost'))) {
    throw new Error('Informe uma conexão PostgreSQL local.');
}

const pool = new pg.Pool({ connectionString });

async function consultar(text, values = []) {
    const result = await pool.query(text, values);
    return result.rows;
}

try {
    const sql = await fs.readFile(sqlPath, 'utf8');
    await pool.query(sql);

    const colunas = await consultar(`
        SELECT table_name, column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
          AND column_name IN ('empresa_id', 'produto_id')
        ORDER BY table_name, column_name
    `, [['produtos', 'demandas_producao', 'demandas_componentes_atribuidos']]);

    const dados = mode === 'apply'
        ? await consultar(`
            SELECT
                (SELECT COUNT(*)::int FROM produtos) AS produtos_total,
                (SELECT COUNT(*)::int FROM produtos WHERE empresa_id IS NULL) AS produtos_sem_empresa,
                (SELECT COUNT(*)::int FROM demandas_producao) AS demandas_total,
                (SELECT COUNT(*)::int FROM demandas_producao WHERE empresa_id IS NULL) AS demandas_sem_empresa,
                (SELECT COUNT(*)::int FROM demandas_producao WHERE produto_id IS NULL) AS demandas_sem_produto,
                (SELECT COUNT(*)::int FROM demandas_componentes_atribuidos WHERE empresa_id IS NULL) AS componentes_sem_empresa
        `)
        : await consultar(`
            SELECT
                (SELECT COUNT(*)::int FROM produtos) AS produtos_total,
                (SELECT COUNT(*)::int FROM demandas_producao) AS demandas_total,
                (SELECT COUNT(*)::int FROM demandas_componentes_atribuidos) AS componentes_total
        `);

    const constraints = await consultar(`
        SELECT conname, contype, convalidated
        FROM pg_constraint
        WHERE conname = ANY($1::text[])
        ORDER BY conname
    `, [[
        'uq_produtos_empresa_id',
        'fk_produtos_empresa',
        'uq_demandas_empresa_id',
        'fk_demandas_empresa',
        'fk_demandas_produto_empresa',
        'uq_demandas_componentes_empresa_id',
        'fk_demandas_componentes_empresa',
    ]]);

    const indexes = await consultar(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = ANY($1::text[])
        ORDER BY indexname
    `, [[
        'uq_produtos_empresa_nome',
        'uq_produtos_empresa_sku',
        'idx_demandas_empresa_status',
        'idx_demandas_empresa_produto',
        'uq_demandas_componentes_empresa_chave',
    ]]);

    const migration = await consultar(
        `SELECT id, detalhes FROM sistema_migrations WHERE id = $1`,
        ['multiempresas-fase8-produtos-demandas-ensaio-v1']
    );

    console.log(JSON.stringify({
        mode,
        connection: connectionString,
        sqlPath,
        colunas,
        dados: dados[0],
        constraints,
        indexes,
        migration,
        aprovado: mode === 'apply'
            ? dados[0].produtos_sem_empresa === 0
                && dados[0].demandas_sem_empresa === 0
                && dados[0].demandas_sem_produto === 0
                && dados[0].componentes_sem_empresa === 0
                && migration.length === 1
            : colunas.length === 0 && migration.length === 0,
    }, null, 2));
} finally {
    await pool.end();
}
