import React, { useState, useEffect, useRef } from 'react';
import { fetchAPI } from '/js/utils/api-utils';
import { mostrarMensagem } from '/js/utils/popups.js';

export default function DashRankingCard() {
    const [dados, setDados] = useState(null);
    const [carregando, setCarregando] = useState(true);
    const intervalRef = useRef(null);

    const buscar = async () => {
        try {
            const resultado = await fetchAPI('/api/dashboard/ranking-semana');
            setDados(resultado);
        } catch {
            setDados(null);
        } finally {
            setCarregando(false);
        }
    };

    useEffect(() => {
        buscar();
        intervalRef.current = setInterval(buscar, 10 * 60 * 1000);

        const aoMudarVisibilidade = () => {
            if (document.visibilityState === 'visible') {
                buscar();
                intervalRef.current = setInterval(buscar, 10 * 60 * 1000);
            } else {
                clearInterval(intervalRef.current);
            }
        };
        document.addEventListener('visibilitychange', aoMudarVisibilidade);

        return () => {
            clearInterval(intervalRef.current);
            document.removeEventListener('visibilitychange', aoMudarVisibilidade);
        };
    }, []);

    if (carregando) return null;
    if (!dados || dados.totalParticipantes <= 1 || dados.ranking.length === 0) return null;

    const {
        minhaPosicao, totalParticipantes, tipoUsuario,
        gapParaProximo, posicaoAcima, labelSemana,
        diaSemana, todosZerados, ranking, semanasNoTopo,
    } = dados;

    const isCampiao = minhaPosicao === 1 && !todosZerados;
    const top3 = ranking.filter(r => !r.separador && r.posicao <= 3);
    const maxPontos = Math.max(...ranking.filter(r => !r.separador && r.pontos != null).map(r => r.pontos), 1);

    const gerarLabel = (item) => {
        if (item.isEu) return 'Você';
        if (tipoUsuario === 'tiktik') return `Tiktik #${item.posicao}`;
        return `Colega #${item.posicao}`;
    };

    const renderMotivacao = () => {
        if (todosZerados) {
            return diaSemana === 0
                ? '☀️ Semana nova chegando! Amanhã é hora de produzir!'
                : '⏳ Nenhuma produção ainda esta semana. Seja a primeira a pontuar!';
        }

        if (minhaPosicao === 1) {
            if (semanasNoTopo && semanasNoTopo > 1) {
                return `✨ ${semanasNoTopo} semanas no topo seguidas! Que produção incrível!`;
            }
            if (diaSemana === 6) return '🏆 Você foi a melhor desta semana! Continue essa pegada!';
            return '🌟 Ninguém chega perto! Você está dominando essa semana!';
        }

        if (diaSemana === 6) {
            return `A semana acabou no ${minhaPosicao}° lugar. Semana que vem você vai mais longe! 💪`;
        }

        const unidade = tipoUsuario === 'tiktik' ? 'arremates' : 'peças';
        const uniSingular = tipoUsuario === 'tiktik' ? 'arremate' : 'peça';

        if (gapParaProximo <= 50) {
            return `Você está a apenas ${gapParaProximo} pts da ${posicaoAcima}ª! Uma hora de produção muda tudo!`;
        }
        if (gapParaProximo <= 200) {
            return `Faltam ${gapParaProximo} pts para a ${posicaoAcima}ª. Foca nas próximas ${unidade} e sobe uma posição!`;
        }
        return `${gapParaProximo} pts para a ${posicaoAcima}ª. Cada ${uniSingular} conta — não para agora!`;
    };

    const bannerTitulo = todosZerados
        ? 'Semana começando! 🚀'
        : isCampiao
            ? 'VOCÊ É A MELHOR DA SEMANA! 🏆'
            : 'Você está entre as melhores!';

    return (
        <div className={`ds-card ds-ranking-card${isCampiao ? ' is-campiao' : ''}`}>
            {/* Banner de posição */}
            <div className="ds-ranking-banner">
                <div className="ds-ranking-posicao-num">
                    {todosZerados ? '—' : `${minhaPosicao}ª`}
                </div>
                <div className="ds-ranking-banner-info">
                    <div className="ds-ranking-banner-titulo">{bannerTitulo}</div>
                    <div className="ds-ranking-banner-sub">{labelSemana}</div>
                </div>
                {isCampiao && <div className="ds-ranking-confetti">🎊</div>}
            </div>

            {/* Corpo */}
            <div className="ds-ranking-corpo">
                <div className="ds-ranking-corpo-header">
                    <span className="ds-card-titulo-sm">🏆 Ranking da Semana</span>
                    <button
                        className="ds-ranking-info-btn"
                        title="Sobre o ranking"
                        onClick={() => mostrarMensagem(
                            '🏆 <strong>Ranking da Semana</strong><br><br>' +
                            'O ranking conta apenas a produção real da semana — ' +
                            'peças produzidas e arremates.<br><br>' +
                            '✨ <strong>Pontos Extras</strong> (bônus concedidos pelo supervisor) ' +
                            '<strong>não entram no ranking</strong>, pois seria injusto comparar ' +
                            'quem recebeu bônus com quem não recebeu.<br><br>' +
                            'Continue produzindo para subir na classificação! 💪',
                            'info'
                        )}
                    >
                        <i className="fas fa-circle-info"></i>
                    </button>
                </div>

                {/* Mini pódio — mostra top 3 quando há dados */}
                {top3.length >= 2 && !todosZerados && (
                    <div className="ds-ranking-podium">
                        {top3.map(item => (
                            <div
                                key={item.posicao}
                                className={`ds-ranking-mini${item.isEu ? (isCampiao ? ' eu-campiao' : ' eu') : ''}`}
                            >
                                <div className="ds-ranking-mini-pos">
                                    {['🥇', '🥈', '🥉'][item.posicao - 1]}
                                </div>
                                <div className="ds-ranking-mini-nome">{item.isEu ? 'Você' : gerarLabel(item)}</div>
                                <div className="ds-ranking-mini-pts">
                                    {item.pontos != null ? item.pontos.toLocaleString('pt-BR') : '—'}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Lista completa — oculta quando nenhuma produção ainda */}
                {!todosZerados && <div className="ds-ranking-lista">
                    {ranking.map((item, idx) => {
                        if (item.separador) {
                            return (
                                <div key={`sep-${idx}`} className="ds-ranking-item separador">
                                    · · · · ·
                                </div>
                            );
                        }

                        const isPrimeiro = item.posicao === 1;
                        const barraLargura = item.pontos != null ? Math.round((item.pontos / maxPontos) * 100) : 0;

                        return (
                            <div
                                key={`pos-${item.posicao}`}
                                className={`ds-ranking-item${item.isEu ? ' sou-eu' : ''}${isPrimeiro ? ' primeiro' : ''}`}
                            >
                                <span className="ds-ranking-posicao">
                                    {isPrimeiro ? '🥇' : `${item.posicao}°`}
                                </span>
                                <span className={`ds-ranking-nome${item.isEu ? ' sou-eu' : ''}`}>
                                    {gerarLabel(item)}
                                </span>
                                <div className="ds-ranking-barra-container">
                                    <div
                                        className={`ds-ranking-barra-fill${isPrimeiro ? ' primeiro' : ''}${item.isEu ? ' sou-eu' : ''}`}
                                        style={{ width: `${barraLargura}%` }}
                                    />
                                </div>
                                <span className="ds-ranking-pontos">
                                    {item.pontos != null ? `${item.pontos.toLocaleString('pt-BR')} pts` : '—'}
                                </span>
                            </div>
                        );
                    })}
                </div>}

                <div className={`ds-ranking-motivacao${isCampiao ? ' is-campiao' : ''}`}>
                    {renderMotivacao()}
                </div>
            </div>
        </div>
    );
}
