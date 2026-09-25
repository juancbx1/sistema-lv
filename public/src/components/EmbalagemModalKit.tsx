import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from 'react';
import EmbalagemControleQuantidade from './EmbalagemControleQuantidade';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UICarregando from './UICarregando';
import UIBloqueio from './UIBloqueio';
import { mostrarPopupSemPermissao, temPermissao } from '../utils/bloqueio';
import {
  listarLotesPorProdutoVariante,
  registrarMontagemKit,
} from '../utils/embalagem-api';
import {
  getImagemVariacao,
  getNomeProduto,
  getSkuVariacao,
} from '../utils/embalagem-produto-helpers';
import { montarEtiquetaProduto, type EtiquetaImpressao } from '../utils/etiqueta-embalagem';
import { mensagemEmbalagem, mensagemEstoqueSemEtiqueta, type ResultadoEmbalagem } from '../utils/etiqueta-resultado';
import { imprimirEtiqueta } from '../utils/printnow-agente';
import type {
  EmbalagemArremateLote,
  EmbalagemEstoqueSaldo,
  EmbalagemFilaItem,
  EmbalagemKitComponenteConsumido,
  EmbalagemNivelEstoque,
  ProdutoCadastro,
  ProdutoComponenteKit,
  ProdutoGradeItem,
} from '../utils/embalagem-types';
// @ts-expect-error popups sistêmicos legados, mantidos por compatibilidade visual.
import { mostrarConfirmacao, mostrarMensagem } from '/js/utils/popups.js';

interface EmbalagemModalKitProps {
  item: EmbalagemFilaItem;
  produtos: ProdutoCadastro[];
  saldoEstoque: EmbalagemEstoqueSaldo[];
  niveisEstoque: EmbalagemNivelEstoque[];
  cnpjEmpresa: string;
  onEtiquetaChange?: (etiqueta: EtiquetaImpressao | null) => void;
  onImpressaoIniciada?: (quantidade: number) => void;
  onImpressaoConcluida?: (resultado: ResultadoEmbalagem, quantidade: number) => void;
  onEmbalagemConcluida?: () => Promise<void> | void;
}

interface KitCatalogo {
  produto: ProdutoCadastro;
  variacoes: ProdutoGradeItem[];
}

interface ComponenteDisponibilidade {
  componente: ProdutoComponenteKit;
  produto: ProdutoCadastro | null;
  produtoId: number | string;
  variante: string;
  nome: string;
  quantidadeNecessaria: number;
  saldo: number;
  lotes: EmbalagemArremateLote[];
}

interface EstoqueKitInteligencia {
  sku: string;
  atual: number;
  meta: number | null;
  falta: number | null;
  percentual: number | null;
}

function normalizarVariante(value: string | null | undefined): string {
  const variante = String(value ?? '-').trim().toLowerCase();
  return variante === '-' ? '' : variante;
}

function getGradeKey(grade: ProdutoGradeItem): string {
  return grade.variacao || '-';
}

function getVariacoesLabel(quantidade: number): string {
  return quantidade === 1
    ? '1 variação compatível'
    : `${quantidade} variações compatíveis`;
}

function toQuantidade(value: unknown, fallback = 0): number {
  const quantidade = Number(value);
  return Number.isFinite(quantidade) ? quantidade : fallback;
}

function getSaldoLote(lote: EmbalagemArremateLote): number {
  return Math.max(
    0,
    toQuantidade(lote.quantidade_arrematada) -
      toQuantidade(lote.quantidade_ja_embalada),
  );
}

function getStatusComponente(
  saldo: number,
  quantidadeNecessaria: number,
): { label: string; classe: string } {
  if (saldo < quantidadeNecessaria) {
    return { label: 'Em falta', classe: 'ep-modal-kit-status-falta' };
  }

  if (saldo < quantidadeNecessaria * 2) {
    return { label: 'Atenção', classe: 'ep-modal-kit-status-atencao' };
  }

  return { label: 'Disponível', classe: 'ep-modal-kit-status-ok' };
}

