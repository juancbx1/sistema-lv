// public/src/components/OPCriarModal.jsx

import React, { useState, useEffect } from 'react';
import { mostrarMensagem } from '/js/utils/popups.js';
import { obterProdutos } from '/js/utils/storage.js';
import UICarregando from './UICarregando';

// ── Helpers de API ──────────────────────────────────────────

function hoje() { return new Date().toISOString().split('T')[0]; }
function norm(v) { return (!v || v === '-' || v === '') ? null : String(v).trim(); }

async function fetchCortesDisponiveis(produtoId, variante) {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/cortes?status=cortados', {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const todos = await res.json();
    const varianteAlvo = norm(variante);
    return todos.filter(c =>
        c.produto_id === produtoId &&
        norm(c.variante) === varianteAlvo &&
        c.op === null
    );
}

async function getNextOPNumber() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/ordens-de-producao?getNextNumber=true', {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Falha ao obter número de OP.');
    const nums = await res.json();
    const max = nums.map(n => parseInt(n)).filter(n => !isNaN(n)).reduce((m, c) => Math.max(m, c), 0);
    return (max + 1).toString();
}

async function apiCriarCorte(token, payload) {
    const res = await fetch('/api/cortes', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Falha ao registrar corte.');
    }
    return res.json();
}

async function apiCriarOP(token, payload) {
    const res = await fetch('/api/ordens-de-producao', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Falha ao criar OP.');
    }
    return res.json();
}

// ── Componente ───────────────────────────────────────────────

/**
 * Cenários (Mode 1 — Painel de Demandas):
 *   'carregando' — buscando estoque
 *   'vazio'      — sem cortes em estoque → cria corte novo + OP
 *   'exato'      — corte tem exatamente a quantidade necessária
 *   'sobra'      — corte tem mais do que precisa (split automático pelo backend)
 *   'parcial'    — corte tem menos do que precisa → escolha do supervisor
 *
 * Mode 2 — Estoque de Cortes: corteExistente já definido, UI simplificada.
 */
