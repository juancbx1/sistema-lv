import React, { useState } from 'react';
import { mostrarMensagem } from '/js/utils/popups.js';

export default function GPDecidirModal({ solicitacao: s, decisao, onDecidido, onFechar }) {
    const [motivo, setMotivo]           = useState('');
    const [processando, setProcessando] = useState(false);
    const snap     = s.snapshot || {};
    const aprovando = decisao === 'aprovada';

    const handleConfirmar = async () => {
        setProcessando(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/gerenciar-producao/solicitacoes/${s.id}/decidir`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ decisao, motivo_decisao: motivo.trim() || undefined }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Erro ao processar decisão' }));
                throw new Error(err.error || 'Erro ao processar decisão');
            }
            const data = await res.json();

            if (data.aviso) {
                mostrarMensagem(data.aviso, 'aviso');
            } else if (aprovando) {
                mostrarMensagem('Exclusão aprovada. Registro deletado permanentemente.', 'sucesso');
            } else {
                mostrarMensagem('Solicitação rejeitada.', 'info');
            }

            onDecidido();
        } catch (e) {
            mostrarMensagem(e.message, 'erro');
            setProcessando(false);
        }
    };

    return (
        <div className="gp-modal-overlay" onClick={onFechar}>
            <div className="gp-modal" onClick={e => e.stopPropagation()}>
                <div className="gp-modal-header">
                    <h3>
                        {aprovando
                            ? <><i className="fas fa-check-circle"></i> Aprovar Exclusão</>
                            : <><i className="fas fa-times-circle"></i> Rejeitar Solicitação</>
                        }
                    </h3>
                    <button className="gp-modal-fechar" onClick={onFechar}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="gp-modal-corpo">
                    {aprovando && (
                        <p className="gp-aviso-excluir">
                            <i className="fas fa-exclamation-triangle"></i>
                            Você está prestes a excluir permanentemente este registro. Esta ação não pode ser desfeita.
                        </p>
                    )}

                    <div className="gp-snapshot">
                        <div className="gp-snapshot-linha">
                            <span className="gp-snapshot-label">Funcionário:</span>
                            <span>{snap.funcionario || '—'}</span>
                        </div>
                        <div className="gp-snapshot-linha">
                            <span className="gp-snapshot-label">Produto:</span>
                            <span>{snap.produto || '—'}</span>
                        </div>
                        <div className="gp-snapshot-linha">
                            <span className="gp-snapshot-label">Processo:</span>
                            <span>{snap.processo || '—'}</span>
                        </div>
                        <div className="gp-snapshot-linha">
                            <span className="gp-snapshot-label">Quantidade:</span>
                            <span>{snap.quantidade ?? '—'}</span>
                        </div>
                        <div className="gp-snapshot-linha">
                            <span className="gp-snapshot-label">OP:</span>
                            <span>{snap.op_numero || '—'}</span>
                        </div>
                        <div className="gp-snapshot-linha">
                            <span className="gp-snapshot-label">Solicitado por:</span>
                            <span>{s.solicitado_por_nome}</span>
                        </div>
                        {s.motivo && (
                            <div className="gp-snapshot-linha">
                                <span className="gp-snapshot-label">Motivo:</span>
                                <span>{s.motivo}</span>
                            </div>
                        )}
                    </div>

                    <div className="gp-campo-motivo">
                        <label className="gp-campo-label">
                            {aprovando ? 'Observação (opcional)' : 'Motivo da rejeição (opcional)'}
                        </label>
                        <textarea
                            className="gp-textarea-motivo"
                            placeholder={aprovando
                                ? 'Alguma observação sobre a aprovação?'
                                : 'Por que está rejeitando esta solicitação?'
                            }
                            value={motivo}
                            onChange={e => setMotivo(e.target.value)}
                            rows={2}
                            disabled={processando}
                        />
                    </div>
                </div>

                <div className="gp-modal-rodape">
                    <button className="gs-btn gs-btn-secundario" onClick={onFechar} disabled={processando}>
                        Cancelar
                    </button>
                    {aprovando ? (
                        <button
                            className="gp-btn-confirmar-excluir"
                            onClick={handleConfirmar}
                            disabled={processando}
                        >
                            {processando
                                ? 'Processando...'
                                : <><i className="fas fa-check"></i> Confirmar Exclusão</>
                            }
                        </button>
                    ) : (
                        <button
                            className="gp-btn-rejeitar-confirm"
                            onClick={handleConfirmar}
                            disabled={processando}
                        >
                            {processando
                                ? 'Processando...'
                                : <><i className="fas fa-times"></i> Rejeitar Solicitação</>
                            }
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
