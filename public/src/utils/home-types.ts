// Tipos da Home administrativa.

export interface HomeUsuario {
    id?: number | string;
    nome?: string | null;
    nome_usuario?: string | null;
    email?: string | null;
    [key: string]: unknown;
}

export interface HomeAuthResult {
    usuario: HomeUsuario;
    permissoes?: string[];
}

export interface HomeAcaoRapida {
    titulo: string;
    link: string;
    icone: string;
    permissao?: string;
}