export default function OPCriarModal({
    isOpen,
    onClose,
    onOPCriada,
    // Mode 1 props
    demandaId = null,
    produtoId = null,
    variante = null,
    quantidadeSugerida = 0,
    // Mode 2 props
    corteExistente = null,
}) {
    const modoComCorte = !!corteExistente;

    const [cenario, setCenario]         = useState('carregando');
    const [corteUsado, setCorteUsado]   = useState(null);
    const [opcaoParcial, setOpcaoParcial] = useState('A');

    const [quantidade, setQuantidade]   = useState('');
    const [dataEntrega, setDataEntrega] = useState(hoje());
    const [observacoes, setObservacoes] = useState('');
    const [carregando, setCarregando]   = useState(false);
    const [produtoInfo, setProdutoInfo] = useState(null);

    // ── Vínculo de demanda (Modo 2) ──
    const [demandasAtivas, setDemandasAtivas]       = useState([]);
    const [vincularDemanda, setVincularDemanda]     = useState(true);
    const [demandaVinculadaId, setDemandaVinculadaId] = useState(null);

    // ── Inicialização ao abrir ──
    useEffect(() => {
        if (!isOpen) return;
        setDataEntrega(hoje());
        setObservacoes('');
        setOpcaoParcial('A');
        setCorteUsado(null);
        setDemandasAtivas([]);
        setVincularDemanda(true);
        setDemandaVinculadaId(null);

        if (modoComCorte) {
            // Resolve imagem da variante a partir do grade do produto (mesmo padrão do Modo 1)
            obterProdutos().then(produtos => {
                const p = produtos.find(x => x.id === corteExistente.produto_id);
                if (p) {
                    let img = p.imagem;
                    const varNorm = corteExistente.variante && corteExistente.variante !== '-'
                        ? corteExistente.variante : null;
                    if (varNorm && Array.isArray(p.grade)) {
                        const g = p.grade.find(g => g.variacao === varNorm);
                        if (g?.imagem) img = g.imagem;
                    }
                    setProdutoInfo({ nome: p.nome, imagem: img || '/img/placeholder-image.png' });
                } else {
                    // Fallback para o dado que vem do corte
                    setProdutoInfo({
                        nome: corteExistente.produto || 'Produto',
                        imagem: corteExistente.imagem_produto || '/img/placeholder-image.png',
                    });
                }
            }).catch(() => {
                setProdutoInfo({
                    nome: corteExistente.produto || 'Produto',
                    imagem: corteExistente.imagem_produto || '/img/placeholder-image.png',
                });
            });

            setQuantidade(corteExistente.quantidade || 1);
            setCenario('modo2');

            // Busca demandas pendentes para o produto+variante — mostra checkbox de vínculo se encontrar
            if (corteExistente.produto_id) {
                const token = localStorage.getItem('token');
                const varParam = corteExistente.variante && corteExistente.variante !== '-'
                    ? `&variante=${encodeURIComponent(corteExistente.variante)}`
                    : '';
                fetch(`/api/demandas/pendentes-por-produto?produto_id=${corteExistente.produto_id}${varParam}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                })
                    .then(r => r.ok ? r.json() : [])
                    .then(data => {
                        if (Array.isArray(data) && data.length > 0) {
                            setDemandasAtivas(data);
                            setDemandaVinculadaId(String(data[0].id));
                        }
                    })
                    .catch(() => {}); // falha silenciosa — fluxo normal sem vínculo
            }
            return;
        }

        // Mode 1: busca estoque e determina cenário
        const needed = Math.max(1, quantidadeSugerida || 1);
        setQuantidade(needed);
        setCenario('carregando');

        Promise.all([
            obterProdutos(),
            fetchCortesDisponiveis(produtoId, variante),
        ]).then(([produtos, cortes]) => {
            // Info do produto
            const p = produtos.find(x => x.id === produtoId);
            if (p) {
                let img = p.imagem;
                if (variante && p.grade) {
                    const g = p.grade.find(g => g.variacao === variante);
                    if (g?.imagem) img = g.imagem;
                }
                setProdutoInfo({ nome: p.nome, imagem: img || '/img/placeholder-image.png' });
            }

            if (cortes.length === 0) {
                setCenario('vazio');
                return;
            }

            // Encontra o melhor corte único:
            // 1ª prioridade: menor corte com qty >= needed (mínimo desperdício de split)
            // 2ª prioridade: maior corte disponível (parcial — aproveita o que tem)
            const suficientes = cortes
                .filter(c => c.quantidade >= needed)
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
        }).catch(() => {
            setCenario('vazio'); // fallback seguro
        });
    }, [isOpen]);

    if (!isOpen) return null;

    const needed     = Math.max(1, quantidadeSugerida || 1);
    const nomeVariante  = modoComCorte ? corteExistente.variante : variante;
    const nomeExibicao  = produtoInfo?.nome || '...';
    const imagemExibicao = produtoInfo?.imagem || '/img/placeholder-image.png';

    // Quantidade máxima editável por cenário
    const maxQtd =
        cenario === 'modo2'  ? corteExistente.quantidade :
        cenario === 'exato'  ? corteUsado?.quantidade :
        cenario === 'sobra'  ? corteUsado?.quantidade :
        null; // vazio e parcial não têm max (parcial usa qtd fixa)

    // ── Submit ──
    const handleCriar = async () => {
        if (cenario === 'carregando') return;
        const token = localStorage.getItem('token');
        setCarregando(true);

        try {
            // ── Mode 2: usa corteExistente ──
            if (cenario === 'modo2') {
                const qtd = parseInt(quantidade, 10);
                if (!qtd || qtd <= 0) return mostrarMensagem('Quantidade inválida.', 'aviso');
                if (!dataEntrega) return mostrarMensagem('Informe a data de entrega.', 'aviso');
                if (qtd > corteExistente.quantidade) return mostrarMensagem(`Máximo: ${corteExistente.quantidade} pçs.`, 'aviso');

                const demandaIdFinal = (vincularDemanda && demandaVinculadaId)
                    ? parseInt(demandaVinculadaId, 10)
                    : null;

                const numOP = await getNextOPNumber();
                const op = await apiCriarOP(token, {
                    numero: numOP,
                    produto_id: corteExistente.produto_id,
                    variante: corteExistente.variante,
                    quantidade: qtd,
                    data_entrega: dataEntrega,
                    observacoes: observacoes || null,
                    status: 'produzindo',
                    corte_origem_id: corteExistente.id,
                    demanda_id: demandaIdFinal,
                });
                mostrarMensagem(`OP #${op.numero} criada (${qtd} pçs)!`, 'sucesso');
                onOPCriada(); onClose();
                return;
            }

            // ── Vazio: cria corte novo → OP ──
            if (cenario === 'vazio') {
                const qtd = parseInt(quantidade, 10);
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
                onOPCriada(); onClose();
                return;
            }

            // ── Exato ou Sobra: usa corte existente (backend faz split se necessário) ──
            if (cenario === 'exato' || cenario === 'sobra') {
                const qtd = parseInt(quantidade, 10);
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
                onOPCriada(); onClose();
                return;
            }

            // ── Parcial: supervisor escolheu A ou B ──
            if (cenario === 'parcial') {
                if (!dataEntrega) return mostrarMensagem('Informe a data de entrega.', 'aviso');

                if (opcaoParcial === 'A') {
                    // Opção A: cria corte novo de `needed` → OP de `needed`
                    const corte = await apiCriarCorte(token, {
                        produto_id: produtoId,
                        variante: norm(variante),
                        quantidade: needed,
                        data: hoje(),
                        status: 'cortados',
                        demanda_id: demandaId || null,
                    });
                    const numOP = await getNextOPNumber();
                    const op = await apiCriarOP(token, {
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
                    mostrarMensagem(`OP #${op.numero} criada (${needed} pçs)!`, 'sucesso');
                } else {
                    // Opção B: expande o corte existente de X → needed pçs
                    //           → 1 OP completa de needed pçs sobre o mesmo corte
                    const resAtualizar = await fetch('/api/cortes', {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: corteUsado.id, quantidade: needed }),
                    });
                    if (!resAtualizar.ok) {
                        const err = await resAtualizar.json();
                        throw new Error(err.error || 'Falha ao atualizar o corte.');
                    }

                    const numOP = await getNextOPNumber();
                    const op = await apiCriarOP(token, {
                        numero: numOP,
                        produto_id: produtoId,
                        variante: norm(variante),
                        quantidade: needed,
                        data_entrega: dataEntrega,
                        observacoes: observacoes || null,
                        status: 'produzindo',
                        corte_origem_id: corteUsado.id,
                        demanda_id: demandaId || null,
                    });

                    mostrarMensagem(`OP #${op.numero} criada (${needed} pçs)!`, 'sucesso');
                }

                onOPCriada(); onClose();
            }
        } catch (err) {
            mostrarMensagem(err.message, 'erro');
        } finally {
            setCarregando(false);
        }
    };

    const handleQtdChange = (e) => {
        const v = e.target.value;
        if (v === '' || /^\d+$/.test(v)) {
            if (maxQtd !== null) {
                const n = parseInt(v, 10);
                if (isNaN(n) || n <= maxQtd) setQuantidade(v);
            } else {
                setQuantidade(v);
            }
        }
    };

    const ajustar = (delta) => {
        const atual = parseInt(quantidade, 10) || 0;
        const novo  = Math.max(1, atual + delta);
        if (maxQtd !== null && novo > maxQtd) return;
        setQuantidade(novo);
    };

    // Texto do botão de submit
    const textoBotao = () => {
        if (carregando) return <><i className="fas fa-circle-notch fa-spin"></i> Criando...</>;
        if (cenario === 'vazio') return <><i className="fas fa-plus"></i> Criar Corte + OP</>;
        if (cenario === 'parcial' && opcaoParcial === 'B') return <><i className="fas fa-check"></i> Completar Corte + Criar OP</>;
        return <><i className="fas fa-check"></i> Criar OP</>;
    };

    // ── Render dos blocos por cenário ──
    const renderCenario = () => {
        if (cenario === 'carregando') {
            return <UICarregando variante="bloco" texto="Verificando estoque de cortes..." />;
        }

        if (cenario === 'modo2') {
            return (
                <>
                    {corteExistente.pn && (
                        <div className="op-criar-modal-aviso ok">
                            <i className="fas fa-boxes"></i>
                            <span>PC #{corteExistente.pn} — {corteExistente.quantidade} pçs disponíveis</span>
                        </div>
                    )}

                    {/* Vínculo de demanda — aparece só se existirem demandas pendentes para o produto */}
                    {demandasAtivas.length > 0 && (
                        <div className="op-criar-modal-vinculo">
                            <label className="op-criar-modal-vinculo-label">
                                <input
                                    type="checkbox"
                                    checked={vincularDemanda}
                                    onChange={e => setVincularDemanda(e.target.checked)}
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
                                                ? ` — ${demandasAtivas[0].variacao}` : ''}
                                            {' · '}{demandasAtivas[0].quantidade_solicitada} pçs
                                            {demandasAtivas[0].data_solicitacao && (
                                                ` · ${new Date(demandasAtivas[0].data_solicitacao).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
                                            )}
                                            {parseInt(demandasAtivas[0].prioridade) === 1 ? ' ⚡ Urgente' : ''}
                                        </span>
                                    </div>
                                ) : (
                                    <select
                                        className="op-criar-modal-input op-criar-modal-vinculo-select"
                                        value={demandaVinculadaId || ''}
                                        onChange={e => setDemandaVinculadaId(e.target.value)}
                                    >
                                        {demandasAtivas.map(d => {
                                            const nome = d.produto_nome || d.produto_sku;
                                            const variacao = d.variacao && d.variacao !== '-' ? ` — ${d.variacao}` : '';
                                            const data = d.data_solicitacao
                                                ? ` · ${new Date(d.data_solicitacao).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
                                                : '';
                                            const urgente = parseInt(d.prioridade) === 1 ? ' ⚡ Urgente' : '';
                                            return (
                                                <option key={d.id} value={String(d.id)}>
                                                    {nome}{variacao} — {d.quantidade_solicitada} pçs{data}{urgente}
                                                </option>
                                            );
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
                        <span>
                            Nenhum corte em estoque para este produto.
                            Um novo corte será criado automaticamente com a quantidade informada.
                        </span>
                    </div>
                    {renderFormQtd(null)}
                    {renderFormBase()}
                </>
            );
        }

        if (cenario === 'exato') {
            return (
                <>
                    <div className="op-criar-modal-aviso ok">
                        <i className="fas fa-check-circle"></i>
                        <span>
                            Corte perfeito encontrado! <strong>PC #{corteUsado.pn}</strong> com {corteUsado.quantidade} pçs disponíveis.
                        </span>
                    </div>
                    {renderFormQtd(corteUsado.quantidade)}
                    {renderFormBase()}
                </>
            );
        }

        if (cenario === 'sobra') {
            const saldo = corteUsado.quantidade - needed;
            return (
                <>
                    <div className="op-criar-modal-aviso alerta">
                        <i className="fas fa-exclamation-triangle"></i>
                        <span>
                            <strong>PC #{corteUsado.pn}</strong> tem {corteUsado.quantidade} pçs disponíveis.
                            Serão usadas <strong>{needed} pçs</strong> — confirme a quantidade antes de criar.
                            {saldo > 0 && <> O saldo de <strong>{saldo} pçs</strong> ficará em estoque.</>}
                        </span>
                    </div>
                    {renderFormQtd(corteUsado.quantidade)}
                    {renderFormBase()}
                </>
            );
        }

        if (cenario === 'parcial') {
            const restante = needed - corteUsado.quantidade;
            return (
                <>
                    <div className="op-criar-modal-aviso alerta">
                        <i className="fas fa-exclamation-triangle"></i>
                        <span>
                            Estoque insuficiente: <strong>PC #{corteUsado.pn}</strong> tem apenas{' '}
                            <strong>{corteUsado.quantidade} pçs</strong>, mas você precisa de <strong>{needed} pçs</strong>.
                        </span>
                    </div>

                    <div className="op-criar-modal-grupo">
                        <label>Como prosseguir?</label>
                        <div className="op-criar-modal-opcoes">
                            <div
                                className={`op-criar-modal-opcao${opcaoParcial === 'A' ? ' selecionada' : ''}`}
                                onClick={() => setOpcaoParcial('A')}
                            >
                                <i className={`fas ${opcaoParcial === 'A' ? 'fa-dot-circle' : 'fa-circle'} op-criar-modal-opcao-icone`}></i>
                                <div className="op-criar-modal-opcao-texto">
                                    <strong>Criar novo corte de {needed} pçs</strong>
                                    <span>Ignora as {corteUsado.quantidade} pçs em estoque — OP de {needed} pçs</span>
                                </div>
                            </div>
                            <div
                                className={`op-criar-modal-opcao${opcaoParcial === 'B' ? ' selecionada' : ''}`}
                                onClick={() => setOpcaoParcial('B')}
                            >
                                <i className={`fas ${opcaoParcial === 'B' ? 'fa-dot-circle' : 'fa-circle'} op-criar-modal-opcao-icone`}></i>
                                <div className="op-criar-modal-opcao-texto">
                                    <strong>Aproveitar as {corteUsado.quantidade} pçs existentes (PC #{corteUsado.pn})</strong>
                                    <span>
                                        Adiciona {restante} pçs ao mesmo corte → 1 OP completa de {needed} pçs
                                    </span>
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

    // Bloco de quantidade com +/- (omitido no cenário parcial)
    const renderFormQtd = (max) => (
        <div className="op-criar-modal-grupo">
            <label>Quantidade</label>
            <div className="op-criar-modal-qtd-row">
                <button type="button" className="op-criar-modal-qtd-btn" onClick={() => ajustar(-1)}>−</button>
                <input
                    type="number"
                    className="op-criar-modal-input"
                    value={quantidade}
                    onChange={handleQtdChange}
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

    // Data + Observações (comuns a todos os cenários, exceto carregando)
    const renderFormBase = () => (
        <>
            <div className="op-criar-modal-grupo">
                <label>Data de entrega</label>
                <input
                    type="date"
                    className="op-criar-modal-input"
                    value={dataEntrega}
                    onChange={e => setDataEntrega(e.target.value)}
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
                    onChange={e => setObservacoes(e.target.value)}
                    placeholder="Ex: urgente, cliente especial..."
                    style={{ resize: 'vertical' }}
                />
            </div>
        </>
    );

    return (
        <div className="gs-busca-modal-overlay centrado" onClick={onClose}>
            <div className="op-criar-modal" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="op-criar-modal-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        <img
                            src={imagemExibicao}
                            alt={nomeExibicao}
                            style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                        />
                        <div style={{ minWidth: 0 }}>
                            <div className="op-criar-modal-titulo">{nomeExibicao}</div>
                            {nomeVariante && nomeVariante !== '-' && (
                                <div className="op-criar-modal-variante">{nomeVariante}</div>
                            )}
                            {!modoComCorte && quantidadeSugerida > 0 && (
                                <div className="op-criar-modal-meta">Demanda: {quantidadeSugerida} pçs</div>
                            )}
                        </div>
                    </div>
                    <button className="op-criar-modal-fechar" onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* Body */}
                <div className="op-criar-modal-body">
                    {renderCenario()}
                </div>

                {/* Footer (oculto durante carregamento inicial) */}
                {cenario !== 'carregando' && (
                    <div className="op-criar-modal-footer">
                        <button className="gs-btn gs-btn-secundario" onClick={onClose} disabled={carregando}>
                            Cancelar
                        </button>
                        <button className="gs-btn gs-btn-primario" onClick={handleCriar} disabled={carregando}>
                            {textoBotao()}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
