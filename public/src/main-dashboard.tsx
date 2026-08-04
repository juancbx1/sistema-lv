import React, { useState, useEffect } from 'react';
import DashMenuLateral from './components/DashMenuLateral';
import DashAtividadesLista from './components/DashAtividadesRecentesRedesign';
import DashFocoHoje from './components/DashFocoHoje';
import DashDesempenhoModal from './components/DashDesempenhoModal';
// @ts-expect-error módulo JS legado sem tipos
import { fetchAPI } from '/js/utils/api-utils';
// @ts-expect-error módulo JS legado sem tipos
import { verificarAutenticacao, salvarContextoEmpresaLocal } from '/js/utils/auth.js';
import DashProjecaoCiclo from './components/DashProjecaoCicloRedesign';
import DashCofreModal from './components/DashCofreModal';
import DashPerfilModal from './components/DashPerfilModal';
import DashPagamentosModal from './components/DashPagamentosModal';
import DashFabGincana from './components/DashFabGincana';
import DashAvisoPopup from './components/DashAvisoPopup';
import DashStatusAtualModal from './components/DashStatusAtualModal';
import DashCadeiaNaoMigrada from './components/DashCadeiaNaoMigrada';
import UICarregando from './components/UICarregando';
import type {
    DashApiError,
    DashAvisoPopup as DashAvisoPopupItem,
    DashDesempenhoResponse,
    DashMeuStatus,
    DashMeta,
    DashPeriodo,
    DashRankingSemana,
    DashVtSaldo,
} from './utils/dashboard-types';
import type { MenuContextoEmpresa } from './utils/menu-types';

function dataHojeFormatada(): string {
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
    }).format(new Date());
}

function periodoFormatado(periodo?: DashPeriodo | null): string | null {
    if (!periodo?.inicio || !periodo?.fim) return null;

    const formatar = (valor: string) => new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'UTC',
        day: '2-digit',
        month: '2-digit',
    }).format(new Date(valor + 'T12:00:00Z'));

    return formatar(periodo.inicio) + '–' + formatar(periodo.fim);
}

function obterSufixoVtParaSmoke(): string {
    const qs = new URLSearchParams(window.location.search);
    const params = new URLSearchParams();

    if (qs.get('vt_soft') === '1' || qs.get('vt_soft') === 'true') {
        params.set('vt_soft', '1');
    }
    if (qs.get('vt_hora')) {
        params.set('vt_hora', String(qs.get('vt_hora')));
    }

    return params.toString() ? `?${params.toString()}` : '';
}

function formatarDiaMesLongo(dataISO?: string | null): string {
    if (!dataISO) return '--';

    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'long',
    }).format(new Date(dataISO + 'T12:00:00Z'));
}

