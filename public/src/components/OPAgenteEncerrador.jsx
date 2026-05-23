// public/src/components/OPAgenteEncerrador.jsx
// FAB "Fantasminha" — persiste em todas as páginas admin.
// Mini-modal: checkboxes para selecionar quais OPs encerrar → abre OPModalLote diretamente.

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import UIAgenteIA from './UIAgenteIA';
import OPModalLote from './OPModalLote';
import { mostrarPopupSemPermissao } from '../utils/bloqueio.js';

// ── Helpers de snooze ─────────────────────────────────────────────────────────
const SNOOZE_ATE_KEY   = 'agente_enc_snooze_ate';
const SNOOZES_HOJE_KEY = 'agente_enc_snoozes_hoje';
const MAX_SNOOZES_DIA  = 2;

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
        localStorage.setItem(SNOOZES_HOJE_KEY, JSON.stringify({ data: hoje, count: lerSnoozesHoje() + 1 }));
    } catch { /* silencioso */ }
}

function cancelarSnooze() {
    try { localStorage.removeItem(SNOOZE_ATE_KEY); } catch { /* silencioso */ }
}

function minutosSnoozeRestantes() {
    const ate = parseInt(localStorage.getItem(SNOOZE_ATE_KEY) || '0');
    return Math.max(0, Math.ceil((ate - Date.now()) / 60000));
}

// ── Helpers visuais ───────────────────────────────────────────────────────────
function horasParaTexto(horas) {
    if (horas < 1) return `há ${Math.max(1, Math.round(horas * 60))} min`;
    if (horas < 24) return `há ${Math.floor(horas)}h`;
    return `há ${Math.floor(horas / 24)}d`;
}

function calcularEstado(ops, emSnooze) {
    if (emSnooze) return 'snooze';
    if (!ops || ops.length === 0) return 'ocioso';
    if (ops.some(op => op.horas_aguardando >= 24)) return 'critico';
    if (ops.length >= 3 || ops.some(op => op.horas_aguardando >= 4)) return 'urgente';
    return 'atencao';
}

// ─────────────────────────────────────────────────────────────────────────────

