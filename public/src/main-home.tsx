import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
// @ts-expect-error utilitário JS compartilhado entre páginas, mantido fora da migração da Home
import { verificarAutenticacao } from '/js/utils/auth.js';
import AlertasFAB from './components/AlertasFAB.jsx';
import HOMECommandPalette from './components/HOMECommandPalette';
import HOMEFocus from './components/HOMEFocus';
import HOMEHeader from './components/HOMEHeader';
import HOMENews from './components/HOMENews';
import HOMERecents from './components/HOMERecents';
import HOMERecommendations from './components/HOMERecommendations';
import UICarregando from './components/UICarregando';
import { mostrarPopupPaginaBloqueada } from './utils/bloqueio';
import useHomeWorkspace from './hooks/useHomeWorkspace';
import useMenuPreferencias from './hooks/useMenuPreferencias';
import { MENU_ITENS, menuItemTemPermissao } from './utils/menu-catalogo';
import type { MenuItem } from './utils/menu-types';
import type { HomeAuthResult, HomeContexto, HomeRecomendacao, HomeUsuario } from './utils/home-types';
import removerCarregamentoInicial from './utils/remover-carregamento-inicial';

function obterToken() {
  return sessionStorage.getItem('impersonation_token') || localStorage.getItem('token');
}

function criarRecomendacoes(itens: MenuItem[]): HomeRecomendacao[] {
  const hora = new Date().getHours();
  const configuracao = hora < 12
    ? [
      ['ordens-producao', 'Comece o dia conferindo prioridades e fluxo de OPs.'],
      ['calendario', 'Veja os compromissos e eventos previstos para hoje.'],
      ['gerenciar-producao', 'Organize as primeiras atividades do time.'],
    ]
    : hora < 18
      ? [
        ['producao-geral', 'Acompanhe o ritmo acumulado ao longo do dia.'],
        ['estoque', 'Confira saldos antes das próximas movimentações.'],
        ['financeiro', 'Revise lançamentos e pendências do período.'],
      ]
      : [
        ['producao-geral', 'Feche o dia com uma leitura dos resultados.'],
        ['financeiro', 'Confira o que ficou agendado ou pendente.'],
        ['central-pagamentos', 'Antecipe a conferência dos próximos pagamentos.'],
      ];

  return configuracao
    .map(([id, motivo]) => {
      const item = itens.find((entrada) => entrada.id === id);
      return item ? { item, motivo } : null;
    })
    .filter((entrada): entrada is HomeRecomendacao => Boolean(entrada));
}

