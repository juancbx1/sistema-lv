// public/src/components/BotaoBuscaPainelDemandas.jsx

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { mostrarMensagem } from '/js/utils/popups.js';
import BotaoBuscaModalAddDemanda from './BotaoBuscaModalAddDemanda.jsx';
import PainelDemandaCard from './BotaoBuscaPipelineProducao.jsx';
import BotaoBuscaModalConcluidas from './BotaoBuscaModalConcluidas.jsx';
import { calcularStatusDemanda, STATUS_META } from '/src/utils/demandaStatus.js';
import { LoaderIA } from './UIAgenteIA';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import PDAgenteDemandas from './PDAgenteDemandas.jsx';

const normalizarTexto = (t) =>
    t ? t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() : '';

const FASES_CHATBOT = [
    { texto: 'Conectando ao pipeline de produção...' },
    { texto: 'Lendo demandas em andamento...'        },
    { texto: 'Analisando estágios do fluxo...'       },
];

const PILLS = [
    { id: 'AGUARDANDO', label: 'Aguardando', icone: 'fa-hourglass-start', cor: '#e74c3c' },
    { id: 'COSTURA',    label: 'Costura',    icone: 'fa-cut',             cor: '#3498db' },
    { id: 'ARREMATE',   label: 'Arremate',   icone: 'fa-clipboard-check', cor: '#8e44ad' },
    { id: 'EMBALAGEM',  label: 'Embalagem',  icone: 'fa-box-open',        cor: '#e67e22' },
];

function calcularDiagnostico(demandas) {
    let urgentes = 0, aguardando = 0, totalAtivos = 0;
    demandas.forEach(item => {
        const s = calcularStatusDemanda(item);
        if (s === 'CONCLUIDO' || s === 'DIVERGENCIA') return;
        totalAtivos++;
        if (s === 'AGUARDANDO') {
            if (parseInt(item.prioridade) === 1) urgentes++;
            else aguardando++;
        }
    });
    if (totalAtivos === 0)
        return { tipo: 'ok',      icone: 'fa-check-circle',      texto: 'Pipeline limpo — nenhuma demanda aguardando.' };
    if (urgentes > 0)
        return { tipo: 'urgente', icone: 'fa-exclamation-circle', texto: `${urgentes} demanda${urgentes > 1 ? 's' : ''} prioritária${urgentes > 1 ? 's' : ''} aguardando ação imediata.` };
    if (aguardando > 0)
        return { tipo: 'atencao', icone: 'fa-tasks',              texto: `${aguardando} demanda${aguardando > 1 ? 's' : ''} aguardando para iniciar produção.` };
    return { tipo: 'ok',          icone: 'fa-check-double',       texto: `Tudo em andamento — ${totalAtivos} demanda${totalAtivos > 1 ? 's' : ''} no pipeline.` };
}

const ITENS_INICIAIS = 6;

// Extrai o primeiro nome do usuário logado diretamente do payload JWT (sem fetch extra)
function extrairPrimeiroNome() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return null;
        const payload = JSON.parse(atob(token.split('.')[1]));
        return (payload.nome || '').split(' ')[0] || null;
    } catch (_) { return null; }
}

