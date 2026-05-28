import React, { useState } from 'react';

function formatarDataCard(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} · ${hh}:${mi}`;
}

function getIniciais(nome) {
    if (!nome) return '?';
    const partes = nome.trim().split(/\s+/);
    if (partes.length === 1) return partes[0].substring(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export default function GPCard({
    producao: p,
    podeEditar,
    podeExcluirDireto,
    podeSolicitar,
    temPendente,
    isFreelance,
    onEditar,
    onExcluir,
    onSolicitarExclusao,
}) {
    const [imgError, setImgError] = useState(false);

    const pontos     = Number(p.pontos_gerados || 0);
    const mostrarPts = pontos > 0;

    // Foto do funcionário: avatar_url preferido (exceto .jfif), fallback foto_oficial
    const fotoFuncionario = (p.avatar_url && !p.avatar_url.includes('image.jfif'))
        ? p.avatar_url
        : p.foto_oficial || null;

    return (
        <div className="gp-card">
            {/* Coluna A — Funcionário */}
            <div className="gp-card-col-a">
                <div
                    className={`gp-avatar${isFreelance ? ' gp-avatar--freelance' : ''}${fotoFuncionario ? ' gp-avatar--foto' : ''}`}
                    style={fotoFuncionario ? { backgroundImage: `url('${fotoFuncionario}')` } : {}}
                >
                    {!fotoFuncionario && getIniciais(p.funcionario)}
                </div>
                <span className="gp-avatar-nome">{p.funcionario || '—'}</span>
            </div>

            {/* Coluna Variante — Produto/Variação */}
            <div className="gp-card-col-variante">
                <span className="gp-variante-label">Variante</span>
                <div className="gp-variante-foto">
                    {p.variacao_imagem && !imgError ? (
                        <img
                            src={p.variacao_imagem}
                            alt={p.variacao || ''}
                            className="gp-variante-img"
                            onError={() => setImgError(true)}
                        />
                    ) : (
                        <div className="gp-variante-placeholder">
                            <i className="fas fa-image"></i>
                        </div>
                    )}
                </div>
                <span className="gp-variante-nome">{p.variacao || '—'}</span>
            </div>

            {/* Coluna B — Conteúdo */}
            <div className="gp-card-col-b">
                <div className="gp-card-linha1">
                    <span className="gp-op-numero">OP {p.op_numero || '—'}</span>
                    <span className="gp-data-hora">
                        {formatarDataCard(p.data)}
                        {p.edicoes > 0 && <span className="gp-edicao-badge"> (E{p.edicoes}x)</span>}
                    </span>
                </div>

                <div className="gp-card-linha2">
                    <i className="fas fa-wrench"></i>
                    <span>{p.processo}</span>
                    <i className="fas fa-arrow-right gp-seta-proc"></i>
                    <span>{p.maquina}</span>
                </div>

                <div className="gp-card-linha3">
                    <div className="gp-metrica-grid">
                        <div className="gp-metrica">
                            <span className="gp-metrica-label">QUANTIDADE</span>
                            <span className="gp-metrica-valor">
                                {p.quantidade} <span className="gp-metrica-unit">un</span>
                            </span>
                        </div>
                        <div className="gp-metrica">
                            <span className="gp-metrica-label">PONTOS</span>
                            <span className={`gp-metrica-valor${!mostrarPts ? ' gp-metrica-zero' : ''}`}>
                                {mostrarPts ? pontos.toFixed(2) : '—'}
                            </span>
                        </div>
                        {p.lancado_por && (
                            <div className="gp-retirado-por">
                                <span className="gp-retirado-label">RETIRADO POR</span>
                                <span className="gp-retirado-nome">{p.lancado_por}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Coluna C — Ações */}
            <div className="gp-card-col-c">
                {podeEditar && (
                    <button className="gp-btn-card gp-btn-card-editar" onClick={() => onEditar(p)}>
                        <i className="fas fa-edit"></i> Editar
                    </button>
                )}

                {podeExcluirDireto && !temPendente && (
                    <button className="gp-btn-card gp-btn-card-excluir" onClick={() => onExcluir(p)}>
                        <i className="fas fa-trash-alt"></i> Excluir
                    </button>
                )}

                {!podeExcluirDireto && podeSolicitar && !temPendente && (
                    <button className="gp-btn-card gp-btn-card-solicitar" onClick={() => onSolicitarExclusao(p)}>
                        <i className="fas fa-paper-plane"></i> Solicitar exclusão
                    </button>
                )}

                {(podeExcluirDireto || podeSolicitar) && temPendente && (
                    <span className="gp-pendente-card" title="Exclusão aguardando aprovação">
                        <i className="fas fa-hourglass-half"></i> Aguardando
                    </span>
                )}

                {!podeEditar && !podeExcluirDireto && !podeSolicitar && (
                    <span className="gp-sem-acoes">—</span>
                )}
            </div>
        </div>
    );
}
