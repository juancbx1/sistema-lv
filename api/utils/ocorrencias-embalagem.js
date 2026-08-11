import { getPermissoesCompletasUsuarioDB } from '../usuarios.js';
import {
    listarOrigensProdutoProntoDisponiveis,
    obterEstruturaOrigensProdutoPronto,
} from './origens-produto-pronto.js';

export const MOTIVOS_OCORRENCIA_EMBALAGEM = Object.freeze({
    QUANTIDADE_DIVERGENTE: 'QUANTIDADE_DIVERGENTE',
    LANCAMENTO_ERRADO: 'LANCAMENTO_ERRADO',
    PRODUTO_AVARIADO: 'PRODUTO_AVARIADO',
    ENVIAR_CONSERTO: 'ENVIAR_CONSERTO',
});

const MOTIVOS_FINAIS = new Set([
    MOTIVOS_OCORRENCIA_EMBALAGEM.QUANTIDADE_DIVERGENTE,
    MOTIVOS_OCORRENCIA_EMBALAGEM.LANCAMENTO_ERRADO,
    MOTIVOS_OCORRENCIA_EMBALAGEM.PRODUTO_AVARIADO,
]);

const EVENTOS_OCORRENCIA_EMBALAGEM = Object.freeze({
    PERDA_EMBALAGEM: 'PERDA_EMBALAGEM',
    ENVIO_CONSERTO: 'ENVIO_CONSERTO',
    RETORNO_CONSERTO: 'RETORNO_CONSERTO',
    PERDA_CONSERTO: 'PERDA_CONSERTO',
});

function erroApi(mensagem, statusCode = 400, extras = {}) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    Object.assign(erro, extras);
    return erro;
}

function normalizarVariante(valor) {
    const normalizada = String(valor ?? '').trim();
    return !normalizada || normalizada === '-' ? null : normalizada;
}

function normalizarMotivo(valor) {
    const motivo = String(valor ?? '').trim().toUpperCase();
    return Object.values(MOTIVOS_OCORRENCIA_EMBALAGEM).includes(motivo)
        ? motivo
        : null;
}

function nomeUsuario(usuarioLogado) {
    return usuarioLogado?.nome || usuarioLogado?.nome_usuario || 'Sistema';
}

function quantidadeInteiraPositiva(valor) {
    const numero = Number(valor);
    return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function quantidadeInteiraNaoNegativa(valor) {
    const numero = Number(valor);
    return Number.isInteger(numero) && numero >= 0 ? numero : null;
}

async function verificarEstruturaOcorrencias(dbClient) {
    const result = await dbClient.query(`
        SELECT
            to_regclass('public.ocorrencias_embalagem') IS NOT NULL AS ocorrencias,
            to_regclass('public.ocorrencias_embalagem_origens') IS NOT NULL AS origens,
            to_regclass('public.ocorrencias_embalagem_eventos') IS NOT NULL AS eventos
    `);
    const estrutura = result.rows[0] || {};
    if (!estrutura.ocorrencias || !estrutura.origens || !estrutura.eventos) {
        throw erroApi(
            'O controle de ocorrências da Embalagem ainda não foi preparado no banco.',
            503,
            { codigo: 'OCORRENCIAS_EMBALAGEM_NAO_PREPARADAS' },
        );
    }
    return estrutura;
}

async function verificarPermissaoOcorrencia(dbClient, usuarioLogado, empresaId) {
    const permissoes = await getPermissoesCompletasUsuarioDB(
        dbClient,
        usuarioLogado.id,
        empresaId,
    );
    if (!permissoes.includes('lancar-embalagem')
        && !permissoes.includes('registrar-ocorrencia-embalagem')) {
        throw erroApi('Permissão negada para registrar ocorrências na Embalagem.', 403);
    }
}

export async function verificarAcessoOcorrenciasEmbalagem(dbClient, usuarioLogado, empresaId) {
    const permissoes = await getPermissoesCompletasUsuarioDB(
        dbClient,
        usuarioLogado.id,
        empresaId,
    );
    if (!permissoes.includes('acesso-embalagem-de-produtos')
        && !permissoes.includes('lancar-embalagem')
        && !permissoes.includes('registrar-ocorrencia-embalagem')) {
        const erro = new Error('PermissÃ£o negada para consultar ocorrÃªncias da Embalagem.');
        erro.statusCode = 403;
        throw erro;
    }
}

function chaveProduto(empresaId, produtoId, variante) {
    return `ocorrencia-embalagem:${empresaId}:${produtoId}:${variante || '-'}`;
}

function quantidadeDisponivel(origem) {
    return Math.max(
        0,
        Number(origem.quantidade_disponibilizada || 0)
            - Number(origem.quantidade_consumida || 0),
    );
}

async function travarProdutoEListarOrigens(dbClient, { empresaId, produtoId, variante }) {
    await dbClient.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [chaveProduto(empresaId, produtoId, variante)],
    );
    const resultado = await listarOrigensProdutoProntoDisponiveis(dbClient, {
        empresaId,
        produtoId,
        variante,
        bloquear: true,
    });
    return resultado.rows.filter((origem) => quantidadeDisponivel(origem) > 0);
}

