-- Additive migration of the Organizational Management audit permission ID.
--
-- The application already accepts both identifiers. This migration only makes
-- every row that has one of them contain both, allowing deployment, backfill
-- and eventual alias removal in separate stages.
-- Rehearse on a local restore before executing in production.

BEGIN;

UPDATE usuarios
   SET permissoes = ARRAY(
       SELECT DISTINCT permissao
         FROM unnest(
             COALESCE(permissoes, '{}'::text[])
             || ARRAY[
                 'acesso-auditoria-gestao-organizacional',
                 'acesso-permissoes-usuarios'
             ]::text[]
         ) AS itens(permissao)
   )
 WHERE COALESCE(permissoes, '{}'::text[])
       && ARRAY[
           'acesso-auditoria-gestao-organizacional',
           'acesso-permissoes-usuarios'
       ]::text[];

UPDATE usuarios_empresas
   SET permissoes = ARRAY(
       SELECT DISTINCT permissao
         FROM unnest(
             COALESCE(permissoes, '{}'::text[])
             || ARRAY[
                 'acesso-auditoria-gestao-organizacional',
                 'acesso-permissoes-usuarios'
             ]::text[]
         ) AS itens(permissao)
   )
 WHERE COALESCE(permissoes, '{}'::text[])
       && ARRAY[
           'acesso-auditoria-gestao-organizacional',
           'acesso-permissoes-usuarios'
       ]::text[];

UPDATE usuarios_acessos_globais
   SET permissoes = ARRAY(
       SELECT DISTINCT permissao
         FROM unnest(
             COALESCE(permissoes, '{}'::text[])
             || ARRAY[
                 'acesso-auditoria-gestao-organizacional',
                 'acesso-permissoes-usuarios'
             ]::text[]
         ) AS itens(permissao)
   )
 WHERE COALESCE(permissoes, '{}'::text[])
       && ARRAY[
           'acesso-auditoria-gestao-organizacional',
           'acesso-permissoes-usuarios'
       ]::text[];

DO $$
DECLARE
    somente_legado INTEGER;
    somente_canonico INTEGER;
BEGIN
    WITH fontes AS (
        SELECT COALESCE(permissoes, '{}'::text[]) AS permissoes FROM usuarios
        UNION ALL
        SELECT COALESCE(permissoes, '{}'::text[]) FROM usuarios_empresas
        UNION ALL
        SELECT COALESCE(permissoes, '{}'::text[]) FROM usuarios_acessos_globais
    )
    SELECT
        COUNT(*) FILTER (
            WHERE 'acesso-permissoes-usuarios' = ANY(permissoes)
              AND NOT ('acesso-auditoria-gestao-organizacional' = ANY(permissoes))
        ),
        COUNT(*) FILTER (
            WHERE 'acesso-auditoria-gestao-organizacional' = ANY(permissoes)
              AND NOT ('acesso-permissoes-usuarios' = ANY(permissoes))
        )
      INTO somente_legado, somente_canonico
      FROM fontes;

    IF somente_legado > 0 OR somente_canonico > 0 THEN
        RAISE EXCEPTION
            'Migration interrupted: % rows contain only the legacy alias and % only the canonical identifier.',
            somente_legado,
            somente_canonico;
    END IF;

    INSERT INTO sistema_migrations (id, descricao, detalhes)
    VALUES (
        'permissoes-auditoria-go-canonica-v1',
        'Keeps the canonical and legacy identifiers for Organizational Management audit during transition',
        jsonb_build_object(
            'canonico', 'acesso-auditoria-gestao-organizacional',
            'legado', 'acesso-permissoes-usuarios',
            'estrategia', 'dual-read-dual-write',
            'validacao', 'nenhuma linha com apenas um dos dois identificadores'
        )
    )
    ON CONFLICT (id) DO UPDATE
        SET descricao = EXCLUDED.descricao,
            detalhes = EXCLUDED.detalhes;
END
$$;

COMMIT;
