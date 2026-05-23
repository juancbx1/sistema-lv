// public/src/components/OPQuickLogModal.jsx
// Painel inline de lançamento rápido de corte — busca unificada, lista plana, modo Express

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { mostrarMensagem } from '/js/utils/popups.js';
import UIBloqueio from './UIBloqueio.jsx';
import UIFeedbackNotFound from './UIFeedbackNotFound.jsx';

function normalizarTexto(str) {
    return (str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

function ResultadoExpress({ itens, totalOk, totalErro, onFechar }) {
    const tudoOk = totalErro === 0;
    return (
        <div className="op-quicklog-resultado">
            <div className={`op-quicklog-resultado-circulo ${tudoOk ? 'ok' : 'parcial'}`}>
                <i className={`fas fa-${tudoOk ? 'check' : 'exclamation-triangle'}`}></i>
            </div>
            <div className="op-quicklog-resultado-numero">
                {totalOk}<span> corte{totalOk !== 1 ? 's' : ''}</span>
            </div>
            <div className="op-quicklog-resultado-subtexto">
                {tudoOk ? 'registrados com sucesso' : `de ${totalOk + totalErro} registrados`}
            </div>
            <div className="op-quicklog-resultado-pills">
                {itens.map((item, i) => (
                    <div key={i} className={`op-quicklog-pill ${item.ok ? 'ok' : 'erro'}`}>
                        <i className={`fas fa-${item.ok ? 'check' : 'times'}`}></i>
                        {item.produtoNome}{item.variante ? ` — ${item.variante}` : ''}
                    </div>
                ))}
            </div>
            <button className="op-quicklog-resultado-fechar" onClick={onFechar}>
                {tudoOk ? 'Fechar' : 'Entendido'}
            </button>
        </div>
    );
}

// preenchido: { produto, variante, quantidadeSugerida } — quando vindo do Agente de Planejamento
export default function OPQuickLogModal({ produtos, usuario, onClose, onSuccess, preenchido }) {
    const [busca, setBusca] = useState(() => preenchido?.produto?.nome || '');
    const [expandidoId, setExpandidoId] = useState(() =>
        preenchido ? `${preenchido.produto.id}|${preenchido.variante || ''}` : null
    );
    const [quantidade, setQuantidade] = useState(
        preenchido?.quantidadeSugerida ? preenchido.quantidadeSugerida.toString() : ''
    );
    const [modo, setModo] = useState(() => localStorage.getItem('op_cortes_modo') || 'normal');
    const [fila, setFila] = useState([]);
    const [salvando, setSalvando] = useState(false);
    const [feito, setFeito] = useState(false);
    const [itemConfirmado, setItemConfirmado] = useState(null);
    const [resultadoExpress, setResultadoExpress] = useState(null);
    const [recentes, setRecentes] = useState(() => {
        try { return JSON.parse(localStorage.getItem('op_cortes_recentes') || '[]'); }
        catch { return []; }
    });

    const inputBuscaRef = useRef(null);
    const qtdInputRef = useRef(null);

    useEffect(() => {
        if (preenchido) {
            setTimeout(() => qtdInputRef.current?.focus(), 120);
        } else {
            setTimeout(() => inputBuscaRef.current?.focus(), 80);
        }
    }, []);

    const produtoVarianteFlat = useMemo(() => {
        const lista = [];
        for (const p of produtos) {
            if (!p.grade || p.grade.length === 0) {
                lista.push({
                    itemId: `${p.id}|`,
                    produtoId: p.id,
                    produtoNome: p.nome,
                    variante: null,
                    imagem: p.imagem || '/img/placeholder-image.png'
                });
            } else {
                for (const g of p.grade) {
                    lista.push({
                        itemId: `${p.id}|${g.variacao}`,
                        produtoId: p.id,
                        produtoNome: p.nome,
                        variante: g.variacao,
                        imagem: g.imagem || p.imagem || '/img/placeholder-image.png'
                    });
                }
            }
        }
        return lista;
    }, [produtos]);

    const listaFiltrada = useMemo(() => {
        if (!busca.trim()) return [];
        const tokens = normalizarTexto(busca).split(/\s+/).filter(Boolean);
        return produtoVarianteFlat.filter(item => {
            const str = normalizarTexto(item.produtoNome + ' ' + (item.variante || ''));
            return tokens.every(t => str.includes(t));
        });
    }, [produtoVarianteFlat, busca]);

    const mostrarRecentes = !busca.trim();
    const listaAtiva = mostrarRecentes ? recentes : listaFiltrada;

    function salvarRecente(item) {
        setRecentes(prev => {
            const filtrado = prev.filter(r => r.itemId !== item.itemId);
            const novo = [
                { itemId: item.itemId, produtoId: item.produtoId, produtoNome: item.produtoNome, variante: item.variante, imagem: item.imagem },
                ...filtrado
            ].slice(0, 8);
            try { localStorage.setItem('op_cortes_recentes', JSON.stringify(novo)); } catch {}
            return novo;
        });
    }

    const handleExpand = (itemId) => {
        if (expandidoId === itemId) {
            setExpandidoId(null);
        } else {
            setExpandidoId(itemId);
            setQuantidade('');
            setTimeout(() => qtdInputRef.current?.focus(), 250);
        }
    };

    const handleBuscaChange = (valor) => {
        setBusca(valor);
        setExpandidoId(null);
        setQuantidade('');
    };

    const alterarModo = (novoModo) => {
        setModo(novoModo);
        localStorage.setItem('op_cortes_modo', novoModo);
        setFila([]);
        setExpandidoId(null);
        setQuantidade('');
    };

    const ajustarQtd = (delta) => {
        setQuantidade(prev => Math.max(0, (parseInt(prev) || 0) + delta).toString());
    };

    const handleConfirmarNormal = async (item) => {
        const qty = parseInt(quantidade);
        if (!qty || qty <= 0) { mostrarMensagem('Informe uma quantidade válida.', 'aviso'); return; }
        setSalvando(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/cortes', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    produto_id: item.produtoId,
                    variante: item.variante || null,
                    quantidade: qty,
                    data: new Date().toISOString().split('T')[0],
                    status: 'cortados',
                    op: null,
                    cortador: usuario?.nome || 'Sistema'
                })
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Erro ao registrar corte.'); }
            salvarRecente(item);
            setItemConfirmado({ item, quantidade: qty });
            setFeito(true);
            setTimeout(() => onSuccess(), 1100);
        } catch (err) {
            mostrarMensagem(err.message, 'erro');
        } finally {
            setSalvando(false);
        }
    };

    const handleAdicionarFila = (item) => {
        const qty = parseInt(quantidade);
        if (!qty || qty <= 0) { mostrarMensagem('Informe uma quantidade válida.', 'aviso'); return; }
        setFila(prev => [...prev, { ...item, quantidade: qty }]);
        setExpandidoId(null);
        setQuantidade('');
    };

    const handleRemoverFila = (index) => {
        setFila(prev => prev.filter((_, i) => i !== index));
    };

    const handleRegistrarExpress = async () => {
        if (fila.length === 0) return;
        setSalvando(true);
        const token = localStorage.getItem('token');
        const data = new Date().toISOString().split('T')[0];

        const promises = fila.map(async (item) => {
            try {
                const res = await fetch('/api/cortes', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        produto_id: item.produtoId,
                        variante: item.variante || null,
                        quantidade: item.quantidade,
                        data,
                        status: 'cortados',
                        op: null,
                        cortador: usuario?.nome || 'Sistema'
                    })
                });
                if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Erro.'); }
                return { ...item, ok: true };
            } catch {
                return { ...item, ok: false };
            }
        });

        const itens = await Promise.all(promises);
        const totalOk = itens.filter(i => i.ok).length;
        const totalErro = itens.filter(i => !i.ok).length;
        itens.filter(i => i.ok).forEach(i => salvarRecente(i));
        setSalvando(false);
        setResultadoExpress({ itens, totalOk, totalErro });
    };

    const tituloHeader = feito
        ? 'Corte registrado!'
        : modo === 'express'
            ? 'Registrar Cortes'
            : 'Registrar Corte';

    return (
        <div className="op-quicklog-panel">

            {/* ── HEADER ── */}
            <div className="op-quicklog-header">
                <div className="op-quicklog-titulo">
                    <i className="fas fa-bolt op-quicklog-icone-titulo"></i>
                    <span>{tituloHeader}</span>
                </div>
                <div className="op-quicklog-header-acoes">
                    {!feito && !resultadoExpress && (
                        <div className="op-quicklog-modo-toggle">
                            <button
                                className={`op-quicklog-modo-btn ${modo === 'normal' ? 'ativo' : ''}`}
                                onClick={() => alterarModo('normal')}
                            >Normal</button>
                            <button
                                className={`op-quicklog-modo-btn ${modo === 'express' ? 'ativo' : ''}`}
                                onClick={() => alterarModo('express')}
                            >Express</button>
                        </div>
                    )}
                    <button className="op-quicklog-fechar" onClick={onClose} title="Fechar">
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            </div>

            {/* ── CORPO ── */}
            <div className="op-quicklog-corpo">

                {/* RESULTADO EXPRESS */}
                {resultadoExpress && (
                    <ResultadoExpress
                        {...resultadoExpress}
                        onFechar={() => onSuccess()}
                    />
                )}

                {/* SUCESSO NORMAL */}
                {feito && !resultadoExpress && (
                    <div className="op-quicklog-sucesso">
                        <i className="fas fa-check-circle"></i>
                        <span>
                            {itemConfirmado?.quantidade} pçs de{' '}
                            <strong>{itemConfirmado?.item.produtoNome}</strong>
                            {itemConfirmado?.item.variante ? ` — ${itemConfirmado.item.variante}` : ''} adicionadas ao estoque.
                        </span>
                    </div>
                )}

                {/* CONTEÚDO PRINCIPAL */}
                {!feito && !resultadoExpress && (
                    <>
                        {/* Busca */}
                        <div className="op-quicklog-busca">
                            <i className="fas fa-search"></i>
                            <input
                                ref={inputBuscaRef}
                                type="text"
                                placeholder="Buscar produto, cor, tamanho..."
                                value={busca}
                                onChange={e => handleBuscaChange(e.target.value)}
                            />
                            {busca && (
                                <button onClick={() => handleBuscaChange('')}>
                                    <i className="fas fa-times"></i>
                                </button>
                            )}
                        </div>

                        {/* Lista */}
                        {mostrarRecentes && recentes.length === 0 ? (
                            <div className="op-quicklog-dica">
                                <i className="fas fa-keyboard"></i>
                                <span>Digite para buscar um produto</span>
                            </div>
                        ) : (
                            <>
                                {mostrarRecentes && (
                                    <div className="op-quicklog-recentes-titulo">
                                        <i className="fas fa-clock"></i> Recentes
                                    </div>
                                )}
                                {!mostrarRecentes && listaFiltrada.length === 0 ? (
                                    <UIFeedbackNotFound
                                        icon="fa-search"
                                        titulo="Nenhum produto encontrado"
                                        mensagem={`Nenhum produto ou variante corresponde a "${busca}".`}
                                    />
                                ) : (
                                    <div className="op-quicklog-lista">
                                        {listaAtiva.map(item => {
                                            const aberto = expandidoId === item.itemId;
                                            return (
                                                <React.Fragment key={item.itemId}>
                                                    <div
                                                        className={`op-quicklog-item ${aberto ? 'selecionado' : ''}`}
                                                        onClick={() => handleExpand(item.itemId)}
                                                    >
                                                        <img
                                                            src={item.imagem}
                                                            alt={item.produtoNome}
                                                            className="op-quicklog-item-img"
                                                        />
                                                        <div className="op-quicklog-item-info">
                                                            <div className="op-quicklog-item-nome">{item.produtoNome}</div>
                                                            <div className="op-quicklog-item-variante">{item.variante || 'Padrão'}</div>
                                                        </div>
                                                        <i className={`fas fa-chevron-${aberto ? 'up' : 'down'} op-quicklog-item-seta`}></i>
                                                    </div>

                                                    <div className={`op-quicklog-qty-bloco ${aberto ? 'aberto' : ''}`}>
                                                        <div className="op-quicklog-qty-bloco-inner">
                                                            <div className="op-quicklog-qty-controles">
                                                                <button
                                                                    className="op-quicklog-qty-btn"
                                                                    onClick={() => ajustarQtd(-1)}
                                                                >−</button>
                                                                <input
                                                                    ref={aberto ? qtdInputRef : null}
                                                                    type="number"
                                                                    className="op-quicklog-qty-input"
                                                                    value={aberto ? quantidade : ''}
                                                                    onChange={e => aberto && setQuantidade(e.target.value)}
                                                                    onClick={e => e.stopPropagation()}
                                                                    placeholder="0"
                                                                    min="0"
                                                                />
                                                                <button
                                                                    className="op-quicklog-qty-btn"
                                                                    onClick={() => ajustarQtd(1)}
                                                                >+</button>
                                                            </div>
                                                            <div className="op-quicklog-qty-atalhos">
                                                                {[10, 50, 100].map(n => (
                                                                    <button
                                                                        key={n}
                                                                        onClick={() => aberto && setQuantidade(n.toString())}
                                                                    >{n} pçs</button>
                                                                ))}
                                                            </div>
                                                            <UIBloqueio permissao="registrar-corte">
                                                            {modo === 'normal' ? (
                                                                <button
                                                                    className="op-quicklog-confirmar"
                                                                    onClick={() => handleConfirmarNormal(item)}
                                                                    disabled={salvando || !quantidade || parseInt(quantidade) <= 0}
                                                                >
                                                                    {salvando
                                                                        ? <><div className="op-spinner-btn"></div> Salvando...</>
                                                                        : <><i className="fas fa-check"></i> Confirmar Corte</>
                                                                    }
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    className="op-quicklog-adicionar-fila"
                                                                    onClick={() => handleAdicionarFila(item)}
                                                                    disabled={!quantidade || parseInt(quantidade) <= 0}
                                                                >
                                                                    <i className="fas fa-plus"></i> Adicionar à Fila
                                                                </button>
                                                            )}
                                                            </UIBloqueio>
                                                        </div>
                                                    </div>
                                                </React.Fragment>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}

                        {/* FILA (Express) */}
                        {modo === 'express' && fila.length > 0 && (
                            <div className="op-quicklog-fila">
                                <div className="op-quicklog-fila-titulo">
                                    <i className="fas fa-layer-group"></i> Fila ({fila.length})
                                </div>
                                <div className="op-quicklog-fila-itens">
                                    {fila.map((item, i) => (
                                        <div key={i} className="op-quicklog-fila-item">
                                            <img src={item.imagem} alt={item.produtoNome} className="op-quicklog-item-img" />
                                            <div className="op-quicklog-item-info">
                                                <div className="op-quicklog-item-nome">{item.produtoNome}</div>
                                                <div className="op-quicklog-item-variante">{item.variante || 'Padrão'}</div>
                                            </div>
                                            <div className="op-quicklog-fila-qty">{item.quantidade} pçs</div>
                                            <button
                                                className="op-quicklog-fila-remover"
                                                onClick={() => handleRemoverFila(i)}
                                                title="Remover da fila"
                                            >
                                                <i className="fas fa-times"></i>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <UIBloqueio permissao="registrar-corte">
                                    <button
                                        className="op-quicklog-registrar-btn"
                                        onClick={handleRegistrarExpress}
                                        disabled={salvando}
                                    >
                                        {salvando
                                            ? <><div className="op-spinner-btn"></div> Registrando...</>
                                            : <>Registrar {fila.length} corte{fila.length > 1 ? 's' : ''} <i className="fas fa-arrow-right"></i></>
                                        }
                                    </button>
                                </UIBloqueio>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