export default function PainelDemandas({ onIniciarProducao, permissoes = [], usarCarregamentoPadrao = false, onClose }) {
    const nomeUsuario = extrairPrimeiroNome();

    const [demandasAgregadas, setDemandasAgregadas] = useState([]);
    const [carregando, setCarregando]               = useState(true);
    const [recarregando, setRecarregando]           = useState(false); // spinner parcial (agente)
    const [chatbotFase, setChatbotFase]             = useState(0);
    const [mensagemFinal, setMensagemFinal]         = useState(null);
    const [ultimaAtt, setUltimaAtt]                 = useState(null);
    const [modalAddAberto, setModalAddAberto]       = useState(false);
    const [modalHistoricoAberto, setModalHistoricoAberto] = useState(false);
    const [termoBusca, setTermoBusca]               = useState('');
    const [filtroStatus, setFiltroStatus]           = useState('AGUARDANDO');
    const [filtroPrioridade, setFiltroPrioridade]   = useState(false);
    const [subfiltroCorte, setSubfiltroCorte]       = useState('TODOS');
    const [pendentesArquivamento, setPendentesArquivamento] = useState(0);
    const [expandidos, setExpandidos]               = useState({});

    const timersRef = useRef([]);

    const fetchDiagnostico = useCallback(async (silencioso = false) => {
        if (!silencioso) {
            setCarregando(true);
            setChatbotFase(0);
            setMensagemFinal(null);

            timersRef.current.forEach(clearTimeout);
            timersRef.current = [];

            const t1 = setTimeout(() => setChatbotFase(1), 500);
            const t2 = setTimeout(() => setChatbotFase(2), 1000);
            timersRef.current = [t1, t2];
        }

        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/demandas/diagnostico-completo', {
                headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-cache' },
            });
            if (!res.ok) throw new Error('Falha ao buscar diagnóstico.');
            const data = await res.json();
            const lista = data.diagnosticoAgregado || [];

            setDemandasAgregadas(lista);
            setUltimaAtt(new Date());

            const pendentes = lista.filter(i => {
                const s = calcularStatusDemanda(i);
                return s === 'CONCLUIDO' || s === 'DIVERGENCIA';
            }).length;
            setPendentesArquivamento(pendentes);

            if (!silencioso) {
                const diag = calcularDiagnostico(lista);
                const t3 = setTimeout(() => {
                    setMensagemFinal(diag);
                    setChatbotFase(FASES_CHATBOT.length);
                    const t4 = setTimeout(() => setCarregando(false), 700);
                    timersRef.current.push(t4);
                }, 2200);
                timersRef.current.push(t3);
            }
        } catch (err) {
            console.error('[PainelDemandas]', err);
            mostrarMensagem(err.message, 'erro');
            if (!silencioso) setCarregando(false);
        }
    }, []);

    // Recarregamento parcial — exibe apenas o spinner nos cards, sem LoaderIA
    const fetchParcial = useCallback(async () => {
        setRecarregando(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/demandas/diagnostico-completo', {
                headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-cache' },
            });
            if (!res.ok) throw new Error('Falha ao buscar diagnóstico.');
            const data = await res.json();
            const lista = data.diagnosticoAgregado || [];
            setDemandasAgregadas(lista);
            setUltimaAtt(new Date());
            const pendentes = lista.filter(i => {
                const s = calcularStatusDemanda(i);
                return s === 'CONCLUIDO' || s === 'DIVERGENCIA';
            }).length;
            setPendentesArquivamento(pendentes);
        } catch (err) {
            console.error('[PainelDemandas] fetchParcial:', err);
            mostrarMensagem(err.message, 'erro');
        } finally {
            setRecarregando(false);
        }
    }, []);

    useEffect(() => {
        fetchDiagnostico();
        return () => timersRef.current.forEach(clearTimeout);
    }, [fetchDiagnostico]);

    // texto "há X min" para o botão de refresh
    const [tempoTexto, setTempoTexto] = useState('—');
    useEffect(() => {
        const atualizar = () => {
            if (!ultimaAtt) { setTempoTexto('—'); return; }
            const diff = Math.floor((Date.now() - ultimaAtt.getTime()) / 60000);
            setTempoTexto(diff === 0 ? 'agora' : `há ${diff} min`);
        };
        atualizar();
        const id = setInterval(atualizar, 30000);
        return () => clearInterval(id);
    }, [ultimaAtt]);

    const { pendentes, concluidas } = useMemo(() => {
        const p = [], c = [];
        const vistas = new Set();
        const unica = [];
        demandasAgregadas.forEach(item => {
            const chave = `${item.demanda_id}-${item.produto_id}-${item.variante || 'padrao'}`;
            if (!vistas.has(chave)) { vistas.add(chave); unica.push(item); }
        });
        unica.sort((a, b) => {
            if (a.prioridade !== b.prioridade) return a.prioridade - b.prioridade;
            return a.demanda_id - b.demanda_id;
        });
        unica.forEach(item => {
            const s = calcularStatusDemanda(item);
            if (s === 'CONCLUIDO' || s === 'DIVERGENCIA') { c.push(item); return; }
            p.push(item);
        });
        return { pendentes: p, concluidas: c };
    }, [demandasAgregadas]);

    const contagensPorEstagio = useMemo(() => {
        const c = { AGUARDANDO: 0, COSTURA: 0, ARREMATE: 0, EMBALAGEM: 0 };
        pendentes.forEach(item => {
            const s = calcularStatusDemanda(item);
            if (c[s] !== undefined) c[s]++;
        });
        return c;
    }, [pendentes]);

    // Conta urgentes (prioridade=1 em AGUARDANDO) — passa para o agente
    const totalUrgentes = useMemo(() => {
        return pendentes.filter(item =>
            calcularStatusDemanda(item) === 'AGUARDANDO' && parseInt(item.prioridade) === 1
        ).length;
    }, [pendentes]);

    const diagnostico = useMemo(() => calcularDiagnostico(demandasAgregadas), [demandasAgregadas]);

    const termoLimpo = normalizarTexto(termoBusca);

    const filtrarItem = (item, estagio) => {
        if (filtroPrioridade && parseInt(item.prioridade) !== 1) return false;
        if (estagio === 'AGUARDANDO' && subfiltroCorte !== 'TODOS') {
            const temCorte = ((item.corte_cortado || 0) + (item.corte_pendente || 0)) > 0;
            if (subfiltroCorte === 'COM_CORTE' && !temCorte) return false;
            if (subfiltroCorte === 'SEM_CORTE' && temCorte)  return false;
        }
        if (!termoLimpo) return true;
        const textoItem = normalizarTexto(
            [item.produto_nome, item.variante, item.produto_sku].filter(Boolean).join(' ')
        );
        const palavras = termoLimpo.split(/\s+/).filter(Boolean);
        return palavras.every(p => textoItem.includes(p));
    };

    const contagensCorte = useMemo(() => {
        const aguardando = pendentes.filter(item => calcularStatusDemanda(item) === 'AGUARDANDO');
        const comCorte   = aguardando.filter(item => ((item.corte_cortado || 0) + (item.corte_pendente || 0)) > 0).length;
        return { total: aguardando.length, comCorte, semCorte: aguardando.length - comCorte };
    }, [pendentes]);

    const secoesVisiveis = useMemo(() => {
        return PILLS
            .filter(p => filtroStatus === null || filtroStatus === p.id)
            .map(p => ({
                ...p,
                items: pendentes.filter(item => calcularStatusDemanda(item) === p.id && filtrarItem(item, p.id)),
            }))
            .filter(s => s.items.length > 0);
    }, [pendentes, filtroStatus, filtroPrioridade, termoLimpo, subfiltroCorte]);

    const handleDeleteDemanda = async (demandaId) => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/demandas/${demandaId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Falha ao deletar.');
            mostrarMensagem('Demanda apagada.', 'sucesso');
            fetchDiagnostico(true);
        } catch (err) { mostrarMensagem(err.message, 'erro'); }
    };

    // Callback para o agente urgente — filtra urgentes sem refetch
    const handleFiltrarUrgentes = () => {
        setFiltroStatus('AGUARDANDO');
        setFiltroPrioridade(true);
    };

    return (
        <>
            {/* ── HEADER COMPACTO ── */}
            <div className="pd-header">
                <span className="pd-header-label">Painel de Demandas</span>

                <button
                    className="pd-btn-historico"
                    onClick={() => setModalHistoricoAberto(true)}
                    title="Histórico de demandas concluídas"
                >
                    <i className="fas fa-history"></i>
                    {pendentesArquivamento > 0 && (
                        <span className="pd-historico-badge">{pendentesArquivamento}</span>
                    )}
                </button>

                <button
                    className={`pd-btn-refresh${carregando ? ' carregando' : ''}`}
                    onClick={() => fetchDiagnostico(false)}
                    disabled={carregando}
                    title={`Atualizar — ${tempoTexto}`}
                >
                    <i className="fas fa-sync-alt pd-btn-refresh-icone"></i>
                </button>

                <button className="pd-btn-nova" onClick={() => setModalAddAberto(true)}>
                    <i className="fas fa-plus"></i>
                    Nova
                </button>

                <button className="pd-btn-fechar" onClick={onClose} title="Fechar">
                    <i className="fas fa-times"></i>
                </button>
            </div>

            {/* ── CONTEÚDO — loader ou pipeline ── */}
            {carregando ? (
                <div className="pd-loader-centrado">
                    <LoaderIA fases={FASES_CHATBOT} faseAtual={chatbotFase} mensagemFinal={mensagemFinal} />
                </div>
            ) : (
                <>
                    {/* ── SUMMARY BAR (pills de estágio) ── */}
                    <div className="pd-summary-bar">
                        {PILLS.map(p => {
                            const count = contagensPorEstagio[p.id] || 0;
                            const ativo = filtroStatus === p.id;
                            return (
                                <button
                                    key={p.id}
                                    className={`pd-summary-pill${ativo ? ' ativo' : ''}${p.id === 'AGUARDANDO' ? ' aguardando' : ''}`}
                                    style={{ '--pd-pill-cor': p.cor }}
                                    onClick={() => {
                                        const novoStatus = ativo ? null : p.id;
                                        setFiltroStatus(novoStatus);
                                        if (novoStatus !== 'AGUARDANDO') setSubfiltroCorte('TODOS');
                                    }}
                                >
                                    <i className={`fas ${p.icone}`}></i>
                                    {p.label}
                                    <span className="pd-summary-pill-count">{count}</span>
                                </button>
                            );
                        })}
                        <button
                            className={`pd-summary-pill${filtroPrioridade ? ' ativo' : ''}`}
                            style={{ '--pd-pill-cor': '#e74c3c' }}
                            onClick={() => setFiltroPrioridade(f => !f)}
                        >
                            <i className="fas fa-star"></i>
                            Urgentes
                        </button>
                    </div>

                    {/* ── SUB-FILTRO DE CORTE ── */}
                    {filtroStatus === 'AGUARDANDO' && contagensCorte.total > 0 && (
                        <div className="pd-subfiltro-corte">
                            <button
                                className={`pd-subfiltro-chip${subfiltroCorte === 'TODOS' ? ' ativo' : ''}`}
                                onClick={() => setSubfiltroCorte('TODOS')}
                            >
                                Todos
                                <span className="pd-subfiltro-chip-count">{contagensCorte.total}</span>
                            </button>
                            <button
                                className={`pd-subfiltro-chip com-corte${subfiltroCorte === 'COM_CORTE' ? ' ativo' : ''}`}
                                onClick={() => setSubfiltroCorte(subfiltroCorte === 'COM_CORTE' ? 'TODOS' : 'COM_CORTE')}
                                title="Demandas que já têm corte registrado"
                            >
                                <i className="fas fa-cut"></i>
                                Com corte
                                <span className="pd-subfiltro-chip-count">{contagensCorte.comCorte}</span>
                            </button>
                            <button
                                className={`pd-subfiltro-chip sem-corte${subfiltroCorte === 'SEM_CORTE' ? ' ativo' : ''}`}
                                onClick={() => setSubfiltroCorte(subfiltroCorte === 'SEM_CORTE' ? 'TODOS' : 'SEM_CORTE')}
                                title="Demandas sem nenhum corte registrado"
                            >
                                <i className="fas fa-scissors"></i>
                                Sem corte
                                <span className="pd-subfiltro-chip-count">{contagensCorte.semCorte}</span>
                            </button>
                        </div>
                    )}

                    {/* ── BUSCA — fixa acima do agente e dos cards ── */}
                    <div className="pd-busca-outer">
                        <div className="pd-busca-wrapper">
                            <i className="fas fa-search pd-busca-icone"></i>
                            <input
                                type="text"
                                className={`pd-busca-input${termoBusca ? ' com-limpar' : ''}`}
                                placeholder="Buscar produto..."
                                value={termoBusca}
                                onChange={e => setTermoBusca(e.target.value)}
                            />
                            {termoBusca && (
                                <button
                                    type="button"
                                    className="pd-busca-limpar"
                                    onClick={() => setTermoBusca('')}
                                    tabIndex={-1}
                                >
                                    <i className="fas fa-times"></i>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* ── AGENTE VIVO — a alma do pipeline ── */}
                    <PDAgenteDemandas
                        diagnostico={diagnostico}
                        contagensPorEstagio={contagensPorEstagio}
                        totalUrgentes={totalUrgentes}
                        nomeUsuario={nomeUsuario}
                        onRefresh={fetchParcial}
                        onFiltrarUrgentes={handleFiltrarUrgentes}
                        carregando={recarregando}
                    />

                    {/* ── CARDS POR ESTÁGIO (scrollável) ── */}
                    <div className="pd-body">
                        {recarregando ? (
                            <UICarregando variante="bloco" texto="Atualizando pipeline..." />
                        ) : secoesVisiveis.length === 0 ? (
                            <UIFeedbackNotFound
                                variante="compacto"
                                icon={termoBusca || filtroPrioridade ? 'fa-search' : 'fa-check-circle'}
                                titulo="Nenhuma demanda encontrada"
                                mensagem={termoBusca || filtroPrioridade ? 'Tente ajustar os filtros.' : 'Tudo em dia!'}
                            />
                        ) : (
                            secoesVisiveis.map(secao => (
                                <SecaoEstagio
                                    key={secao.id}
                                    secao={secao}
                                    expandido={!!expandidos[secao.id]}
                                    onExpandir={() => setExpandidos(e => ({ ...e, [secao.id]: !e[secao.id] }))}
                                    onDelete={handleDeleteDemanda}
                                    permissoes={permissoes}
                                    onRefresh={() => fetchDiagnostico(true)}
                                    onIniciarProducao={onIniciarProducao}
                                />
                            ))
                        )}
                    </div>
                </>
            )}

            {/* Modais */}
            {modalAddAberto && (
                <BotaoBuscaModalAddDemanda
                    onClose={() => setModalAddAberto(false)}
                    onDemandaCriada={() => fetchDiagnostico(true)}
                    usarCarregamentoPadrao={usarCarregamentoPadrao}
                />
            )}
            <BotaoBuscaModalConcluidas
                isOpen={modalHistoricoAberto}
                onClose={() => setModalHistoricoAberto(false)}
                usarCarregamentoPadrao={usarCarregamentoPadrao}
            />
        </>
    );
}

