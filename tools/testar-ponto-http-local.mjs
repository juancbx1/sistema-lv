import 'dotenv/config';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.argv[2] || 'postgresql://postgres@127.0.0.1:55432/sistema_lv_ponto_http_test';
const baseUrl = process.argv[3] || 'http://127.0.0.1:3001';
const pool = new Pool({ connectionString, max: 4 });

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function dataLocalSaoPaulo() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

async function prepararJornada(funcionario, diasTrabalho) {
    await pool.query(`
        UPDATE usuarios_empresas
           SET horario_entrada_1 = '00:00',
               horario_saida_1 = '00:01',
               horario_entrada_2 = '00:02',
               horario_saida_2 = '00:03',
               horario_entrada_3 = '00:04',
               horario_saida_3 = '00:05',
               dias_trabalho = $3::jsonb,
               status_atual = 'LIVRE',
               status_data_modificacao = NULL,
               id_sessao_trabalho_atual = NULL
         WHERE usuario_id = $1 AND empresa_id = $2
    `, [funcionario.id, funcionario.empresa_id, JSON.stringify(diasTrabalho)]);
    await pool.query(`
        DELETE FROM ponto_diario
         WHERE funcionario_id = $1 AND empresa_id = $2 AND data = $3::date
    `, [funcionario.id, funcionario.empresa_id, dataLocalSaoPaulo()]);
    await pool.query(`
        DELETE FROM calendario_empresa
         WHERE empresa_id = $1 AND data = $2::date
    `, [funcionario.empresa_id, dataLocalSaoPaulo()]);
}

