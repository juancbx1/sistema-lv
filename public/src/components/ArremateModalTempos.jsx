// public/src/components/ArremateModalTempos.jsx

import React, { useState, useEffect, useMemo } from 'react';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import { mostrarMensagem } from '/js/utils/popups.js';

async function fetchApi(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    const res = await fetch(endpoint, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro na requisição');
    }
    return res.json();
}

function TPAProdutoCard({ produto, tempoAtual, onTempoChange }) {
    const temValor = tempoAtual !== '' && tempoAtual !== undefined && parseFloat(tempoAtual) > 0;

    return (
        <div className="tpp-produto-card">
            <div className="tpp-produto-card-borda"></div>

            <div className="tpp-produto-header">
                <img
                    src={produto.imagem || '/img/placeholder-image.png'}
                    alt={produto.nome}
                    className="tpp-produto-img"
                />
                <div className="tpp-produto-info">
                    <h4 className="tpp-produto-nome">{produto.nome}</h4>
                    <div className="tpp-produto-meta">
                        <span className={`tpp-progresso-badge${temValor ? ' completo' : ''}`}>
                            {temValor
                                ? <><i className="fas fa-check-circle"></i> Configurado</>
                                : 'Sem TPA'
                            }
                        </span>
                    </div>
                </div>
            </div>

            <div className="tpp-etapas-lista">
                <div className={`tpp-etapa-row${temValor ? ' tem-valor' : ''}`}>
                    <div className="tpp-etapa-info">
                        <span className="tpp-etapa-badge final">TPA</span>
                        <div className="tpp-etapa-texto">
                            <span className="tpp-etapa-processo">Tempo de Arremate</span>
                        </div>
                    </div>
                    <div className="tpp-etapa-controle">
                        <input
                            type="number"
                            className={`tpp-tempo-input${temValor ? ' preenchido' : ''}`}
                            value={tempoAtual ?? ''}
                            onChange={e => onTempoChange(produto.id, e.target.value)}
                            placeholder="—"
                            min="0.1"
                            step="0.1"
                        />
                        <span className="tpp-tempo-unidade">seg</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function ArremateModalTempos({ isOpen, onClose }) {
    const [produtos, setProdutos] = useState([]);
    const [tempos, setTempos] = useState({});
    const [busca, setBusca] = useState('');
    const [carregando, setCarregando] = useState(true);
    const [salvando, setSalvando] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setCarregando(true);
        setBusca('');
        Promise.all([
            fetchApi('/api/produtos'),
            fetchApi('/api/arremates/tempos-padrao')
        ]).then(([produtosData, temposData]) => {
            setProdutos(produtosData.filter(p => !p.is_kit));
            setTempos(temposData || {});
        }).catch(err => {
            mostrarMensagem(`Erro ao carregar dados: ${err.message}`, 'erro');
        }).finally(() => {
            setCarregando(false);
        });
    }, [isOpen]);

    const handleTempoChange = (produtoId, valor) => {
        setTempos(prev => ({ ...prev, [produtoId]: valor }));
    };

    const handleSalvar = async () => {
        setSalvando(true);
        try {
            await fetchApi('/api/arremates/tempos-padrao', {
                method: 'POST',
                body: JSON.stringify({ tempos }),
            });
            mostrarMensagem('Tempos padrão salvos com sucesso!', 'sucesso');
            onClose();
        } catch (err) {
            mostrarMensagem(`Erro ao salvar: ${err.message}`, 'erro');
        } finally {
            setSalvando(false);
        }
    };

    const produtosFiltrados = useMemo(() =>
        produtos.filter(p => p.nome.toLowerCase().includes(busca.toLowerCase())),
        [produtos, busca]
    );

    const qtdConfigurados = useMemo(() =>
        produtos.filter(p => {
            const v = tempos[p.id];
            return v !== '' && v !== undefined && parseFloat(v) > 0;
        }).length,
        [produtos, tempos]
    );

    if (!isOpen) return null;

    return (
        <div className="popup-container" style={{ display: 'flex' }}>
            <div className="popup-overlay" onClick={onClose}></div>
            <div className="oa-modal tpp-modal">

                {/* Header */}
                <div className="arremate-modal-header">
                    <div className="arremate-modal-header-esquerda">
                        <div className="tpp-modal-icone">
                            <i className="fas fa-clock"></i>
                        </div>
                    </div>
                    <div className="arremate-modal-header-centro">
                        <h3 className="arremate-modal-titulo">Configurar TPA</h3>
                        <div className="arremate-modal-header-info">
                            <p className="tpp-modal-subtitulo" style={{ margin: 0 }}>
                                Tempos Padrão de Arremate
                            </p>
                            <span className={`tpp-stats-pill${qtdConfigurados === produtos.length && produtos.length > 0 ? ' completo' : ''}`}>
                                {qtdConfigurados}/{produtos.length} configurados
                            </span>
                        </div>
                    </div>
                    <div className="arremate-modal-header-direita">
                        <button className="arremate-modal-fechar-btn" onClick={onClose}>
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                {/* Barra de busca */}
                <div className="tpp-modal-busca">
                    <div style={{ position: 'relative', flex: 1 }}>
                        <input
                            type="text"
                            className="oa-input"
                            placeholder="Buscar produto..."
                            value={busca}
                            onChange={e => setBusca(e.target.value)}
                            style={{ paddingRight: busca ? 32 : undefined }}
                        />
                        {busca && (
                            <button
                                onClick={() => setBusca('')}
                                style={{
                                    position: 'absolute', right: 8, top: '50%',
                                    transform: 'translateY(-50%)',
                                    border: 'none', background: 'none',
                                    cursor: 'pointer', color: '#94a3b8', fontSize: '1rem'
                                }}
                            >&times;</button>
                        )}
                    </div>
                    <span className="tpp-busca-meta">{produtosFiltrados.length} produto(s)</span>
                </div>

                {/* Corpo */}
                <div className="tpp-modal-corpo oa-modal-body">
                    {carregando ? (
                        <UICarregando variante="bloco" />
                    ) : produtosFiltrados.length === 0 ? (
                        <UIFeedbackNotFound
                            variante="compacto"
                            icon="fa-box-open"
                            titulo="Nenhum produto encontrado"
                            mensagem="Tente ajustar a busca para encontrar um produto."
                        />
                    ) : (
                        <div className="tpp-cards-grid">
                            {produtosFiltrados.map(produto => (
                                <TPAProdutoCard
                                    key={produto.id}
                                    produto={produto}
                                    tempoAtual={tempos[produto.id] ?? ''}
                                    onTempoChange={handleTempoChange}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="oa-modal-footer footer-lote">
                    <button
                        className="gs-btn gs-btn-sucesso"
                        onClick={handleSalvar}
                        disabled={salvando}
                    >
                        {salvando
                            ? <><UICarregando variante="inline" /> Salvando...</>
                            : <><i className="fas fa-save"></i> Salvar Alterações</>
                        }
                    </button>
                </div>
            </div>
        </div>
    );
}
