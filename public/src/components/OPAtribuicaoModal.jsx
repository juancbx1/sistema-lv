// public/src/components/OPAtribuicaoModal.jsx

import React, { useState, useEffect } from 'react';
import { mostrarConfirmacao } from '/js/utils/popups.js';

import OPTelaSelecaoEtapa from './OPTelaSelecaoEtapa.jsx';
import OPTelaConfirmacaoQtd from './OPTelaConfirmacaoQtd.jsx';

const getRoleInfo = (tipos = []) => {
    if (tipos?.includes('tiktik'))   return { label: 'TikTik',    icon: 'fa-cut',         classe: 'badge-tiktik' };
    if (tipos?.includes('cortador')) return { label: 'Cortador',  icon: 'fa-layer-group', classe: 'badge-cortador' };
    return                                  { label: 'Costureira', icon: 'fa-tshirt',      classe: 'badge-costureira' };
};

export default function OPAtribuicaoModal({ funcionario, isOpen, onClose, tpp }) {
  const modoHoraExtra = !!funcionario?._modo_hora_extra;
  const [telaAtual, setTelaAtual] = useState('selecao');
  const [etapaSelecionada, setEtapaSelecionada] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setTelaAtual('selecao');
      setEtapaSelecionada(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const role = getRoleInfo(funcionario?.tipos);

  const handleEtapaSelect = async (etapa) => {
    // Sessão unificada com troca de máquina → confirmar antes de avançar
    const singleEtapa = Array.isArray(etapa) ? null : etapa;
    if (singleEtapa?._unificada && singleEtapa._grupo_unificacao?.muda_maquina) {
      const etapas = singleEtapa._grupo_unificacao.etapas;
      const maqA = etapas[0]?.maquina || '?';
      const maqB = etapas[etapas.length - 1]?.maquina || '?';
      const primeiroNome = funcionario?.nome?.split(' ')[0] || funcionario?.nome;
      const confirmado = await mostrarConfirmacao(
        `${primeiroNome} precisará trocar de máquina durante esta tarefa (${maqA} → ${maqB}).\n\nDeseja continuar com as etapas unificadas?`,
        'aviso'
      );
      if (!confirmado) return;
    }
    setEtapaSelecionada(etapa);
    setTelaAtual('confirmacao');
  };

  const handleVoltar = () => {
    setTelaAtual('selecao');
    setEtapaSelecionada(null);
  };

  const tituloModal = telaAtual === 'selecao' ? 'Selecionar Tarefa' : 'Confirmar Quantidade';

  return (
    <div className="popup-container op-atribuicao-container" style={{ display: 'flex' }}>
      <div className="popup-overlay" onClick={onClose}></div>
      <div className={`op-modal-atribuir-v2 ${telaAtual === 'selecao' ? 'modo-lista' : 'modo-confirmacao'}`}>

        <div className="op-modal-header">
          <div className="op-modal-header-esquerda">
            {telaAtual === 'confirmacao' && (
              <button className="btn-voltar-header" onClick={handleVoltar}>
                <i className="fas fa-arrow-left"></i> Voltar
              </button>
            )}
          </div>

          <div className="op-modal-header-centro">
            <h3 className="op-modal-titulo">{tituloModal}</h3>
            <div className="op-modal-header-info">
              <span className="op-modal-header-para">Para:</span>
              <span className="nome-destaque-modal">{funcionario?.nome?.split(' ')[0]}</span>
              <span className={`op-modal-role-badge ${role.classe}`}>
                <i className={`fas ${role.icon}`}></i> {role.label}
              </span>
            </div>
          </div>

          <div className="op-modal-header-direita">
            <button className="op-modal-fechar-btn" onClick={onClose}>
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>

        {modoHoraExtra && (
          <div className="op-modal-aviso-hora-extra">
            <i className="fas fa-exclamation-triangle"></i> Lançamento em Hora Extra — será registrado e o gerente será notificado
          </div>
        )}

        <div className="op-modal-body">
          {telaAtual === 'selecao' && (
            <OPTelaSelecaoEtapa
                onEtapaSelect={handleEtapaSelect}
                funcionario={funcionario}
            />
          )}

          {telaAtual === 'confirmacao' && etapaSelecionada && (
            <OPTelaConfirmacaoQtd
                etapa={etapaSelecionada}
                funcionario={funcionario}
                onClose={onClose}
                tpp={tpp}
                modoHoraExtra={modoHoraExtra}
            />
          )}
        </div>

      </div>
    </div>
  );
}
