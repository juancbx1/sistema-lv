import type { OPMonitoramentoItem as Item } from '../utils/op-monitoramento-types';

interface Props {
  op: Item;
  selecionada: boolean;
  podeSelecionar: boolean;
  onSelecionar: (opId: number) => void;
  onImpedimento: (op: Item) => void;
  onResolverImpedimento: (op: Item) => void;
}

const ROTULOS_FAIXA: Record<Item['faixa'], string> = {
  ACOMPANHAMENTO: 'Acompanhamento',
  ATENCAO: 'Atenção',
  OBRIGATORIA: 'Revisão obrigatória',
  CRITICA: 'Crítica',
};

function formatarTempo(horas: number) {
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))} min`;
  if (horas < 24) return `${Math.floor(horas)}h`;
  const dias = Math.floor(horas / 24);
  const horasRestantes = Math.floor(horas % 24);
  return horasRestantes > 0 ? `${dias}d ${horasRestantes}h` : `${dias}d`;
}

export default function OPMonitoramentoItem({
  op,
  selecionada,
  podeSelecionar,
  onSelecionar,
  onImpedimento,
  onResolverImpedimento,
}: Props) {
  const variante = op.variante && op.variante !== '-' ? op.variante : 'Padrão';
  return (
    <article className={`opm-item opm-item--${op.faixa.toLowerCase()}${op.impedimento ? ' opm-item--impedida' : ''}`}>
      <div className="opm-item-faixa" aria-hidden="true" />
      {!op.impedimento && (
        <label className={`opm-checkbox${!podeSelecionar ? ' opm-checkbox--desabilitado' : ''}`}>
          <input
            type="checkbox"
            checked={selecionada}
            disabled={!podeSelecionar}
            onChange={() => onSelecionar(op.id)}
            aria-label={`Selecionar OP ${op.numero} para finalização`}
          />
          <span aria-hidden="true"><i className="fas fa-check" /></span>
        </label>
      )}
      <div className="opm-item-imagem">
        {op.produto_imagem
          ? <img src={op.produto_imagem} alt="" />
          : <i className="fas fa-shirt" aria-hidden="true" />}
      </div>
      <div className="opm-item-conteudo">
        <div className="opm-item-topo">
          <strong>OP #{op.numero}</strong>
          <span className={`opm-faixa opm-faixa--${op.faixa.toLowerCase()}`}>
            {ROTULOS_FAIXA[op.faixa]}
          </span>
        </div>
        <h3>{variante}</h3>
        <p>{op.produto_nome}</p>
        <div className="opm-item-metricas">
          <span><i className="far fa-clock" aria-hidden="true" /> {formatarTempo(op.horas_aguardando)} aguardando</span>
          <span><i className="fas fa-layer-group" aria-hidden="true" /> {op.total_etapas_op} etapas OP</span>
          <span className={op.encerramento_parcial ? 'opm-parcial' : ''}>
            <i className={`fas ${op.encerramento_parcial ? 'fa-triangle-exclamation' : 'fa-box'}`} aria-hidden="true" />
            {' '}{op.quantidade_feita_ultima_etapa}/{op.quantidade} pçs
          </span>
        </div>
        {op.impedimento && (
          <div className="opm-impedimento">
            <div>
              <strong><i className="fas fa-circle-pause" aria-hidden="true" /> Impedimento registrado</strong>
              <p>{op.impedimento.motivo}</p>
              <small>Por {op.impedimento.registrado_por_nome}</small>
            </div>
            <button type="button" onClick={() => onResolverImpedimento(op)}>
              Resolver
            </button>
          </div>
        )}
      </div>
      {!op.impedimento && (
        <button className="opm-item-impedir" type="button" onClick={() => onImpedimento(op)}>
          <i className="fas fa-circle-exclamation" aria-hidden="true" />
          Registrar impedimento
        </button>
      )}
    </article>
  );
}

