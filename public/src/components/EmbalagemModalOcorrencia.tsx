import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { registrarOcorrenciaEmbalagem } from '../utils/embalagem-api';
import type {
  EmbalagemFilaItem,
  EmbalagemOcorrenciaMotivo,
} from '../utils/embalagem-types';
import UIBloqueio from './UIBloqueio';
import { mostrarPopupSemPermissao, temPermissao } from '../utils/bloqueio';
// @ts-expect-error popups sistÃªmicos legados, mantidos por compatibilidade visual.
import { mostrarConfirmacao, mostrarMensagem } from '/js/utils/popups.js';

interface EmbalagemModalOcorrenciaProps {
  items: EmbalagemFilaItem[];
  onClose: () => void;
  onConcluida?: () => Promise<void> | void;
}

const MOTIVOS: Array<{
  value: EmbalagemOcorrenciaMotivo;
  label: string;
  detalhe: string;
  icone: string;
}> = [
  {
    value: 'QUANTIDADE_DIVERGENTE',
    label: 'Quantidade divergente',
    detalhe: 'Saldo digital diferente da conferência física.',
    icone: 'fa-scale-balanced',
  },
  {
    value: 'LANCAMENTO_ERRADO',
    label: 'Lançamento errado',
    detalhe: 'Retira o lançamento incorreto sem apagar a produção.',
    icone: 'fa-file-circle-xmark',
  },
  {
    value: 'PRODUTO_AVARIADO',
    label: 'Produto avariado',
    detalhe: 'Interrompe definitivamente a peça antes do estoque.',
    icone: 'fa-triangle-exclamation',
  },
  {
    value: 'ENVIAR_CONSERTO',
    label: 'Enviar para conserto',
    detalhe: 'Coloca a peça em quarentena com retorno controlado.',
    icone: 'fa-screwdriver-wrench',
  },
];

function chaveItem(item: EmbalagemFilaItem): string {
  return `${item.produtoId}:${item.variante}`;
}

