import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.POSTGRES_URL?.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
});

const mode = process.argv[2] || 'summary';
const requestedTable = process.argv[3] || null;

const queries = {
    tables: `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
    `,
    columns: `
        SELECT
            table_name,
            ordinal_position,
            column_name,
            data_type,
            udt_name,
            is_nullable,
            column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
    `,
    constraints: `
        SELECT
            tc.table_name,
            tc.constraint_name,
            tc.constraint_type,
            string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_schema = tc.constraint_schema
         AND kcu.constraint_name = tc.constraint_name
         AND kcu.table_name = tc.table_name
        WHERE tc.table_schema = 'public'
          AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
        GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type
        ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name
    `,
    foreignKeys: `
        SELECT DISTINCT
            tc.table_name,
            tc.constraint_name,
            kcu.column_name,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_schema = tc.constraint_schema
         AND kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_schema = tc.constraint_schema
         AND ccu.constraint_name = tc.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.constraint_type = 'FOREIGN KEY'
        ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
    `,
    indexes: `
        SELECT tablename AS table_name, indexname AS index_name, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname
    `,
};

try {
    const client = await pool.connect();
    try {
        await client.query('BEGIN READ ONLY');
        const result = {};

        for (const [name, query] of Object.entries(queries)) {
            result[name] = (await client.query(query)).rows;
        }

        await client.query('ROLLBACK');
        if (mode === 'full') {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        } else if (mode === 'stats') {
            const stats = {
                tables: result.tables.length,
                columns: result.columns.length,
                constraints: result.constraints.length,
                indexes: result.indexes.length,
                tablesWithEmpresaId: [...new Set(
                    result.columns
                        .filter((item) => item.column_name === 'empresa_id')
                        .map((item) => item.table_name),
                )],
            };
            process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
        } else if (mode === 'catalog') {
            const catalog = result.tables.map(({ table_name }) => ({
                table: table_name,
                columns: result.columns
                    .filter((item) => item.table_name === table_name)
                    .map((item) => item.column_name),
                uniqueConstraints: result.constraints
                    .filter((item) => item.table_name === table_name && item.constraint_type === 'UNIQUE')
                    .map((item) => item.columns),
            }));
            process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
        } else if (mode === 'table' || mode === 'tables') {
            if (!requestedTable) throw new Error('Informe a tabela para o modo table.');
            const requestedTables = requestedTable.split(',').map((item) => item.trim()).filter(Boolean);
            const details = requestedTables.map((table) => ({
                table,
                columns: result.columns.filter((item) => item.table_name === table),
                constraints: result.constraints.filter((item) => item.table_name === table),
                foreignKeys: result.foreignKeys.filter((item) => item.table_name === table),
                indexes: result.indexes.filter((item) => item.table_name === table),
            }));
            process.stdout.write(`${JSON.stringify(mode === 'table' && details.length === 1 ? details[0] : details, null, 2)}\n`);
        } else {
            const summary = result.tables.map(({ table_name }) => ({
                table: table_name,
                columns: result.columns.filter((item) => item.table_name === table_name).length,
                foreignKeys: result.foreignKeys
                    .filter((item) => item.table_name === table_name)
                    .map((item) => `${item.column_name}->${item.referenced_table}.${item.referenced_column}`),
                uniqueConstraints: result.constraints
                    .filter((item) => item.table_name === table_name && item.constraint_type === 'UNIQUE')
                    .map((item) => item.columns),
            }));
            process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        }
    } finally {
        client.release();
    }
} catch (error) {
    console.error(`Falha ao auditar schema: ${error.message}`);
    process.exitCode = 1;
} finally {
    await pool.end();
}
