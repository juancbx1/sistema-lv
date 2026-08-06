import { useMemo, useState } from 'react';
import { MENU_GRUPOS, itemMenuEstaAtivo } from '../utils/menu-catalogo';
import type { MenuItem } from '../utils/menu-types';

interface Props {
  itens: MenuItem[];
  favoritos: string[];
  desabilitado?: boolean;
  onToggleFavorito: (id: string) => void;
}

export default function MenuModulos({
  itens,
  favoritos,
  desabilitado = false,
  onToggleFavorito,
}: Props) {
  const grupoAtivo = useMemo(
    () => itens.find((item) => itemMenuEstaAtivo(item))?.grupo,
    [itens],
  );
  const [gruposAbertos, setGruposAbertos] = useState<Set<string>>(
    () => new Set(grupoAtivo ? [grupoAtivo] : ['producao']),
  );

  const alternarGrupo = (grupoId: string) => {
    setGruposAbertos((atuais) => {
      const proximos = new Set(atuais);
      proximos.has(grupoId) ? proximos.delete(grupoId) : proximos.add(grupoId);
      return proximos;
    });
  };

  return (
    <section className="ml-section ml-modules-section">
      <div className="ml-section-title ml-section-title-static">
        <span>Módulos</span>
      </div>
      <div className="ml-module-groups">
        {MENU_GRUPOS.map((grupo) => {
          const itensGrupo = itens.filter((item) => item.grupo === grupo.id);
          if (itensGrupo.length === 0) return null;
          const aberto = gruposAbertos.has(grupo.id);
          const atual = grupoAtivo === grupo.id;
          return (
            <div
              className={`ml-module-group${aberto ? ' is-open' : ''}${atual ? ' is-current' : ''}`}
              key={grupo.id}
            >
              <button
                className="ml-module-group-trigger"
                type="button"
                aria-expanded={aberto}
                aria-controls={`ml-group-${grupo.id}`}
                onClick={() => alternarGrupo(grupo.id)}
              >
                <i className={grupo.icone} aria-hidden="true" />
                <span>{grupo.rotulo}</span>
                <i className="fa-solid fa-chevron-right ml-group-chevron" aria-hidden="true" />
              </button>
              <ul id={`ml-group-${grupo.id}`} hidden={!aberto}>
                {itensGrupo.map((item) => {
                  const favorito = favoritos.includes(item.id);
                  const ativo = itemMenuEstaAtivo(item);
                  return (
                    <li key={item.id}>
                      <a
                        className={`ml-nav-link${ativo ? ' is-active' : ''}`}
                        href={item.href}
                        aria-current={ativo ? 'page' : undefined}
                      >
                        <i className={item.icone} aria-hidden="true" />
                        <span>{item.rotulo}</span>
                      </a>
                      <button
                        className={`ml-favorite-toggle${favorito ? ' is-favorite' : ''}`}
                        type="button"
                        disabled={desabilitado}
                        onClick={() => onToggleFavorito(item.id)}
                        aria-label={
                          favorito
                            ? `Remover ${item.rotulo} dos favoritos`
                            : `Adicionar ${item.rotulo} aos favoritos`
                        }
                        aria-pressed={favorito}
                      >
                        <i
                          className={`${favorito ? 'fa-solid' : 'fa-regular'} fa-star`}
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
