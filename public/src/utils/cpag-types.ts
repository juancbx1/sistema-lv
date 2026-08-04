/** Tipos de domínio da Central de Pagamentos (CPAG). */

export type CpagTab = 'comissao' | 'bonus' | 'passagem' | 'salario' | 'beneficios' | 'recibos';

export type CpagTipoPagamento =
  | 'COMISSAO'
  | 'BONUS'
  | 'SALARIO'
  | 'BENEFICIOS'
  | 'VT'
  | string;

export interface CpagSelectOption<T = number | string> {
  value: T;
  label: string;
}

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
  valor_passagem_diaria?: number | string | null;
  concessionarias_vt?: Array<number | string> | null;
  id_contato_financeiro?: number | string | null;
}

export interface CpagContaFinanceira {
  id: number | string;
  nome_conta: string;
  saldo?: number | string;
  ativo?: boolean;
}

export interface CpagConcessionaria {
  id: number | string;
  nome?: string;
  nome_concessionaria?: string;
  taxa_recarga_percentual?: number | string;
  id_contato_financeiro?: number | string | null;
  ativo?: boolean;
}

export interface CpagHistoricoPagamento {
  id?: number | string;
  usuario_id: number | string;
  ciclo_nome?: string;
  descricao?: string;
  valor?: number | string;
  data_pagamento?: string;
}

export interface CpagHistoricoVT {
  id: number | string;
  data_pagamento: string;
  descricao: string;
  valor_liquido_pago: number | string;
  estornado_em?: string | null;
}

export interface CpagLoteVTItem {
  id: number | string;
  nome_funcionario: string;
  valor: number | string;
  detalhes?: string | { datas_pagas?: string[] } | null;
}

export interface CpagLoteVT {
  data_pagamento: string;
  descricao: string;
  qtd_funcionarios: number;
  valor_total: number | string;
  ja_impresso?: boolean;
  itens: CpagLoteVTItem[];
}

export interface CpagDiaComissao {
  data: string;
  pontosProduzidos: number;
  pontosExtras: number;
  pontosResgatados: number;
  totalPontos: number;
  meta: string;
  valor: number;
}

export interface CpagResultadoCalculo {
  proventos: {
    comissao: number;
    salarioProporcional?: number;
    valeTransporte?: number;
    beneficios?: number;
  };
  descontos?: {
    inss?: number;
    valeTransporte?: number;
  };
  totais?: {
    totalLiquidoAPagar?: number;
  };
  detalhes?: CpagCalculoDetalhes;
  dadosDetalhados?: {
    resumo?: {
      totalProduzido: number;
      totalResgatado: number;
    };
    dias?: CpagDiaComissao[];
  };
}

export interface CpagCalculoDetalhes {
  funcionario: {
    id: number | string;
    nome: string;
  };
  ciclo: {
    nome: string;
  };
  tipoPagamento: CpagTipoPagamento;
}

/** Corpo de POST /api/pagamentos/efetuar montado pelas abas. */
export interface CpagPayloadEfetuar {
  calculo: CpagResultadoCalculo | {
    detalhes: CpagCalculoDetalhes;
    proventos: {
      salarioProporcional?: number;
      comissao?: number;
      valeTransporte?: number;
      beneficios?: number;
    };
    descontos?: {
      inss?: number;
      valeTransporte?: number;
    };
    totais: {
      totalLiquidoAPagar: number;
    };
  };
  id_conta_debito: number | string;
}

export interface CpagRespostaEfetuar {
  message?: string;
  error?: string;
}

export interface CpagIntervaloRecibo {
  data_inicio: string;
  data_fim: string;
  data_geracao?: string;
}

export interface CpagRecibosCobertos {
  data_inicio: string;
  data_fim: string;
  usuario_ids: Array<number | string>;
}

/** Intervalo de recibo da empresa (para contagem global de pendências). */
export interface CpagIntervaloReciboEmpresa {
  usuario_id: number | string;
  data_inicio: string;
  data_fim: string;
}

export interface CpagReciboDia {
  data: string;
  totalDia: number;
  valor: number;
  pontos: number;
  resgate: number;
  ganhoCofre: number;
  metaNome: string;
}

export interface CpagRegistroDiaEvento {
  start: string;
  extendedProps?: {
    status?: string;
  };
}

export interface CpagLoteVTPayloadItem {
  usuario_id: number | string;
  id_contato_financeiro?: number | string | null;
  nome_funcionario: string;
  dias_qtd: number;
  valor_total: number;
  datas_lista: string[];
}

/** Movimento do livro do cartão VT. */
export interface CpagVtMovimento {
  id: number | string;
  tipo: string;
  sentido?: string | null;
  status_credito?: string | null;
  valor: number;
  data_ref?: string | null;
  data_origem?: string | null;
  data_destino?: string | null;
  motivo?: string | null;
  justificativa_fato?: string | null;
  justificativa_demora?: string | null;
  ocorreu_em?: string | null;
  valida_em?: string | null;
  autor_nome?: string | null;
  rotulo?: string;
}

