// public/src/components/OPTelaSelecaoEtapa.jsx

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { obterProdutos as obterProdutosDoStorage } from '/js/utils/storage.js';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UICarregando from './UICarregando';
import OPPaginacaoWrapper from './OPPaginacaoWrapper.jsx';
import UIBuscaInteligente, { filtrarListaInteligente } from './UIBuscaInteligente';
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio';
import { etapaPermiteExecutor } from '../utils/etapas-produto.ts';

function obterChaveTarefa(tarefa) {
    const origemPosOp = tarefa.fase === 'POS_OP' ? (tarefa.origem_ops?.[0] || '') : '';
    return [
        tarefa.produto_id,
        tarefa.variante || '-',
        tarefa.fase || 'OP',
        tarefa.etapa_id || tarefa.processo_id || tarefa.processo,
        origemPosOp,
    ].join('-');
}

function obterEtapasProduto(produto) {
    if (Array.isArray(produto?.etapasCanonicas)) return produto.etapasCanonicas;
    return [
        ...(Array.isArray(produto?.etapas) ? produto.etapas : []),
        ...(Array.isArray(produto?.etapasTiktik)
            ? produto.etapasTiktik
            : Array.isArray(produto?.etapastiktik) ? produto.etapastiktik : []),
    ];
}

const ROTULOS_EXECUTORES = {
    costureira: 'Costureira',
    tiktik: 'TikTik',
    cortador: 'Cortador',
};

function obterTextoExecutores(etapa) {
    const executores = Array.isArray(etapa?.feito_por)
        ? etapa.feito_por
        : [etapa?.feito_por];

    const nomes = executores
        .filter(Boolean)
        .map(tipo => ROTULOS_EXECUTORES[tipo] || tipo);

    return nomes.length > 0 ? nomes.join(' / ') : 'Executor configurado';
}

function obterIdentidadeEtapa(tarefa) {
    if (tarefa?.etapa_id) return `etapa:${tarefa.etapa_id}`;
    if (tarefa?.processo_id) return `processo:${tarefa.processo_id}`;
    return `nome:${tarefa?.processo || ''}`;
}

