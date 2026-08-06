/**
 * Parser OFX mínimo (SGML/XML) para STMTTRN.
 * Aceita OFX 1.x (SGML) e 2.x (XML) sem dependências externas.
 */

function limparTagValor(raw) {
    if (raw == null) return '';
    return String(raw)
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

/**
 * Extrai valor de tag OFX no bloco (suporta <TAG>valor e <TAG>valor</TAG>).
 */
function valorTag(bloco, tag) {
    const reFechada = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
    const mFechada = bloco.match(reFechada);
    if (mFechada) return limparTagValor(mFechada[1]);

    const reAberta = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i');
    const mAberta = bloco.match(reAberta);
    if (mAberta) return limparTagValor(mAberta[1]);
    return '';
}

/**
 * Converte DTPOSTED OFX (YYYYMMDD[HHMMSS[.XXX]][TZ]) para YYYY-MM-DD.
 */
export function parseDataOfx(dtposted) {
    const digits = String(dtposted || '').replace(/[^\d]/g, '');
    if (digits.length < 8) return null;
    const y = digits.slice(0, 4);
    const m = digits.slice(4, 6);
    const d = digits.slice(6, 8);
    const iso = `${y}-${m}-${d}`;
    if (Number.isNaN(Date.parse(`${iso}T12:00:00Z`))) return null;
    return iso;
}

/**
 * @param {string|Buffer} input
 * @returns {{
 *   linhas: Array<{
 *     data: string,
 *     valor: number,
 *     sentido: 'CREDITO'|'DEBITO',
 *     descricao: string,
 *     fitId?: string,
 *     documento?: string,
 *     bruto: object
 *   }>,
 *   periodoInicio: string|null,
 *   periodoFim: string|null,
 *   moeda: string|null
 * }}
 */
export function parseOfx(input) {
    const texto = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
    if (!texto.trim()) {
        const err = new Error('Arquivo OFX vazio.');
        err.statusCode = 400;
        throw err;
    }

    // Remove header SGML (até o primeiro <OFX>)
    const idxOfx = texto.search(/<OFX[\s>]/i);
    const corpo = idxOfx >= 0 ? texto.slice(idxOfx) : texto;

    const blocos = [];
    const reBloco = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/?BANKTRANLIST)|(?=<\/?STMTRS)|(?=<\/?OFX)|$)/gi;
    let match;
    while ((match = reBloco.exec(corpo)) !== null) {
        const conteudo = match[1];
        if (conteudo && /TRNAMT/i.test(conteudo)) {
            blocos.push(conteudo);
        }
    }

    // Fallback: alguns arquivos usam <STMTTRN>...</STMTTRN> bem formados
    if (blocos.length === 0) {
        const reXml = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
        while ((match = reXml.exec(corpo)) !== null) {
            if (match[1] && /TRNAMT/i.test(match[1])) blocos.push(match[1]);
        }
    }

    if (blocos.length === 0) {
        const err = new Error('Nenhuma transação (STMTTRN) encontrada no OFX.');
        err.statusCode = 400;
        throw err;
    }

    const linhas = [];
    for (const bloco of blocos) {
        const trnamtRaw = valorTag(bloco, 'TRNAMT');
        const trnamt = Number(String(trnamtRaw).replace(',', '.'));
        if (!Number.isFinite(trnamt) || trnamt === 0) continue;

        const data = parseDataOfx(valorTag(bloco, 'DTPOSTED'));
        if (!data) continue;

        const fitId = valorTag(bloco, 'FITID') || undefined;
        const memo = valorTag(bloco, 'MEMO');
        const name = valorTag(bloco, 'NAME');
        const checknum = valorTag(bloco, 'CHECKNUM') || undefined;
        const trntype = valorTag(bloco, 'TRNTYPE');
        const descricao = [name, memo].filter(Boolean).join(' — ') || trntype || 'Movimentação OFX';

        const sentido = trnamt > 0 ? 'CREDITO' : 'DEBITO';
        const valor = Math.abs(trnamt);

        linhas.push({
            data,
            valor: Math.round(valor * 100) / 100,
            sentido,
            descricao,
            fitId: fitId || undefined,
            documento: checknum || undefined,
            bruto: {
                DTPOSTED: valorTag(bloco, 'DTPOSTED'),
                TRNAMT: trnamtRaw,
                FITID: fitId || null,
                NAME: name || null,
                MEMO: memo || null,
                CHECKNUM: checknum || null,
                TRNTYPE: trntype || null,
            },
        });
    }

    if (linhas.length === 0) {
        const err = new Error('OFX lido, mas nenhuma linha válida de transação foi obtida.');
        err.statusCode = 400;
        throw err;
    }

    const datas = linhas.map((l) => l.data).sort();
    const moeda =
        valorTag(corpo, 'CURDEF') ||
        valorTag(corpo, 'CURRENCY') ||
        null;

    return {
        linhas,
        periodoInicio: datas[0] || null,
        periodoFim: datas[datas.length - 1] || null,
        moeda,
    };
}

export default parseOfx;
