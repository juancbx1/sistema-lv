import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { HomeFocoItem } from '../utils/home-types';

interface HOMEFocusProps {
  itens: HomeFocoItem[];
  maximo: number;
  onAdicionar: (texto: string) => boolean;
  onAlternar: (id: string) => void;
  onRemover: (id: string) => void;
}

const SUGESTOES = ['Revisar prioridades da produção', 'Conferir pendências financeiras', 'Alinhar o time'];

export default function HOMEFocus({ itens, maximo, onAdicionar, onAlternar, onRemover }: HOMEFocusProps) {
  const [texto, setTexto] = useState('');
  const concluidos = itens.filter((item) => item.concluido).length;
  const progresso = itens.length > 0 ? Math.round((concluidos / itens.length) * 100) : 0;
  const sugestao = useMemo(
    () => SUGESTOES.find((item) => !itens.some((foco) => foco.texto === item)),
    [itens],
  );

  const adicionar = (event: FormEvent) => {
    event.preventDefault();
    if (onAdicionar(texto)) setTexto('');
  };

  return (
    <section className="home-focus home-side-card" aria-labelledby="home-focus-title">
      <div className="home-side-card-heading">
        <span className="home-side-icon is-focus"><i className="fa-solid fa-bullseye" aria-hidden="true" /></span>
        <div>
          <span className="home-section-kicker">Foco diário</span>
          <h2 id="home-focus-title">O que precisa avançar hoje?</h2>
        </div>
      </div>

      <div className="home-focus-progress">
        <div>
          <span>{concluidos} de {itens.length} concluídos</span>
          <strong>{progresso}%</strong>
        </div>
        <span className="home-progress-track"><i style={{ width: `${progresso}%` }} /></span>
      </div>

      <form className="home-focus-form" onSubmit={adicionar}>
        <label>
          <span className="sr-only">Nova prioridade</span>
          <input
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            placeholder="Adicionar uma prioridade..."
            maxLength={90}
            disabled={itens.length >= maximo}
          />
        </label>
        <button type="submit" disabled={!texto.trim() || itens.length >= maximo} aria-label="Adicionar prioridade">
          <i className="fa-solid fa-plus" aria-hidden="true" />
        </button>
      </form>

      {itens.length > 0 ? (
        <ul className="home-focus-list">
          {itens.map((item) => (
            <li className={item.concluido ? 'is-done' : ''} key={item.id}>
              <button className="home-focus-check" type="button" onClick={() => onAlternar(item.id)} aria-label={`${item.concluido ? 'Reabrir' : 'Concluir'} ${item.texto}`}>
                <i className="fa-solid fa-check" aria-hidden="true" />
              </button>
              <span>{item.texto}</span>
              <button className="home-focus-remove" type="button" onClick={() => onRemover(item.id)} aria-label={`Remover ${item.texto}`}>
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="home-focus-empty">
          <span>Seu dia começa com espaço.</span>
          <p>Escolha até {maximo} prioridades; amanhã você recebe uma lista nova.</p>
        </div>
      )}

      {sugestao && itens.length < maximo && (
        <button className="home-focus-suggestion" type="button" onClick={() => onAdicionar(sugestao)}>
          <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
          Sugerir: {sugestao}
        </button>
      )}
    </section>
  );
}
