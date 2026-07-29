import 'dotenv/config';
import pg from 'pg';

const tabelas = [
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
if (!connectionString) throw new Error('POSTGRES_URL não configurada.');

const client = new pg.Client({ connectionString });
await client.connect();

try {
    await client.query('BEGIN READ ONLY');

    const empresaLegada = await client.query(
        `SELECT id, codigo, nome_fantasia
           FROM empresas
          WHERE codigo = 'lojas-variara'`
    );

    const nulabilidade = await client.query(
        `SELECT table_name, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND column_name = 'empresa_id'
            AND table_name = ANY($1::text[])
          ORDER BY table_name`,
        [tabelas]
    );

    const linhasPorTabela = [];
    for (const tabela of tabelas) {
        const result = await client.query(
            `SELECT COUNT(*)::integer AS total,
                    COUNT(*) FILTER (WHERE empresa_id IS NULL)::integer AS sem_empresa
               FROM ${tabela}`
        );
        linhasPorTabela.push({ tabela, ...result.rows[0] });
    }

    const integridade = await client.query(
        `SELECT 'categoria_grupo' AS relacao, COUNT(*)::integer AS divergencias
           FROM fc_categorias c
           JOIN fc_grupos_financeiros g ON g.id = c.id_grupo
          WHERE c.empresa_id IS DISTINCT FROM g.empresa_id
         UNION ALL
         SELECT 'lancamento_conta', COUNT(*)::integer
           FROM fc_lancamentos l
           JOIN fc_contas_bancarias c ON c.id = l.id_conta_bancaria
          WHERE l.empresa_id IS DISTINCT FROM c.empresa_id
         UNION ALL
         SELECT 'lancamento_categoria', COUNT(*)::integer
           FROM fc_lancamentos l
           JOIN fc_categorias c ON c.id = l.id_categoria
          WHERE l.empresa_id IS DISTINCT FROM c.empresa_id
         UNION ALL
         SELECT 'lancamento_contato', COUNT(*)::integer
           FROM fc_lancamentos l
           JOIN fc_contatos c ON c.id = l.id_contato
          WHERE l.empresa_id IS DISTINCT FROM c.empresa_id
         UNION ALL
         SELECT 'lancamento_estorno', COUNT(*)::integer
           FROM fc_lancamentos l
           JOIN fc_lancamentos relacionado ON relacionado.id = l.id_estorno_de
          WHERE l.empresa_id IS DISTINCT FROM relacionado.empresa_id
         UNION ALL
         SELECT 'lancamento_transferencia', COUNT(*)::integer
           FROM fc_lancamentos l
           JOIN fc_lancamentos relacionado ON relacionado.id = l.id_transferencia_vinculada
          WHERE l.empresa_id IS DISTINCT FROM relacionado.empresa_id
         UNION ALL
         SELECT 'item_lancamento_pai', COUNT(*)::integer
           FROM fc_lancamento_itens i
           JOIN fc_lancamentos l ON l.id = i.id_lancamento_pai
          WHERE i.empresa_id IS DISTINCT FROM l.empresa_id
         UNION ALL
         SELECT 'item_lancamento_categoria', COUNT(*)::integer
           FROM fc_lancamento_itens i
           JOIN fc_categorias c ON c.id = i.id_categoria
          WHERE i.empresa_id IS DISTINCT FROM c.empresa_id
         UNION ALL
         SELECT 'item_lancamento_contato', COUNT(*)::integer
           FROM fc_lancamento_itens i
           JOIN fc_contatos c ON c.id = i.id_contato_item
          WHERE i.empresa_id IS DISTINCT FROM c.empresa_id
         UNION ALL
         SELECT 'agendamento_categoria', COUNT(*)::integer
           FROM fc_contas_agendadas a
           JOIN fc_categorias c ON c.id = a.id_categoria
          WHERE a.empresa_id IS DISTINCT FROM c.empresa_id
         UNION ALL
         SELECT 'agendamento_contato', COUNT(*)::integer
           FROM fc_contas_agendadas a
           JOIN fc_contatos c ON c.id = a.id_contato
          WHERE a.empresa_id IS DISTINCT FROM c.empresa_id
         UNION ALL
         SELECT 'agendamento_lancamento', COUNT(*)::integer
           FROM fc_contas_agendadas a
           JOIN fc_lancamentos l ON l.id = a.id_lancamento_efetivado
          WHERE a.empresa_id IS DISTINCT FROM l.empresa_id
         UNION ALL
         SELECT 'agendamento_lote', COUNT(*)::integer
           FROM fc_contas_agendadas a
           JOIN fc_lotes_agendamento l ON l.id = a.id_lote
          WHERE a.empresa_id IS DISTINCT FROM l.empresa_id
         UNION ALL
         SELECT 'item_agendamento_pai', COUNT(*)::integer
           FROM fc_contas_agendadas_itens i
           JOIN fc_contas_agendadas a ON a.id = i.id_conta_agendada_pai
          WHERE i.empresa_id IS DISTINCT FROM a.empresa_id
         UNION ALL
         SELECT 'item_agendamento_categoria', COUNT(*)::integer
           FROM fc_contas_agendadas_itens i
           JOIN fc_categorias c ON c.id = i.id_categoria
          WHERE i.empresa_id IS DISTINCT FROM c.empresa_id
         UNION ALL
         SELECT 'item_agendamento_contato', COUNT(*)::integer
           FROM fc_contas_agendadas_itens i
           JOIN fc_contatos c ON c.id = i.id_contato_item
          WHERE i.empresa_id IS DISTINCT FROM c.empresa_id
         UNION ALL
         SELECT 'solicitacao_lancamento', COUNT(*)::integer
           FROM fc_solicitacoes_alteracao s
           JOIN fc_lancamentos l ON l.id = s.id_lancamento
          WHERE s.empresa_id IS DISTINCT FROM l.empresa_id
         UNION ALL
         SELECT 'concessionaria_contato', COUNT(*)::integer
           FROM config_concessionarias_vt v
           JOIN fc_contatos c ON c.id = v.id_contato_financeiro
          WHERE v.empresa_id IS DISTINCT FROM c.empresa_id`
    );

    const constraints = await client.query(
        `SELECT tabela.relname AS tabela,
                constraint_info.conname AS nome,
                constraint_info.contype AS tipo,
                constraint_info.convalidated AS validada,
                pg_get_constraintdef(constraint_info.oid) AS definicao
           FROM pg_constraint constraint_info
           JOIN pg_class tabela ON tabela.oid = constraint_info.conrelid
           JOIN pg_namespace schema_info ON schema_info.oid = tabela.relnamespace
          WHERE schema_info.nspname = 'public'
            AND tabela.relname = ANY($1::text[])
          ORDER BY tabela.relname, constraint_info.conname`,
        [tabelas]
    );

    const indicesInvalidos = await client.query(
        `SELECT tabela.relname AS tabela, indice.relname AS indice
           FROM pg_index info
           JOIN pg_class indice ON indice.oid = info.indexrelid
           JOIN pg_class tabela ON tabela.oid = info.indrelid
           JOIN pg_namespace schema_info ON schema_info.oid = tabela.relnamespace
          WHERE schema_info.nspname = 'public'
            AND tabela.relname = ANY($1::text[])
            AND NOT info.indisvalid`,
        [tabelas]
    );

    const migrations = await client.query(
        `SELECT to_jsonb(migration) AS registro
           FROM sistema_migrations migration
          WHERE to_jsonb(migration)::text ILIKE '%financeiro%'
          ORDER BY to_jsonb(migration)::text`
    );

    const modulo = await client.query(
        `SELECT codigo, multiempresa_pronto
           FROM modulos_sistema
          WHERE codigo = 'financeiro'`
    );

    const fixtures = await client.query(
        `SELECT COUNT(*)::integer AS total
           FROM empresas
          WHERE codigo IN ('teste-financeiro-a', 'teste-financeiro-b')`
    );

    const totais = await client.query(
        `SELECT
            (SELECT COUNT(*)::integer FROM fc_lancamentos) AS lancamentos,
            (SELECT COALESCE(SUM(valor), 0)::text FROM fc_lancamentos) AS valor_lancamentos,
            (SELECT COUNT(*)::integer FROM fc_contas_agendadas) AS agendamentos,
            (SELECT COALESCE(SUM(valor), 0)::text FROM fc_contas_agendadas) AS valor_agendamentos`
    );

    const semEmpresa = linhasPorTabela.reduce((total, row) => total + row.sem_empresa, 0);
    const divergencias = integridade.rows.reduce((total, row) => total + row.divergencias, 0);
    const colunasObrigatorias = nulabilidade.rows.filter((row) => row.is_nullable === 'NO').length;
    const constraintsNaoValidadas = constraints.rows.filter((row) => !row.validada).length;

    process.stdout.write(JSON.stringify({
        somente_leitura: true,
        aprovado_pre_finalizacao: empresaLegada.rowCount === 1
            && semEmpresa === 0
            && divergencias === 0
            && constraintsNaoValidadas === 0
            && indicesInvalidos.rowCount === 0
            && fixtures.rows[0].total === 0
            && modulo.rows[0]?.multiempresa_pronto === false,
        finalizacao_executada: colunasObrigatorias === tabelas.length,
        empresa_legada: empresaLegada.rows[0] || null,
        colunas_empresa_obrigatorias: colunasObrigatorias,
        total_colunas_empresa: tabelas.length,
        total_linhas_sem_empresa: semEmpresa,
        total_divergencias_empresariais: divergencias,
        constraints_nao_validadas: constraintsNaoValidadas,
        indices_invalidos: indicesInvalidos.rows,
        fixtures_temporarias: fixtures.rows[0].total,
        financeiro_multiempresa_pronto: modulo.rows[0]?.multiempresa_pronto ?? null,
        linhas_por_tabela: linhasPorTabela,
        integridade: integridade.rows,
        migrations: migrations.rows.map((row) => row.registro),
        totais: totais.rows[0],
    }, null, 2));
} finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
}
