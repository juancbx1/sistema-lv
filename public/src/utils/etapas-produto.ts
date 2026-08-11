export type EtapaProdutoLike = string | {
  id?: string | null;
  processo_id?: string | number | null;
  ordem?: number | null;
  maquina?: string | null;
  origem?: string | null;
  feitoPor?: string | string[] | null;
  fase?: string | null;
  modoExecucao?: string | null;
  modo_execucao?: string | null;
  processo?: string | null;
};

export type ModoExecucaoEtapa = 'MANUAL' | 'LIBERACAO_AUTOMATICA';

export function obterExecutoresEtapa(etapa: EtapaProdutoLike): string[] {
  if (typeof etapa === 'string' || !etapa) return [];
  const executores = Array.isArray(etapa.feitoPor) ? etapa.feitoPor : [etapa.feitoPor];
  return [...new Set(executores.filter((tipo): tipo is string => typeof tipo === 'string' && tipo.trim().length > 0))];
}

export function etapaPermiteExecutor(etapa: EtapaProdutoLike, tiposFuncionario: string[]): boolean {
  const executores = obterExecutoresEtapa(etapa);
  return executores.some((tipo) => tiposFuncionario.includes(tipo));
}

export function etapaEhLiberacaoAutomatica(etapa: EtapaProdutoLike): boolean {
  if (typeof etapa === 'string' || !etapa || etapa.fase !== 'POS_OP') return false;
  return String(etapa.modoExecucao ?? etapa.modo_execucao ?? '').toUpperCase()
    === 'LIBERACAO_AUTOMATICA';
}
