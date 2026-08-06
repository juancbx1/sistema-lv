import pg from 'pg';

const connectionString = process.argv[2];
const mode = process.argv[3] || 'apply';
if (!connectionString || (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost'))) {
    throw new Error('Informe uma URL PostgreSQL local.');
}

const pool = new pg.Pool({ connectionString });
async function rows(text, values = []) {
    return (await pool.query(text, values)).rows;
}

try {
    const colunas = await rows(`
        SELECT table_name, column_name, is_nullable
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name IN ('producoes', 'producoes_solicitacoes_exclusao')
           AND column_name = 'empresa_id'
         ORDER BY table_name
    `);
    const dados = (await rows(mode === 'apply' ? `
        SELECT
            (SELECT COUNT(*)::int FROM producoes) AS producoes,
            (SELECT COUNT(*)::int FROM producoes WHERE empresa_id IS NULL) AS producoes_sem_empresa,
            (SELECT COUNT(*)::int FROM producoes WHERE empresa_id <> (SELECT id FROM empresas WHERE codigo = 'lojas-variara' AND eh_legada = TRUE)) AS producoes_outra_empresa,
            (SELECT COUNT(*)::int FROM producoes p LEFT JOIN ordens_de_producao op ON op.numero = p.op_numero WHERE op.id IS NULL) AS producoes_sem_op_pai,
            (SELECT COUNT(*)::int FROM sessoes_trabalho_producao) AS sessoes,
            (SELECT COUNT(*)::int FROM sessoes_trabalho_producao WHERE empresa_id IS NULL) AS sessoes_sem_empresa,
            (SELECT COUNT(*)::int FROM sessoes_trabalho_producao s LEFT JOIN ordens_de_producao op ON op.numero = s.op_numero WHERE op.id IS NULL) AS sessoes_sem_op_pai,
            (SELECT COUNT(*)::int FROM producoes_solicitacoes_exclusao) AS solicitacoes,
            (SELECT COUNT(*)::int FROM producoes_solicitacoes_exclusao WHERE empresa_id IS NULL) AS solicitacoes_sem_empresa,
            (SELECT COUNT(*)::int FROM producoes_solicitacoes_exclusao x LEFT JOIN producoes p ON p.id = x.producao_id WHERE p.id IS NULL) AS solicitacoes_sem_producao
    ` : `
        SELECT
            (SELECT COUNT(*)::int FROM producoes) AS producoes,
            (SELECT COUNT(*)::int FROM sessoes_trabalho_producao) AS sessoes,
            (SELECT COUNT(*)::int FROM producoes_solicitacoes_exclusao) AS solicitacoes
    `))[0];

    const nomesConstraints = [
        'uq_producoes_empresa_id',
        'uq_producao_solicitacoes_empresa_id',
        'fk_producoes_empresa',
        'fk_producoes_produto_empresa',
        'fk_producoes_op_empresa',
        'fk_producoes_funcionario_empresa',
        'fk_producao_solicitacoes_empresa',
        'fk_producao_solicitacoes_producao_empresa',
        'fk_sessoes_producao_produto_empresa',
        'fk_sessoes_producao_op_empresa',
    ];
    const constraints = await rows(
        'SELECT conname, contype, convalidated FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname',
        [nomesConstraints]
    );
    const nomesIndices = [
        'idx_producoes_empresa_data',
        'idx_producoes_empresa_op_etapa',
        'idx_producoes_empresa_funcionario_data',
        'idx_sessoes_producao_empresa_status',
        'idx_sessoes_producao_empresa_op',
        'idx_producao_solicitacoes_empresa_status',
    ];
    const indices = await rows(
        'SELECT indexname FROM pg_indexes WHERE schemaname = \'public\' AND indexname = ANY($1::text[]) ORDER BY indexname',
        [nomesIndices]
    );
    const marcador = await rows(
        'SELECT id, detalhes FROM sistema_migrations WHERE id = $1',
        ['multiempresas-fase8-producao-ensaio-v1']
    );

    const aprovado = mode === 'apply'
        ? colunas.length === 2
            && colunas.every(c => c.is_nullable === 'NO')
            && dados.producoes_sem_empresa === 0
            && dados.sessoes_sem_empresa === 0
            && dados.solicitacoes_sem_empresa === 0
            && dados.producoes_outra_empresa === 0
            && dados.producoes_sem_op_pai === 7
            && dados.sessoes_sem_op_pai === 2
            && dados.solicitacoes_sem_producao === 1
            && constraints.length === nomesConstraints.length
            && indices.length === nomesIndices.length
            && marcador.length === 1
        : colunas.length === 0
            && constraints.length === 0
            && indices.length === 0
            && marcador.length === 0;

    console.log(JSON.stringify({
        mode,
        connectionString,
        colunas,
        dados,
        constraints,
        indices,
        marcador,
        aprovado,
    }, null, 2));
    if (!aprovado) process.exitCode = 1;
} finally {
    await pool.end();
}
