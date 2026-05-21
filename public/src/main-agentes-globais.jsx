// public/src/main-agentes-globais.jsx
// Entry point dos agentes globais — montado em todas as páginas admin via carregar-menu-lateral.js.
// Gerencia o polling centralizado e passa dados para OPAgenteEncerrador e OPAgenteInterceptor.

import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import OPAgenteEncerrador from './components/OPAgenteEncerrador.jsx';
import OPAgenteInterceptor from './components/OPAgenteInterceptor.jsx';

const POLL_INTERVALO_MS = 5 * 60 * 1000; // 5 minutos
const PENDENTE_KEY      = 'agente_enc_pendente_desde';

function AgentesGlobais() {
    const [opsProntas, setOpsProntas]     = useState([]);
    const [temPermissao, setTemPermissao] = useState(false);
    const [nomeUsuario, setNomeUsuario]   = useState('');

    // Extrai primeiro nome do JWT (sem chamada à API)
    useEffect(() => {
        try {
            const token = localStorage.getItem('token');
            if (!token) return;
            const payload = JSON.parse(atob(token.split('.')[1]));
            setNomeUsuario((payload.nome || '').split(' ')[0]);
        } catch { /* silencioso */ }
    }, []);

    const buscarOps = useCallback(async () => {
        try {
            const token = localStorage.getItem('token');
            if (!token) return;

            const data = await fetch('/api/ordens-de-producao/prontas-para-encerrar', {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json());

            if (Array.isArray(data)) {
                setOpsProntas(data);
                setTemPermissao(true);
                try {
                    if (data.length === 0) {
                        localStorage.removeItem(PENDENTE_KEY);
                    } else if (!localStorage.getItem(PENDENTE_KEY)) {
                        localStorage.setItem(PENDENTE_KEY, String(Date.now()));
                    }
                } catch { /* silencioso */ }
            }
        } catch { /* silencioso — falha silenciosa, não quebra a UI */ }
    }, []);

    // Polling + eventos de atualização
    useEffect(() => {
        buscarOps();

        const interval = setInterval(() => {
            if (document.visibilityState === 'visible') buscarOps();
        }, POLL_INTERVALO_MS);

        const handleVisible   = () => { if (document.visibilityState === 'visible') buscarOps(); };
        const handleOpEncerrada = () => buscarOps();

        document.addEventListener('visibilitychange', handleVisible);
        window.addEventListener('op-encerrada', handleOpEncerrada);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisible);
            window.removeEventListener('op-encerrada', handleOpEncerrada);
        };
    }, [buscarOps]);

    // Não renderiza nada se o usuário não tem permissão (ex: sem acesso-ordens-de-producao)
    if (!temPermissao) return null;

    return (
        <>
            <OPAgenteEncerrador
                opsProntas={opsProntas}
                nomeUsuario={nomeUsuario}
                onRefresh={buscarOps}
            />
            <OPAgenteInterceptor
                opsProntas={opsProntas}
                nomeUsuario={nomeUsuario}
                onRefresh={buscarOps}
            />
        </>
    );
}

// Cria o container e monta
const div = document.createElement('div');
div.id = 'agentes-globais-root';
document.body.appendChild(div);
createRoot(div).render(<AgentesGlobais />);
