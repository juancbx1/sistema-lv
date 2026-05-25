import React from 'react';

// Teaser visual da feature futura: conquistas que geram pontos para o cofre
function TeaserCofreBônus() {
    return (
        <div className="conquista-cofre-teaser">
            <div className="conquista-cofre-teaser-badge">Em breve</div>
            <div className="conquista-cofre-teaser-corpo">
                <div className="conquista-cofre-teaser-icones">
                    <span className="conquista-cofre-teaser-icone-medal">🏅</span>
                    <span className="conquista-cofre-teaser-seta">→</span>
                    <span className="conquista-cofre-teaser-icone-vault">
                        <i className="fas fa-vault" aria-hidden="true" />
                    </span>
                </div>
                <div className="conquista-cofre-teaser-texto">
                    <strong>Conquistas vão gerar pontos no cofre!</strong>
                    <p>Cada conquista desbloqueada vai depositar pontos extras no seu Banco de Resgate. Quanto mais você conquista, mais reserva você acumula.</p>
                </div>
            </div>
            <div className="conquista-cofre-teaser-preview">
                {[
                    { icone: '⚡', nome: 'Meta Prata 5×', bonus: '+40 pts' },
                    { icone: '🔥', nome: 'Sequência de 10 dias', bonus: '+80 pts' },
                    { icone: '🏆', nome: 'Melhor da semana', bonus: '+60 pts' },
                ].map(item => (
                    <div key={item.nome} className="conquista-cofre-teaser-item">
                        <span className="conquista-cofre-teaser-item-icone">{item.icone}</span>
                        <span className="conquista-cofre-teaser-item-nome">{item.nome}</span>
                        <span className="conquista-cofre-teaser-item-bonus">{item.bonus}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function DashPerfilConquistas({ total, desbloqueadas, lista, loading }) {
    if (loading) {
        return (
            <div className="perfil-secao">
                <div className="perfil-secao-titulo">🏅 Conquistas do Ciclo</div>
                <div className="ds-spinner" style={{ margin: '10px auto' }} />
            </div>
        );
    }

    return (
        <div className="perfil-secao">
            <div className="perfil-secao-titulo">
                🏅 Conquistas do Ciclo
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 600, color: 'var(--ds-cor-cinza-texto-secundario)' }}>
                    {desbloqueadas}/{total}
                </span>
            </div>
            <div className="perfil-conquistas-grid">
                {(lista || []).map(c => (
                    <div
                        key={c.id}
                        className={`perfil-conquista-item${c.desbloqueada ? ' desbloqueada' : ' bloqueada'}`}
                    >
                        <span className="perfil-conquista-icone">{c.icone}</span>
                        <div>
                            <div className="perfil-conquista-nome">{c.nome}</div>
                            <div className="perfil-conquista-desc">{c.descricao}</div>
                        </div>
                    </div>
                ))}
            </div>

            <TeaserCofreBônus />
        </div>
    );
}
