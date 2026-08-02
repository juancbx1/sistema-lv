import React, { useState, useEffect, useCallback, useMemo } from 'react';
// @ts-expect-error módulo JS legado sem tipos
import { fetchAPI } from '/js/utils/api-utils';
import DashTabelaPontosModal from './DashTabelaPontosRedesign';
import type { DashAtividade, DashAtividadesResponse, DashFiltroPeriodoAtividades } from '../utils/dashboard-types';

export default function DashAtividadesLista({ aoAtualizar }: { aoAtualizar?: () => void } = {}) {
    const [filtroPeriodo, setFiltroPeriodo] = useState<DashFiltroPeriodoAtividades>('hoje');
    const [dataEspecifica, setDataEspecifica] = useState(''); 
    const [termoInput, setTermoInput] = useState(''); // Visual
    const [termoBusca, setTermoBusca] = useState(''); // API
    const [paginaAtual, setPaginaAtual] = useState(1);
    
    const [listaAtividades, setListaAtividades] = useState<DashAtividade[]>([]);
    const [loading, setLoading] = useState(false);
    
    const ITENS_POR_PAGINA = 8;

    const getDataLocalISO = (d: Date = new Date()) => {
        const ano = d.getFullYear();
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const dia = String(d.getDate()).padStart(2, '0');
        return `${ano}-${mes}-${dia}`;
    };

    useEffect(() => {
        setDataEspecifica(getDataLocalISO());
    }, []);

    // 1. DEBOUNCE DA BUSCA
    useEffect(() => {
        const timer = setTimeout(() => {
            setTermoBusca(termoInput);
        }, 600);
        return () => clearTimeout(timer);
    }, [termoInput]);

    // 2. FUNÇÃO DE BUSCA NA API
    const buscarAtividades = useCallback(async () => {
        setLoading(true);
        try {
            let dataParam = '';
            
            if (filtroPeriodo === 'hoje') {
                dataParam = getDataLocalISO(new Date());
            } else if (filtroPeriodo === 'ontem') {
                const ontem = new Date();
                ontem.setDate(ontem.getDate() - 1);
                dataParam = getDataLocalISO(ontem);
            } else if (filtroPeriodo === 'especifico') {
                dataParam = dataEspecifica;
            }

            if (termoBusca.trim().length > 0) {
                // Se tiver busca texto, MANTÉM a data também para filtrar dentro do dia/período
                // Se quiser buscar em TODO o histórico ao digitar, descomente a linha abaixo:
                // dataParam = ''; 
            }

            const query = new URLSearchParams({
                data: dataParam,
                busca: termoBusca
            });

            const resultado = await fetchAPI(`/api/dashboard/atividades?${query.toString()}`) as DashAtividadesResponse;
            
            // Salva a lista completa retornada
            setListaAtividades(resultado.rows || []);
            setPaginaAtual(1); // Reseta paginação ao buscar novos dados

        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [filtroPeriodo, dataEspecifica, termoBusca]);

    // Dispara busca quando filtros mudam
    useEffect(() => {
        buscarAtividades();
    }, [buscarAtividades]);


    // --- CÁLCULOS NO FRONTEND (Reativos) ---
    
    // 1. Total de Páginas (Calculado na hora)
    const totalPaginasCalculado = Math.ceil(listaAtividades.length / ITENS_POR_PAGINA) || 1;

    // 2. Fatiamento da Lista (Paginação)
    const indiceInicial = (paginaAtual - 1) * ITENS_POR_PAGINA;
    const itensParaExibir = listaAtividades.slice(indiceInicial, indiceInicial + ITENS_POR_PAGINA);

    // 3. Totalizadores (Baseado na lista completa filtrada)
    const totalQtd = useMemo(() => listaAtividades.reduce((acc, i) => acc + (Number(i.quantidade)||0), 0), [listaAtividades]);
    const totalPontos = useMemo(() => listaAtividades.reduce((acc, i) => acc + (Number(i.pontos_gerados)||0), 0), [listaAtividades]);

    // Controles e Formatadores
    const selecionarHoje = () => { setFiltroPeriodo('hoje'); setDataEspecifica(getDataLocalISO(new Date())); setTermoInput(''); };
    const selecionarOntem = () => { setFiltroPeriodo('ontem'); const d=new Date(); d.setDate(d.getDate()-1); setDataEspecifica(getDataLocalISO(d)); setTermoInput(''); };
    const selecionarEspecifico = (e: React.ChangeEvent<HTMLInputElement>) => { setDataEspecifica(e.target.value); setFiltroPeriodo('especifico'); setTermoInput(''); };
    const fmtData = (iso?: string | null) => new Date(iso || 0).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const fmtHora = (iso?: string | null) => new Date(iso || 0).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

    const [modalTabelaAberto, setModalTabelaAberto] = useState(false);

    return (
        <section className="ds-card ds-atividades-timeline-panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <h2 className="ds-card-titulo" style={{ margin: 0 }}>Atividades recentes</h2>
                <button
                    onClick={() => setModalTabelaAberto(true)}
                    title="Ver minha tabela de pontos"
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--ds-cor-primaria)', fontSize: '1.1rem',
                        padding: '2px 4px', lineHeight: 1
                    }}
                >
                    <i className="fas fa-info-circle"></i>
                </button>
            </div>
            {modalTabelaAberto && (
                <DashTabelaPontosModal onClose={() => setModalTabelaAberto(false)} />
            )}
            
            <div className="ds-controles-detalhamento" style={{marginBottom:'20px'}}>
                <div style={{display:'flex', gap:'10px', marginBottom:'10px'}}>
                    <input 
                        type="text" 
                        className="ds-input" 
                        placeholder="Buscar OP ou Produto..." 
                        value={termoInput}
                        onChange={(e) => setTermoInput(e.target.value)}
                        style={{flexGrow:1}}
                    />
                    <button className="ds-btn ds-btn-outline-primario" onClick={buscarAtividades} title="Recarregar">
                        <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`}></i>
                    </button>
                </div>
                 <div className="ds-filtros-ativos-container" style={{display:'flex', gap:'10px', alignItems:'center', flexWrap:'wrap'}}>
                    <span style={{fontWeight:'600', fontSize:'0.9rem', color:'#666'}}>Período:</span>
                    <button className={`ds-btn ds-btn-pequeno ${filtroPeriodo === 'hoje' ? 'ds-btn-filtro-ativo' : 'ds-btn-filtro-inativo'}`} onClick={selecionarHoje}>Hoje</button>
                    <button className={`ds-btn ds-btn-pequeno ${filtroPeriodo === 'ontem' ? 'ds-btn-filtro-ativo' : 'ds-btn-filtro-inativo'}`} onClick={selecionarOntem}>Ontem</button>
                    <input type="date" className="ds-input" style={{width:'auto', padding:'5px'}} value={dataEspecifica} onChange={selecionarEspecifico}/>
                </div>
            </div>

            <div className="ds-totalizadores-container" style={{display:'flex', justifyContent:'space-around', backgroundColor:'#f8f9fa', padding:'15px', borderRadius:'12px', marginBottom:'20px', border:'1px solid #dee2e6'}}>
                <div style={{textAlign:'center'}}>
                    <span style={{display:'block', fontSize:'0.85rem', color:'#666', fontWeight:'600'}}>Total Processos</span>
                    <strong style={{fontSize:'1.4rem', color:'var(--ds-cor-primaria)'}}>{totalQtd}</strong>
                </div>
                <div style={{textAlign:'center'}}>
                    <span style={{display:'block', fontSize:'0.85rem', color:'#666', fontWeight:'600'}}>Total Pontos</span>
                    <strong style={{fontSize:'1.4rem', color:'var(--ds-cor-sucesso)'}}>{Math.round(totalPontos)}</strong>
                </div>
            </div>

            <div className="ds-atividades-wrapper">
                {loading ? <div className="ds-spinner" style={{margin:'40px auto'}}></div> : (
                    <ul className="ds-atividades-lista">
                        {listaAtividades.length === 0 ? (
                            <li className="ds-item-vazio" style={{textAlign:'center', padding:'30px', color:'#999', fontStyle:'italic'}}>
                                Nenhuma atividade encontrada.
                            </li>
                        ) : (
                            itensParaExibir.map((item, index) => {
                                const key = item.id_original || index;

                                // ── Item especial: Pontos Extras ──────────────────
                                if (item.tipo_origem === 'PontosExtra') {
                                    return (
                                        <div key={key} className="ds-atividade-pontos-extra">
                                            <div className="ds-ape-estrela">
                                                <i className="fas fa-star"></i>
                                            </div>
                                            <div className="ds-ape-corpo">
                                                <div className="ds-ape-titulo">✨ Bônus do Supervisor</div>
                                                <div className="ds-ape-info">
                                                    <span>
                                                        <i className="fas fa-calendar-alt"></i>
                                                        {fmtData(item.data)}
                                                    </span>
                                                    <span>
                                                        <i className="fas fa-clock"></i>
                                                        Creditado às {fmtHora(item.data)}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="ds-ape-pontos">
                                                <span className="ds-ape-pontos-valor">
                                                    +{parseFloat(String(item.pontos_gerados ?? '')).toFixed(0)}
                                                </span>
                                                <span className="ds-ape-pontos-label">pts</span>
                                            </div>
                                        </div>
                                    );
                                }

                                // ── Item normal: OP / Arremate ────────────────────
                                const tituloTipo = `OP ${item.op_numero}`;
                                const variacao = item.variacao || '';

                                return (
                                    <div key={key} className="ds-atividade-item" style={{
                                        backgroundColor:'#fff',
                                        border:'1px solid #eee',
                                        borderRadius:'8px',
                                        padding:'15px',
                                        marginBottom:'10px',
                                        display:'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                        gap: '10px'
                                    }}>
                                        <div style={{gridColumn: '1 / -1'}}>
                                            <small style={{display:'block', color:'#999', fontSize:'0.75rem', fontWeight:'bold'}}>PRODUTO</small>
                                            <span style={{fontWeight:'600', color:'#333'}}>
                                                {item.nome_produto}
                                                {variacao && <span style={{color: '#555', marginLeft: '5px'}}>[{variacao}]</span>}
                                            </span>
                                        </div>
                                        <div><small style={{display:'block', color:'#999', fontSize:'0.75rem', fontWeight:'bold'}}>TIPO/PROCESSO</small><span>{tituloTipo} - {item.processo}</span></div>
                                        <div><small style={{display:'block', color:'#999', fontSize:'0.75rem', fontWeight:'bold'}}>DATA</small><span>{fmtData(item.data)}</span></div>
                                        <div><small style={{display:'block', color:'#999', fontSize:'0.75rem', fontWeight:'bold'}}>HORA</small><span>{fmtHora(item.data)}</span></div>
                                        <div><small style={{display:'block', color:'#999', fontSize:'0.75rem', fontWeight:'bold'}}>QUANTIDADE</small><strong style={{fontSize:'1.1rem'}}>{item.quantidade}</strong></div>
                                        <div><small style={{display:'block', color:'#999', fontSize:'0.75rem', fontWeight:'bold'}}>PONTOS</small><strong style={{color:'var(--ds-cor-primaria)', fontSize:'1.1rem'}}>{parseFloat(String(item.pontos_gerados ?? '')).toFixed(2)}</strong></div>
                                    </div>
                                );
                            })
                        )}
                    </ul>
                )}
            </div>

            {/* Paginação */}
            {totalPaginasCalculado > 1 && (
                <div className="ds-paginacao" style={{display:'flex', justifyContent:'center', alignItems:'center', gap:'15px', marginTop:'20px'}}>
                    <button 
                        className="ds-btn ds-btn-outline-primario" 
                        disabled={paginaAtual === 1} 
                        onClick={() => setPaginaAtual(p => Math.max(1, p - 1))}
                    >
                        Anterior
                    </button>
                    
                    <span style={{fontWeight:'bold', color:'var(--ds-cor-primaria)'}}>
                        Pág. {paginaAtual} de {totalPaginasCalculado}
                    </span>
                    
                    <button 
                        className="ds-btn ds-btn-outline-primario" 
                        disabled={paginaAtual === totalPaginasCalculado} 
                        onClick={() => setPaginaAtual(p => Math.min(totalPaginasCalculado, p + 1))}
                    >
                        Próximo
                    </button>
                </div>
            )}
        </section>
    );
}
