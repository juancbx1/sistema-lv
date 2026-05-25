import React from 'react';

export default function DashPerfilMelhorDia({ pontos, data }) {
    if (!pontos) return null;

    const dataFormatada = data
        ? new Date(data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
        : null;

    return (
        <div className="perfil-secao">
            <div className="perfil-secao-titulo">⭐ Melhor Dia do Ciclo</div>
            <div className="perfil-melhor-dia">
                <div>
                    <div className="perfil-melhor-dia-pts">{Math.round(pontos).toLocaleString('pt-BR')}</div>
                    {dataFormatada && <div className="perfil-melhor-dia-data">{dataFormatada}</div>}
                </div>
                <div className="perfil-melhor-dia-info">
                    pontos em um único dia neste ciclo
                </div>
            </div>
        </div>
    );
}
