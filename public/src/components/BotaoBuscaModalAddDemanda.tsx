import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
// @ts-expect-error utilitarios JS legados sem declaracao TypeScript
import { mostrarMensagem } from '/js/utils/popups.js';
// @ts-expect-error utilitario JS legado sem declaracao TypeScript
import { renderizarPaginacao } from '/js/utils/Paginacao.js';
import UICarregando from './UICarregando';

const RECENTES_KEY = 'demanda_recentes';

interface ProdutoBusca {
  sku: string;
  nome: string;
  variante?: string | null;
  imagem?: string | null;
}

interface PaginacaoInfo {
  totalPages: number;
  currentPage: number;
}

interface DemandaAtiva {
  id: number;
  status?: string | null;
  prioridade?: number | string | null;
  quantidade_solicitada?: number | string | null;
  data_solicitacao?: string | null;
  solicitado_por?: string | null;
  estagio_atual?: string | null;
}

interface DuplicataInfo {
  temDuplicata: boolean;
  demandasAtivas: DemandaAtiva[];
}

interface CarrinhoItem {
  item: ProdutoBusca;
  quantidade: number;
  prioridade: boolean;
  temDuplicata: boolean | null;
  demandasAtivas?: DemandaAtiva[];
}

interface CriarDemandaPayload {
  produto_sku: string;
  quantidade_solicitada: number;
  prioridade: number;
}

interface ModalAdicionarDemandaProps {
  onClose: () => void;
  onDemandaCriada: () => void | Promise<void>;
  itemPreSelecionado?: ProdutoBusca | null;
}

interface ListaResultadosBuscaProps {
  resultados: ProdutoBusca[];
  onSelecionar: (item: ProdutoBusca) => void | Promise<void>;
  paginacaoInfo: PaginacaoInfo | null;
  onPageChange: (page: number) => void;
  buscando: boolean;
  carrinhoSkus?: Set<string> | null;
}

interface CarrinhoSectionProps {
  carrinho: CarrinhoItem[];
  onAtualizarQtd: (sku: string, quantidade: string | number) => void;
  onRemover: (sku: string) => void;
  onLimpar: () => void;
  onTogglePrioridadeItem: (sku: string, valor: boolean) => void;
  onCriar: () => void | Promise<void>;
  criando: boolean;
}

interface TelaDuplicataProps {
  item: ProdutoBusca | null;
  demandasAtivas: DemandaAtiva[];
  onCriarMesmoAssim: () => void;
  onVoltar: () => void;
  onDemandaAtualizada: () => void | Promise<void>;
}

interface FormularioConfirmacaoProps {
  item: ProdutoBusca;
  onConfirmar: (dados: CriarDemandaPayload) => void | Promise<void>;
  onVoltar: () => void;
  carregando: boolean;
}

interface CampoBuscaProps {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onLimpar: () => void;
  placeholder?: string;
}

function salvarRecente(item: ProdutoBusca): void {
  try {
    const recentes = lerRecentes();
    const filtrado = recentes.filter((recente) => recente.sku !== item.sku);
    localStorage.setItem(RECENTES_KEY, JSON.stringify([item, ...filtrado].slice(0, 5)));
  } catch {
    // localStorage indisponivel nao impede a criacao da demanda.
  }
}

function lerRecentes(): ProdutoBusca[] {
  try {
    const valor: unknown = JSON.parse(localStorage.getItem(RECENTES_KEY) || '[]');
    return Array.isArray(valor) ? valor as ProdutoBusca[] : [];
  } catch {
    return [];
  }
}

function formatarData(iso: string | null | undefined): string {
  if (!iso) return '';
  const data = new Date(iso);
  return `${String(data.getDate()).padStart(2, '0')}/${String(data.getMonth() + 1).padStart(2, '0')}`;
}

