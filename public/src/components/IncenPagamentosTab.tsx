// public/src/components/IncenPagamentosTab.tsx
import { useState, useEffect, useCallback } from 'react';
// @ts-expect-error popups JS legados sem declaração TypeScript
import { mostrarMensagem, mostrarConfirmacao } from '/js/utils/popups.js';
import UICarregando from './UICarregando';
import type {
    IncenPagamentosSubAba,
    PremioGanhoItem,
    PremiosFilaResponse,
    PremiosPagarLoteResult,
} from '../utils/incentivos-types';

function fetchApi<T = unknown>(url: string, opts: RequestInit = {}): Promise<T> {
    const token = localStorage.getItem('token');
    return fetch(url, {
        ...opts,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    }).then(async r => {
        const d = await r.json() as T & { error?: string };
        if (!r.ok) throw new Error((d as { error?: string }).error || 'Erro na requisição');
        return d as T;
    });
}

function formatarDataHora(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
}

interface LinhaPremiacaoProps {
    item: PremioGanhoItem;
    onPagar: (id: number) => void;
    pagando: number | null;
}

function LinhaPremiacao({ item, onPagar, pagando }: LinhaPremiacaoProps) {
    return (
        <div className="incen-pag-linha">
            <div className="card-borda-charme"></div>
            <div className="incen-pag-linha-info">
                <div className="incen-pag-linha-principal">
                    <span className="incen-pag-emoji">{item.banner_emoji}</span>
                    <div>
                        <p className="incen-pag-gincana-nome">{item.gincana_nome}</p>
                        <p className="incen-pag-usuario">{item.usuario_nome}</p>
                    </div>
                    <div className="incen-pag-nivel">
                        <span className="incen-pag-nivel-label">{item.nivel_label}</span>
                        <span className="incen-pag-premio">{item.descricao_premio}</span>
                    </div>
                </div>
                <div className="incen-pag-linha-meta">
                    <span className="incen-pag-data">Ganho em: {formatarDataHora(item.ganho_em)}</span>
                    {item.valor_reais && (
                        <span className="incen-pag-valor">R$ {parseFloat(String(item.valor_reais)).toFixed(2)}</span>
                    )}
                </div>
            </div>
            <button
                className="gs-btn gs-btn-primario incen-pag-btn-pagar"
                onClick={() => onPagar(item.id)}
                disabled={pagando === item.id}
            >
                {pagando === item.id ? '...' : <><i className="fas fa-check"></i> Pagar</>}
            </button>
        </div>
    );
}

