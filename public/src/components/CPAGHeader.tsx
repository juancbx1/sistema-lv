import type { ReactNode } from 'react';

interface CPAGHeaderProps {
  titulo: string;
  breadcrumbs: string[];
  children?: ReactNode;
}

export default function CPAGHeader({ titulo, breadcrumbs, children }: CPAGHeaderProps) {
  return (
    <header className="cpg-header">
      <div className="cpg-breadcrumbs" aria-label="Navegação estrutural">
        {breadcrumbs.map((item, index) => (
          <span key={`${item}-${index}`}>
            {index > 0 && <span className="separator"> / </span>}
            <span className={index === breadcrumbs.length - 1 ? 'active' : ''}>
              {item}
            </span>
          </span>
        ))}
        <h1 className="sr-only">{titulo}</h1>
      </div>
      <div className="cpg-header-actions">{children}</div>
    </header>
  );
}
