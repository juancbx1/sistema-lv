import assert from 'node:assert/strict';
import pg from 'pg';

const connectionString = process.argv[2];
if (!connectionString) {
    throw new Error('Informe a URL PostgreSQL local temporaria.');
}

const url = new URL(connectionString);
if (!['127.0.0.1', 'localhost'].includes(url.hostname)
    || !url.pathname.slice(1).startsWith('sistema_lv_ocorrencias_v1_test_')) {
    throw new Error('O validador aceita somente a base local temporaria aprovada.');
}

const pool = new pg.Pool({ connectionString, max: 4 });
const tabelasEsperadas = {
    ocorrencias_embalagem: [
        'id', 'empresa_id', 'produto_id', 'variante', 'motivo', 'quantidade_total',
        'quantidade_em_conserto', 'quantidade_baixada', 'quantidade_retornada',
        'status', 'observacao', 'usuario_responsavel_id', 'usuario_responsavel_nome',
        'idempotency_key', 'criado_em', 'atualizado_em', 'concluido_em',
    ],
    ocorrencias_embalagem_origens: [
        'id', 'empresa_id', 'ocorrencia_id', 'origem_produto_pronto_id',
        'arremate_legado_id', 'quantidade_afetada', 'quantidade_retornada',
        'quantidade_baixada', 'criado_em',
    ],
    ocorrencias_embalagem_eventos: [
        'id', 'empresa_id', 'ocorrencia_id', 'tipo_evento', 'quantidade',
        'status_depois', 'observacao', 'usuario_id', 'usuario_nome', 'detalhes',
        'criado_em',
    ],
};
const constraintsEsperadas = [
    'ocorrencias_embalagem_empresa_id_id_uk',
    'ocorrencias_embalagem_motivo_chk',
    'ocorrencias_embalagem_status_chk',
    'ocorrencias_embalagem_quantidade_chk',
    'ocorrencias_embalagem_resumo_chk',
    'ocorrencias_embalagem_observacao_chk',
    'ocorrencias_embalagem_empresa_fk',
    'ocorrencias_embalagem_produto_empresa_fk',
    'ocorrencias_embalagem_origens_empresa_id_id_uk',
    'ocorrencias_embalagem_origens_referencia_chk',
    'ocorrencias_embalagem_origens_quantidade_chk',
    'ocorrencias_embalagem_origens_ocorrencia_fk',
    'ocorrencias_embalagem_origens_legada_fk',
    'ocorrencias_embalagem_eventos_empresa_id_id_uk',
    'ocorrencias_embalagem_eventos_tipo_chk',
    'ocorrencias_embalagem_eventos_quantidade_chk',
    'ocorrencias_embalagem_eventos_status_chk',
    'ocorrencias_embalagem_eventos_ocorrencia_fk',
];
const indicesEsperados = [
    'ocorrencias_embalagem_empresa_status_idx',
    'ocorrencias_embalagem_empresa_produto_idx',
    'ocorrencias_embalagem_idempotency_uk',
    'ocorrencias_embalagem_origens_canonica_uk',
    'ocorrencias_embalagem_origens_legada_uk',
    'ocorrencias_embalagem_origens_origem_idx',
    'ocorrencias_embalagem_eventos_empresa_data_idx',
    'ocorrencias_embalagem_eventos_empresa_tipo_idx',
];

