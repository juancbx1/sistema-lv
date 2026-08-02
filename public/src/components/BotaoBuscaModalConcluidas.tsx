import { useCallback, useEffect, useMemo, useState } from 'react';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import OPPaginacaoWrapper from './OPPaginacaoWrapper.tsx';
// @ts-expect-error utilitario JS legado sem declaracao TypeScript
import { mostrarMensagem } from '/js/utils/popups.js';
// @ts-expect-error utilitario JS legado sem declaracao TypeScript
import { calcularStatusDemanda, STATUS_META } from '/src/utils/demandaStatus.js';

type AbaAtiva = 'pendente' | 'arquivo';
type SubAba = 'concluidas' | 'divergencias';
type StatusFinal = 'CONCLUIDO' | 'DIVERGENCIA';

interface HistoricoItem {
  id?: number;
  demanda_id?: number;
  produto_id?: number;
  variante?: string | null;
  imagem?: string | null;
  produto_nome?: string | null;
  produto_sku?: string | null;
  quantidade_solicitada?: number | string | null;
  demanda_total?: number | string | null;
  data_solicitacao?: string | null;
  solicitado_por?: string | null;
  arquivada_em?: string | null;
  status_final?: StatusFinal | string | null;
}

interface ItensPendentes {
  concluidas: HistoricoItem[];
  divergencias: HistoricoItem[];
}

interface BotaoBuscaModalConcluidasProps {
  isOpen: boolean;
  onClose: () => void;
}

interface HistoricoItemCardProps {
  item: HistoricoItem;
  statusFinal: StatusFinal;
}

const ITENS_POR_PAG_PENDENTES = 8;
const ITENS_POR_PAG_ARQUIVO = 8;

