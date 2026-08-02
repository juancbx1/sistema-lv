import React, { useState, useEffect, useRef, useCallback } from 'react';
// @ts-expect-error m�dulo JS legado sem tipos
import { fetchAPI } from '/js/utils/api-utils';
import { calcularTempoEfetivo, formatarTempo, formatarHora } from '../utils/PontoHelpers'
import type { DashMeuStatus, DashTarefaStatus } from '../utils/dashboard-types';

const STATUS_CONFIG: Record<string, { classe: string; icone: string; label: string }> = {
    PRODUZINDO:     { classe: 'produzindo', icone: 'fa-tshirt',       label: 'Produzindo' },
    ALMOCO:         { classe: 'almoco',     icone: 'fa-utensils',     label: 'Almoço' },
    PAUSA:          { classe: 'pausa',      icone: 'fa-coffee',       label: 'Em Pausa' },
    LIVRE:          { classe: 'livre',      icone: 'fa-check-circle', label: 'Disponível' },
    LIVRE_MANUAL:   { classe: 'livre',      icone: 'fa-check-circle', label: 'Disponível' },
    FORA_DO_HORARIO:{ classe: 'fora',       icone: 'fa-moon',         label: 'Fora do Horário' },
};

const STATUS_COR_BORDA: Record<string, string> = {
    PRODUZINDO:     '#22c55e',
    ALMOCO:         '#f97316',
    PAUSA:          '#f59e0b',
    LIVRE:          '#64748b',
    LIVRE_MANUAL:   '#64748b',
    FORA_DO_HORARIO:'#6366f1',
};

// Cores das pílulas de processo — hash do nome garante cor consistente por processo
const PROCESSO_CORES = [
    { background: '#dbeafe', color: '#1d4ed8' }, // azul
    { background: '#d1fae5', color: '#065f46' }, // verde
    { background: '#ede9fe', color: '#5b21b6' }, // roxo
    { background: '#fef3c7', color: '#92400e' }, // âmbar
    { background: '#fce7f3', color: '#9d174d' }, // rosa
    { background: '#e0f2fe', color: '#075985' }, // ciano
    { background: '#ffedd5', color: '#9a3412' }, // laranja
];

function getProcessoCor(processo?: string | null) {
    if (!processo) return PROCESSO_CORES[0];
    let hash = 0;
    for (let i = 0; i < processo.length; i++) {
        hash = ((hash << 5) - hash) + processo.charCodeAt(i);
        hash |= 0;
    }
    return PROCESSO_CORES[Math.abs(hash) % PROCESSO_CORES.length];
}

const pluralPeca  = (n?: number | null) => n === 1 ? 'peça'  : 'peças';
const pluralPonto = (n?: number | null) => n === 1 ? 'ponto' : 'pontos';

// ─── Flip Clock ───────────────────────────────────────────────────────────────

