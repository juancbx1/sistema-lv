const PERMISSAO_MONITORAMENTO_OPS = 'acesso-monitoramento-ops';
const PERMISSAO_FINALIZAR_OP = 'finalizar-op';

export const MONITORAMENTO_OPS_PERMISSOES = Object.freeze({
    acesso: PERMISSAO_MONITORAMENTO_OPS,
    finalizar: PERMISSAO_FINALIZAR_OP,
});

export const MONITORAMENTO_OPS_LIMITES_HORAS = Object.freeze({
    atencao: 3,
    obrigatoria: 8,
    critica: 24,
});

export function erroMonitoramento(mensagem, statusCode = 400, codigo = 'MONITORAMENTO_OPS_INVALIDO') {
    const error = new Error(mensagem);
    error.statusCode = statusCode;
    error.codigo = codigo;
    return error;
}

export function usuarioPodeAcessarMonitoramento(permissoes = []) {
    return Array.isArray(permissoes) && permissoes.includes(PERMISSAO_MONITORAMENTO_OPS);
}

export function usuarioPodeOperarMonitoramento(permissoes = []) {
    return usuarioPodeAcessarMonitoramento(permissoes)
        && permissoes.includes(PERMISSAO_FINALIZAR_OP);
}

export async function obterEstruturaMonitoramentoOps(dbClient) {
    const result = await dbClient.query(`
        SELECT
            to_regclass('public.op_monitoramento_impedimentos') IS NOT NULL AS impedimentos,
            to_regclass('public.op_monitoramento_adiamentos') IS NOT NULL AS adiamentos,
            to_regclass('public.op_monitoramento_lotes') IS NOT NULL AS lotes
    `);
    const row = result.rows[0] || {};
    return {
        impedimentos: Boolean(row.impedimentos),
        adiamentos: Boolean(row.adiamentos),
        lotes: Boolean(row.lotes),
        completa: Boolean(row.impedimentos && row.adiamentos && row.lotes),
    };
}

export function classificarFaixaMonitoramentoOps(horas) {
    if (horas >= MONITORAMENTO_OPS_LIMITES_HORAS.critica) return 'CRITICA';
    if (horas >= MONITORAMENTO_OPS_LIMITES_HORAS.obrigatoria) return 'OBRIGATORIA';
    if (horas >= MONITORAMENTO_OPS_LIMITES_HORAS.atencao) return 'ATENCAO';
    return 'ACOMPANHAMENTO';
}

function numeroInteiro(valor) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? Math.trunc(numero) : 0;
}

/**
 * Calcula a fila canônica. Etapas legadas sem fase continuam sendo tratadas
 * como internas da OP; nunca inferimos POS_OP a partir do nome do processo.
 */
