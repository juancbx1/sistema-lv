import React, { useState } from 'react';
import { mostrarMensagem } from '/js/utils/popups.js';

export default function GPEditarModal({ producao, funcionarios, onSalvar, onFechar }) {
    const [funcNome, setFuncNome]     = useState(producao.funcionario || '');
    const [quantidade, setQuantidade] = useState(String(producao.quantidade || ''));
    const [salvando, setSalvando]     = useState(false);

    const handleSalvar = async () => {
        const qtd = parseInt(quantidade);
        if (isNaN(qtd) || qtd <= 0) {
            mostrarMensagem('A quantidade deve ser um número positivo.', 'aviso');
            return;
        }

        setSalvando(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/producoes', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    id: producao.id,
                    quantidade: qtd,
                    funcionario: funcNome,
                    edicoes: (producao.edicoes || 0) + 1,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Erro ao salvar' }));
                throw new Error(err.error || 'Erro ao salvar');
            }

            const atualizada = await res.json();
            mostrarMensagem('Registro atualizado com sucesso!', 'sucesso');
            onSalvar(atualizada);
        } catch (e) {
            mostrarMensagem(e.message, 'erro');
        } finally {
            setSalvando(false);
        }
    };

    return (
        <div className="gp-modal-overlay" onClick={onFechar}>
            <div className="gp-modal" onClick={e => e.stopPropagation()}>
                <div className="gp-modal-header">
                    <h3><i className="fas fa-edit"></i> Editar Registro de Produção</h3>
                    <button className="gp-modal-fechar" onClick={onFechar}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="gp-modal-corpo">
                    <div className="gp-modal-info">
                        <span><strong>Produto:</strong> {producao.produto || '—'}</span>
                        <span><strong>Processo:</strong> {producao.processo}</span>
                        <span><strong>OP:</strong> {producao.op_numero || '—'}</span>
                        <span><strong>Máquina:</strong> {producao.maquina || '—'}</span>
                    </div>

                    <div className="gp-campo-grupo">
                        <label>Funcionário</label>
                        <select
                            value={funcNome}
                            onChange={e => setFuncNome(e.target.value)}
                            className="gp-input"
                        >
                            {funcionarios.map(f => (
                                <option key={f.id} value={f.nome}>{f.nome}</option>
                            ))}
                        </select>
                    </div>

                    <div className="gp-campo-grupo">
                        <label>Quantidade</label>
                        <input
                            type="number"
                            min="1"
                            value={quantidade}
                            onChange={e => setQuantidade(e.target.value)}
                            className="gp-input"
                        />
                    </div>
                </div>

                <div className="gp-modal-rodape">
                    <button className="gs-btn gs-btn-secundario" onClick={onFechar} disabled={salvando}>
                        Cancelar
                    </button>
                    <button className="gs-btn gs-btn-primario" onClick={handleSalvar} disabled={salvando}>
                        {salvando ? 'Salvando...' : 'Salvar Alterações'}
                    </button>
                </div>
            </div>
        </div>
    );
}
