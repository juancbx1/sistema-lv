import React from 'react';
import UIBloqueio from './UIBloqueio.jsx';

function iniciais(nome) {
    return String(nome || '?').split(/\s+/).slice(0, 2).map((parte) => parte[0]).join('').toUpperCase();
}

export default function GOEmpresaCard({ empresa, empresaAtivaId, onEditar, onVerPessoas }) {
    return (
        <article className={`go-empresa-card${empresa.ativa ? '' : ' go-empresa-card--inativa'}`} style={{ '--go-empresa-cor': empresa.cor_identificacao || '#64748b' }}>
            <div className="go-empresa-faixa"></div>
            <header>
                <div className="go-empresa-logo">
                    {empresa.logo_url ? <img src={empresa.logo_url} alt="" /> : <span>{iniciais(empresa.nome_fantasia)}</span>}
                </div>
                <div>
                    <div className="go-empresa-titulo">
                        <h3>{empresa.nome_fantasia}</h3>
                        {empresa.eh_legada && <span className="go-selo-legada">Empresa inicial</span>}
                        {!empresa.ativa && <span className="go-selo-inativa">Inativa</span>}
                    </div>
                    <p>{empresa.razao_social || 'Razão social não informada'}</p>
                    <code>{empresa.codigo}</code>
                </div>
            </header>
            <div className="go-empresa-metricas">
                <div><strong>{empresa.total_membros || 0}</strong><span>Membros ativos</span></div>
                <div><strong>{empresa.total_gestores || 0}</strong><span>Gestores</span></div>
                <div><strong>{empresa.prefixo_op || '—'}</strong><span>Prefixo de OP</span></div>
            </div>
            <div className="go-empresa-detalhes">
                {empresa.cnpj && <span><i className="fas fa-id-card"></i> {empresa.cnpj}</span>}
                {empresa.cidade && <span><i className="fas fa-location-dot"></i> {empresa.cidade}/{empresa.estado}</span>}
                {empresa.email && <span><i className="fas fa-envelope"></i> {empresa.email}</span>}
                {empresa.id === empresaAtivaId && <span className="go-contexto-atual"><i className="fas fa-circle-check"></i> Contexto atual</span>}
            </div>
            <footer>
                <UIBloqueio permissao="visualizar-todas-empresas" style={{ flex: 1 }}>
                    <button onClick={() => onVerPessoas(empresa)}><i className="fas fa-users"></i> Ver membros</button>
                </UIBloqueio>
                <UIBloqueio permissao="gerenciar-empresas" style={{ flex: 1 }}>
                    <button onClick={() => onEditar(empresa)}><i className="fas fa-pen"></i> Editar perfil</button>
                </UIBloqueio>
            </footer>
        </article>
    );
}
