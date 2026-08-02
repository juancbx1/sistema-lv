// public/src/components/HOMEQuickActions.tsx
import type { HomeAcaoRapida } from '../utils/home-types';

const acoesDisponiveis: HomeAcaoRapida[] = [
    {
        titulo: 'Gerenciar OPs',
        link: 'ordens-de-producao.html',
        icone: 'fa-clipboard-list',
        permissao: 'acesso-ordens-de-producao',
    },
    {
        titulo: 'Produção Diária',
        link: 'producao-diaria.html',
        icone: 'fa-chart-line',
        permissao: 'acesso-producao-diaria',
    },
    {
        titulo: 'Embalagem',
        link: 'embalagem-de-produtos.html',
        icone: 'fa-box-open',
        permissao: 'acesso-embalagem-de-produtos',
    },
    {
        titulo: 'Gerenciar Produção',
        link: 'gerenciar-producao.html',
        icone: 'fa-cog',
        permissao: 'acesso-gerenciar-producao',
    },
    // Adicione mais conforme necessário
];

interface HOMEQuickActionsProps {
    permissoes: string[];
}

export default function HOMEQuickActions({ permissoes }: HOMEQuickActionsProps) {
    // Filtra ações baseado nas permissões do usuário
    const acoesVisiveis = acoesDisponiveis.filter((acao) =>
        !acao.permissao || permissoes.includes(acao.permissao),
    );

    if (acoesVisiveis.length === 0) return null;

    return (
        <div style={{ marginBottom: '30px' }}>
            {/* TÍTULO CONVIDATIVO */}
            <div className="home-section-title">O que deseja fazer agora?</div>

            <div className="home-actions-grid">
                {acoesVisiveis.map((acao, index) => (
                    <a key={index} href={acao.link} className="home-action-card">
                        <i className={`fas ${acao.icone}`}></i>
                        <span>{acao.titulo}</span>
                    </a>
                ))}
            </div>
        </div>
    );
}
