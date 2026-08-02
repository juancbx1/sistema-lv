import { useEffect, useMemo, useState } from 'react';
import Select from 'react-select';
import { formatarMoeda } from '../utils/cpag-format';
import { mostrarConfirmacao, mostrarToast } from '../utils/cpag-feedback';
import { fetchCpag } from '../utils/cpag-api';
import type {
  CpagContaFinanceira,
  CpagFolhaSalarioItem,
  CpagHistoricoPagamento,
  CpagPayloadEfetuar,
  CpagRespostaEfetuar,
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

function idsIguais(a: number | string, b: number | string): boolean {
  return String(a) === String(b);
}

/** Último instante do mês (dia final, 23:59:59). */
function fimDoMes(mesIndex: number, ano: number): Date {
  return new Date(ano, mesIndex + 1, 0, 23, 59, 59, 999);
}

function periodoLabelMes(mesIndex: number, ano: number): string {
  const ultimo = new Date(ano, mesIndex + 1, 0).getDate();
  return `01/${MESES_CURTO[mesIndex]} – ${String(ultimo).padStart(2, '0')}/${MESES_CURTO[mesIndex]}`;
}

/**
 * 5º dia útil (seg–sex) do mês indicado.
 * Não considera feriados — regra de fábrica simplificada.
 */
function quintoDiaUtil(mesIndex: number, ano: number): Date {
  let dia = 1;
  let uteis = 0;
  let ultimoUteis: Date = new Date(ano, mesIndex, 1, 23, 59, 59, 999);
  while (uteis < 5) {
    const d = new Date(ano, mesIndex, dia, 12, 0, 0, 0);
    if (d.getMonth() !== mesIndex) break;
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      uteis += 1;
      ultimoUteis = new Date(ano, mesIndex, dia, 23, 59, 59, 999);
    }
    dia += 1;
  }
  return ultimoUteis;
}

function mesPagamentoSalario(mesIndex: number, ano: number): {
  mesIndex: number;
  ano: number;
  mesPagamentoLabel: string;
  mesPagamentoCurto: string;
  prazoLabel: string;
  prazoLimite: Date;
} {
  let mesPag = mesIndex + 1;
  let anoPag = ano;
  if (mesPag > 11) {
    mesPag = 0;
    anoPag += 1;
  }
  const prazoLimite = quintoDiaUtil(mesPag, anoPag);
  return {
    mesIndex: mesPag,
    ano: anoPag,
    mesPagamentoLabel: `${MESES_PT[mesPag]}/${anoPag}`,
    mesPagamentoCurto: `${MESES_CURTO[mesPag]}/${anoPag}`,
    prazoLabel: `até o 5º dia útil de ${MESES_CURTO[mesPag]}/${anoPag}`,
    prazoLimite,
  };
}

/**
 * Marco do módulo de folha neste sistema: a partir de Julho/2026
 * (pagamento previsto em agosto). Meses anteriores não entram na UI.
 */
const INICIO_FOLHA_MES = 6; // julho (0-index)
const INICIO_FOLHA_ANO = 2026;

function mesAntesDoInicioFolha(mesIndex: number, ano: number): boolean {
  if (ano < INICIO_FOLHA_ANO) return true;
  if (ano > INICIO_FOLHA_ANO) return false;
  return mesIndex < INICIO_FOLHA_MES;
}

/**
 * Gera referências de salário (mês corrido).
 * Do mês atual para trás, parando em Julho/2026.
 */
function gerarMesesSalario(agora = new Date()): CpagSalarioMesOption[] {
  const lista: CpagSalarioMesOption[] = [];
  let mes = agora.getMonth();
  let ano = agora.getFullYear();

  for (let i = 0; i < 24; i += 1) {
    if (mesAntesDoInicioFolha(mes, ano)) break;

    const fim = fimDoMes(mes, ano);
    const mesFechado = agora > fim;
    const pag = mesPagamentoSalario(mes, ano);
    const vencido = mesFechado && agora > pag.prazoLimite;
    const value = `${MESES_PT[mes]}/${ano}`;

    let status: CpagSalarioMesStatus = 'historico';
    if (!mesFechado) status = 'em_aberto';
    else if (vencido) status = 'pendente';
    else status = 'a_pagar';

    lista.push({
      value,
      label: value,
      mesIndex: mes,
      ano,
      mesFechado,
      vencido,
      status,
      periodoLabel: periodoLabelMes(mes, ano),
      mesPagamentoLabel: pag.mesPagamentoLabel,
      mesPagamentoCurto: pag.mesPagamentoCurto,
      prazoLabel: pag.prazoLabel,
    });

    mes -= 1;
    if (mes < 0) {
      mes = 11;
      ano -= 1;
    }
  }

  return lista;
}

