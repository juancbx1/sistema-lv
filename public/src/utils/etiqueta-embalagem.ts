import type { ProdutoCadastro } from './embalagem-types';

export interface EtiquetaImpressao {
  sku: string;
  variante: string;
  codigo_barras: string;
  qtd_pacote: number;
  fabricacao: string;
  cnpj: string;
}

export function formatarCnpjEtiqueta(cnpj: string | null | undefined): string {
  const texto = String(cnpj || '').trim();
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length !== 14) return texto;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}.${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}

export function montarEtiquetaProduto(
  produto: ProdutoCadastro | null | undefined,
  variante: string | null | undefined,
  cnpj: string,
): EtiquetaImpressao | null {
  if (!produto) return null;

  const nomeVariante = String(variante || '-').trim() || '-';
  const grade = Array.isArray(produto.grade)
    ? produto.grade.find((item) => String(item.variacao || '-') === nomeVariante)
    : undefined;
  const sku = String(grade?.sku || (!grade ? produto.sku : '') || '').trim();
  if (!sku) return null;

  const gtinVariacao = String(grade?.gtin || '').trim();
  const gtinPai = grade ? '' : String(produto.gtin || '').trim();
  const pacote = Number(grade?.qtd_pacote || 1);

  return {
    sku,
    variante: nomeVariante === '-' ? String(produto.nome || sku) : nomeVariante,
    codigo_barras: gtinVariacao || gtinPai,
    qtd_pacote: Number.isInteger(pacote) && pacote > 0 ? pacote : 1,
    fabricacao: 'IND. BRASILEIRA',
    cnpj: formatarCnpjEtiqueta(cnpj),
  };
}
