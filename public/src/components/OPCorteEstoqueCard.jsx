// public/src/components/OPCorteEstoqueCard.jsx

import React from 'react';
import UIBloqueio from './UIBloqueio.jsx';
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio.js';

function formatarData(dataISO) {
    if (!dataISO) return 'N/A';
    return new Date(dataISO).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export default function OPCorteEstoqueCard({ corte, produto, onGerarOP, onExcluir, isGerando, demandasVinculadas = [] }) {

    const getImagem = () => {
        if (!produto) return '/img/placeholder-image.png';
        if (corte.variante && produto.grade && Array.isArray(produto.grade)) {
            const g = produto.grade.find(g => g.variacao === corte.variante);
            if (g?.imagem) return g.imagem;
        }
        return produto.imagem || '/img/placeholder-image.png';
    };

    const variante = corte.variante && corte.variante !== '-' ? corte.variante : 'Padrão';
    const temDemanda = demandasVinculadas.length > 0;
    const podeGerarOP = temPermissao('gerar-op');
    const urgente = temDemanda && parseInt(demandasVinculadas[0].prioridade) === 1;

    const labelDemanda = demandasVinculadas.length === 1
        ? `${demandasVinculadas[0].quantidade_solicitada} pçs demandadas`
        : `${demandasVinculadas.length} demandas`;

    const classeItem = [
        'op-corte-item',
        temDemanda ? 'op-corte-item--com-demanda' : '',
        urgente ? 'op-corte-item--urgente' : '',
    ].filter(Boolean).join(' ');

    return (
        <div className={classeItem}>

            {/* Borda-charme — padrão global do sistema (position:absolute no pai) */}
            <div className="card-borda-charme"></div>

            {/* Topo: imagem + info + qty/excluir */}
            <div className="op-corte-item-topo">
                <img
                    src={getImagem()}
                    alt={variante}
                    className="op-corte-item-img"
                />

                <div className="op-corte-item-produto">
                    <div className="op-corte-item-variante">{variante}</div>
                    <div className="op-corte-item-meta">
                        <span className="op-corte-item-pc">PC {corte.pn}</span>
                        <span className="op-corte-item-sep">·</span>
                        <span>{formatarData(corte.data)}</span>
                        {corte.cortador && (
                            <>
                                <span className="op-corte-item-sep">·</span>
                                <span className="op-corte-item-cortador">
                                    <i className="fas fa-cut"></i> {corte.cortador}
                                </span>
                            </>
                        )}
                    </div>
                    {temDemanda && (
                        <div className="op-corte-item-demanda">
                            {urgente && <span className="op-corte-item-demanda-urgente">⚡</span>}
                            <i className="fas fa-link"></i>
                            <span>{labelDemanda}</span>
                        </div>
                    )}
                </div>

                {/* Quantidade + excluir empilhados no lado direito */}
                <div className="op-corte-item-direita">
                    <div className="op-corte-item-qty">
                        <span className="op-corte-item-qty-valor">{corte.quantidade}</span>
                        <span className="op-corte-item-qty-label">pçs</span>
                    </div>
                    <UIBloqueio permissao="excluir-estoque-corte">
                        <button
                            className="op-corte-item-excluir"
                            onClick={e => { e.stopPropagation(); onExcluir?.(corte); }}
                            title="Excluir corte do estoque"
                            aria-label="Excluir corte"
                        >
                            <i className="fas fa-trash-alt"></i>
                        </button>
                    </UIBloqueio>
                </div>
            </div>

            {/* Fundo: botão de ação full-width */}
            <button
                className={`op-corte-item-acao${temDemanda ? ' tem-demanda' : ''}${!podeGerarOP ? ' op-corte-item-acao--bloqueado' : ''}`}
                onClick={() => {
                    if (!podeGerarOP) {
                        mostrarPopupSemPermissao('Você não tem permissão para gerar Ordens de Produção.');
                        return;
                    }
                    onGerarOP(corte);
                }}
                disabled={isGerando}
            >
                {isGerando ? (
                    <><div className="op-spinner-btn"></div> Gerando OP...</>
                ) : !podeGerarOP ? (
                    <><i className="fas fa-lock"></i> Sem permissão</>
                ) : temDemanda ? (
                    <><i className="fas fa-link"></i> Gerar OP Vinculada</>
                ) : (
                    <><i className="fas fa-arrow-right"></i> Gerar OP</>
                )}
            </button>

        </div>
    );
}
