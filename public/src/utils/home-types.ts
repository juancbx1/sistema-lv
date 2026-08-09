import type { MenuEmpresa, MenuItem } from './menu-types';

export interface HomeUsuario {
  id: number;
  nome?: string | null;
  nome_usuario?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  permissoes?: string[];
  empresa_ativa?: MenuEmpresa;
  [key: string]: unknown;
}

export interface HomeAuthResult {
  usuario: HomeUsuario;
  permissoes?: string[];
}

export interface HomeContexto {
  empresaAtiva: MenuEmpresa;
  modulosHabilitados: string[];
}

export interface HomeFocoItem {
  id: string;
  texto: string;
  concluido: boolean;
  criadoEm: string;
}

export interface HomeRecente {
  itemId: string;
  acessadoEm: string;
}

export interface HomeWorkspace {
  focos: HomeFocoItem[];
  recentes: HomeRecente[];
}

export interface HomeRecomendacao {
  item: MenuItem;
  motivo: string;
}

export interface HomeChangelogEntrada {
  versao: string;
  data?: string;
  admin?: string[];
}
