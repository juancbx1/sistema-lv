// DashVersionFooter.jsx
// Rodapé da dashboard com a versão clicável.
// Ao clicar abre um modal com as novidades da versão atual para funcionários.

import React, { useState } from 'react';
import { changelog } from '/js/utils/changelog-data.js';

export default function DashVersionFooter({ className = '' }) {
    const [aberto, setAberto] = useState(false);

    // Apenas entradas que têm novidades para a dashboard
    const entradasDashboard = changelog.filter(e => e.dashboard && e.dashboard.length > 0);

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

            {aberto && (
                <div className="ds-popup-overlay ativo" onClick={() => setAberto(false)} style={{ zIndex: 1500 }}>
                    <div
                        className="ds-version-modal"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="ds-version-modal-header">
                            <div className="ds-version-modal-titulo-bloco">
                                <i className="fas fa-rocket"></i>
                                <h2>Novidades do Sistema</h2>
                            </div>
                            <button
                                className="ds-modal-close-simple"
                                onClick={() => setAberto(false)}
                                aria-label="Fechar"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        {/* Lista de versões */}
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
                                            {entrada.dashboard.map((item, i) => (
                                                <li key={i}>
                                                    <i className="fas fa-check"></i>
                                                    <span>{item}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
