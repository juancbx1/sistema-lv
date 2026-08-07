BEGIN;

SELECT pg_advisory_xact_lock(hashtextextended('multiempresas-fase9-incentivos-v1', 0));

DO $$
DECLARE
    tabela_existe BOOLEAN;
    linhas_sem_empresa BIGINT;
    produtos_cruzados BIGINT;
    vinculos_cruzados BIGINT;
    modulo_existe INTEGER;
BEGIN
    SELECT COUNT(*) = 9
      INTO tabela_existe
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY (ARRAY[
           'banco_pontos_saldo',
           'banco_pontos_log',
           'pontos_extras',
           'configuracoes_pontos_processos',
           'metas_versoes',
           'metas_regras',
           'gincanas',
           'gincanas_premiacoes',
           'gincanas_premios_ganhos'
       ]::text[]);

    IF NOT tabela_existe THEN
        RAISE EXCEPTION 'As tabelas estruturais do Incentivos nao existem em quantidade suficiente.';
    END IF;

    SELECT COALESCE(SUM(qtd), 0)
      INTO linhas_sem_empresa
      FROM (
          SELECT COUNT(*) AS qtd FROM banco_pontos_saldo WHERE empresa_id IS NULL
          UNION ALL SELECT COUNT(*) FROM banco_pontos_log WHERE empresa_id IS NULL
          UNION ALL SELECT COUNT(*) FROM pontos_extras WHERE empresa_id IS NULL
          UNION ALL SELECT COUNT(*) FROM configuracoes_pontos_processos WHERE empresa_id IS NULL
          UNION ALL SELECT COUNT(*) FROM metas_versoes WHERE empresa_id IS NULL
          UNION ALL SELECT COUNT(*) FROM metas_regras WHERE empresa_id IS NULL
          UNION ALL SELECT COUNT(*) FROM gincanas WHERE empresa_id IS NULL
          UNION ALL SELECT COUNT(*) FROM gincanas_premiacoes WHERE empresa_id IS NULL
          UNION ALL SELECT COUNT(*) FROM gincanas_premios_ganhos WHERE empresa_id IS NULL
      ) AS nulos;

    IF linhas_sem_empresa > 0 THEN
        RAISE EXCEPTION 'Existem % registros do Incentivos sem empresa_id.', linhas_sem_empresa;
    END IF;

    SELECT COUNT(*)
      INTO vinculos_cruzados
      FROM (
          SELECT pe.id
            FROM pontos_extras pe
           WHERE NOT EXISTS (
               SELECT 1
                 FROM usuarios_empresas ue
                WHERE ue.usuario_id = pe.funcionario_id
                  AND ue.empresa_id = pe.empresa_id
           )
          UNION ALL
          SELECT bpl.id
            FROM banco_pontos_log bpl
           WHERE bpl.usuario_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1
                 FROM usuarios_empresas ue
                WHERE ue.usuario_id = bpl.usuario_id
                  AND ue.empresa_id = bpl.empresa_id
           )
          UNION ALL
          SELECT bps.id
            FROM banco_pontos_saldo bps
           WHERE bps.usuario_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1
                 FROM usuarios_empresas ue
                WHERE ue.usuario_id = bps.usuario_id
                  AND ue.empresa_id = bps.empresa_id
           )
          UNION ALL
          SELECT gpg.id
            FROM gincanas_premios_ganhos gpg
           WHERE NOT EXISTS (
               SELECT 1
                 FROM usuarios_empresas ue
                WHERE ue.usuario_id = gpg.usuario_id
                  AND ue.empresa_id = gpg.empresa_id
           )
      ) AS cruzamentos;

    IF vinculos_cruzados > 0 THEN
        RAISE EXCEPTION 'Existem % registros do Incentivos com usuario fora da empresa.', vinculos_cruzados;
    END IF;

    SELECT COUNT(*)
      INTO produtos_cruzados
      FROM (
          SELECT g.id
            FROM gincanas g
           WHERE g.produto_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1
                 FROM produtos p
                WHERE p.id = g.produto_id
                  AND p.empresa_id = g.empresa_id
           )
          UNION ALL
          SELECT cpp.id
            FROM configuracoes_pontos_processos cpp
           WHERE NOT EXISTS (
               SELECT 1
                 FROM produtos p
                WHERE p.id = cpp.produto_id
                  AND p.empresa_id = cpp.empresa_id
           )
      ) AS cruzamentos;

    IF produtos_cruzados > 0 THEN
        RAISE EXCEPTION 'Existem % registros do Incentivos com produto fora da empresa.', produtos_cruzados;
    END IF;

    SELECT COUNT(*)
      INTO modulo_existe
      FROM modulos_sistema
     WHERE codigo = 'incentivos';

    IF modulo_existe <> 1 THEN
        RAISE EXCEPTION 'O modulo incentivos nao existe de forma unica.';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'fk_gincanas_produto_empresa'
    ) THEN
        ALTER TABLE gincanas
            ADD CONSTRAINT fk_gincanas_produto_empresa
            FOREIGN KEY (empresa_id, produto_id)
            REFERENCES produtos(empresa_id, id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'fk_config_pontos_produto_empresa'
    ) THEN
        ALTER TABLE configuracoes_pontos_processos
            ADD CONSTRAINT fk_config_pontos_produto_empresa
            FOREIGN KEY (empresa_id, produto_id)
            REFERENCES produtos(empresa_id, id)
            NOT VALID;
    END IF;
