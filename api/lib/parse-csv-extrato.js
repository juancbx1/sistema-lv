/**
 * Parser de extratos CSV / XLSX com mapeamento de colunas.
 * CSV: parser próprio (delimiter auto ; ou ,).
 * XLSX: sheetjs (xlsx).
 */

import XLSX from 'xlsx';

function limparCelula(v) {
    if (v == null) return '';
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
        return v.toISOString().slice(0, 10);
    }
    return String(v).replace(/^\uFEFF/, '').trim();
}

/** Detecta delimitador pelo cabeçalho. */
export function detectarDelimiter(texto) {
    const primeira = String(texto).split(/\r?\n/).find((l) => l.trim()) || '';
    const contPV = (primeira.match(/;/g) || []).length;
    const contV = (primeira.match(/,/g) || []).length;
    const contT = (primeira.match(/\t/g) || []).length;
    if (contT > contPV && contT > contV) return '\t';
    if (contPV >= contV) return ';';
    return ',';
}

/**
 * Parse CSV simples com aspas.
 * @returns {string[][]}
 */
export function parseCsvTexto(texto, delimiter = null) {
    const raw = String(texto || '').replace(/^\uFEFF/, '');
    const delim = delimiter || detectarDelimiter(raw);
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < raw.length; i += 1) {
        const ch = raw[i];
        const next = raw[i + 1];
        if (inQuotes) {
            if (ch === '"' && next === '"') {
                cell += '"';
                i += 1;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                cell += ch;
            }
            continue;
        }
        if (ch === '"') {
            inQuotes = true;
            continue;
        }
        if (ch === delim) {
            row.push(cell.trim());
            cell = '';
            continue;
        }
        if (ch === '\n' || (ch === '\r' && next === '\n')) {
            row.push(cell.trim());
            if (row.some((c) => c !== '')) rows.push(row);
            row = [];
            cell = '';
            if (ch === '\r') i += 1;
            continue;
        }
        if (ch === '\r') {
            row.push(cell.trim());
            if (row.some((c) => c !== '')) rows.push(row);
            row = [];
            cell = '';
            continue;
        }
        cell += ch;
    }
    row.push(cell.trim());
    if (row.some((c) => c !== '')) rows.push(row);
    return { rows, delimiter: delim };
}

export function parseXlsxBuffer(buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
        const err = new Error('Planilha XLSX sem abas.');
        err.statusCode = 400;
        throw err;
    }
    const sheet = wb.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        raw: false,
        blankrows: false,
    });
    const rows = matrix
        .map((r) => (Array.isArray(r) ? r.map(limparCelula) : []))
        .filter((r) => r.some((c) => String(c).trim() !== ''));
    return { rows, sheetName };
}

/**
 * Converte data BR/ISO/serial para YYYY-MM-DD.
 */
