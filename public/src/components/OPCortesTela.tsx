// public/src/components/OPCortesTela.tsx

import { type ComponentType, useCallback, useEffect, useRef, useState } from 'react';
import OPSelecaoProdutoCorte from './OPSelecaoProdutoCorte.tsx';
import OPSelecaoVarianteCorte from './OPSelecaoVarianteCorte.tsx';
import OPRegistroCorte from './OPRegistroCorte.tsx';
import OPCorteEstoqueCard from './OPCorteEstoqueCard.tsx';
import OPFormulario from './OPFormulario.tsx';
import OPCriarModal from './OPCriarModal.tsx';
import OPPaginacaoWrapper from './OPPaginacaoWrapper.tsx';
import OPCortesRadar from './OPCortesRadar.tsx';
import OPCortesAgente from './OPCortesAgente.tsx';
import OPQuickLogModal from './OPQuickLogModal.tsx';
import UIFeedbackNotFound from './UIFeedbackNotFound';
// @ts-expect-error utilitÃ¡rio JS legado sem declaraÃ§Ã£o TypeScript
import { obterProdutos as obterProdutosDoStorage } from '/js/utils/storage.js';
// @ts-expect-error popups JS legados sem declaraÃ§Ã£o TypeScript
import { mostrarMensagem, mostrarConfirmacao } from '/js/utils/popups.js';
// Componente local sem dependência de declaração externa
import UICarregando from './UICarregando';

interface OpProdutoGradeCorte {
  variacao?: string | null;
  sku?: string | null;
  imagem?: string | null;
}

interface OpProdutoCorte {
  id: number;
  nome: string;
  sku?: string | null;
  imagem?: string | null;
  is_kit?: boolean;
  grade?: OpProdutoGradeCorte[] | null;
}

interface OpCorte {
  id: number;
  produto_id: number;
  variante?: string | null;
  op?: unknown | null;
  pn?: number | string | null;
  quantidade?: number | string | null;
  data?: string | null;
  cortador?: string | null;
  produto?: string | null;
  imagem_produto?: string | null;
  [key: string]: unknown;
}

interface OpDemandaCorte {
  id: number;
  status?: string | null;
  produto_sku?: string | null;
  quantidade_solicitada?: number | string | null;
  prioridade?: number | string | null;
  data_solicitacao?: string | null;
  produto_nome?: string | null;
  variacao?: string | null;
}

interface OpUsuarioCorte {
  nome?: string | null;
  [key: string]: unknown;
}

interface OpQuickLogPreenchido {
  produto: OpProdutoCorte;
  variante?: string | null;
  quantidadeSugerida?: number | string | null;
}

interface OpSelecaoProdutoCorteProps {
  produtos: OpProdutoCorte[];
  onProdutoSelect: (produto: OpProdutoCorte) => void;
}

interface OpSelecaoVarianteCorteProps {
  produto: OpProdutoCorte | null;
  onVarianteSelect: (variante: string) => void;
}

interface OpRegistroCorteProps {
  produto: OpProdutoCorte | null;
  variante: string | null;
  usuario: OpUsuarioCorte | null;
  onCorteRegistrado: (corte?: OpCorte) => void;
  quantidadeInicial: string;
}

interface OpCorteEstoqueCardProps {
  corte: OpCorte;
  produto?: OpProdutoCorte;
  onGerarOP: (corte: OpCorte) => void;
  onExcluir?: (corte: OpCorte) => void | Promise<void>;
  isGerando: boolean;
  demandasVinculadas: OpDemandaCorte[];
}

interface OpFormularioProps {
  corteSelecionado: OpCorte | null;
  onOPCriada: () => void;
  onSetGerando: (gerando: boolean | null) => void;
}

interface OpCriarModalCorteProps {
  isOpen: boolean;
  onClose: () => void;
  onOPCriada: () => void;
  corteExistente: OpCorte;
}

interface OpCortesRadarProps {
  refreshKey: number;
  onRegistrarCorte: (() => void) | null;
}

interface OpCortesAgenteProps {
  produtos: OpProdutoCorte[];
  onCortarAgora: (dados: {
    produto: OpProdutoCorte;
    variante?: string | null;
    quantidadeSugerida?: number | string | null;
  }) => void;
  rescanKey: number;
  cortesEmEstoque: OpCorte[];
  nomeUsuario: string | null;
}

interface OpQuickLogModalProps {
  produtos: OpProdutoCorte[];
  usuario: OpUsuarioCorte | null;
  onClose: () => void;
  onSuccess: () => void;
  preenchido: OpQuickLogPreenchido | null;
}

