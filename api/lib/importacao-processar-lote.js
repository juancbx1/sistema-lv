/**
 * Processa linhas normalizadas do extrato → inserts em fc_importacao_linhas + lote.
 */
import {
    hashArquivo,
    hashLinha,
    normalizarDescricao,
    scoreMatchLinhaLancamento,
    sugerirClassificacao,
} from './importacao-extrato-helpers.js';
import {
    carregarAgendaPendente,
    carregarLancamentosOutrasContas,
    enriquecerLinha,
} from './importacao-enriquecer.js';

async function buscarFitIdJaUsado(dbClient, empresaId, idConta, fitId) {
    if (!fitId) return null;
    const r = await dbClient.query(
        `SELECT il.id, il.id_importacao, il.status_linha, il.id_lancamento_vinculado
           FROM fc_importacao_linhas il
           JOIN fc_importacoes_extrato i
             ON i.id = il.id_importacao AND i.empresa_id = il.empresa_id
          WHERE il.empresa_id = $1
            AND i.id_conta_bancaria = $2
            AND il.fit_id = $3
            AND il.status_linha IN ('CONCILIADO', 'NOVO_APROVADO', 'DUPLICATA')
            AND i.status <> 'CANCELADO'
          ORDER BY il.id DESC
          LIMIT 1`,
        [empresaId, idConta, fitId]
    );
    return r.rows[0] || null;
}

async function buscarHashJaAprovado(dbClient, empresaId, idConta, hash) {
    const r = await dbClient.query(
        `SELECT il.id, il.id_importacao, il.status_linha, il.id_lancamento_vinculado
           FROM fc_importacao_linhas il
           JOIN fc_importacoes_extrato i
             ON i.id = il.id_importacao AND i.empresa_id = il.empresa_id
          WHERE il.empresa_id = $1
            AND i.id_conta_bancaria = $2
            AND il.hash_linha = $3
            AND il.status_linha IN ('CONCILIADO', 'NOVO_APROVADO')
            AND i.status <> 'CANCELADO'
          ORDER BY il.id DESC
          LIMIT 1`,
        [empresaId, idConta, hash]
    );
    return r.rows[0] || null;
}

async function carregarCandidatosMatch(dbClient, empresaId, idConta, periodoInicio, periodoFim) {
    const r = await dbClient.query(
        `SELECT l.id, l.tipo, l.valor, l.data_transacao, l.descricao, l.id_categoria, l.id_contato,
                EXISTS (
                    SELECT 1 FROM fc_importacao_linhas il
                     WHERE il.empresa_id = l.empresa_id
                       AND il.id_lancamento_vinculado = l.id
                       AND il.status_linha IN ('CONCILIADO', 'NOVO_APROVADO')
                ) AS ja_vinculado
           FROM fc_lancamentos l
          WHERE l.empresa_id = $1
            AND l.id_conta_bancaria = $2
            AND l.excluido_em IS NULL
            AND l.data_transacao >= ($3::date - INTERVAL '3 days')
            AND l.data_transacao <= ($4::date + INTERVAL '3 days')
          ORDER BY l.data_transacao DESC, l.id DESC
          LIMIT 2000`,
        [empresaId, idConta, periodoInicio, periodoFim]
    );
    return r.rows;
}

export function montarResumo(linhas) {
    const contagens = {
        total: linhas.length,
        pendentes: 0,
        conciliados: 0,
        novos: 0,
        ignorados: 0,
        duplicatas: 0,
        possiveis: 0,
    };
    for (const l of linhas) {
        if (l.status_linha === 'DUPLICATA') contagens.duplicatas += 1;
        else if (l.status_linha === 'IGNORADO' || l.status_linha === 'DESCARTADO') contagens.ignorados += 1;
        else if (l.status_linha === 'CONCILIADO' || l.id_lancamento_sugerido) {
            if (l.score_match != null && Number(l.score_match) >= 0.85) contagens.conciliados += 1;
            else if (l.id_lancamento_sugerido) contagens.possiveis += 1;
            else contagens.novos += 1;
        } else contagens.novos += 1;
        if (l.status_linha === 'PENDENTE') contagens.pendentes += 1;
    }
    return contagens;
}

/**
 * @param {object} opts
 * @param {import('pg').PoolClient} opts.dbClient
 * @param {number} opts.empresaId
 * @param {number} opts.idUsuario
 * @param {number} opts.idConta
 * @param {'OFX'|'CSV'|'XLSX'|'PDF'} opts.formato
 * @param {string} opts.nomeArquivo
 * @param {Buffer} opts.fileBuffer
 * @param {{ linhas: any[], periodoInicio?: string|null, periodoFim?: string|null }} opts.parsed
 * @param {object|null} opts.mapeamento
 */
