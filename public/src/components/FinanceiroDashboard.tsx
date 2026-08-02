import { useCallback, useEffect, useMemo, useState } from 'react';
import UICarregando from './UICarregando';
import { fetchFinanceiro } from '../utils/financeiro-api';
import { useFinanceiro } from './FinanceiroContext';

interface SaldoConta { id: string | number; nome_conta: string; saldo_atual: string | number; }
interface Alertas { a_pagar_hoje_count: number; a_pagar_hoje_total: number; a_pagar_3d_count: number; a_pagar_3d_total: number; a_pagar_5d_count: number; a_pagar_5d_total: number; }
interface DashboardResponse { saldos: SaldoConta[]; alertas: Alertas; }
interface FlowPeriod { label: string; entradas: number; saidas: number; }

const currency = (value: unknown) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
const monthName = (date: Date) => new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(date).replace(/^./, (letter) => letter.toUpperCase());
const shortDate = (date: Date) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);

function createFlowPeriods(date: Date): FlowPeriod[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const heights = [[64, 40], [82, 54], [52, 70], [92, 48], [70, 35]];
  const periods: FlowPeriod[] = [];
  for (let day = 1, index = 0; day <= lastDay; day += 7, index += 1) {
    const end = Math.min(day + 6, lastDay);
    periods.push({
      label: `${shortDate(new Date(year, month, day))} a ${shortDate(new Date(year, month, end))}`,
      entradas: heights[index % heights.length][0],
      saidas: heights[index % heights.length][1],
    });
  }
  return periods;
}

