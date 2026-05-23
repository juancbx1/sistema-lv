// public/src/components/OPCortesAgente.jsx
// Agente de Planejamento de Corte — idle com typewriter + scanning + plano do dia

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import UIAgenteIA from './UIAgenteIA';
import useTypewriter from '../hooks/useTypewriter';
import useContador from '../hooks/useContador.js';
import OPAgenteFaseScan from './OPAgenteFaseScan.jsx';
import UIBloqueio from './UIBloqueio.jsx';

// ── Frases de repouso ─────────────────────────────────────────────────────────

const FRASES_MONITORANDO = [
    'Estou monitorando o estoque de cortes. Quer cortar agora?',
    'Acompanhando as demandas de corte em tempo real.',
    'Nada detectado ainda. Posso analisar o plano de corte quando quiser.',
    'Sistemas ativos. Aguardo seu comando para verificar os cortes pendentes.',
    'Estou de olho nas pendências de cortes. Devo verificar agora?',
    'Tudo dentro do esperado até agora. Quer um plano de corte atualizado?',
];

const FRASES_PARCIAL = [
    '{nome}, reparei que ficaram itens no plano sem corte registrado. Verifico agora?',
    'Você não cortou todos os itens do plano, {nome}. Quer resolver o restante?',
    'Ainda há déficit de corte na linha. Posso rever o plano?',
    '{nome}, percebo que ficaram pendências de corte. Revejo o plano agora?',
    'Missão incompleta! Ainda há itens aguardando corte no plano.',
    'Deixou alguns para depois? Posso verificar o que ainda precisa de corte.',
];

const FRASES_SONDAGEM_ENCONTROU = [
    '{nome}, acabei de verificar por conta própria... há {qtd} {item} com déficit de corte.',
    'Enquanto você estava aqui, dei uma olhada rápida. {qtd} {item} precisa{m} de corte.',
    '{nome}, atenção — encontrei déficit em {qtd} {item} sem você precisar pedir.',
    'Fiz uma verificação silenciosa agora. {qtd} {item} no plano de corte. Quer o relatório?',
];

// ── Helpers de memória de sessão ──────────────────────────────────────────────

function lerMemoria(chave) {
    try {
        const raw = sessionStorage.getItem(chave);
        if (!raw) return null;
        const mem = JSON.parse(raw);
        if (Date.now() - mem.timestamp > 2 * 3600 * 1000) return null;
        return mem;
    } catch { return null; }
}

function gravarMemoria(chave, dados) {
    try {
        sessionStorage.setItem(chave, JSON.stringify({ ...dados, timestamp: Date.now() }));
    } catch { /* silencioso */ }
}

function calcularTempoRelativo(timestamp) {
    const diff = Date.now() - timestamp;
    const min = Math.floor(diff / 60000);
    if (min < 2) return 'agora mesmo';
    if (min < 60) return `há ${min} minutos`;
    return `há ${Math.floor(min / 60)}h`;
}

function construirFraseMemoriaCortes(mem, nomeUsuario) {
    const nome = nomeUsuario ? `${nomeUsuario}, ` : '';
    const ha = calcularTempoRelativo(mem.timestamp);

    if (mem.encontrados > 0 && mem.voltouParcial) {
        return `${nome}${ha} ainda havia déficit de corte. Quer que eu verifique de novo?`;
    }
    if (mem.encontrados === 0) {
        return `${ha} o estoque de cortes estava em dia. Quer verificar se mudou algo?`;
    }
    return null;
}

// ── Substitui placeholders numa frase ────────────────────────────────────────

