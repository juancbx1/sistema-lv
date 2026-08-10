import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
// Utilitário JS compartilhado entre páginas, mantido fora da migração geral.
import { permissoesDisponiveis } from '../js/utils/permissoes.js';
import {
    lerContextoAcessoNegado,
    limparContextoAcessoNegado,
    obterDestinoAreaInicial,
} from '../js/utils/acesso-negado.js';

interface ContextoAcessoNegado {
    pagina: string;
    permissoes: string[];
    motivo: 'permissao' | 'modulo';
    mensagem: string;
}

interface PermissaoCatalogo {
    id: string;
    label?: string;
    descricao?: string;
    pagina?: string;
}

function obterContextoInicial(): ContextoAcessoNegado | null {
    return lerContextoAcessoNegado() as ContextoAcessoNegado | null;
}

function obterDestinoSeguro(): string {
    return obterDestinoAreaInicial();
}

function obterPermissaoContexto(contexto: ContextoAcessoNegado | null): PermissaoCatalogo | null {
    if (!contexto?.permissoes?.length) return null;
    const catalogo = Array.isArray(permissoesDisponiveis)
        ? permissoesDisponiveis as PermissaoCatalogo[]
        : [];
    return catalogo.find((permissao) =>
        contexto.permissoes.includes(permissao.id)
    ) || null;
}

function App() {
    const [contexto] = useState<ContextoAcessoNegado | null>(obterContextoInicial);
    const permissao = useMemo(() => obterPermissaoContexto(contexto), [contexto]);
    const pagina = permissao?.pagina || contexto?.pagina || 'Área protegida';
    const mensagem = contexto?.mensagem || (
        contexto?.motivo === 'modulo'
            ? 'Este módulo ainda não está disponível para a empresa ativa.'
            : 'Seu vínculo atual não possui o acesso necessário para abrir esta página.'
    );

    useEffect(() => {
        limparContextoAcessoNegado();
    }, []);

    const voltarParaMinhaArea = () => {
        window.location.assign(obterDestinoSeguro());
    };

    return (
        <main className="an-shell">
            <div className="an-orbit an-orbit--one" aria-hidden="true" />
            <div className="an-orbit an-orbit--two" aria-hidden="true" />

            <section className="an-card" aria-labelledby="an-titulo">
                <div className="an-brand-line">
                    <span className="an-brand-mark" aria-hidden="true">LV</span>
                    <span>Sistema LV</span>
                </div>

                <div className="an-icon-wrap" aria-hidden="true">
                    <i className="fa-solid fa-lock" />
                </div>

                <span className="an-eyebrow">Acesso controlado</span>
                <h1 id="an-titulo" className="an-title">Esta área está bloqueada</h1>
                <p className="an-msg">Você está autenticado, mas este espaço não está liberado para o seu vínculo atual.</p>

                <div className="an-contexto" aria-label="Detalhes do bloqueio">
                    <span className="an-contexto-label">Área solicitada</span>
                    <strong>{pagina}</strong>
                    {permissao?.label && <small>{permissao.label}</small>}
                    <p>{mensagem}</p>
                </div>

                <div className="an-actions">
                    <button type="button" className="an-btn an-btn--primary" onClick={voltarParaMinhaArea}>
                        <i className="fa-solid fa-arrow-left" aria-hidden="true" />
                        Voltar para minha área
                    </button>
                </div>

                <p className="an-help">
                    Precisa desse acesso? Solicite a liberação ao administrador responsável pelo seu vínculo.
                </p>
            </section>
        </main>
    );
}

const rootElement = document.getElementById('root');
if (rootElement) {
    createRoot(rootElement).render(<App />);
}
