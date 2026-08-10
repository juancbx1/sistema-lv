/**
 * Acesso aos tempos padrao de cada contrato da cadeia produtiva.
 *
 * Os contratos permanecem separados: Arremates legado usa
 * tempos_padrao_arremate (produto -> tempo), enquanto Producoes usa
 * tempos_padrao_producao (produto + processo -> tempo).
 */

export async function listarTemposArremate(dbClient, empresaId) {
    const result = await dbClient.query(
        `SELECT produto_id, tempo_segundos_por_peca
           FROM tempos_padrao_arremate
          WHERE empresa_id = $1`,
        [empresaId],
    );

    return result.rows.reduce((acc, row) => {
        acc[row.produto_id] = Number.parseFloat(row.tempo_segundos_por_peca);
        return acc;
    }, {});
}

export async function buscarTempoArremate(dbClient, empresaId, produtoId) {
    const result = await dbClient.query(
        `SELECT tempo_segundos_por_peca
           FROM tempos_padrao_arremate
          WHERE produto_id = $1
            AND empresa_id = $2
          LIMIT 1`,
        [produtoId, empresaId],
    );
    return result.rows[0] ? Number.parseFloat(result.rows[0].tempo_segundos_por_peca) : null;
}

export async function salvarTemposArremate(dbClient, empresaId, produtoIds, temposValores) {
    await dbClient.query(
        `INSERT INTO tempos_padrao_arremate
            (empresa_id, produto_id, tempo_segundos_por_peca)
         SELECT $1, u.produto_id, u.tempo_segundos_por_peca
           FROM UNNEST($2::int[], $3::numeric[])
             AS u(produto_id, tempo_segundos_por_peca)
         ON CONFLICT (empresa_id, produto_id)
         DO UPDATE SET
            tempo_segundos_por_peca = EXCLUDED.tempo_segundos_por_peca,
            atualizado_em = CURRENT_TIMESTAMP`,
        [empresaId, produtoIds, temposValores],
    );
}

export async function listarTemposProducao(dbClient, empresaId) {
    const result = await dbClient.query(
        `SELECT tpp.produto_id, tpp.processo, tpp.tempo_segundos
           FROM tempos_padrao_producao tpp
           JOIN produtos p
             ON p.id = tpp.produto_id
            AND p.empresa_id = $1`,
        [empresaId],
    );

    return result.rows.reduce((acc, row) => {
        acc[`${row.produto_id}-${row.processo}`] = Number.parseFloat(row.tempo_segundos);
        return acc;
    }, {});
}

export async function salvarTemposProducao(dbClient, entradas) {
    for (const entrada of entradas) {
        await dbClient.query(
            `INSERT INTO tempos_padrao_producao (produto_id, processo, tempo_segundos)
             VALUES ($1, $2, $3)
             ON CONFLICT (produto_id, processo)
             DO UPDATE SET tempo_segundos = EXCLUDED.tempo_segundos`,
            [entrada.produto_id, entrada.processo, entrada.tempo_segundos],
        );
    }
}
