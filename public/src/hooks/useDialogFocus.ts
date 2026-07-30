import { useEffect, useRef } from 'react';

const SELETOR_FOCAVEL = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function useDialogFocus(
  aberto: boolean,
  onClose: () => void,
) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const focoAnteriorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aberto) return;
    focoAnteriorRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focaveis = Array.from(
      dialog?.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL) || [],
    );
    focaveis[0]?.focus();

    const aoPressionar = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (event.shiftKey && document.activeElement === primeiro) {
        event.preventDefault();
        ultimo.focus();
      } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault();
        primeiro.focus();
      }
    };

    document.addEventListener('keydown', aoPressionar);
    return () => {
      document.removeEventListener('keydown', aoPressionar);
      focoAnteriorRef.current?.focus?.();
    };
  }, [aberto, onClose]);

  return dialogRef;
}
