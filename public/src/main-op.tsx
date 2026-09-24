// public/src/main-op.tsx

import { Component, type ComponentType, type ErrorInfo, type ReactNode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import UIHeaderPagina from './components/UIHeaderPagina';
import UITabNav from './components/UITabNav';
import OPPainelAtividades from './components/OPPainelAtividades.jsx';
import OPGerenciamentoTela from './components/OPGerenciamentoTela.tsx';
  import OPCortesTela from './components/OPCortesTela.tsx';
import OPModalTempos from './components/OPModalTempos.tsx';
import OPCriarModal from './components/OPCriarModal.tsx';
  import OPExternoTela from './components/OPExternoTela.tsx';
import BotaoBuscaFunil from './components/BotaoBuscaFunil.tsx';
import AlertasFAB from './components/AlertasFAB.jsx';
import ProducaoHistoricoModal from './components/ProducaoHistoricoModal.jsx';
import UIBloqueio from './components/UIBloqueio';
import UICarregando from './components/UICarregando';

// @ts-expect-error módulo JS legado sem declaração TypeScript
import { verificarAutenticacao } from '/js/utils/auth.js';
import type {
  BotaoBuscaFunilProps,
  OpCriarModalDados,
  OpCriarModalProps,
  OpGerenciamentoProps,
  OpInicioProducaoDados,
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

function App() {
  const [visaoAtual, setVisaoAtual] = useState<OpVisao>('painel');
  const [modalTppAberto, setModalTppAberto] = useState(false);
  const [qtdOpsPendentes, setQtdOpsPendentes] = useState(0);
  const [estaAutenticado, setEstaAutenticado] = useState(false);
  const [verificandoAuth, setVerificandoAuth] = useState(true);
  const [permissoes, setPermissoes] = useState<string[]>([]);
  const [opCriarModalAberto, setOpCriarModalAberto] = useState(false);
  const [opCriarModalDados, setOpCriarModalDados] = useState<OpCriarModalDados | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      try {
        const auth = await verificarAutenticacao(
          'ordens-de-producao.html',
          ['acesso-ordens-de-producao', 'acesso-ordens-de-arremates'],
          'any',
        );
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

  const atualizarMonitoramento = useCallback(() => {
    window.dispatchEvent(new CustomEvent('op-encerrada'));
  }, []);

  useEffect(() => {
    if (!permissoes.includes('acesso-monitoramento-ops')) {
      setQtdOpsPendentes(0);
      return undefined;
    }
    const handleAtualizacao = (event: Event) => {
      const detail = (event as CustomEvent<{ resumo?: { pendentes_acao?: number } }>).detail;
      setQtdOpsPendentes(Number(detail?.resumo?.pendentes_acao) || 0);
    };
    window.addEventListener('lv:op-monitoramento-atualizado', handleAtualizacao);
    return () => {
      window.removeEventListener('lv:op-monitoramento-atualizado', handleAtualizacao);
    };
  }, [permissoes]);

  if (verificandoAuth) {
    return <UICarregando variante="pagina" texto="Carregando Produções..." />;
  }

  if (!estaAutenticado) return null;

  return (
    <ErrorBoundary>
      <UIHeaderPagina titulo="Produções">
        <UIBloqueio
          permissao={['acesso-producao-geral', 'acesso-ordens-de-producao', 'acesso-ordens-de-arremates']}
          mensagem="Você não tem permissão para consultar o histórico geral de produções."
        >
          <button
            type="button"
            className="gs-btn gs-btn-secundario gs-btn-com-icone"
            title="Consultar histórico geral de Produções"
            onClick={() => setHistoricoAberto(true)}
          >
            <i className="fas fa-clipboard-list" />
            <span>Histórico</span>
          </button>
        </UIBloqueio>
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
      <UITabNav
        ariaLabel="Visões das ordens de produção"
        activeId={visaoAtual}
        onChange={(id) => setVisaoAtual(id as OpVisao)}
        items={[
          { id: 'painel', label: 'Painel', icon: 'fa-users' },
          {
            id: 'gerenciamento',
            label: 'OPs',
            icon: 'fa-list-alt',
            dot: qtdOpsPendentes > 0,
            dotLabel: 'Há OPs prontas para finalizar',
          },
          { id: 'cortes', label: 'Cortes', icon: 'fa-cut' },
          { id: 'externo', label: 'P. Externo', icon: 'fa-user-tie' },
        ]}
      />
      <div className="gs-conteudo-pagina">
        {visaoAtual === 'painel' && <OPPainelAtividades />}
        {visaoAtual === 'gerenciamento' && (
          <OPGerenciamentoTelaTipado
            opsPendentesGlobal={qtdOpsPendentes}
            onRefreshContadores={atualizarMonitoramento}
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
          onOPCriada={() => { setOpCriarModalAberto(false); setOpCriarModalDados(null); atualizarMonitoramento(); }}
          demandaId={opCriarModalDados.demandaId}
          produtoId={opCriarModalDados.produtoId}
          variante={opCriarModalDados.variante}
          quantidadeSugerida={opCriarModalDados.quantidadeSugerida}
        />
      )}
      <ProducaoHistoricoModal
        isOpen={historicoAberto}
        onClose={() => setHistoricoAberto(false)}
        podeEstornar={permissoes.includes('estornar-arremate')}
      />
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
// O CSS global mantém páginas protegidas invisíveis até a autenticação.
// Liberamos a pintura para que o UICarregando apareça durante essa verificação.
document.body.classList.add('autenticado');
if (container) createRoot(container).render(<App />);
