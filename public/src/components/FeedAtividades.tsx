import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import UILogItem, { HISTORICO_ACAO_GRUPOS, HISTORICO_ACAO_OPCOES } from './UILogItem.tsx';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UISearchableSelect from './UISearchableSelect.tsx';
import { fetchFinanceiro } from '../utils/financeiro-api';
import { useFinanceiro } from './FinanceiroContext';

interface LogAtividade {
  id: string | number;
  acao?: string;
  detalhes?: string;
  nome_usuario?: string;
  data_evento?: string;
  dados_alterados?: {
    antes?: Record<string, unknown> | null;
    depois?: Record<string, unknown> | null;
    [key: string]: unknown;
  } | null;
}

interface LogsResponse {
  logs: LogAtividade[];
  currentPage: number;
  totalPages: number;
  total?: number;
}

interface HistoricoFiltros {
  q: string;
  acao: string;
  grupo: string;
  dataInicio: string;
  dataFim: string;
}

const filtrosVazios = (): HistoricoFiltros => ({
  q: '',
  acao: '',
  grupo: '',
  dataInicio: '',
  dataFim: '',
});

function countAvancados(f: HistoricoFiltros) {
  let n = 0;
  if (f.acao) n += 1;
  if (f.grupo) n += 1;
  if (f.dataInicio) n += 1;
  if (f.dataFim) n += 1;
  return n;
}

