import React, { useState, useEffect, useCallback } from 'react';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UICarregando from './UICarregando';
import { mostrarToast, mostrarMensagem, mostrarPromptTexto } from '/js/utils/popups.js';

function formatarDataBR(isoDate) {
    const [ano, mes, dia] = isoDate.split('-');
    return `${dia}/${mes}/${ano}`;
}

function PGHistoricoPontosExtras({ dataReferencia }) {
    const [aberto, setAberto] = useState(false);
    const [registros, setRegistros] = useState([]);
    const [loading, setLoading] = useState(false);

    const buscar = useCallback(async () => {
        if (!aberto) return;
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/pontos-extras/historico?data=${dataReferencia}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (res.ok) setRegistros(await res.json());
        } finally {
            setLoading(false);
        }
    }, [aberto, dataReferencia]);

    useEffect(() => { buscar(); }, [buscar]);

    const totalAtivos = registros
        .filter(r => !r.cancelado)
        .reduce((s, r) => s + parseFloat(r.pontos), 0);

    async function solicitarCancelamento(registro) {
        const motivo = await mostrarPromptTexto(
            `Cancelar os pontos de <strong>${registro.funcionario_nome}</strong>?<br>` +
            `<small style="color:#888">Informe o motivo do cancelamento.</small>`,
            {
                placeholder: 'Ex: Lançamento indevido, erro de sistema...',
                tipo: 'perigo',
                textoConfirmar: 'Cancelar Lançamento',
            }
        );
        if (!motivo) return;

        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/pontos-extras/${registro.id}/cancelar`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ motivo_cancelamento: motivo }),
            });
            const data = await res.json();
            if (res.status === 403) {
                mostrarMensagem(
                    `🔒 <strong>Sem permissão</strong><br><br>${data.error}`,
                    'erro'
                );
                return;
            }
            if (!res.ok) throw new Error(data.error);
            mostrarToast('Lançamento cancelado com sucesso.', 'sucesso', 2000);
            buscar();
        } catch (e) {
            mostrarMensagem(`Erro ao cancelar: ${e.message}`, 'erro');
        }
    }

    function formatarHora(iso) {
        return new Date(iso).toLocaleTimeString('pt-BR', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
        });
    }

    return (
        <div className="gs-card pg-historico-pe">
            <div
                className="pg-historico-pe-header"
                onClick={() => setAberto(a => !a)}
                role="button"
            >
                <span className="pg-historico-pe-titulo">
                    <i className="fas fa-star" style={{ color: '#f59e0b' }}></i>
                    Pontos Extras — Histórico de {formatarDataBR(dataReferencia)}
                    {totalAtivos > 0 && (
                        <span className="pg-historico-pe-total">Total: {totalAtivos.toFixed(0)} pts</span>
                    )}
                </span>
                <i className={`fas ${aberto ? 'fa-chevron-up' : 'fa-chevron-down'} pg-historico-pe-chevron`}></i>
            </div>

            {aberto && (
                <div className="pg-historico-pe-corpo">
                    {loading && (
                        <UICarregando variante="bloco" tamanho="sm" texto="Carregando histórico..." />
                    )}

                    {!loading && registros.length === 0 && (
                        <UIFeedbackNotFound
                            variante="compacto"
                            icon="fa-star"
                            titulo="Nenhum lançamento de pontos extras"
                            mensagem="Não há pontos extras registrados para esta data."
                        />
                    )}

                    {registros.map(r => (
                        <div
                            key={r.id}
                            className={`pg-pe-registro ${r.cancelado ? 'pg-pe-registro--cancelado' : ''}`}
                        >
                            <div className="pg-pe-registro-corpo">
                                <div className="pg-pe-registro-topo">
                                    <span className="pg-pe-nome">{r.funcionario_nome}</span>
                                    <span className="pg-pe-pontos" style={{ color: r.cancelado ? '#9e9e9e' : '#f59e0b' }}>
                                        +{parseFloat(r.pontos).toFixed(0)} pts
                                    </span>
                                    {r.cancelado && <span className="pg-pe-badge-cancelado">CANCELADO</span>}
                                </div>

                                <p className="pg-pe-motivo">"{r.motivo}"</p>

                                <div className="pg-pe-meta">
                                    <span>por {r.supervisor_nome} · {formatarHora(r.data_lancamento)}</span>
                                    {!r.cancelado && (
                                        <button
                                            className="pg-pe-btn-cancelar"
                                            onClick={() => solicitarCancelamento(r)}
                                        >
                                            Cancelar
                                        </button>
                                    )}
                                </div>

                                {r.cancelado && r.cancelado_por_nome && (
                                    <p className="pg-pe-cancelado-info">
                                        Cancelado por {r.cancelado_por_nome} · "{r.motivo_cancelamento}"
                                    </p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modais movidos para popups.js — sem JSX extra necessário */}
        </div>
    );
}

export default PGHistoricoPontosExtras;
