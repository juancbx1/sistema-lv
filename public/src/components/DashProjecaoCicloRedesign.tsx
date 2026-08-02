import React, { useEffect, useMemo, useState } from 'react';
import type { DashMeta } from '../utils/dashboard-types';

const fmtReal = (valor: number | string | null | undefined) => Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
});

const nomeMeta = (meta: DashMeta | null | undefined, fallback: string) => {
    const nome = meta?.descricao_meta?.replace(/^Meta\s+/i, '').trim();
    return nome || fallback;
};

function identificarNivelCenario(meta: DashMeta | null | undefined, indice: number, total: number): 'bronze' | 'prata' | 'ouro' {
    const descricao = String(meta?.descricao_meta || '').toLowerCase();
    if (descricao.includes('ouro')) return 'ouro';
    if (descricao.includes('prata')) return 'prata';
    if (descricao.includes('bronze')) return 'bronze';
    if (indice === total - 1) return 'ouro';
    if (indice === 1) return 'prata';
    return 'bronze';
}

const EMOJIS_CENARIO: Record<string, string> = {
    bronze: '\u{1F44D}',
    prata: '\u2726',
    ouro: '\u{1F3C6}',
};

interface DashProjecaoCicloRedesignProps {
    valorAcumulado?: number | null;
    diasUteisNoCiclo?: number | null;
    diasTrabalhadosNoCiclo?: number | null;
    metasPossiveis?: DashMeta[] | null;
    fimCiclo?: string | null;
    diasRestantesNoCiclo?: number | null;
    aoAbrirWallet?: () => void;
}

