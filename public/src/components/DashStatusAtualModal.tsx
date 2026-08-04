import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// @ts-expect-error m�dulo JS legado sem tipos
import { fetchAPI } from '/js/utils/api-utils';
import { calcularTempoEfetivo, formatarHora, formatarTempo } from '../utils/PontoHelpers'
import type { DashMeuStatus, DashTarefaStatus, DashStatusAtualCodigo } from '../utils/dashboard-types';

type StatusConfigKey = string;
interface StatusConfigEntry {
    classe: string;
    icone: string;
    label: string;
    status: string;
    titulo: string;
    contexto: string;
    kicker: string;
}
const STATUS_CONFIG: Record<string, StatusConfigEntry> = {
    PRODUZINDO: { classe: 'produzindo', icone: 'fa-tshirt', label: 'Produzindo', status: 'agora · produzindo', titulo: 'Produzindo agora', contexto: 'Seu ritmo está sendo contado nesta tarefa.', kicker: 'ao vivo' },
    ALMOCO: { classe: 'almoco', icone: 'fa-utensils', label: 'Em almoço', status: 'agora · intervalo', titulo: 'Em almoço', contexto: 'Seu expediente continua depois do intervalo.', kicker: 'intervalo' },
    PAUSA: { classe: 'pausa', icone: 'fa-coffee', label: 'Em pausa', status: 'agora · pausa', titulo: 'Em pausa', contexto: 'Uma pausa rápida antes de retomar o ritmo.', kicker: 'pausa' },
    LIVRE: { classe: 'disponivel', icone: 'fa-check-circle', label: 'Sem tarefa agora', status: 'próximo passo', titulo: 'Sem tarefa agora', contexto: 'Assim que uma nova missão for atribuída, ela aparecerá aqui.', kicker: 'disponível' },
    FOLGA: { classe: 'folga', icone: 'fa-coffee', label: 'Dia de folga', status: 'hoje · folga', titulo: 'Dia de folga', contexto: 'Hoje não há jornada de trabalho prevista para você.', kicker: 'folga hoje' },
    FORA_DO_HORARIO: { classe: 'fora', icone: 'fa-moon', label: 'Fora do horário', status: 'agora · encerrado', titulo: 'Fora do horário', contexto: 'O acompanhamento volta no seu próximo período de trabalho.', kicker: 'encerrado' },
    CONCLUIDA: { classe: 'concluida', icone: 'fa-check-circle', label: 'Tarefa concluída', status: 'concluída · última etapa', titulo: 'Tarefa concluída', contexto: 'Você finalizou esta missão e os pontos já foram registrados.', kicker: 'concluída' },
};

const PROCESSO_CORES = [
    { background: '#dbeafe', color: '#1d4ed8' },
    { background: '#d1fae5', color: '#065f46' },
    { background: '#ede9fe', color: '#5b21b6' },
    { background: '#fef3c7', color: '#92400e' },
    { background: '#fce7f3', color: '#9d174d' },
    { background: '#e0f2fe', color: '#075985' },
    { background: '#ffedd5', color: '#9a3412' },
];

const pluralPeca = (n?: number | null) => n === 1 ? 'peça' : 'peças';
const pluralPonto = (n?: number | null) => n === 1 ? 'ponto' : 'pontos';

function getProcessoCor(processo?: string | null) {
    if (!processo) return PROCESSO_CORES[0];
    let hash = 0;
    for (let i = 0; i < processo.length; i += 1) {
        hash = ((hash << 5) - hash) + processo.charCodeAt(i);
        hash |= 0;
    }
    return PROCESSO_CORES[Math.abs(hash) % PROCESSO_CORES.length];
}

function ehDiaDeFolga(diasTrabalho?: Record<string, boolean> | null) {
    if (!diasTrabalho || typeof diasTrabalho !== 'object') return false;
    const hojeSP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const diaDaSemana = new Date(`${hojeSP}T12:00:00-03:00`).getDay();
    return diasTrabalho[String(diaDaSemana)] === false;
}

