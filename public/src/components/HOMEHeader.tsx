// public/src/components/HOMEHeader.tsx
import type { HomeUsuario } from '../utils/home-types';

interface HOMEHeaderProps {
    usuario?: HomeUsuario | null;
}

export default function HOMEHeader({ usuario }: HOMEHeaderProps) {
    const getSaudacao = () => {
        const hora = new Date().getHours();
        if (hora < 12) return 'Bom dia';
        if (hora < 18) return 'Boa tarde';
        return 'Boa noite';
    };

    // Formata a data de forma amigável: "Quarta-feira, 25 de Outubro"
    const getDataExtenso = () => {
        const hoje = new Date();
        const diaSemana = hoje.toLocaleDateString('pt-BR', { weekday: 'long' });
        const diaMes = hoje.getDate();
        const mes = hoje.toLocaleDateString('pt-BR', { month: 'long' });
        const ano = hoje.getFullYear();

        // Capitaliza o dia da semana (primeira letra maiúscula)
        const diaSemanaCap = diaSemana.charAt(0).toUpperCase() + diaSemana.slice(1);

        return `${diaSemanaCap}, ${diaMes} de ${mes} de ${ano}`;
    };

    return (
        <div className="home-header-container">
            <h1 className="home-welcome-title">
                {getSaudacao()}, <span className="highlight-name">{usuario?.nome?.split(' ')[0] || 'Visitante'}</span>!
            </h1>
            <div className="home-date-badge">
                <i className="far fa-calendar-alt"></i>
                <span>{getDataExtenso()}</span>
            </div>
        </div>
    );
}
