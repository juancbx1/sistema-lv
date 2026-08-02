BEGIN;

DO $$
DECLARE
    total_empresas_legadas INTEGER;
BEGIN
    SELECT COUNT(*)
      INTO total_empresas_legadas
      FROM empresas
     WHERE codigo = 'lojas-variara'
       AND eh_legada = TRUE;

    IF total_empresas_legadas <> 1 THEN
        RAISE EXCEPTION 'A empresa legada lojas-variara não foi encontrada de forma única.';
    END IF;
END
$$;

ALTER TABLE ponto_diario ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE sessoes_trabalho_producao ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE historico_pagamentos_funcionarios ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE registro_dias_trabalhados ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE recibos_conferencia ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE banco_pontos_saldo ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE banco_pontos_log ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE pontos_extras ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE configuracoes_pontos_processos ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE metas_versoes ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE metas_regras ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE gincanas ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE gincanas_premiacoes ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE gincanas_premios_ganhos ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE avisos_popup ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE avisos_popup_visualizacoes ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE calendario_empresa ADD COLUMN IF NOT EXISTS empresa_id INTEGER;

UPDATE ponto_diario
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;
UPDATE sessoes_trabalho_producao
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;
UPDATE historico_pagamentos_funcionarios
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;
UPDATE registro_dias_trabalhados
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;
UPDATE recibos_conferencia
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;
UPDATE banco_pontos_saldo
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;
UPDATE banco_pontos_log
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;
UPDATE pontos_extras
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;
UPDATE configuracoes_pontos_processos
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;
UPDATE metas_versoes
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;
UPDATE gincanas
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;
UPDATE avisos_popup
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;
UPDATE calendario_empresa
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;

UPDATE metas_regras filho
   SET empresa_id = pai.empresa_id
  FROM metas_versoes pai
 WHERE filho.id_versao = pai.id
   AND filho.empresa_id IS NULL;
UPDATE gincanas_premiacoes filho
   SET empresa_id = pai.empresa_id
  FROM gincanas pai
 WHERE filho.gincana_id = pai.id
   AND filho.empresa_id IS NULL;
UPDATE gincanas_premios_ganhos filho
   SET empresa_id = pai.empresa_id
  FROM gincanas pai
 WHERE filho.gincana_id = pai.id
   AND filho.empresa_id IS NULL;
UPDATE avisos_popup_visualizacoes filho
   SET empresa_id = pai.empresa_id
  FROM avisos_popup pai
 WHERE filho.aviso_id = pai.id
   AND filho.empresa_id IS NULL;

ALTER TABLE ponto_diario
    ADD CONSTRAINT uq_ponto_diario_empresa_id UNIQUE (empresa_id, id),
    ADD CONSTRAINT uq_ponto_empresa_func_data UNIQUE (empresa_id, funcionario_id, data);
ALTER TABLE sessoes_trabalho_producao
    ADD CONSTRAINT uq_sessoes_trabalho_empresa_id UNIQUE (empresa_id, id);
ALTER TABLE historico_pagamentos_funcionarios
    ADD CONSTRAINT uq_hist_pag_empresa_id UNIQUE (empresa_id, id);
ALTER TABLE registro_dias_trabalhados
    ADD CONSTRAINT uq_registro_dias_empresa_id UNIQUE (empresa_id, id),
    ADD CONSTRAINT uq_registro_empresa_usuario_data UNIQUE (empresa_id, usuario_id, data);
ALTER TABLE recibos_conferencia
    ADD CONSTRAINT uq_recibos_empresa_id UNIQUE (empresa_id, id);
ALTER TABLE banco_pontos_saldo
    ADD CONSTRAINT uq_banco_saldo_empresa_id UNIQUE (empresa_id, id),
    ADD CONSTRAINT uq_banco_saldo_empresa_usuario UNIQUE (empresa_id, usuario_id);
ALTER TABLE banco_pontos_log
    ADD CONSTRAINT uq_banco_log_empresa_id UNIQUE (empresa_id, id);
ALTER TABLE pontos_extras
    ADD CONSTRAINT uq_pontos_extras_empresa_id UNIQUE (empresa_id, id);
