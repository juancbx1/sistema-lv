import { useCallback, useEffect, useState } from 'react';
import { fetchFinanceiro } from '../utils/financeiro-api';
import type { FinanceiroAClassificarResponse, FinanceiroLancamento } from '../utils/financeiro-types';
import { useFinanceiro } from './FinanceiroContext';

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

interface Props {
  onReclassificar: (lancamento: FinanceiroLancamento) => void;
}

export default function FinanceiroAClassificarAlerta({ onReclassificar }: Props) {
  const { tokens } = useFinanceiro();
  const [total, setTotal] = useState(0);
  const [itens, setItens] = useState<FinanceiroLancamento[]>([]);
  const [aberto, setAberto] = useState(true);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const data = await fetchFinanceiro<FinanceiroAClassificarResponse>('/importacoes/a-classificar?limit=12');
      setTotal(data.total || 0);
      setItens(data.lancamentos || []);
      if ((data.total || 0) > 0) setAberto(true);
    } catch {
      // silencioso — alerta não deve quebrar a aba
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar, tokens.lancamentos]);

  if (total <= 0) return null;

  return (
    <section
      className="fc-aclassificar"
      role="status"
      aria-live="polite"
      aria-label={`${total} lançamentos sem classificação correta`}
    >
      <div className="card-borda-charme" />
      <header className="fc-aclassificar__header">
        <div className="fc-aclassificar__pulse" aria-hidden>
          <i className="fas fa-exclamation-triangle" />
        </div>
        <div className="fc-aclassificar__copy">
          <strong>Lançamentos sem classificação</strong>
          <p>
            Há <em>{total}</em> item(ns) na categoria <strong>A classificar</strong>.
            O extrato bateu com o banco, mas a categoria analítica ainda precisa ser corrigida.
          </p>
        </div>
        <div className="fc-aclassificar__actions">
          <button
            type="button"
            className="gs-btn gs-btn-secundario"
            onClick={() => void carregar()}
            disabled={carregando}
            title="Atualizar"
          >
            <i className={`fas fa-sync-alt ${carregando ? 'fa-spin' : ''}`} />
          </button>
          <button
            type="button"
            className="gs-btn gs-btn-secundario"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
          >
            {aberto ? 'Recolher' : 'Ver lista'}
          </button>
        </div>
      </header>

      {aberto && (
        <ul className="fc-aclassificar__lista">
          {itens.map((l) => (
            <li key={l.id} className="fc-aclassificar__item">
              <div>
                <span className="fc-aclassificar__data">{formatDate(l.data_transacao)}</span>
                <span className="fc-aclassificar__desc">{l.descricao || 'Sem descrição'}</span>
              </div>
              <div className="fc-aclassificar__direita">
                <span className={`fc-aclassificar__valor ${l.tipo === 'DESPESA' ? 'is-despesa' : 'is-receita'}`}>
                  {formatMoney(l.valor)}
                </span>
                <button
                  type="button"
                  className="gs-btn gs-btn-primario fc-aclassificar__btn"
                  onClick={() => onReclassificar(l)}
                >
                  Classificar
                </button>
              </div>
            </li>
          ))}
          {total > itens.length && (
            <li className="fc-aclassificar__mais">
              + {total - itens.length} outros. Use a busca nos lançamentos ou continue classificando um a um.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
