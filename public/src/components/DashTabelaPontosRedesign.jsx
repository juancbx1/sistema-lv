import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { fetchAPI } from '/js/utils/api-utils';

function formatarPontos(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function obterProcessos(produto) {
    return Array.isArray(produto?.processos) ? produto.processos : [];
}

function obterTotalProduto(produto) {
    return obterProcessos(produto).reduce(
        (total, processo) => total + Number(processo?.pontos || 0),
        0,
    );
}

export default function DashTabelaPontosRedesign({ onClose }) {
    const [dados, setDados] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAPI('/api/dashboard/minha-tabela-pontos')
            .then(setDados)
            .catch(() => setDados([]))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        const fecharComEsc = (event) => {
            if (event.key === 'Escape') onClose();
        };

        document.addEventListener('keydown', fecharComEsc);
        return () => document.removeEventListener('keydown', fecharComEsc);
    }, [onClose]);

    const produtos = Array.isArray(dados) ? dados : [];

    return ReactDOM.createPortal(
        <div
            className="ds-popup-overlay ativo ds-tabela-pontos-overlay"
            onClick={onClose}
        >
            <section
                className="ds-tabela-pontos-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="ds-tabela-pontos-titulo"
                onClick={(event) => event.stopPropagation()}
            >
                <header className="ds-tabela-pontos-cabecalho">
                    <div className="ds-tabela-pontos-cabecalho-marca">
                        <span className="ds-tabela-pontos-icone" aria-hidden="true">
                            <i className="fas fa-star" />
                        </span>
                        <div>
                            <span className="ds-tabela-pontos-kicker">Seu mapa de produção</span>
                            <h2 id="ds-tabela-pontos-titulo">Minha tabela de pontos</h2>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="ds-tabela-pontos-fechar"
                        onClick={onClose}
                        aria-label="Fechar tabela de pontos"
                    >
                        <i className="fas fa-times" aria-hidden="true" />
                    </button>
                    <p className="ds-tabela-pontos-subtitulo">
                        Consulte quanto vale cada etapa dos produtos que você produz.
                    </p>
                </header>

                <div className="ds-tabela-pontos-conteudo">
                    {loading ? (
                        <div className="ds-tabela-pontos-carregando" aria-label="Carregando tabela de pontos">
                            <div className="ds-tabela-pontos-spinner" aria-hidden="true">
                                <i className="fas fa-star" />
                            </div>
                            <strong>Montando sua tabela...</strong>
                            <span>Buscando os valores de cada etapa.</span>
                        </div>
                    ) : produtos.length === 0 ? (
                        <div className="ds-tabela-pontos-vazio">
                            <span className="ds-tabela-pontos-vazio-icone" aria-hidden="true">
                                <i className="fas fa-table-list" />
                            </span>
                            <strong>Nenhum produto encontrado</strong>
                            <p>A tabela aparecerá assim que houver produtos registrados no seu histórico.</p>
                        </div>
                    ) : (
                        <div className="ds-tabela-pontos-lista">
                            {produtos.map((produto, indice) => {
                                const processos = obterProcessos(produto);
                                const totalPorPeca = obterTotalProduto(produto);
                                const maiorProcesso = Math.max(
                                    ...processos.map((processo) => Number(processo?.pontos || 0)),
                                    1,
                                );

                                return (
                                    <article className="ds-tabela-pontos-produto" key={`${produto.produto_nome || 'produto'}-${indice}`}>
                                        <div className="ds-tabela-pontos-produto-cabecalho">
                                            <span className="ds-tabela-pontos-produto-imagem" aria-hidden={!produto.produto_imagem}>
                                                {produto.produto_imagem ? (
                                                    <img
                                                        src={produto.produto_imagem}
                                                        alt=""
                                                        onError={(event) => {
                                                            event.currentTarget.style.display = 'none';
                                                            event.currentTarget.parentElement.classList.add('sem-imagem');
                                                        }}
                                                    />
                                                ) : (
                                                    <i className="fas fa-box" aria-hidden="true" />
                                                )}
                                            </span>
                                            <div className="ds-tabela-pontos-produto-identidade">
                                                <span className="ds-tabela-pontos-produto-indice">Produto {String(indice + 1).padStart(2, '0')}</span>
                                                <h3>{produto.produto_nome || 'Produto sem nome'}</h3>
                                            </div>
                                            <div className="ds-tabela-pontos-produto-total">
                                                <strong>{formatarPontos(totalPorPeca)}</strong>
                                                <span>pts por peça</span>
                                            </div>
                                        </div>

                                        <div className="ds-tabela-pontos-etapas">
                                            <div className="ds-tabela-pontos-etapas-cabecalho">
                                                <span>Etapas de produção</span>
                                                <span>pontos</span>
                                            </div>
                                            {processos.length === 0 ? (
                                                <p className="ds-tabela-pontos-sem-etapas">Nenhuma etapa cadastrada para este produto.</p>
                                            ) : (
                                                processos.map((processo, processoIndice) => {
                                                    const pontos = Number(processo?.pontos || 0);
                                                    const largura = Math.max(8, Math.round((pontos / maiorProcesso) * 100));

                                                    return (
                                                        <div className="ds-tabela-pontos-etapa" key={`${processo.nome || 'etapa'}-${processoIndice}`}>
                                                            <span className="ds-tabela-pontos-etapa-numero">{String(processoIndice + 1).padStart(2, '0')}</span>
                                                            <div className="ds-tabela-pontos-etapa-detalhe">
                                                                <strong>{processo.nome || 'Etapa sem nome'}</strong>
                                                                <span className="ds-tabela-pontos-etapa-barra" aria-hidden="true">
                                                                    <span style={{ width: `${largura}%` }} />
                                                                </span>
                                                            </div>
                                                            <strong className="ds-tabela-pontos-etapa-valor">{formatarPontos(pontos)} <small>pts</small></strong>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </div>

                <footer className="ds-tabela-pontos-rodape">
                    <i className="fas fa-circle-info" aria-hidden="true" />
                    <span>Os pontos exibidos são referentes a cada peça concluída.</span>
                </footer>
            </section>
        </div>,
        document.body,
    );
}
