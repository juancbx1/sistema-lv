import express from 'express';
import path from 'node:path';

const app = express();
const port = Number(process.env.SMOKE_PORT || 4173);

const receitaTouca = [
  { id: 'touca-corte', processo_id: 'proc-corte', ordem: 1, processo: 'Corte', maquina: 'Mesa', feitoPor: ['cortador'], fase: 'OP' },
  { id: 'touca-fechamento', processo_id: 'proc-fechamento', ordem: 2, processo: 'Fechamento', maquina: 'Reta', feitoPor: ['costureira'], fase: 'OP' },
  { id: 'touca-finalizacao', processo_id: 'proc-finalizacao', ordem: 3, processo: 'Finalização', maquina: 'Reta', feitoPor: ['costureira'], fase: 'OP' },
  { id: 'touca-elastico', processo_id: 'proc-elastico', ordem: 4, processo: 'Passar Elástico', maquina: 'Overloque', feitoPor: ['tiktik'], fase: 'OP' },
  { id: 'touca-pos-op', processo_id: 'proc-touca-pos', ordem: 5, processo: 'Revisão pós-OP', maquina: 'Bancada', feitoPor: ['costureira'], fase: 'POS_OP' },
];
const receitaScrunchie = [
  { id: 'scrunchie-corte', processo_id: 'proc-scrunchie-corte', ordem: 1, processo: 'Corte', maquina: 'Mesa', feitoPor: ['cortador'], fase: 'OP' },
  { id: 'scrunchie-fechamento', processo_id: 'proc-scrunchie-fechamento', ordem: 2, processo: 'Fechamento', maquina: 'Reta', feitoPor: ['costureira'], fase: 'OP' },
  { id: 'scrunchie-elastico', processo_id: 'proc-scrunchie-elastico', ordem: 3, processo: 'Passar Elástico', maquina: 'Não Usa', feitoPor: ['costureira', 'tiktik'], fase: 'OP' },
  { id: 'scrunchie-finalizacao', processo_id: 'proc-scrunchie-finalizacao', ordem: 4, processo: 'Finalização', maquina: 'Reta', feitoPor: ['costureira'], fase: 'OP' },
];

const produtos = [
  {
    id: 101,
    nome: 'Touca',
    imagem: '/img/placeholder-image.png',
    grade: [{ variacao: 'Azul marinho', imagem: '/img/placeholder-image.png' }],
    etapas: receitaTouca,
    etapasCanonicas: receitaTouca,
  },
  {
    id: 102,
    nome: 'Scrunchie',
    imagem: '/img/placeholder-image.png',
    grade: [{ variacao: 'Rosa', imagem: '/img/placeholder-image.png' }],
    etapas: receitaScrunchie,
    etapasCanonicas: receitaScrunchie,
  },
];

const tarefas = [
  { produto_id: 101, produto_nome: 'Touca', variante: 'Azul marinho', imagem_produto: '/img/placeholder-image.png', processo: 'Fechamento', processo_id: 'proc-fechamento', etapa_id: 'touca-fechamento', fase: 'OP', quantidade_disponivel: 10, origem_ops: ['T-1001'], feito_por: ['costureira'] },
  { produto_id: 101, produto_nome: 'Touca', variante: 'Azul marinho', imagem_produto: '/img/placeholder-image.png', processo: 'Finalização', processo_id: 'proc-finalizacao', etapa_id: 'touca-finalizacao', fase: 'OP', quantidade_disponivel: 10, origem_ops: ['T-1001'], feito_por: ['costureira'] },
  { produto_id: 101, produto_nome: 'Touca', variante: 'Azul marinho', imagem_produto: '/img/placeholder-image.png', processo: 'Revisão pós-OP', processo_id: 'proc-touca-pos', etapa_id: 'touca-pos-op', fase: 'POS_OP', quantidade_disponivel: 4, origem_ops: ['T-1002'], feito_por: ['costureira'] },
  { produto_id: 102, produto_nome: 'Scrunchie', variante: 'Rosa', imagem_produto: '/img/placeholder-image.png', processo: 'Passar Elástico', processo_id: 'proc-scrunchie-elastico', etapa_id: 'scrunchie-elastico', fase: 'OP', quantidade_disponivel: 8, origem_ops: ['S-1001'], feito_por: ['costureira', 'tiktik'] },
  { produto_id: 102, produto_nome: 'Scrunchie', variante: 'Rosa', imagem_produto: '/img/placeholder-image.png', processo: 'Finalização', processo_id: 'proc-scrunchie-finalizacao', etapa_id: 'scrunchie-finalizacao', fase: 'OP', quantidade_disponivel: 8, origem_ops: ['S-1001'], feito_por: ['costureira'] },
];

