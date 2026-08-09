import type {
  EmbalagemFiltroOpcoes,
  EmbalagemFiltros,
  EmbalagemFiltroRapido,
  EmbalagemOrdenacao,
} from '../utils/embalagem-types';

interface EmbalagemPainelFiltrosProps {
  filtros: EmbalagemFiltros;
  opcoes: EmbalagemFiltroOpcoes;
  totalItens: number;
  totalVisiveis: number;
  onChange: (filtros: Partial<EmbalagemFiltros>) => void;
  onLimpar: () => void;
}

const filtrosRapidos: Array<{
  id: EmbalagemFiltroRapido;
  label: string;
}> = [
  { id: 'todos', label: 'Todos' },
  { id: 'urgente', label: 'Aguardando 24h+' },
  { id: 'maior_saldo', label: 'Maior quantidade' },
];

export default function EmbalagemPainelFiltros({
  filtros,
  opcoes,
  totalItens,
  totalVisiveis,
  onChange,
  onLimpar,
}: EmbalagemPainelFiltrosProps) {
  const temFiltroDetalhado = Boolean(
    filtros.busca || filtros.produtoId || filtros.tamanho || filtros.cor,
  );

  return (
    <section className="ep-fila-controles" aria-label="Filtros da fila">
      <div className="ep-fila-busca">
        <i className="fas fa-search" aria-hidden="true" />
        <input
          type="search"
          value={filtros.busca}
          onChange={(event) => onChange({ busca: event.target.value })}
          placeholder="Buscar produto, SKU ou variação"
          aria-label="Buscar na fila de embalagens"
        />
        {filtros.busca ? (
          <button
            type="button"
            className="ep-fila-limpar-busca"
            onClick={() => onChange({ busca: '' })}
            aria-label="Limpar busca"
          >
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="ep-fila-chips" role="group" aria-label="Filtros rápidos">
        {filtrosRapidos.map((filtro) => (
          <button
            className={filtros.rapido === filtro.id ? 'ativo' : ''}
            key={filtro.id}
            type="button"
            onClick={() => onChange({ rapido: filtro.id })}
          >
            {filtro.label}
          </button>
        ))}
      </div>

      <details className="ep-fila-detalhes">
        <summary>
          <i className="fas fa-sliders" aria-hidden="true" />
          Filtros
          {temFiltroDetalhado ? <span className="ep-filtro-dot" /> : null}
        </summary>

        <div className="ep-filtros-popover">
          <label>
            Produto
            <select
              value={filtros.produtoId}
              onChange={(event) => onChange({ produtoId: event.target.value })}
            >
              <option value="">Todos os produtos</option>
              {opcoes.produtos.map((produto) => (
                <option key={produto.id} value={produto.id}>
                  {produto.nome}
                </option>
              ))}
            </select>
          </label>

          <label>
            Tamanho
            <select
              value={filtros.tamanho}
              onChange={(event) => onChange({ tamanho: event.target.value })}
            >
              <option value="">Todos os tamanhos</option>
              {opcoes.tamanhos.map((tamanho) => (
                <option key={tamanho} value={tamanho}>
                  {tamanho}
                </option>
              ))}
            </select>
          </label>

          <label>
            Cor / variação
            <select
              value={filtros.cor}
              onChange={(event) => onChange({ cor: event.target.value })}
            >
              <option value="">Todas as cores</option>
              {opcoes.cores.map((cor) => (
                <option key={cor} value={cor}>
                  {cor}
                </option>
              ))}
            </select>
          </label>

          <button className="ep-filtros-limpar" type="button" onClick={onLimpar}>
            Limpar filtros
          </button>
        </div>
      </details>

      <label className="ep-fila-ordenacao">
        <span>Ordenar</span>
        <select
          value={filtros.ordenacao}
          onChange={(event) =>
            onChange({ ordenacao: event.target.value as EmbalagemOrdenacao })
          }
          aria-label="Ordenar fila"
        >
          <option value="mais_antigo">Mais antigo</option>
          <option value="mais_recente">Mais recente</option>
          <option value="maior_saldo">Maior quantidade</option>
          <option value="produto">Nome do produto</option>
        </select>
      </label>

      <span className="ep-fila-contagem" aria-live="polite">
        {totalVisiveis} de {totalItens}
      </span>
    </section>
  );
}
