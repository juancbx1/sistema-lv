// public/src/components/AvisosPopupAdmin.jsx
// Aba "Avisos Popups" dentro da Central de Alertas.
//
// Seções:
//   📋 Modelos       — is_template = true (nunca enviados)
//   📢 Ativos        — ativo = true, is_template = false
//   🗂️ Arquivados    — ativo = false, is_template = false

import React, { useState, useEffect } from 'react';
import { mostrarMensagem, mostrarConfirmacao } from '/js/utils/popups.js';
import UICarregando from './UICarregando.jsx';
import AvisosPopupModal from './AvisosPopupModal.jsx';
import AvisosPopupViewersModal from './AvisosPopupViewersModal.jsx';

async function fetchApi(endpoint, options = {}) {
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
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro na requisição');
    }
    return res.json();
}

const TIPO_LABEL  = { texto: 'Texto', imagem: 'Imagem', misto: 'Misto' };
const DEST_LABEL  = { todos: 'Todos', costureiras: 'Costureiras', tiktiks: 'Tiktiks', individuais: 'Individuais' };

/** Rótulo amigável de destinatários (inclui nomes em avisos individuais, ex.: VT). */
function rotuloDestinatarios(aviso) {
    if (aviso.destinatarios === 'individuais') {
        const nomes = Array.isArray(aviso.destinatarios_nomes)
            ? aviso.destinatarios_nomes.filter(Boolean)
            : [];
        if (nomes.length === 1) return nomes[0];
        if (nomes.length === 2) return `${nomes[0]}, ${nomes[1]}`;
        if (nomes.length > 2) return `${nomes[0]} +${nomes.length - 1}`;
        const qtd = Array.isArray(aviso.ids_individuais) ? aviso.ids_individuais.length : 0;
        return qtd > 0 ? `${qtd} pessoa${qtd > 1 ? 's' : ''}` : 'Individuais';
    }
    return DEST_LABEL[aviso.destinatarios] || aviso.destinatarios || '—';
}

function statusCard(aviso) {
    if (aviso.is_template)  return 'template';
    if (!aviso.ativo)       return 'inativo';
    const hoje = new Date().toISOString().split('T')[0];
    if (aviso.data_inicio > hoje) return 'agendado';
    if (aviso.urgente) return 'urgente';
    return 'ativo';
}

function BordaCharme({ status }) {
    return <div className={`card-borda-charme avp-borda--${status}`} />;
}

function AvisoCard({ aviso, onEditar, onToggleAtivo, onDeletar, onVerVisualizacoes, onReenviar, onUsarModelo, onArquivar }) {
    const status = statusCard(aviso);
    const viram  = parseInt(aviso.total_visualizacoes || 0, 10);
    const total  = parseInt(aviso.total_destinatarios || 0, 10);

    const iconeThumb = { texto: '✏️', imagem: '🖼️', misto: '📄' }[aviso.tipo] || '📢';
    const ehTemplate = aviso.is_template;
    const ehAtivo    = aviso.ativo && !ehTemplate;
    const ehArquivado = !aviso.ativo && !ehTemplate;

    return (
        <div className={`avp-card avp-card--${status}`}>
            <BordaCharme status={status} />

            {/* Thumbnail */}
            <div className="avp-thumb">
                {aviso.url_imagem
                    ? <img src={aviso.url_imagem} alt="" />
                    : <span>{iconeThumb}</span>
                }
            </div>

            {/* Info principal */}
            <div className="avp-info">
                <div className="avp-titulo">{aviso.titulo}</div>
                <div className="avp-meta">
                    <span className="avp-badge avp-badge--tipo">{TIPO_LABEL[aviso.tipo]}</span>
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

export default function AvisosPopupAdmin({ modalAberto, onFecharModal }) {
    const [avisos, setAvisos]         = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [modalState, setModalState] = useState(null); // { aviso, modo }
    const [avisoViewers, setAvisoViewers] = useState(null);
    const [arquivadosExpandido, setArquivadosExpandido] = useState(false);

    const carregar = async () => {
        setCarregando(true);
        try {
            const data = await fetchApi('/api/avisos-popup/');
            setAvisos(data);
        } catch (err) {
            mostrarMensagem(`Erro ao carregar avisos: ${err.message}`, 'erro');
        } finally {
            setCarregando(false);
        }
    };

    useEffect(() => { carregar(); }, []);

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
        carregar();
    };

    const handleEditar        = (aviso) => setModalState({ aviso, modo: 'editar' });
    const handleReenviar      = (aviso) => setModalState({ aviso, modo: 'duplicar' });
    const handleUsarModelo    = (aviso) => setModalState({ aviso, modo: 'usar-template' });
    const handleVerVis        = (aviso) => setAvisoViewers(aviso);

    const handleToggleAtivo = async (aviso) => {
        try {
            const res = await fetchApi(`/api/avisos-popup/${aviso.id}/toggle-ativo`, { method: 'PUT' });
            setAvisos(prev => prev.map(a => a.id === aviso.id ? { ...a, ativo: res.ativo } : a));
            mostrarMensagem(res.ativo ? 'Aviso reativado.' : 'Aviso desativado.', 'sucesso');
        } catch (err) {
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        }
    };

    const handleArquivar = async (aviso) => {
        const confirmado = await mostrarConfirmacao(
            `Arquivar "${aviso.titulo}"? O aviso vai para os arquivados e parará de ser exibido.`,
            { textoConfirmar: 'Arquivar', tipo: 'aviso' }
        );
        if (!confirmado) return;
        try {
            await fetchApi(`/api/avisos-popup/${aviso.id}/toggle-ativo`, { method: 'PUT' });
            setAvisos(prev => prev.map(a => a.id === aviso.id ? { ...a, ativo: false } : a));
            mostrarMensagem('Aviso arquivado.', 'sucesso');
        } catch (err) {
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        }
    };

    const handleDeletar = async (aviso) => {
        const confirmado = await mostrarConfirmacao(
            `Deletar "${aviso.titulo}"? Esta ação não pode ser desfeita.`,
            { textoConfirmar: 'Deletar', tipo: 'perigo' }
        );
        if (!confirmado) return;
        try {
            await fetchApi(`/api/avisos-popup/${aviso.id}`, { method: 'DELETE' });
            setAvisos(prev => prev.filter(a => a.id !== aviso.id));
            mostrarMensagem('Aviso deletado.', 'sucesso');
        } catch (err) {
            mostrarMensagem(`Erro ao deletar: ${err.message}`, 'erro');
        }
    };

    // Partições
    const templates  = avisos.filter(a =>  a.is_template);
    const ativos     = avisos.filter(a => !a.is_template &&  a.ativo);
    const arquivados = avisos.filter(a => !a.is_template && !a.ativo);

    const propsCard = {
        onEditar:          handleEditar,
        onToggleAtivo:     handleToggleAtivo,
        onDeletar:         handleDeletar,
        onVerVisualizacoes: handleVerVis,
        onReenviar:        handleReenviar,
        onUsarModelo:      handleUsarModelo,
        onArquivar:        handleArquivar,
    };

    return (
        <div className="avp-container">
            {carregando && <UICarregando variante="bloco" />}

            {!carregando && avisos.length === 0 && (
                <div className="avp-vazio">
                    <i className="fas fa-bullhorn"></i>
                    <p>Nenhum aviso criado ainda.</p>
                    <p className="avp-vazio-sub">Clique em "Novo Aviso" para começar.</p>
                </div>
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
                        <div className="avp-secao-vazio">
                            <i className="fas fa-circle-xmark"></i> Nenhum aviso ativo no momento.
                        </div>
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
