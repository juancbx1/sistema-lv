import React from 'react';

const filtros = [
    { id: 'TODOS', label: 'Todos' },
    { id: 'ATENCAO', label: 'Atenção' },
    { id: 'ATIVIDADE', label: 'Em atividade' },
    { id: 'DISPONIVEL', label: 'Disponíveis' },
    { id: 'INTERVALO', label: 'Intervalo' },
    { id: 'FORA', label: 'Fora da operação' },
];

export default function OPPainelResumo({
    total,
    temAlguemProduzindo,
    filtroAtivo,
    contagens,
    onFiltroChange,
    onRefresh,
    isRefreshing,
}) {
    return (
        <div className="op-redesign-resumo">
            <div className="op-redesign-cabecalho">
                <div className="op-redesign-titulo-wrap">
                    <div className="op-redesign-overline">Operação de hoje</div>
                    <div className="op-redesign-titulo-linha">
                        <h2 className="op-redesign-titulo">Jornada e atividades</h2>
                        {temAlguemProduzindo && (
                            <span className="op-redesign-ao-vivo" aria-label="Painel atualizado ao vivo">
                                <span className="op-redesign-ao-vivo-dot" aria-hidden="true" />
                                Ao vivo
                            </span>
                        )}
                    </div>
                    <span className="op-redesign-subtitulo">
                        {total} {total === 1 ? 'pessoa acompanhada' : 'pessoas acompanhadas'} neste turno
                    </span>
                </div>
                <button
                    type="button"
                    className="op-redesign-refresh"
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    aria-label="Atualizar dados do painel"
                >
                    <i className={`fas fa-sync-alt ${isRefreshing ? 'girando' : ''}`} aria-hidden="true" />
                    <span>{isRefreshing ? 'Atualizando…' : 'Atualizar'}</span>
                </button>
            </div>

            <nav className="op-redesign-filtros" aria-label="Filtrar equipe">
                {filtros.map((filtro) => {
                    const quantidade = contagens[filtro.id] || 0;
                    return (
                        <button
                            key={filtro.id}
                            type="button"
                            className={`op-redesign-filtro ${filtroAtivo === filtro.id ? 'ativo' : ''}`}
                            aria-pressed={filtroAtivo === filtro.id}
                            onClick={() => onFiltroChange(filtro.id)}
                        >
                            <span>{filtro.label}</span>
                            <strong>{quantidade}</strong>
                        </button>
                    );
                })}
            </nav>

        </div>
    );
}
