// api/producoes.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';
// Importe a função de buscar permissões completas
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';
import { verificarGincanasAposProducao } from './gincanas.js';
import { registrarAuditoria } from './audit.js';
import { obterEmpresaIdDoContexto } from './contexto-empresa.js';
import { carregarContextoJornada, ehDiaOrdinario, dataLocalSaoPaulo } from './jornada.js';
import {
    pontoEventosDisponivel,
    ORIGENS_PONTO,
    registrarEventoTarefa,
    TIPOS_EVENTO_TAREFA,
} from './ponto-eventos.js';
import { construirEtapasCanonicas, etapaEhLiberacaoAutomatica } from './utils/etapas-produto.js';
import {
    registrarOrigemProdutoPronto,
    obterEstruturaOrigensProdutoPronto,
    construirCteOrigensProdutoPronto,
} from './utils/origens-produto-pronto.js';
import { registrarPerdaProducao } from './utils/registrar-perda-producao.js';
import { listarFilaPerdasProducao } from './utils/fila-perdas-producao.js';
import { estornarProducao } from './utils/estornar-producao.js';



const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.POSTGRES_URL
        && !process.env.POSTGRES_URL.includes('127.0.0.1')
        && !process.env.POSTGRES_URL.includes('localhost')
        ? { rejectUnauthorized: false }
        : undefined,
    timezone: 'UTC',
});
const SECRET_KEY = process.env.JWT_SECRET;

async function estruturaPosOpDisponivel(dbClient) {
    const result = await dbClient.query(`
        SELECT 1
          FROM sistema_migrations
         WHERE id = 'pos-op-sessoes-producao-v1'
         LIMIT 1
    `);
    return result.rowCount > 0;
}

async function origensPosOpSessaoDisponivel(dbClient) {
    const result = await dbClient.query(`
        SELECT 1
          FROM sistema_migrations
         WHERE id = 'pos-op-origens-sessao-v1'
         LIMIT 1
    `);
    return result.rowCount > 0;
}

function varianteParaBanco(variante) {
    return variante === undefined || variante === null || variante === '-' ? null : variante;
}

/**
 * Resolve a etapa pela identidade mais forte disponivel.
 *
 * `etapa_id` identifica a etapa da receita e deve prevalecer sobre o nome ou
 * sobre o ID do catalogo do processo. Isso evita que um nome legado, uma
 * renomeacao do processo ou um catalogo antigo quebre a atribuicao.
 */
function encontrarEtapaParaAtribuicao(produto, {
    fase,
    processo,
    processoId,
    etapaId,
}) {
    const canonicas = construirEtapasCanonicas({
        etapas: produto?.etapas,
        etapasTiktik: produto?.etapas_tiktik ?? produto?.etapastiktik,
    }).etapasCanonicas.filter(etapa => etapa.fase === fase);

    if (etapaId !== undefined && etapaId !== null && etapaId !== '') {
        const porEtapaId = canonicas.find(etapa => String(etapa.id || '') === String(etapaId));
        if (porEtapaId) return porEtapaId;
    }

    if (processoId !== undefined && processoId !== null && processoId !== '') {
        const porProcessoId = canonicas.find(etapa => (
            String(etapa.processo_id || '') === String(processoId)
        ));
        if (porProcessoId) return porProcessoId;
    }

    if (processo) {
        const porNome = canonicas.find(etapa => etapa.processo === String(processo));
        if (porNome) return porNome;
    }

    return null;
}

async function validarTarefaAtribuicao(dbClient, {
    empresaId,
    funcionarioId,
    opNumero,
    produtoId,
    variante,
    processo,
    processoId,
    etapaId,
    fase = 'OP',
    estruturaPosOp = false,
    origensPosOpDisponivel = false,
    tiposExecutorOverride = null,
    quantidade,
    consultarSaldo = false,
}) {
    const produtoResult = await dbClient.query(
        `SELECT id, etapas, "etapastiktik" AS etapas_tiktik
           FROM produtos
          WHERE id = $1
            AND empresa_id = $2`,
        [Number(produtoId), empresaId],
    );
    const produto = produtoResult.rows[0];
    if (!produto) throw new Error('Produto não pertence à empresa ativa.');

    const opResult = await dbClient.query(
        `SELECT numero, status, produto_id, variante, quantidade, etapas
           FROM ordens_de_producao
          WHERE numero = $1
            AND empresa_id = $2
            AND produto_id = $3
            AND (variante = $4 OR ($4 IS NULL AND variante IS NULL))
          FOR UPDATE`,
        [String(opNumero), empresaId, Number(produtoId), varianteParaBanco(variante)],
    );
    const op = opResult.rows[0];
    if (!op) throw new Error('OP, produto ou variante não pertence à empresa ativa.');

    const faseNormalizada = fase === 'POS_OP' ? 'POS_OP' : 'OP';
    if (faseNormalizada === 'POS_OP' && !estruturaPosOp) {
        throw new Error('O fluxo de arremate pós-OP ainda não foi liberado no banco.');
    }
    if (faseNormalizada === 'POS_OP' && op.status !== 'finalizado') {
        throw new Error('Arremate pós-OP só pode ser atribuído depois que a OP estiver finalizada.');
    }
    if (faseNormalizada === 'OP' && !['em-aberto', 'produzindo'].includes(op.status)) {
        throw new Error('Etapas internas só podem ser atribuídas enquanto a OP estiver aberta ou produzindo.');
    }

    const etapa = encontrarEtapaParaAtribuicao(produto, {
        fase: faseNormalizada,
        processo: String(processo || ''),
        processoId,
        etapaId,
    });
    if (!etapa) {
        throw new Error(`Processo "${processo}" não está configurado para esta fase do produto.`);
    }
    if (faseNormalizada === 'POS_OP' && etapaEhLiberacaoAutomatica(etapa)) {
        throw new Error('Esta etapa POS_OP e uma liberacao automatica e nao pode ser atribuida a um funcionario.');
    }
    if (!Array.isArray(etapa.feitoPor) || etapa.feitoPor.length === 0) {
        throw new Error(`O processo "${etapa.processo}" ainda não possui executor configurado.`);
    }

    const funcionarioResult = await dbClient.query(
        `SELECT tipos
           FROM usuarios_empresas
          WHERE usuario_id = $1
            AND empresa_id = $2
            AND ativo
          FOR UPDATE`,
        [funcionarioId, empresaId],
    );
    const tiposFuncionario = Array.isArray(tiposExecutorOverride) && tiposExecutorOverride.length > 0
        ? tiposExecutorOverride
        : (funcionarioResult.rows[0]?.tipos || []);
    if (!etapa.feitoPor.some(tipo => tiposFuncionario.includes(tipo))) {
        throw new Error(`O empregado não está autorizado a executar "${etapa.processo}".`);
    }

    if (faseNormalizada === 'OP') {
        const chaveTrava = [
            'op-saldo', empresaId, produtoId,
            varianteParaBanco(variante) || '-', etapa.id || etapa.processo_id || etapa.processo,
        ].join(':');
        await dbClient.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [chaveTrava],
        );

        const [opsAtivasResult, producoesResult, sessoesAtivasResult] = await Promise.all([
            dbClient.query(
                `SELECT numero, quantidade, etapas
                   FROM ordens_de_producao
                  WHERE empresa_id = $1
                    AND produto_id = $2
                    AND (variante = $3 OR ($3 IS NULL AND variante IS NULL))
                    AND status IN ('em-aberto', 'produzindo')
                  ORDER BY numero ASC`,
                [empresaId, Number(produtoId), varianteParaBanco(variante)],
            ),
            dbClient.query(
                `SELECT op_numero, etapa_index, COALESCE(SUM(quantidade), 0)::int AS total
                  FROM producoes
                  WHERE empresa_id = $1
                    AND produto_id = $2
                    AND (
                        NULLIF(variacao, '-') = $3
                        OR ($3 IS NULL AND NULLIF(variacao, '-') IS NULL)
                    )
                  GROUP BY op_numero, etapa_index`,
                [empresaId, Number(produtoId), varianteParaBanco(variante)],
            ),
            dbClient.query(
                `SELECT processo, quantidade_atribuida, etapas_unificadas
                   FROM sessoes_trabalho_producao
                  WHERE empresa_id = $1
                    AND produto_id = $2
                    AND (variante = $3 OR ($3 IS NULL AND variante IS NULL))
                    AND status = 'EM_ANDAMENTO'
                    ${estruturaPosOp ? "AND fase = 'OP'" : ''}`,
                [empresaId, Number(produtoId), varianteParaBanco(variante)],
            ),
        ]);

        const lancamentosPorEtapa = new Map(
            producoesResult.rows.map(row => [
                `${row.op_numero}-${row.etapa_index}`,
                Number(row.total) || 0,
            ]),
        );
        const saldoFisico = opsAtivasResult.rows.reduce((total, opAtiva) => {
            const indice = indiceEtapaNaOp(opAtiva.etapas, etapa);
            if (indice < 0) return total;

            const entrada = indice === 0
                ? Number(opAtiva.quantidade) || 0
                : (lancamentosPorEtapa.get(`${opAtiva.numero}-${indice - 1}`) || 0);
            const concluido = lancamentosPorEtapa.get(`${opAtiva.numero}-${indice}`) || 0;
            return total + Math.max(0, entrada - concluido);
        }, 0);
        const reservado = sessoesAtivasResult.rows.reduce((total, sessao) => {
            const referencias = [
                { processo: sessao.processo },
                ...(Array.isArray(sessao.etapas_unificadas) ? sessao.etapas_unificadas : []),
            ];
            return referencias.some(referencia => referenciaCorrespondeEtapa(referencia, etapa))
                ? total + (Number(sessao.quantidade_atribuida) || 0)
                : total;
        }, 0);
        const saldoDisponivel = Math.max(0, saldoFisico - reservado);

        if (consultarSaldo) {
            return {
                produto,
                op,
                etapa,
                tiposExecutor: tiposFuncionario,
                processo: etapa.processo,
                fase: faseNormalizada,
                variante: varianteParaBanco(variante),
                saldoDisponivel,
            };
        }

        const quantidadeSolicitada = Number(quantidade);
        if (!Number.isInteger(quantidadeSolicitada) || quantidadeSolicitada <= 0) {
            throw new Error('A quantidade atribuída deve ser um número inteiro positivo.');
        }
        if (quantidadeSolicitada > saldoDisponivel) {
            throw new Error(`Saldo insuficiente para "${etapa.processo}". Disponível: ${saldoDisponivel}.`);
        }
    }

    if (faseNormalizada === 'POS_OP') {
        const chaveTrava = [
            'pos-op', empresaId, op.numero, produtoId,
            varianteParaBanco(variante) || '-', etapa.id || etapa.processo_id || etapa.processo,
        ].join(':');
        await dbClient.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [chaveTrava],
        );

        const indiceEtapaFinal = Array.isArray(op.etapas) ? op.etapas.length - 1 : -1;
        const finalResult = await dbClient.query(
            `SELECT COALESCE(SUM(quantidade), 0)::int AS total,
                    COUNT(*)::int AS lancamentos
               FROM producoes
              WHERE empresa_id = $1
                AND op_numero = $2
                AND etapa_index = $3`,
            [empresaId, op.numero, indiceEtapaFinal],
        );
        const finalLancamentos = finalResult.rows[0] || { total: 0, lancamentos: 0 };
        const etapaFinalLegada = indiceEtapaFinal >= 0 ? op.etapas[indiceEtapaFinal] : null;
        const quantidadeFinal = Number(finalLancamentos.lancamentos) > 0
            ? Number(finalLancamentos.total)
            : (etapaFinalLegada && typeof etapaFinalLegada === 'object' && etapaFinalLegada.quantidade !== undefined
                ? Number(etapaFinalLegada.quantidade) || 0
                : Number(op.quantidade) || 0);

        const parametrosEtapa = [
            empresaId,
            op.numero,
            produtoId,
            etapa.processo_id || null,
            etapa.id || null,
            etapa.processo,
        ];
        const estruturaOrigens = await obterEstruturaOrigensProdutoPronto(dbClient);
        const cteOrigens = construirCteOrigensProdutoPronto(estruturaOrigens.origens);
        const concluidoResult = await dbClient.query(
            `${cteOrigens}, PosOpConcluida AS (
                SELECT op_numero, produto_id, processo_id, etapa_id, processo,
                       quantidade_disponibilizada AS quantidade
                  FROM OrigensProdutoProntoCompat
                 WHERE empresa_id = $1
                   AND fase = 'POS_OP'

                UNION ALL

                SELECT op_numero, produto_id, processo_id, etapa_id, processo,
                       quantidade_arrematada AS quantidade
                  FROM arremates
                 WHERE empresa_id = $1
                   AND fase = 'POS_OP'
                   AND tipo_lancamento = 'PERDA'
            )
            SELECT COALESCE(SUM(quantidade), 0)::int AS total
              FROM PosOpConcluida
             WHERE op_numero = $2
               AND produto_id = $3
               AND (
                    (processo_id IS NOT NULL AND processo_id = $4)
                    OR (processo_id IS NULL AND etapa_id IS NOT DISTINCT FROM $5 AND processo = $6)
               )`,
            parametrosEtapa,
        );
        const ativoResult = await dbClient.query(
            origensPosOpDisponivel
                ? `SELECT COALESCE(SUM(
                            CASE
                                WHEN jsonb_typeof(s.origens_pos_op) = 'array'
                                    THEN COALESCE((
                                        SELECT SUM(NULLIF(origem->>'quantidade', '')::numeric)
                                          FROM jsonb_array_elements(s.origens_pos_op) AS origem
                                         WHERE origem->>'op_numero' = $2
                                    ), 0)
                                ELSE s.quantidade_atribuida
                            END
                        ), 0)::int AS total
                       FROM sessoes_trabalho_producao s
                      WHERE s.empresa_id = $1
                        AND s.produto_id = $3
                        AND s.fase = 'POS_OP'
                        AND s.status = 'EM_ANDAMENTO'
                        AND (
                            (s.processo_id IS NOT NULL AND s.processo_id = $4)
                            OR (s.processo_id IS NULL AND s.etapa_id IS NOT DISTINCT FROM $5 AND s.processo = $6)
                        )
                        AND (
                            s.op_numero = $2
                            OR (
                                jsonb_typeof(s.origens_pos_op) = 'array'
                                AND EXISTS (
                                    SELECT 1
                                      FROM jsonb_array_elements(s.origens_pos_op) AS origem
                                     WHERE origem->>'op_numero' = $2
                                )
                            )
                        )`
                : `SELECT COALESCE(SUM(quantidade_atribuida), 0)::int AS total
                       FROM sessoes_trabalho_producao
                      WHERE empresa_id = $1
                        AND op_numero = $2
                        AND produto_id = $3
                        AND fase = 'POS_OP'
                        AND status = 'EM_ANDAMENTO'
                        AND (
                            (processo_id IS NOT NULL AND processo_id = $4)
                            OR (processo_id IS NULL AND etapa_id IS NOT DISTINCT FROM $5 AND processo = $6)
                        )`,
            parametrosEtapa,
        );

        let legadoEmTrabalho = 0;
        const canonicas = construirEtapasCanonicas({
            etapas: produto.etapas,
            etapasTiktik: produto.etapas_tiktik,
        }).etapasCanonicas.filter(item => item.fase === 'POS_OP');
        if (canonicas[0] && String(canonicas[0].id || '') === String(etapa.id || '')) {
            const legadoResult = await dbClient.query(
                `SELECT COALESCE(SUM(quantidade_entregue), 0)::int AS total
                   FROM sessoes_trabalho_arremate
                  WHERE empresa_id = $1
                    AND op_numero = $2
                    AND status = 'EM_ANDAMENTO'`,
                [empresaId, op.numero],
            );
            legadoEmTrabalho = Number(legadoResult.rows[0]?.total) || 0;
        }

        const saldoDisponivel = Math.max(
            0,
            quantidadeFinal
                - (Number(concluidoResult.rows[0]?.total) || 0)
                - (Number(ativoResult.rows[0]?.total) || 0)
                - legadoEmTrabalho,
        );

        if (consultarSaldo) {
            return {
                produto,
                op,
                etapa,
                processo: etapa.processo,
                fase: faseNormalizada,
                variante: varianteParaBanco(variante),
                saldoDisponivel,
            };
        }

        const quantidadeSolicitada = Number(quantidade);
        if (!Number.isInteger(quantidadeSolicitada) || quantidadeSolicitada <= 0) {
            throw new Error('A quantidade atribuída deve ser um número inteiro positivo.');
        }
        if (quantidadeSolicitada > saldoDisponivel) {
            throw new Error(`Saldo insuficiente para o arremate pós-OP. Disponível: ${saldoDisponivel}.`);
        }
    }

    return {
        produto,
        op,
        etapa,
        tiposExecutor: tiposFuncionario,
        processo: etapa.processo,
        fase: faseNormalizada,
        variante: varianteParaBanco(variante),
    };
}

