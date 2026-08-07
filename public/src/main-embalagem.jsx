// public/src/main-embalagem.jsx

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { EmbalagemCard } from './components/EmbalagemCard.jsx';
import EmbalagemPainelFiltros from './components/EmbalagemPainelFiltros.jsx';
import { obterProdutos } from '/js/utils/storage.js';
import { normalizeText } from '/src/utils/EmbalagemSearchHelpers';
import { renderizarPaginacao } from '/js/utils/Paginacao.js';
import UIHeaderPagina from './components/UIHeaderPagina'; 
import UIFeedbackNotFound from './components/UIFeedbackNotFound';
import BotaoBuscaFunil from './components/BotaoBuscaFunil.jsx';
import AlertasFAB from './components/AlertasFAB.jsx';
import { mostrarMensagem } from '/js/utils/popups.js';
import { verificarAutenticacao } from '/js/utils/auth.js';

const ITENS_POR_PAGINA = 6;

// Componente principal que irá controlar a página
function PainelEmbalagem() {
    const [produtosFila, setProdutosFila] = useState([]);
    const [todosOsProdutos, setTodosOsProdutos] = useState([]);
    const [opcoesDeFiltro, setOpcoesDeFiltro] = useState({});
    const [carregando, setCarregando] = useState(true);
    const [atualizando, setAtualizando] = useState(false);
    const [erro, setErro] = useState(null);
    const [paginaAtual, setPaginaAtual] = useState(1);
    const [filtros, setFiltros] = useState({
        termoBusca: '', ordenacao: 'mais_recentes', produtos: [], cores: [], tamanhos: [],
    });

    // Ref para o container da paginação
    const paginacaoContainerRef = useRef(null);

    // Detecta produto_id/variante na URL (vindo do painel de demandas)
    const urlParamsProduto = useMemo(() => {
        const p = new URLSearchParams(window.location.search);
        const id = p.get('produto_id');
        return id ? { produto_id: parseInt(id), variante: p.get('variante') || null } : null;
    }, []);

    const carregarDados = useCallback(async () => {
        try {
            const token = localStorage.getItem('token');
            if (!token) throw new Error('Token não encontrado.');

            const produtosCadastrados = await obterProdutos(true);
            setTodosOsProdutos(produtosCadastrados);

            const response = await fetch('/api/embalagens/fila?todos=true', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error('Falha ao buscar dados da fila.');
            const data = await response.json();
            const dadosDaFila = data.rows || [];

            // Extrai as opções de filtro dos dados brutos
            const opcoes = extrairOpcoesDeFiltro(dadosDaFila, produtosCadastrados);
            setOpcoesDeFiltro(opcoes);

            const produtosComSku = dadosDaFila.map(item => {
                const produtoCadastrado = produtosCadastrados.find(p => p.id === item.produto_id);
                let sku = 'N/A';
                if (produtoCadastrado) {
                    if (item.variante && item.variante !== '-') {
                        const gradeInfo = produtoCadastrado.grade?.find(g => g.variacao === item.variante);
                        sku = gradeInfo?.sku || produtoCadastrado.sku || 'N/A';
                    } else {
                        sku = produtoCadastrado.sku || 'N/A';
                    }
                }
                return { ...item, sku };
            });

            setProdutosFila(produtosComSku);
        } catch (err) {
            console.error("Erro ao carregar dados:", err);
            setErro(err.message);
        }
    }, []);

    useEffect(() => {
        const loader = document.getElementById('carregamentoGlobal');
        const content = document.getElementById('conteudoPrincipal');
        setCarregando(true);
        carregarDados().finally(() => {
            setCarregando(false);
            if(loader) loader.classList.remove('visivel');
            if(content) content.classList.remove('gs-conteudo-carregando');
        });
    }, [carregarDados]);

    const handleAtualizar = async () => {
        setAtualizando(true);
        await carregarDados();
        setAtualizando(false);
    };

    // Auto-abre o produto quando produto_id vem na URL (CTA do painel de demandas)
    useEffect(() => {
        if (!urlParamsProduto || produtosFila.length === 0) return;
        const { produto_id, variante } = urlParamsProduto;
        const item = produtosFila.find(p =>
            p.produto_id === produto_id &&
            (!variante || p.variante === variante || (!p.variante && variante === '-'))
        );
        if (item) {
            // Limpa a URL para não re-disparar ao recarregar
            window.history.replaceState({}, '', window.location.pathname);
            handleCardClick(item);
        }
    }, [produtosFila, urlParamsProduto]);

    useEffect(() => {
        // A função que será chamada quando o evento for disparado
        const escutarAtualizacao = () => {
            console.log('[REACT] Evento "forcarAtualizacaoFila" recebido! Atualizando dados...');
            handleAtualizar();
        };

        // Adiciona o "ouvinte" ao window
        window.addEventListener('forcarAtualizacaoFila', escutarAtualizacao);

        // Função de limpeza: remove o "ouvinte" quando o componente for desmontado
        // Isso é importante para evitar vazamentos de memória
        return () => {
            window.removeEventListener('forcarAtualizacaoFila', escutarAtualizacao);
        };
    }, [handleAtualizar]); // A dependência garante que a função de atualização esteja sempre correta

    const produtosFiltrados = useMemo(() => {
        let produtos = [...produtosFila];
        const { termoBusca, ordenacao, produtos: produtosSel, cores: coresSel, tamanhos: tamanhosSel } = filtros;

        if (termoBusca) {
            const termoNormalizado = normalizeText(termoBusca);
            produtos = produtos.filter(p => 
                normalizeText(p.produto).includes(termoNormalizado) ||
                normalizeText(p.variante).includes(termoNormalizado) ||
                normalizeText(p.sku).includes(termoNormalizado)
            );
        }
        if (produtosSel.length > 0) {
            produtos = produtos.filter(p => produtosSel.includes(p.produto));
        }

        if (tamanhosSel.length > 0) {
            produtos = produtos.filter(p => {
                if (!p.variante) return false;

                // Separa a variação em partes se houver um "|"
                const partes = p.variante.split('|').map(str => str.trim());
                // A última parte é candidata a ser o tamanho
                const possivelTamanho = partes[partes.length - 1];

                // Verifica se o "possível tamanho" está na lista de tamanhos selecionados
                // Comparamos em maiúsculas para evitar problemas de case (P vs p)
                return tamanhosSel.some(tamanhoSelecionado => 
                    possivelTamanho.toUpperCase() === tamanhoSelecionado.toUpperCase()
                );
            });
        }

        if (coresSel.length > 0) {
            produtos = produtos.filter(p => p.variante && coresSel.some(cor => normalizeText(p.variante).includes(normalizeText(cor))));
        }

        switch (ordenacao) {
            case 'mais_antigos':
                produtos.sort((a, b) => new Date(a.data_lancamento_mais_antiga) - new Date(b.data_lancamento_mais_antiga));
                break;
            case 'maior_quantidade':
                produtos.sort((a, b) => b.total_disponivel_para_embalar - a.total_disponivel_para_embalar);
                break;
            case 'menor_quantidade':
                produtos.sort((a, b) => a.total_disponivel_para_embalar - b.total_disponivel_para_embalar);
                break;
            default:
                produtos.sort((a, b) => new Date(b.data_lancamento_mais_recente) - new Date(a.data_lancamento_mais_recente));
                break;
        }
        return produtos;
    }, [produtosFila, filtros]);

     // Sempre que os filtros mudarem, voltamos para a primeira página
    useEffect(() => {
        setPaginaAtual(1);
    }, [filtros]);

    // Lógica para "fatiar" os dados e obter o total de páginas
    const { itensDaPagina, totalPaginas } = useMemo(() => {
        const inicio = (paginaAtual - 1) * ITENS_POR_PAGINA;
        const fim = inicio + ITENS_POR_PAGINA;
        return {
            itensDaPagina: produtosFiltrados.slice(inicio, fim),
            totalPaginas: Math.ceil(produtosFiltrados.length / ITENS_POR_PAGINA) || 1,
        };
    }, [produtosFiltrados, paginaAtual]);

    // Efeito para renderizar/atualizar a paginação usando a função JS
    useEffect(() => {
        if (paginacaoContainerRef.current) {
            renderizarPaginacao(paginacaoContainerRef.current, totalPaginas, paginaAtual, setPaginaAtual);
        }
    }, [totalPaginas, paginaAtual]); // Roda sempre que a página ou o total de páginas mudar

    const handleCardClick = async (itemClicado) => {
        // Mostra um feedback visual de que algo está acontecendo
        document.getElementById('carregamentoGlobal').classList.add('visivel');

        try {
            const token = localStorage.getItem('token');
            if (!token) throw new Error("Token não encontrado.");

            // Passo 1: Buscar os arremates detalhados para este item específico
            const params = new URLSearchParams({ 
                produto_id: itemClicado.produto_id,
                variante: itemClicado.variante || '-',
                fetchAll: 'true' // Para obter todos os lotes, mesmo os com saldo zero (embora a API de arremate já filtre)
            });

            params.append('tipo_lancamento', 'PRODUCAO');


            const response = await fetch(`/api/arremates?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                throw new Error('Falha ao buscar os lotes de arremate detalhados.');
            }
            
            const dataArremates = await response.json();
            
            // Filtra apenas os arremates que realmente têm saldo para embalar
            const arrematesComSaldo = (dataArremates.rows || []).filter(arr => (arr.quantidade_arrematada - arr.quantidade_ja_embalada) > 0);

            // ▼▼▼ ADICIONE ESTE LOG DE VERIFICAÇÃO AQUI ▼▼▼
            console.log(`[VERIFICAÇÃO 1.1] Lista de arremates com saldo após filtro final. Total de lotes: ${arrematesComSaldo.length}. Tipos:`, [...new Set(arrematesComSaldo.map(a => a.tipo_lancamento))]);
            // ▲▲▲ FIM DO LOG ▲▲▲
            // ========================================================================

            // Passo 2: Montar o objeto completo que a tela de detalhes espera
            const agregadoCompleto = {
                ...itemClicado, // Inclui todas as propriedades do item (produto_id, nome, etc.)
                total_quantidade_disponivel_para_embalar: itemClicado.total_disponivel_para_embalar, // Garante que o total está correto
                arremates_detalhe: arrematesComSaldo
            };


            // Passo 3: Salvar no localStorage e navegar
            localStorage.setItem('embalarDetalheAtual', JSON.stringify(agregadoCompleto));
            window.location.hash = '#embalar-produto';

        } catch (error) {
            console.error("Erro em handleCardClick:", error);
            // Usa sua função de popup para mostrar o erro
            mostrarMensagem("Não foi possível carregar os detalhes deste item.", "erro");
        } finally {
            // Esconde o feedback visual, mesmo que a navegação vá acontecer
            document.getElementById('carregamentoGlobal').classList.remove('visivel');
        }
    };
    
    // Função para extrair opções de filtro (precisa estar aqui para ter acesso aos dados)
    const extrairOpcoesDeFiltro = (produtosDaFila, todosOsProdutosCadastrados) => {
        const produtos = new Set();
        const cores = new Set();
        const tamanhos = new Set();
        const todosOsProdutosCadastradosComGrade = todosOsProdutosCadastrados.filter(p => p.grade && p.grade.length > 0);

        produtosDaFila.forEach(item => {
            produtos.add(item.produto);
            const produtoInfo = todosOsProdutosCadastradosComGrade.find(p => p.id === item.produto_id);
            if (produtoInfo) {
                const gradeInfo = produtoInfo.grade.find(g => g.variacao === item.variante);
                if (gradeInfo) {
                    const partes = gradeInfo.variacao.split('|').map(p => p.trim());
                    partes.forEach(parte => {
                        if (['P', 'M', 'G', 'GG', 'U', 'UN'].includes(parte.toUpperCase())) {
                            tamanhos.add(parte);
                        } else if (parte && parte !== '-') {
                            const subCores = parte.split(/ com | e /i).map(c => c.trim());
                            subCores.forEach(subCor => cores.add(subCor));
                        }
                    });
                }
            }
        });
        const ordemTamanho = { 'P': 1, 'M': 2, 'G': 3, 'GG': 4, 'UN': 5, 'U': 6 };
        return {
            produtos: Array.from(produtos).sort(),
            cores: Array.from(cores).sort(),
            tamanhos: Array.from(tamanhos).sort((a, b) => (ordemTamanho[a.toUpperCase()] || 99) - (ordemTamanho[b.toUpperCase()] || 99)),
        };
    }

    if (carregando) {
        // Não renderiza nada, pois o loader global já está visível
        return null;
    }

    if (erro) {
        return <p style={{ textAlign: 'center', color: 'red' }}>Erro ao carregar: {erro}</p>;
    }

    return (
        <>
            {/* TÍTULO DA SEÇÃO */}
            <h3 className="ep-secao-titulo">Painel de Embalagens</h3>

            {/* LINHA DIVISÓRIA */}
            <hr className="ep-secao-divisor" />

            {/* O LAYOUT DE 2 COLUNAS VEM LOGO ABAIXO */}
            <div className="ep-layout-principal">
                <div className="painel-cards-coluna">
                    <div className="gs-container-cards">
                        {itensDaPagina.length > 0 ? (
                            itensDaPagina.map(item => (
                                <EmbalagemCard 
                                    key={`${item.produto_id}-${item.variante}`} 
                                    item={item} 
                                    todosOsProdutos={todosOsProdutos}
                                    onClick={handleCardClick}
                                />
                            ))
                        ) : (
                            <UIFeedbackNotFound
                                icon="fa-search"
                                titulo="Nenhum Resultado Encontrado"
                                mensagem="Tente ajustar os termos da sua busca ou limpar os filtros para ver mais produtos."
                            />
                        )}
                    </div>
                    
                    {/* O container da paginação agora usa a ref */}
                    <div ref={paginacaoContainerRef} className="gs-paginacao-container"></div>
                </div>
                
                <div className="painel-filtros-coluna">
                    <EmbalagemPainelFiltros 
                        opcoesDeFiltro={opcoesDeFiltro}
                        filtros={filtros}
                        onFiltrosChange={setFiltros}
                        onAtualizarClick={handleAtualizar}
                        atualizando={atualizando}
                    />
                </div>
            </div>
        </>
    );
}

// --- Ponto de Entrada 1: O Cabeçalho da Página ---
const headerRootElement = document.getElementById('header-root');
if (headerRootElement) {
    const headerRoot = ReactDOM.createRoot(headerRootElement);
    headerRoot.render(
        <UIHeaderPagina titulo="Embalagem">
            <button id="btnAbrirHistoricoGeral" className="gs-btn gs-btn-secundario gs-btn-com-icone">
                <i className="fas fa-history"></i>
                <span>Histórico Geral</span>
            </button>
        </UIHeaderPagina>
    );
}

// Wrapper para o FAB ter acesso ao state de permissões
function PainelComFab() {
    const [permissoes, setPermissoes] = useState([]);
    useEffect(() => {
        verificarAutenticacao('admin/embalagem-de-produtos.html', ['acesso-embalagem-de-produtos']).then(auth => {
            if (auth) setPermissoes(auth.permissoes || []);
        });
    }, []);
    return (
        <React.Fragment>
            <PainelEmbalagem />
            <BotaoBuscaFunil permissoes={permissoes} usarCarregamentoPadrao />
            <AlertasFAB />
        </React.Fragment>
    );
}

// --- Ponto de Entrada 2: O Conteúdo Principal (Cards, Filtros e Botão Flutuante) ---
const painelRootElement = document.getElementById('painel-principal-root');
if (painelRootElement) {
    const painelRoot = ReactDOM.createRoot(painelRootElement);
    painelRoot.render(<PainelComFab />);
}