function FlipDigit({ valor }: { valor: string }) {
    const prevRef    = useRef<string>(valor);
    const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [displayAtual,    setDisplayAtual]    = useState(valor);
    const [displayAnterior, setDisplayAnterior] = useState(valor);
    const [animando, setAnimando] = useState(false);

    useEffect(() => {
        if (valor === prevRef.current) return;
        setDisplayAnterior(prevRef.current);
        setDisplayAtual(valor);
        prevRef.current = valor;
        setAnimando(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setAnimando(false), 350) as ReturnType<typeof setTimeout>;
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, [valor]);

    return (
        <span className={`ds-flip-digit${animando ? ' ds-flip-animar' : ''}`}>
            <span className="ds-flip-top">{displayAtual}</span>
            <span className="ds-flip-bottom">{displayAnterior}</span>
        </span>
    );
}

function FlipClock({ ms }: { ms: number }) {
    const str = formatarTempo(ms); // "HH:MM:SS"
    const [h1, h2, , m1, m2, , s1, s2] = str.split('');
    return (
        <div className="ds-flip-clock">
            <FlipDigit valor={h1} /><FlipDigit valor={h2} />
            <span className="ds-flip-sep">:</span>
            <FlipDigit valor={m1} /><FlipDigit valor={m2} />
            <span className="ds-flip-sep">:</span>
            <FlipDigit valor={s1} /><FlipDigit valor={s2} />
        </div>
    );
}

// ─── Sub-componentes do modal ─────────────────────────────────────────────────

// Barra de progresso rumo à meta diária — fica dentro do hero de pontos
function PontosHojeBarra({ pontosHoje }: { pontosHoje?: number | null }) {
    const metaSalva = parseFloat(localStorage.getItem('meta_diaria_planejada') || '0');
    if (!metaSalva || !pontosHoje) return null;

    const pts = Math.round(pontosHoje);
    const falta = Math.max(0, metaSalva - pts);
    const progresso = Math.min(100, (pts / metaSalva) * 100);

    return (
        <div className="ds-modal-pontos-hoje">
            <div className="ds-modal-pontos-hoje-row">
                <span>⭐ Hoje: <strong>{pts} pts</strong></span>
                {falta > 0
                    ? <span className="ds-modal-pontos-falta">Faltam {falta} pts</span>
                    : <span className="ds-modal-pontos-meta-batida">✅ Meta batida!</span>
                }
            </div>
            <div className="ds-modal-pontos-barra-container">
                <div className="ds-modal-pontos-barra-fill" style={{ width: `${progresso}%` }} />
            </div>
            <div className="ds-modal-pontos-barra-labels">
                <span>{pts}</span>
                <span>{progresso.toFixed(0)}%</span>
                <span>{metaSalva}</span>
            </div>
        </div>
    );
}

// PrevisaoTermino usa o mesmo ratio de calcularRitmo para projetar o término.
// ratio = tempoMs / expectedMs → se < 1 (mais rápido), o restante encolhe proporcionalmente.
// Fórmula: restante_real = restante_padrão × ratio
function PrevisaoTermino({ tpp, quantidade, tempoMs }: { tpp: number; quantidade: number; tempoMs: number }) {
    const expectedMs = tpp * quantidade * 1000;
    const restantePadraoMs = expectedMs - tempoMs;

    if (restantePadraoMs <= 0) {
        return (
            <div className="ds-modal-previsao ds-modal-previsao--atrasada">
                ⚡ Passou do tempo estimado — conclua logo!
            </div>
        );
    }

    const ratio = tempoMs / expectedMs; // mesmo ratio de calcularRitmo
    const restanteRealMs = restantePadraoMs * ratio;
    const hh = new Date(Date.now() + restanteRealMs).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    });

    return (
        <div className="ds-modal-previsao">
            ⏰ No ritmo atual: termina ~às <strong>{hh}</strong>
        </div>
    );
}

