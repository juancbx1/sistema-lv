// Motor único das transições ordinárias da jornada.
//
// O motor trabalha dentro da transação fornecida pelo chamador. Ele grava o
// evento append-only, atualiza a projeção legada ponto_diario e mantém o
// estado de uma saída de intervalo pendente na mesma transação.

import {
    abrirTransicaoPendente,
    ORIGENS_PONTO,
    pontoEventosDisponivel,
    registrarEventoPonto,
    resolverTransicaoPendente,
    STATUS_TRANSICAO,
    TIPOS_EVENTO_PONTO,
} from './ponto-eventos.js';
import {
    carregarContextoJornada,
    dataDoStatus,
    dataLocalSaoPaulo,
    ehDiaOrdinario,
    horaLocalSaoPaulo,
} from './jornada.js';

const CAMPOS_PONTO_PERMITIDOS = new Set([
    'horario_real_e1',
    'horario_real_s1',
    'horario_real_e2',
    'horario_real_s2',
    'horario_real_e3',
    'horario_real_s3',
]);

const INTERVALOS = Object.freeze([
    {
        tipo: 'ALMOCO',
        horarioSaida: 'horario_saida_1',
        horarioRetorno: 'horario_entrada_2',
        campoSaida: 'horario_real_s1',
        campoRetorno: 'horario_real_e2',
        eventoSaidaAutomatico: TIPOS_EVENTO_PONTO.SAIDA_ALMOCO_AUTOMATICA,
        eventoRetornoAutomatico: TIPOS_EVENTO_PONTO.RETORNO_ALMOCO_AUTOMATICO,
    },
    {
        tipo: 'PAUSA',
        horarioSaida: 'horario_saida_2',
        horarioRetorno: 'horario_entrada_3',
        campoSaida: 'horario_real_s2',
        campoRetorno: 'horario_real_e3',
        eventoSaidaAutomatico: TIPOS_EVENTO_PONTO.SAIDA_PAUSA_AUTOMATICA,
        eventoRetornoAutomatico: TIPOS_EVENTO_PONTO.RETORNO_PAUSA_AUTOMATICO,
    },
]);

function normalizarHora(horario) {
    if (!horario) return null;
    const valor = String(horario).substring(0, 5);
    if (!/^\d{2}:\d{2}$/.test(valor)) return null;
    const [hora, minuto] = valor.split(':').map(Number);
    if (hora > 23 || minuto > 59) return null;
    return valor;
}

function horaParaMinutos(horario) {
    const valor = normalizarHora(horario);
    if (!valor) return null;
    const [hora, minuto] = valor.split(':').map(Number);
    return hora * 60 + minuto;
}

// O fuso de negócio é America/Sao_Paulo. A aplicação opera atualmente em
// UTC-03; guardar o instante planejado é necessário para medir processamento
// tardio sem trocar o horário efetivo da jornada.
export function instantePlanejadoSaoPaulo(dataJornada, horario) {
    const hora = normalizarHora(horario);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataJornada)) || !hora) return null;
    return new Date(`${dataJornada}T${hora}:00-03:00`);
}

function exigirCampoPonto(campo) {
    if (!CAMPOS_PONTO_PERMITIDOS.has(campo)) {
        throw new Error(`Campo de ponto não permitido: ${campo}`);
    }
}

async function carregarProjecaoPonto(dbClient, funcionarioId, empresaId, dataJornada) {
    const result = await dbClient.query(
        `SELECT *
           FROM ponto_diario
          WHERE funcionario_id = $1
            AND data = $2::date
          ORDER BY id
          FOR UPDATE`,
        [funcionarioId, dataJornada]
    );

    const foraDaEmpresa = result.rows.find(
        (row) => row.empresa_id !== null && Number(row.empresa_id) !== Number(empresaId)
    );
    if (foraDaEmpresa) {
        const error = new Error('Projeção legada de ponto encontrada em outra empresa.');
        error.statusCode = 409;
        error.codigo = 'PONTO_EMPRESA_INCONSISTENTE';
        throw error;
    }

    return { row: result.rows.find((row) => Number(row.empresa_id) === Number(empresaId)) || result.rows[0] || null };
}

