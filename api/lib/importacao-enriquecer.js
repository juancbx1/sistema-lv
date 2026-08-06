/**
 * Enriquecimento fase 3: transferência interna e match com Agenda.
 */
import { normalizarDescricao, similaridadeTexto } from './importacao-extrato-helpers.js';

const RE_TRANSF = /\b(transf|transferencia|transferência|ted\s*mesma|entre\s*contas|mesma\s*titularidade|aplicacao|aplica[cç][aã]o|resgate|movimentacao\s*interna)\b/i;

export function pareceTransferencia(descricao) {
    return RE_TRANSF.test(String(descricao || ''));
}

/**
 * Busca candidatos de agenda pendente na empresa (janela de datas).
 */
export async function carregarAgendaPendente(dbClient, empresaId, periodoInicio, periodoFim) {
    const r = await dbClient.query(
        `SELECT a.id, a.tipo, a.valor, a.data_vencimento, a.descricao, a.id_categoria, a.id_contato
           FROM fc_contas_agendadas a
          WHERE a.empresa_id = $1
            AND a.status = 'PENDENTE'
            AND a.excluido_em IS NULL
            AND a.data_vencimento >= ($2::date - INTERVAL '5 days')
            AND a.data_vencimento <= ($3::date + INTERVAL '5 days')
          ORDER BY a.data_vencimento DESC
          LIMIT 800`,
        [empresaId, periodoInicio, periodoFim]
    );
    return r.rows;
}

/**
 * Lançamentos de OUTRAS contas (para detectar transferência interna).
 */
export async function carregarLancamentosOutrasContas(
    dbClient,
    empresaId,
    idContaExcluir,
    periodoInicio,
    periodoFim
) {
    const r = await dbClient.query(
        `SELECT l.id, l.tipo, l.valor, l.data_transacao, l.descricao, l.id_conta_bancaria,
                cb.nome_conta
           FROM fc_lancamentos l
           JOIN fc_contas_bancarias cb
             ON cb.id = l.id_conta_bancaria AND cb.empresa_id = l.empresa_id
          WHERE l.empresa_id = $1
            AND l.id_conta_bancaria <> $2
            AND l.excluido_em IS NULL
            AND l.data_transacao >= ($3::date - INTERVAL '3 days')
            AND l.data_transacao <= ($4::date + INTERVAL '3 days')
          ORDER BY l.data_transacao DESC
          LIMIT 1500`,
        [empresaId, idContaExcluir, periodoInicio, periodoFim]
    );
    return r.rows;
}

