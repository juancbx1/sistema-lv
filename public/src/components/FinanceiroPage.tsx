import { useEffect } from 'react';
import UIHeaderPagina from './UIHeaderPagina.jsx';
import { verificarAutenticacao } from '../../js/utils/auth.js';
import { FinanceiroProvider, useFinanceiro } from './FinanceiroContext';
import FinanceiroHeader from './FinanceiroHeader';
import FinanceiroDashboard from './FinanceiroDashboard';
import LancamentosView from './LancamentosView';
import FinanceiroAgenda from './FinanceiroAgenda';
import FinanceiroConfiguracoes from './FinanceiroConfiguracoes';
import FinanceiroAprovacoes from './FinanceiroAprovacoes';
import FinanceiroNotificacoes from './FinanceiroNotificacoes';
import FeedAtividades from './FeedAtividades';
import RelatoriosView from './RelatoriosView';
import ModalLancamento from './ModalLancamento';
import FinanceiroAgendaModal from './FinanceiroAgendaModal';
import FinanceiroTransferenciaModal from './FinanceiroTransferenciaModal';
import FinanceiroEstornoModal from './FinanceiroEstornoModal';
import FinanceiroConfiguracaoModal from './FinanceiroConfiguracaoModal';
import FinanceiroConcessionariaModal from './FinanceiroConcessionariaModal';
import type { FinanceiroTab, FinanceiroView } from '../utils/financeiro-types';

