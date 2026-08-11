export async function obterEstruturaOrigensProdutoPronto(dbClient) {
    const result = await dbClient.query(`
        SELECT
            to_regclass('public.origens_produto_pronto') IS NOT NULL AS origens,
            to_regclass('public.embalagens_origens_produto_pronto') IS NOT NULL AS alocacoes,
            EXISTS (
                SELECT 1
                  FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'estoque_movimentos'
                   AND column_name = 'embalagem_origem_id'
            ) AS estoque_embalagem
    `);
    return {
        origens: result.rows[0]?.origens === true,
        alocacoes: result.rows[0]?.alocacoes === true,
        estoqueEmbalagem: result.rows[0]?.estoque_embalagem === true,
    };
}

/**
 * Audita, sem escrever, as referências criadas pelo fluxo canônico de
 * embalagem/estoque. A função existe para o fechamento operacional da
 * migração e também tolera restaurações em que a estrutura nova ainda não
 * esteja presente.
 */
export async function auditarOrigensProdutoPronto(dbClient, empresaId) {
    const estrutura = await obterEstruturaOrigensProdutoPronto(dbClient);
    const vazio = {
        origens: 0,
        alocacoesAtivas: 0,
        movimentosComOrigem: 0,
        alocacoesSemOrigem: 0,
        alocacoesSemArremateLegado: 0,
        embalagensUnidadeComQuantidadeDivergente: 0,
        movimentosSemEmbalagem: 0,
        saldosInvalidos: 0,
    };
    if (!estrutura.origens || !estrutura.alocacoes) {
        return { estrutura, resumo: vazio, aprovado: true };
    }

    const [
        origensResult,
        alocacoesResult,
        movimentosResult,
        alocacoesSemOrigemResult,
        alocacoesSemArremateResult,
        unidadesDivergentesResult,
        saldosInvalidosResult,
    ] = await Promise.all([
        dbClient.query(`
            SELECT COUNT(*)::bigint AS quantidade
              FROM origens_produto_pronto
             WHERE empresa_id = $1
        `, [empresaId]),
        dbClient.query(`
            SELECT COUNT(*)::bigint AS quantidade
              FROM embalagens_origens_produto_pronto
             WHERE empresa_id = $1
               AND estornada_em IS NULL
        `, [empresaId]),
        estrutura.estoqueEmbalagem
            ? dbClient.query(`
                SELECT COUNT(*)::bigint AS quantidade
                  FROM estoque_movimentos
                 WHERE empresa_id = $1
                   AND embalagem_origem_id IS NOT NULL
            `, [empresaId])
            : { rows: [{ quantidade: 0 }] },
        dbClient.query(`
            SELECT COUNT(*)::bigint AS quantidade
              FROM embalagens_origens_produto_pronto a
              LEFT JOIN origens_produto_pronto o
                ON o.empresa_id = a.empresa_id
               AND o.id = a.origem_produto_pronto_id
             WHERE a.empresa_id = $1
               AND a.estornada_em IS NULL
               AND a.origem_produto_pronto_id IS NOT NULL
               AND o.id IS NULL
        `, [empresaId]),
        dbClient.query(`
            SELECT COUNT(*)::bigint AS quantidade
              FROM embalagens_origens_produto_pronto a
              LEFT JOIN arremates ar
                ON ar.empresa_id = a.empresa_id
               AND ar.id = a.arremate_legado_id
             WHERE a.empresa_id = $1
               AND a.estornada_em IS NULL
               AND a.arremate_legado_id IS NOT NULL
               AND ar.id IS NULL
        `, [empresaId]),
        dbClient.query(`
            SELECT COUNT(*)::bigint AS quantidade
              FROM (
                    SELECT er.id
                      FROM embalagens_realizadas er
                      LEFT JOIN embalagens_origens_produto_pronto a
                        ON a.empresa_id = er.empresa_id
                       AND a.embalagem_id = er.id
                       AND a.estornada_em IS NULL
                     WHERE er.empresa_id = $1
                       AND er.tipo_embalagem = 'UNIDADE'
                       AND er.status = 'ATIVO'
                    GROUP BY er.id, er.quantidade_embalada
                    HAVING COUNT(a.id) > 0
                       AND COALESCE(SUM(a.quantidade_consumida), 0)
                           <> er.quantidade_embalada
              ) divergentes
        `, [empresaId]),
        dbClient.query(`
            SELECT COUNT(*)::bigint AS quantidade
              FROM origens_produto_pronto
             WHERE empresa_id = $1
               AND (
                    quantidade_disponibilizada <= 0
                    OR quantidade_consumida < 0
                    OR quantidade_consumida > quantidade_disponibilizada
               )
        `, [empresaId]),
    ]);

    const resumo = {
        origens: Number(origensResult.rows[0]?.quantidade) || 0,
        alocacoesAtivas: Number(alocacoesResult.rows[0]?.quantidade) || 0,
        movimentosComOrigem: Number(movimentosResult.rows[0]?.quantidade) || 0,
        alocacoesSemOrigem: Number(alocacoesSemOrigemResult.rows[0]?.quantidade) || 0,
        alocacoesSemArremateLegado: Number(alocacoesSemArremateResult.rows[0]?.quantidade) || 0,
        embalagensUnidadeComQuantidadeDivergente: Number(unidadesDivergentesResult.rows[0]?.quantidade) || 0,
        movimentosSemEmbalagem: 0,
        saldosInvalidos: Number(saldosInvalidosResult.rows[0]?.quantidade) || 0,
    };

    if (estrutura.estoqueEmbalagem) {
        const movimentoSemEmbalagemResult = await dbClient.query(`
            SELECT COUNT(*)::bigint AS quantidade
              FROM estoque_movimentos em
              LEFT JOIN embalagens_realizadas er
                ON er.empresa_id = em.empresa_id
               AND er.id = em.embalagem_origem_id
             WHERE em.empresa_id = $1
               AND em.embalagem_origem_id IS NOT NULL
               AND er.id IS NULL
        `, [empresaId]);
        resumo.movimentosSemEmbalagem = Number(movimentoSemEmbalagemResult.rows[0]?.quantidade) || 0;
    }

    const camposInconsistencia = [
        'alocacoesSemOrigem',
        'alocacoesSemArremateLegado',
        'embalagensUnidadeComQuantidadeDivergente',
        'movimentosSemEmbalagem',
        'saldosInvalidos',
    ];
    return {
        estrutura,
        resumo,
        aprovado: camposInconsistencia.every((campo) => resumo[campo] === 0),
    };
}

