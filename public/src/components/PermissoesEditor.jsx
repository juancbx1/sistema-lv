import React, { useState, useEffect, useCallback } from 'react';
import UICarregando from './UICarregando.jsx';
import PermissoesAcordiao from './PermissoesAcordiao.jsx';
import { permissoesPorTipo } from '../../js/utils/permissoes.js';

function fetchAuth(url, opts = {}) {
    const token = localStorage.getItem('token');
    return fetch(url, {
        ...opts,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
}

export default function PermissoesEditor() {
    const [usuarios, setUsuarios]                   = useState([]);
    const [carregando, setCarregando]               = useState(true);
    const [usuarioSelecionado, setUsuarioSelecionado] = useState(null);
    const [termoBusca, setTermoBusca]               = useState('');
    const [salvando, setSalvando]                   = useState(false);
    const [permissoesAlteradas, setPermissoesAlteradas] = useState(false);
    const [checkboxState, setCheckboxState]         = useState({});
    const [feedbackMsg, setFeedbackMsg]             = useState(null);

    const carregarUsuarios = useCallback(async () => {
        setCarregando(true);
        try {
            const r = await fetchAuth('/api/usuarios');
            if (!r.ok) throw new Error('Erro ao buscar usuários');
            const data = await r.json();
            setUsuarios(Array.isArray(data) ? data.sort((a, b) => a.nome.localeCompare(b.nome)) : []);
        } catch {
            setFeedbackMsg({ tipo: 'erro', texto: 'Erro ao carregar usuários.' });
        } finally {
            setCarregando(false);
        }
    }, []);

    useEffect(() => { carregarUsuarios(); }, [carregarUsuarios]);

    const usuariosFiltrados = usuarios.filter(u =>
        u.nome.toLowerCase().includes(termoBusca.toLowerCase())
    );

    const permissoesBase = (usuario) => {
        const base = new Set();
        (usuario.tipos || []).forEach(tipo => {
            const chave = tipo === 'administrador' ? 'admin' : tipo;
            (permissoesPorTipo[chave] || []).forEach(p => base.add(p));
        });
        return base;
    };

    const selecionarUsuario = (usuario) => {
        setUsuarioSelecionado(usuario);
        setPermissoesAlteradas(false);
        // Inicializa o estado de checkboxes com as permissões individuais (não as de tipo)
        const base = permissoesBase(usuario);
        const state = {};
        (usuario.permissoes || usuario.permissoes_totais || []).forEach(p => {
            if (!base.has(p)) state[p] = true;
        });
        setCheckboxState(state);
    };

    const handleCheckboxChange = (permissaoId, checked) => {
        setCheckboxState(prev => ({ ...prev, [permissaoId]: checked }));
        setPermissoesAlteradas(true);
    };

    const mostrarFeedback = (tipo, texto) => {
        setFeedbackMsg({ tipo, texto });
        setTimeout(() => setFeedbackMsg(null), 4000);
    };

    const handleSalvar = async () => {
        if (!usuarioSelecionado || !permissoesAlteradas) return;
        setSalvando(true);
        try {
            const permissoesIndividuais = Object.entries(checkboxState)
                .filter(([, v]) => v)
                .map(([k]) => k);

            const r = await fetchAuth('/api/usuarios', {
                method: 'PUT',
                body: JSON.stringify({ id: usuarioSelecionado.id, permissoes: permissoesIndividuais }),
            });
            if (!r.ok) {
                const err = await r.json();
                throw new Error(err.error || 'Erro ao salvar');
            }
            const usuarioAtualizado = await r.json();
            // Atualiza o cache local
            setUsuarios(prev => prev.map(u => u.id === usuarioAtualizado.id
                ? { ...u, ...usuarioAtualizado, permissoes: usuarioAtualizado.permissoes_totais || usuarioAtualizado.permissoes || [] }
                : u
            ));
            const usuarioRefresh = {
                ...usuarioAtualizado,
                permissoes: usuarioAtualizado.permissoes_totais || usuarioAtualizado.permissoes || [],
            };
            setUsuarioSelecionado(usuarioRefresh);
            // Re-inicializa o estado de checkboxes com os dados atualizados
            const base = permissoesBase(usuarioRefresh);
            const state = {};
            (usuarioRefresh.permissoes || []).forEach(p => {
                if (!base.has(p)) state[p] = true;
            });
            setCheckboxState(state);
            setPermissoesAlteradas(false);
            mostrarFeedback('sucesso', 'Permissões salvas com sucesso!');
        } catch (e) {
            mostrarFeedback('erro', e.message || 'Erro ao salvar permissões.');
        } finally {
            setSalvando(false);
        }
    };

    return (
        <>

            {/* Feedback flutuante */}
            {feedbackMsg && (
                <div className={`pu-feedback pu-feedback--${feedbackMsg.tipo}`}>
                    <i className={`fas fa-${feedbackMsg.tipo === 'sucesso' ? 'check-circle' : 'exclamation-circle'}`}></i>
                    {feedbackMsg.texto}
                </div>
            )}

            {carregando ? (
                <UICarregando variante="bloco" />
            ) : (
                <div className="pu-dois-paineis">
                    {/* Painel esquerdo: lista de usuários */}
                    <div className="pu-painel-usuarios">
                        <h3 className="pu-painel-titulo">Selecione um Usuário</h3>
                        <input
                            type="text"
                            className="pu-busca-input"
                            placeholder="Buscar por nome..."
                            value={termoBusca}
                            onChange={e => setTermoBusca(e.target.value)}
                        />
                        <ul className="pu-lista-usuarios">
                            {usuariosFiltrados.length === 0 && (
                                <li className="pu-lista-vazia">Nenhum usuário encontrado.</li>
                            )}
                            {usuariosFiltrados.map(u => (
                                <li
                                    key={u.id}
                                    className={`pu-usuario-item${usuarioSelecionado?.id === u.id ? ' ativo' : ''}`}
                                    onClick={() => selecionarUsuario(u)}
                                >
                                    <span className="pu-usuario-nome">{u.nome}</span>
                                    <span className="pu-usuario-tipo">{(u.tipos || []).join(', ')}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Painel direito: acordeão de permissões */}
                    <div className="pu-painel-permissoes">
                        {!usuarioSelecionado ? (
                            <div className="pu-sem-selecao">
                                <i className="fas fa-user-shield"></i>
                                <p>Selecione um usuário para editar suas permissões.</p>
                            </div>
                        ) : (
                            <>
                                <h3 className="pu-painel-titulo">
                                    Editando: <strong>{usuarioSelecionado.nome}</strong>
                                </h3>
                                <PermissoesAcordiao
                                    usuario={usuarioSelecionado}
                                    checkboxState={checkboxState}
                                    onChange={handleCheckboxChange}
                                    permissoesBase={permissoesBase(usuarioSelecionado)}
                                />
                                <div className="pu-rodape-acoes">
                                    <button
                                        className="gs-btn gs-btn-primario"
                                        onClick={handleSalvar}
                                        disabled={!permissoesAlteradas || salvando}
                                    >
                                        {salvando
                                            ? <><i className="fas fa-spinner fa-spin"></i> Salvando...</>
                                            : <><i className="fas fa-save"></i> Salvar Permissões</>
                                        }
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
