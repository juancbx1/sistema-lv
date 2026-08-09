import type { CSSProperties, KeyboardEvent } from 'react';
import {
  getImagemVariacao,
  getNomeProduto,
  getSkuVariacao,
} from '../utils/embalagem-produto-helpers';
import type { EmbalagemFilaItem } from '../utils/embalagem-types';

interface EmbalagemCardProps {
  item: EmbalagemFilaItem;
  onClick: (item: EmbalagemFilaItem) => void;
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatarDisponivelDesde(value: string | null): string {
  const date = toDate(value);
  if (!date) return 'Data não informada';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace(',', ' ·');
}

export function formatarTempoNaFila(value: string | null): string {
  const date = toDate(value);
  if (!date) return 'Tempo indisponível';

  const elapsedMilliseconds = Math.max(0, Date.now() - date.getTime());
  const elapsedMinutes = Math.floor(elapsedMilliseconds / 60000);
  const days = Math.floor(elapsedMinutes / 1440);
  const hours = Math.floor((elapsedMinutes % 1440) / 60);
  const minutes = elapsedMinutes % 60;

  if (days > 0) return `${days}d ${hours}h aguardando`;
  if (hours > 0) return `${hours}h ${minutes}min aguardando`;
  if (minutes > 0) return `${minutes}min aguardando`;
  return 'Há poucos minutos';
}

function getAccentColor(item: EmbalagemFilaItem): string {
  const date = toDate(item.disponivelDesde);
  if (!date) return 'var(--gs-primaria, #4f46e5)';

  const elapsedHours = Math.max(0, Date.now() - date.getTime()) / 3600000;
  if (elapsedHours >= 48) return '#c2410c';
  if (elapsedHours >= 24) return '#b7791f';
  return 'var(--gs-primaria, #4f46e5)';
}

export default function EmbalagemCard({ item, onClick }: EmbalagemCardProps) {
  const style = {
    '--card-charme-cor': getAccentColor(item),
  } as CSSProperties;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick(item);
    }
  };

  return (
    <button
      className="ep-card-fluxo"
      style={style}
      type="button"
      onClick={() => onClick(item)}
      onKeyDown={handleKeyDown}
      aria-label={`Abrir embalagem de ${getNomeProduto(item.produto, item.nomeProduto)} — ${item.variante}`}
    >
      <span className="card-borda-charme" aria-hidden="true" />

      <span className="ep-card-corpo">
        <span className="ep-card-imagem-wrap">
          <img
            className="ep-card-imagem"
            src={getImagemVariacao(item.produto, item.variante)}
            alt=""
            loading="lazy"
          />
        </span>

        <span className="ep-card-conteudo">
          <span className="ep-card-cabecalho">
            <span className="ep-card-variacao" title={item.variante}>
              {item.variante}
            </span>
          </span>

          <span className="ep-card-meta">
            <span>
              <small>SKU</small>
              <strong>{getSkuVariacao(item.produto, item.variante, item.sku)}</strong>
            </span>
            <span>
              <small>Disponível desde</small>
              <strong>{formatarDisponivelDesde(item.disponivelDesde)}</strong>
            </span>
          </span>

          <span className="ep-card-fila">
            <i className="far fa-clock" aria-hidden="true" />
            <span>{formatarTempoNaFila(item.disponivelDesde)}</span>
          </span>
        </span>
      </span>

      <span className="ep-card-quantidade">
        <span>
          <small>Quantidade disponível</small>
          <span className="ep-card-quantidade-valor">
            <strong>{item.quantidadeDisponivel}</strong>
            <span className="ep-card-quantidade-unidade">
              {item.quantidadeDisponivel === 1 ? 'und' : 'unds'}
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
