// public/src/main-op.tsx

import { Component, type ComponentType, type ErrorInfo, type ReactNode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import UIHeaderPagina from './components/UIHeaderPagina';
import OPPainelAtividades from './components/OPPainelAtividades.jsx';
import OPGerenciamentoTela from './components/OPGerenciamentoTela.tsx';
  import OPCortesTela from './components/OPCortesTela.tsx';
import OPModalTempos from './components/OPModalTempos.tsx';
import OPCriarModal from './components/OPCriarModal.tsx';
  import OPExternoTela from './components/OPExternoTela.tsx';
import BotaoBuscaFunil from './components/BotaoBuscaFunil.tsx';
import AlertasFAB from './components/AlertasFAB.jsx';
import UIBloqueio from './components/UIBloqueio';

// @ts-expect-error módulo JS legado sem declaração TypeScript
import { verificarAutenticacao } from '/js/utils/auth.js';
import type {
  BotaoBuscaFunilProps,
  OpCriarModalDados,
  OpCriarModalProps,
  OpGerenciamentoProps,
  OpInicioProducaoDados,
  OpListResponse,
  OpVisao,
} from './utils/op-types';

// Fronteiras temporárias para componentes JSX ainda não tipados.
const OPGerenciamentoTelaTipado = OPGerenciamentoTela as unknown as ComponentType<OpGerenciamentoProps>;
const OPCriarModalTipado = OPCriarModal as unknown as ComponentType<OpCriarModalProps>;
const BotaoBuscaFunilTipado = BotaoBuscaFunil as unknown as ComponentType<BotaoBuscaFunilProps>;

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('REACT CRASHOU:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: 'red', textAlign: 'center' }}>
          <h2>Algo deu errado na aplicação.</h2>
          <details>{this.state.error?.toString()}</details>
          <button type="button" onClick={() => window.location.reload()}>Recarregar</button>
        </div>
      );
    }
    return this.props.children;
  }
}

async function fetchSimples<T>(url: string): Promise<T> {
  const token = localStorage.getItem('token');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Erro fetch');
  return res.json() as Promise<T>;
}

