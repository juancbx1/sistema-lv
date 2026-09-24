import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { formatarCnpjEtiqueta, montarEtiquetaProduto } from '../public/src/utils/etiqueta-embalagem.ts';
import { mensagemEmbalagem, mensagemEstoqueSemEtiqueta } from '../public/src/utils/etiqueta-resultado.ts';

const require = createRequire(import.meta.url);
require('dotenv').config();
const { Pool } = require('pg');

const AGENTE = 'http://127.0.0.1:17840';
const falhas = [];

function ok(nome) {
  console.log(`ok  ${nome}`);
}

function falha(nome, erro) {
  falhas.push(`${nome}: ${erro instanceof Error ? erro.message : erro}`);
  console.error(`falha  ${nome}: ${erro instanceof Error ? erro.message : erro}`);
}

async function etapa(nome, fn) {
  try {
    await fn();
    ok(nome);
  } catch (erro) {
    falha(nome, erro);
  }
}

async function pedir(caminho, init) {
  const response = await fetch(`${AGENTE}${caminho}`, init);
  const texto = await response.text();
  let corpo = {};
  try {
    corpo = JSON.parse(texto);
  } catch {
    corpo = { html: texto.slice(0, 80) };
  }
  return { status: response.status, corpo, headers: response.headers };
}

await etapa('aviso diz se a etiqueta saiu ou não', () => {
  const okMsg = mensagemEmbalagem({
    quantidade: 1,
    tipo: 'unidade',
    impresso: true,
  });
  assert.equal(okMsg.titulo, '1 etiqueta adicionada');
  assert.match(okMsg.detalhe, /1 unidade entrou/);
  const varias = mensagemEmbalagem({
    quantidade: 3,
    tipo: 'unidade',
    impresso: true,
  });
  assert.equal(varias.titulo, '3 etiquetas adicionadas');
  const falhaMsg = mensagemEmbalagem({
    quantidade: 1,
    tipo: 'kit',
    impresso: false,
    motivo: 'A impressora está instalada, mas não está conectada neste computador.',
  });
  assert.equal(falhaMsg.titulo, 'Etiqueta não impressa');
  assert.match(falhaMsg.detalhe, /não está conectada/);
  assert.match(falhaMsg.detalhe, /Nada entrou no estoque/);
  const semEtiqueta = mensagemEstoqueSemEtiqueta(1, 'unidade');
  assert.equal(semEtiqueta.titulo, '1 unidade adicionada ao estoque');
  assert.equal(semEtiqueta.detalhe, 'Nenhuma etiqueta foi impressa.');
  assert.equal(mensagemEstoqueSemEtiqueta(2, 'kit').titulo, '2 kits adicionados ao estoque');
});

await etapa('cnpj da Variara vira a linha da etiqueta', () => {
  assert.equal(formatarCnpjEtiqueta('39974006000103'), '39.974.006.0001-03');
});

await etapa('variação com GTIN usa o código e pacote 1', () => {
  const etiqueta = montarEtiquetaProduto({
    id: 4,
    nome: 'Fronha de Cetim',
    sku: 'FR-01000',
    grade: [{ variacao: 'Preto', sku: 'FR-01001', gtin: '7792022602975' }],
  }, 'Preto', '39974006000103');
  assert.equal(etiqueta.sku, 'FR-01001');
  assert.equal(etiqueta.codigo_barras, '7792022602975');
  assert.equal(etiqueta.qtd_pacote, 1);
  assert.equal(etiqueta.cnpj, '39.974.006.0001-03');
});

await etapa('pacote acima de 1 entra na etiqueta', () => {
  const etiqueta = montarEtiquetaProduto({
    id: 8,
    nome: 'Kit 5',
    grade: [{ variacao: 'Preto', sku: 'SXF-01001-KT5MSPT', gtin: '', qtd_pacote: 5 }],
  }, 'Preto', '');
  assert.equal(etiqueta.qtd_pacote, 5);
  assert.equal(etiqueta.codigo_barras, '');
  assert.equal(etiqueta.cnpj, '');
});

