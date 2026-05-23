// public/src/components/OPGerenciamentoTela.jsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { OPCard } from './OPCard.jsx';
import OPEtapasModal from './OPEtapasModal.jsx';
import OPModalLote from './OPModalLote.jsx';
import OPFiltros from './OPFiltros.jsx';
import OPPaginacaoWrapper from './OPPaginacaoWrapper.jsx';
import OPCentralEncerramento from './OPCentralEncerramento.jsx';
import { obterProdutos as obterProdutosDoStorage } from '/js/utils/storage.js';
import { mostrarConfirmacao, mostrarToast } from '/js/utils/popups.js';
import UICarregando from './UICarregando.jsx';

export default function OPGerenciamentoTela({ opsPendentesGlobal, onRefreshContadores, permissoes = [] }) {
    const [ops, setOps] = useState([]);
    const [totalOps, setTotalOps] = useState(0);
    const [carregando, setCarregando] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [erro, setErro] = useState(null);
    const [usuarioLogado, setUsuarioLogado] = useState(null);

    // Modal de detalhes individual
    const [modalAberto, setModalAberto] = useState(false);
    const [opSelecionada, setOpSelecionada] = useState(null);

    // Modal de lote — aberto via OPCentralEncerramento
    const [modalLoteAberto, setModalLoteAberto] = useState(false);
    const [opsParaLote, setOpsParaLote] = useState([]);

    // Chave para resetar OPCentralEncerramento após lote concluído
    const [loteResetKey, setLoteResetKey] = useState(0);

    const [filtros, setFiltros] = useState({ status: 'todas', busca: '' });
    const [pagina, setPagina] = useState(1);
    const [totalPaginas, setTotalPaginas] = useState(1);

    // Controla se é o primeiro carregamento (para o InitTerminal)
    const isFirstLoadRef = useRef(true);
    // Ref para a paginação — usado para scroll após trocar de página
    const paginacaoRef = useRef(null);
    const isPaginatingRef = useRef(false);

    const ITENS_POR_PAGINA_OPS = 6;
    const lastSearchParamsRef = useRef(null);

    const buscarDados = useCallback(async (paginaAtual, filtrosAtuais) => {
        const searchSignature = JSON.stringify({ page: paginaAtual, ...filtrosAtuais });
        if (lastSearchParamsRef.current === searchSignature) return;
        lastSearchParamsRef.current = searchSignature;

        setCarregando(true);
        setErro(null);

        try {
            const token = localStorage.getItem('token');
            if (!token) throw new Error('Usuário não autenticado.');

            const params = new URLSearchParams({ page: paginaAtual, limit: ITENS_POR_PAGINA_OPS });
            if (filtrosAtuais.status && filtrosAtuais.status !== 'todas') {
                params.append('status', filtrosAtuais.status);
            }
            if (filtrosAtuais.busca) params.append('search', filtrosAtuais.busca);

            const [dataOps, todosProdutos] = await Promise.all([
                fetch(`/api/ordens-de-producao?${params.toString()}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => r.json()),
                obterProdutosDoStorage()
            ]);

            if (dataOps.error) throw new Error(dataOps.error);

            const opsFinais = dataOps.rows.map(op => {
                const produtoCompleto = todosProdutos.find(p => p.id === op.produto_id);
                let imagem = produtoCompleto?.imagem || null;
                if (produtoCompleto && op.variante && produtoCompleto.grade) {
                    const g = produtoCompleto.grade.find(g => g.variacao === op.variante);
                    if (g?.imagem) imagem = g.imagem;
                }
                return { ...op, imagem_produto: imagem };
            });

            setOps(opsFinais);
            setTotalPaginas(dataOps.pages || 1);
            setTotalOps(dataOps.total || 0);
        } catch (err) {
            console.error('Erro em OPGerenciamentoTela:', err);
            setErro(err.message);
        } finally {
            setCarregando(false);
            isFirstLoadRef.current = false;
        }
    }, []);

    useEffect(() => {
        buscarDados(pagina, filtros);
    }, [pagina, filtros, buscarDados]);

    // Carrega nome do usuário logado (uma vez na montagem)
    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) return;
        fetch('/api/usuarios/me', { headers: { 'Authorization': `Bearer ${token}` } })
            .then(r => r.json())
            .then(data => { if (!data.error) setUsuarioLogado(data); })
            .catch(() => {});
    }, []);

    // Após carregar nova página, rola a paginação para a tela (sem subir, só se necessário)
    useEffect(() => {
        if (!carregando && isPaginatingRef.current) {
            isPaginatingRef.current = false;
            requestAnimationFrame(() => {
                paginacaoRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
            });
        }
    }, [carregando]);

    const handleFiltroChange = useCallback((novosFiltros) => {
        setFiltros(prev => ({
            status: novosFiltros.status !== undefined ? novosFiltros.status : prev.status,
            busca: novosFiltros.busca !== undefined ? novosFiltros.busca : prev.busca
        }));
        setPagina(1);
    }, []);

    // --- Handlers modal individual ---
    const handleAbrirModal = (op) => {
        setOpSelecionada(op);
        setModalAberto(true);
    };
    const handleFecharModal = () => { setModalAberto(false); setOpSelecionada(null); };
    const handleUpdateOP = () => {
        lastSearchParamsRef.current = null;
        buscarDados(pagina, filtros);
        if (onRefreshContadores) onRefreshContadores();
    };

    // --- Cancelar OP ---
    const handleCancelarOP = useCallback(async (op) => {
        const confirmado = await mostrarConfirmacao(
            `Cancelar a OP <strong>#${op.numero} — ${op.produto}</strong>?<br><br>Esta ação não pode ser desfeita.`,
            { tipo: 'perigo', textoConfirmar: 'Cancelar OP', textoCancelar: 'Voltar' }
        );
        if (!confirmado) return;

        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/ordens-de-producao', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ ...op, status: 'cancelada' })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao cancelar OP.');
            mostrarToast('OP cancelada com sucesso.', 'sucesso');
            lastSearchParamsRef.current = null;
            buscarDados(pagina, filtros);
            if (onRefreshContadores) onRefreshContadores();
        } catch (err) {
            mostrarToast(err.message || 'Erro ao cancelar OP.', 'erro');
        }
    }, [pagina, filtros, buscarDados, onRefreshContadores]);

    // --- Handlers Central de Encerramento ---
    const handleAbrirLote = useCallback((lista) => {
        setOpsParaLote(lista);
        setModalLoteAberto(true);
    }, []);

    const handleConcluirLote = ({ sucesso }) => {
        setModalLoteAberto(false);
        setOpsParaLote([]);
        if (sucesso > 0) {
            setLoteResetKey(prev => prev + 1); // reseta o agente
            lastSearchParamsRef.current = null;
            buscarDados(pagina, filtros);
            if (onRefreshContadores) onRefreshContadores();
        }
    };

    // Troca de página — marca que é paginação para o useEffect de scroll
    const handlePageChange = useCallback((novaPagina) => {
        isPaginatingRef.current = true;
        setPagina(novaPagina);
    }, []);

    // Refresh rápido sem spinner de tela cheia
    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        lastSearchParamsRef.current = null;
        await buscarDados(pagina, filtros);
        if (onRefreshContadores) onRefreshContadores();
        setRefreshing(false);
    }, [pagina, filtros, buscarDados, onRefreshContadores]);

    // Decide o que mostrar no lugar do spinner
    const mostrarInitTerminal = carregando && isFirstLoadRef.current;
    const mostrarSpinnerSimples = carregando && !isFirstLoadRef.current;

    const primeiroNome = (usuarioLogado?.nome || '').split(' ')[0] || null;

    return (
        <>
            {/* Bloco de Filtros */}
            <OPFiltros onFiltroChange={handleFiltroChange} />

            {/* Central de Encerramento — opsPendentesGlobal vem do polling geral (todas as OPs)
                — não depende da página atual da listagem */}
            {!isFirstLoadRef.current && (
                <OPCentralEncerramento
                    opsPendentesGlobal={opsPendentesGlobal}
                    onAbrirLote={handleAbrirLote}
                    resetKey={loteResetKey}
                    nomeUsuario={primeiroNome}
                />
            )}

            {/* Spinner só no primeiro carregamento — paginações mantêm os cards visíveis */}
            {carregando && isFirstLoadRef.current && <UICarregando variante="bloco" />}

            {erro && <p style={{ color: 'red', textAlign: 'center' }}>Erro: {erro}</p>}

            {/* Lista de OPs — visível também durante reload de paginação (sem scroll-jump) */}
            {!isFirstLoadRef.current && !erro && (
                <div style={{
                    opacity: carregando ? 0.45 : 1,
                    pointerEvents: carregando ? 'none' : 'auto',
                    transition: 'opacity 0.15s'
                }}>
                    {/* Título da seção — espelhado do op-cortes-estoque-titulo-row */}
                    <div className="op-cortes-estoque-titulo-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <h3 className="op-cortes-estoque-titulo">
                                <i className="fas fa-list-alt"></i>
                                Ordens de Produção
                            </h3>
                            <button
                                className="op-cortes-refresh-btn"
                                onClick={handleRefresh}
                                disabled={refreshing || carregando}
                                title="Atualizar lista"
                            >
                                <i className={`fas fa-sync-alt${(refreshing || carregando) ? ' fa-spin' : ''}`}></i>
                            </button>
                        </div>
                        {totalOps > 0 && (
                            <span className="op-cortes-estoque-badge">
                                {totalOps} {(() => {
                                    if (filtros.status === 'finalizado') return totalOps === 1 ? 'finalizada' : 'finalizadas';
                                    if (filtros.status === 'cancelada')  return totalOps === 1 ? 'cancelada'  : 'canceladas';
                                    if (filtros.status === 'produzindo') return totalOps === 1 ? 'produzindo' : 'produzindo';
                                    return totalOps === 1 ? 'OP em aberto' : 'OPs em aberto';
                                })()}
                            </span>
                        )}
                    </div>

                    <div className="op-cards-container">
                        {ops.length > 0 ? (
                            ops.map(op => (
                                <OPCard
                                    key={op.edit_id || op.id}
                                    op={op}
                                    onClick={handleAbrirModal}
                                    onCancelar={handleCancelarOP}
                                />
                            ))
                        ) : (
                            <p style={{ textAlign: 'center', gridColumn: '1 / -1' }}>
                                Nenhuma Ordem de Produção encontrada para os filtros aplicados.
                            </p>
                        )}
                    </div>

                    {totalPaginas > 1 && (
                        <div ref={paginacaoRef}>
                            <OPPaginacaoWrapper
                                totalPages={totalPaginas}
                                currentPage={pagina}
                                onPageChange={handlePageChange}
                            />
                        </div>
                    )}
                </div>
            )}

            {/* Modal de detalhes individual */}
            <OPEtapasModal
                op={opSelecionada}
                isOpen={modalAberto}
                onClose={handleFecharModal}
                onUpdateOP={handleUpdateOP}
                onUpdateGlobal={onRefreshContadores}
            />

            {/* Modal de lote — aberto pelo Agente de Encerramento */}
            <OPModalLote
                isOpen={modalLoteAberto}
                ops={opsParaLote}
                onClose={() => setModalLoteAberto(false)}
                onConcluido={handleConcluirLote}
            />
        </>
    );
}
