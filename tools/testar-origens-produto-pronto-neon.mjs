import 'dotenv/config';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.POSTGRES_URL;
const confirmacao = process.env.SMOKE_NEON_CONFIRM;

if (confirmacao !== 'SIM') {
    throw new Error('Defina SMOKE_NEON_CONFIRM=SIM para autorizar escritas temporárias na Neon.');
}
if (!connectionString) {
    throw new Error('POSTGRES_URL não configurada.');
}

const url = new URL(connectionString);
if (['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Este smoke é exclusivo para a Neon; use o smoke local para localhost.');
}
if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET não configurado.');
}

const pool = new Pool({ connectionString, max: 8 });
const sufixo = `smoke-neon-origem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyUnidade = `${sufixo}-unidade`;
const idempotencyKit = `${sufixo}-kit`;
let server;
let actorId;
let produtoId;
let sku;
let variante;
let arremateId;
let arremateQuantidadeOriginal;
let origemId;
let embalagemUnidadeId;
let embalagemKitId;
let movimentoUnidadeId;
let movimentoKitId;

function tokenParaEmpresa(empresaId) {
    return jwt.sign(
        { id: actorId, empresa_id: empresaId, superadministrador: false },
        process.env.JWT_SECRET,
        { expiresIn: '1h' },
    );
}

async function request(baseUrl, path, token, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });
    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }
    return { status: response.status, payload };
}

function assertStatus(response, expected, label) {
    assert.equal(
        response.status,
        expected,
        `${label}: esperado HTTP ${expected}, recebido ${response.status}: ${JSON.stringify(response.payload)}`,
    );
}

async function cleanup() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (embalagemUnidadeId || embalagemKitId) {
            await client.query(
                `DELETE FROM embalagens_origens_produto_pronto
                  WHERE empresa_id = 1
                    AND embalagem_id = ANY($1::integer[])`,
                [[embalagemUnidadeId, embalagemKitId].filter(Boolean)],
            );
        }
        await client.query(
            `DELETE FROM estoque_movimentos
              WHERE empresa_id = 1
                AND idempotency_key = ANY($1::text[])`,
            [[
                idempotencyUnidade,
                idempotencyKit,
                embalagemUnidadeId ? `embalagem-estorno:1:${embalagemUnidadeId}` : null,
                embalagemKitId ? `embalagem-estorno:1:${embalagemKitId}` : null,
            ].filter(Boolean)],
        );
        if (embalagemUnidadeId || embalagemKitId) {
            await client.query(
                `DELETE FROM embalagens_realizadas
                  WHERE empresa_id = 1
                    AND id = ANY($1::integer[])`,
                [[embalagemUnidadeId, embalagemKitId].filter(Boolean)],
            );
        }
        if (origemId) {
            await client.query(
                `DELETE FROM embalagens_origens_produto_pronto
                  WHERE empresa_id = 1 AND origem_produto_pronto_id = $1`,
                [origemId],
            );
            await client.query(
                `DELETE FROM origens_produto_pronto
                  WHERE empresa_id = 1 AND id = $1`,
                [origemId],
            );
        }
        if (arremateId !== undefined && arremateQuantidadeOriginal !== undefined) {
            await client.query(
                `UPDATE arremates
                    SET quantidade_ja_embalada = $1
                  WHERE empresa_id = 1 AND id = $2`,
                [arremateQuantidadeOriginal, arremateId],
            );
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[smoke-neon] limpeza falhou:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

try {
    const actor = (await pool.query(`
        SELECT u.id
          FROM usuarios u
          JOIN usuarios_empresas ue
            ON ue.usuario_id = u.id
           AND ue.empresa_id = 1
           AND ue.ativo = TRUE
         WHERE 'administrador' = ANY(ue.tipos)
         ORDER BY u.id
         LIMIT 1
    `)).rows[0];
    assert.ok(actor, 'Administrador ativo da empresa 1 não encontrado.');
    actorId = actor.id;

    const fonte = (await pool.query(`
        SELECT p.id AS produto_id,
               p.sku,
               a.id AS arremate_id,
               COALESCE(NULLIF(a.variante, '-'), NULL) AS variante,
               a.op_numero,
               COALESCE(a.processo, 'POS_OP') AS processo,
               a.valor_ponto_aplicado,
               a.pontos_gerados,
               a.quantidade_ja_embalada,
               a.quantidade_arrematada
          FROM produtos p
          JOIN arremates a
            ON a.empresa_id = p.empresa_id
           AND a.produto_id = p.id
         WHERE p.empresa_id = 1
           AND p.sku IS NOT NULL
           AND a.tipo_lancamento = 'PRODUCAO'
           AND a.quantidade_arrematada > COALESCE(a.quantidade_ja_embalada, 0)
         ORDER BY a.id
         LIMIT 1
    `)).rows[0];
    assert.ok(fonte, 'Nenhum arremate legado com saldo disponível foi encontrado.');
    produtoId = fonte.produto_id;
    sku = fonte.sku;
    variante = fonte.variante;
    arremateId = fonte.arremate_id;
    arremateQuantidadeOriginal = Number(fonte.quantidade_ja_embalada || 0);

    const origem = (await pool.query(`
        INSERT INTO origens_produto_pronto (
            empresa_id, tipo_origem, produto_id, variante, op_numero, fase,
            processo, arremate_id_legado, quantidade_disponibilizada,
            valor_ponto_aplicado, pontos_gerados, data_disponibilizacao
        )
        VALUES (1, 'CONCLUSAO_POS_OP', $1, $2, $3, 'POS_OP', $4, $5, 1, $6, $7, '1900-01-01T00:00:00Z')
        RETURNING id
    `, [
        produtoId,
        variante,
        fonte.op_numero,
        fonte.processo,
        arremateId,
        fonte.valor_ponto_aplicado,
        fonte.pontos_gerados,
    ])).rows[0];
    origemId = origem.id;

    process.env.POSTGRES_URL = connectionString;
    const { default: app } = await import(`../api/index.js?smoke-neon-origens=${Date.now()}`);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const token = tokenParaEmpresa(1);

    const origens = await request(
        baseUrl,
        `/embalagens/origens?produto_id=${produtoId}&variante=${encodeURIComponent(variante || '-')}`,
        token,
    );
    assertStatus(origens, 200, 'GET /embalagens/origens');
    assert.ok(origens.payload.rows.some((row) => Number(row.origem_id) === Number(origemId)));

    const unidadePayload = {
        produto_id: produtoId,
        variante_nome: variante || '-',
        quantidade_embalada: 1,
        observacao: sufixo,
    };
    const unidade = await request(baseUrl, '/embalagens/unidade', token, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyUnidade },
        body: JSON.stringify(unidadePayload),
    });
    assertStatus(unidade, 201, 'POST /embalagens/unidade');
    embalagemUnidadeId = unidade.payload.embalagem_id;
    movimentoUnidadeId = unidade.payload.movimento_estoque_id;
    assert.ok(embalagemUnidadeId);
    assert.ok(movimentoUnidadeId);

    const unidadeRepetida = await request(baseUrl, '/embalagens/unidade', token, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyUnidade },
        body: JSON.stringify(unidadePayload),
    });
    assertStatus(unidadeRepetida, 200, 'repetição idempotente da unidade');
    assert.equal(unidadeRepetida.payload.idempotente, true);
    assert.equal(unidadeRepetida.payload.embalagem_id, embalagemUnidadeId);

    const depoisUnidade = (await pool.query(`
        SELECT o.quantidade_consumida,
               a.quantidade_ja_embalada,
               er.id AS alocacao_id,
               em.embalagem_origem_id
          FROM origens_produto_pronto o
          JOIN arremates a ON a.empresa_id = o.empresa_id AND a.id = o.arremate_id_legado
          JOIN embalagens_origens_produto_pronto er
            ON er.empresa_id = o.empresa_id
           AND er.origem_produto_pronto_id = o.id
           AND er.embalagem_id = $2
          JOIN estoque_movimentos em
            ON em.empresa_id = o.empresa_id
           AND em.id = $3
         WHERE o.empresa_id = 1 AND o.id = $1
    `, [origemId, embalagemUnidadeId, movimentoUnidadeId])).rows[0];
    assert.equal(Number(depoisUnidade.quantidade_consumida), 1);
    assert.equal(Number(depoisUnidade.quantidade_ja_embalada), arremateQuantidadeOriginal + 1);
    assert.equal(Number(depoisUnidade.embalagem_origem_id), Number(embalagemUnidadeId));

    const historicoUnidade = await request(
        baseUrl,
        `/producoes/historico?produtoId=${produtoId}&periodo=30d&page=1&limit=50`,
        token,
    );
    assertStatus(historicoUnidade, 200, 'GET /producoes/historico');
    assert.ok(Array.isArray(historicoUnidade.payload.rows));
    assert.ok(historicoUnidade.payload.rows.some((row) => row.origem === 'EMBALAGEM'));

    const estornoUnidade = await request(baseUrl, '/embalagens/estornar', token, {
        method: 'POST',
        body: JSON.stringify({ id_embalagem_realizada: embalagemUnidadeId }),
    });
    assertStatus(estornoUnidade, 200, 'estorno da unidade');

    const depoisEstornoUnidade = (await pool.query(`
        SELECT o.quantidade_consumida,
               a.quantidade_ja_embalada,
               er.estornada_em,
               er.quantidade_consumida AS quantidade_alocada
          FROM origens_produto_pronto o
          JOIN arremates a ON a.empresa_id = o.empresa_id AND a.id = o.arremate_id_legado
          JOIN embalagens_origens_produto_pronto er
            ON er.empresa_id = o.empresa_id
           AND er.origem_produto_pronto_id = o.id
           AND er.embalagem_id = $2
         WHERE o.empresa_id = 1 AND o.id = $1
    `, [origemId, embalagemUnidadeId])).rows[0];
    assert.equal(Number(depoisEstornoUnidade.quantidade_consumida), 0);
    assert.equal(Number(depoisEstornoUnidade.quantidade_ja_embalada), arremateQuantidadeOriginal);
    assert.ok(depoisEstornoUnidade.estornada_em);
    assert.equal(Number(depoisEstornoUnidade.quantidade_alocada), 1);

    const kit = await request(baseUrl, '/kits/montar', token, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKit },
        body: JSON.stringify({
            kit_produto_id: produtoId,
            kit_variante: variante || '-',
            quantidade_kits_montados: 1,
            componentes_consumidos: [{
                produto_id: produtoId,
                variacao: variante || '-',
                quantidade_usada: 1,
            }],
            observacao: sufixo,
        }),
    });
    assertStatus(kit, 200, 'POST /kits/montar');
    embalagemKitId = kit.payload.embalagem_id;
    movimentoKitId = kit.payload.movimento_estoque_id;
    assert.ok(embalagemKitId);
    assert.ok(movimentoKitId);

    const kitRepetido = await request(baseUrl, '/kits/montar', token, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKit },
        body: JSON.stringify({
            kit_produto_id: produtoId,
            kit_variante: variante || '-',
            quantidade_kits_montados: 1,
            componentes_consumidos: [{
                produto_id: produtoId,
                variacao: variante || '-',
                quantidade_usada: 1,
            }],
            observacao: sufixo,
        }),
    });
    assertStatus(kitRepetido, 200, 'repetição idempotente do kit');
    assert.equal(kitRepetido.payload.idempotente, true);
    assert.equal(kitRepetido.payload.embalagem_id, embalagemKitId);

    const estornoKit = await request(baseUrl, '/embalagens/estornar', token, {
        method: 'POST',
        body: JSON.stringify({ id_embalagem_realizada: embalagemKitId }),
    });
    assertStatus(estornoKit, 200, 'estorno do kit');

    const final = (await pool.query(`
        SELECT o.quantidade_consumida,
               a.quantidade_ja_embalada,
               COUNT(er.id) FILTER (WHERE er.estornada_em IS NULL) AS alocacoes_ativas,
               COUNT(em.id) FILTER (WHERE em.embalagem_origem_id = $2) AS movimentos_vinculados
          FROM origens_produto_pronto o
          JOIN arremates a ON a.empresa_id = o.empresa_id AND a.id = o.arremate_id_legado
          LEFT JOIN embalagens_origens_produto_pronto er
            ON er.empresa_id = o.empresa_id AND er.origem_produto_pronto_id = o.id
          LEFT JOIN estoque_movimentos em
            ON em.empresa_id = o.empresa_id
           AND em.idempotency_key = ANY($3::text[])
         WHERE o.empresa_id = 1 AND o.id = $1
         GROUP BY o.quantidade_consumida, a.quantidade_ja_embalada
    `, [
        origemId,
        embalagemUnidadeId,
        [idempotencyUnidade, idempotencyKit],
    ])).rows[0];
    assert.equal(Number(final.quantidade_consumida), 0);
    assert.equal(Number(final.quantidade_ja_embalada), arremateQuantidadeOriginal);
    assert.equal(Number(final.alocacoes_ativas), 0);
    assert.ok(Number(final.movimentos_vinculados) >= 2);

    console.log(JSON.stringify({
        aprovado: true,
        verificacoes: {
            origemCanonicaConsumida: true,
            projecaoLegadaAtualizada: true,
            embalagemUnitariaAtomica: true,
            unidadeIdempotente: true,
            historicoGeral: true,
            estornoUnidade: true,
            kitComOrigemGenerica: true,
            kitIdempotente: true,
            estornoKit: true,
            saldoFinalRestaurado: true,
        },
    }, null, 2));
} finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await cleanup().catch(() => {});
    await pool.end();
}
