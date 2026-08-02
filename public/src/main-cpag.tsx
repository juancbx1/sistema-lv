import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CPAGCentralPagamentos from './components/CPAGCentralPagamentos.tsx';
import type { CpagAuthResult } from './utils/cpag-types';
import { verificarAutenticacaoCpag } from './utils/cpag-auth';

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
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ padding: 20, color: 'red', textAlign: 'center' }} role="alert">
        <h2>Algo deu errado na Central de Pagamentos.</h2>
        <details style={{ whiteSpace: 'pre-wrap' }}>{this.state.error?.toString()}</details>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ padding: '10px 20px', marginTop: '10px', cursor: 'pointer' }}
        >
          Recarregar Página
        </button>
      </div>
    );
  }
}

function App() {
  const [estaAutenticado, setEstaAutenticado] = useState(false);
  const [verificandoAuth, setVerificandoAuth] = useState(true);
  const [permissoes, setPermissoes] = useState<string[]>([]);

  useEffect(() => {
    let ativo = true;
    const checkAuth = async () => {
      try {
        const auth: CpagAuthResult | null = await verificarAutenticacaoCpag(['acessar-central-pagamentos']);
        if (!ativo) return;
        if (auth) {
          setEstaAutenticado(true);
          setPermissoes(auth.permissoes ?? []);
          document.body.classList.add('autenticado');
        }
      } catch (error) {
        console.error('Erro na autenticação:', error);
      } finally {
        if (ativo) setVerificandoAuth(false);
      }
    };
    void checkAuth();
    return () => {
      ativo = false;
    };
  }, []);

  if (verificandoAuth || !estaAutenticado) return <UICpagAuthLoading />;
  return (
    <ErrorBoundary>
      <CPAGCentralPagamentos permissoes={permissoes} />
    </ErrorBoundary>
  );
}

function UICpagAuthLoading() {
  return (
    <div className="ui-cg ui-cg--pagina">
      <div className="ui-cg-spinner ui-cg-spinner--lg">
        <div className="ui-cg-trilha" />
        <div className="ui-cg-arco" />
        <span className="ui-cg-letras">LV</span>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
else console.error("Container 'root' não encontrado no HTML.");
