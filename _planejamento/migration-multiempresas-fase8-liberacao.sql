BEGIN;

SELECT pg_advisory_xact_lock(hashtextextended('multiempresas-fase8-liberacao-v1', 0));

DO $$
DECLARE
    marcadores_ausentes INTEGER;
    modulos_ausentes INTEGER;
BEGIN
    SELECT COUNT(*)
      INTO marcadores_ausentes
      FROM (
          VALUES
              ('multiempresas-fase8-alertas-v1'),
              ('multiempresas-fase8-arremates-v1'),
              ('multiempresas-fase8-embalagem-v1'),
              ('multiempresas-fase8-estoque-v1'),
              ('multiempresas-fase8-finalizacao-chaves-empresariais-v1'),
              ('multiempresas-fase8-op-cortes-v1'),
              ('multiempresas-fase8-producao-v1'),
              ('multiempresas-fase8-produtos-demandas-v1'),
              ('multiempresas-fase8-promessas-v1'),
              ('multiempresas-fase8-transversais-v1')
      ) AS requeridos(id)
      LEFT JOIN sistema_migrations sm ON sm.id = requeridos.id
     WHERE sm.id IS NULL;

    IF marcadores_ausentes > 0 THEN
        RAISE EXCEPTION 'A Fase 8 nao possui todos os marcadores estruturais obrigatorios.';
    END IF;

    SELECT COUNT(*)
      INTO modulos_ausentes
      FROM (
          VALUES
              ('alertas'),
              ('arremates'),
              ('cortes'),
              ('dashboard'),
              ('embalagem'),
              ('estoque'),
              ('gerenciar-producao'),
              ('inventario'),
              ('ordens-producao'),
              ('producao-geral'),
              ('produtos')
      ) AS requeridos(codigo)
      LEFT JOIN modulos_sistema ms ON ms.codigo = requeridos.codigo
     WHERE ms.codigo IS NULL;

    IF modulos_ausentes > 0 THEN
        RAISE EXCEPTION 'O catalogo de modulos nao possui todos os modulos da Fase 8.';
    END IF;
END
$$;

UPDATE modulos_sistema
   SET multiempresa_pronto = TRUE,
       atualizado_em = NOW()
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
 ]::varchar[]);

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
  ON ms.codigo = ANY (ARRAY[
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
    'multiempresas-fase8-liberacao-v1',
    'Liberacao da cadeia produtiva da Fase 8 para empresas ativas',
    jsonb_build_object(
        'modulos', ARRAY[
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
        ],
        'empresas_ativas_liberadas', (
            SELECT COUNT(*) FROM empresas WHERE ativa
        )
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
           AND multiempresa_pronto = FALSE
    ) OR EXISTS (
        SELECT 1
          FROM empresas e
          JOIN modulos_sistema ms
            ON ms.codigo = ANY (ARRAY[
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
          LEFT JOIN empresas_modulos em
            ON em.empresa_id = e.id
           AND em.modulo_codigo = ms.codigo
         WHERE e.ativa
           AND (em.habilitado IS DISTINCT FROM TRUE)
    ) THEN
        RAISE EXCEPTION 'A liberacao da Fase 8 ficou inconsistente para algum modulo ou empresa ativa.';
    END IF;
END
$$;

COMMIT;
