import type { CpagPaginationProps } from '../utils/cpag-types';

export default function CPAGPaginacao({ paginaAtual, totalPaginas, onPageChange }: CpagPaginationProps) {
  if (totalPaginas <= 1) return null;

  return (
    <nav className="gs-paginacao-container" aria-label="Paginação">
      <button type="button" className="gs-paginacao-btn" disabled={paginaAtual <= 1} onClick={() => onPageChange(paginaAtual - 1)}>
        <i className="fas fa-chevron-left" aria-hidden="true" />
      </button>
      <span className="gs-paginacao-info">Página {paginaAtual} de {totalPaginas}</span>
      <button type="button" className="gs-paginacao-btn" disabled={paginaAtual >= totalPaginas} onClick={() => onPageChange(paginaAtual + 1)}>
        <i className="fas fa-chevron-right" aria-hidden="true" />
      </button>
    </nav>
  );
}
