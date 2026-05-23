// public/src/components/OPAgenteInterceptor.jsx
// Modal de bloqueio suave — intercepta o supervisor em gatilhos específicos.
// Escalada progressiva: quanto mais OPs paradas, menos opções de adiar.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import UIAgenteIA from './UIAgenteIA';
import OPModalLote from './OPModalLote';

// ── Keys de localStorage (compartilhadas com OPAgenteEncerrador) ──────────────
const SNOOZE_ATE_KEY    = 'agente_enc_snooze_ate';
const SNOOZES_HOJE_KEY  = 'agente_enc_snoozes_hoje';
const ULTIMO_DIA_KEY    = 'agente_enc_ultimo_acesso_dia';
const CRITICO_VISTO_KEY = 'agente_enc_critico_visto';
const ANTI_SPAM_KEY     = 'agente_enc_ultimo_interceptor';
const PENDENTE_KEY      = 'agente_enc_pendente_desde';
const MAX_SNOOZES_DIA   = 2;
const ANTI_SPAM_MS      = 30 * 60 * 1000;

function lerSnoozeAtivo() {
    try {
        const ate = parseInt(localStorage.getItem(SNOOZE_ATE_KEY) || '0');
        return ate > Date.now() ? ate : null;
    } catch { return null; }
}

function lerSnoozesHoje() {
    try {
        const raw = localStorage.getItem(SNOOZES_HOJE_KEY);
        if (!raw) return 0;
        const { data, count } = JSON.parse(raw);
        const hoje = new Date().toISOString().slice(0, 10);
        return data === hoje ? count : 0;
    } catch { return 0; }
}

function gravarSnooze30min() {
    try {
        localStorage.setItem(SNOOZE_ATE_KEY, String(Date.now() + 30 * 60 * 1000));
        const hoje = new Date().toISOString().slice(0, 10);
        const count = lerSnoozesHoje() + 1;
        localStorage.setItem(SNOOZES_HOJE_KEY, JSON.stringify({ data: hoje, count }));
    } catch { /* silencioso */ }
}

function podeInterceptar(forcar = false) {
    if (forcar) return true;
    try {
        const ultima = parseInt(localStorage.getItem(ANTI_SPAM_KEY) || '0');
        return Date.now() - ultima > ANTI_SPAM_MS;
    } catch { return true; }
}

function registrarInterceptacao() {
    try { localStorage.setItem(ANTI_SPAM_KEY, String(Date.now())); } catch { /* silencioso */ }
}

function horasParaTexto(horas) {
    if (horas < 1) return `há ${Math.max(1, Math.round(horas * 60))} min`;
    if (horas < 24) return `há ${Math.floor(horas)}h`;
    return `há ${Math.floor(horas / 24)}d`;
}

