import type { OPMonitoramentoResposta } from '../utils/op-monitoramento-types';

interface Props {
  dados: OPMonitoramentoResposta;
  onClick: () => void;
}

function estado(dados: OPMonitoramentoResposta) {
  const ativas = dados.ops.filter((op) => !op.impedimento);
  if (ativas.some((op) => op.faixa === 'CRITICA')) return 'critica';
  if (ativas.some((op) => op.faixa === 'OBRIGATORIA')) return 'obrigatoria';
  if (ativas.some((op) => op.faixa === 'ATENCAO')) return 'atencao';
  return 'normal';
}

export default function OPMonitoramentoFab({ dados, onClick }: Props) {
  const classe = estado(dados);
  const totalRelevante = dados.ops.filter((op) => (
    !op.impedimento && op.faixa !== 'ACOMPANHAMENTO'
  )).length;
  const rotulo = totalRelevante > 0
    ? `Abrir monitoramento de OPs. ${totalRelevante} para revisar.`
    : 'Abrir monitoramento de OPs. Tudo em dia.';
  return (
    <button
      type="button"
      className={`opm-fab opm-fab--${classe}`}
      onClick={onClick}
      aria-label={rotulo}
    >
      <span className="opm-fab-icone"><i className="fas fa-tower-broadcast" aria-hidden="true" /></span>
      {totalRelevante > 0 && (
        <span className="opm-fab-badge" aria-hidden="true">
          {totalRelevante > 99 ? '99+' : totalRelevante}
        </span>
      )}
    </button>
  );
}
