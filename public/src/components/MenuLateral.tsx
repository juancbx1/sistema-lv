import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { logout } from '../../js/utils/auth.js';
import useMenuContexto from '../hooks/useMenuContexto';
import useMenuPreferencias from '../hooks/useMenuPreferencias';
import {
  MENU_FAVORITOS_PADRAO,
  MENU_ITENS,
  itemMenuEstaAtivo,
} from '../utils/menu-catalogo';
import MenuConfirmacao from './MenuConfirmacao';
import MenuEmpresaAtiva from './MenuEmpresaAtiva';
import MenuEmpresaSeletor from './MenuEmpresaSeletor';
import MenuFavoritos from './MenuFavoritos';
import MenuModulos from './MenuModulos';
import MenuNovidades, { contarNovidadesNaoLidas } from './MenuNovidades';
import MenuTransicaoEmpresa from './MenuTransicaoEmpresa';
import MenuUsuario from './MenuUsuario';
import PerfilAvatarStudio from './PerfilAvatarStudio';
import UICarregando from './UICarregando';

export default function MenuLateral() {
  const {
    usuario,
    contexto,
    carregando,
    erro: erroContexto,
    setErro: setErroContexto,
    trocandoPara,
    transicaoEmpresa,
    trocarEmpresa,
    atualizarAvatar,
    sessao,
  } = useMenuContexto();
  const {
    preferencias,
    carregando: carregandoPreferencias,
    salvando,
    erro: erroPreferencias,
    setErro: setErroPreferencias,
    salvarFavoritos,
    marcarChangelogLido,
  } = useMenuPreferencias(
    sessao.token,
    contexto?.empresaAtiva.id,
    usuario?.id,
  );

  const [menuAberto, setMenuAberto] = useState(false);
  const [seletorEmpresaAberto, setSeletorEmpresaAberto] = useState(false);
  const [avatarAberto, setAvatarAberto] = useState(false);
  const [novidadesAberto, setNovidadesAberto] = useState(false);
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const [organizando, setOrganizando] = useState(false);
  const [mostrarTodosFavoritos, setMostrarTodosFavoritos] = useState(false);

  useEffect(() => {
    const hamburger = document.querySelector<HTMLElement>('.hamburger-menu');
    if (!hamburger) return;
    hamburger.innerHTML =
      '<i class="fa-solid fa-bars" aria-hidden="true"></i><i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    hamburger.setAttribute('role', 'button');
    hamburger.setAttribute('tabindex', '0');
    hamburger.setAttribute('aria-label', 'Abrir menu de navegação');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.classList.remove('loading');

    const alternar = () => {
      setMenuAberto((aberto) => !aberto);
    };
    const teclado = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        alternar();
      }
    };
    hamburger.addEventListener('click', alternar);
    hamburger.addEventListener('keydown', teclado);
    return () => {
      hamburger.removeEventListener('click', alternar);
      hamburger.removeEventListener('keydown', teclado);
    };
  }, []);

  useEffect(() => {
    const hamburger = document.querySelector<HTMLElement>('.hamburger-menu');
    hamburger?.classList.toggle('active', menuAberto);
    hamburger?.setAttribute('aria-expanded', String(menuAberto));
    hamburger?.setAttribute(
      'aria-label',
      menuAberto ? 'Fechar menu de navegação' : 'Abrir menu de navegação',
    );
    document.body.classList.toggle('ml-menu-open', menuAberto);
    return () => document.body.classList.remove('ml-menu-open');
  }, [menuAberto]);

  useEffect(() => {
    if (!menuAberto) return;
    const fecharFora = (event: MouseEvent) => {
      if (window.innerWidth > 1024) return;
      const alvo = event.target as Node;
      const menu = document.querySelector('.ml-menu-lateral');
      const hamburger = document.querySelector('.hamburger-menu');
      if (!menu?.contains(alvo) && !hamburger?.contains(alvo)) setMenuAberto(false);
    };
    const fecharEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuAberto(false);
    };
    document.addEventListener('mousedown', fecharFora);
    document.addEventListener('keydown', fecharEscape);
    return () => {
      document.removeEventListener('mousedown', fecharFora);
      document.removeEventListener('keydown', fecharEscape);
    };
  }, [menuAberto]);

  const itensDisponiveis = useMemo(() => {
    if (!usuario || !contexto) return [];
    const permissoes = new Set(usuario.permissoes || []);
    const modulos = new Set(contexto.modulosHabilitados || []);
    return MENU_ITENS.filter((item) => {
      const permitido = !item.permissao || permissoes.has(item.permissao);
      const moduloDisponivel = !item.modulo || modulos.has(item.modulo);
      return permitido && moduloDisponivel;
    });
  }, [contexto, usuario]);

  const moduloAtualIndisponivel = useMemo(() => {
    if (!contexto) return false;
    const itemAtual = MENU_ITENS.find((item) => itemMenuEstaAtivo(item));
    if (!itemAtual?.modulo) return false;
    return !new Set(contexto.modulosHabilitados || []).has(itemAtual.modulo);
  }, [contexto]);

  const favoritosBase = useMemo(
    () =>
      preferencias.personalizado
      ? preferencias.favoritos
      : MENU_FAVORITOS_PADRAO,
    [preferencias.favoritos, preferencias.personalizado],
  );

  const favoritosIds = useMemo(() => {
    const permitidos = new Set(itensDisponiveis.map((item) => item.id));
    return favoritosBase.filter((id) => permitidos.has(id));
  }, [favoritosBase, itensDisponiveis]);

  const favoritos = useMemo(
    () =>
      favoritosIds
        .map((id) => itensDisponiveis.find((item) => item.id === id))
        .filter((item): item is (typeof itensDisponiveis)[number] => Boolean(item)),
    [favoritosIds, itensDisponiveis],
  );

  const atualizarFavoritos = async (proximos: string[]) => {
    await salvarFavoritos(proximos);
  };

  const toggleFavorito = (id: string) => {
    const proximos = favoritosBase.includes(id)
      ? favoritosBase.filter((favoritoId) => favoritoId !== id)
      : [...favoritosBase, id];
    void atualizarFavoritos(proximos);
  };

  const salvarOrdemVisivel = (visiveis: string[]) => {
    const visiveisSet = new Set(favoritosIds);
    const ocultos = favoritosBase.filter((id) => !visiveisSet.has(id));
    void atualizarFavoritos([...visiveis, ...ocultos]);
  };

  const moverFavorito = (id: string, direcao: -1 | 1) => {
    const indice = favoritosIds.indexOf(id);
    const destino = indice + direcao;
    if (indice < 0 || destino < 0 || destino >= favoritosIds.length) return;
    const proximos = [...favoritosIds];
    [proximos[indice], proximos[destino]] = [proximos[destino], proximos[indice]];
    salvarOrdemVisivel(proximos);
  };

  const soltarFavorito = (origemId: string, destinoId: string) => {
    const origem = favoritosIds.indexOf(origemId);
    const destino = favoritosIds.indexOf(destinoId);
    if (origem < 0 || destino < 0) return;
    const proximos = [...favoritosIds];
    const [movido] = proximos.splice(origem, 1);
    proximos.splice(destino, 0, movido);
    salvarOrdemVisivel(proximos);
  };

  const erroModuloAtual = moduloAtualIndisponivel
    ? 'Este módulo ainda não está disponível para a empresa ativa.'
    : null;
  const erro = erroModuloAtual || erroContexto || erroPreferencias;
  const novidadesNaoLidas = contarNovidadesNaoLidas(
    preferencias.changelogVersaoLida,
  );

  if (carregando || !usuario || !contexto) {
    return (
      <>
        <aside className="ml-menu-lateral ml-menu-loading" aria-label="Carregando menu">
          <div className="ml-loading-content">
            <UICarregando variante="inline" />
          <span>{erroContexto || 'Preparando seu espaço...'}</span>
          </div>
        </aside>
        <MenuTransicaoEmpresa transicao={transicaoEmpresa} />
      </>
    );
  }

  return (
    <>
      <aside
        className={`ml-menu-lateral${menuAberto ? ' active' : ''}`}
        aria-label="Menu principal"
      >
        <MenuUsuario
          usuario={usuario}
          onAvatar={() => setAvatarAberto(true)}
          onLogout={() => setConfirmarSaida(true)}
        />

        <div className="ml-company-area">
          <MenuEmpresaAtiva
            empresa={contexto.empresaAtiva}
            onClick={() => setSeletorEmpresaAberto(true)}
          />
        </div>

        {erro && (
          <div className="ml-inline-alert" role="alert">
            <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
            <span>{erro}</span>
            {!erroModuloAtual && (
              <button
                type="button"
                aria-label="Fechar aviso"
                onClick={() => {
                  setErroContexto(null);
                  setErroPreferencias(null);
                }}
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        <nav
          className="ml-nav"
          aria-label="Áreas administrativas"
          onClick={(event) => {
            if (
              window.innerWidth <= 1024 &&
              (event.target as HTMLElement).closest('a')
            ) {
              setMenuAberto(false);
            }
          }}
        >
          <MenuFavoritos
            itens={favoritos}
            organizando={organizando}
            salvando={salvando || carregandoPreferencias}
            mostrarTodos={mostrarTodosFavoritos}
            onMostrarTodos={() => setMostrarTodosFavoritos((valor) => !valor)}
            onOrganizar={() => setOrganizando((valor) => !valor)}
            onRemover={toggleFavorito}
            onMove={moverFavorito}
            onDrop={soltarFavorito}
          />
          <MenuModulos
            itens={itensDisponiveis}
            favoritos={favoritosIds}
            desabilitado={carregandoPreferencias || salvando}
            onToggleFavorito={toggleFavorito}
          />
        </nav>

        <footer className="ml-footer">
          <button
            className="ml-news-trigger"
            type="button"
            onClick={() => setNovidadesAberto(true)}
          >
            <span className="ml-news-icon" aria-hidden="true">
              <i className="fa-solid fa-rocket" />
            </span>
            <span>
              <strong>Novidades do sistema</strong>
              <small>Versão {__APP_VERSION__}</small>
            </span>
            {novidadesNaoLidas > 0 && (
              <span className="ml-news-badge" aria-label={`${novidadesNaoLidas} novidades não lidas`}>
                {novidadesNaoLidas}
              </span>
            )}
          </button>
          <div className="ml-footer-actions">
            <button
              type="button"
              onClick={() => {
                setOrganizando(true);
                document.querySelector('.ml-favorites-section')?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                });
              }}
            >
              <i className="fa-solid fa-sliders" aria-hidden="true" />
              Preferências
            </button>
            <button type="button" onClick={() => setConfirmarSaida(true)}>
              <i className="fa-solid fa-arrow-right-from-bracket" aria-hidden="true" />
              Sair
            </button>
          </div>
          {!preferencias.persistenciaDisponivel && !carregandoPreferencias && (
            <small className="ml-persistence-warning">
              Preferências salvas somente neste dispositivo até a migration.
            </small>
          )}
        </footer>
      </aside>

      {createPortal(
        <MenuEmpresaAtiva
          empresa={contexto.empresaAtiva}
          compacto
          menuAberto={menuAberto}
          onClick={() => setSeletorEmpresaAberto(true)}
        />,
        document.body,
      )}

      <MenuEmpresaSeletor
        aberto={seletorEmpresaAberto}
        empresas={contexto.empresas}
        empresaAtiva={contexto.empresaAtiva}
        trocandoPara={trocandoPara}
        onClose={() => setSeletorEmpresaAberto(false)}
        onSelect={(empresa) => {
          setSeletorEmpresaAberto(false);
          void trocarEmpresa(empresa);
        }}
      />

      <PerfilAvatarStudio
        isOpen={avatarAberto}
        token={sessao.token}
        nomeUsuario={usuario.nome}
        onClose={() => setAvatarAberto(false)}
        onAvatarChanged={atualizarAvatar}
      />

      <MenuNovidades
        aberto={novidadesAberto}
        versaoAtual={__APP_VERSION__}
        versaoLida={preferencias.changelogVersaoLida}
        onClose={() => setNovidadesAberto(false)}
        onMarcarLido={(versao) => void marcarChangelogLido(versao)}
      />

      <MenuConfirmacao
        aberto={confirmarSaida}
        titulo="Sair do sistema?"
        mensagem="Sua sessão será encerrada neste dispositivo."
        confirmarLabel="Sim, sair"
        onClose={() => setConfirmarSaida(false)}
        onConfirm={logout}
      />

      <MenuTransicaoEmpresa transicao={transicaoEmpresa} />
    </>
  );
}