export default function FeedAtividades() {
  const { tokens } = useFinanceiro();
  const [logs, setLogs] = useState<LogAtividade[]>([]);
  const [paginacao, setPaginacao] = useState({ currentPage: 1, totalPages: 1, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<HistoricoFiltros>(filtrosVazios());
  const [filtrosAplicados, setFiltrosAplicados] = useState<HistoricoFiltros>(filtrosVazios());
  const [painelAberto, setPainelAberto] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLogs = useCallback(async (page = 1, filtrosAtivos: HistoricoFiltros = filtrosAplicados) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '12' });
      if (filtrosAtivos.q.trim()) params.set('q', filtrosAtivos.q.trim());
      if (filtrosAtivos.acao) params.set('acao', filtrosAtivos.acao);
      if (filtrosAtivos.dataInicio) params.set('dataInicio', filtrosAtivos.dataInicio);
      if (filtrosAtivos.dataFim) params.set('dataFim', filtrosAtivos.dataFim);

      const data = await fetchFinanceiro<LogsResponse>(`/logs?${params}`);
      setLogs(data.logs);
      setPaginacao({
        currentPage: data.currentPage,
        totalPages: data.totalPages,
        total: data.total ?? data.logs.length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao buscar o histórico');
      setLogs([]);
    } finally {
      setIsLoading(false);
    }
  }, [filtrosAplicados]);

  useEffect(() => { void fetchLogs(1, filtrosAplicados); }, [fetchLogs, filtrosAplicados]);
  useEffect(() => {
    if (tokens.feed > 0) void fetchLogs(paginacao.currentPage, filtrosAplicados);
  }, [tokens.feed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFiltrosAplicados((atual) => {
        if (atual.q === filtros.q) return atual;
        return { ...atual, q: filtros.q };
      });
    }, 320);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filtros.q]);

  const aplicarAvancados = () => {
    setFiltrosAplicados({ ...filtros });
  };

  const limparFiltros = () => {
    const vazios = filtrosVazios();
    setFiltros(vazios);
    setFiltrosAplicados(vazios);
    setPainelAberto(false);
  };

  const opcoesAcao = useMemo(() => {
    if (!filtros.grupo) return HISTORICO_ACAO_OPCOES;
    const grupo = HISTORICO_ACAO_GRUPOS.find((g) => g.id === filtros.grupo);
    if (!grupo) return HISTORICO_ACAO_OPCOES;
    const set = new Set(grupo.acoes);
    return HISTORICO_ACAO_OPCOES.filter((op) => set.has(op.value));
  }, [filtros.grupo]);

  const avancadosAtivos = countAvancados(filtrosAplicados);
  const temFiltroAtivo = Boolean(filtrosAplicados.q || avancadosAtivos > 0);

  return (
    <div className="fc-historico-shell">
      <header className="fc-historico-shell-header">
        <h2 className="fc-historico-shell-title">Histórico de atividades</h2>
        {!isLoading && !error && (
          <span className="fc-historico-shell-badge">
            {paginacao.total} evento{paginacao.total === 1 ? '' : 's'}
          </span>
        )}
      </header>

      <div className="fc-filtro-toolbar fc-historico-filtros">
        <div className="fc-filtro-toolbar-linha">
          <div className="fc-filtro-busca" role="search" aria-label="Buscar no histórico">
            <i className="fas fa-search fc-filtro-busca-icone" aria-hidden />
            <input
              type="search"
              className="fc-input fc-filtro-busca-input"
              placeholder="Buscar por texto, usuário ou tipo de ação..."
              value={filtros.q}
              onChange={(e) => setFiltros((c) => ({ ...c, q: e.target.value }))}
              autoComplete="off"
            />
            {filtros.q ? (
              <button
                type="button"
                className="fc-filtro-busca-limpar"
                onClick={() => setFiltros((c) => ({ ...c, q: '' }))}
                title="Limpar busca"
                aria-label="Limpar busca"
              >
                &times;
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className={`fc-filtro-toolbar-btn${painelAberto ? ' is-ativo' : ''}${avancadosAtivos ? ' has-badge' : ''}`}
            onClick={() => setPainelAberto((v) => !v)}
          >
            <i className="fas fa-sliders-h" />
            <span>Filtros{avancadosAtivos ? ` · ${avancadosAtivos}` : ''}</span>
          </button>

          {temFiltroAtivo && (
            <button type="button" className="fc-filtro-toolbar-btn is-ghost" onClick={limparFiltros}>
              <i className="fas fa-times" />
              <span>Limpar</span>
            </button>
          )}
        </div>

        {painelAberto && (
          <div className="fc-filtro-painel">
            <div className="fc-filtro-bloco">
              <span className="fc-filtro-bloco-label">Área</span>
              <div className="fc-filtro-chips" role="group" aria-label="Área da ação">
                <button
                  type="button"
                  className={`fc-filtro-chip${filtros.grupo === '' ? ' is-ativo' : ''}`}
                  onClick={() => setFiltros((c) => ({ ...c, grupo: '', acao: '' }))}
                >
                  Tudo
                </button>
                {HISTORICO_ACAO_GRUPOS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={`fc-filtro-chip${filtros.grupo === g.id ? ' is-ativo' : ''}`}
                    onClick={() => setFiltros((c) => ({
                      ...c,
                      grupo: g.id,
                      acao: c.acao && g.acoes.includes(c.acao) ? c.acao : '',
                    }))}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="fc-filtro-bloco fc-filtro-bloco-grid">
              <div className="fc-filtro-campo fc-filtro-campo-wide">
                <label>Tipo de ação</label>
                <UISearchableSelect
                  options={opcoesAcao}
                  placeholder="Digite para achar: baixa, estorno, transferência..."
                  initialValue={filtros.acao || null}
                  onChange={(val) => setFiltros((c) => ({ ...c, acao: val == null ? '' : String(val) }))}
                />
              </div>
              <div className="fc-filtro-campo">
                <label htmlFor="fc-hist-de">De</label>
                <input
                  id="fc-hist-de"
                  type="date"
                  className="fc-input"
                  value={filtros.dataInicio}
                  onChange={(e) => setFiltros((c) => ({ ...c, dataInicio: e.target.value }))}
                />
              </div>
              <div className="fc-filtro-campo">
                <label htmlFor="fc-hist-ate">Até</label>
                <input
                  id="fc-hist-ate"
                  type="date"
                  className="fc-input"
                  value={filtros.dataFim}
                  onChange={(e) => setFiltros((c) => ({ ...c, dataFim: e.target.value }))}
                />
              </div>
            </div>

            <div className="fc-filtro-painel-acoes">
              <button type="button" className="fc-btn fc-btn-secundario" onClick={limparFiltros}>
                Limpar
              </button>
              <button type="button" className="fc-btn fc-btn-primario" onClick={aplicarAvancados}>
                Aplicar filtros
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="fc-historico-panel">
        {isLoading && <UICarregando variante="bloco" tamanho="md" texto="Carregando histórico..." />}
        {error && !isLoading && <p className="fc-historico-erro">{error}</p>}

        {!isLoading && !error && (
          <>
            {logs.length > 0 ? (
              <div className="fc-historico-lista">
                {logs.map((log) => <UILogItem key={log.id} log={log} />)}
              </div>
            ) : (
              <UIFeedbackNotFound
                variante="compacto"
                icon={temFiltroAtivo ? 'fa-search' : 'fa-history'}
                titulo={temFiltroAtivo ? 'Nenhuma atividade encontrada' : 'Nenhuma atividade registrada ainda'}
                mensagem={temFiltroAtivo ? 'Tente ajustar os filtros selecionados.' : 'As atividades aparecerão aqui quando forem registradas.'}
              />
            )}

            {paginacao.totalPages > 1 && (
              <div className="fc-paginacao-container fc-historico-paginacao">
                <button
                  type="button"
                  className="gs-paginacao-btn"
                  disabled={paginacao.currentPage <= 1}
                  onClick={() => void fetchLogs(paginacao.currentPage - 1)}
                >
                  Anterior
                </button>
                <span className="gs-paginacao-info">
                  Pág. {paginacao.currentPage} de {paginacao.totalPages}
                </span>
                <button
                  type="button"
                  className="gs-paginacao-btn"
                  disabled={paginacao.currentPage >= paginacao.totalPages}
                  onClick={() => void fetchLogs(paginacao.currentPage + 1)}
                >
                  Próximo
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
