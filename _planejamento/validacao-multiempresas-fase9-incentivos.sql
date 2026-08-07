BEGIN READ ONLY;

WITH tabelas AS (
    SELECT *
      FROM (
          VALUES
              ('banco_pontos_saldo'),
              ('banco_pontos_log'),
              ('pontos_extras'),
              ('configuracoes_pontos_processos'),
              ('metas_versoes'),
              ('metas_regras'),
              ('gincanas'),
              ('gincanas_premiacoes'),
              ('gincanas_premios_ganhos')
      ) AS lista(tabela)
),
linhas_sem_empresa AS (
    SELECT tabela, CASE tabela
        WHEN 'banco_pontos_saldo' THEN (SELECT COUNT(*) FROM banco_pontos_saldo WHERE empresa_id IS NULL)
        WHEN 'banco_pontos_log' THEN (SELECT COUNT(*) FROM banco_pontos_log WHERE empresa_id IS NULL)
        WHEN 'pontos_extras' THEN (SELECT COUNT(*) FROM pontos_extras WHERE empresa_id IS NULL)
        WHEN 'configuracoes_pontos_processos' THEN (SELECT COUNT(*) FROM configuracoes_pontos_processos WHERE empresa_id IS NULL)
        WHEN 'metas_versoes' THEN (SELECT COUNT(*) FROM metas_versoes WHERE empresa_id IS NULL)
        WHEN 'metas_regras' THEN (SELECT COUNT(*) FROM metas_regras WHERE empresa_id IS NULL)
        WHEN 'gincanas' THEN (SELECT COUNT(*) FROM gincanas WHERE empresa_id IS NULL)
        WHEN 'gincanas_premiacoes' THEN (SELECT COUNT(*) FROM gincanas_premiacoes WHERE empresa_id IS NULL)
        WHEN 'gincanas_premios_ganhos' THEN (SELECT COUNT(*) FROM gincanas_premios_ganhos WHERE empresa_id IS NULL)
    END AS quantidade
      FROM tabelas
),
estrutura AS (
    SELECT
        (SELECT COUNT(*) = 9
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN (SELECT tabela FROM tabelas)
            AND column_name = 'empresa_id'
            AND is_nullable = 'NO') AS empresa_id_obrigatorio,
        (SELECT COUNT(*) = 18
           FROM pg_constraint
          WHERE conname IN (
              'fk_banco_saldo_empresa',
              'fk_banco_saldo_usuario_empresa',
              'fk_banco_log_empresa',
              'fk_banco_log_usuario_empresa',
              'fk_pontos_extras_empresa',
              'fk_pontos_extras_func_empresa',
              'fk_config_pontos_empresa',
              'fk_config_pontos_produto_empresa',
              'fk_metas_versoes_empresa',
              'fk_metas_regras_empresa',
              'fk_metas_regras_versao_empresa',
              'fk_gincanas_empresa',
              'fk_gincanas_produto_empresa',
              'fk_gincanas_prem_empresa',
              'fk_gincanas_prem_pai_empresa',
              'fk_gincanas_ganhos_empresa',
              'fk_gincanas_ganhos_pai_empresa',
              'fk_gincanas_ganhos_usuario_empresa'
          )
            AND convalidated) AS constraints_validadas,
        NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conname IN (
                 'banco_pontos_saldo_usuario_id_key',
                 'uq_config_pontos_prod_id_proc_tipo'
             )
        ) AS unicidades_globais_ausentes,
        (
            SELECT COALESCE(jsonb_object_agg(tabela, quantidade ORDER BY tabela), '{}'::jsonb)
              FROM linhas_sem_empresa
        ) AS linhas_sem_empresa,
        (
            SELECT COUNT(*)
              FROM pontos_extras pe
             WHERE NOT EXISTS (
                 SELECT 1
                   FROM usuarios_empresas ue
                  WHERE ue.usuario_id = pe.funcionario_id
                    AND ue.empresa_id = pe.empresa_id
             )
        ) AS funcionarios_fora_da_empresa,
        (
            SELECT COUNT(*)
              FROM gincanas g
             WHERE g.produto_id IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1
                     FROM produtos p
                    WHERE p.id = g.produto_id
                      AND p.empresa_id = g.empresa_id
               )
        ) + (
            SELECT COUNT(*)
              FROM configuracoes_pontos_processos cpp
             WHERE NOT EXISTS (
                 SELECT 1
                   FROM produtos p
                  WHERE p.id = cpp.produto_id
                    AND p.empresa_id = cpp.empresa_id
             )
        ) AS produtos_fora_da_empresa
),
empresas_ativas AS (
    SELECT
        e.id,
        e.codigo,
        COALESCE(em.habilitado, FALSE) AS habilitado
    FROM empresas e
    LEFT JOIN empresas_modulos em
      ON em.empresa_id = e.id
     AND em.modulo_codigo = 'incentivos'
    WHERE e.ativa
),
resultado AS (
    SELECT jsonb_build_object(
        'migration_registrada', EXISTS (
            SELECT 1
              FROM sistema_migrations
             WHERE id = 'multiempresas-fase9-incentivos-v1'
        ),
        'modulo_pronto', COALESCE((
            SELECT multiempresa_pronto
              FROM modulos_sistema
             WHERE codigo = 'incentivos'
        ), FALSE),
        'estrutura', (SELECT to_jsonb(estrutura) FROM estrutura),
        'empresas_ativas', COALESCE((
            SELECT jsonb_agg(to_jsonb(empresas_ativas) ORDER BY codigo)
              FROM empresas_ativas
        ), '[]'::jsonb),
        'empresas_pendentes', (
            SELECT COUNT(*)
              FROM empresas_ativas
             WHERE habilitado IS DISTINCT FROM TRUE
        ),
        'aprovado',
            EXISTS (
                SELECT 1
                  FROM sistema_migrations
                 WHERE id = 'multiempresas-fase9-incentivos-v1'
            )
            AND COALESCE((
                SELECT multiempresa_pronto
                  FROM modulos_sistema
                 WHERE codigo = 'incentivos'
            ), FALSE)
            AND (SELECT empresa_id_obrigatorio FROM estrutura)
            AND (SELECT constraints_validadas FROM estrutura)
            AND (SELECT unicidades_globais_ausentes FROM estrutura)
            AND (SELECT COALESCE(SUM(quantidade), 0) = 0 FROM linhas_sem_empresa)
            AND (SELECT funcionarios_fora_da_empresa = 0 FROM estrutura)
            AND (SELECT produtos_fora_da_empresa = 0 FROM estrutura)
            AND NOT EXISTS (
                SELECT 1
                  FROM empresas_ativas
                 WHERE habilitado IS DISTINCT FROM TRUE
            )
    ) AS dados
)
SELECT dados
  FROM resultado;

COMMIT;
