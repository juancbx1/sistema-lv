// public/src/components/OPTelaSelecaoEtapa.jsx

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { obterProdutos as obterProdutosDoStorage } from '/js/utils/storage.js';
import UIFeedbackNotFound from './UIFeedbackNotFound.jsx';
import UICarregando from './UICarregando.jsx';
import OPPaginacaoWrapper from './OPPaginacaoWrapper.jsx';
import UIBuscaInteligente, { filtrarListaInteligente } from './UIBuscaInteligente.jsx';
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio.js';

function OPEtapaCard({ etapa, onToggle, stepLabel, isFinal, imagemUrl, selecionado, grupoInfo, unificacaoAtiva, onToggleUnificacao }) {
    const bordaClasse = etapa.processo.toLowerCase() === 'corte'
        ? 'borda-corte'
        : isFinal
            ? 'borda-etapa-final'
            : 'borda-etapa-normal';

    const ops = etapa.origem_ops || [];
    const opsTexto = ops.length > 0
        ? `OP #${ops.slice(0, 3).join(' • #')}${ops.length > 3 ? ` +${ops.length - 3}` : ''}`
        : null;

    const ehPrimaria = grupoInfo && grupoInfo.idxNoGrupo === 0;
    const ehSecundaria = grupoInfo && grupoInfo.idxNoGrupo > 0 && unificacaoAtiva;
    const outrasEtapas = ehPrimaria ? grupoInfo.grupo.etapas.slice(1).map(e => e.processo).join(' + ') : '';

    // Step secundário quando unificação ativa: fica embutido no card primário
    if (ehSecundaria) return null;

    const unificadoAtivo = ehPrimaria && unificacaoAtiva;

    return (
        <div
            className={`op-card-react ${selecionado ? 'selecionado-lote' : ''} ${unificadoAtivo ? 'op-card-unificado' : ''}`}
            onClick={() => onToggle(etapa)}
            style={{
                cursor: 'pointer',
                border: selecionado ? '2px solid var(--op-cor-azul-claro)'
                    : unificadoAtivo ? '2px solid #6366f1'
                    : '1px solid transparent',
                backgroundColor: selecionado ? '#f0f8ff'
                    : unificadoAtivo ? '#f5f3ff'
                    : '#fff',
            }}
        >
            <div className={`card-borda-charme ${bordaClasse}`}></div>

            <div className="op-card-checkbox-wrapper">
                <div className={`op-card-checkbox ${selecionado ? 'marcado' : ''}`}></div>
            </div>

            <img src={imagemUrl || '/img/placeholder-image.png'} alt={etapa.produto_nome} className="card-imagem-produto" />

            <div className="card-info-principal">
                {unificadoAtivo ? (
                    <span className="op-unif-ativo-label">
                        <i className="fas fa-link"></i> Etapas Unificadas
                    </span>
                ) : (
                    <span className={`op-etapa-step-badge ${isFinal ? 'final' : 'normal'}`}>
                        {stepLabel}
                    </span>
                )}
                <h3>{etapa.produto_nome}</h3>
                {etapa.variante && <p>{etapa.variante}</p>}
                {unificadoAtivo ? (
                    <div className="op-unif-processos-linha">
                        {grupoInfo.grupo.etapas.map((e, i) => (
                            <React.Fragment key={e.processo}>
                                <span className="op-processo-chip">{e.processo}</span>
                                {i < grupoInfo.grupo.etapas.length - 1 && (
                                    <i className="fas fa-arrow-right op-unif-seta"></i>
                                )}
                            </React.Fragment>
                        ))}
                    </div>
                ) : (
                    <span className="op-processo-chip">{etapa.processo}</span>
                )}
            </div>

            <div className="card-bloco-pendente">
                <span className="label">DISPONÍVEL</span>
                <span className="valor">{etapa.quantidade_disponivel}</span>
            </div>

            {ehPrimaria && !unificacaoAtiva && (
                <div className="op-etapa-unificavel-badge">
                    <i className="fas fa-link"></i>
                    <span>Unificável com: {outrasEtapas}</span>
                    <button
                        className="op-unificacao-toggle"
                        onClick={e => { e.stopPropagation(); onToggleUnificacao(grupoInfo.grupo.grupo_id); }}
                    >
                        Unificar
                    </button>
                </div>
            )}

            {unificadoAtivo && (
                <div className="op-etapa-unificavel-badge op-etapa-unificavel-badge--ativo">
                    <i className="fas fa-check-circle"></i>
                    <span>Ambas as etapas serão registradas juntas</span>
                    <button
                        className="op-unificacao-toggle op-unificacao-toggle--separar"
                        onClick={e => { e.stopPropagation(); onToggleUnificacao(grupoInfo.grupo.grupo_id); }}
                    >
                        <i className="fas fa-unlink"></i> Separar
                    </button>
                </div>
            )}

            {opsTexto && (
                <div className="op-card-ops-footer">
                    <i className="fas fa-link"></i> {opsTexto}
                </div>
            )}
        </div>
    );
}

