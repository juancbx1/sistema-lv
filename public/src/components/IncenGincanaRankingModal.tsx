// public/src/components/IncenGincanaRankingModal.tsx
import { useState, useEffect, useCallback } from 'react';
// @ts-expect-error popups JS legados sem declaração TypeScript
import { mostrarMensagem } from '/js/utils/popups.js';
import UICarregando from './UICarregando';
import type {
    Gincana,
    GincanaPremiacao,
    GincanaRankingResponse,
    GincanaRankingRow,
} from '../utils/incentivos-types';

function formatarContagem(seg: number | null | undefined): string {
    if (!seg || seg <= 0) return '–';
    const h = Math.floor(seg / 3600);
    const m = Math.floor((seg % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min`;
}

function formatarGanhoEm(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const data = new Date(iso);
    const hoje = new Date();
    const hora = data.toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    });
    const ehHoje = data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        === hoje.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    if (ehHoje) return `às ${hora}`;
    const dataStr = data.toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
    });
    return `${hora} de ${dataStr}`;
}

export interface IncenGincanaRankingModalProps {
    gincana: Gincana;
    onFechar: () => void;
}

export default function IncenGincanaRankingModal({ gincana, onFechar }: IncenGincanaRankingModalProps) {
    const [dados, setDados] = useState<GincanaRankingResponse | null>(null);
    const [carregando, setCarregando] = useState(true);
    const token = localStorage.getItem('token');

    const buscar = useCallback(async () => {
        setCarregando(true);
        try {
            const res = await fetch(`/api/gincanas/${gincana.id}/ranking`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json() as GincanaRankingResponse & { error?: string };
            if (!res.ok) throw new Error(data.error);
            setDados(data);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro ao carregar ranking: ${msg}`, 'erro');
        } finally {
            setCarregando(false);
        }
    }, [gincana.id, token]);

    useEffect(() => { void buscar(); }, [buscar]);

    const g: Gincana = dados?.gincana || gincana;
    const fase = g.fase || gincana.fase;
    const premiacoes: GincanaPremiacao[] = dados?.premiacoes || [];
    const ranking: GincanaRankingRow[] = dados?.ranking || [];
    const semanaLabel = dados?.semana_label || g.semana_label;
    const totalEquipe = dados?.total_equipe ?? null;

    const ehCorrida  = g.tipo_premiacao === 'corrida';
    const ehEquipe   = g.modalidade === 'equipe';
    const ehUnidade  = g.escopo_atividade === 'produto_especifico';
    const unidadeLabel = ehUnidade ? 'un.' : 'pts';

    // Valor de referência para a barra: equipe usa total coletivo, individual usa valor próprio
    const metaMax = premiacoes.length
        ? Math.max(...premiacoes.map(p => parseFloat(String(p.meta_valor ?? p.meta_pontos ?? 0))))
        : 0;

    const valorBase = ehEquipe ? (totalEquipe ?? 0) : null;

    const pctBarra = (valor: number | null) => {
        const base = ehEquipe ? (totalEquipe ?? 0) : (valor ?? 0);
        if (!metaMax) return 0;
        return Math.min(100, Math.round((base / metaMax) * 100));
    };

    const metaBatidosCount = ehEquipe
        ? ((valorBase ?? 0) >= metaMax ? ranking.length : 0)
        : ranking.filter(r => r.nivel_ganho).length;

    const encerradaComGanhador = g.encerrada_com_ganhador;

    return (
        <div className="gs-modal-overlay" onClick={(e) => e.target === e.currentTarget && onFechar()}>
            <div className="gs-modal incen-ranking-modal" onClick={e => e.stopPropagation()}>

                {/* Cabeçalho */}
                <div className="gs-modal-cabecalho">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
                        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {g.banner_emoji} {g.nome}
                            <span className={`incen-gincana-badge ${
                                fase === 'ao_vivo' ? 'ao-vivo' :
                                fase === 'encerrada' || fase === 'arquivada' ? 'encerrada' : 'proxima'
                            }`}>
                                {fase === 'ao_vivo' && <span className="badge-dot"></span>}
                                {fase === 'ao_vivo' ? 'AO VIVO' :
                                 (fase === 'encerrada' || fase === 'arquivada') ? 'ENCERRADA' : 'PRÓXIMA'}
                            </span>
                            {ehCorrida && <span className="incen-gincana-badge incen-badge-corrida">🏁 CORRIDA</span>}
                            {ehEquipe  && <span className="incen-gincana-badge incen-badge-equipe">👥 EQUIPE</span>}
                        </h2>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--gs-texto-secundario)' }}>
                            {semanaLabel && (
                                <span><i className="fas fa-calendar-week" style={{ marginRight: 4 }}></i>{semanaLabel}</span>
                            )}
                            {fase === 'ao_vivo' && g.segundos_para_fim != null && g.segundos_para_fim > 0 && (
                                <span className="incen-ranking-tempo">
                                    <i className="fas fa-hourglass-half"></i>
                                    {formatarContagem(g.segundos_para_fim)} restantes
                                </span>
                            )}
                        </div>
                    </div>
                    <button className="gs-btn-fechar" onClick={onFechar}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="gs-modal-corpo" style={{ padding: '16px 20px' }}>

                    {/* Resumo de premiações */}
                    {premiacoes.length > 0 && (
                        <div className="incen-ranking-metas-resumo">
                            {premiacoes.map((p, i) => (
                                <span key={i} className="incen-premi-chip">
                                    {p.emoji_icone} {p.nivel_label} → {parseFloat(String(p.meta_valor ?? p.meta_pontos ?? 0)).toFixed(0)} {unidadeLabel} — {p.descricao_premio}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Corrida encerrada: destaque do vencedor */}
                    {ehCorrida && encerradaComGanhador && !carregando && (
                        <div className="incen-ranking-corrida-resultado">
                            {(() => {
                                const vencedor = ranking.find(r => r.usuario_id == g.vencedor_id);
                                const ganhoEmLabel = vencedor?.ganho_em ? formatarGanhoEm(vencedor.ganho_em) : null;
                                return vencedor ? (
                                    <>
                                        <p>🏁 Corrida encerrada — 🏆 Vencedor: <strong>{vencedor.nome}</strong> com {vencedor.valor.toFixed(0)} {unidadeLabel}</p>
                                        {ganhoEmLabel && <p className="incen-ranking-corrida-ganho-em">⏱ Cruzou a linha {ganhoEmLabel}</p>}
                                    </>
                                ) : (
                                    <p>🏆 Corrida encerrada com vencedor.</p>
                                );
                            })()}
                        </div>
                    )}

                    {/* Equipe: barra de progresso coletivo */}
                    {ehEquipe && !carregando && totalEquipe !== null && (
                        <div className="incen-ranking-equipe-total">
                            <div className="incen-ranking-equipe-header">
                                <span>Progresso da equipe</span>
                                <span><strong>{totalEquipe.toFixed(0)}</strong> / {metaMax.toFixed(0)} {unidadeLabel}</span>
                            </div>
                            <div className="incen-ranking-barra-wrap" style={{ height: 10 }}>
                                <div
                                    className={`incen-ranking-barra ${pctBarra(totalEquipe) >= 100 ? 'ganhou' : ''}`}
                                    style={{ width: `${pctBarra(totalEquipe)}%` }}
                                ></div>
                            </div>
                            <p className="incen-ranking-equipe-status">
                                {pctBarra(totalEquipe) >= 100
                                    ? `✅ Meta da equipe batida! (${pctBarra(totalEquipe)}%)`
                                    : `${pctBarra(totalEquipe)}% — Faltam ${Math.max(0, metaMax - totalEquipe).toFixed(0)} ${unidadeLabel}`
                                }
                            </p>
                        </div>
                    )}

                    {/* Tabela de ranking */}
                    {carregando ? (
                        <UICarregando variante="bloco" />
                    ) : ranking.length === 0 ? (
                        <div className="incen-lista-vazia">
                            <i className="fas fa-users"></i>
                            <p>Nenhum participante encontrado.</p>
                        </div>
                    ) : (
                        <div className="incen-ranking-tabela-wrap">
                            <table className="incen-ranking-tabela">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Nome</th>
                                        <th>{ehUnidade ? 'Unid.' : 'Pts'}</th>
                                        {!ehEquipe && <th>Progresso</th>}
                                        <th>Status</th>
                                        <th title="Pagamento">💰</th>
                                        <th title="Quando bateu a meta">⏱</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ranking.map((r) => {
                                        const pct = ehEquipe ? pctBarra(totalEquipe) : pctBarra(r.valor);
                                        const ganhou = ehEquipe
                                            ? ((totalEquipe ?? 0) >= metaMax)
                                            : !!r.nivel_ganho;
                                        const ehVencedor = ehCorrida && r.usuario_id == g.vencedor_id;

                                        return (
                                            <tr key={r.usuario_id} className={
                                                ehVencedor ? 'incen-ranking-row--vencedor' :
                                                ganhou ? 'incen-ranking-row--ganhou' : ''
                                            }>
                                                <td className="incen-ranking-pos">
                                                    {ehCorrida && ehVencedor ? '🏆' :
                                                     r.posicao === 1 ? '🥇' :
                                                     r.posicao === 2 ? '🥈' :
                                                     r.posicao === 3 ? '🥉' : r.posicao}
                                                </td>
                                                <td className="incen-ranking-nome">{r.nome}</td>
                                                <td className="incen-ranking-pts">{r.valor.toFixed(0)}</td>
                                                {!ehEquipe && (
                                                    <td className="incen-ranking-barra-cell">
                                                        <div className="incen-ranking-barra-wrap">
                                                            <div
                                                                className={`incen-ranking-barra ${ganhou ? 'ganhou' : ''}`}
                                                                style={{ width: `${pct}%` }}
                                                            ></div>
                                                        </div>
                                                        <span className="incen-ranking-pct">{pct}%</span>
                                                    </td>
                                                )}
                                                <td className="incen-ranking-status">
                                                    {ehCorrida ? (
                                                        ehVencedor
                                                            ? <span className="incen-ranking-badge-ganhou">🏆 Vencedor</span>
                                                            : <span className="incen-ranking-badge-falta">–</span>
                                                    ) : ganhou ? (
                                                        <span className="incen-ranking-badge-ganhou">✅ {r.nivel_ganho}</span>
                                                    ) : (
                                                        <span className="incen-ranking-badge-falta">
                                                            {metaMax > 0
                                                                ? `Faltam ${Math.max(0, metaMax - (ehEquipe ? (totalEquipe ?? 0) : r.valor)).toFixed(0)} ${unidadeLabel}`
                                                                : '–'
                                                            }
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="incen-ranking-pagamento">
                                                    {r.premio_pago
                                                        ? <span title="Prêmio pago" className="incen-ranking-badge-pago">✓</span>
                                                        : r.premio_registrado
                                                            ? <span title="Prêmio pendente" className="incen-ranking-badge-pendente">⏳</span>
                                                            : <span style={{ color: '#d1d5db' }}>—</span>
                                                    }
                                                </td>
                                                <td className="incen-ranking-ganhou-em">
                                                    {r.ganho_em ? formatarGanhoEm(r.ganho_em) : <span style={{ color: '#d1d5db' }}>—</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Rodapé informativo */}
                    {!carregando && ranking.length > 0 && (
                        <div className="incen-ranking-rodape-info">
                            {ehCorrida ? (
                                encerradaComGanhador
                                    ? '🏁 Corrida encerrada — vencedor registrado'
                                    : fase === 'ao_vivo'
                                        ? '🏁 Corrida em andamento — primeiro a bater a meta ganha'
                                        : '🏁 Corrida encerrada sem ganhador'
                            ) : ehEquipe ? (
                                (totalEquipe ?? 0) >= metaMax
                                    ? `✅ Equipe bateu a meta! Todos os ${ranking.length} participantes ganham`
                                    : `Equipe com ${ranking.length} participantes — meta coletiva`
                            ) : (
                                metaBatidosCount > 0
                                    ? `✅ Meta batida por ${metaBatidosCount} de ${ranking.length} participantes`
                                    : `Nenhum participante bateu a meta ainda`
                            )}
                        </div>
                    )}
                </div>

                <div className="gs-modal-rodape">
                    {(fase === 'ao_vivo' || fase === 'encerrada_semana') && (
                        <button className="gs-btn gs-btn-secundario" onClick={() => void buscar()} disabled={carregando}>
                            <i className="fas fa-sync-alt"></i> Atualizar
                        </button>
                    )}
                    <button className="gs-btn gs-btn-secundario" onClick={onFechar}>Fechar</button>
                </div>
            </div>
        </div>
    );
}