function agruparTarefasPosOp(tarefas) {
    const grupos = new Map();
    const resultado = [];

    tarefas.forEach(tarefa => {
        if (tarefa.fase !== 'POS_OP') {
            resultado.push(tarefa);
            return;
        }

        const opNumero = tarefa.origem_ops?.[0];
        if (!opNumero) {
            resultado.push(tarefa);
            return;
        }

        const variante = tarefa.variante === undefined || tarefa.variante === null
            ? '-'
            : String(tarefa.variante);
        const chave = [
            'POS_OP',
            tarefa.produto_id,
            variante,
            obterIdentidadeEtapa(tarefa),
        ].join('|');
        const grupoExistente = grupos.get(chave);

        if (!grupoExistente) {
            const grupo = {
                ...tarefa,
                quantidade_disponivel: Number(tarefa.quantidade_disponivel) || 0,
                origem_ops: [opNumero],
                origens_pos_op: [{
                    op_numero: String(opNumero),
                    quantidade_disponivel: Number(tarefa.quantidade_disponivel) || 0,
                }],
                _posOpAgrupada: true,
            };
            grupos.set(chave, grupo);
            resultado.push(grupo);
            return;
        }

        const quantidade = Number(tarefa.quantidade_disponivel) || 0;
        grupoExistente.quantidade_disponivel += quantidade;
        grupoExistente.origem_ops.push(opNumero);
        grupoExistente.origens_pos_op.push({
            op_numero: String(opNumero),
            quantidade_disponivel: quantidade,
        });
    });

    return resultado;
}

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

    const ehPosOp = etapa.fase === 'POS_OP';
    const ehPrimaria = !ehPosOp && grupoInfo && grupoInfo.idxNoGrupo === 0;
    const ehSecundaria = grupoInfo && grupoInfo.idxNoGrupo > 0 && unificacaoAtiva;
    const outrasEtapas = ehPrimaria ? grupoInfo.grupo.etapas.slice(1).map(e => e.processo).join(' + ') : '';
    const executoresTexto = obterTextoExecutores(etapa);

    // Step secundário quando unificação ativa: fica embutido no card primário
    if (ehSecundaria) return null;

    const unificadoAtivo = ehPrimaria && unificacaoAtiva;

    return (
        <div
            className={`op-card-react op-card-fase-${ehPosOp ? 'pos-op' : 'op'} ${selecionado ? 'selecionado-lote' : ''} ${unificadoAtivo ? 'op-card-unificado' : ''}`}
            onClick={() => onToggle(etapa)}
            data-fase={ehPosOp ? 'POS_OP' : 'OP'}
            aria-label={`${ehPosOp ? 'Arremate pós-OP' : 'Produção da OP'}: ${etapa.produto_nome}, ${etapa.processo}`}
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
                    <span className={`op-etapa-step-badge ${ehPosOp ? 'pos-op' : isFinal ? 'final' : 'normal'}`}>
                        {ehPosOp ? 'Arremate pós-OP' : stepLabel}
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
                    <span className={`op-processo-chip ${ehPosOp ? 'op-processo-chip--pos-op' : ''}`}>{etapa.processo}</span>
                )}
            </div>

            <div className="card-bloco-pendente">
                <span className="label">DISPONÍVEL</span>
                <span className="valor">{etapa.quantidade_disponivel}</span>
            </div>

            <div className={`op-card-fluxo-meta ${ehPosOp ? 'op-card-fluxo-meta--pos-op' : ''}`}>
                <span className="op-card-fluxo-efeito">
                    <i className={`fas ${ehPosOp ? 'fa-box-open' : 'fa-arrow-right'}`}></i>
                    {ehPosOp ? 'Libera para embalagem' : 'Continua na OP'}
                </span>
                <span className="op-card-executores">
                    <i className="fas fa-user-check"></i> Pode ser feito por: {executoresTexto}
                </span>
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

            {ehPosOp && (
                <div className="op-card-pos-op-alerta">
                    <i className="fas fa-lock-open"></i> Liberado somente após a OP finalizada
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
    const [faseFiltro, setFaseFiltro] = useState('TODAS');

    const [termoFiltro, setTermoFiltro] = useState('');
    const [selecionados, setSelecionados] = useState([]);
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
            const etapaConfig = obterEtapasProduto(produto).find((etapa) => {
                const processo = etapa.processo || etapa;
                const faseCompativel = tarefa.fase === 'POS_OP'
                    ? etapa.fase === 'POS_OP'
                    : (!etapa.fase || etapa.fase === 'OP');
                const idCompativel = !tarefa.etapa_id || String(etapa.id || '') === String(tarefa.etapa_id);
                return faseCompativel && idCompativel && processo === tarefa.processo;
            });
            if (!etapaConfig) return false;
            return etapaPermiteExecutor(etapaConfig, funcionario.tipos);
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
        if (tarefa.fase === 'POS_OP') return null;
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

    const listaFinalFiltrada = useMemo(() => {
        return filtrarListaInteligente(tarefasFiltradasParaFuncionario, termoFiltro, ['produto_nome', 'variante', 'processo']);
    }, [tarefasFiltradasParaFuncionario, termoFiltro]);

    const tarefasAgrupadas = useMemo(
        () => agruparTarefasPosOp(tarefasFiltradasParaFuncionario),
        [tarefasFiltradasParaFuncionario],
    );

    const listaFinalAgrupada = useMemo(
        () => agruparTarefasPosOp(listaFinalFiltrada),
        [listaFinalFiltrada],
    );

    // BUG-24: quando o card de sugestão está visível, remove a tarefa sugerida da lista
    // para evitar duplicação (ela já aparece destacada acima com botão de atribuição próprio)
    const contagemFases = useMemo(() => ({
        OP: tarefasAgrupadas.filter(tarefa => tarefa.fase !== 'POS_OP').length,
        POS_OP: tarefasAgrupadas.filter(tarefa => tarefa.fase === 'POS_OP').length,
    }), [tarefasAgrupadas]);

    const listaFiltradaPorFase = useMemo(() => {
        if (faseFiltro === 'TODAS') return listaFinalAgrupada;
        return listaFinalAgrupada.filter(tarefa => (
            faseFiltro === 'POS_OP' ? tarefa.fase === 'POS_OP' : tarefa.fase !== 'POS_OP'
        ));
    }, [faseFiltro, listaFinalAgrupada]);

    const listaParaExibir = useMemo(() => {
        return [...listaFiltradaPorFase].sort((a, b) => (
            (a.fase === 'POS_OP' ? 1 : 0) - (b.fase === 'POS_OP' ? 1 : 0)
        ));
    }, [listaFiltradaPorFase]);

    const getEtapaInfo = (tarefa) => {
        const produto = todosProdutos.find(p => p.id === tarefa.produto_id);
        if (!produto) return { label: 'Etapa ?', isFinal: false, imagemUrl: null };
        let imagemUrl = produto.imagem;
        if (tarefa.variante && produto.grade) {
            const variacaoItem = produto.grade.find(g => g.variacao === tarefa.variante);
            if (variacaoItem && variacaoItem.imagem) imagemUrl = variacaoItem.imagem;
        }
        if (tarefa.fase === 'POS_OP') {
            return { label: 'Arremate pós-OP', isFinal: false, imagemUrl };
        }
        const etapasOp = obterEtapasProduto(produto).filter(e => !e.fase || e.fase === 'OP');
        const index = etapasOp.findIndex(e => (e.processo || e) === tarefa.processo);
        const total = etapasOp.length;
        const isFinal = index === total - 1;
        const label = isFinal ? 'Etapa Final' : `Etapa ${index + 1}`;
        return { label, isFinal, imagemUrl };
    };

    const handleToggleSelect = (etapa) => {
        const grupoInfo = getGrupoInfo(etapa);
        const unificacaoAtiva = grupoInfo && unificacoesAtivas.has(grupoInfo.grupo.grupo_id);

        // Se é o step primário de um grupo ativo, carrega o objeto com info de unificação
        const etapaParaSelecionar = (unificacaoAtiva && grupoInfo.idxNoGrupo === 0)
            ? { ...etapa, _unificada: true, _grupo_unificacao: grupoInfo.grupo }
            : etapa;

        const etapaId = obterChaveTarefa(etapa);
        setSelecionados(prev => {
            const jaSelecionado = prev.find(i => obterChaveTarefa(i) === etapaId);
            if (jaSelecionado) {
                return prev.filter(i => obterChaveTarefa(i) !== etapaId);
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

    useEffect(() => { setPagina(1); }, [termoFiltro, faseFiltro]);

    if (carregando) return <UICarregando variante="bloco" />;
    if (erro) return <p style={{ color: 'red', textAlign: 'center' }}>{erro}</p>;

    const totalDisponivel = tarefasAgrupadas.length;
    const totalFiltrado = listaFiltradaPorFase.length;
    const nomeFase = faseFiltro === 'POS_OP' ? 'arremates pós-OP' : 'processos da OP';
    const textoMeta = termoFiltro
        ? `${totalFiltrado} resultado${totalFiltrado !== 1 ? 's' : ''} de ${totalDisponivel}`
        : `${totalDisponivel} tarefa${totalDisponivel !== 1 ? 's' : ''} disponível${totalDisponivel !== 1 ? 'is' : ''}`;
    const buscaTarefa = termoFiltro.trim();

    const qtdSelecionados = selecionados.length;
    const textoBotao = qtdSelecionados === 1 ? 'Atribuir 1 Tarefa' : `Atribuir ${qtdSelecionados} Tarefas`;
    const podeAtribuir = temPermissao('atribuir-tarefa');

    return (
        <div className="coluna-lista-produtos op-selecao-tela">

            <div style={{ marginBottom: '6px' }}>
                <UIBuscaInteligente onSearch={setTermoFiltro} placeholder="Buscar por produto, variante ou processo..." />
            </div>

            <div className="op-selecao-orientacao">
                <div className="op-selecao-orientacao-texto">
                    <span className="op-selecao-eyebrow">O que vai entrar na jornada?</span>
                    <strong>Escolha uma tarefa liberada para {funcionario?.nome?.split(' ')[0] || 'este funcionário'}.</strong>
                    <span>Use a fase para diferenciar o trabalho interno da OP do arremate que encaminha a peça para embalagem.</span>
                </div>
                <div className="op-selecao-fases" role="tablist" aria-label="Fase da tarefa">
                    {[
                        { id: 'TODAS', label: 'Todas', detalhe: 'tarefas', count: totalDisponivel, icon: 'fa-layer-group' },
                        { id: 'OP', label: 'Produção da OP', detalhe: 'continua na OP', count: contagemFases.OP, icon: 'fa-gears' },
                        { id: 'POS_OP', label: 'Arremate pós-OP', detalhe: 'libera embalagem', count: contagemFases.POS_OP, icon: 'fa-box-open' },
                    ].map(fase => (
                        <button
                            key={fase.id}
                            type="button"
                            role="tab"
                            aria-selected={faseFiltro === fase.id}
                            className={`op-selecao-fase-btn op-selecao-fase-btn--${fase.id.toLowerCase()}${faseFiltro === fase.id ? ' ativo' : ''}`}
                            onClick={() => setFaseFiltro(fase.id)}
                            disabled={fase.id !== 'TODAS' && fase.count === 0}
                        >
                            <span className="op-selecao-fase-icone"><i className={`fas ${fase.icon}`}></i></span>
                            <span className="op-selecao-fase-copy">
                                <strong>{fase.label}</strong>
                                <small>{fase.detalhe}</small>
                            </span>
                            <span className="op-selecao-fase-contagem">{fase.count}</span>
                        </button>
                    ))}
                </div>
            </div>

            <p className="op-busca-meta">
                {textoMeta}
                {faseFiltro !== 'TODAS' && <span className="op-busca-meta-fase"> · filtrando {nomeFase}</span>}
            </p>

            <div className="op-cards-container-modal">
                {tarefasPaginadas.length > 0 ? (
                    tarefasPaginadas.map((etapa, indice) => {
                        const { label, isFinal, imagemUrl } = getEtapaInfo(etapa);
                        const etapaId = obterChaveTarefa(etapa);
                        const isSelected = selecionados.some(i => obterChaveTarefa(i) === etapaId);

                        const grupoInfo = getGrupoInfo(etapa);
                        const unificacaoAtiva = !!(grupoInfo && unificacoesAtivas.has(grupoInfo.grupo.grupo_id));
                        const grupoAtual = etapa.fase === 'POS_OP' ? 'POS_OP' : 'OP';
                        const grupoAnterior = indice > 0
                            ? (tarefasPaginadas[indice - 1].fase === 'POS_OP' ? 'POS_OP' : 'OP')
                            : null;
                        return (
                            <React.Fragment key={etapaId}>
                                {grupoAtual !== grupoAnterior && (
                                    <div className={`op-fila-secao op-fila-secao--${grupoAtual.toLowerCase()}`}>
                                        <strong>{grupoAtual === 'POS_OP' ? 'Arremates pós-OP' : 'Produção da OP'}</strong>
                                        <span>{grupoAtual === 'POS_OP'
                                            ? 'A OP já foi encerrada; estas tarefas liberam a embalagem.'
                                            : 'Etapas internas da ordem de produção.'}</span>
                                    </div>
                                )}
                                <OPEtapaCard
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
                            </React.Fragment>
                        );
                    })
                ) : (
                    <UIFeedbackNotFound
                        icon="fa-clipboard-list"
                        titulo={buscaTarefa ? 'Nenhuma tarefa encontrada' : 'Nenhuma tarefa disponível'}
                        mensagem={buscaTarefa
                            ? `Não encontramos tarefas para “${buscaTarefa}”. Tente outro produto, variante ou processo.`
                            : 'Não há tarefas compatíveis com este funcionário no momento.'}
                    />
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
