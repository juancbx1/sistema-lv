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
}

export default function UIFeedbackNotFound({ icon, titulo, mensagem, children }: UIFeedbackNotFoundProps) {
    return (
        <div className="gs-feedback-not-found-container">
            <div className="gs-feedback-not-found-icone">
                <i className={`fas ${icon}`}></i>
            </div>
            <h4 className="gs-feedback-not-found-titulo">{titulo}</h4>
            <p className="gs-feedback-not-found-mensagem">{mensagem}</p>
            {children && (
                <div className="gs-feedback-not-found-acoes">
                    {children}
                </div>
            )}
        </div>
    );
}
