import React from 'react';

export default function DashCadeiaNaoMigrada() {
    return (
        <div className="ds-body ds-body--bloqueado">
            <main className="ds-bloqueio-container" role="status" aria-live="polite">
                <div className="ds-bloqueio-icone" aria-hidden="true">
                    <i className="fas fa-industry" />
                </div>
                <span className="ds-bloqueio-etiqueta">Dashboard temporariamente indisponível</span>
                <h1>A cadeia de produção ainda não está disponível neste ambiente.</h1>
                <p>
                    A dashboard será liberada quando os dados de produção forem
                    preparados para este ambiente empresarial.
                </p>
                <p className="ds-bloqueio-ajuda">
                    Nenhum dado de outro ambiente foi carregado.
                </p>
            </main>
        </div>
    );
}
