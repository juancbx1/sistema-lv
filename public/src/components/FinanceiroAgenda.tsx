import { useCallback, useEffect, useState } from 'react';
import UICarregando from './UICarregando.jsx';
import FinanceiroAgendaCard from './FinanceiroAgendaCard.tsx';
import { fetchFinanceiro } from '../utils/financeiro-api';
import type { FinanceiroAgendaItem } from '../utils/financeiro-types';
import { mostrarConfirmacao, mostrarPromptTexto } from '../../js/utils/popups.js';
import { useFinanceiro } from './FinanceiroContext';

interface AgendaResponse { contasAgendadas: FinanceiroAgendaItem[][]; page: number; pages: number; }

/** Dentro do grupo e na lista: vencidos primeiro, depois o mais perto do vencimento. */
function ordenarGrupoPorVencimento(grupo: FinanceiroAgendaItem[]) {
  return [...grupo].sort((a, b) => {
    const ka = (a.data_vencimento || '').slice(0, 10);
    const kb = (b.data_vencimento || '').slice(0, 10);
    if (ka !== kb) return ka.localeCompare(kb);
    return Number(a.id) - Number(b.id);
  });
}

function ordenarGruposPorVencimento(grupos: FinanceiroAgendaItem[][]) {
  return [...grupos]
    .map(ordenarGrupoPorVencimento)
    .sort((a, b) => {
      const ka = (a[0]?.data_vencimento || '').slice(0, 10);
      const kb = (b[0]?.data_vencimento || '').slice(0, 10);
      if (ka !== kb) return ka.localeCompare(kb);
      return Number(a[0]?.id || 0) - Number(b[0]?.id || 0);
    });
}

export default function FinanceiroAgenda() {
  const { agendaFiltro, tokens, openAgendaModal, permissoes } = useFinanceiro();
  const [grupos, setGrupos] = useState<FinanceiroAgendaItem[][]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [filtroAtivo, setFiltroAtivo] = useState(agendaFiltro);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const podeBaixar = permissoes.includes('aprovar-pagamento');
  const podeEditarExcluir = permissoes.includes('lancar-transacao');

  const carregar = useCallback(async (nextPage = 1, nextFiltro = filtroAtivo) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(nextPage), ...(nextFiltro ? { vencimento: nextFiltro } : {}) });
      const data = await fetchFinanceiro<AgendaResponse>(`/contas-agendadas?${params}`);
      setGrupos(ordenarGruposPorVencimento(data.contasAgendadas));
      setPage(data.page);
      setPages(data.pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar a agenda.');
    } finally {
      setIsLoading(false);
    }
  }, [filtroAtivo]);

  useEffect(() => {
    setFiltroAtivo(agendaFiltro);
    void carregar(1, agendaFiltro);
  }, [agendaFiltro]); // eslint-disable-line react-hooks/exhaustive-deps -- recarrega só quando o filtro de navegação muda

  useEffect(() => {
    if (tokens.agenda > 0) void carregar(page, filtroAtivo);
  }, [tokens.agenda]); // eslint-disable-line react-hooks/exhaustive-deps

  const excluir = async (id: string | number) => {
    const ok = await mostrarConfirmacao(
      'Tem certeza que deseja excluir este agendamento?<br><br>Esta ação não pode ser desfeita.',
      {
        tipo: 'perigo',
        textoConfirmar: 'Excluir',
        textoCancelar: 'Cancelar',
      },
    );
    if (!ok) return;
    await fetchFinanceiro(`/contas-agendadas/${id}`, { method: 'DELETE' });
    void carregar(page, filtroAtivo);
  };

  const editarLote = async (id: string | number, atual: string) => {
    const descricao = await mostrarPromptTexto(
      'Informe a nova descrição do lote:',
      {
        tipo: 'aviso',
        placeholder: 'Descrição do lote...',
        textoConfirmar: 'Salvar',
        valorInicial: atual,
      },
    );
    if (!descricao?.trim() || descricao.trim() === atual) return;
    await fetchFinanceiro(`/lotes/${id}/descricao`, {
      method: 'PUT',
      body: JSON.stringify({ nova_descricao_base: descricao.trim() }),
    });
    void carregar(page, filtroAtivo);
  };

  if (isLoading) return <UICarregando variante="bloco" tamanho="md" texto="Buscando contas agendadas..." />;
  if (error) {
    return (
      <div>
        <p style={{ color: 'red', textAlign: 'center', padding: '20px' }}>{error}</p>
        <button type="button" className="fc-btn-atualizar" onClick={() => void carregar(page, filtroAtivo)}>Tentar novamente</button>
      </div>
    );
  }
  if (!grupos.length) return <p style={{ textAlign: 'center', padding: '20px' }}>Nenhuma conta pendente na agenda.</p>;

  return (
    <>
      {filtroAtivo && (
        <div className="fc-agenda-filtro-ativo">
          <span className="fc-launch-category-pill">Filtro: {filtroAtivo}</span>
          <button
            type="button"
            className="fc-launch-action"
            onClick={() => {
              setFiltroAtivo('');
              void carregar(1, '');
            }}
          >
            Limpar filtro
          </button>
        </div>
      )}

      <div className="fc-agenda-lista">
        {grupos.map((grupo) => {
          const primeiro = grupo[0];
          const chave = String(primeiro.id_lote ?? primeiro.id);
          return (
            <FinanceiroAgendaCard
              key={chave}
              grupo={grupo}
              isExpanded={Boolean(expanded[chave])}
              onToggle={() => setExpanded((current) => ({ ...current, [chave]: !current[chave] }))}
              onEdit={(item) => openAgendaModal({ mode: 'agenda', item })}
              onDelete={(id) => void excluir(id)}
              onBaixa={(item) => openAgendaModal({ mode: 'baixa', item })}
              onEditLote={(id, desc) => void editarLote(id, desc)}
              podeBaixar={podeBaixar}
              podeEditarExcluir={podeEditarExcluir}
            />
          );
        })}
      </div>

      <div className="fc-paginacao-container">
        <button type="button" className="gs-paginacao-btn" disabled={page <= 1} onClick={() => void carregar(page - 1, filtroAtivo)}>Anterior</button>
        <span className="gs-paginacao-info">Pág. {page} de {pages}</span>
        <button type="button" className="gs-paginacao-btn" disabled={page >= pages} onClick={() => void carregar(page + 1, filtroAtivo)}>Próximo</button>
      </div>
    </>
  );
}
