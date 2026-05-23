import React from 'react';
import { formatarDataDisplay, formatarHora, formatarMoeda } from '/js/utils/formataDtHr.js';
import UIBloqueio from './UIBloqueio.jsx';

// Mapeamento para exibir os nomes bonitinhos
const LABELS_TIPOS = {
    'administrador': 'Administrador',
    'socio': 'Sócio',
    'supervisor': 'Supervisor',
    'lider_setor': 'Líder de Setor',
    'costureira': 'Costureira',
    'tiktik': 'TikTik',
    'cortador': 'Cortador'
};

export default function UserCardView({ usuario, permissoesLogado, onEditar, onExcluir, onFerias, onVinculo, onImpersonar }) {
    
    // --- LÓGICA DE STATUS (SÓCIO / EMPREGADO) ---
    const tipos = usuario.tipos || [];
    const ehSocio = tipos.includes('socio');
    const ehEmpregadoProdutivo = tipos.includes('costureira') || tipos.includes('tiktik');
    
    let labelStatus = '';
    let classeStatus = '';

    if (ehSocio) {
        if (usuario.data_demissao) {
            labelStatus = 'EX-SÓCIO';
            classeStatus = 'ex-empregado'; // Usamos a mesma cor cinza, ou crie uma classe .ex-socio no CSS se quiser
        } else {
            labelStatus = 'SÓCIO';
            classeStatus = 'socio'; // Vamos precisar garantir que existe estilo para .status-selo.socio
        }
    } else {
        if (usuario.data_demissao) {
            labelStatus = 'EX-EMPREGADO';
            classeStatus = 'ex-empregado';
        } else {
            labelStatus = 'EMPREGADO';
            classeStatus = 'empregado';
        }
    }
    
    // Aplica opacidade no card se for demitido/ex-sócio
    const classeCard = usuario.data_demissao ? 'status-ex-empregado' : '';

    const labelsTiposExibicao = tipos.map(t => LABELS_TIPOS[t] || t).join(', ');

    return (
        <div className={`gs-card usuario-card-custom ${classeCard}`}>
            {/* CABEÇALHO */}
            <div className="card-cabecalho">
                <div className="uc-cabecalho-com-foto">
                    <div
                        className="uc-foto-card-view"
                        style={{ backgroundImage: usuario.foto_oficial ? `url('${usuario.foto_oficial}')` : 'none' }}
                    >
                        {!usuario.foto_oficial && <i className="fas fa-user"></i>}
                    </div>
                    <div>
                        <h3 className="card-titulo-nome">{usuario.nome}</h3>
                        <div>
                            {usuario.esta_de_ferias && <span className="status-selo ferias">DE FÉRIAS</span>}
                            <span className={`status-selo ${classeStatus}`}>{labelStatus}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* DADOS PESSOAIS */}
            <div className="card-secao">
                <h4 className="card-secao-titulo">Dados de Acesso e Pessoais</h4>
                <p><span>Nome Completo:</span> <span className="uc-dado-texto">{usuario.nome_completo || 'Não informado'}</span></p>
                <p><span>Usuário:</span> <span className="uc-dado-texto">{usuario.nome_usuario}</span></p>
                <p><span>Email:</span> <span className="uc-dado-texto">{usuario.email}</span></p>
            </div>

            {/* VÍNCULO */}
            <div className="card-secao">
                <h4 className="card-secao-titulo">Vínculo & Tipos</h4>
                <p><span>Admissão:</span> <span className="uc-dado-texto">{formatarDataDisplay(usuario.data_admissao)}</span></p>
                <p><span>Demissão:</span> <span className="uc-dado-texto">{formatarDataDisplay(usuario.data_demissao)}</span></p>
                <p><span>Tipos:</span> <span className="uc-dado-texto">{labelsTiposExibicao || 'Nenhum'}</span></p>
                
                {ehEmpregadoProdutivo && (
                    <p><span>Nível:</span> <span className="uc-dado-texto">Nível {usuario.nivel || 'N/A'}</span></p>
                )}
            </div>

            {/* JORNADA (Exibimos para sócios também, conforme acordado) */}
            {(ehEmpregadoProdutivo || ehSocio) && (
                <div className="card-secao">
                    <h4 className="card-secao-titulo">Jornada de Trabalho</h4>
                    {usuario.dias_trabalho && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
                            {[['0','Dom'],['1','Seg'],['2','Ter'],['3','Qua'],['4','Qui'],['5','Sex'],['6','Sáb']].map(([dia, label]) => (
                                <span key={dia} style={{
                                    padding: '3px 8px',
                                    borderRadius: '20px',
                                    fontSize: '0.75rem',
                                    fontWeight: '600',
                                    background: usuario.dias_trabalho[dia] ? '#27ae60' : '#f0f0f0',
                                    color: usuario.dias_trabalho[dia] ? '#fff' : '#bbb',
                                }}>
                                    {label}
                                </span>
                            ))}
                        </div>
                    )}
                    <div className="jornada-display">
                        <span><strong>E1:</strong> {formatarHora(usuario.horario_entrada_1) || '--:--'}</span>
                        <span><strong>S1:</strong> {formatarHora(usuario.horario_saida_1) || '--:--'}</span>
                        <span><strong>E2:</strong> {formatarHora(usuario.horario_entrada_2) || '--:--'}</span>
                        <span><strong>S2:</strong> {formatarHora(usuario.horario_saida_2) || '--:--'}</span>
                        {usuario.horario_entrada_3 && (
                            <>
                                <span><strong>E3:</strong> {formatarHora(usuario.horario_entrada_3)}</span>
                                <span><strong>S3:</strong> {formatarHora(usuario.horario_saida_3)}</span>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* FINANCEIRO */}
            <div className="card-secao">
                <h4 className="card-secao-titulo">Dados Financeiros</h4>
                <p><span>Salário Fixo:</span> <span className="uc-dado-texto">{formatarMoeda(usuario.salario_fixo)}</span></p>
                <p><span>Passagem/Dia:</span> <span className="uc-dado-texto">{formatarMoeda(usuario.valor_passagem_diaria)}</span></p>
                
                <div style={{ marginTop: '8px' }}>
                    {usuario.id_contato_financeiro ? (
                        <div className="uc-vinculo-box" style={{ color: '#27ae60', fontSize: '0.9rem' }}>
                            <i className="fas fa-check-circle"></i> Vinculado a: <strong>{usuario.nome_contato_financeiro}</strong>
                        </div>
                    ) : (
                        <div className="uc-vinculo-box" style={{ color: '#f39c12', fontSize: '0.9rem' }}>
                            <i className="fas fa-exclamation-triangle"></i> Não vinculado financeiramente
                        </div>
                    )}
                </div>
            </div>

            {/* BOTÕES */}
            <div className="uc-card-botoes-container">
                {ehEmpregadoProdutivo && !usuario.data_demissao && (
                    <UIBloqueio permissao="gerenciar-permissoes">
                        <button
                            className="gs-btn gs-btn-aviso"
                            onClick={onImpersonar}
                            title="Acessar a dashboard como este funcionário (modo admin)"
                        >
                            <i className="fas fa-eye"></i>
                        </button>
                    </UIBloqueio>
                )}

                <UIBloqueio permissao="editar-usuarios">
                    <button className="gs-btn gs-btn-secundario" onClick={onVinculo} title="Vincular Contato Financeiro">
                        <i className="fas fa-link"></i>
                    </button>
                </UIBloqueio>

                {/* Sócios e Empregados podem ter férias */}
                {(ehEmpregadoProdutivo || ehSocio) && (
                    <UIBloqueio permissao="adicionar-ferias">
                        <button className="gs-btn gs-btn-secundario" onClick={onFerias}>
                            <i className="fas fa-plane-departure"></i> Férias
                        </button>
                    </UIBloqueio>
                )}

                <UIBloqueio permissao="editar-usuarios">
                    <button className="gs-btn gs-btn-primario" onClick={onEditar}>
                        <i className="fas fa-edit"></i> Editar
                    </button>
                </UIBloqueio>

                <UIBloqueio permissao="excluir-usuarios">
                    <button className="gs-btn gs-btn-perigo" onClick={onExcluir}>
                        <i className="fas fa-trash"></i>
                    </button>
                </UIBloqueio>
            </div>
        </div>
    );
}