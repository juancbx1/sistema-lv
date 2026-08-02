/** Tipos de domínio do Centro de Incentivos (admin). */

// ── Abas e filtros ────────────────────────────────────────────────────────────

export type IncenAba = 'gincanas' | 'metas' | 'pontos' | 'pagamentos';

export type IncenGincanaFiltro = 'ativas' | 'proximas' | 'rascunhos' | 'arquivo';

export type IncenPagamentosSubAba = 'fila' | 'historico';

// ── Enums / unions de gincana ─────────────────────────────────────────────────

export type GincanaStatus = 'rascunho' | 'publicada' | 'cancelada';

export type GincanaFase =
  | 'proxima'
  | 'ao_vivo'
  | 'encerrada'
  | 'arquivada'
  | 'encerrada_semana'
  | 'rascunho'
  | 'cancelada'
  | string;

export type GincanaParticipantes = 'costureiras' | 'tiktiks' | 'ambos';

export type GincanaModalidade = 'individual' | 'equipe';

export type GincanaTipoPremiacao = 'meta' | 'corrida';

export type GincanaEscopoAtividade =
  | 'tudo'
  | 'apenas_processos_op'
  | 'apenas_arremates'
  | 'produto_especifico';

export type GincanaTipoRecorrencia = 'unica' | 'semanal';

// ── Premiações ────────────────────────────────────────────────────────────────

export interface GincanaPremiacao {
  id?: number;
  gincana_id?: number;
  nivel_label?: string | null;
  emoji_icone?: string | null;
  /** Meta em pontos ou unidades (produto_especifico). */
  meta_valor?: number | string | null;
  /** Alias legado usado em alguns payloads. */
  meta_pontos?: number | string | null;
  descricao_premio?: string | null;
  valor_premio_reais?: number | string | null;
  ordem?: number;
  criado_em?: string;
}

/** Premiação em edição no wizard (campos de formulário como string). */
export interface GincanaPremiacaoForm {
  _id: string;
  id?: number;
  nivel_label: string;
  emoji_icone: string;
  meta_valor: string | number;
  descricao_premio: string;
  valor_premio_reais: string | number;
  ordem: number;
  meta_pontos?: number | string | null;
}

// ── Gincana ───────────────────────────────────────────────────────────────────

export interface Gincana {
  id: number;
  nome: string;
  descricao?: string | null;
  banner_emoji?: string | null;
  participantes?: GincanaParticipantes | string;
  modalidade?: GincanaModalidade | string;
  tipo_premiacao?: GincanaTipoPremiacao | string;
  escopo_atividade?: GincanaEscopoAtividade | string;
  produto_id?: number | null;
  produto_nome?: string | null;
  tipo_recorrencia?: GincanaTipoRecorrencia | string;
  datetime_inicio?: string | null;
  datetime_fim?: string | null;
  hora_inicio_semana?: string | null;
  hora_fim_semana?: string | null;
  status: GincanaStatus | string;
  visivel_dashboard?: boolean;
  vencedor_id?: number | null;
  encerrada_com_ganhador?: boolean;
  /** Fase calculada em runtime pela API. */
  fase?: GincanaFase;
  semana_label?: string | null;
  segundos_para_fim?: number | null;
  segundos_para_inicio?: number | null;
  premiacoes?: GincanaPremiacao[];
  criado_por?: number | null;
  criado_em?: string;
  atualizado_em?: string;
}

/** Draft local ao abrir "Nova Gincana" (ainda sem id no servidor). */
export interface GincanaNovoDraft {
  _novo: true;
}

export type GincanaEditando = Gincana | GincanaNovoDraft;

export function isGincanaNovoDraft(g: GincanaEditando | null | undefined): g is GincanaNovoDraft {
  return !!g && '_novo' in g && g._novo === true;
}

// ── Ranking ───────────────────────────────────────────────────────────────────

export interface GincanaRankingRow {
  usuario_id: number;
  nome: string;
  valor: number;
  posicao: number;
  nivel_ganho?: string | null;
  premio_pago?: boolean;
  premio_registrado?: boolean;
  ganho_em?: string | null;
}

export interface GincanaRankingResponse {
  gincana?: Gincana;
  premiacoes?: GincanaPremiacao[];
  ranking?: GincanaRankingRow[];
  semana_label?: string | null;
  total_equipe?: number | null;
}

// ── Payload de criação/edição ─────────────────────────────────────────────────

export interface GincanaPayload {
  nome: string;
  descricao: string | null;
  banner_emoji: string;
  participantes: string;
  modalidade: string;
  tipo_premiacao: string;
  escopo_atividade: string;
  produto_id: number | null;
  tipo_recorrencia: string;
  datetime_inicio: string | null;
  datetime_fim: string | null;
  hora_inicio_semana: string | null;
  hora_fim_semana: string | null;
  visivel_dashboard: boolean;
  premiacoes: Array<{
    nivel_label: string;
    emoji_icone: string;
    meta_valor: number;
    descricao_premio: string;
    valor_premio_reais: number | null;
    ordem: number;
  }>;
}

