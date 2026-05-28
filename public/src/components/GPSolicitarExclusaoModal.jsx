import React, { useState } from 'react';
import { mostrarMensagem } from '/js/utils/popups.js';

function formatarDataHora(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleString('pt-BR');
}

export default function GPSolicitarExclusaoModal({ producao, onEnviado, onFechar }) {
    const [motivo, setMotivo]     = useState('');
    const [enviando, setEnviando] = useState(false);

    const handleEnviar = async () => {
        if (motivo.trim().length < 10) {
            mostrarMensagem('O motivo deve ter no mínimo 10 caracteres.', 'aviso');
            return;
        }
        setEnviando(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/gerenciar-producao/solicitar-exclusao', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ producao_id: producao.id, motivo: motivo.trim() }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Erro ao enviar solicitação' }));
                throw new Error(err.error || 'Erro ao enviar solicitação');
            }
            mostrarMensagem('Solicitação enviada! Aguarde a aprovação de um supervisor.', 'sucesso');
            onEnviado(producao.id);
        } catch (e) {
            mostrarMensagem(e.message, 'erro');
            setEnviando(false);
        }
    };

    return (
        <div className="gp-modal-overlay" onClick={onFechar}>
            <div className="gp-modal" onClick={e => e.stopPropagation()}>
                <div className="gp-modal-header">
                    <h3><i className="fas fa-clock"></i> Solicitar Exclusão</h3>
                    <button className="gp-modal-fechar" onClick={onFechar}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="gp-modal-corpo">
                    <p className="gp-aviso-info">
                        <i className="fas fa-info-circle"></i>
                        A exclusão precisará ser aprovada por um supervisor.
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

                    <div className="gp-campo-motivo">
                        <label className="gp-campo-label">
                            Motivo da exclusão <span className="gp-obrigatorio">*</span>
                        </label>
                        <textarea
                            className="gp-textarea-motivo"
                            placeholder="Descreva o motivo da exclusão (mínimo 10 caracteres)"
                            value={motivo}
                            onChange={e => setMotivo(e.target.value)}
                            rows={3}
                            disabled={enviando}
                        />
                        <span className="gp-contador-chars">{motivo.length} caracteres</span>
                    </div>
                </div>

                <div className="gp-modal-rodape">
                    <button className="gs-btn gs-btn-secundario" onClick={onFechar} disabled={enviando}>
                        Cancelar
                    </button>
                    <button
                        className="gp-btn-solicitar"
                        onClick={handleEnviar}
                        disabled={enviando || motivo.trim().length < 10}
                    >
                        {enviando
                            ? 'Enviando...'
                            : <><i className="fas fa-paper-plane"></i> Enviar Solicitação</>
                        }
                    </button>
                </div>
            </div>
        </div>
    );
}
