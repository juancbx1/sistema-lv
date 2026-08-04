/** Tipos de domínio da Dashboard do funcionário (empregadas). */

// ── Meta diária / comissão ────────────────────────────────────────────────────

export interface DashMeta {
  pontos_meta: number;
  valor_comissao: number | string;
  descricao_meta?: string | null;
}

export type DashNivelMeta = 'bronze' | 'prata' | 'ouro' | 'nao_bateu' | string;

// ── Usuário no contexto da dashboard ─────────────────────────────────────────

export interface DashEmpresaAtivaResumo {
  id?: number;
  codigo?: string;
  nome_fantasia?: string | null;
  razao_social?: string | null;
  cor_identificacao?: string | null;
  [key: string]: unknown;
}

export interface DashUsuario {
  id?: number;
  nome?: string | null;
  avatar_url?: string | null;
  nivel?: number | string | null;
  tipo?: string | null;
  tipos?: string[];
  /** Mapa "0"–"6" → se o vínculo trabalha naquele dia da semana. */
  dias_trabalho?: Record<string, boolean> | null;
  empresa_ativa?: DashEmpresaAtivaResumo | null;
  [key: string]: unknown;
}

// ── Período do ciclo ─────────────────────────────────────────────────────────

export interface DashPeriodo {
  inicio?: string | null;
  fim?: string | null;
}

// ── Hoje ─────────────────────────────────────────────────────────────────────

export interface DashHoje {
  pontos?: number;
  proximaMeta?: DashMeta | null;
  [key: string]: unknown;
}

// ── Acumulado do ciclo ───────────────────────────────────────────────────────

export interface DashDiaDetalhe {
  data: string;
  pontos: number;
  nivelMeta?: DashNivelMeta;
  [key: string]: unknown;
}

export interface DashBlocoSemana {
  numero: number;
  inicio: string;
  fim: string;
  pontos: number;
  ganho: number;
  [key: string]: unknown;
}

export interface DashEventoCalendario {
  data: string;
  tipo?: string;
  descricao?: string;
  [key: string]: unknown;
}

export interface DashAcumulado {
  totalGanho?: number;
  diasUteisNoCiclo?: number;
  diasUteisRealDoEmpregadoNoCiclo?: number;
  diasTrabalhadosNoCiclo?: number;
  diasRestantesNoCiclo?: number;
  blocos?: DashBlocoSemana[];
  diasDetalhes?: DashDiaDetalhe[];
  eventosCalendario?: DashEventoCalendario[];
  totalPecasCiclo?: number;
  [key: string]: unknown;
}

// ── Cofre / banco de resgate ─────────────────────────────────────────────────

export interface DashCofre {
  saldo?: number | string;
  usosEssaSemana?: number;
  [key: string]: unknown;
}

export type DashCofreMovimentoTipo = 'GANHO' | 'RESGATE' | 'RESET' | string;

export interface DashCofreMovimento {
  tipo: DashCofreMovimentoTipo;
  quantidade: number | string;
  data_evento: string;
  [key: string]: unknown;
}

export interface DashCofreExtratoResponse {
  rows: DashCofreMovimento[];
  pagination: {
    totalPages: number;
    page?: number;
    limit?: number;
    [key: string]: unknown;
  };
}

// ── Pagamentos / carteira ────────────────────────────────────────────────────

export interface DashCicloPagamentoResumo {
  valor?: number | string | null;
  periodoInicio?: string | null;
  periodoFim?: string | null;
  dataPagamentoExata?: string | null;
  dataPagamentoFormatada?: string | null;
  quintoDiaUtil?: string | null;
  quintoDiaUtilFormatado?: string | null;
  isPrevisao?: boolean;
  notaPrevisao?: string | null;
  [key: string]: unknown;
}

export interface DashComissaoHistoricoItem {
  ciclo_nome?: string | null;
  descricao?: string | null;
  data_pagamento?: string | null;
  valor_liquido_pago?: number | string | null;
  [key: string]: unknown;
}

export interface DashPremioItem {
  id: number;
  banner_emoji?: string | null;
  gincana_nome?: string | null;
  nivel_label?: string | null;
  descricao_premio?: string | null;
  ganho_em?: string | null;
  pago_em?: string | null;
  valor_reais?: number | string | null;
  [key: string]: unknown;
}

export interface DashMeusPremiosResponse {
  pendentes?: DashPremioItem[];
  pagos?: DashPremioItem[];
}

// ── Payload principal GET /api/dashboard/desempenho ──────────────────────────