export function construirCteOrigensProdutoPronto(estruturaDisponivel) {
    const legado = `
        SELECT
            'ARREMATE_LEGADO'::text AS origem_tipo,
            a.id::bigint AS origem_id,
            a.id AS arremate_id_legado,
            a.empresa_id,
            a.produto_id,
            a.variante,
            a.op_numero,
            a.quantidade_arrematada AS quantidade_disponibilizada,
            a.quantidade_ja_embalada AS quantidade_consumida,
            a.data_lancamento AS data_disponibilizacao,
            a.fase,
            a.processo,
            a.processo_id,
            a.etapa_id,
            a.id_sessao_producao,
            COALESCE(a.executor_id, a.usuario_tiktik_id) AS executor_id,
            COALESCE(a.executor_nome, a.usuario_tiktik) AS executor_nome,
            a.executor_tipo,
            a.valor_ponto_aplicado,
            a.pontos_gerados
          FROM arremates a
         WHERE a.tipo_lancamento = 'PRODUCAO'
    `;

    if (!estruturaDisponivel) {
        return `WITH OrigensProdutoProntoCompat AS (${legado})`;
    }

    return `
        WITH OrigensProdutoProntoCompat AS (
            SELECT
                'PRODUTO_PRONTO'::text AS origem_tipo,
                o.id AS origem_id,
                o.arremate_id_legado,
                o.empresa_id,
                o.produto_id,
                o.variante,
                o.op_numero,
                o.quantidade_disponibilizada,
                o.quantidade_consumida,
                o.data_disponibilizacao,
                o.fase,
                o.processo,
                o.processo_id,
                o.etapa_id,
                o.id_sessao_producao,
                o.executor_id,
                o.executor_nome,
                o.executor_tipo,
                o.valor_ponto_aplicado,
                o.pontos_gerados
              FROM origens_produto_pronto o

            UNION ALL

            ${legado}
              AND NOT EXISTS (
                    SELECT 1
                      FROM origens_produto_pronto o
                     WHERE o.empresa_id = a.empresa_id
                       AND o.arremate_id_legado = a.id
                )
        )
    `;
}

