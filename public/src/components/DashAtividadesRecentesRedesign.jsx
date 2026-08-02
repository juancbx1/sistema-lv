import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAPI } from '/js/utils/api-utils';
import DashTabelaPontosModal from './DashTabelaPontosRedesign';
import PaginacaoWrapper from './OPPaginacaoWrapper';

const TIME_ZONE = 'America/Sao_Paulo';
const ITENS_POR_PAGINA = 8;

function dataHojeISO() {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const valores = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
    return `${valores.year}-${valores.month}-${valores.day}`;
}

function deslocarDataISO(dataISO, quantidade) {
    const data = new Date(`${dataISO}T12:00:00Z`);
    data.setUTCDate(data.getUTCDate() + quantidade);
    return data.toISOString().slice(0, 10);
}

function diferencaEmDias(dataInicial, dataFinal) {
    const inicio = Date.parse(`${dataInicial}T12:00:00Z`);
    const fim = Date.parse(`${dataFinal}T12:00:00Z`);
    return Math.round((fim - inicio) / 86400000);
}

function formatarDataCompleta(dataISO) {
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(new Date(`${dataISO}T12:00:00Z`));
}

function formatarDiaSemana(dataISO) {
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'UTC',
        weekday: 'long',
    }).format(new Date(`${dataISO}T12:00:00Z`));
}

function calcularDataAlvo(filtroPeriodo, dataEspecifica) {
    const hoje = dataHojeISO();
    if (filtroPeriodo === 'ontem') return deslocarDataISO(hoje, -1);
    if (filtroPeriodo === 'especifico' && dataEspecifica) return dataEspecifica;
    return hoje;
}

function descreverPeriodo(filtroPeriodo, dataEspecifica, termoBusca) {
    const hoje = dataHojeISO();
    const dataAlvo = calcularDataAlvo(filtroPeriodo, dataEspecifica);
    const distancia = diferencaEmDias(dataAlvo, hoje);
    let titulo;
    let etiqueta;

    if (distancia === 0) {
        titulo = 'Seu ritmo de hoje';
        etiqueta = 'Hoje';
    } else if (distancia === 1) {
        titulo = 'Seu ritmo de ontem';
        etiqueta = 'Ontem';
    } else if (distancia > 1 && distancia < 7) {
        titulo = `Seu ritmo de ${formatarDiaSemana(dataAlvo)}`;
        etiqueta = formatarDataCompleta(dataAlvo);
    } else if (distancia >= 7 && distancia < 365) {
        const semanas = Math.max(1, Math.round(distancia / 7));
        titulo = `Seu ritmo de ${semanas} ${semanas === 1 ? 'semana' : 'semanas'} atrás`;
        etiqueta = formatarDataCompleta(dataAlvo);
    } else {
        titulo = `Seu ritmo em ${formatarDataCompleta(dataAlvo)}`;
        etiqueta = formatarDataCompleta(dataAlvo);
    }

    const busca = termoBusca.trim();
    return {
        dataAlvo,
        titulo,
        etiqueta,
        contexto: busca
            ? `Resultados para “${busca}” em ${formatarDataCompleta(dataAlvo)}.`
            : `Atividades registradas em ${formatarDataCompleta(dataAlvo)}.`,
    };
}

function converterData(data) {
    if (!data) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(data))) {
        return new Date(`${data}T12:00:00Z`);
    }
    return new Date(data);
}

function formatarDataAtividade(data) {
    const convertido = converterData(data);
    if (!convertido || Number.isNaN(convertido.getTime())) return '--';
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: TIME_ZONE,
        day: '2-digit',
        month: 'short',
    }).format(convertido).replace('.', '');
}

function formatarHoraAtividade(data) {
    const convertido = converterData(data);
    if (!convertido || Number.isNaN(convertido.getTime())) return '--:--';
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
    }).format(convertido);
}

