import React, { useState } from 'react';
import UIBloqueio from './UIBloqueio';
import GPDecidirModal from './GPDecidirModal.jsx';

function formatarDataHora(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleString('pt-BR');
}

export default function GPAprovacaoCard({ solicitacao: s, onDecisao }) {
    const [decidindo, setDecidindo] = useState(null); // 'aprovada' | 'rejeitada' | null
    const snap = s.snapshot || {};

    return (
        <>
            <div className="gp-aprovacao-card">
                <div className="gp-aprovacao-card-corpo">
                    <div className="gp-aprovacao-grid">
                        <span className="gp-snapshot-label">Funcionário:</span><span>{snap.funcionario || '—'}</span>
                        <span className="gp-snapshot-label">Produto:</span><span>{snap.produto || '—'}</span>
                        <span className="gp-snapshot-label">Processo:</span><span>{snap.processo || '—'}</span>
                        <span className="gp-snapshot-label">Quantidade:</span><span>{snap.quantidade ?? '—'}</span>
                        <span className="gp-snapshot-label">Pontos:</span><span>{Number(snap.pontos_gerados || 0).toFixed(2)}</span>
                        <span className="gp-snapshot-label">OP:</span><span>{snap.op_numero || '—'}</span>
                        <span className="gp-snapshot-label">Data:</span><span>{formatarDataHora(snap.data)}</span>
                    </div>

                    <div className="gp-aprovacao-meta">
                        <div className="gp-aprovacao-solicitante">
                            <i className="fas fa-user"></i>
                            <span>
                                Solicitado por <strong>{s.solicitado_por_nome}</strong>{' '}
                                em {formatarDataHora(s.solicitado_em)}
                            </span>
                        </div>

                        {s.motivo && (
                            <div className="gp-aprovacao-motivo">
                                <i className="fas fa-comment-alt"></i>
                                <span>"{s.motivo}"</span>
                            </div>
                        )}

                        {s.status !== 'pendente' && (
                            <div className="gp-aprovacao-decisao">
                                <span className={`gp-status-badge gp-status-${s.status}`}>
                                    {s.status === 'aprovada'  ? '✓ Aprovada'  :
                                     s.status === 'rejeitada' ? '✗ Rejeitada' : '— Cancelada'}
                                </span>
                                {s.decidido_por_nome && (
                                    <span className="gp-decidido-por">
                                        por {s.decidido_por_nome} em {formatarDataHora(s.decidido_em)}
                                    </span>
                                )}
                                {s.motivo_decisao && (
                                    <span className="gp-motivo-decisao">"{s.motivo_decisao}"</span>
                                )}
                            </div>
                        )}

                        {s.status === 'pendente' && (
                            <div className="gp-aprovacao-acoes">
                                <UIBloqueio
                                    permissao="aprovar-exclusao-producao"
                                    mensagem="Você não tem permissão para aprovar ou rejeitar exclusões de produção."
                                >
                                    <button className="gp-btn-aprovar" onClick={() => setDecidindo('aprovada')}>
                                        <i className="fas fa-check"></i> Aprovar
                                    </button>
                                </UIBloqueio>
                                <UIBloqueio
                                    permissao="aprovar-exclusao-producao"
                                    mensagem="Você não tem permissão para aprovar ou rejeitar exclusões de produção."
                                >
                                    <button className="gp-btn-rejeitar" onClick={() => setDecidindo('rejeitada')}>
                                        <i className="fas fa-times"></i> Rejeitar
                                    </button>
                                </UIBloqueio>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {decidindo && (
                <GPDecidirModal
                    solicitacao={s}
                    decisao={decidindo}
                    onDecidido={() => { setDecidindo(null); onDecisao?.(); }}
                    onFechar={() => setDecidindo(null)}
                />
            )}
        </>
    );
}
