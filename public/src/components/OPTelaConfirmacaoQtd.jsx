// public/src/components/OPTelaConfirmacaoQtd.jsx

import React, { useState, useEffect } from 'react';
import { mostrarMensagem } from '/js/utils/popups.js';
import { obterProdutos as obterProdutosDoStorage } from '/js/utils/storage.js';
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio';

/**
 * Calcula se atribuir `qtd` peças deste item vai ultrapassar o horário de saída (S3).
 * Retorna null se tudo estiver ok ou se não houver dados suficientes.
 * @returns {{ excedenteMin: number, terminoEstimado: string, s3Formatado: string } | null}
 */
function calcularAvisoHorario(item, qtd, funcionario, tpp) {
    const s3Str = funcionario?.horario_saida_3 || funcionario?.horario_saida_2 || funcionario?.horario_saida_1;
    if (!s3Str) return null;

    const chave = `${item.produto_id}-${item.processo}`;
    const tppSegundos = tpp?.[chave];
    if (!tppSegundos || !qtd || qtd <= 0) return null;

    const estimadoMin = Math.ceil((tppSegundos * qtd) / 60);

    const agora = new Date();
    const horaAtualStr = agora.toLocaleTimeString('en-GB', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
    });
    const [ah, am] = horaAtualStr.split(':').map(Number);
    const [s3h, s3m] = String(s3Str).substring(0, 5).split(':').map(Number);

    const agoraMin = ah * 60 + am;
    const s3Min = s3h * 60 + s3m;
    const terminoEstimadoMin = agoraMin + estimadoMin;

    if (terminoEstimadoMin <= s3Min) return null;

    const excedenteMin = terminoEstimadoMin - s3Min;
    const terminoHH = String(Math.floor(terminoEstimadoMin / 60) % 24).padStart(2, '0');
    const terminoMM = String(terminoEstimadoMin % 60).padStart(2, '0');

    return {
        excedenteMin,
        terminoEstimado: `${terminoHH}:${terminoMM}`,
        s3Formatado: String(s3Str).substring(0, 5),
    };
}

function obterChaveItemConfirmacao(item) {
    return [
        item.produto_id,
        item.variante || '-',
        item.fase || 'OP',
        item.etapa_id || item.processo_id || item.processo,
        item.origem_ops?.join(',') || item.opNumero || '',
    ].join('-');
}

