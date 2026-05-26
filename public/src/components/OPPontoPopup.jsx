// public/src/components/OPPontoPopup.jsx
//
// Popup de confirmação para ações de controle de ponto (saídas e retornos).
// Exibe nome/foto do funcionário, horário programado vs. agora e badge de desvio.
//
// Tipos suportados:
//   'ALMOCO'         — Liberar para almoço (saída manual)
//   'PAUSA'          — Liberar para pausa  (saída manual)
//   'RETORNO_ALMOCO' — Registrar retorno do almoço
//   'RETORNO_PAUSA'  — Registrar retorno da pausa

import React, { useMemo } from 'react';
import ReactDOM from 'react-dom';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNowSP() {
    return new Date().toLocaleTimeString('en-GB', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function horarioParaMinutos(hhmm) {
    if (!hhmm) return null;
    const [h, m] = String(hhmm).substring(0, 5).split(':').map(Number);
    return h * 60 + m;
}

// desvioMin > 0 = depois do alvo (atrasado/após), < 0 = antes do alvo (antecipado)
function calcDesvioMin(horarioAlvo, agoraHHMM) {
    const alvoMin = horarioParaMinutos(horarioAlvo);
    const agoraMin = horarioParaMinutos(agoraHHMM);
    if (alvoMin === null || agoraMin === null) return null;
    return agoraMin - alvoMin;
}

// ---------------------------------------------------------------------------
// Configuração por tipo
// ---------------------------------------------------------------------------

const CFG = {
    ALMOCO: {
        cor: '#f97316',
        corFundo: '#fff7ed',
        label: 'Liberar para almoço',
        descricao: 'Saída manual pelo supervisor',
        btnConfirmar: 'Confirmar saída',
        icone: 'fa-utensils',
        ehSaida: true,
        labelProgramado: 'Horário programado',
    },
    PAUSA: {
        cor: '#f59e0b',
        corFundo: '#fffbeb',
        label: 'Liberar para pausa',
        descricao: 'Saída manual pelo supervisor',
        btnConfirmar: 'Confirmar saída',
        icone: 'fa-coffee',
        ehSaida: true,
        labelProgramado: 'Horário programado',
    },
    RETORNO_ALMOCO: {
        cor: '#22c55e',
        corFundo: '#f0fdf4',
        label: 'Retorno ao trabalho',
        descricao: 'Registrar retorno do almoço',
        btnConfirmar: 'Confirmar retorno',
        icone: 'fa-play',
        ehSaida: false,
        labelProgramado: 'Retorno previsto',
    },
    RETORNO_PAUSA: {
        cor: '#22c55e',
        corFundo: '#f0fdf4',
        label: 'Retorno ao trabalho',
        descricao: 'Registrar retorno da pausa',
        btnConfirmar: 'Confirmar retorno',
        icone: 'fa-play',
        ehSaida: false,
        labelProgramado: 'Retorno previsto',
    },
};

// ---------------------------------------------------------------------------
// Badge de desvio
// ---------------------------------------------------------------------------

function calcBadge(desvioMin, ehSaida) {
    if (desvioMin === null) return null;
    const abs = Math.abs(desvioMin);

    if (ehSaida) {
        // Saída: desvio < 0 = antecipado (bom/aviso), desvio >= 0 = no horário ou após
        if (desvioMin < 0) return {
            texto: `${abs} min antes do horário`,
            cor: '#c2410c', fundo: '#fff7ed', icone: 'fa-clock',
        };
        return {
            texto: desvioMin === 0 ? 'Exatamente no horário' : `${abs} min após o horário`,
            cor: '#166534', fundo: '#f0fdf4', icone: 'fa-check-circle',
        };
    } else {
        // Retorno: desvio > 1 = atrasado (ruim), desvio <= 1 = no horário ou adiantado
        if (desvioMin > 1) return {
            texto: `${abs} min de atraso no retorno`,
            cor: '#b91c1c', fundo: '#fef2f2', icone: 'fa-triangle-exclamation',
        };
        if (desvioMin < -1) return {
            texto: `${abs} min adiantado`,
            cor: '#166534', fundo: '#f0fdf4', icone: 'fa-check-circle',
        };
        return {
            texto: 'Retorno no horário',
            cor: '#166534', fundo: '#f0fdf4', icone: 'fa-check-circle',
        };
    }
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/**
 * @param {'ALMOCO'|'PAUSA'|'RETORNO_ALMOCO'|'RETORNO_PAUSA'} tipo
 * @param {object}   funcionario  — objeto completo do funcionário (com horários e ponto_hoje)
 * @param {Function} onConfirmar  — chamado quando o supervisor confirma
 * @param {Function} onCancelar   — chamado quando cancela ou clica fora
 */
export default function OPPontoPopup({ tipo, funcionario, onConfirmar, onCancelar }) {
    const agora = getNowSP();
    const cfg = CFG[tipo] || CFG.ALMOCO;
    const n = (t) => t ? String(t).substring(0, 5) : null;

    // Horário de referência (programado para saída, previsto para retorno)
    const horarioAlvo = useMemo(() => {
        if (tipo === 'ALMOCO')         return n(funcionario.horario_saida_1);
        if (tipo === 'PAUSA')          return n(funcionario.horario_saida_2);
        if (tipo === 'RETORNO_ALMOCO') return n(funcionario.ponto_hoje?.horario_real_e2) || n(funcionario.horario_entrada_2);
        if (tipo === 'RETORNO_PAUSA')  return n(funcionario.ponto_hoje?.horario_real_e3) || n(funcionario.horario_entrada_3);
        return null;
    }, [tipo, funcionario]);

    const desvioMin = useMemo(() => calcDesvioMin(horarioAlvo, agora), [horarioAlvo, agora]);
    const badge = useMemo(() => calcBadge(desvioMin, cfg.ehSaida), [desvioMin, cfg.ehSaida]);

    // Avatar: foto > iniciais coloridas
    const iniciais = funcionario.nome.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
    const fotoUrl = (funcionario.avatar_url && !funcionario.avatar_url.includes('image.jfif'))
        ? funcionario.avatar_url
        : funcionario.foto_oficial || null;

    const tipoLabel = funcionario.tipos?.includes('tiktik')   ? 'TikTik'
        : funcionario.tipos?.includes('cortador') ? 'Cortador'
        : 'Costureira';

    // ---------------------------------------------------------------------------
    // Estilos inline (sem CSS externo — popup é portado para document.body)
    // ---------------------------------------------------------------------------

    const s = {
        overlay: {
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
            animation: 'fadeIn 0.15s ease',
        },
        card: {
            background: 'var(--gs-branco)',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '380px',
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            animation: 'slideUp 0.2s ease',
        },
        accentBar: { height: '5px', background: cfg.cor },
        body: { padding: '20px' },
        empRow: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' },
        avatarImg: { width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 },
        avatarLetra: {
            width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
            background: cfg.corFundo, color: cfg.cor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '15px',
        },
        nome: { margin: 0, fontWeight: 700, fontSize: '15px', color: 'var(--gs-texto-principal)' },
        cargo: { margin: 0, fontSize: '12px', color: 'var(--gs-texto-secundario)' },
        divider: { height: '1px', background: 'var(--gs-borda)', margin: '0 0 14px' },
        acaoRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' },
        acaoIcone: {
            width: 36, height: 36, borderRadius: '10px', flexShrink: 0,
            background: cfg.corFundo, color: cfg.cor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
        acaoLabel: { margin: 0, fontWeight: 600, fontSize: '14px', color: 'var(--gs-texto-principal)' },
        acaoDesc: { margin: 0, fontSize: '12px', color: 'var(--gs-texto-secundario)' },
        horarioRow: { display: 'flex', gap: '8px', marginBottom: '14px' },
        horarioBloco: {
            flex: 1, background: 'var(--gs-fundo-input)',
            borderRadius: '10px', padding: '10px 12px',
        },
        horarioLbl: { margin: '0 0 2px', fontSize: '11px', color: 'var(--gs-texto-secundario)' },
        horarioVal: { margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--gs-texto-principal)' },
        btns: { display: 'flex', gap: '8px' },
        btnCancelar: {
            flex: 1, padding: '11px', borderRadius: '10px', cursor: 'pointer',
            border: '1px solid var(--gs-borda)',
            background: 'var(--gs-fundo-input)', color: 'var(--gs-texto-secundario)',
            fontSize: '14px', fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
        },
        btnConfirmar: {
            flex: 1, padding: '11px', borderRadius: '10px', cursor: 'pointer',
            border: 'none', background: cfg.cor, color: '#fff',
            fontSize: '14px', fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
        },
    };

    const popup = (
        <>
            <style>{`
                @keyframes op-ponto-fadeIn  { from { opacity:0 } to { opacity:1 } }
                @keyframes op-ponto-slideUp { from { transform:translateY(16px); opacity:0 } to { transform:translateY(0); opacity:1 } }
                .op-ponto-overlay { animation: op-ponto-fadeIn  0.15s ease; }
                .op-ponto-card    { animation: op-ponto-slideUp 0.2s ease;  }
            `}</style>
            <div className="op-ponto-overlay" style={s.overlay} onClick={onCancelar}>
                <div className="op-ponto-card" style={s.card} onClick={e => e.stopPropagation()}>

                    {/* Barra de cor */}
                    <div style={s.accentBar} />

                    <div style={s.body}>
                        {/* Funcionário */}
                        <div style={s.empRow}>
                            {fotoUrl
                                ? <img src={fotoUrl} alt={funcionario.nome} style={s.avatarImg} />
                                : <div style={s.avatarLetra}>{iniciais}</div>
                            }
                            <div>
                                <p style={s.nome}>{funcionario.nome}</p>
                                <p style={s.cargo}>{tipoLabel}</p>
                            </div>
                        </div>

                        <div style={s.divider} />

                        {/* Ação */}
                        <div style={s.acaoRow}>
                            <div style={s.acaoIcone}>
                                <i className={`fas ${cfg.icone}`} style={{ fontSize: '16px' }} />
                            </div>
                            <div>
                                <p style={s.acaoLabel}>{cfg.label}</p>
                                <p style={s.acaoDesc}>{cfg.descricao}</p>
                            </div>
                        </div>

                        {/* Horários */}
                        {horarioAlvo && (
                            <div style={s.horarioRow}>
                                <div style={s.horarioBloco}>
                                    <p style={s.horarioLbl}>{cfg.labelProgramado}</p>
                                    <p style={s.horarioVal}>{horarioAlvo}</p>
                                </div>
                                <div style={s.horarioBloco}>
                                    <p style={s.horarioLbl}>Agora</p>
                                    <p style={s.horarioVal}>{agora}</p>
                                </div>
                            </div>
                        )}

                        {/* Badge de desvio */}
                        {badge && (
                            <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: '5px',
                                fontSize: '12px', fontWeight: 600, borderRadius: '8px',
                                padding: '5px 10px', marginBottom: '16px',
                                background: badge.fundo, color: badge.cor,
                            }}>
                                <i className={`fas ${badge.icone}`} style={{ fontSize: '12px' }} />
                                {badge.texto}
                            </div>
                        )}

                        {/* Botões */}
                        <div style={s.btns}>
                            <button style={s.btnCancelar} onClick={onCancelar}>
                                <i className="fas fa-times" /> Cancelar
                            </button>
                            <button style={s.btnConfirmar} onClick={onConfirmar}>
                                <i className="fas fa-check" /> {cfg.btnConfirmar}
                            </button>
                        </div>
                    </div>

                </div>
            </div>
        </>
    );

    return ReactDOM.createPortal(popup, document.body);
}
