import React from 'react';
import UIBloqueio from './UIBloqueio.jsx';
import { formatarDataDisplay, formatarMoeda } from '/js/utils/formataDtHr.js';
import { mostrarConfirmacao, mostrarMensagem } from '/js/utils/popups.js';
import { fetchAPI } from '/js/utils/api-utils.js';

const TIPOS_LABELS = {
    administrador: 'Administrador',
    socio: 'Sócio',
    supervisor: 'Supervisor',
    lider_setor: 'Líder de Setor',
    costureira: 'Costureira',
    tiktik: 'TikTik',
    cortador: 'Cortador',
    prestador_externo: 'Externo',
};

const TIPO_COR_TAG = {
    costureira: '#3b82f6',
    tiktik: '#10b981',
    cortador: '#f97316',
    supervisor: '#6366f1',
    lider_setor: '#7c3aed',
    administrador: '#64748b',
    socio: '#8b5cf6',
    ex_socio: '#9ca3af',
    prestador_externo: '#f59e0b',
};

const TIPO_COR_AVATAR = {
    costureira: '#3b82f6',
    tiktik: '#10b981',
    cortador: '#f97316',
    supervisor: '#6366f1',
    lider_setor: '#7c3aed',
    administrador: '#64748b',
    socio: '#8b5cf6',
    ex_socio: '#9ca3af',
    prestador_externo: '#f59e0b',
};

function getIniciais(nome) {
    if (!nome) return '?';
    const partes = nome.trim().split(' ').filter(Boolean);
    if (partes.length === 1) return partes[0][0].toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function getCorAvatar(tipos) {
    const ordem = ['costureira', 'tiktik', 'cortador', 'supervisor', 'lider_setor', 'socio', 'ex_socio', 'prestador_externo', 'administrador'];
    for (const t of ordem) {
        if (tipos.includes(t)) return TIPO_COR_AVATAR[t];
    }
    return '#64748b';
}

const fmtData = (d) => d ? formatarDataDisplay(d) : '—';
const fmtMoeda = (v) => (v != null && v !== '') ? formatarMoeda(v) : '—';

export default function UCCard({ usuario, categoria, onEditar, aoAtualizarLista }) {
    const tipos = usuario.tipos || [];
    const iniciais = getIniciais(usuario.nome);
    const corAvatar = getCorAvatar(tipos);

    const podeVerDash = (tipos.includes('costureira') || tipos.includes('tiktik')) && !usuario.data_demissao;

    // Tags a exibir — ex_socio e socio ficam ocultos quando categoria é ex_socio (evita contradição)
    const tiposExibidos = categoria === 'ex_socio'
        ? tipos.filter(t => t !== 'socio' && t !== 'ex_socio')
        : tipos;

    // Badge de status
    let statusLabel, statusClasse;
    if (categoria === 'ex_socio') {
        statusLabel = 'Ex-sócio';
        statusClasse = 'uc-badge--ex';
    } else if (categoria === 'ex_empregado') {
        statusLabel = 'Ex-empregado';
        statusClasse = 'uc-badge--ex';
    } else if (usuario.esta_de_ferias) {
        statusLabel = 'Férias';
        statusClasse = 'uc-badge--ferias';
    } else {
        statusLabel = 'Ativo';
        statusClasse = 'uc-badge--ativo';
    }

    // Dados compactos por categoria
    let dados = [];
    if (categoria === 'empregado') {
        dados = [
            { label: 'Admissão', valor: fmtData(usuario.data_admissao) },
            { label: 'Nível', valor: usuario.nivel ? `Nível ${usuario.nivel}` : '—' },
            { label: 'Salário', valor: fmtMoeda(usuario.salario_fixo) },
        ];
    } else if (categoria === 'ex_empregado') {
        dados = [
            { label: 'Admissão', valor: fmtData(usuario.data_admissao) },
            { label: 'Demissão', valor: fmtData(usuario.data_demissao) },
            { label: 'Usuário', valor: usuario.nome_usuario || '—' },
        ];
    } else if (categoria === 'ex_socio' || categoria === 'socio' || categoria === 'administrador' || categoria === 'prestador_externo') {
        dados = [
            { label: 'Usuário', valor: usuario.nome_usuario || '—' },
            { label: 'Email', valor: usuario.email || '—' },
        ];
    }

    const handleImpersonar = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/usuarios/${usuario.id}/impersonar`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro');
            window.open(`/dashboard/dashboard.html?impersonando=${encodeURIComponent(data.token)}`, '_blank');
        } catch (error) {
            mostrarMensagem(`Erro ao abrir dashboard: ${error.message}`, 'erro');
        }
    };

    const handleExcluir = async () => {
        const confirmado = await mostrarConfirmacao(`Excluir o usuário "${usuario.nome}"?`);
        if (!confirmado) return;
        try {
            await fetchAPI('/api/usuarios', { method: 'DELETE', body: JSON.stringify({ id: usuario.id }) });
            mostrarMensagem('Usuário excluído.', 'sucesso');
            aoAtualizarLista();
        } catch (error) {
            mostrarMensagem(`Erro: ${error.message}`, 'erro');
        }
    };

    return (
        <div className={`uc-card uc-card--${categoria}`}>
            <div className="card-borda-charme"></div>

            <div className="uc-card-topo">
                <div
                    className="uc-avatar"
                    style={usuario.foto_oficial
                        ? { backgroundImage: `url('${usuario.foto_oficial}')`, backgroundSize: 'cover', backgroundPosition: 'center' }
                        : { backgroundColor: corAvatar }
                    }
                >
                    {!usuario.foto_oficial && iniciais}
                </div>
                <div className="uc-card-identidade">
                    <div className="uc-card-nome">{usuario.nome}</div>
                    <div className="uc-card-tags">
                        {tiposExibidos.map(t => (
                            <span key={t} className="uc-tag" style={{ backgroundColor: TIPO_COR_TAG[t] || '#64748b' }}>
                                {TIPOS_LABELS[t] || t}
                            </span>
                        ))}
                        <span className={`uc-badge ${statusClasse}`}>{statusLabel}</span>
                    </div>
                </div>
            </div>

            {dados.length > 0 && (
                <div className="uc-card-dados">
                    {dados.map(d => (
                        <div key={d.label} className="uc-card-dado-item">
                            <span className="uc-card-dado-label">{d.label}</span>
                            <span className="uc-card-dado-valor">{d.valor}</span>
                        </div>
                    ))}
                </div>
            )}

            <div className="uc-card-acoes">
                {podeVerDash && (
                    <UIBloqueio permissao="gerenciar-permissoes">
                        <button className="gs-btn gs-btn-aviso uc-btn-icone" onClick={handleImpersonar} title="Ver dashboard">
                            <i className="fas fa-eye"></i>
                        </button>
                    </UIBloqueio>
                )}
                <UIBloqueio permissao="editar-usuarios">
                    <button className="gs-btn gs-btn-primario uc-btn-editar" onClick={() => onEditar(usuario)}>
                        <i className="fas fa-edit"></i> Editar
                    </button>
                </UIBloqueio>
                <UIBloqueio permissao="excluir-usuarios">
                    <button className="gs-btn gs-btn-perigo uc-btn-icone" onClick={handleExcluir}>
                        <i className="fas fa-trash"></i>
                    </button>
                </UIBloqueio>
            </div>
        </div>
    );
}
