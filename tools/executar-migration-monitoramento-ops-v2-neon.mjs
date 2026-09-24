import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

if (process.env.MONITORAMENTO_OPS_V2_NEON_CONFIRM !== 'SIM') {
    throw new Error('Defina MONITORAMENTO_OPS_V2_NEON_CONFIRM=SIM para autorizar a migration na Neon.');
}

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) throw new Error('POSTGRES_URL não configurada.');

const destino = new URL(connectionString);
if (['127.0.0.1', 'localhost', '::1'].includes(destino.hostname)) {
    throw new Error('Execução recusada: o destino informado é local.');
}

const migrationPath = path.resolve('_planejamento/migration-monitoramento-ops-v2.sql');
const validationPath = path.resolve('_planejamento/validacao-monitoramento-ops-v2.sql');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');
const validationSql = fs.readFileSync(validationPath, 'utf8');
const migrationSha256 = crypto.createHash('sha256').update(migrationSql).digest('hex');

const client = new Client({ connectionString });
await client.connect();

try {
    await client.query("SET statement_timeout = '60s'");
    await client.query("SET lock_timeout = '10s'");

    const preflight = (await client.query(`
        SELECT
            current_database() AS banco,
            current_setting('server_version') AS versao_postgresql,
            EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'ordens_de_producao'
                  AND column_name = 'empresa_id'
                  AND data_type = 'integer'
                  AND is_nullable = 'NO'
            ) AS op_empresa_prerequisito,
            to_regclass('public.op_monitoramento_impedimentos') AS impedimentos_existente,
            to_regclass('public.op_monitoramento_adiamentos') AS adiamentos_existente,
            to_regclass('public.op_monitoramento_lotes') AS lotes_existente,
            (
                SELECT COUNT(*)::integer
                FROM sistema_migrations
                WHERE id = 'monitoramento-ops-v2'
            ) AS migration_registrada
    `)).rows[0];

    if (preflight.banco !== 'neondb') {
        throw new Error(`Execução recusada: banco inesperado (${preflight.banco}).`);
    }
    if (!preflight.op_empresa_prerequisito) {
        throw new Error('Execução recusada: ordens_de_producao.empresa_id INTEGER NOT NULL não encontrado.');
    }
    if (
        preflight.impedimentos_existente
        || preflight.adiamentos_existente
        || preflight.lotes_existente
        || Number(preflight.migration_registrada) !== 0
    ) {
        throw new Error('Execução recusada: a estrutura ou o marcador já existe; rode somente o validador.');
    }

    await client.query("SELECT pg_advisory_lock(hashtext('monitoramento-ops-v2'))");
    try {
        await client.query(migrationSql);
    } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext('monitoramento-ops-v2'))").catch(() => undefined);
    }

    const resultadoValidacao = await client.query(validationSql);
    const validacao = (Array.isArray(resultadoValidacao) ? resultadoValidacao : [resultadoValidacao])
        .flatMap((resultado) => resultado.rows || [])
        .find((linha) => Object.hasOwn(linha, 'aprovado'));
    if (validacao.aprovado !== true) {
        throw new Error(`Validação pós-migration reprovada: ${JSON.stringify(validacao)}`);
    }

    process.stdout.write(`${JSON.stringify({
        aprovado: true,
        banco: preflight.banco,
        versao_postgresql: preflight.versao_postgresql,
        migration_sha256: migrationSha256,
        validacao,
    }, null, 2)}\n`);
} finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
}
