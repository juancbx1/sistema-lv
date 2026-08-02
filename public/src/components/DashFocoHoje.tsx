import React, { useEffect, useRef, useState } from 'react';
import type { DashMeta, DashHoje } from '../utils/dashboard-types';

function identificarNivelMeta(meta: DashMeta | null | undefined, indice: number, total: number): 'bronze' | 'prata' | 'ouro' {
    const descricao = String(meta?.descricao_meta || '').toLowerCase();
    if (descricao.includes('ouro')) return 'ouro';
    if (descricao.includes('prata')) return 'prata';
    if (descricao.includes('bronze')) return 'bronze';
    if (indice === total - 1) return 'ouro';
    if (indice === 1) return 'prata';
    return 'bronze';
}

const EMOJIS_META: Record<string, string> = {
    bronze: '\u{1F44D}',
    prata: '\u2726',
    ouro: '\u{1F3C6}',
};

interface DashFocoHojeProps {
    dadosHoje?: DashHoje | null;
    metasPossiveis?: DashMeta[] | null;
    metaInicial?: DashMeta | null;
    aoMudarMeta?: (meta: DashMeta) => void;
    diasUteisNoCiclo?: number;
}

export default function DashFocoHoje({ dadosHoje, metasPossiveis, metaInicial, aoMudarMeta }: DashFocoHojeProps) {
    const [metaSelecionada, setMetaSelecionada] = useState<DashMeta | null | undefined>(metaInicial);
    const [metaCelebrando, setMetaCelebrando] = useState<number | null>(null);
    const celebracaoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (metaInicial) setMetaSelecionada(metaInicial);
    }, [metaInicial]);

    useEffect(() => () => {
        if (celebracaoTimer.current) clearTimeout(celebracaoTimer.current);
    }, []);

    if (!metasPossiveis || metasPossiveis.length === 0) return null;

    const handleSelecionarMeta = (meta: DashMeta) => {
        setMetaSelecionada(meta);
        localStorage.setItem('meta_diaria_planejada', meta.pontos_meta.toString());
        if (aoMudarMeta) aoMudarMeta(meta);

        if (celebracaoTimer.current) clearTimeout(celebracaoTimer.current);
        setMetaCelebrando(meta.pontos_meta);
        celebracaoTimer.current = setTimeout(() => setMetaCelebrando(null), 1350);
    };

    const pontosFeitos = Math.round(dadosHoje?.pontos || 0);
    const metaAlvo = metaSelecionada?.pontos_meta || 1;
    const valorComissao = parseFloat(String(metaSelecionada?.valor_comissao || 0));
    const progresso = Math.min((pontosFeitos / metaAlvo) * 100, 100);
    const falta = Math.max(0, metaAlvo - pontosFeitos);
    const hoje = new Date().toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'America/Sao_Paulo',
    });

    let corBarra;
    if (progresso >= 100) corBarra = 'var(--ds-cor-sucesso)';
    else if (progresso >= 50) corBarra = 'var(--ds-cor-primaria)';
    else corBarra = 'var(--ds-cor-aviso)';

    const bronzePontos = metasPossiveis[0]?.pontos_meta || 0;
    const prataPontos = metasPossiveis[1]?.pontos_meta || bronzePontos;
    const ouroPontos = metasPossiveis[metasPossiveis.length - 1]?.pontos_meta || prataPontos;
    const indiceMetaSelecionada = metasPossiveis.findIndex(
        (meta) => meta.pontos_meta === metaSelecionada?.pontos_meta
    );
    const nivelMetaSelecionada = identificarNivelMeta(
        metaSelecionada,
        indiceMetaSelecionada < 0 ? metasPossiveis.length - 1 : indiceMetaSelecionada,
        metasPossiveis.length
    );

    let badgeTexto;
    let badgeClasse;
    if (pontosFeitos === 0) {
        badgeTexto = 'Bom dia! Meta de hoje: ' + metaAlvo + ' pts';
        badgeClasse = 'sem-inicio';
    } else if (pontosFeitos >= ouroPontos) {
        badgeTexto = 'Meta Ouro batida! Você arrasou hoje!';
        badgeClasse = 'ouro';
    } else if (pontosFeitos >= prataPontos) {
        badgeTexto = 'Prata batida! Faltam ' + (ouroPontos - pontosFeitos) + ' pts para o Ouro';
        badgeClasse = 'prata';
    } else if (pontosFeitos >= bronzePontos) {
        badgeTexto = 'Bronze batida! Faltam ' + (prataPontos - pontosFeitos) + ' pts para a Prata';
        badgeClasse = 'bronze';
    } else {
        badgeTexto = 'Faltam ' + falta + ' pts para a Meta Bronze';
        badgeClasse = 'em-progresso';
    }

    const coresMeta = [
        'var(--ds-cor-meta-bronze)',
        'var(--ds-cor-meta-prata)',
        'var(--ds-cor-meta-ouro)',
    ];

    return (
        <section className="ds-foco-hoje-stage" aria-label="Meta de hoje">
            <div className="ds-foco-stage-cabecalho">
                <p className="ds-foco-stage-etiqueta">Foco de hoje</p>
                <span className={`ds-foco-stage-nivel ds-foco-stage-nivel--${nivelMetaSelecionada}${metaCelebrando === metaSelecionada?.pontos_meta ? ' celebrando' : ''}`}>
                    <span>{metaSelecionada?.descricao_meta || 'Meta diária'}</span>
                    {metaCelebrando === metaSelecionada?.pontos_meta && (
                        <span
                            className={`ds-foco-stage-nivel-animacao ds-foco-stage-nivel-animacao--${nivelMetaSelecionada}`}
                            aria-hidden="true"
                        >
                            {EMOJIS_META[nivelMetaSelecionada]}
                        </span>
                    )}
                </span>
            </div>

            <div className="ds-foco-stage-principal">
                <div>
                    <div className="ds-foco-hoje-data">{hoje}</div>
                    <div className="ds-foco-hoje-pts">{pontosFeitos.toLocaleString('pt-BR')}</div>
                    <div className="ds-foco-hoje-pts-label">pontos produzidos hoje</div>
                </div>
                <div className="ds-foco-stage-potencial">
                    <span>potencial de hoje</span>
                    <strong>
                        R$ {valorComissao.toLocaleString('pt-BR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                        })}
                    </strong>
                </div>
            </div>

            <div className="ds-foco-barra-container" aria-label={progresso.toFixed(0) + '% da meta diária'}>
                <div
                    className="ds-foco-barra-fill"
                    style={{ width: progresso + '%', background: corBarra }}
                />
            </div>
            <div className="ds-foco-barra-legenda">
                <span>{pontosFeitos.toLocaleString('pt-BR')} pts</span>
                <span>{progresso.toFixed(0)}%</span>
                <span>{metaAlvo.toLocaleString('pt-BR')} pts</span>
            </div>

            <div className="ds-foco-stage-rodape">
                <div className={'ds-foco-status-badge ' + badgeClasse}>
                    <i className="fas fa-bullseye" aria-hidden="true" />
                    {badgeTexto}
                </div>

                <div className="ds-foco-meta-chips" aria-label="Escolha sua meta">
                    {metasPossiveis.map((meta, i) => {
                        const isAtiva = metaSelecionada?.pontos_meta === meta.pontos_meta;
                        const cor = coresMeta[i] || 'var(--ds-cor-primaria)';
                        const nivel = identificarNivelMeta(meta, i, metasPossiveis.length);
                        const nomeSimples = (meta.descricao_meta || 'Meta').replace('Meta ', '');
                        return (
                            <button
                                key={i}
                                type="button"
                                className={`ds-meta-nivel-${nivel}${isAtiva ? ' ativo' : ''}`}
                                onClick={() => handleSelecionarMeta(meta)}
                                style={{ ['--ds-meta-cor' as string]: cor } as React.CSSProperties}
                                aria-pressed={isAtiva}
                            >
                                <span className="ds-foco-meta-label">{nomeSimples}</span>
                                {metaCelebrando === meta.pontos_meta && (
                                    <span
                                        className={`ds-foco-meta-animacao ds-foco-meta-animacao--${nivel}`}
                                        aria-hidden="true"
                                    >
                                        {EMOJIS_META[nivel]}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className={`ds-foco-meta-info ds-foco-meta-info--${nivelMetaSelecionada}`}>
                <span>
                    Se bater: <strong className="ds-foco-meta-valor-hoje">R$ {valorComissao.toLocaleString('pt-BR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                    })} hoje</strong>
                </span>
                <span>
                    {falta > 0 ? (
                        <>
                            Faltam <strong>{falta.toLocaleString('pt-BR')} pts</strong> para sua meta
                        </>
                    ) : (
                        <strong>Meta alcançada</strong>
                    )}
                </span>
            </div>
        </section>
    );
}
