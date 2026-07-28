import 'dotenv/config';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

const sourceUrl = process.env.POSTGRES_URL;
const restoredUrl = process.argv[2] || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_restore_test';

if (!sourceUrl) {
    throw new Error('POSTGRES_URL não encontrada.');
}

function createPool(connectionString) {
    const isLocal = connectionString.includes('127.0.0.1') || connectionString.includes('localhost');
    return new Pool({
        connectionString,
        ssl: isLocal ? false : { rejectUnauthorized: false },
    });
}

function stableHash(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function quoteIdentifier(value) {
    return `"${String(value).replaceAll('"', '""')}"`;
}

function normalizeCatalog(name, rows) {
    if (name === 'columns') {
        return rows.map(({ ordinal_position: _ordinalPosition, ...column }) => column);
    }
    if (name === 'constraints') {
        return rows.map((constraint) => ({
            ...constraint,
            definition: constraint.definition
                .replaceAll('::character varying::text', '::character varying')
                .replaceAll(']::text[]', ']'),
        }));
    }
    return rows;
}

const catalogQueries = {
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
            c.conrelid::regclass::text AS table_name,
            c.conname AS constraint_name,
            c.contype AS constraint_type,
            pg_get_constraintdef(c.oid, true) AS definition
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public'
        ORDER BY table_name, constraint_name
    `,
    indexes: `
        SELECT tablename AS table_name, indexname AS index_name, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname
    `,
    views: `
        SELECT table_name, view_definition
        FROM information_schema.views
        WHERE table_schema = 'public'
        ORDER BY table_name
    `,
    routines: `
        SELECT
            p.proname AS routine_name,
            pg_get_function_identity_arguments(p.oid) AS arguments,
            pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
        ORDER BY routine_name, arguments
    `,
    triggers: `
        SELECT
            event_object_table AS table_name,
            trigger_name,
            event_manipulation,
            action_timing,
            action_statement
        FROM information_schema.triggers
        WHERE trigger_schema = 'public'
        ORDER BY table_name, trigger_name, event_manipulation
    `,
};

async function inspectDatabase(pool) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query(`SET LOCAL TIME ZONE 'UTC'`);

        const tablesResult = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);

        const tables = {};
        for (const { table_name: tableName } of tablesResult.rows) {
            const qualifiedName = `${quoteIdentifier('public')}.${quoteIdentifier(tableName)}`;
            const fingerprint = await client.query(`
                SELECT
                    COUNT(*)::bigint AS row_count,
                    md5(COALESCE(string_agg(row_json, E'\\n' ORDER BY row_json), '')) AS content_hash
                FROM (
                    SELECT row_to_json(source_row)::text AS row_json
                    FROM ${qualifiedName} AS source_row
                ) AS serialized
            `);
            tables[tableName] = {
                rowCount: Number(fingerprint.rows[0].row_count),
                contentHash: fingerprint.rows[0].content_hash,
            };
        }

        const catalog = {};
        for (const [name, query] of Object.entries(catalogQueries)) {
            catalog[name] = (await client.query(query)).rows;
        }

        const sequencesResult = await client.query(`
            SELECT sequence_name
            FROM information_schema.sequences
            WHERE sequence_schema = 'public'
            ORDER BY sequence_name
        `);
        const sequences = {};
        for (const { sequence_name: sequenceName } of sequencesResult.rows) {
            const sequenceResult = await client.query(
                `SELECT last_value::text, is_called FROM ${quoteIdentifier('public')}.${quoteIdentifier(sequenceName)}`,
            );
            sequences[sequenceName] = sequenceResult.rows[0];
        }

        const largeObjects = Number((await client.query(
            'SELECT COUNT(*)::bigint AS count FROM pg_largeobject_metadata',
        )).rows[0].count);
        const unvalidatedConstraints = Number((await client.query(`
            SELECT COUNT(*)::bigint AS count
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'public'
              AND NOT c.convalidated
        `)).rows[0].count);
        const invalidIndexes = Number((await client.query(`
            SELECT COUNT(*)::bigint AS count
            FROM pg_index i
            JOIN pg_class index_class ON index_class.oid = i.indexrelid
            JOIN pg_namespace n ON n.oid = index_class.relnamespace
            WHERE n.nspname = 'public'
              AND (NOT i.indisvalid OR NOT i.indisready)
        `)).rows[0].count);
        const serverVersion = (await client.query('SHOW server_version')).rows[0].server_version;

        await client.query('ROLLBACK');

        return {
            tables,
            tableNames: Object.keys(tables),
            catalog,
            catalogHashes: Object.fromEntries(
                Object.entries(catalog).map(([name, rows]) => [name, stableHash(normalizeCatalog(name, rows))]),
            ),
            sequences,
            largeObjects,
            serverVersion,
            unvalidatedConstraints,
            invalidIndexes,
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

const sourcePool = createPool(sourceUrl);
const restoredPool = createPool(restoredUrl);

try {
    const [source, restored] = await Promise.all([
        inspectDatabase(sourcePool),
        inspectDatabase(restoredPool),
    ]);

    const allTables = [...new Set([...source.tableNames, ...restored.tableNames])].sort();
    const tableMismatches = [];

    for (const table of allTables) {
        const sourceTable = source.tables[table];
        const restoredTable = restored.tables[table];
        if (!sourceTable || !restoredTable
            || sourceTable.rowCount !== restoredTable.rowCount
            || sourceTable.contentHash !== restoredTable.contentHash) {
            tableMismatches.push({
                table,
                source: sourceTable || null,
                restored: restoredTable || null,
            });
        }
    }

    const catalogMismatches = Object.keys(catalogQueries).filter(
        (name) => source.catalogHashes[name] !== restored.catalogHashes[name],
    );
    const catalogMismatchDetails = Object.fromEntries(catalogMismatches.map((name) => {
        const normalizedSource = normalizeCatalog(name, source.catalog[name]);
        const normalizedRestored = normalizeCatalog(name, restored.catalog[name]);
        const sourceSerialized = new Set(normalizedSource.map((item) => JSON.stringify(item)));
        const restoredSerialized = new Set(normalizedRestored.map((item) => JSON.stringify(item)));
        return [name, {
            sourceCount: normalizedSource.length,
            restoredCount: normalizedRestored.length,
            onlySource: [...sourceSerialized]
                .filter((item) => !restoredSerialized.has(item))
                .slice(0, 20)
                .map((item) => JSON.parse(item)),
            onlyRestored: [...restoredSerialized]
                .filter((item) => !sourceSerialized.has(item))
                .slice(0, 20)
                .map((item) => JSON.parse(item)),
        }];
    }));

    const sequenceMismatches = [...new Set([
        ...Object.keys(source.sequences),
        ...Object.keys(restored.sequences),
    ])].sort().filter(
        (name) => JSON.stringify(source.sequences[name]) !== JSON.stringify(restored.sequences[name]),
    ).map((name) => ({
        sequence: name,
        source: source.sequences[name] || null,
        restored: restored.sequences[name] || null,
    }));

    const result = {
        comparedAt: new Date().toISOString(),
        source: {
            serverVersion: source.serverVersion,
            tables: source.tableNames.length,
            totalRows: Object.values(source.tables).reduce((sum, item) => sum + item.rowCount, 0),
            sequences: Object.keys(source.sequences).length,
            largeObjects: source.largeObjects,
            unvalidatedConstraints: source.unvalidatedConstraints,
            invalidIndexes: source.invalidIndexes,
        },
        restored: {
            serverVersion: restored.serverVersion,
            tables: restored.tableNames.length,
            totalRows: Object.values(restored.tables).reduce((sum, item) => sum + item.rowCount, 0),
            sequences: Object.keys(restored.sequences).length,
            largeObjects: restored.largeObjects,
            unvalidatedConstraints: restored.unvalidatedConstraints,
            invalidIndexes: restored.invalidIndexes,
        },
        tableMismatches,
        catalogMismatches,
        catalogMismatchDetails,
        sequenceMismatches,
        exactMatch:
            tableMismatches.length === 0
            && catalogMismatches.length === 0
            && sequenceMismatches.length === 0
            && source.largeObjects === restored.largeObjects
            && restored.unvalidatedConstraints === 0
            && restored.invalidIndexes === 0,
    };

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.exactMatch) process.exitCode = 2;
} finally {
    await Promise.allSettled([sourcePool.end(), restoredPool.end()]);
}
