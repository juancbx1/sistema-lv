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

ALTER TABLE produtos
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;

ALTER TABLE demandas_producao
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER,
    ADD COLUMN IF NOT EXISTS produto_id INTEGER;

ALTER TABLE demandas_componentes_atribuidos
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;

UPDATE produtos
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;

UPDATE demandas_producao
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;

UPDATE demandas_componentes_atribuidos
   SET empresa_id = (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
 WHERE empresa_id IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM (
            SELECT d.id,
                   COUNT(DISTINCT p.id) AS candidatos
            FROM demandas_producao d
            LEFT JOIN produtos p
              ON p.empresa_id = d.empresa_id
             AND (
                    p.sku = d.produto_sku
                    OR EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements(COALESCE(p.grade, '[]'::jsonb)) g
                        WHERE g->>'sku' = d.produto_sku
                    )
                )
            GROUP BY d.id
            HAVING COUNT(DISTINCT p.id) <> 1
        ) ambiguidades
    ) THEN
        RAISE EXCEPTION 'Há demandas sem produto ou com mais de um produto candidato; backfill interrompido.';
    END IF;
END
$$;

UPDATE demandas_producao d
   SET produto_id = p.id
  FROM produtos p
 WHERE d.produto_id IS NULL
   AND p.empresa_id = d.empresa_id
   AND (
        p.sku = d.produto_sku
        OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(p.grade, '[]'::jsonb)) g
            WHERE g->>'sku' = d.produto_sku
        )
   );

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM produtos WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM demandas_producao WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM demandas_producao WHERE produto_id IS NULL) THEN
        RAISE EXCEPTION 'Backfill empresarial incompleto em produtos ou demandas.';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_produtos_empresa_id'
    ) THEN
        ALTER TABLE produtos
            ADD CONSTRAINT uq_produtos_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_demandas_empresa_id'
    ) THEN
        ALTER TABLE demandas_producao
            ADD CONSTRAINT uq_demandas_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_demandas_componentes_empresa_id'
    ) THEN
        ALTER TABLE demandas_componentes_atribuidos
            ADD CONSTRAINT uq_demandas_componentes_empresa_id UNIQUE (empresa_id, id);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_produtos_empresa'
    ) THEN
        ALTER TABLE produtos
            ADD CONSTRAINT fk_produtos_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_demandas_empresa'
    ) THEN
        ALTER TABLE demandas_producao
            ADD CONSTRAINT fk_demandas_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_demandas_produto_empresa'
    ) THEN
        ALTER TABLE demandas_producao
            ADD CONSTRAINT fk_demandas_produto_empresa
            FOREIGN KEY (empresa_id, produto_id)
            REFERENCES produtos(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_demandas_componentes_empresa'
    ) THEN
        ALTER TABLE demandas_componentes_atribuidos
            ADD CONSTRAINT fk_demandas_componentes_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_empresa_nome
    ON produtos (empresa_id, nome);
CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_empresa_sku
    ON produtos (empresa_id, sku)
    WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_demandas_empresa_status
    ON demandas_producao (empresa_id, status, prioridade);
CREATE INDEX IF NOT EXISTS idx_demandas_empresa_produto
    ON demandas_producao (empresa_id, produto_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_demandas_componentes_empresa_chave
    ON demandas_componentes_atribuidos (empresa_id, componente_chave);

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'multiempresas-fase8-produtos-demandas-v1',
    'Migracao aditivo de Produtos e Demandas para a Fase 8 multiempresas',
    jsonb_build_object(
        'empresa_legada', 'lojas-variara',
        'empresa_id_obrigatorio', FALSE,
        'produto_id_em_demandas', TRUE,
        'constraints_legadas_preservadas', TRUE,
        'escopo', 'producao'
    )
)
ON CONFLICT (id) DO UPDATE
SET descricao = EXCLUDED.descricao,
    detalhes = EXCLUDED.detalhes,
    executada_em = NOW();

COMMIT;

BEGIN;

DO $$
DECLARE
    empresa_legada_id INTEGER;
BEGIN
    SELECT id
      INTO empresa_legada_id
      FROM empresas
     WHERE codigo = 'lojas-variara'
       AND eh_legada = TRUE;

    IF empresa_legada_id IS NULL THEN
        RAISE EXCEPTION 'A empresa legada lojas-variara não foi encontrada.';
    END IF;

    ALTER TABLE ordens_de_producao
        ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
    ALTER TABLE cortes
        ADD COLUMN IF NOT EXISTS empresa_id INTEGER;

    UPDATE ordens_de_producao
       SET empresa_id = empresa_legada_id
     WHERE empresa_id IS NULL;
    UPDATE cortes
       SET empresa_id = empresa_legada_id
     WHERE empresa_id IS NULL;
END
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ordens_de_producao WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM cortes WHERE empresa_id IS NULL) THEN
        RAISE EXCEPTION 'Backfill empresarial incompleto em OPs ou cortes.';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_ops_empresa_id'
    ) THEN
        ALTER TABLE ordens_de_producao
            ADD CONSTRAINT uq_ops_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_cortes_empresa_id'
    ) THEN
        ALTER TABLE cortes
            ADD CONSTRAINT uq_cortes_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_ops_empresa_numero'
    ) THEN
        ALTER TABLE ordens_de_producao
            ADD CONSTRAINT uq_ops_empresa_numero UNIQUE (empresa_id, numero);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_ops_empresa_edit_id'
    ) THEN
        ALTER TABLE ordens_de_producao
            ADD CONSTRAINT uq_ops_empresa_edit_id UNIQUE (empresa_id, edit_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_cortes_empresa_pn'
    ) THEN
        ALTER TABLE cortes
            ADD CONSTRAINT uq_cortes_empresa_pn UNIQUE (empresa_id, pn);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_ops_empresa'
    ) THEN
        ALTER TABLE ordens_de_producao
            ADD CONSTRAINT fk_ops_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_cortes_empresa'
    ) THEN
        ALTER TABLE cortes
            ADD CONSTRAINT fk_cortes_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_ops_produto_empresa'
    ) THEN
        ALTER TABLE ordens_de_producao
            ADD CONSTRAINT fk_ops_produto_empresa
            FOREIGN KEY (empresa_id, produto_id)
            REFERENCES produtos(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_ops_demanda_empresa'
    ) THEN
        ALTER TABLE ordens_de_producao
            ADD CONSTRAINT fk_ops_demanda_empresa
            FOREIGN KEY (empresa_id, demanda_id)
            REFERENCES demandas_producao(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_cortes_produto_empresa'
    ) THEN
        ALTER TABLE cortes
            ADD CONSTRAINT fk_cortes_produto_empresa
            FOREIGN KEY (empresa_id, produto_id)
            REFERENCES produtos(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_cortes_demanda_empresa'
    ) THEN
        ALTER TABLE cortes
            ADD CONSTRAINT fk_cortes_demanda_empresa
            FOREIGN KEY (empresa_id, demanda_id)
            REFERENCES demandas_producao(empresa_id, id) NOT VALID;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_ops_empresa_status
    ON ordens_de_producao (empresa_id, status, data_entrega);
CREATE INDEX IF NOT EXISTS idx_ops_empresa_produto
    ON ordens_de_producao (empresa_id, produto_id, variante);
CREATE INDEX IF NOT EXISTS idx_ops_empresa_demanda
    ON ordens_de_producao (empresa_id, demanda_id);
