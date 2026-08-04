import React, { useEffect, useState } from 'react';
import type { DashMeta, DashHoje } from '../utils/dashboard-types';

type NivelMetaAtingido = 'nao_bateu' | 'bronze' | 'prata' | 'ouro';
type NivelMetaCelebracao = Exclude<NivelMetaAtingido, 'nao_bateu'>;

const ORDEM_NIVEIS: NivelMetaAtingido[] = ['nao_bateu', 'bronze', 'prata', 'ouro'];

const EMOJIS_META: Record<NivelMetaCelebracao, string> = {
    bronze: '\u{1F44D}',
    prata: '\u2728',
    ouro: '\u{1F3C6}',
};

const MENSAGENS_META: Record<NivelMetaCelebracao, { titulo: string; texto: string }> = {
    bronze: {
        titulo: 'Parabéns, {nome}!',
        texto: 'Você conquistou a Bronze. Agora vamos buscar a Prata?',
    },
    prata: {
        titulo: 'Sensacional, {nome}!',
        texto: 'A Prata é sua. Seu ritmo está mostrando muita força — o Ouro está logo ali.',
    },
    ouro: {
        titulo: 'Você é Ouro, {nome}!',
        texto: 'Meta máxima alcançada. Esse resultado merece uma grande festa!',
    },
};

const CORES_CONFETES: Record<NivelMetaCelebracao, string[]> = {
    bronze: ['#f2b38d', '#d98655', '#ffe6d3', '#ffe7a2', '#8ed1c0'],
    prata: ['#f5f8fb', '#cad6e0', '#dce6ed', '#ffe7a2', '#8ed1c0'],
    ouro: ['#ffe7a2', '#f4cf63', '#fff7d5', '#8ed1c0', '#dce6ed', '#d98655'],
};

const CONFETES = Array.from({ length: 42 }, (_, index) => {
    const angulo = (index / 42) * Math.PI * 2;
    const distancia = 34 + (index % 6) * 14;
    return {
        id: index,
        origemX: 46 + Math.cos(angulo) * 10,
        origemY: 82 + (index % 4) * 4,
        destinoX: Math.cos(angulo) * distancia,
        destinoY: Math.sin(angulo) * distancia - 48,
        rotacao: (index % 2 === 0 ? 1 : -1) * (180 + index * 19),
        atraso: (index % 8) * 24,
    };
});

const GLITTERS = Array.from({ length: 12 }, (_, index) => ({
    id: index,
    left: 8 + ((index * 37) % 88),
    top: 25 + ((index * 19) % 45),
    destinoX: (index % 2 === 0 ? 1 : -1) * (8 + (index % 4) * 7),
    destinoY: -18 - (index % 5) * 8,
    atraso: (index % 6) * 110,
}));

function identificarNivelMeta(meta: DashMeta | null | undefined, indice: number, total: number): 'bronze' | 'prata' | 'ouro' {
    const descricao = String(meta?.descricao_meta || '').toLowerCase();
    if (descricao.includes('ouro')) return 'ouro';
    if (descricao.includes('prata')) return 'prata';
    if (descricao.includes('bronze')) return 'bronze';
    if (indice === total - 1) return 'ouro';
    if (indice === 1) return 'prata';
    return 'bronze';
}

function obterMetaPorNivel(metas: DashMeta[], nivel: NivelMetaCelebracao): DashMeta | null {
    const porDescricao = metas.find((meta) => String(meta.descricao_meta || '').toLowerCase().includes(nivel));
    if (porDescricao) return porDescricao;

    const metasOrdenadas = [...metas].sort((a, b) => a.pontos_meta - b.pontos_meta);
    if (nivel === 'bronze') return metasOrdenadas[0] ?? null;
    if (nivel === 'prata') return metasOrdenadas[1] ?? metasOrdenadas[0] ?? null;
    return metasOrdenadas[metasOrdenadas.length - 1] ?? null;
}

function obterNivelAtingido(pontos: number, metas: DashMeta[]): NivelMetaAtingido {
    if (metas.length === 0) return 'nao_bateu';

    const metasOrdenadas = [...metas].sort((a, b) => a.pontos_meta - b.pontos_meta);
    const bronze = metasOrdenadas[0]?.pontos_meta || 0;
    const prata = metasOrdenadas[1]?.pontos_meta || bronze;
    const ouro = metasOrdenadas[metasOrdenadas.length - 1]?.pontos_meta || prata;

    if (pontos >= ouro && metasOrdenadas.length >= 3) return 'ouro';
    if (pontos >= prata && metasOrdenadas.length >= 2) return 'prata';
    if (pontos >= bronze) return 'bronze';
    return 'nao_bateu';
}

