import type {
  OPMonitoramentoLoteResultado,
  OPMonitoramentoResposta,
} from './op-monitoramento-types';

function obterToken() {
  return sessionStorage.getItem('impersonation_token') || localStorage.getItem('token');
}

function novaChaveIdempotencia() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `op-monitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function requisicao<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = obterToken();
  if (!token) throw new Error('Sessão não encontrada. Entre novamente.');
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error || `Não foi possível concluir a operação (${response.status}).`);
  return data as T;
}

export function buscarMonitoramentoOps() {
  return requisicao<OPMonitoramentoResposta>('/api/ordens-de-producao/monitoramento');
}

export function finalizarOpsMonitoradas(opIds: number[]) {
  return requisicao<OPMonitoramentoLoteResultado>(
    '/api/ordens-de-producao/monitoramento/finalizar-lote',
    {
      method: 'POST',
      body: JSON.stringify({ op_ids: opIds, idempotency_key: novaChaveIdempotencia() }),
    },
  );
}

export function adiarMonitoramentoOps() {
  return requisicao<{ id: number; vence_em: string }>(
    '/api/ordens-de-producao/monitoramento/adiar',
    {
      method: 'POST',
      body: JSON.stringify({ idempotency_key: novaChaveIdempotencia() }),
    },
  );
}

export function registrarImpedimentoOp(opId: number, motivo: string) {
  return requisicao('/api/ordens-de-producao/monitoramento/impedimentos', {
    method: 'POST',
    body: JSON.stringify({ op_id: opId, motivo }),
  });
}

export function resolverImpedimentoOp(impedimentoId: number) {
  return requisicao(`/api/ordens-de-producao/monitoramento/impedimentos/${impedimentoId}`, {
    method: 'PATCH',
    body: JSON.stringify({ acao: 'resolver' }),
  });
}