export type GincanaWizardCampo =
  | 'nome'
  | 'bannerEmoji'
  | 'descricao'
  | 'participantes'
  | 'modalidade'
  | 'tipoPremiacao'
  | 'escopoAtividade'
  | 'produtoId'
  | 'tipoRecorrencia'
  | 'inicioData'
  | 'inicioHora'
  | 'fimData'
  | 'fimHora'
  | 'campanhaInicioData'
  | 'campanhaFimData'
  | 'horaInicio'
  | 'horaFim'
  | 'visivelDashboard';

export interface GincanaWizardForm {
  nome: string;
  bannerEmoji: string;
  descricao: string;
  participantes: GincanaParticipantes | string;
  modalidade: GincanaModalidade | string;
  tipoPremiacao: GincanaTipoPremiacao | string;
  escopoAtividade: GincanaEscopoAtividade | string;
  produtoId: number | null;
  tipoRecorrencia: GincanaTipoRecorrencia | string;
  inicioData: string;
  inicioHora: string;
  fimData: string;
  fimHora: string;
  campanhaInicioData: string;
  campanhaFimData: string;
  horaInicio: string;
  horaFim: string;
  visivelDashboard: boolean;
}

export interface GincanaWizardState extends GincanaWizardForm {
  premiacoes: GincanaPremiacaoForm[];
}

// ── Produto (seletor) ─────────────────────────────────────────────────────────

export interface IncenProdutoEtapa {
  processo?: string;
  maquina?: string;
  feitoPor?: string;
  [key: string]: unknown;
}

export interface IncenProduto {
  id: number;
  nome: string;
  is_kit?: boolean;
  etapas?: Array<IncenProdutoEtapa | string>;
  [key: string]: unknown;
}

// ── Metas e Comissões ─────────────────────────────────────────────────────────

export type MetaVersaoStatus = 'ativa' | 'futura' | 'arquivada';

export interface MetaVersao {
  id: number;
  nome_versao: string;
  data_inicio_vigencia: string;
  status?: MetaVersaoStatus;
}

export interface MetaCondicao {
  tipo: string;
  produto_id: number;
  quantidade_minima: number;
}

export interface MetaRegra {
  id: number;
  id_versao?: number;
  tipo_usuario: string;
  nivel: number | string;
  descricao_meta: string;
  pontos_meta: number | string;
  valor_comissao: number | string;
  condicoes?: MetaCondicao[];
}

export interface MetaRegraPayload {
  descricao_meta: string;
  pontos_meta: number;
  valor_comissao: number;
  condicoes?: MetaCondicao[];
}

export interface MetaRegraNovaPayload {
  descricao_meta: string;
  pontos_meta: number;
  valor_comissao: number;
}

export interface MetaGrupoRegras {
  titulo: string;
  tipo_usuario: string;
  nivel: number | string;
  regras: MetaRegra[];
}

export interface MetaNovaVersaoPayload {
  nome_versao: string;
  data_inicio_vigencia: string;
  id_versao_origem_clone: number;
}

// ── Pontos por Atividade ──────────────────────────────────────────────────────

export type PontoTipoAtividade =
  | 'costura_op_costureira'
  | 'processo_op_tiktik'
  | 'arremate_tiktik'
  | string;

export interface PontoConfig {
  id: number;
  produto_id: number;
  produto_nome: string;
  processo_nome: string;
  tipo_atividade: PontoTipoAtividade;
  pontos_padrao: number | string;
  ativo: boolean;
}

export interface PontoConfigPayload {
  pontos_padrao: number;
  ativo: boolean;
}

export interface PontoConfigNovaPayload {
  produto_id: number;
  processo_nome?: string;
  tipo_atividade: PontoTipoAtividade;
  pontos_padrao: number;
  ativo: boolean;
}

export interface PontoGrupoProduto {
  produto_id: number;
  produto_nome: string;
  configs: PontoConfig[];
}

// ── Pagamentos de premiações ──────────────────────────────────────────────────

export interface PremioGanhoItem {
  id: number;
  gincana_id?: number;
  gincana_nome?: string;
  banner_emoji?: string | null;
  usuario_id?: number;
  usuario_nome?: string;
  nivel_label?: string | null;
  descricao_premio?: string | null;
  valor_reais?: number | string | null;
  ganho_em?: string | null;
  pago_em?: string | null;
  pago_por?: number | null;
  pago_por_nome?: string | null;
  semana_ref?: string | null;
}

export interface PremiosFilaResponse {
  total_pendente?: number;
  pendentes_semana_atual?: PremioGanhoItem[];
  pendentes_atrasados?: PremioGanhoItem[];
}

export interface PremiosPagarLoteResult {
  pagos: number;
}
