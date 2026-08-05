BEGIN;

-- Segunda barreira para deployments antigos que ainda inserem GANHO sem
-- preencher data_referencia. A expressão recupera a data da descrição.
CREATE OR REPLACE FUNCTION banco_resgate_data_origem(descricao TEXT)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT substring($1 FROM 'Sobra do dia ([0-9]{4}-[0-9]{2}-[0-9]{2})')::date;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_banco_log_empresa_usuario_ganho_origem_dia
    ON banco_pontos_log (
        empresa_id,
        usuario_id,
        (
            COALESCE(
                data_referencia,
                banco_resgate_data_origem(descricao)
            )
        )
    )
    WHERE tipo = 'GANHO'
      AND (
          data_referencia IS NOT NULL
          OR descricao ~ 'Sobra do dia [0-9]{4}-[0-9]{2}-[0-9]{2}'
      );

COMMENT ON INDEX uq_banco_log_empresa_usuario_ganho_origem_dia IS
    'Impede mais de um GANHO por empresa, empregado e dia, inclusive no fluxo legado sem data_referencia.';

CREATE OR REPLACE FUNCTION impedir_ganho_cofre_duplicado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    dia_origem DATE;
BEGIN
    IF NEW.tipo <> 'GANHO' THEN
        RETURN NEW;
    END IF;

    dia_origem := COALESCE(
        NEW.data_referencia,
        banco_resgate_data_origem(NEW.descricao)
    );

    IF dia_origem IS NOT NULL AND EXISTS (
        SELECT 1
          FROM banco_pontos_log existente
         WHERE existente.empresa_id = NEW.empresa_id
           AND existente.usuario_id = NEW.usuario_id
           AND existente.tipo IN ('GANHO', 'CORRECAO')
           AND existente.id IS DISTINCT FROM NEW.id
           AND COALESCE(
                   existente.data_referencia,
                   banco_resgate_data_origem(existente.descricao)
               ) = dia_origem
    ) THEN
        RAISE EXCEPTION
            'Ganho de pontos extras já existe para empresa %, empregado % e dia %.',
            NEW.empresa_id, NEW.usuario_id, dia_origem
            USING ERRCODE = '23505',
                  CONSTRAINT = 'uq_banco_log_empresa_usuario_ganho_origem_dia';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_impedir_ganho_cofre_duplicado ON banco_pontos_log;
CREATE TRIGGER trg_impedir_ganho_cofre_duplicado
    BEFORE INSERT OR UPDATE OF tipo, data_referencia, descricao
    ON banco_pontos_log
    FOR EACH ROW
    EXECUTE FUNCTION impedir_ganho_cofre_duplicado();

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'banco-resgate-trava-legado-v1',
    'Trava ganhos legados sem data_referencia pela data da descrição',
    jsonb_build_object(
        'indice', 'uq_banco_log_empresa_usuario_ganho_origem_dia',
        'trigger', 'trg_impedir_ganho_cofre_duplicado',
        'regra', 'um GANHO por empresa, empregado e dia de origem; correção impede reentrada'
    )
)
ON CONFLICT (id) DO UPDATE
    SET descricao = EXCLUDED.descricao,
        detalhes = EXCLUDED.detalhes;

COMMIT;
