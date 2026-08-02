// public/src/components/IncenMetasTab.tsx
import { useState, useEffect, useMemo, type FormEvent } from 'react';
// @ts-expect-error popups JS legados sem declaração TypeScript
import { mostrarConfirmacao, mostrarMensagem } from '/js/utils/popups.js';
import UICarregando from './UICarregando';
import type {
    IncenProduto,
    MetaCondicao,
    MetaGrupoRegras,
    MetaNovaVersaoPayload,
    MetaRegra,
    MetaRegraNovaPayload,
    MetaRegraPayload,
    MetaVersao,
    MetaVersaoStatus,
} from '../utils/incentivos-types';

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

type MetaVersaoComStatus = MetaVersao & { status: MetaVersaoStatus };

function derivarStatusVersao(versoes: MetaVersao[]): MetaVersaoComStatus[] {
    const hojeStr = new Date().toISOString().split('T')[0];
    const ativasOuPassadas = versoes.filter(v => v.data_inicio_vigencia.split('T')[0] <= hojeStr);
    const versaoAtiva = ativasOuPassadas.length > 0
        ? ativasOuPassadas.sort((a, b) =>
            new Date(b.data_inicio_vigencia).getTime() - new Date(a.data_inicio_vigencia).getTime()
        )[0]
        : null;
    return versoes.map(v => {
        const dataStr = v.data_inicio_vigencia.split('T')[0];
        const status: MetaVersaoStatus = dataStr > hojeStr ? 'futura'
            : versaoAtiva && v.id === versaoAtiva.id ? 'ativa'
            : 'arquivada';
        return { ...v, status };
    });
}

function formatarData(dataIso: string): string {
    const [ano, mes, dia] = dataIso.split('T')[0].split('-').map(Number);
    return new Date(ano, mes - 1, dia).toLocaleDateString('pt-BR');
}

function labelTipoUsuario(tipo: string): string {
    return tipo === 'costureira' ? 'Costureira' : tipo === 'tiktik' ? 'Tiktik' : tipo;
}

// ── Chip de versão ────────────────────────────────────────────────────────────

function VersaoChip({
    versao,
    selecionada,
    onClick,
}: {
    versao: MetaVersaoComStatus;
    selecionada: boolean;
    onClick: () => void;
}) {
    const cls = versao.status === 'ativa' ? 'ativa'
              : versao.status === 'futura' ? 'futura'
              : 'arquivo';
    return (
        <button
            className={`incen-v-chip incen-v-chip--${cls}${selecionada ? ' incen-v-chip--sel' : ''}`}
            onClick={onClick}
        >
            {versao.status === 'ativa'     && <span className="incen-v-chip-dot" />}
            {versao.status === 'futura'    && <i className="fas fa-clock" />}
            {versao.status === 'arquivada' && <i className="fas fa-box-archive" />}
            <span className="incen-v-chip-nome">{versao.nome_versao}</span>
            <span className="incen-v-chip-data">{formatarData(versao.data_inicio_vigencia)}</span>
        </button>
    );
}

// ── Card de regra (editável) ──────────────────────────────────────────────────

