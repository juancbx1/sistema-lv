import type {
  EmbalagemArremateLote,
  EmbalagemFilaItem,
  EmbalagemFilaItemApi,
  EmbalagemHistoricoResposta,
  EmbalagemOcorrenciaConserto,
  EmbalagemOcorrenciaPayload,
  EmbalagemKitMontagemPayload,
  EmbalagemEstoqueSaldo,
  EmbalagemNivelEstoque,
  ProdutoCadastro,
} from './embalagem-types';

interface ListaProdutosResponse {
  rows?: ProdutoCadastro[];
  produtos?: ProdutoCadastro[];
}

interface FilaResponse {
  rows?: EmbalagemFilaItemApi[];
}

interface ArrematesResponse {
  rows?: EmbalagemArremateLote[];
}

interface ListaEstoqueResponse {
  rows?: EmbalagemEstoqueSaldo[];
}

interface ListaNiveisEstoqueResponse {
  rows?: EmbalagemNivelEstoque[];
}

interface OcorrenciasConsertoResponse {
  rows?: EmbalagemOcorrenciaConserto[];
}

export interface RegistroOperacaoEmbalagem {
  status: number;
  idempotente: boolean;
  embalagemId: number | string | null;
}

async function executarPedido(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; payload: unknown }> {
  const headers = new Headers(init.headers);
  const token = localStorage.getItem('token');

  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, { ...init, headers });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String(payload.message)
        : typeof payload === 'object' && payload !== null && 'error' in payload
          ? String(payload.error)
        : `Não foi possível carregar a fila (${response.status}).`;
    throw new Error(message);
  }

  return { status: response.status, payload };
}

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const { payload } = await executarPedido(url, init);
  return payload as T;
}

function lerRegistroOperacao(
  status: number,
  payload: unknown,
): RegistroOperacaoEmbalagem {
  const corpo = payload && typeof payload === 'object' ? payload as {
    idempotente?: boolean;
    embalagem_id?: number | string | null;
  } : {};
  return {
    status,
    idempotente: Boolean(corpo.idempotente),
    embalagemId: corpo.embalagem_id ?? null,
  };
}

export async function listarProdutos(): Promise<ProdutoCadastro[]> {
  const payload = await requestJson<ProdutoCadastro[] | ListaProdutosResponse>(
    '/api/produtos',
  );

  if (Array.isArray(payload)) return payload;
  return payload.rows || payload.produtos || [];
}

export async function listarFilaEmbalagem(): Promise<EmbalagemFilaItemApi[]> {
  const payload = await requestJson<FilaResponse>(
    '/api/embalagens/fila?todos=true',
  );

  return Array.isArray(payload.rows) ? payload.rows : [];
}

export async function listarSaldoEstoque(): Promise<EmbalagemEstoqueSaldo[]> {
  const payload = await requestJson<
    EmbalagemEstoqueSaldo[] | ListaEstoqueResponse
  >('/api/estoque/saldo');

  return Array.isArray(payload) ? payload : payload.rows || [];
}

export async function listarNiveisEstoque(): Promise<EmbalagemNivelEstoque[]> {
  const payload = await requestJson<
    EmbalagemNivelEstoque[] | ListaNiveisEstoqueResponse
  >('/api/niveis-estoque');

  return Array.isArray(payload) ? payload : payload.rows || [];
}

export async function listarLotesParaEmbalagem(
  item: EmbalagemFilaItem,
): Promise<EmbalagemArremateLote[]> {
  return listarLotesPorProdutoVariante(item.produtoId, item.variante);
}

export async function listarLotesPorProdutoVariante(
  produtoId: number | string,
  variante: string | null | undefined,
): Promise<EmbalagemArremateLote[]> {
  const params = new URLSearchParams({
    produto_id: String(produtoId),
    variante: variante || '-',
  });
  const payload = await requestJson<ArrematesResponse>(
    `/api/embalagens/origens?${params.toString()}`,
  );

  return (payload.rows || [])
    .filter((lote) => {
      const disponivel =
        Number(lote.quantidade_arrematada || 0) -
        Number(lote.quantidade_ja_embalada || 0);
      return disponivel > 0;
    })
    .sort(
      (a, b) =>
        new Date(a.data_lancamento || a.data_final || 0).getTime() -
        new Date(b.data_lancamento || b.data_final || 0).getTime(),
    );
}

