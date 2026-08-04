import { useEffect, useState } from 'react';
// @ts-expect-error módulo JS legado sem tipos
import { fetchAPI } from '/js/utils/api-utils';
import type { DashVtSaldo } from '../utils/dashboard-types';

function formatarMoeda(v?: number): string {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataBR(iso?: string | null): string {
  if (!iso) return '';
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}/${m}`;
}

interface Props {
  variante?: 'desktop' | 'mobile';
  /** Saldo já buscado no bootstrap da página (evita pop-in do card). */
  dadosInicial?: DashVtSaldo | null;
}

export default function DashVtSaldoCard({ variante = 'desktop', dadosInicial = null }: Props) {
  const [dados, setDados] = useState<DashVtSaldo | null>(dadosInicial);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (dadosInicial) setDados(dadosInicial);
  }, [dadosInicial]);

  useEffect(() => {
    let ativo = true;
    let intervalo: ReturnType<typeof setInterval> | null = null;

    const carregar = async () => {
      try {
        // Smoke: /dashboard/dashboard.html?vt_soft=1  ou  ?vt_hora=08:00
        const qs = new URLSearchParams(window.location.search);
        const params = new URLSearchParams();
        if (qs.get('vt_soft') === '1' || qs.get('vt_soft') === 'true') {
          params.set('vt_soft', '1');
        }
        if (qs.get('vt_hora')) {
          params.set('vt_hora', String(qs.get('vt_hora')));
        }
        const suffix = params.toString() ? `?${params.toString()}` : '';
        const res = (await fetchAPI(`/api/dashboard/meu-vt${suffix}`)) as DashVtSaldo;
        if (!ativo) return;
        setDados(res);
        setErro(false);
      } catch {
        if (!ativo) return;
        // Mantém bootstrap se a recarga falhar
        if (!dadosInicial) {
          setErro(true);
          setDados(null);
        }
      }
    };

    // Bootstrap já trouxe o saldo: só refresh periódico
    if (!dadosInicial) void carregar();
    intervalo = setInterval(carregar, 5 * 60 * 1000);

    const onVis = () => {
      if (document.visibilityState === 'visible') void carregar();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      ativo = false;
      if (intervalo) clearInterval(intervalo);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [dadosInicial]);

  if (erro || !dados || dados.visivel === false) return null;
  if (!(Number(dados.valor_passagem_diaria) > 0)) return null;

  const softAtivo = Boolean(dados.soft_ativo) && (Number(dados.soft_total) || 0) > 0;
  const saldoLivro = Math.max(0, Number(dados.saldo_disponivel) || 0);
  const saldoAgora = Math.max(
    0,
    softAtivo
      ? Number(dados.saldo_exibido ?? dados.saldo_disponivel) || 0
      : saldoLivro,
  );

  const provisionado = Number(dados.saldo_provisionado) || 0;
  const valorDia = Number(dados.valor_passagem_diaria) || 0;
  const via = Number(dados.valor_via) || (valorDia > 0 ? valorDia / 2 : 0);
  const diasCompletos = valorDia > 0 ? Math.floor(saldoAgora / valorDia) : 0;
  const viagens = via > 0 ? Math.floor(saldoAgora / via) : 0;
  const nivel =
    saldoAgora <= 0 ? 'zerado' : diasCompletos <= 1 ? 'baixo' : 'ok';
  const statusLabel = nivel === 'zerado'
    ? 'Sem crédito'
    : nivel === 'baixo'
      ? 'Saldo baixo'
      : 'Cobertura ativa';

  const ultimaDevolucao = (dados.ultimos_movimentos || []).find((m) => m.tipo === 'devolucao_saldo');

  let textoCobertura = '';
  if (saldoAgora <= 0) {
    textoCobertura = 'Não há crédito disponível no cartão agora.';
  } else if (diasCompletos >= 1) {
    textoCobertura =
      diasCompletos === 1
        ? 'Dá para 1 dia de trabalho (ida e volta).'
        : `Dá para cerca de ${diasCompletos} dias de trabalho (ida e volta).`;
  } else if (viagens >= 1) {
    textoCobertura =
      viagens === 1
        ? 'Dá para 1 viagem de ônibus (só ida ou só volta).'
        : `Dá para ${viagens} viagens de ônibus (ainda não fecha um dia completo).`;
  } else {
    textoCobertura = 'Saldo menor que o valor de uma passagem.';
  }

  return (
    <section
      className={`ds-vt-card ds-vt-card--${variante} ds-vt-card--${nivel}`}
      aria-label="Meu cartão VT"
    >
      <header className="ds-vt-card-cabecalho">
        <div className="ds-vt-card-titulo">
          <span className="ds-vt-card-icone" aria-hidden="true">
            <i className="fas fa-bus" />
          </span>
          <span>
            <strong>Meu cartão VT</strong>
            <small>Saldo de passagem</small>
          </span>
        </div>
        <span className={`ds-vt-card-status ds-vt-card-status--${nivel}`}>
          {statusLabel}
        </span>
      </header>

      <div className="ds-vt-card-saldo">
        <span className="ds-vt-card-saldo-label">
          {softAtivo ? 'Disponível agora' : 'Disponível'}
        </span>

        {softAtivo ? (
          <div
            className="ds-vt-card-valores"
            title="A ida de hoje já está em uso. O valor riscado ainda aparece no cartão até o fim do dia."
          >
            <span className="ds-vt-card-valor-livro" aria-label={`Saldo no cartão ${formatarMoeda(saldoLivro)}`}>
              {formatarMoeda(saldoLivro)}
            </span>
            <span className="ds-vt-card-valor-seta" aria-hidden="true">
              <i className="fas fa-arrow-right" />
            </span>
            <strong className="ds-vt-card-saldo-valor ds-vt-card-saldo-valor--agora">
              {formatarMoeda(saldoAgora)}
            </strong>
          </div>
        ) : (
          <strong className="ds-vt-card-saldo-valor">{formatarMoeda(saldoAgora)}</strong>
        )}

      </div>

      <div className="ds-vt-card-cobertura">
        <span className="ds-vt-card-cobertura-icone" aria-hidden="true">
          <i className="fas fa-route" />
        </span>
        <span className="ds-vt-card-cobertura-copy">
          <small>Estimativa de cobertura</small>
          <strong>{textoCobertura}</strong>
        </span>
      </div>

      {provisionado > 0 && (
        <div className="ds-vt-card-prov" role="status">
          <i className="fas fa-clock" aria-hidden="true" />
          <span>
            <strong>{formatarMoeda(provisionado)}</strong> a caminho (até 48h no cartão)
          </span>
        </div>
      )}

      {ultimaDevolucao && (
        <div className="ds-vt-card-devolucao" role="status">
          <i className="fas fa-undo" aria-hidden="true" />
          <span>
            +{formatarMoeda(Number(ultimaDevolucao.valor) || 0)} devolvidos
            {ultimaDevolucao.data_ref ? ` · ${formatarDataBR(ultimaDevolucao.data_ref)}` : ''}
            {ultimaDevolucao.justificativa_fato
              ? ` — ${ultimaDevolucao.justificativa_fato}`
              : ' — ajuste do RH'}
          </span>
        </div>
      )}

      {nivel === 'baixo' && saldoAgora > 0 && (
        <p className="ds-vt-card-alerta">
          Saldo baixo — se precisar, peça recarga ao RH.
        </p>
      )}
      {nivel === 'zerado' && (
        <p className="ds-vt-card-alerta ds-vt-card-alerta--critico">
          Sem crédito no cartão. Peça a recarga ao RH.
        </p>
      )}
    </section>
  );
}
