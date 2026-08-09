import type { HomeRecomendacao } from '../utils/home-types';

interface HOMERecommendationsProps {
  recomendacoes: HomeRecomendacao[];
  onAbrir: (item: HomeRecomendacao['item']) => void;
}

export default function HOMERecommendations({ recomendacoes, onAbrir }: HOMERecommendationsProps) {
  if (recomendacoes.length === 0) return null;

  return (
    <section className="home-recommendations" aria-labelledby="home-recommendations-title">
      <div className="home-recommendations-heading">
        <span className="home-recommendations-spark"><i className="fa-solid fa-bolt" aria-hidden="true" /></span>
        <div>
          <span className="home-section-kicker">Sugestões para agora</span>
          <h2 id="home-recommendations-title">Um próximo passo, se você quiser</h2>
        </div>
      </div>
      <div className="home-recommendations-list">
        {recomendacoes.map(({ item, motivo }) => (
          <button type="button" key={item.id} onClick={() => onAbrir(item)}>
            <span className={`home-tool-icon home-tool-icon-${item.grupo}`}>
              <i className={item.icone} aria-hidden="true" />
            </span>
            <span>
              <strong>{item.rotulo}</strong>
              <small>{motivo}</small>
            </span>
            <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}