CREATE INDEX IF NOT EXISTS idx_cortes_empresa_status
    ON cortes (empresa_id, status, data);
CREATE INDEX IF NOT EXISTS idx_cortes_empresa_produto
    ON cortes (empresa_id, produto_id, variante);
CREATE INDEX IF NOT EXISTS idx_cortes_empresa_demanda
    ON cortes (empresa_id, demanda_id);
CREATE INDEX IF NOT EXISTS idx_cortes_empresa_op
    ON cortes (empresa_id, op);

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'multiempresas-fase8-op-cortes-v1',
    'Migracao aditivo de OPs e Cortes para a Fase 8 multiempresas',
    jsonb_build_object(
        'empresa_legada', 'lojas-variara',
        'empresa_id_obrigatorio', FALSE,
        'constraints_legadas_preservadas', TRUE,
        'orfaos_preservados_para_classificacao', TRUE,
        'escopo', 'producao'
    )
)
ON CONFLICT (id) DO UPDATE
SET descricao = EXCLUDED.descricao,
    detalhes = EXCLUDED.detalhes,
    executada_em = NOW();

COMMIT;

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

ALTER TABLE producoes
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;

ALTER TABLE producoes_solicitacoes_exclusao
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;

UPDATE producoes p
   SET empresa_id = COALESCE(
       (SELECT op.empresa_id
          FROM ordens_de_producao op
         WHERE op.numero = p.op_numero
         LIMIT 1),
       (SELECT pr.empresa_id
          FROM produtos pr
         WHERE pr.id = p.produto_id
         LIMIT 1),
       (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
   )
 WHERE p.empresa_id IS NULL;

UPDATE sessoes_trabalho_producao s
   SET empresa_id = COALESCE(
       s.empresa_id,
       (SELECT op.empresa_id
          FROM ordens_de_producao op
         WHERE op.numero = s.op_numero
         LIMIT 1),
       (SELECT pr.empresa_id
          FROM produtos pr
         WHERE pr.id = s.produto_id
         LIMIT 1),
       (SELECT ue.empresa_id
          FROM usuarios_empresas ue
         WHERE ue.usuario_id = s.funcionario_id
           AND ue.ativo = TRUE
         ORDER BY ue.empresa_id
         LIMIT 1),
       (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
   )
 WHERE s.empresa_id IS NULL;

UPDATE producoes_solicitacoes_exclusao x
   SET empresa_id = COALESCE(
       (SELECT p.empresa_id FROM producoes p WHERE p.id = x.producao_id),
       (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
   )
 WHERE x.empresa_id IS NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM producoes WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM sessoes_trabalho_producao WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM producoes_solicitacoes_exclusao WHERE empresa_id IS NULL) THEN
        RAISE EXCEPTION 'Backfill empresarial incompleto em Produção, sessões ou solicitações de exclusão.';
    END IF;
END
$$;

ALTER TABLE producoes
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE producoes_solicitacoes_exclusao
    ALTER COLUMN empresa_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_producoes_empresa_id'
    ) THEN
        ALTER TABLE producoes
            ADD CONSTRAINT uq_producoes_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_producao_solicitacoes_empresa_id'
    ) THEN
        ALTER TABLE producoes_solicitacoes_exclusao
            ADD CONSTRAINT uq_producao_solicitacoes_empresa_id UNIQUE (empresa_id, id);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_producoes_empresa'
    ) THEN
        ALTER TABLE producoes
            ADD CONSTRAINT fk_producoes_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_producoes_produto_empresa'
    ) THEN
        ALTER TABLE producoes
            ADD CONSTRAINT fk_producoes_produto_empresa
            FOREIGN KEY (empresa_id, produto_id)
            REFERENCES produtos(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_producoes_op_empresa'
    ) THEN
        ALTER TABLE producoes
            ADD CONSTRAINT fk_producoes_op_empresa
            FOREIGN KEY (empresa_id, op_numero)
            REFERENCES ordens_de_producao(empresa_id, numero) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_producoes_funcionario_empresa'
    ) THEN
        ALTER TABLE producoes
            ADD CONSTRAINT fk_producoes_funcionario_empresa
            FOREIGN KEY (funcionario_id, empresa_id)
            REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_producao_solicitacoes_empresa'
    ) THEN
        ALTER TABLE producoes_solicitacoes_exclusao
            ADD CONSTRAINT fk_producao_solicitacoes_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_producao_solicitacoes_producao_empresa'
    ) THEN
        ALTER TABLE producoes_solicitacoes_exclusao
            ADD CONSTRAINT fk_producao_solicitacoes_producao_empresa
            FOREIGN KEY (empresa_id, producao_id)
            REFERENCES producoes(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessoes_producao_produto_empresa'
    ) THEN
        ALTER TABLE sessoes_trabalho_producao
            ADD CONSTRAINT fk_sessoes_producao_produto_empresa
            FOREIGN KEY (empresa_id, produto_id)
            REFERENCES produtos(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessoes_producao_op_empresa'
    ) THEN
        ALTER TABLE sessoes_trabalho_producao
            ADD CONSTRAINT fk_sessoes_producao_op_empresa
            FOREIGN KEY (empresa_id, op_numero)
            REFERENCES ordens_de_producao(empresa_id, numero) NOT VALID;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_producoes_empresa_data
    ON producoes (empresa_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_producoes_empresa_op_etapa
    ON producoes (empresa_id, op_numero, etapa_index);
CREATE INDEX IF NOT EXISTS idx_producoes_empresa_funcionario_data
    ON producoes (empresa_id, funcionario_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_sessoes_producao_empresa_status
    ON sessoes_trabalho_producao (empresa_id, status, data_inicio DESC);
CREATE INDEX IF NOT EXISTS idx_sessoes_producao_empresa_op
    ON sessoes_trabalho_producao (empresa_id, op_numero);
CREATE INDEX IF NOT EXISTS idx_producao_solicitacoes_empresa_status
    ON producoes_solicitacoes_exclusao (empresa_id, status, solicitado_em DESC);

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'multiempresas-fase8-producao-v1',
    'Migracao aditivo de Produção e sessões para a Fase 8 multiempresas',
    jsonb_build_object(
        'empresa_legada', 'lojas-variara',
        'empresa_id_obrigatorio_producoes', TRUE,
        'empresa_id_obrigatorio_solicitacoes', TRUE,
        'sessoes_preparadas_na_fase7', TRUE,
        'lancamentos_sem_op_preservados', TRUE,
        'solicitacoes_sem_producao_preservadas', TRUE,
        'escopo', 'producao'
    )
)
ON CONFLICT (id) DO UPDATE
SET descricao = EXCLUDED.descricao,
    detalhes = EXCLUDED.detalhes,
    executada_em = NOW();

COMMIT;

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
        RAISE EXCEPTION 'A empresa legada lojas-variara nÃ£o foi encontrada de forma Ãºnica.';
    END IF;
END
$$;

ALTER TABLE producao_promessas
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;

UPDATE producao_promessas
   SET empresa_id = (
       SELECT id
         FROM empresas
        WHERE codigo = 'lojas-variara'
          AND eh_legada = TRUE
   )
 WHERE empresa_id IS NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM producao_promessas WHERE empresa_id IS NULL) THEN
        RAISE EXCEPTION 'Backfill empresarial incompleto em producao_promessas.';
    END IF;
