import 'dotenv/config';
import pg from 'pg';

const tabelasFinanceiras = [
    'fc_contas_bancarias',
    'fc_grupos_financeiros',
    'fc_categorias',
    'fc_contatos',
    'fc_lancamentos',
    'fc_lancamento_itens',
    'fc_contas_agendadas',
    'fc_contas_agendadas_itens',
    'fc_lotes_agendamento',
    'fc_solicitacoes_alteracao',
    'fc_logs_auditoria',
    'fc_notificacoes',
    'config_concessionarias_vt',
];

const connectionString = process.argv[2] || process.env.POSTGRES_URL;

if (!connectionString) {
    throw new Error('Informe a URL do PostgreSQL ou configure POSTGRES_URL.');
}

const client = new pg.Client({ connectionString });
await client.connect();

try {
    await client.query('BEGIN READ ONLY');

    const servidor = await client.query(
        `SELECT
            current_setting('server_version') AS versao,
            current_setting('server_version_num')::integer AS versao_numero`
    );

    const colunas = await client.query(
        `SELECT
            table_name,
            column_name,
            data_type,
            udt_name,
            is_nullable,
            column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
         ORDER BY table_name, ordinal_position`,
        [tabelasFinanceiras]
    );

    const constraints = await client.query(
        `SELECT
            tabela.relname AS tabela,
            constraint_info.conname AS constraint_name,
            constraint_info.contype AS tipo,
            pg_get_constraintdef(constraint_info.oid) AS definicao
         FROM pg_constraint constraint_info
         JOIN pg_class tabela
           ON tabela.oid = constraint_info.conrelid
         JOIN pg_namespace schema_info
           ON schema_info.oid = tabela.relnamespace
         WHERE schema_info.nspname = 'public'
           AND tabela.relname = ANY($1::text[])
         ORDER BY tabela.relname, constraint_info.contype, constraint_info.conname`,
        [tabelasFinanceiras]
    );

    const indices = await client.query(
        `SELECT
            tablename AS tabela,
            indexname AS indice,
            indexdef AS definicao
         FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename = ANY($1::text[])
         ORDER BY tablename, indexname`,
        [tabelasFinanceiras]
    );

    const resumoTabelas = tabelasFinanceiras.map((tabela) => {
        const colunasDaTabela = colunas.rows.filter((coluna) => coluna.table_name === tabela);
        return {
            tabela,
            presente: colunasDaTabela.length > 0,
            total_colunas: colunasDaTabela.length,
            possui_empresa_id: colunasDaTabela.some((coluna) => coluna.column_name === 'empresa_id'),
            total_constraints: constraints.rows.filter((constraint) => constraint.tabela === tabela).length,
            total_indices: indices.rows.filter((indice) => indice.tabela === tabela).length,
        };
    });

    process.stdout.write(JSON.stringify({
        somente_leitura: true,
        servidor: servidor.rows[0],
        tabelas: resumoTabelas,
        colunas: colunas.rows,
        constraints: constraints.rows,
        indices: indices.rows,
    }, null, 2));
} finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
}
