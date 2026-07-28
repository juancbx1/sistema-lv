import type { CpagApiError } from './cpag-types';

export class CpagApiException extends Error {
  status: number;
  payload?: CpagApiError;

  constructor(message: string, status: number, payload?: CpagApiError) {
    super(message);
    this.name = 'CpagApiException';
    this.status = status;
    this.payload = payload;
  }
}

export async function fetchCpag<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('impersonation_token') || localStorage.getItem('token');
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token ?? ''}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(endpoint, { ...options, headers });
  if (!response.ok) {
    let payload: CpagApiError | undefined;
    try { payload = await response.json() as CpagApiError; } catch { payload = undefined; }
    throw new CpagApiException(payload?.error ?? `Erro na API (${response.status}).`, response.status, payload);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export function cpagHeaders(): Headers {
  const headers = new Headers();
  const token = sessionStorage.getItem('impersonation_token') || localStorage.getItem('token');
  headers.set('Authorization', `Bearer ${token ?? ''}`);
  return headers;
}
