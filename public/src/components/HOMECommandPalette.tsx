import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import useDialogFocus from '../hooks/useDialogFocus';
import { MENU_GRUPOS } from '../utils/menu-catalogo';
import type { MenuItem } from '../utils/menu-types';

interface HOMECommandPaletteProps {
  aberto: boolean;
  itens: MenuItem[];
  recentes: MenuItem[];
  onFechar: () => void;
  onAbrir: (item: MenuItem) => void;
}

function normalizar(valor: string) {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

export default function HOMECommandPalette({ aberto, itens, recentes, onFechar, onAbrir }: HOMECommandPaletteProps) {
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus(aberto, onFechar);
  const resultados = useMemo(() => {
    const termo = normalizar(busca.trim());
    const base = termo ? itens : (recentes.length > 0 ? recentes : itens);
    return base.filter((item) => {
      const grupo = MENU_GRUPOS.find((entrada) => entrada.id === item.grupo)?.rotulo || '';
      return !termo || normalizar(`${item.rotulo} ${grupo}`).includes(termo);
    }).slice(0, 8);
  }, [busca, itens, recentes]);

  useEffect(() => {
    if (!aberto) return;
    setBusca('');
    setSelecionado(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [aberto]);

  useEffect(() => setSelecionado(0), [busca]);

  if (!aberto) return null;

  return createPortal(
    <div
      className="home-dialog-overlay home-command-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onFechar();
      }}
    >
      <section
        className="home-command-dialog"
        ref={dialogRef as RefObject<HTMLElement>}
        role="dialog"
        aria-modal="true"
        aria-label="Buscar no Sistema LV"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelecionado((atual) => Math.min(atual + 1, resultados.length - 1));
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelecionado((atual) => Math.max(atual - 1, 0));
          }
          if (event.key === 'Enter' && resultados[selecionado]) {
            event.preventDefault();
            onAbrir(resultados[selecionado]);
          }
        }}
      >
        <label className="home-command-search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <span className="sr-only">Buscar área ou ferramenta</span>
          <input
            ref={inputRef}
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Digite o nome de uma área ou ferramenta..."
            type="search"
            autoComplete="off"
          />
          <kbd>ESC</kbd>
        </label>

        <div className="home-command-label">
          <span>{busca ? 'Resultados' : recentes.length > 0 ? 'Acessados recentemente' : 'Todas as áreas'}</span>
          <small>{resultados.length} {resultados.length === 1 ? 'opção' : 'opções'}</small>
        </div>

        <div className="home-command-results" role="listbox">
          {resultados.map((item, indice) => {
            const grupo = MENU_GRUPOS.find((entrada) => entrada.id === item.grupo);
            return (
              <button
                className={selecionado === indice ? 'is-selected' : ''}
                type="button"
                key={item.id}
                role="option"
                aria-selected={selecionado === indice}
                onMouseEnter={() => setSelecionado(indice)}
                onClick={() => onAbrir(item)}
              >
                <span className={`home-tool-icon home-tool-icon-${item.grupo}`}>
                  <i className={item.icone} aria-hidden="true" />
                </span>
                <span>
                  <strong>{item.rotulo}</strong>
                  <small>{grupo?.rotulo}</small>
                </span>
                <i className="fa-solid fa-arrow-turn-down home-command-enter" aria-hidden="true" />
              </button>
            );
          })}
          {resultados.length === 0 && (
            <div className="home-command-empty">
              <i className="fa-regular fa-face-meh" aria-hidden="true" />
              <strong>Nada por aqui</strong>
              <span>Confira o termo digitado e tente novamente.</span>
            </div>
          )}
        </div>

        <footer className="home-command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
          <span><kbd>Enter</kbd> abrir</span>
          <span><kbd>Esc</kbd> fechar</span>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
