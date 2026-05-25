import React, { useState } from 'react';
import { permissoesCategorizadas } from '../../js/utils/permissoes.js';

export default function PermissoesAcordiao({ usuario, checkboxState, onChange, permissoesBase }) {
    const [busca, setBusca] = useState('');

    const buscaLower = busca.toLowerCase().trim();
    const categoriasOrdenadas = Object.keys(permissoesCategorizadas).sort();

    return (
        <div className="pu-permissoes-plano">
            <div className="pu-busca-permissoes-wrapper">
                <i className="fas fa-search pu-busca-perm-icon"></i>
                <input
                    type="text"
                    className="pu-busca-permissoes"
                    placeholder="Filtrar permissões..."
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                />
                {busca && (
                    <button className="pu-busca-limpar" onClick={() => setBusca('')} type="button">
                        <i className="fas fa-times"></i>
                    </button>
                )}
            </div>

            <div className="pu-permissoes-lista-plana">
                {categoriasOrdenadas.map(categoria => {
                    const permissoes = permissoesCategorizadas[categoria];
                    const permissoesFiltradas = buscaLower
                        ? permissoes.filter(p =>
                            p.label.toLowerCase().includes(buscaLower) ||
                            p.id.toLowerCase().includes(buscaLower)
                          )
                        : permissoes;

                    if (permissoesFiltradas.length === 0) return null;

                    const ativasCat = permissoes.filter(p =>
                        permissoesBase.has(p.id) || checkboxState[p.id]
                    ).length;

                    return (
                        <div key={categoria} className="pu-cat-secao">
                            <div className="pu-cat-header">
                                <span className="pu-cat-nome">{categoria}</span>
                                <span className="pu-acordeao-counter">{ativasCat}/{permissoes.length}</span>
                            </div>
                            <div className="pu-permissoes-grid">
                                {permissoesFiltradas.map(permissao => {
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
                                })}
                            </div>
                        </div>
                    );
                })}

                {buscaLower && categoriasOrdenadas.every(cat => {
                    const permissoes = permissoesCategorizadas[cat];
                    return !permissoes.some(p =>
                        p.label.toLowerCase().includes(buscaLower) ||
                        p.id.toLowerCase().includes(buscaLower)
                    );
                }) && (
                    <div className="pu-busca-sem-resultado">
                        <i className="fas fa-search"></i>
                        <p>Nenhuma permissão encontrada para "<strong>{busca}</strong>"</p>
                    </div>
                )}
            </div>
        </div>
    );
}
