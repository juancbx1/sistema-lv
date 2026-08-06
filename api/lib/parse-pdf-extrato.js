/**
 * Parser de extratos bancários em PDF (melhor esforço).
 * Extrai texto via pdf-parse v2 e aplica heurísticas de extratos BR.
 *
 * Limitações: PDFs escaneados (imagem) não têm texto; layouts muito
 * customizados podem falhar — nesses casos use OFX/CSV.
 */

import { PDFParse } from 'pdf-parse';
import { parseDataExtrato, parseValorMonetario } from './parse-csv-extrato.js';

function limparLinha(s) {
    return String(s || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

/** Valor no fim da linha: 1.234,56 | 1234.56 | (150,00) | 150,00- | -150,50 */
const RE_VALOR_FIM = /([(+-]?\s*(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2}|\d+,\d{2})\s*[-–)]?\s*([DC])?\s*$/i;
const RE_DATA_INI = /^(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?|\d{4}-\d{2}-\d{2})\b/;
const RE_SALDO_LIXO = /\b(saldo\s*(anterior|atual|do\s*dia|final|inicial|bloqueado)|extrato|agencia|ag[eê]ncia|conta\s*corrente|pagina\s*\d|cnpj|cpf\s*:|www\.|http)/i;

/**
 * Interpreta valor textual e devolve { valorAbs, sentido }.
 */
function interpretarValorToken(token, tipoLetra) {
    let raw = String(token || '').trim();
    let neg = false;
    if (/\(\s*.+\s*\)/.test(raw) || /-\s*$/.test(raw) || /^-\s*/.test(raw)) {
        neg = true;
        raw = raw.replace(/[()]/g, '').replace(/-/g, '').trim();
    }
    const n = parseValorMonetario(raw);
    if (n == null || n === 0) return null;

    let sentido;
    const letra = String(tipoLetra || '').toUpperCase();
    if (letra === 'D') sentido = 'DEBITO';
    else if (letra === 'C') sentido = 'CREDITO';
    else if (neg || n < 0) sentido = 'DEBITO';
    else sentido = 'CREDITO';

    return { valor: Math.abs(n), sentido };
}

/**
 * Tenta extrair uma transação de uma linha de texto.
 * @returns {null|{data, valor, sentido, descricao, bruto}}
 */
export function parseLinhaExtratoPdf(linha, contexto = {}) {
    const text = limparLinha(linha);
    if (!text || text.length < 8) return null;
    if (RE_SALDO_LIXO.test(text) && !RE_DATA_INI.test(text)) return null;

    const mData = text.match(RE_DATA_INI);
    if (!mData) return null;

    const data = parseDataExtrato(mData[1], contexto.formatoData || 'DD/MM/YYYY');
    if (!data) return null;

    // ignora linhas só de saldo do dia
    if (/\bsaldo\b/i.test(text) && !/\b(pix|ted|doc|pagto|compra|transf|boleto)\b/i.test(text)) {
        return null;
    }

    const mValor = text.match(RE_VALOR_FIM);
    if (!mValor) return null;

    const valorInfo = interpretarValorToken(mValor[1], mValor[2]);
    if (!valorInfo) return null;

    // descrição = meio da linha
    let desc = text.slice(mData[0].length, text.length - mValor[0].length).trim();
    desc = desc.replace(/^[\s\-–|]+/, '').replace(/[\s\-–|]+$/, '');
    // remove colunas de documento soltas no fim
    desc = desc.replace(/\s+\d{5,}\s*$/, '').trim();
    if (!desc || desc.length < 2) desc = 'Movimentação PDF';

    // se a descrição parece header
    if (/^(data|historico|histórico|lançamento|descricao|descrição|valor)$/i.test(desc)) return null;

    return {
        data,
        valor: valorInfo.valor,
        sentido: valorInfo.sentido,
        descricao: desc,
        fitId: undefined,
        documento: undefined,
        bruto: {
            fonte: 'PDF',
            linha_original: text,
        },
    };
}

/**
 * Une linhas quebradas: data em uma linha e valor na seguinte.
 */
export function fundirLinhasQuebradas(linhasTexto) {
    const out = [];
    for (let i = 0; i < linhasTexto.length; i += 1) {
        let cur = limparLinha(linhasTexto[i]);
        if (!cur) continue;
        const temData = RE_DATA_INI.test(cur);
        const temValor = RE_VALOR_FIM.test(cur);
        if (temData && !temValor && i + 1 < linhasTexto.length) {
            const next = limparLinha(linhasTexto[i + 1]);
            if (next && RE_VALOR_FIM.test(next) && !RE_DATA_INI.test(next)) {
                cur = `${cur} ${next}`;
                i += 1;
            } else if (next && !RE_DATA_INI.test(next) && i + 2 < linhasTexto.length) {
                const next2 = limparLinha(linhasTexto[i + 2]);
                if (next2 && RE_VALOR_FIM.test(next2)) {
                    cur = `${cur} ${next} ${next2}`;
                    i += 2;
                }
            }
        }
        out.push(cur);
    }
    return out;
}

/**
 * Converte texto de PDF em linhas normalizadas do pipeline.
 */
export function parseTextoExtratoPdf(texto) {
    const bruto = String(texto || '');
    if (!bruto.trim()) {
        const err = new Error('PDF sem texto extraível (pode ser escaneado). Exporte OFX/CSV ou use OCR.');
        err.statusCode = 400;
        err.code = 'PDF_SEM_TEXTO';
        throw err;
    }

    const linhasRaw = bruto.split(/\r?\n/).map(limparLinha).filter(Boolean);
    const fundidas = fundirLinhasQuebradas(linhasRaw);

    const linhas = [];
    const vistos = new Set();
    for (const ln of fundidas) {
        const parsed = parseLinhaExtratoPdf(ln);
        if (!parsed) continue;
        const key = `${parsed.data}|${parsed.valor}|${parsed.sentido}|${parsed.descricao}`;
        if (vistos.has(key)) continue;
        vistos.add(key);
        linhas.push(parsed);
    }

    if (!linhas.length) {
        const err = new Error(
            'Não foi possível identificar lançamentos no PDF. Layout não reconhecido — tente OFX ou CSV.'
        );
        err.statusCode = 400;
        err.code = 'PDF_SEM_LINHAS';
        err.preview_texto = bruto.slice(0, 800);
        throw err;
    }

    const datas = linhas.map((l) => l.data).sort();
    return {
        linhas,
        periodoInicio: datas[0],
        periodoFim: datas[datas.length - 1],
        moeda: 'BRL',
        meta: {
            linhas_texto: fundidas.length,
            linhas_parseadas: linhas.length,
        },
    };
}

/**
 * @param {Buffer} buffer
 * @param {string} [filename]
 */
export async function parsePdfExtrato(buffer, filename = 'extrato.pdf') {
    if (!buffer?.length) {
        const err = new Error('Arquivo PDF vazio.');
        err.statusCode = 400;
        throw err;
    }
    // magic %PDF
    const head = buffer.slice(0, 5).toString('utf8');
    if (!head.startsWith('%PDF')) {
        const err = new Error('Arquivo não parece ser um PDF válido.');
        err.statusCode = 400;
        throw err;
    }

    let parser;
    try {
        parser = new PDFParse({ data: buffer });
        const textResult = await parser.getText();
        const texto = textResult?.text || '';

        // tenta tabelas se texto linha-a-linha falhar parcialmente
        let parsed = null;
        try {
            parsed = parseTextoExtratoPdf(texto);
        } catch (e1) {
            // tenta via getTable
            try {
                const tables = await parser.getTable();
                const linhasTab = [];
                const pages = tables?.pages || tables?.tables || [];
                // API pode variar — normaliza
                if (Array.isArray(tables?.pages)) {
                    for (const page of tables.pages) {
                        for (const table of page.tables || []) {
                            for (const row of table) {
                                if (Array.isArray(row)) linhasTab.push(row.map((c) => String(c ?? '')).join(' '));
                            }
                        }
                    }
                }
                if (linhasTab.length) {
                    parsed = parseTextoExtratoPdf(linhasTab.join('\n'));
                } else {
                    throw e1;
                }
            } catch {
                throw e1;
            }
        }

        return {
            formato: 'PDF',
            nomeArquivo: filename,
            ...parsed,
            texto_preview: String(texto).slice(0, 500),
        };
    } catch (error) {
        if (error.statusCode) throw error;
        console.error('[parsePdfExtrato]', error);
        const err = new Error(
            error.message?.includes('password')
                ? 'PDF protegido por senha não é suportado.'
                : `Falha ao ler PDF: ${error.message || 'erro desconhecido'}`
        );
        err.statusCode = 400;
        throw err;
    } finally {
        if (parser) {
            try {
                await parser.destroy();
            } catch {
                /* ignore */
            }
        }
    }
}

export default parsePdfExtrato;