function mensagemDoErro(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ListaResultadosBusca({
  resultados,
  onSelecionar,
  paginacaoInfo,
  onPageChange,
  buscando,
  carrinhoSkus,
}: ListaResultadosBuscaProps) {
  const paginacaoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paginacaoRef.current && paginacaoInfo && paginacaoInfo.totalPages > 1) {
      renderizarPaginacao(paginacaoRef.current, paginacaoInfo.totalPages, paginacaoInfo.currentPage, onPageChange);
    } else if (paginacaoRef.current) {
      paginacaoRef.current.innerHTML = '';
    }
  }, [paginacaoInfo, onPageChange]);

  if (buscando && resultados.length === 0) {
    return <UICarregando variante="bloco" tamanho="sm" texto="Buscando..." />;
  }
  if (!buscando && resultados.length === 0) return null;

  return (
    <div className="gs-busca-lista-resultados" style={{ marginTop: '8px' }}>
      {buscando && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 10px' }}>
          <UICarregando variante="inline" />
        </div>
      )}
      {resultados.map((item) => {
        const jaNoCarrinho = carrinhoSkus?.has(item.sku);
        return (
          <div
            className={`gs-busca-item-resultado-v2${jaNoCarrinho ? ' no-carrinho' : ''}`}
            key={item.sku}
            onClick={() => void onSelecionar(item)}
          >
            <div className="card-borda-charme"></div>
            <img src={item.imagem || '/img/placeholder-image.png'} alt={item.nome} className="gs-resultado-img" />
            <div className="gs-resultado-info">
              <span className="gs-resultado-nome">{item.nome}</span>
              {item.variante && <span className="gs-resultado-variante">{item.variante}</span>}
              <span className="gs-resultado-sku">SKU: {item.sku}</span>
            </div>
            {jaNoCarrinho
              ? <i className="fas fa-check-circle gs-resultado-check"></i>
              : <i className="fas fa-chevron-right gs-resultado-seta"></i>}
          </div>
        );
      })}
      <div ref={paginacaoRef} className="gs-paginacao-container" style={{ marginTop: '12px' }}></div>
    </div>
  );
}