ALTER TABLE configuracoes_pontos_processos
    ADD CONSTRAINT uq_config_pontos_empresa_id UNIQUE (empresa_id, id),
    ADD CONSTRAINT uq_config_pontos_empresa_prod_proc_tipo
        UNIQUE (empresa_id, produto_id, processo_nome, tipo_atividade);
ALTER TABLE metas_versoes
    ADD CONSTRAINT uq_metas_versoes_empresa_id UNIQUE (empresa_id, id);
ALTER TABLE metas_regras
    ADD CONSTRAINT uq_metas_regras_empresa_id UNIQUE (empresa_id, id);
ALTER TABLE gincanas
    ADD CONSTRAINT uq_gincanas_empresa_id UNIQUE (empresa_id, id);
ALTER TABLE gincanas_premiacoes
    ADD CONSTRAINT uq_gincanas_prem_empresa_id UNIQUE (empresa_id, id);
ALTER TABLE gincanas_premios_ganhos
    ADD CONSTRAINT uq_gincanas_ganhos_empresa_id UNIQUE (empresa_id, id);
ALTER TABLE avisos_popup
    ADD CONSTRAINT uq_avisos_popup_empresa_id UNIQUE (empresa_id, id);
ALTER TABLE avisos_popup_visualizacoes
    ADD CONSTRAINT uq_avisos_visual_empresa_id UNIQUE (empresa_id, id),
    ADD CONSTRAINT uq_avisos_visual_empresa_aviso_usuario
        UNIQUE (empresa_id, aviso_id, usuario_id);
ALTER TABLE calendario_empresa
    ADD CONSTRAINT uq_calendario_empresa_id_empresa UNIQUE (empresa_id, id);

ALTER TABLE ponto_diario
    ADD CONSTRAINT fk_ponto_diario_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID,
    ADD CONSTRAINT fk_ponto_func_empresa
        FOREIGN KEY (funcionario_id, empresa_id)
        REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
ALTER TABLE sessoes_trabalho_producao
    ADD CONSTRAINT fk_sessoes_trabalho_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID,
    ADD CONSTRAINT fk_sessoes_func_empresa
        FOREIGN KEY (funcionario_id, empresa_id)
        REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
ALTER TABLE historico_pagamentos_funcionarios
    ADD CONSTRAINT fk_hist_pag_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID,
    ADD CONSTRAINT fk_hist_pag_usuario_empresa
        FOREIGN KEY (usuario_id, empresa_id)
        REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID,
    ADD CONSTRAINT fk_hist_pag_conta_empresa
        FOREIGN KEY (empresa_id, id_conta_debito)
        REFERENCES fc_contas_bancarias(empresa_id, id) NOT VALID;
ALTER TABLE registro_dias_trabalhados
    ADD CONSTRAINT fk_registro_dias_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID,
    ADD CONSTRAINT fk_registro_dias_usuario_empresa
        FOREIGN KEY (usuario_id, empresa_id)
        REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID,
    ADD CONSTRAINT fk_registro_dias_pag_empresa
        FOREIGN KEY (empresa_id, id_historico_pagamento)
        REFERENCES historico_pagamentos_funcionarios(empresa_id, id) NOT VALID;
ALTER TABLE recibos_conferencia
    ADD CONSTRAINT fk_recibos_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID,
    ADD CONSTRAINT fk_recibos_usuario_empresa
        FOREIGN KEY (usuario_id, empresa_id)
        REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
ALTER TABLE banco_pontos_saldo
    ADD CONSTRAINT fk_banco_saldo_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID,
    ADD CONSTRAINT fk_banco_saldo_usuario_empresa
        FOREIGN KEY (usuario_id, empresa_id)
        REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
ALTER TABLE banco_pontos_log
    ADD CONSTRAINT fk_banco_log_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID,
    ADD CONSTRAINT fk_banco_log_usuario_empresa
        FOREIGN KEY (usuario_id, empresa_id)
        REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
ALTER TABLE pontos_extras
    ADD CONSTRAINT fk_pontos_extras_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID,
    ADD CONSTRAINT fk_pontos_extras_func_empresa
        FOREIGN KEY (funcionario_id, empresa_id)
        REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
