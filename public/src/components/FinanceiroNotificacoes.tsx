import { useCallback, useEffect, useState } from 'react';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import { fetchFinanceiro } from '../utils/financeiro-api';
import { useFinanceiro } from './FinanceiroContext';

interface Notification {
  id: string | number;
  tipo: string;
  mensagem: string;
  criado_em: string;
  lida: boolean;
}

interface NotificacoesResponse {
  notificacoes: Notification[];
  currentPage: number;
  totalPages: number;
  total: number;
  naoLidas: number;
  limit: number;
}

const TIPO_META: Record<string, { icon: string; label: string; tone: 'sucesso' | 'rejeicao' | 'info' }> = {
  SUCESSO: { icon: 'fa-check', label: 'Aprovado', tone: 'sucesso' },
  REJEICAO: { icon: 'fa-times', label: 'Rejeitado', tone: 'rejeicao' },
  INFO: { icon: 'fa-info', label: 'Informação', tone: 'info' },
};

const PAGE_SIZE = 8;
const CLOSE_MS = 240;

function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?strong>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatRelative(dateIso: string) {
  const date = new Date(dateIso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'Agora';
  if (min < 60) return `Há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `Há ${d}d`;
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function FinanceiroNotificacoes() {
  const { refresh, setNotificacoesAbertas } = useFinanceiro();
  const [items, setItems] = useState<Notification[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [naoLidas, setNaoLidas] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | number | null>(null);
  const [phase, setPhase] = useState<'enter' | 'open' | 'leave'>('enter');

  const load = useCallback(async (pageToLoad = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(pageToLoad), limit: String(PAGE_SIZE) });
      const data = await fetchFinanceiro<NotificacoesResponse>(`/notificacoes?${params}`);
      setItems(data.notificacoes ?? []);
      setPage(data.currentPage ?? pageToLoad);
      setTotalPages(data.totalPages ?? 1);
      setTotal(data.total ?? 0);
      setNaoLidas(data.naoLidas ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as notificações.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(1); }, [load]);

  useEffect(() => {
    const id = window.setTimeout(() => setPhase('open'), 20);
    return () => window.clearTimeout(id);
  }, []);

  const requestClose = useCallback(() => {
    if (phase === 'leave') return;
    setPhase('leave');
    window.setTimeout(() => setNotificacoesAbertas(false), CLOSE_MS);
  }, [phase, setNotificacoesAbertas]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const read = async (id: string | number) => {
    const target = items.find((item) => item.id === id);
    if (!target || target.lida || busyId != null) return;
    setBusyId(id);
    try {
      await fetchFinanceiro(`/notificacoes/${id}/marcar-como-lida`, { method: 'POST' });
      setItems((current) => current.map((item) => (item.id === id ? { ...item, lida: true } : item)));
      setNaoLidas((n) => Math.max(0, n - 1));
      refresh('header');
    } finally {
      setBusyId(null);
    }
  };

  const readAll = async () => {
    if (!naoLidas || busyId != null) return;
    setBusyId('all');
    try {
      await fetchFinanceiro('/notificacoes/marcar-todas-como-lidas', { method: 'POST' });
      setItems((current) => current.map((item) => ({ ...item, lida: true })));
      setNaoLidas(0);
      refresh('header');
    } finally {
      setBusyId(null);
    }
  };

  const goToPage = (next: number) => {
    if (next < 1 || next > totalPages || next === page || loading) return;
    void load(next);
  };

  return (
    <div className={`fc-notif-layer is-${phase}`} role="presentation">
      <button
        type="button"
        className="fc-notif-backdrop"
        aria-label="Fechar notificações"
        onClick={requestClose}
      />

      <aside className="fc-notif-panel" role="dialog" aria-modal="true" aria-labelledby="fc-notif-title">
        <header className="fc-notif-header">
          <div className="fc-notif-header-copy">
            <h3 id="fc-notif-title">Notificações</h3>
            <p>
              {loading
                ? 'Atualizando...'
                : naoLidas > 0
                  ? `${naoLidas} não lida${naoLidas === 1 ? '' : 's'} · ${total} no total`
                  : total > 0
                    ? `${total} no total · tudo lido`
                    : 'Tudo em dia'}
            </p>
          </div>
          <div className="fc-notif-header-acoes">
            {naoLidas > 0 && (
              <button
                type="button"
                className="fc-notif-btn-texto"
                onClick={() => void readAll()}
                disabled={busyId != null}
              >
                Marcar todas
              </button>
            )}
            <button
              type="button"
              className="fc-notif-btn-fechar"
              onClick={requestClose}
              title="Fechar"
              aria-label="Fechar notificações"
            >
              <i className="fas fa-times" />
            </button>
          </div>
        </header>

        <div className="fc-notif-body">
          {loading && (
            <div className="fc-notif-loading">
              <UICarregando variante="inline" tamanho="sm" texto="Carregando..." />
            </div>
          )}

          {!loading && error && (
            <div className="fc-notif-estado">
              <i className="fas fa-exclamation-circle" />
              <p>{error}</p>
              <button type="button" className="fc-btn fc-btn-outline" onClick={() => void load(page)}>
                Tentar de novo
              </button>
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <UIFeedbackNotFound
              variante="compacto"
              icon="fa-inbox"
              titulo="Nenhuma notificação"
              mensagem="Quando houver aprovações ou recusas, elas aparecerão aqui."
            />
          )}

          {!loading && !error && items.length > 0 && (
            <ul className="fc-notif-lista">
              {items.map((item) => {
                const meta = TIPO_META[item.tipo] ?? TIPO_META.INFO;
                const mensagem = stripHtml(item.mensagem);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`fc-notif-item${item.lida ? '' : ' is-nova'}${busyId === item.id ? ' is-busy' : ''}`}
                      onClick={() => void read(item.id)}
                      disabled={item.lida || busyId != null}
                      title={item.lida ? 'Já lida' : 'Marcar como lida'}
                    >
                      <span className={`fc-notif-item-icone is-${meta.tone}`} aria-hidden>
                        <i className={`fas ${meta.icon}`} />
                      </span>
                      <span className="fc-notif-item-corpo">
                        <span className="fc-notif-item-topo">
                          <span className={`fc-notif-item-tipo is-${meta.tone}`}>{meta.label}</span>
                          <time dateTime={item.criado_em}>{formatRelative(item.criado_em)}</time>
                        </span>
                        <span className="fc-notif-item-msg">{mensagem}</span>
                      </span>
                      {!item.lida && <span className="fc-notif-item-dot" aria-label="Não lida" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {!loading && !error && totalPages > 1 && (
          <footer className="fc-notif-footer">
            <button
              type="button"
              className="fc-notif-page-btn"
              disabled={page <= 1 || busyId != null}
              onClick={() => goToPage(page - 1)}
            >
              <i className="fas fa-chevron-left" /> Anterior
            </button>
            <span className="fc-notif-page-info">
              Pág. {page} de {totalPages}
            </span>
            <button
              type="button"
              className="fc-notif-page-btn"
              disabled={page >= totalPages || busyId != null}
              onClick={() => goToPage(page + 1)}
            >
              Próxima <i className="fas fa-chevron-right" />
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}