async function consumirOrigem(dbClient, { empresaId, origem, quantidade }) {
    if (origem.origem_tipo === 'PRODUTO_PRONTO') {
        const atualizada = await dbClient.query(`
            UPDATE origens_produto_pronto
               SET quantidade_consumida = quantidade_consumida + $1
             WHERE id = $2
               AND empresa_id = $3
               AND quantidade_consumida + $1 <= quantidade_disponibilizada
            RETURNING arremate_id_legado
        `, [quantidade, origem.origem_id, empresaId]);
        if (atualizada.rowCount !== 1) {
            throw erroApi('O saldo pronto para embalagem mudou. Atualize a fila.', 409);
        }

        const arremateCompatId = atualizada.rows[0]?.arremate_id_legado;
        if (arremateCompatId) {
            const projecao = await dbClient.query(`
                UPDATE arremates
                   SET quantidade_ja_embalada = quantidade_ja_embalada + $1
                 WHERE id = $2
                   AND empresa_id = $3
                   AND quantidade_ja_embalada + $1 <= quantidade_arrematada
            `, [quantidade, arremateCompatId, empresaId]);
            if (projecao.rowCount !== 1) {
                throw erroApi('A projeção legada do saldo de embalagem ficou inconsistente.', 409);
            }
        }

        return {
            origem_produto_pronto_id: Number(origem.origem_id),
            arremate_legado_id: null,
            op_numero: String(origem.op_numero),
            quantidade,
        };
    }

    const atualizada = await dbClient.query(`
        UPDATE arremates
           SET quantidade_ja_embalada = quantidade_ja_embalada + $1
         WHERE id = $2
           AND empresa_id = $3
           AND tipo_lancamento = 'PRODUCAO'
           AND quantidade_ja_embalada + $1 <= quantidade_arrematada
    `, [quantidade, origem.origem_id, empresaId]);
    if (atualizada.rowCount !== 1) {
        throw erroApi('O saldo legado pronto para embalagem mudou. Atualize a fila.', 409);
    }

    return {
        origem_produto_pronto_id: null,
        arremate_legado_id: Number(origem.origem_id),
        op_numero: String(origem.op_numero),
        quantidade,
    };
}

async function devolverOrigem(dbClient, { empresaId, alocacao, quantidade }) {
    if (alocacao.origem_produto_pronto_id) {
        const origem = await dbClient.query(`
            UPDATE origens_produto_pronto
               SET quantidade_consumida = quantidade_consumida - $1
             WHERE id = $2
               AND empresa_id = $3
               AND quantidade_consumida >= $1
            RETURNING arremate_id_legado
        `, [quantidade, alocacao.origem_produto_pronto_id, empresaId]);
        if (origem.rowCount !== 1) {
            throw erroApi('Não foi possível devolver a unidade à origem de produto pronto.', 409);
        }
        const arremateCompatId = origem.rows[0]?.arremate_id_legado;
        if (arremateCompatId) {
            const projecao = await dbClient.query(`
                UPDATE arremates
                   SET quantidade_ja_embalada = quantidade_ja_embalada - $1
                 WHERE id = $2
                   AND empresa_id = $3
                   AND quantidade_ja_embalada >= $1
            `, [quantidade, arremateCompatId, empresaId]);
            if (projecao.rowCount !== 1) {
                throw erroApi('Não foi possível devolver a projeção legada da origem.', 409);
            }
        }
        return;
    }

    const legado = await dbClient.query(`
        UPDATE arremates
           SET quantidade_ja_embalada = quantidade_ja_embalada - $1
         WHERE id = $2
           AND empresa_id = $3
           AND tipo_lancamento = 'PRODUCAO'
           AND quantidade_ja_embalada >= $1
    `, [quantidade, alocacao.arremate_legado_id, empresaId]);
    if (legado.rowCount !== 1) {
        throw erroApi('Não foi possível devolver a unidade ao lote legado.', 409);
    }
}