function normalizarReferenciaEstoque(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

export default function EmbalagemModalKit({
  item,
  produtos,
  saldoEstoque,
  niveisEstoque,
  cnpjEmpresa,
  onEtiquetaChange,
  onImpressaoIniciada,
  onImpressaoConcluida,
  onEmbalagemConcluida,
}: EmbalagemModalKitProps) {
  const kits = useMemo<KitCatalogo[]>(
    () =>
      produtos
        .filter((produto) => produto.is_kit === true)
        .map((produto) => ({
          produto,
          variacoes: (produto.grade || []).filter((grade) =>
            (grade.composicao || []).some(
              (componente) =>
                String(componente.produto_id) === String(item.produtoId) &&
                normalizarVariante(componente.variacao) ===
                  normalizarVariante(item.variante),
            ),
          ),
        }))
        .filter((kit) => kit.variacoes.length > 0),
    [item.produtoId, item.variante, produtos],
  );

  const saldoPorSku = useMemo(
    () =>
      new Map(
        saldoEstoque
          .filter((registro) => registro.produto_ref_id)
          .map((registro) => [
            normalizarReferenciaEstoque(registro.produto_ref_id),
            toQuantidade(registro.saldo_atual),
          ]),
      ),
    [saldoEstoque],
  );

  const niveisPorSku = useMemo(
    () =>
      new Map(
        niveisEstoque
          .filter((registro) => registro.produto_ref_id)
          .map((registro) => [
            normalizarReferenciaEstoque(registro.produto_ref_id),
            registro,
          ]),
      ),
    [niveisEstoque],
  );

  const getInteligenciaEstoque = (
    kit: KitCatalogo,
    grade: ProdutoGradeItem,
  ): EstoqueKitInteligencia => {
    const sku = getSkuVariacao(kit.produto, getGradeKey(grade), grade.sku);
    const saldo = saldoPorSku.get(normalizarReferenciaEstoque(sku)) || 0;
    const nivel = niveisPorSku.get(normalizarReferenciaEstoque(sku));
    const meta =
      nivel?.nivel_estoque_ideal === null ||
      nivel?.nivel_estoque_ideal === undefined
        ? null
        : toQuantidade(nivel.nivel_estoque_ideal);
    const falta = meta === null ? null : Math.max(0, meta - saldo);

    return {
      sku,
      atual: saldo,
      meta,
      falta,
      percentual:
        meta !== null && meta > 0 ? Math.min(100, (saldo / meta) * 100) : null,
    };
  };

  const [kitId, setKitId] = useState('');
  const [variacaoKit, setVariacaoKit] = useState('');
  const [disponibilidades, setDisponibilidades] = useState<
    ComponenteDisponibilidade[]
  >([]);
  const [carregandoComponentes, setCarregandoComponentes] = useState(false);
  const [quantidade, setQuantidade] = useState<number | null>(0);
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);
  const [semEtiqueta, setSemEtiqueta] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const modalScrollRef = useRef<{ element: HTMLElement; top: number } | null>(null);
  const carregamentoIniciadoRef = useRef(false);

  useEffect(() => {
    if (kits.length === 0) {
      setKitId('');
      setVariacaoKit('');
      return;
    }

    const kitAtual = kits.find((kit) => String(kit.produto.id) === kitId);
    if (!kitAtual) {
      setKitId(String(kits[0].produto.id));
      setVariacaoKit(getGradeKey(kits[0].variacoes[0]));
      return;
    }

    const variacaoAindaExiste = kitAtual.variacoes.some(
      (grade) => getGradeKey(grade) === variacaoKit,
    );
    if (!variacaoAindaExiste) {
      setVariacaoKit(getGradeKey(kitAtual.variacoes[0]));
    }
  }, [kitId, kits, variacaoKit]);

  const kitSelecionado = kits.find(
    (kit) => String(kit.produto.id) === kitId,
  );
  const gradeSelecionada = kitSelecionado?.variacoes.find(
    (grade) => getGradeKey(grade) === variacaoKit,
  );
  const etiquetaKit = useMemo(
    () => montarEtiquetaProduto(
      kitSelecionado?.produto,
      variacaoKit || gradeSelecionada?.variacao,
      cnpjEmpresa,
    ),
    [cnpjEmpresa, gradeSelecionada?.variacao, kitSelecionado?.produto, variacaoKit],
  );

  useEffect(() => {
    onEtiquetaChange?.(etiquetaKit);
    return () => onEtiquetaChange?.(null);
  }, [etiquetaKit, onEtiquetaChange]);

  const composicao = gradeSelecionada?.composicao || [];
  const inteligenciaSelecionada =
    kitSelecionado && gradeSelecionada
      ? getInteligenciaEstoque(kitSelecionado, gradeSelecionada)
      : null;

  const maxKitsMontaveis = useMemo(() => {
    if (disponibilidades.length === 0) return 0;

    return disponibilidades.reduce(
      (menor, componente) =>
        Math.min(
          menor,
          Math.floor(componente.saldo / componente.quantidadeNecessaria),
        ),
      Number.POSITIVE_INFINITY,
    );
  }, [disponibilidades]);

  const saldoAtualKit = inteligenciaSelecionada?.atual ?? 0;
  const qtdEmbalarKit = Number(quantidade) || 0;
  const saldoPrevistoKit = saldoAtualKit + qtdEmbalarKit;
  const metaIdeal = inteligenciaSelecionada?.meta ?? null;

  useEffect(() => {
    setQuantidade(
      Number.isFinite(maxKitsMontaveis) && maxKitsMontaveis > 0
        ? Math.min(1, maxKitsMontaveis)
        : 0,
    );
  }, [maxKitsMontaveis, kitId, variacaoKit]);

  useEffect(() => {
    if (!gradeSelecionada) {
      setDisponibilidades([]);
      setCarregandoComponentes(false);
      return;
    }

    let ativo = true;
    carregamentoIniciadoRef.current = true;
    setCarregandoComponentes(true);
    setErro(null);
    setDisponibilidades([]);

    void Promise.all(
      composicao.map(async (componente): Promise<ComponenteDisponibilidade> => {
        const produtoId = componente.produto_id;
        const variante = componente.variacao || '-';
        const produtoComponente = produtos.find(
          (produto) => String(produto.id) === String(produtoId),
        );
        const quantidadeNecessaria = Math.max(
          1,
          Math.floor(toQuantidade(componente.quantidade, 1)),
        );

        if (produtoId === undefined || produtoId === null) {
          return {
            componente,
            produto: null,
            produtoId: '-',
            variante,
            nome: componente.produto_nome || 'Componente sem produto',
            quantidadeNecessaria,
            saldo: 0,
            lotes: [],
          };
        }

        const lotes = await listarLotesPorProdutoVariante(produtoId, variante);
        return {
          componente,
          produto: produtoComponente || null,
          produtoId,
          variante,
          nome:
            componente.produto_nome ||
            getNomeProduto(produtoComponente, `Produto ${produtoId}`),
          quantidadeNecessaria,
          saldo: lotes.reduce((total, lote) => total + getSaldoLote(lote), 0),
          lotes,
        };
      }),
    )
      .then((resultado) => {
        if (ativo) setDisponibilidades(resultado);
      })
      .catch((error: unknown) => {
        if (ativo) {
          setErro(
            error instanceof Error
              ? error.message
              : 'Não foi possível consultar os componentes do kit.',
          );
        }
      })
      .finally(() => {
        if (ativo) setCarregandoComponentes(false);
      });

    return () => {
      ativo = false;
    };
  }, [composicao, gradeSelecionada, produtos]);

  useLayoutEffect(() => {
    const preservacao = modalScrollRef.current;
    if (!preservacao) return;

    preservacao.element.scrollTop = preservacao.top;

    if (carregamentoIniciadoRef.current && !carregandoComponentes) {
      requestAnimationFrame(() => {
        if (modalScrollRef.current !== preservacao) return;
        preservacao.element.scrollTop = preservacao.top;
        modalScrollRef.current = null;
        carregamentoIniciadoRef.current = false;
      });
    }
  }, [carregandoComponentes, disponibilidades.length, kitId, variacaoKit]);

  const preservarScrollModal = (target: HTMLElement) => {
    const modal = target.closest<HTMLElement>('.ep-modal-opcoes');
    if (modal) {
      modalScrollRef.current = { element: modal, top: modal.scrollTop };
    }
  };

  const selecionarKit = (kit: KitCatalogo, event: MouseEvent<HTMLButtonElement>) => {
    preservarScrollModal(event.currentTarget);
    setKitId(String(kit.produto.id));
    setVariacaoKit(getGradeKey(kit.variacoes[0]));
  };

  const montarKit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!temPermissao('lancar-embalagem')) {
      mostrarPopupSemPermissao('Você não tem permissão para montar e embalar kits.');
      return;
    }
    setErro(null);

    if (!kitSelecionado || !gradeSelecionada || maxKitsMontaveis <= 0) {
      setErro('Selecione um kit com componentes disponíveis.');
      return;
    }

    if (
      quantidade === null ||
      !Number.isInteger(quantidade) ||
      quantidade <= 0 ||
      quantidade > maxKitsMontaveis
    ) {
      setErro('Informe uma quantidade de kits dentro do saldo disponível.');
      return;
    }

    if (semEtiqueta) {
      await estocarSemEtiqueta();
      return;
    }

    const quantidadeInformada = quantidade;
    const componentesConsumidos: EmbalagemKitComponenteConsumido[] = [];

    for (const componente of disponibilidades) {
      const quantidadeNecessaria = quantidadeInformada * componente.quantidadeNecessaria;
      if (componente.saldo < quantidadeNecessaria) {
        setErro(
          `O saldo do componente "${componente.nome}" mudou. Atualize a fila e tente novamente.`,
        );
        return;
      }
      componentesConsumidos.push({
        produto_id: componente.produtoId,
        variacao: componente.variante === '-' ? null : componente.variante,
        quantidade_usada: quantidadeNecessaria,
      });
    }

    const nomeKit = getNomeProduto(kitSelecionado.produto);
    const nomeVariacaoKit = variacaoKit === '-' ? 'Padrão' : variacaoKit;
    const confirmado = await mostrarConfirmacao(
      `Confirma a montagem e embalagem de <strong>${quantidade}</strong> ${quantidade === 1 ? 'kit' : 'kits'} de<br><strong>${nomeKit} — ${nomeVariacaoKit}</strong>?`,
      {
        tipo: 'aviso',
        textoConfirmar: 'Embalar kits',
        textoCancelar: 'Cancelar',
      },
    );
    if (!confirmado) return;

    setEnviando(true);
    try {
      if (!etiquetaKit) {
        onImpressaoConcluida?.(mensagemEmbalagem({
          quantidade: quantidadeInformada,
          tipo: 'kit',
          impresso: false,
          motivo: 'Este kit não tem SKU para a etiqueta.',
        }), quantidadeInformada);
        return;
      }

      setImprimindo(true);
      onImpressaoIniciada?.(quantidadeInformada);
      try {
        await imprimirEtiqueta(etiquetaKit, quantidadeInformada);
      } catch (error: unknown) {
        onImpressaoConcluida?.(mensagemEmbalagem({
          quantidade: quantidadeInformada,
          tipo: 'kit',
          impresso: false,
          motivo: error instanceof Error ? error.message : 'A impressão falhou.',
        }), quantidadeInformada);
        return;
      } finally {
        setImprimindo(false);
      }

      try {
        await registrarMontagemKit(
        {
          kit_produto_id: kitSelecionado.produto.id,
          kit_variante: variacaoKit === '-' ? null : variacaoKit,
          quantidade_kits_montados: quantidadeInformada,
          componentes_consumidos: componentesConsumidos,
          observacao: observacao.trim() || null,
        },
        `embalagem-kit:${item.id}:${Date.now()}`,
      );
      } catch (error: unknown) {
        const motivo = error instanceof Error ? error.message : 'Não foi possível montar o kit.';
        onImpressaoConcluida?.({
          impresso: true,
          titulo: quantidadeInformada === 1 ? '1 etiqueta adicionada' : `${quantidadeInformada} etiquetas adicionadas`,
          detalhe: `O estoque não foi atualizado. ${motivo}`,
        }, quantidadeInformada);
        return;
      }
      onImpressaoConcluida?.(mensagemEmbalagem({
        quantidade: quantidadeInformada,
        tipo: 'kit',
        impresso: true,
      }), quantidadeInformada);
      await onEmbalagemConcluida?.();
    } catch (error: unknown) {
      const mensagemErro =
        error instanceof Error
          ? error.message
          : 'Não foi possível montar o kit.';
      setErro(mensagemErro);
      mostrarMensagem(mensagemErro, 'erro');
    } finally {
      setEnviando(false);
    }
  };

  const estocarSemEtiqueta = async () => {
    if (!temPermissao('lancar-embalagem')) {
      mostrarPopupSemPermissao('Você não tem permissão para montar e embalar kits.');
      return;
    }
    setErro(null);
    if (!kitSelecionado || !gradeSelecionada || maxKitsMontaveis <= 0) {
      setErro('Selecione um kit com componentes disponíveis.');
      return;
    }
    if (
      quantidade === null ||
      !Number.isInteger(quantidade) ||
      quantidade <= 0 ||
      quantidade > maxKitsMontaveis
    ) {
      setErro('Informe uma quantidade de kits dentro do saldo disponível.');
      return;
    }

    const quantidadeInformada = quantidade;
    const componentesConsumidos: EmbalagemKitComponenteConsumido[] = [];
    for (const componente of disponibilidades) {
      const quantidadeNecessaria = quantidadeInformada * componente.quantidadeNecessaria;
      if (componente.saldo < quantidadeNecessaria) {
        setErro(`O saldo do componente "${componente.nome}" mudou. Atualize a fila e tente novamente.`);
        return;
      }
      componentesConsumidos.push({
        produto_id: componente.produtoId,
        variacao: componente.variante === '-' ? null : componente.variante,
        quantidade_usada: quantidadeNecessaria,
      });
    }

    const confirmado = await mostrarConfirmacao(
      `Estocar <strong>${quantidadeInformada}</strong> ${quantidadeInformada === 1 ? 'kit' : 'kits'} de<br><strong>${getNomeProduto(kitSelecionado.produto)} — ${variacaoKit === '-' ? 'Padrão' : variacaoKit}</strong> sem imprimir etiqueta?`,
      {
        tipo: 'aviso',
        textoConfirmar: 'Estocar sem etiquetar',
        textoCancelar: 'Cancelar',
      },
    );
    if (!confirmado) return;

    setEnviando(true);
    try {
      await registrarMontagemKit(
        {
          kit_produto_id: kitSelecionado.produto.id,
          kit_variante: variacaoKit === '-' ? null : variacaoKit,
          quantidade_kits_montados: quantidadeInformada,
          componentes_consumidos: componentesConsumidos,
          observacao: observacao.trim() || null,
        },
        `embalagem-kit-sem-etiqueta:${item.id}:${Date.now()}`,
      );
      onImpressaoConcluida?.(
        mensagemEstoqueSemEtiqueta(quantidadeInformada, 'kit'),
        quantidadeInformada,
      );
      await onEmbalagemConcluida?.();
    } catch (error: unknown) {
      const mensagemErro = error instanceof Error
        ? error.message
        : 'Não foi possível montar o kit.';
      setErro(mensagemErro);
      mostrarMensagem(mensagemErro, 'erro');
    } finally {
      setEnviando(false);
    }
  };

  if (kits.length === 0) {
    return (
      <div className="ep-modal-kit ep-modal-kit-vazio">
        <UIFeedbackNotFound
          icon="fa-cubes"
          titulo="Nenhum kit encontrado"
          mensagem="Nenhum kit cadastrado utiliza esta variação como componente."
          variante="compacto"
        />
      </div>
    );
  }

  return (
    <form className="ep-modal-kit" onSubmit={montarKit}>
      <div className="ep-modal-kit-intro">
        <div className="ep-modal-proxima-etapa-icone" aria-hidden="true">
          <i className="fas fa-cubes" />
        </div>
        <div>
          <h3>Montar e embalar kit</h3>
          <p>
            Escolha o produto final e a variação. Os componentes mais antigos
            serão consumidos primeiro.
          </p>
        </div>
      </div>

      <div className="ep-kit-seletor-container">
        <div className="ep-kit-seletor-topo">
          <span className="ep-kit-seletor-label">
            <i className="fas fa-boxes-packing" aria-hidden="true" /> Kit de Destino
          </span>
          <span className="ep-kit-seletor-contagem">
            {kits.length} {kits.length === 1 ? 'kit compatível' : 'kits compatíveis'}
          </span>
        </div>

        {/* Linha horizontal com chips dos kits */}
        <div className="ep-kit-chips-linha" role="tablist" aria-label="Selecione o kit de destino">
          {kits.map((kit) => {
            const ativo = String(kit.produto.id) === kitId;
            return (
              <button
                className={`ep-kit-chip-btn${ativo ? ' ativo' : ''}`}
                key={kit.produto.id}
                type="button"
                onClick={(event) => selecionarKit(kit, event)}
                aria-pressed={ativo}
              >
                <img
                  src={getImagemVariacao(kit.produto, getGradeKey(kit.variacoes[0]))}
                  alt=""
                />
                <div className="ep-kit-chip-info">
                  <strong>{getNomeProduto(kit.produto)}</strong>
                  <small>{getVariacoesLabel(kit.variacoes.length)}</small>
                </div>
                {ativo ? <i className="fas fa-check" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>

        {/* Variações do kit selecionado */}
        {kitSelecionado && kitSelecionado.variacoes.length > 0 ? (
          <div className="ep-kit-variacoes-bloco">
            <div className="ep-kit-variacoes-subtitulo">
              <span>Escolha a variação do kit:</span>
            </div>
            <div className="ep-kit-variacoes-grid">
              {kitSelecionado.variacoes.map((grade) => {
                const gradeAtiva = getGradeKey(grade) === variacaoKit;
                const inteligencia = getInteligenciaEstoque(kitSelecionado, grade);
                return (
                  <button
                    className={`ep-kit-var-card${gradeAtiva ? ' ativo' : ''}`}
                    key={getGradeKey(grade)}
                    type="button"
                    onClick={(event) => {
                      preservarScrollModal(event.currentTarget);
                      setVariacaoKit(getGradeKey(grade));
                    }}
                    disabled={enviando}
                    aria-pressed={gradeAtiva}
                  >
                    <img
                      src={getImagemVariacao(kitSelecionado.produto, getGradeKey(grade))}
                      alt=""
                    />
                    <div className="ep-kit-var-conteudo">
                      <strong>{grade.variacao || 'Padrão'}</strong>
                      <small className="ep-kit-var-sku">
                        SKU {getSkuVariacao(kitSelecionado.produto, getGradeKey(grade), grade.sku)}
                      </small>
                      <div className="ep-kit-var-estoque">
                        <i className="fas fa-boxes-stacked" aria-hidden="true" />
                        <span>{inteligencia.atual} un. em estoque</span>
                      </div>
                    </div>
                    {gradeAtiva ? (
                      <i className="fas fa-circle-check ep-kit-var-check" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {carregandoComponentes ? (
        <UICarregando variante="bloco" />
      ) : (
        <>
          <div className="ep-kit-componentes-bloco">
            <div className="ep-kit-componentes-topo">
              <div className="ep-kit-comp-titulo">
                <i className="fas fa-layer-group" aria-hidden="true" />
                <strong>Componentes Necessários</strong>
              </div>
              <span className="ep-kit-comp-subtitulo">
                {disponibilidades.length} {disponibilidades.length === 1 ? 'item na receita' : 'itens na receita'} deste kit
              </span>
            </div>

            <div className="ep-kit-componentes-grid">
              {disponibilidades.map((componente, index) => {
                const status = getStatusComponente(
                  componente.saldo,
                  componente.quantidadeNecessaria,
                );
                const isFalta = status.classe === 'ep-modal-kit-status-falta';
                const isAtencao = status.classe === 'ep-modal-kit-status-atencao';

                return (
                  <div
                    key={`${componente.produtoId}-${componente.variante}-${index}`}
                    className={`ep-kit-comp-card${isFalta ? ' ep-kit-comp-card--falta' : isAtencao ? ' ep-kit-comp-card--atencao' : ''}`}
                  >
                    <img
                      src={getImagemVariacao(componente.produto, componente.variante)}
                      alt=""
                      className="ep-kit-comp-foto"
                    />
                    <div className="ep-kit-comp-info">
                      <div className="ep-kit-comp-nomes">
                        <strong className="ep-kit-comp-nome-produto">{componente.nome}</strong>
                        <span className="ep-kit-comp-variante">
                          {componente.variante === '-' ? 'Padrão' : componente.variante}
                        </span>
                      </div>
                      <div className="ep-kit-comp-dados">
                        <span className="ep-kit-comp-badge-por-kit">
                          {componente.quantidadeNecessaria} un./kit
                        </span>
                        <span className="ep-kit-comp-saldo">
                          Saldo: <strong>{componente.saldo}</strong>
                        </span>
                      </div>
                    </div>
                    <div className="ep-kit-comp-status-wrap">
                      <span className={`ep-modal-kit-status ${status.classe}`}>
                        {status.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {maxKitsMontaveis <= 0 && (
            <p className="ep-modal-kit-alerta">
              <i className="fas fa-triangle-exclamation" aria-hidden="true" />
              Componentes insuficientes em estoque para montar este kit.
            </p>
          )}

          <div className="ep-modal-grid-embalagem">
            {/* Coluna 1: Quantidade a embalar */}
            <EmbalagemControleQuantidade
              value={quantidade}
              max={maxKitsMontaveis}
              onChange={setQuantidade}
              disabled={enviando || maxKitsMontaveis <= 0}
              id="ep-quantidade-kits"
              badgeTexto={`${maxKitsMontaveis} ${maxKitsMontaveis === 1 ? 'kit montável' : 'kits montáveis'}`}
            />

            {/* Coluna 2: Impacto no Estoque do Kit */}
            <div className="ep-card-impacto-estoque">
              <div className="ep-impacto-estoque-topo">
                <div className="ep-impacto-titulo">
                  <i className="fas fa-boxes-stacked" aria-hidden="true" />
                  <span>Impacto no Estoque</span>
                </div>
                {metaIdeal !== null && metaIdeal > 0 ? (
                  <span
                    className={`ep-impacto-badge ${
                      saldoPrevistoKit >= metaIdeal
                        ? 'ep-impacto-badge--seguro'
                        : saldoPrevistoKit >= metaIdeal * 0.5
                        ? 'ep-impacto-badge--moderado'
                        : 'ep-impacto-badge--baixo'
                    }`}
                  >
                    {saldoPrevistoKit >= metaIdeal
                      ? 'Estoque Seguro'
                      : saldoPrevistoKit >= metaIdeal * 0.5
                      ? 'Em Reposição'
                      : 'Estoque Baixo'}
                  </span>
                ) : (
                  <span className="ep-impacto-badge ep-impacto-badge--seguro">
                    Entrada no Estoque
                  </span>
                )}
              </div>

              <div className="ep-impacto-fluxo">
                <div className="ep-impacto-item">
                  <span className="ep-impacto-label">Saldo Atual</span>
                  <strong className="ep-impacto-valor">{saldoAtualKit} un.</strong>
                </div>

                <div className="ep-impacto-seta" aria-hidden="true">
                  <i className="fas fa-arrow-right" />
                </div>

                <div className="ep-impacto-item">
                  <span className="ep-impacto-label">Entrada</span>
                  <strong className="ep-impacto-valor ep-impacto-valor--entrada">
                    +{qtdEmbalarKit} un.
                  </strong>
                </div>

                <div className="ep-impacto-seta" aria-hidden="true">
                  <i className="fas fa-arrow-right" />
                </div>

                <div className="ep-impacto-item ep-impacto-item--destaque">
                  <span className="ep-impacto-label">Saldo Final</span>
                  <strong className="ep-impacto-valor ep-impacto-valor--final">
                    {saldoPrevistoKit} un.
                  </strong>
                </div>
              </div>

              <div className="ep-impacto-meta-info">
                <small>
                  {metaIdeal !== null && metaIdeal > 0
                    ? `Meta ideal cadastrada: ${metaIdeal} un.`
                    : 'Entrada física registrada no estoque do kit.'}
                </small>
              </div>
            </div>
          </div>

          <div className="ep-modal-observacao-linha">
            <label htmlFor="ep-observacao-kit-input">
              Observação <span>(opcional)</span>
            </label>
            <input
              id="ep-observacao-kit-input"
              type="text"
              className="ep-observacao-input"
              placeholder="Observação da montagem do kit..."
              value={observacao}
              onChange={(event) => setObservacao(event.target.value)}
              maxLength={500}
              disabled={enviando}
            />
          </div>

          {erro ? (
            <p className="ep-modal-erro" role="alert">
              <i className="fas fa-circle-exclamation" aria-hidden="true" />
              {erro}
            </p>
          ) : null}

          <UIBloqueio
            permissao="lancar-embalagem"
            mensagem="Você não tem permissão para montar e embalar kits."
          >
            <div className="ep-modal-acoes">
              <button
                className="gs-btn gs-btn-primario ep-modal-confirmar"
                type="submit"
                disabled={enviando || carregandoComponentes || maxKitsMontaveis <= 0}
              >
                <i className="fas fa-cubes" aria-hidden="true" />
                {imprimindo ? 'Imprimindo etiqueta...' : enviando ? 'Embalando kits...' : 'Embalar kits'}
              </button>
              <label className={`ep-sem-etiqueta${semEtiqueta ? ' ativo' : ''}`}>
                <input
                  type="checkbox"
                  checked={semEtiqueta}
                  disabled={enviando || maxKitsMontaveis <= 0}
                  onChange={(event) => setSemEtiqueta(event.target.checked)}
                />
                <span className="ep-sem-etiqueta-topo">
                  <span className="ep-sem-etiqueta-marca" aria-hidden="true" />
                  <small>Opcional</small>
                </span>
                <span className="ep-sem-etiqueta-texto">Estocar sem etiquetar</span>
              </label>
            </div>
          </UIBloqueio>
        </>
      )}
    </form>
  );
}
