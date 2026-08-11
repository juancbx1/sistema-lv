// public/src/components/ArremateHistoricoModal.jsx
// Histórico geral de Produções. O nome do arquivo permanece como alias de
// compatibilidade enquanto a rota antiga de Arremates ainda existir.

import React, { useState, useEffect, useRef } from 'react';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UIPaginacao from './UIPaginacao';
import { mostrarConfirmacao, mostrarMensagem } from '/js/utils/popups.js';
import { mostrarPopupSemPermissao } from '../utils/bloqueio';

// --- Configuração por tipo de lançamento ---
const TIPO_CONFIG = {
    CONCLUSAO_OP:          { label: 'Produção da OP', cor: 'var(--gs-primaria)', icone: 'fa-gears' },
    CONCLUSAO_POS_OP:      { label: 'Arremate pós-OP', cor: '#7c3aed', icone: 'fa-wand-magic-sparkles' },
    PERDA:                 { label: 'Perda', cor: '#f59e0b', icone: 'fa-exclamation-triangle' },
    PERDA_EMBALAGEM:       { label: 'Perda na embalagem', cor: '#dc2626', icone: 'fa-box-open' },
    PERDA_CONSERTO:        { label: 'Avaria após conserto', cor: '#dc2626', icone: 'fa-triangle-exclamation' },
    ENVIO_CONSERTO:        { label: 'Enviado para conserto', cor: '#2563eb', icone: 'fa-screwdriver-wrench' },
    RETORNO_CONSERTO:      { label: 'Retorno do conserto', cor: '#16a34a', icone: 'fa-rotate-left' },
    CANCELAMENTO_TAREFA:   { label: 'Cancelamento', cor: '#94a3b8', icone: 'fa-ban' },
    PRODUCAO_ANULADA:      { label: 'Produção anulada', cor: '#94a3b8', icone: 'fa-ban' },
    EMBALAGEM_UNIDADE:     { label: 'Embalagem', cor: '#ea580c', icone: 'fa-box-open' },
    EMBALAGEM_KIT:         { label: 'Kit embalado', cor: '#ea580c', icone: 'fa-cubes' },
    ESTORNO_PRODUCAO:      { label: 'Estorno de produção', cor: '#64748b', icone: 'fa-undo' },
    ESTORNO_EMBALAGEM:     { label: 'Estorno de embalagem', cor: '#64748b', icone: 'fa-undo' },
    ESTOQUE:               { label: 'Estoque', cor: '#0f766e', icone: 'fa-warehouse' },
};

const TIPOS_FILTRO = [
    { value: 'todos',    label: 'Todos' },
    { value: 'CONCLUSAO', label: 'Conclusões' },
    { value: 'PERDA',    label: 'Perdas' },
    { value: 'CANCELAMENTO', label: 'Cancelamentos' },
    { value: 'EMBALAGEM', label: 'Embalagem' },
    { value: 'ESTOQUE', label: 'Estoque' },
    { value: 'ESTORNO',  label: 'Estornos' },
];

const PERIODOS_FILTRO = [
    { value: 'hoje',      label: 'Hoje' },
    { value: '7d',        label: '7 dias' },
    { value: '30d',       label: '30 dias' },
    { value: 'mes_atual', label: 'Mês atual' },
];

function tokenDaSessaoAtual() {
    return sessionStorage.getItem('impersonation_token') || localStorage.getItem('token');
}

function fmtDataHora(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
}

function rotuloCategoriaPerda(categoria) {
    if (categoria === 'PRODUTO_AVARIADO') return 'Produto avariado';
    if (categoria === 'QUANTIDADE_ERRADA') return 'Quantidade errada';
    if (categoria === 'DIVERGENCIA_SALDO' || categoria === 'LANCAMENTO_ERRADO') return 'Quantidade errada';
    return categoria || 'Categoria não informada';
}

// Janela de 2h para permitir desfazer
function podeMostrarDesfazer(item) {
    return (
        item.tipo_evento === 'CONCLUSAO_POS_OP' &&
        item.arremate_id &&
        (Date.now() - new Date(item.data_evento).getTime()) < 2 * 60 * 60 * 1000
    );
}

