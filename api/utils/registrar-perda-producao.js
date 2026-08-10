import { getPermissoesCompletasUsuarioDB } from '../usuarios.js';
import { construirEtapasCanonicas } from './etapas-produto.js';
import {
    construirCteOrigensProdutoPronto,
    obterEstruturaOrigensProdutoPronto,
} from './origens-produto-pronto.js';

export const CATEGORIAS_PERDA = Object.freeze({
    QUANTIDADE_ERRADA: 'QUANTIDADE_ERRADA',
    PRODUTO_AVARIADO: 'PRODUTO_AVARIADO',
});

function erroApi(mensagem, statusCode = 400) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

function normalizarCategoriaPerda(valor) {
    const categoria = String(valor || '').trim().toUpperCase();
    if (categoria === CATEGORIAS_PERDA.PRODUTO_AVARIADO) return categoria;
    if (['QUANTIDADE_ERRADA', 'DIVERGENCIA_SALDO', 'LANCAMENTO_ERRADO'].includes(categoria)) {
        return CATEGORIAS_PERDA.QUANTIDADE_ERRADA;
    }
    return null;
}

function obterQuantidadeFinalProduzida(op) {
    if (!op || !Array.isArray(op.etapas) || op.etapas.length === 0) {
        return Number.parseInt(op?.quantidade, 10) || 0;
    }
    for (let i = op.etapas.length - 1; i >= 0; i -= 1) {
        const etapa = op.etapas[i];
        const quantidade = Number.parseInt(etapa?.quantidade, 10);
        if (etapa?.lancado && Number.isFinite(quantidade) && quantidade >= 0) return quantidade;
    }
    return Number.parseInt(op.quantidade, 10) || 0;
}

async function ajustesProducaoDisponiveis(dbClient) {
    const result = await dbClient.query(`
        SELECT 1
          FROM sistema_migrations
         WHERE id = 'ajustes-producao-perdas-v1'
         LIMIT 1
    `);
    return result.rowCount > 0;
}

async function estruturaPosOpDisponivel(dbClient) {
    const result = await dbClient.query(`
        SELECT 1
          FROM sistema_migrations
         WHERE id = 'pos-op-sessoes-producao-v1'
         LIMIT 1
    `);
    return result.rowCount > 0;
}

async function carregarEtapaPosOpArremate(dbClient, produtoId, empresaId) {
    const result = await dbClient.query(
        `SELECT etapas, "etapastiktik" AS etapas_tiktik
           FROM produtos
          WHERE id = $1
            AND empresa_id = $2
          LIMIT 1`,
        [produtoId, empresaId],
    );
    const produto = result.rows[0];
    const etapa = construirEtapasCanonicas({
        etapas: produto?.etapas,
        etapasTiktik: produto?.etapas_tiktik,
    }).etapasCanonicas.find(item => item.fase === 'POS_OP');

    return {
        processo: etapa?.processo || 'Arrematar',
        processoId: etapa?.processo_id || null,
        etapaId: etapa?.id || null,
    };
}

/**
 * Registra uma perda e abate o saldo real das OPs informadas.
 *
 * A função é compartilhada pela rota canônica de Produções e pelo alias
 * legado de Arremates. Ela recebe um cliente já conectado para manter a
 * autoridade transacional no router que atende a requisição.
 */
