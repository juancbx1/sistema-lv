// public/src/pages/ConfigAlertas/AlertaCard.tsx

import { useState, useEffect, type ChangeEvent } from 'react';
import type { AlertaConfig, AlertaConfigCampo, TipoAlerta } from '../../utils/alertas-types';

interface NivelInfo {
    label: string;
    cor: string;
}

// Nível de cada tipo de alerta — define a pill colorida no header do card
const NIVEL_POR_TIPO: Record<string, NivelInfo> = {
    // Produção — Arremate (tiktik)
    OCIOSIDADE_ARREMATE:       { label: 'CRÍTICO', cor: '#e74c3c' },
    LENTIDAO_CRITICA_ARREMATE: { label: 'AVISO',   cor: '#e67e22' },
    META_BATIDA_ARREMATE:      { label: 'INFO',     cor: '#27ae60' },
    // Produção — Costura (costureira)
    OCIOSIDADE_COSTUREIRA:     { label: 'CRÍTICO',  cor: '#e74c3c' },
    LENTIDAO_COSTUREIRA:       { label: 'AVISO',    cor: '#e67e22' },
    // Demandas
    DEMANDA_NORMAL:            { label: 'AVISO',    cor: '#e67e22' },
    DEMANDA_PRIORITARIA:       { label: 'CRÍTICO',  cor: '#e74c3c' },
    DEMANDA_NAO_INICIADA:      { label: 'AVISO',    cor: '#e67e22' },
};

interface ToggleSwitchProps {
    checked: boolean;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

function ToggleSwitch({ checked, onChange }: ToggleSwitchProps) {
    return (
        <label className="switch">
            <input type="checkbox" checked={checked} onChange={onChange} />
            <span className="slider"></span>
        </label>
    );
}

export interface AlertaCardProps {
    config: AlertaConfig;
    onUpdate: (id: AlertaConfig['id'], campo: AlertaConfigCampo, valor: number | boolean) => void;
}

export default function AlertaCard({ config, onUpdate }: AlertaCardProps) {
    const nivel = NIVEL_POR_TIPO[config.tipo_alerta as TipoAlerta | string];

    // Estado local como string para evitar o "03" ao digitar após apagar
    const [gatilhoStr, setGatilhoStr]     = useState(String(config.gatilho_minutos));
    const [intervaloStr, setIntervaloStr] = useState(String(config.intervalo_repeticao_minutos));
    const [pesoStr, setPesoStr]           = useState(String(config.peso_risco ?? 0));

    // Sincroniza se o pai atualizar os valores (ex: reload)
    useEffect(() => { setGatilhoStr(String(config.gatilho_minutos)); },     [config.gatilho_minutos]);
    useEffect(() => { setIntervaloStr(String(config.intervalo_repeticao_minutos)); }, [config.intervalo_repeticao_minutos]);
    useEffect(() => { setPesoStr(String(config.peso_risco ?? 0)); }, [config.peso_risco]);

    const handleGatilhoBlur = () => {
        const val = parseInt(gatilhoStr) || 0;
        setGatilhoStr(String(val));
        onUpdate(config.id, 'gatilho_minutos', val);
    };

    const handleIntervaloBlur = () => {
        const val = parseInt(intervaloStr) || 0;
        setIntervaloStr(String(val));
        onUpdate(config.id, 'intervalo_repeticao_minutos', val);
    };

    const handlePesoBlur = () => {
        const val = parseInt(pesoStr) || 0;
        const clamped = Math.max(-50, Math.min(100, val));
        setPesoStr(String(clamped));
        onUpdate(config.id, 'peso_risco', clamped);
    };

    const pesoHint = () => {
        const v = parseInt(pesoStr) || 0;
        if (v > 0)  return `+${v} pts de risco`;
        if (v < 0)  return `${v} pts (bônus)`;
        return 'Neutro';
    };

    // Descrição: usar a parte depois dos dois pontos se existir, senão a descrição completa
    const partes = config.descricao?.split(':') || [];
    const titulo  = partes[0]?.trim() || String(config.tipo_alerta).replace(/_/g, ' ');
    const detalhe = partes.slice(1).join(':').trim();

    return (
        <div className={`config-card${config.ativo ? ' ativo' : ''}`}>
            <div className="config-card-header">
                <div className="config-card-header-info">
                    <span className="config-card-titulo">{titulo}</span>
                    {detalhe && <span className="config-card-detalhe">{detalhe}</span>}
                </div>
                <div className="config-card-header-acoes">
                    {nivel && (
                        <span
                            className="config-nivel-pill"
                            style={{ color: nivel.cor, borderColor: nivel.cor, background: `${nivel.cor}12` }}
                        >
                            {nivel.label}
                        </span>
                    )}
                    <ToggleSwitch
                        checked={!!config.ativo}
                        onChange={() => onUpdate(config.id, 'ativo', !config.ativo)}
                    />
                </div>
            </div>

            {config.ativo && (
                <div className="config-card-body">
                    <div className="config-form-grupo">
                        <label>Disparar após</label>
                        <div className="config-input-sufixo">
                            <input
                                type="number"
                                min="0"
                                className="gs-input"
                                value={gatilhoStr}
                                onChange={e => setGatilhoStr(e.target.value)}
                                onBlur={handleGatilhoBlur}
                            />
                            <span>min</span>
                        </div>
                    </div>

                    <div className="config-form-grupo">
                        <label>Repetir a cada</label>
                        <div className="config-input-sufixo">
                            <input
                                type="number"
                                min="0"
                                className="gs-input"
                                value={intervaloStr}
                                onChange={e => setIntervaloStr(e.target.value)}
                                onBlur={handleIntervaloBlur}
                            />
                            <span>min</span>
                        </div>
                    </div>

                    <div className="config-form-grupo">
                        <label title="Quanto maior o peso, mais este alerta eleva o Score de Risco do Turno. Use negativos para eventos positivos como metas batidas.">
                            Peso no Score de Risco <i className="fas fa-question-circle" style={{ fontSize: '0.75rem', color: '#aaa' }}></i>
                        </label>
                        <div className="config-input-sufixo">
                            <input
                                type="number"
                                min="-50"
                                max="100"
                                className="gs-input"
                                value={pesoStr}
                                onChange={e => setPesoStr(e.target.value)}
                                onBlur={handlePesoBlur}
                            />
                            <span style={{ color: parseInt(pesoStr) < 0 ? '#27ae60' : parseInt(pesoStr) > 0 ? '#e74c3c' : '#95a5a6', whiteSpace: 'nowrap' }}>
                                {pesoHint()}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