function App() {
  const token = useMemo(obterToken, []);
  const [usuario, setUsuario] = useState<HomeUsuario | null>(null);
  const [permissoes, setPermissoes] = useState<string[]>([]);
  const [contexto, setContexto] = useState<HomeContexto | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroContexto, setErroContexto] = useState<string | null>(null);
  const [comandosAbertos, setComandosAbertos] = useState(false);

  const {
    preferencias,
    erro: erroPreferencias,
    marcarChangelogLido,
  } = useMenuPreferencias(token, contexto?.empresaAtiva.id, usuario?.id);

  const {
    focos,
    recentes,
    maxFocos,
    adicionarFoco,
    alternarFoco,
    removerFoco,
    registrarAcesso,
  } = useHomeWorkspace(usuario?.id, contexto?.empresaAtiva.id);

  useEffect(() => {
    let ativo = true;

    async function iniciar() {
      try {
        const auth = await verificarAutenticacao('home.html', []) as HomeAuthResult | null | false;
        if (!auth || !ativo) return;

        setUsuario(auth.usuario);
        setPermissoes(auth.permissoes || auth.usuario.permissoes || []);

        if (!token) throw new Error('Sessão não encontrada. Entre novamente.');
        const response = await fetch('/api/contexto-empresa', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const dados = await response.json().catch(() => ({})) as HomeContexto & { error?: string };
        if (!response.ok) throw new Error(dados.error || 'Não foi possível carregar a empresa ativa.');
        if (ativo) setContexto(dados);
      } catch (error) {
        if (!ativo) return;
        setErroContexto(error instanceof Error ? error.message : 'Não foi possível preparar a Home.');
      } finally {
        if (ativo) {
          removerCarregamentoInicial();
          setCarregando(false);
        }
      }
    }

    void iniciar();
    return () => {
      ativo = false;
    };
  }, [token]);

  const itensDisponiveis = useMemo<MenuItem[]>(() => {
    if (!contexto) return [];
    const permissoesSet = new Set(permissoes);
    const modulosSet = new Set(contexto.modulosHabilitados || []);
    return MENU_ITENS.map((item) => {
      const permitido = menuItemTemPermissao(item, permissoesSet);
      const moduloDisponivel = !item.modulo || modulosSet.has(item.modulo);
      const motivoBloqueio: MenuItem['motivoBloqueio'] = !moduloDisponivel
        ? 'modulo'
        : !permitido
          ? 'permissao'
          : undefined;
      return {
        ...item,
        bloqueado: Boolean(motivoBloqueio),
        motivoBloqueio,
      };
    });
  }, [contexto, permissoes]);

  const itensRecentes = useMemo(
    () => recentes
      .map((recente) => itensDisponiveis.find((item) => item.id === recente.itemId))
      .filter((item): item is MenuItem => Boolean(item)),
    [itensDisponiveis, recentes],
  );
  const recomendacoes = useMemo(() => criarRecomendacoes(itensDisponiveis), [itensDisponiveis]);

  const abrirItem = useCallback((item: MenuItem) => {
    if (item.bloqueado) {
      mostrarPopupPaginaBloqueada(
        item.rotulo,
        item.motivoBloqueio === 'modulo'
          ? 'Este módulo ainda não está disponível para a empresa ativa.'
          : `Seu vínculo atual não possui acesso à página ${item.rotulo}.`,
      );
      return;
    }
    registrarAcesso(item.id);
    window.location.href = item.href;
  }, [registrarAcesso]);

  useEffect(() => {
    const abrirBusca = (event: KeyboardEvent) => {
      const alvo = event.target as HTMLElement | null;
      const digitando = alvo?.tagName === 'INPUT' || alvo?.tagName === 'TEXTAREA' || alvo?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase('pt-BR') === 'k') {
        event.preventDefault();
        setComandosAbertos(true);
      } else if (event.key === '/' && !digitando) {
        event.preventDefault();
        setComandosAbertos(true);
      }
    };
    window.addEventListener('keydown', abrirBusca);
    return () => window.removeEventListener('keydown', abrirBusca);
  }, []);

  if (carregando || !usuario) {
    return <UICarregando variante="pagina" texto="Preparando seu espaço de trabalho..." />;
  }

  const empresa = contexto?.empresaAtiva || usuario.empresa_ativa;

  return (
    <>
      <main className="home-page-shell">
        <HOMEHeader
          usuario={usuario}
          empresa={empresa}
          quantidadeFerramentas={itensDisponiveis.filter((item) => !item.bloqueado).length}
          onAbrirComandos={() => setComandosAbertos(true)}
          onIrParaNovidades={() => document.getElementById('home-novidades')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        />

        {(erroContexto || erroPreferencias) && (
          <div className="home-inline-alert" role="alert">
            <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
            <span>{erroContexto || erroPreferencias}</span>
          </div>
        )}

        <HOMERecommendations recomendacoes={recomendacoes} onAbrir={abrirItem} />

        <section className="home-overview-grid" aria-label="Resumo pessoal">
          <HOMENews
            versaoLida={preferencias.changelogVersaoLida}
            onMarcarLida={(versao) => void marcarChangelogLido(versao)}
          />
          <HOMEFocus
            itens={focos}
            maximo={maxFocos}
            onAdicionar={adicionarFoco}
            onAlternar={alternarFoco}
            onRemover={removerFoco}
          />
          <HOMERecents itens={itensRecentes} onAbrir={abrirItem} />
        </section>
      </main>

      <HOMECommandPalette
        aberto={comandosAbertos}
        itens={itensDisponiveis}
        recentes={itensRecentes}
        onFechar={() => setComandosAbertos(false)}
        onAbrir={abrirItem}
      />
      <AlertasFAB />
    </>
  );
}

const rootElement = document.getElementById('home-react-root');
if (rootElement) createRoot(rootElement).render(<App />);