export async function registrarOrigemProdutoPronto(dbClient, {
    empresaId,
    produtoId,
    variante,
    opNumero,
    processo,
    processoId,
    etapaId,
    sessaoProducaoId,
    arremateIdLegado,
    quantidade,
    valorPontoAplicado,
    pontosGerados,
    executorId,
    executorNome,
    executorTipo,
}) {
    const estrutura = await obterEstruturaOrigensProdutoPronto(dbClient);
    if (!estrutura.origens) return null;

    const result = await dbClient.query(`
        INSERT INTO origens_produto_pronto (
            empresa_id,
            tipo_origem,
            produto_id,
            variante,
            op_numero,
            fase,
            processo,
            processo_id,
            etapa_id,
            id_sessao_producao,
            arremate_id_legado,
            quantidade_disponibilizada,
            valor_ponto_aplicado,
            pontos_gerados,
            executor_id,
            executor_nome,
            executor_tipo
        )
        VALUES (
            $1, 'CONCLUSAO_POS_OP', $2, $3, $4, 'POS_OP', $5, $6, $7,
            $8, $9, $10, $11, $12, $13, $14, $15
        )
        ON CONFLICT (empresa_id, arremate_id_legado)
            WHERE arremate_id_legado IS NOT NULL
        DO NOTHING
        RETURNING *
    `, [
        empresaId,
        produtoId,
        variante || null,
        String(opNumero),
        processo,
        processoId || null,
        etapaId || null,
        sessaoProducaoId || null,
        arremateIdLegado || null,
        quantidade,
        valorPontoAplicado ?? null,
        pontosGerados ?? null,
        executorId || null,
        executorNome || null,
        executorTipo || null,
    ]);
    return result.rows[0] || null;
}

/**
 * Projeta uma etapa POS_OP marcada como liberação automática. A projeção em
 * `arremates` mantém leitores legados funcionando; a origem canônica continua
 * sendo a autoridade para a fila de embalagem quando a estrutura nova existe.
 */
