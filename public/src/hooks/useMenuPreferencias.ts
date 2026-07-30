import { useCallback, useEffect, useRef, useState } from 'react';
import type { MenuPreferencias } from '../utils/menu-types';

const PADRAO: MenuPreferencias = {
  favoritos: [],
  personalizado: false,
  changelogVersaoLida: null,
  persistenciaDisponivel: true,
};

function chaveFavoritosLocal(usuarioId?: number, empresaId?: number) {
  return usuarioId && empresaId
    ? `menu-favoritos:${usuarioId}:${empresaId}`
    : null;
}

function chaveChangelogLocal(usuarioId?: number) {
  return usuarioId ? `menu-changelog:${usuarioId}` : null;
}

function lerJsonLocal<T>(chave: string | null, fallback: T): T {
  if (!chave) return fallback;
  try {
    const valor = localStorage.getItem(chave);
    return valor ? (JSON.parse(valor) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function useMenuPreferencias(
  token: string | null,
  empresaId?: number,
  usuarioId?: number,
) {
  const [preferencias, setPreferencias] = useState<MenuPreferencias>(PADRAO);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const changelogMarcadoRef = useRef<string | null>(null);

  useEffect(() => {
    let ativo = true;
    if (!token || !empresaId) {
      setCarregando(false);
      return;
    }

    async function carregar() {
      setCarregando(true);
      try {
        const response = await fetch('/api/preferencias-menu', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const dados = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(dados.error || 'Falha ao carregar preferências.');
        if (!ativo) return;
        const persistenciaDisponivel = dados.persistenciaDisponivel !== false;
        const favoritosLocais = lerJsonLocal<string[] | null>(
          chaveFavoritosLocal(usuarioId, empresaId),
          null,
        );
        const changelogLocal = lerJsonLocal<string | null>(
          chaveChangelogLocal(usuarioId),
          null,
        );
        setPreferencias({
          favoritos:
            persistenciaDisponivel || favoritosLocais === null
              ? Array.isArray(dados.favoritos) ? dados.favoritos : []
              : favoritosLocais,
          personalizado: persistenciaDisponivel
            ? Boolean(dados.personalizado)
            : favoritosLocais !== null,
          changelogVersaoLida:
            changelogMarcadoRef.current ??
            (persistenciaDisponivel
              ? dados.changelogVersaoLida || null
              : changelogLocal),
          persistenciaDisponivel,
        });
      } catch (error) {
        if (!ativo) return;
        setErro(error instanceof Error ? error.message : 'Preferências indisponíveis.');
        setPreferencias((atual) => ({ ...atual, persistenciaDisponivel: false }));
      } finally {
        if (ativo) setCarregando(false);
      }
    }

    void carregar();
    return () => {
      ativo = false;
    };
  }, [empresaId, token, usuarioId]);

  const salvarFavoritos = useCallback(
    async (favoritos: string[]) => {
      const anterior = preferencias;
      setPreferencias((atual) => ({
        ...atual,
        favoritos,
        personalizado: true,
      }));
      if (!token) return false;
      setErro(null);
      if (!preferencias.persistenciaDisponivel) {
        const chave = chaveFavoritosLocal(usuarioId, empresaId);
        if (chave) localStorage.setItem(chave, JSON.stringify(favoritos));
        return true;
      }

      setSalvando(true);
      try {
        const response = await fetch('/api/preferencias-menu/favoritos', {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ favoritos }),
        });
        const dados = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(dados.error || 'Não foi possível salvar.');
        setPreferencias((atual) => ({
          ...atual,
          persistenciaDisponivel: dados.persistenciaDisponivel !== false,
        }));
        return true;
      } catch (error) {
        setPreferencias(anterior);
        setErro(error instanceof Error ? error.message : 'Não foi possível salvar.');
        return false;
      } finally {
        setSalvando(false);
      }
    },
    [empresaId, preferencias, token, usuarioId],
  );

  const marcarChangelogLido = useCallback(
    async (versao: string) => {
      changelogMarcadoRef.current = versao;
      setPreferencias((atual) => ({ ...atual, changelogVersaoLida: versao }));
      if (!token) return;
      setErro(null);
      if (!preferencias.persistenciaDisponivel) {
        const chave = chaveChangelogLocal(usuarioId);
        if (chave) localStorage.setItem(chave, JSON.stringify(versao));
        return;
      }
      try {
        const response = await fetch('/api/preferencias-menu/changelog', {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ versao }),
        });
        if (!response.ok) throw new Error('Não foi possível marcar as novidades como lidas.');
      } catch (error) {
        setErro(error instanceof Error ? error.message : 'Erro ao salvar leitura.');
      }
    },
    [preferencias.persistenciaDisponivel, token, usuarioId],
  );

  return {
    preferencias,
    carregando,
    salvando,
    erro,
    setErro,
    salvarFavoritos,
    marcarChangelogLido,
  };
}
