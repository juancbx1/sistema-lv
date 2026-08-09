// Utilitários do padrão de bloqueio visual do sistema.
// Funções puras sem dependência de React — funcionam em qualquer contexto
// (componentes React, entry points, e até no FAB do Agente Encerrador).

import {
    navegarParaAcessoNegado,
    navegarParaAreaInicial,
} from '../../js/utils/acesso-negado.js';

export { navegarParaAcessoNegado, navegarParaAreaInicial };

/**
 * Verifica se o usuário logado tem uma permissão específica.
 * Lê do localStorage (populado pelo auth.js a cada page load).
 */
export function temPermissao(permissao: string | readonly string[]): boolean {
    try {
        const lista = JSON.parse(localStorage.getItem('permissoes') || '[]') as unknown;
        if (!Array.isArray(lista)) return false;
        const exigidas = Array.isArray(permissao) ? permissao : [permissao];
        return exigidas.some((item) => lista.includes(item));
    } catch {
        return false;
    }
}

/**
 * Exibe o popup padrão de "sem permissão" do sistema.
 * Cria o elemento DOM diretamente — não depende de React.
 * Evita múltiplos popups simultâneos (idempotente).
 */
export function mostrarPopupSemPermissao(
    mensagem = 'Você não tem permissão para executar esta ação. Fale com o administrador.',
    opcoes: {
        titulo?: string;
        rotuloBotao?: string;
        pagina?: string;
        bloquearFechamentoExterno?: boolean;
        aoConfirmar?: () => void;
    } = {},
): void {
    // Evita abrir dois popups ao mesmo tempo
    if (document.getElementById('gs-bloqueio-popup')) return;

    const overlay = document.createElement('div');
    overlay.className = 'gs-bloqueio-popup-overlay';

    const popup = document.createElement('div');
    popup.id = 'gs-bloqueio-popup';
    popup.className = `gs-bloqueio-popup${opcoes.bloquearFechamentoExterno ? ' gs-bloqueio-popup--pagina' : ''}`;
    const escaparHtml = (texto: string) => texto
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    const pagina = opcoes.pagina
        ? `<div class="gs-bloqueio-popup-pagina">Página solicitada: <strong>${escaparHtml(opcoes.pagina)}</strong></div>`
        : '';
    popup.innerHTML = `
        <div class="gs-bloqueio-popup-icone"><i class="fas fa-lock"></i></div>
        <div class="gs-bloqueio-popup-titulo">${escaparHtml(opcoes.titulo || 'Acesso restrito')}</div>
        ${pagina}
        <div class="gs-bloqueio-popup-mensagem">${escaparHtml(mensagem)}</div>
        <button class="gs-btn gs-btn-secundario gs-bloqueio-popup-btn">${escaparHtml(opcoes.rotuloBotao || 'Entendi')}</button>
    `;

    const fechar = () => {
        popup.remove();
        overlay.remove();
    };

    popup.querySelector('.gs-bloqueio-popup-btn')?.addEventListener('click', () => {
        fechar();
        opcoes.aoConfirmar?.();
    });
    if (!opcoes.bloquearFechamentoExterno) overlay.addEventListener('click', fechar);

    document.body.appendChild(overlay);
    document.body.appendChild(popup);
    window.setTimeout(() => {
        (popup.querySelector('.gs-bloqueio-popup-btn') as HTMLButtonElement | null)?.focus();
    }, 0);
}

export function mostrarPopupPaginaBloqueada(pagina: string, mensagem: string): void {
    mostrarPopupSemPermissao(mensagem, {
        titulo: 'Acesso à página bloqueado',
        rotuloBotao: 'Voltar para a Home',
        pagina,
        bloquearFechamentoExterno: true,
        aoConfirmar: navegarParaAreaInicial,
    });
}
