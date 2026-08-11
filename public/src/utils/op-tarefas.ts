export interface OpTarefaChave {
  produto_id: number | string;
  variante?: string | null;
  processo: string;
  processo_id?: string | number | null;
  etapa_id?: string | null;
  fase?: string | null;
  origem_ops?: Array<number | string>;
  opNumero?: number | string | null;
}

/**
 * Identidade visual/operacional compartilhada por selecao, confirmacao e P. Externo.
 * JSON evita colisao por separadores em IDs, nomes ou variantes legadas.
 */
export function obterChaveTarefa(tarefa: OpTarefaChave): string {
  const fase = tarefa.fase === 'POS_OP' ? 'POS_OP' : 'OP';
  const origem = fase === 'POS_OP'
    ? (tarefa.origem_ops || []).map((item) => String(item))
    : [];

  return JSON.stringify([
    String(tarefa.produto_id),
    tarefa.variante ?? '-',
    fase,
    tarefa.etapa_id ?? tarefa.processo_id ?? tarefa.processo ?? '',
    origem.length > 0 ? origem : tarefa.opNumero != null ? [String(tarefa.opNumero)] : [],
  ]);
}
