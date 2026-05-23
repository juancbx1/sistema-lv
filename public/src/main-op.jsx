// public/src/main-op.jsx

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';

import UIHeaderPagina from './components/UIHeaderPagina.jsx';
import OPPainelAtividades from './components/OPPainelAtividades.jsx';
import OPGerenciamentoTela from './components/OPGerenciamentoTela.jsx';
import OPCortesTela from './components/OPCortesTela.jsx';
import OPModalTempos from './components/OPModalTempos.jsx';
import OPCriarModal from './components/OPCriarModal.jsx';
import OPExternoTela from './components/OPExternoTela.jsx';
import BotaoBuscaFunil from './components/BotaoBuscaFunil.jsx';
import AlertasFAB from './components/AlertasFAB.jsx';
import UIBloqueio from './components/UIBloqueio.jsx';

import { verificarAutenticacao } from '/js/utils/auth.js';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true }; }
  componentDidCatch(error, errorInfo) { 
      console.error("REACT CRASHOU:", error, errorInfo); 
      this.setState({ error });
  }
  render() { 
      if (this.state.hasError) {
          return (
            <div style={{padding: 20, color: 'red', textAlign: 'center'}}>
                <h2>Algo deu errado na aplicação.</h2>
                <details>{this.state.error && this.state.error.toString()}</details>
                <button onClick={() => window.location.reload()}>Recarregar</button>
            </div>
          );
      } 
      return this.props.children; 
  }
}

async function fetchSimples(url) {
    const token = localStorage.getItem('token');
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) throw new Error('Erro fetch');
    return res.json();
}

