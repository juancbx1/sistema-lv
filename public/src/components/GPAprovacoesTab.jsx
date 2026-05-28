import React, { useState, useEffect, useCallback } from 'react';
import UICarregando from './UICarregando.jsx';
import GPAprovacaoCard from './GPAprovacaoCard.jsx';

const LIMIT = 10;

function fetchAuth(url) {
    const token = localStorage.getItem('token');
    return fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
}

export default function GPAprovacoesTab({ onDecisao }) {
    const [pendentes, setPendentes]               = useState([]);
    const [historico, setHistorico]               = useState([]);
    const [carregandoPendentes, setCarregandoPendentes] = useState(true);
    const [carregandoHistorico, setCarregandoHistorico] = useState(true);
    const [paginaHist, setPaginaHist]             = useState(1);
    const [totalPaginasHist, setTotalPaginasHist] = useState(0);
    const [totalHist, setTotalHist]               = useState(0);
    const [filtroStatus, setFiltroStatus]         = useState('');

    const carregarPendentes = useCallback(async () => {
        setCarregandoPendentes(true);
        try {
            const res  = await fetchAuth('/api/gerenciar-producao/solicitacoes?status=pendente');
            const data = await res.json();
            setPendentes(data.rows || []);
        } catch (e) {
            console.error('[GPAprovacoesTab] Erro ao buscar pendentes:', e);
        } finally {
            setCarregandoPendentes(false);
        }
    }, []);

    const carregarHistorico = useCallback(async (pg, status) => {
        setCarregandoHistorico(true);
        try {
            const params = new URLSearchParams({ status: status || 'historico', page: pg, limit: LIMIT });
            const res    = await fetchAuth(`/api/gerenciar-producao/solicitacoes?${params}`);
            const data   = await res.json();
            setHistorico(data.rows || []);
            setTotalHist(data.total || 0);
            setTotalPaginasHist(data.totalPaginas || 0);
        } catch (e) {
            console.error('[GPAprovacoesTab] Erro ao buscar histórico:', e);
        } finally {
            setCarregandoHistorico(false);
        }
    }, []);

    useEffect(() => {
        carregarPendentes();
        carregarHistorico(1, '');
    }, [carregarPendentes, carregarHistorico]);

    const handleDecisao = () => {
        carregarPendentes();
        carregarHistorico(paginaHist, filtroStatus);
        onDecisao?.();
    };

    const handleFiltroChange = (novoStatus) => {
        setFiltroStatus(novoStatus);
        setPaginaHist(1);
        carregarHistorico(1, novoStatus);
    };

    const handlePaginaHist = (pg) => {
        setPaginaHist(pg);
        carregarHistorico(pg, filtroStatus);
    };

    return (
        <>
            <div className="gs-card">
                <h3 className="gp-secao-titulo">
                    <i className="fas fa-hourglass-half"></i> Pendentes
                    {pendentes.length > 0 && (
                        <span className="gp-badge-count">{pendentes.length}</span>
                    )}
                </h3>

                {carregandoPendentes ? (
                    <UICarregando variante="bloco" />
                ) : pendentes.length === 0 ? (
                    <div className="gp-estado-vazio">
                        <i className="fas fa-check-circle"></i>
                        <p>Nenhuma solicitação pendente</p>
                    </div>
                ) : (
                    <div className="gp-aprovacoes-lista">
                        {pendentes.map(s => (
                            <GPAprovacaoCard key={s.id} solicitacao={s} onDecisao={handleDecisao} />
                        ))}
                    </div>
                )}
            </div>

            <div className="gs-card">
                <div className="gp-secao-header">
                    <h3 className="gp-secao-titulo">
                        <i className="fas fa-history"></i> Histórico
                    </h3>
                    <div className="gp-filtro-status">
                        {[
                            { value: '',          label: 'Todos' },
                            { value: 'aprovada',  label: 'Aprovadas' },
                            { value: 'rejeitada', label: 'Rejeitadas' },
                            { value: 'cancelada', label: 'Canceladas' },
                        ].map(op => (
                            <button
                                key={op.value}
                                className={`gp-filtro-btn${filtroStatus === op.value ? ' ativo' : ''}`}
                                onClick={() => handleFiltroChange(op.value)}
                            >
                                {op.label}
                            </button>
                        ))}
                    </div>
                </div>

                {carregandoHistorico ? (
                    <UICarregando variante="bloco" />
                ) : historico.length === 0 ? (
                    <div className="gp-estado-vazio">
                        <i className="fas fa-inbox"></i>
                        <p>Nenhum registro no histórico</p>
                    </div>
                ) : (
                    <>
                        <div className="gp-aprovacoes-lista">
                            {historico.map(s => (
                                <GPAprovacaoCard key={s.id} solicitacao={s} onDecisao={handleDecisao} />
                            ))}
                        </div>

                        {totalPaginasHist > 1 && (
                            <div className="gs-paginacao-container">
                                <button
                                    className="gs-paginacao-btn"
                                    disabled={paginaHist === 1}
                                    onClick={() => handlePaginaHist(paginaHist - 1)}
                                >
                                    <i className="fas fa-chevron-left"></i>
                                </button>
                                <span className="gs-paginacao-info">
                                    Página {paginaHist} de {totalPaginasHist} &nbsp;·&nbsp; {totalHist} registros
                                </span>
                                <button
                                    className="gs-paginacao-btn"
                                    disabled={paginaHist === totalPaginasHist}
                                    onClick={() => handlePaginaHist(paginaHist + 1)}
                                >
                                    <i className="fas fa-chevron-right"></i>
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </>
    );
}
