// public/src/components/OPEtapasModal.jsx
// Redesign V2 — modal aberto, sem accordion, borda-charme, design moderno

import React, { useState, useEffect, useCallback } from 'react';
import { obterProdutos as obterProdutosDoStorage } from '/js/utils/storage.js';
import { mostrarMensagem, mostrarConfirmacao } from '/js/utils/popups.js';
import UIBloqueio from './UIBloqueio.jsx';

async function fetchAPI(url, options = {}) {
    const token = localStorage.getItem('token');
    const response = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `Erro HTTP ${response.status}` }));
        throw new Error(errorData.error);
    }
    return response.json();
}

function formatarData(dataISO) {
    if (!dataISO) return '';
    try {
        return new Date(dataISO).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
    } catch {
        return '';
    }
}

// --- Sub-componente: bloco de uma etapa ---
function EtapaBloco({ etapa, index, lancamentos, meta, usuariosMap }) {
    const lancsDaEtapa = lancamentos.filter(l => l.etapa_index === index);
    const totalProduzido = lancsDaEtapa.reduce((s, l) => s + l.quantidade, 0);

    let estadoClasse = 'aguardando';
    let estadoLabel = 'Aguardando';
    if (totalProduzido >= meta && meta > 0) {
        estadoClasse = 'concluida';
        estadoLabel = 'Concluída';
    } else if (totalProduzido > 0) {
        estadoClasse = 'andamento';
        estadoLabel = 'Em andamento';
    }

    return (
        <div className="op-etapa-bloco">
            <div className="op-etapa-bloco-header">
                <div className={`op-etapa-num ${estadoClasse}`}>{index + 1}</div>
                <span className="op-etapa-bloco-nome">{etapa.processo || `Etapa ${index + 1}`}</span>
                <span className={`op-etapa-status-tag ${estadoClasse}`}>{estadoLabel}</span>
            </div>

            <div className="op-etapa-bloco-body">
                {lancsDaEtapa.length === 0 ? (
                    <p className="op-etapa-vazio">Nenhum lançamento ainda.</p>
                ) : (
                    lancsDaEtapa.map(lanc => {
                        const user = usuariosMap.get(lanc.funcionario);
                        const avatar = user?.avatar_url || '/img/placeholder-image.png';
                        return (
                            <div key={lanc.id} className="op-lanc-row">
                                <img src={avatar} alt={lanc.funcionario} className="op-lanc-avatar" />
                                <span className="op-lanc-nome">{lanc.funcionario}</span>
                                <span className="op-lanc-qtd">{lanc.quantidade} pçs</span>
                                <span className="op-lanc-data">{formatarData(lanc.data)}</span>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

// --- Componente principal ---
export default function OPEtapasModal({ op, isOpen, onClose, onUpdateOP, onUpdateGlobal }) {
    const [opDetalhada, setOpDetalhada] = useState(null);
    const [usuariosMap, setUsuariosMap] = useState(new Map());
    const [produtoCompleto, setProdutoCompleto] = useState(null);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);
    const [finalizando, setFinalizando] = useState(false);

    const buscarDados = useCallback(async () => {
        if (!op?.edit_id) return;
        setCarregando(true);
        setErro(null);
        try {
            const [opData, usuariosData, todosProdutos] = await Promise.all([
                fetchAPI(`/api/ordens-de-producao/${op.edit_id}?_=${Date.now()}`),
                fetchAPI('/api/usuarios'),
                obterProdutosDoStorage()
            ]);
            setOpDetalhada(opData);
            const mapUsers = new Map();
            if (Array.isArray(usuariosData)) {
                usuariosData.forEach(u => mapUsers.set(u.nome, u));
            }
            setUsuariosMap(mapUsers);
            setProdutoCompleto(todosProdutos.find(p => p.id === opData.produto_id));
        } catch (err) {
            setErro(err.message);
        } finally {
            setCarregando(false);
        }
    }, [op]);

    useEffect(() => {
        if (isOpen) {
            setFinalizando(false);
            setOpDetalhada(null);
            buscarDados();
        }
    }, [isOpen, buscarDados]);

    const handleFinalizar = async () => {
        if (!opDetalhada) return;

        const lancs = opDetalhada.lancamentos_detalhados || [];
        const ultimoIndex = opDetalhada.etapas.length - 1;
        const totalUltimaEtapa = lancs
            .filter(l => l.etapa_index === ultimoIndex)
            .reduce((s, l) => s + l.quantidade, 0);
        const meta = opDetalhada.quantidade;

        const isParcial = totalUltimaEtapa < meta;

        const confirmado = await mostrarConfirmacao(
            isParcial
                ? `ATENÇÃO: A meta era ${meta} pçs, mas apenas ${totalUltimaEtapa} foram lançadas na última etapa. O saldo de ${meta - totalUltimaEtapa} pçs será considerado PERDA/QUEBRA. Deseja encerrar com divergência?`
                : `Tem certeza que deseja finalizar a OP #${opDetalhada.numero}?`,
            {
                tipo: isParcial ? 'perigo' : 'aviso',
                textoConfirmar: isParcial ? 'Sim, Encerrar com Perda' : 'Sim, Finalizar',
                textoCancelar: 'Cancelar'
            }
        );

        if (!confirmado) return;

        setFinalizando(true);
        try {
            await fetchAPI('/api/ordens-de-producao', {
                method: 'PUT',
                body: JSON.stringify({
                    ...opDetalhada,
                    status: 'finalizado',
                    data_final: new Date().toISOString()
                })
            });
            mostrarMensagem(`OP #${opDetalhada.numero} finalizada com sucesso!`, 'sucesso');
            onClose();
            if (onUpdateOP) onUpdateOP();
            if (onUpdateGlobal) onUpdateGlobal();
        } catch (err) {
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
            setFinalizando(false);
        }
    };

    if (!isOpen) return null;

    // ---- Cálculo do estado do botão ----
    const lancs = opDetalhada?.lancamentos_detalhados || [];
    const ultimoIndex = opDetalhada?.etapas ? opDetalhada.etapas.length - 1 : -1;
    const totalUltimaEtapa = lancs
        .filter(l => l.etapa_index === ultimoIndex)
        .reduce((s, l) => s + l.quantidade, 0);
    const meta = opDetalhada?.quantidade || 0;
    const jaFinalizado = opDetalhada?.status === 'finalizado';
    const podeAtuar = totalUltimaEtapa > 0 && !jaFinalizado;
    const isParcial = podeAtuar && totalUltimaEtapa < meta;

    // ---- Progresso geral (baseado na última etapa) ----
    const progresso = meta > 0 ? Math.min(100, Math.round((totalUltimaEtapa / meta) * 100)) : 0;
    const classeProgresso = progresso >= 100 ? 'completo' : progresso > 0 ? 'parcial' : 'zerado';

    // ---- Imagem ----
    let imagemSrc = '/img/placeholder-image.png';
    if (produtoCompleto && opDetalhada) {
        const gradeInfo = produtoCompleto.grade?.find(g => g.variacao === opDetalhada.variante);
        imagemSrc = gradeInfo?.imagem || produtoCompleto.imagem || imagemSrc;
    }

    // ---- Classe de status (para borda-charme) ----
    let statusClass = `status-${opDetalhada?.status || 'em-aberto'}`;
    if (opDetalhada && opDetalhada.status !== 'finalizado' && opDetalhada.status !== 'cancelada') {
        const todasProntas = (opDetalhada.etapas || []).every((_, i) => {
            const feito = lancs.filter(l => l.etapa_index === i).reduce((s, l) => s + l.quantidade, 0);
            return feito > 0;
        });
        if (todasProntas) statusClass = 'status-pronta-finalizar';
    }

    return (
        <div className="op-modal-v2-overlay" onClick={onClose}>
            <div
                className={`op-modal-v2 ${statusClass}`}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="op-modal-v2-header">
                    {opDetalhada && (
                        <img src={imagemSrc} alt={opDetalhada.produto} className="op-modal-v2-imagem" />
                    )}
                    <div className="op-modal-v2-header-info">
                        {opDetalhada && (
                            <>
                                <div className="op-modal-v2-numero">OP #{opDetalhada.numero}</div>
                                <p className="op-modal-v2-produto">{opDetalhada.produto || 'Produto'}</p>
                                <p className="op-modal-v2-variante">{opDetalhada.variante || 'Padrão'}</p>
                            </>
                        )}
                        {carregando && <p className="op-modal-v2-variante">Carregando...</p>}
                        {erro && <p style={{ color: 'red', fontSize: '0.85rem' }}>{erro}</p>}
                    </div>
                    {opDetalhada && (
                        <div className="op-modal-v2-meta">
                            <span className="meta-valor">{opDetalhada.quantidade}</span>
                            <span className="meta-label">A Produzir</span>
                        </div>
                    )}
                    <button className="op-modal-v2-fechar" onClick={onClose} title="Fechar">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* Barra de progresso */}
                {opDetalhada && !carregando && (
                    <div className="op-modal-v2-progresso">
                        <div className="op-modal-v2-progresso-topo">
                            <span className="op-modal-v2-progresso-label">Progresso Geral</span>
                            <span className="op-modal-v2-progresso-pct">
                                {totalUltimaEtapa} / {meta} pçs ({progresso}%)
                            </span>
                        </div>
                        <div className="op-modal-v2-barra-track">
                            <div
                                className={`op-modal-v2-barra-fill ${classeProgresso}`}
                                style={{ width: `${progresso}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Corpo — etapas */}
                <div className="op-modal-v2-body">
                    {carregando && (
                        <div className="spinner" style={{ margin: '20px 0' }}>Carregando histórico...</div>
                    )}
                    {opDetalhada && !carregando && (
                        <>
                            {opDetalhada.etapas.map((etapa, index) => (
                                <EtapaBloco
                                    key={index}
                                    index={index}
                                    etapa={etapa}
                                    lancamentos={opDetalhada.lancamentos_detalhados || []}
                                    meta={meta}
                                    usuariosMap={usuariosMap}
                                />
                            ))}
                        </>
                    )}
                </div>

                {/* Alerta parcial */}
                {opDetalhada && !carregando && isParcial && (
                    <div className="op-modal-v2-alerta-parcial">
                        <i className="fas fa-exclamation-triangle"></i>
                        <p>
                            <strong>Encerramento parcial:</strong> a meta não foi atingida. Ao finalizar,
                            o saldo restante ({meta - totalUltimaEtapa} pçs) será registrado como perda.
                        </p>
                    </div>
                )}

                {/* Footer com botões */}
                {opDetalhada && !carregando && (
                    <div className="op-modal-v2-footer">
                        {jaFinalizado ? (
                            <button className="op-modal-v2-btn encerrada" disabled>
                                <i className="fas fa-check-double"></i> OP Encerrada
                            </button>
                        ) : podeAtuar ? (
                            <UIBloqueio permissao="finalizar-op">
                                <button
                                    className={`op-modal-v2-btn ${isParcial ? 'parcial' : 'confirmar'}`}
                                    onClick={handleFinalizar}
                                    disabled={finalizando}
                                >
                                    {finalizando
                                        ? <><div className="op-spinner-btn"></div> Finalizando...</>
                                        : isParcial
                                            ? <><i className="fas fa-exclamation-circle"></i> Encerrar (Parcial)</>
                                            : <><i className="fas fa-check-double"></i> Finalizar OP</>
                                    }
                                </button>
                            </UIBloqueio>
                        ) : (
                            <button className="op-modal-v2-btn aguardando-btn" disabled>
                                <i className="fas fa-hourglass-half"></i> Aguardando Produção Final
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
