import 'dotenv/config';
import pg from 'pg';

const tabelasFase7 = [
    'usuarios',
    'usuarios_empresas',
    'ponto_diario',
    'sessoes_trabalho_producao',
    'historico_pagamentos_funcionarios',
    'registro_dias_trabalhados',
    'recibos_conferencia',
    'banco_pontos_saldo',
    'banco_pontos_log',
    'pontos_extras',
    'configuracoes_pontos_processos',
    'metas_regras',
    'metas_versoes',
    'gincanas',
    'gincanas_premiacoes',
    'gincanas_premios_ganhos',
    'avisos_popup',
    'avisos_popup_visualizacoes',
    'calendario_empresa',
    'producoes',
    'arremates',
];

const argumentos = process.argv.slice(2);
const connectionString = argumentos.find((argumento) => !argumento.startsWith('--'))
    || process.env.POSTGRES_URL;
const detalhado = argumentos.includes('--detalhado');

if (!connectionString) {
    throw new Error('Informe a URL do PostgreSQL ou configure POSTGRES_URL.');
}

const client = new pg.Client({ connectionString });
await client.connect();

try {
    await client.query('BEGIN READ ONLY');

    const [colunas, constraints, indices, totais] = await Promise.all([
        client.query(
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
            [tabelasFase7]
        ),
        client.query(
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
            [tabelasFase7]
        ),
        client.query(
            `SELECT
                tablename AS tabela,
                indexname AS indice,
                indexdef AS definicao
             FROM pg_indexes
             WHERE schemaname = 'public'
               AND tablename = ANY($1::text[])
             ORDER BY tablename, indexname`,
            [tabelasFase7]
        ),
        client.query(
            `SELECT
                tabela.relname AS tabela,
                tabela.reltuples::bigint AS linhas_estimadas
             FROM pg_class tabela
             JOIN pg_namespace schema_info
               ON schema_info.oid = tabela.relnamespace
             WHERE schema_info.nspname = 'public'
               AND tabela.relkind = 'r'
               AND tabela.relname = ANY($1::text[])
             ORDER BY tabela.relname`,
            [tabelasFase7]
        ),
    ]);

    const tabelas = tabelasFase7.map((tabela) => {
        const colunasTabela = colunas.rows.filter((coluna) => coluna.table_name === tabela);
        const nomesColunas = new Set(colunasTabela.map((coluna) => coluna.column_name));
        return {
            tabela,
            presente: colunasTabela.length > 0,
            linhas_estimadas: Number(
                totais.rows.find((item) => item.tabela === tabela)?.linhas_estimadas || 0
            ),
            possui_empresa_id: nomesColunas.has('empresa_id'),
            possui_usuario_id:
                nomesColunas.has('id_usuario')
                || nomesColunas.has('usuario_id')
                || nomesColunas.has('id_funcionario'),
            colunas_empresariais: colunasTabela
                .map((coluna) => coluna.column_name)
                .filter((nome) => nome.includes('empresa') || nome.includes('usuario')),
            total_colunas: colunasTabela.length,
            total_constraints: constraints.rows.filter((item) => item.tabela === tabela).length,
            total_indices: indices.rows.filter((item) => item.tabela === tabela).length,
        };
    });

    const resultado = {
        somente_leitura: true,
        total_tabelas_previstas: tabelasFase7.length,
        tabelas_presentes: tabelas.filter((tabela) => tabela.presente).length,
        tabelas_com_empresa_id: tabelas.filter((tabela) => tabela.possui_empresa_id).length,
        tabelas,
        constraints_empresariais: constraints.rows.filter((item) =>
            String(item.definicao).includes('empresa_id')
        ),
        indices_empresariais: indices.rows.filter((item) =>
            String(item.definicao).includes('empresa_id')
        ),
    };

    if (detalhado) {
        resultado.colunas = colunas.rows;
        resultado.constraints = constraints.rows;
        resultado.indices = indices.rows;
    }

    process.stdout.write(JSON.stringify(resultado, null, 2));
} finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
}
