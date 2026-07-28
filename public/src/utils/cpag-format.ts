export function formatarMoeda(valor: number | string | null | undefined): string {
  const numero = Number(valor ?? 0);
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
