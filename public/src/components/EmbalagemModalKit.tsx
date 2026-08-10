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

function getStatusEstoque(
  inteligencia: EstoqueKitInteligencia,
): { label: string; classe: string } {
  if (inteligencia.meta === null) {
    return {
      label: 'Meta não configurada',
      classe: 'ep-modal-kit-estoque-neutro',
    };
  }

  if ((inteligencia.falta || 0) > 0) {
    return {
      label: 'Abaixo da meta',
      classe: 'ep-modal-kit-estoque-atencao',
    };
  }

  return { label: 'Meta atingida', classe: 'ep-modal-kit-estoque-ok' };
}

export default function EmbalagemModalKit({
  item,
  produtos,
  saldoEstoque,
  niveisEstoque,
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

  const quantidadeSugerida =
    inteligenciaSelecionada?.falta === null || inteligenciaSelecionada === null
      ? 0
      : Math.min(inteligenciaSelecionada.falta, maxKitsMontaveis);

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
        textoConfirmar: 'Montar e embalar',
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
        `embalagem-kit:${item.id}:${Date.now()}`,
      );
      mostrarMensagem(
        `Montagem concluída com sucesso: <strong>${quantidadeInformada}</strong> ${quantidadeInformada === 1 ? 'kit' : 'kits'} registrado${quantidadeInformada === 1 ? '' : 's'} no estoque.`,
        'sucesso',
      );
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

      <fieldset className="ep-modal-kit-fieldset">
        <legend>Escolha o kit de destino</legend>
        <div className="ep-modal-kit-opcoes">
          {kits.map((kit) => {
            const ativo = String(kit.produto.id) === kitId;
            return (
              <div
                className={`ep-modal-kit-opcao${ativo ? ' ativo' : ''}`}
                key={kit.produto.id}
              >
                <button
                  className="ep-modal-kit-opcao-cabecalho"
                  type="button"
                  onClick={(event) => selecionarKit(kit, event)}
                  aria-expanded={ativo}
                >
                  <img
                    src={getImagemVariacao(kit.produto, getGradeKey(kit.variacoes[0]))}
                    alt=""
                  />
                  <span>
                    <strong>{getNomeProduto(kit.produto)}</strong>
                    <small>{getVariacoesLabel(kit.variacoes.length)}</small>
                  </span>
                  <i className={`fas fa-chevron-${ativo ? 'up' : 'down'}`} aria-hidden="true" />
                </button>

                {ativo ? (
                  <div
                    className="ep-modal-kit-variacoes"
                    role="group"
                    aria-label="Variações disponíveis do kit"
                  >
                    <span className="ep-modal-kit-variacoes-titulo">
                      Escolha a variação do kit
                    </span>
                    <div className="ep-modal-kit-variacoes-grid">
                      {kit.variacoes.map((grade) => {
                        const gradeAtiva = getGradeKey(grade) === variacaoKit;
                        const inteligencia = getInteligenciaEstoque(kit, grade);
                        return (
                          <button
                            className={`ep-modal-kit-variacao${gradeAtiva ? ' ativa' : ''}`}
                            key={getGradeKey(grade)}
                            type="button"
                            onClick={(event) => {
                              preservarScrollModal(event.currentTarget);
                              setVariacaoKit(getGradeKey(grade));
                            }}
                            disabled={enviando}
                          >
                            <img
                              src={getImagemVariacao(kit.produto, getGradeKey(grade))}
                              alt=""
                            />
                            <span>
                              <strong>{grade.variacao || 'Padrão'}</strong>
                              <small>
                                SKU {getSkuVariacao(kit.produto, getGradeKey(grade), grade.sku)}
                              </small>
                              <small className="ep-modal-kit-variacao-estoque">
                                <i className="fas fa-boxes-stacked" aria-hidden="true" />
                                {inteligencia.atual} em estoque
                                {inteligencia.meta !== null
                                  ? ` / ${inteligencia.meta} ideal`
                                  : ' · meta não definida'}
                              </small>
                            </span>
                            {gradeAtiva ? (
                              <i
                                className="fas fa-circle-check"
                                aria-label="Variação selecionada"
                              />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>

      {inteligenciaSelecionada ? (
        <section
          className="ep-modal-kit-estoque"
          aria-label="Inteligência de estoque da variação selecionada"
        >
          <div className="ep-modal-kit-estoque-cabecalho">
            <div>
              <span className="ep-modal-kit-estoque-kicker">
                Estoque da variação selecionada
              </span>
              <strong>{gradeSelecionada?.variacao || 'Padrão'}</strong>
              <small>SKU {inteligenciaSelecionada.sku}</small>
            </div>
            <span
              className={`ep-modal-kit-estoque-status ${getStatusEstoque(inteligenciaSelecionada).classe}`}
            >
              {getStatusEstoque(inteligenciaSelecionada).label}
            </span>
          </div>

          <div className="ep-modal-kit-estoque-metricas">
            <span>
              <small>Estoque atual</small>
              <strong>{inteligenciaSelecionada.atual}</strong>
            </span>
            <span>
              <small>Meta ideal</small>
              <strong>
                {inteligenciaSelecionada.meta === null
                  ? '—'
                  : inteligenciaSelecionada.meta}
              </strong>
            </span>
            <span>
              <small>Falta para meta</small>
              <strong>
                {inteligenciaSelecionada.falta === null
                  ? '—'
                  : inteligenciaSelecionada.falta}
              </strong>
            </span>
            <span>
              <small>Montável agora</small>
              <strong>{maxKitsMontaveis}</strong>
            </span>
          </div>

          {inteligenciaSelecionada.percentual !== null ? (
            <div className="ep-modal-kit-estoque-progresso" aria-hidden="true">
              <span
                style={{ width: `${inteligenciaSelecionada.percentual}%` }}
              />
            </div>
          ) : (
            <p className="ep-modal-kit-estoque-sem-meta">
              Configure uma meta ideal para receber uma sugestão automática de reposição.
            </p>
          )}

          {quantidadeSugerida > 0 ? (
            <div className="ep-modal-kit-estoque-recomendacao">
              <span>
                <i className="fas fa-lightbulb" aria-hidden="true" />
                Sugestão: montar {quantidadeSugerida} kit{quantidadeSugerida === 1 ? '' : 's'}
              </span>
              <button
                className="gs-btn gs-btn-secundario"
                type="button"
                onClick={() => setQuantidade(quantidadeSugerida)}
                disabled={enviando || carregandoComponentes}
              >
                Usar sugestão
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {carregandoComponentes ? (
        <UICarregando variante="bloco" />
      ) : (
        <>
          <div className="ep-modal-kit-composicao">
            <div className="ep-modal-kit-composicao-cabecalho">
              <strong>Componentes necessários</strong>
              <span>Saldo atual por variação</span>
            </div>
            <div className="ep-modal-kit-tabela-wrap">
              <table className="ep-modal-kit-tabela">
                <thead>
                  <tr>
                    <th>Componente</th>
                    <th>Por kit</th>
                    <th>Saldo</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {disponibilidades.map((componente, index) => {
                    const status = getStatusComponente(
                      componente.saldo,
                      componente.quantidadeNecessaria,
                    );
                    return (
                      <tr key={`${componente.produtoId}-${componente.variante}-${index}`}>
                        <td className="ep-modal-kit-componente-celula">
                          <img
                            src={getImagemVariacao(componente.produto, componente.variante)}
                            alt=""
                          />
                          <span>
                            <strong>{componente.nome}</strong>
                            <small>{componente.variante === '-' ? 'Padrão' : componente.variante}</small>
                          </span>
                        </td>
                        <td>{componente.quantidadeNecessaria}</td>
                        <td>{componente.saldo}</td>
                        <td>
                          <span className={`ep-modal-kit-status ${status.classe}`}>
                            {status.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {maxKitsMontaveis > 0 ? (
            <EmbalagemControleQuantidade
              value={quantidade}
              max={maxKitsMontaveis}
              onChange={setQuantidade}
              disabled={enviando}
              id="ep-quantidade-kits"
            />
          ) : (
            <p className="ep-modal-kit-alerta">
              <i className="fas fa-triangle-exclamation" aria-hidden="true" />
              Componentes insuficientes para montar este kit.
            </p>
          )}

          <label className="ep-modal-kit-observacao">
            Observação <span>(opcional)</span>
            <textarea
              value={observacao}
              onChange={(event) => setObservacao(event.target.value)}
              rows={3}
              maxLength={500}
              disabled={enviando}
            />
          </label>

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
            <button
              className="gs-btn gs-btn-primario ep-modal-confirmar"
              type="submit"
              disabled={enviando || carregandoComponentes || maxKitsMontaveis <= 0}
            >
              <i className="fas fa-cubes" aria-hidden="true" />
              {enviando ? 'Montando kit...' : 'Montar e embalar kit'}
            </button>
          </UIBloqueio>
        </>
      )}
    </form>
  );
}