function distribuirQuantidade(origens, quantidadeNecessaria) {
    const alocacoes = [];
    let restante = quantidadeNecessaria;
    for (const origem of origens) {
        if (restante <= 0) break;
        const quantidade = Math.min(restante, quantidadeDisponivel(origem));
        if (quantidade <= 0) continue;
        alocacoes.push({ origem, quantidade });
        restante -= quantidade;
    }
    if (restante > 0) {
        throw erroApi(
            `O saldo pronto para embalagem é insuficiente. Disponível: ${quantidadeNecessaria - restante}.`,
            409,
        );
    }
    return alocacoes;
}

async function inserirEvento(dbClient, {
    empresaId,
    ocorrenciaId,
    tipoEvento,
    quantidade,
    statusDepois,
    observacao,
    usuarioLogado,
    detalhes = {},
}) {
    const resultado = await dbClient.query(`
        INSERT INTO ocorrencias_embalagem_eventos (
            empresa_id,
            ocorrencia_id,
            tipo_evento,
            quantidade,
            status_depois,
            observacao,
            usuario_id,
            usuario_nome,
            detalhes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        RETURNING id, criado_em
    `, [
        empresaId,
        ocorrenciaId,
        tipoEvento,
        quantidade,
        statusDepois,
        observacao || null,
        usuarioLogado.id || null,
        nomeUsuario(usuarioLogado),
        JSON.stringify(detalhes),
    ]);
    return resultado.rows[0];
}

async function carregarProduto(dbClient, { empresaId, produtoId }) {
    const resultado = await dbClient.query(`
        SELECT id, nome
          FROM produtos
         WHERE id = $1
           AND empresa_id = $2
        LIMIT 1
    `, [produtoId, empresaId]);
    if (resultado.rowCount === 0) {
        throw erroApi('Produto não encontrado na empresa ativa.', 404);
    }
    return resultado.rows[0];
}