export default function OPTelaConfirmacaoQtd({ etapa, funcionario, onClose, tpp, modoHoraExtra }) {
    const itensLote = Array.isArray(etapa) ? etapa : [etapa];

    const [quantidades, setQuantidades] = useState({});
    const [carregando, setCarregando] = useState(false);
    const [mapaImagens, setMapaImagens] = useState({});
    const [mapaEtapas, setMapaEtapas] = useState({});

    useEffect(() => {
        async function carregarDados() {
            try {
                const todosProdutos = await obterProdutosDoStorage();
                const novoMapaImagens = {};
                const novoMapaEtapas = {};

                itensLote.forEach(item => {
                    const chave = `${item.produto_id}-${item.variante}`;
                    const produto = todosProdutos.find(p => p.id === item.produto_id);

                    let img = '/img/placeholder-image.png';
                    if (produto) {
                        img = produto.imagem;
                        if (item.variante && produto.grade) {
                            const varObj = produto.grade.find(g => g.variacao === item.variante);
                            if (varObj && varObj.imagem) img = varObj.imagem;
                        }
                    }
                    novoMapaImagens[chave] = img;

                    // Detectar se é etapa final
                    const processoLower = item.processo.toLowerCase();
                    if (processoLower === 'corte') {
                        novoMapaEtapas[chave] = { bordaClasse: 'borda-corte', isFinal: false };
                    } else if (produto?.etapas) {
                        const index = produto.etapas.findIndex(e => (e.processo || e) === item.processo);
                        const isFinal = index === produto.etapas.length - 1;
                        novoMapaEtapas[chave] = {
                            bordaClasse: isFinal ? 'borda-etapa-final' : 'borda-etapa-normal',
                            isFinal
                        };
                    } else {
                        novoMapaEtapas[chave] = { bordaClasse: 'borda-etapa-normal', isFinal: false };
                    }
                });

                setMapaImagens(novoMapaImagens);
                setMapaEtapas(novoMapaEtapas);
            } catch (error) {
                console.error("Erro ao carregar dados de confirmação:", error);
            }
        }
        carregarDados();
    }, [etapa]);

    useEffect(() => {
        const inits = {};
        itensLote.forEach(item => {
            const key = obterChaveItemConfirmacao(item);
            inits[key] = item.quantidade_disponivel;
        });
        setQuantidades(inits);
    }, [etapa]);

    const handleQtdChange = (key, valor, max) => {
        const num = parseInt(valor);
        if (valor === '' || (!isNaN(num) && num >= 0 && num <= max)) {
            setQuantidades(prev => ({ ...prev, [key]: valor }));
        }
    };

    const ajustarQuantidade = (key, delta, max) => {
        setQuantidades(prev => {
            const atual = parseInt(prev[key]) || 0;
            const novo = Math.max(0, Math.min(max, atual + delta));
            return { ...prev, [key]: novo };
        });
    };

    const definirMaximo = (key, max) => {
        setQuantidades(prev => ({ ...prev, [key]: max }));
    };

    const podeConfirmar = temPermissao('confirmar-lancamento');

    const handleConfirmar = async () => {
        setCarregando(true);
        try {
            const token = localStorage.getItem('token');

            const payloadItens = itensLote.map(item => {
                const key = obterChaveItemConfirmacao(item);
                const qtd = parseInt(quantidades[key]);
                if (!qtd || qtd <= 0) return null;
                return {
                    opNumero: item.origem_ops[0],
                    produto_id: item.produto_id,
                    variante: item.variante || '-',
                    processo: item.processo,
                    fase: item.fase || 'OP',
                    processo_id: item.processo_id || null,
                    etapa_id: item.etapa_id || null,
                    quantidade: qtd,
                    ...(item.fase === 'POS_OP' && Array.isArray(item.origens_pos_op)
                        ? { origens_pos_op: item.origens_pos_op }
                        : {}),
                    ...(item._unificada && { etapas_unificadas: item._grupo_unificacao.etapas }),
                };
            }).filter(i => i !== null);

            if (payloadItens.length === 0) throw new Error("Defina pelo menos uma quantidade válida.");

            const response = await fetch('/api/producoes/lote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    itens: payloadItens,
                    funcionario_id: funcionario.id,
                    funcionario_nome: funcionario.nome
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || "Erro ao atribuir lote.");
            }

            mostrarMensagem(`Sucesso! ${payloadItens.length} tarefa${payloadItens.length !== 1 ? 's' : ''} atribuída${payloadItens.length !== 1 ? 's' : ''}.`, 'sucesso');

            if (modoHoraExtra) {
                const primeiroItem = payloadItens[0];
                fetch('/api/alertas/hora-extra', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: JSON.stringify({
                        funcionario_id: funcionario.id,
                        funcionario_nome: funcionario.nome,
                        produto_nome: primeiroItem ? itensLote.find(i => i.produto_id === primeiroItem.produto_id)?.produto_nome || '' : '',
                        processo: primeiroItem?.processo || '',
                        quantidade: primeiroItem ? (parseInt(quantidades[obterChaveItemConfirmacao(primeiroItem)]) || 0) : 0,
                    })
                }).catch(() => {});
            }

            onClose();
        } catch (err) {
            mostrarMensagem(err.message, 'erro');
        } finally {
            setCarregando(false);
        }
    };

    const textoBotao = itensLote.length === 1
        ? 'Confirmar 1 Tarefa'
        : `Confirmar ${itensLote.length} Tarefas`;

    const fasesLote = [...new Set(itensLote.map(item => item?.fase === 'POS_OP' ? 'POS_OP' : 'OP'))];
    const loteSomentePosOp = fasesLote.length === 1 && fasesLote[0] === 'POS_OP';
    const quantidadeTotalDisponivel = itensLote.reduce(
        (total, item) => total + (parseInt(item?.quantidade_disponivel, 10) || 0),
        0,
    );
    const quantidadeTotalSelecionada = itensLote.reduce((total, item) => {
        const key = obterChaveItemConfirmacao(item);
        return total + (parseInt(quantidades[key], 10) || 0);
    }, 0);

    return (
        <div className="op-confirmacao-container">

            <div className={`op-confirmacao-resumo ${loteSomentePosOp ? 'op-confirmacao-resumo--pos-op' : ''}`}>
                <div className="op-confirmacao-resumo-titulo">
                    <span className="op-selecao-eyebrow">Conferência do lote</span>
                    <strong>{itensLote.length === 1 ? '1 tarefa selecionada' : `${itensLote.length} tarefas selecionadas`}</strong>
                </div>
                <div className="op-confirmacao-resumo-dados">
                    <span className="op-confirmacao-resumo-chip">
                        <i className={`fas ${loteSomentePosOp ? 'fa-box-open' : fasesLote.length > 1 ? 'fa-layer-group' : 'fa-gears'}`}></i>
                        {loteSomentePosOp ? 'Arremate pós-OP' : fasesLote.length > 1 ? 'Produção + pós-OP' : 'Produção da OP'}
                    </span>
                    <span className="op-confirmacao-resumo-efeito">
                        <i className={`fas ${loteSomentePosOp ? 'fa-box-open' : 'fa-arrow-right'}`}></i>
                        {loteSomentePosOp ? 'Libera para embalagem' : fasesLote.length > 1 ? 'Confira a fase de cada item' : 'Continua na OP'}
                    </span>
                    <span className="op-confirmacao-resumo-qtd">
                        <strong>{quantidadeTotalSelecionada}</strong> de {quantidadeTotalDisponivel} pcs
                    </span>
                </div>
            </div>

            <div className="op-confirmacao-lista">
                {itensLote.map((item, idx) => {
                    const key = obterChaveItemConfirmacao(item);
                    const chaveImagem = `${item.produto_id}-${item.variante}`;
                    const qtd = quantidades[key] !== undefined ? quantidades[key] : item.quantidade_disponivel;
                    const imgUrl = mapaImagens[chaveImagem] || '/img/placeholder-image.png';
                    const etapaInfo = mapaEtapas[chaveImagem] || { bordaClasse: 'borda-etapa-normal' };

                    return (
                        <div key={idx} className="op-item-confirmacao-card">
                            <div className={`card-borda-charme ${etapaInfo.bordaClasse}`}></div>

                            <div className="item-info-visual">
                                <img src={imgUrl} alt={item.produto_nome} />
                                <div>
                                    <h4>{item.produto_nome}</h4>
                                    <p className="variante">{item.variante}</p>
                                    {item._unificada && item._grupo_unificacao?.etapas ? (
                                        <div className="op-confirmacao-processos-unif">
                                            {item._grupo_unificacao.etapas.map((e, i) => (
                                                <React.Fragment key={e.processo}>
                                                    <span className="op-confirmacao-etapa-chip">{e.processo}</span>
                                                    {i < item._grupo_unificacao.etapas.length - 1 && (
                                                        <i className="fas fa-arrow-right op-confirmacao-unif-seta"></i>
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    ) : (
                                        <>
                                            {item.fase === 'POS_OP' && (
                                                <span className="op-confirmacao-fase-pos-op">Arremate pós-OP</span>
                                            )}
                                            <p className="processo">{item.processo}</p>
                                        </>
                                    )}
                                    <div className={`op-confirmacao-fluxo ${item.fase === 'POS_OP' ? 'op-confirmacao-fluxo--pos-op' : ''}`}>
                                        <span>
                                            <i className={`fas ${item.fase === 'POS_OP' ? 'fa-box-open' : 'fa-arrow-right'}`}></i>
                                            {item.fase === 'POS_OP' ? 'Libera para embalagem' : 'Continua na OP'}
                                        </span>
                                    </div>
                                    {item.origem_ops?.length > 0 && (
                                        <p className="op-confirmacao-op-link">
                                            <i className="fas fa-link"></i>
                                            {' OP #'}{item.origem_ops.slice(0, 2).join(' • #')}{item.origem_ops.length > 2 ? ` +${item.origem_ops.length - 2}` : ''}
                                        </p>
                                    )}
                                    {item.origens_pos_op?.length > 1 && (
                                        <p className="op-confirmacao-origens-consolidadas">
                                            <i className="fas fa-layer-group"></i>
                                            {item.origens_pos_op.length} OPs agrupadas por produto, variante e etapa
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="item-controles-qtd">
                                <div className="qtd-display-linha">
                                    <button className="btn-ajuste mini" onClick={() => ajustarQuantidade(key, -1, item.quantidade_disponivel)}>-</button>
                                    <input
                                        type="number"
                                        value={qtd}
                                        onChange={(e) => handleQtdChange(key, e.target.value, item.quantidade_disponivel)}
                                    />
                                    <button className="btn-ajuste mini" onClick={() => ajustarQuantidade(key, 1, item.quantidade_disponivel)}>+</button>
                                </div>
                                <div className="qtd-atalhos-linha">
                                    <button onClick={() => ajustarQuantidade(key, 10, item.quantidade_disponivel)}>+10</button>
                                    <button className="btn-max" onClick={() => definirMaximo(key, item.quantidade_disponivel)}>
                                        Max ({item.quantidade_disponivel})
                                    </button>
                                </div>
                                {(() => {
                                    const aviso = calcularAvisoHorario(item, parseInt(qtd) || 0, funcionario, tpp);
                                    if (!aviso) return null;
                                    return (
                                        <div className="op-atrib-aviso-horario">
                                            ⚠️ Estimativa: término às {aviso.terminoEstimado}
                                            <br />
                                            <small>Saída prevista: {aviso.s3Formatado} — {aviso.excedenteMin}min além do horário</small>
                                        </div>
                                    );
                                })()}
                            </div>

                            {item._unificada && item._grupo_unificacao?.etapas && (
                                <div className="op-confirmacao-unif-detalhe">
                                    <div className="op-confirmacao-unif-titulo">
                                        <i className="fas fa-link"></i> {item._grupo_unificacao.etapas.length} etapas — registradas juntas
                                    </div>
                                    {item._grupo_unificacao.etapas.map((e, i) => {
                                        const isLast = i === item._grupo_unificacao.etapas.length - 1;
                                        return (
                                            <div key={e.processo} className="op-confirmacao-unif-item">
                                                <span className="op-confirmacao-unif-step-label">
                                                    {isLast ? 'Etapa Final' : `Etapa ${e.etapa_index + 1}`}
                                                </span>
                                                <span className="op-confirmacao-etapa-chip">{e.processo}</span>
                                                {e.maquina && e.maquina !== 'Não Definida' && (
                                                    <span className="op-confirmacao-unif-maquina">
                                                        <i className="fas fa-cog"></i> {e.maquina}
                                                    </span>
                                                )}
                                                <span className="op-confirmacao-unif-qtd-label">
                                                    {parseInt(qtd) || 0} pçs
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <button
                className={`op-selecao-fab${!podeConfirmar ? ' op-selecao-fab--bloqueado' : ''}`}
                onClick={() => {
                    if (!podeConfirmar) {
                        mostrarPopupSemPermissao('Você não tem permissão para confirmar lançamentos de produção.');
                        return;
                    }
                    handleConfirmar();
                }}
                disabled={carregando}
            >
                {carregando
                    ? <><div className="spinner-btn-interno"></div> Processando...</>
                    : !podeConfirmar
                        ? <><i className="fas fa-lock"></i> Sem permissão</>
                        : <><i className="fas fa-check-double"></i> {textoBotao}</>
                }
            </button>

        </div>
    );
}