END
$$;

ALTER TABLE producao_promessas
    ALTER COLUMN empresa_id SET NOT NULL;

ALTER TABLE producao_promessas
    DROP CONSTRAINT IF EXISTS producao_promessas_produto_ref_id_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'uq_producao_promessas_empresa_produto_ref'
    ) THEN
        ALTER TABLE producao_promessas
            ADD CONSTRAINT uq_producao_promessas_empresa_produto_ref
            UNIQUE (empresa_id, produto_ref_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'fk_producao_promessas_empresa'
    ) THEN
        ALTER TABLE producao_promessas
            ADD CONSTRAINT fk_producao_promessas_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_producao_promessas_empresa_expiracao
    ON producao_promessas (empresa_id, data_expiracao);

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'multiempresas-fase8-promessas-v1',
    'Migracao aditivo de promessas de produÃ§Ã£o para a Fase 8 multiempresas',
    jsonb_build_object(
        'empresa_legada', 'lojas-variara',
        'empresa_id_obrigatorio', TRUE,
        'unicidade', '(empresa_id, produto_ref_id)',
        'escopo', 'producao'
    )
)
ON CONFLICT (id) DO UPDATE
SET descricao = EXCLUDED.descricao,
    detalhes = EXCLUDED.detalhes,
    executada_em = NOW();

COMMIT;

BEGIN;

DO $$
DECLARE
    empresa_legada_id INTEGER;
BEGIN
    SELECT id
      INTO empresa_legada_id
      FROM empresas
     WHERE codigo = 'lojas-variara'
       AND eh_legada = TRUE;

    IF empresa_legada_id IS NULL THEN
        RAISE EXCEPTION 'A empresa legada lojas-variara não foi encontrada.';
    END IF;
END
$$;

ALTER TABLE arremates
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE arremate_perdas
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE sessoes_trabalho_arremate
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE tempos_padrao_arremate
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE log_assinaturas
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE log_divergencias
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;