export async function registrarOcorrenciaEmbalagem({
    dbClient,
    usuarioLogado,
    empresaId,
    payload = {},
    idempotencyKey,
}) {
    await verificarEstruturaOcorrencias(dbClient);
    await verificarPermissaoOcorrencia(dbClient, usuarioLogado, empresaId);

    const produtoId = Number(payload.produto_id);
    const variante = normalizarVariante(payload.variante);
    const motivo = normalizarMotivo(payload.motivo);
    const observacao = String(payload.observacao || '').trim();
    const chave = String(idempotencyKey || '').trim();

    if (!Number.isInteger(produtoId) || produtoId <= 0 || !motivo || !observacao || !chave) {
        throw erroApi('Produto, motivo, observação e Idempotency-Key são obrigatórios.');
    }
    if (chave.length > 200) {
        throw erroApi('Idempotency-Key excede o limite de 200 caracteres.');
    }

    const quantidadeInformada = quantidadeInteiraPositiva(payload.quantidade);
    const quantidadeFisica = quantidadeInteiraNaoNegativa(payload.quantidade_fisica);
    if (MOTIVOS_FINAIS.has(motivo) && !quantidadeInformada) {
        throw erroApi('Informe uma quantidade inteira positiva para a ocorrência.');
    }
    if (motivo === MOTIVOS_OCORRENCIA_EMBALAGEM.ENVIAR_CONSERTO && !quantidadeInformada) {
        throw erroApi('Informe a quantidade enviada para conserto.');
    }
    if (motivo === MOTIVOS_OCORRENCIA_EMBALAGEM.QUANTIDADE_DIVERGENTE
        && quantidadeFisica === null) {
        throw erroApi('Informe a quantidade física conferida para calcular a divergência.');
    }

    const produto = await carregarProduto(dbClient, { empresaId, produtoId });
    let transacaoAberta = false;
    try {
        await dbClient.query('BEGIN');
        transacaoAberta = true;

        const repeticao = await dbClient.query(`
            SELECT id, status, quantidade_total
              FROM ocorrencias_embalagem
             WHERE empresa_id = $1
               AND idempotency_key = $2
             FOR UPDATE
        `, [empresaId, chave]);
        if (repeticao.rowCount > 0) {
            await dbClient.query('COMMIT');
            transacaoAberta = false;
            return {
                id: repeticao.rows[0].id,
                status: repeticao.rows[0].status,
                quantidade: Number(repeticao.rows[0].quantidade_total),
                idempotente: true,
            };
        }

        const origens = await travarProdutoEListarOrigens(dbClient, {
            empresaId,
            produtoId,
            variante,
        });
        const saldoDisponivel = origens.reduce(
            (total, origem) => total + quantidadeDisponivel(origem),
            0,
        );

        const quantidade = motivo === MOTIVOS_OCORRENCIA_EMBALAGEM.QUANTIDADE_DIVERGENTE
            ? saldoDisponivel - quantidadeFisica
            : quantidadeInformada;
        if (!Number.isInteger(quantidade) || quantidade <= 0) {
            throw erroApi('A quantidade da ocorrência precisa ser maior que zero.');
        }
        if (quantidade > saldoDisponivel) {
            throw erroApi(
                `A quantidade solicitada (${quantidade}) supera o saldo pronto disponível (${saldoDisponivel}).`,
                409,
            );
        }

        const distribuicao = distribuirQuantidade(origens, quantidade);
        const eConserto = motivo === MOTIVOS_OCORRENCIA_EMBALAGEM.ENVIAR_CONSERTO;
        const status = eConserto ? 'EM_CONSERTO' : 'FINALIZADA';
        const inserido = await dbClient.query(`
            INSERT INTO ocorrencias_embalagem (
                empresa_id,
                produto_id,
                variante,
                motivo,
                quantidade_total,
                quantidade_em_conserto,
                quantidade_baixada,
                quantidade_retornada,
                status,
                observacao,
                usuario_responsavel_id,
                usuario_responsavel_nome,
                idempotency_key,
                concluido_em
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12, $13)
            RETURNING id
        `, [
            empresaId,
            produtoId,
            variante,
            motivo,
            quantidade,
            eConserto ? quantidade : 0,
            eConserto ? 0 : quantidade,
            status,
            observacao,
            usuarioLogado.id || null,
            nomeUsuario(usuarioLogado),
            chave,
            eConserto ? null : new Date(),
        ]);
        const ocorrenciaId = inserido.rows[0].id;

        const origensAuditadas = [];
        for (const item of distribuicao) {
            const alocacao = await consumirOrigem(dbClient, {
                empresaId,
                origem: item.origem,
                quantidade: item.quantidade,
            });
            origensAuditadas.push(alocacao);
            await dbClient.query(`
                INSERT INTO ocorrencias_embalagem_origens (
                    empresa_id,
                    ocorrencia_id,
                    origem_produto_pronto_id,
                    arremate_legado_id,
                    quantidade_afetada,
                    quantidade_retornada,
                    quantidade_baixada
                )
                VALUES ($1, $2, $3, $4, $5, 0, $6)
            `, [
                empresaId,
                ocorrenciaId,
                alocacao.origem_produto_pronto_id,
                alocacao.arremate_legado_id,
                alocacao.quantidade,
                eConserto ? 0 : alocacao.quantidade,
            ]);
        }

        const evento = await inserirEvento(dbClient, {
            empresaId,
            ocorrenciaId,
            tipoEvento: eConserto
                ? EVENTOS_OCORRENCIA_EMBALAGEM.ENVIO_CONSERTO
                : EVENTOS_OCORRENCIA_EMBALAGEM.PERDA_EMBALAGEM,
            quantidade,
            statusDepois: status,
            observacao,
            usuarioLogado,
            detalhes: {
                produto_nome: produto.nome,
                quantidade_fisica: quantidadeFisica,
                saldo_digital: saldoDisponivel,
                origens: origensAuditadas,
            },
        });

        await dbClient.query('COMMIT');
        transacaoAberta = false;
        return {
            id: ocorrenciaId,
            evento_id: evento.id,
            produto_id: produtoId,
            variante,
            motivo,
            quantidade,
            status,
            message: eConserto
                ? 'Produto enviado para conserto.'
                : 'Ocorrência registrada e saldo da Embalagem atualizado.',
        };
    } catch (error) {
        if (transacaoAberta) await dbClient.query('ROLLBACK');
        throw error;
    }
}

