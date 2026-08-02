// public/src/components/ArremateHistoricoModal.jsx
// Modal React para o Histórico Geral de Arremates (Item 7 — v2.0)
// Substitui o modal gerado dinamicamente pelo admin-arremates.js

import React, { useState, useEffect, useRef } from 'react';
import UICarregando from './UICarregando';
import UIPaginacao from './UIPaginacao';
import { mostrarConfirmacao, mostrarMensagem } from '/js/utils/popups.js';

// --- Configuração por tipo de lançamento ---
const TIPO_CONFIG = {
    PRODUCAO:        { label: 'Lançamento', cor: 'var(--gs-primaria)', icone: 'fa-cut' },
    PERDA:           { label: 'Perda',      cor: '#f59e0b',            icone: 'fa-exclamation-triangle' },
    ESTORNO:         { label: 'Estorno',    cor: '#94a3b8',            icone: 'fa-undo' },
    PRODUCAO_ANULADA:{ label: 'Anulado',   cor: '#94a3b8',            icone: 'fa-ban' },
};

const TIPOS_FILTRO = [
    { value: 'todos',    label: 'Todos' },
    { value: 'PRODUCAO', label: 'Lançamentos' },
    { value: 'PERDA',    label: 'Perdas' },
    { value: 'ESTORNO',  label: 'Estornos' },
];

const PERIODOS_FILTRO = [
    { value: 'hoje',      label: 'Hoje' },
    { value: '7d',        label: '7 dias' },
    { value: '30d',       label: '30 dias' },
    { value: 'mes_atual', label: 'Mês atual' },
];

function fmtDataHora(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
}

// Janela de 2h para permitir desfazer
function podeMostrarDesfazer(item) {
    return (
        item.tipo_lancamento === 'PRODUCAO' &&
        (Date.now() - new Date(item.data_lancamento).getTime()) < 2 * 60 * 60 * 1000
    );
}

// --- Sub-componente: card horizontal de um evento do histórico ---
function HistoricoCard({ item, onDesfazer, desfazendoId }) {
    const tipo = TIPO_CONFIG[item.tipo_lancamento] || TIPO_CONFIG.PRODUCAO;
    const mostraTiktik = item.tipo_lancamento !== 'PERDA';
    const nomeAtor = item.usuario_tiktik || item.lancado_por || 'N/A';

    return (
        <div className="arremate-hist-card">
            <div className="card-borda-charme" style={{ backgroundColor: tipo.cor }}></div>

            <img
                src={item.produto_imagem || '/img/placeholder-image.png'}
                alt={item.produto}
                className="arremate-hist-card-img"
            />

            <div className="arremate-hist-card-info">
                <div className="arremate-hist-card-topo">
                    <span className="arremate-hist-card-nome">{item.produto || 'Produto não encontrado'}</span>
                    <span className="arremate-hist-tipo-badge" style={{ color: tipo.cor }}>
                        <i className={`fas ${tipo.icone}`}></i> {tipo.label}
                    </span>
                </div>

                {item.variante && item.variante !== '-' && (
                    <p className="arremate-hist-card-variante">{item.variante}</p>
                )}

                <div className="arremate-hist-card-meta">
                    {mostraTiktik && (
                        <span><i className="fas fa-cut"></i> {nomeAtor}</span>
                    )}
                    <span>
                        <i className="fas fa-cubes"></i> {Math.abs(item.quantidade_arrematada)} pç{Math.abs(item.quantidade_arrematada) !== 1 ? 's' : ''}
                    </span>
                    <span><i className="fas fa-clock"></i> {fmtDataHora(item.data_lancamento)}</span>
                    {item.op_numero && (
                        <span><i className="fas fa-file-alt"></i> OP #{item.op_numero}</span>
                    )}
                </div>
            </div>

            {podeMostrarDesfazer(item) && (
                <button
                    className="arremate-hist-btn-desfazer"
                    onClick={() => onDesfazer(item)}
                    disabled={desfazendoId === item.id}
                    title="Desfazer este lançamento"
                >
                    {desfazendoId === item.id
                        ? <div className="spinner-btn-interno"></div>
                        : <><i className="fas fa-undo"></i></>
                    }
                </button>
            )}
        </div>
    );
}

