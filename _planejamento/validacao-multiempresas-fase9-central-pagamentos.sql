BEGIN READ ONLY;

WITH tabelas AS (
    SELECT *
      FROM (
          VALUES
              ('historico_pagamentos_funcionarios'),
              ('registro_dias_trabalhados'),
              ('recibos_conferencia')
      ) AS lista(tabela)
),
linhas_sem_empresa AS (
    SELECT tabela, CASE tabela
        WHEN 'historico_pagamentos_funcionarios' THEN (SELECT COUNT(*) FROM historico_pagamentos_funcionarios WHERE empresa_id IS NULL)
        WHEN 'registro_dias_trabalhados' THEN (SELECT COUNT(*) FROM registro_dias_trabalhados WHERE empresa_id IS NULL)
        WHEN 'recibos_conferencia' THEN (SELECT COUNT(*) FROM recibos_conferencia WHERE empresa_id IS NULL)
    END AS quantidade
      FROM tabelas
),
estrutura AS (
    SELECT
        (SELECT COUNT(*) = 3
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN (SELECT tabela FROM tabelas)
            AND column_name = 'empresa_id'
            AND is_nullable = 'NO') AS empresa_id_obrigatorio,
        (SELECT COUNT(*) = 8
           FROM pg_constraint
          WHERE conname IN (
              'fk_hist_pag_conta_empresa',
              'fk_hist_pag_empresa',
              'fk_hist_pag_usuario_empresa',
              'fk_registro_dias_empresa',
              'fk_registro_dias_pag_empresa',
              'fk_registro_dias_usuario_empresa',
              'fk_recibos_empresa',
              'fk_recibos_usuario_empresa'
          )
            AND convalidated) AS constraints_validadas,
        NOT EXISTS (
            SELECT 1
              FROM pg_constraint
             WHERE conname = 'uq_usuario_data_registro'
        ) AND NOT EXISTS (
            SELECT 1
              FROM pg_indexes
             WHERE schemaname = 'public'
               AND indexname = 'uq_usuario_data_registro'
        ) AS unicidade_global_ausente,
        EXISTS (
            SELECT 1
              FROM pg_constraint
             WHERE conname = 'uq_registro_empresa_usuario_data'
               AND contype = 'u'
        ) AS unicidade_empresarial_presente,
        (
            SELECT COALESCE(jsonb_object_agg(tabela, quantidade ORDER BY tabela), '{}'::jsonb)
              FROM linhas_sem_empresa
        ) AS linhas_sem_empresa,
        (
            SELECT COUNT(*)
              FROM (
                  SELECT h.id
                    FROM historico_pagamentos_funcionarios h
                   WHERE h.usuario_id IS NOT NULL
                     AND NOT EXISTS (
                         SELECT 1
                           FROM usuarios_empresas ue
                          WHERE ue.usuario_id = h.usuario_id
                            AND ue.empresa_id = h.empresa_id
                     )
                  UNION ALL
                  SELECT r.id
                    FROM registro_dias_trabalhados r
                   WHERE r.usuario_id IS NOT NULL
                     AND NOT EXISTS (
                         SELECT 1
                           FROM usuarios_empresas ue
                          WHERE ue.usuario_id = r.usuario_id
                            AND ue.empresa_id = r.empresa_id
                     )
                  UNION ALL
                  SELECT rc.id
                    FROM recibos_conferencia rc
                   WHERE rc.usuario_id IS NOT NULL
                     AND NOT EXISTS (
                         SELECT 1
                           FROM usuarios_empresas ue
                          WHERE ue.usuario_id = rc.usuario_id
                            AND ue.empresa_id = rc.empresa_id
                     )
              ) AS cruzamentos
        ) AS usuarios_fora_da_empresa,
        (
            SELECT COUNT(*)
              FROM historico_pagamentos_funcionarios h
             WHERE h.id_conta_debito IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1
                     FROM fc_contas_bancarias c
                    WHERE c.id = h.id_conta_debito
                      AND c.empresa_id = h.empresa_id
               )
        ) AS contas_fora_da_empresa
),
empresas_ativas AS (
    SELECT
        e.id,
        e.codigo,
        COALESCE(em.habilitado, FALSE) AS habilitado
    FROM empresas e
    LEFT JOIN empresas_modulos em
      ON em.empresa_id = e.id
     AND em.modulo_codigo = 'central-pagamentos'
    WHERE e.ativa
),
resultado AS (
    SELECT jsonb_build_object(
        'migration_registrada', EXISTS (
            SELECT 1
              FROM sistema_migrations
             WHERE id = 'multiempresas-fase9-central-pagamentos-v1'
        ),
        'modulo_pronto', COALESCE((
            SELECT multiempresa_pronto
              FROM modulos_sistema
             WHERE codigo = 'central-pagamentos'
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
                 WHERE id = 'multiempresas-fase9-central-pagamentos-v1'
            )
            AND COALESCE((
                SELECT multiempresa_pronto
                  FROM modulos_sistema
                 WHERE codigo = 'central-pagamentos'
            ), FALSE)
            AND (SELECT empresa_id_obrigatorio FROM estrutura)
            AND (SELECT constraints_validadas FROM estrutura)
            AND (SELECT unicidade_global_ausente FROM estrutura)
            AND (SELECT unicidade_empresarial_presente FROM estrutura)
            AND (SELECT COALESCE(SUM(quantidade), 0) = 0 FROM linhas_sem_empresa)
            AND (SELECT usuarios_fora_da_empresa = 0 FROM estrutura)
            AND (SELECT contas_fora_da_empresa = 0 FROM estrutura)
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
