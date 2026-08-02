// public/src/components/ArremateAtribuicaoModal.jsx

import React, { useState, useEffect, useRef } from 'react';
import { Tooltip } from 'react-tooltip';
import { BotaoIA } from './UIAgenteIA';

import ArremateTelaSelecaoProduto from './ArremateTelaSelecaoProduto.jsx';
import ArremateTelaConfirmacaoQtd from './ArremateTelaConfirmacaoQtd.jsx';

/**
 * Modal unificado de atribuição de tarefa.
 * - 1 selecionado  → FAB "Atribuir Tarefa" → tela de confirmação de quantidade
 * - 2+ selecionados → FAB "Atribuir Tarefas" → mini-modal de confirmação de lote
 *
 * Item 5 (v2.0): BotaoIA "Auto-Lote" aparece quando tiktik.status_atual === 'LIVRE'.
 * Algoritmo greedy usa TPAs configurados para pré-selecionar o melhor conjunto de itens.
 */

// Converte "HH:MM" para Date de hoje no fuso de SP
function horaParaDate(horaStr) {
    if (!horaStr) return null;
    const [h, m] = horaStr.split(':').map(Number);
    const d = new Date();
    // Ajusta para o fuso de São Paulo (UTC-3) usando Date local
    d.setHours(h, m, 0, 0);
    return d;
}

// Retorna o horário de saída final do turno do tiktik
function getSaidaFinalTurno(tiktik) {
    const saida = tiktik.horario_saida_3 || tiktik.horario_saida_2 || tiktik.horario_saida_1;
    return horaParaDate(saida);
}

// Algoritmo greedy: pré-seleciona itens que cabem no turno restante
function calcularAutoLote(itensFila, tempos, tiktik) {
    const agora = new Date();
    const fimTurno = getSaidaFinalTurno(tiktik);

    // Se não há horário de saída, usa janela padrão de 4h
    const tempoRestante = fimTurno
        ? Math.max(0, (fimTurno.getTime() - agora.getTime()) / 1000)
        : 4 * 3600;

    if (tempoRestante <= 0) return [];

    // Apenas itens com TPA configurado
    const itensComTPA = itensFila.filter(item => {
        const tpa = parseFloat(tempos[item.produto_id]);
        return tpa > 0;
    });

    if (itensComTPA.length === 0) return [];

    // Ordena por data de OP mais antiga (prioridade de urgência)
    const ordenados = [...itensComTPA].sort(
        (a, b) => new Date(a.data_op_mais_antiga) - new Date(b.data_op_mais_antiga)
    );

    // Greedy: acumula enquanto o tempo do turno comporta
    let tempoAcumulado = 0;
    const selecionados = [];

    for (const item of ordenados) {
        const tpa = parseFloat(tempos[item.produto_id]);
        const tempoNecessario = tpa * item.saldo_para_arrematar;
        if (tempoAcumulado + tempoNecessario <= tempoRestante) {
            selecionados.push(item);
            tempoAcumulado += tempoNecessario;
        }
    }

    return selecionados;
}

