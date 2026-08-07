import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
// @ts-expect-error utilitario JS legado sem declaracao TypeScript
import { mostrarMensagem } from '/js/utils/popups.js';
import UIBloqueio from './UIBloqueio';
import UIFeedbackNotFound from './UIFeedbackNotFound';

interface ProdutoGrade {
  variacao?: string | null;
  imagem?: string | null;
}

interface ProdutoCorte {
  id: number;
  nome: string;
  imagem?: string | null;
  grade?: ProdutoGrade[] | null;
}

interface UsuarioCorte {
  nome?: string | null;
}

interface Preenchido {
  produto: ProdutoCorte;
  variante?: string | null;
  quantidadeSugerida?: number | string | null;
}

interface OPQuickLogModalProps {
  produtos: ProdutoCorte[];
  usuario: UsuarioCorte | null;
  onClose: () => void;
  onSuccess: () => void;
  preenchido?: Preenchido | null;
}

interface ItemCorte {
  itemId: string;
  produtoId: number;
  produtoNome: string;
  variante: string | null;
  imagem: string;
}

interface ItemFila extends ItemCorte {
  quantidade: number;
}

interface ItemResultado extends ItemFila {
  ok: boolean;
}

interface ItemConfirmado {
  item: ItemCorte;
  quantidade: number;
}

interface ResultadoExpressData {
  itens: ItemResultado[];
  totalOk: number;
  totalErro: number;
}

type ModoLancamento = 'normal' | 'express';

