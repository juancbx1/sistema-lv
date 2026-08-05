BEGIN;

-- Converte somente os quatro ganhos indevidos identificados para Vera Santos.
-- Os movimentos permanecem no histórico como CORRECAO e o saldo é estornado.
DO $$
DECLARE
    qtd INTEGER;
    total NUMERIC;
    saldo NUMERIC;
BEGIN
    IF EXISTS (
        SELECT 1
          FROM sistema_migrations
         WHERE id = 'banco-resgate-correcao-vera-20260805-v1'
    ) THEN
        RETURN;
    END IF;

    WITH esperados(id, quantidade, data_referencia) AS (
        VALUES
            (190, 4::numeric,  '2026-07-30'::date),
            (196, 69::numeric, '2026-07-28'::date),
            (197, 69::numeric, '2026-07-29'::date),
            (198, 69::numeric, '2026-07-31'::date)
    )
    SELECT COUNT(*)::integer, COALESCE(SUM(l.quantidade), 0)
      INTO qtd, total
      FROM banco_pontos_log l
      JOIN esperados e
        ON e.id = l.id
       AND e.quantidade = l.quantidade
       AND e.data_referencia = l.data_referencia
     WHERE l.empresa_id = 1
       AND l.usuario_id = 21
       AND l.tipo = 'GANHO';

    IF qtd <> 4 THEN
        RAISE EXCEPTION
            'Correção da Vera interrompida: esperados quatro ganhos ativos, encontrados %.',
            qtd;
    END IF;

    IF total <> 211 THEN
        RAISE EXCEPTION
            'Correção da Vera interrompida: esperados 211 pontos, encontrados %.',
            total;
    END IF;

    SELECT saldo_atual
      INTO saldo
      FROM banco_pontos_saldo
     WHERE empresa_id = 1
       AND usuario_id = 21
     FOR UPDATE;

    IF saldo IS NULL OR saldo < total THEN
        RAISE EXCEPTION
            'Correção da Vera interrompida: saldo inválido para estorno (%).',
            saldo;
    END IF;
END
$$;

WITH esperados(id, data_referencia) AS (
    VALUES
        (190, '2026-07-30'::date),
        (196, '2026-07-28'::date),
        (197, '2026-07-29'::date),
        (198, '2026-07-31'::date)
),
corrigidos AS (
    UPDATE banco_pontos_log l
       SET tipo = 'CORRECAO',
           quantidade = ABS(l.quantidade),
           descricao = format(
               'Correção de Bugs: lançamento indevido de %s pontos do dia %s.',
               l.quantidade,
               l.data_referencia
           )
      FROM esperados e
     WHERE l.id = e.id
       AND l.data_referencia = e.data_referencia
       AND l.empresa_id = 1
       AND l.usuario_id = 21
       AND l.tipo = 'GANHO'
     RETURNING l.quantidade
)
UPDATE banco_pontos_saldo
   SET saldo_atual = saldo_atual - COALESCE((SELECT SUM(quantidade) FROM corrigidos), 0),
       ultimo_calculo = NOW()
 WHERE empresa_id = 1
   AND usuario_id = 21
   AND EXISTS (SELECT 1 FROM corrigidos);

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'banco-resgate-correcao-vera-20260805-v1',
    'Converte quatro ganhos indevidos da Vera Santos em correção de saldo',
    jsonb_build_object(
        'empresa_id', 1,
        'usuario_id', 21,
        'log_ids', jsonb_build_array(190, 196, 197, 198),
        'pontos_corrigidos', 211,
        'datas_origem', jsonb_build_array('2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'),
        'motivo', 'Pontos do supervisor foram incluídos no cálculo da sobra; produção real não gerou ganho nesses dias'
    )
)
ON CONFLICT (id) DO UPDATE
    SET descricao = EXCLUDED.descricao,
        detalhes = EXCLUDED.detalhes;

COMMIT;
