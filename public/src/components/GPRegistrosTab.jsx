import React, { useState, useEffect, useMemo, useRef } from 'react';
import UICarregando from './UICarregando.jsx';
import GPCard from './GPCard.jsx';
import GPEditarModal from './GPEditarModal.jsx';
import GPExcluirModal from './GPExcluirModal.jsx';
import GPSolicitarExclusaoModal from './GPSolicitarExclusaoModal.jsx';
import { temPermissao } from '../utils/bloqueio.js';

const LIMIT = 15;

function fetchAuth(url, opts = {}) {
    const token = localStorage.getItem('token');
    return fetch(url, {
        ...opts,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(opts.headers || {}),
        },
    });
}

function getIniciais(nome) {
    if (!nome) return '?';
    const partes = nome.trim().split(/\s+/);
    if (partes.length === 1) return partes[0].substring(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function toLocalDate(d) {
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dy}`;
}

function getDatasAtalho(atalho) {
    const hoje = new Date();
    const hojeStr = toLocalDate(hoje);
    switch (atalho) {
        case 'hoje':
            return { inicio: hojeStr, fim: hojeStr };
        case 'semana': {
            const dom = new Date(hoje);
            dom.setDate(hoje.getDate() - hoje.getDay());
            return { inicio: toLocalDate(dom), fim: hojeStr };
        }
        case 'mes': {
            const prim = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
            return { inicio: toLocalDate(prim), fim: hojeStr };
        }
        case 'ultimos3dias':
        default: {
            const d = new Date(hoje);
            d.setDate(hoje.getDate() - 3);
            return { inicio: toLocalDate(d), fim: hojeStr };
        }
    }
}

const ATALHOS = [
    { id: 'hoje',         label: 'Hoje'           },
    { id: 'ultimos3dias', label: 'Últimos 3 dias' },
    { id: 'semana',       label: 'Esta semana'    },
    { id: 'mes',          label: 'Este mês'       },
];

const inicial = getDatasAtalho('hoje');

export default function GPRegistrosTab() {
    const [funcionarios, setFuncionarios]     = useState([]);
    const [carregandoFuncs, setCarregandoFuncs] = useState(true);

    // Estado unificado de filtros — qualquer mudança dispara useEffect
    const [filtros, setFiltros] = useState({
        atalhoAtivo:       'hoje',
        dataInicio:        inicial.inicio,
        dataFim:           inicial.fim,
        funcsSelecionados: new Set(),
        opBusca:           '',
        order:             'data_desc',
    });
    const [opInput, setOpInput] = useState(''); // estado local do input (antes do debounce)
    const [pagina, setPagina]   = useState(1);

    // Resultados
    const [producoes, setProducoes]       = useState([]);
    const [total, setTotal]               = useState(0);
    const [totalPaginas, setTotalPaginas] = useState(0);
    const [carregando, setCarregando]     = useState(true);
    const [pendentesIds, setPendentesIds] = useState(new Set());

    // Modais
    const [editando, setEditando]     = useState(null);
    const [excluindo, setExcluindo]   = useState(null);
    const [solicitando, setSolicitando] = useState(null);

    const podeEditar        = temPermissao('editar-registro-producao');
    const podeExcluirDireto = temPermissao('excluir-registro-producao-direto');
    const podeSolicitar     = temPermissao('excluir-registro-producao');

    const opTimerRef = useRef(null);

    // Carrega lista de funcionários ativos uma vez
    useEffect(() => {
        fetchAuth('/api/gerenciar-producao/funcionarios-ativos')
            .then(r => r.json())
            .then(data => setFuncionarios(Array.isArray(data) ? data : []))
            .catch(e => console.error('[GPRegistrosTab] Erro ao buscar funcionários:', e))
            .finally(() => setCarregandoFuncs(false));
    }, []);

    // Mapa id → funcionário para lookup rápido nos cards
    const funcMap = useMemo(() => {
        const m = new Map();
        funcionarios.forEach(f => m.set(f.id, f));
        return m;
    }, [funcionarios]);

    // Busca produções sempre que filtros ou página mudam
    useEffect(() => {
        let cancelado = false;
        const carregar = async () => {
            setCarregando(true);
            try {
                const params = new URLSearchParams({ page: pagina, limit: LIMIT });

                if (filtros.funcsSelecionados.size > 0) {
                    params.set('funcionario_ids', [...filtros.funcsSelecionados].join(','));
                }
                if (filtros.dataInicio) params.set('data_inicio', filtros.dataInicio);
                if (filtros.dataFim)    params.set('data_fim',    filtros.dataFim);
                if (filtros.opBusca.trim()) params.set('op_numero_busca', filtros.opBusca.trim());
                params.set('order', filtros.order);

                const res  = await fetchAuth(`/api/producoes?${params}`);
                const data = await res.json();

                if (!cancelado) {
                    setProducoes(data.rows || []);
                    setTotal(data.total || 0);
                    setTotalPaginas(data.totalPaginas || 0);
                }
            } catch (e) {
                if (!cancelado) console.error('[GPRegistrosTab] Erro ao buscar produções:', e);
            } finally {
                if (!cancelado) setCarregando(false);
            }
        };
        carregar();
        return () => { cancelado = true; };
    }, [filtros, pagina]);

    // ── Handlers de filtro ──────────────────────────────────────────────────

    const handleAtalho = (atalhoId) => {
        const datas = getDatasAtalho(atalhoId);
        setFiltros(prev => ({ ...prev, atalhoAtivo: atalhoId, dataInicio: datas.inicio, dataFim: datas.fim }));
        setPagina(1);
        setPendentesIds(new Set());
    };

    const handleDataInicio = (e) => {
        const val = e.target.value;
        setFiltros(prev => ({ ...prev, dataInicio: val, atalhoAtivo: null }));
        setPagina(1);
        setPendentesIds(new Set());
    };

    const handleDataFim = (e) => {
        const val = e.target.value;
        setFiltros(prev => ({ ...prev, dataFim: val, atalhoAtivo: null }));
        setPagina(1);
        setPendentesIds(new Set());
    };

    const handleOpInput = (e) => {
        const val = e.target.value;
        setOpInput(val);
        clearTimeout(opTimerRef.current);
        opTimerRef.current = setTimeout(() => {
            setFiltros(prev => ({ ...prev, opBusca: val }));
            setPagina(1);
            setPendentesIds(new Set());
        }, 400);
    };

    const handleToggleFunc = (funcId) => {
        setFiltros(prev => {
            const novoSet = new Set(prev.funcsSelecionados);
            if (funcId === 'todos') {
                novoSet.clear();
            } else if (novoSet.has(funcId)) {
                novoSet.delete(funcId);
            } else {
                novoSet.add(funcId);
            }
            return { ...prev, funcsSelecionados: novoSet };
        });
        setPagina(1);
        setPendentesIds(new Set());
    };

    const handleOrder = (e) => {
        setFiltros(prev => ({ ...prev, order: e.target.value }));
        setPagina(1);
    };

    // ── Handlers de modal ───────────────────────────────────────────────────

    const handleSalvarEdicao = (producaoAtualizada) => {
        setProducoes(prev => prev.map(p => p.id === producaoAtualizada.id ? { ...p, ...producaoAtualizada } : p));
        setEditando(null);
    };

    const handleConfirmarExclusao = (producaoId) => {
        const novas = producoes.filter(p => p.id !== producaoId);
        setProducoes(novas);
        setTotal(prev => prev - 1);
        setExcluindo(null);
        if (novas.length === 0 && pagina > 1) setPagina(pagina - 1);
        else if (novas.length === 0) setFiltros(prev => ({ ...prev })); // força re-fetch
    };

    const handleSolicitacaoEnviada = (producaoId) => {
        setPendentesIds(prev => new Set([...prev, producaoId]));
        setSolicitando(null);
    };

    // ── Render ──────────────────────────────────────────────────────────────

    return (
        <>
            {/* Painel de filtros */}
            <div className="gp-filtros-painel">

                {/* Linha 1: atalhos rápidos */}
                <div className="gp-filtros-linha1">
                    <div className="gp-atalhos">
                        {ATALHOS.map(a => (
                            <button
                                key={a.id}
                                className={`gp-atalho-btn${filtros.atalhoAtivo === a.id ? ' ativo' : ''}`}
                                onClick={() => handleAtalho(a.id)}
                            >
                                {a.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Linha 2: busca por OP + intervalo de datas */}
                <div className="gp-filtros-linha2">
                    <div className="gp-filtro-op">
                        <i className="fas fa-file-alt"></i>
                        <input
                            type="text"
                            className="gp-input-op"
                            placeholder="Nº da OP..."
                            value={opInput}
                            onChange={handleOpInput}
                        />
                    </div>

                    <div className="gp-filtros-separador"></div>

                    <div className="gp-filtro-datas">
                        <i className="fas fa-calendar-alt"></i>
                        <input
                            type="date"
                            className="gp-input-data"
                            value={filtros.dataInicio}
                            onChange={handleDataInicio}
                        />
                        <span className="gp-datas-ate">até</span>
                        <input
                            type="date"
                            className="gp-input-data"
                            value={filtros.dataFim}
                            onChange={handleDataFim}
                        />
                    </div>
                </div>

                {/* Linha 3: chips de funcionário */}
                {!carregandoFuncs && funcionarios.length > 0 && (
                    <div className="gp-filtros-linha3">
                        <span className="gp-chips-label">Funcionário</span>
                        <div className="gp-chips">
                            <button
                                className={`gp-chip${filtros.funcsSelecionados.size === 0 ? ' ativo' : ''}`}
                                onClick={() => handleToggleFunc('todos')}
                            >
                                <div className="gp-chip-avatar gp-chip-avatar--todos">
                                    <i className="fas fa-users"></i>
                                </div>
                                <span className="gp-chip-nome">Todos</span>
                            </button>
                            {funcionarios.map(f => (
                                <button
                                    key={f.id}
                                    className={`gp-chip${filtros.funcsSelecionados.has(f.id) ? ' ativo' : ''}`}
                                    onClick={() => handleToggleFunc(f.id)}
                                >
                                    <div className={`gp-chip-avatar${f.tipos?.includes('prestador_externo') ? ' gp-chip-avatar--freelance' : ''}`}>
                                        {getIniciais(f.nome)}
                                    </div>
                                    <span className="gp-chip-nome">{f.nome.split(' ')[0]}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {carregando && <UICarregando variante="bloco" />}

            {!carregando && (
                <>
                    {producoes.length === 0 ? (
                        <div className="gp-estado-vazio">
                            <i className="fas fa-inbox"></i>
                            <p>Nenhum registro encontrado com os filtros selecionados</p>
                        </div>
                    ) : (
                        <>
                            {/* Cabeçalho dos resultados */}
                            <div className="gp-resultado-header">
                                <span className="gp-resultado-info">
                                    <strong>{total}</strong> registro{total !== 1 ? 's' : ''} · página {pagina} de {totalPaginas || 1}
                                </span>
                                <select className="gp-select-ordem" value={filtros.order} onChange={handleOrder}>
                                    <option value="data_desc">Mais recente primeiro</option>
                                    <option value="data_asc">Mais antigo primeiro</option>
                                    <option value="funcionario">Por funcionário</option>
                                    <option value="op">Por OP</option>
                                </select>
                            </div>

                            {/* Lista de cards */}
                            <div className="gp-cards-lista">
                                {producoes.map(p => {
                                    const funcData  = funcMap.get(p.funcionario_id);
                                    const isFreelance = funcData?.tipos?.includes('prestador_externo') || false;
                                    return (
                                        <GPCard
                                            key={p.id}
                                            producao={p}
                                            podeEditar={podeEditar}
                                            podeExcluirDireto={podeExcluirDireto}
                                            podeSolicitar={podeSolicitar}
                                            temPendente={pendentesIds.has(p.id)}
                                            isFreelance={isFreelance}
                                            onEditar={setEditando}
                                            onExcluir={setExcluindo}
                                            onSolicitarExclusao={setSolicitando}
                                        />
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {totalPaginas > 1 && (
                        <div className="gs-paginacao-container">
                            <button
                                className="gs-paginacao-btn"
                                disabled={pagina === 1}
                                onClick={() => setPagina(pagina - 1)}
                            >
                                Anterior
                            </button>
                            <span className="gs-paginacao-info">
                                Página {pagina} de {totalPaginas}
                            </span>
                            <button
                                className="gs-paginacao-btn"
                                disabled={pagina === totalPaginas}
                                onClick={() => setPagina(pagina + 1)}
                            >
                                Próximo
                            </button>
                        </div>
                    )}
                </>
            )}

            {editando && (
                <GPEditarModal
                    producao={editando}
                    funcionarios={funcionarios}
                    onSalvar={handleSalvarEdicao}
                    onFechar={() => setEditando(null)}
                />
            )}
            {excluindo && (
                <GPExcluirModal
                    producao={excluindo}
                    onConfirmar={handleConfirmarExclusao}
                    onFechar={() => setExcluindo(null)}
                />
            )}
            {solicitando && (
                <GPSolicitarExclusaoModal
                    producao={solicitando}
                    onEnviado={handleSolicitacaoEnviada}
                    onFechar={() => setSolicitando(null)}
                />
            )}
        </>
    );
}
