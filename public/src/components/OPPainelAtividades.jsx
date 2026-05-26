// public/src/components/OPPainelAtividades.jsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import OPStatusCard from './OPStatusCard.jsx';
import UICarregando from './UICarregando.jsx';
import { mostrarMensagem, mostrarConfirmacao, mostrarPromptNumerico, mostrarPromptTexto, mostrarPromptHorario } from '/js/utils/popups.js';
import OPAtribuicaoModal from './OPAtribuicaoModal.jsx';
import UIBloqueio from './UIBloqueio.jsx';
import OPPontoPopup from './OPPontoPopup.jsx';

export default function OPPainelAtividades() {
    const [funcionarios, setFuncionarios] = useState([]);
    const [temposPadraoProducao, setTemposPadraoProducao] = useState({});
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);

    const [modalAberto, setModalAberto] = useState(false);
    const [funcionarioSelecionado, setFuncionarioSelecionado] = useState(null);
    const [inativoInfoId, setInativoInfoId] = useState(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [infoFeriado, setInfoFeriado] = useState(null);
    // v1.8 — Alerta de intervalo (almoço/pausa automático)
    const [alertaIntervalo, setAlertaIntervalo] = useState(null);
    // { almoco: ['Maria', 'Ana'], pausa: ['Rosa'] }

    // v1.8 — Popup de "Desfazer liberação" com countdown
    const [desfazerPopup, setDesfazerPopup] = useState(null);
    // { funcionarioId, nome, tipo: 'ALMOCO'|'PAUSA', countdown: 10 }

    // Popup de confirmação de ponto (saídas e retornos)
    const [pontoPopup, setPontoPopup] = useState(null);
    // { tipo: 'ALMOCO'|'PAUSA'|'RETORNO_ALMOCO'|'RETORNO_PAUSA', funcionario, onConfirmar }

    // v1.8 — Controle de áudio (Web Audio API)
    const audioCtxRef      = useRef(null);
    const audioUnlockedRef = useRef(false);

    // v1.8 — Rastreia quais funcionários já receberam alerta nesta sessão
    // Chave: `${funcionario_id}-almoco-${dataSP}` ou `...-pausa-...`
    const alertadosRef = useRef(new Set());

    const pollingTimeoutRef = useRef(null);

    // --- 1. BUSCA DE DADOS ---
    const buscarDadosPainel = useCallback(async () => {
        try {
            const token = localStorage.getItem('token');
            const [dataFuncionarios, dataTempos] = await Promise.all([
                fetch('/api/producao/status-funcionarios', { headers: { 'Authorization': `Bearer ${token}` } }).then(res => {
                    if (!res.ok) throw new Error('Falha ao carregar status.');
                    return res.json();
                }),
                fetch('/api/producao/tempos-padrao', { headers: { 'Authorization': `Bearer ${token}` } }).then(res => {
                    if (!res.ok) return {};
                    return res.json();
                })
            ]);

            const funcionariosArray = Array.isArray(dataFuncionarios)
                ? dataFuncionarios
                : dataFuncionarios.funcionarios;
            const feriadoInfo = !Array.isArray(dataFuncionarios) && dataFuncionarios.is_feriado_hoje
                ? { nome_feriado: dataFuncionarios.nome_feriado }
                : null;
            setFuncionarios(funcionariosArray);
            setInfoFeriado(feriadoInfo);
            setTemposPadraoProducao(dataTempos);
            setErro(null);
        } catch (err) {
            console.error("Erro no polling:", err);
        } finally {
            setCarregando(false);
        }
    }, []);

    // --- 2. POLLING OTIMIZADO (SEM LOOP INFINITO) ---
    useEffect(() => {
        // Busca inicial
        buscarDadosPainel();

        // Configura atualização ao voltar para a aba
        const handleFocus = () => {
            buscarDadosPainel();
        };

        window.addEventListener('focus', handleFocus);

        return () => {
            window.removeEventListener('focus', handleFocus);
        };
    }, [buscarDadosPainel]);

    // --- v1.8: DESBLOQUEIO DE ÁUDIO ---
    // Chrome bloqueia áudio sem interação prévia do usuário.
    // Desbloqueamos no primeiro clique/toque — silencioso, sem popup de permissão.
    useEffect(() => {
        const unlock = () => {
            if (audioUnlockedRef.current) return;
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                ctx.resume().then(() => {
                    audioCtxRef.current = ctx;
                    audioUnlockedRef.current = true;
                });
            } catch (e) { /* sem suporte a AudioContext — degrada graciosamente */ }
        };
        document.addEventListener('click', unlock, { once: true });
        document.addEventListener('touchstart', unlock, { once: true });
        return () => {
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
        };
    }, []);

    // Toca 3 bips descendentes (880→660→440 Hz) — som de alerta de fábrica.
    const tocarBeep = useCallback(() => {
        try {
            const ctx = audioCtxRef.current;
            if (!ctx || ctx.state === 'suspended') return;
            [880, 660, 440].forEach((freq, i) => {
                const osc  = ctx.createOscillator();
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
        } catch (e) { /* áudio indisponível */ }
    }, []);

    // --- v1.8: TIMER 60s — DETECÇÃO DE CRUZAMENTO S1/S2 ---
    // Verifica a cada 60s se algum funcionário passou do horário de almoço (S1)
    // ou pausa (S2). Quando detectado: grava ponto_diario + exibe popup de alerta + toca bip.
    const liberarIntervaloSilencioso = useCallback(async (funcionarioId, tipo) => {
        try {
            const token = localStorage.getItem('token');
            await fetch('/api/ponto/liberar-intervalo', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ funcionario_id: funcionarioId, tipo }),
            });
            // Não precisa tratar resposta — o próximo poll do buscarDadosPainel sincroniza o estado.
        } catch (e) { /* silencioso — poll regular vai recuperar */ }
    }, []);

    useEffect(() => {
        const checarIntervalos = () => {
            const agora   = new Date();
            const agoraSP = agora.toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
            const dataSP  = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
            const [ah, am] = agoraSP.split(':').map(Number);
            const agoraMin = ah * 60 + am;
            const n = (t) => t ? String(t).substring(0, 5) : null;

            const novosAlmoco = [];
            const novosPausa  = [];

            for (const func of funcionarios) {
                // Só verifica funcionários que estão ativos (produzindo ou disponíveis)
                if (!['PRODUZINDO', 'LIVRE', 'LIVRE_MANUAL'].includes(func.status_atual)) continue;

                const s1 = n(func.horario_saida_1);
                const s2 = n(func.horario_saida_2);

                // Verificar almoço (S1)
                if (s1 && !func.ponto_hoje?.horario_real_s1) {
                    const [s1h, s1m] = s1.split(':').map(Number);
                    const chave = `${func.id}-almoco-${dataSP}`;
                    if (agoraMin >= s1h * 60 + s1m && !alertadosRef.current.has(chave)) {
                        alertadosRef.current.add(chave);
                        novosAlmoco.push(func.nome.split(' ')[0]);
                        liberarIntervaloSilencioso(func.id, 'ALMOCO');
                    }
                }

                // Verificar pausa (S2) — só se almoço já foi (ponto tem s1 ou não tem almoço)
                if (s2 && !func.ponto_hoje?.horario_real_s2) {
                    const [s2h, s2m] = s2.split(':').map(Number);
                    const chave = `${func.id}-pausa-${dataSP}`;
                    if (agoraMin >= s2h * 60 + s2m && !alertadosRef.current.has(chave)) {
                        alertadosRef.current.add(chave);
                        novosPausa.push(func.nome.split(' ')[0]);
                        liberarIntervaloSilencioso(func.id, 'PAUSA');
                    }
                }
            }

            if (novosAlmoco.length > 0 || novosPausa.length > 0) {
                setAlertaIntervalo({ almoco: novosAlmoco, pausa: novosPausa });
                tocarBeep();
                // Sincroniza estado após pequeno delay (ponto_diario já foi gravado)
                setTimeout(() => buscarDadosPainel(), 1500);
            }
        };

        const id = setInterval(checarIntervalos, 60000);
        return () => clearInterval(id);
    }, [funcionarios, liberarIntervaloSilencioso, tocarBeep, buscarDadosPainel]);

    // --- v1.8: COUNTDOWN DO POPUP "DESFAZER LIBERAÇÃO" ---
    useEffect(() => {
        if (!desfazerPopup) return;
        if (desfazerPopup.countdown <= 0) {
            setDesfazerPopup(null); // tempo esgotado — liberação confirmada
            return;
        }
        const id = setTimeout(() => {
            setDesfazerPopup(prev => prev ? { ...prev, countdown: prev.countdown - 1 } : null);
        }, 1000);
        return () => clearTimeout(id);
    }, [desfazerPopup]);

 


    const handleAtribuirTarefa = (funcionario) => {
        setFuncionarioSelecionado(funcionario);
        setModalAberto(true);
    };

    const handleSolicitarHoraExtra = async (funcionario) => {
        const primeiroNome = funcionario.nome.split(' ')[0];
        const confirmado = await mostrarConfirmacao(
            `Autorizar lançamento em hora extra para ${primeiroNome}?\n\nEsta ação ficará registrada e o gerente será notificado.`,
            'aviso'
        );
        if (!confirmado) return;
        setFuncionarioSelecionado({ ...funcionario, _modo_hora_extra: true });
        setModalAberto(true);
    };

    const handleCloseModal = () => {
        setModalAberto(false);
        setFuncionarioSelecionado(null);
        buscarDadosPainel();
    };

    // MELHORIA-05: refresh manual sem recarregar a página
    const handleRefreshManual = useCallback(async () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        try {
            await buscarDadosPainel();
        } finally {
            setIsRefreshing(false);
        }
    }, [isRefreshing, buscarDadosPainel]);

    // --- v1.8: LIBERAR FUNCIONÁRIO EM ALMOCO/PAUSA PARA O TRABALHO ---
    // Chamado pelo botão "Liberar para trabalho" no card bloqueado.
    // v1.9: suporta também o caso PRODUZINDO + cronoPausadoAuto (motivoOverride = 'ALMOCO'|'PAUSA').
    //   - Caso ALMOCO/PAUSA idle: muda status para LIVRE_MANUAL (comportamento original).
    //   - Caso PRODUZINDO: chama POST /ponto/retomar-trabalho que seta e2/e3=agora
    //     → calcularTempoEfetivo detecta e descongela o contador sem mexer em status/sessão.
    // Após a ação, exibe o popup de "Desfazer" com countdown de 10s.
    const handleLiberarParaTrabalho = useCallback(async (funcionario, motivoOverride) => {
        const primeiroNome = funcionario.nome.split(' ')[0];
        const isProduzindo = funcionario.status_atual === 'PRODUZINDO';
        // motivoOverride vem do OPStatusCard quando PRODUZINDO ('ALMOCO' ou 'PAUSA')
        const tipoIntervalo = motivoOverride || funcionario.status_atual; // 'ALMOCO' | 'PAUSA'
        const tipoPopup = tipoIntervalo === 'ALMOCO' ? 'RETORNO_ALMOCO' : 'RETORNO_PAUSA';

        // Mostra popup de confirmação de retorno antes de disparar a API
        setPontoPopup({
            tipo: tipoPopup,
            funcionario,
            onConfirmar: async () => {
                setPontoPopup(null);
                try {
                    const token = localStorage.getItem('token');

                    if (isProduzindo) {
                        // Caso PRODUZINDO: descongela contador via ponto_diario (não toca status/sessão)
                        const res = await fetch('/api/ponto/retomar-trabalho', {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ funcionario_id: funcionario.id, tipo: tipoIntervalo }),
                        });
                        if (!res.ok) throw new Error((await res.json()).error || 'Erro ao retomar trabalho');
                        // Sem atualização otimista de status — o buscarDadosPainel atualizará o ponto_hoje
                        // e calcularTempoEfetivo descongelará o contador automaticamente
                    } else {
                        // Caso ALMOCO/PAUSA idle: muda status para LIVRE_MANUAL
                        const res = await fetch(`/api/usuarios/${funcionario.id}/status`, {
                            method: 'PUT',
                            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: 'LIVRE_MANUAL' }),
                        });
                        if (!res.ok) throw new Error((await res.json()).error || 'Erro ao liberar');
                        // Atualização otimista — card muda imediatamente para LIVRE
                        setFuncionarios(prev => prev.map(f =>
                            f.id === funcionario.id ? { ...f, status_atual: 'LIVRE' } : f
                        ));
                    }

                    // Exibe popup de desfazer com countdown de 10s
                    // 'origem' diferencia o caminho do desfazer: PRODUZINDO reseta e2/e3; INTERVALO reseta status
                    setDesfazerPopup({ funcionarioId: funcionario.id, nome: primeiroNome, tipo: tipoIntervalo, countdown: 10, origem: isProduzindo ? 'PRODUZINDO' : 'INTERVALO' });
                    buscarDadosPainel();
                } catch (err) {
                    mostrarMensagem(`Erro: ${err.message}`, 'erro');
                }
            },
        });
    }, [buscarDadosPainel]);

    // --- v1.8: DESFAZER LIBERAÇÃO (popup com countdown) ---
    // v1.9: roteia para endpoint correto conforme 'origem' do popup:
    //   - 'PRODUZINDO': chama /desfazer-retomada (reseta e2/e3 → contador recongelará)
    //   - 'INTERVALO' (ou ausente): chama /desfazer-liberacao (reseta status → ALMOCO/PAUSA recalculado)
    const handleDesfazerLiberacao = useCallback(async () => {
        if (!desfazerPopup) return;
        const { funcionarioId, nome, tipo, origem } = desfazerPopup;
        setDesfazerPopup(null);
        try {
            const token = localStorage.getItem('token');

            if (origem === 'PRODUZINDO') {
                // Desfaz retomada: reseta e2/e3 para NULL → calcularTempoEfetivo recongelará o contador
                const res = await fetch('/api/ponto/desfazer-retomada', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ funcionario_id: funcionarioId, tipo }),
                });
                if (!res.ok) throw new Error('Erro ao desfazer retomada');
            } else {
                // Desfaz liberação de ALMOCO/PAUSA idle: reseta status → determinarStatusFinalServidor recalcula
                const res = await fetch('/api/ponto/desfazer-liberacao', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ funcionario_id: funcionarioId }),
                });
                if (!res.ok) throw new Error('Erro ao desfazer');
            }

            mostrarMensagem(`${nome} voltou para o intervalo.`, 'sucesso');
            buscarDadosPainel();
        } catch (err) {
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        }
    }, [desfazerPopup, buscarDadosPainel]);

    const handleAcaoManual = async (funcionario, acao, mensagem) => {
        // Intercepta ações de ponto — não são status de usuário, vão para api/ponto
        if (acao === 'SAIDA_ANTECIPADA' || acao === 'ATRASO') {
            return handleExcecao(funcionario.id, acao);
        }
        const textoConfirmacao = mensagem || `Confirmar ação para ${funcionario.nome}?`;
        const confirmado = await mostrarConfirmacao(textoConfirmacao, 'aviso');
        if(!confirmado) return;
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/usuarios/${funcionario.id}/status`, {
                method: 'PUT',
                headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
                body: JSON.stringify({ status: acao })
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Erro ao atualizar status');
            const msg = acao === 'LIVRE_MANUAL'
                ? 'Usuário liberado para uma sessão de tarefas'
                : 'Status atualizado!';
            mostrarMensagem(msg, 'sucesso');
            buscarDadosPainel();
        } catch(e) { mostrarMensagem(e.message, 'erro'); }
    };

    const handleFinalizarTarefa = async (funcionario, pausaManualMs = 0) => {
        const { tarefa_atual } = funcionario;
        if (!tarefa_atual || !tarefa_atual.id_sessao) {
            mostrarMensagem("Erro: Sessão inválida.", "erro");
            return;
        }
        const quantidadeFinal = await mostrarPromptNumerico(
            `Finalizar tarefa de ${funcionario.nome}? Confirme a quantidade:`,
            { valorInicial: tarefa_atual.quantidade, tipo: 'info' }
        );
        if (quantidadeFinal === null || quantidadeFinal === '') return;

        try {
            const token = localStorage.getItem('token');
            await fetch('/api/producoes/finalizar', {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id_sessao: tarefa_atual.id_sessao,
                    quantidade_finalizada: Number(quantidadeFinal),
                    pausa_manual_ms: Math.round(pausaManualMs) || 0
                })
            });
            mostrarMensagem('Finalizado!', 'sucesso');
            buscarDadosPainel();
        } catch (err) { mostrarMensagem(err.message, 'erro'); }
    };

    const handleCancelarTarefa = async (funcionario) => {
        const { tarefa_atual } = funcionario;
        if (!tarefa_atual || !tarefa_atual.id_sessao) return;
        if(!await mostrarConfirmacao(`Cancelar tarefa de ${funcionario.nome}?`, 'aviso')) return;

        try {
            const token = localStorage.getItem('token');
            await fetch('/api/producao/sessoes/cancelar', {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_sessao: tarefa_atual.id_sessao })
            });
            mostrarMensagem('Cancelado!', 'sucesso');
            buscarDadosPainel();
        } catch (err) { mostrarMensagem(err.message, 'erro'); }
    };

    // --- EXCEÇÕES DE PONTO (saída antecipada / chegada atrasada) ---
    const handleExcecao = useCallback(async (funcionarioId, tipoExcecao) => {
        let horario, motivo = '';

        if (tipoExcecao === 'SAIDA_ANTECIPADA') {
            // 1. Confirmar a ação (único ponto de cancelamento — motivo não é ponto de cancelamento)
            const confirmado = await mostrarConfirmacao('Confirmar saída antecipada?', 'aviso');
            if (!confirmado) return;
            // 2. Pedir motivo opcional — mas se o supervisor fechar/cancelar, prossegue sem motivo.
            // BUG-25: null no prompt de motivo cancelava a ação inteira → supervisor tentava 4-5x
            // no tablet. Agora null = "sem motivo", prossegue normalmente.
            const motivoDigitado = await mostrarPromptTexto('Motivo da saída (opcional):', {
                placeholder: 'Ex: consulta médica, problema pessoal... (pode deixar em branco)',
                tipo: 'aviso',
                textoConfirmar: 'Registrar saída'
            });
            motivo = motivoDigitado ?? ''; // null (fechou sem preencher) = sem motivo — prossegue
            // BUG-13: horário real será calculado no servidor; enviamos string vazia
            horario = '';

            // BUG-09: atualização otimista — muda o card imediatamente sem esperar a API
            const horaOtimistaSP = new Date().toLocaleTimeString('en-GB', {
                timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
            });
            setFuncionarios(prev => prev.map(f =>
                f.id === funcionarioId
                    ? { ...f, status_atual: 'FORA_DO_HORARIO', ponto_hoje: { ...(f.ponto_hoje || {}), horario_real_s3: horaOtimistaSP, saida_desfeita: false } }
                    : f
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

        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/ponto/excecao', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ funcionario_id: funcionarioId, tipo_excecao: tipoExcecao, horario, motivo })
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                // Reverte estado otimista em caso de falha
                buscarDadosPainel();
                mostrarMensagem(body.error || 'Erro ao registrar exceção. Tente novamente.', 'erro');
                return;
            }
            mostrarMensagem('Exceção registrada.', 'sucesso');
            buscarDadosPainel(); // sincroniza com o banco (confirma o estado otimista)
        } catch (err) {
            buscarDadosPainel(); // reverte estado otimista
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        }
    }, [buscarDadosPainel]);

    // --- LIBERAÇÃO ANTECIPADA PARA INTERVALO ---
    const handleLiberarIntervalo = useCallback(async (funcionarioId, tipo) => {
        const funcionario = funcionarios.find(f => f.id === funcionarioId);
        if (!funcionario) return;

        // Mostra popup de confirmação antes de disparar a API
        setPontoPopup({
            tipo, // 'ALMOCO' | 'PAUSA'
            funcionario,
            onConfirmar: async () => {
                setPontoPopup(null);
                try {
                    const token = localStorage.getItem('token');
                    const res = await fetch('/api/ponto/liberar-intervalo', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ funcionario_id: funcionarioId, tipo })
                    });
                    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
                    const data = await res.json();
                    mostrarMensagem(`Retorno previsto: ${data.retorno_previsto}`, 'sucesso');
                    buscarDadosPainel();
                } catch (err) {
                    mostrarMensagem(`Erro: ${err.message}`, 'erro');
                }
            },
        });
    }, [funcionarios, buscarDadosPainel]);

    // BUG-10: Desfazer saída antecipada lançada por engano
    const handleDesfazerSaida = useCallback(async (funcionarioId) => {
        const confirmado = await mostrarConfirmacao(
            'Desfazer saída antecipada?',
            'aviso'
        );
        if (!confirmado) return;

        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/ponto/desfazer-saida', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ funcionario_id: funcionarioId })
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                mostrarMensagem(body.error || 'Erro ao desfazer saída.', 'erro');
                return;
            }
            mostrarMensagem('Saída antecipada desfeita. Funcionário disponível.', 'sucesso');
            buscarDadosPainel();
        } catch (err) {
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        }
    }, [buscarDadosPainel]);

    
    if (carregando) return <UICarregando variante="bloco" />;
    if (erro) return <p style={{ color: 'red', textAlign: 'center' }}>Erro: {erro}</p>;

    // v1.8: ALMOCO e PAUSA ficam no grid principal (cards bloqueados) — não vão para inativos.
    // Inativos = somente verdadeiramente inativos: FORA_DO_HORARIO, FALTOU, ALOCADO_EXTERNO.
    const statusPrincipais = ['PRODUZINDO', 'LIVRE', 'LIVRE_MANUAL', 'ALMOCO', 'PAUSA', 'PAUSA_MANUAL'];
    const funcionariosPrincipais = funcionarios.filter(f => statusPrincipais.includes(f.status_atual));
    const funcionariosInativos   = funcionarios.filter(f => !statusPrincipais.includes(f.status_atual));

    const qtdProduzindo  = funcionarios.filter(f => f.status_atual === 'PRODUZINDO').length;
    const qtdDisponivel  = funcionarios.filter(f => ['LIVRE', 'LIVRE_MANUAL'].includes(f.status_atual)).length;
    const qtdIntervalo   = funcionarios.filter(f => ['ALMOCO', 'PAUSA', 'PAUSA_MANUAL'].includes(f.status_atual)).length;
    const temAlguemProduzindo = qtdProduzindo > 0;

    // Determina se hoje é dia de trabalho para o funcionário (mesmo fallback do servidor)
    const ehDiaDeTrabalhoHoje = (diasTrabalho) => {
        const efetivo = diasTrabalho || { '1': true, '2': true, '3': true, '4': true, '5': true };
        const agora = new Date();
        const hojeSPStr = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        const [yr, mo, dy] = hojeSPStr.split('-').map(Number);
        const diaKey = String(new Date(Date.UTC(yr, mo - 1, dy, 12)).getDay());
        return !!efetivo[diaKey];
    };

    const getInfoInativo = (func) => {
        const s = func.status_atual;
        const n = (t) => t ? String(t).substring(0, 5) : null;

        // Verifica se é dia de folga (para diferenciar "Fora do Horário" de "Folga")
        const eDiaFolga = s === 'FORA_DO_HORARIO' && !ehDiaDeTrabalhoHoje(func.dias_trabalho);

        const map = {
            PAUSA:           { icone: 'fa-coffee',        label: 'Em Pausa',        cor: '#f59e0b' },
            PAUSA_MANUAL:    { icone: 'fa-coffee',        label: 'Em Pausa',        cor: '#f59e0b' },
            ALMOCO:          { icone: 'fa-utensils',      label: 'Almoço',          cor: '#f97316' },
            FORA_DO_HORARIO: { icone: 'fa-moon',          label: eDiaFolga ? 'Folga' : 'Fora do Horário', cor: '#6366f1' },
            FALTOU:          { icone: 'fa-user-times',    label: 'Faltou',          cor: '#ef4444' },
            ALOCADO_EXTERNO: { icone: 'fa-shipping-fast', label: 'Outro Setor',     cor: '#8b5cf6' },
        };
        const info = map[s] || { icone: 'fa-question-circle', label: s, cor: '#aaa' };

        // Em dia de folga não exibir retorno nem ponto_diario (dados sem significado para esse dia)
        if (eDiaFolga) return { ...info, retorno: null, tempoFalta: null, eDiaFolga: true };

        // Calcular horário de retorno e tempo faltando
        let retorno = null;
        if (s === 'ALMOCO') {
            retorno = n(func.ponto_hoje?.horario_real_e2) || n(func.horario_entrada_2);
        } else if (s === 'PAUSA' || s === 'PAUSA_MANUAL') {
            retorno = n(func.ponto_hoje?.horario_real_e3) || n(func.horario_entrada_3);
        } else if (s === 'FORA_DO_HORARIO') {
            const temSaidaAntecipada = func.ponto_hoje?.horario_real_s3 && !func.ponto_hoje?.saida_desfeita;
            if (!temSaidaAntecipada) {
                // Só mostra "Retorno: HH:MM" se for ANTES do E1 (funcionário ainda não chegou hoje).
                // Depois do S3 o turno já encerrou — não faz sentido mostrar "atrasado X min".
                const horaAtual = new Date().toLocaleTimeString('en-GB', {
                    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
                });
                const e1 = n(func.horario_entrada_1);
                if (e1 && horaAtual < e1) {
                    retorno = e1; // antes do início do turno → mostra horário de entrada
                }
                // depois do S3 → retorno = null (turno encerrado normalmente)
            }
        }

        let tempoFalta = null;
        if (retorno) {
            const agora = new Date();
            const horaAtual = agora.toLocaleTimeString('en-GB', {
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
                            {/* MELHORIA-05: botão de refresh manual */}
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
                            <span>FERIADO: {infoFeriado.nome_feriado} — Os funcionários não têm expediente hoje.</span>
                        </div>
                    )}

                    {funcionariosPrincipais.length === 0 ? (
                        <div className="oa-empty-state">
                            <i className="fas fa-tshirt oa-empty-state-icon"></i>
                            <p className="oa-empty-state-titulo">Nenhum colaborador em atividade</p>
                            <p className="oa-empty-state-subtitulo">Aguardando início das atividades ou verifique as escalas</p>
                        </div>
                    ) : (
                        <div className="oa-painel-status-grid">
                            {funcionariosPrincipais.map(func => {
                                const etapasUnif = func.tarefa_atual?.etapas_unificadas;
                                const tppDaTarefa = (Array.isArray(etapasUnif) && etapasUnif.length >= 2)
                                    ? etapasUnif.reduce((s, e) => s + (temposPadraoProducao[`${func.tarefa_atual.produto_id}-${e.processo}`] || 0), 0) || null
                                    : temposPadraoProducao[`${func.tarefa_atual?.produto_id}-${func.tarefa_atual?.processo}`];
                                return (
                                    <OPStatusCard
                                        key={func.id}
                                        funcionario={func}
                                        tpp={tppDaTarefa}
                                        onAtribuirTarefa={handleAtribuirTarefa}
                                        onAcaoManual={handleAcaoManual}
                                        onFinalizarTarefa={handleFinalizarTarefa}
                                        onCancelarTarefa={handleCancelarTarefa}
                                        onExcecao={handleExcecao}
                                        onLiberarIntervalo={handleLiberarIntervalo}
                                        onLiberarParaTrabalho={handleLiberarParaTrabalho}
                                    />
                                );
                            })}
                        </div>
                    )}

                    {funcionariosInativos.length > 0 && (
                        <div className="oa-inativos-secao">
                            <div className="oa-inativos-titulo">Inativos</div>
                            <div className="oa-inativos-grid">
                                {funcionariosInativos.map(func => {
                                    const info = getInfoInativo(func);
                                    const primeiroNome = func.nome.split(' ')[0];
                                    return (
                                        <div key={func.id} className="oa-inativo-card">
                                            <div className="oa-inativo-card-topo">
                                                {/* Avatar miniatura */}
                                                {(() => {
                                                    const foto = (func.avatar_url && !func.avatar_url.includes('image.jfif')) ? func.avatar_url : func.foto_oficial;
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
                                                    {/* "Saída antecipada" só aparece em dias de trabalho, nunca em folga */}
                                                    {!info.eDiaFolga && func.status_atual === 'FORA_DO_HORARIO' && func.ponto_hoje?.horario_real_s3 && (
                                                        <span className="oa-inativo-retorno">Saída antecipada: <strong>{String(func.ponto_hoje.horario_real_s3).substring(0, 5)}</strong></span>
                                                    )}
                                                </div>
                                                <button
                                                    className="oa-inativo-btn-info"
                                                    onClick={() => setInativoInfoId(func.id)}
                                                    title="Ver jornada"
                                                >
                                                    <i className="fas fa-info-circle"></i>
                                                </button>
                                            </div>
                                            {/* BUG-11: saída antecipada ativa → Desfazer; FORA_DO_HORARIO → Hora Extra; outros → Liberar */}
                                            {func.status_atual === 'FORA_DO_HORARIO' && func.ponto_hoje?.horario_real_s3 && !func.ponto_hoje?.saida_desfeita ? (
                                                <button
                                                    className="oa-inativo-btn-desfazer"
                                                    onClick={() => handleDesfazerSaida(func.id)}
                                                    title="Desfazer saída antecipada"
                                                >
                                                    <i className="fas fa-undo"></i> Desfazer Saída
                                                </button>
                                            ) : func.status_atual === 'FORA_DO_HORARIO' ? (
                                                <UIBloqueio permissao="permite-estender-horario">
                                                    <button
                                                        className="oa-inativo-btn-hora-extra"
                                                        onClick={() => handleSolicitarHoraExtra(func)}
                                                        title="Atribuir tarefa em hora extra"
                                                    >
                                                        <i className="fas fa-clock"></i> Hora Extra
                                                    </button>
                                                </UIBloqueio>
                                            ) : (
                                                <button
                                                    className="oa-inativo-btn-liberar"
                                                    onClick={() => handleAcaoManual(func, 'LIVRE_MANUAL', `Liberar ${primeiroNome} para o trabalho?`)}
                                                    title="Liberar para o trabalho"
                                                >
                                                    <i className="fas fa-play"></i> Liberar
                                                </button>
                                            )}

                                            {/* Bottom sheet de jornada do inativo */}
                                            {inativoInfoId === func.id && ReactDOM.createPortal(
                                                <>
                                                    <div className="bs-overlay" onClick={() => setInativoInfoId(null)} />
                                                    <div className="bs-sheet">
                                                        <div className="bs-cabecalho">
                                                            {(() => {
                                                                const foto = (func.avatar_url && !func.avatar_url.includes('image.jfif')) ? func.avatar_url : func.foto_oficial;
                                                                return foto
                                                                    ? <div className="bs-avatar" style={{ backgroundImage: `url('${foto}')` }}></div>
                                                                    : <div className="bs-avatar bs-avatar-vazio"><i className="fas fa-user"></i></div>;
                                                            })()}
                                                            <div>
                                                                <div className="bs-nome">{func.nome}</div>
                                                                <div className="bs-role">Jornada de Trabalho</div>
                                                            </div>
                                                        </div>

                                                        <div className="bs-info-secao">
                                                            <div className="bs-info-label">Dias de trabalho</div>
                                                            <div className="bs-dias-chips">
                                                                {[['0','Dom'],['1','Seg'],['2','Ter'],['3','Qua'],['4','Qui'],['5','Sex'],['6','Sáb']].map(([d, l]) => {
                                                                    const ativo = (func.dias_trabalho || {'1':true,'2':true,'3':true,'4':true,'5':true})[d];
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
                                                                    <span className="bs-horario-valor">{fmtH(func.horario_entrada_1)}</span>
                                                                </div>
                                                                {func.horario_saida_1 && (
                                                                    <div className="bs-horario-linha bs-horario-intervalo">
                                                                        <span className="bs-horario-icone"><i className="fas fa-utensils"></i></span>
                                                                        <span className="bs-horario-desc">Almoço <span className="bs-horario-ref">(S1 → E2)</span></span>
                                                                        <span className="bs-horario-valor">{fmtH(func.horario_saida_1)} → {fmtH(func.horario_entrada_2)}</span>
                                                                    </div>
                                                                )}
                                                                {func.horario_saida_2 && (
                                                                    <div className="bs-horario-linha bs-horario-intervalo">
                                                                        <span className="bs-horario-icone"><i className="fas fa-coffee"></i></span>
                                                                        <span className="bs-horario-desc">Pausa <span className="bs-horario-ref">(S2 → E3)</span></span>
                                                                        <span className="bs-horario-valor">{fmtH(func.horario_saida_2)} → {fmtH(func.horario_entrada_3)}</span>
                                                                    </div>
                                                                )}
                                                                <div className="bs-horario-linha">
                                                                    <span className="bs-horario-icone"><i className="fas fa-sign-out-alt"></i></span>
                                                                    <span className="bs-horario-desc">Saída <span className="bs-horario-ref">(S3)</span></span>
                                                                    <span className="bs-horario-valor">{fmtH(func.horario_saida_3 || func.horario_saida_2 || func.horario_saida_1)}</span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Registros de hoje */}
                                                        {func.ponto_hoje && (func.ponto_hoje.horario_real_s1 || func.ponto_hoje.horario_real_s2 || func.ponto_hoje.horario_real_s3) && (
                                                            <div className="bs-info-secao">
                                                                <div className="bs-info-label">Registros de hoje</div>
                                                                <div className="bs-registros-hoje">
                                                                    {func.ponto_hoje.horario_real_s1 && (
                                                                        <div className="bs-registro-linha">
                                                                            <span className="bs-registro-icone"><i className="fas fa-utensils"></i></span>
                                                                            <span className="bs-registro-desc">Saída almoço</span>
                                                                            <span className="bs-registro-valor registrado">{fmtH(func.ponto_hoje.horario_real_s1)}</span>
                                                                        </div>
                                                                    )}
                                                                    {func.ponto_hoje.horario_real_e2 && (
                                                                        <div className="bs-registro-linha">
                                                                            <span className="bs-registro-icone"><i className="fas fa-utensils"></i></span>
                                                                            <span className="bs-registro-desc">Retorno almoço</span>
                                                                            <span className="bs-registro-valor registrado">{fmtH(func.ponto_hoje.horario_real_e2)}</span>
                                                                        </div>
                                                                    )}
                                                                    {func.ponto_hoje.horario_real_s2 && (
                                                                        <div className="bs-registro-linha">
                                                                            <span className="bs-registro-icone"><i className="fas fa-coffee"></i></span>
                                                                            <span className="bs-registro-desc">Saída pausa</span>
                                                                            <span className="bs-registro-valor registrado">{fmtH(func.ponto_hoje.horario_real_s2)}</span>
                                                                        </div>
                                                                    )}
                                                                    {func.ponto_hoje.horario_real_e3 && (
                                                                        <div className="bs-registro-linha">
                                                                            <span className="bs-registro-icone"><i className="fas fa-coffee"></i></span>
                                                                            <span className="bs-registro-desc">Retorno pausa</span>
                                                                            <span className="bs-registro-valor registrado">{fmtH(func.ponto_hoje.horario_real_e3)}</span>
                                                                        </div>
                                                                    )}
                                                                    {func.ponto_hoje.horario_real_s3 && (
                                                                        <div className={`bs-registro-linha${func.ponto_hoje.saida_desfeita ? ' desfeito' : ''}`}>
                                                                            <span className="bs-registro-icone"><i className="fas fa-sign-out-alt"></i></span>
                                                                            <span className="bs-registro-desc">
                                                                                Saída antecipada
                                                                                {func.ponto_hoje.saida_desfeita && (
                                                                                    <em className="bs-registro-desfeito"> — desfeita por {func.ponto_hoje.saida_desfeita_por || 'supervisor'}</em>
                                                                                )}
                                                                            </span>
                                                                            <span className="bs-registro-valor registrado">{fmtH(func.ponto_hoje.horario_real_s3)}</span>
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

            {/* v1.8 — POPUP DE ALERTA DE INTERVALO (almoço/pausa automático) */}
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
                        <button
                            className="oa-popup-intervalo-btn"
                            onClick={() => setAlertaIntervalo(null)}
                        >
                            Entendi
                        </button>
                    </div>
                </>,
                document.body
            )}

            {/* Popup de confirmação de saída/retorno de ponto */}
            {pontoPopup && (
                <OPPontoPopup
                    tipo={pontoPopup.tipo}
                    funcionario={pontoPopup.funcionario}
                    onConfirmar={pontoPopup.onConfirmar}
                    onCancelar={() => setPontoPopup(null)}
                />
            )}

            {/* v1.8 — POPUP DE "DESFAZER LIBERAÇÃO" com countdown */}
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

            <OPAtribuicaoModal
                isOpen={modalAberto}
                onClose={handleCloseModal}
                funcionario={funcionarioSelecionado}
                tpp={temposPadraoProducao}
            />

        </>
    );
}