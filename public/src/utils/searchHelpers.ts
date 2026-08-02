// public/src/utils/searchHelpers.ts

const BUSCAS_RECENTES_KEY = 'buscasRecentes';
const MAX_BUSCAS = 8;

/**
 * Normaliza o texto removendo acentos e convertendo para minúsculas.
 */
export const normalizeText = (text: unknown): string => {
    if (typeof text !== 'string') return '';
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
};

/** Lê as buscas salvas no localStorage. */
export const getBuscasRecentes = (): string[] => {
    try {
        const buscasSalvas = localStorage.getItem(BUSCAS_RECENTES_KEY);
        if (!buscasSalvas) return [];
        const parsed = JSON.parse(buscasSalvas) as unknown;
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch (error) {
        console.error('Erro ao ler buscas recentes:', error);
        return [];
    }
};

/** Adiciona uma nova busca ao histórico. */
export const addBuscaRecente = (termo: string): void => {
    if (!termo || termo.trim().length < 2) return;

    const termoLimpo = termo.trim().toLowerCase();
    let buscasAtuais = getBuscasRecentes();

    buscasAtuais = buscasAtuais.filter((b) => b !== termoLimpo);
    buscasAtuais.unshift(termoLimpo);

    const buscasAtualizadas = buscasAtuais.slice(0, MAX_BUSCAS);

    try {
        localStorage.setItem(BUSCAS_RECENTES_KEY, JSON.stringify(buscasAtualizadas));
    } catch (error) {
        console.error('Erro ao salvar busca recente:', error);
    }
};

/** Remove uma busca específica (ao clicar no × da pílula). */
export const removeBuscaRecente = (termo: string): void => {
    const buscasAtuais = getBuscasRecentes();
    const buscasAtualizadas = buscasAtuais.filter((b) => b !== termo);
    try {
        localStorage.setItem(BUSCAS_RECENTES_KEY, JSON.stringify(buscasAtualizadas));
    } catch (error) {
        console.error('Erro ao remover busca recente:', error);
    }
};
