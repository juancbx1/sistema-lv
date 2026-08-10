import React from 'react';
import ArremateRegistrarPerdaTela from './ArremateRegistrarPerdaTela.jsx';

/**
 * Entrada canônica para perdas de Produções.
 * Os componentes internos ainda são aliases visuais durante a transição,
 * mas as leituras e a gravação usam o namespace de Produções.
 */
export default function OPRegistrarPerdaTela({ onConcluido }) {
    return (
        <ArremateRegistrarPerdaTela
            onConcluido={onConcluido}
            filaEndpoint="/api/producoes/fila-perdas"
            perdaEndpoint="/api/producoes/registrar-perda"
        />
    );
}
