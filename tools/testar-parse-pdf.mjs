/**
 * Testes do parser PDF (heurísticas de texto, sem arquivo real).
 * node tools/testar-parse-pdf.mjs
 */
import {
  fundirLinhasQuebradas,
  parseLinhaExtratoPdf,
  parseTextoExtratoPdf,
} from '../api/lib/parse-pdf-extrato.js';
import {
  pareceTransferencia,
  scoreMatchAgenda,
  scoreTransferenciaPar,
} from '../api/lib/importacao-enriquecer.js';

let falhas = 0;
function assert(c, m) {
  if (!c) {
    falhas += 1;
    console.error('FAIL', m);
  } else {
    console.log('OK', m);
  }
}

const l1 = parseLinhaExtratoPdf('10/07/2026 PIX ENVIADO JOAO SILVA -150,50');
assert(l1 && l1.sentido === 'DEBITO' && l1.valor === 150.5, 'linha debito PIX');
assert(l1.data === '2026-07-10', 'data BR');

const l2 = parseLinhaExtratoPdf('12/07/2026 TED RECEBIDA CLIENTE 2.000,00 C');
assert(l2 && l2.sentido === 'CREDITO' && l2.valor === 2000, 'linha credito C');

const l3 = parseLinhaExtratoPdf('Saldo anterior 1.000,00');
assert(!l3, 'ignora saldo');

const fundidas = fundirLinhasQuebradas([
  '15/07/2026 COMPRA MERCADO',
  '89,90 D',
]);
assert(fundidas.length === 1 && /89,90/.test(fundidas[0]), 'funde linhas quebradas');

const texto = `
Extrato Conta Corrente
10/07/2026 PIX ENVIADO FORNECEDOR -320,00
11/07/2026 PAGTO BOLETO ENEL 245,67 D
12/07/2026 TED RECEBIDA LOJA 1500,00
`;
const r = parseTextoExtratoPdf(texto);
assert(r.linhas.length === 3, `3 linhas do texto (got ${r.linhas.length})`);

assert(pareceTransferencia('Transferencia entre contas'), 'detecta transf');
assert(pareceTransferencia('PIX JOAO') === false, 'pix normal nao e transf pura');

const scoreAg = scoreMatchAgenda(
  {
    valor: 245.67,
    tipo_movimento: 'DEBITO',
    data_transacao: '2026-07-11',
    descricao_normalizada: 'pagto boleto enel',
    descricao_original: 'PAGTO BOLETO ENEL',
  },
  {
    valor: 245.67,
    tipo: 'A_PAGAR',
    data_vencimento: '2026-07-11',
    descricao: 'Enel energia',
  }
);
assert(scoreAg >= 0.7, `score agenda ${scoreAg}`);

const scoreT = scoreTransferenciaPar(
  {
    valor: 1000,
    tipo_movimento: 'DEBITO',
    data_transacao: '2026-07-10',
    descricao_original: 'Transf para poupanca',
  },
  {
    valor: 1000,
    tipo: 'RECEITA',
    data_transacao: '2026-07-10',
    descricao: 'Transferencia recebida',
  }
);
assert(scoreT >= 0.7, `score transf ${scoreT}`);

if (falhas) {
  console.error(falhas, 'falhas');
  process.exit(1);
}
console.log('\nParser PDF/heurísticas OK');
