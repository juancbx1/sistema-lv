import { useCallback, useEffect, useMemo, useState } from 'react';
import { salvarContextoEmpresaLocal } from '../../js/utils/auth.js';
import type {
  MenuContextoEmpresa,
  MenuEmpresa,
  MenuSessao,
  MenuTransicaoEmpresaEstado,
  MenuUsuario,
} from '../utils/menu-types';

const CHAVE_TRANSICAO_EMPRESA = 'lv_transicao_empresa';
const DURACAO_MINIMA_TRANSICAO_MS = 1250;
const TEMPO_LIMITE_FINANCEIRO_MS = 15000;

function paginaFinanceiroAtiva() {
  return window.location.pathname.endsWith('/admin/financeiro.html');
}

function aguardarFinanceiroPronto() {
  return new Promise<void>((resolve) => {
    let timer = 0;
    const concluir = () => {
      window.clearTimeout(timer);
      window.removeEventListener('lv:financeiro-pronto', concluir);
      resolve();
    };
    timer = window.setTimeout(concluir, TEMPO_LIMITE_FINANCEIRO_MS);
    window.addEventListener('lv:financeiro-pronto', concluir, { once: true });
  });
}

function lerTransicaoPendente(): MenuTransicaoEmpresaEstado | null {
  try {
    const valor = sessionStorage.getItem(CHAVE_TRANSICAO_EMPRESA);
    if (!valor) return null;
    const transicao = JSON.parse(valor) as Omit<MenuTransicaoEmpresaEstado, 'fase'>;
    if (!transicao.origem?.id || !transicao.destino?.id) {
      sessionStorage.removeItem(CHAVE_TRANSICAO_EMPRESA);
      return null;
    }
    return { ...transicao, fase: 'concluindo' };
  } catch {
    sessionStorage.removeItem(CHAVE_TRANSICAO_EMPRESA);
    return null;
  }
}

function obterSessao(): MenuSessao {
  const tokenImpersonacao = sessionStorage.getItem('impersonation_token');
  if (tokenImpersonacao) {
    return {
      token: tokenImpersonacao,
      tokenKey: 'impersonation_token',
      storage: sessionStorage,
    };
  }
  return {
    token: localStorage.getItem('token'),
    tokenKey: 'token',
    storage: localStorage,
  };
}

function limparCachesDaEmpresaAnterior() {
  const chavesExatas = [
    'permissoes',
    'usuarios',
    'usuarios_timestamp',
    'producoes',
    'producoes_timestamp',
    'produtosCadastrados',
    'produtosCadastrados_timestamp',
    'embalarDetalheAtual',
    'ultimoProdutoEditado',
    'meta_diaria_planejada',
    'buscasRecentes',
    'demanda_recentes',
    'op_cortes_recentes',
  ];
  const prefixos = ['historico_busca_', 'radar_buscas_'];

  [localStorage, sessionStorage].forEach((storage) => {
    chavesExatas.forEach((chave) => storage.removeItem(chave));
    Object.keys(storage)
      .filter((chave) => prefixos.some((prefixo) => chave.startsWith(prefixo)))
      .forEach((chave) => storage.removeItem(chave));
  });
  // A identidade antiga será sobrescrita logo abaixo pela nova empresa.
  // Não limpar empresaAtiva aqui: o fallback intermediário faria o loader
  // voltar para LV durante a troca de contexto.
}