export default function OPAgenteEncerrador({ opsProntas = [], nomeUsuario = '', onRefresh, temPermissaoAgente = false }) {
    const [miniModalAberto, setMiniModalAberto] = useState(false);
    const [selectedNums, setSelectedNums]       = useState(() => new Set());
    const [modalLoteAberto, setModalLoteAberto] = useState(false);
    const [snoozesHoje, setSnoozesHoje]         = useState(lerSnoozesHoje);
    const [emSnooze, setEmSnooze]               = useState(() => lerSnoozeAtivo() !== null);
    const [minRestantes, setMinRestantes]       = useState(minutosSnoozeRestantes);

    const miniModalRef = useRef(null);

    // Verifica snooze a cada minuto
    useEffect(() => {
        const tick = () => {
            const ativo = lerSnoozeAtivo() !== null;
            setEmSnooze(ativo);
            if (ativo) setMinRestantes(minutosSnoozeRestantes());
        };
        const timer = setInterval(tick, 60_000);
        return () => clearInterval(timer);
    }, []);

    // Seleciona todas por padrão quando opsProntas muda
    useEffect(() => {
        setSelectedNums(new Set(opsProntas.map(op => op.numero)));
    }, [opsProntas]);

    // Fecha mini-modal ao clicar fora
    useEffect(() => {
        if (!miniModalAberto) return;
        const handleClickFora = (e) => {
            if (miniModalRef.current && !miniModalRef.current.contains(e.target)) {
                setMiniModalAberto(false);
            }
        };
        document.addEventListener('mousedown', handleClickFora);
        return () => document.removeEventListener('mousedown', handleClickFora);
    }, [miniModalAberto]);

    const estado = useMemo(() => calcularEstado(opsProntas, emSnooze), [opsProntas, emSnooze]);

    const handleFabClick = () => {
        if (!temPermissaoAgente) {
            mostrarPopupSemPermissao('Você não tem permissão para usar o Agente Encerrador. Fale com o administrador.');
            return;
        }
        if (estado === 'ocioso') return;
        setMiniModalAberto(prev => !prev);
    };

    const toggleOp = (numero) => {
        setSelectedNums(prev => {
            const next = new Set(prev);
            next.has(numero) ? next.delete(numero) : next.add(numero);
            return next;
        });
    };

    const selectAll  = () => setSelectedNums(new Set(opsProntas.map(op => op.numero)));
    const clearAll   = () => setSelectedNums(new Set());

    const opsParaEncerrar = opsProntas.filter(op => selectedNums.has(op.numero));

    const handleEncerrar = () => {
        if (opsParaEncerrar.length === 0) return;
        setMiniModalAberto(false);
        setModalLoteAberto(true);
    };

    const handleAdiar = () => {
        gravarSnooze30min();
        setSnoozesHoje(lerSnoozesHoje());
        setEmSnooze(true);
        setMinRestantes(30);
        setMiniModalAberto(false);
    };

    const handleCancelarSnooze = () => {
        cancelarSnooze();
        setEmSnooze(false);
        setMiniModalAberto(false);
    };

    const handleConcluirLote = useCallback(({ sucesso }) => {
        setModalLoteAberto(false);
        if (sucesso > 0 && onRefresh) onRefresh();
    }, [onRefresh]);

    const podeAdiar    = snoozesHoje < MAX_SNOOZES_DIA && estado !== 'critico' && estado !== 'snooze';
    const ultimoSnooze = snoozesHoje === MAX_SNOOZES_DIA - 1;

    const mensagemCabecalho = {
        atencao: `${opsProntas.length} OP${opsProntas.length > 1 ? 's prontas' : ' pronta'} para encerrar.`,
        urgente: `${opsProntas.length} OPs paradas. Isso pode travar o arremate.`,
        critico: `ATENÇÃO: ${opsProntas.length} OP${opsProntas.length > 1 ? 's aguardam' : ' aguarda'} há mais de 24h.`,
        snooze:  `Monitoramento pausado.`,
    }[estado] || '';

    const todosSelecionados = opsProntas.length > 0 && selectedNums.size === opsProntas.length;
    const nenhumSelecionado = selectedNums.size === 0;

    return (
        <>
            {/* ── FAB ── */}
            <button
                className={`gs-agente-enc-fab ${temPermissaoAgente ? estado : 'bloqueado'}${miniModalAberto ? ' aberto' : ''}`}
                title={!temPermissaoAgente ? 'Sem permissão para usar o Agente Encerrador' : (estado === 'ocioso' ? 'Agente Encerrador' : mensagemCabecalho)}
                aria-label="Agente Encerrador de OPs"
                onClick={handleFabClick}
            >
                <div className="gs-agente-enc-fab-anel"></div>
                <UIAgenteIA tamanho="sm" scanning={false} />
                {temPermissaoAgente && estado !== 'ocioso' && estado !== 'snooze' && opsProntas.length > 0 && (
                    <span className="gs-agente-enc-badge">{opsProntas.length}</span>
                )}
                {temPermissaoAgente && estado === 'snooze' && (
                    <span className="gs-agente-enc-badge gs-agente-enc-badge--snooze">
                        <i className="fas fa-clock"></i>
                    </span>
                )}
                {!temPermissaoAgente && (
                    <span className="gs-agente-enc-badge gs-agente-enc-badge--bloqueado">
                        <i className="fas fa-lock"></i>
                    </span>
                )}
            </button>

            {/* ── Mini-modal ── */}
            {miniModalAberto && (
                <div className="gs-agente-enc-mini" ref={miniModalRef}>

                    {/* Estado: snooze ativo */}
                    {estado === 'snooze' ? (
                        <>
                            <div className="gs-agente-enc-mini-header">
                                <UIAgenteIA tamanho="sm" scanning={false} />
                                <div className="gs-agente-enc-mini-header-texto">
                                    Monitoramento pausado.
                                    <small>
                                        {opsProntas.length} OP{opsProntas.length !== 1 ? 's' : ''} na fila
                                        {minRestantes > 0 ? ` · retoma em ${minRestantes} min` : ''}
                                    </small>
                                </div>
                            </div>
                            <div className="gs-agente-enc-mini-acoes">
                                <button className="gs-agente-enc-btn-encerrar" onClick={() => { handleCancelarSnooze(); setModalLoteAberto(true); }}>
                                    <i className="fas fa-play"></i>
                                    Retomar e encerrar
                                </button>
                                <button className="gs-agente-enc-btn-adiar" onClick={handleCancelarSnooze}>
                                    Cancelar pausa
                                </button>
                                <button className="gs-agente-enc-btn-adiar" onClick={() => setMiniModalAberto(false)}>
                                    Continuar pausado
                                </button>
                            </div>
                        </>
                    ) : (
                        /* Estado normal: lista com checkboxes */
                        <>
                            <div className="gs-agente-enc-mini-header">
                                <UIAgenteIA tamanho="sm" scanning={false} />
                                <div className="gs-agente-enc-mini-header-texto">
                                    {mensagemCabecalho}
                                    {nomeUsuario && <small>Olá, {nomeUsuario}!</small>}
                                </div>
                            </div>

                            {/* Controles de seleção */}
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

                            <div className="gs-agente-enc-mini-acoes">
                                <button
                                    className={`gs-agente-enc-btn-encerrar ${estado}`}
                                    onClick={handleEncerrar}
                                    disabled={nenhumSelecionado}
                                >
                                    <i className="fas fa-check-double"></i>
                                    Encerrar{selectedNums.size > 0 ? ` (${selectedNums.size})` : ''}
                                </button>
                                {podeAdiar && (
                                    <button className="gs-agente-enc-btn-adiar" onClick={handleAdiar}>
                                        <i className="fas fa-clock"></i>
                                        {ultimoSnooze ? 'Adiar (última vez hoje)' : 'Adiar 30 min'}
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* ── OPModalLote — abre diretamente com as OPs selecionadas ── */}
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
