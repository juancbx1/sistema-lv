// public/src/components/UIFiltrosAtivos.tsx

export type UIFiltroChave = 'produtos' | 'cores' | 'tamanhos';

export interface UIFiltrosAtivosEstado {
    produtos?: string[];
    cores?: string[];
    tamanhos?: string[];
}

interface UIFiltrosAtivosProps {
    filtros: UIFiltrosAtivosEstado;
    onRemoverFiltro: (chave: UIFiltroChave, valor: string) => void;
    onLimparTudo: () => void;
}

export default function UIFiltrosAtivos({ filtros, onRemoverFiltro, onLimparTudo }: UIFiltrosAtivosProps) {
    const { produtos = [], cores = [], tamanhos = [] } = filtros;
    const totalFiltros = produtos.length + cores.length + tamanhos.length;

    if (totalFiltros === 0) {
        return null;
    }

    return (
        <div className="gs-filtros-ativos-container">
            <span className="gs-filtros-ativos-titulo">Filtros Ativos:</span>
            <div className="gs-filtros-ativos-lista">
                {produtos.map((p) => (
                    <div key={`prod-${p}`} className="gs-pilula-ativa">
                        <span>{p}</span>
                        <button type="button" onClick={() => onRemoverFiltro('produtos', p)}>&times;</button>
                    </div>
                ))}
                {cores.map((c) => (
                    <div key={`cor-${c}`} className="gs-pilula-ativa">
                        <span>{c}</span>
                        <button type="button" onClick={() => onRemoverFiltro('cores', c)}>&times;</button>
                    </div>
                ))}
                {tamanhos.map((t) => (
                    <div key={`tam-${t}`} className="gs-pilula-ativa">
                        <span>{t}</span>
                        <button type="button" onClick={() => onRemoverFiltro('tamanhos', t)}>&times;</button>
                    </div>
                ))}
            </div>
            <button type="button" className="gs-btn-limpar-filtros-ativos" onClick={onLimparTudo}>
                <i className="fas fa-times-circle"></i>
                <span>Limpar Tudo</span>
            </button>
        </div>
    );
}