export default function useMenuContexto() {
  const [usuario, setUsuario] = useState<MenuUsuario | null>(null);
  const [contexto, setContexto] = useState<MenuContextoEmpresa | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [trocandoPara, setTrocandoPara] = useState<number | null>(null);
  const [transicaoEmpresa, setTransicaoEmpresa] =
    useState<MenuTransicaoEmpresaEstado | null>(lerTransicaoPendente);

  const sessao = useMemo(obterSessao, []);

  useEffect(() => {
    if (transicaoEmpresa?.fase !== 'concluindo') return;
    if (carregando || !contexto) return;
    if (contexto.empresaAtiva.id !== transicaoEmpresa.destino.id) {
      sessionStorage.removeItem(CHAVE_TRANSICAO_EMPRESA);
      setTransicaoEmpresa(null);
      setTrocandoPara(null);
      return;
    }
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem(CHAVE_TRANSICAO_EMPRESA);
      setTransicaoEmpresa(null);
      setTrocandoPara(null);
    }, 1450);
    return () => window.clearTimeout(timer);
  }, [carregando, contexto, transicaoEmpresa]);

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      if (!sessao.token) {
        window.location.href = '/index.html';
        return;
      }

      setCarregando(true);
      setErro(null);
      try {
        const headers = { Authorization: `Bearer ${sessao.token}` };
        const [usuarioResponse, contextoResponse] = await Promise.all([
          fetch('/api/usuarios/me', { headers }),
          fetch('/api/contexto-empresa', { headers }),
        ]);

        if (!usuarioResponse.ok) {
          throw new Error(
            usuarioResponse.status === 401
              ? 'Sessão expirada. Entre novamente.'
              : 'Não foi possível carregar seu perfil.',
          );
        }
        if (!contextoResponse.ok) {
          throw new Error('Não foi possível carregar as empresas disponíveis.');
        }

        const usuarioCarregado = (await usuarioResponse.json()) as MenuUsuario;
        const contextoCarregado = (await contextoResponse.json()) as MenuContextoEmpresa;
        if (!ativo) return;

        setUsuario(usuarioCarregado);
        setContexto(contextoCarregado);
        localStorage.setItem(
          'permissoes',
          JSON.stringify(usuarioCarregado.permissoes || []),
        );
        salvarContextoEmpresaLocal(
          { empresa_ativa: contextoCarregado.empresaAtiva },
          sessao.storage,
        );
        window.dispatchEvent(new CustomEvent('lv:empresa-contexto-carregado', {
          detail: { empresaId: contextoCarregado.empresaAtiva.id },
        }));
      } catch (error) {
        if (!ativo) return;
        sessionStorage.removeItem(CHAVE_TRANSICAO_EMPRESA);
        setTransicaoEmpresa(null);
        setErro(error instanceof Error ? error.message : 'Erro ao carregar o menu.');
      } finally {
        if (ativo) setCarregando(false);
      }
    }

    void carregar();
    return () => {
      ativo = false;
    };
  }, [sessao]);

  const trocarEmpresa = useCallback(
    async (empresa: MenuEmpresa) => {
      if (!sessao.token || !contexto || trocandoPara || empresa.id === contexto.empresaAtiva.id) {
        return;
      }

      const inicioTransicao = performance.now();
      setTrocandoPara(empresa.id);
      setErro(null);
      setTransicaoEmpresa({
        origem: contexto.empresaAtiva,
        destino: empresa,
        fase: 'processando',
      });
      let tokenAtualizado = false;
      try {
        const response = await fetch('/api/contexto-empresa/trocar', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessao.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ empresaId: empresa.id }),
        });
        const resultado = await response.json().catch(() => ({}));
        if (!response.ok || !resultado.token) {
          throw new Error(resultado.error || 'Não foi possível trocar a empresa.');
        }

        limparCachesDaEmpresaAnterior();
        sessao.storage.setItem(sessao.tokenKey, resultado.token);
        sessao.token = resultado.token;
        tokenAtualizado = true;
        salvarContextoEmpresaLocal(
          { empresa_ativa: resultado.empresaAtiva },
          sessao.storage,
        );

        const transicaoPersistida = {
          origem: contexto.empresaAtiva,
          destino: resultado.empresaAtiva || empresa,
        };
        setTransicaoEmpresa({
          ...transicaoPersistida,
          fase: 'recarregando',
        });

        const tempoDecorrido = performance.now() - inicioTransicao;
        const esperaRestante = Math.max(
          180,
          DURACAO_MINIMA_TRANSICAO_MS - tempoDecorrido,
        );

        if (paginaFinanceiroAtiva()) {
          const headers = { Authorization: `Bearer ${resultado.token}` };
          const [usuarioResponse, contextoResponse] = await Promise.all([
            fetch('/api/usuarios/me', { headers }),
            fetch('/api/contexto-empresa', { headers }),
          ]);
          if (!usuarioResponse.ok || !contextoResponse.ok) {
            throw new Error('Não foi possível preparar o novo ambiente financeiro.');
          }

          const usuarioAtualizado = (await usuarioResponse.json()) as MenuUsuario;
          const contextoAtualizado = (await contextoResponse.json()) as MenuContextoEmpresa;
          setUsuario(usuarioAtualizado);
          setContexto(contextoAtualizado);
          localStorage.setItem(
            'permissoes',
            JSON.stringify(usuarioAtualizado.permissoes || []),
          );
          salvarContextoEmpresaLocal(
            { empresa_ativa: contextoAtualizado.empresaAtiva },
            sessao.storage,
          );
          window.dispatchEvent(new CustomEvent('lv:empresa-contexto-carregado', {
            detail: { empresaId: contextoAtualizado.empresaAtiva.id },
          }));

          const financeiroPronto = aguardarFinanceiroPronto();
          window.dispatchEvent(new CustomEvent('lv:empresa-contexto-alterado', {
            detail: { empresaId: contextoAtualizado.empresaAtiva.id },
          }));
          await Promise.all([
            financeiroPronto,
            new Promise((resolve) => window.setTimeout(resolve, esperaRestante)),
          ]);
          setTransicaoEmpresa({
            ...transicaoPersistida,
            fase: 'concluindo',
          });
          return;
        }

        sessionStorage.setItem(
          CHAVE_TRANSICAO_EMPRESA,
          JSON.stringify(transicaoPersistida),
        );
        await new Promise((resolve) => window.setTimeout(resolve, esperaRestante));
        window.location.reload();
      } catch (error) {
        if (tokenAtualizado) {
          window.location.reload();
          return;
        }
        sessionStorage.removeItem(CHAVE_TRANSICAO_EMPRESA);
        setTransicaoEmpresa(null);
        setErro(error instanceof Error ? error.message : 'Erro ao trocar a empresa.');
        setTrocandoPara(null);
      }
    },
    [contexto?.empresaAtiva, sessao, trocandoPara],
  );

  const atualizarAvatar = useCallback((avatarUrl: string | null) => {
    setUsuario((atual) => (atual ? { ...atual, avatar_url: avatarUrl } : atual));
  }, []);

  return {
    usuario,
    contexto,
    carregando,
    erro,
    setErro,
    trocandoPara,
    transicaoEmpresa,
    trocarEmpresa,
    atualizarAvatar,
    sessao,
  };
}
