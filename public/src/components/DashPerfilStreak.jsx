import React from 'react';

const BADGES = [
    { dias: 21, nome: 'Lendária', cor: '#7c3aed' },
    { dias: 15, nome: 'Imparável', cor: '#b45309' },
    { dias: 10, nome: 'Constante', cor: '#1d4ed8' },
    { dias: 5,  nome: 'Determinada', cor: '#15803d' },
];

export default function DashPerfilStreak({ diasSeguidos, badgeAtual, proximoBadge, diasParaBadge, loading }) {
    if (loading) {
        return (
            <div className="perfil-secao">
                <div className="perfil-secao-titulo">🔥 Sequência de Produção</div>
                <div className="ds-spinner" style={{ margin: '10px auto' }} />
            </div>
        );
    }

    const badge = BADGES.find(b => b.nome === badgeAtual);
    const progresso = proximoBadge && diasParaBadge != null
        ? Math.round(((diasSeguidos) / (diasSeguidos + diasParaBadge)) * 100)
        : 100;

    return (
        <div className="perfil-secao">
            <div className="perfil-secao-titulo">🔥 Sequência de Produção</div>
            <div className="perfil-streak-linha">
                <div>
                    <div className="perfil-streak-numero">{diasSeguidos ?? 0}</div>
                    <div className="perfil-streak-label">dias seguidos</div>
                </div>
                {badgeAtual && (
                    <span
                        className="perfil-streak-badge"
                        style={badge ? { background: badge.cor } : {}}
                    >
                        {badgeAtual}
                    </span>
                )}
            </div>
            {proximoBadge && diasParaBadge != null && (
                <>
                    <div className="perfil-streak-progresso">
                        <div className="perfil-streak-progresso-fill" style={{ width: `${progresso}%` }} />
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--ds-cor-cinza-texto-secundario)', marginTop: 4 }}>
                        {diasParaBadge} dia{diasParaBadge !== 1 ? 's' : ''} para o badge <strong>{proximoBadge}</strong>
                    </div>
                </>
            )}
            {!diasSeguidos && (
                <div style={{ fontSize: '0.78rem', color: 'var(--ds-cor-cinza-texto-secundario)', marginTop: 4 }}>
                    Produza hoje para começar sua sequência! 💪
                </div>
            )}
        </div>
    );
}
