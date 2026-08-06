import crypto from 'crypto';

const NOME_CATEGORIA_A_CLASSIFICAR = 'A classificar';
const NOME_GRUPO_SISTEMA = 'Sistema — Importação';

export { NOME_CATEGORIA_A_CLASSIFICAR, NOME_GRUPO_SISTEMA };

/**
 * Normaliza memo/descrição bancária para match e aprendizado.
 * Remove ruído típico de PIX/TED/DOC e protocolos, preservando nome do favorecido.
 */
export function normalizarDescricao(texto) {
    let s = String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    // Prefixos comuns de bancos BR
    s = s
        .replace(/\b(pix)\s*(enviado|recebido|qrs|transferencia|transf|out|in)?\b/gi, ' ')
        .replace(/\b(ted|doc|tef|tei)\s*(enviad[oa]|recebid[oa]|transf)?\b/gi, ' ')
        .replace(/\b(pagto|pagamento|pgto|compra no debito|compra no credito|compra)\b/gi, ' ')
        .replace(/\b(transf|transferencia|transferência)\s*(entre contas|mesma titularidade|enviada|recebida)?\b/gi, ' ')
        .replace(/\b(debito automatico|débito automático|cobranca|cobrança|boleto)\b/gi, ' ')
        .replace(/\b(recebimento|envio)\s+pix\b/gi, ' ');

    // CPF / CNPJ / protocolos longos
    s = s
        .replace(/\b\d{2,3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, ' ')
        .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, ' ')
        .replace(/\b\d{14,}\b/g, ' ')
        .replace(/\b[a-f0-9]{16,}\b/gi, ' ')
        .replace(/\b\d{6,}\b/g, ' ');

    s = s
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return s;
}

