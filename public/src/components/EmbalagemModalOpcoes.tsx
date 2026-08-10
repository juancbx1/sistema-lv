import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
  onEmbalagemConcluida?: () => Promise<void> | void;
}

export default function EmbalagemModalOpcoes({
  item,
  produtos,
  saldoEstoque,
  niveisEstoque,
  onClose,
  onEmbalagemConcluida,
}: EmbalagemModalOpcoesProps) {
  const [aba, setAba] = useState<EmbalagemModalAba>('unidade');
  const [lotes, setLotes] = useState<EmbalagemArremateLote[]>([]);
  const [carregandoLotes, setCarregandoLotes] = useState(false);
  const [quantidade, setQuantidade] = useState<number | null>(1);
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroOperacao, setErroOperacao] = useState<string | null>(null);

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

    const confirmado = await mostrarConfirmacao(
      `Confirma a embalagem de <strong>${quantidadeInformada}</strong> ${quantidadeInformada === 1 ? 'unidade' : 'unidades'} de<br><strong>${nomeProduto} — ${item.variante}</strong>?`,
      {
        tipo: 'aviso',
        textoConfirmar: 'Embalar',
        textoCancelar: 'Cancelar',
      },
    );
    if (!confirmado) return;

    setEnviando(true);
    try {
      await registrarEmbalagemUnitaria(
        item,
        lotes,
        quantidadeInformada,
        observacao,
      );
      mostrarMensagem(
        `Embalagem concluída com sucesso: <strong>${quantidadeInformada}</strong> ${quantidadeInformada === 1 ? 'unidade' : 'unidades'} registrada${quantidadeInformada === 1 ? '' : 's'}.`,
        'sucesso',
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
            </div>
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
                    <button
                      className="gs-btn gs-btn-primario ep-modal-confirmar"
                      type="submit"
                      disabled={enviando || carregandoLotes || totalDosLotes <= 0}
                    >
                      <i className="fas fa-box-open" aria-hidden="true" />
                      {enviando ? 'Registrando...' : 'Registrar embalagem'}
                    </button>
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
              onEmbalagemConcluida={onEmbalagemConcluida}
            />
          ) : (
            <EmbalagemModalHistorico item={item} />
          )}
        </div>
      </section>
    </div>
  );
}
