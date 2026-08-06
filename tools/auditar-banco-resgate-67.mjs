import 'dotenv/config';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.POSTGRES_URL });
await client.connect();
try {
    const resultado = {};
    resultado.recentes = (await client.query(`
        SELECT id, empresa_id, usuario_id, tipo, quantidade, descricao,
               data_evento, data_referencia
          FROM banco_pontos_log
         WHERE empresa_id = 1
           AND usuario_id = 9
           AND data_evento >= NOW() - INTERVAL '1 hour'
         ORDER BY id DESC
    `)).rows;
    resultado.saldo = (await client.query(`
        SELECT saldo_atual, ultimo_calculo
          FROM banco_pontos_saldo
         WHERE empresa_id = 1 AND usuario_id = 9
    `)).rows;
    resultado.origens = (await client.query(`
        WITH dias(data) AS (
            VALUES ('2026-07-23'::date), ('2026-07-28'::date),
                   ('2026-07-29'::date), ('2026-07-30'::date),
                   ('2026-07-31'::date)
        )
        SELECT d.data,
               COALESCE((
                   SELECT SUM(p.pontos_gerados)
                     FROM producoes p
                    WHERE p.funcionario_id = 9
                      AND (p.data AT TIME ZONE 'America/Sao_Paulo')::date = d.data
               ), 0)::numeric AS producao,
               COALESCE((
                   SELECT SUM(pe.pontos)
                     FROM pontos_extras pe
                    WHERE pe.empresa_id = 1
                      AND pe.funcionario_id = 9
                      AND pe.data_referencia = d.data
                      AND pe.cancelado = FALSE
               ), 0)::numeric AS pontos_supervisor
          FROM dias d
         ORDER BY d.data
    `)).rows;
    resultado.metas = (await client.query(`
        SELECT mv.id AS versao_id, mv.data_inicio_vigencia,
               mr.tipo_usuario, mr.nivel, mr.pontos_meta, mr.descricao_meta
          FROM metas_versoes mv
          JOIN metas_regras mr ON mr.id_versao = mv.id
         WHERE mv.empresa_id = 1
           AND mr.tipo_usuario = 'costureira'
           AND mr.nivel = 4
         ORDER BY mv.data_inicio_vigencia DESC, mr.pontos_meta
    `)).rows;
    console.log(JSON.stringify(resultado, null, 2));
} finally {
    await client.end();
}
