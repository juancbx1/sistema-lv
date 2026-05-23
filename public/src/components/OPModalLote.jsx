// public/src/components/OPModalLote.jsx
// Modal de confirmação de finalização em lote + popup de resultado redesenhado

import React, { useState } from 'react';
import { mostrarMensagem } from '/js/utils/popups.js';
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

// Verifica se a OP vai ter encerramento parcial
// (total produzido na última etapa < quantidade meta da OP)
function isParcial(op) {
    if (op.quantidade_feita_ultima_etapa === undefined) return false;
    return op.quantidade_feita_ultima_etapa < op.quantidade;
}

export default function OPModalLote({ isOpen, ops, onClose, onConcluido }) {
    const [executando, setExecutando] = useState(false);
    const [resultado, setResultado] = useState(null); // { sucesso, erro, detalhes: [{op, ok}] }

    if (!isOpen) return null;

    const temParcial = ops.some(isParcial);

    const handleConfirmar = async () => {
        setExecutando(true);
        const agora = new Date().toISOString();

        const resultados = await Promise.allSettled(
            ops.map(op =>
                fetchAPI('/api/ordens-de-producao', {
                    method: 'PUT',
                    body: JSON.stringify({
                        ...op,
                        status: 'finalizado',
                        data_final: agora
                    })
                })
            )
        );

        const detalhes = resultados.map((r, i) => ({ op: ops[i], ok: r.status === 'fulfilled' }));
        const sucesso = detalhes.filter(d => d.ok).length;
        const erro = detalhes.filter(d => !d.ok).length;

        setResultado({ sucesso, erro, detalhes });
        setExecutando(false);

        if (erro > 0) {
            mostrarMensagem(
                `${sucesso} OP(s) finalizadas. ${erro} falharam — verifique e tente novamente.`,
                'aviso'
            );
        }
    };

    const handleFechar = () => {
        if (resultado) {
            onConcluido(resultado);
        }
        setResultado(null);
        onClose();
    };

    return (
        <div className="op-lote-modal-overlay" onClick={handleFechar}>
            <div className="op-lote-modal" onClick={e => e.stopPropagation()}>

                {resultado ? (
                    /* --- Tela de resultado pós-finalização --- */
                    <div className="op-lote-resultado">
                        <div className="op-lote-res-header">
                            <div className={`op-lote-res-icone-circulo ${resultado.erro > 0 ? 'aviso' : ''}`}>
                                {resultado.erro === 0
                                    ? <i className="fas fa-check"></i>
                                    : <i className="fas fa-exclamation-triangle"></i>
                                }
                            </div>
                            <div className="op-lote-res-num">{resultado.sucesso}</div>
                            <div className="op-lote-res-txt">
                                {resultado.sucesso === 1 ? 'OP' : 'OPs'}{' '}
                                {resultado.erro === 0
                                    ? 'finalizadas com sucesso!'
                                    : <>finalizadas,{' '}<span className="op-lote-res-erro-cnt">{resultado.erro} com erro</span></>
                                }
                            </div>
                        </div>

                        {resultado.detalhes && (
                            <div className="op-lote-res-pills">
                                {resultado.detalhes.map(({ op, ok }) => (
                                    <span
                                        key={op.edit_id || op.id}
                                        className={`op-lote-res-pill ${ok ? 'ok' : 'err'}`}
                                    >
                                        OP #{op.numero}
                                        {!ok && <i className="fas fa-times"></i>}
                                    </span>
                                ))}
                            </div>
                        )}

                        {resultado.erro > 0 && (
                            <p className="op-lote-res-detalhe">
                                {resultado.erro === 1 ? 'A OP com erro permanece' : 'As OPs com erro permanecem'} na lista.
                                Verifique e tente novamente individualmente.
                            </p>
                        )}

                        <div className="op-lote-modal-footer">
                            <button
                                className={`op-lote-btn confirmar ${resultado.erro > 0 ? 'aviso' : ''}`}
                                onClick={handleFechar}
                            >
                                <i className="fas fa-check"></i>
                                {resultado.erro > 0 ? 'Entendido' : 'Fechar'}
                            </button>
                        </div>
                    </div>
                ) : (
                    /* --- Tela de confirmação --- */
                    <>
                        <div className="op-lote-modal-header">
                            <p className="op-lote-modal-titulo">
                                <i className="fas fa-layer-group"></i>
                                Finalizar em lote
                            </p>
                            <p className="op-lote-modal-subtitulo">
                                <strong>{ops.length} {ops.length === 1 ? 'Ordem de Produção será liberada' : 'Ordens de Produção serão liberadas'}</strong> para Arremates.
                            </p>
                        </div>

                        <div className="op-lote-modal-lista">
                            {ops.map(op => {
                                const parcial = isParcial(op);
                                const nomeVariante = op.variante && op.variante !== '-' ? op.variante : 'Padrão';
                                return (
                                    <div key={op.edit_id || op.id} className={`op-lote-item ${parcial ? 'parcial' : ''}`}>
                                        <div className="card-borda-charme"></div>
                                        <div className="op-lote-item-img">
                                            {op.produto_imagem
                                                ? <img src={op.produto_imagem} alt={nomeVariante} />
                                                : <i className="fas fa-tshirt"></i>
                                            }
                                        </div>
                                        <div className="op-lote-item-body">
                                            <div className="op-lote-item-variante">{nomeVariante}</div>
                                            <div className="op-lote-item-meta">OP <span>#{op.numero}</span></div>
                                        </div>
                                        <div className="op-lote-item-right">
                                            <div className="op-lote-item-qty">{op.quantidade}</div>
                                            <div className="op-lote-item-qty-label">peças</div>
                                            {parcial && <div className="op-lote-item-badge-parcial">Parcial</div>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {temParcial && (
                            <div className="op-lote-modal-aviso">
                                <i className="fas fa-exclamation-triangle"></i>
                                <p>
                                    <strong>Atenção:</strong> algumas OPs têm produção abaixo da meta.
                                    O saldo restante será registrado como perda ao confirmar.
                                </p>
                            </div>
                        )}

                        <div className="op-lote-modal-footer">
                            <button
                                className="op-lote-btn cancelar"
                                onClick={handleFechar}
                                disabled={executando}
                            >
                                Cancelar
                            </button>
                            <UIBloqueio permissao="finalizar-op">
                                <button
                                    className="op-lote-btn confirmar"
                                    onClick={handleConfirmar}
                                    disabled={executando}
                                >
                                    {executando
                                        ? <><div className="op-spinner-btn"></div> Finalizando...</>
                                        : <><i className="fas fa-check-double"></i> Confirmar finalização</>
                                    }
                                </button>
                            </UIBloqueio>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
