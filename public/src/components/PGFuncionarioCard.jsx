import React from 'react';
import PGComparacaoBadge from './PGComparacaoBadge.jsx';
import PGMetaTimeline from './PGMetaTimeline.jsx';

const STATUS_CONFIG = {
    PRODUZINDO:      { label: 'Produzindo', cor: '#3498db' },
    LIVRE:           { label: 'Livre',      cor: '#27ae60' },
    LIVRE_MANUAL:    { label: 'Livre',      cor: '#27ae60' },
    ALMOCO:          { label: 'Almoço',     cor: '#f39c12' },
    PAUSA:           { label: 'Pausa',      cor: '#f39c12' },
    PAUSA_MANUAL:    { label: 'Pausa',      cor: '#f39c12' },
    FORA_DO_HORARIO: { label: 'Fora',       cor: '#95a5a6' },
    FALTOU:          { label: 'Faltou',     cor: '#e74c3c' },
    ALOCADO_EXTERNO: { label: 'Externo',    cor: '#8e44ad' },
};

function proximaMeta(pts, bronze, prata, ouro) {
    if (!bronze || !prata || !ouro) return null;
    if (pts >= ouro)   return { valor: ouro,   label: '🥇 ouro' };
    if (pts >= prata)  return { valor: ouro,   label: '🥇 ouro' };
    if (pts >= bronze) return { valor: prata,  label: '🥈 prata' };
    return              { valor: bronze, label: '🥉 bronze' };
}

function PGFuncionarioCard({ funcionario: f, posicao, onSelecionar, filtroDia, todasMetas, isHoje }) {
    const foto = f.foto_oficial || f.avatar_url;
    const status = STATUS_CONFIG[f.status_atual] || { label: f.status_atual || '–', cor: '#95a5a6' };
    const tipos = Array.isArray(f.tipos) ? f.tipos : [];
    const tipoLabel = tipos.includes('tiktik') ? 'Tiktik' : 'Costureira';

    const tipoPrimario = (tipos[0] || 'costureira').toLowerCase();
    const metas = todasMetas?.[tipoPrimario]?.[f.nivel] || [];
    const [metaBronze, metaPrata, metaOuro] = metas;

    const pts = f.pontos_hoje || 0;
    const proxMeta = proximaMeta(pts, metaBronze, metaPrata, metaOuro);

    return (
        <div className="pg-func-card" onClick={() => onSelecionar(f.id)}>
            <div className="pg-func-topo">
                <span className="pg-func-posicao">#{posicao}</span>
                <div className="pg-func-foto-wrap">
                    {foto
                        ? <img className="pg-func-foto" src={foto} alt={f.nome} />
                        : <div className="pg-func-foto pg-func-foto--sem-foto"><i className="fas fa-user"></i></div>
                    }
                </div>
                <div className="pg-func-identidade">
                    <span className="pg-func-nome">{f.nome}</span>
                    <span className="pg-func-sub">{tipoLabel} · Nv.{f.nivel}</span>
                </div>
                {isHoje && (
                    <span className="pg-func-status-badge" style={{ backgroundColor: status.cor }}>
                        {status.label}
                    </span>
                )}
            </div>

            <div className="pg-func-corpo">
                <div className="pg-func-pontos-linha">
                    <span className="pg-func-pontos">{pts.toFixed(0)} pts</span>
                    {proxMeta ? (
                        <span className="pg-func-meta">/ {proxMeta.valor} {proxMeta.label}</span>
                    ) : f.meta_pontos > 0 && (
                        <span className="pg-func-meta">/ {f.meta_pontos} meta</span>
                    )}
                    {filtroDia && (
                        <PGComparacaoBadge valorHoje={f.pontos_hoje} valorOntem={f.pontos_ontem} visivel={true} />
                    )}
                </div>
                <span className="pg-func-pecas">{f.pecas_hoje || 0} processos</span>

                {metaBronze && metaPrata && metaOuro ? (
                    <PGMetaTimeline
                        pontosAtuais={f.pontos_hoje || 0}
                        metaBronze={metaBronze}
                        metaPrata={metaPrata}
                        metaOuro={metaOuro}
                    />
                ) : f.meta_pontos > 0 && (
                    <div className="pg-func-barra-bg">
                        <div
                            className="pg-func-barra-fill"
                            style={{
                                width: `${Math.min(f.pct_meta || 0, 100)}%`,
                                backgroundColor: f.pct_meta >= 100 ? '#f59e0b' : '#3b82f6',
                            }}
                        ></div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default PGFuncionarioCard;
