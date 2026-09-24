import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
// @ts-expect-error Popup compartilhado legado.
import { mostrarConfirmacao } from '/js/utils/popups.js';
import UIHeaderPagina from './UIHeaderPagina';
import { mostrarPopupSemPermissao } from '../utils/bloqueio';
import { registrarSaidaEstoqueEmLote } from '../utils/estoque-api';
import type { ItemEstoque } from '../utils/estoque-types';

type Marketplace = 'Shopee' | 'Shein' | 'TikTok Shop';

interface SeparacaoPageProps {
  itens: ItemEstoque[];
  podeGerenciar: boolean;
  onVoltar: () => void;
  onConcluida: () => Promise<void>;
}

interface UltimoLancamento {
  chave: string;
  sku: string;
  quantidade: number;
}

interface GrupoProduto {
  id: string;
  nome: string;
  imagem: string;
  sku: string;
  itens: ItemEstoque[];
  saldoTotal: number;
  quantidadeLancada: number;
  variacoesDisponiveis: number;
}

const MARKETPLACES: Array<{ id: Marketplace; sigla: string; descricao: string }> = [
  { id: 'Shopee', sigla: 'S', descricao: 'Organizar saídas da Shopee' },
  { id: 'Shein', sigla: 'SH', descricao: 'Organizar saídas da Shein' },
  { id: 'TikTok Shop', sigla: 'T', descricao: 'Organizar saídas do TikTok Shop' },
];

