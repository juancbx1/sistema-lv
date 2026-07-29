export type FinanceiroView = 'main' | 'configuracoes' | 'aprovacoes' | 'historico' | 'relatorios';
export type FinanceiroTab = 'dashboard' | 'lancamentos' | 'agenda';
export type FinanceiroConfigPanel = 'contas' | 'favorecidos' | 'categorias' | 'taxas-vt';
export type FinanceiroRefreshScope = 'dashboard' | 'lancamentos' | 'agenda' | 'config' | 'feed' | 'header' | 'all';

export interface FinanceiroPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FinanceiroApiError {
  error: string;
  details?: string;
}

export interface FinanceiroFilters {
  termoBusca: string;
  dataInicio: string;
  dataFim: string;
  tipo: string;
  idConta: string;
  tipoRateio: string;
}

export interface FinanceiroConta {
  id: string | number;
  nome_conta: string;
  banco?: string;
  agencia?: string;
  numero_conta?: string;
  saldo_atual?: string | number;
}

export interface FinanceiroGrupo {
  id: string | number;
  nome: string;
  tipo: string;
}

export interface FinanceiroCategoria {
  id: string | number;
  nome: string;
  id_grupo: string | number;
}

export interface FinanceiroContato {
  id: string | number;
  nome: string;
  tipo?: string;
  ativo?: boolean;
  cpf_cnpj?: string;
  observacoes?: string;
}

export interface FinanceiroSharedConfig {
  contas: FinanceiroConta[];
  categorias: FinanceiroCategoria[];
  grupos: FinanceiroGrupo[];
}

export interface FinanceiroLancamentoItem {
  id: string | number;
  descricao_item?: string;
  quantidade?: string | number;
  valor_unitario?: string | number;
  valor_total_item?: string | number;
  valor_item?: string | number;
  nome_contato_item?: string;
  nome_categoria?: string;
  id_categoria?: string | number | null;
  id_contato_item?: string | number | null;
}

export interface FinanceiroLancamento {
  id: string | number;
  tipo?: string;
  tipo_rateio?: string | null;
  valor: string | number;
  valor_desconto?: string | number;
  descricao?: string;
  nome_categoria?: string;
  nome_conta?: string;
  nome_favorecido?: string;
  nome_usuario?: string;
  nome_usuario_edicao?: string;
  data_lancamento?: string;
  data_transacao?: string;
  data_vencimento?: string;
  data_programada?: string;
  atualizado_em?: string;
  id_categoria?: string | number | null;
  id_conta_bancaria?: string | number | null;
  id_contato?: string | number | null;
  id_estorno_de?: string | number | null;
  id_transferencia_vinculada?: string | number | null;
  status_edicao?: string;
  itens?: FinanceiroLancamentoItem[];
}

export interface FinanceiroAgendaItem {
  id: string | number;
  id_lote?: string | number;
  descricao: string;
  tipo: string;
  tipo_rateio?: string;
  valor: string | number;
  data_vencimento: string;
  nome_favorecido?: string;
  nome_categoria?: string;
  nome_usuario_agendamento?: string;
  nome_usuario_edicao?: string;
  atualizado_em?: string;
  id_categoria?: string | number | null;
  id_contato?: string | number | null;
  itens?: Array<{
    id?: string | number;
    id_categoria?: string | number | null;
    id_contato_item?: string | number | null;
    nome_contato_item?: string;
    nome_categoria?: string;
    descricao_item?: string;
    valor_item?: string | number;
  }>;
}

export interface FinanceiroRefreshTokens {
  dashboard: number;
  lancamentos: number;
  agenda: number;
  config: number;
  feed: number;
  header: number;
}

export type FinanceiroConfigModalKind = 'conta' | 'contato' | 'grupo' | 'categoria';

export interface FinanceiroConfigModalRequest {
  kind: FinanceiroConfigModalKind;
  item?: {
    id?: string | number;
    nome_conta?: string;
    banco?: string;
    agencia?: string;
    numero_conta?: string;
    nome?: string;
    tipo?: string;
    cpf_cnpj?: string;
    observacoes?: string;
    id_grupo?: string | number;
    ativo?: boolean;
  };
}

export interface FinanceiroAgendaModalRequest {
  mode: 'agenda' | 'baixa';
  item?: FinanceiroAgendaItem;
}
