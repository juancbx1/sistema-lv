// public/src/main-home.tsx

import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
// @ts-expect-error módulo JS legado sem tipos
import { verificarAutenticacao } from '/js/utils/auth.js';

import HOMEHeader from './components/HOMEHeader';
import HOMEQuickActions from './components/HOMEQuickActions';
import HOMENews from './components/HOMENews';
// AlertasFAB permanece em JSX (FAB compartilhado entre páginas admin)
import AlertasFAB from './components/AlertasFAB.jsx';
import type { HomeAuthResult, HomeUsuario } from './utils/home-types';

function App() {
    const [usuario, setUsuario] = useState<HomeUsuario | null>(null);
    const [permissoes, setPermissoes] = useState<string[]>([]);
    const [authLoading, setAuthLoading] = useState(true);

    useEffect(() => {
        async function init() {
            // Apenas autenticação. Sem fetches pesados.
            const auth = await verificarAutenticacao('home.html', []) as HomeAuthResult | null | false;
            if (!auth) {
                window.location.href = '/login.html';
                return;
            }

            setUsuario(auth.usuario);
            setPermissoes(auth.permissoes || []);
            setAuthLoading(false);
        }
        void init();
    }, []);

    if (authLoading) return null; // Tela branca rápida enquanto verifica token

    return (
        <>
            <div className="home-content-wrapper">
                {/* 1. Saudação + Data */}
                <HOMEHeader usuario={usuario} />

                {/* 2. Novidades (Importante para comunicação) */}
                <HOMENews />

                {/* 3. O Protagonista: Menu de Ações */}
                <HOMEQuickActions permissoes={permissoes} />
            </div>
            <AlertasFAB />
        </>
    );
}

const rootElement = document.getElementById('home-react-root');
if (rootElement) {
    createRoot(rootElement).render(<App />);
}
