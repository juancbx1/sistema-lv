// public/src/components/OPTelaConfirmacaoQtd.jsx

import React, { useEffect, useMemo, useState } from 'react';
import { mostrarMensagem } from '/js/utils/popups.js';
import { obterProdutos as obterProdutosDoStorage } from '/js/utils/storage.js';
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio';
import { obterChaveTarefa } from '../utils/op-tarefas';

function calcularAvisoHorario(item, qtd, funcionario, tpp) {
    const s3Str = funcionario?.horario_saida_3 || funcionario?.horario_saida_2 || funcionario?.horario_saida_1;
    if (!s3Str) return null;

    const chave = `${item.produto_id}-${item.processo}`;
    const tppSegundos = tpp?.[chave];
    if (!tppSegundos || !qtd || qtd <= 0) return null;

    const estimadoMin = Math.ceil((tppSegundos * qtd) / 60);
    const agora = new Date();
    const horaAtualStr = agora.toLocaleTimeString('en-GB', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    });
    const [ah, am] = horaAtualStr.split(':').map(Number);
    const [s3h, s3m] = String(s3Str).substring(0, 5).split(':').map(Number);
    const terminoEstimadoMin = (ah * 60 + am) + estimadoMin;
    const s3Min = s3h * 60 + s3m;
    if (terminoEstimadoMin <= s3Min) return null;

    return {
        excedenteMin: terminoEstimadoMin - s3Min,
        terminoEstimado: `${String(Math.floor(terminoEstimadoMin / 60) % 24).padStart(2, '0')}:${String(terminoEstimadoMin % 60).padStart(2, '0')}`,
        s3Formatado: String(s3Str).substring(0, 5),
    };
}

function obterEtapasOp(produto) {
    if (Array.isArray(produto?.etapasCanonicas)) {
        return produto.etapasCanonicas.filter(etapa => etapa?.fase === 'OP');
    }
    return Array.isArray(produto?.etapas) ? produto.etapas : [];
}

function formatarOps(origens = []) {
    if (!origens.length) return null;
    return `OP #${origens.slice(0, 2).join(' • #')}${origens.length > 2 ? ` +${origens.length - 2}` : ''}`;
}

function formatarPecas(quantidade) {
    const numero = parseInt(quantidade, 10) || 0;
    return `${numero} ${numero === 1 ? 'pç' : 'pçs'}`;
}

