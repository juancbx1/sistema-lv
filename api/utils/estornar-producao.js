import { getPermissoesCompletasUsuarioDB } from '../usuarios.js';
import { registrarAuditoria } from '../audit.js';

function erroApi(mensagem, statusCode = 400) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

async function estruturaPosOpDisponivel(dbClient) {
    const result = await dbClient.query(`
        SELECT 1
          FROM sistema_migrations
         WHERE id = 'pos-op-sessoes-producao-v1'
         LIMIT 1
    `);
    return result.rowCount > 0;
}

/**
 * Estorna um lançamento de produção preservando o registro de auditoria.
 *
 * A operação é compartilhada pela rota canônica de Produções e pelo alias
 * legado de Arremates. O cliente recebido deve permanecer conectado até o
 * retorno para que a auditoria use o mesmo contexto empresarial.
 */
export async function estornarProducao({ dbClient, usuarioLogado, empresaId, idArremate }) {
    if (!idArremate) {
        throw erroApi('O ID do lançamento a ser estornado é obrigatório.');
    }

    const permissoes = await getPermissoesCompletasUsuarioDB(
        dbClient,
        usuarioLogado.id,
        empresaId,
    );
    if (!permissoes.includes('estornar-arremate')) {
        throw erroApi('Permissão negada para estornar lançamentos.', 403);
    }

    let transacaoIniciada = false;
    try {
        await dbClient.query('BEGIN');
        transacaoIniciada = true;

        const posOpAtivo = await estruturaPosOpDisponivel(dbClient);
        const arremateResult = await dbClient.query(
            `SELECT *
               FROM arremates
              WHERE id = $1
                AND empresa_id = $2`,
            [idArremate, empresaId],
        );
        if (arremateResult.rows.length === 0) {
            throw erroApi('Lançamento de produção não encontrado.', 404);
        }
        const arremateOriginal = arremateResult.rows[0];

        const logEstornoQuery = `
            INSERT INTO arremates
                (empresa_id, op_numero, op_edit_id, produto_id, variante, quantidade_arrematada,
                 usuario_tiktik, usuario_tiktik_id, lancado_por, tipo_lancamento, assinada, id_perda_origem)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ESTORNO', true, $10)
            RETURNING id
        `;
        const estornoInseridoResult = await dbClient.query(logEstornoQuery, [
            empresaId,
            arremateOriginal.op_numero,
            arremateOriginal.op_edit_id,
            arremateOriginal.produto_id,
            arremateOriginal.variante,
            arremateOriginal.quantidade_arrematada,
            arremateOriginal.usuario_tiktik,
            arremateOriginal.usuario_tiktik_id,
            usuarioLogado.nome || 'Sistema',
            null,
        ]);

        if (posOpAtivo) {
            await dbClient.query(
                `UPDATE arremates
                    SET fase = 'POS_OP',
                        processo = $1,
                        processo_id = $2,
                        etapa_id = $3,
                        executor_id = $4,
                        executor_nome = $5,
                        executor_tipo = $6
                  WHERE id = $7
                    AND empresa_id = $8`,
                [
                    arremateOriginal.processo || 'Arrematar',
                    arremateOriginal.processo_id || null,
                    arremateOriginal.etapa_id || null,
                    arremateOriginal.executor_id || arremateOriginal.usuario_tiktik_id || null,
                    arremateOriginal.executor_nome || arremateOriginal.usuario_tiktik || null,
                    arremateOriginal.executor_tipo || 'nao_informado',
                    estornoInseridoResult.rows[0].id,
                    empresaId,
                ],
            );
        }

        const deleteResult = await dbClient.query(
            `DELETE FROM arremates WHERE id = $1 AND empresa_id = $2`,
            [idArremate, empresaId],
        );
        if (deleteResult.rowCount === 0) {
            throw new Error('Falha ao apagar o registro de produção original.');
        }

        await dbClient.query('COMMIT');
        transacaoIniciada = false;
        await registrarAuditoria(dbClient, usuarioLogado, 'arremate.estornado', 'arremate', idArremate, {
            id: idArremate,
            op_numero: arremateOriginal.op_numero,
        });

        return { message: 'Lançamento de produção estornado com sucesso!' };
    } catch (erro) {
        if (transacaoIniciada) await dbClient.query('ROLLBACK');
        throw erro;
    }
}
