import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { montarEtiquetaProduto, type EtiquetaImpressao } from '../utils/etiqueta-embalagem';
import { mensagemEmbalagem, mensagemEstoqueSemEtiqueta, type ResultadoEmbalagem } from '../utils/etiqueta-resultado';
import { imprimirEtiqueta, obterCnpjEmpresaAtiva } from '../utils/printnow-agente';
import { EmbalagemImpressora, EmbalagemPreviewEtiqueta } from './EmbalagemEtiqueta';
import {
  listarLotesParaEmbalagem,
  registrarEmbalagemUnitaria,
} from '../utils/embalagem-api';
import type {
  EmbalagemFilaItem,
  EmbalagemArremateLote,
  EmbalagemEstoqueSaldo,
  EmbalagemNivelEstoque,
  ProdutoCadastro,
} from '../utils/embalagem-types';
import {
  getImagemVariacao,
  getNomeProduto,
  getSkuVariacao,
} from '../utils/embalagem-produto-helpers';
import EmbalagemControleQuantidade from './EmbalagemControleQuantidade';
import EmbalagemModalHistorico from './EmbalagemModalHistorico';
import EmbalagemModalKit from './EmbalagemModalKit';
import UICarregando from './UICarregando';
import UIBloqueio from './UIBloqueio';
import { mostrarPopupSemPermissao, temPermissao } from '../utils/bloqueio';
// @ts-expect-error popups sistêmicos legados, mantidos por compatibilidade visual.
import { mostrarConfirmacao, mostrarMensagem } from '/js/utils/popups.js';

type EmbalagemModalAba = 'unidade' | 'kit' | 'historico';

interface EmbalagemModalOpcoesProps {
  item: EmbalagemFilaItem;
  produtos: ProdutoCadastro[];
  saldoEstoque: EmbalagemEstoqueSaldo[];
  niveisEstoque: EmbalagemNivelEstoque[];
  onClose: () => void;
  onImpressaoIniciada?: (quantidade: number) => void;
  onImpressaoConcluida?: (resultado: ResultadoEmbalagem, quantidade: number) => void;
  onEmbalagemConcluida?: () => Promise<void> | void;
}

