BEGIN READ ONLY;

WITH colunas AS (
    SELECT
        COUNT(*)::INTEGER AS total,
        COUNT(*) FILTER (WHERE is_nullable = 'YES')::INTEGER AS anulaveis
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_name = 'empresa_id'
       AND table_name = ANY (ARRAY[
           'ponto_diario',
           'sessoes_trabalho_producao',
           'historico_pagamentos_funcionarios',
           'registro_dias_trabalhados',
           'recibos_conferencia',
           'banco_pontos_saldo',
           'banco_pontos_log',
           'pontos_extras',
           'configuracoes_pontos_processos',
           'metas_versoes',
           'metas_regras',
           'gincanas',
           'gincanas_premiacoes',
           'gincanas_premios_ganhos',
           'avisos_popup',
           'avisos_popup_visualizacoes',
           'calendario_empresa'
       ])
),
constraints_empresa AS (
    SELECT
        COUNT(*)::INTEGER AS total,
        COUNT(*) FILTER (WHERE NOT convalidated)::INTEGER AS nao_validadas
      FROM pg_constraint
     WHERE conname = ANY (ARRAY[
         'fk_ponto_diario_empresa',
         'fk_sessoes_trabalho_empresa',
         'fk_hist_pag_empresa',
         'fk_registro_dias_empresa',
         'fk_recibos_empresa',
         'fk_banco_saldo_empresa',
         'fk_banco_log_empresa',
         'fk_pontos_extras_empresa',
         'fk_config_pontos_empresa',
         'fk_metas_versoes_empresa',
         'fk_metas_regras_empresa',
         'fk_gincanas_empresa',
         'fk_gincanas_prem_empresa',
         'fk_gincanas_ganhos_empresa',
         'fk_avisos_empresa',
         'fk_avisos_visual_empresa',
         'fk_calendario_empresa'
     ])
),
constraints_relacoes AS (
    SELECT
        COUNT(*)::INTEGER AS total,
        COUNT(*) FILTER (WHERE NOT convalidated)::INTEGER AS nao_validadas
      FROM pg_constraint
     WHERE conname = ANY (ARRAY[
         'fk_ponto_func_empresa',
         'fk_sessoes_func_empresa',
         'fk_hist_pag_usuario_empresa',
         'fk_hist_pag_conta_empresa',
         'fk_registro_dias_usuario_empresa',
         'fk_registro_dias_pag_empresa',
         'fk_recibos_usuario_empresa',
         'fk_banco_saldo_usuario_empresa',
         'fk_banco_log_usuario_empresa',
         'fk_pontos_extras_func_empresa',
         'fk_metas_regras_versao_empresa',
         'fk_gincanas_prem_pai_empresa',
         'fk_gincanas_ganhos_usuario_empresa',
         'fk_gincanas_ganhos_pai_empresa',
         'fk_avisos_visual_usuario_empresa',
         'fk_avisos_visual_pai_empresa',
         'fk_calendario_func_empresa'
     ])
),
uniques_ids_empresariais AS (
    SELECT COUNT(*)::INTEGER AS total
      FROM pg_constraint
     WHERE conname = ANY (ARRAY[
         'uq_ponto_diario_empresa_id',
         'uq_sessoes_trabalho_empresa_id',
         'uq_hist_pag_empresa_id',
         'uq_registro_dias_empresa_id',
         'uq_recibos_empresa_id',
         'uq_banco_saldo_empresa_id',
         'uq_banco_log_empresa_id',
         'uq_pontos_extras_empresa_id',
         'uq_config_pontos_empresa_id',
         'uq_metas_versoes_empresa_id',
         'uq_metas_regras_empresa_id',
         'uq_gincanas_empresa_id',
         'uq_gincanas_prem_empresa_id',
         'uq_gincanas_ganhos_empresa_id',
         'uq_avisos_popup_empresa_id',
         'uq_avisos_visual_empresa_id',
         'uq_calendario_empresa_id_empresa'
     ])
),
uniques_empresariais AS (
    SELECT COUNT(*)::INTEGER AS total
      FROM pg_constraint
     WHERE conname = ANY (ARRAY[
         'uq_ponto_empresa_func_data',
         'uq_registro_empresa_usuario_data',
         'uq_banco_saldo_empresa_usuario',
         'uq_config_pontos_empresa_prod_proc_tipo',
         'uq_avisos_visual_empresa_aviso_usuario'
     ])
),
linhas_sem_empresa AS (
    SELECT
        (SELECT COUNT(*) FROM ponto_diario WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM sessoes_trabalho_producao WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM historico_pagamentos_funcionarios WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM registro_dias_trabalhados WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM recibos_conferencia WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM banco_pontos_saldo WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM banco_pontos_log WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM pontos_extras WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM configuracoes_pontos_processos WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM metas_versoes WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM metas_regras WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM gincanas WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM gincanas_premiacoes WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM gincanas_premios_ganhos WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM avisos_popup WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM avisos_popup_visualizacoes WHERE empresa_id IS NULL)
      + (SELECT COUNT(*) FROM calendario_empresa WHERE empresa_id IS NULL)
        AS total
),
divergencias_vinculos AS (
    SELECT
        (SELECT COUNT(*)
           FROM ponto_diario dado
          WHERE NOT EXISTS (
              SELECT 1 FROM usuarios_empresas ue
               WHERE ue.usuario_id = dado.funcionario_id
                 AND ue.empresa_id = dado.empresa_id
          ))
      + (SELECT COUNT(*)
           FROM sessoes_trabalho_producao dado
          WHERE NOT EXISTS (
              SELECT 1 FROM usuarios_empresas ue
               WHERE ue.usuario_id = dado.funcionario_id
                 AND ue.empresa_id = dado.empresa_id
          ))
      + (SELECT COUNT(*)
           FROM historico_pagamentos_funcionarios dado
          WHERE NOT EXISTS (
              SELECT 1 FROM usuarios_empresas ue
               WHERE ue.usuario_id = dado.usuario_id
                 AND ue.empresa_id = dado.empresa_id
          ))
      + (SELECT COUNT(*)
           FROM registro_dias_trabalhados dado
          WHERE NOT EXISTS (
              SELECT 1 FROM usuarios_empresas ue
               WHERE ue.usuario_id = dado.usuario_id
                 AND ue.empresa_id = dado.empresa_id
          ))
      + (SELECT COUNT(*)
           FROM recibos_conferencia dado
          WHERE dado.usuario_id IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM usuarios_empresas ue
                 WHERE ue.usuario_id = dado.usuario_id
                   AND ue.empresa_id = dado.empresa_id
            ))
      + (SELECT COUNT(*)
           FROM banco_pontos_saldo dado
          WHERE NOT EXISTS (
              SELECT 1 FROM usuarios_empresas ue
               WHERE ue.usuario_id = dado.usuario_id
                 AND ue.empresa_id = dado.empresa_id
          ))
      + (SELECT COUNT(*)
           FROM banco_pontos_log dado
          WHERE NOT EXISTS (
              SELECT 1 FROM usuarios_empresas ue
               WHERE ue.usuario_id = dado.usuario_id
                 AND ue.empresa_id = dado.empresa_id
          ))
      + (SELECT COUNT(*)
           FROM pontos_extras dado
          WHERE NOT EXISTS (
              SELECT 1 FROM usuarios_empresas ue
               WHERE ue.usuario_id = dado.funcionario_id
                 AND ue.empresa_id = dado.empresa_id
          ))
      + (SELECT COUNT(*)
           FROM gincanas_premios_ganhos dado
          WHERE NOT EXISTS (
              SELECT 1 FROM usuarios_empresas ue
               WHERE ue.usuario_id = dado.usuario_id
                 AND ue.empresa_id = dado.empresa_id
          ))
      + (SELECT COUNT(*)
           FROM avisos_popup_visualizacoes dado
          WHERE NOT EXISTS (
              SELECT 1 FROM usuarios_empresas ue
               WHERE ue.usuario_id = dado.usuario_id
                 AND ue.empresa_id = dado.empresa_id
          ))
      + (SELECT COUNT(*)
           FROM calendario_empresa dado
          WHERE dado.funcionario_id IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM usuarios_empresas ue
                 WHERE ue.usuario_id = dado.funcionario_id
                   AND ue.empresa_id = dado.empresa_id
            ))
        AS total
),
divergencias_relacoes AS (
    SELECT
        (SELECT COUNT(*)
           FROM historico_pagamentos_funcionarios dado
          WHERE dado.id_conta_debito IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM fc_contas_bancarias conta
                 WHERE conta.id = dado.id_conta_debito
                   AND conta.empresa_id = dado.empresa_id
            ))
      + (SELECT COUNT(*)
           FROM registro_dias_trabalhados filho
          WHERE filho.id_historico_pagamento IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM historico_pagamentos_funcionarios pai
                 WHERE pai.id = filho.id_historico_pagamento
                   AND pai.empresa_id = filho.empresa_id
            ))
      + (SELECT COUNT(*)
           FROM metas_regras filho
          WHERE NOT EXISTS (
              SELECT 1 FROM metas_versoes pai
               WHERE pai.id = filho.id_versao
                 AND pai.empresa_id = filho.empresa_id
          ))
      + (SELECT COUNT(*)
           FROM gincanas_premiacoes filho
          WHERE NOT EXISTS (
              SELECT 1 FROM gincanas pai
               WHERE pai.id = filho.gincana_id
                 AND pai.empresa_id = filho.empresa_id
          ))
      + (SELECT COUNT(*)
           FROM gincanas_premios_ganhos filho
          WHERE NOT EXISTS (
              SELECT 1 FROM gincanas pai
               WHERE pai.id = filho.gincana_id
                 AND pai.empresa_id = filho.empresa_id
          ))
      + (SELECT COUNT(*)
           FROM avisos_popup_visualizacoes filho
          WHERE NOT EXISTS (
              SELECT 1 FROM avisos_popup pai
               WHERE pai.id = filho.aviso_id
                 AND pai.empresa_id = filho.empresa_id
          ))
        AS total
),
modulos_bloqueados AS (
    SELECT COUNT(*)::INTEGER AS total
      FROM modulos_sistema
     WHERE codigo = ANY (ARRAY[
         'dashboard',
         'central-pagamentos',
         'incentivos',
         'alertas',
         'calendario'
     ])
       AND multiempresa_pronto = TRUE
),
resultado AS (
    SELECT jsonb_build_object(
        'colunas_empresa_id', (SELECT total FROM colunas),
        'colunas_ainda_anulaveis', (SELECT anulaveis FROM colunas),
        'constraints_de_empresa', (SELECT total FROM constraints_empresa),
        'constraints_de_empresa_nao_validadas', (SELECT nao_validadas FROM constraints_empresa),
        'constraints_de_relacoes', (SELECT total FROM constraints_relacoes),
        'constraints_de_relacoes_nao_validadas', (SELECT nao_validadas FROM constraints_relacoes),
        'uniques_de_identidade_empresarial', (SELECT total FROM uniques_ids_empresariais),
        'uniques_empresariais', (SELECT total FROM uniques_empresariais),
        'linhas_sem_empresa', (SELECT total FROM linhas_sem_empresa),
        'divergencias_vinculos', (SELECT total FROM divergencias_vinculos),
        'divergencias_relacoes', (SELECT total FROM divergencias_relacoes),
        'modulos_ja_liberados', (SELECT total FROM modulos_bloqueados),
        'preparacao_registrada', EXISTS (
            SELECT 1
              FROM sistema_migrations
             WHERE id = 'multiempresas-fase7-preparacao-v1'
        ),
        'finalizacao_ainda_nao_executada', NOT EXISTS (
            SELECT 1
              FROM sistema_migrations
             WHERE id = 'multiempresas-fase7-finalizacao-v1'
        )
    ) AS dados
)
SELECT jsonb_build_object(
    'aprovado',
    (SELECT total = 17 AND anulaveis = 17 FROM colunas)
    AND (SELECT total = 17 AND nao_validadas = 17 FROM constraints_empresa)
    AND (SELECT total = 17 AND nao_validadas = 17 FROM constraints_relacoes)
    AND (SELECT total = 17 FROM uniques_ids_empresariais)
    AND (SELECT total = 5 FROM uniques_empresariais)
    AND (SELECT total = 0 FROM linhas_sem_empresa)
    AND (SELECT total = 0 FROM divergencias_vinculos)
    AND (SELECT total = 0 FROM divergencias_relacoes)
    AND (SELECT total = 0 FROM modulos_bloqueados)
    AND (SELECT dados->>'preparacao_registrada' = 'true' FROM resultado)
    AND (SELECT dados->>'finalizacao_ainda_nao_executada' = 'true' FROM resultado),
    'resultado',
    dados
)
FROM resultado;

ROLLBACK;