export async function registrarPerdaProducao({ dbClient, usuarioLogado, empresaId, payload }) {
    const {
        produto_id,
        variante,
        quantidadePerdida,
        motivo,
        observacao,
        opsOrigem,
    } = payload || {};
    const categoriaPerda = normalizarCategoriaPerda(motivo);
    const quantidadePerdidaNum = Number(quantidadePerdida);
    const observacaoNormalizada = String(observacao || '').trim();

    const permissoes = await getPermissoesCompletasUsuarioDB(
        dbClient,
        usuarioLogado.id,
        empresaId,
    );
    if (!permissoes.includes('registrar-perda-arremate')) {
        throw erroApi('Permissão negada para registrar perdas.', 403);
    }

    if (!produto_id
        || !categoriaPerda
        || !Number.isInteger(quantidadePerdidaNum)
        || quantidadePerdidaNum <= 0
        || !observacaoNormalizada
        || !Array.isArray(opsOrigem)
        || opsOrigem.length === 0) {
        throw erroApi('Informe categoria, quantidade inteira positiva, observação e ao menos uma OP de origem.');
    }

    const produtoInfo = await dbClient.query(
        'SELECT nome FROM produtos WHERE id = $1 AND empresa_id = $2',
        [produto_id, empresaId],
    );
    if (produtoInfo.rows.length === 0) {
        throw erroApi(`Produto com ID ${produto_id} não encontrado.`, 404);
    }
    const nomeDoProduto = produtoInfo.rows[0].nome;
    let transacaoIniciada = false;

    try {
        await dbClient.query('BEGIN');
        transacaoIniciada = true;

        // Serializa perdas e atribuições do mesmo produto. O saldo efetivo é
        // sempre recalculado no backend, não confiando no card da fila.
        await dbClient.query('SELECT pg_advisory_xact_lock(48191, $1)', [Number(produto_id)]);

        const numerosDasOps = [...new Set(
            opsOrigem
                .map(op => String(op?.numero || '').trim())
                .filter(Boolean),
        )];
        const varianteBanco = variante === '-' ? null : variante;
        const opsResult = await dbClient.query(`
            SELECT numero, edit_id, produto_id, variante, etapas, quantidade, status
              FROM ordens_de_producao
             WHERE empresa_id = $1
               AND produto_id = $2
               AND status = 'finalizado'
               AND numero = ANY($3::varchar[])
               AND (variante = $4 OR ($4 IS NULL AND variante IS NULL))
             ORDER BY numero ASC
             FOR UPDATE
        `, [empresaId, Number(produto_id), numerosDasOps, varianteBanco]);

        if (opsResult.rows.length !== numerosDasOps.length) {
            throw erroApi('Uma ou mais OPs de origem não pertencem ao produto, à variante ou à empresa ativa.');
        }

        const estruturaOrigens = await obterEstruturaOrigensProdutoPronto(dbClient);
        const cteOrigens = construirCteOrigensProdutoPronto(estruturaOrigens.origens);
        const arrematesResult = await dbClient.query(`
            ${cteOrigens}, LancamentosPorOp AS (
                SELECT op_numero, quantidade_disponibilizada AS quantidade
                  FROM OrigensProdutoProntoCompat
                 WHERE empresa_id = $1
                   AND produto_id = $2
                   AND (variante = $3 OR ($3 IS NULL AND variante IS NULL))
                   AND op_numero = ANY($4::varchar[])

                UNION ALL

                SELECT op_numero, quantidade_arrematada AS quantidade
                  FROM arremates
                 WHERE empresa_id = $1
                   AND produto_id = $2
                   AND (variante = $3 OR ($3 IS NULL AND variante IS NULL))
                   AND tipo_lancamento = 'PERDA'
                   AND op_numero = ANY($4::varchar[])
            )
            SELECT op_numero, COALESCE(SUM(quantidade), 0)::int AS total_lancado
              FROM LancamentosPorOp
             GROUP BY op_numero
        `, [empresaId, Number(produto_id), varianteBanco, numerosDasOps]);
        const lancadoPorOp = new Map(
            arrematesResult.rows.map(row => [String(row.op_numero), Number(row.total_lancado) || 0]),
        );

        const sessoesProducaoResult = await dbClient.query(`
            SELECT op_numero, COALESCE(SUM(quantidade_atribuida), 0)::int AS quantidade_em_andamento
              FROM sessoes_trabalho_producao
             WHERE empresa_id = $1
               AND produto_id = $2
               AND (variante = $3 OR ($3 IS NULL AND variante IS NULL))
               AND status = 'EM_ANDAMENTO'
               AND op_numero = ANY($4::varchar[])
             GROUP BY op_numero
        `, [empresaId, Number(produto_id), varianteBanco, numerosDasOps]);
        const sessaoProducaoPorOp = new Map(
            sessoesProducaoResult.rows.map(row => [String(row.op_numero), Number(row.quantidade_em_andamento) || 0]),
        );

        const sessoesArremateResult = await dbClient.query(`
            SELECT dados_ops
              FROM sessoes_trabalho_arremate
             WHERE empresa_id = $1
               AND produto_id = $2
               AND (variante = $3 OR ($3 IS NULL AND variante IS NULL))
               AND status = 'EM_ANDAMENTO'
        `, [empresaId, Number(produto_id), varianteBanco]);
        const sessaoArrematePorOp = new Map();
        sessoesArremateResult.rows.forEach((sessao) => {
            const opsDaSessao = Array.isArray(sessao.dados_ops) ? sessao.dados_ops : [];
            opsDaSessao.forEach((op) => {
                const numero = String(op?.numero || '').trim();
                if (!numero || !numerosDasOps.includes(numero)) return;
                const quantidade = Math.max(0, Number(op?.saldo_op) || 0);
                sessaoArrematePorOp.set(numero, (sessaoArrematePorOp.get(numero) || 0) + quantidade);
            });
        });

        const saldoPorOp = new Map();
        opsResult.rows.forEach((op) => {
            const numero = String(op.numero);
            const saldo = Math.max(
                0,
                obterQuantidadeFinalProduzida(op)
                    - (lancadoPorOp.get(numero) || 0)
                - (sessaoProducaoPorOp.get(numero) || 0)
                    - (sessaoArrematePorOp.get(numero) || 0),
            );
            saldoPorOp.set(numero, saldo);
        });

        let saldoTotalDisponivel = 0;
        saldoPorOp.forEach(saldo => { saldoTotalDisponivel += saldo; });
        if (quantidadePerdidaNum > saldoTotalDisponivel) {
            throw erroApi(`A quantidade solicitada (${quantidadePerdidaNum}) supera o saldo real disponível (${saldoTotalDisponivel}). Atualize a fila e tente novamente.`);
        }

        const opsCalculadas = [];
        opsResult.rows.forEach((op) => {
            const saldo = saldoPorOp.get(String(op.numero)) || 0;
            if (saldo > 0) opsCalculadas.push({ ...op, saldo_op: saldo });
        });

        const usaAjusteProducao = await ajustesProducaoDisponiveis(dbClient);
        const posOpAtivo = await estruturaPosOpDisponivel(dbClient);
        const etapaPosOp = posOpAtivo
            ? await carregarEtapaPosOpArremate(dbClient, Number(produto_id), empresaId)
            : null;
        let ajusteProducaoId = null;

        const perdaResult = await dbClient.query(`
            INSERT INTO arremate_perdas
                (empresa_id, produto_nome, variante_nome, quantidade_perdida, motivo, observacao, usuario_responsavel)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
        `, [
            empresaId,
            nomeDoProduto,
            variante,
            quantidadePerdidaNum,
            categoriaPerda,
            observacaoNormalizada,
            usuarioLogado.nome || 'Sistema',
        ]);
        const perdaId = perdaResult.rows[0].id;

        if (usaAjusteProducao) {
            const ajusteResult = await dbClient.query(`
                INSERT INTO ajustes_producao
                    (empresa_id, produto_id, variante, tipo_ajuste, quantidade_total,
                     observacao, usuario_id, usuario_nome)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
            `, [
                empresaId,
                Number(produto_id),
                varianteBanco,
                categoriaPerda,
                quantidadePerdidaNum,
                observacaoNormalizada,
                usuarioLogado.id || null,
                usuarioLogado.nome || 'Sistema',
            ]);
            ajusteProducaoId = ajusteResult.rows[0].id;
        }

        let quantidadeRestanteParaAbater = quantidadePerdidaNum;
        for (const op of opsCalculadas) {
            if (quantidadeRestanteParaAbater <= 0) break;
            const qtdAbaterDaOP = Math.min(quantidadeRestanteParaAbater, op.saldo_op);
            if (qtdAbaterDaOP <= 0) continue;

            if (usaAjusteProducao) {
                await dbClient.query(
                    posOpAtivo
                        ? `INSERT INTO ajustes_producao_itens
                            (empresa_id, ajuste_id, op_numero, etapa_id, processo_id, processo, quantidade)
                           VALUES ($1, $2, $3, $4, $5, $6, $7)`
                        : `INSERT INTO ajustes_producao_itens
                            (empresa_id, ajuste_id, op_numero, quantidade)
                           VALUES ($1, $2, $3, $4)`,
                    posOpAtivo
                        ? [empresaId, ajusteProducaoId, op.numero, etapaPosOp.etapaId,
                            etapaPosOp.processoId, etapaPosOp.processo, qtdAbaterDaOP]
                        : [empresaId, ajusteProducaoId, op.numero, qtdAbaterDaOP],
                );
                await dbClient.query(
                    posOpAtivo
                        ? `INSERT INTO arremates
                            (empresa_id, op_numero, produto_id, variante,
                             quantidade_arrematada, usuario_tiktik, lancado_por,
                             tipo_lancamento, id_perda_origem, id_ajuste_producao,
                             assinada, fase, processo, processo_id, etapa_id)
                           VALUES ($1, $2, $3, $4, $5, 'Sistema (Perda)', $6,
                                   'PERDA', $7, $8, TRUE, 'POS_OP', $9, $10, $11)`
                        : `INSERT INTO arremates
                            (empresa_id, op_numero, produto_id, variante,
                             quantidade_arrematada, usuario_tiktik, lancado_por,
                             tipo_lancamento, id_perda_origem, id_ajuste_producao, assinada)
                           VALUES ($1, $2, $3, $4, $5, 'Sistema (Perda)', $6,
                                   'PERDA', $7, $8, TRUE)`,
                    posOpAtivo
                        ? [empresaId, op.numero, produto_id, variante, qtdAbaterDaOP,
                            usuarioLogado.nome, perdaId, ajusteProducaoId,
                            etapaPosOp.processo, etapaPosOp.processoId, etapaPosOp.etapaId]
                        : [empresaId, op.numero, produto_id, variante, qtdAbaterDaOP,
                            usuarioLogado.nome, perdaId, ajusteProducaoId],
                );
            } else if (posOpAtivo) {
                await dbClient.query(`
                    INSERT INTO arremates
                        (empresa_id, op_numero, produto_id, variante,
                         quantidade_arrematada, usuario_tiktik, lancado_por,
                         tipo_lancamento, id_perda_origem, assinada,
                         fase, processo, processo_id, etapa_id)
                    VALUES ($1, $2, $3, $4, $5, 'Sistema (Perda)', $6,
                            'PERDA', $7, TRUE, 'POS_OP', $8, $9, $10)
                `, [
                    empresaId, op.numero, produto_id, variante, qtdAbaterDaOP,
                    usuarioLogado.nome, perdaId, etapaPosOp.processo,
                    etapaPosOp.processoId, etapaPosOp.etapaId,
                ]);
            } else {
                await dbClient.query(`
                    INSERT INTO arremates
                        (empresa_id, op_numero, produto_id, variante,
                         quantidade_arrematada, usuario_tiktik, lancado_por,
                         tipo_lancamento, id_perda_origem, assinada)
                    VALUES ($1, $2, $3, $4, $5, 'Sistema (Perda)', $6,
                            'PERDA', $7, TRUE)
                `, [
                    empresaId, op.numero, produto_id, variante, qtdAbaterDaOP,
                    usuarioLogado.nome, perdaId,
                ]);
            }
            quantidadeRestanteParaAbater -= qtdAbaterDaOP;
        }

        if (quantidadeRestanteParaAbater > 0) {
            throw erroApi('Não foi possível alocar toda a perda no saldo real das OPs selecionadas.');
        }

        await dbClient.query('COMMIT');
        transacaoIniciada = false;
        return { message: 'Registro de perda efetuado com sucesso.' };
    } catch (erro) {
        if (transacaoIniciada) await dbClient.query('ROLLBACK');
        throw erro;
    }
}