export interface CpagVtTransferencia {
  data_origem?: string | null;
  data_destino?: string | null;
  motivo?: string | null;
  ocorreu_em?: string | null;
  autor_nome?: string | null;
}

export interface CpagVtSaldo {
  schema_ok?: boolean;
  visivel?: boolean;
  usuario_id?: number | string;
  nome?: string;
  saldo_disponivel: number;
  saldo_provisionado: number;
  valor_passagem_diaria: number;
  valor_via?: number;
  dias_restantes_estimados?: number;
  vias_restantes_estimadas?: number;
  proximo_consumo_em?: string | null;
  recargas_provisionadas?: Array<{ id: number | string; valor: number; valida_em?: string | null }>;
  transferencias?: CpagVtTransferencia[];
  ultimos_movimentos?: CpagVtMovimento[];
  mensagem?: string;
  erro?: string;
}

export interface CpagVtAjustePayload {
  usuario_id: number | string;
  data_ref: string;
  usou_ida: boolean;
  usou_volta: boolean;
  justificativa_fato: string;
  justificativa_demora: string;
}

export interface CpagLoteVTPayload {
  id_conta_debito: number | string;
  id_concessionaria: number | string;
  id_contato_concessionaria?: number | string | null;
  nome_concessionaria: string;
  valor_total_vt: number;
  valor_total_taxa: number;
  itens: CpagLoteVTPayloadItem[];
}

export interface CpagLinhaTabelaVT {
  id: number | string;
  nome: string;
  valorDiario: number;
  dias: string[];
  total: number | string;
  totalManual: boolean;
}

export interface CpagConfiguracoesFinanceiras {
  contas?: CpagContaFinanceira[];
}

export interface CpagApiError {
  error?: string;
  details?: string;
  message?: string;
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

/**
 * Status visual da competência de comissão.
 * - atual: ciclo em aberto
 * - proximo_pagamento: fechado, não pago e com valor > 0
 * - sem_comissao: fechado, não pago e valor 0 (ex.: iniciante sem meta)
 * - pago: já quitado no histórico
 * - historico: demais (ex.: fechados com valor ainda sem destaque)
 */
export type CpagCicloStatus =
  | 'atual'
  | 'proximo_pagamento'
  | 'sem_comissao'
  | 'pago'
  | 'historico';

export interface CpagCicloOption extends CpagSelectOption<string> {
  jaFoiPago: boolean;
  mesIndex: number;
  ano: number;
  /** Ciclo já passou do dia 20 (fechado). */
  cicloFechado: boolean;
  status: CpagCicloStatus;
  /** Ex.: "21/mai – 20/jun". */
  periodoLabel: string;
  /**
   * Mês em que a comissão é paga: sempre o mês seguinte ao fechamento (dia 20).
   * Ex.: ciclo 21/jun–20/jul → pagamento em Agosto.
   */
  mesPagamentoLabel: string;
  /** Ex.: "ago/2026" — forma curta para chips. */
  mesPagamentoCurto: string;
  /**
   * Valor calculado de comissão (preenchido para ciclos fechados não pagos).
   * `null` = ainda não consultado.
   */
  valorComissao?: number | null;
}

export interface CpagConcessionariaOption extends CpagSelectOption {
  taxa_recarga_percentual?: number | string;
  id_contato_financeiro?: number | string | null;
}

export interface CpagFolhaSalarioItem {
  id: number | string;
  nome: string;
  base: number;
  inss: number;
  vt: number;
  liquidoFinal: string;
  selecionado: boolean;
  pago: boolean;
}

/**
 * Status da referência mensal de salário (mês corrido 01–último dia).
 * - em_aberto: mês ainda em curso
 * - a_pagar: mês fechado, não pago, ainda dentro do prazo (até 5º dia útil do mês seguinte)
 * - pendente: mês fechado, não pago e já vencido (passou o 5º dia útil)
 * - pago: já quitado no histórico (visão de folha)
 */
export type CpagSalarioMesStatus = 'em_aberto' | 'a_pagar' | 'pendente' | 'pago' | 'historico';

export interface CpagSalarioMesOption {
  value: string; // "Março/2026"
  label: string;
  mesIndex: number;
  ano: number;
  mesFechado: boolean;
  vencido: boolean;
  status: CpagSalarioMesStatus;
  periodoLabel: string; // "01/mar – 31/mar"
  mesPagamentoLabel: string; // "Abril/2026"
  mesPagamentoCurto: string;
  prazoLabel: string; // "até 5º dia útil de abr/2026"
}

export interface CpagFolhaBeneficioItem {
  id: number | string;
  nome: string;
  valor: string;
  selecionado: boolean;
  pago: boolean;
}