function CarrinhoSection({
  carrinho,
  onAtualizarQtd,
  onRemover,
  onLimpar,
  onTogglePrioridadeItem,
  onCriar,
  criando,
}: CarrinhoSectionProps) {
  const todosUrgentes = carrinho.length > 0 && carrinho.every((item) => item.prioridade);
  const algumUrgente = carrinho.some((item) => item.prioridade);

  const handleToggleTodos = () => {
    carrinho.forEach((item) => onTogglePrioridadeItem(item.item.sku, !todosUrgentes));
  };

  return (
    <div className="gs-carrinho-section">
      <div className="gs-carrinho-header">
        <span>
          <i className="fas fa-shopping-cart"></i>{' '}
          Carrinho ({carrinho.length} {carrinho.length === 1 ? 'item' : 'itens'})
          {algumUrgente && (
            <span className="gs-carrinho-urgente-badge" style={{ marginLeft: 6 }}>
              <i className="fas fa-exclamation-triangle"></i>
              {carrinho.filter((item) => item.prioridade).length} urgente{carrinho.filter((item) => item.prioridade).length > 1 ? 's' : ''}
            </span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="gs-carrinho-limpar"
            onClick={handleToggleTodos}
            title={todosUrgentes ? 'Remover prioridade de todos' : 'Marcar todos como urgente'}
            style={{ color: todosUrgentes ? '#e74c3c' : undefined }}
          >
            <i className="fas fa-star"></i>
            {todosUrgentes ? 'Remover urgência' : 'Todos urgentes'}
          </button>
          <button type="button" className="gs-carrinho-limpar" onClick={onLimpar}>Limpar</button>
        </div>
      </div>

      <div className="gs-carrinho-lista">
        {carrinho.map((itemCarrinho) => (
          <div
            key={itemCarrinho.item.sku}
            className={`gs-carrinho-item-wrapper${itemCarrinho.temDuplicata === true ? ' tem-aviso' : ''}${itemCarrinho.prioridade ? ' urgente' : ''}`}
          >
            <div className="gs-carrinho-item">
              <img src={itemCarrinho.item.imagem || '/img/placeholder-image.png'} alt={itemCarrinho.item.nome} className="gs-carrinho-img" />
              <div className="gs-carrinho-item-info">
                <span className="gs-carrinho-item-nome">{itemCarrinho.item.nome}</span>
                {itemCarrinho.item.variante && <span className="gs-carrinho-item-variante">{itemCarrinho.item.variante}</span>}
                {itemCarrinho.prioridade && (
                  <span className="gs-carrinho-urgente-badge" style={{ alignSelf: 'flex-start', marginTop: 2 }}>
                    <i className="fas fa-exclamation-triangle"></i> URGENTE
                  </span>
                )}
              </div>
              <div className="gs-qtd-input-wrapper gs-qtd-mini">
                <button type="button" className="gs-qtd-btn" onClick={() => onAtualizarQtd(itemCarrinho.item.sku, itemCarrinho.quantidade - 1)}>−</button>
                <input
                  type="number"
                  className="gs-input-qtd-compacto"
                  value={itemCarrinho.quantidade}
                  onChange={(event) => onAtualizarQtd(itemCarrinho.item.sku, event.target.value)}
                  min="1"
                />
                <button type="button" className="gs-qtd-btn" onClick={() => onAtualizarQtd(itemCarrinho.item.sku, itemCarrinho.quantidade + 1)}>+</button>
              </div>
              <button
                type="button"
                className={`gs-carrinho-prioridade-btn${itemCarrinho.prioridade ? ' ativo' : ''}`}
                onClick={() => onTogglePrioridadeItem(itemCarrinho.item.sku, !itemCarrinho.prioridade)}
                title={itemCarrinho.prioridade ? 'Remover urgência' : 'Marcar como urgente'}
              >
                <i className={`fas fa-${itemCarrinho.prioridade ? 'exclamation-triangle' : 'star'}`}></i>
              </button>
              <button type="button" className="gs-carrinho-del-btn" onClick={() => onRemover(itemCarrinho.item.sku)}>
                <i className="fas fa-trash"></i>
              </button>
            </div>
            {itemCarrinho.temDuplicata === true && (
              <div className="gs-carrinho-aviso-duplicata">
                <i className="fas fa-exclamation-triangle"></i>
                {(() => {
                  const estagios = (itemCarrinho.demandasAtivas || []).map((demanda) => demanda.estagio_atual);
                  if (estagios.includes('COSTURA')) return 'Já em costura! Pode criar mesmo assim ou remover.';
                  if (estagios.includes('ARREMATE')) return 'Já em arremate/embalagem. Pode criar mesmo assim ou remover.';
                  return 'Já existe demanda ativa. Pode criar mesmo assim ou remover.';
                })()}
              </div>
            )}
          </div>
        ))}
      </div>

      <button type="button" className="gs-btn gs-btn-primario gs-btn-full" onClick={() => void onCriar()} disabled={carrinho.length === 0 || criando} style={{ marginTop: 12 }}>
        {criando
          ? <><div className="spinner-btn-interno"></div> Criando...</>
          : <><i className="fas fa-check"></i> Criar {carrinho.length} Demanda{carrinho.length !== 1 ? 's' : ''}</>}
      </button>
    </div>
  );
}

const ESTAGIO_LABEL: Record<string, { label: string; cor: string; icone: string }> = {
  AGUARDANDO: { label: 'Aguardando início', cor: '#6c757d', icone: 'fa-clock' },
  COSTURA: { label: 'Em costura', cor: 'var(--gs-primaria)', icone: 'fa-cut' },
  ARREMATE: { label: 'Em arremate / embalagem', cor: '#8e44ad', icone: 'fa-clipboard-check' },
};

function TelaDuplicata({
  item: _item,
  demandasAtivas,
  onCriarMesmoAssim,
  onVoltar,
  onDemandaAtualizada,
}: TelaDuplicataProps) {
  const [ajustandoId, setAjustandoId] = useState<number | null>(null);
  const [novaQtd, setNovaQtd] = useState('');
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const temDemandasEmAndamento = demandasAtivas.some((demanda) => demanda.status !== 'pendente');

  const handleTornarPrioridade = async (demanda: DemandaAtiva) => {
    setLoadingId(demanda.id);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/demandas/${demanda.id}/prioridade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nova_prioridade: 1 }),
      });
      if (!res.ok) throw new Error('Falha ao atualizar prioridade.');
      mostrarMensagem('Demanda promovida a prioridade!', 'sucesso');
      await onDemandaAtualizada();
    } catch (error) {
      mostrarMensagem(mensagemDoErro(error), 'erro');
    } finally {
      setLoadingId(null);
    }
  };

  const handleConfirmarQtd = async (demanda: DemandaAtiva) => {
    const qtd = Number.parseInt(novaQtd, 10);
    if (!qtd || qtd < 1) return;
    setLoadingId(demanda.id);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/demandas/${demanda.id}/quantidade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nova_quantidade: qtd }),
      });
      if (!res.ok) throw new Error('Falha ao atualizar quantidade.');
      mostrarMensagem('Quantidade atualizada!', 'sucesso');
      await onDemandaAtualizada();
    } catch (error) {
      mostrarMensagem(mensagemDoErro(error), 'erro');
    } finally {
      setLoadingId(null);
      setAjustandoId(null);
    }
  };

  return (
    <div>
      <div className="gs-form-header-voltar">
        <button className="gs-btn-voltar" onClick={onVoltar} type="button"><i className="fas fa-arrow-left"></i></button>
        <span>Demanda já existe</span>
      </div>
      <div className="gs-duplicata-aviso"><i className="fas fa-exclamation-triangle"></i><span>Já existe uma demanda ativa com este produto. O que você quer fazer?</span></div>
      {temDemandasEmAndamento && (
        <div className="gs-duplicata-aviso-info"><i className="fas fa-info-circle"></i><span>Pode haver peças deste produto circulando em outros setores (arremate, costura ou embalagem). Verifique o painel de demandas para detalhes.</span></div>
      )}
      {demandasAtivas.map((demanda) => {
        const estagioMeta = ESTAGIO_LABEL[demanda.estagio_atual || ''] || ESTAGIO_LABEL.AGUARDANDO;
        const urgente = Number(demanda.prioridade) === 1;
        return (
          <div key={demanda.id} className="gs-duplicata-card">
            <div className="card-borda-charme" style={{ backgroundColor: urgente ? '#e74c3c' : 'var(--cor-primaria)' }}></div>
            <div className="gs-duplicata-card-header">
              <span className="gs-duplicata-id">Demanda #{demanda.id}</span>
              <span className={`gs-duplicata-prioridade${urgente ? ' urgente' : ''}`}>{urgente ? <><i className="fas fa-exclamation-triangle"></i> Urgente</> : 'Normal'}</span>
            </div>
            <div className="gs-duplicata-card-info">
              <strong>{demanda.quantidade_solicitada} pçs</strong><span>·</span><span>{formatarData(demanda.data_solicitacao)}</span>
              {demanda.solicitado_por && <><span>·</span><span>por {demanda.solicitado_por}</span></>}
              <span>·</span><span className="gs-duplicata-status" style={{ color: estagioMeta.cor }}><i className={`fas ${estagioMeta.icone}`} style={{ marginRight: 4, fontSize: '0.75em' }}></i>{estagioMeta.label}</span>
            </div>
            {ajustandoId === demanda.id ? (
              <div className="gs-duplicata-ajuste-qtd">
                <div className="gs-qtd-input-wrapper">
                  <button type="button" className="gs-qtd-btn" onClick={() => setNovaQtd((valor) => String(Math.max(1, (Number.parseInt(valor, 10) || 0) - 1)))}>−</button>
                  <input type="number" className="gs-input-qtd-compacto" value={novaQtd} onChange={(event) => setNovaQtd(event.target.value)} min="1" autoFocus placeholder="0" />
                  <button type="button" className="gs-qtd-btn" onClick={() => setNovaQtd((valor) => String((Number.parseInt(valor, 10) || 0) + 1))}>+</button>
                </div>
                <button type="button" className="gs-btn gs-btn-primario gs-btn-sm" onClick={() => void handleConfirmarQtd(demanda)} disabled={!novaQtd || Number.parseInt(novaQtd, 10) < 1 || loadingId === demanda.id}>{loadingId === demanda.id ? <UICarregando variante="inline" /> : <><i className="fas fa-check"></i> Confirmar</>}</button>
                <button type="button" className="gs-btn gs-btn-secundario gs-btn-sm" onClick={() => setAjustandoId(null)}>Cancelar</button>
              </div>
            ) : (
              <div className="gs-duplicata-acoes">
                {!urgente && <button type="button" className="gs-btn gs-btn-urgente gs-btn-sm" onClick={() => void handleTornarPrioridade(demanda)} disabled={loadingId === demanda.id}>{loadingId === demanda.id ? <UICarregando variante="inline" /> : <><i className="fas fa-exclamation-triangle"></i> Tornar Prioridade</>}</button>}
                {demanda.status === 'pendente' && <button type="button" className="gs-btn gs-btn-secundario gs-btn-sm" onClick={() => { setAjustandoId(demanda.id); setNovaQtd(String(demanda.quantidade_solicitada || '')); }}><i className="fas fa-edit"></i> Ajustar Qtd</button>}
              </div>
            )}
          </div>
        );
      })}
      <div className="gs-duplicata-separador"><span>ou</span></div>
      <button type="button" className="gs-btn gs-btn-primario gs-btn-full" onClick={onCriarMesmoAssim}><i className="fas fa-plus"></i> Criar nova demanda mesmo assim</button>
    </div>
  );
}