export default function FinanceiroDashboard() {
  const { navigateToAgenda, tokens } = useFinanceiro();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detalharSaldo, setDetalharSaldo] = useState(false);
  const [mostrarZeradas, setMostrarZeradas] = useState(false);
  const hoje = useMemo(() => new Date(), []);
  const periodosFluxo = useMemo(() => createFlowPeriods(hoje), [hoje]);
  const saldoTotal = useMemo(() => (data?.saldos ?? []).reduce((total, conta) => total + Number(conta.saldo_atual || 0), 0), [data]);
  const contasDiferentesZero = useMemo(() => (data?.saldos ?? []).filter((conta) => Math.abs(Number(conta.saldo_atual) || 0) > 0.01), [data]);
  const contasPositivas = useMemo(() => contasDiferentesZero.filter((conta) => Number(conta.saldo_atual) > 0), [contasDiferentesZero]);
  const contasNegativas = useMemo(() => contasDiferentesZero.filter((conta) => Number(conta.saldo_atual) < 0), [contasDiferentesZero]);
  const contasExibidas = useMemo(() => (mostrarZeradas ? (data?.saldos ?? []) : contasDiferentesZero), [data, mostrarZeradas, contasDiferentesZero]);
  const totalPositivo = useMemo(() => contasPositivas.reduce((total, conta) => total + Number(conta.saldo_atual), 0), [contasPositivas]);
  const totalNegativo = useMemo(() => contasNegativas.reduce((total, conta) => total + Math.abs(Number(conta.saldo_atual)), 0), [contasNegativas]);
  const saldoEstado = Math.abs(saldoTotal) <= 0.01 ? 'zerado' : saldoTotal < 0 ? 'negativo' : 'positivo';

  const carregar = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchFinanceiro<DashboardResponse>('/dashboard'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os saldos.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { if (tokens.dashboard > 0) void carregar(); }, [tokens.dashboard, carregar]);

  if (isLoading) {
    return (
      <div className="fc-dashboard-loading">
        <UICarregando variante="bloco" tamanho="md" texto="Atualizando saldos..." />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fc-dashboard-error">
        <p>{error ?? 'Não foi possível carregar os saldos.'}</p>
        <button type="button" className="fc-btn-atualizar" onClick={() => void carregar()}>Tentar novamente</button>
      </div>
    );
  }

  return (
    <div className="fc-dashboard-modern">
      <section className="fc-dashboard-overview">
        <article className={`fc-saldo-hero fc-dashboard-card fc-dashboard-balance fc-dashboard-balance--${saldoEstado}`}>
          <div className="fc-dashboard-card-top">
            <span className="fc-dashboard-eyebrow">Saldo consolidado · {monthName(hoje)}</span>
            <button type="button" className="fc-dashboard-period" onClick={() => void carregar()} title="Atualizar saldos">
              Atualizar <i className="fas fa-sync-alt" />
            </button>
          </div>
          <strong className="fc-saldo-hero-value">{currency(saldoTotal)}</strong>
          <div className="fc-dashboard-balance-context">
            <i className={`fas ${saldoEstado === 'negativo' ? 'fa-arrow-down' : saldoEstado === 'zerado' ? 'fa-minus' : 'fa-arrow-up'}`} />
            <span>
              {saldoEstado === 'negativo'
                ? 'O consolidado está negativo e precisa de conferência.'
                : saldoEstado === 'zerado'
                  ? 'O consolidado está zerado neste momento.'
                  : contasNegativas.length
                    ? 'Saldo positivo, mas existem contas negativas para conferir.'
                    : 'Saldo positivo e nenhuma conta negativa detectada.'}
            </span>
          </div>
          <div className="fc-dashboard-balance-foot">
            <span><small>Contas diferentes de zero</small><b>{contasDiferentesZero.length}</b></span>
            <span><small>Saldo positivo</small><b>{currency(totalPositivo)}</b></span>
            <span><small>Em alerta</small><b>{contasNegativas.length}</b></span>
            <button type="button" className="fc-dashboard-smart-action" onClick={() => setDetalharSaldo((value) => !value)}>
              {detalharSaldo ? 'Ocultar detalhes' : 'Detalhar saldo'}
            </button>
          </div>
          {detalharSaldo && (
            <div className="fc-dashboard-smart-detail">
              <span>Somatório positivo <b>{currency(totalPositivo)}</b></span>
              <span>Exposição negativa <b>{currency(totalNegativo)}</b></span>
              <span>Contas zeradas <b>{(data.saldos.length - contasDiferentesZero.length).toString()}</b></span>
            </div>
          )}
        </article>

        <article id="financeiro-contas-card" className="fc-dashboard-card fc-dashboard-accounts">
          <div className="fc-dashboard-card-heading">
            <div><span className="fc-dashboard-eyebrow">Carteira financeira</span><h2>Contas em acompanhamento</h2></div>
            <i className="fas fa-wallet" />
          </div>
          <label className="fc-dashboard-zero-toggle">
            <input type="checkbox" checked={mostrarZeradas} onChange={(event) => setMostrarZeradas(event.target.checked)} />
            <span>Mostrar contas zeradas</span>
          </label>
          <div className="fc-dashboard-account-list">
            {contasExibidas.length > 0 ? contasExibidas.map((conta) => {
              const saldo = Number(conta.saldo_atual) || 0;
              const negativa = saldo < 0;
              const zerada = Math.abs(saldo) <= 0.01;
              return (
                <div className={`fc-dashboard-account ${negativa ? 'fc-dashboard-account--negative' : zerada ? 'fc-dashboard-account--zero' : 'fc-dashboard-account--positive'}`} key={conta.id}>
                  <span className="fc-dashboard-account-icon"><i className={`fas ${negativa ? 'fa-triangle-exclamation' : zerada ? 'fa-minus' : 'fa-university'}`} /></span>
                  <span className="fc-dashboard-account-copy">
                    <b>{conta.nome_conta}</b>
                    <small>{negativa ? 'Saldo negativo · conferir' : zerada ? 'Saldo zerado' : 'Saldo disponível'}</small>
                  </span>
                  <strong>{currency(saldo)}</strong>
                </div>
              );
            }) : <p className="fc-dashboard-empty">Nenhuma conta com saldo diferente de zero.</p>}
          </div>
        </article>
      </section>

      <section className="fc-dashboard-section">
        <div className="fc-dashboard-section-heading">
          <div><span className="fc-dashboard-eyebrow">Visão dos próximos dias</span><h2>Agenda financeira</h2></div>
          <i className="fas fa-calendar-alt" />
        </div>
        <div className="fc-dashboard-alert-grid">
          <button type="button" className="fc-dashboard-alert fc-dashboard-alert-danger" onClick={() => navigateToAgenda('3d')}>
            <div className="card-borda-charme" />
            <span><i className="fas fa-arrow-up" /> A pagar · próximos 3 dias</span>
            <strong>{data.alertas.a_pagar_3d_count}</strong>
            <small>{currency(data.alertas.a_pagar_3d_total)}</small>
          </button>
          <button type="button" className="fc-dashboard-alert fc-dashboard-alert-warning" onClick={() => navigateToAgenda('5d')}>
            <div className="card-borda-charme" />
            <span><i className="fas fa-clock" /> A pagar · 4 a 5 dias</span>
            <strong>{data.alertas.a_pagar_5d_count}</strong>
            <small>{currency(data.alertas.a_pagar_5d_total)}</small>
          </button>
          <button type="button" className="fc-dashboard-alert fc-dashboard-alert-info" onClick={() => navigateToAgenda('hoje')}>
            <div className="card-borda-charme" />
            <span><i className="fas fa-calendar-day" /> A pagar · hoje</span>
            <strong>{data.alertas.a_pagar_hoje_count}</strong>
            <small>{currency(data.alertas.a_pagar_hoje_total)}</small>
          </button>
        </div>
      </section>

      <section className="fc-dashboard-card fc-dashboard-flow">
        <div className="fc-dashboard-card-heading">
          <div><span className="fc-dashboard-eyebrow">Movimentação por período</span><h2>Fluxo de {monthName(hoje)}</h2></div>
          <div className="fc-dashboard-flow-legend">
            <span><i className="fc-dashboard-legend-in" /> Entradas</span>
            <span><i className="fc-dashboard-legend-out" /> Saídas</span>
          </div>
        </div>
        <div className="fc-dashboard-bars" aria-label={`Comparativo visual de entradas e saídas de ${monthName(hoje)}`}>
          {periodosFluxo.map((periodo) => (
            <div key={periodo.label}>
              <span className="fc-bar fc-bar-in" style={{ height: `${periodo.entradas}%` }} />
              <span className="fc-bar fc-bar-out" style={{ height: `${periodo.saidas}%` }} />
              <small>{periodo.label}</small>
            </div>
          ))}
        </div>
        <div className="fc-dashboard-flow-foot">
          <span>Períodos exibidos com base no mês atual</span>
          <span>Atualizado agora</span>
        </div>
      </section>
    </div>
  );
}
