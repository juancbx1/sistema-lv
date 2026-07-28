import type { FinanceiroAgendaItem, FinanceiroLancamento } from './financeiro-types';

export interface FinanceiroDataLabel {
  /** Texto do rótulo, sem a data (ex.: "Pago em"). */
  label: string;
  /** Data ISO / string de origem escolhida (caixa primeiro). */
  date?: string;
  /** Classe visual opcional no chip da data. */
  tone?: 'normal' | 'atrasado' | 'estorno';
}

const formatDate = (value?: string) =>
  value
    ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : 'Não registrado';

function dataKey(value?: string) {
  return (value || '').slice(0, 10);
}

function hojeKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Data de caixa do lançamento (prioridade A):
 * quando o dinheiro saiu/entrou da conta.
 * Fallback só se faltar data_transacao.
 */
export function dataCaixaLancamento(lancamento: FinanceiroLancamento): string | undefined {
  return (
    lancamento.data_transacao ||
    lancamento.data_programada ||
    lancamento.data_vencimento ||
    lancamento.data_lancamento ||
    undefined
  );
}

/**
 * Rótulo adaptável da data no card de lançamento.
 * Reflete tipo + status atual (estorno, transferência, receita/despesa).
 */
export function rotuloDataLancamento(lancamento: FinanceiroLancamento): FinanceiroDataLabel {
  const date = dataCaixaLancamento(lancamento);
  const isEstorno = Boolean(lancamento.id_estorno_de);
  const isEstornado = lancamento.status_edicao === 'ESTORNADO';
  const isTransferencia = Boolean(lancamento.id_transferencia_vinculada);
  const isReceita = lancamento.tipo === 'RECEITA';
  const isPendente = Boolean(lancamento.status_edicao?.startsWith('PENDENTE'));

  // Lançamento de estorno (a linha que desfaz o original)
  if (isEstorno) {
    return { label: 'Estorno em', date, tone: 'estorno' };
  }

  // Original já estornado — data de caixa histórica, status deixa claro
  if (isEstornado) {
    return {
      label: isReceita ? 'Estornado · entrou em' : 'Estornado · pago em',
      date,
      tone: 'estorno',
    };
  }

  if (isTransferencia) {
    return { label: 'Transferido em', date, tone: 'normal' };
  }

  // Ainda em fila: mantém verbo de caixa, badge "pendente" já comunica o resto
  if (isPendente) {
    return {
      label: isReceita ? 'Entrada em' : 'Pagamento em',
      date,
      tone: 'normal',
    };
  }

  // Confirmado / normal — linguagem de caixa
  if (isReceita) {
    return { label: 'Entrou em', date, tone: 'normal' };
  }

  return { label: 'Pago em', date, tone: 'normal' };
}

/** Texto pronto: "Pago em 12/03/2026" */
export function textoDataLancamento(lancamento: FinanceiroLancamento): string {
  const { label, date } = rotuloDataLancamento(lancamento);
  return `${label} ${formatDate(date)}`;
}

/**
 * Agenda: só existe vencimento (ainda não é caixa).
 * Verbo no tempo certo: venceu / vence hoje / vence em.
 */
export function rotuloDataAgenda(
  item: FinanceiroAgendaItem,
  opts?: { isLote?: boolean; qtdAtrasadas?: number },
): FinanceiroDataLabel & { text: string } {
  const date = item.data_vencimento;
  const key = dataKey(date);
  const hoje = hojeKey();
  const atrasado = Boolean(key && key < hoje);
  const isHoje = key === hoje;
  const isLote = Boolean(opts?.isLote);
  const qtdAtrasadas = opts?.qtdAtrasadas ?? 0;

  let label: string;
  let tone: FinanceiroDataLabel['tone'] = 'normal';

  if (atrasado) {
    label = isLote ? 'Venceu em' : 'Venceu em';
    tone = 'atrasado';
  } else if (isHoje) {
    label = isLote ? 'Vence hoje' : 'Vence hoje';
  } else {
    label = isLote ? 'Próximo vencimento' : 'Vence em';
  }

  const dataFmt = formatDate(date);
  let text: string;

  if (isHoje && !atrasado) {
    text = isLote && qtdAtrasadas > 0
      ? `Vence hoje · ${qtdAtrasadas} vencida${qtdAtrasadas > 1 ? 's' : ''}`
      : 'Vence hoje';
  } else if (isLote && qtdAtrasadas > 0) {
    text = `${label} ${dataFmt} · ${qtdAtrasadas} vencida${qtdAtrasadas > 1 ? 's' : ''}`;
  } else if (isHoje) {
    text = label;
  } else {
    text = `${label} ${dataFmt}`;
  }

  return { label, date, tone, text };
}
