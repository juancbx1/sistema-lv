// public/src/components/OPStatusCard.jsx

import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import { calcularTempoEfetivo, formatarHora, formatarTempo } from '../utils/PontoHelpers.js';
import UILinhaDoTempoDia from './UILinhaDoTempoDia.jsx';
import UIBloqueio from './UIBloqueio.jsx';

const getRoleInfo = (tipos = []) => {
    if (tipos.includes('tiktik'))   return { label: 'TikTik',    icon: 'fa-cut',         classe: 'cracha-tiktik' };
    if (tipos.includes('cortador')) return { label: 'Cortador',  icon: 'fa-layer-group', classe: 'cracha-cortador' };
    return                                 { label: 'Costureira', icon: 'fa-tshirt',      classe: 'cracha-costureira' };
};

const getStatusIdle = (status) => {
    const map = {
        LIVRE:            { icone: 'fa-check-circle',  texto: 'Disponível',      cor: '#22c55e' },
        PAUSA:            { icone: 'fa-coffee',        texto: 'Em Pausa',        cor: '#f59e0b' },
        PAUSA_MANUAL:     { icone: 'fa-coffee',        texto: 'Em Pausa',        cor: '#f59e0b' },
        ALMOCO:           { icone: 'fa-utensils',      texto: 'Almoço',          cor: '#f97316' },
        FORA_DO_HORARIO:  { icone: 'fa-moon',          texto: 'Fora do Horário', cor: '#6366f1' },
        FALTOU:           { icone: 'fa-user-times',    texto: 'Faltou',          cor: '#ef4444' },
        ALOCADO_EXTERNO:  { icone: 'fa-shipping-fast', texto: 'Outro Setor',     cor: '#8b5cf6' },
    };
    return map[status] || { icone: 'fa-question-circle', texto: status || 'Indefinido', cor: '#aaa' };
};

const calcularRitmo = (ms, tpp, quantidade) => {
    if (!tpp || !quantidade || tpp <= 0) return null;
    const estimadoMs = tpp * quantidade * 1000;
    const pct = (ms / estimadoMs) * 100;
    if (pct >= 120) return { texto: 'Lento',       emoji: '🐢', classe: 'ritmo-lento',   pct };
    if (pct >= 100) return { texto: 'Atenção',      emoji: '⚠️', classe: 'ritmo-atencao', pct };
    if (pct >= 60)  return { texto: 'No Ritmo',     emoji: '👍', classe: 'ritmo-normal',  pct };
    if (pct >= 30)  return { texto: 'Rápido',       emoji: '✅', classe: 'ritmo-rapido',  pct };
    return                  { texto: 'Super Rápido', emoji: '🚀', classe: 'ritmo-super',   pct };
};

// ── MELHORIA-06: Linha do Tempo do Dia (componente compartilhado) ───────────
// Importado de UILinhaDoTempoDia.jsx — não editar aqui.
// ────────────────────────────────────────────────────────────────────────────

