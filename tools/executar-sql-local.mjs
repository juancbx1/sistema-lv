import fs from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.argv[2];
const sqlPath = process.argv[3];
if (!connectionString || !sqlPath || (!connectionString.includes('127.0.0.1') && !connectionString.includes('localhost'))) {
    throw new Error('Informe URL PostgreSQL local e arquivo SQL.');
}

const pool = new pg.Pool({ connectionString });
try {
    const sql = await fs.readFile(sqlPath, 'utf8');
    await pool.query(sql);
    console.log(JSON.stringify({ aplicado: true, connectionString, sqlPath }, null, 2));
} finally {
    await pool.end();
}
