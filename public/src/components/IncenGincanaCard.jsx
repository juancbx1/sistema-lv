// public/src/components/IncenGincanaCard.jsx
import React from 'react';

function formatarDataHora(iso, opcoes = {}) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        ...opcoes,
    });
}

function formatarContagem(segundos) {
    if (!segundos || segundos <= 0) return '–';
    const h = Math.floor(segundos / 3600);
    const m = Math.floor((segundos % 3600) / 60);
    const s = segundos % 60;
    if (h > 0) return `${h}h ${m}min`;
    if (m > 0) return `${m}min ${s}s`;
    return `${s}s`;
}

function fasePretty(fase) {
    switch (fase) {
        case 'ao_vivo':        return { label: 'AO VIVO', cls: 'ao-vivo', dot: true };
        case 'encerrada_semana':
        case 'proxima':        return { label: 'PRÓXIMA', cls: 'proxima', dot: false };
        case 'encerrada':      return { label: 'ENCERRADA', cls: 'encerrada', dot: false };
        case 'arquivada':      return { label: 'ENCERRADA', cls: 'encerrada', dot: false };
        case 'rascunho':       return { label: 'RASCUNHO', cls: 'rascunho', dot: false };
        case 'cancelada':      return { label: 'CANCELADA', cls: 'cancelada', dot: false };
        default:               return { label: fase, cls: 'rascunho', dot: false };
    }
}

function participantesPretty(p) {
    if (p === 'costureiras') return 'Costureiras';
    if (p === 'tiktiks') return 'Tiktiks';
    return 'Costureiras e Tiktiks';
}

function escopoPretty(e, produtoNome) {
    if (e === 'apenas_processos_op') return 'Só processos OP';
    if (e === 'apenas_arremates') return 'Só arremates';
    if (e === 'produto_especifico') return produtoNome ? `Unidades: ${produtoNome}` : 'Produto específico';
    return 'Todos os pontos';
}

function tipoMecanicaPretty(tipoPremiacao, modalidade) {
    if (tipoPremiacao === 'corrida') {
        return {
            icone: '🏁',
            titulo: 'Corrida individual — ganha o primeiro a chegar',
            tag: 'CORRIDA',
        };
    }
    if (modalidade === 'equipe') {
        return {
            icone: '👥',
            titulo: 'Meta de equipe — todas ganham se bater',
            tag: 'EQUIPE',
        };
    }
    return {
        icone: '🎯',
        titulo: 'Meta individual — todos que atingirem ganham',
        tag: 'META',
    };
}

function formatarPremioResumo(premiacoes) {
    if (!premiacoes || premiacoes.length === 0) return null;
    if (premiacoes.length === 1) {
        const p = premiacoes[0];
        return p.descricao_premio || null;
    }
    // Multi-nível: chips
    return null; // handled separately
}

