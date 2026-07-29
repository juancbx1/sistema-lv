import 'dotenv/config';
import pg from 'pg';

const connectionString = process.argv[2] || process.env.POSTGRES_URL;
if (!connectionString) {
    throw new Error('POSTGRES_URL não configurada.');
}

const client = new pg.Client({ connectionString });
await client.connect();

try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query(
        `SELECT c.id,
                c.nome,
                c.empresa_id,
                g.nome AS grupo,
                g.tipo
           FROM fc_categorias c
           JOIN fc_grupos_financeiros g
             ON g.id = c.id_grupo
            AND g.empresa_id = c.empresa_id
          WHERE c.id = ANY($1::int[])
          ORDER BY c.id`,
        [[13, 15, 37, 52, 88, 89]]
    );
    process.stdout.write(JSON.stringify({
        somente_leitura: true,
        categorias: result.rows,
    }, null, 2));
} finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
}
