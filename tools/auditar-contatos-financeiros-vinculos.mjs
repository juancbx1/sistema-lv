import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
let client;

try {
    client = await pool.connect();
    await client.query('BEGIN TRANSACTION READ ONLY');
    const result = await client.query(
        `SELECT
            e.id AS empresa_id,
            e.nome_fantasia AS empresa,
            COUNT(*) FILTER (
                WHERE ue.ativo
                  AND ue.elegivel_pagamento
            )::integer AS vinculos_elegiveis_ativos,
            COUNT(*) FILTER (
                WHERE ue.ativo
                  AND ue.elegivel_pagamento
                  AND ue.id_contato_financeiro IS NULL
            )::integer AS sem_contato,
            COUNT(*) FILTER (
                WHERE ue.id_contato_financeiro IS NOT NULL
                  AND c.id IS NULL
            )::integer AS contatos_invalidos,
            COUNT(*) FILTER (
                WHERE c.id IS NOT NULL
                  AND c.empresa_id <> ue.empresa_id
            )::integer AS contatos_de_outra_empresa
         FROM empresas e
         LEFT JOIN usuarios_empresas ue ON ue.empresa_id = e.id
         LEFT JOIN fc_contatos c ON c.id = ue.id_contato_financeiro
         GROUP BY e.id, e.nome_fantasia
         ORDER BY e.id`
    );
    const aprovado = result.rows.every(
        (row) => row.sem_contato === 0
            && row.contatos_invalidos === 0
            && row.contatos_de_outra_empresa === 0
    );
    const pendencias = await client.query(
        `SELECT
            ue.id AS vinculo_id,
            ue.usuario_id,
            u.nome,
            ue.empresa_id,
            e.nome_fantasia AS empresa,
            ue.tipos
         FROM usuarios_empresas ue
         JOIN usuarios u ON u.id = ue.usuario_id
         JOIN empresas e ON e.id = ue.empresa_id
         WHERE ue.ativo
           AND ue.elegivel_pagamento
           AND ue.id_contato_financeiro IS NULL
         ORDER BY e.id, u.nome`
    );
    console.log(JSON.stringify({
        somente_leitura: true,
        aprovado,
        empresas: result.rows,
        pendencias: pendencias.rows,
    }, null, 2));
    await client.query('ROLLBACK');
    process.exitCode = aprovado ? 0 : 1;
} finally {
    if (client) client.release();
    await pool.end();
}