function statusConsertoFinal(quantidadeEmConserto) {
    return quantidadeEmConserto > 0 ? 'EM_CONSERTO' : 'CONCLUIDA';
}

async function carregarOcorrenciaConserto(dbClient, { empresaId, ocorrenciaId }) {
    const result = await dbClient.query(`
        SELECT *
          FROM ocorrencias_embalagem
         WHERE id = $1
           AND empresa_id = $2
         FOR UPDATE
    `, [ocorrenciaId, empresaId]);
    if (result.rowCount === 0) throw erroApi('Ocorrência de conserto não encontrada.', 404);
    const ocorrencia = result.rows[0];
    if (ocorrencia.motivo !== MOTIVOS_OCORRENCIA_EMBALAGEM.ENVIAR_CONSERTO
        || ocorrencia.status !== 'EM_CONSERTO') {
        throw erroApi('Esta ocorrência não possui unidades pendentes de conserto.', 409);
    }
    return ocorrencia;
}

async function carregarAlocacoesConserto(dbClient, { empresaId, ocorrenciaId }) {
    const estruturaOrigens = await obterEstruturaOrigensProdutoPronto(dbClient);
    const selecaoOp = estruturaOrigens.origens
        ? 'COALESCE(opp.op_numero, ar.op_numero)'
        : 'ar.op_numero';
    const joinOrigemCanonica = estruturaOrigens.origens
        ? `
          LEFT JOIN origens_produto_pronto opp
            ON opp.empresa_id = eo.empresa_id
           AND opp.id = eo.origem_produto_pronto_id`
        : '';
    const result = await dbClient.query(`
        SELECT eo.*,
               ${selecaoOp} AS op_numero
          FROM ocorrencias_embalagem_origens eo
          ${joinOrigemCanonica}
          LEFT JOIN arremates ar
            ON ar.empresa_id = eo.empresa_id
           AND ar.id = eo.arremate_legado_id
         WHERE eo.empresa_id = $1
           AND eo.ocorrencia_id = $2
           AND eo.quantidade_retornada + eo.quantidade_baixada < eo.quantidade_afetada
         ORDER BY eo.id
         FOR UPDATE OF eo
    `, [empresaId, ocorrenciaId]);
    return result.rows;
}

