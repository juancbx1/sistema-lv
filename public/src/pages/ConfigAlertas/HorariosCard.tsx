// public/src/pages/ConfigAlertas/HorariosCard.tsx
// Card de Configurações de Horário — expediente (controle do servidor) e janela de polling (controle do frontend).

import type { HorarioCampo, JanelaPollCampo } from '../../utils/alertas-types';

export interface HorariosCardProps {
    horarioInicio: string;
    horarioFim: string;
    onUpdateHorario: (campo: HorarioCampo, valor: string) => void;
    janelaPollInicio: string;
    janelaPollFim: string;
    onUpdateJanelaPoll: (campo: JanelaPollCampo, valor: string) => void;
}

export default function HorariosCard({
    horarioInicio,
    horarioFim,
    onUpdateHorario,
    janelaPollInicio,
    janelaPollFim,
    onUpdateJanelaPoll,
}: HorariosCardProps) {
    return (
        <div className="config-card">
            <div className="config-card-header">
                <div className="config-card-header-info">
                    <span className="config-card-titulo">
                        <i className="fas fa-clock" style={{ marginRight: 8, color: '#7f8c8d' }}></i>
                        Configurações de Horário
                    </span>
                    <span className="config-card-detalhe">Expediente e janela de verificações da API</span>
                </div>
            </div>
            <div className="config-card-body config-card-body-coluna">

                {/* Horário de Expediente */}
                <div className="config-horario-bloco">
                    <div className="config-horario-label">
                        <strong>Horário de Expediente</strong>
                        <span>Alertas de ociosidade e lentidão só disparam dentro dessa janela (verificado no servidor, timezone SP)</span>
                    </div>
                    <div className="horario-expediente-container">
                        <div className="horario-expediente-campo">
                            <span>Das</span>
                            <input
                                type="time"
                                value={horarioInicio || '07:00'}
                                onChange={e => onUpdateHorario('horario_inicio', e.target.value)}
                            />
                        </div>
                        <span className="horario-expediente-separador">até</span>
                        <div className="horario-expediente-campo">
                            <span>Às</span>
                            <input
                                type="time"
                                value={horarioFim || '18:00'}
                                onChange={e => onUpdateHorario('horario_fim', e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                <div className="config-horario-divisor"></div>

                {/* Janela de Polling */}
                <div className="config-horario-bloco">
                    <div className="config-horario-label">
                        <strong>Janela de Verificações da API</strong>
                        <span>Fora desse intervalo o frontend não chama a API — economiza créditos Vercel. Para testes noturnos, amplie até 23:59.</span>
                    </div>
                    <div className="horario-expediente-container">
                        <div className="horario-expediente-campo">
                            <span>Das</span>
                            <input
                                type="time"
                                value={janelaPollInicio || '06:00'}
                                onChange={e => onUpdateJanelaPoll('janela_poll_inicio', e.target.value)}
                            />
                        </div>
                        <span className="horario-expediente-separador">até</span>
                        <div className="horario-expediente-campo">
                            <span>Às</span>
                            <input
                                type="time"
                                value={janelaPollFim || '23:00'}
                                onChange={e => onUpdateJanelaPoll('janela_poll_fim', e.target.value)}
                            />
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
