BEGIN;

SELECT pg_advisory_xact_lock(hashtextextended('multiempresas-fase9-calendario-v1', 0));

DO $$
DECLARE
    tabela_existe BOOLEAN;
    coluna_existe BOOLEAN;
    linhas_sem_empresa BIGINT;
    modulo_existe INTEGER;
BEGIN
    SELECT EXISTS (
        SELECT 1
          FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'calendario_empresa'
    )
      INTO tabela_existe;

    IF NOT tabela_existe THEN
        RAISE EXCEPTION 'A tabela calendario_empresa nao existe.';
    END IF;

    SELECT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'calendario_empresa'
           AND column_name = 'empresa_id'
    )
      INTO coluna_existe;

    IF NOT coluna_existe THEN
        RAISE EXCEPTION 'A tabela calendario_empresa nao possui empresa_id.';
    END IF;

    SELECT COUNT(*)
      INTO linhas_sem_empresa
      FROM calendario_empresa
     WHERE empresa_id IS NULL;

    IF linhas_sem_empresa > 0 THEN
        RAISE EXCEPTION 'Existem % eventos de calendario sem empresa_id.', linhas_sem_empresa;
    END IF;

    SELECT COUNT(*)
      INTO modulo_existe
      FROM modulos_sistema
     WHERE codigo = 'calendario';

    IF modulo_existe <> 1 THEN
        RAISE EXCEPTION 'O modulo calendario nao existe de forma unica.';
    END IF;
END
$$;

ALTER TABLE calendario_empresa
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE calendario_empresa
    VALIDATE CONSTRAINT fk_calendario_empresa;

ALTER TABLE calendario_empresa
    VALIDATE CONSTRAINT fk_calendario_func_empresa;

UPDATE modulos_sistema
   SET multiempresa_pronto = TRUE,
       atualizado_em = NOW()
 WHERE codigo = 'calendario';

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
  ON ms.codigo = 'calendario'
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
    'multiempresas-fase9-calendario-v1',
    'Liberacao do Calendario para empresas ativas',
    jsonb_build_object(
        'modulos', ARRAY['calendario'],
        'tabela', 'calendario_empresa',
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
         WHERE codigo = 'calendario'
           AND multiempresa_pronto IS DISTINCT FROM TRUE
    ) OR EXISTS (
        SELECT 1
          FROM empresas e
          LEFT JOIN empresas_modulos em
            ON em.empresa_id = e.id
           AND em.modulo_codigo = 'calendario'
         WHERE e.ativa
           AND em.habilitado IS DISTINCT FROM TRUE
    ) THEN
        RAISE EXCEPTION 'A liberacao do Calendario ficou inconsistente para algum modulo ou empresa ativa.';
    END IF;
END
$$;

COMMIT;