function normalizarStatus(statusData?: DashMeuStatus | null): string {
    const status = statusData?.status_atual || 'FORA_DO_HORARIO';
    if (status === 'PAUSA_MANUAL') return 'PAUSA';
    if (status === 'LIVRE_MANUAL') return 'LIVRE';
    if (status === 'CONCLUIDA' || status === 'CONCLUIDO') return 'CONCLUIDA';
    if (status === 'FORA_DO_HORARIO' && ehDiaDeFolga(statusData?.dias_trabalho)) return 'FOLGA';
    return STATUS_CONFIG[status] ? status : 'FORA_DO_HORARIO';
}

function FlipDigit({ valor }: { valor: string }) {
    const anteriorRef = useRef<string>(valor);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [valorAtual, setValorAtual] = useState(valor);
    const [valorAnterior, setValorAnterior] = useState(valor);
    const [animando, setAnimando] = useState(false);

    useEffect(() => {
        if (valor === anteriorRef.current) return undefined;
        setValorAnterior(anteriorRef.current);
        setValorAtual(valor);
        anteriorRef.current = valor;
        setAnimando(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setAnimando(false), 350) as ReturnType<typeof setTimeout>;
        return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
    }, [valor]);

    return (
        <span className={`ds-status-flip-digit${animando ? ' ds-status-flip-digit--animando' : ''}`}>
            <span className="ds-status-flip-digit-atual">{valorAtual}</span>
            <span className="ds-status-flip-digit-anterior">{valorAnterior}</span>
        </span>
    );
}

function FlipClock({ ms }: { ms: number }) {
    const [h1, h2, , m1, m2, , s1, s2] = formatarTempo(ms).split('');
    return (
        <div className="ds-status-flip-clock" aria-label={`Tempo em produção: ${formatarTempo(ms)}`}>
            <FlipDigit valor={h1} /><FlipDigit valor={h2} />
            <span className="ds-status-flip-separador">:</span>
            <FlipDigit valor={m1} /><FlipDigit valor={m2} />
            <span className="ds-status-flip-separador">:</span>
            <FlipDigit valor={s1} /><FlipDigit valor={s2} />
        </div>
    );
}

function PontosHojeBarra({ pontosHoje }: { pontosHoje?: number | null }) {
    const meta = parseFloat(localStorage.getItem('meta_diaria_planejada') || '0');
    if (!meta || pontosHoje === null || pontosHoje === undefined) return null;

    const pontos = Math.max(0, Math.round(Number(pontosHoje) || 0));
    const faltam = Math.max(0, meta - pontos);
    const progresso = Math.min(100, (pontos / meta) * 100);

    return (
        <div className="ds-status-pontos-hoje">
            <div className="ds-status-pontos-hoje-cabecalho">
                <span>Hoje</span>
                <strong>{pontos} pts · {faltam > 0 ? `faltam ${faltam} pts` : 'meta batida!'}</strong>
            </div>
            <div className="ds-status-pontos-hoje-barra" aria-hidden="true"><span style={{ width: `${progresso}%` }} /></div>
            <div className="ds-status-pontos-hoje-legenda"><span>{pontos} pts</span><span>{progresso.toFixed(0)}%</span><span>{meta} pts</span></div>
        </div>
    );
}

function PrevisaoTermino({ tpp, quantidade, tempoMs }: { tpp: number; quantidade: number; tempoMs: number }) {
    const esperadoMs = tpp * quantidade * 1000;
    const restantePadraoMs = esperadoMs - tempoMs;

    if (restantePadraoMs <= 0) {
        return <div className="ds-status-previsao ds-status-previsao--atrasada"><i className="fas fa-bolt" aria-hidden="true" /> Passou do tempo estimado — conclua logo!</div>;
    }

    const proporcao = tempoMs / esperadoMs;
    const restanteRealMs = restantePadraoMs * proporcao;
    const hora = new Date(Date.now() + restanteRealMs).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return <div className="ds-status-previsao"><i className="fas fa-clock" aria-hidden="true" /> No ritmo atual: termina aproximadamente às <strong>{hora}</strong></div>;
}