function normalizarTexto(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatarQuantidade(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}

function imagemProduto(item: EmbalagemFilaItem): string {
  return item.imagem || '/img/placeholder-image.png';
}

export default function EmbalagemModalOcorrencia({
  items,
  onClose,
  onConcluida,
}: EmbalagemModalOcorrenciaProps) {
  const [produtoChave, setProdutoChave] = useState(() => (
    items[0] ? chaveItem(items[0]) : ''
  ));
  const [produtoBusca, setProdutoBusca] = useState('');
  const [motivo, setMotivo] = useState<EmbalagemOcorrenciaMotivo | ''>('');
  const [quantidade, setQuantidade] = useState('1');
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const itemSelecionado = useMemo(
    () => items.find((item) => chaveItem(item) === produtoChave) || null,
    [items, produtoChave],
  );

  const itensFiltrados = useMemo(() => {
    const busca = normalizarTexto(produtoBusca);
    if (!busca) return items;
    return items.filter((item) => normalizarTexto(
      `${item.nomeProduto} ${item.variante} ${item.sku}`,
    ).includes(busca));
  }, [items, produtoBusca]);

  const saldoDisponivel = itemSelecionado?.quantidadeDisponivel || 0;
  const ehDivergencia = motivo === 'QUANTIDADE_DIVERGENTE';
  const quantidadeNumero = quantidade.trim() === '' ? null : Number(quantidade);
  const quantidadeCalculada = quantidadeNumero ?? Number.NaN;
  const quantidadeFisicaNumero = ehDivergencia
    && quantidadeNumero !== null
    && Number.isInteger(quantidadeNumero)
    ? saldoDisponivel - quantidadeNumero
    : null;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.classList.add('ep-modal-aberto');
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('ep-modal-aberto');
    };
  }, [onClose]);

  useEffect(() => {
    if (items.length === 0) {
      setProdutoChave('');
      return;
    }
    if (!items.some((item) => chaveItem(item) === produtoChave)) {
      setProdutoChave(chaveItem(items[0]));
    }
  }, [items, produtoChave]);

  useEffect(() => {
    if (!itemSelecionado) return;
    setQuantidade('1');
    setErro(null);
  }, [itemSelecionado]);

  const selecionarProduto = (item: EmbalagemFilaItem) => {
    setProdutoChave(chaveItem(item));
    setErro(null);
  };

  const alterarQuantidade = (valor: string) => {
    if (valor === '') {
      setQuantidade('');
      return;
    }
    const numero = Number(valor);
    if (Number.isInteger(numero) && numero >= 0 && numero <= saldoDisponivel) {
      setQuantidade(valor);
    }
  };

  const ajustarQuantidade = (delta: number) => {
    const atual = quantidadeNumero !== null && Number.isInteger(quantidadeNumero)
      ? quantidadeNumero
      : 0;
    const novaQuantidade = Math.max(0, Math.min(saldoDisponivel, atual + delta));
    setQuantidade(String(novaQuantidade));
  };

  const definirQuantidadeMaxima = () => {
    setQuantidade(String(saldoDisponivel));
  };

  const limparQuantidade = () => {
    setQuantidade('');
  };

  const enviar = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!temPermissao(['lancar-embalagem', 'registrar-ocorrencia-embalagem'])) {
      mostrarPopupSemPermissao('Você não tem permissão para registrar ocorrências na Embalagem.');
      return;
    }
    if (!itemSelecionado || !motivo) {
      setErro('Selecione o produto e o motivo da ocorrência.');
      return;
    }
    if (!observacao.trim()) {
      setErro('A observação é obrigatória para manter a rastreabilidade.');
      return;
    }
    if (!Number.isInteger(quantidadeCalculada) || quantidadeCalculada <= 0) {
      setErro(ehDivergencia
        ? 'Informe uma quantidade afetada positiva e compatível com o saldo digital.'
        : 'Informe uma quantidade inteira positiva.');
      return;
    }
    if (quantidadeCalculada > saldoDisponivel) {
      setErro('A quantidade não pode superar o saldo disponível na fila.');
      return;
    }

    const motivoLabel = MOTIVOS.find((item) => item.value === motivo)?.label || motivo;
    const confirmou = await mostrarConfirmacao(
      `Registrar <strong>${formatarQuantidade(quantidadeCalculada)}</strong> unidade(s) como<br><strong>${motivoLabel}</strong>?<br><small>${itemSelecionado.nomeProduto} — ${itemSelecionado.variante}</small>`,
      {
        tipo: 'aviso',
        textoConfirmar: motivo === 'ENVIAR_CONSERTO' ? 'Enviar para conserto' : 'Registrar ocorrência',
        textoCancelar: 'Cancelar',
      },
    );
    if (!confirmou) return;

    setEnviando(true);
    setErro(null);
    try {
      await registrarOcorrenciaEmbalagem({
        produto_id: itemSelecionado.produtoId,
        variante: itemSelecionado.variante === '-' ? null : itemSelecionado.variante,
        motivo,
        quantidade: quantidadeCalculada,
        ...(ehDivergencia ? { quantidade_fisica: quantidadeFisicaNumero } : {}),
        observacao: observacao.trim(),
      });
      mostrarMensagem(
        motivo === 'ENVIAR_CONSERTO'
          ? 'Produto enviado para conserto.'
          : 'Ocorrência registrada com sucesso.',
        'sucesso',
      );
      await onConcluida?.();
    } catch (error) {
      const mensagem = error instanceof Error
        ? error.message
        : 'Não foi possível registrar a ocorrência.';
      setErro(mensagem);
      mostrarMensagem(mensagem, 'erro');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      className="ep-modal-overlay ep-ocorrencia-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="ep-modal-opcoes ep-modal-ocorrencia"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ep-modal-ocorrencia-titulo"
      >
        <header className="ep-ocorrencia-cabecalho">
          <span className="ep-ocorrencia-cabecalho-icone" aria-hidden="true">
            <i className="fas fa-triangle-exclamation" />
          </span>
          <div className="ep-ocorrencia-cabecalho-conteudo">
            <span className="ep-ocorrencia-eyebrow">Controle da fila de embalagem</span>
            <h2 id="ep-modal-ocorrencia-titulo">Registrar ocorrência</h2>
            <p>A produção original, as comissões e os pontos permanecem preservados.</p>
          </div>
          <button
            className="ep-ocorrencia-fechar"
            type="button"
            onClick={onClose}
            aria-label="Fechar ocorrência"
          >
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <form className="ep-ocorrencia-formulario" onSubmit={enviar}>
          {items.length === 0 ? (
            <div className="ep-modal-estado-vazio">
              <i className="fas fa-box-open" aria-hidden="true" />
              <strong>Não há saldo pronto para registrar.</strong>
              <p>Atualize a fila e tente novamente quando houver produto disponível.</p>
            </div>
          ) : (
            <>
              <section className="ep-ocorrencia-secao ep-ocorrencia-produto-secao">
                <div className="ep-ocorrencia-secao-cabecalho">
                  <div>
                    <span className="ep-ocorrencia-passo">01 · Produto</span>
                    <strong>Qual produto precisa de atenção?</strong>
                    <small>Escolha uma combinação de produto e variação da fila.</small>
                  </div>
                  <span className="ep-ocorrencia-contagem">
                    {items.length} {items.length === 1 ? 'opção' : 'opções'}
                  </span>
                </div>

                <div className="ep-ocorrencia-produto-grid">
                  <div className="ep-ocorrencia-produto-picker">
                    <label className="ep-ocorrencia-busca" htmlFor="ep-ocorrencia-produto-busca">
                      <i className="fas fa-search" aria-hidden="true" />
                      <input
                        id="ep-ocorrencia-produto-busca"
                        type="search"
                        value={produtoBusca}
                        onChange={(event) => setProdutoBusca(event.target.value)}
                        placeholder="Buscar produto, variação ou SKU..."
                        disabled={enviando}
                      />
                      {produtoBusca ? (
                        <button
                          type="button"
                          onClick={() => setProdutoBusca('')}
                          aria-label="Limpar busca de produto"
                        >
                          <i className="fas fa-xmark" aria-hidden="true" />
                        </button>
                      ) : null}
                    </label>

                    <div
                      className="ep-ocorrencia-produto-lista"
                      role="listbox"
                      aria-label="Produtos disponíveis para ocorrência"
                    >
                      {itensFiltrados.length > 0 ? itensFiltrados.map((item) => {
                        const selecionado = chaveItem(item) === produtoChave;
                        return (
                          <button
                            className={`ep-ocorrencia-produto-opcao${selecionado ? ' selecionado' : ''}`}
                            key={chaveItem(item)}
                            type="button"
                            role="option"
                            aria-selected={selecionado}
                            onClick={() => selecionarProduto(item)}
                            disabled={enviando}
                          >
                            <img src={imagemProduto(item)} alt="" aria-hidden="true" />
                            <span className="ep-ocorrencia-produto-opcao-texto">
                              <strong>{item.nomeProduto}</strong>
                              <small>{item.variante} · {item.sku || 'SKU não informado'}</small>
                            </span>
                            <span className="ep-ocorrencia-produto-opcao-saldo">
                              <b>{formatarQuantidade(item.quantidadeDisponivel)}</b>
                              <small>un.</small>
                            </span>
                            <i
                              className={`fas ${selecionado ? 'fa-circle-check' : 'fa-circle'}`}
                              aria-hidden="true"
                            />
                          </button>
                        );
                      }) : (
                        <div className="ep-ocorrencia-lista-vazia">
                          <i className="fas fa-magnifying-glass" aria-hidden="true" />
                          <span>Nenhum produto encontrado</span>
                          <small>Tente outro nome, variação ou SKU.</small>
                        </div>
                      )}
                    </div>
                  </div>

                  <aside className="ep-ocorrencia-saldo" aria-label="Saldo digital na fila">
                    <span className="ep-ocorrencia-saldo-icone" aria-hidden="true">
                      <i className="fas fa-box-open" />
                    </span>
                    <span className="ep-ocorrencia-saldo-label">Saldo digital na fila</span>
                    <strong>{formatarQuantidade(saldoDisponivel)}</strong>
                    <small>unidades disponíveis para esta ocorrência</small>
                    {itemSelecionado ? (
                      <span className="ep-ocorrencia-saldo-produto">
                        <i className="fas fa-location-dot" aria-hidden="true" />
                        {itemSelecionado.nomeProduto} · {itemSelecionado.variante}
                      </span>
                    ) : null}
                  </aside>
                </div>
              </section>

              <div className="ep-ocorrencia-config-grid">
                <fieldset className="ep-ocorrencia-secao ep-ocorrencia-motivos">
                  <legend>
                    <span className="ep-ocorrencia-passo">02 · Motivo da ocorrência</span>
                    <strong>O que aconteceu?</strong>
                    <small>Isso define como o saldo será tratado.</small>
                  </legend>
                  <div className="ep-ocorrencia-motivo-grid">
                    {MOTIVOS.map((opcao) => (
                      <label
                        key={opcao.value}
                        className={`ep-ocorrencia-motivo${motivo === opcao.value ? ' ativo' : ''}`}
                      >
                        <input
                          type="radio"
                          name="motivo-ocorrencia"
                          value={opcao.value}
                          checked={motivo === opcao.value}
                          onChange={() => {
                            setMotivo(opcao.value);
                            setErro(null);
                          }}
                          disabled={enviando}
                        />
                        <span className="ep-ocorrencia-motivo-icone" aria-hidden="true">
                          <i className={`fas ${opcao.icone}`} />
                        </span>
                        <span className="ep-ocorrencia-motivo-texto">
                          <strong>{opcao.label}</strong>
                          <small>{opcao.detalhe}</small>
                        </span>
                        <i className="fas fa-check ep-ocorrencia-motivo-check" aria-hidden="true" />
                      </label>
                    ))}
                  </div>
                </fieldset>

                  <section className="ep-ocorrencia-secao ep-ocorrencia-quantidade">
                    <div className="ep-ocorrencia-secao-cabecalho">
                      <div>
                        <span className="ep-ocorrencia-passo">03 · Quantidade afetada</span>
                        <strong>Quantas unidades?</strong>
                      </div>
                    <span className="ep-ocorrencia-quantidade-total">
                      {Number.isInteger(quantidadeCalculada) && quantidadeCalculada > 0
                        ? `${formatarQuantidade(quantidadeCalculada)} un.`
                        : '—'}
                    </span>
                  </div>

                  <label className="ep-ocorrencia-campo-quantidade" htmlFor="ep-ocorrencia-quantidade">
                    <span>Quantidade afetada</span>
                    <div className="ep-ocorrencia-controles">
                      <div className="ep-ocorrencia-input-unidade">
                        <input
                          id="ep-ocorrencia-quantidade"
                          type="number"
                          min="0"
                          max={saldoDisponivel}
                          step="1"
                          value={quantidade}
                          onChange={(event) => alterarQuantidade(event.target.value)}
                          disabled={enviando}
                        />
                        <b>un.</b>
                      </div>
                      <div className="ep-ocorrencia-atalhos" aria-label="Atalhos de quantidade">
                        <button type="button" onClick={() => ajustarQuantidade(1)} disabled={enviando}>+1</button>
                        <button type="button" onClick={() => ajustarQuantidade(5)} disabled={enviando}>+5</button>
                        <button type="button" onClick={definirQuantidadeMaxima} disabled={enviando}>MAX</button>
                      </div>
                      <button
                        type="button"
                        className="ep-ocorrencia-limpar"
                        onClick={limparQuantidade}
                        disabled={enviando}
                      >
                        LIMPAR
                      </button>
                    </div>
                    <small className="ep-campo-ajuda">
                      {ehDivergencia ? (
                        <>Digital {formatarQuantidade(saldoDisponivel)} − afetada {quantidade.trim() === '' ? '—' : quantidade} = <strong>físico {quantidadeFisicaNumero !== null && quantidadeFisicaNumero >= 0 ? formatarQuantidade(quantidadeFisicaNumero) : '—'}</strong></>
                      ) : (
                        <>Máximo: {formatarQuantidade(saldoDisponivel)} un.</>
                      )}
                    </small>
                  </label>
                </section>
              </div>

              <section className="ep-ocorrencia-secao ep-ocorrencia-observacao">
                <label htmlFor="ep-ocorrencia-observacao">
                  <span className="ep-ocorrencia-passo">04 · Observação <em>Obrigatória</em></span>
                  <strong>Registre o contexto da ocorrência</strong>
                  <small>Essa informação ficará disponível no Histórico geral.</small>
                </label>
                <textarea
                  id="ep-ocorrencia-observacao"
                  rows={3}
                  maxLength={500}
                  value={observacao}
                  onChange={(event) => setObservacao(event.target.value)}
                  placeholder="Descreva o que foi conferido ou identificado..."
                  disabled={enviando}
                />
                <span className="ep-ocorrencia-observacao-contagem">{observacao.length}/500</span>
              </section>

              {erro ? (
                <p className="ep-modal-erro" role="alert">
                  <i className="fas fa-circle-exclamation" aria-hidden="true" />
                  {erro}
                </p>
              ) : null}

              <div className="ep-ocorrencia-acoes">
                <span className="ep-ocorrencia-atalho">
                  <i className="fas fa-keyboard" aria-hidden="true" />
                  Esc para fechar
                </span>
                <UIBloqueio
                  permissao={['lancar-embalagem', 'registrar-ocorrencia-embalagem']}
                  mensagem="Você não tem permissão para registrar ocorrências na Embalagem."
                >
                  <button
                    className="gs-btn gs-btn-primario ep-ocorrencia-confirmar"
                    type="submit"
                    disabled={enviando || !motivo || !itemSelecionado}
                  >
                    <i className={`fas ${motivo === 'ENVIAR_CONSERTO' ? 'fa-screwdriver-wrench' : 'fa-triangle-exclamation'}`} aria-hidden="true" />
                    {enviando ? 'Registrando...' : motivo === 'ENVIAR_CONSERTO' ? 'Enviar para conserto' : 'Registrar ocorrência'}
                  </button>
                </UIBloqueio>
              </div>
            </>
          )}
        </form>
      </section>
    </div>
  );
}
