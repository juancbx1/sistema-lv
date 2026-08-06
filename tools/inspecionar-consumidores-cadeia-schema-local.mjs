import pg from 'pg';

const connectionString = process.argv[2] || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_ponto_motor_test';
if (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost')) {
    throw new Error('Este inspetor aceita somente uma conexão PostgreSQL local.');
}

const tabelasAlvo = [
    'producoes',
    'producoes_solicitacoes_exclusao',
    'sessoes_trabalho_producao',
    'arremates',
    'embalagens_realizadas',
    'estoque_movimentos',
    'estoque_itens_arquivados',
    'produto_niveis_estoque_alerta',
    'producao_promessas',
    'configuracoes_alertas',
    'alertas_configuracoes_gerais',
    'eventos_sistema',
    'historico_alertas',
];

const pool = new pg.Pool({ connectionString });

try {
    const existentes = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name
    `, [tabelasAlvo]);

    const existentesSet = new Set(existentes.rows.map(row => row.table_name));
    const tabelas = [];

    for (const tableName of tabelasAlvo.filter(name => existentesSet.has(name))) {
        const colunasResult = await pool.query(`
            SELECT column_name, is_nullable, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
        `, [tableName]);

        const colunas = colunasResult.rows;
        const possuiEmpresa = colunas.some(column => column.column_name === 'empresa_id');
        let dados = null;

        if (possuiEmpresa) {
            const result = await pool.query(`
                SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE empresa_id IS NULL)::int AS sem_empresa,
                    COUNT(*) FILTER (WHERE empresa_id IS NOT NULL)::int AS com_empresa,
                    COUNT(DISTINCT empresa_id)::int AS empresas_distintas
                FROM ${tableName}
            `);
            dados = result.rows[0];
        } else {
            const result = await pool.query(`SELECT COUNT(*)::int AS total FROM ${tableName}`);
            dados = result.rows[0];
        }

        tabelas.push({
            tabela: tableName,
            possui_empresa_id: possuiEmpresa,
            empresa_id_nullable: colunas.find(column => column.column_name === 'empresa_id')?.is_nullable ?? null,
            dados,
            colunas: colunas.map(column => column.column_name),
        });
    }

    console.log(JSON.stringify({
        connection: connectionString,
        ausentes: tabelasAlvo.filter(name => !existentesSet.has(name)),
        tabelas,
    }, null, 2));
} finally {
    await pool.end();
}