const OPSelecaoProdutoCorteTipado = OPSelecaoProdutoCorte as unknown as ComponentType<OpSelecaoProdutoCorteProps>;
const OPSelecaoVarianteCorteTipado = OPSelecaoVarianteCorte as unknown as ComponentType<OpSelecaoVarianteCorteProps>;
const OPRegistroCorteTipado = OPRegistroCorte as unknown as ComponentType<OpRegistroCorteProps>;
const OPCorteEstoqueCardTipado = OPCorteEstoqueCard as unknown as ComponentType<OpCorteEstoqueCardProps>;
const OPFormularioTipado = OPFormulario as unknown as ComponentType<OpFormularioProps>;
const OPCriarModalCorteTipado = OPCriarModal as unknown as ComponentType<OpCriarModalCorteProps>;
const OPCortesRadarTipado = OPCortesRadar as unknown as ComponentType<OpCortesRadarProps>;
const OPCortesAgenteTipado = OPCortesAgente as unknown as ComponentType<OpCortesAgenteProps>;
const OPQuickLogModalTipado = OPQuickLogModal as unknown as ComponentType<OpQuickLogModalProps>;

async function fetchCortesEmEstoque(): Promise<OpCorte[]> {
  const token = localStorage.getItem('token');
  const response = await fetch('/api/cortes?status=cortados', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || 'Falha ao buscar cortes em estoque.');
    (error as Error & { codigo?: string }).codigo = body.codigo;
    throw error;
  }
  const cortes = (await response.json()) as unknown;
  return Array.isArray(cortes)
    ? (cortes as OpCorte[]).filter((corte) => corte.op === null)
    : [];
}

function criarDemandasMap(demandasData: unknown, produtos: OpProdutoCorte[]) {
  const novoMap = new Map<string, OpDemandaCorte[]>();
  const demandasPendentes = Array.isArray(demandasData)
    ? (demandasData as OpDemandaCorte[]).filter((demanda) =>
        ['pendente', 'em_atendimento'].includes(demanda.status || ''),
      )
    : [];

  for (const demanda of demandasPendentes) {
    if (!demanda.produto_sku) continue;
    const skuBusca = demanda.produto_sku.trim().toUpperCase();

    for (const produto of produtos) {
      let match = false;
      let varianteResolvida: string | null = null;
      const gradeArr = Array.isArray(produto.grade) ? produto.grade : [];

      if (produto.sku && produto.sku.trim().toUpperCase() === skuBusca) {
        match = true;
      } else {
        const grade = gradeArr.find(
          (item) => item.sku && item.sku.trim().toUpperCase() === skuBusca,
        );
        if (grade) {
          match = true;
          varianteResolvida = grade.variacao || null;
        }
      }

      if (!match) continue;

      const chave = `${produto.id}|${varianteResolvida || '-'}`;
      if (!novoMap.has(chave)) novoMap.set(chave, []);
      novoMap.get(chave)?.push({
        id: demanda.id,
        quantidade_solicitada: demanda.quantidade_solicitada,
        prioridade: demanda.prioridade,
        data_solicitacao: demanda.data_solicitacao,
        produto_nome: produto.nome,
        variacao: varianteResolvida,
      });
      break;
    }
  }

  return novoMap;
}