function diffDias(isoA, isoB) {
    const a = Date.parse(`${String(isoA).slice(0, 10)}T12:00:00Z`);
    const b = Date.parse(`${String(isoB).slice(0, 10)}T12:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 99;
    return Math.abs(Math.round((a - b) / 86400000));
}

/**
 * Score agenda: valor + tipo coerente + data + descrição.
 * tipo_movimento CREDITO ↔ A_RECEBER / RECEITA; DEBITO ↔ A_PAGAR / DESPESA
 */
export function scoreMatchAgenda(linha, agenda) {
    const valorL = Number(linha.valor);
    const valorA = Math.abs(Number(agenda.valor));
    if (Math.abs(valorL - valorA) > 0.009) return 0;

    const tipoAgenda = String(agenda.tipo || '').toUpperCase();
    const okTipo =
        (linha.tipo_movimento === 'DEBITO' && (tipoAgenda.includes('PAGAR') || tipoAgenda === 'DESPESA' || tipoAgenda === 'A_PAGAR'))
        || (linha.tipo_movimento === 'CREDITO' && (tipoAgenda.includes('RECEBER') || tipoAgenda === 'RECEITA' || tipoAgenda === 'A_RECEBER'));
    // tipos comuns: A_PAGAR, A_RECEBER
    if (!okTipo) {
        // fallback flexível
        if (!(
            (linha.tipo_movimento === 'DEBITO' && /PAG|DESP/i.test(tipoAgenda))
            || (linha.tipo_movimento === 'CREDITO' && /RECE|REC/i.test(tipoAgenda))
        )) {
            // se tipo desconhecido, ainda permite se valor+data batem forte
            if (diffDias(linha.data_transacao, agenda.data_vencimento) > 1) return 0;
        }
    }

    let score = 0.5;
    const dias = diffDias(linha.data_transacao, agenda.data_vencimento);
    if (dias === 0) score += 0.3;
    else if (dias <= 2) score += 0.18;
    else if (dias <= 5) score += 0.08;
    else return 0;

    const sim = similaridadeTexto(
        linha.descricao_normalizada || normalizarDescricao(linha.descricao_original),
        normalizarDescricao(agenda.descricao)
    );
    score += sim * 0.2;
    return Math.min(1, Math.round(score * 1000) / 1000);
}

/**
 * Detecta perna de transferência em outra conta.
 */
export function scoreTransferenciaPar(linha, lancOutra) {
    const valorL = Number(linha.valor);
    const valorO = Math.abs(Number(lancOutra.valor));
    if (Math.abs(valorL - valorO) > 0.009) return 0;

    // pernas opostas: débito local ↔ crédito outra (ou vice-versa)
    const tipoOposto =
        (linha.tipo_movimento === 'DEBITO' && lancOutra.tipo === 'RECEITA')
        || (linha.tipo_movimento === 'CREDITO' && lancOutra.tipo === 'DESPESA');
    if (!tipoOposto) return 0;

    const dias = diffDias(linha.data_transacao, lancOutra.data_transacao);
    if (dias > 2) return 0;

    let score = 0.55;
    if (dias === 0) score += 0.2;
    else score += 0.1;

    if (pareceTransferencia(linha.descricao_original) || pareceTransferencia(lancOutra.descricao)) {
        score += 0.15;
    }

    const sim = similaridadeTexto(
        normalizarDescricao(linha.descricao_original),
        normalizarDescricao(lancOutra.descricao)
    );
    score += sim * 0.1;
    return Math.min(1, score);
}

/**
 * Enriquece flags no objeto bruto da linha (antes do insert).
 */
export function enriquecerLinha({
    raw,
    descNorm,
    idLancSugerido,
    agendaCandidatos,
    lancOutrasContas,
    usadosAgenda,
}) {
    const flags = {
        transferencia_interna: false,
        id_transferencia_par: null,
        nome_conta_par: null,
        score_transferencia: null,
        id_agenda_sugerida: null,
        score_agenda: null,
        desc_agenda: null,
        sugerir_ignorar: false,
        motivo_sugestao: null,
    };

    // Transferência entre contas da mesma empresa
    {
        let melhorT = 0;
        let melhorPar = null;
        for (const o of lancOutrasContas) {
            const s = scoreTransferenciaPar(
                {
                    valor: raw.valor,
                    tipo_movimento: raw.sentido,
                    data_transacao: raw.data,
                    descricao_original: raw.descricao,
                },
                o
            );
            if (s > melhorT) {
                melhorT = s;
                melhorPar = o;
            }
        }
        if (melhorPar && melhorT >= 0.7) {
            flags.transferencia_interna = true;
            flags.id_transferencia_par = Number(melhorPar.id);
            flags.nome_conta_par = melhorPar.nome_conta;
            flags.score_transferencia = melhorT;
            if (!idLancSugerido) {
                flags.sugerir_ignorar = true;
                flags.motivo_sugestao = `Transferência interna com ${melhorPar.nome_conta} (#${melhorPar.id})`;
            }
        } else if (pareceTransferencia(raw.descricao) && !idLancSugerido) {
            flags.transferencia_interna = true;
            flags.sugerir_ignorar = false;
            flags.motivo_sugestao = 'Descrição indica transferência (confira se há perna na outra conta)';
        }
    }

    // Agenda: se não é match de lançamento
    if (!idLancSugerido && agendaCandidatos?.length) {
        let melhorA = 0;
        let melhorAg = null;
        for (const ag of agendaCandidatos) {
            if (usadosAgenda?.has(Number(ag.id))) continue;
            const s = scoreMatchAgenda(
                {
                    valor: raw.valor,
                    tipo_movimento: raw.sentido,
                    data_transacao: raw.data,
                    descricao_normalizada: descNorm,
                    descricao_original: raw.descricao,
                },
                ag
            );
            if (s > melhorA) {
                melhorA = s;
                melhorAg = ag;
            }
        }
        if (melhorAg && melhorA >= 0.7) {
            flags.id_agenda_sugerida = Number(melhorAg.id);
            flags.score_agenda = melhorA;
            flags.desc_agenda = melhorAg.descricao;
            usadosAgenda?.add(Number(melhorAg.id));
            if (melhorA >= 0.85) {
                flags.motivo_sugestao = (flags.motivo_sugestao ? `${flags.motivo_sugestao}; ` : '')
                    + `Possível baixa de agenda #${melhorAg.id}`;
            }
        }
    }

    return flags;
}