function normalizarTexto(texto: unknown): string {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function carregarRecentes(): ItemCorte[] {
  try {
    const armazenados = JSON.parse(localStorage.getItem('op_cortes_recentes') || '[]') as unknown;
    if (!Array.isArray(armazenados)) return [];
    return armazenados.filter((item): item is ItemCorte => {
      if (!item || typeof item !== 'object') return false;
      const registro = item as Partial<ItemCorte>;
      return (
        typeof registro.itemId === 'string' &&
        typeof registro.produtoId === 'number' &&
        typeof registro.produtoNome === 'string' &&
        typeof registro.imagem === 'string'
      );
    });
  } catch {
    return [];
  }
}

function ResultadoExpress({
  itens,
  totalOk,
  totalErro,
  onFechar,
}: ResultadoExpressData & { onFechar: () => void }) {
  const tudoOk = totalErro === 0;

  return (
    <div className="op-quicklog-resultado">
      <div className={`op-quicklog-resultado-circulo ${tudoOk ? 'ok' : 'parcial'}`}>
        <i className={`fas fa-${tudoOk ? 'check' : 'exclamation-triangle'}`}></i>
      </div>
      <div className="op-quicklog-resultado-numero">
        {totalOk}<span> corte{totalOk !== 1 ? 's' : ''}</span>
      </div>
      <div className="op-quicklog-resultado-subtexto">
        {tudoOk ? 'registrados com sucesso' : `de ${totalOk + totalErro} registrados`}
      </div>
      <div className="op-quicklog-resultado-pills">
        {itens.map((item, indice) => (
          <div key={indice} className={`op-quicklog-pill ${item.ok ? 'ok' : 'erro'}`}>
            <i className={`fas fa-${item.ok ? 'check' : 'times'}`}></i>
            {item.produtoNome}{item.variante ? ` — ${item.variante}` : ''}
          </div>
        ))}
      </div>
      <button className="op-quicklog-resultado-fechar" onClick={onFechar}>
        {tudoOk ? 'Fechar' : 'Entendido'}
      </button>
    </div>
  );
}

export default function OPQuickLogModal({
  produtos,
  usuario,
  onClose,
  onSuccess,
  preenchido,
}: OPQuickLogModalProps) {
  const [busca, setBusca] = useState(preenchido?.produto?.nome || '');
  const [expandidoId, setExpandidoId] = useState<string | null>(
    preenchido ? `${preenchido.produto.id}|${preenchido.variante || ''}` : null,
  );
  const [quantidade, setQuantidade] = useState(
    preenchido?.quantidadeSugerida ? String(preenchido.quantidadeSugerida) : '',
  );
  const [modo, setModo] = useState<ModoLancamento>(() =>
    localStorage.getItem('op_cortes_modo') === 'express' ? 'express' : 'normal',
  );
  const [fila, setFila] = useState<ItemFila[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState(false);
  const [itemConfirmado, setItemConfirmado] = useState<ItemConfirmado | null>(null);
  const [resultadoExpress, setResultadoExpress] = useState<ResultadoExpressData | null>(null);
  const [recentes, setRecentes] = useState<ItemCorte[]>(carregarRecentes);

  const inputBuscaRef = useRef<HTMLInputElement>(null);
  const qtdInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (preenchido) qtdInputRef.current?.focus();
      else inputBuscaRef.current?.focus();
    }, preenchido ? 120 : 80);
    return () => clearTimeout(timer);
  }, [preenchido]);

  const produtoVarianteFlat = useMemo<ItemCorte[]>(() => {
    const lista: ItemCorte[] = [];
    for (const produto of produtos) {
      if (!produto.grade || produto.grade.length === 0) {
        lista.push({
          itemId: `${produto.id}|`,
          produtoId: produto.id,
          produtoNome: produto.nome,
          variante: null,
          imagem: produto.imagem || '/img/placeholder-image.png',
        });
      } else {
        for (const grade of produto.grade) {
          lista.push({
            itemId: `${produto.id}|${grade.variacao || ''}`,
            produtoId: produto.id,
            produtoNome: produto.nome,
            variante: grade.variacao || null,
            imagem: grade.imagem || produto.imagem || '/img/placeholder-image.png',
          });
        }
      }
    }
    return lista;
  }, [produtos]);

  const listaFiltrada = useMemo(() => {
    if (!busca.trim()) return [];
    const tokens = normalizarTexto(busca).split(/\s+/).filter(Boolean);
    return produtoVarianteFlat.filter((item) => {
      const texto = normalizarTexto(`${item.produtoNome} ${item.variante || ''}`);
      return tokens.every((token) => texto.includes(token));
    });
  }, [produtoVarianteFlat, busca]);

  const mostrarRecentes = !busca.trim();
  const listaAtiva = mostrarRecentes ? recentes : listaFiltrada;

  const salvarRecente = (item: ItemCorte) => {
    setRecentes((anterior) => {
      const filtrado = anterior.filter((recente) => recente.itemId !== item.itemId);
      const novo = [item, ...filtrado].slice(0, 8);
      try {
        localStorage.setItem('op_cortes_recentes', JSON.stringify(novo));
      } catch {
        // Histórico local é opcional.
      }
      return novo;
    });
  };

  const handleExpand = (itemId: string) => {
    if (expandidoId === itemId) {
      setExpandidoId(null);
    } else {
      setExpandidoId(itemId);
      setQuantidade('');
      setTimeout(() => qtdInputRef.current?.focus(), 250);
    }
  };

  const handleBuscaChange = (valor: string) => {
    setBusca(valor);
    setExpandidoId(null);
    setQuantidade('');
  };

  const alterarModo = (novoModo: ModoLancamento) => {
    setModo(novoModo);
    localStorage.setItem('op_cortes_modo', novoModo);
    setFila([]);
    setExpandidoId(null);
    setQuantidade('');
  };

  const ajustarQtd = (delta: number) => {
    setQuantidade((anterior) =>
      Math.max(0, (Number.parseInt(anterior, 10) || 0) + delta).toString(),
    );
  };

  const handleConfirmarNormal = async (item: ItemCorte) => {
    const quantidadeNumerica = Number.parseInt(quantidade, 10);
    if (!quantidadeNumerica || quantidadeNumerica <= 0) {
      mostrarMensagem('Informe uma quantidade válida.', 'aviso');
      return;
    }

    setSalvando(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/cortes', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          produto_id: item.produtoId,
          variante: item.variante || null,
          quantidade: quantidadeNumerica,
          data: new Date().toISOString().split('T')[0],
          status: 'cortados',
          op: null,
          cortador: usuario?.nome || 'Sistema',
        }),
      });
      if (!response.ok) {
        const erro = (await response.json()) as { error?: string };
        throw new Error(erro.error || 'Erro ao registrar corte.');
      }
      salvarRecente(item);
      setItemConfirmado({ item, quantidade: quantidadeNumerica });
      setFeito(true);
      setTimeout(onSuccess, 1100);
    } catch (erro) {
      mostrarMensagem(erro instanceof Error ? erro.message : 'Erro ao registrar corte.', 'erro');
    } finally {
      setSalvando(false);
    }
  };

  const handleAdicionarFila = (item: ItemCorte) => {
    const quantidadeNumerica = Number.parseInt(quantidade, 10);
    if (!quantidadeNumerica || quantidadeNumerica <= 0) {
      mostrarMensagem('Informe uma quantidade válida.', 'aviso');
      return;
    }
    setFila((anterior) => [...anterior, { ...item, quantidade: quantidadeNumerica }]);
    setExpandidoId(null);
    setQuantidade('');
  };

  const handleRemoverFila = (indice: number) => {
    setFila((anterior) => anterior.filter((_, itemIndice) => itemIndice !== indice));
  };

  const handleRegistrarExpress = async () => {
    if (fila.length === 0) return;
    setSalvando(true);
    const token = localStorage.getItem('token');
    const data = new Date().toISOString().split('T')[0];

    const itens = await Promise.all(
      fila.map(async (item): Promise<ItemResultado> => {
        try {
          const response = await fetch('/api/cortes', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              produto_id: item.produtoId,
              variante: item.variante || null,
              quantidade: item.quantidade,
              data,
              status: 'cortados',
              op: null,
              cortador: usuario?.nome || 'Sistema',
            }),
          });
          if (!response.ok) {
            const erro = (await response.json()) as { error?: string };
            throw new Error(erro.error || 'Erro ao registrar corte.');
          }
          return { ...item, ok: true };
        } catch {
          return { ...item, ok: false };
        }
      }),
    );

    const totalOk = itens.filter((item) => item.ok).length;
    const totalErro = itens.filter((item) => !item.ok).length;
    itens.filter((item) => item.ok).forEach((item) => salvarRecente(item));
    setSalvando(false);
    setResultadoExpress({ itens, totalOk, totalErro });
  };

  const tituloHeader = feito
    ? 'Corte registrado!'
    : modo === 'express'
      ? 'Registrar Cortes'
      : 'Registrar Corte';

  return (
    <div className="op-quicklog-panel">
      <div className="op-quicklog-header">
        <div className="op-quicklog-titulo">
          <i className="fas fa-bolt op-quicklog-icone-titulo"></i>
          <span>{tituloHeader}</span>
        </div>
        <div className="op-quicklog-header-acoes">
          {!feito && !resultadoExpress && (
            <div className="op-quicklog-modo-toggle">
              <button
                className={`op-quicklog-modo-btn ${modo === 'normal' ? 'ativo' : ''}`}
                onClick={() => alterarModo('normal')}
              >
                Normal
              </button>
              <button
                className={`op-quicklog-modo-btn ${modo === 'express' ? 'ativo' : ''}`}
                onClick={() => alterarModo('express')}
              >
                Express
              </button>
            </div>
          )}
          <button className="op-quicklog-fechar" onClick={onClose} title="Fechar">
            <i className="fas fa-times"></i>
          </button>
        </div>
      </div>

      <div className="op-quicklog-corpo">
        {resultadoExpress && (
          <ResultadoExpress {...resultadoExpress} onFechar={onSuccess} />
        )}

        {feito && !resultadoExpress && (
          <div className="op-quicklog-sucesso">
            <i className="fas fa-check-circle"></i>
            <span>
              {itemConfirmado?.quantidade} pçs de{' '}
              <strong>{itemConfirmado?.item.produtoNome}</strong>
              {itemConfirmado?.item.variante ? ` — ${itemConfirmado.item.variante}` : ''} adicionadas ao estoque.
            </span>
          </div>
        )}

        {!feito && !resultadoExpress && (
          <>
            <div className="op-quicklog-busca">
              <i className="fas fa-search"></i>
              <input
                ref={inputBuscaRef}
                type="text"
                placeholder="Buscar produto, cor, tamanho..."
                value={busca}
                onChange={(evento: ChangeEvent<HTMLInputElement>) => handleBuscaChange(evento.target.value)}
              />
              {busca && (
                <button onClick={() => handleBuscaChange('')}>
                  <i className="fas fa-times"></i>
                </button>
              )}
            </div>

            {mostrarRecentes && recentes.length === 0 ? (
              <div className="op-quicklog-dica">
                <i className="fas fa-keyboard"></i>
                <span>Digite para buscar um produto</span>
              </div>
            ) : (
              <>
                {mostrarRecentes && (
                  <div className="op-quicklog-recentes-titulo">
                    <i className="fas fa-clock"></i> Recentes
                  </div>
                )}
                {!mostrarRecentes && listaFiltrada.length === 0 ? (
                  <UIFeedbackNotFound
                    icon="fa-search"
                    titulo="Nenhum produto encontrado"
                    mensagem={`Não encontramos produtos ou variantes para “${busca}”. Tente outro termo.`}
                  />
                ) : (
                  <div className="op-quicklog-lista">
                    {listaAtiva.map((item) => {
                      const aberto = expandidoId === item.itemId;
                      return (
                        <Fragment key={item.itemId}>
                          <div
                            className={`op-quicklog-item ${aberto ? 'selecionado' : ''}`}
                            onClick={() => handleExpand(item.itemId)}
                          >
                            <img src={item.imagem} alt={item.produtoNome} className="op-quicklog-item-img" />
                            <div className="op-quicklog-item-info">
                              <div className="op-quicklog-item-nome">{item.produtoNome}</div>
                              <div className="op-quicklog-item-variante">{item.variante || 'Padrão'}</div>
                            </div>
                            <i className={`fas fa-chevron-${aberto ? 'up' : 'down'} op-quicklog-item-seta`}></i>
                          </div>

                          <div className={`op-quicklog-qty-bloco ${aberto ? 'aberto' : ''}`}>
                            <div className="op-quicklog-qty-bloco-inner">
                              <div className="op-quicklog-qty-controles">
                                <button className="op-quicklog-qty-btn" onClick={() => ajustarQtd(-1)}>
                                  −
                                </button>
                                <input
                                  ref={aberto ? qtdInputRef : null}
                                  type="number"
                                  className="op-quicklog-qty-input"
                                  value={aberto ? quantidade : ''}
                                  onChange={(evento) => aberto && setQuantidade(evento.target.value)}
                                  onClick={(evento) => evento.stopPropagation()}
                                  placeholder="0"
                                  min="0"
                                />
                                <button className="op-quicklog-qty-btn" onClick={() => ajustarQtd(1)}>
                                  +
                                </button>
                              </div>
                              <div className="op-quicklog-qty-atalhos">
                                {[10, 50, 100].map((valor) => (
                                  <button
                                    key={valor}
                                    onClick={() => aberto && setQuantidade(valor.toString())}
                                  >
                                    {valor} pçs
                                  </button>
                                ))}
                              </div>
                              <UIBloqueio permissao="registrar-corte">
                                {modo === 'normal' ? (
                                  <button
                                    className="op-quicklog-confirmar"
                                    onClick={() => void handleConfirmarNormal(item)}
                                    disabled={salvando || !quantidade || Number.parseInt(quantidade, 10) <= 0}
                                  >
                                    {salvando ? (
                                      <><div className="op-spinner-btn"></div> Salvando...</>
                                    ) : (
                                      <><i className="fas fa-check"></i> Confirmar Corte</>
                                    )}
                                  </button>
                                ) : (
                                  <button
                                    className="op-quicklog-adicionar-fila"
                                    onClick={() => handleAdicionarFila(item)}
                                    disabled={!quantidade || Number.parseInt(quantidade, 10) <= 0}
                                  >
                                    <i className="fas fa-plus"></i> Adicionar à Fila
                                  </button>
                                )}
                              </UIBloqueio>
                            </div>
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {modo === 'express' && fila.length > 0 && (
              <div className="op-quicklog-fila">
                <div className="op-quicklog-fila-titulo">
                  <i className="fas fa-layer-group"></i> Fila ({fila.length})
                </div>
                <div className="op-quicklog-fila-itens">
                  {fila.map((item, indice) => (
                    <div key={indice} className="op-quicklog-fila-item">
                      <img src={item.imagem} alt={item.produtoNome} className="op-quicklog-item-img" />
                      <div className="op-quicklog-item-info">
                        <div className="op-quicklog-item-nome">{item.produtoNome}</div>
                        <div className="op-quicklog-item-variante">{item.variante || 'Padrão'}</div>
                      </div>
                      <div className="op-quicklog-fila-qty">{item.quantidade} pçs</div>
                      <button
                        className="op-quicklog-fila-remover"
                        onClick={() => handleRemoverFila(indice)}
                        title="Remover da fila"
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                  ))}
                </div>
                <UIBloqueio permissao="registrar-corte">
                  <button
                    className="op-quicklog-registrar-btn"
                    onClick={() => void handleRegistrarExpress()}
                    disabled={salvando}
                  >
                    {salvando ? (
                      <><div className="op-spinner-btn"></div> Registrando...</>
                    ) : (
                      <>Registrar {fila.length} corte{fila.length > 1 ? 's' : ''} <i className="fas fa-arrow-right"></i></>
                    )}
                  </button>
                </UIBloqueio>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