function substituirPlaceholders(frase, nome, extra = {}) {
    let r = frase;
    if (nome) {
        r = r.replace(/\{nome\}/g, nome);
    } else {
        r = r.replace(/\{nome\},?\s*/g, '').replace(/,?\s*\{nome\}/g, '');
    }
    for (const [k, v] of Object.entries(extra)) {
        r = r.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return r;
}

const MENSAGENS_SCAN = [
    { texto: 'Verificando demandas abertas...' },
    { texto: 'Cruzando com estoque de cortes...' },
    { texto: 'Calculando solicitações de produção...', contador: { alvo: 15, sufixo: 'produtos analisados' } },
    { texto: 'Gerando plano de corte...' },
];

// ── Calcula score de confiança da análise (75–97%) ────────────────────────────
function calcularConfiancaCortes(alertasDeficit, totalProdutos) {
    if (!totalProdutos) return 88;
    const cobertura = Math.min((totalProdutos - alertasDeficit) / totalProdutos, 1);
    return Math.round(75 + cobertura * 22);
}

// Sub-componente inline: contador animado para o score
function ScoreCounter({ alvo }) {
    const valor = useContador(alvo, 1400, true);
    return <>{valor}</>;
}

const INTERVALO_AO_VIVO_MS = 90_000;
const DELAY_SONDAGEM_MS    = 12_000;
const MIN_INTERVALO_MS     = 300_000;

// ─────────────────────────────────────────────────────────────────────────────

export default function OPCortesAgente({ produtos, onCortarAgora, rescanKey, cortesEmEstoque, nomeUsuario }) {
    const [agentState, setAgentState] = useState('idle'); // 'idle' | 'scanning' | 'avaliando' | 'done'
    const [mensagensVisiveis, setMensagensVisiveis] = useState([]); // array de objetos { texto, contador? }
    const [scoreAlvo, setScoreAlvo] = useState(0);
    const [plano, setPlano] = useState([]);
    const [ultimoScan, setUltimoScan] = useState(null);
    const [voltouParcial, setVoltouParcial] = useState(false);
    const [sondagemSilenciosa, setSondagemSilenciosa] = useState(null);
    const [memoriaCortes, setMemoriaCortes] = useState(() => lerMemoria('agente_cortes_memoria'));

    const ultimaSondagemRef  = useRef(null);
    const avaliandoTimerRef  = useRef(null);

    const iniciarScan = useCallback(async () => {
        setSondagemSilenciosa(null);
        setAgentState('scanning');
        setMensagensVisiveis([]);
        setPlano([]);

        try {
            const token = localStorage.getItem('token');

            const fetchPromise = fetch('/api/cortes/radar', {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json());

            for (let i = 0; i < MENSAGENS_SCAN.length; i++) {
                if (i > 0) await new Promise(r => setTimeout(r, 580));
                setMensagensVisiveis(prev => [...prev, MENSAGENS_SCAN[i]]);
            }

            const data = await fetchPromise;
            if (data.error) throw new Error(data.error);

            const planoEnriquecido = (data.alertasDeficit || []).map(item => {
                const produtoCompleto = produtos.find(p => p.id === item.produto_id) || null;
                let imagem = produtoCompleto?.imagem || null;
                if (produtoCompleto && item.variante && produtoCompleto.grade) {
                    const g = produtoCompleto.grade.find(g => g.variacao === item.variante);
                    if (g?.imagem) imagem = g.imagem;
                }
                return {
                    ...item,
                    imagem,
                    deficit: item.pecas_necessarias - item.pecas_em_estoque,
                    produtoCompleto
                };
            });

            await new Promise(r => setTimeout(r, 380));
            const count = planoEnriquecido.length;
            const finalMsg = count > 0
                ? `${count} item${count > 1 ? 's' : ''} no plano de corte de hoje.`
                : 'Estoque em dia! Nenhuma demanda pendente sem corte.';
            setMensagensVisiveis(prev => [...prev, { texto: finalMsg }]);

            await new Promise(r => setTimeout(r, 440));

            // Salva na memória de sessão
            gravarMemoria('agente_cortes_memoria', { encontrados: planoEnriquecido.length, voltouParcial: false });

            setPlano(planoEnriquecido);
            setUltimoScan(new Date());

            // Transita por 'avaliando' antes de 'done' (score de confiança)
            const score = calcularConfiancaCortes(count, produtos?.length || 0);
            setScoreAlvo(score);
            setAgentState('avaliando');
            clearTimeout(avaliandoTimerRef.current);
            avaliandoTimerRef.current = setTimeout(() => setAgentState('done'), 1800);

        } catch (err) {
            setMensagensVisiveis(prev => [...prev, `Erro: ${err.message}`]);
            setTimeout(() => setAgentState('idle'), 2500);
        }
    }, [produtos]);

    // ── Sondagem silenciosa ───────────────────────────────────────────────────
    useEffect(() => {
        if (agentState !== 'idle') return;

        const agora = Date.now();
        const ultima = ultimaSondagemRef.current || 0;
        const tempoEspera = Math.max(
            DELAY_SONDAGEM_MS,
            MIN_INTERVALO_MS - (agora - ultima)
        );

        const timer = setTimeout(async () => {
            if (agentState !== 'idle') return;
            if (document.visibilityState !== 'visible') return;

            ultimaSondagemRef.current = Date.now();

            try {
                const token = localStorage.getItem('token');
                const data = await fetch('/api/cortes/radar', {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => r.json());

                const quantidade = (data.alertasDeficit || []).length;
                setSondagemSilenciosa({ timestamp: Date.now(), encontrou: quantidade > 0, quantidade });
            } catch { /* silencioso */ }
        }, tempoEspera);

        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agentState]);

    const resetar = useCallback(() => {
        clearTimeout(avaliandoTimerRef.current);
        const foiParcial = plano.length > 0;
        // Atualiza memória com informação de parcial antes de resetar
        const memAtual = lerMemoria('agente_cortes_memoria') || {};
        gravarMemoria('agente_cortes_memoria', { ...memAtual, voltouParcial: foiParcial });
        setVoltouParcial(foiParcial);
        setMemoriaCortes(lerMemoria('agente_cortes_memoria'));
        setSondagemSilenciosa(null);
        setAgentState('idle');
        setMensagensVisiveis([]);
        setPlano([]);
        setUltimoScan(null);
    }, [plano]);

    useEffect(() => {
        if (rescanKey > 0) iniciarScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rescanKey]);

    useEffect(() => {
        if (agentState !== 'done') return;
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') iniciarScan();
        }, INTERVALO_AO_VIVO_MS);
        return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agentState]);

    useEffect(() => {
        const handlePainelFechado = () => {
            if (agentState === 'done') iniciarScan();
        };
        window.addEventListener('painel-demandas-fechado', handlePainelFechado);
        return () => window.removeEventListener('painel-demandas-fechado', handlePainelFechado);
    }, [agentState, iniciarScan]);

    // ── Frases e prioridade ───────────────────────────────────────────────────

    const classeCard = voltouParcial ? ' parcial' : '';

    const frasesEmbaralhadas = useMemo(() => {
        const base = voltouParcial ? FRASES_PARCIAL : FRASES_MONITORANDO;
        const comNome = base.map(f => substituirPlaceholders(f, nomeUsuario));
        const inicio = Math.floor(Math.random() * comNome.length);
        return [...comNome.slice(inicio), ...comNome.slice(0, inicio)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [voltouParcial, nomeUsuario]);

    const { encontrou: sondagemEncontrou = false, quantidade: sondagemQtd = 0 } = sondagemSilenciosa || {};
    const fraseSondagem = useMemo(() => {
        if (!sondagemEncontrou || !sondagemQtd) return null;
        const b = FRASES_SONDAGEM_ENCONTROU[Math.floor(Math.random() * FRASES_SONDAGEM_ENCONTROU.length)];
        return substituirPlaceholders(b, nomeUsuario, {
            qtd: sondagemQtd,
            item: sondagemQtd === 1 ? 'item' : 'itens',
            m: sondagemQtd === 1 ? '' : 'm',
        });
    }, [sondagemEncontrou, sondagemQtd, nomeUsuario]);

    const fraseMemoria = useMemo(() =>
        memoriaCortes ? construirFraseMemoriaCortes(memoriaCortes, nomeUsuario) : null,
        [memoriaCortes, nomeUsuario]
    );

    // Contexto passivo — usa cortesEmEstoque se disponível
    const fraseContextual = useMemo(() => {
        if (!cortesEmEstoque || cortesEmEstoque.length === 0) return null;
        const pref = nomeUsuario ? `${nomeUsuario}, ` : '';
        const n = cortesEmEstoque.length;
        return `${pref}vejo ${n} ${n === 1 ? 'lote' : 'lotes'} no estoque de cortes. Quer que eu verifique se há déficit?`;
    }, [cortesEmEstoque, nomeUsuario]);

    const frasesParaUsar = useMemo(() => {
        if (voltouParcial)   return frasesEmbaralhadas;
        if (fraseSondagem)   return [fraseSondagem];
        if (fraseMemoria)    return [fraseMemoria];
        if (fraseContextual) return [fraseContextual];
        return frasesEmbaralhadas;
    }, [voltouParcial, fraseSondagem, fraseMemoria, fraseContextual, frasesEmbaralhadas]);

    const { texto: textoAnimado, fase: faseTypewriter, completo } = useTypewriter(frasesParaUsar, 38, 3000, false);

    // Ticker de dados — tokens derivados dos produtos reais
    const tickerTokens = useMemo(() => {
        const tokens = [];
        if (produtos && produtos.length > 0) {
            produtos.slice(0, 12).forEach(p => {
                if (p.grade && p.grade.length > 0) {
                    p.grade.slice(0, 2).forEach(g => {
                        tokens.push(`${p.sku || (p.nome || '').slice(0, 6).toUpperCase()} · ${g.variacao || 'PAD'}`);
                    });
                } else {
                    tokens.push(p.sku || (p.nome || '').slice(0, 8).toUpperCase());
                }
            });
        }
        // Fallback genérico se não houver produtos suficientes
        if (tokens.length < 6) {
            tokens.push(
                'ANALISANDO REGISTROS', 'CRUZANDO TABELAS', 'VERIFICANDO ESTOQUE',
                'CALCULANDO DÉFICIT', 'BUSCANDO DEMANDAS', 'ATUALIZANDO ÍNDICE',
            );
        }
        return tokens;
    }, [produtos]);

    const horaUltimoScan = ultimoScan
        ? ultimoScan.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : null;

    return (
        <div className="op-cortes-agente">

            {/* ── IDLE CARD ── */}
            {agentState === 'idle' && (
                <div className={`op-agente-idle-card${classeCard}`}>
                    <div className="op-agente-avatar-wrapper">
                        <UIAgenteIA tamanho="lg" scanning={false} />
                    </div>
                    <div className={`op-agente-waveform${completo ? ' pausado' : ''}`}>
                        <span /><span /><span /><span /><span />
                    </div>
                    <div className="op-agente-idle-pensamento">
                        <span className={`op-agente-idle-texto${faseTypewriter === 'fading' ? ' fading' : ''}`}>
                            {textoAnimado}
                            {(faseTypewriter === 'typing' || completo) && (
                                <span className="op-agente-idle-cursor">▌</span>
                            )}
                        </span>
                    </div>
                    <UIBloqueio permissao="usar-agente-cortes">
                        <button className="op-agente-idle-btn" onClick={iniciarScan}>
                            <i className={`fas ${voltouParcial ? 'fa-redo' : 'fa-search'}`}></i>
                            {voltouParcial ? 'Verificar pendências' : 'Analisar agora'}
                        </button>
                    </UIBloqueio>
                </div>
            )}

            {/* ── TERMINAL DE SCAN ── */}
            {(agentState === 'scanning' || agentState === 'avaliando') && (
                <div className="op-agente-terminal">
                    {mensagensVisiveis.map((fase, i) => (
                        <OPAgenteFaseScan
                            key={i}
                            fase={fase}
                            isCurrent={agentState === 'scanning' && i === mensagensVisiveis.length - 1}
                            isCompleted={i < mensagensVisiveis.length - 1 || agentState === 'avaliando'}
                        />
                    ))}

                    {/* Ticker de dados — rola continuamente durante o scan */}
                    {agentState === 'scanning' && (
                        <div className="op-agente-ticker-wrapper">
                            <div className="op-agente-ticker">
                                {tickerTokens.join('  ·  ')}
                                {'  ·  ' + tickerTokens.join('  ·  ')}
                            </div>
                        </div>
                    )}

                    {/* Score de confiança — exibido no estado avaliando */}
                    {agentState === 'avaliando' && (
                        <div className="op-agente-avaliando">
                            <div className="op-agente-avaliando-titulo">
                                <i className="fas fa-check-circle"></i>
                                Scan completo. Avaliando confiabilidade...
                            </div>
                            <div className="op-agente-score-wrapper">
                                <div className="op-agente-score-label">
                                    <span>Confiança da análise</span>
                                    <span className="op-agente-score-pct">
                                        <ScoreCounter alvo={scoreAlvo} />%
                                    </span>
                                </div>
                                <div className="op-agente-score-barra-bg">
                                    <div
                                        className="op-agente-score-barra-fill"
                                        style={{ width: `${scoreAlvo}%` }}
                                    ></div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── RESULTADO: PLANO DE CORTE ── */}
            {agentState === 'done' && (
                <div className="op-cortes-agente-resultado">

                    {/* Header unificado — idêntico ao da aba OPs */}
                    <div className="op-agente-res-header">
                        <div className={`op-agente-res-badge${plano.length === 0 ? ' vazio' : ''}`}>
                            <i className={`fas ${plano.length === 0 ? 'fa-check-circle' : 'fa-clipboard-list'}`}></i>
                            {plano.length === 0
                                ? 'Estoque em dia'
                                : `${plano.length} ${plano.length === 1 ? 'item' : 'itens'} para cortar`
                            }
                        </div>
                        {horaUltimoScan && (
                            <div className="op-agente-res-ao-vivo">
                                <span className="op-cortes-agente-ao-vivo-dot"></span>
                                <span>{horaUltimoScan}</span>
                            </div>
                        )}
                        <button
                            className="op-agente-res-fechar"
                            onClick={resetar}
                            title="Fechar agente / novo scan"
                            aria-label="Fechar agente"
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    </div>

                    {plano.length === 0 && (
                        <div className="op-agente-vazio">
                            <div className="op-agente-vazio-icone">
                                <i className="fas fa-check-circle"></i>
                            </div>
                            <div className="op-agente-vazio-texto">
                                <strong>Estoque de cortes em dia!</strong>
                                <span>Todas as demandas pendentes têm corte disponível.</span>
                            </div>
                        </div>
                    )}

                    {plano.length > 0 && (
                        <>
                            <div className="op-cortes-agente-plano-header">
                                <span className="op-cortes-agente-hint">
                                    Clique em "Cortar" para registrar cada lote
                                </span>
                            </div>

                            <div className="op-cortes-agente-lista">
                                {plano.map((item, i) => {
                                    const cobertoParcial = item.pecas_em_estoque > 0;
                                    const variante = item.variante || 'Padrão';
                                    return (
                                        <div
                                            key={i}
                                            className={`op-cortes-agente-card ${cobertoParcial ? 'parcial' : ''}`}
                                            style={{ '--card-idx': i }}
                                        >
                                            <div className="card-borda-charme"></div>

                                            <div className="op-cortes-agente-card-corpo">
                                                <img
                                                    src={item.imagem || '/img/placeholder-image.png'}
                                                    alt={variante}
                                                    className="op-cortes-agente-card-img"
                                                />
                                                <div className="op-cortes-agente-card-info">
                                                    <span className="op-cortes-agente-card-variante">
                                                        {variante}
                                                    </span>
                                                    <div className="op-cortes-agente-card-deficit">
                                                        <span className="deficit-falta">
                                                            {item.deficit} pçs
                                                        </span>
                                                        {cobertoParcial && (
                                                            <span className="deficit-tem">
                                                                {item.pecas_em_estoque} em estoque
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <UIBloqueio permissao="usar-agente-cortes">
                                                <button
                                                    className="op-cortes-agente-card-btn"
                                                    onClick={() => onCortarAgora({
                                                        produto: item.produtoCompleto,
                                                        variante: item.variante || null,
                                                        quantidadeSugerida: item.deficit
                                                    })}
                                                    disabled={!item.produtoCompleto}
                                                    title={!item.produtoCompleto ? 'Produto não encontrado' : 'Registrar corte para este item'}
                                                >
                                                    <i className="fas fa-bolt"></i>
                                                    Cortar
                                                </button>
                                            </UIBloqueio>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
