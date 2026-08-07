(function () {
    'use strict';

    const EMPRESA_PADRAO = {
        iniciais: 'LV',
        cor: '#2563eb',
        contraste: '#ffffff',
    };
    const CHAVE_EMPRESA = 'empresaAtiva';
    const estado = { empresa: null };

    function temImpersonacao() {
        try {
            return Boolean(sessionStorage.getItem('impersonation_token'));
        } catch {
            return false;
        }
    }

    function storagesDoContexto() {
        return temImpersonacao()
            ? [sessionStorage, localStorage]
            : [localStorage, sessionStorage];
    }

    function lerEmpresaArmazenada() {
        for (const storage of storagesDoContexto()) {
            try {
                const raw = storage.getItem(CHAVE_EMPRESA);
                if (!raw) continue;
                const empresa = JSON.parse(raw);
                if (empresa && empresa.id) return empresa;
            } catch {
                // Um contexto local corrompido não pode impedir a pintura da página.
            }
        }
        return null;
    }

    function obterEmpresaAtiva() {
        return estado.empresa?.id ? estado.empresa : lerEmpresaArmazenada();
    }

    function obterCor(empresa) {
        const cor = typeof empresa?.cor_identificacao === 'string'
            ? empresa.cor_identificacao.trim()
            : '';
        return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(cor)
            ? cor
            : EMPRESA_PADRAO.cor;
    }

    function obterIniciais(empresa) {
        const nome = empresa?.nome_fantasia || empresa?.razao_social || '';
        const partes = String(nome).split(/\s+/).filter(Boolean);
        if (!partes.length) return EMPRESA_PADRAO.iniciais;
        return partes
            .slice(0, 2)
            .map((parte) => parte[0])
            .join('')
            .toUpperCase();
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

    function obterIdentidade() {
        const empresa = obterEmpresaAtiva();
        const cor = obterCor(empresa);
        return {
            empresa,
            iniciais: obterIniciais(empresa),
            cor,
            contraste: obterContraste(cor),
        };
    }

    function selecionarLoaders(root) {
        if (!root) return [];
        const loaders = [];
        if (root.nodeType === 1 && root.matches?.('.ui-cg')) loaders.push(root);
        loaders.push(...root.querySelectorAll?.('.ui-cg') || []);
        return loaders;
    }

    function definirEstilo(elemento, propriedade, valor) {
        if (elemento.style.getPropertyValue(propriedade) !== valor) {
            elemento.style.setProperty(propriedade, valor);
        }
    }

    function aplicar(root) {
        const identidade = obterIdentidade();
        document.documentElement.dataset.lvEmpresaId = identidade.empresa?.id
            ? String(identidade.empresa.id)
            : '';
        definirEstilo(document.documentElement, '--lv-empresa-cor', identidade.cor);
        definirEstilo(document.documentElement, '--lv-empresa-contraste', identidade.contraste);

        selecionarLoaders(root || document).forEach((loader) => {
            definirEstilo(loader, '--ui-cg-empresa-cor', identidade.cor);
            definirEstilo(loader, '--ui-cg-empresa-contraste', identidade.contraste);
            if (loader.dataset.lvEmpresaId !== (identidade.empresa?.id ? String(identidade.empresa.id) : '')) {
                loader.dataset.lvEmpresaId = identidade.empresa?.id
                    ? String(identidade.empresa.id)
                    : '';
            }
            loader.querySelectorAll('.ui-cg-nucleo-marca').forEach((marca) => {
                if (marca.textContent !== identidade.iniciais) marca.textContent = identidade.iniciais;
            });
        });

        return identidade;
    }

    function emitirAtualizacao(identidade) {
        window.dispatchEvent(new CustomEvent('lv:empresa-identidade-atualizada', {
            detail: identidade,
        }));
    }

    const api = {
        obterEmpresaAtiva,
        obterIdentidade,
        aplicar,
        definirEmpresa(empresa) {
            estado.empresa = empresa?.id ? empresa : null;
            const identidade = aplicar(document);
            emitirAtualizacao(identidade);
            return identidade;
        },
        limpar() {
            estado.empresa = null;
            const identidade = aplicar(document);
            emitirAtualizacao(identidade);
            return identidade;
        },
    };

    window.LVEmpresaCarregamento = api;
    aplicar(document);

    if (typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver((mutations) => {
            if (mutations.some((mutation) => mutation.addedNodes.length > 0)) aplicar(document);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    window.addEventListener('storage', (event) => {
        if (event.key === CHAVE_EMPRESA || event.key === 'impersonation_token') {
            estado.empresa = null;
            emitirAtualizacao(aplicar(document));
        }
    });
}());
