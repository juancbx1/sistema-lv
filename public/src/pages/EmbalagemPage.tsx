import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// @ts-expect-error paginação legada em JavaScript, mantida por compatibilidade.
import { renderizarPaginacao } from '/js/utils/Paginacao.js';
import UIHeaderPagina from '../components/UIHeaderPagina';
import UICarregando from '../components/UICarregando';
import UIFeedbackNotFound from '../components/UIFeedbackNotFound';
import EmbalagemCard from '../components/EmbalagemCard.tsx';
import EmbalagemModalPerda from '../components/EmbalagemModalPerda';
import EmbalagemModalOpcoes from '../components/EmbalagemModalOpcoes';
import EmbalagemPainelFiltros from '../components/EmbalagemPainelFiltros.tsx';
import {
  listarFilaEmbalagem,
  listarNiveisEstoque,
  listarProdutos,
  listarSaldoEstoque,
} from '../utils/embalagem-api';
import {
  getImagemVariacao,
  getNomeProduto,
  getSkuVariacao,
  getVariacaoPartes,
} from '../utils/embalagem-produto-helpers';
import type {
  EmbalagemFilaItem,
  EmbalagemFilaItemApi,
  EmbalagemEstoqueSaldo,
  EmbalagemFiltroOpcoes,
  EmbalagemFiltros,
  EmbalagemNivelEstoque,
  ProdutoCadastro,
} from '../utils/embalagem-types';

const filtrosIniciais: EmbalagemFiltros = {
  busca: '',
  produtoId: '',
  tamanho: '',
  cor: '',
  rapido: 'todos',
  ordenacao: 'mais_antigo',
};

const ITENS_POR_PAGINA = 6;

function toNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizarTexto(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function toDateValue(value: unknown): number {
  if (!value) return 0;
  const date = new Date(String(value)).getTime();
  return Number.isNaN(date) ? 0 : date;
}

function localizarProduto(
  produtos: ProdutoCadastro[],
  produtoId: number | string,
): ProdutoCadastro | null {
  return (
    produtos.find((produto) => String(produto.id) === String(produtoId)) || null
  );
}

function enriquecerFila(
  rows: EmbalagemFilaItemApi[],
  produtos: ProdutoCadastro[],
): EmbalagemFilaItem[] {
  const itens = rows.map((row, index) => {
    const produto = localizarProduto(produtos, row.produto_id);
    const variante = row.variante || '-';
    const disponivelDesde =
      row.data_lancamento_mais_antiga || row.data_lancamento_mais_recente || null;
    const quantidadeRecebida =
      row.total_disponivel_para_embalar
      ?? row.quantidade_disponivel
      ?? row.quantidade;

    return {
      id: `${row.produto_id}-${variante}-${index}`,
      produtoId: row.produto_id,
      nomeProduto: getNomeProduto(produto, row.produto || row.nome_produto),
      variante,
      sku: getSkuVariacao(produto, variante, row.sku),
      quantidadeDisponivel: toNumber(quantidadeRecebida),
      disponivelDesde,
      imagem: getImagemVariacao(produto, variante),
      produto,
      origem: row,
    };
  });

  return itens;
}

function getHorasAguardando(item: EmbalagemFilaItem): number {
  const timestamp = toDateValue(item.disponivelDesde);
  if (!timestamp) return 0;
  return Math.max(0, Date.now() - timestamp) / 3600000;
}

function montarOpcoesFiltro(items: EmbalagemFilaItem[]): EmbalagemFiltroOpcoes {
  const produtos = new Map<string, string>();
  const tamanhos = new Set<string>();
  const cores = new Set<string>();

  items.forEach((item) => {
    produtos.set(String(item.produtoId), item.nomeProduto);
    const partes = getVariacaoPartes(item.variante);
    if (partes.tamanho !== '-') tamanhos.add(partes.tamanho);
    if (partes.cor !== '-') cores.add(partes.cor);
  });

  return {
    produtos: [...produtos.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    tamanhos: [...tamanhos].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    cores: [...cores].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };
}

function aplicarFiltros(
  items: EmbalagemFilaItem[],
  filtros: EmbalagemFiltros,
): EmbalagemFilaItem[] {
  const busca = normalizarTexto(filtros.busca);

  const filtrados = items.filter((item) => {
    const partes = getVariacaoPartes(item.variante);
    const alvoBusca = normalizarTexto(
      `${item.nomeProduto} ${item.variante} ${item.sku}`,
    );

    if (busca && !alvoBusca.includes(busca)) return false;
    if (filtros.produtoId && String(item.produtoId) !== filtros.produtoId) {
      return false;
    }
    if (filtros.tamanho && normalizarTexto(partes.tamanho) !== normalizarTexto(filtros.tamanho)) {
      return false;
    }
    if (filtros.cor && normalizarTexto(partes.cor) !== normalizarTexto(filtros.cor)) {
      return false;
    }
    if (filtros.rapido === 'urgente' && getHorasAguardando(item) < 24) {
      return false;
    }

    return true;
  });

  return [...filtrados].sort((a, b) => {
    if (filtros.rapido === 'maior_saldo' || filtros.ordenacao === 'maior_saldo') {
      return b.quantidadeDisponivel - a.quantidadeDisponivel;
    }

    if (filtros.ordenacao === 'mais_recente') {
      return toDateValue(b.disponivelDesde) - toDateValue(a.disponivelDesde);
    }

    if (filtros.ordenacao === 'produto') {
      return a.nomeProduto.localeCompare(b.nomeProduto, 'pt-BR');
    }

    return toDateValue(a.disponivelDesde) - toDateValue(b.disponivelDesde);
  });
}

interface EmbalagemPageProps {
  onAtualizarMenu?: () => void;
}

async function carregarEstoqueSemBloquearFila<T>(
  carregar: () => Promise<T[]>,
  descricao: string,
): Promise<T[]> {
  try {
    return await carregar();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[Embalagem] ${descricao} indisponível:`, error);
    }
    return [];
  }
}

export default function EmbalagemPage({}: EmbalagemPageProps) {
  const [items, setItems] = useState<EmbalagemFilaItem[]>([]);
  const [catalogoProdutos, setCatalogoProdutos] = useState<ProdutoCadastro[]>([]);
  const [saldoEstoque, setSaldoEstoque] = useState<EmbalagemEstoqueSaldo[]>([]);
  const [niveisEstoque, setNiveisEstoque] = useState<EmbalagemNivelEstoque[]>([]);
  const [filtros, setFiltros] = useState<EmbalagemFiltros>(filtrosIniciais);
  const [selecionado, setSelecionado] = useState<EmbalagemFilaItem | null>(null);
  const [paginaAtual, setPaginaAtual] = useState(1);
  const paginacaoContainerRef = useRef<HTMLDivElement>(null);
  const [perdaAberta, setPerdaAberta] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregarFila = useCallback(async (silencioso = false) => {
    if (silencioso) setAtualizando(true);
    else setCarregando(true);
    setErro(null);

    try {
      const [produtos, fila, saldo, niveis] = await Promise.all([
        listarProdutos(),
        listarFilaEmbalagem(),
        carregarEstoqueSemBloquearFila(
          listarSaldoEstoque,
          'O saldo do estoque',
        ),
        carregarEstoqueSemBloquearFila(
          listarNiveisEstoque,
          'As metas do estoque',
        ),
      ]);
      setCatalogoProdutos(produtos);
      setItems(enriquecerFila(fila, produtos));
      setSaldoEstoque(saldo);
      setNiveisEstoque(niveis);
    } catch (error) {
      setErro(
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar a fila de embalagens.',
      );
    } finally {
      setCarregando(false);
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    void carregarFila();
  }, [carregarFila]);

  const itemsVisiveis = useMemo(
    () => aplicarFiltros(items, filtros),
    [items, filtros],
  );

  const totalPaginas = Math.max(
    1,
    Math.ceil(itemsVisiveis.length / ITENS_POR_PAGINA),
  );
  const paginaRenderizada = Math.min(paginaAtual, totalPaginas);
  const itemsDaPagina = useMemo(() => {
    const inicio = (paginaRenderizada - 1) * ITENS_POR_PAGINA;
    return itemsVisiveis.slice(inicio, inicio + ITENS_POR_PAGINA);
  }, [itemsVisiveis, paginaRenderizada]);

  useEffect(() => {
    setPaginaAtual(1);
  }, [filtros]);

  useEffect(() => {
    if (paginaAtual > totalPaginas) setPaginaAtual(totalPaginas);
  }, [paginaAtual, totalPaginas]);

  useEffect(() => {
    const container = paginacaoContainerRef.current;
    if (!container) return undefined;

    renderizarPaginacao(
      container,
      totalPaginas,
      paginaRenderizada,
      setPaginaAtual,
    );

    return () => {
      container.innerHTML = '';
      container.style.display = 'none';
    };
  }, [paginaRenderizada, totalPaginas]);

  const opcoesFiltro = useMemo(() => montarOpcoesFiltro(items), [items]);

  const atualizarFiltros = (parcial: Partial<EmbalagemFiltros>) => {
    setFiltros((anterior) => ({ ...anterior, ...parcial }));
  };

  const limparFiltros = () => setFiltros(filtrosIniciais);

  return (
    <>
      <UIHeaderPagina titulo="Embalagem de produtos">
        <button
          className="gs-btn gs-btn-secundario"
          type="button"
          onClick={() => setPerdaAberta(true)}
        >
          <i className="fas fa-triangle-exclamation" aria-hidden="true" />
          Registrar perda
        </button>
      </UIHeaderPagina>

      <div className="gs-conteudo-pagina ep-fila-pagina">
        <section className="gs-card ep-fila-resumo" aria-labelledby="ep-fila-titulo">
          <div>
            <span className="ep-fila-kicker">Operação</span>
            <h2 id="ep-fila-titulo">Produtos aguardando embalagem</h2>
            <p>
              Clique em um card para abrir a operação de embalagem.
            </p>
          </div>
          <div className="ep-fila-indicadores" aria-label="Resumo da fila">
            <span>
              <strong>{items.length}</strong>
              <small>itens na fila</small>
            </span>
            <span>
              <strong>
                {items.reduce((total, item) => total + item.quantidadeDisponivel, 0)}
              </strong>
              <small>unidades disponíveis</small>
            </span>
          </div>
        </section>

        <EmbalagemPainelFiltros
          filtros={filtros}
          opcoes={opcoesFiltro}
          totalItens={items.length}
          totalVisiveis={itemsVisiveis.length}
          onChange={atualizarFiltros}
          onLimpar={limparFiltros}
        />

        <div className="ep-fila-acoes">
          <span className="ep-fila-acoes-contexto">
            <i className="fas fa-layer-group" aria-hidden="true" />
            Fila atualizada por produto e variação
          </span>
          <button
            className="gs-btn-refresh"
            type="button"
            onClick={() => void carregarFila(true)}
            disabled={atualizando}
            aria-label="Atualizar fila de embalagens"
          >
            <i className={`fas fa-sync-alt ${atualizando ? 'girando' : ''}`} aria-hidden="true" />
            <span>{atualizando ? 'Atualizando...' : 'Atualizar'}</span>
          </button>
        </div>

        {carregando ? (
          <div className="ep-fila-estado">
            <UICarregando texto="Carregando fila de embalagens..." />
          </div>
        ) : erro ? (
          <div className="ep-fila-estado ep-fila-erro" role="alert">
            <i className="fas fa-circle-exclamation" aria-hidden="true" />
            <strong>Não foi possível carregar a fila.</strong>
            <p>{erro}</p>
            <button
              className="gs-btn gs-btn-primario"
              type="button"
              onClick={() => void carregarFila()}
            >
              Tentar novamente
            </button>
          </div>
        ) : itemsVisiveis.length === 0 ? (
          <div className="ep-fila-estado">
            <UIFeedbackNotFound
              icon="fa-box-open"
              titulo={items.length ? 'Nenhum resultado encontrado' : 'Fila vazia'}
              mensagem={
                items.length
                  ? 'Ajuste ou limpe os filtros para encontrar outros produtos.'
                  : 'Quando houver produtos prontos para embalar, eles aparecerão aqui.'
              }
              variante="padrao"
            >
              {items.length ? (
                <button
                  className="gs-btn gs-btn-secundario"
                  type="button"
                  onClick={limparFiltros}
                >
                  Limpar filtros
                </button>
              ) : null}
            </UIFeedbackNotFound>
          </div>
        ) : (
          <>
            <section className="ep-fila-grid" aria-label="Produtos na fila">
              {itemsDaPagina.map((item) => (
                <EmbalagemCard
                  key={item.id}
                  item={item}
                  onClick={setSelecionado}
                />
              ))}
            </section>
            <div
              ref={paginacaoContainerRef}
              className="gs-paginacao-container"
              aria-label="Paginação da fila de embalagens"
            />
          </>
        )}
      </div>

      {selecionado ? (
        <EmbalagemModalOpcoes
          item={selecionado}
          produtos={catalogoProdutos}
          saldoEstoque={saldoEstoque}
          niveisEstoque={niveisEstoque}
          onClose={() => setSelecionado(null)}
          onEmbalagemConcluida={async () => {
            setSelecionado(null);
            await carregarFila(true);
          }}
        />
      ) : null}

      {perdaAberta ? (
        <EmbalagemModalPerda onClose={() => setPerdaAberta(false)} />
      ) : null}
    </>
  );
}
