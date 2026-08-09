export interface ProdutoComponenteKit {
  produto_id?: number | string | null;
  produto_nome?: string | null;
  variacao?: string | null;
  quantidade?: number | string | null;
  [key: string]: unknown;
}

export interface ProdutoGradeItem {
  variacao?: string | null;
  sku?: string | null;
  imagem?: string | null;
  composicao?: ProdutoComponenteKit[] | null;
  [key: string]: unknown;
}

export interface ProdutoCadastro {
  id: number | string;
  nome?: string | null;
  sku?: string | null;
  imagem?: string | null;
  is_kit?: boolean | null;
  grade?: ProdutoGradeItem[] | null;
  [key: string]: unknown;
}

export interface EmbalagemFilaItemApi {
  produto_id: number | string;
  produto?: string | null;
  nome_produto?: string | null;
  variante?: string | null;
  total_disponivel_para_embalar?: number | string | null;
  quantidade_disponivel?: number | string | null;
  quantidade?: number | string | null;
  data_lancamento_mais_antiga?: string | null;
  data_lancamento_mais_recente?: string | null;
  sku?: string | null;
  [key: string]: unknown;
}

export interface EmbalagemFilaItem {
  id: string;
  produtoId: number | string;
  nomeProduto: string;
  variante: string;
  sku: string;
  quantidadeDisponivel: number;
  disponivelDesde: string | null;
  imagem: string;
  produto: ProdutoCadastro | null;
  origem: EmbalagemFilaItemApi;
}

export interface EmbalagemArremateLote {
  id: number | string;
  quantidade_arrematada?: number | string | null;
  quantidade_ja_embalada?: number | string | null;
  data_lancamento?: string | null;
  data_final?: string | null;
  [key: string]: unknown;
}

export interface EmbalagemHistoricoItem {
  id: number | string;
  tipo_embalagem?: string | null;
  quantidade_embalada?: number | string | null;
  data_embalagem?: string | null;
  observacao?: string | null;
  status?: string | null;
  produto_embalado_nome?: string | null;
  variante_embalada_nome?: string | null;
  usuario_responsavel?: string | null;
  [key: string]: unknown;
}

export interface EmbalagemHistoricoResposta {
  rows?: EmbalagemHistoricoItem[];
  total?: number | string | null;
  page?: number | string | null;
  pages?: number | string | null;
}

export interface EmbalagemEstoqueSaldo {
  produto_id?: number | string | null;
  produto_nome?: string | null;
  variante_nome?: string | null;
  saldo_atual?: number | string | null;
  ultima_data_movimento?: string | null;
  produto_ref_id?: string | null;
  [key: string]: unknown;
}

export interface EmbalagemNivelEstoque {
  produto_ref_id?: string | null;
  nivel_estoque_baixo?: number | string | null;
  nivel_reposicao_urgente?: number | string | null;
  nivel_estoque_ideal?: number | string | null;
  ativo?: boolean | null;
  [key: string]: unknown;
}

export interface EmbalagemKitComponenteConsumido {
  id_arremate: number | string;
  produto_id: number | string;
  variacao: string | null;
  quantidade_usada: number;
}

export interface EmbalagemKitMontagemPayload {
  kit_produto_id: number | string;
  kit_variante: string | null;
  quantidade_kits_montados: number;
  componentes_consumidos_de_arremates: EmbalagemKitComponenteConsumido[];
  observacao: string | null;
}

export type EmbalagemFiltroRapido = 'todos' | 'urgente' | 'maior_saldo';

export type EmbalagemOrdenacao =
  | 'mais_antigo'
  | 'mais_recente'
  | 'maior_saldo'
  | 'produto';

export interface EmbalagemFiltros {
  busca: string;
  produtoId: string;
  tamanho: string;
  cor: string;
  rapido: EmbalagemFiltroRapido;
  ordenacao: EmbalagemOrdenacao;
}

export interface EmbalagemFiltroOpcoes {
  produtos: Array<{ id: string; nome: string }>;
  tamanhos: string[];
  cores: string[];
}
