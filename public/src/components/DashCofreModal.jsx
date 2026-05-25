import React, { useState } from 'react';
import { fetchAPI } from '/js/utils/api-utils.js';
import { mostrarConfirmacao } from '/js/utils/popups.js';

export default function DashCofreModal({ dadosCofre, metaDoDia, pontosHoje, aoResgatarSucesso, onClose }) {
    const [loading, setLoading] = useState(false);
    const [aba, setAba] = useState('resumo');
    const [historico, setHistorico] = useState([]);
    const [paginaExtrato, setPaginaExtrato] = useState(1);
    const [temMaisExtrato, setTemMaisExtrato] = useState(false);
    const [extratoCarregado, setExtratoCarregado] = useState(false);

    if (!dadosCofre) return null;

    const saldo          = parseFloat(dadosCofre.saldo || 0);
    const usosEssaSemana = dadosCofre.usosEssaSemana || 0;
    const LIMITE_SEMANAL = 2;
    const PONTOS_MINIMOS = 500;

    const resgatesRestantes  = Math.max(0, LIMITE_SEMANAL - usosEssaSemana);
    const temVidas           = usosEssaSemana < LIMITE_SEMANAL;
    const temProducaoMinima  = pontosHoje >= PONTOS_MINIMOS;
    const faltaParaMeta      = metaDoDia ? Math.max(0, metaDoDia.pontos_meta - pontosHoje) : 0;
    const temSaldoSuficiente = saldo >= faltaParaMeta;
    const podeResgatar       = faltaParaMeta > 0 && temSaldoSuficiente && temVidas && temProducaoMinima;
    const metaBatida         = faltaParaMeta === 0;

    const progProd = Math.min((pontosHoje / PONTOS_MINIMOS) * 100, 100);

    // ─── Ações ───────────────────────────────────────────────────
    const handleResgatar = async () => {
        const confirmado = await mostrarConfirmacao(`Usar ${faltaParaMeta} pts do cofre para completar o dia?`);
        if (!confirmado) return;
        setLoading(true);
        try {
            await fetchAPI('/api/dashboard/resgatar-pontos', {
                method: 'POST',
                body: JSON.stringify({ quantidade: faltaParaMeta })
            });
            aoResgatarSucesso();
            onClose();
        } catch (err) {
            alert(`Erro: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const carregarExtrato = async (reset = true) => {
        setLoading(true);
        try {
            const pg = reset ? 1 : paginaExtrato + 1;
            const dados = await fetchAPI(`/api/dashboard/cofre/extrato?page=${pg}&limit=10`);
            if (reset) setHistorico(dados.rows);
            else setHistorico(prev => [...prev, ...dados.rows]);
            setPaginaExtrato(pg);
            setTemMaisExtrato(pg < dados.pagination.totalPages);
            setExtratoCarregado(true);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleAbaExtrato = () => {
        setAba('extrato');
        if (!extratoCarregado) carregarExtrato(true);
    };

    // Saldo calculado retroativamente para o extrato
    const itensComSaldo = (() => {
        let saldoVolatil = saldo;
        let encontrouReset = false;
        return historico.map(item => {
            if (encontrouReset) return { ...item, saldoApos: null };
            if (item.tipo === 'RESET') { encontrouReset = true; return { ...item, saldoApos: 0 }; }
            const qtd = parseFloat(item.quantidade);
            const saldoMomento = saldoVolatil;
            if (item.tipo === 'GANHO') saldoVolatil -= qtd;
            else if (item.tipo === 'RESGATE') saldoVolatil += qtd;
            return { ...item, saldoApos: saldoMomento };
        });
    })();

    // ─── Renderizadores de aba ────────────────────────────────────

    const renderResumo = () => (
        <div className="ds-cofre-body">

            {/* Vidas semanais */}
            <div>
                <p className="ds-cofre-secao-label">Resgates esta semana</p>
                <div className="ds-cofre-vidas">
                    {[0, 1].map(i => {
                        const usado = i < usosEssaSemana;
                        return (
                            <div key={i} className={`ds-cofre-vida ${usado ? 'ds-cofre-vida--usada' : 'ds-cofre-vida--livre'}`}>
                                <i className={`fas ${usado ? 'fa-lock' : 'fa-lock-open'}`} aria-hidden="true" />
                                <span>{usado ? 'Usado' : 'Disponível'}</span>
                            </div>
                        );
                    })}
                </div>
                {resgatesRestantes === 0 && (
                    <p className="ds-cofre-aviso-semana">Limite semanal atingido · volta no próximo domingo</p>
                )}
            </div>

            {/* Produção hoje */}
            <div>
                <div className="ds-cofre-prod-header">
                    <span className="ds-cofre-prod-label">Produção hoje</span>
                    <span className={`ds-cofre-prod-valor ${temProducaoMinima ? 'ds-cofre-prod-valor--ok' : ''}`}>
                        {Math.round(pontosHoje)} / {PONTOS_MINIMOS} pts
                    </span>
                </div>
                <div className="ds-cofre-barra-bg">
                    <div
                        className={`ds-cofre-barra-fill ${temProducaoMinima ? 'ds-cofre-barra-fill--ok' : ''}`}
                        style={{ width: `${progProd}%` }}
                    />
                </div>
                <p className="ds-cofre-prod-hint">
                    {temProducaoMinima
                        ? '✅ Produção mínima atingida — resgate liberado'
                        : `Faltam ${PONTOS_MINIMOS - Math.round(pontosHoje)} pts para liberar o resgate`}
                </p>
            </div>

            {/* Área de ação contextual */}
            {metaBatida ? (
                <div className="ds-cofre-status ds-cofre-status--sucesso">
                    <i className="fas fa-check-circle" aria-hidden="true" />
                    <span>Meta de hoje já foi batida!</span>
                </div>
            ) : podeResgatar ? (
                <div className="ds-cofre-acao-card">
                    <div className="ds-cofre-acao-linha">
                        <span className="ds-cofre-acao-chave">
                            <i className="fas fa-bolt" aria-hidden="true" /> Falta para a meta
                        </span>
                        <strong className="ds-cofre-acao-valor">−{faltaParaMeta} pts</strong>
                    </div>
                    <div className="ds-cofre-acao-linha">
                        <span className="ds-cofre-acao-chave">
                            <i className="fas fa-vault" aria-hidden="true" /> Saldo no cofre
                        </span>
                        <strong className="ds-cofre-acao-valor">{Math.round(saldo)} pts</strong>
                    </div>
                    <button
                        className="ds-cofre-btn-resgatar"
                        onClick={handleResgatar}
                        disabled={loading}
                    >
                        {loading
                            ? <><div className="ds-spinner-btn" /> Processando...</>
                            : <><i className="fas fa-bolt" aria-hidden="true" /> Usar resgate agora</>
                        }
                    </button>
                </div>
            ) : (
                <div className="ds-cofre-bloqueio">
                    <i className="fas fa-lock" aria-hidden="true" />
                    <div>
                        {!temProducaoMinima ? (
                            <>
                                <strong>Produção mínima necessária</strong>
                                <p>Produza pelo menos {PONTOS_MINIMOS} pts hoje para liberar o resgate.</p>
                            </>
                        ) : !temVidas ? (
                            <>
                                <strong>Limite semanal atingido</strong>
                                <p>Você já usou os 2 resgates desta semana. Volta na segunda-feira!</p>
                            </>
                        ) : (
                            <>
                                <strong>Saldo insuficiente</strong>
                                <p>Seu saldo no cofre não cobre o que falta para a meta de hoje.</p>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );

    const renderExtrato = () => {
        // Agrupa por data com cabeçalhos
        const grupos = [];
        let ultimaData = null;
        itensComSaldo.forEach((item) => {
            if (item.tipo === 'RESET') {
                grupos.push({ tipo: '_RESET', item });
                ultimaData = null;
                return;
            }
            const dataStr = new Date(item.data_evento).toLocaleDateString('pt-BR', {
                day: '2-digit', month: 'long', timeZone: 'America/Sao_Paulo'
            });
            if (dataStr !== ultimaData) {
                grupos.push({ tipo: '_DATA', dataStr });
                ultimaData = dataStr;
            }
            grupos.push({ tipo: '_ITEM', item });
        });

        return (
            <div className="ds-cofre-body">
                {/* Saldo atual no topo */}
                <div className="ds-cofre-extrato-saldo">
                    <span>Saldo atual</span>
                    <strong>{Math.round(saldo)} pts</strong>
                </div>

                <div className="ds-cofre-extrato-lista">
                    {loading && historico.length === 0 ? (
                        <div className="ds-spinner" style={{ margin: '30px auto' }} />
                    ) : grupos.length === 0 ? (
                        <p className="ds-cofre-vazio">Nenhuma movimentação ainda.</p>
                    ) : (
                        grupos.map((entrada, idx) => {
                            if (entrada.tipo === '_DATA') return (
                                <div key={`d${idx}`} className="ds-cofre-data-header">
                                    {entrada.dataStr}
                                </div>
                            );
                            if (entrada.tipo === '_RESET') return (
                                <div key={`r${idx}`} className="ds-cofre-reset-linha">
                                    <div className="ds-cofre-reset-traço" />
                                    <span>
                                        <i className="fas fa-rotate-right" aria-hidden="true" />
                                        Início do ciclo · {new Date(entrada.item.data_evento).toLocaleDateString('pt-BR', {
                                            day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo'
                                        })}
                                    </span>
                                    <div className="ds-cofre-reset-traço" />
                                </div>
                            );
                            const { item } = entrada;
                            const isGanho = item.tipo === 'GANHO';
                            return (
                                <div key={`i${idx}`} className="ds-cofre-extrato-item">
                                    <div className={`ds-cofre-extrato-icone ${isGanho ? 'ds-cofre-extrato-icone--ganho' : 'ds-cofre-extrato-icone--resgate'}`}>
                                        <i className={`fas ${isGanho ? 'fa-arrow-up' : 'fa-arrow-down'}`} aria-hidden="true" />
                                    </div>
                                    <div className="ds-cofre-extrato-info">
                                        <span className="ds-cofre-extrato-tipo">{isGanho ? 'Depósito' : 'Saque'}</span>
                                        <span className="ds-cofre-extrato-hora">
                                            {new Date(item.data_evento).toLocaleTimeString('pt-BR', {
                                                hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo'
                                            })}
                                        </span>
                                    </div>
                                    <span className={`ds-cofre-extrato-valor ${isGanho ? 'ds-cofre-extrato-valor--ganho' : 'ds-cofre-extrato-valor--resgate'}`}>
                                        {isGanho ? '+' : '−'}{Math.round(item.quantidade)} pts
                                    </span>
                                </div>
                            );
                        })
                    )}
                    {temMaisExtrato && (
                        <button
                            className="ds-cofre-btn-mais"
                            onClick={() => carregarExtrato(false)}
                            disabled={loading}
                        >
                            {loading ? 'Carregando...' : 'Carregar mais'}
                        </button>
                    )}
                </div>
            </div>
        );
    };

    const renderInfo = () => (
        <div className="ds-cofre-body ds-cofre-body--info">
            <div className="ds-cofre-info-bloco">
                <h4>🏦 O que é o Banco de Resgate?</h4>
                <p>O Cofre guarda <strong>pontos excedentes</strong> da sua produção. Quando você bate a Meta Prata ou Ouro e ainda sobram pontos acima da meta, essa sobra vai direto pro cofre.</p>
            </div>
            <div className="ds-cofre-info-bloco">
                <h4>📈 Como acumulo pontos no Cofre?</h4>
                <p>Ao atingir a <strong>Meta Prata ou superior</strong>, os pontos que você fizer <em>acima</em> da meta vão para o cofre automaticamente.</p>
                <p className="ds-cofre-info-exemplo">Exemplo: Meta Prata = 800 pts · você fez 870 → 70 pts foram para o cofre.</p>
                <p className="ds-cofre-info-obs">⚠️ A Meta Bronze não gera sobra no cofre.</p>
            </div>
            <div className="ds-cofre-info-bloco">
                <h4>🔓 Como usar o Resgate?</h4>
                <p>Para usar o cofre em um dia que não bateu a meta, você precisa:</p>
                <ul>
                    <li>Ter <strong>pelo menos 500 pts de produção</strong> no dia</li>
                    <li>Ter <strong>saldo suficiente</strong> no cofre para cobrir o que falta</li>
                    <li>Não ter usado seus <strong>2 resgates da semana</strong> (conta de domingo a sábado)</li>
                </ul>
            </div>
            <div className="ds-cofre-info-bloco ds-cofre-info-bloco--ultimo">
                <h4>📅 E no início de cada ciclo?</h4>
                <p>No dia 21 de cada mês, quando começa um novo ciclo, o saldo do cofre é <strong>zerado</strong>. Os resgates semanais reiniciam toda segunda-feira.</p>
            </div>
        </div>
    );

    return (
        <div className="ds-popup-overlay ativo" onClick={onClose} style={{ zIndex: 1200 }}>
            <div className="ds-cofre-modal" onClick={e => e.stopPropagation()}>

                {/* ── Topo dark ─────────────────────────── */}
                <div className="ds-cofre-topo">
                    <button className="ds-cofre-close" onClick={onClose} aria-label="Fechar">
                        <i className="fas fa-times" aria-hidden="true" />
                    </button>
                    <div className="ds-cofre-topo-icone">
                        <i className="fas fa-vault" aria-hidden="true" />
                    </div>
                    <div className="ds-cofre-topo-saldo">{Math.round(saldo).toLocaleString('pt-BR')}</div>
                    <div className="ds-cofre-topo-label">pontos no cofre</div>
                    <div className="ds-cofre-topo-titulo">Banco de Resgate</div>
                </div>

                {/* ── Tabs ──────────────────────────────── */}
                <div className="ds-cofre-tabs" role="tablist">
                    {[
                        { id: 'resumo', label: 'Resumo' },
                        { id: 'extrato', label: 'Extrato' },
                        { id: 'info', label: 'Como funciona' },
                    ].map(t => (
                        <button
                            key={t.id}
                            role="tab"
                            aria-selected={aba === t.id}
                            className={`ds-cofre-tab ${aba === t.id ? 'ds-cofre-tab--ativa' : ''}`}
                            onClick={() => t.id === 'extrato' ? handleAbaExtrato() : setAba(t.id)}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* ── Conteúdo ──────────────────────────── */}
                <div className="ds-cofre-conteudo">
                    {aba === 'resumo'  && renderResumo()}
                    {aba === 'extrato' && renderExtrato()}
                    {aba === 'info'    && renderInfo()}
                </div>

            </div>
        </div>
    );
}