export async function retornarConsertoEmbalagem({
    dbClient,
    usuarioLogado,
    empresaId,
    ocorrenciaId,
    payload = {},
}) {
    await verificarEstruturaOcorrencias(dbClient);
    await verificarPermissaoOcorrencia(dbClient, usuarioLogado, empresaId);
    const quantidadeSolicitada = quantidadeInteiraPositiva(payload.quantidade);
    const observacao = String(payload.observacao || '').trim();
    if (!quantidadeSolicitada) throw erroApi('Informe uma quantidade inteira positiva para o retorno.');

    let transacaoAberta = false;
    try {
        await dbClient.query('BEGIN');
        transacaoAberta = true;
        const ocorrencia = await carregarOcorrenciaConserto(dbClient, { empresaId, ocorrenciaId });
        if (quantidadeSolicitada > Number(ocorrencia.quantidade_em_conserto)) {
            throw erroApi('A quantidade de retorno supera o saldo pendente de conserto.', 409);
        }
        await dbClient.query(
            'SELECT pg_advisory_xact_lock(hashtext($1))',
            [chaveProduto(empresaId, ocorrencia.produto_id, ocorrencia.variante)],
        );
        const alocacoes = await carregarAlocacoesConserto(dbClient, { empresaId, ocorrenciaId });
        let restante = quantidadeSolicitada;
        const origensRetornadas = [];
        for (const alocacao of alocacoes) {
            if (restante <= 0) break;
            const disponivel = Number(alocacao.quantidade_afetada)
                - Number(alocacao.quantidade_retornada)
                - Number(alocacao.quantidade_baixada);
            const quantidade = Math.min(restante, disponivel);
            if (quantidade <= 0) continue;
            await devolverOrigem(dbClient, {
                empresaId,
                alocacao,
                quantidade,
            });
            await dbClient.query(`
                UPDATE ocorrencias_embalagem_origens
                   SET quantidade_retornada = quantidade_retornada + $1
                 WHERE id = $2
                   AND empresa_id = $3
            `, [quantidade, alocacao.id, empresaId]);
            origensRetornadas.push({
                op_numero: alocacao.op_numero,
                quantidade,
            });
            restante -= quantidade;
        }
        if (restante > 0) throw erroApi('Não foi possível devolver toda a quantidade solicitada.', 409);

        const quantidadePendente = Number(ocorrencia.quantidade_em_conserto) - quantidadeSolicitada;
        const status = statusConsertoFinal(quantidadePendente);
        await dbClient.query(`
            UPDATE ocorrencias_embalagem
               SET quantidade_em_conserto = $1,
                   quantidade_retornada = quantidade_retornada + $2,
                   status = $3,
                   atualizado_em = NOW(),
                   concluido_em = CASE WHEN $1 = 0 THEN NOW() ELSE concluido_em END
             WHERE id = $4
               AND empresa_id = $5
        `, [quantidadePendente, quantidadeSolicitada, status, ocorrenciaId, empresaId]);

        const evento = await inserirEvento(dbClient, {
            empresaId,
            ocorrenciaId,
            tipoEvento: EVENTOS_OCORRENCIA_EMBALAGEM.RETORNO_CONSERTO,
            quantidade: quantidadeSolicitada,
            statusDepois: status,
            observacao,
            usuarioLogado,
            detalhes: { origens: origensRetornadas },
        });

        await dbClient.query('COMMIT');
        transacaoAberta = false;
        return {
            id: ocorrenciaId,
            evento_id: evento.id,
            quantidade_retornada: quantidadeSolicitada,
            quantidade_em_conserto: quantidadePendente,
            status,
            message: 'Produto devolvido à fila de Embalagem.',
        };
    } catch (error) {
        if (transacaoAberta) await dbClient.query('ROLLBACK');
        throw error;
    }
}

export async function converterConsertoEmAvaria({
    dbClient,
    usuarioLogado,
    empresaId,
    ocorrenciaId,
    payload = {},
}) {
    await verificarEstruturaOcorrencias(dbClient);
    await verificarPermissaoOcorrencia(dbClient, usuarioLogado, empresaId);
    const observacao = String(payload.observacao || '').trim();
    const quantidadeSolicitada = payload.quantidade === undefined
        ? null
        : quantidadeInteiraPositiva(payload.quantidade);
    if (payload.quantidade !== undefined && !quantidadeSolicitada) {
        throw erroApi('Informe uma quantidade inteira positiva para converter em avaria.');
    }

    let transacaoAberta = false;
    try {
        await dbClient.query('BEGIN');
        transacaoAberta = true;
        const ocorrencia = await carregarOcorrenciaConserto(dbClient, { empresaId, ocorrenciaId });
        const quantidade = quantidadeSolicitada || Number(ocorrencia.quantidade_em_conserto);
        if (quantidade > Number(ocorrencia.quantidade_em_conserto)) {
            throw erroApi('A quantidade supera o saldo pendente de conserto.', 409);
        }
        const alocacoes = await carregarAlocacoesConserto(dbClient, { empresaId, ocorrenciaId });
        let restante = quantidade;
        for (const alocacao of alocacoes) {
            if (restante <= 0) break;
            const disponivel = Number(alocacao.quantidade_afetada)
                - Number(alocacao.quantidade_retornada)
                - Number(alocacao.quantidade_baixada);
            const quantidadeDaOrigem = Math.min(restante, disponivel);
            if (quantidadeDaOrigem <= 0) continue;
            await dbClient.query(`
                UPDATE ocorrencias_embalagem_origens
                   SET quantidade_baixada = quantidade_baixada + $1
                 WHERE id = $2
                   AND empresa_id = $3
            `, [quantidadeDaOrigem, alocacao.id, empresaId]);
            restante -= quantidadeDaOrigem;
        }
        if (restante > 0) throw erroApi('Não foi possível converter toda a quantidade em avaria.', 409);

        const quantidadePendente = Number(ocorrencia.quantidade_em_conserto) - quantidade;
        const status = statusConsertoFinal(quantidadePendente);
        await dbClient.query(`
            UPDATE ocorrencias_embalagem
               SET quantidade_em_conserto = $1,
                   quantidade_baixada = quantidade_baixada + $2,
                   status = $3,
                   atualizado_em = NOW(),
                   concluido_em = CASE WHEN $1 = 0 THEN NOW() ELSE concluido_em END
             WHERE id = $4
               AND empresa_id = $5
        `, [quantidadePendente, quantidade, status, ocorrenciaId, empresaId]);

        const evento = await inserirEvento(dbClient, {
            empresaId,
            ocorrenciaId,
            tipoEvento: EVENTOS_OCORRENCIA_EMBALAGEM.PERDA_CONSERTO,
            quantidade,
            statusDepois: status,
            observacao,
            usuarioLogado,
            detalhes: { motivo_final: MOTIVOS_OCORRENCIA_EMBALAGEM.PRODUTO_AVARIADO },
        });

        await dbClient.query('COMMIT');
        transacaoAberta = false;
        return {
            id: ocorrenciaId,
            evento_id: evento.id,
            quantidade_baixada: quantidade,
            quantidade_em_conserto: quantidadePendente,
            status,
            message: 'Conserto encerrado como produto avariado.',
        };
    } catch (error) {
        if (transacaoAberta) await dbClient.query('ROLLBACK');
        throw error;
    }
}

