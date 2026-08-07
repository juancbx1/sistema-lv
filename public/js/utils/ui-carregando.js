// Markup compartilhado do UICarregando para os módulos legados que ainda
// renderizam diretamente com innerHTML. A aparência continua sendo definida
// pelas classes .ui-cg-* do global-style.css.

function escaparHtml(valor) {
    return String(valor)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function obterIdentidadeEmpresa() {
    const identidade = window.LVEmpresaCarregamento?.obterIdentidade?.();
    if (identidade) return identidade;

    return {
        iniciais: 'LV',
        cor: '#2563eb',
        contraste: '#ffffff',
    };
}

export function htmlUICarregando({ variante = 'bloco', tamanho, texto } = {}) {
    const identidade = obterIdentidadeEmpresa();
    const tamanhoFinal = tamanho || (variante === 'pagina' ? 'lg' : variante === 'inline' ? 'sm' : 'md');
    const textoFinal = texto || (variante === 'pagina' ? 'Organizando seu ambiente...' : '');
    const inline = variante === 'inline';
    const partesSpinner = inline
        ? '<span class="ui-cg-pontos" aria-hidden="true"><span></span><span></span><span></span></span>'
        : `
            <span class="ui-cg-nucleo-halo" aria-hidden="true"></span>
            <span class="ui-cg-orbita ui-cg-orbita--interna" aria-hidden="true">
                <i class="ui-cg-no ui-cg-no--a"></i>
                <i class="ui-cg-no ui-cg-no--b"></i>
            </span>
            <span class="ui-cg-orbita ui-cg-orbita--externa" aria-hidden="true">
                <i class="ui-cg-no ui-cg-no--c"></i>
            </span>
            <span class="ui-cg-nucleo-marca" aria-hidden="true">${identidade.iniciais}</span>`;
    const etapas = inline ? '' : '<span class="ui-cg-etapas" aria-hidden="true"><i></i><i></i><i></i></span>';
    const label = escaparHtml(textoFinal || 'Carregando');
    const textoMarkup = !inline && textoFinal
        ? `<span class="ui-cg-texto">${label}</span>`
        : '';

    return `<div class="ui-cg ui-cg--${variante}" role="status" aria-live="polite" aria-label="${label}" style="--ui-cg-empresa-cor:${identidade.cor};--ui-cg-empresa-contraste:${identidade.contraste};">
        <div class="ui-cg-spinner ui-cg-spinner--${tamanhoFinal}">${partesSpinner}</div>
        ${etapas}
        ${textoMarkup}
    </div>`;
}

export function removerCarregamentoInicial() {
    document.getElementById('lv-initial-page-loader')?.remove();
}
