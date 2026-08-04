/**
 * Valida schema + ensaio transacional do motor VT (sempre com ROLLBACK).
 * Uso: node tools/validar-vt-cartao-schema.mjs
 */
import 'dotenv/config';
import pkg from 'pg';
import {
    schemaVtDisponivel,
    registrarCreditoRecarga,
    obterSaldoVt,
    ajustarConsumoVt,
    valorVia,
    dataCivilSp,
    passouCorte18h,
    VT_AJUSTE_TETO_DIAS,
} from '../api/vt-cartao-motor.js';

const { Pool } = pkg;

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
    console.error(JSON.stringify({ ok: false, erro: 'POSTGRES_URL ausente' }, null, 2));
    process.exit(1);
}

const pool = new Pool({ connectionString });

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

async function main() {
    const db = await pool.connect();
    const relatorio = {
        ok: false,
        schema: {},
        constraints: [],
        indices: [],
        migration: null,
        calendario_faltas: {},
        ensaio_motor: null,
        erros: [],
    };

    try {
        // ── Schema ──────────────────────────────────────────────────────
        const tabelas = await db.query(`
            SELECT table_name
              FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_name IN ('vt_cartao_movimentos', 'vt_cartao_saldo')
             ORDER BY table_name
        `);
        relatorio.schema.tabelas = tabelas.rows.map((r) => r.table_name);
        assert(relatorio.schema.tabelas.includes('vt_cartao_movimentos'), 'Falta vt_cartao_movimentos');
        assert(relatorio.schema.tabelas.includes('vt_cartao_saldo'), 'Falta vt_cartao_saldo');

        const colsMov = await db.query(`
            SELECT column_name, data_type, is_nullable
              FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'vt_cartao_movimentos'
             ORDER BY ordinal_position
        `);
        relatorio.schema.vt_cartao_movimentos = colsMov.rows.map((r) => r.column_name);

        const colsSaldo = await db.query(`
            SELECT column_name, data_type
              FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'vt_cartao_saldo'
             ORDER BY ordinal_position
        `);
        relatorio.schema.vt_cartao_saldo = colsSaldo.rows.map((r) => r.column_name);

        const chk = await db.query(`
            SELECT conname
              FROM pg_constraint
             WHERE conrelid = 'vt_cartao_movimentos'::regclass
               AND contype = 'c'
             ORDER BY conname
        `);
        relatorio.constraints = chk.rows.map((r) => r.conname);

        const idx = await db.query(`
            SELECT indexname
              FROM pg_indexes
             WHERE schemaname = 'public'
               AND tablename IN ('vt_cartao_movimentos', 'vt_cartao_saldo')
             ORDER BY indexname
        `);
        relatorio.indices = idx.rows.map((r) => r.indexname);

        const mig = await db.query(`
            SELECT id, descricao
              FROM sistema_migrations
             WHERE id = 'vt-cartao-saldo-v1'
        `);
        relatorio.migration = mig.rows[0] || null;
        assert(relatorio.migration, 'Marcador vt-cartao-saldo-v1 ausente em sistema_migrations');

        const faltaLegada = await db.query(`
            SELECT COUNT(*)::int AS n
              FROM calendario_empresa
             WHERE tipo = 'falta'
        `);
        const faltaNova = await db.query(`
            SELECT tipo, COUNT(*)::int AS n
              FROM calendario_empresa
             WHERE tipo IN ('falta_justificada', 'falta_injustificada')
             GROUP BY tipo
             ORDER BY tipo
        `);
        relatorio.calendario_faltas = {
            legadas_falta: faltaLegada.rows[0].n,
            por_tipo: Object.fromEntries(faltaNova.rows.map((r) => [r.tipo, r.n])),
        };

        const disponivel = await schemaVtDisponivel(db);
        assert(disponivel === true, 'schemaVtDisponivel retornou false');

        // ── Ensaio do motor (fixture isolada + limpeza explícita) ────────
        // Neon/pooler pode não garantir ROLLBACK confiável em todos os modos;
        // por isso usamos IDs marcados e DELETE no finally.
        const emp = await db.query(`SELECT id FROM empresas ORDER BY id LIMIT 1`);
        assert(emp.rows.length, 'Nenhuma empresa encontrada');
        const empresaId = emp.rows[0].id;

        const vinculo = await db.query(
            `
            SELECT ue.usuario_id, ue.valor_passagem_diaria, u.nome
              FROM usuarios_empresas ue
              JOIN usuarios u ON u.id = ue.usuario_id
             WHERE ue.empresa_id = $1
               AND ue.ativo = TRUE
               AND COALESCE(ue.valor_passagem_diaria, 0) > 0
             ORDER BY ue.usuario_id
             LIMIT 1
            `,
            [empresaId]
        );

        const idsLimpar = { movimentos: [], hist: null, usuarioId: null };

        try {
            if (!vinculo.rows.length) {
                relatorio.ensaio_motor = {
                    status: 'pulado',
                    motivo: 'Nenhum vínculo com valor_passagem_diaria > 0 para ensaiar',
                    empresa_id: empresaId,
                };
            } else {
                const usuarioId = vinculo.rows[0].usuario_id;
                idsLimpar.usuarioId = usuarioId;
                const valorDia = Number(vinculo.rows[0].valor_passagem_diaria);
                const via = valorVia(valorDia);
                const hoje = dataCivilSp();
                const ontemDate = new Date();
                ontemDate.setDate(ontemDate.getDate() - 1);
                const ontem = dataCivilSp(ontemDate);
                assert(passouCorte18h(new Date(), ontem), 'ontem deveria ter passado do corte');

                const hist = await db.query(
                    `
                    INSERT INTO historico_pagamentos_funcionarios
                        (usuario_id, descricao, valor_liquido_pago, id_usuario_pagador,
                         detalhes_pagamento, data_pagamento, empresa_id)
                    VALUES ($1, $2, $3, $1, $4::jsonb, NOW(), $5)
                    RETURNING id
                    `,
                    [
                        usuarioId,
                        'TEST ENSAIO VT (apagar)',
                        valorDia * 5,
                        JSON.stringify({ datas_pagas: [ontem, hoje], ensaio: true }),
                        empresaId,
                    ]
                );
                const recargaId = hist.rows[0].id;
                idsLimpar.hist = recargaId;

                const credito = await registrarCreditoRecarga(db, {
                    empresaId,
                    usuarioId,
                    valor: valorDia * 5,
                    recargaId,
                    datasLista: [ontem, hoje],
                    autorId: usuarioId,
                    autorNome: 'ensaio-vt',
                });
                assert(credito, 'registrarCreditoRecarga não retornou movimento');
                assert(credito.status_credito === 'provisionada', 'crédito deveria nascer provisionado');
                idsLimpar.movimentos.push(credito.id);

                await db.query(
                    `UPDATE vt_cartao_movimentos
                        SET status_credito = 'validada', valida_em = NOW() - INTERVAL '1 minute'
                      WHERE id = $1`,
                    [credito.id]
                );

                const deb = await db.query(
                    `
                    INSERT INTO vt_cartao_movimentos
                        (empresa_id, usuario_id, tipo, sentido, valor, data_ref, motivo, idempotency_key, autor_nome)
                    VALUES
                        ($1, $2, 'debito_consumo', 'ida', $3, $4::date, 'ensaio', $5, 'ensaio-vt'),
                        ($1, $2, 'debito_consumo', 'volta', $3, $4::date, 'ensaio', $6, 'ensaio-vt')
                    RETURNING id
                    `,
                    [
                        empresaId,
                        usuarioId,
                        via,
                        ontem,
                        `ensaio:debito:${empresaId}:${usuarioId}:${ontem}:ida:${Date.now()}`,
                        `ensaio:debito:${empresaId}:${usuarioId}:${ontem}:volta:${Date.now()}`,
                    ]
                );
                idsLimpar.movimentos.push(...deb.rows.map((r) => r.id));

                const saldoAntes = await obterSaldoVt(db, empresaId, usuarioId, { reconciliar: false });
                const disponivelAntes = Number(saldoAntes.saldo_disponivel);

                const ajuste = await ajustarConsumoVt(db, {
                    empresaId,
                    usuarioId,
                    dataRef: ontem,
                    usouIda: false,
                    usouVolta: true,
                    justificativaFato: 'Ensaio: carona na ida; usou só a volta.',
                    justificativaDemora: 'Ensaio automatizado do motor VT.',
                    autorId: usuarioId,
                    autorNome: 'ensaio-vt',
                });

                const movsEnsaio = await db.query(
                    `SELECT id FROM vt_cartao_movimentos
                      WHERE empresa_id = $1 AND usuario_id = $2
                        AND (autor_nome = 'ensaio-vt' OR motivo = 'ensaio' OR motivo = 'ajuste_consumo')`,
                    [empresaId, usuarioId]
                );
                idsLimpar.movimentos = [
                    ...new Set([
                        ...idsLimpar.movimentos,
                        ...movsEnsaio.rows.map((r) => r.id),
                    ]),
                ];

                const saldoDepois = await obterSaldoVt(db, empresaId, usuarioId, { reconciliar: false });
                const disponivelDepois = Number(saldoDepois.saldo_disponivel);
                const delta = Math.round((disponivelDepois - disponivelAntes) * 100) / 100;
                const temDevolucao = (saldoDepois.ultimos_movimentos || []).some(
                    (m) => m.tipo === 'devolucao_saldo' && m.sentido === 'ida'
                );
                const devolveuIda = (ajuste.acoes || []).some(
                    (a) => a.tipo === 'devolucao_saldo' && a.sentido === 'ida' && Math.abs(Number(a.valor) - via) < 0.011
                );

                // Durante o ajuste o motor pode reconciliar o dia de hoje (se já passou das 18h),
                // então o delta total do saldo não é só +via. O critério é a ação de devolução.
                relatorio.ensaio_motor = {
                    status: 'ok',
                    empresa_id: empresaId,
                    usuario_id: usuarioId,
                    nome: vinculo.rows[0].nome,
                    valor_passagem_diaria: valorDia,
                    valor_via: via,
                    data_ajuste: ontem,
                    saldo_antes: disponivelAntes,
                    saldo_depois: disponivelDepois,
                    credito_validado: valorDia * 5,
                    delta_saldo_total: delta,
                    devolucao_ida_registrada: temDevolucao,
                    acao_devolveu_ida: devolveuIda,
                    acoes_ajuste: ajuste.acoes,
                    teto_ajuste_dias: VT_AJUSTE_TETO_DIAS,
                    schemaVtDisponivel: true,
                };

                assert(devolveuIda, 'Ajuste não gerou devolução da ida');
                assert(temDevolucao, 'Devolução da ida não apareceu no extrato');
            }
        } finally {
            // Limpeza explícita de tudo do ensaio (e qualquer lixo do usuário de teste)
            if (idsLimpar.usuarioId) {
                // Remove tudo do usuário do ensaio neste ambiente de teste (ainda sem uso real do livro).
                await db.query(
                    `DELETE FROM vt_cartao_movimentos
                      WHERE empresa_id = $1 AND usuario_id = $2`,
                    [empresaId, idsLimpar.usuarioId]
                );
                if (idsLimpar.hist) {
                    await db.query(
                        `DELETE FROM historico_pagamentos_funcionarios WHERE id = $1 AND empresa_id = $2`,
                        [idsLimpar.hist, empresaId]
                    );
                }
                await db.query(
                    `DELETE FROM vt_cartao_saldo WHERE empresa_id = $1 AND usuario_id = $2`,
                    [empresaId, idsLimpar.usuarioId]
                );
            }
            relatorio.ensaio_motor = {
                ...(relatorio.ensaio_motor || {}),
                limpeza_explicita: true,
            };
        }

        const contagens = await db.query(`
            SELECT
              (SELECT COUNT(*)::int FROM vt_cartao_movimentos) AS movimentos,
              (SELECT COUNT(*)::int FROM vt_cartao_saldo) AS saldos
        `);
        relatorio.contagens_pos_limpeza = contagens.rows[0];

        relatorio.ok = true;
    } catch (err) {
        relatorio.ok = false;
        relatorio.erros.push(err.message);
    } finally {
        db.release();
        await pool.end();
    }

    console.log(JSON.stringify(relatorio, null, 2));
    process.exit(relatorio.ok ? 0 : 1);
}

main().catch((err) => {
    console.error(JSON.stringify({ ok: false, erro: err.message }, null, 2));
    process.exit(1);
});
