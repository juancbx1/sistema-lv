import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { fetchFinanceiro } from '../utils/financeiro-api';
import type {
  FinanceiroAgendaItem,
  FinanceiroAgendaModalRequest,
  FinanceiroConfigModalRequest,
  FinanceiroLancamento,
  FinanceiroRefreshScope,
  FinanceiroRefreshTokens,
  FinanceiroSharedConfig,
  FinanceiroTab,
  FinanceiroView,
} from '../utils/financeiro-types';

interface FinanceiroContextValue {
  view: FinanceiroView;
  tab: FinanceiroTab;
  setView: (view: FinanceiroView) => void;
  setTab: (tab: FinanceiroTab) => void;
  notificacoesAbertas: boolean;
  toggleNotificacoes: () => void;
  setNotificacoesAbertas: (open: boolean) => void;
  agendaFiltro: string;
  navigateToAgenda: (filtro?: string) => void;
  tokens: FinanceiroRefreshTokens;
  refresh: (scope?: FinanceiroRefreshScope) => void;
  config: FinanceiroSharedConfig;
  reloadConfig: () => Promise<void>;
  permissoes: string[];
  pageReady: boolean;
  markHeaderReady: () => void;
  lancamentoModal: { open: boolean; lancamento: FinanceiroLancamento | null };
  openLancamentoModal: (lancamento?: FinanceiroLancamento | null) => void;
  closeLancamentoModal: () => void;
  agendaModal: FinanceiroAgendaModalRequest | null;
  openAgendaModal: (request: FinanceiroAgendaModalRequest) => void;
  closeAgendaModal: () => void;
  transferenciaOpen: boolean;
  openTransferenciaModal: () => void;
  closeTransferenciaModal: () => void;
  estornoItem: FinanceiroLancamento | null;
  openEstornoModal: (item: FinanceiroLancamento) => void;
  closeEstornoModal: () => void;
  configModal: FinanceiroConfigModalRequest | null;
  openConfigModal: (request: FinanceiroConfigModalRequest) => void;
  closeConfigModal: () => void;
  concessionariaOpen: boolean;
  openConcessionariaModal: () => void;
  closeConcessionariaModal: () => void;
}

const emptyConfig: FinanceiroSharedConfig = { contas: [], categorias: [], grupos: [] };
const emptyTokens: FinanceiroRefreshTokens = { dashboard: 0, lancamentos: 0, agenda: 0, config: 0, feed: 0, header: 0 };

const FinanceiroContext = createContext<FinanceiroContextValue | null>(null);

function readPermissoes(): string[] {
  try {
    return JSON.parse(localStorage.getItem('permissoes') || '[]') as string[];
  } catch {
    return [];
  }
}

export function FinanceiroProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<FinanceiroView>('main');
  const [tab, setTabState] = useState<FinanceiroTab>('dashboard');
  const [notificacoesAbertas, setNotificacoesAbertas] = useState(false);
  const [agendaFiltro, setAgendaFiltro] = useState('');
  const [tokens, setTokens] = useState<FinanceiroRefreshTokens>(emptyTokens);
  const [config, setConfig] = useState<FinanceiroSharedConfig>(emptyConfig);
  const [pageReady, setPageReady] = useState(false);
  const [permissoes] = useState(readPermissoes);
  const [lancamentoModal, setLancamentoModal] = useState<{ open: boolean; lancamento: FinanceiroLancamento | null }>({ open: false, lancamento: null });
  const [agendaModal, setAgendaModal] = useState<FinanceiroAgendaModalRequest | null>(null);
  const [transferenciaOpen, setTransferenciaOpen] = useState(false);
  const [estornoItem, setEstornoItem] = useState<FinanceiroLancamento | null>(null);
  const [configModal, setConfigModal] = useState<FinanceiroConfigModalRequest | null>(null);
  const [concessionariaOpen, setConcessionariaOpen] = useState(false);

  const setView = useCallback((next: FinanceiroView) => {
    setViewState(next);
    if (next !== 'main') setNotificacoesAbertas(false);
  }, []);

  const setTab = useCallback((next: FinanceiroTab) => {
    setTabState(next);
    setViewState('main');
    setNotificacoesAbertas(false);
  }, []);

  const toggleNotificacoes = useCallback(() => {
    setNotificacoesAbertas((open) => !open);
  }, []);

  const navigateToAgenda = useCallback((filtro = '') => {
    setAgendaFiltro(filtro);
    setViewState('main');
    setTabState('agenda');
    setNotificacoesAbertas(false);
    setTokens((current) => ({ ...current, agenda: current.agenda + 1 }));
  }, []);

  const refresh = useCallback((scope: FinanceiroRefreshScope = 'all') => {
    setTokens((current) => {
      if (scope === 'all') {
        return {
          dashboard: current.dashboard + 1,
          lancamentos: current.lancamentos + 1,
          agenda: current.agenda + 1,
          config: current.config + 1,
          feed: current.feed + 1,
          header: current.header + 1,
        };
      }
      return { ...current, [scope]: current[scope] + 1 };
    });
  }, []);

  const reloadConfig = useCallback(async () => {
    const data = await fetchFinanceiro<FinanceiroSharedConfig>('/configuracoes');
    setConfig({
      contas: data.contas ?? [],
      categorias: data.categorias ?? [],
      grupos: data.grupos ?? [],
    });
  }, []);

  const value = useMemo<FinanceiroContextValue>(() => ({
    view,
    tab,
    setView,
    setTab,
    notificacoesAbertas,
    toggleNotificacoes,
    setNotificacoesAbertas,
    agendaFiltro,
    navigateToAgenda,
    tokens,
    refresh,
    config,
    reloadConfig,
    permissoes,
    pageReady,
    markHeaderReady: () => setPageReady(true),
    lancamentoModal,
    openLancamentoModal: (lancamento = null) => setLancamentoModal({ open: true, lancamento }),
    closeLancamentoModal: () => setLancamentoModal({ open: false, lancamento: null }),
    agendaModal,
    openAgendaModal: (request) => setAgendaModal(request),
    closeAgendaModal: () => setAgendaModal(null),
    transferenciaOpen,
    openTransferenciaModal: () => setTransferenciaOpen(true),
    closeTransferenciaModal: () => setTransferenciaOpen(false),
    estornoItem,
    openEstornoModal: (item) => setEstornoItem(item),
    closeEstornoModal: () => setEstornoItem(null),
    configModal,
    openConfigModal: (request) => setConfigModal(request),
    closeConfigModal: () => setConfigModal(null),
    concessionariaOpen,
    openConcessionariaModal: () => setConcessionariaOpen(true),
    closeConcessionariaModal: () => setConcessionariaOpen(false),
  }), [
    view, tab, setView, setTab, notificacoesAbertas, toggleNotificacoes, agendaFiltro, navigateToAgenda,
    tokens, refresh, config, reloadConfig, permissoes, pageReady, lancamentoModal, agendaModal,
    transferenciaOpen, estornoItem, configModal, concessionariaOpen,
  ]);

  return <FinanceiroContext.Provider value={value}>{children}</FinanceiroContext.Provider>;
}

export function useFinanceiro(): FinanceiroContextValue {
  const context = useContext(FinanceiroContext);
  if (!context) throw new Error('useFinanceiro deve ser usado dentro de FinanceiroProvider.');
  return context;
}

export type { FinanceiroAgendaItem };