function FinanceiroShell() {
  const {
    view, tab, setView, setTab, notificacoesAbertas, toggleNotificacoes, setNotificacoesAbertas,
    pageReady, openLancamentoModal, openAgendaModal, openTransferenciaModal,
    lancamentoModal, closeLancamentoModal, refresh, config, reloadConfig, permissoes,
  } = useFinanceiro();

  useEffect(() => {
    let ativo = true;
    void verificarAutenticacao('admin/financeiro.html', ['acesso-financeiro'])
      .then((auth) => { if (ativo && auth) document.body.classList.add('autenticado'); })
      .catch(() => undefined);
    return () => { ativo = false; };
  }, []);

  useEffect(() => {
    void reloadConfig().catch(() => undefined);
  }, [reloadConfig]);

  useEffect(() => {
    if (pageReady) document.getElementById('carregamentoGlobal')?.classList.remove('visivel');
  }, [pageReady]);

  const isMain = view === 'main';
  const showFabLancamentos = isMain && tab === 'lancamentos';
  const showFabAgenda = isMain && tab === 'agenda';

  const headerButtons: Array<{ view: FinanceiroView; id: string; icon: string; title: string }> = [
    { view: 'aprovacoes', id: 'btnIrParaAprovacoes', icon: 'fa-check-double', title: 'Aprovações' },
    { view: 'historico', id: 'btnIrParaHistorico', icon: 'fa-history', title: 'Histórico' },
    { view: 'relatorios', id: 'btnIrParaRelatorios', icon: 'fa-chart-bar', title: 'Relatórios' },
    { view: 'configuracoes', id: 'btnToggleConfiguracoes', icon: 'fa-cog', title: 'Configurações' },
  ];

  const toggleView = (target: FinanceiroView) => {
    setView(view === target ? 'main' : target);
    setNotificacoesAbertas(false);
  };

  return (
    <>
      <div id="carregamentoGlobal" className={`gs-carregamento-global-container${pageReady ? '' : ' visivel'}`}>
        <div className="gs-spinner-global" />
      </div>
      <div className="hamburger-menu"><i className="fas fa-bars" /><i className="fas fa-times" /></div>

      <UIHeaderPagina titulo="Financeiro">
        {headerButtons.map((button) => {
          const active = view === button.view;
          return (
            <button
              key={button.id}
              id={button.id}
              type="button"
              className={`gs-btn gs-btn-secundario${active ? ' is-active' : ''}`}
              title={button.title}
              onClick={() => toggleView(button.view)}
            >
              <i className={`fas ${active ? 'fa-times' : button.icon}`} />
            </button>
          );
        })}
        <button
          id="btnNotificacoes"
          type="button"
          className={`gs-btn gs-btn-secundario${notificacoesAbertas ? ' is-notif-open' : ''}`}
          title="Notificações"
          onClick={(event) => {
            toggleNotificacoes();
            // Evita outline/focus residual do clique “colado” no painel
            event.currentTarget.blur();
          }}
        >
          <i className={`fas ${notificacoesAbertas ? 'fa-times' : 'fa-inbox'}`} />
        </button>
      </UIHeaderPagina>

      <nav className="gs-tab-nav">
        {([
          { id: 'dashboard' as FinanceiroTab, icon: 'fa-chart-pie', label: 'Dashboard' },
          { id: 'lancamentos' as FinanceiroTab, icon: 'fa-exchange-alt', label: 'Lançamentos' },
          { id: 'agenda' as FinanceiroTab, icon: 'fa-calendar-alt', label: 'Agenda' },
        ]).map((item) => (
          <button
            key={item.id}
            type="button"
            className={`gs-tab-btn fc-tab-btn${isMain && tab === item.id ? ' ativo active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            <i className={`fas ${item.icon}`} /> {item.label}
          </button>
        ))}
      </nav>

      <div className="gs-conteudo-pagina">
        <FinanceiroHeader />

        {view === 'main' && (
          <section id="viewPrincipal" className="fc-content-wrapper">
            <div className="fc-tabs-content">
              {tab === 'dashboard' && <div id="tab-dashboard" className="fc-tab-panel active"><FinanceiroDashboard /></div>}
              {tab === 'lancamentos' && <div id="tab-lancamentos" className="fc-tab-panel active"><LancamentosView /></div>}
              {tab === 'agenda' && (
                <div id="tab-agenda" className="fc-tab-panel active">
                  <div className="fc-section-container">
                    <header className="fc-table-header">
                      <h2 className="fc-section-title" style={{ border: 0, margin: 0 }}>Contas a Pagar/Receber</h2>
                      <button type="button" id="btnAtualizarAgenda" className="fc-btn-atualizar" onClick={() => refresh('agenda')}>
                        <i className="fas fa-sync-alt" /> Atualizar
                      </button>
                    </header>
                    <FinanceiroAgenda />
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {view === 'configuracoes' && <section id="configuracoesView"><FinanceiroConfiguracoes /></section>}
        {view === 'aprovacoes' && <section id="aprovacoesView"><FinanceiroAprovacoes /></section>}
        {view === 'historico' && (
          <section id="historicoView">
            <FeedAtividades />
          </section>
        )}
        {view === 'relatorios' && <section id="relatoriosView"><RelatoriosView /></section>}
      </div>

      {notificacoesAbertas && <FinanceiroNotificacoes />}

      <div className="fc-fab-container">
        <button
          id="btnNovaTransferencia"
          type="button"
          className={`fc-fab fc-fab-secundario${showFabLancamentos ? '' : ' hidden'}`}
          title="Nova Transferência"
          onClick={openTransferenciaModal}
        >
          <i className="fas fa-exchange-alt" />
        </button>
        <button
          id="btnNovoLancamento"
          type="button"
          className={`fc-fab${showFabLancamentos ? '' : ' hidden'}`}
          title="Novo Lançamento"
          onClick={() => openLancamentoModal(null)}
        >
          <i className="fas fa-plus" />
        </button>
        <button
          id="btnNovoAgendamentoFab"
          type="button"
          className={`fc-fab${showFabAgenda ? '' : ' hidden'}`}
          title="Novo Agendamento"
          style={{ backgroundColor: 'var(--gs-sucesso)' }}
          onClick={() => openAgendaModal({ mode: 'agenda' })}
        >
          <i className="fas fa-calendar-plus" />
        </button>
      </div>

      <ModalLancamento
        isOpen={lancamentoModal.open}
        onClose={closeLancamentoModal}
        onSuccess={() => { refresh('lancamentos'); refresh('dashboard'); refresh('agenda'); refresh('header'); }}
        lancamentoParaEditar={lancamentoModal.lancamento}
        permissoes={permissoes}
        contas={config.contas}
        categorias={config.categorias}
        grupos={config.grupos}
      />
      <FinanceiroAgendaModal />
      <FinanceiroTransferenciaModal />
      <FinanceiroEstornoModal />
      <FinanceiroConfiguracaoModal />
      <FinanceiroConcessionariaModal />
    </>
  );
}

export default function FinanceiroPage() {
  return (
    <FinanceiroProvider>
      <FinanceiroShell />
    </FinanceiroProvider>
  );
}