function referenciaCorrespondeEtapa(referencia, etapa) {
    if (!referencia || !etapa) return false;
    const etapaIdReferencia = referencia.etapa_id ?? referencia.id;
    if (etapaIdReferencia && etapa.id) {
        return String(etapaIdReferencia) === String(etapa.id);
    }
    if (referencia.processo_id && etapa.processo_id) {
        return String(referencia.processo_id) === String(etapa.processo_id);
    }
    return String(referencia.processo || '') === String(etapa.processo || '');
}

function validarPercursoUnificado({
    produto,
    etapaInicial,
    etapasSolicitadas,
    tiposExecutor,
}) {
    if (etapasSolicitadas === undefined || etapasSolicitadas === null) return null;
    if (!Array.isArray(etapasSolicitadas) || etapasSolicitadas.length < 2) {
        throw new Error('Uma unificaÃ§Ã£o deve conter pelo menos duas etapas consecutivas.');
    }

    const etapasOp = construirEtapasCanonicas({
        etapas: produto?.etapas,
        etapasTiktik: produto?.etapas_tiktik,
    }).etapasCanonicas.filter(etapa => etapa.fase === 'OP');
    const indiceInicial = etapasOp.findIndex(etapa => referenciaCorrespondeEtapa(etapaInicial, etapa));
    if (indiceInicial < 0) {
        throw new Error('A etapa inicial da unificaÃ§Ã£o nÃ£o pertence Ã  receita atual do produto.');
    }

    return etapasSolicitadas.map((solicitada, deslocamento) => {
        const etapaEsperada = etapasOp[indiceInicial + deslocamento];
        if (!etapaEsperada || !referenciaCorrespondeEtapa(solicitada, etapaEsperada)) {
            throw new Error('As etapas unificadas devem formar uma sequÃªncia contÃ­nua, sem pular processos.');
        }
        if (!Array.isArray(etapaEsperada.feitoPor)
            || !etapaEsperada.feitoPor.some(tipo => tiposExecutor.includes(tipo))) {
            throw new Error(`O empregado nÃ£o estÃ¡ autorizado a executar "${etapaEsperada.processo}".`);
        }

        return {
            etapa_index: indiceInicial + deslocamento,
            etapa_id: etapaEsperada.id || null,
            processo_id: etapaEsperada.processo_id || null,
            ordem: etapaEsperada.ordem || indiceInicial + deslocamento + 1,
            processo: etapaEsperada.processo,
            maquina: etapaEsperada.maquina || 'NÃ£o Definida',
            feitoPor: etapaEsperada.feitoPor,
            fase: 'OP',
        };
    });
}

function normalizarOrigensPosOp(origins) {
    if (!Array.isArray(origins)) return [];

    const unicas = new Map();
    for (const origem of origins) {
        const opNumero = origem?.op_numero ?? origem?.opNumero;
        if (!opNumero) continue;
        const chave = String(opNumero);
        if (!unicas.has(chave)) unicas.set(chave, chave);
    }
    return [...unicas.values()];
}

function normalizarOrigensPersistidas(origins) {
    if (!Array.isArray(origins)) return [];

    return origins
        .map((origem) => ({
            op_numero: origem?.op_numero ?? origem?.opNumero,
            quantidade: Math.floor(Number(
                origem?.quantidade ?? origem?.quantidade_atribuida ?? origem?.quantidade_disponivel,
            )),
        }))
        .filter((origem) => origem.op_numero && Number.isInteger(origem.quantidade) && origem.quantidade > 0)
        .map((origem) => ({ ...origem, op_numero: String(origem.op_numero) }));
}

