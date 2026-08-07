// public/src/components/OPModalTempos.jsx
// Modal de configuração de TPP (Tempo Padrão de Produção)
// Layout redesenhado: cards por produto com imagem, etapas e tempos editáveis

import React, { useState, useEffect, useMemo } from 'react';
import { mostrarMensagem } from '/js/utils/popups.js';
import UIBuscaInteligente from './UIBuscaInteligente';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import imagemPlaceholder from '../../img/placeholder-image.png';

async function fetchApiWithToken(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    const response = await fetch(endpoint, {
        ...options,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro na requisição');
    }
    return response.json();
}

// Card de produto com suas etapas e campos de tempo editáveis
function TPPProdutoCard({ produto, tempos, onTempoChange }) {
    const etapas = useMemo(() =>
        (produto.etapas || []).map(e => ({
            processo: typeof e === 'object' ? e.processo : e,
            maquina:  typeof e === 'object' ? (e.maquina || null) : null,
        })),
        [produto.etapas]
    );

    const totalPreenchido = etapas.filter(e => {
        const chave = `${produto.id}-${e.processo}`;
        return tempos[chave] && parseFloat(tempos[chave]) > 0;
    }).length;

    const progresso = etapas.length > 0 ? Math.round((totalPreenchido / etapas.length) * 100) : 0;

    return (
        <div className="tpp-produto-card">
            <div className="tpp-produto-card-borda"></div>

            <div className="tpp-produto-header">
                <img
                    src={produto.imagem || imagemPlaceholder}
                    alt={produto.nome}
                    className="tpp-produto-img"
                    onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = imagemPlaceholder; }}
                />
                <div className="tpp-produto-info">
                    <h4 className="tpp-produto-nome">{produto.nome}</h4>
                    <div className="tpp-produto-meta">
                        <span className="tpp-etapas-count">
                            <i className="fas fa-layer-group"></i>
                            {etapas.length} etapa{etapas.length !== 1 ? 's' : ''}
                        </span>
                        <span className={`tpp-progresso-badge ${progresso === 100 ? 'completo' : progresso > 0 ? 'parcial' : ''}`}>
                            {progresso === 100
                                ? <><i className="fas fa-check-circle"></i> Completo</>
                                : `${totalPreenchido}/${etapas.length} configurado${totalPreenchido !== 1 ? 's' : ''}`
                            }
                        </span>
                    </div>
                    {progresso > 0 && progresso < 100 && (
                        <div className="tpp-barra-progresso">
                            <div className="tpp-barra-preenchida" style={{ width: `${progresso}%` }}></div>
                        </div>
                    )}
                </div>
            </div>

            <div className="tpp-etapas-lista">
                {etapas.map((etapa, idx) => {
                    const chave = `${produto.id}-${etapa.processo}`;
                    const isFinal = idx === etapas.length - 1;
                    const tempoAtual = tempos[chave] ?? '';
                    const temValor = tempoAtual !== '' && parseFloat(tempoAtual) > 0;
                    return (
                        <div key={chave} className={`tpp-etapa-row ${temValor ? 'tem-valor' : ''}`}>
                            <div className="tpp-etapa-info">
                                <span className={`tpp-etapa-badge ${isFinal ? 'final' : 'normal'}`}>
                                    {isFinal ? 'Final' : `E${idx + 1}`}
                                </span>
                                <div className="tpp-etapa-texto">
                                    <span className="tpp-etapa-processo">{etapa.processo}</span>
                                    {etapa.maquina && etapa.maquina !== 'Não Definida' && (
                                        <span className="tpp-etapa-maquina">
                                            <i className="fas fa-cog"></i> {etapa.maquina}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="tpp-etapa-controle">
                                <input
                                    type="number"
                                    className={`tpp-tempo-input ${temValor ? 'preenchido' : ''}`}
                                    value={tempoAtual}
                                    onChange={e => onTempoChange(chave, e.target.value)}
                                    placeholder="—"
                                    min="0.1"
                                    step="0.1"
                                />
                                <span className="tpp-tempo-unidade">seg</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default function OPModalTempos({ isOpen, onClose }) {
    const [produtos, setProdutos] = useState([]);
    const [tempos, setTempos] = useState({});
    const [termoBusca, setTermoBusca] = useState('');
    const [carregando, setCarregando] = useState(true);
    const [salvando, setSalvando] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setCarregando(true);
        setTermoBusca('');
        Promise.all([
            fetchApiWithToken('/api/produtos'),
            fetchApiWithToken('/api/producao/tempos-padrao')
        ]).then(([produtosData, temposData]) => {
            setProdutos(
                produtosData
                    .filter(p => !p.is_kit && p.etapas?.length > 0)
                    .sort((a, b) => a.nome.localeCompare(b.nome))
            );
            setTempos(temposData);
        }).catch(err => {
            mostrarMensagem(`Erro ao carregar dados: ${err.message}`, 'erro');
        }).finally(() => {
            setCarregando(false);
        });
    }, [isOpen]);

    const handleTempoChange = (chave, valor) => {
        setTempos(prev => ({ ...prev, [chave]: valor }));
    };

    const handleSalvar = async () => {
        setSalvando(true);
        try {
            await fetchApiWithToken('/api/producao/tempos-padrao', {
                method: 'POST',
                body: JSON.stringify({ tempos }),
            });
            mostrarMensagem('Tempos Padrão de Produção (TPP) salvos com sucesso!', 'sucesso');
            onClose();
        } catch (err) {
            mostrarMensagem(`Erro ao salvar: ${err.message}`, 'erro');
        } finally {
            setSalvando(false);
        }
    };

    // Filtro por nome do produto ou processo de etapa
    const produtosFiltrados = useMemo(() => {
        if (!termoBusca) return produtos;
        const termo = termoBusca.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return produtos.filter(p => {
            const nome = p.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
            if (nome.includes(termo)) return true;
            return (p.etapas || []).some(e => {
                const proc = (typeof e === 'object' ? e.processo : e)
                    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
                return proc.includes(termo);
            });
        });
    }, [produtos, termoBusca]);

    // Stats globais de preenchimento
    const statsGeral = useMemo(() => {
        let total = 0, preenchidos = 0;
        produtos.forEach(p => {
            (p.etapas || []).forEach(e => {
                const proc = typeof e === 'object' ? e.processo : e;
                const chave = `${p.id}-${proc}`;
                total++;
                if (tempos[chave] && parseFloat(tempos[chave]) > 0) preenchidos++;
            });
        });
        return { total, preenchidos };
    }, [produtos, tempos]);

    if (!isOpen) return null;

    return (
        <div className="popup-container" style={{ display: 'flex' }}>
            <div className="popup-overlay" onClick={onClose}></div>
            <div className="op-modal tpp-modal">

                <div className="op-modal-header">
                    <div className="tpp-modal-titulo-grupo">
                        <div className="tpp-modal-icone">
                            <i className="fas fa-stopwatch"></i>
                        </div>
                        <div>
                            <h3 className="op-modal-titulo">Tempos Padrão de Produção</h3>
                            {!carregando && (
                                <p className="tpp-modal-subtitulo">
                                    {statsGeral.preenchidos} de {statsGeral.total} etapas configuradas
                                    {statsGeral.total > 0 && (
                                        <span className={`tpp-stats-pill ${statsGeral.preenchidos === statsGeral.total ? 'completo' : ''}`}>
                                            {Math.round((statsGeral.preenchidos / statsGeral.total) * 100)}%
                                        </span>
                                    )}
                                </p>
                            )}
                        </div>
                    </div>
                    <button className="op-modal-fechar-btn" onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="tpp-modal-busca">
                    <UIBuscaInteligente
                        onSearch={setTermoBusca}
                        placeholder="Buscar produto ou processo..."
                    />
                    {!carregando && termoBusca && (
                        <span className="tpp-busca-meta">
                            {produtosFiltrados.length} de {produtos.length}
                        </span>
                    )}
                </div>

                <div className="tpp-modal-corpo">
                    {carregando ? (
                        <UICarregando variante="bloco" texto="Carregando produtos..." />
                    ) : produtosFiltrados.length === 0 ? (
                        <UIFeedbackNotFound
                            variante="compacto"
                            icon="fa-search"
                            titulo="Nenhum produto encontrado"
                            mensagem={`Não há produtos correspondentes a "${termoBusca}".`}
                        />
                    ) : (
                        <div className="tpp-cards-grid">
                            {produtosFiltrados.map(produto => (
                                <TPPProdutoCard
                                    key={produto.id}
                                    produto={produto}
                                    tempos={tempos}
                                    onTempoChange={handleTempoChange}
                                />
                            ))}
                        </div>
                    )}
                </div>

                <div className="op-modal-footer">
                    <button
                        className="op-botao op-botao-secundario"
                        onClick={onClose}
                        disabled={salvando}
                    >
                        Cancelar
                    </button>
                    <button
                        className="op-botao op-botao-principal"
                        onClick={handleSalvar}
                        disabled={salvando}
                    >
                        {salvando
                            ? <><div className="spinner-btn-interno"></div> Salvando...</>
                            : <><i className="fas fa-save"></i> Salvar Alterações</>
                        }
                    </button>
                </div>
            </div>
        </div>
    );
}