function mensagemDoErro(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function listaDaResposta(data: unknown, campo: string): HistoricoItem[] {
  if (!data || typeof data !== 'object') return [];
  const valor = (data as Record<string, unknown>)[campo];
  return Array.isArray(valor) ? valor as HistoricoItem[] : [];
}

function HistoricoItemCard({ item, statusFinal }: HistoricoItemCardProps) {
  const meta = STATUS_META[statusFinal] || STATUS_META.CONCLUIDO;
  const dataFormatada = item.data_solicitacao
    ? new Date(item.data_solicitacao).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    : '—';

  return (
    <div className="gs-historico-card">
      <div className="card-borda-charme" style={{ backgroundColor: meta.cor }}></div>
      <img
        src={item.imagem || '/img/placeholder-image.png'}
        alt={item.produto_nome || item.produto_sku || 'Produto'}
        className="gs-historico-card-img"
      />
      <div className="gs-historico-card-info">
        <span className="gs-historico-card-nome">{item.produto_nome || item.produto_sku}</span>
        {item.variante && item.variante !== '-' && (
          <span className="gs-historico-card-variante">{item.variante}</span>
        )}
        <span className="gs-historico-card-meta">
          {item.quantidade_solicitada} pçs · Pedido em {dataFormatada} · {item.solicitado_por || '—'}
        </span>
      </div>
      <span className="gs-historico-card-badge" style={{ color: meta.cor, borderColor: meta.cor }}>
        <i className={`fas ${meta.icone}`}></i>
        {meta.label}
      </span>
    </div>
  );
}

function formatarData(timestamp: string | null | undefined): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default function BotaoBuscaModalConcluidas({
  isOpen,
  onClose,
}: BotaoBuscaModalConcluidasProps) {
  const [abaAtiva, setAbaAtiva] = useState<AbaAtiva>('pendente');
  const [subAba, setSubAba] = useState<SubAba>('concluidas');
  const [itensPendentes, setItensPendentes] = useState<ItensPendentes>({ concluidas: [], divergencias: [] });
  const [carregandoPendentes, setCarregandoPendentes] = useState(false);
  const [itensArquivados, setItensArquivados] = useState<HistoricoItem[]>([]);
  const [carregandoArquivo, setCarregandoArquivo] = useState(false);
  const [arquivando, setArquivando] = useState(false);
  const [paginaPendentes, setPaginaPendentes] = useState(1);
  const [paginaArquivo, setPaginaArquivo] = useState(1);

  const fetchPendentes = useCallback(async () => {
    setCarregandoPendentes(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/demandas/diagnostico-completo', {
        headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) throw new Error('Falha ao carregar diagnóstico.');
      const todos = listaDaResposta(await res.json(), 'diagnosticoAgregado');
      const concluidas: HistoricoItem[] = [];
      const divergencias: HistoricoItem[] = [];
      todos.forEach((item) => {
        const status = calcularStatusDemanda(item) as string;
        if (status === 'CONCLUIDO') concluidas.push(item);
        else if (status === 'DIVERGENCIA') divergencias.push(item);
      });
      setItensPendentes({ concluidas, divergencias });
    } catch (error) {
      mostrarMensagem(mensagemDoErro(error), 'erro');
    } finally {
      setCarregandoPendentes(false);
    }
  }, []);

  const fetchArquivo = useCallback(async () => {
    setCarregandoArquivo(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/demandas/historico-arquivado', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Falha ao carregar arquivo.');
      setItensArquivados(listaDaResposta(await res.json(), 'itens'));
    } catch (error) {
      mostrarMensagem(mensagemDoErro(error), 'erro');
    } finally {
      setCarregandoArquivo(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void fetchPendentes();
    setAbaAtiva('pendente');
    setSubAba('concluidas');
    setPaginaPendentes(1);
  }, [isOpen, fetchPendentes]);

  useEffect(() => {
    setPaginaPendentes(1);
  }, [subAba]);

  useEffect(() => {
    if (isOpen && abaAtiva === 'arquivo' && itensArquivados.length === 0) {
      void fetchArquivo();
    }
  }, [abaAtiva, isOpen, fetchArquivo, itensArquivados.length]);

  const handleArquivarTudo = async () => {
    const todosParaArquivar = [
      ...itensPendentes.concluidas.map((item) => ({ id: item.demanda_id, status_final: 'CONCLUIDO' as const })),
      ...itensPendentes.divergencias.map((item) => ({ id: item.demanda_id, status_final: 'DIVERGENCIA' as const })),
    ];
    if (todosParaArquivar.length === 0) return;

    setArquivando(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/demandas/arquivar-lote', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ itens: todosParaArquivar }),
      });
      if (!res.ok) throw new Error('Falha ao arquivar.');
      const data = await res.json() as { message?: string };
      mostrarMensagem(data.message || 'Demandas arquivadas.', 'sucesso');
      setItensPendentes({ concluidas: [], divergencias: [] });
      setItensArquivados([]);
    } catch (error) {
      mostrarMensagem(mensagemDoErro(error), 'erro');
    } finally {
      setArquivando(false);
    }
  };

  const totalPendentes = itensPendentes.concluidas.length + itensPendentes.divergencias.length;
  const listaSubAbaCompleta = subAba === 'concluidas' ? itensPendentes.concluidas : itensPendentes.divergencias;
  const totalPagsPendentes = Math.ceil(listaSubAbaCompleta.length / ITENS_POR_PAG_PENDENTES);
  const listaSubAba = listaSubAbaCompleta.slice(
    (paginaPendentes - 1) * ITENS_POR_PAG_PENDENTES,
    paginaPendentes * ITENS_POR_PAG_PENDENTES,
  );

  const { gruposArquivoPag, totalPagsArquivo } = useMemo(() => {
    const ordenados = [...itensArquivados].sort((a, b) =>
      new Date(b.arquivada_em || 0).getTime() - new Date(a.arquivada_em || 0).getTime(),
    );
    const total = Math.ceil(ordenados.length / ITENS_POR_PAG_ARQUIVO);
    const paginados = ordenados.slice(
      (paginaArquivo - 1) * ITENS_POR_PAG_ARQUIVO,
      paginaArquivo * ITENS_POR_PAG_ARQUIVO,
    );
    const grupos = new Map<string, HistoricoItem[]>();
    paginados.forEach((item) => {
      const chave = formatarData(item.arquivada_em);
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave)?.push(item);
    });
    grupos.forEach((itens) => {
      itens.sort((a, b) =>
        new Date(b.data_solicitacao || 0).getTime() - new Date(a.data_solicitacao || 0).getTime(),
      );
    });
    return { gruposArquivoPag: Array.from(grupos.entries()), totalPagsArquivo: total };
  }, [itensArquivados, paginaArquivo]);

  if (!isOpen) return null;

  return (
    <div className="gs-busca-modal-overlay" onClick={onClose} style={{ zIndex: 10000 }}>
      <div className="gs-busca-modal-conteudo gs-historico-modal" onClick={(event) => event.stopPropagation()}>
        <div className="gs-busca-modal-header">
          <h3><i className="fas fa-history"></i> Histórico de Produção</h3>
          <button onClick={onClose} className="gs-busca-modal-fechar">&times;</button>
        </div>

        <div className="gs-historico-abas">
          <button className={`gs-historico-aba${abaAtiva === 'pendente' ? ' ativa' : ''}`} onClick={() => setAbaAtiva('pendente')}>
            <i className="fas fa-inbox"></i> A arquivar
            {totalPendentes > 0 && <span className="gs-historico-aba-badge">{totalPendentes}</span>}
          </button>
          <button className={`gs-historico-aba${abaAtiva === 'arquivo' ? ' ativa' : ''}`} onClick={() => setAbaAtiva('arquivo')}>
            <i className="fas fa-archive"></i> Arquivo
          </button>
        </div>

        <div className="gs-busca-modal-body">
          {abaAtiva === 'pendente' && (
            <>
              {carregandoPendentes ? (
                <div className="spinner">Calculando...</div>
              ) : totalPendentes === 0 ? (
                <UIFeedbackNotFound icon="fa-check-double" titulo="Tudo arquivado" mensagem="Nenhuma demanda concluída ou com divergência pendente de arquivamento." />
              ) : (
                <>
                  <div className="gs-historico-subabas">
                    <button className={`gs-historico-subaba${subAba === 'concluidas' ? ' ativa' : ''}`} onClick={() => setSubAba('concluidas')}>
                      <i className="fas fa-check-circle" style={{ color: '#27ae60' }}></i>
                      Concluídas ({itensPendentes.concluidas.length})
                    </button>
                    <button className={`gs-historico-subaba${subAba === 'divergencias' ? ' ativa' : ''}`} onClick={() => setSubAba('divergencias')}>
                      <i className="fas fa-exclamation-triangle" style={{ color: '#e74c3c' }}></i>
                      Divergências ({itensPendentes.divergencias.length})
                    </button>
                  </div>

                  <div className="gs-historico-lista">
                    {listaSubAbaCompleta.length === 0 ? (
                      <p className="gs-historico-vazio">Nenhuma nesta categoria.</p>
                    ) : listaSubAba.length === 0 ? (
                      <p className="gs-historico-vazio">Página vazia.</p>
                    ) : listaSubAba.map((item) => (
                      <HistoricoItemCard
                        key={`${item.demanda_id}-${item.produto_id}-${item.variante || ''}`}
                        item={{
                          imagem: item.imagem,
                          produto_nome: item.produto_nome,
                          produto_sku: item.produto_sku,
                          variante: item.variante,
                          quantidade_solicitada: item.demanda_total,
                          data_solicitacao: item.data_solicitacao,
                          solicitado_por: item.solicitado_por,
                        }}
                        statusFinal={subAba === 'concluidas' ? 'CONCLUIDO' : 'DIVERGENCIA'}
                      />
                    ))}
                  </div>

                  {totalPagsPendentes > 1 && (
                    <OPPaginacaoWrapper totalPages={totalPagsPendentes} currentPage={paginaPendentes} onPageChange={setPaginaPendentes} />
                  )}

                  <div className="gs-historico-footer">
                    <button className="gs-btn gs-btn-primario gs-btn-full" onClick={() => void handleArquivarTudo()} disabled={arquivando}>
                      {arquivando ? <><div className="spinner-btn-interno"></div> Arquivando...</> : <><i className="fas fa-archive"></i> Arquivar tudo ({totalPendentes} {totalPendentes === 1 ? 'item' : 'itens'})</>}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {abaAtiva === 'arquivo' && (
            <>
              {carregandoArquivo ? (
                <div className="spinner">Carregando arquivo...</div>
              ) : itensArquivados.length === 0 ? (
                <UIFeedbackNotFound icon="fa-archive" titulo="Arquivo vazio" mensagem="Nenhuma demanda foi arquivada ainda." />
              ) : (
                <>
                  <div className="gs-historico-lista">
                    {gruposArquivoPag.map(([data, itens]) => (
                      <div key={data} className="gs-historico-grupo">
                        <div className="gs-historico-grupo-titulo">
                          <i className="fas fa-calendar-day"></i> Arquivado em {data}
                          <span className="gs-historico-grupo-count">{itens.length} {itens.length === 1 ? 'item' : 'itens'}</span>
                        </div>
                        {itens.map((item) => (
                          <HistoricoItemCard
                            key={item.id}
                            item={item}
                            statusFinal={item.status_final === 'DIVERGENCIA' ? 'DIVERGENCIA' : 'CONCLUIDO'}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                  {totalPagsArquivo > 1 && (
                    <OPPaginacaoWrapper totalPages={totalPagsArquivo} currentPage={paginaArquivo} onPageChange={setPaginaArquivo} />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