function ProximaTarefa({ tarefa }: { tarefa?: DashTarefaStatus | null }) {
    if (!tarefa) return null;
    return (
        <div className="ds-status-proxima-tarefa">
            <span className="ds-status-proxima-icone" aria-hidden="true"><i className="fas fa-arrow-right" /></span>
            <span className="ds-status-proxima-copy">
                <span className="ds-status-proxima-label">Próxima missão</span>
                <strong>{tarefa.variante || tarefa.produto_nome}</strong>
                <small>{tarefa.processo} · {tarefa.quantidade} {pluralPeca(tarefa.quantidade)}</small>
            </span>
            {tarefa.imagem && <img className="ds-status-proxima-imagem" src={tarefa.imagem} alt="" />}
            <i className="fas fa-chevron-right ds-status-proxima-seta" aria-hidden="true" />
        </div>
    );
}

function FatoStatus({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
    return <div className="ds-status-fato"><small>{rotulo}</small><strong>{valor}</strong></div>;
}

function StatusIcon({ status }: { status: string }) {
    const config = STATUS_CONFIG[status];
    return <div className={`ds-status-estado-icone ds-status-estado-icone--${config.classe}`} aria-hidden="true"><i className={`fas ${config.icone}`} /></div>;
}

function CorpoProduzindo({ statusData, tempoMs }: { statusData?: DashMeuStatus | null; tempoMs: number }) {
    const tarefa = statusData?.tarefa_atual;
    if (!tarefa) return null;

    const { pausado } = calcularTempoEfetivo(tarefa.data_inicio ?? '', (statusData?.ponto_hoje ?? null) as object | null);
    const pontosTarefa = tarefa.valor_ponto && tarefa.quantidade ? Math.round(tarefa.quantidade * tarefa.valor_ponto) : null;
    const horaInicio = tarefa.data_inicio ? new Date(tarefa.data_inicio).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : null;

    return (
        <>
            <div className="ds-status-tarefa-hero">
                <div className="ds-status-tarefa-imagem">
                    {tarefa.imagem ? <img src={tarefa.imagem} alt="" /> : <i className="fas fa-tshirt" aria-hidden="true" />}
                </div>
                <div className="ds-status-tarefa-copy">
                    <strong>{tarefa.variante || tarefa.produto_nome}</strong>
                    <div className="ds-status-tarefa-meta">
                        <span className="ds-status-processo" style={getProcessoCor(tarefa.processo)}>{tarefa.processo}</span>
                        <span><b>{tarefa.quantidade}</b> {pluralPeca(tarefa.quantidade)}</span>
                    </div>
                    {horaInicio && <small>Iniciado às {horaInicio}</small>}
                </div>
            </div>

            <div className={`ds-status-tempo${pausado ? ' ds-status-tempo--pausado' : ''}`}>
                <span className="ds-status-tempo-label">Tempo em produção</span>
                <FlipClock ms={tempoMs} />
                {pausado && <span className="ds-status-pausado-badge"><i className="fas fa-pause" aria-hidden="true" /> Pausado</span>}
                {!pausado && tarefa.tpp && tempoMs > 60000 && <PrevisaoTermino tpp={tarefa.tpp ?? 0} quantidade={tarefa.quantidade ?? 0} tempoMs={tempoMs} />}
            </div>

            <div className="ds-status-info-grid">
                <FatoStatus rotulo="Esta tarefa" valor={pontosTarefa !== null ? `${pontosTarefa} ${pluralPonto(pontosTarefa)}` : 'Pontuação em apuração'} />
                <FatoStatus rotulo="Estado" valor={pausado ? 'Pausada' : 'Em andamento'} />
            </div>

            {pontosTarefa !== null && <PontosHojeBarra pontosHoje={statusData.pontos_hoje} />}

            <ProximaTarefa tarefa={statusData?.proxima_tarefa} />
        </>
    );
}

function CorpoSimples({ status, statusData }: { status: string; statusData?: DashMeuStatus | null }) {
    const proximaTarefa = statusData?.proxima_tarefa;

    if (status === 'ALMOCO') {
        return <div className="ds-status-estado-simples"><StatusIcon status={status} /><h3>Em almoço</h3><p>Descanse. Seu próximo retorno já está previsto no ponto de hoje.</p><div className="ds-status-fatos"><FatoStatus rotulo="Saída" valor={formatarHora(statusData?.ponto_hoje?.horario_real_s1 || statusData?.horario_saida_1 || null)} /><FatoStatus rotulo="Retorno previsto" valor={formatarHora(statusData?.horario_entrada_2 || null)} /></div><p className="ds-status-nota">Bom apetite! 😊</p></div>;
    }

    if (status === 'PAUSA') {
        return <div className="ds-status-estado-simples"><StatusIcon status={status} /><h3>Em pausa</h3><p>Você está em uma pausa registrada. O próximo ciclo começa no retorno.</p><div className="ds-status-fatos"><FatoStatus rotulo="Saída" valor={formatarHora(statusData?.ponto_hoje?.horario_real_s2 || statusData?.horario_saida_2 || null)} /><FatoStatus rotulo="Retorno previsto" valor={formatarHora(statusData?.horario_entrada_3 || null)} /></div></div>;
    }

    if (status === 'LIVRE') {
        return <div className="ds-status-estado-simples"><StatusIcon status={status} /><h3>Disponível</h3><p>Aguardando próxima tarefa. O supervisor vai te atribuir uma missão em breve.</p><ProximaTarefa tarefa={proximaTarefa} /></div>;
    }

    if (status === 'FOLGA') {
        return <div className="ds-status-estado-simples"><StatusIcon status={status} /><h3>Hoje é sua folga</h3><p>Aproveite o descanso. Nenhuma tarefa ou contagem de produção será iniciada hoje.</p><div className="ds-status-fatos"><FatoStatus rotulo="Próximo expediente" valor="Próximo dia útil" /><FatoStatus rotulo="Status do dia" valor="Descanso" /></div></div>;
    }

    if (status === 'CONCLUIDA') {
        const tarefa = statusData?.tarefa_concluida || statusData?.tarefa_atual;
        const pontos = tarefa?.valor_ponto && tarefa?.quantidade ? Math.round(tarefa.quantidade * tarefa.valor_ponto) : statusData?.pontos_ultima_tarefa;
        return <div className="ds-status-estado-simples"><StatusIcon status={status} /><h3>Etapa concluída</h3><p>Ótimo trabalho. Esta produção foi finalizada e já entrou na sua contagem.</p>{pontos !== null && pontos !== undefined && <div className="ds-status-concluida"><i className="fas fa-sparkles" aria-hidden="true" /><div><strong>+{Math.round(pontos)} pontos registrados</strong><span>{tarefa?.variante || tarefa?.produto_nome || 'Produção finalizada'}</span></div></div>}<ProximaTarefa tarefa={proximaTarefa} /></div>;
    }

    return <div className="ds-status-estado-simples"><StatusIcon status="FORA_DO_HORARIO" /><h3>Fora do horário</h3><p>Seu expediente terminou. As tarefas e pontos voltarão a ser acompanhados no próximo horário de trabalho.</p><div className="ds-status-fatos"><FatoStatus rotulo="Agora" valor="Sem produção" /><FatoStatus rotulo="Próximo acesso" valor="Amanhã" /></div><p className="ds-status-nota">Até amanhã! 🌙</p></div>;
}

function DashStatusModal({ statusData, tempoMs, onClose }: { statusData?: DashMeuStatus | null; tempoMs: number; onClose: () => void }) {
    const status = normalizarStatus(statusData);
    const config = STATUS_CONFIG[status];

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="ds-fab-overlay" onClick={onClose} role="presentation">
            <section className={`ds-fab-modal ds-fab-modal--${config.classe}`} role="dialog" aria-modal="true" aria-labelledby="ds-fab-modal-titulo" onClick={(event) => event.stopPropagation()}>
                <header className="ds-fab-modal-cabecalho">
                    <div className="ds-fab-modal-cabecalho-copy">
                        <div className="ds-fab-modal-status"><span className="ds-fab-modal-status-ponto" aria-hidden="true" /><span>{config.status}</span></div>
                        <h2 id="ds-fab-modal-titulo">{config.titulo}</h2>
                        <p>{config.contexto}</p>
                    </div>
                    <button className="ds-fab-modal-fechar" onClick={onClose} aria-label="Fechar detalhes do status"><i className="fas fa-times" aria-hidden="true" /></button>
                </header>
                <div className="ds-fab-modal-corpo">{status === 'PRODUZINDO' ? <CorpoProduzindo statusData={statusData} tempoMs={tempoMs} /> : <CorpoSimples status={status} statusData={statusData} />}</div>
                <footer className="ds-fab-modal-rodape">Clique no cartão de status a qualquer momento para acompanhar seu trabalho.</footer>
            </section>
        </div>
    );
}

