// public/src/components/OPCortesRadar.jsx
// Pulso do Setor de Cortes — métricas em tempo real

import React, { useState, useEffect, useCallback } from 'react';
import UIBloqueio from './UIBloqueio.jsx';

function calcTempoDesde(data) {
    if (!data) return null;
    const diff = Date.now() - new Date(data).getTime();
    const min = Math.floor(diff / 60000);
    const horas = Math.floor(diff / 3600000);
    const dias = Math.floor(horas / 24);
    if (min < 60) return `${min}min`;
    if (horas < 24) return `${horas}h`;
    return `${dias}d`;
}

function isInativo48h(ultimoLancamento) {
    if (!ultimoLancamento?.data) return true;
    return (Date.now() - new Date(ultimoLancamento.data).getTime()) > 48 * 3600 * 1000;
}

export default function OPCortesRadar({ refreshKey, onRegistrarCorte }) {
    const [radar, setRadar] = useState(null);
    const [loading, setLoading] = useState(true);
    const buscar = useCallback(async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const r = await fetch('/api/cortes/radar', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!r.ok) throw new Error('Falha no radar');
            setRadar(await r.json());
        } catch (e) {
            console.error('[OPCortesRadar]', e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { buscar(); }, [buscar, refreshKey]);

    const inativo = !loading && isInativo48h(radar?.ultimoLancamento);
    const tempo = radar?.ultimoLancamento ? calcTempoDesde(radar.ultimoLancamento.data) : null;

    return (
        <div className="op-cortes-radar">

            {/* ── PULSO DO SETOR ── */}
            <div className="op-cortes-pulso">
                <div className="op-cortes-pulso-esq">
                    <span className="op-pulso-dot" title="Sistema conectado"></span>
                    <span className="op-pulso-label">Estoque de Cortes</span>

                    <div className="op-cortes-chips">
                        <div className="op-cortes-chip" title="Total de peças cortadas disponíveis">
                            <span className="chip-valor">{loading ? '…' : (radar?.totalPecasEstoque ?? 0)}</span>
                            <span className="chip-rotulo">peças</span>
                        </div>
                        <div
                            className={`op-cortes-chip ${!loading && (radar?.lancamentosHoje ?? 0) > 0 ? 'verde' : ''}`}
                            title="Cortes lançados hoje"
                        >
                            <span className="chip-valor">{loading ? '…' : (radar?.lancamentosHoje ?? 0)}</span>
                            <span className="chip-rotulo">hoje</span>
                        </div>
                        {!loading && tempo && (
                            <div
                                className={`op-cortes-chip ${inativo ? 'vermelho' : 'neutro'}`}
                                title={`Último lançamento: ${radar.ultimoLancamento?.cortador ?? ''} — ${radar.ultimoLancamento?.produto ?? ''}`}
                            >
                                <span className="chip-valor">{tempo}</span>
                                <span className="chip-rotulo">último</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Aviso de inatividade */}
                {inativo && (
                    <div className="op-cortes-inatividade">
                        <i className="fas fa-exclamation-triangle"></i>
                        <span>Nenhum corte lançado nas últimas 48h</span>
                    </div>
                )}

                {/* Botão de ação principal */}
                {onRegistrarCorte && (
                    <UIBloqueio permissao="registrar-corte">
                        <button
                            className="op-cortes-btn-quicklog"
                            onClick={onRegistrarCorte}
                        >
                            <i className="fas fa-bolt"></i>
                            Registrar Corte
                        </button>
                    </UIBloqueio>
                )}
            </div>

        </div>
    );
}
