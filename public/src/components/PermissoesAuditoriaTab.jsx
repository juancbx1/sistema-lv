import React, { useState, useEffect, useCallback } from 'react';
import Select from 'react-select';
import UICarregando from './UICarregando.jsx';

function fetchAuth(url, opts = {}) {
    const token = localStorage.getItem('token');
    return fetch(url, {
        ...opts,
        headers: { 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) },
    });
}

const OPCOES_ACAO = [
    { value: '', label: 'Todas as ações' },
    { value: 'op.encerrada', label: 'OP: Encerrada' },
    { value: 'op.cancelada', label: 'OP: Cancelada' },
    { value: 'op.gerada_do_estoque', label: 'OP: Gerada do Estoque' },
    { value: 'producao.lancada', label: 'Produção: Lançada' },
    { value: 'producao.excluida', label: 'Produção: Excluída' },
    { value: 'producao.editada', label: 'Produção: Editada' },
    { value: 'corte.registrado', label: 'Corte: Registrado' },
    { value: 'arremate.lancado', label: 'Arremate: Lançado' },
    { value: 'arremate.estornado', label: 'Arremate: Estornado' },
    { value: 'permissoes.alteradas', label: 'Permissões: Alteradas' },
    { value: 'tarefa_freelance.atribuida', label: 'Tarefa Freelance: Atribuída' },
];

function descreverAcao(log) {
    const d = log.detalhes || {};
    const mapa = {
        'op.encerrada':               () => `encerrou a OP #${log.entidade_id}`,
        'op.cancelada':               () => `cancelou a OP #${log.entidade_id}`,
        'op.gerada_do_estoque':       () => `gerou a OP #${log.entidade_id} do estoque de cortes`,
        'op.criada':                  () => `criou a OP #${log.entidade_id}`,
        'producao.lancada':           () => `lançou ${d.quantidade} peças de produção para ${d.funcionario_nome} (${d.etapa_processo})`,
        'producao.excluida':          () => `excluiu ${d.quantidade} peças de produção de ${d.funcionario_nome}`,
        'producao.editada':           () => `editou produção de ${d.funcionario_nome}: ${d.quantidade_antes} → ${d.quantidade_depois} peças`,
        'corte.registrado':           () => `registrou o corte PC${log.entidade_id} (${d.quantidade} unidades)`,
        'arremate.lancado':           () => `lançou ${d.quantidade} arremates para ${d.funcionario_nome} — OP #${d.op_numero}`,
        'arremate.estornado':         () => `estornou arremate da OP #${d.op_numero}`,
        'permissoes.alteradas':       () => `alterou as permissões de ${d.usuario_alvo_nome}`,
        'tarefa_freelance.atribuida': () => `atribuiu tarefa de ${d.etapa} para freelance (${d.tipo}) — OP #${d.op_numero}`,
    };
    return mapa[log.acao]?.() ?? log.acao;
}

