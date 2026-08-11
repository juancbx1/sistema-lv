const FASES_VALIDAS = new Set(['OP', 'POS_OP']);
const MODOS_EXECUCAO_VALIDOS = new Set(['MANUAL', 'LIBERACAO_AUTOMATICA']);

function textoOuNulo(valor) {
    if (typeof valor !== 'string') return null;
    const texto = valor.trim();
    return texto || null;
}

export function normalizarExecutoresEtapa(feitoPor) {
    const valores = Array.isArray(feitoPor) ? feitoPor : [feitoPor];
    return [...new Set(
        valores
            .map(textoOuNulo)
            .filter(Boolean)
    )];
}

export function normalizarFaseEtapa(fase, fallback = null) {
    const valor = textoOuNulo(fase)?.toUpperCase() || null;
    if (FASES_VALIDAS.has(valor)) return valor;
    return FASES_VALIDAS.has(fallback) ? fallback : null;
}

/**
 * POS_OP continua sendo o gate que libera a embalagem, mas nem todo produto
 * possui trabalho físico de arremate. O modo automático representa apenas
 * essa liberação; ele nunca transforma uma etapa OP em POS_OP.
 */
export function normalizarModoExecucaoEtapa(modo, fase = null) {
    if (fase !== 'POS_OP') return 'MANUAL';
    const valor = textoOuNulo(modo)?.toUpperCase() || 'MANUAL';
    return MODOS_EXECUCAO_VALIDOS.has(valor) ? valor : 'MANUAL';
}

export function etapaEhLiberacaoAutomatica(etapa) {
    return etapa?.fase === 'POS_OP'
        && normalizarModoExecucaoEtapa(etapa?.modoExecucao ?? etapa?.modo_execucao, etapa.fase)
            === 'LIBERACAO_AUTOMATICA';
}

export function normalizarEtapaProduto(etapa, {
    indice = 0,
    origem = 'etapas',
    fasePadrao = null,
} = {}) {
    const objeto = typeof etapa === 'string'
        ? { processo: etapa }
        : (etapa && typeof etapa === 'object' ? etapa : {});

    return {
        ...objeto,
        id: textoOuNulo(objeto.id),
        ordem: Number.isInteger(objeto.ordem) && objeto.ordem > 0
            ? objeto.ordem
            : indice + 1,
        processo: textoOuNulo(objeto.processo) || '',
        maquina: textoOuNulo(objeto.maquina),
        feitoPor: normalizarExecutoresEtapa(objeto.feitoPor),
        fase: normalizarFaseEtapa(objeto.fase, fasePadrao),
        modoExecucao: normalizarModoExecucaoEtapa(
            objeto.modoExecucao ?? objeto.modo_execucao,
            normalizarFaseEtapa(objeto.fase, fasePadrao),
        ),
        origem: textoOuNulo(objeto.origem) || origem,
    };
}

export function construirEtapasCanonicas({ etapas = [], etapasTiktik = [] } = {}) {
    const etapasProducao = Array.isArray(etapas)
        ? etapas.map((etapa, indice) => normalizarEtapaProduto(etapa, {
            indice,
            origem: 'etapas',
            fasePadrao: 'OP',
        }))
        : [];

    const etapasLegadasTiktik = Array.isArray(etapasTiktik)
        ? etapasTiktik.map((etapa, indice) => normalizarEtapaProduto(etapa, {
            indice: etapasProducao.length + indice,
            origem: 'etapastiktik',
            // Não classificar automaticamente uma etapa legada. "Passar
            // Elástico", por exemplo, pode ser interna à OP ou pós-OP.
            fasePadrao: null,
        }))
        : [];

    const etapasCanonicas = [...etapasProducao, ...etapasLegadasTiktik];

    return {
        etapasCanonicas,
        etapasRequeremClassificacao: etapasLegadasTiktik.some(etapa => !etapa.fase),
    };
}

export function anexarEtapasCanonicas(produto) {
    if (!produto || typeof produto !== 'object') return produto;

    const etapasTiktik = Array.isArray(produto.etapasTiktik)
        ? produto.etapasTiktik
        : (Array.isArray(produto.etapastiktik) ? produto.etapastiktik : []);

    return {
        ...produto,
        ...construirEtapasCanonicas({
            etapas: produto.etapas,
            etapasTiktik,
        }),
    };
}

export function encontrarEtapaCanonica(produto, {
    fase = null,
    processo = null,
    processoId = null,
    etapaId = null,
} = {}) {
    const produtoCanonico = construirEtapasCanonicas({
        etapas: produto?.etapas,
        etapasTiktik: produto?.etapasTiktik ?? produto?.etapastiktik,
    });

    return produtoCanonico.etapasCanonicas.find((etapa) => {
        if (fase && etapa.fase !== fase) return false;
        if (etapaId && String(etapa.id || '') !== String(etapaId)) return false;
        if (processoId && String(etapa.processo_id || '') !== String(processoId)) return false;
        if (processo && etapa.processo !== processo) return false;
        return true;
    }) || null;
}
