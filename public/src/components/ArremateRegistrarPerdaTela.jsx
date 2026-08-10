// public/src/components/ArremateRegistrarPerdaTela.jsx

import React, { useState } from 'react';
import TelaSelecaoProduto from './ArremateTelaSelecaoProduto.jsx';
import FormularioPerda from './ArremateFormularioPerda.jsx';

export default function ArremateRegistrarPerdaTela({
    onConcluido,
    filaEndpoint = '/api/producoes/fila-perdas',
    perdaEndpoint = '/api/producoes/registrar-perda',
}) {
    const [tela, setTela] = useState('selecao_produto');
    const [itemSelecionado, setItemSelecionado] = useState(null);

    const handleItemSelect = (item) => {
        setItemSelecionado(item);
        setTela('formulario_perda');
    };

    const handleVoltar = () => {
        setItemSelecionado(null);
        setTela('selecao_produto');
    };

    const handleConcluido = () => {
        setTela('selecao_produto');
        setItemSelecionado(null);
        window.dispatchEvent(new Event('forcarAtualizacaoFilaDeArremates'));
        onConcluido?.();
    };

    return (
        <div className="gs-card arremate-perda-wrapper">
            <div className="arremate-perda-header">
                {tela === 'formulario_perda' && (
                    <button className="arremate-btn-voltar" onClick={handleVoltar}>
                        <i className="fas fa-arrow-left" /> Voltar
                    </button>
                )}
                <h3>
                    {tela === 'selecao_produto'
                        ? 'Registrar Perda — Selecione o Produto'
                        : 'Registrar Perda — Detalhes'}
                </h3>
            </div>

            {tela === 'selecao_produto' && (
                <TelaSelecaoProduto
                    onItemSelect={handleItemSelect}
                    filaEndpoint={filaEndpoint}
                />
            )}
            {tela === 'formulario_perda' && itemSelecionado && (
                <FormularioPerda
                    item={itemSelecionado}
                    onConfirmar={handleConcluido}
                    endpoint={perdaEndpoint}
                />
            )}
        </div>
    );
}
