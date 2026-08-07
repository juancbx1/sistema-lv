BEGIN READ ONLY;

WITH estrutura AS (
    SELECT
        COALESCE((
            SELECT is_nullable = 'NO'
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'calendario_empresa'
               AND column_name = 'empresa_id'
        ), FALSE) AS empresa_id_obrigatorio,
        COALESCE((
            SELECT COUNT(*) = 2
              FROM pg_constraint
             WHERE conname IN ('fk_calendario_empresa', 'fk_calendario_func_empresa')
               AND convalidated
        ), FALSE) AS constraints_validadas,
        COALESCE((
            SELECT COUNT(*)
              FROM calendario_empresa
             WHERE empresa_id IS NULL
        ), 0) AS linhas_sem_empresa,
        COALESCE((
            SELECT COUNT(*)
              FROM calendario_empresa c
             WHERE c.funcionario_id IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1
                     FROM usuarios_empresas ue
                    WHERE ue.usuario_id = c.funcionario_id
                      AND ue.empresa_id = c.empresa_id
               )
        ), 0) AS funcionarios_fora_da_empresa,
        NOT EXISTS (
            SELECT 1
              FROM pg_indexes
             WHERE schemaname = 'public'
               AND tablename = 'calendario_empresa'
               AND indexname = 'idx_calendario_unique'
        ) AS indice_global_ausente,
        EXISTS (
            SELECT 1
              FROM pg_class indice
              JOIN pg_index definicao ON definicao.indexrelid = indice.oid
             WHERE indice.oid = to_regclass('public.idx_calendario_empresa_unique')
               AND definicao.indisunique
        ) AS indice_empresarial_presente
),
empresas_ativas AS (
    SELECT
        e.id,
        e.codigo,
        COALESCE(em.habilitado, FALSE) AS habilitado
    FROM empresas e
    LEFT JOIN empresas_modulos em
      ON em.empresa_id = e.id
     AND em.modulo_codigo = 'calendario'
    WHERE e.ativa
), resultado AS (
    SELECT jsonb_build_object(
        'migration_registrada', EXISTS (
            SELECT 1
              FROM sistema_migrations
             WHERE id = 'multiempresas-fase9-calendario-v1'
        ),
        'correcao_unicidade_registrada', EXISTS (
            SELECT 1
              FROM sistema_migrations
             WHERE id = 'multiempresas-fase9-calendario-correcao-unicidade-v1'
        ),
        'modulo_pronto', COALESCE((
            SELECT multiempresa_pronto
              FROM modulos_sistema
             WHERE codigo = 'calendario'
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
                 WHERE id = 'multiempresas-fase9-calendario-v1'
            )
            AND EXISTS (
                SELECT 1
                  FROM sistema_migrations
                 WHERE id = 'multiempresas-fase9-calendario-correcao-unicidade-v1'
            )
            AND COALESCE((
                SELECT multiempresa_pronto
                  FROM modulos_sistema
                 WHERE codigo = 'calendario'
            ), FALSE)
            AND (SELECT empresa_id_obrigatorio FROM estrutura)
            AND (SELECT constraints_validadas FROM estrutura)
            AND (SELECT linhas_sem_empresa = 0 FROM estrutura)
            AND (SELECT funcionarios_fora_da_empresa = 0 FROM estrutura)
            AND (SELECT indice_global_ausente FROM estrutura)
            AND (SELECT indice_empresarial_presente FROM estrutura)
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
