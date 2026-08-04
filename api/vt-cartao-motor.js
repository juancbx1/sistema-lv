// Motor do saldo do cartão VT — única autoridade de créditos, débitos e ajustes.
// Timezone de corte e datas civis: America/Sao_Paulo.

import {
    dataLocalSaoPaulo,
    diaSemanaLocal,
    diasTrabalhoNormalizados,
    horaLocalSaoPaulo,
} from './jornada.js';

export const VT_FUSO = 'America/Sao_Paulo';
/** Fallback se a jornada não tiver saída configurada. */
export const VT_CORTE_HORA = '18:00';
/** Soft-desconto de ida na UI: horário padrão se a jornada não tiver E1. */
export const VT_SOFT_IDA_HORA_PADRAO = '07:30';
/** Minutos após a última saída (S3→S2→S1) para fechar o consumo real do dia. */
export const VT_CORTE_APOS_SAIDA_MINUTOS = 60;
export const VT_PROVISIONAMENTO_HORAS = 48;
export const VT_AJUSTE_TETO_DIAS = 60;

export const TIPOS_FALTA_CALENDARIO = [
    'falta',
    'falta_justificada',
    'falta_injustificada',
];

const TIPOS_DIA_NAO_ORDINARIO = ['feriado_nacional', 'feriado_regional', 'folga_empresa'];

let schemaCache = { checkedAt: 0, ok: false };

function arred2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function erroVt(statusCode, message, codigo) {
    const err = new Error(message);
    err.statusCode = statusCode;
    if (codigo) err.codigo = codigo;
    return err;
}

export function dataCivilSp(date = new Date()) {
    return dataLocalSaoPaulo(date);
}

export function horaCivilSp(date = new Date()) {
    return horaLocalSaoPaulo(date);
}

export function valorVia(valorPassagemDiaria) {
    return arred2(Number(valorPassagemDiaria || 0) / 2);
}

/** Normaliza "7:30", "07:30:00" → "07:30". */
export function normalizarHoraHm(valor, fallback = VT_SOFT_IDA_HORA_PADRAO) {
    const s = String(valor || fallback).trim();
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return fallback;
    const h = String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, '0');
    const min = String(Math.min(59, Math.max(0, Number(m[2])))).padStart(2, '0');
    return `${h}:${min}`;
}

export function somarMinutosHm(horaHm, minutos) {
    const base = normalizarHoraHm(horaHm, VT_CORTE_HORA);
    const [h, m] = base.split(':').map(Number);
    let total = h * 60 + m + Number(minutos || 0);
    if (total < 0) total = 0;
    if (total > 23 * 60 + 59) total = 23 * 60 + 59;
    const hh = String(Math.floor(total / 60)).padStart(2, '0');
    const mm = String(total % 60).padStart(2, '0');
    return `${hh}:${mm}`;
}

/**
 * Horário de fechamento do consumo real do dia:
 * 1h após a última saída da jornada (S3 → S2 → S1). Sem saída: 18:00.
 */
export function horaCorteConsumoVinculo(vinculo) {
    const s3 = vinculo?.horario_saida_3;
    const s2 = vinculo?.horario_saida_2;
    const s1 = vinculo?.horario_saida_1;
    if (s3) {
        return {
            hora: somarMinutosHm(s3, VT_CORTE_APOS_SAIDA_MINUTOS),
            fonte: 'jornada_s3_mais_1h',
            saida_base: normalizarHoraHm(s3),
        };
    }
    if (s2) {
        return {
            hora: somarMinutosHm(s2, VT_CORTE_APOS_SAIDA_MINUTOS),
            fonte: 'jornada_s2_mais_1h',
            saida_base: normalizarHoraHm(s2),
        };
    }
    if (s1) {
        return {
            hora: somarMinutosHm(s1, VT_CORTE_APOS_SAIDA_MINUTOS),
            fonte: 'jornada_s1_mais_1h',
            saida_base: normalizarHoraHm(s1),
        };
    }
    return {
        hora: VT_CORTE_HORA,
        fonte: 'padrao_1800',
        saida_base: null,
    };
}

/**
 * true se o consumo real do dia dataRef já deve ter sido lançado.
 * @param {Date} [agora]
 * @param {string} [dataRef]
 * @param {object|null} [vinculo] — se informado, usa S3+1h da jornada
 */
export function passouCorteConsumo(
    agora = new Date(),
    dataRef = dataCivilSp(agora),
    vinculo = null
) {
    const hoje = dataCivilSp(agora);
    if (dataRef < hoje) return true;
    if (dataRef > hoje) return false;
    const { hora } = horaCorteConsumoVinculo(vinculo);
    return horaCivilSp(agora) >= hora;
}

/** @deprecated use passouCorteConsumo — mantido por compatibilidade */
export function passouCorte18h(agora = new Date(), dataRef = dataCivilSp(agora), vinculo = null) {
    return passouCorteConsumo(agora, dataRef, vinculo);
}

export function diasCivisEntre(inicioIso, fimIso) {
    const a = String(inicioIso).slice(0, 10);
    const b = String(fimIso).slice(0, 10);
    const da = new Date(`${a}T12:00:00Z`);
    const db = new Date(`${b}T12:00:00Z`);
    return Math.round((db - da) / 86400000);
}

export async function schemaVtDisponivel(dbClient) {
    const agora = Date.now();
    if (schemaCache.ok && agora - schemaCache.checkedAt < 60_000) return true;
    const res = await dbClient.query(`
        SELECT to_regclass('public.vt_cartao_movimentos') IS NOT NULL AS ok
    `);
    schemaCache = { checkedAt: agora, ok: Boolean(res.rows[0]?.ok) };
    return schemaCache.ok;
}

