// public/src/components/OPCentralEncerramento.jsx
// Agente de Encerramento de OPs — idle com typewriter + scanning + resultado

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { obterProdutos as obterProdutosDoStorage } from '/js/utils/storage.js';
import UIAgenteIA from './UIAgenteIA';
import useTypewriter from '../hooks/useTypewriter';
import useContador from '../hooks/useContador.js';
import OPAgenteFaseScan from './OPAgenteFaseScan.jsx';
import UIBloqueio from './UIBloqueio.jsx';

// ── Frases de repouso ─────────────────────────────────────────────────────────

const FRASES_MONITORANDO = [
    'Estou de olho na linha de produção. Tudo parece normal por aqui.',
    'Monitorando as OPs em tempo real. Posso analisar quando quiser.',
    'Nada chamou minha atenção ainda. Quer que eu faça uma verificação?',
    'Sistemas ativos. A qualquer momento posso rodar uma análise completa.',
    'Linha de produção sob observação. Aguardo seu comando.',
    'Tudo dentro do esperado até agora. Devo verificar mesmo assim?',
];

const FRASES_ALERTA = [
    '{nome}, detectei movimentação no setor. Preciso analisar para confirmar.',
    'Acho que temos OPs aguardando encerramento. Posso verificar agora, {nome}?',
    '{nome}, algo chama minha atenção na produção. Recomendo uma análise.',
    'Meus sensores captaram atividade de OPs. Posso confirmar se autorizar.',
    'Há indícios de OPs concluídas. Posso escanear o sistema?',
    '{nome}, preciso verificar... — parece que há pendências no setor.',
];

const FRASES_PARCIAL = [
    '{nome}, reparei que ainda ficaram OPs para finalizar. Quer resolver agora?',
    'Você não encerrou todas as OPs, {nome}... Vamos terminar de uma vez?',
    'Ainda há pendências na linha. Posso verificar o que ficou?',
    '{nome}, percebo que algumas OPs continuam abertas. Revejo agora?',
    'Missão incompleta! Ainda temos OPs aguardando encerramento.',
    'Deixou algumas para depois? Posso verificar o que ficou em aberto.',
];

const FRASES_SONDAGEM_ENCONTROU = [
    '{nome}, acabei de verificar por conta própria... há {qtd} {op} pronta{s} esperando.',
    'Enquanto você estava aqui, dei uma olhada rápida. {qtd} {op} pronta{s} para encerrar.',
    '{nome}, atenção — encontrei {qtd} {op} elegíve{is} sem você precisar pedir.',
    'Fiz uma verificação silenciosa agora. {qtd} {op} pronta{s}. Quer o relatório completo?',
];

// ── Helpers de memória de sessão ──────────────────────────────────────────────

