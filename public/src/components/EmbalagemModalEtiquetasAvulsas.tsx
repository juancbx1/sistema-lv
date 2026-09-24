import { useEffect, useMemo, useState } from 'react';
import { EmbalagemPreviewEtiqueta } from './EmbalagemEtiqueta';
import UIFeedbackNotFound from './UIFeedbackNotFound';
// @ts-expect-error popups sistêmicos legados, mantidos por compatibilidade visual.
import { mostrarConfirmacao } from '/js/utils/popups.js';
import { registrarEntradaAvulsa } from '../utils/embalagem-api';
import { montarEtiquetaProduto } from '../utils/etiqueta-embalagem';
import {
  mensagemEmbalagem,
  mensagemSoImpressao,
  type ResultadoEmbalagem,
} from '../utils/etiqueta-resultado';
import { imprimirEtiqueta, obterCnpjEmpresaAtiva } from '../utils/printnow-agente';
import { getImagemVariacao, getNomeProduto } from '../utils/embalagem-produto-helpers';
import type { ProdutoCadastro } from '../utils/embalagem-types';

interface EtiquetaAvulsaItem {
  chave: string;
  produto: ProdutoCadastro;
  nome: string;
  variante: string;
  sku: string;
  imagem: string | null;
}

interface ProdutoEtiquetaGrupo {
  id: string;
  nome: string;
  imagem: string | null;
  itens: EtiquetaAvulsaItem[];
}

interface EmbalagemModalEtiquetasAvulsasProps {
  produtos: ProdutoCadastro[];
  onClose: () => void;
  onImpressaoIniciada: (quantidade: number) => void;
  onImpressaoConcluida: (resultado: ResultadoEmbalagem, quantidade: number) => void;
  onEstoqueAtualizado: () => Promise<void> | void;
}

