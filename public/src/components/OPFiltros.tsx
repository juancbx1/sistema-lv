// public/src/components/OPFiltros.tsx

import { memo, useCallback, useState } from 'react';
import UIBuscaInteligente from './UIBuscaInteligente';

export type OpStatusFiltro = 'todas' | 'produzindo' | 'finalizado' | 'cancelada';

export interface OpFiltrosEstado {
  status: OpStatusFiltro;
  busca?: string;
}

interface OPFiltrosProps {
  onFiltroChange: (filtros: OpFiltrosEstado) => void;
}

const statusOptions: Array<{ id: OpStatusFiltro; label: string }> = [
  { id: 'todas', label: 'Todas Ativas' },
  { id: 'produzindo', label: 'Produzindo' },
  { id: 'finalizado', label: 'Finalizadas' },
  { id: 'cancelada', label: 'Canceladas' },
];

function OPFiltros({ onFiltroChange }: OPFiltrosProps) {
  const [statusAtivo, setStatusAtivo] = useState<OpStatusFiltro>('todas');

  const handleBusca = useCallback((termo: string) => {
    onFiltroChange({ status: statusAtivo, busca: termo });
  }, [onFiltroChange, statusAtivo]);

  const handleStatusClick = (novoStatus: OpStatusFiltro) => {
    if (novoStatus === statusAtivo) return;
    setStatusAtivo(novoStatus);
    onFiltroChange({ status: novoStatus, busca: undefined });
  };

  return (
    <div className="op-filtros-container-redesenhado">
      <div className="op-filtro-busca-wrapper">
        <UIBuscaInteligente
          onSearch={handleBusca}
          placeholder="Buscar OP, Produto ou Variação..."
          historicoKey="ops"
        />
      </div>
      <div className="op-filtro-status-pilulas">
        {statusOptions.map((option) => (
          <button
            type="button"
            key={option.id}
            className={`op-botao-pilula ${statusAtivo === option.id ? 'active' : ''}`}
            onClick={() => handleStatusClick(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default memo(OPFiltros);
