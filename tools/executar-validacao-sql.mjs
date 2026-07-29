import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const arquivo = path.resolve(process.argv[2] || '');
if (!arquivo || !fs.existsSync(arquivo)) {
    throw new Error('Informe um arquivo SQL de validação existente.');
}

const sql = fs.readFileSync(arquivo, 'utf8').trim();
if (!/^BEGIN\s+READ\s+ONLY\s*;/i.test(sql) || !/ROLLBACK\s*;\s*$/i.test(sql)) {
    throw new Error('O SQL deve iniciar com BEGIN READ ONLY e terminar com ROLLBACK.');
}
if (/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|COMMIT)\b/i.test(sql)) {
    throw new Error('O arquivo contém comando incompatível com validação somente leitura.');
}

const connectionString = process.argv[3] || process.env.POSTGRES_URL;
if (!connectionString) throw new Error('POSTGRES_URL não configurada.');

const client = new pg.Client({ connectionString });
await client.connect();

try {
    const resultados = await client.query(sql);
    const lista = Array.isArray(resultados) ? resultados : [resultados];
    const consultas = lista
        .filter((resultado) => Array.isArray(resultado.rows) && resultado.rows.length > 0)
        .map((resultado) => resultado.rows);
    process.stdout.write(JSON.stringify({
        somente_leitura: true,
        arquivo,
        consultas,
    }, null, 2));
} finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
}
