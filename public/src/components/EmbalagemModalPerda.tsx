import { useEffect } from 'react';

interface EmbalagemModalPerdaProps {
  onClose: () => void;
}

export default function EmbalagemModalPerda({
  onClose,
}: EmbalagemModalPerdaProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.classList.add('ep-modal-aberto');

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('ep-modal-aberto');
    };
  }, [onClose]);

  return (
    <div
      className="ep-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="ep-modal-opcoes ep-modal-perda"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ep-modal-perda-titulo"
      >
        <header className="ep-modal-cabecalho">
          <div>
            <span className="ep-modal-kicker">Fluxo da Produção</span>
            <h2 id="ep-modal-perda-titulo">Registrar perda</h2>
            <p>Entrada fora da fila de embalagem</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar registro de perda"
          >
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className="ep-modal-perda-conteudo">
          <div className="ep-modal-perda-icone" aria-hidden="true">
            <i className="fas fa-triangle-exclamation" />
          </div>
          <h3>Perda vinculada à origem da produção</h3>
          <p>
            Este será o mesmo registro de perda usado na página de OPs, com
            produto, variação, origem e motivo. Nenhum descarte é criado nesta
            tela.
          </p>
          <span className="ep-modal-em-breve">Fluxo unificado em migração</span>
        </div>

        <footer className="ep-modal-perda-rodape">
          <button className="gs-btn gs-btn-secundario" type="button" onClick={onClose}>
            Fechar
          </button>
        </footer>
      </section>
    </div>
  );
}
