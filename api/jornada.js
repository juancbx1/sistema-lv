// Regras compartilhadas da jornada por vínculo empresarial.
// Este módulo não grava ponto: ele apenas resolve o contexto da data e valida
// se uma transição ordinária pode ser aplicada.

const FUSO_JORNADA = 'America/Sao_Paulo';
const DIAS_TRABALHO_PADRAO = { '0': false, '1': true, '2': true, '3': true, '4': true, '5': true, '6': false };
const TIPOS_DIA_NAO_ORDINARIO = new Set(['feriado_nacional', 'feriado_regional', 'folga_empresa']);

export class JornadaNaoOrdinariaError extends Error {
    constructor(message, codigo = 'DIA_NAO_ORDINARIO') {
        super(message);
        this.name = 'JornadaNaoOrdinariaError';
        this.statusCode = 409;
        this.codigo = codigo;
    }
}

export function dataLocalSaoPaulo(data = new Date()) {
    return data.toLocaleDateString('en-CA', { timeZone: FUSO_JORNADA });
}

export function horaLocalSaoPaulo(data = new Date()) {
    return data.toLocaleTimeString('en-GB', {
        timeZone: FUSO_JORNADA,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function diaSemanaLocal(dataISO) {
    const [ano, mes, dia] = String(dataISO).substring(0, 10).split('-').map(Number);
    if (![ano, mes, dia].every(Number.isFinite)) return null;
    return String(new Date(Date.UTC(ano, mes - 1, dia, 12)).getUTCDay());
}

export function diasTrabalhoNormalizados(dias) {
    if (!dias || typeof dias !== 'object' || Array.isArray(dias)) {
        return { ...DIAS_TRABALHO_PADRAO };
    }
    return { ...DIAS_TRABALHO_PADRAO, ...dias };
}

export function dataDoStatus(statusData) {
    if (!statusData) return null;
    // PostgreSQL devolve colunas `date` como Date em UTC. Como o campo
    // representa a data civil da jornada (e não um instante), preservar os
    // componentes UTC evita recuar um dia ao convertê-lo para São Paulo.
    if (statusData instanceof Date) return statusData.toISOString().substring(0, 10);
    if (typeof statusData === 'string') return statusData.substring(0, 10);
    return dataLocalSaoPaulo(new Date(statusData));
}

export function faltaAtivaHoje(contexto, dataJornada) {
    return contexto.status_atual === 'FALTOU'
        && dataDoStatus(contexto.status_data_modificacao) === dataJornada;
}

export function ehDiaOrdinario(contexto) {
    return contexto.tipo_dia === 'ORDINARIO';
}

export async function carregarContextoJornada(dbClient, funcionarioId, empresaId, dataJornada = dataLocalSaoPaulo()) {
    const result = await dbClient.query(`
        SELECT
            ue.usuario_id AS funcionario_id,
            ue.empresa_id,
            ue.dias_trabalho,
            ue.horario_entrada_1,
            ue.horario_saida_1,
            ue.horario_entrada_2,
            ue.horario_saida_2,
            ue.horario_entrada_3,
            ue.horario_saida_3,
            ue.id_sessao_trabalho_atual,
            ue.status_atual,
            ue.status_data_modificacao,
            EXISTS (
                SELECT 1
                FROM calendario_empresa c
                WHERE c.empresa_id = ue.empresa_id
                  AND c.data = $3::date
                  AND c.tipo = ANY($4::text[])
            ) AS possui_dia_nao_ordinario,
            EXISTS (
                SELECT 1
                FROM calendario_empresa c
                WHERE c.empresa_id = ue.empresa_id
                  AND c.data = $3::date
                  AND c.tipo = 'trabalho_extra'
            ) AS possui_trabalho_extra
        FROM usuarios_empresas ue
        WHERE ue.usuario_id = $1
          AND ue.empresa_id = $2
          AND ue.ativo = TRUE
        LIMIT 1
    `, [funcionarioId, empresaId, dataJornada, Array.from(TIPOS_DIA_NAO_ORDINARIO)]);

    if (result.rows.length === 0) {
        const error = new Error('Funcionário não encontrado na empresa ativa.');
        error.statusCode = 404;
        throw error;
    }

    const vinculo = result.rows[0];
    const dias = diasTrabalhoNormalizados(vinculo.dias_trabalho);
    const diaKey = diaSemanaLocal(dataJornada);
    const diaMarcado = diaKey !== null && dias[diaKey] === true;
    const possuiDiaNaoOrdinario = vinculo.possui_dia_nao_ordinario === true;
    const possuiTrabalhoExtra = vinculo.possui_trabalho_extra === true;

    let tipoDia = 'ORDINARIO';
    if (possuiTrabalhoExtra) {
        tipoDia = 'TRABALHO_ESPECIAL';
    } else if (possuiDiaNaoOrdinario) {
        tipoDia = 'FERIADO_DSR';
    } else if (!diaMarcado) {
        tipoDia = 'DSR_FOLGA';
    }

    return {
        ...vinculo,
        data_jornada: dataJornada,
        dia_semana: diaKey,
        dias_trabalho_normalizados: dias,
        dia_marcado: diaMarcado,
        tipo_dia: tipoDia,
        falta_ativa: faltaAtivaHoje(vinculo, dataJornada),
    };
}

export function exigirTransicaoOrdinaria(contexto, descricao = 'transição ordinária') {
    if (!ehDiaOrdinario(contexto)) {
        throw new JornadaNaoOrdinariaError(
            `Não é possível aplicar ${descricao}: a data ${contexto.data_jornada} é ${contexto.tipo_dia}.`,
            'DIA_NAO_ORDINARIO'
        );
    }
    if (contexto.falta_ativa) {
        throw new JornadaNaoOrdinariaError(
            `Não é possível aplicar ${descricao}: a jornada foi cancelada por falta.`,
            'JORNADA_CANCELADA_POR_FALTA'
        );
    }
}
