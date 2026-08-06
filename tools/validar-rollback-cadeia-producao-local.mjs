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

const tabelas = [
    'produtos',
    'demandas_producao',
    'demandas_componentes_atribuidos',
    'ordens_de_producao',
    'cortes',
    'producoes',
    'sessoes_trabalho_producao',
    'producoes_solicitacoes_exclusao',
];
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

async function schemaState(pool) {
    const columns = await pool.query(`
        SELECT table_name, column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name IN ('producoes', 'producoes_solicitacoes_exclusao')
           AND column_name = 'empresa_id'
    `);
    const constraints = await pool.query(`
        SELECT conname
          FROM pg_constraint
         WHERE conname = ANY($1::text[])
    `, [[
        'uq_producoes_empresa_id',
        'uq_producao_solicitacoes_empresa_id',
        'fk_producoes_empresa',
        'fk_producoes_produto_empresa',
        'fk_producoes_op_empresa',
        'fk_producoes_funcionario_empresa',
        'fk_producao_solicitacoes_empresa',
        'fk_producao_solicitacoes_producao_empresa',
        'fk_sessoes_producao_produto_empresa',
        'fk_sessoes_producao_op_empresa',
    ]]);
    const indices = await pool.query(`
        SELECT indexname
          FROM pg_indexes
         WHERE schemaname = 'public'
           AND indexname = ANY($1::text[])
    `, [[
        'idx_producoes_empresa_data',
        'idx_producoes_empresa_op_etapa',
        'idx_producoes_empresa_funcionario_data',
        'idx_sessoes_producao_empresa_status',
        'idx_sessoes_producao_empresa_op',
        'idx_producao_solicitacoes_empresa_status',
    ]]);
    const marker = await pool.query(
        'SELECT id FROM sistema_migrations WHERE id = $1',
        ['multiempresas-fase8-producao-ensaio-v1']
    );
    return {
        columns: columns.rows,
        constraints: constraints.rows,
        indices: indices.rows,
        marker: marker.rows,
    };
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
    const estado = await schemaState(pools[1]);
    const aprovado = Object.values(comparacoes).every((item) => item.iguais)
        && estado.columns.length === 0
        && estado.constraints.length === 0
        && estado.indices.length === 0
        && estado.marker.length === 0;
    console.log(JSON.stringify({ sourceUrl, rollbackUrl, comparacoes, estado, aprovado }, null, 2));
    if (!aprovado) process.exitCode = 2;
} finally {
    await Promise.all(pools.map((pool) => pool.end()));
}