export default function IncenGincanaCard({ gincana, onEditar, onPublicar, onCancelar, onDeletar, onVerRanking }) {
    // fase é usada apenas para visual (badge, borda, countdown)
    const fase = gincana.fase || gincana.status;
    // status do banco determina quais ações aparecem
    const status = gincana.status;

    const faseCSS = fase === 'ao_vivo' ? 'fase-ao-vivo'
                  : fase === 'proxima' ? 'fase-proxima'
                  : fase === 'encerrada' || fase === 'encerrada_semana' || fase === 'arquivada' ? 'fase-encerrada'
                  : fase === 'cancelada' ? 'fase-cancelada'
                  : 'fase-rascunho';

    // Para rascunho, o badge sempre mostra RASCUNHO independente do datetime
    const faseParaBadge = status === 'rascunho' ? 'rascunho'
                        : status === 'cancelada' ? 'cancelada'
                        : fase;
    const { label: badgeLabel, cls: badgeCls, dot } = fasePretty(faseParaBadge);

    const premiacoes = gincana.premiacoes || [];
    const mecanica = tipoMecanicaPretty(gincana.tipo_premiacao, gincana.modalidade);
    const ehUnidade = gincana.escopo_atividade === 'produto_especifico';
    const unidadeLabel = ehUnidade ? 'unidades' : 'pontos';

    // Para bloco de objetivo+prêmio
    const primeiraPremiacao = premiacoes[0];
    const multiNivel = premiacoes.length > 1;

    const tempoRestanteLabel = fase === 'ao_vivo' && gincana.segundos_para_fim > 0
        ? formatarContagem(gincana.segundos_para_fim)
        : fase === 'proxima' && gincana.segundos_para_inicio > 0
            ? formatarContagem(gincana.segundos_para_inicio)
            : null;

    return (
        <div className={`incen-gincana-card ${status === 'rascunho' ? 'fase-rascunho' : faseCSS}`}>
            <div className="card-borda-charme"></div>

            {/* Bloco 1 — Cabeçalho */}
            <div className="incen-gincana-card-body">
                <div className="incen-gincana-emoji">{gincana.banner_emoji || '🏆'}</div>

                <div className="incen-gincana-info">
                    <div className="incen-gincana-cabecalho">
                        <h3 className="incen-gincana-nome">{gincana.nome}</h3>
                        <span className={`incen-gincana-badge ${badgeCls}`}>
                            {dot && <span className="badge-dot"></span>}
                            {badgeLabel}
                        </span>
                        {gincana.tipo_recorrencia === 'semanal' && (
                            <span className="incen-gincana-badge rascunho">SEMANAL</span>
                        )}
                    </div>

                    <div className="incen-gincana-periodo">
                        {gincana.tipo_recorrencia === 'semanal' ? (
                            <>
                                Campanha: {formatarDataHora(gincana.datetime_inicio)} →&nbsp;
                                {formatarDataHora(gincana.datetime_fim)}
                                {gincana.hora_inicio_semana && (
                                    <> · Seg–Sex {gincana.hora_inicio_semana}–{gincana.hora_fim_semana}</>
                                )}
                            </>
                        ) : (
                            <>
                                {formatarDataHora(gincana.datetime_inicio)} →&nbsp;
                                {formatarDataHora(gincana.datetime_fim)}
                            </>
                        )}
                    </div>

                    {gincana.semana_label && (
                        <div className="incen-gincana-countdown">
                            <i className="fas fa-calendar-week"></i>
                            {gincana.semana_label}
                        </div>
                    )}
                </div>
            </div>

            {/* Bloco 2 — Tipo e mecânica */}
            <div className="incen-gincana-tipo-bloco">
                <div className="incen-gincana-tipo-topo">
                    <span className="incen-gincana-tipo-icone">{mecanica.icone}</span>
                    <div className="incen-gincana-tipo-info">
                        <span className="incen-gincana-tipo-titulo">{mecanica.titulo}</span>
                        <span className="incen-gincana-tipo-desc">
                            {participantesPretty(gincana.participantes)} · {escopoPretty(gincana.escopo_atividade, gincana.produto_nome)}
                        </span>
                    </div>
                    {tempoRestanteLabel && (
                        <span className="incen-gincana-tipo-tempo">
                            {fase === 'ao_vivo'
                                ? <><i className="fas fa-hourglass-half"></i> {tempoRestanteLabel}</>
                                : <><i className="fas fa-clock"></i> {tempoRestanteLabel}</>
                            }
                        </span>
                    )}
                </div>
            </div>

            {/* Bloco 3 — Objetivo + Prêmio */}
            {premiacoes.length > 0 && (
                <div className="incen-gincana-criterios">
                    {multiNivel ? (
                        <div className="incen-gincana-chips">
                            {premiacoes.map((p, i) => {
                                const vr = parseFloat(p.valor_premio_reais);
                                const premioLabel = vr > 0
                                    ? `R$ ${vr.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                    : p.descricao_premio;
                                return (
                                    <span key={i} className="incen-chip-nivel">
                                        {p.emoji_icone} {p.nivel_label || `Nível ${i + 1}`} — {p.meta_valor ?? p.meta_pontos} {unidadeLabel} · {premioLabel}
                                    </span>
                                );
                            })}
                        </div>
                    ) : primeiraPremiacao ? (
                        <>
                            <div className="incen-gincana-criterio-bloco">
                                <span className="incen-gincana-criterio-label">OBJETIVO</span>
                                <span className="incen-gincana-criterio-valor--pontos">
                                    {primeiraPremiacao.meta_valor ?? primeiraPremiacao.meta_pontos} {unidadeLabel}
                                </span>
                            </div>
                            <div className="incen-gincana-criterio-bloco">
                                <span className="incen-gincana-criterio-label">PRÊMIO</span>
                                <span className="incen-gincana-criterio-valor--premio">
                                    {parseFloat(primeiraPremiacao.valor_premio_reais) > 0
                                        ? `R$ ${parseFloat(primeiraPremiacao.valor_premio_reais).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                        : `${primeiraPremiacao.emoji_icone} ${primeiraPremiacao.descricao_premio}`
                                    }
                                </span>
                            </div>
                        </>
                    ) : null}
                </div>
            )}

            <div className="incen-gincana-acoes">
                {/* Rascunho: editar, publicar, deletar — independente do datetime */}
                {status === 'rascunho' && (
                    <>
                        <button className="gs-btn gs-btn-secundario" onClick={() => onEditar(gincana)}>
                            <i className="fas fa-pen"></i> Editar
                        </button>
                        <button className="gs-btn gs-btn-primario" onClick={() => onPublicar(gincana)}>
                            <i className="fas fa-play"></i> Publicar
                        </button>
                        <button
                            className="gs-btn gs-btn-secundario"
                            style={{ color: '#ef4444' }}
                            onClick={() => onDeletar(gincana)}
                        >
                            <i className="fas fa-trash"></i>
                        </button>
                    </>
                )}

                {/* Publicada: ranking sempre visível + cancelar só enquanto não encerrou */}
                {status === 'publicada' && (
                    <>
                        <button className="gs-btn gs-btn-secundario" onClick={() => onVerRanking(gincana)}>
                            <i className="fas fa-chart-bar"></i> Ranking
                        </button>
                        {(fase === 'ao_vivo' || fase === 'proxima' || fase === 'encerrada_semana') && (
                            <button
                                className="gs-btn gs-btn-secundario"
                                style={{ color: '#ef4444' }}
                                onClick={() => onCancelar(gincana)}
                            >
                                <i className="fas fa-ban"></i> Cancelar
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
