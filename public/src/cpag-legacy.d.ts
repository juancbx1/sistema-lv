declare module '/js/utils/auth.js' {
  export function verificarAutenticacao(pagina: string, permissoes?: string[], modo?: 'all' | 'any'): Promise<unknown | null>;
}

declare module '/js/utils/formataDtHr.js' {
  export function formatarMoeda(valor: number | string | null | undefined): string;
}

declare module '/js/utils/popups.js' {
  export function mostrarToast(mensagem: string, tipo?: string, duracao?: number): void;
  export function mostrarMensagem(mensagem: string, tipo?: string, duracao?: number): void;
  export function mostrarConfirmacao(
    mensagem: string,
    opcoes?: { tipo?: string; textoConfirmar?: string; textoCancelar?: string },
  ): Promise<boolean>;
  export function mostrarPromptTexto(
    mensagem: string,
    opcoes?: {
      placeholder?: string;
      tipo?: string;
      textoConfirmar?: string;
      valorInicial?: string;
    },
  ): Promise<string | null>;
}

declare module '../../js/utils/popups.js' {
  export function mostrarToast(mensagem: string, tipo?: string, duracao?: number): void;
  export function mostrarMensagem(mensagem: string, tipo?: string, duracao?: number): void;
  export function mostrarConfirmacao(
    mensagem: string,
    opcoes?: { tipo?: string; textoConfirmar?: string; textoCancelar?: string },
  ): Promise<boolean>;
  export function mostrarPromptTexto(
    mensagem: string,
    opcoes?: {
      placeholder?: string;
      tipo?: string;
      textoConfirmar?: string;
      valorInicial?: string;
    },
  ): Promise<string | null>;
}
