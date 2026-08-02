/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface Window {
    /** Ponte legada de paginação (`public/js/utils/Paginacao.js`). */
    renderizarPaginacao?: (
        container: HTMLElement,
        totalPaginas: number,
        paginaAtual: number,
        onPageChange: (pagina: number) => void,
    ) => void;
}
