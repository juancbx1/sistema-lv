// public/src/components/BotaoBuscaModalAddDemanda.jsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { mostrarMensagem } from '/js/utils/popups.js';
import { renderizarPaginacao } from '/js/utils/Paginacao.js';
import UICarregando from './UICarregando';

const RECENTES_KEY = 'demanda_recentes';

const salvarRecente = (item) => {
    try {
        const recentes = JSON.parse(localStorage.getItem(RECENTES_KEY) || '[]');
        const filtrado = recentes.filter(r => r.sku !== item.sku);
        localStorage.setItem(RECENTES_KEY, JSON.stringify([item, ...filtrado].slice(0, 5)));
    } catch(e) {}
};

const lerRecentes = () => {
    try { return JSON.parse(localStorage.getItem(RECENTES_KEY) || '[]'); }
    catch(e) { return []; }
};

const formatarData = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ── Lista de resultados de busca ──────────────────────────────
const ListaResultadosBusca = ({ resultados, onSelecionar, paginacaoInfo, onPageChange, buscando, carrinhoSkus }) => {
    const paginacaoRef = useRef(null);

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
            {resultados.map(item => {
                const jaNoCarrinho = carrinhoSkus?.has(item.sku);
                return (
                    <div
                        className={`gs-busca-item-resultado-v2${jaNoCarrinho ? ' no-carrinho' : ''}`}
                        key={item.sku}
                        onClick={() => onSelecionar(item)}
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
                            : <i className="fas fa-chevron-right gs-resultado-seta"></i>
                        }
                    </div>
                );
            })}
            <div ref={paginacaoRef} className="gs-paginacao-container" style={{ marginTop: '12px' }}></div>
        </div>
    );
};

