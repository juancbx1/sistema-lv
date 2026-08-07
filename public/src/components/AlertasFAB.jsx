// public/src/components/AlertasFAB.jsx

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import '/css/alertas-central.css';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UICarregando from './UICarregando';

const POLLING_INTERVALO      = 4 * 60 * 1000; // 4 minutos
const COOLDOWN_SOM_MS        = 2 * 60 * 1000; // 2 minutos entre sons
const MAX_ERROS_CONSECUTIVOS = 5;             // após 5 erros seguidos, para de pollar até próxima visita

export default function AlertasFAB() {
    const [aberto, setAberto]               = useState(false);
    const [alertas, setAlertas]             = useState([]);
    const [naoLidos, setNaoLidos]           = useState(0);
    const [snoozedAte, setSnoozedAte]       = useState(0);
    const [popup, setPopup]                 = useState(null); // { mensagem, nivel, extras }
    const [pausarCountdown, setPausarCountdown] = useState(false);
    const [verificando, setVerificando]     = useState(false);
    const [ultimaVerificacao, setUltimaVerificacao] = useState(null);
    const [filtroArea, setFiltroArea]           = useState('todos');
    const [historico, setHistorico]             = useState(null);
    const [carregandoHistorico, setCarregandoHistorico] = useState(false);
    const [pesosRisco, setPesosRisco]           = useState({});
    const [horarioExpediente, setHorarioExpediente] = useState({ inicio: '07:00', fim: '18:00' });
    const [dicasExpandidas, setDicasExpandidas] = useState(true);

    const audioRef            = useRef(null);
    const ultimoSomRef        = useRef(0);
    const intervalRef         = useRef(null);
    const popupTimerRef       = useRef(null);
    const barraRef            = useRef(null);
    const errosConsecutivos   = useRef(0);
    // Janela de polling configurável — carregada do DB no init, usada em verificarAlertas.
    // Ref (não state) para evitar re-render e estar sempre disponível no callback.
    const janelaPollRef       = useRef({ inicio: '06:00', fim: '23:00' });

    // --- Inicialização ---
    useEffect(() => {
        audioRef.current = new Audio('/sounds/alerta.mp3');
        audioRef.current.preload = 'auto';
        const snoozeStorage = parseInt(localStorage.getItem('alertas_snooze_ate') || '0');
        setSnoozedAte(snoozeStorage);

        // Carregar pesos de risco e horário de expediente
        const token = localStorage.getItem('token');
        const headers = { 'Authorization': `Bearer ${token}` };
        Promise.all([
            fetch('/api/alertas/configuracoes', { headers }).then(r => r.ok ? r.json() : []),
            fetch('/api/alertas/dias-trabalho',  { headers }).then(r => r.ok ? r.json() : {}),
        ]).then(([configs, diasConfig]) => {
            const pesos = {};
            configs.forEach(c => { pesos[c.tipo_alerta] = c.peso_risco ?? 0; });
            setPesosRisco(pesos);
            setHorarioExpediente({
                inicio: diasConfig.horario_inicio || '07:00',
                fim:    diasConfig.horario_fim    || '18:00',
            });
            // Atualiza a janela de polling com o valor configurado no banco
            janelaPollRef.current = {
                inicio: diasConfig.janela_poll_inicio || '06:00',
                fim:    diasConfig.janela_poll_fim    || '23:00',
            };
        }).catch(() => {});
    }, []);

    // --- Som com cooldown ---
    const tocarSom = useCallback(() => {
        const agora = Date.now();
        if (agora - ultimoSomRef.current >= COOLDOWN_SOM_MS) {
            if (audioRef.current) {
                audioRef.current.currentTime = 0;
                audioRef.current.load();
                audioRef.current.play().catch(() => {});
            }
            ultimoSomRef.current = agora;
        }
    }, []);

    // --- Popup ---
    const dispararPopup = useCallback((novosAlertas) => {
        const criticos = novosAlertas.filter(a => a.nivel === 'critico');
        if (criticos.length === 0) return;
        setPopup({
            mensagem:     criticos[0].mensagem,
            nivel:        'critico',
            extras:       criticos.length - 1,
            dados_extras: criticos[0].dados_extras || null,
        });
    }, []);

    // Auto-dismiss 5s — pausável com hover
    useEffect(() => {
        if (!popup || pausarCountdown) return;
        popupTimerRef.current = setTimeout(() => setPopup(null), 5000);
        return () => clearTimeout(popupTimerRef.current);
    }, [popup, pausarCountdown]);

    // Animar barra de progresso (precisa de 2 frames para a transição funcionar)
    useEffect(() => {
        if (!popup || !barraRef.current) return;
        barraRef.current.style.width = '100%';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (barraRef.current) barraRef.current.style.width = '0%';
            });
        });
    }, [popup]);

    // --- Polling ---
    const verificarAlertas = useCallback(async () => {
        // Verificar janela de polling configurável (economiza créditos Vercel fora do horário de trabalho).
        // Diferente do horário de expediente (que fica no servidor), esse check é puramente frontend:
        // se estiver fora da janela, simplesmente não chamamos a API.
        const agora = new Date();
        const minAtual = agora.getHours() * 60 + agora.getMinutes();
        const [hI, mI] = janelaPollRef.current.inicio.split(':').map(Number);
        const [hF, mF] = janelaPollRef.current.fim.split(':').map(Number);
        const dentroJanela = minAtual >= hI * 60 + mI && minAtual <= hF * 60 + mF;
        if (!dentroJanela) return;

        if (errosConsecutivos.current >= MAX_ERROS_CONSECUTIVOS) return;

        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/alertas/verificar-status', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) {
                errosConsecutivos.current += 1;
                console.warn('[Alertas] API retornou erro:', res.status, `(${errosConsecutivos.current}/${MAX_ERROS_CONSECUTIVOS})`);
                return;
            }
            errosConsecutivos.current = 0; // resetar ao ter sucesso
            const novosAlertas = await res.json();
            setUltimaVerificacao(new Date());
            console.log('[Alertas] Resposta da API:', novosAlertas.length === 0 ? 'nenhum alerta' : novosAlertas);

            if (novosAlertas.length > 0) {
                // Adicionar _id único para permitir dismiss individual
                const alertasComId = novosAlertas.map((a, i) => ({ ...a, _id: `${a.tipo}-${i}` }));
                setAlertas(alertasComId);
                setNaoLidos(alertasComId.length);

                const temCritico = novosAlertas.some(a => a.nivel === 'critico');
                const snoozado   = Date.now() < snoozedAte;

                if (temCritico && !snoozado) {
                    tocarSom();
                    dispararPopup(novosAlertas);
                }
            }
        } catch {
            errosConsecutivos.current += 1;
            // Falha silenciosa — não interrompe o supervisor
        }
    }, [snoozedAte, tocarSom, dispararPopup]);

    useEffect(() => {
        verificarAlertas();

        intervalRef.current = setInterval(() => {
            if (document.visibilityState !== 'hidden') verificarAlertas();
        }, POLLING_INTERVALO);

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                errosConsecutivos.current = 0; // resetar backoff ao voltar à aba
                verificarAlertas();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            clearInterval(intervalRef.current);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [verificarAlertas]);

    // --- Snooze ---
    const handleSnooze = () => {
        const ate = Date.now() + 30 * 60 * 1000;
        setSnoozedAte(ate);
        localStorage.setItem('alertas_snooze_ate', String(ate));
    };

    const handleCancelarSnooze = () => {
        setSnoozedAte(0);
        localStorage.removeItem('alertas_snooze_ate');
    };

    const isSnoozado = Date.now() < snoozedAte;

    // --- Histórico do dia ---
    const handleAbrirHistorico = async () => {
        setCarregandoHistorico(true);
        setHistorico([]);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/alertas/historico', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) setHistorico(await res.json());
        } catch { /* silencioso */ }
        setCarregandoHistorico(false);
    };

    // --- Dismiss individual ---
    const handleDismiss = (alertaId) => {
        setAlertas(prev => {
            const nova = prev.filter(a => a._id !== alertaId);
            setNaoLidos(nova.length);
            return nova;
        });
    };

    // --- Estados visuais do FAB ---
    const temCritico = alertas.some(a => a.nivel === 'critico');
    const temAviso   = !temCritico && alertas.some(a => a.nivel === 'aviso');

    // --- Score de Risco do Turno ---
    const calcularScore = (alertasAtivos, pesos) => {
        const total = alertasAtivos.reduce((acc, a) => acc + (pesos[a.tipo] || 0), 0);
        return Math.max(0, Math.min(100, total));
    };

    const estaNoExpediente = useMemo(() => {
        const agora = new Date();
        const min = agora.getHours() * 60 + agora.getMinutes();
        const [hI, mI] = horarioExpediente.inicio.split(':').map(Number);
        const [hF, mF] = horarioExpediente.fim.split(':').map(Number);
        return min >= hI * 60 + mI && min <= hF * 60 + mF;
    }, [horarioExpediente, ultimaVerificacao]); // recalcular após cada poll

    const progressoTurno = useMemo(() => {
        const agora = new Date();
        const min = agora.getHours() * 60 + agora.getMinutes();
        const [hI, mI] = horarioExpediente.inicio.split(':').map(Number);
        const [hF, mF] = horarioExpediente.fim.split(':').map(Number);
        const total = hF * 60 + mF - (hI * 60 + mI);
        const passados = min - (hI * 60 + mI);
        return total > 0 ? Math.max(0, Math.min(100, Math.round((passados / total) * 100))) : 0;
    }, [horarioExpediente, ultimaVerificacao]);

    const scoreRisco = useMemo(() => calcularScore(alertas, pesosRisco), [alertas, pesosRisco]);

    const faixaScore = scoreRisco <= 30 ? 'tranquilo' : scoreRisco <= 60 ? 'atencao' : 'elevado';
    const labelScore = faixaScore === 'tranquilo' ? 'Tranquilo' : faixaScore === 'atencao' ? 'Atenção' : 'Elevado';

    // --- IA de Dicas ---
    const REGRAS_DICAS = [
        {
            id: 'match_perfeito', prioridade: 1,
            condicao: (al) => al.some(a => a.tipo.includes('OCIOSIDADE')) && al.some(a => a.tipo === 'DEMANDA_NAO_INICIADA'),
            dica: (al) => {
                const n = al.filter(a => a.tipo.includes('OCIOSIDADE')).length;
                return `${n} funcionário${n > 1 ? 's' : ''} ocioso${n > 1 ? 's' : ''} e demandas aguardando. Faça a alocação agora — é a ação de maior impacto no momento.`;
            },
            icone: 'fa-bolt', cor: 'critico', label: 'Oportunidade imediata',
        },
        {
            id: 'demanda_prioritaria', prioridade: 1,
            condicao: (al) => al.some(a => a.tipo === 'DEMANDA_PRIORITARIA'),
            dica: () => 'Demanda urgente ativa. Aloque o funcionário mais experiente disponível e confirme o prazo com quem criou a demanda.',
            icone: 'fa-fire', cor: 'critico', label: 'Demanda urgente',
        },
        {
            id: 'ociosidade_multipla', prioridade: 2,
            condicao: (al) => al.filter(a => a.tipo.includes('OCIOSIDADE')).length >= 2,
            dica: (al) => {
                const n = al.filter(a => a.tipo.includes('OCIOSIDADE')).length;
                return `${n} funcionários ociosos ao mesmo tempo. Verifique se há OPs disponíveis para distribuir ou gargalo de insumos.`;
            },
            icone: 'fa-users', cor: 'critico', label: 'Múltiplas ociosidades',
        },
        {
            id: 'lentidao_generalizada', prioridade: 2,
            condicao: (al) => al.filter(a => a.tipo.includes('LENTIDAO')).length >= 2,
            dica: () => 'Lentidão em múltiplos setores. Pode indicar problema de maquinário, insumo ou distração. Vale uma ronda pela fábrica.',
            icone: 'fa-tachometer-alt', cor: 'aviso', label: 'Lentidão generalizada',
        },
        {
            id: 'demanda_nao_iniciada', prioridade: 3,
            condicao: (al) => al.some(a => a.tipo === 'DEMANDA_NAO_INICIADA') && !al.some(a => a.tipo.includes('OCIOSIDADE')),
            dica: () => 'Demanda parada sem funcionários ociosos. Verifique quando o próximo ficará disponível e avise sobre a alocação.',
            icone: 'fa-hourglass-half', cor: 'aviso', label: 'Demanda esperando fila',
        },
        {
            id: 'lentidao_simples', prioridade: 3,
            condicao: (al) => al.some(a => a.tipo.includes('LENTIDAO')) && al.filter(a => a.tipo.includes('LENTIDAO')).length < 2,
            dica: () => 'Ritmo abaixo do esperado. Verifique se há dificuldade técnica, necessidade de troca de agulha/linha ou perda de concentração.',
            icone: 'fa-clock', cor: 'aviso', label: 'Ritmo lento',
        },
        {
            id: 'score_elevado_difuso', prioridade: 4,
            condicao: (al, sc) => sc >= 60 && al.length >= 3,
            dica: () => 'Vários problemas simultâneos. Priorize: demandas urgentes primeiro, ociosidade em seguida, lentidão por último.',
            icone: 'fa-list-ol', cor: 'aviso', label: 'Priorize as ações',
        },
        {
            id: 'meta_batida', prioridade: 5,
            condicao: (al) => al.some(a => a.tipo === 'META_BATIDA_ARREMATE'),
            dica: () => 'Meta de arremate batida! Bom momento para reconhecer a equipe. Verifique se há mais demandas para manter o fluxo.',
            icone: 'fa-trophy', cor: 'info', label: 'Meta atingida',
        },
        {
            id: 'turno_saudavel', prioridade: 5,
            condicao: (al, sc) => sc < 15 && al.length === 0,
            dica: () => 'Turno saudável. Nenhuma ação necessária. Bom momento para adiantar o planejamento do próximo turno.',
            icone: 'fa-check-circle', cor: 'info', label: 'Tudo tranquilo',
        },
    ];

    const dicas = useMemo(() =>
        REGRAS_DICAS
            .filter(r => r.condicao(alertas, scoreRisco))
            .sort((a, b) => a.prioridade - b.prioridade)
            .slice(0, 3)
            .map(r => ({
                id: r.id,
                texto: typeof r.dica === 'function' ? r.dica(alertas, scoreRisco) : r.dica,
                icone: r.icone, cor: r.cor, label: r.label,
            }))
    , [alertas, scoreRisco]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Filtro por área ---
    const MAPA_AREA = {
        costura:  ['OCIOSIDADE_COSTUREIRA', 'LENTIDAO_COSTUREIRA'],
        arremate: ['OCIOSIDADE_ARREMATE', 'LENTIDAO_CRITICA_ARREMATE', 'META_BATIDA_ARREMATE'],
        demandas: ['DEMANDA_NORMAL', 'DEMANDA_PRIORITARIA', 'DEMANDA_NAO_INICIADA'],
        rh:       ['HORA_EXTRA_LANCADA'],
    };
    const FILTROS = [
        { id: 'todos',    label: 'Todos' },
        { id: 'costura',  label: 'Costura' },
        { id: 'arremate', label: 'Arremate' },
        { id: 'demandas', label: 'Demandas' },
    ];
    const alertasFiltrados = filtroArea === 'todos'
        ? alertas
        : alertas.filter(a => (MAPA_AREA[filtroArea] || []).includes(a.tipo));

    // --- Mini-card de produto (demandas) ---
    const MiniCardProduto = ({ dados, compact = false }) => {
        if (!dados) return null;
        return (
            <div className={`alertas-produto-card${compact ? ' compact' : ''}`}>
                {dados.imagem ? (
                    <img
                        src={dados.imagem}
                        alt={dados.produto_nome}
                        className="alertas-produto-thumb"
                        onError={e => { e.target.style.display = 'none'; }}
                    />
                ) : (
                    <div className="alertas-produto-thumb alertas-produto-thumb-placeholder">
                        <i className="fas fa-tshirt"></i>
                    </div>
                )}
                <div className="alertas-produto-info">
                    <strong>{dados.produto_nome}</strong>
                    {dados.variante && <span className="alertas-produto-variante">{dados.variante}</span>}
                    {dados.quantidade && (
                        <span className="alertas-produto-qtd">{dados.quantidade} peça{dados.quantidade !== 1 ? 's' : ''}</span>
                    )}
                </div>
            </div>
        );
    };

    // --- Labels do popup ---
    const labelNivel = (nivel) =>
        nivel === 'critico' ? 'ALERTA CRÍTICO' :
        nivel === 'aviso'   ? 'AVISO' : 'INFORMAÇÃO';

    return (
        <>
            {/* ── Alerta Popup — canto superior direito ── */}
            {popup && (
                <div
                    className={`alertas-popup nivel-${popup.nivel}`}
                    onMouseEnter={() => setPausarCountdown(true)}
                    onMouseLeave={() => setPausarCountdown(false)}
                >
                    <div className="alertas-popup-header">
                        <i className="fas fa-bell"></i>
                        <span>{labelNivel(popup.nivel)}</span>
                    </div>
                    {popup.dados_extras ? (
                        <MiniCardProduto dados={popup.dados_extras} />
                    ) : (
                        <p className="alertas-popup-mensagem">{popup.mensagem}</p>
                    )}
                    <div className="alertas-popup-rodape">
                        {popup.extras > 0 && (
                            <span className="alertas-popup-extras">
                                +{popup.extras} alerta{popup.extras > 1 ? 's' : ''} no sino
                            </span>
                        )}
                        <button className="alertas-popup-ok" onClick={() => setPopup(null)}>OK</button>
                    </div>
                    <div className="alertas-popup-barra">
                        <div
                            className={`alertas-popup-barra-inner${pausarCountdown ? ' pausado' : ''}`}
                            ref={barraRef}
                        ></div>
                    </div>
                </div>
            )}

            {/* ── FAB (sino) ── */}
            <button
                className={`alertas-fab${temCritico ? ' tem-critico' : temAviso ? ' tem-aviso' : ''}`}
                onClick={() => { setAberto(true); setNaoLidos(0); setFiltroArea('todos'); }}
                title="Central de Alertas"
            >
                <i className="fas fa-bell"></i>
                {naoLidos > 0 && (
                    <span className="alertas-fab-badge">{naoLidos > 9 ? '9+' : naoLidos}</span>
                )}
            </button>

            {/* ── Drawer ── */}
            {aberto && (
                <>
                    <div className="alertas-overlay" onClick={() => setAberto(false)} />
                    <div className="alertas-drawer">
                        <div className="alertas-drawer-header">
                            <div>
                                <h2><i className="fas fa-bell"></i> Central de Alertas</h2>
                                <span className="alertas-drawer-subtitle">
                                    {isSnoozado
                                        ? `Silenciado por ${Math.ceil((snoozedAte - Date.now()) / 60000)} min`
                                        : 'Som ativo'
                                    }
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                {isSnoozado ? (
                                    <button className="alertas-btn-snooze ativo" onClick={handleCancelarSnooze} title="Ativar som novamente">
                                        <i className="fas fa-bell"></i>
                                    </button>
                                ) : (
                                    <button className="alertas-btn-snooze" onClick={handleSnooze} title="Silenciar por 30 minutos">
                                        <i className="fas fa-bell-slash"></i>
                                    </button>
                                )}
                                <button className="alertas-btn-fechar" onClick={() => setAberto(false)}>
                                    <i className="fas fa-times"></i>
                                </button>
                            </div>
                        </div>

                        {/* ── Score de Risco do Turno ── */}
                        <div className={`alertas-score-widget score-${faixaScore}`}>
                            <div className="alertas-score-titulo">
                                <i className="fas fa-chart-line"></i>
                                <span>Score de Risco do Turno</span>
                            </div>
                            {estaNoExpediente ? (
                                <>
                                    <div className="alertas-score-barra-container">
                                        <div className="alertas-score-barra">
                                            <div
                                                className="alertas-score-barra-inner"
                                                style={{ width: `${scoreRisco}%` }}
                                            ></div>
                                        </div>
                                        <span className="alertas-score-valor">{scoreRisco}%</span>
                                        <span className={`alertas-score-label score-${faixaScore}`}>{labelScore}</span>
                                    </div>
                                    <div className="alertas-score-turno">
                                        <div className="alertas-score-turno-barra">
                                            <div style={{ width: `${progressoTurno}%` }}></div>
                                        </div>
                                        <span>{progressoTurno}% do turno concluído</span>
                                    </div>
                                </>
                            ) : (
                                <div className="alertas-score-fora">
                                    <span className="alertas-score-valor">—</span>
                                    <span className="alertas-score-label">Fora do expediente</span>
                                </div>
                            )}
                            {ultimaVerificacao && (
                                <span className="alertas-score-timestamp">
                                    Atualizado às {ultimaVerificacao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            )}
                        </div>

                        {/* ── IA de Dicas ── */}
                        {dicas.length > 0 && (
                            <div className="alertas-dicas-container">
                                <div
                                    className="alertas-dicas-header"
                                    onClick={() => setDicasExpandidas(v => !v)}
                                >
                                    <span><i className="fas fa-lightbulb"></i> O que fazer agora</span>
                                    <i className={`fas fa-chevron-${dicasExpandidas ? 'up' : 'down'}`}></i>
                                </div>
                                {dicasExpandidas && dicas.map(d => (
                                    <div key={d.id} className={`alertas-dica-card cor-${d.cor}`}>
                                        <div className="alertas-dica-label">
                                            <i className={`fas ${d.icone}`}></i> {d.label}
                                        </div>
                                        <p>{d.texto}</p>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Chips de filtro por área */}
                        {alertas.length > 0 && (
                            <div className="alertas-filtros">
                                {FILTROS.map(f => (
                                    <button
                                        key={f.id}
                                        className={`alertas-filtro-chip${filtroArea === f.id ? ' ativo' : ''}`}
                                        onClick={() => setFiltroArea(f.id)}
                                    >
                                        {f.label}
                                        {f.id !== 'todos' && (MAPA_AREA[f.id] || []).some(t => alertas.some(a => a.tipo === t)) && (
                                            <span className="alertas-filtro-dot"></span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="alertas-drawer-corpo">
                            {alertas.length === 0 ? (
                                <UIFeedbackNotFound
                                    variante="compacto"
                                    icon="fa-check-circle"
                                    titulo="Tudo tranquilo por aqui"
                                    mensagem={ultimaVerificacao
                                        ? `Última verificação às ${ultimaVerificacao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                                        : 'Aguardando verificação...'}
                                />
                            ) : alertasFiltrados.length === 0 ? (
                                <UIFeedbackNotFound
                                    variante="compacto"
                                    icon="fa-filter"
                                    titulo="Nenhum alerta nessa área"
                                    mensagem="Não há alertas correspondentes ao filtro selecionado."
                                />
                            ) : (
                                alertasFiltrados.map((alerta) => (
                                    <div key={alerta._id} className={`alertas-card nivel-${alerta.nivel}`}>
                                        <div className="alertas-card-borda"></div>
                                        <div className="alertas-card-icone">
                                            <i className={`fas ${
                                                alerta.nivel === 'critico' ? 'fa-exclamation-circle' :
                                                alerta.nivel === 'aviso'   ? 'fa-exclamation-triangle' :
                                                'fa-check-circle'
                                            }`}></i>
                                        </div>
                                        <div className="alertas-card-corpo">
                                            {alerta.dados_extras
                                                ? <MiniCardProduto dados={alerta.dados_extras} compact />
                                                : <p>{alerta.mensagem}</p>
                                            }
                                            <span className="alertas-card-tipo">{alerta.tipo.replace(/_/g, ' ')}</span>
                                        </div>
                                        <button
                                            className="alertas-card-dismiss"
                                            onClick={() => handleDismiss(alerta._id)}
                                            title="Remover este alerta"
                                        >
                                            <i className="fas fa-times"></i>
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="alertas-drawer-rodape">
                            <button className="alertas-btn-historico" onClick={handleAbrirHistorico}>
                                <i className="fas fa-history"></i> Histórico de hoje
                            </button>
                            <button
                                className="alertas-btn-atualizar"
                                disabled={verificando}
                                onClick={async () => {
                                    setVerificando(true);
                                    await verificarAlertas();
                                    setVerificando(false);
                                }}
                            >
                                <i className={`fas fa-sync-alt${verificando ? ' fa-spin' : ''}`}></i>
                                {verificando ? 'Verificando...' : 'Verificar agora'}
                            </button>
                        </div>

                        {/* Painel de histórico — sobrepõe o corpo do drawer */}
                        {historico !== null && (
                            <div className="alertas-historico-painel">
                                <div className="alertas-historico-header">
                                    <span><i className="fas fa-history"></i> Histórico de hoje</span>
                                    <button onClick={() => setHistorico(null)}>
                                        <i className="fas fa-times"></i>
                                    </button>
                                </div>
                                <div className="alertas-historico-lista">
                                    {carregandoHistorico ? (
                                        <UICarregando variante="bloco" tamanho="sm" texto="Carregando histórico..." />
                                    ) : historico.length === 0 ? (
                                        <UIFeedbackNotFound
                                            variante="compacto"
                                            icon="fa-check-circle"
                                            titulo="Nenhum alerta disparado hoje"
                                            mensagem="O histórico deste dia está limpo."
                                        />
                                    ) : (
                                        historico.map(item => (
                                            <div key={item.id} className={`alertas-historico-item nivel-${item.nivel}`}>
                                                <div className="alertas-card-borda"></div>
                                                <div className="alertas-historico-item-corpo">
                                                    <p>{item.mensagem}</p>
                                                    <span>
                                                        {new Date(item.disparado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                        {' · '}
                                                        {item.tipo_alerta.replace(/_/g, ' ')}
                                                    </span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </>
    );
}
