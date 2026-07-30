import { createPortal } from 'react-dom';
import useDialogFocus from '../hooks/useDialogFocus';

interface Props {
  aberto: boolean;
  titulo: string;
  mensagem: string;
  confirmarLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}
export default function MenuConfirmacao({
  aberto,
  titulo,
  mensagem,
  confirmarLabel,
  onClose,
  onConfirm,
}: Props) {
  const dialogRef = useDialogFocus(aberto, onClose);
  if (!aberto) return null;

  return createPortal(
    <div
      className="ml-dialog-overlay is-visible"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef as React.RefObject<HTMLElement>}
        className="ml-dialog ml-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ml-confirm-title"
        aria-describedby="ml-confirm-description"
      >
        <span className="ml-confirm-icon" aria-hidden="true">
          <i className="fa-solid fa-arrow-right-from-bracket" />
        </span>
        <h2 id="ml-confirm-title">{titulo}</h2>
        <p id="ml-confirm-description">{mensagem}</p>
        <footer className="ml-dialog-footer">
          <button className="ml-button" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="ml-button ml-button-danger"
            type="button"
            onClick={onConfirm}
          >
            {confirmarLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
