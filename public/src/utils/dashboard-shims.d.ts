/** Declarações mínimas para módulos JS legados usados pela Dashboard. */

declare module '/js/utils/api-utils' {
  export function fetchAPI(endpoint: string, options?: RequestInit & { body?: string }): Promise<unknown>;
}

declare module '/js/utils/api-utils.js' {
  export function fetchAPI(endpoint: string, options?: RequestInit & { body?: string }): Promise<unknown>;
}

declare module '/js/utils/auth.js' {
  export function verificarAutenticacao(
    pagina: string,
    permissoes?: string[],
  ): Promise<boolean | unknown>;
  export function limparContextoEmpresaLocal(): void;
  export function salvarContextoEmpresaLocal(ctx: unknown): void;
}

declare module '/js/utils/popups.js' {
  export function mostrarMensagem(html: string, tipo?: string): void;
  export function mostrarConfirmacao(mensagem: string): Promise<boolean>;
}

declare module '/js/utils/changelog-data.js' {
  export const changelog: Array<{
    versao: string;
    versao_dashboard?: string;
    data?: string;
    admin?: string[];
    dashboard?: string[];
  }>;
}

declare module '/js/utils/periodos-fiscais.js' {
  export function getDataPagamentoEstimada(fimCiclo: string): string | null;
}

declare module '/js/utils/ciclos.js' {
  export function getObjetoCicloCompletoAtual(): {
    semanas?: Array<{ inicio: string; fim: string }>;
  } | null;
}

declare module '../utils/PontoHelpers' {
  export function formatarTempo(ms: number): string;
  export function formatarHora(t?: string | null): string;
  export function calcularTempoEfetivo(
    dataInicio: string,
    pontoHoje?: object | null,
  ): { ms: number; pausado: boolean; motivo: 'ALMOCO' | 'PAUSA' | null };
}

declare module '../utils/confetes.js' {
  export function dispararConfetes(): void;
  export function dispararToastVitoria(nomeGincana?: string): void;
  export function dispararCelebracao(gincana: { id?: number; nome?: string; [key: string]: unknown }): void;
}