export function hashArquivo(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function hashLinha({ idConta, data, valor, sentido, descricaoNormalizada, fitId }) {
    const base = [
        String(idConta),
        String(data),
        Number(valor).toFixed(2),
        sentido,
        descricaoNormalizada || '',
        fitId || '',
    ].join('|');
    return crypto.createHash('sha256').update(base).digest('hex');
}

function tokens(str) {
    return new Set(
        String(str || '')
            .split(/\s+/)
            .filter((t) => t.length >= 2)
    );
}

/** Similaridade 0–1 por coeficiente de Dice em tokens. */
export function similaridadeTexto(a, b) {
    const ta = tokens(a);
    const tb = tokens(b);
    if (ta.size === 0 && tb.size === 0) return 1;
    if (ta.size === 0 || tb.size === 0) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter += 1;
    return (2 * inter) / (ta.size + tb.size);
}

function diffDias(isoA, isoB) {
    const a = Date.parse(`${String(isoA).slice(0, 10)}T12:00:00Z`);
    const b = Date.parse(`${String(isoB).slice(0, 10)}T12:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 99;
    return Math.abs(Math.round((a - b) / 86400000));
}

/**
 * Score de conciliação 0–1 entre linha do extrato e lançamento existente.
 */
export function scoreMatchLinhaLancamento(linha, lancamento) {
    const valorLinha = Number(linha.valor);
    const valorLanc = Math.abs(Number(lancamento.valor));
    if (!Number.isFinite(valorLinha) || !Number.isFinite(valorLanc)) return 0;
    if (Math.abs(valorLinha - valorLanc) > 0.009) return 0;

    const tipoOk =
        (linha.tipo_movimento === 'DEBITO' && lancamento.tipo === 'DESPESA') ||
        (linha.tipo_movimento === 'CREDITO' && lancamento.tipo === 'RECEITA');
    if (!tipoOk) return 0;

    let score = 0.5; // valor + tipo

    const dias = diffDias(linha.data_transacao, lancamento.data_transacao);
    if (dias === 0) score += 0.3;
    else if (dias === 1) score += 0.18;
    else if (dias === 2) score += 0.1;
    else return Math.min(score, 0.45);

    const descLinha = linha.descricao_normalizada || normalizarDescricao(linha.descricao_original);
    const descLanc = normalizarDescricao(lancamento.descricao);
    score += similaridadeTexto(descLinha, descLanc) * 0.2;

    return Math.min(1, Math.round(score * 1000) / 1000);
}

export function classificarScore(score) {
    if (score >= 0.85) return 'auto';
    if (score >= 0.55) return 'possivel';
    return 'novo';
}

/**
 * Garante grupo + categoria "A classificar" para DESPESA e RECEITA na empresa.
 * @returns {{ DESPESA: number, RECEITA: number }}
 */
export async function garantirCategoriasAClassificar(dbClient, empresaId) {
    const ids = { DESPESA: null, RECEITA: null };

    for (const tipo of ['DESPESA', 'RECEITA']) {
        const existente = await dbClient.query(
            `SELECT c.id
               FROM fc_categorias c
               JOIN fc_grupos_financeiros g
                 ON g.id = c.id_grupo
                AND g.empresa_id = c.empresa_id
              WHERE c.empresa_id = $1
                AND c.nome = $2
                AND g.tipo = $3
              ORDER BY c.id
              LIMIT 1`,
            [empresaId, NOME_CATEGORIA_A_CLASSIFICAR, tipo]
        );
        if (existente.rows[0]) {
            ids[tipo] = Number(existente.rows[0].id);
            continue;
        }

        let grupoId;
        const grupoExistente = await dbClient.query(
            `SELECT id
               FROM fc_grupos_financeiros
              WHERE empresa_id = $1
                AND nome = $2
                AND tipo = $3
              LIMIT 1`,
            [empresaId, NOME_GRUPO_SISTEMA, tipo]
        );
        if (grupoExistente.rows[0]) {
            grupoId = Number(grupoExistente.rows[0].id);
        } else {
            const novoGrupo = await dbClient.query(
                `INSERT INTO fc_grupos_financeiros (nome, tipo, empresa_id)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [NOME_GRUPO_SISTEMA, tipo, empresaId]
            );
            grupoId = Number(novoGrupo.rows[0].id);
        }

        const novaCat = await dbClient.query(
            `INSERT INTO fc_categorias (nome, id_grupo, empresa_id)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [NOME_CATEGORIA_A_CLASSIFICAR, grupoId, empresaId]
        );
        ids[tipo] = Number(novaCat.rows[0].id);
    }

    return ids;
}

/**
 * Sugere categoria/contato por regras e histórico da empresa.
 */
export async function sugerirClassificacao(dbClient, empresaId, { descricaoNormalizada, tipoMovimento, idConta }) {
    const tipoLanc = tipoMovimento === 'CREDITO' ? 'RECEITA' : 'DESPESA';

    // 1) Regras ativas (prioridade, depois uso)
    const regras = await dbClient.query(
        `SELECT id, padrao, id_categoria, id_contato, tipo, origem
           FROM fc_regras_importacao
          WHERE empresa_id = $1
            AND ativo = TRUE
          ORDER BY prioridade ASC, uso_count DESC, id ASC
          LIMIT 200`,
        [empresaId]
    );

    for (const regra of regras.rows) {
        const padrao = String(regra.padrao || '').toLowerCase();
        if (!padrao) continue;
        if (regra.tipo && regra.tipo !== tipoLanc) continue;
        if (descricaoNormalizada.includes(padrao) || padrao.includes(descricaoNormalizada)) {
            return {
                id_categoria: regra.id_categoria ? Number(regra.id_categoria) : null,
                id_contato: regra.id_contato ? Number(regra.id_contato) : null,
                origem: 'regra',
                regra_id: Number(regra.id),
            };
        }
    }

    // 2) Histórico recente na conta com descrição similar
    const hist = await dbClient.query(
        `SELECT l.id_categoria, l.id_contato, l.descricao
           FROM fc_lancamentos l
          WHERE l.empresa_id = $1
            AND l.id_conta_bancaria = $2
            AND l.tipo = $3
            AND l.excluido_em IS NULL
            AND l.id_categoria IS NOT NULL
          ORDER BY l.data_transacao DESC, l.id DESC
          LIMIT 80`,
        [empresaId, idConta, tipoLanc]
    );

    let melhor = null;
    let melhorSim = 0;
    for (const row of hist.rows) {
        const sim = similaridadeTexto(descricaoNormalizada, normalizarDescricao(row.descricao));
        if (sim > melhorSim && sim >= 0.55) {
            melhorSim = sim;
            melhor = row;
        }
    }

    if (melhor) {
        return {
            id_categoria: melhor.id_categoria ? Number(melhor.id_categoria) : null,
            id_contato: melhor.id_contato ? Number(melhor.id_contato) : null,
            origem: 'historico',
            similaridade: melhorSim,
        };
    }

    return { id_categoria: null, id_contato: null, origem: null };
}

/**
 * Aprende regra a partir de memo normalizado (origem APRENDIDO).
 * Não aprende se a categoria for "A classificar".
 */
export async function aprenderRegra(dbClient, empresaId, {
    descricaoNormalizada,
    idCategoria,
    idContato,
    tipo,
    nomeCategoria,
}) {
    const padrao = String(descricaoNormalizada || '').trim();
    if (!padrao || padrao.length < 4) return;
    if (!idCategoria) return;
    if (String(nomeCategoria || '') === NOME_CATEGORIA_A_CLASSIFICAR) return;

    const existente = await dbClient.query(
        `SELECT id, uso_count
           FROM fc_regras_importacao
          WHERE empresa_id = $1
            AND origem = 'APRENDIDO'
            AND padrao = $2
          LIMIT 1`,
        [empresaId, padrao]
    );

    if (existente.rows[0]) {
        await dbClient.query(
            `UPDATE fc_regras_importacao
                SET id_categoria = $1,
                    id_contato = $2,
                    tipo = $3,
                    uso_count = uso_count + 1,
                    ativo = TRUE,
                    atualizado_em = NOW()
              WHERE id = $4
                AND empresa_id = $5`,
            [idCategoria, idContato || null, tipo || null, existente.rows[0].id, empresaId]
        );
        return;
    }

    await dbClient.query(
        `INSERT INTO fc_regras_importacao
            (empresa_id, padrao, id_categoria, id_contato, tipo, prioridade, ativo, origem, uso_count)
         VALUES ($1, $2, $3, $4, $5, 500, TRUE, 'APRENDIDO', 1)`,
        [empresaId, padrao, idCategoria, idContato || null, tipo || null]
    );
}
