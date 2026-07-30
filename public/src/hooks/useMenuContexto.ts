import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  limparContextoEmpresaLocal,
  salvarContextoEmpresaLocal,
} from '../../js/utils/auth.js';
import type {
  MenuContextoEmpresa,
  MenuEmpresa,
  MenuSessao,
  MenuTransicaoEmpresaEstado,
  MenuUsuario,
} from '../utils/menu-types';

const CHAVE_TRANSICAO_EMPRESA = 'lv_transicao_empresa';
const DURACAO_MINIMA_TRANSICAO_MS = 1250;

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
  limparContextoEmpresaLocal();
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
      return;
    }
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem(CHAVE_TRANSICAO_EMPRESA);
      setTransicaoEmpresa(null);
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
        salvarContextoEmpresaLocal(
          { empresa_ativa: resultado.empresaAtiva },
          sessao.storage,
        );

        const transicaoPersistida = {
          origem: contexto.empresaAtiva,
          destino: resultado.empresaAtiva || empresa,
        };
        sessionStorage.setItem(
          CHAVE_TRANSICAO_EMPRESA,
          JSON.stringify(transicaoPersistida),
        );
        setTransicaoEmpresa({
          ...transicaoPersistida,
          fase: 'recarregando',
        });

        const tempoDecorrido = performance.now() - inicioTransicao;
        const esperaRestante = Math.max(
          180,
          DURACAO_MINIMA_TRANSICAO_MS - tempoDecorrido,
        );
        await new Promise((resolve) => window.setTimeout(resolve, esperaRestante));
        window.location.reload();
      } catch (error) {
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
