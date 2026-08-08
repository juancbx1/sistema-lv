// public/src/components/OPGerenciamentoTela.tsx

import { type ComponentType, useCallback, useEffect, useRef, useState } from 'react';
import { OPCard } from './OPCard.tsx';
import OPEtapasModal from './OPEtapasModal.jsx';
import OPModalLote from './OPModalLote.jsx';
import OPFiltros from './OPFiltros.tsx';
import OPPaginacaoWrapper from './OPPaginacaoWrapper.tsx';
import OPCentralEncerramento from './OPCentralEncerramento.jsx';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';

// @ts-expect-error utilitário JS legado sem declaração TypeScript
import { obterProdutos as obterProdutosDoStorage } from '/js/utils/storage.js';
// @ts-expect-error popups JS legados sem declaração TypeScript
import { mostrarConfirmacao, mostrarToast } from '/js/utils/popups.js';

import type {
  OpApiListResponse,
  OpCardProps,
  OpCentralEncerramentoProps,
  OpEtapasModalProps,
  OpModalLoteProps,
  OpFiltroEstado,
  OpProduto,
  OpResumo,
  OpGerenciamentoProps,
  OpUsuarioLogado,
} from '../utils/op-types';

const OPCardTipado = OPCard as unknown as ComponentType<OpCardProps>;
const OPEtapasModalTipado = OPEtapasModal as unknown as ComponentType<OpEtapasModalProps>;
const OPModalLoteTipado = OPModalLote as unknown as ComponentType<OpModalLoteProps>;
const OPCentralEncerramentoTipado = OPCentralEncerramento as unknown as ComponentType<OpCentralEncerramentoProps>;