// ── Carrinho Express — prioridade por item ────────────────────
const CarrinhoSection = ({ carrinho, onAtualizarQtd, onRemover, onLimpar, onTogglePrioridadeItem, onCriar, criando, usarCarregamentoPadrao }) => {
    const todosUrgentes = carrinho.length > 0 && carrinho.every(c => c.prioridade);
    const algumUrgente  = carrinho.some(c => c.prioridade);

    const handleToggleTodos = () => {
        carrinho.forEach(c => onTogglePrioridadeItem(c.item.sku, !todosUrgentes));
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
                            {carrinho.filter(c => c.prioridade).length} urgente{carrinho.filter(c => c.prioridade).length > 1 ? 's' : ''}
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
                        <i className={`fas ${todosUrgentes ? 'fa-star' : 'fa-star'}`}></i>
                        {todosUrgentes ? 'Remover urgência' : 'Todos urgentes'}
                    </button>
                    <button type="button" className="gs-carrinho-limpar" onClick={onLimpar}>Limpar</button>
                </div>
            </div>

            <div className="gs-carrinho-lista">
                {carrinho.map(c => (
                    <div
                        key={c.item.sku}
                        className={`gs-carrinho-item-wrapper${c.temDuplicata === true ? ' tem-aviso' : ''}${c.prioridade ? ' urgente' : ''}`}
                    >
                        <div className="gs-carrinho-item">
                            <img src={c.item.imagem || '/img/placeholder-image.png'} alt={c.item.nome} className="gs-carrinho-img" />
                            <div className="gs-carrinho-item-info">
                                <span className="gs-carrinho-item-nome">{c.item.nome}</span>
                                {c.item.variante && <span className="gs-carrinho-item-variante">{c.item.variante}</span>}
                                {c.prioridade && (
                                    <span className="gs-carrinho-urgente-badge" style={{ alignSelf: 'flex-start', marginTop: 2 }}>
                                        <i className="fas fa-exclamation-triangle"></i> URGENTE
                                    </span>
                                )}
                            </div>
                            <div className="gs-qtd-input-wrapper gs-qtd-mini">
                                <button type="button" className="gs-qtd-btn"
                                    onClick={() => onAtualizarQtd(c.item.sku, c.quantidade - 1)}>−</button>
                                <input
                                    type="number"
                                    className="gs-input-qtd-compacto"
                                    value={c.quantidade}
                                    onChange={e => onAtualizarQtd(c.item.sku, e.target.value)}
                                    min="1"
                                />
                                <button type="button" className="gs-qtd-btn"
                                    onClick={() => onAtualizarQtd(c.item.sku, c.quantidade + 1)}>+</button>
                            </div>
                            <button
                                type="button"
                                className={`gs-carrinho-prioridade-btn${c.prioridade ? ' ativo' : ''}`}
                                onClick={() => onTogglePrioridadeItem(c.item.sku, !c.prioridade)}
                                title={c.prioridade ? 'Remover urgência' : 'Marcar como urgente'}
                            >
                                <i className={`fas fa-${c.prioridade ? 'exclamation-triangle' : 'star'}`}></i>
                            </button>
                            <button type="button" className="gs-carrinho-del-btn" onClick={() => onRemover(c.item.sku)}>
                                <i className="fas fa-trash"></i>
                            </button>
                        </div>
                        {c.temDuplicata === true && (
                            <div className="gs-carrinho-aviso-duplicata">
                                <i className="fas fa-exclamation-triangle"></i>
                                {(() => {
                                    const estagios = (c.demandasAtivas || []).map(d => d.estagio_atual);
                                    if (estagios.includes('COSTURA'))  return 'Já em costura! Pode criar mesmo assim ou remover.';
                                    if (estagios.includes('ARREMATE')) return 'Já em arremate/embalagem. Pode criar mesmo assim ou remover.';
                                    return 'Já existe demanda ativa. Pode criar mesmo assim ou remover.';
                                })()}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <button
                type="button"
                className="gs-btn gs-btn-primario gs-btn-full"
                onClick={onCriar}
                disabled={carrinho.length === 0 || criando}
                style={{ marginTop: 12 }}
            >
                {criando
                    ? <>{usarCarregamentoPadrao ? <UICarregando variante="inline" /> : <div className="spinner-btn-interno"></div>} Criando...</>
                    : <><i className="fas fa-check"></i> Criar {carrinho.length} Demanda{carrinho.length !== 1 ? 's' : ''}</>
                }
            </button>
        </div>
    );
};

// Mapeamento de estágio do pipeline para labels amigáveis
// Usa o campo estagio_atual retornado pelo endpoint verificar-duplicata
const ESTAGIO_LABEL = {
    AGUARDANDO: { label: 'Aguardando início',         cor: '#6c757d',            icone: 'fa-clock' },
    COSTURA:    { label: 'Em costura',                cor: 'var(--gs-primaria)', icone: 'fa-cut' },
    ARREMATE:   { label: 'Em arremate / embalagem',   cor: '#8e44ad',            icone: 'fa-clipboard-check' },
};

// ── Tela de duplicata (modo normal) ──────────────────────────
const TelaDuplicata = ({ item, demandasAtivas, onCriarMesmoAssim, onVoltar, onDemandaAtualizada }) => {
    const [ajustandoId, setAjustandoId] = useState(null);
    const [novaQtd, setNovaQtd] = useState('');
    const [loadingId, setLoadingId] = useState(null);

    const handleTornarPrioridade = async (demanda) => {
        setLoadingId(demanda.id);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/demandas/${demanda.id}/prioridade`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ nova_prioridade: 1 })
            });
            if (!res.ok) throw new Error('Falha ao atualizar prioridade.');
            mostrarMensagem('Demanda promovida a prioridade!', 'sucesso');
            onDemandaAtualizada();
        } catch(e) {
            mostrarMensagem(e.message, 'erro');
        } finally {
            setLoadingId(null);
        }
    };

    const handleConfirmarQtd = async (demanda) => {
        const qtd = parseInt(novaQtd);
        if (!qtd || qtd < 1) return;
        setLoadingId(demanda.id);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/demandas/${demanda.id}/quantidade`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ nova_quantidade: qtd })
            });
            if (!res.ok) throw new Error('Falha ao atualizar quantidade.');
            mostrarMensagem('Quantidade atualizada!', 'sucesso');
            onDemandaAtualizada();
        } catch(e) {
            mostrarMensagem(e.message, 'erro');
        } finally {
            setLoadingId(null);
            setAjustandoId(null);
        }
    };

    // Verifica se alguma demanda está além de "pendente" (em andamento, em outro setor, etc.)
    const temDemandasEmAndamento = demandasAtivas.some(d => d.status !== 'pendente');

    return (
        <div>
            <div className="gs-form-header-voltar">
                <button className="gs-btn-voltar" onClick={onVoltar} type="button">
                    <i className="fas fa-arrow-left"></i>
                </button>
                <span>Demanda já existe</span>
            </div>
            <div className="gs-duplicata-aviso">
                <i className="fas fa-exclamation-triangle"></i>
                <span>Já existe uma demanda ativa com este produto. O que você quer fazer?</span>
            </div>

            {/* Nota informativa quando há demandas além do estágio inicial */}
            {temDemandasEmAndamento && (
                <div className="gs-duplicata-aviso-info">
                    <i className="fas fa-info-circle"></i>
                    <span>Pode haver peças deste produto circulando em outros setores (arremate, costura ou embalagem). Verifique o painel de demandas para detalhes.</span>
                </div>
            )}

            {demandasAtivas.map(d => {
                const estagioMeta = ESTAGIO_LABEL[d.estagio_atual] || ESTAGIO_LABEL.AGUARDANDO;
                return (
                    <div key={d.id} className="gs-duplicata-card">
                        <div className="card-borda-charme" style={{ backgroundColor: d.prioridade === 1 ? '#e74c3c' : 'var(--cor-primaria)' }}></div>
                        <div className="gs-duplicata-card-header">
                            <span className="gs-duplicata-id">Demanda #{d.id}</span>
                            <span className={`gs-duplicata-prioridade${d.prioridade === 1 ? ' urgente' : ''}`}>
                                {d.prioridade === 1 ? <><i className="fas fa-exclamation-triangle"></i> Urgente</> : 'Normal'}
                            </span>
                        </div>
                        <div className="gs-duplicata-card-info">
                            <strong>{d.quantidade_solicitada} pçs</strong>
                            <span>·</span>
                            <span>{formatarData(d.data_solicitacao)}</span>
                            {d.solicitado_por && <><span>·</span><span>por {d.solicitado_por}</span></>}
                            <span>·</span>
                            <span className="gs-duplicata-status" style={{ color: estagioMeta.cor }}>
                                <i className={`fas ${estagioMeta.icone}`} style={{ marginRight: 4, fontSize: '0.75em' }}></i>
                                {estagioMeta.label}
                            </span>
                        </div>
                        {ajustandoId === d.id ? (
                            <div className="gs-duplicata-ajuste-qtd">
                                <div className="gs-qtd-input-wrapper">
                                    <button type="button" className="gs-qtd-btn"
                                        onClick={() => setNovaQtd(q => String(Math.max(1, (parseInt(q) || 0) - 1)))}>−</button>
                                    <input type="number" className="gs-input-qtd-compacto" value={novaQtd}
                                        onChange={e => setNovaQtd(e.target.value)} min="1" autoFocus placeholder="0" />
                                    <button type="button" className="gs-qtd-btn"
                                        onClick={() => setNovaQtd(q => String((parseInt(q) || 0) + 1))}>+</button>
                                </div>
                                <button type="button" className="gs-btn gs-btn-primario gs-btn-sm"
                                    onClick={() => handleConfirmarQtd(d)}
                                    disabled={!novaQtd || parseInt(novaQtd) < 1 || loadingId === d.id}>
                                    {loadingId === d.id ? <UICarregando variante="inline" /> : <><i className="fas fa-check"></i> Confirmar</>}
                                </button>
                                <button type="button" className="gs-btn gs-btn-secundario gs-btn-sm" onClick={() => setAjustandoId(null)}>
                                    Cancelar
                                </button>
                            </div>
                        ) : (
                            <div className="gs-duplicata-acoes">
                                {d.prioridade !== 1 && (
                                    <button type="button" className="gs-btn gs-btn-urgente gs-btn-sm"
                                        onClick={() => handleTornarPrioridade(d)} disabled={loadingId === d.id}>
                                        {loadingId === d.id ? <UICarregando variante="inline" />
                                            : <><i className="fas fa-exclamation-triangle"></i> Tornar Prioridade</>}
                                    </button>
                                )}
                                {/* Ajustar Qtd: só faz sentido quando a demanda ainda não saiu de "pendente" */}
                                {d.status === 'pendente' && (
                                    <button type="button" className="gs-btn gs-btn-secundario gs-btn-sm"
                                        onClick={() => { setAjustandoId(d.id); setNovaQtd(String(d.quantidade_solicitada)); }}>
                                        <i className="fas fa-edit"></i> Ajustar Qtd
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
            <div className="gs-duplicata-separador"><span>ou</span></div>
            <button type="button" className="gs-btn gs-btn-primario gs-btn-full" onClick={onCriarMesmoAssim}>
                <i className="fas fa-plus"></i> Criar nova demanda mesmo assim
            </button>
        </div>
    );
};

// ── Formulário de confirmação (modo normal) ───────────────────
const FormularioConfirmacao = ({ item, onConfirmar, onVoltar, carregando, usarCarregamentoPadrao }) => {
    const [quantidade, setQuantidade] = useState('');
    const [isPrioridade, setIsPrioridade] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        const qtd = parseInt(quantidade);
        if (qtd > 0) onConfirmar({ produto_sku: item.sku, quantidade_solicitada: qtd, prioridade: isPrioridade ? 1 : 2 });
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="gs-form-header-voltar">
                <button className="gs-btn-voltar" onClick={onVoltar} type="button">
                    <i className="fas fa-arrow-left"></i>
                </button>
                <span>Confirmar Demanda</span>
            </div>
            <div className="gs-produto-confirmado">
                <div className="card-borda-charme" style={{ backgroundColor: isPrioridade ? '#e74c3c' : 'var(--cor-primaria)' }}></div>
                <img src={item.imagem || '/img/placeholder-image.png'} alt={item.nome} className="gs-resultado-img" />
                <div className="gs-resultado-info">
                    <strong className="gs-resultado-nome">{item.nome}</strong>
                    {item.variante && <span className="gs-resultado-variante">{item.variante}</span>}
                </div>
            </div>
            <div className="gs-form-quantidade-row">
                <label>Quantidade necessária</label>
                <div className="gs-qtd-input-wrapper">
                    <button type="button" className="gs-qtd-btn"
                        onClick={() => setQuantidade(q => String(Math.max(1, (parseInt(q) || 0) - 1)))}>−</button>
                    <input type="number" value={quantidade} onChange={e => setQuantidade(e.target.value)}
                        min="1" className="gs-input-qtd-compacto" autoFocus placeholder="0" />
                    <button type="button" className="gs-qtd-btn"
                        onClick={() => setQuantidade(q => String((parseInt(q) || 0) + 1))}>+</button>
                </div>
            </div>
            <div
                className={`gs-prioridade-toggle${isPrioridade ? ' ativo' : ''}`}
                onClick={() => setIsPrioridade(p => !p)}
                role="checkbox" aria-checked={isPrioridade} tabIndex={0}
                onKeyDown={e => e.key === ' ' && setIsPrioridade(p => !p)}
            >
                <div className="gs-prioridade-icone">
                    <i className={`fas ${isPrioridade ? 'fa-exclamation-triangle' : 'fa-star'}`}></i>
                </div>
                <div className="gs-prioridade-texto">
                    <strong>{isPrioridade ? 'PRIORIDADE ATIVA — FURA-FILA' : 'Marcar como Prioridade'}</strong>
                    <span>{isPrioridade ? 'Esta demanda irá para o topo da fila imediatamente.' : 'Use apenas para pedidos urgentes.'}</span>
                </div>
                <div className={`gs-prioridade-check${isPrioridade ? ' marcado' : ''}`}>
                    {isPrioridade && <i className="fas fa-check"></i>}
                </div>
            </div>
            <button type="submit" className="gs-btn gs-btn-primario gs-btn-full"
                disabled={!quantidade || parseInt(quantidade) < 1 || carregando}>
                {carregando
                    ? <>{usarCarregamentoPadrao ? <UICarregando variante="inline" /> : <div className="spinner-btn-interno"></div>} Criando...</>
                    : <><i className="fas fa-check"></i> Criar Demanda</>
                }
            </button>
        </form>
    );
};

// ── Campo de busca com X ──────────────────────────────────────
const CampoBusca = ({ value, onChange, onLimpar, placeholder = 'Digite o nome, cor ou SKU do produto...' }) => (
    <div className="gs-input-busca-wrapper">
        <input
            type="text"
            className="gs-input"
            placeholder={placeholder}
            value={value}
            onChange={onChange}
            autoFocus
        />
        {value && (
            <button
                type="button"
                className="gs-input-limpar-btn"
                onClick={onLimpar}
                tabIndex={-1}
            >
                <i className="fas fa-times"></i>
            </button>
        )}
    </div>
);

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================
export default function ModalAdicionarDemanda({ onClose, onDemandaCriada, itemPreSelecionado = null, usarCarregamentoPadrao = false }) {
    // Estado modo normal
    const [termoBusca, setTermoBusca]           = useState('');
    const [resultados, setResultados]           = useState([]);
    const [buscando, setBuscando]               = useState(false);
    const [carregando, setCarregando]           = useState(false);
    const [itemSelecionado, setItemSelecionado] = useState(itemPreSelecionado);
    const [paginaAtual, setPaginaAtual]         = useState(1);
    const [paginacaoInfo, setPaginacaoInfo]     = useState(null);
    const [recentes, setRecentes]               = useState(() => lerRecentes());
    const [verificandoDuplicata, setVerificandoDuplicata] = useState(false);
    const [duplicataInfo, setDuplicataInfo]     = useState(null);
    const [itemPendente, setItemPendente]       = useState(null);

    // Estado modo Express
    const [modoExpress, setModoExpress]         = useState(false);
    const [carrinho, setCarrinho]               = useState([]);
    const [criandoLote, setCriandoLote]         = useState(false);

    const carrinhoSkus = useMemo(() => new Set(carrinho.map(c => c.item.sku)), [carrinho]);

    // ── Refs para debounce e cancel de requests em voo ──
    const debounceRef = useRef(null);
    const abortRef    = useRef(null);

    // ── Busca (com AbortController para evitar resultados stale) ──
    const buscarProdutos = useCallback(async (termo, page = 1) => {
        if (termo.trim().length < 2) {
            setResultados([]);
            setPaginacaoInfo(null);
            return;
        }
        // Cancela request anterior se ainda estiver em voo
        if (abortRef.current) abortRef.current.abort();
        abortRef.current = new AbortController();
        const signal = abortRef.current.signal;

        setBuscando(true);
        try {
            const token = localStorage.getItem('token');
            const url = `/api/demandas/buscar-produto?termo=${encodeURIComponent(termo)}&page=${page}&limit=5`;
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` },
                signal,
            });
            if (signal.aborted) return;
            const data = await response.json();
            setResultados(data.rows || []);
            setPaginacaoInfo(data.pagination || null);
        } catch(e) {
            if (e.name === 'AbortError') return; // request cancelado — normal
        } finally {
            if (!signal.aborted) setBuscando(false);
        }
    }, []);

    // ── Efeito único: dispara busca com debounce ao mudar termo ou página ──
    // Debounce de 300ms evita requisições a cada tecla e o flickering visual.
    // O AbortController garante que resultados de requests mais antigos não
    // sobrescrevam resultados de requests mais novos (bug de race condition).
    useEffect(() => {
        if (termoBusca.trim().length < 2) {
            setResultados([]);
            setPaginacaoInfo(null);
            return;
        }
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            buscarProdutos(termoBusca, paginaAtual);
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [termoBusca, paginaAtual, buscarProdutos]);

    const limparBusca = () => {
        clearTimeout(debounceRef.current);
        if (abortRef.current) abortRef.current.abort();
        setTermoBusca('');
        setResultados([]);
        setPaginacaoInfo(null);
        setBuscando(false);
    };

    // ── Modo normal: selecionar item ──
    const handleSelecionarItem = async (item) => {
        salvarRecente(item);
        setRecentes(lerRecentes());
        setItemPendente(item);
        setVerificandoDuplicata(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(
                `/api/demandas/verificar-duplicata?sku=${encodeURIComponent(item.sku)}`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            const data = await res.json();
            if (data.temDuplicata) {
                setDuplicataInfo(data);
            } else {
                setItemSelecionado(item);
                setItemPendente(null);
            }
        } catch(e) {
            setItemSelecionado(item);
            setItemPendente(null);
        } finally {
            setVerificandoDuplicata(false);
        }
    };

    // ── Modo Express: carrinho ──
    const handleAdicionarAoCarrinho = async (item) => {
        salvarRecente(item);
        setRecentes(lerRecentes());

        if (carrinhoSkus.has(item.sku)) {
            setCarrinho(prev => prev.map(c =>
                c.item.sku === item.sku ? { ...c, quantidade: c.quantidade + 1 } : c
            ));
            return;
        }

        setCarrinho(prev => [...prev, { item, quantidade: 1, prioridade: false, temDuplicata: null }]);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(
                `/api/demandas/verificar-duplicata?sku=${encodeURIComponent(item.sku)}`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            const data = await res.json();
            setCarrinho(prev => prev.map(c =>
                c.item.sku === item.sku
                    ? { ...c, temDuplicata: data.temDuplicata, demandasAtivas: data.demandasAtivas || [] }
                    : c
            ));
        } catch(e) {
            setCarrinho(prev => prev.map(c =>
                c.item.sku === item.sku ? { ...c, temDuplicata: false, demandasAtivas: [] } : c
            ));
        }
    };

    const handleAtualizarQtd = (sku, novaQtd) => {
        const qtd = Math.max(1, parseInt(novaQtd) || 1);
        setCarrinho(prev => prev.map(c => c.item.sku === sku ? { ...c, quantidade: qtd } : c));
    };

    const handleTogglePrioridadeItem = (sku, valor) => {
        setCarrinho(prev => prev.map(c => c.item.sku === sku ? { ...c, prioridade: valor } : c));
    };

    const handleRemoverDoCarrinho = (sku) => setCarrinho(prev => prev.filter(c => c.item.sku !== sku));
    const handleLimparCarrinho    = () => setCarrinho([]);

    // ── Criar lote Express ──
    const handleCriarLote = async () => {
        if (carrinho.length === 0) return;
        setCriandoLote(true);
        try {
            const token = localStorage.getItem('token');
            const itens = carrinho.map(c => ({
                produto_sku: c.item.sku,
                quantidade_solicitada: c.quantidade,
                prioridade: c.prioridade ? 1 : 2,   // ← prioridade individual por item
            }));
            const res = await fetch('/api/demandas/lote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ itens })
            });
            const data = await res.json();
            mostrarMensagem(data.message || `${data.totalCriadas} demanda(s) criada(s)!`, 'sucesso');
            onDemandaCriada();
            onClose();
        } catch(e) {
            mostrarMensagem('Erro ao criar demandas.', 'erro');
        } finally {
            setCriandoLote(false);
        }
    };

    // ── Criar demanda única (modo normal) ──
    const handleCriarDemanda = async (dadosDemanda) => {
        setCarregando(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/demandas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(dadosDemanda)
            });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Não foi possível criar a demanda.');
            }
            mostrarMensagem('Demanda criada com sucesso!', 'sucesso');
            onDemandaCriada();
            onClose();
        } catch(error) {
            mostrarMensagem(error.message, 'erro');
        } finally {
            setCarregando(false);
        }
    };

    const handleToggleModoExpress = () => {
        setModoExpress(v => !v);
        setCarrinho([]);
    };

    // ── Render ──
    const emFaseDetalhe  = itemSelecionado || duplicataInfo;
    const mostrarToggle  = !emFaseDetalhe && !itemPreSelecionado;
    const onItemClick    = modoExpress ? handleAdicionarAoCarrinho : handleSelecionarItem;

    const renderConteudo = () => {
        if (itemSelecionado) {
            return (
                <FormularioConfirmacao
                    item={itemSelecionado}
                    onConfirmar={handleCriarDemanda}
                    onVoltar={() => setItemSelecionado(null)}
                    carregando={carregando}
                    usarCarregamentoPadrao={usarCarregamentoPadrao}
                />
            );
        }

        if (duplicataInfo) {
            return (
                <TelaDuplicata
                    item={itemPendente}
                    demandasAtivas={duplicataInfo.demandasAtivas}
                    onCriarMesmoAssim={() => { setItemSelecionado(itemPendente); setDuplicataInfo(null); setItemPendente(null); }}
                    onVoltar={() => { setDuplicataInfo(null); setItemPendente(null); }}
                    onDemandaAtualizada={() => { onDemandaCriada(); onClose(); }}
                />
            );
        }

        return (
            <>
                <CampoBusca
                    value={termoBusca}
                    onChange={e => { setTermoBusca(e.target.value); setPaginaAtual(1); }}
                    onLimpar={limparBusca}
                />

                {/* Carrinho (modo Express) */}
                {modoExpress && carrinho.length > 0 && (
                    <CarrinhoSection
                        carrinho={carrinho}
                        onAtualizarQtd={handleAtualizarQtd}
                        onRemover={handleRemoverDoCarrinho}
                        onLimpar={handleLimparCarrinho}
                        onTogglePrioridadeItem={handleTogglePrioridadeItem}
                        onCriar={handleCriarLote}
                        criando={criandoLote}
                        usarCarregamentoPadrao={usarCarregamentoPadrao}
                    />
                )}

                {/* Verificando duplicata */}
                {!modoExpress && verificandoDuplicata && (
                    <UICarregando variante="bloco" tamanho="sm" texto="Verificando..." />
                )}

                {/* Recentes */}
                {!verificandoDuplicata && termoBusca === '' && recentes.length > 0 && (
                    <div className="gs-recentes-container">
                        <span className="gs-recentes-titulo">
                            <i className="fas fa-history"></i> Recentes
                        </span>
                        <div className="gs-recentes-pills">
                            {recentes.map(item => (
                                <button key={item.sku} type="button" className="gs-pill-recente"
                                    onClick={() => onItemClick(item)}>
                                    <img src={item.imagem || '/img/placeholder-image.png'} alt={item.nome} />
                                    <span className="gs-pill-recente-nome">{item.nome}</span>
                                    {item.variante && <span className="gs-pill-recente-variante">{item.variante}</span>}
                                    {modoExpress && carrinhoSkus.has(item.sku) && (
                                        <i className="fas fa-check-circle" style={{ color: '#27ae60', marginLeft: 'auto' }}></i>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {!verificandoDuplicata && (
                    <ListaResultadosBusca
                        resultados={resultados}
                        onSelecionar={onItemClick}
                        paginacaoInfo={paginacaoInfo}
                        onPageChange={setPaginaAtual}
                        buscando={buscando}
                        carrinhoSkus={modoExpress ? carrinhoSkus : null}
                    />
                )}
            </>
        );
    };

    return (
        <div className="gs-busca-modal-overlay centrado" onClick={onClose}>
            <div
                className="gs-busca-modal-conteudo"
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: '540px', borderRadius: 14, overflow: 'hidden' }}
            >
                {/* Header escuro com gradiente */}
                <div className="gs-add-demanda-header">
                    <div className="gs-add-demanda-header-icone">
                        <i className={`fas ${modoExpress ? 'fa-shopping-cart' : 'fa-plus'}`}></i>
                    </div>
                    <span className="gs-add-demanda-header-titulo">
                        {modoExpress ? 'Nova Demanda — Modo Express' : 'Nova Demanda'}
                    </span>
                    <div className="gs-add-demanda-header-acoes">
                        {mostrarToggle && (
                            <button
                                type="button"
                                className={`gs-add-demanda-header-btn${modoExpress ? ' ativo' : ''}`}
                                onClick={handleToggleModoExpress}
                                title="Modo Express: criar múltiplas demandas de uma vez"
                            >
                                <i className="fas fa-shopping-cart"></i>
                                Express
                            </button>
                        )}
                        <button onClick={onClose} className="gs-add-demanda-fechar">
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                <div className="gs-busca-modal-body">
                    {renderConteudo()}
                </div>
            </div>
        </div>
    );
}
