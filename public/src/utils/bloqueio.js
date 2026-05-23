// public/src/utils/bloqueio.js
// Utilitários do padrão de bloqueio visual do sistema.
// Funções puras sem dependência de React — funcionam em qualquer contexto
// (componentes React, entry points, e até no FAB do Agente Encerrador).

/**
 * Verifica se o usuário logado tem uma permissão específica.
 * Lê do localStorage (populado pelo auth.js a cada page load).
 *
 * @param {string} permissao - ID da permissão (ex: 'finalizar-op')
 * @returns {boolean}
 */
export function temPermissao(permissao) {
    try {
        const lista = JSON.parse(localStorage.getItem('permissoes') || '[]');
        return lista.includes(permissao);
    } catch {
        return false;
    }
}

/**
 * Exibe o popup padrão de "sem permissão" do sistema.
 * Cria o elemento DOM diretamente — não depende de React.
 * Evita múltiplos popups simultâneos (idempotente).
 *
 * @param {string} [mensagem] - Mensagem customizada (opcional)
 */
export function mostrarPopupSemPermissao(mensagem = 'Você não tem permissão para executar esta ação. Fale com o administrador.') {
    // Evita abrir dois popups ao mesmo tempo
    if (document.getElementById('gs-bloqueio-popup')) return;

    const overlay = document.createElement('div');
    overlay.className = 'gs-bloqueio-popup-overlay';

    const popup = document.createElement('div');
    popup.id = 'gs-bloqueio-popup';
    popup.className = 'gs-bloqueio-popup';
    popup.innerHTML = `
        <div class="gs-bloqueio-popup-icone"><i class="fas fa-lock"></i></div>
        <div class="gs-bloqueio-popup-titulo">Acesso restrito</div>
        <div class="gs-bloqueio-popup-mensagem">${mensagem}</div>
        <button class="gs-btn gs-btn-secundario gs-bloqueio-popup-btn">Entendi</button>
    `;

    const fechar = () => {
        popup.remove();
        overlay.remove();
    };

    popup.querySelector('.gs-bloqueio-popup-btn').addEventListener('click', fechar);
    overlay.addEventListener('click', fechar);

    document.body.appendChild(overlay);
    document.body.appendChild(popup);
}
