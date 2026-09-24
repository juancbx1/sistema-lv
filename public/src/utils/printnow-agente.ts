import type { EtiquetaImpressao } from './etiqueta-embalagem';

const AGENTE_URL = 'http://127.0.0.1:17840';

export interface ImpressoraAgente {
  impressoras: string[];
  selecionada: string;
}

export class AgenteIndisponivelError extends Error {
  constructor() {
    super('Abra o PrintNow neste computador.');
    this.name = 'AgenteIndisponivelError';
  }
}

async function pedirAgente<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${AGENTE_URL}${caminho}`, {
      ...init,
      mode: 'cors',
      signal: init.signal ?? AbortSignal.timeout(20000),
      // O Chrome só libera o acesso ao programa local com este destino.
      // @ts-expect-error propriedade ainda fora do tipo padrão do fetch.
      targetAddressSpace: 'loopback',
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error('A impressora não respondeu a tempo.');
    }
    throw new AgenteIndisponivelError();
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const mensagem = typeof payload?.mensagem === 'string' && payload.mensagem
      ? payload.mensagem
      : 'Não foi possível falar com o PrintNow.';
    throw new Error(mensagem);
  }
  return payload as T;
}

export async function agenteDisponivel(): Promise<boolean> {
  try {
    await pedirAgente('/saude');
    return true;
  } catch {
    return false;
  }
}

export async function listarImpressorasAgente(): Promise<ImpressoraAgente> {
  const payload = await pedirAgente<{ impressoras?: string[]; selecionada?: string }>('/impressoras');
  return {
    impressoras: Array.isArray(payload.impressoras) ? payload.impressoras : [],
    selecionada: payload.selecionada || '',
  };
}

export async function selecionarImpressoraAgente(nome: string): Promise<void> {
  await pedirAgente('/impressora', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nome }),
  });
}

export async function previewEtiqueta(etiqueta: EtiquetaImpressao): Promise<string> {
  const payload = await pedirAgente<{ imagem?: string }>('/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(etiqueta),
  });
  if (!payload.imagem) throw new Error('O PrintNow não devolveu a etiqueta.');
  return payload.imagem;
}

export async function imprimirEtiqueta(
  etiqueta: EtiquetaImpressao,
  copias: number,
): Promise<string> {
  const payload = await pedirAgente<{ impressora?: string }>('/imprimir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...etiqueta, copias }),
  });
  return payload.impressora || '';
}

export async function obterCnpjEmpresaAtiva(): Promise<string> {
  const token = localStorage.getItem('token');
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch('/api/contexto-empresa', { headers });
  if (!response.ok) return '';
  const payload = await response.json().catch(() => ({}));
  return String(payload?.empresaAtiva?.cnpj || '');
}
