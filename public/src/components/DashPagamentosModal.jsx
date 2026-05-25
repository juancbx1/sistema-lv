import React, { useState, useEffect, useMemo } from 'react';
import { fetchAPI } from '/js/utils/api-utils';
import { getPeriodoFiscalAtual } from '/js/utils/periodos-fiscais.js';

// Fluxo de pagamento:
//   Ciclo anterior termina dia 20 → pagamento ocorre no 5º dia útil do MÊS SEGUINTE
//   Exemplo: ciclo 21/04–20/05 → pagamento em junho (5º dia útil de junho = 06/06)
//
// getPeriodoFiscalAtual() retorna o ciclo EM ANDAMENTO (ex: 21/05–20/06).
// O ciclo que gerou o próximo pagamento é o ANTERIOR, que terminou em p.inicio - 1 dia.
function getMesRefPagamento() {
    try {
        const p = getPeriodoFiscalAtual();
        // Fim do ciclo anterior = dia anterior ao início do ciclo atual
        const fimCicloAnterior = new Date(p.inicio);
        fimCicloAnterior.setDate(fimCicloAnterior.getDate() - 1);
        // Passa o mês do fim do ciclo anterior para o endpoint.
        // O endpoint já soma 1 mês internamente (usa mesNum como índice 0-based no Date.UTC),
        // portanto basta converter getMonth() (0-based) para string 1-based.
        const ano = fimCicloAnterior.getFullYear();
        const mes = fimCicloAnterior.getMonth() + 1; // converte 0-based → 1-based
        return `${ano}-${String(mes).padStart(2, '0')}`;
    } catch {
        // fallback: mês atual (o endpoint vai calcular o seguinte)
        const agora = new Date();
        return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    }
}

function formatarData(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// ─── TOPO ESTILO CARTÃO ────────────────────────────────────────────────────
function WalletTopo({ onClose, nomeUsuario, saldoComissoes, saldoPremiacoes, loadingPremiacoes }) {
    return (
        <div className="wallet-topo">
            <button className="ds-modal-close-simple" onClick={onClose}>
                <i className="fas fa-times" />
            </button>
            <div className="wallet-topo-titulo">💳 Minha Carteira</div>
            <div className="wallet-topo-nome">{nomeUsuario || 'Funcionária'}</div>
            <div className="wallet-saldos">
                <div className="wsaldo com">
                    <div className="wsaldo-label">
                        <i className="fas fa-briefcase" /> Comissões
                    </div>
                    <div className="wsaldo-valor">
                        R$ {(saldoComissoes || 0).toFixed(2)}
                    </div>
                </div>
                <div className="wsaldo pre">
                    <div className="wsaldo-label">
                        <i className="fas fa-trophy" /> Premiações
                    </div>
                    <div className={`wsaldo-valor${loadingPremiacoes ? ' loading' : ''}`}>
                        {loadingPremiacoes ? '...' : `R$ ${(saldoPremiacoes || 0).toFixed(2)}`}
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

// ─── ABA COMISSÕES ─────────────────────────────────────────────────────────
function fmtMesAno(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('pt-BR', {
        month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo',
    });
}

function AbaComissoes({ pagamentoPendente, historico, loading }) {
    const [grupo, setGrupo] = useState(0); // 0 = mais recente
    const [dataExata, setDataExata] = useState(null);
    const [loadingData, setLoadingData] = useState(true);

    const temPendente = pagamentoPendente && pagamentoPendente.valor > 0;

    useEffect(() => {
        const mesRef = getMesRefPagamento();
        fetchAPI(`/api/calendario/proximo-dia-util-pagamento?mes=${mesRef}`)
            .then(d => setDataExata(d.dataFormatada || null))
            .catch(() => setDataExata(null))
            .finally(() => setLoadingData(false));
    }, []);

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

    // Label do período: "Jun 2025 – Ago 2025"
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
            <p className="ds-pag-bolso-label">
                <i className="fas fa-briefcase" /> Comissões de produção
                {loadingData ? (
                    <span className="ds-pag-bolso-hint">Calculando data...</span>
                ) : dataExata ? (
                    <span className="ds-pag-bolso-hint ds-pag-bolso-hint--data">
                        <i className="fas fa-calendar-check" /> Recebe em {dataExata}
                    </span>
                ) : (
                    <span className="ds-pag-bolso-hint">Pagas todo 5º dia útil do mês</span>
                )}
            </p>

            {!temPendente && (
                <p className="ds-pag-vazio-inline" style={{ marginTop: 4 }}>
                    Nenhum valor pendente ainda — continue produzindo!
                </p>
            )}

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
export default function DashPagamentosModal({ pagamentoPendente, usuario, onClose }) {
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

    const saldoComissoes = pagamentoPendente?.valor || 0;
    const saldoPremiacoes = (dadosPre.pendentes || [])
        .reduce((sum, p) => sum + (parseFloat(p.valor_reais) || 0), 0);

    return (
        <div className="ds-popup-overlay ativo" onClick={onClose} style={{ zIndex: 1400 }}>
            <div className="ds-pag-modal" onClick={e => e.stopPropagation()}>

                <WalletTopo
                    onClose={onClose}
                    nomeUsuario={usuario?.nome}
                    saldoComissoes={saldoComissoes}
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
                            pagamentoPendente={pagamentoPendente}
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
