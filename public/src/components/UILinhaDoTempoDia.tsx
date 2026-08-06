// public/src/components/UILinhaDoTempoDia.tsx
//
// Componente compartilhado: Linha do Tempo do Dia.
// Extraído de OPStatusCard.jsx para uso em OPStatusCard e ArremateStatusCard.
//
// Props:
//   funcionario — objeto com horário_entrada_1/saida_1/entrada_2/saida_2/entrada_3/saida_3
//                 e sessoes_hoje: [{ inicio: 'HH:MM', fim: 'HH:MM'|null, op_numero }]
//   pontoHoje   — objeto ponto_diario com horario_real_s1/e2/s2/e3/s3 e saida_desfeita

import { useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

export interface UILinhaSessaoHoje {
    inicio?: string | null;
    fim?: string | null;
    op_numero?: string | number | null;
}

export interface UILinhaFuncionario {
    horario_entrada_1?: string | null;
    horario_saida_1?: string | null;
    horario_entrada_2?: string | null;
    horario_saida_2?: string | null;
    horario_entrada_3?: string | null;
    horario_saida_3?: string | null;
    sessoes_hoje?: UILinhaSessaoHoje[];
}

export interface UILinhaPontoHoje {
    horario_real_s1?: string | null;
    horario_real_e2?: string | null;
    horario_real_s2?: string | null;
    horario_real_e3?: string | null;
    horario_real_s3?: string | null;
    tipo_excecao?: string | null;
    saida_desfeita?: boolean | null;
}

interface UILinhaDoTempoDiaProps {
    funcionario: UILinhaFuncionario;
    pontoHoje?: UILinhaPontoHoje | null;
}

interface SegmentoTimeline {
    left: string;
    width: string;
    background: string;
    title: string;
}

// ── Linha "Agora" (marcador vertical vermelho) ───────────────────────────────
function LinhaAgora({ e1Min, totalMin }: { e1Min: number; totalMin: number }) {
    const agora = new Date().toLocaleTimeString('en-GB', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    });
    const [h, m] = agora.split(':').map(Number);
    const left = ((h * 60 + m - e1Min) / totalMin) * 100;
    if (left < 0 || left > 100) return null;
    return <div className="bs-timeline-agora" style={{ left: `${left}%` }} title={`Agora: ${agora}`} />;
}

