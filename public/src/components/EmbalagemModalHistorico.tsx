import { useCallback, useEffect, useState } from 'react';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UICarregando from './UICarregando';
import { listarHistoricoEmbalagem } from '../utils/embalagem-api';
import { montarEtiquetaProduto } from '../utils/etiqueta-embalagem';
import { imprimirEtiqueta } from '../utils/printnow-agente';
import type {
  EmbalagemFilaItem,
  EmbalagemHistoricoItem,
  ProdutoCadastro,
} from '../utils/embalagem-types';
// @ts-expect-error popups sistêmicos legados, mantidos por compatibilidade visual.
import { mostrarMensagem } from '/js/utils/popups.js';

interface EmbalagemModalHistoricoProps {
  item: EmbalagemFilaItem;
  produtos: ProdutoCadastro[];
  cnpjEmpresa: string;
}

function toNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatarData(value: unknown): string {
  if (!value) return 'Data não informada';

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return 'Data não informada';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function getTipoLabel(item: EmbalagemHistoricoItem): string {
  const tipo = String(item.tipo_embalagem || '').toUpperCase();
  return tipo === 'KIT' ? 'Montagem de kit' : 'Embalagem de unidade';
}

function getResponsavel(item: EmbalagemHistoricoItem): string {
  return item.usuario_responsavel || 'Usuário não identificado';
}

export default function EmbalagemModalHistorico({
  item,
  produtos,
  cnpjEmpresa,
}: EmbalagemModalHistoricoProps) {
  const [registros, setRegistros] = useState<EmbalagemHistoricoItem[]>([]);
  const [pagina, setPagina] = useState(1);
  const [paginas, setPaginas] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [reimprimindoId, setReimprimindoId] = useState<number | string | null>(null);

  const reimprimir = async (registro: EmbalagemHistoricoItem) => {
    const quantidade = toNumber(registro.quantidade_embalada);
    const produto = produtos.find(
      (candidato) => String(candidato.id) === String(registro.produto_embalado_id),
    ) || (String(registro.tipo_embalagem || '').toUpperCase() === 'UNIDADE' ? item.produto : null);
    const etiqueta = montarEtiquetaProduto(
      produto,
      registro.variante_embalada_nome || item.variante,
      cnpjEmpresa,
    );

    if (!etiqueta || quantidade <= 0) {
      mostrarMensagem('Não há SKU desta embalagem para reimprimir a etiqueta.', 'erro');
      return;
    }

    setReimprimindoId(registro.id);
    try {
      await imprimirEtiqueta(etiqueta, quantidade);
      mostrarMensagem(
        `Etiquetas reenviadas: <strong>${quantidade}</strong>. O estoque não foi alterado.`,
        'sucesso',
      );
    } catch (error: unknown) {
      mostrarMensagem(
        error instanceof Error ? error.message : 'Não foi possível reimprimir as etiquetas.',
        'erro',
      );
    } finally {
      setReimprimindoId(null);
    }
  };

  const carregarHistorico = useCallback(async () => {
    setCarregando(true);
    setErro(null);

    try {
      const resposta = await listarHistoricoEmbalagem(item, pagina);
      setRegistros(Array.isArray(resposta.rows) ? resposta.rows : []);
      setPaginas(Math.max(1, toNumber(resposta.pages) || 1));
    } catch (error: unknown) {
      setErro(
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar o histórico de embalagens.',
      );
      setRegistros([]);
    } finally {
      setCarregando(false);
    }
  }, [item, pagina]);

  useEffect(() => {
    void carregarHistorico();
  }, [carregarHistorico]);

  return (
    <div className="ep-modal-historico">
      <div className="ep-modal-formulario-cabecalho">
        <div className="ep-modal-proxima-etapa-icone" aria-hidden="true">
          <i className="fas fa-clock-rotate-left" />
        </div>
        <div>
          <h3>Histórico de embalagens</h3>
          <p>Consulte os registros de saída desta variação.</p>
        </div>
      </div>

      {carregando ? (
        <UICarregando variante="bloco" />
      ) : erro ? (
        <div className="ep-modal-historico-erro" role="alert">
          <i className="fas fa-circle-exclamation" aria-hidden="true" />
          <span>{erro}</span>
          <button className="gs-btn gs-btn-secundario" type="button" onClick={() => void carregarHistorico()}>
            Tentar novamente
          </button>
        </div>
      ) : registros.length === 0 ? (
        <UIFeedbackNotFound
          icon="fa-clock-rotate-left"
          titulo="Nenhum registro encontrado"
          mensagem="As embalagens desta variação aparecerão aqui depois do primeiro registro."
          variante="compacto"
        />
      ) : (
        <div className="ep-modal-historico-lista">
          {registros.map((registro) => (
            <article className="ep-modal-historico-item" key={registro.id}>
              <div className="ep-modal-historico-item-icone" aria-hidden="true">
                <i className={`fas ${String(registro.tipo_embalagem || '').toUpperCase() === 'KIT' ? 'fa-cubes' : 'fa-box-open'}`} />
              </div>
              <div className="ep-modal-historico-item-conteudo">
                <div className="ep-modal-historico-item-topo">
                  <div>
                    <strong>{getTipoLabel(registro)}</strong>
                    {registro.tipo_embalagem === 'KIT' && registro.produto_embalado_nome ? (
                      <small className="ep-modal-historico-item-subtitulo">
                        {registro.produto_embalado_nome}
                        {registro.variante_embalada_nome ? ` · ${registro.variante_embalada_nome}` : ''}
                      </small>
                    ) : null}
                  </div>
                  <time dateTime={registro.data_embalagem || undefined}>
                    {formatarData(registro.data_embalagem)}
                  </time>
                </div>
                <div className="ep-modal-historico-item-detalhes">
                  <span>
                    <small>Quantidade</small>
                    <b>{toNumber(registro.quantidade_embalada)} un.</b>
                  </span>
                  <span>
                    <small>Responsável</small>
                    <b>{getResponsavel(registro)}</b>
                  </span>
                  {registro.status ? (
                    <span>
                      <small>Status</small>
                      <b>{registro.status}</b>
                    </span>
                  ) : null}
                </div>
                {registro.observacao ? (
                  <p className="ep-modal-historico-item-observacao">
                    {registro.observacao}
                  </p>
                ) : null}
                {String(registro.status || 'ATIVO').toUpperCase() === 'ATIVO'
                  && toNumber(registro.quantidade_embalada) > 0 ? (
                  <button
                    className="gs-btn gs-btn-secundario ep-etiqueta-reimprimir"
                    type="button"
                    onClick={() => void reimprimir(registro)}
                    disabled={reimprimindoId === registro.id}
                  >
                    <i className="fas fa-print" aria-hidden="true" />
                    {reimprimindoId === registro.id ? 'Imprimindo...' : 'Reimprimir etiquetas'}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {!carregando && !erro && paginas > 1 ? (
        <nav className="ep-modal-historico-paginacao" aria-label="Paginação do histórico">
          <button
            className="gs-btn gs-btn-secundario"
            type="button"
            onClick={() => setPagina((atual) => Math.max(1, atual - 1))}
            disabled={pagina <= 1}
          >
            <i className="fas fa-chevron-left" aria-hidden="true" />
            Anterior
          </button>
          <span>Página {pagina} de {paginas}</span>
          <button
            className="gs-btn gs-btn-secundario"
            type="button"
            onClick={() => setPagina((atual) => Math.min(paginas, atual + 1))}
            disabled={pagina >= paginas}
          >
            Próxima
            <i className="fas fa-chevron-right" aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </div>
  );
}