ALTER TABLE configuracoes_pontos_processos
    ADD CONSTRAINT fk_config_pontos_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
ALTER TABLE metas_versoes
    ADD CONSTRAINT fk_metas_versoes_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
ALTER TABLE metas_regras
    ADD CONSTRAINT fk_metas_regras_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID,
    ADD CONSTRAINT fk_metas_regras_versao_empresa
        FOREIGN KEY (empresa_id, id_versao)
        REFERENCES metas_versoes(empresa_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE gincanas
    ADD CONSTRAINT fk_gincanas_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
ALTER TABLE gincanas_premiacoes
    ADD CONSTRAINT fk_gincanas_prem_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID,
    ADD CONSTRAINT fk_gincanas_prem_pai_empresa
        FOREIGN KEY (empresa_id, gincana_id)
        REFERENCES gincanas(empresa_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE gincanas_premios_ganhos
    ADD CONSTRAINT fk_gincanas_ganhos_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID,
    ADD CONSTRAINT fk_gincanas_ganhos_usuario_empresa
        FOREIGN KEY (usuario_id, empresa_id)
        REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID,
    ADD CONSTRAINT fk_gincanas_ganhos_pai_empresa
        FOREIGN KEY (empresa_id, gincana_id)
        REFERENCES gincanas(empresa_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE avisos_popup
    ADD CONSTRAINT fk_avisos_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
ALTER TABLE avisos_popup_visualizacoes
    ADD CONSTRAINT fk_avisos_visual_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID,
    ADD CONSTRAINT fk_avisos_visual_usuario_empresa
        FOREIGN KEY (usuario_id, empresa_id)
        REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID,
    ADD CONSTRAINT fk_avisos_visual_pai_empresa
        FOREIGN KEY (empresa_id, aviso_id)
        REFERENCES avisos_popup(empresa_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE calendario_empresa
    ADD CONSTRAINT fk_calendario_empresa
        FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID,
    ADD CONSTRAINT fk_calendario_func_empresa
        FOREIGN KEY (funcionario_id, empresa_id)
        REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;

CREATE INDEX idx_sessoes_empresa_func_status
    ON sessoes_trabalho_producao (empresa_id, funcionario_id, status);
CREATE INDEX idx_hist_pag_empresa_usuario_data
    ON historico_pagamentos_funcionarios (empresa_id, usuario_id, data_pagamento DESC);
CREATE INDEX idx_recibos_empresa_usuario_periodo
    ON recibos_conferencia (empresa_id, usuario_id, data_inicio, data_fim);
CREATE INDEX idx_banco_log_empresa_usuario_data
    ON banco_pontos_log (empresa_id, usuario_id, data_evento DESC);
CREATE INDEX idx_pontos_extras_empresa_func_data
    ON pontos_extras (empresa_id, funcionario_id, data_referencia DESC);
CREATE INDEX idx_metas_versoes_empresa_vigencia
    ON metas_versoes (empresa_id, data_inicio_vigencia DESC);
CREATE INDEX idx_gincanas_empresa_status_periodo
    ON gincanas (empresa_id, status, datetime_inicio, datetime_fim);
CREATE INDEX idx_gincanas_ganhos_empresa_usuario
    ON gincanas_premios_ganhos (empresa_id, usuario_id, pago_em);
CREATE INDEX idx_avisos_empresa_ativos_periodo
    ON avisos_popup (empresa_id, ativo, data_inicio, data_fim);
CREATE INDEX idx_calendario_empresa_data
    ON calendario_empresa (empresa_id, data);

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'multiempresas-fase7-preparacao-v1',
    'Prepara empregados, ponto, pagamentos e incentivos para isolamento empresarial',
    jsonb_build_object(
        'empresa_legada', 'lojas-variara',
        'tabelas_migradas', 17,
        'empresa_id_obrigatorio', FALSE,
        'dashboard_liberada', FALSE
    )
)
ON CONFLICT (id) DO UPDATE
SET
    descricao = EXCLUDED.descricao,
    detalhes = EXCLUDED.detalhes,
    executada_em = NOW();

COMMIT;
