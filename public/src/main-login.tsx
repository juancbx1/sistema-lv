// public/src/main-login.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import LoginApp from './components/LoginApp.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Raiz do Login não encontrada.');

ReactDOM.createRoot(root).render(
    <React.StrictMode>
        <LoginApp />
    </React.StrictMode>,
);