export default function EmbalagemModalOpcoes({
  item,
  produtos,
  saldoEstoque,
  niveisEstoque,
  onClose,
  onImpressaoIniciada,
  onImpressaoConcluida,
  onEmbalagemConcluida,
}: EmbalagemModalOpcoesProps) {
  const [aba, setAba] = useState<EmbalagemModalAba>('unidade');
  const [lotes, setLotes] = useState<EmbalagemArremateLote[]>([]);
  const [carregandoLotes, setCarregandoLotes] = useState(false);
  const [quantidade, setQuantidade] = useState<number | null>(1);
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);
  const [semEtiqueta, setSemEtiqueta] = useState(false);
  const [erroOperacao, setErroOperacao] = useState<string | null>(null);
  const [cnpjEmpresa, setCnpjEmpresa] = useState('');
  const [etiquetaDoKit, setEtiquetaDoKit] = useState<EtiquetaImpressao | null>(null);

  useEffect(() => {
    void obterCnpjEmpresaAtiva()
      .then(setCnpjEmpresa)
      .catch(() => setCnpjEmpresa(''));
  }, []);

  const etiquetaUnidade = useMemo(
    () => montarEtiquetaProduto(item.produto, item.variante, cnpjEmpresa),
    [cnpjEmpresa, item],
  );

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
    if (aba !== 'unidade') return;

    let ativo = true;
    setCarregandoLotes(true);
    setErroOperacao(null);

    void listarLotesParaEmbalagem(item)
      .then((resultado) => {
        if (ativo) setLotes(resultado);
      })
      .catch((error: unknown) => {
        if (ativo) {
          setErroOperacao(
            error instanceof Error
              ? error.message
              : 'Não foi possível carregar os lotes disponíveis.',
          );
        }
      })
      .finally(() => {
        if (ativo) setCarregandoLotes(false);
      });

    return () => {
      ativo = false;
    };
  }, [item, aba]);

  const totalDosLotes = useMemo(
    () =>
      lotes.reduce(
        (total, lote) =>
          total +
          Math.max(
            0,
            Number(lote.quantidade_arrematada || 0) -
              Number(lote.quantidade_ja_embalada || 0),
          ),
        0,
      ),
    [lotes],
  );

  useEffect(() => {
    if (aba !== 'unidade') return;

    setQuantidade((quantidadeAtual) =>
      totalDosLotes > 0
        ? Math.min(totalDosLotes, Math.max(1, quantidadeAtual ?? 0))
        : 0,
    );
  }, [aba, totalDosLotes]);

  const enviarEmbalagem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!temPermissao('lancar-embalagem')) {
      mostrarPopupSemPermissao('Você não tem permissão para registrar embalagens de produtos prontos.');
      return;
    }
    setErroOperacao(null);

    const quantidadeInformada = Number(quantidade);
    if (
      !Number.isInteger(quantidadeInformada) ||
      quantidadeInformada <= 0 ||
      quantidadeInformada > totalDosLotes
    ) {
      setErroOperacao('Informe uma quantidade inteira dentro do saldo disponível.');
      return;
    }

    if (semEtiqueta) {
      await estocarSemEtiqueta();
      return;
    }

    const confirmado = await mostrarConfirmacao(
      `Confirma a embalagem de <strong>${quantidadeInformada}</strong> ${quantidadeInformada === 1 ? 'unidade' : 'unidades'} de<br><strong>${nomeProduto} — ${item.variante}</strong>?`,
      {
        tipo: 'aviso',
        textoConfirmar: 'Embalar produto',
        textoCancelar: 'Cancelar',
      },
    );
    if (!confirmado) return;

    setEnviando(true);
    try {
      if (!etiquetaUnidade) {
        onImpressaoConcluida?.(mensagemEmbalagem({
          quantidade: quantidadeInformada,
          tipo: 'unidade',
          impresso: false,
          motivo: 'Esta variação não tem SKU para a etiqueta.',
        }), quantidadeInformada);
        return;
      }

      setImprimindo(true);
      onImpressaoIniciada?.(quantidadeInformada);
      try {
        await imprimirEtiqueta(etiquetaUnidade, quantidadeInformada);
      } catch (error: unknown) {
        onImpressaoConcluida?.(mensagemEmbalagem({
          quantidade: quantidadeInformada,
          tipo: 'unidade',
          impresso: false,
          motivo: error instanceof Error ? error.message : 'A impressão falhou.',
        }), quantidadeInformada);
        return;
      } finally {
        setImprimindo(false);
      }

      let registro;
      try {
        registro = await registrarEmbalagemUnitaria(
          item,
          lotes,
          quantidadeInformada,
          observacao,
        );
      } catch (error: unknown) {
        const motivo = error instanceof Error ? error.message : 'Não foi possível registrar a embalagem.';
        onImpressaoConcluida?.({
          impresso: true,
          titulo: quantidadeInformada === 1 ? '1 etiqueta adicionada' : `${quantidadeInformada} etiquetas adicionadas`,
          detalhe: `O estoque não foi atualizado. ${motivo}`,
        }, quantidadeInformada);
        return;
      }
      onImpressaoConcluida?.(
        registro.idempotente
          ? {
            impresso: true,
            titulo: quantidadeInformada === 1 ? '1 etiqueta adicionada' : `${quantidadeInformada} etiquetas adicionadas`,
            detalhe: 'Esta embalagem já estava registrada. Nenhuma unidade nova entrou no estoque.',
          }
          : mensagemEmbalagem({
            quantidade: quantidadeInformada,
            tipo: 'unidade',
            impresso: true,
          }),
        quantidadeInformada,
      );
      await onEmbalagemConcluida?.();
    } catch (error: unknown) {
      const mensagemErro =
        error instanceof Error
          ? error.message
          : 'Não foi possível registrar a embalagem.';
      setErroOperacao(mensagemErro);
      mostrarMensagem(mensagemErro, 'erro');
    } finally {
      setEnviando(false);
    }
  };

  const estocarSemEtiqueta = async () => {
    if (!temPermissao('lancar-embalagem')) {
      mostrarPopupSemPermissao('Você não tem permissão para registrar embalagens de produtos prontos.');
      return;
    }
    const quantidadeInformada = Number(quantidade);
    if (
      !Number.isInteger(quantidadeInformada) ||
      quantidadeInformada <= 0 ||
      quantidadeInformada > totalDosLotes
    ) {
      setErroOperacao('Informe uma quantidade inteira dentro do saldo disponível.');
      return;
    }
    const confirmado = await mostrarConfirmacao(
      `Estocar <strong>${quantidadeInformada}</strong> ${quantidadeInformada === 1 ? 'unidade' : 'unidades'} de<br><strong>${getNomeProduto(item.produto, item.nomeProduto)} — ${item.variante}</strong> sem imprimir etiqueta?`,
      {
        tipo: 'aviso',
        textoConfirmar: 'Estocar sem etiquetar',
        textoCancelar: 'Cancelar',
      },
    );
    if (!confirmado) return;

    setEnviando(true);
    setErroOperacao(null);
    try {
      await registrarEmbalagemUnitaria(item, lotes, quantidadeInformada, observacao);
      onImpressaoConcluida?.(
        mensagemEstoqueSemEtiqueta(quantidadeInformada, 'unidade'),
        quantidadeInformada,
      );
      await onEmbalagemConcluida?.();
    } catch (error: unknown) {
      const mensagemErro = error instanceof Error
        ? error.message
        : 'Não foi possível registrar a embalagem.';
      setErroOperacao(mensagemErro);
      mostrarMensagem(mensagemErro, 'erro');
    } finally {
      setEnviando(false);
    }
  };

  const nomeProduto = getNomeProduto(item.produto, item.nomeProduto);
  const abas: Array<{ id: EmbalagemModalAba; label: string; icon: string }> = [
    { id: 'unidade', label: 'Embalar unidades', icon: 'fa-box-open' },
    { id: 'kit', label: 'Montar e embalar kit', icon: 'fa-cubes' },
    { id: 'historico', label: 'Histórico', icon: 'fa-clock-rotate-left' },
  ];

  return (
    <div
      className="ep-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="ep-modal-opcoes"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ep-modal-titulo"
      >
        <header className="ep-modal-cabecalho">
          <div className="ep-modal-identidade">
            <img
              className="ep-modal-produto-imagem"
              src={getImagemVariacao(item.produto, item.variante)}
              alt=""
            />
            <div className="ep-modal-identidade-conteudo">
              <h2 id="ep-modal-titulo">{nomeProduto}</h2>
              <span className="ep-modal-variante">{item.variante}</span>
              <div className="ep-modal-metadados">
                <span>
                  <small>SKU</small>
                  <strong>{getSkuVariacao(item.produto, item.variante, item.sku)}</strong>
                </span>
                <span>
                  <small>Disponível</small>
                  <strong>{item.quantidadeDisponivel} un.</strong>
                </span>
              </div>
              <EmbalagemImpressora />
            </div>
          </div>
          <div className="ep-modal-etiqueta">
            <EmbalagemPreviewEtiqueta etiqueta={aba === 'kit' ? etiquetaDoKit : etiquetaUnidade} />
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar modal">
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <nav className="ep-modal-abas" role="tablist" aria-label="Operações do produto">
          {abas.map((itemAba) => (
            <button
              className={`ep-modal-aba${aba === itemAba.id ? ' ativo' : ''}`}
              id={`ep-modal-tab-${itemAba.id}`}
              key={itemAba.id}
              type="button"
              role="tab"
              aria-selected={aba === itemAba.id}
              aria-controls={`ep-modal-panel-${itemAba.id}`}
              onClick={() => {
                setAba(itemAba.id);
                setErroOperacao(null);
              }}
            >
              <i className={`fas ${itemAba.icon}`} aria-hidden="true" />
              <span>{itemAba.label}</span>
            </button>
          ))}
        </nav>

        <div
          id={`ep-modal-panel-${aba}`}
          className="ep-modal-painel-aba"
          role="tabpanel"
          aria-labelledby={`ep-modal-tab-${aba}`}
        >
          {aba === 'unidade' ? (
            <form className="ep-modal-formulario" onSubmit={enviarEmbalagem}>
              <div className="ep-modal-formulario-cabecalho">
                <div className="ep-modal-proxima-etapa-icone" aria-hidden="true">
                  <i className="fas fa-box-open" />
                </div>
                <div>
                  <h3>Embalar unidades</h3>
                  <p>
                    Os lotes mais antigos serão consumidos primeiro e a entrada
                    será registrada no estoque.
                  </p>
                </div>
              </div>

          {carregandoLotes ? (
            <UICarregando variante="bloco" />
          ) : (
                <>
                  <EmbalagemControleQuantidade
                    value={quantidade}
                    max={totalDosLotes}
                    onChange={setQuantidade}
                    disabled={enviando}
                    autoFocus
                  />
                  <label>
                    Observação <span>(opcional)</span>
                    <textarea
                      value={observacao}
                      onChange={(event) => setObservacao(event.target.value)}
                      rows={3}
                      maxLength={500}
                      disabled={enviando}
                    />
                  </label>
                  {erroOperacao ? (
                    <p className="ep-modal-erro" role="alert">
                      <i className="fas fa-circle-exclamation" aria-hidden="true" />
                      {erroOperacao}
                    </p>
                  ) : null}
                  <UIBloqueio
                    permissao="lancar-embalagem"
                    mensagem="Você não tem permissão para registrar embalagens de produtos prontos."
                  >
                    <div className="ep-modal-acoes">
                      <button
                        className="gs-btn gs-btn-primario ep-modal-confirmar"
                        type="submit"
                        disabled={enviando || carregandoLotes || totalDosLotes <= 0}
                      >
                        <i className="fas fa-box-open" aria-hidden="true" />
                        {imprimindo ? 'Imprimindo etiqueta...' : enviando ? 'Embalando...' : 'Embalar produto'}
                      </button>
                      <label className={`ep-sem-etiqueta${semEtiqueta ? ' ativo' : ''}`}>
                        <input
                          type="checkbox"
                          checked={semEtiqueta}
                          disabled={enviando}
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
          ) : aba === 'kit' ? (
            <EmbalagemModalKit
              item={item}
              produtos={produtos}
              saldoEstoque={saldoEstoque}
              niveisEstoque={niveisEstoque}
              cnpjEmpresa={cnpjEmpresa}
              onEtiquetaChange={setEtiquetaDoKit}
              onImpressaoIniciada={onImpressaoIniciada}
              onImpressaoConcluida={onImpressaoConcluida}
              onEmbalagemConcluida={onEmbalagemConcluida}
            />
          ) : (
            <EmbalagemModalHistorico
              item={item}
              produtos={produtos}
              cnpjEmpresa={cnpjEmpresa}
            />
          )}
        </div>
      </section>
    </div>
  );
}
