import React, { useState, useEffect } from 'react';
import UIHeaderPagina from './UIHeaderPagina.jsx';
import UIBloqueio from './UIBloqueio.jsx';
import GPRegistrosTab from './GPRegistrosTab.jsx';
import GPAprovacoesTab from './GPAprovacoesTab.jsx';
import { temPermissao } from '../utils/bloqueio.js';

function fetchAuth(url) {
    const token = localStorage.getItem('token');
    return fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
}

export default function GPPage() {
    const [aba, setAba]           = useState('registros');
    const [pendentes, setPendentes] = useState(0);
    const podeVerAprovacoes = temPermissao('ver-painel-aprovacoes-producao');

    const carregarContagem = () => {
        if (!podeVerAprovacoes) return;
        fetchAuth('/api/gerenciar-producao/solicitacoes/contagem')
            .then(r => r.json())
            .then(data => setPendentes(data.pendentes || 0))
            .catch(() => {});
    };

    useEffect(() => { carregarContagem(); }, [podeVerAprovacoes]);

    return (
        <>
            <UIHeaderPagina titulo="Gerenciar Produção" />

            <nav className="gs-tab-nav">
                <button
                    className={`gs-tab-btn ${aba === 'registros' ? 'ativo' : ''}`}
                    onClick={() => setAba('registros')}
                >
                    Registros de Produção
                </button>
                <UIBloqueio permissao="ver-painel-aprovacoes-producao" mensagem="Você não tem permissão para ver o painel de aprovações.">
                    <button
                        className={`gs-tab-btn ${aba === 'aprovacoes' ? 'ativo' : ''}`}
                        onClick={() => setAba('aprovacoes')}
                    >
                        Aprovações
                        {pendentes > 0 && <span className="gs-tab-badge">{pendentes}</span>}
                    </button>
                </UIBloqueio>
            </nav>

            <div className="gs-conteudo-pagina">
                {aba === 'registros' && <GPRegistrosTab />}
                {aba === 'aprovacoes' && podeVerAprovacoes && (
                    <GPAprovacoesTab onDecisao={carregarContagem} />
                )}
            </div>
        </>
    );
}