export default function OPTelaSelecaoEtapa({ onEtapaSelect, funcionario }) {
    const [filaDeTarefas, setFilaDeTarefas] = useState([]);
    const [todosProdutos, setTodosProdutos] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);
    const [pagina, setPagina] = useState(1);

    const [termoFiltro, setTermoFiltro] = useState('');
    const [selecionados, setSelecionados] = useState([]);
    const [sugestao, setSugestao] = useState(null);
    const [gruposUnificaveis, setGruposUnificaveis] = useState({}); // "pid__var" → [{grupo_id, etapas, muda_maquina}]
    const [unificacoesAtivas, setUnificacoesAtivas] = useState(new Set());
    const candidatosKeyRef = useRef(''); // evita chamadas duplicadas à API quando o render não muda os dados
    const ITENS_POR_PAGINA = 6;

    // Tipo estável como string primitiva (não causa loop de referência)
    const tipoFuncionario = funcionario?.tipos?.includes('costureira') ? 'costureira'
        : funcionario?.tipos?.includes('tiktik') ? 'tiktik' : null;

    useEffect(() => {
        async function buscarDados() {
            setCarregando(true);
            try {
                const token = localStorage.getItem('token');
                const [dataFila, dataProdutos] = await Promise.all([
                    fetch('/api/producao/fila-de-tarefas', { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.json()),
                    obterProdutosDoStorage()
                ]);

                setFilaDeTarefas(dataFila);
                setTodosProdutos(dataProdutos);
            } catch (err) {
                console.error('[DEBUG ATRIBUIR] Erro:', err);
                setErro(err.message);
            } finally {
                setCarregando(false);
            }
        }
        buscarDados();
    }, []);

    const tarefasFiltradasParaFuncionario = useMemo(() => {
        if (!funcionario?.tipos || todosProdutos.length === 0) return [];
        return filaDeTarefas.filter(tarefa => {
            const produto = todosProdutos.find(p => p.id === tarefa.produto_id);
            if (!produto?.etapas) return false;
            const etapaConfig = produto.etapas.find(e => (e.processo || e) === tarefa.processo);
            if (!etapaConfig) return false;
            return funcionario.tipos.includes(etapaConfig.feitoPor);
        });
    }, [filaDeTarefas, todosProdutos, funcionario]);

    // Detecta grupos unificáveis para cada produto único na fila deste funcionário
    useEffect(() => {
        if (!tipoFuncionario || tarefasFiltradasParaFuncionario.length === 0) {
            setGruposUnificaveis({});
            candidatosKeyRef.current = '';
            return;
        }

        const candidatos = [...new Set(
            tarefasFiltradasParaFuncionario.map(t => `${t.produto_id}__${t.variante || ''}`)
        )].sort();

        // Evita chamadas repetidas se os candidatos não mudaram
        const candidatosKey = `${tipoFuncionario}:${candidatos.join(',')}`;
        if (candidatosKey === candidatosKeyRef.current) return;
        candidatosKeyRef.current = candidatosKey;

        if (candidatos.length === 0) { setGruposUnificaveis({}); return; }

        const token = localStorage.getItem('token');
        Promise.all(candidatos.map(async pvKey => {
            const sepIdx = pvKey.indexOf('__');
            const produto_id = pvKey.substring(0, sepIdx);
            const variante = pvKey.substring(sepIdx + 2);
            const params = new URLSearchParams({ produto_id, tipo_funcionario: tipoFuncionario });
            if (variante) params.append('variante', variante);
            const res = await fetch(`/api/producao/grupos-unificaveis?${params}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const grupos = res.ok ? await res.json() : [];
            // BUGFIX: prefixar grupo_id com pvKey (produto+variante) para evitar
            // que variantes diferentes do mesmo produto compartilhem o mesmo grupo_id
            // no Set unificacoesAtivas, o que causava ativação cruzada indevida.
            const gruposRemapeados = grupos
                .filter(g => g.etapas.length >= 2)
                .map(g => ({ ...g, grupo_id: `${pvKey}::${g.grupo_id}` }));
            return [pvKey, gruposRemapeados];
        })).then(results => {
            const map = {};
            results.forEach(([k, grupos]) => { if (grupos.length > 0) map[k] = grupos; });
            setGruposUnificaveis(map);
            setUnificacoesAtivas(new Set());
        }).catch(() => {});
    }, [tarefasFiltradasParaFuncionario, tipoFuncionario, funcionario?.id]);

    const getGrupoInfo = useCallback((tarefa) => {
        const pvKey = `${tarefa.produto_id}__${tarefa.variante || ''}`;
        const grupos = gruposUnificaveis[pvKey] || [];
        for (const grupo of grupos) {
            const idxNoGrupo = grupo.etapas.findIndex(e => e.processo === tarefa.processo);
            if (idxNoGrupo !== -1) return { grupo, idxNoGrupo };
        }
        return null;
    }, [gruposUnificaveis]);

    const handleToggleUnificacao = useCallback((grupoId) => {
        setUnificacoesAtivas(prev => {
            const next = new Set(prev);
            if (next.has(grupoId)) next.delete(grupoId); else next.add(grupoId);
            return next;
        });
    }, []);

    // Busca sugestão assim que a lista filtrada para este funcionário estiver pronta
    useEffect(() => {
        if (!funcionario?.id || tarefasFiltradasParaFuncionario.length === 0) {
            setSugestao(null);
            return;
        }
        const token = localStorage.getItem('token');
        fetch('/api/producao/sugestao-tarefa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ funcionario_id: funcionario.id, candidatas: tarefasFiltradasParaFuncionario })
        })
            .then(r => r.json())
            .then(data => setSugestao(data.sugestao || null))
            .catch(() => setSugestao(null));
    }, [tarefasFiltradasParaFuncionario, funcionario?.id]);

    const listaFinalFiltrada = useMemo(() => {
        return filtrarListaInteligente(tarefasFiltradasParaFuncionario, termoFiltro, ['produto_nome', 'variante', 'processo']);
    }, [tarefasFiltradasParaFuncionario, termoFiltro]);

    // BUG-24: quando o card de sugestão está visível, remove a tarefa sugerida da lista
    // para evitar duplicação (ela já aparece destacada acima com botão de atribuição próprio)
    const listaParaExibir = useMemo(() => {
        if (!sugestao || termoFiltro) return listaFinalFiltrada;
        const chaveSugestao = `${sugestao.produto_id}-${sugestao.variante}-${sugestao.processo}`;
        return listaFinalFiltrada.filter(t =>
            `${t.produto_id}-${t.variante}-${t.processo}` !== chaveSugestao
        );
    }, [listaFinalFiltrada, sugestao, termoFiltro]);

    const getEtapaInfo = (tarefa) => {
        const produto = todosProdutos.find(p => p.id === tarefa.produto_id);
        if (!produto || !produto.etapas) return { label: 'Etapa ?', isFinal: false, imagemUrl: null };
        const index = produto.etapas.findIndex(e => (e.processo || e) === tarefa.processo);
        const total = produto.etapas.length;
        const isFinal = index === total - 1;
        const label = isFinal ? 'Etapa Final' : `Etapa ${index + 1}`;
        let imagemUrl = produto.imagem;
        if (tarefa.variante && produto.grade) {
            const variacaoItem = produto.grade.find(g => g.variacao === tarefa.variante);
            if (variacaoItem && variacaoItem.imagem) imagemUrl = variacaoItem.imagem;
        }
        return { label, isFinal, imagemUrl };
    };

    const handleToggleSelect = (etapa) => {
        const grupoInfo = getGrupoInfo(etapa);
        const unificacaoAtiva = grupoInfo && unificacoesAtivas.has(grupoInfo.grupo.grupo_id);

        // Se é o step primário de um grupo ativo, carrega o objeto com info de unificação
        const etapaParaSelecionar = (unificacaoAtiva && grupoInfo.idxNoGrupo === 0)
            ? { ...etapa, _unificada: true, _grupo_unificacao: grupoInfo.grupo }
            : etapa;

        const etapaId = `${etapa.produto_id}-${etapa.variante}-${etapa.processo}`;
        setSelecionados(prev => {
            const jaSelecionado = prev.find(i => `${i.produto_id}-${i.variante}-${i.processo}` === etapaId);
            if (jaSelecionado) {
                return prev.filter(i => `${i.produto_id}-${i.variante}-${i.processo}` !== etapaId);
            } else {
                if (prev.length >= 6) return prev;
                return [...prev, etapaParaSelecionar];
            }
        });
    };

    const handleAvancarLote = () => {
        if (selecionados.length > 0) {
            onEtapaSelect(selecionados);
        }
    };

    const totalPaginas = Math.ceil(listaParaExibir.length / ITENS_POR_PAGINA);
    const tarefasPaginadas = listaParaExibir.slice(
        (pagina - 1) * ITENS_POR_PAGINA,
        pagina * ITENS_POR_PAGINA
    );

    useEffect(() => { setPagina(1); }, [termoFiltro]);

    if (carregando) return <UICarregando variante="bloco" />;
    if (erro) return <p style={{ color: 'red', textAlign: 'center' }}>{erro}</p>;

    const totalDisponivel = tarefasFiltradasParaFuncionario.length;
    const totalFiltrado = listaFinalFiltrada.length;
    const textoMeta = termoFiltro
        ? `${totalFiltrado} resultado${totalFiltrado !== 1 ? 's' : ''} de ${totalDisponivel}`
        : `${totalDisponivel} tarefa${totalDisponivel !== 1 ? 's' : ''} disponível${totalDisponivel !== 1 ? 'is' : ''}`;

    const qtdSelecionados = selecionados.length;
    const textoBotao = qtdSelecionados === 1 ? 'Atribuir 1 Tarefa' : `Atribuir ${qtdSelecionados} Tarefas`;
    const podeAtribuir = temPermissao('atribuir-tarefa');

    return (
        <div className="coluna-lista-produtos">

            {sugestao && !termoFiltro && (() => {
                const { label: sLabel, imagemUrl: sImg } = getEtapaInfo(sugestao);
                return (
                    <div className="op-sugestao-destaque">
                        <div className="op-sugestao-header">
                            <i className="fas fa-magic"></i> Sugestão para {funcionario?.nome?.split(' ')[0]}
                        </div>
                        <div className="op-sugestao-corpo">
                            <img src={sImg || '/img/placeholder-image.png'} alt={sugestao.produto_nome} className="op-sugestao-img" />
                            <div className="op-sugestao-info">
                                <span className="op-sugestao-produto">{sugestao.produto_nome}</span>
                                {sugestao.variante && <span className="op-sugestao-variante">{sugestao.variante}</span>}
                                <span className="op-sugestao-processo">{sugestao.processo}</span>
                                <div className="op-sugestao-tags">
                                    <span className="op-sugestao-tag etapa">{sLabel}</span>
                                    {sugestao.motivos?.includes('especialista') && (
                                        <span className="op-sugestao-tag especialista">
                                            <i className="fas fa-star"></i> Especialista ({sugestao.sessoesHistorico} sess.)
                                        </span>
                                    )}
                                    {sugestao.motivos?.includes('urgente') && (
                                        <span className="op-sugestao-tag urgente">
                                            <i className="fas fa-fire"></i> OP aguardando
                                        </span>
                                    )}
                                </div>
                            </div>
                            {(() => {
                                const chaveSug = `${sugestao.produto_id}-${sugestao.variante}-${sugestao.processo}`;
                                const estaSelecionada = selecionados.some(s => `${s.produto_id}-${s.variante}-${s.processo}` === chaveSug);
                                return (
                                    <button
                                        className={`op-sugestao-btn${estaSelecionada ? ' selecionado' : ''}`}
                                        onClick={() => handleToggleSelect(sugestao)}
                                    >
                                        {estaSelecionada
                                            ? <><i className="fas fa-check-circle"></i> Selecionada</>
                                            : <><i className="fas fa-check"></i> Selecionar</>
                                        }
                                    </button>
                                );
                            })()}
                        </div>
                    </div>
                );
            })()}

            <div style={{ marginBottom: '6px' }}>
                <UIBuscaInteligente onSearch={setTermoFiltro} placeholder="Buscar por produto, variante ou processo..." />
            </div>

            <p className="op-busca-meta">{textoMeta}</p>

            <div className="op-cards-container-modal">
                {tarefasPaginadas.length > 0 ? (
                    tarefasPaginadas.map((etapa) => {
                        const { label, isFinal, imagemUrl } = getEtapaInfo(etapa);
                        const etapaId = `${etapa.produto_id}-${etapa.variante}-${etapa.processo}`;
                        const isSelected = selecionados.some(i => `${i.produto_id}-${i.variante}-${i.processo}` === etapaId);

                        const grupoInfo = getGrupoInfo(etapa);
                        const unificacaoAtiva = !!(grupoInfo && unificacoesAtivas.has(grupoInfo.grupo.grupo_id));
                        return (
                            <OPEtapaCard
                                key={etapaId}
                                etapa={etapa}
                                stepLabel={label}
                                isFinal={isFinal}
                                imagemUrl={imagemUrl}
                                selecionado={isSelected}
                                onToggle={handleToggleSelect}
                                grupoInfo={grupoInfo}
                                unificacaoAtiva={unificacaoAtiva}
                                onToggleUnificacao={handleToggleUnificacao}
                            />
                        );
                    })
                ) : (
                    <UIFeedbackNotFound icon="fa-check-square" titulo="Nenhuma Tarefa" mensagem="..." />
                )}
            </div>

            {totalPaginas > 1 && (
                <OPPaginacaoWrapper totalPages={totalPaginas} currentPage={pagina} onPageChange={setPagina} />
            )}

            {qtdSelecionados > 0 && (
                <button
                    className={`op-selecao-fab${!podeAtribuir ? ' op-selecao-fab--bloqueado' : ''}`}
                    onClick={() => {
                        if (!podeAtribuir) {
                            mostrarPopupSemPermissao('Você não tem permissão para atribuir tarefas de produção.');
                            return;
                        }
                        handleAvancarLote();
                    }}
                >
                    <span className="op-selecao-fab-badge">
                        {podeAtribuir ? qtdSelecionados : <i className="fas fa-lock" style={{ fontSize: '0.7rem' }}></i>}
                    </span>
                    {textoBotao}
                    <i className={`fas ${podeAtribuir ? 'fa-arrow-right' : 'fa-lock'}`}></i>
                </button>
            )}
        </div>
    );
}
