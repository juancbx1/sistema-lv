// public/src/components/IncenPontosTab.tsx
import { useState, useEffect, useCallback, useMemo } from 'react';
// @ts-expect-error popups JS legados sem declaração TypeScript
import { mostrarConfirmacao, mostrarMensagem } from '/js/utils/popups.js';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import type {
    IncenProduto,
    PontoConfig,
    PontoConfigNovaPayload,
    PontoConfigPayload,
    PontoGrupoProduto,
    PontoTipoAtividade,
} from '../utils/incentivos-types';

const TIPOS: Array<{ id: PontoTipoAtividade; label: string; cor: string }> = [
    { id: 'costura_op_costureira', label: 'Costura OP',    cor: '#3b82f6' },
    { id: 'processo_op_tiktik',    label: 'Processo OP',   cor: '#8b5cf6' },
    { id: 'arremate_tiktik',       label: 'Arremate',      cor: '#f59e0b' },
];

function fetchApi<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = localStorage.getItem('token');
    return fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...options,
    }).then(async res => {
        const data = await res.json() as T & { error?: string };
        if (!res.ok) throw new Error((data as { error?: string }).error || `Erro ${res.status}`);
        return data as T;
    });
}

function labelTipo(id: string): string {
    return TIPOS.find(t => t.id === id)?.label || id;
}

function corTipo(id: string): string {
    return TIPOS.find(t => t.id === id)?.cor || '#6b7280';
}

// ── Toggle ativo ──────────────────────────────────────────────────────────────

function ToggleAtivo({
    ativo,
    onChange,
    disabled,
}: {
    ativo: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            className={`incen-mini-toggle ${ativo ? 'on' : 'off'}`}
            onClick={() => !disabled && onChange(!ativo)}
            disabled={disabled}
            title={ativo ? 'Ativo' : 'Inativo'}
        >
            <span className="incen-mini-toggle-knob" />
            <span className="incen-mini-toggle-label">{ativo ? 'Ativo' : 'Inativo'}</span>
        </button>
    );
}

// ── Linha de configuração existente ──────────────────────────────────────────

function ConfigRow({
    config,
    onSalvar,
    onExcluir,
}: {
    config: PontoConfig;
    onSalvar: (id: number, payload: PontoConfigPayload) => Promise<void>;
    onExcluir: (config: PontoConfig) => void;
}) {
    const [pontos, setPontos]   = useState(parseFloat(String(config.pontos_padrao)).toFixed(2));
    const [ativo, setAtivo]     = useState(config.ativo);
    const [salvando, setSalvando] = useState(false);

    const mudou = parseFloat(pontos) !== parseFloat(String(config.pontos_padrao)) || ativo !== config.ativo;

    async function handleSalvar() {
        setSalvando(true);
        try {
            await onSalvar(config.id, { pontos_padrao: parseFloat(pontos), ativo });
        } finally {
            setSalvando(false);
        }
    }

    return (
        <div className={`incen-config-row${mudou ? ' incen-config-row--mudou' : ''}`}>
            <span
                className="incen-config-tipo-chip"
                style={{ ['--chip-cor' as string]: corTipo(config.tipo_atividade) }}
            >
                {labelTipo(config.tipo_atividade)}
            </span>
            <span className="incen-config-processo">{config.processo_nome}</span>
            <div className="incen-config-pontos-wrap">
                <input
                    className="incen-config-pontos-input"
                    type="number"
                    step="0.01"
                    value={pontos}
                    onChange={e => setPontos(e.target.value)}
                />
                <span className="incen-config-pontos-sufixo">pts</span>
            </div>
            <ToggleAtivo ativo={ativo} onChange={setAtivo} />
            <div className="incen-config-acoes">
                <button
                    className={`incen-regra-btn incen-regra-btn--salvar${mudou ? ' ativo' : ''}`}
                    onClick={() => void handleSalvar()}
                    disabled={salvando || !mudou}
                    title="Salvar"
                >
                    {salvando ? <UICarregando variante="inline" /> : <i className="fas fa-save" />}
                </button>
                <button
                    className="incen-regra-btn incen-regra-btn--excluir"
                    onClick={() => onExcluir(config)}
                    title="Excluir"
                >
                    <i className="fas fa-trash" />
                </button>
            </div>
        </div>
    );
}

// ── Formulário de nova config (dentro de um produto) ─────────────────────────

