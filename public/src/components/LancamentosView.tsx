import { useCallback, useEffect, useRef, useState } from 'react';
import LancamentoFinanceiroCard from './LancamentoFinanceiroCard.tsx';
import FiltrosLancamentos from './FiltrosLancamentos.tsx';
import FinanceiroGuiaLancamentos from './FinanceiroGuiaLancamentos.tsx';
import UINaoEncontradoBusca from './UINaoEncontradoBusca.tsx';
import UICarregando from './UICarregando';
import { fetchFinanceiro } from '../utils/financeiro-api';
import type { FinanceiroFilters, FinanceiroLancamento } from '../utils/financeiro-types';
import { mostrarConfirmacao, mostrarPromptTexto } from '../../js/utils/popups.js';
import { useFinanceiro } from './FinanceiroContext';

interface LancamentosResponse { lancamentos: FinanceiroLancamento[]; page: number; pages: number; }

const getLocalDateString = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};

const getInitialFilters = (resetCompleto = false): FinanceiroFilters => {
  const hoje = getLocalDateString();
  return {
    termoBusca: '',
    dataInicio: resetCompleto ? '' : hoje,
    dataFim: resetCompleto ? '' : hoje,
    tipo: '',
    idConta: '',
    tipoRateio: '',
  };
};

export default function LancamentosView() {
  const { config, tokens, openLancamentoModal, openEstornoModal, refresh } = useFinanceiro();
  const [lancamentos, setLancamentos] = useState<FinanceiroLancamento[]>([]);
  const [paginacao, setPaginacao] = useState({ currentPage: 1, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<FinanceiroFilters>(getInitialFilters());
  const [expandedCards, setExpandedCards] = useState<Array<string | number>>([]);
  const [guiaAberto, setGuiaAberto] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtrosRef = useRef(filtros);
  const pageRef = useRef(paginacao.currentPage);
  filtrosRef.current = filtros;
  pageRef.current = paginacao.currentPage;

  const fetchData = useCallback(async (page: number, currentFilters: FinanceiroFilters) => {
    setIsLoading(true);
    setError(null);
    try {
      const filtrosLimpos = Object.fromEntries(
        Object.entries(currentFilters).filter(([, value]) => value !== '' && value !== null),
      );
      const params = new URLSearchParams({ page: String(page), limit: '6', ...filtrosLimpos });
      const data = await fetchFinanceiro<LancamentosResponse>(`/lancamentos?${params}`);
      setLancamentos(data.lancamentos);
      setPaginacao({ currentPage: data.page, totalPages: data.pages });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao buscar lançamentos');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      void fetchData(paginacao.currentPage, filtros);
    }, 300);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [filtros, paginacao.currentPage, fetchData]);

  useEffect(() => {
    if (tokens.lancamentos > 0) void fetchData(pageRef.current, filtrosRef.current);
  }, [tokens.lancamentos, fetchData]);

  const handleFiltrosChange = (nomeFiltro: keyof FinanceiroFilters, valor: string) => {
    setFiltros((current) => ({ ...current, [nomeFiltro]: valor }));
    setPaginacao((current) => (current.currentPage === 1 ? current : { ...current, currentPage: 1 }));
  };

  const handleLimparFiltros = () => {
    setFiltros(getInitialFilters(true));
    setPaginacao((current) => ({ ...current, currentPage: 1 }));
  };

  const handleDelete = async (lancamento: FinanceiroLancamento) => {
    const justificativa = await mostrarPromptTexto(
      `Informe a justificativa para excluir o lançamento "${lancamento.descricao || 'sem descrição'}".`,
      { tipo: 'aviso', placeholder: 'Digite a justificativa...', textoConfirmar: 'Solicitar exclusão' },
    );
    if (!justificativa?.trim()) return;
    await fetchFinanceiro(`/lancamentos/${lancamento.id}/solicitar-exclusao`, {
      method: 'POST',
      body: JSON.stringify({ justificativa: justificativa.trim() }),
    });
    refresh('lancamentos');
  };

  const handleReverterEstorno = async (id: string | number) => {
    const ok = await mostrarConfirmacao(
      'Reverter este estorno?<br><br>' +
        'O lançamento original volta a valer no saldo e o estorno deixa de contar no extrato.',
      {
        tipo: 'aviso',
        textoConfirmar: 'Reverter',
        textoCancelar: 'Cancelar',
      },
    );
    if (!ok) return;
    await fetchFinanceiro(`/lancamentos/${id}/reverter-estorno`, { method: 'POST' });
    refresh('lancamentos');
    refresh('dashboard');
  };

  return (
    <div className="fc-section-container">
      <header className="fc-table-header">
        <h2 className="fc-section-title" style={{ border: 0, margin: 0 }}>Histórico de Lançamentos</h2>
        <button
          type="button"
          className="fc-btn-atualizar"
          onClick={() => void fetchData(paginacao.currentPage, filtros)}
          title="Atualizar lista de lançamentos"
          disabled={isLoading}
        >
          <i className={`fas fa-sync-alt ${isLoading ? 'fa-spin' : ''}`} /> Atualizar
        </button>
      </header>

      {guiaAberto && <FinanceiroGuiaLancamentos onClose={() => setGuiaAberto(false)} />}

      <FiltrosLancamentos
        filtros={filtros}
        contas={config.contas}
        onFiltrosChange={handleFiltrosChange}
        onLimparFiltros={handleLimparFiltros}
        toolbarExtra={
          !guiaAberto ? (
            <button
              type="button"
              className="fc-filtro-toolbar-btn fc-filtro-toolbar-btn-guia"
              onClick={() => setGuiaAberto(true)}
              title="Abrir guia: como lançar corretamente"
              aria-label="Abrir guia como lançar"
              aria-expanded={false}
              aria-controls="fc-lancamentos-guia"
            >
              <i className="fas fa-circle-info" aria-hidden />
              <span>Como lançar</span>
            </button>
          ) : null
        }
      />

      <div id="cards-container-react">
        {isLoading ? (
          <UICarregando variante="bloco" tamanho="md" texto="Buscando lançamentos..." />
        ) : error ? (
          <p style={{ color: 'red', textAlign: 'center', padding: '20px' }}>{error}</p>
        ) : lancamentos.length > 0 ? (
          lancamentos.map((lancamento) => (
            <LancamentoFinanceiroCard
              key={lancamento.id}
              lancamento={lancamento}
              onEdit={() => openLancamentoModal(lancamento)}
              onDelete={() => void handleDelete(lancamento)}
              onEstorno={openEstornoModal}
              onReverterEstorno={(id) => void handleReverterEstorno(id)}
              onToggleDetails={(id) => setExpandedCards((current) => (
                current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
              ))}
              isExpanded={expandedCards.includes(lancamento.id)}
            />
          ))
        ) : (
          <UINaoEncontradoBusca
            icon="fa-search"
            title="Nenhum Lançamento Encontrado"
            message="Tente ajustar os filtros de busca ou o período selecionado para encontrar o que você procura."
          />
        )}
      </div>

      {!isLoading && paginacao.totalPages > 1 && (
        <div id="paginacaoLancamentosContainer" className="fc-paginacao-container">
          <button
            type="button"
            className="gs-paginacao-btn"
            disabled={paginacao.currentPage <= 1}
            onClick={() => setPaginacao((current) => ({ ...current, currentPage: current.currentPage - 1 }))}
          >
            Anterior
          </button>
          <span className="gs-paginacao-info">Pág. {paginacao.currentPage} de {paginacao.totalPages}</span>
          <button
            type="button"
            className="gs-paginacao-btn"
            disabled={paginacao.currentPage >= paginacao.totalPages}
            onClick={() => setPaginacao((current) => ({ ...current, currentPage: current.currentPage + 1 }))}
          >
            Próximo
          </button>
        </div>
      )}
    </div>
  );
}
