import React, { useState } from 'react';
import UIHeaderPagina from './UIHeaderPagina';
import UITabNav from './UITabNav';
import PermissoesEditor from './PermissoesEditor.jsx';
import PermissoesAuditoriaTab from './PermissoesAuditoriaTab.jsx';

export default function PermissoesPage() {
    const [abaAtiva, setAbaAtiva] = useState('permissoes');

    return (
        <>
            <UIHeaderPagina titulo="Gerenciar Permissões" />

            <UITabNav
                ariaLabel="Áreas de gerenciamento de permissões"
                activeId={abaAtiva}
                onChange={setAbaAtiva}
                items={[
                    { id: 'permissoes', label: 'Permissões', icon: 'fa-shield-alt' },
                    { id: 'auditoria', label: 'Auditoria', icon: 'fa-history' },
                ]}
            />

            <div className="gs-conteudo-pagina">
                {abaAtiva === 'permissoes' && <PermissoesEditor />}
                {abaAtiva === 'auditoria' && <PermissoesAuditoriaTab />}
            </div>
        </>
    );
}