function FormularioConfirmacao({ item, onConfirmar, onVoltar, carregando }: FormularioConfirmacaoProps) {
  const [quantidade, setQuantidade] = useState('');
  const [isPrioridade, setIsPrioridade] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const qtd = Number.parseInt(quantidade, 10);
    if (qtd > 0) void onConfirmar({ produto_sku: item.sku, quantidade_solicitada: qtd, prioridade: isPrioridade ? 1 : 2 });
  };

  const alternarPrioridade = () => setIsPrioridade((prioridade) => !prioridade);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') alternarPrioridade();
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="gs-form-header-voltar"><button className="gs-btn-voltar" onClick={onVoltar} type="button"><i className="fas fa-arrow-left"></i></button><span>Confirmar Demanda</span></div>
      <div className="gs-produto-confirmado">
        <div className="card-borda-charme" style={{ backgroundColor: isPrioridade ? '#e74c3c' : 'var(--cor-primaria)' }}></div>
        <img src={item.imagem || '/img/placeholder-image.png'} alt={item.nome} className="gs-resultado-img" />
        <div className="gs-resultado-info"><strong className="gs-resultado-nome">{item.nome}</strong>{item.variante && <span className="gs-resultado-variante">{item.variante}</span>}</div>
      </div>
      <div className="gs-form-quantidade-row"><label>Quantidade necessária</label><div className="gs-qtd-input-wrapper"><button type="button" className="gs-qtd-btn" onClick={() => setQuantidade((valor) => String(Math.max(1, (Number.parseInt(valor, 10) || 0) - 1)))}>−</button><input type="number" value={quantidade} onChange={(event) => setQuantidade(event.target.value)} min="1" className="gs-input-qtd-compacto" autoFocus placeholder="0" /><button type="button" className="gs-qtd-btn" onClick={() => setQuantidade((valor) => String((Number.parseInt(valor, 10) || 0) + 1))}>+</button></div></div>
      <div className={`gs-prioridade-toggle${isPrioridade ? ' ativo' : ''}`} onClick={alternarPrioridade} role="checkbox" aria-checked={isPrioridade} tabIndex={0} onKeyDown={handleKeyDown}>
        <div className="gs-prioridade-icone"><i className={`fas ${isPrioridade ? 'fa-exclamation-triangle' : 'fa-star'}`}></i></div>
        <div className="gs-prioridade-texto"><strong>{isPrioridade ? 'PRIORIDADE ATIVA — FURA-FILA' : 'Marcar como Prioridade'}</strong><span>{isPrioridade ? 'Esta demanda irá para o topo da fila imediatamente.' : 'Use apenas para pedidos urgentes.'}</span></div>
        <div className={`gs-prioridade-check${isPrioridade ? ' marcado' : ''}`}>{isPrioridade && <i className="fas fa-check"></i>}</div>
      </div>
      <button type="submit" className="gs-btn gs-btn-primario gs-btn-full" disabled={!quantidade || Number.parseInt(quantidade, 10) < 1 || carregando}>{carregando ? <><div className="spinner-btn-interno"></div> Criando...</> : <><i className="fas fa-check"></i> Criar Demanda</>}</button>
    </form>
  );
}

