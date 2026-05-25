import React, { useMemo } from 'react';
import imgDefaultAvatar from '../assets/default-avatar.png';

function saudacaoPorHora() {
    const hora = new Date().getHours();
    if (hora < 12) return { texto: 'Bom dia', icone: 'fa-sun' };
    if (hora < 18) return { texto: 'Boa tarde', icone: 'fa-cloud-sun' };
    return { texto: 'Boa noite', icone: 'fa-moon' };
}


export default function DashHeader({
    usuario,
    saldoCofre,
    pontosHoje,
    streak,
    aoAbrirDesempenho,
    aoAbrirCofre,
    aoAbrirPagamentos,
    aoAbrirPerfil,
    aoSair,
}) {
    const avatarUrl = usuario?.avatar_url || imgDefaultAvatar;
    const nomeUsuario = usuario?.nome || 'Colaboradora';
    const nivelUsuario = usuario?.nivel || '?';
    const { texto: saudacao, icone: saudacaoIcone } = useMemo(saudacaoPorHora, []);

    return (
        <header className="ds-header-principal">
            {/* ── Identidade ─────────────────────────────── */}
            <div className="ds-identidade-bloco">
                <div className="ds-identidade-avatar" onClick={aoAbrirPerfil} aria-label="Abrir perfil">
                    <img src={avatarUrl} alt="Avatar" id="header-avatar-img" />
                    <span className="ds-identidade-level-badge">{nivelUsuario}</span>
                </div>

                <div className="ds-identidade-info">
                    <p className="ds-header-saudacao">
                        <i className={`fas ${saudacaoIcone}`} aria-hidden="true" />
                        {saudacao}!
                    </p>
                    <h1 className="ds-header-nome">{nomeUsuario}</h1>
                </div>
            </div>

            {/* ── Dock ───────────────────────────────────── */}
            <div className="ds-actions-dock">
                <button
                    className="ds-dock-btn ds-dock-btn--cofre"
                    title="Banco de Resgate"
                    onClick={aoAbrirCofre}
                    aria-label="Abrir cofre"
                >
                    <i className="fas fa-vault" aria-hidden="true" />
                    <span className="ds-dock-label">Cofre</span>
                    {saldoCofre > 0 && (
                        <div className="ds-dock-badge">{Math.round(saldoCofre)}</div>
                    )}
                </button>

                <button
                    className="ds-dock-btn"
                    title="Minha Carteira"
                    onClick={aoAbrirPagamentos}
                    aria-label="Abrir carteira"
                >
                    <i className="fas fa-wallet" aria-hidden="true" />
                    <span className="ds-dock-label">Carteira</span>
                </button>

                <button
                    className="ds-dock-btn"
                    title="Meu Desempenho"
                    onClick={aoAbrirDesempenho}
                    aria-label="Abrir extrato"
                >
                    <i className="fas fa-chart-line" aria-hidden="true" />
                    <span className="ds-dock-label">Extrato</span>
                </button>

                <div className="ds-dock-divider" aria-hidden="true" />

                <button
                    className="ds-dock-btn ds-dock-btn--sair"
                    title="Sair"
                    onClick={aoSair}
                    aria-label="Sair do sistema"
                >
                    <i className="fas fa-sign-out-alt" aria-hidden="true" />
                    <span className="ds-dock-label">Sair</span>
                </button>
            </div>
        </header>
    );
}
