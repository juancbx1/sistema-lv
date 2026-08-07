import { useState, useEffect, useMemo, useCallback } from 'react';
import Select, { components, type NoticeProps } from 'react-select';
import type {
  CpagCicloOption,
  CpagCicloStatus,
  CpagContaFinanceira,
  CpagHistoricoPagamento,
  CpagPayloadEfetuar,
  CpagRespostaEfetuar,
  CpagResultadoCalculo,
  CpagSelectOption,
  CpagUsuario,
} from '../utils/cpag-types';
import { formatarMoeda } from '../utils/cpag-format';
import { mostrarConfirmacao, mostrarToast } from '../utils/cpag-feedback';
import { fetchCpag } from '../utils/cpag-api';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UICarregando from './UICarregando';
import CPAGModalReciboComissao from './CPAGModalReciboComissao';
import type { CpagIntervaloReciboEmpresa } from '../utils/cpag-types';
import {
  diasCobertosPorIntervalos,
  listarSemanasFechadas,
  ultimaSemanaFechada,
} from '../utils/cpag-recibos';

/** Nomes alinhados ao backend (`api/pagamentos.js`). */
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

/** Corte operacional do sistema de comissões (igual à API). */
const DATA_CORTE_COMISSAO = new Date(2025, 11, 13, 0, 0, 0, 0);

function CustomNoOptions<Option>(props: NoticeProps<Option, false>) {
  return (
    <components.NoOptionsMessage {...props}>
      <div style={{ padding: '10px' }}>
        <UIFeedbackNotFound
          icon="fa-search"
          titulo="Sem resultados"
          mensagem="Nenhum registro encontrado."
        />
      </div>
    </components.NoOptionsMessage>
  );
}

function idsIguais(a: number | string, b: number | string): boolean {
  return String(a) === String(b);
}

