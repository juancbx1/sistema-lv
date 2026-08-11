import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const adminConnection = process.argv[2] || 'postgresql://postgres@127.0.0.1:55437/postgres';
const jwtSecret = process.env.JWT_SECRET || 'segredo-local-teste-selecao';
const databaseName = `sistema_lv_selecao_${Date.now()}_${process.pid}`;
const databaseConnection = `${adminConnection.replace(/\/[^/]*$/, '')}/${databaseName}`;
const adminPool = new Pool({ connectionString: adminConnection, max: 2 });
let testPool;
let server;

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function assertStatus(response, expected, label) {
  assert.equal(
    response.status,
    expected,
    `${label}: esperado HTTP ${expected}, recebido ${response.status}: ${JSON.stringify(response.payload)}`,
  );
}

async function request(baseUrl, path, {
  empresaId = 1,
  method = 'GET',
  body,
} = {}) {
  const token = jwt.sign({
    id: 1,
    nome: 'Supervisor Local',
    empresa_id: empresaId,
    superadministrador: false,
  }, jwtSecret, { expiresIn: '1h' });
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

function item({
  opNumero,
  produtoId,
  processo,
  processoId,
  etapaId,
  quantidade,
  etapasUnificadas,
  fase = 'OP',
  origemOps,
}) {
  return {
    opNumero,
    produto_id: produtoId,
    variante: null,
    processo,
    processo_id: processoId,
    etapa_id: etapaId,
    fase,
    quantidade,
    ...(origemOps ? { origens_pos_op: origemOps.map((opNumeroOrigem) => ({ op_numero: opNumeroOrigem })) } : {}),
    ...(etapasUnificadas ? { etapas_unificadas: etapasUnificadas } : {}),
  };
}

async function resetProduction() {
  await testPool.query('DELETE FROM producoes');
  await testPool.query('DELETE FROM sessoes_trabalho_producao');
  await testPool.query(`
    INSERT INTO producoes (id, op_numero, etapa_index, processo, produto_id, quantidade, variacao, empresa_id)
    VALUES
      ('seed-touca-corte', 'T-1001', 0, 'Corte', 101, 10, '-', 1),
      ('seed-scrunchie-corte', 'S-1001', 0, 'Corte', 102, 10, '-', 1),
      ('seed-scrunchie-fechamento', 'S-1001', 1, 'Fechamento', 102, 10, '-', 1)
  `);
  await testPool.query(`
    UPDATE usuarios_empresas
       SET status_atual = 'LIVRE', id_sessao_trabalho_atual = NULL
     WHERE empresa_id IN (1, 2)
  `);
}

const schema = `
  CREATE TABLE sistema_migrations (id text PRIMARY KEY);
  INSERT INTO sistema_migrations (id) VALUES
    ('multiempresas-fase8-producao-ensaio-v1'),
    ('pos-op-sessoes-producao-v1');

  CREATE TABLE usuarios (
    id integer PRIMARY KEY,
    nome text NOT NULL,
    nome_usuario text,
    tipos text[] NOT NULL DEFAULT '{}',
    permissoes text[] NOT NULL DEFAULT '{}'
  );
  CREATE TABLE usuarios_acessos_globais (
    usuario_id integer PRIMARY KEY,
    superadministrador boolean NOT NULL DEFAULT false,
    permissoes text[] NOT NULL DEFAULT '{}'
  );
  CREATE TABLE usuarios_empresas (
    id serial PRIMARY KEY,
    usuario_id integer NOT NULL,
    empresa_id integer NOT NULL,
    tipos text[] NOT NULL DEFAULT '{}',
    permissoes text[] NOT NULL DEFAULT '{}',
    ativo boolean NOT NULL DEFAULT true,
    status_atual text,
    id_sessao_trabalho_atual integer,
    status_data_modificacao timestamp,
    dias_trabalho jsonb DEFAULT '{"0":false,"1":true,"2":true,"3":true,"4":true,"5":true,"6":false}',
    horario_entrada_1 text,
    horario_saida_1 text,
    horario_entrada_2 text,
    horario_saida_2 text,
    horario_entrada_3 text,
    horario_saida_3 text
  );
  CREATE TABLE calendario_empresa (
    empresa_id integer NOT NULL,
    data date NOT NULL,
    tipo text NOT NULL
  );

  CREATE TABLE produtos (
    id integer PRIMARY KEY,
    empresa_id integer NOT NULL,
    nome text NOT NULL,
    imagem text,
    grade jsonb DEFAULT '[]',
    etapas jsonb NOT NULL,
    "etapastiktik" jsonb NOT NULL DEFAULT '[]'
  );
  CREATE TABLE ordens_de_producao (
    numero text PRIMARY KEY,
    empresa_id integer NOT NULL,
    produto_id integer NOT NULL,
    variante text,
    quantidade integer NOT NULL,
    status text NOT NULL,
    etapas jsonb NOT NULL,
    data_final timestamptz
  );
  CREATE TABLE producoes (
    id text PRIMARY KEY,
    op_numero text NOT NULL,
    etapa_index integer NOT NULL,
    processo text NOT NULL,
    produto_id integer NOT NULL,
    variacao text,
    maquina text,
    quantidade integer NOT NULL,
    funcionario text,
    funcionario_id integer,
    data timestamptz DEFAULT now(),
    lancado_por text,
    valor_ponto_aplicado numeric(10, 2),
    pontos_gerados numeric(10, 2),
    empresa_id integer NOT NULL
  );
  CREATE TABLE sessoes_trabalho_producao (
    id serial PRIMARY KEY,
    funcionario_id integer NOT NULL,
    op_numero text NOT NULL,
    produto_id integer NOT NULL,
    variante text,
    processo text NOT NULL,
    quantidade_atribuida integer NOT NULL,
    quantidade_finalizada integer,
    status text NOT NULL,
    data_inicio timestamptz NOT NULL DEFAULT now(),
    data_fim timestamptz,
    etapas_unificadas jsonb,
    fase text,
    processo_id text,
    etapa_id text,
    origens_pos_op jsonb,
    pausa_manual_ms integer,
    empresa_id integer NOT NULL
  );
  CREATE TABLE sessoes_trabalho_arremate (
    empresa_id integer NOT NULL,
    op_numero text NOT NULL,
    status text NOT NULL,
    quantidade_entregue integer NOT NULL DEFAULT 0
  );
  CREATE TABLE arremates (
    id bigserial PRIMARY KEY,
    empresa_id integer NOT NULL,
    op_numero text NOT NULL,
    produto_id integer NOT NULL,
    variante text,
    quantidade_arrematada integer NOT NULL,
    quantidade_ja_embalada integer NOT NULL DEFAULT 0,
    usuario_tiktik_id integer,
    usuario_tiktik text,
    lancado_por text,
    tipo_lancamento text NOT NULL,
    id_sessao_producao integer,
    valor_ponto_aplicado numeric(10, 2),
    pontos_gerados numeric(10, 2),
    fase text,
    processo text,
    processo_id text,
    etapa_id text,
    executor_id integer,
    executor_nome text,
    executor_tipo text,
    data_lancamento timestamptz DEFAULT now()
  );
  CREATE TABLE configuracoes_pontos_processos (
    empresa_id integer NOT NULL,
    produto_id integer NOT NULL,
    processo_nome text NOT NULL,
    tipo_atividade text NOT NULL,
    pontos_padrao numeric(10, 2),
    ativo boolean NOT NULL DEFAULT true
  );
  CREATE TABLE tempos_padrao_producao (
    produto_id integer NOT NULL,
    processo text NOT NULL,
    tempo_segundos numeric(10, 2),
    PRIMARY KEY (produto_id, processo)
  );
  CREATE TABLE audit_log (
    id bigserial PRIMARY KEY,
    usuario_id integer,
    usuario_nome text,
    acao text,
    entidade text,
    entidade_id text,
    detalhes jsonb,
    data timestamptz DEFAULT now()
  );
  CREATE TABLE gincanas (
    id serial PRIMARY KEY,
    empresa_id integer NOT NULL,
    nome text,
    participantes text,
    modalidade text,
    tipo_premiacao text,
    escopo_atividade text,
    produto_id integer,
    tipo_recorrencia text,
    datetime_inicio timestamptz,
    datetime_fim timestamptz,
    hora_inicio_semana text,
    hora_fim_semana text,
    vencedor_id integer,
    encerrada_com_ganhador boolean DEFAULT false,
    status text
  );
  CREATE TABLE gincanas_premiacoes (
    id serial PRIMARY KEY,
    empresa_id integer NOT NULL,
    gincana_id integer NOT NULL,
    nivel_label text,
    emoji_icone text,
    meta_valor numeric,
    descricao_premio text,
    valor_premio_reais numeric,
    ordem integer
  );
`;

const receitaTouca = [
  { id: 'touca-corte', processo_id: 'proc-corte', ordem: 1, processo: 'Corte', maquina: 'Mesa', feitoPor: ['cortador'], fase: 'OP' },
  { id: 'touca-fechamento', processo_id: 'proc-fechamento', ordem: 2, processo: 'Fechamento', maquina: 'Reta', feitoPor: ['costureira'], fase: 'OP' },
  { id: 'touca-finalizacao', processo_id: 'proc-finalizacao', ordem: 3, processo: 'Reta', maquina: 'Reta', feitoPor: ['costureira'], fase: 'OP' },
  { id: 'touca-elastico', processo_id: 'proc-elastico', ordem: 4, processo: 'Passar Elástico', maquina: 'Overloque', feitoPor: ['tiktik'], fase: 'OP' },
].map((etapa) => ({ ...etapa, processo: etapa.processo === 'Reta' ? 'Finalização' : etapa.processo }));
const receitaScrunchie = [
  { id: 'scrunchie-corte', processo_id: 'proc-scrunchie-corte', ordem: 1, processo: 'Corte', maquina: 'Mesa', feitoPor: ['cortador'], fase: 'OP' },
  { id: 'scrunchie-fechamento', processo_id: 'proc-scrunchie-fechamento', ordem: 2, processo: 'Fechamento', maquina: 'Reta', feitoPor: ['costureira'], fase: 'OP' },
  { id: 'scrunchie-elastico', processo_id: 'proc-scrunchie-elastico', ordem: 3, processo: 'Passar Elástico', maquina: 'Não Usa', feitoPor: ['costureira', 'tiktik'], fase: 'OP' },
  { id: 'scrunchie-finalizacao', processo_id: 'proc-scrunchie-finalizacao', ordem: 4, processo: 'Finalização', maquina: 'Reta', feitoPor: ['costureira'], fase: 'OP' },
];
const receitaFronhaCetim = [
  { id: 'fronha-bainha', processo_id: 'proc-fronha-bainha', ordem: 1, processo: 'Bainha', maquina: 'Reta', feitoPor: ['costureira'], fase: 'OP' },
  { id: 'fronha-finalizacao', processo_id: 'proc-fronha-finalizacao', ordem: 2, processo: 'Finalização', maquina: 'Overloque', feitoPor: ['costureira'], fase: 'OP' },
];

try {
  await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  testPool = new Pool({ connectionString: databaseConnection, max: 8 });
  await testPool.query(schema);

  await testPool.query(`
    INSERT INTO usuarios (id, nome, nome_usuario, tipos)
    VALUES
      (1, 'Supervisor Local', 'supervisor.local', ARRAY['administrador']),
      (2, 'Ana Costureira', 'ana.costureira', ARRAY['costureira']),
      (3, 'Bia TikTik', 'bia.tiktik', ARRAY['tiktik'])
  `);
  await testPool.query('INSERT INTO usuarios_acessos_globais (usuario_id) VALUES (1), (2), (3)');
  await testPool.query(`
    INSERT INTO usuarios_empresas (usuario_id, empresa_id, tipos, permissoes, status_atual)
    VALUES
      (1, 1, ARRAY['administrador'], '{}', 'LIVRE'),
      (1, 2, ARRAY['administrador'], '{}', 'LIVRE'),
      (2, 1, ARRAY['costureira'], '{}', 'LIVRE'),
      (3, 1, ARRAY['tiktik'], '{}', 'LIVRE')
  `);
  await testPool.query(
    `INSERT INTO produtos (id, empresa_id, nome, etapas) VALUES ($1, 1, 'Touca', $2::jsonb), ($3, 1, 'Scrunchie', $4::jsonb), ($5, 1, 'Fronha de cetim', $6::jsonb), ($7, 2, 'Touca Empresa 2', $2::jsonb)`,
    [101, JSON.stringify(receitaTouca), 102, JSON.stringify(receitaScrunchie), 103, JSON.stringify(receitaFronhaCetim), 201],
  );
  await testPool.query(
    `INSERT INTO ordens_de_producao (numero, empresa_id, produto_id, variante, quantidade, status, etapas)
     VALUES ('T-1001', 1, 101, NULL, 10, 'em-aberto', $1::jsonb),
            ('S-1001', 1, 102, NULL, 10, 'em-aberto', $2::jsonb),
            ('T-2001', 2, 201, NULL, 10, 'em-aberto', $1::jsonb)`,
    [JSON.stringify(receitaTouca), JSON.stringify(receitaScrunchie)],
  );
  await testPool.query(`
    INSERT INTO configuracoes_pontos_processos (empresa_id, produto_id, processo_nome, tipo_atividade, pontos_padrao)
    VALUES
      (1, 101, 'Fechamento', 'costura_op_costureira', 0.50),
      (1, 101, 'Finalização', 'costura_op_costureira', 2.00),
      (1, 102, 'Passar Elástico', 'costura_op_costureira', 1.25),
      (1, 102, 'Finalização', 'costura_op_costureira', 2.50)
  `);

  process.env.POSTGRES_URL = databaseConnection;
  process.env.JWT_SECRET = jwtSecret;
  const { default: producaoRouter } = await import(`../api/producao.js?selecao=${Date.now()}`);
  const { default: producoesRouter } = await import(`../api/producoes.js?selecao=${Date.now()}`);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.moduloEmpresa = { multiempresa_pronto: true, habilitado: true };
    req.empresaId = jwt.decode(req.headers.authorization?.split(' ')[1])?.empresa_id;
    next();
  });
  app.use('/api/producao', producaoRouter);
  app.use('/api/producoes', producoesRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const toucaGrupos = await request(baseUrl, '/api/producao/grupos-unificaveis?produto_id=101&tipo_funcionario=costureira');
  assertStatus(toucaGrupos, 200, 'grupos da Touca');
  const toucaGrupo = toucaGrupos.payload.find((grupo) => grupo.etapas[0]?.processo === 'Fechamento');
  assert.ok(toucaGrupo, 'Touca deve oferecer percurso a partir de Fechamento');
  assert.deepEqual(toucaGrupo.etapas.map((etapa) => etapa.processo), ['Fechamento', 'Finalização']);
  assert.equal(toucaGrupo.etapas.at(-1).processo, 'Finalização');

  const scrunchieTikTikGrupos = await request(baseUrl, '/api/producao/grupos-unificaveis?produto_id=102&tipo_funcionario=tiktik');
  assertStatus(scrunchieTikTikGrupos, 200, 'grupos do Scrunchie para TikTik');
  assert.equal(scrunchieTikTikGrupos.payload.length, 0, 'TikTik não deve unificar Passar Elástico com Finalização');

  const scrunchieCostureiraGrupos = await request(baseUrl, '/api/producao/grupos-unificaveis?produto_id=102&tipo_funcionario=costureira');
  assertStatus(scrunchieCostureiraGrupos, 200, 'grupos do Scrunchie para costureira');
  const scrunchieGrupo = scrunchieCostureiraGrupos.payload.find((grupo) => grupo.etapas[0]?.processo === 'Passar Elástico');
  assert.ok(scrunchieGrupo, 'Scrunchie deve oferecer percurso a partir de Passar Elástico');
  assert.deepEqual(scrunchieGrupo.etapas.map((etapa) => etapa.processo), ['Passar Elástico', 'Finalização']);
  assert.equal(scrunchieGrupo.muda_maquina, false, 'Scrunchie não deve exigir troca ao passar por uma etapa Não Usa');

  const fronhaGrupos = await request(baseUrl, '/api/producao/grupos-unificaveis?produto_id=103&tipo_funcionario=costureira');
  assertStatus(fronhaGrupos, 200, 'grupos da Fronha de cetim');
  const fronhaGrupo = fronhaGrupos.payload.find((grupo) => grupo.etapas[0]?.processo === 'Bainha');
  assert.ok(fronhaGrupo, 'Fronha de cetim deve oferecer percurso a partir de Bainha');
  assert.equal(fronhaGrupo.muda_maquina, true, 'Fronha de cetim deve exigir confirmação ao trocar de Reta para Overloque');

  await resetProduction();
  const saltoInvalido = await request(baseUrl, '/api/producoes/lote', {
    method: 'POST',
    body: {
      funcionario_id: 2,
      itens: [item({
        opNumero: 'T-1001', produtoId: 101, processo: 'Fechamento', processoId: 'proc-fechamento', etapaId: 'touca-fechamento', quantidade: 2,
        etapasUnificadas: [toucaGrupo.etapas[0], toucaGrupo.etapas[2] || { processo: 'Passar Elástico', processo_id: 'proc-elastico', etapa_id: 'touca-elastico' }],
      })],
    },
  });
  assertStatus(saltoInvalido, 500, 'percurso com etapa pulada');
  assert.match(saltoInvalido.payload.error, /sequ.ncia cont.nua|pular/i);

  await resetProduction();
  const etapaNaoAutorizada = await request(baseUrl, '/api/producoes/lote', {
    method: 'POST',
    body: {
      funcionario_id: 3,
      itens: [item({
        opNumero: 'S-1001', produtoId: 102, processo: 'Passar Elástico', processoId: 'proc-scrunchie-elastico', etapaId: 'scrunchie-elastico', quantidade: 2,
        etapasUnificadas: scrunchieGrupo.etapas,
      })],
    },
  });
  assertStatus(etapaNaoAutorizada, 500, 'percurso com executor não autorizado');
  assert.match(etapaNaoAutorizada.payload.error, /autorizado/i);

  await resetProduction();
  const saldoExcedido = await request(baseUrl, '/api/producoes/lote', {
    method: 'POST',
    body: {
      funcionario_id: 2,
      itens: [item({
        opNumero: 'T-1001', produtoId: 101, processo: 'Fechamento', processoId: 'proc-fechamento', etapaId: 'touca-fechamento', quantidade: 11,
        etapasUnificadas: toucaGrupo.etapas,
      })],
    },
  });
  assertStatus(saldoExcedido, 500, 'quantidade acima do saldo');
  assert.match(saldoExcedido.payload.error, /Saldo insuficiente/i);

  await resetProduction();
  const [concorrenteA, concorrenteB] = await Promise.all([
    request(baseUrl, '/api/producoes/lote', {
      method: 'POST',
      body: {
        funcionario_id: 2,
        itens: [item({
          opNumero: 'T-1001', produtoId: 101, processo: 'Fechamento', processoId: 'proc-fechamento', etapaId: 'touca-fechamento', quantidade: 6,
          etapasUnificadas: toucaGrupo.etapas,
        })],
      },
    }),
    request(baseUrl, '/api/producoes/lote', {
      method: 'POST',
      body: {
        funcionario_id: 2,
        itens: [item({
          opNumero: 'T-1001', produtoId: 101, processo: 'Fechamento', processoId: 'proc-fechamento', etapaId: 'touca-fechamento', quantidade: 6,
          etapasUnificadas: toucaGrupo.etapas,
        })],
      },
    }),
  ]);
  assert.deepEqual([concorrenteA.status, concorrenteB.status].sort((a, b) => a - b), [201, 500]);
  const sessaoCriada = (concorrenteA.status === 201 ? concorrenteA : concorrenteB).payload.ids[0];
  const concorrenciaFalhou = concorrenteA.status === 500 ? concorrenteA : concorrenteB;
  assert.match(concorrenciaFalhou.payload.error, /Saldo insuficiente/i);

  const finalizacao = await request(baseUrl, '/api/producoes/finalizar', {
    method: 'PUT',
    body: { id_sessao: sessaoCriada, quantidade_finalizada: 6 },
  });
  assertStatus(finalizacao, 200, 'finalização do percurso Touca');
  const lancamentosTouca = (await testPool.query(`
    SELECT etapa_index, processo, quantidade, valor_ponto_aplicado, pontos_gerados
      FROM producoes
     WHERE empresa_id = 1 AND op_numero = 'T-1001' AND etapa_index > 0
     ORDER BY etapa_index
  `)).rows;
  assert.deepEqual(lancamentosTouca.map((row) => row.processo), ['Fechamento', 'Finalização']);
  assert.deepEqual(lancamentosTouca.map((row) => Number(row.quantidade)), [6, 6]);
  assert.deepEqual(lancamentosTouca.map((row) => Number(row.pontos_gerados)), [3, 12]);
  assert.equal(lancamentosTouca.some((row) => row.processo === 'Passar Elástico'), false);

  await resetProduction();
  const zero = await request(baseUrl, '/api/producoes/lote', {
    method: 'POST',
    body: {
      funcionario_id: 2,
      itens: [item({
        opNumero: 'T-1001', produtoId: 101, processo: 'Fechamento', processoId: 'proc-fechamento', etapaId: 'touca-fechamento', quantidade: 0,
        etapasUnificadas: toucaGrupo.etapas,
      })],
    },
  });
  assertStatus(zero, 500, 'quantidade zero');

  const empresaTrocada = await request(baseUrl, '/api/producoes/lote', {
    empresaId: 2,
    method: 'POST',
    body: {
      funcionario_id: 2,
      itens: [item({
        opNumero: 'T-1001', produtoId: 101, processo: 'Fechamento', processoId: 'proc-fechamento', etapaId: 'touca-fechamento', quantidade: 1,
        etapasUnificadas: toucaGrupo.etapas,
      })],
    },
  });
  assertStatus(empresaTrocada, 500, 'tarefa de outra empresa');
  assert.match(empresaTrocada.payload.error, /empresa ativa|pertence/i);

  const { obterChaveTarefa } = await import('../public/src/utils/op-tarefas.ts');
  const chaveOp = obterChaveTarefa({ produto_id: 101, variante: '-', processo: 'Finalização', etapa_id: 'final', fase: 'OP', origem_ops: ['T-1001'] });
  const chavePosOp = obterChaveTarefa({ produto_id: 101, variante: '-', processo: 'Finalização', etapa_id: 'final', fase: 'POS_OP', origem_ops: ['T-1001'] });
  const chaveOutraOrigem = obterChaveTarefa({ produto_id: 101, variante: '-', processo: 'Finalização', etapa_id: 'final', fase: 'POS_OP', origem_ops: ['T-1002'] });
  assert.notEqual(chaveOp, chavePosOp, 'OP e POS_OP precisam ter chaves distintas');
  assert.notEqual(chavePosOp, chaveOutraOrigem, 'origens diferentes precisam ter chaves distintas');

  console.log(JSON.stringify({
    aprovado: true,
    banco: databaseConnection,
    verificacoes: {
      gruposToucaFechamentoAteFinalizacao: true,
      scrunchieTikTikSemFinalizacaoNaoAutorizada: true,
      scrunchieCostureiraPassarElasticoAteFinalizacao: true,
      saltoDeEtapaRejeitado: true,
      executorNaoAutorizadoRejeitado: true,
      saldoExcedidoRejeitado: true,
      concorrenciaUmaAtribuicaoAprovadaOutraRejeitada: true,
      finalizacaoSomenteEtapasSelecionadasComPontosPorEtapa: true,
      quantidadeZeroRejeitada: true,
      isolamentoEmpresarialRejeitado: true,
      chavesOPePOSOPSeparadasPorOrigem: true,
    },
  }, null, 2));
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (testPool) await testPool.end();
  await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`).catch(() => {});
  await adminPool.end();
}