// ── Modal de legenda da linha do tempo ───────────────────────────────────────
function ModalInfoTimeline({ onClose }: { onClose: () => void }) {
    return createPortal(
        <>
            <div className="bs-overlay" onClick={onClose} />
            <div className="bs-sheet bs-sheet-info-tl" onClick={(e) => e.stopPropagation()}>
                <div className="bs-sheet-info-tl-header">
                    <span><i className="fas fa-chart-bar"></i> Linha do Tempo do Dia</span>
                    <button type="button" className="bs-sheet-info-tl-fechar" onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>
                <div className="bs-sheet-info-tl-corpo">
                    <p className="bs-tl-info-intro">
                        Gráfico visual de tudo que aconteceu na jornada de hoje, do horário de entrada até a saída prevista.
                    </p>
                    <div className="bs-tl-info-legenda-detalhada">
                        <div className="bs-tl-info-item">
                            <span className="bs-tl-dot" style={{ background: '#2980b9', borderRadius: '3px' }}></span>
                            <div>
                                <strong>Produzindo</strong>
                                <span>Período em que havia uma tarefa ativa sendo executada. Cada bloco = uma sessão de trabalho registrada pelo sistema.</span>
                            </div>
                        </div>
                        <div className="bs-tl-info-item">
                            <span className="bs-tl-dot" style={{ background: '#e67e22', borderRadius: '3px' }}></span>
                            <div>
                                <strong>Almoço</strong>
                                <span>Intervalo de almoço, detectado automaticamente ao finalizar a tarefa próxima ao horário de almoço cadastrado.</span>
                            </div>
                        </div>
                        <div className="bs-tl-info-item">
                            <span className="bs-tl-dot" style={{ background: '#f39c12', borderRadius: '3px' }}></span>
                            <div>
                                <strong>Pausa / Café</strong>
                                <span>Intervalo da tarde, detectado da mesma forma que o almoço.</span>
                            </div>
                        </div>
                        <div className="bs-tl-info-item">
                            <span className="bs-tl-dot" style={{ background: '#e74c3c', borderRadius: '3px' }}></span>
                            <div>
                                <strong>Saída antecipada</strong>
                                <span>Trecho após a saída registrada antecipadamente — representa o tempo de jornada que não foi trabalhado.</span>
                            </div>
                        </div>
                        <div className="bs-tl-info-item">
                            <span className="bs-tl-dot" style={{ background: '#dfe6e9', borderRadius: '3px', border: '1px solid #bdc3c7' }}></span>
                            <div>
                                <strong>Tempo livre</strong>
                                <span>A funcionária estava disponível mas sem tarefa atribuída — inclui o tempo entre o retorno do intervalo e a próxima tarefa.</span>
                            </div>
                        </div>
                    </div>
                    <p className="bs-tl-info-nota">
                        <i className="fas fa-grip-lines-vertical" style={{ color: '#e74c3c' }}></i>
                        A linha vermelha vertical indica o horário atual. Toque em cada bloco colorido para ver o detalhe daquele período.
                    </p>
                </div>
            </div>
        </>,
        document.body,
    );
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function UILinhaDoTempoDia({ funcionario, pontoHoje }: UILinhaDoTempoDiaProps) {
    const [infoAberto, setInfoAberto] = useState(false);
    const n = (t: string | null | undefined): string | null => (t ? String(t).substring(0, 5) : null);
    const e1 = n(funcionario.horario_entrada_1) || '07:00';
    const s3 = n(funcionario.horario_saida_3 || funcionario.horario_saida_2 || funcionario.horario_saida_1) || '17:00';

    const toMin = (hhmm: string | null | undefined): number | null => {
        if (!hhmm) return null;
        const [h, m] = hhmm.split(':').map(Number);
        return h * 60 + m;
    };

    const inicioMin = toMin(e1);
    const fimMin = toMin(s3);
    if (inicioMin == null || fimMin == null) return null;
    const totalMin = fimMin - inicioMin;
    if (totalMin <= 0) return null;

    const segmento = (
        inicioHHMM: string | null | undefined,
        fimHHMM: string | null | undefined,
        cor: string,
        titulo: string,
    ): SegmentoTimeline | null => {
        const si = toMin(inicioHHMM);
        const sf = toMin(fimHHMM);
        if (si === null || sf === null || sf <= si) return null;
        const left = ((si - inicioMin) / totalMin) * 100;
        const width = ((sf - si) / totalMin) * 100;
        if (width <= 0) return null;
        return { left: `${left.toFixed(2)}%`, width: `${width.toFixed(2)}%`, background: cor, title: titulo };
    };

    const segmentos: SegmentoTimeline[] = [];

    const agoraSP = new Date().toLocaleTimeString('en-GB', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    });
    (funcionario.sessoes_hoje || []).forEach((s) => {
        const ini = n(s.inicio);
        const fim = n(s.fim) || agoraSP;
        if (ini) {
            const seg = segmento(ini, fim, '#2980b9', `Produzindo — OP ${s.op_numero || ''}`);
            if (seg) segmentos.push(seg);
        }
    });

    const s1 = n(pontoHoje?.horario_real_s1) || n(funcionario.horario_saida_1);
    const e2 = n(pontoHoje?.horario_real_e2) || n(funcionario.horario_entrada_2);
    if (s1 && e2) {
        const seg = segmento(s1, e2, '#e67e22', 'Almoço');
        if (seg) segmentos.push(seg);
    }

    const s2 = n(pontoHoje?.horario_real_s2) || n(funcionario.horario_saida_2);
    const e3 = n(pontoHoje?.horario_real_e3) || n(funcionario.horario_entrada_3);
    if (s2 && e3) {
        const seg = segmento(s2, e3, '#f39c12', 'Pausa');
        if (seg) segmentos.push(seg);
    }

    if (pontoHoje?.tipo_excecao === 'SAIDA_ANTECIPADA' && pontoHoje?.horario_real_s3 && !pontoHoje?.saida_desfeita) {
        const seg = segmento(n(pontoHoje.horario_real_s3), s3, '#e74c3c', 'Saída antecipada');
        if (seg) segmentos.push(seg);
    }

    return (
        <div className="bs-timeline-container">
            {infoAberto && <ModalInfoTimeline onClose={() => setInfoAberto(false)} />}

            <div className="bs-timeline-header">
                <span className="bs-timeline-titulo">
                    <i className="fas fa-chart-bar"></i> Linha do Tempo do Dia
                </span>
                <button
                    type="button"
                    className="bs-timeline-info-btn"
                    onClick={() => setInfoAberto(true)}
                    title="O que é isso?"
                >
                    <i className="fas fa-info-circle"></i>
                </button>
            </div>

            <div className="bs-timeline-labels">
                <span>{e1}</span>
                <span>{s3}</span>
            </div>
            <div className="bs-timeline-barra">
                <div className="bs-timeline-fundo" />
                {segmentos.map((seg, i) => {
                    const style: CSSProperties = {
                        left: seg.left,
                        width: seg.width,
                        background: seg.background,
                    };
                    return (
                        <div key={i} className="bs-timeline-segmento" style={style} title={seg.title} />
                    );
                })}
                <LinhaAgora e1Min={inicioMin} totalMin={totalMin} />
            </div>
            <div className="bs-timeline-legenda">
                <span><span className="bs-tl-dot" style={{ background: '#2980b9' }}></span>Produzindo</span>
                <span><span className="bs-tl-dot" style={{ background: '#e67e22' }}></span>Almoço</span>
                <span><span className="bs-tl-dot" style={{ background: '#f39c12' }}></span>Pausa</span>
            </div>
        </div>
    );
}
