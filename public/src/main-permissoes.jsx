import React from 'react';
import { createRoot } from 'react-dom/client';
import PermissoesPage from './components/PermissoesPage.jsx';
import { verificarAutenticacao } from '../js/utils/auth.js';

async function init() {
    const auth = await verificarAutenticacao('admin/permissoes-usuarios.html', ['acesso-permissoes-usuarios']);
    if (!auth) return;
    createRoot(document.getElementById('root')).render(<PermissoesPage />);
}
init();
