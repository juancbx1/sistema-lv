import { useMemo } from 'react';
import type { FinanceiroAgendaItem } from '../utils/financeiro-types';
import { rotuloDataAgenda } from '../utils/financeiro-data-label';

interface Props {
  grupo: FinanceiroAgendaItem[];
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: (item: FinanceiroAgendaItem) => void;
  onDelete: (id: string | number) => void;
  onBaixa: (item: FinanceiroAgendaItem) => void;
  onEditLote: (idLote: string | number, descricaoAtual: string) => void;
  podeBaixar: boolean;
  podeEditarExcluir: boolean;
}

const formatCurrency = (value: unknown) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);

const formatDate = (value?: string) =>
  value
    ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : 'Não registrado';

const uniqueNames = (values: Array<string | undefined>) =>
  Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean))).join(', ');

/** Chave YYYY-MM-DD estável para ordenar/comparar vencimentos. */
function dataKey(dataVencimento?: string) {
  return (dataVencimento || '').slice(0, 10);
}

function isAtrasado(dataVencimento: string) {
  const key = dataKey(dataVencimento);
  if (!key) return false;
  const venc = new Date(`${key}T00:00:00`);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return venc < hoje;
}

/**
 * Ordenação da agenda/parcelas:
 * 1) vencidos primeiro (data mais antiga = mais atrasado no topo)
 * 2) depois o que está mais perto do vencimento (ASC)
 */
function ordenarPorVencimento(itens: FinanceiroAgendaItem[]) {
  return [...itens].sort((a, b) => {
    const ka = dataKey(a.data_vencimento);
    const kb = dataKey(b.data_vencimento);
    if (ka !== kb) return ka.localeCompare(kb);
    return Number(a.id) - Number(b.id);
  });
}

