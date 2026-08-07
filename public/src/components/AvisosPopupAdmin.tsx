// public/src/components/AvisosPopupAdmin.tsx
// Aba "Avisos Popups" dentro da Central de Alertas.
//
// Seções:
//   📋 Modelos       — is_template = true (nunca enviados)
//   📢 Ativos        — ativo = true, is_template = false
//   🗂️ Arquivados    — ativo = false, is_template = false

import { useState, useEffect } from 'react';
import { mostrarMensagem, mostrarConfirmacao } from '../../js/utils/popups.js';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import AvisosPopupModal from './AvisosPopupModal';
import AvisosPopupViewersModal from './AvisosPopupViewersModal';
import type {
    AvisoPopup,
    AvisoPopupModalState,
    AvisoPopupModo,
    AvisoPopupStatusCard,
} from '../utils/alertas-types';

async function fetchApi<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = localStorage.getItem('token');
    const res = await fetch(endpoint, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            ...(options.body && !(options.body instanceof FormData)
                ? { 'Content-Type': 'application/json' }
                : {}),
            ...(options.headers || {}),
        },
    });
    if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Erro na requisição');
    }
    return res.json() as Promise<T>;
}

const TIPO_LABEL: Record<string, string> = { texto: 'Texto', imagem: 'Imagem', misto: 'Misto' };
const DEST_LABEL: Record<string, string> = {
    todos: 'Todos',
    costureiras: 'Costureiras',
    tiktiks: 'Tiktiks',
    individuais: 'Individuais',
};

/** Rótulo amigável de destinatários (inclui nomes em avisos individuais, ex.: VT). */
function rotuloDestinatarios(aviso: AvisoPopup): string {
    if (aviso.destinatarios === 'individuais') {
        const nomes = Array.isArray(aviso.destinatarios_nomes)
            ? aviso.destinatarios_nomes.filter(Boolean)
            : [];
        if (nomes.length === 1) return nomes[0] ?? 'Individuais';
        if (nomes.length === 2) return `${nomes[0]}, ${nomes[1]}`;
        if (nomes.length > 2) return `${nomes[0]} +${nomes.length - 1}`;
        const qtd = Array.isArray(aviso.ids_individuais) ? aviso.ids_individuais.length : 0;
        return qtd > 0 ? `${qtd} pessoa${qtd > 1 ? 's' : ''}` : 'Individuais';
    }
    return DEST_LABEL[String(aviso.destinatarios)] || String(aviso.destinatarios || '—');
}

function statusCard(aviso: AvisoPopup): AvisoPopupStatusCard {
    if (aviso.is_template)  return 'template';
    if (!aviso.ativo)       return 'inativo';
    const hoje = new Date().toISOString().split('T')[0] ?? '';
    if (aviso.data_inicio && String(aviso.data_inicio) > hoje) return 'agendado';
    if (aviso.urgente) return 'urgente';
    return 'ativo';
}

function BordaCharme({ status }: { status: AvisoPopupStatusCard }) {
    return <div className={`card-borda-charme avp-borda--${status}`} />;
}

interface AvisoCardProps {
    aviso: AvisoPopup;
    onEditar: (aviso: AvisoPopup) => void;
    onToggleAtivo: (aviso: AvisoPopup) => void;
    onDeletar: (aviso: AvisoPopup) => void;
    onVerVisualizacoes: (aviso: AvisoPopup) => void;
    onReenviar: (aviso: AvisoPopup) => void;
    onUsarModelo: (aviso: AvisoPopup) => void;
    onArquivar: (aviso: AvisoPopup) => void;
}