UPDATE arremates a
   SET empresa_id = COALESCE(
       (SELECT op.empresa_id
          FROM ordens_de_producao op
         WHERE op.numero = a.op_numero
         LIMIT 1),
       (SELECT p.empresa_id
          FROM produtos p
         WHERE p.id = a.produto_id
         LIMIT 1),
       (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
   )
 WHERE a.empresa_id IS NULL;

UPDATE sessoes_trabalho_arremate s
   SET empresa_id = COALESCE(
       (SELECT op.empresa_id
          FROM ordens_de_producao op
         WHERE op.numero = s.op_numero
         LIMIT 1),
       (SELECT p.empresa_id
          FROM produtos p
         WHERE p.id = s.produto_id
         LIMIT 1),
       (SELECT ue.empresa_id
          FROM usuarios_empresas ue
         WHERE ue.usuario_id = s.usuario_tiktik_id
           AND ue.ativo
         ORDER BY ue.empresa_id
         LIMIT 1),
       (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
   )
 WHERE s.empresa_id IS NULL;

UPDATE arremate_perdas ap
   SET empresa_id = COALESCE(
       (SELECT a.empresa_id
          FROM arremates a
         WHERE a.id_perda_origem = ap.id
         ORDER BY a.id
         LIMIT 1),
       (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
   )
 WHERE ap.empresa_id IS NULL;

UPDATE tempos_padrao_arremate t
   SET empresa_id = COALESCE(
       (SELECT p.empresa_id FROM produtos p WHERE p.id = t.produto_id),
       (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
   )
 WHERE t.empresa_id IS NULL;

UPDATE log_assinaturas l
   SET empresa_id = COALESCE(
       (SELECT a.empresa_id FROM arremates a WHERE a.id = l.id_arremate),
       (SELECT p.empresa_id FROM producoes p WHERE p.id = l.id_producao),
       (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
   )
 WHERE l.empresa_id IS NULL;

UPDATE log_divergencias l
   SET empresa_id = COALESCE(
       (SELECT a.empresa_id FROM arremates a WHERE a.id = l.id_arremate_original),
       (SELECT p.empresa_id FROM producoes p WHERE p.id = l.id_producao_original),
       (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
   )
 WHERE l.empresa_id IS NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM arremates WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM arremate_perdas WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM sessoes_trabalho_arremate WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM tempos_padrao_arremate WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM log_assinaturas WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM log_divergencias WHERE empresa_id IS NULL) THEN
        RAISE EXCEPTION 'Backfill empresarial incompleto em Arremates, sessões ou logs.';
    END IF;
END
$$;

ALTER TABLE arremates ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE arremate_perdas ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE sessoes_trabalho_arremate ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE tempos_padrao_arremate ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE log_assinaturas ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE log_divergencias ALTER COLUMN empresa_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_arremates_empresa_id') THEN
        ALTER TABLE arremates ADD CONSTRAINT uq_arremates_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_arremate_perdas_empresa_id') THEN
        ALTER TABLE arremate_perdas ADD CONSTRAINT uq_arremate_perdas_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_sessoes_arremate_empresa_id') THEN
        ALTER TABLE sessoes_trabalho_arremate ADD CONSTRAINT uq_sessoes_arremate_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_tempos_arremate_empresa_id') THEN
        ALTER TABLE tempos_padrao_arremate ADD CONSTRAINT uq_tempos_arremate_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_log_assinaturas_empresa_id') THEN
        ALTER TABLE log_assinaturas ADD CONSTRAINT uq_log_assinaturas_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_log_divergencias_empresa_id') THEN
        ALTER TABLE log_divergencias ADD CONSTRAINT uq_log_divergencias_empresa_id UNIQUE (empresa_id, id);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_arremates_empresa') THEN
        ALTER TABLE arremates ADD CONSTRAINT fk_arremates_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_arremates_produto_empresa') THEN
        ALTER TABLE arremates ADD CONSTRAINT fk_arremates_produto_empresa
            FOREIGN KEY (empresa_id, produto_id) REFERENCES produtos(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_arremates_op_empresa') THEN
        ALTER TABLE arremates ADD CONSTRAINT fk_arremates_op_empresa
            FOREIGN KEY (empresa_id, op_numero) REFERENCES ordens_de_producao(empresa_id, numero) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_arremates_usuario_empresa') THEN
        ALTER TABLE arremates ADD CONSTRAINT fk_arremates_usuario_empresa
            FOREIGN KEY (usuario_tiktik_id, empresa_id) REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_arremates_perda_empresa') THEN
        ALTER TABLE arremates ADD CONSTRAINT fk_arremates_perda_empresa
            FOREIGN KEY (empresa_id, id_perda_origem) REFERENCES arremate_perdas(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_arremates_sessao_empresa') THEN
        ALTER TABLE arremates ADD CONSTRAINT fk_arremates_sessao_empresa
            FOREIGN KEY (empresa_id, id_sessao_origem) REFERENCES sessoes_trabalho_arremate(empresa_id, id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_arremate_perdas_empresa') THEN
        ALTER TABLE arremate_perdas ADD CONSTRAINT fk_arremate_perdas_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessoes_arremate_empresa') THEN
        ALTER TABLE sessoes_trabalho_arremate ADD CONSTRAINT fk_sessoes_arremate_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessoes_arremate_produto_empresa') THEN
        ALTER TABLE sessoes_trabalho_arremate ADD CONSTRAINT fk_sessoes_arremate_produto_empresa
            FOREIGN KEY (empresa_id, produto_id) REFERENCES produtos(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessoes_arremate_op_empresa') THEN
        ALTER TABLE sessoes_trabalho_arremate ADD CONSTRAINT fk_sessoes_arremate_op_empresa
            FOREIGN KEY (empresa_id, op_numero) REFERENCES ordens_de_producao(empresa_id, numero) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessoes_arremate_usuario_empresa') THEN
        ALTER TABLE sessoes_trabalho_arremate ADD CONSTRAINT fk_sessoes_arremate_usuario_empresa
            FOREIGN KEY (usuario_tiktik_id, empresa_id) REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessoes_arremate_gerado_empresa') THEN
        ALTER TABLE sessoes_trabalho_arremate ADD CONSTRAINT fk_sessoes_arremate_gerado_empresa
            FOREIGN KEY (empresa_id, id_arremate_gerado) REFERENCES arremates(empresa_id, id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tempos_arremate_empresa') THEN
        ALTER TABLE tempos_padrao_arremate ADD CONSTRAINT fk_tempos_arremate_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tempos_arremate_produto_empresa') THEN
        ALTER TABLE tempos_padrao_arremate ADD CONSTRAINT fk_tempos_arremate_produto_empresa
            FOREIGN KEY (empresa_id, produto_id) REFERENCES produtos(empresa_id, id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_log_assinaturas_empresa') THEN
        ALTER TABLE log_assinaturas ADD CONSTRAINT fk_log_assinaturas_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_log_assinaturas_arremate_empresa') THEN
        ALTER TABLE log_assinaturas ADD CONSTRAINT fk_log_assinaturas_arremate_empresa
            FOREIGN KEY (empresa_id, id_arremate) REFERENCES arremates(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_log_assinaturas_producao_empresa') THEN
        ALTER TABLE log_assinaturas ADD CONSTRAINT fk_log_assinaturas_producao_empresa
            FOREIGN KEY (empresa_id, id_producao) REFERENCES producoes(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_log_assinaturas_usuario_empresa') THEN
        ALTER TABLE log_assinaturas ADD CONSTRAINT fk_log_assinaturas_usuario_empresa
            FOREIGN KEY (id_usuario, empresa_id) REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_log_divergencias_empresa') THEN
        ALTER TABLE log_divergencias ADD CONSTRAINT fk_log_divergencias_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_log_divergencias_arremate_empresa') THEN
        ALTER TABLE log_divergencias ADD CONSTRAINT fk_log_divergencias_arremate_empresa
            FOREIGN KEY (empresa_id, id_arremate_original) REFERENCES arremates(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_log_divergencias_producao_empresa') THEN
        ALTER TABLE log_divergencias ADD CONSTRAINT fk_log_divergencias_producao_empresa
            FOREIGN KEY (empresa_id, id_producao_original) REFERENCES producoes(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_log_divergencias_reportou_empresa') THEN
        ALTER TABLE log_divergencias ADD CONSTRAINT fk_log_divergencias_reportou_empresa
            FOREIGN KEY (id_usuario_reportou, empresa_id) REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_log_divergencias_resolveu_empresa') THEN
        ALTER TABLE log_divergencias ADD CONSTRAINT fk_log_divergencias_resolveu_empresa
            FOREIGN KEY (id_usuario_resolveu, empresa_id) REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_arremates_empresa_data
    ON arremates (empresa_id, data_lancamento DESC);
CREATE INDEX IF NOT EXISTS idx_arremates_empresa_op
    ON arremates (empresa_id, op_numero);
CREATE INDEX IF NOT EXISTS idx_arremates_empresa_produto_variante
    ON arremates (empresa_id, produto_id, variante);
CREATE INDEX IF NOT EXISTS idx_arremates_empresa_usuario_data
    ON arremates (empresa_id, usuario_tiktik_id, data_lancamento DESC);
CREATE INDEX IF NOT EXISTS idx_arremate_perdas_empresa_data
    ON arremate_perdas (empresa_id, data_registro DESC);
CREATE INDEX IF NOT EXISTS idx_sessoes_arremate_empresa_status
    ON sessoes_trabalho_arremate (empresa_id, status, data_inicio DESC);
CREATE INDEX IF NOT EXISTS idx_sessoes_arremate_empresa_usuario
    ON sessoes_trabalho_arremate (empresa_id, usuario_tiktik_id, status);
CREATE INDEX IF NOT EXISTS idx_sessoes_arremate_empresa_produto_variante
    ON sessoes_trabalho_arremate (empresa_id, produto_id, variante);
CREATE INDEX IF NOT EXISTS idx_tempos_arremate_empresa_produto
    ON tempos_padrao_arremate (empresa_id, produto_id);
CREATE INDEX IF NOT EXISTS idx_log_assinaturas_empresa_data
    ON log_assinaturas (empresa_id, timestamp_assinatura DESC);
CREATE INDEX IF NOT EXISTS idx_log_divergencias_empresa_data
    ON log_divergencias (empresa_id, data_reporte DESC);

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'multiempresas-fase8-arremates-v1',
    'Migracao aditivo de Arremates, sessões, perdas, tempos e logs para a Fase 8 multiempresas',
    jsonb_build_object(
        'empresa_legada', 'lojas-variara',
        'tabelas', jsonb_build_array('arremates', 'arremate_perdas', 'sessoes_trabalho_arremate', 'tempos_padrao_arremate', 'log_assinaturas', 'log_divergencias'),
        'backfill', 'op_produto_vinculo_empresa_legada',
        'orphans_preservados', TRUE,
        'escopo', 'producao'
    )
)
ON CONFLICT (id) DO UPDATE
SET descricao = EXCLUDED.descricao,
    detalhes = EXCLUDED.detalhes,
    executada_em = NOW();

COMMIT;

BEGIN;

DO $$
DECLARE
    empresa_legada_id INTEGER;
BEGIN
    SELECT id
      INTO empresa_legada_id
      FROM empresas
     WHERE codigo = 'lojas-variara'
       AND eh_legada = TRUE;

    IF empresa_legada_id IS NULL THEN
        RAISE EXCEPTION 'A empresa legada lojas-variara nao foi encontrada.';
    END IF;
END
$$;

ALTER TABLE embalagens_realizadas
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE embalagens_realizadas
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

UPDATE embalagens_realizadas er
   SET empresa_id = COALESCE(
       (SELECT p.empresa_id
          FROM produtos p
         WHERE p.id = er.produto_embalado_id),
       (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
   )
 WHERE er.empresa_id IS NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM embalagens_realizadas WHERE empresa_id IS NULL) THEN
        RAISE EXCEPTION 'Backfill empresarial incompleto em embalagens_realizadas.';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM embalagens_realizadas er
          JOIN produtos p ON p.id = er.produto_embalado_id
         WHERE p.empresa_id IS NULL OR p.empresa_id <> er.empresa_id
    ) THEN
        RAISE EXCEPTION 'Embalagem e produto embalado possuem empresas diferentes.';
    END IF;
END
$$;

ALTER TABLE embalagens_realizadas
    ALTER COLUMN empresa_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_embalagens_realizadas_empresa_id'
    ) THEN
        ALTER TABLE embalagens_realizadas
            ADD CONSTRAINT uq_embalagens_realizadas_empresa_id UNIQUE (empresa_id, id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_embalagens_realizadas_empresa'
    ) THEN
        ALTER TABLE embalagens_realizadas
            ADD CONSTRAINT fk_embalagens_realizadas_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_embalagens_realizadas_produto_empresa'
    ) THEN
        ALTER TABLE embalagens_realizadas
            ADD CONSTRAINT fk_embalagens_realizadas_produto_empresa
            FOREIGN KEY (empresa_id, produto_embalado_id)
            REFERENCES produtos(empresa_id, id) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_embalagens_realizadas_usuario_empresa'
    ) THEN
        ALTER TABLE embalagens_realizadas
            ADD CONSTRAINT fk_embalagens_realizadas_usuario_empresa
            FOREIGN KEY (usuario_responsavel_id, empresa_id)
            REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_embalagens_empresa_data
    ON embalagens_realizadas (empresa_id, data_embalagem DESC);
CREATE INDEX IF NOT EXISTS idx_embalagens_empresa_produto_ref
    ON embalagens_realizadas (empresa_id, produto_ref_id, status);
CREATE INDEX IF NOT EXISTS idx_embalagens_empresa_movimento
    ON embalagens_realizadas (empresa_id, movimento_estoque_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_embalagens_empresa_idempotency
    ON embalagens_realizadas (empresa_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'multiempresas-fase8-embalagem-v1',
    'Migracao aditivo de embalagens realizadas para a Fase 8 multiempresas',
    jsonb_build_object(
        'empresa_legada', 'lojas-variara',
        'tabela', 'embalagens_realizadas',
        'idempotencia', '(empresa_id, idempotency_key) quando informado',
        'backfill', 'produto_embalado_empresa_legada',
        'movimento_estoque_empresa', 'pendente_no_bloco_estoque',
        'escopo', 'producao'
    )
)
ON CONFLICT (id) DO UPDATE
SET descricao = EXCLUDED.descricao,
    detalhes = EXCLUDED.detalhes,
    executada_em = NOW();

COMMIT;

BEGIN;

DO $$
DECLARE
    empresa_legada_id INTEGER;
BEGIN
    SELECT id INTO empresa_legada_id
      FROM empresas
     WHERE codigo = 'lojas-variara' AND eh_legada = TRUE;
    IF empresa_legada_id IS NULL THEN
        RAISE EXCEPTION 'A empresa legada lojas-variara nao foi encontrada.';
    END IF;
END
$$;

ALTER TABLE estoque_movimentos
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE estoque_itens_arquivados
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE produto_niveis_estoque_alerta
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE inventario_sessoes
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE inventario_itens
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;
ALTER TABLE log_montagem_kits
    ADD COLUMN IF NOT EXISTS empresa_id INTEGER;

UPDATE estoque_movimentos em
   SET empresa_id = COALESCE(
       (SELECT p.empresa_id FROM produtos p WHERE p.id = em.produto_id),
       (SELECT a.empresa_id FROM arremates a WHERE a.id = em.origem_arremate_id),
       (SELECT er.empresa_id
          FROM embalagens_realizadas er
         WHERE er.movimento_estoque_id = em.id),
       (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
   )
 WHERE em.empresa_id IS NULL;

UPDATE estoque_itens_arquivados aia
   SET empresa_id = COALESCE((
       SELECT MIN(x.empresa_id)
         FROM (
             SELECT p.empresa_id
               FROM produtos p
              WHERE p.sku = aia.produto_ref_id
             UNION
             SELECT p.empresa_id
               FROM produtos p
               CROSS JOIN LATERAL jsonb_to_recordset(COALESCE(p.grade, '[]'::jsonb))
                    AS g(sku TEXT, variacao TEXT, imagem TEXT)
              WHERE g.sku = aia.produto_ref_id
         ) x
   ), (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE))
 WHERE aia.empresa_id IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'produto_niveis_estoque_alerta'::regclass
           AND tgname = 'set_produto_niveis_estoque_alerta_atualizado_em'
           AND NOT tgisinternal
    ) THEN
        ALTER TABLE produto_niveis_estoque_alerta
            DISABLE TRIGGER set_produto_niveis_estoque_alerta_atualizado_em;
    END IF;
END
$$;

UPDATE produto_niveis_estoque_alerta pnea
   SET empresa_id = COALESCE((
       SELECT MIN(x.empresa_id)
         FROM (
             SELECT p.empresa_id
               FROM produtos p
              WHERE p.sku = pnea.produto_ref_id
             UNION
             SELECT p.empresa_id
               FROM produtos p
               CROSS JOIN LATERAL jsonb_to_recordset(COALESCE(p.grade, '[]'::jsonb))
                    AS g(sku TEXT, variacao TEXT, imagem TEXT)
              WHERE g.sku = pnea.produto_ref_id
         ) x
   ), (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE))
 WHERE pnea.empresa_id IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'produto_niveis_estoque_alerta'::regclass
           AND tgname = 'set_produto_niveis_estoque_alerta_atualizado_em'
           AND NOT tgisinternal
    ) THEN
        ALTER TABLE produto_niveis_estoque_alerta
            ENABLE TRIGGER set_produto_niveis_estoque_alerta_atualizado_em;
    END IF;
END
$$;

UPDATE inventario_sessoes s
   SET empresa_id = COALESCE(
       (
           SELECT MIN(p.empresa_id)
             FROM inventario_itens ii
             JOIN produtos p ON p.sku = ii.produto_ref_id
            WHERE ii.id_sessao_inventario = s.id
       ),
       (
           SELECT MIN(ue.empresa_id)
             FROM usuarios_empresas ue
            WHERE ue.usuario_id = s.usuario_responsavel_id
              AND ue.ativo = TRUE
            GROUP BY ue.usuario_id
           HAVING COUNT(DISTINCT ue.empresa_id) = 1
       ),
       (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
   )
 WHERE s.empresa_id IS NULL;

UPDATE inventario_itens ii
   SET empresa_id = s.empresa_id
  FROM inventario_sessoes s
 WHERE s.id = ii.id_sessao_inventario
   AND ii.empresa_id IS NULL;

UPDATE log_montagem_kits lm
   SET empresa_id = COALESCE(
       (
           SELECT MIN(ue.empresa_id)
             FROM usuarios_empresas ue
            WHERE ue.usuario_id = lm.usuario_id
              AND ue.ativo = TRUE
            GROUP BY ue.usuario_id
           HAVING COUNT(DISTINCT ue.empresa_id) = 1
       ),
       (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)
   )
 WHERE lm.empresa_id IS NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM estoque_movimentos WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM estoque_itens_arquivados WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM produto_niveis_estoque_alerta WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM inventario_sessoes WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM inventario_itens WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM log_montagem_kits WHERE empresa_id IS NULL) THEN
        RAISE EXCEPTION 'Backfill empresarial incompleto no bloco de Estoque/Inventario.';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM estoque_movimentos em
          JOIN produtos p ON p.id = em.produto_id
         WHERE p.empresa_id <> em.empresa_id
    ) OR EXISTS (
        SELECT 1
          FROM estoque_movimentos em
          JOIN arremates a ON a.id = em.origem_arremate_id
         WHERE a.empresa_id <> em.empresa_id
    ) OR EXISTS (
        SELECT 1
          FROM estoque_movimentos em
          JOIN embalagens_realizadas er ON er.movimento_estoque_id = em.id
         WHERE er.empresa_id <> em.empresa_id
    ) THEN
        RAISE EXCEPTION 'Movimento de estoque possui empresa divergente da origem.';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM inventario_itens ii
          JOIN inventario_sessoes s ON s.id = ii.id_sessao_inventario
         WHERE ii.empresa_id <> s.empresa_id
    ) THEN
        RAISE EXCEPTION 'Item de inventario possui empresa divergente da sessao.';
    END IF;
END
$$;

ALTER TABLE estoque_movimentos
    ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE estoque_itens_arquivados
    ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE produto_niveis_estoque_alerta
    ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE inventario_sessoes
    ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE inventario_itens
    ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE log_montagem_kits
    ALTER COLUMN empresa_id SET NOT NULL;

DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT conrelid::regclass AS tabela, conname
          FROM pg_constraint
         WHERE contype = 'u'
           AND conrelid IN ('estoque_itens_arquivados'::regclass, 'produto_niveis_estoque_alerta'::regclass)
           AND pg_get_constraintdef(oid) = 'UNIQUE (produto_ref_id)'
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tabela, c.conname);
    END LOOP;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_estoque_movimentos_empresa_id') THEN
        ALTER TABLE estoque_movimentos ADD CONSTRAINT uq_estoque_movimentos_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_inventario_sessoes_empresa_id') THEN
        ALTER TABLE inventario_sessoes ADD CONSTRAINT uq_inventario_sessoes_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_inventario_itens_empresa_id') THEN
        ALTER TABLE inventario_itens ADD CONSTRAINT uq_inventario_itens_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_estoque_itens_arquivados_empresa_sku') THEN
        ALTER TABLE estoque_itens_arquivados ADD CONSTRAINT uq_estoque_itens_arquivados_empresa_sku UNIQUE (empresa_id, produto_ref_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_produto_niveis_estoque_empresa_sku') THEN
        ALTER TABLE produto_niveis_estoque_alerta ADD CONSTRAINT uq_produto_niveis_estoque_empresa_sku UNIQUE (empresa_id, produto_ref_id);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_estoque_movimentos_empresa') THEN
        ALTER TABLE estoque_movimentos ADD CONSTRAINT fk_estoque_movimentos_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_estoque_movimentos_produto_empresa') THEN
        ALTER TABLE estoque_movimentos ADD CONSTRAINT fk_estoque_movimentos_produto_empresa
            FOREIGN KEY (empresa_id, produto_id) REFERENCES produtos(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_estoque_movimentos_arremate_empresa') THEN
        ALTER TABLE estoque_movimentos ADD CONSTRAINT fk_estoque_movimentos_arremate_empresa
            FOREIGN KEY (empresa_id, origem_arremate_id) REFERENCES arremates(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_estoque_itens_arquivados_empresa') THEN
        ALTER TABLE estoque_itens_arquivados ADD CONSTRAINT fk_estoque_itens_arquivados_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_produto_niveis_estoque_empresa') THEN
        ALTER TABLE produto_niveis_estoque_alerta ADD CONSTRAINT fk_produto_niveis_estoque_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_inventario_sessoes_empresa') THEN
        ALTER TABLE inventario_sessoes ADD CONSTRAINT fk_inventario_sessoes_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_inventario_sessoes_usuario_empresa') THEN
        ALTER TABLE inventario_sessoes ADD CONSTRAINT fk_inventario_sessoes_usuario_empresa
            FOREIGN KEY (usuario_responsavel_id, empresa_id) REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_inventario_itens_empresa') THEN
        ALTER TABLE inventario_itens ADD CONSTRAINT fk_inventario_itens_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_inventario_itens_sessao_empresa') THEN
        ALTER TABLE inventario_itens ADD CONSTRAINT fk_inventario_itens_sessao_empresa
            FOREIGN KEY (empresa_id, id_sessao_inventario) REFERENCES inventario_sessoes(empresa_id, id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_log_montagem_kits_empresa') THEN
        ALTER TABLE log_montagem_kits ADD CONSTRAINT fk_log_montagem_kits_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_log_montagem_kits_usuario_empresa') THEN
        ALTER TABLE log_montagem_kits ADD CONSTRAINT fk_log_montagem_kits_usuario_empresa
            FOREIGN KEY (usuario_id, empresa_id) REFERENCES usuarios_empresas(usuario_id, empresa_id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_embalagens_realizadas_movimento_empresa') THEN
        ALTER TABLE embalagens_realizadas ADD CONSTRAINT fk_embalagens_realizadas_movimento_empresa
            FOREIGN KEY (empresa_id, movimento_estoque_id) REFERENCES estoque_movimentos(empresa_id, id) NOT VALID;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_estoque_movimentos_empresa_produto_variante
    ON estoque_movimentos (empresa_id, produto_id, variante_nome);
CREATE INDEX IF NOT EXISTS idx_estoque_movimentos_empresa_data
    ON estoque_movimentos (empresa_id, data_movimento DESC);
CREATE INDEX IF NOT EXISTS idx_estoque_movimentos_empresa_origem
    ON estoque_movimentos (empresa_id, origem_arremate_id);
CREATE INDEX IF NOT EXISTS idx_estoque_movimentos_empresa_tipo
    ON estoque_movimentos (empresa_id, tipo_movimento);
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_movimentos_empresa_idempotency
    ON estoque_movimentos (empresa_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_estoque_arquivados_empresa
    ON estoque_itens_arquivados (empresa_id, produto_ref_id);
CREATE INDEX IF NOT EXISTS idx_niveis_estoque_empresa_ativo_prioridade
    ON produto_niveis_estoque_alerta (empresa_id, ativo, prioridade);
CREATE INDEX IF NOT EXISTS idx_inventario_sessoes_empresa_status
    ON inventario_sessoes (empresa_id, status, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventario_sessoes_empresa_idempotency
    ON inventario_sessoes (empresa_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventario_itens_empresa_sessao_produto
    ON inventario_itens (empresa_id, id_sessao_inventario, produto_ref_id);
CREATE INDEX IF NOT EXISTS idx_log_montagem_kits_empresa_data
    ON log_montagem_kits (empresa_id, data_montagem DESC);

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'multiempresas-fase8-estoque-v1',
    'Migracao aditivo de Estoque e Inventario para a Fase 8 multiempresas',
    jsonb_build_object(
        'empresa_legada', 'lojas-variara',
        'tabelas', jsonb_build_array(
            'estoque_movimentos', 'estoque_itens_arquivados',
            'produto_niveis_estoque_alerta', 'inventario_sessoes',
            'inventario_itens', 'log_montagem_kits'
        ),
        'idempotencia_movimentos', '(empresa_id, idempotency_key) quando informado',
        'auditoria_eventos', 'pendente_no_bloco_transversal',
        'escopo', 'producao'
    )
)
ON CONFLICT (id) DO UPDATE
SET descricao = EXCLUDED.descricao,
    detalhes = EXCLUDED.detalhes,
    executada_em = NOW();

COMMIT;

BEGIN;

DO $$
DECLARE
    empresa_legada integer;
    quantidade_legadas integer;
BEGIN
    SELECT COUNT(*), MIN(id)
      INTO quantidade_legadas, empresa_legada
      FROM empresas
     WHERE eh_legada = TRUE
       AND ativa = TRUE;

    IF quantidade_legadas <> 1 THEN
        RAISE EXCEPTION 'Esperada exatamente uma empresa legada ativa; encontradas %', quantidade_legadas;
    END IF;

    ALTER TABLE eventos_sistema ADD COLUMN IF NOT EXISTS empresa_id integer;
    UPDATE eventos_sistema
       SET empresa_id = empresa_legada
     WHERE empresa_id IS NULL;
    ALTER TABLE eventos_sistema ALTER COLUMN empresa_id SET NOT NULL;

    ALTER TABLE historico_alertas ADD COLUMN IF NOT EXISTS empresa_id integer;
    UPDATE historico_alertas
       SET empresa_id = empresa_legada
     WHERE empresa_id IS NULL;
    ALTER TABLE historico_alertas ALTER COLUMN empresa_id SET NOT NULL;

    ALTER TABLE alertas_configuracoes_gerais ADD COLUMN IF NOT EXISTS empresa_id integer;
    UPDATE alertas_configuracoes_gerais
       SET empresa_id = empresa_legada
     WHERE empresa_id IS NULL;
    ALTER TABLE alertas_configuracoes_gerais ALTER COLUMN empresa_id SET NOT NULL;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'uq_eventos_sistema_empresa_id'
    ) THEN
        ALTER TABLE eventos_sistema
            ADD CONSTRAINT uq_eventos_sistema_empresa_id UNIQUE (empresa_id, id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'uq_historico_alertas_empresa_id'
    ) THEN
        ALTER TABLE historico_alertas
            ADD CONSTRAINT uq_historico_alertas_empresa_id UNIQUE (empresa_id, id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'alertas_configuracoes_gerais_empresa_chave_pkey'
    ) THEN
        ALTER TABLE alertas_configuracoes_gerais
            DROP CONSTRAINT IF EXISTS configuracoes_gerais_pkey;
        ALTER TABLE alertas_configuracoes_gerais
            ADD CONSTRAINT alertas_configuracoes_gerais_empresa_chave_pkey
            PRIMARY KEY (empresa_id, chave);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'fk_eventos_sistema_empresa'
    ) THEN
        ALTER TABLE eventos_sistema
            ADD CONSTRAINT fk_eventos_sistema_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'fk_historico_alertas_empresa'
    ) THEN
        ALTER TABLE historico_alertas
            ADD CONSTRAINT fk_historico_alertas_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'fk_alertas_configuracoes_gerais_empresa'
    ) THEN
        ALTER TABLE alertas_configuracoes_gerais
            ADD CONSTRAINT fk_alertas_configuracoes_gerais_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_eventos_sistema_empresa_pendentes
    ON eventos_sistema (empresa_id, lido, criado_em);

CREATE INDEX IF NOT EXISTS idx_historico_alertas_empresa_disparado
    ON historico_alertas (empresa_id, disparado_em DESC);

CREATE INDEX IF NOT EXISTS idx_alertas_configuracoes_gerais_empresa
    ON alertas_configuracoes_gerais (empresa_id, chave);

CREATE TABLE IF NOT EXISTS configuracoes_alertas_empresas (
    id serial PRIMARY KEY,
    empresa_id integer NOT NULL,
    configuracao_id integer NOT NULL,
    ativo boolean NOT NULL DEFAULT TRUE,
    gatilho_minutos integer NOT NULL DEFAULT 5,
    acao_popup boolean NOT NULL DEFAULT TRUE,
    acao_notificacao boolean NOT NULL DEFAULT FALSE,
    intervalo_repeticao_minutos integer NOT NULL DEFAULT 15,
    peso_risco integer NOT NULL DEFAULT 0,
    atualizado_em timestamptz DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_config_alertas_empresas_empresa_config UNIQUE (empresa_id, configuracao_id)
);

DO $$
DECLARE
    empresa_legada integer;
BEGIN
    SELECT id INTO empresa_legada
      FROM empresas
     WHERE eh_legada = TRUE
       AND ativa = TRUE
     ORDER BY id
     LIMIT 1;

    INSERT INTO configuracoes_alertas_empresas
        (empresa_id, configuracao_id, ativo, gatilho_minutos,
         acao_popup, acao_notificacao, intervalo_repeticao_minutos,
         peso_risco, atualizado_em)
    SELECT empresa_legada, c.id, c.ativo, c.gatilho_minutos,
           c.acao_popup, c.acao_notificacao, c.intervalo_repeticao_minutos,
           COALESCE(c.peso_risco, 0), COALESCE(c.atualizado_em, CURRENT_TIMESTAMP)
      FROM configuracoes_alertas c
    ON CONFLICT (empresa_id, configuracao_id) DO NOTHING;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'fk_config_alertas_empresas_empresa'
    ) THEN
        ALTER TABLE configuracoes_alertas_empresas
            ADD CONSTRAINT fk_config_alertas_empresas_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'fk_config_alertas_empresas_configuracao'
    ) THEN
        ALTER TABLE configuracoes_alertas_empresas
            ADD CONSTRAINT fk_config_alertas_empresas_configuracao
            FOREIGN KEY (configuracao_id) REFERENCES configuracoes_alertas(id) NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_config_alertas_empresas_empresa
    ON configuracoes_alertas_empresas (empresa_id, configuracao_id);

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'multiempresas-fase8-alertas-v1',
    'Migracao local de eventos, historico e configuracoes empresariais de alertas',
    jsonb_build_object(
        'escopo', 'cron-alertas',
        'catalogo_global', 'configuracoes_alertas',
        'parametros_empresariais', 'configuracoes_alertas_empresas',
        'ambiente', 'neon-producao'
    )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;

BEGIN;

DO $$
DECLARE
    empresa_legada integer;
    quantidade_legadas integer;
BEGIN
    SELECT COUNT(*), MIN(id)
      INTO quantidade_legadas, empresa_legada
      FROM empresas
     WHERE eh_legada = TRUE
       AND ativa = TRUE;

    IF quantidade_legadas <> 1 THEN
        RAISE EXCEPTION 'Esperada exatamente uma empresa legada ativa; encontradas %', quantidade_legadas;
    END IF;

    ALTER TABLE comissoes_pagas ADD COLUMN IF NOT EXISTS empresa_id integer;
    UPDATE comissoes_pagas cp
       SET empresa_id = COALESCE(
           (
               SELECT ue.empresa_id
                 FROM usuarios_empresas ue
                 JOIN empresas e ON e.id = ue.empresa_id
                WHERE ue.usuario_id = cp.usuario_id
                  AND ue.ativo
                  AND e.ativa
                ORDER BY e.eh_legada DESC, ue.empresa_principal DESC, ue.id
                LIMIT 1
           ),
           empresa_legada
       )
     WHERE cp.empresa_id IS NULL;

    ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS empresa_id integer;
    UPDATE audit_log al
       SET empresa_id = COALESCE(
           CASE
               WHEN al.detalhes->>'empresa_id' ~ '^[0-9]+$'
               THEN (al.detalhes->>'empresa_id')::integer
           END,
           (
               SELECT ue.empresa_id
                 FROM usuarios_empresas ue
                 JOIN empresas e ON e.id = ue.empresa_id
                WHERE ue.usuario_id = al.usuario_id
                  AND ue.ativo
                  AND e.ativa
                ORDER BY e.eh_legada DESC, ue.empresa_principal DESC, ue.id
                LIMIT 1
           ),
           empresa_legada
       )
     WHERE al.empresa_id IS NULL;

    ALTER TABLE auditoria_eventos ADD COLUMN IF NOT EXISTS empresa_id integer;
    UPDATE auditoria_eventos ae
       SET empresa_id = COALESCE(
           CASE
               WHEN ae.detalhes->>'empresa_id' ~ '^[0-9]+$'
               THEN (ae.detalhes->>'empresa_id')::integer
           END,
           (
               SELECT ue.empresa_id
                 FROM usuarios_empresas ue
                 JOIN empresas e ON e.id = ue.empresa_id
                WHERE ue.usuario_id = ae.usuario_id
                  AND ue.ativo
                  AND e.ativa
                ORDER BY e.eh_legada DESC, ue.empresa_principal DESC, ue.id
                LIMIT 1
           ),
           empresa_legada
       )
     WHERE ae.empresa_id IS NULL;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM comissoes_pagas WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM audit_log WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM auditoria_eventos WHERE empresa_id IS NULL) THEN
        RAISE EXCEPTION 'Backfill transversal deixou empresa_id nulo';
    END IF;
END $$;

ALTER TABLE comissoes_pagas ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE auditoria_eventos ALTER COLUMN empresa_id SET NOT NULL;

DO $$
BEGIN
    ALTER TABLE comissoes_pagas
        DROP CONSTRAINT IF EXISTS comissoes_pagas_costureira_nome_ciclo_nome_key;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_comissoes_pagas_empresa_costureira_ciclo'
    ) THEN
        ALTER TABLE comissoes_pagas
            ADD CONSTRAINT uq_comissoes_pagas_empresa_costureira_ciclo
            UNIQUE (empresa_id, costureira_nome, ciclo_nome);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_comissoes_pagas_empresa_id'
    ) THEN
        ALTER TABLE comissoes_pagas
            ADD CONSTRAINT uq_comissoes_pagas_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_audit_log_empresa_id'
    ) THEN
        ALTER TABLE audit_log
            ADD CONSTRAINT uq_audit_log_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_auditoria_eventos_empresa_id'
    ) THEN
        ALTER TABLE auditoria_eventos
            ADD CONSTRAINT uq_auditoria_eventos_empresa_id UNIQUE (empresa_id, id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_comissoes_pagas_empresa'
    ) THEN
        ALTER TABLE comissoes_pagas
            ADD CONSTRAINT fk_comissoes_pagas_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_audit_log_empresa'
    ) THEN
        ALTER TABLE audit_log
            ADD CONSTRAINT fk_audit_log_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_auditoria_eventos_empresa'
    ) THEN
        ALTER TABLE auditoria_eventos
            ADD CONSTRAINT fk_auditoria_eventos_empresa
            FOREIGN KEY (empresa_id) REFERENCES empresas(id) NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comissoes_pagas_empresa_usuario
    ON comissoes_pagas (empresa_id, usuario_id, data_pagamento_efetivo DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_empresa_criado
    ON audit_log (empresa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_empresa_usuario
    ON audit_log (empresa_id, usuario_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_empresa_data
    ON auditoria_eventos (empresa_id, data_evento DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_empresa_usuario
    ON auditoria_eventos (empresa_id, usuario_id, data_evento DESC);

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'multiempresas-fase8-transversais-v1',
    'Migracao local dos consumidores transversais restantes',
    jsonb_build_object(
        'tabelas', jsonb_build_array('comissoes_pagas', 'audit_log', 'auditoria_eventos'),
        'fallback_backfill', 'empresa_legada',
        'ambiente', 'neon-producao'
    )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;

BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM produtos WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM demandas_producao WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM demandas_componentes_atribuidos WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM ordens_de_producao WHERE empresa_id IS NULL)
       OR EXISTS (SELECT 1 FROM cortes WHERE empresa_id IS NULL) THEN
        RAISE EXCEPTION 'Finalizacao interrompida: ha registros sem empresa_id.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM produtos
        GROUP BY empresa_id, nome
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Finalizacao interrompida: nome de produto duplicado dentro da mesma empresa.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM demandas_componentes_atribuidos
        GROUP BY empresa_id, componente_chave
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Finalizacao interrompida: componente_chave duplicada dentro da mesma empresa.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM ordens_de_producao
        GROUP BY empresa_id, numero
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Finalizacao interrompida: numero de OP duplicado dentro da mesma empresa.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM ordens_de_producao
        WHERE edit_id IS NOT NULL
        GROUP BY empresa_id, edit_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Finalizacao interrompida: edit_id de OP duplicado dentro da mesma empresa.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM cortes
        GROUP BY empresa_id, pn
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Finalizacao interrompida: PN de corte duplicado dentro da mesma empresa.';
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_empresa_nome
    ON produtos (empresa_id, nome);
CREATE UNIQUE INDEX IF NOT EXISTS uq_demandas_componentes_empresa_chave
    ON demandas_componentes_atribuidos (empresa_id, componente_chave);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_ops_empresa_numero'
    ) THEN
        ALTER TABLE ordens_de_producao
            ADD CONSTRAINT uq_ops_empresa_numero UNIQUE (empresa_id, numero);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_ops_empresa_edit_id'
    ) THEN
        ALTER TABLE ordens_de_producao
            ADD CONSTRAINT uq_ops_empresa_edit_id UNIQUE (empresa_id, edit_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_cortes_empresa_pn'
    ) THEN
        ALTER TABLE cortes
            ADD CONSTRAINT uq_cortes_empresa_pn UNIQUE (empresa_id, pn);
    END IF;
END
$$;

ALTER TABLE demandas_componentes_atribuidos
    DROP CONSTRAINT IF EXISTS demandas_componentes_atribuidos_componente_chave_key;
ALTER TABLE produtos
    DROP CONSTRAINT IF EXISTS produtos_nome_key;
ALTER TABLE ordens_de_producao
    DROP CONSTRAINT IF EXISTS numero_op_unico,
    DROP CONSTRAINT IF EXISTS ordens_de_producao_numero_key,
    DROP CONSTRAINT IF EXISTS ordens_de_producao_edit_id_key;
ALTER TABLE cortes
    DROP CONSTRAINT IF EXISTS cortes_pn_key,
    DROP CONSTRAINT IF EXISTS cortes_pn_unique;

ALTER TABLE produtos
    ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE demandas_producao
    ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE demandas_componentes_atribuidos
    ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE ordens_de_producao
    ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE cortes
    ALTER COLUMN empresa_id SET NOT NULL;

INSERT INTO sistema_migrations (id, descricao, detalhes)
VALUES (
    'multiempresas-fase8-finalizacao-chaves-empresariais-v1',
    'Finalizacao local das chaves empresariais da cadeia produtiva na Fase 8',
    jsonb_build_object(
        'empresa_id_obrigatorio', TRUE,
        'constraints_legadas_preservadas', FALSE,
        'unicidades_globais_removidas', ARRAY[
            'demandas_componentes_atribuidos_componente_chave_key',
            'produtos_nome_key',
            'numero_op_unico',
            'ordens_de_producao_numero_key',
            'ordens_de_producao_edit_id_key',
            'cortes_pn_key',
            'cortes_pn_unique'
        ],
        'escopo', 'producao'
    )
)
ON CONFLICT (id) DO UPDATE
SET descricao = EXCLUDED.descricao,
    detalhes = EXCLUDED.detalhes,
    executada_em = NOW();

COMMIT;
