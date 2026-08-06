import { useMemo, useState } from 'react';
import UICarregando from './UICarregando';
import { fetchFinanceiro, FinanceiroApiException } from '../utils/financeiro-api';
import type {
  FinanceiroCategoria,
  FinanceiroImportacaoDetalhe,
  FinanceiroImportacaoLinha,
} from '../utils/financeiro-types';

interface Props {
  detalhe: FinanceiroImportacaoDetalhe;
  categorias: FinanceiroCategoria[];
  onClose: () => void;
  onAprovado: () => void;
  onAtualizado: (detalhe: FinanceiroImportacaoDetalhe) => void;
}

function formatMoney(v: string | number | null | undefined) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const raw = String(iso).slice(0, 10);
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('pt-BR');
}

function flagsLinha(linha: FinanceiroImportacaoLinha) {
  const payload = linha.payload_bruto_json as { flags_fase3?: Record<string, unknown> } | undefined;
  return (payload?.flags_fase3 || {}) as {
    transferencia_interna?: boolean;
    id_transferencia_par?: number;
    nome_conta_par?: string;
    id_agenda_sugerida?: number;
    desc_agenda?: string;
    score_agenda?: number;
    motivo_sugestao?: string;
    sugerir_ignorar?: boolean;
  };
}

function badgeLinha(linha: FinanceiroImportacaoLinha) {
  const flags = flagsLinha(linha);
  if (linha.status_linha === 'DUPLICATA') {
    return { cls: 'fc-imp-badge--dup', label: 'Duplicata', icon: 'fa-clone' };
  }
  if (linha.status_linha === 'IGNORADO' || linha.status_linha === 'DESCARTADO') {
    return {
      cls: 'fc-imp-badge--ign',
      label: flags.transferencia_interna ? 'Ignorado (transf.)' : 'Ignorado',
      icon: 'fa-ban',
    };
  }
  if (linha.status_linha === 'CONCILIADO' || linha.status_linha === 'NOVO_APROVADO') {
    return { cls: 'fc-imp-badge--ok', label: linha.status_linha === 'CONCILIADO' ? 'Conciliado' : 'Criado', icon: 'fa-check' };
  }
  const score = Number(linha.score_match ?? 0);
  if (linha.id_lancamento_sugerido && score >= 0.85) {
    return { cls: 'fc-imp-badge--match', label: 'Correspondência alta', icon: 'fa-link' };
  }
  if (linha.id_lancamento_sugerido && score >= 0.55) {
    return { cls: 'fc-imp-badge--maybe', label: 'Possível correspondência', icon: 'fa-question' };
  }
  if (flags.transferencia_interna) {
    return { cls: 'fc-imp-badge--transf', label: 'Transferência', icon: 'fa-exchange-alt' };
  }
  if (flags.id_agenda_sugerida) {
    return { cls: 'fc-imp-badge--agenda', label: 'Agenda', icon: 'fa-calendar-check' };
  }
  return { cls: 'fc-imp-badge--new', label: 'Novo', icon: 'fa-plus' };
}

