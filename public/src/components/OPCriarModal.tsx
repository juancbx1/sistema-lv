// public/src/components/OPCriarModal.tsx

import { useEffect, useState, type ReactNode } from 'react';
// @ts-expect-error popups JS legado sem declaracao TypeScript
import { mostrarMensagem } from '/js/utils/popups.js';
// @ts-expect-error storage JS legado sem declaracao TypeScript
import { obterProdutos } from '/js/utils/storage.js';
import UICarregando from './UICarregando';

type OpCenario = 'carregando' | 'modo2' | 'vazio' | 'exato' | 'sobra' | 'parcial';
type OpOpcaoParcial = 'A' | 'B';

interface OpCorteModal {
  id: number;
  produto_id: number;
  variante?: string | null;
  quantidade: number;
  pn?: number | string | null;
  op?: unknown | null;
  produto?: string | null;
  imagem_produto?: string | null;
}

interface OpProdutoModal {
  id: number;
  nome: string;
  imagem?: string | null;
  grade?: Array<{ variacao?: string | null; imagem?: string | null }> | null;
}

interface OpDemandaModal {
  id: number;
  produto_nome?: string | null;
  produto_sku?: string | null;
  variacao?: string | null;
  quantidade_solicitada?: number | string | null;
  data_solicitacao?: string | null;
  prioridade?: number | string | null;
}

interface OpProdutoInfo {
  nome: string;
  imagem: string;
}

interface OpCriarModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOPCriada: () => void;
  demandaId?: number | null;
  produtoId?: number | null;
  variante?: string | null;
  quantidadeSugerida?: number;
  corteExistente?: OpCorteModal | null;
}

interface OpCriarCortePayload {
  produto_id: number | null;
  variante: string | null;
  quantidade: number;
  data: string;
  status: 'cortados';
  demanda_id: number | null;
}

interface OpCriarOpPayload {
  numero: string;
  produto_id: number | null;
  variante: string | null;
  quantidade: number;
  data_entrega: string;
  observacoes: string | null;
  status: 'produzindo';
  corte_origem_id: number;
  demanda_id: number | null;
}

interface OpCriadaResponse {
  numero: string | number;
}

function hoje() {
  return new Date().toISOString().split('T')[0];
}

function norm(valor?: string | null) {
  return !valor || valor === '-' || valor === '' ? null : String(valor).trim();
}