function formatarPontos(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

export default function DashAtividadesRecentesRedesign() {
    const hoje = dataHojeISO();
    const [filtroPeriodo, setFiltroPeriodo] = useState('hoje');
    const [dataEspecifica, setDataEspecifica] = useState(hoje);
    const [termoInput, setTermoInput] = useState('');
    const [termoBusca, setTermoBusca] = useState('');
    const [paginaAtual, setPaginaAtual] = useState(1);
    const [listaAtividades, setListaAtividades] = useState([]);
    const [loading, setLoading] = useState(false);
    const [modalTabelaAberto, setModalTabelaAberto] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setTermoBusca(termoInput), 600);
        return () => clearTimeout(timer);
    }, [termoInput]);

    const dataAlvo = useMemo(
        () => calcularDataAlvo(filtroPeriodo, dataEspecifica),
        [filtroPeriodo, dataEspecifica]
    );

    const periodo = useMemo(
        () => descreverPeriodo(filtroPeriodo, dataEspecifica, termoBusca),
        [filtroPeriodo, dataEspecifica, termoBusca]
    );

    const buscarAtividades = useCallback(async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams({
                data: dataAlvo,
                busca: termoBusca,
            });
            const resultado = await fetchAPI(`/api/dashboard/atividades?${query.toString()}`);
            setListaAtividades(resultado.rows || []);
            setPaginaAtual(1);
        } catch (error) {
            console.error('[Dashboard] Erro ao buscar atividades:', error);
            setListaAtividades([]);
        } finally {
            setLoading(false);
        }
    }, [dataAlvo, termoBusca]);

    useEffect(() => {
        buscarAtividades();
    }, [buscarAtividades]);

    const totalPaginas = Math.ceil(listaAtividades.length / ITENS_POR_PAGINA) || 1;
    const itensParaExibir = listaAtividades.slice(
        (paginaAtual - 1) * ITENS_POR_PAGINA,
        paginaAtual * ITENS_POR_PAGINA
    );
    const totalQuantidade = useMemo(
        () => listaAtividades.reduce((total, item) => total + Number(item.quantidade || 0), 0),
        [listaAtividades]
    );
    const totalPontos = useMemo(
        () => listaAtividades.reduce((total, item) => total + Number(item.pontos_gerados || 0), 0),
        [listaAtividades]
    );
    const maiorPontuacao = useMemo(
        () => Math.max(...listaAtividades.map((item) => Number(item.pontos_gerados || 0)), 1),
        [listaAtividades]
    );
    const barrasRitmo = listaAtividades.slice(0, 8).reverse();

    const selecionarHoje = () => {
        setFiltroPeriodo('hoje');
        setDataEspecifica(dataHojeISO());
        setTermoInput('');
    };

    const selecionarOntem = () => {
        setFiltroPeriodo('ontem');
        setDataEspecifica(deslocarDataISO(dataHojeISO(), -1));
        setTermoInput('');
    };

    const selecionarData = (event) => {
        setFiltroPeriodo('especifico');
        setDataEspecifica(event.target.value);
        setTermoInput('');
    };

    return (
        <section className="ds-card ds-atividades-redesign" aria-label="Atividades recentes">
            <div className="ds-atividades-redesign-cabecalho">
                <div className="ds-atividades-redesign-titulo">
                    <span className="ds-atividades-redesign-kicker">Atividades recentes</span>
                    <h2>{periodo.titulo}</h2>
                    <p>{periodo.contexto}</p>
                </div>
                <div className="ds-atividades-redesign-total">
                    <strong>+{formatarPontos(totalPontos)} pts</strong>
                    <span>{listaAtividades.length} {listaAtividades.length === 1 ? 'registro' : 'registros'}</span>
                </div>
            </div>

            <div className="ds-atividades-redesign-controles">
                <div className="ds-atividades-redesign-busca">
                    <i className="fas fa-search" aria-hidden="true" />
                    <input
                        type="search"
                        value={termoInput}
                        onChange={(event) => setTermoInput(event.target.value)}
                        placeholder="Buscar OP, produto ou variação"
                        aria-label="Buscar atividade"
                    />
                    <button
                        type="button"
                        className="ds-atividades-redesign-atualizar"
                        onClick={buscarAtividades}
                        aria-label="Atualizar atividades"
                        title="Atualizar atividades"
                    >
                        <i className={`fas fa-sync-alt${loading ? ' fa-spin' : ''}`} aria-hidden="true" />
                    </button>
                </div>
                <div className="ds-atividades-redesign-filtros" aria-label="Filtrar atividades por período">
                    <span>Período</span>
                    <button type="button" className={filtroPeriodo === 'hoje' ? 'ativo' : ''} onClick={selecionarHoje}>Hoje</button>
                    <button type="button" className={filtroPeriodo === 'ontem' ? 'ativo' : ''} onClick={selecionarOntem}>Ontem</button>
                    <label className={filtroPeriodo === 'especifico' ? 'ativo' : ''}>
                        <i className="fas fa-calendar-alt" aria-hidden="true" />
                        <input type="date" value={dataEspecifica} onChange={selecionarData} aria-label="Escolher data específica" />
                    </label>
                </div>
            </div>

            <div className="ds-atividades-redesign-resumo">
                <div>
                    <strong>{totalQuantidade}</strong>
                    <span>processos</span>
                </div>
                <div>
                    <strong>{formatarPontos(totalPontos)}</strong>
                    <span>pontos no período</span>
                </div>
                <div className="ds-atividades-redesign-barras" aria-label="Distribuição de pontos nas atividades">
                    {barrasRitmo.length > 0 ? barrasRitmo.map((item, index) => (
                        <span
                            key={`${item.id || item.id_original || index}-barra`}
                            style={{ height: `${Math.max(22, Math.round((Number(item.pontos_gerados || 0) / maiorPontuacao) * 100))}%` }}
                        />
                    )) : <span className="vazio" />}
                </div>
            </div>

            <div className="ds-atividades-redesign-grupo">
                <span>{periodo.etiqueta}</span>
            </div>

            <div className="ds-atividades-redesign-lista">
                {loading ? (
                    <div className="ds-atividades-redesign-vazio"><div className="ds-spinner" /></div>
                ) : itensParaExibir.length === 0 ? (
                    <div className="ds-atividades-redesign-vazio">
                        <i className="fas fa-calendar-check" aria-hidden="true" />
                        <strong>Nenhuma atividade encontrada</strong>
                        <span>Tente escolher outra data ou ajustar a busca.</span>
                    </div>
                ) : itensParaExibir.map((item, index) => {
                    const extra = item.tipo_origem === 'PontosExtra';
                    const nomeProduto = extra ? 'Bônus do supervisor' : (item.nome_produto || 'Produto sem nome');
                    const processo = extra ? 'Pontos extras' : (item.processo || 'Processo registrado');
                    const chave = item.id_original || item.id || `${item.data}-${index}`;

                    return (
                        <article key={chave} className={`ds-atividades-redesign-evento${extra ? ' ds-atividades-redesign-evento--extra' : ''}`}>
                            <div className="ds-atividades-redesign-marcador">
                                <i className={`fas ${extra ? 'fa-star' : 'fa-check'}`} aria-hidden="true" />
                            </div>
                            <div className="ds-atividades-redesign-evento-corpo">
                                <div className="ds-atividades-redesign-evento-topo">
                                    <div>
                                        <span className="ds-atividades-redesign-processo">{processo}</span>
                                        <span className="ds-atividades-redesign-status">{extra ? 'Bônus creditado' : 'Registrada'}</span>
                                    </div>
                                    <time dateTime={item.data}>{formatarHoraAtividade(item.data)}</time>
                                </div>
                                <h3>{nomeProduto}</h3>
                                {extra ? (
                                    <div className="ds-atividades-redesign-metadados">
                                        <span><b>Origem</b> lançamento extra</span>
                                    </div>
                                ) : (
                                    <div className="ds-atividades-redesign-metadados">
                                        <span><b>Variação</b> {item.variacao || '—'}</span>
                                        <span><b>OP</b> {item.op_numero || '—'}</span>
                                        <span><b>Processo</b> {item.processo || '—'}</span>
                                    </div>
                                )}
                                <div className="ds-atividades-redesign-rodape-evento">
                                    <span><i className="fas fa-calendar-alt" aria-hidden="true" />{formatarDataAtividade(item.data)}</span>
                                    {!extra && <span><i className="fas fa-box" aria-hidden="true" />{item.quantidade || 0} peças</span>}
                                    <strong
                                        className="ds-atividades-redesign-pontos"
                                        aria-label={`${formatarPontos(item.pontos_gerados)} pontos gerados`}
                                    >
                                        +{formatarPontos(item.pontos_gerados)} pts
                                    </strong>
                                </div>
                            </div>
                        </article>
                    );
                })}
            </div>

            <div className="ds-atividades-redesign-acoes">
                <button type="button" className="ds-atividades-redesign-tabela" onClick={() => setModalTabelaAberto(true)}>
                    <i className="fas fa-info-circle" aria-hidden="true" />
                    Ver tabela de pontos
                </button>
                {totalPaginas > 1 && (
                    <PaginacaoWrapper
                        totalPages={totalPaginas}
                        currentPage={paginaAtual}
                        onPageChange={setPaginaAtual}
                    />
                )}
            </div>

            {modalTabelaAberto && <DashTabelaPontosModal onClose={() => setModalTabelaAberto(false)} />}
        </section>
    );
}
