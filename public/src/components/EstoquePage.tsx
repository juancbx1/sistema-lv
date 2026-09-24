import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
// @ts-expect-error PaginaÃ§Ã£o legada compartilhada pelo sistema.
import { renderizarPaginacao } from '/js/utils/Paginacao.js';
import UIHeaderPagina from './UIHeaderPagina';
import UIBloqueio from './UIBloqueio';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import SeparacaoPage from './SeparacaoPage';
import { mostrarPopupSemPermissao } from '../utils/bloqueio';
import {
  listarNiveisEstoque,
  listarProdutosEstoque,
  listarSaldoEstoque,
} from '../utils/estoque-api';
import type {
  EstoqueStatus,
  FiltroEstoqueAvancado,
  ItemEstoque,
  NivelEstoque,
  ProdutoCadastro,
} from '../utils/estoque-types';
import type { EstoqueSaldo } from '../utils/estoque-types';

interface EstoquePageProps {
  permissoes: string[];
}

type FiltroAlerta = 'urgente' | 'baixo' | 'ok' | 'criticos' | null;

const ITENS_POR_PAGINA = 8;

function numero(value: unknown): number {
  const resultado = Number(value);
  return Number.isFinite(resultado) ? resultado : 0;
}

function textoNormalizado(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

function encontrarProduto(produtos: ProdutoCadastro[], produtoId: number | string): ProdutoCadastro | null {
  return produtos.find((produto) => String(produto.id) === String(produtoId)) || null;
}

function imagemDoItem(produto: ProdutoCadastro | null, variante: string): string {
  if (!produto) return '/img/placeholder-image.png';
  return produto.grade?.find((grade) => grade.variacao === variante)?.imagem
    || produto.imagem
    || produto.grade?.[0]?.imagem
    || '/img/placeholder-image.png';
}

function nivelDoItem(saldo: EstoqueSaldo, niveis: NivelEstoque[]): NivelEstoque | null {
  return niveis.find((nivel) => nivel.ativo !== false && nivel.produto_ref_id === saldo.produto_ref_id) || null;
}

function statusDoSaldo(saldo: number, nivel: NivelEstoque | null): EstoqueStatus {
  if (!nivel) return 'sem-meta';
  const urgente = nivel.nivel_reposicao_urgente == null ? null : numero(nivel.nivel_reposicao_urgente);
  const baixo = nivel.nivel_estoque_baixo == null ? null : numero(nivel.nivel_estoque_baixo);
  if (urgente !== null && saldo <= urgente) return 'urgente';
  if (baixo !== null && saldo <= baixo) return 'baixo';
  return 'ok';
}

function nomeStatus(status: EstoqueStatus): string {
  if (status === 'urgente') return 'Reposição urgente';
  if (status === 'baixo') return 'Estoque baixo';
  if (status === 'sem-meta') return 'Sem meta configurada';
  return 'Estoque em dia';
}

function normalizarOpcoesVariacao(valor: unknown): string[] {
  if (Array.isArray(valor)) {
    return valor.map(String).map((opcao) => opcao.trim()).filter(Boolean);
  }

  if (typeof valor === 'string') {
    return valor.split(',').map((opcao) => opcao.trim()).filter(Boolean);
  }

  return [];
}

function montarFiltros(produtos: ProdutoCadastro[], saldos: EstoqueSaldo[]): FiltroEstoqueAvancado[] {
  const resultado: FiltroEstoqueAvancado[] = [];

  produtos.forEach((produto) => {
    const variacoes = Array.isArray(produto.variacoes) ? produto.variacoes : [];

    variacoes.forEach((variacao, indiceVariacao) => {
      const opcoes = new Set<string>();
      saldos
        .filter((saldo) => String(saldo.produto_id) === String(produto.id))
        .forEach((saldo) => {
          const partes = String(saldo.variante_nome || '').split(' | ').map((parte) => parte.trim());
          if (partes[indiceVariacao]) opcoes.add(partes[indiceVariacao]);
        });

      const opcoesDefinidas = [
        ...normalizarOpcoesVariacao(variacao.valores),
        ...normalizarOpcoesVariacao(variacao.opcoes),
      ];
      opcoesDefinidas.forEach((opcao) => opcoes.add(opcao));
      if (opcoes.size > 0) {
        resultado.push({
          id: `${produto.id}:${indiceVariacao}`,
          produtoId: String(produto.id),
          indiceVariacao,
          rotulo: `${produto.nome} · ${variacao.chave}`,
          opcoes: [...opcoes].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        });
      }
    });
  });

  return resultado;
}

function acionarLegado(id: string): void {
  document.getElementById(id)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function abrirHistoricoGeral(): void {
  acionarLegado('btnAbrirHistoricoGeralEstoque');
}

function abrirMovimento(item: ItemEstoque): void {
  const handler = window.abrirMovimentoEstoque;
  if (handler) handler(item);
}

function tratarTeclaCard(event: KeyboardEvent<HTMLElement>, item: ItemEstoque, habilitado: boolean): void {
  if (!habilitado || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  abrirMovimento(item);
}

function StatusBadge({ status }: { status: EstoqueStatus }) {
  return <span className={`estoque-status-badge estoque-status-badge--${status}`}>{nomeStatus(status)}</span>;
}

function nomeFiltroAlerta(filtro: Exclude<FiltroAlerta, null>): string {
  if (filtro === 'urgente') return 'Reposi\u00e7\u00e3o urgente';
  if (filtro === 'baixo') return 'Estoque baixo';
  if (filtro === 'ok') return 'Estoque em dia';
  return 'Itens cr\u00edticos';
}

export default function EstoquePage({ permissoes }: EstoquePageProps) {
  const [produtos, setProdutos] = useState<ProdutoCadastro[]>([]);
  const [saldos, setSaldos] = useState<EstoqueSaldo[]>([]);
  const [niveis, setNiveis] = useState<NivelEstoque[]>([]);
  const [busca, setBusca] = useState('');
  const [filtroAlerta, setFiltroAlerta] = useState<FiltroAlerta>(null);
  const [filtrosAvancados, setFiltrosAvancados] = useState<Record<string, string>>({});
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [pagina, setPagina] = useState(1);
  const paginacaoContainerRef = useRef<HTMLDivElement>(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [modoLegado, setModoLegado] = useState(Boolean(window.location.hash));
  const [modoSeparacao, setModoSeparacao] = useState(false);

  const pode = useCallback((permissao: string) => permissoes.includes(permissao), [permissoes]);

  const carregarDados = useCallback(async (silencioso = false) => {
    if (silencioso) setAtualizando(true);
    else setCarregando(true);
    setErro(null);

    try {
      const [saldoRecebido, produtosRecebidos] = await Promise.all([
        listarSaldoEstoque(),
        listarProdutosEstoque(),
      ]);
      let niveisRecebidos: NivelEstoque[] = [];
      if (pode('gerenciar-niveis-alerta-estoque')) {
        try {
          niveisRecebidos = await listarNiveisEstoque();
        } catch {
          // Níveis são opcionais para usuários sem a permissão de gerenciamento.
        }
      }
      setSaldos(Array.isArray(saldoRecebido) ? saldoRecebido : []);
      setProdutos(Array.isArray(produtosRecebidos) ? produtosRecebidos : []);
      setNiveis(Array.isArray(niveisRecebidos) ? niveisRecebidos : []);
      if (silencioso) {
        setBusca('');
        setFiltroAlerta(null);
        setFiltrosAvancados({});
        setPagina(1);
      }
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível carregar o estoque.');
    } finally {
      setCarregando(false);
      setAtualizando(false);
    }
  }, [pode]);

  useEffect(() => {
    void carregarDados();
  }, [carregarDados]);

  useEffect(() => {
    const atualizarModo = () => setModoLegado(Boolean(window.location.hash));
    const voltarParaPrincipal = () => setModoLegado(false);
    window.addEventListener('hashchange', atualizarModo);
    window.addEventListener('estoque:principal', voltarParaPrincipal);
    return () => {
      window.removeEventListener('hashchange', atualizarModo);
      window.removeEventListener('estoque:principal', voltarParaPrincipal);
    };
  }, []);

  const filtros = useMemo(() => montarFiltros(produtos, saldos), [produtos, saldos]);

  const itens = useMemo<ItemEstoque[]>(() => saldos.map((saldo) => {
    const produto = encontrarProduto(produtos, saldo.produto_id);
    const nivel = nivelDoItem(saldo, niveis);
    const saldoAtual = numero(saldo.saldo_atual);
    return {
      ...saldo,
      produto,
      imagem: imagemDoItem(produto, saldo.variante_nome || '-'),
      saldo: saldoAtual,
      nivel,
      status: statusDoSaldo(saldoAtual, nivel),
    };
  }), [niveis, produtos, saldos]);

  const contadores = useMemo(() => ({
    total: itens.length,
    ok: itens.filter((item) => item.status === 'ok').length,
    urgente: itens.filter((item) => item.status === 'urgente').length,
    baixo: itens.filter((item) => item.status === 'baixo').length,
  }), [itens]);

  const itensCriticos = useMemo(() => [...itens]
    .filter((item) => item.status === 'urgente' || item.status === 'baixo')
    .sort((a, b) => {
      const prioridadeA = a.status === 'urgente' ? 0 : 1;
      const prioridadeB = b.status === 'urgente' ? 0 : 1;
      return prioridadeA - prioridadeB
        || a.saldo - b.saldo
        || a.produto_nome.localeCompare(b.produto_nome, 'pt-BR');
    })
    .slice(0, 3), [itens]);

  const itensFiltrados = useMemo(() => {
    const buscaNormalizada = textoNormalizado(busca);
    return itens.filter((item) => {
      const itemCritico = item.status === 'urgente' || item.status === 'baixo';
      if (filtroAlerta === 'criticos' && !itemCritico) return false;
      if (filtroAlerta && filtroAlerta !== 'criticos' && item.status !== filtroAlerta) return false;
      const alvo = textoNormalizado(`${item.produto_nome} ${item.variante_nome || ''} ${item.produto_ref_id}`);
      if (buscaNormalizada && !alvo.includes(buscaNormalizada)) return false;

      return Object.entries(filtrosAvancados).every(([filtroId, valor]) => {
        if (!valor) return true;
        const filtro = filtros.find((entrada) => entrada.id === filtroId);
        if (!filtro || String(item.produto_id) !== filtro.produtoId) return false;
        const partes = String(item.variante_nome || '').split(' | ').map((parte) => parte.trim());
        return partes[filtro.indiceVariacao] === valor;
      });
    });
  }, [busca, filtroAlerta, filtros, filtrosAvancados, itens]);

  const totalPaginas = Math.max(1, Math.ceil(itensFiltrados.length / ITENS_POR_PAGINA));
  const paginaRenderizada = Math.min(pagina, totalPaginas);
  const itensVisiveis = itensFiltrados.slice((paginaRenderizada - 1) * ITENS_POR_PAGINA, paginaRenderizada * ITENS_POR_PAGINA);
  const temFiltros = Boolean(busca || filtroAlerta || Object.values(filtrosAvancados).some(Boolean));

  useEffect(() => {
    setPagina((atual) => Math.min(atual, totalPaginas));
  }, [totalPaginas]);

  useEffect(() => {
    const container = paginacaoContainerRef.current;
    if (!container) return undefined;

    renderizarPaginacao(container, totalPaginas, paginaRenderizada, setPagina);

    return () => {
      container.innerHTML = '';
      container.style.display = 'none';
    };
  }, [paginaRenderizada, totalPaginas]);

  const atualizarBusca = (valor: string) => {
    setBusca(valor);
    setFiltroAlerta(null);
    setPagina(1);
  };

  const selecionarAlerta = (alerta: FiltroAlerta) => {
    setFiltroAlerta((atual) => atual === alerta ? null : alerta);
    setBusca('');
    setPagina(1);
  };

  const executarAcao = (id: string, permissao: string, mensagem: string) => {
    if (!pode(permissao)) {
      mostrarPopupSemPermissao(mensagem);
      return;
    }
    if (id === 'btnIniciarSeparacao') {
      setModoSeparacao(true);
      return;
    }
    setModoLegado(true);
    acionarLegado(id);
  };

  if (modoSeparacao) {
    return (
      <SeparacaoPage
        itens={itens}
        podeGerenciar={pode('gerenciar-estoque')}
        onVoltar={() => setModoSeparacao(false)}
        onConcluida={async () => {
          await carregarDados(true);
          setModoSeparacao(false);
        }}
      />
    );
  }

  if (modoLegado) return null;

  return (
    <>
      <UIHeaderPagina titulo="Estoque">
        <button className="gs-btn gs-btn-secundario" type="button" onClick={abrirHistoricoGeral}>
          <i className="fas fa-clipboard-list" aria-hidden="true"></i>
          <span>Histórico geral</span>
        </button>
      </UIHeaderPagina>

      <div className="gs-conteudo-pagina estoque-page-content">
        {false && (
          <section className="estoque-page-intro" aria-hidden="true">
            <div>
            <span className="estoque-page-kicker">Visão operacional</span>
            <h2 id="estoque-page-intro-title">Acompanhe o que está disponível agora</h2>
            <p>Consulte saldos, identifique reposições e acesse as rotinas do estoque em um só lugar.</p>
          </div>
          <div className="estoque-page-intro-meta">
            <span className="estoque-page-live-dot" aria-hidden="true"></span>
            <span>Dados da empresa selecionada</span>
          </div>
        </section>
        )}

        <section className="gs-card estoque-page-acoes" aria-labelledby="estoque-acoes-title">
          <div className="estoque-section-heading">
            <div>
              <span className="estoque-section-eyebrow">Atalhos</span>
              <h2 id="estoque-acoes-title">O que você precisa fazer?</h2>
            </div>
            <span className="estoque-section-hint">Acesse uma rotina sem perder o contexto do estoque.</span>
          </div>
          <div className="estoque-action-grid">
            <UIBloqueio permissao="acesso-estoque" mensagem="Seu vínculo atual não possui acesso às rotinas do estoque.">
              <button type="button" className="estoque-action-card" onClick={() => executarAcao('btnIniciarSeparacao', 'acesso-estoque', 'Seu vínculo atual não possui acesso à separação de pedidos.')}>
                <span className="estoque-action-icon estoque-action-icon--blue"><i className="fas fa-box-open" aria-hidden="true"></i></span>
                <span><strong>Separação</strong><small>Prepare pedidos para saída</small></span>
                <i className="fas fa-arrow-up-right-from-square estoque-action-arrow" aria-hidden="true"></i>
              </button>
            </UIBloqueio>
            <UIBloqueio permissao="fazer-inventario" mensagem="Seu vínculo atual não possui permissão para realizar inventários.">
              <button type="button" className="estoque-action-card" onClick={() => { setModoLegado(true); window.location.hash = '#inventario'; }}>
                <span className="estoque-action-icon estoque-action-icon--violet"><i className="fas fa-clipboard-check" aria-hidden="true"></i></span>
                <span><strong>Inventário</strong><small>Confira e ajuste os saldos</small></span>
                <i className="fas fa-arrow-up-right-from-square estoque-action-arrow" aria-hidden="true"></i>
              </button>
            </UIBloqueio>
            <UIBloqueio permissao="acesso-estoque" mensagem="Seu vínculo atual não possui acesso à fila de produção.">
              <button type="button" className="estoque-action-card" onClick={() => executarAcao('btnGerenciarFila', 'acesso-estoque', 'Seu vínculo atual não possui acesso à fila de produção.')}>
                <span className="estoque-action-icon estoque-action-icon--orange"><i className="fas fa-list-ol" aria-hidden="true"></i></span>
                <span><strong>Fila de produção</strong><small>Priorize o que precisa ser produzido</small></span>
                <i className="fas fa-arrow-up-right-from-square estoque-action-arrow" aria-hidden="true"></i>
              </button>
            </UIBloqueio>
            <UIBloqueio permissao="gerenciar-niveis-alerta-estoque" mensagem="Seu vínculo atual não possui permissão para configurar níveis de estoque.">
              <button type="button" className="estoque-action-card" onClick={() => executarAcao('btnConfigurarNiveisEstoque', 'gerenciar-niveis-alerta-estoque', 'Seu vínculo atual não possui permissão para configurar níveis de estoque.')}>
                <span className="estoque-action-icon estoque-action-icon--green"><i className="fas fa-sliders" aria-hidden="true"></i></span>
                <span><strong>Níveis de alerta</strong><small>Defina metas e pontos de atenção</small></span>
                <i className="fas fa-arrow-up-right-from-square estoque-action-arrow" aria-hidden="true"></i>
              </button>
            </UIBloqueio>
            <UIBloqueio permissao="editar-itens-arquivados" mensagem="Seu vínculo atual não possui permissão para visualizar itens arquivados.">
              <button type="button" className="estoque-action-card" onClick={() => executarAcao('btnVerArquivados', 'editar-itens-arquivados', 'Seu vínculo atual não possui permissão para visualizar itens arquivados.')}>
                <span className="estoque-action-icon estoque-action-icon--slate"><i className="fas fa-box-archive" aria-hidden="true"></i></span>
                <span><strong>Itens arquivados</strong><small>Consulte e recupere itens antigos</small></span>
                <i className="fas fa-arrow-up-right-from-square estoque-action-arrow" aria-hidden="true"></i>
              </button>
            </UIBloqueio>
          </div>
        </section>

        <section className="gs-card estoque-health-section" aria-labelledby="estoque-health-title">
          <div className="estoque-health-header">
            <div>
              <span className="estoque-section-eyebrow">Vis&atilde;o operacional</span>
              <h2 id="estoque-health-title">Sa&uacute;de do estoque</h2>
              <p>Uma leitura r&aacute;pida dos saldos e das prioridades de reposi&ccedil;&atilde;o.</p>
            </div>
            <span className="estoque-health-live"><span aria-hidden="true"></span>Empresa selecionada</span>
          </div>

          <div className="estoque-health-metrics" aria-label="Resumo do estoque">
            <button type="button" className={`estoque-health-metric${filtroAlerta === null ? ' is-active' : ''}`} onClick={() => selecionarAlerta(null)} aria-pressed={filtroAlerta === null}>
              <span>Total de itens</span>
              <strong>{carregando ? '—' : contadores.total}</strong>
            </button>
            <button type="button" className={`estoque-health-metric estoque-health-metric--ok${filtroAlerta === 'ok' ? ' is-active' : ''}`} onClick={() => selecionarAlerta('ok')} aria-pressed={filtroAlerta === 'ok'}>
              <span>Em dia</span>
              <strong>{carregando ? '—' : contadores.ok}</strong>
            </button>
            <button type="button" className={`estoque-health-metric estoque-health-metric--baixo${filtroAlerta === 'baixo' ? ' is-active' : ''}`} onClick={() => selecionarAlerta('baixo')} aria-pressed={filtroAlerta === 'baixo'}>
              <span>Estoque baixo</span>
              <strong>{carregando ? '—' : contadores.baixo}</strong>
            </button>
            <button type="button" className={`estoque-health-metric estoque-health-metric--urgente${filtroAlerta === 'urgente' ? ' is-active' : ''}`} onClick={() => selecionarAlerta('urgente')} aria-pressed={filtroAlerta === 'urgente'}>
              <span>Reposi&ccedil;&atilde;o urgente</span>
              <strong>{carregando ? '—' : contadores.urgente}</strong>
            </button>
          </div>

          <div className="estoque-health-attention">
            <div className="estoque-health-attention-heading">
              <h3>Aten&ccedil;&atilde;o necess&aacute;ria</h3>
              <span>{carregando ? 'Carregando...' : `${contadores.baixo + contadores.urgente} ${contadores.baixo + contadores.urgente === 1 ? 'item' : 'itens'} pendentes`}</span>
            </div>
            {carregando ? <div className="estoque-health-empty">Carregando prioridades de reposi&ccedil;&atilde;o...</div> : itensCriticos.length === 0 ? (
              <div className="estoque-health-empty estoque-health-empty--success"><i className="fas fa-circle-check" aria-hidden="true"></i> N&atilde;o h&aacute; itens pendentes de reposi&ccedil;&atilde;o.</div>
            ) : (
              <>
                <div className="estoque-health-list">
                  {itensCriticos.map((item) => {
                    const habilitado = pode('gerenciar-estoque');
                    const ideal = item.nivel?.nivel_estoque_ideal;
                    return (
                      <button
                        type="button"
                        className={`estoque-health-row estoque-health-row--${item.status}`}
                        key={`${item.produto_id}-${item.produto_ref_id}-${item.variante_nome || '-'}`}
                        onClick={() => { if (habilitado) abrirMovimento(item); else mostrarPopupSemPermissao('Seu v\u00ednculo atual n\u00e3o possui permiss\u00e3o para movimentar o estoque.'); }}
                        aria-label={`${item.produto_nome}, ${item.variante_nome || 'Padrao'}, ${nomeStatus(item.status)}`}
                      >
                        <span className="estoque-health-product"><strong>{item.produto_nome}</strong><small>{item.variante_nome || 'Padr\u00e3o'}{item.produto_ref_id ? ` - SKU ${item.produto_ref_id}` : ''}</small></span>
                        <span className="estoque-health-value"><small>Saldo atual</small><strong>{item.saldo} un.</strong></span>
                        <span className="estoque-health-value"><small>Meta ideal</small><strong>{ideal ?? '—'}</strong></span>
                        <span className="estoque-health-status">{item.status === 'urgente' ? 'Urgente' : 'Baixo'}</span>
                      </button>
                    );
                  })}
                </div>
                {contadores.baixo + contadores.urgente > itensCriticos.length ? <button type="button" className="estoque-health-more" onClick={() => selecionarAlerta('criticos')}>Ver todos os itens cr&iacute;ticos <i className="fas fa-arrow-right" aria-hidden="true"></i></button> : null}
             </>
           )}
          </div>
        </section>

        {false && (
        <section className="estoque-alert-grid" aria-label="Alertas do estoque">
          <button type="button" className={`estoque-alert-card estoque-alert-card--urgent${filtroAlerta === 'urgente' ? ' is-active' : ''}`} onClick={() => selecionarAlerta('urgente')}>
            <span className="estoque-alert-icon"><i className="fas fa-triangle-exclamation" aria-hidden="true"></i></span>
            <span className="estoque-alert-copy"><small>Requer ação imediata</small><strong>Reposição urgente</strong><em>Itens em nível crítico</em></span>
            <span className="estoque-alert-number">{carregando ? '—' : contadores.urgente}</span>
          </button>
          <button type="button" className={`estoque-alert-card estoque-alert-card--warning${filtroAlerta === 'baixo' ? ' is-active' : ''}`} onClick={() => selecionarAlerta('baixo')}>
            <span className="estoque-alert-icon"><i className="fas fa-boxes-stacked" aria-hidden="true"></i></span>
            <span className="estoque-alert-copy"><small>Planeje a reposição</small><strong>Estoque baixo</strong><em>Itens abaixo da meta</em></span>
            <span className="estoque-alert-number">{carregando ? '—' : contadores.baixo}</span>
          </button>
        </section>
        )}

        <section className="gs-card estoque-list-section" aria-labelledby="estoque-itens-title">
          <div className="estoque-section-heading estoque-section-heading--list">
            <div>
              <span className="estoque-section-eyebrow">Catálogo disponível</span>
              <h2 id="estoque-itens-title">Itens em estoque</h2>
            </div>
            <button className="gs-btn gs-btn-secundario estoque-refresh-button" type="button" onClick={() => void carregarDados(true)} disabled={atualizando}>
              <i className={`fas fa-rotate${atualizando ? ' fa-spin' : ''}`} aria-hidden="true"></i>
              <span>{atualizando ? 'Atualizando...' : 'Atualizar'}</span>
            </button>
          </div>

          <div className="estoque-filter-bar">
            <label className="estoque-search-field">
              <i className="fas fa-search" aria-hidden="true"></i>
              <span className="sr-only">Buscar no estoque</span>
              <input value={busca} onChange={(event) => atualizarBusca(event.target.value)} placeholder="Buscar produto, variação ou SKU" type="search" />
              {busca ? <button type="button" aria-label="Limpar busca" onClick={() => atualizarBusca('')}><i className="fas fa-xmark" aria-hidden="true"></i></button> : null}
            </label>
            <button type="button" className={`estoque-filter-toggle${filtrosAbertos ? ' is-active' : ''}`} onClick={() => setFiltrosAbertos((aberto) => !aberto)} aria-expanded={filtrosAbertos}>
              <i className="fas fa-filter" aria-hidden="true"></i>
              <span>{filtrosAbertos ? 'Fechar filtros' : 'Filtros avançados'}</span>
              {Object.values(filtrosAvancados).filter(Boolean).length > 0 ? <b>{Object.values(filtrosAvancados).filter(Boolean).length}</b> : null}
            </button>
          </div>

          {filtrosAbertos ? (
            <div className="estoque-advanced-filters">
              {filtros.length === 0 ? <span className="estoque-filter-empty">Não há filtros de variação disponíveis.</span> : filtros.map((filtro) => (
                <label key={filtro.id}>
                  <span>{filtro.rotulo}</span>
                  <select value={filtrosAvancados[filtro.id] || ''} onChange={(event) => { setFiltrosAvancados((atuais) => ({ ...atuais, [filtro.id]: event.target.value })); setPagina(1); }}>
                    <option value="">Todas as opções</option>
                    {filtro.opcoes.map((opcao) => <option value={opcao} key={opcao}>{opcao}</option>)}
                  </select>
                </label>
              ))}
              {temFiltros ? <button type="button" className="estoque-clear-filters" onClick={() => { setBusca(''); setFiltroAlerta(null); setFiltrosAvancados({}); setPagina(1); }}>Limpar filtros</button> : null}
            </div>
          ) : null}

          {filtroAlerta ? <div className={`estoque-current-filter estoque-current-filter--${filtroAlerta}`}><span><i className="fas fa-filter" aria-hidden="true"></i> {nomeFiltroAlerta(filtroAlerta)}</span><button type="button" onClick={() => selecionarAlerta(filtroAlerta)}><i className="fas fa-xmark" aria-hidden="true"></i> Remover filtro</button></div> : null}

          {filtroAlerta ? <div className={`estoque-active-filter estoque-active-filter--${filtroAlerta}`}><span><i className="fas fa-filter" aria-hidden="true"></i> {filtroAlerta === 'urgente' ? 'Reposição urgente' : 'Estoque baixo'}</span><button type="button" onClick={() => selecionarAlerta(filtroAlerta)}><i className="fas fa-xmark" aria-hidden="true"></i> Remover filtro</button></div> : null}

          {erro ? <div className="estoque-inline-error" role="alert"><i className="fas fa-circle-exclamation" aria-hidden="true"></i><span>{erro}</span><button type="button" onClick={() => void carregarDados()}>Tentar novamente</button></div> : null}

          {carregando ? <UICarregando variante="bloco" texto="Carregando saldos do estoque..." /> : itensVisiveis.length === 0 ? (
            <UIFeedbackNotFound icon="fa-box-open" titulo={temFiltros ? 'Nenhum item encontrado' : 'Nenhum item em estoque'} mensagem={temFiltros ? 'Ajuste os filtros para encontrar outros itens.' : 'Os itens disponíveis aparecerão aqui assim que houver saldo.'}>
              {temFiltros ? <button type="button" className="gs-btn gs-btn-secundario" onClick={() => { setBusca(''); setFiltroAlerta(null); setFiltrosAvancados({}); }}>Limpar filtros</button> : null}
            </UIFeedbackNotFound>
          ) : (
            <>
              <div className="estoque-item-grid">
                {itensVisiveis.map((item) => {
                  const habilitado = pode('gerenciar-estoque');
                  const ideal = item.nivel?.nivel_estoque_ideal;
                  return (
                    <article
                      className={`estoque-item-card estoque-item-card--${item.status}${habilitado ? ' is-interactive' : ''}`}
                      key={`${item.produto_id}-${item.produto_ref_id}-${item.variante_nome || '-'}`}
                      onClick={() => { if (habilitado) abrirMovimento(item); else mostrarPopupSemPermissao('Seu vínculo atual não possui permissão para movimentar o estoque.'); }}
                      onKeyDown={(event) => tratarTeclaCard(event, item, habilitado)}
                      role="button"
                      tabIndex={0}
                      aria-disabled={!habilitado}
                    >
                      <div className="card-borda-charme" aria-hidden="true"></div>
                      <div className="estoque-item-visual"><img src={item.imagem} alt="" onError={(event) => { event.currentTarget.src = '/img/placeholder-image.png'; }} /><span className="estoque-item-status-dot" aria-hidden="true"></span></div>
                      <div className="estoque-item-main"><div className="estoque-item-topline"><StatusBadge status={item.status} />{!habilitado ? <span className="estoque-item-lock"><i className="fas fa-lock" aria-hidden="true"></i> Somente consulta</span> : null}</div><h3>{item.produto_nome}</h3><p>{item.variante_nome || 'Padrão'}</p><small>SKU {item.produto_ref_id || 'não informado'}</small></div>
                      <div className="estoque-item-metrics"><div><span>Saldo atual</span><strong>{item.saldo}</strong></div><div><span>Meta ideal</span><strong>{ideal ?? '—'}</strong></div></div>
                      {habilitado ? <span className="estoque-item-open"><i className="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></span> : null}
                    </article>
                  );
                })}
              </div>
              <div
                ref={paginacaoContainerRef}
                className="gs-paginacao-container"
                aria-label="Paginacao do estoque"
              />
              {totalPaginas > 1 ? <nav className="estoque-pagination" aria-label="Paginação do estoque"><button type="button" onClick={() => setPagina((atual) => Math.max(1, atual - 1))} disabled={pagina === 1}><i className="fas fa-chevron-left" aria-hidden="true"></i> Anterior</button><span>Página <strong>{pagina}</strong> de {totalPaginas}</span><button type="button" onClick={() => setPagina((atual) => Math.min(totalPaginas, atual + 1))} disabled={pagina === totalPaginas}>Próxima <i className="fas fa-chevron-right" aria-hidden="true"></i></button></nav> : null}
            </>
          )}
        </section>
      </div>
    </>
  );
}