function RegraCard({
    regra,
    editavel,
    onSalvar,
    onExcluir,
    onAbrirCondicoes,
}: {
    regra: MetaRegra;
    editavel: boolean;
    onSalvar: (id: number, payload: MetaRegraPayload) => Promise<void>;
    onExcluir: (regra: MetaRegra) => void;
    onAbrirCondicoes: (regra: MetaRegra) => void;
}) {
    const [desc, setDesc]       = useState(regra.descricao_meta);
    const [pontos, setPontos]   = useState(String(regra.pontos_meta));
    const [comissao, setComissao] = useState(parseFloat(String(regra.valor_comissao)).toFixed(2));
    const [salvando, setSalvando] = useState(false);

    const mudou = desc !== regra.descricao_meta
        || Number(pontos) !== Number(regra.pontos_meta)
        || parseFloat(comissao) !== parseFloat(String(regra.valor_comissao));

    async function handleSalvar() {
        setSalvando(true);
        try {
            await onSalvar(regra.id, {
                descricao_meta: desc,
                pontos_meta: parseInt(pontos, 10),
                valor_comissao: parseFloat(comissao),
                condicoes: regra.condicoes || [],
            });
        } finally {
            setSalvando(false);
        }
    }

    const nCond = regra.condicoes?.length || 0;

    return (
        <div className={`incen-regra-card${mudou && editavel ? ' incen-regra-card--mudou' : ''}`}>
            <div className="card-borda-charme" />

            <div className="incen-regra-descricao">
                <input
                    className="incen-regra-input"
                    type="text"
                    value={desc}
                    onChange={e => setDesc(e.target.value)}
                    disabled={!editavel}
                    placeholder="Descrição da meta"
                />
            </div>

            <div className="incen-regra-nums">
                <div className="incen-regra-num-grupo">
                    <span className="incen-regra-num-label">Pontos</span>
                    <input
                        className="incen-regra-input incen-regra-input--num"
                        type="number"
                        step="1"
                        value={pontos}
                        onChange={e => setPontos(e.target.value)}
                        disabled={!editavel}
                    />
                </div>
                <div className="incen-regra-num-grupo">
                    <span className="incen-regra-num-label">Comissão</span>
                    <div className="incen-regra-valor-wrap">
                        <span className="incen-regra-prefix">R$</span>
                        <input
                            className="incen-regra-input incen-regra-input--num"
                            type="number"
                            step="0.01"
                            value={comissao}
                            onChange={e => setComissao(e.target.value)}
                            disabled={!editavel}
                        />
                    </div>
                </div>
            </div>

            <button
                className={`incen-regra-cond-btn${nCond > 0 ? ' tem' : ''}`}
                onClick={() => onAbrirCondicoes(regra)}
                disabled={!editavel}
            >
                <i className="fas fa-tasks" />
                <span>{nCond > 0 ? `${nCond} condição${nCond > 1 ? 'ões' : ''}` : 'Condições'}</span>
            </button>

            {editavel && (
                <div className="incen-regra-btns">
                    <button
                        className={`incen-regra-btn incen-regra-btn--salvar${mudou ? ' ativo' : ''}`}
                        onClick={() => void handleSalvar()}
                        disabled={salvando || !mudou}
                        title="Salvar"
                    >
                        <i className={`fas ${salvando ? 'fa-spinner fa-spin' : 'fa-save'}`} />
                    </button>
                    <button
                        className="incen-regra-btn incen-regra-btn--excluir"
                        onClick={() => onExcluir(regra)}
                        title="Excluir"
                    >
                        <i className="fas fa-trash" />
                    </button>
                </div>
            )}
        </div>
    );
}

// ── Card de nova regra (inline) ───────────────────────────────────────────────

