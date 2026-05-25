import React from 'react';
import DashTabelaCiclo from './DashTabelaCiclo';

function fmtDataCurta(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

export default function DashDesempenhoModal({ dadosAcumulados, diasTrabalho, periodo, onClose }) {
    if (!dadosAcumulados) return null;

    const blocos       = dadosAcumulados.blocos || [];
    const totalGanho   = blocos.reduce((acc, b) => acc + b.ganho, 0);
    const totalPontos  = blocos.reduce((acc, b) => acc + b.pontos, 0);
    const diasTrab     = (dadosAcumulados.diasDetalhes || []).filter(d => d.pontos > 0).length;

    const periodoTexto = periodo
        ? `${fmtDataCurta(periodo.inicio)} – ${fmtDataCurta(periodo.fim)}`
        : null;

    return (
        <div className="ds-popup-overlay ativo" onClick={onClose} style={{ zIndex: 1100 }}>
            <div className="ds-extrato-modal" onClick={e => e.stopPropagation()}>

                {/* ── Topo dark ── */}
                <div className="ds-extrato-topo">
                    <button className="ds-cofre-close" onClick={onClose} aria-label="Fechar">
                        <i className="fas fa-times" aria-hidden="true" />
                    </button>

                    <div className="ds-extrato-topo-icone">
                        <i className="fas fa-chart-line" aria-hidden="true" />
                    </div>

                    <div className="ds-extrato-topo-ganho">
                        R$ {totalGanho.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="ds-extrato-topo-ganho-label">estimado no ciclo</div>

                    <div className="ds-extrato-topo-chips">
                        <span className="ds-extrato-topo-chip">
                            <i className="fas fa-star" aria-hidden="true" />
                            {Math.round(totalPontos).toLocaleString('pt-BR')} pts
                        </span>
                        <span className="ds-extrato-topo-chip">
                            <i className="fas fa-calendar-check" aria-hidden="true" />
                            {diasTrab} dias
                        </span>
                        {periodoTexto && (
                            <span className="ds-extrato-topo-chip">
                                <i className="fas fa-calendar-alt" aria-hidden="true" />
                                {periodoTexto}
                            </span>
                        )}
                    </div>
                </div>

                {/* ── Conteúdo scrollável ── */}
                <div className="ds-extrato-corpo">
                    <DashTabelaCiclo
                        blocos={blocos}
                        diasDetalhes={dadosAcumulados.diasDetalhes || []}
                        eventosCalendario={dadosAcumulados.eventosCalendario || []}
                        diasTrabalho={diasTrabalho}
                    />
                </div>

            </div>
        </div>
    );
}
