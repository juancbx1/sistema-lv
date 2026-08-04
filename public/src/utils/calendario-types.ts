// Tipos de domínio do Calendário da Empresa.

export type CalendarioTipoEvento =
    | 'feriado_nacional'
    | 'feriado_regional'
    | 'folga_empresa'
    | 'falta' // legado (migrado para falta_injustificada)
    | 'falta_justificada'
    | 'falta_injustificada'
    | 'dia_util_especial';

/** Tipos que exigem seleção de funcionário e impactam VT. */
export const CALENDARIO_TIPOS_FALTA: CalendarioTipoEvento[] = [
    'falta_justificada',
    'falta_injustificada',
    'falta',
];

export function calendarioEhFalta(tipo: string | null | undefined): boolean {
    return CALENDARIO_TIPOS_FALTA.includes(tipo as CalendarioTipoEvento);
}

export interface CalendarioTipoOpcao {
    value: CalendarioTipoEvento;
    label: string;
    cor: string;
}

/** Registro bruto retornado pela API `/api/calendario`. */
export interface CalendarioEventoApi {
    id: number | string;
    data: string;
    tipo: CalendarioTipoEvento | string;
    descricao: string;
    funcionario_id?: number | string | null;
    funcionario_nome?: string | null;
    conta_como_dia_util_pagamento?: boolean | null;
    visivel_dashboard?: boolean | null;
    [key: string]: unknown;
}

/** Evento no formato FullCalendar. */
export interface CalendarioEventoFc {
    id: string;
    title: string;
    date: string;
    backgroundColor: string;
    borderColor: string;
    extendedProps: CalendarioEventoApi;
}

export interface CalendarioFormEstado {
    id: number | string | null;
    data: string;
    tipo: CalendarioTipoEvento | string;
    funcionario_id: string;
    descricao: string;
    conta_como_dia_util_pagamento: boolean;
    visivel_dashboard: boolean;
}

export interface CalendarioFuncionarioOpcao {
    id: number | string;
    nome: string;
    data_admissao?: string | null;
    data_demissao?: string | null;
}

export interface CalendarioDayModal {
    data: string;
    lista: CalendarioEventoFc[];
}

export interface CalendarioCtxMenu {
    x: number;
    y: number;
    data: string;
}

export interface CalendarioJwtPayload {
    tipos?: string[];
    [key: string]: unknown;
}
