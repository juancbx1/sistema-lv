import React, { useEffect, useRef, useState } from 'react';
import imgDefaultAvatar from '../assets/default-avatar.png';
// @ts-expect-error módulo JS legado sem tipos
import { fetchAPI } from '/js/utils/api-utils';
import DashRankingMenu from './DashRankingMenu';
import DashVtSaldoCard from './DashVtSaldoCard';
import DashVersionFooter from './DashVersionFooter';
import MenuEmpresaAtiva from './MenuEmpresaAtiva';
import MenuEmpresaSeletor from './MenuEmpresaSeletor';
import useMenuContexto from '../hooks/useMenuContexto';
import type { DashUsuario, DashRankingSemana } from '../utils/dashboard-types';

function MenuItem({ icone, label, onClick, ativo = false }: {
    icone: string;
    label: string;
    onClick?: () => void;
    ativo?: boolean;
}) {
    return (
        <button
            type="button"
            className={'dash-menu-item' + (ativo ? ' ativo' : '')}
            onClick={onClick}
        >
            <i className={'fas ' + icone} aria-hidden="true" />
            <span>{label}</span>
        </button>
    );
}

interface DashMenuLateralProps {
    usuario?: DashUsuario | null;
    aoAbrirCofre: () => void;
    aoAbrirDesempenho: () => void;
    aoAbrirPagamentos: () => void;
    aoAbrirPerfil: () => void;
    aoSair: () => void;
}

