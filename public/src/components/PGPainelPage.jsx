import React, { useState, useEffect, useCallback, useMemo } from 'react';
import UIHeaderPagina from './UIHeaderPagina';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UICarregando from './UICarregando';
import PGFiltrosPeriodo from './PGFiltrosPeriodo.jsx';
import PGKpiBar from './PGKpiBar.jsx';
import PGEquipeCard from './PGEquipeCard.jsx';
import PGFuncionarioCard from './PGFuncionarioCard.jsx';
import PGDestaques from './PGDestaques.jsx';
import PGFuncionarioModal from './PGFuncionarioModal.jsx';
import PGTimeline from './PGTimeline.jsx';
import PGPontosExtrasModal from './PGPontosExtrasModal.jsx';
import PGHistoricoPontosExtras from './PGHistoricoPontosExtras.jsx';

function hojeEmSP() {
    return new Date().toLocaleDateString('sv', { timeZone: 'America/Sao_Paulo' });
}

const FAIXAS = {
    ate_9h:   ['00:00', '09:00'],
    '9h_12h': ['09:00', '12:00'],
    '14h_16h':['14:00', '16:00'],
    apos_16h: ['16:00', '23:59'],
};

function PGPainelPage() {
    const [dados, setDados]     = useState(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro]       = useState(null);
    const [filtroPeriodo, setFiltroPeriodo]         = useState('dia_inteiro');
    const [dataReferencia, setDataReferencia]       = useState(hojeEmSP);
    const [funcionarioSelId, setFuncionarioSelId]   = useState(null);
    const [ultimaAtt, setUltimaAtt]                 = useState(null);
    const [modalPontosExtras, setModalPontosExtras] = useState(false);
    const [cadeiaBloqueada, setCadeiaBloqueada]     = useState(false);

    const buscarDados = useCallback(async () => {
        setCadeiaBloqueada(false);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/real-producao/diaria?data=${dataReferencia}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const body = await res.json();
            if (!res.ok) {
                const error = new Error(body.error || 'Erro ao buscar dados');
                error.codigo = body.codigo;
                throw error;
            }
            setDados(body);
            setErro(null);
            setUltimaAtt(new Date());
        } catch (e) {
            if (e?.codigo === 'MODULO_NAO_DISPONIVEL_EMPRESA' || e?.codigo === 'CADEIA_PRODUTIVA_NAO_MIGRADA') {
                setCadeiaBloqueada(true);
                setDados(null);
            }
            setErro(e.message);
        } finally {
            setLoading(false);
        }
    }, [dataReferencia]);

    useEffect(() => {
        setLoading(true);
        buscarDados();
        const id = setInterval(() => {
            buscarDados();
        }, 3 * 60 * 1000);
        const onFocus = () => buscarDados();
        window.addEventListener('focus', onFocus);
        return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
    }, [buscarDados]);

    // ── Filtro de período ────────────────────────────────────────────────
    const atividadesFiltradas = useMemo(() => {
        if (!dados?.atividades) return [];
        if (filtroPeriodo === 'dia_inteiro') return dados.atividades;
        const [ini, fim] = FAIXAS[filtroPeriodo];
        return dados.atividades.filter(a => {
            const hora = new Date(a.data_hora).toLocaleTimeString('en-GB', {
                timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
            });
            return hora >= ini && hora < fim;
        });
    }, [dados, filtroPeriodo]);

    const tipoFuncMap = useMemo(() => {
        if (!dados?.funcionarios) return new Map();
        return new Map(dados.funcionarios.map(f => [f.id, f.tipos]));
    }, [dados]);

    const kpisHoje = useMemo(() => {
        if (!dados) return null;
        if (filtroPeriodo === 'dia_inteiro') return dados.equipeHoje;
        let pecasCostura = 0, pecasTiktik = 0, arremates = 0, pontosTotal = 0;
        const fids = new Set();
        for (const a of atividadesFiltradas) {
            const tipos = tipoFuncMap.get(a.funcionario_id) || [];
            if (tipos.includes('costureira')) pecasCostura += a.quantidade;
            if (tipos.includes('tiktik') && a.tipo_atividade === 'processo') pecasTiktik += a.quantidade;
            if (a.tipo_atividade === 'arremate') arremates += a.quantidade;
            pontosTotal += a.pontos_gerados;
            fids.add(a.funcionario_id);
        }
        return {
            pecasCostura, pecasTiktik, arremates,
            producaoTiktikTotal: pecasTiktik + arremates,
            producaoTotal:       pecasCostura + pecasTiktik + arremates,
            pontosTotal: parseFloat(pontosTotal.toFixed(1)),
            funcionariosAtivos: fids.size,
        };
    }, [dados, filtroPeriodo, atividadesFiltradas, tipoFuncMap]);

    const funcionariosFiltrados = useMemo(() => {
        if (!dados?.funcionarios) return [];
        if (filtroPeriodo === 'dia_inteiro') return [...dados.funcionarios];
        const pontosPorFunc = new Map();
        for (const a of atividadesFiltradas) {
            const cur = pontosPorFunc.get(a.funcionario_id) || { pecas: 0, pontos: 0 };
            pontosPorFunc.set(a.funcionario_id, {
                pecas:  cur.pecas  + a.quantidade,
                pontos: cur.pontos + a.pontos_gerados,
            });
        }
        return dados.funcionarios
            .flatMap(f => {
                const fil = pontosPorFunc.get(f.id);
                if (!fil) return [];
                const pontosHoje = parseFloat(fil.pontos.toFixed(2));
                const pctMeta = f.meta_pontos > 0
                    ? parseFloat((pontosHoje / f.meta_pontos * 100).toFixed(1))
                    : 0;
                return [{ ...f, pecas_hoje: fil.pecas, pontos_hoje: pontosHoje, pct_meta: pctMeta }];
            })
            .sort((a, b) => b.pontos_hoje - a.pontos_hoje);
    }, [dados, atividadesFiltradas, filtroPeriodo]);

    const funcionarioSelecionado = useMemo(
        () => dados?.funcionarios?.find(f => f.id === funcionarioSelId) || null,
        [dados, funcionarioSelId]
    );

    const atividadesSelecionado = useMemo(
        () => funcionarioSelId
            ? dados?.atividades?.filter(a => a.funcionario_id === funcionarioSelId) || []
            : [],
        [dados, funcionarioSelId]
    );

    const filtroDia = filtroPeriodo === 'dia_inteiro';
    const isHoje    = dataReferencia === hojeEmSP();

    // ── Banner dia histórico ─────────────────────────────────────────────
    const bannerDiaHistorico = useMemo(() => {
        if (!filtroDia) return null;

        // Dia não trabalhado — exibe mensagem contextual em vez de comparar com a média
        if (dados?.diaUtil === false) {
            return { tipo: 'nao-util', motivo: dados.motivoNaoUtil };
        }

        if (!dados?.mediaDiaria30d || dados.mediaDiaria30d === 0) return null;

        const pontosAtuais = dados.equipeHoje?.pontosTotal || 0;

        if (isHoje) {
            // ── Hoje: usa projeção baseada no ritmo atual ─────────────────
            const horaAtual = parseInt(
                new Date().toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: 'numeric' }),
                10
            );
            if (horaAtual < 9) return null;
            const horasTrabalhadas = Math.max(horaAtual - 7, 1);
            const projecaoDia = (pontosAtuais / horasTrabalhadas) * 10;
            const variacao = ((projecaoDia - dados.mediaDiaria30d) / dados.mediaDiaria30d) * 100;
            if (variacao >= 15)  return { tipo: 'otimo',  variacao, isHoje: true };
            if (variacao >= -5)  return { tipo: 'normal', variacao, isHoje: true };
            return                      { tipo: 'abaixo', variacao, isHoje: true };
        } else {
            // ── Dia passado: compara a produção real com a média histórica ─
            const variacao = ((pontosAtuais - dados.mediaDiaria30d) / dados.mediaDiaria30d) * 100;
            if (variacao >= 15)  return { tipo: 'otimo',  variacao, isHoje: false };
            if (variacao >= -5)  return { tipo: 'normal', variacao, isHoje: false };
            return                      { tipo: 'abaixo', variacao, isHoje: false };
        }
    }, [dados, filtroDia, isHoje]);

    // ── Render ───────────────────────────────────────────────────────────
    if (cadeiaBloqueada) return (
        <>
            <UIHeaderPagina titulo="Produção Geral" />
            <div className="pg-bloqueio" role="status" aria-live="polite">
                <i className="fas fa-industry" aria-hidden="true"></i>
                <strong>A cadeia de produção ainda não está disponível neste ambiente.</strong>
                <span>Nenhum dado de outro ambiente foi carregado.</span>
            </div>
        </>
    );

    if (loading) return (
        <>
            <UIHeaderPagina titulo="Produção Geral" />
            <UICarregando variante="bloco" texto="Carregando produção..." />
        </>
    );

    if (erro) return (
        <>
            <UIHeaderPagina titulo="Produção Geral" />
            <div className="pg-erro"><i className="fas fa-exclamation-circle"></i> {erro}</div>
        </>
    );

    return (
        <>
            <UIHeaderPagina titulo="Produção Geral">
                <button
                    className="gs-btn pg-btn-pontos-extras"
                    onClick={() => setModalPontosExtras(true)}
                    title="Lançar Pontos Extras"
                >
                    <i className="fas fa-star"></i>
                    <span>Pontos Extras</span>
                </button>
                <input
                    type="date"
                    value={dataReferencia}
                    max={hojeEmSP()}
                    onChange={e => { setDataReferencia(e.target.value); setLoading(true); }}
                    className="pg-input-data"
                />
                <button
                    className="gs-btn gs-btn-secundario"
                    onClick={buscarDados}
                    title="Atualizar agora"
                >
                    <i className="fas fa-sync-alt"></i>
                </button>
            </UIHeaderPagina>

            <div className="gs-conteudo-pagina">

                <PGFiltrosPeriodo ativo={filtroPeriodo} onChange={setFiltroPeriodo} />

                {bannerDiaHistorico && (
                    <div className={`pg-banner-historico pg-banner-historico--${bannerDiaHistorico.tipo}`}>
                        <i className={`fas ${
                            bannerDiaHistorico.tipo === 'otimo'    ? 'fa-fire' :
                            bannerDiaHistorico.tipo === 'normal'   ? 'fa-equals' :
                            bannerDiaHistorico.tipo === 'nao-util' ? 'fa-calendar-xmark' :
                                                                     'fa-arrow-trend-down'
                        }`}></i>
                        {bannerDiaHistorico.tipo === 'otimo' && (
                            bannerDiaHistorico.isHoje
                                ? `Hoje está ${Math.abs(bannerDiaHistorico.variacao).toFixed(0)}% acima da média dos últimos 30 dias — ritmo forte! 🔥`
                                : `Esse dia ficou ${Math.abs(bannerDiaHistorico.variacao).toFixed(0)}% acima da média histórica.`
                        )}
                        {bannerDiaHistorico.tipo === 'normal' && (
                            bannerDiaHistorico.isHoje
                                ? `Ritmo dentro da média histórica dos últimos 30 dias.`
                                : `Produção dentro da média histórica dos últimos 30 dias.`
                        )}
                        {bannerDiaHistorico.tipo === 'abaixo' && (
                            bannerDiaHistorico.isHoje
                                ? `Hoje está ${Math.abs(bannerDiaHistorico.variacao).toFixed(0)}% abaixo da média histórica. Vale verificar o andamento.`
                                : `Esse dia ficou ${Math.abs(bannerDiaHistorico.variacao).toFixed(0)}% abaixo da média histórica.`
                        )}
                        {bannerDiaHistorico.tipo === 'nao-util' && `Dia não trabalhado${bannerDiaHistorico.motivo ? ` · ${bannerDiaHistorico.motivo}` : ''}. Produção zerada é esperada.`}
                    </div>
                )}

                <div className="gs-card gs-card--compacto">
                    <PGKpiBar equipeHoje={kpisHoje} equipeOntem={dados?.equipeOntem} filtroDia={filtroDia} diaAnteriorRef={dados?.diaAnteriorRef} />
                </div>

                <PGEquipeCard
                    equipeHoje={kpisHoje}
                    equipeOntem={dados?.equipeOntem}
                    comparativoSemana={dados?.comparativoSemana}
                    funcionarios={funcionariosFiltrados}
                    filtroDia={filtroDia}
                    todasMetas={dados?.todasMetas}
                    isHoje={isHoje}
                    diaAnteriorRef={dados?.diaAnteriorRef}
                />

                {funcionariosFiltrados.length === 0 ? (
                    <UIFeedbackNotFound
                        variante="compacto"
                        icon="fa-inbox"
                        titulo="Nenhuma produção registrada"
                        mensagem={`Não há produção registrada ${filtroDia ? 'hoje' : 'neste período'}.`}
                    />
                ) : (
                    <div className="pg-grid-cards">
                        {funcionariosFiltrados.map((f, i) => (
                            <PGFuncionarioCard
                                key={f.id}
                                funcionario={f}
                                posicao={i + 1}
                                onSelecionar={setFuncionarioSelId}
                                filtroDia={filtroDia}
                                todasMetas={dados?.todasMetas}
                                isHoje={isHoje}
                            />
                        ))}
                    </div>
                )}

                {filtroDia && dados?.atividades?.length > 0 && (
                    <div className="gs-card gs-card--compacto">
                        <h3 className="pg-timeline-titulo">
                            <i className="fas fa-chart-bar"></i> Ritmo da equipe (pontos/hora)
                        </h3>
                        <PGTimeline
                            atividades={dados.atividades}
                            metaPontos={
                                funcionariosFiltrados.length > 0
                                    ? funcionariosFiltrados.reduce((s, f) => s + (f.meta_pontos || 0), 0)
                                    : 0
                            }
                        />
                    </div>
                )}

                <PGDestaques
                    funcionarios={funcionariosFiltrados}
                    filtroPeriodo={filtroPeriodo}
                    todasMetas={dados?.todasMetas}
                />

                <PGHistoricoPontosExtras dataReferencia={dataReferencia} />

                {ultimaAtt && (
                    <p className="pg-ultima-att">
                        Atualizado às{' '}
                        {ultimaAtt.toLocaleTimeString('pt-BR', {
                            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
                        })}
                        {' '}· atualização automática a cada 3 min
                    </p>
                )}
            </div>

            {modalPontosExtras && (
                <PGPontosExtrasModal
                    funcionarios={dados?.todosAtivos || dados?.funcionarios || []}
                    todasMetas={dados?.todasMetas}
                    dataReferencia={dataReferencia}
                    onFechar={() => setModalPontosExtras(false)}
                    onSucesso={() => { setModalPontosExtras(false); buscarDados(); }}
                />
            )}

            {funcionarioSelecionado && (
                <PGFuncionarioModal
                    funcionario={funcionarioSelecionado}
                    atividades={atividadesSelecionado}
                    metasDiarias={dados?.metasDiarias}
                    onFechar={() => setFuncionarioSelId(null)}
                />
            )}
        </>
    );
}

export default PGPainelPage;
