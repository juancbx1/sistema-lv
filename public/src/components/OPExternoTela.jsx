// public/src/components/OPExternoTela.jsx
// Versão inline (aba) do OPLancamentoExterno — sem modal/overlay

import React, { useState, useCallback, Fragment } from 'react';
import { mostrarMensagem, mostrarConfirmacao } from '/js/utils/popups.js';
import OPTelaSelecaoEtapa from './OPTelaSelecaoEtapa.jsx';
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio.js';
import UIBloqueio from './UIBloqueio.jsx';

const fmtHora = (iso) => {
    if (!iso) return '--:--';
    return new Date(iso).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
    });
};

const fmtDataHora = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    if (data === hoje) return `hoje ${fmtHora(iso)}`;
    return `${data} ${fmtHora(iso)}`;
};

export default function OPExternoTela() {
    const [tela, setTela] = useState('tipo');
    const [freelanceTipo, setFreelanceTipo] = useState(null);
    const [itensSelecionados, setItensSelecionados] = useState([]);
    const [quantidades, setQuantidades] = useState({});
    const [carregando, setCarregando] = useState(false);

    const [historico, setHistorico] = useState([]);
    const [carregandoHistorico, setCarregandoHistorico] = useState(false);
    const [desfazendoId, setDesfazendoId] = useState(null);

    const resetar = () => {
        setTela('tipo');
        setFreelanceTipo(null);
        setItensSelecionados([]);
        setQuantidades({});
    };

    const carregarHistorico = useCallback(async () => {
        setCarregandoHistorico(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/producoes/externos-recentes', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) setHistorico(await res.json());
        } catch (e) {
            console.error(e);
        } finally {
            setCarregandoHistorico(false);
        }
    }, []);

    const handleVerHistorico = () => {
        setTela('historico');
        carregarHistorico();
    };

    const handleDesfazer = async (item) => {
        const confirmado = await mostrarConfirmacao(
            `Desfazer lançamento de ${item.quantidade}x ${item.produto_nome} — ${item.processo} (${item.freelance_nome})?`,
            'aviso'
        );
        if (!confirmado) return;

        setDesfazendoId(item.id);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/producoes/externo/${item.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Erro ao desfazer.');
            }
            mostrarMensagem('Lançamento desfeito com sucesso.', 'sucesso');
            carregarHistorico();
        } catch (err) {
            mostrarMensagem(err.message, 'erro');
        } finally {
            setDesfazendoId(null);
        }
    };

    const fakeFuncionario = freelanceTipo
        ? { id: null, nome: `Freelance ${freelanceTipo === 'costureira' ? 'Costureira' : 'TikTik'}`, tipos: [freelanceTipo] }
        : null;

    const handleTipoSelect = (tipo) => {
        setFreelanceTipo(tipo);
        setTela('selecao');
    };

    const handleEtapaSelect = (etapa) => {
        const itens = Array.isArray(etapa) ? etapa : [etapa];
        const initQtds = {};
        itens.forEach(i => {
            initQtds[`${i.produto_id}-${i.variante}-${i.processo}`] = i.quantidade_disponivel;
        });
        setItensSelecionados(itens);
        setQuantidades(initQtds);
        setTela('confirmacao');
    };

    const ajustarQtd = (key, delta, max) => {
        setQuantidades(prev => ({
            ...prev,
            [key]: Math.max(0, Math.min(max, (parseInt(prev[key]) || 0) + delta)),
        }));
    };

    const podeConfirmar = temPermissao('confirmar-lancamento');

    const handleConfirmar = async () => {
        setCarregando(true);
        try {
            const token = localStorage.getItem('token');
            const itensPayload = itensSelecionados.map(item => {
                const key = `${item.produto_id}-${item.variante}-${item.processo}`;
                const qtd = parseInt(quantidades[key]) || 0;
                if (qtd <= 0) return null;
                return {
                    op_numero: item.origem_ops[0],
                    produto_id: item.produto_id,
                    variante: item.variante || null,
                    processo: item.processo,
                    quantidade: qtd,
                    ...(item._unificada && item._grupo_unificacao?.etapas && {
                        etapas_unificadas: item._grupo_unificacao.etapas,
                    }),
                };
            }).filter(Boolean);

            if (itensPayload.length === 0) throw new Error('Defina pelo menos uma quantidade válida.');

            const res = await fetch('/api/producoes/externo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ freelance_tipo: freelanceTipo, itens: itensPayload }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Erro ao registrar produção externa.');
            }
            mostrarMensagem('Produção externa registrada com sucesso!', 'sucesso');
            resetar();
        } catch (err) {
            mostrarMensagem(err.message, 'erro');
        } finally {
            setCarregando(false);
        }
    };

    const handleVoltar = () => {
        if (tela === 'confirmacao') return setTela('selecao');
        if (tela === 'selecao') return setTela('tipo');
        if (tela === 'historico') return setTela('tipo');
        setTela('tipo');
    };

    const titulos = {
        tipo: 'Lançamento Externo',
        selecao: 'Selecionar Tarefa',
        confirmacao: 'Confirmar Quantidade',
        historico: 'Histórico de Lançamentos',
    };

    return (
        <div className="gs-card op-externo-tela-wrapper">

            <div className="op-modal-header op-externo-tela-header">
                <div className="op-modal-header-esquerda">
                    {tela !== 'tipo' && (
                        <button className="btn-voltar-header" onClick={handleVoltar}>
                            <i className="fas fa-arrow-left"></i> Voltar
                        </button>
                    )}
                </div>
                <div className="op-modal-header-centro">
                    <h3 className="op-modal-titulo">{titulos[tela]}</h3>
                    <div className="op-modal-header-info">
                        <span className="op-externo-badge">
                            <i className="fas fa-user-tie"></i> Prestador Externo
                        </span>
                        {freelanceTipo && tela !== 'historico' && (
                            <span className={`op-modal-role-badge ${freelanceTipo === 'costureira' ? 'badge-costureira' : 'badge-tiktik'}`}>
                                <i className={`fas ${freelanceTipo === 'costureira' ? 'fa-tshirt' : 'fa-cut'}`}></i>
                                {freelanceTipo === 'costureira' ? 'Costureira' : 'TikTik'}
                            </span>
                        )}
                    </div>
                </div>
                <div className="op-modal-header-direita">
                    {/* sem botão fechar — é uma aba, não um modal */}
                </div>
            </div>

            {tela !== 'historico' && (
                <div className="op-modal-aviso-hora-extra" style={{ background: '#f0f9ff', borderLeftColor: '#0ea5e9', color: '#0c4a6e' }}>
                    <i className="fas fa-info-circle"></i> Produção realizada por prestador externo — registrada com rastreabilidade completa
                </div>
            )}

            <div className="op-modal-body op-externo-tela-body">

                {/* TELA 1: Seleção de tipo */}
                {tela === 'tipo' && (
                    <div className="op-externo-tipo-wrapper">
                        <div className="op-externo-tipo-grid">
                            <button className="op-externo-tipo-card" onClick={() => handleTipoSelect('costureira')}>
                                <i className="fas fa-tshirt op-externo-tipo-icone"></i>
                                <span className="op-externo-tipo-label">Freelance Costureira</span>
                            </button>
                            <button className="op-externo-tipo-card" onClick={() => handleTipoSelect('tiktik')}>
                                <i className="fas fa-cut op-externo-tipo-icone"></i>
                                <span className="op-externo-tipo-label">Freelance TikTik</span>
                            </button>
                        </div>
                        <button className="op-externo-ver-historico" onClick={handleVerHistorico}>
                            <i className="fas fa-history"></i> Ver lançamentos recentes (desfazer)
                        </button>
                    </div>
                )}

                {/* TELA 2: Seleção de tarefa */}
                {tela === 'selecao' && fakeFuncionario && (
                    <OPTelaSelecaoEtapa
                        onEtapaSelect={handleEtapaSelect}
                        funcionario={fakeFuncionario}
                    />
                )}

                {/* TELA 3: Confirmação de quantidade */}
                {tela === 'confirmacao' && (
                    <div className="op-confirmacao-container">
                        <div className="op-confirmacao-lista">
                            {itensSelecionados.map((item) => {
                                const key = `${item.produto_id}-${item.variante}-${item.processo}`;
                                const qtd = quantidades[key] !== undefined ? quantidades[key] : item.quantidade_disponivel;
                                return (
                                    <div key={key} className="op-item-confirmacao-card">
                                        <div className="card-borda-charme borda-etapa-normal"></div>
                                        <div className="item-info-visual">
                                            <img
                                                src={item.imagem_produto || '/img/placeholder-image.png'}
                                                alt={item.produto_nome}
                                            />
                                            <div>
                                                <h4>{item.produto_nome}</h4>
                                                {item.variante && <p className="variante">{item.variante}</p>}
                                                {item._unificada && item._grupo_unificacao?.etapas ? (
                                                    <div className="op-confirmacao-processos-unif">
                                                        {item._grupo_unificacao.etapas.map((e, i) => (
                                                            <Fragment key={e.processo}>
                                                                <span className="op-confirmacao-etapa-chip">{e.processo}</span>
                                                                {i < item._grupo_unificacao.etapas.length - 1 && (
                                                                    <i className="fas fa-arrow-right op-confirmacao-unif-seta"></i>
                                                                )}
                                                            </Fragment>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="processo">{item.processo}</p>
                                                )}
                                                {item.origem_ops?.length > 0 && (
                                                    <p className="op-confirmacao-op-link">
                                                        <i className="fas fa-link"></i>
                                                        {' OP #'}{item.origem_ops.slice(0, 2).join(' • #')}{item.origem_ops.length > 2 ? ` +${item.origem_ops.length - 2}` : ''}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="item-controles-qtd">
                                            <div className="qtd-display-linha">
                                                <button className="btn-ajuste mini" onClick={() => ajustarQtd(key, -1, item.quantidade_disponivel)}>-</button>
                                                <input
                                                    type="number"
                                                    value={qtd}
                                                    onChange={e => {
                                                        const n = parseInt(e.target.value);
                                                        if (e.target.value === '' || (!isNaN(n) && n >= 0 && n <= item.quantidade_disponivel)) {
                                                            setQuantidades(p => ({ ...p, [key]: e.target.value === '' ? '' : n }));
                                                        }
                                                    }}
                                                />
                                                <button className="btn-ajuste mini" onClick={() => ajustarQtd(key, 1, item.quantidade_disponivel)}>+</button>
                                            </div>
                                            <div className="qtd-atalhos-linha">
                                                <button onClick={() => ajustarQtd(key, 10, item.quantidade_disponivel)}>+10</button>
                                                <button className="btn-max" onClick={() => setQuantidades(p => ({ ...p, [key]: item.quantidade_disponivel }))}>
                                                    Max ({item.quantidade_disponivel})
                                                </button>
                                            </div>
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
                                ? <><div className="spinner-btn-interno"></div> Registrando...</>
                                : !podeConfirmar
                                    ? <><i className="fas fa-lock"></i> Sem permissão</>
                                    : <><i className="fas fa-check-double"></i> Confirmar Lançamento</>
                            }
                        </button>
                    </div>
                )}

                {/* TELA 4: Histórico / Desfazer */}
                {tela === 'historico' && (
                    <div className="op-externo-historico">
                        {carregandoHistorico ? (
                            <div className="spinner" style={{ margin: '40px auto' }}>Carregando...</div>
                        ) : historico.length === 0 ? (
                            <div className="op-externo-historico-vazio">
                                <i className="fas fa-inbox"></i>
                                <p>Nenhum lançamento externo nas últimas 24h</p>
                            </div>
                        ) : (
                            <div className="op-externo-historico-lista">
                                {historico.map(item => {
                                    const tipoLabel = item.freelance_tipos?.includes('costureira') ? 'Costureira' : 'TikTik';
                                    const tipoClasse = item.freelance_tipos?.includes('costureira') ? 'badge-costureira' : 'badge-tiktik';
                                    const tipoIcone = item.freelance_tipos?.includes('costureira') ? 'fa-tshirt' : 'fa-cut';
                                    return (
                                        <div key={item.id} className="op-externo-historico-item">
                                            <div className="op-externo-historico-info">
                                                <span className="op-externo-historico-produto">{item.produto_nome}</span>
                                                {item.variacao && <span className="op-externo-historico-variante">{item.variacao}</span>}
                                                <span className="op-externo-historico-processo">{item.processo}</span>
                                                <div className="op-externo-historico-meta">
                                                    <span className="op-externo-historico-qtd">
                                                        <i className="fas fa-layer-group"></i> {item.quantidade} pçs
                                                    </span>
                                                    <span className={`op-modal-role-badge ${tipoClasse}`} style={{ fontSize: '0.65rem', padding: '1px 5px' }}>
                                                        <i className={`fas ${tipoIcone}`}></i> {tipoLabel}
                                                    </span>
                                                    <span className="op-externo-historico-hora">
                                                        <i className="fas fa-clock"></i> {fmtDataHora(item.data)}
                                                    </span>
                                                    <span className="op-externo-historico-lancador">
                                                        por {item.lancado_por}
                                                    </span>
                                                </div>
                                            </div>
                                            <UIBloqueio permissao="desfazer-lancamento-p-externo">
                                                <button
                                                    className="op-externo-historico-btn-desfazer"
                                                    onClick={() => handleDesfazer(item)}
                                                    disabled={desfazendoId === item.id}
                                                    title="Desfazer este lançamento"
                                                >
                                                    {desfazendoId === item.id
                                                        ? <div className="spinner-btn-interno"></div>
                                                        : <><i className="fas fa-undo"></i> Desfazer</>
                                                    }
                                                </button>
                                            </UIBloqueio>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

            </div>
        </div>
    );
}