export interface DashDesempenhoResponse {
  usuario: DashUsuario;
  periodo?: DashPeriodo | null;
  hoje: DashHoje;
  acumulado: DashAcumulado;
  metasPossiveis: DashMeta[];
  cofre?: DashCofre | null;
  acumuladoCicloAtual?: DashCicloPagamentoResumo | null;
  pagamentoCicloFechado?: DashCicloPagamentoResumo | null;
  [key: string]: unknown;
}

// ── Atividades recentes ──────────────────────────────────────────────────────

export type DashFiltroPeriodoAtividades = 'hoje' | 'ontem' | 'especifico';

export interface DashAtividade {
  id?: number | string;
  id_original?: number | string;
  data?: string | null;
  nome_produto?: string | null;
  variacao?: string | null;
  op_numero?: string | number | null;
  processo?: string | null;
  quantidade?: number | string | null;
  pontos_gerados?: number | string | null;
  tipo_origem?: string | null;
  [key: string]: unknown;
}

export interface DashAtividadesResponse {
  rows?: DashAtividade[];
  [key: string]: unknown;
}

// ── Ranking semanal ──────────────────────────────────────────────────────────

export interface DashRankingItem {
  posicao: number;
  pontos?: number | null;
  isEu?: boolean;
  separador?: boolean;
  [key: string]: unknown;
}

export interface DashRankingSemana {
  minhaPosicao?: number | null;
  totalParticipantes?: number;
  tipoUsuario?: string | null;
  gapParaProximo?: number;
  posicaoAcima?: number | null;
  labelSemana?: string | null;
  diaSemana?: number;
  todosZerados?: boolean;
  ranking?: DashRankingItem[];
  rankingCompleto?: DashRankingItem[];
  semanasNoTopo?: number | null;
  [key: string]: unknown;
}

// ── Status ao vivo (produção) ────────────────────────────────────────────────

export type DashStatusAtualCodigo =
  | 'PRODUZINDO'
  | 'ALMOCO'
  | 'PAUSA'
  | 'PAUSA_MANUAL'
  | 'LIVRE'
  | 'LIVRE_MANUAL'
  | 'FOLGA'
  | 'FORA_DO_HORARIO'
  | 'CONCLUIDA'
  | 'CONCLUIDO'
  | string;

export interface DashPontoHoje {
  horario_real_s1?: string | null;
  horario_real_e2?: string | null;
  horario_real_s2?: string | null;
  horario_real_e3?: string | null;
  [key: string]: unknown;
}

export interface DashTarefaStatus {
  data_inicio?: string | null;
  produto_nome?: string | null;
  variante?: string | null;
  processo?: string | null;
  quantidade?: number;
  valor_ponto?: number | null;
  tpp?: number | null;
  imagem?: string | null;
  [key: string]: unknown;
}

export interface DashMeuStatus {
  status_atual?: DashStatusAtualCodigo;
  tarefa_atual?: DashTarefaStatus | null;
  tarefa_concluida?: DashTarefaStatus | null;
  proxima_tarefa?: DashTarefaStatus | null;
  ponto_hoje?: DashPontoHoje | null;
  pontos_hoje?: number | null;
  pontos_ultima_tarefa?: number | null;
  horario_saida_1?: string | null;
  horario_entrada_2?: string | null;
  horario_saida_2?: string | null;
  horario_entrada_3?: string | null;
  dias_trabalho?: Record<string, boolean> | null;
  tipos?: string[];
  [key: string]: unknown;
}

// ── Avisos popup (dashboard) ─────────────────────────────────────────────────

export type DashAvisoCor = 'azul' | 'ambar' | 'verde' | 'vermelho' | string;
export type DashAvisoTipo = 'texto' | 'imagem' | 'misto' | string;

export interface DashAvisoPopup {
  id: number;
  titulo?: string | null;
  mensagem?: string | null;
  tipo?: DashAvisoTipo;
  cor_fundo?: DashAvisoCor;
  url_imagem?: string | null;
  urgente?: boolean;
  [key: string]: unknown;
}

// ── Saldo cartão VT (menu lateral) ───────────────────────────────────────────

export interface DashVtMovimento {
  id?: number | string;
  tipo?: string;
  sentido?: string | null;
  valor?: number;
  data_ref?: string | null;
  justificativa_fato?: string | null;
  justificativa_demora?: string | null;
  ocorreu_em?: string | null;
  rotulo?: string;
  [key: string]: unknown;
}