export default function OPGerenciamentoTela({
  opsPendentesGlobal,
  onRefreshContadores,
  permissoes = [],
}: OpGerenciamentoProps) {
  const [ops, setOps] = useState<OpResumo[]>([]);
  const [totalOps, setTotalOps] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [usuarioLogado, setUsuarioLogado] = useState<OpUsuarioLogado | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [opSelecionada, setOpSelecionada] = useState<OpResumo | null>(null);
  const [modalLoteAberto, setModalLoteAberto] = useState(false);
  const [opsParaLote, setOpsParaLote] = useState<OpResumo[]>([]);
  const [loteResetKey, setLoteResetKey] = useState(0);
  const [filtros, setFiltros] = useState<OpFiltroEstado>({ status: 'todas', busca: '' });
  const [pagina, setPagina] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);

  const isFirstLoadRef = useRef(true);
  const paginacaoRef = useRef<HTMLDivElement>(null);
  const isPaginatingRef = useRef(false);
  const lastSearchParamsRef = useRef<string | null>(null);
  const ITENS_POR_PAGINA_OPS = 6;

  const buscarDados = useCallback(async (paginaAtual: number, filtrosAtuais: OpFiltroEstado) => {
    const searchSignature = JSON.stringify({ page: paginaAtual, ...filtrosAtuais });
    if (lastSearchParamsRef.current === searchSignature) return;
    lastSearchParamsRef.current = searchSignature;
    setCarregando(true);
    setErro(null);

    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Usuário não autenticado.');

      const params = new URLSearchParams({
        page: String(paginaAtual),
        limit: String(ITENS_POR_PAGINA_OPS),
      });
      if (filtrosAtuais.status && filtrosAtuais.status !== 'todas') {
        params.append('status', filtrosAtuais.status);
      }
      if (filtrosAtuais.busca) params.append('search', filtrosAtuais.busca);

      const [dataOpsRaw, produtosRaw] = await Promise.all([
        fetch(`/api/ordens-de-producao?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((response) => response.json()),
        obterProdutosDoStorage(),
      ]);
      const dataOps = dataOpsRaw as OpApiListResponse;
      const todosProdutos = produtosRaw as OpProduto[];
      if (dataOps.error) throw new Error(dataOps.error);

      const opsFinais = dataOps.rows.map((op) => {
        const produtoCompleto = todosProdutos.find((produto) => produto.id === op.produto_id);
        let imagem = produtoCompleto?.imagem || null;
        if (produtoCompleto && op.variante && produtoCompleto.grade) {
          const grade = produtoCompleto.grade.find((item) => item.variacao === op.variante);
          if (grade?.imagem) imagem = grade.imagem;
        }
        return { ...op, imagem_produto: imagem };
      });

      setOps(opsFinais);
      setTotalPaginas(dataOps.pages || 1);
      setTotalOps(dataOps.total || 0);
    } catch (error) {
      console.error('Erro em OPGerenciamentoTela:', error);
      setErro(error instanceof Error ? error.message : 'Erro ao carregar as OPs.');
    } finally {
      setCarregando(false);
      isFirstLoadRef.current = false;
    }
  }, []);

  useEffect(() => {
    void buscarDados(pagina, filtros);
  }, [pagina, filtros, buscarDados]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return undefined;
    fetch('/api/usuarios/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.json())
      .then((data: OpUsuarioLogado & { error?: string }) => {
        if (!data.error) setUsuarioLogado(data);
      })
      .catch(() => undefined);
    return undefined;
  }, []);

  useEffect(() => {
    if (!carregando && isPaginatingRef.current) {
      isPaginatingRef.current = false;
      requestAnimationFrame(() => {
        paginacaoRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      });
    }
  }, [carregando]);

  const handleFiltroChange = useCallback((novosFiltros: OpFiltroEstado) => {
    setFiltros((prev) => ({
      status: novosFiltros.status !== undefined ? novosFiltros.status : prev.status,
      busca: novosFiltros.busca !== undefined ? novosFiltros.busca : prev.busca,
    }));
    setPagina(1);
  }, []);

  const handleAbrirModal = (op: OpResumo) => {
    setOpSelecionada(op);
    setModalAberto(true);
  };

  const handleFecharModal = () => {
    setModalAberto(false);
    setOpSelecionada(null);
  };

  const handleUpdateOP = () => {
    lastSearchParamsRef.current = null;
    void buscarDados(pagina, filtros);
    void onRefreshContadores();
  };

  const handleCancelarOP = useCallback(async (op: OpResumo) => {
    const confirmado = await mostrarConfirmacao(
      `Cancelar a OP <strong>#${op.numero} — ${op.produto}</strong>?<br><br>Esta ação não pode ser desfeita.`,
      { tipo: 'perigo', textoConfirmar: 'Cancelar OP', textoCancelar: 'Voltar' },
    );
    if (!confirmado) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/ordens-de-producao', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...op, status: 'cancelada' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao cancelar OP.');
      mostrarToast('OP cancelada com sucesso.', 'sucesso');
      lastSearchParamsRef.current = null;
      void buscarDados(pagina, filtros);
      void onRefreshContadores();
    } catch (error) {
      mostrarToast(error instanceof Error ? error.message : 'Erro ao cancelar OP.', 'erro');
    }
  }, [pagina, filtros, buscarDados, onRefreshContadores]);

  const handleAbrirLote = useCallback((lista: OpResumo[]) => {
    setOpsParaLote(lista);
    setModalLoteAberto(true);
  }, []);

  const handleConcluirLote = ({ sucesso }: { sucesso: number }) => {
    setModalLoteAberto(false);
    setOpsParaLote([]);
    if (sucesso > 0) {
      setLoteResetKey((prev) => prev + 1);
      lastSearchParamsRef.current = null;
      void buscarDados(pagina, filtros);
      void onRefreshContadores();
    }
  };

  const handlePageChange = useCallback((novaPagina: number) => {
    isPaginatingRef.current = true;
    setPagina(novaPagina);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    lastSearchParamsRef.current = null;
    await buscarDados(pagina, filtros);
    await onRefreshContadores();
    setRefreshing(false);
  }, [pagina, filtros, buscarDados, onRefreshContadores]);

  const mostrarInitTerminal = carregando && isFirstLoadRef.current;
  const primeiroNome = (usuarioLogado?.nome || '').split(' ')[0] || null;

  return (
    <div className="op-aba-gerenciamento">
      <OPFiltros onFiltroChange={handleFiltroChange} />

      {!isFirstLoadRef.current && (
        <OPCentralEncerramentoTipado
          opsPendentesGlobal={opsPendentesGlobal}
          onAbrirLote={handleAbrirLote}
          resetKey={loteResetKey}
          nomeUsuario={primeiroNome}
        />
      )}

      {mostrarInitTerminal && <UICarregando variante="bloco" />}
      {erro && <p style={{ color: 'red', textAlign: 'center' }}>Erro: {erro}</p>}

      {!isFirstLoadRef.current && !erro && (
        <div style={{ opacity: carregando ? 0.45 : 1, pointerEvents: carregando ? 'none' : 'auto', transition: 'opacity 0.15s' }}>
          <div className="op-cortes-estoque-titulo-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 className="op-cortes-estoque-titulo">
                <i className="fas fa-list-alt" />
                Ordens de Produção
              </h3>
              <button
                type="button"
                className="op-cortes-refresh-btn"
                onClick={() => void handleRefresh()}
                disabled={refreshing || carregando}
                title="Atualizar lista"
              >
                <i className={`fas fa-sync-alt${refreshing || carregando ? ' fa-spin' : ''}`} />
              </button>
            </div>
            {totalOps > 0 && (
              <span className="op-cortes-estoque-badge">
                {totalOps} {(() => {
                  if (filtros.status === 'finalizado') return totalOps === 1 ? 'finalizada' : 'finalizadas';
                  if (filtros.status === 'cancelada') return totalOps === 1 ? 'cancelada' : 'canceladas';
                  if (filtros.status === 'produzindo') return 'produzindo';
                  return totalOps === 1 ? 'OP em aberto' : 'OPs em aberto';
                })()}
              </span>
            )}
          </div>

          <div className="op-cards-container">
            {ops.length > 0 ? ops.map((op) => (
              <OPCardTipado
                key={op.edit_id || op.id}
                op={op}
                onClick={handleAbrirModal}
                onCancelar={handleCancelarOP}
              />
            )) : (
              <UIFeedbackNotFound
                variante="compacto"
                icon="fa-clipboard-list"
                titulo="Nenhuma ordem de produção encontrada"
                mensagem="Não há ordens correspondentes aos filtros aplicados."
              />
            )}
          </div>

          {totalPaginas > 1 && (
            <div ref={paginacaoRef}>
              <OPPaginacaoWrapper
                totalPages={totalPaginas}
                currentPage={pagina}
                onPageChange={handlePageChange}
              />
            </div>
          )}
        </div>
      )}

      <OPEtapasModalTipado
        op={opSelecionada}
        isOpen={modalAberto}
        onClose={handleFecharModal}
        onUpdateOP={handleUpdateOP}
        onUpdateGlobal={onRefreshContadores}
      />

      <OPModalLoteTipado
        isOpen={modalLoteAberto}
        ops={opsParaLote}
        onClose={() => setModalLoteAberto(false)}
        onConcluido={handleConcluirLote}
      />
    </div>
  );
}