export default function DashProjecaoCicloRedesign({
    valorAcumulado,
    diasUteisNoCiclo,
    diasTrabalhadosNoCiclo,
    metasPossiveis,
    diasRestantesNoCiclo,
    aoAbrirWallet,
}: DashProjecaoCicloRedesignProps) {
    const valorAcumuladoSafe = Number(valorAcumulado || 0);
    const diasRestantes = Math.max(0, Number(diasRestantesNoCiclo ?? 0));
    const diasTrabalhados = Math.max(0, Number(diasTrabalhadosNoCiclo || 0));
    const diasUteis = Math.max(diasTrabalhados, Number(diasUteisNoCiclo || 0));
    const metaOuro = metasPossiveis?.[metasPossiveis.length - 1] || null;

    const cenarios = useMemo(() => {
        const lista = (metasPossiveis || []).filter((meta, index, metas) => (
            metas.findIndex((item) => item.pontos_meta === meta.pontos_meta) === index
        ));

        if (lista.length <= 3) return lista;
        return [lista[0], lista[Math.floor(lista.length / 2)], lista[lista.length - 1]];
    }, [metasPossiveis]);

    const [cenarioSelecionado, setCenarioSelecionado] = useState<DashMeta | null>(metaOuro);
    const [cenarioCelebrando, setCenarioCelebrando] = useState<number | null>(null);
    const [celebracaoTimer, setCelebracaoTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
    const [detalheAberto, setDetalheAberto] = useState(false);

    useEffect(() => {
        setCenarioSelecionado(metaOuro);
    }, [metaOuro]);

    useEffect(() => () => {
        if (celebracaoTimer) clearTimeout(celebracaoTimer);
    }, [celebracaoTimer]);

    const metaAtual = cenarioSelecionado || metaOuro;
    const valorMeta = Number(metaAtual?.valor_comissao || 0);
    const projecao = valorAcumuladoSafe + (valorMeta * diasRestantes);
    const potencialRestante = Math.max(0, projecao - valorAcumuladoSafe);
    const progressoCiclo = diasUteis > 0
        ? Math.min(100, Math.round((diasTrabalhados / diasUteis) * 100))
        : 0;
    const cicloEncerrado = diasRestantes === 0;
    return (
        <section className="ds-card ds-projecao-card ds-projecao-card--unificado" aria-label="Projeção de ganhos do ciclo">
            <div className="ds-projecao-cabecalho">
                <div>
                    {cicloEncerrado && (
                        <span className="ds-projecao-kicker">Ciclo encerrado</span>
                    )}
                    <h2>
                        {cicloEncerrado
                            ? 'Este foi o resultado do seu ciclo.'
                            : 'Você pode ganhar o valor abaixo neste ciclo.'}
                    </h2>
                    <p className="ds-projecao-lede">
                        {cicloEncerrado
                            ? 'Sua comissão acumulada já está fechada para este ciclo.'
                            : 'Basta seguir as regras e bater a meta. O Ouro é o alvo; se não der, Prata e Bronze ainda contam.'}
                    </p>
                </div>
            </div>

            <div className="ds-projecao-hero-valor">
                <strong>{fmtReal(projecao)}</strong>
                <span>{cicloEncerrado ? 'comissão fechada do ciclo' : 'estimados no fechamento do ciclo'}</span>
            </div>

            <div className="ds-projecao-composicao" aria-label="Composição da projeção">
                <button
                    type="button"
                    className="ds-projecao-composicao-item ds-projecao-composicao-item--acumulado"
                    onClick={aoAbrirWallet}
                    aria-label="Abrir a carteira e ver a comissão total do ciclo"
                >
                    <i className="fas fa-wallet" aria-hidden="true"></i>
                    <span>já conquistado <strong>{fmtReal(valorAcumuladoSafe)}</strong></span>
                </button>
                <span>possibilidade de ganho <strong>{fmtReal(potencialRestante)}</strong></span>
            </div>

            <div className="ds-projecao-progresso" aria-label={`${diasTrabalhados} de ${diasUteis} dias úteis trabalhados`}>
                <div className="ds-projecao-progresso-barra">
                    <span style={{ width: `${progressoCiclo}%` }}></span>
                </div>
                <div className="ds-projecao-progresso-legenda">
                    <span>Ritmo do ciclo</span>
                    <span>{progressoCiclo}% concluído</span>
                </div>
            </div>

            {cenarios.length > 0 && (
                <div className="ds-projecao-estrategia">
                    <div className="ds-projecao-estrategia-cabecalho">
                        <div>
                            <span className="ds-projecao-estrategia-kicker">Ouro é o alvo</span>
                            <strong>Veja outras condições:</strong>
                        </div>
                    </div>
                    <div className="ds-projecao-cenarios" role="group" aria-label="Cenários de meta">
                        {cenarios.map((meta, index) => {
                            const ativo = metaAtual?.pontos_meta === meta.pontos_meta;
                            const nome = nomeMeta(meta, ['Bronze', 'Prata', 'Ouro'][index] || 'Meta');
                            const valorCenario = valorAcumuladoSafe + (Number(meta.valor_comissao || 0) * diasRestantes);
                            const nivel = identificarNivelCenario(meta, index, cenarios.length);

                            return (
                                <button
                                    key={`${meta.pontos_meta}-${index}`}
                                    type="button"
                                    className={`ds-projecao-cenario ds-projecao-cenario--${nivel}${ativo ? ' ativo' : ''}`}
                                    onClick={() => {
                                        setCenarioSelecionado(meta);
                                        if (celebracaoTimer) clearTimeout(celebracaoTimer);
                                        setCenarioCelebrando(meta.pontos_meta);
                                        setCelebracaoTimer(setTimeout(() => setCenarioCelebrando(null), 1350));
                                    }}
                                    aria-pressed={ativo}
                                >
                                    <span>{nome}</span>
                                    <strong>{fmtReal(valorCenario)}</strong>
                                    <small>{fmtReal(meta.valor_comissao)} por dia</small>
                                    {cenarioCelebrando === meta.pontos_meta && (
                                        <span
                                            className={`ds-projecao-cenario-animacao ds-projecao-cenario-animacao--${nivel}`}
                                            aria-hidden="true"
                                        >
                                            {EMOJIS_CENARIO[nivel]}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="ds-projecao-rodape">
                <button
                    type="button"
                    className="ds-projecao-calculo-link"
                    onClick={() => setDetalheAberto((aberto) => !aberto)}
                    aria-expanded={detalheAberto}
                >
                    {detalheAberto ? 'Ocultar cálculo' : 'Como calculamos?'}
                </button>
            </div>

            {detalheAberto && (
                <p className="ds-projecao-detalhe-calculo">
                    <strong>Projeção = ganho acumulado + valor da meta × dias úteis restantes.</strong>{' '}
                    O último dia trabalhado considera sua jornada e as folgas da empresa.
                </p>
            )}
        </section>
    );
}
