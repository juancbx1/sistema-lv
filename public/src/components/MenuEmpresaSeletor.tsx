import { createPortal } from 'react-dom';
import useDialogFocus from '../hooks/useDialogFocus';
import type { MenuEmpresa } from '../utils/menu-types';
import UICarregando from './UICarregando';

interface Props {
  aberto: boolean;
  empresas: MenuEmpresa[];
  empresaAtiva: MenuEmpresa;
  trocandoPara: number | null;
  onClose: () => void;
  onSelect: (empresa: MenuEmpresa) => void;
}
function obterNome(empresa: MenuEmpresa) {
  return empresa.nome_fantasia || empresa.razao_social || 'Empresa';
}

function obterIniciais(empresa: MenuEmpresa) {
  return obterNome(empresa)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join('')
    .toUpperCase();
}

export default function MenuEmpresaSeletor({
  aberto,
  empresas,
  empresaAtiva,
  trocandoPara,
  onClose,
  onSelect,
}: Props) {
  const dialogRef = useDialogFocus(aberto, onClose);
  if (!aberto) return null;

  return createPortal(
    <div
      className="ml-dialog-overlay ml-company-overlay is-visible"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !trocandoPara) onClose();
      }}
    >
      <section
        ref={dialogRef as React.RefObject<HTMLElement>}
        className="ml-dialog ml-company-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ml-company-dialog-title"
        aria-describedby="ml-company-dialog-description"
      >
        <header className="ml-dialog-header">
          <div>
            <span className="ml-dialog-kicker">Contexto de trabalho</span>
            <h2 id="ml-company-dialog-title">Escolher empresa</h2>
            <p id="ml-company-dialog-description">
              O sistema atualizará os dados para o contexto selecionado.
            </p>
          </div>
          <button
            className="ml-icon-button"
            type="button"
            onClick={onClose}
            disabled={Boolean(trocandoPara)}
            aria-label="Fechar seletor de empresa"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className="ml-company-list">
          {empresas.map((empresa) => {
            const ativa = empresa.id === empresaAtiva.id;
            const trocando = empresa.id === trocandoPara;
            const cor = empresa.cor_identificacao || '#2563eb';
            return (
              <button
                key={empresa.id}
                className={`ml-company-option${ativa ? ' is-active' : ''}`}
                type="button"
                disabled={Boolean(trocandoPara)}
                onClick={() => (ativa ? onClose() : onSelect(empresa))}
                aria-current={ativa ? 'true' : undefined}
                style={{ '--ml-empresa-cor': cor } as React.CSSProperties}
              >
                <span className="ml-company-option-brand" aria-hidden="true">
                  {empresa.logo_url ? (
                    <img src={empresa.logo_url} alt="" />
                  ) : (
                    <span>{obterIniciais(empresa)}</span>
                  )}
                </span>
                <span className="ml-company-option-copy">
                  <strong>{obterNome(empresa)}</strong>
                  <small>
                    {trocando
                      ? 'Aplicando empresa...'
                      : ativa
                        ? 'Em uso agora'
                        : empresa.empresa_principal
                          ? 'Empresa principal'
                          : 'Disponível para sua conta'}
                  </small>
                </span>
                <span className="ml-company-option-status" aria-hidden="true">
                  {trocando ? <UICarregando variante="inline" /> : <i className={`fa-solid ${ativa ? 'fa-check' : 'fa-chevron-right'}`} />}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>,
    document.body,
  );
}

export { obterIniciais, obterNome };
