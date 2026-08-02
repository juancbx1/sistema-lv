// public/src/components/AvisosPopupModal.jsx
// Modal de criação e edição de Avisos Popup.
//
// Props:
//   aviso     — objeto com os dados pré-preenchidos (null = criar do zero)
//   modo      — 'criar' | 'editar' | 'duplicar' | 'usar-template'
//               duplicar/usar-template: pre-fill mas salva como novo registro
//   onSalvo   — callback após salvar com sucesso
//   onFechar  — callback para fechar o modal

import React, { useState, useEffect, useRef, useMemo } from 'react';
import imageCompression from 'browser-image-compression';
import { mostrarMensagem } from '/js/utils/popups.js';

const CORES = [
    { id: 'azul',     label: 'Azul',     grad: 'linear-gradient(135deg, #4361ee, #8e44ad)' },
    { id: 'ambar',    label: 'Âmbar',    grad: 'linear-gradient(135deg, #f59e0b, #d97706)' },
    { id: 'verde',    label: 'Verde',    grad: 'linear-gradient(135deg, #10b981, #059669)' },
    { id: 'vermelho', label: 'Vermelho', grad: 'linear-gradient(135deg, #ef4444, #dc2626)' },
];

async function fetchApi(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    const isFormData = options.body instanceof FormData;
    const res = await fetch(endpoint, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
        },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro na requisição');
    }
    return res.json();
}

const TIPOS = ['texto', 'imagem', 'misto'];
const TIPO_LABEL = { texto: '✏️ Só Texto', imagem: '🖼️ Só Imagem', misto: '📄 Imagem + Texto' };

const DESTS = [
    { id: 'todos',       label: '👥 Todos os usuários' },
    { id: 'costureiras', label: '🧵 Costureiras' },
    { id: 'tiktiks',     label: '⚡ Tiktiks' },
    { id: 'individuais', label: '👤 Pessoas específicas' },
];

function normalizarIdsIndividuais(valor) {
    if (valor == null) return [];
    if (Array.isArray(valor)) {
        return valor.map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0);
    }
    if (typeof valor === 'string') {
        const limpo = valor.trim();
        if (!limpo) return [];
        try {
            const parsed = JSON.parse(limpo);
            if (Array.isArray(parsed)) return normalizarIdsIndividuais(parsed);
        } catch {
            // formato PG {1,2}
        }
        return limpo
            .replace(/^{|}$/g, '')
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((id) => Number.isSafeInteger(id) && id > 0);
    }
    const n = Number(valor);
    return Number.isSafeInteger(n) && n > 0 ? [n] : [];
}

const TIPO_EVENTO_LABEL = {
    feriado_nacional: '🇧🇷 Feriado Nacional',
    feriado_regional: '📍 Feriado Regional',
    folga_empresa:    '🏖️ Folga da Empresa',
    evento:           '📅 Evento',
    manutencao:       '🔧 Manutenção',
};

function hoje() {
    return new Date().toISOString().split('T')[0];
}

// Normaliza qualquer formato de data para yyyy-MM-dd (aceito pelo <input type="date">)
// Suporta: "2026-05-19", "2026-05-19T00:00:00.000Z", Date object, null/undefined
function toDateInput(val) {
    if (!val) return '';
    return String(val).slice(0, 10);
}

function formatarDataBr(isoDate) {
    if (!isoDate) return '';
    const norm = String(isoDate).slice(0, 10); // normaliza "2026-08-15T00:00:00.000Z" → "2026-08-15"
    const [y, m, d] = norm.split('-');
    return `${d}/${m}`;
}

// ── Gradientes e cores dos botões — replicado do DashAvisoPopup ──────────────
const COR_GRAD = {
    azul:     'linear-gradient(135deg, #4361ee, #8e44ad)',
    ambar:    'linear-gradient(135deg, #f59e0b, #d97706)',
    verde:    'linear-gradient(135deg, #10b981, #059669)',
    vermelho: 'linear-gradient(135deg, #ef4444, #dc2626)',
};
const COR_BTN = {
    azul: '#4361ee', ambar: '#d97706', verde: '#059669', vermelho: '#dc2626',
};

