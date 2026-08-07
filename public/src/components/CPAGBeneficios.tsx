import { useEffect, useMemo, useState } from 'react';
import Select from 'react-select';
import UICarregando from './UICarregando';
import { formatarMoeda } from '../utils/cpag-format';
import { mostrarConfirmacao, mostrarToast } from '../utils/cpag-feedback';
import { fetchCpag } from '../utils/cpag-api';
import {
  dataPagamentoVa,
  formatarDataPtBr,
  montarDiasNaoUteisPagamento,
  type CpagEventoCalendario,
} from '../utils/cpag-dias-uteis';
import type {
  CpagContaFinanceira,
  CpagFolhaBeneficioItem,
  CpagHistoricoPagamento,
  CpagPayloadEfetuar,
  CpagSalarioMesOption,
  CpagSalarioMesStatus,
  CpagSelectOption,
  CpagUsuario,
} from '../utils/cpag-types';

interface Props {
  usuarios: CpagUsuario[];
  contas: CpagContaFinanceira[];
}

const MESES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

const MESES_CURTO = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

/** Mesmo marco da folha: benefícios a partir de Julho/2026. */
const INICIO_VA_MES = 6;
const INICIO_VA_ANO = 2026;

function idsIguais(a: number | string, b: number | string): boolean {
  return String(a) === String(b);
}

function periodoLabelMes(mesIndex: number, ano: number): string {
  const ultimo = new Date(ano, mesIndex + 1, 0).getDate();
  return `01/${MESES_CURTO[mesIndex]} – ${String(ultimo).padStart(2, '0')}/${MESES_CURTO[mesIndex]}`;
}

function mesAntesDoInicio(mesIndex: number, ano: number): boolean {
  if (ano < INICIO_VA_ANO) return true;
  if (ano > INICIO_VA_ANO) return false;
  return mesIndex < INICIO_VA_MES;
}

function gerarMesesVa(
  diasNaoUteis: Set<string>,
  agora = new Date(),
): CpagSalarioMesOption[] {
  const lista: CpagSalarioMesOption[] = [];
  let mes = agora.getMonth();
  let ano = agora.getFullYear();

  for (let i = 0; i < 24; i += 1) {
    if (mesAntesDoInicio(mes, ano)) break;

    const dataPag = dataPagamentoVa(mes, ano, diasNaoUteis);
    const dia25 = new Date(ano, mes, 25, 12, 0, 0, 0);
    const caiuNo25 =
      dataPag.getFullYear() === dia25.getFullYear() &&
      dataPag.getMonth() === dia25.getMonth() &&
      dataPag.getDate() === 25;

    // "Em aberto" até o dia de pagamento (exclusive no sentido de prazo):
    // vencido = já passou o dia de pagamento e ainda não quitou.
    const mesFechadoParaPrazo = agora > dataPag;
    const vencido = mesFechadoParaPrazo;
    const value = `${MESES_PT[mes]}/${ano}`;
    const dataPagStr = formatarDataPtBr(dataPag);

    let status: CpagSalarioMesStatus = 'historico';
    // Mês de referência ainda não chegou ao dia de pagamento
    if (!mesFechadoParaPrazo) {
      // Se já estamos no mês de referência, é o ciclo corrente
      const inicioMes = new Date(ano, mes, 1, 0, 0, 0, 0);
      const fimMes = new Date(ano, mes + 1, 0, 23, 59, 59, 999);
      if (agora < inicioMes) status = 'historico'; // futuro
      else if (agora <= fimMes) status = 'em_aberto';
      else status = 'a_pagar'; // após o mês mas antes do prazo? (não ocorre se prazo é dia 25 no mês)
    } else {
      status = 'pendente';
    }

    // Ajuste fino: no dia de pagamento (ainda no prazo do dia), trata como a_pagar
    const mesmoDiaPag =
      agora.getFullYear() === dataPag.getFullYear() &&
      agora.getMonth() === dataPag.getMonth() &&
      agora.getDate() === dataPag.getDate();
    if (mesmoDiaPag) {
      status = 'a_pagar';
    } else if (!mesFechadoParaPrazo && agora >= new Date(ano, mes, 1)) {
      // Antes do dia de pagamento no mês corrente → em aberto (ainda não venceu)
      status = 'em_aberto';
    } else if (mesFechadoParaPrazo) {
      status = 'pendente';
    }

    lista.push({
      value,
      label: value,
      mesIndex: mes,
      ano,
      mesFechado: mesFechadoParaPrazo,
      vencido,
      status,
      periodoLabel: periodoLabelMes(mes, ano),
      mesPagamentoLabel: dataPagStr,
      mesPagamentoCurto: dataPagStr,
      prazoLabel: caiuNo25
        ? `dia 25/${MESES_CURTO[mes]} (${dataPagStr})`
        : `dia 25 ou próximo útil → ${dataPagStr}`,
    });

    mes -= 1;
    if (mes < 0) {
      mes = 11;
      ano -= 1;
    }
  }

  return lista;
}