function CampoBusca({ value, onChange, onLimpar, placeholder = 'Digite o nome, cor ou SKU do produto...' }: CampoBuscaProps) {
  return (
    <div className="gs-input-busca-wrapper">
      <input type="text" className="gs-input" placeholder={placeholder} value={value} onChange={onChange} autoFocus />
      {value && <button type="button" className="gs-input-limpar-btn" onClick={onLimpar} tabIndex={-1}><i className="fas fa-times"></i></button>}
    </div>
  );
}

export default function ModalAdicionarDemanda({ onClose, onDemandaCriada, itemPreSelecionado = null }: ModalAdicionarDemandaProps) {
  const [termoBusca, setTermoBusca] = useState('');
  const [resultados, setResultados] = useState<ProdutoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [itemSelecionado, setItemSelecionado] = useState<ProdutoBusca | null>(itemPreSelecionado);
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [paginacaoInfo, setPaginacaoInfo] = useState<PaginacaoInfo | null>(null);
  const [recentes, setRecentes] = useState<ProdutoBusca[]>(() => lerRecentes());
  const [verificandoDuplicata, setVerificandoDuplicata] = useState(false);
  const [duplicataInfo, setDuplicataInfo] = useState<DuplicataInfo | null>(null);
  const [itemPendente, setItemPendente] = useState<ProdutoBusca | null>(null);
  const [modoExpress, setModoExpress] = useState(false);
  const [carrinho, setCarrinho] = useState<CarrinhoItem[]>([]);
  const [criandoLote, setCriandoLote] = useState(false);
  const carrinhoSkus = useMemo(() => new Set(carrinho.map((item) => item.item.sku)), [carrinho]);
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const buscarProdutos = useCallback(async (termo: string, page = 1) => {
    if (termo.trim().length < 2) {
      setResultados([]);
      setPaginacaoInfo(null);
      return;
    }
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setBuscando(true);
    try {
      const token = localStorage.getItem('token');
      const url = `/api/demandas/buscar-produto?termo=${encodeURIComponent(termo)}&page=${page}&limit=5`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
      if (signal.aborted) return;
      const data = await response.json() as { rows?: ProdutoBusca[]; pagination?: PaginacaoInfo | null };
      setResultados(Array.isArray(data.rows) ? data.rows : []);
      setPaginacaoInfo(data.pagination || null);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) console.error('[Nova Demanda]', error);
    } finally {
      if (!signal.aborted) setBuscando(false);
    }
  }, []);

  useEffect(() => {
    if (termoBusca.trim().length < 2) {
      setResultados([]);
      setPaginacaoInfo(null);
      return undefined;
    }
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => void buscarProdutos(termoBusca, paginaAtual), 300);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [termoBusca, paginaAtual, buscarProdutos]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const limparBusca = () => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    setTermoBusca('');
    setResultados([]);
    setPaginacaoInfo(null);
    setBuscando(false);
  };

  const handleSelecionarItem = async (item: ProdutoBusca) => {
    salvarRecente(item);
    setRecentes(lerRecentes());
    setItemPendente(item);
    setVerificandoDuplicata(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/demandas/verificar-duplicata?sku=${encodeURIComponent(item.sku)}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json() as DuplicataInfo;
      if (data.temDuplicata) setDuplicataInfo({ ...data, demandasAtivas: data.demandasAtivas || [] });
      else {
        setItemSelecionado(item);
        setItemPendente(null);
      }
    } catch {
      setItemSelecionado(item);
      setItemPendente(null);
    } finally {
      setVerificandoDuplicata(false);
    }
  };

  const handleAdicionarAoCarrinho = async (item: ProdutoBusca) => {
    salvarRecente(item);
    setRecentes(lerRecentes());
    if (carrinhoSkus.has(item.sku)) {
      setCarrinho((atual) => atual.map((entry) => entry.item.sku === item.sku ? { ...entry, quantidade: entry.quantidade + 1 } : entry));
      return;
    }
    setCarrinho((atual) => [...atual, { item, quantidade: 1, prioridade: false, temDuplicata: null }]);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/demandas/verificar-duplicata?sku=${encodeURIComponent(item.sku)}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json() as DuplicataInfo;
      setCarrinho((atual) => atual.map((entry) => entry.item.sku === item.sku ? { ...entry, temDuplicata: data.temDuplicata, demandasAtivas: data.demandasAtivas || [] } : entry));
    } catch {
      setCarrinho((atual) => atual.map((entry) => entry.item.sku === item.sku ? { ...entry, temDuplicata: false, demandasAtivas: [] } : entry));
    }
  };

  const handleAtualizarQtd = (sku: string, novaQtd: string | number) => {
    const quantidade = Math.max(1, Number.parseInt(String(novaQtd), 10) || 1);
    setCarrinho((atual) => atual.map((entry) => entry.item.sku === sku ? { ...entry, quantidade } : entry));
  };
  const handleTogglePrioridadeItem = (sku: string, valor: boolean) => setCarrinho((atual) => atual.map((entry) => entry.item.sku === sku ? { ...entry, prioridade: valor } : entry));
  const handleRemoverDoCarrinho = (sku: string) => setCarrinho((atual) => atual.filter((entry) => entry.item.sku !== sku));
  const handleLimparCarrinho = () => setCarrinho([]);

  const handleCriarLote = async () => {
    if (carrinho.length === 0) return;
    setCriandoLote(true);
    try {
      const token = localStorage.getItem('token');
      const itens = carrinho.map((entry) => ({ produto_sku: entry.item.sku, quantidade_solicitada: entry.quantidade, prioridade: entry.prioridade ? 1 : 2 }));
      const res = await fetch('/api/demandas/lote', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ itens }) });
      const data = await res.json() as { message?: string; totalCriadas?: number };
      mostrarMensagem(data.message || `${data.totalCriadas || 0} demanda(s) criada(s)!`, 'sucesso');
      await onDemandaCriada();
      onClose();
    } catch {
      mostrarMensagem('Erro ao criar demandas.', 'erro');
    } finally {
      setCriandoLote(false);
    }
  };

  const handleCriarDemanda = async (dadosDemanda: CriarDemandaPayload) => {
    setCarregando(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/demandas', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(dadosDemanda) });
      if (!response.ok) {
        const erro = await response.json() as { error?: string };
        throw new Error(erro.error || 'Não foi possível criar a demanda.');
      }
      mostrarMensagem('Demanda criada com sucesso!', 'sucesso');
      await onDemandaCriada();
      onClose();
    } catch (error) {
      mostrarMensagem(mensagemDoErro(error), 'erro');
    } finally {
      setCarregando(false);
    }
  };

  const handleToggleModoExpress = () => {
    setModoExpress((modo) => !modo);
    setCarrinho([]);
  };
  const emFaseDetalhe = itemSelecionado || duplicataInfo;
  const mostrarToggle = !emFaseDetalhe && !itemPreSelecionado;
  const onItemClick = modoExpress ? handleAdicionarAoCarrinho : handleSelecionarItem;

  const renderConteudo = () => {
    if (itemSelecionado) return <FormularioConfirmacao item={itemSelecionado} onConfirmar={handleCriarDemanda} onVoltar={() => setItemSelecionado(null)} carregando={carregando} />;
    if (duplicataInfo) return <TelaDuplicata item={itemPendente} demandasAtivas={duplicataInfo.demandasAtivas} onCriarMesmoAssim={() => { setItemSelecionado(itemPendente); setDuplicataInfo(null); setItemPendente(null); }} onVoltar={() => { setDuplicataInfo(null); setItemPendente(null); }} onDemandaAtualizada={async () => { await onDemandaCriada(); onClose(); }} />;

    return (
      <>
        <CampoBusca value={termoBusca} onChange={(event) => { setTermoBusca(event.target.value); setPaginaAtual(1); }} onLimpar={limparBusca} />
        {modoExpress && carrinho.length > 0 && <CarrinhoSection carrinho={carrinho} onAtualizarQtd={handleAtualizarQtd} onRemover={handleRemoverDoCarrinho} onLimpar={handleLimparCarrinho} onTogglePrioridadeItem={handleTogglePrioridadeItem} onCriar={handleCriarLote} criando={criandoLote} />}
        {!modoExpress && verificandoDuplicata && <UICarregando variante="bloco" tamanho="sm" texto="Verificando..." />}
        {!verificandoDuplicata && termoBusca === '' && recentes.length > 0 && (
          <div className="gs-recentes-container">
            <span className="gs-recentes-titulo"><i className="fas fa-history"></i> Recentes</span>
            <div className="gs-recentes-pills">
              {recentes.map((item) => (
                <button key={item.sku} type="button" className="gs-pill-recente" onClick={() => void onItemClick(item)}>
                  <img src={item.imagem || '/img/placeholder-image.png'} alt={item.nome} />
                  <span className="gs-pill-recente-nome">{item.nome}</span>
                  {item.variante && <span className="gs-pill-recente-variante">{item.variante}</span>}
                  {modoExpress && carrinhoSkus.has(item.sku) && <i className="fas fa-check-circle" style={{ color: '#27ae60', marginLeft: 'auto' }}></i>}
                </button>
              ))}
            </div>
          </div>
        )}
        {!verificandoDuplicata && <ListaResultadosBusca resultados={resultados} onSelecionar={onItemClick} paginacaoInfo={paginacaoInfo} onPageChange={setPaginaAtual} buscando={buscando} carrinhoSkus={modoExpress ? carrinhoSkus : null} />}
      </>
    );
  };

  return (
    <div className="gs-busca-modal-overlay centrado" onClick={onClose}>
      <div className="gs-busca-modal-conteudo" onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()} style={{ maxWidth: '540px', borderRadius: 14, overflow: 'hidden' }}>
        <div className="gs-add-demanda-header">
          <div className="gs-add-demanda-header-icone"><i className={`fas ${modoExpress ? 'fa-shopping-cart' : 'fa-plus'}`}></i></div>
          <span className="gs-add-demanda-header-titulo">{modoExpress ? 'Nova Demanda — Modo Express' : 'Nova Demanda'}</span>
          <div className="gs-add-demanda-header-acoes">
            {mostrarToggle && <button type="button" className={`gs-add-demanda-header-btn${modoExpress ? ' ativo' : ''}`} onClick={handleToggleModoExpress} title="Modo Express: criar múltiplas demandas de uma vez"><i className="fas fa-shopping-cart"></i> Express</button>}
            <button onClick={onClose} className="gs-add-demanda-fechar"><i className="fas fa-times"></i></button>
          </div>
        </div>
        <div className="gs-busca-modal-body">{renderConteudo()}</div>
      </div>
    </div>
  );
}
