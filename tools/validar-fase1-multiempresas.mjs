import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const connectionString = process.argv[2] || process.env.POSTGRES_URL;
if (!connectionString) throw new Error('Informe a URL do banco ou configure POSTGRES_URL.');

const isLocal = connectionString.includes('127.0.0.1') || connectionString.includes('localhost');
const pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
});

const requiredTables = [
    'empresas',
    'empresas_modulos',
    'modulos_sistema',
    'sistema_migrations',
    'usuarios_acessos_globais',
    'usuarios_empresas',
];

const expectedModules = [
    'alertas',
    'arremates',
    'calendario',
    'central-pagamentos',
    'cortes',
    'dashboard',
    'embalagem',
    'estoque',
    'financeiro',
    'gerenciar-producao',
    'gestao-organizacional',
    'home-admin',
    'incentivos',
    'inventario',
    'ordens-producao',
    'permissoes',
    'producao-geral',
    'produtos',
];

const client = await pool.connect();

try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const existingTables = (await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name
    `, [requiredTables])).rows.map((row) => row.table_name);

    const missingTables = requiredTables.filter((table) => !existingTables.includes(table));
    if (missingTables.length > 0) {
        process.stdout.write(`${JSON.stringify({
            passed: false,
            error: 'Estruturas da Fase 1 ausentes.',
            missingTables,
        }, null, 2)}\n`);
        process.exitCode = 2;
    } else {
        const summary = (await client.query(`
            SELECT
                (SELECT COUNT(*)::int FROM usuarios) AS usuarios,
                (SELECT COUNT(*)::int FROM empresas) AS empresas,
                (SELECT COUNT(*)::int FROM empresas WHERE eh_legada) AS empresas_legadas,
                (
                    SELECT COUNT(*)::int
                    FROM empresas
                    WHERE codigo = 'lojas-variara'
                      AND eh_legada
                      AND ativa
                ) AS empresa_inicial_valida,
                (SELECT COUNT(*)::int FROM usuarios_empresas) AS vinculos,
                (
                    SELECT COUNT(*)::int
                    FROM usuarios_empresas
                    WHERE empresa_principal
                ) AS vinculos_principais,
                (
                    SELECT COUNT(*)::int
                    FROM usuarios u
                    LEFT JOIN usuarios_empresas ue
                      ON ue.usuario_id = u.id
                    LEFT JOIN empresas e
                      ON e.id = ue.empresa_id
                     AND e.codigo = 'lojas-variara'
                    WHERE e.id IS NULL
                ) AS usuarios_sem_vinculo_legado,
                (
                    SELECT COUNT(*)::int
                    FROM (
                        SELECT usuario_id
                        FROM usuarios_empresas
                        WHERE empresa_principal
                        GROUP BY usuario_id
                        HAVING COUNT(*) <> 1
                    ) inconsistentes
                ) AS usuarios_com_principal_inconsistente,
                (
                    SELECT COUNT(*)::int
                    FROM usuarios_acessos_globais
                    WHERE superadministrador
                ) AS superadministradores,
                (SELECT COUNT(*)::int FROM modulos_sistema) AS modulos,
                (
                    SELECT COUNT(*)::int
                    FROM empresas_modulos em
                    JOIN empresas e ON e.id = em.empresa_id
                    WHERE e.codigo = 'lojas-variara'
                      AND em.habilitado
                ) AS modulos_habilitados_legada,
                (
                    SELECT COUNT(*)::int
                    FROM sistema_migrations
                    WHERE id = 'multiempresas-fase1-fundacao-v1'
                ) AS migration_registrada
        `)).rows[0];

        const copiedFieldMismatches = Number((await client.query(`
            SELECT COUNT(*)::int AS count
            FROM usuarios u
            JOIN usuarios_empresas ue ON ue.usuario_id = u.id
            JOIN empresas e ON e.id = ue.empresa_id
            WHERE e.codigo = 'lojas-variara'
              AND (
                    ue.tipos IS DISTINCT FROM COALESCE(u.tipos, '{}'::text[])
                 OR ue.permissoes IS DISTINCT FROM COALESCE(u.permissoes, '{}'::text[])
                 OR ue.nivel IS DISTINCT FROM u.nivel
                 OR ue.salario_fixo IS DISTINCT FROM COALESCE(u.salario_fixo, 0)
                 OR ue.valor_passagem_diaria IS DISTINCT FROM COALESCE(u.valor_passagem_diaria, 0)
                 OR ue.elegivel_pagamento IS DISTINCT FROM COALESCE(u.elegivel_pagamento, TRUE)
                 OR ue.id_contato_financeiro IS DISTINCT FROM u.id_contato_financeiro
                 OR ue.data_admissao IS DISTINCT FROM u.data_admissao
                 OR ue.data_demissao IS DISTINCT FROM u.data_demissao
                 OR ue.horario_entrada_1 IS DISTINCT FROM u.horario_entrada_1
                 OR ue.horario_saida_1 IS DISTINCT FROM u.horario_saida_1
                 OR ue.horario_entrada_2 IS DISTINCT FROM u.horario_entrada_2
                 OR ue.horario_saida_2 IS DISTINCT FROM u.horario_saida_2
                 OR ue.horario_entrada_3 IS DISTINCT FROM u.horario_entrada_3
                 OR ue.horario_saida_3 IS DISTINCT FROM u.horario_saida_3
                 OR ue.dias_trabalho IS DISTINCT FROM COALESCE(
                        u.dias_trabalho,
                        '{"1": true, "2": true, "3": true, "4": true, "5": true}'::jsonb
                    )
                 OR ue.status_atual IS DISTINCT FROM COALESCE(u.status_atual, 'LIVRE')
                 OR ue.id_sessao_trabalho_atual IS DISTINCT FROM u.id_sessao_trabalho_atual
                 OR ue.status_data_modificacao IS DISTINCT FROM u.status_data_modificacao
                 OR ue.ultimo_alerta_ociosidade_em IS DISTINCT FROM u.ultimo_alerta_ociosidade_em
                 OR ue.ultimo_alerta_lentidao_em IS DISTINCT FROM u.ultimo_alerta_lentidao_em
                 OR ue.badge_destaque_id IS DISTINCT FROM u.badge_destaque_id
                 OR ue.is_freelance IS DISTINCT FROM COALESCE(u.is_freelance, FALSE)
                 OR ue.ativo IS DISTINCT FROM (
                        u.data_demissao IS NULL
                        AND NOT COALESCE(u.arquivado, FALSE)
                    )
              )
        `)).rows[0].count);

        const modules = (await client.query(`
            SELECT codigo
            FROM modulos_sistema
            ORDER BY codigo
        `)).rows.map((row) => row.codigo);

        const missingModules = expectedModules.filter((module) => !modules.includes(module));
        const unexpectedModules = modules.filter((module) => !expectedModules.includes(module));

        const integrity = (await client.query(`
            SELECT
                (
                    SELECT COUNT(*)::int
                    FROM pg_constraint c
                    JOIN pg_namespace n ON n.oid = c.connamespace
                    WHERE n.nspname = 'public'
                      AND NOT c.convalidated
                ) AS constraints_nao_validadas,
                (
                    SELECT COUNT(*)::int
                    FROM pg_index i
                    JOIN pg_class idx ON idx.oid = i.indexrelid
                    JOIN pg_namespace n ON n.oid = idx.relnamespace
                    WHERE n.nspname = 'public'
                      AND (NOT i.indisvalid OR NOT i.indisready)
                ) AS indices_invalidos
        `)).rows[0];

        const checks = {
            requiredTablesPresent: missingTables.length === 0,
            oneLegacyCompany: summary.empresas_legadas === 1,
            initialCompanyValid: summary.empresa_inicial_valida === 1,
            oneLinkPerExistingUser: summary.vinculos === summary.usuarios,
            onePrimaryPerExistingUser: summary.vinculos_principais === summary.usuarios,
            noUserWithoutLegacyLink: summary.usuarios_sem_vinculo_legado === 0,
            noInconsistentPrimary: summary.usuarios_com_principal_inconsistente === 0,
            copiedFieldsMatch: copiedFieldMismatches === 0,
            modulesMatch: missingModules.length === 0 && unexpectedModules.length === 0,
            legacyModulesEnabled: summary.modulos_habilitados_legada === expectedModules.length,
            migrationRegistered: summary.migration_registrada === 1,
            allConstraintsValidated: integrity.constraints_nao_validadas === 0,
            allIndexesValid: integrity.indices_invalidos === 0,
        };

        const passed = Object.values(checks).every(Boolean);
        const warnings = [];
        if (summary.superadministradores === 0) {
            warnings.push(
                'Nenhum superadministrador global foi escolhido; isso é esperado até a ativação da Gestão Organizacional.',
            );
        }

        process.stdout.write(`${JSON.stringify({
            passed,
            checks,
            summary: {
                ...summary,
                copiedFieldMismatches,
                constraintsNaoValidadas: integrity.constraints_nao_validadas,
                indicesInvalidos: integrity.indices_invalidos,
            },
            missingModules,
            unexpectedModules,
            warnings,
        }, null, 2)}\n`);

        if (!passed) process.exitCode = 2;
    }

    await client.query('ROLLBACK');
} catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
} finally {
    client.release();
    await pool.end();
}
