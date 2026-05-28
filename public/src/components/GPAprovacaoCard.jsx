import React, { useState } from 'react';
import { temPermissao } from '../utils/bloqueio.js';
import GPDecidirModal from './GPDecidirModal.jsx';

function formatarDataHora(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleString('pt-BR');
}

const CORES_CHARME = {
    pendente:  '#f59e0b',
    aprovada:  '#22c55e',
    rejeitada: '#ef4444',
    cancelada: '#94a3b8',
};

export default function GPAprovacaoCard({ solicitacao: s, onDecisao }) {
    const [decidindo, setDecidindo] = useState(null); // 'aprovada' | 'rejeitada' | null
    const podeAprovar = temPermissao('aprovar-exclusao-producao');
    const snap = s.snapshot || {};
    const cor  = CORES_CHARME[s.status] || '#94a3b8';

    return (
        <>
            <div className="gp-aprovacao-card">
                <div className="card-borda-charme" style={{ backgroundColor: cor }}></div>

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
                            podeAprovar ? (
                                <div className="gp-aprovacao-acoes">
                                    <button className="gp-btn-aprovar" onClick={() => setDecidindo('aprovada')}>
                                        <i className="fas fa-check"></i> Aprovar
                                    </button>
                                    <button className="gp-btn-rejeitar" onClick={() => setDecidindo('rejeitada')}>
                                        <i className="fas fa-times"></i> Rejeitar
                                    </button>
                                </div>
                            ) : (
                                <p className="gp-aguardando">
                                    <i className="fas fa-hourglass-half"></i> Aguardando decisão de aprovador
                                </p>
                            )
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
