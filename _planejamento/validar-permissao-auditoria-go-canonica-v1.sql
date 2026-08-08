BEGIN READ ONLY;

-- Read-only validation of the Organizational Management audit permission ID.
-- approved=true means no record has only one of the two identifiers during
-- the compatibility window.

WITH fontes AS (
    SELECT 'usuarios'::text AS fonte, id::text AS registro_id,
           COALESCE(permissoes, '{}'::text[]) AS permissoes
      FROM usuarios
    UNION ALL
    SELECT 'usuarios_empresas', id::text,
           COALESCE(permissoes, '{}'::text[])
      FROM usuarios_empresas
    UNION ALL
    SELECT 'usuarios_acessos_globais', usuario_id::text,
           COALESCE(permissoes, '{}'::text[])
      FROM usuarios_acessos_globais
), classificacao AS (
    SELECT *,
           'acesso-permissoes-usuarios' = ANY(permissoes) AS possui_legado,
           'acesso-auditoria-gestao-organizacional' = ANY(permissoes) AS possui_canonico
      FROM fontes
)
SELECT jsonb_build_object(
    'aprovado', COUNT(*) FILTER (
        WHERE (possui_legado OR possui_canonico)
          AND NOT (possui_legado AND possui_canonico)
    ) = 0,
    'linhas_com_algum_identificador', COUNT(*) FILTER (WHERE possui_legado OR possui_canonico),
    'linhas_com_ambos', COUNT(*) FILTER (WHERE possui_legado AND possui_canonico),
    'somente_legado', COUNT(*) FILTER (WHERE possui_legado AND NOT possui_canonico),
    'somente_canonico', COUNT(*) FILTER (WHERE possui_canonico AND NOT possui_legado),
    'fontes_consultadas', jsonb_agg(DISTINCT fonte ORDER BY fonte)
) AS resultado
FROM classificacao;

-- Para diagnosticar qualquer falha sem alterar dados:
WITH fontes AS (
    SELECT 'usuarios'::text AS fonte, id::text AS registro_id,
           COALESCE(permissoes, '{}'::text[]) AS permissoes
      FROM usuarios
    UNION ALL
    SELECT 'usuarios_empresas', id::text,
           COALESCE(permissoes, '{}'::text[])
      FROM usuarios_empresas
    UNION ALL
    SELECT 'usuarios_acessos_globais', usuario_id::text,
           COALESCE(permissoes, '{}'::text[])
      FROM usuarios_acessos_globais
), classificacao AS (
    SELECT *,
           'acesso-permissoes-usuarios' = ANY(permissoes) AS possui_legado,
           'acesso-auditoria-gestao-organizacional' = ANY(permissoes) AS possui_canonico
      FROM fontes
)
SELECT fonte, registro_id,
       possui_legado,
       possui_canonico
  FROM classificacao
 WHERE (possui_legado OR possui_canonico)
   AND NOT (possui_legado AND possui_canonico)
 ORDER BY fonte, registro_id;

ROLLBACK;