export async function listarOcorrenciasConserto({ dbClient, empresaId }) {
    await verificarEstruturaOcorrencias(dbClient);
    const estruturaOrigens = await obterEstruturaOrigensProdutoPronto(dbClient);
    const selecaoOp = estruturaOrigens.origens
        ? 'COALESCE(opp.op_numero, ar.op_numero)'
        : 'ar.op_numero';
    const joinOrigemCanonica = estruturaOrigens.origens
        ? `
                  LEFT JOIN origens_produto_pronto opp
                    ON opp.empresa_id = eo.empresa_id
                   AND opp.id = eo.origem_produto_pronto_id`
        : '';
    const result = await dbClient.query(`
        SELECT
            o.id,
            o.produto_id,
            p.nome AS produto_nome,
            p.imagem AS produto_imagem,
            o.variante,
            o.motivo,
            o.quantidade_total,
            o.quantidade_em_conserto,
            o.quantidade_retornada,
            o.quantidade_baixada,
            o.status,
            o.observacao,
            o.usuario_responsavel_nome,
            o.criado_em,
            o.atualizado_em,
            (
                SELECT string_agg(DISTINCT ${selecaoOp}, ', ' ORDER BY ${selecaoOp})
                  FROM ocorrencias_embalagem_origens eo
                  ${joinOrigemCanonica}
                  LEFT JOIN arremates ar
                    ON ar.empresa_id = eo.empresa_id
                   AND ar.id = eo.arremate_legado_id
                 WHERE eo.empresa_id = o.empresa_id
                   AND eo.ocorrencia_id = o.id
            ) AS ops_canonicas
          FROM ocorrencias_embalagem o
          JOIN produtos p
            ON p.empresa_id = o.empresa_id
           AND p.id = o.produto_id
         WHERE o.empresa_id = $1
           AND o.status = 'EM_CONSERTO'
         ORDER BY o.criado_em ASC, o.id ASC
         LIMIT 200
    `, [empresaId]);

    return result.rows.map((row) => ({
        ...row,
        variante: row.variante || '-',
        op_numero: row.ops_canonicas || null,
        quantidade_total: Number(row.quantidade_total) || 0,
        quantidade_em_conserto: Number(row.quantidade_em_conserto) || 0,
        quantidade_retornada: Number(row.quantidade_retornada) || 0,
        quantidade_baixada: Number(row.quantidade_baixada) || 0,
    }));
}

export const tiposEventoOcorrenciaEmbalagem = EVENTOS_OCORRENCIA_EMBALAGEM;