export async function registrarLiberacaoAutomaticaProdutoPronto(dbClient, {
    empresaId,
    produtoId,
    variante,
    opNumero,
    opEditId = null,
    etapa,
    quantidade,
}) {
    const quantidadeNormalizada = Math.floor(Number(quantidade));
    if (!Number.isInteger(quantidadeNormalizada) || quantidadeNormalizada <= 0) return null;
    if (!etapa?.processo) throw new Error('A etapa de liberaÃ§Ã£o automÃ¡tica precisa de um processo.');

    const varianteBanco = varianteNormalizada(variante);
    const processoId = etapa.processo_id ?? null;
    const etapaId = etapa.id ?? null;
    const chave = [
        'pos-op-automatico', empresaId, opNumero, produtoId,
        varianteBanco || '-', etapaId || processoId || etapa.processo,
    ].join(':');
    await dbClient.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [chave],
    );

    const posOpEstruturaResult = await dbClient.query(`
        SELECT
            EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'arremates'
                   AND column_name = 'fase'
            ) AS possui_fase,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'arremates'
                   AND column_name = 'processo_id'
            ) AS possui_processo_id,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'arremates'
                   AND column_name = 'etapa_id'
            ) AS possui_etapa_id
    `);
    const posOpEstruturaDisponivel = Boolean(
        posOpEstruturaResult.rows[0]?.possui_fase
        && posOpEstruturaResult.rows[0]?.possui_processo_id
        && posOpEstruturaResult.rows[0]?.possui_etapa_id
    );

    const existenteResult = await dbClient.query(
        posOpEstruturaDisponivel
            ? `SELECT id, quantidade_arrematada
                 FROM arremates
                WHERE empresa_id = $1
                  AND op_numero = $2
                  AND produto_id = $3
                  AND (variante = $4 OR ($4 IS NULL AND variante IS NULL))
                  AND tipo_lancamento = 'PRODUCAO'
                  AND fase = 'POS_OP'
                  AND processo_id IS NOT DISTINCT FROM $5
                  AND etapa_id IS NOT DISTINCT FROM $6
                  AND usuario_tiktik = 'Sistema (liberacao automatica)'
                ORDER BY id DESC
                LIMIT 1
                FOR UPDATE`
            : `SELECT id, quantidade_arrematada
                 FROM arremates
                WHERE empresa_id = $1
                  AND op_numero = $2
                  AND produto_id = $3
                  AND (variante = $4 OR ($4 IS NULL AND variante IS NULL))
                  AND tipo_lancamento = 'PRODUCAO'
                  AND usuario_tiktik = 'Sistema (liberacao automatica)'
                ORDER BY id DESC
                LIMIT 1
                FOR UPDATE`,
        posOpEstruturaDisponivel
            ? [empresaId, String(opNumero), Number(produtoId), varianteBanco, processoId, etapaId]
            : [empresaId, String(opNumero), Number(produtoId), varianteBanco],
    );

    let arremateId;
    if (existenteResult.rows[0]) {
        const quantidadeExistente = Number(existenteResult.rows[0].quantidade_arrematada);
        if (quantidadeExistente !== quantidadeNormalizada) {
            throw new Error('A liberaÃ§Ã£o automÃ¡tica da OP jÃ¡ existe com quantidade diferente.');
        }
        arremateId = existenteResult.rows[0].id;
    } else {
        const inserido = await dbClient.query(
            posOpEstruturaDisponivel
                ? `INSERT INTO arremates (
                    empresa_id, op_numero, op_edit_id, produto_id, variante,
                    quantidade_arrematada, usuario_tiktik, lancado_por,
                    valor_ponto_aplicado, pontos_gerados, tipo_lancamento,
                    assinada, fase, processo, processo_id, etapa_id,
                    executor_nome, executor_tipo
                 )
                 VALUES ($1, $2, $3, $4, $5, $6,
                         'Sistema (liberacao automatica)', 'Sistema', 0, 0,
                         'PRODUCAO', TRUE, 'POS_OP', $7, $8, $9,
                         'Sistema (liberacao automatica)', 'sistema')
                 RETURNING id`
                : `INSERT INTO arremates (
                    empresa_id, op_numero, op_edit_id, produto_id, variante,
                    quantidade_arrematada, usuario_tiktik, lancado_por,
                    valor_ponto_aplicado, pontos_gerados, tipo_lancamento, assinada
                 )
                 VALUES ($1, $2, $3, $4, $5, $6,
                         'Sistema (liberacao automatica)', 'Sistema', 0, 0,
                         'PRODUCAO', TRUE)
                 RETURNING id`,
            posOpEstruturaDisponivel
                ? [
                    empresaId,
                    String(opNumero),
                    opEditId,
                    Number(produtoId),
                    varianteBanco,
                    quantidadeNormalizada,
                    etapa.processo,
                    processoId,
                    etapaId,
                ]
                : [
                    empresaId,
                    String(opNumero),
                    opEditId,
                    Number(produtoId),
                    varianteBanco,
                    quantidadeNormalizada,
                ],
        );
        arremateId = inserido.rows[0]?.id;
    }

    const origem = posOpEstruturaDisponivel
        ? await registrarOrigemProdutoPronto(dbClient, {
        empresaId,
        produtoId,
        variante: varianteBanco,
        opNumero,
        processo: etapa.processo,
        processoId,
        etapaId,
        sessaoProducaoId: null,
        arremateIdLegado: arremateId,
        quantidade: quantidadeNormalizada,
        valorPontoAplicado: 0,
        pontosGerados: 0,
        executorId: null,
        executorNome: 'Sistema (liberacao automatica)',
        executorTipo: 'sistema',
        })
        : null;

    return { arremateId, origem };
}

