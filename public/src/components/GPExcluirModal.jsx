import React, { useState } from 'react';
import { mostrarMensagem } from '/js/utils/popups.js';

function formatarDataHora(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleString('pt-BR');
}

export default function GPExcluirModal({ producao, onConfirmar, onFechar }) {
    const [excluindo, setExcluindo] = useState(false);

    const handleExcluir = async () => {
        setExcluindo(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/producoes', {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ id: producao.id }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Erro ao excluir' }));
                throw new Error(err.error || 'Erro ao excluir');
            }

            mostrarMensagem('Registro excluído com sucesso!', 'sucesso');
            onConfirmar(producao.id);
        } catch (e) {
            mostrarMensagem(e.message, 'erro');
            setExcluindo(false);
        }
    };

    return (
        <div className="gp-modal-overlay" onClick={onFechar}>
            <div className="gp-modal" onClick={e => e.stopPropagation()}>
                <div className="gp-modal-header">
                    <h3><i className="fas fa-trash-alt"></i> Excluir Registro de Produção</h3>
                    <button className="gp-modal-fechar" onClick={onFechar}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="gp-modal-corpo">
                    <p className="gp-aviso-excluir">
                        <i className="fas fa-exclamation-triangle"></i>
                        Esta ação não pode ser desfeita. O registro será excluído permanentemente.
                    </p>

                    <div className="gp-snapshot">
                        <div className="gp-snapshot-linha">
                            <span className="gp-snapshot-label">Funcionário:</span>
                            <span>{producao.funcionario}</span>
                        </div>
                        <div className="gp-snapshot-linha">
                            <span className="gp-snapshot-label">Produto:</span>
                            <span>{producao.produto || '—'}</span>
                        </div>
                        <div className="gp-snapshot-linha">
                            <span className="gp-snapshot-label">Processo:</span>
                            <span>{producao.processo}</span>
                        </div>
                        <div className="gp-snapshot-linha">
                            <span className="gp-snapshot-label">Quantidade:</span>
                            <span>{producao.quantidade}</span>
                        </div>
                        <div className="gp-snapshot-linha">
                            <span className="gp-snapshot-label">Pontos:</span>
                            <span>{Number(producao.pontos_gerados || 0).toFixed(2)}</span>
                        </div>
                        <div className="gp-snapshot-linha">
                            <span className="gp-snapshot-label">OP:</span>
                            <span>{producao.op_numero || '—'}</span>
                        </div>
                        <div className="gp-snapshot-linha">
                            <span className="gp-snapshot-label">Data/Hora:</span>
                            <span>{formatarDataHora(producao.data)}</span>
                        </div>
                    </div>
                </div>

                <div className="gp-modal-rodape">
                    <button className="gs-btn gs-btn-secundario" onClick={onFechar} disabled={excluindo}>
                        Cancelar
                    </button>
                    <button className="gp-btn-confirmar-excluir" onClick={handleExcluir} disabled={excluindo}>
                        {excluindo
                            ? 'Excluindo...'
                            : <><i className="fas fa-trash-alt"></i> Confirmar Exclusão</>
                        }
                    </button>
                </div>
            </div>
        </div>
    );
}
