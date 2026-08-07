import React, { useState, useEffect } from 'react';
import UIHeaderPagina from './UIHeaderPagina';
import UITabNav from './UITabNav';
import GPRegistrosTab from './GPRegistrosTab.jsx';
import GPAprovacoesTab from './GPAprovacoesTab.jsx';
import { temPermissao } from '../utils/bloqueio';

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

            <UITabNav
                ariaLabel="Áreas do gerenciamento de produção"
                activeId={aba}
                onChange={setAba}
                items={[
                    { id: 'registros', label: 'Registros de Produção', icon: 'fa-list-alt' },
                    {
                        id: 'aprovacoes',
                        label: 'Aprovações',
                        icon: 'fa-check-circle',
                        badge: pendentes > 0 ? pendentes : undefined,
                        badgeLabel: pendentes > 0 ? `${pendentes} aprovações pendentes` : undefined,
                        locked: {
                            permissao: 'ver-painel-aprovacoes-producao',
                            mensagem: 'Você não tem permissão para ver o painel de aprovações.',
                        },
                    },
                ]}
            />

            <div className="gs-conteudo-pagina">
                {aba === 'registros' && <GPRegistrosTab />}
                {aba === 'aprovacoes' && podeVerAprovacoes && (
                    <GPAprovacoesTab onDecisao={carregarContagem} />
                )}
            </div>
        </>
    );
}