try {
    const colunas = (await pool.query(`
        SELECT table_name, column_name, is_nullable
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
         ORDER BY table_name, ordinal_position
    `, [Object.keys(tabelasEsperadas)])).rows;

    const colunasAusentes = Object.entries(tabelasEsperadas).flatMap(([tabela, esperadas]) => {
        const presentes = new Set(
            colunas.filter((coluna) => coluna.table_name === tabela).map((coluna) => coluna.column_name),
        );
        return esperadas.filter((coluna) => !presentes.has(coluna)).map((coluna) => `${tabela}.${coluna}`);
    });

    const constraints = (await pool.query(
        'SELECT conname, contype, convalidated FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname',
        [constraintsEsperadas],
    )).rows;
    const indices = (await pool.query(
        'SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2::text[]) ORDER BY indexname',
        ['public', indicesEsperados],
    )).rows;
    const trigger = (await pool.query(`
        SELECT trigger_name
          FROM information_schema.triggers
         WHERE trigger_schema = 'public'
           AND event_object_table = 'ocorrencias_embalagem_eventos'
           AND trigger_name = 'ocorrencias_embalagem_eventos_append_only'
    `)).rows;
    const migration = (await pool.query(
        'SELECT id, detalhes FROM sistema_migrations WHERE id = $1',
        ['embalagem-ocorrencias-v1'],
    )).rows;
    const totais = (await pool.query(`
        SELECT
            (SELECT COUNT(*)::int FROM ocorrencias_embalagem) AS ocorrencias,
            (SELECT COUNT(*)::int FROM ocorrencias_embalagem_origens) AS origens,
            (SELECT COUNT(*)::int FROM ocorrencias_embalagem_eventos) AS eventos,
            (SELECT COUNT(*)::int FROM produtos WHERE empresa_id = 1)::int AS produtos_empresa,
            (SELECT COUNT(*)::int FROM arremates WHERE empresa_id = 1)::int AS arremates_empresa
    `)).rows[0];
    const produto = (await pool.query(
        'SELECT id FROM produtos WHERE empresa_id = 1 ORDER BY id LIMIT 1',
    )).rows[0];
    assert.ok(produto, 'A base local precisa ter ao menos um produto da empresa 1.');

    let updateBloqueado = false;
    let deleteBloqueado = false;
    const chaveEnsaio = `ensaio-ocorrencia-v1-${Date.now()}`;
    const transactionClient = await pool.connect();
    await transactionClient.query('BEGIN');
    try {
        const ocorrencia = (await transactionClient.query(`
            INSERT INTO ocorrencias_embalagem (
                empresa_id, produto_id, variante, motivo, quantidade_total,
                quantidade_em_conserto, quantidade_baixada, quantidade_retornada,
                status, observacao, usuario_responsavel_nome, idempotency_key,
                concluido_em
            )
            VALUES ($1, $2, '-', 'PRODUTO_AVARIADO', 1, 0, 1, 0,
                    'FINALIZADA', 'Ensaio local da migration.', 'Validador local', $3, NOW())
            RETURNING id
        `, [1, produto.id, chaveEnsaio])).rows[0];
        const evento = (await transactionClient.query(`
            INSERT INTO ocorrencias_embalagem_eventos (
                empresa_id, ocorrencia_id, tipo_evento, quantidade,
                status_depois, observacao, usuario_nome
            )
            VALUES ($1, $2, 'PERDA_EMBALAGEM', 1, 'FINALIZADA',
                    'Ensaio append-only.', 'Validador local')
            RETURNING id
            `, [1, ocorrencia.id])).rows[0];

        await transactionClient.query('SAVEPOINT antes_update');
        try {
            await transactionClient.query(
                'UPDATE ocorrencias_embalagem_eventos SET observacao = $1 WHERE id = $2',
                ['tentativa invalida', evento.id],
            );
        } catch (error) {
            updateBloqueado = error.code === 'P0001';
            await transactionClient.query('ROLLBACK TO SAVEPOINT antes_update');
        }
        await transactionClient.query('SAVEPOINT antes_delete');
        try {
            await transactionClient.query(
                'DELETE FROM ocorrencias_embalagem_eventos WHERE id = $1',
                [evento.id],
            );
        } catch (error) {
            deleteBloqueado = error.code === 'P0001';
            await transactionClient.query('ROLLBACK TO SAVEPOINT antes_delete');
        }
    } finally {
        await transactionClient.query('ROLLBACK').catch(() => {});
        transactionClient.release();
    }

    const fixtureResidual = (await pool.query(
        'SELECT COUNT(*)::int AS total FROM ocorrencias_embalagem WHERE idempotency_key = $1',
        [chaveEnsaio],
    )).rows[0].total;

    const resultado = {
        aprovado: colunasAusentes.length === 0
            && constraints.length === constraintsEsperadas.length
            && indices.length === indicesEsperados.length
            && trigger.length >= 2
            && migration.length === 1
            && Number(totais.ocorrencias) === 0
            && Number(totais.origens) === 0
            && Number(totais.eventos) === 0
            && updateBloqueado
            && deleteBloqueado
            && fixtureResidual === 0,
        banco: connectionString,
        colunasAusentes,
        constraints,
        indices,
        trigger,
        migration,
        totais,
        appendOnly: { updateBloqueado, deleteBloqueado, fixtureResidual },
    };
    console.log(JSON.stringify(resultado, null, 2));
    if (!resultado.aprovado) process.exitCode = 1;
} finally {
    await pool.end();
}