function NovaRegraCard({
    onSalvar,
    onCancelar,
}: {
    onSalvar: (dados: MetaRegraNovaPayload) => Promise<void>;
    onCancelar: () => void;
}) {
    const [desc, setDesc]         = useState('');
    const [pontos, setPontos]     = useState('');
    const [comissao, setComissao] = useState('');
    const [salvando, setSalvando] = useState(false);

    async function handleSalvar() {
        if (!desc.trim() || !pontos || !comissao) {
            mostrarMensagem('Preencha todos os campos.', 'aviso');
            return;
        }
        setSalvando(true);
        try {
            await onSalvar({
                descricao_meta: desc.trim(),
                pontos_meta: parseInt(pontos, 10),
                valor_comissao: parseFloat(comissao),
            });
        } finally {
            setSalvando(false);
        }
    }

    return (
        <div className="incen-regra-card incen-regra-card--nova">
            <div className="card-borda-charme" style={{ background: 'var(--gs-primaria)' }} />

            <div className="incen-regra-descricao">
                <input
                    className="incen-regra-input"
                    type="text"
                    value={desc}
                    onChange={e => setDesc(e.target.value)}
                    placeholder="Ex: Meta Ouro (Diária)"
                    autoFocus
                />
            </div>

            <div className="incen-regra-nums">
                <div className="incen-regra-num-grupo">
                    <span className="incen-regra-num-label">Pontos</span>
                    <input
                        className="incen-regra-input incen-regra-input--num"
                        type="number"
                        step="1"
                        value={pontos}
                        onChange={e => setPontos(e.target.value)}
                        placeholder="400"
                    />
                </div>
                <div className="incen-regra-num-grupo">
                    <span className="incen-regra-num-label">Comissão</span>
                    <div className="incen-regra-valor-wrap">
                        <span className="incen-regra-prefix">R$</span>
                        <input
                            className="incen-regra-input incen-regra-input--num"
                            type="number"
                            step="0.01"
                            value={comissao}
                            onChange={e => setComissao(e.target.value)}
                            placeholder="20.00"
                        />
                    </div>
                </div>
            </div>

            <span className="incen-regra-nova-hint">Condições após salvar</span>

            <div className="incen-regra-btns">
                <button
                    className="incen-regra-btn incen-regra-btn--salvar ativo"
                    onClick={() => void handleSalvar()}
                    disabled={salvando}
                >
                    <i className="fas fa-check" />
                </button>
                <button className="incen-regra-btn incen-regra-btn--cancelar" onClick={onCancelar}>
                    <i className="fas fa-times" />
                </button>
            </div>
        </div>
    );
}

// ── Grupo de regras (tipo_usuario + nivel) ────────────────────────────────────

function GrupoRegras({
    chave,
    grupo,
    editavel,
    onSalvarRegra,
    onExcluirRegra,
    onAbrirCondicoes,
    onAdicionarRegra,
}: {
    chave: string;
    grupo: MetaGrupoRegras;
    editavel: boolean;
    onSalvarRegra: (id: number, payload: MetaRegraPayload) => Promise<void>;
    onExcluirRegra: (regra: MetaRegra) => void;
    onAbrirCondicoes: (regra: MetaRegra) => void;
    onAdicionarRegra: (chave: string, dados: MetaRegraNovaPayload) => Promise<void>;
}) {
    const [adicionando, setAdicionando] = useState(false);
    const [tipo] = chave.split('-');

    return (
        <div className="incen-grupo-regras">
            <div className="incen-grupo-regras-header">
                <span className={`incen-tipo-badge incen-tipo-badge--${tipo}`}>
                    {labelTipoUsuario(tipo)}
                </span>
                <span className="incen-nivel-label">Nível {grupo.nivel}</span>
                <span className="incen-grupo-count">
                    {grupo.regras.length} regra{grupo.regras.length !== 1 ? 's' : ''}
                </span>
                {editavel && !adicionando && (
                    <button className="incen-grupo-add-btn" onClick={() => setAdicionando(true)}>
                        <i className="fas fa-plus" /> Adicionar
                    </button>
                )}
            </div>

            <div className="incen-regras-lista">
                {grupo.regras.map(r => (
                    <RegraCard
                        key={r.id}
                        regra={r}
                        editavel={editavel}
                        onSalvar={onSalvarRegra}
                        onExcluir={onExcluirRegra}
                        onAbrirCondicoes={onAbrirCondicoes}
                    />
                ))}
                {adicionando && (
                    <NovaRegraCard
                        onSalvar={async dados => { await onAdicionarRegra(chave, dados); setAdicionando(false); }}
                        onCancelar={() => setAdicionando(false)}
                    />
                )}
            </div>
        </div>
    );
}

// ── Modal Nova Versão ─────────────────────────────────────────────────────────

