import type { DragEvent } from 'react';
import type { MenuItem } from '../utils/menu-types';
import { itemMenuEstaAtivo } from '../utils/menu-catalogo';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UIBloqueio from './UIBloqueio';

interface Props {
  itens: MenuItem[];
  organizando: boolean;
  salvando: boolean;
  mostrarTodos: boolean;
  onMostrarTodos: () => void;
  onOrganizar: () => void;
  onRemover: (id: string) => void;
  onMove: (id: string, direcao: -1 | 1) => void;
  onDrop: (origemId: string, destinoId: string) => void;
}

export default function MenuFavoritos({
  itens,
  organizando,
  salvando,
  mostrarTodos,
  onMostrarTodos,
  onOrganizar,
  onRemover,
  onMove,
  onDrop,
}: Props) {
  const visiveis = mostrarTodos ? itens : itens.slice(0, 6);

  return (
    <section className={`ml-section ml-favorites-section${organizando ? ' is-organizing' : ''}`}>
      <div className="ml-section-title">
        <span>
          <i className="fa-solid fa-star" aria-hidden="true" />
          Favoritos
        </span>
        <button type="button" onClick={onOrganizar} disabled={salvando || itens.length < 2}>
          {salvando ? 'Salvando...' : organizando ? 'Concluir' : 'Organizar'}
        </button>
      </div>

      {itens.length === 0 ? (
        <UIFeedbackNotFound
          variante="compacto"
          icon="fa-star"
          titulo="Nenhum favorito ainda"
          mensagem="Use a estrela nos módulos para montar seus atalhos."
        />
      ) : (
        <ol className="ml-favorites-list">
          {visiveis.map((item, indice) => (
            <li
              key={item.id}
              className={itemMenuEstaAtivo(item) ? 'is-current' : undefined}
              draggable={organizando}
              onDragStart={(event: DragEvent<HTMLLIElement>) => {
                event.dataTransfer.setData('text/menu-favorite-id', item.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (organizando) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const origem = event.dataTransfer.getData('text/menu-favorite-id');
                if (origem && origem !== item.id) onDrop(origem, item.id);
              }}
            >
              <UIBloqueio
                permissao={item.permissao || 'acesso-admin-geral'}
                bloqueado={item.bloqueado}
                modoBloqueio="pagina"
                destinoBloqueio="home"
                tipoBloqueio={item.motivoBloqueio || 'permissao'}
                pagina={item.rotulo}
                mensagem={item.motivoBloqueio === 'modulo'
                  ? 'Este módulo ainda não está disponível para a empresa ativa.'
                  : `Seu vínculo atual não possui acesso à página ${item.rotulo}.`}
                style={{ display: 'block', width: '100%' }}
              >
                <a
                  className={`ml-nav-link${itemMenuEstaAtivo(item) ? ' is-active' : ''}`}
                  href={item.href}
                  aria-current={itemMenuEstaAtivo(item) ? 'page' : undefined}
                  aria-disabled={item.bloqueado || undefined}
                >
                  <i className={item.icone} aria-hidden="true" />
                  <span>{item.rotulo}</span>
                  {organizando && <i className="fa-solid fa-grip-lines" aria-hidden="true" />}
                </a>
              </UIBloqueio>
              {organizando ? (
                <span className="ml-reorder-actions">
                  <button
                    type="button"
                    disabled={indice === 0}
                    onClick={() => onMove(item.id, -1)}
                    aria-label={`Mover ${item.rotulo} para cima`}
                  >
                    <i className="fa-solid fa-chevron-up" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={indice === itens.length - 1}
                    onClick={() => onMove(item.id, 1)}
                    aria-label={`Mover ${item.rotulo} para baixo`}
                  >
                    <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                  </button>
                </span>
              ) : (
                <button
                  className="ml-favorite-remove"
                  type="button"
                  onClick={() => onRemover(item.id)}
                  aria-label={`Remover ${item.rotulo} dos favoritos`}
                  title="Remover dos favoritos"
                >
                  <i className="fa-solid fa-star" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {itens.length > 6 && !organizando && (
        <button className="ml-show-all" type="button" onClick={onMostrarTodos}>
          {mostrarTodos ? 'Mostrar menos' : `Ver todos (${itens.length})`}
          <i
            className={`fa-solid fa-chevron-${mostrarTodos ? 'up' : 'down'}`}
            aria-hidden="true"
          />
        </button>
      )}
    </section>
  );
}
