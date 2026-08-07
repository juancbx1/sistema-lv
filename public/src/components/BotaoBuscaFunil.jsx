// public/src/components/BotaoBuscaFunil.jsx

import React, { useState, useEffect, useRef } from 'react';
import PainelDemandas from './BotaoBuscaPainelDemandas.jsx';
import { calcularStatusDemanda } from '/src/utils/demandaStatus.js';

const POLLING_INTERVAL = 3 * 60 * 1000; // 3 minutos

export default function BotaoBuscaFunil({ onIniciarProducao, permissoes, usarCarregamentoPadrao = false }) {
    const [modalAberto, setModalAberto]         = useState(false);
    const [countAguardando, setCountAguardando] = useState(0); // demandas em AGUARDANDO
    const [countCostura, setCountCostura]       = useState(0); // demandas em COSTURA
    const [totalUrgentes, setTotalUrgentes]     = useState(0); // AGUARDANDO + prioridade=1

    const refreshTimerRef = useRef(null);

    const checkPrioridades = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/demandas/diagnostico-completo', {
                headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-cache' }
            });
            if (res.ok) {
                const data = await res.json();
                const todas = data.diagnosticoAgregado || [];

                let aguardando = 0;
                let costura    = 0;
                let urgentes   = 0;

                todas.forEach(item => {
                    const status = calcularStatusDemanda(item);
                    if (status === 'CONCLUIDO' || status === 'DIVERGENCIA') return;
                    // Conta apenas AGUARDANDO e COSTURA para o badge do FAB
                    if (status === 'AGUARDANDO') {
                        aguardando++;
                        if (parseInt(item.prioridade) === 1) urgentes++;
                    }
                    if (status === 'COSTURA') costura++;
                });

                setCountAguardando(aguardando);
                setCountCostura(costura);
                setTotalUrgentes(urgentes);
            }
        } catch (e) {
            console.error('[FAB] Erro check prioridade:', e);
        }
    };

    useEffect(() => {
        checkPrioridades();

        const agendarProxima = () => {
            refreshTimerRef.current = setTimeout(() => {
                if (!document.hidden) checkPrioridades();
                agendarProxima();
            }, POLLING_INTERVAL);
        };
        agendarProxima();

        const handleVisibility = () => {
            if (!document.hidden) checkPrioridades();
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            clearTimeout(refreshTimerRef.current);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, []);

    const handleClose = () => {
        setModalAberto(false);
        checkPrioridades();
        window.dispatchEvent(new CustomEvent('painel-demandas-fechado'));
    };

    // ── Estados visuais do FAB ──
    // tem-prioridade: urgente (AGUARDANDO + prioridade=1)  → anel rápido
    // tem-demandas:   há aguardando/costura, sem urgência  → anel normal
    // tudo-ok:        zeros em aguardando e costura        → anel lento + dot verde
    const temUrgente  = totalUrgentes > 0;
    const temDemandas = !temUrgente && (countAguardando > 0 || countCostura > 0);
    const tudoOk      = countAguardando === 0 && countCostura === 0;

    const classesFab = [
        'gs-fab-busca',
        temUrgente  ? 'tem-prioridade' : '',
        temDemandas ? 'tem-demandas'   : '',
        tudoOk      ? 'tudo-ok'        : '',
    ].filter(Boolean).join(' ');

    const titulo = temUrgente
        ? `${totalUrgentes} demanda${totalUrgentes > 1 ? 's' : ''} urgente${totalUrgentes > 1 ? 's' : ''}!`
        : countAguardando > 0
            ? `${countAguardando} aguardando, ${countCostura} em costura`
            : 'Painel de Demandas — pipeline limpo';

    return (
        <>
            {/* FAB — robô sempre ativo, monitorando o pipeline */}
            <button
                className={classesFab}
                onClick={() => setModalAberto(true)}
                title={titulo}
            >
                {/* Anel giratório — velocidade muda conforme urgência */}
                <i className="fas fa-circle-notch gs-fab-anel" aria-hidden="true"></i>

                {/* Ícone do robô centralizado */}
                <i className="fas fa-robot gs-fab-robozinho" aria-hidden="true"></i>

                {/* Badge aguardando (laranja normal / vermelho urgente) */}
                {countAguardando > 0 && (
                    <span className={`gs-fab-badge-aguardando${temUrgente ? ' urgente' : ''}`}>
                        {temUrgente ? `${totalUrgentes} urg.` : `${countAguardando} ag.`}
                    </span>
                )}

                {/* Badge costura (azul) */}
                {countCostura > 0 && (
                    <span className="gs-fab-badge-costura">
                        {countCostura} cost.
                    </span>
                )}

                {/* Micro-indicador verde — pipeline limpo */}
                {tudoOk && (
                    <span className="gs-fab-ok-dot" title="Pipeline limpo" />
                )}
            </button>

            {/* Drawer — só monta quando aberto */}
            {modalAberto && (
                <>
                    <div className="gs-drawer-overlay" onClick={handleClose} />
                    <div className="gs-drawer-container">
                        <PainelDemandas
                            onIniciarProducao={(dados) => {
                                setModalAberto(false);
                                if (onIniciarProducao) {
                                    onIniciarProducao(dados);
                                } else {
                                    const params = new URLSearchParams({
                                        demanda_id: dados.demanda_id,
                                        produto_id: dados.produto_id,
                                        quantidade:  dados.quantidade,
                                        auto_abrir:  'true',
                                    });
                                    if (dados.variante) params.set('variante', dados.variante);
                                    window.location.href = `/admin/ordens-de-producao.html?${params.toString()}`;
                                }
                            }}
                            permissoes={permissoes}
                            usarCarregamentoPadrao={usarCarregamentoPadrao}
                            onClose={handleClose}
                        />
                    </div>
                </>
            )}
        </>
    );
}
