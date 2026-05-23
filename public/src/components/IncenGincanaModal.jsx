// public/src/components/IncenGincanaModal.jsx
import React, { useState, useEffect, useRef } from 'react';
import { mostrarMensagem } from '/js/utils/popups.js';

const EMOJIS = ['🏆', '⚡', '🎯', '🚀', '🌟', '💪', '💰', '🎁', '🔥', '🎉', '🏅', '🎖️'];

const PARTICIPANTES_OPTS = [
    { id: 'costureiras', label: 'Costureiras' },
    { id: 'tiktiks',     label: 'Tiktiks' },
    { id: 'ambos',       label: 'Ambos' },
];

// "2026-05-18T17:00:00-03:00" → "2026-05-18T17:00"
function isoParaLocal(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const sp = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const pad = n => String(n).padStart(2, '0');
    return `${sp.getFullYear()}-${pad(sp.getMonth()+1)}-${pad(sp.getDate())}T${pad(sp.getHours())}:${pad(sp.getMinutes())}`;
}

function localParaIso(localStr) {
    if (!localStr) return null;
    return `${localStr}:00-03:00`;
}

function dataHoraParaIso(data, hora) {
    if (!data || !hora) return null;
    return `${data}T${hora}:00-03:00`;
}

function gerarId() {
    return `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function premiacaoVazia(ordem) {
    return { _id: gerarId(), nivel_label: '', emoji_icone: '🏅', meta_valor: '', descricao_premio: '', valor_premio_reais: '', ordem };
}

async function fetchApi(url, opts = {}) {
    const token = localStorage.getItem('token');
    const res = await fetch(url, {
        ...opts,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro na requisição');
    return data;
}

// Passo 1 — O básico (nome, emoji, participantes, recorrência, datas, visibilidade)
function Passo1({ state, set }) {
    const [confirmado, setConfirmado] = useState(false);
    const handleConfirmar = () => {
        setConfirmado(true);
        setTimeout(() => setConfirmado(false), 2000);
    };
    return (
        <div className="incen-wizard-passo">
            <div className="incen-form-grupo">
                <label className="incen-form-label">Nome da Gincana</label>
                <input
                    className="incen-form-input"
                    type="text"
                    placeholder="Ex: Sprint da Tarde"
                    value={state.nome}
                    onChange={e => set('nome', e.target.value)}
                    maxLength={200}
                />
                {/* 5.2 — Prévia ao vivo */}
                {state.nome.trim() && (
                    <div className="incen-previa-nome">
                        <span className="incen-previa-nome-label">Na dashboard vai aparecer como:</span>
                        <span>Nova Gincana: <strong>{state.nome.trim()}</strong></span>
                    </div>
                )}
                <p className="incen-form-hint">O prefixo "Nova Gincana:" é adicionado automaticamente ao aviso popup.</p>
            </div>

            <div className="incen-form-linha">
                <div className="incen-form-grupo" style={{ flex: 1 }}>
                    <label className="incen-form-label">Emoji do Banner</label>
                    <div className="incen-emoji-grid">
                        {EMOJIS.map(e => (
                            <button
                                key={e}
                                type="button"
                                className={`incen-emoji-btn ${state.bannerEmoji === e ? 'selecionado' : ''}`}
                                onClick={() => set('bannerEmoji', e)}
                            >
                                {e}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="incen-form-grupo incen-form-grupo--toggle">
                    <label className="incen-form-label">Visível na Dashboard</label>
                    <button
                        type="button"
                        className={`incen-toggle ${state.visivelDashboard ? 'on' : 'off'}`}
                        onClick={() => set('visivelDashboard', !state.visivelDashboard)}
                    >
                        <span className="incen-toggle-knob"></span>
                        <span className="incen-toggle-label">{state.visivelDashboard ? 'ON' : 'OFF'}</span>
                    </button>
                </div>
            </div>

            <div className="incen-form-grupo">
                <label className="incen-form-label">Para quem?</label>
                <div className="incen-segmented">
                    {PARTICIPANTES_OPTS.map(o => (
                        <button
                            key={o.id}
                            type="button"
                            className={`incen-seg-btn ${state.participantes === o.id ? 'ativo' : ''}`}
                            onClick={() => set('participantes', o.id)}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="incen-form-grupo">
                <label className="incen-form-label">Tipo de Gincana</label>
                <div className="incen-segmented">
                    <button
                        type="button"
                        className={`incen-seg-btn ${state.tipoRecorrencia === 'unica' ? 'ativo' : ''}`}
                        onClick={() => set('tipoRecorrencia', 'unica')}
                    >
                        Única
                    </button>
                    <button
                        type="button"
                        className={`incen-seg-btn ${state.tipoRecorrencia === 'semanal' ? 'ativo' : ''}`}
                        onClick={() => set('tipoRecorrencia', 'semanal')}
                    >
                        Semanal (Seg–Sex)
                    </button>
                </div>
            </div>

            {state.tipoRecorrencia === 'unica' && (
                <>
                    <div className="incen-form-linha">
                        <div className="incen-form-grupo" style={{ flex: 1 }}>
                            <label className="incen-form-label">Início — Data</label>
                            <input className="incen-form-input" type="date" value={state.inicioData} onChange={e => set('inicioData', e.target.value)} />
                        </div>
                        <div className="incen-form-grupo" style={{ flex: 1 }}>
                            <label className="incen-form-label">Início — Hora</label>
                            <input className="incen-form-input" type="time" value={state.inicioHora} onChange={e => set('inicioHora', e.target.value)} />
                        </div>
                    </div>
                    <div className="incen-form-linha">
                        <div className="incen-form-grupo" style={{ flex: 1 }}>
                            <label className="incen-form-label">Fim — Data</label>
                            <input className="incen-form-input" type="date" value={state.fimData} onChange={e => set('fimData', e.target.value)} />
                        </div>
                        <div className="incen-form-grupo" style={{ flex: 1 }}>
                            <label className="incen-form-label">Fim — Hora</label>
                            <input className="incen-form-input" type="time" value={state.fimHora} onChange={e => set('fimHora', e.target.value)} />
                        </div>
                    </div>
                    <button
                        type="button"
                        className={`gs-btn ${confirmado ? 'gs-btn-primario' : 'gs-btn-secundario'}`}
                        style={{ width: '100%', marginTop: 4 }}
                        onClick={handleConfirmar}
                    >
                        {confirmado
                            ? <><i className="fas fa-check-circle"></i> Datas e horários confirmados!</>
                            : <><i className="fas fa-check"></i> Confirmar datas e horários</>
                        }
                    </button>
                </>
            )}

            {state.tipoRecorrencia === 'semanal' && (
                <>
                    <div className="incen-form-linha">
                        <div className="incen-form-grupo" style={{ flex: 1 }}>
                            <label className="incen-form-label">Campanha — Início</label>
                            <input className="incen-form-input" type="date" value={state.campanhaInicioData} onChange={e => set('campanhaInicioData', e.target.value)} />
                        </div>
                        <div className="incen-form-grupo" style={{ flex: 1 }}>
                            <label className="incen-form-label">Campanha — Fim</label>
                            <input className="incen-form-input" type="date" value={state.campanhaFimData} onChange={e => set('campanhaFimData', e.target.value)} />
                        </div>
                    </div>
                    <div className="incen-form-linha">
                        <div className="incen-form-grupo" style={{ flex: 1 }}>
                            <label className="incen-form-label">Horário — Início (Segunda)</label>
                            <input className="incen-form-input" type="time" value={state.horaInicio} onChange={e => set('horaInicio', e.target.value)} />
                        </div>
                        <div className="incen-form-grupo" style={{ flex: 1 }}>
                            <label className="incen-form-label">Horário — Fim (Sexta)</label>
                            <input className="incen-form-input" type="time" value={state.horaFim} onChange={e => set('horaFim', e.target.value)} />
                        </div>
                    </div>
                    <button
                        type="button"
                        className={`gs-btn ${confirmado ? 'gs-btn-primario' : 'gs-btn-secundario'}`}
                        style={{ width: '100%', marginTop: 4 }}
                        onClick={handleConfirmar}
                    >
                        {confirmado
                            ? <><i className="fas fa-check-circle"></i> Datas e horários confirmados!</>
                            : <><i className="fas fa-check"></i> Confirmar datas e horários</>
                        }
                    </button>
                </>
            )}
        </div>
    );
}

// Passo 2 — As regras (tipo_premiacao, modalidade, escopo, produto)
function Passo2({ state, set, produtos, buscandoProdutos }) {
    const escopoOpts = [
        { id: 'tudo',              label: 'Pontos totais',     hint: 'Produção + Arremates' },
        { id: 'apenas_processos_op', label: 'Só Processos OP', hint: 'Pontos de produção' },
        { id: 'apenas_arremates',  label: 'Só Arremates',     hint: 'Só tiktiks', soTiktik: true },
        { id: 'produto_especifico', label: 'Produto Específico', hint: 'Conta unidades físicas' },
    ].filter(o => !o.soTiktik || state.participantes !== 'costureiras');

    const ehCorrida = state.tipoPremiacao === 'corrida';

    return (
        <div className="incen-wizard-passo">
            <div className="incen-form-grupo">
                <label className="incen-form-label">Como a gincana funciona?</label>
                <div className="incen-tipo-premiacao-grid">
                    <button
                        type="button"
                        className={`incen-tipo-card ${state.tipoPremiacao === 'meta' ? 'ativo' : ''}`}
                        onClick={() => set('tipoPremiacao', 'meta')}
                    >
                        <span className="incen-tipo-icone">🎯</span>
                        <strong>Meta</strong>
                        <span className="incen-tipo-desc">Todos que atingirem o objetivo ganham</span>
                    </button>
                    <button
                        type="button"
                        className={`incen-tipo-card ${state.tipoPremiacao === 'corrida' ? 'ativo' : ''}`}
                        onClick={() => {
                            set('tipoPremiacao', 'corrida');
                            // Corrida sempre individual
                            set('modalidade', 'individual');
                        }}
                    >
                        <span className="incen-tipo-icone">🏁</span>
                        <strong>Corrida</strong>
                        <span className="incen-tipo-desc">Apenas o PRIMEIRO a atingir ganha</span>
                    </button>
                </div>
            </div>

            <div className="incen-form-grupo">
                <label className="incen-form-label">Modalidade</label>
                <div className="incen-segmented">
                    <button
                        type="button"
                        className={`incen-seg-btn ${state.modalidade === 'individual' ? 'ativo' : ''}`}
                        onClick={() => set('modalidade', 'individual')}
                    >
                        Individual
                    </button>
                    {/* 5.3 — Botão Equipe bloqueado quando corrida */}
                    <button
                        type="button"
                        className={`incen-seg-btn ${state.modalidade === 'equipe' ? 'ativo' : ''} ${ehCorrida ? 'incen-seg-btn--bloqueado' : ''}`}
                        onClick={() => {
                            if (ehCorrida) return;
                            set('modalidade', 'equipe');
                            // Equipe não tem múltiplos níveis
                            set('tipoPremiacao', 'meta');
                        }}
                    >
                        Equipe
                    </button>
                </div>
                {/* 5.3 — Aviso de bloqueio quando corrida */}
                {ehCorrida && (
                    <div className="incen-lock-notice">
                        <i className="fas fa-lock"></i>
                        Corrida é sempre individual — não faz sentido uma equipe "chegar primeiro".
                    </div>
                )}
                {state.modalidade === 'equipe' && !ehCorrida && (
                    <p className="incen-form-hint" style={{ marginTop: 6 }}>
                        A equipe inteira precisa bater a meta coletiva. Se bater, cada uma ganha.
                    </p>
                )}
            </div>

            <div className="incen-form-grupo">
                <label className="incen-form-label">O que conta?</label>
                <div className="incen-escopo-grid">
                    {escopoOpts.map(o => (
                        <button
                            key={o.id}
                            type="button"
                            className={`incen-escopo-btn ${state.escopoAtividade === o.id ? 'ativo' : ''}`}
                            onClick={() => {
                                set('escopoAtividade', o.id);
                                if (o.id !== 'produto_especifico') set('produtoId', null);
                            }}
                        >
                            <strong>{o.label}</strong>
                            <span>{o.hint}</span>
                        </button>
                    ))}
                </div>
            </div>

            {state.escopoAtividade === 'produto_especifico' && (
                <div className="incen-form-grupo">
                    <label className="incen-form-label">Selecionar Produto</label>
                    {buscandoProdutos ? (
                        <p style={{ fontSize: '0.85rem', color: 'var(--gs-texto-secundario)' }}>Carregando produtos...</p>
                    ) : (
                        <select
                            className="incen-form-input"
                            value={state.produtoId || ''}
                            onChange={e => set('produtoId', e.target.value ? parseInt(e.target.value) : null)}
                        >
                            <option value="">— Selecione um produto —</option>
                            {produtos.map(p => (
                                <option key={p.id} value={p.id}>{p.nome}</option>
                            ))}
                        </select>
                    )}
                    <p className="incen-form-hint" style={{ marginTop: 4 }}>
                        Conta unidades físicas produzidas desse produto (campo <code>quantidade</code> em producoes).
                    </p>
                </div>
            )}
        </div>
    );
}

// Passo 3 — O prêmio — Reorganizado (5.4)
function Passo3({ state, set, setP }) {
    const ehCorrida  = state.tipoPremiacao === 'corrida';
    const ehEquipe   = state.modalidade === 'equipe';
    const ehUnidade  = state.escopoAtividade === 'produto_especifico';
    const unidadeLabel = ehUnidade ? 'unidades' : 'pontos';

    // Single level: corrida, equipe, ou meta individual com 1 premiação
    const ehSingleLevel = ehCorrida || ehEquipe || state.premiacoes.length <= 1;

    // Nome do nível só aparece quando há múltiplos níveis numa meta individual
    const mostrarNome = !ehCorrida && !ehEquipe && state.premiacoes.length > 1;

    const placeholderDescricao = ehCorrida
        ? 'Ex: "Quem fizer 300 pontos PRIMEIRO hoje ganha R$20 via PIX! 🏁"'
        : ehEquipe
            ? 'Ex: "Equipe bate 1500 pontos hoje e cada uma ganha R$15 via PIX!"'
            : 'Ex: "Faça ~30 peças de Calça Juliet e ganhe R$30 via PIX no mesmo dia!"';

    const handleAddPremiacao = () => {
        setP(prev => [...prev, premiacaoVazia(prev.length + 1)]);
    };
    const handleRemove = (id) => setP(prev => prev.filter(p => p._id !== id));
    const handleChange = (id, campo, valor) =>
        setP(prev => prev.map(p => p._id === id ? { ...p, [campo]: valor } : p));

    // Para single level, o objetivo e descricao são do premiacoes[0]
    const primeiraPremiacao = state.premiacoes[0];

    return (
        <div className="incen-wizard-passo">

            {/* Banner informativo */}
            <div className="incen-info-banner">
                <i className="fas fa-info-circle"></i>
                <p>Defina <strong>o que elas precisam fazer</strong> (objetivo) e <strong>como você vai anunciar</strong> (chamada + prêmio). Tudo aparece sempre no card — o prêmio é o que motiva!</p>
            </div>

            {/* Seção 2 — Objetivo + Prêmio (R$) lado a lado */}
            <div className="incen-form-grupo">
                <label className="incen-form-label">
                    Objetivo e Prêmio
                    <span className="incen-form-label-badge">Aparecem sempre</span>
                </label>
                <div className="incen-obj-premio-row">
                    {/* OBJETIVO */}
                    <div className="incen-objetivo-bloco">
                        <p className="incen-objetivo-subtitulo">Quanto ela precisa atingir?</p>
                        <div className="incen-objetivo-input-row">
                            <input
                                className="incen-objetivo-input-num"
                                type="number"
                                placeholder="0"
                                value={primeiraPremiacao?.meta_valor ?? ''}
                                onChange={e => handleChange(primeiraPremiacao?._id, 'meta_valor', e.target.value)}
                                min={1}
                            />
                            <span className="incen-objetivo-unidade">{unidadeLabel}</span>
                        </div>
                    </div>
                    {/* PRÊMIO em R$ */}
                    <div className="incen-objetivo-bloco incen-objetivo-bloco--premio">
                        <p className="incen-objetivo-subtitulo">Valor do prêmio</p>
                        <div className="incen-objetivo-input-row">
                            <span className="incen-objetivo-unidade incen-objetivo-prefix">R$</span>
                            <input
                                className="incen-objetivo-input-num"
                                type="number"
                                placeholder="0,00"
                                step="0.01"
                                min="0.01"
                                value={primeiraPremiacao?.valor_premio_reais ?? ''}
                                onChange={e => handleChange(primeiraPremiacao?._id, 'valor_premio_reais', e.target.value)}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Seção 3 — Chamada (sugerida, editável) */}
            {ehSingleLevel ? (
                <div className="incen-form-grupo">
                    <label className="incen-form-label">
                        Chamada
                        <span className="incen-form-label-badge">Sugerida — pode editar</span>
                    </label>
                    <p className="incen-form-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                        Gerada automaticamente a partir do objetivo e valor. Edite à vontade!
                    </p>
                    <textarea
                        className="incen-form-input incen-form-textarea"
                        placeholder={placeholderDescricao}
                        value={state.descricao}
                        onChange={e => set('descricao', e.target.value)}
                        rows={3}
                    />
                </div>
            ) : (
                <>
                    <div className="incen-form-grupo">
                        <label className="incen-form-label">
                            Chamada geral
                            <span className="incen-form-label-badge">Aparece sempre</span>
                        </label>
                        <textarea
                            className="incen-form-input incen-form-textarea"
                            placeholder={placeholderDescricao}
                            value={state.descricao}
                            onChange={e => set('descricao', e.target.value)}
                            rows={3}
                        />
                    </div>

                    {/* Blocos por nível */}
                    <div className="incen-form-grupo">
                        <label className="incen-form-label">Níveis de premiação</label>
                        <div className="incen-premiacoes-lista">
                            {state.premiacoes.map((p, idx) => (
                                <div key={p._id} className="incen-nivel-bloco">
                                    <div className="incen-nivel-cabecalho">
                                        <span>Nível {idx + 1}</span>
                                        {state.premiacoes.length > 1 && (
                                            <button
                                                type="button"
                                                className="incen-remove-btn"
                                                onClick={() => handleRemove(p._id)}
                                                title="Remover"
                                            >
                                                <i className="fas fa-times"></i>
                                            </button>
                                        )}
                                    </div>
                                    <div className="incen-premiacao-linha-1">
                                        <div className="incen-form-campo-mini">
                                            <span className="incen-campo-mini-label">Emoji</span>
                                            <input
                                                className="incen-emoji-input"
                                                type="text"
                                                value={p.emoji_icone}
                                                onChange={e => handleChange(p._id, 'emoji_icone', e.target.value)}
                                                maxLength={4}
                                                placeholder="🏅"
                                            />
                                        </div>
                                        {mostrarNome && (
                                            <div className="incen-form-campo-mini" style={{ flex: 1 }}>
                                                <span className="incen-campo-mini-label">
                                                    Nome do nível
                                                    <span className="incen-campo-mini-hint"> (ex: Bronze, Prata, Ouro)</span>
                                                </span>
                                                <input
                                                    className="incen-form-input"
                                                    type="text"
                                                    placeholder={`Nível ${idx + 1}`}
                                                    value={p.nivel_label}
                                                    onChange={e => handleChange(p._id, 'nivel_label', e.target.value)}
                                                />
                                            </div>
                                        )}
                                        <div className="incen-form-campo-mini" style={{ flex: 1 }}>
                                            <span className="incen-campo-mini-label">Objetivo deste nível</span>
                                            <div className="incen-meta-input-wrap">
                                                <input
                                                    className="incen-form-input incen-pontos-input"
                                                    type="number"
                                                    placeholder="0"
                                                    value={p.meta_valor}
                                                    onChange={e => handleChange(p._id, 'meta_valor', e.target.value)}
                                                    min={1}
                                                />
                                                <span className="incen-unidade-label">{unidadeLabel}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="incen-premiacao-linha-2">
                                        <div className="incen-form-campo-mini" style={{ flex: 1 }}>
                                            <span className="incen-campo-mini-label">Valor do prêmio (R$)</span>
                                            <input
                                                className="incen-form-input"
                                                type="number"
                                                placeholder="0,00"
                                                step="0.01"
                                                min="0.01"
                                                value={p.valor_premio_reais || ''}
                                                onChange={e => handleChange(p._id, 'valor_premio_reais', e.target.value)}
                                            />
                                        </div>
                                        <div className="incen-form-campo-mini" style={{ flex: 2 }}>
                                            <span className="incen-campo-mini-label">Chamada deste nível</span>
                                            <input
                                                className="incen-form-input"
                                                type="text"
                                                placeholder="Ex: PIX de R$30 no mesmo dia"
                                                value={p.descricao_premio}
                                                onChange={e => handleChange(p._id, 'descricao_premio', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {/* Botão adicionar nível — apenas para Meta + Individual */}
            {!ehCorrida && !ehEquipe && (
                <button type="button" className="incen-add-premiacao-btn" onClick={handleAddPremiacao}>
                    <i className="fas fa-plus"></i> Adicionar nível
                </button>
            )}

            {/* Aviso de pagamento */}
            <div className="incen-aviso-pagamento">
                <i className="fas fa-coins"></i>
                Pagamento toda sexta-feira pelo supervisor, ou antecipado individualmente.
            </div>
        </div>
    );
}

// Indicador de passos
function PassoIndicador({ passo }) {
    return (
        <div className="incen-wizard-steps">
            {[1, 2, 3].map(n => (
                <div key={n} className={`incen-wizard-step ${passo === n ? 'ativo' : ''} ${passo > n ? 'concluido' : ''}`}>
                    <span className="incen-wizard-step-num">{passo > n ? '✓' : n}</span>
                    <span className="incen-wizard-step-label">
                        {n === 1 ? 'O Básico' : n === 2 ? 'As Regras' : 'O Prêmio'}
                    </span>
                </div>
            ))}
        </div>
    );
}

export default function IncenGincanaModal({ gincana, onFechar, onSalvo }) {
    const ehNovo = !gincana || gincana._novo;

    const [passo, setPasso] = useState(1);
    const [salvando, setSalvando] = useState(false);

    // Estado centralizado do formulário
    const [form, setFormRaw] = useState({
        nome: '',
        bannerEmoji: '🏆',
        descricao: '',
        participantes: 'ambos',
        modalidade: 'individual',
        tipoPremiacao: 'meta',
        escopoAtividade: 'tudo',
        produtoId: null,
        tipoRecorrencia: 'unica',
        inicioData: '',
        inicioHora: '07:00',
        fimData: '',
        fimHora: '18:00',
        campanhaInicioData: '',
        campanhaFimData: '',
        horaInicio: '07:00',
        horaFim: '18:00',
        visivelDashboard: true,
    });
    const [premiacoes, setPremiacoes] = useState([premiacaoVazia(1)]);

    // Produtos para selector de produto_especifico
    const [produtos, setProdutos] = useState([]);
    const [buscandoProdutos, setBuscandoProdutos] = useState(false);

    const set = (campo, valor) => setFormRaw(prev => ({ ...prev, [campo]: valor }));

    // Pre-carregar ao editar
    useEffect(() => {
        if (!ehNovo && gincana) {
            setFormRaw({
                nome: gincana.nome || '',
                bannerEmoji: gincana.banner_emoji || '🏆',
                descricao: gincana.descricao || '',
                participantes: gincana.participantes || 'ambos',
                modalidade: gincana.modalidade || 'individual',
                tipoPremiacao: gincana.tipo_premiacao || 'meta',
                escopoAtividade: gincana.escopo_atividade || 'tudo',
                produtoId: gincana.produto_id || null,
                tipoRecorrencia: gincana.tipo_recorrencia || 'unica',
                inicioData: gincana.tipo_recorrencia !== 'semanal' ? isoParaLocal(gincana.datetime_inicio).slice(0, 10) : '',
                inicioHora: gincana.tipo_recorrencia !== 'semanal' ? (isoParaLocal(gincana.datetime_inicio).slice(11, 16) || '07:00') : '07:00',
                fimData: gincana.tipo_recorrencia !== 'semanal' ? isoParaLocal(gincana.datetime_fim).slice(0, 10) : '',
                fimHora: gincana.tipo_recorrencia !== 'semanal' ? (isoParaLocal(gincana.datetime_fim).slice(11, 16) || '18:00') : '18:00',
                campanhaInicioData: gincana.tipo_recorrencia === 'semanal' ? isoParaLocal(gincana.datetime_inicio).slice(0, 10) : '',
                campanhaFimData: gincana.tipo_recorrencia === 'semanal' ? isoParaLocal(gincana.datetime_fim).slice(0, 10) : '',
                horaInicio: gincana.hora_inicio_semana?.slice(0, 5) || '07:00',
                horaFim: gincana.hora_fim_semana?.slice(0, 5) || '18:00',
                visivelDashboard: gincana.visivel_dashboard !== false,
            });
            if (gincana.premiacoes?.length) {
                setPremiacoes(gincana.premiacoes.map(p => ({
                    ...p, _id: gerarId(),
                    meta_valor: p.meta_valor ?? p.meta_pontos ?? '',
                    valor_premio_reais: p.valor_premio_reais ?? '',
                })));
            }
        }
    }, []);

    // Buscar produtos quando escopo muda para produto_especifico
    useEffect(() => {
        if (form.escopoAtividade === 'produto_especifico' && produtos.length === 0) {
            setBuscandoProdutos(true);
            const token = localStorage.getItem('token');
            fetch('/api/produtos', { headers: { Authorization: `Bearer ${token}` } })
                .then(r => r.json())
                .then(data => {
                    const simples = Array.isArray(data) ? data.filter(p => !p.is_kit) : [];
                    setProdutos(simples);
                })
                .catch(() => setProdutos([]))
                .finally(() => setBuscandoProdutos(false));
        }
    }, [form.escopoAtividade]);

    // Reset escopo inválido quando participantes muda
    useEffect(() => {
        if (form.participantes === 'costureiras' && form.escopoAtividade === 'apenas_arremates') {
            set('escopoAtividade', 'tudo');
        }
    }, [form.participantes]);

    // Para corrida: garantir apenas 1 premiação e modalidade individual
    useEffect(() => {
        if (form.tipoPremiacao === 'corrida') {
            if (premiacoes.length > 1) setPremiacoes([premiacoes[0]]);
            if (form.modalidade !== 'individual') set('modalidade', 'individual');
        }
        if (form.modalidade === 'equipe' && premiacoes.length > 1) {
            setPremiacoes([premiacoes[0]]);
        }
    }, [form.tipoPremiacao, form.modalidade]);

    const ehCorrida = form.tipoPremiacao === 'corrida';
    const ehEquipe  = form.modalidade === 'equipe';
    const ehSingleLevel = ehCorrida || ehEquipe || premiacoes.length <= 1;

    // Auto-gerar chamada quando objetivo ou valor do prêmio muda (single-level)
    const autoDescricaoRef = useRef('');
    useEffect(() => {
        if (!ehSingleLevel) return;
        const p = premiacoes[0];
        if (!p) return;
        const meta = parseFloat(p.meta_valor);
        const valor = parseFloat(p.valor_premio_reais);
        if (!meta || meta <= 0 || !valor || valor <= 0) return;
        const unidade = form.escopoAtividade === 'produto_especifico' ? 'peças' : 'pts';
        const valorFormatado = valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const gerado = `Faça ${meta.toFixed(0)} ${unidade} e receba R$ ${valorFormatado}.`;
        if (!form.descricao.trim() || form.descricao === autoDescricaoRef.current) {
            autoDescricaoRef.current = gerado;
            set('descricao', gerado);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [premiacoes[0]?.meta_valor, premiacoes[0]?.valor_premio_reais, form.escopoAtividade, ehSingleLevel]);

    const validarPasso = (n) => {
        if (n === 1) {
            if (!form.nome.trim()) return 'Informe o nome da gincana.';
            if (form.tipoRecorrencia === 'unica' && (!form.inicioData || !form.inicioHora || !form.fimData || !form.fimHora))
                return 'Informe as datas e horários de início e fim.';
            if (form.tipoRecorrencia === 'unica' && dataHoraParaIso(form.inicioData, form.inicioHora) >= dataHoraParaIso(form.fimData, form.fimHora))
                return 'O início deve ser antes do fim.';
            if (form.tipoRecorrencia === 'semanal' && (!form.campanhaInicioData || !form.campanhaFimData))
                return 'Informe as datas da campanha.';
        }
        if (n === 2) {
            if (form.escopoAtividade === 'produto_especifico' && !form.produtoId)
                return 'Selecione um produto.';
        }
        if (n === 3) {
            if (!premiacoes.length) return 'Adicione pelo menos uma premiação.';
            if (!form.descricao.trim()) return 'Preencha a chamada da gincana.';
            const primeira = premiacoes[0];
            if (!primeira.meta_valor || isNaN(parseFloat(primeira.meta_valor)) || parseFloat(primeira.meta_valor) <= 0)
                return 'O objetivo deve ser um número maior que zero.';
            if (ehSingleLevel) {
                if (!primeira.valor_premio_reais || isNaN(parseFloat(primeira.valor_premio_reais)) || parseFloat(primeira.valor_premio_reais) <= 0)
                    return 'Informe o valor em R$ do prêmio.';
            }
            if (!ehSingleLevel) {
                const mostrarNome = premiacoes.length > 1;
                for (const p of premiacoes) {
                    if (mostrarNome && !p.nivel_label.trim()) return 'Preencha o nome de todos os níveis.';
                    if (!p.meta_valor || isNaN(parseFloat(p.meta_valor)) || parseFloat(p.meta_valor) <= 0)
                        return 'O objetivo deve ser um número maior que zero em cada nível.';
                    if (!p.valor_premio_reais || isNaN(parseFloat(p.valor_premio_reais)) || parseFloat(p.valor_premio_reais) <= 0)
                        return 'Informe o valor em R$ do prêmio em cada nível.';
                    if (!p.descricao_premio.trim()) return 'Preencha a chamada de todos os níveis.';
                }
            }
        }
        return null;
    };

    const irPara = (n) => {
        const erro = validarPasso(passo);
        if (erro) { mostrarMensagem(erro, 'aviso'); return; }
        setPasso(n);
    };

    const montar = () => {
        let datetimeInicio, datetimeFim, horaInicioSemana = null, horaFimSemana = null;
        if (form.tipoRecorrencia === 'unica') {
            datetimeInicio = dataHoraParaIso(form.inicioData, form.inicioHora);
            datetimeFim    = dataHoraParaIso(form.fimData, form.fimHora);
        } else {
            datetimeInicio = dataHoraParaIso(form.campanhaInicioData, form.horaInicio);
            datetimeFim    = dataHoraParaIso(form.campanhaFimData, form.horaFim);
            horaInicioSemana = form.horaInicio;
            horaFimSemana    = form.horaFim;
        }

        return {
            nome: form.nome.trim(),
            descricao: form.descricao.trim() || null,
            banner_emoji: form.bannerEmoji,
            participantes: form.participantes,
            modalidade: form.modalidade,
            tipo_premiacao: form.tipoPremiacao,
            escopo_atividade: form.escopoAtividade,
            produto_id: form.escopoAtividade === 'produto_especifico' ? form.produtoId : null,
            tipo_recorrencia: form.tipoRecorrencia,
            datetime_inicio: datetimeInicio,
            datetime_fim: datetimeFim,
            hora_inicio_semana: horaInicioSemana,
            hora_fim_semana: horaFimSemana,
            visivel_dashboard: form.visivelDashboard,
            premiacoes: premiacoes.map((p, i) => {
                // Auto-preenche nivel_label quando o campo está oculto
                let nivelLabel = p.nivel_label.trim();
                if (!nivelLabel) {
                    if (form.tipoPremiacao === 'corrida') nivelLabel = 'Vencedor';
                    else if (form.modalidade === 'equipe') nivelLabel = 'Equipe';
                    else nivelLabel = premiacoes.length === 1 ? 'Meta' : `Nível ${i + 1}`;
                }
                // Para single level: descricao_premio = form.descricao (a chamada)
                const descricaoPremio = ehSingleLevel
                    ? (form.descricao.trim() || p.descricao_premio.trim())
                    : p.descricao_premio.trim();
                return {
                    nivel_label: nivelLabel,
                    emoji_icone: p.emoji_icone || '🏅',
                    meta_valor: parseFloat(p.meta_valor),
                    descricao_premio: descricaoPremio,
                    valor_premio_reais: parseFloat(p.valor_premio_reais) || null,
                    ordem: i + 1,
                };
            }),
        };
    };

    const handleSalvar = async () => {
        const erroFinal = validarPasso(3);
        if (erroFinal) { mostrarMensagem(erroFinal, 'aviso'); return; }

        const payload = montar();
        setSalvando(true);
        try {
            if (ehNovo) {
                await fetchApi('/api/gincanas', { method: 'POST', body: JSON.stringify(payload) });
                mostrarMensagem('Gincana salva como rascunho!', 'sucesso');
            } else {
                await fetchApi(`/api/gincanas/${gincana.id}`, { method: 'PUT', body: JSON.stringify(payload) });
                mostrarMensagem('Gincana atualizada!', 'sucesso');
            }
            onSalvo?.();
        } catch (err) {
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        } finally {
            setSalvando(false);
        }
    };

    const stateComPremiacoes = { ...form, premiacoes };

    return (
        <div className="gs-modal-overlay" onClick={(e) => e.target === e.currentTarget && onFechar()}>
            <div className="gs-modal incen-form-modal" onClick={e => e.stopPropagation()}>

                <div className="gs-modal-cabecalho">
                    <h2>{ehNovo ? 'Nova Gincana' : `Editar: ${gincana.nome}`}</h2>
                    <button className="gs-btn-fechar" onClick={onFechar}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <PassoIndicador passo={passo} />

                <div className="gs-modal-corpo incen-form-corpo">
                    {passo === 1 && <Passo1 state={form} set={set} />}
                    {passo === 2 && <Passo2 state={form} set={set} produtos={produtos} buscandoProdutos={buscandoProdutos} />}
                    {passo === 3 && <Passo3 state={stateComPremiacoes} set={set} setP={setPremiacoes} />}
                </div>

                <div className="gs-modal-rodape">
                    {passo > 1 ? (
                        <button className="gs-btn gs-btn-secundario" onClick={() => setPasso(p => p - 1)} disabled={salvando}>
                            <i className="fas fa-arrow-left"></i> Voltar
                        </button>
                    ) : (
                        <button className="gs-btn gs-btn-secundario" onClick={onFechar} disabled={salvando}>
                            Cancelar
                        </button>
                    )}

                    {passo < 3 ? (
                        <button className="gs-btn gs-btn-primario" onClick={() => irPara(passo + 1)}>
                            Próximo <i className="fas fa-arrow-right"></i>
                        </button>
                    ) : (
                        <button className="gs-btn gs-btn-primario" onClick={handleSalvar} disabled={salvando}>
                            {salvando
                                ? 'Salvando...'
                                : ehNovo
                                    ? <><i className="fas fa-save"></i> Salvar Rascunho</>
                                    : <><i className="fas fa-save"></i> Salvar Alterações</>
                            }
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
