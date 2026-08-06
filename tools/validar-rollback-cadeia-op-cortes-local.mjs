import crypto from 'node:crypto';
import pg from 'pg';

const sourceUrl = process.argv[2];
const rollbackUrl = process.argv[3];
if (!sourceUrl || !rollbackUrl) throw new Error('Informe base fonte e base após rollback.');
for (const url of [sourceUrl, rollbackUrl]) {
    if (!url.includes('127.0.0.1') && !url.includes('localhost')) {
        throw new Error('Este validador aceita somente bases locais.');
    }
}

const tabelas = ['produtos', 'demandas_producao', 'demandas_componentes_atribuidos', 'ordens_de_producao', 'cortes'];
const pools = [
    new pg.Pool({ connectionString: sourceUrl }),
    new pg.Pool({ connectionString: rollbackUrl }),
];

function hashRows(rows) {
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

async function snapshot(pool, tableName) {
    const result = await pool.query(`SELECT * FROM ${tableName} ORDER BY id`);
    return { total: result.rowCount, hash: hashRows(result.rows) };
}

try {
    const comparacoes = {};
    for (const tableName of tabelas) {
        const [source, rollback] = await Promise.all([
            snapshot(pools[0], tableName),
            snapshot(pools[1], tableName),
        ]);
        comparacoes[tableName] = {
            source,
            rollback,
            iguais: source.total === rollback.total && source.hash === rollback.hash,
        };
    }
    const aprovado = Object.values(comparacoes).every((item) => item.iguais);
    console.log(JSON.stringify({ sourceUrl, rollbackUrl, comparacoes, aprovado }, null, 2));
    if (!aprovado) process.exitCode = 2;
} finally {
    await Promise.all(pools.map((pool) => pool.end()));
}