function lerMemoria(chave) {
    try {
        const raw = sessionStorage.getItem(chave);
        if (!raw) return null;
        const mem = JSON.parse(raw);
        if (Date.now() - mem.timestamp > 2 * 3600 * 1000) return null; // expira em 2h
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

function construirFraseMemoria(mem, nomeUsuario) {
    const nome = nomeUsuario ? `${nomeUsuario}, ` : '';
    const ha = calcularTempoRelativo(mem.timestamp);

    if (mem.encerrados > 0 && mem.encontrados > mem.encerrados) {
        return `${nome}${ha} você encerrou ${mem.encerrados} de ${mem.encontrados} OPs. Quer verificar o que ficou?`;
    }
    if (mem.encerrados > 0 && mem.encontrados === mem.encerrados) {
        return `${nome}${ha} você encerrou ${mem.encerrados} OP${mem.encerrados > 1 ? 's' : ''}. Posso verificar se surgiram novas desde então?`;
    }
    if (mem.encontrados === 0) {
        return `${ha} não havia OPs prontas. Quer que eu verifique novamente?`;
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

// ── Helpers locais ────────────────────────────────────────────────────────────

function isParcial(op) {
    if (!op.etapas || op.etapas.length === 0) return false;
    const ultima = op.etapas[op.etapas.length - 1];
    return (ultima?.quantidade_feita || 0) < op.quantidade;
}

function qtdProduzida(op) {
    if (!op.etapas || op.etapas.length === 0) return op.quantidade;
    return op.etapas[op.etapas.length - 1]?.quantidade_feita || 0;
}

const MENSAGENS_SCAN = [
    { texto: 'Conectando ao banco de produção...' },
    { texto: 'Lendo ordens em andamento...' },
    { texto: 'Verificando etapas concluídas...', contador: { alvo: 18, sufixo: 'verificadas' } },
    { texto: 'Calculando saldos de produção...' },
];

// Tokens do ticker de dados — rolam horizontalmente durante o scan
const TICKER_TOKENS_OPS = [
    'VERIFICANDO OPs ABERTAS', 'CRUZANDO ETAPAS', 'BUSCANDO LANÇAMENTOS',
    'CALCULANDO PROGRESSO', 'ANALISANDO PRODUÇÃO', 'VERIFICANDO CONCLUSÕES',
    'ETAPAS COMPLETAS?', 'BUSCANDO STATUS', 'CRUZANDO REGISTROS',
];

// ── Calcula score de confiança da análise (78–97%) ────────────────────────────
function calcularConfianca(elegiveis, totalOps) {
    if (!totalOps) return 92;
    const cobertura = Math.min(elegiveis / totalOps, 1);
    return Math.round(78 + cobertura * 19);
}

// Sub-componente inline: contador animado para o score
function ScoreCounter({ alvo }) {
    const valor = useContador(alvo, 1400, true);
    return <>{valor}</>;
}

const DELAY_SONDAGEM_MS   = 12_000;   // 12s antes da 1ª sondagem silenciosa
const MIN_INTERVALO_MS    = 300_000;  // 5min entre sondagens

// ─────────────────────────────────────────────────────────────────────────────

export default function OPCentralEncerramento({ opsPendentesGlobal = 0, onAbrirLote, resetKey, nomeUsuario }) {
    const [agentState, setAgentState] = useState('idle'); // 'idle' | 'scanning' | 'avaliando' | 'done'
    const [mensagensVisiveis, setMensagensVisiveis] = useState([]); // array de objetos { texto, contador? }
    const [scoreAlvo, setScoreAlvo] = useState(0);
    const [opsEscaneadas, setOpsEscaneadas] = useState([]);
    const [opsSelecionadas, setOpsSelecionadas] = useState(new Set());
    const [ultimoScan, setUltimoScan] = useState(null);
    const [voltouParcial, setVoltouParcial] = useState(false);
    const [sondagemSilenciosa, setSondagemSilenciosa] = useState(null);
    const [memoriaOps, setMemoriaOps] = useState(() => lerMemoria('agente_ops_memoria'));

    const pendentesAoEncerrarRef = useRef(0);
    const ultimaSondagemRef      = useRef(null);
    const avaliandoTimerRef      = useRef(null);

    // Reseta o agente quando um lote é concluído
    useEffect(() => {
        if (resetKey === 0) return;
        clearTimeout(avaliandoTimerRef.current);
        const foiParcial = pendentesAoEncerrarRef.current > 0;
        pendentesAoEncerrarRef.current = 0;
        setVoltouParcial(foiParcial);
        setMemoriaOps(lerMemoria('agente_ops_memoria'));
        setSondagemSilenciosa(null);
        setAgentState('idle');
        setMensagensVisiveis([]);
        setOpsEscaneadas([]);
        setOpsSelecionadas(new Set());
    }, [resetKey]);

    // ── Agente de Encerramento ────────────────────────────────────────────────
    const iniciarScan = useCallback(async () => {
        setSondagemSilenciosa(null);
        setAgentState('scanning');
        setMensagensVisiveis([]);
        setOpsEscaneadas([]);
        setOpsSelecionadas(new Set());

        try {
            const token = localStorage.getItem('token');

            const fetchPromise = Promise.all([
                fetch('/api/ordens-de-producao?page=1&limit=999', {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => r.json()),
                obterProdutosDoStorage()
            ]);

            for (let i = 0; i < MENSAGENS_SCAN.length; i++) {
                if (i > 0) await new Promise(r => setTimeout(r, 620));
                setMensagensVisiveis(prev => [...prev, MENSAGENS_SCAN[i]]);
            }

            const [dataOps, todosProdutos] = await fetchPromise;
            if (dataOps.error) throw new Error(dataOps.error);

            const todasEnriquecidas = dataOps.rows.map(op => {
                const produtoCompleto = todosProdutos.find(p => p.id === op.produto_id);
                let imagem = produtoCompleto?.imagem || null;
                if (produtoCompleto && op.variante && produtoCompleto.grade) {
                    const g = produtoCompleto.grade.find(g => g.variacao === op.variante);
                    if (g?.imagem) imagem = g.imagem;
                }
                return { ...op, imagem_produto: imagem };
            });

            const elegiveis = todasEnriquecidas.filter(op => {
                if (op.status === 'finalizado' || op.status === 'cancelada') return false;
                if (!op.etapas || !Array.isArray(op.etapas) || op.etapas.length === 0) return false;
                return op.etapas.every(e => e && e.lancado === true);
            });

            await new Promise(r => setTimeout(r, 350));
            const count = elegiveis.length;
            const totalOpsAtivas = dataOps.rows?.filter(op =>
                op.status !== 'finalizado' && op.status !== 'cancelada'
            ).length || 0;
            const finalMsg = count > 0
                ? `${count} OP${count > 1 ? 's' : ''} pronta${count > 1 ? 's' : ''} para encerramento detectada${count > 1 ? 's' : ''}.`
                : 'Nenhuma OP pronta para encerrar no momento.';
            setMensagensVisiveis(prev => [...prev, { texto: finalMsg }]);

            await new Promise(r => setTimeout(r, 500));

            // Salva na memória de sessão: quantas foram encontradas
            gravarMemoria('agente_ops_memoria', { encontrados: elegiveis.length });

            setOpsEscaneadas(elegiveis);
            setOpsSelecionadas(new Set(elegiveis.map(op => op.edit_id || op.id)));
            setUltimoScan(new Date());

            // Transita por 'avaliando' antes de 'done' (score de confiança)
            const score = calcularConfianca(count, totalOpsAtivas);
            setScoreAlvo(score);
            setAgentState('avaliando');
            clearTimeout(avaliandoTimerRef.current);
            avaliandoTimerRef.current = setTimeout(() => setAgentState('done'), 1800);

        } catch (err) {
            setMensagensVisiveis(prev => [...prev, `Erro: ${err.message}`]);
            setTimeout(() => setAgentState('idle'), 2500);
        }
    }, []);

    // ── Sondagem silenciosa — age sozinho após 12s de idle ───────────────────
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
                const data = await fetch('/api/ordens-de-producao?page=1&limit=999', {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => r.json());

                const quantidade = (data.rows || []).filter(op => {
                    if (op.status === 'finalizado' || op.status === 'cancelada') return false;
                    return op.etapas?.every(e => e && e.lancado === true);
                }).length;

                setSondagemSilenciosa({ timestamp: Date.now(), encontrou: quantidade > 0, quantidade });
            } catch { /* silencioso — sondagem não pode quebrar a UI */ }
        }, tempoEspera);

        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agentState]);

    const toggleSelecao = (op) => {
        const id = op.edit_id || op.id;
        setOpsSelecionadas(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selecionarTodas = () => {
        setOpsSelecionadas(new Set(opsEscaneadas.map(op => op.edit_id || op.id)));
    };

    const limparSelecao = () => {
        setOpsSelecionadas(new Set());
    };

    const handleEncerrar = () => {
        const lista = opsEscaneadas.filter(op =>
            opsSelecionadas.has(op.edit_id || op.id)
        );
        if (lista.length > 0) {
            pendentesAoEncerrarRef.current = opsEscaneadas.length - lista.length;
            // Atualiza memória com quantas foram efetivamente encerradas
            const memAtual = lerMemoria('agente_ops_memoria') || {};
            gravarMemoria('agente_ops_memoria', { ...memAtual, encerrados: lista.length });
            onAbrirLote(lista);
        }
    };

    const resetar = () => {
        clearTimeout(avaliandoTimerRef.current);
        pendentesAoEncerrarRef.current = 0;
        setVoltouParcial(false);
        setMemoriaOps(lerMemoria('agente_ops_memoria'));
        setSondagemSilenciosa(null);
        setAgentState('idle');
        setMensagensVisiveis([]);
        setOpsEscaneadas([]);
        setOpsSelecionadas(new Set());
    };

    // Rescan ao fechar o Painel de Demandas
    useEffect(() => {
        const handlePainelFechado = () => {
            if (agentState === 'done') iniciarScan();
        };
        window.addEventListener('painel-demandas-fechado', handlePainelFechado);
        return () => window.removeEventListener('painel-demandas-fechado', handlePainelFechado);
    }, [agentState, iniciarScan]);

    // ── Frases e prioridade ───────────────────────────────────────────────────

    // opsPendentesGlobal vem do polling do app (busca todas as OPs, não só a página atual)
    const idleAlerta = opsPendentesGlobal > 0;
    const classeCard = voltouParcial ? ' parcial' : idleAlerta ? ' alerta' : '';

    // Base: array embaralhado com ponto de entrada aleatório
    const frasesEmbaralhadas = useMemo(() => {
        const base = voltouParcial ? FRASES_PARCIAL : idleAlerta ? FRASES_ALERTA : FRASES_MONITORANDO;
        const comNome = base.map(f => substituirPlaceholders(f, nomeUsuario));
        const inicio = Math.floor(Math.random() * comNome.length);
        return [...comNome.slice(inicio), ...comNome.slice(0, inicio)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [voltouParcial, idleAlerta, nomeUsuario]);

    // Override 1: sondagem silenciosa encontrou algo
    const { encontrou: sondagemEncontrou = false, quantidade: sondagemQtd = 0 } = sondagemSilenciosa || {};
    const fraseSondagem = useMemo(() => {
        if (!sondagemEncontrou || !sondagemQtd) return null;
        const b = FRASES_SONDAGEM_ENCONTROU[Math.floor(Math.random() * FRASES_SONDAGEM_ENCONTROU.length)];
        return substituirPlaceholders(b, nomeUsuario, {
            qtd: sondagemQtd,
            op: sondagemQtd === 1 ? 'OP' : 'OPs',
            s: sondagemQtd === 1 ? '' : 's',
            is: sondagemQtd === 1 ? 'l' : 'is',
        });
    }, [sondagemEncontrou, sondagemQtd, nomeUsuario]);

    // Override 2: memória de sessão (lembranças de ciclos anteriores)
    const fraseMemoria = useMemo(() =>
        memoriaOps ? construirFraseMemoria(memoriaOps, nomeUsuario) : null,
        [memoriaOps, nomeUsuario]
    );

    // Override 3: contexto passivo — usa contagem global (todas as OPs do sistema)
    const fraseContextual = useMemo(() => {
        if (!opsPendentesGlobal) return null;
        const pref = nomeUsuario ? `${nomeUsuario}, ` : '';
        const verb = opsPendentesGlobal === 1 ? 'parece estar' : 'parecem estar';
        return `${pref}há ${opsPendentesGlobal} OP${opsPendentesGlobal > 1 ? 's' : ''} no sistema que ${verb} pronta${opsPendentesGlobal > 1 ? 's' : ''} para encerramento.`;
    }, [opsPendentesGlobal, nomeUsuario]);

    // Prioridade final das frases
    const frasesParaUsar = useMemo(() => {
        if (voltouParcial)   return frasesEmbaralhadas; // FRASES_PARCIAL embaralhadas
        if (fraseSondagem)   return [fraseSondagem];
        if (fraseMemoria)    return [fraseMemoria];
        if (fraseContextual) return [fraseContextual];
        return frasesEmbaralhadas;
    }, [voltouParcial, fraseSondagem, fraseMemoria, fraseContextual, frasesEmbaralhadas]);

    // Typewriter single-shot (loop=false): digita uma frase, para com cursor piscando
    const { texto: textoAnimado, fase: faseTypewriter, completo } = useTypewriter(frasesParaUsar, 38, 3000, false);

    return (
        <div className="op-ops-agente">

            {/* ── IDLE CARD — anel + scanline + waveform + typewriter + botão ── */}
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
                    <UIBloqueio permissao="usar-agente-central-ops">
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
                                {TICKER_TOKENS_OPS.join('  ·  ')}
                                {'  ·  ' + TICKER_TOKENS_OPS.join('  ·  ')}
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

            {/* ── RESULTADO DO AGENTE ── */}
            {agentState === 'done' && (
                <div className="op-agente-resultado">

                    {/* Header unificado: badge de contagem + botão X */}
                    <div className="op-agente-res-header">
                        <div className={`op-agente-res-badge${opsEscaneadas.length === 0 ? ' vazio' : ''}`}>
                            <i className={`fas ${opsEscaneadas.length === 0 ? 'fa-check-circle' : 'fa-check-double'}`}></i>
                            {opsEscaneadas.length === 0
                                ? 'Nenhuma OP detectada'
                                : `${opsEscaneadas.length} OP${opsEscaneadas.length > 1 ? 's' : ''} detectada${opsEscaneadas.length > 1 ? 's' : ''}`
                            }
                        </div>
                        <button
                            className="op-agente-res-fechar"
                            onClick={resetar}
                            title="Fechar agente / novo scan"
                            aria-label="Fechar agente"
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    </div>

                    {opsEscaneadas.length === 0 ? (
                        <div className="op-agente-vazio">
                            <div className="op-agente-vazio-icone">
                                <i className="fas fa-check-circle"></i>
                            </div>
                            <div className="op-agente-vazio-texto">
                                <strong>Tudo ainda em produção!</strong>
                                <span>Nenhuma OP com todas as etapas concluídas no momento.</span>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Barra de seleção moderna */}
                            <div className="op-agente-sel-barra">
                                <button
                                    className={`op-agente-sel-pill${opsSelecionadas.size === opsEscaneadas.length ? ' ativo' : opsSelecionadas.size > 0 ? ' ind' : ''}`}
                                    onClick={opsSelecionadas.size === opsEscaneadas.length ? limparSelecao : selecionarTodas}
                                    aria-label="Selecionar todas"
                                >
                                    <span className="op-agente-sel-cb">
                                        {opsSelecionadas.size === opsEscaneadas.length && <i className="fas fa-check"></i>}
                                        {opsSelecionadas.size > 0 && opsSelecionadas.size < opsEscaneadas.length && <i className="fas fa-minus"></i>}
                                    </span>
                                    Todas
                                </button>
                                <button
                                    className={`op-agente-sel-pill${opsSelecionadas.size === 0 ? ' ativo' : ''}`}
                                    onClick={limparSelecao}
                                    aria-label="Limpar seleção"
                                >
                                    <span className="op-agente-sel-cb">
                                        {opsSelecionadas.size === 0 && <i className="fas fa-check"></i>}
                                    </span>
                                    Nenhuma
                                </button>
                                <span className="op-agente-sel-barra-count">
                                    {opsSelecionadas.size} de {opsEscaneadas.length}
                                </span>
                            </div>

                            <div className="op-agente-lista">
                                {opsEscaneadas.map(op => {
                                    const id = op.edit_id || op.id;
                                    const sel = opsSelecionadas.has(id);
                                    const parcial = isParcial(op);
                                    const produzida = qtdProduzida(op);
                                    const variante = op.variante && op.variante !== '-' ? op.variante : 'Padrão';
                                    return (
                                        <div
                                            key={id}
                                            className={`op-agente-item ${sel ? 'selecionado' : ''} ${parcial ? 'parcial' : ''}`}
                                            onClick={() => toggleSelecao(op)}
                                        >
                                            <div className={`op-agente-item-check ${sel ? 'ativo' : ''} ${parcial ? 'parcial' : ''}`}>
                                                {sel && <i className="fas fa-check"></i>}
                                            </div>
                                            <img
                                                src={op.imagem_produto || '/img/placeholder-image.png'}
                                                alt={variante}
                                                className="op-agente-item-img"
                                            />
                                            <div className="op-agente-item-info">
                                                <div className="agente-item-linha-topo">
                                                    <span className="agente-item-num">OP #{op.numero}</span>
                                                    {parcial && (
                                                        <span className="agente-item-badge-parcial">
                                                            <i className="fas fa-exclamation-triangle"></i> PARCIAL
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="agente-item-variante">{variante}</span>
                                            </div>
                                            {parcial ? (
                                                <div className="agente-item-qty-parcial">
                                                    <span className="agente-qty-produzida">{produzida}</span>
                                                    <span className="agente-qty-sep">/</span>
                                                    <span className="agente-qty-meta">{op.quantidade} pçs</span>
                                                </div>
                                            ) : (
                                                <span className="agente-item-qty">{op.quantidade} pçs</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {opsEscaneadas.some(isParcial) && (
                                <div className="op-agente-aviso-parcial">
                                    <i className="fas fa-exclamation-triangle"></i>
                                    <p>
                                        <strong>{opsEscaneadas.filter(isParcial).length} OP{opsEscaneadas.filter(isParcial).length > 1 ? 's' : ''} parcial</strong> — produção abaixo da meta.
                                        O saldo restante será registrado como perda ao confirmar o encerramento.
                                    </p>
                                </div>
                            )}

                            <div className="op-agente-acoes">
                                <span className="op-agente-sel-info">
                                    {opsSelecionadas.size} de {opsEscaneadas.length} selecionada{opsSelecionadas.size !== 1 ? 's' : ''}
                                </span>
                                <UIBloqueio permissao="usar-agente-central-ops">
                                    <button
                                        className="op-agente-btn-encerrar"
                                        onClick={handleEncerrar}
                                        disabled={opsSelecionadas.size === 0}
                                    >
                                        <i className="fas fa-check-double"></i>
                                        Encerrar Selecionadas ({opsSelecionadas.size})
                                    </button>
                                </UIBloqueio>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
