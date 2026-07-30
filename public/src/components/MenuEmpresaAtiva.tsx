import type { MenuEmpresa } from '../utils/menu-types';
import { obterIniciais, obterNome } from './MenuEmpresaSeletor';

interface Props {
  empresa: MenuEmpresa;
  compacto?: boolean;
  menuAberto?: boolean;
  onClick: () => void;
}

export default function MenuEmpresaAtiva({
  empresa,
  compacto = false,
  menuAberto = false,
  onClick,
}: Props) {
  const cor = empresa.cor_identificacao || '#2563eb';
  return (
    <button
      className={`${compacto ? 'ml-company-compact' : 'ml-company-trigger'}${
        menuAberto ? ' is-menu-open' : ''
      }`}
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={`Empresa ativa: ${obterNome(empresa)}. Trocar empresa`}
      style={{ '--ml-empresa-cor': cor } as React.CSSProperties}
    >
      <span className="ml-company-brand" aria-hidden="true">
        {empresa.logo_url ? (
          <img src={empresa.logo_url} alt="" />
        ) : (
          <span>{obterIniciais(empresa)}</span>
        )}
      </span>
      <span className="ml-company-copy">
        <small>{compacto ? 'Empresa' : 'Empresa ativa'}</small>
        <strong>{obterNome(empresa)}</strong>
      </span>
      <span className="ml-company-change-icon" aria-hidden="true">
        <i className="fa-solid fa-arrows-rotate" />
      </span>
    </button>
  );
}