export async function consultarMonitoramentoOps(dbClient, {
    empresaId,
    usuarioId,
    podeFinalizar = false,
    estrutura: estruturaInformada = null,
} = {}) {
    const estrutura = estruturaInformada || await obterEstruturaMonitoramentoOps(dbClient);
    const servidorResult = await dbClient.query('SELECT CURRENT_TIMESTAMP AS servidor_em');
    const servidorEm = new Date(servidorResult.rows[0].servidor_em);

    const opsResult = await dbClient.query(`
        WITH etapas_op AS (
            SELECT
                op.id AS op_id,
                op.empresa_id,
                op.numero AS op_numero,
                (etapa_posicao - 1)::integer AS etapa_index
            FROM ordens_de_producao op
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(op.etapas, '[]'::jsonb))
                WITH ORDINALITY AS etapa_json(etapa, etapa_posicao)
            WHERE op.empresa_id = $1
              AND op.status IN ('em-aberto', 'produzindo')
              AND COALESCE(NULLIF(UPPER(etapa_json.etapa ->> 'fase'), ''), 'OP') = 'OP'
        ),
        progresso_etapas AS (
            SELECT
                eo.op_id,
                eo.etapa_index,
                MIN(prod.data) AS primeiro_lancamento_em,
                MAX(prod.data) AS ultimo_lancamento_em,
                COALESCE(SUM(prod.quantidade), 0) AS quantidade_produzida
            FROM etapas_op eo
            LEFT JOIN producoes prod
              ON prod.empresa_id = eo.empresa_id
             AND prod.op_numero = eo.op_numero
             AND prod.etapa_index = eo.etapa_index
            GROUP BY eo.op_id, eo.etapa_index
        ),
        elegiveis AS (
            SELECT
                op_id,
                MAX(primeiro_lancamento_em) AS elegivel_desde,
                MAX(ultimo_lancamento_em) AS ultima_producao_em,
                MAX(etapa_index) AS etapa_final_index,
                COUNT(*)::integer AS total_etapas_op
            FROM progresso_etapas
            GROUP BY op_id
            HAVING COUNT(*) > 0
               AND COUNT(primeiro_lancamento_em) = COUNT(*)
        )
        SELECT
            op.id,
            op.edit_id,
            op.numero,
            op.produto_id,
            op.variante,
            op.quantidade,
            op.status,
            op.etapas,
            p.nome AS produto_nome,
            p.imagem AS produto_imagem,
            e.elegivel_desde,
            e.ultima_producao_em,
            e.etapa_final_index,
            e.total_etapas_op,
            COALESCE(pf.quantidade_produzida, 0) AS quantidade_feita_ultima_etapa
        FROM elegiveis e
        JOIN ordens_de_producao op
          ON op.id = e.op_id
         AND op.empresa_id = $1
         AND op.status IN ('em-aberto', 'produzindo')
        LEFT JOIN produtos p
          ON p.id = op.produto_id
         AND p.empresa_id = op.empresa_id
        LEFT JOIN progresso_etapas pf
          ON pf.op_id = e.op_id
         AND pf.etapa_index = e.etapa_final_index
        ORDER BY e.elegivel_desde, op.id
    `, [empresaId]);

    const opIds = opsResult.rows.map((row) => Number(row.id)).filter(Number.isSafeInteger);
    const impedimentosPorOp = new Map();

    if (estrutura.impedimentos && opIds.length > 0) {
        const impedimentosResult = await dbClient.query(`
            SELECT
                imp.id,
                imp.op_id,
                imp.motivo,
                imp.registrado_em,
                imp.atualizado_em,
                imp.registrado_por,
                COALESCE(u.nome, 'Usuário') AS registrado_por_nome
            FROM op_monitoramento_impedimentos imp
            LEFT JOIN usuarios u ON u.id = imp.registrado_por
            WHERE imp.empresa_id = $1
              AND imp.op_id = ANY($2::integer[])
              AND imp.resolvido_em IS NULL
        `, [empresaId, opIds]);
        impedimentosResult.rows.forEach((row) => impedimentosPorOp.set(Number(row.op_id), row));
    }

    let adiamentoAtivo = null;
    let adiamentosHoje = 0;
    if (estrutura.adiamentos && usuarioId) {
        const adiamentosResult = await dbClient.query(`
            SELECT
                id,
                vence_em,
                contexto_ops,
                COUNT(*) OVER ()::integer AS total_hoje
            FROM op_monitoramento_adiamentos
            WHERE empresa_id = $1
              AND usuario_id = $2
              AND data_local = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date
            ORDER BY criado_em DESC
        `, [empresaId, usuarioId]);
        adiamentosHoje = numeroInteiro(adiamentosResult.rows[0]?.total_hoje);
        adiamentoAtivo = adiamentosResult.rows.find((row) => new Date(row.vence_em) > servidorEm) || null;
    }

    const ops = opsResult.rows.map((row) => {
        const elegivelDesde = new Date(row.elegivel_desde);
        const ultimaProducaoEm = row.ultima_producao_em
            ? new Date(row.ultima_producao_em)
            : elegivelDesde;
        const horasAguardando = Math.max(0, (servidorEm.getTime() - elegivelDesde.getTime()) / 3_600_000);
        const impedimentoCandidato = impedimentosPorOp.get(Number(row.id)) || null;
        const impedimentoRegistradoEm = impedimentoCandidato
            ? new Date(impedimentoCandidato.atualizado_em || impedimentoCandidato.registrado_em)
            : null;
        // Produção registrada depois da análise invalida o impedimento para a
        // fila, sem apagar o histórico persistido.
        const impedimento = impedimentoRegistradoEm && impedimentoRegistradoEm >= ultimaProducaoEm
            ? {
                id: Number(impedimentoCandidato.id),
                motivo: impedimentoCandidato.motivo,
                registrado_em: impedimentoCandidato.registrado_em,
                atualizado_em: impedimentoCandidato.atualizado_em,
                registrado_por: Number(impedimentoCandidato.registrado_por),
                registrado_por_nome: impedimentoCandidato.registrado_por_nome,
            }
            : null;
        const quantidade = numeroInteiro(row.quantidade);
        const quantidadeFeita = numeroInteiro(row.quantidade_feita_ultima_etapa);

        return {
            id: Number(row.id),
            edit_id: row.edit_id,
            numero: row.numero,
            produto_id: Number(row.produto_id),
            produto_nome: row.produto_nome || 'Produto',
            produto_imagem: row.produto_imagem || null,
            variante: row.variante || null,
            quantidade,
            quantidade_feita_ultima_etapa: quantidadeFeita,
            encerramento_parcial: quantidadeFeita < quantidade,
            status: row.status,
            elegivel_desde: elegivelDesde.toISOString(),
            ultima_producao_em: ultimaProducaoEm.toISOString(),
            horas_aguardando: Math.round(horasAguardando * 10) / 10,
            faixa: classificarFaixaMonitoramentoOps(horasAguardando),
            total_etapas_op: numeroInteiro(row.total_etapas_op),
            impedimento,
        };
    });

    const pesoFaixa = { CRITICA: 4, OBRIGATORIA: 3, ATENCAO: 2, ACOMPANHAMENTO: 1 };
    ops.sort((a, b) => {
        const diferencaFaixa = pesoFaixa[b.faixa] - pesoFaixa[a.faixa];
        if (diferencaFaixa !== 0) return diferencaFaixa;
        return new Date(a.elegivel_desde) - new Date(b.elegivel_desde);
    });

    const opsSemImpedimento = ops.filter((op) => !op.impedimento);
    const criticas = opsSemImpedimento.filter((op) => op.faixa === 'CRITICA');
    const obrigatorias = opsSemImpedimento.filter((op) => op.faixa === 'OBRIGATORIA');
    const adiamentoEstaAtivo = Boolean(adiamentoAtivo && criticas.length === 0);
    const possuiObrigacao = criticas.length > 0 || obrigatorias.length > 0;
    const persistenciaDisponivel = estrutura.impedimentos && estrutura.adiamentos;

    return {
        servidor_em: servidorEm.toISOString(),
        persistencia_disponivel: persistenciaDisponivel,
        estrutura,
        pode_finalizar: Boolean(podeFinalizar),
        intercepcao_obrigatoria: Boolean(
            podeFinalizar
            && persistenciaDisponivel
            && possuiObrigacao
            && !adiamentoEstaAtivo
        ),
        pode_adiar: Boolean(
            podeFinalizar
            && persistenciaDisponivel
            && obrigatorias.length > 0
            && criticas.length === 0
            && adiamentosHoje < 2
        ),
        adiamento_ativo: adiamentoAtivo ? {
            id: Number(adiamentoAtivo.id),
            vence_em: new Date(adiamentoAtivo.vence_em).toISOString(),
        } : null,
        adiamentos_hoje: adiamentosHoje,
        resumo: {
            total: ops.length,
            acompanhamento: ops.filter((op) => op.faixa === 'ACOMPANHAMENTO').length,
            atencao: ops.filter((op) => op.faixa === 'ATENCAO').length,
            obrigatorias: ops.filter((op) => op.faixa === 'OBRIGATORIA').length,
            criticas: ops.filter((op) => op.faixa === 'CRITICA').length,
            impedidas: ops.filter((op) => Boolean(op.impedimento)).length,
            pendentes_acao: opsSemImpedimento.filter((op) => (
                op.faixa === 'OBRIGATORIA' || op.faixa === 'CRITICA'
            )).length,
        },
        ops,
    };
}