function parseDataAdmissao(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const iso = String(valor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const data = new Date(`${iso}T12:00:00`);
  return Number.isNaN(data.getTime()) ? null : data;
}

/** Competência "Junho/2026" = 21/mai → 20/jun. */
function periodoCompetencia(mesIndex: number, ano: number): { inicio: Date; fim: Date } {
  let mesInicio = mesIndex - 1;
  let anoInicio = ano;
  if (mesInicio < 0) {
    mesInicio = 11;
    anoInicio -= 1;
  }
  return {
    inicio: new Date(anoInicio, mesInicio, 21, 0, 0, 0, 0),
    fim: new Date(ano, mesIndex, 20, 23, 59, 59, 999),
  };
}

function formatarPeriodoLabel(mesIndex: number, ano: number): string {
  const { inicio, fim } = periodoCompetencia(mesIndex, ano);
  const di = inicio.getDate();
  const mi = MESES_CURTO[inicio.getMonth()];
  const df = fim.getDate();
  const mf = MESES_CURTO[fim.getMonth()];
  return `${di}/${mi} – ${df}/${mf}`;
}

/**
 * Previsão de pagamento: mês seguinte ao fechamento do ciclo (dia 20).
 * Ex.: ciclo 21/jun–20/jul/2026 → Agosto/2026. O dia exato fica a cargo da gerência.
 */
function mesPagamentoPrevisto(mesIndex: number, ano: number): {
  mesPagamentoLabel: string;
  mesPagamentoCurto: string;
} {
  let mes = mesIndex + 1;
  let anoPag = ano;
  if (mes > 11) {
    mes = 0;
    anoPag += 1;
  }
  return {
    mesPagamentoLabel: `${MESES_PT[mes]}/${anoPag}`,
    mesPagamentoCurto: `${MESES_CURTO[mes]}/${anoPag}`,
  };
}

/**
 * Gera competências do empregado:
 * - a partir da admissão (e do corte de dez/2025);
 * - até o ciclo atual (se dia ≥ 21, inclui o próximo mês-nome);
 * - marca pago / fechado / status de destaque.
 */
function gerarCompetencias(
  usuario: CpagUsuario | undefined,
  historico: CpagHistoricoPagamento[],
  usuarioId: number | string,
): CpagCicloOption[] {
  const hoje = new Date();
  const diaHoje = hoje.getDate();

  // Cursor = competência "de referência" (mês-nome do ciclo em andamento ou o que começa no dia 21)
  let cursorMes = hoje.getMonth();
  let cursorAno = hoje.getFullYear();
  if (diaHoje >= 21) {
    cursorMes += 1;
    if (cursorMes > 11) {
      cursorMes = 0;
      cursorAno += 1;
    }
  }

  const admissao = parseDataAdmissao(usuario?.data_admissao);
  const opcoes: CpagCicloOption[] = [];

  // Segurança: no máximo ~36 competências para trás
  for (let i = 0; i < 36; i += 1) {
    const mesIndex = cursorMes;
    const ano = cursorAno;
    const { inicio, fim } = periodoCompetencia(mesIndex, ano);

    // Abaixo do corte global do sistema
    if (fim < DATA_CORTE_COMISSAO) break;

    // Indo do presente para o passado: se o ciclo já terminou antes da admissão,
    // este e todos os mais antigos ficam de fora.
    if (admissao && admissao > fim) break;

    // Admissão no meio do ciclo (ex.: dia 20 no fechamento) ainda entra — ciclo parcial.

    const valorCompetencia = `${MESES_PT[mesIndex]}/${ano}`;
    const jaFoiPago = historico.some(
      (p) => idsIguais(p.usuario_id, usuarioId) && p.ciclo_nome === valorCompetencia,
    );
    const cicloFechado = hoje > fim;
    const pagamento = mesPagamentoPrevisto(mesIndex, ano);

    opcoes.push({
      value: valorCompetencia,
      label: valorCompetencia,
      jaFoiPago,
      mesIndex,
      ano,
      cicloFechado,
      status: 'historico', // classificado depois
      periodoLabel: formatarPeriodoLabel(mesIndex, ano),
      mesPagamentoLabel: pagamento.mesPagamentoLabel,
      mesPagamentoCurto: pagamento.mesPagamentoCurto,
      valorComissao: null,
    });

    cursorMes -= 1;
    if (cursorMes < 0) {
      cursorMes = 11;
      cursorAno -= 1;
    }
  }

  return classificarCompetencias(opcoes);
}

/**
 * Classifica destaques:
 * 1) Ciclo atual (em aberto)
 * 2) Próximo pagamento = fechado + não pago + valor > 0 (mais recente)
 * 3) Sem comissão = fechado + não pago + valor 0
 * 4) Pago
 */
function classificarCompetencias(opcoes: CpagCicloOption[]): CpagCicloOption[] {
  let marcouAtual = false;
  let marcouProximo = false;

  return opcoes.map((opcao) => {
    if (!opcao.cicloFechado && !marcouAtual) {
      marcouAtual = true;
      return { ...opcao, status: 'atual' as const };
    }

    if (opcao.jaFoiPago) {
      return { ...opcao, status: 'pago' as const };
    }

    if (opcao.cicloFechado && !opcao.jaFoiPago) {
      const valor = opcao.valorComissao;
      // Sem valor calculado ainda: fica genérico até o enriquecimento
      if (valor === null || valor === undefined) {
        if (!marcouProximo) {
          marcouProximo = true;
          return { ...opcao, status: 'proximo_pagamento' as const };
        }
        return { ...opcao, status: 'historico' as const };
      }
      if (valor <= 0) {
        return { ...opcao, status: 'sem_comissao' as const };
      }
      if (!marcouProximo) {
        marcouProximo = true;
        return { ...opcao, status: 'proximo_pagamento' as const };
      }
      return { ...opcao, status: 'historico' as const };
    }

    return { ...opcao, status: 'historico' as const };
  });
}

async function buscarValorComissao(
  usuarioId: number | string,
  competencia: string,
): Promise<number> {
  const params = new URLSearchParams({
    usuario_id: String(usuarioId),
    competencia,
    tipo_pagamento: 'COMISSAO',
  });
  const data = await fetchCpag<CpagResultadoCalculo>(
    `/api/pagamentos/calcular?${params.toString()}`,
  );
  return Number(data?.proventos?.comissao) || 0;
}

function statusMeta(status: CpagCicloStatus): { titulo: string; icone: string } {
  switch (status) {
    case 'atual':
      return { titulo: 'Ciclo atual', icone: 'fa-spinner' };
    case 'proximo_pagamento':
      return { titulo: 'Próximo pagamento', icone: 'fa-wallet' };
    case 'sem_comissao':
      return { titulo: 'Sem comissão', icone: 'fa-circle-minus' };
    case 'pago':
      return { titulo: 'Pago', icone: 'fa-check-circle' };
    default:
      return { titulo: 'Competência', icone: 'fa-calendar' };
  }
}

function rotuloEstadoCiclo(ciclo: CpagCicloOption): string {
  if (ciclo.jaFoiPago) return 'Pago';
  if (!ciclo.cicloFechado) return 'Em aberto';
  if (ciclo.status === 'sem_comissao' || (ciclo.valorComissao != null && ciclo.valorComissao <= 0)) {
    return 'Sem comissão';
  }
  if (ciclo.valorComissao != null && ciclo.valorComissao > 0) {
    return 'Fechado · pode pagar';
  }
  return 'Fechado';
}

function rotuloChipCiclo(ciclo: CpagCicloOption): string {
  if (ciclo.jaFoiPago) return 'Pago';
  if (!ciclo.cicloFechado) return 'Aberto';
  if (ciclo.status === 'sem_comissao' || (ciclo.valorComissao != null && ciclo.valorComissao <= 0)) {
    return 'Sem comissão';
  }
  if (ciclo.valorComissao != null && ciclo.valorComissao > 0) {
    return 'A pagar';
  }
  return '…';
}

interface Props {
  usuarios: CpagUsuario[];
  contas: CpagContaFinanceira[];
}

export default function CPAGComissao({ usuarios, contas }: Props) {
  const [cicloSelecionado, setCicloSelecionado] = useState<CpagCicloOption | null>(null);
  const [opcoesCiclo, setOpcoesCiclo] = useState<CpagCicloOption[]>([]);
  const [resultadoCalculo, setResultadoCalculo] = useState<CpagResultadoCalculo | null>(null);
  const [historicoPagamentos, setHistoricoPagamentos] = useState<CpagHistoricoPagamento[]>([]);
  const [modalReciboAberto, setModalReciboAberto] = useState(false);
  const [contaId, setContaId] = useState('');
  const [loadingCalculo, setLoadingCalculo] = useState(false);
  const [loadingPagamento, setLoadingPagamento] = useState(false);
  const [selectedUser, setSelectedUser] = useState<CpagSelectOption | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [classificandoCiclos, setClassificandoCiclos] = useState(false);
  const [recibosPendentesUltimaSemana, setRecibosPendentesUltimaSemana] = useState(0);
  const [labelUltimaSemanaRecibo, setLabelUltimaSemanaRecibo] = useState('');

  const userOptions = useMemo(
    () => usuarios.map((u) => ({ value: u.id, label: u.nome })),
    [usuarios],
  );

  const usuarioSelecionado = useMemo(
    () =>
      selectedUser
        ? usuarios.find((u) => idsIguais(u.id, selectedUser.value))
        : undefined,
    [usuarios, selectedUser],
  );

  useEffect(() => {
    async function fetchHistorico() {
      try {
        const data = await fetchCpag<CpagHistoricoPagamento[]>('/api/pagamentos/historico');
        setHistoricoPagamentos(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
      }
    }
    void fetchHistorico();
  }, []);

  /**
   * Badge = soma de semanas fechadas pendentes de TODOS os empregados elegíveis
   * (não o número de usuários). Ex.: 12 + 20 = 32.
   */
  const atualizarBadgeRecibos = useCallback(async () => {
    if (!usuarios.length) {
      setRecibosPendentesUltimaSemana(0);
      setLabelUltimaSemanaRecibo('');
      return;
    }
    try {
      const semana = ultimaSemanaFechada();
      setLabelUltimaSemanaRecibo(semana.label);

      const intervalos = await fetchCpag<CpagIntervaloReciboEmpresa[]>(
        '/api/pagamentos/recibos/intervalos-empresa',
      );
      const porUsuario = new Map<string, CpagIntervaloReciboEmpresa[]>();
      for (const item of Array.isArray(intervalos) ? intervalos : []) {
        const chave = String(item.usuario_id);
        const lista = porUsuario.get(chave) ?? [];
        lista.push(item);
        porUsuario.set(chave, lista);
      }

      let totalSemanasPendentes = 0;
      for (const usuario of usuarios) {
        const intervalosUsuario = porUsuario.get(String(usuario.id)) ?? [];
        const diasCobertos = diasCobertosPorIntervalos(intervalosUsuario);
        const semanas = listarSemanasFechadas({
          maxSemanas: 52,
          dataAdmissao: usuario.data_admissao,
          diasCobertos,
        });
        totalSemanasPendentes += semanas.filter((s) => !s.gerado).length;
      }

      setRecibosPendentesUltimaSemana(totalSemanasPendentes);
    } catch (err) {
      console.error(err);
      setRecibosPendentesUltimaSemana(0);
    }
  }, [usuarios]);

  useEffect(() => {
    void atualizarBadgeRecibos();
  }, [atualizarBadgeRecibos]);

  useEffect(() => {
    if (!selectedUser) {
      setOpcoesCiclo([]);
      setCicloSelecionado(null);
      setResultadoCalculo(null);
      setHistoricoAberto(false);
      setClassificandoCiclos(false);
      return;
    }

    let cancelado = false;

    async function montarEClassificar() {
      const base = gerarCompetencias(
        usuarioSelecionado,
        historicoPagamentos,
        selectedUser!.value,
      );
      setOpcoesCiclo(base);
      setCicloSelecionado(
        base.find((c) => c.status === 'proximo_pagamento') ||
          base.find((c) => c.status === 'atual') ||
          base[0] ||
          null,
      );

      // Enriquecer ciclos fechados e não pagos com o valor real da comissão
      const pendentes = base.filter((c) => c.cicloFechado && !c.jaFoiPago);
      if (!pendentes.length) {
        setClassificandoCiclos(false);
        return;
      }

      setClassificandoCiclos(true);
      try {
        const valores = await Promise.all(
          pendentes.map(async (ciclo) => {
            try {
              const valor = await buscarValorComissao(selectedUser!.value, ciclo.value);
              return { value: ciclo.value, valor };
            } catch {
              // Em falha, assume 0 para não manter como "a pagar" falso
              return { value: ciclo.value, valor: 0 };
            }
          }),
        );
        if (cancelado) return;

        const mapa = new Map(valores.map((item) => [item.value, item.valor]));
        const enriquecidas = classificarCompetencias(
          base.map((ciclo) =>
            mapa.has(ciclo.value)
              ? { ...ciclo, valorComissao: mapa.get(ciclo.value) ?? 0 }
              : ciclo,
          ),
        );
        setOpcoesCiclo(enriquecidas);

        setCicloSelecionado((atual) => {
          const preferido =
            enriquecidas.find((c) => c.status === 'proximo_pagamento') ||
            enriquecidas.find((c) => c.status === 'atual') ||
            (atual ? enriquecidas.find((c) => c.value === atual.value) : null) ||
            enriquecidas[0] ||
            null;
          return preferido;
        });
      } finally {
        if (!cancelado) setClassificandoCiclos(false);
      }
    }

    void montarEClassificar();
    return () => {
      cancelado = true;
    };
  }, [selectedUser, historicoPagamentos, usuarioSelecionado]);

  useEffect(() => {
    if (!selectedUser || !cicloSelecionado) {
      setResultadoCalculo(null);
      return;
    }

    async function calcular() {
      setLoadingCalculo(true);
      try {
        const params = new URLSearchParams({
          usuario_id: String(selectedUser!.value),
          competencia: String(cicloSelecionado!.value),
          tipo_pagamento: 'COMISSAO',
        });

        const data = await fetchCpag<CpagResultadoCalculo>(
          `/api/pagamentos/calcular?${params.toString()}`,
        );
        setResultadoCalculo(data);
      } catch (err) {
        console.error(err);
        mostrarToast('Não foi possível calcular. Verifique as metas.', 'erro');
      } finally {
        setLoadingCalculo(false);
      }
    }
    void calcular();
  }, [selectedUser, cicloSelecionado]);

  // Pagamento liberado em qualquer dia, desde que o ciclo esteja fechado e não pago
  const cicloAberto = Boolean(cicloSelecionado && !cicloSelecionado.cicloFechado);
  const pagamentoBloqueado = cicloAberto;
  const mensagemBloqueio = cicloAberto
    ? 'Este ciclo ainda está em aberto. O pagamento só é liberado após o fechamento (dia 20).'
    : '';

  const handlePagar = async () => {
    if (!contaId) {
      mostrarToast('Selecione uma conta para débito.', 'aviso');
      return;
    }
    if (!resultadoCalculo || !selectedUser || !cicloSelecionado) return;
    if (!cicloSelecionado.cicloFechado) {
      mostrarToast(mensagemBloqueio, 'aviso');
      return;
    }

    const confirmado = await mostrarConfirmacao(
      `Confirma o pagamento de ${formatarMoeda(resultadoCalculo.proventos.comissao)}?`,
      { tipo: 'aviso', textoConfirmar: 'Pagar Agora' },
    );
    if (!confirmado) return;

    setLoadingPagamento(true);
    try {
      const payload: CpagPayloadEfetuar = {
        calculo: resultadoCalculo,
        id_conta_debito: Number.parseInt(contaId, 10),
      };

      const data = await fetchCpag<CpagRespostaEfetuar>('/api/pagamentos/efetuar', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      mostrarToast(data.message ?? 'Pagamento efetuado com sucesso!', 'sucesso');
      setResultadoCalculo(null);
      setHistoricoPagamentos((prev) => [
        ...prev,
        { usuario_id: selectedUser.value, ciclo_nome: String(cicloSelecionado.value) },
      ]);
    } catch (err) {
      mostrarToast(err instanceof Error ? err.message : 'Erro ao pagar comissão.', 'erro');
    } finally {
      setLoadingPagamento(false);
    }
  };

  const resumoSeguro = resultadoCalculo?.dadosDetalhados?.resumo || {
    totalProduzido: 0,
    totalResgatado: 0,
  };
  const diasSeguros = resultadoCalculo?.dadosDetalhados?.dias || [];

  const destaques = opcoesCiclo.filter(
    (c) => c.status === 'atual' || c.status === 'proximo_pagamento',
  );
  // Histórico: pagos, sem comissão e demais fechados sem destaque
  const historicoCiclos = opcoesCiclo.filter(
    (c) => c.status !== 'atual' && c.status !== 'proximo_pagamento',
  );

  const competenciaJaPaga = cicloSelecionado?.jaFoiPago;

  const renderTabelaDias = () => {
    if (diasSeguros.length === 0) {
      return <p style={{ textAlign: 'center', color: '#999' }}>Sem dados diários.</p>;
    }

    return (
      <div className="cpg-tabela-container">
        <table className="cpg-tabela-detalhes">
          <thead>
            <tr>
              <th>Data</th>
              <th style={{ textAlign: 'center' }}>Produção</th>
              <th style={{ textAlign: 'center' }}>Extras</th>
              <th style={{ textAlign: 'center' }}>Resgate</th>
              <th style={{ textAlign: 'center', backgroundColor: '#f0f0f0' }}>Total Dia</th>
              <th style={{ textAlign: 'center' }}>Meta</th>
              <th style={{ textAlign: 'right' }}>Comissão</th>
            </tr>
          </thead>
          <tbody>
            {diasSeguros.map((dia, idx) => (
              <tr key={idx}>
                <td>{dia.data}</td>
                <td style={{ textAlign: 'center' }}>{Math.round(dia.pontosProduzidos)}</td>
                <td
                  style={{
                    textAlign: 'center',
                    color: dia.pontosExtras > 0 ? '#27ae60' : '#ccc',
                  }}
                >
                  {dia.pontosExtras > 0 ? `+${Math.round(dia.pontosExtras)}` : '-'}
                </td>
                <td
                  style={{
                    textAlign: 'center',
                    color: dia.pontosResgatados > 0 ? '#27ae60' : '#ccc',
                  }}
                >
                  {dia.pontosResgatados > 0 ? `+${Math.round(dia.pontosResgatados)}` : '-'}
                </td>
                <td
                  style={{
                    textAlign: 'center',
                    fontWeight: 'bold',
                    backgroundColor: '#f9f9f9',
                  }}
                >
                  {Math.round(dia.totalPontos)}
                </td>
                <td style={{ textAlign: 'center' }}>{dia.meta}</td>
                <td
                  style={{
                    textAlign: 'right',
                    color: dia.valor > 0 ? '#27ae60' : '#999',
                    fontWeight: dia.valor > 0 ? 'bold' : 'normal',
                  }}
                >
                  {formatarMoeda(dia.valor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderCardCiclo = (ciclo: CpagCicloOption) => {
    const meta = statusMeta(ciclo.status);
    const selecionado = cicloSelecionado?.value === ciclo.value;
    return (
      <button
        key={ciclo.value}
        type="button"
        className={`cpg-ciclo-card cpg-ciclo-card--${ciclo.status}${selecionado ? ' cpg-ciclo-card--ativo' : ''}`}
        onClick={() => setCicloSelecionado(ciclo)}
        aria-pressed={selecionado}
      >
        <span className="cpg-ciclo-card__selo">
          <i className={`fas ${meta.icone}`} aria-hidden="true" />
          {meta.titulo}
        </span>
        <strong className="cpg-ciclo-card__nome">{ciclo.value}</strong>
        <span className="cpg-ciclo-card__periodo">{ciclo.periodoLabel}</span>
        <span className="cpg-ciclo-card__pagamento">
          <i className="fas fa-calendar-check" aria-hidden="true" />
          {ciclo.jaFoiPago ? (
            <>Pago em <strong>{ciclo.mesPagamentoLabel}</strong></>
          ) : (
            <>Pagamento em <strong>{ciclo.mesPagamentoLabel}</strong></>
          )}
        </span>
        <span className="cpg-ciclo-card__estado">{rotuloEstadoCiclo(ciclo)}</span>
        {ciclo.status === 'proximo_pagamento' &&
          ciclo.valorComissao != null &&
          ciclo.valorComissao > 0 && (
            <span className="cpg-ciclo-card__valor">{formatarMoeda(ciclo.valorComissao)}</span>
          )}
      </button>
    );
  };

  return (
    <div className="cpg-card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          borderBottom: '1px solid #e9ecef',
          paddingBottom: '10px',
        }}
      >
        <h2 className="cpg-section-title" style={{ border: 'none', margin: 0, padding: 0 }}>
          Cálculo de Comissão por Ciclo
        </h2>
        <button
          type="button"
          className="cpg-btn cpg-btn-secundario cpg-btn-recibos"
          onClick={() => setModalReciboAberto(true)}
          title={
            recibosPendentesUltimaSemana > 0
              ? `${recibosPendentesUltimaSemana} semana(s) de recibo pendente(s) no total (última fechada: ${labelUltimaSemanaRecibo})`
              : labelUltimaSemanaRecibo
                ? `Nenhuma semana pendente · última fechada: ${labelUltimaSemanaRecibo}`
                : 'Recibos semanais'
          }
        >
          <i className="fas fa-file-invoice"></i> Recibos Semanais
          {recibosPendentesUltimaSemana > 0 && (
            <span
              className="cpg-btn-badge"
              aria-label={`${recibosPendentesUltimaSemana} semanas de recibo pendentes`}
            >
              {recibosPendentesUltimaSemana > 99 ? '99+' : recibosPendentesUltimaSemana}
            </span>
          )}
        </button>
      </div>

      <div className="cpg-form-row">
        <div className="cpg-form-group" style={{ maxWidth: 420 }}>
          <label>Empregado</label>
          <Select
            options={userOptions}
            value={selectedUser}
            onChange={setSelectedUser}
            placeholder="Buscar empregado..."
            isClearable
            components={{ NoOptionsMessage: CustomNoOptions }}
          />
          {usuarioSelecionado?.data_admissao && (
            <small className="cpg-campo-ajuda">
              Admissão:{' '}
              {new Date(
                `${String(usuarioSelecionado.data_admissao).slice(0, 10)}T12:00:00`,
              ).toLocaleDateString('pt-BR')}
            </small>
          )}
        </div>
      </div>

      {selectedUser && (
        <section className="cpg-competencias" aria-label="Competências de comissão">
          <div className="cpg-competencias__cabecalho">
            <h3>Competências</h3>
            <p>
              Ciclo de 21 a 20. A comissão é paga no <strong>mês seguinte</strong> ao
              fechamento (o dia fica a cargo da gerência).
            </p>
          </div>

          {opcoesCiclo.length === 0 ? (
            <UIFeedbackNotFound
              variante="compacto"
              icon="fa-calendar-xmark"
              titulo="Nenhuma competência disponível"
              mensagem="Verifique a data de admissão do empregado."
            />
          ) : (
            <>
              {classificandoCiclos && (
                <p className="cpg-competencias__classificando" role="status">
                  <UICarregando variante="inline" /> Conferindo
                  valores dos ciclos fechados…
                </p>
              )}

              {destaques.length > 0 && (
                <div className="cpg-competencias__destaques">
                  {destaques.map(renderCardCiclo)}
                </div>
              )}

              {historicoCiclos.length > 0 && (
                <div className="cpg-competencias__historico">
                  <button
                    type="button"
                    className="cpg-competencias__toggle"
                    onClick={() => setHistoricoAberto((v) => !v)}
                    aria-expanded={historicoAberto}
                  >
                    <span>
                      <i className="fas fa-history" aria-hidden="true" /> Outras competências
                      <small>{historicoCiclos.length}</small>
                    </span>
                    <i
                      className={`fas fa-chevron-${historicoAberto ? 'up' : 'down'}`}
                      aria-hidden="true"
                    />
                  </button>
                  {historicoAberto && (
                    <div className="cpg-competencias__lista">
                      {historicoCiclos.map((ciclo) => {
                        const selecionado = cicloSelecionado?.value === ciclo.value;
                        const chipClass = [
                          'cpg-ciclo-chip',
                          selecionado ? 'cpg-ciclo-chip--ativo' : '',
                          ciclo.jaFoiPago ? 'cpg-ciclo-chip--pago' : '',
                          ciclo.status === 'sem_comissao' ? 'cpg-ciclo-chip--sem-comissao' : '',
                          !ciclo.jaFoiPago &&
                          ciclo.cicloFechado &&
                          ciclo.valorComissao != null &&
                          ciclo.valorComissao > 0
                            ? 'cpg-ciclo-chip--a-pagar'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ');
                        return (
                          <button
                            key={ciclo.value}
                            type="button"
                            className={chipClass}
                            onClick={() => setCicloSelecionado(ciclo)}
                            aria-pressed={selecionado}
                          >
                            <strong>{ciclo.value}</strong>
                            <span>{ciclo.periodoLabel}</span>
                            <span className="cpg-ciclo-chip__pagamento">
                              Pgto {ciclo.mesPagamentoCurto}
                            </span>
                            <em>{rotuloChipCiclo(ciclo)}</em>
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
      )}

      {pagamentoBloqueado && !competenciaJaPaga && cicloSelecionado && (
        <div className="cpg-alerta-ciclo-aberto" role="status">
          <i className="fas fa-hourglass-half" aria-hidden="true" />
          <div>
            <strong>Ciclo em aberto</strong>
            <p>{mensagemBloqueio}</p>
          </div>
        </div>
      )}

      {loadingCalculo && (
        <UICarregando variante="bloco" tamanho="sm" texto="Calculando..." />
      )}

      {!loadingCalculo && resultadoCalculo && cicloSelecionado && (
        <div className="cpg-resultado-comissao">
          <div className="cpg-resumo-grid">
            <div className="cpg-resumo-card">
              <p className="label">Pontos Produzidos</p>
              <p className="valor">{Math.round(resumoSeguro.totalProduzido)}</p>
            </div>
            <div className="cpg-resumo-card">
              <p className="label">Resgatados (Cofre)</p>
              <p className="valor" style={{ color: 'var(--cpg-cor-primaria)' }}>
                {Math.round(resumoSeguro.totalResgatado)}
              </p>
            </div>
            <div className="cpg-resumo-card">
              <p className="label">{competenciaJaPaga ? 'Valor Pago' : 'Total a Pagar'}</p>
              <p className={`valor ${!competenciaJaPaga ? 'positivo' : ''}`}>
                {formatarMoeda(resultadoCalculo.proventos.comissao)}
              </p>
            </div>
          </div>

          <h3 className="cpg-section-title" style={{ marginTop: 30, fontSize: '1rem' }}>
            Extrato Diário
          </h3>
          {renderTabelaDias()}

          {competenciaJaPaga ? (
            <div
              className="cpg-card"
              style={{
                marginTop: 30,
                backgroundColor: '#e8f5e9',
                borderLeft: '5px solid #27ae60',
              }}
            >
              <h3 style={{ margin: 0, color: '#27ae60' }}>
                <i className="fas fa-check-circle"></i> Comissão Paga
              </h3>
              <p>
                Referente à competência <strong>{cicloSelecionado.value}</strong>.
              </p>
            </div>
          ) : resultadoCalculo.proventos.comissao > 0 ? (
            <div className="cpg-card" style={{ marginTop: 30, backgroundColor: '#fcfcfc' }}>
              <h3 className="cpg-section-title">Efetuar Pagamento</h3>
              <div className="cpg-form-row">
                <div className="cpg-form-group">
                  <label>Debitar da Conta Financeira*</label>
                  <Select
                    options={contas.map((c) => ({ value: String(c.id), label: c.nome_conta }))}
                    value={
                      contas.find((c) => String(c.id) === contaId)
                        ? {
                            value: contaId,
                            label: contas.find((c) => String(c.id) === contaId)!.nome_conta,
                          }
                        : null
                    }
                    onChange={(opt) => setContaId(opt ? String(opt.value) : '')}
                    placeholder="Selecione..."
                    isDisabled={pagamentoBloqueado}
                    components={{ NoOptionsMessage: CustomNoOptions }}
                  />
                </div>

                <div className="cpg-form-group" style={{ alignSelf: 'flex-end' }}>
                  <button
                    type="button"
                    className="cpg-btn cpg-btn-primario"
                    style={{ width: '100%' }}
                    onClick={() => void handlePagar()}
                    disabled={loadingPagamento || pagamentoBloqueado}
                    title={pagamentoBloqueado ? mensagemBloqueio : ''}
                  >
                    {loadingPagamento ? 'Processando...' : 'Pagar Comissão'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="cpg-card cpg-card-sem-comissao" role="status">
              <h3>
                <i className="fas fa-circle-minus" aria-hidden="true" /> Sem comissão neste ciclo
              </h3>
              <p>
                O ciclo <strong>{cicloSelecionado.value}</strong> está fechado, mas não gerou valor
                a pagar (nenhuma meta diária atingida ou produção insuficiente). Não há
                pagamento pendente.
              </p>
            </div>
          )}
        </div>
      )}

      <CPAGModalReciboComissao
        isOpen={modalReciboAberto}
        onClose={() => setModalReciboAberto(false)}
        usuarios={usuarios}
        usuarioInicialId={selectedUser?.value ?? null}
        onRecibosAlterados={() => void atualizarBadgeRecibos()}
      />
    </div>
  );
}
