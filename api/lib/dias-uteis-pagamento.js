/**
 * Dias úteis de pagamento (CLT Art. 459):
 * - contam: segunda a sábado
 * - não contam: domingo e feriados/folgas da empresa (calendario_empresa)
 *
 * Comissões: previsão = 1 dia útil após o 5º dia útil do mês de pagamento
 * (equivalente ao 6º dia útil, sem rotular assim na UI).
 */

/**
 * @param {Date} dataInicioUtc - cursor inicial (UTC meio-dia ou início do mês)
 * @param {number} quantos - quantos dias úteis avançar (inclusive no contador)
 * @param {Set<string>} datasExcluidas - YYYY-MM-DD
 * @returns {Date}
 */
export function enesimoDiaUtilPagamento(dataInicioUtc, quantos, datasExcluidas = new Set()) {
    let cursor = new Date(dataInicioUtc);
    let contados = 0;
    let guard = 0;
    while (contados < quantos && guard < 120) {
        guard += 1;
        const dow = cursor.getUTCDay();
        const dateStr = cursor.toISOString().slice(0, 10);
        if (dow !== 0 && !datasExcluidas.has(dateStr)) {
            contados += 1;
            if (contados === quantos) break;
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return cursor;
}

/**
 * Próximo dia útil de pagamento estritamente após a data informada.
 * @param {Date} dataUtc
 * @param {Set<string>} datasExcluidas
 * @returns {Date}
 */
export function proximoDiaUtilPagamentoApos(dataUtc, datasExcluidas = new Set()) {
    const cursor = new Date(dataUtc);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    for (let i = 0; i < 60; i += 1) {
        const dow = cursor.getUTCDay();
        const dateStr = cursor.toISOString().slice(0, 10);
        if (dow !== 0 && !datasExcluidas.has(dateStr)) return cursor;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return cursor;
}

/**
 * Previsão de pagamento de comissões no mês (YYYY-MM) de referência do pagamento.
 * @param {number} ano
 * @param {number} mes1a12 - mês 1–12 do pagamento (mês seguinte ao fim do ciclo)
 * @param {Set<string>} datasExcluidas
 */
export function previsaoPagamentoComissao(ano, mes1a12, datasExcluidas = new Set()) {
    const primeiroDia = new Date(Date.UTC(ano, mes1a12 - 1, 1));
    const quintoDiaUtil = enesimoDiaUtilPagamento(primeiroDia, 5, datasExcluidas);
    const dataPrevisao = proximoDiaUtilPagamentoApos(quintoDiaUtil, datasExcluidas);
    const isoQuinto = quintoDiaUtil.toISOString().slice(0, 10);
    const isoPrevisao = dataPrevisao.toISOString().slice(0, 10);
    const formatar = (iso) =>
        new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
        });

    return {
        quintoDiaUtil: isoQuinto,
        quintoDiaUtilFormatado: formatar(isoQuinto),
        dataPagamento: isoPrevisao,
        dataFormatada: formatar(isoPrevisao),
        isPrevisao: true,
        nota: 'Previsão de pagamento de comissões: um dia útil após o 5º dia útil (seg–sáb). Pode ser antecipada.',
    };
}
