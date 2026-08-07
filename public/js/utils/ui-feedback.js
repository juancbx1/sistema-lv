// Renderizador do mesmo feedback visual usado pelo UIFeedbackNotFound em
// scripts legados que ainda manipulam o DOM diretamente.

function escaparHtml(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (caractere) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    })[caractere]);
}

export function htmlUIFeedbackNotFound({
    icon = 'fa-inbox',
    titulo = 'Nenhum resultado encontrado',
    mensagem = 'Não há itens para exibir no momento.',
    variante = 'compacto',
} = {}) {
    const classe = variante === 'compacto'
        ? 'gs-feedback-not-found-container gs-feedback-not-found-container--compacto'
        : 'gs-feedback-not-found-container';

    return `<div class="${classe}" role="status" aria-live="polite" aria-atomic="true">
        <div class="gs-feedback-not-found-icone" aria-hidden="true"><i class="fas ${escaparHtml(icon)}"></i></div>
        <div class="gs-feedback-not-found-conteudo">
            <h4 class="gs-feedback-not-found-titulo">${escaparHtml(titulo)}</h4>
            <p class="gs-feedback-not-found-mensagem">${escaparHtml(mensagem)}</p>
        </div>
    </div>`;
}