// --- Sub-componente: card horizontal de um evento do histórico ---
function HistoricoCard({ item, onDesfazer, desfazendoId, podeEstornar }) {
    const tipo = item.tipo_evento?.startsWith('ESTOQUE_')
        ? TIPO_CONFIG.ESTOQUE
        : TIPO_CONFIG[item.tipo_evento] || TIPO_CONFIG.CONCLUSAO_OP;
    const nomeAtor = item.executor_nome || item.autor || 'N/A';
    const quantidade = Math.abs(Number(item.quantidade) || 0);

    return (
        <div className="arremate-hist-card">
            <div className="card-borda-charme" style={{ backgroundColor: tipo.cor }}></div>

            <img
                src={item.produto_imagem || '/img/placeholder-image.png'}
                alt={item.produto_nome}
                className="arremate-hist-card-img"
            />

            <div className="arremate-hist-card-info">
                <div className="arremate-hist-card-topo">
                    <span className="arremate-hist-card-nome">{item.produto_nome || 'Produto não encontrado'}</span>
                    <span className="arremate-hist-tipo-badge" style={{ color: tipo.cor }}>
                        <i className={`fas ${tipo.icone}`}></i> {tipo.label}
                    </span>
                </div>

                {item.variante && item.variante !== '-' && (
                    <p className="arremate-hist-card-variante">{item.variante}</p>
                )}

                <div className="arremate-hist-card-meta">
                    {nomeAtor !== 'N/A' && (
                        <span><i className="fas fa-cut"></i> {nomeAtor}</span>
                    )}
                    <span>
                        <i className="fas fa-cubes"></i> {quantidade} pç{quantidade !== 1 ? 's' : ''}
                    </span>
                    <span><i className="fas fa-clock"></i> {fmtDataHora(item.data_evento)}</span>
                    {item.op_numero && (
                        <span><i className="fas fa-file-alt"></i> OP #{item.op_numero}</span>
                    )}
                    {item.fase && (
                        <span><i className="fas fa-layer-group"></i> {item.fase}</span>
                    )}
                    {item.processo && (
                        <span><i className="fas fa-gears"></i> {item.processo}</span>
                    )}
                </div>
                {item.tipo_evento === 'PERDA' && (
                    <div className="arremate-hist-card-perda">
                        <strong>{rotuloCategoriaPerda(item.categoria)}</strong>
                        {item.observacao && <span> — {item.observacao}</span>}
                    </div>
                )}
                {item.tipo_evento !== 'PERDA' && item.observacao && (
                    <div className="arremate-hist-card-perda">
                        <span>{item.observacao}</span>
                    </div>
                )}
            </div>

            {podeMostrarDesfazer(item) && (
                <button
                    className={`arremate-hist-btn-desfazer${podeEstornar ? '' : ' bloqueado'}`}
                    onClick={() => {
                        if (!podeEstornar) {
                            mostrarPopupSemPermissao('Seu vínculo atual não possui permissão para estornar este lançamento.');
                            return;
                        }
                        onDesfazer(item);
                    }}
                    disabled={desfazendoId === item.arremate_id}
                    aria-disabled={!podeEstornar || undefined}
                    aria-label={podeEstornar ? 'Desfazer este lançamento' : 'Estornar lançamento bloqueado'}
                    title={podeEstornar ? 'Desfazer este lançamento' : 'Estornar lançamento bloqueado'}
                >
                    {desfazendoId === item.arremate_id
                        ? <UICarregando variante="inline" />
                        : <><i className={`fas ${podeEstornar ? 'fa-undo' : 'fa-lock'}`}></i></>
                    }
                </button>
            )}
        </div>
    );
}