function varianteNormalizada(valor) {
    const normalizada = String(valor ?? '').trim();
    return !normalizada || normalizada === '-' ? null : normalizada;
}

function ordenarOrigens(a, b) {
    const dataA = new Date(a.data_disponibilizacao || 0).getTime();
    const dataB = new Date(b.data_disponibilizacao || 0).getTime();
    if (dataA !== dataB) return dataA - dataB;
    if (a.origem_tipo !== b.origem_tipo) {
        return a.origem_tipo === 'PRODUTO_PRONTO' ? -1 : 1;
    }
    return Number(a.origem_id) - Number(b.origem_id);
}

export async function listarOrigensProdutoProntoDisponiveis(dbClient, {
    empresaId,
    produtoId,
    variante,
    bloquear = false,
}) {
    const estrutura = await obterEstruturaOrigensProdutoPronto(dbClient);
    const varianteBanco = varianteNormalizada(variante);
    const origens = [];

    if (estrutura.origens) {
        const canonicas = await dbClient.query(`
            SELECT
                'PRODUTO_PRONTO'::text AS origem_tipo,
                o.id AS origem_id,
                o.arremate_id_legado,
                o.produto_id,
                o.variante,
                o.op_numero,
                o.quantidade_disponibilizada,
                o.quantidade_consumida,
                o.data_disponibilizacao,
                o.fase,
                o.processo,
                o.processo_id,
                o.etapa_id,
                o.id_sessao_producao,
                o.executor_id,
                o.executor_nome,
                o.executor_tipo,
                o.valor_ponto_aplicado,
                o.pontos_gerados
              FROM origens_produto_pronto o
             WHERE o.empresa_id = $1
               AND o.produto_id = $2
               AND COALESCE(NULLIF(o.variante, ''), '-') = COALESCE($3, '-')
               AND o.quantidade_consumida < o.quantidade_disponibilizada
             ORDER BY o.data_disponibilizacao, o.id
             ${bloquear ? 'FOR UPDATE OF o' : ''}
        `, [empresaId, Number(produtoId), varianteBanco]);
        origens.push(...canonicas.rows);
    }

    const legadas = await dbClient.query(`
        SELECT
            'ARREMATE_LEGADO'::text AS origem_tipo,
            a.id::bigint AS origem_id,
            a.id AS arremate_id_legado,
            a.produto_id,
            a.variante,
            a.op_numero,
            a.quantidade_arrematada AS quantidade_disponibilizada,
            a.quantidade_ja_embalada AS quantidade_consumida,
            a.data_lancamento AS data_disponibilizacao,
            a.fase,
            a.processo,
            a.processo_id,
            a.etapa_id,
            a.id_sessao_producao,
            a.executor_id,
            a.executor_nome,
            a.executor_tipo,
            a.valor_ponto_aplicado,
            a.pontos_gerados
          FROM arremates a
         WHERE a.empresa_id = $1
           AND a.produto_id = $2
           AND COALESCE(NULLIF(a.variante, ''), '-') = COALESCE($3, '-')
           AND a.tipo_lancamento = 'PRODUCAO'
           AND a.quantidade_ja_embalada < a.quantidade_arrematada
           ${estrutura.origens ? `
           AND NOT EXISTS (
                SELECT 1
                  FROM origens_produto_pronto o
                 WHERE o.empresa_id = a.empresa_id
                   AND o.arremate_id_legado = a.id
           )` : ''}
         ORDER BY a.data_lancamento, a.id
         ${bloquear ? 'FOR UPDATE OF a' : ''}
    `, [empresaId, Number(produtoId), varianteBanco]);
    origens.push(...legadas.rows);

    return {
        estrutura,
        rows: origens.sort(ordenarOrigens),
    };
}

