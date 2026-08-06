import assert from 'node:assert/strict';
import pg from 'pg';

const connectionString = process.argv[2]
    || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_ponto_motor_test';
const { Pool } = pg;

function marcadorPonto(ponto) {
    return ponto.tipo_excecao === 'SAIDA_ANTECIPADA'
        && Boolean(ponto.horario_real_s3)
        && ponto.saida_desfeita !== true;
}

function adaptarPontoApi(ponto) {
    return {
        ...ponto,
        saida_antecipada_ativa: marcadorPonto(ponto),
    };
}

function avaliarInterface(ponto, status = 'FORA_DO_HORARIO') {
    const saidaAntecipadaAtiva = ponto.saida_antecipada_ativa === true;
    return {
        marcador: saidaAntecipadaAtiva,
        exibeSaidaAntecipada: status === 'FORA_DO_HORARIO' && saidaAntecipadaAtiva,
        exibeDesfazer: status === 'FORA_DO_HORARIO' && saidaAntecipadaAtiva,
        detalhe: ponto.tipo_excecao === 'SAIDA_ANTECIPADA'
            ? 'Saída antecipada'
            : 'Saída final',
        pintaTrechoAntecipado: ponto.tipo_excecao === 'SAIDA_ANTECIPADA'
            && Boolean(ponto.horario_real_s3)
            && ponto.saida_desfeita !== true,
    };
}

async function executar() {
    const pool = new Pool({ connectionString });
    try {
        const sqlResult = await pool.query(`
            WITH casos(nome, tipo_excecao, horario_real_s3, saida_desfeita) AS (
                VALUES
                    ('S3 automático', NULL::text, '17:18'::text, FALSE),
                    ('S3 manual', 'SAIDA_ANTECIPADA', '16:40', FALSE),
                    ('S3 manual desfeito', 'SAIDA_ANTECIPADA', '16:40', TRUE)
            )
            SELECT
                nome,
                tipo_excecao,
                horario_real_s3,
                saida_desfeita,
                COALESCE(
                    tipo_excecao = 'SAIDA_ANTECIPADA'
                    AND horario_real_s3 IS NOT NULL
                    AND COALESCE(saida_desfeita, FALSE) = FALSE,
                    FALSE
                ) AS saida_antecipada_ativa
            FROM casos
            ORDER BY nome
        `);

        const esperado = new Map([
            ['S3 automático', {
                marcador: false,
                exibeSaidaAntecipada: false,
                exibeDesfazer: false,
                detalhe: 'Saída final',
                pintaTrechoAntecipado: false,
            }],
            ['S3 manual', {
                marcador: true,
                exibeSaidaAntecipada: true,
                exibeDesfazer: true,
                detalhe: 'Saída antecipada',
                pintaTrechoAntecipado: true,
            }],
            ['S3 manual desfeito', {
                marcador: false,
                exibeSaidaAntecipada: false,
                exibeDesfazer: false,
                detalhe: 'Saída antecipada',
                pintaTrechoAntecipado: false,
            }],
        ]);

        const resultados = sqlResult.rows.map((row) => {
            const ponto = adaptarPontoApi(row);
            const interfaceResult = avaliarInterface(ponto);
            const esperadoCaso = esperado.get(row.nome);

            assert.ok(esperadoCaso, `Cenário inesperado: ${row.nome}`);
            assert.equal(row.saida_antecipada_ativa, esperadoCaso.marcador, `${row.nome}: SQL`);
            assert.deepEqual(interfaceResult, esperadoCaso, `${row.nome}: interface`);

            return {
                nome: row.nome,
                marcador_sql: row.saida_antecipada_ativa,
                ...interfaceResult,
                backend_pode_desfazer: interfaceResult.exibeDesfazer,
            };
        });

        assert.equal(resultados.length, 3, 'Os três cenários não foram avaliados.');
        return { aprovado: true, cenarios: resultados };
    } finally {
        await pool.end();
    }
}

try {
    process.stdout.write(`${JSON.stringify(await executar(), null, 2)}\n`);
} catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
}
