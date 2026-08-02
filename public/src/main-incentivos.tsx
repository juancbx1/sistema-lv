// public/src/main-incentivos.tsx
import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
// @ts-expect-error módulo JS legado sem tipos
import { verificarAutenticacao } from '/js/utils/auth.js';
import UIHeaderPagina from './components/UIHeaderPagina';
import UICarregando from './components/UICarregando';
import IncenGincanasTab from './components/IncenGincanasTab';
import IncenMetasTab from './components/IncenMetasTab';
import IncenPontosTab from './components/IncenPontosTab';
import IncenPagamentosTab from './components/IncenPagamentosTab';
import type { IncenAba } from './utils/incentivos-types';

function App() {
    const [carregando, setCarregando] = useState(true);
    const [autenticado, setAutenticado] = useState(false);
    const [aba, setAba] = useState<IncenAba>('gincanas');
    const [modalNovaGincanaAberto, setModalNovaGincanaAberto] = useState(false);

    useEffect(() => {
        const checarAuth = async () => {
            try {
                const auth = await verificarAutenticacao('admin/incentivos.html', ['acesso-ponto-por-processo']);
                if (auth) setAutenticado(true);
            } catch (e) {
                console.error('[Incentivos] Erro auth:', e);
            }
            setCarregando(false);
        };
        void checarAuth();
    }, []);

    if (carregando) return <UICarregando variante="pagina" />;
    if (!autenticado) return null;

    return (
        <>
            <UIHeaderPagina titulo="Centro de Incentivos">
                {aba === 'gincanas' && (
                    <button
                        className="gs-btn gs-btn-primario"
                        onClick={() => setModalNovaGincanaAberto(true)}
                    >
                        <i className="fas fa-plus"></i> Nova Gincana
                    </button>
                )}
            </UIHeaderPagina>

            <nav className="gs-tab-nav">
                <button
                    className={`gs-tab-btn ${aba === 'gincanas' ? 'ativo' : ''}`}
                    onClick={() => setAba('gincanas')}
                >
                    <i className="fas fa-trophy"></i> Gincanas
                </button>
                <button
                    className={`gs-tab-btn ${aba === 'metas' ? 'ativo' : ''}`}
                    onClick={() => setAba('metas')}
                >
                    <i className="fas fa-bullseye"></i> Metas e Comissões
                </button>
                <button
                    className={`gs-tab-btn ${aba === 'pontos' ? 'ativo' : ''}`}
                    onClick={() => setAba('pontos')}
                >
                    <i className="fas fa-star"></i> Pontos por Atividade
                </button>
                <button
                    className={`gs-tab-btn ${aba === 'pagamentos' ? 'ativo' : ''}`}
                    onClick={() => setAba('pagamentos')}
                >
                    <i className="fas fa-coins"></i> Pagamentos
                </button>
            </nav>

            <div className="gs-conteudo-pagina">
                {aba === 'gincanas' && (
                    <IncenGincanasTab
                        modalNovaGincanaAberto={modalNovaGincanaAberto}
                        onFecharModalNova={() => setModalNovaGincanaAberto(false)}
                    />
                )}
                {aba === 'metas'      && <IncenMetasTab />}
                {aba === 'pontos'     && <IncenPontosTab />}
                {aba === 'pagamentos' && <IncenPagamentosTab />}
            </div>
        </>
    );
}

const rootElement = document.getElementById('root');
if (rootElement) {
    createRoot(rootElement).render(
        <App />
    );
}