// ── Renderiza o card do popup exatamente como a funcionária verá ──────────────
function PreviewCard({ tipo, titulo, mensagem, urlImagem, corFundo, urgente }) {
    const cor    = corFundo || 'azul';
    const grad   = COR_GRAD[cor]  || COR_GRAD.azul;
    const btnCor = COR_BTN[cor]   || COR_BTN.azul;

    // Tipo "imagem" sem urgência: sem corpus abaixo (o X fecha e registra)
    const semCorpo = tipo === 'imagem' && !urgente;
    const imgWrapClass = [
        'dap-imagem-wrap',
        semCorpo         && 'dap-imagem-wrap--full',
        tipo === 'misto' && 'dap-imagem-wrap--misto',
    ].filter(Boolean).join(' ');

    return (
        <div className={`dap-card${semCorpo ? ' dap-card--imagem-full' : ''}${tipo === 'misto' ? ' dap-card--misto' : ''}`} style={{ animation: 'none' }}>
            {/* Barra de identidade no topo */}
            <div
                className="dap-barra-topo"
                style={{ background: urgente ? 'linear-gradient(90deg,#ef4444,#dc2626)' : grad }}
            />

            {/* Área de imagem (tipos: imagem e misto) */}
            {(tipo === 'imagem' || tipo === 'misto') && (
                <div className={imgWrapClass}>
                    {urlImagem
                        ? <img src={urlImagem} alt={titulo} className="dap-imagem" />
                        : (
                            <div className="avpm-preview-img-placeholder">
                                <i className="fas fa-image"></i>
                                <span>Imagem aparecerá aqui</span>
                            </div>
                        )
                    }
                    {urgente && <span className="dap-badge-urgente">URGENTE</span>}
                    <button className="dap-btn-fechar dap-btn-fechar--bloqueado" disabled tabIndex={-1}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            )}

            {/* Área colorida (tipo: texto) */}
            {tipo === 'texto' && (
                <div className="dap-area-colorida" style={{ background: grad }}>
                    {urgente && <span className="dap-badge-urgente dap-badge-urgente--texto">URGENTE</span>}
                    <button className="dap-btn-fechar dap-btn-fechar--claro dap-btn-fechar--bloqueado" disabled tabIndex={-1}>
                        <i className="fas fa-times"></i>
                    </button>
                    <div className="dap-area-colorida-titulo">
                        {titulo || <em style={{ opacity: 0.55 }}>Título aparecerá aqui</em>}
                    </div>
                </div>
            )}

            {/* Corpo — oculto para tipo "imagem" não urgente (X fecha e registra) */}
            {!semCorpo && (
            <div className="dap-corpo">
                {(tipo === 'imagem' || tipo === 'misto') && (
                    <div className="dap-titulo">
                        {titulo || <em style={{ opacity: 0.55, fontStyle: 'normal', color: '#aaa' }}>Título aparecerá aqui</em>}
                    </div>
                )}
                {mensagem && <div className="dap-mensagem">{mensagem}</div>}
                {urgente && (
                    <label className="dap-checkbox-ciente" style={{ pointerEvents: 'none' }}>
                        <input type="checkbox" disabled readOnly />
                        <span>Li e estou ciente</span>
                    </label>
                )}
                {!urgente && (
                    <button className="dap-btn-entendido" style={{ background: btnCor }} disabled tabIndex={-1}>
                        Entendido!
                    </button>
                )}
                {urgente && (
                    <button
                        className="dap-btn-entendido dap-btn-entendido--urgente dap-btn-entendido--inativo"
                        disabled tabIndex={-1}
                    >
                        <i className="fas fa-check-circle"></i> Ciente, pode fechar
                    </button>
                )}
            </div>
            )}
        </div>
    );
}

