import 'dotenv/config';
import pg from 'pg';

const connectionString = process.argv[2] || process.env.POSTGRES_URL;

if (!connectionString) {
    throw new Error('Informe a URL do PostgreSQL ou configure POSTGRES_URL.');
}

const client = new pg.Client({ connectionString });
await client.connect();

try {
    await client.query('BEGIN READ ONLY');

    const empresaRes = await client.query(
        `SELECT id, codigo, nome_fantasia
           FROM empresas
          WHERE codigo = 'lojas-variara'
            AND ativa`
    );
    if (empresaRes.rows.length !== 1) {
        throw new Error('A empresa legada Lojas Variara não foi localizada de forma única.');
    }
    const empresa = empresaRes.rows[0];

    const definicoes = [
        ['ponto_diario', 'funcionario_id'],
        ['sessoes_trabalho_producao', 'funcionario_id'],
        ['historico_pagamentos_funcionarios', 'usuario_id'],
        ['registro_dias_trabalhados', 'usuario_id'],
        ['recibos_conferencia', 'usuario_id'],
        ['banco_pontos_saldo', 'usuario_id'],
        ['banco_pontos_log', 'usuario_id'],
        ['pontos_extras', 'funcionario_id'],
        ['gincanas_premios_ganhos', 'usuario_id'],
        ['avisos_popup_visualizacoes', 'usuario_id'],
        ['calendario_empresa', 'funcionario_id'],
    ];

    const tabelas = [];
    for (const [tabela, colunaUsuario] of definicoes) {
        const resultado = await client.query(
            `SELECT
                COUNT(*)::integer AS total,
                COUNT(DISTINCT dado.${colunaUsuario})::integer AS usuarios_distintos,
                COUNT(*) FILTER (
                    WHERE dado.${colunaUsuario} IS NOT NULL
                      AND vinculo.id IS NULL
                )::integer AS linhas_sem_vinculo_lojas_variara,
                COUNT(*) FILTER (
                    WHERE dado.${colunaUsuario} IS NULL
                )::integer AS linhas_sem_usuario
             FROM ${tabela} dado
             LEFT JOIN usuarios_empresas vinculo
               ON vinculo.usuario_id = dado.${colunaUsuario}
              AND vinculo.empresa_id = $1`,
            [empresa.id]
        );
        tabelas.push({ tabela, coluna_usuario: colunaUsuario, ...resultado.rows[0] });
    }

    const divergenciasVinculo = await client.query(
        `SELECT COUNT(*)::integer AS total
           FROM usuarios u
           JOIN usuarios_empresas ue
             ON ue.usuario_id = u.id
            AND ue.empresa_id = $1
          WHERE u.tipos IS DISTINCT FROM ue.tipos
             OR u.nivel IS DISTINCT FROM ue.nivel
             OR u.salario_fixo IS DISTINCT FROM ue.salario_fixo
             OR u.valor_passagem_diaria IS DISTINCT FROM ue.valor_passagem_diaria
             OR u.elegivel_pagamento IS DISTINCT FROM ue.elegivel_pagamento
             OR u.id_contato_financeiro IS DISTINCT FROM ue.id_contato_financeiro
             OR u.desconto_inss_percentual IS DISTINCT FROM ue.desconto_inss_percentual
             OR u.desconto_vt_percentual IS DISTINCT FROM ue.desconto_vt_percentual
             OR u.data_admissao IS DISTINCT FROM ue.data_admissao
             OR u.data_demissao IS DISTINCT FROM ue.data_demissao
             OR u.horario_entrada_1 IS DISTINCT FROM ue.horario_entrada_1
             OR u.horario_saida_1 IS DISTINCT FROM ue.horario_saida_1
             OR u.horario_entrada_2 IS DISTINCT FROM ue.horario_entrada_2
             OR u.horario_saida_2 IS DISTINCT FROM ue.horario_saida_2
             OR u.horario_entrada_3 IS DISTINCT FROM ue.horario_entrada_3
             OR u.horario_saida_3 IS DISTINCT FROM ue.horario_saida_3
             OR u.dias_trabalho IS DISTINCT FROM ue.dias_trabalho
             OR u.status_atual IS DISTINCT FROM ue.status_atual
             OR u.id_sessao_trabalho_atual IS DISTINCT FROM ue.id_sessao_trabalho_atual
             OR u.status_data_modificacao IS DISTINCT FROM ue.status_data_modificacao`,
        [empresa.id]
    );

    const contasPagamento = await client.query(
        `SELECT
            COUNT(*) FILTER (
                WHERE pagamento.id_conta_debito IS NOT NULL
                  AND conta.id IS NULL
            )::integer AS contas_fora_da_empresa,
            COUNT(*) FILTER (
                WHERE pagamento.id_conta_debito IS NULL
            )::integer AS pagamentos_sem_conta
         FROM historico_pagamentos_funcionarios pagamento
         LEFT JOIN fc_contas_bancarias conta
           ON conta.id = pagamento.id_conta_debito
          AND conta.empresa_id = $1`,
        [empresa.id]
    );

    const referenciasDias = await client.query(
        `SELECT COUNT(*)::integer AS referencias_incompativeis
           FROM registro_dias_trabalhados dia
           JOIN historico_pagamentos_funcionarios pagamento
             ON pagamento.id = dia.id_historico_pagamento
          WHERE dia.usuario_id <> pagamento.usuario_id`
    );

    const tabelasDiretas = {};
    for (const tabela of [
        'configuracoes_pontos_processos',
        'metas_versoes',
        'gincanas',
        'avisos_popup',
        'calendario_empresa',
    ]) {
        const resultado = await client.query(
            `SELECT COUNT(*)::integer AS total FROM ${tabela}`
        );
        tabelasDiretas[tabela] = resultado.rows[0].total;
    }

    const filhos = {};
    for (const [chave, consulta] of Object.entries({
        metas_regras_sem_versao:
            `SELECT COUNT(*)::integer AS total
               FROM metas_regras filho
               LEFT JOIN metas_versoes pai ON pai.id = filho.id_versao
              WHERE pai.id IS NULL`,
        gincanas_premiacoes_sem_pai:
            `SELECT COUNT(*)::integer AS total
               FROM gincanas_premiacoes filho
               LEFT JOIN gincanas pai ON pai.id = filho.gincana_id
              WHERE pai.id IS NULL`,
        gincanas_premios_sem_pai:
            `SELECT COUNT(*)::integer AS total
               FROM gincanas_premios_ganhos filho
               LEFT JOIN gincanas pai ON pai.id = filho.gincana_id
              WHERE pai.id IS NULL`,
        visualizacoes_sem_aviso:
            `SELECT COUNT(*)::integer AS total
               FROM avisos_popup_visualizacoes filho
               LEFT JOIN avisos_popup pai ON pai.id = filho.aviso_id
              WHERE pai.id IS NULL`,
    })) {
        const resultado = await client.query(consulta);
        filhos[chave] = resultado.rows[0].total;
    }

    const aprovado =
        tabelas.every((tabela) => tabela.linhas_sem_vinculo_lojas_variara === 0)
        && contasPagamento.rows[0].contas_fora_da_empresa === 0
        && referenciasDias.rows[0].referencias_incompativeis === 0
        && Object.values(filhos).every((total) => total === 0);

    process.stdout.write(JSON.stringify({
        somente_leitura: true,
        aprovado,
        empresa,
        tabelas,
        divergencias_usuarios_vs_vinculo_legado: divergenciasVinculo.rows[0].total,
        contas_pagamento: contasPagamento.rows[0],
        referencias_dias_pagamentos: referenciasDias.rows[0],
        tabelas_diretas: tabelasDiretas,
        filhos_sem_pai: filhos,
    }, null, 2));
} finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
}
