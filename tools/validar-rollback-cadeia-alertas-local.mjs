import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

const sourceConnection = process.argv[2];
const rollbackConnection = process.argv[3];

if (!sourceConnection || !rollbackConnection) {
    throw new Error('Uso: node tools/validar-rollback-cadeia-alertas-local.mjs <origem> <rollback>');
}
for (const connection of [sourceConnection, rollbackConnection]) {
    if (!connection.includes('127.0.0.1') && !connection.includes('localhost')) {
        throw new Error('Este validador aceita somente PostgreSQL local.');
    }
}

const source = new pg.Pool({ connectionString: sourceConnection });
const rollback = new pg.Pool({ connectionString: rollbackConnection });

function hashRows(rows) {
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

async function snapshot(pool, table, orderBy) {
    const result = await pool.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
    return { rows: result.rows, hash: hashRows(result.rows) };
}

async function hasColumn(pool, table, column) {
    const result = await pool.query(`
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND column_name = $2
    `, [table, column]);
    return result.rowCount === 1;
}

async function hasTable(pool, table) {
    const result = await pool.query(`
        SELECT 1
          FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = $1
    `, [table]);
    return result.rowCount === 1;
}

try {
    const tabelas = [
        ['eventos_sistema', 'id'],
        ['historico_alertas', 'id'],
        ['alertas_configuracoes_gerais', 'chave'],
    ];
    const comparacoes = {};
    for (const [table, orderBy] of tabelas) {
        const origem = await snapshot(source, table, orderBy);
        const aposRollback = await snapshot(rollback, table, orderBy);
        assert.equal(aposRollback.rows.length, origem.rows.length, `${table}: quantidade alterada`);
        assert.equal(aposRollback.hash, origem.hash, `${table}: hash alterado`);
        comparacoes[table] = {
            linhas: origem.rows.length,
            hash: origem.hash,
        };
    }

    for (const [table, column] of [
        ['eventos_sistema', 'empresa_id'],
        ['historico_alertas', 'empresa_id'],
        ['alertas_configuracoes_gerais', 'empresa_id'],
    ]) {
        assert.equal(await hasColumn(rollback, table, column), false, `${table}.${column} ainda existe`);
    }
    assert.equal(await hasTable(rollback, 'configuracoes_alertas_empresas'), false, 'tabela de overrides ainda existe');

    const marker = await rollback.query(
        `SELECT 1 FROM sistema_migrations WHERE id = 'multiempresas-fase8-alertas-ensaio-v1'`
    );
    assert.equal(marker.rowCount, 0, 'marcador de migration ainda existe');

    console.log(JSON.stringify({ aprovado: true, comparacoes }, null, 2));
} finally {
    await source.end();
    await rollback.end();
}
