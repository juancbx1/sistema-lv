// public/src/components/OPCortesTela.jsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import OPSelecaoProdutoCorte from './OPSelecaoProdutoCorte.jsx';
import OPSelecaoVarianteCorte from './OPSelecaoVarianteCorte.jsx';
import OPRegistroCorte from './OPRegistroCorte.jsx';
import OPCorteEstoqueCard from './OPCorteEstoqueCard.jsx';
import OPFormulario from './OPFormulario.jsx';
import OPCriarModal from './OPCriarModal.jsx';
import OPPaginacaoWrapper from './OPPaginacaoWrapper.tsx';
import OPCortesRadar from './OPCortesRadar.jsx';
import OPCortesAgente from './OPCortesAgente.jsx';
import OPQuickLogModal from './OPQuickLogModal.jsx';
import { obterProdutos as obterProdutosDoStorage } from '/js/utils/storage.js';
import { mostrarMensagem, mostrarConfirmacao } from '/js/utils/popups.js';
import UICarregando from './UICarregando';

async function fetchCortesEmEstoque() {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/cortes?status=cortados', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Falha ao buscar cortes em estoque.');
    const cortes = await response.json();
    return cortes.filter(corte => corte.op === null);
}

export default function OPCortesTela() {
    // ── Estado principal ──
    const [passo, setPasso] = useState(0);
    const [corteSelecionado, setCorteSelecionado] = useState(null);
    const [produtos, setProdutos] = useState([]);
    const [cortesEmEstoque, setCortesEmEstoque] = useState([]);
    const [produtoSelecionado, setProdutoSelecionado] = useState(null);
    const [varianteSelecionada, setVarianteSelecionada] = useState(null);
    const [quantidadePreenchida, setQuantidadePreenchida] = useState('');
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);
    const [usuarioLogado, setUsuarioLogado] = useState(null);
    const [gerandoOP, setGerandoOP] = useState(null);
    const [paginaCortes, setPaginaCortes] = useState(1);
    const paginacaoRef = useRef(null);
    // Mapa produto_id|variante → demandas pendentes — para badge visual nos cards de corte
    const [demandasMap, setDemandasMap] = useState(new Map());

    // ── OPCriarModal (Modo 2 — Estoque de Cortes) ──
    const [opCriarModalAberto, setOpCriarModalAberto] = useState(false);
    const [corteParaOP, setCorteParaOP] = useState(null);

    // ── Estado novo ──
    const [quickLogAberto, setQuickLogAberto] = useState(false);
    const [quickLogPreenchido, setQuickLogPreenchido] = useState(null); // {produto, variante, quantidadeSugerida}
    const [radarRefreshKey, setRadarRefreshKey] = useState(0);
    const [agenteRescanKey, setAgenteRescanKey] = useState(0);
    const [refreshingEstoque, setRefreshingEstoque] = useState(false);

    const ITENS_POR_PAGINA_CORTES = 6;

    // ── Carregamento de dados ──
    const carregarDados = useCallback(async () => {
        setCarregando(true);
        try {
            const token = localStorage.getItem('token');
            if (!token) throw new Error('Não autenticado');

            const [todosProdutos, dadosUsuario, cortesData, demandasData] = await Promise.all([
                obterProdutosDoStorage(),
                fetch('/api/usuarios/me', {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(res => res.json()),
                fetchCortesEmEstoque(),
                fetch('/api/demandas', {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => r.ok ? r.json() : []).catch(() => []),
            ]);

            if (dadosUsuario.error) throw new Error(dadosUsuario.error);

            const produtosSimples = todosProdutos.filter(p => !p.is_kit);
            setProdutos(produtosSimples);
            setUsuarioLogado(dadosUsuario);
            setCortesEmEstoque(cortesData);
            setPaginaCortes(1);

            // Constrói mapa produto_id|variante → demandas pendentes (para badge nos cards)
            // Filtra só demandas ativas (pendente ou em_atendimento) e não arquivadas
            const demandasPendentes = Array.isArray(demandasData)
                ? demandasData.filter(d => ['pendente', 'em_atendimento'].includes(d.status))
                : [];

            const novoMap = new Map();
            for (const d of demandasPendentes) {
                if (!d.produto_sku) continue;
                const skuBusca = d.produto_sku.trim().toUpperCase();
                // Resolve produto_id e variante a partir do produto_sku
                for (const p of produtosSimples) {
                    let match = false;
                    let varianteResolvida = null;
                    const gradeArr = Array.isArray(p.grade) ? p.grade : [];

                    if (p.sku && p.sku.trim().toUpperCase() === skuBusca) {
                        match = true; // SKU principal do produto
                    } else {
                        const g = gradeArr.find(g => g.sku && g.sku.trim().toUpperCase() === skuBusca);
                        if (g) {
                            match = true;
                            varianteResolvida = g.variacao || null;
                        }
                    }

                    if (match) {
                        const chave = `${p.id}|${varianteResolvida || '-'}`;
                        if (!novoMap.has(chave)) novoMap.set(chave, []);
                        novoMap.get(chave).push({
                            id: d.id,
                            quantidade_solicitada: d.quantidade_solicitada,
                            prioridade: d.prioridade,
                            data_solicitacao: d.data_solicitacao,
                            produto_nome: p.nome,
                            variacao: varianteResolvida,
                        });
                        break;
                    }
                }
            }
            setDemandasMap(novoMap);
        } catch (err) {
            setErro(`Falha ao carregar dados: ${err.message}`);
        } finally {
            setCarregando(false);
        }
    }, []);

    useEffect(() => { carregarDados(); }, [carregarDados]);

    // ── Refresh silencioso: atualiza cortes + demandas sem mostrar spinner de loading ──
    // Usado pelo polling e pelo evento painel-demandas-fechado para não piscar a tela.
    const refreshSilencioso = useCallback(async () => {
        try {
            const token = localStorage.getItem('token');
            if (!token) return;
            const [cortesData, demandasData] = await Promise.all([
                fetchCortesEmEstoque(),
                fetch('/api/demandas', { headers: { 'Authorization': `Bearer ${token}` } })
                    .then(r => r.ok ? r.json() : []).catch(() => []),
            ]);
            setCortesEmEstoque(cortesData);

            // Reconstrói demandasMap usando produtos já carregados no estado
            const demandasPendentes = Array.isArray(demandasData)
                ? demandasData.filter(d => ['pendente', 'em_atendimento'].includes(d.status))
                : [];
            const novoMap = new Map();
            for (const d of demandasPendentes) {
                if (!d.produto_sku) continue;
                const skuBusca = d.produto_sku.trim().toUpperCase();
                for (const p of produtos) {
                    let match = false, varianteResolvida = null;
                    const gradeArr = Array.isArray(p.grade) ? p.grade : [];
                    if (p.sku && p.sku.trim().toUpperCase() === skuBusca) {
                        match = true;
                    } else {
                        const g = gradeArr.find(g => g.sku && g.sku.trim().toUpperCase() === skuBusca);
                        if (g) { match = true; varianteResolvida = g.variacao || null; }
                    }
                    if (match) {
                        const chave = `${p.id}|${varianteResolvida || '-'}`;
                        if (!novoMap.has(chave)) novoMap.set(chave, []);
                        novoMap.get(chave).push({
                            id: d.id,
                            quantidade_solicitada: d.quantidade_solicitada,
                            prioridade: d.prioridade,
                            data_solicitacao: d.data_solicitacao,
                            produto_nome: p.nome,
                            variacao: varianteResolvida,
                        });
                        break;
                    }
                }
            }
            setDemandasMap(novoMap);
        } catch { /* falha silenciosa — não exibir erro ao usuário */ }
    }, [produtos]);

    // ── Auto-refresh ao retornar à aba do navegador ──
    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState !== 'visible') return;
            carregarDados();
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [carregarDados]);

    // ── Refresh ao fechar o Painel de Demandas (FAB lateral) ──
    // O supervisor pode abrir o painel, ver uma demanda nova criada pelo gerente,
    // fechar o painel e voltar para o estoque — sem perceber que o badge de demanda
    // ainda não aparece nos cards. Este listener corrige exatamente esse cenário.
    useEffect(() => {
        const handler = () => refreshSilencioso();
        window.addEventListener('painel-demandas-fechado', handler);
        return () => window.removeEventListener('painel-demandas-fechado', handler);
    }, [refreshSilencioso]);

    // ── Polling de 60s: safety net para dados ficarem sempre frescos ──
    // Garante que mesmo sem nenhuma interação do usuário, o estoque não fique
    // desatualizado por mais de 1 minuto enquanto a aba estiver visível.
    useEffect(() => {
        const interval = setInterval(() => {
            if (document.visibilityState === 'visible') refreshSilencioso();
        }, 60_000);
        return () => clearInterval(interval);
    }, [refreshSilencioso]);

    // ── Refresh manual do estoque ──
    // Chama carregarDados completo para garantir que o mapa de demandas também seja atualizado
    const handleRefreshEstoque = useCallback(async () => {
        setRefreshingEstoque(true);
        try {
            await carregarDados();
            setRadarRefreshKey(k => k + 1);
        } catch {
            mostrarMensagem('Erro ao atualizar estoque.', 'erro');
        } finally {
            setRefreshingEstoque(false);
        }
    }, [carregarDados]);

    // ── Exclusão de corte ──
    const handleExcluirCorte = async (corte) => {
        const confirmado = await mostrarConfirmacao(
            `Excluir o corte PC #${corte.pn} (${corte.quantidade} pçs)?\nEsta ação remove o corte do estoque.`,
            { tipo: 'perigo', textoConfirmar: 'Sim, Excluir', textoCancelar: 'Cancelar' }
        );
        if (!confirmado) return;

        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/cortes', {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ id: corte.id })
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Falha ao excluir corte.');
            }
            mostrarMensagem('Corte excluído com sucesso.', 'sucesso');
            setRadarRefreshKey(k => k + 1);
            carregarDados();
        } catch (err) {
            mostrarMensagem(err.message, 'erro');
        }
    };

    // ── Quick Log: sucesso ──
    const handleQuickLogSuccess = () => {
        const vinhDoAgente = !!quickLogPreenchido;
        setQuickLogAberto(false);
        setQuickLogPreenchido(null);
        setRadarRefreshKey(k => k + 1);
        carregarDados();
        // Se o corte foi via agente, dispara rescan automático do plano
        if (vinhDoAgente) {
            setAgenteRescanKey(k => k + 1);
        }
    };

    // ── Agente: "Cortar Agora" pré-preenche o Quick-Log ──
    const handleCortarAgora = ({ produto, variante, quantidadeSugerida }) => {
        setQuickLogPreenchido({ produto, variante, quantidadeSugerida });
        setQuickLogAberto(true);
    };


    // ── Handlers do wizard ──
    const handleProdutoSelect = (produto) => { setProdutoSelecionado(produto); setPasso(2); };
    const handleVarianteSelect = (variante) => { setVarianteSelecionada(variante); setPasso(3); };

    const handleCorteRegistrado = () => {
        setProdutoSelecionado(null);
        setVarianteSelecionada(null);
        setQuantidadePreenchida('');
        setPasso(0);
        setGerandoOP(null);
        setRadarRefreshKey(k => k + 1);
        carregarDados();
    };

    const handleGerarOP = (corte) => {
        if (gerandoOP) return;
        setCorteParaOP(corte);
        setOpCriarModalAberto(true);
    };

    const handleOPCriada = () => {
        setCorteSelecionado(null);
        setPasso(0);
        setGerandoOP(null);
        carregarDados();
    };

    const handleOPCriadaModal = () => {
        setOpCriarModalAberto(false);
        setCorteParaOP(null);
        setGerandoOP(null);
        carregarDados();
    };

    const voltarPasso = () => {
        if (passo === 4) {
            setGerandoOP(null);
            setCorteSelecionado(null);
            setPasso(0);
            return;
        }
        if (passo === 1) setProdutoSelecionado(null);
        if (passo === 2) setVarianteSelecionada(null);
        if (passo === 3) setQuantidadePreenchida('');
        if (passo > 1) setPasso(passo - 1);
        else {
            setPasso(0);
            setProdutoSelecionado(null);
            setVarianteSelecionada(null);
        }
    };

    // ── Render da vista principal (passo 0) ──
    const renderVistaPrincipal = () => {
        const totalPaginasCortes = Math.ceil(cortesEmEstoque.length / ITENS_POR_PAGINA_CORTES);
        const cortesPaginados = cortesEmEstoque.slice(
            (paginaCortes - 1) * ITENS_POR_PAGINA_CORTES,
            paginaCortes * ITENS_POR_PAGINA_CORTES
        );

        return (
            <>
                {/* RADAR — botão "Registrar Corte" vive aqui */}
                <OPCortesRadar
                    refreshKey={radarRefreshKey}
                    onRegistrarCorte={quickLogAberto ? null : () => { setQuickLogPreenchido(null); setQuickLogAberto(true); }}
                />

                {/* Agente de Corte — idle card + terminal + resultado */}
                {!quickLogAberto && (
                    <OPCortesAgente
                        produtos={produtos}
                        onCortarAgora={handleCortarAgora}
                        rescanKey={agenteRescanKey}
                        cortesEmEstoque={cortesEmEstoque}
                        nomeUsuario={(usuarioLogado?.nome || '').split(' ')[0] || null}
                    />
                )}

                {/* Quick-Log inline (abre embaixo dos controles) */}
                {quickLogAberto && (
                    <div className="op-cortes-acoes-header">
                        <OPQuickLogModal
                            produtos={produtos}
                            usuario={usuarioLogado}
                            onClose={() => { setQuickLogAberto(false); setQuickLogPreenchido(null); }}
                            onSuccess={handleQuickLogSuccess}
                            preenchido={quickLogPreenchido}
                        />
                    </div>
                )}

                {/* ESTOQUE */}
                {!quickLogAberto && (
                    <div className="op-cortes-estoque-secao">
                        {/* Título — padronizado com outras seções, não mexer */}
                        <div className="op-cortes-estoque-titulo-row">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <h3 className="op-cortes-estoque-titulo">
                                    <i className="fas fa-boxes"></i>
                                    Estoque de Cortes
                                </h3>
                                <button
                                    className="op-cortes-refresh-btn"
                                    onClick={handleRefreshEstoque}
                                    disabled={refreshingEstoque}
                                    title="Atualizar estoque"
                                >
                                    <i className={`fas fa-sync-alt${refreshingEstoque ? ' fa-spin' : ''}`}></i>
                                </button>
                            </div>
                            {cortesEmEstoque.length > 0 && (
                                <span className="op-cortes-estoque-badge">
                                    {cortesEmEstoque.length} {cortesEmEstoque.length === 1 ? 'lote' : 'lotes'}
                                </span>
                            )}
                        </div>

                        {/* Grid de itens em estoque */}
                        <div className="op-corte-lista">
                            {cortesPaginados.length > 0 ? (
                                cortesPaginados.map(corte => {
                                    const produtoCompleto = produtos.find(p => p.id === corte.produto_id);
                                    const chaveCorte = `${corte.produto_id}|${corte.variante || '-'}`;
                                    const demandasDoCorte = demandasMap.get(chaveCorte) || [];
                                    return (
                                        <OPCorteEstoqueCard
                                            key={corte.id}
                                            corte={corte}
                                            produto={produtoCompleto}
                                            onGerarOP={handleGerarOP}
                                            onExcluir={handleExcluirCorte}
                                            isGerando={opCriarModalAberto && corteParaOP?.id === corte.id}
                                            demandasVinculadas={demandasDoCorte}
                                        />
                                    );
                                })
                            ) : (
                                <div className="op-cortes-estoque-vazio">
                                    <i className="fas fa-cut"></i>
                                    <p>Nenhum corte em estoque no momento.</p>
                                    <span>Use "Registrar Corte" acima para adicionar peças ao estoque.</span>
                                </div>
                            )}
                        </div>

                        {totalPaginasCortes > 1 && (
                            <div ref={paginacaoRef}>
                                <OPPaginacaoWrapper
                                    totalPages={totalPaginasCortes}
                                    currentPage={paginaCortes}
                                    onPageChange={(novaPagina) => {
                                        setPaginaCortes(novaPagina);
                                        requestAnimationFrame(() => {
                                            paginacaoRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
                                        });
                                    }}
                                />
                            </div>
                        )}
                    </div>
                )}
            </>
        );
    };

    return (
        <div className="op-cortes-tela">
            {/* Header com voltar (wizard) */}
            {passo > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
                    <button className="btn-voltar-header" onClick={voltarPasso}>
                        <i className="fas fa-arrow-left"></i> Voltar
                    </button>
                    <h2 className="op-titulo-secao" style={{ flexGrow: 1, textAlign: 'center', borderBottom: 'none', marginBottom: 0 }}>
                        Área de Cortes
                    </h2>
                    <div className="op-header-spacer"></div>
                </div>
            )}

            {/* Init terminal */}
            {carregando && <UICarregando variante="bloco" />}

            {erro && <p style={{ color: 'red', textAlign: 'center' }}>{erro}</p>}

            {/* Vista principal */}
            {!carregando && !erro && passo === 0 && renderVistaPrincipal()}

            {/* Wizard */}
            {!carregando && !erro && passo === 1 && (
                <>
                    <h3 className="op-subtitulo-secao">Passo 1: Selecione o Produto</h3>
                    <OPSelecaoProdutoCorte produtos={produtos} onProdutoSelect={handleProdutoSelect} />
                </>
            )}
            {!carregando && !erro && passo === 2 && (
                <>
                    <h3 className="op-subtitulo-secao">Passo 2: Selecione a Variação de "{produtoSelecionado?.nome}"</h3>
                    <OPSelecaoVarianteCorte produto={produtoSelecionado} onVarianteSelect={handleVarianteSelect} />
                </>
            )}
            {!carregando && !erro && passo === 3 && (
                <>
                    <h3 className="op-subtitulo-secao">Passo 3: Informe a Quantidade</h3>
                    <OPRegistroCorte
                        key={quantidadePreenchida ? `corte-pre-${quantidadePreenchida}` : 'corte-novo'}
                        produto={produtoSelecionado}
                        variante={varianteSelecionada}
                        usuario={usuarioLogado}
                        onCorteRegistrado={handleCorteRegistrado}
                        quantidadeInicial={quantidadePreenchida}
                    />
                </>
            )}
            {!carregando && !erro && passo === 4 && (
                <>
                    <h3 className="op-subtitulo-secao">Gerar Ordem de Produção</h3>
                    <OPFormulario
                        corteSelecionado={corteSelecionado}
                        onOPCriada={handleOPCriada}
                        onSetGerando={setGerandoOP}
                    />
                </>
            )}

            {/* Modal rápido de criação de OP — Modo 2 (Estoque de Cortes) */}
            {corteParaOP && (
                <OPCriarModal
                    isOpen={opCriarModalAberto}
                    onClose={() => { setOpCriarModalAberto(false); setCorteParaOP(null); setGerandoOP(null); }}
                    onOPCriada={handleOPCriadaModal}
                    corteExistente={corteParaOP}
                />
            )}
        </div>
    );
}