export default function MainDashboard() {
    const [loading, setLoading] = useState(true);
    const [dados, setDados] = useState<DashDesempenhoResponse | null>(null);
    const [metaDoUsuario, setMetaDoUsuario] = useState<DashMeta | null>(null);
    const [modalDesempenhoAberto, setModalDesempenhoAberto] = useState(false);
    const [modalCofreAberto, setModalCofreAberto] = useState(false);
    const [modalPerfilAberto, setModalPerfilAberto] = useState(false);
    const [modalPagamentosAberto, setModalPagamentosAberto] = useState(false);
    const [impersonandoNome, setImpersonandoNome] = useState<string | null>(null);
    const [avisosPopup, setAvisosPopup] = useState<DashAvisoPopupItem[]>([]);
    const [dashboardBloqueada, setDashboardBloqueada] = useState(false);
    // Dados que antes chegavam em cascata depois do paint (pareciam "atrasados")
    const [contextoEmpresaInicial, setContextoEmpresaInicial] = useState<MenuContextoEmpresa | null>(null);
    const [statusInicial, setStatusInicial] = useState<DashMeuStatus | null>(null);
    const [rankingInicial, setRankingInicial] = useState<DashRankingSemana | null>(null);
    const [vtInicial, setVtInicial] = useState<DashVtSaldo | null>(null);

    const carregar = async () => {
        // Detecta token de impersonação na URL e o armazena em sessionStorage (isolado por aba)
        const urlParams = new URLSearchParams(window.location.search);
        const tokenUrl = urlParams.get('impersonando');
        if (tokenUrl) {
            sessionStorage.setItem('impersonation_token', tokenUrl);
            window.history.replaceState({}, '', window.location.pathname);
        }

        const auth = await verificarAutenticacao('dashboard/dashboard.html', ['acesso-dashboard']);
        if (!auth) return;

        try {
            // Se houver token de impersonação, extrair o nome do payload (sem chamar API extra)
            const impToken = sessionStorage.getItem('impersonation_token');
            if (impToken) {
                try {
                    const payload = JSON.parse(atob(impToken.split('.')[1])) as {
                        impersonando?: boolean;
                        nome?: string;
                    };
                    if (payload.impersonando) setImpersonandoNome(payload.nome ?? null);
                } catch {
                    /* ignora erro de decode */
                }
            }

            // Carrega em PARALELO o que a tela inicial precisa pintar de uma vez.
            // Antes, empresa/status/VT/ranking só começavam depois do paint → pop-in.
            const sufixoVt = obterSufixoVtParaSmoke();
            const [resultado, avisosPendentes, contextoEmpresa, meuStatus, ranking, meuVt] =
                await Promise.all([
                    fetchAPI('/api/dashboard/desempenho') as Promise<DashDesempenhoResponse>,
                    (fetchAPI('/api/avisos-popup/pendentes') as Promise<DashAvisoPopupItem[]>).catch(
                        () => [] as DashAvisoPopupItem[],
                    ),
                    (fetchAPI('/api/contexto-empresa') as Promise<MenuContextoEmpresa>).catch(
                        () => null as MenuContextoEmpresa | null,
                    ),
                    (fetchAPI('/api/producao/meu-status') as Promise<DashMeuStatus>).catch(
                        () => null as DashMeuStatus | null,
                    ),
                    (fetchAPI('/api/dashboard/ranking-semana') as Promise<DashRankingSemana>).catch(
                        () => null as DashRankingSemana | null,
                    ),
                    (fetchAPI(`/api/dashboard/meu-vt${sufixoVt}`) as Promise<DashVtSaldo>).catch(
                        () => null as DashVtSaldo | null,
                    ),
                ]);
            setAvisosPopup(avisosPendentes);
            setDados(resultado);
            setContextoEmpresaInicial(contextoEmpresa);
            setStatusInicial(meuStatus);
            setRankingInicial(ranking);
            setVtInicial(meuVt);
            // Persistência para o chip de empresa pintar no primeiro frame na próxima visita
            if (contextoEmpresa?.empresaAtiva) {
                salvarContextoEmpresaLocal(
                    { empresa_ativa: contextoEmpresa.empresaAtiva },
                    localStorage,
                );
            }

            // --- LÓGICA DE PERSISTÊNCIA DA META ---
            const metaSalvaPontos = localStorage.getItem('meta_diaria_planejada');

            // Tenta achar a meta salva na lista de metas possíveis
            let metaInicial: DashMeta | null | undefined = null;
            if (metaSalvaPontos && resultado.metasPossiveis) {
                metaInicial = resultado.metasPossiveis.find(
                    (m) => m.pontos_meta.toString() === metaSalvaPontos,
                );
            }

            if (!metaInicial) {
                // Só usa sugestão do servidor se o usuário NUNCA escolheu nada
                if (!metaSalvaPontos) {
                    metaInicial = resultado.hoje.proximaMeta || resultado.metasPossiveis[0];
                } else {
                    // Tinha salvo mas a meta não existe mais — usa a primeira disponível
                    metaInicial = resultado.metasPossiveis[0];
                }
            }

            setMetaDoUsuario(metaInicial ?? null);
            // --------------------------------------

        } catch (error: unknown) {
            const err = error as DashApiError;
            if (err?.codigo === 'CADEIA_PRODUTIVA_NAO_MIGRADA') {
                setDashboardBloqueada(true);
            } else {
                console.error('Erro ao carregar dashboard:', error);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleMarcarAvisoVisto = async (avisoId: number) => {
        try {
            const token = localStorage.getItem('token')
                || sessionStorage.getItem('impersonation_token');
            await fetch(`/api/avisos-popup/${avisoId}/marcar-visto`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
        } catch {
            /* silencioso — não bloqueia a UX */
        }
        setAvisosPopup((prev) => prev.filter((a) => a.id !== avisoId));
    };

    useEffect(() => {
        void carregar();
    }, []);

    if (loading) {
        return <UICarregando variante="pagina" />;
    }

    if (dashboardBloqueada) return <DashCadeiaNaoMigrada />;

    if (!dados) return <div style={{ textAlign: 'center', padding: '20px' }}>Erro ao carregar dados.</div>;

    const diasUteisCiclo = Math.max(
        Number(dados.acumulado.diasUteisRealDoEmpregadoNoCiclo || 0),
        Number(dados.acumulado.diasTrabalhadosNoCiclo || 0),
    );
    const diasTrabalhadosCiclo = Number(dados.acumulado.diasTrabalhadosNoCiclo || 0);
    const progressoCiclo = diasUteisCiclo > 0
        ? Math.min(100, Math.round((diasTrabalhadosCiclo / diasUteisCiclo) * 100))
        : 0;

    return (
        <div className="ds-body autenticado ds-dashboard-app">
            <DashMenuLateral
                usuario={dados.usuario}
                contextoEmpresaInicial={contextoEmpresaInicial}
                rankingInicial={rankingInicial}
                vtInicial={vtInicial}
                aoAbrirCofre={() => setModalCofreAberto(true)}
                aoAbrirDesempenho={() => setModalDesempenhoAberto(true)}
                aoAbrirPagamentos={() => setModalPagamentosAberto(true)}
                aoAbrirPerfil={() => setModalPerfilAberto(true)}
                aoSair={() => { localStorage.removeItem('token'); window.location.href = '/index.html'; }}
            />

            {impersonandoNome && (
                <div className="ds-impersonacao-banner">
                    <i className="fas fa-user-shield"></i>
                    <span>Modo Admin — visualizando como <strong>{impersonandoNome}</strong></span>
                    <span className="ds-impersonacao-info">Sessão de 2h · Feche a aba para encerrar</span>
                </div>
            )}
            <main className="ds-dashboard-main">
                <div className="ds-dashboard-conteudo">
                    <section className="ds-dashboard-intro">
                        <div className="ds-dashboard-intro-copy">
                            <div className="ds-dashboard-intro-copy-text">
                                <p className="ds-dashboard-overline">
                                    {dataHojeFormatada()}
                                </p>
                                <h1>Olá, {dados.usuario?.nome?.split(' ')[0] || 'colaboradora'}.</h1>
                                <p className="ds-dashboard-chamada">Vamos buscar sua meta?</p>
                            </div>
                            <DashStatusAtualModal statusInicial={statusInicial} />
                        </div>
                        <div className="ds-dashboard-periodo">
                            <div className="ds-dashboard-periodo-cabecalho">
                                <span>Seu ciclo de produção</span>
                                <strong>{periodoFormatado(dados.periodo) || '--'}</strong>
                            </div>
                            <div className="ds-dashboard-periodo-destaque">
                                <strong>{dados.acumulado.diasRestantesNoCiclo ?? 0} dias</strong>
                                <span>de trabalho até o último dia do ciclo</span>
                            </div>
                            <div className="ds-dashboard-periodo-progresso">
                                <div className="ds-dashboard-periodo-progresso-legenda">
                                    <span>Ritmo do ciclo</span>
                                    <strong>{progressoCiclo}% concluído</strong>
                                </div>
                                <div className="ds-dashboard-periodo-progresso-barra-wrap">
                                    <div
                                        className="ds-dashboard-periodo-progresso-barra"
                                        aria-label={`${diasTrabalhadosCiclo} de ${diasUteisCiclo} dias úteis cumpridos até ${formatarDiaMesLongo(dados.periodo?.fim)}`}
                                    >
                                        <span style={{ width: `${progressoCiclo}%` }}></span>
                                        <i className="ds-dashboard-periodo-progresso-marco" aria-hidden="true"></i>
                                    </div>
                                    <div className="ds-dashboard-periodo-progresso-fechamento">
                                        <strong>{formatarDiaMesLongo(dados.periodo?.fim)}</strong>
                                        <span>último dia do ciclo</span>
                                    </div>
                                </div>
                                <small>{diasTrabalhadosCiclo} dias cumpridos de {diasUteisCiclo} dias úteis</small>
                            </div>
                        </div>
                    </section>

                    <DashFocoHoje
                        dadosHoje={dados.hoje}
                        metasPossiveis={dados.metasPossiveis}
                        metaInicial={metaDoUsuario}
                        aoMudarMeta={setMetaDoUsuario}
                        diasUteisNoCiclo={dados.acumulado.diasUteisRealDoEmpregadoNoCiclo}
                        usuarioId={dados.usuario?.id}
                        empresaId={dados.usuario?.empresa_ativa?.id}
                        nomeUsuario={dados.usuario?.nome}
                    />

                    <section className="ds-dashboard-grid-secundario">
                        <DashProjecaoCiclo
                            valorAcumulado={dados.acumulado.totalGanho}
                            diasUteisNoCiclo={dados.acumulado.diasUteisNoCiclo}
                            diasTrabalhadosNoCiclo={dados.acumulado.diasTrabalhadosNoCiclo}
                            metasPossiveis={dados.metasPossiveis}
                            fimCiclo={dados.periodo?.fim}
                            diasRestantesNoCiclo={dados.acumulado.diasRestantesNoCiclo}
                            aoAbrirWallet={() => setModalPagamentosAberto(true)}
                        />
                    </section>

                    <DashAtividadesLista />
                </div>
            </main>

            {/* Avisos Popup — aparece sobre tudo ao carregar */}
            {avisosPopup.length > 0 && (
                <DashAvisoPopup
                    avisos={avisosPopup}
                    onMarcarVisto={handleMarcarAvisoVisto}
                />
            )}

            {/* Modal de Detalhes (Abre ao clicar no botão "Ver Detalhes" do resumo) */}
            {modalDesempenhoAberto && (
                <DashDesempenhoModal
                    dadosAcumulados={dados.acumulado}
                    diasTrabalho={dados.usuario?.dias_trabalho}
                    periodo={dados.periodo}
                    onClose={() => setModalDesempenhoAberto(false)}
                />
            )}

            {modalCofreAberto && (
                <DashCofreModal
                    dadosCofre={dados.cofre}
                    metaDoDia={metaDoUsuario}
                    pontosHoje={dados.hoje.pontos}
                    aoResgatarSucesso={carregar}
                    onClose={() => setModalCofreAberto(false)}
                />
            )}

            {modalPerfilAberto && (
                <DashPerfilModal
                    usuarioAtual={dados.usuario}
                    dadosAcumulados={dados.acumulado}
                    onClose={() => setModalPerfilAberto(false)}
                    aoAtualizarAvatar={carregar}
                />
            )}

            {modalPagamentosAberto && (
                <DashPagamentosModal
                    acumuladoCicloAtual={dados.acumuladoCicloAtual}
                    pagamentoCicloFechado={dados.pagamentoCicloFechado}
                    usuario={dados.usuario}
                    onClose={() => setModalPagamentosAberto(false)}
                />
            )}

            <DashFabGincana />

        </div>
    );
}
