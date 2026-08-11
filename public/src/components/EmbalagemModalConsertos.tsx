import { useEffect, useState } from 'react';
import {
  converterConsertoEmAvaria,
  listarConsertosPendentes,
  retornarProdutoDoConserto,
} from '../utils/embalagem-api';
import type { EmbalagemOcorrenciaConserto } from '../utils/embalagem-types';
import UICarregando from './UICarregando';
import UIBloqueio from './UIBloqueio';
// @ts-expect-error popups sistêmicos legados, mantidos por compatibilidade visual.
import { mostrarConfirmacao, mostrarMensagem } from '/js/utils/popups.js';

interface EmbalagemModalConsertosProps {
  onClose: () => void;
  onAtualizado?: () => Promise<void> | void;
}

function numero(value: unknown): number {
  const resultado = Number(value);
  return Number.isFinite(resultado) ? resultado : 0;
}

function dataHora(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EmbalagemModalConsertos({
  onClose,
  onAtualizado,
}: EmbalagemModalConsertosProps) {
  const [items, setItems] = useState<EmbalagemOcorrenciaConserto[]>([]);
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [observacoes, setObservacoes] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [processandoId, setProcessandoId] = useState<string | null>(null);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resultado = await listarConsertosPendentes();
        setItems(resultado);
        setQuantidades((anteriores) => {
          const proximas = { ...anteriores };
          resultado.forEach((item) => {
            const id = String(item.id);
            const pendente = numero(item.quantidade_em_conserto);
            const anterior = Number(proximas[id]);
            proximas[id] = Number.isInteger(anterior) && anterior > 0
              ? String(Math.min(anterior, pendente))
              : String(pendente);
          });
          return proximas;
        });
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível carregar os consertos pendentes.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    void carregar();
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

  const obterQuantidade = (item: EmbalagemOcorrenciaConserto): number => {
    const valor = Number(quantidades[String(item.id)]);
    return Number.isInteger(valor) && valor > 0 ? valor : 0;
  };

  const retornar = async (item: EmbalagemOcorrenciaConserto) => {
    const id = String(item.id);
    const quantidade = obterQuantidade(item);
    if (!quantidade || quantidade > numero(item.quantidade_em_conserto)) {
      setErro('Informe uma quantidade válida para o retorno.');
      return;
    }
    const confirmou = await mostrarConfirmacao(
      `Retornar <strong>${quantidade}</strong> unidade(s) de <strong>${item.produto_nome || 'produto'}</strong> para a fila de Embalagem?`,
      {
        tipo: 'aviso',
        textoConfirmar: 'Retornar à Embalagem',
        textoCancelar: 'Cancelar',
      },
    );
    if (!confirmou) return;
    setProcessandoId(`${id}:retorno`);
    setErro(null);
    try {
      await retornarProdutoDoConserto(id, quantidade, observacoes[id] || '');
      mostrarMensagem('Produto retornado à fila de Embalagem.', 'sucesso');
      await carregar();
      await onAtualizado?.();
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : 'Não foi possível retornar o produto.';
      setErro(mensagem);
      mostrarMensagem(mensagem, 'erro');
    } finally {
      setProcessandoId(null);
    }
  };

  const converter = async (item: EmbalagemOcorrenciaConserto) => {
    const id = String(item.id);
    const quantidade = obterQuantidade(item);
    if (!quantidade || quantidade > numero(item.quantidade_em_conserto)) {
      setErro('Informe uma quantidade válida para converter em avaria.');
      return;
    }
    const confirmou = await mostrarConfirmacao(
      `Encerrar <strong>${quantidade}</strong> unidade(s) de <strong>${item.produto_nome || 'produto'}</strong> como produto avariado?`,
      {
        tipo: 'aviso',
        textoConfirmar: 'Converter em avaria',
        textoCancelar: 'Cancelar',
      },
    );
    if (!confirmou) return;
    setProcessandoId(`${id}:avaria`);
    setErro(null);
    try {
      await converterConsertoEmAvaria(id, quantidade, observacoes[id] || '');
      mostrarMensagem('Conserto encerrado como produto avariado.', 'sucesso');
      await carregar();
      await onAtualizado?.();
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : 'Não foi possível converter o conserto em avaria.';
      setErro(mensagem);
      mostrarMensagem(mensagem, 'erro');
    } finally {
      setProcessandoId(null);
    }
  };

  return (
    <div
      className="ep-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="ep-modal-opcoes ep-modal-consertos"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ep-modal-consertos-titulo"
      >
        <header className="ep-modal-cabecalho">
          <div>
            <span className="ep-modal-kicker">Quarentena da Embalagem</span>
            <h2 id="ep-modal-consertos-titulo">Consertos pendentes</h2>
            <p>O retorno não cria novos pontos nem altera a produção original.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar consertos">
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className="ep-consertos-corpo">
          {carregando ? (
            <UICarregando variante="bloco" texto="Carregando consertos pendentes..." />
          ) : erro ? (
            <div className="ep-fila-estado ep-fila-erro" role="alert">
              <i className="fas fa-circle-exclamation" aria-hidden="true" />
              <strong>Não foi possível carregar os consertos.</strong>
              <p>{erro}</p>
              <button className="gs-btn gs-btn-secundario" type="button" onClick={() => void carregar()}>
                Tentar novamente
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="ep-modal-estado-vazio">
              <i className="fas fa-screwdriver-wrench" aria-hidden="true" />
              <strong>Nenhum conserto pendente.</strong>
              <p>As peças enviadas para conserto aparecerão nesta fila.</p>
            </div>
          ) : (
            <div className="ep-consertos-lista">
              {items.map((item) => {
                const id = String(item.id);
                const quantidadePendente = numero(item.quantidade_em_conserto);
                const processando = processandoId?.startsWith(`${id}:`) || false;
                return (
                  <article className="ep-conserto-card" key={id}>
                    <div className="ep-conserto-card-cabecalho">
                      <div>
                        <span className="ep-conserto-badge">
                          <i className="fas fa-screwdriver-wrench" aria-hidden="true" /> Em conserto
                        </span>
                        <h3>{item.produto_nome || 'Produto não encontrado'}</h3>
                        <p>{item.variante || '-'} {item.op_numero ? `· OP ${item.op_numero}` : ''}</p>
                      </div>
                      <strong>{quantidadePendente} un.</strong>
                    </div>
                    <div className="ep-conserto-card-detalhes">
                      <span>Enviado em {dataHora(item.criado_em)}</span>
                      <span>Por {item.usuario_responsavel_nome || 'Sistema'}</span>
                    </div>
                    <p className="ep-conserto-observacao">{item.observacao || 'Sem observação.'}</p>
                    <label>
                      Quantidade desta ação
                      <input
                        type="number"
                        min="1"
                        max={quantidadePendente}
                        step="1"
                        value={quantidades[id] || String(quantidadePendente)}
                        onChange={(event) => setQuantidades((anteriores) => ({
                          ...anteriores,
                          [id]: event.target.value,
                        }))}
                        disabled={processando}
                      />
                    </label>
                    <label>
                      Observação da ação <span>(opcional)</span>
                      <textarea
                        rows={2}
                        maxLength={500}
                        value={observacoes[id] || ''}
                        onChange={(event) => setObservacoes((anteriores) => ({
                          ...anteriores,
                          [id]: event.target.value,
                        }))}
                        disabled={processando}
                      />
                    </label>
                    <div className="ep-conserto-acoes">
                      <UIBloqueio
                        permissao={['lancar-embalagem', 'registrar-ocorrencia-embalagem']}
                        mensagem="Você não tem permissão para administrar consertos da Embalagem."
                      >
                        <button
                          className="gs-btn gs-btn-primario"
                          type="button"
                          onClick={() => void retornar(item)}
                          disabled={processando}
                        >
                          <i className="fas fa-rotate-left" aria-hidden="true" />
                          {processandoId === `${id}:retorno` ? 'Retornando...' : 'Retornar à Embalagem'}
                        </button>
                      </UIBloqueio>
                      <UIBloqueio
                        permissao={['lancar-embalagem', 'registrar-ocorrencia-embalagem']}
                        mensagem="Você não tem permissão para encerrar consertos da Embalagem."
                      >
                        <button
                          className="gs-btn gs-btn-secundario ep-conserto-avaria"
                          type="button"
                          onClick={() => void converter(item)}
                          disabled={processando}
                        >
                          <i className="fas fa-triangle-exclamation" aria-hidden="true" />
                          {processandoId === `${id}:avaria` ? 'Encerrando...' : 'Converter em avaria'}
                        </button>
                      </UIBloqueio>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <footer className="ep-modal-rodape">
          <button className="gs-btn gs-btn-secundario" type="button" onClick={onClose}>
            Fechar
          </button>
        </footer>
      </section>
    </div>
  );
}
