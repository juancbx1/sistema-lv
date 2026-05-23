import React, { useState } from 'react';
import { permissoesCategorizadas } from '../../js/utils/permissoes.js';

export default function PermissoesAcordiao({ usuario, checkboxState, onChange, permissoesBase }) {
    const [categoriasAbertas, setCategoriasAbertas] = useState(new Set());

    const toggleCategoria = (cat) => {
        setCategoriasAbertas(prev => {
            const next = new Set(prev);
            next.has(cat) ? next.delete(cat) : next.add(cat);
            return next;
        });
    };

    const categoriasOrdenadas = Object.keys(permissoesCategorizadas).sort();

    return (
        <div className="pu-acordeao">
            {categoriasOrdenadas.map(categoria => {
                const permissoes = permissoesCategorizadas[categoria];
                const aberto = categoriasAbertas.has(categoria);

                // Conta quantas permissões desta categoria o usuário tem
                const totalCat = permissoes.length;
                const ativasCat = permissoes.filter(p =>
                    permissoesBase.has(p.id) || checkboxState[p.id]
                ).length;

                return (
                    <div key={categoria} className={`pu-acordeao-item${aberto ? ' aberto' : ''}`}>
                        <button
                            className="pu-acordeao-titulo"
                            onClick={() => toggleCategoria(categoria)}
                            type="button"
                        >
                            <span className="pu-acordeao-cat-nome">{categoria}</span>
                            <span className="pu-acordeao-counter">{ativasCat}/{totalCat}</span>
                            <i className={`fas fa-chevron-${aberto ? 'up' : 'down'} pu-acordeao-seta`}></i>
                        </button>

                        {aberto && (
                            <div className="pu-acordeao-conteudo">
                                <div className="pu-permissoes-grid">
                                    {permissoes
                                        .slice()
                                        .sort((a, b) => a.label.localeCompare(b.label))
                                        .map(permissao => {
                                            const eBase = permissoesBase.has(permissao.id);
                                            const checked = eBase || !!checkboxState[permissao.id];

                                            return (
                                                <div
                                                    key={permissao.id}
                                                    className={`pu-permissao-item${eBase ? ' pu-permissao-base' : ''}`}
                                                    title={eBase ? `Herdada do tipo: ${(usuario.tipos || []).join(', ')}` : ''}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        id={`perm-${permissao.id}`}
                                                        checked={checked}
                                                        disabled={eBase}
                                                        onChange={e => !eBase && onChange(permissao.id, e.target.checked)}
                                                    />
                                                    <label htmlFor={`perm-${permissao.id}`}>{permissao.label}</label>
                                                </div>
                                            );
                                        })
                                    }
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