async function aplicarCampoPonto(dbClient, estado, {
    funcionarioId,
    empresaId,
    dataJornada,
    campo,
    valor,
}) {
    exigirCampoPonto(campo);
    if (!valor) return false;
    if (estado.row?.[campo]) return false;

    if (estado.row) {
        await dbClient.query(
            `UPDATE ponto_diario
                SET ${campo} = $1,
                    empresa_id = COALESCE(empresa_id, $2),
                    updated_at = NOW()
              WHERE id = $3`,
            [valor, empresaId, estado.row.id]
        );
        estado.row[campo] = valor;
        estado.row.empresa_id = estado.row.empresa_id || empresaId;
        return true;
    }

    const inserido = await dbClient.query(
        `INSERT INTO ponto_diario
            (funcionario_id, data, ${campo}, empresa_id)
         VALUES ($1, $2::date, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [funcionarioId, dataJornada, valor, empresaId]
    );
    if (inserido.rowCount > 0) {
        estado.row = inserido.rows[0];
        return true;
    }

    const recarregado = await carregarProjecaoPonto(dbClient, funcionarioId, empresaId, dataJornada);
    if (!recarregado.row) {
        throw new Error('A projeção de ponto não foi localizada após conflito de concorrência.');
    }
    estado.row = recarregado.row;
    if (estado.row[campo]) return false;

    await dbClient.query(
        `UPDATE ponto_diario
            SET ${campo} = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [valor, estado.row.id]
    );
    estado.row[campo] = valor;
    return true;
}

async function registrarEventoHorario(dbClient, {
    empresaId,
    funcionarioId,
    dataJornada,
    tipoEvento,
    idempotencyKey,
    horarioPlanejado,
    horarioEfetivo = horarioPlanejado,
    transicaoTipo = null,
    transicaoId = null,
    agora,
    payload = {},
}) {
    return registrarEventoPonto(dbClient, {
        empresaId,
        funcionarioId,
        dataJornada,
        tipoEvento,
        idempotencyKey,
        origem: ORIGENS_PONTO.CRON,
        transicaoTipo,
        transicaoId,
        horarioPlanejado,
        horarioEfetivo,
        payload: {
            ...payload,
            processado_em: new Date(agora).toISOString(),
        },
    });
}

async function reconciliarEntrada(dbClient, contexto, estado, agora, eventos) {
    const horario = normalizarHora(contexto.horario_entrada_1);
    const agoraMin = horaParaMinutos(horaLocalSaoPaulo(agora));
    const planejadoMin = horaParaMinutos(horario);
    if (!horario || planejadoMin === null || agoraMin < planejadoMin || estado.row?.horario_real_e1) return;

    const evento = await registrarEventoHorario(dbClient, {
        empresaId: contexto.empresa_id,
        funcionarioId: contexto.funcionario_id,
        dataJornada: contexto.data_jornada,
        tipoEvento: TIPOS_EVENTO_PONTO.ENTRADA_AUTOMATICA,
        idempotencyKey: `entrada:${contexto.data_jornada}:${contexto.funcionario_id}`,
        horarioPlanejado: horario,
        agora,
        payload: { tipo_jornada: contexto.tipo_dia },
    });
    await aplicarCampoPonto(dbClient, estado, {
        funcionarioId: contexto.funcionario_id,
        empresaId: contexto.empresa_id,
        dataJornada: contexto.data_jornada,
        campo: 'horario_real_e1',
        valor: horario,
    });
    if (evento.criado) eventos.push(evento.evento);
}

async function reconciliarIntervalo(dbClient, contexto, estado, intervalo, agora, eventos) {
    const horarioSaida = normalizarHora(contexto[intervalo.horarioSaida]);
    const horarioRetorno = normalizarHora(contexto[intervalo.horarioRetorno]);
    const agoraMin = horaParaMinutos(horaLocalSaoPaulo(agora));
    const saidaMin = horaParaMinutos(horarioSaida);
    const retornoMin = horaParaMinutos(horarioRetorno);
    if (!horarioSaida || !horarioRetorno || saidaMin === null || retornoMin === null || agoraMin < saidaMin) {
        return;
    }

    const abreEm = instantePlanejadoSaoPaulo(contexto.data_jornada, horarioSaida);
    const venceEm = new Date(abreEm.getTime() + 30_000);
    const abertura = await abrirTransicaoPendente(dbClient, {
        empresaId: contexto.empresa_id,
        funcionarioId: contexto.funcionario_id,
        dataJornada: contexto.data_jornada,
        tipoIntervalo: intervalo.tipo,
        horarioSaidaPlanejado: horarioSaida,
        horarioRetornoPlanejado: horarioRetorno,
        abreEm,
        venceEm,
        payload: { motor: 'reconciliacao-jornada' },
    });
    if (abertura.evento) eventos.push(abertura.evento);

    let transicao = abertura.transicao;
    if (transicao.status === STATUS_TRANSICAO.PENDENTE && new Date(agora) >= new Date(transicao.vence_em)) {
        const resolucao = await resolverTransicaoPendente(dbClient, {
            transicaoId: transicao.id,
            modo: 'automatico',
            agora,
            tipoEvento: intervalo.eventoSaidaAutomatico,
            idempotencyKey: `saida:${contexto.data_jornada}:${contexto.funcionario_id}:${intervalo.tipo}`,
            payload: { motor: 'reconciliacao-jornada' },
        });
        transicao = resolucao.transicao;
        if (resolucao.aplicada && resolucao.evento) eventos.push(resolucao.evento);
    }

    if (transicao.status !== STATUS_TRANSICAO.PENDENTE && transicao.horario_saida_efetivo) {
        await aplicarCampoPonto(dbClient, estado, {
            funcionarioId: contexto.funcionario_id,
            empresaId: contexto.empresa_id,
            dataJornada: contexto.data_jornada,
            campo: intervalo.campoSaida,
            valor: String(transicao.horario_saida_efetivo).substring(0, 5),
        });
    }

    if (agoraMin < retornoMin || estado.row?.[intervalo.campoRetorno] || transicao.status === STATUS_TRANSICAO.PENDENTE) return;

    const evento = await registrarEventoHorario(dbClient, {
        empresaId: contexto.empresa_id,
        funcionarioId: contexto.funcionario_id,
        dataJornada: contexto.data_jornada,
        tipoEvento: intervalo.eventoRetornoAutomatico,
        idempotencyKey: `retorno:${contexto.data_jornada}:${contexto.funcionario_id}:${intervalo.tipo}`,
        horarioPlanejado: horarioRetorno,
        agora,
        transicaoTipo: intervalo.tipo,
        transicaoId: transicao.id,
        payload: { motor: 'reconciliacao-jornada' },
    });
    await aplicarCampoPonto(dbClient, estado, {
        funcionarioId: contexto.funcionario_id,
        empresaId: contexto.empresa_id,
        dataJornada: contexto.data_jornada,
        campo: intervalo.campoRetorno,
        valor: horarioRetorno,
    });
    if (evento.criado) eventos.push(evento.evento);
}

