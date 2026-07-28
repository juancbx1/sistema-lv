import type { FinanceiroApiError } from './financeiro-types';

export class FinanceiroApiException extends Error {
  status: number;
  payload?: FinanceiroApiError;

  constructor(message: string, status: number, payload?: FinanceiroApiError) {
    super(message);
    this.name = 'FinanceiroApiException';
    this.status = status;
    this.payload = payload;
  }
}

export async function fetchFinanceiro<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token ?? ''}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`/api/financeiro${endpoint}`, { ...options, headers });
  if (!response.ok) {
    let payload: FinanceiroApiError | undefined;
    try { payload = await response.json() as FinanceiroApiError; } catch { payload = undefined; }
    throw new FinanceiroApiException(payload?.error ?? `Erro na API Financeiro (${response.status}).`, response.status, payload);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}
