// public/src/components/UIFeedbackNotFound.tsx
import type { ReactNode } from 'react';

interface UIFeedbackNotFoundProps {
    /** Classe do ícone Font Awesome (ex: 'fa-search'). */
    icon: string;
    /** Título principal da mensagem. */
    titulo: string;
    /** Mensagem de texto de apoio. */
    mensagem: string;
    /** Opcional: botões ou outros elementos de ação. */
    children?: ReactNode;
    /** Apresentação reduzida para listas, tabelas e modais compactos. */
    variante?: 'padrao' | 'compacto';
}

export default function UIFeedbackNotFound({
    icon,
    titulo,
    mensagem,
    children,
    variante = 'padrao',
}: UIFeedbackNotFoundProps) {
    const classeContainer = `gs-feedback-not-found-container${variante === 'compacto' ? ' gs-feedback-not-found-container--compacto' : ''}`;

    return (
        <div className={classeContainer} role="status" aria-live="polite" aria-atomic="true">
            <div className="gs-feedback-not-found-icone" aria-hidden="true">
                <i className={`fas ${icon}`}></i>
            </div>
            <div className="gs-feedback-not-found-conteudo">
                <h4 className="gs-feedback-not-found-titulo">{titulo}</h4>
                <p className="gs-feedback-not-found-mensagem">{mensagem}</p>
            </div>
            {children && (
                <div className="gs-feedback-not-found-acoes">
                    {children}
                </div>
            )}
        </div>
    );
}
