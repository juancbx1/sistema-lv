import { useEffect, useRef, useState } from 'react';
import LancamentoDetalhes from './LancamentoDetalhes.tsx';
import { fetchFinanceiro } from '../utils/financeiro-api';
import type { FinanceiroLancamento } from '../utils/financeiro-types';
import { textoDataLancamento, rotuloDataLancamento } from '../utils/financeiro-data-label';
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio';
import UICarregando from './UICarregando';

interface Props {
  lancamento: FinanceiroLancamento;
  onEdit: (lancamento: FinanceiroLancamento) => void;
  onDelete: () => void;
  onEstorno: (lancamento: FinanceiroLancamento) => void;
  onReverterEstorno: (id: string | number) => void;
  onToggleDetails: (id: string | number) => void;
  isExpanded: boolean;
}

interface SolicInfo {
  id: string | number;
  tipo_solicitacao: string;
  status: string;
  data_solicitacao?: string;
  data_decisao?: string | null;
  justificativa_solicitante?: string | null;
  motivo_rejeicao?: string | null;
  nome_solicitante?: string;
  nome_aprovador?: string | null;
}

interface InfoGerencial {
  id: string | number;
  descricao?: string;
  status_edicao?: string;
  motivo_rejeicao?: string | null;
  criado_por?: string;
  criado_em?: string;
  editado_por?: string | null;
  editado_em?: string | null;
  eh_estorno?: boolean;
  id_estorno_de?: string | number | null;
  eh_transferencia?: boolean;
  solicitacoes: SolicInfo[];
}

const LABEL_TIPO_SOL: Record<string, string> = {
  EDICAO: 'Edição',
  EXCLUSAO: 'Exclusão',
  ESTORNO: 'Estorno',
  REVERSAO_ESTORNO: 'Reversão de estorno',
  CRIACAO_DATAS_ESPECIAIS: 'Criação (data especial)',
};

const LABEL_STATUS_SOL: Record<string, string> = {
  PENDENTE: 'Pendente',
  APROVADO: 'Aprovado',
  REJEITADO: 'Rejeitado',
};

const LABEL_STATUS_LANC: Record<string, string> = {
  OK: 'Normal — sem pendência',
  PENDENTE_APROVACAO: 'Aguardando aprovação',
  PENDENTE_EXCLUSAO: 'Aguardando exclusão',
  ESTORNADO: 'Estornado',
  EDITADO_APROVADO: 'Editado (aprovado)',
  EDICAO_REJEITADA: 'Edição rejeitada',
};

const formatCurrency = (value: unknown) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);

const formatDateTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

const formatDate = (value?: string) =>
  value
    ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : 'Não registrado';

/** Rateio com vários favorecidos: placeholder visual "Diversos" (sem criar categoria). */
function rotuloFavorecidoRateio(
  itens: Array<{ nome_contato_item?: string | null }> | undefined,
  fallback?: string | null,
): string {
  const nomes = Array.from(
    new Set((itens ?? []).map((item) => item.nome_contato_item?.trim()).filter(Boolean) as string[]),
  );
  if (nomes.length >= 2) return 'Diversos';
  if (nomes.length === 1) return nomes[0];
  if ((itens?.length ?? 0) >= 2) return 'Diversos';
  return fallback?.trim() || 'Não informado';
}

function toneStatusSol(status?: string) {
  if (status === 'APROVADO') return 'sucesso';
  if (status === 'REJEITADO') return 'perigo';
  if (status === 'PENDENTE') return 'aviso';
  return 'neutro';
}

