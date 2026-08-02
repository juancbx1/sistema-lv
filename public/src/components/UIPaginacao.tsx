// public/src/components/UIPaginacao.tsx

import { useEffect, useRef } from 'react';

interface UIPaginacaoProps {
    paginaAtual: number;
    totalPaginas: number;
    onPageChange: (pagina: number) => void;
}

/**
 * Ponte React para a paginação legada em JS puro (`window.renderizarPaginacao`).
 * Não renderiza a UI por conta própria — apenas fornece o container.
 */
export default function UIPaginacao({ paginaAtual, totalPaginas, onPageChange }: UIPaginacaoProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (window.renderizarPaginacao && containerRef.current) {
            window.renderizarPaginacao(
                containerRef.current,
                totalPaginas,
                paginaAtual,
                onPageChange,
            );
        }
    }, [paginaAtual, totalPaginas, onPageChange]);

    return <div ref={containerRef} className="gs-paginacao-container"></div>;
}
