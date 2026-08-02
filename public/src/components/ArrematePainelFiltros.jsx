// public/src/components/ArrematePainelFiltros.jsx

import React, { useState, useEffect, useRef } from 'react';
import { getBuscasRecentes, addBuscaRecente, removeBuscaRecente } from '../utils/ArremateSearchHelpers';
import ArremateFiltrosAtivos from './ArremateFiltrosAtivos.jsx';

// ==========================================================================
//  SUB-COMPONENTE: GrupoChips — seção de filtro com pills clicáveis
// ==========================================================================
function GrupoChips({ titulo, opcoes, selecionados, onChange }) {
    if (!opcoes || opcoes.length === 0) return null;
    return (
        <div className="arremate-filtro-grupo">
            <span className="arremate-filtro-grupo-label">{titulo}</span>
            <div className="arremate-filtro-chips">
                {opcoes.map(opcao => (
                    <button
                        key={opcao}
                        className={`arremate-filtro-chip${selecionados.includes(opcao) ? ' ativo' : ''}`}
                        onClick={() => onChange(opcao)}
                        type="button"
                    >
                        {opcao}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ==========================================================================
//  COMPONENTE PRINCIPAL: ArrematePainelFiltros
// ==========================================================================
export default function ArrematePainelFiltros({ opcoesDeFiltro, onFiltrosChange, onAtualizarClick, atualizando }) {
    const [termoBusca, setTermoBusca] = useState('');
    const [produtosSelecionados, setProdutosSelecionados] = useState([]);
    const [coresSelecionadas, setCoresSelecionadas] = useState([]);
    const [tamanhosSelecionados, setTamanhosSelecionados] = useState([]);
    const [ordenacao, setOrdenacao] = useState('mais_recentes');

    const [mostrarRecentes, setMostrarRecentes] = useState(false);
    const [buscasRecentes, setBuscasRecentes] = useState([]);
    const [secaoAberta, setSecaoAberta] = useState(true); // accordion mobile

    const inputRef = useRef(null);
    const recentesRef = useRef(null);

    // Fechar dropdown de recentes ao clicar fora
    useEffect(() => {
        const handleClickFora = (e) => {
            if (
                recentesRef.current && !recentesRef.current.contains(e.target) &&
                inputRef.current && !inputRef.current.contains(e.target)
            ) {
                setMostrarRecentes(false);
            }
        };
        document.addEventListener('mousedown', handleClickFora);
        return () => document.removeEventListener('mousedown', handleClickFora);
    }, []);

    // Dispara onFiltrosChange com debounce
    useEffect(() => {
        const timer = setTimeout(() => {
            if (typeof onFiltrosChange === 'function') {
                onFiltrosChange({
                    termoBusca,
                    ordenacao,
                    produtos: produtosSelecionados,
                    cores: coresSelecionadas,
                    tamanhos: tamanhosSelecionados,
                });
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [termoBusca, ordenacao, produtosSelecionados, coresSelecionadas, tamanhosSelecionados, onFiltrosChange]);

    // --- HANDLERS ---
    const toggleChip = (opcao, lista, setLista) => {
        setLista(prev =>
            prev.includes(opcao) ? prev.filter(x => x !== opcao) : [...prev, opcao]
        );
    };

    const handleRemoverFiltro = (tipo, valor) => {
        if (tipo === 'produtos') setProdutosSelecionados(p => p.filter(x => x !== valor));
        if (tipo === 'cores') setCoresSelecionadas(p => p.filter(x => x !== valor));
        if (tipo === 'tamanhos') setTamanhosSelecionados(p => p.filter(x => x !== valor));
    };

    const handleLimparTodos = () => {
        setTermoBusca('');
        setProdutosSelecionados([]);
        setCoresSelecionadas([]);
        setTamanhosSelecionados([]);
        setOrdenacao('mais_recentes');
    };

    const handleFocoNaBusca = () => {
        const recentes = getBuscasRecentes();
        setBuscasRecentes(recentes);
        if (recentes.length > 0) setMostrarRecentes(true);
    };

    const handleConfirmarBusca = () => {
        if (termoBusca.trim()) addBuscaRecente(termoBusca.trim());
        setMostrarRecentes(false);
    };

    const handleSelecionarRecente = (termo) => {
        setTermoBusca(termo);
        setMostrarRecentes(false);
    };

    const handleRemoverRecente = (e, termo) => {
        e.stopPropagation();
        removeBuscaRecente(termo);
        setBuscasRecentes(getBuscasRecentes());
    };

    const filtrosAtivosCount =
        produtosSelecionados.length + coresSelecionadas.length + tamanhosSelecionados.length;

    return (
        <div className="arremate-filtros-painel">

            {/* ── HEADER DO PAINEL ── */}
            <div className="arremate-filtros-header">
                <div className="arremate-filtros-titulo-row">
                    <h3 className="arremate-filtros-titulo">
                        <i className="fas fa-layer-group"></i>
                        Produtos na Fila
                    </h3>
                    {filtrosAtivosCount > 0 && (
                        <span className="arremate-filtros-badge">{filtrosAtivosCount}</span>
                    )}
                </div>

                {/* Busca + botão atualizar */}
                <div className="arremate-busca-row">
                    <div className="arremate-busca-wrapper">
                        <i className="fas fa-search arremate-busca-icone"></i>
                        <input
                            ref={inputRef}
                            type="text"
                            className="arremate-busca-input"
                            placeholder="Produto, variação..."
                            value={termoBusca}
                            onChange={e => setTermoBusca(e.target.value)}
                            onFocus={handleFocoNaBusca}
                            onKeyDown={e => e.key === 'Enter' && handleConfirmarBusca()}
                        />
                        {termoBusca && (
                            <button
                                className="arremate-busca-limpar"
                                onClick={() => setTermoBusca('')}
                                type="button"
                                title="Limpar busca"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        )}

                        {/* Dropdown de buscas recentes */}
                        {mostrarRecentes && buscasRecentes.length > 0 && (
                            <div className="arremate-recentes-dropdown" ref={recentesRef}>
                                <span className="arremate-recentes-label">
                                    <i className="fas fa-clock"></i> Recentes
                                </span>
                                {buscasRecentes.map(termo => (
                                    <div
                                        key={termo}
                                        className="arremate-recente-item"
                                        onClick={() => handleSelecionarRecente(termo)}
                                    >
                                        <span>{termo}</span>
                                        <button
                                            type="button"
                                            className="arremate-recente-remover"
                                            onClick={e => handleRemoverRecente(e, termo)}
                                        >
                                            <i className="fas fa-times"></i>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Botão atualizar — mesmo estilo do oa-btn-refresh do painel */}
                    <button
                        className="oa-btn-refresh"
                        onClick={() => typeof onAtualizarClick === 'function' && onAtualizarClick()}
                        disabled={atualizando}
                        title="Atualizar lista"
                        type="button"
                    >
                        <i className={`fas fa-sync-alt${atualizando ? ' fa-spin' : ''}`}></i>
                    </button>
                </div>
            </div>

            {/* ── PÍLULAS DE FILTROS ATIVOS ── */}
            <ArremateFiltrosAtivos
                filtros={{
                    produtos: produtosSelecionados,
                    cores: coresSelecionadas,
                    tamanhos: tamanhosSelecionados,
                }}
                onRemoverFiltro={handleRemoverFiltro}
                onLimparTudo={handleLimparTodos}
            />

            {/* ── TOGGLE MOBILE ── */}
            <button
                className="arremate-filtros-mobile-toggle"
                onClick={() => setSecaoAberta(v => !v)}
                type="button"
            >
                <i className="fas fa-sliders-h"></i>
                <span>Filtros{filtrosAtivosCount > 0 ? ` (${filtrosAtivosCount})` : ''}</span>
                <i className={`fas fa-chevron-${secaoAberta ? 'up' : 'down'} arremate-toggle-icone`}></i>
            </button>

            {/* ── CORPO DOS FILTROS ── */}
            <div className={`arremate-filtros-corpo${secaoAberta ? ' aberto' : ''}`}>

                <GrupoChips
                    titulo="Produto"
                    opcoes={opcoesDeFiltro?.produtos || []}
                    selecionados={produtosSelecionados}
                    onChange={op => toggleChip(op, produtosSelecionados, setProdutosSelecionados)}
                />

                <GrupoChips
                    titulo="Cor"
                    opcoes={opcoesDeFiltro?.cores || []}
                    selecionados={coresSelecionadas}
                    onChange={op => toggleChip(op, coresSelecionadas, setCoresSelecionadas)}
                />

                <GrupoChips
                    titulo="Tamanho"
                    opcoes={opcoesDeFiltro?.tamanhos || []}
                    selecionados={tamanhosSelecionados}
                    onChange={op => toggleChip(op, tamanhosSelecionados, setTamanhosSelecionados)}
                />

                <div className="arremate-filtro-grupo">
                    <span className="arremate-filtro-grupo-label">Ordenar por</span>
                    <select
                        className="gs-select arremate-filtro-select"
                        value={ordenacao}
                        onChange={e => setOrdenacao(e.target.value)}
                    >
                        <option value="mais_recentes">Mais recentes</option>
                        <option value="mais_antigos">Mais antigos</option>
                        <option value="maior_quantidade">Maior quantidade</option>
                        <option value="menor_quantidade">Menor quantidade</option>
                    </select>
                </div>

                {filtrosAtivosCount > 0 && (
                    <div className="arremate-filtros-footer">
                        <button
                            className="arremate-filtros-limpar-btn"
                            onClick={handleLimparTodos}
                            type="button"
                        >
                            <i className="fas fa-times-circle"></i>
                            Limpar todos os filtros
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