const grupos = {
  '101:costureira': [{ grupo_id: 'touca-fechamento', etapa_inicial_index: 1, muda_maquina: false, etapas: receitaTouca.slice(1, 3) }],
  '102:costureira': [{ grupo_id: 'scrunchie-elastico', etapa_inicial_index: 2, muda_maquina: false, etapas: receitaScrunchie.slice(2, 4) }],
  '102:tiktik': [],
};

const funcionarios = [
  {
    id: 2,
    nome: 'Ana Costureira',
    tipos: ['costureira'],
    status_atual: 'LIVRE',
    jornada_ordinaria_hoje: true,
    janela_ordinaria_aberta: true,
    dias_trabalho: { '0': false, '1': true, '2': true, '3': true, '4': true, '5': true, '6': false },
    tarefas: [],
    sessoes_hoje: [],
  },
  {
    id: 3,
    nome: 'Bia TikTik',
    tipos: ['tiktik'],
    status_atual: 'LIVRE',
    jornada_ordinaria_hoje: true,
    janela_ordinaria_aberta: true,
    dias_trabalho: { '0': false, '1': true, '2': true, '3': true, '4': true, '5': true, '6': false },
    tarefas: [],
    sessoes_hoje: [],
  },
];

app.use(express.json());
app.use('/api', (req, res, next) => {
  if (req.path === '/usuarios/me') {
    return res.json({
      id: 1,
      nome: 'Supervisor Local',
      nome_usuario: 'supervisor.local',
      tipos: ['administrador'],
      permissoes: ['acesso-ordens-de-producao', 'acesso-ordens-de-arremates', 'acesso-producao-geral', 'atribuir-tarefa', 'finalizar-tarefa-producao', 'cancelar-tarefa-producao', 'confirmar-lancamento'],
      empresa_ativa: { id: 1, nome_fantasia: 'Fixture local', codigo: 'fixture-local' },
    });
  }
  if (req.path === '/produtos') return res.json(produtos);
  if (req.path === '/ordens-de-producao') return res.json({ rows: [] });
  if (req.path === '/producao/status-funcionarios') return res.json(funcionarios);
  if (req.path === '/producao/tempos-padrao') return res.json({});
  if (req.path === '/producao/fila-de-tarefas') return res.json(tarefas);
  if (req.path === '/producao/grupos-unificaveis') {
    const produtoId = String(req.query.produto_id || '');
    const tipo = String(req.query.tipo_funcionario || '');
    return res.json(grupos[`${produtoId}:${tipo}`] || []);
  }
  if (req.path === '/alertas/configuracoes') return res.json([]);
  if (req.path === '/alertas/dias-trabalho') return res.json({});
  if (req.path === '/alertas/historico') return res.json([]);
  if (req.path === '/preferencias-menu') return res.json({});
  if (req.path === '/contexto-empresa') return res.json({
    empresaAtiva: { id: 1, nome_fantasia: 'Fixture local', codigo: 'fixture-local' },
    empresas: [{ id: 1, nome_fantasia: 'Fixture local', codigo: 'fixture-local' }],
    modulosHabilitados: ['producao', 'producao-geral', 'ordens-de-producao'],
  });
  if (req.path === '/ordens-de-producao/prontas-para-encerrar') return res.json([]);
  if (req.path.startsWith('/producoes/externos-recentes')) return res.json([]);
  if (req.path.startsWith('/ponto/') || req.path.startsWith('/usuarios/')) return res.json({ ok: true });
  return res.json([]);
});

app.use(express.static(path.join(process.cwd(), 'dist')));

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`SMOKE_OP_URL=http://127.0.0.1:${port}/admin/ordens-de-producao.html`);
});

async function shutdown() {
  await new Promise((resolve) => server.close(resolve));
}

process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