function normalizarBusca(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function palavrasBusca(valor: string): string[] {
  return normalizarBusca(valor).split(/[^a-z0-9]+/).filter(Boolean);
}

function combinaBusca(textos: string[], busca: string): boolean {
  const termos = palavrasBusca(busca).sort((a, b) => b.length - a.length);
  if (termos.length === 0) return true;
  const disponiveis = palavrasBusca(textos.join(' '));
  const usadas = new Set<number>();
  return termos.every((termo) => {
    const indice = disponiveis.findIndex((palavra, posicao) => (
      !usadas.has(posicao) && (palavra === termo || palavra.startsWith(termo))
    ));
    if (indice < 0) return false;
    usadas.add(indice);
    return true;
  });
}

function nomeDoProduto(produto: ProdutoCadastro): string {
  const nome = String(produto.nome || produto.nome_produto || '').trim();
  return nome || getNomeProduto(produto);
}

function montarGrupos(produtos: ProdutoCadastro[]): ProdutoEtiquetaGrupo[] {
  return produtos.map((produto) => {
    const nome = nomeDoProduto(produto);
    const grade = Array.isArray(produto.grade) ? produto.grade : [];
    const itens: EtiquetaAvulsaItem[] = [];
    if (grade.length === 0) {
      const sku = String(produto.sku || '').trim();
      if (sku) {
        itens.push({
          chave: `${produto.id}:-`,
          produto,
          nome,
          variante: '-',
          sku,
          imagem: produto.imagem || null,
        });
      }
    } else {
      grade.forEach((item, indice) => {
        const sku = String(item.sku || '').trim();
        if (!sku) return;
        const variante = String(item.variacao || '-');
        itens.push({
          chave: `${produto.id}:${variante}:${indice}`,
          produto,
          nome,
          variante,
          sku,
          imagem: getImagemVariacao(produto, variante) || produto.imagem || null,
        });
      });
    }
    itens.sort((a, b) => a.variante.localeCompare(b.variante, 'pt-BR'));
    return {
      id: String(produto.id),
      nome,
      imagem: produto.imagem || itens.find((item) => item.imagem)?.imagem || null,
      itens,
    };
  }).filter((grupo) => grupo.itens.length > 0)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export default function EmbalagemModalEtiquetasAvulsas({
  produtos,
  onClose,
  onImpressaoIniciada,
  onImpressaoConcluida,
  onEstoqueAtualizado,
}: EmbalagemModalEtiquetasAvulsasProps) {
  const [busca, setBusca] = useState('');
  const [produtoAberto, setProdutoAberto] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [quantidade, setQuantidade] = useState(1);
  const [modo, setModo] = useState<'imprimir' | 'estoque' | null>(null);
  const [cnpjEmpresa, setCnpjEmpresa] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    void obterCnpjEmpresaAtiva().then(setCnpjEmpresa).catch(() => setCnpjEmpresa(''));
  }, []);

  const grupos = useMemo(() => montarGrupos(produtos), [produtos]);
  const termo = normalizarBusca(busca.trim());
  const variacoesEncontradas = useMemo(() => {
    if (!termo) return [];
    return grupos.flatMap((grupo) => grupo.itens.filter((item) => (
      combinaBusca([grupo.nome, item.variante, item.sku], termo)
    )));
  }, [grupos, termo]);
  const grupoAberto = grupos.find((grupo) => grupo.id === produtoAberto) || null;
  const itens = grupos.flatMap((grupo) => grupo.itens);
  const atual = itens.find((item) => item.chave === selecionado) || null;
  const etiqueta = atual
    ? montarEtiquetaProduto(atual.produto, atual.variante, cnpjEmpresa)
    : null;

  const enviar = async () => {
    if (!atual || !etiqueta || !modo || quantidade < 1) return;
    const destino = modo === 'estoque'
      ? 'imprimir a etiqueta e enviar para o estoque'
      : 'somente imprimir a etiqueta';
    const confirmado = await mostrarConfirmacao(
      `Confirmar antes de enviar?<br><strong>${destino}</strong><br>${quantidade} ${quantidade === 1 ? 'etiqueta' : 'etiquetas'} de <strong>${atual.nome} — ${atual.variante === '-' ? 'Padrão' : atual.variante}</strong>.`,
      {
        tipo: 'aviso',
        textoConfirmar: 'Enviar',
        textoCancelar: 'Voltar',
      },
    );
    if (!confirmado) return;

    setEnviando(true);
    onImpressaoIniciada(quantidade);
    try {
      await imprimirEtiqueta(etiqueta, quantidade);
    } catch (error: unknown) {
      onImpressaoConcluida(mensagemEmbalagem({
        quantidade,
        tipo: 'unidade',
        impresso: false,
        motivo: error instanceof Error ? error.message : 'A impressão falhou.',
      }), quantidade);
      setEnviando(false);
      return;
    }

    if (modo === 'imprimir') {
      onImpressaoConcluida(mensagemSoImpressao(quantidade), quantidade);
      setEnviando(false);
      return;
    }

    try {
      await registrarEntradaAvulsa({
        produtoId: atual.produto.id,
        variante: atual.variante,
        sku: atual.sku,
        quantidade,
      });
      onImpressaoConcluida(mensagemEmbalagem({
        quantidade,
        tipo: 'unidade',
        impresso: true,
      }), quantidade);
      await onEstoqueAtualizado();
    } catch (error: unknown) {
      const motivo = error instanceof Error ? error.message : 'Não foi possível registrar o estoque.';
      onImpressaoConcluida({
        impresso: true,
        tom: 'falha',
        titulo: quantidade === 1 ? '1 etiqueta impressa' : `${quantidade} etiquetas impressas`,
        detalhe: `O estoque não foi atualizado. ${motivo}`,
      }, quantidade);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="ep-modal-overlay ep-avulsa-overlay" role="presentation">
      <section
        className="ep-modal-opcoes ep-avulsa"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ep-avulsa-titulo"
      >
        <header className="ep-avulsa-cabecalho">
          <div>
            <h2 id="ep-avulsa-titulo">Etiquetas avulsas</h2>
            <p>Para um material que não está na fila. A escolha é conferida antes de enviar.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar etiquetas avulsas">
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </header>

        <div className="ep-avulsa-corpo">
          <div className="ep-avulsa-lista">
            <label className="ep-avulsa-busca">
              <i className="fas fa-search" aria-hidden="true" />
              <input
                type="search"
                value={busca}
                onChange={(event) => {
                  setBusca(event.target.value);
                  setProdutoAberto(null);
                }}
                placeholder="Buscar produto, variação ou SKU"
              />
            </label>
            {grupoAberto ? (
              <button
                className="ep-avulsa-voltar"
                type="button"
                onClick={() => setProdutoAberto(null)}
              >
                <i className="fas fa-arrow-left" aria-hidden="true" />
                {grupoAberto.nome}
              </button>
            ) : null}
            {termo ? (
              variacoesEncontradas.length === 0 ? (
                <UIFeedbackNotFound
                  icon="fa-box-open"
                  titulo="Nenhuma variação encontrada"
                  mensagem="A busca olha o nome da variação, a cor e o SKU."
                  variante="compacto"
                />
              ) : (
                <ul>
                  {variacoesEncontradas.map((item) => (
                    <li key={item.chave}>
                      <button
                        type="button"
                        className={item.chave === selecionado ? 'ativo' : ''}
                        onClick={() => setSelecionado(item.chave)}
                      >
                        {item.imagem ? <img src={item.imagem} alt="" /> : <span className="ep-avulsa-sem-foto" />}
                        <span>
                          <strong>{item.variante === '-' ? 'Padrão' : item.variante}</strong>
                          <small>{item.nome}</small>
                          <em>{item.sku}</em>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (grupoAberto ? grupoAberto.itens : grupos).length === 0 ? (
              <UIFeedbackNotFound
                icon="fa-box-open"
                titulo="Nenhum produto encontrado"
                mensagem="A busca também encontra variação, cor e SKU."
                variante="compacto"
              />
            ) : grupoAberto ? (
              <ul>
                {grupoAberto.itens.map((item) => (
                  <li key={item.chave}>
                    <button
                      type="button"
                      className={item.chave === selecionado ? 'ativo' : ''}
                      onClick={() => setSelecionado(item.chave)}
                    >
                      {item.imagem ? <img src={item.imagem} alt="" /> : <span className="ep-avulsa-sem-foto" />}
                      <span>
                        <strong>{item.variante === '-' ? 'Padrão' : item.variante}</strong>
                        <em>{item.sku}</em>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <ul>
                {grupos.map((grupo) => (
                  <li key={grupo.id}>
                    <button type="button" onClick={() => setProdutoAberto(grupo.id)}>
                      {grupo.imagem ? <img src={grupo.imagem} alt="" /> : <span className="ep-avulsa-sem-foto" />}
                      <span>
                        <strong>{grupo.nome}</strong>
                        <small>{grupo.itens.length === 1 ? '1 variação' : `${grupo.itens.length} variações`}</small>
                      </span>
                      <i className="fas fa-chevron-right" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="ep-avulsa-painel">
            {atual && etiqueta ? (
              <>
                <EmbalagemPreviewEtiqueta etiqueta={etiqueta} />
                <label className="ep-avulsa-quantidade">
                  Quantidade
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={quantidade}
                    disabled={enviando}
                    onChange={(event) => setQuantidade(Math.max(1, Number(event.target.value) || 1))}
                  />
                </label>
                <fieldset className="ep-avulsa-modos" disabled={enviando}>
                  <legend>O que enviar</legend>
                  <label className={modo === 'imprimir' ? 'ativo' : ''}>
                    <input
                      type="radio"
                      name="modo-etiqueta-avulsa"
                      checked={modo === 'imprimir'}
                      onChange={() => setModo('imprimir')}
                    />
                    <span>Só imprimir a etiqueta</span>
                  </label>
                  <label className={modo === 'estoque' ? 'ativo' : ''}>
                    <input
                      type="radio"
                      name="modo-etiqueta-avulsa"
                      checked={modo === 'estoque'}
                      onChange={() => setModo('estoque')}
                    />
                    <span>Imprimir a etiqueta e enviar para o estoque</span>
                  </label>
                </fieldset>
                <button
                  className="gs-btn gs-btn-primario"
                  type="button"
                  disabled={enviando || !modo}
                  onClick={() => void enviar()}
                >
                  Continuar
                </button>
              </>
            ) : (
              <UIFeedbackNotFound
                icon="fa-print"
                titulo="Escolha um produto"
                mensagem="A etiqueta aparece aqui, no mesmo formato da embalagem."
                variante="compacto"
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
