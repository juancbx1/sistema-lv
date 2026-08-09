// Contexto compartilhado da tela de acesso negado.
// Não armazena dados da página protegida; apenas informações necessárias para
// explicar o bloqueio ao usuário na tela pública de erro de autorização.

export const CHAVE_CONTEXTO_ACESSO_NEGADO = 'lv:acesso-negado';

function normalizarLista(valor) {
    return Array.isArray(valor)
        ? valor.filter((item) => typeof item === 'string' && item.trim())
        : [];
}

export function salvarContextoAcessoNegado(contexto = {}) {
    try {
        sessionStorage.setItem(CHAVE_CONTEXTO_ACESSO_NEGADO, JSON.stringify({
            pagina: typeof contexto.pagina === 'string' ? contexto.pagina : '',
            permissoes: normalizarLista(contexto.permissoes),
            motivo: contexto.motivo === 'modulo' ? 'modulo' : 'permissao',
            mensagem: typeof contexto.mensagem === 'string' ? contexto.mensagem : '',
        }));
    } catch {
        // A tela continua funcional mesmo quando o armazenamento da sessão
        // estiver indisponível ou bloqueado pelo navegador.
    }
}

export function lerContextoAcessoNegado() {
    try {
        const bruto = sessionStorage.getItem(CHAVE_CONTEXTO_ACESSO_NEGADO);
        if (!bruto) return null;
        const contexto = JSON.parse(bruto);
        if (!contexto || typeof contexto !== 'object') return null;
        return {
            pagina: typeof contexto.pagina === 'string' ? contexto.pagina : '',
            permissoes: normalizarLista(contexto.permissoes),
            motivo: contexto.motivo === 'modulo' ? 'modulo' : 'permissao',
            mensagem: typeof contexto.mensagem === 'string' ? contexto.mensagem : '',
        };
    } catch {
        return null;
    }
}

export function limparContextoAcessoNegado() {
    try {
        sessionStorage.removeItem(CHAVE_CONTEXTO_ACESSO_NEGADO);
    } catch {
        // Sem ação adicional necessária.
    }
}

export function obterDestinoAreaInicial() {
    try {
        const permissoes = JSON.parse(localStorage.getItem('permissoes') || '[]');
        if (
            Array.isArray(permissoes) &&
            permissoes.includes('acesso-dashboard') &&
            !permissoes.includes('acesso-admin-geral')
        ) {
            return '/dashboard/dashboard.html';
        }
    } catch {
        // Fallback seguro para a area administrativa.
    }
    return '/admin/home.html';
}

export function navegarParaAreaInicial() {
    window.location.assign(obterDestinoAreaInicial());
}

export function navegarParaAcessoNegado(contexto = {}) {
    salvarContextoAcessoNegado(contexto);
    if (window.location.pathname !== '/admin/acesso-negado.html') {
        window.location.assign('/admin/acesso-negado.html');
    }
}
