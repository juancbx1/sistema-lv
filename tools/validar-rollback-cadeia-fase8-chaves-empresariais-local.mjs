import pg from 'pg';

const targetConnectionString = process.argv[2];
const sourceConnectionString = process.argv[3];
if (![targetConnectionString, sourceConnectionString].every(value => value && (value.includes('127.0.0.1') || value.includes('localhost')))) {
    throw new Error('Informe as conexoes PostgreSQL locais do rollback e da origem.');
}

const targetPool = new pg.Pool({ connectionString: targetConnectionString });
const sourcePool = new pg.Pool({ connectionString: sourceConnectionString });
const resultado = { targetConnectionString, sourceConnectionString, probes: [], schema: {}, snapshot: {}, aprovado: false };

function registrar(nome, aprovado, detalhes = {}) {
    resultado.probes.push({ nome, aprovado, ...detalhes });
}

async function snapshot(pool) {
    const { rows } = await pool.query(`
        SELECT
            (SELECT COUNT(*)::int FROM produtos) AS produtos,
            (SELECT COUNT(*)::int FROM demandas_producao) AS demandas,
            (SELECT COUNT(*)::int FROM demandas_componentes_atribuidos) AS componentes,
            (SELECT COUNT(*)::int FROM ordens_de_producao) AS ops,
            (SELECT COUNT(*)::int FROM cortes) AS cortes
    `);
    return rows[0];
}

try {
    const [targetSnapshot, sourceSnapshot] = await Promise.all([snapshot(targetPool), snapshot(sourcePool)]);
    const client = await targetPool.connect();
    try {
        const nullability = await client.query(`
            SELECT table_name, column_name, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ANY($1::text[])
              AND column_name = 'empresa_id'
            ORDER BY table_name
        `, [['produtos', 'demandas_producao', 'demandas_componentes_atribuidos', 'ordens_de_producao', 'cortes']]);

        const globals = await client.query(`
            SELECT conname
            FROM pg_constraint
            WHERE conname = ANY($1::text[])
            ORDER BY conname
        `, [[
            'demandas_componentes_atribuidos_componente_chave_key',
            'produtos_nome_key',
            'numero_op_unico',
            'ordens_de_producao_numero_key',
            'ordens_de_producao_edit_id_key',
            'cortes_pn_key',
            'cortes_pn_unique',
        ]]);

        const empresariais = await client.query(`
            SELECT conname
            FROM pg_constraint
            WHERE conname = ANY($1::text[])
            ORDER BY conname
        `, [[
            'uq_produtos_empresa_id',
            'uq_demandas_empresa_id',
            'uq_demandas_componentes_empresa_id',
            'uq_ops_empresa_id',
            'uq_ops_empresa_numero',
            'uq_ops_empresa_edit_id',
            'uq_cortes_empresa_id',
            'uq_cortes_empresa_pn',
        ]]);

        const marker = await client.query(
            'SELECT COUNT(*)::int AS total FROM sistema_migrations WHERE id = $1',
            ['multiempresas-fase8-finalizacao-chaves-empresariais-ensaio-v1']
        );

        resultado.schema = {
            nullability: nullability.rows,
            globalConstraintsPresent: globals.rows.map(row => row.conname),
            enterpriseConstraintsPresent: empresariais.rows.map(row => row.conname),
            finalizationMarkerCount: marker.rows[0].total,
        };

        try {
            await client.query('BEGIN');
            await client.query(`
                INSERT INTO demandas_componentes_atribuidos (componente_chave, atribuida_a, empresa_id)
                VALUES ('g11-rollback-probe', 'rollback-a', 1)
            `);
            await client.query(`
                INSERT INTO demandas_componentes_atribuidos (componente_chave, atribuida_a, empresa_id)
                VALUES ('g11-rollback-probe', 'rollback-b', 2)
            `);
            await client.query('ROLLBACK');
            registrar('rollback restaura unicidade global de componente', false, { error: 'segunda insercao foi aceita' });
        } catch (error) {
            await client.query('ROLLBACK');
            registrar('rollback restaura unicidade global de componente', error.code === '23505', {
                code: error.code,
                constraint: error.constraint,
            });
        }

        try {
            await client.query('BEGIN');
            await client.query(`
                INSERT INTO demandas_componentes_atribuidos (componente_chave, atribuida_a, empresa_id)
                VALUES ('g11-rollback-null', 'rollback', NULL)
            `);
            await client.query('ROLLBACK');
            registrar('rollback restaura nulabilidade transitória de empresa_id', true);
        } catch (error) {
            await client.query('ROLLBACK');
            registrar('rollback restaura nulabilidade transitória de empresa_id', false, {
                code: error.code,
                constraint: error.constraint,
                error: error.message,
            });
        }
    } finally {
        client.release();
    }

    resultado.snapshot = { source: sourceSnapshot, target: targetSnapshot };
} finally {
    await targetPool.end();
    await sourcePool.end();
}

const expectedGlobals = [
    'cortes_pn_key',
    'cortes_pn_unique',
    'demandas_componentes_atribuidos_componente_chave_key',
    'numero_op_unico',
    'ordens_de_producao_edit_id_key',
    'ordens_de_producao_numero_key',
    'produtos_nome_key',
];
const expectedEnterprise = [
    'uq_produtos_empresa_id',
    'uq_demandas_empresa_id',
    'uq_demandas_componentes_empresa_id',
    'uq_ops_empresa_id',
    'uq_ops_empresa_numero',
    'uq_ops_empresa_edit_id',
    'uq_cortes_empresa_id',
    'uq_cortes_empresa_pn',
];
const nullableOk = resultado.schema.nullability.length === 5
    && resultado.schema.nullability.every(row => row.is_nullable === 'YES');
const globalsOk = JSON.stringify(resultado.schema.globalConstraintsPresent) === JSON.stringify(expectedGlobals);
const enterpriseOk = expectedEnterprise.every(name => resultado.schema.enterpriseConstraintsPresent.includes(name));
const markerOk = resultado.schema.finalizationMarkerCount === 0;
const snapshotOk = JSON.stringify(resultado.snapshot.source) === JSON.stringify(resultado.snapshot.target);
resultado.aprovado = nullableOk && globalsOk && enterpriseOk && markerOk && snapshotOk && resultado.probes.every(probe => probe.aprovado);
resultado.assertions = { nullableOk, globalsOk, enterpriseOk, markerOk, snapshotOk };

console.log(JSON.stringify(resultado, null, 2));
if (!resultado.aprovado) process.exitCode = 1;