/**
 * Reclassifica meses com base no histórico real de pagamentos.
 * Mês com todos os elegíveis (salário > 0) pagos → "pago" (some o "pendente vencido").
 */
function classificarMesesComHistorico(
  meses: CpagSalarioMesOption[],
  historico: CpagHistoricoPagamento[],
  usuarios: CpagUsuario[],
): CpagSalarioMesOption[] {
  const elegiveis = usuarios.filter((u) => Number(u.salario_fixo) > 0);
  const alvo = elegiveis.length > 0 ? elegiveis : usuarios;

  return meses.map((m) => {
    if (!m.mesFechado) {
      return { ...m, status: 'em_aberto' as const, vencido: false };
    }

    const pagosNoMes = historico.filter((h) => historicoEhSalarioDaRef(h, m.value));
    const idsPagos = new Set(pagosNoMes.map((h) => String(h.usuario_id)));
    const todosPagos =
      alvo.length > 0 && alvo.every((u) => idsPagos.has(String(u.id)));
    const algumPago = idsPagos.size > 0;

    if (todosPagos) {
      return { ...m, status: 'pago' as const, vencido: false };
    }

    // Folha parcial: ainda conta como a pagar / pendente, não como pago no card
    if (m.vencido) {
      return { ...m, status: 'pendente' as const, vencido: true };
    }
    return { ...m, status: 'a_pagar' as const, vencido: false, /* algumPago no futuro se precisar */ };
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
  if (mes.status === 'em_aberto' || !mes.mesFechado) return 'Em aberto';
  if (mes.status === 'pendente' || mes.vencido) return 'Pendente';
  return 'A pagar';
}

/**
 * Casa histórico com a referência "Junho/2026".
 * Aceita ciclo_nome e/ou descrição legados (salário às vezes gravava só em descricao).
 */
function historicoEhSalarioDaRef(item: CpagHistoricoPagamento, ref: string): boolean {
  const ciclo = String(item.ciclo_nome || '');
  const desc = String(item.descricao || '');
  const cicloL = ciclo.toLowerCase();
  const descL = desc.toLowerCase();
  const refL = ref.toLowerCase();

  // Formato novo preferido: ciclo_nome = "Salário Junho/2026"
  if (ciclo === `Salário ${ref}` || ciclo === ref) return true;
  if (cicloL.includes('salário') && ciclo.includes(ref)) return true;
  if (cicloL.includes('salario') && ciclo.includes(ref)) return true;

  // Legado: só descrição
  if (desc === `Salário ${ref}` || desc.includes(`Salário ${ref}`)) return true;
  if (descL.includes('salário') && desc.includes(ref)) return true;
  if (descL.includes('salario') && desc.includes(ref)) return true;
  // "Pagamento de Salário (Salário Junho/2026) para ..."
  if (desc.includes(ref) && (descL.includes('salário') || descL.includes('salario'))) return true;

  return false;
}

export default function CPAGSalario({ usuarios, contas }: Props) {
  const mesesBase = useMemo(() => gerarMesesSalario(), []);
  const [historicoCompleto, setHistoricoCompleto] = useState<CpagHistoricoPagamento[]>([]);
  const opcoesMes = useMemo(
    () => classificarMesesComHistorico(mesesBase, historicoCompleto, usuarios),
    [mesesBase, historicoCompleto, usuarios],
  );

  const [mesSelecionado, setMesSelecionado] = useState<CpagSalarioMesOption | null>(null);
  const [selectedConta, setSelectedConta] = useState<CpagSelectOption | null>(null);
  const [folha, setFolha] = useState<CpagFolhaSalarioItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  // Mantém seleção válida quando a lista/reclassificação muda
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
        console.error('Erro ao buscar histórico de salários', error);
      }
    };
    void carregar();
    return () => {
      ativo = false;
    };
  }, []);

  const historicoDaRef = useMemo(() => {
    if (!mesSelecionado) return [];
    return historicoCompleto.filter((item) =>
      historicoEhSalarioDaRef(item, mesSelecionado.value),
    );
  }, [historicoCompleto, mesSelecionado]);

  useEffect(() => {
    setFolha(
      usuarios.map((usuario) => {
        const base = Number(usuario.salario_fixo) || 0;
        const pINSS = Number(usuario.desconto_inss_percentual) || 0;
        const pVT = Number(usuario.desconto_vt_percentual) || 0;
        const inss = base * (pINSS / 100);
        const vt = base * (pVT / 100);
        const liquido = base - inss - vt;
        const pago = historicoDaRef.some((item) => idsIguais(item.usuario_id, usuario.id));
        return {
          id: usuario.id,
          nome: usuario.nome,
          base,
          inss,
          vt,
          liquidoFinal: liquido.toFixed(2),
          selecionado: !pago,
          pago,
        };
      }),
    );
  }, [usuarios, historicoDaRef]);

  const mesEmAberto = Boolean(mesSelecionado && !mesSelecionado.mesFechado);
  const pagamentoBloqueado = mesEmAberto;
  const mensagemBloqueio = mesEmAberto
    ? 'Este mês ainda está em aberto. O pagamento da folha só é liberado após o último dia do mês.'
    : '';

  const selecionados = folha.filter((item) => item.selecionado && !item.pago);
  const totalPagar = selecionados.reduce(
    (total, item) => total + (Number.parseFloat(item.liquidoFinal) || 0),
    0,
  );
  const alterarItem = (
    id: number | string,
    alterar: (item: CpagFolhaSalarioItem) => CpagFolhaSalarioItem,
  ) => setFolha((atual) => atual.map((item) => (item.id === id ? alterar(item) : item)));

  const handleProcessarFolha = async () => {
    if (!mesSelecionado) {
      mostrarToast('Selecione a referência do mês.', 'aviso');
      return;
    }
    if (pagamentoBloqueado) {
      mostrarToast(mensagemBloqueio, 'aviso');
      return;
    }
    if (!selectedConta) {
      mostrarToast('Selecione a conta de débito.', 'aviso');
      return;
    }
    if (!selecionados.length) {
      mostrarToast('Selecione pelo menos um empregado.', 'aviso');
      return;
    }
    const confirmado = await mostrarConfirmacao(
      `Confirma o pagamento da folha para <strong>${selecionados.length} empregados</strong>?<br><br>Total: <strong>${formatarMoeda(totalPagar)}</strong><br>Ref: ${mesSelecionado.value}<br><small>Pagamento previsto: ${mesSelecionado.mesPagamentoLabel} (${mesSelecionado.prazoLabel})</small>`,
      { tipo: 'aviso', textoConfirmar: 'Confirmar Folha' },
    );
    if (!confirmado) return;

    setLoading(true);
    try {
      await Promise.all(
        selecionados.map(async (item) => {
          const valorFinal = Number.parseFloat(item.liquidoFinal) || 0;
          const payload: CpagPayloadEfetuar = {
            calculo: {
              detalhes: {
                funcionario: { id: item.id, nome: item.nome },
                ciclo: { nome: `Salário ${mesSelecionado.value}` },
                tipoPagamento: 'SALARIO',
              },
              proventos: {
                salarioProporcional: item.base,
                comissao: 0,
                valeTransporte: 0,
                beneficios: 0,
              },
              descontos: { inss: item.inss, valeTransporte: item.vt },
              totais: { totalLiquidoAPagar: valorFinal },
            },
            id_conta_debito: selectedConta.value,
          };
          await fetchCpag<CpagRespostaEfetuar>('/api/pagamentos/efetuar', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        }),
      );
      mostrarToast('Folha de pagamento processada com sucesso!', 'sucesso');
      // Atualiza histórico local para marcar pagos
      setHistoricoCompleto((prev) => [
        ...prev,
        ...selecionados.map((item) => ({
          usuario_id: item.id,
          ciclo_nome: `Salário ${mesSelecionado.value}`,
          descricao: `Salário ${mesSelecionado.value}`,
        })),
      ]);
      setFolha((atual) =>
        atual.map((item) =>
          item.selecionado ? { ...item, selecionado: false, pago: true } : item,
        ),
      );
    } catch (error) {
      console.error(error);
      mostrarToast(
        error instanceof Error
          ? error.message
          : 'Erro ao processar alguns pagamentos. Verifique o console.',
        'erro',
      );
    } finally {
      setLoading(false);
    }
  };

  const todosSelecionaveis = folha.filter((item) => !item.pago);
  const todosMarcados =
    todosSelecionaveis.length > 0 && selecionados.length === todosSelecionaveis.length;

  // Destaques: em aberto + pendente (vencido não pago) + a pagar
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
          {mes.status === 'pago'
            ? 'Folha quitada'
            : mes.mesFechado
              ? `Prazo: ${mes.prazoLabel}`
              : 'Mês em curso'}
        </span>
      </button>
    );
  };

  return (
    <div className="cpg-card cpg-salario">
      <h2 className="cpg-section-title">Folha de Pagamento Mensal</h2>

      <section className="cpg-competencias" aria-label="Referências de salário">
        <div className="cpg-competencias__cabecalho">
          <h3>Referência (mês corrido)</h3>
          <p>
            O salário cobre do <strong>dia 1º ao último dia</strong> do mês. O pagamento deve
            ocorrer <strong>até o 5º dia útil do mês seguinte</strong>. Folha a partir de{' '}
            <strong>Julho/2026</strong> (pagamento em agosto). Após o mês fechar, pode pagar a
            qualquer dia.
          </p>
        </div>

        {destaquesOrdenados.length > 0 && (
          <div className="cpg-competencias__destaques">{destaquesOrdenados.map(renderCardMes)}</div>
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
                      className={`cpg-ciclo-chip${selecionado ? ' cpg-ciclo-chip--ativo' : ''}${mes.vencido ? ' cpg-ciclo-chip--a-pagar' : ''}`}
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
      </section>

      {mesSelecionado && (
        <>
          {pagamentoBloqueado && (
            <div className="cpg-alerta-ciclo-aberto" role="status">
              <i className="fas fa-hourglass-half" aria-hidden="true" />
              <div>
                <strong>Mês em aberto</strong>
                <p>{mensagemBloqueio}</p>
              </div>
            </div>
          )}

          {mesSelecionado.status === 'pendente' && !pagamentoBloqueado && (
            <div className="cpg-alerta-salario-vencido" role="status">
              <i className="fas fa-exclamation-triangle" aria-hidden="true" />
              <div>
                <strong>Folha pendente (prazo vencido)</strong>
                <p>
                  Referência <strong>{mesSelecionado.value}</strong> — prazo era{' '}
                  {mesSelecionado.prazoLabel}. O pagamento continua liberado.
                </p>
              </div>
            </div>
          )}

          <div className="cpg-form-row" style={{ alignItems: 'flex-end' }}>
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
                  <th>Salário base</th>
                  <th>(-) INSS</th>
                  <th>(-) VT</th>
                  <th>Líquido (editável)</th>
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
                    <td>{formatarMoeda(item.base)}</td>
                    <td style={{ color: '#e74c3c' }}>{formatarMoeda(item.inss)}</td>
                    <td style={{ color: '#e74c3c' }}>{formatarMoeda(item.vt)}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        className="cpg-input"
                        style={{
                          width: '110px',
                          textAlign: 'right',
                          padding: '8px',
                          fontWeight: 'bold',
                        }}
                        value={item.liquidoFinal}
                        disabled={item.pago || pagamentoBloqueado}
                        onChange={(event) =>
                          alterarItem(item.id, (atual) => ({
                            ...atual,
                            liquidoFinal: event.target.value,
                          }))
                        }
                      />
                    </td>
                    <td>
                      {item.pago ? (
                        <span className="cpg-status-pago">PAGO</span>
                      ) : mesSelecionado.status === 'pendente' ? (
                        <span className="cpg-status-pendente">PENDENTE</span>
                      ) : mesEmAberto ? (
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
            style={{ width: '100%', marginTop: '20px', height: '50px', fontSize: '1.1rem' }}
            onClick={() => void handleProcessarFolha()}
            disabled={loading || !selecionados.length || pagamentoBloqueado}
            title={pagamentoBloqueado ? mensagemBloqueio : ''}
          >
            {loading
              ? 'Processando...'
              : pagamentoBloqueado
                ? 'Aguardando fechamento do mês'
                : `Confirmar pagamento (${selecionados.length})`}
          </button>
        </>
      )}
    </div>
  );
}
