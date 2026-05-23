// public/src/components/BotaoBuscaPipelineProducao.jsx

import React from 'react';
import { mostrarConfirmacao } from '/js/utils/popups.js';
import { calcularStatusDemanda, STATUS_META } from '/src/utils/demandaStatus.js';
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio.js';

export default function PainelDemandaCard({ item, onDelete, permissoes, onRefresh, onIniciarProducao }) {
    const totalPedido  = item.demanda_total              || 0;
    const emProducao   = item.saldo_em_producao          || 0;
    const emArremate   = item.saldo_disponivel_arremate  || 0;
    const emEmbalagem  = item.saldo_disponivel_embalagem || 0;
    const emEstoque    = item.saldo_disponivel_estoque   || 0;
    const emPerda      = item.saldo_perda                || 0;

    const totalConsumido = emProducao + emArremate + emEmbalagem + emEstoque + emPerda;
    const pendenteFila   = Math.max(0, totalPedido - totalConsumido);

    const pct = (v) => totalPedido > 0 ? Math.min(100, (v / totalPedido) * 100) : 0;

    const statusCalculado = calcularStatusDemanda(item);
    const meta            = STATUS_META[statusCalculado] || STATUS_META.AGUARDANDO;
    const eUrgente        = parseInt(item.prioridade) === 1;

    // ── Dados de corte ──
    const corteCortado   = item.corte_cortado   || 0;
    const cortePendente  = item.corte_pendente  || 0;
    const corteVinculado = item.corte_vinculado || 0; // cortes em estoque com demanda_id = esta demanda
    const corteTotal     = corteCortado + cortePendente;

    // Badge visível apenas na aba AGUARDANDO — corte já pressuposto nas demais fases
    const mostrarBadgeCorte = statusCalculado === 'AGUARDANDO' && corteTotal > 0;

    // Classifica o estado do corte para colorização do badge
    // 'vinculado' = prioridade máxima: há corte em estoque "reservado" para ESTA demanda
    const classeCorte = (() => {
        if (corteTotal === 0)             return null;
        if (corteVinculado >= totalPedido) return 'vinculado'; // azul — corte guardado p/ esta demanda
        if (corteCortado >= totalPedido)  return 'completo';   // verde — tudo cortado e pronto
        if (corteCortado > 0)             return 'parcial';    // laranja — parcialmente cortado
        return 'pendente';                                      // amarelo — registrado, aguardando corte
    })();

    // Texto do badge de corte
    const textoBadgeCorte = (() => {
        if (classeCorte === 'vinculado') return 'Corte pronto — gerar OP!';
        if (classeCorte === 'completo') {
            return corteCortado === 1 ? '1 pc Cortada' : `${corteCortado} pcs Cortadas`;
        }
        const faltam = totalPedido - corteCortado;
        return faltam === 1 ? 'Falta 1 pc no Corte' : `Faltam ${faltam} pcs no Corte`;
    })();

    const nomeVariante = (item.variante && item.variante !== '-') ? item.variante : '';
    const tituloLimpo  = nomeVariante
        ? (item.produto_nome || '').replace(`(${nomeVariante})`, '').replace('()', '').trim()
        : (item.produto_nome || '');

    const dataFormatada = item.data_solicitacao
        ? new Date(item.data_solicitacao).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        : null;

    const podeDeletar = temPermissao('deletar-demanda');

    const handleDeleteClick = async (e) => {
        e.stopPropagation();
        if (!podeDeletar) {
            mostrarPopupSemPermissao('Você não tem permissão para deletar demandas.');
            return;
        }
        const ok = await mostrarConfirmacao(
            `Apagar demanda de "${tituloLimpo}"?`,
            { tipo: 'perigo', textoConfirmar: 'Apagar', textoCancelar: 'Cancelar' }
        );
        if (ok && onDelete) onDelete(item.demanda_id);
    };

    const handleCriarOP = (e) => {
        e.stopPropagation();
        if (onIniciarProducao) {
            onIniciarProducao({
                produto_id: item.produto_id,
                variante: item.variante === '-' ? null : item.variante,
                quantidade: pendenteFila,
                demanda_id: item.demanda_id,
            });
        } else {
            const params = new URLSearchParams({
                demanda_id: item.demanda_id,
                produto_id: item.produto_id,
                quantidade: pendenteFila,
                auto_abrir: 'true',
            });
            if (item.variante && item.variante !== '-') params.set('variante', item.variante);
            window.location.href = `/admin/ordens-de-producao.html?${params.toString()}`;
        }
    };

    const handleIrArremate = (e) => {
        e.stopPropagation();
        const params = new URLSearchParams({ produto_id: item.produto_id });
        if (item.variante && item.variante !== '-') params.set('variante', item.variante);
        window.location.href = `/admin/arremates.html?${params.toString()}`;
    };

    const handleIrEmbalagem = (e) => {
        e.stopPropagation();
        const params = new URLSearchParams({ produto_id: item.produto_id });
        if (item.variante && item.variante !== '-') params.set('variante', item.variante);
        window.location.href = `/admin/embalagem-de-produtos.html?${params.toString()}`;
    };

    const renderCTA = () => {
        if (statusCalculado === 'AGUARDANDO' && pendenteFila > 0) {
            return (
                <button className="pd-cta criar-op" onClick={handleCriarOP}>
                    <i className="fas fa-cut"></i>
                    Criar OP
                </button>
            );
        }
        if (statusCalculado === 'ARREMATE') {
            return (
                <button className="pd-cta arremate" onClick={handleIrArremate}>
                    <i className="fas fa-clipboard-check"></i>
                    Arremate
                </button>
            );
        }
        if (statusCalculado === 'EMBALAGEM') {
            return (
                <button className="pd-cta embalagem" onClick={handleIrEmbalagem}>
                    <i className="fas fa-box-open"></i>
                    Embalar
                </button>
            );
        }
        if (statusCalculado === 'COSTURA') {
            return (
                <span className="pd-status-badge costura">
                    <i className="fas fa-cut"></i>
                    Em costura
                </span>
            );
        }
        return null;
    };

    return (
        <div className={`pd-card${eUrgente ? ' urgente' : ''}`}>
            <div
                className="card-borda-charme"
                style={!eUrgente ? { backgroundColor: meta.cor } : {}}
            />

            <button
                className="pd-card-del"
                onClick={handleDeleteClick}
                title={podeDeletar ? 'Apagar demanda' : 'Sem permissão para apagar demanda'}
            >
                {podeDeletar ? (
                    <i className="fas fa-trash"></i>
                ) : (
                    <span className="gs-bloqueio-icone-duplo">
                        <i className="fas fa-trash"></i>
                        <i className="fas fa-lock"></i>
                    </span>
                )}
            </button>

            <div className="pd-card-topo">
                <img
                    src={item.imagem || '/img/placeholder-image.png'}
                    className="pd-card-img"
                    alt={tituloLimpo}
                />
                <div className="pd-card-info">
                    {eUrgente && (
                        <span className="pd-urgente-pill">
                            <i className="fas fa-star"></i> Urgente
                        </span>
                    )}
                    <span className="pd-card-nome">{tituloLimpo}</span>
                    {nomeVariante && <span className="pd-card-variante">{nomeVariante}</span>}
                    {dataFormatada && (
                        <span className="pd-card-meta">
                            <i className="fas fa-calendar-alt"></i>{dataFormatada}
                        </span>
                    )}
                </div>
            </div>

            <div className="pd-card-bar">
                <div className="seg-estoque"   style={{ width: `${pct(emEstoque)}%` }} />
                <div className="seg-embalagem" style={{ width: `${pct(emEmbalagem)}%` }} />
                <div className="seg-arremate"  style={{ width: `${pct(emArremate)}%` }} />
                <div className="seg-producao"  style={{ width: `${pct(emProducao)}%` }} />
                <div className="seg-perda"     style={{ width: `${pct(emPerda)}%` }} />
            </div>

            <div className="pd-card-rodape" onClick={e => e.stopPropagation()}>
                {/* Bloco de quantidade: distingue o que o gerente pediu do que foi produzido */}
                <div className="pd-card-qtd">
                    <div className="pd-card-qtd-bloco pedido" title="Quantidade solicitada pelo gerente">
                        <span className="pd-card-qtd-num">{totalPedido}</span>
                        <span className="pd-card-qtd-label">pedidas</span>
                    </div>
                    {totalConsumido > 0 && (
                        <>
                            <span className="pd-card-qtd-sep">·</span>
                            <div
                                className={`pd-card-qtd-bloco producao${totalConsumido > totalPedido ? ' excedente' : ''}`}
                                title={totalConsumido > totalPedido
                                    ? `${totalConsumido} peças em produção — ${totalConsumido - totalPedido} acima do pedido`
                                    : `${totalConsumido} peças no pipeline`}
                            >
                                <span className="pd-card-qtd-num">{totalConsumido}</span>
                                <span className="pd-card-qtd-label">
                                    {totalConsumido > totalPedido
                                        ? `prod. (+${totalConsumido - totalPedido})`
                                        : 'prod.'}
                                </span>
                            </div>
                        </>
                    )}
                </div>
                {mostrarBadgeCorte && (
                    <span className={`pd-corte-badge pd-corte-badge--${classeCorte}`}>
                        <i className="fas fa-ruler"></i>
                        {textoBadgeCorte}
                    </span>
                )}
                {renderCTA()}
            </div>
        </div>
    );
}