function ProximaTarefa({ tarefa }: { tarefa?: DashTarefaStatus | null }) {
    if (!tarefa) return null;
    return (
        <div className="ds-modal-proxima">
            <div className="ds-modal-proxima-label">
                <i className="fas fa-arrow-right"></i> Próxima missão
            </div>
            <div className="ds-modal-proxima-content">
                {tarefa.imagem && (
                    <img
                        className="ds-modal-proxima-img"
                        src={tarefa.imagem}
                        alt={tarefa.variante || tarefa.produto_nome || undefined}
                    />
                )}
                <div className="ds-modal-proxima-info">
                    <div className="ds-modal-proxima-nome">
                        {tarefa.variante || tarefa.produto_nome}
                    </div>
                    <div className="ds-modal-proxima-detalhe">
                        {tarefa.processo} · {tarefa.quantidade} {pluralPeca(tarefa.quantidade)}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function DashStatusModal({ statusData, tempoMs, onClose }: { statusData?: DashMeuStatus | null; tempoMs: number; onClose: () => void }) {
    const status       = statusData?.status_atual || 'FORA_DO_HORARIO';
    const tarefa       = statusData?.tarefa_atual;
    const proximaTarefa = statusData?.proxima_tarefa;

    const { pausado } = tarefa
        ? calcularTempoEfetivo(tarefa.data_inicio ?? '', (statusData?.ponto_hoje ?? null) as object | null)
        : { pausado: false };

    const pontosEstaTarefa = tarefa?.valor_ponto && tarefa?.quantidade
        ? Math.round(tarefa.quantidade * tarefa.valor_ponto)
        : null;

    const horaInicio = tarefa?.data_inicio
        ? new Date(tarefa.data_inicio).toLocaleTimeString('pt-BR', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
          })
        : null;

    const corBorda = STATUS_COR_BORDA[status] || '#64748b';

    return (
        <div className="ds-fab-overlay" onClick={onClose}>
            <div
                className="ds-fab-modal"
                style={{ borderTop: `3px solid ${corBorda}` }}
                onClick={e => e.stopPropagation()}
            >
                <button className="ds-fab-modal-fechar" onClick={onClose} aria-label="Fechar">
                    <i className="fas fa-times"></i>
                </button>

                {/* ─── PRODUZINDO ─── */}
                {status === 'PRODUZINDO' && tarefa && (
                    <>
                        <div className="ds-fab-modal-vivo">
                            <span className="ds-fab-modal-vivo-dot"></span>
                            AO VIVO
                        </div>

                        {/* Produto: imagem + variante + pílula de etapa + quantidade */}
                        <div className="ds-modal-tarefa-header">
                            <div className="ds-modal-tarefa-imagem">
                                {tarefa.imagem
                                    ? <img src={tarefa.imagem} alt={tarefa.variante || tarefa.produto_nome || undefined} />
                                    : <div className="ds-modal-tarefa-placeholder"><i className="fas fa-tshirt"></i></div>
                                }
                            </div>
                            <div className="ds-modal-tarefa-info">
                                <div className="ds-modal-tarefa-variante">
                                    {tarefa.variante || tarefa.produto_nome}
                                </div>
                                <div className="ds-modal-tarefa-etapa-row">
                                    <span
                                        className="ds-modal-processo-pill"
                                        style={getProcessoCor(tarefa.processo)}
                                    >
                                        {tarefa.processo}
                                    </span>
                                    <span className="ds-modal-tarefa-qtd">
                                        <strong>{tarefa.quantidade}</strong> {pluralPeca(tarefa.quantidade)}
                                    </span>
                                </div>
                                {horaInicio && (
                                    <div className="ds-modal-tarefa-inicio">Iniciado às {horaInicio}</div>
                                )}
                            </div>
                        </div>

                        <div className="ds-modal-divisor" />

                        <FlipClock ms={tempoMs} />
                        {pausado && <span className="ds-fab-modal-pausado-badge">pausado</span>}

                        {tarefa.tpp && tempoMs > 60000 && !pausado && (
                            <PrevisaoTermino
                                tpp={tarefa.tpp ?? 0}
                                quantidade={tarefa.quantidade ?? 0}
                                tempoMs={tempoMs}
                            />
                        )}

                        {/* HERO: Pontos — logo abaixo da previsão */}
                        {pontosEstaTarefa !== null && (
                            <>
                                <div className="ds-modal-divisor" />
                                <div className="ds-modal-pontos-hero">
                                    <div className="ds-modal-pontos-hero-main">
                                        <span className="ds-modal-pontos-hero-icone">💰</span>
                                        <div>
                                            <div className="ds-modal-pontos-hero-valor">
                                                {pontosEstaTarefa} {pluralPonto(pontosEstaTarefa)}
                                            </div>
                                            <div className="ds-modal-pontos-hero-label">nesta tarefa</div>
                                        </div>
                                    </div>
                                    <PontosHojeBarra pontosHoje={statusData.pontos_hoje} />
                                </div>
                            </>
                        )}

                        {proximaTarefa && (
                            <>
                                <div className="ds-modal-divisor" />
                                <ProximaTarefa tarefa={proximaTarefa} />
                            </>
                        )}
                    </>
                )}

                {/* ─── ALMOÇO ─── */}
                {status === 'ALMOCO' && (
                    <>
                        <div className="ds-fab-modal-status-icon almoco">
                            <i className="fas fa-utensils"></i>
                        </div>
                        <h2 className="ds-fab-modal-status-titulo">Em Almoço</h2>
                        {statusData?.ponto_hoje?.horario_real_s1 && (
                            <p className="ds-fab-modal-detalhe">
                                Saída: {formatarHora(statusData.ponto_hoje.horario_real_s1 ?? null)}
                            </p>
                        )}
                        {statusData?.horario_entrada_2 && (
                            <p className="ds-fab-modal-detalhe">
                                Retorno previsto: {formatarHora(statusData.horario_entrada_2 ?? null)}
                            </p>
                        )}
                        <p className="ds-fab-modal-mensagem">Bom apetite! 😊</p>
                    </>
                )}

                {/* ─── PAUSA ─── */}
                {status === 'PAUSA' && (
                    <>
                        <div className="ds-fab-modal-status-icon pausa">
                            <i className="fas fa-coffee"></i>
                        </div>
                        <h2 className="ds-fab-modal-status-titulo">Em Pausa</h2>
                        {statusData?.ponto_hoje?.horario_real_s2 && (
                            <p className="ds-fab-modal-detalhe">
                                Saída: {formatarHora(statusData.ponto_hoje.horario_real_s2 ?? null)}
                            </p>
                        )}
                        {statusData?.horario_entrada_3 && (
                            <p className="ds-fab-modal-detalhe">
                                Retorno previsto: {formatarHora(statusData.horario_entrada_3 ?? null)}
                            </p>
                        )}
                    </>
                )}

                {/* ─── LIVRE ─── */}
                {(status === 'LIVRE' || status === 'LIVRE_MANUAL') && (
                    <>
                        <div className="ds-fab-modal-status-icon livre">
                            <i className="fas fa-check-circle"></i>
                        </div>
                        <h2 className="ds-fab-modal-status-titulo">Disponível</h2>
                        <p className="ds-fab-modal-mensagem">
                            Aguardando próxima tarefa.<br />
                            O supervisor vai te atribuir em breve.
                        </p>
                        {proximaTarefa && (
                            <>
                                <div className="ds-modal-divisor" />
                                <ProximaTarefa tarefa={proximaTarefa} />
                            </>
                        )}
                    </>
                )}

                {/* ─── FORA DO HORÁRIO ─── */}
                {status === 'FORA_DO_HORARIO' && (
                    <>
                        <div className="ds-fab-modal-status-icon fora">
                            <i className="fas fa-moon"></i>
                        </div>
                        <h2 className="ds-fab-modal-status-titulo">Fora do Horário</h2>
                        <p className="ds-fab-modal-mensagem">Até amanhã! 🌙</p>
                    </>
                )}
            </div>
        </div>
    );
}

// ─── FAB principal ────────────────────────────────────────────────────────────

export default function DashStatusAtualFab() {
    const [statusData, setStatusData] = useState<DashMeuStatus | null>(null);
    const [tempoMs, setTempoMs]       = useState(0);
    const [modalAberto, setModalAberto] = useState(false);

    const pollingRef     = useRef<ReturnType<typeof setInterval> | null>(null);
    const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
    const statusDataRef  = useRef<DashMeuStatus | null>(null);
    const modalAbertoRef = useRef(false);

    useEffect(() => { statusDataRef.current  = statusData;  }, [statusData]);
    useEffect(() => { modalAbertoRef.current = modalAberto; }, [modalAberto]);

    const buscarStatus = useCallback(async () => {
        try {
            const data = await fetchAPI('/api/producao/meu-status');
            setStatusData(data);
        } catch {
            // silencioso — não quebra a UX se a chamada falhar
        }
    }, []);

    const iniciarTimer = useCallback(() => {
        if (timerRef.current) return;
        timerRef.current = setInterval(() => {
            const data = statusDataRef.current;
            if (!data?.tarefa_atual?.data_inicio) { setTempoMs(0); return; }
            const { ms } = calcularTempoEfetivo(data.tarefa_atual.data_inicio ?? '', (data.ponto_hoje ?? null) as object | null);
            setTempoMs(ms);
        }, 1000);
    }, []);

    const pararTimer = useCallback(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
    }, []);

    const iniciarPolling = useCallback(() => {
        if (pollingRef.current) return;
        const intervalo = modalAbertoRef.current ? 15000 : 30000;
        pollingRef.current = setInterval(buscarStatus, intervalo) as ReturnType<typeof setInterval>;
    }, [buscarStatus]);

    const pararPolling = useCallback(() => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
    }, []);

    const reiniciarPolling = useCallback(() => {
        pararPolling();
        iniciarPolling();
    }, [pararPolling, iniciarPolling]);

    useEffect(() => {
        buscarStatus();
        iniciarPolling();
        iniciarTimer();

        const handleVisibilityChange = () => {
            if (document.hidden) {
                pararPolling();
                pararTimer();
            } else {
                buscarStatus();
                iniciarPolling();
                iniciarTimer();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            pararPolling();
            pararTimer();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [buscarStatus, iniciarPolling, iniciarTimer, pararPolling, pararTimer]);

    // Reinicia polling ao abrir/fechar modal (muda o intervalo de 30s → 15s)
    useEffect(() => {
        if (!document.hidden) reiniciarPolling();
    }, [modalAberto, reiniciarPolling]);

    // v1.0/v2.0 é exclusivo para costureiras — tiktiks têm lógica diferente (vX futuro)
    if (statusData?.tipos?.includes('tiktik')) return null;

    const status = statusData?.status_atual || 'FORA_DO_HORARIO';
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.FORA_DO_HORARIO;
    const mostrarTimer = status === 'PRODUZINDO' && tempoMs > 0;

    return (
        <>
            <button
                className={`ds-fab ds-fab--${config.classe}`}
                onClick={() => setModalAberto(true)}
                aria-label={`Status atual: ${config.label}`}
            >
                <i className={`fas ${config.icone}`}></i>
                {mostrarTimer && (
                    <span className="ds-fab-timer">{formatarTempo(tempoMs)}</span>
                )}
            </button>

            {modalAberto && (
                <DashStatusModal
                    statusData={statusData}
                    tempoMs={tempoMs}
                    onClose={() => setModalAberto(false)}
                />
            )}
        </>
    );
}
