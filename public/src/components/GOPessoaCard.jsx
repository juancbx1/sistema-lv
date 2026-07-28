import React from 'react';
import UIBloqueio from './UIBloqueio.jsx';

const ROTULOS_TIPO = {
    administrador: 'Administrador',
    supervisor: 'Supervisor',
    lider_setor: 'Líder',
    costureira: 'Costureira',
    tiktik: 'TikTik',
    cortador: 'Cortador',
    socio: 'Sócio',
    ex_socio: 'Ex-sócio',
    prestador_externo: 'Prestador externo',
};

function iniciais(nome) {
    return String(nome || '?').split(/\s+/).slice(0, 2).map((parte) => parte[0]).join('').toUpperCase();
}

export default function GOPessoaCard({ pessoa, empresaAtivaId, onEditarPessoa, onEditarVinculo, onNovoVinculo, onEncerrarVinculo }) {
    const vinculosAtivos = (pessoa.vinculos || []).filter((item) => item.ativo);
    const vinculosEncerrados = (pessoa.vinculos || []).filter((item) => !item.ativo);
    const ativoNaEmpresa = vinculosAtivos.some((item) => item.empresa_id === empresaAtivaId);

    return (
        <article className={`go-pessoa-card${ativoNaEmpresa ? '' : ' go-pessoa-card--fora-contexto'}`}>
            <header>
                <div className="go-avatar">
                    {pessoa.avatar_url
                        ? <img src={pessoa.avatar_url} alt="" />
                        : <span>{iniciais(pessoa.nome)}</span>}
                </div>
                <div className="go-pessoa-identidade">
                    <h3>{pessoa.nome}</h3>
                    <p>@{pessoa.nome_usuario} · {pessoa.email}</p>
                </div>
                <UIBloqueio permissao="editar-usuarios">
                    <button className="go-btn-icone" onClick={() => onEditarPessoa(pessoa)} title="Editar identidade">
                        <i className="fas fa-user-pen"></i>
                    </button>
                </UIBloqueio>
            </header>

            <div className="go-vinculos">
                {vinculosAtivos.map((vinculo) => (
                    <div
                        key={vinculo.id}
                        className={`go-vinculo${vinculo.empresa_id === empresaAtivaId ? ' go-vinculo--contexto' : ''}`}
                        style={{ '--go-empresa-cor': vinculo.empresa_cor || '#64748b' }}
                    >
                        <div className="go-vinculo-topo">
                            <strong><i className="fas fa-building"></i> {vinculo.empresa_nome}</strong>
                            {vinculo.empresa_principal && <span className="go-selo-principal"><i className="fas fa-star"></i> Principal</span>}
                        </div>
                        <div className="go-tipos">
                            {(vinculo.tipos || []).map((tipo) => <span key={tipo}>{ROTULOS_TIPO[tipo] || tipo}</span>)}
                        </div>
                        <div className="go-vinculo-meta">
                            {vinculo.data_admissao && <span><i className="fas fa-calendar-check"></i> Desde {new Date(`${vinculo.data_admissao}T12:00:00`).toLocaleDateString('pt-BR')}</span>}
                            <span><i className="fas fa-key"></i> {(vinculo.permissoes || []).length} permissões adicionais</span>
                        </div>
                        <div className="go-vinculo-acoes">
                            <UIBloqueio permissao="vincular-usuarios-empresas">
                                <button onClick={() => onEditarVinculo(pessoa, vinculo)}><i className="fas fa-pen"></i> Editar vínculo</button>
                            </UIBloqueio>
                            <UIBloqueio permissao="vincular-usuarios-empresas">
                                <button className="go-acao-perigo" onClick={() => onEncerrarVinculo(pessoa, vinculo)}><i className="fas fa-user-minus"></i> Encerrar</button>
                            </UIBloqueio>
                        </div>
                    </div>
                ))}
                {vinculosAtivos.length === 0 && <p className="go-sem-vinculo">Nenhum vínculo ativo.</p>}
                {vinculosEncerrados.length > 0 && (
                    <details className="go-vinculos-encerrados">
                        <summary>{vinculosEncerrados.length} vínculo(s) encerrado(s)</summary>
                        {vinculosEncerrados.map((vinculo) => (
                            <div key={vinculo.id}>
                                <span>{vinculo.empresa_nome}</span>
                                <small>{vinculo.data_demissao ? `Encerrado em ${new Date(`${vinculo.data_demissao}T12:00:00`).toLocaleDateString('pt-BR')}` : 'Inativo'}</small>
                            </div>
                        ))}
                    </details>
                )}
            </div>

            <footer>
                <UIBloqueio permissao="vincular-usuarios-empresas" style={{ width: '100%' }}>
                    <button onClick={() => onNovoVinculo(pessoa)}><i className="fas fa-link"></i> Vincular a outra empresa</button>
                </UIBloqueio>
            </footer>
        </article>
    );
}