function textoNormalizado(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

function chaveItem(item: ItemEstoque): string {
  return `${item.produto_id}|${item.variante_nome || '-'}`;
}

function tipoOperacao(marketplace: Marketplace): string {
  if (marketplace === 'Shopee') return 'SAIDA_PEDIDO_SHOPEE';
  if (marketplace === 'Shein') return 'SAIDA_PEDIDO_SHEIN';
  return 'SAIDA_PEDIDO_TIKTOK_SHOP';
}

function novaChaveIdempotencia(): string {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `separacao-${uuid}`;
}

function mensagemLancamento(sku: string, quantidade: number): string {
  const unidade = quantidade === 1 ? 'unidade' : 'unidades';
  const participio = quantidade === 1 ? 'adicionada' : 'adicionadas';
  return `${sku}: +${quantidade} ${unidade} ${participio} à sessão.`;
}

function nomeMarketplace(marketplace: Marketplace): string {
  return marketplace === 'TikTok Shop' ? 'TikTok Shop' : marketplace;
}

export default function SeparacaoPage({ itens, podeGerenciar, onVoltar, onConcluida }: SeparacaoPageProps) {
  const [marketplace, setMarketplace] = useState<Marketplace>('Shopee');
  const [quantidadePedidos, setQuantidadePedidos] = useState(0);
  const [busca, setBusca] = useState('');
  const [produtoSelecionadoId, setProdutoSelecionadoId] = useState<string | null>(null);
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [ultimoLancamento, setUltimoLancamento] = useState<UltimoLancamento | null>(null);
  const [mensagem, setMensagem] = useState('Sessão Shopee aberta.');
  const [erro, setErro] = useState<string | null>(null);
  const [revisaoAberta, setRevisaoAberta] = useState(false);
  const [confirmouConferencia, setConfirmouConferencia] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);
  const revisaoRef = useRef<HTMLElement>(null);

  const itensCatalogo = useMemo(() => [...itens]
    .sort((a, b) => a.produto_nome.localeCompare(b.produto_nome, 'pt-BR')
      || String(a.variante_nome || '-').localeCompare(String(b.variante_nome || '-'), 'pt-BR')),
  [itens]);

  const saldoRestante = (item: ItemEstoque): number => Math.max(0, item.saldo - (quantidades[chaveItem(item)] || 0));

  const gruposProdutos = useMemo<GrupoProduto[]>(() => {
    const grupos = new Map<string, GrupoProduto>();

    for (const item of itensCatalogo) {
      const id = String(item.produto_id);
      const quantidadeLancada = quantidades[chaveItem(item)] || 0;
      const grupoAtual = grupos.get(id);
      if (grupoAtual) {
        grupoAtual.itens.push(item);
        grupoAtual.saldoTotal += saldoRestante(item);
        grupoAtual.quantidadeLancada += quantidadeLancada;
        if (saldoRestante(item) > 0) grupoAtual.variacoesDisponiveis += 1;
        continue;
      }

      grupos.set(id, {
        id,
        nome: item.produto_nome,
        imagem: item.imagem,
        sku: String(item.produto?.sku || ''),
        itens: [item],
        saldoTotal: saldoRestante(item),
        quantidadeLancada,
        variacoesDisponiveis: saldoRestante(item) > 0 ? 1 : 0,
      });
    }

    return [...grupos.values()]
      .filter((grupo) => grupo.saldoTotal > 0 || grupo.quantidadeLancada > 0)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [itensCatalogo, quantidades]);

  const produtoSelecionado = useMemo(
    () => gruposProdutos.find((grupo) => grupo.id === produtoSelecionadoId) || null,
    [gruposProdutos, produtoSelecionadoId],
  );

  const produtosVisiveis = useMemo(() => {
    const termo = textoNormalizado(busca);
    if (!termo) return gruposProdutos;
    return gruposProdutos.filter((grupo) => grupo.itens.some((item) => textoNormalizado(
      `${grupo.nome} ${grupo.sku} ${item.variante_nome || ''} ${item.produto_ref_id}`,
    ).includes(termo)));
  }, [busca, gruposProdutos]);

  const variantesVisiveis = useMemo(() => {
    if (!produtoSelecionado) return [];
    const termo = textoNormalizado(busca);
    return produtoSelecionado.itens
      .filter((item) => saldoRestante(item) > 0 || (quantidades[chaveItem(item)] || 0) > 0)
      .filter((item) => !termo || textoNormalizado(
        `${item.variante_nome || ''} ${item.produto_ref_id}`,
      ).includes(termo));
  }, [busca, produtoSelecionado, quantidades]);

  const linhasLancadas = useMemo(() => itensCatalogo
    .map((item) => ({ item, chave: chaveItem(item), quantidade: quantidades[chaveItem(item)] || 0 }))
    .filter((linha) => linha.quantidade > 0),
  [itensCatalogo, quantidades]);

  const totalUnidades = linhasLancadas.reduce((total, linha) => total + linha.quantidade, 0);

  useEffect(() => {
    if (!revisaoAberta) return undefined;
    revisaoRef.current?.focus();
    const fecharComEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setRevisaoAberta(false);
    };
    document.addEventListener('keydown', fecharComEscape);
    return () => document.removeEventListener('keydown', fecharComEscape);
  }, [revisaoAberta]);

  const resetarSessao = (proximaMarketplace = marketplace) => {
    setMarketplace(proximaMarketplace);
    setQuantidadePedidos(0);
    setBusca('');
    setProdutoSelecionadoId(null);
    setQuantidades({});
    setUltimoLancamento(null);
    setRevisaoAberta(false);
    setConfirmouConferencia(false);
    setErro(null);
    setMensagem(`Sessão ${nomeMarketplace(proximaMarketplace)} aberta.`);
  };

  const trocarMarketplace = async (proximo: Marketplace) => {
    if (proximo === marketplace) return;
    if (linhasLancadas.length > 0) {
      const confirmado = await mostrarConfirmacao(
        'Há lançamentos nesta sessão. Trocar de marketplace descartará a sessão atual. Deseja continuar?',
        'aviso',
      );
      if (!confirmado) return;
    }
    resetarSessao(proximo);
  };

  const novaSessao = async () => {
    if (linhasLancadas.length === 0) {
      resetarSessao();
      return;
    }
    const confirmado = await mostrarConfirmacao(
      'Há lançamentos nesta sessão. Iniciar uma nova sessão descartará a lista atual. Deseja continuar?',
      'aviso',
    );
    if (confirmado) resetarSessao();
  };

  const voltar = async () => {
    if (linhasLancadas.length === 0) {
      onVoltar();
      return;
    }
    const confirmado = await mostrarConfirmacao(
      'Há lançamentos nesta sessão. Deseja sair e descartar a separação atual?',
      'aviso',
    );
    if (confirmado) onVoltar();
  };

  const abrirProduto = (produtoId: string) => {
    setProdutoSelecionadoId(produtoId);
    setBusca('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.setTimeout(() => buscaRef.current?.focus(), 0);
  };

  const voltarParaProdutos = () => {
    setProdutoSelecionadoId(null);
    setBusca('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.setTimeout(() => buscaRef.current?.focus(), 0);
  };

  const limparQuantidade = (item: ItemEstoque) => {
    const chave = chaveItem(item);
    setQuantidades((atuais) => {
      const copia = { ...atuais };
      delete copia[chave];
      return copia;
    });
    setUltimoLancamento(null);
    setErro(null);
    setMensagem(`${item.produto_ref_id}: seleção limpa.`);
  };

  const atualizarQuantidade = (item: ItemEstoque, valor: string | number) => {
    if (!podeGerenciar) {
      mostrarPopupSemPermissao('Seu vínculo atual não possui permissão para registrar saídas de estoque.');
      return;
    }

    if (valor === '') {
      limparQuantidade(item);
      return;
    }

    const valorNumerico = typeof valor === 'number' ? valor : Number(valor);
    if (!Number.isFinite(valorNumerico)) return;

    const chave = chaveItem(item);
    const quantidadeAnterior = quantidades[chave] || 0;
    const quantidade = Math.min(item.saldo, Math.max(0, Math.floor(valorNumerico)));
    if (quantidade === 0) {
      limparQuantidade(item);
      return;
    }

    setQuantidades((atuais) => ({ ...atuais, [chave]: quantidade }));
    const diferenca = quantidade - quantidadeAnterior;
    setUltimoLancamento(diferenca > 0 ? { chave, sku: item.produto_ref_id, quantidade: diferenca } : null);
    setErro(null);
    setMensagem(diferenca > 0
      ? mensagemLancamento(item.produto_ref_id, diferenca)
      : `${item.produto_ref_id}: quantidade ajustada.`);
  };

  const incrementarQuantidade = (item: ItemEstoque, incremento: number) => {
    if (!podeGerenciar) {
      mostrarPopupSemPermissao('Seu vínculo atual não possui permissão para registrar saídas de estoque.');
      return;
    }

    const chave = chaveItem(item);
    const atual = quantidades[chave] || 0;
    const disponivel = saldoRestante(item);
    const quantidadeAdicionar = Math.min(incremento, disponivel);
    if (quantidadeAdicionar <= 0) return;

    setQuantidades((atuais) => ({ ...atuais, [chave]: atual + quantidadeAdicionar }));
    setUltimoLancamento({ chave, sku: item.produto_ref_id, quantidade: quantidadeAdicionar });
    setErro(null);
    setMensagem(mensagemLancamento(item.produto_ref_id, quantidadeAdicionar));
  };

  const desfazerUltimo = () => {
    if (!ultimoLancamento) return;
    setQuantidades((atuais) => {
      const proxima = Math.max(0, (atuais[ultimoLancamento.chave] || 0) - ultimoLancamento.quantidade);
      if (proxima === 0) {
        const copia = { ...atuais };
        delete copia[ultimoLancamento.chave];
        return copia;
      }
      return { ...atuais, [ultimoLancamento.chave]: proxima };
    });
    setMensagem(`Último lançamento desfeito: ${ultimoLancamento.sku}.`);
    setUltimoLancamento(null);
  };

  const abrirRevisao = () => {
    setRevisaoAberta(true);
    setConfirmouConferencia(false);
  };

  const finalizar = async () => {
    if (!podeGerenciar) {
      mostrarPopupSemPermissao('Seu vínculo atual não possui permissão para registrar saídas de estoque.');
      return;
    }
    if (linhasLancadas.length === 0 || !confirmouConferencia || salvando) return;

    setSalvando(true);
    setErro(null);
    try {
      await registrarSaidaEstoqueEmLote(
        linhasLancadas.map(({ item, quantidade }) => ({
          produto_id: item.produto_id,
          variante_nome: item.variante_nome,
          quantidade_movimentada: quantidade,
        })),
        tipoOperacao(marketplace),
        `Separação manual | ${nomeMarketplace(marketplace)} | ${quantidadePedidos || 0} pedidos`,
        novaChaveIdempotencia(),
      );
      setMensagem(`Separação da sessão ${nomeMarketplace(marketplace)} registrada com sucesso.`);
      setQuantidades({});
      setUltimoLancamento(null);
      setRevisaoAberta(false);
      setConfirmouConferencia(false);
      await onConcluida();
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível registrar a separação.');
      setMensagem('A separação não foi registrada. Revise o saldo e tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const onBuscaKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (produtoSelecionadoId) voltarParaProdutos();
      else {
        setBusca('');
        buscaRef.current?.focus();
      }
      return;
    }

    if (event.key === 'Enter' && !produtoSelecionadoId) {
      const termo = textoNormalizado(busca);
      const itemExato = itensCatalogo.find((item) => textoNormalizado(item.produto_ref_id) === termo);
      if (itemExato) abrirProduto(String(itemExato.produto_id));
    }
  };

  const renderVariante = (item: ItemEstoque) => {
    const chave = chaveItem(item);
    const quantidadeSessao = quantidades[chave] || 0;
    const disponivel = saldoRestante(item);
    const bloqueado = !podeGerenciar || disponivel <= 0;

    return (
      <article className={`estoque-separacao-row${quantidadeSessao > 0 ? ' is-added' : ''}`} key={chave}>
        <div className="estoque-separacao-product">
          <div className="estoque-separacao-thumb"><img src={item.imagem} alt="" onError={(event) => { event.currentTarget.src = '/img/placeholder-image.png'; }} /></div>
          <div><strong>{item.variante_nome || 'Padrão'}</strong><span>SKU {item.produto_ref_id}</span>{quantidadeSessao > 0 ? <small className="estoque-separacao-session-badge">{quantidadeSessao} nesta sessão</small> : null}</div>
        </div>
        <div className="estoque-separacao-row-actions">
          <div className="estoque-separacao-stock"><strong>{disponivel}</strong><small>disponível</small></div>
          <div className="estoque-separacao-quantity">
            <input type="number" min="0" max={item.saldo} value={quantidadeSessao || ''} onChange={(event) => atualizarQuantidade(item, event.target.value)} disabled={!podeGerenciar} aria-label={`Quantidade retirada para ${item.produto_ref_id}`} />
            <div className="estoque-separacao-quick-actions" aria-label={`Ações rápidas para ${item.produto_ref_id}`}>
              <button type="button" onClick={() => incrementarQuantidade(item, 1)} disabled={bloqueado} aria-label={`Adicionar 1 unidade de ${item.produto_ref_id}`}>+1</button>
              <button type="button" onClick={() => incrementarQuantidade(item, 5)} disabled={bloqueado || disponivel < 5} aria-label={`Adicionar 5 unidades de ${item.produto_ref_id}`}>+5</button>
              <button className="estoque-separacao-clear" type="button" onClick={() => limparQuantidade(item)} disabled={!podeGerenciar || quantidadeSessao === 0}>LIMPAR</button>
            </div>
          </div>
        </div>
      </article>
    );
  };

  return (
    <>
      <UIHeaderPagina titulo="Separação">
        <button className="gs-btn gs-btn-secundario" type="button" onClick={() => void voltar()}>
          <i className="fas fa-arrow-left" aria-hidden="true"></i>
          <span>Voltar ao estoque</span>
        </button>
      </UIHeaderPagina>

      <div className="gs-conteudo-pagina estoque-separacao-page">
        <div className="estoque-separacao-heading">
          <div>
            <span className="estoque-section-eyebrow">Separação manual</span>
            <h2>Registre o que foi retirado do estoque</h2>
            <p>Escolha um produto, encontre a variação e registre a quantidade retirada.</p>
          </div>
          <div className="estoque-separacao-heading-actions">
            <button className="gs-btn gs-btn-secundario" type="button" onClick={() => void novaSessao()} disabled={salvando}>
              <i className="fas fa-plus" aria-hidden="true"></i>
              <span>Nova sessão</span>
            </button>
          </div>
        </div>

        <div className="estoque-separacao-marketplaces" aria-label="Escolher marketplace da sessão">
          {MARKETPLACES.map((opcao) => (
            <button type="button" key={opcao.id} className={`estoque-separacao-marketplace${marketplace === opcao.id ? ' is-active' : ''}`} onClick={() => void trocarMarketplace(opcao.id)} aria-pressed={marketplace === opcao.id}>
              <span className="estoque-separacao-marketplace-copy"><strong>{opcao.id}</strong><small>{opcao.descricao}</small></span>
              <span className="estoque-separacao-marketplace-mark">{opcao.sigla}</span>
            </button>
          ))}
        </div>

        <section className="gs-card estoque-separacao-session" aria-label="Sessão de separação atual">
          <div className="estoque-separacao-session-main">
            <span className="estoque-separacao-channel-mark">{MARKETPLACES.find((opcao) => opcao.id === marketplace)?.sigla}</span>
            <div><strong>Sessão {marketplace}</strong><small>Organize os lançamentos por marketplace.</small></div>
          </div>
          <label className="estoque-separacao-orders-field">
            <span>Quantidade de pedidos</span>
            <input type="number" min="0" value={quantidadePedidos || ''} onChange={(event) => setQuantidadePedidos(Math.max(0, Number(event.target.value) || 0))} placeholder="Opcional" />
          </label>
        </section>

        <div className="estoque-separacao-layout">
          <section className="gs-card estoque-separacao-main" aria-label="Produtos para separação">
            <div className="estoque-separacao-toolbar">
              <label className="estoque-separacao-search">
                <i className="fas fa-search" aria-hidden="true"></i>
                <span className="sr-only">Buscar produto ou SKU</span>
                <input ref={buscaRef} type="search" value={busca} onChange={(event) => setBusca(event.target.value)} onKeyDown={onBuscaKeyDown} placeholder={produtoSelecionado ? 'Buscar variação ou SKU...' : 'Buscar produto ou SKU...'} autoFocus />
                {busca ? <button type="button" aria-label="Limpar busca" onClick={() => { setBusca(''); buscaRef.current?.focus(); }}><i className="fas fa-xmark" aria-hidden="true"></i></button> : null}
              </label>
              <span className="estoque-separacao-results">{produtoSelecionado ? `${variantesVisiveis.length} variação(ões)` : `${produtosVisiveis.length} produto(s)`}</span>
            </div>
            <p className="estoque-separacao-session-status" role="status">{mensagem}</p>

            {produtoSelecionado ? (
              <>
                <div className="estoque-separacao-product-nav">
                  <button type="button" className="estoque-separacao-back" onClick={voltarParaProdutos}>
                    <i className="fas fa-arrow-left" aria-hidden="true"></i>
                    <span>Todos os produtos</span>
                  </button>
                  <div><strong>{produtoSelecionado.nome}</strong><small>{produtoSelecionado.itens.length} variações cadastradas · {produtoSelecionado.saldoTotal} unidades disponíveis</small></div>
                </div>
                {variantesVisiveis.length === 0 ? (
                  <div className="estoque-separacao-empty"><strong>Nenhuma variação encontrada</strong><span>Tente buscar por outro SKU ou volte para escolher outro produto.</span></div>
                ) : (
                  <div className="estoque-separacao-list">{variantesVisiveis.map(renderVariante)}</div>
                )}
              </>
            ) : produtosVisiveis.length === 0 ? (
              <div className="estoque-separacao-empty"><strong>Nenhum produto encontrado</strong><span>Tente buscar por outro nome ou SKU.</span></div>
            ) : (
              <div className="estoque-separacao-product-grid">
                {produtosVisiveis.map((grupo) => (
                  <button type="button" className={`estoque-separacao-product-card${grupo.quantidadeLancada > 0 ? ' is-added' : ''}`} key={grupo.id} onClick={() => abrirProduto(grupo.id)}>
                    <span className="estoque-separacao-product-card-thumb"><img src={grupo.imagem} alt="" onError={(event) => { event.currentTarget.src = '/img/placeholder-image.png'; }} /></span>
                    <span className="estoque-separacao-product-card-body">
                      <strong>{grupo.nome}</strong>
                      {grupo.sku ? <small>SKU {grupo.sku}</small> : null}
                      <span>{grupo.variacoesDisponiveis} {grupo.variacoesDisponiveis === 1 ? 'variação disponível' : 'variações disponíveis'}</span>
                      <span className="estoque-separacao-product-card-stock">{grupo.saldoTotal} unidades disponíveis</span>
                    </span>
                    <span className="estoque-separacao-product-card-footer">
                      {grupo.quantidadeLancada > 0 ? <em>{grupo.quantidadeLancada} nesta sessão</em> : <em>Selecionar produto</em>}
                      <i className="fas fa-chevron-right" aria-hidden="true"></i>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {linhasLancadas.length > 0 ? (
            <button
              className={`estoque-separacao-cart${revisaoAberta ? ' is-open' : ''}`}
              type="button"
              onClick={() => (revisaoAberta ? setRevisaoAberta(false) : abrirRevisao())}
              disabled={salvando}
              aria-expanded={revisaoAberta}
              aria-controls="estoque-separacao-review"
            >
              <span className="estoque-separacao-cart-icon"><i className="fas fa-cart-shopping" aria-hidden="true"></i><b>{linhasLancadas.length}</b></span>
              <span className="estoque-separacao-cart-copy"><strong>{revisaoAberta ? 'Fechar revisão' : 'Revisar separação'}</strong><small>{totalUnidades} {totalUnidades === 1 ? 'unidade' : 'unidades'} selecionadas</small></span>
            </button>
          ) : null}
        </div>

        {erro ? <div className="estoque-inline-error" role="alert"><i className="fas fa-circle-exclamation" aria-hidden="true"></i><span>{erro}</span><button type="button" onClick={() => setErro(null)}>Fechar</button></div> : null}

        {revisaoAberta ? (
          <div className="estoque-separacao-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRevisaoAberta(false); }}>
            <section id="estoque-separacao-review" ref={revisaoRef} className="gs-card estoque-separacao-review" role="dialog" aria-modal="true" aria-labelledby="estoque-separacao-review-title" tabIndex={-1}>
              <div className="estoque-separacao-review-head"><div><h2 id="estoque-separacao-review-title">Revisar separação</h2><p>Confira os itens e as quantidades antes de finalizar.</p></div><button className="gs-btn gs-btn-secundario" type="button" onClick={() => setRevisaoAberta(false)}>Fechar</button></div>
              {linhasLancadas.length === 0 ? <div className="estoque-separacao-review-empty">Nenhum item selecionado. Volte à busca para escolher os produtos conferidos.</div> : <div className="estoque-separacao-review-list">{linhasLancadas.map((linha) => <div className="estoque-separacao-review-line" key={linha.chave}><div className="estoque-separacao-review-image"><img src={linha.item.imagem} alt="" onError={(event) => { event.currentTarget.src = '/img/placeholder-image.png'; }} /></div><div className="estoque-separacao-review-copy"><span>{linha.item.produto_nome}</span><small>{linha.item.variante_nome || 'Padrão'} · SKU {linha.item.produto_ref_id}</small></div><strong>{linha.quantidade} un.</strong></div>)}</div>}
              <label className="estoque-separacao-confirm"><input type="checkbox" checked={confirmouConferencia} onChange={(event) => setConfirmouConferencia(event.target.checked)} disabled={linhasLancadas.length === 0 || salvando} /><span>Conferi os itens desta sessão e as quantidades acima correspondem ao que foi retirado.</span></label>
              <div className="estoque-separacao-review-actions"><button className="gs-btn gs-btn-secundario" type="button" onClick={desfazerUltimo} disabled={!ultimoLancamento || salvando}>Desfazer último</button><button className="gs-btn gs-btn-secundario" type="button" onClick={() => setRevisaoAberta(false)} disabled={salvando}>Continuar lançando</button><button className="gs-btn gs-btn-primario" type="button" onClick={() => void finalizar()} disabled={!confirmouConferencia || linhasLancadas.length === 0 || salvando}>{salvando ? 'Finalizando...' : `Finalizar separação ${marketplace}`}</button></div>
            </section>
          </div>
        ) : null}
      </div>
    </>
  );
}
