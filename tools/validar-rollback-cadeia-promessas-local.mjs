import crypto from 'node:crypto';
import pg from 'pg';

const sourceUrl = process.argv[2];
const rollbackUrl = process.argv[3];
if (!sourceUrl || !rollbackUrl) throw new Error('Informe base fonte e base apÃ³s rollback.');
for (const url of [sourceUrl, rollbackUrl]) {
    if (!url.includes('127.0.0.1') && !url.includes('localhost')) {
        throw new Error('Este validador aceita somente bases locais.');
    }
}

const pools = [
    new pg.Pool({ connectionString: sourceUrl }),
    new pg.Pool({ connectionString: rollbackUrl }),
];

function hashRows(rows) {
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

async function snapshot(pool) {
    const rows = (await pool.query('SELECT * FROM producao_promessas ORDER BY id')).rows;
    const columns = (await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'producao_promessas'
        ORDER BY ordinal_position
    `)).rows;
    const constraints = (await pool.query(`
        SELECT conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conrelid = 'producao_promessas'::regclass
        ORDER BY conname
    `)).rows;
    return {
        total: rows.length,
        hash: hashRows(rows),
        columns,
        constraints,
    };
}

async function estadoEnsaio(pool) {
    const coluna = await pool.query(`
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'producao_promessas'
          AND column_name = 'empresa_id'
    `);
    const constraints = await pool.query(`
        SELECT conname
        FROM pg_constraint
        WHERE conname = ANY($1::text[])
    `, [[
        'uq_producao_promessas_empresa_produto_ref',
        'fk_producao_promessas_empresa',
    ]]);
    const indices = await pool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'idx_producao_promessas_empresa_expiracao'
    `);
    const marker = await pool.query(
        'SELECT id FROM sistema_migrations WHERE id = $1',
        ['multiempresas-fase8-promessas-ensaio-v1']
    );
    return {
        coluna: coluna.rows,
        constraints: constraints.rows,
        indices: indices.rows,
        marker: marker.rows,
    };
}

try {
    const [source, rollback] = await Promise.all(pools.map((pool) => snapshot(pool)));
    const estado = await estadoEnsaio(pools[1]);
    const aprovado = source.total === rollback.total
        && source.hash === rollback.hash
        && JSON.stringify(source.columns) === JSON.stringify(rollback.columns)
        && JSON.stringify(source.constraints) === JSON.stringify(rollback.constraints)
        && estado.coluna.length === 0
        && estado.constraints.length === 0
        && estado.indices.length === 0
        && estado.marker.length === 0;
    console.log(JSON.stringify({ sourceUrl, rollbackUrl, source, rollback, estado, aprovado }, null, 2));
    if (!aprovado) process.exitCode = 2;
} finally {
    await Promise.all(pools.map((pool) => pool.end()));
}
