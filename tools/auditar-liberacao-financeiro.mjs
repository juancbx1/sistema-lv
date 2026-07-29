import 'dotenv/config';
import pg from 'pg';

const connectionString = process.argv[2] || process.env.POSTGRES_URL;
if (!connectionString) throw new Error('POSTGRES_URL não configurada.');

const client = new pg.Client({ connectionString });
await client.connect();

try {
    await client.query('BEGIN READ ONLY');

    const empresas = await client.query(
        `SELECT id, codigo, nome_fantasia, ativa
           FROM empresas
          WHERE codigo IN ('lojas-variara', 'neila-confeccoes')
          ORDER BY codigo`
    );

    const modulo = await client.query(
        `SELECT *
           FROM modulos_sistema
          WHERE codigo = 'financeiro'`
    );

    const habilitacoes = await client.query(
        `SELECT em.*
           FROM empresas_modulos em
           JOIN empresas e ON e.id = em.empresa_id
          WHERE e.codigo IN ('lojas-variara', 'neila-confeccoes')
            AND em.modulo_codigo = 'financeiro'
          ORDER BY e.codigo`
    );

    const colunas = await client.query(
        `SELECT table_name, column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN ('modulos_sistema', 'empresas_modulos', 'sistema_migrations')
          ORDER BY table_name, ordinal_position`
    );

    const constraints = await client.query(
        `SELECT tabela.relname AS tabela,
                constraint_info.conname AS nome,
                constraint_info.contype AS tipo,
                pg_get_constraintdef(constraint_info.oid) AS definicao
           FROM pg_constraint constraint_info
           JOIN pg_class tabela ON tabela.oid = constraint_info.conrelid
           JOIN pg_namespace schema_info ON schema_info.oid = tabela.relnamespace
          WHERE schema_info.nspname = 'public'
            AND tabela.relname IN ('modulos_sistema', 'empresas_modulos', 'sistema_migrations')
          ORDER BY tabela.relname, constraint_info.conname`
    );

    const migrationFinalizacao = await client.query(
        `SELECT to_jsonb(migration) AS registro
           FROM sistema_migrations migration
          WHERE id = 'multiempresas-fase6-financeiro-finalizacao-v1'`
    );

    process.stdout.write(JSON.stringify({
        somente_leitura: true,
        empresas: empresas.rows,
        modulo: modulo.rows,
        habilitacoes: habilitacoes.rows,
        colunas: colunas.rows,
        constraints: constraints.rows,
        migration_finalizacao: migrationFinalizacao.rows,
    }, null, 2));
} finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
}
