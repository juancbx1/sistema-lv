// public/src/main-agentes-globais.jsx
// Entry point dos agentes globais — carregado uma única vez pelo menu administrativo.
// Gerencia o polling centralizado e passa dados para OPAgenteEncerrador e OPAgenteInterceptor.

import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import OPAgenteEncerrador from './components/OPAgenteEncerrador.jsx';
import OPAgenteInterceptor from './components/OPAgenteInterceptor.jsx';

const POLL_INTERVALO_MS = 5 * 60 * 1000; // 5 minutos
const PENDENTE_KEY      = 'agente_enc_pendente_desde';

function obterEmpresaAtivaLocal() {
    try {
        const storage = sessionStorage.getItem('impersonation_token')
            ? sessionStorage
            : localStorage;
        return JSON.parse(storage.getItem('empresaAtiva') || 'null');
    } catch {
        return null;
    }
}

function AgentesGlobais() {
    const [opsProntas, setOpsProntas]           = useState([]);
    const [temPermissao, setTemPermissao]       = useState(false);
    const [temPermissaoAgente, setTemPermissaoAgente] = useState(false);
    const [nomeUsuario, setNomeUsuario]         = useState('');

    // Extrai primeiro nome do JWT e lê permissões do localStorage
    useEffect(() => {
        try {
            const token = sessionStorage.getItem('impersonation_token')
                || localStorage.getItem('token');
            if (!token) return;
            const payload = JSON.parse(atob(token.split('.')[1]));
            setNomeUsuario((payload.nome || '').split(' ')[0]);

            const permissoes = JSON.parse(localStorage.getItem('permissoes') || '[]');
            setTemPermissaoAgente(permissoes.includes('usar-agente-encerrador'));
        } catch { /* silencioso */ }
    }, []);

    const buscarOps = useCallback(async () => {
        try {
            const token = sessionStorage.getItem('impersonation_token')
                || localStorage.getItem('token');
            if (!token) return;

            const empresaAtiva = obterEmpresaAtivaLocal();
            // O menu ainda pode estar carregando o contexto na primeira pintura.
            // Falhar fechado evita que o agente consulte a cadeia com um contexto
            // indefinido e transforme uma transição normal em erro de API visível.
            if (!empresaAtiva?.id || typeof empresaAtiva.eh_legada !== 'boolean') {
                setOpsProntas([]);
                setTemPermissao(false);
                return;
            }

            if (empresaAtiva?.eh_legada === false) {
                setOpsProntas([]);
                setTemPermissao(false);
                localStorage.removeItem(PENDENTE_KEY);
                return;
            }

            const response = await fetch('/api/ordens-de-producao/prontas-para-encerrar', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.status === 403) {
                setOpsProntas([]);
                setTemPermissao(false);
                return;
            }

            if (!response.ok) {
                throw new Error(`Falha ao consultar OPs prontas (${response.status}).`);
            }

            const data = await response.json();

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
        const handleEmpresaAlterada = () => {
            try {
                const permissoes = JSON.parse(localStorage.getItem('permissoes') || '[]');
                setTemPermissaoAgente(permissoes.includes('usar-agente-encerrador'));
            } catch {
                setTemPermissaoAgente(false);
            }
            buscarOps();
        };
        const handleEmpresaCarregada = handleEmpresaAlterada;

        document.addEventListener('visibilitychange', handleVisible);
        window.addEventListener('op-encerrada', handleOpEncerrada);
        window.addEventListener('lv:empresa-contexto-alterado', handleEmpresaAlterada);
        window.addEventListener('lv:empresa-contexto-carregado', handleEmpresaCarregada);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisible);
            window.removeEventListener('op-encerrada', handleOpEncerrada);
            window.removeEventListener('lv:empresa-contexto-alterado', handleEmpresaAlterada);
            window.removeEventListener('lv:empresa-contexto-carregado', handleEmpresaCarregada);
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
                temPermissaoAgente={temPermissaoAgente}
            />
            <OPAgenteInterceptor
                opsProntas={opsProntas}
                nomeUsuario={nomeUsuario}
                onRefresh={buscarOps}
                temPermissaoAgente={temPermissaoAgente}
            />
        </>
    );
}

// Cria o container e monta
const div = document.createElement('div');
div.id = 'agentes-globais-root';
document.body.appendChild(div);
createRoot(div).render(<AgentesGlobais />);
