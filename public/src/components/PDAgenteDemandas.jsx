// public/src/components/PDAgenteDemandas.jsx
// Agente vivo do Painel de Demandas.
// Layout idêntico ao OPCortesAgente idle card:
//   [avatar + anel + scanline] [wave] [texto typewriter] [botão]
//
// Props:
//   diagnostico         — { tipo: 'ok'|'atencao'|'urgente' }
//   contagensPorEstagio — { AGUARDANDO, COSTURA, ARREMATE, EMBALAGEM }
//   totalUrgentes       — n° de demandas prioridade=1 em AGUARDANDO
//   nomeUsuario         — primeiro nome do usuário logado (string | null)
//   onRefresh           — callback p/ reload parcial (estado laranja)
//   onFiltrarUrgentes   — callback p/ filtrar urgentes sem reload (estado vermelho)
//   carregando          — boolean enquanto o pai busca dados

import React, { useMemo } from 'react';
import UIAgenteIA from './UIAgenteIA';
import useTypewriter from '../hooks/useTypewriter.js';

// ── Substitui {nome} nas frases ───────────────────────────────────────────────

function sub(frase, nome) {
    if (!nome) {
        return frase
            .replace(/\{nome\},\s*/g, '')
            .replace(/,\s*\{nome\}/g, '')
            .replace(/\{nome\}\s*/g, '');
    }
    return frase.replace(/\{nome\}/g, nome);
}

// ── Frases por estado ──────────────────────────────────────────────────────────

function construirFrasesOk(nome) {
    return [
        sub('Pipeline limpo, {nome}. Nenhuma demanda aguardando início.', nome),
        sub('Tudo em ordem — sem pendências no momento.', nome),
        sub('{nome}, está tudo fluindo bem. Continuo monitorando.', nome),
        sub('Nenhuma ação necessária agora. O pipeline está limpo.', nome),
    ];
}

function construirFrasesAtencao(contagensPorEstagio, nome) {
    const ag   = contagensPorEstagio.AGUARDANDO || 0;
    const cost = contagensPorEstagio.COSTURA    || 0;
    const arr  = contagensPorEstagio.ARREMATE   || 0;
    const frases = [];

    if (ag > 0 && cost > 0) {
        frases.push(sub(
            `{nome}, pipeline ativo: ${ag} aguardando, ${cost} em costura.`,
            nome,
        ));
    }
    if (ag > 0) {
        frases.push(sub(
            `{nome}, ${ag} demanda${ag > 1 ? 's' : ''} aguardando início. Quer analisar prioridades?`,
            nome,
        ));
        frases.push(sub(
            `Há ${ag} item${ag > 1 ? 'ns' : ''} parado${ag > 1 ? 's' : ''} no pipeline, {nome}. Posso ajudar a priorizar.`,
            nome,
        ));
    }
    if (cost > 0) {
        frases.push(sub(
            `${cost} demanda${cost > 1 ? 's' : ''} em costura. Estou acompanhando o andamento.`,
            nome,
        ));
    }
    if (arr > 0) {
        frases.push(sub(
            `${arr} demanda${arr > 1 ? 's' : ''} prontas para arremate, {nome}.`,
            nome,
        ));
    }
    if (frases.length === 0) {
        frases.push(sub('Pipeline em andamento, {nome}. Monitorando os estágios.', nome));
    }
    return frases;
}

function construirFrasesUrgente(totalUrgentes, nome) {
    const n = totalUrgentes || 1;
    return [
        sub(
            `{nome}, atenção! ${n} demanda${n > 1 ? 's' : ''} prioritária${n > 1 ? 's' : ''} exige${n > 1 ? 'm' : ''} ação imediata.`,
            nome,
        ),
        sub(
            `Prioridade máxima detectada, {nome}. Não posso ignorar isso.`,
            nome,
        ),
        sub(
            `${n} item${n > 1 ? 'ns' : ''} urgente${n > 1 ? 's' : ''} parado${n > 1 ? 's' : ''} no pipeline. Aja agora, {nome}.`,
            nome,
        ),
        sub(
            `Alerta! ${n} demanda${n > 1 ? 's' : ''} urgente${n > 1 ? 's' : ''} sem início de produção.`,
            nome,
        ),
    ];
}

// ── Componente ─────────────────────────────────────────────────────────────────

export default function PDAgenteDemandas({
    diagnostico,
    contagensPorEstagio,
    totalUrgentes,
    nomeUsuario,
    onRefresh,
    onFiltrarUrgentes,
    carregando,
}) {
    const tipo = diagnostico?.tipo || 'ok'; // 'ok' | 'atencao' | 'urgente'

    const classeEstado =
        tipo === 'urgente' ? ' alerta'  :
        tipo === 'atencao' ? ' parcial' : '';

    // Frases embaralhadas por estado — começa de índice aleatório.
    // loop=false → digita a frase escolhida e fica com cursor piscando (não cicla).
    const frases = useMemo(() => {
        let base;
        if (tipo === 'urgente') base = construirFrasesUrgente(totalUrgentes, nomeUsuario);
        else if (tipo === 'atencao') base = construirFrasesAtencao(contagensPorEstagio || {}, nomeUsuario);
        else base = construirFrasesOk(nomeUsuario);

        const inicio = Math.floor(Math.random() * base.length);
        return [...base.slice(inicio), ...base.slice(0, inicio)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tipo, totalUrgentes, nomeUsuario]);
    // contagensPorEstagio intencionalmente fora das deps — só recalcula quando `tipo` muda

    // 42ms/char — ritmo deliberado; loop=false → agent fala uma vez e espera
    const { texto, fase, completo } = useTypewriter(frases, 42, 0, false);

    const mostrarBotao = tipo !== 'ok';

    const handleBotao = () => {
        if (carregando) return;
        if (tipo === 'urgente') {
            if (onFiltrarUrgentes) onFiltrarUrgentes();
        } else {
            if (onRefresh) onRefresh();
        }
    };

    const iconeBotao = carregando ? 'fa-circle-notch fa-spin'
                     : tipo === 'urgente' ? 'fa-bolt' : 'fa-search';
    const textoBotao = tipo === 'urgente' ? 'Ver demandas urgentes' : 'Analisar prioridades';

    return (
        <div className="pd-agente-bloco">
            <div className={`pd-agente-idle-card${classeEstado}`}>

                {/* Coluna esquerda: avatar + anel giratório + scanline */}
                <div className="pd-agente-avatar-wrapper">
                    <UIAgenteIA tamanho="lg" scanning={false} />
                </div>

                {/* Wave de voz */}
                <div className={`pd-agente-waveform${completo && tipo === 'ok' ? ' pausado' : ''}`}>
                    <span /><span /><span /><span /><span />
                </div>

                {/* Texto typewriter — flex: 1 */}
                <div className="pd-agente-idle-pensamento">
                    <span className={`pd-agente-idle-texto${fase === 'fading' ? ' fading' : ''}`}>
                        {texto}
                        {(fase === 'typing' || completo) && (
                            <span className="pd-agente-idle-cursor">▌</span>
                        )}
                    </span>
                </div>

                {/* Botão de ação — só laranja e vermelho */}
                {mostrarBotao && (
                    <button
                        className="pd-agente-idle-btn"
                        onClick={handleBotao}
                        disabled={carregando}
                    >
                        <i className={`fas ${iconeBotao}`}></i>
                        {textoBotao}
                    </button>
                )}
            </div>
        </div>
    );
}
