import type { CpagIntervaloRecibo } from './cpag-types';

/**
 * Marco da reformulação do sistema de recibos semanais (08/03/2026).
 * Semanas que terminam antes desta data não entram como pendentes:
 * o modelo antigo de conferência era outro e não se aplica aqui.
 */
export const DATA_INICIO_RECIBOS_SEMANAIS = '2026-03-08';

/** Semana de conferência: domingo → sábado. */
export interface CpagSemanaRecibo {
  dataInicio: string; // YYYY-MM-DD (domingo)
  dataFim: string; // YYYY-MM-DD (sábado)
  label: string;
  /** true quando o sábado já passou (semana inteira fechada). */
  fechada: boolean;
  gerado: boolean;
}

export function dataLocalISO(data: Date): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export function parseDataLocal(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T12:00:00`);
}

/** Domingo da semana do dia informado. */
export function domingoDaSemana(data: Date): Date {
  const base = new Date(data.getFullYear(), data.getMonth(), data.getDate(), 12, 0, 0, 0);
  const diaSemana = base.getDay(); // 0=dom
  base.setDate(base.getDate() - diaSemana);
  return base;
}

export function sabadoDaSemana(domingo: Date): Date {
  const sab = new Date(domingo.getFullYear(), domingo.getMonth(), domingo.getDate(), 12, 0, 0, 0);
  sab.setDate(sab.getDate() + 6);
  return sab;
}

/** Semana fechada = sábado 23:59:59 já passou. */
export function semanaEstaFechada(dataInicioDomingo: string, agora = new Date()): boolean {
  const sabado = sabadoDaSemana(parseDataLocal(dataInicioDomingo));
  const fim = new Date(sabado.getFullYear(), sabado.getMonth(), sabado.getDate(), 23, 59, 59, 999);
  return agora > fim;
}

export function labelSemana(dataInicio: string, dataFim: string): string {
  const ini = parseDataLocal(dataInicio).toLocaleDateString('pt-BR');
  const fim = parseDataLocal(dataFim).toLocaleDateString('pt-BR');
  return `${ini} a ${fim}`;
}

/**
 * Última semana completa (dom–sáb) já fechada.
 * Não inclui a semana atual nem a próxima.
 */
export function ultimaSemanaFechada(agora = new Date()): {
  dataInicio: string;
  dataFim: string;
  label: string;
} {
  const hojeMeioDia = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 12, 0, 0, 0);
  let domingo = domingoDaSemana(hojeMeioDia);

  // Se a semana do "hoje" ainda não fechou, recua uma semana
  if (!semanaEstaFechada(dataLocalISO(domingo), agora)) {
    domingo = new Date(domingo.getFullYear(), domingo.getMonth(), domingo.getDate() - 7, 12, 0, 0, 0);
  }

  const sabado = sabadoDaSemana(domingo);
  const dataInicio = dataLocalISO(domingo);
  const dataFim = dataLocalISO(sabado);
  return { dataInicio, dataFim, label: labelSemana(dataInicio, dataFim) };
}

/** Expande intervalos de recibo em set de dias YYYY-MM-DD. */
export function diasCobertosPorIntervalos(intervalos: CpagIntervaloRecibo[]): Set<string> {
  const dias = new Set<string>();
  for (const intervalo of intervalos) {
    let cursor = parseDataLocal(String(intervalo.data_inicio).slice(0, 10));
    const fim = parseDataLocal(String(intervalo.data_fim).slice(0, 10));
    while (cursor <= fim) {
      dias.add(dataLocalISO(cursor));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 12, 0, 0, 0);
    }
  }
  return dias;
}

export function semanaGerada(dataInicio: string, diasCobertos: Set<string>): boolean {
  // Considera gerada se o domingo da semana já está coberto (recibo da semana inteira)
  return diasCobertos.has(dataInicio);
}

/**
 * Semanas cujo sábado é anterior a 08/03/2026 ficam fora do modelo novo
 * (tratadas como já resolvidas / não pendentes).
 */
export function semanaAnteriorAoSistemaRecibos(dataFimSabado: string): boolean {
  return parseDataLocal(dataFimSabado) < parseDataLocal(DATA_INICIO_RECIBOS_SEMANAIS);
}

/**
 * Lista semanas fechadas recentes (mais recente primeiro).
 * `maxSemanas` limita o histórico; respeita admissão se informada.
 * Não lista (e portanto não conta como pendente) semanas anteriores a 08/03/2026.
 */
export function listarSemanasFechadas(opcoes: {
  maxSemanas?: number;
  dataAdmissao?: string | null;
  diasCobertos?: Set<string>;
  agora?: Date;
}): CpagSemanaRecibo[] {
  const maxSemanas = opcoes.maxSemanas ?? 16;
  const agora = opcoes.agora ?? new Date();
  const diasCobertos = opcoes.diasCobertos ?? new Set<string>();
  const admissao = opcoes.dataAdmissao
    ? parseDataLocal(String(opcoes.dataAdmissao).slice(0, 10))
    : null;
  const inicioSistema = parseDataLocal(DATA_INICIO_RECIBOS_SEMANAIS);

  const ultima = ultimaSemanaFechada(agora);
  let domingo = parseDataLocal(ultima.dataInicio);
  const lista: CpagSemanaRecibo[] = [];

  for (let i = 0; i < maxSemanas; i += 1) {
    const sabado = sabadoDaSemana(domingo);
    // Semanas anteriores à reformulação de 08/03/2026 → encerram a varredura
    if (sabado < inicioSistema) break;
    // Semana inteira antes da admissão → para
    if (admissao && sabado < admissao) break;

    const dataInicio = dataLocalISO(domingo);
    const dataFim = dataLocalISO(sabado);
    if (!semanaEstaFechada(dataInicio, agora)) {
      domingo = new Date(domingo.getFullYear(), domingo.getMonth(), domingo.getDate() - 7, 12, 0, 0, 0);
      continue;
    }

    const geradaNoSistema = semanaGerada(dataInicio, diasCobertos);
    // Cinto de segurança: se por algum motivo a data cair antes do marco, conta como gerada
    const gerado = geradaNoSistema || semanaAnteriorAoSistemaRecibos(dataFim);

    lista.push({
      dataInicio,
      dataFim,
      label: labelSemana(dataInicio, dataFim),
      fechada: true,
      gerado,
    });

    domingo = new Date(domingo.getFullYear(), domingo.getMonth(), domingo.getDate() - 7, 12, 0, 0, 0);
  }

  return lista;
}