async function reconciliarSaidaFinal(dbClient, contexto, estado, agora, eventos) {
    const horario = normalizarHora(contexto.horario_saida_3);
    const agoraMin = horaParaMinutos(horaLocalSaoPaulo(agora));
    const planejadoMin = horaParaMinutos(horario);
    if (!horario || planejadoMin === null || agoraMin < planejadoMin || estado.row?.horario_real_s3) return;

    const evento = await registrarEventoHorario(dbClient, {
        empresaId: contexto.empresa_id,
        funcionarioId: contexto.funcionario_id,
        dataJornada: contexto.data_jornada,
        tipoEvento: TIPOS_EVENTO_PONTO.SAIDA_FINAL_AUTOMATICA,
        idempotencyKey: `saida-final:${contexto.data_jornada}:${contexto.funcionario_id}`,
        horarioPlanejado: horario,
        agora,
        payload: { motor: 'reconciliacao-jornada' },
    });
    await aplicarCampoPonto(dbClient, estado, {
        funcionarioId: contexto.funcionario_id,
        empresaId: contexto.empresa_id,
        dataJornada: contexto.data_jornada,
        campo: 'horario_real_s3',
        valor: horario,
    });
    if (evento.criado) eventos.push(evento.evento);
}

export async function reconciliarJornadaFuncionario(dbClient, {
    empresaId,
    funcionarioId,
    dataJornada = dataLocalSaoPaulo(),
    agora = new Date(),
}) {
    const contexto = await carregarContextoJornada(dbClient, funcionarioId, empresaId, dataJornada);
    if (!ehDiaOrdinario(contexto)) {
        return { aplicado: false, motivo: contexto.tipo_dia, eventos: [], contexto };
    }
    if (contexto.falta_ativa) {
        return { aplicado: false, motivo: 'JORNADA_CANCELADA_POR_FALTA', eventos: [], contexto };
    }
    const statusRegistradoHoje = dataDoStatus(contexto.status_data_modificacao) === dataJornada;
    if (statusRegistradoHoje && contexto.status_atual === 'ALOCADO_EXTERNO') {
        return { aplicado: false, motivo: 'OUTRO_SETOR', eventos: [], contexto };
    }
    if (statusRegistradoHoje && contexto.status_atual === 'FORA_DO_HORARIO') {
        return { aplicado: false, motivo: 'SAIDA_ANTECIPADA', eventos: [], contexto };
    }

    const estado = await carregarProjecaoPonto(dbClient, funcionarioId, empresaId, dataJornada);
    const eventos = [];
    await reconciliarEntrada(dbClient, contexto, estado, agora, eventos);
    for (const intervalo of INTERVALOS) {
        await reconciliarIntervalo(dbClient, contexto, estado, intervalo, agora, eventos);
    }
    await reconciliarSaidaFinal(dbClient, contexto, estado, agora, eventos);

    return {
        aplicado: eventos.length > 0,
        motivo: eventos.length > 0 ? 'TRANSICOES_RECONCILIADAS' : 'SEM_TRANSICAO_PENDENTE',
        eventos,
        contexto,
        ponto: estado.row,
    };
}

