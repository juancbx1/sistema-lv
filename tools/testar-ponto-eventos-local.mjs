import pg from 'pg';
import {
    abrirTransicaoPendente,
    registrarEventoPonto,
    registrarEventoTarefa,
    resolverTransicaoPendente,
    TIPOS_EVENTO_PONTO,
    TIPOS_EVENTO_TAREFA,
} from '../api/ponto-eventos.js';

const { Pool } = pg;
const connectionString = process.argv[2] || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_ponto_eventos_test';
const pool = new Pool({ connectionString, max: 8 });
const runId = `ensaio-ponto-eventos:${Date.now()}:${process.pid}`;
// A transição pendente tem uma chave única por funcionário/data/tipo. Usar
// uma data de ensaio nova evita que uma execução interrompida contamine a
// próxima, especialmente porque o livro de eventos é append-only.
const dataJornada = new Date(
    Date.now() + (365 + Math.floor(Math.random() * 8000)) * 24 * 60 * 60 * 1000
).toISOString().substring(0, 10);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rollbackSilencioso(client) {
    try {
        await client.query('ROLLBACK');
    } catch {
        // A conexão pode já ter sido encerrada pelo teste que falhou.
    }
}

async function testar() {
    const vinculo = await pool.query(`
        SELECT empresa_id, usuario_id
        FROM usuarios_empresas
        WHERE ativo = TRUE
        ORDER BY empresa_id, usuario_id
        LIMIT 1
    `);
    assert(vinculo.rowCount === 1, 'Nenhum vínculo empresarial ativo foi encontrado para o ensaio.');

    const empresaId = vinculo.rows[0].empresa_id;
    const funcionarioId = vinculo.rows[0].usuario_id;
    const baseEvento = {
        empresaId,
        funcionarioId,
        dataJornada,
        tipoEvento: TIPOS_EVENTO_PONTO.ENTRADA_AUTOMATICA,
        origem: 'SISTEMA',
        idempotencyKey: `${runId}:entrada`,
        horarioPlanejado: '08:00',
        horarioEfetivo: '08:00',
        payload: { ensaio: runId },
    };

    const idempotenciaClient = await pool.connect();
    let primeiroEvento;
    let segundoEvento;
    try {
        await idempotenciaClient.query('BEGIN');
        primeiroEvento = await registrarEventoPonto(idempotenciaClient, baseEvento);
        segundoEvento = await registrarEventoPonto(idempotenciaClient, baseEvento);
        await idempotenciaClient.query('COMMIT');
    } catch (error) {
        await rollbackSilencioso(idempotenciaClient);
        throw error;
    } finally {
        idempotenciaClient.release();
    }
    assert(primeiroEvento.criado === true, 'A primeira gravação do evento não foi criada.');
    assert(segundoEvento.criado === false, 'A repetição do evento não foi idempotente.');
    assert(primeiroEvento.evento.id === segundoEvento.evento.id, 'A idempotência retornou eventos diferentes.');

    const tarefaClient = await pool.connect();
    let tarefaEvento;
    let tarefaEventoRepetido;
    try {
        await tarefaClient.query('BEGIN');
        const tarefaArgs = {
            empresaId,
            funcionarioId,
            dataJornada,
            tipoEvento: TIPOS_EVENTO_TAREFA.ATRIBUIDA,
            tarefaTipo: 'PRODUCAO',
            tarefaId: 987654,
            idempotencyKey: `${runId}:tarefa:atribuida`,
            origem: 'SUPERVISOR',
            autorId: funcionarioId,
            autorNome: 'Ensaio',
            payload: { ensaio: runId },
        };
        tarefaEvento = await registrarEventoTarefa(tarefaClient, tarefaArgs);
        tarefaEventoRepetido = await registrarEventoTarefa(tarefaClient, tarefaArgs);
        await tarefaClient.query('COMMIT');
    } catch (error) {
        await rollbackSilencioso(tarefaClient);
        throw error;
    } finally {
        tarefaClient.release();
    }
    assert(tarefaEvento.criado === true, 'O evento de tarefa nao foi criado.');
    assert(tarefaEventoRepetido.criado === false, 'O evento de tarefa nao foi idempotente.');
    assert(tarefaEvento.evento.id === tarefaEventoRepetido.evento.id, 'A repeticao do evento de tarefa mudou o ID.');

    for (const operacao of ['UPDATE ponto_eventos SET motivo = \'tentativa\' WHERE id = $1', 'DELETE FROM ponto_eventos WHERE id = $1']) {
        const appendOnlyClient = await pool.connect();
        let bloqueada = false;
        try {
            await appendOnlyClient.query(operacao, [primeiroEvento.evento.id]);
        } catch {
            bloqueada = true;
            await rollbackSilencioso(appendOnlyClient);
        } finally {
            appendOnlyClient.release();
        }
        assert(bloqueada, `A operação append-only não foi bloqueada: ${operacao}`);
    }

    const rollbackClient = await pool.connect();
    try {
        await rollbackClient.query('BEGIN');
        await registrarEventoPonto(rollbackClient, {
            ...baseEvento,
            tipoEvento: TIPOS_EVENTO_PONTO.EXCECAO_MANUAL,
            idempotencyKey: `${runId}:rollback:evento`,
        });
        await abrirTransicaoPendente(rollbackClient, {
            empresaId,
            funcionarioId,
            dataJornada: '2026-08-04',
            tipoIntervalo: 'PAUSA',
            horarioSaidaPlanejado: '16:15',
            horarioRetornoPlanejado: '16:30',
            abreEm: new Date('2026-08-04T19:15:00.000Z'),
            venceEm: new Date('2026-08-04T19:15:30.000Z'),
            payload: { ensaio: runId },
        });
        await rollbackClient.query('ROLLBACK');
    } finally {
        rollbackClient.release();
    }
    const rollbackCheck = await pool.query(`
        SELECT
            (SELECT COUNT(*) FROM ponto_eventos WHERE empresa_id = $1 AND idempotency_key = $2) AS eventos,
            (SELECT COUNT(*) FROM ponto_transicoes_pendentes WHERE empresa_id = $1 AND funcionario_id = $3 AND data_jornada = '2026-08-04' AND tipo_intervalo = 'PAUSA') AS transicoes
    `, [empresaId, `${runId}:rollback:evento`, funcionarioId]);
    assert(Number(rollbackCheck.rows[0].eventos) === 0, 'O rollback deixou evento de ensaio persistido.');
    assert(Number(rollbackCheck.rows[0].transicoes) === 0, 'O rollback deixou transição de ensaio persistida.');

    const abreEm = new Date('2026-08-03T16:20:00.000Z');
    const venceEm = new Date('2026-08-03T16:20:30.000Z');
    const aberturaArgs = {
        empresaId,
        funcionarioId,
        dataJornada,
        tipoIntervalo: 'ALMOCO',
        horarioSaidaPlanejado: '13:20',
        horarioRetornoPlanejado: '14:20',
        abreEm,
        venceEm,
        payload: { ensaio: runId },
    };

    const abrirA = await pool.connect();
    const abrirB = await pool.connect();
    let aberturaA;
    let aberturaB;
    try {
        await abrirA.query('BEGIN');
        const promessaA = abrirTransicaoPendente(abrirA, aberturaArgs);
        await sleep(50);
        await abrirB.query('BEGIN');
        const promessaB = abrirTransicaoPendente(abrirB, aberturaArgs);
        aberturaA = await promessaA;
        await abrirA.query('COMMIT');
        aberturaB = await promessaB;
        await abrirB.query('COMMIT');
    } catch (error) {
        await rollbackSilencioso(abrirA);
        await rollbackSilencioso(abrirB);
        throw error;
    } finally {
        abrirA.release();
        abrirB.release();
    }
    assert(aberturaA.transicao.id === aberturaB.transicao.id, 'Chamadas concorrentes abriram transições diferentes.');
    assert(aberturaA.evento.id === aberturaB.evento.id, 'Chamadas concorrentes criaram eventos de abertura diferentes.');

    const resolverArgs = {
        transicaoId: aberturaA.transicao.id,
        modo: 'automatico',
        agora: new Date('2026-08-03T16:21:00.000Z'),
        tipoEvento: TIPOS_EVENTO_PONTO.SAIDA_ALMOCO_AUTOMATICA,
        idempotencyKey: `${runId}:saida-almoco`,
        payload: { ensaio: runId },
    };
    const resolverA = await pool.connect();
    const resolverB = await pool.connect();
    let resolucaoA;
    let resolucaoB;
    try {
        await resolverA.query('BEGIN');
        const promessaA = resolverTransicaoPendente(resolverA, resolverArgs);
        await sleep(50);
        await resolverB.query('BEGIN');
        const promessaB = resolverTransicaoPendente(resolverB, resolverArgs);
        resolucaoA = await promessaA;
        await resolverA.query('COMMIT');
        resolucaoB = await promessaB;
        await resolverB.query('COMMIT');
    } catch (error) {
        await rollbackSilencioso(resolverA);
        await rollbackSilencioso(resolverB);
        throw error;
    } finally {
        resolverA.release();
        resolverB.release();
    }
    assert(resolucaoA.aplicada === true, 'A primeira resolução automática não foi aplicada.');
    assert(resolucaoB.ja_resolvida === true, 'A resolução concorrente não reconheceu a transição já resolvida.');

    const finalCheck = await pool.query(`
        SELECT
            t.status,
            t.horario_saida_efetivo,
            COUNT(e.id) FILTER (WHERE e.idempotency_key = $4) AS eventos_resolucao
        FROM ponto_transicoes_pendentes t
        LEFT JOIN ponto_eventos e ON e.transicao_id = t.id
        WHERE t.id = $1
          AND t.empresa_id = $2
          AND t.funcionario_id = $3
        GROUP BY t.id, t.status, t.horario_saida_efetivo
    `, [aberturaA.transicao.id, empresaId, funcionarioId, `${runId}:saida-almoco`]);
    assert(finalCheck.rowCount === 1, 'A transição concorrente não foi localizada na validação final.');
    assert(finalCheck.rows[0].status === 'APLICADA_AUTOMATICAMENTE', 'Status final da transição automática incorreto.');
    assert(String(finalCheck.rows[0].horario_saida_efetivo).startsWith('13:20'), 'Fallback não preservou o horário planejado.');
    assert(Number(finalCheck.rows[0].eventos_resolucao) === 1, 'A resolução concorrente criou mais de um evento.');

    return {
        aprovado: true,
        run_id: runId,
        empresa_id: empresaId,
        funcionario_id: funcionarioId,
        transicao_id: aberturaA.transicao.id,
        testes: [
            'idempotência de evento',
            'append-only em UPDATE e DELETE',
            'rollback transacional',
            'concorrência na abertura de transição',
            'concorrência na resolução de transição',
            'fallback com horário planejado',
            'idempotência de evento de tarefa',
        ],
    };
}

try {
    const resultado = await testar();
    process.stdout.write(`${JSON.stringify(resultado, null, 2)}\n`);
} catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
} finally {
    await pool.end();
}
