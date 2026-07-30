export interface MenuEmpresa {
  id: number;
  codigo?: string | null;
  nome_fantasia?: string | null;
  razao_social?: string | null;
  logo_url?: string | null;
  cor_identificacao?: string | null;
  timezone?: string | null;
  eh_legada?: boolean;
  empresa_principal?: boolean;
}

export interface MenuUsuario {
  id: number;
  nome: string;
  avatar_url?: string | null;
  permissoes: string[];
  empresa_ativa: MenuEmpresa;
}

export interface MenuContextoEmpresa {
  empresaAtiva: MenuEmpresa;
  empresas: MenuEmpresa[];
  modulosHabilitados: string[];
}

export interface MenuItem {
  id: string;
  rotulo: string;
  href: string;
  icone: string;
  grupo: MenuGrupoId;
  permissao?: string;
  modulo?: string;
  aliases?: string[];
}

export type MenuGrupoId =
  | 'produtividade'
  | 'producao'
  | 'estoque'
  | 'financeiro'
  | 'ferramentas'
  | 'organizacao';

export interface MenuGrupo {
  id: MenuGrupoId;
  rotulo: string;
  icone: string;
}

export interface MenuPreferencias {
  favoritos: string[];
  personalizado: boolean;
  changelogVersaoLida: string | null;
  persistenciaDisponivel: boolean;
}

export interface MenuSessao {
  token: string | null;
  tokenKey: 'token' | 'impersonation_token';
  storage: Storage;
}

export type MenuTransicaoEmpresaFase =
  | 'processando'
  | 'recarregando'
  | 'concluindo';

export interface MenuTransicaoEmpresaEstado {
  origem: MenuEmpresa;
  destino: MenuEmpresa;
  fase: MenuTransicaoEmpresaFase;
}
