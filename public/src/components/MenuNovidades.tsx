import { createPortal } from 'react-dom';
import { changelog } from '../../js/utils/changelog-data.js';
import useDialogFocus from '../hooks/useDialogFocus';

interface ChangelogEntrada {
  versao: string;
  data: string;
  admin?: string[];
}

interface Props {
  aberto: boolean;
  versaoAtual: string;
  versaoLida: string | null;
  onClose: () => void;
  onMarcarLido: (versao: string) => void;
}

function classificar(item: string) {
  const texto = item.toLocaleLowerCase('pt-BR');
  if (texto.includes('correç') || texto.includes('ajust') || texto.includes('bug')) {
    return { rotulo: 'Correção', icone: 'fa-solid fa-wrench' };
  }
  if (texto.includes('novo') || texto.includes('nova') || texto.includes('agora')) {
    return { rotulo: 'Novo', icone: 'fa-solid fa-sparkles' };
  }
  return { rotulo: 'Melhoria', icone: 'fa-solid fa-arrow-trend-up' };
}

export function contarNovidadesNaoLidas(versaoLida: string | null) {
  const entradas = (changelog as ChangelogEntrada[]).filter(
    (entrada) => Array.isArray(entrada.admin) && entrada.admin.length > 0,
  );
  if (entradas.length === 0 || entradas[0].versao === versaoLida) return 0;
  return entradas[0].admin?.length || 0;
}

export default function MenuNovidades({
  aberto,
  versaoAtual,
  versaoLida,
  onClose,
  onMarcarLido,
}: Props) {
  const dialogRef = useDialogFocus(aberto, onClose);
  if (!aberto) return null;

  const entradas = (changelog as ChangelogEntrada[]).filter(
    (entrada) => Array.isArray(entrada.admin) && entrada.admin.length > 0,
  );
  const versaoMaisRecente = entradas[0]?.versao || versaoAtual;
  const naoLido = versaoLida !== versaoMaisRecente;

  return createPortal(
    <div
      className="ml-dialog-overlay ml-news-overlay is-visible"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef as React.RefObject<HTMLElement>}
        className="ml-dialog ml-news-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ml-news-dialog-title"
      >
        <header className="ml-dialog-header">
          <div>
            <span className="ml-dialog-kicker">Versão {versaoAtual}</span>
            <h2 id="ml-news-dialog-title">Novidades do sistema</h2>
            <p>Acompanhe a evolução do Sistema LV.</p>
          </div>
          <button
            className="ml-icon-button"
            type="button"
            onClick={onClose}
            aria-label="Fechar novidades"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className="ml-news-timeline">
          {entradas.map((entrada, indice) => (
            <article
              className={`ml-release${indice === 0 ? ' is-current' : ''}`}
              key={`${entrada.versao}-${entrada.data}`}
            >
              <header>
                <span className="ml-release-version">v{entrada.versao}</span>
                {indice === 0 && <span className="ml-release-current">Atual</span>}
                <time>{entrada.data}</time>
              </header>
              <ul>
                {entrada.admin?.map((item) => {
                  const categoria = classificar(item);
                  return (
                    <li key={item}>
                      <span className="ml-release-icon" aria-hidden="true">
                        <i className={categoria.icone} />
                      </span>
                      <span>
                        <small>{categoria.rotulo}</small>
                        {item}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>

        <footer className="ml-dialog-footer">
          {naoLido ? (
            <button
              className="ml-button ml-button-primary"
              type="button"
              onClick={() => {
                onMarcarLido(versaoMaisRecente);
                onClose();
              }}
            >
              <i className="fa-solid fa-check" aria-hidden="true" />
              Marcar como lido
            </button>
          ) : (
            <button className="ml-button" type="button" onClick={onClose}>
              Fechar
            </button>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