export default function ArremateAtribuicaoModal({ tiktik, isOpen, onClose, itensPréselecionados }) {
    const [tela, setTela] = useState('selecao');
    const [itemSelecionado, setItemSelecionado] = useState(null);

    // Item 5: estado do agente IA
    const [estadoIA, setEstadoIA] = useState('idle');
    const [temposIA, setTemposIA] = useState({});         // produto_id → TPA (seg)
    const [itensFila, setItensFila] = useState([]);       // recebido do filho via onItensCarregados
    const [itensPréselecionadosIA, setItensPréselecionadosIA] = useState([]); // enviado de volta ao filho
    const temposCarregadosRef = useRef(false);

    // Reseta o modal ao abrir
    useEffect(() => {
        if (isOpen) {
            setTela('selecao');
            setItemSelecionado(null);
            setEstadoIA('idle');
            setItensPréselecionadosIA([]);
            temposCarregadosRef.current = false;
        }
    }, [isOpen]);

    // Busca os TPAs quando o modal abre (necessário para o algoritmo IA)
    useEffect(() => {
        if (!isOpen || temposCarregadosRef.current) return;
        temposCarregadosRef.current = true;

        const token = localStorage.getItem('token');
        fetch('/api/arremates/tempos-padrao', {
            headers: { 'Authorization': `Bearer ${token}` },
        })
            .then(r => r.json())
            .then(data => setTemposIA(data || {}))
            .catch(() => {}); // silencioso — a IA simplesmente não aparece se falhar
    }, [isOpen]);

    // Fluxo individual: 1 item selecionado no FAB → tela de confirmação de quantidade
    const handleItemSelect = (item) => {
        setItemSelecionado(item);
        setTela('confirmacao');
    };

    const handleVoltar = () => {
        setItemSelecionado(null);
        setTela('selecao');
    };

    // Qualquer conclusão (individual ou lote) fecha o modal e atualiza o painel
    const handleConfirmacaoFinal = () => {
        onClose();
        window.dispatchEvent(new Event('forcarAtualizacaoPainelTiktik'));
    };

    // Auto-Lote IA: roda o greedy e pré-seleciona cards
    const handleAutoLote = () => {
        if (estadoIA === 'scanning') return;

        const temHaTPAConfigurado = itensFila.some(item => parseFloat(temposIA[item.produto_id]) > 0);
        if (!temHaTPAConfigurado) {
            setEstadoIA('done');
            return;
        }

        setEstadoIA('scanning');

        // Delay visual de 700ms para dar feedback ao usuário
        setTimeout(() => {
            const selecionados = calcularAutoLote(itensFila, temposIA, tiktik || {});
            setItensPréselecionadosIA(selecionados);
            setEstadoIA('done');
        }, 700);
    };

    // Item 5: modo hora extra
    const modoHoraExtra = !!tiktik?._modo_hora_extra;

    // Verifica se a IA deve aparecer (só quando LIVRE e não em hora extra)
    const mostrarBotaoIA = tiktik?.status_atual === 'LIVRE' && !modoHoraExtra;
    const semTPA = itensFila.length > 0 && !itensFila.some(item => parseFloat(temposIA[item.produto_id]) > 0);

    const textoDoneIA = semTPA
        ? 'Configure os TPAs primeiro'
        : itensPréselecionadosIA.length > 0
            ? `${itensPréselecionadosIA.length} sugerido(s)`
            : 'Nada coube no turno';

    if (!isOpen) return null;

    return (
        <div className="popup-container" style={{ display: 'flex' }}>
            <div className="popup-overlay" onClick={onClose}></div>
            <div className={`oa-modal-atribuir-v2 ${tela === 'selecao' ? 'modo-lista' : 'modo-confirmacao'}`}>

                {/* Header */}
                <div className="arremate-modal-header">
                    <div className="arremate-modal-header-esquerda">
                        {tela === 'selecao' && mostrarBotaoIA && (
                            <BotaoIA
                                estado={estadoIA}
                                textoIdle="Auto-Lote"
                                textoScanning="Calculando..."
                                textoDone={textoDoneIA}
                                onClick={handleAutoLote}
                                disabled={semTPA && estadoIA === 'idle'}
                                title={semTPA ? 'Configure os Tempos Padrão de Arremate primeiro' : 'Sugerir lote ideal para o turno restante'}
                            />
                        )}
                        {tela === 'confirmacao' && (
                            <button className="btn-voltar-header" onClick={handleVoltar}>
                                <i className="fas fa-arrow-left"></i>
                                <span>Voltar</span>
                            </button>
                        )}
                    </div>
                    <div className="arremate-modal-header-centro">
                        <h3 className="arremate-modal-titulo">
                            {tela === 'selecao' ? 'Atribuir Tarefa' : 'Confirmar Quantidade'}
                            {tiktik?.nome && (
                                <span className="nome-destaque-modal"> — {tiktik.nome.split(' ')[0]}</span>
                            )}
                        </h3>
                    </div>
                    <div className="arremate-modal-header-direita">
                        <button className="arremate-modal-fechar-btn" onClick={onClose}>
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                {/* Banner hora extra */}
                {modoHoraExtra && (
                    <div className="op-modal-aviso-hora-extra">
                        <i className="fas fa-exclamation-triangle"></i> Lançamento em Hora Extra — será registrado e o gerente será notificado
                    </div>
                )}

                {/* Body */}
                <div className="oa-modal-body">
                    {tela === 'selecao' && (
                        <ArremateTelaSelecaoProduto
                            onItemSelect={handleItemSelect}
                            onLoteConfirmado={handleConfirmacaoFinal}
                            isBatchMode={true}
                            tiktikContexto={tiktik}
                            itensPréselecionados={itensPréselecionadosIA.length > 0
                                ? itensPréselecionadosIA
                                : itensPréselecionados}
                            onItensCarregados={setItensFila}
                        />
                    )}

                    {tela === 'confirmacao' && itemSelecionado && (
                        <ArremateTelaConfirmacaoQtd
                            item={itemSelecionado}
                            tiktik={tiktik}
                            onVoltar={handleVoltar}
                            onConfirmar={handleConfirmacaoFinal}
                        />
                    )}
                </div>
            </div>

            {/* Tooltip global para os cards */}
            <Tooltip
                id="global-tooltip"
                className="custom-tooltip"
                place="top"
                effect="solid"
                render={({ content }) => {
                    if (!content) return null;
                    try {
                        const ops = JSON.parse(content);
                        return (
                            <ul className="tooltip-lista-ops">
                                {ops.map(op => (
                                    <li key={op.numero}>
                                        <strong>OP {op.numero}:</strong> {op.saldo_op} pçs
                                        <span className="tooltip-data-op">
                                            {new Date(op.data_final).toLocaleDateString('pt-BR')}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        );
                    } catch (e) {
                        return content;
                    }
                }}
            />
        </div>
    );
}