function ModalNovaVersao({
    versaoAtiva,
    onConfirmar,
    onFechar,
}: {
    versaoAtiva: MetaVersaoComStatus;
    onConfirmar: (payload: MetaNovaVersaoPayload) => Promise<void>;
    onFechar: () => void;
}) {
    const [nome, setNome] = useState('');
    const [data, setData] = useState(() => {
        const d = new Date();
        const diasParaDomingo = (7 - d.getDay()) % 7 || 7;
        d.setDate(d.getDate() + diasParaDomingo);
        return d.toISOString().split('T')[0];
    });
    const [salvando, setSalvando] = useState(false);

    async function handleConfirmar() {
        if (!nome.trim()) { mostrarMensagem('Informe o nome da nova versão.', 'aviso'); return; }
        setSalvando(true);
        try {
            let d = new Date(data + 'T12:00:00');
            if (d.getDay() !== 0) {
                d.setDate(d.getDate() + (7 - d.getDay()) % 7);
                mostrarMensagem(`Data ajustada para o próximo domingo: ${d.toLocaleDateString('pt-BR')}`, 'info');
            }
            await onConfirmar({
                nome_versao: nome.trim(),
                data_inicio_vigencia: d.toISOString().split('T')[0],
                id_versao_origem_clone: versaoAtiva.id,
            });
            onFechar();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        } finally {
            setSalvando(false);
        }
    }

    return (
        <div className="gs-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onFechar(); }}>
            <div className="gs-modal incen-form-modal">
                <div className="gs-modal-cabecalho">
                    <h2>Nova Versão de Metas</h2>
                    <button className="gs-btn-fechar" onClick={onFechar}><i className="fas fa-times" /></button>
                </div>
                <div className="gs-modal-corpo">
                    <p className="incen-metas-modal-desc">
                        Será criada como cópia da versão ativa <strong>"{versaoAtiva.nome_versao}"</strong>.
                        Você pode editar as regras antes de entrar em vigor.
                    </p>
                    <div className="incen-form-grupo">
                        <label className="incen-form-label">Nome da Nova Versão</label>
                        <input className="incen-form-input" type="text"
                            placeholder="Ex: Metas Junho/2026" value={nome}
                            onChange={e => setNome(e.target.value)} />
                    </div>
                    <div className="incen-form-grupo" style={{ marginTop: 12 }}>
                        <label className="incen-form-label">Data de Início da Vigência</label>
                        <input className="incen-form-input" type="date" value={data}
                            onChange={e => setData(e.target.value)} />
                        <small className="incen-metas-muted" style={{ marginTop: 4 }}>
                            Se não for domingo, será ajustado automaticamente.
                        </small>
                    </div>
                </div>
                <div className="gs-modal-rodape">
                    <button className="gs-btn gs-btn-secundario" onClick={onFechar}>Cancelar</button>
                    <button className="gs-btn gs-btn-primario" onClick={() => void handleConfirmar()} disabled={salvando}>
                        {salvando ? 'Criando...' : 'Criar e Clonar'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Modal Condições ───────────────────────────────────────────────────────────

function ModalCondicoes({
    regra,
    produtos,
    onSalvar,
    onFechar,
}: {
    regra: MetaRegra;
    produtos: IncenProduto[];
    onSalvar: (condicoes: MetaCondicao[]) => void;
    onFechar: () => void;
}) {
    const [condicoes, setCondicoes] = useState<MetaCondicao[]>([...(regra.condicoes || [])]);
    const [produtoId, setProdutoId] = useState('');
    const [qtd, setQtd]             = useState('');

    function nomeProduto(id: number) {
        return produtos.find(p => p.id === id)?.nome || `ID ${id}`;
    }

    function adicionar(e: FormEvent) {
        e.preventDefault();
        if (!produtoId || !qtd) { mostrarMensagem('Preencha produto e quantidade.', 'aviso'); return; }
        setCondicoes(prev => [...prev, {
            tipo: 'arremate_produto',
            produto_id: parseInt(produtoId, 10),
            quantidade_minima: parseInt(qtd, 10),
        }]);
        setProdutoId('');
        setQtd('');
    }

    return (
        <div className="gs-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onFechar(); }}>
            <div className="gs-modal" style={{ maxWidth: 560 }}>
                <div className="gs-modal-cabecalho">
                    <h2>Condições: "{regra.descricao_meta}"</h2>
                    <button className="gs-btn-fechar" onClick={onFechar}><i className="fas fa-times" /></button>
                </div>
                <div className="gs-modal-corpo">
                    <p className="incen-metas-modal-desc">
                        Objetivos adicionais além dos pontos.
                    </p>
                    {condicoes.length === 0 ? (
                        <p className="incen-metas-sem-condicoes">Nenhuma condição definida para esta meta.</p>
                    ) : (
                        <div className="incen-metas-condicoes-lista">
                            {condicoes.map((c, i) => (
                                <div key={i} className="incen-metas-condicao-item">
                                    <span>
                                        Arremate de <strong>{nomeProduto(c.produto_id)}</strong>: mín. <strong>{c.quantidade_minima}</strong> un/semana
                                    </span>
                                    <button className="incen-remove-btn"
                                        onClick={() => setCondicoes(prev => prev.filter((_, j) => j !== i))}>
                                        <i className="fas fa-times" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="incen-metas-nova-condicao">
                        <h4>Adicionar Objetivo</h4>
                        <form onSubmit={adicionar}>
                            <div className="incen-form-linha" style={{ alignItems: 'flex-end', gap: 10 }}>
                                <div className="incen-form-grupo" style={{ flex: 1 }}>
                                    <label className="incen-form-label">Produto</label>
                                    <select className="incen-form-input" value={produtoId} onChange={e => setProdutoId(e.target.value)}>
                                        <option value="">Selecione...</option>
                                        {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                                    </select>
                                </div>
                                <div className="incen-form-grupo" style={{ width: 110 }}>
                                    <label className="incen-form-label">Qtd. mínima</label>
                                    <input className="incen-form-input" type="number" min="1" value={qtd} onChange={e => setQtd(e.target.value)} />
                                </div>
                                <button type="submit" className="gs-btn gs-btn-primario" style={{ flexShrink: 0 }}>
                                    <i className="fas fa-plus" />
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
                <div className="gs-modal-rodape">
                    <button className="gs-btn gs-btn-secundario" onClick={onFechar}>Cancelar</button>
                    <button className="gs-btn gs-btn-primario" onClick={() => onSalvar(condicoes)}>
                        Salvar Condições
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function IncenMetasTab() {
    const [carregando, setCarregando]         = useState(true);
    const [versoes, setVersoes]               = useState<MetaVersao[]>([]);
    const [versaoId, setVersaoId]             = useState('');
    const [regras, setRegras]                 = useState<MetaRegra[]>([]);
    const [carregandoRegras, setCarregandoRegras] = useState(false);
    const [produtos, setProdutos]             = useState<IncenProduto[]>([]);
    const [modalNovaVersao, setModalNovaVersao] = useState(false);
    const [modalCondicoes, setModalCondicoes] = useState<{ regra: MetaRegra } | null>(null);
    const [arquivoAberto, setArquivoAberto]   = useState(false);

    const versoesComStatus = derivarStatusVersao(versoes);
    const versaoAtiva      = versoesComStatus.find(v => v.status === 'ativa');
    const versoesFuturas   = versoesComStatus.filter(v => v.status === 'futura');
    const versoesArquivo   = versoesComStatus.filter(v => v.status === 'arquivada');
    const versaoSelecionada = versoesComStatus.find(v => String(v.id) === String(versaoId));
    const editavel          = versaoSelecionada?.status === 'futura';

    useEffect(() => {
        async function init() {
            try {
                const [vs, ps] = await Promise.all([
                    fetchApi<MetaVersao[]>('/api/metas/versoes'),
                    fetchApi<IncenProduto[]>('/api/produtos'),
                ]);
                setVersoes(vs);
                setProdutos(Array.isArray(ps) ? ps.filter(p => !p.is_kit) : []);
                const vsStatus = derivarStatusVersao(vs);
                const ativa = vsStatus.find(v => v.status === 'ativa');
                if (ativa) setVersaoId(String(ativa.id));
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Erro';
                mostrarMensagem(`Erro ao carregar: ${msg}`, 'erro');
            } finally {
                setCarregando(false);
            }
        }
        void init();
    }, []);

    useEffect(() => {
        if (!versaoId) { setRegras([]); return; }
        setCarregandoRegras(true);
        fetchApi<MetaRegra[]>(`/api/metas/regras/${versaoId}`)
            .then(setRegras)
            .catch(err => {
                const msg = err instanceof Error ? err.message : 'Erro';
                mostrarMensagem(`Erro ao carregar regras: ${msg}`, 'erro');
            })
            .finally(() => setCarregandoRegras(false));
    }, [versaoId]);

    const grupos = useMemo(() => regras.reduce<Record<string, MetaGrupoRegras>>((acc, r) => {
        const chave = `${r.tipo_usuario}-${r.nivel}`;
        if (!acc[chave]) acc[chave] = {
            titulo: `${labelTipoUsuario(r.tipo_usuario)} — Nível ${r.nivel}`,
            tipo_usuario: r.tipo_usuario,
            nivel: r.nivel,
            regras: [],
        };
        acc[chave].regras.push(r);
        return acc;
    }, {}), [regras]);

    async function handleSalvarRegra(id: number, payload: MetaRegraPayload) {
        const ok = await mostrarConfirmacao('Salvar alterações nesta regra?', 'aviso');
        if (!ok) return;
        try {
            const atualizada = await fetchApi<MetaRegra>(`/api/metas/regras/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            setRegras(prev => prev.map(r => r.id === id ? { ...r, ...atualizada } : r));
            mostrarMensagem('Regra salva!', 'sucesso');
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        }
    }

    async function handleExcluirRegra(regra: MetaRegra) {
        const ok = await mostrarConfirmacao(`Excluir "${regra.descricao_meta}"?`, 'perigo');
        if (!ok) return;
        try {
            await fetchApi(`/api/metas/regras/${regra.id}`, { method: 'DELETE' });
            setRegras(prev => prev.filter(r => r.id !== regra.id));
            mostrarMensagem('Regra excluída.', 'sucesso');
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        }
    }

    async function handleAdicionarRegra(chave: string, dados: MetaRegraNovaPayload) {
        const grupo = grupos[chave];
        const nova = await fetchApi<MetaRegra>('/api/metas/regras', {
            method: 'POST',
            body: JSON.stringify({
                id_versao: parseInt(versaoId, 10),
                tipo_usuario: grupo.tipo_usuario,
                nivel: grupo.nivel,
                ...dados,
            }),
        });
        setRegras(prev => [...prev, nova]);
        mostrarMensagem('Regra criada!', 'sucesso');
    }

    async function handleSalvarCondicoes(condicoes: MetaCondicao[]) {
        if (!modalCondicoes) return;
        const regra = modalCondicoes.regra;
        try {
            await fetchApi(`/api/metas/regras/${regra.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    descricao_meta: regra.descricao_meta,
                    pontos_meta: regra.pontos_meta,
                    valor_comissao: regra.valor_comissao,
                    condicoes,
                }),
            });
            setRegras(prev => prev.map(r => r.id === regra.id ? { ...r, condicoes } : r));
            mostrarMensagem('Condições salvas!', 'sucesso');
            setModalCondicoes(null);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        }
    }

    async function handleCriarVersao(payload: MetaNovaVersaoPayload) {
        await fetchApi('/api/metas/versoes', { method: 'POST', body: JSON.stringify(payload) });
        const vs = await fetchApi<MetaVersao[]>('/api/metas/versoes');
        setVersoes(vs);
        mostrarMensagem('Nova versão criada!', 'sucesso');
    }

    if (carregando) return <UICarregando variante="bloco" />;

    return (
        <>
            {/* ── Seletor de versões como chips ── */}
            <div className="gs-card incen-v-secao">
                <div className="incen-v-chips-row">
                    <div className="incen-v-chips">
                        {versaoAtiva && (
                            <VersaoChip
                                versao={versaoAtiva}
                                selecionada={String(versaoAtiva.id) === versaoId}
                                onClick={() => setVersaoId(String(versaoAtiva.id))}
                            />
                        )}
                        {versoesFuturas.map(v => (
                            <VersaoChip key={v.id} versao={v}
                                selecionada={String(v.id) === versaoId}
                                onClick={() => setVersaoId(String(v.id))} />
                        ))}

                        {versoesArquivo.length > 0 && (
                            <>
                                <button
                                    className="incen-v-chip incen-v-chip--toggle-arquivo"
                                    onClick={() => setArquivoAberto(a => !a)}
                                >
                                    <i className={`fas fa-chevron-${arquivoAberto ? 'up' : 'down'}`} />
                                    Histórico ({versoesArquivo.length})
                                </button>
                                {arquivoAberto && versoesArquivo.map(v => (
                                    <VersaoChip key={v.id} versao={v}
                                        selecionada={String(v.id) === versaoId}
                                        onClick={() => setVersaoId(String(v.id))} />
                                ))}
                            </>
                        )}
                    </div>

                    <button
                        className="incen-v-btn-nova gs-btn gs-btn-secundario"
                        onClick={() => {
                            if (!versaoAtiva) { mostrarMensagem('Nenhuma versão ativa para clonar.', 'erro'); return; }
                            setModalNovaVersao(true);
                        }}
                    >
                        <i className="fas fa-plus" /> Nova Versão
                    </button>
                </div>

                {versaoSelecionada && (
                    <div className="incen-v-status-row">
                        <span className={`incen-gincana-badge ${versaoSelecionada.status === 'ativa' ? 'ao-vivo' : versaoSelecionada.status === 'futura' ? 'proxima' : 'encerrada'}`}>
                            {versaoSelecionada.status === 'ativa' ? '● ATIVA'
                                : versaoSelecionada.status === 'futura' ? 'FUTURA'
                                : 'ARQUIVADA'}
                        </span>
                        {editavel && (
                            <span className="incen-metas-editavel-hint">
                                <i className="fas fa-pencil-alt" /> Versão futura — regras editáveis
                            </span>
                        )}
                        {!editavel && versaoSelecionada.status !== 'ativa' && (
                            <span className="incen-v-leitura-hint">
                                <i className="fas fa-lock" /> Somente leitura
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* ── Conteúdo das regras ── */}
            {versaoId && (
                <div className="gs-card">
                    {carregandoRegras ? (
                        <UICarregando variante="bloco" />
                    ) : Object.keys(grupos).length === 0 ? (
                        <div className="incen-lista-vazia">
                            <i className="fas fa-bullseye" />
                            <p>Nenhuma regra cadastrada para esta versão.</p>
                        </div>
                    ) : (
                        <div className="incen-grupos-lista">
                            {Object.entries(grupos).map(([chave, grupo]) => (
                                <GrupoRegras
                                    key={chave}
                                    chave={chave}
                                    grupo={grupo}
                                    editavel={!!editavel}
                                    onSalvarRegra={handleSalvarRegra}
                                    onExcluirRegra={(r) => void handleExcluirRegra(r)}
                                    onAbrirCondicoes={regra => setModalCondicoes({ regra })}
                                    onAdicionarRegra={handleAdicionarRegra}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {modalNovaVersao && versaoAtiva && (
                <ModalNovaVersao
                    versaoAtiva={versaoAtiva}
                    onConfirmar={handleCriarVersao}
                    onFechar={() => setModalNovaVersao(false)}
                />
            )}

            {modalCondicoes && (
                <ModalCondicoes
                    regra={modalCondicoes.regra}
                    produtos={produtos}
                    onSalvar={(c) => void handleSalvarCondicoes(c)}
                    onFechar={() => setModalCondicoes(null)}
                />
            )}
        </>
    );
}