function App() {
  const [visaoAtual, setVisaoAtual] = useState('painel');
  const [modalTppAberto, setModalTppAberto] = useState(false);
  const [qtdOpsPendentes, setQtdOpsPendentes] = useState(0);
  
  const [estaAutenticado, setEstaAutenticado] = useState(false);
  const [verificandoAuth, setVerificandoAuth] = useState(true);
  const [permissoes, setPermissoes] = useState([]);

  // Estado do OPCriarModal (aberto via URL params do Painel de Demandas)
  const [opCriarModalAberto, setOpCriarModalAberto] = useState(false);
  const [opCriarModalDados, setOpCriarModalDados] = useState(null);


  useEffect(() => {
      async function checkAuth() {
          try {
              const auth = await verificarAutenticacao('ordens-de-producao.html', ['acesso-ordens-de-producao']);
              if (auth) {
                  setEstaAutenticado(true);
                  // Salva as permissões vindas do auth
                  setPermissoes(auth.permissoes || []);

                  // Verifica se veio redirecionado do Painel de Demandas via "Criar OP"
                  const params = new URLSearchParams(window.location.search);
                  const demandaId = params.get('demanda_id');
                  if (demandaId) {
                      setOpCriarModalDados({
                          demandaId: parseInt(demandaId),
                          produtoId: parseInt(params.get('produto_id')),
                          variante: params.get('variante') || null,
                          quantidadeSugerida: parseInt(params.get('quantidade')) || 0,
                      });
                      setOpCriarModalAberto(true);
                      // Limpa a URL para evitar re-disparo ao recarregar a página
                      window.history.replaceState({}, '', window.location.pathname);
                  }
                  document.body.classList.add('autenticado');
              } else {
                  document.body.innerHTML = '<p style="text-align:center; padding:20px;">Redirecionando...</p>';
              }
          } catch (error) {
              console.error("Erro na autenticação:", error);
          } finally {
              setVerificandoAuth(false);
          }
      }
      checkAuth();
  }, []);

  const verificarOpsProntas = useCallback(async () => {
        if (!estaAutenticado) return; 

        try {
            const data = await fetchSimples('/api/ordens-de-producao?status=produzindo&limit=100');
            if (!data.rows || data.rows.length === 0) {
                setQtdOpsPendentes(0);
            } else {
                // --- NOVO CÓDIGO OTIMIZADO ---
                // Não fazemos mais fetch extra. Usamos data.rows direto.
                const contagem = data.rows.reduce((acc, op) => {
                    if (!op) return acc;
                    // O backend agora já entrega 'etapas' com a flag 'lancado' correta na lista principal
                    const etapasOk = op.etapas && Array.isArray(op.etapas) && op.etapas.length > 0 && op.etapas.every(e => e.lancado);
                    return etapasOk ? acc + 1 : acc;
                }, 0);

                setQtdOpsPendentes(contagem);
                // -----------------------------
            }
        } catch (error) {
            console.error("[Monitor OP] Erro:", error);
        }
  }, [estaAutenticado]);

  useEffect(() => {
    if (!estaAutenticado) return;

    // 1. Executa imediatamente ao carregar
    verificarOpsProntas();

    // 2. Polling a cada 30s — mantém o badge vivo sem depender de ação do usuário
    const intervalo = setInterval(() => {
        // Só faz a requisição se a aba estiver visível
        if (document.visibilityState === 'visible') {
            verificarOpsProntas();
        }
    }, 30_000);

    // 3. Quando o usuário volta para a aba (troca de apps, minimiza etc.), busca na hora
    const handleVisibility = () => {
        if (document.visibilityState === 'visible') verificarOpsProntas();
    };
    const handleFocus = () => verificarOpsProntas();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    return () => {
        clearInterval(intervalo);
        document.removeEventListener('visibilitychange', handleVisibility);
        window.removeEventListener('focus', handleFocus);
    };
  }, [estaAutenticado, verificarOpsProntas]);

   if (verificandoAuth) return null;
   if (!estaAutenticado) return null;

   return (
    <ErrorBoundary>
      <UIHeaderPagina titulo="Ordens de Produção">
        <UIBloqueio permissao="configurar-tempos-padrao">
          <button
            className="gs-btn gs-btn-secundario"
            title="Configurar Tempos Padrão de Produção"
            onClick={() => setModalTppAberto(true)}
          >
              <i className="fas fa-cog"></i>
          </button>
        </UIBloqueio>
      </UIHeaderPagina>

      <nav className="gs-tab-nav">
        <button
          className={`gs-tab-btn ${visaoAtual === 'painel' ? 'ativo' : ''}`}
          onClick={() => setVisaoAtual('painel')}
        >
          <i className="fas fa-users"></i> Painel
        </button>

        <button
          className={`gs-tab-btn ${visaoAtual === 'gerenciamento' ? 'ativo' : ''}`}
          onClick={() => setVisaoAtual('gerenciamento')}
        >
          <i className="fas fa-list-alt"></i> OPs
          {qtdOpsPendentes > 0 && (
              <span className="op-tab-pulso-dot" title="Há OPs prontas para finalizar"></span>
          )}
        </button>

        <button
          className={`gs-tab-btn ${visaoAtual === 'cortes' ? 'ativo' : ''}`}
          onClick={() => setVisaoAtual('cortes')}
        >
          <i className="fas fa-cut"></i> Cortes
        </button>

        <button
          className={`gs-tab-btn ${visaoAtual === 'externo' ? 'ativo' : ''}`}
          onClick={() => setVisaoAtual('externo')}
        >
          <i className="fas fa-user-tie"></i> P. Externo
        </button>
      </nav>

      <div className="gs-conteudo-pagina">
          {visaoAtual === 'painel' && <OPPainelAtividades />}

          {visaoAtual === 'gerenciamento' && (
            <OPGerenciamentoTela
                opsPendentesGlobal={qtdOpsPendentes}
                onRefreshContadores={verificarOpsProntas}
                permissoes={permissoes}
            />
          )}

          {visaoAtual === 'cortes' && <OPCortesTela />}

          {visaoAtual === 'externo' && <OPExternoTela />}
      </div>

      <OPModalTempos isOpen={modalTppAberto} onClose={() => setModalTppAberto(false)} />

      {opCriarModalDados && (
          <OPCriarModal
              isOpen={opCriarModalAberto}
              onClose={() => { setOpCriarModalAberto(false); setOpCriarModalDados(null); }}
              onOPCriada={() => { setOpCriarModalAberto(false); setOpCriarModalDados(null); verificarOpsProntas(); }}
              demandaId={opCriarModalDados.demandaId}
              produtoId={opCriarModalDados.produtoId}
              variante={opCriarModalDados.variante}
              quantidadeSugerida={opCriarModalDados.quantidadeSugerida}
          />
      )}

      <BotaoBuscaFunil
          permissoes={permissoes}
          onIniciarProducao={(dados) => {
              setOpCriarModalDados({
                  demandaId:         dados.demanda_id,
                  produtoId:         dados.produto_id,
                  variante:          dados.variante || null,
                  quantidadeSugerida: dados.quantidade || 0,
              });
              setOpCriarModalAberto(true);
          }}
      />
      <AlertasFAB />

    </ErrorBoundary>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(<App />);
}