WITH modulos AS (
    SELECT codigo, multiempresa_pronto
      FROM modulos_sistema
     WHERE codigo = ANY (ARRAY[
         'alertas',
         'arremates',
         'cortes',
         'dashboard',
         'embalagem',
         'estoque',
         'gerenciar-producao',
         'inventario',
         'ordens-producao',
         'producao-geral',
         'produtos'
     ]::varchar[])
),
empresas AS (
    SELECT
        e.id,
        e.codigo,
        COUNT(*) FILTER (WHERE ms.multiempresa_pronto)::integer AS modulos_prontos,
        COUNT(*) FILTER (WHERE em.habilitado)::integer AS modulos_habilitados,
        COUNT(*) FILTER (WHERE em.habilitado IS DISTINCT FROM TRUE)::integer AS modulos_pendentes
    FROM empresas e
    CROSS JOIN modulos ms
    LEFT JOIN empresas_modulos em
      ON em.empresa_id = e.id
     AND em.modulo_codigo = ms.codigo
    WHERE e.ativa
    GROUP BY e.id, e.codigo
),
resultado AS (
    SELECT jsonb_build_object(
        'migration_registrada', EXISTS (
            SELECT 1 FROM sistema_migrations WHERE id = 'multiempresas-fase8-liberacao-v1'
        ),
        'modulos_prontos', (SELECT COUNT(*) FROM modulos WHERE multiempresa_pronto),
        'modulos_esperados', 11,
        'empresas_ativas', COALESCE((SELECT jsonb_agg(to_jsonb(empresas) ORDER BY codigo) FROM empresas), '[]'::jsonb),
        'aprovado',
            EXISTS (SELECT 1 FROM sistema_migrations WHERE id = 'multiempresas-fase8-liberacao-v1')
            AND (SELECT COUNT(*) FROM modulos WHERE multiempresa_pronto) = 11
            AND NOT EXISTS (SELECT 1 FROM empresas WHERE modulos_pendentes > 0)
    ) AS dados
)
SELECT dados
  FROM resultado;
