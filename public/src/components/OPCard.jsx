// public/src/components/OPCard.jsx

import React from 'react';
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio.js';

function isParcial(op) {
    if (!op.etapas || op.etapas.length === 0) return false;
    const ultima = op.etapas[op.etapas.length - 1];
    return (ultima?.quantidade_feita || 0) < op.quantidade;
}

function formatarData(dataISO) {
    try {
        if (!dataISO) return 'N/A';
        return new Date(dataISO).toLocaleDateString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC'
        });
    } catch (e) {
        return 'Data Inválida';
    }
}

function RadarBadge({ radar }) {
    if (!radar || radar.faixa === 'normal') return null;
    const isCritico = radar.faixa === 'critico';
    return (
        <span
            className={`op-radar-badge ${radar.faixa}`}
            title={`Esta OP está em produção há ${radar.horas_abertas}h. O tempo normal para este produto é ${radar.media_horas}h.`}
        >
            <i className={`fas fa-${isCritico ? 'radiation-alt' : 'exclamation-triangle'}`}></i>
            {isCritico ? 'Atrasada: ' : 'Atenção: '}
            em prod. há {radar.horas_abertas}h (normal: {radar.media_horas}h)
        </span>
    );
}

export function OPCard({ op, onClick, onCancelar }) {
    if (!op) return null;

    const imagemSrc = op.imagem_produto || '/img/placeholder-image.png';

    // Calcula statusClass — prioridade: pronta > radar > status base
    let statusClass = `status-${op.status}`;
    try {
        if (op.status !== 'finalizado' && op.status !== 'cancelada' &&
            op.etapas && Array.isArray(op.etapas) && op.etapas.length > 0) {
            const todasProntas = op.etapas.every(e => e && e.lancado === true);
            if (todasProntas) {
                statusClass = 'status-pronta-finalizar';
            } else if (op.radar?.faixa === 'critico') {
                statusClass = 'status-radar-critico';
            } else if (op.radar?.faixa === 'atencao') {
                statusClass = 'status-radar-atencao';
            }
        }
    } catch { /* ignora */ }

    const elegivel = statusClass === 'status-pronta-finalizar';

    const podeCancelar = onCancelar &&
        op.status !== 'cancelada' &&
        op.status !== 'finalizado';

    // Inline pattern: position:absolute não pode ter wrapper UIBloqueio (quebraria o contexto CSS)
    const podeExecutarCancelamento = temPermissao('cancelar-op');

    const handleClick = () => {
        if (onClick) onClick(op);
    };

    const handleCancelarClick = (e) => {
        e.stopPropagation();
        if (!podeExecutarCancelamento) {
            mostrarPopupSemPermissao('Você não tem permissão para cancelar OPs.');
            return;
        }
        onCancelar(op);
    };

    const varianteTexto = op.variante && op.variante !== '-' ? op.variante : 'Padrão';

    return (
        <div className="op-card-react" onClick={handleClick}>
            <div className={`card-borda-charme ${statusClass}`}></div>

            {/* Botão cancelar — canto superior direito */}
            {/* Inline pattern: botão é position:absolute, UIBloqueio wrapper quebraria o contexto de posicionamento */}
            {podeCancelar && (
                <button
                    className="op-card-btn-cancelar"
                    onClick={handleCancelarClick}
                    title={podeExecutarCancelamento ? 'Cancelar OP' : 'Sem permissão para cancelar'}
                    aria-label="Cancelar OP"
                >
                    {podeExecutarCancelamento ? (
                        <i className="fas fa-trash-alt"></i>
                    ) : (
                        <span className="op-btn-cancelar-bloqueado">
                            <i className="fas fa-trash-alt"></i>
                            <i className="fas fa-lock"></i>
                        </span>
                    )}
                </button>
            )}

            {/* Corpo principal: imagem | info | quantidade */}
            <div className="op-card-corpo">
                <img src={imagemSrc} alt={varianteTexto} className="card-imagem-produto" />

                <div className="card-info-principal">
                    <div className="card-meta-linha">
                        <span className="card-op-num">OP #{op.numero}</span>
                        <span className="card-data-criacao">
                            <i className="fas fa-calendar-alt"></i>
                            {formatarData(op.data_entrega)}
                        </span>
                    </div>
                    <div className="card-variante-hero">{varianteTexto}</div>
                    <RadarBadge radar={op.radar} />
                </div>

                <div className="card-bloco-pendente">
                    <span className="label">PÇS</span>
                    <span className="valor">{op.quantidade || 0}</span>
                </div>
            </div>

            {/* Tira de status: verde para pronta completa, laranja para parcial */}
            {elegivel && (
                isParcial(op) ? (
                    <div className="card-parcial-tira">
                        <i className="fas fa-exclamation-triangle"></i>
                        <span>Encerramento Parcial</span>
                    </div>
                ) : (
                    <div className="card-pronta-tira">
                        <i className="fas fa-check-circle"></i>
                        <span>Pronta para encerrar</span>
                    </div>
                )
            )}
        </div>
    );
}
