// public/src/components/OPFiltros.jsx

import React, { useState, useCallback } from 'react'; // Adicione useCallback
import UIBuscaInteligente from './UIBuscaInteligente.jsx';

const statusOptions = [
  { id: 'todas', label: 'Todas Ativas' },
  { id: 'produzindo', label: 'Produzindo' },
  { id: 'finalizado', label: 'Finalizadas' },
  { id: 'cancelada', label: 'Canceladas' },
];

// Usamos React.memo para evitar re-renderizações desnecessárias se as props não mudarem
export default React.memo(function OPFiltros({ onFiltroChange }) {
  const [statusAtivo, setStatusAtivo] = useState('todas');
  
  const handleBusca = useCallback((termo) => {
      onFiltroChange({ status: statusAtivo, busca: termo });
  }, [onFiltroChange, statusAtivo]);

  const handleStatusClick = (novoStatus) => {
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
            {statusOptions.map(option => (
                <button
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
});