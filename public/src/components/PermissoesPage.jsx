import React, { useState } from 'react';
import UIHeaderPagina from './UIHeaderPagina.jsx';
import PermissoesEditor from './PermissoesEditor.jsx';
import PermissoesAuditoriaTab from './PermissoesAuditoriaTab.jsx';

export default function PermissoesPage() {
    const [abaAtiva, setAbaAtiva] = useState('permissoes');

    return (
        <>
            <UIHeaderPagina titulo="Gerenciar Permissões" />

            <nav className="gs-tab-nav">
                <button
                    className={`gs-tab-btn${abaAtiva === 'permissoes' ? ' ativo' : ''}`}
                    onClick={() => setAbaAtiva('permissoes')}
                >
                    <i className="fas fa-shield-alt"></i> Permissões
                </button>
                <button
                    className={`gs-tab-btn${abaAtiva === 'auditoria' ? ' ativo' : ''}`}
                    onClick={() => setAbaAtiva('auditoria')}
                >
                    <i className="fas fa-history"></i> Auditoria
                </button>
            </nav>

            <div className="gs-conteudo-pagina">
                {abaAtiva === 'permissoes' && <PermissoesEditor />}
                {abaAtiva === 'auditoria' && <PermissoesAuditoriaTab />}
            </div>
        </>
    );
}
