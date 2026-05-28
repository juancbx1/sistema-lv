import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { verificarAutenticacao } from '/js/utils/auth.js';
import UICarregando from './components/UICarregando.jsx';
import GPPage from './components/GPPage.jsx';

function App() {
    const [carregando, setCarregando] = useState(true);
    const [autenticado, setAutenticado] = useState(false);

    useEffect(() => {
        const checarAuth = async () => {
            const auth = await verificarAutenticacao('admin/gerenciar-producao.html', ['acesso-gerenciar-producao']);
            if (auth) setAutenticado(true);
            setCarregando(false);
        };
        checarAuth();
    }, []);

    if (carregando) return <UICarregando variante="pagina" />;
    if (!autenticado) return null;

    return <GPPage />;
}

const rootElement = document.getElementById('root');
if (rootElement) {
    ReactDOM.createRoot(rootElement).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}