// ── Mockup de celular com o card dentro ───────────────────────────────────────
function PreviewPhone({ tipo, titulo, mensagem, urlImagem, corFundo, urgente }) {
    return (
        <div className="avpm-phone-wrap">
            <p className="avpm-phone-legenda">
                <i className="fas fa-mobile-alt"></i> Visualização aproximada na tela da funcionária
            </p>
            <div className="avpm-phone-frame">
                {/* Botões laterais decorativos */}
                <div className="avpm-phone-side-btn" style={{ top: '80px',  height: '26px' }} />
                <div className="avpm-phone-side-btn" style={{ top: '116px', height: '42px' }} />
                <div className="avpm-phone-side-btn" style={{ top: '166px', height: '42px' }} />
                <div className="avpm-phone-power" />
                {/* Notch com câmera e speaker */}
                <div className="avpm-phone-notch">
                    <div className="avpm-phone-speaker" />
                    <div className="avpm-phone-camera" />
                </div>
                {/* Tela */}
                <div className="avpm-phone-screen">
                    <div className="avpm-phone-status-bar">
                        <span>9:41</span>
                        <span style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                            <i className="fas fa-wifi"          style={{ fontSize: '9px' }}></i>
                            <i className="fas fa-battery-half"  style={{ fontSize: '9px' }}></i>
                        </span>
                    </div>
                    {/* Fundo cinza simulando a dashboard */}
                    <div className="avpm-phone-dash-bg">
                        <PreviewCard
                            tipo={tipo}
                            titulo={titulo}
                            mensagem={mensagem}
                            urlImagem={urlImagem}
                            corFundo={corFundo}
                            urgente={urgente}
                        />
                    </div>
                </div>
                {/* Home bar */}
                <div className="avpm-phone-home" />
            </div>
        </div>
    );
}

