// Servico de dominio do controle de ponto.
//
// Este modulo concentra a escrita do livro append-only e da janela operacional
// de transicao. O cron, o motor e os endpoints de ponto/tarefa usam estas
// funcoes quando as tabelas aditivas estao disponiveis; sem a migration, os
// consumidores permanecem no caminho de compatibilidade legado.

export const ORIGENS_PONTO = Object.freeze({
    SISTEMA: 'SISTEMA',
    CRON: 'CRON',
    SUPERVISOR: 'SUPERVISOR',
    EMPREGADO: 'EMPREGADO',
    MIGRACAO: 'MIGRACAO',
});

export const STATUS_TRANSICAO = Object.freeze({
    PENDENTE: 'PENDENTE',
    CONFIRMADA: 'CONFIRMADA',
    APLICADA_AUTOMATICAMENTE: 'APLICADA_AUTOMATICAMENTE',
    CANCELADA: 'CANCELADA',
});

export const TIPOS_EVENTO_PONTO = Object.freeze({
    ENTRADA_AUTOMATICA: 'ENTRADA_AUTOMATICA',
    TRANSICAO_PENDENTE: 'TRANSICAO_PENDENTE',
    SAIDA_ALMOCO_CONFIRMADA: 'SAIDA_ALMOCO_CONFIRMADA',
    SAIDA_ALMOCO_AUTOMATICA: 'SAIDA_ALMOCO_AUTOMATICA',
    RETORNO_ALMOCO_AUTOMATICO: 'RETORNO_ALMOCO_AUTOMATICO',
    SAIDA_PAUSA_CONFIRMADA: 'SAIDA_PAUSA_CONFIRMADA',
    SAIDA_PAUSA_AUTOMATICA: 'SAIDA_PAUSA_AUTOMATICA',
    RETORNO_PAUSA_AUTOMATICO: 'RETORNO_PAUSA_AUTOMATICO',
    SAIDA_FINAL_AUTOMATICA: 'SAIDA_FINAL_AUTOMATICA',
    FALTA_REGISTRADA: 'FALTA_REGISTRADA',
    COMPROMISSO_CANCELADO: 'COMPROMISSO_CANCELADO',
    EXCECAO_MANUAL: 'EXCECAO_MANUAL',
    RETORNO_MANUAL: 'RETORNO_MANUAL',
    CORRECAO_MANUAL: 'CORRECAO_MANUAL',
});

export const TIPOS_EVENTO_TAREFA = Object.freeze({
    ATRIBUIDA: 'TAREFA_ATRIBUIDA',
    INICIADA: 'TAREFA_INICIADA',
    FINALIZADA: 'TAREFA_FINALIZADA',
    CANCELADA: 'TAREFA_CANCELADA',
});

const MODOS_RESOLUCAO = new Set(['manual', 'automatico']);

export async function pontoEventosDisponivel(dbClient) {
    const result = await dbClient.query(`
        SELECT
            to_regclass('public.ponto_eventos') IS NOT NULL AS possui_eventos,
            to_regclass('public.ponto_transicoes_pendentes') IS NOT NULL AS possui_transicoes
    `);
    return result.rows[0]?.possui_eventos === true
        && result.rows[0]?.possui_transicoes === true;
}

function exigirCampo(valor, nome) {
    if (valor === undefined || valor === null || valor === '') {
        throw new Error(`${nome} e obrigatorio para registrar evento de ponto.`);
    }
}

function normalizarPayload(payload) {
    return payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : {};
}

/**
 * Insere um evento uma unica vez por empresa e chave deterministica.
 * O chamador deve incluir esta operacao na mesma transacao da projecao que
 * estiver sendo atualizada.
 */