function historicoEhVaDaRef(item: CpagHistoricoPagamento, ref: string): boolean {
  const ciclo = String(item.ciclo_nome || '');
  const desc = String(item.descricao || '');
  const cicloL = ciclo.toLowerCase();
  const descL = desc.toLowerCase();

  if (ciclo === `VA ${ref}` || ciclo === ref) return true;
  if ((cicloL.includes('va ') || cicloL.startsWith('va')) && ciclo.includes(ref)) return true;
  if (desc === `VA ${ref}` || desc.includes(`VA ${ref}`)) return true;
  if (desc.includes(ref)) {
    if (
      descL.includes('va ') ||
      descL.includes('vale alimentação') ||
      descL.includes('vale alimentacao') ||
      descL.includes('benefício') ||
      descL.includes('beneficio')
    ) {
      return true;
    }
  }
  return false;
}

function classificarMesesComHistorico(
  meses: CpagSalarioMesOption[],
  historico: CpagHistoricoPagamento[],
  usuarios: CpagUsuario[],
): CpagSalarioMesOption[] {
  const alvo = usuarios.length > 0 ? usuarios : [];

  return meses.map((m) => {
    const pagosNoMes = historico.filter((h) => historicoEhVaDaRef(h, m.value));
    const idsPagos = new Set(pagosNoMes.map((h) => String(h.usuario_id)));
    const todosPagos = alvo.length > 0 && alvo.every((u) => idsPagos.has(String(u.id)));

    if (todosPagos) {
      return { ...m, status: 'pago' as const, vencido: false };
    }

    // Futuro puro: mês de referência ainda não começou
    const inicioMes = new Date(m.ano, m.mesIndex, 1, 0, 0, 0, 0);
    const agora = new Date();
    if (agora < inicioMes) {
      return { ...m, status: 'historico' as const, vencido: false, mesFechado: false };
    }

    if (!m.mesFechado) {
      // Ainda não chegou/passou o dia 25 (ou próximo útil)
      return { ...m, status: 'em_aberto' as const, vencido: false };
    }

    // Passou o dia de pagamento e não está quitado
    if (m.vencido) {
      return { ...m, status: 'pendente' as const, vencido: true };
    }
    return { ...m, status: 'a_pagar' as const, vencido: false };
  });
}

function statusMeta(status: CpagSalarioMesStatus): { titulo: string; icone: string } {
  switch (status) {
    case 'em_aberto':
      return { titulo: 'Em aberto', icone: 'fa-spinner' };
    case 'a_pagar':
      return { titulo: 'A pagar', icone: 'fa-wallet' };
    case 'pendente':
      return { titulo: 'Pendente', icone: 'fa-exclamation-circle' };
    case 'pago':
      return { titulo: 'Pago', icone: 'fa-check-circle' };
    default:
      return { titulo: 'Referência', icone: 'fa-calendar' };
  }
}

function rotuloChipMes(mes: CpagSalarioMesOption): string {
  if (mes.status === 'pago') return 'Pago';
  if (mes.status === 'em_aberto') return 'Em aberto';
  if (mes.status === 'pendente' || mes.vencido) return 'Pendente';
  if (mes.status === 'a_pagar') return 'A pagar';
  return 'Referência';
}

