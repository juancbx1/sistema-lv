// Tipos de domínio da Gestão Organizacional.

export type GOEscopo = 'atual' | 'global';
export type GOAba = 'pessoas' | 'empresas' | 'auditoria';

export type GOTipoVinculo =
    | 'administrador'
    | 'supervisor'
    | 'lider_setor'
    | 'costureira'
    | 'tiktik'
    | 'cortador'
    | 'socio'
    | 'ex_socio'
    | 'prestador_externo'
    | string;

export interface GODiasTrabalho {
    '0'?: boolean;
    '1'?: boolean;
    '2'?: boolean;
    '3'?: boolean;
    '4'?: boolean;
    '5'?: boolean;
    '6'?: boolean;
    [dia: string]: boolean | undefined;
}

export interface GOEmpresa {
    id: number;
    codigo: string;
    razao_social?: string | null;
    nome_fantasia: string;
    cnpj?: string | null;
    logo_url?: string | null;
    cor_identificacao?: string | null;
    telefone?: string | null;
    email?: string | null;
    cep?: string | null;
    logradouro?: string | null;
    numero_endereco?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
    timezone?: string | null;
    prefixo_op?: string | null;
    numero_inicial_op?: number | string | null;
    ativa?: boolean | null;
    eh_legada?: boolean | null;
    total_membros?: number | null;
    total_gestores?: number | null;
}

export interface GOEmpresaForm extends Omit<GOEmpresa, 'id' | 'nome_fantasia' | 'codigo'> {
    id?: number;
    codigo: string;
    nome_fantasia: string;
    timezone: string;
    numero_inicial_op: number | string;
    ativa: boolean;
    cor_identificacao: string;
}

export interface GOVinculo {
    id: number;
    empresa_id: number;
    empresa_nome?: string | null;
    empresa_codigo?: string | null;
    empresa_cor?: string | null;
    empresa_logo_url?: string | null;
    empresa_ativa?: boolean | null;
    empresa_principal?: boolean | null;
    tipos?: GOTipoVinculo[] | null;
    permissoes?: string[] | null;
    nivel?: number | string | null;
    salario_fixo?: number | string | null;
    valor_passagem_diaria?: number | string | null;
    elegivel_pagamento?: boolean | null;
    desconto_inss_percentual?: number | string | null;
    desconto_vt_percentual?: number | string | null;
    data_admissao?: string | null;
    data_demissao?: string | null;
    is_freelance?: boolean | null;
    ativo?: boolean | null;
    dias_trabalho?: GODiasTrabalho | null;
    horario_entrada_1?: string | null;
    horario_saida_1?: string | null;
    horario_entrada_2?: string | null;
    horario_saida_2?: string | null;
    horario_entrada_3?: string | null;
    horario_saida_3?: string | null;
}

export interface GOPessoa {
    id: number;
    nome: string;
    nome_completo?: string | null;
    nome_usuario: string;
    email: string;
    avatar_url?: string | null;
    vinculos?: GOVinculo[] | null;
}

export interface GOIdentidadeForm {
    nome: string;
    nome_completo: string;
    nome_usuario: string;
    email: string;
    senha: string;
}

export interface GOVinculoForm {
    tipos: GOTipoVinculo[];
    permissoes: string[];
    nivel: number | string;
    salario_fixo: number | string;
    valor_passagem_diaria: number | string;
    elegivel_pagamento: boolean;
    desconto_inss_percentual: number | string;
    desconto_vt_percentual: number | string;
    data_admissao: string;
    data_demissao: string;
    is_freelance: boolean;
    ativo: boolean;
    empresa_principal: boolean;
    dias_trabalho: GODiasTrabalho;
    horario_entrada_1: string;
    horario_saida_1: string;
    horario_entrada_2: string;
    horario_saida_2: string;
    horario_entrada_3: string;
    horario_saida_3: string;
    empresa_id?: number;
    pessoa?: GOIdentidadeForm;
    [key: string]: unknown;
}

export interface GOClassificacaoVinculo {
    socio: boolean;
    prestador: boolean;
    empregado: boolean;
}

export interface GOPermissaoCatalogo {
    id: string;
    label: string;
    categoria: string;
}

export interface GOAuthUsuario {
    empresa_ativa?: { id?: number | null } | null;
}

export interface GOAuthResult {
    usuario: GOAuthUsuario;
    permissoes?: string[];
}

export type GOModalPessoa = Partial<GOPessoa> | Record<string, never>;
export type GOModalEmpresa = Partial<GOEmpresa> | Record<string, never>;

export interface GOModalVinculo {
    pessoa: GOPessoa;
    vinculo: GOVinculo | null;
    focoInicial?: 'permissoes';
}
