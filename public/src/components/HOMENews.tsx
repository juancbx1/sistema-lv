import { useMemo, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { changelog } from '../../js/utils/changelog-data.js';
import useDialogFocus from '../hooks/useDialogFocus';
import type { HomeChangelogEntrada } from '../utils/home-types';

interface HOMENewsProps {
  versaoLida: string | null;
  onMarcarLida: (versao: string) => void;
}

function categoriaDaNota(item: string) {
  const texto = item.toLocaleLowerCase('pt-BR');
  if (texto.includes('correç') || texto.includes('bug') || texto.includes('ajust')) {
    return { nome: 'Correção', icone: 'fa-solid fa-wrench', classe: 'fix' };
  }
  if (texto.includes('novo') || texto.includes('nova') || texto.includes('agora')) {
    return { nome: 'Novo', icone: 'fa-solid fa-sparkles', classe: 'new' };
  }
  return { nome: 'Melhoria', icone: 'fa-solid fa-arrow-trend-up', classe: 'improvement' };
}

function HomeNewsDialog({
  aberto,
  entradas,
  versaoLida,
  onFechar,
  onMarcarLida,
}: {
  aberto: boolean;
  entradas: HomeChangelogEntrada[];
  versaoLida: string | null;
  onFechar: () => void;
  onMarcarLida: (versao: string) => void;
}) {
  const [limite, setLimite] = useState(5);
  const dialogRef = useDialogFocus(aberto, onFechar);
  if (!aberto) return null;

  const versaoAtual = entradas[0]?.versao || __APP_VERSION__;
  const naoLida = versaoLida !== versaoAtual;

  return createPortal(
    <div
      className="home-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onFechar();
      }}
    >
      <section
        className="home-news-dialog"
        ref={dialogRef as RefObject<HTMLElement>}
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-news-dialog-title"
      >
        <header className="home-dialog-header">
          <div>
            <span className="home-section-kicker">Evolução do Sistema LV</span>
            <h2 id="home-news-dialog-title">Novidades e melhorias</h2>
            <p>As notas saem direto da mesma fonte usada pelo versionamento do sistema.</p>
          </div>
          <button className="home-dialog-close" type="button" onClick={onFechar} aria-label="Fechar novidades">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className="home-release-timeline">
          {entradas.slice(0, limite).map((entrada, indice) => (
            <article className={`home-release${indice === 0 ? ' is-current' : ''}`} key={`${entrada.versao}-${entrada.data}`}>
              <div className="home-release-marker" aria-hidden="true">
                <span>{indice === 0 ? <i className="fa-solid fa-bolt" /> : null}</span>
              </div>
              <div className="home-release-content">
                <header>
                  <div>
                    <span className="home-release-version">v{entrada.versao}</span>
                    {indice === 0 && <span className="home-release-current">Versão atual</span>}
                  </div>
                  <time>{entrada.data}</time>
                </header>
                <ul>
                  {entrada.admin?.map((item) => {
                    const categoria = categoriaDaNota(item);
                    return (
                      <li key={item}>
                        <span className={`home-release-note-icon is-${categoria.classe}`}>
                          <i className={categoria.icone} aria-hidden="true" />
                        </span>
                        <span>
                          <small>{categoria.nome}</small>
                          {item}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </article>
          ))}
        </div>

        <footer className="home-dialog-footer">
          {limite < entradas.length ? (
            <button className="home-button home-button-ghost-dark" type="button" onClick={() => setLimite((atual) => atual + 5)}>
              Ver versões anteriores
            </button>
          ) : <span />}
          {naoLida ? (
            <button
              className="home-button home-button-primary"
              type="button"
              onClick={() => {
                onMarcarLida(versaoAtual);
                onFechar();
              }}
            >
              <i className="fa-solid fa-check" aria-hidden="true" />
              Marcar como lida
            </button>
          ) : (
            <button className="home-button home-button-ghost-dark" type="button" onClick={onFechar}>Fechar</button>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export default function HOMENews({ versaoLida, onMarcarLida }: HOMENewsProps) {
  const [aberto, setAberto] = useState(false);
  const entradas = useMemo(
    () => (changelog as HomeChangelogEntrada[]).filter((entrada) => Array.isArray(entrada.admin) && entrada.admin.length > 0),
    [],
  );
  const atual = entradas[0];
  const naoLida = Boolean(atual && atual.versao !== versaoLida);

  if (!atual) return null;

  return (
    <section className="home-news" id="home-novidades" aria-labelledby="home-news-title">
      <div className="home-news-topline">
        <span className="home-news-version">v{atual.versao}</span>
        <span className="home-news-date">{atual.data}</span>
        {naoLida && <span className="home-news-unread">Não lida</span>}
      </div>
      <div className="home-news-heading">
        <span className="home-news-illustration" aria-hidden="true">
          <i className="fa-solid fa-wand-magic-sparkles" />
        </span>
        <div>
          <span className="home-section-kicker">Novidades no ar</span>
          <h2 id="home-news-title">O sistema continua evoluindo</h2>
          <p>Agora este espaço acompanha o changelog real — nada de texto estático.</p>
        </div>
      </div>
      <ul className="home-news-preview">
        {atual.admin?.slice(0, 3).map((item) => (
          <li key={item}>
            <i className="fa-solid fa-check" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <button className="home-news-link" type="button" onClick={() => setAberto(true)}>
        Abrir histórico completo
        <i className="fa-solid fa-arrow-right" aria-hidden="true" />
      </button>

      <HomeNewsDialog
        aberto={aberto}
        entradas={entradas}
        versaoLida={versaoLida}
        onFechar={() => setAberto(false)}
        onMarcarLida={onMarcarLida}
      />
    </section>
  );
}
