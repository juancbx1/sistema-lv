import React from 'react';
import ReactDOM from 'react-dom/client';
import { verificarAutenticacao } from '/js/utils/auth.js';
import PGPainelPage from './components/PGPainelPage.jsx';

async function init() {
    const auth = await verificarAutenticacao('admin/producao-geral.html', ['acesso-producao-geral']);
    if (!auth) return;

    document.body.classList.add('autenticado');
    document.getElementById('lv-initial-page-loader')?.remove();

    const container = document.getElementById('root');
    if (container) ReactDOM.createRoot(container).render(<PGPainelPage />);
}

init();
