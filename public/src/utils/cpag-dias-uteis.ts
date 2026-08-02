/**
 * Dias úteis de pagamento com base no calendário da empresa
 * (feriados nacionais/regionais e folgas de empresa).
 */

export type CpagEventoCalendario = {
  data: string;
  tipo?: string;
  funcionario_id?: number | string | null;
  conta_como_dia_util_pagamento?: boolean;
};

const TIPOS_NAO_UTEIS = new Set([
  'feriado_nacional',
  'feriado_regional',
  'folga_empresa',
]);

export function dataLocalISO(data: Date): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export function parseDataLocal(iso: string): Date {
  return new Date(`${String(iso).slice(0, 10)}T12:00:00`);
}

/** Normaliza data vinda da API (evita deslocamento por UTC). */
export function normalizarDataEvento(valor: unknown): string | null {
  if (valor == null) return null;
  if (typeof valor === 'string') return valor.slice(0, 10);
  if (valor instanceof Date) {
    const y = valor.getUTCFullYear();
    const m = String(valor.getUTCMonth() + 1).padStart(2, '0');
    const d = String(valor.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(valor).slice(0, 10);
}

/**
 * Monta o conjunto de datas que NÃO contam como dia útil de pagamento.
 * Eventos com conta_como_dia_util_pagamento = true permanecem úteis.
 */
export function montarDiasNaoUteisPagamento(
  eventos: CpagEventoCalendario[],
): Set<string> {
  const set = new Set<string>();
  for (const ev of eventos) {
    if (ev.funcionario_id != null && ev.funcionario_id !== '') continue;
    if (!TIPOS_NAO_UTEIS.has(String(ev.tipo || ''))) continue;
    if (ev.conta_como_dia_util_pagamento) continue;
    const iso = normalizarDataEvento(ev.data);
    if (iso) set.add(iso);
  }
  return set;
}

/** Seg–sex e fora da lista de feriados/folgas da empresa. */
export function ehDiaUtilPagamento(data: Date, diasNaoUteis: Set<string>): boolean {
  const dow = data.getDay();
  if (dow === 0 || dow === 6) return false;
  return !diasNaoUteis.has(dataLocalISO(data));
}

/**
 * A partir de uma data (inclusive), devolve o mesmo dia se for útil,
 * senão o próximo dia útil de pagamento.
 */
export function proximoDiaUtilPagamento(
  dataBase: Date,
  diasNaoUteis: Set<string>,
  maxPassos = 60,
): Date {
  const cursor = new Date(
    dataBase.getFullYear(),
    dataBase.getMonth(),
    dataBase.getDate(),
    12,
    0,
    0,
    0,
  );
  for (let i = 0; i < maxPassos; i += 1) {
    if (ehDiaUtilPagamento(cursor, diasNaoUteis)) {
      return new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 23, 59, 59, 999);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 23, 59, 59, 999);
}

/**
 * Data de pagamento do VA: dia 25 do mês de referência;
 * se não for útil, o próximo dia útil (calendário da empresa).
 */
export function dataPagamentoVa(
  mesIndex: number,
  ano: number,
  diasNaoUteis: Set<string>,
): Date {
  const dia25 = new Date(ano, mesIndex, 25, 12, 0, 0, 0);
  // Mês com menos de 25 dias (não ocorre no calendário gregoriano, mas por segurança)
  if (dia25.getMonth() !== mesIndex) {
    const ultimo = new Date(ano, mesIndex + 1, 0, 12, 0, 0, 0);
    return proximoDiaUtilPagamento(ultimo, diasNaoUteis);
  }
  return proximoDiaUtilPagamento(dia25, diasNaoUteis);
}

export function formatarDataPtBr(data: Date): string {
  return data.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