async function testar() {
    const dataHoje = dataLocalSaoPaulo();
    const funcionarioResult = await pool.query(`
        SELECT u.id, u.nome, ue.empresa_id, ue.id AS vinculo_id, ue.tipos
        FROM usuarios u
        JOIN usuarios_empresas ue ON ue.usuario_id = u.id
        WHERE ue.empresa_id = 1
          AND ue.ativo
          AND ue.tipos && ARRAY['costureira','tiktik']::text[]
        ORDER BY u.id
        LIMIT 3
    `);
    assert(funcionarioResult.rowCount >= 3, 'São necessários três funcionários de produção para os cenários HTTP.');
    const funcionario = funcionarioResult.rows[0];
    const funcionarioFaltaAntes = funcionarioResult.rows[1];
    const funcionarioFolga = funcionarioResult.rows[2];

    const diasTodos = { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true };
    const diasFolga = { 0: false, 1: false, 2: false, 3: false, 4: false, 5: false, 6: false };
    await prepararJornada(funcionario, diasTodos);
    await prepararJornada(funcionarioFaltaAntes, diasTodos);
    await prepararJornada(funcionarioFolga, diasFolga);

    const tokenFaltaAntes = jwt.sign({
        id: funcionarioFaltaAntes.id,
        nome: funcionarioFaltaAntes.nome,
        tipos: funcionarioFaltaAntes.tipos,
        empresa_id: funcionarioFaltaAntes.empresa_id,
        vinculo_empresa_id: funcionarioFaltaAntes.vinculo_id,
        superadministrador: false,
    }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const faltaAntesResponse = await fetch(`${baseUrl}/api/ponto/falta`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${tokenFaltaAntes}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ funcionario_id: funcionarioFaltaAntes.id, motivo: 'Falta antes da jornada — ensaio HTTP' }),
    });
    const faltaAntesBody = await faltaAntesResponse.json();
    assert(faltaAntesResponse.status === 200, `Falta antes da jornada falhou: ${faltaAntesResponse.status} ${JSON.stringify(faltaAntesBody)}`);
    const statusFaltaAntes = await pool.query(`
        SELECT status_atual, status_data_modificacao
        FROM usuarios_empresas
        WHERE usuario_id = $1 AND empresa_id = $2
    `, [funcionarioFaltaAntes.id, funcionarioFaltaAntes.empresa_id]);
    assert(
        statusFaltaAntes.rows[0]?.status_atual === 'FALTOU',
        `A falta antes da jornada não projetou FALTOU: ${JSON.stringify(statusFaltaAntes.rows[0])}`
    );

    const cronResponse = await fetch(`${baseUrl}/api/cron/registrar-intervalos`);
    const cronBody = await cronResponse.json();
    assert([200, 207].includes(cronResponse.status), `Cron HTTP falhou: ${cronResponse.status} ${JSON.stringify(cronBody)}`);

    const eventos = await pool.query(`
        SELECT tipo_evento
        FROM ponto_eventos
        WHERE empresa_id = $1 AND funcionario_id = $2 AND data_jornada = $3::date
        ORDER BY id
    `, [funcionario.empresa_id, funcionario.id, dataHoje]);
    const tipos = new Set(eventos.rows.map((row) => row.tipo_evento));
    for (const esperado of ['ENTRADA_AUTOMATICA', 'SAIDA_ALMOCO_AUTOMATICA', 'RETORNO_ALMOCO_AUTOMATICO', 'SAIDA_PAUSA_AUTOMATICA', 'RETORNO_PAUSA_AUTOMATICO', 'SAIDA_FINAL_AUTOMATICA']) {
        assert(tipos.has(esperado), `O cron HTTP não criou o evento ${esperado}.`);
    }

    const eventosFaltaAntes = await pool.query(`
        SELECT tipo_evento
        FROM ponto_eventos
        WHERE empresa_id = $1 AND funcionario_id = $2 AND data_jornada = $3::date
        ORDER BY id
    `, [funcionarioFaltaAntes.empresa_id, funcionarioFaltaAntes.id, dataHoje]);
    const tiposFaltaAntes = new Set(eventosFaltaAntes.rows.map((row) => row.tipo_evento));
    assert(tiposFaltaAntes.has('FALTA_REGISTRADA'), 'A falta antes da jornada não registrou FALTA_REGISTRADA.');
    const resultadoFaltaAntes = cronBody.resultados?.find((item) => item.funcionario_id === funcionarioFaltaAntes.id);
    assert(
        !tiposFaltaAntes.has('ENTRADA_AUTOMATICA'),
        `A falta antes da jornada permitiu entrada automática: status=${JSON.stringify(statusFaltaAntes.rows[0])}, resultado=${JSON.stringify(resultadoFaltaAntes)}, eventos=${JSON.stringify(eventosFaltaAntes.rows)}`
    );

    const eventosFolga = await pool.query(`
        SELECT tipo_evento
        FROM ponto_eventos
        WHERE empresa_id = $1 AND funcionario_id = $2 AND data_jornada = $3::date
    `, [funcionarioFolga.empresa_id, funcionarioFolga.id, dataHoje]);
    assert(eventosFolga.rowCount === 0, 'A folga/DSR HTTP gerou eventos ordinários.');

    const liberacaoAtrasadaResponse = await fetch(`${baseUrl}/api/ponto/liberar-intervalo`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${tokenFaltaAntes}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ funcionario_id: funcionario.id, tipo: 'ALMOCO' }),
    });
    const liberacaoAtrasadaBody = await liberacaoAtrasadaResponse.json();
    assert(liberacaoAtrasadaResponse.status === 200, `Confirmação tardia HTTP falhou: ${liberacaoAtrasadaResponse.status} ${JSON.stringify(liberacaoAtrasadaBody)}`);
    assert(liberacaoAtrasadaBody.ja_resolvida === true, 'A confirmação tardia não reconheceu o fallback do cron.');
    const saidaAutomatica = await pool.query(`
        SELECT tipo_evento, origem
        FROM ponto_eventos
        WHERE empresa_id = $1 AND funcionario_id = $2
          AND data_jornada = $3::date
          AND tipo_evento = 'SAIDA_ALMOCO_AUTOMATICA'
    `, [funcionario.empresa_id, funcionario.id, dataHoje]);
    assert(saidaAutomatica.rowCount === 1, 'A confirmação tardia criou uma segunda saída de almoço.');
    assert(saidaAutomatica.rows[0].origem === 'CRON', 'A saída aplicada pelo fallback não veio do CRON.');

    const token = jwt.sign({
        id: funcionario.id,
        nome: funcionario.nome,
        tipos: funcionario.tipos,
        empresa_id: funcionario.empresa_id,
        vinculo_empresa_id: funcionario.vinculo_id,
        superadministrador: false,
    }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const excecaoSemMotivoResponse = await fetch(`${baseUrl}/api/ponto/excecao`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            funcionario_id: funcionario.id,
            tipo_excecao: 'ATRASO',
            horario: '07:55',
        }),
    });
    const excecaoSemMotivoBody = await excecaoSemMotivoResponse.json();
    assert(excecaoSemMotivoResponse.status === 400, `Exceção sem motivo foi aceita: ${excecaoSemMotivoResponse.status} ${JSON.stringify(excecaoSemMotivoBody)}`);

    const excecaoResponse = await fetch(`${baseUrl}/api/ponto/excecao`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            funcionario_id: funcionario.id,
            tipo_excecao: 'ATRASO',
            horario: '07:55',
            motivo: 'Ensaio HTTP de atraso',
        }),
    });
    const excecaoBody = await excecaoResponse.json();
    assert(excecaoResponse.status === 200, `Excecao HTTP falhou: ${excecaoResponse.status} ${JSON.stringify(excecaoBody)}`);
    const excecaoEvento = await pool.query(`
        SELECT tipo_evento, horario_planejado, horario_efetivo
        FROM ponto_eventos
        WHERE empresa_id = $1 AND funcionario_id = $2
          AND data_jornada = $3::date
          AND tipo_evento = 'EXCECAO_MANUAL'
    `, [funcionario.empresa_id, funcionario.id, dataHoje]);
    assert(excecaoEvento.rowCount === 1, 'A excecao HTTP nao registrou EXCECAO_MANUAL.');

    const retornoResponse = await fetch(`${baseUrl}/api/ponto/retomar-trabalho`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            funcionario_id: funcionario.id,
            tipo: 'ALMOCO',
            motivo: 'Ensaio HTTP de retorno manual',
        }),
    });
    const retornoBody = await retornoResponse.json();
    assert(retornoResponse.status === 200, `Retorno manual HTTP falhou: ${retornoResponse.status} ${JSON.stringify(retornoBody)}`);
    const retornoEvento = await pool.query(`
        SELECT tipo_evento, horario_planejado, horario_efetivo
        FROM ponto_eventos
        WHERE empresa_id = $1 AND funcionario_id = $2
          AND data_jornada = $3::date
          AND tipo_evento = 'RETORNO_MANUAL'
    `, [funcionario.empresa_id, funcionario.id, dataHoje]);
    assert(retornoEvento.rowCount === 1, 'O retorno HTTP nao registrou RETORNO_MANUAL.');

    const retornoRepetidoResponse = await fetch(`${baseUrl}/api/ponto/retomar-trabalho`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            funcionario_id: funcionario.id,
            tipo: 'ALMOCO',
            motivo: 'Ensaio HTTP de retorno manual',
        }),
    });
    const retornoRepetidoBody = await retornoRepetidoResponse.json();
    assert(retornoRepetidoResponse.status === 200, `Retorno manual repetido falhou: ${retornoRepetidoResponse.status} ${JSON.stringify(retornoRepetidoBody)}`);
    const retornoEventosFinais = await pool.query(`
        SELECT id
        FROM ponto_eventos
        WHERE empresa_id = $1 AND funcionario_id = $2
          AND data_jornada = $3::date
          AND tipo_evento = 'RETORNO_MANUAL'
    `, [funcionario.empresa_id, funcionario.id, dataHoje]);
    assert(retornoEventosFinais.rowCount === 1, 'O retorno manual repetido criou mais de um evento.');

    const desfazerRetornoResponse = await fetch(`${baseUrl}/api/ponto/desfazer-retomada`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ funcionario_id: funcionario.id, tipo: 'ALMOCO' }),
    });
    const desfazerRetornoBody = await desfazerRetornoResponse.json();
    assert(desfazerRetornoResponse.status === 200, `Correcao HTTP falhou: ${desfazerRetornoResponse.status} ${JSON.stringify(desfazerRetornoBody)}`);
    const correcaoEvento = await pool.query(`
        SELECT tipo_evento, payload->>'acao' AS acao
        FROM ponto_eventos
        WHERE empresa_id = $1 AND funcionario_id = $2
          AND data_jornada = $3::date
          AND tipo_evento = 'CORRECAO_MANUAL'
          AND payload->>'acao' = 'DESFAZER_RETORNO_MANUAL'
    `, [funcionario.empresa_id, funcionario.id, dataHoje]);
    assert(correcaoEvento.rowCount === 1, 'A correcao HTTP nao registrou CORRECAO_MANUAL.');

    const tarefaFixtureResult = await pool.query(`
        SELECT p.id AS produto_id, op.numero AS op_numero
        FROM produtos p
        CROSS JOIN LATERAL (
            SELECT numero
            FROM ordens_de_producao
            ORDER BY numero
            LIMIT 1
        ) op
        ORDER BY p.id
        LIMIT 1
    `);
    assert(tarefaFixtureResult.rowCount === 1, 'Nao foi possivel encontrar produto e OP para o ensaio de tarefa.');
    const tarefaFixture = tarefaFixtureResult.rows[0];
    const tarefaResponse = await fetch(`${baseUrl}/api/producoes`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            funcionario_id: funcionario.id,
            opNumero: tarefaFixture.op_numero,
            produto_id: tarefaFixture.produto_id,
            processo: 'ENSAIO_EVENTO_TAREFA',
            quantidade: 1,
        }),
    });
    const tarefaBody = await tarefaResponse.json();
    assert(tarefaResponse.status === 201, `Atribuicao HTTP falhou: ${tarefaResponse.status} ${JSON.stringify(tarefaBody)}`);
    const tarefaId = tarefaBody.sessaoId;
    const eventosAtribuicao = await pool.query(`
        SELECT tipo_evento
        FROM ponto_eventos
        WHERE empresa_id = $1 AND funcionario_id = $2
          AND payload->>'tarefa_id' = $3
        ORDER BY id
    `, [funcionario.empresa_id, funcionario.id, String(tarefaId)]);
    const tiposTarefa = new Set(eventosAtribuicao.rows.map((row) => row.tipo_evento));
    assert(tiposTarefa.has('TAREFA_ATRIBUIDA'), 'A atribuicao HTTP nao registrou TAREFA_ATRIBUIDA.');
    assert(tiposTarefa.has('TAREFA_INICIADA'), 'A atribuicao HTTP nao registrou TAREFA_INICIADA.');

    const cancelResponse = await fetch(`${baseUrl}/api/producao/sessoes/cancelar`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id_sessao: tarefaId, motivo: 'Ensaio HTTP de cancelamento' }),
    });
    const cancelBody = await cancelResponse.json();
    assert(cancelResponse.status === 200, `Cancelamento HTTP falhou: ${cancelResponse.status} ${JSON.stringify(cancelBody)}`);
    const cancelEvento = await pool.query(`
        SELECT tipo_evento, origem, motivo
        FROM ponto_eventos
        WHERE empresa_id = $1 AND funcionario_id = $2
          AND tipo_evento = 'TAREFA_CANCELADA'
          AND payload->>'tarefa_id' = $3
    `, [funcionario.empresa_id, funcionario.id, String(tarefaId)]);
    assert(cancelEvento.rowCount === 1, 'O cancelamento HTTP nao registrou TAREFA_CANCELADA.');

    const segundoSupervisorResult = await pool.query(`
        SELECT u.id, u.nome, ue.tipos
        FROM usuarios u
        JOIN usuarios_empresas ue ON ue.usuario_id = u.id
        WHERE ue.empresa_id = $1
          AND ue.ativo
          AND u.id <> $2
        ORDER BY u.id
        LIMIT 1
    `, [funcionario.empresa_id, funcionario.id]);
    assert(segundoSupervisorResult.rowCount === 1, 'Nao foi possivel encontrar um segundo supervisor para o ensaio concorrente.');
    const segundoSupervisor = segundoSupervisorResult.rows[0];
    const tokenSegundoSupervisor = jwt.sign({
        id: segundoSupervisor.id,
        nome: segundoSupervisor.nome,
        tipos: segundoSupervisor.tipos,
        empresa_id: funcionario.empresa_id,
        vinculo_empresa_id: funcionario.vinculo_id,
        superadministrador: false,
    }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const faltaRequests = await Promise.all([
        fetch(`${baseUrl}/api/ponto/falta`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ funcionario_id: funcionario.id, motivo: 'Ensaio HTTP local A' }),
        }),
        fetch(`${baseUrl}/api/ponto/falta`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${tokenSegundoSupervisor}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ funcionario_id: funcionario.id, motivo: 'Ensaio HTTP local B' }),
        }),
    ]);
    const faltaBodies = await Promise.all(faltaRequests.map((response) => response.json()));
    faltaRequests.forEach((response, index) => {
        assert(response.status === 200, `Falta HTTP concorrente ${index + 1} falhou: ${response.status} ${JSON.stringify(faltaBodies[index])}`);
    });

    const faltaEvento = await pool.query(`
        SELECT tipo_evento, origem, motivo
        FROM ponto_eventos
        WHERE empresa_id = $1
          AND funcionario_id = $2
          AND data_jornada = $3::date
          AND tipo_evento = 'FALTA_REGISTRADA'
    `, [funcionario.empresa_id, funcionario.id, dataHoje]);
    assert(faltaEvento.rowCount === 1, 'A falta HTTP concorrente criou mais de um FALTA_REGISTRADA.');
    assert(faltaEvento.rows[0].origem === 'SUPERVISOR', 'A origem da falta HTTP não foi SUPERVISOR.');

    return {
        aprovado: true,
        data_jornada: dataHoje,
        funcionario_id: funcionario.id,
        cron_status: cronResponse.status,
        total_eventos_antes_da_falta: eventos.rowCount,
        falta_antes_status: faltaAntesResponse.status,
        falta_antes_eventos: [...tiposFaltaAntes],
        folga_eventos: eventosFolga.rowCount,
        confirmacao_tardia: liberacaoAtrasadaResponse.status,
        confirmacao_tardia_ja_resolvida: liberacaoAtrasadaBody.ja_resolvida,
        excecao_sem_motivo_status: excecaoSemMotivoResponse.status,
        tarefa_id: tarefaId,
        tarefa_eventos: [...tiposTarefa, 'TAREFA_CANCELADA'],
        excecao_status: excecaoResponse.status,
        retorno_manual_status: retornoResponse.status,
        retorno_manual_repetido_status: retornoRepetidoResponse.status,
        correcao_status: desfazerRetornoResponse.status,
        falta_statuses: faltaRequests.map((response) => response.status),
        falta_evento: faltaEvento.rows[0],
    };
}

try {
    assert(process.env.JWT_SECRET, 'JWT_SECRET não está configurado para o ensaio HTTP.');
    process.stdout.write(`${JSON.stringify(await testar(), null, 2)}\n`);
} catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
} finally {
    await pool.end();
}