function LinhaHistorico({ item }: { item: PremioGanhoItem }) {
    return (
        <div className="incen-pag-linha incen-pag-linha--pago">
            <div className="card-borda-charme"></div>
            <div className="incen-pag-linha-info">
                <div className="incen-pag-linha-principal">
                    <span className="incen-pag-emoji">{item.banner_emoji}</span>
                    <div>
                        <p className="incen-pag-gincana-nome">{item.gincana_nome}</p>
                        <p className="incen-pag-usuario">{item.usuario_nome}</p>
                    </div>
                    <div className="incen-pag-nivel">
                        <span className="incen-pag-nivel-label">{item.nivel_label}</span>
                        <span className="incen-pag-premio">{item.descricao_premio}</span>
                    </div>
                </div>
                <div className="incen-pag-linha-meta">
                    <span className="incen-pag-data incen-pag-data--pago">
                        <i className="fas fa-check-circle"></i> Pago em: {formatarDataHora(item.pago_em)}
                    </span>
                    {item.pago_por_nome && (
                        <span className="incen-pag-pago-por">por {item.pago_por_nome}</span>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function IncenPagamentosTab() {
    const [aba, setAba] = useState<IncenPagamentosSubAba>('fila');
    const [fila, setFila] = useState<PremiosFilaResponse | null>(null);
    const [historico, setHistorico] = useState<PremioGanhoItem[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [pagando, setPagando] = useState<number | null>(null);
    const [pagandoLote, setPagandoLote] = useState(false);

    const buscarFila = useCallback(async () => {
        setCarregando(true);
        try {
            const data = await fetchApi<PremiosFilaResponse>('/api/gincanas-pagamentos/fila');
            setFila(data);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        } finally {
            setCarregando(false);
        }
    }, []);

    const buscarHistorico = useCallback(async () => {
        setCarregando(true);
        try {
            const data = await fetchApi<PremioGanhoItem[]>('/api/gincanas-pagamentos/historico');
            setHistorico(data);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        } finally {
            setCarregando(false);
        }
    }, []);

    useEffect(() => {
        if (aba === 'fila') void buscarFila();
        else void buscarHistorico();
    }, [aba]);

    const handlePagarIndividual = async (id: number) => {
        setPagando(id);
        try {
            await fetchApi(`/api/gincanas-pagamentos/${id}/pagar`, { method: 'POST' });
            mostrarMensagem('Prêmio marcado como pago!', 'sucesso');
            void buscarFila();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        } finally {
            setPagando(null);
        }
    };

    const handlePagarLote = async () => {
        if (!fila) return;
        const total = fila.total_pendente;
        if (!total) { mostrarMensagem('Nenhum prêmio pendente.', 'aviso'); return; }

        const ok = await mostrarConfirmacao(
            `Pagar todos os ${total} prêmio(s) pendente(s)? Esta ação não pode ser desfeita.`
        );
        if (!ok) return;

        setPagandoLote(true);
        try {
            const result = await fetchApi<PremiosPagarLoteResult>('/api/gincanas-pagamentos/pagar-lote', { method: 'POST' });
            mostrarMensagem(`${result.pagos} prêmio(s) pagos com sucesso!`, 'sucesso');
            void buscarFila();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        } finally {
            setPagandoLote(false);
        }
    };

    const totalPendente = fila?.total_pendente || 0;
    const pendentesAtual = fila?.pendentes_semana_atual || [];
    const pendentesAtrasados = fila?.pendentes_atrasados || [];

    return (
        <>
            <div className="gs-card">
                <div className="incen-subfiltros">
                    <button
                        className={`incen-subfiltro-btn ${aba === 'fila' ? 'ativo' : ''}`}
                        onClick={() => setAba('fila')}
                    >
                        <i className="fas fa-clock"></i>
                        Fila de Pagamento
                        {totalPendente > 0 && (
                            <span className="incen-subfiltro-badge incen-subfiltro-badge--alerta">
                                {totalPendente}
                            </span>
                        )}
                    </button>
                    <button
                        className={`incen-subfiltro-btn ${aba === 'historico' ? 'ativo' : ''}`}
                        onClick={() => setAba('historico')}
                    >
                        <i className="fas fa-history"></i>
                        Histórico
                    </button>
                </div>

                {carregando ? (
                    <UICarregando variante="bloco" />
                ) : aba === 'fila' ? (
                    <div className="incen-pag-fila">
                        {totalPendente > 0 && (
                            <div className="incen-pag-acoes-topo">
                                <p className="incen-pag-resumo">
                                    <i className="fas fa-trophy"></i>
                                    <strong>{totalPendente}</strong> prêmio(s) aguardando pagamento
                                </p>
                                <button
                                    className="gs-btn gs-btn-primario"
                                    onClick={() => void handlePagarLote()}
                                    disabled={pagandoLote}
                                >
                                    {pagandoLote
                                        ? 'Pagando...'
                                        : <><i className="fas fa-check-double"></i> Pagar todos ({totalPendente})</>
                                    }
                                </button>
                            </div>
                        )}

                        {pendentesAtual.length > 0 && (
                            <div className="incen-pag-grupo">
                                <h3 className="incen-pag-grupo-titulo">
                                    <i className="fas fa-calendar-week"></i> Semana Atual
                                </h3>
                                <div className="incen-pag-lista">
                                    {pendentesAtual.map(item => (
                                        <LinhaPremiacao
                                            key={item.id}
                                            item={item}
                                            onPagar={(id) => void handlePagarIndividual(id)}
                                            pagando={pagando}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {pendentesAtrasados.length > 0 && (
                            <div className="incen-pag-grupo">
                                <h3 className="incen-pag-grupo-titulo incen-pag-grupo-titulo--atrasado">
                                    <i className="fas fa-exclamation-triangle"></i> Semanas Anteriores (Pendentes)
                                </h3>
                                <div className="incen-pag-lista">
                                    {pendentesAtrasados.map(item => (
                                        <LinhaPremiacao
                                            key={item.id}
                                            item={item}
                                            onPagar={(id) => void handlePagarIndividual(id)}
                                            pagando={pagando}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {totalPendente === 0 && (
                            <div className="incen-lista-vazia">
                                <i className="fas fa-check-circle" style={{ color: '#22c55e' }}></i>
                                <p>Nenhum prêmio pendente de pagamento.</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="incen-pag-historico">
                        {historico.length === 0 ? (
                            <div className="incen-lista-vazia">
                                <i className="fas fa-history"></i>
                                <p>Nenhum pagamento realizado ainda.</p>
                            </div>
                        ) : (
                            <div className="incen-pag-lista">
                                {historico.map(item => (
                                    <LinhaHistorico key={item.id} item={item} />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}
