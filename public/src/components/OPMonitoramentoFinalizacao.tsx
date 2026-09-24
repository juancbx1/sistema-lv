import type { OPMonitoramentoItem } from '../utils/op-monitoramento-types';

interface Props {
  ops: OPMonitoramentoItem[];
  executando: boolean;
  obrigatorio: boolean;
  onVoltar: () => void;
  onConfirmar: () => void;
}

export default function OPMonitoramentoFinalizacao({
  ops,
  executando,
  obrigatorio,
  onVoltar,
  onConfirmar,
}: Props) {
  const parciais = ops.filter((op) => op.encerramento_parcial);
  return (
    <div className="opm-confirmacao">
      <div className="opm-confirmacao-icone"><i className="fas fa-check-double" aria-hidden="true" /></div>
      <p className="opm-eyebrow">Revisão final</p>
      <h2>Finalizar {ops.length} {ops.length === 1 ? 'ordem de produção' : 'ordens de produção'}?</h2>
      <p>O servidor verificará novamente cada OP, encerrará sessões ativas e liberará o próximo estágio permitido.</p>

      <div className="opm-confirmacao-ops">
        {ops.map((op) => (
          <div key={op.id}>
            <span>OP #{op.numero}</span>
            <strong>{op.variante && op.variante !== '-' ? op.variante : 'Padrão'}</strong>
            <small>{op.quantidade_feita_ultima_etapa}/{op.quantidade} pçs</small>
          </div>
        ))}
      </div>

      {parciais.length > 0 && (
        <div className="opm-alerta-parcial">
          <i className="fas fa-triangle-exclamation" aria-hidden="true" />
          <div>
            <strong>{parciais.length} {parciais.length === 1 ? 'OP possui' : 'OPs possuem'} produção abaixo da meta.</strong>
            <p>O saldo restante seguirá a regra de encerramento parcial já existente.</p>
          </div>
        </div>
      )}

      <div className="opm-confirmacao-acoes">
        <button type="button" className="opm-btn opm-btn--secundario" onClick={onVoltar} disabled={executando}>
          <i className="fas fa-arrow-left" aria-hidden="true" />
          {obrigatorio ? 'Voltar à análise' : 'Revisar seleção'}
        </button>
        <button type="button" className="opm-btn opm-btn--primario" onClick={onConfirmar} disabled={executando}>
          {executando
            ? <><i className="fas fa-circle-notch fa-spin" aria-hidden="true" /> Finalizando...</>
            : <><i className="fas fa-check-double" aria-hidden="true" /> Confirmar finalização</>}
        </button>
      </div>
    </div>
  );
}

