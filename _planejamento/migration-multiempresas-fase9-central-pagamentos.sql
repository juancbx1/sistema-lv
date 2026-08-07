BEGIN;

SELECT pg_advisory_xact_lock(hashtextextended('multiempresas-fase9-central-pagamentos-v1', 0));

DO $$
DECLARE
    tabelas_existentes INTEGER;
    linhas_sem_empresa BIGINT;
    usuarios_fora_da_empresa BIGINT;
    contas_fora_da_empresa BIGINT;
    constraints_estruturais INTEGER;
    unicidade_empresarial INTEGER;
    modulo_existe INTEGER;
BEGIN
    SELECT COUNT(*)
      INTO tabelas_existentes
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY (ARRAY[
           'historico_pagamentos_funcionarios',
           'registro_dias_trabalhados',
           'recibos_conferencia'
       ]::text[]);

    IF tabelas_existentes <> 3 THEN
        RAISE EXCEPTION 'As tabelas estruturais da Central de Pagamentos nao existem em quantidade suficiente.';
    END IF;

    SELECT COALESCE(SUM(qtd), 0)
      INTO linhas_sem_empresa
      FROM (
          SELECT COUNT(*) AS qtd FROM historico_pagamentos_funcionarios WHERE empresa_id IS NULL
          UNION ALL SELECT COUNT(*) FROM registro_dias_trabalhados WHERE empresa_id IS NULL
          UNION ALL SELECT COUNT(*) FROM recibos_conferencia WHERE empresa_id IS NULL
      ) AS nulos;

    IF linhas_sem_empresa > 0 THEN
        RAISE EXCEPTION 'Existem % registros da Central de Pagamentos sem empresa_id.', linhas_sem_empresa;
    END IF;

    SELECT COUNT(*)
      INTO usuarios_fora_da_empresa
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
      ) AS cruzamentos;

    IF usuarios_fora_da_empresa > 0 THEN
        RAISE EXCEPTION 'Existem % registros da Central de Pagamentos com usuario fora da empresa.', usuarios_fora_da_empresa;
    END IF;

    SELECT COUNT(*)
      INTO contas_fora_da_empresa
      FROM historico_pagamentos_funcionarios h
     WHERE h.id_conta_debito IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM fc_contas_bancarias c
            WHERE c.id = h.id_conta_debito
              AND c.empresa_id = h.empresa_id
       );

    IF contas_fora_da_empresa > 0 THEN
        RAISE EXCEPTION 'Existem % pagamentos com conta bancaria fora da empresa.', contas_fora_da_empresa;
    END IF;

    SELECT COUNT(*)
      INTO constraints_estruturais
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
     );

    IF constraints_estruturais <> 8 THEN
        RAISE EXCEPTION 'As constraints estruturais da Central de Pagamentos nao estao completas.';
    END IF;

    SELECT COUNT(*)
      INTO unicidade_empresarial
      FROM pg_constraint
     WHERE conname = 'uq_registro_empresa_usuario_data'
       AND contype = 'u';

    IF unicidade_empresarial <> 1 THEN
        RAISE EXCEPTION 'A unicidade empresarial do registro de dias trabalhados nao existe.';
    END IF;

    SELECT COUNT(*)
      INTO modulo_existe
      FROM modulos_sistema
     WHERE codigo = 'central-pagamentos';

    IF modulo_existe <> 1 THEN
        RAISE EXCEPTION 'O modulo central-pagamentos nao existe de forma unica.';
    END IF;
END
$$;

ALTER TABLE historico_pagamentos_funcionarios
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE registro_dias_trabalhados
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE recibos_conferencia
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE registro_dias_trabalhados
    DROP CONSTRAINT IF EXISTS uq_usuario_data_registro;

ALTER TABLE historico_pagamentos_funcionarios
    VALIDATE CONSTRAINT fk_hist_pag_conta_empresa,
    VALIDATE CONSTRAINT fk_hist_pag_empresa,
    VALIDATE CONSTRAINT fk_hist_pag_usuario_empresa;

ALTER TABLE registro_dias_trabalhados
    VALIDATE CONSTRAINT fk_registro_dias_empresa,
    VALIDATE CONSTRAINT fk_registro_dias_pag_empresa,
    VALIDATE CONSTRAINT fk_registro_dias_usuario_empresa;

ALTER TABLE recibos_conferencia
    VALIDATE CONSTRAINT fk_recibos_empresa,
    VALIDATE CONSTRAINT fk_recibos_usuario_empresa;

UPDATE modulos_sistema
   SET multiempresa_pronto = TRUE,
       atualizado_em = NOW()
 WHERE codigo = 'central-pagamentos';

INSERT INTO empresas_modulos (
    empresa_id,
    modulo_codigo,
    habilitado,
    habilitado_em,
    atualizado_em
)
SELECT
    e.id,
    ms.codigo,
    TRUE,
    NOW(),
    NOW()
FROM empresas e
JOIN modulos_sistema ms
  ON ms.codigo = 'central-pagamentos'
WHERE e.ativa
ON CONFLICT (empresa_id, modulo_codigo) DO UPDATE
SET habilitado = TRUE,
    habilitado_em = CASE
        WHEN empresas_modulos.habilitado THEN empresas_modulos.habilitado_em
        ELSE NOW()
    END,
    atualizado_em = NOW();

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'multiempresas-fase9-central-pagamentos-v1',
    'Finalizacao estrutural e liberacao da Central de Pagamentos para empresas ativas',
    jsonb_build_object(
        'modulo', 'central-pagamentos',
        'tabelas', ARRAY[
            'historico_pagamentos_funcionarios',
            'registro_dias_trabalhados',
            'recibos_conferencia'
        ],
        'unicidade_global_removida', 'uq_usuario_data_registro',
        'empresas_ativas_liberadas', (
            SELECT COUNT(*) FROM empresas WHERE ativa
        ),
        'novas_empresas_recebem_modulo_pronto', TRUE
    )
)
ON CONFLICT (id) DO UPDATE
SET descricao = EXCLUDED.descricao,
    detalhes = EXCLUDED.detalhes,
    executada_em = NOW();

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM modulos_sistema
         WHERE codigo = 'central-pagamentos'
           AND multiempresa_pronto IS DISTINCT FROM TRUE
    ) OR EXISTS (
        SELECT 1
          FROM empresas e
          LEFT JOIN empresas_modulos em
            ON em.empresa_id = e.id
           AND em.modulo_codigo = 'central-pagamentos'
         WHERE e.ativa
           AND em.habilitado IS DISTINCT FROM TRUE
    ) THEN
        RAISE EXCEPTION 'A liberacao da Central de Pagamentos ficou inconsistente para algum modulo ou empresa ativa.';
    END IF;
END
$$;

COMMIT;