export async function registrarAdiamentoMonitoramento(dbClient, {
    empresaId,
    usuarioId,
    idempotencyKey,
} = {}) {
    if (!idempotencyKey || String(idempotencyKey).length > 120) {
        throw erroMonitoramento('Chave de idempotência inválida para o adiamento.');
    }

    const estrutura = await obterEstruturaMonitoramentoOps(dbClient);
    if (!estrutura.adiamentos || !estrutura.impedimentos) {
        throw erroMonitoramento(
            'A persistência do monitoramento ainda não está disponível.',
            503,
            'MONITORAMENTO_OPS_SCHEMA_INDISPONIVEL',
        );
    }

    await dbClient.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`monitoramento-ops:adiamento:${empresaId}:${usuarioId}`],
    );

    const existente = await dbClient.query(`
        SELECT id, vence_em
        FROM op_monitoramento_adiamentos
        WHERE empresa_id = $1
          AND usuario_id = $2
          AND idempotency_key = $3
        LIMIT 1
    `, [empresaId, usuarioId, String(idempotencyKey)]);
    if (existente.rows[0]) return existente.rows[0];

    const monitoramento = await consultarMonitoramentoOps(dbClient, {
        empresaId,
        usuarioId,
        podeFinalizar: true,
        estrutura,
    });
    if (!monitoramento.pode_adiar) {
        const temCritica = monitoramento.ops.some((op) => !op.impedimento && op.faixa === 'CRITICA');
        throw erroMonitoramento(
            temCritica
                ? 'OPs críticas não podem ser adiadas.'
                : 'O limite de adiamentos foi atingido ou não há revisão obrigatória adiável.',
            409,
            temCritica ? 'MONITORAMENTO_OPS_CRITICO' : 'MONITORAMENTO_OPS_ADIAMENTO_NEGADO',
        );
    }

    const opIds = monitoramento.ops
        .filter((op) => !op.impedimento && op.faixa === 'OBRIGATORIA')
        .map((op) => op.id);
    const insert = await dbClient.query(`
        INSERT INTO op_monitoramento_adiamentos (
            empresa_id,
            usuario_id,
            vence_em,
            data_local,
            contexto_ops,
            idempotency_key
        ) VALUES (
            $1,
            $2,
            CURRENT_TIMESTAMP + INTERVAL '30 minutes',
            (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date,
            $3::jsonb,
            $4
        )
        RETURNING id, vence_em
    `, [empresaId, usuarioId, JSON.stringify({ op_ids: opIds }), String(idempotencyKey)]);
    return insert.rows[0];
}

