import pg from 'pg';

const connectionString = process.argv[2] || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_ponto_motor_test';
if (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost')) {
    throw new Error('Este inspetor aceita somente uma conexão PostgreSQL local.');
}

const pool = new pg.Pool({ connectionString });

async function consulta(label, text, values = []) {
    const result = await pool.query(text, values);
    return { label, rows: result.rows };
}

try {
    const resultados = await Promise.all([
        consulta('contagens', `
            SELECT tabela, total
            FROM (
                SELECT 'produtos' AS tabela, COUNT(*)::int AS total FROM produtos
                UNION ALL SELECT 'materias_primas', COUNT(*)::int FROM materias_primas
                UNION ALL SELECT 'demandas_producao', COUNT(*)::int FROM demandas_producao
                UNION ALL SELECT 'demandas_componentes_atribuidos', COUNT(*)::int FROM demandas_componentes_atribuidos
                UNION ALL SELECT 'ordens_de_producao', COUNT(*)::int FROM ordens_de_producao
                UNION ALL SELECT 'cortes', COUNT(*)::int FROM cortes
                UNION ALL SELECT 'tempos_padrao_producao', COUNT(*)::int FROM tempos_padrao_producao
                UNION ALL SELECT 'tempos_padrao_arremate', COUNT(*)::int FROM tempos_padrao_arremate
                UNION ALL SELECT 'configuracoes_pontos_processos', COUNT(*)::int FROM configuracoes_pontos_processos
            ) dados
            ORDER BY tabela
        `),
        consulta('duplicidades', `
            SELECT 'produto_nome' AS chave, nome AS valor, COUNT(*)::int AS total
            FROM produtos
            GROUP BY nome
            HAVING COUNT(*) > 1
            UNION ALL
            SELECT 'produto_sku', sku, COUNT(*)::int
            FROM produtos
            WHERE sku IS NOT NULL AND NULLIF(TRIM(sku), '') IS NOT NULL
            GROUP BY sku
            HAVING COUNT(*) > 1
            UNION ALL
            SELECT 'op_numero', numero, COUNT(*)::int
            FROM ordens_de_producao
            GROUP BY numero
            HAVING COUNT(*) > 1
            UNION ALL
            SELECT 'op_edit_id', edit_id, COUNT(*)::int
            FROM ordens_de_producao
            GROUP BY edit_id
            HAVING COUNT(*) > 1
            UNION ALL
            SELECT 'corte_pn', pn, COUNT(*)::int
            FROM cortes
            GROUP BY pn
            HAVING COUNT(*) > 1
            ORDER BY 1, 2
        `),
        consulta('orfãos_por_id', `
            SELECT 'op_produto' AS tipo, COUNT(*)::int AS total
            FROM ordens_de_producao op
            LEFT JOIN produtos p ON p.id = op.produto_id
            WHERE op.produto_id IS NOT NULL AND p.id IS NULL
            UNION ALL
            SELECT 'op_demanda', COUNT(*)::int
            FROM ordens_de_producao op
            LEFT JOIN demandas_producao d ON d.id = op.demanda_id
            WHERE op.demanda_id IS NOT NULL AND d.id IS NULL
            UNION ALL
            SELECT 'corte_produto', COUNT(*)::int
            FROM cortes c
            LEFT JOIN produtos p ON p.id = c.produto_id
            WHERE c.produto_id IS NOT NULL AND p.id IS NULL
            UNION ALL
            SELECT 'corte_demanda', COUNT(*)::int
            FROM cortes c
            LEFT JOIN demandas_producao d ON d.id = c.demanda_id
            WHERE c.demanda_id IS NOT NULL AND d.id IS NULL
            UNION ALL
            SELECT 'tempo_producao_produto', COUNT(*)::int
            FROM tempos_padrao_producao t
            LEFT JOIN produtos p ON p.id = t.produto_id
            WHERE p.id IS NULL
            UNION ALL
            SELECT 'tempo_arremate_produto', COUNT(*)::int
            FROM tempos_padrao_arremate t
            LEFT JOIN produtos p ON p.id = t.produto_id
            WHERE p.id IS NULL
            UNION ALL
            SELECT 'config_pontos_produto', COUNT(*)::int
            FROM configuracoes_pontos_processos c
            LEFT JOIN produtos p ON p.id = c.produto_id
            WHERE p.id IS NULL
            ORDER BY 1
        `),
        consulta('demandas_por_sku', `
            SELECT
                COUNT(*)::int AS total_demandas,
                COUNT(*) FILTER (WHERE p.id IS NOT NULL)::int AS sku_resolvido,
                COUNT(*) FILTER (WHERE p.id IS NULL)::int AS sku_sem_produto
            FROM demandas_producao d
            LEFT JOIN produtos p
              ON p.sku = d.produto_sku
              OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(COALESCE(p.grade, '[]'::jsonb)) g
                  WHERE g->>'sku' = d.produto_sku
              )
        `),
        consulta('referencias_textuais_produto', `
            SELECT origem, total, por_sku, por_id_textual, referencias
            FROM (
                SELECT
                    'produto_composicao_mp' AS origem,
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE p.sku = t.produto_ref_id)::int AS por_sku,
                    COUNT(*) FILTER (WHERE p.id::text = t.produto_ref_id)::int AS por_id_textual,
                    ARRAY_AGG(DISTINCT t.produto_ref_id) AS referencias
                FROM produto_composicao_mp t
                LEFT JOIN produtos p ON p.sku = t.produto_ref_id OR p.id::text = t.produto_ref_id
                UNION ALL
                SELECT
                    'produto_custo_mao_de_obra', COUNT(*)::int,
                    COUNT(*) FILTER (WHERE p.sku = t.produto_ref_id)::int,
                    COUNT(*) FILTER (WHERE p.id::text = t.produto_ref_id)::int,
                    ARRAY_AGG(DISTINCT t.produto_ref_id)
                FROM produto_custo_mao_de_obra t
                LEFT JOIN produtos p ON p.sku = t.produto_ref_id OR p.id::text = t.produto_ref_id
                UNION ALL
                SELECT
                    'produto_precificacao_configs', COUNT(*)::int,
                    COUNT(*) FILTER (WHERE p.sku = t.produto_ref_id)::int,
                    COUNT(*) FILTER (WHERE p.id::text = t.produto_ref_id)::int,
                    ARRAY_AGG(DISTINCT t.produto_ref_id)
                FROM produto_precificacao_configs t
                LEFT JOIN produtos p ON p.sku = t.produto_ref_id OR p.id::text = t.produto_ref_id
            ) dados
            ORDER BY origem
        `),
        consulta('empresa_id_pontos', `
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE empresa_id IS NULL)::int AS sem_empresa,
                COUNT(*) FILTER (WHERE empresa_id IS NOT NULL)::int AS com_empresa
            FROM configuracoes_pontos_processos
        `),
        consulta('detalhes_orfaos_cortes', `
            SELECT to_jsonb(c) AS registro
            FROM cortes c
            LEFT JOIN demandas_producao d ON d.id = c.demanda_id
            WHERE c.demanda_id IS NOT NULL AND d.id IS NULL
            ORDER BY c.id
            LIMIT 100
        `),
        consulta('detalhes_orfaos_ops', `
            SELECT to_jsonb(op) AS registro
            FROM ordens_de_producao op
            LEFT JOIN demandas_producao d ON d.id = op.demanda_id
            WHERE op.demanda_id IS NOT NULL AND d.id IS NULL
            ORDER BY op.id
            LIMIT 100
        `),
        consulta('detalhes_referencias_textuais', `
            SELECT 'produto_composicao_mp' AS origem, to_jsonb(t) AS registro
            FROM produto_composicao_mp t
            LEFT JOIN produtos p ON p.sku = t.produto_ref_id OR p.id::text = t.produto_ref_id
            WHERE p.id IS NULL
            UNION ALL
            SELECT 'produto_custo_mao_de_obra', to_jsonb(t)
            FROM produto_custo_mao_de_obra t
            LEFT JOIN produtos p ON p.sku = t.produto_ref_id OR p.id::text = t.produto_ref_id
            WHERE p.id IS NULL
            UNION ALL
            SELECT 'produto_precificacao_configs', to_jsonb(t)
            FROM produto_precificacao_configs t
            LEFT JOIN produtos p ON p.sku = t.produto_ref_id OR p.id::text = t.produto_ref_id
            WHERE p.id IS NULL
            ORDER BY origem
        `),
    ]);

    console.log(JSON.stringify({ connection: connectionString, resultados }, null, 2));
} finally {
    await pool.end();
}