export async function registrarEventoPonto(dbClient, {
    empresaId,
    funcionarioId,
    dataJornada,
    tipoEvento,
    idempotencyKey,
    origem = ORIGENS_PONTO.SISTEMA,
    transicaoTipo = null,
    transicaoId = null,
    horarioPlanejado = null,
    horarioEfetivo = null,
    autorId = null,
    autorNome = null,
    motivo = null,
    payload = {},
}) {
    exigirCampo(empresaId, 'empresaId');
    exigirCampo(funcionarioId, 'funcionarioId');
    exigirCampo(dataJornada, 'dataJornada');
    exigirCampo(tipoEvento, 'tipoEvento');
    exigirCampo(idempotencyKey, 'idempotencyKey');

    const inserido = await dbClient.query(
        `INSERT INTO ponto_eventos
            (empresa_id, funcionario_id, data_jornada, tipo_evento, origem,
             transicao_tipo, transicao_id, horario_planejado, horario_efetivo,
             idempotency_key, autor_id, autor_nome, motivo, payload)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
         ON CONFLICT (empresa_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [
            empresaId,
            funcionarioId,
            dataJornada,
            tipoEvento,
            origem,
            transicaoTipo,
            transicaoId,
            horarioPlanejado,
            horarioEfetivo,
            idempotencyKey,
            autorId,
            autorNome,
            motivo,
            JSON.stringify(normalizarPayload(payload)),
        ]
    );

    if (inserido.rowCount > 0) {
        return { criado: true, evento: inserido.rows[0] };
    }

    const existente = await dbClient.query(
        `SELECT *
           FROM ponto_eventos
          WHERE empresa_id = $1
            AND idempotency_key = $2`,
        [empresaId, idempotencyKey]
    );
    if (existente.rowCount === 0) {
        throw new Error('O evento de ponto nao foi localizado apos conflito de idempotencia.');
    }
    return { criado: false, evento: existente.rows[0] };
}

/**
 * Registra o ciclo de vida de uma tarefa no mesmo livro append-only usado
 * pelo ponto. A sessao continua sendo a projecao operacional; este evento
 * preserva a causa, a empresa e a idempotencia do fato.
 */
export async function registrarEventoTarefa(dbClient, {
    empresaId,
    funcionarioId,
    dataJornada,
    tipoEvento,
    tarefaTipo,
    tarefaId,
    idempotencyKey,
    origem = ORIGENS_PONTO.SISTEMA,
    autorId = null,
    autorNome = null,
    motivo = null,
    payload = {},
}) {
    exigirCampo(tarefaTipo, 'tarefaTipo');
    exigirCampo(tarefaId, 'tarefaId');
    exigirCampo(tipoEvento, 'tipoEvento');

    return registrarEventoPonto(dbClient, {
        empresaId,
        funcionarioId,
        dataJornada,
        tipoEvento,
        idempotencyKey: idempotencyKey || `tarefa:${tarefaTipo}:${tarefaId}:${tipoEvento}`,
        origem,
        autorId,
        autorNome,
        motivo,
        payload: {
            ...normalizarPayload(payload),
            tarefa_tipo: tarefaTipo,
            tarefa_id: tarefaId,
        },
    });
}

/**
 * Abre a janela de confirmacao da saida de almoco/pausa.
 * A janela e de saida: o retorno E2/E3 continua sendo um evento automatico
 * separado no horario planejado.
 */
export async function abrirTransicaoPendente(dbClient, {
    empresaId,
    funcionarioId,
    dataJornada,
    tipoIntervalo,
    horarioSaidaPlanejado,
    horarioRetornoPlanejado,
    abreEm,
    venceEm,
    autorId = null,
    autorNome = null,
    payload = {},
}) {
    exigirCampo(tipoIntervalo, 'tipoIntervalo');
    exigirCampo(horarioSaidaPlanejado, 'horarioSaidaPlanejado');
    exigirCampo(horarioRetornoPlanejado, 'horarioRetornoPlanejado');
    exigirCampo(abreEm, 'abreEm');
    exigirCampo(venceEm, 'venceEm');

    const pendenteInserida = await dbClient.query(
        `INSERT INTO ponto_transicoes_pendentes
            (empresa_id, funcionario_id, data_jornada, tipo_intervalo,
             horario_saida_planejado, horario_retorno_planejado, abre_em, vence_em)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)
         ON CONFLICT (empresa_id, funcionario_id, data_jornada, tipo_intervalo)
         DO NOTHING
         RETURNING *`,
        [
            empresaId,
            funcionarioId,
            dataJornada,
            tipoIntervalo,
            horarioSaidaPlanejado,
            horarioRetornoPlanejado,
            abreEm,
            venceEm,
        ]
    );

    const transicao = pendenteInserida.rowCount > 0
        ? pendenteInserida.rows[0]
        : (await dbClient.query(
            `SELECT *
               FROM ponto_transicoes_pendentes
              WHERE empresa_id = $1
                AND funcionario_id = $2
                AND data_jornada = $3::date
                AND tipo_intervalo = $4`,
            [empresaId, funcionarioId, dataJornada, tipoIntervalo]
        )).rows[0];

    if (!transicao) {
        throw new Error('A transicao de ponto nao foi localizada apos conflito de idempotencia.');
    }

    if (transicao.status !== STATUS_TRANSICAO.PENDENTE) {
        return { criada: false, transicao };
    }

    const evento = await registrarEventoPonto(dbClient, {
        empresaId,
        funcionarioId,
        dataJornada,
        tipoEvento: TIPOS_EVENTO_PONTO.TRANSICAO_PENDENTE,
        idempotencyKey: `transicao-pendente:${dataJornada}:${funcionarioId}:${tipoIntervalo}`,
        origem: ORIGENS_PONTO.SISTEMA,
        transicaoTipo: tipoIntervalo,
        transicaoId: transicao.id,
        horarioPlanejado: horarioSaidaPlanejado,
        autorId,
        autorNome,
        payload: {
            ...normalizarPayload(payload),
            vence_em: venceEm,
            horario_retorno_planejado: horarioRetornoPlanejado,
        },
    });

    await dbClient.query(
        `UPDATE ponto_transicoes_pendentes
            SET evento_abertura_id = COALESCE(evento_abertura_id, $1),
                atualizado_em = NOW()
          WHERE id = $2`,
        [evento.evento.id, transicao.id]
    );

    return { criada: pendenteInserida.rowCount > 0, transicao, evento: evento.evento };
}

/**
 * Resolve uma janela. Para fallback automatico, a verificacao de venceEm
 * acontece antes da escrita; o horario efetivo continua sendo o planejado.
 */
export async function resolverTransicaoPendente(dbClient, {
    transicaoId,
    modo,
    horarioSaidaEfetivo,
    autorId = null,
    autorNome = null,
    motivo = null,
    agora = new Date(),
    tipoEvento,
    idempotencyKey,
    payload = {},
}) {
    exigirCampo(transicaoId, 'transicaoId');
    exigirCampo(modo, 'modo');
    exigirCampo(tipoEvento, 'tipoEvento');
    exigirCampo(idempotencyKey, 'idempotencyKey');
    if (!MODOS_RESOLUCAO.has(modo)) {
        throw new Error('modo deve ser manual ou automatico.');
    }

    const resultado = await dbClient.query(
        `SELECT *
           FROM ponto_transicoes_pendentes
          WHERE id = $1
          FOR UPDATE`,
        [transicaoId]
    );
    if (resultado.rowCount === 0) {
        throw new Error('Transicao de ponto nao encontrada.');
    }

    const transicao = resultado.rows[0];
    if (transicao.status !== STATUS_TRANSICAO.PENDENTE) {
        return { aplicada: false, ja_resolvida: true, transicao };
    }

    if (modo === 'automatico' && new Date(agora) < new Date(transicao.vence_em)) {
        return { aplicada: false, aguardando_janela: true, transicao };
    }

    const automatica = modo === 'automatico';
    const evento = await registrarEventoPonto(dbClient, {
        empresaId: transicao.empresa_id,
        funcionarioId: transicao.funcionario_id,
        dataJornada: transicao.data_jornada,
        tipoEvento,
        idempotencyKey,
        origem: automatica ? ORIGENS_PONTO.CRON : ORIGENS_PONTO.SUPERVISOR,
        transicaoTipo: transicao.tipo_intervalo,
        transicaoId: transicao.id,
        horarioPlanejado: transicao.horario_saida_planejado,
        horarioEfetivo: automatica
            ? transicao.horario_saida_planejado
            : (horarioSaidaEfetivo || transicao.horario_saida_planejado),
        autorId,
        autorNome,
        motivo,
        payload: {
            ...normalizarPayload(payload),
            processado_em: new Date(agora).toISOString(),
            fallback_automatico: automatica,
        },
    });

    const status = automatica
        ? STATUS_TRANSICAO.APLICADA_AUTOMATICAMENTE
        : STATUS_TRANSICAO.CONFIRMADA;
    const horarioEfetivo = automatica
        ? transicao.horario_saida_planejado
        : (horarioSaidaEfetivo || transicao.horario_saida_planejado);

    const atualizada = await dbClient.query(
        `UPDATE ponto_transicoes_pendentes
            SET status = $1,
                horario_saida_efetivo = $2,
                evento_resolucao_id = COALESCE(evento_resolucao_id, $3),
                autor_resolucao_id = $4,
                autor_resolucao_nome = $5,
                motivo_resolucao = $6,
                atualizado_em = NOW()
          WHERE id = $7
         RETURNING *`,
        [status, horarioEfetivo, evento.evento.id, autorId, autorNome, motivo, transicao.id]
    );

    return { aplicada: true, transicao: atualizada.rows[0], evento: evento.evento };
}
