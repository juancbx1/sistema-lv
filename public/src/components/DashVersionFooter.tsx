// DashVersionFooter.jsx
// Rodapé da dashboard com a versão clicável.
// Ao clicar abre um modal com as novidades da versão atual para funcionários.

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
// @ts-expect-error módulo JS legado sem tipos
import { changelog } from '/js/utils/changelog-data.js';
import type { DashChangelogEntrada } from '../utils/dashboard-types';

export default function DashVersionFooter({ className = '' }: { className?: string }) {
    const [aberto, setAberto] = useState(false);

    // Apenas entradas que têm novidades para a dashboard
    const entradasDashboard = (changelog as DashChangelogEntrada[]).filter((e: DashChangelogEntrada) => e.dashboard && e.dashboard.length > 0);

    // Versão exibida no rodapé = versao_dashboard da entrada mais recente (se existir), senão versao
    const versaoRodape = entradasDashboard.length > 0
        ? (entradasDashboard[0].versao_dashboard ?? entradasDashboard[0].versao)
        : __APP_VERSION__;

    return (
        <>
            <footer className={`ds-version-footer${className ? ` ${className}` : ''}`} onClick={() => setAberto(true)} title="Ver novidades desta versão">
                <i className="fas fa-circle-info"></i>
                <span>v{versaoRodape}</span>
            </footer>

            {aberto && createPortal(
                <div
                    className="ds-popup-overlay ativo ds-version-modal-overlay"
                    onClick={() => setAberto(false)}
                    role="presentation"
                >
                    <div
                        className="ds-version-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="ds-version-modal-titulo"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="ds-version-modal-header">
                            <div className="ds-version-modal-titulo-bloco">
                                <i className="fas fa-rocket" aria-hidden="true"></i>
                                <h2 id="ds-version-modal-titulo">Novidades do Sistema</h2>
                            </div>
                            <button
                                type="button"
                                className="ds-modal-close-simple"
                                onClick={() => setAberto(false)}
                                aria-label="Fechar novidades do sistema"
                            >
                                <i className="fas fa-times" aria-hidden="true"></i>
                            </button>
                        </div>

                        <div className="ds-version-modal-body">
                            {entradasDashboard.length === 0 ? (
                                <p className="ds-version-vazio">Nenhuma novidade registrada ainda.</p>
                            ) : (
                                entradasDashboard.map((entrada, idx) => (
                                    <div key={entrada.versao} className="ds-version-entrada">
                                        <div className="ds-version-entrada-header">
                                            <span className="ds-version-badge">
                                                v{entrada.versao_dashboard ?? entrada.versao}
                                            </span>
                                            {idx === 0 && (
                                                <span className="ds-version-atual-tag">Atual</span>
                                            )}
                                            <span className="ds-version-data">{entrada.data}</span>
                                        </div>
                                        <ul className="ds-version-lista">
                                            {(entrada.dashboard || []).map((item, i) => (
                                                <li key={i}>
                                                    <i className="fas fa-check" aria-hidden="true"></i>
                                                    <span>{item}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}
