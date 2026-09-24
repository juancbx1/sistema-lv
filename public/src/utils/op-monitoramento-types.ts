export type OPMonitoramentoFaixa = 'ACOMPANHAMENTO' | 'ATENCAO' | 'OBRIGATORIA' | 'CRITICA';

export interface OPMonitoramentoImpedimento {
  id: number;
  motivo: string;
  registrado_em: string;
  atualizado_em?: string | null;
  registrado_por: number;
  registrado_por_nome: string;
}

export interface OPMonitoramentoItem {
  id: number;
  edit_id: string | number;
  numero: string | number;
  produto_id: number;
  produto_nome: string;
  produto_imagem?: string | null;
  variante?: string | null;
  quantidade: number;
  quantidade_feita_ultima_etapa: number;
  encerramento_parcial: boolean;
  status: string;
  elegivel_desde: string;
  ultima_producao_em: string;
  horas_aguardando: number;
  faixa: OPMonitoramentoFaixa;
  total_etapas_op: number;
  impedimento?: OPMonitoramentoImpedimento | null;
}

export interface OPMonitoramentoResumo {
  total: number;
  acompanhamento: number;
  atencao: number;
  obrigatorias: number;
  criticas: number;
  impedidas: number;
  pendentes_acao: number;
}

export interface OPMonitoramentoResposta {
  servidor_em: string;
  persistencia_disponivel: boolean;
  pode_finalizar: boolean;
  intercepcao_obrigatoria: boolean;
  pode_adiar: boolean;
  adiamento_ativo?: { id: number; vence_em: string } | null;
  adiamentos_hoje: number;
  resumo: OPMonitoramentoResumo;
  ops: OPMonitoramentoItem[];
}

export interface OPMonitoramentoLoteDetalhe {
  op_id: number;
  numero?: string | number;
  ok: boolean;
  ja_finalizada?: boolean;
  codigo?: string;
  erro?: string;
}

export interface OPMonitoramentoLoteResultado {
  lote_id: number;
  sucesso: number;
  erro: number;
  detalhes: OPMonitoramentoLoteDetalhe[];
  reutilizado?: boolean;
}

export interface OPMonitoramentoStoreSnapshot {
  dados: OPMonitoramentoResposta | null;
  carregando: boolean;
  atualizando: boolean;
  erro: string | null;
}

