// Contratos mínimos da entrada da página de Ordens de Produção.
// A tipagem completa de cada aba será criada por fatias, sem alterar o domínio.

export type OpVisao = 'painel' | 'gerenciamento' | 'cortes' | 'externo';

export interface OpCriarModalDados {
  demandaId: number;
  produtoId: number;
  variante: string | null;
  quantidadeSugerida: number;
}

export interface OpInicioProducaoDados {
  demanda_id: number;
  produto_id: number;
  variante?: string | null;
  quantidade?: number | null;
}

export interface OpEtapaResumo {
  lancado?: boolean | null;
  processo?: string | null;
  usuario?: number | string | null;
  quantidade?: number | string | null;
  quantidade_feita?: number | string | null;
}

export interface OpRadarResumo {
  faixa?: 'normal' | 'atencao' | 'critico' | string | null;
  horas_abertas?: number | string | null;
  media_horas?: number | string | null;
}

export interface OpResumo {
  id?: number | string;
  edit_id?: number | string;
  numero?: number | string;
  produto_id: number;
  produto?: string | null;
  variante?: string | null;
  imagem_produto?: string | null;
  status?: string | null;
  quantidade?: number | string | null;
  data_entrega?: string | null;
  radar?: OpRadarResumo | null;
  etapas?: OpEtapaResumo[] | null;
}

export interface OpListResponse {
  rows?: Array<OpResumo | null>;
}

export interface OpGerenciamentoProps {
  opsPendentesGlobal: number;
  onRefreshContadores: () => void | Promise<void>;
  permissoes: string[];
}

export interface OpCriarModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOPCriada: () => void;
  demandaId: number;
  produtoId: number;
  variante: string | null;
  quantidadeSugerida: number;
}

export interface BotaoBuscaFunilProps {
  permissoes: string[];
  onIniciarProducao: (dados: OpInicioProducaoDados) => void;
}

export type OpStatus = 'todas' | 'produzindo' | 'finalizado' | 'cancelada';

export interface OpFiltroEstado {
  status: OpStatus;
  busca?: string;
}

export interface OpProdutoGrade {
  variacao?: string | null;
  imagem?: string | null;
}

export interface OpProduto {
  id: number;
  imagem?: string | null;
  grade?: OpProdutoGrade[] | null;
}

export interface OpUsuarioLogado {
  nome?: string | null;
  [key: string]: unknown;
}

export interface OpApiListResponse {
  rows: OpResumo[];
  pages?: number;
  total?: number;
  error?: string;
}

export interface OpCardProps {
  op: OpResumo;
  onClick: (op: OpResumo) => void;
  onCancelar: (op: OpResumo) => void | Promise<void>;
}

export interface OpEtapasModalProps {
  op: OpResumo | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateOP: () => void;
  onUpdateGlobal?: () => void | Promise<void>;
}

export interface OpModalLoteProps {
  isOpen: boolean;
  ops: OpResumo[];
  onClose: () => void;
  onConcluido: (resultado: { sucesso: number }) => void;
}

export interface OpCentralEncerramentoProps {
  opsPendentesGlobal: number;
  onAbrirLote: (ops: OpResumo[]) => void;
  resetKey: number;
  nomeUsuario: string | null;
}
