import pg from 'pg';

const connectionString = process.argv[2] || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_ponto_motor_test';
if (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost')) {
    throw new Error('Este inspetor aceita somente uma conexão PostgreSQL local.');
}

const pool = new pg.Pool({ connectionString });
const nomes = [
    'produtos',
    'demandas_producao',
    'demandas_componentes_atribuidos',
    'ordens_de_producao',
    'cortes',
    'produto_composicao_mp',
    'produto_custo_mao_de_obra',
    'produto_precificacao_configs',
    'tempos_padrao_producao',
    'tempos_padrao_arremate',
    'configuracoes_pontos_processos',
    'materias_primas',
];

try {
    const tabelas = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name
    `, [nomes]);

    const colunas = await pool.query(`
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name, ordinal_position
    `, [nomes]);

    const constraints = await pool.query(`
        SELECT
            c.conrelid::regclass::text AS table_name,
            c.conname,
            pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c
        WHERE c.conrelid::regclass::text = ANY($1::text[])
        ORDER BY 1, 2
    `, [nomes]);

    const indices = await pool.query(`
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = ANY($1::text[])
        ORDER BY tablename, indexname
    `, [nomes]);

    console.log(JSON.stringify({
        connection: connectionString,
        tables: tabelas.rows,
        columns: colunas.rows,
        constraints: constraints.rows,
        indexes: indices.rows,
    }, null, 2));
} finally {
    await pool.end();
}