export async function registrarImpedimentoMonitoramento(dbClient, {
    empresaId,
    usuarioId,
    opId,
    motivo,
} = {}) {
    const motivoNormalizado = String(motivo || '').trim();
    if (motivoNormalizado.length < 10 || motivoNormalizado.length > 1000) {
        throw erroMonitoramento('Informe um motivo entre 10 e 1000 caracteres.');
    }
    if (!Number.isSafeInteger(Number(opId))) {
        throw erroMonitoramento('OP inválida para registrar impedimento.');
    }

    const estrutura = await obterEstruturaMonitoramentoOps(dbClient);
    if (!estrutura.impedimentos) {
        throw erroMonitoramento(
            'A persistência do monitoramento ainda não está disponível.',
            503,
            'MONITORAMENTO_OPS_SCHEMA_INDISPONIVEL',
        );
    }
    const monitoramento = await consultarMonitoramentoOps(dbClient, {
        empresaId,
        usuarioId,
        podeFinalizar: false,
        estrutura,
    });
    const op = monitoramento.ops.find((item) => item.id === Number(opId));
    if (!op) {
        throw erroMonitoramento('A OP não está elegível no monitoramento da empresa ativa.', 404, 'OP_NAO_ELEGIVEL');
    }

    const result = await dbClient.query(`
        INSERT INTO op_monitoramento_impedimentos (
            empresa_id,
            op_id,
            motivo,
            registrado_por
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (empresa_id, op_id) WHERE resolvido_em IS NULL
        DO UPDATE SET
            motivo = EXCLUDED.motivo,
            registrado_por = EXCLUDED.registrado_por,
            atualizado_em = CURRENT_TIMESTAMP
        RETURNING *
    `, [empresaId, Number(opId), motivoNormalizado, usuarioId]);
    return { impedimento: result.rows[0], op };
}

export async function atualizarImpedimentoMonitoramento(dbClient, {
    empresaId,
    usuarioId,
    impedimentoId,
    acao,
    motivo,
} = {}) {
    const id = Number(impedimentoId);
    if (!Number.isSafeInteger(id)) throw erroMonitoramento('Impedimento inválido.');

    let result;
    if (acao === 'resolver') {
        result = await dbClient.query(`
            UPDATE op_monitoramento_impedimentos
               SET resolvido_em = CURRENT_TIMESTAMP,
                   resolvido_por = $3,
                   atualizado_em = CURRENT_TIMESTAMP
             WHERE id = $1
               AND empresa_id = $2
               AND resolvido_em IS NULL
             RETURNING *
        `, [id, empresaId, usuarioId]);
    } else {
        const motivoNormalizado = String(motivo || '').trim();
        if (motivoNormalizado.length < 10 || motivoNormalizado.length > 1000) {
            throw erroMonitoramento('Informe um motivo entre 10 e 1000 caracteres.');
        }
        result = await dbClient.query(`
            UPDATE op_monitoramento_impedimentos
               SET motivo = $3,
                   registrado_por = $4,
                   atualizado_em = CURRENT_TIMESTAMP
             WHERE id = $1
               AND empresa_id = $2
               AND resolvido_em IS NULL
             RETURNING *
        `, [id, empresaId, motivoNormalizado, usuarioId]);
    }

    if (!result.rows[0]) {
        throw erroMonitoramento('Impedimento não encontrado na empresa ativa.', 404, 'IMPEDIMENTO_NAO_ENCONTRADO');
    }
    return result.rows[0];
}

export async function resolverImpedimentosDaOp(dbClient, {
    empresaId,
    opId,
    usuarioId,
} = {}) {
    const estrutura = await obterEstruturaMonitoramentoOps(dbClient);
    if (!estrutura.impedimentos) return;
    await dbClient.query(`
        UPDATE op_monitoramento_impedimentos
           SET resolvido_em = CURRENT_TIMESTAMP,
               resolvido_por = $3,
               atualizado_em = CURRENT_TIMESTAMP
         WHERE empresa_id = $1
           AND op_id = $2
           AND resolvido_em IS NULL
    `, [empresaId, opId, usuarioId]);
}
