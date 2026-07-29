import { useCallback, useEffect, useState } from 'react';
import FinanceiroModalShell from './FinanceiroModalShell';
import UICarregando from './UICarregando.jsx';
import { fetchFinanceiro } from '../utils/financeiro-api';
import { mostrarConfirmacao, mostrarMensagem } from '../../js/utils/popups.js';

interface RegistroExcluido {
  tipo_registro: 'LOTE' | 'AGENDAMENTO';
  id: string | number;
  id_lote?: string | number | null;
  descricao?: string;
  valor?: string | number;
  tipo?: string;
  data_vencimento?: string;
  excluido_em: string;
  nome_usuario_exclusao?: string;
  nome_categoria?: string;
  nome_favorecido?: string;
  quantidade_parcelas?: number;
  primeiro_vencimento?: string;
  ultimo_vencimento?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onRecovered: () => void;
}

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatarData(value?: string, comHora = false) {
  if (!value) return '—';
  const data = new Date(comHora ? value : `${value.slice(0, 10)}T12:00:00`);
  return data.toLocaleString('pt-BR', comHora
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'short' });
}

export default function FinanceiroAgendaHistoricoModal({
  open,
  onClose,
  onRecovered,
}: Props) {
  const [registros, setRegistros] = useState<RegistroExcluido[]>([]);
  const [loading, setLoading] = useState(false);
  const [recuperandoId, setRecuperandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFinanceiro<{ registros: RegistroExcluido[] }>('/agendamentos-excluidos');
      setRegistros(data.registros ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar o histórico.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void carregar();
  }, [open, carregar]);

  if (!open) return null;

  const recuperar = async (registro: RegistroExcluido) => {
    const ehLote = registro.tipo_registro === 'LOTE';
    const ok = await mostrarConfirmacao(
      ehLote
        ? `Recuperar o lote <strong>${registro.descricao || `#${registro.id}`}</strong> e suas parcelas pendentes?`
        : `Recuperar o agendamento <strong>${registro.descricao || `#${registro.id}`}</strong>?`,
      {
        tipo: 'aviso',
        textoConfirmar: 'Recuperar',
        textoCancelar: 'Cancelar',
      },
    );
    if (!ok) return;

    const chave = `${registro.tipo_registro}-${registro.id}`;
    setRecuperandoId(chave);
    setError(null);
    try {
      await fetchFinanceiro(
        ehLote ? `/lotes/${registro.id}/recuperar` : `/contas-agendadas/${registro.id}/recuperar`,
        { method: 'POST' },
      );
      mostrarMensagem(ehLote ? 'Lote recuperado com sucesso!' : 'Agendamento recuperado com sucesso!', 'sucesso');
      await carregar();
      onRecovered();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível recuperar o registro.');
    } finally {
      setRecuperandoId(null);
    }
  };

  return (
    <FinanceiroModalShell
      titulo="Histórico da Agenda"
      descricao="Consulte e recupere agendamentos removidos da empresa ativa."
      icone="fa-clock-rotate-left"
      onClose={onClose}
      erro={error}
      tamanho="lg"
      somenteFechar
    >
      <div className="fc-agenda-history">
        <div className="fc-agenda-history__intro">
          <div>
            <strong>Exclusões recuperáveis</strong>
            <span>{registros.length} registro{registros.length === 1 ? '' : 's'} no histórico</span>
          </div>
          <button type="button" className="fc-btn fc-btn-outline" onClick={() => void carregar()} disabled={loading}>
            <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-rotate'}`} aria-hidden="true" />
            Atualizar
          </button>
        </div>

        {loading ? (
          <UICarregando variante="bloco" tamanho="md" texto="Carregando exclusões da Agenda..." />
        ) : registros.length === 0 ? (
          <div className="fc-agenda-history__empty">
            <i className="fas fa-box-open" aria-hidden="true" />
            <strong>Nenhum agendamento excluído</strong>
            <span>Quando um agendamento ou lote for removido, ele aparecerá aqui.</span>
          </div>
        ) : (
          <div className="fc-agenda-history__list">
            {registros.map((registro) => {
              const ehLote = registro.tipo_registro === 'LOTE';
              const chave = `${registro.tipo_registro}-${registro.id}`;
              const recuperando = recuperandoId === chave;
              return (
                <article className="fc-agenda-history-card" key={chave}>
                  <div className="fc-agenda-history-card__icon">
                    <i className={`fas ${ehLote ? 'fa-layer-group' : 'fa-calendar-day'}`} aria-hidden="true" />
                  </div>
                  <div className="fc-agenda-history-card__main">
                    <div className="fc-agenda-history-card__head">
                      <div>
                        <span>{ehLote ? `Lote #${registro.id}` : `Agendamento #${registro.id}`}</span>
                        <h3>{registro.descricao || 'Sem descrição'}</h3>
                      </div>
                      <strong>{moeda.format(Number(registro.valor) || 0)}</strong>
                    </div>
                    <div className="fc-agenda-history-card__meta">
                      {ehLote ? (
                        <>
                          <span><i className="fas fa-list-ol" /> {registro.quantidade_parcelas || 0} parcela(s)</span>
                          <span><i className="fas fa-calendar" /> {formatarData(registro.primeiro_vencimento)} a {formatarData(registro.ultimo_vencimento)}</span>
                        </>
                      ) : (
                        <>
                          <span><i className="fas fa-calendar" /> Vencimento {formatarData(registro.data_vencimento)}</span>
                          <span><i className="fas fa-tag" /> {registro.nome_categoria || 'Sem categoria'}</span>
                          <span><i className="fas fa-user" /> {registro.nome_favorecido || 'Sem favorecido'}</span>
                        </>
                      )}
                    </div>
                    <small>
                      Excluído por <strong>{registro.nome_usuario_exclusao || 'Usuário não identificado'}</strong>
                      {' '}em {formatarData(registro.excluido_em, true)}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="fc-btn fc-agenda-history-card__recover"
                    onClick={() => void recuperar(registro)}
                    disabled={Boolean(recuperandoId)}
                  >
                    <i className={`fas ${recuperando ? 'fa-spinner fa-spin' : 'fa-rotate-left'}`} aria-hidden="true" />
                    {recuperando ? 'Recuperando...' : 'Recuperar'}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </FinanceiroModalShell>
  );
}