export async function listarHistoricoEmbalagem(
  item: EmbalagemFilaItem,
  page = 1,
  limit = 6,
): Promise<EmbalagemHistoricoResposta> {
  const params = new URLSearchParams({
    produto_ref_id: item.sku,
    page: String(page),
    limit: String(limit),
  });

  return requestJson<EmbalagemHistoricoResposta>(
    `/api/embalagens/historico?${params.toString()}`,
  );
}

export async function registrarMontagemKit(
  payload: EmbalagemKitMontagemPayload,
  idempotencyKey: string,
): Promise<RegistroOperacaoEmbalagem> {
  const resultado = await executarPedido('/api/kits/montar', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  });
  return lerRegistroOperacao(resultado.status, resultado.payload);
}

export async function registrarEmbalagemUnitaria(
  item: EmbalagemFilaItem,
  _lotes: EmbalagemArremateLote[],
  quantidade: number,
  observacao: string,
): Promise<RegistroOperacaoEmbalagem> {
  const chaveAleatoria = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const resultado = await executarPedido('/api/embalagens/unidade', {
    method: 'POST',
    headers: {
      'Idempotency-Key': `embalagem-unidade:${item.id}:${chaveAleatoria}`,
    },
    body: JSON.stringify({
      produto_id: item.produtoId,
      variante_nome: item.variante === '-' ? null : item.variante,
      quantidade_embalada: quantidade,
      observacao: observacao.trim() || null,
    }),
  });
  return lerRegistroOperacao(resultado.status, resultado.payload);
}

function gerarChaveIdempotencia(prefixo: string): string {
  const sufixo = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefixo}:${sufixo}`;
}

export async function registrarEntradaAvulsa(payload: {
  produtoId: number | string;
  variante: string | null;
  sku: string;
  quantidade: number;
  observacao?: string;
}): Promise<void> {
  await executarPedido('/api/estoque/entrada-producao', {
    method: 'POST',
    headers: {
      'Idempotency-Key': gerarChaveIdempotencia('etiqueta-avulsa'),
    },
    body: JSON.stringify({
      produto_id: payload.produtoId,
      variante_nome: !payload.variante || payload.variante === '-' ? null : payload.variante,
      quantidade_entrada: payload.quantidade,
      produto_ref_id: payload.sku,
      observacao: payload.observacao?.trim() || 'Entrada pela impressão avulsa de etiqueta.',
    }),
  });
}

export async function registrarOcorrenciaEmbalagem(
  payload: EmbalagemOcorrenciaPayload,
): Promise<void> {
  await requestJson('/api/embalagens/ocorrencias', {
    method: 'POST',
    headers: {
      'Idempotency-Key': gerarChaveIdempotencia('ocorrencia-embalagem'),
    },
    body: JSON.stringify(payload),
  });
}

export async function listarConsertosPendentes(): Promise<EmbalagemOcorrenciaConserto[]> {
  const payload = await requestJson<OcorrenciasConsertoResponse>(
    '/api/embalagens/ocorrencias/consertos',
  );
  return Array.isArray(payload.rows) ? payload.rows : [];
}

export async function retornarProdutoDoConserto(
  ocorrenciaId: number | string,
  quantidade: number,
  observacao: string,
): Promise<void> {
  await requestJson(`/api/embalagens/ocorrencias/${ocorrenciaId}/retornar-conserto`, {
    method: 'POST',
    body: JSON.stringify({ quantidade, observacao: observacao.trim() || null }),
  });
}

export async function converterConsertoEmAvaria(
  ocorrenciaId: number | string,
  quantidade: number | null,
  observacao: string,
): Promise<void> {
  await requestJson(`/api/embalagens/ocorrencias/${ocorrenciaId}/converter-avaria`, {
    method: 'POST',
    body: JSON.stringify({
      ...(quantidade === null ? {} : { quantidade }),
      observacao: observacao.trim() || null,
    }),
  });
}
