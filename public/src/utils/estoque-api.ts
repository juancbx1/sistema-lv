import type { EstoqueSaldo, NivelEstoque, ProdutoCadastro } from './estoque-types';

interface ApiErrorPayload {
  error?: string;
  details?: string;
}

export interface SaidaEstoqueLoteItem {
  produto_id: number | string;
  variante_nome?: string | null;
  quantidade_movimentada: number;
}

function obterToken(): string | null {
  return sessionStorage.getItem('impersonation_token') || localStorage.getItem('token');
}

async function fetchEstoque<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
  const token = obterToken();
  if (!token) {
    window.location.href = '/index.html';
    throw new Error('Sessão não encontrada. Entre novamente.');
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'no-cache');

  const separator = endpoint.includes('?') ? '&' : '?';
  const response = await fetch(`/api${endpoint}${separator}_=${Date.now()}`, {
    ...init,
    headers,
  });

  const payload = await response.json().catch(() => null) as T | ApiErrorPayload | null;
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      sessionStorage.removeItem('impersonation_token');
      window.location.href = '/index.html';
    }

    const errorPayload = payload as ApiErrorPayload | null;
    throw new Error(errorPayload?.details || errorPayload?.error || `Erro ${response.status}`);
  }

  return payload as T;
}

export function listarSaldoEstoque(): Promise<EstoqueSaldo[]> {
  return fetchEstoque<EstoqueSaldo[]>('/estoque/saldo');
}

export function listarProdutosEstoque(): Promise<ProdutoCadastro[]> {
  return fetchEstoque<ProdutoCadastro[]>('/produtos');
}

export function listarNiveisEstoque(): Promise<NivelEstoque[]> {
  return fetchEstoque<NivelEstoque[]>('/niveis-estoque');
}

export function registrarSaidaEstoqueEmLote(
  itens: SaidaEstoqueLoteItem[],
  tipoOperacao: string,
  observacao: string,
  idempotencyKey: string,
): Promise<{ message?: string; idempotente?: boolean }> {
  return fetchEstoque<{ message?: string; idempotente?: boolean }>('/estoque/movimento-em-lote', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      itens,
      tipo_operacao: tipoOperacao,
      observacao,
      idempotency_key: idempotencyKey,
    }),
  });
}
