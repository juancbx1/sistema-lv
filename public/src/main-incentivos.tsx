// public/src/main-incentivos.tsx
import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
// @ts-expect-error módulo JS legado sem tipos
import { verificarAutenticacao } from '/js/utils/auth.js';
import UIHeaderPagina from './components/UIHeaderPagina';
import UITabNav from './components/UITabNav';
import UICarregando from './components/UICarregando';
import removerCarregamentoInicial from './utils/remover-carregamento-inicial';
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
                if (auth) {
                    removerCarregamentoInicial();
                    setAutenticado(true);
                }
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

            <UITabNav
                ariaLabel="Áreas de incentivos"
                activeId={aba}
                onChange={(id) => setAba(id as IncenAba)}
                items={[
                    { id: 'gincanas', label: 'Gincanas', icon: 'fa-trophy' },
                    { id: 'metas', label: 'Metas e Comissões', icon: 'fa-bullseye' },
                    { id: 'pontos', label: 'Pontos por Atividade', icon: 'fa-star' },
                    { id: 'pagamentos', label: 'Pagamentos', icon: 'fa-coins' },
                ]}
            />

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
