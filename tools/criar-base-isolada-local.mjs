import pg from 'pg';

const sourceDatabase = process.argv[2] || 'sistema_lv_restore_test';
const requestedTarget = process.argv[3] || 'sistema_lv_cadeia_produtos_test';
const adminUrl = process.argv[4] || 'postgresql://postgres@127.0.0.1:55432/postgres';

if (!adminUrl.includes('127.0.0.1') && !adminUrl.includes('localhost')) {
    throw new Error('Este criador aceita somente um PostgreSQL local.');
}

const pool = new pg.Pool({ connectionString: adminUrl });

function quoteIdentifier(value) {
    return `"${String(value).replaceAll('"', '""')}"`;
}

try {
    const sourceResult = await pool.query(
        'SELECT datname FROM pg_database WHERE datname = $1',
        [sourceDatabase]
    );
    if (sourceResult.rowCount !== 1) {
        throw new Error(`A base fonte ${sourceDatabase} não existe.`);
    }

    const databasesResult = await pool.query(
        'SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY datname',
        [`${requestedTarget}%`]
    );
    const existentes = new Set(databasesResult.rows.map(row => row.datname));
    let targetDatabase = requestedTarget;
    let suffix = 2;
    while (existentes.has(targetDatabase)) {
        targetDatabase = `${requestedTarget}_${suffix}`;
        suffix += 1;
    }

    await pool.query(
        `CREATE DATABASE ${quoteIdentifier(targetDatabase)} TEMPLATE ${quoteIdentifier(sourceDatabase)}`
    );

    console.log(JSON.stringify({
        sourceDatabase,
        targetDatabase,
        connectionString: `postgresql://postgres@127.0.0.1:55432/${targetDatabase}`,
        existingCandidates: [...existentes],
    }, null, 2));
} finally {
    await pool.end();
}