const FASES_SCAN = [
    { texto: 'Verificando status da fábrica...' },
    { texto: 'Analisando OPs em produção...' },
    { texto: 'Calculando saldo de etapas...' },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function OPAgenteInterceptor({ opsProntas = [], nomeUsuario = '', onRefresh, temPermissaoAgente = false }) {
    const [visivel, setVisivel]                     = useState(false);
    const [faseAtual, setFaseAtual]                 = useState(0);
    const [mostrarResultado, setMostrarResultado]   = useState(false);
    const [selectedNums, setSelectedNums]           = useState(() => new Set());
    const [modalLoteAberto, setModalLoteAberto]     = useState(false);
    const [snoozesHoje, setSnoozesHoje]             = useState(lerSnoozesHoje);

    const prevOpsRef = useRef(null);
    const timersRef  = useRef([]);

    // Seleciona todas por padrão quando opsProntas muda
    useEffect(() => {
        setSelectedNums(new Set(opsProntas.map(op => op.numero)));
    }, [opsProntas]);

    const toggleOp  = (numero) => setSelectedNums(prev => {
        const next = new Set(prev);
        next.has(numero) ? next.delete(numero) : next.add(numero);
        return next;
    });
    const selectAll = () => setSelectedNums(new Set(opsProntas.map(op => op.numero)));
    const clearAll  = () => setSelectedNums(new Set());

    // ── disparar precisa vir ANTES do useEffect que o usa ────────────────────
    const disparar = useCallback((forcar = false, registrarAntiSpam = true) => {
        if (!podeInterceptar(forcar)) return;
        if (registrarAntiSpam) registrarInterceptacao();
        setFaseAtual(0);
        setMostrarResultado(false);
        setVisivel(true);

        timersRef.current.forEach(t => clearTimeout(t));
        timersRef.current = [];

        FASES_SCAN.forEach((_, i) => {
            const t = setTimeout(() => setFaseAtual(i + 1), i * 500 + 500);
            timersRef.current.push(t);
        });
        const tFinal = setTimeout(() => {
            setFaseAtual(FASES_SCAN.length + 1);
            setMostrarResultado(true);
        }, FASES_SCAN.length * 500 + 800);
        timersRef.current.push(tFinal);
    }, []);

    // ── Lógica de gatilhos ────────────────────────────────────────────────────
    useEffect(() => {
        // Supervisor sem permissão nunca recebe o interceptor
        if (!temPermissaoAgente) {
            prevOpsRef.current = opsProntas;
            return;
        }

        if (opsProntas.length === 0) {
            prevOpsRef.current = opsProntas;
            return;
        }

        const prev = prevOpsRef.current;
        prevOpsRef.current = opsProntas;

        if (visivel) return;

        const hoje = new Date().toISOString().slice(0, 10);

        // Gatilho crítico: OP com >24h ainda não alertada (ignora snooze)
        const criticasJaVistas = JSON.parse(localStorage.getItem(CRITICO_VISTO_KEY) || '[]');
        const opCriticaNova = opsProntas.find(op =>
            op.horas_aguardando >= 24 && !criticasJaVistas.includes(op.numero)
        );
        if (opCriticaNova) {
            try {
                localStorage.setItem(CRITICO_VISTO_KEY,
                    JSON.stringify([...criticasJaVistas, opCriticaNova.numero]));
            } catch { /* silencioso */ }
            disparar(true);
            return;
        }

        if (lerSnoozeAtivo()) return;

        // Gatilho: pendência persistente — re-disparo na carga inicial da sessão
        // sem registrar no anti-spam, garantindo que F5 não escape
        if (prev === null && localStorage.getItem(PENDENTE_KEY)) {
            disparar(true, false);
            return;
        }

        // Gatilho 1: primeiro acesso do dia
        const ultimoDia = localStorage.getItem(ULTIMO_DIA_KEY);
        if (ultimoDia !== hoje) {
            try { localStorage.setItem(ULTIMO_DIA_KEY, hoje); } catch { /* silencioso */ }
            if (podeInterceptar()) { disparar(); return; }
        }

        // Gatilho 2: nova OP pronta detectada (delta positivo)
        if (prev !== null && opsProntas.length > prev.length) {
            if (podeInterceptar()) { disparar(); return; }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opsProntas, disparar, temPermissaoAgente]);

    useEffect(() => () => timersRef.current.forEach(t => clearTimeout(t)), []);

    // ── Ações ─────────────────────────────────────────────────────────────────
    const fechar = () => {
        setVisivel(false);
        setMostrarResultado(false);
    };

    const handleAdiar = () => {
        gravarSnooze30min();
        setSnoozesHoje(lerSnoozesHoje());
        fechar();
    };

    const opsParaEncerrar = opsProntas.filter(op => selectedNums.has(op.numero));

    const handleEncerrar = () => {
        if (opsParaEncerrar.length === 0) return;
        fechar();
        setModalLoteAberto(true);
    };

    const handleConcluirLote = useCallback(({ sucesso }) => {
        setModalLoteAberto(false);
        if (sucesso > 0 && onRefresh) onRefresh();
    }, [onRefresh]);

    // ── Estado visual ─────────────────────────────────────────────────────────
    const temCritico      = opsProntas.some(op => op.horas_aguardando >= 24);
    const temUrgente      = !temCritico && (opsProntas.length >= 3 || opsProntas.some(op => op.horas_aguardando >= 4));
    const classeEstado    = temCritico ? 'critico' : temUrgente ? 'urgente' : '';

    const todosSelecionados = opsProntas.length > 0 && selectedNums.size === opsProntas.length;
    const nenhumSelecionado = selectedNums.size === 0;

    const podeAdiar    = snoozesHoje < MAX_SNOOZES_DIA && !temCritico;
    const ultimoSnooze = snoozesHoje === MAX_SNOOZES_DIA - 1;

    const fasesVisiveis = FASES_SCAN.slice(0, Math.min(faseAtual, FASES_SCAN.length));
    const scanCompleto  = faseAtual > FASES_SCAN.length;

    return (
        <>
            {visivel && ReactDOM.createPortal(
                <div className="gs-agente-int-overlay">
                    <div className="gs-agente-int-modal">

                        {/* Cabeçalho */}
                        <div className="gs-agente-int-header">
                            <UIAgenteIA tamanho="md" scanning={!scanCompleto} />
                            <div className="gs-agente-int-header-texto">
                                <h3>
                                    {scanCompleto
                                        ? (temCritico ? 'Ação urgente necessária!' : 'OPs prontas para encerrar')
                                        : 'Verificando produção...'
                                    }
                                </h3>
                                <p>
                                    {scanCompleto
                                        ? (nomeUsuario
                                            ? `${nomeUsuario}, encontrei ${opsProntas.length} OP${opsProntas.length > 1 ? 's' : ''} aguardando encerramento.`
                                            : `Encontrei ${opsProntas.length} OP${opsProntas.length > 1 ? 's' : ''} aguardando encerramento.`)
                                        : 'Aguarde enquanto analiso o status da linha...'
                                    }
                                </p>
                            </div>
                        </div>

                        {/* Terminal de scan */}
                        {!scanCompleto && (
                            <div className="gs-agente-int-scan">
                                {fasesVisiveis.map((fase, i) => {
                                    const concluida = i < fasesVisiveis.length - 1;
                                    return (
                                        <div key={i} className="gs-agente-int-scan-linha">
                                            <span className={`gs-agente-int-scan-prompt${concluida ? ' ok' : ''}`}>
                                                {concluida ? '✓' : '›'}
                                            </span>
                                            <span>{fase.texto}</span>
                                            {!concluida && <span className="gs-agente-int-cursor">▌</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Controles de seleção */}
                        {mostrarResultado && (
                            <div className="gs-agente-enc-mini-sel-ctrl">
                                <button
                                    className={`gs-agente-enc-sel-btn${todosSelecionados ? ' ativo' : ''}`}
                                    onClick={selectAll}
                                >
                                    Todas
                                </button>
                                <button
                                    className={`gs-agente-enc-sel-btn${nenhumSelecionado ? ' ativo' : ''}`}
                                    onClick={clearAll}
                                >
                                    Nenhuma
                                </button>
                                <span className="gs-agente-enc-sel-count">
                                    {selectedNums.size}/{opsProntas.length} selecionada{selectedNums.size !== 1 ? 's' : ''}
                                </span>
                            </div>
                        )}

                        {/* Lista de OPs com checkboxes */}
                        {mostrarResultado && (
                            <div className="gs-agente-enc-mini-lista">
                                {opsProntas.map(op => {
                                    const classeH    = op.horas_aguardando >= 24 ? 'critico'
                                                     : op.horas_aguardando >= 4  ? 'urgente' : '';
                                    const selecionada = selectedNums.has(op.numero);
                                    return (
                                        <label
                                            key={op.numero}
                                            className={`gs-agente-enc-mini-op${selecionada ? ' selecionada' : ''}`}
                                        >
                                            <input
                                                type="checkbox"
                                                className="gs-agente-enc-mini-chk"
                                                checked={selecionada}
                                                onChange={() => toggleOp(op.numero)}
                                            />
                                            {op.produto_imagem ? (
                                                <img
                                                    src={op.produto_imagem}
                                                    alt={op.variante || op.produto_nome}
                                                    className="gs-agente-enc-mini-op-img"
                                                />
                                            ) : (
                                                <div className="gs-agente-enc-mini-op-img gs-agente-enc-mini-op-img--placeholder">
                                                    <i className="fas fa-tshirt"></i>
                                                </div>
                                            )}
                                            <div className="gs-agente-enc-mini-op-info">
                                                <div className="gs-agente-enc-mini-op-nome">
                                                    <span className="gs-agente-enc-mini-op-num">#{op.numero}</span>
                                                    {op.variante || op.produto_nome}
                                                </div>
                                                <div className={`gs-agente-enc-mini-op-horas ${classeH}`}>
                                                    {horasParaTexto(op.horas_aguardando)} aguardando
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        )}

                        {/* Ações */}
                        {mostrarResultado && (
                            <>
                                {temCritico && (
                                    <p className="gs-agente-int-snooze-info">
                                        OPs críticas não podem ser adiadas.
                                    </p>
                                )}
                                <div className="gs-agente-int-acoes">
                                    <button
                                        className={`gs-agente-int-btn-encerrar ${classeEstado}`}
                                        onClick={handleEncerrar}
                                        disabled={nenhumSelecionado}
                                    >
                                        <i className="fas fa-check-double"></i>
                                        Encerrar{selectedNums.size > 0 ? ` (${selectedNums.size})` : ''}
                                    </button>
                                    {podeAdiar && (
                                        <button className="gs-agente-int-btn-adiar" onClick={handleAdiar}>
                                            <i className="fas fa-clock"></i>
                                            {ultimoSnooze ? 'Adiar (última vez hoje)' : 'Adiar 30 min'}
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>,
                document.body
            )}

            {modalLoteAberto && ReactDOM.createPortal(
                <OPModalLote
                    isOpen={true}
                    ops={opsParaEncerrar.length > 0 ? opsParaEncerrar : opsProntas}
                    onClose={() => setModalLoteAberto(false)}
                    onConcluido={handleConcluirLote}
                />,
                document.body
            )}
        </>
    );
}
