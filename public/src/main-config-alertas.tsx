// public/src/main-config-alertas.tsx

import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
// @ts-expect-error módulo JS legado sem tipos
import { verificarAutenticacao } from '/js/utils/auth.js';
import ConfigAlertasPage from './pages/ConfigAlertas/ConfigAlertasPage';
import UICarregando from './components/UICarregando';
import removerCarregamentoInicial from './utils/remover-carregamento-inicial';

function App() {
    const [carregando, setCarregando] = useState(true);
    const [autenticado, setAutenticado] = useState(false);

    useEffect(() => {
        const checarAuth = async () => {
            try {
                const auth = await verificarAutenticacao('admin/config-alertas.html', ['configurar-alertas']);
                if (auth) {
                    removerCarregamentoInicial();
                    setAutenticado(true);
                }
            } catch (e) {
                console.error('[ConfigAlertas] Erro auth:', e);
            }
            setCarregando(false);
        };

        void checarAuth();
    }, []);

    if (carregando) {
        return <UICarregando variante="pagina" texto="Verificando permissões..." />;
    }

    if (autenticado) {
        return <ConfigAlertasPage />;
    }

    return null;
}

const rootElement = document.getElementById('root');
if (rootElement) {
    createRoot(rootElement).render(<App />);
}