function NovaConfigForm({
    produto,
    onSalvar,
    onCancelar,
}: {
    produto: IncenProduto;
    onSalvar: (dados: PontoConfigNovaPayload) => Promise<void>;
    onCancelar: () => void;
}) {
    const [tipo, setTipo]       = useState<PontoTipoAtividade>('costura_op_costureira');
    const [processo, setProcesso] = useState('');
    const [pontos, setPontos]   = useState('1.00');
    const [ativo, setAtivo]     = useState(true);
    const [salvando, setSalvando] = useState(false);

    const isArremate = tipo === 'arremate_tiktik';
    const processosDisponiveis = useMemo(() => {
        if (isArremate) return [] as string[];
        return [...new Set(
            (produto?.etapas || [])
                .map(e => (typeof e === 'string' ? e : e.processo || ''))
                .filter(Boolean) as string[]
        )];
    }, [produto, tipo]);

    useEffect(() => {
        if (isArremate) setProcesso('Arremate (Config)');
        else if (processosDisponiveis.length > 0) setProcesso(processosDisponiveis[0]);
        else setProcesso('');
    }, [tipo, produto]);

    async function handleSalvar() {
        if (!isArremate && !processo) { mostrarMensagem('Selecione um processo.', 'aviso'); return; }
        if (!pontos || parseFloat(pontos) <= 0) { mostrarMensagem('Informe um valor de pontos válido.', 'aviso'); return; }
        setSalvando(true);
        try {
            await onSalvar({
                produto_id: produto.id,
                processo_nome: isArremate ? undefined : processo,
                tipo_atividade: tipo,
                pontos_padrao: parseFloat(pontos),
                ativo,
            });
        } finally {
            setSalvando(false);
        }
    }

    return (
        <div className="incen-nova-config-form">
            {/* Tipo — chips segmentados */}
            <div className="incen-nova-config-campo">
                <span className="incen-nova-config-label">Tipo</span>
                <div className="incen-tipo-chips">
                    {TIPOS.map(t => (
                        <button
                            key={t.id}
                            type="button"
                            className={`incen-tipo-chip-btn${tipo === t.id ? ' selecionado' : ''}`}
                            style={{ ['--chip-cor' as string]: t.cor }}
                            onClick={() => setTipo(t.id)}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Processo — chips das etapas do produto */}
            {!isArremate && (
                <div className="incen-nova-config-campo">
                    <span className="incen-nova-config-label">Processo</span>
                    {processosDisponiveis.length > 0 ? (
                        <div className="incen-processo-chips">
                            {processosDisponiveis.map(p => (
                                <button
                                    key={p}
                                    type="button"
                                    className={`incen-processo-chip${processo === p ? ' selecionado' : ''}`}
                                    onClick={() => setProcesso(p)}
                                >
                                    {p}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <input
                            className="incen-regra-input"
                            type="text"
                            value={processo}
                            onChange={e => setProcesso(e.target.value)}
                            placeholder="Nome do processo"
                        />
                    )}
                </div>
            )}

            {isArremate && (
                <div className="incen-nova-config-campo">
                    <span className="incen-nova-config-label">Processo</span>
                    <span className="incen-config-processo incen-metas-muted">Arremate (Config)</span>
                </div>
            )}

            {/* Pontos + ativo + ações */}
            <div className="incen-nova-config-footer">
                <div className="incen-nova-config-pts">
                    <span className="incen-nova-config-label">Pontos</span>
                    <div className="incen-regra-valor-wrap">
                        <input
                            className="incen-regra-input incen-regra-input--num"
                            type="number"
                            step="0.01"
                            value={pontos}
                            onChange={e => setPontos(e.target.value)}
                        />
                        <span className="incen-nova-config-pts-sufixo">pts</span>
                    </div>
                </div>
                <ToggleAtivo ativo={ativo} onChange={setAtivo} />
                <div className="incen-nova-config-btns">
                    <button
                        className="incen-regra-btn incen-regra-btn--salvar ativo"
                        onClick={() => void handleSalvar()}
                        disabled={salvando}
                    >
                        <i className="fas fa-check" /> Salvar
                    </button>
                    <button className="incen-regra-btn incen-regra-btn--cancelar" onClick={onCancelar}>
                        <i className="fas fa-times" />
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Grupo de produto ──────────────────────────────────────────────────────────

function GrupoProduto({
    produtoNome,
    configs,
    produto,
    filtroTipo,
    onSalvar,
    onExcluir,
    onNova,
}: {
    produtoId: number;
    produtoNome: string;
    configs: PontoConfig[];
    produto: IncenProduto | undefined;
    filtroTipo: string;
    onSalvar: (id: number, payload: PontoConfigPayload) => Promise<void>;
    onExcluir: (config: PontoConfig) => void;
    onNova: (dados: PontoConfigNovaPayload) => Promise<void>;
}) {
    const [adicionando, setAdicionando] = useState(false);
    const configsFiltradas = filtroTipo ? configs.filter(c => c.tipo_atividade === filtroTipo) : configs;

    if (configsFiltradas.length === 0 && !adicionando) return null;

    async function handleNova(dados: PontoConfigNovaPayload) {
        await onNova(dados);
        setAdicionando(false);
    }

    return (
        <div className="incen-prod-grupo">
            <div className="incen-prod-grupo-header">
                <div className="card-borda-charme" />
                <span className="incen-prod-nome">{produtoNome}</span>
                <span className="incen-prod-count">
                    {configsFiltradas.length} config{configsFiltradas.length !== 1 ? 's' : ''}
                </span>
                {!adicionando && (
                    <button className="incen-grupo-add-btn" onClick={() => setAdicionando(true)}>
                        <i className="fas fa-plus" /> Adicionar
                    </button>
                )}
            </div>

            <div className="incen-prod-configs">
                {configsFiltradas.map(c => (
                    <ConfigRow key={c.id} config={c} onSalvar={onSalvar} onExcluir={onExcluir} />
                ))}
                {adicionando && produto && (
                    <NovaConfigForm
                        produto={produto}
                        onSalvar={handleNova}
                        onCancelar={() => setAdicionando(false)}
                    />
                )}
            </div>
        </div>
    );
}

// ── Buscador de produto (para nova config global) ─────────────────────────────

function BuscaProduto({
    produtos,
    onSelecionar,
    onCancelar,
}: {
    produtos: IncenProduto[];
    onSelecionar: (p: IncenProduto) => void;
    onCancelar: () => void;
}) {
    const [busca, setBusca] = useState('');
    const filtrados = useMemo(() => {
        if (!busca.trim()) return produtos.slice(0, 20);
        const q = busca.toLowerCase();
        return produtos.filter(p => p.nome.toLowerCase().includes(q)).slice(0, 20);
    }, [produtos, busca]);

    return (
        <div className="incen-busca-produto">
            <div className="incen-busca-produto-input-wrap">
                <i className="fas fa-search incen-busca-icone" />
                <input
                    className="incen-busca-produto-input"
                    type="text"
                    placeholder="Buscar produto..."
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    autoFocus
                />
            </div>
            <div className="incen-busca-produto-lista">
                {filtrados.map(p => (
                    <button
                        key={p.id}
                        className="incen-busca-produto-item"
                        onClick={() => onSelecionar(p)}
                    >
                        {p.nome}
                    </button>
                ))}
                {filtrados.length === 0 && (
                    <UIFeedbackNotFound
                        variante="compacto"
                        icon="fa-search"
                        titulo="Nenhum produto encontrado"
                        mensagem="Tente ajustar a busca."
                    />
                )}
            </div>
            <button className="gs-btn gs-btn-secundario" onClick={onCancelar} style={{ marginTop: 4, alignSelf: 'flex-start' }}>
                <i className="fas fa-times" /> Cancelar
            </button>
        </div>
    );
}

// ── Componente principal ──────────────────────────────────────────────────────

type AddGlobalState = null | 'buscando' | IncenProduto;

export default function IncenPontosTab() {
    const [carregando, setCarregando]     = useState(true);
    const [configs, setConfigs]           = useState<PontoConfig[]>([]);
    const [produtos, setProdutos]         = useState<IncenProduto[]>([]);
    const [filtroTipo, setFiltroTipo]     = useState('');
    const [recarregando, setRecarregando] = useState(false);

    // Estado da adição global (produto ainda não tem configs)
    const [addGlobalState, setAddGlobalState] = useState<AddGlobalState>(null);

    const buscarConfigs = useCallback(async () => {
        setRecarregando(true);
        try {
            const data = await fetchApi<PontoConfig[]>('/api/configuracao-pontos/padrao');
            setConfigs(data);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro ao carregar: ${msg}`, 'erro');
        } finally {
            setRecarregando(false);
        }
    }, []);

    useEffect(() => {
        async function init() {
            try {
                const [ps, cs] = await Promise.all([
                    fetchApi<IncenProduto[]>('/api/produtos'),
                    fetchApi<PontoConfig[]>('/api/configuracao-pontos/padrao'),
                ]);
                setProdutos(Array.isArray(ps) ? ps.filter(p => !p.is_kit) : []);
                setConfigs(cs);
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Erro';
                mostrarMensagem(`Erro ao carregar: ${msg}`, 'erro');
            } finally {
                setCarregando(false);
            }
        }
        void init();
    }, []);

    // Agrupar configs por produto
    const grupos = useMemo(() => {
        const map: Record<number, PontoGrupoProduto> = {};
        configs.forEach(c => {
            if (!map[c.produto_id]) map[c.produto_id] = {
                produto_nome: c.produto_nome,
                produto_id: c.produto_id,
                configs: [],
            };
            map[c.produto_id].configs.push(c);
        });
        return Object.values(map).sort((a, b) => a.produto_nome.localeCompare(b.produto_nome));
    }, [configs]);

    async function handleSalvar(id: number, payload: PontoConfigPayload) {
        try {
            const atualizado = await fetchApi<PontoConfig>(`/api/configuracao-pontos/padrao/${id}`, {
                method: 'PUT', body: JSON.stringify(payload),
            });
            setConfigs(prev => prev.map(c => c.id === id ? { ...c, ...atualizado } : c));
            mostrarMensagem('Configuração salva!', 'sucesso');
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        }
    }

    async function handleExcluir(config: PontoConfig) {
        const ok = await mostrarConfirmacao(
            `Excluir "${config.produto_nome} — ${config.processo_nome}"?`, 'perigo'
        );
        if (!ok) return;
        try {
            await fetchApi(`/api/configuracao-pontos/padrao/${config.id}`, { method: 'DELETE' });
            setConfigs(prev => prev.filter(c => c.id !== config.id));
            mostrarMensagem('Excluído.', 'sucesso');
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        }
    }

    async function handleNovaSalvar(dados: PontoConfigNovaPayload) {
        try {
            await fetchApi('/api/configuracao-pontos/padrao', {
                method: 'POST', body: JSON.stringify(dados),
            });
            await buscarConfigs();
            mostrarMensagem('Configuração criada!', 'sucesso');
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        }
    }

    if (carregando) return <UICarregando variante="bloco" />;

    const produtoSelecionadoParaAdd = addGlobalState && addGlobalState !== 'buscando'
        ? produtos.find(p => p.id === addGlobalState.id) || addGlobalState
        : null;

    return (
        <div className="gs-card">
            {/* ── Filtros de tipo + botão adicionar ── */}
            <div className="incen-pontos-toolbar">
                <div className="incen-tipo-filtros">
                    <button
                        className={`incen-subfiltro-btn${!filtroTipo ? ' ativo' : ''}`}
                        onClick={() => setFiltroTipo('')}
                    >
                        Todos
                    </button>
                    {TIPOS.map(t => (
                        <button
                            key={t.id}
                            className={`incen-subfiltro-btn${filtroTipo === t.id ? ' ativo' : ''}`}
                            style={filtroTipo === t.id ? { background: t.cor, borderColor: t.cor } : {}}
                            onClick={() => setFiltroTipo(prev => prev === t.id ? '' : t.id)}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
                {!addGlobalState && (
                    <button
                        className="gs-btn gs-btn-primario"
                        onClick={() => setAddGlobalState('buscando')}
                    >
                        <i className="fas fa-plus" /> Nova Configuração
                    </button>
                )}
            </div>

            {/* ── Formulário global de adição ── */}
            {addGlobalState === 'buscando' && (
                <div className="gs-card gs-card--compacto" style={{ marginBottom: 0 }}>
                    <p className="incen-nova-config-titulo">
                        <i className="fas fa-search" /> Para qual produto?
                    </p>
                    <BuscaProduto
                        produtos={produtos}
                        onSelecionar={p => setAddGlobalState(p)}
                        onCancelar={() => setAddGlobalState(null)}
                    />
                </div>
            )}

            {produtoSelecionadoParaAdd && (
                <div className="gs-card gs-card--compacto" style={{ marginBottom: 0 }}>
                    <p className="incen-nova-config-titulo">
                        <i className="fas fa-plus" /> Nova configuração — <strong>{produtoSelecionadoParaAdd.nome}</strong>
                    </p>
                    <NovaConfigForm
                        produto={produtoSelecionadoParaAdd}
                        onSalvar={async dados => {
                            await handleNovaSalvar(dados);
                            setAddGlobalState(null);
                        }}
                        onCancelar={() => setAddGlobalState(null)}
                    />
                </div>
            )}

            {/* ── Lista agrupada por produto ── */}
            {recarregando ? (
                <UICarregando variante="bloco" />
            ) : grupos.length === 0 ? (
                <UIFeedbackNotFound
                    variante="compacto"
                    icon="fa-star"
                    titulo="Nenhuma configuração encontrada"
                    mensagem={'Clique em “Nova Configuração” para começar.'}
                />
            ) : (
                <div className="incen-prod-grupos-lista">
                    {grupos.map(g => (
                        <GrupoProduto
                            key={g.produto_id}
                            produtoId={g.produto_id}
                            produtoNome={g.produto_nome}
                            configs={g.configs}
                            produto={produtos.find(p => p.id === g.produto_id)}
                            filtroTipo={filtroTipo}
                            onSalvar={handleSalvar}
                            onExcluir={(c) => void handleExcluir(c)}
                            onNova={handleNovaSalvar}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
