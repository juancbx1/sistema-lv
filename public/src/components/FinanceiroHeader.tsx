import { useCallback, useEffect, useRef, useState } from 'react';
import { useFinanceiro } from './FinanceiroContext';
import UICarregando from './UICarregando';

interface AlertStatus { count: number; total: number; }
interface HeaderStatus { contasAtrasadas: AlertStatus; contasVencendoHoje: AlertStatus; }

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

export default function FinanceiroHeader() {
  const { navigateToAgenda, markHeaderReady, tokens } = useFinanceiro();
  const [data, setData] = useState<HeaderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const etag = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const initial = useRef(false);

  const carregar = useCallback(async (polling = false) => {
    if (polling && loadingRef.current) return;
    loadingRef.current = true;
    try {
      const headers = new Headers({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });
      if (etag.current) headers.set('If-None-Match', etag.current);
      const response = await fetch('/api/financeiro/header-status', { headers });
      if (response.status === 304) return;
      if (!response.ok) throw new Error('Falha ao carregar alertas financeiros.');
      etag.current = response.headers.get('ETag');
      setData(await response.json() as HeaderStatus);
    } catch (error) {
      console.error(error);
    } finally {
      loadingRef.current = false;
      setLoading(false);
      if (!initial.current) {
        initial.current = true;
        markHeaderReady();
      }
    }
  }, [markHeaderReady]);

  useEffect(() => {
    void carregar();
    const interval = window.setInterval(() => void carregar(true), 10000);
    return () => window.clearInterval(interval);
  }, [carregar]);

  useEffect(() => {
    if (tokens.header > 0) void carregar();
  }, [tokens.header, carregar]);

  if (loading || !data) {
    return <div className="financeiro-status-react fc-status-summary-loading"><UICarregando variante="inline" tamanho="sm" /> Atualizando monitoramento financeiro...</div>;
  }

  const totalAlertas = data.contasAtrasadas.count + data.contasVencendoHoje.count;

  return (
    <section className="financeiro-status-react fc-status-board" aria-label="Monitoramento financeiro">
      <div className="fc-status-board-heading">
        <div><span className="fc-status-board-kicker">Monitoramento</span><h2>Atenção do dia</h2></div>
        <span className="fc-status-live"><i /> atualizado agora</span>
      </div>
      <div className="fc-status-board-content">
        <div className="fc-status-board-overview">
          <span className={`fc-status-board-orb ${totalAlertas ? 'has-alerts' : 'clear'}`}>
            <i className={`fas ${totalAlertas ? 'fa-bell' : 'fa-check'}`} />
          </span>
          <div>
            <p>{totalAlertas ? `${totalAlertas} compromisso(s) pedem conferência` : 'Nenhum compromisso exige ação agora'}</p>
            <small>Use os atalhos para abrir a agenda já filtrada.</small>
          </div>
        </div>
        <div className="fc-status-board-actions">
          <button type="button" className={`fc-status-action ${data.contasAtrasadas.count ? 'danger' : 'clear'}`} onClick={() => navigateToAgenda('atrasadas')}>
            <span className="fc-status-action-icon"><i className="fas fa-exclamation-triangle" /></span>
            <span className="fc-status-action-copy">
              <small>Contas atrasadas</small>
              <em>{data.contasAtrasadas.count ? `${data.contasAtrasadas.count} registros` : 'Tudo em dia'}</em>
            </span>
            <span className="fc-status-action-value">{money(data.contasAtrasadas.total)}</span>
            <i className="fas fa-arrow-right" />
          </button>
          <button type="button" className={`fc-status-action ${data.contasVencendoHoje.count ? 'warning' : 'clear'}`} onClick={() => navigateToAgenda('hoje')}>
            <span className="fc-status-action-icon"><i className="fas fa-calendar-day" /></span>
            <span className="fc-status-action-copy">
              <small>Vencimentos de hoje</small>
              <em>{data.contasVencendoHoje.count ? `${data.contasVencendoHoje.count} registros` : 'Nada para hoje'}</em>
            </span>
            <span className="fc-status-action-value">{money(data.contasVencendoHoje.total)}</span>
            <i className="fas fa-arrow-right" />
          </button>
        </div>
      </div>
    </section>
  );
}
