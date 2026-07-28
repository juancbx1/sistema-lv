export type CpagTab = 'comissao' | 'bonus' | 'passagem' | 'salario' | 'beneficios' | 'recibos';

export interface CpagUsuario {
  id: number | string;
  nome: string;
  tipos?: string[] | string;
  permissoes?: string[];
  elegivel_pagamento?: boolean;
  data_admissao?: string | null;
  data_demissao?: string | null;
  salario_fixo?: number | string | null;
  desconto_inss_percentual?: number | string | null;
  desconto_vt_percentual?: number | string | null;
  [key: string]: unknown;
}

export interface CpagContaFinanceira {
  id: number | string;
  nome_conta: string;
  saldo?: number | string;
  ativo?: boolean;
  [key: string]: unknown;
}

export interface CpagConcessionaria {
  id: number | string;
  nome?: string;
  nome_concessionaria?: string;
  valor_tarifa?: number | string;
  [key: string]: unknown;
}

export interface CpagHistoricoVT {
  id: number | string;
  data_pagamento: string;
  descricao: string;
  valor_liquido_pago: number | string;
  estornado_em?: string | null;
  [key: string]: unknown;
}

export interface CpagLoteVTItem {
  id: number | string;
  nome_funcionario: string;
  valor: number | string;
  detalhes?: string | { datas_pagas?: string[] } | null;
  [key: string]: unknown;
}

export interface CpagLoteVT {
  data_pagamento: string;
  descricao: string;
  qtd_funcionarios: number;
  valor_total: number | string;
  ja_impresso?: boolean;
  itens: CpagLoteVTItem[];
  [key: string]: unknown;
}

export interface CpagApiError {
  error?: string;
  details?: string;
  [key: string]: unknown;
}

export interface CpagAuthResult {
  usuario?: CpagUsuario;
  permissoes?: string[];
}

export interface CpagPaginationProps {
  paginaAtual: number;
  totalPaginas: number;
  onPageChange: (pagina: number) => void;
}
