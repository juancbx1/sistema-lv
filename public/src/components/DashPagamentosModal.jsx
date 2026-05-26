import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { fetchAPI } from '/js/utils/api-utils';

function formatarData(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function formatarPeriodo(isoInicio, isoFim) {
    if (!isoInicio || !isoFim) return '';
    const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', timeZone: 'UTC'
    });
    return `${fmt(isoInicio)} – ${fmt(isoFim)}`;
}

// ─── TOPO ESTILO CARTÃO ────────────────────────────────────────────────────
function WalletTopo({ onClose, abaAtiva, acumuladoCicloAtual, saldoPremiacoes, loadingPremiacoes }) {
    const valorCom = parseFloat(acumuladoCicloAtual?.valor) || 0;
    const valorPre = saldoPremiacoes || 0;
    const periodoAtual = acumuladoCicloAtual
        ? formatarPeriodo(acumuladoCicloAtual.periodoInicio, acumuladoCicloAtual.periodoFim)
        : '';

    // Valores exibidos — animados por requestAnimationFrame
    const [displayCom, setDisplayCom] = useState(0);
    const [displayPre, setDisplayPre] = useState(valorPre);
    const rafRef      = useRef(null);
    const abaAnterior = useRef(null); // null = primeira execução

    const animarContador = useCallback((setDisplay, alvo, duracao = 550) => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        const inicio = performance.now();
        function step(agora) {
            const p      = Math.min((agora - inicio) / duracao, 1);
            const eased  = 1 - Math.pow(1 - p, 3); // ease-out cúbico
            setDisplay(alvo * eased);
            if (p < 1) rafRef.current = requestAnimationFrame(step);
            else        setDisplay(alvo);
        }
        rafRef.current = requestAnimationFrame(step);
    }, []);

    // Na montagem: anima comissões (aba inicial)
    useEffect(() => {
        animarContador(setDisplayCom, valorCom);
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Ao trocar de aba: anima o card que acabou de entrar em foco
    useEffect(() => {
        if (abaAnterior.current === null) {
            abaAnterior.current = abaAtiva;
            return; // mount já animou acima
        }
        if (abaAnterior.current === abaAtiva) return;
        abaAnterior.current = abaAtiva;

        if (abaAtiva === 'comissoes') {
            setDisplayCom(0);
            animarContador(setDisplayCom, valorCom);
        } else {
            setDisplayPre(0);
            animarContador(setDisplayPre, valorPre);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abaAtiva]);

    const comFeatured = abaAtiva === 'comissoes';
    const fmtBRL = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    return (
        <div className="wallet-topo">
            <button className="ds-modal-close-simple" onClick={onClose}>
                <i className="fas fa-times" />
            </button>
            <div className="wallet-topo-titulo">💳 Minha Carteira</div>
            <div className="wallet-saldos">
                <div className={`wsaldo com${comFeatured ? ' wsaldo--featured' : ' wsaldo--dimmed'}`}>
                    <div className="wsaldo-label">
                        <i className="fas fa-chart-line" /> Ciclo em curso
                    </div>
                    <div className="wsaldo-valor">
                        {fmtBRL(displayCom)}
                    </div>
                    {periodoAtual && (
                        <div className="wsaldo-sub">{periodoAtual}</div>
                    )}
                </div>
                <div className={`wsaldo pre${!comFeatured ? ' wsaldo--featured' : ' wsaldo--dimmed'}`}>
                    <div className="wsaldo-label">
                        <i className="fas fa-trophy" /> Premiações
                    </div>
                    <div className={`wsaldo-valor${loadingPremiacoes ? ' loading' : ''}`}>
                        {loadingPremiacoes ? '...' : fmtBRL(displayPre)}
                    </div>
                </div>
            </div>
            <p className="wallet-estimado-nota">* Valores estimados · atualizado ao carregar</p>
        </div>
    );
}

const POR_PAGINA_WALLET = 5;

function WalletPaginacao({ pagina, total, porPagina, onChange }) {
    const totalPags = Math.ceil(total / porPagina);
    if (totalPags <= 1) return null;
    return (
        <div className="wallet-paginacao">
            <button
                className="wallet-pag-btn"
                onClick={() => onChange(pagina - 1)}
                disabled={pagina === 1}
            >
                <i className="fas fa-chevron-left" />
            </button>
            <span className="wallet-pag-info">{pagina} / {totalPags}</span>
            <button
                className="wallet-pag-btn"
                onClick={() => onChange(pagina + 1)}
                disabled={pagina === totalPags}
            >
                <i className="fas fa-chevron-right" />
            </button>
        </div>
    );
}

// ─── CARD PRÓXIMO PAGAMENTO ────────────────────────────────────────────────
function ProxPagamentoCard({ pagamentoCicloFechado }) {
    const valor = parseFloat(pagamentoCicloFechado?.valor) || 0;
    const periodo = pagamentoCicloFechado
        ? formatarPeriodo(pagamentoCicloFechado.periodoInicio, pagamentoCicloFechado.periodoFim)
        : '';
    const dataFormatada = pagamentoCicloFechado?.dataPagamentoFormatada || null;

    return (
        <div className="prox-pag">
            <div className="prox-pag-topo">
                <i className="fas fa-money-bill-wave" />
                <span>Próximo pagamento</span>
            </div>

            {/* corpo com inline styles para garantir visibilidade independente de CSS externo */}
            <div style={{
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                background: '#f0fdf4',
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <strong style={{ fontSize: '1.2rem', fontWeight: 800, color: '#15803d' }}>
                        {valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </strong>
                    <span style={{ fontSize: '0.72rem', color: '#4b7c5a' }}>
                        {periodo ? `Ciclo fechado · ${periodo}` : 'Ciclo anterior'}
                    </span>
                </div>
                <div className="chip-ciclo">
                    <i className="fas fa-lock" /> ciclo encerrado
                </div>
            </div>

            {dataFormatada && (
                <div className="prox-pag-data">
                    <i className="fas fa-calendar-check" />
                    Recebe em <strong>{dataFormatada}</strong>
                </div>
            )}
            {!dataFormatada && (
                <div style={{
                    padding: '8px 14px',
                    fontSize: '0.73rem',
                    color: '#6b7280',
                    borderTop: '1px solid #bbf7d0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: '#f0fdf4',
                }}>
                    <i className="fas fa-info-circle" style={{ color: '#9ca3af' }} />
                    {pagamentoCicloFechado
                        ? 'Nenhuma produção no ciclo anterior'
                        : 'Recarregue a página para ver os valores'}
                </div>
            )}
        </div>
    );
}

// ─── ABA COMISSÕES ─────────────────────────────────────────────────────────
function fmtMesAno(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('pt-BR', {
        month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo',
    });
}

function AbaComissoes({ pagamentoCicloFechado, historico, loading }) {
    const [grupo, setGrupo] = useState(0);

    // Agrupa o histórico em janelas de 3 meses (mais recente primeiro)
    const grupos = useMemo(() => {
        if (!historico.length) return [[]];
        const sorted = [...historico].sort(
            (a, b) => new Date(b.data_pagamento) - new Date(a.data_pagamento)
        );
        const result = [];
        for (let i = 0; i < sorted.length; i += 3) result.push(sorted.slice(i, i + 3));
        return result;
    }, [historico]);

    const totalGrupos = grupos.length;
    const grupoAtual  = grupos[grupo] || [];

    const labelPeriodo = useMemo(() => {
        if (!grupoAtual.length) return '';
        const datas = grupoAtual.map(p => new Date(p.data_pagamento));
        const mais_recente = datas[0];
        const mais_antigo  = datas[datas.length - 1];
        if (fmtMesAno(mais_recente) === fmtMesAno(mais_antigo)) return fmtMesAno(mais_recente);
        return `${fmtMesAno(mais_antigo)} – ${fmtMesAno(mais_recente)}`;
    }, [grupoAtual]);

    return (
        <>
            <ProxPagamentoCard pagamentoCicloFechado={pagamentoCicloFechado} />

            <div className="ds-pag-hist-header">
                <h3 className="ds-pag-secao-titulo" style={{ margin: 0 }}>Comissões Pagas</h3>
                {!loading && totalGrupos > 1 && (
                    <div className="ds-pag-hist-nav">
                        <button
                            className="ds-pag-hist-nav-btn"
                            onClick={() => setGrupo(g => g + 1)}
                            disabled={grupo >= totalGrupos - 1}
                            aria-label="Período anterior"
                        >
                            <i className="fas fa-chevron-left" />
                        </button>
                        <span className="ds-pag-hist-periodo">{labelPeriodo}</span>
                        <button
                            className="ds-pag-hist-nav-btn"
                            onClick={() => setGrupo(g => g - 1)}
                            disabled={grupo === 0}
                            aria-label="Período mais recente"
                        >
                            <i className="fas fa-chevron-right" />
                        </button>
                    </div>
                )}
            </div>

            <div className="ds-pag-lista-scroll">
                {loading ? (
                    <div className="ds-spinner" style={{ margin: '20px auto' }} />
                ) : historico.length === 0 ? (
                    <p className="ds-pag-vazio-inline">Nenhum pagamento anterior.</p>
                ) : (
                    grupoAtual.map((pgto, idx) => (
                        <div key={idx} className="ds-pag-historico-linha">
                            <div>
                                <div className="ds-pag-historico-descricao">
                                    {pgto.ciclo_nome || pgto.descricao || 'Comissão'}
                                </div>
                                <div className="ds-pag-historico-data">
                                    Pago em: {formatarData(pgto.data_pagamento)}
                                </div>
                            </div>
                            <div className="ds-pag-historico-direita">
                                <div className="ds-pag-historico-valor">
                                    R$ {parseFloat(pgto.valor_liquido_pago).toFixed(2)}
                                </div>
                                <span className="ds-pag-badge-pago">CONCLUÍDO</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </>
    );
}

// ─── ABA PREMIAÇÕES ────────────────────────────────────────────────────────
function AbaPremiacoes({ pendentes, pagos, loading }) {
    const [paginaPagos, setPaginaPagos] = useState(1);

    const inicioPagos = (paginaPagos - 1) * POR_PAGINA_WALLET;
    const pagosPagina = pagos.slice(inicioPagos, inicioPagos + POR_PAGINA_WALLET);

    return (
        <>
            <p className="ds-pag-bolso-label">
                <i className="fas fa-trophy" /> Prêmios de Gincanas
                <span className="ds-pag-bolso-hint">Pagos toda sexta-feira</span>
            </p>

            {loading ? (
                <div className="ds-spinner" style={{ margin: '30px auto' }} />
            ) : (
                <>
                    {pendentes.length > 0 ? (
                        <div className="ds-pag-premios-secao">
                            <h3 className="ds-pag-secao-titulo ds-pag-secao-titulo--pendente">
                                <i className="fas fa-clock" /> A receber ({pendentes.length})
                            </h3>
                            <div className="ds-pag-premios-lista">
                                {pendentes.map(p => (
                                    <div key={p.id} className="ds-pag-premio-item ds-pag-premio-item--pendente">
                                        <span className="ds-pag-premio-emoji">{p.banner_emoji}</span>
                                        <div className="ds-pag-premio-info">
                                            <p className="ds-pag-premio-gincana">{p.gincana_nome}</p>
                                            <p className="ds-pag-premio-nivel">{p.nivel_label} — {p.descricao_premio}</p>
                                            <p className="ds-pag-premio-data">Ganho em: {formatarData(p.ganho_em)}</p>
                                        </div>
                                        <span className="ds-pag-badge-pendente">A RECEBER</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="ds-pag-vazio">
                            <i className="fas fa-trophy" style={{ opacity: 0.3 }} />
                            <p>Nenhum prêmio pendente.</p>
                            <small>Participe das gincanas e ganhe prêmios toda sexta!</small>
                        </div>
                    )}

                    {pagos.length > 0 && (
                        <div className="ds-pag-premios-secao">
                            <h3 className="ds-pag-secao-titulo">Histórico de Premiações</h3>
                            <div className="ds-pag-lista-scroll">
                                {pagosPagina.map(p => (
                                    <div key={p.id} className="ds-pag-historico-linha">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <span style={{ fontSize: '1.2rem' }}>{p.banner_emoji}</span>
                                            <div>
                                                <div className="ds-pag-historico-descricao">{p.gincana_nome}</div>
                                                <div className="ds-pag-historico-data">
                                                    {p.nivel_label} · Pago em: {formatarData(p.pago_em)}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="ds-pag-historico-direita">
                                            {p.valor_reais && (
                                                <div className="ds-pag-historico-valor">
                                                    R$ {parseFloat(p.valor_reais).toFixed(2)}
                                                </div>
                                            )}
                                            <span className="ds-pag-badge-pago">PAGO</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <WalletPaginacao
                                pagina={paginaPagos}
                                total={pagos.length}
                                porPagina={POR_PAGINA_WALLET}
                                onChange={setPaginaPagos}
                            />
                        </div>
                    )}
                </>
            )}
        </>
    );
}

// ─── MODAL PRINCIPAL ──────────────────────────────────────────────────────
export default function DashPagamentosModal({ acumuladoCicloAtual, pagamentoCicloFechado, usuario, onClose }) {
    const [aba, setAba] = useState('comissoes');
    const [historicoCom, setHistoricoCom] = useState([]);
    const [loadingCom, setLoadingCom] = useState(true);
    const [dadosPre, setDadosPre] = useState({ pendentes: [], pagos: [] });
    const [loadingPre, setLoadingPre] = useState(true);

    useEffect(() => {
        fetchAPI('/api/dashboard/meus-pagamentos')
            .then(d => setHistoricoCom(d))
            .catch(() => setHistoricoCom([]))
            .finally(() => setLoadingCom(false));

        fetchAPI('/api/gincanas-pagamentos/meus-premios')
            .then(d => setDadosPre(d))
            .catch(() => setDadosPre({ pendentes: [], pagos: [] }))
            .finally(() => setLoadingPre(false));
    }, []);

    const saldoPremiacoes = (dadosPre.pendentes || [])
        .reduce((sum, p) => sum + (parseFloat(p.valor_reais) || 0), 0);

    return (
        <div className="ds-popup-overlay ativo" onClick={onClose} style={{ zIndex: 1400 }}>
            <div className="ds-pag-modal" onClick={e => e.stopPropagation()}>

                <WalletTopo
                    onClose={onClose}
                    abaAtiva={aba}
                    acumuladoCicloAtual={acumuladoCicloAtual}
                    saldoPremiacoes={saldoPremiacoes}
                    loadingPremiacoes={loadingPre}
                />

                {/* Abas */}
                <div className="wallet-abas">
                    <button
                        className={`wallet-aba${aba === 'comissoes' ? ' ativa com' : ''}`}
                        onClick={() => setAba('comissoes')}
                    >
                        <i className="fas fa-briefcase" /> Comissões
                    </button>
                    <button
                        className={`wallet-aba${aba === 'premiacoes' ? ' ativa pre' : ''}`}
                        onClick={() => setAba('premiacoes')}
                    >
                        <i className="fas fa-trophy" /> Premiações
                    </button>
                </div>

                <div className="ds-pag-corpo">
                    {aba === 'comissoes' ? (
                        <AbaComissoes
                            pagamentoCicloFechado={pagamentoCicloFechado}
                            historico={historicoCom}
                            loading={loadingCom}
                        />
                    ) : (
                        <AbaPremiacoes
                            pendentes={dadosPre.pendentes || []}
                            pagos={dadosPre.pagos || []}
                            loading={loadingPre}
                        />
                    )}
                </div>

            </div>
        </div>
    );
}
