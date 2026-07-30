import { useEffect, useRef, useState } from 'react';
import type { MenuUsuario } from '../utils/menu-types';

interface Props {
  usuario: MenuUsuario;
  onAvatar: () => void;
  onLogout: () => void;
}

function obterIniciais(nome: string) {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join('')
    .toUpperCase();
}

export default function MenuUsuario({ usuario, onAvatar, onLogout }: Props) {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fecharFora = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fecharFora);
    return () => document.removeEventListener('mousedown', fecharFora);
  }, [aberto]);

  return (
    <div className="ml-user-row" ref={containerRef}>
      <button
        className="ml-avatar-trigger"
        type="button"
        onClick={onAvatar}
        aria-label="Editar foto de perfil"
      >
        <span className="ml-avatar-media">
          {usuario.avatar_url ? (
            <img src={usuario.avatar_url} alt="" />
          ) : (
            <span>{obterIniciais(usuario.nome)}</span>
          )}
        </span>
        <span className="ml-avatar-edit" aria-hidden="true">
          <i className="fa-solid fa-camera" />
        </span>
      </button>
      <span className="ml-user-copy">
        <strong>{usuario.nome || 'Usuário'}</strong>
        <small>Minha conta</small>
      </span>
      <button
        className="ml-icon-button ml-user-more"
        type="button"
        aria-label="Opções da conta"
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((valor) => !valor)}
      >
        <i className="fa-solid fa-ellipsis" aria-hidden="true" />
      </button>

      {aberto && (
        <div className="ml-account-popover" role="menu">
          <button type="button" role="menuitem" onClick={onAvatar}>
            <i className="fa-solid fa-camera" aria-hidden="true" />
            Gerenciar foto
          </button>
          <button type="button" role="menuitem" onClick={onLogout}>
            <i className="fa-solid fa-arrow-right-from-bracket" aria-hidden="true" />
            Sair do sistema
          </button>
        </div>
      )}
    </div>
  );
}