export default function LancamentoFinanceiroCard({
  lancamento,
  onEdit,
  onDelete,
  onEstorno,
  onReverterEstorno,
  onToggleDetails,
  isExpanded,
}: Props) {
  const isReceita = lancamento.tipo === 'RECEITA';
  const isPendente = lancamento.status_edicao?.startsWith('PENDENTE');
  const isEstornado = lancamento.status_edicao === 'ESTORNADO';
  const isEstorno = Boolean(lancamento.id_estorno_de);
  const isDetalhado = Boolean(lancamento.itens?.length);
  const isRateio = lancamento.tipo_rateio === 'DETALHADO';
  const isCompra = lancamento.tipo_rateio === 'COMPRA';
  const isTransferencia = Boolean(lancamento.id_transferencia_vinculada);
  const favorecido = isRateio
    ? rotuloFavorecidoRateio(lancamento.itens, lancamento.nome_favorecido)
    : lancamento.nome_favorecido || 'Não informado';
  const dataCaixaInfo = rotuloDataLancamento(lancamento);
  const dataCaixaTexto = textoDataLancamento(lancamento);
  const categoria = isTransferencia
    ? 'Transferência'
    : isRateio
      ? `Rateio${lancamento.nome_categoria ? ` · ${lancamento.nome_categoria}` : ''}`
      : isCompra
        ? (lancamento.itens?.[0]?.nome_categoria || 'Compra detalhada')
        : lancamento.nome_categoria || 'Sem categoria';
  const operation = isTransferencia
    ? 'Transferência'
    : isRateio
      ? 'Rateio'
      : isCompra
        ? 'Compra detalhada'
        : isReceita
          ? 'Receita'
          : 'Gasto';
  const bordaClasse = isReceita ? 'receita' : isTransferencia ? 'transferencia' : isRateio ? 'rateio' : 'despesa';
  const valorClasse = isReceita ? 'valor-receita' : 'valor-despesa';
  const disableEdit = Boolean(isPendente || isEstornado || isEstorno || isTransferencia);
  const disableDelete = Boolean(isPendente || isEstornado || isEstorno || isTransferencia);
  const podeVerInfoGerencial = temPermissao('exibir-informacao-gerencial');

  const [infoAberta, setInfoAberta] = useState(false);
  const [info, setInfo] = useState<InfoGerencial | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const painelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!infoAberta) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (painelRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.(`[data-info-gerencial-trigger="${lancamento.id}"]`)) return;
      setInfoAberta(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [infoAberta, lancamento.id]);

  const buscarInfo = async () => {
    setInfoLoading(true);
    setInfoError(null);
    try {
      const data = await fetchFinanceiro<InfoGerencial>(`/lancamentos/${lancamento.id}/info-gerencial`);
      setInfo(data);
    } catch (err) {
      setInfoError(err instanceof Error ? err.message : 'Não foi possível carregar a informação gerencial.');
      setInfo(null);
    } finally {
      setInfoLoading(false);
    }
  };

  const toggleInfo = async () => {
    if (!podeVerInfoGerencial) {
      mostrarPopupSemPermissao(
        'Você não tem permissão para ver a informação gerencial deste lançamento (quem criou, alterações e aprovações).',
      );
      return;
    }
    if (infoAberta) {
      setInfoAberta(false);
      return;
    }
    if (isExpanded) onToggleDetails(lancamento.id);
    setInfoAberta(true);
    if (!info) await buscarInfo();
  };

  const toggleDetalhes = () => {
    if (infoAberta) setInfoAberta(false);
    onToggleDetails(lancamento.id);
  };

  const statusAtual = info?.status_edicao || lancamento.status_edicao || 'OK';
  const solicitacoes = info?.solicitacoes ?? [];
  const aprovadas = solicitacoes.filter((s) => s.status === 'APROVADO');
  const pendentes = solicitacoes.filter((s) => s.status === 'PENDENTE');
  const temSolicitacoes = solicitacoes.length > 0;
  const editouDireto = Boolean(info?.editado_por) && !solicitacoes.some((s) => s.tipo_solicitacao === 'EDICAO' && s.status === 'APROVADO');

  return (
    <article className={`fc-smart-card ${bordaClasse} ${isExpanded ? 'is-expanded' : ''}${infoAberta ? ' is-info-open' : ''}`}>
      <div className="card-borda-charme" />

      <div className="fc-smart-card-top">
        <div className="fc-smart-card-main">
          <div className="fc-launch-card-head">
            <div className="fc-launch-card-title">
              <div className="fc-launch-operation-row">
                <span className={`fc-launch-operation ${bordaClasse}`}>
                  <i
                    className={`fas ${
                      isRateio
                        ? 'fa-code-branch'
                        : isCompra
                          ? 'fa-basket-shopping'
                          : isTransferencia
                            ? 'fa-right-left'
                            : isReceita
                              ? 'fa-arrow-down'
                              : 'fa-arrow-up'
                    }`}
                  />{' '}
                  {operation}
                </span>
                <span
                  className={`fc-launch-date${dataCaixaInfo.tone === 'estorno' ? ' is-estorno' : ''}`}
                  title="Data de caixa (quando o dinheiro saiu ou entrou na conta)"
                >
                  <i className="fas fa-calendar-day" /> {dataCaixaTexto}
                </span>
              </div>
              <h3>{lancamento.descricao || 'Lançamento sem descrição'}</h3>
              <span className="fc-launch-id">
                #{lancamento.id} · lançado em {formatDate(lancamento.data_lancamento)}
              </span>
            </div>
            <div className="fc-launch-amount-block">
              <span className={`fc-launch-amount ${valorClasse}`}>
                {isReceita ? '+' : '-'} {formatCurrency(lancamento.valor)}
              </span>
              {isPendente ? (
                <span className="fc-launch-status pending">
                  <i /> pendente
                </span>
              ) : isEstornado ? (
                <span className="fc-launch-status danger">
                  <i /> estornado
                </span>
              ) : (
                <span className="fc-launch-status confirmed">
                  <i /> confirmado
                </span>
              )}
            </div>
          </div>
          <div className="fc-launch-category-row">
            <div className="fc-launch-meta-pair">
              <span className="fc-launch-category-label">Categoria</span>
              <span className={`fc-launch-category-pill ${isRateio ? 'rateio' : ''}`}>
                <i className="fas fa-tag" /> {categoria}
              </span>
            </div>
            <div className="fc-launch-meta-pair fc-launch-meta-pair--favorecido">
              <span className="fc-launch-category-label">
                {isRateio ? 'Favorecidos' : 'Favorecido'}
              </span>
              <span className="fc-launch-beneficiary-inline" title={favorecido}>
                <i className="fas fa-user-friends" aria-hidden /> {favorecido}
              </span>
            </div>
            <div className="fc-launch-meta-pair fc-launch-meta-pair--banco">
              <span className="fc-launch-category-label">Banco</span>
              <span className="fc-launch-beneficiary-inline" title={lancamento.nome_conta || 'Conta não informada'}>
                <i className="fas fa-university" aria-hidden /> {lancamento.nome_conta || 'Conta não informada'}
              </span>
            </div>
          </div>
        </div>

        <aside className="fc-smart-card-rail" aria-label="Ações do lançamento">
          {isEstorno ? (
            <button
              type="button"
              onClick={() => onReverterEstorno(lancamento.id)}
              className="fc-launch-action danger"
              title="Reverter estorno"
              disabled={isPendente}
            >
              <i className="fas fa-history" /> Reverter
            </button>
          ) : (
            !isReceita &&
            !isTransferencia && (
              <button
                type="button"
                onClick={() => onEstorno(lancamento)}
                className="fc-launch-action estorno"
                title="Registrar estorno"
                disabled={Boolean(isPendente || isEstornado)}
              >
                <i className="fas fa-rotate-left" /> Estornar
              </button>
            )
          )}
          {!isTransferencia && (
            <>
              <button type="button" onClick={() => onEdit(lancamento)} className="fc-launch-action" title="Editar" disabled={disableEdit}>
                <i className="fas fa-pencil-alt" /> Editar
              </button>
              <button type="button" onClick={onDelete} className="fc-launch-action danger" title="Excluir" disabled={disableDelete}>
                <i className="fas fa-trash" /> Excluir
              </button>
            </>
          )}
          <button
            type="button"
            className={`fc-launch-action fc-launch-action-info${infoAberta ? ' is-open' : ''}${!podeVerInfoGerencial ? ' is-bloqueado' : ''}`}
            data-info-gerencial-trigger={lancamento.id}
            onClick={() => void toggleInfo()}
            aria-expanded={infoAberta}
            aria-controls={`fc-info-gerencial-${lancamento.id}`}
            title={podeVerInfoGerencial ? 'Ver informação gerencial' : 'Sem permissão para ver informação gerencial'}
          >
            {podeVerInfoGerencial ? (
              <i className={`fas ${infoAberta ? 'fa-chevron-up' : 'fa-circle-info'}`} aria-hidden />
            ) : (
              <span className="fc-launch-meta-lock" aria-hidden>
                <i className="fas fa-circle-info" />
                <i className="fas fa-lock" />
              </span>
            )}
            {infoAberta ? 'Fechar info' : 'Gerencial'}
          </button>
          {isDetalhado && (
            <button
              type="button"
              onClick={toggleDetalhes}
              className="fc-launch-action fc-launch-action-expand"
              title={isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}
              aria-expanded={isExpanded}
            >
              <i className={`fas ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`} /> {isExpanded ? 'Ocultar' : 'Detalhes'}
            </button>
          )}
        </aside>
      </div>

      {infoAberta && (
        <div
          id={`fc-info-gerencial-${lancamento.id}`}
          ref={painelRef}
          className="fc-info-gerencial fc-info-gerencial--below"
          role="region"
          aria-label="Informação gerencial do lançamento"
        >
          {infoLoading && (
            <p className="fc-info-gerencial-msg">
              <UICarregando variante="inline" /> Carregando trilha do lançamento…
            </p>
          )}

          {infoError && (
            <p className="fc-info-gerencial-msg is-erro" role="alert">
              {infoError}
              <button type="button" className="fc-info-gerencial-retry" onClick={() => void buscarInfo()}>
                Tentar de novo
              </button>
            </p>
          )}

          {!infoLoading && !infoError && info && (
            <>
              <div className="fc-info-gerencial-bloco">
                <h4>
                  <i className="fas fa-user-plus" aria-hidden /> Quem criou
                </h4>
                <p>
                  <strong>{info.criado_por || '—'}</strong>
                  <span> em {formatDateTime(info.criado_em)}</span>
                </p>
                {info.eh_estorno && info.id_estorno_de != null && (
                  <p className="fc-info-gerencial-nota">Este registro é um estorno do lançamento #{info.id_estorno_de}.</p>
                )}
                {info.eh_transferencia && (
                  <p className="fc-info-gerencial-nota">Este lançamento faz parte de uma transferência entre contas.</p>
                )}
              </div>

              <div className="fc-info-gerencial-bloco">
                <h4>
                  <i className="fas fa-flag" aria-hidden /> Situação agora
                </h4>
                <p>
                  <span className={`fc-info-gerencial-pill is-${statusAtual === 'ESTORNADO' || statusAtual === 'EDICAO_REJEITADA' ? 'perigo' : statusAtual?.startsWith('PENDENTE') ? 'aviso' : 'neutro'}`}>
                    {LABEL_STATUS_LANC[statusAtual] || statusAtual}
                  </span>
                </p>
                {info.motivo_rejeicao && (
                  <p className="fc-info-gerencial-nota is-perigo">Motivo da rejeição no lançamento: {info.motivo_rejeicao}</p>
                )}
                {info.editado_por && (
                  <p>
                    Última edição registrada: <strong>{info.editado_por}</strong>
                    {info.editado_em ? ` em ${formatDateTime(info.editado_em)}` : ''}
                    {editouDireto ? ' (pode ter sido edição direta, sem fila de aprovação).' : '.'}
                  </p>
                )}
                {!info.editado_por && !temSolicitacoes && statusAtual === 'OK' && (
                  <p className="fc-info-gerencial-nota">Nenhuma alteração registrada depois da criação.</p>
                )}
              </div>

              <div className="fc-info-gerencial-bloco">
                <h4>
                  <i className="fas fa-exchange-alt" aria-hidden /> Alterações e aprovações
                </h4>

                {pendentes.length > 0 && (
                  <p className="fc-info-gerencial-nota is-aviso">
                    Há {pendentes.length} pedido{pendentes.length > 1 ? 's' : ''} ainda pendente
                    {pendentes.length > 1 ? 's' : ''} (veja a aba Aprovações).
                  </p>
                )}

                {!temSolicitacoes ? (
                  <p className="fc-info-gerencial-nota">
                    Não há solicitações de edição, exclusão, estorno ou criação especial ligadas a este lançamento.
                    {statusAtual === 'ESTORNADO' && ' O status “Estornado” indica que o efeito no saldo já foi desfeito (com ou sem passar pela fila).'}
                  </p>
                ) : (
                  <ul className="fc-info-gerencial-lista">
                    {solicitacoes.map((s) => {
                      const tipoLabel = LABEL_TIPO_SOL[s.tipo_solicitacao] || s.tipo_solicitacao;
                      const statusLabel = LABEL_STATUS_SOL[s.status] || s.status;
                      const tone = toneStatusSol(s.status);
                      return (
                        <li key={s.id} className={`fc-info-gerencial-item is-${tone}`}>
                          <div className="fc-info-gerencial-item-topo">
                            <strong>{tipoLabel}</strong>
                            <span className={`fc-info-gerencial-pill is-${tone}`}>{statusLabel}</span>
                          </div>
                          <p>
                            Pedido por <strong>{s.nome_solicitante || '—'}</strong>
                            {s.data_solicitacao ? ` em ${formatDateTime(s.data_solicitacao)}` : ''}
                          </p>
                          {s.status === 'APROVADO' && (
                            <p>
                              Aprovado por <strong>{s.nome_aprovador || '—'}</strong>
                              {s.data_decisao ? ` em ${formatDateTime(s.data_decisao)}` : ''}
                            </p>
                          )}
                          {s.status === 'REJEITADO' && (
                            <p>
                              Rejeitado por <strong>{s.nome_aprovador || '—'}</strong>
                              {s.data_decisao ? ` em ${formatDateTime(s.data_decisao)}` : ''}
                              {s.motivo_rejeicao ? ` — “${s.motivo_rejeicao}”` : ''}
                            </p>
                          )}
                          {s.status === 'PENDENTE' && (
                            <p className="fc-info-gerencial-nota is-aviso">Ainda não foi decidido por um aprovador.</p>
                          )}
                          {s.justificativa_solicitante && (
                            <p className="fc-info-gerencial-just">
                              Justificativa: {s.justificativa_solicitante}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {aprovadas.length > 0 && (
                  <p className="fc-info-gerencial-resumo">
                    <i className="fas fa-check-circle" aria-hidden />{' '}
                    {aprovadas.length === 1
                      ? '1 aprovação registrada neste lançamento.'
                      : `${aprovadas.length} aprovações registradas neste lançamento.`}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {isExpanded && <LancamentoDetalhes lancamento={lancamento} />}
    </article>
  );
}