export default function AvisosPopupModal({ aviso, modo = 'criar', onSalvo, onFechar }) {
    // 'criar' | 'editar' | 'duplicar' | 'usar-template'
    const ehEdicao   = modo === 'editar';
    const ehNovo     = !ehEdicao; // criar, duplicar ou usar-template

    // Data inicial: em modo duplicar/usar-template, sempre hoje
    const dataInicialDefault = (modo === 'duplicar' || modo === 'usar-template')
        ? hoje()
        : toDateInput(aviso?.data_inicio) || hoje();

    // Campos do formulário
    const [tipo, setTipo]             = useState(aviso?.tipo        || 'texto');
    const [titulo, setTitulo]         = useState(aviso?.titulo      || '');
    const [mensagem, setMensagem]     = useState(aviso?.mensagem    || '');
    const [urlImagem, setUrlImagem]   = useState(aviso?.url_imagem  || '');
    const [corFundo, setCorFundo]     = useState(aviso?.cor_fundo   || 'azul');
    const destInicial = ['todos', 'costureiras', 'tiktiks', 'individuais'].includes(aviso?.destinatarios)
        ? aviso.destinatarios
        : 'todos';
    const [destinatarios, setDestinatarios] = useState(destInicial);
    const [idsIndividuais, setIdsIndividuais] = useState(() =>
        normalizarIdsIndividuais(aviso?.ids_individuais)
    );
    const [pessoas, setPessoas] = useState([]); // { id, nome }
    const [buscaPessoa, setBuscaPessoa] = useState('');
    const [carregandoPessoas, setCarregandoPessoas] = useState(false);
    const [urgente, setUrgente]       = useState(aviso?.urgente     || false);
    const [isTemplate, setIsTemplate] = useState(
        modo === 'usar-template' ? false : (aviso?.is_template || false)
    );
    const [dataInicio, setDataInicio] = useState(
        // Modelos não têm data pré-definida
        (aviso?.is_template && modo !== 'usar-template') ? '' : dataInicialDefault
    );
    const [dataFim, setDataFim]       = useState(
        (modo === 'duplicar' || modo === 'usar-template') ? '' : toDateInput(aviso?.data_fim)
    );

    // Upload de imagem
    const [arquivoSelecionado, setArquivoSelecionado] = useState(null);
    const [previewImagem, setPreviewImagem]           = useState(aviso?.url_imagem || '');
    const [infoCompressao, setInfoCompressao]         = useState(null);
    const [comprimindo, setComprimindo]               = useState(false);
    const inputFileRef = useRef(null);

    // Sugestões do calendário
    const [eventosCalendario, setEventosCalendario] = useState([]);
    const [mostrarCalendario, setMostrarCalendario] = useState(false);
    const [carregandoCal, setCarregandoCal]         = useState(false);

    const [salvando, setSalvando] = useState(false);
    const [abaAtiva, setAbaAtiva] = useState('editar'); // 'editar' | 'preview'

    const temImagem = tipo === 'imagem' || tipo === 'misto';
    const temTexto  = tipo === 'texto'  || tipo === 'misto';

    // Ao trocar tipo, limpar campos irrelevantes
    useEffect(() => {
        if (!temImagem) {
            setArquivoSelecionado(null);
            setPreviewImagem(aviso?.url_imagem || '');
            setInfoCompressao(null);
        }
    }, [tipo]);

    // Carrega pessoas da empresa para destinatários individuais (ex.: avisos de recarga VT)
    useEffect(() => {
        if (destinatarios !== 'individuais') return;
        if (pessoas.length > 0) return;
        let ativo = true;
        const carregar = async () => {
            setCarregandoPessoas(true);
            try {
                const data = await fetchApi('/api/usuarios');
                if (!ativo) return;
                const lista = (Array.isArray(data) ? data : [])
                    .filter((u) => u && u.id != null && u.nome)
                    .map((u) => ({ id: Number(u.id), nome: u.nome }))
                    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
                setPessoas(lista);
            } catch {
                // Se falhar, ainda mostramos IDs conhecidos
            } finally {
                if (ativo) setCarregandoPessoas(false);
            }
        };
        void carregar();
        return () => {
            ativo = false;
        };
    }, [destinatarios, pessoas.length]);

    const pessoasSelecionadas = useMemo(() => {
        const mapa = new Map(pessoas.map((p) => [p.id, p.nome]));
        // Inclui nomes vindos do aviso (API enriquecida) se a lista ainda não carregou
        const nomesAviso = Array.isArray(aviso?.destinatarios_nomes)
            ? aviso.destinatarios_nomes
            : [];
        return idsIndividuais.map((id, idx) => ({
            id,
            nome: mapa.get(id) || nomesAviso[idx] || `Usuário #${id}`,
        }));
    }, [idsIndividuais, pessoas, aviso?.destinatarios_nomes]);

    const pessoasFiltradas = useMemo(() => {
        const termo = buscaPessoa.trim().toLowerCase();
        const base = termo
            ? pessoas.filter((p) => p.nome.toLowerCase().includes(termo))
            : pessoas;
        return base.slice(0, 40);
    }, [pessoas, buscaPessoa]);

    const alternarPessoa = (id) => {
        const n = Number(id);
        setIdsIndividuais((atual) =>
            atual.includes(n) ? atual.filter((x) => x !== n) : [...atual, n]
        );
    };

    // Carrega eventos do calendário quando expandido
    const handleAbrirCalendario = async () => {
        setMostrarCalendario(v => !v);
        if (eventosCalendario.length > 0) return; // já carregou
        setCarregandoCal(true);
        try {
            const token = localStorage.getItem('token');
            const inicio = hoje();
            // Próximos 90 dias
            const fimDate = new Date();
            fimDate.setDate(fimDate.getDate() + 90);
            const fim = fimDate.toISOString().split('T')[0];
            const res = await fetch(`/api/calendario?inicio=${inicio}&fim=${fim}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            // Filtra só eventos relevantes para avisos (feriados, folgas, eventos gerais)
            const relevantes = (data || []).filter(e =>
                ['feriado_nacional', 'feriado_regional', 'folga_empresa', 'evento', 'manutencao'].includes(e.tipo)
                && !e.funcionario_id // eventos gerais, não individuais
            );
            setEventosCalendario(relevantes);
        } catch {
            // Silencioso — calendário é opcional
        } finally {
            setCarregandoCal(false);
        }
    };

    const handleArquivo = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setComprimindo(true);
        setInfoCompressao(null);
        try {
            const tamanhoOriginalKB = Math.round(file.size / 1024);
            const comprimido = await imageCompression(file, {
                maxSizeMB: 0.8,
                maxWidthOrHeight: 1200,
                useWebWorker: true,
            });
            const tamanhoComprimidoKB = Math.round(comprimido.size / 1024);
            setInfoCompressao({ original: tamanhoOriginalKB, comprimido: tamanhoComprimidoKB });
            setArquivoSelecionado(comprimido);
            const reader = new FileReader();
            reader.onload = (ev) => setPreviewImagem(ev.target.result);
            reader.readAsDataURL(comprimido);
        } catch {
            mostrarMensagem('Erro ao processar imagem. Tente novamente.', 'erro');
        } finally {
            setComprimindo(false);
        }
    };

    const handleSalvar = async () => {
        if (!titulo.trim()) {
            mostrarMensagem('O título é obrigatório.', 'aviso');
            return;
        }
        if (temImagem && !arquivoSelecionado && !urlImagem) {
            mostrarMensagem('Selecione uma imagem para este tipo de aviso.', 'aviso');
            return;
        }
        if (destinatarios === 'individuais' && idsIndividuais.length === 0) {
            mostrarMensagem('Selecione ao menos uma pessoa como destinatário.', 'aviso');
            return;
        }

        setSalvando(true);
        try {
            let urlFinal = urlImagem;
            if (arquivoSelecionado) {
                const formData = new FormData();
                formData.append('imagem', arquivoSelecionado, arquivoSelecionado.name || 'imagem.jpg');
                const uploadRes = await fetchApi('/api/avisos-popup/upload-imagem', {
                    method: 'POST',
                    body: formData,
                });
                urlFinal = uploadRes.url;
            }

            const payload = {
                titulo:          titulo.trim(),
                tipo,
                mensagem:        temTexto ? (mensagem.trim() || null) : null,
                url_imagem:      temImagem ? urlFinal : null,
                cor_fundo:       tipo === 'texto' ? corFundo : 'azul',
                destinatarios,
                ids_individuais: destinatarios === 'individuais' ? idsIndividuais : [],
                urgente,
                is_template:     isTemplate,
                ativo:           !isTemplate,
                // Templates não têm data relevante — usa hoje como placeholder (campo NOT NULL no DB)
                data_inicio:     isTemplate ? hoje() : (dataInicio || hoje()),
                data_fim:        isTemplate ? null : (dataFim || null),
            };

            if (ehEdicao && aviso?.id) {
                await fetchApi(`/api/avisos-popup/${aviso.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload),
                });
                mostrarMensagem('Aviso atualizado com sucesso!', 'sucesso');
            } else {
                await fetchApi('/api/avisos-popup/', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                });
                const msgMap = {
                    criar:          isTemplate ? 'Modelo salvo!' : 'Aviso publicado com sucesso!',
                    duplicar:       'Aviso reenviado com sucesso!',
                    'usar-template': 'Aviso publicado com sucesso!',
                };
                mostrarMensagem(msgMap[modo] || 'Salvo com sucesso!', 'sucesso');
            }

            onSalvo();
        } catch (err) {
            mostrarMensagem(`Erro ao salvar: ${err.message}`, 'erro');
        } finally {
            setSalvando(false);
        }
    };

    // Textos contextuais por modo
    const HEADER_TEXTO = {
        criar:           isTemplate ? '📋 Novo Modelo de Aviso' : '📢 Novo Aviso Popup',
        editar:          '✏️ Editar Aviso',
        duplicar:        '🔁 Reenviar Aviso',
        'usar-template': '📋 Usar Modelo',
    }[modo] || 'Aviso Popup';

    const BTN_SALVAR_TEXTO = {
        criar:           isTemplate ? 'Salvar Modelo' : 'Publicar Aviso',
        editar:          'Salvar Alterações',
        duplicar:        'Reenviar',
        'usar-template': 'Publicar Aviso',
    }[modo] || 'Salvar';

    return (
        <div className="avpm-overlay" onClick={(e) => e.target === e.currentTarget && onFechar()}>
            <div className="avpm-modal">

                {/* Header */}
                <div className="avpm-header">
                    <span className="avpm-titulo">{HEADER_TEXTO}</span>
                    <button className="avpm-fechar" onClick={onFechar}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* Banner modo duplicar/usar-template */}
                {(modo === 'duplicar' || modo === 'usar-template') && (
                    <div className="avpm-banner-modo">
                        <i className={`fas ${modo === 'duplicar' ? 'fa-copy' : 'fa-bookmark'}`}></i>
                        {modo === 'duplicar'
                            ? 'Revisando cópia do aviso original. Ajuste o que precisar antes de reenviar.'
                            : 'Usando modelo como base. Ajuste o que precisar antes de publicar.'}
                    </div>
                )}

                {/* Abas Editar / Preview */}
                <div className="avpm-abas">
                    <button
                        type="button"
                        className={`avpm-aba-btn ${abaAtiva === 'editar' ? 'ativo' : ''}`}
                        onClick={() => setAbaAtiva('editar')}
                    >
                        <i className="fas fa-pen"></i> Editar
                    </button>
                    <button
                        type="button"
                        className={`avpm-aba-btn ${abaAtiva === 'preview' ? 'ativo' : ''}`}
                        onClick={() => setAbaAtiva('preview')}
                    >
                        <i className="fas fa-mobile-alt"></i> Preview
                    </button>
                </div>

                {/* Corpo — formulário */}
                {abaAtiva === 'editar' && <div className="avpm-body">

                    {/* Tipo */}
                    <div className="avpm-grupo">
                        <label className="avpm-label">Tipo do Aviso</label>
                        <div className="avpm-tipo-toggle">
                            {TIPOS.map(t => (
                                <button
                                    key={t}
                                    className={`avpm-tipo-btn ${tipo === t ? 'ativo' : ''}`}
                                    onClick={() => setTipo(t)}
                                    type="button"
                                >
                                    {TIPO_LABEL[t]}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Upload de imagem */}
                    {temImagem && (
                        <div className="avpm-grupo">
                            <label className="avpm-label">Imagem do Aviso</label>
                            <input
                                ref={inputFileRef}
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                style={{ display: 'none' }}
                                onChange={handleArquivo}
                            />
                            {previewImagem ? (
                                <div className="avpm-preview-wrap">
                                    <img src={previewImagem} className="avpm-preview-img" alt="Preview" />
                                    <button
                                        className="avpm-preview-trocar"
                                        onClick={() => inputFileRef.current?.click()}
                                        type="button"
                                        disabled={comprimindo}
                                    >
                                        {comprimindo ? 'Processando...' : '↺ Trocar imagem'}
                                    </button>
                                    {infoCompressao && (
                                        <div className="avpm-compress-info">
                                            <i className="fas fa-bolt"></i>
                                            {infoCompressao.original}KB → {infoCompressao.comprimido}KB
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div
                                    className={`avpm-upload-zone ${comprimindo ? 'avpm-upload-zone--loading' : ''}`}
                                    onClick={() => !comprimindo && inputFileRef.current?.click()}
                                >
                                    {comprimindo ? (
                                        <>
                                            <div className="avpm-upload-spinner"></div>
                                            <span className="avpm-upload-text">Comprimindo imagem...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="avpm-upload-icon">📸</span>
                                            <span className="avpm-upload-text">Clique ou arraste a imagem aqui</span>
                                            <span className="avpm-upload-sub">JPG, PNG, WebP — máx. 10MB original</span>
                                            <span className="avpm-compress-badge">
                                                <i className="fas fa-bolt"></i> Compressão automática até 800KB
                                            </span>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Título */}
                    <div className="avpm-grupo">
                        <label className="avpm-label">Título *</label>
                        <input
                            type="text"
                            className="avpm-input"
                            placeholder="Ex: Gincana de Maio — Semana 2"
                            value={titulo}
                            onChange={e => setTitulo(e.target.value)}
                            maxLength={150}
                        />
                    </div>

                    {/* Mensagem */}
                    {temTexto && (
                        <div className="avpm-grupo">
                            <label className="avpm-label">Mensagem</label>
                            <textarea
                                className="avpm-input avpm-textarea"
                                placeholder="Texto do aviso..."
                                value={mensagem}
                                onChange={e => setMensagem(e.target.value)}
                                rows={3}
                            />
                        </div>
                    )}

                    {/* Cor de fundo (só tipo texto) */}
                    {tipo === 'texto' && (
                        <div className="avpm-grupo">
                            <label className="avpm-label">Cor de Fundo</label>
                            <div className="avpm-cores">
                                {CORES.map(c => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        className={`avpm-cor-swatch ${corFundo === c.id ? 'ativo' : ''}`}
                                        style={{ background: c.grad }}
                                        title={c.label}
                                        onClick={() => setCorFundo(c.id)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Destinatários */}
                    <div className="avpm-grupo">
                        <label className="avpm-label">Destinatários</label>
                        <select
                            className="avpm-input avpm-select"
                            value={destinatarios}
                            onChange={e => {
                                const v = e.target.value;
                                setDestinatarios(v);
                                if (v !== 'individuais') setIdsIndividuais([]);
                            }}
                        >
                            {DESTS.map(d => (
                                <option key={d.id} value={d.id}>{d.label}</option>
                            ))}
                        </select>

                        {destinatarios === 'individuais' && (
                            <div className="avpm-individuais">
                                {pessoasSelecionadas.length > 0 ? (
                                    <div className="avpm-individuais-chips">
                                        {pessoasSelecionadas.map((p) => (
                                            <span key={p.id} className="avpm-individuo-chip">
                                                <i className="fas fa-user" aria-hidden="true" />
                                                {p.nome}
                                                <button
                                                    type="button"
                                                    className="avpm-individuo-chip-x"
                                                    onClick={() => alternarPessoa(p.id)}
                                                    aria-label={`Remover ${p.nome}`}
                                                >
                                                    ×
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="avpm-individuais-vazio">
                                        Nenhuma pessoa selecionada. Avisos do Financeiro (ex.: recarga VT)
                                        costumam ter uma pessoa específica.
                                    </p>
                                )}

                                <input
                                    className="avpm-input"
                                    style={{ marginTop: 8 }}
                                    placeholder="Buscar pessoa para adicionar..."
                                    value={buscaPessoa}
                                    onChange={(e) => setBuscaPessoa(e.target.value)}
                                />

                                {carregandoPessoas ? (
                                    <p className="avpm-individuais-vazio">
                                        <i className="fas fa-spinner fa-spin" /> Carregando pessoas…
                                    </p>
                                ) : (
                                    <div className="avpm-individuais-lista">
                                        {pessoasFiltradas.map((p) => {
                                            const marcado = idsIndividuais.includes(p.id);
                                            return (
                                                <label key={p.id} className={`avpm-individuo-item${marcado ? ' ativo' : ''}`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={marcado}
                                                        onChange={() => alternarPessoa(p.id)}
                                                    />
                                                    <span>{p.nome}</span>
                                                </label>
                                            );
                                        })}
                                        {pessoas.length > 0 && pessoasFiltradas.length === 0 && (
                                            <p className="avpm-individuais-vazio">Nenhum resultado para a busca.</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Datas + sugestões do calendário — oculto para modelos */}
                    {!isTemplate && <div className="avpm-grupo">
                        <div className="avpm-datas-header">
                            <label className="avpm-label" style={{ margin: 0 }}>Agendamento</label>
                            <button
                                type="button"
                                className={`avpm-cal-toggle ${mostrarCalendario ? 'ativo' : ''}`}
                                onClick={handleAbrirCalendario}
                                title="Sugerir datas do calendário da empresa"
                            >
                                <i className="fas fa-calendar-alt"></i>
                                {mostrarCalendario ? 'Ocultar calendário' : 'Buscar do calendário'}
                            </button>
                        </div>

                        {/* Chips do calendário */}
                        {mostrarCalendario && (
                            <div className="avpm-cal-chips">
                                {carregandoCal && (
                                    <span className="avpm-cal-loading">
                                        <i className="fas fa-spinner fa-spin"></i> Carregando...
                                    </span>
                                )}
                                {!carregandoCal && eventosCalendario.length === 0 && (
                                    <span className="avpm-cal-vazio">Nenhum evento nos próximos 90 dias.</span>
                                )}
                                {!carregandoCal && eventosCalendario.map(ev => (
                                    <button
                                        key={ev.id}
                                        type="button"
                                        className={`avpm-cal-chip ${dataInicio === toDateInput(ev.data) ? 'ativo' : ''}`}
                                        onClick={() => setDataInicio(toDateInput(ev.data))}
                                        title={`Definir data de início para ${toDateInput(ev.data)}`}
                                    >
                                        <span className="avpm-cal-chip-data">{formatarDataBr(ev.data)}</span>
                                        <span className="avpm-cal-chip-tipo">
                                            {TIPO_EVENTO_LABEL[ev.tipo] || ev.tipo}
                                        </span>
                                        <span className="avpm-cal-chip-desc">{ev.descricao}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="avpm-linha" style={{ marginTop: '8px' }}>
                            <div className="avpm-grupo avpm-grupo--flex">
                                <label className="avpm-label">Exibir a partir de</label>
                                <input
                                    type="date"
                                    className="avpm-input"
                                    value={dataInicio}
                                    onChange={e => setDataInicio(e.target.value)}
                                />
                            </div>
                            <div className="avpm-grupo avpm-grupo--flex">
                                <label className="avpm-label">Expirar em (opcional)</label>
                                <input
                                    type="date"
                                    className="avpm-input"
                                    value={dataFim}
                                    onChange={e => setDataFim(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>}

                    {/* Toggle urgente */}
                    <div
                        className={`avpm-urgente-toggle ${urgente ? 'ativo' : ''}`}
                        onClick={() => setUrgente(v => !v)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => e.key === 'Enter' && setUrgente(v => !v)}
                    >
                        <div className="avpm-urgente-texto">
                            <span className="avpm-urgente-label">⚠️ Aviso Urgente</span>
                            <span className="avpm-urgente-sub">
                                Requer checkbox "Li e estou ciente" antes de fechar
                            </span>
                        </div>
                        <div className={`avpm-switch ${urgente ? 'ligado' : ''}`}>
                            <div className="avpm-switch-knob" />
                        </div>
                    </div>

                    {/* Toggle salvar como modelo (só no modo criar) */}
                    {modo === 'criar' && (
                        <div
                            className={`avpm-template-toggle ${isTemplate ? 'ativo' : ''}`}
                            onClick={() => setIsTemplate(v => {
                                const next = !v;
                                if (next) { setDataInicio(''); setDataFim(''); }
                                else { setDataInicio(hoje()); }
                                return next;
                            })}
                            role="button"
                            tabIndex={0}
                            onKeyDown={e => e.key === 'Enter' && setIsTemplate(v => !v)}
                        >
                            <div className="avpm-urgente-texto">
                                <span className="avpm-urgente-label">📋 Salvar como Modelo</span>
                                <span className="avpm-urgente-sub">
                                    Modelo fica guardado na galeria — não é enviado às funcionárias
                                </span>
                            </div>
                            <div className={`avpm-switch ${isTemplate ? 'ligado' : ''}`}>
                                <div className="avpm-switch-knob" />
                            </div>
                        </div>
                    )}

                </div>}

                {/* Aba Preview — mockup de celular */}
                {abaAtiva === 'preview' && (
                    <PreviewPhone
                        tipo={tipo}
                        titulo={titulo}
                        mensagem={mensagem}
                        urlImagem={previewImagem || urlImagem}
                        corFundo={corFundo}
                        urgente={urgente}
                    />
                )}

                {/* Footer */}
                <div className="avpm-footer">
                    <button className="gs-btn gs-btn-secundario" onClick={onFechar} disabled={salvando}>
                        Cancelar
                    </button>
                    <button
                        className="gs-btn gs-btn-primario"
                        onClick={handleSalvar}
                        disabled={salvando || comprimindo}
                    >
                        {salvando
                            ? <><div className="spinner-btn-interno"></div> Salvando...</>
                            : <><i className="fas fa-check"></i> {BTN_SALVAR_TEXTO}</>
                        }
                    </button>
                </div>
            </div>
        </div>
    );
}
