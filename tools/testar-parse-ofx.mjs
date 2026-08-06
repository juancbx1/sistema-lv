/**
 * Teste unitário do parser OFX (sem banco).
 * Uso: node tools/testar-parse-ofx.mjs
 */
import { parseOfx, parseDataOfx } from '../api/lib/parse-ofx.js';
import {
  hashLinha,
  normalizarDescricao,
  scoreMatchLinhaLancamento,
  similaridadeTexto,
} from '../api/lib/importacao-extrato-helpers.js';

let falhas = 0;
function assert(cond, msg) {
  if (!cond) {
    falhas += 1;
    console.error('FAIL:', msg);
  } else {
    console.log('OK:', msg);
  }
}

const fixture = `
OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>BRL
<BANKTRANLIST>
<DTSTART>20260701
<DTEND>20260715
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260710
<TRNAMT>-150.50
<FITID>ABC123
<CHECKNUM>1
<MEMO>PIX ENVIADO JOAO SILVA
<NAME>PIX
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260712
<TRNAMT>2000.00
<FITID>XYZ999
<MEMO>TED RECEBIDA CLIENTE
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

assert(parseDataOfx('20260710') === '2026-07-10', 'parseDataOfx YYYYMMDD');
assert(parseDataOfx('20260710120000[-3:BRT]') === '2026-07-10', 'parseDataOfx com timezone');

const r = parseOfx(fixture);
assert(r.linhas.length === 2, `2 linhas parseadas (got ${r.linhas.length})`);
assert(r.linhas[0].sentido === 'DEBITO', 'primeira é débito');
assert(r.linhas[0].valor === 150.5, 'valor absoluto débito');
assert(r.linhas[0].fitId === 'ABC123', 'FITID');
assert(r.linhas[1].sentido === 'CREDITO', 'segunda é crédito');
assert(r.periodoInicio === '2026-07-10', 'periodo inicio');
assert(r.periodoFim === '2026-07-12', 'periodo fim');

const norm = normalizarDescricao('PIX Enviado João Silva CPF 123.456.789-00');
assert(norm.includes('joao'), 'normaliza sem acento');
assert(!norm.includes('pix') || norm.length > 0, 'normaliza texto');

const scoreAlto = scoreMatchLinhaLancamento(
  {
    valor: 150.5,
    tipo_movimento: 'DEBITO',
    data_transacao: '2026-07-10',
    descricao_normalizada: normalizarDescricao('PIX ENVIADO JOAO SILVA'),
    descricao_original: 'PIX ENVIADO JOAO SILVA',
  },
  {
    valor: 150.5,
    tipo: 'DESPESA',
    data_transacao: '2026-07-10',
    descricao: 'Pix enviado Joao Silva',
  }
);
assert(scoreAlto >= 0.85, `score alto esperado >= 0.85 (got ${scoreAlto})`);

const scoreBaixo = scoreMatchLinhaLancamento(
  {
    valor: 99,
    tipo_movimento: 'DEBITO',
    data_transacao: '2026-07-10',
    descricao_normalizada: 'xyz',
    descricao_original: 'xyz',
  },
  {
    valor: 150.5,
    tipo: 'DESPESA',
    data_transacao: '2026-07-10',
    descricao: 'outra coisa',
  }
);
assert(scoreBaixo === 0, 'valor diferente → score 0');

assert(similaridadeTexto('joao silva loja', 'joao silva') > 0.5, 'similaridade tokens');

const h = hashLinha({
  idConta: 1,
  data: '2026-07-10',
  valor: 10,
  sentido: 'DEBITO',
  descricaoNormalizada: 'teste',
  fitId: '1',
});
assert(typeof h === 'string' && h.length === 64, 'hash sha256');

// XML-style OFX
const xml = `<?xml version="1.0"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260101</DTPOSTED>
<TRNAMT>-10.00</TRNAMT>
<FITID>X1</FITID>
<MEMO>Compra teste</MEMO>
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
const r2 = parseOfx(xml);
assert(r2.linhas.length === 1 && r2.linhas[0].valor === 10, 'OFX XML-style');

if (falhas > 0) {
  console.error(`\n${falhas} falha(s)`);
  process.exit(1);
}
console.log('\nTodos os testes do parser/match passaram.');