export async function confirmarSaidaIntervaloPendente(dbClient, {
    empresaId,
    funcionarioId,
    dataJornada = dataLocalSaoPaulo(),
    tipoIntervalo,
    agora = new Date(),
    autorId = null,
    autorNome = null,
    motivo = null,
}) {
    const contexto = await carregarContextoJornada(dbClient, funcionarioId, empresaId, dataJornada);
    if (!ehDiaOrdinario(contexto)) {
        const error = new Error(`A saída ordinária não pode ser confirmada em ${contexto.tipo_dia}.`);
        error.statusCode = 409;
        error.codigo = 'DIA_NAO_ORDINARIO';
        throw error;
    }
    if (contexto.falta_ativa) {
        const error = new Error('A jornada foi cancelada por falta.');
        error.statusCode = 409;
        error.codigo = 'JORNADA_CANCELADA_POR_FALTA';
        throw error;
    }

    const pendenteResult = await dbClient.query(
        `SELECT *
           FROM ponto_transicoes_pendentes
          WHERE empresa_id = $1
            AND funcionario_id = $2
            AND data_jornada = $3::date
            AND tipo_intervalo = $4
          FOR UPDATE`,
        [empresaId, funcionarioId, dataJornada, tipoIntervalo]
    );
    if (pendenteResult.rowCount === 0) {
        const error = new Error('A transição ainda não foi aberta pelo motor de jornada.');
        error.statusCode = 409;
        error.codigo = 'TRANSICAO_NAO_ABERTA';
        throw error;
    }

    const pendente = pendenteResult.rows[0];
    if (pendente.status !== STATUS_TRANSICAO.PENDENTE) {
        return { aplicada: false, ja_resolvida: true, transicao: pendente };
    }
    if (new Date(agora) > new Date(pendente.vence_em)) {
        const error = new Error('A janela de confirmação terminou; registre uma exceção com motivo.');
        error.statusCode = 409;
        error.codigo = 'TRANSICAO_EXPIRADA';
        throw error;
    }

    const eventoSaida = tipoIntervalo === 'ALMOCO'
        ? TIPOS_EVENTO_PONTO.SAIDA_ALMOCO_CONFIRMADA
        : TIPOS_EVENTO_PONTO.SAIDA_PAUSA_CONFIRMADA;
    const resolucao = await resolverTransicaoPendente(dbClient, {
        transicaoId: pendente.id,
        modo: 'manual',
        horarioSaidaEfetivo: pendente.horario_saida_planejado,
        autorId,
        autorNome,
        motivo,
        agora,
        tipoEvento: eventoSaida,
        idempotencyKey: `saida-confirmada:${pendente.id}`,
        payload: { confirmacao_supervisor: true },
    });

    const estado = await carregarProjecaoPonto(dbClient, funcionarioId, empresaId, dataJornada);
    const intervalo = INTERVALOS.find((item) => item.tipo === tipoIntervalo);
    await aplicarCampoPonto(dbClient, estado, {
        funcionarioId,
        empresaId,
        dataJornada,
        campo: intervalo.campoSaida,
        valor: String(resolucao.transicao.horario_saida_efetivo).substring(0, 5),
    });
    return { ...resolucao, horario_retorno_planejado: pendente.horario_retorno_planejado };
}

export async function reconciliarJornadaFuncionarios(dbClient, {
    empresaId,
    funcionarioIds,
    agora = new Date(),
}) {
    const ids = [...new Set((funcionarioIds || []).filter((id) => id !== null && id !== undefined))];
    const motorAtivo = await pontoEventosDisponivel(dbClient);
    if (!motorAtivo || ids.length === 0) {
        return { motorAtivo, eventosAplicados: 0, erros: [] };
    }

    let eventosAplicados = 0;
    const erros = [];

    for (const funcionarioId of ids) {
        let transacaoAberta = false;
        try {
            await dbClient.query('BEGIN');
            transacaoAberta = true;
            const resultado = await reconciliarJornadaFuncionario(dbClient, {
                empresaId,
                funcionarioId,
                agora,
            });
            await dbClient.query('COMMIT');
            transacaoAberta = false;
            eventosAplicados += resultado.eventos?.length || 0;
        } catch (error) {
            if (transacaoAberta) {
                try {
                    await dbClient.query('ROLLBACK');
                } catch (rollbackError) {
                    erros.push({ funcionarioId, mensagem: rollbackError.message });
                }
            }
            erros.push({ funcionarioId, mensagem: error.message });
        }
    }

    return { motorAtivo, eventosAplicados, erros };
}

export { INTERVALOS, horaParaMinutos, normalizarHora };