export default function OPStatusCard({ funcionario, tpp, onAtribuirTarefa, onAcaoManual, onFinalizarTarefa, onCancelarTarefa, onExcecao, onLiberarIntervalo, onLiberarParaTrabalho }) {
    const [menuAberto, setMenuAberto] = useState(false);
    const [infoAberto, setInfoAberto] = useState(false);

    // ── Cronômetro ──────────────────────────────────────────────────────────
    const [tempoMs, setTempoMs] = useState(0);
    const [cronoPausadoAuto, setCronoPausadoAuto] = useState(false);   // pausa automática (almoço/pausa detectados)
    const [cronoPausadoMotivo, setCronoPausadoMotivo] = useState(null); // 'ALMOCO' | 'PAUSA' | null

    // Pausa manual do supervisor (congela o relógio até ele retomar)
    const [timerManualPausado, setTimerManualPausado] = useState(false);
    // BUG-20 fix: dois refs para rastrear a pausa sem perder o offset acumulado
    const pausaManualFrozenMsRef   = useRef(null); // ms exibido no momento em que o supervisor pausou
    const pausaManualAcumuladoMsRef = useRef(0);   // total de ms "desperdiçados" em pausas manuais anteriores

    // ── Tolerância S3 ────────────────────────────────────────────────────────
    const [toleranciaS3, setToleranciaS3] = useState(null);

    // ── Botão de liberação antecipada ─────────────────────────────────────────
    const [intervaloProximo, setIntervaloProximo] = useState(null);

    if (!funcionario) return null;

    const {
        status_atual, nome, avatar_url, foto_oficial, nivel, tipos = [], tarefas,
        horario_entrada_1, horario_saida_1, horario_entrada_2, horario_saida_2,
        horario_entrada_3, horario_saida_3, dias_trabalho,
        ponto_hoje,
    } = funcionario;
    const todasTarefas = tarefas || (funcionario.tarefa_atual ? [funcionario.tarefa_atual] : []);
    const tarefaPrincipal = todasTarefas[0] || null;
    const filaEspera = todasTarefas.slice(1);

    const role = getRoleInfo(tipos);
    const fotoExibida = avatar_url || foto_oficial || null;

    // --- CRONÔMETRO INTERNO (intervalo-ciente) --- BUG-20 fix
    useEffect(() => {
        if (status_atual !== 'PRODUZINDO' || !tarefaPrincipal?.data_inicio) {
            setTempoMs(0);
            setCronoPausadoAuto(false);
            setCronoPausadoMotivo(null);
            pausaManualFrozenMsRef.current = null;
            pausaManualAcumuladoMsRef.current = 0;
            setTimerManualPausado(false);
            return;
        }

        const atualizar = () => {
            // Pausa manual ativa: manter o display congelado no valor capturado
            if (pausaManualFrozenMsRef.current !== null) {
                setTempoMs(pausaManualFrozenMsRef.current);
                return;
            }
            const resultado = calcularTempoEfetivo(tarefaPrincipal.data_inicio, ponto_hoje);
            // Descontar o total de pausas manuais anteriores já computadas
            const msEfetivo = Math.max(0, resultado.ms - pausaManualAcumuladoMsRef.current);
            setTempoMs(msEfetivo);
            setCronoPausadoAuto(resultado.pausado);
            setCronoPausadoMotivo(resultado.motivo);
        };

        atualizar();
        const id = setInterval(atualizar, 1000);
        return () => clearInterval(id);
    }, [status_atual, tarefaPrincipal?.data_inicio, ponto_hoje]);

    const handlePausarTimer = () => {
        // Salva o ms atual como "ponto de congelamento" — display fica travado aqui
        pausaManualFrozenMsRef.current = tempoMs;
        setTimerManualPausado(true);
    };

    const handleRetomarTimer = () => {
        if (pausaManualFrozenMsRef.current !== null) {
            // Calcula o drift ocorrido durante a pausa manual e acumula como offset permanente
            const resultado = calcularTempoEfetivo(tarefaPrincipal.data_inicio, ponto_hoje);
            const efetivoBruto = Math.max(0, resultado.ms - pausaManualAcumuladoMsRef.current);
            const drift = efetivoBruto - pausaManualFrozenMsRef.current;
            pausaManualAcumuladoMsRef.current += Math.max(0, drift);
            pausaManualFrozenMsRef.current = null;
        }
        setTimerManualPausado(false);
    };

    // Estado derivado: qualquer forma de pausa (auto ou manual)
    const cronoPausado = cronoPausadoAuto || timerManualPausado;

    // --- INDICADOR DE TOLERÂNCIA S3 (BUG-18: recalcula a cada 30s em tempo real) ---
    useEffect(() => {
        const calcular = () => {
            if (status_atual !== 'PRODUZINDO') { setToleranciaS3(null); return; }
            const s3 = horario_saida_3 || horario_saida_2 || horario_saida_1;
            if (!s3) { setToleranciaS3(null); return; }
            const horaAtual = new Date().toLocaleTimeString('en-GB', {
                timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
            });
            const [s3h, s3m] = String(s3).substring(0, 5).split(':').map(Number);
            const [ah, am] = horaAtual.split(':').map(Number);
            const minutos = (ah * 60 + am) - (s3h * 60 + s3m);
            setToleranciaS3(minutos > 0 ? minutos : null);
        };
        calcular();
        const id = setInterval(calcular, 30000); // recalcula a cada 30s
        return () => clearInterval(id);
    }, [status_atual, horario_saida_1, horario_saida_2, horario_saida_3]);

    // --- BOTÃO "LIBERAR PARA INTERVALO" (janela S-20 a S, com 2 fases escalonadas) ---
    //   Fase 1 — antecipacao:  [S-20, S-5]  → discreto (azul suave)
    //   Fase 2 — iminente:     [S-5, S)     → amarelo com pulse lento
    //   A partir de S: o sistema toma conta automaticamente (timer 60s + rede de segurança backend)
    //   Após S → botão some; card bloqueado automaticamente pelo 60s timer do painel
    useEffect(() => {
        const calcular = () => {
            // v1.9: botão de liberação antecipada aparece para LIVRE e PRODUZINDO
            if (status_atual !== 'LIVRE' && status_atual !== 'PRODUZINDO') { setIntervaloProximo(null); return; }
            const agora = new Date();
            const horaAtual = agora.toLocaleTimeString('en-GB', {
                timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
            });
            const [ah, am] = horaAtual.split(':').map(Number);
            const agoraMin = ah * 60 + am;
            const n = (t) => t ? String(t).substring(0, 5) : null;

            // Calcula a fase com base em minutos relativos ao horário alvo (S1 ou S2)
            const calcFase = (alvoMin) => {
                const delta = agoraMin - alvoMin;
                if (delta < -20) return null;                                                    // mais de 20min antes — botão não aparece
                if (delta < -5)  return { nome: 'antecipacao', classe: 'fase-antecipacao', atrasoMin: 0 }; // [S-20, S-5]
                if (delta < 0)   return { nome: 'iminente',    classe: 'fase-iminente',    atrasoMin: 0 }; // [S-5, S)
                return null; // a partir de S → sistema assume automaticamente
            };

            const s1 = n(horario_saida_1);
            if (s1 && !ponto_hoje?.horario_real_s1) {
                const [s1h, s1m] = s1.split(':').map(Number);
                const fase = calcFase(s1h * 60 + s1m);
                if (fase) {
                    setIntervaloProximo({
                        tipo: 'ALMOCO', label: 'Liberar para almoço', icone: 'fa-utensils',
                        ...fase,
                    });
                    return;
                }
            }
            const s2 = n(horario_saida_2);
            if (s2 && !ponto_hoje?.horario_real_s2) {
                const [s2h, s2m] = s2.split(':').map(Number);
                const fase = calcFase(s2h * 60 + s2m);
                if (fase) {
                    setIntervaloProximo({
                        tipo: 'PAUSA', label: 'Liberar para pausa', icone: 'fa-coffee',
                        ...fase,
                    });
                    return;
                }
            }
            setIntervaloProximo(null);
        };
        calcular();
        // Recalcula a cada 30s para atualizar o contador de atraso com precisão (fase 4)
        const id = setInterval(calcular, 30000);
        return () => clearInterval(id);
    }, [status_atual, horario_saida_1, horario_saida_2, ponto_hoje?.horario_real_s1, ponto_hoje?.horario_real_s2]);

    const ritmo = (status_atual === 'PRODUZINDO' && !cronoPausado)
        ? calcularRitmo(tempoMs, tpp, tarefaPrincipal?.quantidade)
        : null;

    // --- MENU DE AÇÕES ---
    const getMenuItems = () => {
        switch (status_atual) {
            case 'LIVRE':
            case 'LIVRE_MANUAL':
            case 'PRODUZINDO':
                return [
                    { acao: 'FALTOU',             label: 'Marcar Falta',          icon: 'fa-user-slash' },
                    { acao: 'ALOCADO_EXTERNO',    label: 'Alocar em Outro Setor', icon: 'fa-shipping-fast' },
                    { acao: 'SAIDA_ANTECIPADA',   label: 'Saída Antecipada',      icon: 'fa-sign-out-alt' },
                ];
            default: {
                const items = [{ acao: 'LIVRE_MANUAL', label: 'Liberar para Trabalho', icon: 'fa-play' }];
                if (status_atual === 'FORA_DO_HORARIO') {
                    items.push({ acao: 'ATRASO', label: 'Chegada Atrasada', icon: 'fa-sign-in-alt' });
                }
                return items;
            }
        }
    };
    const menuItems = getMenuItems();

    // --- CORPO DO CARD ---
    const renderBody = () => {
        // v1.8 — Card bloqueado: funcionário em ALMOCO ou PAUSA (sem tarefa ativa)
        // Aparece quando o funcionário estava LIVRE quando o intervalo começou.
        // Para quem estava PRODUZINDO, o status permanece PRODUZINDO com timer congelado.
        if ((status_atual === 'ALMOCO' || status_atual === 'PAUSA' || status_atual === 'PAUSA_MANUAL') && !tarefaPrincipal) {
            const isAlmoco  = status_atual === 'ALMOCO';
            const icone     = isAlmoco ? 'fa-utensils' : 'fa-coffee';
            const textoTipo = isAlmoco ? 'Em Almoço' : 'Em Pausa';
            const corTipo   = isAlmoco ? '#f97316' : '#f59e0b';
            const retorno   = isAlmoco
                ? (formatarHora(ponto_hoje?.horario_real_e2 || horario_entrada_2))
                : (formatarHora(ponto_hoje?.horario_real_e3 || horario_entrada_3));

            return (
                <>
                    <div className="cracha-intervalo-corpo">
                        <div className="cracha-intervalo-icone" style={{ color: corTipo }}>
                            <i className={`fas ${icone}`}></i>
                        </div>
                        <div className="cracha-intervalo-status" style={{ color: corTipo }}>
                            {textoTipo}
                        </div>
                        {retorno && retorno !== '--:--' && (
                            <div className="cracha-intervalo-retorno">
                                Retorno previsto às <strong>{retorno}</strong>
                            </div>
                        )}
                        <div className="cracha-intervalo-lock">
                            <i className="fas fa-lock"></i>
                            <span>Bloqueado durante o intervalo</span>
                        </div>
                    </div>
                    <div className="cracha-footer">
                        <button
                            className="cracha-btn finalizar full-width cracha-btn-retomar"
                            onClick={() => onLiberarParaTrabalho && onLiberarParaTrabalho(funcionario)}
                        >
                            <i className="fas fa-play"></i> Liberar para Trabalho
                        </button>
                    </div>
                </>
            );
        }

        if (status_atual === 'PRODUZINDO' && tarefaPrincipal) {
            const progressoVisual = ritmo ? Math.min(100, ritmo.pct) : 0;

            // Label de pausa automática (almoço/pausa detectado pelo ponto_hoje)
            const labelPausaAuto = cronoPausadoMotivo === 'ALMOCO'
                ? { icone: 'fa-utensils', texto: 'Almoço em andamento' }
                : cronoPausadoMotivo === 'PAUSA'
                ? { icone: 'fa-coffee',   texto: 'Pausa em andamento' }
                : null;

            const imagemVariacao = tarefaPrincipal.imagem || null;
            const nomeExibido = tarefaPrincipal.variante || tarefaPrincipal.produto_nome;

            return (
                <>
                    <div className="cracha-tarefa">
                        {Array.isArray(tarefaPrincipal.etapas_unificadas) && tarefaPrincipal.etapas_unificadas.length >= 2 ? (
                            <div className="cracha-tarefa-processo-wrapper">
                                <span className="cracha-unif-badge">
                                    <i className="fas fa-link"></i> Unificadas
                                </span>
                                <div className="cracha-tarefa-processo">
                                    {tarefaPrincipal.etapas_unificadas.map((e, i) => (
                                        <span key={e.processo}>
                                            {i > 0 && <i className="fas fa-arrow-right cracha-unif-seta"></i>}
                                            {e.processo}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="cracha-tarefa-processo">{tarefaPrincipal.processo}</div>
                        )}

                        {/* Cabeçalho da tarefa: imagem da variação + nome da variação */}
                        <div className="cracha-tarefa-cabeca">
                            <div className="cracha-tarefa-imagem">
                                {imagemVariacao ? (
                                    <img src={imagemVariacao} alt={nomeExibido || 'Produto'} />
                                ) : (
                                    <div className="cracha-tarefa-imagem-placeholder">
                                        <i className="fas fa-tshirt"></i>
                                    </div>
                                )}
                            </div>
                            <div className="cracha-tarefa-variante-texto">{nomeExibido}</div>
                        </div>

                        {/* Dois blocos grandes: Quantidade | Cronômetro */}
                        <div className="cracha-metricas-grandes">
                            <div className="cracha-metrica-bloco">
                                <div className="cracha-metrica-valor">{tarefaPrincipal.quantidade}</div>
                                <div className="cracha-metrica-label">peças</div>
                            </div>
                            <div className={`cracha-metrica-bloco crono${cronoPausado ? ' cronometro-pausado' : ''}`}>
                                <div className="cracha-metrica-valor cronometro">
                                    <i className={`fas ${cronoPausado ? 'fa-pause-circle' : 'fa-clock'}`}></i>
                                    {' '}{formatarTempo(tempoMs)}
                                </div>
                                {ritmo && !cronoPausado ? (
                                    <div className={`cracha-metrica-label ritmo ${ritmo.classe}`}>{ritmo.emoji} {ritmo.texto}</div>
                                ) : (
                                    <div className="cracha-metrica-label">tempo</div>
                                )}
                            </div>
                        </div>

                        {/* Indicador de pausa automática (almoço/pausa via ponto_hoje) */}
                        {cronoPausadoAuto && labelPausaAuto && (
                            <div className="cracha-crono-pausa-label auto">
                                <i className={`fas ${labelPausaAuto.icone}`}></i>
                                <span>{labelPausaAuto.texto} — relógio pausado</span>
                            </div>
                        )}

                        {/* Indicador de pausa manual do supervisor */}
                        {timerManualPausado && (
                            <div className="cracha-crono-pausa-label manual">
                                <i className="fas fa-hand-paper"></i>
                                <span>Relógio pausado manualmente</span>
                            </div>
                        )}

                        <div className="cracha-barra-container">
                            <div className={`cracha-barra ${ritmo?.classe || ''}${cronoPausado ? ' barra-pausada' : ''}`} style={{ width: `${progressoVisual}%` }}></div>
                        </div>

                        {/* Botão de pausa manual (só aparece quando NÃO está em pausa automática) */}
                        {!cronoPausadoAuto && (
                            timerManualPausado ? (
                                <button className="op-btn-pausar-timer retomar" onClick={handleRetomarTimer}>
                                    <i className="fas fa-play"></i> Retomar Relógio
                                </button>
                            ) : (
                                <button className="op-btn-pausar-timer" onClick={handlePausarTimer}>
                                    <i className="fas fa-pause"></i> Pausar Relógio
                                </button>
                            )
                        )}

                        {/* Indicador de tolerância S3 — trabalhando além do horário final (BUG-18: atualiza em tempo real) */}
                        {toleranciaS3 !== null && (
                            <div className={`op-status-tolerancia ${toleranciaS3 > 20 ? 'critico' : 'aviso'}`}>
                                {toleranciaS3 > 20 ? (
                                    <>
                                        <div className="op-tolerancia-linha1">🚨 Passou {toleranciaS3}min do horário de saída</div>
                                        <div className="op-tolerancia-linha2">Saída prevista às {formatarHora(horario_saida_3 || horario_saida_2 || horario_saida_1)} — falar com ela</div>
                                    </>
                                ) : (
                                    <span>⏰ +{toleranciaS3}min após o horário de saída ({formatarHora(horario_saida_3 || horario_saida_2 || horario_saida_1)})</span>
                                )}
                            </div>
                        )}

                        {filaEspera.length > 0 && (
                            <div className="cracha-fila">
                                <span className="cracha-fila-titulo"><i className="fas fa-layer-group"></i> Fila ({filaEspera.length})</span>
                                <ul>
                                    {filaEspera.map((t, i) => {
                                        const isUnif = Array.isArray(t.etapas_unificadas) && t.etapas_unificadas.length >= 2;
                                        return (
                                            <li key={t.id_sessao || i}>
                                                <div className="fila-linha1">
                                                    <span className="fila-qtd">{t.quantidade}</span>
                                                    <span className="fila-nome">{t.produto_nome}</span>
                                                </div>
                                                {t.variante && (
                                                    <div className="fila-variante">{t.variante}</div>
                                                )}
                                                <div className={`fila-proc${isUnif ? ' unif' : ''}`}>
                                                    {isUnif
                                                        ? <><i className="fas fa-link"></i>{t.etapas_unificadas.map(e => e.processo).join(' + ')}</>
                                                        : t.processo
                                                    }
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}
                    </div>

                    {/* v1.9: botão de liberação antecipada quando PRODUZINDO e intervalo se aproxima */}
                    {intervaloProximo && onLiberarIntervalo && !cronoPausadoAuto && (
                        <button
                            className={`op-btn-liberar-intervalo ${intervaloProximo.classe}`}
                            onClick={() => onLiberarIntervalo(funcionario.id, intervaloProximo.tipo)}
                            title={`${intervaloProximo.label} agora (retorno calculado automaticamente)`}
                        >
                            <i className={`fas ${intervaloProximo.icone}`}></i>
                            <span className="op-btn-liberar-texto">{intervaloProximo.label}</span>
                            {intervaloProximo.atrasoMin > 0 && (
                                <span className="op-btn-liberar-atraso">+{intervaloProximo.atrasoMin}min</span>
                            )}
                        </button>
                    )}

                    {/* v1.8: botões bloqueados durante intervalo automático (almoço/pausa) */}
                    {/* v1.9: quando congelado, supervisor pode liberar para trabalho antecipadamente */}
                    <div className="cracha-footer">
                        {cronoPausadoAuto ? (
                            // Tarefa travada — mostra retorno previsto + botão para liberar antecipadamente
                            (() => {
                                const retornoAuto = cronoPausadoMotivo === 'ALMOCO'
                                    ? formatarHora(ponto_hoje?.horario_real_e2 || horario_entrada_2)
                                    : formatarHora(ponto_hoje?.horario_real_e3 || horario_entrada_3);
                                return (
                                    <>
                                        <div className="cracha-footer-bloqueado">
                                            <i className="fas fa-lock"></i>
                                            <span>Retoma às <strong>{retornoAuto}</strong></span>
                                        </div>
                                        <button
                                            className="cracha-btn finalizar full-width cracha-btn-retomar"
                                            style={{ marginTop: '6px' }}
                                            onClick={() => onLiberarParaTrabalho && onLiberarParaTrabalho(funcionario, cronoPausadoMotivo)}
                                        >
                                            <i className="fas fa-play"></i> Liberar para Trabalho
                                        </button>
                                    </>
                                );
                            })()
                        ) : (
                            <>
                                <UIBloqueio permissao="cancelar-tarefa-producao" style={{ flex: 1 }}>
                                    <button className="cracha-btn cancelar" style={{ width: '100%' }} onClick={() => onCancelarTarefa(funcionario)}>
                                        <i className="fas fa-times"></i> Cancelar
                                    </button>
                                </UIBloqueio>
                                <UIBloqueio permissao="finalizar-tarefa-producao" style={{ flex: 1 }}>
                                    <button className="cracha-btn finalizar" style={{ width: '100%' }} onClick={() => onFinalizarTarefa(funcionario, pausaManualAcumuladoMsRef.current)}>
                                        <i className="fas fa-check-double"></i> Finalizar
                                    </button>
                                </UIBloqueio>
                            </>
                        )}
                    </div>
                </>
            );
        }

        const idle = getStatusIdle(status_atual);
        const retornoAlmoco = ponto_hoje?.horario_real_e2
            ? formatarHora(ponto_hoje.horario_real_e2)
            : formatarHora(horario_entrada_2);
        const retornoPausa = ponto_hoje?.horario_real_e3
            ? formatarHora(ponto_hoje.horario_real_e3)
            : formatarHora(horario_entrada_3);

        // Últimas tarefas finalizadas hoje (para o card LIVRE — dá contexto ao supervisor).
        // Pega as 3 mais recentes (sessoes_hoje já vem ordenado por data_inicio ASC).
        const mostrarUltimas = status_atual === 'LIVRE' || status_atual === 'LIVRE_MANUAL';
        const sessoesFinalizadas = (funcionario.sessoes_hoje || []).filter(s => s.fim);
        const ultimasTarefas = sessoesFinalizadas.slice(-3).reverse();

        return (
            <>
                <div className="cracha-status-idle">
                    <i className={`fas ${idle.icone}`} style={{ color: idle.cor }}></i>
                    <span className="cracha-status-idle-texto">{idle.texto}</span>
                </div>

                {status_atual === 'ALMOCO' && retornoAlmoco !== '--:--' && (
                    <div className="op-status-card-intervalo">
                        <i className="fas fa-utensils"></i>
                        <span>Retorno previsto às <strong>{retornoAlmoco}</strong></span>
                    </div>
                )}
                {status_atual === 'PAUSA' && retornoPausa !== '--:--' && (
                    <div className="op-status-card-intervalo">
                        <i className="fas fa-coffee"></i>
                        <span>Retorno previsto às <strong>{retornoPausa}</strong></span>
                    </div>
                )}

                {/* Últimas tarefas realizadas — preenche o vazio dos cards LIVRE e dá
                    contexto útil ao supervisor (ele vê o que foi feito antes de atribuir a próxima) */}
                {mostrarUltimas && (
                    <div className="cracha-livre-body">
                        {ultimasTarefas.length > 0 ? (
                            <>
                                <div className="cracha-livre-titulo">
                                    <i className="fas fa-history"></i>
                                    <span>Últimas tarefas</span>
                                </div>
                                <ul className="cracha-livre-lista">
                                    {ultimasTarefas.map((s, i) => (
                                        <li key={`${s.op_numero}-${s.fim}-${i}`}>
                                            <div className="cracha-livre-horario">{s.fim}</div>
                                            <div className="cracha-livre-info">
                                                <div className="cracha-livre-produto" title={`${s.produto_nome || ''}${s.variante ? ' · ' + s.variante : ''}`}>
                                                    {s.produto_nome || `Produto #${s.produto_id}`}
                                                    {s.variante ? <span className="cracha-livre-variante"> · {s.variante}</span> : null}
                                                </div>
                                                <div className="cracha-livre-meta">
                                                    <span className="cracha-livre-qtd">{s.quantidade}</span>
                                                    <span className="cracha-livre-proc">{s.processo}</span>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        ) : (
                            <div className="cracha-livre-vazio">
                                <i className="fas fa-flag-checkered"></i>
                                <span>Ainda sem tarefas finalizadas hoje</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Botão de liberação antecipada — aparece acima do "Atribuir Tarefa" */}
                {intervaloProximo && onLiberarIntervalo && (
                    <button
                        className={`op-btn-liberar-intervalo ${intervaloProximo.classe}`}
                        onClick={() => onLiberarIntervalo(funcionario.id, intervaloProximo.tipo)}
                        title={`${intervaloProximo.label} agora (retorno calculado automaticamente)`}
                    >
                        <i className={`fas ${intervaloProximo.icone}`}></i>
                        <span className="op-btn-liberar-texto">{intervaloProximo.label}</span>
                        {intervaloProximo.atrasoMin > 0 && (
                            <span className="op-btn-liberar-atraso">+{intervaloProximo.atrasoMin}min</span>
                        )}
                    </button>
                )}

                <div className="cracha-footer">
                    {status_atual === 'LIVRE' && (
                        <button className="cracha-btn finalizar full-width" onClick={() => onAtribuirTarefa(funcionario)}>
                            <i className="fas fa-play"></i> Atribuir Tarefa
                        </button>
                    )}
                </div>
            </>
        );
    };

    const estaEmIntervalo = ['ALMOCO', 'PAUSA', 'PAUSA_MANUAL'].includes(status_atual) && !tarefaPrincipal;
    const cardClasses = [
        'cracha-card',
        role.classe,
        status_atual === 'PRODUZINDO' ? 'cracha-em-producao' : '',
        estaEmIntervalo ? 'cracha-em-intervalo' : '',
        (status_atual === 'PRODUZINDO' && cronoPausadoAuto) ? 'cracha-em-intervalo' : '',
        intervaloProximo?.nome === 'atrasado' ? 'cracha-liberar-atrasado' : '',
    ].filter(Boolean).join(' ');

    return (
        <div className={cardClasses}>

            {/* TOPO UNIFICADO — banda + identidade em uma única faixa compacta */}
            <div className="cracha-topo">
                <div
                    className={`cracha-avatar${!fotoExibida ? ' cracha-avatar-vazio' : ''}`}
                    style={fotoExibida ? { backgroundImage: `url('${fotoExibida}')` } : {}}
                    title={role.label + (nivel ? ` · Nível ${nivel}` : '')}
                >
                    {!fotoExibida && <i className="fas fa-user"></i>}
                    {nivel ? (
                        <span className="cracha-avatar-nivel-badge" aria-label={`Nível ${nivel}`}>{nivel}</span>
                    ) : null}
                </div>
                <div className="cracha-identidade-compacta">
                    <div className="cracha-nome" title={nome}>{nome}</div>
                </div>
                <div className="cracha-topo-acoes">
                    <button className="cracha-menu-btn" onClick={() => setInfoAberto(true)} title="Ver horários">
                        <i className="fas fa-info-circle"></i>
                    </button>
                    {menuItems.length > 0 && (
                        <button className="cracha-menu-btn" onClick={() => setMenuAberto(true)} title="Opções">
                            <i className="fas fa-ellipsis-v"></i>
                        </button>
                    )}
                </div>
            </div>

            {/* BOTTOM SHEET — menu de ações */}
            {menuAberto && ReactDOM.createPortal(
                <>
                    <div className="bs-overlay" onClick={() => setMenuAberto(false)} />
                    <div className="bs-sheet" onClick={e => e.stopPropagation()}>
                        <div className="bs-handle" />
                        <div className="bs-header">
                            <div
                                className={`bs-avatar${!fotoExibida ? ' bs-avatar-vazio' : ''}`}
                                style={fotoExibida ? { backgroundImage: `url('${fotoExibida}')` } : {}}
                            >
                                {!fotoExibida && <i className="fas fa-user"></i>}
                            </div>
                            <div>
                                <div className="bs-nome">{nome}</div>
                                <div className="bs-role">{role.label}</div>
                            </div>
                        </div>
                        <div className="bs-acoes">
                            {menuItems.map(item => (
                                <button
                                    key={item.acao}
                                    className="bs-item"
                                    onClick={() => { onAcaoManual(funcionario, item.acao); setMenuAberto(false); }}
                                >
                                    <div className="bs-item-icone">
                                        <i className={`fas ${item.icon}`}></i>
                                    </div>
                                    <span>{item.label}</span>
                                </button>
                            ))}
                        </div>
                        <button className="bs-cancelar" onClick={() => setMenuAberto(false)}>
                            Cancelar
                        </button>
                    </div>
                </>,
                document.body
            )}

            {/* BOTTOM SHEET DE HORÁRIOS */}
            {infoAberto && ReactDOM.createPortal(
                <>
                    <div className="bs-overlay" onClick={() => setInfoAberto(false)} />
                    <div className="bs-sheet" onClick={e => e.stopPropagation()}>
                        <div className="bs-handle" />
                        <div className="bs-header">
                            <div
                                className={`bs-avatar${!fotoExibida ? ' bs-avatar-vazio' : ''}`}
                                style={fotoExibida ? { backgroundImage: `url('${fotoExibida}')` } : {}}
                            >
                                {!fotoExibida && <i className="fas fa-user"></i>}
                            </div>
                            <div>
                                <div className="bs-nome">{nome}</div>
                                <div className="bs-role">Jornada de Trabalho</div>
                            </div>
                        </div>

                        {/* Linha do Tempo do Dia (MELHORIA-06) */}
                        <UILinhaDoTempoDia funcionario={funcionario} pontoHoje={ponto_hoje} />

                        {/* Dias de trabalho */}
                        <div className="bs-info-secao">
                            <div className="bs-info-label">Dias de trabalho</div>
                            <div className="bs-dias-chips">
                                {[['0','Dom'],['1','Seg'],['2','Ter'],['3','Qua'],['4','Qui'],['5','Sex'],['6','Sáb']].map(([d, l]) => {
                                    const ativo = (dias_trabalho || {'1':true,'2':true,'3':true,'4':true,'5':true})[d];
                                    return (
                                        <span key={d} className={`bs-dia-chip ${ativo ? 'ativo' : ''}`}>{l}</span>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Horários */}
                        <div className="bs-info-secao">
                            <div className="bs-info-label">Horários</div>
                            <div className="bs-horarios-lista">
                                <div className="bs-horario-linha">
                                    <span className="bs-horario-icone"><i className="fas fa-sign-in-alt"></i></span>
                                    <span className="bs-horario-desc">Entrada <span className="bs-horario-ref">(E1)</span></span>
                                    <span className="bs-horario-valor">{formatarHora(horario_entrada_1)}</span>
                                </div>
                                {horario_saida_1 && (
                                    <div className="bs-horario-linha bs-horario-intervalo">
                                        <span className="bs-horario-icone"><i className="fas fa-utensils"></i></span>
                                        <span className="bs-horario-desc">Almoço <span className="bs-horario-ref">(S1 → E2)</span></span>
                                        <span className="bs-horario-valor">{formatarHora(horario_saida_1)} → {formatarHora(horario_entrada_2)}</span>
                                    </div>
                                )}
                                {horario_saida_2 && (
                                    <div className="bs-horario-linha bs-horario-intervalo">
                                        <span className="bs-horario-icone"><i className="fas fa-coffee"></i></span>
                                        <span className="bs-horario-desc">Pausa <span className="bs-horario-ref">(S2 → E3)</span></span>
                                        <span className="bs-horario-valor">{formatarHora(horario_saida_2)} → {formatarHora(horario_entrada_3)}</span>
                                    </div>
                                )}
                                <div className="bs-horario-linha">
                                    <span className="bs-horario-icone"><i className="fas fa-sign-out-alt"></i></span>
                                    <span className="bs-horario-desc">Saída <span className="bs-horario-ref">(S3)</span></span>
                                    <span className="bs-horario-valor">{formatarHora(horario_saida_3 || horario_saida_2 || horario_saida_1)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Registros de hoje */}
                        {ponto_hoje && (ponto_hoje.horario_real_s1 || ponto_hoje.horario_real_s2 || ponto_hoje.horario_real_s3) && (
                            <div className="bs-info-secao">
                                <div className="bs-info-label">Registros de hoje</div>
                                <div className="bs-registros-hoje">
                                    {ponto_hoje.horario_real_s1 && (
                                        <div className="bs-registro-linha">
                                            <span className="bs-registro-icone"><i className="fas fa-utensils"></i></span>
                                            <span className="bs-registro-desc">Saída almoço</span>
                                            <span className="bs-registro-valor registrado">{String(ponto_hoje.horario_real_s1).substring(0,5)}</span>
                                        </div>
                                    )}
                                    {ponto_hoje.horario_real_e2 && (
                                        <div className="bs-registro-linha">
                                            <span className="bs-registro-icone"><i className="fas fa-utensils"></i></span>
                                            <span className="bs-registro-desc">Retorno almoço</span>
                                            <span className="bs-registro-valor registrado">{String(ponto_hoje.horario_real_e2).substring(0,5)}</span>
                                        </div>
                                    )}
                                    {ponto_hoje.horario_real_s2 && (
                                        <div className="bs-registro-linha">
                                            <span className="bs-registro-icone"><i className="fas fa-coffee"></i></span>
                                            <span className="bs-registro-desc">Saída pausa</span>
                                            <span className="bs-registro-valor registrado">{String(ponto_hoje.horario_real_s2).substring(0,5)}</span>
                                        </div>
                                    )}
                                    {ponto_hoje.horario_real_e3 && (
                                        <div className="bs-registro-linha">
                                            <span className="bs-registro-icone"><i className="fas fa-coffee"></i></span>
                                            <span className="bs-registro-desc">Retorno pausa</span>
                                            <span className="bs-registro-valor registrado">{String(ponto_hoje.horario_real_e3).substring(0,5)}</span>
                                        </div>
                                    )}
                                    {ponto_hoje.horario_real_s3 && (
                                        <div className={`bs-registro-linha${ponto_hoje.saida_desfeita ? ' desfeito' : ''}`}>
                                            <span className="bs-registro-icone"><i className="fas fa-sign-out-alt"></i></span>
                                            <span className="bs-registro-desc">
                                                Saída antecipada
                                                {ponto_hoje.saida_desfeita && (
                                                    <em className="bs-registro-desfeito"> — desfeita por {ponto_hoje.saida_desfeita_por || 'supervisor'}</em>
                                                )}
                                            </span>
                                            <span className="bs-registro-valor registrado">{String(ponto_hoje.horario_real_s3).substring(0,5)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <button className="bs-cancelar" onClick={() => setInfoAberto(false)}>
                            Fechar
                        </button>
                    </div>
                </>,
                document.body
            )}

            {/* CORPO + RODAPÉ */}
            {renderBody()}
        </div>
    );
}
