import React, { useState, useEffect, useMemo } from 'react';
// @ts-expect-error módulo JS legado sem tipos
import { fetchAPI } from '/js/utils/api-utils.js';
import imgDefaultAvatar from '../assets/default-avatar.png';
import PerfilAvatarStudio from './PerfilAvatarStudio';
import DashPerfilStreak from './DashPerfilStreak';
import DashPerfilConquistas from './DashPerfilConquistas';
import DashPerfilMelhorDia from './DashPerfilMelhorDia';
import DashPerfilGincanasCiclo from './DashPerfilGincanasCiclo';
import type { DashUsuario, DashAcumulado, DashStreakResponse, DashConquistasCicloResponse, DashRankingSemana } from '../utils/dashboard-types';

interface DashPerfilModalProps {
    usuarioAtual?: DashUsuario | null;
    dadosAcumulados?: DashAcumulado | null;
    onClose: () => void;
    aoAtualizarAvatar?: () => void | Promise<void>;
}

export default function DashPerfilModal({ usuarioAtual, dadosAcumulados, onClose, aoAtualizarAvatar }: DashPerfilModalProps) {
    const [avatarStudioAberto, setAvatarStudioAberto] = useState(false);
    const [streak, setStreak] = useState<DashStreakResponse | null>(null);
    const [loadingStreak, setLoadingStreak] = useState(true);
    const [conquistas, setConquistas] = useState<DashConquistasCicloResponse | null>(null);
    const [loadingConquistas, setLoadingConquistas] = useState(true);
    const [rankingPosicao, setRankingPosicao] = useState<number | null>(null);
    const [loadingRanking, setLoadingRanking] = useState(true);

    const avatarUrl = usuarioAtual?.avatar_url || imgDefaultAvatar;
    const nomeUsuario = usuarioAtual?.nome || 'Funcionária';
    const nivelUsuario = usuarioAtual?.nivel || '?';

    const tipoLabel = useMemo(() => {
        const tipos = usuarioAtual?.tipos || [];
        if (tipos.includes('tiktik')) return 'Tiktik';
        if (tipos.includes('costureira')) return 'Costureira';
        if (tipos.includes('cortador')) return 'Cortador';
        return usuarioAtual?.tipo || 'Funcionária';
    }, [usuarioAtual]);

    // Stats derivados de dadosAcumulados (sem chamada adicional de API)
    const stats = useMemo(() => {
        const dias = dadosAcumulados?.diasDetalhes || [];
        const ptsNoCiclo = dias.reduce((sum, d) => sum + (d.pontos || 0), 0);
        const totalPecas = dadosAcumulados?.totalPecasCiclo || 0;
        // Dias em que bateu a meta Ouro no ciclo
        const diasOuro = dias.filter(d => d.nivelMeta === 'ouro').length;

        const melhorDia = dias.length > 0
            ? dias.reduce<typeof dias[number] | null>((best, d) => (d.pontos || 0) > (best?.pontos || 0) ? d : best, null)
            : null;
        return { ptsNoCiclo, totalPecas, diasOuro, melhorDia };
    }, [dadosAcumulados]);

    useEffect(() => {
        fetchAPI('/api/dashboard/streak')
            .then((d: DashStreakResponse) => setStreak(d))
            .catch(() => setStreak({ diasSeguidos: 0, badgeAtual: null, proximoBadge: null, diasParaBadge: null }))
            .finally(() => setLoadingStreak(false));

        fetchAPI('/api/dashboard/conquistas-ciclo')
            .then((d: DashConquistasCicloResponse) => setConquistas(d))
            .catch(() => setConquistas({ total: 0, desbloqueadas: 0, lista: [] }))
            .finally(() => setLoadingConquistas(false));

        // Usa a semana ANTERIOR — resultado fechado, mais significativo que a semana em curso
        fetchAPI('/api/dashboard/ranking-semana?semana=anterior')
            .then((d: DashRankingSemana) => setRankingPosicao(d.totalParticipantes && d.totalParticipantes > 1 ? (d.minhaPosicao ?? null) : null))
            .catch(() => setRankingPosicao(null))
            .finally(() => setLoadingRanking(false));
    }, []);

    return (
        <div className="ds-popup-overlay ativo" onClick={onClose} style={{ zIndex: 1300 }}>
            <div className="ds-perfil-modal" onClick={e => e.stopPropagation()}>

                {/* HERO */}
                <div className="perfil-hero">
                    <button className="ds-modal-close-simple" onClick={onClose}>
                        <i className="fas fa-times" />
                    </button>

                    <div className="perfil-av-wrap">
                        <img src={avatarUrl} className="perfil-av" alt="Foto de perfil" />
                        <span className="perfil-level-badge">Nv {nivelUsuario}</span>
                    </div>

                    <div className="perfil-nome">{nomeUsuario}</div>
                    <div className="perfil-tipo">
                        <i className={tipoLabel === 'Tiktik' ? 'fas fa-cut' : 'fas fa-tshirt'} /> {tipoLabel}
                    </div>

                    <div className="perfil-stats">
                        <div className="p-stat">
                            <div className="p-stat-val">
                                {stats.ptsNoCiclo >= 1000
                                    ? `${(stats.ptsNoCiclo / 1000).toFixed(1)}k`
                                    : Math.round(stats.ptsNoCiclo).toLocaleString('pt-BR')}
                            </div>
                            <div className="p-stat-lbl">Pontos no ciclo</div>
                        </div>
                        <div className="p-stat">
                            <div className="p-stat-val">
                                {stats.totalPecas.toLocaleString('pt-BR')}
                            </div>
                            <div className="p-stat-lbl">Peças Produzidas</div>
                        </div>
                        <div className="p-stat">
                            <div className="p-stat-val">
                                {loadingRanking ? '—' : rankingPosicao ? `${rankingPosicao}ª` : '—'}
                            </div>
                            <div className="p-stat-lbl">Semana Passada</div>
                        </div>
                        <div className={`p-stat p-stat--ouro${stats.diasOuro > 0 ? ' ativo' : ''}`}>
                            <div className="p-stat-ouro-icone">ðŸ¥‡</div>
                            <div className="p-stat-val">{stats.diasOuro}</div>
                            <div className="p-stat-lbl">Ouro</div>
                        </div>
                    </div>
                </div>

                {/* CORPO */}
                <div className="perfil-body">
                    {/* Estúdio de avatar compartilhado */}
                    <div className="perfil-secao">
                        <div className="perfil-secao-titulo">ðŸ“· Minha foto</div>
                        <button
                            type="button"
                            className="dsu-dropzone"
                            onClick={() => setAvatarStudioAberto(true)}
                        >
                            <div className="dsu-icon">
                                <i className="fas fa-wand-magic-sparkles" />
                            </div>
                            <div className="dsu-label">Abrir estúdio de foto</div>
                            <div className="dsu-hint">
                                Recorte, reposicione e veja a prévia antes de salvar
                            </div>
                            <div className="dsu-chips">
                                <span className="dsu-chip">Galeria</span>
                                <span className="dsu-chip">Câmera</span>
                                <span className="dsu-chip">Até 3 fotos</span>
                            </div>
                        </button>
                    </div>

                    {/* Streak */}
                    <DashPerfilStreak
                        diasSeguidos={streak?.diasSeguidos}
                        badgeAtual={streak?.badgeAtual}
                        proximoBadge={streak?.proximoBadge}
                        diasParaBadge={streak?.diasParaBadge}
                        loading={loadingStreak}
                    />

                    {/* Conquistas */}
                    <DashPerfilConquistas
                        total={conquistas?.total}
                        desbloqueadas={conquistas?.desbloqueadas}
                        lista={conquistas?.lista}
                        loading={loadingConquistas}
                    />

                    {/* Melhor dia */}
                    <DashPerfilMelhorDia
                        pontos={stats.melhorDia?.pontos}
                        data={stats.melhorDia?.data}
                    />

                    {/* Gincanas do ciclo */}
                    <DashPerfilGincanasCiclo />
                </div>

            </div>
            <PerfilAvatarStudio
                isOpen={avatarStudioAberto}
                token={localStorage.getItem('token')}
                nomeUsuario={nomeUsuario}
                onClose={() => setAvatarStudioAberto(false)}
                onAvatarChanged={() => { void aoAtualizarAvatar?.(); }}
            />
        </div>
    );
}