export default function DashMenuLateral({
    usuario,
    aoAbrirCofre,
    aoAbrirDesempenho,
    aoAbrirPagamentos,
    aoAbrirPerfil,
    aoSair,
}: DashMenuLateralProps) {
    const [drawerAberto, setDrawerAberto] = useState(false);
    const avatarUrl = usuario?.avatar_url || imgDefaultAvatar;
    const nome = usuario?.nome || 'Colaboradora';
    const nivel = usuario?.nivel || '?';
    const [rankingDados, setRankingDados] = useState<DashRankingSemana | null>(null);
    const {
        contexto: contextoEmpresa,
        trocandoPara,
        trocarEmpresa,
    } = useMenuContexto();
    const [seletorEmpresaAberto, setSeletorEmpresaAberto] = useState(false);
    const [contratoAvisoAberto, setContratoAvisoAberto] = useState(false);
    const [preferenciasAviso, setPreferenciasAviso] = useState(false);
    const preferenciasAvisoTimer = useRef<number | null>(null);

    const empresaAtiva = contextoEmpresa?.empresaAtiva || usuario?.empresa_ativa;
    const empresasDisponiveis = contextoEmpresa?.empresas || [];

    useEffect(() => () => {
        if (preferenciasAvisoTimer.current) {
            window.clearTimeout(preferenciasAvisoTimer.current);
        }
    }, []);

    useEffect(() => {
        let ativo = true;
        let intervalo: ReturnType<typeof setInterval> | null = null;

        const buscarRanking = async () => {
            try {
                const resultado = await fetchAPI('/api/dashboard/ranking-semana');
                if (ativo) setRankingDados(resultado);
            } catch {
                if (ativo) setRankingDados(null);
            }
        };

        const iniciarAtualizacao = () => {
            if (intervalo) clearInterval(intervalo);
            intervalo = setInterval(buscarRanking, 10 * 60 * 1000);
        };

        buscarRanking();
        iniciarAtualizacao();

        const aoMudarVisibilidade = () => {
            if (document.visibilityState === 'visible') {
                buscarRanking();
                iniciarAtualizacao();
            } else if (intervalo) {
                clearInterval(intervalo);
                intervalo = null;
            }
        };

        document.addEventListener('visibilitychange', aoMudarVisibilidade);
        return () => {
            ativo = false;
            if (intervalo) clearInterval(intervalo);
            document.removeEventListener('visibilitychange', aoMudarVisibilidade);
        };
    }, []);

    useEffect(() => {
        if (!drawerAberto) return undefined;

        setContratoAvisoAberto(false);

        const fecharComEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setDrawerAberto(false);
        };

        document.addEventListener('keydown', fecharComEsc);
        return () => document.removeEventListener('keydown', fecharComEsc);
    }, [drawerAberto]);

    useEffect(() => {
        if (!contratoAvisoAberto) return undefined;

        const fecharAoClicarFora = (event: Event) => {
            const alvo = event.target;
            if (alvo instanceof Element && alvo.closest('.ds-menu-empresa-contexto')) {
                return;
            }
            setContratoAvisoAberto(false);
        };

        document.addEventListener('pointerdown', fecharAoClicarFora);
        return () => document.removeEventListener('pointerdown', fecharAoClicarFora);
    }, [contratoAvisoAberto]);

    const fecharDrawer = () => setDrawerAberto(false);
    const acaoDrawer = (acao: () => void) => {
        fecharDrawer();
        acao();
    };

    const aoClicarEmpresa = () => {
        if (!empresaAtiva) return;

        if (empresasDisponiveis.length > 1) {
            setContratoAvisoAberto(false);
            setSeletorEmpresaAberto(true);
            return;
        }

        setContratoAvisoAberto((aberto) => !aberto);
    };

    const mostrarAvisoPreferencias = () => {
        setPreferenciasAviso(true);
        if (preferenciasAvisoTimer.current) {
            window.clearTimeout(preferenciasAvisoTimer.current);
        }
        preferenciasAvisoTimer.current = window.setTimeout(() => {
            setPreferenciasAviso(false);
        }, 2300) as unknown as number;
    };

    const renderRodapeRecursos = (idSufixo: string) => (
        <div className="ds-menu-recursos-rodape">
            <DashVersionFooter className="ds-menu-version-footer" />
            <div className="ds-menu-preferencias-wrap">
                <button
                    type="button"
                    className="ds-menu-preferencias"
                    aria-disabled="true"
                    aria-describedby={preferenciasAviso ? `ds-menu-preferencias-tooltip-${idSufixo}` : undefined}
                    onClick={mostrarAvisoPreferencias}
                >
                    <i className="fas fa-sliders" aria-hidden="true" />
                    <span>Preferências</span>
                </button>
                {preferenciasAviso && (
                    <span
                        id={`ds-menu-preferencias-tooltip-${idSufixo}`}
                        className="ds-menu-preferencias-tooltip"
                        role="tooltip"
                    >
                        Em breve!
                    </span>
                )}
            </div>
        </div>
    );

    return (
        <>
            <aside className="ds-menu-lateral-desktop" aria-label="Menu da dashboard">
                <button
                    type="button"
                    className="ds-menu-avatar"
                    onClick={aoAbrirPerfil}
                    aria-label="Abrir perfil"
                >
                    <span className="ds-menu-avatar-imagem">
                        <img src={avatarUrl} alt="" />
                        <b>{nivel}</b>
                    </span>
                    <span className="ds-menu-avatar-copy">
                        <strong>{nome}</strong>
                        <small>Costureira · nível {nivel}</small>
                    </span>
                    <i className="fas fa-chevron-right" aria-hidden="true" />
                </button>

                <nav className="ds-menu-navegacao">
                    <MenuItem icone="fa-th-large" label="Início" ativo />
                    <MenuItem icone="fa-wallet" label="Carteira" onClick={aoAbrirPagamentos} />
                    <MenuItem icone="fa-chart-line" label="Desempenho" onClick={aoAbrirDesempenho} />
                    <MenuItem icone="fa-user" label="Perfil" onClick={aoAbrirPerfil} />
                    <MenuItem icone="fa-vault" label="Banco de resgate" onClick={aoAbrirCofre} />
                </nav>

                <DashVtSaldoCard variante="desktop" />
                <DashRankingMenu dados={rankingDados} variante="desktop" />

                <div className="ds-menu-rodape">
                    {renderRodapeRecursos('desktop')}
                    <MenuItem icone="fa-sign-out-alt" label="Sair" onClick={aoSair} />
                </div>
            </aside>

            {empresaAtiva && (
                <div className="ds-menu-empresa-contexto">
                    <MenuEmpresaAtiva
                        empresa={empresaAtiva as import('../utils/menu-types').MenuEmpresa}
                        compacto
                        menuAberto={drawerAberto}
                        onClick={aoClicarEmpresa}
                    />
                    {contratoAvisoAberto && empresasDisponiveis.length <= 1 && (
                        <div className="ds-menu-contrato-tooltip" role="status">
                            Contrato de Trabalho ativo com a empresa <strong>{empresaAtiva.nome_fantasia || empresaAtiva.razao_social}</strong>.
                        </div>
                    )}
                </div>
            )}

            {empresaAtiva && empresasDisponiveis.length > 1 && (
                <MenuEmpresaSeletor
                    aberto={seletorEmpresaAberto}
                    empresas={empresasDisponiveis}
                    empresaAtiva={empresaAtiva as import('../utils/menu-types').MenuEmpresa}
                    trocandoPara={trocandoPara}
                    onClose={() => setSeletorEmpresaAberto(false)}
                    onSelect={trocarEmpresa}
                />
            )}

            <button
                type="button"
                className="ds-menu-trigger"
                onClick={() => setDrawerAberto(true)}
                aria-label="Abrir menu"
                aria-expanded={drawerAberto}
            >
                <i className="fas fa-bars" aria-hidden="true" />
            </button>

            <div
                className={'ds-menu-scrim' + (drawerAberto ? ' aberto' : '')}
                onClick={fecharDrawer}
                aria-hidden="true"
            />

            <aside
                className={'ds-menu-drawer' + (drawerAberto ? ' aberto' : '')}
                aria-label="Menu da dashboard"
                aria-hidden={!drawerAberto}
            >
                <div className="ds-menu-drawer-cabecalho">
                    <img src={avatarUrl} alt="" className="ds-menu-drawer-avatar" />
                    <div className="ds-menu-drawer-cabecalho-copy">
                        <strong>{nome}</strong>
                        <span>Costureira · nível {nivel}</span>
                    </div>
                    <button
                        type="button"
                        className="ds-menu-drawer-sair"
                        onClick={() => acaoDrawer(aoSair)}
                        aria-label="Sair do sistema"
                    >
                        <i className="fas fa-sign-out-alt" aria-hidden="true" />
                        <span>Sair</span>
                    </button>
                </div>

                <nav className="ds-menu-drawer-navegacao">
                    <MenuItem icone="fa-th-large" label="Meu painel" ativo onClick={fecharDrawer} />
                    <MenuItem icone="fa-wallet" label="Minha carteira" onClick={() => acaoDrawer(aoAbrirPagamentos)} />
                    <MenuItem icone="fa-chart-line" label="Meu desempenho" onClick={() => acaoDrawer(aoAbrirDesempenho)} />
                    <MenuItem icone="fa-user" label="Meu perfil" onClick={() => acaoDrawer(aoAbrirPerfil)} />
                    <MenuItem icone="fa-vault" label="Banco de resgate" onClick={() => acaoDrawer(aoAbrirCofre)} />
                </nav>

                <DashVtSaldoCard variante="mobile" />
                <DashRankingMenu dados={rankingDados} variante="mobile" />

                <div className="ds-menu-drawer-rodape">
                    {renderRodapeRecursos('mobile')}
                </div>
            </aside>
        </>
    );
}
