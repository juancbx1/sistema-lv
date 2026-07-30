-- Redesign do Menu Lateral — preferências por usuário/empresa e changelog global
-- Migration aditiva. Ensaiar em restauração local antes de executar em produção.

BEGIN;

CREATE TABLE IF NOT EXISTS usuarios_menu_preferencias (
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    favoritos JSONB NOT NULL DEFAULT '[]'::jsonb,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT usuarios_menu_preferencias_pk
        PRIMARY KEY (usuario_id, empresa_id),
    CONSTRAINT usuarios_menu_preferencias_favoritos_array
        CHECK (jsonb_typeof(favoritos) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_usuarios_menu_preferencias_empresa
    ON usuarios_menu_preferencias (empresa_id, usuario_id);

CREATE TABLE IF NOT EXISTS usuarios_preferencias_interface (
    usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    changelog_versao_lida TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT usuarios_preferencias_interface_versao
        CHECK (
            changelog_versao_lida IS NULL
            OR changelog_versao_lida ~ '^[0-9]+\.[0-9]+\.[0-9]+([+-][A-Za-z0-9.-]+)?$'
        )
);

COMMIT;
