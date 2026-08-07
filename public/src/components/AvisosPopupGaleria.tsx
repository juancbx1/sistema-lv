// public/src/components/AvisosPopupGaleria.tsx
// Mini galeria de imagens armazenadas no Vercel Blob para avisos popup.
// Permite visualizar, copiar URL e deletar imagens (com proteção para imagens em uso).

import { useState, useEffect, useCallback } from 'react';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import { mostrarMensagem, mostrarConfirmacao } from '../../js/utils/popups.js';
import type {
    AvisoPopupBlobImagem,
    AvisoPopupGaleriaFiltro,
} from '../utils/alertas-types';

function formatarTamanho(bytes: number): string {
    if (bytes < 1024)        return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatarData(isoString?: string | null): string {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function nomeArquivo(pathname: string): string {
    // "avisos-popup/aviso-1716123456789.webp" → "aviso-1716123456789.webp"
    const partes = pathname.split('/');
    return partes[partes.length - 1] ?? pathname;
}

export interface AvisosPopupGaleriaProps {
    onFechar: () => void;
}

export default function AvisosPopupGaleria({ onFechar }: AvisosPopupGaleriaProps) {
    const [imagens, setImagens]         = useState<AvisoPopupBlobImagem[]>([]);
    const [carregando, setCarregando]   = useState(true);
    const [erro, setErro]               = useState<string | null>(null);
    const [deletando, setDeletando]     = useState<string | null>(null); // url sendo deletada
    const [copiado, setCopiado]         = useState<string | null>(null); // url recém copiada
    const [filtro, setFiltro]           = useState<AvisoPopupGaleriaFiltro>('todas'); // 'todas' | 'em_uso' | 'livres'

    const token = localStorage.getItem('token');

    const carregar = useCallback(async () => {
        setCarregando(true);
        setErro(null);
        try {
            const res = await fetch('/api/avisos-popup/blob-imagens', {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = (await res.json()) as AvisoPopupBlobImagem[] & { error?: string };
            if (!res.ok) throw new Error((data as { error?: string }).error || 'Erro ao carregar');
            setImagens(Array.isArray(data) ? data : []);
        } catch (e: unknown) {
            setErro(e instanceof Error ? e.message : 'Erro');
        } finally {
            setCarregando(false);
        }
    }, [token]);

    useEffect(() => { void carregar(); }, [carregar]);

    const handleCopiar = async (url: string) => {
        try {
            await navigator.clipboard.writeText(url);
            setCopiado(url);
            setTimeout(() => setCopiado(null), 2000);
        } catch {
            // Fallback para browsers sem clipboard API
            const input = document.createElement('input');
            input.value = url;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            setCopiado(url);
            setTimeout(() => setCopiado(null), 2000);
        }
    };

    const handleDeletar = async (imagem: AvisoPopupBlobImagem) => {
        if (imagem.emUso && imagem.avisoAtivo) {
            mostrarMensagem(
                `Imagem em uso pelo aviso ativo "${imagem.emUso}". Desative o aviso antes de deletar.`,
                'aviso'
            );
            return;
        }

        const confirmado = await mostrarConfirmacao(
            imagem.emUso
                ? `A imagem está ligada ao aviso inativo "${imagem.emUso}". Deletar mesmo assim?`
                : `Deletar esta imagem permanentemente do armazenamento?`,
            { textoConfirmar: 'Deletar', tipo: 'perigo' }
        );
        if (!confirmado) return;

        setDeletando(imagem.url);
        try {
            const res = await fetch('/api/avisos-popup/blob-imagens', {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url: imagem.url }),
            });
            const data = (await res.json()) as { error?: string };
            if (!res.ok) throw new Error(data.error || 'Erro ao deletar');
            setImagens(prev => prev.filter(i => i.url !== imagem.url));
            mostrarMensagem('Imagem deletada do armazenamento.', 'sucesso');
        } catch (e: unknown) {
            mostrarMensagem(e instanceof Error ? e.message : 'Erro', 'erro');
        } finally {
            setDeletando(null);
        }
    };

    const imagensFiltradas = imagens.filter(img => {
        if (filtro === 'em_uso') return !!img.emUso;
        if (filtro === 'livres') return !img.emUso;
        return true;
    });

    const totalEmUso  = imagens.filter(i =>  i.emUso).length;
    const totalLivres = imagens.filter(i => !i.emUso).length;

    return (
        <div className="avpg-overlay" onClick={e => e.target === e.currentTarget && onFechar()}>
            <div className="avpg-modal">

                {/* Header */}
                <div className="avpg-header">
                    <div className="avpg-header-info">
                        <span className="avpg-header-label">
                            <i className="fas fa-images"></i> Galeria de imagens
                        </span>
                        {!carregando && (
                            <span className="avpg-header-sub">
                                {imagens.length} imagem{imagens.length !== 1 ? 's' : ''} armazenada{imagens.length !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                    <div className="avpg-header-acoes">
                        <button className="avpg-btn-recarregar" onClick={() => { void carregar(); }} title="Recarregar">
                            <i className="fas fa-rotate-right"></i>
                        </button>
                        <button className="avpg-btn-fechar" onClick={onFechar} aria-label="Fechar">
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                {/* Filtros */}
                {!carregando && imagens.length > 0 && (
                    <div className="avpg-filtros">
                        <button
                            className={`avpg-filtro-btn ${filtro === 'todas' ? 'ativo' : ''}`}
                            onClick={() => setFiltro('todas')}
                        >
                            Todas <span className="avpg-filtro-num">{imagens.length}</span>
                        </button>
                        <button
                            className={`avpg-filtro-btn ${filtro === 'em_uso' ? 'ativo' : ''}`}
                            onClick={() => setFiltro('em_uso')}
                        >
                            Em uso <span className="avpg-filtro-num avpg-filtro-num--uso">{totalEmUso}</span>
                        </button>
                        <button
                            className={`avpg-filtro-btn ${filtro === 'livres' ? 'ativo' : ''}`}
                            onClick={() => setFiltro('livres')}
                        >
                            Livres <span className="avpg-filtro-num avpg-filtro-num--livre">{totalLivres}</span>
                        </button>
                    </div>
                )}

                {/* Corpo */}
                <div className="avpg-corpo">
                    {carregando && <UICarregando variante="bloco" texto="Carregando imagens..." />}

                    {erro && (
                        <div className="avpg-erro">
                            <i className="fas fa-exclamation-circle"></i> {erro}
                            <button className="avpg-btn-tentar" onClick={() => { void carregar(); }}>Tentar novamente</button>
                        </div>
                    )}

                    {!carregando && !erro && imagens.length === 0 && (
                        <UIFeedbackNotFound
                            variante="compacto"
                            icon="fa-image"
                            titulo="Nenhuma imagem armazenada ainda"
                            mensagem="As imagens aparecem aqui após serem enviadas ao criar um aviso."
                        />
                    )}

                    {!carregando && !erro && imagensFiltradas.length === 0 && imagens.length > 0 && (
                        <UIFeedbackNotFound
                            variante="compacto"
                            icon="fa-filter"
                            titulo="Nenhuma imagem nessa categoria"
                            mensagem="Tente selecionar outra categoria."
                        />
                    )}

                    {!carregando && !erro && imagensFiltradas.length > 0 && (
                        <div className="avpg-grid">
                            {imagensFiltradas.map(img => (
                                <div
                                    key={img.url}
                                    className={`avpg-item ${img.emUso ? 'avpg-item--em-uso' : 'avpg-item--livre'} ${deletando === img.url ? 'avpg-item--deletando' : ''}`}
                                >
                                    {/* Thumbnail */}
                                    <div className="avpg-thumb">
                                        <img
                                            src={img.url}
                                            alt={nomeArquivo(img.pathname)}
                                            loading="lazy"
                                        />
                                        {img.emUso && (
                                            <span className={`avpg-badge-uso ${img.avisoAtivo ? 'avpg-badge-uso--ativo' : 'avpg-badge-uso--inativo'}`}>
                                                {img.avisoAtivo ? 'Ativo' : 'Inativo'}
                                            </span>
                                        )}
                                    </div>

                                    {/* Info */}
                                    <div className="avpg-info">
                                        <span className="avpg-nome" title={nomeArquivo(img.pathname)}>
                                            {nomeArquivo(img.pathname)}
                                        </span>
                                        <div className="avpg-meta">
                                            <span>{formatarTamanho(img.size)}</span>
                                            <span className="avpg-meta-sep">·</span>
                                            <span>{formatarData(img.uploadedAt)}</span>
                                        </div>
                                        {img.emUso && (
                                            <span className="avpg-aviso-nome" title={img.emUso}>
                                                <i className="fas fa-link"></i> {img.emUso}
                                            </span>
                                        )}
                                    </div>

                                    {/* Ações */}
                                    <div className="avpg-acoes">
                                        <button
                                            className={`avpg-acao-btn avpg-acao-btn--copiar ${copiado === img.url ? 'avpg-acao-btn--copiado' : ''}`}
                                            onClick={() => { void handleCopiar(img.url); }}
                                            title="Copiar URL"
                                        >
                                            <i className={`fas ${copiado === img.url ? 'fa-check' : 'fa-copy'}`}></i>
                                            {copiado === img.url ? 'Copiado!' : 'Copiar URL'}
                                        </button>
                                        <button
                                            className={`avpg-acao-btn avpg-acao-btn--deletar ${img.emUso && img.avisoAtivo ? 'avpg-acao-btn--bloqueado' : ''}`}
                                            onClick={() => { void handleDeletar(img); }}
                                            disabled={deletando === img.url}
                                            title={img.emUso && img.avisoAtivo ? `Em uso pelo aviso "${img.emUso}"` : 'Deletar imagem'}
                                        >
                                            {deletando === img.url
                                                ? <><UICarregando variante="inline" /> Deletando...</>
                                                : <><i className="fas fa-trash"></i></>
                                            }
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer com dica */}
                {!carregando && totalLivres > 0 && (
                    <div className="avpg-footer">
                        <i className="fas fa-info-circle"></i>
                        {totalLivres} imagem{totalLivres !== 1 ? 's' : ''} sem aviso associado — pode{totalLivres !== 1 ? 'm' : ''} ser deletada{totalLivres !== 1 ? 's' : ''} para liberar espaço.
                    </div>
                )}
            </div>
        </div>
    );
}
