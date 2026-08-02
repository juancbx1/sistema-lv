// public/src/main-arremates.jsx

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';

import UIHeaderPagina from './components/UIHeaderPagina';
import ArreMatePainelAtividades from './components/ArreMatePainelAtividades.jsx';
import ArremateExternoTela from './components/ArremateExternoTela.jsx';
import AtribuicaoModal from './components/ArremateAtribuicaoModal.jsx';
import ArremateRegistrarPerdaTela from './components/ArremateRegistrarPerdaTela.jsx';
import ArremateModalTempos from './components/ArremateModalTempos.jsx';
import ArremateHistoricoModal from './components/ArremateHistoricoModal.jsx';
import BotaoBuscaFunil from './components/BotaoBuscaFunil.jsx';
import AlertasFAB from './components/AlertasFAB.jsx';
import { verificarAutenticacao } from '/js/utils/auth.js';

class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { hasError: false, error: null }; }
    static getDerivedStateFromError(error) { return { hasError: true, error }; }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 20, color: 'red', textAlign: 'center' }}>
                    <h2>Algo deu errado.</h2>
                    <details>{this.state.error?.toString()}</details>
                    <button onClick={() => window.location.reload()}>Recarregar</button>
                </div>
            );
        }
        return this.props.children;
    }
}

function App() {
    const [tabAtiva, setTabAtiva] = useState('painel');
    const [modalTemposAberto, setModalTemposAberto] = useState(false);
    const [modalAtribuicaoAberto, setModalAtribuicaoAberto] = useState(false);
    const [modalHistoricoAberto, setModalHistoricoAberto] = useState(false);
    const [tiktikSelecionado, setTiktikSelecionado] = useState(null);
    const [permissoes, setPermissoes] = useState([]);
    const [estaAutenticado, setEstaAutenticado] = useState(false);

    useEffect(() => {
        verificarAutenticacao('admin/arremates.html', ['acesso-ordens-de-arremates']).then(auth => {
            if (auth) {
                setEstaAutenticado(true);
                setPermissoes(auth.permissoes || []);
                document.body.classList.add('autenticado');
            }
        });
    }, []);

    // Bridge para o admin-arremates.js (painel de tiktiks JS legado) e para ArremateStatusCard
    useEffect(() => {
        window.abrirModalAtribuicao = (tiktik) => {
            setTiktikSelecionado(tiktik);
            setModalAtribuicaoAberto(true);
        };
        return () => { delete window.abrirModalAtribuicao; };
    }, []);

    if (!estaAutenticado) return null;

    return (
        <>
            <UIHeaderPagina titulo="Arremates">
                <button
                    className="gs-btn gs-btn-secundario gs-btn-com-icone"
                    onClick={() => setModalTemposAberto(true)}
                    title="Configurar Tempos Padrão de Arremate"
                >
                    <i className="fas fa-clock"></i>
                    <span>TPA</span>
                </button>
                <button
                    className="gs-btn gs-btn-secundario gs-btn-com-icone"
                    onClick={() => setModalHistoricoAberto(true)}
                >
                    <i className="fas fa-clipboard-list"></i>
                    <span>Histórico</span>
                </button>
            </UIHeaderPagina>

            <nav className="gs-tab-nav">
                <button
                    className={`gs-tab-btn ${tabAtiva === 'painel' ? 'ativo' : ''}`}
                    onClick={() => setTabAtiva('painel')}
                >
                    <i className="fas fa-users"></i> Painel
                </button>
                <button
                    className={`gs-tab-btn ${tabAtiva === 'perda' ? 'ativo' : ''}`}
                    onClick={() => setTabAtiva('perda')}
                >
                    <i className="fas fa-exclamation-triangle"></i> Registrar Perda
                </button>
                <button
                    className={`gs-tab-btn ${tabAtiva === 'externo' ? 'ativo' : ''}`}
                    onClick={() => setTabAtiva('externo')}
                >
                    <i className="fas fa-user-tie"></i> P. Externo
                </button>
            </nav>

            <div className="gs-conteudo-pagina">
                {tabAtiva === 'painel' && (
                    <>
                        <ArreMatePainelAtividades permissoes={permissoes} />
                    </>
                )}

                {tabAtiva === 'perda' && (
                    <ArremateRegistrarPerdaTela
                        onConcluido={() => setTabAtiva('painel')}
                    />
                )}

                {tabAtiva === 'externo' && (
                    <ArremateExternoTela />
                )}
            </div>

            <ArremateModalTempos
                isOpen={modalTemposAberto}
                onClose={() => setModalTemposAberto(false)}
            />
            <AtribuicaoModal
                isOpen={modalAtribuicaoAberto}
                tiktik={tiktikSelecionado}
                onClose={() => setModalAtribuicaoAberto(false)}
            />
            <ArremateHistoricoModal
                isOpen={modalHistoricoAberto}
                onClose={() => setModalHistoricoAberto(false)}
            />
            <BotaoBuscaFunil permissoes={permissoes} />
            <AlertasFAB />
        </>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </React.StrictMode>
);
