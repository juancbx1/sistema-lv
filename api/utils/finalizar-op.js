import { registrarAuditoria } from '../audit.js';
import { construirEtapasCanonicas, etapaEhLiberacaoAutomatica } from './etapas-produto.js';
import { registrarLiberacaoAutomaticaProdutoPronto } from './origens-produto-pronto.js';
import { erroMonitoramento, resolverImpedimentosDaOp } from './monitoramento-ops.js';

function indiceEtapaFinalOp(etapas) {
    if (!Array.isArray(etapas)) return -1;
    for (let indice = etapas.length - 1; indice >= 0; indice -= 1) {
        const etapa = etapas[indice];
        const fase = etapa && typeof etapa === 'object'
            ? String(etapa.fase || 'OP').toUpperCase()
            : 'OP';
        if (fase === 'OP') return indice;
    }
    return -1;
}

/**
 * Finalização canônica de uma OP. O chamador é responsável por BEGIN/COMMIT.
 * Nenhum campo operacional enviado pelo navegador é usado como autoridade.
 */
export async function finalizarOrdemProducao(dbClient, {
    empresaId,
    usuarioLogado,
    opId = null,
    editId = null,
} = {}) {
    const opIdNumerico = Number(opId);
    const possuiOpId = opId !== null
        && opId !== undefined
        && opId !== ''
        && Number.isSafeInteger(opIdNumerico)
        && opIdNumerico > 0;
    if (!possuiOpId && !editId) {
        throw erroMonitoramento('Informe uma OP válida para finalizar.');
    }

    const identificadorSql = possuiOpId
        ? 'op.id = $1'
        : 'op.edit_id = $1';
    const identificador = possuiOpId ? opIdNumerico : String(editId);
    const opResult = await dbClient.query(`
        SELECT op.*
          FROM ordens_de_producao op
         WHERE ${identificadorSql}
           AND op.empresa_id = $2
         FOR UPDATE
    `, [identificador, empresaId]);
    const op = opResult.rows[0];
    if (!op) {
        throw erroMonitoramento('Ordem de Produção não encontrada na empresa ativa.', 404, 'OP_NAO_ENCONTRADA');
    }
    if (op.status === 'finalizado') {
        return { ...op, finalizedChildren: [], ja_finalizada: true };
    }
    if (op.status === 'cancelada' || op.status === 'excluido') {
        throw erroMonitoramento('Uma OP cancelada ou excluída não pode ser finalizada.', 409, 'OP_STATUS_INVALIDO');
    }

    const produtoResult = await dbClient.query(`
        SELECT etapas, "etapastiktik" AS etapas_tiktik
          FROM produtos
         WHERE id = $1
           AND empresa_id = $2
    `, [op.produto_id, empresaId]);
    if (!produtoResult.rows[0]) {
        throw erroMonitoramento('Produto da OP não encontrado na empresa ativa.', 409, 'PRODUTO_OP_INVALIDO');
    }

    const sessoesAtivasResult = await dbClient.query(`
        SELECT id, funcionario_id
          FROM sessoes_trabalho_producao
         WHERE op_numero = $1
           AND empresa_id = $2
           AND status = 'EM_ANDAMENTO'
         FOR UPDATE
    `, [op.numero, empresaId]);
    if (sessoesAtivasResult.rows.length > 0) {
        const idsSessoes = sessoesAtivasResult.rows.map((row) => Number(row.id));
        await dbClient.query(`
            UPDATE usuarios_empresas
               SET status_atual = 'LIVRE',
                   id_sessao_trabalho_atual = NULL,
                   status_data_modificacao = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')
             WHERE id_sessao_trabalho_atual = ANY($1::integer[])
               AND empresa_id = $2
               AND ativo
        `, [idsSessoes, empresaId]);
        await dbClient.query(`
            UPDATE sessoes_trabalho_producao
               SET status = 'FINALIZADA_FORCADA',
                   data_fim = CURRENT_TIMESTAMP
             WHERE id = ANY($1::integer[])
               AND empresa_id = $2
        `, [idsSessoes, empresaId]);
    }

    const etapasBase = Array.isArray(op.etapas) ? op.etapas : [];
    if (etapasBase.length === 0) {
        throw erroMonitoramento('A OP não possui etapas internas para finalizar.', 409, 'OP_SEM_ETAPAS');
    }
    const lancamentosResult = await dbClient.query(`
        SELECT etapa_index, COALESCE(SUM(quantidade), 0) AS total
          FROM producoes
         WHERE op_numero = $1
           AND empresa_id = $2
         GROUP BY etapa_index
    `, [op.numero, empresaId]);
    const lancamentosPorEtapa = new Map();
    lancamentosResult.rows.forEach((row) => {
        lancamentosPorEtapa.set(Number(row.etapa_index), Number(row.total) || 0);
    });
    const etapasRecalculadas = etapasBase.map((etapa, index) => ({
        ...(etapa && typeof etapa === 'object' ? etapa : { processo: String(etapa || '') }),
        lancado: lancamentosPorEtapa.has(index),
        quantidade: lancamentosPorEtapa.get(index) || 0,
    }));

    const etapasOp = etapasRecalculadas
        .map((etapa, index) => ({ etapa, index }))
        .filter(({ etapa }) => String(etapa.fase || 'OP').toUpperCase() === 'OP');
    if (etapasOp.length === 0 || etapasOp.some(({ index }) => !lancamentosPorEtapa.has(index))) {
        throw erroMonitoramento(
            'A OP ainda possui etapas internas sem lançamento.',
            409,
            'OP_NAO_ELEGIVEL',
        );
    }

    const etapasCanonicas = construirEtapasCanonicas({
        etapas: produtoResult.rows[0].etapas,
        etapasTiktik: produtoResult.rows[0].etapas_tiktik,
    }).etapasCanonicas;
    const etapasPosOp = etapasCanonicas.filter((etapa) => etapa.fase === 'POS_OP');
    const etapasAutomaticas = etapasPosOp.filter(etapaEhLiberacaoAutomatica);
    if (etapasAutomaticas.length > 1 || (etapasAutomaticas.length > 0 && etapasAutomaticas.length !== etapasPosOp.length)) {
        throw erroMonitoramento(
            'Configure apenas uma etapa POS_OP, manual ou automática, para este produto.',
            409,
            'CONFIGURACAO_POS_OP_INVALIDA',
        );
    }

    if (etapasAutomaticas.length === 1) {
        const indiceFinal = indiceEtapaFinalOp(etapasRecalculadas);
        const quantidadeFinal = Number(etapasRecalculadas[indiceFinal]?.quantidade) || 0;
        await registrarLiberacaoAutomaticaProdutoPronto(dbClient, {
            empresaId,
            produtoId: op.produto_id,
            variante: op.variante,
            opNumero: op.numero,
            opEditId: op.edit_id,
            etapa: etapasAutomaticas[0],
            quantidade: quantidadeFinal,
        });
    }

    const textoBusca = `OP gerada em conjunto com a OP mãe #${op.numero}`;
    const filhasResult = await dbClient.query(`
        UPDATE ordens_de_producao
           SET status = 'finalizado',
               data_final = CURRENT_TIMESTAMP,
               data_atualizacao = CURRENT_TIMESTAMP
         WHERE empresa_id = $2
           AND observacoes = $1
           AND status != 'finalizado'
         RETURNING numero
    `, [textoBusca, empresaId]);
    const finalizedChildren = filhasResult.rows.map((row) => row.numero);

    const updateResult = await dbClient.query(`
        UPDATE ordens_de_producao
           SET status = 'finalizado',
               etapas = $3::jsonb,
               data_final = CURRENT_TIMESTAMP,
               data_atualizacao = CURRENT_TIMESTAMP
         WHERE id = $1
           AND empresa_id = $2
         RETURNING *
    `, [op.id, empresaId, JSON.stringify(etapasRecalculadas)]);
    const opAtualizada = {
        ...updateResult.rows[0],
        finalizedChildren,
        ja_finalizada: false,
    };

    await resolverImpedimentosDaOp(dbClient, {
        empresaId,
        opId: Number(op.id),
        usuarioId: Number(usuarioLogado?.id),
    });
    await registrarAuditoria(dbClient, { ...usuarioLogado, empresa_id: empresaId }, 'op.encerrada', 'op', op.numero, {
        numero: op.numero,
        produto_id: op.produto_id,
        variante: op.variante,
        quantidade: op.quantidade,
        origem: 'servico-canonico',
        ops_filhas: finalizedChildren,
    });

    return opAtualizada;
}