function tempoRelativo(isoDate) {
    const diff = Date.now() - new Date(isoDate).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'agora mesmo';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h}h`;
    const d = Math.floor(h / 24);
    return `há ${d}d`;
}

function iniciais(nome) {
    if (!nome) return '?';
    const partes = nome.trim().split(' ');
    if (partes.length === 1) return partes[0][0].toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export default function PermissoesAuditoriaTab() {
    const [logs, setLogs]             = useState([]);
    const [total, setTotal]           = useState(0);
    const [pagina, setPagina]         = useState(1);
    const [carregando, setCarregando] = useState(false);
    const [carregandoMais, setCarregandoMais] = useState(false);
    const [usuariosOpcoes, setUsuariosOpcoes] = useState([]);
    const [logExpandido, setLogExpandido] = useState(null);

    const [filtros, setFiltros] = useState({
        usuario_id: '',
        acao: '',
        data_inicio: '',
        data_fim: '',
    });

    const buscarUsuarios = useCallback(async () => {
        try {
            const r = await fetchAuth('/api/audit-log/usuarios');
            if (!r.ok) return;
            const data = await r.json();
            setUsuariosOpcoes([
                { value: '', label: 'Todos os usuários' },
                ...data.map(u => ({ value: String(u.usuario_id), label: u.usuario_nome })),
            ]);
        } catch { /* silencioso */ }
    }, []);

    const buscarLogs = useCallback(async (paginaParam = 1, acumulando = false) => {
        if (acumulando) setCarregandoMais(true);
        else setCarregando(true);

        try {
            const params = new URLSearchParams({ page: paginaParam, limit: 50 });
            if (filtros.usuario_id) params.append('usuario_id', filtros.usuario_id);
            if (filtros.acao) params.append('acao', filtros.acao);
            if (filtros.data_inicio) params.append('data_inicio', filtros.data_inicio);
            if (filtros.data_fim) {
                // data_fim é exclusivo — adiciona 1 dia para incluir o dia selecionado
                const fim = new Date(filtros.data_fim);
                fim.setDate(fim.getDate() + 1);
                params.append('data_fim', fim.toISOString().split('T')[0]);
            }

            const r = await fetchAuth(`/api/audit-log?${params}`);
            if (!r.ok) throw new Error('Erro ao buscar logs');
            const data = await r.json();

            setLogs(prev => acumulando ? [...prev, ...data.logs] : data.logs);
            setTotal(data.total);
            setPagina(paginaParam);
        } catch {
            if (!acumulando) setLogs([]);
        } finally {
            setCarregando(false);
            setCarregandoMais(false);
        }
    }, [filtros]);

    useEffect(() => {
        buscarUsuarios();
    }, [buscarUsuarios]);

    useEffect(() => {
        buscarLogs(1, false);
    }, [buscarLogs]);

    const handleFiltroChange = (campo, valor) => {
        setFiltros(prev => ({ ...prev, [campo]: valor }));
    };

    const limparFiltros = () => {
        setFiltros({ usuario_id: '', acao: '', data_inicio: '', data_fim: '' });
    };

    const carregarMais = () => buscarLogs(pagina + 1, true);

    const temMais = logs.length < total;

    return (
        <>
            {/* Filtros */}
            <div className="pu-audit-filtros">
                <div className="pu-audit-filtro-grupo">
                    <label>Usuário</label>
                    <Select
                        options={usuariosOpcoes}
                        value={usuariosOpcoes.find(o => o.value === filtros.usuario_id) || null}
                        onChange={opt => handleFiltroChange('usuario_id', opt?.value || '')}
                        placeholder="Todos os usuários"
                        classNamePrefix="pu-select"
                        isClearable
                    />
                </div>
                <div className="pu-audit-filtro-grupo">
                    <label>Ação</label>
                    <Select
                        options={OPCOES_ACAO}
                        value={OPCOES_ACAO.find(o => o.value === filtros.acao) || null}
                        onChange={opt => handleFiltroChange('acao', opt?.value || '')}
                        placeholder="Todas as ações"
                        classNamePrefix="pu-select"
                        isClearable
                    />
                </div>
                <div className="pu-audit-filtro-grupo">
                    <label>De</label>
                    <input
                        type="date"
                        className="pu-audit-input-data"
                        value={filtros.data_inicio}
                        onChange={e => handleFiltroChange('data_inicio', e.target.value)}
                    />
                </div>
                <div className="pu-audit-filtro-grupo">
                    <label>Até</label>
                    <input
                        type="date"
                        className="pu-audit-input-data"
                        value={filtros.data_fim}
                        onChange={e => handleFiltroChange('data_fim', e.target.value)}
                    />
                </div>
                <button className="gs-btn gs-btn-secundario pu-audit-btn-limpar" onClick={limparFiltros}>
                    <i className="fas fa-times"></i> Limpar
                </button>
            </div>

            {/* Lista de logs */}
            {carregando ? (
                <UICarregando variante="bloco" />
            ) : logs.length === 0 ? (
                <div className="pu-audit-vazio">
                    <i className="fas fa-history"></i>
                    <p>Nenhum evento de auditoria encontrado.</p>
                </div>
            ) : (
                <>
                    <div className="pu-audit-total">{total} evento{total !== 1 ? 's' : ''} encontrado{total !== 1 ? 's' : ''}</div>
                    <ul className="pu-audit-lista">
                        {logs.map(log => (
                            <li key={log.id} className="pu-audit-item">
                                <div className="pu-audit-avatar">{iniciais(log.usuario_nome)}</div>
                                <div className="pu-audit-corpo">
                                    <div className="pu-audit-linha-principal">
                                        <span className="pu-audit-nome">{log.usuario_nome}</span>
                                        <span className="pu-audit-descricao">{descreverAcao(log)}</span>
                                        <span className="pu-audit-tempo">{tempoRelativo(log.criado_em)}</span>
                                    </div>
                                    <div className="pu-audit-linha-detalhes">
                                        <button
                                            className="pu-audit-btn-detalhes"
                                            onClick={() => setLogExpandido(logExpandido === log.id ? null : log.id)}
                                        >
                                            {logExpandido === log.id ? '▾ ocultar' : '▸ ver detalhes'}
                                        </button>
                                    </div>
                                    {logExpandido === log.id && (
                                        <div className="pu-audit-detalhes-json">
                                            {Object.entries(log.detalhes || {}).map(([k, v]) => (
                                                <div key={k} className="pu-audit-detalhe-linha">
                                                    <span className="pu-audit-detalhe-chave">{k}:</span>
                                                    <span className="pu-audit-detalhe-valor">
                                                        {Array.isArray(v) ? v.join(', ') || '—' : String(v ?? '—')}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>

                    {temMais && (
                        <div className="pu-audit-carregar-mais">
                            <button
                                className="gs-btn gs-btn-secundario"
                                onClick={carregarMais}
                                disabled={carregandoMais}
                            >
                                {carregandoMais
                                    ? <><i className="fas fa-spinner fa-spin"></i> Carregando...</>
                                    : `Carregar mais (${total - logs.length} restantes)`
                                }
                            </button>
                        </div>
                    )}
                </>
            )}
        </>
    );
}
