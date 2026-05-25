import React, { useState, useEffect } from 'react';
import { fetchAPI } from '/js/utils/api-utils.js';
import { getObjetoCicloCompletoAtual } from '/js/utils/ciclos.js';

export default function DashPerfilGincanasCiclo() {
    const [premios, setPremios] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAPI('/api/gincanas-pagamentos/meus-premios')
            .then(d => {
                // Filtrar apenas prêmios do ciclo atual
                const ciclo = getObjetoCicloCompletoAtual();
                if (!ciclo?.semanas?.length) {
                    setPremios([...(d.pendentes || []), ...(d.pagos || [])]);
                    return;
                }
                const inicioCiclo = new Date(ciclo.semanas[0].inicio + 'T00:00:00');
                const fimCiclo = new Date(ciclo.semanas[ciclo.semanas.length - 1].fim + 'T23:59:59');

                const doCiclo = [...(d.pendentes || []), ...(d.pagos || [])].filter(p => {
                    const dt = new Date(p.ganho_em);
                    return dt >= inicioCiclo && dt <= fimCiclo;
                });
                setPremios(doCiclo);
            })
            .catch(() => setPremios([]))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="perfil-secao">
                <div className="perfil-secao-titulo">🏆 Gincanas Vencidas no Ciclo</div>
                <div className="ds-spinner" style={{ margin: '10px auto' }} />
            </div>
        );
    }

    if (premios.length === 0) {
        return (
            <div className="perfil-secao">
                <div className="perfil-secao-titulo">🏆 Gincanas Vencidas no Ciclo</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--ds-cor-cinza-texto-secundario)', textAlign: 'center', padding: '8px 0' }}>
                    Nenhuma premiação neste ciclo ainda.
                </div>
            </div>
        );
    }

    const totalValor = premios.reduce((sum, p) => sum + (parseFloat(p.valor_reais) || 0), 0);

    return (
        <div className="perfil-secao">
            <div className="perfil-secao-titulo">🏆 Gincanas Vencidas no Ciclo</div>
            {premios.map(p => (
                <div key={p.id} className="perfil-gincana-item">
                    <span className="perfil-gincana-emoji">{p.banner_emoji}</span>
                    <div className="perfil-gincana-info">
                        <div className="perfil-gincana-nome">{p.gincana_nome}</div>
                        <div className="perfil-gincana-nivel">{p.nivel_label}</div>
                    </div>
                    {p.valor_reais && (
                        <span className="perfil-gincana-valor">R$ {parseFloat(p.valor_reais).toFixed(2)}</span>
                    )}
                </div>
            ))}
            {totalValor > 0 && (
                <div className="perfil-gincanas-total">
                    Total: R$ {totalValor.toFixed(2)}
                </div>
            )}
        </div>
    );
}
