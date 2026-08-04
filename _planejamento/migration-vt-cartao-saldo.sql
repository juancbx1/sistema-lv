BEGIN;

CREATE TABLE IF NOT EXISTS vt_cartao_movimentos (
    id                      BIGSERIAL PRIMARY KEY,
    empresa_id              INTEGER NOT NULL REFERENCES empresas(id),
    usuario_id              INTEGER NOT NULL REFERENCES usuarios(id),
    tipo                    TEXT NOT NULL,
    sentido                 TEXT NULL,
    status_credito          TEXT NULL,
    valor                   NUMERIC(12, 2) NOT NULL,
    data_ref                DATE NULL,
    data_origem             DATE NULL,
    data_destino            DATE NULL,
    recarga_id              INTEGER NULL,
    registro_dia_id         INTEGER NULL,
    movimento_origem_id     BIGINT NULL REFERENCES vt_cartao_movimentos(id),
    motivo                  TEXT NULL,
    justificativa_fato      TEXT NULL,
    justificativa_demora    TEXT NULL,
    payload                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    ocorreu_em              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valida_em               TIMESTAMPTZ NULL,
    autor_id                INTEGER NULL REFERENCES usuarios(id),
    autor_nome              TEXT NULL,
    idempotency_key         TEXT NOT NULL,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vt_cartao_movimentos_tipo_chk CHECK (
        tipo IN (
            'credito_recarga',
            'debito_consumo',
            'transferencia_origem',
            'transferencia_destino',
            'nao_usou_cartao',
            'devolucao_saldo',
            'estorno',
            'ajuste'
        )
    ),
    CONSTRAINT vt_cartao_movimentos_sentido_chk CHECK (
        sentido IS NULL OR sentido IN ('ida', 'volta', 'dia_completo')
    ),
    CONSTRAINT vt_cartao_movimentos_status_credito_chk CHECK (
        status_credito IS NULL OR status_credito IN ('provisionada', 'validada')
    ),
    CONSTRAINT vt_cartao_movimentos_idempotency_uk UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_vt_cartao_mov_empresa_usuario
    ON vt_cartao_movimentos (empresa_id, usuario_id, ocorreu_em DESC);

CREATE INDEX IF NOT EXISTS idx_vt_cartao_mov_empresa_usuario_data
    ON vt_cartao_movimentos (empresa_id, usuario_id, data_ref);

CREATE INDEX IF NOT EXISTS idx_vt_cartao_mov_recarga
    ON vt_cartao_movimentos (empresa_id, recarga_id)
    WHERE recarga_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vt_cartao_mov_status_credito
    ON vt_cartao_movimentos (empresa_id, status_credito, valida_em)
    WHERE tipo = 'credito_recarga';

CREATE TABLE IF NOT EXISTS vt_cartao_saldo (
    empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
    saldo_disponivel    NUMERIC(12, 2) NOT NULL DEFAULT 0,
    saldo_provisionado  NUMERIC(12, 2) NOT NULL DEFAULT 0,
    valor_passagem_diaria NUMERIC(12, 2) NOT NULL DEFAULT 0,
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (empresa_id, usuario_id)
);

UPDATE calendario_empresa
   SET tipo = 'falta_injustificada'
 WHERE tipo = 'falta';

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'vt-cartao-saldo-v1',
    'Livro de movimentos e saldo do cartão VT; migração de faltas do calendário',
    jsonb_build_object(
        'tabelas', jsonb_build_array('vt_cartao_movimentos', 'vt_cartao_saldo'),
        'calendario', 'falta -> falta_injustificada'
    )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
