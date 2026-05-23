// public/src/components/DashFabGincana.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchAPI } from '/js/utils/api-utils';
import { dispararCelebracao } from '../utils/confetes.js';
import UIFeedbackNotFound from './UIFeedbackNotFound.jsx';

// ── Helpers ──────────────────────────────────────────────────────────────────

function useContagem(gincanas, onZerou) {
    const [contagem, setContagem] = useState({});
    const onZerouRef = useRef(onZerou);
    onZerouRef.current = onZerou;

    useEffect(() => {
        const inicial = {};
        for (const g of gincanas) {
            if (g.fase === 'proxima' && g.segundos_para_inicio > 0) {
                inicial[g.id] = g.segundos_para_inicio;
            }
        }
        setContagem(inicial);
    }, [gincanas]);

    useEffect(() => {
        const timer = setInterval(() => {
            setContagem(prev => {
                const next = { ...prev };
                let algumZerou = false;
                for (const id in next) {
                    if (next[id] > 0) {
                        next[id] -= 1;
                        if (next[id] === 0) algumZerou = true;
                    }
                }
                if (algumZerou) setTimeout(() => onZerouRef.current?.(), 300);
                return next;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    return contagem;
}

function formatarHHMM(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    });
}

function formatarDataCurta(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
    });
}

function formatarContagem(seg) {
    if (!seg || seg <= 0) return { h: '00', m: '00', s: '00' };
    const h = Math.floor(seg / 3600);
    const m = Math.floor((seg % 3600) / 60);
    const s = seg % 60;
    const pad = n => String(n).padStart(2, '0');
    return { h: pad(h), m: pad(m), s: pad(s) };
}

function formatarTempoRestante(seg) {
    if (!seg || seg <= 0) return '';
    const h = Math.floor(seg / 3600);
    const m = Math.floor((seg % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min`;
}

// Formata o timestamp de quando a meta foi batida
function formatarGanhoEm(iso) {
    if (!iso) return null;
    const data = new Date(iso);
    const hoje = new Date();
    const hora = data.toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    });
    const ehHoje = data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        === hoje.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    if (ehHoje) return `às ${hora}`;
    return `às ${hora} de ${formatarDataCurta(iso)}`;
}

function calcularEstadoFab(gincanas) {
    if (!gincanas.length) return null;
    const fases = new Set(gincanas.map(g => g.fase));
    if (fases.has('ao_vivo') || fases.has('encerrada_semana')) return 'ao_vivo';
    if (gincanas.some(g => g.fase === 'proxima' && (g.segundos_para_inicio ?? Infinity) < 86400)) return 'proxima';
    if (fases.has('encerrada')) return 'encerrada';
    return null;
}

// Retorna o valor monetário do maior prêmio (bloco verde da dashboard)
function maiorPremio(premiacoes) {
    if (!premiacoes || premiacoes.length === 0) return null;
    const formatarReais = (v) => {
        const n = parseFloat(v);
        if (!n || n <= 0) return null;
        return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };
    if (premiacoes.length === 1) {
        return formatarReais(premiacoes[0].valor_premio_reais) || premiacoes[0].descricao_premio || null;
    }
    // Multi-nível: maior valor_premio_reais
    const comValor = premiacoes.filter(p => parseFloat(p.valor_premio_reais) > 0);
    if (comValor.length > 0) {
        const maior = comValor.reduce((a, b) =>
            parseFloat(b.valor_premio_reais) > parseFloat(a.valor_premio_reais) ? b : a
        );
        return `até ${formatarReais(maior.valor_premio_reais)}`;
    }
    // Fallback (gincanas antigas sem valor_premio_reais)
    const maior = premiacoes.reduce((a, b) =>
        parseFloat(b.meta_valor || 0) > parseFloat(a.meta_valor || 0) ? b : a
    , premiacoes[0]);
    return maior ? `até ${maior.descricao_premio}` : null;
}

// ── BarraProgresso ────────────────────────────────────────────────────────────

function BarraProgresso({ valor, meta, ganhou }) {
    const pct = meta > 0 ? Math.min(100, Math.round((valor / meta) * 100)) : 0;
    return (
        <div className="ds-gincana-barra-wrap">
            <div
                className={`ds-gincana-barra ${ganhou ? 'ds-gincana-barra--ganhou' : ''}`}
                style={{ width: `${pct}%` }}
            ></div>
        </div>
    );
}

// ── InfoPagamento ─────────────────────────────────────────────────────────────

function InfoPagamento({ premioRegistrado, premioPago }) {
    if (!premioRegistrado) return null;
    if (premioPago) {
        return (
            <p className="ds-gincana-premio-pago">
                <i className="fas fa-check-circle"></i> Prêmio pago pelo supervisor.
            </p>
        );
    }
    return (
        <p className="ds-gincana-premio-pendente">
            <i className="fas fa-clock"></i> Prêmio registrado — será pago na próxima sexta.
        </p>
    );
}

// ── GincanaCardItem — novo layout 5.6 ────────────────────────────────────────

function GincanaCardItem({ g, contagemSecs }) {
    const {
        fase, tipo_premiacao, modalidade, escopo_atividade, produto_nome,
        meu_valor, valor_equipe, minha_posicao, total_participantes,
        meu_nivel_ganho, proxima_meta, premiacoes,
        sou_vencedor, premio_registrado, premio_pago, ganho_em,
        encerrada_com_ganhador, vencedor_id,
    } = g;

    const ehCorrida = tipo_premiacao === 'corrida';
    const ehEquipe  = modalidade === 'equipe';
    const ehUnidade = escopo_atividade === 'produto_especifico';
    const unidadeLabel = ehUnidade ? 'unidades' : 'pontos';

    const valorProgresso = ehEquipe ? (valor_equipe || 0) : (meu_valor || 0);

    const metaAlvo = proxima_meta
        ? parseFloat(proxima_meta.meta_valor)
        : premiacoes?.length
            ? Math.max(...premiacoes.map(p => parseFloat(p.meta_valor || p.meta_pontos || 0)))
            : 0;

    const pct = metaAlvo > 0 ? Math.min(100, Math.round((valorProgresso / metaAlvo) * 100)) : 0;
    const ganhou = !!meu_nivel_ganho || (ehCorrida && !!sou_vencedor);
    const melhorNivelGanho = premiacoes?.find(p => p.nivel_label === meu_nivel_ganho)
        || (sou_vencedor && premiacoes?.[0]);
    const ganhoEmLabel = formatarGanhoEm(ganho_em);

    // 5.8 — Celebração na primeira detecção de vitória
    const chaveSession = `celebracao_gincana_${g.id}`;
    const [celebrando, setCelebrando] = useState(false);
    useEffect(() => {
        const eVencedor = !!meu_nivel_ganho || sou_vencedor;
        if (eVencedor && !sessionStorage.getItem(chaveSession)) {
            sessionStorage.setItem(chaveSession, '1');
            dispararCelebracao(g);
            setCelebrando(true);
            setTimeout(() => setCelebrando(false), 4000);
        }
    }, []);

    // Tipo tag
    const tipoTag = ehCorrida ? { label: 'CORRIDA', cls: 'corrida' }
                  : ehEquipe  ? { label: 'EQUIPE',  cls: 'equipe' }
                  : { label: 'INDIVIDUAL', cls: 'individual' };

    const tipoEmoji = ehCorrida ? '🏁' : ehEquipe ? '👥' : '🎯';

    // Prêmio a exibir no bloco verde
    const premioExibir = maiorPremio(premiacoes);

    // ── PROXIMA ──
    if (fase === 'proxima') {
        const secs = contagemSecs ?? g.segundos_para_inicio ?? 0;
        const { h, m, s } = formatarContagem(secs);
        const inicio = g.tipo_recorrencia === 'semanal'
            ? `Próxima Segunda às ${g.hora_inicio_semana || '07:00'}`
            : `${formatarDataCurta(g.datetime_inicio)} às ${formatarHHMM(g.datetime_inicio)}`;

        return (
            <div className={`ds-gincana-card ds-gincana-card--proxima ${celebrando ? 'ds-gincana-card--celebrando' : ''}`}>
                <div className="ds-gincana-topo-novo">
                    <div className="ds-gincana-tipo-col">
                        <span className="ds-gincana-tipo-emoji">{tipoEmoji}</span>
                        <span className={`ds-gincana-tipo-tag ds-gincana-tipo-tag--${tipoTag.cls}`}>{tipoTag.label}</span>
                    </div>
                    <div className="ds-gincana-conteudo-col">
                        <span className="ds-gincana-badge ds-gincana-badge--proxima">VEM AÍ</span>
                        <h3 className="ds-gincana-titulo">{g.nome}</h3>
                        <p className="ds-gincana-periodo">{inicio}</p>
                    </div>
                    {premioExibir && (
                        <div className="ds-gincana-premio-col">
                            <span className="ds-gincana-premio-icone">💰</span>
                            <span className="ds-gincana-premio-label">PRÊMIO</span>
                            <span className="ds-gincana-premio-valor">{premioExibir}</span>
                        </div>
                    )}
                </div>
                <div className="ds-gincana-countdown">
                    <p className="ds-gincana-countdown-label">
                        <i className="fas fa-clock"></i> Começa em:
                    </p>
                    <div className="ds-gincana-countdown-display">
                        {[{ v: h, u: 'horas' }, { v: m, u: 'min' }, { v: s, u: 'seg' }].map((b, i) => (
                            <React.Fragment key={i}>
                                {i > 0 && <span className="ds-gincana-countdown-sep">:</span>}
                                <div className="ds-gincana-countdown-bloco">
                                    <span className="ds-gincana-countdown-num">{b.v}</span>
                                    <span className="ds-gincana-countdown-unidade">{b.u}</span>
                                </div>
                            </React.Fragment>
                        ))}
                    </div>
                </div>
                {g.descricao && <p className="ds-gincana-descricao">{g.descricao}</p>}
                <p className="ds-gincana-aviso-supervisor">
                    <i className="fas fa-coins"></i> Prêmio pago toda sexta pelo supervisor
                </p>
            </div>
        );
    }

    // ── AO VIVO ──
    if (fase === 'ao_vivo' || fase === 'encerrada_semana') {
        const tempoRestante = formatarTempoRestante(g.segundos_para_fim);
        const fimLabel = g.tipo_recorrencia === 'semanal'
            ? `Sexta às ${g.hora_fim_semana || '18:00'}`
            : `${formatarDataCurta(g.datetime_fim)} às ${formatarHHMM(g.datetime_fim)}`;

        // Corrida já encerrada com ganhador
        if (ehCorrida && encerrada_com_ganhador) {
            if (sou_vencedor) {
                return (
                    <div className={`ds-gincana-card ds-gincana-card--ao-vivo ds-gincana-card--ganhou ${celebrando ? 'ds-gincana-card--celebrando' : ''}`}>
                        <div className="ds-gincana-topo-novo">
                            <div className="ds-gincana-tipo-col">
                                <span className="ds-gincana-tipo-emoji">{tipoEmoji}</span>
                                <span className={`ds-gincana-tipo-tag ds-gincana-tipo-tag--${tipoTag.cls}`}>{tipoTag.label}</span>
                            </div>
                            <div className="ds-gincana-conteudo-col">
                                <span className="ds-gincana-badge ds-gincana-badge--ao-vivo"><span className="ds-gincana-dot"></span>AO VIVO</span>
                                <h3 className="ds-gincana-titulo">{g.nome}</h3>
                            </div>
                        </div>
                        <div className="ds-gincana-corrida-vencedor">
                            <p className="ds-gincana-corrida-parabens">🏆 Parabéns! Você foi a primeira a completar!</p>
                            {ganhoEmLabel && <p className="ds-gincana-ganho-em"><i className="fas fa-clock"></i> Meta batida {ganhoEmLabel}</p>}
                            {melhorNivelGanho && (
                                <div className="ds-gincana-v-premio-bloco">
                                    <p className="ds-gincana-v-premio-valor">{melhorNivelGanho.emoji_icone} {melhorNivelGanho.descricao_premio}</p>
                                </div>
                            )}
                            <InfoPagamento premioRegistrado={premio_registrado} premioPago={premio_pago} />
                        </div>
                    </div>
                );
            }
            return (
                <div className="ds-gincana-card ds-gincana-card--ao-vivo">
                    <div className="ds-gincana-topo-novo">
                        <div className="ds-gincana-tipo-col">
                            <span className="ds-gincana-tipo-emoji">{tipoEmoji}</span>
                            <span className={`ds-gincana-tipo-tag ds-gincana-tipo-tag--${tipoTag.cls}`}>{tipoTag.label}</span>
                        </div>
                        <div className="ds-gincana-conteudo-col">
                            <span className="ds-gincana-badge ds-gincana-badge--encerrada">✓ ENCERRADA</span>
                            <h3 className="ds-gincana-titulo">{g.nome}</h3>
                        </div>
                    </div>
                    <p className="ds-gincana-corrida-sem-ganho">
                        Alguém chegou primeiro desta vez. Tente na próxima! 💪
                    </p>
                </div>
            );
        }

        return (
            <div className={`ds-gincana-card ds-gincana-card--ao-vivo ${ganhou ? 'ds-gincana-card--ganhou' : ''} ${celebrando ? 'ds-gincana-card--celebrando' : ''}`}>
                <div className="ds-gincana-topo-novo">
                    <div className="ds-gincana-tipo-col">
                        <span className="ds-gincana-tipo-emoji">{tipoEmoji}</span>
                        <span className={`ds-gincana-tipo-tag ds-gincana-tipo-tag--${tipoTag.cls}`}>{tipoTag.label}</span>
                    </div>
                    <div className="ds-gincana-conteudo-col">
                        <span className="ds-gincana-badge ds-gincana-badge--ao-vivo">
                            <span className="ds-gincana-dot"></span>AO VIVO
                        </span>
                        <h3 className="ds-gincana-titulo">{g.nome}</h3>
                        {tempoRestante && (
                            <p className="ds-gincana-tempo-restante">
                                <i className="fas fa-hourglass-half"></i> Termina em: <strong>{tempoRestante}</strong>
                                {' '}({fimLabel})
                            </p>
                        )}
                    </div>
                    {premioExibir && (
                        <div className="ds-gincana-premio-col">
                            <span className="ds-gincana-premio-icone">💰</span>
                            <span className="ds-gincana-premio-label">PRÊMIO</span>
                            <span className="ds-gincana-premio-valor">{premioExibir}</span>
                        </div>
                    )}
                </div>

                {g.descricao && <p className="ds-gincana-descricao">{g.descricao}</p>}

                {/* Barra de progresso */}
                <div className="ds-gincana-progresso-wrap">
                    <div className="ds-gincana-progresso-topo">
                        {ehEquipe ? (
                            <>
                                <span className="ds-gincana-pontos-valor">
                                    Equipe: {(valor_equipe || 0).toFixed(0)} {unidadeLabel}
                                </span>
                                <span className="ds-gincana-minha-contrib">
                                    Sua contribuição: {(meu_valor || 0).toFixed(0)}
                                </span>
                            </>
                        ) : (
                            <span className="ds-gincana-pontos-valor">
                                {(meu_valor || 0).toFixed(0)} {unidadeLabel}
                            </span>
                        )}
                        {metaAlvo > 0 && (
                            <span className="ds-gincana-meta-label">Meta: {metaAlvo} {unidadeLabel}</span>
                        )}
                    </div>
                    <BarraProgresso valor={valorProgresso} meta={metaAlvo} ganhou={ganhou} />
                    <div className="ds-gincana-progresso-base">
                        <span className="ds-gincana-pct">{pct}%</span>
                        {ganhou ? (
                            <span className="ds-gincana-status-ganhou">✅ {ehEquipe ? 'Equipe bateu a meta!' : 'Você bateu a meta!'}</span>
                        ) : proxima_meta ? (
                            <span className="ds-gincana-status-falta">
                                Faltam {Math.max(0, parseFloat(proxima_meta.meta_valor) - valorProgresso).toFixed(0)} {unidadeLabel}
                            </span>
                        ) : null}
                    </div>
                </div>

                {/* 5.7 — Bloco de vencedora */}
                {ganhou && melhorNivelGanho && (
                    <div className="ds-gincana-corrida-vencedor">
                        {ganhoEmLabel && <p className="ds-gincana-ganho-em"><i className="fas fa-clock"></i> Meta batida {ganhoEmLabel}</p>}
                        <div className="ds-gincana-v-premio-bloco">
                            <p className="ds-gincana-v-premio-valor">{melhorNivelGanho.emoji_icone} {melhorNivelGanho.descricao_premio}</p>
                        </div>
                        <InfoPagamento premioRegistrado={premio_registrado} premioPago={premio_pago} />
                    </div>
                )}

                {!ehEquipe && minha_posicao && total_participantes > 0 && (
                    <p className="ds-gincana-posicao">
                        <i className="fas fa-map-marker-alt"></i>
                        Você está em <strong>{minha_posicao}°</strong> de {total_participantes} participantes
                    </p>
                )}

                {!ganhou && (
                    <p className="ds-gincana-aviso-supervisor">
                        <i className="fas fa-coins"></i> Prêmio pago toda sexta pelo supervisor
                    </p>
                )}
            </div>
        );
    }

    // ── ENCERRADA ──
    if (fase === 'encerrada') {
        if (ehCorrida && !encerrada_com_ganhador) {
            return (
                <div className="ds-gincana-card ds-gincana-card--encerrada encerrada-opaca">
                    <div className="ds-gincana-topo-novo">
                        <div className="ds-gincana-tipo-col">
                            <span className="ds-gincana-tipo-emoji">{tipoEmoji}</span>
                            <span className={`ds-gincana-tipo-tag ds-gincana-tipo-tag--${tipoTag.cls}`}>{tipoTag.label}</span>
                        </div>
                        <div className="ds-gincana-conteudo-col">
                            <span className="ds-gincana-badge ds-gincana-badge--encerrada">✓ ENCERRADA</span>
                            <h3 className="ds-gincana-titulo">{g.nome}</h3>
                        </div>
                    </div>
                    <p className="ds-gincana-nao-ganhou-msg">
                        Ninguém recebeu a premiação dessa vez! Vamos focar mais na próxima gincana! 💪
                    </p>
                </div>
            );
        }

        if (ehCorrida && encerrada_com_ganhador) {
            return (
                <div className={`ds-gincana-card ds-gincana-card--encerrada ${sou_vencedor ? 'ds-gincana-card--ganhou' : 'encerrada-opaca'} ${celebrando ? 'ds-gincana-card--celebrando' : ''}`}>
                    <div className="ds-gincana-topo-novo">
                        <div className="ds-gincana-tipo-col">
                            <span className="ds-gincana-tipo-emoji">{tipoEmoji}</span>
                            <span className={`ds-gincana-tipo-tag ds-gincana-tipo-tag--${tipoTag.cls}`}>{tipoTag.label}</span>
                        </div>
                        <div className="ds-gincana-conteudo-col">
                            <span className="ds-gincana-badge ds-gincana-badge--encerrada">✓ ENCERRADA</span>
                            <h3 className="ds-gincana-titulo">{g.nome}</h3>
                        </div>
                    </div>
                    {sou_vencedor ? (
                        <div className="ds-gincana-corrida-vencedor">
                            <p className="ds-gincana-corrida-parabens">🏆 Você venceu a corrida!</p>
                            {ganhoEmLabel && <p className="ds-gincana-ganho-em"><i className="fas fa-clock"></i> Cruzou a linha {ganhoEmLabel}</p>}
                            {melhorNivelGanho && (
                                <div className="ds-gincana-v-premio-bloco">
                                    <p className="ds-gincana-v-premio-valor">{melhorNivelGanho.emoji_icone} {melhorNivelGanho.descricao_premio}</p>
                                </div>
                            )}
                            <InfoPagamento premioRegistrado={premio_registrado} premioPago={premio_pago} />
                        </div>
                    ) : (
                        <p className="ds-gincana-nao-ganhou-msg">
                            Alguém chegou primeiro desta vez. Na próxima! 💪
                        </p>
                    )}
                </div>
            );
        }

        // Meta encerrada
        const ganhouLabel = ganhou
            ? `✅ ${meu_nivel_ganho} — Meta batida!`
            : `${pct}% — Meta não atingida`;

        return (
            <div className={`ds-gincana-card ds-gincana-card--encerrada ${ganhou ? 'ds-gincana-card--ganhou' : 'encerrada-opaca'} ${celebrando ? 'ds-gincana-card--celebrando' : ''}`}>
                <div className="ds-gincana-topo-novo">
                    <div className="ds-gincana-tipo-col">
                        <span className="ds-gincana-tipo-emoji">{tipoEmoji}</span>
                        <span className={`ds-gincana-tipo-tag ds-gincana-tipo-tag--${tipoTag.cls}`}>{tipoTag.label}</span>
                    </div>
                    <div className="ds-gincana-conteudo-col">
                        <span className="ds-gincana-badge ds-gincana-badge--encerrada">✓ ENCERRADA</span>
                        <h3 className="ds-gincana-titulo">{g.nome}</h3>
                        <p className="ds-gincana-periodo">
                            {formatarDataCurta(g.datetime_inicio)} · {formatarHHMM(g.datetime_inicio)} → {formatarHHMM(g.datetime_fim)}
                        </p>
                    </div>
                    {premioExibir && ganhou && (
                        <div className="ds-gincana-premio-col">
                            <span className="ds-gincana-premio-icone">💰</span>
                            <span className="ds-gincana-premio-label">PRÊMIO</span>
                            <span className="ds-gincana-premio-valor">{premioExibir}</span>
                        </div>
                    )}
                </div>

                <div className="ds-gincana-progresso-wrap">
                    <div className="ds-gincana-progresso-topo">
                        <span className="ds-gincana-pontos-valor">
                            {ehEquipe ? 'Equipe: ' : 'Seu resultado: '}
                            {valorProgresso.toFixed(0)} {unidadeLabel}
                        </span>
                    </div>
                    <BarraProgresso valor={valorProgresso} meta={metaAlvo} ganhou={ganhou} />
                    <p className={`ds-gincana-resultado-label ${ganhou ? 'ganhou' : 'nao-ganhou'}`}>
                        {ganhouLabel}
                    </p>
                </div>

                {ganhou && melhorNivelGanho && (
                    <div className="ds-gincana-corrida-vencedor">
                        {ganhoEmLabel && <p className="ds-gincana-ganho-em"><i className="fas fa-clock"></i> Meta batida {ganhoEmLabel}</p>}
                        <div className="ds-gincana-v-premio-bloco">
                            <p className="ds-gincana-v-premio-valor">{melhorNivelGanho.emoji_icone} {melhorNivelGanho.descricao_premio}</p>
                        </div>
                        <InfoPagamento premioRegistrado={premio_registrado} premioPago={premio_pago} />
                    </div>
                )}

                {!ganhou && (
                    <p className="ds-gincana-nao-ganhou-msg">
                        {ehEquipe
                            ? `A equipe precisava de ${metaAlvo} ${unidadeLabel}. Na próxima! 💪`
                            : `Você precisava de ${metaAlvo} ${unidadeLabel}. Na próxima! 💪`
                        }
                    </p>
                )}

                {!ehEquipe && minha_posicao && total_participantes > 0 && (
                    <p className="ds-gincana-posicao">
                        <i className="fas fa-map-marker-alt"></i>
                        Você ficou em <strong>{minha_posicao}°</strong> de {total_participantes} participantes
                    </p>
                )}
            </div>
        );
    }

    // Semanal encerrada no fim de semana
    if (g.semana_label?.includes('encerrada')) {
        return (
            <div className="ds-gincana-card ds-gincana-card--encerrada encerrada-opaca">
                <div className="ds-gincana-topo-novo">
                    <div className="ds-gincana-tipo-col">
                        <span className="ds-gincana-tipo-emoji">{tipoEmoji}</span>
                        <span className={`ds-gincana-tipo-tag ds-gincana-tipo-tag--${tipoTag.cls}`}>{tipoTag.label}</span>
                    </div>
                    <div className="ds-gincana-conteudo-col">
                        <span className="ds-gincana-badge ds-gincana-badge--encerrada">{g.semana_label}</span>
                        <h3 className="ds-gincana-titulo">{g.nome}</h3>
                    </div>
                </div>
                <p className="ds-gincana-descricao">
                    {ganhou
                        ? `✅ Semana encerrada — Você bateu a meta!`
                        : `Semana encerrada — Próxima começa na Segunda.`}
                </p>
                {ganhou && <InfoPagamento premioRegistrado={premio_registrado} premioPago={premio_pago} />}
            </div>
        );
    }

    return null;
}

// ── FiltroVazio — estado vazio inteligente com fallback em cascata ────────────

function FiltroVazio({ filtroAtivo, countProxima, setFiltroAtivo }) {
    // Hierarquia: ao_vivo → proximas → todas
    let icon, titulo, mensagem, linkLabel, linkFiltro;

    if (filtroAtivo === 'ao_vivo') {
        icon = 'fa-trophy';
        titulo = 'Nenhuma gincana ao vivo';
        mensagem = 'Nenhuma competição acontecendo agora.';
        if (countProxima > 0) {
            linkLabel = `Ver Próximas (${countProxima})`;
            linkFiltro = 'proximas';
        } else {
            linkLabel = 'Ver Todas';
            linkFiltro = 'todas';
        }
    } else if (filtroAtivo === 'proximas') {
        icon = 'fa-clock';
        titulo = 'Nenhuma gincana agendada';
        mensagem = 'Não há competições programadas no momento.';
        linkLabel = 'Ver Todas';
        linkFiltro = 'todas';
    } else if (filtroAtivo === 'conquistadas') {
        icon = 'fa-star';
        titulo = 'Nenhuma conquista ainda';
        mensagem = 'Participe de uma gincana e bata a meta para ganhar! 💪';
        linkLabel = null;
    } else if (filtroAtivo === 'encerradas') {
        icon = 'fa-flag-checkered';
        titulo = 'Nenhuma gincana encerrada';
        mensagem = 'Gincanas encerradas aparecem por até 24h.';
        linkLabel = null;
    } else {
        icon = 'fa-trophy';
        titulo = 'Sem gincanas disponíveis';
        mensagem = 'Nenhuma competição ativa no momento.';
        linkLabel = null;
    }

    return (
        <UIFeedbackNotFound icon={icon} titulo={titulo} mensagem={mensagem}>
            {linkLabel && (
                <button className="ds-filtro-vazio-link" onClick={() => setFiltroAtivo(linkFiltro)}>
                    <i className="fas fa-arrow-right"></i> {linkLabel}
                </button>
            )}
        </UIFeedbackNotFound>
    );
}

// ── DashFabGincana ─────────────────────────────────────────────────────────────

const iconesPorEstado = {
    ao_vivo: '🏆',
    proxima: '⏰',
    encerrada: '✓',
};

export default function DashFabGincana() {
    const [gincanas, setGincanas] = useState([]);
    const [aberto, setAberto] = useState(false);
    // 5.5 — Filtro ativo no bottom sheet (padrão ao_vivo)
    const [filtroAtivo, setFiltroAtivo] = useState('ao_vivo');
    const fetchIntervalRef = useRef(null);

    const buscar = useCallback(async () => {
        try {
            const resultado = await fetchAPI('/api/gincanas/dashboard');
            setGincanas(Array.isArray(resultado) ? resultado : []);
        } catch {
            setGincanas([]);
        }
    }, []);

    useEffect(() => {
        buscar();
        fetchIntervalRef.current = setInterval(buscar, 10 * 60 * 1000);

        const aoMudarVisibilidade = () => {
            if (document.visibilityState === 'visible') {
                buscar();
                fetchIntervalRef.current = setInterval(buscar, 10 * 60 * 1000);
            } else {
                clearInterval(fetchIntervalRef.current);
            }
        };
        document.addEventListener('visibilitychange', aoMudarVisibilidade);
        return () => {
            clearInterval(fetchIntervalRef.current);
            document.removeEventListener('visibilitychange', aoMudarVisibilidade);
        };
    }, [buscar]);

    const contagem = useContagem(gincanas, buscar);

    const estadoFab = calcularEstadoFab(gincanas);
    if (!estadoFab) return null;

    // 5.5 — Filtrar encerradas > 24h
    const gincanasVisiveis = gincanas.filter(g => {
        if (g.fase !== 'encerrada') return true;
        const fim = new Date(g.datetime_fim);
        const limite24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return fim > limite24h;
    });

    // Contagens por filtro
    const countAoVivo = gincanasVisiveis.filter(g => g.fase === 'ao_vivo' || g.fase === 'encerrada_semana').length;
    const countProxima = gincanasVisiveis.filter(g => g.fase === 'proxima').length;
    const countConquistadas = gincanasVisiveis.filter(g => !!g.meu_nivel_ganho || !!g.sou_vencedor).length;
    const countEncerradas = gincanasVisiveis.filter(g => g.fase === 'encerrada').length;

    // 5.5 — Ordenação quando filtro "Todas"
    function ordenarGincanas(lista) {
        return [...lista].sort((a, b) => {
            const prioA = a.fase === 'ao_vivo' || a.fase === 'encerrada_semana' ? 0
                        : a.fase === 'proxima' ? 1
                        : a.fase === 'encerrada' ? 2 : 3;
            const prioB = b.fase === 'ao_vivo' || b.fase === 'encerrada_semana' ? 0
                        : b.fase === 'proxima' ? 1
                        : b.fase === 'encerrada' ? 2 : 3;
            if (prioA !== prioB) return prioA - prioB;
            // Mesmo grupo: ao_vivo/encerrada_semana por segundos_para_fim ASC
            if (prioA === 0) return (a.segundos_para_fim ?? 0) - (b.segundos_para_fim ?? 0);
            // proxima: por segundos_para_inicio ASC
            if (prioA === 1) return (a.segundos_para_inicio ?? 0) - (b.segundos_para_inicio ?? 0);
            // encerrada: por datetime_fim DESC
            if (prioA === 2) return new Date(b.datetime_fim) - new Date(a.datetime_fim);
            return 0;
        });
    }

    // Gincanas filtradas para exibição no sheet
    let gincanasExibidas;
    switch (filtroAtivo) {
        case 'ao_vivo':
            gincanasExibidas = gincanasVisiveis.filter(g => g.fase === 'ao_vivo' || g.fase === 'encerrada_semana');
            break;
        case 'proximas':
            gincanasExibidas = gincanasVisiveis.filter(g => g.fase === 'proxima');
            break;
        case 'conquistadas':
            gincanasExibidas = gincanasVisiveis.filter(g => !!g.meu_nivel_ganho || !!g.sou_vencedor);
            break;
        case 'encerradas':
            gincanasExibidas = gincanasVisiveis.filter(g => g.fase === 'encerrada');
            break;
        default:
            gincanasExibidas = ordenarGincanas(gincanasVisiveis);
    }

    const filtros = [
        { id: 'todas', label: 'Todas' },
        { id: 'ao_vivo', label: `Ao vivo${countAoVivo > 0 ? ` (${countAoVivo})` : ''}` },
        { id: 'proximas', label: `Próximas${countProxima > 0 ? ` (${countProxima})` : ''}` },
        { id: 'conquistadas', label: 'Conquistadas' },
        { id: 'encerradas', label: `Encerradas${countEncerradas > 0 ? ` (${countEncerradas})` : ''}` },
    ];

    return (
        <>
            <button
                className={`ds-fab-gincana ds-fab-gincana--${estadoFab}`}
                onClick={() => setAberto(true)}
                title="Gincanas"
            >
                <span className="ds-fab-gincana-icone">{iconesPorEstado[estadoFab]}</span>
                {gincanas.length > 1 && (
                    <span className="ds-fab-gincana-badge">{gincanas.length}</span>
                )}
            </button>

            {aberto && (
                <div className="ds-fab-gincana-overlay" onClick={() => setAberto(false)}>
                    <div className="ds-fab-gincana-sheet" onClick={e => e.stopPropagation()}>
                        <div className="ds-fab-gincana-sheet-header">
                            <h3>Gincanas</h3>
                            <button className="ds-fab-gincana-fechar" onClick={() => setAberto(false)}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        {/* 5.5 — Filtros horizontais */}
                        <div className="ds-fab-gincana-filtros">
                            {filtros.map(f => (
                                <button
                                    key={f.id}
                                    className={`ds-filtro-btn ${filtroAtivo === f.id ? 'ativo' : ''}`}
                                    onClick={() => setFiltroAtivo(f.id)}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>

                        <div className="ds-fab-gincana-sheet-lista">
                            {gincanasExibidas.length === 0 ? (
                                <FiltroVazio
                                    filtroAtivo={filtroAtivo}
                                    countProxima={countProxima}
                                    setFiltroAtivo={setFiltroAtivo}
                                />
                            ) : (
                                gincanasExibidas.map(g => (
                                    <GincanaCardItem
                                        key={g.id}
                                        g={g}
                                        contagemSecs={g.fase === 'proxima' ? contagem[g.id] : undefined}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
