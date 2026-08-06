import pg from 'pg';
import {
    confirmarSaidaIntervaloPendente,
    reconciliarJornadaFuncionario,
} from '../api/ponto-motor.js';

const { Pool } = pg;
const connectionString = process.argv[2] || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_ponto_motor_test';
const pool = new Pool({ connectionString, max: 4 });

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function reconciliar(pool, args) {
    const poolClient = await pool.connect();
    await poolClient.query('BEGIN');
    try {
        const resultado = await reconciliarJornadaFuncionario(poolClient, args);
        await poolClient.query('COMMIT');
        return resultado;
    } catch (error) {
        await poolClient.query('ROLLBACK');
        throw error;
    } finally {
        poolClient.release();
    }
}

async function testar() {
    const vinculo = await pool.query(`
        SELECT usuario_id, empresa_id
        FROM usuarios_empresas
        WHERE ativo = TRUE
          AND horario_entrada_1 IS NOT NULL
        ORDER BY empresa_id, usuario_id
        LIMIT 1
    `);
    assert(vinculo.rowCount === 1, 'Nenhum vínculo com jornada foi encontrado.');

    const funcionarioId = vinculo.rows[0].usuario_id;
    const empresaId = vinculo.rows[0].empresa_id;
    const dataOrdinaria = '2026-08-03';
    const dataFeriado = '2026-08-04';
    const dataFalta = '2026-08-05';
    const dataConfirmacao = '2026-08-06';
    const dataDSR = '2026-08-08';

    await pool.query(`
        UPDATE usuarios_empresas
           SET horario_entrada_1 = '08:00',
               horario_saida_1 = '13:20',
               horario_entrada_2 = '14:20',
               horario_saida_2 = '16:15',
               horario_entrada_3 = '16:30',
               horario_saida_3 = '17:18',
               dias_trabalho = '{"1":true,"2":true,"3":true,"4":true,"5":true}'::jsonb,
               status_atual = 'LIVRE',
               status_data_modificacao = NULL
         WHERE usuario_id = $1 AND empresa_id = $2
    `, [funcionarioId, empresaId]);
    await pool.query(`DELETE FROM ponto_diario WHERE funcionario_id = $1 AND empresa_id = $2`, [funcionarioId, empresaId]);
    await pool.query(`DELETE FROM calendario_empresa WHERE empresa_id = $1 AND data IN ($2::date, $3::date, $4::date, $5::date, $6::date)`, [empresaId, dataOrdinaria, dataFeriado, dataFalta, dataConfirmacao, dataDSR]);

    const base = { empresaId, funcionarioId };
    const entrada = await reconciliar(pool, {
        ...base,
        dataJornada: dataOrdinaria,
        agora: new Date('2026-08-03T11:30:00.000Z'),
    });
    assert(entrada.eventos.some((evento) => evento.tipo_evento === 'ENTRADA_AUTOMATICA'), 'E1 automática não foi criada.');

    const pendente = await reconciliar(pool, {
        ...base,
        dataJornada: dataOrdinaria,
        agora: new Date('2026-08-03T16:20:00.000Z'),
    });
    assert(pendente.eventos.some((evento) => evento.tipo_evento === 'TRANSICAO_PENDENTE'), 'A saída de almoço não abriu pendência.');

    const almoco = await reconciliar(pool, {
        ...base,
        dataJornada: dataOrdinaria,
        agora: new Date('2026-08-03T16:21:00.000Z'),
    });
    assert(almoco.eventos.some((evento) => evento.tipo_evento === 'SAIDA_ALMOCO_AUTOMATICA'), 'Fallback de almoço não foi aplicado.');

    const retornoAlmoco = await reconciliar(pool, {
        ...base,
        dataJornada: dataOrdinaria,
        agora: new Date('2026-08-03T17:20:00.000Z'),
    });
    assert(retornoAlmoco.eventos.some((evento) => evento.tipo_evento === 'RETORNO_ALMOCO_AUTOMATICO'), 'Retorno E2 não foi criado.');

    const pausa = await reconciliar(pool, {
        ...base,
        dataJornada: dataOrdinaria,
        agora: new Date('2026-08-03T19:30:00.000Z'),
    });
    assert(pausa.eventos.some((evento) => evento.tipo_evento === 'SAIDA_PAUSA_AUTOMATICA'), 'Fallback de pausa não foi aplicado.');
    assert(pausa.eventos.some((evento) => evento.tipo_evento === 'RETORNO_PAUSA_AUTOMATICO'), 'Retorno E3 não foi criado.');

    const saidaFinal = await reconciliar(pool, {
        ...base,
        dataJornada: dataOrdinaria,
        agora: new Date('2026-08-03T20:18:00.000Z'),
    });
    assert(saidaFinal.eventos.some((evento) => evento.tipo_evento === 'SAIDA_FINAL_AUTOMATICA'), 'S3 automática não foi criada.');

    const pontoFinal = await pool.query(`
        SELECT horario_real_e1, horario_real_s1, horario_real_e2,
               horario_real_s2, horario_real_e3, horario_real_s3,
               tipo_excecao,
               COALESCE(tipo_excecao = 'SAIDA_ANTECIPADA'
                        AND horario_real_s3 IS NOT NULL
                        AND COALESCE(saida_desfeita, FALSE) = FALSE, FALSE) AS saida_antecipada_ativa
        FROM ponto_diario
        WHERE funcionario_id = $1 AND empresa_id = $2 AND data = $3::date
    `, [funcionarioId, empresaId, dataOrdinaria]);
    assert(pontoFinal.rowCount === 1, 'A projeção de ponto ordinária não foi criada.');
    const ponto = pontoFinal.rows[0];
    assert(String(ponto.horario_real_e1).startsWith('08:00'), 'E1 projetada incorretamente.');
    assert(String(ponto.horario_real_s1).startsWith('13:20'), 'S1 projetada incorretamente.');
    assert(String(ponto.horario_real_e2).startsWith('14:20'), 'E2 projetada incorretamente.');
    assert(String(ponto.horario_real_s2).startsWith('16:15'), 'S2 projetada incorretamente.');
    assert(String(ponto.horario_real_e3).startsWith('16:30'), 'E3 projetada incorretamente.');
    assert(String(ponto.horario_real_s3).startsWith('17:18'), 'S3 projetada incorretamente.');
    assert(ponto.tipo_excecao === null, 'S3 automática foi marcada como exceção.');
    assert(ponto.saida_antecipada_ativa === false, 'S3 automática foi marcada como saída antecipada.');

    const confirmacaoPendente = await reconciliar(pool, {
        ...base,
        dataJornada: dataConfirmacao,
        agora: new Date('2026-08-06T16:20:00.000Z'),
    });
    const transicaoConfirmacao = await pool.query(`
        SELECT id
        FROM ponto_transicoes_pendentes
        WHERE empresa_id = $1 AND funcionario_id = $2 AND data_jornada = $3::date AND tipo_intervalo = 'ALMOCO'
    `, [empresaId, funcionarioId, dataConfirmacao]);
    assert(transicaoConfirmacao?.rowCount === 1, 'A transição manual de almoço não foi aberta.');
    const confirmarClient = await pool.connect();
    let confirmacao;
    try {
        await confirmarClient.query('BEGIN');
        confirmacao = await confirmarSaidaIntervaloPendente(confirmarClient, {
            empresaId,
            funcionarioId,
            dataJornada: dataConfirmacao,
            tipoIntervalo: 'ALMOCO',
            agora: new Date('2026-08-06T16:20:10.000Z'),
            autorId: 999,
            autorNome: 'Supervisor de ensaio',
        });
        await confirmarClient.query('COMMIT');
    } catch (error) {
        await confirmarClient.query('ROLLBACK');
        throw error;
    } finally {
        confirmarClient.release();
    }
    assert(confirmacao.aplicada === true, 'A confirmação manual da saída não foi aplicada.');
    const confirmacaoPonto = await pool.query(`
        SELECT horario_real_s1
        FROM ponto_diario
        WHERE funcionario_id = $1 AND empresa_id = $2 AND data = $3::date
    `, [funcionarioId, empresaId, dataConfirmacao]);
    assert(confirmacaoPonto.rowCount === 1 && String(confirmacaoPonto.rows[0].horario_real_s1).startsWith('13:20'), 'A confirmação manual não projetou S1 planejada.');

    await pool.query(`INSERT INTO calendario_empresa (data, tipo, descricao, empresa_id) VALUES ($1, 'folga_empresa', 'ensaio', $2)`, [dataFeriado, empresaId]);
    const feriado = await reconciliar(pool, {
        ...base,
        dataJornada: dataFeriado,
        agora: new Date('2026-08-04T20:00:00.000Z'),
    });
    assert(feriado.eventos.length === 0 && feriado.motivo === 'FERIADO_DSR', 'Feriado recebeu transição ordinária.');

    const falta = await pool.query(`
        UPDATE usuarios_empresas
           SET status_atual = 'FALTOU', status_data_modificacao = $1::date
         WHERE usuario_id = $2 AND empresa_id = $3
    `, [dataFalta, funcionarioId, empresaId]);
    assert(falta.rowCount === 1, 'Não foi possível preparar o cenário de falta.');
    const ausente = await reconciliar(pool, {
        ...base,
        dataJornada: dataFalta,
        agora: new Date('2026-08-05T20:00:00.000Z'),
    });
    assert(ausente.eventos.length === 0 && ausente.motivo === 'JORNADA_CANCELADA_POR_FALTA', 'Falta recebeu transição automática.');

    await pool.query(`
        UPDATE usuarios_empresas
           SET status_atual = 'LIVRE', status_data_modificacao = NULL
         WHERE usuario_id = $1 AND empresa_id = $2
    `, [funcionarioId, empresaId]);
    const dsr = await reconciliar(pool, {
        ...base,
        dataJornada: dataDSR,
        agora: new Date('2026-08-08T20:00:00.000Z'),
    });
    assert(dsr.eventos.length === 0 && dsr.motivo === 'DSR_FOLGA', 'Sábado desmarcado recebeu transição automática.');

    const contagem = await pool.query(`SELECT COUNT(*)::int AS eventos FROM ponto_eventos WHERE empresa_id = $1`, [empresaId]);
    return {
        aprovado: true,
        empresa_id: empresaId,
        funcionario_id: funcionarioId,
        eventos_ordinarios: contagem.rows[0].eventos,
        cenarios: ['E1', 'pendência de almoço', 'fallback S1', 'retorno E2', 'fallback S2', 'retorno E3', 'S3', 'confirmação manual', 'feriado', 'falta', 'DSR/sábado'],
    };
}

try {
    process.stdout.write(`${JSON.stringify(await testar(), null, 2)}\n`);
} catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
} finally {
    await pool.end();
}
