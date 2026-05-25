import React, { useState, useEffect, useMemo } from 'react';
import { fetchAPI } from '/js/utils/api-utils.js';
import { mostrarMensagem, mostrarConfirmacao } from '/js/utils/popups.js';
import imgDefaultAvatar from '../assets/default-avatar.png';
import DSUploader from './DSUploader.jsx';
import DashPerfilStreak from './DashPerfilStreak.jsx';
import DashPerfilConquistas from './DashPerfilConquistas.jsx';
import DashPerfilMelhorDia from './DashPerfilMelhorDia.jsx';
import DashPerfilGincanasCiclo from './DashPerfilGincanasCiclo.jsx';

export default function DashPerfilModal({ usuarioAtual, dadosAcumulados, onClose, aoAtualizarAvatar }) {
    const [avatares, setAvatares] = useState([]);
    const [loading, setLoading] = useState(false);
    const [streak, setStreak] = useState(null);
    const [loadingStreak, setLoadingStreak] = useState(true);
    const [conquistas, setConquistas] = useState(null);
    const [loadingConquistas, setLoadingConquistas] = useState(true);
    const [rankingPosicao, setRankingPosicao] = useState(null);
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
            ? dias.reduce((best, d) => (d.pontos || 0) > (best?.pontos || 0) ? d : best, null)
            : null;
        return { ptsNoCiclo, totalPecas, diasOuro, melhorDia };
    }, [dadosAcumulados]);

    useEffect(() => {
        carregarGaleria();

        fetchAPI('/api/dashboard/streak')
            .then(d => setStreak(d))
            .catch(() => setStreak({ diasSeguidos: 0, badgeAtual: null, proximoBadge: null, diasParaBadge: null }))
            .finally(() => setLoadingStreak(false));

        fetchAPI('/api/dashboard/conquistas-ciclo')
            .then(d => setConquistas(d))
            .catch(() => setConquistas({ total: 0, desbloqueadas: 0, lista: [] }))
            .finally(() => setLoadingConquistas(false));

        // Usa a semana ANTERIOR — resultado fechado, mais significativo que a semana em curso
        fetchAPI('/api/dashboard/ranking-semana?semana=anterior')
            .then(d => setRankingPosicao(d.totalParticipantes > 1 ? d.minhaPosicao : null))
            .catch(() => setRankingPosicao(null))
            .finally(() => setLoadingRanking(false));
    }, []);

    const carregarGaleria = async () => {
        setLoading(true);
        try {
            const dados = await fetchAPI('/api/avatares');
            setAvatares(dados);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpload = async (file) => {
        setLoading(true);
        const formData = new FormData();
        formData.append('foto', file);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/avatares/upload', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro no upload');
            await carregarGaleria();
            mostrarMensagem('Foto adicionada com sucesso!', 'sucesso');
        } catch (error) {
            mostrarMensagem(`Erro: ${error.message}`, 'erro');
        } finally {
            setLoading(false);
        }
    };

    const handleSelecionar = async (id) => {
        setLoading(true);
        try {
            await fetchAPI(`/api/avatares/definir-ativo/${id}`, { method: 'PUT' });
            aoAtualizarAvatar();
            mostrarMensagem('Foto de perfil atualizada!', 'sucesso');
            onClose();
        } catch (error) {
            mostrarMensagem(error.message, 'erro');
            setLoading(false);
        }
    };

    const handleExcluir = async (id) => {
        const confirmado = await mostrarConfirmacao('Tem certeza que deseja excluir esta foto?');
        if (!confirmado) return;
        setLoading(true);
        try {
            await fetchAPI(`/api/avatares/${id}`, { method: 'DELETE' });
            await carregarGaleria();
            aoAtualizarAvatar();
            mostrarMensagem('Foto excluída.', 'info');
        } catch (error) {
            mostrarMensagem(error.message, 'erro');
        } finally {
            setLoading(false);
        }
    };

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
                            <div className="p-stat-ouro-icone">🥇</div>
                            <div className="p-stat-val">{stats.diasOuro}</div>
                            <div className="p-stat-lbl">Ouro</div>
                        </div>
                    </div>
                </div>

                {/* CORPO */}
                <div className="perfil-body">
                    {/* Galeria de avatares */}
                    <div className="perfil-secao">
                        <div className="perfil-secao-titulo">📷 Minha Galeria</div>
                        {loading && avatares.length === 0 ? (
                            <div className="ds-spinner" style={{ margin: '12px auto' }} />
                        ) : (
                            <DSUploader
                                variant="dropzone"
                                maxFiles={3}
                                accept="image/*"
                                value={avatares}
                                onUpload={handleUpload}
                                onRemove={handleExcluir}
                                onSelect={handleSelecionar}
                                label={null}
                                hint="Toque para escolher da galeria ou câmera"
                                chips={['JPG / PNG', 'Máx. 5 MB', 'Até 3 fotos']}
                            />
                        )}
                        <p style={{ fontSize: '0.72rem', color: '#999', marginTop: 8, textAlign: 'center' }}>
                            Toque em uma foto para definir como perfil.
                        </p>
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
        </div>
    );
}
