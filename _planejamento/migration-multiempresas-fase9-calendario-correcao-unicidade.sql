BEGIN;

SELECT pg_advisory_xact_lock(hashtextextended('multiempresas-fase9-calendario-correcao-unicidade-v1', 0));

DO $$
DECLARE
    duplicidades BIGINT;
BEGIN
    SELECT COUNT(*)
      INTO duplicidades
      FROM (
          SELECT empresa_id, data, tipo, COALESCE(funcionario_id, -1) AS funcionario_chave
            FROM calendario_empresa
           GROUP BY empresa_id, data, tipo, COALESCE(funcionario_id, -1)
          HAVING COUNT(*) > 1
      ) conflitos;

    IF duplicidades > 0 THEN
        RAISE EXCEPTION 'Existem % grupos duplicados dentro da mesma empresa no Calendario.', duplicidades;
    END IF;
END
$$;

DROP INDEX IF EXISTS public.idx_calendario_unique;
DROP INDEX IF EXISTS public.idx_calendario_empresa_unique;

CREATE UNIQUE INDEX idx_calendario_empresa_unique
    ON public.calendario_empresa (
        empresa_id,
        data,
        tipo,
        COALESCE(funcionario_id, -1)
    );

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'multiempresas-fase9-calendario-correcao-unicidade-v1',
    'Corrige a unicidade empresarial do Calendario',
    jsonb_build_object(
        'indice_removido', 'idx_calendario_unique',
        'indice_criado', 'idx_calendario_empresa_unique',
        'chave', ARRAY['empresa_id', 'data', 'tipo', 'funcionario_id']
    )
)
ON CONFLICT (id) DO UPDATE
SET descricao = EXCLUDED.descricao,
    detalhes = EXCLUDED.detalhes,
    executada_em = NOW();

DO $$
BEGIN
    IF to_regclass('public.idx_calendario_unique') IS NOT NULL
       OR to_regclass('public.idx_calendario_empresa_unique') IS NULL
       OR NOT EXISTS (
           SELECT 1
             FROM pg_class indice
             JOIN pg_index definicao ON definicao.indexrelid = indice.oid
            WHERE indice.oid = 'public.idx_calendario_empresa_unique'::regclass
              AND definicao.indisunique
       ) THEN
        RAISE EXCEPTION 'A unicidade empresarial do Calendario ficou inconsistente.';
    END IF;
END
$$;

COMMIT;