export function parseDataExtrato(valor, formatoPreferido = null) {
    if (valor == null || valor === '') return null;
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
        return valor.toISOString().slice(0, 10);
    }
    const s = limparCelula(valor);
    if (!s) return null;

    // ISO
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const iso = s.slice(0, 10);
        if (!Number.isNaN(Date.parse(`${iso}T12:00:00Z`))) return iso;
    }

    // DD/MM/YYYY ou DD-MM-YYYY
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
        let dd = Number(m[1]);
        let mm = Number(m[2]);
        let yyyy = Number(m[3]);
        if (yyyy < 100) yyyy += 2000;
        // se formato preferido MM/DD, tenta inverter quando ambíguo
        if (formatoPreferido === 'MM/DD/YYYY' && dd <= 12 && mm <= 31) {
            const tmp = dd;
            dd = mm;
            mm = tmp;
        }
        if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
            const iso = `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
            if (!Number.isNaN(Date.parse(`${iso}T12:00:00Z`))) return iso;
        }
    }

    // YYYYMMDD
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) {
        const iso = `${m[1]}-${m[2]}-${m[3]}`;
        if (!Number.isNaN(Date.parse(`${iso}T12:00:00Z`))) return iso;
    }

    // Excel serial number as string
    if (/^\d+(\.\d+)?$/.test(s)) {
        const n = Number(s);
        if (n > 20000 && n < 80000) {
            // Excel epoch
            const utc = Math.round((n - 25569) * 86400 * 1000);
            const d = new Date(utc);
            if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        }
    }

    return null;
}

export function parseValorMonetario(valor) {
    if (valor == null || valor === '') return null;
    if (typeof valor === 'number' && Number.isFinite(valor)) {
        return Math.round(valor * 100) / 100;
    }
    let s = limparCelula(valor);
    if (!s) return null;
    s = s.replace(/[R$\s]/gi, '');
    // (1.234,56) contábil
    const negParen = /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g, '');
    // 1.234,56 → 1234.56 | 1,234.56 → 1234.56
    if (s.includes(',') && s.includes('.')) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        s = s.replace(/\./g, '').replace(',', '.');
    }
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    const v = negParen ? -Math.abs(n) : n;
    return Math.round(v * 100) / 100;
}

function normHeader(h) {
    return String(h || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

const ALIASES = {
    data: [
        'data', 'data lancamento', 'data movimento', 'data transacao', 'dt',
        'date', 'posted', 'posting date', 'transaction date', 'data operacao',
    ],
    valor: [
        'valor', 'amount', 'vlr', 'valor r', 'valor rs', 'montante', 'value',
        'transaction amount',
    ],
    descricao: [
        'descricao', 'histórico', 'historico', 'memo', 'lancamento', 'detalhe', 'detalhes',
        'nome', 'favorecido', 'description', 'histórico do lançamento', 'historico do lancamento',
        'details', 'payee', 'narrative',
    ],
    documento: [
        'documento', 'doc', 'n doc', 'numero', 'número', 'checknum', 'id', 'nsu',
        'autenticacao', 'reference', 'ref', 'check number',
    ],
    tipo: [
        'tipo', 'natureza', 'c d', 'dc', 'credito debito', 'd c', 'sinal',
        'type', 'credit debit', 'dr cr',
    ],
    credito: [
        'credito', 'crédito', 'entrada', 'credit', 'credits', 'valor credito',
        'credit amount', 'valor credit',
    ],
    debito: [
        'debito', 'débito', 'saida', 'saída', 'debit', 'debits', 'valor debito',
        'debit amount', 'valor debit',
    ],
};

function acharColuna(headers, chaves) {
    const norms = headers.map(normHeader);
    for (const key of chaves) {
        const idx = norms.findIndex((h) => h === key || h.includes(key));
        if (idx >= 0) return headers[idx];
    }
    return null;
}

/**
 * Sugere mapeamento a partir dos headers.
 */
export function sugerirMapeamento(headers) {
    return {
        hasHeader: true,
        delimiter: null,
        colunaData: acharColuna(headers, ALIASES.data),
        colunaValor: acharColuna(headers, ALIASES.valor),
        colunaDescricao: acharColuna(headers, ALIASES.descricao),
        colunaDocumento: acharColuna(headers, ALIASES.documento),
        colunaTipo: acharColuna(headers, ALIASES.tipo),
        colunaCredito: acharColuna(headers, ALIASES.credito),
        colunaDebito: acharColuna(headers, ALIASES.debito),
        formatoData: 'DD/MM/YYYY',
        sinalNegativoDebito: true,
    };
}

function idxCol(headers, nome) {
    if (!nome) return -1;
    const n = String(nome);
    let i = headers.findIndex((h) => String(h) === n);
    if (i >= 0) return i;
    const nn = normHeader(n);
    return headers.findIndex((h) => normHeader(h) === nn);
}

function interpretarTipo(rawTipo, valorSigned, mapeamento) {
    const t = normHeader(rawTipo || '');
    if (t) {
        if (/^(c|credito|crédito|credit|entrada|receita|\+)$/.test(t) || t.includes('credit')) {
            return 'CREDITO';
        }
        if (/^(d|debito|débito|debit|saida|saída|despesa|\-)$/.test(t) || t.includes('debit')) {
            return 'DEBITO';
        }
    }
    if (valorSigned < 0) return mapeamento.sinalNegativoDebito !== false ? 'DEBITO' : 'CREDITO';
    if (valorSigned > 0) return mapeamento.sinalNegativoDebito !== false ? 'CREDITO' : 'DEBITO';
    return null;
}

/**
 * Converte matriz + mapeamento em linhas normalizadas do pipeline.
 */
export function aplicarMapeamento(rows, mapeamento = {}) {
    if (!rows?.length) {
        const err = new Error('Arquivo tabular sem linhas.');
        err.statusCode = 400;
        throw err;
    }

    const hasHeader = mapeamento.hasHeader !== false;
    const headers = hasHeader
        ? rows[0].map((h, i) => limparCelula(h) || `Coluna ${i + 1}`)
        : rows[0].map((_, i) => `Coluna ${i + 1}`);
    const dataRows = hasHeader ? rows.slice(1) : rows;

    const iData = idxCol(headers, mapeamento.colunaData);
    const iValor = idxCol(headers, mapeamento.colunaValor);
    const iDesc = idxCol(headers, mapeamento.colunaDescricao);
    const iDoc = idxCol(headers, mapeamento.colunaDocumento);
    const iTipo = idxCol(headers, mapeamento.colunaTipo);
    const iCred = idxCol(headers, mapeamento.colunaCredito);
    const iDeb = idxCol(headers, mapeamento.colunaDebito);

    if (iData < 0) {
        const err = new Error('Mapeie a coluna de data.');
        err.statusCode = 400;
        throw err;
    }
    if (iValor < 0 && iCred < 0 && iDeb < 0) {
        const err = new Error('Mapeie a coluna de valor (ou crédito/débito).');
        err.statusCode = 400;
        throw err;
    }
    if (iDesc < 0) {
        const err = new Error('Mapeie a coluna de descrição/histórico.');
        err.statusCode = 400;
        throw err;
    }

    const linhas = [];
    for (let r = 0; r < dataRows.length; r += 1) {
        const row = dataRows[r];
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = row[i] != null ? limparCelula(row[i]) : '';
        });

        const data = parseDataExtrato(row[iData], mapeamento.formatoData);
        if (!data) continue;

        let valorSigned = null;
        if (iCred >= 0 || iDeb >= 0) {
            const cred = iCred >= 0 ? parseValorMonetario(row[iCred]) : null;
            const deb = iDeb >= 0 ? parseValorMonetario(row[iDeb]) : null;
            if (cred != null && Math.abs(cred) > 0.0001) valorSigned = Math.abs(cred);
            else if (deb != null && Math.abs(deb) > 0.0001) valorSigned = -Math.abs(deb);
            else continue;
        } else {
            valorSigned = parseValorMonetario(row[iValor]);
            if (valorSigned == null || valorSigned === 0) continue;
        }

        const tipoRaw = iTipo >= 0 ? row[iTipo] : '';
        let sentido = interpretarTipo(tipoRaw, valorSigned, mapeamento);
        if (!sentido) {
            // colunas crédito/débito já definiram sinal
            sentido = valorSigned < 0 ? 'DEBITO' : 'CREDITO';
        }
        // se tipo explícito e valor absoluto em coluna única
        if (iCred < 0 && iDeb < 0 && iTipo >= 0) {
            // valor sempre absoluto com tipo
            // ok
        }

        const valor = Math.abs(valorSigned);
        const descricao = limparCelula(row[iDesc]) || 'Movimentação importada';
        const documento = iDoc >= 0 ? limparCelula(row[iDoc]) || undefined : undefined;

        linhas.push({
            data,
            valor: Math.round(valor * 100) / 100,
            sentido,
            descricao,
            fitId: undefined,
            documento,
            bruto: obj,
        });
    }

    if (!linhas.length) {
        const err = new Error('Nenhuma linha válida após o mapeamento. Confira data, valor e descrição.');
        err.statusCode = 400;
        throw err;
    }

    const datas = linhas.map((l) => l.data).sort();
    return {
        linhas,
        periodoInicio: datas[0],
        periodoFim: datas[datas.length - 1],
        headers,
    };
}

/**
 * Preview tabular sem exigir mapeamento completo.
 */
export function previewTabular(buffer, filename = '') {
    const name = String(filename || '').toLowerCase();
    const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls')
        || (buffer[0] === 0x50 && buffer[1] === 0x4b); // PK zip

    let rows;
    let delimiter = null;
    let formato = 'CSV';

    if (isXlsx || name.endsWith('.xlsx') || name.endsWith('.xls')) {
        formato = 'XLSX';
        ({ rows } = parseXlsxBuffer(buffer));
    } else {
        const texto = buffer.toString('utf8');
        const parsed = parseCsvTexto(texto);
        rows = parsed.rows;
        delimiter = parsed.delimiter;
        formato = 'CSV';
    }

    if (!rows.length) {
        const err = new Error('Arquivo sem dados.');
        err.statusCode = 400;
        throw err;
    }

    const headers = rows[0].map((h, i) => limparCelula(h) || `Coluna ${i + 1}`);
    const amostra = rows.slice(1, 6).map((row) => {
        const o = {};
        headers.forEach((h, i) => {
            o[h] = row[i] != null ? limparCelula(row[i]) : '';
        });
        return o;
    });

    const mapeamento = sugerirMapeamento(headers);
    if (delimiter) mapeamento.delimiter = delimiter;

    return {
        formato,
        colunas: headers,
        amostra,
        total_linhas_dados: Math.max(0, rows.length - 1),
        mapeamento_sugerido: mapeamento,
        rows, // uso interno no mesmo request se necessário — não serializar se grande
    };
}

/**
 * Parse completo CSV/XLSX com mapeamento.
 */
export function parseTabularExtrato(buffer, filename, mapeamento = {}) {
    const name = String(filename || '').toLowerCase();
    const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls');

    let rows;
    let formato = 'CSV';

    if (isXlsx) {
        formato = 'XLSX';
        ({ rows } = parseXlsxBuffer(buffer));
    } else {
        const texto = buffer.toString('utf8');
        const delim = mapeamento.delimiter || null;
        ({ rows } = parseCsvTexto(texto, delim));
        formato = 'CSV';
    }

    const result = aplicarMapeamento(rows, mapeamento);
    return {
        formato,
        ...result,
        moeda: null,
    };
}

export default parseTabularExtrato;
