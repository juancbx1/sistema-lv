// public/src/components/BotaoBuscaFunil.tsx

import { type ComponentType, useEffect, useRef, useState } from 'react';
import PainelDemandas from './BotaoBuscaPainelDemandas.tsx';
// @ts-expect-error utilitario JS legado sem declaracao TypeScript
import { calcularStatusDemanda } from '/src/utils/demandaStatus.js';
import type { OpInicioProducaoDados } from '../utils/op-types';

const POLLING_INTERVAL = 3 * 60 * 1000;

interface OpDemandaDiagnostico {
  prioridade?: number | string | null;
  saldo_em_producao?: number | null;
  saldo_disponivel_arremate?: number | null;
  saldo_disponivel_embalagem?: number | null;
  saldo_disponivel_estoque?: number | null;
  saldo_perda?: number | null;
  demanda_total?: number | null;
  [key: string]: unknown;
}

interface BotaoBuscaFunilProps {
  onIniciarProducao?: (dados: OpInicioProducaoDados) => void;
  permissoes: string[];
}

interface PainelDemandasProps {
  onIniciarProducao: (dados: OpInicioProducaoDados) => void;
  permissoes: string[];
  onClose: () => void;
}

const PainelDemandasTipado = PainelDemandas as ComponentType<PainelDemandasProps>;

export default function BotaoBuscaFunil({ onIniciarProducao, permissoes }: BotaoBuscaFunilProps) {
  const [modalAberto, setModalAberto] = useState(false);
  const [countAguardando, setCountAguardando] = useState(0);
  const [countCostura, setCountCostura] = useState(0);
  const [totalUrgentes, setTotalUrgentes] = useState(0);
  const refreshTimerRef = useRef<number | null>(null);

  const checkPrioridades = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/demandas/diagnostico-completo', {
        headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) return;

      const data = (await res.json()) as { diagnosticoAgregado?: OpDemandaDiagnostico[] };
      const todas = Array.isArray(data.diagnosticoAgregado) ? data.diagnosticoAgregado : [];
      let aguardando = 0;
      let costura = 0;
      let urgentes = 0;

      todas.forEach((item) => {
        const status = calcularStatusDemanda(item);
        if (status === 'CONCLUIDO' || status === 'DIVERGENCIA') return;
        if (status === 'AGUARDANDO') {
          aguardando += 1;
          if (parseInt(String(item.prioridade), 10) === 1) urgentes += 1;
        }
        if (status === 'COSTURA') costura += 1;
      });

      setCountAguardando(aguardando);
      setCountCostura(costura);
      setTotalUrgentes(urgentes);
    } catch (error) {
      console.error('[FAB] Erro check prioridade:', error);
    }
  };

  useEffect(() => {
    void checkPrioridades();

    const agendarProxima = () => {
      refreshTimerRef.current = window.setTimeout(() => {
        if (!document.hidden) void checkPrioridades();
        agendarProxima();
      }, POLLING_INTERVAL);
    };
    agendarProxima();

    const handleVisibility = () => {
      if (!document.hidden) void checkPrioridades();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const handleClose = () => {
    setModalAberto(false);
    void checkPrioridades();
    window.dispatchEvent(new CustomEvent('painel-demandas-fechado'));
  };

  const temUrgente = totalUrgentes > 0;
  const temDemandas = !temUrgente && (countAguardando > 0 || countCostura > 0);
  const tudoOk = countAguardando === 0 && countCostura === 0;
  const classesFab = [
    'gs-fab-busca',
    temUrgente ? 'tem-prioridade' : '',
    temDemandas ? 'tem-demandas' : '',
    tudoOk ? 'tudo-ok' : '',
  ].filter(Boolean).join(' ');

  const titulo = temUrgente
    ? `${totalUrgentes} demanda${totalUrgentes > 1 ? 's' : ''} urgente${totalUrgentes > 1 ? 's' : ''}!`
    : countAguardando > 0
      ? `${countAguardando} aguardando, ${countCostura} em costura`
      : 'Painel de Demandas — pipeline limpo';

  const handleIniciarProducao = (dados: OpInicioProducaoDados) => {
    setModalAberto(false);
    if (onIniciarProducao) {
      onIniciarProducao(dados);
      return;
    }

    const params = new URLSearchParams({
      demanda_id: String(dados.demanda_id),
      produto_id: String(dados.produto_id),
      quantidade: String(dados.quantidade || 0),
      auto_abrir: 'true',
    });
    if (dados.variante) params.set('variante', dados.variante);
    window.location.href = `/admin/ordens-de-producao.html?${params.toString()}`;
  };

  return (
    <>
      <button
        className={classesFab}
        onClick={() => setModalAberto(true)}
        title={titulo}
      >
        <i className="fas fa-circle-notch gs-fab-anel" aria-hidden="true"></i>
        <i className="fas fa-robot gs-fab-robozinho" aria-hidden="true"></i>
        {countAguardando > 0 && (
          <span className={`gs-fab-badge-aguardando${temUrgente ? ' urgente' : ''}`}>
            {temUrgente ? `${totalUrgentes} urg.` : `${countAguardando} ag.`}
          </span>
        )}
        {countCostura > 0 && (
          <span className="gs-fab-badge-costura">{countCostura} cost.</span>
        )}
        {tudoOk && <span className="gs-fab-ok-dot" title="Pipeline limpo" />}
      </button>

      {modalAberto && (
        <>
          <div className="gs-drawer-overlay" onClick={handleClose} />
          <div className="gs-drawer-container">
            <PainelDemandasTipado
              onIniciarProducao={handleIniciarProducao}
              permissoes={permissoes}
              onClose={handleClose}
            />
          </div>
        </>
      )}
    </>
  );
}
