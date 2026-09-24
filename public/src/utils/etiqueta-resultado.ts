export interface ResultadoEmbalagem {
  impresso: boolean;
  titulo: string;
  detalhe: string;
  tom?: 'ok' | 'falha';
}

function textoEtiquetas(quantidade: number): string {
  if (quantidade === 1) return '1 etiqueta adicionada';
  return `${quantidade} etiquetas adicionadas`;
}

function textoEstoque(quantidade: number, tipo: 'unidade' | 'kit'): string {
  if (tipo === 'kit') {
    return quantidade === 1
      ? '1 kit entrou no estoque.'
      : `${quantidade} kits entraram no estoque.`;
  }
  return quantidade === 1
    ? '1 unidade entrou no estoque.'
    : `${quantidade} unidades entraram no estoque.`;
}

export function mensagemEmbalagem(opcoes: {
  quantidade: number;
  tipo: 'unidade' | 'kit';
  impresso: boolean;
  motivo?: string;
}): ResultadoEmbalagem {
  const estoque = textoEstoque(opcoes.quantidade, opcoes.tipo);
  if (opcoes.impresso) {
    return {
      impresso: true,
      titulo: textoEtiquetas(opcoes.quantidade),
      detalhe: estoque,
    };
  }
  return {
    impresso: false,
    tom: 'falha',
    titulo: 'Etiqueta não impressa',
    detalhe: `${opcoes.motivo || 'A impressão falhou.'} Nada entrou no estoque.`,
  };
}

export function mensagemSoImpressao(quantidade: number): ResultadoEmbalagem {
  return {
    impresso: true,
    tom: 'ok',
    titulo: quantidade === 1 ? '1 etiqueta impressa' : `${quantidade} etiquetas impressas`,
    detalhe: 'Nada entrou no estoque.',
  };
}

export function mensagemEstoqueSemEtiqueta(
  quantidade: number,
  tipo: 'unidade' | 'kit',
): ResultadoEmbalagem {
  const titulo = tipo === 'kit'
    ? (quantidade === 1
      ? '1 kit adicionado ao estoque'
      : `${quantidade} kits adicionados ao estoque`)
    : (quantidade === 1
      ? '1 unidade adicionada ao estoque'
      : `${quantidade} unidades adicionadas ao estoque`);
  return {
    impresso: false,
    tom: 'ok',
    titulo,
    detalhe: 'Nenhuma etiqueta foi impressa.',
  };
}