function nivelParaOrdem(nivel: string | null): number {
    const indice = ORDEM_NIVEIS.indexOf(nivel as NivelMetaAtingido);
    return indice >= 0 ? indice : 0;
}

function obterDataSaoPaulo(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
    }).format(new Date());
}

function obterNivelDemoLocal(): NivelMetaAtingido | null {
    if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) return null;

    const nivel = new URLSearchParams(window.location.search).get('meta_demo')?.toLowerCase();
    if (nivel === 'none') return 'nao_bateu';
    return nivel === 'bronze' || nivel === 'prata' || nivel === 'ouro' ? nivel : null;
}

interface DashFocoHojeProps {
    dadosHoje?: DashHoje | null;
    metasPossiveis?: DashMeta[] | null;
    metaInicial?: DashMeta | null;
    aoMudarMeta?: (meta: DashMeta) => void;
    diasUteisNoCiclo?: number;
    usuarioId?: number;
    empresaId?: number;
    nomeUsuario?: string | null;
}

export default function DashFocoHoje({
    dadosHoje,
    metasPossiveis,
    metaInicial,
    aoMudarMeta,
    usuarioId,
    empresaId,
    nomeUsuario,
}: DashFocoHojeProps) {
    const [metaSelecionada, setMetaSelecionada] = useState<DashMeta | null | undefined>(metaInicial);
    const [metaCelebrando, setMetaCelebrando] = useState<NivelMetaCelebracao | null>(null);
    const [celebracaoId, setCelebracaoId] = useState(0);
    const [metaBotaoAnimando, setMetaBotaoAnimando] = useState<number | null>(null);
    const [metaBotaoAnimacaoId, setMetaBotaoAnimacaoId] = useState(0);

    const metasValidas = metasPossiveis ?? [];
    const metasOrdenadas = [...metasValidas].sort((a, b) => a.pontos_meta - b.pontos_meta);
    const pontosReais = Math.round(dadosHoje?.pontos || 0);
    const bronzePontos = metasOrdenadas[0]?.pontos_meta || 0;
    const prataPontos = metasOrdenadas[1]?.pontos_meta || bronzePontos;
    const ouroPontos = metasOrdenadas[metasOrdenadas.length - 1]?.pontos_meta || prataPontos;
    const nivelDemo = obterNivelDemoLocal();
    const nivelAtingidoReal = obterNivelAtingido(pontosReais, metasValidas);
    const nivelAtingido = nivelDemo ?? nivelAtingidoReal;
    const pontosDemo = nivelDemo === 'bronze'
        ? bronzePontos
        : nivelDemo === 'prata'
            ? prataPontos
            : nivelDemo === 'ouro'
                ? ouroPontos
                : nivelDemo === 'nao_bateu'
                    ? 0
                : pontosReais;
    const pontosFeitos = nivelDemo ? pontosDemo : pontosReais;
    const dataCelebracao = obterDataSaoPaulo();
    const chaveCelebracao = `dashboard-meta-celebracao:${empresaId ?? 'empresa'}:${usuarioId ?? 'usuario'}:${dataCelebracao}`;

    useEffect(() => {
        if (metaInicial) setMetaSelecionada(metaInicial);
    }, [metaInicial]);

    useEffect(() => {
        if (nivelAtingido === 'nao_bateu') {
            setMetaCelebrando(null);
            return;
        }

        if (nivelDemo && nivelDemo !== 'nao_bateu') {
            setMetaCelebrando(nivelDemo);
            setCelebracaoId((valor) => valor + 1);
            return;
        }

        let ultimoNivel: string | null = null;
        try {
            ultimoNivel = localStorage.getItem(chaveCelebracao);
        } catch {
            // A animação continua funcionando mesmo quando o navegador bloqueia o storage.
        }

        if (nivelParaOrdem(nivelAtingido) > nivelParaOrdem(ultimoNivel)) {
            setMetaCelebrando(nivelAtingido);
            setCelebracaoId((valor) => valor + 1);
            try {
                localStorage.setItem(chaveCelebracao, nivelAtingido);
            } catch {
                // Não bloqueia a celebração por causa de uma falha de persistência.
            }
        } else {
            setMetaCelebrando(null);
        }
    }, [chaveCelebracao, nivelAtingido, nivelDemo]);

    if (!metasPossiveis || metasPossiveis.length === 0) return null;

    const handleSelecionarMeta = (meta: DashMeta) => {
        setMetaSelecionada(meta);
        setMetaBotaoAnimando(meta.pontos_meta);
        setMetaBotaoAnimacaoId((valor) => valor + 1);
        localStorage.setItem('meta_diaria_planejada', meta.pontos_meta.toString());
        if (aoMudarMeta) aoMudarMeta(meta);
    };

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

    const indiceMetaSelecionada = metasValidas.findIndex(
        (meta) => meta.pontos_meta === metaSelecionada?.pontos_meta,
    );
    const nivelMetaSelecionada = identificarNivelMeta(
        metaSelecionada,
        indiceMetaSelecionada < 0 ? metasValidas.length - 1 : indiceMetaSelecionada,
        metasValidas.length,
    );
    const nivelCelebracao = metaCelebrando && MENSAGENS_META[metaCelebrando] ? metaCelebrando : null;
    const nome = nomeUsuario?.trim().split(/\s+/)[0] || 'você';
    const mensagemCelebracao = nivelCelebracao ? MENSAGENS_META[nivelCelebracao] : null;
    const statusClasse = nivelAtingido === 'nao_bateu' ? 'em-progresso' : nivelAtingido;
    const nivelBarra = nivelAtingido === 'ouro'
        ? 'ouro'
        : nivelMetaSelecionada === 'ouro'
            ? 'ouro-alvo-nao-atingido'
            : nivelMetaSelecionada;
    const classeBarra = [
        `ds-foco-barra-fill--${nivelBarra}`,
        nivelAtingido === 'nao_bateu' ? 'ds-foco-barra-fill--carregando' : '',
    ].filter(Boolean).join(' ');
    const metaBronze = obterMetaPorNivel(metasValidas, 'bronze');
    const metaPrata = obterMetaPorNivel(metasValidas, 'prata') ?? metaBronze;
    const metaOuro = obterMetaPorNivel(metasValidas, 'ouro') ?? metaPrata;
    const formatarValorMeta = (meta: DashMeta | null) => `R$ ${parseFloat(String(meta?.valor_comissao || 0)).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
    const metaGarantida = nivelAtingido === 'bronze'
        ? metaBronze
        : nivelAtingido === 'prata'
            ? metaPrata
            : metaOuro;
    const potencialDetalhe = nivelAtingido === 'nao_bateu'
        ? 'continue buscando o Ouro'
        : nivelAtingido === 'bronze'
            ? 'Prata e Ouro ainda possíveis'
            : nivelAtingido === 'prata'
                ? 'falta conquistar o Ouro'
                : 'Ouro garantido hoje';
    const proximoNivelLegenda = nivelAtingido === 'nao_bateu'
        ? 'Próximo nível: Bronze'
        : nivelAtingido === 'bronze'
            ? 'Próximo nível: Prata'
            : nivelAtingido === 'prata'
                ? 'Próximo nível: Ouro'
                : 'Nível máximo atingido';

    let badgeTexto;
    if (pontosFeitos === 0) {
        badgeTexto = 'Bom dia! Meta de hoje: ' + metaAlvo + ' pts';
    } else if (nivelAtingido === 'ouro') {
        badgeTexto = 'Meta Ouro batida! Você arrasou hoje!';
    } else if (nivelAtingido === 'prata') {
        badgeTexto = 'Prata batida! Faltam ' + Math.max(0, ouroPontos - pontosFeitos) + ' pts para o Ouro';
    } else if (nivelAtingido === 'bronze') {
        badgeTexto = 'Bronze batida! Faltam ' + Math.max(0, prataPontos - pontosFeitos) + ' pts para a Prata';
    } else {
        badgeTexto = 'Faltam ' + falta + ' pts para a Meta Bronze';
    }

    const coresMeta = [
        'var(--ds-cor-meta-bronze)',
        'var(--ds-cor-meta-prata)',
        'var(--ds-cor-meta-ouro)',
    ];

    return (
        <section
            className={`ds-foco-hoje-stage ds-foco-hoje-stage--${nivelAtingido}${nivelCelebracao ? ' ds-foco-hoje-stage--celebrando' : ''}`}
            aria-label="Meta de hoje"
        >
            <div className="ds-foco-stage-cabecalho">
                <p className="ds-foco-stage-etiqueta">Foco de hoje</p>
                <span className={`ds-foco-stage-nivel ds-foco-stage-nivel--${nivelMetaSelecionada}`}>
                    <span>{metaSelecionada?.descricao_meta || 'Meta diária'}</span>
                </span>
            </div>

            <div className="ds-foco-stage-principal">
                <div>
                    <div className="ds-foco-hoje-data">{hoje}</div>
                    <div className="ds-foco-hoje-pts">{pontosFeitos.toLocaleString('pt-BR')}</div>
                    <div className="ds-foco-hoje-pts-label">pontos produzidos hoje</div>
                </div>
                <div className={`ds-foco-stage-potencial ds-foco-stage-potencial--${nivelAtingido}`}>
                    <span className="ds-foco-stage-potencial-rotulo">
                        {nivelAtingido === 'nao_bateu' ? 'potencial máximo' : nivelAtingido === 'ouro' ? 'Meta máxima' : 'Meta garantida'}
                    </span>
                    {nivelAtingido === 'bronze' || nivelAtingido === 'prata' ? (
                        <div className="ds-foco-stage-potencial-comparacao" aria-label={`Potencial do Ouro ${formatarValorMeta(metaOuro)} e valor garantido ${formatarValorMeta(metaGarantida)}`}>
                            <del className="ds-foco-potencial-alvo">{formatarValorMeta(metaOuro)}</del>
                            <span className="ds-foco-potencial-seta" aria-hidden="true">›</span>
                            <strong>{formatarValorMeta(metaGarantida)}</strong>
                        </div>
                    ) : (
                        <strong>{formatarValorMeta(metaOuro)}</strong>
                    )}
                    <small>{potencialDetalhe}</small>
                </div>
            </div>

            <div
                className={`ds-foco-barra-container ds-foco-barra-container--${nivelAtingido}`}
                aria-label={progresso.toFixed(0) + '% da meta diária'}
            >
                <div
                    className={`ds-foco-barra-fill ${classeBarra}`}
                    style={{ width: progresso + '%' }}
                />
                {nivelAtingido === 'ouro' && (
                    <div className="ds-foco-barra-glitters" aria-hidden="true">
                        {GLITTERS.map((glitter) => (
                            <span
                                key={glitter.id}
                                style={{
                                    '--ds-glitter-left': `${glitter.left}%`,
                                    '--ds-glitter-top': `${glitter.top}%`,
                                    '--ds-glitter-x': `${glitter.destinoX}px`,
                                    '--ds-glitter-y': `${glitter.destinoY}px`,
                                    '--ds-glitter-delay': `${glitter.atraso}ms`,
                                } as React.CSSProperties}
                            >
                                ✦
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <div className="ds-foco-barra-legenda">
                <span>{proximoNivelLegenda}</span>
                <span>{progresso.toFixed(0)}%</span>
                <span>{metaAlvo.toLocaleString('pt-BR')} pts</span>
            </div>

            {nivelCelebracao && mensagemCelebracao && (
                <div
                    key={`${nivelCelebracao}-${celebracaoId}`}
                    className={`ds-foco-meta-celebracao ds-foco-meta-celebracao--${nivelCelebracao}`}
                    role="status"
                    aria-live="polite"
                >
                    <div className="ds-foco-confetes" aria-hidden="true">
                        {CONFETES.map((confete, index) => (
                            <span
                                key={confete.id}
                                style={{
                                    '--ds-confete-origem-x': `${confete.origemX}%`,
                                    '--ds-confete-origem-y': `${confete.origemY}%`,
                                    '--ds-confete-destino-x': `${confete.destinoX}px`,
                                    '--ds-confete-destino-y': `${confete.destinoY}px`,
                                    '--ds-confete-rotacao': `${confete.rotacao}deg`,
                                    '--ds-confete-delay': `${confete.atraso}ms`,
                                    '--ds-confete-cor': CORES_CONFETES[nivelCelebracao][index % CORES_CONFETES[nivelCelebracao].length],
                                } as React.CSSProperties}
                            />
                        ))}
                    </div>
                    <span className="ds-foco-celebracao-icone" aria-hidden="true">{EMOJIS_META[nivelCelebracao]}</span>
                    <strong>{mensagemCelebracao.titulo.replace('{nome}', nome)}</strong>
                    <span>{mensagemCelebracao.texto}</span>
                </div>
            )}

            <div className="ds-foco-stage-rodape">
                <div className={'ds-foco-status-badge ' + statusClasse}>
                    <i className="fas fa-bullseye" aria-hidden="true" />
                    {badgeTexto}
                </div>

                <div className="ds-foco-meta-chips" aria-label="Escolha sua meta">
                    {metasValidas.map((meta, i) => {
                        const isAtiva = metaSelecionada?.pontos_meta === meta.pontos_meta;
                        const cor = coresMeta[i] || 'var(--ds-cor-primaria)';
                        const nivel = identificarNivelMeta(meta, i, metasValidas.length);
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
                                {metaBotaoAnimando === meta.pontos_meta && (
                                    <span
                                        key={`${meta.pontos_meta}-${metaBotaoAnimacaoId}`}
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

        </section>
    );
}
