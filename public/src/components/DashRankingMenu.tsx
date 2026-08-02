import React, { useRef, useState } from 'react';
// @ts-expect-error m�dulo JS legado sem tipos
import { mostrarMensagem } from '/js/utils/popups.js';
import type { DashRankingSemana, DashRankingItem } from '../utils/dashboard-types';

function formatarPontos(valor?: number | null) {
    return Number(valor || 0).toLocaleString('pt-BR');
}

function obterNome(item?: DashRankingItem | null, tipoUsuario?: string | null) {
    if (item?.isEu) return 'Você';
    return tipoUsuario === 'tiktik' ? `Tiktik #${item?.posicao || '—'}` : `Colega #${item?.posicao || '—'}`;
}

function obterMotivacao(dados: DashRankingSemana, campea: boolean) {
    if (dados.todosZerados) return 'A semana está começando. Cada etapa já conta.';
    if (campea) return (dados.semanasNoTopo ?? 0) > 1
        ? `${dados.semanasNoTopo} semanas seguidas no topo.`
        : 'Você está liderando a semana.';
    if ((dados.gapParaProximo ?? 0) <= 50) return `Só ${dados.gapParaProximo} pts para subir.`;
    if ((dados.gapParaProximo ?? 0) <= 200) return `${dados.gapParaProximo} pts para alcançar a próxima posição.`;
    return `Continue produzindo para se aproximar da próxima posição.`;
}

interface DashRankingMenuProps {
    dados?: DashRankingSemana | null;
    variante?: 'mobile' | 'desktop' | string;
}