await etapa('Neila não herda GTIN da Variara no montador', () => {
  const etiqueta = montarEtiquetaProduto({
    id: 99,
    nome: 'Touca',
    sku: 'TC-01011-DFP',
    grade: [{ variacao: 'Preto com Preto | P', sku: 'TC-01011-DFP' }],
  }, 'Preto com Preto | P', '');
  assert.equal(etiqueta.codigo_barras, '');
  assert.equal(etiqueta.sku, 'TC-01011-DFP');
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await etapa('banco: CNPJ da Variara permanece o cadastrado e a Neila segue vazia', async () => {
  const empresas = await pool.query('SELECT id, cnpj FROM empresas ORDER BY id');
  assert.equal(empresas.rows[0].cnpj, '39974006000103');
  assert.equal(empresas.rows[1].cnpj, null);
});

await etapa('banco: pacotes 5 e 10 só nos kits indicados, sem apagar GTIN', async () => {
  const kits = await pool.query(`
    SELECT nome, grade FROM produtos
    WHERE empresa_id = 1 AND nome IN ('Kit 10 Scrunchies', 'Kit 5 Scrunchies - Fina')
  `);
  assert.equal(kits.rowCount, 2);
  for (const produto of kits.rows) {
    for (const item of produto.grade) {
      const pacotes = {
        'SX-01001-MRSKT10': 10,
        'SX-01001-RSEKT10': 10,
        'SXF-01001-KT5MSPT': 5,
        'SXF-01001-KT5PEPT': 5,
        'SXF-01001-KT5MSPE': 5,
        'SXF-01001-KT5PKPT': 5,
        'SXF-01001-KT5REAB': 5,
      };
      if (pacotes[item.sku]) assert.equal(item.qtd_pacote, pacotes[item.sku]);
      assert.ok(item.imagem, `${item.sku} perdeu a imagem`);
    }
  }
});

await etapa('banco: Neila não recebeu os EAN da carga', async () => {
  const neila = await pool.query(`SELECT grade, gtin FROM produtos WHERE empresa_id = 2`);
  const texto = JSON.stringify(neila.rows);
  assert.equal(texto.includes('7792022602975'), false);
});

await pool.end();

await etapa('agente responde na raiz e na saúde', async () => {
  const raiz = await pedir('/');
  assert.equal(raiz.status, 200);
  assert.match(raiz.corpo.html || '', /PrintNow agente/);
  const saude = await pedir('/saude');
  assert.equal(saude.status, 200);
  assert.equal(saude.corpo.ok, true);
  assert.equal(saude.corpo.impressora, 'POS-58');
});

await etapa('agente libera o Chrome local', async () => {
  const resposta = await fetch(`${AGENTE}/saude`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(resposta.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(resposta.headers.get('access-control-allow-private-network'), 'true');
});

await etapa('preview da fronha e do pacote de 5 são imagens diferentes', async () => {
  const corpo = (qtd, codigo) => JSON.stringify({
    sku: 'FR-01001',
    variante: 'Preto',
    codigo_barras: codigo,
    qtd_pacote: qtd,
    fabricacao: 'IND. BRASILEIRA',
    cnpj: '39.974.006.0001-03',
  });
  const um = await pedir('/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: corpo(1, '7792022602975'),
  });
  const cinco = await pedir('/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: corpo(5, ''),
  });
  assert.equal(um.status, 200);
  assert.equal(cinco.status, 200);
  assert.notEqual(um.corpo.imagem, cinco.corpo.imagem);
  assert.match(um.corpo.imagem, /^data:image\/png;base64,/);
});

await etapa('payload inválido não derruba o agente', async () => {
  const ruim = await pedir('/imprimir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku: '', copias: 1 }),
  });
  assert.equal(ruim.status, 400);
  const saude = await pedir('/saude');
  assert.equal(saude.status, 200);
});

await etapa('uma etiqueta real sai na POS-58', async () => {
  if (process.env.IMPRIMIR !== '1') {
    console.log('    (pulada; já impressa nesta sessão)');
    return;
  }
  const impresso = await pedir('/imprimir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sku: 'FR-01001',
      variante: 'Preto',
      codigo_barras: '7792022602975',
      qtd_pacote: 1,
      fabricacao: 'IND. BRASILEIRA',
      cnpj: '39.974.006.0001-03',
      copias: 1,
    }),
  });
  assert.equal(impresso.status, 200);
  assert.equal(impresso.corpo.ok, true);
  assert.equal(impresso.corpo.copias, 1);
  assert.equal(impresso.corpo.impressora, 'POS-58');
});

if (falhas.length) {
  console.error(`\n${falhas.length} falha(s)`);
  process.exit(1);
}
console.log('\nTudo que o teste alcança passou.');