export async function alocarOrigensProdutoPronto(dbClient, {
    empresaId,
    produtoId,
    variante,
    quantidade,
}) {
    const quantidadeNecessaria = Number(quantidade);
    if (!Number.isInteger(quantidadeNecessaria) || quantidadeNecessaria <= 0) {
        const error = new Error('A quantidade a embalar deve ser um inteiro positivo.');
        error.statusCode = 400;
        throw error;
    }

    const { estrutura, rows } = await listarOrigensProdutoProntoDisponiveis(dbClient, {
        empresaId,
        produtoId,
        variante,
        bloquear: true,
    });
    const totalDisponivel = rows.reduce(
        (total, origem) => total
            + Number(origem.quantidade_disponibilizada)
            - Number(origem.quantidade_consumida),
        0,
    );
    if (totalDisponivel < quantidadeNecessaria) {
        const error = new Error(`Saldo pronto para embalagem insuficiente. Disponível: ${totalDisponivel}.`);
        error.statusCode = 409;
        error.saldoDisponivel = totalDisponivel;
        throw error;
    }

    const alocacoes = [];
    let restante = quantidadeNecessaria;
    for (const origem of rows) {
        if (restante <= 0) break;
        const saldo = Number(origem.quantidade_disponibilizada)
            - Number(origem.quantidade_consumida);
        const consumida = Math.min(restante, saldo);
        if (consumida <= 0) continue;

        if (origem.origem_tipo === 'PRODUTO_PRONTO') {
            const atualizada = await dbClient.query(`
                UPDATE origens_produto_pronto
                   SET quantidade_consumida = quantidade_consumida + $1
                 WHERE id = $2
                   AND empresa_id = $3
                   AND quantidade_consumida + $1 <= quantidade_disponibilizada
                 RETURNING arremate_id_legado
            `, [consumida, origem.origem_id, empresaId]);
            if (atualizada.rowCount !== 1) {
                const error = new Error('O saldo da origem de produto pronto mudou. Atualize a fila.');
                error.statusCode = 409;
                throw error;
            }
            const arremateCompatId = atualizada.rows[0].arremate_id_legado;
            if (arremateCompatId) {
                const projecao = await dbClient.query(`
                    UPDATE arremates
                       SET quantidade_ja_embalada = quantidade_ja_embalada + $1
                     WHERE id = $2
                       AND empresa_id = $3
                       AND quantidade_ja_embalada + $1 <= quantidade_arrematada
                `, [consumida, arremateCompatId, empresaId]);
                if (projecao.rowCount !== 1) {
                    throw new Error('A projeção legada do saldo de embalagem ficou inconsistente.');
                }
            }
            alocacoes.push({
                origem_tipo: 'PRODUTO_PRONTO',
                origem_produto_pronto_id: Number(origem.origem_id),
                arremate_legado_id: null,
                arremate_compat_id: arremateCompatId || null,
                quantidade: consumida,
            });
        } else {
            const atualizada = await dbClient.query(`
                UPDATE arremates
                   SET quantidade_ja_embalada = quantidade_ja_embalada + $1
                 WHERE id = $2
                   AND empresa_id = $3
                   AND quantidade_ja_embalada + $1 <= quantidade_arrematada
            `, [consumida, origem.origem_id, empresaId]);
            if (atualizada.rowCount !== 1) {
                const error = new Error('O saldo do lote legado mudou. Atualize a fila.');
                error.statusCode = 409;
                throw error;
            }
            alocacoes.push({
                origem_tipo: 'ARREMATE_LEGADO',
                origem_produto_pronto_id: null,
                arremate_legado_id: Number(origem.origem_id),
                arremate_compat_id: Number(origem.origem_id),
                quantidade: consumida,
            });
        }
        restante -= consumida;
    }

    return { estrutura, alocacoes };
}

export async function registrarAlocacoesEmbalagem(dbClient, {
    empresaId,
    embalagemId,
    alocacoes,
    estrutura,
}) {
    if (!estrutura?.alocacoes) return;
    for (const alocacao of alocacoes) {
        await dbClient.query(`
            INSERT INTO embalagens_origens_produto_pronto (
                empresa_id,
                embalagem_id,
                origem_produto_pronto_id,
                arremate_legado_id,
                quantidade_consumida
            )
            VALUES ($1, $2, $3, $4, $5)
        `, [
            empresaId,
            embalagemId,
            alocacao.origem_produto_pronto_id,
            alocacao.arremate_legado_id,
            alocacao.quantidade,
        ]);
    }
}