export default function DashRankingMenu({ dados, variante = 'mobile' }: DashRankingMenuProps) {
    const [slide, setSlide] = useState(0);
    const toqueInicial = useRef<number | null>(null);

    if (!dados || (dados.totalParticipantes ?? 0) <= 1 || !dados.ranking?.length) return null;

    const participantes = (dados.rankingCompleto || dados.ranking).filter((item) => !item.separador);
    const eu = participantes.find((item) => item.isEu);
    const campea = dados.minhaPosicao === 1 && !dados.todosZerados;
    const alvo = participantes.find((item) => item.posicao === dados.posicaoAcima);
    const pontosEu = Number(eu?.pontos || 0);
    const pontosAlvo = Number(alvo?.pontos || (pontosEu + Number(dados.gapParaProximo || 0)));
    const progressoAlvo = pontosAlvo > 0 ? Math.min(100, Math.round((pontosEu / pontosAlvo) * 100)) : 0;
    const maiorPontuacao = Math.max(...participantes.map((item) => Number(item.pontos || 0)), 1);

    const mudarSlide = (proximo: number) => {
        setSlide((atual) => (proximo + 3) % 3);
    };

    const aoToqueComecar = (event: React.TouchEvent) => {
        toqueInicial.current = event.changedTouches[0]?.clientX ?? null;
    };

    const aoToqueTerminar = (event: React.TouchEvent) => {
        if (toqueInicial.current === null) return;
        const final = event.changedTouches[0]?.clientX ?? toqueInicial.current;
        const deslocamento = final - toqueInicial.current;
        toqueInicial.current = null;
        if (Math.abs(deslocamento) < 34) return;
        mudarSlide(slide + (deslocamento < 0 ? 1 : -1));
    };

    const mostrarInfo = () => mostrarMensagem(
        '🏆 <strong>Ranking da Semana</strong><br><br>' +
        'O ranking considera apenas a produção real da semana. Pontos extras não entram na comparação, mantendo a disputa justa para todas.<br><br>' +
        'Deslize os painéis para acompanhar sua posição, o pódio e a próxima conquista.',
        'info'
    );

    return (
        <section
            className={`ds-ranking-menu ds-ranking-menu--${variante}${campea ? ' is-campea' : ''}`}
            aria-label="Ranking da semana"
        >
            <header className="ds-ranking-menu-cabecalho">
                <div>
                    <span className="ds-ranking-menu-kicker">
                        <i className="fas fa-trophy" aria-hidden="true" /> Ranking da semana
                    </span>
                    <strong>{dados.labelSemana}</strong>
                </div>
                <button type="button" className="ds-ranking-menu-info" onClick={mostrarInfo} aria-label="Sobre o ranking">
                    <i className="fas fa-circle-info" aria-hidden="true" />
                </button>
            </header>

            <div
                className="ds-ranking-menu-viewport"
                onTouchStart={aoToqueComecar}
                onTouchEnd={aoToqueTerminar}
            >
                <div className="ds-ranking-menu-trilha" style={{ transform: `translateX(-${slide * 33.333333}%)` }}>
                    <article className="ds-ranking-menu-slide">
                        <div className="ds-ranking-menu-minha-posicao">
                            <div className="ds-ranking-menu-posicao-copy">
                                <span>Você está</span>
                                <strong>{dados.todosZerados ? '—' : `${dados.minhaPosicao}º`}</strong>
                                <small>de {dados.totalParticipantes} participantes</small>
                            </div>
                            <span className="ds-ranking-menu-posicao-selo" aria-hidden="true">
                                <i className="fas fa-trophy" />
                            </span>
                        </div>
                        <div className="ds-ranking-menu-pontos">
                            <span>pontos na semana</span>
                            <strong>{formatarPontos(pontosEu)}</strong>
                        </div>
                        <p className="ds-ranking-menu-mensagem">{obterMotivacao(dados, campea)}</p>
                    </article>

                    <article className="ds-ranking-menu-slide">
                        <div className="ds-ranking-menu-slide-titulo">
                            <span>{participantes.length} participantes</span>
                            <strong>Quem está puxando o ritmo</strong>
                        </div>
                        <div className="ds-ranking-menu-lista" aria-label="Todos os participantes do ranking">
                            {participantes.map((item) => (
                                <div key={item.posicao} className={`ds-ranking-menu-lista-item${item.isEu ? ' sou-eu' : ''}`}>
                                    <span className="ds-ranking-menu-lista-posicao">{item.posicao}º</span>
                                    <strong>{obterNome(item, dados.tipoUsuario)}</strong>
                                    <span className="ds-ranking-menu-lista-barra">
                                        <span style={{ width: `${Math.round((Number(item.pontos || 0) / maiorPontuacao) * 100)}%` }} />
                                    </span>
                                    <small>{formatarPontos(item.pontos)} pts</small>
                                </div>
                            ))}
                        </div>
                    </article>

                    <article className="ds-ranking-menu-slide">
                        {campea ? (
                            <div className="ds-ranking-menu-alvo ds-ranking-menu-alvo--campea">
                                <span className="ds-ranking-menu-alvo-icone"><i className="fas fa-crown" aria-hidden="true" /></span>
                                <strong>Você está no topo</strong>
                                <p>Continue mantendo seu ritmo para fechar a semana como campeã.</p>
                            </div>
                        ) : (
                            <div className="ds-ranking-menu-alvo">
                                <span>Próxima conquista</span>
                                <strong>Alcançar a {dados.posicaoAcima || '—'}ª posição</strong>
                                <div className="ds-ranking-menu-alvo-valor">
                                    <b>{Math.max(0, Number(dados.gapParaProximo || 0))} pts</b>
                                    <small>de distância</small>
                                </div>
                                <div className="ds-ranking-menu-alvo-barra" aria-label={`${progressoAlvo}% do caminho para a próxima posição`}>
                                    <span style={{ width: `${progressoAlvo}%` }} />
                                </div>
                                <p>Uma sequência de boas etapas pode mudar sua posição.</p>
                            </div>
                        )}
                    </article>
                </div>
            </div>

            <footer className="ds-ranking-menu-rodape">
                <button type="button" onClick={() => mudarSlide(slide - 1)} aria-label="Painel anterior">
                    <i className="fas fa-chevron-left" aria-hidden="true" />
                </button>
                <div className="ds-ranking-menu-dots" aria-label={`Painel ${slide + 1} de 3`}>
                    {[0, 1, 2].map((indice) => (
                        <button
                            type="button"
                            key={indice}
                            className={slide === indice ? 'ativo' : ''}
                            onClick={() => mudarSlide(indice)}
                            aria-label={`Ir para painel ${indice + 1}`}
                            aria-current={slide === indice ? 'true' : undefined}
                        />
                    ))}
                </div>
                <button type="button" onClick={() => mudarSlide(slide + 1)} aria-label="Próximo painel">
                    <i className="fas fa-chevron-right" aria-hidden="true" />
                </button>
            </footer>
        </section>
    );
}