function AvisoCard({
    aviso,
    onEditar,
    onToggleAtivo,
    onDeletar,
    onVerVisualizacoes,
    onReenviar,
    onUsarModelo,
    onArquivar,
}: AvisoCardProps) {
    const status = statusCard(aviso);
    const viram  = parseInt(String(aviso.total_visualizacoes || 0), 10);
    const total  = parseInt(String(aviso.total_destinatarios || 0), 10);

    const iconeThumb: Record<string, string> = { texto: '✏️', imagem: '🖼️', misto: '📄' };
    const icone = iconeThumb[String(aviso.tipo)] || '📢';
    const ehTemplate = !!aviso.is_template;
    const ehAtivo    = !!aviso.ativo && !ehTemplate;
    const ehArquivado = !aviso.ativo && !ehTemplate;

    return (
        <div className={`avp-card avp-card--${status}`}>
            <BordaCharme status={status} />

            {/* Thumbnail */}
            <div className="avp-thumb">
                {aviso.url_imagem
                    ? <img src={aviso.url_imagem} alt="" />
                    : <span>{icone}</span>
                }
            </div>

            {/* Info principal */}
            <div className="avp-info">
                <div className="avp-titulo">{aviso.titulo}</div>
                <div className="avp-meta">
                    <span className="avp-badge avp-badge--tipo">{TIPO_LABEL[String(aviso.tipo)]}</span>
                    {aviso.urgente && <span className="avp-badge avp-badge--urgente">Urgente</span>}
                    {!ehTemplate && (
                        <span className={`avp-badge avp-badge--status avp-badge--${status}`}>
                            {status === 'ativo'     && 'Ativo'}
                            {status === 'urgente'   && 'Ativo'}
                            {status === 'agendado'  && 'Agendado'}
                            {status === 'inativo'   && 'Arquivado'}
                        </span>
                    )}
                    {ehTemplate && <span className="avp-badge avp-badge--template">Modelo</span>}
                    <span className="avp-dest" title={rotuloDestinatarios(aviso)}>
                        <i className="fas fa-users"></i> {rotuloDestinatarios(aviso)}
                    </span>
                    {aviso.data_inicio && !ehTemplate && (
                        <span className="avp-dest">
                            <i className="fas fa-calendar-day"></i>{' '}
                            {new Date(String(aviso.data_inicio).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                            {aviso.data_fim && ` → ${new Date(String(aviso.data_fim).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`}
                        </span>
                    )}
                </div>
            </div>

            {/* Stats — só para avisos reais (não templates) */}
            {!ehTemplate ? (
                <button
                    className="avp-stats avp-stats--clicavel"
                    title="Ver quem visualizou"
                    onClick={() => onVerVisualizacoes(aviso)}
                >
                    <div className="avp-stats-num">
                        {viram}<span className="avp-stats-total">/{total}</span>
                    </div>
                    <div className="avp-stats-label">
                        viram <i className="fas fa-chevron-right avp-stats-seta"></i>
                    </div>
                </button>
            ) : (
                <div className="avp-stats avp-stats--template-placeholder">
                    <i className="fas fa-bookmark"></i>
                </div>
            )}

            {/* Ações */}
            <div className="avp-acoes">
                <button className="avp-icon-btn" title="Editar" onClick={() => onEditar(aviso)}>
                    <i className="fas fa-pen"></i>
                </button>

                {/* Reenviar — para arquivados */}
                {ehArquivado && (
                    <button
                        className="avp-icon-btn avp-icon-btn--reenviar"
                        title="Reenviar (cria cópia nova)"
                        onClick={() => onReenviar(aviso)}
                    >
                        <i className="fas fa-rotate-right"></i>
                    </button>
                )}

                {/* Usar modelo — para templates */}
                {ehTemplate && (
                    <button
                        className="avp-icon-btn avp-icon-btn--usar-modelo"
                        title="Usar como base para novo aviso"
                        onClick={() => onUsarModelo(aviso)}
                    >
                        <i className="fas fa-paper-plane"></i>
                    </button>
                )}

                {/* Arquivar — para ativos */}
                {ehAtivo && (
                    <button
                        className="avp-icon-btn avp-icon-btn--arquivar"
                        title="Arquivar aviso"
                        onClick={() => onArquivar(aviso)}
                    >
                        <i className="fas fa-box-archive"></i>
                    </button>
                )}

                {/* Ativar / Reativar — para arquivados */}
                {ehArquivado && (
                    <button
                        className="avp-icon-btn avp-icon-btn--ativar"
                        title="Reativar aviso"
                        onClick={() => onToggleAtivo(aviso)}
                    >
                        <i className="fas fa-play"></i>
                    </button>
                )}

                {/* Deletar — só para arquivados e templates */}
                {(ehArquivado || ehTemplate) && (
                    <button
                        className="avp-icon-btn avp-icon-btn--deletar"
                        title="Deletar permanentemente"
                        onClick={() => onDeletar(aviso)}
                    >
                        <i className="fas fa-trash"></i>
                    </button>
                )}
            </div>
        </div>
    );
}

export interface AvisosPopupAdminProps {
    modalAberto: boolean;
    onFecharModal: () => void;
}

export default function AvisosPopupAdmin({ modalAberto, onFecharModal }: AvisosPopupAdminProps) {
    const [avisos, setAvisos]         = useState<AvisoPopup[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [modalState, setModalState] = useState<AvisoPopupModalState | null>(null); // { aviso, modo }
    const [avisoViewers, setAvisoViewers] = useState<AvisoPopup | null>(null);
    const [arquivadosExpandido, setArquivadosExpandido] = useState(false);

    const carregar = async () => {
        setCarregando(true);
        try {
            const data = await fetchApi<AvisoPopup[]>('/api/avisos-popup/');
            setAvisos(data);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro ao carregar avisos: ${msg}`, 'erro');
        } finally {
            setCarregando(false);
        }
    };

    useEffect(() => { void carregar(); }, []);

    // Abre modal de criação quando prop externa muda
    useEffect(() => {
        if (modalAberto) setModalState({ aviso: null, modo: 'criar' });
    }, [modalAberto]);

    const handleFecharModal = () => {
        setModalState(null);
        onFecharModal();
    };

    const handleSalvo = () => {
        handleFecharModal();
        void carregar();
    };

    const handleEditar        = (aviso: AvisoPopup) => setModalState({ aviso, modo: 'editar' as AvisoPopupModo });
    const handleReenviar      = (aviso: AvisoPopup) => setModalState({ aviso, modo: 'duplicar' as AvisoPopupModo });
    const handleUsarModelo    = (aviso: AvisoPopup) => setModalState({ aviso, modo: 'usar-template' as AvisoPopupModo });
    const handleVerVis        = (aviso: AvisoPopup) => setAvisoViewers(aviso);

    const handleToggleAtivo = async (aviso: AvisoPopup) => {
        try {
            const res = await fetchApi<{ ativo: boolean }>(`/api/avisos-popup/${aviso.id}/toggle-ativo`, { method: 'PUT' });
            setAvisos(prev => prev.map(a => a.id === aviso.id ? { ...a, ativo: res.ativo } : a));
            mostrarMensagem(res.ativo ? 'Aviso reativado.' : 'Aviso desativado.', 'sucesso');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        }
    };

    const handleArquivar = async (aviso: AvisoPopup) => {
        const confirmado = await mostrarConfirmacao(
            `Arquivar "${aviso.titulo}"? O aviso vai para os arquivados e parará de ser exibido.`,
            { textoConfirmar: 'Arquivar', tipo: 'aviso' }
        );
        if (!confirmado) return;
        try {
            await fetchApi(`/api/avisos-popup/${aviso.id}/toggle-ativo`, { method: 'PUT' });
            setAvisos(prev => prev.map(a => a.id === aviso.id ? { ...a, ativo: false } : a));
            mostrarMensagem('Aviso arquivado.', 'sucesso');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        }
    };

    const handleDeletar = async (aviso: AvisoPopup) => {
        const confirmado = await mostrarConfirmacao(
            `Deletar "${aviso.titulo}"? Esta ação não pode ser desfeita.`,
            { textoConfirmar: 'Deletar', tipo: 'perigo' }
        );
        if (!confirmado) return;
        try {
            await fetchApi(`/api/avisos-popup/${aviso.id}`, { method: 'DELETE' });
            setAvisos(prev => prev.filter(a => a.id !== aviso.id));
            mostrarMensagem('Aviso deletado.', 'sucesso');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro ao deletar: ${msg}`, 'erro');
        }
    };

    // Partições
    const templates  = avisos.filter(a =>  a.is_template);
    const ativos     = avisos.filter(a => !a.is_template &&  a.ativo);
    const arquivados = avisos.filter(a => !a.is_template && !a.ativo);

    const propsCard = {
        onEditar:          handleEditar,
        onToggleAtivo:     (a: AvisoPopup) => { void handleToggleAtivo(a); },
        onDeletar:         (a: AvisoPopup) => { void handleDeletar(a); },
        onVerVisualizacoes: handleVerVis,
        onReenviar:        handleReenviar,
        onUsarModelo:      handleUsarModelo,
        onArquivar:        (a: AvisoPopup) => { void handleArquivar(a); },
    };

    return (
        <div className="avp-container">
            {carregando && <UICarregando variante="bloco" />}

            {!carregando && avisos.length === 0 && (
                <UIFeedbackNotFound
                    icon="fa-bullhorn"
                    titulo="Nenhum aviso criado ainda"
                    mensagem={'Clique em “Novo Aviso” para começar.'}
                />
            )}

            {/* ── Seção: Modelos ── */}
            {!carregando && templates.length > 0 && (
                <section className="avp-secao">
                    <div className="avp-secao-label avp-secao-label--template">
                        <i className="fas fa-bookmark"></i> Modelos
                        <span className="avp-secao-count">{templates.length}</span>
                    </div>
                    {templates.map(a => (
                        <AvisoCard key={a.id} aviso={a} {...propsCard} />
                    ))}
                </section>
            )}

            {/* ── Seção: Ativos ── */}
            {!carregando && (
                <section className="avp-secao">
                    {(ativos.length > 0 || avisos.length === 0) && (
                        <div className="avp-secao-label">
                            <i className="fas fa-broadcast-tower"></i> Ativos agora
                            <span className="avp-secao-count">{ativos.length}</span>
                        </div>
                    )}
                    {ativos.map(a => (
                        <AvisoCard key={a.id} aviso={a} {...propsCard} />
                    ))}
                    {ativos.length === 0 && !carregando && avisos.length > 0 && (
                        <UIFeedbackNotFound
                            variante="compacto"
                            icon="fa-circle-xmark"
                            titulo="Nenhum aviso ativo no momento"
                            mensagem="Os avisos publicados estão arquivados ou aguardando ativação."
                        />
                    )}
                </section>
            )}

            {/* ── Seção: Arquivados (colapsável) ── */}
            {!carregando && arquivados.length > 0 && (
                <section className="avp-secao">
                    <button
                        className="avp-secao-label avp-secao-label--arquivados avp-secao-label--clicavel"
                        onClick={() => setArquivadosExpandido(v => !v)}
                    >
                        <i className="fas fa-box-archive"></i> Arquivados
                        <span className="avp-secao-count">{arquivados.length}</span>
                        <i className={`fas fa-chevron-${arquivadosExpandido ? 'up' : 'down'} avp-secao-chevron`}></i>
                    </button>
                    {arquivadosExpandido && arquivados.map(a => (
                        <AvisoCard key={a.id} aviso={a} {...propsCard} />
                    ))}
                </section>
            )}

            {/* Modal de criar / editar / duplicar / usar-template */}
            {modalState && (
                <AvisosPopupModal
                    aviso={modalState.aviso}
                    modo={modalState.modo}
                    onSalvo={handleSalvo}
                    onFechar={handleFecharModal}
                />
            )}

            {/* Modal de visualizações */}
            {avisoViewers && (
                <AvisosPopupViewersModal
                    aviso={avisoViewers}
                    onFechar={() => setAvisoViewers(null)}
                />
            )}
        </div>
    );
}