function obterDadosCartao(statusData: DashMeuStatus | null | undefined, status: string, tempoMs: number) {
    const config = STATUS_CONFIG[status];
    const tarefa = statusData?.tarefa_atual;
    if (status === 'PRODUZINDO') return { kicker: config.kicker, titulo: config.titulo, detalhe: `${tarefa?.processo || 'Produção'} · ${tarefa?.quantidade || 0} ${pluralPeca(tarefa?.quantidade || 0)}`, valorLabel: 'tempo percorrido', valor: tempoMs > 0 ? formatarTempo(tempoMs) : '--:--:--' };
    if (status === 'ALMOCO') return { kicker: config.kicker, titulo: config.titulo, detalhe: 'Descanse um pouco', valorLabel: 'retorno previsto', valor: formatarHora(statusData?.horario_entrada_2 ?? null) };
    if (status === 'PAUSA') return { kicker: config.kicker, titulo: config.titulo, detalhe: 'Pausa registrada', valorLabel: 'retorno previsto', valor: formatarHora(statusData?.horario_entrada_3 ?? null) };
    if (status === 'LIVRE') return { kicker: config.kicker, titulo: config.titulo, detalhe: 'Aguardando próxima tarefa', valorLabel: 'próximo passo', valor: '—' };
    if (status === 'FOLGA') return { kicker: config.kicker, titulo: config.titulo, detalhe: 'Próximo expediente em breve', valorLabel: 'status do dia', valor: 'descanso' };
    if (status === 'CONCLUIDA') return { kicker: config.kicker, titulo: config.titulo, detalhe: 'Pontos registrados', valorLabel: 'ganho', valor: `+${statusData?.pontos_ultima_tarefa || 0} pts` };
    return { kicker: config.kicker, titulo: config.titulo, detalhe: 'Até amanhã', valorLabel: 'próximo acesso', valor: 'amanhã' };
}

