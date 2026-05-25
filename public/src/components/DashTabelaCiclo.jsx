import React, { useMemo, useState } from 'react';

const CORES_META = {
    ouro:     '#F9A825',
    prata:    '#78909C',
    bronze:   '#A1887F',
    nao_bateu:'#EF9A9A',
};
const COR_FOLGA     = '#a78bfa'; // roxo — distinto do cinza da prata
const COR_SEM_PROD  = '#E0E0E0';
const COR_FUTURO    = '#F5F5F5';
const TIPOS_FOLGA   = new Set(['feriado_nacional', 'feriado_regional', 'folga_empresa']);
const LABELS_DOW    = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const TIPO_LABEL = {
    feriado_nacional:  { label: 'Feriado Nacional',  icon: 'fa-flag' },
    feriado_regional:  { label: 'Feriado Regional',  icon: 'fa-map-marker-alt' },
    folga_empresa:     { label: 'Folga da Empresa',  icon: 'fa-building' },
    evento:            { label: 'Evento',             icon: 'fa-calendar-day' },
};

function fmtDataLonga(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

export default function DashTabelaCiclo({ blocos, diasDetalhes, eventosCalendario = [], diasTrabalho }) {
    const [eventoPopup, setEventoPopup] = useState(null); // { dateStr, eventos }
    const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

    const diasMap = useMemo(() =>
        Object.fromEntries((diasDetalhes || []).map(d => [d.data, d])),
        [diasDetalhes]
    );

    const eventosMap = useMemo(() => {
        const m = {};
        eventosCalendario.forEach(ev => {
            if (!m[ev.data]) m[ev.data] = [];
            m[ev.data].push(ev);
        });
        return m;
    }, [eventosCalendario]);

    // Datas que são feriado/folga empresa no calendário
    const folgasSet = useMemo(() => {
        const s = new Set();
        eventosCalendario.forEach(ev => {
            if (TIPOS_FOLGA.has(ev.tipo)) s.add(ev.data);
        });
        return s;
    }, [eventosCalendario]);

    // Jornada do empregado (fallback Seg–Sex)
    const jornada = diasTrabalho || { "1":true, "2":true, "3":true, "4":true, "5":true };

    const ehDiaDeTrabalho = (dow, dateStr) =>
        jornada[String(dow)] === true && !folgasSet.has(dateStr);

    // Sem o filtro de data de corte — mostra o ciclo inteiro
    const blocosVisiveis = blocos || [];

    // Métricas do header
    const totalGanho = blocosVisiveis.reduce((acc, b) => acc + b.ganho, 0);
    const totalPontos = blocosVisiveis.reduce((acc, b) => acc + b.pontos, 0);
    const diasTrabalhados = (diasDetalhes || []).filter(d => d.pontos > 0).length;
    const melhorBloco = blocosVisiveis.reduce(
        (best, b) => b.ganho > best.ganho ? b : best,
        blocosVisiveis[0] || { ganho: 0, numero: 1 }
    );

    const fmtDiaMes = (dataISO) => {
        if (!dataISO) return '--';
        const d = new Date(dataISO);
        return `${d.getUTCDate().toString().padStart(2,'0')}/${(d.getUTCMonth()+1).toString().padStart(2,'0')}`;
    };

    // Gera todas as semanas do ciclo como grade 7 colunas (Dom→Sáb)
    // com nulls para preenchimento antes/depois
    const semanasDoCiclo = useMemo(() => {
        if (blocosVisiveis.length === 0) return [];

        // primeiro e último dia do ciclo
        const primeiroDia = new Date(blocosVisiveis[0].inicio);
        primeiroDia.setUTCHours(12, 0, 0, 0);
        const ultimoDia = new Date(blocosVisiveis[blocosVisiveis.length - 1].fim);
        ultimoDia.setUTCHours(12, 0, 0, 0);

        // recua até o domingo da semana do primeiro dia
        const inicio = new Date(primeiroDia);
        inicio.setUTCDate(inicio.getUTCDate() - inicio.getUTCDay());

        // avança até o sábado da semana do último dia
        const fim = new Date(ultimoDia);
        fim.setUTCDate(fim.getUTCDate() + (6 - fim.getUTCDay()));

        const semanas = [];
        let cursor = new Date(inicio);
        let semana = [];

        while (cursor <= fim) {
            const y = cursor.getUTCFullYear();
            const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
            const d = String(cursor.getUTCDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${d}`;
            const dentroDoCiclo = cursor >= primeiroDia && cursor <= ultimoDia;

            semana.push(dentroDoCiclo ? { dateStr, diaNum: cursor.getUTCDate(), dow: cursor.getUTCDay() } : null);

            if (semana.length === 7) {
                semanas.push(semana);
                semana = [];
            }
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        if (semana.length > 0) semanas.push(semana);
        return semanas;
    }, [blocosVisiveis]);

    const corBolinha = (dateStr, dow) => {
        if (!dateStr || dateStr > hojeStr) return COR_FUTURO;
        if (!ehDiaDeTrabalho(dow, dateStr)) return COR_FOLGA;
        const dia = diasMap[dateStr];
        if (!dia || dia.pontos === 0) return COR_SEM_PROD;
        return CORES_META[dia.nivelMeta] || COR_SEM_PROD;
    };

    if (blocosVisiveis.length === 0) {
        return <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Nenhum dado disponível.</div>;
    }

    return (
        <div>
            {/* ── PARTE 1: CHIPS DE MÉTRICAS ── */}
            <div className="ds-extrato-header-metricas">
                <div className="ds-extrato-metrica-chip">
                    <div className="ds-extrato-metrica-valor" style={{ color: 'var(--ds-cor-sucesso)' }}>
                        R$ {totalGanho.toFixed(2)}
                    </div>
                    <div className="ds-extrato-metrica-label">Total ganhos</div>
                </div>
                <div className="ds-extrato-metrica-chip">
                    <div className="ds-extrato-metrica-valor">
                        {Math.round(totalPontos).toLocaleString('pt-BR')}
                    </div>
                    <div className="ds-extrato-metrica-label">Pontos feitos</div>
                </div>
                <div className="ds-extrato-metrica-chip">
                    <div className="ds-extrato-metrica-valor">{diasTrabalhados}</div>
                    <div className="ds-extrato-metrica-label">Dias trabalhados</div>
                </div>
                <div className="ds-extrato-metrica-chip">
                    <div className="ds-extrato-metrica-valor" style={{ fontSize: '1rem' }}>
                        Sem. #{melhorBloco.numero}
                    </div>
                    <div className="ds-extrato-metrica-label">
                        Melhor: R$ {melhorBloco.ganho.toFixed(0)}
                    </div>
                </div>
            </div>

            {/* ── PARTE 2: CALENDÁRIO DO CICLO ── */}
            <div className="ds-cal-container">
                <div className="ds-cal-titulo">Calendário do Ciclo</div>

                {/* Cabeçalho dos dias da semana */}
                <div className="ds-cal-grid-header">
                    {LABELS_DOW.map(l => (
                        <div key={l} className="ds-cal-dow-label">{l}</div>
                    ))}
                </div>

                {/* Semanas */}
                {semanasDoCiclo.map((semana, si) => (
                    <div key={si} className="ds-cal-grid-row">
                        {semana.map((dia, di) => {
                            if (!dia) {
                                return <div key={di} className="ds-cal-celula ds-cal-celula--vazia" />;
                            }
                            const { dateStr, diaNum, dow } = dia;
                            const ehHoje    = dateStr === hojeStr;
                            const ehFuturo  = dateStr > hojeStr;
                            const eventos   = eventosMap[dateStr] || [];
                            const temEvento = eventos.length > 0;
                            const corFundo  = corBolinha(dateStr, dow);
                            const nomeEvento = temEvento ? eventos.map(e => e.descricao).join(', ') : null;

                            return (
                                <div
                                    key={dateStr}
                                    className={`ds-cal-celula${ehHoje ? ' ds-cal-celula--hoje' : ''}${ehFuturo ? ' ds-cal-celula--futuro' : ''}${temEvento ? ' ds-cal-celula--evento' : ''}`}
                                    onClick={temEvento ? () => setEventoPopup({ dateStr, eventos }) : undefined}
                                    role={temEvento ? 'button' : undefined}
                                    tabIndex={temEvento ? 0 : undefined}
                                    onKeyDown={temEvento ? (e) => e.key === 'Enter' && setEventoPopup({ dateStr, eventos }) : undefined}
                                >
                                    <div
                                        className="ds-cal-bolinha"
                                        style={{ background: corFundo }}
                                    >
                                        <span className="ds-cal-dia-num">{diaNum}</span>
                                    </div>
                                    {temEvento && <div className="ds-cal-evento-dot" />}
                                </div>
                            );
                        })}
                    </div>
                ))}

                {/* Legenda */}
                <div className="ds-cal-legenda">
                    {[
                        { cor: CORES_META.ouro,     label: 'Meta Ouro' },
                        { cor: CORES_META.prata,    label: 'Meta Prata' },
                        { cor: CORES_META.bronze,   label: 'Meta Bronze' },
                        { cor: CORES_META.nao_bateu,label: 'Não bateu' },
                        { cor: COR_SEM_PROD,        label: 'Sem produção' },
                        { cor: COR_FOLGA,           label: 'Folga / Feriado' },
                    ].map(({ cor, label }) => (
                        <span key={label} className="ds-cal-legenda-item">
                            <span className="ds-cal-legenda-bolinha" style={{ background: cor }} />
                            {label}
                        </span>
                    ))}
                    <span className="ds-cal-legenda-item">
                        <span className="ds-cal-legenda-evento-dot" />
                        Evento
                    </span>
                </div>
            </div>

            {/* ── PARTE 3: CARDS SEMANAIS ── */}
            <div style={{ marginTop: '8px' }}>
                {blocosVisiveis.map((bloco, idx) => {
                    const inicioStr = new Date(bloco.inicio).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
                    const fimStr   = new Date(bloco.fim).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

                    const ehFuturo  = hojeStr < inicioStr;
                    const ehAtual   = hojeStr >= inicioStr && hojeStr <= fimStr;

                    let badgeTexto = '1ª sem.';
                    let badgeClasse = 'ds-semana-badge-neutral';
                    if (ehFuturo) {
                        badgeTexto = '🔒 Em breve';
                        badgeClasse = 'ds-semana-badge-futuro';
                    } else if (idx > 0) {
                        const anterior = blocosVisiveis[idx - 1].pontos;
                        const atual = bloco.pontos;
                        const pct = Math.round(((atual - anterior) / Math.max(anterior, 1)) * 100);
                        if (atual > anterior) {
                            badgeTexto = `↑ +${pct}%`;
                            badgeClasse = 'ds-semana-badge-up';
                        } else if (atual === anterior) {
                            badgeTexto = '→ igual';
                            badgeClasse = 'ds-semana-badge-neutral';
                        } else {
                            badgeTexto = `↓ ${pct}%`;
                            badgeClasse = 'ds-semana-badge-down';
                        }
                    }

                    const statusCard = ehFuturo  ? 'status-futuro'
                        : ehAtual                ? 'status-atual'
                        : bloco.ganho > 0        ? 'status-ok'
                        : 'status-zero';

                    return (
                        <div key={idx} className={`ds-semana-card ${statusCard}`}>
                            <span className={`ds-semana-badge-comparacao ${badgeClasse}`}>
                                {badgeTexto}
                            </span>
                            <div style={{ fontSize: '0.78rem', color: '#999', marginBottom: '6px', paddingRight: '60px' }}>
                                Semana #{bloco.numero} · {fmtDiaMes(bloco.inicio)} – {fmtDiaMes(bloco.fim)}
                                {ehFuturo && (
                                    <span style={{ marginLeft: '8px', fontSize: '0.68rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase' }}>
                                        em breve
                                    </span>
                                )}
                                {ehAtual && (
                                    <span style={{ marginLeft: '8px', fontSize: '0.68rem', fontWeight: '700', color: 'var(--ds-cor-primaria)', textTransform: 'uppercase' }}>
                                        em andamento
                                    </span>
                                )}
                            </div>
                            <div className="ds-semana-pontos-destaque" style={{ color: ehFuturo ? '#ccc' : undefined }}>
                                {ehFuturo ? '—' : `${Math.round(bloco.pontos)}`}
                                {!ehFuturo && <span style={{ fontSize: '1rem', fontWeight: '400', color: '#999' }}> pts</span>}
                            </div>
                            {!ehFuturo && (
                                <div style={{
                                    fontSize: '0.9rem', fontWeight: '600', marginTop: '2px',
                                    color: bloco.ganho > 0 ? 'var(--ds-cor-sucesso)' : '#bbb'
                                }}>
                                    R$ {bloco.ganho.toFixed(2)} ganhos
                                </div>
                            )}
                            {ehFuturo && (
                                <div style={{ fontSize: '0.82rem', color: '#ccc', marginTop: '4px', fontStyle: 'italic' }}>
                                    Produção ainda não iniciada
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ── POPUP DE EVENTO DO CALENDÁRIO ── */}
            {eventoPopup && (
                <div className="ds-cal-popup-overlay" onClick={() => setEventoPopup(null)}>
                    <div className="ds-cal-popup-content" onClick={e => e.stopPropagation()}>
                        <div className="ds-cal-popup-data">{fmtDataLonga(eventoPopup.dateStr)}</div>
                        <ul className="ds-cal-popup-lista">
                            {eventoPopup.eventos.map((ev, i) => {
                                const info = TIPO_LABEL[ev.tipo] || { label: 'Evento', icon: 'fa-calendar-day' };
                                return (
                                    <li key={i} className="ds-cal-popup-item">
                                        <span className="ds-cal-popup-tipo-badge">
                                            <i className={`fas ${info.icon}`}></i>
                                            {info.label}
                                        </span>
                                        <span className="ds-cal-popup-descricao">{ev.descricao}</span>
                                    </li>
                                );
                            })}
                        </ul>
                        <button className="ds-cal-popup-fechar" onClick={() => setEventoPopup(null)}>
                            Fechar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