END
$$;

ALTER TABLE banco_pontos_saldo
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE banco_pontos_log
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE pontos_extras
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE configuracoes_pontos_processos
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE metas_versoes
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE metas_regras
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE gincanas
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE gincanas_premiacoes
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE gincanas_premios_ganhos
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE banco_pontos_saldo
    DROP CONSTRAINT IF EXISTS banco_pontos_saldo_usuario_id_key;

ALTER TABLE configuracoes_pontos_processos
    DROP CONSTRAINT IF EXISTS uq_config_pontos_prod_id_proc_tipo;

ALTER TABLE banco_pontos_saldo
    VALIDATE CONSTRAINT fk_banco_saldo_empresa,
    VALIDATE CONSTRAINT fk_banco_saldo_usuario_empresa;

ALTER TABLE banco_pontos_log
    VALIDATE CONSTRAINT fk_banco_log_empresa,
    VALIDATE CONSTRAINT fk_banco_log_usuario_empresa;

ALTER TABLE pontos_extras
    VALIDATE CONSTRAINT fk_pontos_extras_empresa,
    VALIDATE CONSTRAINT fk_pontos_extras_func_empresa;

ALTER TABLE configuracoes_pontos_processos
    VALIDATE CONSTRAINT fk_config_pontos_empresa,
    VALIDATE CONSTRAINT fk_config_pontos_produto_empresa;

ALTER TABLE metas_versoes
    VALIDATE CONSTRAINT fk_metas_versoes_empresa;

ALTER TABLE metas_regras
    VALIDATE CONSTRAINT fk_metas_regras_empresa,
    VALIDATE CONSTRAINT fk_metas_regras_versao_empresa;

ALTER TABLE gincanas
    VALIDATE CONSTRAINT fk_gincanas_empresa,
    VALIDATE CONSTRAINT fk_gincanas_produto_empresa;

ALTER TABLE gincanas_premiacoes
    VALIDATE CONSTRAINT fk_gincanas_prem_empresa,
    VALIDATE CONSTRAINT fk_gincanas_prem_pai_empresa;

ALTER TABLE gincanas_premios_ganhos
    VALIDATE CONSTRAINT fk_gincanas_ganhos_empresa,
    VALIDATE CONSTRAINT fk_gincanas_ganhos_pai_empresa,
    VALIDATE CONSTRAINT fk_gincanas_ganhos_usuario_empresa;

UPDATE modulos_sistema
   SET multiempresa_pronto = TRUE,
       atualizado_em = NOW()
 WHERE codigo = 'incentivos';

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
  ON ms.codigo = 'incentivos'
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
    'multiempresas-fase9-incentivos-v1',
    'Finalizacao estrutural e liberacao do Incentivos para empresas ativas',
    jsonb_build_object(
        'modulo', 'incentivos',
        'tabelas', ARRAY[
            'banco_pontos_saldo',
            'banco_pontos_log',
            'pontos_extras',
            'configuracoes_pontos_processos',
            'metas_versoes',
            'metas_regras',
            'gincanas',
            'gincanas_premiacoes',
            'gincanas_premios_ganhos'
        ],
        'unicidades_globais_removidas', ARRAY[
            'banco_pontos_saldo_usuario_id_key',
            'uq_config_pontos_prod_id_proc_tipo'
        ],
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
         WHERE codigo = 'incentivos'
           AND multiempresa_pronto IS DISTINCT FROM TRUE
    ) OR EXISTS (
        SELECT 1
          FROM empresas e
          LEFT JOIN empresas_modulos em
            ON em.empresa_id = e.id
           AND em.modulo_codigo = 'incentivos'
         WHERE e.ativa
           AND em.habilitado IS DISTINCT FROM TRUE
    ) THEN
        RAISE EXCEPTION 'A liberacao do Incentivos ficou inconsistente para algum modulo ou empresa ativa.';
    END IF;
END
$$;

COMMIT;
