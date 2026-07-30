// public/src/components/UICarregando.jsx
// Componente universal de carregamento do sistema LV.
//
// Use para: carregamentos de página, abas e seções de dados.
// NÃO use para: agentes de IA em processamento — use UIAgenteIA.LoaderIA.
//
// Props:
//   variante : 'bloco' (padrão) | 'pagina' | 'inline'
//     - bloco  : centraliza no container pai, ideal para abas e seções
//     - pagina : cobre a tela toda (carregamento inicial da página)
//     - inline : compacto, sem LV, para uso dentro de outros elementos
//   tamanho  : 'sm' | 'md' (padrão) | 'lg' — define o tamanho do spinner
//              (quando omitido: pagina→lg, inline→sm, bloco→md)
//   texto    : string opcional exibida abaixo do spinner
//
// Para trocar o visual sem quebrar o sistema, altere apenas as classes
// CSS começando com `.ui-cg-*` em global-style.css.

import React from 'react';

function obterEmpresaAtiva() {
    const storages = sessionStorage.getItem('impersonation_token')
        ? [sessionStorage, localStorage]
        : [localStorage];
    for (const storage of storages) {
        try {
            const empresa = JSON.parse(storage.getItem('empresaAtiva') || 'null');
            if (empresa?.id) return empresa;
        } catch {
            // Contexto corrompido ou ainda indisponível: usa identidade neutra.
        }
    }
    return null;
}

function obterIniciaisEmpresa(empresa) {
    const nome = empresa?.nome_fantasia || empresa?.razao_social || '';
    const partes = nome.split(/\s+/).filter(Boolean);
    if (!partes.length) return 'LV';
    return partes
        .slice(0, 2)
        .map((parte) => parte[0])
        .join('')
        .toUpperCase();
}

function obterCorEmpresa(empresa) {
    const cor = empresa?.cor_identificacao;
    return typeof cor === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(cor)
        ? cor
        : '#2563eb';
}

function obterContraste(cor) {
    const hex = cor.length === 4
        ? cor.slice(1).split('').map((parte) => parte + parte).join('')
        : cor.slice(1);
    const vermelho = Number.parseInt(hex.slice(0, 2), 16);
    const verde = Number.parseInt(hex.slice(2, 4), 16);
    const azul = Number.parseInt(hex.slice(4, 6), 16);
    const luminosidade = (vermelho * 299 + verde * 587 + azul * 114) / 1000;
    return luminosidade > 168 ? '#0f172a' : '#ffffff';
}

export default function UICarregando({ variante = 'bloco', tamanho, texto }) {
    const tam = tamanho || (variante === 'pagina' ? 'lg' : variante === 'inline' ? 'sm' : 'md');
    const inline = variante === 'inline';
    const textoVisivel = texto || (variante === 'pagina' ? 'Organizando seu ambiente...' : null);
    const empresa = obterEmpresaAtiva();
    const iniciais = obterIniciaisEmpresa(empresa);
    const corEmpresa = obterCorEmpresa(empresa);
    const contraste = obterContraste(corEmpresa);

    return (
        <div
            className={`ui-cg ui-cg--${variante}`}
            role="status"
            aria-live="polite"
            aria-label={texto || 'Carregando'}
            style={{
                '--ui-cg-empresa-cor': corEmpresa,
                '--ui-cg-empresa-contraste': contraste,
            }}
        >
            <div className={`ui-cg-spinner ui-cg-spinner--${tam}`}>
                {inline ? (
                    <span className="ui-cg-pontos" aria-hidden="true">
                        <span></span>
                        <span></span>
                        <span></span>
                    </span>
                ) : (
                    <>
                        <span className="ui-cg-nucleo-halo" aria-hidden="true"></span>
                        <span className="ui-cg-orbita ui-cg-orbita--interna" aria-hidden="true">
                            <i className="ui-cg-no ui-cg-no--a"></i>
                            <i className="ui-cg-no ui-cg-no--b"></i>
                        </span>
                        <span className="ui-cg-orbita ui-cg-orbita--externa" aria-hidden="true">
                            <i className="ui-cg-no ui-cg-no--c"></i>
                        </span>
                        <span className="ui-cg-nucleo-marca" aria-hidden="true">
                            {iniciais}
                        </span>
                    </>
                )}
            </div>
            {!inline && (
                <span className="ui-cg-etapas" aria-hidden="true">
                    <i></i><i></i><i></i>
                </span>
            )}
            {textoVisivel && !inline && (
                <span className="ui-cg-texto">{textoVisivel}</span>
            )}
        </div>
    );
}
