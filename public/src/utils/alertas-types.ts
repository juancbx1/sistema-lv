// Tipos de domínio — Central de Alertas + Avisos Popup

// ── Alertas gerais ──────────────────────────────────────────────────────────

export type TipoAlerta =
    | 'OCIOSIDADE_ARREMATE'
    | 'LENTIDAO_CRITICA_ARREMATE'
    | 'META_BATIDA_ARREMATE'
    | 'OCIOSIDADE_COSTUREIRA'
    | 'LENTIDAO_COSTUREIRA'
    | 'DEMANDA_NORMAL'
    | 'DEMANDA_PRIORITARIA'
    | 'DEMANDA_NAO_INICIADA'
    | (string & {});

export interface AlertaConfig {
    id: number | string;
    tipo_alerta: TipoAlerta;
    descricao?: string | null;
    gatilho_minutos: number;
    intervalo_repeticao_minutos: number;
    peso_risco?: number | null;
    ativo: boolean;
    [key: string]: unknown;
}

export type AlertaConfigCampo =
    | 'gatilho_minutos'
    | 'intervalo_repeticao_minutos'
    | 'peso_risco'
    | 'ativo';

/** Mapa dia da semana (0=Dom … 6=Sáb) → ativo. JSON pode serializar chaves como string. */
export type DiasTrabalhoMap = Record<string | number, boolean>;

export interface DiasTrabalhoConfig {
    valor?: DiasTrabalhoMap;
    horario_inicio?: string | null;
    horario_fim?: string | null;
    janela_poll_inicio?: string | null;
    janela_poll_fim?: string | null;
    [key: string]: unknown;
}

export type HorarioCampo = 'horario_inicio' | 'horario_fim';
export type JanelaPollCampo = 'janela_poll_inicio' | 'janela_poll_fim';

export type ConfigAlertasAba = 'alertas' | 'avisos';

// ── Avisos popup ────────────────────────────────────────────────────────────

export type AvisoPopupTipo = 'texto' | 'imagem' | 'misto';
export type AvisoPopupDestinatarios = 'todos' | 'costureiras' | 'tiktiks' | 'individuais';
export type AvisoPopupCorFundo = 'azul' | 'ambar' | 'verde' | 'vermelho';
export type AvisoPopupModo = 'criar' | 'editar' | 'duplicar' | 'usar-template';
export type AvisoPopupStatusCard = 'template' | 'inativo' | 'agendado' | 'urgente' | 'ativo';

export interface AvisoPopup {
    id: number | string;
    titulo: string;
    tipo: AvisoPopupTipo | string;
    mensagem?: string | null;
    url_imagem?: string | null;
    destinatarios?: AvisoPopupDestinatarios | string | null;
    ids_individuais?: number[] | string | null;
    destinatarios_nomes?: string[] | null;
    urgente?: boolean | null;
    is_template?: boolean | null;
    ativo?: boolean | null;
    data_inicio?: string | null;
    data_fim?: string | null;
    cor_fundo?: AvisoPopupCorFundo | string | null;
    total_visualizacoes?: number | string | null;
    total_destinatarios?: number | string | null;
    [key: string]: unknown;
}

export interface AvisoPopupPayload {
    titulo: string;
    tipo: AvisoPopupTipo | string;
    mensagem: string | null;
    url_imagem: string | null;
    cor_fundo: AvisoPopupCorFundo | string;
    destinatarios: AvisoPopupDestinatarios | string;
    ids_individuais: number[];
    urgente: boolean;
    is_template: boolean;
    ativo: boolean;
    data_inicio: string;
    data_fim: string | null;
}

export interface AvisoPopupModalState {
    aviso: AvisoPopup | null;
    modo: AvisoPopupModo;
}

export interface AvisoPopupPessoa {
    id: number;
    nome: string;
}

export interface AvisoPopupCompressInfo {
    original: number;
    comprimido: number;
}

/** Evento do calendário usado como sugestão de data no modal de aviso. */
export interface AvisoPopupEventoCalendario {
    id: number | string;
    data: string;
    tipo: string;
    descricao?: string | null;
    funcionario_id?: number | string | null;
    [key: string]: unknown;
}

// ── Galeria de imagens (Vercel Blob) ────────────────────────────────────────

export interface AvisoPopupBlobImagem {
    url: string;
    pathname: string;
    size: number;
    uploadedAt?: string | null;
    emUso?: string | null;
    avisoAtivo?: boolean | null;
    [key: string]: unknown;
}

export type AvisoPopupGaleriaFiltro = 'todas' | 'em_uso' | 'livres';

// ── Visualizações (viewers) ─────────────────────────────────────────────────

export interface AvisoPopupViewerUsuario {
    id: number | string;
    nome: string;
    visto_em?: string | null;
}

export interface AvisoPopupViewersResponse {
    visualizaram: AvisoPopupViewerUsuario[];
    nao_visualizaram: AvisoPopupViewerUsuario[];
    error?: string;
    [key: string]: unknown;
}

export type AvisoPopupViewersAba = 'viram' | 'nao_viram';
