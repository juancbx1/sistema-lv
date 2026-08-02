import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
// @ts-expect-error módulo JS legado sem tipos
import { verificarAutenticacao } from '/js/utils/auth.js';
import CalendarioCompleto from './components/CalendarioCompleto';

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[Calendario] crash:', error, errorInfo);
    }

    render() {
        if (this.state.error) {
            return (
                <div style={{ padding: 24, color: 'red' }} role="alert">
                    Erro ao carregar calendário: {this.state.error.message}
                </div>
            );
        }
        return this.props.children;
    }
}

function App() {
    const [carregando, setCarregando] = useState(true);
    const [autenticado, setAutenticado] = useState(false);

    useEffect(() => {
        const checarAuth = async () => {
            try {
                const auth = await verificarAutenticacao('admin/calendario.html', []);
                if (auth) setAutenticado(true);
            } catch (e) {
                console.error('[Calendario] Erro auth:', e);
            }
            setCarregando(false);
        };
        void checarAuth();
    }, []);

    if (carregando) return <div style={{ padding: 24 }}>Verificando permissões...</div>;
    if (autenticado) {
        return (
            <ErrorBoundary>
                <CalendarioCompleto />
            </ErrorBoundary>
        );
    }
    return null;
}

const rootElement = document.getElementById('root');
if (rootElement) {
    createRoot(rootElement).render(<App />);
}
