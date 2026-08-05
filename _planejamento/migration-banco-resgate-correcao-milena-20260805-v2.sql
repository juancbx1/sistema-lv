BEGIN;

-- Correção reversível dos cinco ganhos recriados pelo backend antigo em
-- 05/08/2026. Os movimentos permanecem no histórico como CORRECAO.
DO $$
DECLARE
    qtd INTEGER;
    total NUMERIC;
    saldo NUMERIC;
BEGIN
    SELECT COUNT(*)::integer, COALESCE(SUM(quantidade), 0)
      INTO qtd, total
      FROM banco_pontos_log
     WHERE id IN (201, 202, 203, 204, 205)
       AND empresa_id = 1
       AND usuario_id = 9
       AND tipo = 'GANHO';

    IF qtd NOT IN (0, 5) THEN
        RAISE EXCEPTION
            'Correção da Milena interrompida: esperados 5 ganhos ativos, encontrados %.',
            qtd;
    END IF;

    IF qtd = 5 AND total <> 355 THEN
        RAISE EXCEPTION
            'Correção da Milena interrompida: esperados 355 pontos, encontrados %.',
            total;
    END IF;

    IF qtd = 5 THEN
        SELECT saldo_atual
          INTO saldo
          FROM banco_pontos_saldo
         WHERE empresa_id = 1
           AND usuario_id = 9
         FOR UPDATE;

        IF saldo IS NULL OR saldo < total THEN
            RAISE EXCEPTION
                'Correção da Milena interrompida: saldo inválido para estorno (%).',
                saldo;
        END IF;
    END IF;
END
$$;

WITH corrigidos AS (
    UPDATE banco_pontos_log
       SET data_referencia = COALESCE(
               data_referencia,
               substring(descricao FROM 'Sobra do dia ([0-9]{4}-[0-9]{2}-[0-9]{2})')::date
           ),
           tipo = 'CORRECAO',
           quantidade = ABS(quantidade),
           descricao = format(
               'Correção: crédito indevido de %s pontos do dia %s; lançamento repetido pelo backend antigo.',
               quantidade,
               COALESCE(
                   data_referencia,
                   substring(descricao FROM 'Sobra do dia ([0-9]{4}-[0-9]{2}-[0-9]{2})')::date
               )
           )
     WHERE id IN (201, 202, 203, 204, 205)
       AND empresa_id = 1
       AND usuario_id = 9
       AND tipo = 'GANHO'
     RETURNING quantidade
)
UPDATE banco_pontos_saldo
   SET saldo_atual = saldo_atual - COALESCE((SELECT SUM(quantidade) FROM corrigidos), 0),
       ultimo_calculo = NOW()
 WHERE empresa_id = 1
   AND usuario_id = 9
   AND EXISTS (SELECT 1 FROM corrigidos);

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'banco-resgate-correcao-milena-20260805-v2',
    'Converte cinco ganhos repetidos da Milena em correção de saldo',
    jsonb_build_object(
        'empresa_id', 1,
        'usuario_id', 9,
        'log_ids', jsonb_build_array(201, 202, 203, 204, 205),
        'pontos_corrigidos', 355,
        'motivo', 'Backend antigo recriou cinco sobras sem data_referencia'
    )
)
ON CONFLICT (id) DO UPDATE
    SET descricao = EXCLUDED.descricao,
        detalhes = EXCLUDED.detalhes;

COMMIT;
