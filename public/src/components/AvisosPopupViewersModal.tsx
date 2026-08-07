// public/src/components/AvisosPopupViewersModal.tsx
// Modal gerencial: mostra quem já visualizou e quem ainda não viu um aviso popup.

import { useState, useEffect } from 'react';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import type {
    AvisoPopup,
    AvisoPopupViewersAba,
    AvisoPopupViewersResponse,
} from '../utils/alertas-types';

function formatarDataHora(isoString?: string | null): string {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return d.toLocaleString('pt-BR', {
        day:    '2-digit',
        month:  '2-digit',
        year:   'numeric',
        hour:   '2-digit',
        minute: '2-digit',
    });
}

export interface AvisosPopupViewersModalProps {
    aviso: AvisoPopup | null;
    onFechar: () => void;
}

export default function AvisosPopupViewersModal({ aviso, onFechar }: AvisosPopupViewersModalProps) {
    const [dados, setDados]       = useState<AvisoPopupViewersResponse | null>(null);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro]         = useState<string | null>(null);
    const [aba, setAba]           = useState<AvisoPopupViewersAba>('viram'); // 'viram' | 'nao_viram'

    useEffect(() => {
        if (!aviso) return;
        setCarregando(true);
        setErro(null);
        const token = localStorage.getItem('token');
        fetch(`/api/avisos-popup/${aviso.id}/visualizacoes`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(r => r.json() as Promise<AvisoPopupViewersResponse>)
            .then(data => {
                if (data.error) throw new Error(data.error);
                setDados(data);
            })
            .catch((e: unknown) => setErro(e instanceof Error ? e.message : 'Erro'))
            .finally(() => setCarregando(false));
    }, [aviso?.id]);

    if (!aviso) return null;

    const totalViu    = dados?.visualizaram?.length  ?? 0;
    const totalNaoViu = dados?.nao_visualizaram?.length ?? 0;
    const totalDest   = totalViu + totalNaoViu;
    const pct         = totalDest > 0 ? Math.round((totalViu / totalDest) * 100) : 0;

    return (
        <div className="avpv-overlay" onClick={e => e.target === e.currentTarget && onFechar()}>
            <div className="avpv-modal">

                {/* Header */}
                <div className="avpv-header">
                    <div className="avpv-header-info">
                        <span className="avpv-label">Visualizações do aviso</span>
                        <strong className="avpv-titulo">{aviso.titulo}</strong>
                    </div>
                    <button className="avpv-btn-fechar" onClick={onFechar} aria-label="Fechar">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* Barra de progresso */}
                {!carregando && !erro && dados && (
                    <div className="avpv-progresso-wrap">
                        <div className="avpv-progresso-barra">
                            <div
                                className="avpv-progresso-fill"
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                        <span className="avpv-progresso-label">
                            <strong>{totalViu}</strong> de <strong>{totalDest}</strong> visualizaram
                            <span className="avpv-pct">{pct}%</span>
                        </span>
                    </div>
                )}

                {/* Tabs */}
                <div className="avpv-tabs">
                    <button
                        className={`avpv-tab ${aba === 'viram' ? 'ativo' : ''}`}
                        onClick={() => setAba('viram')}
                    >
                        <i className="fas fa-eye"></i> Viram
                        {dados && <span className="avpv-tab-badge avpv-tab-badge--verde">{totalViu}</span>}
                    </button>
                    <button
                        className={`avpv-tab ${aba === 'nao_viram' ? 'ativo' : ''}`}
                        onClick={() => setAba('nao_viram')}
                    >
                        <i className="fas fa-eye-slash"></i> Não viram ainda
                        {dados && totalNaoViu > 0 && (
                            <span className="avpv-tab-badge avpv-tab-badge--cinza">{totalNaoViu}</span>
                        )}
                    </button>
                </div>

                {/* Corpo */}
                <div className="avpv-corpo">
                    {carregando && <UICarregando variante="bloco" />}

                    {erro && (
                        <div className="avpv-erro">
                            <i className="fas fa-exclamation-circle"></i> {erro}
                        </div>
                    )}

                    {!carregando && !erro && dados && aba === 'viram' && (
                        <>
                            {totalViu === 0 ? (
                                <UIFeedbackNotFound
                                    variante="compacto"
                                    icon="fa-eye-slash"
                                    titulo="Ninguém visualizou ainda"
                                    mensagem="Ainda não há confirmações de leitura para este aviso."
                                />
                            ) : (
                                <ul className="avpv-lista">
                                    {dados.visualizaram.map(u => (
                                        <li key={u.id} className="avpv-item avpv-item--viu">
                                            <span className="avpv-item-avatar">
                                                {u.nome.charAt(0).toUpperCase()}
                                            </span>
                                            <span className="avpv-item-nome">{u.nome}</span>
                                            <span className="avpv-item-hora">
                                                <i className="fas fa-check-circle"></i>
                                                {formatarDataHora(u.visto_em)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}

                    {!carregando && !erro && dados && aba === 'nao_viram' && (
                        <>
                            {totalNaoViu === 0 ? (
                                <UIFeedbackNotFound
                                    variante="compacto"
                                    icon="fa-check-circle"
                                    titulo="Todos já visualizaram!"
                                    mensagem="Não há pessoas pendentes de leitura."
                                />
                            ) : (
                                <ul className="avpv-lista">
                                    {dados.nao_visualizaram.map(u => (
                                        <li key={u.id} className="avpv-item avpv-item--nao-viu">
                                            <span className="avpv-item-avatar avpv-item-avatar--cinza">
                                                {u.nome.charAt(0).toUpperCase()}
                                            </span>
                                            <span className="avpv-item-nome">{u.nome}</span>
                                            <span className="avpv-item-pendente">Pendente</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
