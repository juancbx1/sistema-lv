BEGIN;

-- Mantém um único registro auditável para o lançamento indevido de 67 pontos
-- recriado em 05/08/2026. A correção retira esses pontos do saldo.
DO $$
DECLARE
    tipo_atual TEXT;
    quantidade_atual NUMERIC;
    saldo NUMERIC;
BEGIN
    IF EXISTS (
        SELECT 1
          FROM sistema_migrations
         WHERE id = 'banco-resgate-correcao-milena-20260805-v3'
    ) THEN
        RETURN;
    END IF;

    SELECT tipo, quantidade
      INTO tipo_atual, quantidade_atual
      FROM banco_pontos_log
     WHERE id = 207
       AND empresa_id = 1
       AND usuario_id = 9;

    IF tipo_atual IS DISTINCT FROM 'GANHO' OR quantidade_atual <> 67 THEN
        RAISE EXCEPTION
            'Correção da Milena interrompida: esperado o GANHO 207 de 67 pontos; encontrado tipo % e quantidade %.',
            tipo_atual, quantidade_atual;
    END IF;

    SELECT saldo_atual
      INTO saldo
      FROM banco_pontos_saldo
     WHERE empresa_id = 1
       AND usuario_id = 9
     FOR UPDATE;

    IF saldo IS NULL OR saldo < 67 THEN
        RAISE EXCEPTION
            'Correção da Milena interrompida: saldo inválido para estorno (%).',
            saldo;
    END IF;
END
$$;

WITH corrigido AS (
    UPDATE banco_pontos_log
       SET tipo = 'CORRECAO',
           quantidade = ABS(quantidade),
           descricao = 'Correção de Bugs: lançamento indevido de 67 pontos do dia 23/07/2026.'
     WHERE id = 207
       AND empresa_id = 1
       AND usuario_id = 9
       AND tipo = 'GANHO'
       AND quantidade = 67
     RETURNING quantidade
)
UPDATE banco_pontos_saldo
   SET saldo_atual = saldo_atual - COALESCE((SELECT SUM(quantidade) FROM corrigido), 0),
       ultimo_calculo = NOW()
 WHERE empresa_id = 1
   AND usuario_id = 9
   AND EXISTS (SELECT 1 FROM corrigido);

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'banco-resgate-correcao-milena-20260805-v3',
    'Converte o ganho indevido de 67 pontos da Milena em correção de saldo',
    jsonb_build_object(
        'empresa_id', 1,
        'usuario_id', 9,
        'log_id', 207,
        'pontos_corrigidos', 67,
        'data_origem', '2026-07-23',
        'motivo', 'Meta histórica vigente era 900; a auditoria usou indevidamente a meta atual de 829'
    )
)
ON CONFLICT (id) DO UPDATE
    SET descricao = EXCLUDED.descricao,
        detalhes = EXCLUDED.detalhes;

COMMIT;