function StatusLiveCard({ statusData, tempoMs, onOpen }: { statusData?: DashMeuStatus | null; tempoMs: number; onOpen: () => void }) {
    const status = normalizarStatus(statusData);
    const config = STATUS_CONFIG[status];
    const card = obterDadosCartao(statusData, status, tempoMs);
    return (
        <button className={`ds-status-live-card ds-status-live-card--${config.classe}`} type="button" onClick={onOpen} aria-label={`Abrir detalhes: ${config.label}`}>
            <span className="ds-status-live-top">
                <span className="ds-status-live-icone" aria-hidden="true"><i className={`fas ${config.icone}`} /></span>
                <span className="ds-status-live-kicker"><span className="ds-status-live-ponto" aria-hidden="true" />{card.kicker}</span>
                <i className="fas fa-chevron-right ds-status-live-seta" aria-hidden="true" />
            </span>
            <span className="ds-status-live-copy"><strong>{card.titulo}</strong><small>{card.detalhe}</small></span>
            <span className="ds-status-live-metric"><small>{card.valorLabel}</small><strong>{card.valor}</strong></span>
        </button>
    );
}

function StatusLiveCardSkeleton() {
    return (
        <div
            className="ds-status-live-card ds-status-live-card--skeleton"
            aria-busy="true"
            aria-label="Carregando status"
        >
            <span className="ds-status-live-top">
                <span className="ds-status-live-icone" aria-hidden="true"><i className="fas fa-circle-notch fa-spin" /></span>
                <span className="ds-status-live-kicker">Status</span>
            </span>
            <span className="ds-status-live-copy"><strong>Carregando…</strong><small>Atualizando seu dia</small></span>
            <span className="ds-status-live-metric"><small>aguarde</small><strong>—</strong></span>
        </div>
    );
}