export function serializarAlocacoesCompativeis(alocacoes) {
    return alocacoes.map((alocacao) => ({
        origem_tipo: alocacao.origem_tipo,
        origem_produto_pronto_id: alocacao.origem_produto_pronto_id,
        id_arremate: alocacao.arremate_compat_id,
        quantidade_usada: alocacao.quantidade,
    }));
}

export async function estornarAlocacoesEmbalagem(dbClient, {
    empresaId,
    embalagemId,
}) {
    const estrutura = await obterEstruturaOrigensProdutoPronto(dbClient);
    if (!estrutura.alocacoes) return false;

    const result = await dbClient.query(`
        SELECT *
          FROM embalagens_origens_produto_pronto
         WHERE empresa_id = $1
           AND embalagem_id = $2
           AND estornada_em IS NULL
         ORDER BY id
         FOR UPDATE
    `, [empresaId, embalagemId]);
    if (result.rowCount === 0) return false;

    const embalagemResumo = await dbClient.query(`
        SELECT er.tipo_embalagem,
               er.quantidade_embalada,
               COALESCE(SUM(a.quantidade_consumida), 0) AS quantidade_alocada
          FROM embalagens_realizadas er
          LEFT JOIN embalagens_origens_produto_pronto a
            ON a.empresa_id = er.empresa_id
           AND a.embalagem_id = er.id
           AND a.estornada_em IS NULL
         WHERE er.empresa_id = $1
           AND er.id = $2
         GROUP BY er.tipo_embalagem, er.quantidade_embalada
    `, [empresaId, embalagemId]);
    const resumo = embalagemResumo.rows[0];
    if (resumo?.tipo_embalagem === 'UNIDADE'
        && Number(resumo.quantidade_alocada) !== Number(resumo.quantidade_embalada)) {
        throw new Error('As alocações da embalagem não correspondem à quantidade registrada.');
    }

    for (const alocacao of result.rows) {
        const quantidade = Number(alocacao.quantidade_consumida);
        if (alocacao.origem_produto_pronto_id) {
            const origem = await dbClient.query(`
                UPDATE origens_produto_pronto
                   SET quantidade_consumida = quantidade_consumida - $1
                 WHERE id = $2
                   AND empresa_id = $3
                   AND quantidade_consumida >= $1
                 RETURNING arremate_id_legado
            `, [quantidade, alocacao.origem_produto_pronto_id, empresaId]);
            if (origem.rowCount !== 1) {
                throw new Error('Não foi possível devolver o saldo à origem de produto pronto.');
            }
            const arremateCompatId = origem.rows[0].arremate_id_legado;
            if (arremateCompatId) {
                const projecao = await dbClient.query(`
                    UPDATE arremates
                       SET quantidade_ja_embalada = quantidade_ja_embalada - $1
                     WHERE id = $2
                       AND empresa_id = $3
                       AND quantidade_ja_embalada >= $1
                `, [quantidade, arremateCompatId, empresaId]);
                if (projecao.rowCount !== 1) {
                    throw new Error('Não foi possível devolver o saldo à projeção legada.');
                }
            }
        } else {
            const legado = await dbClient.query(`
                UPDATE arremates
                   SET quantidade_ja_embalada = quantidade_ja_embalada - $1
                 WHERE id = $2
                   AND empresa_id = $3
                   AND quantidade_ja_embalada >= $1
            `, [quantidade, alocacao.arremate_legado_id, empresaId]);
            if (legado.rowCount !== 1) {
                throw new Error('Não foi possível devolver o saldo ao lote legado.');
            }
        }
    }

    await dbClient.query(`
        UPDATE embalagens_origens_produto_pronto
           SET estornada_em = NOW()
         WHERE empresa_id = $1
           AND embalagem_id = $2
           AND estornada_em IS NULL
    `, [empresaId, embalagemId]);
    return true;
}