export default function FinanceiroImportacaoRevisao({
  detalhe,
  categorias,
  onClose,
  onAprovado,
  onAtualizado,
}: Props) {
  const [linhas, setLinhas] = useState(detalhe.linhas);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(() => {
    const set = new Set<number>();
    for (const l of detalhe.linhas) {
      if (l.status_linha === 'PENDENTE' || l.status_linha === 'DUPLICATA') {
        set.add(Number(l.id));
      }
    }
    return set;
  });
  const [filtro, setFiltro] = useState<'todas' | 'novos' | 'match' | 'dup'>('todas');
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [patchingId, setPatchingId] = useState<number | null>(null);

  const importacao = detalhe.importacao;

  const visiveis = useMemo(() => {
    return linhas.filter((l) => {
      if (filtro === 'todas') return true;
      const score = Number(l.score_match ?? 0);
      if (filtro === 'dup') return l.status_linha === 'DUPLICATA';
      if (filtro === 'match') return Boolean(l.id_lancamento_sugerido) && score >= 0.55 && l.status_linha === 'PENDENTE';
      if (filtro === 'novos') {
        return l.status_linha === 'PENDENTE' && !l.id_lancamento_sugerido;
      }
      return true;
    });
  }, [linhas, filtro]);

  const contagens = useMemo(() => {
    let novos = 0;
    let match = 0;
    let dup = 0;
    let pend = 0;
    for (const l of linhas) {
      if (l.status_linha === 'DUPLICATA') dup += 1;
      else if (l.status_linha === 'PENDENTE') {
        pend += 1;
        const score = Number(l.score_match ?? 0);
        if (l.id_lancamento_sugerido && score >= 0.55) match += 1;
        else novos += 1;
      }
    }
    return { novos, match, dup, pend, total: linhas.length };
  }, [linhas]);

  const toggleSel = (id: number) => {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selecionarVisiveis = () => {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      for (const l of visiveis) {
        if (l.status_linha === 'PENDENTE' || l.status_linha === 'DUPLICATA') {
          next.add(Number(l.id));
        }
      }
      return next;
    });
  };

  const patchLinha = async (linhaId: number, body: Record<string, unknown>) => {
    setPatchingId(linhaId);
    setErro(null);
    try {
      const updated = await fetchFinanceiro<FinanceiroImportacaoLinha>(
        `/importacoes/extrato/${importacao.id}/linhas/${linhaId}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      setLinhas((curr) => curr.map((l) => (Number(l.id) === linhaId ? { ...l, ...updated } : l)));
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao atualizar linha.');
    } finally {
      setPatchingId(null);
    }
  };

  const aprovar = async (todosVisiveis = false) => {
    setProcessando(true);
    setErro(null);
    try {
      const ids = todosVisiveis
        ? visiveis
          .filter((l) => l.status_linha === 'PENDENTE' || l.status_linha === 'DUPLICATA')
          .map((l) => Number(l.id))
        : [...selecionadas];

      if (ids.length === 0) {
        setErro('Selecione ao menos uma linha para aprovar.');
        setProcessando(false);
        return;
      }

      await fetchFinanceiro(`/importacoes/extrato/${importacao.id}/aprovar`, {
        method: 'POST',
        body: JSON.stringify({ linhaIds: ids }),
      });

      const refreshed = await fetchFinanceiro<FinanceiroImportacaoDetalhe>(
        `/importacoes/extrato/${importacao.id}`,
      );
      setLinhas(refreshed.linhas);
      onAtualizado(refreshed);

      const aindaPend = refreshed.linhas.some((l) => l.status_linha === 'PENDENTE');
      if (!aindaPend) onAprovado();
      else {
        setSelecionadas(new Set(
          refreshed.linhas
            .filter((l) => l.status_linha === 'PENDENTE' || l.status_linha === 'DUPLICATA')
            .map((l) => Number(l.id)),
        ));
      }
    } catch (err) {
      const msg = err instanceof FinanceiroApiException
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Falha ao aprovar.';
      setErro(msg);
    } finally {
      setProcessando(false);
    }
  };

  const cancelarLote = async () => {
    setProcessando(true);
    setErro(null);
    try {
      await fetchFinanceiro(`/importacoes/extrato/${importacao.id}/cancelar`, { method: 'POST' });
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao cancelar.');
    } finally {
      setProcessando(false);
    }
  };

  return (
    <div className="fc-import-revisao" role="dialog" aria-modal="true" aria-labelledby="fc-imp-rev-title">
      <header className="fc-import-revisao__header">
        <div>
          <p className="fc-import-revisao__eyebrow">
            <i className="fas fa-file-import" aria-hidden /> Revisão do extrato
          </p>
          <h2 id="fc-imp-rev-title">{importacao.nome_arquivo}</h2>
          <p className="fc-import-revisao__meta">
            {importacao.nome_conta || `Conta #${importacao.id_conta_bancaria}`}
            {' · '}
            {formatDate(importacao.periodo_inicio || undefined)}
            {' — '}
            {formatDate(importacao.periodo_fim || undefined)}
            {' · '}
            {contagens.total} linhas
          </p>
        </div>
        <button type="button" className="gs-btn gs-btn-secundario" onClick={onClose} disabled={processando}>
          <i className="fas fa-times" /> Fechar
        </button>
      </header>

      <div className="fc-import-revisao__stats">
        <button type="button" className={`fc-import-stat${filtro === 'todas' ? ' is-ativo' : ''}`} onClick={() => setFiltro('todas')}>
          <strong>{contagens.total}</strong><span>Todas</span>
        </button>
        <button type="button" className={`fc-import-stat fc-import-stat--new${filtro === 'novos' ? ' is-ativo' : ''}`} onClick={() => setFiltro('novos')}>
          <strong>{contagens.novos}</strong><span>Novos</span>
        </button>
        <button type="button" className={`fc-import-stat fc-import-stat--match${filtro === 'match' ? ' is-ativo' : ''}`} onClick={() => setFiltro('match')}>
          <strong>{contagens.match}</strong><span>Correspondências</span>
        </button>
        <button type="button" className={`fc-import-stat fc-import-stat--dup${filtro === 'dup' ? ' is-ativo' : ''}`} onClick={() => setFiltro('dup')}>
          <strong>{contagens.dup}</strong><span>Duplicatas</span>
        </button>
      </div>

      <div className="fc-import-revisao__acoes">
        <button type="button" className="gs-btn gs-btn-secundario" onClick={selecionarVisiveis} disabled={processando}>
          Selecionar visíveis
        </button>
        <button
          type="button"
          className="gs-btn gs-btn-primario"
          onClick={() => void aprovar(false)}
          disabled={processando || selecionadas.size === 0}
        >
          {processando ? 'Processando…' : `Aprovar selecionados (${selecionadas.size})`}
        </button>
        <button
          type="button"
          className="gs-btn gs-btn-secundario"
          disabled={processando}
          onClick={() => {
            const token = localStorage.getItem('token') || '';
            void (async () => {
              try {
                const res = await fetch(
                  `/api/financeiro/importacoes/extrato/${importacao.id}/export?formato=csv`,
                  { headers: { Authorization: `Bearer ${token}` } },
                );
                if (!res.ok) throw new Error('Falha na exportação');
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `importacao-${importacao.id}-resultado.csv`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (err) {
                setErro(err instanceof Error ? err.message : 'Falha ao exportar CSV.');
              }
            })();
          }}
        >
          <i className="fas fa-file-csv" /> Exportar CSV
        </button>
        <button
          type="button"
          className="gs-btn gs-btn-secundario"
          onClick={() => void cancelarLote()}
          disabled={processando}
        >
          Cancelar lote
        </button>
      </div>

      {erro && <p className="fc-import-erro" role="alert">{erro}</p>}

      {processando && (
        <div className="fc-import-overlay-loading">
          <UICarregando variante="bloco" tamanho="md" texto="Gravando no caixa..." />
        </div>
      )}

      <div className="fc-import-lista">
        {visiveis.length === 0 ? (
          <p className="fc-import-vazio">Nenhuma linha neste filtro.</p>
        ) : visiveis.map((linha) => {
          const badge = badgeLinha(linha);
          const id = Number(linha.id);
          const locked = ['CONCILIADO', 'NOVO_APROVADO', 'DESCARTADO'].includes(linha.status_linha);
          const isDebito = linha.tipo_movimento === 'DEBITO';
          return (
            <article
              key={linha.id}
              className={`fc-import-linha ${badge.cls.replace('fc-imp-badge', 'fc-import-linha')}${selecionadas.has(id) ? ' is-selected' : ''}`}
            >
              <div className="card-borda-charme" />
              <div className="fc-import-linha__top">
                {!locked && (
                  <label className="fc-import-check">
                    <input
                      type="checkbox"
                      checked={selecionadas.has(id)}
                      onChange={() => toggleSel(id)}
                      disabled={processando}
                    />
                  </label>
                )}
                <div className="fc-import-linha__main">
                  <div className="fc-import-linha__head">
                    <span className={`fc-imp-badge ${badge.cls}`}>
                      <i className={`fas ${badge.icon}`} aria-hidden /> {badge.label}
                      {linha.score_match != null && Number(linha.score_match) > 0 && (
                        <> · {Math.round(Number(linha.score_match) * 100)}%</>
                      )}
                    </span>
                    <time dateTime={String(linha.data_transacao).slice(0, 10)}>
                      {formatDate(String(linha.data_transacao))}
                    </time>
                  </div>
                  <p className="fc-import-linha__desc">
                    {linha.descricao_final || linha.descricao_original || '—'}
                  </p>
                  {linha.id_lancamento_sugerido && (
                    <p className="fc-import-linha__match">
                      <i className="fas fa-link" aria-hidden />
                      {' '}
                      Lanç. #{linha.id_lancamento_sugerido}
                      {linha.desc_lancamento_sugerido ? ` — ${linha.desc_lancamento_sugerido}` : ''}
                      {linha.valor_lancamento_sugerido != null
                        ? ` (${formatMoney(linha.valor_lancamento_sugerido)})`
                        : ''}
                    </p>
                  )}
                  {(() => {
                    const fl = flagsLinha(linha);
                    if (!fl.transferencia_interna && !fl.id_agenda_sugerida && !fl.motivo_sugestao) return null;
                    return (
                      <p className="fc-import-linha__flags">
                        {fl.transferencia_interna && (
                          <span className="fc-imp-chip fc-imp-chip--transf">
                            <i className="fas fa-exchange-alt" aria-hidden />
                            Transf.
                            {fl.nome_conta_par ? ` ↔ ${fl.nome_conta_par}` : ''}
                            {fl.id_transferencia_par ? ` #${fl.id_transferencia_par}` : ''}
                          </span>
                        )}
                        {fl.id_agenda_sugerida && (
                          <span className="fc-imp-chip fc-imp-chip--agenda">
                            <i className="fas fa-calendar-check" aria-hidden />
                            Agenda #{fl.id_agenda_sugerida}
                            {fl.desc_agenda ? ` — ${fl.desc_agenda}` : ''}
                          </span>
                        )}
                        {fl.motivo_sugestao && (
                          <span className="fc-import-linha__motivo">{fl.motivo_sugestao}</span>
                        )}
                      </p>
                    );
                  })()}
                </div>
                <div className={`fc-import-linha__valor ${isDebito ? 'is-debito' : 'is-credito'}`}>
                  <span className="fc-import-linha__sentido">{isDebito ? 'Débito' : 'Crédito'}</span>
                  {isDebito ? '−' : '+'}{formatMoney(linha.valor)}
                </div>
              </div>

              {!locked && !linha.id_lancamento_sugerido && linha.status_linha === 'PENDENTE' && (
                <div className="fc-import-linha__edit">
                  <label>
                    <span>Categoria</span>
                    <select
                      className="fc-input"
                      value={linha.id_categoria != null ? String(linha.id_categoria) : ''}
                      disabled={patchingId === id || processando}
                      onChange={(e) => {
                        const v = e.target.value ? Number(e.target.value) : null;
                        void patchLinha(id, { id_categoria: v });
                      }}
                    >
                      <option value="">A classificar (provisório)</option>
                      {categorias.map((c) => (
                        <option key={c.id} value={String(c.id)}>{c.nome}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Descrição final</span>
                    <input
                      className="fc-input"
                      defaultValue={linha.descricao_final || linha.descricao_original || ''}
                      disabled={patchingId === id || processando}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== (linha.descricao_final || linha.descricao_original || '')) {
                          void patchLinha(id, { descricao_final: v });
                        }
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="gs-btn gs-btn-secundario"
                    disabled={processando || !linha.id_categoria || !linha.descricao_normalizada}
                    title="Aplica esta categoria a todas as linhas novas com o mesmo histórico"
                    onClick={() => {
                      void (async () => {
                        setProcessando(true);
                        setErro(null);
                        try {
                          const r = await fetchFinanceiro<{ atualizadas: number }>(
                            `/importacoes/extrato/${importacao.id}/aplicar-categoria-memo`,
                            {
                              method: 'POST',
                              body: JSON.stringify({
                                linhaId: id,
                                id_categoria: linha.id_categoria,
                                id_contato: linha.id_contato ?? null,
                              }),
                            },
                          );
                          const refreshed = await fetchFinanceiro<FinanceiroImportacaoDetalhe>(
                            `/importacoes/extrato/${importacao.id}`,
                          );
                          setLinhas(refreshed.linhas);
                          onAtualizado(refreshed);
                          if (r.atualizadas > 1) {
                            // feedback leve via erro slot (verde seria ideal; reusa alerta)
                            setErro(null);
                          }
                        } catch (err) {
                          setErro(err instanceof Error ? err.message : 'Falha ao aplicar em lote.');
                        } finally {
                          setProcessando(false);
                        }
                      })();
                    }}
                  >
                    <i className="fas fa-layer-group" /> Mesmo histórico
                  </button>
                  <button
                    type="button"
                    className="gs-btn gs-btn-secundario fc-import-btn-ignorar"
                    disabled={processando}
                    onClick={() => void patchLinha(id, { status_linha: 'IGNORADO' })}
                  >
                    Ignorar
                  </button>
                </div>
              )}

              {!locked && linha.id_lancamento_sugerido && linha.status_linha === 'PENDENTE' && (
                <div className="fc-import-linha__edit">
                  <button
                    type="button"
                    className="gs-btn gs-btn-secundario"
                    disabled={processando}
                    onClick={() => void patchLinha(id, { limpar_match: true })}
                  >
                    Desfazer correspondência (tratar como novo)
                  </button>
                  <button
                    type="button"
                    className="gs-btn gs-btn-secundario fc-import-btn-ignorar"
                    disabled={processando}
                    onClick={() => void patchLinha(id, { status_linha: 'IGNORADO' })}
                  >
                    Ignorar
                  </button>
                </div>
              )}

              {linha.status_linha === 'IGNORADO' && !linha.id_lancamento_vinculado && (
                <div className="fc-import-linha__edit">
                  <button
                    type="button"
                    className="gs-btn gs-btn-secundario"
                    disabled={processando}
                    onClick={() => void patchLinha(id, { status_linha: 'PENDENTE' })}
                  >
                    Restaurar (voltar a pendente)
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
