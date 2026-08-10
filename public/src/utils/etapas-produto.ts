export type EtapaProdutoLike = string | {
  id?: string | null;
  processo_id?: string | number | null;
  ordem?: number | null;
  maquina?: string | null;
  origem?: string | null;
  feitoPor?: string | string[] | null;
  fase?: string | null;
  processo?: string | null;
};

export function obterExecutoresEtapa(etapa: EtapaProdutoLike): string[] {
  if (typeof etapa === 'string' || !etapa) return [];
  const executores = Array.isArray(etapa.feitoPor) ? etapa.feitoPor : [etapa.feitoPor];
  return [...new Set(executores.filter((tipo): tipo is string => typeof tipo === 'string' && tipo.trim().length > 0))];
}

export function etapaPermiteExecutor(etapa: EtapaProdutoLike, tiposFuncionario: string[]): boolean {
  const executores = obterExecutoresEtapa(etapa);
  return executores.some((tipo) => tiposFuncionario.includes(tipo));
}