// --- Componente principal ---
export default function ArremateHistoricoModal({ isOpen, onClose }) {
    const [eventos, setEventos]       = useState([]);
    const [pagination, setPagination] = useState({ currentPage: 1, totalPages: 1, totalItems: 0 });
    const [carregando, setCarregando] = useState(false);
    const [busca, setBusca]           = useState('');
    const [filtroTipo, setFiltroTipo] = useState('todos');
    const [filtroPeriodo, setFiltroPeriodo] = useState('7d');
    const [paginaAtual, setPaginaAtual] = useState(1);
    const [desfazendoId, setDesfazendoId] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);

    // Debounce da busca
    const [buscaDebounced, setBuscaDebounced] = useState('');
    const debounceRef = useRef(null);
    useEffect(() => {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setBuscaDebounced(busca);
            setPaginaAtual(1);
        }, 400);
        return () => clearTimeout(debounceRef.current);
    }, [busca]);

    // Reset ao abrir
    useEffect(() => {
        if (isOpen) {
            setBusca('');
            setBuscaDebounced('');
            setFiltroTipo('todos');
            setFiltroPeriodo('7d');
            setPaginaAtual(1);
            setRefreshKey(k => k + 1);
        }
    }, [isOpen]);

    // Fetch de dados
    useEffect(() => {
        if (!isOpen) return;
        const controller = new AbortController();
        setCarregando(true);

        const params = new URLSearchParams({
            busca: buscaDebounced,
            tipoEvento: filtroTipo,
            periodo: filtroPeriodo,
            page: paginaAtual,
            limit: 15,
        });

        const token = localStorage.getItem('token');
        fetch(`/api/arremates/historico?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: controller.signal,
        })
            .then(r => r.json())
            .then(data => {
                setEventos(data.rows || []);
                setPagination(data.pagination || { currentPage: 1, totalPages: 1, totalItems: 0 });
            })
            .catch(err => { if (err.name !== 'AbortError') console.error(err); })
            .finally(() => setCarregando(false));

        return () => controller.abort();
    }, [isOpen, buscaDebounced, filtroTipo, filtroPeriodo, paginaAtual, refreshKey]);

    const handleDesfazer = async (item) => {
        const ok = await mostrarConfirmacao(
            `Desfazer lançamento de ${item.quantidade_arrematada} pç${item.quantidade_arrematada !== 1 ? 's' : ''} de "${item.produto}"${item.variante && item.variante !== '-' ? ` — ${item.variante}` : ''}?`,
            'aviso'
        );
        if (!ok) return;

        setDesfazendoId(item.id);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/arremates/estornar', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_arremate: item.id }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Erro ao desfazer.');
            }
            mostrarMensagem('Lançamento desfeito com sucesso.', 'sucesso');
            window.dispatchEvent(new Event('forcarAtualizacaoFilaDeArremates'));
            setRefreshKey(k => k + 1); // força re-fetch do histórico
        } catch (err) {
            mostrarMensagem(err.message, 'erro');
        } finally {
            setDesfazendoId(null);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="popup-container" style={{ display: 'flex' }}>
            <div className="popup-overlay" onClick={onClose}></div>
            <div className="arremate-hist-modal">

                {/* Header */}
                <div className="arremate-modal-header">
                    <div className="arremate-modal-header-esquerda"></div>
                    <div className="arremate-modal-header-centro">
                        <h3 className="arremate-modal-titulo">Histórico de Arremates</h3>
                        <div className="arremate-modal-header-info">
                            <span className="arremate-hist-total-badge">
                                {pagination.totalItems} registro{pagination.totalItems !== 1 ? 's' : ''}
                            </span>
                        </div>
                    </div>
                    <div className="arremate-modal-header-direita">
                        <button className="arremate-modal-fechar-btn" onClick={onClose}>
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                {/* Filtros */}
                <div className="arremate-hist-filtros">
                    <div className="arremate-busca-wrapper arremate-hist-busca">
                        <i className="fas fa-search arremate-busca-icone"></i>
                        <input
                            className="arremate-busca-input"
                            type="text"
                            placeholder="Produto, tiktik ou lançador..."
                            value={busca}
                            onChange={e => setBusca(e.target.value)}
                        />
                        {busca && (
                            <button className="arremate-busca-limpar" onClick={() => setBusca('')}>
                                ×
                            </button>
                        )}
                    </div>

                    <div className="arremate-hist-tipo-pills">
                        {TIPOS_FILTRO.map(t => (
                            <button
                                key={t.value}
                                className={`arremate-filtro-chip${filtroTipo === t.value ? ' ativo' : ''}`}
                                onClick={() => { setFiltroTipo(t.value); setPaginaAtual(1); }}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    <select
                        className="gs-select arremate-hist-periodo-select"
                        value={filtroPeriodo}
                        onChange={e => { setFiltroPeriodo(e.target.value); setPaginaAtual(1); }}
                    >
                        {PERIODOS_FILTRO.map(p => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                    </select>
                </div>

                {/* Corpo */}
                <div className="arremate-hist-corpo">
                    {carregando ? (
                        <UICarregando variante="bloco" texto="Buscando histórico..." />
                    ) : eventos.length === 0 ? (
                        <div className="arremate-hist-vazio">
                            <i className="fas fa-inbox"></i>
                            <p>Nenhum registro encontrado para os filtros selecionados.</p>
                        </div>
                    ) : (
                        <div className="arremate-hist-grid">
                            {eventos.map(item => (
                                <HistoricoCard
                                    key={item.id}
                                    item={item}
                                    onDesfazer={handleDesfazer}
                                    desfazendoId={desfazendoId}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Paginação */}
                {pagination.totalPages > 1 && (
                    <div className="arremate-hist-footer">
                        <UIPaginacao
                            paginaAtual={paginaAtual}
                            totalPaginas={pagination.totalPages}
                            onPageChange={setPaginaAtual}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
