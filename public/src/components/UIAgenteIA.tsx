// public/src/components/UIAgenteIA.tsx
// Identidade visual de IA do sistema — componente padrão.
//
// Exports:
//   default UIAgenteIA — avatar standalone (círculo do robô)
//   BotaoIA            — botão acionador de agente (avatar + texto + estados)
//   LoaderIA           — animação de carregamento (avatar + terminal monospace)

import type { CSSProperties, MouseEventHandler } from 'react';

export type UIAgenteIATamanho = 'sm' | 'md' | 'lg';
export type BotaoIAEstado = 'idle' | 'scanning' | 'done';
export type LoaderIAMensagemTipo = 'ok' | 'urgente' | 'atencao';

export interface UIAgenteIAProps {
    tamanho?: UIAgenteIATamanho;
    scanning?: boolean;
    className?: string;
}

export interface BotaoIAProps {
    estado?: BotaoIAEstado;
    textoIdle?: string;
    textoScanning?: string;
    textoDone?: string;
    onClick?: MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    className?: string;
    style?: CSSProperties;
}

export interface LoaderIAFase {
    texto: string;
}

export interface LoaderIAMensagemFinal {
    tipo?: LoaderIAMensagemTipo;
    icone?: string;
    texto: string;
}

export interface LoaderIAProps {
    fases?: LoaderIAFase[];
    faseAtual?: number;
    mensagemFinal?: LoaderIAMensagemFinal | null;
}

// ── Avatar ─────────────────────────────────────────────────────
// O círculo gradiente com o robô. Use standalone onde quiser
// exibir o ícone de IA sem botão nem terminal.
export default function UIAgenteIA({ tamanho = 'md', scanning = false, className = '' }: UIAgenteIAProps) {
    return (
        <div className={`ui-ia-avatar ui-ia-avatar--${tamanho}${scanning ? ' ui-ia-scanning' : ''} ${className}`.trim()}>
            <i className={`fas ${scanning ? 'fa-circle-notch fa-spin' : 'fa-robot'}`}></i>
        </div>
    );
}

// ── Botão acionador ────────────────────────────────────────────
// Botão que ativa/desativa um agente de IA.
// estados: 'idle' | 'scanning' | 'done'
export function BotaoIA({
    estado = 'idle',
    textoIdle = 'Agente',
    textoScanning = 'Analisando...',
    textoDone = 'Fechar Agente',
    onClick,
    disabled = false,
    className = '',
    style,
}: BotaoIAProps) {
    const texto =
        estado === 'scanning' ? textoScanning :
        estado === 'done' ? textoDone :
        textoIdle;

    return (
        <button
            type="button"
            className={`ui-ia-btn ui-ia-btn--${estado} ${className}`.trim()}
            onClick={onClick}
            disabled={disabled || estado === 'scanning'}
            style={style}
        >
            <UIAgenteIA tamanho="sm" scanning={estado === 'scanning'} />
            <span>{texto}</span>
        </button>
    );
}

// ── Loader (avatar + terminal) ─────────────────────────────────
// Exibido durante carregamentos com identidade de IA.
// fases: array de { texto: string }
// faseAtual: índice atual (0, 1, 2... >= fases.length = mostrar mensagem final)
// mensagemFinal: { tipo: 'ok'|'urgente'|'atencao', icone: 'fa-check', texto: '...' }
export function LoaderIA({ fases = [], faseAtual = 0, mensagemFinal = null }: LoaderIAProps) {
    const fasesVisiveis = fases.slice(0, Math.min(faseAtual + 1, fases.length));
    const mostrarFinal = faseAtual >= fases.length;

    return (
        <div className="ui-ia-loader">
            <UIAgenteIA tamanho="lg" scanning={!mostrarFinal} />
            <div className="ui-ia-terminal">
                {fasesVisiveis.map((f, i) => {
                    const concluida = i < fasesVisiveis.length - 1 || mostrarFinal;
                    return (
                        <div key={i} className={`ui-ia-linha ${concluida ? 'concluida' : 'atual'}`}>
                            <span className="ui-ia-prompt">
                                {concluida
                                    ? <i className="fas fa-check"></i>
                                    : <>›</>
                                }
                            </span>
                            <span className="ui-ia-texto">{f.texto}</span>
                            {!concluida && <span className="ui-ia-cursor">▌</span>}
                        </div>
                    );
                })}
                {mostrarFinal && mensagemFinal && (
                    <div className={`ui-ia-linha final ui-ia-linha--${mensagemFinal.tipo || 'ok'}`}>
                        <span className="ui-ia-prompt">
                            <i className={`fas ${mensagemFinal.icone || 'fa-check'}`}></i>
                        </span>
                        <span className="ui-ia-texto">{mensagemFinal.texto}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