export default function CPAGBeneficios({ usuarios, contas }: Props) {
  const [diasNaoUteis, setDiasNaoUteis] = useState<Set<string>>(new Set());
  const [calendarioCarregado, setCalendarioCarregado] = useState(false);
  const [historicoCompleto, setHistoricoCompleto] = useState<CpagHistoricoPagamento[]>([]);
  const [mesSelecionado, setMesSelecionado] = useState<CpagSalarioMesOption | null>(null);
  const [selectedConta, setSelectedConta] = useState<CpagSelectOption | null>(null);
  const [valorPadrao, setValorPadrao] = useState('200.00');
  const [folha, setFolha] = useState<CpagFolhaBeneficioItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  // Calendário da empresa (feriados/folgas) para calcular o dia 25 / próximo útil
  useEffect(() => {
    let ativo = true;
    const carregar = async () => {
      try {
        const agora = new Date();
        const inicio = `${INICIO_VA_ANO}-01-01`;
        const fim = `${agora.getFullYear() + 1}-12-31`;
        const eventos = await fetchCpag<CpagEventoCalendario[]>(
          `/api/calendario?inicio=${inicio}&fim=${fim}`,
        );
        if (!ativo) return;
        setDiasNaoUteis(montarDiasNaoUteisPagamento(Array.isArray(eventos) ? eventos : []));
      } catch (error) {
        console.error('Erro ao carregar calendário da empresa para VA:', error);
        // Segue sem feriados (só seg–sex)
        if (ativo) setDiasNaoUteis(new Set());
      } finally {
        if (ativo) setCalendarioCarregado(true);
      }
    };
    void carregar();
    return () => {
      ativo = false;
    };
  }, []);

  const mesesBase = useMemo(
    () => (calendarioCarregado ? gerarMesesVa(diasNaoUteis) : []),
    [calendarioCarregado, diasNaoUteis],
  );

  const opcoesMes = useMemo(
    () => classificarMesesComHistorico(mesesBase, historicoCompleto, usuarios),
    [mesesBase, historicoCompleto, usuarios],
  );

  useEffect(() => {
    if (!opcoesMes.length) {
      setMesSelecionado(null);
      return;
    }
    setMesSelecionado((atual) => {
      if (atual) {
        const ainda = opcoesMes.find((m) => m.value === atual.value);
        if (ainda) return ainda;
      }
      return (
        opcoesMes.find((m) => m.status === 'pendente') ||
        opcoesMes.find((m) => m.status === 'a_pagar') ||
        opcoesMes.find((m) => m.status === 'em_aberto') ||
        opcoesMes.find((m) => m.status === 'pago') ||
        opcoesMes[0] ||
        null
      );
    });
  }, [opcoesMes]);

  const contaOptions = useMemo<CpagSelectOption[]>(
    () => contas.map((conta) => ({ value: conta.id, label: conta.nome_conta })),
    [contas],
  );

  useEffect(() => {
    let ativo = true;
    const carregar = async () => {
      try {
        const data = await fetchCpag<CpagHistoricoPagamento[]>('/api/pagamentos/historico');
        if (ativo) setHistoricoCompleto(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error(error);
      }
    };
    void carregar();
    return () => {
      ativo = false;
    };
  }, []);

  const historicoDaRef = useMemo(() => {
    if (!mesSelecionado) return [];
    return historicoCompleto.filter((item) => historicoEhVaDaRef(item, mesSelecionado.value));
  }, [historicoCompleto, mesSelecionado]);

  useEffect(() => {
    setFolha(
      usuarios.map((usuario) => {
        const pago = historicoDaRef.some((item) => idsIguais(item.usuario_id, usuario.id));
        return {
          id: usuario.id,
          nome: usuario.nome,
          valor: valorPadrao,
          selecionado: !pago,
          pago,
        };
      }),
    );
  }, [usuarios, historicoDaRef, valorPadrao]);

  // VA pode ser pago a partir do 1º dia do mês de referência (dia 25 é o prazo, não a trava)
  const referenciaFutura = Boolean(
    mesSelecionado &&
      new Date() < new Date(mesSelecionado.ano, mesSelecionado.mesIndex, 1, 0, 0, 0, 0),
  );
  const pagamentoBloqueado = referenciaFutura;
  const mensagemBloqueio = referenciaFutura
    ? 'Esta referência ainda não começou. O VA só pode ser pago a partir do 1º dia do mês.'
    : '';

  const selecionados = folha.filter((item) => item.selecionado && !item.pago);
  const totalPagar = selecionados.reduce(
    (soma, item) => soma + (Number.parseFloat(item.valor) || 0),
    0,
  );

  const alterarItem = (
    id: number | string,
    alterar: (item: CpagFolhaBeneficioItem) => CpagFolhaBeneficioItem,
  ) => setFolha((atual) => atual.map((item) => (item.id === id ? alterar(item) : item)));

  const aplicarValorPadrao = () =>
    setFolha((atual) =>
      atual.map((item) => (item.pago ? item : { ...item, valor: valorPadrao })),
    );

  const handleProcessar = async () => {
    if (!mesSelecionado) {
      mostrarToast('Selecione a referência do mês.', 'aviso');
      return;
    }
    if (pagamentoBloqueado) {
      mostrarToast(mensagemBloqueio, 'aviso');
      return;
    }
    if (!selectedConta) {
      mostrarToast('Selecione a conta.', 'aviso');
      return;
    }
    if (!selecionados.length) {
      mostrarToast('Selecione alguém.', 'aviso');
      return;
    }

    if (
      !(await mostrarConfirmacao(
        `Pagar VA para <strong>${selecionados.length} pessoas</strong>?<br>Total: <strong>${formatarMoeda(totalPagar)}</strong><br>Ref: ${mesSelecionado.value}<br><small>Data prevista de pagamento: <strong>${mesSelecionado.mesPagamentoLabel}</strong> (${mesSelecionado.prazoLabel})</small>`,
        { tipo: 'aviso', textoConfirmar: 'Confirmar' },
      ))
    ) {
      return;
    }

    setLoading(true);
    try {
      await Promise.all(
        selecionados.map((item) => {
          const valorItem = Number.parseFloat(item.valor) || 0;
          const payload: CpagPayloadEfetuar = {
            calculo: {
              detalhes: {
                funcionario: { id: item.id, nome: item.nome },
                ciclo: { nome: `VA ${mesSelecionado.value}` },
                tipoPagamento: 'BENEFICIOS',
              },
              proventos: {
                beneficios: valorItem,
                salarioProporcional: 0,
                comissao: 0,
                valeTransporte: 0,
              },
              totais: { totalLiquidoAPagar: valorItem },
            },
            id_conta_debito: selectedConta.value,
          };
          return fetchCpag('/api/pagamentos/efetuar', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        }),
      );
      mostrarToast('Vale Alimentação pago com sucesso!', 'sucesso');
      setHistoricoCompleto((prev) => [
        ...prev,
        ...selecionados.map((item) => ({
          usuario_id: item.id,
          ciclo_nome: `VA ${mesSelecionado.value}`,
          descricao: `VA ${mesSelecionado.value}`,
        })),
      ]);
      setFolha((atual) =>
        atual.map((item) =>
          item.selecionado ? { ...item, selecionado: false, pago: true } : item,
        ),
      );
    } catch (error) {
      mostrarToast(error instanceof Error ? error.message : 'Erro ao processar.', 'erro');
    } finally {
      setLoading(false);
    }
  };

  const todosSelecionaveis = folha.filter((item) => !item.pago);
  const todosMarcados =
    todosSelecionaveis.length > 0 && selecionados.length === todosSelecionaveis.length;

  const destaquesOrdenados = useMemo(() => {
    const aberto = opcoesMes.find((m) => m.status === 'em_aberto');
    const pendente = opcoesMes.find((m) => m.status === 'pendente');
    const aPagar = opcoesMes.find((m) => m.status === 'a_pagar');
    const cards: CpagSalarioMesOption[] = [];
    if (aberto) cards.push(aberto);
    if (pendente) cards.push(pendente);
    if (aPagar) cards.push(aPagar);
    return cards;
  }, [opcoesMes]);

  const historicoMeses = opcoesMes.filter(
    (m) => !destaquesOrdenados.some((d) => d.value === m.value),
  );

  const classeCardMes = (mes: CpagSalarioMesOption): string => {
    if (mes.status === 'em_aberto') return 'atual';
    if (mes.status === 'a_pagar') return 'proximo_pagamento';
    if (mes.status === 'pendente') return 'sem_comissao';
    if (mes.status === 'pago') return 'pago';
    return 'pago';
  };

  const renderCardMes = (mes: CpagSalarioMesOption) => {
    const meta = statusMeta(mes.status);
    const selecionado = mesSelecionado?.value === mes.value;
    const mostrarVencido = mes.status === 'pendente' && mes.vencido;
    return (
      <button
        key={mes.value}
        type="button"
        className={`cpg-ciclo-card cpg-ciclo-card--${classeCardMes(mes)}${selecionado ? ' cpg-ciclo-card--ativo' : ''}${mostrarVencido ? ' cpg-ciclo-card--vencido' : ''}`}
        onClick={() => setMesSelecionado(mes)}
        aria-pressed={selecionado}
      >
        <span className="cpg-ciclo-card__selo">
          <i className={`fas ${meta.icone}`} aria-hidden="true" />
          {meta.titulo}
          {mostrarVencido ? ' · vencido' : ''}
        </span>
        <strong className="cpg-ciclo-card__nome">{mes.value}</strong>
        <span className="cpg-ciclo-card__periodo">{mes.periodoLabel}</span>
        <span className="cpg-ciclo-card__pagamento">
          <i className="fas fa-calendar-check" aria-hidden="true" />
          {mes.status === 'pago' ? (
            <>Pago em <strong>{mes.mesPagamentoLabel}</strong></>
          ) : (
            <>Pagamento em <strong>{mes.mesPagamentoLabel}</strong></>
          )}
        </span>
        <span className="cpg-ciclo-card__estado">
          {mes.status === 'pago' ? 'VA quitado' : mes.prazoLabel}
        </span>
      </button>
    );
  };

  return (
    <div className="cpg-card cpg-beneficios">
      <h2 className="cpg-section-title">Vale Alimentação (VA)</h2>

      <section className="cpg-competencias" aria-label="Referências de VA">
        <div className="cpg-competencias__cabecalho">
          <h3>Referência (mês corrido)</h3>
          <p>
            O VA cobre o <strong>mês corrido</strong> (1º ao último dia). Pagamento no{' '}
            <strong>dia 25</strong>; se não for útil, no <strong>próximo dia útil</strong> do
            calendário da empresa. A partir de <strong>Julho/2026</strong>.
          </p>
        </div>

        {!calendarioCarregado ? (
          <p className="cpg-competencias__classificando" role="status">
            <UICarregando variante="inline" /> Carregando calendário da empresa…
          </p>
        ) : (
          <>
            {destaquesOrdenados.length > 0 && (
              <div className="cpg-competencias__destaques">
                {destaquesOrdenados.map(renderCardMes)}
              </div>
            )}

            {historicoMeses.length > 0 && (
              <div className="cpg-competencias__historico">
                <button
                  type="button"
                  className="cpg-competencias__toggle"
                  onClick={() => setHistoricoAberto((v) => !v)}
                  aria-expanded={historicoAberto}
                >
                  <span>
                    <i className="fas fa-history" aria-hidden="true" /> Outras referências
                    <small>{historicoMeses.length}</small>
                  </span>
                  <i
                    className={`fas fa-chevron-${historicoAberto ? 'up' : 'down'}`}
                    aria-hidden="true"
                  />
                </button>
                {historicoAberto && (
                  <div className="cpg-competencias__lista">
                    {historicoMeses.map((mes) => {
                      const selecionado = mesSelecionado?.value === mes.value;
                      return (
                        <button
                          key={mes.value}
                          type="button"
                          className={`cpg-ciclo-chip${selecionado ? ' cpg-ciclo-chip--ativo' : ''}${mes.status === 'pendente' ? ' cpg-ciclo-chip--a-pagar' : ''}${mes.status === 'pago' ? ' cpg-ciclo-chip--pago' : ''}`}
                          onClick={() => setMesSelecionado(mes)}
                          aria-pressed={selecionado}
                        >
                          <strong>{mes.value}</strong>
                          <span>{mes.periodoLabel}</span>
                          <span className="cpg-ciclo-chip__pagamento">
                            Pgto {mes.mesPagamentoCurto}
                          </span>
                          <em>{rotuloChipMes(mes)}</em>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {mesSelecionado && (
        <>
          {pagamentoBloqueado && (
            <div className="cpg-alerta-ciclo-aberto" role="status">
              <i className="fas fa-hourglass-half" aria-hidden="true" />
              <div>
                <strong>Referência futura</strong>
                <p>{mensagemBloqueio}</p>
              </div>
            </div>
          )}

          {mesSelecionado.status === 'pendente' && !pagamentoBloqueado && (
            <div className="cpg-alerta-salario-vencido" role="status">
              <i className="fas fa-exclamation-triangle" aria-hidden="true" />
              <div>
                <strong>VA pendente (prazo vencido)</strong>
                <p>
                  Referência <strong>{mesSelecionado.value}</strong> — data prevista era{' '}
                  <strong>{mesSelecionado.mesPagamentoLabel}</strong> ({mesSelecionado.prazoLabel}).
                  O pagamento continua liberado.
                </p>
              </div>
            </div>
          )}

          <div className="cpg-form-row" style={{ alignItems: 'flex-end' }}>
            <div className="cpg-form-group">
              <label>Valor padrão (R$)</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="number"
                  className="cpg-input"
                  value={valorPadrao}
                  onChange={(event) => setValorPadrao(event.target.value)}
                  disabled={pagamentoBloqueado}
                />
                <button
                  type="button"
                  className="cpg-btn cpg-btn-secundario"
                  onClick={aplicarValorPadrao}
                  title="Aplicar a todos"
                  disabled={pagamentoBloqueado}
                >
                  <i className="fas fa-sync-alt" />
                </button>
              </div>
            </div>
            <div className="cpg-form-group" style={{ minWidth: '220px', flex: 1 }}>
              <label>Conta de saída</label>
              <Select
                options={contaOptions}
                value={selectedConta}
                onChange={setSelectedConta}
                placeholder="Selecione..."
                isDisabled={pagamentoBloqueado}
              />
            </div>
            <div className="cpg-form-group">
              <div className="cpg-salario-total-box">
                <small>Total selecionado · {mesSelecionado.value}</small>
                <div className="cpg-salario-total-valor">{formatarMoeda(totalPagar)}</div>
                <small className="cpg-salario-total-prazo">{mesSelecionado.prazoLabel}</small>
              </div>
            </div>
          </div>

          <div className="cpg-tabela-container" style={{ marginTop: '16px' }}>
            <table className="cpg-tabela-detalhes">
              <thead>
                <tr>
                  <th style={{ textAlign: 'center', width: '40px' }}>
                    <input
                      type="checkbox"
                      onChange={(event) =>
                        setFolha((atual) =>
                          atual.map((item) =>
                            item.pago ? item : { ...item, selecionado: event.target.checked },
                          ),
                        )
                      }
                      checked={todosMarcados}
                      disabled={pagamentoBloqueado}
                    />
                  </th>
                  <th>Empregado</th>
                  <th>Valor (R$)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {folha.map((item) => (
                  <tr
                    key={item.id}
                    style={{
                      opacity: item.pago ? 0.55 : 1,
                      background: item.selecionado && !item.pago ? '#f0f8ff' : 'transparent',
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={item.selecionado}
                        disabled={item.pago || pagamentoBloqueado}
                        onChange={() =>
                          alterarItem(item.id, (atual) => ({
                            ...atual,
                            selecionado: !atual.selecionado,
                          }))
                        }
                      />
                    </td>
                    <td>{item.nome}</td>
                    <td>
                      <input
                        type="number"
                        className="cpg-input"
                        style={{
                          width: '110px',
                          textAlign: 'right',
                          padding: '8px',
                          fontWeight: 'bold',
                        }}
                        value={item.valor}
                        disabled={item.pago || pagamentoBloqueado}
                        onChange={(event) =>
                          alterarItem(item.id, (atual) => ({
                            ...atual,
                            valor: event.target.value,
                          }))
                        }
                      />
                    </td>
                    <td>
                      {item.pago ? (
                        <span className="cpg-status-pago">PAGO</span>
                      ) : mesSelecionado.status === 'pendente' ? (
                        <span className="cpg-status-pendente">PENDENTE</span>
                      ) : mesSelecionado.status === 'em_aberto' ? (
                        <span className="cpg-status-aberto">EM ABERTO</span>
                      ) : (
                        <span className="cpg-status-apagar">A PAGAR</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="cpg-btn cpg-btn-primario"
            style={{ width: '100%', marginTop: '20px', height: '50px' }}
            onClick={() => void handleProcessar()}
            disabled={loading || !selecionados.length || pagamentoBloqueado}
            title={pagamentoBloqueado ? mensagemBloqueio : ''}
          >
            {loading
              ? 'Processando...'
              : pagamentoBloqueado
                ? 'Aguardando início do mês'
                : `Pagar selecionados (${selecionados.length})`}
          </button>
        </>
      )}
    </div>
  );
}