// --- Componente principal ---
export default function ArremateHistoricoModal({ isOpen, onClose, podeEstornar = false }) {
    const [eventos, setEventos]       = useState([]);
    const [pagination, setPagination] = useState({ currentPage: 1, totalPages: 1, totalItems: 0 });
    const [carregando, setCarregando] = useState(false);
    const [busca, setBusca]           = useState('');
    const [filtroTipo, setFiltroTipo] = useState('todos');
    const [filtroFase, setFiltroFase] = useState('todas');
    const [filtroPeriodo, setFiltroPeriodo] = useState('7d');
    const [filtrosDetalhados, setFiltrosDetalhados] = useState({
        produtoBusca: '',
        executorBusca: '',
        opNumero: '',
        processo: '',
    });
    const [filtrosDetalhadosDebounced, setFiltrosDetalhadosDebounced] = useState({
        produtoBusca: '',
        executorBusca: '',
        opNumero: '',
        processo: '',
    });
    const [filtrosAvancadosAbertos, setFiltrosAvancadosAbertos] = useState(false);
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

    useEffect(() => {
        const timeout = setTimeout(() => {
            setFiltrosDetalhadosDebounced(filtrosDetalhados);
            setPaginaAtual(1);
        }, 350);
        return () => clearTimeout(timeout);
    }, [filtrosDetalhados]);

    // Reset ao abrir
    useEffect(() => {
        if (isOpen) {
            setBusca('');
            setBuscaDebounced('');
            setFiltroTipo('todos');
            setFiltroFase('todas');
            setFiltroPeriodo('7d');
            setFiltrosDetalhados({ produtoBusca: '', executorBusca: '', opNumero: '', processo: '' });
            setFiltrosDetalhadosDebounced({ produtoBusca: '', executorBusca: '', opNumero: '', processo: '' });
            setFiltrosAvancadosAbertos(false);
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
            fase: filtroFase,
            periodo: filtroPeriodo,
            page: paginaAtual,
            limit: 15,
        });
        Object.entries(filtrosDetalhadosDebounced).forEach(([campo, valor]) => {
            if (String(valor).trim()) params.set(campo, String(valor).trim());
        });

        const token = tokenDaSessaoAtual();
        fetch(`/api/producoes/historico?${params.toString()}`, {
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
    }, [
        isOpen,
        buscaDebounced,
        filtroTipo,
        filtroFase,
        filtroPeriodo,
        filtrosDetalhadosDebounced,
        paginaAtual,
        refreshKey,
    ]);

    const alterarFiltroDetalhado = (campo, valor) => {
        setFiltrosDetalhados(atual => ({ ...atual, [campo]: valor }));
    };

    const limparFiltrosDetalhados = () => {
        setFiltrosDetalhados({ produtoBusca: '', executorBusca: '', opNumero: '', processo: '' });
        setFiltrosDetalhadosDebounced({ produtoBusca: '', executorBusca: '', opNumero: '', processo: '' });
        setPaginaAtual(1);
    };

    const handleDesfazer = async (item) => {
        const ok = await mostrarConfirmacao(
            `Desfazer lançamento de ${item.quantidade} pç${item.quantidade !== 1 ? 's' : ''} de "${item.produto_nome}"${item.variante && item.variante !== '-' ? ` — ${item.variante}` : ''}?`,
            'aviso'
        );
        if (!ok) return;

        setDesfazendoId(item.arremate_id);
        try {
            const token = tokenDaSessaoAtual();
            const res = await fetch('/api/producoes/estornar', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_arremate: item.arremate_id }),
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
                        <h3 className="arremate-modal-titulo">Histórico geral</h3>
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
                            placeholder="Produto, empregado, processo ou OP..."
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

                    <button
                        type="button"
                        className="arremate-hist-filtros-avancados-btn"
                        aria-expanded={filtrosAvancadosAbertos}
                        onClick={() => setFiltrosAvancadosAbertos(aberto => !aberto)}
                    >
                        <i className="fas fa-sliders"></i>
                        <span>Filtros detalhados</span>
                        <i className={`fas fa-chevron-${filtrosAvancadosAbertos ? 'up' : 'down'}`}></i>
                    </button>

                    {filtrosAvancadosAbertos && (
                        <div className="arremate-hist-filtros-avancados">
                            <label>
                                <span>Produto</span>
                                <input
                                    className="gs-input"
                                    value={filtrosDetalhados.produtoBusca}
                                    onChange={e => alterarFiltroDetalhado('produtoBusca', e.target.value)}
                                    placeholder="Nome do produto"
                                />
                            </label>
                            <label>
                                <span>Empregado</span>
                                <input
                                    className="gs-input"
                                    value={filtrosDetalhados.executorBusca}
                                    onChange={e => alterarFiltroDetalhado('executorBusca', e.target.value)}
                                    placeholder="Nome do executor"
                                />
                            </label>
                            <label>
                                <span>OP</span>
                                <input
                                    className="gs-input"
                                    value={filtrosDetalhados.opNumero}
                                    onChange={e => alterarFiltroDetalhado('opNumero', e.target.value)}
                                    placeholder="Número da OP"
                                />
                            </label>
                            <label>
                                <span>Processo</span>
                                <input
                                    className="gs-input"
                                    value={filtrosDetalhados.processo}
                                    onChange={e => alterarFiltroDetalhado('processo', e.target.value)}
                                    placeholder="Nome do processo"
                                />
                            </label>
                            <button
                                type="button"
                                className="arremate-hist-filtros-avancados-limpar"
                                onClick={limparFiltrosDetalhados}
                            >
                                Limpar
                            </button>
                        </div>
                    )}

                    <select
                        className="gs-select arremate-hist-periodo-select"
                        value={filtroFase}
                        onChange={e => { setFiltroFase(e.target.value); setPaginaAtual(1); }}
                    >
                        <option value="todas">Todas as fases</option>
                        <option value="OP">Dentro da OP</option>
                        <option value="POS_OP">Arremate pós-OP</option>
                    </select>

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
                        <UIFeedbackNotFound
                            variante="compacto"
                            icon="fa-inbox"
                            titulo="Nenhum registro encontrado"
                            mensagem="Não há histórico para os filtros selecionados."
                        />
                    ) : (
                        <div className="arremate-hist-grid">
                            {eventos.map(item => (
                                <HistoricoCard
                                    key={`${item.origem}:${item.origem_id}`}
                                    item={item}
                                    onDesfazer={handleDesfazer}
                                    desfazendoId={desfazendoId}
                                    podeEstornar={podeEstornar}
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