async function prepararItemPosOpConsolidado(dbClient, {
    item,
    empresaId,
    funcionarioId,
    estruturaPosOp,
    origensPosOpDisponivel,
    tiposExecutorOverride = null,
}) {
    const fontes = normalizarOrigensPosOp(item.origens_pos_op);
    const quantidadeTotal = Math.floor(Number(item.quantidade));
    if (fontes.length === 0) {
        const tarefaValidada = await validarTarefaAtribuicao(dbClient, {
            empresaId,
            funcionarioId,
            opNumero: item.opNumero,
            produtoId: item.produto_id,
            variante: item.variante,
            processo: item.processo,
            processoId: item.processo_id,
            etapaId: item.etapa_id,
            fase: item.fase,
            estruturaPosOp,
            origensPosOpDisponivel,
            tiposExecutorOverride,
            quantidade: quantidadeTotal,
        });
        return {
            tarefaValidada,
            opNumero: String(item.opNumero),
            quantidade: quantidadeTotal,
            origensPosOp: null,
        };
    }

    if (!origensPosOpDisponivel) {
        throw new Error('Para agrupar OPs em uma tarefa pós-OP, execute a migration pos-op-origens-sessao-v1.');
    }
    if (!Number.isInteger(quantidadeTotal) || quantidadeTotal <= 0) {
        throw new Error('A quantidade atribuída deve ser um número inteiro positivo.');
    }

    let restante = quantidadeTotal;
    let tarefaValidada = null;
    const origensDistribuidas = [];

    for (const opNumero of fontes) {
        if (restante <= 0) break;

        const consultaSaldo = await validarTarefaAtribuicao(dbClient, {
            empresaId,
            funcionarioId,
            opNumero,
            produtoId: item.produto_id,
            variante: item.variante,
            processo: item.processo,
            processoId: item.processo_id,
            etapaId: item.etapa_id,
            fase: 'POS_OP',
            estruturaPosOp,
            origensPosOpDisponivel,
            tiposExecutorOverride,
            quantidade: 1,
            consultarSaldo: true,
        });
        tarefaValidada = consultaSaldo;

        const quantidadeDaOrigem = Math.min(restante, consultaSaldo.saldoDisponivel);
        if (quantidadeDaOrigem <= 0) continue;

        origensDistribuidas.push({
            op_numero: opNumero,
            quantidade: quantidadeDaOrigem,
        });
        restante -= quantidadeDaOrigem;
    }

    if (restante > 0) {
        throw new Error(
            `A quantidade selecionada excede o saldo real das OPs de origem. Faltaram ${restante} pcs para distribuir.`,
        );
    }

    return {
        tarefaValidada,
        opNumero: origensDistribuidas[0].op_numero,
        quantidade: quantidadeTotal,
        origensPosOp: origensDistribuidas,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compatibilidade pré-migration — detecção legada de intervalo.
// BUG-15b — Tolerância máxima de atraso para detecção automática de intervalo.
// Se a tarefa for finalizada além de (S1/S2 + TOLERANCIA), o sistema NÃO registra
// mais o almoço/pausa automaticamente — a rede de segurança em
// GET /status-funcionarios assume e grava o horário agendado como fallback.
// Regra operacional de chão de fábrica (reunião com equipe): proibido tirar
// almoço/pausa após 30min do horário agendado.
// ─────────────────────────────────────────────────────────────────────────────
const TOLERANCIA_ATRASO_INTERVALO_MIN = 30;

// Converte 'HH:MM' em minutos desde meia-noite. Retorna null se inválido.
const hhmmParaMin = (hhmm) => {
    if (!hhmm || typeof hhmm !== 'string' || hhmm.length < 5) return null;
    const [h, m] = hhmm.substring(0, 5).split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
};

/**
 * Detecta se a finalização de uma tarefa ocorre durante/após uma janela de intervalo.
 * Se sim, registra os horários reais no ponto_diario e retorna o novo status.
 * Deve ser chamada DENTRO de uma transaction já aberta.
 *
 * @param {object} dbClient - Conexão ativa com o banco (dentro da transaction)
 * @param {number} funcionarioId - ID do funcionário
 * @param {object} horarios - Campos horario_* do usuário
 * @param {string} dataHojeSP - Data de hoje em São Paulo: 'YYYY-MM-DD'
 * @param {string} horaAtualSP - Hora atual em São Paulo: 'HH:MM'
 * @returns {Promise<string>} Novo status: 'ALMOCO', 'PAUSA' ou 'LIVRE'
 */
async function detectarIntervaloAoFinalizar(
    dbClient,
    funcionarioId,
    empresaId,
    horarios,
    dataHojeSP,
    horaAtualSP
) {
    const n = (t) => t ? String(t).substring(0, 5) : null;

    // Com o livro append-only ativo, a finalização de uma tarefa não decide
    // jornada nem cria intervalo. O cron reconcilia S1/S2/E2/E3 pelo horário
    // planejado dentro do motor transacional.
    if (await pontoEventosDisponivel(dbClient)) return 'LIVRE';

    // Finalização de tarefa não pode inventar intervalo em DSR, feriado,
    // trabalho extra ou depois que a jornada foi cancelada por falta.
    const contextoJornada = await carregarContextoJornada(
        dbClient,
        funcionarioId,
        empresaId,
        dataHojeSP
    );
    if (!ehDiaOrdinario(contextoJornada) || contextoJornada.falta_ativa) {
        return 'LIVRE';
    }

    const s1Agendado = n(horarios.horario_saida_1);
    const s2Agendado = n(horarios.horario_saida_2);
    const e3Agendado = n(horarios.horario_entrada_3);

    if (!s1Agendado) return 'LIVRE'; // Sem horário de saída para almoço → não tem intervalos

    // Busca ponto_diario de hoje para verificar se o intervalo já foi registrado
    const pontoRes = await dbClient.query(
        `SELECT horario_real_s1, horario_real_e2, horario_real_s2, horario_real_e3
         FROM ponto_diario
         WHERE funcionario_id = $1
           AND data = $2
           AND empresa_id = $3`,
        [funcionarioId, dataHojeSP, empresaId]
    );
    const pontoHoje = pontoRes.rows[0] || null;

    // Pré-cálculo em minutos para comparações com tolerância
    const horaAtualMin = hhmmParaMin(horaAtualSP);
    const s1Min = hhmmParaMin(s1Agendado);
    const s2Min = hhmmParaMin(s2Agendado);

    // ── CASO 1: Detecção de ALMOÇO ──────────────────────────────────────────
    // BUG-15: limite superior — se já passou do S2, não registrar almoço retroativo.
    // BUG-15b: janela reduzida a [S1, S1+30min]. Além disso → cai para rede de segurança.
    // Funcionária que não almoçou via sistema e finaliza tarefa às 16h (hora da pausa)
    // não deve ganhar um almoço falso; cai direto no CASO 2 (pausa) ou rede de segurança.
    const dentroJanelaAlmoco =
        s1Min !== null && horaAtualMin !== null &&
        horaAtualMin >= s1Min &&
        horaAtualMin <= s1Min + TOLERANCIA_ATRASO_INTERVALO_MIN &&
        (s2Min === null || horaAtualMin < s2Min);

    if (dentroJanelaAlmoco && !pontoHoje?.horario_real_s1) {
        // Duração do almoço: E2 - S1 do cadastro. Default: 60 min.
        const e2Agendado = n(horarios.horario_entrada_2);
        let duracaoAlmocoMin = 60;
        if (s1Agendado && e2Agendado) {
            const [s1h, s1m] = s1Agendado.split(':').map(Number);
            const [e2h, e2m] = e2Agendado.split(':').map(Number);
            const delta = (e2h * 60 + e2m) - (s1h * 60 + s1m);
            if (delta > 0) duracaoAlmocoMin = delta;
        }
        const [h, m] = horaAtualSP.split(':').map(Number);
        const totalMin = h * 60 + m + duracaoAlmocoMin;
        const e2Dinamico = `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;

        await dbClient.query(
            `INSERT INTO ponto_diario
                (funcionario_id, data, horario_real_s1, horario_real_e2, empresa_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (empresa_id, funcionario_id, data) DO UPDATE SET
                 horario_real_s1 = EXCLUDED.horario_real_s1,
                 horario_real_e2 = EXCLUDED.horario_real_e2,
                 updated_at = NOW()`,
            [funcionarioId, dataHojeSP, horaAtualSP, e2Dinamico, empresaId]
        );

        console.log(`[PONTO] Almoço registrado para func ${funcionarioId}: saiu ${horaAtualSP} → volta ${e2Dinamico}`);
        return 'ALMOCO';
    }

    // ── CASO 2: Detecção de PAUSA (café/lanche) ──────────────────────────────
    // BUG-15b: janela reduzida a [S2, S2+30min]. Além disso → rede de segurança.
    const dentroJanelaPausa =
        s2Min !== null && horaAtualMin !== null &&
        horaAtualMin >= s2Min &&
        horaAtualMin <= s2Min + TOLERANCIA_ATRASO_INTERVALO_MIN;

    if (dentroJanelaPausa && !pontoHoje?.horario_real_s2) {
        // Garante que o almoço já terminou antes de registrar a pausa
        const e2Real = n(pontoHoje?.horario_real_e2) || n(horarios.horario_entrada_2);
        if (!e2Real || horaAtualSP < e2Real) return 'LIVRE'; // Almoço ainda não acabou

        // Duração da pausa = E3 - S2 do cadastro. Default: 15 min.
        let duracaoPausaMin = 15;
        if (e3Agendado && s2Agendado) {
            const [s2h, s2m] = s2Agendado.split(':').map(Number);
            const [e3h, e3m] = e3Agendado.split(':').map(Number);
            const delta = (e3h * 60 + e3m) - (s2h * 60 + s2m);
            if (delta > 0) duracaoPausaMin = delta;
        }

        const [h, m] = horaAtualSP.split(':').map(Number);
        const totalMin = h * 60 + m + duracaoPausaMin;
        const e3Dinamico = `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;

        await dbClient.query(
            `INSERT INTO ponto_diario
                (funcionario_id, data, horario_real_s2, horario_real_e3, empresa_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (empresa_id, funcionario_id, data) DO UPDATE SET
                 horario_real_s2 = COALESCE(ponto_diario.horario_real_s2, EXCLUDED.horario_real_s2),
                 horario_real_e3 = COALESCE(ponto_diario.horario_real_e3, EXCLUDED.horario_real_e3),
                 updated_at = NOW()`,
            [funcionarioId, dataHojeSP, horaAtualSP, e3Dinamico, empresaId]
        );

        console.log(`[PONTO] Pausa registrada para func ${funcionarioId}: saiu ${horaAtualSP} → volta ${e3Dinamico}`);
        return 'PAUSA';
    }

    return 'LIVRE';
}

/**
 * Calcula os pontos de uma produção com base nos parâmetros fornecidos.
 * @param {object} dbClient - A conexão ativa com o banco de dados.
 * @param {number} produto_id - O ID do produto.
 * @param {string} processo - O nome do processo (ex: "Bainha").
 * @param {number} quantidade - A quantidade produzida.
 * @param {number} funcionario_id - O ID do funcionário que realizou a tarefa.
 * @returns {Promise<object>} Uma promessa que resolve para um objeto { pontosGerados, valorPontoAplicado }.
 */
async function calcularPontosProducao(
    dbClient,
    produto_id,
    processo,
    quantidade,
    funcionario_id,
    empresaId
) {
    // Validação de segurança
    if (!produto_id || !processo || quantidade < 0 || !funcionario_id) {
        console.warn('[calcularPontosProducao] Dados de entrada inválidos. Retornando 0 pontos.');
        return { pontosGerados: 0, valorPontoAplicado: 0 };
    }

    const funcionarioInfoResult = await dbClient.query(
        `SELECT tipos
           FROM usuarios_empresas
          WHERE usuario_id = $1
            AND empresa_id = $2
            AND ativo
          LIMIT 1`,
        [funcionario_id, empresaId]
    );

    let tipoAtividadeParaConfigPontos;
    if (funcionarioInfoResult.rows.length > 0 && funcionarioInfoResult.rows[0].tipos) {
        const tiposFuncionario = funcionarioInfoResult.rows[0].tipos;
        if (tiposFuncionario.includes('costureira')) {
            tipoAtividadeParaConfigPontos = 'costura_op_costureira';
        } else if (tiposFuncionario.includes('tiktik')) {
            tipoAtividadeParaConfigPontos = 'processo_op_tiktik';
        }
    }

    let valorPontoAplicado = 1.00;
    if (quantidade > 0 && tipoAtividadeParaConfigPontos) {
        const configPontosResult = await dbClient.query(
            `SELECT pontos_padrao FROM configuracoes_pontos_processos
             WHERE produto_id = $1
               AND processo_nome = $2
               AND tipo_atividade = $3
               AND empresa_id = $4
               AND ativo = TRUE
             LIMIT 1;`,
            [produto_id, processo, tipoAtividadeParaConfigPontos, empresaId]
        );

        if (configPontosResult.rows.length > 0 && configPontosResult.rows[0].pontos_padrao !== null) {
            valorPontoAplicado = parseFloat(configPontosResult.rows[0].pontos_padrao);
        } 
    } else if (quantidade === 0) {
        valorPontoAplicado = 0;
    }

    const pontosGerados = quantidade * valorPontoAplicado;

    return {
        pontosGerados: parseFloat(pontosGerados.toFixed(2)),
        valorPontoAplicado: parseFloat(valorPontoAplicado.toFixed(2))
    };
}


// Atualiza TPP de cada etapa unificada proporcionalmente ao peso histórico de cada uma
async function atualizarTPPProporcionado(dbClient, produto_id, etapas, duracaoSegPorPeca, empresaId) {
    if (!duracaoSegPorPeca || duracaoSegPorPeca <= 0) return;
    const processos = etapas.map(e => e.processo);
    const tppResult = await dbClient.query(
        `SELECT tpp.processo, tpp.tempo_segundos
           FROM tempos_padrao_producao tpp
           JOIN produtos p ON p.id = tpp.produto_id AND p.empresa_id = $3
          WHERE tpp.produto_id = $1
            AND tpp.processo = ANY($2::text[])`,
        [produto_id, processos, empresaId]
    );
    const tppMap = new Map(tppResult.rows.map(r => [r.processo, parseFloat(r.tempo_segundos)]));
    const tppSoma = etapas.reduce((acc, e) => acc + (tppMap.get(e.processo) || duracaoSegPorPeca), 0);
    for (const etapa of etapas) {
        const tppExistente = tppMap.get(etapa.processo) || duracaoSegPorPeca;
        const proporcao = tppSoma > 0 ? tppExistente / tppSoma : 1 / etapas.length;
        const tempoProporcionado = duracaoSegPorPeca * proporcao;
        await dbClient.query(`
            INSERT INTO tempos_padrao_producao (produto_id, processo, tempo_segundos)
            VALUES ($1, $2, $3)
            ON CONFLICT (produto_id, processo) DO UPDATE SET
                tempo_segundos = EXCLUDED.tempo_segundos
        `, [produto_id, etapa.processo, tempoProporcionado]);
    }
}

// Função verificarToken
function indiceEtapaNaOp(etapasOp, referencia) {
    if (!Array.isArray(etapasOp)) return -1;
    return etapasOp.findIndex((etapaBruta) => {
        const etapa = typeof etapaBruta === 'string'
            ? { processo: etapaBruta }
            : etapaBruta;
        return referenciaCorrespondeEtapa(referencia, etapa);
    });
}

async function registrarPercursoUnificadoConcluido(dbClient, {
    sessao,
    etapas,
    quantidade,
    nomeFuncionario,
    lancadoPor,
    empresaId,
}) {
    if (quantidade === 0) return;

    const opsResult = await dbClient.query(
        `SELECT numero, etapas, quantidade
           FROM ordens_de_producao
          WHERE empresa_id = $3
            AND produto_id = $1
            AND (variante = $2 OR ($2 IS NULL AND variante IS NULL))
            AND status IN ('em-aberto', 'produzindo')
          ORDER BY numero ASC
          FOR UPDATE`,
        [sessao.produto_id, sessao.variante, empresaId],
    );
    const ops = opsResult.rows;
    if (ops.length === 0) {
        throw new Error('Nenhuma OP ativa encontrada para concluir o percurso unificado.');
    }

    const numerosOps = ops.map(op => String(op.numero));
    const lancamentosResult = await dbClient.query(
        `SELECT op_numero, etapa_index, COALESCE(SUM(quantidade), 0)::int AS total
           FROM producoes
          WHERE empresa_id = $2
            AND op_numero = ANY($1::text[])
          GROUP BY op_numero, etapa_index`,
        [numerosOps, empresaId],
    );
    const mapaSaldo = new Map(
        lancamentosResult.rows.map(row => [
            `${row.op_numero}-${row.etapa_index}`,
            Number(row.total) || 0,
        ]),
    );

    const etapaInicial = etapas[0];
    const sessoesAnterioresResult = await dbClient.query(
        `SELECT processo, processo_id, etapa_id, quantidade_atribuida, etapas_unificadas
           FROM sessoes_trabalho_producao
          WHERE empresa_id = $1
            AND produto_id = $2
            AND (variante = $3 OR ($3 IS NULL AND variante IS NULL))
            AND status = 'EM_ANDAMENTO'
            AND id < $4
            AND COALESCE(fase, 'OP') = 'OP'
          ORDER BY id ASC`,
        [empresaId, sessao.produto_id, sessao.variante, sessao.id],
    );
    let reservadoAnterior = sessoesAnterioresResult.rows.reduce((total, row) => {
        const referencias = [
            { processo: row.processo, processo_id: row.processo_id, etapa_id: row.etapa_id },
            ...(Array.isArray(row.etapas_unificadas) ? row.etapas_unificadas : []),
        ];
        return referencias.some(referencia => referenciaCorrespondeEtapa(referencia, etapaInicial))
            ? total + (Number(row.quantidade_atribuida) || 0)
            : total;
    }, 0);

    let restante = quantidade;
    const distribuicao = [];
    for (const op of ops) {
        if (restante <= 0) break;
        const indiceInicial = indiceEtapaNaOp(op.etapas, etapaInicial);
        if (indiceInicial < 0) continue;
        const entrada = indiceInicial === 0
            ? Number(op.quantidade) || 0
            : (mapaSaldo.get(`${op.numero}-${indiceInicial - 1}`) || 0);
        const saida = mapaSaldo.get(`${op.numero}-${indiceInicial}`) || 0;
        const saldoBruto = Math.max(0, entrada - saida);
        const descontoReserva = Math.min(saldoBruto, reservadoAnterior);
        reservadoAnterior -= descontoReserva;
        const disponivel = saldoBruto - descontoReserva;
        if (disponivel <= 0) continue;
        const quantidadeOp = Math.min(restante, disponivel);
        distribuicao.push({ op, quantidade: quantidadeOp });
        restante -= quantidadeOp;
    }

    if (restante > 0) {
        throw new Error(`Saldo insuficiente para concluir o percurso unificado. Disponivel: ${quantidade - restante}.`);
    }

    for (const origem of distribuicao) {
        for (const etapa of etapas) {
            const etapaIndex = indiceEtapaNaOp(origem.op.etapas, etapa);
            if (etapaIndex < 0) {
                throw new Error(`A etapa "${etapa.processo}" nÃ£o existe na receita da OP #${origem.op.numero}.`);
            }
            const entrada = etapaIndex === 0
                ? Number(origem.op.quantidade) || 0
                : (mapaSaldo.get(`${origem.op.numero}-${etapaIndex - 1}`) || 0);
            const saida = mapaSaldo.get(`${origem.op.numero}-${etapaIndex}`) || 0;
            if (Math.max(0, entrada - saida) < origem.quantidade) {
                throw new Error(`A OP #${origem.op.numero} nÃ£o possui saldo suficiente em "${etapa.processo}".`);
            }

            const { pontosGerados, valorPontoAplicado } = await calcularPontosProducao(
                dbClient,
                sessao.produto_id,
                etapa.processo,
                origem.quantidade,
                sessao.funcionario_id,
                empresaId,
            );
            await dbClient.query(
                `INSERT INTO producoes
                    (id, op_numero, etapa_index, processo, produto_id, variacao,
                     maquina, quantidade, funcionario, funcionario_id, data,
                     lancado_por, valor_ponto_aplicado, pontos_gerados, empresa_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13, $14)`,
                [
                    `prod_unif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    origem.op.numero,
                    etapaIndex,
                    etapa.processo,
                    sessao.produto_id,
                    sessao.variante || '-',
                    etapa.maquina || 'NÃ£o Definida',
                    origem.quantidade,
                    nomeFuncionario,
                    sessao.funcionario_id,
                    lancadoPor,
                    valorPontoAplicado,
                    pontosGerados,
                    empresaId,
                ],
            );
            mapaSaldo.set(`${origem.op.numero}-${etapaIndex}`, saida + origem.quantidade);
        }
    }
}

const verificarToken = (reqOriginal) => {
    const authHeader = reqOriginal.headers.authorization;
    if (!authHeader) {
        const error = new Error('Token não fornecido');
        error.statusCode = 401;
        throw error;
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
        const error = new Error('Token mal formatado');
        error.statusCode = 401;
        throw error;
    } 
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        return decoded;
    } catch (err) {
        const error = new Error('Token inválido ou expirado');
        error.statusCode = 401;
        if (err.name === 'TokenExpiredError') error.details = 'jwt expired';
        throw error;
    }
};

// Middleware para este router: Apenas autentica o token.
router.use(async (req, res, next) => {
    try {
        const tokenClaims = verificarToken(req);
        req.usuarioLogado = {
            ...tokenClaims,
            ...(req.usuarioLogado || {}),
            id: req.usuarioLogado?.id || tokenClaims.id,
            nome: req.usuarioLogado?.nome || tokenClaims.nome,
        };
        req.empresaId = obterEmpresaIdDoContexto(req);
        next();
    } catch (error) {
        console.error('[router/producoes MID] Erro no middleware:', error.message);
        const statusCode = error.statusCode || 500;
        const responseError = { error: error.message };
        if (error.details) responseError.details = error.details;
        res.status(statusCode).json(responseError);
    }
});

// Compatibilidade durante a migração: a regra transacional de perdas ainda
// vive no router legado, mas a superfície canônica já pode consumi-la. O
// alias será removido somente depois da migração dos consumidores antigos.
// A rota só abre para empresas secundárias depois que a migration estrutural
// existir no banco. Isso mantém a trava fechada em uma Neon ainda não migrada,
// mas permite o ensaio de dois contextos no clone local preparado.
router.use(async (req, res, next) => {
    if (req.moduloEmpresa?.multiempresa_pronto && req.moduloEmpresa?.habilitado) return next();

    let dbClient;
    try {
        dbClient = await pool.connect();
        const migration = await dbClient.query(
            `SELECT 1
               FROM sistema_migrations
              WHERE id = 'multiempresas-fase8-producao-ensaio-v1'
              LIMIT 1`
        );
        if (!req.moduloEmpresa?.multiempresa_pronto || !req.moduloEmpresa?.habilitado) {
            return res.status(403).json({
                error: 'A cadeia produtiva ainda não está disponível para a empresa ativa.',
                codigo: 'CADEIA_PRODUTIVA_NAO_MIGRADA',
            });
        }
        next();
    } catch (error) {
        console.error('[router/producoes GATE] Migration empresarial ausente:', error.message);
        res.status(403).json({
            error: 'A cadeia produtiva ainda não está disponível para a empresa ativa.',
            codigo: 'CADEIA_PRODUTIVA_NAO_MIGRADA',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.get('/fila-perdas', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const resultado = await listarFilaPerdasProducao({
            dbClient,
            empresaId: req.empresaId,
            query: req.query,
        });
        res.status(200).json(resultado);
    } catch (error) {
        console.error('[API GET /producoes/fila-perdas] Erro:', error);
        res.status(500).json({ error: 'Erro ao processar a fila de perdas.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});
router.post('/registrar-perda', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const resultado = await registrarPerdaProducao({
            dbClient,
            usuarioLogado: req.usuarioLogado,
            empresaId: req.empresaId,
            payload: req.body,
        });
        res.status(201).json(resultado);
    } catch (error) {
        console.error('[API /producoes/registrar-perda] Erro:', error);
        res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao registrar a perda.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.post('/estornar', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const resultado = await estornarProducao({
            dbClient,
            usuarioLogado: req.usuarioLogado,
            empresaId: req.empresaId,
            idArremate: req.body?.id_arremate,
        });
        res.status(200).json(resultado);
    } catch (error) {
        console.error('[API /producoes/estornar] Erro:', error);
        res.status(error.statusCode || 500).json({
            error: error.message || 'Erro interno ao estornar o lançamento.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/producoes/historico
// Visão geral aditiva: produção interna, POS_OP, perdas, cancelamentos,
// embalagem e movimentos de estoque. Os registros de origem permanecem
// imutáveis e o histórico legado de arremates continua disponível.
router.get('/historico', async (req, res) => {
    const {
        busca,
        tipoEvento = 'todos',
        fase = 'todas',
        periodo = '7d',
        produtoId,
        executorId,
        processo,
        opNumero,
        produtoBusca,
        executorBusca,
        page = 1,
        limit = 15,
    } = req.query;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(
            dbClient,
            req.usuarioLogado.id,
            req.empresaId,
        );
        if (!permissoes.includes('acesso-producao-geral')
            && !permissoes.includes('acesso-ordens-de-producao')
            && !permissoes.includes('acesso-ordens-de-arremates')) {
            return res.status(403).json({ error: 'Permissão negada para visualizar o histórico de Produções.' });
        }

        const estruturaOrigens = await obterEstruturaOrigensProdutoPronto(dbClient);
        const cteOrigens = construirCteOrigensProdutoPronto(estruturaOrigens.origens);
        const ocorrenciasEmbalagemResult = await dbClient.query(`
            SELECT
                to_regclass('public.ocorrencias_embalagem_eventos') IS NOT NULL AS eventos,
                to_regclass('public.ocorrencias_embalagem_origens') IS NOT NULL AS origens
        `);
        const possuiOcorrenciasEmbalagem = ocorrenciasEmbalagemResult.rows[0]?.eventos === true
            && ocorrenciasEmbalagemResult.rows[0]?.origens === true;
        const origemCanonicaOcorrencia = estruturaOrigens.origens
            ? `
                            SELECT opp.op_numero
                              FROM ocorrencias_embalagem_origens eo
                              JOIN origens_produto_pronto opp
                                ON opp.empresa_id = eo.empresa_id
                               AND opp.id = eo.origem_produto_pronto_id
                             WHERE eo.empresa_id = ee.empresa_id
                               AND eo.ocorrencia_id = oe.id

                            UNION
`
            : '';
        const historicoOcorrenciasEmbalagem = possuiOcorrenciasEmbalagem
            ? `
            UNION ALL

            SELECT
                'EMBALAGEM_OCORRENCIA'::text AS origem,
                ee.id::text AS origem_id,
                ee.tipo_evento::text AS tipo_evento,
                ee.criado_em AS data_evento,
                ee.empresa_id,
                oe.produto_id,
                NULLIF(oe.variante, '-') AS variante,
                (
                    SELECT string_agg(DISTINCT origem.op_numero, ', ' ORDER BY origem.op_numero)
                      FROM (
${origemCanonicaOcorrencia}
                            SELECT ar.op_numero
                              FROM ocorrencias_embalagem_origens eo
                              JOIN arremates ar
                                ON ar.empresa_id = eo.empresa_id
                               AND ar.id = eo.arremate_legado_id
                             WHERE eo.empresa_id = ee.empresa_id
                               AND eo.ocorrencia_id = oe.id
                      ) AS origem
                ) AS op_numero,
                'Embalagem'::text AS processo,
                NULL::text AS fase,
                ee.usuario_id AS executor_id,
                ee.usuario_nome AS executor_nome,
                NULL::text AS executor_tipo,
                ee.quantidade,
                NULL::numeric AS valor_ponto_aplicado,
                0::numeric AS pontos_gerados,
                ee.usuario_nome AS autor,
                COALESCE(ee.observacao, oe.observacao) AS observacao,
                CASE
                    WHEN ee.tipo_evento = 'PERDA_CONSERTO' THEN 'PRODUTO_AVARIADO'
                    ELSE oe.motivo
                END AS categoria,
                ee.status_depois AS status,
                NULL::integer AS arremate_id,
                NULL::integer AS embalagem_id
              FROM ocorrencias_embalagem_eventos ee
              JOIN ocorrencias_embalagem oe
                ON oe.empresa_id = ee.empresa_id
               AND oe.id = ee.ocorrencia_id
        `
            : '';
        const historicoBase = `${cteOrigens}
            SELECT
                'PRODUCAO_OP'::text AS origem,
                pr.id::text AS origem_id,
                'CONCLUSAO_OP'::text AS tipo_evento,
                pr.data AS data_evento,
                pr.empresa_id,
                pr.produto_id,
                NULLIF(pr.variacao, '-') AS variante,
                pr.op_numero,
                pr.processo,
                'OP'::text AS fase,
                pr.funcionario_id AS executor_id,
                pr.funcionario AS executor_nome,
                NULL::text AS executor_tipo,
                pr.quantidade,
                pr.valor_ponto_aplicado,
                pr.pontos_gerados,
                pr.lancado_por AS autor,
                NULL::text AS observacao,
                NULL::text AS categoria,
                'CONCLUIDA'::text AS status,
                NULL::integer AS arremate_id,
                NULL::integer AS embalagem_id
              FROM producoes pr

            UNION ALL

            SELECT
                'POS_OP_COMPAT'::text AS origem,
                COALESCE(
                    'sessao:' || a.id_sessao_producao::text,
                    'origem:' || a.origem_id::text
                ) AS origem_id,
                'CONCLUSAO_POS_OP'::text AS tipo_evento,
                MAX(a.data_disponibilizacao) AS data_evento,
                a.empresa_id,
                a.produto_id,
                NULLIF(a.variante, '-') AS variante,
                STRING_AGG(DISTINCT a.op_numero, ', ' ORDER BY a.op_numero) AS op_numero,
                a.processo,
                a.fase,
                MAX(a.executor_id) AS executor_id,
                MAX(a.executor_nome) AS executor_nome,
                MAX(a.executor_tipo) AS executor_tipo,
                SUM(a.quantidade_disponibilizada)::integer AS quantidade,
                CASE
                    WHEN MIN(a.valor_ponto_aplicado) = MAX(a.valor_ponto_aplicado)
                        THEN MAX(a.valor_ponto_aplicado)
                    ELSE NULL
                END AS valor_ponto_aplicado,
                SUM(COALESCE(a.pontos_gerados, 0)) AS pontos_gerados,
                MAX(a.executor_nome) AS autor,
                CASE
                    WHEN COUNT(DISTINCT a.op_numero) > 1
                        THEN COUNT(DISTINCT a.op_numero)::text || ' OPs consolidadas'
                    ELSE NULL
                END AS observacao,
                NULL::text AS categoria,
                'CONCLUIDA'::text AS status,
                CASE WHEN COUNT(*) = 1 THEN MIN(a.arremate_id_legado) ELSE NULL END AS arremate_id,
                NULL::integer AS embalagem_id
              FROM OrigensProdutoProntoCompat a
             WHERE a.origem_tipo IN ('PRODUTO_PRONTO', 'ARREMATE_LEGADO')
             GROUP BY
                a.empresa_id,
                a.produto_id,
                NULLIF(a.variante, '-'),
                COALESCE(
                    'sessao:' || a.id_sessao_producao::text,
                    'origem:' || a.origem_id::text
                ),
                a.processo,
                a.fase

            UNION ALL

            SELECT
                'POS_OP_LEGADO'::text AS origem,
                a.id::text AS origem_id,
                CASE a.tipo_lancamento
                    WHEN 'PERDA' THEN 'PERDA'
                    WHEN 'ESTORNO' THEN 'ESTORNO_PRODUCAO'
                    WHEN 'PRODUCAO_ANULADA' THEN 'PRODUCAO_ANULADA'
                    ELSE a.tipo_lancamento
                END AS tipo_evento,
                a.data_lancamento AS data_evento,
                a.empresa_id,
                a.produto_id,
                NULLIF(a.variante, '-') AS variante,
                a.op_numero,
                a.processo,
                a.fase,
                COALESCE(a.executor_id, a.usuario_tiktik_id) AS executor_id,
                COALESCE(a.executor_nome, a.usuario_tiktik) AS executor_nome,
                a.executor_tipo,
                a.quantidade_arrematada AS quantidade,
                a.valor_ponto_aplicado,
                a.pontos_gerados,
                a.lancado_por AS autor,
                COALESCE(aj.observacao, ap.observacao) AS observacao,
                COALESCE(aj.tipo_ajuste, ap.motivo) AS categoria,
                CASE
                    WHEN a.tipo_lancamento IN ('ESTORNO', 'PRODUCAO_ANULADA') THEN 'ESTORNADA'
                    ELSE 'CONCLUIDA'
                END AS status,
                a.id AS arremate_id,
                NULL::integer AS embalagem_id
              FROM arremates a
              LEFT JOIN ajustes_producao aj
                ON aj.empresa_id = a.empresa_id
               AND aj.id = a.id_ajuste_producao
              LEFT JOIN arremate_perdas ap
                ON ap.empresa_id = a.empresa_id
               AND ap.id = a.id_perda_origem
             WHERE a.tipo_lancamento IN ('PERDA', 'ESTORNO', 'PRODUCAO_ANULADA')

            UNION ALL

            SELECT
                'SESSAO_PRODUCAO'::text AS origem,
                s.id::text AS origem_id,
                'CANCELAMENTO_TAREFA'::text AS tipo_evento,
                COALESCE(s.data_fim, s.data_inicio) AS data_evento,
                s.empresa_id,
                s.produto_id,
                NULLIF(s.variante, '-') AS variante,
                s.op_numero,
                s.processo,
                s.fase,
                s.funcionario_id AS executor_id,
                u.nome AS executor_nome,
                NULL::text AS executor_tipo,
                s.quantidade_atribuida AS quantidade,
                NULL::numeric AS valor_ponto_aplicado,
                0::numeric AS pontos_gerados,
                NULL::text AS autor,
                'Tarefa cancelada antes da conclusão'::text AS observacao,
                NULL::text AS categoria,
                'CANCELADA'::text AS status,
                NULL::integer AS arremate_id,
                NULL::integer AS embalagem_id
              FROM sessoes_trabalho_producao s
              LEFT JOIN usuarios u ON u.id = s.funcionario_id
             WHERE s.status = 'CANCELADA'

            UNION ALL

            SELECT
                'EMBALAGEM'::text AS origem,
                er.id::text AS origem_id,
                CASE
                    WHEN er.status = 'ESTORNADO' THEN 'ESTORNO_EMBALAGEM'
                    WHEN er.tipo_embalagem = 'KIT' THEN 'EMBALAGEM_KIT'
                    ELSE 'EMBALAGEM_UNIDADE'
                END AS tipo_evento,
                er.data_embalagem AS data_evento,
                er.empresa_id,
                er.produto_embalado_id AS produto_id,
                er.variante_embalada_nome AS variante,
                NULL::text AS op_numero,
                'Embalagem'::text AS processo,
                NULL::text AS fase,
                er.usuario_responsavel_id AS executor_id,
                u.nome AS executor_nome,
                NULL::text AS executor_tipo,
                er.quantidade_embalada AS quantidade,
                NULL::numeric AS valor_ponto_aplicado,
                0::numeric AS pontos_gerados,
                u.nome AS autor,
                er.observacao,
                NULL::text AS categoria,
                er.status::text AS status,
                NULL::integer AS arremate_id,
                er.id AS embalagem_id
              FROM embalagens_realizadas er
              LEFT JOIN usuarios u ON u.id = er.usuario_responsavel_id

            UNION ALL

            SELECT
                'ESTOQUE'::text AS origem,
                em.id::text AS origem_id,
                ('ESTOQUE_' || em.tipo_movimento)::text AS tipo_evento,
                em.data_movimento AS data_evento,
                em.empresa_id,
                em.produto_id,
                em.variante_nome AS variante,
                NULL::text AS op_numero,
                'Estoque'::text AS processo,
                NULL::text AS fase,
                NULL::integer AS executor_id,
                em.usuario_responsavel AS executor_nome,
                NULL::text AS executor_tipo,
                em.quantidade,
                NULL::numeric AS valor_ponto_aplicado,
                0::numeric AS pontos_gerados,
                em.usuario_responsavel AS autor,
                em.observacao,
                NULL::text AS categoria,
                CASE WHEN em.estornado THEN 'ESTORNADO' ELSE 'ATIVO' END AS status,
                em.origem_arremate_id AS arremate_id,
                em.embalagem_origem_id AS embalagem_id
              FROM estoque_movimentos em
            ${historicoOcorrenciasEmbalagem}`;

        const params = [req.empresaId];
        const filtros = ['h.empresa_id = $1'];
        const addFiltro = (sql, valor) => {
            params.push(valor);
            filtros.push(sql.replace('?', `$${params.length}`));
        };

        if (periodo === 'hoje') {
            filtros.push(`h.data_evento >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')`);
        } else if (periodo === '30d') {
            filtros.push(`h.data_evento >= NOW() - INTERVAL '30 days'`);
        } else if (periodo === 'mes_atual') {
            filtros.push(`date_trunc('month', h.data_evento AT TIME ZONE 'America/Sao_Paulo') = date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo')`);
        } else if (periodo !== 'todos') {
            filtros.push(`h.data_evento >= NOW() - INTERVAL '7 days'`);
        }

        const gruposEvento = {
            CONCLUSAO: ['CONCLUSAO_OP', 'CONCLUSAO_POS_OP'],
            PERDA: ['PERDA', 'PERDA_EMBALAGEM', 'PERDA_CONSERTO'],
            CANCELAMENTO: ['CANCELAMENTO_TAREFA', 'PRODUCAO_ANULADA'],
            EMBALAGEM: [
                'EMBALAGEM_UNIDADE',
                'EMBALAGEM_KIT',
                'ENVIO_CONSERTO',
                'RETORNO_CONSERTO',
            ],
            ESTORNO: ['ESTORNO_PRODUCAO', 'ESTORNO_EMBALAGEM'],
        };
        if (tipoEvento === 'ESTOQUE') {
            filtros.push(`h.tipo_evento LIKE 'ESTOQUE_%'`);
        } else if (tipoEvento !== 'todos' && gruposEvento[tipoEvento]) {
            addFiltro('h.tipo_evento = ANY(?::text[])', gruposEvento[tipoEvento]);
        } else if (tipoEvento !== 'todos') {
            addFiltro('h.tipo_evento = ?', tipoEvento);
        }
        if (fase !== 'todas') addFiltro('h.fase = ?', fase);
        if (produtoId) addFiltro('h.produto_id = ?', Number(produtoId));
        if (executorId) addFiltro('h.executor_id = ?', Number(executorId));
        if (processo) addFiltro('h.processo ILIKE ?', `%${processo}%`);
        if (opNumero) addFiltro('h.op_numero ILIKE ?', `%${String(opNumero)}%`);
        if (produtoBusca) addFiltro('p.nome ILIKE ?', `%${String(produtoBusca)}%`);
        if (executorBusca) addFiltro('h.executor_nome ILIKE ?', `%${String(executorBusca)}%`);
        if (busca) {
            params.push(`%${busca}%`);
            const buscaParam = `$${params.length}`;
            filtros.push(`(
                p.nome ILIKE ${buscaParam}
                OR h.executor_nome ILIKE ${buscaParam}
                OR h.autor ILIKE ${buscaParam}
                OR h.processo ILIKE ${buscaParam}
                OR h.op_numero ILIKE ${buscaParam}
            )`);
        }

        // A busca usa um único parâmetro repetido intencionalmente.
        const whereSql = `WHERE ${filtros.join(' AND ')}`;
        const fromSql = `
            FROM (${historicoBase}) h
            LEFT JOIN produtos p
              ON p.empresa_id = h.empresa_id
             AND p.id = h.produto_id
            ${whereSql}
        `;
        const countResult = await dbClient.query(`SELECT COUNT(*) ${fromSql}`, params);
        const totalItems = Number(countResult.rows[0]?.count) || 0;
        const limite = Math.min(100, Math.max(1, Number(limit) || 15));
        const pagina = Math.max(1, Number(page) || 1);
        const totalPages = Math.max(1, Math.ceil(totalItems / limite));
        const offset = (pagina - 1) * limite;
        const dataParams = [...params, limite, offset];
        const result = await dbClient.query(`
            SELECT
                h.*,
                p.nome AS produto_nome,
                COALESCE(
                    (
                        SELECT NULLIF(grade_item.value->>'imagem', '')
                          FROM jsonb_array_elements(
                              CASE
                                  WHEN jsonb_typeof(p.grade) = 'array' THEN p.grade
                                  ELSE '[]'::jsonb
                              END
                          ) AS grade_item(value)
                         WHERE grade_item.value->>'variacao' = h.variante
                         LIMIT 1
                    ),
                    p.imagem
                ) AS produto_imagem
            ${fromSql}
            ORDER BY h.data_evento DESC, h.origem DESC, h.origem_id DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `, dataParams);

        return res.status(200).json({
            rows: result.rows,
            pagination: {
                currentPage: pagina,
                totalPages,
                totalItems,
            },
        });
    } catch (error) {
        console.error('[API GET /producoes/historico] Erro:', error);
        return res.status(500).json({
            error: 'Erro ao buscar o histórico geral de Produções.',
            details: error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.post('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient; 
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        if (!permissoes.includes('atribuir-tarefa')) {
            return res.status(403).json({ error: 'Permissão negada para atribuir tarefas de produção.' });
        }
        await dbClient.query('BEGIN');
        const eventosPontoAtivos = await pontoEventosDisponivel(dbClient);
        const posOpDisponivel = await estruturaPosOpDisponivel(dbClient);
        const origensPosOpDisponivel = await origensPosOpSessaoDisponivel(dbClient);

        let {
            funcionario_id,
            opNumero,
            produto_id,
            variante,
            processo,
            processo_id,
            etapa_id,
            fase = 'OP',
            quantidade,
            funcionario,
        } = req.body;

        // Validação básica
        if (!funcionario_id || !opNumero || !produto_id || !processo || !quantidade) {
            throw new Error("Dados insuficientes para iniciar sessão.");
        }

        const tarefaValidada = await validarTarefaAtribuicao(dbClient, {
            empresaId: req.empresaId,
            funcionarioId: funcionario_id,
            opNumero,
            produtoId: produto_id,
            variante,
            processo,
            processoId: processo_id,
            etapaId: etapa_id,
            fase,
            estruturaPosOp: posOpDisponivel,
            origensPosOpDisponivel,
            quantidade,
        });
        if (tarefaValidada?.processo) processo = tarefaValidada.processo;

        const origemValida = await dbClient.query(
            `SELECT op.numero
               FROM ordens_de_producao op
               JOIN produtos p
                 ON p.id = op.produto_id
                AND p.empresa_id = op.empresa_id
              WHERE op.numero = $1
                AND op.empresa_id = $2
                AND p.id = $3`,
            [String(opNumero), req.empresaId, Number(produto_id)]
        );
        if (origemValida.rows.length === 0) {
            throw new Error('OP ou produto não pertence à empresa ativa.');
        }

        // Verifica se usuário já está ocupado
        const userStatusResult = await dbClient.query(
            `SELECT id_sessao_trabalho_atual
               FROM usuarios_empresas
              WHERE usuario_id = $1
                AND empresa_id = $2
                AND ativo
              FOR UPDATE`,
            [funcionario_id, req.empresaId]
        );
        if (userStatusResult.rows.length === 0) {
            throw new Error('Empregado não encontrado na empresa ativa.');
        }
        if (userStatusResult.rows[0]?.id_sessao_trabalho_atual !== null) {
            throw new Error('Empregado já ocupado.');
        }

        // Busca nome se não vier
        if (!funcionario) {
             const u = await dbClient.query('SELECT nome FROM usuarios WHERE id = $1', [funcionario_id]);
             funcionario = u.rows[0]?.nome || 'Desconhecido';
        }

        // CRIA A SESSÃO (Vinculada à OP principal, mas com qtd total)
        // O "Abatimento Global" na rota /fila-de-tarefas cuidará de descontar o saldo corretamente
        const sessaoQuery = posOpDisponivel
            ? `
                INSERT INTO sessoes_trabalho_producao
                    (funcionario_id, op_numero, produto_id, variante, processo,
                     quantidade_atribuida, status, data_inicio, fase,
                     processo_id, etapa_id, empresa_id)
                VALUES ($1, $2, $3, $4, $5, $6, 'EM_ANDAMENTO', NOW(), $7, $8, $9, $10)
                RETURNING id;
            `
            : `
                INSERT INTO sessoes_trabalho_producao
                    (funcionario_id, op_numero, produto_id, variante, processo,
                     quantidade_atribuida, status, data_inicio, empresa_id)
                VALUES ($1, $2, $3, $4, $5, $6, 'EM_ANDAMENTO', NOW(), $7)
                RETURNING id;
            `;
        const sessaoResult = await dbClient.query(sessaoQuery, [
            funcionario_id,
            opNumero,
            produto_id,
            (tarefaValidada?.variante ?? variante) || null,
            processo,
            quantidade,
            ...(posOpDisponivel
                ? [tarefaValidada?.fase || 'OP', tarefaValidada?.etapa?.processo_id || null, tarefaValidada?.etapa?.id || null]
                : []),
            req.empresaId,
        ]);
        const novaSessaoId = sessaoResult.rows[0].id;

        if (eventosPontoAtivos) {
            const eventoBase = {
                empresaId: req.empresaId,
                funcionarioId: funcionario_id,
                dataJornada: dataLocalSaoPaulo(),
                tarefaTipo: 'PRODUCAO',
                tarefaId: novaSessaoId,
                origem: ORIGENS_PONTO.SUPERVISOR,
                autorId: usuarioLogado.id,
                autorNome: usuarioLogado.nome || usuarioLogado.nome_usuario,
                payload: {
                    op_numero: opNumero,
                    produto_id,
                    variante: variante || null,
                    processo,
                    fase: tarefaValidada?.fase || 'OP',
                    quantidade: Number(quantidade),
                },
            };
            await registrarEventoTarefa(dbClient, {
                ...eventoBase,
                tipoEvento: TIPOS_EVENTO_TAREFA.ATRIBUIDA,
            });
            await registrarEventoTarefa(dbClient, {
                ...eventoBase,
                tipoEvento: TIPOS_EVENTO_TAREFA.INICIADA,
            });
        }

        // Atualiza status do usuário
        await dbClient.query(
            `UPDATE usuarios_empresas
                SET status_atual = 'PRODUZINDO',
                    id_sessao_trabalho_atual = $1,
                    status_data_modificacao =
                        (NOW() AT TIME ZONE 'America/Sao_Paulo')
              WHERE usuario_id = $2
                AND empresa_id = $3
                AND ativo`,
            [novaSessaoId, funcionario_id, req.empresaId]
        );

        await dbClient.query('COMMIT');
        await registrarAuditoria(dbClient, usuarioLogado, 'producao.lancada', 'producao', novaSessaoId, {
            op_numero: opNumero,
            funcionario_nome: funcionario,
            etapa_processo: processo,
            quantidade,
        });
        res.status(201).json({ message: 'Sessão iniciada!', sessaoId: novaSessaoId });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /producoes] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/producoes/lote (Atribuição Múltipla)
router.post('/lote', async (req, res) => {
    const { usuarioLogado } = req;
    const { itens, funcionario_id, funcionario_nome } = req.body; // 'itens' é o array de tarefas
    let dbClient;

    try {
        if (!itens || !Array.isArray(itens) || itens.length === 0) {
            throw new Error("Nenhum item enviado para o lote.");
        }
        if (!funcionario_id) throw new Error("Funcionário não identificado.");

        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        if (!permissoes.includes('atribuir-tarefa')) {
            return res.status(403).json({ error: 'Permissão negada para atribuir tarefas de produção.' });
        }
        await dbClient.query('BEGIN');
        const eventosPontoAtivos = await pontoEventosDisponivel(dbClient);
        const posOpDisponivel = await estruturaPosOpDisponivel(dbClient);
        const origensPosOpDisponivel = await origensPosOpSessaoDisponivel(dbClient);

        // 1. Verifica se usuário já está ocupado (opcional, mas bom manter a regra)
        const userStatusResult = await dbClient.query(
            `SELECT id_sessao_trabalho_atual
               FROM usuarios_empresas
              WHERE usuario_id = $1
                AND empresa_id = $2
                AND ativo
              FOR UPDATE`,
            [funcionario_id, req.empresaId]
        );
        if (userStatusResult.rows.length === 0) {
            throw new Error('Empregado não encontrado na empresa ativa.');
        }
        // Se sua regra de negócio permitir acumular, remova essa verificação. 
        // Assumindo que "Atribuir Lote" substitui ou inicia uma nova rodada.
        
        const idsSessoesCriadas = [];

        // 2. Loop para criar cada sessão
        for (const item of itens) {
            const {
                opNumero,
                produto_id,
                variante,
                processo,
                processo_id,
                etapa_id,
                fase = 'OP',
                quantidade,
                etapas_unificadas,
            } = item;

            const itemPreparado = fase === 'POS_OP' && Array.isArray(item.origens_pos_op)
                ? await prepararItemPosOpConsolidado(dbClient, {
                    item,
                    empresaId: req.empresaId,
                    funcionarioId: funcionario_id,
                    estruturaPosOp: posOpDisponivel,
                    origensPosOpDisponivel,
                })
                : {
                    tarefaValidada: await validarTarefaAtribuicao(dbClient, {
                            empresaId: req.empresaId,
                            funcionarioId: funcionario_id,
                            opNumero,
                            produtoId: produto_id,
                            variante,
                            processo,
                            processoId: processo_id,
                            etapaId: etapa_id,
                            fase,
                            estruturaPosOp: posOpDisponivel,
                            origensPosOpDisponivel,
                            quantidade,
                        }),
                    opNumero: String(opNumero),
                    quantidade,
                    origensPosOp: null,
                };
            const tarefaValidada = itemPreparado.tarefaValidada;
            const opNumeroRegistrado = itemPreparado.opNumero;
            const quantidadeRegistrada = itemPreparado.quantidade;
            const origensPosOpRegistradas = itemPreparado.origensPosOp;
            const processoRegistrado = tarefaValidada?.processo || processo;

            if (fase === 'POS_OP' && etapas_unificadas) {
                throw new Error('Etapas unificadas são exclusivas da produção interna da OP.');
            }

            const etapasUnificadasValidadas = fase === 'OP'
                ? validarPercursoUnificado({
                    produto: tarefaValidada.produto,
                    etapaInicial: tarefaValidada.etapa,
                    etapasSolicitadas: etapas_unificadas,
                    tiposExecutor: tarefaValidada.tiposExecutor,
                })
                : null;

            const origemValida = await dbClient.query(
                `SELECT op.numero
                   FROM ordens_de_producao op
                   JOIN produtos p
                     ON p.id = op.produto_id
                    AND p.empresa_id = op.empresa_id
                  WHERE op.numero = $1
                    AND op.empresa_id = $2
                    AND p.id = $3`,
                [String(opNumeroRegistrado), req.empresaId, Number(produto_id)]
            );
            if (origemValida.rows.length === 0) {
                throw new Error('OP ou produto de uma tarefa não pertence à empresa ativa.');
            }

            const sessaoQuery = posOpDisponivel
                ? (origensPosOpDisponivel
                    ? `
                    INSERT INTO sessoes_trabalho_producao
                        (funcionario_id, op_numero, produto_id, variante, processo,
                         quantidade_atribuida, status, data_inicio,
                         etapas_unificadas, fase, processo_id, etapa_id, origens_pos_op, empresa_id)
                    VALUES ($1, $2, $3, $4, $5, $6, 'EM_ANDAMENTO', NOW(), $7, $8, $9, $10, $11, $12)
                    RETURNING id;
                `
                    : `
                    INSERT INTO sessoes_trabalho_producao
                        (funcionario_id, op_numero, produto_id, variante, processo,
                         quantidade_atribuida, status, data_inicio,
                         etapas_unificadas, fase, processo_id, etapa_id, empresa_id)
                    VALUES ($1, $2, $3, $4, $5, $6, 'EM_ANDAMENTO', NOW(), $7, $8, $9, $10, $11)
                    RETURNING id;
                `)
                : `
                    INSERT INTO sessoes_trabalho_producao
                        (funcionario_id, op_numero, produto_id, variante, processo,
                         quantidade_atribuida, status, data_inicio,
                         etapas_unificadas, empresa_id)
                    VALUES ($1, $2, $3, $4, $5, $6, 'EM_ANDAMENTO', NOW(), $7, $8)
                    RETURNING id;
                `;
            const sessaoResult = await dbClient.query(sessaoQuery, [
                funcionario_id, opNumeroRegistrado, produto_id, (tarefaValidada?.variante ?? variante) || null, processoRegistrado, quantidadeRegistrada,
                etapasUnificadasValidadas ? JSON.stringify(etapasUnificadasValidadas) : null,
                ...(posOpDisponivel
                    ? [tarefaValidada?.fase || 'OP', tarefaValidada?.etapa?.processo_id || null, tarefaValidada?.etapa?.id || null]
                    : []),
                ...(posOpDisponivel && origensPosOpDisponivel
                    ? [origensPosOpRegistradas ? JSON.stringify(origensPosOpRegistradas) : null]
                    : []),
                req.empresaId,
            ]);
            idsSessoesCriadas.push(sessaoResult.rows[0].id);

            if (eventosPontoAtivos) {
                const eventoBase = {
                    empresaId: req.empresaId,
                    funcionarioId: funcionario_id,
                    dataJornada: dataLocalSaoPaulo(),
                    tarefaTipo: 'PRODUCAO',
                    tarefaId: sessaoResult.rows[0].id,
                    origem: ORIGENS_PONTO.SUPERVISOR,
                    autorId: usuarioLogado.id,
                    autorNome: usuarioLogado.nome || usuarioLogado.nome_usuario,
                    payload: {
                        op_numero: opNumeroRegistrado,
                        produto_id,
                        variante: variante || null,
                        processo: processoRegistrado,
                        fase: tarefaValidada?.fase || 'OP',
                        quantidade: Number(quantidadeRegistrada),
                        origens_pos_op: origensPosOpRegistradas,
                        lote: true,
                    },
                };
                await registrarEventoTarefa(dbClient, {
                    ...eventoBase,
                    tipoEvento: TIPOS_EVENTO_TAREFA.ATRIBUIDA,
                });
                await registrarEventoTarefa(dbClient, {
                    ...eventoBase,
                    tipoEvento: TIPOS_EVENTO_TAREFA.INICIADA,
                });
            }
        }

        // 3. Atualiza status do usuário
        // OBS: Como o banco só guarda UM id_sessao_trabalho_atual, vamos salvar o ID da ÚLTIMA sessão criada
        // apenas para que ele fique "Ocupado". O Painel de Atividades precisará buscar TODAS as sessões ativas.
        const ultimoId = idsSessoesCriadas[idsSessoesCriadas.length - 1];
        
        await dbClient.query(
            `UPDATE usuarios_empresas
                SET status_atual = 'PRODUZINDO',
                    id_sessao_trabalho_atual = $1,
                    status_data_modificacao =
                        (NOW() AT TIME ZONE 'America/Sao_Paulo')
              WHERE usuario_id = $2
                AND empresa_id = $3
                AND ativo`,
            [ultimoId, funcionario_id, req.empresaId]
        );

        await dbClient.query('COMMIT');
        res.status(201).json({ message: `${idsSessoesCriadas.length} tarefas atribuídas com sucesso!`, ids: idsSessoesCriadas });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /producoes/lote] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// GET /api/producoes/
router.get('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;

    try {
        dbClient = await pool.connect();
        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        const podeGerenciarTudo = permissoesCompletas.includes('acesso-gerenciar-producao');
        const podeVerProprias = permissoesCompletas.includes('ver-proprias-producoes');

        if (!podeGerenciarTudo && !podeVerProprias) {
            return res.status(403).json({ error: 'Permissão negada para visualizar produções.' });
        }

        const baseSelect = `
        SELECT
            pr.id,
            pr.op_numero,
            pr.etapa_index,
            pr.processo,
            pr.variacao,
            pr.maquina,
            pr.quantidade,
            pr.funcionario,
            pr.funcionario_id,
            pr.data,
            pr.lancado_por,
            pr.valor_ponto_aplicado,
            pr.pontos_gerados,
            pr.assinada,
            pr.edicoes,
            p.nome AS produto,
            COALESCE(
                (SELECT g.value->>'imagem'
                 FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(p.grade) = 'array' THEN p.grade ELSE '[]'::jsonb END
                 ) g
                 WHERE g.value->>'variacao' = pr.variacao LIMIT 1),
                p.imagem
            ) AS variacao_imagem,
            u.avatar_url,
            u.foto_oficial
        FROM producoes pr
        LEFT JOIN produtos p ON pr.produto_id = p.id AND p.empresa_id = pr.empresa_id
        LEFT JOIN usuarios u ON pr.funcionario_id = u.id
    `;

        const { op_numero: opNumero, funcionario_id: filtroFuncId, page, limit } = req.query;

        // Caso 1: filtro por OP — sem paginação, mantém comportamento atual
        if (opNumero) {
            const result = await dbClient.query(`${baseSelect} WHERE pr.empresa_id = $1 AND pr.op_numero = $2 ORDER BY pr.data DESC`, [req.empresaId, opNumero]);
            return res.status(200).json(result.rows);
        }

        // Caso 2: gerenciar produção — paginação server-side (com ou sem filtro de funcionário)
        if (podeGerenciarTudo && page) {
            const pageNum  = Math.max(1, parseInt(page) || 1);
            const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 20));
            const offset   = (pageNum - 1) * limitNum;

            const { funcionario_ids, data_inicio, data_fim, op_numero_busca, order } = req.query;

            const conditions  = ['pr.empresa_id = $1'];
            const queryParams = [req.empresaId];

            // Filtro por funcionários (lista separada por vírgula) ou por id único (compat)
            const idsRaw = funcionario_ids || (filtroFuncId ? filtroFuncId : null);
            if (idsRaw) {
                const ids = String(idsRaw).split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
                if (ids.length > 0) {
                    queryParams.push(ids);
                    conditions.push(`pr.funcionario_id = ANY($${queryParams.length})`);
                }
            }

            // Filtro de data (comparação no fuso de SP para evitar divergência UTC x local)
            if (data_inicio) {
                queryParams.push(data_inicio);
                conditions.push(`(pr.data AT TIME ZONE 'America/Sao_Paulo')::date >= $${queryParams.length}::date`);
            }
            if (data_fim) {
                queryParams.push(data_fim);
                conditions.push(`(pr.data AT TIME ZONE 'America/Sao_Paulo')::date <= $${queryParams.length}::date`);
            }

            // Padrão quando nenhum filtro de data ou funcionário
            if (!idsRaw && !data_inicio && !data_fim && !op_numero_busca) {
                conditions.push(`pr.data >= NOW() - INTERVAL '3 days'`);
            }

            // Busca por número de OP
            if (op_numero_busca) {
                queryParams.push(`%${op_numero_busca}%`);
                conditions.push(`pr.op_numero ILIKE $${queryParams.length}`);
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

            let orderClause = 'ORDER BY pr.data DESC';
            if (order === 'data_asc')    orderClause = 'ORDER BY pr.data ASC';
            else if (order === 'funcionario') orderClause = 'ORDER BY pr.funcionario ASC, pr.data DESC';
            else if (order === 'op')     orderClause = 'ORDER BY pr.op_numero ASC, pr.data DESC';

            const countParams = [...queryParams];
            const dataParams  = [...queryParams, limitNum, offset];

            const [countRes, dataRes] = await Promise.all([
                dbClient.query(`SELECT COUNT(*) FROM producoes pr ${whereClause}`, countParams),
                dbClient.query(
                    `${baseSelect} ${whereClause} ${orderClause} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
                    dataParams
                ),
            ]);

            const total = parseInt(countRes.rows[0].count);
            return res.status(200).json({
                rows: dataRes.rows,
                total,
                pagina: pageNum,
                totalPaginas: Math.ceil(total / limitNum),
                modo: idsRaw ? 'por_funcionario' : 'ultimos3dias',
            });
        }

        // Caso 3: sem filtro de funcionário — retorno completo (compatibilidade)
        let queryText;
        let queryParams = [];

        if (podeGerenciarTudo) {
            queryText = `${baseSelect} WHERE pr.empresa_id = $1 ORDER BY pr.data DESC`;
            queryParams = [req.empresaId];
        } else if (podeVerProprias) {
            const idFuncionario = usuarioLogado.id;
            if (!idFuncionario) {
                return res.status(400).json({ error: "Falha ao identificar ID do usuário para filtro." });
            }
            queryText = `${baseSelect} WHERE pr.empresa_id = $1 AND pr.funcionario_id = $2 ORDER BY pr.data DESC`;
            queryParams = [req.empresaId, idFuncionario];
        } else {
            return res.status(403).json({ error: 'Configuração de acesso inválida.' });
        }

        const result = await dbClient.query(queryText, queryParams);
        res.status(200).json(result.rows);

    } catch (error) {
        console.error('[API Producoes GET /] Erro na rota:', error);
        res.status(500).json({ error: 'Erro interno ao buscar produções.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PUT /api/producoes/
router.put('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoesDoUsuario = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        
        // <<< MUDANÇA: Adicionamos o 'id' ao nome do funcionário para clareza >>>
        const { id, quantidade, edicoes, assinada, funcionario: novoNomeFuncionario, dadosColetados } = req.body;

        if (!id) {
            return res.status(400).json({ error: 'ID da produção é obrigatório.' });
        }

        // <<< MUDANÇA: Buscamos mais dados do registro original >>>
        const producaoResult = await dbClient.query(
            'SELECT * FROM producoes WHERE id = $1 AND empresa_id = $2',
            [id, req.empresaId]
        );

        if (producaoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Produção não encontrada para atualização.' });
        }

        const producaoOriginal = producaoResult.rows[0];
        const nomeUsuarioLogado = usuarioLogado.nome || usuarioLogado.nome_usuario;
        
        const isOwner = producaoOriginal.funcionario === nomeUsuarioLogado;
        const isAttemptingToSignOnly = (assinada === true && quantidade === undefined && novoNomeFuncionario === undefined);
        const podeEditarGeral = permissoesDoUsuario.includes('editar-registro-producao');
        const podeAssinarPropria = permissoesDoUsuario.includes('assinar-producao-costureira');

        // CASO 1: Assinatura de Costureira
        if (isOwner && isAttemptingToSignOnly && podeAssinarPropria) {
            if (producaoOriginal.assinada) {
                return res.status(400).json({ error: 'Este item já foi assinado.' });
            }
            await dbClient.query('BEGIN');
            const updateResult = await dbClient.query(`UPDATE producoes SET assinada = TRUE WHERE id = $1 AND empresa_id = $2 RETURNING *`, [id, req.empresaId]);
            await dbClient.query(`INSERT INTO log_assinaturas (empresa_id, id_usuario, id_producao, dados_coletados) VALUES ($1, $2, $3, $4)`, [req.empresaId, usuarioLogado.id, id, dadosColetados || null]);
            await dbClient.query('COMMIT');
            return res.status(200).json(updateResult.rows[0]);
        } 
        
        // CASO 2: Edição Geral (Admin/Supervisor) - AQUI ESTÁ A CORREÇÃO!
        else if (podeEditarGeral) {
            const updateFields = [];
            const updateValues = [];
            let paramIndex = 1;

            let recalcularPontos = false;
            let idFuncionarioParaCalculo = producaoOriginal.funcionario_id;
            let quantidadeParaCalculo = producaoOriginal.quantidade;

            if (quantidade !== undefined && quantidade !== producaoOriginal.quantidade) {
                updateFields.push(`quantidade = $${paramIndex++}`);
                updateValues.push(quantidade);
                quantidadeParaCalculo = quantidade; // Usa a nova quantidade para o cálculo
                recalcularPontos = true;
            }
            
            // <<< MUDANÇA: Lógica para quando o funcionário é alterado >>>
            if (novoNomeFuncionario !== undefined && novoNomeFuncionario !== producaoOriginal.funcionario) {
                const novoFuncionarioResult = await dbClient.query(
                    `SELECT u.id
                       FROM usuarios u
                       JOIN usuarios_empresas ue
                         ON ue.usuario_id = u.id
                        AND ue.empresa_id = $2
                        AND ue.ativo
                      WHERE u.nome = $1
                      LIMIT 1`,
                    [novoNomeFuncionario, req.empresaId]
                );
                if (novoFuncionarioResult.rows.length === 0) {
                    return res.status(404).json({ error: `Funcionário '${novoNomeFuncionario}' não encontrado.` });
                }
                const novoFuncionarioId = novoFuncionarioResult.rows[0].id;

                updateFields.push(`funcionario = $${paramIndex++}`);
                updateValues.push(novoNomeFuncionario);
                updateFields.push(`funcionario_id = $${paramIndex++}`);
                updateValues.push(novoFuncionarioId);
                
                idFuncionarioParaCalculo = novoFuncionarioId; // Usa o novo funcionário para o cálculo
                recalcularPontos = true;
            }

            if (edicoes !== undefined) {
                updateFields.push(`edicoes = $${paramIndex++}`);
                updateValues.push(edicoes);
            }
            
            // <<< MUDANÇA: Se precisa recalcular, chama a nossa nova função! >>>
            if (recalcularPontos) {
                const { pontosGerados, valorPontoAplicado } = await calcularPontosProducao(
                    dbClient,
                    producaoOriginal.produto_id,
                    producaoOriginal.processo,
                    quantidadeParaCalculo,
                    idFuncionarioParaCalculo,
                    req.empresaId
                );

                updateFields.push(`pontos_gerados = $${paramIndex++}`);
                updateValues.push(pontosGerados);
                updateFields.push(`valor_ponto_aplicado = $${paramIndex++}`);
                updateValues.push(valorPontoAplicado);
            }

            // O resto da lógica de assinatura continua igual
            if (assinada !== undefined) {
                updateFields.push(`assinada = $${paramIndex++}`);
                updateValues.push(assinada);
            }

            if (updateFields.length === 0) {
                return res.status(200).json(producaoOriginal); // Nenhuma alteração, retorna o original
            }

            updateValues.push(id, req.empresaId);
            const queryUpdate = `UPDATE producoes SET ${updateFields.join(', ')} WHERE id = $${paramIndex} AND empresa_id = $${paramIndex + 1} RETURNING *`;
            const result = await dbClient.query(queryUpdate, updateValues);
            await registrarAuditoria(dbClient, usuarioLogado, 'producao.editada', 'producao', id, {
                id,
                op_numero: producaoOriginal.op_numero,
                funcionario_nome: producaoOriginal.funcionario,
                quantidade_antes: producaoOriginal.quantidade,
                quantidade_depois: result.rows[0].quantidade,
            });
            return res.status(200).json(result.rows[0]);
        }
        
        // CASO 3: Permissão negada
        else {
            return res.status(403).json({ error: 'Permissão negada para alterar este registro de produção.' });
        }

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[router/producoes PUT] Erro:', error.message, error.stack ? error.stack.substring(0,500):"");
        res.status(500).json({ error: 'Erro ao atualizar produção.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// DELETE /api/producoes/
router.delete('/', async (req, res) => {
    const { usuarioLogado } = req;
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN'); // <<< 1. INICIA A TRANSAÇÃO

        const permissoesCompletas = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        if (!permissoesCompletas.includes('excluir-registro-producao-direto')) {
            await dbClient.query('ROLLBACK');
            return res.status(403).json({ error: 'Permissão negada para excluir registro de produção.' });
        }

        const { id } = req.body;
        if (!id) {
            await dbClient.query('ROLLBACK');
            return res.status(400).json({ error: 'ID não fornecido.' });
        }

        const deleteResult = await dbClient.query('DELETE FROM producoes WHERE id = $1 AND empresa_id = $2 RETURNING *', [id, req.empresaId]);

        if (deleteResult.rowCount === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Produção não encontrada para exclusão.' });
        }

        const producaoExcluida = deleteResult.rows[0];

        // Cancela solicitações pendentes para este registro
        await dbClient.query(
            `UPDATE producoes_solicitacoes_exclusao
             SET status = 'cancelada',
                 decidido_por_id = $1,
                 decidido_por_nome = $2,
                 decidido_em = NOW(),
                 motivo_decisao = 'Registro deletado diretamente'
             WHERE producao_id = $3
               AND empresa_id = $4
               AND status = 'pendente'`,
            [usuarioLogado.id, usuarioLogado.nome || usuarioLogado.nome_usuario, id, req.empresaId]
        );

        await dbClient.query('COMMIT'); // <<< 2. CONFIRMA AS ALTERAÇÕES
        await registrarAuditoria(dbClient, usuarioLogado, 'producao.excluida', 'producao', producaoExcluida.id, {
            id: producaoExcluida.id,
            op_numero: producaoExcluida.op_numero,
            funcionario_nome: producaoExcluida.funcionario,
            quantidade: producaoExcluida.quantidade,
        });
        res.status(200).json(producaoExcluida);

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK'); // <<< 3. DESFAZ EM CASO DE ERRO
        console.error('[router/producoes DELETE] Erro:', error.message);
        res.status(500).json({ error: 'Erro ao excluir produção.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

//ENDPOINT PARA TIKTIK ASSINAR UMA OP (PRODUÇÃO)
router.put('/assinar-tiktik-op', async (req, res) => {
    const { usuarioLogado } = req;
    // NOVO: Recebe o objeto 'dadosColetados'
    const { id_producao_op, dadosColetados } = req.body;
    let dbClient;

    if (!id_producao_op) {
        return res.status(400).json({ error: 'ID da produção da OP é obrigatório.' });
    }

    try {
        dbClient = await pool.connect();
        const permissoesUsuario = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        
        // Assumi que você criará esta permissão como planejado
        if (!permissoesUsuario.includes('assinar-producao-tiktik')) {
             return res.status(403).json({ error: 'Permissão negada para assinar esta produção de OP.' });
        }

        const producaoResult = await dbClient.query(
            'SELECT funcionario, assinada_por_tiktik FROM producoes WHERE id = $1 AND empresa_id = $2',
            [id_producao_op, req.empresaId]
        );

        if (producaoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Produção da OP não encontrada.' });
        }

        const { funcionario, assinada_por_tiktik } = producaoResult.rows[0];
        if (funcionario !== usuarioLogado.nome) {
            return res.status(403).json({ error: 'Você só pode assinar produções de OP feitas por você.' });
        }
        if (assinada_por_tiktik) {
            return res.status(400).json({ error: 'Esta produção de OP já foi assinada por você.' });
        }

        // Inicia a transação
        await dbClient.query('BEGIN');
        
        // 1. Atualiza a produção
        const updateResult = await dbClient.query(
            'UPDATE producoes SET assinada_por_tiktik = TRUE WHERE id = $1 AND empresa_id = $2 RETURNING *',
            [id_producao_op, req.empresaId]
        );
        
        // 2. Insere o log da assinatura
        await dbClient.query(
            'INSERT INTO log_assinaturas (empresa_id, id_usuario, id_producao, dados_coletados) VALUES ($1, $2, $3, $4)',
            [req.empresaId, usuarioLogado.id, id_producao_op, dadosColetados || null]
        );

        // Confirma a transação
        await dbClient.query('COMMIT');

        res.status(200).json({ message: 'Produção da OP assinada com sucesso pelo Tiktik.', producao: updateResult.rows[0] });

    } catch (error) {
        // Se der erro, desfaz a transação
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /producoes/assinar-tiktik-op PUT] Erro:', error.message);
        res.status(500).json({ error: 'Erro interno ao assinar produção da OP.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ========= NOVA ROTA PARA FINALIZAR UMA TAREFA DE PRODUÇÃO (OTIMIZADA) =========
router.put('/finalizar', async (req, res) => {
    const { usuarioLogado } = req;
    const { id_sessao, quantidade_finalizada, pausa_manual_ms = 0 } = req.body;
    let dbClient;

    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, usuarioLogado.id, req.empresaId);
        if (!permissoes.includes('finalizar-tarefa-producao')) {
            return res.status(403).json({ error: 'Permissão negada para finalizar tarefas de produção.' });
        }
        await dbClient.query('BEGIN');
        const eventosPontoAtivos = await pontoEventosDisponivel(dbClient);
        
        // 1. Busca a sessão e trava
        const sessaoResult = await dbClient.query(
            `SELECT *
               FROM sessoes_trabalho_producao
              WHERE id = $1
                AND empresa_id = $2
              FOR UPDATE`,
            [id_sessao, req.empresaId]
        );
        if (sessaoResult.rows.length === 0) throw new Error('Sessão não encontrada.');
        const sessao = sessaoResult.rows[0];
        if (sessao.status !== 'EM_ANDAMENTO') throw new Error('Tarefa já finalizada.');

        // 2. Busca dados do funcionário (UMA VEZ SÓ)
        const funcRes = await dbClient.query(
            `SELECT u.nome, ue.tipos
               FROM usuarios u
               JOIN usuarios_empresas ue
                 ON ue.usuario_id = u.id
                AND ue.empresa_id = $2
                AND ue.ativo
              WHERE u.id = $1`,
            [sessao.funcionario_id, req.empresaId]
        );
        const dadosFuncionario = funcRes.rows[0] || { nome: 'Desconhecido', tipos: [] };
        const nomeFuncionario = dadosFuncionario.nome;

        // 3. Define Configuração de Pontos (Inferência de Tipo)
        let tipoAtividadeParaConfig = null;
        if (dadosFuncionario.tipos.includes('costureira')) tipoAtividadeParaConfig = 'costura_op_costureira';
        else if (dadosFuncionario.tipos.includes('tiktik')) tipoAtividadeParaConfig = 'processo_op_tiktik';

        // 4. Busca Máquina Correta
        const produtoResult = await dbClient.query(
            'SELECT etapas, "etapastiktik" AS etapas_tiktik FROM produtos WHERE id = $1 AND empresa_id = $2',
            [sessao.produto_id, req.empresaId]
        );
        const produtoComEtapas = produtoResult.rows[0] || {};
        const etapasDoProduto = produtoComEtapas.etapas || [];
        const etapaConfigCanonica = encontrarEtapaParaAtribuicao(produtoComEtapas, {
            fase: sessao.fase || 'OP',
            processo: sessao.processo,
            processoId: sessao.processo_id,
            etapaId: sessao.etapa_id,
        });
        const etapaConfigProduto = etapaConfigCanonica || etapasDoProduto.find(e => (e.processo || e) === sessao.processo);
        const maquinaCorreta = (etapaConfigProduto && typeof etapaConfigProduto === 'object') ? (etapaConfigProduto.maquina || 'Não Definida') : 'Não Definida';

        // ─── SESSÃO UNIFICADA — insere producoes por etapa + TPP proporcional ────────────
        const etapasUnificadas = Array.isArray(sessao.etapas_unificadas) && sessao.etapas_unificadas.length >= 2
            ? sessao.etapas_unificadas : null;

        if (sessao.fase === 'POS_OP') {
            const qtdPosOp = parseInt(quantidade_finalizada, 10);
            if (!Number.isInteger(qtdPosOp) || qtdPosOp < 0 || qtdPosOp > Number(sessao.quantidade_atribuida)) {
                throw new Error('Quantidade finalizada inválida para o arremate pós-OP.');
            }
            if (etapasUnificadas) {
                throw new Error('Uma tarefa pós-OP não pode conter etapas unificadas.');
            }

            if (qtdPosOp > 0) {
                const configPontosPosOp = await dbClient.query(
                    `SELECT pontos_padrao
                       FROM configuracoes_pontos_processos
                      WHERE empresa_id = $1
                        AND produto_id = $2
                        AND tipo_atividade = 'arremate_tiktik'
                        AND ativo = TRUE
                      LIMIT 1`,
                    [req.empresaId, sessao.produto_id],
                );
                const valorPontoPosOp = configPontosPosOp.rows[0]?.pontos_padrao !== undefined
                    ? parseFloat(configPontosPosOp.rows[0].pontos_padrao)
                    : 1;
                const executorTipo = dadosFuncionario.tipos.includes('costureira') ? 'costureira'
                    : dadosFuncionario.tipos.includes('tiktik') ? 'tiktik' : null;

                const origensDaSessao = normalizarOrigensPersistidas(sessao.origens_pos_op);
                if (origensDaSessao.length > 0) {
                    const quantidadeReservada = origensDaSessao.reduce(
                        (total, origem) => total + origem.quantidade,
                        0,
                    );
                    if (quantidadeReservada < Number(sessao.quantidade_atribuida)) {
                        throw new Error('A tarefa pós-OP consolidada possui origens incompletas.');
                    }
                }

                let quantidadeRestante = qtdPosOp;
                const distribuicao = [];
                const origensParaDistribuir = origensDaSessao.length > 0
                    ? origensDaSessao
                    : [{ op_numero: String(sessao.op_numero), quantidade: qtdPosOp }];

                for (const origem of origensParaDistribuir) {
                    if (quantidadeRestante <= 0) break;
                    const quantidadeDaOrigem = Math.min(quantidadeRestante, origem.quantidade);
                    if (quantidadeDaOrigem <= 0) continue;
                    distribuicao.push({
                        op_numero: origem.op_numero,
                        quantidade: quantidadeDaOrigem,
                    });
                    quantidadeRestante -= quantidadeDaOrigem;
                }

                if (quantidadeRestante > 0) {
                    throw new Error('A quantidade finalizada excede as origens reservadas da tarefa pós-OP.');
                }

                const pontosPosOpTotal = parseFloat((qtdPosOp * valorPontoPosOp).toFixed(2));
                let pontosDistribuidos = 0;
                distribuicao.forEach((origem, index) => {
                    origem.pontos = index === distribuicao.length - 1
                        ? parseFloat((pontosPosOpTotal - pontosDistribuidos).toFixed(2))
                        : parseFloat((origem.quantidade * valorPontoPosOp).toFixed(2));
                    pontosDistribuidos = parseFloat((pontosDistribuidos + origem.pontos).toFixed(2));
                });

                for (const origem of distribuicao) {
                    const arremateResult = await dbClient.query(
                        `INSERT INTO arremates
                            (empresa_id, op_numero, produto_id, variante,
                             quantidade_arrematada, usuario_tiktik_id, usuario_tiktik,
                             lancado_por, tipo_lancamento, id_sessao_producao,
                             valor_ponto_aplicado, pontos_gerados, fase, processo,
                             processo_id, etapa_id, executor_id, executor_nome, executor_tipo)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PRODUCAO', $9,
                                 $10, $11, 'POS_OP', $12, $13, $14, $6, $7, $15)
                         RETURNING id`,
                        [
                            req.empresaId,
                            origem.op_numero,
                            sessao.produto_id,
                            sessao.variante,
                            origem.quantidade,
                            sessao.funcionario_id,
                            nomeFuncionario,
                            usuarioLogado.nome,
                            sessao.id,
                            valorPontoPosOp,
                            origem.pontos,
                            sessao.processo,
                            sessao.processo_id || null,
                            sessao.etapa_id || null,
                            executorTipo,
                        ],
                    );
                    await registrarOrigemProdutoPronto(dbClient, {
                        empresaId: req.empresaId,
                        produtoId: sessao.produto_id,
                        variante: sessao.variante,
                        opNumero: origem.op_numero,
                        processo: sessao.processo,
                        processoId: sessao.processo_id,
                        etapaId: sessao.etapa_id,
                        sessaoProducaoId: sessao.id,
                        arremateIdLegado: arremateResult.rows[0].id,
                        quantidade: origem.quantidade,
                        valorPontoAplicado: valorPontoPosOp,
                        pontosGerados: origem.pontos,
                        executorId: sessao.funcionario_id,
                        executorNome: nomeFuncionario,
                        executorTipo,
                    });
                }
            }
        } else if (etapasUnificadas) {
            const quantidadeUnificada = Number(quantidade_finalizada);
            if (!Number.isInteger(quantidadeUnificada)
                || quantidadeUnificada < 0
                || quantidadeUnificada > Number(sessao.quantidade_atribuida)) {
                throw new Error('Quantidade finalizada invalida para o percurso unificado.');
            }
            const duracaoTotalMs = Date.now() - new Date(sessao.data_inicio).getTime();
            const pausaMs = Math.max(0, parseInt(pausa_manual_ms) || 0);
            const duracaoSegPorPeca = quantidadeUnificada > 0
                ? Math.max(0, duracaoTotalMs - pausaMs) / 1000 / quantidadeUnificada
                : 0;

            await registrarPercursoUnificadoConcluido(dbClient, {
                sessao,
                etapas: etapasUnificadas,
                quantidade: quantidadeUnificada,
                nomeFuncionario,
                lancadoPor: usuarioLogado.nome,
                empresaId: req.empresaId,
            });
            await atualizarTPPProporcionado(dbClient, sessao.produto_id, etapasUnificadas, duracaoSegPorPeca, req.empresaId);
        } else {
        // ─── SESSÃO NORMAL — distribuição por múltiplas OPs ──────────────────────────────

        let quantidadeRestante = parseInt(quantidade_finalizada);

        // 5. Busca OPs candidatas
        const opsDisponiveisResult = await dbClient.query(`
            SELECT numero, etapas, quantidade 
            FROM ordens_de_producao 
            WHERE empresa_id = $3
              AND produto_id = $1
              AND (variante = $2 OR ($2 IS NULL AND variante IS NULL))
              AND status IN ('em-aberto', 'produzindo')
            ORDER BY numero ASC
        `, [sessao.produto_id, sessao.variante, req.empresaId]);
        
        const opsCandidatas = opsDisponiveisResult.rows;

        // SE NÃO TIVER OP DISPONÍVEL, TEMOS QUE LANÇAR SEM OP OU NA OP ORIGINAL MESMO QUE FECHADA
        // Para evitar erro 500, vamos buscar a OP original se ela não veio na lista de abertas
        let opOriginalFallback = null;
        if (opsCandidatas.length === 0) {
             const opOrigRes = await dbClient.query(
                'SELECT numero, etapas FROM ordens_de_producao WHERE numero = $1 AND empresa_id = $2',
                [sessao.op_numero, req.empresaId]
             );
             if (opOrigRes.rows.length > 0) opOriginalFallback = opOrigRes.rows[0];
        }

        // 6. Mapeia saldos
        const numerosOps = opsCandidatas.map(op => op.numero);
        let mapaSaldo = new Map();
        
        if (numerosOps.length > 0) {
            const lancamentosAnt = await dbClient.query(`
                SELECT op_numero, etapa_index, SUM(quantidade) as total
                FROM producoes
                WHERE empresa_id = $2
                  AND op_numero = ANY($1::text[])
                GROUP BY op_numero, etapa_index
            `, [numerosOps, req.empresaId]);
            lancamentosAnt.rows.forEach(r => mapaSaldo.set(`${r.op_numero}-${r.etapa_index}`, parseInt(r.total)));
        }

        const logAuditoria = []; 

        // 7. Distribuição (Só roda se tiver OPs ativas)
        for (const op of opsCandidatas) {
            if (quantidadeRestante <= 0) break;

            const etapaIndex = op.etapas.findIndex(e => (e.processo || e) === sessao.processo);
            if (etapaIndex === -1) continue;

            let entrada = (etapaIndex === 0) ? parseInt(op.quantidade) : (mapaSaldo.get(`${op.numero}-${etapaIndex - 1}`) || 0);
            let saida = mapaSaldo.get(`${op.numero}-${etapaIndex}`) || 0;
            
            const disponivel = Math.max(0, entrada - saida);

            if (disponivel > 0) {
                const qtdLancar = Math.min(quantidadeRestante, disponivel);
                const { pontosGerados, valorPontoAplicado } =
                    await calcularPontosProducao(
                        dbClient,
                        sessao.produto_id,
                        sessao.processo,
                        qtdLancar,
                        sessao.funcionario_id,
                        req.empresaId
                    );

                await dbClient.query(
                    `INSERT INTO producoes (id, op_numero, etapa_index, processo, produto_id, variacao, maquina, quantidade, funcionario, funcionario_id, data, lancado_por, valor_ponto_aplicado, pontos_gerados, empresa_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13, $14)`,
                    [`prod_${Date.now()}_${Math.random().toString(36).substr(2,4)}`, op.numero, etapaIndex, sessao.processo, sessao.produto_id, sessao.variante || '-', maquinaCorreta, qtdLancar, nomeFuncionario, sessao.funcionario_id, usuarioLogado.nome, valorPontoAplicado, pontosGerados, req.empresaId]
                );
                logAuditoria.push(`OP #${op.numero}: ${qtdLancar}`);
                quantidadeRestante -= qtdLancar;
                mapaSaldo.set(`${op.numero}-${etapaIndex}`, saida + qtdLancar);
            }
        }

        // 8. Sobra (Estouro)
        if (quantidadeRestante > 0) {
             // Tenta achar a OP original nas candidatas, ou usa o fallback (mesmo que fechada)
             const opAlvo = opsCandidatas.find(o => o.numero === sessao.op_numero) || opsCandidatas[0] || opOriginalFallback;
             
             if (opAlvo) { // <--- VERIFICAÇÃO DE SEGURANÇA
                const idx = opAlvo.etapas.findIndex(e => (e.processo || e) === sessao.processo);

                const { pontosGerados, valorPontoAplicado } = await calcularPontosProducao(
                    dbClient, sessao.produto_id, sessao.processo,
                    quantidadeRestante, sessao.funcionario_id, req.empresaId
                );

                await dbClient.query(
                    `INSERT INTO producoes (id, op_numero, etapa_index, processo, produto_id, variacao, maquina, quantidade, funcionario, funcionario_id, data, lancado_por, valor_ponto_aplicado, pontos_gerados, empresa_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13, $14)`,
                    [`prod_force_${Date.now()}`, opAlvo.numero, idx, sessao.processo, sessao.produto_id, sessao.variante || '-', maquinaCorreta, quantidadeRestante, nomeFuncionario, sessao.funcionario_id, usuarioLogado.nome, valorPontoAplicado, pontosGerados, req.empresaId]
                );
                
                logAuditoria.push(`FORÇADO OP #${opAlvo.numero}: ${quantidadeRestante}`);
             } else {
                 throw new Error('Nenhuma OP válida encontrada para lançar a produção.');
             }
        }
        } // fim sessão normal

        // 9. Finaliza sessão — detecta intervalo e define o novo status
        const agoraSP = new Date();
        const horaAtualSP = agoraSP.toLocaleTimeString('en-GB', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
        });
        const dataHojeSP = agoraSP.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

        const horariosRes = await dbClient.query(
            `SELECT horario_saida_1, horario_entrada_2, horario_saida_2,
                    horario_entrada_3, horario_saida_3, status_atual
             FROM usuarios_empresas
             WHERE usuario_id = $1
               AND empresa_id = $2
               AND ativo`,
            [sessao.funcionario_id, req.empresaId]
        );
        const horariosFuncionario = horariosRes.rows[0] || {};

        // BUG-14: se o supervisor fez LIVRE_MANUAL (liberou manualmente durante intervalo),
        // preservar esse override. Não detectar intervalo automático — evita loop
        // "supervisor libera → finaliza tarefa → sistema volta ALMOCO".
        let novoStatusFinal;
        if (horariosFuncionario.status_atual === 'LIVRE_MANUAL') {
            novoStatusFinal = 'LIVRE_MANUAL'; // respeitar o override do supervisor
        } else {
            novoStatusFinal = await detectarIntervaloAoFinalizar(
                dbClient,
                sessao.funcionario_id,
                req.empresaId,
                horariosFuncionario,
                dataHojeSP,
                horaAtualSP
            );
        }

        await dbClient.query(
            `UPDATE sessoes_trabalho_producao
             SET status = 'FINALIZADA', data_fim = NOW(), quantidade_finalizada = $1,
                 pausa_manual_ms = $3
             WHERE id = $2
               AND empresa_id = $4`,
            [
                quantidade_finalizada,
                id_sessao,
                Math.max(0, parseInt(pausa_manual_ms) || 0),
                req.empresaId,
            ]
        );

        if (eventosPontoAtivos) {
            await registrarEventoTarefa(dbClient, {
                empresaId: req.empresaId,
                funcionarioId: sessao.funcionario_id,
                dataJornada: dataHojeSP,
                tipoEvento: TIPOS_EVENTO_TAREFA.FINALIZADA,
                tarefaTipo: 'PRODUCAO',
                tarefaId: sessao.id,
                idempotencyKey: `tarefa:PRODUCAO:${sessao.id}:finalizada`,
                origem: ORIGENS_PONTO.SUPERVISOR,
                autorId: usuarioLogado.id,
                autorNome: usuarioLogado.nome || usuarioLogado.nome_usuario,
                payload: {
                    quantidade_atribuida: sessao.quantidade_atribuida,
                    quantidade_finalizada: Number(quantidade_finalizada),
                    fase: sessao.fase || 'OP',
                    origens_pos_op: normalizarOrigensPersistidas(sessao.origens_pos_op),
                    pausa_manual_ms: Math.max(0, parseInt(pausa_manual_ms) || 0),
                },
            });
        }

        // Reinicia o cronômetro da próxima tarefa na fila (se houver)
        await dbClient.query(`
            UPDATE sessoes_trabalho_producao
            SET data_inicio = NOW()
            WHERE id = (
                SELECT id FROM sessoes_trabalho_producao
                WHERE funcionario_id = $1
                  AND empresa_id = $3
                  AND status = 'EM_ANDAMENTO'
                  AND id != $2
                ORDER BY id ASC LIMIT 1
            )
              AND empresa_id = $3
        `, [sessao.funcionario_id, id_sessao, req.empresaId]);

        // Status pode ser LIVRE, ALMOCO ou PAUSA — não hardcodar 'LIVRE'
        await dbClient.query(
            `UPDATE usuarios_empresas
             SET status_atual = $1,
                 status_data_modificacao = (NOW() AT TIME ZONE 'America/Sao_Paulo'),
                 id_sessao_trabalho_atual = NULL
             WHERE usuario_id = $2
               AND empresa_id = $3
               AND ativo`,
            [novoStatusFinal, sessao.funcionario_id, req.empresaId]
        );

        await dbClient.query('COMMIT');

        res.status(200).json({ message: 'Tarefa finalizada e distribuída com pontos calculados!' });

        // Hook de gincanas — apenas costureiras (tiktiks: aguardar fase posterior, seção 4.9 plano v4.0)
        if (dadosFuncionario.tipos.includes('costureira')) {
            try {
                await verificarGincanasAposProducao(
                    dbClient,
                    sessao.funcionario_id,
                    new Date(),
                    req.empresaId
                );
            } catch (err) {
                console.error('[GINCANA HOOK]', err.message);
            }
        }

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API PUT /finalizar] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/producoes/externos-recentes — últimos lançamentos externos das últimas 24h
router.get('/externos-recentes', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(`
            SELECT
                p.id, p.op_numero, p.variacao, p.processo, p.quantidade,
                p.data, p.lancado_por,
                prod.nome AS produto_nome,
                u.nome AS freelance_nome, u.tipos AS freelance_tipos
            FROM producoes p
            JOIN usuarios u ON u.id = p.funcionario_id AND 'prestador_externo' = ANY(u.tipos)
            LEFT JOIN produtos prod ON prod.id = p.produto_id
            WHERE p.empresa_id = $1
              AND (prod.empresa_id = p.empresa_id OR prod.id IS NULL)
              AND p.data >= NOW() - INTERVAL '24 hours'
            ORDER BY p.data DESC
            LIMIT 20
        `, [req.empresaId]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[API GET /producoes/externos-recentes] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// DELETE /api/producoes/externo/:id — desfaz um lançamento externo (producao + sessao)
router.delete('/externo/:id', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id, req.empresaId);
        if (!permissoes.includes('desfazer-lancamento-p-externo') && !permissoes.includes('acesso-ordens-de-producao')) {
            return res.status(403).json({ error: 'Permissão negada para desfazer lançamento de produção externa.' });
        }
        await dbClient.query('BEGIN');

        // Verifica que é realmente um lançamento externo (freelance)
        const producaoRes = await dbClient.query(`
            SELECT p.id, p.funcionario_id, p.op_numero, p.produto_id, p.processo
            FROM producoes p
            JOIN usuarios u ON u.id = p.funcionario_id AND 'prestador_externo' = ANY(u.tipos)
            WHERE p.id = $1
              AND p.empresa_id = $2
        `, [req.params.id, req.empresaId]);

        if (producaoRes.rows.length === 0) {
            return res.status(404).json({ error: 'Lançamento externo não encontrado.' });
        }

        const p = producaoRes.rows[0];

        // Remove a sessão FINALIZADA correspondente (a mais recente que bate com os dados)
        await dbClient.query(`
            DELETE FROM sessoes_trabalho_producao
            WHERE id = (
                SELECT id FROM sessoes_trabalho_producao
                WHERE funcionario_id = $1
                  AND op_numero = $2
                  AND produto_id = $3
                  AND processo = $4
                  AND empresa_id = $5
                  AND status = 'FINALIZADA'
                ORDER BY data_inicio DESC
                LIMIT 1
            )
              AND empresa_id = $5
        `, [
            p.funcionario_id,
            p.op_numero,
            p.produto_id,
            p.processo,
            req.empresaId,
        ]);

        // Remove o registro de producao
        await dbClient.query('DELETE FROM producoes WHERE id = $1 AND empresa_id = $2', [p.id, req.empresaId]);

        await dbClient.query('COMMIT');
        res.status(200).json({ ok: true });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API DELETE /producoes/externo/:id] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/producoes/externo — lançamento de produção realizada por prestador externo (freelance)
router.post('/externo', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const permissoes = await getPermissoesCompletasUsuarioDB(dbClient, req.usuarioLogado.id, req.empresaId);
        if (!permissoes.includes('confirmar-lancamento')) {
            return res.status(403).json({ error: 'Permissão negada para confirmar lançamentos de produção externa.' });
        }
        await dbClient.query('BEGIN');

        const { freelance_tipo, itens } = req.body;
        if (!freelance_tipo || !Array.isArray(itens) || itens.length === 0) {
            return res.status(400).json({ error: 'Dados insuficientes.' });
        }
        if (!['costureira', 'tiktik'].includes(freelance_tipo)) {
            return res.status(400).json({ error: 'Tipo de prestador externo invÃ¡lido.' });
        }

        // Busca o perfil placeholder de prestador externo.
        // Prioriza usuário que ainda tenha o tipo legado (ex: 'costureira' ou 'tiktik') no array de tipos.
        const freelanceRes = await dbClient.query(
            `SELECT u.id, u.nome
               FROM usuarios u
               JOIN usuarios_empresas ue
                 ON ue.usuario_id = u.id
                AND ue.empresa_id = $2
                AND ue.ativo
              WHERE 'prestador_externo' = ANY(ue.tipos)
              ORDER BY (CASE WHEN $1 = ANY(ue.tipos) THEN 0 ELSE 1 END), u.id
             LIMIT 1`,
            [freelance_tipo, req.empresaId]
        );
        if (freelanceRes.rows.length === 0) {
            throw new Error(`Nenhum usuário do tipo 'prestador_externo' cadastrado. Verifique o cadastro de usuários.`);
        }
        const freelance = freelanceRes.rows[0];
        const posOpDisponivel = await estruturaPosOpDisponivel(dbClient);
        const origensPosOpDisponivel = posOpDisponivel
            ? await origensPosOpSessaoDisponivel(dbClient)
            : false;

        for (let i = 0; i < itens.length; i++) {
            const {
                op_numero,
                produto_id,
                variante,
                processo,
                processo_id,
                etapa_id,
                fase = 'OP',
                quantidade,
                etapas_unificadas,
                origens_pos_op,
            } = itens[i];

            if (!['OP', 'POS_OP'].includes(fase)) {
                throw new Error('Fase de lançamento externo inválida.');
            }
            if (freelance_tipo === 'costureira' && fase === 'POS_OP') {
                throw new Error('Freelance costureira pode lançar somente processos da OP.');
            }
            if (freelance_tipo === 'tiktik' && fase !== 'POS_OP') {
                throw new Error('Freelance TikTik pode lançar somente arremates pós-OP.');
            }

            if (fase === 'POS_OP') {
                if (!posOpDisponivel) {
                    throw new Error('O fluxo de arremate pÃ³s-OP ainda nÃ£o foi liberado no banco.');
                }

                const itemPreparado = await prepararItemPosOpConsolidado(dbClient, {
                    item: {
                        opNumero: op_numero,
                        produto_id,
                        variante,
                        processo,
                        processo_id,
                        etapa_id,
                        fase: 'POS_OP',
                        quantidade,
                        origens_pos_op,
                    },
                    empresaId: req.empresaId,
                    funcionarioId: freelance.id,
                    estruturaPosOp: posOpDisponivel,
                    origensPosOpDisponivel,
                    tiposExecutorOverride: [freelance_tipo],
                });
                const tarefaValidada = itemPreparado.tarefaValidada;
                const quantidadeRegistrada = itemPreparado.quantidade;
                const processoRegistrado = tarefaValidada.processo;
                const etapaRegistrada = tarefaValidada.etapa;
                const origensRegistradas = itemPreparado.origensPosOp || [{
                    op_numero: itemPreparado.opNumero,
                    quantidade: quantidadeRegistrada,
                }];

                const sessaoQuery = origensPosOpDisponivel
                    ? `
                        INSERT INTO sessoes_trabalho_producao
                            (funcionario_id, op_numero, produto_id, variante, processo,
                             processo_id, etapa_id, fase, quantidade_atribuida,
                             quantidade_finalizada, status, data_inicio, data_fim,
                             origens_pos_op, empresa_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, 'POS_OP', $8, $8,
                                'FINALIZADA', NOW(), NOW(), $9, $10)
                        RETURNING id`
                    : `
                        INSERT INTO sessoes_trabalho_producao
                            (funcionario_id, op_numero, produto_id, variante, processo,
                             processo_id, etapa_id, fase, quantidade_atribuida,
                             quantidade_finalizada, status, data_inicio, data_fim,
                             empresa_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, 'POS_OP', $8, $8,
                                'FINALIZADA', NOW(), NOW(), $9)
                        RETURNING id`;
                const sessaoResult = await dbClient.query(sessaoQuery, origensPosOpDisponivel
                    ? [
                        freelance.id,
                        itemPreparado.opNumero,
                        produto_id,
                        varianteParaBanco(variante),
                        processoRegistrado,
                        etapaRegistrada.processo_id || null,
                        etapaRegistrada.id || null,
                        quantidadeRegistrada,
                        JSON.stringify(origensRegistradas),
                        req.empresaId,
                    ]
                    : [
                        freelance.id,
                        itemPreparado.opNumero,
                        produto_id,
                        varianteParaBanco(variante),
                        processoRegistrado,
                        etapaRegistrada.processo_id || null,
                        etapaRegistrada.id || null,
                        quantidadeRegistrada,
                        req.empresaId,
                    ]);
                const sessaoId = sessaoResult.rows[0].id;

                const configPontosPosOp = await dbClient.query(
                    `SELECT pontos_padrao
                       FROM configuracoes_pontos_processos
                      WHERE empresa_id = $1
                        AND produto_id = $2
                        AND tipo_atividade = 'arremate_tiktik'
                        AND ativo = TRUE
                      LIMIT 1`,
                    [req.empresaId, produto_id],
                );
                const valorPontoPosOp = configPontosPosOp.rows[0]?.pontos_padrao !== undefined
                    ? parseFloat(configPontosPosOp.rows[0].pontos_padrao)
                    : 1;
                const pontosTotais = parseFloat((quantidadeRegistrada * valorPontoPosOp).toFixed(2));
                let pontosDistribuidos = 0;

                for (let origemIndex = 0; origemIndex < origensRegistradas.length; origemIndex++) {
                    const origem = origensRegistradas[origemIndex];
                    const pontosOrigem = origemIndex === origensRegistradas.length - 1
                        ? parseFloat((pontosTotais - pontosDistribuidos).toFixed(2))
                        : parseFloat((Number(origem.quantidade) * valorPontoPosOp).toFixed(2));
                    pontosDistribuidos = parseFloat((pontosDistribuidos + pontosOrigem).toFixed(2));
                    const arremateResult = await dbClient.query(
                        `INSERT INTO arremates
                            (empresa_id, op_numero, produto_id, variante,
                             quantidade_arrematada, usuario_tiktik_id, usuario_tiktik,
                             lancado_por, tipo_lancamento, id_sessao_producao,
                             valor_ponto_aplicado, pontos_gerados, fase, processo,
                             processo_id, etapa_id, executor_id, executor_nome, executor_tipo)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PRODUCAO', $9,
                                 $10, $11, 'POS_OP', $12, $13, $14, $6, $7, $15)
                         RETURNING id`,
                        [
                            req.empresaId,
                            origem.op_numero,
                            produto_id,
                            varianteParaBanco(variante),
                            origem.quantidade,
                            freelance.id,
                            freelance.nome,
                            req.usuarioLogado.nome,
                            sessaoId,
                            valorPontoPosOp,
                            pontosOrigem,
                            processoRegistrado,
                            etapaRegistrada.processo_id || null,
                            etapaRegistrada.id || null,
                            freelance_tipo,
                        ],
                    );
                    await registrarOrigemProdutoPronto(dbClient, {
                        empresaId: req.empresaId,
                        produtoId: produto_id,
                        variante: varianteParaBanco(variante),
                        opNumero: origem.op_numero,
                        processo: processoRegistrado,
                        processoId: etapaRegistrada.processo_id,
                        etapaId: etapaRegistrada.id,
                        sessaoProducaoId: sessaoId,
                        arremateIdLegado: arremateResult.rows[0].id,
                        quantidade: origem.quantidade,
                        valorPontoAplicado: valorPontoPosOp,
                        pontosGerados: pontosOrigem,
                        executorId: freelance.id,
                        executorNome: freelance.nome,
                        executorTipo: freelance_tipo,
                    });
                }
                continue;
            }

            const produtoRes = await dbClient.query(
                'SELECT etapas FROM produtos WHERE id = $1 AND empresa_id = $2',
                [produto_id, req.empresaId]
            );
            const etapasDoProduto = produtoRes.rows[0]?.etapas || [];
            const etapaIndex = etapasDoProduto.findIndex(e => (e.processo || e) === processo);
            const etapaConfig = etapasDoProduto[etapaIndex];
            const maquina = (etapaConfig && typeof etapaConfig === 'object') ? (etapaConfig.maquina || 'Não Definida') : 'Não Definida';

            await dbClient.query(`
                INSERT INTO sessoes_trabalho_producao
                    (funcionario_id, op_numero, produto_id, variante, processo,
                     quantidade_atribuida, quantidade_finalizada, status,
                     data_inicio, data_fim, empresa_id)
                VALUES ($1, $2, $3, $4, $5, $6, $6, 'FINALIZADA', NOW(), NOW(), $7)
            `, [
                freelance.id,
                op_numero,
                produto_id,
                variante || null,
                processo,
                parseInt(quantidade),
                req.empresaId,
            ]);

            const etapasParaRegistrar = Array.isArray(etapas_unificadas) && etapas_unificadas.length >= 2
                ? etapas_unificadas
                : [{ etapa_index: etapaIndex, processo, maquina }];

            // Distribuição waterfall — mesmo algoritmo do PUT /finalizar.
            // Busca todas as OPs ativas do produto/variante e distribui em FIFO,
            // respeitando o saldo de cada etapa. Corrige o bug onde tudo ia para
            // op_numero[0] sem olhar as demais OPs do grupo.
            const opsDisponiveisResult = await dbClient.query(`
                SELECT numero, etapas, quantidade
                FROM ordens_de_producao
                WHERE empresa_id = $3
                  AND produto_id = $1
                  AND (variante = $2 OR ($2 IS NULL AND variante IS NULL))
                  AND status IN ('em-aberto', 'produzindo')
                ORDER BY numero ASC
            `, [produto_id, variante || null, req.empresaId]);
            const opsCandidatas = opsDisponiveisResult.rows;

            // Fallback: se não há OPs ativas, usa a OP original (mesmo que fechada)
            let opOriginalFallback = null;
            if (opsCandidatas.length === 0) {
                const opOrigRes = await dbClient.query(
                    'SELECT numero, etapas FROM ordens_de_producao WHERE numero = $1 AND empresa_id = $2',
                    [op_numero, req.empresaId]
                );
                if (opOrigRes.rows.length > 0) opOriginalFallback = opOrigRes.rows[0];
            }

            // Mapa de saldos já lançados (op_numero-etapa_index → total)
            const numerosOps = opsCandidatas.map(op => op.numero);
            const mapaSaldo = new Map();
            if (numerosOps.length > 0) {
                const lancamentosAnt = await dbClient.query(`
                    SELECT op_numero, etapa_index, SUM(quantidade) as total
                    FROM producoes
                    WHERE empresa_id = $2
                      AND op_numero = ANY($1::text[])
                    GROUP BY op_numero, etapa_index
                `, [numerosOps, req.empresaId]);
                lancamentosAnt.rows.forEach(r =>
                    mapaSaldo.set(`${r.op_numero}-${r.etapa_index}`, parseInt(r.total))
                );
            }

            for (const etapaUnif of etapasParaRegistrar) {
                const idxUnif = typeof etapaUnif.etapa_index === 'number' ? etapaUnif.etapa_index : etapaIndex;
                const maquinaUnif = etapaUnif.maquina || maquina;
                const processoUnif = etapaUnif.processo || processo;

                let quantidadeRestante = parseInt(quantidade);

                // Loop de distribuição por OP (FIFO)
                for (const op of opsCandidatas) {
                    if (quantidadeRestante <= 0) break;

                    const etapaIdxNaOp = op.etapas.findIndex(e => (e.processo || e) === processoUnif);
                    if (etapaIdxNaOp === -1) continue;

                    const entrada = etapaIdxNaOp === 0
                        ? parseInt(op.quantidade)
                        : (mapaSaldo.get(`${op.numero}-${etapaIdxNaOp - 1}`) || 0);
                    const saida = mapaSaldo.get(`${op.numero}-${etapaIdxNaOp}`) || 0;
                    const disponivel = Math.max(0, entrada - saida);

                    if (disponivel > 0) {
                        const qtdLancar = Math.min(quantidadeRestante, disponivel);
                        const { pontosGerados, valorPontoAplicado } = await calcularPontosProducao(
                            dbClient, produto_id, processoUnif, qtdLancar,
                            freelance.id, req.empresaId
                        );
                        await dbClient.query(
                            `INSERT INTO producoes (id, op_numero, etapa_index, processo, produto_id, variacao, maquina, quantidade, funcionario, funcionario_id, data, lancado_por, valor_ponto_aplicado, pontos_gerados, empresa_id)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13, $14)`,
                            [
                                `prod_ext_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 4)}`,
                                op.numero, etapaIdxNaOp, processoUnif, produto_id, variante || '-', maquinaUnif,
                                qtdLancar, freelance.nome, freelance.id,
                                req.usuarioLogado.nome, valorPontoAplicado, pontosGerados, req.empresaId,
                            ]
                        );
                        quantidadeRestante -= qtdLancar;
                        mapaSaldo.set(`${op.numero}-${etapaIdxNaOp}`, saida + qtdLancar);
                    }
                }

                // Estouro: peças além do saldo disponível vão para a OP de referência
                if (quantidadeRestante > 0) {
                    const opAlvo = opsCandidatas.find(o => o.numero === op_numero) || opsCandidatas[0] || opOriginalFallback;
                    if (opAlvo) {
                        const idx = opAlvo.etapas.findIndex(e => (e.processo || e) === processoUnif);
                        const { pontosGerados, valorPontoAplicado } = await calcularPontosProducao(
                            dbClient, produto_id, processoUnif, quantidadeRestante,
                            freelance.id, req.empresaId
                        );
                        await dbClient.query(
                            `INSERT INTO producoes (id, op_numero, etapa_index, processo, produto_id, variacao, maquina, quantidade, funcionario, funcionario_id, data, lancado_por, valor_ponto_aplicado, pontos_gerados, empresa_id)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13, $14)`,
                            [
                                `prod_ext_force_${Date.now()}_${i}`,
                                opAlvo.numero, idx, processoUnif, produto_id, variante || '-', maquinaUnif,
                                quantidadeRestante, freelance.nome, freelance.id,
                                req.usuarioLogado.nome, valorPontoAplicado, pontosGerados, req.empresaId,
                            ]
                        );
                    } else {
                        throw new Error('Nenhuma OP válida encontrada para lançar a produção externa.');
                    }
                }
            }
        }

        await dbClient.query('COMMIT');
        for (const item of itens) {
            await registrarAuditoria(dbClient, req.usuarioLogado, 'tarefa_freelance.atribuida', 'tarefa', item.op_numero, {
                op_numero: item.op_numero,
                funcionario_nome: freelance.nome,
                tipo: freelance_tipo,
                etapa: item.processo,
                quantidade: item.quantidade,
            });
        }
        res.status(201).json({ ok: true });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API POST /producoes/externo] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
