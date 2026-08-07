// public/src/main-estoque.jsx
// Ponto de entrada React mínimo para a página de Estoque.
// Por ora só monta o FAB (BotaoBuscaFunil) com permissões corretas.
// A página ainda usa vanilla JS (admin-estoque.js) e será migrada para React futuramente.

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import BotaoBuscaFunil from './components/BotaoBuscaFunil.jsx';
import AlertasFAB from './components/AlertasFAB.jsx';
import { verificarAutenticacao } from '/js/utils/auth.js';

function EstoqueFab() {
    const [permissoes, setPermissoes] = useState([]);

    useEffect(() => {
        verificarAutenticacao('admin/estoque.html', ['acesso-estoque']).then(auth => {
            if (auth) setPermissoes(auth.permissoes || []);
        });
    }, []);

    return (
        <>
            <BotaoBuscaFunil permissoes={permissoes} usarCarregamentoPadrao />
            <AlertasFAB />
        </>
    );
}

const rootElement = document.getElementById('estoque-react-root');
if (rootElement) {
    ReactDOM.createRoot(rootElement).render(<EstoqueFab />);
}