async function inserirMovimento(dbClient, mov) {
    const result = await dbClient.query(
        `INSERT INTO vt_cartao_movimentos (
            empresa_id, usuario_id, tipo, sentido, status_credito, valor,
            data_ref, data_origem, data_destino, recarga_id, registro_dia_id,
            movimento_origem_id, motivo, justificativa_fato, justificativa_demora,
            payload, ocorreu_em, valida_em, autor_id, autor_nome, idempotency_key
         ) VALUES (
            $1,$2,$3,$4,$5,$6,
            $7,$8,$9,$10,$11,
            $12,$13,$14,$15,
            $16::jsonb, COALESCE($17::timestamptz, NOW()), $18, $19, $20, $21
         )
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [
            mov.empresa_id,
            mov.usuario_id,
            mov.tipo,
            mov.sentido ?? null,
            mov.status_credito ?? null,
            arred2(mov.valor),
            mov.data_ref ?? null,
            mov.data_origem ?? null,
            mov.data_destino ?? null,
            mov.recarga_id ?? null,
            mov.registro_dia_id ?? null,
            mov.movimento_origem_id ?? null,
            mov.motivo ?? null,
            mov.justificativa_fato ?? null,
            mov.justificativa_demora ?? null,
            JSON.stringify(mov.payload || {}),
            mov.ocorreu_em ?? null,
            mov.valida_em ?? null,
            mov.autor_id ?? null,
            mov.autor_nome ?? null,
            mov.idempotency_key,
        ]
    );
    return result.rows[0] || null;
}

async function carregarVinculoVt(dbClient, usuarioId, empresaId) {
    const res = await dbClient.query(
        `SELECT ue.usuario_id, ue.empresa_id, ue.valor_passagem_diaria, ue.dias_trabalho,
                ue.horario_entrada_1, ue.horario_saida_1, ue.horario_saida_2, ue.horario_saida_3,
                ue.ativo, ue.elegivel_pagamento, u.nome
           FROM usuarios_empresas ue
           JOIN usuarios u ON u.id = ue.usuario_id
          WHERE ue.usuario_id = $1
            AND ue.empresa_id = $2
          LIMIT 1`,
        [usuarioId, empresaId]
    );
    if (!res.rows.length) {
        throw erroVt(404, 'Empregado não encontrado na empresa ativa.');
    }
    return res.rows[0];
}

function passouHorarioSp(agora, horaHm) {
    return horaCivilSp(agora) >= normalizarHoraHm(horaHm);
}

/**
 * Soft-desconto só de EXIBIÇÃO (não grava no livro).
 * Ideia: se o empregado já está no trabalho (após E1 / 07:30), a ida de ônibus
 * já aconteceu — o cartão na UI deve refletir isso sem esperar o corte das 18h.
 */
async function calcularSoftDescontosExibicao(dbClient, {
    empresaId,
    usuarioId,
    vinculo,
    valorDiario,
    disponivelLivro,
    agora = new Date(),
    forcarSoftIda = false,
}) {
    const via = valorVia(valorDiario);
    const horaIda = normalizarHoraHm(vinculo.horario_entrada_1, VT_SOFT_IDA_HORA_PADRAO);
    const vazio = {
        soft_descontos: [],
        soft_total: 0,
        saldo_exibido: arred2(Math.max(0, disponivelLivro)),
        soft_ativo: false,
        soft_desde_hora: horaIda,
        soft_fonte_hora: vinculo.horario_entrada_1 ? 'jornada_e1' : 'padrao_0730',
    };
    if (via <= 0 || disponivelLivro <= 0) return vazio;

    const hoje = dataCivilSp(agora);
    // Depois do corte (S3+1h) o livro real debita ida+volta — soft some.
    // (exceto simulação forçada de UI)
    if (!forcarSoftIda && passouCorteConsumo(agora, hoje, vinculo)) return vazio;

    // Snapshot de go-live no mesmo dia: saldo físico já está “no momento”; não soft-debita.
    if (!forcarSoftIda) {
        const snap = await dbClient.query(
            `SELECT 1
               FROM vt_cartao_movimentos
              WHERE empresa_id = $1
                AND usuario_id = $2
                AND tipo = 'ajuste'
                AND valor > 0
                AND motivo IN ('saldo_inicial_cartao', 'definir_saldo')
                AND data_ref = $3::date
              LIMIT 1`,
            [empresaId, usuarioId, hoje]
        );
        if (snap.rows.length) return vazio;
    }

    const eventos = await eventosCalendarioDia(dbClient, empresaId, usuarioId, hoje);
    const cls = classificarDia(vinculo, eventos, hoje);
    if (!cls.elegivelConsumo && !forcarSoftIda) return vazio;

    if (!forcarSoftIda && !passouHorarioSp(agora, horaIda)) return vazio;

    const movs = await movimentosDoDia(dbClient, empresaId, usuarioId, hoje);
    const resumo = resumoUsoDia(movs);

    // Segurança anti-bug do “risco + seta”: se já existe débito real do dia no livro,
    // soft NUNCA aparece (evita valor riscado maior que o saldo real no fim do dia).
    if (
        !forcarSoftIda
        && (resumo.consumiuIda
            || resumo.consumiuVolta
            || resumo.temDebitoBruto
            || resumo.marcas.ida
            || resumo.marcas.dia)
    ) {
        return vazio;
    }

    const softIda = Math.min(via, arred2(disponivelLivro));
    if (softIda <= 0) return vazio;

    return {
        soft_ativo: true,
        soft_total: softIda,
        soft_desde_hora: horaIda,
        soft_fonte_hora: vinculo.horario_entrada_1 ? 'jornada_e1' : 'padrao_0730',
        soft_simulado: Boolean(forcarSoftIda),
        saldo_exibido: arred2(Math.max(0, disponivelLivro - softIda)),
        soft_descontos: [
            {
                sentido: 'ida',
                valor: softIda,
                data_ref: hoje,
                desde_hora: horaIda,
                rotulo: 'Ida de hoje',
                mensagem_simples: 'Ida de hoje já descontada. A volta conta no fim do dia.',
            },
        ],
    };
}

async function eventosCalendarioDia(dbClient, empresaId, usuarioId, dataRef) {
    const res = await dbClient.query(
        `SELECT id, tipo, funcionario_id, descricao
           FROM calendario_empresa
          WHERE empresa_id = $1
            AND data = $2::date
            AND (funcionario_id IS NULL OR funcionario_id = $3)`,
        [empresaId, dataRef, usuarioId]
    );
    return res.rows;
}

function classificarDia(vinculo, eventos, dataRef) {
    const dias = diasTrabalhoNormalizados(vinculo.dias_trabalho);
    const dow = diaSemanaLocal(dataRef);
    const diaJornada = dow !== null && dias[dow] === true;
    const falta = eventos.find((e) => TIPOS_FALTA_CALENDARIO.includes(e.tipo));
    const feriado = eventos.some((e) => TIPOS_DIA_NAO_ORDINARIO.includes(e.tipo));
    const trabalhoExtra = eventos.some((e) => e.tipo === 'trabalho_extra' || e.tipo === 'dia_util_especial');

    let tipoDia = 'ORDINARIO';
    if (trabalhoExtra && !falta) tipoDia = 'TRABALHO_ESPECIAL';
    else if (feriado) tipoDia = 'FERIADO_DSR';
    else if (!diaJornada) tipoDia = 'DSR_FOLGA';
    else if (falta) tipoDia = 'FALTA';

    return {
        tipoDia,
        elegivelConsumo: (tipoDia === 'ORDINARIO' || tipoDia === 'TRABALHO_ESPECIAL') && !falta,
        falta,
        feriado,
    };
}

async function movimentosDoDia(dbClient, empresaId, usuarioId, dataRef) {
    const res = await dbClient.query(
        `SELECT *
           FROM vt_cartao_movimentos
          WHERE empresa_id = $1
            AND usuario_id = $2
            AND data_ref = $3::date
          ORDER BY ocorreu_em ASC, id ASC`,
        [empresaId, usuarioId, dataRef]
    );
    return res.rows;
}

function resumoUsoDia(movs) {
    const debitos = { ida: 0, volta: 0 };
    const devolucoes = { ida: 0, volta: 0 };
    const marcas = { ida: false, volta: false, dia: false };

    for (const m of movs) {
        const s = m.sentido || 'dia_completo';
        if (m.tipo === 'debito_consumo') {
            if (s === 'ida' || s === 'dia_completo') debitos.ida += 1;
            if (s === 'volta' || s === 'dia_completo') debitos.volta += 1;
        }
        if (m.tipo === 'devolucao_saldo') {
            if (s === 'ida' || s === 'dia_completo') devolucoes.ida += 1;
            if (s === 'volta' || s === 'dia_completo') devolucoes.volta += 1;
        }
        if (m.tipo === 'nao_usou_cartao') {
            if (s === 'ida') marcas.ida = true;
            else if (s === 'volta') marcas.volta = true;
            else marcas.dia = true;
        }
    }

    const liquidoIda = Math.max(0, debitos.ida - devolucoes.ida);
    const liquidoVolta = Math.max(0, debitos.volta - devolucoes.volta);

    return {
        liquidoIda,
        liquidoVolta,
        marcas,
        // vias efetivamente “consumidas” no saldo
        consumiuIda: liquidoIda > 0,
        consumiuVolta: liquidoVolta > 0,
        temDebitoBruto: debitos.ida + debitos.volta > 0,
    };
}

export async function validarCreditosVencidos(dbClient, empresaId, usuarioId = null) {
    if (!(await schemaVtDisponivel(dbClient))) return { atualizados: 0 };
    const params = [empresaId];
    let filtroUser = '';
    if (usuarioId != null) {
        params.push(usuarioId);
        filtroUser = `AND usuario_id = $${params.length}`;
    }
    const res = await dbClient.query(
        `UPDATE vt_cartao_movimentos
            SET status_credito = 'validada'
          WHERE empresa_id = $1
            ${filtroUser}
            AND tipo = 'credito_recarga'
            AND status_credito = 'provisionada'
            AND valida_em IS NOT NULL
            AND valida_em <= NOW()
          RETURNING id`,
        params
    );
    return { atualizados: res.rowCount || 0 };
}

export async function registrarCreditoRecarga(dbClient, {
    empresaId,
    usuarioId,
    valor,
    recargaId,
    datasLista = [],
    autorId = null,
    autorNome = null,
    provisionamentoHoras = VT_PROVISIONAMENTO_HORAS,
}) {
    if (!(await schemaVtDisponivel(dbClient))) return null;
    const valorNum = arred2(valor);
    if (valorNum <= 0) return null;

    const validaEm = new Date(Date.now() + provisionamentoHoras * 3600 * 1000);
    const mov = await inserirMovimento(dbClient, {
        empresa_id: empresaId,
        usuario_id: usuarioId,
        tipo: 'credito_recarga',
        status_credito: 'provisionada',
        valor: valorNum,
        data_ref: dataCivilSp(),
        recarga_id: recargaId,
        motivo: 'lote_vt',
        payload: { datas_lista: datasLista },
        valida_em: validaEm.toISOString(),
        autor_id: autorId,
        autor_nome: autorNome,
        idempotency_key: `credito_recarga:${empresaId}:${usuarioId}:${recargaId}`,
    });
    await recalcularProjecaoSaldo(dbClient, empresaId, usuarioId);
    return mov;
}

export async function registrarEstornoRecarga(dbClient, {
    empresaId,
    usuarioId,
    recargaId,
    autorId = null,
    autorNome = null,
}) {
    if (!(await schemaVtDisponivel(dbClient))) return null;

    const cred = await dbClient.query(
        `SELECT * FROM vt_cartao_movimentos
          WHERE empresa_id = $1
            AND usuario_id = $2
            AND recarga_id = $3
            AND tipo = 'credito_recarga'
          LIMIT 1`,
        [empresaId, usuarioId, recargaId]
    );
    if (!cred.rows.length) return null;

    const original = cred.rows[0];
    const mov = await inserirMovimento(dbClient, {
        empresa_id: empresaId,
        usuario_id: usuarioId,
        tipo: 'estorno',
        valor: original.valor,
        data_ref: dataCivilSp(),
        recarga_id: recargaId,
        movimento_origem_id: original.id,
        motivo: 'estorno_recarga',
        autor_id: autorId,
        autor_nome: autorNome,
        idempotency_key: `estorno_recarga:${empresaId}:${usuarioId}:${recargaId}`,
    });
    await recalcularProjecaoSaldo(dbClient, empresaId, usuarioId);
    return mov;
}

async function aplicarConsumoDia(dbClient, {
    empresaId,
    usuarioId,
    dataRef,
    valorDiario,
    usouIda = true,
    usouVolta = true,
    motivo = 'corte_jornada',
    autorId = null,
    autorNome = null,
}) {
    const via = valorVia(valorDiario);
    if (via <= 0) return [];

    const criados = [];
    if (usouIda) {
        const m = await inserirMovimento(dbClient, {
            empresa_id: empresaId,
            usuario_id: usuarioId,
            tipo: 'debito_consumo',
            sentido: 'ida',
            valor: via,
            data_ref: dataRef,
            motivo,
            autor_id: autorId,
            autor_nome: autorNome,
            idempotency_key: `debito:${empresaId}:${usuarioId}:${dataRef}:ida`,
        });
        if (m) criados.push(m);
    }
    if (usouVolta) {
        const m = await inserirMovimento(dbClient, {
            empresa_id: empresaId,
            usuario_id: usuarioId,
            tipo: 'debito_consumo',
            sentido: 'volta',
            valor: via,
            data_ref: dataRef,
            motivo,
            autor_id: autorId,
            autor_nome: autorNome,
            idempotency_key: `debito:${empresaId}:${usuarioId}:${dataRef}:volta`,
        });
        if (m) criados.push(m);
    }
    return criados;
}

function proximoDiaIso(dataIso) {
    const [y, m, d] = dataIso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 1, 12));
    return dt.toISOString().slice(0, 10);
}

async function encontrarProximoDiaElegivel(dbClient, vinculo, empresaId, usuarioId, aPartirDe) {
    let cursor = proximoDiaIso(aPartirDe);
    for (let i = 0; i < 60; i++) {
        const eventos = await eventosCalendarioDia(dbClient, empresaId, usuarioId, cursor);
        const cls = classificarDia(vinculo, eventos, cursor);
        if (cls.elegivelConsumo) return cursor;
        cursor = proximoDiaIso(cursor);
    }
    return null;
}

/**
 * Quando há falta no calendário: não debita o dia e registra transferência
 * simbólica (2 vias) para o próximo dia elegível — auditoria na aba Passagem.
 */
export async function processarFaltaCalendario(dbClient, {
    empresaId,
    usuarioId,
    dataRef,
    tipoFalta,
    calendarioEventoId = null,
    autorId = null,
    autorNome = null,
}) {
    if (!(await schemaVtDisponivel(dbClient))) return null;

    const vinculo = await carregarVinculoVt(dbClient, usuarioId, empresaId);
    const valorDiario = Number(vinculo.valor_passagem_diaria || 0);
    if (valorDiario <= 0) return null;

    const movs = await movimentosDoDia(dbClient, empresaId, usuarioId, dataRef);
    const resumo = resumoUsoDia(movs);
    const via = valorVia(valorDiario);

    // Se já debitou, devolve as vias consumidas (compensação por falta tardia)
    if (resumo.consumiuIda) {
        await inserirMovimento(dbClient, {
            empresa_id: empresaId,
            usuario_id: usuarioId,
            tipo: 'devolucao_saldo',
            sentido: 'ida',
            valor: via,
            data_ref: dataRef,
            motivo: tipoFalta,
            justificativa_fato: `Falta (${tipoFalta}) em ${dataRef}: devolução da ida debitada.`,
            justificativa_demora: 'Falta registrada após o consumo automático do dia.',
            payload: { calendario_evento_id: calendarioEventoId, origem: 'falta' },
            autor_id: autorId,
            autor_nome: autorNome,
            idempotency_key: `devolucao_falta:${empresaId}:${usuarioId}:${dataRef}:ida`,
        });
    }
    if (resumo.consumiuVolta) {
        await inserirMovimento(dbClient, {
            empresa_id: empresaId,
            usuario_id: usuarioId,
            tipo: 'devolucao_saldo',
            sentido: 'volta',
            valor: via,
            data_ref: dataRef,
            motivo: tipoFalta,
            justificativa_fato: `Falta (${tipoFalta}) em ${dataRef}: devolução da volta debitada.`,
            justificativa_demora: 'Falta registrada após o consumo automático do dia.',
            payload: { calendario_evento_id: calendarioEventoId, origem: 'falta' },
            autor_id: autorId,
            autor_nome: autorNome,
            idempotency_key: `devolucao_falta:${empresaId}:${usuarioId}:${dataRef}:volta`,
        });
    }

    const destino = await encontrarProximoDiaElegivel(
        dbClient,
        vinculo,
        empresaId,
        usuarioId,
        dataRef
    );

    await inserirMovimento(dbClient, {
        empresa_id: empresaId,
        usuario_id: usuarioId,
        tipo: 'transferencia_origem',
        sentido: 'dia_completo',
        valor: valorDiario,
        data_ref: dataRef,
        data_origem: dataRef,
        data_destino: destino,
        motivo: tipoFalta,
        payload: { calendario_evento_id: calendarioEventoId },
        autor_id: autorId,
        autor_nome: autorNome,
        idempotency_key: `transf_origem:${empresaId}:${usuarioId}:${dataRef}`,
    });

    if (destino) {
        await inserirMovimento(dbClient, {
            empresa_id: empresaId,
            usuario_id: usuarioId,
            tipo: 'transferencia_destino',
            sentido: 'dia_completo',
            valor: valorDiario,
            data_ref: destino,
            data_origem: dataRef,
            data_destino: destino,
            motivo: tipoFalta,
            payload: { calendario_evento_id: calendarioEventoId },
            autor_id: autorId,
            autor_nome: autorNome,
            idempotency_key: `transf_destino:${empresaId}:${usuarioId}:${dataRef}:${destino}`,
        });
    }

    // Marca o dia como sem uso de cartão por falta (evita novo débito)
    await inserirMovimento(dbClient, {
        empresa_id: empresaId,
        usuario_id: usuarioId,
        tipo: 'nao_usou_cartao',
        sentido: 'dia_completo',
        valor: 0,
        data_ref: dataRef,
        motivo: tipoFalta,
        payload: { por_falta: true },
        autor_id: autorId,
        autor_nome: autorNome,
        idempotency_key: `nao_usou_falta:${empresaId}:${usuarioId}:${dataRef}`,
    });

    await recalcularProjecaoSaldo(dbClient, empresaId, usuarioId);
    return { data_origem: dataRef, data_destino: destino };
}

/**
 * Reconcilia créditos 48h + débitos de dias elegíveis já passados do corte 18h.
 * Janela: últimos 90 dias até hoje.
 */
export async function reconciliarUsuarioVt(dbClient, empresaId, usuarioId, agora = new Date()) {
    if (!(await schemaVtDisponivel(dbClient))) {
        return { schema: false };
    }

    await validarCreditosVencidos(dbClient, empresaId, usuarioId);
    const vinculo = await carregarVinculoVt(dbClient, usuarioId, empresaId);
    const valorDiario = Number(vinculo.valor_passagem_diaria || 0);
    if (valorDiario <= 0) {
        await recalcularProjecaoSaldo(dbClient, empresaId, usuarioId);
        return { schema: true, valor_diario: 0, debitos: 0 };
    }

    const hoje = dataCivilSp(agora);

    // Início do consumo automático:
    // - recarga normal (credito_recarga): pode consumir a partir do dia da recarga;
    // - saldo inicial / definir saldo (ajuste go-live): o valor JÁ é o saldo físico naquele
    //   instante — não debitar o mesmo dia de novo (começa no dia seguinte).
    // - sem funding: não debita nada.
    const funding = await dbClient.query(
        `SELECT
            MIN(data_ref) FILTER (WHERE tipo = 'credito_recarga')::text AS primeira_recarga,
            MAX(data_ref) FILTER (
                WHERE tipo = 'ajuste'
                  AND valor > 0
                  AND motivo IN ('saldo_inicial_cartao', 'definir_saldo')
            )::text AS ultimo_snapshot
           FROM vt_cartao_movimentos
          WHERE empresa_id = $1
            AND usuario_id = $2`,
        [empresaId, usuarioId]
    );

    const primeiraRecarga = funding.rows[0]?.primeira_recarga
        ? String(funding.rows[0].primeira_recarga).slice(0, 10)
        : null;
    const ultimoSnapshot = funding.rows[0]?.ultimo_snapshot
        ? String(funding.rows[0].ultimo_snapshot).slice(0, 10)
        : null;

    if (!primeiraRecarga && !ultimoSnapshot) {
        await recalcularProjecaoSaldo(dbClient, empresaId, usuarioId);
        return { schema: true, valor_diario: valorDiario, debitos: 0, motivo: 'sem_funding' };
    }

    let cursor;
    if (ultimoSnapshot) {
        // Snapshot do cartão físico no dia D → consumo só a partir de D+1
        cursor = proximoDiaIso(ultimoSnapshot);
        // Se também houve recarga depois do snapshot, não voltar para trás do snapshot+1
        if (primeiraRecarga && primeiraRecarga > cursor) {
            cursor = primeiraRecarga;
        }
    } else {
        cursor = primeiraRecarga;
    }

    // teto de segurança: no máximo 90 dias para trás
    {
        const [y, m, d] = hoje.split('-').map(Number);
        const limite = new Date(Date.UTC(y, m - 1, d - 90, 12)).toISOString().slice(0, 10);
        if (cursor < limite) cursor = limite;
    }

    let debitosCriados = 0;
    while (cursor <= hoje) {
        if (!passouCorteConsumo(agora, cursor, vinculo)) {
            cursor = proximoDiaIso(cursor);
            continue;
        }

        const eventos = await eventosCalendarioDia(dbClient, empresaId, usuarioId, cursor);
        const cls = classificarDia(vinculo, eventos, cursor);

        if (cls.tipoDia === 'FALTA') {
            // Garante trilha de transferência se ainda não houver
            const movs = await movimentosDoDia(dbClient, empresaId, usuarioId, cursor);
            const temTransf = movs.some((m) => m.tipo === 'transferencia_origem');
            if (!temTransf && cls.falta) {
                await processarFaltaCalendario(dbClient, {
                    empresaId,
                    usuarioId,
                    dataRef: cursor,
                    tipoFalta: cls.falta.tipo,
                    calendarioEventoId: cls.falta.id,
                });
            }
            cursor = proximoDiaIso(cursor);
            continue;
        }

        if (!cls.elegivelConsumo) {
            cursor = proximoDiaIso(cursor);
            continue;
        }

        const movs = await movimentosDoDia(dbClient, empresaId, usuarioId, cursor);
        const resumo = resumoUsoDia(movs);

        // Marca de não uso (carona dia inteiro)
        if (resumo.marcas.dia) {
            cursor = proximoDiaIso(cursor);
            continue;
        }

        // Se já existe qualquer débito/devolução processado, não reprocessa o padrão
        if (resumo.temDebitoBruto || resumo.liquidoIda > 0 || resumo.liquidoVolta > 0) {
            cursor = proximoDiaIso(cursor);
            continue;
        }

        const usouIda = !resumo.marcas.ida;
        const usouVolta = !resumo.marcas.volta;
        if (!usouIda && !usouVolta) {
            cursor = proximoDiaIso(cursor);
            continue;
        }

        const criados = await aplicarConsumoDia(dbClient, {
            empresaId,
            usuarioId,
            dataRef: cursor,
            valorDiario,
            usouIda,
            usouVolta,
            motivo: 'corte_jornada',
        });
        debitosCriados += criados.length;
        cursor = proximoDiaIso(cursor);
    }

    await recalcularProjecaoSaldo(dbClient, empresaId, usuarioId);
    return { schema: true, valor_diario: valorDiario, debitos: debitosCriados };
}

export async function recalcularProjecaoSaldo(dbClient, empresaId, usuarioId) {
    if (!(await schemaVtDisponivel(dbClient))) return null;

    const vinculo = await carregarVinculoVt(dbClient, usuarioId, empresaId);
    const valorDiario = Number(vinculo.valor_passagem_diaria || 0);

    const res = await dbClient.query(
        `SELECT id, tipo, status_credito, valor, recarga_id
           FROM vt_cartao_movimentos
          WHERE empresa_id = $1
            AND usuario_id = $2`,
        [empresaId, usuarioId]
    );

    let disponivel = 0;
    let provisionado = 0;
    // Estornos cancelam o crédito original (duas passagens: créditos → estornos → demais)
    const creditoPorRecarga = new Map(); // key recarga_id|id -> { valor, status, estornado }
    let debitos = 0;
    let devolucoes = 0;
    let ajustes = 0; // valor com sinal (positivo credita, negativo debita)
    let estornosSemRecarga = 0;

    for (const row of res.rows) {
        if (row.tipo !== 'credito_recarga') continue;
        const key = row.recarga_id != null ? `r:${row.recarga_id}` : `id:${row.id}`;
        creditoPorRecarga.set(key, {
            valor: Number(row.valor) || 0,
            status: row.status_credito,
            estornado: false,
            recarga_id: row.recarga_id,
        });
    }
    for (const row of res.rows) {
        if (row.tipo !== 'estorno') continue;
        const v = Number(row.valor) || 0;
        const key = row.recarga_id != null ? `r:${row.recarga_id}` : null;
        if (key && creditoPorRecarga.has(key)) {
            creditoPorRecarga.get(key).estornado = true;
        } else {
            estornosSemRecarga += v;
        }
    }
    for (const row of res.rows) {
        const v = Number(row.valor) || 0;
        if (row.tipo === 'debito_consumo') debitos += v;
        else if (row.tipo === 'devolucao_saldo') devolucoes += v;
        else if (row.tipo === 'ajuste') ajustes += v;
    }

    for (const cred of creditoPorRecarga.values()) {
        if (cred.estornado) continue;
        if (cred.status === 'validada') disponivel += cred.valor;
        else provisionado += cred.valor;
    }

    disponivel = arred2(disponivel + devolucoes + ajustes - debitos - estornosSemRecarga);
    provisionado = arred2(Math.max(0, provisionado));

    await dbClient.query(
        `INSERT INTO vt_cartao_saldo (
            empresa_id, usuario_id, saldo_disponivel, saldo_provisionado,
            valor_passagem_diaria, atualizado_em
         ) VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (empresa_id, usuario_id) DO UPDATE SET
            saldo_disponivel = EXCLUDED.saldo_disponivel,
            saldo_provisionado = EXCLUDED.saldo_provisionado,
            valor_passagem_diaria = EXCLUDED.valor_passagem_diaria,
            atualizado_em = NOW()`,
        [empresaId, usuarioId, disponivel, provisionado, valorDiario]
    );

    return { saldo_disponivel: disponivel, saldo_provisionado: provisionado, valor_passagem_diaria: valorDiario };
}

/**
 * @param {{ reconciliar?: boolean, agora?: Date, forcarSoftIda?: boolean }} [opts]
 */
export async function obterSaldoVt(
    dbClient,
    empresaId,
    usuarioId,
    { reconciliar = true, agora = new Date(), forcarSoftIda = false } = {}
) {
    if (!(await schemaVtDisponivel(dbClient))) {
        return {
            schema_ok: false,
            saldo_disponivel: 0,
            saldo_provisionado: 0,
            valor_passagem_diaria: 0,
            dias_restantes_estimados: 0,
            vias_restantes_estimadas: 0,
            ultimos_movimentos: [],
            transferencias: [],
            mensagem: 'Schema do cartão VT ainda não está instalado.',
        };
    }

    if (reconciliar) {
        await reconciliarUsuarioVt(dbClient, empresaId, usuarioId, agora);
    } else {
        await validarCreditosVencidos(dbClient, empresaId, usuarioId);
        await recalcularProjecaoSaldo(dbClient, empresaId, usuarioId);
    }

    const vinculo = await carregarVinculoVt(dbClient, usuarioId, empresaId);
    const valorDiario = Number(vinculo.valor_passagem_diaria || 0);
    const via = valorVia(valorDiario);

    const saldoRes = await dbClient.query(
        `SELECT * FROM vt_cartao_saldo
          WHERE empresa_id = $1 AND usuario_id = $2`,
        [empresaId, usuarioId]
    );
    const saldo = saldoRes.rows[0] || {
        saldo_disponivel: 0,
        saldo_provisionado: 0,
    };

    const movsRes = await dbClient.query(
        `SELECT id, tipo, sentido, status_credito, valor, data_ref, data_origem, data_destino,
                motivo, justificativa_fato, justificativa_demora, ocorreu_em, valida_em,
                autor_nome, payload, recarga_id
           FROM vt_cartao_movimentos
          WHERE empresa_id = $1 AND usuario_id = $2
          ORDER BY ocorreu_em DESC, id DESC
          LIMIT 40`,
        [empresaId, usuarioId]
    );

    const transfRes = await dbClient.query(
        `SELECT data_origem, data_destino, motivo, ocorreu_em, autor_nome
           FROM vt_cartao_movimentos
          WHERE empresa_id = $1
            AND usuario_id = $2
            AND tipo = 'transferencia_origem'
          ORDER BY ocorreu_em DESC
          LIMIT 20`,
        [empresaId, usuarioId]
    );

    const disponivel = Number(saldo.saldo_disponivel) || 0;
    const provisionado = Number(saldo.saldo_provisionado) || 0;

    const agoraRef = agora instanceof Date ? agora : new Date();
    const hoje = dataCivilSp(agoraRef);
    const soft = await calcularSoftDescontosExibicao(dbClient, {
        empresaId,
        usuarioId,
        vinculo,
        valorDiario,
        disponivelLivro: disponivel,
        agora: agoraRef,
        forcarSoftIda,
    });

    // Métricas de “quanto ainda dá” usam o saldo exibido (com soft), mais honesto na manhã
    const baseExibicao = soft.saldo_exibido;
    const diasRestantes = valorDiario > 0 ? Math.floor(baseExibicao / valorDiario) : 0;
    const viasRestantes = via > 0 ? Math.floor(baseExibicao / via) : 0;

    const corteInfo = horaCorteConsumoVinculo(vinculo);
    let proximoConsumo = null;
    if (valorDiario > 0) {
        if (!passouCorteConsumo(agoraRef, hoje, vinculo)) {
            proximoConsumo = `${hoje}T${corteInfo.hora}:00-03:00`;
        } else {
            proximoConsumo = `${proximoDiaIso(hoje)}T${corteInfo.hora}:00-03:00`;
        }
    }

    const recargasProv = movsRes.rows
        .filter((m) => m.tipo === 'credito_recarga' && m.status_credito === 'provisionada')
        .map((m) => ({
            id: m.id,
            valor: Number(m.valor),
            valida_em: m.valida_em,
            recarga_id: m.recarga_id,
        }));

    return {
        schema_ok: true,
        usuario_id: usuarioId,
        nome: vinculo.nome,
        // Livro real (sem soft)
        saldo_disponivel: arred2(disponivel),
        // O que a empregada deve “sentir” no cartão agora
        saldo_exibido: soft.saldo_exibido,
        soft_ativo: soft.soft_ativo,
        soft_total: soft.soft_total,
        soft_descontos: soft.soft_descontos,
        soft_desde_hora: soft.soft_desde_hora || null,
        soft_fonte_hora: soft.soft_fonte_hora || null,
        soft_simulado: Boolean(soft.soft_simulado),
        saldo_provisionado: arred2(provisionado),
        valor_passagem_diaria: arred2(valorDiario),
        valor_via: via,
        dias_restantes_estimados: diasRestantes,
        vias_restantes_estimadas: viasRestantes,
        hora_corte_consumo: corteInfo.hora,
        fonte_corte_consumo: corteInfo.fonte,
        proximo_consumo_em: proximoConsumo,
        recargas_provisionadas: recargasProv,
        transferencias: transfRes.rows.map((t) => ({
            data_origem: t.data_origem,
            data_destino: t.data_destino,
            motivo: t.motivo,
            ocorreu_em: t.ocorreu_em,
            autor_nome: t.autor_nome,
        })),
        ultimos_movimentos: movsRes.rows.map(mapMovimentoApi),
    };
}

function isoData(valor) {
    if (valor == null) return null;
    if (valor instanceof Date) return valor.toISOString().slice(0, 10);
    const s = String(valor);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return s.slice(0, 10);
}

function mapMovimentoApi(m) {
    return {
        id: m.id,
        tipo: m.tipo,
        sentido: m.sentido,
        status_credito: m.status_credito,
        valor: Number(m.valor),
        data_ref: isoData(m.data_ref),
        data_origem: isoData(m.data_origem),
        data_destino: isoData(m.data_destino),
        motivo: m.motivo,
        justificativa_fato: m.justificativa_fato,
        justificativa_demora: m.justificativa_demora,
        ocorreu_em: m.ocorreu_em,
        valida_em: m.valida_em,
        autor_nome: m.autor_nome,
        recarga_id: m.recarga_id,
        payload: m.payload,
        rotulo: rotuloMovimento(m),
    };
}

function rotuloMovimento(m) {
    const via = m.sentido === 'ida' ? 'ida' : m.sentido === 'volta' ? 'volta' : 'dia';
    switch (m.tipo) {
        case 'credito_recarga':
            return m.status_credito === 'provisionada'
                ? 'Recarga provisionada (a caminho)'
                : 'Recarga validada no cartão';
        case 'debito_consumo':
            return `Consumo ${via}`;
        case 'devolucao_saldo':
            return `Saldo devolvido (${via})`;
        case 'nao_usou_cartao':
            return m.sentido === 'dia_completo' ? 'Não usou o cartão (dia)' : `Não usou cartão (${via})`;
        case 'transferencia_origem':
            return `Passagem transferida de ${fmtData(m.data_origem)} → ${fmtData(m.data_destino)}`;
        case 'transferencia_destino':
            return `Passagem recebida de ${fmtData(m.data_origem)}`;
        case 'estorno':
            return 'Estorno de recarga';
        case 'ajuste':
            return Number(m.valor) >= 0
                ? 'Ajuste de saldo (crédito no livro)'
                : 'Ajuste de saldo (redução no livro)';
        default:
            return m.tipo;
    }
}

function fmtData(iso) {
    if (!iso) return '—';
    const s = String(iso).slice(0, 10);
    const [y, m, d] = s.split('-');
    if (!y || !m || !d) return s;
    return `${d}/${m}/${y}`;
}

export async function detalheDiaVt(dbClient, empresaId, usuarioId, dataRef) {
    if (!(await schemaVtDisponivel(dbClient))) {
        return { schema_ok: false, data_ref: dataRef, movimentos: [] };
    }
    await reconciliarUsuarioVt(dbClient, empresaId, usuarioId);
    const vinculo = await carregarVinculoVt(dbClient, usuarioId, empresaId);
    const movs = await movimentosDoDia(dbClient, empresaId, usuarioId, dataRef);
    const resumo = resumoUsoDia(movs);
    const eventos = await eventosCalendarioDia(dbClient, empresaId, usuarioId, dataRef);
    const cls = classificarDia(vinculo, eventos, dataRef);

    return {
        schema_ok: true,
        data_ref: dataRef,
        valor_passagem_diaria: Number(vinculo.valor_passagem_diaria || 0),
        valor_via: valorVia(vinculo.valor_passagem_diaria),
        tipo_dia: cls.tipoDia,
        elegivel_consumo: cls.elegivelConsumo,
        uso_liquido: {
            ida: resumo.consumiuIda,
            volta: resumo.consumiuVolta,
        },
        movimentos: movs.map(mapMovimentoApi),
    };
}

/**
 * Ajuste de uso real (carona parcial/total), inclusive retroativo (teto 60 dias).
 * Justificativa do fato sempre obrigatória; demora obrigatória se data_ref < hoje civil SP
 * ou se já passou o corte do dia.
 */
export async function ajustarConsumoVt(dbClient, {
    empresaId,
    usuarioId,
    dataRef,
    usouIda,
    usouVolta,
    justificativaFato,
    justificativaDemora = '',
    autorId,
    autorNome,
    agora = new Date(),
}) {
    if (!(await schemaVtDisponivel(dbClient))) {
        throw erroVt(503, 'Schema do cartão VT ainda não está instalado. Execute a migration.', 'SCHEMA_VT_AUSENTE');
    }

    const data = String(dataRef).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        throw erroVt(400, 'data_ref inválida (use YYYY-MM-DD).');
    }
    if (typeof usouIda !== 'boolean' || typeof usouVolta !== 'boolean') {
        throw erroVt(400, 'Informe usou_ida e usou_volta (boolean).');
    }

    const fato = String(justificativaFato || '').trim();
    if (fato.length < 5) {
        throw erroVt(400, 'Justificativa do fato é obrigatória (mín. 5 caracteres).');
    }

    const hoje = dataCivilSp(agora);
    const atrasoDias = diasCivisEntre(data, hoje);
    if (atrasoDias > VT_AJUSTE_TETO_DIAS) {
        throw erroVt(
            400,
            `Ajuste permitido apenas para os últimos ${VT_AJUSTE_TETO_DIAS} dias.`,
            'AJUSTE_FORA_DA_JANELA'
        );
    }
    if (data > hoje) {
        throw erroVt(400, 'Não é possível ajustar uma data futura.');
    }

    const vinculo = await carregarVinculoVt(dbClient, usuarioId, empresaId);
    const precisaDemora = data < hoje || passouCorteConsumo(agora, data, vinculo);
    const demora = String(justificativaDemora || '').trim();
    if (precisaDemora && demora.length < 5) {
        throw erroVt(
            400,
            'Justificativa da demora é obrigatória quando o ajuste não é feito no dia (antes do corte).',
            'DEMORA_OBRIGATORIA'
        );
    }
    const valorDiario = Number(vinculo.valor_passagem_diaria || 0);
    if (valorDiario <= 0) {
        throw erroVt(409, 'Empregado sem valor de passagem diária configurado.');
    }
    const via = valorVia(valorDiario);

    // Garante reconciliação prévia (pode ter gerado débitos automáticos)
    await reconciliarUsuarioVt(dbClient, empresaId, usuarioId, agora);

    const movs = await movimentosDoDia(dbClient, empresaId, usuarioId, data);
    const resumo = resumoUsoDia(movs);

    const desejadoIda = usouIda;
    const desejadoVolta = usouVolta;
    const atualIda = resumo.consumiuIda;
    const atualVolta = resumo.consumiuVolta;

    const acoes = [];
    const tsKey = Date.now();

    // Marca explícita de não uso (para dias futuros ao corte ou reprocesso)
    if (!desejadoIda && !desejadoVolta) {
        await inserirMovimento(dbClient, {
            empresa_id: empresaId,
            usuario_id: usuarioId,
            tipo: 'nao_usou_cartao',
            sentido: 'dia_completo',
            valor: 0,
            data_ref: data,
            motivo: 'carona',
            justificativa_fato: fato,
            justificativa_demora: demora || null,
            autor_id: autorId,
            autor_nome: autorNome,
            idempotency_key: `nao_usou:${empresaId}:${usuarioId}:${data}:dia:${tsKey}`,
        });
    } else {
        if (!desejadoIda) {
            await inserirMovimento(dbClient, {
                empresa_id: empresaId,
                usuario_id: usuarioId,
                tipo: 'nao_usou_cartao',
                sentido: 'ida',
                valor: 0,
                data_ref: data,
                motivo: 'carona_parcial',
                justificativa_fato: fato,
                justificativa_demora: demora || null,
                autor_id: autorId,
                autor_nome: autorNome,
                idempotency_key: `nao_usou:${empresaId}:${usuarioId}:${data}:ida:${tsKey}`,
            });
        }
        if (!desejadoVolta) {
            await inserirMovimento(dbClient, {
                empresa_id: empresaId,
                usuario_id: usuarioId,
                tipo: 'nao_usou_cartao',
                sentido: 'volta',
                valor: 0,
                data_ref: data,
                motivo: 'carona_parcial',
                justificativa_fato: fato,
                justificativa_demora: demora || null,
                autor_id: autorId,
                autor_nome: autorNome,
                idempotency_key: `nao_usou:${empresaId}:${usuarioId}:${data}:volta:${tsKey}`,
            });
        }
    }

    // Devoluções
    if (atualIda && !desejadoIda) {
        const m = await inserirMovimento(dbClient, {
            empresa_id: empresaId,
            usuario_id: usuarioId,
            tipo: 'devolucao_saldo',
            sentido: 'ida',
            valor: via,
            data_ref: data,
            motivo: 'ajuste_consumo',
            justificativa_fato: fato,
            justificativa_demora: demora || null,
            payload: {
                usou_ida: usouIda,
                usou_volta: usouVolta,
                atraso_dias_civis: atrasoDias,
            },
            autor_id: autorId,
            autor_nome: autorNome,
            idempotency_key: `devolucao_ajuste:${empresaId}:${usuarioId}:${data}:ida:${tsKey}`,
        });
        if (m) acoes.push({ tipo: 'devolucao_saldo', sentido: 'ida', valor: via });
    }
    if (atualVolta && !desejadoVolta) {
        const m = await inserirMovimento(dbClient, {
            empresa_id: empresaId,
            usuario_id: usuarioId,
            tipo: 'devolucao_saldo',
            sentido: 'volta',
            valor: via,
            data_ref: data,
            motivo: 'ajuste_consumo',
            justificativa_fato: fato,
            justificativa_demora: demora || null,
            payload: {
                usou_ida: usouIda,
                usou_volta: usouVolta,
                atraso_dias_civis: atrasoDias,
            },
            autor_id: autorId,
            autor_nome: autorNome,
            idempotency_key: `devolucao_ajuste:${empresaId}:${usuarioId}:${data}:volta:${tsKey}`,
        });
        if (m) acoes.push({ tipo: 'devolucao_saldo', sentido: 'volta', valor: via });
    }

    // Débitos complementares (raro: marcou carona e depois corrigiu para usou)
    if (!atualIda && desejadoIda && passouCorteConsumo(agora, data, vinculo)) {
        const m = await inserirMovimento(dbClient, {
            empresa_id: empresaId,
            usuario_id: usuarioId,
            tipo: 'debito_consumo',
            sentido: 'ida',
            valor: via,
            data_ref: data,
            motivo: 'ajuste_consumo',
            justificativa_fato: fato,
            justificativa_demora: demora || null,
            autor_id: autorId,
            autor_nome: autorNome,
            idempotency_key: `debito_ajuste:${empresaId}:${usuarioId}:${data}:ida:${tsKey}`,
        });
        if (m) acoes.push({ tipo: 'debito_consumo', sentido: 'ida', valor: via });
    }
    if (!atualVolta && desejadoVolta && passouCorteConsumo(agora, data, vinculo)) {
        const m = await inserirMovimento(dbClient, {
            empresa_id: empresaId,
            usuario_id: usuarioId,
            tipo: 'debito_consumo',
            sentido: 'volta',
            valor: via,
            data_ref: data,
            motivo: 'ajuste_consumo',
            justificativa_fato: fato,
            justificativa_demora: demora || null,
            autor_id: autorId,
            autor_nome: autorNome,
            idempotency_key: `debito_ajuste:${empresaId}:${usuarioId}:${data}:volta:${tsKey}`,
        });
        if (m) acoes.push({ tipo: 'debito_consumo', sentido: 'volta', valor: via });
    }

    // Se ainda não passou o corte e o dia não tinha débitos, só as marcas bastam
    if (!passouCorteConsumo(agora, data, vinculo) && !resumo.temDebitoBruto) {
        // ok — reconciliação futura respeitará nao_usou_cartao
    }

    await recalcularProjecaoSaldo(dbClient, empresaId, usuarioId);
    const saldo = await obterSaldoVt(dbClient, empresaId, usuarioId, { reconciliar: false });
    const detalhe = await detalheDiaVt(dbClient, empresaId, usuarioId, data);

    return {
        ok: true,
        data_ref: data,
        acoes,
        atraso_dias_civis: atrasoDias,
        justificativa_fato: fato,
        justificativa_demora: demora || null,
        saldo,
        dia: detalhe,
    };
}

export async function listarSaldosVt(dbClient, empresaId, usuarioIds = []) {
    if (!(await schemaVtDisponivel(dbClient))) {
        return { schema_ok: false, itens: [] };
    }
    const ids = (usuarioIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) return { schema_ok: true, itens: [] };

    const itens = [];
    for (const uid of ids) {
        try {
            const s = await obterSaldoVt(dbClient, empresaId, uid, { reconciliar: true });
            itens.push(s);
        } catch (err) {
            itens.push({
                schema_ok: true,
                usuario_id: uid,
                erro: err.message,
                saldo_disponivel: 0,
                saldo_provisionado: 0,
            });
        }
    }
    return { schema_ok: true, itens };
}

/**
 * Define o saldo disponível do cartão no livro (go-live / correção).
 * - zerarLivro=true: apaga movimentos anteriores do vínculo e grava o valor alvo como ajuste inicial.
 * - zerarLivro=false: lança um ajuste com o delta até o valor alvo.
 * Valor livre (não precisa ser múltiplo da passagem do dia).
 */
export async function definirSaldoCartaoVt(dbClient, {
    empresaId,
    usuarioId,
    saldoAlvo,
    justificativaFato,
    zerarLivro = false,
    autorId = null,
    autorNome = null,
}) {
    if (!(await schemaVtDisponivel(dbClient))) {
        throw erroVt(503, 'Schema do cartão VT ainda não está instalado.', 'SCHEMA_VT_AUSENTE');
    }

    const alvo = arred2(saldoAlvo);
    if (!Number.isFinite(alvo) || alvo < 0) {
        throw erroVt(400, 'saldo_alvo deve ser um número >= 0.');
    }
    const fato = String(justificativaFato || '').trim();
    if (fato.length < 5) {
        throw erroVt(400, 'Justificativa do fato é obrigatória (mín. 5 caracteres).');
    }

    await carregarVinculoVt(dbClient, usuarioId, empresaId);

    if (zerarLivro) {
        await dbClient.query(
            `DELETE FROM vt_cartao_movimentos
              WHERE empresa_id = $1 AND usuario_id = $2`,
            [empresaId, usuarioId]
        );
    } else {
        // Evita que a reconciliação invente débitos no meio do ajuste pontual
        await validarCreditosVencidos(dbClient, empresaId, usuarioId);
    }

    const antes = await recalcularProjecaoSaldo(dbClient, empresaId, usuarioId);
    const saldoAnterior = arred2(antes?.saldo_disponivel || 0);
    const delta = arred2(alvo - saldoAnterior);

    if (Math.abs(delta) < 0.005) {
        const saldo = await obterSaldoVt(dbClient, empresaId, usuarioId, { reconciliar: false });
        return {
            ok: true,
            sem_alteracao: true,
            saldo_anterior: saldoAnterior,
            saldo_alvo: alvo,
            delta: 0,
            saldo,
        };
    }

    const mov = await inserirMovimento(dbClient, {
        empresa_id: empresaId,
        usuario_id: usuarioId,
        tipo: 'ajuste',
        valor: delta, // com sinal
        data_ref: dataCivilSp(),
        motivo: zerarLivro ? 'saldo_inicial_cartao' : 'definir_saldo',
        justificativa_fato: fato,
        payload: {
            saldo_anterior: saldoAnterior,
            saldo_alvo: alvo,
            zerar_livro: Boolean(zerarLivro),
        },
        autor_id: autorId,
        autor_nome: autorNome,
        idempotency_key: `definir_saldo:${empresaId}:${usuarioId}:${alvo}:${Date.now()}`,
    });

    await recalcularProjecaoSaldo(dbClient, empresaId, usuarioId);
    const saldo = await obterSaldoVt(dbClient, empresaId, usuarioId, { reconciliar: false });

    return {
        ok: true,
        sem_alteracao: false,
        saldo_anterior: saldoAnterior,
        saldo_alvo: alvo,
        delta,
        movimento_id: mov?.id || null,
        saldo,
    };
}