export default function DashStatusAtualModal({
    statusInicial = null,
}: {
    /** Status já buscado no bootstrap da página (evita pop-in do card). */
    statusInicial?: DashMeuStatus | null;
}) {
    const [statusData, setStatusData] = useState<DashMeuStatus | null>(statusInicial);
    const [tempoMs, setTempoMs] = useState(0);
    const [modalAberto, setModalAberto] = useState(false);
    const [carregou, setCarregou] = useState(Boolean(statusInicial));
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const statusDataRef = useRef<DashMeuStatus | null>(statusInicial);
    const modalAbertoRef = useRef(false);

    useEffect(() => { statusDataRef.current = statusData; }, [statusData]);
    useEffect(() => { modalAbertoRef.current = modalAberto; }, [modalAberto]);

    // Se o pai entregar status no bootstrap, usa na hora e ainda permite refresh depois
    useEffect(() => {
        if (statusInicial) {
            setStatusData(statusInicial);
            setCarregou(true);
        }
    }, [statusInicial]);

    const buscarStatus = useCallback(async () => {
        try {
            const data = await fetchAPI('/api/producao/meu-status') as DashMeuStatus;
            setStatusData(data);
            setCarregou(true);
        } catch {
            /* status é complementar — se já temos inicial, mantém */
            setCarregou(true);
        }
    }, []);

    const iniciarTimer = useCallback(() => {
        if (timerRef.current) return;
        timerRef.current = setInterval(() => {
            const data = statusDataRef.current;
            if (!data?.tarefa_atual?.data_inicio) { setTempoMs(0); return; }
            setTempoMs(calcularTempoEfetivo(data.tarefa_atual.data_inicio ?? '', (data.ponto_hoje ?? null) as object | null).ms);
        }, 1000);
    }, []);

    const pararTimer = useCallback(() => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; }, []);
    const iniciarPolling = useCallback(() => {
        if (pollingRef.current) return;
        pollingRef.current = setInterval(buscarStatus, modalAbertoRef.current ? 15000 : 30000) as ReturnType<typeof setInterval>;
    }, [buscarStatus]);
    const pararPolling = useCallback(() => { if (pollingRef.current) clearInterval(pollingRef.current); pollingRef.current = null; }, []);
    const reiniciarPolling = useCallback(() => { pararPolling(); iniciarPolling(); }, [pararPolling, iniciarPolling]);

    useEffect(() => {
        // Se já veio no bootstrap, não refaz a 1ª chamada imediata — só polling
        if (!statusInicial) void buscarStatus();
        iniciarPolling();
        iniciarTimer();
        const handleVisibilityChange = () => {
            if (document.hidden) { pararPolling(); pararTimer(); }
            else { buscarStatus(); iniciarPolling(); iniciarTimer(); }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => { pararPolling(); pararTimer(); document.removeEventListener('visibilitychange', handleVisibilityChange); };
    }, [buscarStatus, iniciarPolling, iniciarTimer, pararPolling, pararTimer, statusInicial]);

    useEffect(() => { if (!document.hidden) reiniciarPolling(); }, [modalAberto, reiniciarPolling]);

    if (statusData?.tipos?.includes('tiktik')) return null;
    if (!statusData) {
        // Com bootstrap paralelo, isto só aparece se o endpoint falhar/atrasar
        return carregou ? null : <StatusLiveCardSkeleton />;
    }

    return (
        <>
            <StatusLiveCard statusData={statusData} tempoMs={tempoMs} onOpen={() => setModalAberto(true)} />
            {modalAberto && createPortal(
                <DashStatusModal
                    statusData={statusData}
                    tempoMs={tempoMs}
                    onClose={() => setModalAberto(false)}
                />,
                document.body,
            )}
        </>
    );
}
