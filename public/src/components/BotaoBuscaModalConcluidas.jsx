// public/src/components/BotaoBuscaModalConcluidas.jsx
// Modal de Histórico de Produção.
//
// Aba "A arquivar": demandas concluídas/divergentes ainda não arquivadas.
//   - Sub-abas: Concluídas | Divergências
//   - Botão "Arquivar tudo": salva arquivada_em + status_final no banco
//   - Após arquivamento, o item sai do painel principal (diagnostico exclui arquivados)
//
// Aba "Arquivo": itens já arquivados, agrupados por data de arquivamento.
//   - Leitura somente — o gerente consulta o histórico de dias anteriores

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import OPPaginacaoWrapper from './OPPaginacaoWrapper.jsx';
import UICarregando from './UICarregando';
import { mostrarMensagem } from '/js/utils/popups.js';
import { calcularStatusDemanda, STATUS_META } from '/src/utils/demandaStatus.js';

// Card compacto para itens do histórico (não usa o CardPipelineProducao completo)
function HistoricoItemCard({ item, statusFinal }) {
    const meta = STATUS_META[statusFinal] || STATUS_META.CONCLUIDO;
    const dataFormatada = item.data_solicitacao
        ? new Date(item.data_solicitacao).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        : '—';

    return (
        <div className="gs-historico-card">
            <div className="card-borda-charme" style={{ backgroundColor: meta.cor }}></div>
            <img
                src={item.imagem || '/img/placeholder-image.png'}
                alt={item.produto_nome}
                className="gs-historico-card-img"
            />
            <div className="gs-historico-card-info">
                <span className="gs-historico-card-nome">{item.produto_nome || item.produto_sku}</span>
                {item.variante && item.variante !== '-' && (
                    <span className="gs-historico-card-variante">{item.variante}</span>
                )}
                <span className="gs-historico-card-meta">
                    {item.quantidade_solicitada} pçs · Pedido em {dataFormatada} · {item.solicitado_por || '—'}
                </span>
            </div>
            <span className="gs-historico-card-badge" style={{ color: meta.cor, borderColor: meta.cor }}>
                <i className={`fas ${meta.icone}`}></i>
                {meta.label}
            </span>
        </div>
    );
}