function mensagemDoErro(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function OPCortesTela() {
  const [passo, setPasso] = useState(0);
  const [corteSelecionado, setCorteSelecionado] = useState<OpCorte | null>(null);
  const [produtos, setProdutos] = useState<OpProdutoCorte[]>([]);
  const [cortesEmEstoque, setCortesEmEstoque] = useState<OpCorte[]>([]);
  const [produtoSelecionado, setProdutoSelecionado] = useState<OpProdutoCorte | null>(null);
  const [varianteSelecionada, setVarianteSelecionada] = useState<string | null>(null);
  const [quantidadePreenchida, setQuantidadePreenchida] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [usuarioLogado, setUsuarioLogado] = useState<OpUsuarioCorte | null>(null);
  const [gerandoOP, setGerandoOP] = useState<boolean | null>(null);
  const [paginaCortes, setPaginaCortes] = useState(1);
  const paginacaoRef = useRef<HTMLDivElement>(null);
  const [demandasMap, setDemandasMap] = useState<Map<string, OpDemandaCorte[]>>(new Map());
  const [opCriarModalAberto, setOpCriarModalAberto] = useState(false);
  const [corteParaOP, setCorteParaOP] = useState<OpCorte | null>(null);
  const [quickLogAberto, setQuickLogAberto] = useState(false);
  const [quickLogPreenchido, setQuickLogPreenchido] = useState<OpQuickLogPreenchido | null>(null);
  const [radarRefreshKey, setRadarRefreshKey] = useState(0);
  const [agenteRescanKey, setAgenteRescanKey] = useState(0);
  const [refreshingEstoque, setRefreshingEstoque] = useState(false);
  const [cadeiaBloqueada, setCadeiaBloqueada] = useState(false);

  const ITENS_POR_PAGINA_CORTES = 6;

  const carregarDados = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    setCadeiaBloqueada(false);
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Não autenticado');

      const [produtosRaw, dadosUsuarioRaw, cortesData, demandasData] = await Promise.all([
        obterProdutosDoStorage(),
        fetch('/api/usuarios/me', { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.json()),
        fetchCortesEmEstoque(),
        fetch('/api/demandas', { headers: { Authorization: `Bearer ${token}` } })
          .then((res) => (res.ok ? res.json() : []))
          .catch(() => []),
      ]);

      const dadosUsuario = dadosUsuarioRaw as OpUsuarioCorte & { error?: string };
      if (dadosUsuario.error) throw new Error(dadosUsuario.error);

      const produtosSimples = (produtosRaw as OpProdutoCorte[]).filter((produto) => !produto.is_kit);
      setProdutos(produtosSimples);
      setUsuarioLogado(dadosUsuario);
      setCortesEmEstoque(cortesData);
      setPaginaCortes(1);
      setDemandasMap(criarDemandasMap(demandasData, produtosSimples));
    } catch (error) {
      if ((error as { codigo?: string })?.codigo === 'MODULO_NAO_DISPONIVEL_EMPRESA'
        || (error as { codigo?: string })?.codigo === 'CADEIA_PRODUTIVA_NAO_MIGRADA') {
        setCadeiaBloqueada(true);
      }
      setErro(`Falha ao carregar dados: ${mensagemDoErro(error, 'erro desconhecido')}`);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregarDados();
  }, [carregarDados]);

  const refreshSilencioso = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const [cortesData, demandasData] = await Promise.all([
        fetchCortesEmEstoque(),
        fetch('/api/demandas', { headers: { Authorization: `Bearer ${token}` } })
          .then((res) => (res.ok ? res.json() : []))
          .catch(() => []),
      ]);
      setCortesEmEstoque(cortesData);
      setDemandasMap(criarDemandasMap(demandasData, produtos));
    } catch {
      // Atualização em segundo plano: não exibir erro transitório ao operador.
    }
  }, [produtos]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void carregarDados();
    };
    const handleEmpresaAlterada = () => void carregarDados();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('lv:empresa-contexto-alterado', handleEmpresaAlterada);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('lv:empresa-contexto-alterado', handleEmpresaAlterada);
    };
  }, [carregarDados]);

  useEffect(() => {
    const handler = () => void refreshSilencioso();
    window.addEventListener('painel-demandas-fechado', handler);
    return () => window.removeEventListener('painel-demandas-fechado', handler);
  }, [refreshSilencioso]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshSilencioso();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [refreshSilencioso]);

  const handleRefreshEstoque = useCallback(async () => {
    setRefreshingEstoque(true);
    try {
      await carregarDados();
      setRadarRefreshKey((key) => key + 1);
    } catch {
      mostrarMensagem('Erro ao atualizar estoque.', 'erro');
    } finally {
      setRefreshingEstoque(false);
    }
  }, [carregarDados]);

  const handleExcluirCorte = async (corte: OpCorte) => {
    const confirmado = await mostrarConfirmacao(
      `Excluir o corte PC #${corte.pn} (${corte.quantidade} pçs)?\nEsta ação remove o corte do estoque.`,
      { tipo: 'perigo', textoConfirmar: 'Sim, Excluir', textoCancelar: 'Cancelar' },
    );
    if (!confirmado) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/cortes', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: corte.id }),
      });
      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error || 'Falha ao excluir corte.');
      }
      mostrarMensagem('Corte excluído com sucesso.', 'sucesso');
      setRadarRefreshKey((key) => key + 1);
      void carregarDados();
    } catch (error) {
      mostrarMensagem(mensagemDoErro(error, 'Falha ao excluir corte.'), 'erro');
    }
  };

  const handleQuickLogSuccess = () => {
    const veioDoAgente = !!quickLogPreenchido;
    setQuickLogAberto(false);
    setQuickLogPreenchido(null);
    setRadarRefreshKey((key) => key + 1);
    void carregarDados();
    if (veioDoAgente) setAgenteRescanKey((key) => key + 1);
  };

  const handleCortarAgora = (dados: {
    produto: OpProdutoCorte;
    variante?: string | null;
    quantidadeSugerida?: number | string | null;
  }) => {
    setQuickLogPreenchido(dados);
    setQuickLogAberto(true);
  };

  const handleProdutoSelect = (produto: OpProdutoCorte) => {
    setProdutoSelecionado(produto);
    setPasso(2);
  };

  const handleVarianteSelect = (variante: string) => {
    setVarianteSelecionada(variante);
    setPasso(3);
  };

  const handleCorteRegistrado = () => {
    setProdutoSelecionado(null);
    setVarianteSelecionada(null);
    setQuantidadePreenchida('');
    setPasso(0);
    setGerandoOP(null);
    setRadarRefreshKey((key) => key + 1);
    void carregarDados();
  };

  const handleGerarOP = (corte: OpCorte) => {
    if (gerandoOP) return;
    setCorteParaOP(corte);
    setOpCriarModalAberto(true);
  };

  const handleOPCriada = () => {
    setCorteSelecionado(null);
    setPasso(0);
    setGerandoOP(null);
    void carregarDados();
  };

  const handleOPCriadaModal = () => {
    setOpCriarModalAberto(false);
    setCorteParaOP(null);
    setGerandoOP(null);
    void carregarDados();
  };

  const voltarPasso = () => {
    if (passo === 4) {
      setGerandoOP(null);
      setCorteSelecionado(null);
      setPasso(0);
      return;
    }
    if (passo === 1) setProdutoSelecionado(null);
    if (passo === 2) setVarianteSelecionada(null);
    if (passo === 3) setQuantidadePreenchida('');
    if (passo > 1) setPasso((valor) => valor - 1);
    else {
      setPasso(0);
      setProdutoSelecionado(null);
      setVarianteSelecionada(null);
    }
  };

  const renderVistaPrincipal = () => {
    const totalPaginasCortes = Math.ceil(cortesEmEstoque.length / ITENS_POR_PAGINA_CORTES);
    const cortesPaginados = cortesEmEstoque.slice(
      (paginaCortes - 1) * ITENS_POR_PAGINA_CORTES,
      paginaCortes * ITENS_POR_PAGINA_CORTES,
    );

    return (
      <>
        <OPCortesRadarTipado
          refreshKey={radarRefreshKey}
          onRegistrarCorte={
            quickLogAberto
              ? null
              : () => {
                  setQuickLogPreenchido(null);
                  setQuickLogAberto(true);
                }
          }
        />

        {!quickLogAberto && (
          <OPCortesAgenteTipado
            produtos={produtos}
            onCortarAgora={handleCortarAgora}
            rescanKey={agenteRescanKey}
            cortesEmEstoque={cortesEmEstoque}
            nomeUsuario={(usuarioLogado?.nome || '').split(' ')[0] || null}
          />
        )}

        {quickLogAberto && (
          <div className="op-cortes-acoes-header">
            <OPQuickLogModalTipado
              produtos={produtos}
              usuario={usuarioLogado}
              onClose={() => {
                setQuickLogAberto(false);
                setQuickLogPreenchido(null);
              }}
              onSuccess={handleQuickLogSuccess}
              preenchido={quickLogPreenchido}
            />
          </div>
        )}

        {!quickLogAberto && (
          <div className="op-cortes-estoque-secao">
            <div className="op-cortes-estoque-titulo-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 className="op-cortes-estoque-titulo">
                  <i className="fas fa-boxes"></i>
                  Estoque de Cortes
                </h3>
                <button
                  className="op-cortes-refresh-btn"
                  onClick={() => void handleRefreshEstoque()}
                  disabled={refreshingEstoque}
                  title="Atualizar estoque"
                >
                  <i className={`fas fa-sync-alt${refreshingEstoque ? ' fa-spin' : ''}`}></i>
                </button>
              </div>
              {cortesEmEstoque.length > 0 && (
                <span className="op-cortes-estoque-badge">
                  {cortesEmEstoque.length} {cortesEmEstoque.length === 1 ? 'lote' : 'lotes'}
                </span>
              )}
            </div>

            <div className="op-corte-lista">
              {cortesPaginados.length > 0 ? (
                cortesPaginados.map((corte) => {
                  const produtoCompleto = produtos.find((produto) => produto.id === corte.produto_id);
                  const chaveCorte = `${corte.produto_id}|${corte.variante || '-'}`;
                  const demandasDoCorte = demandasMap.get(chaveCorte) || [];
                  return (
                    <OPCorteEstoqueCardTipado
                      key={corte.id}
                      corte={corte}
                      produto={produtoCompleto}
                      onGerarOP={handleGerarOP}
                      onExcluir={handleExcluirCorte}
                      isGerando={opCriarModalAberto && corteParaOP?.id === corte.id}
                      demandasVinculadas={demandasDoCorte}
                    />
                  );
                })
              ) : (
                <UIFeedbackNotFound
                  icon="fa-cut"
                  titulo="Nenhum corte em estoque"
                  mensagem="Use “Registrar Corte” acima para adicionar peças ao estoque."
                />
              )}
            </div>

            {totalPaginasCortes > 1 && (
              <div ref={paginacaoRef}>
                <OPPaginacaoWrapper
                  totalPages={totalPaginasCortes}
                  currentPage={paginaCortes}
                  onPageChange={(novaPagina) => {
                    setPaginaCortes(novaPagina);
                    requestAnimationFrame(() => {
                      paginacaoRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
                    });
                  }}
                />
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="op-aba-cortes">
      <div className="op-cortes-tela">
      {passo > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
          <button className="btn-voltar-header" onClick={voltarPasso}>
            <i className="fas fa-arrow-left"></i> Voltar
          </button>
          <h2
            className="op-titulo-secao"
            style={{ flexGrow: 1, textAlign: 'center', borderBottom: 'none', marginBottom: 0 }}
          >
            Área de Cortes
          </h2>
          <div className="op-header-spacer"></div>
        </div>
      )}

      {cadeiaBloqueada && (
        <div className="op-cadeia-bloqueada" role="status" aria-live="polite">
          <i className="fas fa-industry" aria-hidden="true"></i>
          <strong>A cadeia de produção ainda não está disponível neste ambiente.</strong>
          <span>Nenhum dado de outro ambiente foi carregado.</span>
        </div>
      )}
      {!cadeiaBloqueada && carregando && <UICarregando variante="bloco" />}
      {!cadeiaBloqueada && erro && <p style={{ color: 'red', textAlign: 'center' }}>{erro}</p>}

      {!cadeiaBloqueada && !carregando && !erro && passo === 0 && renderVistaPrincipal()}

      {!cadeiaBloqueada && !carregando && !erro && passo === 1 && (
        <>
          <h3 className="op-subtitulo-secao">Passo 1: Selecione o Produto</h3>
          <OPSelecaoProdutoCorteTipado produtos={produtos} onProdutoSelect={handleProdutoSelect} />
        </>
      )}

      {!cadeiaBloqueada && !carregando && !erro && passo === 2 && (
        <>
          <h3 className="op-subtitulo-secao">
            Selecione a Variação de "{produtoSelecionado?.nome}"
          </h3>
          <OPSelecaoVarianteCorteTipado
            produto={produtoSelecionado}
            onVarianteSelect={handleVarianteSelect}
          />
        </>
      )}

      {!cadeiaBloqueada && !carregando && !erro && passo === 3 && (
        <>
          <h3 className="op-subtitulo-secao">Passo 3: Informe a Quantidade</h3>
          <OPRegistroCorteTipado
            key={quantidadePreenchida ? `corte-pre-${quantidadePreenchida}` : 'corte-novo'}
            produto={produtoSelecionado}
            variante={varianteSelecionada}
            usuario={usuarioLogado}
            onCorteRegistrado={handleCorteRegistrado}
            quantidadeInicial={quantidadePreenchida}
          />
        </>
      )}

      {!cadeiaBloqueada && !carregando && !erro && passo === 4 && (
        <>
          <h3 className="op-subtitulo-secao">Gerar Ordem de Produção</h3>
          <OPFormularioTipado
            corteSelecionado={corteSelecionado}
            onOPCriada={handleOPCriada}
            onSetGerando={(valor) => setGerandoOP(valor)}
          />
        </>
      )}

      {corteParaOP && (
        <OPCriarModalCorteTipado
          isOpen={opCriarModalAberto}
          onClose={() => {
            setOpCriarModalAberto(false);
            setCorteParaOP(null);
            setGerandoOP(null);
          }}
          onOPCriada={handleOPCriadaModal}
          corteExistente={corteParaOP}
        />
      )}
      </div>
    </div>
  );
}