function SecaoEstagio({ secao, expandido, onExpandir, onDelete, permissoes, onRefresh, onIniciarProducao }) {
    const visiveis  = expandido ? secao.items : secao.items.slice(0, ITENS_INICIAIS);
    const restantes = secao.items.length - ITENS_INICIAIS;

    const ICONE_MAP = {
        AGUARDANDO: 'fa-hourglass-start',
        COSTURA:    'fa-cut',
        ARREMATE:   'fa-clipboard-check',
        EMBALAGEM:  'fa-box-open',
    };
    const SUBTITULO_MAP = {
        AGUARDANDO: 'aguardando início de produção',
        COSTURA:    'em costura',
        ARREMATE:   'prontos para arremate',
        EMBALAGEM:  'prontos para embalar',
    };
    const CLASSE_MAP = {
        AGUARDANDO: 'aguardando',
        COSTURA:    'costura',
        ARREMATE:   'arremate',
        EMBALAGEM:  'embalagem',
    };

    return (
        <div className="pd-secao">
            <div className={`pd-secao-header ${CLASSE_MAP[secao.id]}`}>
                <i className={`fas ${ICONE_MAP[secao.id]} pd-secao-icone`}></i>
                <span className="pd-secao-titulo">
                    {secao.label}
                    <span className="pd-secao-subtitulo"> — {SUBTITULO_MAP[secao.id]}</span>
                </span>
                <span className="pd-secao-count">{secao.items.length}</span>
            </div>

            <div className="pd-grid">
                {visiveis.map(item => {
                    const chave = `${item.demanda_id}-${item.produto_id}-${item.variante || 'padrao'}`;
                    return (
                        <PainelDemandaCard
                            key={chave}
                            item={item}
                            onDelete={() => onDelete(item.demanda_id)}
                            permissoes={permissoes}
                            onRefresh={onRefresh}
                            onIniciarProducao={onIniciarProducao}
                        />
                    );
                })}
            </div>

            {!expandido && restantes > 0 && (
                <button className="pd-ver-mais" onClick={onExpandir}>
                    <i className="fas fa-chevron-down"></i>
                    Ver mais {restantes} demanda{restantes !== 1 ? 's' : ''}
                </button>
            )}
            {expandido && secao.items.length > ITENS_INICIAIS && (
                <button className="pd-ver-mais" onClick={onExpandir}>
                    <i className="fas fa-chevron-up"></i>
                    Recolher
                </button>
            )}
        </div>
    );
}