export interface DashVtSoftDesconto {
  sentido?: 'ida' | 'volta' | string;
  valor?: number;
  data_ref?: string | null;
  desde_hora?: string | null;
  rotulo?: string | null;
  mensagem_simples?: string | null;
}

export interface DashVtSaldo {
  schema_ok?: boolean;
  visivel?: boolean;
  /** Saldo real no livro (sem soft). */
  saldo_disponivel?: number;
  /** Saldo para a empregada ver (livro − soft ida da manhã). */
  saldo_exibido?: number;
  soft_ativo?: boolean;
  soft_total?: number;
  soft_descontos?: DashVtSoftDesconto[];
  soft_desde_hora?: string | null;
  soft_fonte_hora?: 'jornada_e1' | 'padrao_0730' | string | null;
  soft_simulado?: boolean;
  saldo_provisionado?: number;
  valor_passagem_diaria?: number;
  valor_via?: number;
  dias_restantes_estimados?: number;
  vias_restantes_estimadas?: number;
  proximo_consumo_em?: string | null;
  recargas_provisionadas?: Array<{ valor?: number; valida_em?: string | null }>;
  ultimos_movimentos?: DashVtMovimento[];
  mensagem?: string;
  [key: string]: unknown;
}

// ── Gincanas (visão dashboard / FAB) ─────────────────────────────────────────

export interface DashGincanaPremiacao {
  id?: number;
  nivel_label?: string | null;
  emoji_icone?: string | null;
  meta_valor?: number | string | null;
  meta_pontos?: number | string | null;
  descricao_premio?: string | null;
  valor_premio_reais?: number | string | null;
  ordem?: number;
  [key: string]: unknown;
}

export interface DashGincanaDashboard {
  id: number;
  nome: string;
  descricao?: string | null;
  banner_emoji?: string | null;
  fase?: string;
  tipo_premiacao?: string;
  modalidade?: string;
  escopo_atividade?: string;
  produto_nome?: string | null;
  tipo_recorrencia?: string;
  datetime_inicio?: string | null;
  datetime_fim?: string | null;
  hora_inicio_semana?: string | null;
  hora_fim_semana?: string | null;
  segundos_para_inicio?: number | null;
  segundos_para_fim?: number | null;
  semana_label?: string | null;
  meu_valor?: number | null;
  valor_equipe?: number | null;
  minha_posicao?: number | null;
  total_participantes?: number | null;
  meu_nivel_ganho?: string | null;
  proxima_meta?: DashGincanaPremiacao | null;
  premiacoes?: DashGincanaPremiacao[];
  sou_vencedor?: boolean;
  premio_registrado?: boolean;
  premio_pago?: boolean;
  ganho_em?: string | null;
  encerrada_com_ganhador?: boolean;
  vencedor_id?: number | null;
  [key: string]: unknown;
}

export type DashGincanaFiltroFab =
  | 'todas'
  | 'ao_vivo'
  | 'proximas'
  | 'conquistadas'
  | 'encerradas';

export type DashFabGincanaEstado = 'ao_vivo' | 'proxima' | 'encerrada';

// ── Streak / conquistas / perfil ─────────────────────────────────────────────

export interface DashStreakResponse {
  diasSeguidos?: number;
  badgeAtual?: string | null;
  proximoBadge?: string | null;
  diasParaBadge?: number | null;
  [key: string]: unknown;
}

export interface DashConquistaItem {
  id: number | string;
  icone?: string | null;
  nome?: string | null;
  descricao?: string | null;
  desbloqueada?: boolean;
  [key: string]: unknown;
}

export interface DashConquistasCicloResponse {
  total?: number;
  desbloqueadas?: number;
  lista?: DashConquistaItem[];
  [key: string]: unknown;
}

// ── Tabela de pontos ─────────────────────────────────────────────────────────

export interface DashTabelaProcesso {
  nome?: string | null;
  pontos?: number | null;
  [key: string]: unknown;
}

export interface DashTabelaProduto {
  produto_nome?: string | null;
  produto_imagem?: string | null;
  processos?: DashTabelaProcesso[];
  [key: string]: unknown;
}

// ── Changelog (rodapé) ───────────────────────────────────────────────────────

export interface DashChangelogEntrada {
  versao: string;
  versao_dashboard?: string;
  data?: string;
  admin?: string[];
  dashboard?: string[];
  [key: string]: unknown;
}

// ── Erros de API com código de negócio ───────────────────────────────────────

export interface DashApiError extends Error {
  codigo?: string;
  statusCode?: number;
}
