import type { MenuItem } from '../utils/menu-types';

interface HOMERecentsProps {
  itens: MenuItem[];
  onAbrir: (item: MenuItem) => void;
}

export default function HOMERecents({ itens, onAbrir }: HOMERecentsProps) {
  return (
    <section className="home-recents home-side-card" aria-labelledby="home-recents-title">
      <div className="home-side-card-heading">
        <span className="home-side-icon is-recent"><i className="fa-solid fa-clock-rotate-left" aria-hidden="true" /></span>
        <div>
          <span className="home-section-kicker">Continue de onde parou</span>
          <h2 id="home-recents-title">Acessos recentes</h2>
        </div>
      </div>

      {itens.length > 0 ? (
        <div className="home-recents-list">
          {itens.slice(0, 4).map((item) => (
            <button type="button" key={item.id} onClick={() => onAbrir(item)}>
              <span className={`home-tool-icon home-tool-icon-${item.grupo}`}>
                <i className={item.icone} aria-hidden="true" />
              </span>
              <span>{item.rotulo}</span>
              <i className="fa-solid fa-arrow-right" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : (
        <div className="home-recents-empty">
          <i className="fa-solid fa-route" aria-hidden="true" />
          <strong>Seu caminho aparecerá aqui</strong>
          <span>Abra uma área pela busca ou pelas sugestões para retomá-la rapidamente.</span>
        </div>
      )}
    </section>
  );
}
