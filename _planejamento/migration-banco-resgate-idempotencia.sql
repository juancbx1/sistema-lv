BEGIN;

-- A data de origem é diferente de data_evento: o ganho pode ser auditado
-- dias depois, mas continua pertencendo ao dia de produção original.
ALTER TABLE banco_pontos_log
    ADD COLUMN IF NOT EXISTS data_referencia DATE;

UPDATE banco_pontos_log
   SET data_referencia = substring(
           descricao FROM 'Sobra do dia ([0-9]{4}-[0-9]{2}-[0-9]{2})'
       )::date
 WHERE tipo = 'GANHO'
   AND data_referencia IS NULL
   AND descricao ~ 'Sobra do dia [0-9]{4}-[0-9]{2}-[0-9]{2}';

-- Não cria a trava silenciosamente se já houver duplicatas históricas.
-- O operador deve classificar esses casos antes de aplicar a migration.
DO $$
DECLARE
    duplicidades INTEGER;
BEGIN
    SELECT COUNT(*)
      INTO duplicidades
      FROM (
            SELECT empresa_id, usuario_id, data_referencia
              FROM banco_pontos_log
             WHERE tipo = 'GANHO'
               AND data_referencia IS NOT NULL
             GROUP BY empresa_id, usuario_id, data_referencia
            HAVING COUNT(*) > 1
           ) AS grupos;

    IF duplicidades > 0 THEN
        RAISE EXCEPTION
            'Migration interrompida: existem % dias com mais de um GANHO no banco de resgate.',
            duplicidades;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_banco_log_empresa_usuario_ganho_dia
    ON banco_pontos_log (empresa_id, usuario_id, data_referencia)
    WHERE tipo = 'GANHO' AND data_referencia IS NOT NULL;

COMMENT ON COLUMN banco_pontos_log.data_referencia IS
    'Dia de produção que originou o movimento automático do banco de resgate.';

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'banco-resgate-idempotencia-v1',
    'Adiciona data de origem e trava de um ganho por empregado e dia',
    jsonb_build_object(
        'coluna', 'banco_pontos_log.data_referencia',
        'indice', 'uq_banco_log_empresa_usuario_ganho_dia',
        'regra', 'um GANHO por empresa, empregado e dia de produção'
    )
)
ON CONFLICT (id) DO UPDATE
    SET descricao = EXCLUDED.descricao,
        detalhes = EXCLUDED.detalhes;

COMMIT;