async function fetchCortesDisponiveis(produtoId: number | null, variante?: string | null) {
  const token = localStorage.getItem('token');
  const res = await fetch('/api/cortes?status=cortados', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [] as OpCorteModal[];
  const todos = (await res.json()) as unknown;
  const varianteAlvo = norm(variante);
  return Array.isArray(todos)
    ? (todos as OpCorteModal[]).filter((corte) =>
        corte.produto_id === produtoId && norm(corte.variante) === varianteAlvo && corte.op === null,
      )
    : [];
}

async function getNextOPNumber() {
  const token = localStorage.getItem('token');
  const res = await fetch('/api/ordens-de-producao?getNextNumber=true', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Falha ao obter número de OP.');
  const nums = (await res.json()) as unknown;
  const max = Array.isArray(nums)
    ? nums.map((num) => parseInt(String(num), 10)).filter((num) => !Number.isNaN(num)).reduce((m, c) => Math.max(m, c), 0)
    : 0;
  return (max + 1).toString();
}

async function apiCriarCorte(token: string | null, payload: OpCriarCortePayload) {
  const res = await fetch('/api/cortes', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorData = (await res.json()) as { error?: string };
    throw new Error(errorData.error || 'Falha ao registrar corte.');
  }
  return (await res.json()) as OpCorteModal;
}

async function apiCriarOP(token: string | null, payload: OpCriarOpPayload) {
  const res = await fetch('/api/ordens-de-producao', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorData = (await res.json()) as { error?: string };
    throw new Error(errorData.error || 'Falha ao criar OP.');
  }
  return (await res.json()) as OpCriadaResponse;
}

function mensagemDoErro(error: unknown) {
  return error instanceof Error ? error.message : 'Erro desconhecido.';
}

export default function OPCriarModal({
  isOpen,
  onClose,
  onOPCriada,
  demandaId = null,
  produtoId = null,
  variante = null,
  quantidadeSugerida = 0,
  corteExistente = null,
}: OpCriarModalProps) {
  const modoComCorte = Boolean(corteExistente);
  const [cenario, setCenario] = useState<OpCenario>('carregando');
  const [corteUsado, setCorteUsado] = useState<OpCorteModal | null>(null);
  const [opcaoParcial, setOpcaoParcial] = useState<OpOpcaoParcial>('A');
  const [quantidade, setQuantidade] = useState<string | number>('');
  const [dataEntrega, setDataEntrega] = useState(hoje());
  const [observacoes, setObservacoes] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [produtoInfo, setProdutoInfo] = useState<OpProdutoInfo | null>(null);
  const [demandasAtivas, setDemandasAtivas] = useState<OpDemandaModal[]>([]);
  const [vincularDemanda, setVincularDemanda] = useState(true);
  const [demandaVinculadaId, setDemandaVinculadaId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDataEntrega(hoje());
    setObservacoes('');
    setOpcaoParcial('A');
    setCorteUsado(null);
    setDemandasAtivas([]);
    setVincularDemanda(true);
    setDemandaVinculadaId(null);

    if (modoComCorte && corteExistente) {
      obterProdutos()
        .then((produtos: OpProdutoModal[]) => {
          const produto = produtos.find((item) => item.id === corteExistente.produto_id);
          if (produto) {
            let imagem = produto.imagem;
            const varianteNormalizada = corteExistente.variante && corteExistente.variante !== '-'
              ? corteExistente.variante
              : null;
            if (varianteNormalizada && Array.isArray(produto.grade)) {
              const grade = produto.grade.find((item) => item.variacao === varianteNormalizada);
              if (grade?.imagem) imagem = grade.imagem;
            }
            setProdutoInfo({ nome: produto.nome, imagem: imagem || '/img/placeholder-image.png' });
          } else {
            setProdutoInfo({
              nome: corteExistente.produto || 'Produto',
              imagem: corteExistente.imagem_produto || '/img/placeholder-image.png',
            });
          }
        })
        .catch(() => {
          setProdutoInfo({
            nome: corteExistente.produto || 'Produto',
            imagem: corteExistente.imagem_produto || '/img/placeholder-image.png',
          });
        });

      setQuantidade(corteExistente.quantidade || 1);
      setCenario('modo2');

      if (corteExistente.produto_id) {
        const token = localStorage.getItem('token');
        const varParam = corteExistente.variante && corteExistente.variante !== '-'
          ? `&variante=${encodeURIComponent(corteExistente.variante)}`
          : '';
        fetch(`/api/demandas/pendentes-por-produto?produto_id=${corteExistente.produto_id}${varParam}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((res) => (res.ok ? res.json() : []))
          .then((data: unknown) => {
            if (Array.isArray(data) && data.length > 0) {
              const demandas = data as OpDemandaModal[];
              setDemandasAtivas(demandas);
              setDemandaVinculadaId(String(demandas[0].id));
            }
          })
          .catch(() => {});
      }
      return;
    }

    const needed = Math.max(1, quantidadeSugerida || 1);
    setQuantidade(needed);
    setCenario('carregando');

    void Promise.all([
      obterProdutos() as Promise<OpProdutoModal[]>,
      fetchCortesDisponiveis(produtoId, variante),
    ])
      .then(([produtos, cortes]) => {
        const produto = produtos.find((item) => item.id === produtoId);
        if (produto) {
          let imagem = produto.imagem;
          if (variante && produto.grade) {
            const grade = produto.grade.find((item) => item.variacao === variante);
            if (grade?.imagem) imagem = grade.imagem;
          }
          setProdutoInfo({ nome: produto.nome, imagem: imagem || '/img/placeholder-image.png' });
        }

        if (cortes.length === 0) {
          setCenario('vazio');
          return;
        }

        const suficientes = cortes
          .filter((corte) => corte.quantidade >= needed)
          .sort((a, b) => a.quantidade - b.quantidade);
        if (suficientes.length > 0) {
          const melhor = suficientes[0];
          setCorteUsado(melhor);
          setCenario(melhor.quantidade === needed ? 'exato' : 'sobra');
        } else {
          const maior = [...cortes].sort((a, b) => b.quantidade - a.quantidade)[0];
          setCorteUsado(maior);
          setCenario('parcial');
        }
      })
      .catch(() => {
        setCenario('vazio');
      });
  }, [isOpen]);

  if (!isOpen) return null;

  const needed = Math.max(1, quantidadeSugerida || 1);
  const nomeVariante = modoComCorte ? corteExistente?.variante : variante;
  const nomeExibicao = produtoInfo?.nome || '...';
  const imagemExibicao = produtoInfo?.imagem || '/img/placeholder-image.png';
  const maxQtd = cenario === 'modo2'
    ? corteExistente?.quantidade ?? null
    : cenario === 'exato' || cenario === 'sobra'
      ? corteUsado?.quantidade ?? null
      : null;

  const handleCriar = async () => {
    if (cenario === 'carregando') return;
    const token = localStorage.getItem('token');
    setCarregando(true);

    try {
      if (cenario === 'modo2' && corteExistente) {
        const qtd = parseInt(String(quantidade), 10);
        if (!qtd || qtd <= 0) return mostrarMensagem('Quantidade inválida.', 'aviso');
        if (!dataEntrega) return mostrarMensagem('Informe a data de entrega.', 'aviso');
        if (qtd > corteExistente.quantidade) return mostrarMensagem(`Máximo: ${corteExistente.quantidade} pçs.`, 'aviso');

        const demandaIdFinal = vincularDemanda && demandaVinculadaId
          ? parseInt(demandaVinculadaId, 10)
          : null;
        const numOP = await getNextOPNumber();
        const op = await apiCriarOP(token, {
          numero: numOP,
          produto_id: corteExistente.produto_id,
          variante: corteExistente.variante || null,
          quantidade: qtd,
          data_entrega: dataEntrega,
          observacoes: observacoes || null,
          status: 'produzindo',
          corte_origem_id: corteExistente.id,
          demanda_id: demandaIdFinal,
        });
        mostrarMensagem(`OP #${op.numero} criada (${qtd} pçs)!`, 'sucesso');
        onOPCriada();
        onClose();
        return;
      }

      if (cenario === 'vazio') {
        const qtd = parseInt(String(quantidade), 10);
        if (!qtd || qtd <= 0) return mostrarMensagem('Quantidade inválida.', 'aviso');
        if (!dataEntrega) return mostrarMensagem('Informe a data de entrega.', 'aviso');
        const corte = await apiCriarCorte(token, {
          produto_id: produtoId,
          variante: norm(variante),
          quantidade: qtd,
          data: hoje(),
          status: 'cortados',
          demanda_id: demandaId || null,
        });
        const numOP = await getNextOPNumber();
        const op = await apiCriarOP(token, {
          numero: numOP,
          produto_id: produtoId,
          variante: norm(variante),
          quantidade: qtd,
          data_entrega: dataEntrega,
          observacoes: observacoes || null,
          status: 'produzindo',
          corte_origem_id: corte.id,
          demanda_id: demandaId || null,
        });
        mostrarMensagem(`OP #${op.numero} criada (${qtd} pçs)!`, 'sucesso');
        onOPCriada();
        onClose();
        return;
      }

      if ((cenario === 'exato' || cenario === 'sobra') && corteUsado) {
        const qtd = parseInt(String(quantidade), 10);
        if (!qtd || qtd <= 0) return mostrarMensagem('Quantidade inválida.', 'aviso');
        if (!dataEntrega) return mostrarMensagem('Informe a data de entrega.', 'aviso');
        if (qtd > corteUsado.quantidade) return mostrarMensagem(`Máximo neste corte: ${corteUsado.quantidade} pçs.`, 'aviso');

        const numOP = await getNextOPNumber();
        const op = await apiCriarOP(token, {
          numero: numOP,
          produto_id: produtoId,
          variante: norm(variante),
          quantidade: qtd,
          data_entrega: dataEntrega,
          observacoes: observacoes || null,
          status: 'produzindo',
          corte_origem_id: corteUsado.id,
          demanda_id: demandaId || null,
        });
        mostrarMensagem(`OP #${op.numero} criada (${qtd} pçs)!`, 'sucesso');
        onOPCriada();
        onClose();
        return;
      }

      if (cenario === 'parcial' && corteUsado) {
        if (!dataEntrega) return mostrarMensagem('Informe a data de entrega.', 'aviso');
        let op: OpCriadaResponse;
        if (opcaoParcial === 'A') {
          const corte = await apiCriarCorte(token, {
            produto_id: produtoId,
            variante: norm(variante),
            quantidade: needed,
            data: hoje(),
            status: 'cortados',
            demanda_id: demandaId || null,
          });
          const numOP = await getNextOPNumber();
          op = await apiCriarOP(token, {
            numero: numOP,
            produto_id: produtoId,
            variante: norm(variante),
            quantidade: needed,
            data_entrega: dataEntrega,
            observacoes: observacoes || null,
            status: 'produzindo',
            corte_origem_id: corte.id,
            demanda_id: demandaId || null,
          });
        } else {
          const resAtualizar = await fetch('/api/cortes', {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: corteUsado.id, quantidade: needed }),
          });
          if (!resAtualizar.ok) {
            const errorData = (await resAtualizar.json()) as { error?: string };
            throw new Error(errorData.error || 'Falha ao atualizar o corte.');
          }
          const numOP = await getNextOPNumber();
          op = await apiCriarOP(token, {
            numero: numOP,
            produto_id: produtoId || 0,
            variante: norm(variante),
            quantidade: needed,
            data_entrega: dataEntrega,
            observacoes: observacoes || null,
            status: 'produzindo',
            corte_origem_id: corteUsado.id,
            demanda_id: demandaId || null,
          });
        }
        mostrarMensagem(`OP #${op.numero} criada (${needed} pçs)!`, 'sucesso');
        onOPCriada();
        onClose();
      }
    } catch (error) {
      mostrarMensagem(mensagemDoErro(error), 'erro');
    } finally {
      setCarregando(false);
    }
  };

  const handleQtdChange = (valor: string) => {
    if (valor === '' || /^\d+$/.test(valor)) {
      if (maxQtd !== null) {
        const numero = parseInt(valor, 10);
        if (Number.isNaN(numero) || numero <= maxQtd) setQuantidade(valor);
      } else {
        setQuantidade(valor);
      }
    }
  };

  const ajustar = (delta: number) => {
    const atual = parseInt(String(quantidade), 10) || 0;
    const novo = Math.max(1, atual + delta);
    if (maxQtd !== null && novo > maxQtd) return;
    setQuantidade(novo);
  };

  const textoBotao = (): ReactNode => {
    if (carregando) return <><i className="fas fa-circle-notch fa-spin"></i> Criando...</>;
    if (cenario === 'vazio') return <><i className="fas fa-plus"></i> Criar Corte + OP</>;
    if (cenario === 'parcial' && opcaoParcial === 'B') return <><i className="fas fa-check"></i> Completar Corte + Criar OP</>;
    return <><i className="fas fa-check"></i> Criar OP</>;
  };

  const renderFormQtd = (max: number | null) => (
    <div className="op-criar-modal-grupo">
      <label>Quantidade</label>
      <div className="op-criar-modal-qtd-row">
        <button type="button" className="op-criar-modal-qtd-btn" onClick={() => ajustar(-1)}>−</button>
        <input
          type="number"
          className="op-criar-modal-input"
          value={quantidade}
          onChange={(event) => handleQtdChange(event.target.value)}
          min={1}
          max={max || undefined}
          style={{ textAlign: 'center', fontWeight: 700, fontSize: '1.1rem' }}
        />
        <button type="button" className="op-criar-modal-qtd-btn" onClick={() => ajustar(1)}>+</button>
      </div>
      {max !== null && max !== undefined && (
        <span className="op-criar-modal-hint">Disponível neste corte: {max} pçs</span>
      )}
    </div>
  );

  const renderFormBase = () => (
    <>
      <div className="op-criar-modal-grupo">
        <label>Data de entrega</label>
        <input
          type="date"
          className="op-criar-modal-input"
          value={dataEntrega}
          onChange={(event) => setDataEntrega(event.target.value)}
        />
      </div>
      <div className="op-criar-modal-grupo">
        <label>
          Observações{' '}
          <span style={{ fontWeight: 400, color: 'var(--gs-texto-secundario)' }}>(opcional)</span>
        </label>
        <textarea
          className="op-criar-modal-input"
          rows={2}
          value={observacoes}
          onChange={(event) => setObservacoes(event.target.value)}
          placeholder="Ex: urgente, cliente especial..."
          style={{ resize: 'vertical' }}
        />
      </div>
    </>
  );

  const renderCenario = (): ReactNode => {
    if (cenario === 'carregando') return <UICarregando variante="bloco" texto="Verificando estoque de cortes..." />;

    if (cenario === 'modo2' && corteExistente) {
      return (
        <>
          {corteExistente.pn && (
            <div className="op-criar-modal-aviso ok">
              <i className="fas fa-boxes"></i>
              <span>PC #{corteExistente.pn} — {corteExistente.quantidade} pçs disponíveis</span>
            </div>
          )}
          {demandasAtivas.length > 0 && (
            <div className="op-criar-modal-vinculo">
              <label className="op-criar-modal-vinculo-label">
                <input
                  type="checkbox"
                  checked={vincularDemanda}
                  onChange={(event) => setVincularDemanda(event.target.checked)}
                  className="op-criar-modal-vinculo-check"
                />
                <span>Vincular ao Painel de Demandas</span>
              </label>
              {vincularDemanda && (
                demandasAtivas.length === 1 ? (
                  <div className="op-criar-modal-vinculo-info">
                    <i className="fas fa-link"></i>
                    <span>
                      {demandasAtivas[0].produto_nome || demandasAtivas[0].produto_sku}
                      {demandasAtivas[0].variacao && demandasAtivas[0].variacao !== '-'
                        ? ` — ${demandasAtivas[0].variacao}`
                        : ''}
                      {' · '}{demandasAtivas[0].quantidade_solicitada} pçs
                      {demandasAtivas[0].data_solicitacao && (
                        ` · ${new Date(demandasAtivas[0].data_solicitacao).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
                      )}
                      {parseInt(String(demandasAtivas[0].prioridade), 10) === 1 ? ' ⚡ Urgente' : ''}
                    </span>
                  </div>
                ) : (
                  <select
                    className="op-criar-modal-input op-criar-modal-vinculo-select"
                    value={demandaVinculadaId || ''}
                    onChange={(event) => setDemandaVinculadaId(event.target.value)}
                  >
                    {demandasAtivas.map((demanda) => {
                      const nome = demanda.produto_nome || demanda.produto_sku;
                      const variacao = demanda.variacao && demanda.variacao !== '-' ? ` — ${demanda.variacao}` : '';
                      const data = demanda.data_solicitacao
                        ? ` · ${new Date(demanda.data_solicitacao).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
                        : '';
                      const urgente = parseInt(String(demanda.prioridade), 10) === 1 ? ' ⚡ Urgente' : '';
                      return <option key={demanda.id} value={String(demanda.id)}>{nome}{variacao} — {demanda.quantidade_solicitada} pçs{data}{urgente}</option>;
                    })}
                  </select>
                )
              )}
            </div>
          )}
          {renderFormQtd(corteExistente.quantidade)}
          {renderFormBase()}
        </>
      );
    }

    if (cenario === 'vazio') {
      return (
        <>
          <div className="op-criar-modal-aviso info">
            <i className="fas fa-info-circle"></i>
            <span>Nenhum corte em estoque para este produto. Um novo corte será criado automaticamente com a quantidade informada.</span>
          </div>
          {renderFormQtd(null)}
          {renderFormBase()}
        </>
      );
    }

    if (cenario === 'exato' && corteUsado) {
      return (
        <>
          <div className="op-criar-modal-aviso ok">
            <i className="fas fa-check-circle"></i>
            <span>Corte perfeito encontrado! <strong>PC #{corteUsado.pn}</strong> com {corteUsado.quantidade} pçs disponíveis.</span>
          </div>
          {renderFormQtd(corteUsado.quantidade)}
          {renderFormBase()}
        </>
      );
    }

    if (cenario === 'sobra' && corteUsado) {
      const saldo = corteUsado.quantidade - needed;
      return (
        <>
          <div className="op-criar-modal-aviso alerta">
            <i className="fas fa-exclamation-triangle"></i>
            <span><strong>PC #{corteUsado.pn}</strong> tem {corteUsado.quantidade} pçs disponíveis. Serão usadas <strong>{needed} pçs</strong> — confirme a quantidade antes de criar.{saldo > 0 && <> O saldo de <strong>{saldo} pçs</strong> ficará em estoque.</>}</span>
          </div>
          {renderFormQtd(corteUsado.quantidade)}
          {renderFormBase()}
        </>
      );
    }

    if (cenario === 'parcial' && corteUsado) {
      const restante = needed - corteUsado.quantidade;
      return (
        <>
          <div className="op-criar-modal-aviso alerta">
            <i className="fas fa-exclamation-triangle"></i>
            <span>Estoque insuficiente: <strong>PC #{corteUsado.pn}</strong> tem apenas <strong>{corteUsado.quantidade} pçs</strong>, mas você precisa de <strong>{needed} pçs</strong>.</span>
          </div>
          <div className="op-criar-modal-grupo">
            <label>Como prosseguir?</label>
            <div className="op-criar-modal-opcoes">
              <div className={`op-criar-modal-opcao${opcaoParcial === 'A' ? ' selecionada' : ''}`} onClick={() => setOpcaoParcial('A')}>
                <i className={`fas ${opcaoParcial === 'A' ? 'fa-dot-circle' : 'fa-circle'} op-criar-modal-opcao-icone`}></i>
                <div className="op-criar-modal-opcao-texto">
                  <strong>Criar novo corte de {needed} pçs</strong>
                  <span>Ignora as {corteUsado.quantidade} pçs em estoque — OP de {needed} pçs</span>
                </div>
              </div>
              <div className={`op-criar-modal-opcao${opcaoParcial === 'B' ? ' selecionada' : ''}`} onClick={() => setOpcaoParcial('B')}>
                <i className={`fas ${opcaoParcial === 'B' ? 'fa-dot-circle' : 'fa-circle'} op-criar-modal-opcao-icone`}></i>
                <div className="op-criar-modal-opcao-texto">
                  <strong>Aproveitar as {corteUsado.quantidade} pçs existentes (PC #{corteUsado.pn})</strong>
                  <span>Adiciona {restante} pçs ao mesmo corte → 1 OP completa de {needed} pçs</span>
                </div>
              </div>
            </div>
          </div>
          {renderFormBase()}
        </>
      );
    }

    return null;
  };

  return (
    <div className="gs-busca-modal-overlay centrado" onClick={onClose}>
      <div className="op-criar-modal" onClick={(event) => event.stopPropagation()}>
        <div className="op-criar-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <img src={imagemExibicao} alt={nomeExibicao} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div className="op-criar-modal-titulo">{nomeExibicao}</div>
              {nomeVariante && nomeVariante !== '-' && <div className="op-criar-modal-variante">{nomeVariante}</div>}
              {!modoComCorte && quantidadeSugerida > 0 && <div className="op-criar-modal-meta">Demanda: {quantidadeSugerida} pçs</div>}
            </div>
          </div>
          <button className="op-criar-modal-fechar" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="op-criar-modal-body">{renderCenario()}</div>

        {cenario !== 'carregando' && (
          <div className="op-criar-modal-footer">
            <button className="gs-btn gs-btn-secundario" onClick={onClose} disabled={carregando}>Cancelar</button>
            <button className="gs-btn gs-btn-primario" onClick={() => void handleCriar()} disabled={carregando}>{textoBotao()}</button>
          </div>
        )}
      </div>
    </div>
  );
}
