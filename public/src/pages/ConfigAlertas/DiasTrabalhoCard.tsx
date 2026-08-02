// public/src/pages/ConfigAlertas/DiasTrabalhoCard.tsx
// Card de Calendário de Operação — apenas os dias da semana em que os alertas de tempo ficam ativos.

import type { DiasTrabalhoMap } from '../../utils/alertas-types';

const DIAS_DA_SEMANA: { id: number; nome: string }[] = [
    { id: 0, nome: 'Domingo' },
    { id: 1, nome: 'Segunda-feira' },
    { id: 2, nome: 'Terça-feira' },
    { id: 3, nome: 'Quarta-feira' },
    { id: 4, nome: 'Quinta-feira' },
    { id: 5, nome: 'Sexta-feira' },
    { id: 6, nome: 'Sábado' },
];

export interface DiasTrabalhoCardProps {
    diasConfig: DiasTrabalhoMap;
    onUpdate: (novaConfig: DiasTrabalhoMap) => void;
}

export default function DiasTrabalhoCard({ diasConfig, onUpdate }: DiasTrabalhoCardProps) {
    const handleDiaToggle = (diaId: number) => {
        const novaConfig = { ...diasConfig };
        novaConfig[diaId] = !novaConfig[diaId];
        onUpdate(novaConfig);
    };

    return (
        <div className="config-card config-card-calendario">
            <div className="config-card-header">
                <div className="config-card-header-info">
                    <span className="config-card-titulo">
                        <i className="fas fa-calendar-alt" style={{ marginRight: 8, color: '#7f8c8d' }}></i>
                        Calendário de Operação
                    </span>
                    <span className="config-card-detalhe">Dias em que os alertas de ociosidade e lentidão ficam ativos</span>
                </div>
            </div>
            <div className="config-card-body">
                <div className="dias-semana-container">
                    {DIAS_DA_SEMANA.map(dia => (
                        <label key={dia.id} className="dia-toggle">
                            <input
                                type="checkbox"
                                checked={!!diasConfig[dia.id]}
                                onChange={() => handleDiaToggle(dia.id)}
                            />
                            <span className={`dia-chip${diasConfig[dia.id] ? ' ativo' : ''}`}>
                                {dia.nome}
                            </span>
                        </label>
                    ))}
                </div>
            </div>
        </div>
    );
}
