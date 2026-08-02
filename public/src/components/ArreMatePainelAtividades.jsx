// public/src/components/ArreMatePainelAtividades.jsx
// v3.0 — Refatorado para layout idêntico ao OPPainelAtividades.
// ALMOCO/PAUSA agora ficam no grid principal (cards bloqueados).
// Inativos = FORA_DO_HORARIO, FALTOU, ALOCADO_EXTERNO.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import ArremateStatusCard from './ArremateStatusCard.jsx';
import ArremateAtribuicaoModal from './ArremateAtribuicaoModal.jsx';
import UICarregando from './UICarregando';
import { mostrarMensagem, mostrarConfirmacao, mostrarPromptNumerico, mostrarPromptFinalizarLote, mostrarPromptTexto, mostrarPromptHorario } from '/js/utils/popups.js';

export default function ArreMatePainelAtividades({ permissoes = [] }) {
    const [tiktiks, setTiktiks] = useState([]);
    const [temposPadraoArremate, setTemposPadraoArremate] = useState({});
    const [carregando, setCarregando] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [infoFeriado, setInfoFeriado] = useState(null);

    const [modalAtribuicaoAberto, setModalAtribuicaoAberto] = useState(false);
    const [tiktikSelecionado, setTiktikSelecionado] = useState(null);
    const [inativoInfoId, setInativoInfoId] = useState(null);

    // v1.8 — Alerta de intervalo (almoço/pausa automático)
    const [alertaIntervalo, setAlertaIntervalo] = useState(null);

    // v1.8 — Popup "Desfazer liberação" com countdown
    const [desfazerPopup, setDesfazerPopup] = useState(null);
    // { tiktikId, nome, tipo: 'ALMOCO'|'PAUSA'|..., countdown: 10, origem: 'PRODUZINDO'|'INTERVALO' }

    const audioCtxRef = useRef(null);
    const audioUnlockedRef = useRef(false);
    const alertadosRef = useRef(new Set());
    const pollingTimeoutRef = useRef(null);

    // --- 1. BUSCA DE DADOS ---
    const buscarDadosPainel = useCallback(async () => {
        try {
            const token = localStorage.getItem('token');
            const [dataStatus, dataTempos] = await Promise.all([
                fetch('/api/arremates/status-tiktiks', {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(res => {
                    if (!res.ok) throw new Error('Falha ao carregar status.');
                    return res.json();
                }),
                fetch('/api/arremates/tempos-padrao', {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(res => {
                    if (!res.ok) return {};
                    return res.json();
                })
            ]);

            const tiktiksArray = Array.isArray(dataStatus) ? dataStatus : (dataStatus.tiktiks || []);
            const feriadoInfo = !Array.isArray(dataStatus) && dataStatus.is_feriado_hoje
                ? { nome_feriado: dataStatus.nome_feriado }
                : null;

            setTiktiks(tiktiksArray);
            setInfoFeriado(feriadoInfo);
            setTemposPadraoArremate(dataTempos);
        } catch (err) {
            console.error('[ArreMatePainelAtividades] Erro no polling:', err);
        } finally {
            setCarregando(false);
        }
    }, []);

    // --- 2. POLLING (20s) + VISIBILITYCHANGE ---
    const agendarProximoPoll = useCallback(() => {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = setTimeout(() => {
            if (!document.hidden) {
                buscarDadosPainel().then(agendarProximoPoll);
            } else {
                agendarProximoPoll();
            }
        }, 20000);
    }, [buscarDadosPainel]);

    useEffect(() => {
        buscarDadosPainel().then(agendarProximoPoll);

        const handleVisibility = () => {
            if (!document.hidden) buscarDadosPainel();
        };
        const handleExternalUpdate = () => buscarDadosPainel();

        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('atualizar-fila-react', handleExternalUpdate);
        window.addEventListener('forcarAtualizacaoPainelTiktik', handleExternalUpdate);

        return () => {
            clearTimeout(pollingTimeoutRef.current);
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('atualizar-fila-react', handleExternalUpdate);
            window.removeEventListener('forcarAtualizacaoPainelTiktik', handleExternalUpdate);
        };
    }, [buscarDadosPainel, agendarProximoPoll]);

    // --- v1.8: DESBLOQUEIO DE ÁUDIO ---
    useEffect(() => {
        const unlock = () => {
            if (audioUnlockedRef.current) return;
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                ctx.resume().then(() => {
                    audioCtxRef.current = ctx;
                    audioUnlockedRef.current = true;
                });
            } catch (e) {}
        };
        document.addEventListener('click', unlock, { once: true });
        document.addEventListener('touchstart', unlock, { once: true });
        return () => {
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
        };
    }, []);

    const tocarBeep = useCallback(() => {
        try {
            const ctx = audioCtxRef.current;
            if (!ctx || ctx.state === 'suspended') return;
            [880, 660, 440].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = freq;
                osc.type = 'sine';
                const t = ctx.currentTime + i * 0.28;
                gain.gain.setValueAtTime(0.35, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
                osc.start(t);
                osc.stop(t + 0.25);
            });
        } catch (e) {}
    }, []);

    // --- v1.8: DETECÇÃO DE CRUZAMENTO S1/S2 ---
    useEffect(() => {
        const checarIntervalos = () => {
            // A tela apenas alerta; nunca deve iniciar intervalo em feriado,
            // DSR ou dia desmarcado na jornada.
            if (infoFeriado) return;

            const agora = new Date();
            const agoraSP = agora.toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
            const dataSP = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
            const [ah, am] = agoraSP.split(':').map(Number);
            const agoraMin = ah * 60 + am;
            const [ano, mes, dia] = dataSP.split('-').map(Number);
            const diaSemanaHoje = String(new Date(Date.UTC(ano, mes - 1, dia, 12)).getUTCDay());
            const n = (t) => t ? String(t).substring(0, 5) : null;

            const novosAlmoco = [];
            const novosPausa = [];

            for (const tiktik of tiktiks) {
                if (!['PRODUZINDO', 'LIVRE', 'LIVRE_MANUAL'].includes(tiktik.status_atual)) continue;
                const diasTrabalho = tiktik.dias_trabalho || { '0': false, '1': true, '2': true, '3': true, '4': true, '5': true, '6': false };
                if (diasTrabalho[diaSemanaHoje] !== true) continue;

                const s1 = n(tiktik.horario_saida_1);
                const s2 = n(tiktik.horario_saida_2);

                if (s1 && !tiktik.ponto_hoje?.horario_real_s1) {
                    const [s1h, s1m] = s1.split(':').map(Number);
                    const chave = `${tiktik.id}-almoco-${dataSP}`;
                    if (agoraMin >= s1h * 60 + s1m && !alertadosRef.current.has(chave)) {
                        alertadosRef.current.add(chave);
                        novosAlmoco.push(tiktik.nome.split(' ')[0]);
                        // O backend/cron abre e resolve a transição; a tela apenas alerta.
                    }
                }

                if (s2 && !tiktik.ponto_hoje?.horario_real_s2) {
                    const [s2h, s2m] = s2.split(':').map(Number);
                    const chave = `${tiktik.id}-pausa-${dataSP}`;
                    if (agoraMin >= s2h * 60 + s2m && !alertadosRef.current.has(chave)) {
                        alertadosRef.current.add(chave);
                        novosPausa.push(tiktik.nome.split(' ')[0]);
                        // O backend/cron abre e resolve a transição; a tela apenas alerta.
                    }
                }
            }

            if (novosAlmoco.length > 0 || novosPausa.length > 0) {
                setAlertaIntervalo({ almoco: novosAlmoco, pausa: novosPausa });
                tocarBeep();
                setTimeout(() => buscarDadosPainel(), 1500);
            }
        };

        const id = setInterval(checarIntervalos, 60000);
        return () => clearInterval(id);
    }, [tiktiks, infoFeriado, tocarBeep, buscarDadosPainel]);

    // --- v1.8: COUNTDOWN DO POPUP "DESFAZER" ---
    useEffect(() => {
        if (!desfazerPopup) return;
        if (desfazerPopup.countdown <= 0) { setDesfazerPopup(null); return; }
        const id = setTimeout(() => {
            setDesfazerPopup(prev => prev ? { ...prev, countdown: prev.countdown - 1 } : null);
        }, 1000);
        return () => clearTimeout(id);
    }, [desfazerPopup]);

    // --- HANDLERS ---

    const handleRefreshManual = useCallback(async () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        try { await buscarDadosPainel(); } finally { setIsRefreshing(false); }
    }, [isRefreshing, buscarDadosPainel]);

    const handleAtribuirTarefa = useCallback((tiktik) => {
        setTiktikSelecionado(tiktik);
        setModalAtribuicaoAberto(true);
    }, []);

    const handleSolicitarHoraExtra = useCallback(async (tiktik) => {
        const primeiroNome = tiktik.nome.split(' ')[0];
        const confirmado = await mostrarConfirmacao(
            `Autorizar lançamento em hora extra para ${primeiroNome}?\n\nEsta ação ficará registrada.`,
            'aviso'
        );
        if (!confirmado) return;
        setTiktikSelecionado({ ...tiktik, _modo_hora_extra: true });
        setModalAtribuicaoAberto(true);
    }, []);

    const handleCloseModalAtribuicao = useCallback(() => {
        setModalAtribuicaoAberto(false);
        setTiktikSelecionado(null);
        buscarDadosPainel();
    }, [buscarDadosPainel]);

    const handleFinalizar = useCallback(async (tiktik, pausaAcumuladaMs = 0) => {
        const isLote = Array.isArray(tiktik.id_sessao);
        let resultadoPrompt = null;

        if (isLote) {
            resultadoPrompt = await mostrarPromptFinalizarLote(
                `Finalizando lote para <strong>${tiktik.nome}</strong>.<br><br>Confirme as quantidades finalizadas para cada item:`,
                tiktik.sessoes
            );
        } else {
            const quantidadeNumerica = await mostrarPromptNumerico(
                `Finalizando tarefa de <strong>${tiktik.produto_nome}</strong> para <strong>${tiktik.nome}</strong>.<br><br>Confirme a quantidade realmente finalizada:`,
                { valorInicial: tiktik.quantidade_entregue, tipo: 'info' }
            );
            if (quantidadeNumerica !== null) {
                resultadoPrompt = {
                    total: quantidadeNumerica,
                    detalhes: [{ id_sessao: tiktik.id_sessao, quantidade_finalizada: quantidadeNumerica }]
                };
            }
        }

        if (resultadoPrompt === null) return;

        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/arremates/sessoes/finalizar', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    detalhes_finalizacao: resultadoPrompt.detalhes,
                    pausa_manual_ms: Math.round(pausaAcumuladaMs) || 0
                })
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Erro ao finalizar');
            mostrarMensagem('Tarefa finalizada e arremate registrado!', 'sucesso');
            await buscarDadosPainel();
            window.dispatchEvent(new Event('atualizar-fila-react'));
        } catch (err) {
            mostrarMensagem(`Erro ao finalizar: ${err.message}`, 'erro');
        }
    }, [buscarDadosPainel]);

    const handleCancelar = useCallback(async (tiktik) => {
        const isLote = Array.isArray(tiktik.id_sessao);
        const nomeTarefa = isLote
            ? `o lote de ${tiktik.quantidade_entregue} peças`
            : `a tarefa de ${tiktik.quantidade_entregue}x ${tiktik.produto_nome}`;

        const confirmado = await mostrarConfirmacao(
            `Cancelar ${nomeTarefa} de <strong>${tiktik.nome}</strong>?<br><br>O(s) produto(s) voltarão para a fila.`,
            'aviso'
        );
        if (!confirmado) return;

        try {
            const token = localStorage.getItem('token');
            const payload = isLote ? { ids_sessoes: tiktik.id_sessao } : { id_sessao: tiktik.id_sessao };
            const res = await fetch('/api/arremates/sessoes/cancelar', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Erro ao cancelar');
            mostrarMensagem('Tarefa cancelada com sucesso!', 'sucesso');
            await buscarDadosPainel();
            window.dispatchEvent(new Event('atualizar-fila-react'));
        } catch (err) {
            mostrarMensagem(`Erro ao cancelar: ${err.message}`, 'erro');
        }
    }, [buscarDadosPainel]);

    // Intercepta SAIDA_ANTECIPADA/ATRASO → handleExcecao; demais → PUT /status
    const handleAcaoManual = useCallback(async (tiktik, acao, mensagem) => {
        if (acao === 'SAIDA_ANTECIPADA' || acao === 'ATRASO') {
            return handleExcecao(tiktik.id, acao);
        }
        const textoConfirmacao = mensagem || `Confirmar ação para ${tiktik.nome}?`;
        const confirmado = await mostrarConfirmacao(textoConfirmacao, 'aviso');
        if (!confirmado) return;
        try {
            const token = localStorage.getItem('token');
            const ehFalta = acao === 'FALTOU';
            const res = await fetch(ehFalta ? '/api/ponto/falta' : `/api/usuarios/${tiktik.id}/status`, {
                method: ehFalta ? 'POST' : 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(ehFalta
                    ? { funcionario_id: tiktik.id }
                    : { status: acao })
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Erro ao atualizar status');
            const msg = acao === 'LIVRE_MANUAL' ? 'Tiktik liberada para trabalho.' : 'Status atualizado!';
            mostrarMensagem(msg, 'sucesso');
            buscarDadosPainel();
        } catch (err) {
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        }
    }, [buscarDadosPainel]);

    const handleExcecao = useCallback(async (tiktikId, tipoExcecao) => {
        let horario, motivo = '';

        if (tipoExcecao === 'SAIDA_ANTECIPADA') {
            const confirmado = await mostrarConfirmacao('Confirmar saída antecipada?', 'aviso');
            if (!confirmado) return;
            horario = '';
            // Atualização otimista
            const horaOtimistaSP = new Date().toLocaleTimeString('en-GB', {
                timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
            });
            setTiktiks(prev => prev.map(t =>
                t.id === tiktikId
                    ? { ...t, status_atual: 'FORA_DO_HORARIO', ponto_hoje: { ...(t.ponto_hoje || {}), horario_real_s3: horaOtimistaSP, saida_desfeita: false } }
                    : t
            ));
        } else if (tipoExcecao === 'ATRASO') {
            const entrada = await mostrarPromptHorario('Horário real de chegada:', {
                tipo: 'info',
                textoConfirmar: 'Registrar chegada'
            });
            if (!entrada) return;
            horario = entrada;
        } else {
            return;
        }

        const motivoDigitado = await mostrarPromptTexto('Motivo da exceção (obrigatório):', {
            placeholder: 'Ex: consulta médica, problema pessoal, atraso autorizado...',
            tipo: 'aviso',
            textoConfirmar: 'Registrar exceção'
        });
        if (!String(motivoDigitado || '').trim()) {
            buscarDadosPainel();
            mostrarMensagem('Informe um motivo para registrar a exceção.', 'aviso');
            return;
        }
        motivo = motivoDigitado.trim();

        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/ponto/excecao', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ funcionario_id: tiktikId, tipo_excecao: tipoExcecao, horario, motivo })
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                buscarDadosPainel();
                mostrarMensagem(body.error || 'Erro ao registrar exceção.', 'erro');
                return;
            }
            mostrarMensagem('Exceção registrada.', 'sucesso');
            buscarDadosPainel();
        } catch (err) {
            buscarDadosPainel();
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        }
    }, [buscarDadosPainel]);

    const handleLiberarIntervalo = useCallback(async (tiktikId, tipo) => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/ponto/liberar-intervalo', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ funcionario_id: tiktikId, tipo })
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Erro');
            const data = await res.json();
            mostrarMensagem(`Retorno previsto: ${data.retorno_previsto}`, 'sucesso');
            buscarDadosPainel();
        } catch (err) {
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        }
    }, [buscarDadosPainel]);

    // v1.9: PRODUZINDO + cronoPausadoAuto → retomar-trabalho; ALMOCO/PAUSA idle → status LIVRE_MANUAL
    const handleLiberarParaTrabalho = useCallback(async (tiktik, motivoOverride) => {
        const primeiroNome = tiktik.nome.split(' ')[0];
        const isProduzindo = tiktik.status_atual === 'PRODUZINDO';
        const tipoIntervalo = motivoOverride || tiktik.status_atual;

        try {
            const token = localStorage.getItem('token');

            if (isProduzindo) {
                const motivoRetorno = await mostrarPromptTexto('Motivo do retorno excepcional (obrigatório):', {
                    placeholder: 'Ex: retorno antecipado autorizado, ajuste operacional...',
                    tipo: 'aviso',
                    textoConfirmar: 'Registrar retorno'
                });
                if (!String(motivoRetorno || '').trim()) {
                    mostrarMensagem('Informe um motivo para registrar o retorno.', 'aviso');
                    return;
                }
                const res = await fetch('/api/ponto/retomar-trabalho', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ funcionario_id: tiktik.id, tipo: tipoIntervalo, motivo: motivoRetorno.trim() }),
                });
                if (!res.ok) throw new Error((await res.json()).error || 'Erro ao retomar trabalho');
            } else {
                const res = await fetch(`/api/usuarios/${tiktik.id}/status`, {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'LIVRE_MANUAL' }),
                });
                if (!res.ok) throw new Error((await res.json()).error || 'Erro ao liberar');
                setTiktiks(prev => prev.map(t =>
                    t.id === tiktik.id ? { ...t, status_atual: 'LIVRE' } : t
                ));
            }

            setDesfazerPopup({
                tiktikId: tiktik.id,
                nome: primeiroNome,
                tipo: tipoIntervalo,
                countdown: 10,
                origem: isProduzindo ? 'PRODUZINDO' : 'INTERVALO'
            });
            buscarDadosPainel();
        } catch (err) {
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        }
    }, [buscarDadosPainel]);

    const handleDesfazerLiberacao = useCallback(async () => {
        if (!desfazerPopup) return;
        const { tiktikId, nome, tipo, origem } = desfazerPopup;
        setDesfazerPopup(null);
        try {
            const token = localStorage.getItem('token');
            if (origem === 'PRODUZINDO') {
                const res = await fetch('/api/ponto/desfazer-retomada', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ funcionario_id: tiktikId, tipo }),
                });
                if (!res.ok) throw new Error('Erro ao desfazer retomada');
            } else {
                const res = await fetch('/api/ponto/desfazer-liberacao', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ funcionario_id: tiktikId }),
                });
                if (!res.ok) throw new Error('Erro ao desfazer');
            }
            mostrarMensagem(`${nome} voltou para o intervalo.`, 'sucesso');
            buscarDadosPainel();
        } catch (err) {
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        }
    }, [desfazerPopup, buscarDadosPainel]);

    const handleDesfazerSaida = useCallback(async (tiktikId) => {
        const confirmado = await mostrarConfirmacao('Desfazer saída antecipada?', 'aviso');
        if (!confirmado) return;
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/ponto/desfazer-saida', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ funcionario_id: tiktikId })
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                mostrarMensagem(body.error || 'Erro ao desfazer saída.', 'erro');
                return;
            }
            mostrarMensagem('Saída antecipada desfeita. Tiktik disponível.', 'sucesso');
            buscarDadosPainel();
        } catch (err) {
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        }
    }, [buscarDadosPainel]);

    if (carregando) return <UICarregando variante="bloco" />;

    // v3.0: ALMOCO e PAUSA ficam no grid principal (cards bloqueados)
    const statusPrincipais = ['PRODUZINDO', 'LIVRE', 'LIVRE_MANUAL', 'ALMOCO', 'PAUSA', 'PAUSA_MANUAL'];
    const tiktiksAtivos   = tiktiks.filter(t => statusPrincipais.includes(t.status_atual));
    const tiktiksInativos = tiktiks.filter(t => !statusPrincipais.includes(t.status_atual));

    const qtdProduzindo = tiktiks.filter(t => t.status_atual === 'PRODUZINDO').length;
    const qtdDisponivel = tiktiks.filter(t => ['LIVRE', 'LIVRE_MANUAL'].includes(t.status_atual)).length;
    const qtdIntervalo  = tiktiks.filter(t => ['ALMOCO', 'PAUSA', 'PAUSA_MANUAL'].includes(t.status_atual)).length;
    const temAlguemProduzindo = qtdProduzindo > 0;

    const ehDiaDeTrabalhoHoje = (diasTrabalho) => {
        const efetivo = diasTrabalho || { '1': true, '2': true, '3': true, '4': true, '5': true };
        const agora = new Date();
        const hojeSPStr = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        const [yr, mo, dy] = hojeSPStr.split('-').map(Number);
        const diaKey = String(new Date(Date.UTC(yr, mo - 1, dy, 12)).getDay());
        return !!efetivo[diaKey];
    };

    const getInfoInativo = (tiktik) => {
        const s = tiktik.status_atual;
        const n = (t) => t ? String(t).substring(0, 5) : null;
        const eDiaFolga = s === 'FORA_DO_HORARIO' && !ehDiaDeTrabalhoHoje(tiktik.dias_trabalho);

        const map = {
            FORA_DO_HORARIO: { icone: 'fa-moon',          label: eDiaFolga ? 'Folga' : 'Fora do Horário', cor: '#6366f1' },
            FALTOU:          { icone: 'fa-user-times',    label: 'Faltou',          cor: '#ef4444' },
            ALOCADO_EXTERNO: { icone: 'fa-shipping-fast', label: 'Outro Setor',     cor: '#8b5cf6' },
        };
        const info = map[s] || { icone: 'fa-question-circle', label: s, cor: '#aaa' };

        if (eDiaFolga) return { ...info, retorno: null, tempoFalta: null, eDiaFolga: true };

        let retorno = null;
        if (s === 'FORA_DO_HORARIO') {
            const temSaidaAntecipada = tiktik.ponto_hoje?.horario_real_s3 && !tiktik.ponto_hoje?.saida_desfeita;
            if (!temSaidaAntecipada) {
                const horaAtual = new Date().toLocaleTimeString('en-GB', {
                    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
                });
                const e1 = n(tiktik.horario_entrada_1);
                if (e1 && horaAtual < e1) retorno = e1;
            }
        }

        let tempoFalta = null;
        if (retorno) {
            const horaAtual = new Date().toLocaleTimeString('en-GB', {
                timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
            });
            const [rh, rm] = retorno.split(':').map(Number);
            const [ah, am] = horaAtual.split(':').map(Number);
            const diff = (rh * 60 + rm) - (ah * 60 + am);
            if (diff > 0) tempoFalta = `em ${diff} min`;
            else if (diff < 0) tempoFalta = `atrasado ${Math.abs(diff)} min`;
            else tempoFalta = 'agora';
        }

        return { ...info, retorno, tempoFalta, eDiaFolga: false };
    };

    const fmtH = (t) => t ? String(t).substring(0, 5) : '--:--';

    return (
        <>
            <div className="oa-main-content-card">
                <section className="oa-painel-atividades">

                    <div className="oa-secao-header">
                        <div className="oa-header-esquerda">
                            <h2 className="oa-titulo-secao">Painel de Atividades</h2>
                            {temAlguemProduzindo && (
                                <span className="oa-ao-vivo">
                                    <span className="oa-ao-vivo-dot"></span>
                                    AO VIVO
                                </span>
                            )}
                            <button
                                className="oa-btn-refresh"
                                onClick={handleRefreshManual}
                                disabled={isRefreshing}
                                title="Atualizar dados do painel"
                            >
                                <i className={`fas fa-sync-alt ${isRefreshing ? 'girando' : ''}`}></i>
                            </button>
                        </div>
                        <div className="oa-kpi-strip">
                            <span className={`oa-kpi-item${qtdProduzindo > 0 ? ' produzindo' : ''}`}>
                                <i className="fas fa-bolt"></i> {qtdProduzindo} produzindo
                            </span>
                            <span className={`oa-kpi-item${qtdDisponivel > 0 ? ' disponivel' : ''}`}>
                                <i className="fas fa-check-circle"></i> {qtdDisponivel} disponível
                            </span>
                            {qtdIntervalo > 0 && (
                                <span className="oa-kpi-item intervalo">
                                    <i className="fas fa-pause-circle"></i> {qtdIntervalo} em intervalo
                                </span>
                            )}
                        </div>
                    </div>

                    {infoFeriado && (
                        <div className="op-painel-banner-feriado">
                            <i className="fas fa-umbrella-beach"></i>
                            <span>FERIADO: {infoFeriado.nome_feriado} — As tiktiks não têm expediente hoje.</span>
                        </div>
                    )}

                    {tiktiksAtivos.length === 0 ? (
                        <div className="oa-empty-state">
                            <i className="fas fa-cut oa-empty-state-icon"></i>
                            <p className="oa-empty-state-titulo">Nenhuma tiktik em atividade</p>
                            <p className="oa-empty-state-subtitulo">Aguardando início das atividades</p>
                        </div>
                    ) : (
                        <div className="oa-painel-status-grid">
                            {tiktiksAtivos.map(t => (
                                <ArremateStatusCard
                                    key={t.id}
                                    tiktik={t}
                                    tpa={temposPadraoArremate[t.produto_id] || null}
                                    onAtribuirTarefa={handleAtribuirTarefa}
                                    onFinalizar={handleFinalizar}
                                    onCancelar={handleCancelar}
                                    onAcaoManualStatus={handleAcaoManual}
                                    onLiberarIntervalo={handleLiberarIntervalo}
                                    onLiberarParaTrabalho={handleLiberarParaTrabalho}
                                />
                            ))}
                        </div>
                    )}

                    {tiktiksInativos.length > 0 && (
                        <div className="oa-inativos-secao">
                            <div className="oa-inativos-titulo">Inativos</div>
                            <div className="oa-inativos-grid">
                                {tiktiksInativos.map(t => {
                                    const info = getInfoInativo(t);
                                    const primeiroNome = t.nome.split(' ')[0];
                                    return (
                                        <div key={t.id} className="oa-inativo-card">
                                            <div className="oa-inativo-card-topo">
                                                {(() => {
                                                    const foto = (t.avatar_url && !t.avatar_url.includes('image.jfif')) ? t.avatar_url : t.foto_oficial;
                                                    return foto
                                                        ? <div className="oa-inativo-avatar" style={{ backgroundImage: `url('${foto}')` }} />
                                                        : <div className="oa-inativo-avatar oa-inativo-avatar-vazio"><i className="fas fa-user"></i></div>;
                                                })()}
                                                <div className="oa-inativo-card-info">
                                                    <span className="oa-inativo-nome">{primeiroNome}</span>
                                                    <span className="oa-inativo-status" style={{ color: info.cor }}>
                                                        <i className={`fas ${info.icone}`}></i> {info.label}
                                                    </span>
                                                    {info.retorno && (
                                                        <span className="oa-inativo-retorno">
                                                            Retorno: <strong>{info.retorno}</strong>
                                                            {info.tempoFalta && (
                                                                <span className={`oa-inativo-tempo ${info.tempoFalta.startsWith('atrasado') ? 'atrasado' : ''}`}>
                                                                    {' '}({info.tempoFalta})
                                                                </span>
                                                            )}
                                                        </span>
                                                    )}
                                                    {!info.eDiaFolga && t.status_atual === 'FORA_DO_HORARIO' && t.ponto_hoje?.horario_real_s3 && (
                                                        <span className="oa-inativo-retorno">Saída antecipada: <strong>{String(t.ponto_hoje.horario_real_s3).substring(0, 5)}</strong></span>
                                                    )}
                                                </div>
                                                <button
                                                    className="oa-inativo-btn-info"
                                                    onClick={() => setInativoInfoId(t.id)}
                                                    title="Ver jornada"
                                                >
                                                    <i className="fas fa-info-circle"></i>
                                                </button>
                                            </div>

                                            {/* BUG-11: saída antecipada ativa → Desfazer; FORA_DO_HORARIO → Hora Extra; outros → Liberar */}
                                            {t.status_atual === 'FORA_DO_HORARIO' && t.ponto_hoje?.horario_real_s3 && !t.ponto_hoje?.saida_desfeita ? (
                                                <button
                                                    className="oa-inativo-btn-desfazer"
                                                    onClick={() => handleDesfazerSaida(t.id)}
                                                    title="Desfazer saída antecipada"
                                                >
                                                    <i className="fas fa-undo"></i> Desfazer Saída
                                                </button>
                                            ) : t.status_atual === 'FORA_DO_HORARIO' ? (
                                                <button
                                                    className="oa-inativo-btn-hora-extra"
                                                    onClick={() => handleSolicitarHoraExtra(t)}
                                                    title="Atribuir tarefa em hora extra"
                                                >
                                                    <i className="fas fa-clock"></i> Hora Extra
                                                </button>
                                            ) : (
                                                <button
                                                    className="oa-inativo-btn-liberar"
                                                    onClick={() => handleAcaoManual(t, 'LIVRE_MANUAL', `Liberar ${primeiroNome} para o trabalho?`)}
                                                    title="Liberar para o trabalho"
                                                >
                                                    <i className="fas fa-play"></i> Liberar
                                                </button>
                                            )}

                                            {/* Bottom sheet de jornada do inativo */}
                                            {inativoInfoId === t.id && ReactDOM.createPortal(
                                                <>
                                                    <div className="bs-overlay" onClick={() => setInativoInfoId(null)} />
                                                    <div className="bs-sheet">
                                                        <div className="bs-cabecalho">
                                                            {(() => {
                                                                const foto = (t.avatar_url && !t.avatar_url.includes('image.jfif')) ? t.avatar_url : t.foto_oficial;
                                                                return foto
                                                                    ? <div className="bs-avatar" style={{ backgroundImage: `url('${foto}')` }}></div>
                                                                    : <div className="bs-avatar bs-avatar-vazio"><i className="fas fa-user"></i></div>;
                                                            })()}
                                                            <div>
                                                                <div className="bs-nome">{t.nome}</div>
                                                                <div className="bs-role">Jornada de Trabalho</div>
                                                            </div>
                                                        </div>

                                                        <div className="bs-info-secao">
                                                            <div className="bs-info-label">Dias de trabalho</div>
                                                            <div className="bs-dias-chips">
                                                                {[['0','Dom'],['1','Seg'],['2','Ter'],['3','Qua'],['4','Qui'],['5','Sex'],['6','Sáb']].map(([d, l]) => {
                                                                    const ativo = (t.dias_trabalho || {'1':true,'2':true,'3':true,'4':true,'5':true})[d];
                                                                    return <span key={d} className={`bs-dia-chip ${ativo ? 'ativo' : ''}`}>{l}</span>;
                                                                })}
                                                            </div>
                                                        </div>

                                                        <div className="bs-info-secao">
                                                            <div className="bs-info-label">Horários</div>
                                                            <div className="bs-horarios-lista">
                                                                <div className="bs-horario-linha">
                                                                    <span className="bs-horario-icone"><i className="fas fa-sign-in-alt"></i></span>
                                                                    <span className="bs-horario-desc">Entrada <span className="bs-horario-ref">(E1)</span></span>
                                                                    <span className="bs-horario-valor">{fmtH(t.horario_entrada_1)}</span>
                                                                </div>
                                                                {t.horario_saida_1 && (
                                                                    <div className="bs-horario-linha bs-horario-intervalo">
                                                                        <span className="bs-horario-icone"><i className="fas fa-utensils"></i></span>
                                                                        <span className="bs-horario-desc">Almoço <span className="bs-horario-ref">(S1 → E2)</span></span>
                                                                        <span className="bs-horario-valor">{fmtH(t.horario_saida_1)} → {fmtH(t.horario_entrada_2)}</span>
                                                                    </div>
                                                                )}
                                                                {t.horario_saida_2 && (
                                                                    <div className="bs-horario-linha bs-horario-intervalo">
                                                                        <span className="bs-horario-icone"><i className="fas fa-coffee"></i></span>
                                                                        <span className="bs-horario-desc">Pausa <span className="bs-horario-ref">(S2 → E3)</span></span>
                                                                        <span className="bs-horario-valor">{fmtH(t.horario_saida_2)} → {fmtH(t.horario_entrada_3)}</span>
                                                                    </div>
                                                                )}
                                                                <div className="bs-horario-linha">
                                                                    <span className="bs-horario-icone"><i className="fas fa-sign-out-alt"></i></span>
                                                                    <span className="bs-horario-desc">Saída <span className="bs-horario-ref">(S3)</span></span>
                                                                    <span className="bs-horario-valor">{fmtH(t.horario_saida_3 || t.horario_saida_2 || t.horario_saida_1)}</span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {t.ponto_hoje && (t.ponto_hoje.horario_real_s1 || t.ponto_hoje.horario_real_s2 || t.ponto_hoje.horario_real_s3) && (
                                                            <div className="bs-info-secao">
                                                                <div className="bs-info-label">Registros de hoje</div>
                                                                <div className="bs-registros-hoje">
                                                                    {t.ponto_hoje.horario_real_s1 && (
                                                                        <div className="bs-registro-linha">
                                                                            <span className="bs-registro-icone"><i className="fas fa-utensils"></i></span>
                                                                            <span className="bs-registro-desc">Saída almoço</span>
                                                                            <span className="bs-registro-valor registrado">{fmtH(t.ponto_hoje.horario_real_s1)}</span>
                                                                        </div>
                                                                    )}
                                                                    {t.ponto_hoje.horario_real_e2 && (
                                                                        <div className="bs-registro-linha">
                                                                            <span className="bs-registro-icone"><i className="fas fa-utensils"></i></span>
                                                                            <span className="bs-registro-desc">Retorno almoço</span>
                                                                            <span className="bs-registro-valor registrado">{fmtH(t.ponto_hoje.horario_real_e2)}</span>
                                                                        </div>
                                                                    )}
                                                                    {t.ponto_hoje.horario_real_s2 && (
                                                                        <div className="bs-registro-linha">
                                                                            <span className="bs-registro-icone"><i className="fas fa-coffee"></i></span>
                                                                            <span className="bs-registro-desc">Saída pausa</span>
                                                                            <span className="bs-registro-valor registrado">{fmtH(t.ponto_hoje.horario_real_s2)}</span>
                                                                        </div>
                                                                    )}
                                                                    {t.ponto_hoje.horario_real_e3 && (
                                                                        <div className="bs-registro-linha">
                                                                            <span className="bs-registro-icone"><i className="fas fa-coffee"></i></span>
                                                                            <span className="bs-registro-desc">Retorno pausa</span>
                                                                            <span className="bs-registro-valor registrado">{fmtH(t.ponto_hoje.horario_real_e3)}</span>
                                                                        </div>
                                                                    )}
                                                                    {t.ponto_hoje.horario_real_s3 && (
                                                                        <div className={`bs-registro-linha${t.ponto_hoje.saida_desfeita ? ' desfeito' : ''}`}>
                                                                            <span className="bs-registro-icone"><i className="fas fa-sign-out-alt"></i></span>
                                                                            <span className="bs-registro-desc">
                                                                                Saída antecipada
                                                                                {t.ponto_hoje.saida_desfeita && (
                                                                                    <em className="bs-registro-desfeito"> — desfeita por {t.ponto_hoje.saida_desfeita_por || 'supervisor'}</em>
                                                                                )}
                                                                            </span>
                                                                            <span className="bs-registro-valor registrado">{fmtH(t.ponto_hoje.horario_real_s3)}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}

                                                        <button className="bs-cancelar" onClick={() => setInativoInfoId(null)}>Fechar</button>
                                                    </div>
                                                </>,
                                                document.body
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                </section>
            </div>

            {/* v1.8 — Popup de alerta de intervalo */}
            {alertaIntervalo && ReactDOM.createPortal(
                <>
                    <div className="oa-popup-overlay" onClick={() => setAlertaIntervalo(null)} />
                    <div className="oa-popup-intervalo" onClick={e => e.stopPropagation()}>
                        <div className="oa-popup-intervalo-icone">⏸️</div>
                        <div className="oa-popup-intervalo-titulo">Horário de Intervalo</div>
                        <div className="oa-popup-intervalo-corpo">
                            {alertaIntervalo.almoco.length > 0 && (
                                <div className="oa-popup-intervalo-linha almoco">
                                    <i className="fas fa-utensils"></i>
                                    <span><strong>Almoço</strong> — {alertaIntervalo.almoco.join(', ')}</span>
                                </div>
                            )}
                            {alertaIntervalo.pausa.length > 0 && (
                                <div className="oa-popup-intervalo-linha pausa">
                                    <i className="fas fa-coffee"></i>
                                    <span><strong>Pausa</strong> — {alertaIntervalo.pausa.join(', ')}</span>
                                </div>
                            )}
                            <p className="oa-popup-intervalo-aviso">
                                Cards bloqueados até o retorno. Relógio pausado automaticamente.
                            </p>
                        </div>
                        <button className="oa-popup-intervalo-btn" onClick={() => setAlertaIntervalo(null)}>
                            Entendi
                        </button>
                    </div>
                </>,
                document.body
            )}

            {/* v1.8 — Popup "Desfazer liberação" com countdown */}
            {desfazerPopup && ReactDOM.createPortal(
                <>
                    <div className="oa-popup-overlay" />
                    <div className="oa-popup-desfazer" onClick={e => e.stopPropagation()}>
                        <div className="oa-popup-desfazer-icone">✓</div>
                        <div className="oa-popup-desfazer-titulo">
                            {desfazerPopup.nome} liberado{desfazerPopup.tipo === 'ALMOCO' ? ' do almoço' : ' da pausa'}
                        </div>
                        <p className="oa-popup-desfazer-desc">
                            Clique em <strong>Desfazer</strong> para retornar ao intervalo.
                        </p>
                        <div className="oa-popup-desfazer-countdown">{desfazerPopup.countdown}s</div>
                        <div className="oa-popup-desfazer-acoes">
                            <button className="oa-popup-desfazer-btn desfazer" onClick={handleDesfazerLiberacao}>
                                <i className="fas fa-undo"></i> Desfazer
                            </button>
                            <button className="oa-popup-desfazer-btn confirmar" onClick={() => setDesfazerPopup(null)}>
                                Confirmar
                            </button>
                        </div>
                    </div>
                </>,
                document.body
            )}

            <ArremateAtribuicaoModal
                isOpen={modalAtribuicaoAberto}
                onClose={handleCloseModalAtribuicao}
                tiktik={tiktikSelecionado}
            />
        </>
    );
}
