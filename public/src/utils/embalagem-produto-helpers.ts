import type { ProdutoCadastro } from './embalagem-types';

const PLACEHOLDER_IMAGEM = '/img/placeholder-image.png';

export function getImagemVariacao(
  produtoCompleto: ProdutoCadastro | null | undefined,
  nomeVariante: string | null | undefined,
): string {
  if (!produtoCompleto) return PLACEHOLDER_IMAGEM;

  if (
    nomeVariante &&
    nomeVariante !== '-' &&
    Array.isArray(produtoCompleto.grade)
  ) {
    const gradeItem = produtoCompleto.grade.find(
      (item) => item.variacao === nomeVariante,
    );

    if (gradeItem?.imagem) return gradeItem.imagem;
  }

  return produtoCompleto.imagem || PLACEHOLDER_IMAGEM;
}

export function getSkuVariacao(
  produtoCompleto: ProdutoCadastro | null | undefined,
  nomeVariante: string | null | undefined,
  skuInformado?: string | null,
): string {
  if (skuInformado) return skuInformado;

  if (nomeVariante && Array.isArray(produtoCompleto?.grade)) {
    const gradeItem = produtoCompleto.grade.find(
      (item) => item.variacao === nomeVariante,
    );

    if (gradeItem?.sku) return gradeItem.sku;
  }

  return produtoCompleto?.sku || 'N/A';
}

export function getNomeProduto(
  produtoCompleto: ProdutoCadastro | null | undefined,
  nomeInformado?: string | null,
): string {
  return nomeInformado || produtoCompleto?.nome || 'Produto sem nome';
}

export function getVariacaoPartes(nomeVariante: string | null | undefined): {
  tamanho: string;
  cor: string;
} {
  const valor = (nomeVariante || '-').trim();

  if (valor === '-' || !valor) {
    return { tamanho: '-', cor: '-' };
  }

  const partes = valor
    .split('|')
    .map((parte) => parte.trim())
    .filter(Boolean);

  if (partes.length < 2) {
    return { tamanho: partes[0] || '-', cor: '-' };
  }

  return {
    tamanho: partes[0] || '-',
    cor: partes.slice(1).join(' | ') || '-',
  };
}
