// public/src/components/UIHeaderPagina.tsx
import type { ReactNode } from 'react';

interface UIHeaderPaginaProps {
    titulo: string;
    children?: ReactNode;
}

export default function UIHeaderPagina({ titulo, children }: UIHeaderPaginaProps) {
    return (
        <div className="gs-cabecalho-pagina">
            <h1>{titulo}</h1>
            {children ? <div className="gs-botoes-cabecalho">{children}</div> : null}
        </div>
    );
}
