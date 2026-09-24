import OPMonitoramentoItem from './OPMonitoramentoItem';
import type { OPMonitoramentoItem as Item } from '../utils/op-monitoramento-types';

interface Props {
  ops: Item[];
  selecionadas: Set<number>;
  podeFinalizar: boolean;
  onSelecionar: (opId: number) => void;
  onSelecionarTodas: () => void;
  onLimparSelecao: () => void;
  onImpedimento: (op: Item) => void;
  onResolverImpedimento: (op: Item) => void;
}

export default function OPMonitoramentoLista({
  ops,
  selecionadas,
  podeFinalizar,
  onSelecionar,
  onSelecionarTodas,
  onLimparSelecao,
  onImpedimento,
  onResolverImpedimento,
}: Props) {
  if (ops.length === 0) {
    return (
      <div className="opm-vazio">
        <span><i className="fas fa-check" aria-hidden="true" /></span>
        <h3>Tudo em dia</h3>
        <p>Nenhuma OP está aguardando análise neste momento.</p>
      </div>
    );
  }

  const disponiveis = ops.filter((op) => !op.impedimento);
  return (
    <>
      {podeFinalizar && disponiveis.length > 0 && (
        <div className="opm-selecao">
          <div>
            <strong>{selecionadas.size}</strong> de {disponiveis.length} selecionadas
          </div>
          <button type="button" onClick={onSelecionarTodas}>Selecionar todas</button>
          <button type="button" onClick={onLimparSelecao}>Limpar</button>
        </div>
      )}
      <div className="opm-lista">
        {ops.map((op) => (
          <OPMonitoramentoItem
            key={op.id}
            op={op}
            selecionada={selecionadas.has(op.id)}
            podeSelecionar={podeFinalizar}
            onSelecionar={onSelecionar}
            onImpedimento={onImpedimento}
            onResolverImpedimento={onResolverImpedimento}
          />
        ))}
      </div>
    </>
  );
}

