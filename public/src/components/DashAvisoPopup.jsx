// public/src/components/DashAvisoPopup.jsx
// Popup de aviso exibido na dashboard das funcionárias.
//
// Comportamento:
//   Normal  — X fecha diretamente, registra visualização
//   Urgente — X fica desabilitado até marcar checkbox "Li e estou ciente"
//
// Múltiplos avisos pendentes: após fechar um, aguarda 1500ms e exibe o próximo.

import React, { useState, useEffect } from 'react';

const COR_GRAD = {
    azul:     'linear-gradient(135deg, #4361ee, #8e44ad)',
    ambar:    'linear-gradient(135deg, #f59e0b, #d97706)',
    verde:    'linear-gradient(135deg, #10b981, #059669)',
    vermelho: 'linear-gradient(135deg, #ef4444, #dc2626)',
};

const COR_BTN = {
    azul:     '#4361ee',
    ambar:    '#d97706',
    verde:    '#059669',
    vermelho: '#dc2626',
};

export default function DashAvisoPopup({ avisos: avisosIniciais, onMarcarVisto }) {
    const [fila, setFila]             = useState(avisosIniciais || []);
    const [atual, setAtual]           = useState(avisosIniciais?.[0] || null);
    const [ciente, setCiente]         = useState(false);
    const [saindo, setSaindo]         = useState(false);   // animação de saída
    const [entrando, setEntrando]     = useState(false);   // animação de entrada

    // Sincroniza se a prop mudar (ex: novos avisos chegam depois)
    useEffect(() => {
        setFila(avisosIniciais || []);
        setAtual(avisosIniciais?.[0] || null);
        setCiente(false);
    }, [avisosIniciais]);

    if (!atual) return null;

    const podeFechador = !atual.urgente || ciente;
    const proximosCount = fila.length - 1;

    const fechar = () => {
        if (!podeFechador) return;

        // Registra visualização
        onMarcarVisto(atual.id);

        // Animação de saída
        setSaindo(true);
        setTimeout(() => {
            const novaFila = fila.slice(1);
            setSaindo(false);

            if (novaFila.length === 0) {
                setAtual(null);
                setFila([]);
                return;
            }

            // Delay de 1500ms antes de mostrar o próximo
            setAtual(null);
            setTimeout(() => {
                setCiente(false);
                setEntrando(true);
                setFila(novaFila);
                setAtual(novaFila[0]);
                setTimeout(() => setEntrando(false), 300);
            }, 1500);
        }, 250);
    };

    const cor    = atual.cor_fundo || 'azul';
    const grad   = COR_GRAD[cor]   || COR_GRAD.azul;
    const btnCor = COR_BTN[cor]    || COR_BTN.azul;

    // Se o tipo pede imagem mas a URL falhou/não veio, cai para texto (evita card preto vazio)
    const temImagem = Boolean(atual.url_imagem);
    let tipo = atual.tipo || 'texto';
    if ((tipo === 'imagem' || tipo === 'misto') && !temImagem) {
        tipo = 'texto';
    } else if (tipo === 'imagem' && temImagem && atual.mensagem) {
        // Imagem + mensagem: trata como misto para não esconder o texto
        tipo = 'misto';
    }

    // Tipo "imagem" sem urgência: o X fecha e registra — não exibe corpus abaixo
    const semCorpo = tipo === 'imagem' && !atual.urgente;
    const imgWrapClass = [
        'dap-imagem-wrap',
        semCorpo            && 'dap-imagem-wrap--full',
        tipo === 'misto'    && 'dap-imagem-wrap--misto',
    ].filter(Boolean).join(' ');

    return (
        <div className="dap-overlay">
            <div className={`dap-card ${semCorpo ? 'dap-card--imagem-full' : ''} ${tipo === 'misto' ? 'dap-card--misto' : ''} ${saindo ? 'dap-card--saindo' : ''} ${entrando ? 'dap-card--entrando' : ''}`}>

                {/* Barra superior — gradiente para normal, vermelho para urgente */}
                <div
                    className="dap-barra-topo"
                    style={{ background: atual.urgente ? 'linear-gradient(90deg,#ef4444,#dc2626)' : grad }}
                />

                {/* Área de imagem (tipos: imagem e misto) */}
                {(tipo === 'imagem' || tipo === 'misto') && atual.url_imagem && (
                    <div className={imgWrapClass}>
                        <img src={atual.url_imagem} alt={atual.titulo} className="dap-imagem" />
                        {atual.urgente && (
                            <span className="dap-badge-urgente">URGENTE</span>
                        )}
                        {/* Botão fechar sobre a imagem */}
                        <button
                            className={`dap-btn-fechar ${!podeFechador ? 'dap-btn-fechar--bloqueado' : ''}`}
                            onClick={fechar}
                            aria-label="Fechar aviso"
                            disabled={!podeFechador}
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                )}

                {/* Área colorida de texto (tipo: texto) */}
                {tipo === 'texto' && (
                    <div className="dap-area-colorida" style={{ background: grad }}>
                        {atual.urgente && (
                            <span className="dap-badge-urgente dap-badge-urgente--texto">URGENTE</span>
                        )}
                        {/* Botão fechar sobre a área colorida */}
                        <button
                            className={`dap-btn-fechar dap-btn-fechar--claro ${!podeFechador ? 'dap-btn-fechar--bloqueado' : ''}`}
                            onClick={fechar}
                            aria-label="Fechar aviso"
                            disabled={!podeFechador}
                        >
                            <i className="fas fa-times"></i>
                        </button>
                        <div className="dap-area-colorida-titulo">{atual.titulo}</div>
                    </div>
                )}

                {/* Corpo — oculto para tipo "imagem" não urgente (X já fecha e registra) */}
                {!semCorpo && (
                <div className="dap-corpo">

                    {/* Título para imagem urgente e misto — fica no corpo */}
                    {(tipo === 'imagem' || tipo === 'misto') && (
                        <div className="dap-titulo">{atual.titulo}</div>
                    )}

                    {/* Mensagem (para texto e misto) */}
                    {atual.mensagem && (
                        <div className="dap-mensagem">{atual.mensagem}</div>
                    )}

                    {/* Checkbox de ciência — só para urgente */}
                    {atual.urgente && (
                        <label className="dap-checkbox-ciente">
                            <input
                                type="checkbox"
                                checked={ciente}
                                onChange={e => setCiente(e.target.checked)}
                            />
                            <span>Li e estou ciente</span>
                        </label>
                    )}

                    {/* Indicador de mais avisos pendentes */}
                    {proximosCount > 0 && (
                        <div className="dap-mais-avisos">
                            <i className="fas fa-circle-info"></i>
                            +{proximosCount} aviso{proximosCount > 1 ? 's' : ''} pendente{proximosCount > 1 ? 's' : ''}
                        </div>
                    )}

                    {/* Botão de ação principal */}
                    {!atual.urgente && (
                        <button
                            className="dap-btn-entendido"
                            style={{ background: btnCor }}
                            onClick={fechar}
                        >
                            Entendido!
                        </button>
                    )}

                    {/* Para urgente: o botão principal só aparece após marcar o checkbox */}
                    {atual.urgente && (
                        <button
                            className={`dap-btn-entendido dap-btn-entendido--urgente ${!ciente ? 'dap-btn-entendido--inativo' : ''}`}
                            onClick={fechar}
                            disabled={!ciente}
                        >
                            <i className="fas fa-check-circle"></i> Ciente, pode fechar
                        </button>
                    )}
                </div>
                )}
            </div>
        </div>
    );
}