function App() {
  const [visaoAtual, setVisaoAtual] = useState<OpVisao>('painel');
  const [modalTppAberto, setModalTppAberto] = useState(false);
  const [qtdOpsPendentes, setQtdOpsPendentes] = useState(0);
  const [estaAutenticado, setEstaAutenticado] = useState(false);
  const [verificandoAuth, setVerificandoAuth] = useState(true);
  const [permissoes, setPermissoes] = useState<string[]>([]);
  const [opCriarModalAberto, setOpCriarModalAberto] = useState(false);
  const [opCriarModalDados, setOpCriarModalDados] = useState<OpCriarModalDados | null>(null);

  useEffect(() => {
    async function checkAuth() {
      try {
        const auth = await verificarAutenticacao('ordens-de-producao.html', ['acesso-ordens-de-producao']);
        if (auth) {
          setEstaAutenticado(true);
          setPermissoes(auth.permissoes || []);
          const params = new URLSearchParams(window.location.search);
          const demandaId = params.get('demanda_id');
          if (demandaId) {
            setOpCriarModalDados({
              demandaId: Number.parseInt(demandaId, 10),
              produtoId: Number.parseInt(params.get('produto_id') || '', 10),
              variante: params.get('variante') || null,
              quantidadeSugerida: Number.parseInt(params.get('quantidade') || '0', 10) || 0,
            });
            setOpCriarModalAberto(true);
            window.history.replaceState({}, '', window.location.pathname);
          }
          document.body.classList.add('autenticado');
        } else {
          document.body.innerHTML = '<p style="text-align:center; padding:20px;">Redirecionando...</p>';
        }
      } catch (error) {
        console.error('Erro na autenticação:', error);
      } finally {
        setVerificandoAuth(false);
      }
    }
    void checkAuth();
  }, []);

  const verificarOpsProntas = useCallback(async () => {
    if (!estaAutenticado) return;
    try {
      const data = await fetchSimples<OpListResponse>('/api/ordens-de-producao?status=produzindo&limit=100');
      const rows = Array.isArray(data.rows) ? data.rows : [];
      if (rows.length === 0) {
        setQtdOpsPendentes(0);
        return;
      }
      const contagem = rows.reduce((acc, op) => {
        if (!op) return acc;
        const etapasOk = Array.isArray(op.etapas)
          && op.etapas.length > 0
          && op.etapas.every((etapa) => etapa.lancado);
        return etapasOk ? acc + 1 : acc;
      }, 0);
      setQtdOpsPendentes(contagem);
    } catch (error) {
      console.error('[Monitor OP] Erro:', error);
    }
  }, [estaAutenticado]);

  useEffect(() => {
    if (!estaAutenticado) return undefined;
    void verificarOpsProntas();
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === 'visible') void verificarOpsProntas();
    }, 30_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void verificarOpsProntas();
    };
    const handleFocus = () => void verificarOpsProntas();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [estaAutenticado, verificarOpsProntas]);

  if (verificandoAuth || !estaAutenticado) return null;

  return (
    <ErrorBoundary>
      <UIHeaderPagina titulo="Ordens de Produção">
        <UIBloqueio permissao="configurar-tempos-padrao">
          <button
            type="button"
            className="gs-btn gs-btn-secundario"
            title="Configurar Tempos Padrão de Produção"
            onClick={() => setModalTppAberto(true)}
          >
            <i className="fas fa-cog" />
          </button>
        </UIBloqueio>
      </UIHeaderPagina>
      <nav className="gs-tab-nav">
        <button type="button" className={`gs-tab-btn ${visaoAtual === 'painel' ? 'ativo' : ''}`} onClick={() => setVisaoAtual('painel')}>
          <i className="fas fa-users" /> Painel
        </button>
        <button type="button" className={`gs-tab-btn ${visaoAtual === 'gerenciamento' ? 'ativo' : ''}`} onClick={() => setVisaoAtual('gerenciamento')}>
          <i className="fas fa-list-alt" /> OPs
          {qtdOpsPendentes > 0 && <span className="op-tab-pulso-dot" title="Há OPs prontas para finalizar" />}
        </button>
        <button type="button" className={`gs-tab-btn ${visaoAtual === 'cortes' ? 'ativo' : ''}`} onClick={() => setVisaoAtual('cortes')}>
          <i className="fas fa-cut" /> Cortes
        </button>
        <button type="button" className={`gs-tab-btn ${visaoAtual === 'externo' ? 'ativo' : ''}`} onClick={() => setVisaoAtual('externo')}>
          <i className="fas fa-user-tie" /> P. Externo
        </button>
      </nav>
      <div className="gs-conteudo-pagina">
        {visaoAtual === 'painel' && <OPPainelAtividades />}
        {visaoAtual === 'gerenciamento' && (
          <OPGerenciamentoTelaTipado
            opsPendentesGlobal={qtdOpsPendentes}
            onRefreshContadores={verificarOpsProntas}
            permissoes={permissoes}
          />
        )}
        {visaoAtual === 'cortes' && <OPCortesTela />}
        {visaoAtual === 'externo' && <OPExternoTela />}
      </div>
      <OPModalTempos isOpen={modalTppAberto} onClose={() => setModalTppAberto(false)} />
      {opCriarModalDados && (
        <OPCriarModalTipado
          isOpen={opCriarModalAberto}
          onClose={() => { setOpCriarModalAberto(false); setOpCriarModalDados(null); }}
          onOPCriada={() => { setOpCriarModalAberto(false); setOpCriarModalDados(null); void verificarOpsProntas(); }}
          demandaId={opCriarModalDados.demandaId}
          produtoId={opCriarModalDados.produtoId}
          variante={opCriarModalDados.variante}
          quantidadeSugerida={opCriarModalDados.quantidadeSugerida}
        />
      )}
      <BotaoBuscaFunilTipado
        permissoes={permissoes}
        onIniciarProducao={(dados: OpInicioProducaoDados) => {
          setOpCriarModalDados({
            demandaId: dados.demanda_id,
            produtoId: dados.produto_id,
            variante: dados.variante || null,
            quantidadeSugerida: dados.quantidade || 0,
          });
          setOpCriarModalAberto(true);
        }}
      />
      <AlertasFAB />
    </ErrorBoundary>
  );
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
