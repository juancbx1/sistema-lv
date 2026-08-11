import React, { useMemo } from 'react';
import PGComparacaoBadge from './PGComparacaoBadge.jsx';
import PGTimeline from './PGTimeline.jsx';

function fmtHora(isoStr) {
    if (!isoStr) return '–';
    return new Date(isoStr).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    });
}

function fmtPontosIndividuais(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

function PGFuncionarioModal({ funcionario: f, atividades, onFechar }) {
    const foto = f.foto_oficial || f.avatar_url;
    const tipos = Array.isArray(f.tipos) ? f.tipos : [];
    const tipoLabel = tipos.includes('tiktik') ? 'Tiktik' : 'Costureira';

    const porProduto = useMemo(() => {
        const map = new Map();
        for (const a of atividades) {
            const chave = `${a.nome_produto}__${a.processo}__${a.variacao || ''}`;
            const atual = map.get(chave) || {
                nome_produto: a.nome_produto,
                processo: a.processo,
                variacao: a.variacao,
                imagem_url: a.imagem_url,
                quantidade: 0,
                pontos: 0,
            };
            atual.quantidade += a.quantidade;
            atual.pontos     += a.pontos_gerados;
            map.set(chave, atual);
        }
        return [...map.values()].sort((a, b) => b.pontos - a.pontos);
    }, [atividades]);

    return (
        <div className="pg-modal-overlay" onClick={e => e.target === e.currentTarget && onFechar()}>
            <div className="pg-modal-conteudo">

                {/* Header */}
                <div className="pg-modal-header">
                    <div className="pg-modal-identidade">
                        {foto
                            ? <img className="pg-modal-foto" src={foto} alt={f.nome} />
                            : <div className="pg-modal-foto pg-modal-foto--vazia"><i className="fas fa-user"></i></div>
                        }
                        <div>
                            <h2 className="pg-modal-nome">{f.nome}</h2>
                            <span className="pg-modal-sub">{tipoLabel} · Nível {f.nivel}</span>
                        </div>
                    </div>
                    <button className="pg-modal-fechar" onClick={onFechar} aria-label="Fechar">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* Bloco 1 — Resumo do dia */}
                <div className="pg-modal-bloco">
                    <div className="pg-modal-resumo-grid">
                        <div className="pg-modal-resumo-item">
                            <span className="pg-modal-resumo-val">{f.pecas_hoje || 0}</span>
                            <span className="pg-modal-resumo-label">peças</span>
                        </div>
                        <div className="pg-modal-resumo-item">
                            <span className="pg-modal-resumo-val">{(f.pontos_hoje || 0).toFixed(0)}</span>
                            <span className="pg-modal-resumo-label">pontos</span>
                        </div>
                        <div className="pg-modal-resumo-item">
                            <span
                                className="pg-modal-resumo-val"
                                style={{ color: (f.pct_meta || 0) >= 100 ? '#27ae60' : '#333' }}
                            >
                                {(f.pct_meta || 0).toFixed(0)}%
                            </span>
                            <span className="pg-modal-resumo-label">da meta</span>
                        </div>
                    </div>
                    <div className="pg-modal-horarios">
                        <span><i className="fas fa-clock" style={{ marginRight: 4 }}></i>Início: {fmtHora(f.primeiro_lancamento)}</span>
                        <span>Último: {fmtHora(f.ultimo_lancamento)}</span>
                    </div>
                </div>

                {/* Bloco 2 — Comparação com ontem */}
                {f.pontos_ontem > 0 && (
                    <div className="pg-modal-bloco">
                        <h4 className="pg-modal-bloco-titulo">Comparação com ontem</h4>
                        <div className="pg-modal-comp-grid">
                            <div className="pg-modal-comp-col pg-modal-comp-col--hoje">
                                <span className="pg-modal-comp-label">Hoje</span>
                                <span className="pg-modal-comp-val">{(f.pontos_hoje || 0).toFixed(0)} pts</span>
                                <span className="pg-modal-comp-pecas">{f.pecas_hoje || 0} peças</span>
                            </div>
                            <div className="pg-modal-comp-seta">
                                <PGComparacaoBadge valorHoje={f.pontos_hoje} valorOntem={f.pontos_ontem} visivel={true} />
                            </div>
                            <div className="pg-modal-comp-col">
                                <span className="pg-modal-comp-label">Ontem</span>
                                <span className="pg-modal-comp-val">{(f.pontos_ontem || 0).toFixed(0)} pts</span>
                                <span className="pg-modal-comp-pecas">{f.pecas_ontem || 0} peças</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Bloco 3 — Produção por hora */}
                {atividades.length > 0 && (
                    <div className="pg-modal-bloco">
                        <h4 className="pg-modal-bloco-titulo">Produção por hora</h4>
                        <PGTimeline atividades={atividades} metaPontos={f.meta_pontos} />
                    </div>
                )}

                {/* Bloco 4 — Produção por produto */}
                {porProduto.length > 0 && (
                    <div className="pg-modal-bloco">
                        <h4 className="pg-modal-bloco-titulo">Produção detalhada</h4>
                        <div className="pg-modal-lista-produtos">
                            {porProduto.map((p, i) => (
                                <div key={i} className="pg-modal-prod-item">
                                    {p.imagem_url && (
                                        <img className="pg-modal-prod-img" src={p.imagem_url} alt={p.nome_produto} />
                                    )}
                                    <div className="pg-modal-prod-info">
                                        <span className="pg-modal-prod-nome">{p.nome_produto}</span>
                                        <span className="pg-modal-prod-proc">
                                            {p.processo}{p.variacao ? ` · ${p.variacao}` : ''}
                                        </span>
                                    </div>
                                    <div className="pg-modal-prod-nums">
                                        <span>{p.quantidade} pçs</span>
                                        <span className="pg-modal-prod-pts">{fmtPontosIndividuais(p.pontos)} pts</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}

export default PGFuncionarioModal;