export default function OPTelaConfirmacaoQtd({ etapa, funcionario, onClose, onVoltarTarefa, tpp, modoHoraExtra, onConfirmarLote }) {
    const itensLote = useMemo(() => (Array.isArray(etapa) ? etapa : [etapa]), [etapa]);
    const [quantidades, setQuantidades] = useState({});
    const [carregando, setCarregando] = useState(false);
    const [metadados, setMetadados] = useState({});
    const [itensRemovendo, setItensRemovendo] = useState(() => new Set());

    useEffect(() => {
        async function carregarDados() {
            try {
                const todosProdutos = await obterProdutosDoStorage();
                const novosMetadados = {};
                itensLote.forEach(item => {
                    const key = obterChaveTarefa(item);
                    const produto = todosProdutos.find(produtoItem => String(produtoItem.id) === String(item.produto_id));
                    let imagem = produto?.imagem || '/img/placeholder-image.png';
                    if (item.variante && Array.isArray(produto?.grade)) {
                        const variacao = produto.grade.find(gradeItem => gradeItem.variacao === item.variante);
                        if (variacao?.imagem) imagem = variacao.imagem;
                    }
                    const etapasOp = obterEtapasOp(produto);
                    const indiceEtapa = etapasOp.findIndex(etapaProduto => {
                        if (item.etapa_id && etapaProduto?.id) return String(item.etapa_id) === String(etapaProduto.id);
                        if (item.processo_id && etapaProduto?.processo_id) return String(item.processo_id) === String(etapaProduto.processo_id);
                        return (etapaProduto?.processo || etapaProduto) === item.processo;
                    });
                    novosMetadados[key] = {
                        imagem,
                        produtoNome: produto?.nome || item.produto_nome,
                        indiceEtapa,
                        totalEtapas: etapasOp.length,
                        isFinal: indiceEtapa >= 0 && indiceEtapa === etapasOp.length - 1,
                    };
                });
                setMetadados(novosMetadados);
            } catch (error) {
                console.error('Erro ao carregar dados de confirmação:', error);
            }
        }
        void carregarDados();
    }, [itensLote]);

    useEffect(() => {
        const valoresIniciais = {};
        itensLote.forEach(item => {
            valoresIniciais[obterChaveTarefa(item)] = item.quantidade_disponivel;
        });
        setQuantidades(valoresIniciais);
    }, [itensLote]);

    const voltarTarefa = (item) => {
        const key = obterChaveTarefa(item);
        if (itensLote.length <= 1) {
            onVoltarTarefa(item);
            return;
        }
        setItensRemovendo(prev => new Set([...prev, key]));
        window.setTimeout(() => onVoltarTarefa(item), 260);
    };

    const handleQtdChange = (key, valor, max) => {
        const numero = parseInt(valor, 10);
        if (valor === '' || (!Number.isNaN(numero) && numero >= 0 && numero <= Number(max))) {
            setQuantidades(prev => ({ ...prev, [key]: valor }));
        }
    };

    const ajustarQuantidade = (key, delta, max) => {
        setQuantidades(prev => {
            const atual = parseInt(prev[key], 10) || 0;
            return { ...prev, [key]: Math.max(0, Math.min(Number(max), atual + delta)) };
        });
    };

    const definirMaximo = (key, max) => {
        setQuantidades(prev => ({ ...prev, [key]: Number(max) }));
    };

    const itensPorFase = useMemo(() => ({
        OP: itensLote.filter(item => item?.fase !== 'POS_OP'),
        POS_OP: itensLote.filter(item => item?.fase === 'POS_OP'),
    }), [itensLote]);

    const podeConfirmar = temPermissao('confirmar-lancamento');

    const handleConfirmar = async () => {
        setCarregando(true);
        try {
            const token = localStorage.getItem('token');
            const payloadItens = itensLote.map(item => {
                const key = obterChaveTarefa(item);
                const quantidade = parseInt(quantidades[key], 10);
                if (!quantidade || quantidade <= 0) return null;
                return {
                    opNumero: item.origem_ops?.[0],
                    origem_ops: item.origem_ops || [],
                    produto_id: item.produto_id,
                    variante: item.variante || '-',
                    processo: item.processo,
                    fase: item.fase || 'OP',
                    processo_id: item.processo_id || null,
                    etapa_id: item.etapa_id || null,
                    quantidade,
                    ...(item.fase === 'POS_OP' && Array.isArray(item.origens_pos_op)
                        ? { origens_pos_op: item.origens_pos_op }
                        : {}),
                    ...(item._unificada && { etapas_unificadas: item._grupo_unificacao.etapas }),
                };
            }).filter(Boolean);

            if (payloadItens.length === 0) throw new Error('Defina pelo menos uma quantidade válida.');
            if (onConfirmarLote) {
                await onConfirmarLote(payloadItens);
                onClose();
                return;
            }

            const response = await fetch('/api/producoes/lote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    itens: payloadItens,
                    funcionario_id: funcionario.id,
                    funcionario_nome: funcionario.nome,
                }),
            });
            if (!response.ok) {
                const erro = await response.json();
                throw new Error(erro.error || 'Erro ao atribuir lote.');
            }

            mostrarMensagem(`Sucesso! ${payloadItens.length} tarefa${payloadItens.length !== 1 ? 's' : ''} atribuída${payloadItens.length !== 1 ? 's' : ''}.`, 'sucesso');
            if (modoHoraExtra) {
                const primeiroItem = payloadItens[0];
                fetch('/api/alertas/hora-extra', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                        funcionario_id: funcionario.id,
                        funcionario_nome: funcionario.nome,
                        produto_nome: itensLote.find(item => item.produto_id === primeiroItem.produto_id)?.produto_nome || '',
                        processo: primeiroItem.processo,
                        quantidade: primeiroItem.quantidade,
                    }),
                }).catch(() => {});
            }
            onClose();
        } catch (error) {
            mostrarMensagem(error.message, 'erro');
        } finally {
            setCarregando(false);
        }
    };

    const textoBotao = itensLote.length === 1
        ? 'Confirmar 1 tarefa'
        : `Confirmar ${itensLote.length} tarefas`;
    const loteMisto = itensPorFase.OP.length > 0 && itensPorFase.POS_OP.length > 0;
    return (
        <div className="op-confirmacao-container op-confirmacao-v4">
            <div className="op-confirmacao-v4__resumo">
                <div>
                    <span className="op-confirmacao-v4__eyebrow">Quantidades por fase</span>
                    <strong>{itensLote.length} tarefa{itensLote.length === 1 ? '' : 's'} selecionada{itensLote.length === 1 ? '' : 's'}</strong>
                    <p>{loteMisto
                        ? 'Processos da OP e arremates permanecem separados para evitar confusão.'
                        : 'Revise a quantidade antes de colocar o trabalho na jornada.'}</p>
                </div>
                <div className="op-confirmacao-v4__resumo-pills">
                    {itensPorFase.OP.length > 0 && <span className="op-confirmacao-v4__pill op"><i className="fas fa-gears"></i>{itensPorFase.OP.length} OP</span>}
                    {itensPorFase.POS_OP.length > 0 && <span className="op-confirmacao-v4__pill pos-op"><i className="fas fa-box-open"></i>{itensPorFase.POS_OP.length} pós-OP</span>}
                </div>
            </div>

            {[
                { fase: 'OP', itens: itensPorFase.OP, titulo: 'Processos da OP', descricao: 'A mesma quantidade percorre as etapas escolhidas.', efeito: 'Continua dentro da OP', icon: 'fa-gears' },
                { fase: 'POS_OP', itens: itensPorFase.POS_OP, titulo: 'Arremates pós-OP', descricao: 'Trabalho posterior ao encerramento da ordem.', efeito: 'Libera para embalagem', icon: 'fa-box-open' },
            ].filter(grupo => grupo.itens.length > 0).map(grupo => (
                <section key={grupo.fase} className={`op-confirmacao-fase-v4 op-confirmacao-fase-v4--${grupo.fase.toLowerCase()}`}>
                    <div className="op-confirmacao-fase-v4__cabecalho">
                        <span className="op-confirmacao-fase-v4__icone"><i className={`fas ${grupo.icon}`}></i></span>
                        <div><strong>{grupo.titulo}</strong><span>{grupo.descricao}</span></div>
                        <span className="op-confirmacao-fase-v4__efeito"><i className={`fas ${grupo.fase === 'POS_OP' ? 'fa-box-open' : 'fa-arrow-right'}`}></i>{grupo.efeito}</span>
                    </div>

                    <div className="op-confirmacao-fase-v4__lista">
                        {grupo.itens.map(item => {
                            const key = obterChaveTarefa(item);
                            const meta = metadados[key] || {};
                            const quantidade = quantidades[key] ?? item.quantidade_disponivel;
                            const ehPosOp = item.fase === 'POS_OP';
                            const etapasUnificadas = item._unificada ? item._grupo_unificacao?.etapas || [] : [];
                            const primeiraEtapa = etapasUnificadas[0];
                            const ultimaEtapa = etapasUnificadas[etapasUnificadas.length - 1];
                            const rotuloEtapa = ehPosOp
                                ? 'Arremate pós-OP'
                                : etapasUnificadas.length >= 2
                                    ? `Etapas ${(primeiraEtapa.etapa_index ?? meta.indiceEtapa) + 1}–${(ultimaEtapa.etapa_index ?? meta.indiceEtapa) + 1} de ${meta.totalEtapas || '?'}`
                                    : meta.isFinal ? 'Etapa final' : meta.indiceEtapa >= 0 ? `Etapa ${meta.indiceEtapa + 1} de ${meta.totalEtapas}` : 'Processo da OP';
                            const aviso = calcularAvisoHorario(item, parseInt(quantidade, 10) || 0, funcionario, tpp);
                            const varianteLegenda = item.variante && item.variante !== '-' ? item.variante : 'Sem variação';
                            const classeLegendaVariante = varianteLegenda.length > 28
                                ? ' op-task-card-v4__imagem-legenda--longa'
                                : varianteLegenda.length > 19 ? ' op-task-card-v4__imagem-legenda--media' : '';

                            return (
                                <article key={key} className={`op-qtd-card-v4 op-qtd-card-v4--${ehPosOp ? 'pos-op' : 'op'}${itensRemovendo.has(key) ? ' op-qtd-card-v4--removendo' : ''}`}>
                                    <div className="card-borda-charme" aria-hidden="true"></div>
                                    <div className="op-qtd-card-v4__grid">
                                        <div className="op-qtd-card-v4__visual">
                                            <div className="op-qtd-card-v4__imagem-wrap">
                                                <img src={meta.imagem || '/img/placeholder-image.png'} alt={varianteLegenda} />
                                                <span className={`op-task-card-v4__imagem-legenda${classeLegendaVariante}`} title={varianteLegenda}>{varianteLegenda}</span>
                                            </div>

                                            {etapasUnificadas.length >= 2 && (
                                                <div className="op-qtd-card-v4__percurso">
                                                    {etapasUnificadas.map((etapaPercurso, indice) => (
                                                        <React.Fragment key={etapaPercurso.etapa_id || etapaPercurso.processo_id || etapaPercurso.processo}>
                                                            <span><b>{etapaPercurso.processo}</b><small>{formatarPecas(quantidade)}</small></span>
                                                            {indice < etapasUnificadas.length - 1 && <i className="fas fa-arrow-right"></i>}
                                                        </React.Fragment>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div className="op-qtd-card-v4__conteudo">
                                            <div className="op-qtd-card-v4__topo">
                                                <span className="op-qtd-card-v4__produto">{meta.produtoNome || item.produto_nome}</span>
                                                <button
                                                    type="button"
                                                    className="op-qtd-card-v4__voltar"
                                                    onClick={() => voltarTarefa(item)}
                                                    aria-label={`Voltar tarefa ${item.variante || meta.produtoNome || item.produto_nome} para seleção`}
                                                >
                                                    <i className="fas fa-arrow-left"></i> Voltar tarefa
                                                </button>
                                            </div>
                                            <h4>{item.variante && item.variante !== '-' ? item.variante : 'Sem variação'}</h4>
                                            <div className="op-qtd-card-v4__identidade">
                                                <span className="op-etapa-step-badge"><i className={`fas ${ehPosOp ? 'fa-sparkles' : 'fa-list-ol'}`}></i>{rotuloEtapa}</span>
                                                <span className={`op-processo-chip ${ehPosOp ? 'op-processo-chip--pos-op' : ''}`}>
                                                    <i className={`fas ${etapasUnificadas.length >= 2 ? 'fa-code-branch' : 'fa-industry'}`}></i>
                                                    {etapasUnificadas.length >= 2 ? 'Fluxo unificado' : item.processo}
                                                </span>
                                            </div>

                                            <div className="op-qtd-card-v4__metadados">
                                                {formatarOps(item.origem_ops) && <span><i className="fas fa-link"></i>{formatarOps(item.origem_ops)}</span>}
                                                {item.origens_pos_op?.length > 1 && <span><i className="fas fa-layer-group"></i>{item.origens_pos_op.length} OPs agrupadas por produto, variante e etapa</span>}
                                                <span><i className="fas fa-user-check"></i>{funcionario.nome}</span>
                                            </div>

                                            <div className={`op-card-fluxo-efeito-v4 ${ehPosOp ? 'op-card-fluxo-efeito-v4--pos-op' : ''}`}>
                                                <span><i className="fas fa-route"></i>Efeito no fluxo</span>
                                                <strong><i className={`fas ${ehPosOp ? 'fa-box-open' : 'fa-arrow-right'}`}></i>{grupo.efeito}</strong>
                                            </div>

                                            {aviso && (
                                                <div className="op-atrib-aviso-horario">
                                                    <i className="fas fa-triangle-exclamation"></i>
                                                    <span>Estimativa: término às {aviso.terminoEstimado}<small>Saída prevista: {aviso.s3Formatado} · {aviso.excedenteMin} min além do horário</small></span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="op-qtd-card-v4__painel-direito">
                                            <div className="op-qtd-card-v4__controles">
                                                <label htmlFor={`quantidade-${key}`}>Quantidade</label>
                                                <div className="op-qtd-card-v4__ajuste">
                                                    <button type="button" onClick={() => ajustarQuantidade(key, -1, item.quantidade_disponivel)} aria-label="Diminuir quantidade">−</button>
                                                    <input
                                                        id={`quantidade-${key}`}
                                                        type="number"
                                                        value={quantidade}
                                                        min="0"
                                                        max={item.quantidade_disponivel}
                                                        onChange={event => handleQtdChange(key, event.target.value, item.quantidade_disponivel)}
                                                    />
                                                    <button type="button" onClick={() => ajustarQuantidade(key, 1, item.quantidade_disponivel)} aria-label="Aumentar quantidade">+</button>
                                                </div>
                                                <div className="op-qtd-card-v4__atalhos">
                                                    <button type="button" onClick={() => ajustarQuantidade(key, 1, item.quantidade_disponivel)}>+1</button>
                                                    <button type="button" onClick={() => ajustarQuantidade(key, 5, item.quantidade_disponivel)}>+5</button>
                                                    <button type="button" onClick={() => definirMaximo(key, item.quantidade_disponivel)}>MAX</button>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="op-qtd-card-v4__limpar"
                                                    onClick={() => handleQtdChange(key, '', item.quantidade_disponivel)}
                                                >
                                                    Limpar
                                                </button>
                                            </div>

                                            {etapasUnificadas.length >= 2 && (
                                                <div className="op-qtd-card-v4__detalhe-unificado">
                                                    <strong><i className="fas fa-code-branch"></i>{etapasUnificadas.length} etapas registradas juntas</strong>
                                                    <span>A quantidade informada será lançada em cada etapa do percurso, com pontos individuais.</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </section>
            ))}

            <button
                type="button"
                className={`op-selecao-fab op-confirmacao-v4__confirmar${!podeConfirmar ? ' op-selecao-fab--bloqueado bloqueado' : ''}`}
                onClick={() => {
                    if (!podeConfirmar) {
                        mostrarPopupSemPermissao('Você não tem permissão para confirmar lançamentos de produção.');
                        return;
                    }
                    void handleConfirmar();
                }}
                disabled={carregando}
            >
                {carregando
                    ? <><span className="spinner-btn-interno"></span> Processando...</>
                    : <>
                        <span className="op-selecao-fab-badge">
                            {podeConfirmar ? itensLote.length : <i className="fas fa-lock" style={{ fontSize: '0.7rem' }}></i>}
                        </span>
                        {podeConfirmar ? textoBotao : 'Sem permissão'}
                        <i className={`fas ${podeConfirmar ? 'fa-arrow-right' : 'fa-lock'}`}></i>
                    </>}
            </button>
        </div>
    );
}
