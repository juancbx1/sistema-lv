// public/src/components/OPEtapaRow.tsx

interface OPEtapa {
  lancado: boolean;
  processo: string;
  usuario?: number | string | null;
  quantidade?: number | string | null;
}

interface OPUsuario {
  id: number | string;
  nome?: string | null;
}

interface OPEtapaRowProps {
  etapa: OPEtapa;
  index: number;
  op: { etapas: OPEtapa[] };
  usuarios: OPUsuario[];
}

export default function OPEtapaRow({ etapa, index, op, usuarios }: OPEtapaRowProps) {
  const isLancado = etapa.lancado;
  const usuarioDaEtapa = isLancado
    ? usuarios.find((usuario) => usuario.id === etapa.usuario)
    : null;
  const etapaAtualIndex = op.etapas.findIndex((item) => !item.lancado);
  const isEtapaAtual = index === etapaAtualIndex;
  const isPendente = !isLancado && !isEtapaAtual;

  return (
    <div className={`op-etapa-consulta-row ${isLancado ? 'concluida' : ''} ${isEtapaAtual ? 'atual' : ''} ${isPendente ? 'pendente' : ''}`}>
      <div className="etapa-numero-status">
        <span className="numero">{index + 1}</span>
      </div>
      <div className="etapa-info-principal">
        <h4>{etapa.processo}</h4>
        <div className="etapa-info-usuario">
          <i className="fas fa-user" />
          <span>{isLancado ? (usuarioDaEtapa?.nome || 'Lançado') : 'Aguardando produção'}</span>
        </div>
      </div>
      <div className="etapa-info-quantidade">
        {isLancado ? (
          <>
            <span className="valor">{etapa.quantidade}</span>
            <span className="label">pçs</span>
          </>
        ) : (
          <span className="valor-pendente">-</span>
        )}
      </div>
    </div>
  );
}
