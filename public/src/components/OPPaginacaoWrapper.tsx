// public/src/components/OPPaginacaoWrapper.tsx

import { useEffect, useRef } from 'react';

// @ts-expect-error função JS legada sem declaração TypeScript
import { renderizarPaginacao } from '/js/utils/Paginacao.js';

interface OPPaginacaoWrapperProps {
  totalPages: number;
  currentPage: number;
  onPageChange: (page: number) => void;
}

export default function OPPaginacaoWrapper({
  totalPages,
  currentPage,
  onPageChange,
}: OPPaginacaoWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    renderizarPaginacao(container, totalPages, currentPage, (novaPagina: number) => {
      onPageChange(novaPagina);
    });

    return () => {
      container.innerHTML = '';
    };
  }, [totalPages, currentPage, onPageChange]);

  return <div ref={containerRef} className="gs-paginacao-container" />;
}
