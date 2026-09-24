export type EstoqueStatus = 'ok' | 'baixo' | 'urgente' | 'sem-meta';

export interface EstoqueSaldo {
  produto_id: number | string;
  produto_nome: string;
  variante_nome?: string | null;
  saldo_atual: number | string | null;
  ultima_data_movimento?: string | null;
  produto_ref_id: string;
}

export interface ProdutoGrade {
  sku?: string | null;
  variacao?: string | null;
  imagem?: string | null;
}

export interface ProdutoVariacao {
  chave: string;
  valores?: string[] | string | null;
  opcoes?: string[] | string | null;
}

export interface ProdutoCadastro {
  id: number | string;
  nome: string;
  sku?: string | null;
  imagem?: string | null;
  grade?: ProdutoGrade[] | null;
  variacoes?: ProdutoVariacao[] | null;
}

export interface NivelEstoque {
  produto_ref_id: string;
  nivel_estoque_baixo?: number | string | null;
  nivel_reposicao_urgente?: number | string | null;
  nivel_estoque_ideal?: number | string | null;
  ativo?: boolean | null;
}

export interface ItemEstoque extends EstoqueSaldo {
  produto: ProdutoCadastro | null;
  imagem: string;
  saldo: number;
  nivel: NivelEstoque | null;
  status: EstoqueStatus;
}

export interface FiltroEstoqueAvancado {
  id: string;
  produtoId: string;
  indiceVariacao: number;
  rotulo: string;
  opcoes: string[];
}