// Formata timestamp para "DD/MM/AAAA"
function formatarData(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const ITENS_POR_PAG_PENDENTES = 8;
const ITENS_POR_PAG_ARQUIVO   = 8;

export default function BotaoBuscaModalConcluidas({ isOpen, onClose, usarCarregamentoPadrao = false }) {
    // Aba principal: 'pendente' | 'arquivo'
    const [abaAtiva, setAbaAtiva] = useState('pendente');
    // Sub-aba da aba pendente: 'concluidas' | 'divergencias'
    const [subAba, setSubAba] = useState('concluidas');

    // Dados da aba "A arquivar" (vem do diagnostico-completo, filtrado no frontend)
    const [itensPendentes, setItensPendentes] = useState({ concluidas: [], divergencias: [] });
    const [carregandoPendentes, setCarregandoPendentes] = useState(false);

    // Dados da aba "Arquivo"
    const [itensArquivados, setItensArquivados] = useState([]);
    const [carregandoArquivo, setCarregandoArquivo] = useState(false);

    const [arquivando, setArquivando] = useState(false);

    // Paginação
    const [paginaPendentes, setPaginaPendentes] = useState(1);
    const [paginaArquivo, setPaginaArquivo] = useState(1);

    // --- FETCH: aba "A arquivar" ---
    const fetchPendentes = useCallback(async () => {
        setCarregandoPendentes(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/demandas/diagnostico-completo', {
                headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-cache' }
            });
            if (!res.ok) throw new Error('Falha ao carregar diagnóstico.');
            const data = await res.json();
            const todos = data.diagnosticoAgregado || [];

            const concluidas = [];
            const divergencias = [];
            todos.forEach(item => {
                const status = calcularStatusDemanda(item);
                if (status === 'CONCLUIDO') concluidas.push(item);
                else if (status === 'DIVERGENCIA') divergencias.push(item);
            });

            setItensPendentes({ concluidas, divergencias });
        } catch (err) {
            mostrarMensagem(err.message, 'erro');
        } finally {
            setCarregandoPendentes(false);
        }
    }, []);

    // --- FETCH: aba "Arquivo" ---
    const fetchArquivo = useCallback(async () => {
        setCarregandoArquivo(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/demandas/historico-arquivado', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Falha ao carregar arquivo.');
            const data = await res.json();
            setItensArquivados(data.itens || []);
        } catch (err) {
            mostrarMensagem(err.message, 'erro');
        } finally {
            setCarregandoArquivo(false);
        }
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        fetchPendentes();
        setAbaAtiva('pendente');
        setSubAba('concluidas');
        setPaginaPendentes(1);
    }, [isOpen, fetchPendentes]);

    // Reseta página da sub-aba ao trocar de concluidas/divergencias
    useEffect(() => { setPaginaPendentes(1); }, [subAba]);

    // Carrega arquivo só quando o usuário muda para essa aba
    useEffect(() => {
        if (isOpen && abaAtiva === 'arquivo' && itensArquivados.length === 0) {
            fetchArquivo();
        }
    }, [abaAtiva, isOpen, fetchArquivo, itensArquivados.length]);

    // --- ARQUIVAR TUDO ---
    const handleArquivarTudo = async () => {
        const todosParaArquivar = [
            ...itensPendentes.concluidas.map(i => ({ id: i.demanda_id, status_final: 'CONCLUIDO' })),
            ...itensPendentes.divergencias.map(i => ({ id: i.demanda_id, status_final: 'DIVERGENCIA' }))
        ];
        if (todosParaArquivar.length === 0) return;

        setArquivando(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/demandas/arquivar-lote', {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ itens: todosParaArquivar })
            });
            if (!res.ok) throw new Error('Falha ao arquivar.');
            const data = await res.json();
            mostrarMensagem(data.message, 'sucesso');
            // Limpa a aba pendente e força reload do arquivo
            setItensPendentes({ concluidas: [], divergencias: [] });
            setItensArquivados([]); // Força re-fetch ao abrir a aba arquivo
        } catch (err) {
            mostrarMensagem(err.message, 'erro');
        } finally {
            setArquivando(false);
        }
    };

    // arquivadosAgrupados removido — agrupamento agora é feito por página no memo abaixo

    const totalPendentes = itensPendentes.concluidas.length + itensPendentes.divergencias.length;
    const listaSubAbaCompleta = subAba === 'concluidas' ? itensPendentes.concluidas : itensPendentes.divergencias;
    const totalPagsPendentes  = Math.ceil(listaSubAbaCompleta.length / ITENS_POR_PAG_PENDENTES);
    const listaSubAba = listaSubAbaCompleta.slice(
        (paginaPendentes - 1) * ITENS_POR_PAG_PENDENTES,
        paginaPendentes * ITENS_POR_PAG_PENDENTES
    );

    const { gruposArquivoPag, totalPagsArquivo } = useMemo(() => {
        // Ordena globalmente: mais recentemente arquivado primeiro (backend já entrega DESC,
        // mas garantimos aqui para segurança)
        const ordenados = [...itensArquivados].sort(
            (a, b) => new Date(b.arquivada_em) - new Date(a.arquivada_em)
        );

        const total = Math.ceil(ordenados.length / ITENS_POR_PAG_ARQUIVO);
        const paginados = ordenados.slice(
            (paginaArquivo - 1) * ITENS_POR_PAG_ARQUIVO,
            paginaArquivo * ITENS_POR_PAG_ARQUIVO
        );

        // Agrupa por data de arquivamento (DD/MM/AAAA)
        const grupos = new Map();
        paginados.forEach(item => {
            const key = formatarData(item.arquivada_em);
            if (!grupos.has(key)) grupos.set(key, []);
            grupos.get(key).push(item);
        });

        // Dentro de cada grupo: pedido mais recente primeiro
        grupos.forEach((itens, key) => {
            itens.sort((a, b) => new Date(b.data_solicitacao) - new Date(a.data_solicitacao));
        });

        return { gruposArquivoPag: Array.from(grupos.entries()), totalPagsArquivo: total };
    }, [itensArquivados, paginaArquivo]);

    if (!isOpen) return null;

    return (
        <div className="gs-busca-modal-overlay" onClick={onClose} style={{ zIndex: 10000 }}>
            <div
                className="gs-busca-modal-conteudo gs-historico-modal"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="gs-busca-modal-header">
                    <h3><i className="fas fa-history"></i> Histórico de Produção</h3>
                    <button onClick={onClose} className="gs-busca-modal-fechar">&times;</button>
                </div>

                {/* Abas principais */}
                <div className="gs-historico-abas">
                    <button
                        className={`gs-historico-aba${abaAtiva === 'pendente' ? ' ativa' : ''}`}
                        onClick={() => setAbaAtiva('pendente')}
                    >
                        <i className="fas fa-inbox"></i>
                        A arquivar
                        {totalPendentes > 0 && (
                            <span className="gs-historico-aba-badge">{totalPendentes}</span>
                        )}
                    </button>
                    <button
                        className={`gs-historico-aba${abaAtiva === 'arquivo' ? ' ativa' : ''}`}
                        onClick={() => setAbaAtiva('arquivo')}
                    >
                        <i className="fas fa-archive"></i>
                        Arquivo
                    </button>
                </div>

                <div className="gs-busca-modal-body">

                    {/* ===== ABA: A ARQUIVAR ===== */}
                    {abaAtiva === 'pendente' && (
                        <>
                            {carregandoPendentes ? (
                                usarCarregamentoPadrao ? <UICarregando variante="bloco" texto="Calculando..." /> : <div className="spinner">Calculando...</div>
                            ) : totalPendentes === 0 ? (
                                <UIFeedbackNotFound
                                    icon="fa-check-double"
                                    titulo="Tudo arquivado"
                                    mensagem="Nenhuma demanda concluída ou com divergência pendente de arquivamento."
                                />
                            ) : (
                                <>
                                    {/* Sub-abas */}
                                    <div className="gs-historico-subabas">
                                        <button
                                            className={`gs-historico-subaba${subAba === 'concluidas' ? ' ativa' : ''}`}
                                            onClick={() => setSubAba('concluidas')}
                                        >
                                            <i className="fas fa-check-circle" style={{ color: '#27ae60' }}></i>
                                            Concluídas ({itensPendentes.concluidas.length})
                                        </button>
                                        <button
                                            className={`gs-historico-subaba${subAba === 'divergencias' ? ' ativa' : ''}`}
                                            onClick={() => setSubAba('divergencias')}
                                        >
                                            <i className="fas fa-exclamation-triangle" style={{ color: '#e74c3c' }}></i>
                                            Divergências ({itensPendentes.divergencias.length})
                                        </button>
                                    </div>

                                    {/* Lista */}
                                    <div className="gs-historico-lista">
                                        {listaSubAbaCompleta.length === 0 ? (
                                            <UIFeedbackNotFound
                                                variante="compacto"
                                                icon="fa-inbox"
                                                titulo="Nenhuma demanda nesta categoria"
                                                mensagem="Não há itens para exibir nesta aba."
                                            />
                                        ) : listaSubAba.length === 0 ? (
                                            <UIFeedbackNotFound
                                                variante="compacto"
                                                icon="fa-search"
                                                titulo="Nenhum item nesta página"
                                                mensagem="Não há mais itens para exibir aqui."
                                            />
                                        ) : (
                                            listaSubAba.map(item => (
                                                <HistoricoItemCard
                                                    key={`${item.demanda_id}-${item.produto_id}-${item.variante || ''}`}
                                                    item={{
                                                        imagem: item.imagem,
                                                        produto_nome: item.produto_nome,
                                                        produto_sku: item.produto_sku,
                                                        variante: item.variante,
                                                        quantidade_solicitada: item.demanda_total,
                                                        data_solicitacao: item.data_solicitacao,
                                                        solicitado_por: item.solicitado_por,
                                                    }}
                                                    statusFinal={subAba === 'concluidas' ? 'CONCLUIDO' : 'DIVERGENCIA'}
                                                />
                                            ))
                                        )}
                                    </div>

                                    {/* Paginação dos pendentes */}
                                    {totalPagsPendentes > 1 && (
                                        <OPPaginacaoWrapper
                                            totalPages={totalPagsPendentes}
                                            currentPage={paginaPendentes}
                                            onPageChange={setPaginaPendentes}
                                        />
                                    )}

                                    {/* Botão arquivar */}
                                    <div className="gs-historico-footer">
                                        <button
                                            className="gs-btn gs-btn-primario gs-btn-full"
                                            onClick={handleArquivarTudo}
                                            disabled={arquivando}
                                        >
                                            {arquivando ? (
                                                <>{usarCarregamentoPadrao ? <UICarregando variante="inline" /> : <div className="spinner-btn-interno"></div>} Arquivando...</>
                                            ) : (
                                                <><i className="fas fa-archive"></i> Arquivar tudo ({totalPendentes} {totalPendentes === 1 ? 'item' : 'itens'})</>
                                            )}
                                        </button>
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {/* ===== ABA: ARQUIVO ===== */}
                    {abaAtiva === 'arquivo' && (
                        <>
                            {carregandoArquivo ? (
                                usarCarregamentoPadrao ? <UICarregando variante="bloco" texto="Carregando arquivo..." /> : <div className="spinner">Carregando arquivo...</div>
                            ) : itensArquivados.length === 0 ? (
                                <UIFeedbackNotFound
                                    icon="fa-archive"
                                    titulo="Arquivo vazio"
                                    mensagem="Nenhuma demanda foi arquivada ainda."
                                />
                            ) : (
                                <>
                                    <div className="gs-historico-lista">
                                        {gruposArquivoPag.map(([data, itens]) => (
                                            <div key={data} className="gs-historico-grupo">
                                                <div className="gs-historico-grupo-titulo">
                                                    <i className="fas fa-calendar-day"></i>
                                                    Arquivado em {data}
                                                    <span className="gs-historico-grupo-count">{itens.length} {itens.length === 1 ? 'item' : 'itens'}</span>
                                                </div>
                                                {itens.map(item => (
                                                    <HistoricoItemCard
                                                        key={item.id}
                                                        item={item}
                                                        statusFinal={item.status_final || 'CONCLUIDO'}
                                                    />
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                    {totalPagsArquivo > 1 && (
                                        <OPPaginacaoWrapper
                                            totalPages={totalPagsArquivo}
                                            currentPage={paginaArquivo}
                                            onPageChange={setPaginaArquivo}
                                        />
                                    )}
                                </>
                            )}
                        </>
                    )}

                </div>
            </div>
        </div>
    );
}
