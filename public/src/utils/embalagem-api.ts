import type {
  EmbalagemArremateLote,
  EmbalagemFilaItem,
  EmbalagemFilaItemApi,
  EmbalagemHistoricoResposta,
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

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
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

  return payload as T;
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
    fetchAll: 'true',
    tipo_lancamento: 'PRODUCAO',
  });
  const payload = await requestJson<ArrematesResponse>(
    `/api/arremates?${params.toString()}`,
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
): Promise<void> {
  await requestJson('/api/kits/montar', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  });
}

export async function registrarEmbalagemUnitaria(
  item: EmbalagemFilaItem,
  lotes: EmbalagemArremateLote[],
  quantidade: number,
  observacao: string,
): Promise<void> {
  let restante = quantidade;
  const lotesUsados: Array<{ lote: EmbalagemArremateLote; quantidade: number }> = [];

  for (const lote of lotes) {
    if (restante <= 0) break;

    const disponivel =
      Number(lote.quantidade_arrematada || 0) -
      Number(lote.quantidade_ja_embalada || 0);
    const quantidadeDesteLote = Math.min(restante, disponivel);

    if (quantidadeDesteLote <= 0) continue;

    await requestJson(`/api/arremates/${lote.id}/registrar-embalagem`, {
      method: 'PUT',
      body: JSON.stringify({
        quantidade_que_foi_embalada_desta_vez: quantidadeDesteLote,
      }),
    });

    lotesUsados.push({ lote, quantidade: quantidadeDesteLote });
    restante -= quantidadeDesteLote;
  }

  if (restante > 0) {
    throw new Error('Não foi possível alocar toda a quantidade nos lotes disponíveis.');
  }

  if (!item.sku || item.sku === 'N/A') {
    throw new Error('Não foi possível determinar o SKU da unidade para registro.');
  }

  await requestJson('/api/estoque/entrada-producao', {
    method: 'POST',
    body: JSON.stringify({
      produto_id: item.produtoId,
      variante_nome: item.variante === '-' ? null : item.variante,
      produto_ref_id: item.sku,
      quantidade_entrada: quantidade,
      id_arremate_origem: lotesUsados[0]?.lote.id || null,
      observacao: observacao.trim() || null,
    }),
  });
}