export default function FinanceiroAgendaCard({
  grupo,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  onBaixa,
  onEditLote,
  podeBaixar,
  podeEditarExcluir,
}: Props) {
  const parcelas = useMemo(() => ordenarPorVencimento(grupo), [grupo]);
  const primeiro = parcelas[0];
  const isLote = Boolean(primeiro.id_lote);
  const isReceber = primeiro.tipo === 'A_RECEBER';
  const isRateio = primeiro.tipo_rateio === 'DETALHADO';
  const isCompra = primeiro.tipo_rateio === 'COMPRA';
  const qtdAtrasadas = parcelas.filter((item) => isAtrasado(item.data_vencimento)).length;
  const atrasado = qtdAtrasadas > 0;
  const total = parcelas.reduce((sum, item) => sum + Number(item.valor || 0), 0);
  const valorExibido = isLote ? total : primeiro.valor;

  const itensRateio = primeiro.itens ?? [];
  const temItensRateio = !isLote && itensRateio.length > 0;
  const podeExpandir = isLote || temItensRateio;

  const favorecidosRateio = uniqueNames(itensRateio.map((item) => item.nome_contato_item));
  const favorecido =
    isRateio && favorecidosRateio
      ? favorecidosRateio
      : primeiro.nome_favorecido || 'Não informado';

  const categoria = isLote
    ? qtdAtrasadas > 0
      ? `${parcelas.length} parcela${parcelas.length > 1 ? 's' : ''} · ${qtdAtrasadas} vencida${qtdAtrasadas > 1 ? 's' : ''}`
      : `${parcelas.length} parcela${parcelas.length > 1 ? 's' : ''} pendente${parcelas.length > 1 ? 's' : ''}`
    : isRateio
      ? `Rateio${primeiro.nome_categoria ? ` · ${primeiro.nome_categoria}` : ''}`
      : isCompra
        ? (itensRateio[0]?.nome_categoria || 'Compra detalhada')
        : primeiro.nome_categoria || 'Sem categoria';

  const operation = isLote
    ? 'Lote parcelado'
    : isRateio
      ? 'Rateio'
      : isCompra
        ? 'Compra detalhada'
        : isReceber
          ? 'A receber'
          : 'A pagar';

  const bordaClasse = isReceber
    ? 'receita'
    : isRateio
      ? 'rateio'
      : 'despesa';

  const valorClasse = isReceber ? 'valor-receita' : 'valor-despesa';
  const idLabel = isLote ? `Lote #${primeiro.id_lote}` : `#${primeiro.id}`;
  const agendadoPor = primeiro.nome_usuario_agendamento || 'N/A';
  const dataAgenda = rotuloDataAgenda(primeiro, { isLote, qtdAtrasadas });

  return (
    <article
      className={`fc-smart-card ${bordaClasse} ${isExpanded ? 'is-expanded' : ''}${atrasado ? ' is-atrasado' : ''}`}
    >
      <div className="card-borda-charme" />

      <div className="fc-smart-card-top">
        <div className="fc-smart-card-main">
          <div className="fc-launch-card-head">
            <div className="fc-launch-card-title">
              <div className="fc-launch-operation-row">
                <span className={`fc-launch-operation ${bordaClasse}`}>
                  <i
                    className={`fas ${
                      isLote
                        ? 'fa-layer-group'
                        : isRateio
                          ? 'fa-code-branch'
                          : isCompra
                            ? 'fa-basket-shopping'
                            : isReceber
                              ? 'fa-arrow-down'
                              : 'fa-arrow-up'
                    }`}
                  />{' '}
                  {operation}
                </span>
                <span
                  className={`fc-launch-date${dataAgenda.tone === 'atrasado' ? ' is-atrasado' : ''}`}
                  title="Data de vencimento do título na agenda"
                >
                  <i className="fas fa-calendar-day" /> {dataAgenda.text}
                </span>
              </div>
              <h3>{primeiro.descricao || 'Agendamento sem descrição'}</h3>
              <span className="fc-launch-id">
                {idLabel} · agendado por {agendadoPor}
              </span>
            </div>
            <div className="fc-launch-amount-block">
              <span className={`fc-launch-amount ${valorClasse}`}>
                {isReceber ? '+' : '-'} {formatCurrency(valorExibido)}
              </span>
              {atrasado ? (
                <span className="fc-launch-status danger">
                  <i /> {isLote && qtdAtrasadas > 1 ? `${qtdAtrasadas} vencidas` : 'vencido'}
                </span>
              ) : (
                <span className="fc-launch-status pending">
                  <i /> agendado
                </span>
              )}
            </div>
          </div>

          <div className="fc-launch-category-row">
            <div className="fc-launch-meta-pair">
              <span className="fc-launch-category-label">{isLote ? 'Parcelas' : 'Categoria'}</span>
              <span className={`fc-launch-category-pill ${isRateio ? 'rateio' : ''}${isLote ? ' lote' : ''}${atrasado ? ' atrasado' : ''}`}>
                <i className={`fas ${atrasado ? 'fa-exclamation-triangle' : isLote ? 'fa-calendar-check' : 'fa-tag'}`} /> {categoria}
              </span>
            </div>
            <div className="fc-launch-meta-pair fc-launch-meta-pair--favorecido">
              <span className="fc-launch-category-label">
                {isRateio && !isLote ? 'Favorecidos' : 'Favorecido'}
              </span>
              <span className="fc-launch-beneficiary-inline" title={favorecido}>
                <i className="fas fa-user-friends" aria-hidden /> {favorecido}
              </span>
            </div>
            <div className="fc-launch-meta-pair fc-launch-meta-pair--banco">
              <span className="fc-launch-category-label">Agenda</span>
              <span className="fc-launch-beneficiary-inline" title={isReceber ? 'Entrada prevista' : 'Saída prevista'}>
                <i className="fas fa-calendar-alt" aria-hidden /> {isReceber ? 'Entrada prevista' : 'Saída prevista'}
              </span>
            </div>
          </div>
        </div>

        <aside className="fc-smart-card-rail" aria-label="Ações do agendamento">
          {podeExpandir && (
            <button
              type="button"
              onClick={onToggle}
              className="fc-launch-action fc-launch-action-expand"
              title={isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}
              aria-expanded={isExpanded}
            >
              <i className={`fas ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`} />{' '}
              {isExpanded ? 'Ocultar' : isLote ? 'Parcelas' : 'Detalhes'}
            </button>
          )}

          {isLote ? (
            <button
              type="button"
              onClick={() => onEditLote(primeiro.id_lote ?? primeiro.id, primeiro.descricao)}
              className="fc-launch-action"
              title="Editar descrição do lote"
              disabled={!podeEditarExcluir}
            >
              <i className="fas fa-pencil-alt" /> Editar
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onEdit(primeiro)}
                className="fc-launch-action"
                title="Editar"
                disabled={!podeEditarExcluir}
              >
                <i className="fas fa-pencil-alt" /> Editar
              </button>
              <button
                type="button"
                onClick={() => onDelete(primeiro.id)}
                className="fc-launch-action danger"
                title="Excluir"
                disabled={!podeEditarExcluir}
              >
                <i className="fas fa-trash" /> Excluir
              </button>
              <button
                type="button"
                onClick={() => onBaixa(primeiro)}
                className="fc-launch-action sucesso"
                title="Baixar / confirmar pagamento"
                disabled={!podeBaixar}
              >
                <i className="fas fa-check" /> Baixar
              </button>
            </>
          )}
        </aside>
      </div>

      {isExpanded && isLote && (
        <div className="card-expanded-details">
          <div className="fc-expanded-heading">
            <span>Parcelas do lote</span>
            <small>
              {parcelas.length} pendente{parcelas.length > 1 ? 's' : ''}
              {qtdAtrasadas > 0 ? ` · ${qtdAtrasadas} vencida${qtdAtrasadas > 1 ? 's' : ''}` : ''}
            </small>
          </div>
          <div className="fc-expanded-items fc-agenda-parcelas">
            {parcelas.map((item) => {
              const parcelaAtrasada = isAtrasado(item.data_vencimento);
              return (
                <div
                  className={`fc-expanded-item fc-agenda-parcela${parcelaAtrasada ? ' is-atrasado' : ''}`}
                  key={item.id}
                >
                  <div className="card-borda-charme" />
                  <div className="fc-expanded-item-top">
                    <strong>#{item.id}</strong>
                    {parcelaAtrasada ? (
                      <span className="fc-agenda-parcela-badge">
                        <i className="fas fa-exclamation-circle" aria-hidden /> Vencido
                      </span>
                    ) : (
                      <span className="fc-agenda-parcela-badge is-ok">Em dia</span>
                    )}
                  </div>
                  <small className={`fc-agenda-parcela-data${parcelaAtrasada ? ' is-atrasado' : ''}`}>
                    <i className="fas fa-calendar-day" aria-hidden /> {formatDate(item.data_vencimento)}
                  </small>
                  <small title={item.descricao}>{item.descricao || 'Sem descrição'}</small>
                  <small>{item.nome_categoria || 'Sem categoria'}</small>
                  <div className="fc-agenda-parcela-foot">
                    <b>{formatCurrency(item.valor)}</b>
                    <button
                      type="button"
                      className={`fc-launch-action ${parcelaAtrasada ? 'danger' : 'sucesso'}`}
                      disabled={!podeBaixar}
                      onClick={() => onBaixa(item)}
                      title="Baixar parcela"
                    >
                      <i className="fas fa-check" /> Baixar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isExpanded && temItensRateio && (
        <div className={`card-expanded-details ${isCompra ? 'compra' : 'rateio'}`}>
          <div className="fc-expanded-heading">
            <span>{isCompra ? 'Itens da compra' : 'Distribuição do rateio'}</span>
            <small>{itensRateio.length} itens</small>
          </div>
          <div className="fc-expanded-items">
            {itensRateio.map((item, index) => (
              <div className={`fc-expanded-item ${isCompra ? 'compra' : 'rateio'}`} key={item.id ?? index}>
                <div className="card-borda-charme" />
                {isCompra ? (
                  <>
                    <div className="fc-expanded-item-top">
                      <strong>{item.descricao_item || 'Produto sem descrição'}</strong>
                      <span>{item.nome_categoria || 'Sem categoria'}</span>
                    </div>
                    <small>{item.nome_contato_item || '—'}</small>
                    <b>{formatCurrency(item.valor_item)}</b>
                  </>
                ) : (
                  <>
                    <div className="fc-expanded-item-top">
                      <strong>{item.nome_contato_item || 'Favorecido não informado'}</strong>
                      <span>{item.nome_categoria || 'Sem categoria'}</span>
                    </div>
                    <small>{item.descricao_item || 'Sem descrição'}</small>
                    <b>{formatCurrency(item.valor_item)}</b>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
