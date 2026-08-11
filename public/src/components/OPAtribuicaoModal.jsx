// public/src/components/OPAtribuicaoModal.jsx

import React, { useState, useEffect } from 'react';
import { mostrarConfirmacao } from '/js/utils/popups.js';
import { obterChaveTarefa } from '../utils/op-tarefas';

import OPTelaSelecaoEtapa from './OPTelaSelecaoEtapa.tsx';
import OPTelaConfirmacaoQtd from './OPTelaConfirmacaoQtd.jsx';

const getRoleInfo = (tipos = []) => {
    if (tipos?.includes('tiktik'))   return { label: 'TikTik',    icon: 'fa-cut',         classe: 'badge-tiktik' };
    if (tipos?.includes('cortador')) return { label: 'Cortador',  icon: 'fa-layer-group', classe: 'badge-cortador' };
    return                                  { label: 'Costureira', icon: 'fa-tshirt',      classe: 'badge-costureira' };
};

const maquinaRepresentaUsoFisico = (maquina) => {
  const normalizada = String(maquina || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return normalizada !== '' && normalizada !== 'nao usa';
};

const percursoMudaMaquinaFisica = (etapas = []) => etapas.some((etapa, indice) => {
  if (indice === 0) return false;
  const anterior = etapas[indice - 1];
  if (!maquinaRepresentaUsoFisico(etapa?.maquina) || !maquinaRepresentaUsoFisico(anterior?.maquina)) {
    return false;
  }
  return String(etapa.maquina).trim() !== String(anterior.maquina).trim();
});

export default function OPAtribuicaoModal({ funcionario, isOpen, onClose, tpp, onConfirmarLote, fasesPermitidas }) {
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
  const itensSelecionados = Array.isArray(etapaSelecionada)
    ? etapaSelecionada
    : etapaSelecionada ? [etapaSelecionada] : [];
  const fasesSelecionadas = [...new Set(itensSelecionados.map(item => item?.fase === 'POS_OP' ? 'POS_OP' : 'OP'))];
  const resumoFases = [
    fasesSelecionadas.includes('OP') && { id: 'op', label: 'Processos da OP' },
    fasesSelecionadas.includes('POS_OP') && { id: 'pos-op', label: 'Arremates pós-OP' },
  ].filter(Boolean);

  const handleEtapaSelect = async (etapa) => {
    // Percurso unificado com troca de máquina → confirmar antes de avançar.
    const itensRecebidos = Array.isArray(etapa) ? etapa : [etapa];
    const itemComTroca = itensRecebidos.find(item => {
      if (!item?._unificada || !item?._grupo_unificacao?.muda_maquina) return false;
      return percursoMudaMaquinaFisica(item?._grupo_unificacao?.etapas);
    });
    if (itemComTroca) {
      const etapas = itemComTroca._grupo_unificacao.etapas;
      const maqA = etapas[0]?.maquina || '?';
      const maqB = etapas[etapas.length - 1]?.maquina || '?';
      const primeiroNome = funcionario?.nome?.split(' ')[0] || funcionario?.nome;
      const confirmado = await mostrarConfirmacao(
        `${primeiroNome} precisará trocar de máquina durante esta tarefa (${maqA} → ${maqB}).\n\nDeseja continuar com as etapas unificadas?`,
        { tipo: 'aviso' }
      );
      if (!confirmado) return;
    }
    setEtapaSelecionada(etapa);
    setTelaAtual('confirmacao');
  };

  const handleVoltar = () => {
    setTelaAtual('selecao');
  };

  const handleVoltarTarefa = (itemRemovido) => {
    const chaveRemovida = obterChaveTarefa(itemRemovido);
    const restantes = itensSelecionados.filter(item => obterChaveTarefa(item) !== chaveRemovida);
    setEtapaSelecionada(restantes);
    if (restantes.length === 0) setTelaAtual('selecao');
  };

  const fotoFuncionario = typeof funcionario?.avatar_url === 'string' && !funcionario.avatar_url.includes('image.jfif')
    ? funcionario.avatar_url
    : funcionario?.foto_oficial || null;
  const nomeFuncionario = funcionario?.nome?.split(' ')[0] || 'Funcionário';

  return (
    <div className="popup-container op-atribuicao-container" style={{ display: 'flex' }}>
      <div className="popup-overlay" onClick={onClose}></div>
      <div className={`op-modal-atribuir-v2 ${telaAtual === 'selecao' ? 'modo-lista' : 'modo-confirmacao'}`}>

        <div className={`op-modal-header op-modal-header--${telaAtual}`}>
          <div className="op-modal-header-esquerda">
            {telaAtual === 'confirmacao' && (
              <button className="btn-voltar-header" onClick={handleVoltar} aria-label="Voltar para selecionar tarefa">
                <i className="fas fa-arrow-left"></i>
                <span>Voltar</span>
              </button>
            )}
            <div className={`op-modal-header-perfil ${role.classe}`} aria-label={`Tarefa para ${funcionario?.nome || 'funcionário'}: ${role.label}`}>
              <div className="op-modal-header-avatar">
                <i className={`fas ${role.icon}`} aria-hidden="true"></i>
                {fotoFuncionario && (
                  <img src={fotoFuncionario} alt="" onError={(event) => event.currentTarget.remove()} />
                )}
                <strong className="op-modal-header-avatar-nome">{nomeFuncionario}</strong>
              </div>
              <span className="op-modal-header-profissao">{role.label}</span>
            </div>
          </div>

          <div className="op-modal-header-centro">
            <div className="op-modal-progresso" aria-label={`Parte ${telaAtual === 'selecao' ? 1 : 2} de 2`}>
              <span className="op-modal-progresso-texto">PARTE</span>
              <span className={`op-modal-progresso-numero ${telaAtual === 'selecao' ? 'ativo' : ''}`}>1</span>
              <span className="op-modal-progresso-texto">DE</span>
              <span className={`op-modal-progresso-numero ${telaAtual === 'confirmacao' ? 'ativo' : ''}`}>2</span>
            </div>
            <div className="op-modal-stepper" aria-label="Fluxo de atribuição">
              <div className={`op-modal-step op-modal-step--selecao${telaAtual === 'selecao' ? ' ativo' : ''}`}>
                <span className="op-modal-step-marcador" aria-hidden="true"></span>
                {telaAtual === 'selecao'
                  ? <h3 className="op-modal-step-titulo">Selecionar tarefa</h3>
                  : <span className="op-modal-step-titulo">Selecionar tarefa</span>}
              </div>
              <span className="op-modal-step-linha" aria-hidden="true"></span>
              <div className={`op-modal-step op-modal-step--confirmacao${telaAtual === 'confirmacao' ? ' ativo' : ''}`}>
                <span className="op-modal-step-marcador" aria-hidden="true"></span>
                {telaAtual === 'confirmacao'
                  ? <h3 className="op-modal-step-titulo">Confirmar quantidades</h3>
                  : <span className="op-modal-step-titulo">Confirmar quantidades</span>}
              </div>
            </div>
            <div className="op-modal-header-selecao">
              <span className="op-modal-header-selecao-label">Selecionado:</span>
              <div className="op-modal-header-selecao-fases">
                {resumoFases.length > 0 ? resumoFases.map((fase, indice) => (
                  <React.Fragment key={fase.id}>
                    {indice > 0 && <span className="op-modal-header-selecao-mais" aria-hidden="true">+</span>}
                    <span className={`op-modal-header-selecao-pill op-modal-header-selecao-pill--${fase.id}`}>{fase.label}</span>
                  </React.Fragment>
                )) : (
                  <span className="op-modal-header-selecao-vazio">Nenhuma tarefa selecionada</span>
                )}
              </div>
            </div>
          </div>

          <div className="op-modal-header-direita">
            <button className="op-modal-fechar-btn" onClick={onClose} aria-label="Fechar atribuição">
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
                selecionadosIniciais={etapaSelecionada}
                onSelectionChange={setEtapaSelecionada}
                fasesPermitidas={fasesPermitidas}
            />
          )}

          {telaAtual === 'confirmacao' && etapaSelecionada && (
            <OPTelaConfirmacaoQtd
                etapa={etapaSelecionada}
                funcionario={funcionario}
                onClose={onClose}
                onVoltarTarefa={handleVoltarTarefa}
                tpp={tpp}
                modoHoraExtra={modoHoraExtra}
                onConfirmarLote={onConfirmarLote}
            />
          )}
        </div>

      </div>
    </div>
  );
}
