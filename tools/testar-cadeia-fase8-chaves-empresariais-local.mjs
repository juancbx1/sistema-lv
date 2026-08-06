import pg from 'pg';

const connectionString = process.argv[2];
if (!connectionString || (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost'))) {
    throw new Error('Informe uma conexao PostgreSQL local.');
}

const pool = new pg.Pool({ connectionString });
const resultado = {
    connectionString,
    probes: [],
    schema: {},
    snapshot: {},
    aprovado: false,
};

function registrar(nome, aprovado, detalhes = {}) {
    resultado.probes.push({ nome, aprovado, ...detalhes });
}

async function snapshot(client) {
    const { rows } = await client.query(`
        SELECT
            (SELECT COUNT(*)::int FROM produtos) AS produtos,
            (SELECT COUNT(*)::int FROM demandas_producao) AS demandas,
            (SELECT COUNT(*)::int FROM demandas_componentes_atribuidos) AS componentes,
            (SELECT COUNT(*)::int FROM ordens_de_producao) AS ops,
            (SELECT COUNT(*)::int FROM cortes) AS cortes
    `);
    return rows[0];
}

async function executarProbe(client, nome, sql, values = []) {
    try {
        await client.query('BEGIN');
        const result = await client.query(sql, values);
        await client.query('ROLLBACK');
        registrar(nome, true, { rowCount: result.rowCount });
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // A conexao sera encerrada ao final; o erro original e o relevante.
        }
        registrar(nome, false, { code: error.code, constraint: error.constraint, error: error.message });
    }
}

try {
    const client = await pool.connect();
    try {
        const antes = await snapshot(client);

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

        resultado.schema = {
            nullability: nullability.rows,
            globalConstraintsRemaining: globals.rows.map(row => row.conname),
            enterpriseConstraintsPresent: empresariais.rows.map(row => row.conname),
        };

        await executarProbe(client, 'mesma componente_chave em duas empresas via ON CONFLICT composto', `
            INSERT INTO demandas_componentes_atribuidos (componente_chave, atribuida_a, empresa_id)
            VALUES ('g11-probe-componente', 'probe-a', 1)
            ON CONFLICT (empresa_id, componente_chave)
            DO UPDATE SET atribuida_a = EXCLUDED.atribuida_a;
            INSERT INTO demandas_componentes_atribuidos (componente_chave, atribuida_a, empresa_id)
            VALUES ('g11-probe-componente', 'probe-b', 2)
            ON CONFLICT (empresa_id, componente_chave)
            DO UPDATE SET atribuida_a = EXCLUDED.atribuida_a;
        `);

        try {
            await client.query('BEGIN');
            await client.query(`
                INSERT INTO demandas_componentes_atribuidos (componente_chave, atribuida_a, empresa_id)
                VALUES ('g11-probe-null', 'probe', NULL)
            `);
            await client.query('ROLLBACK');
            registrar('empresa_id obrigatorio em componentes', false, { error: 'INSERT nulo foi aceito' });
        } catch (error) {
            await client.query('ROLLBACK');
            registrar('empresa_id obrigatorio em componentes', error.code === '23502', {
                code: error.code,
                constraint: error.constraint,
            });
        }

        await executarProbe(client, 'mesmo nome de produto em duas empresas', `
            INSERT INTO produtos (nome, empresa_id) VALUES ('g11-probe-produto', 1);
            INSERT INTO produtos (nome, empresa_id) VALUES ('g11-probe-produto', 2);
        `);

        await executarProbe(client, 'mesmo numero e edit_id de OP em duas empresas', `
            INSERT INTO ordens_de_producao (numero, quantidade, data_entrega, edit_id, empresa_id)
            VALUES (990001, 1, CURRENT_DATE, 'G11-PROBE-EDIT', 1);
            INSERT INTO ordens_de_producao (numero, quantidade, data_entrega, edit_id, empresa_id)
            VALUES (990001, 1, CURRENT_DATE, 'G11-PROBE-EDIT', 2);
        `);

        await executarProbe(client, 'mesmo PN de corte em duas empresas', `
            INSERT INTO cortes (pn, quantidade, data, empresa_id)
            VALUES ('G11-PROBE-PN', 1, CURRENT_DATE, 1);
            INSERT INTO cortes (pn, quantidade, data, empresa_id)
            VALUES ('G11-PROBE-PN', 1, CURRENT_DATE, 2);
        `);

        resultado.snapshot = {
            antes,
            depois: await snapshot(client),
        };
    } finally {
        client.release();
    }
} finally {
    await pool.end();
}

const nullsOk = resultado.schema.nullability.length === 5
    && resultado.schema.nullability.every(row => row.is_nullable === 'NO');
const globalsOk = resultado.schema.globalConstraintsRemaining.length === 0;
const requiredEnterprise = [
    'uq_produtos_empresa_id',
    'uq_demandas_empresa_id',
    'uq_demandas_componentes_empresa_id',
    'uq_ops_empresa_id',
    'uq_ops_empresa_numero',
    'uq_ops_empresa_edit_id',
    'uq_cortes_empresa_id',
    'uq_cortes_empresa_pn',
];
const enterpriseOk = requiredEnterprise.every(name => resultado.schema.enterpriseConstraintsPresent.includes(name));
const snapshotsOk = JSON.stringify(resultado.snapshot.antes) === JSON.stringify(resultado.snapshot.depois);
resultado.aprovado = nullsOk && globalsOk && enterpriseOk && snapshotsOk && resultado.probes.every(probe => probe.aprovado);
resultado.assertions = { nullsOk, globalsOk, enterpriseOk, snapshotsOk };

console.log(JSON.stringify(resultado, null, 2));
if (!resultado.aprovado) process.exitCode = 1;