export async function processarLoteImportacao({
    dbClient,
    empresaId,
    idUsuario,
    idConta,
    formato,
    nomeArquivo,
    fileBuffer,
    parsed,
    mapeamento = null,
}) {
    const fileHash = hashArquivo(fileBuffer);
    const periodoInicio = parsed.periodoInicio || parsed.linhas[0]?.data;
    const periodoFim = parsed.periodoFim || parsed.linhas[parsed.linhas.length - 1]?.data;

    const resumoInicial = {
        mapeamento: mapeamento || undefined,
    };

    const loteRes = await dbClient.query(
        `INSERT INTO fc_importacoes_extrato
            (empresa_id, id_conta_bancaria, formato, nome_arquivo, hash_arquivo,
             periodo_inicio, periodo_fim, status, resumo_json, id_usuario)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PROCESSANDO', $8::jsonb, $9)
         RETURNING *`,
        [
            empresaId,
            idConta,
            formato,
            nomeArquivo,
            fileHash,
            periodoInicio,
            periodoFim,
            JSON.stringify(resumoInicial),
            idUsuario,
        ]
    );
    const lote = loteRes.rows[0];

    const candidatos = await carregarCandidatosMatch(
        dbClient,
        empresaId,
        idConta,
        periodoInicio,
        periodoFim
    );
    const usadosLanc = new Set(
        candidatos.filter((c) => c.ja_vinculado).map((c) => Number(c.id))
    );

    let agendaCandidatos = [];
    let lancOutrasContas = [];
    try {
        agendaCandidatos = await carregarAgendaPendente(
            dbClient, empresaId, periodoInicio, periodoFim
        );
    } catch (e) {
        console.warn('[importacao] agenda pendente indisponível:', e.message);
    }
    try {
        lancOutrasContas = await carregarLancamentosOutrasContas(
            dbClient, empresaId, idConta, periodoInicio, periodoFim
        );
    } catch (e) {
        console.warn('[importacao] outras contas indisponível:', e.message);
    }
    const usadosAgenda = new Set();

    const linhasMontadas = [];
    let qtdTransfer = 0;
    let qtdAgenda = 0;

    for (const raw of parsed.linhas) {
        const descNorm = normalizarDescricao(raw.descricao);
        const h = hashLinha({
            idConta,
            data: raw.data,
            valor: raw.valor,
            sentido: raw.sentido,
            descricaoNormalizada: descNorm,
            fitId: raw.fitId,
        });

        let statusLinha = 'PENDENTE';
        let idLancSugerido = null;
        let score = null;
        let idCatSug = null;
        let idContatoSug = null;
        let idCat = null;
        let idContato = null;
        const descFinal = raw.descricao;

        const fitUsado = await buscarFitIdJaUsado(dbClient, empresaId, idConta, raw.fitId);
        const hashUsado = !fitUsado
            ? await buscarHashJaAprovado(dbClient, empresaId, idConta, h)
            : null;

        if (fitUsado || hashUsado) {
            statusLinha = 'DUPLICATA';
            const prev = fitUsado || hashUsado;
            idLancSugerido = prev.id_lancamento_vinculado || null;
        } else {
            let melhorScore = 0;
            let melhorId = null;
            for (const cand of candidatos) {
                const cid = Number(cand.id);
                if (usadosLanc.has(cid)) continue;
                const s = scoreMatchLinhaLancamento(
                    {
                        valor: raw.valor,
                        tipo_movimento: raw.sentido,
                        data_transacao: raw.data,
                        descricao_normalizada: descNorm,
                        descricao_original: raw.descricao,
                    },
                    cand
                );
                if (s > melhorScore) {
                    melhorScore = s;
                    melhorId = cid;
                }
            }

            if (melhorId != null && melhorScore >= 0.55) {
                idLancSugerido = melhorId;
                score = melhorScore;
                if (melhorScore >= 0.85) usadosLanc.add(melhorId);
            } else {
                const sug = await sugerirClassificacao(dbClient, empresaId, {
                    descricaoNormalizada: descNorm,
                    tipoMovimento: raw.sentido,
                    idConta,
                });
                idCatSug = sug.id_categoria;
                idContatoSug = sug.id_contato;
                idCat = sug.id_categoria;
                idContato = sug.id_contato;
            }
        }

        const flags = enriquecerLinha({
            raw,
            descNorm,
            idLancSugerido,
            agendaCandidatos,
            lancOutrasContas,
            usadosAgenda,
        });
        if (flags.transferencia_interna) qtdTransfer += 1;
        if (flags.id_agenda_sugerida) qtdAgenda += 1;

        // Sugestão forte de transferência sem match local → pré-marca ignorar (usuário pode reverter)
        if (flags.sugerir_ignorar && statusLinha === 'PENDENTE' && !idLancSugerido && flags.score_transferencia >= 0.85) {
            statusLinha = 'IGNORADO';
        }

        const payload = {
            ...(raw.bruto || {}),
            flags_fase3: flags,
        };

        const ins = await dbClient.query(
            `INSERT INTO fc_importacao_linhas
                (empresa_id, id_importacao, fit_id, hash_linha, data_transacao, valor,
                 tipo_movimento, descricao_original, descricao_normalizada, memo_banco,
                 documento, status_linha, id_lancamento_sugerido, score_match,
                 id_categoria_sugerida, id_contato_sugerido, id_categoria, id_contato,
                 descricao_final, payload_bruto_json)
             VALUES
                ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
             RETURNING *`,
            [
                empresaId,
                lote.id,
                raw.fitId || null,
                h,
                raw.data,
                raw.valor,
                raw.sentido,
                raw.descricao,
                descNorm,
                raw.bruto?.MEMO || raw.bruto?.memo || null,
                raw.documento || null,
                statusLinha,
                idLancSugerido,
                score,
                idCatSug,
                idContatoSug,
                idCat,
                idContato,
                descFinal,
                JSON.stringify(payload),
            ]
        );
        linhasMontadas.push(ins.rows[0]);
    }

    const resumo = {
        ...montarResumo(linhasMontadas),
        mapeamento: mapeamento || undefined,
        transferencias_detectadas: qtdTransfer,
        agenda_sugeridas: qtdAgenda,
        meta_parse: parsed.meta || undefined,
    };
    const loteFinal = await dbClient.query(
        `UPDATE fc_importacoes_extrato
            SET status = 'EM_REVISAO',
                resumo_json = $1
          WHERE id = $2 AND empresa_id = $3
          RETURNING *`,
        [JSON.stringify(resumo), lote.id, empresaId]
    );

    return {
        importacao: loteFinal.rows[0],
        linhas: linhasMontadas,
        resumo,
    };
}
