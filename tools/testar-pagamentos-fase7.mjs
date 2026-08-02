import assert from 'node:assert/strict';
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const baseUrl = process.env.FASE7_API_URL || 'http://127.0.0.1:3017/api';
const connectionString =
    process.env.FASE7_POSTGRES_URL ||
    'postgresql://postgres@127.0.0.1:55437/sistema_lv_fase7';
const banco = new URL(connectionString);

if (
    !['127.0.0.1', 'localhost'].includes(banco.hostname) ||
    banco.port !== '55437' ||
    banco.pathname !== '/sistema_lv_fase7'
) {
    throw new Error(
        'Teste recusado: FASE7_POSTGRES_URL deve apontar para a restauração local sistema_lv_fase7 na porta 55437.'
    );
}
if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET não configurado.');
}

const pool = new Pool({ connectionString });
const marcador = `FASE7_HTTP_${Date.now()}`;
const dataFalta = '2098-11-03';
const dataVt = '2098-11-04';
const resultados = [];
let estadoModulo;
let idsHistoricoFixtures = [];
let idsLancamentosCriados = [];
let idInicialLancamentos = 0;

function registrar(nome) {
    resultados.push(nome);
}

async function requisicao(caminho, { token, method = 'GET', body } = {}) {
    const resposta = await fetch(`${baseUrl}${caminho}`, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const texto = await resposta.text();
    let payload;
    try {
        payload = texto ? JSON.parse(texto) : null;
    } catch {
        payload = texto;
    }
    return { status: resposta.status, payload };
}

async function tokenEmpresa(dbClient, empresaId) {
    const { rows } = await dbClient.query(
        `SELECT
            u.id,
            u.nome,
            u.nome_usuario,
            ue.id AS vinculo_empresa_id,
            ue.tipos
         FROM usuarios u
         JOIN usuarios_empresas ue ON ue.usuario_id = u.id
         WHERE u.id = 2
           AND ue.empresa_id = $1
           AND ue.ativo`,
        [empresaId]
    );
    assert.equal(rows.length, 1, `Administrador sem vínculo ativo na empresa ${empresaId}.`);
    const usuario = rows[0];
    return jwt.sign(
        {
            id: usuario.id,
            nome: usuario.nome,
            nome_usuario: usuario.nome_usuario,
            tipos: usuario.tipos,
            empresa_id: empresaId,
            vinculo_empresa_id: usuario.vinculo_empresa_id,
        },
        process.env.JWT_SECRET,
        { expiresIn: '30m' }
    );
}

async function executar() {
    const dbClient = await pool.connect();
    let tokenLojas;
    let tokenNeila;
    try {
        const dbCheck = await dbClient.query(
            `SELECT current_database() AS banco, inet_server_addr()::text AS host, inet_server_port() AS porta`
        );
        assert.equal(dbCheck.rows[0].banco, 'sistema_lv_fase7');
        assert.match(dbCheck.rows[0].host, /^127\.0\.0\.1(?:\/32)?$/);
        assert.equal(dbCheck.rows[0].porta, 55437);

        const modulo = await dbClient.query(
            `SELECT
                ms.multiempresa_pronto,
                em.habilitado
             FROM modulos_sistema ms
             JOIN empresas_modulos em
               ON em.modulo_codigo = ms.codigo
              AND em.empresa_id = 2
             WHERE ms.codigo = 'central-pagamentos'`
        );
        assert.equal(modulo.rows.length, 1);
        estadoModulo = modulo.rows[0];
        const marcoLancamentos = await dbClient.query(
            `SELECT COALESCE(MAX(id), 0)::integer AS id FROM fc_lancamentos`
        );
        idInicialLancamentos = marcoLancamentos.rows[0].id;
        await dbClient.query(
            `UPDATE modulos_sistema
                SET multiempresa_pronto = TRUE
              WHERE codigo = 'central-pagamentos'`
        );
        await dbClient.query(
            `UPDATE empresas_modulos
                SET habilitado = TRUE
              WHERE empresa_id = 2
                AND modulo_codigo = 'central-pagamentos'`
        );

        tokenLojas = await tokenEmpresa(dbClient, 1);
        tokenNeila = await tokenEmpresa(dbClient, 2);

        const historicoLojas = await requisicao('/pagamentos/historico', {
            token: tokenLojas,
        });
        assert.equal(historicoLojas.status, 200);
        assert.ok(Array.isArray(historicoLojas.payload));
        registrar('histórico da empresa legada');

        const historicoNeila = await requisicao('/pagamentos/historico', {
            token: tokenNeila,
        });
        assert.equal(historicoNeila.status, 200);
        assert.deepEqual(historicoNeila.payload, []);
        registrar('histórico vazio e isolado da empresa secundária');

        for (const [tipo, extras] of [
            ['SALARIO', { mes_referencia: 'Novembro/2098' }],
            ['PASSAGENS', { data_inicio: dataVt, data_fim: dataVt }],
            ['BENEFICIOS', {}],
        ]) {
            const params = new URLSearchParams({
                usuario_id: '9',
                tipo_pagamento: tipo,
                ...extras,
            });
            const calculo = await requisicao(`/pagamentos/calcular?${params}`, {
                token: tokenLojas,
            });
            assert.equal(calculo.status, 200, `${tipo}: ${JSON.stringify(calculo.payload)}`);
            assert.equal(calculo.payload.detalhes.funcionario.id, 9);
            registrar(`cálculo ${tipo}`);
        }

        const calculoCruzado = await requisicao(
            '/pagamentos/calcular?usuario_id=9&tipo_pagamento=SALARIO&mes_referencia=Novembro%2F2098',
            { token: tokenNeila }
        );
        assert.equal(calculoCruzado.status, 404);
        registrar('cálculo rejeita vínculo de outra empresa');

        await dbClient.query(
            `UPDATE usuarios_empresas
                SET elegivel_pagamento = TRUE
              WHERE usuario_id = 4
                AND empresa_id = 2`
        );
        const comissaoSecundaria = await requisicao(
            '/pagamentos/calcular?usuario_id=4&tipo_pagamento=COMISSAO&competencia=Julho%2F2026',
            { token: tokenNeila }
        );
        assert.equal(comissaoSecundaria.status, 409);
        assert.match(comissaoSecundaria.payload.error, /cadeia produtiva/i);
        registrar('comissão fechada na empresa secundária');

        const comissaoLegada = await requisicao(
            '/pagamentos/calcular?usuario_id=9&tipo_pagamento=COMISSAO&competencia=Julho%2F2026',
            { token: tokenLojas }
        );
        assert.equal(comissaoLegada.status, 200, JSON.stringify(comissaoLegada.payload));
        assert.ok(Array.isArray(comissaoLegada.payload.dadosDetalhados?.dias));
        registrar('cálculo de comissão na cadeia legada');

        const registrarFalta = await requisicao('/pagamentos/registrar-falta', {
            token: tokenLojas,
            method: 'POST',
            body: { usuario_id: 9, datas: [dataFalta] },
        });
        assert.equal(registrarFalta.status, 201, JSON.stringify(registrarFalta.payload));

        const registros = await requisicao(
            `/pagamentos/registros-dias?usuario_id=9&start=${dataFalta}&end=${dataFalta}`,
            { token: tokenLojas }
        );
        assert.equal(registros.status, 200);
        assert.equal(registros.payload.length, 1);
        assert.equal(registros.payload[0].extendedProps.status, 'FALTA_NAO_JUSTIFICADA');

        const registrosCruzados = await requisicao(
            `/pagamentos/registros-dias?usuario_id=9&start=${dataFalta}&end=${dataFalta}`,
            { token: tokenNeila }
        );
        assert.equal(registrosCruzados.status, 404);
        registrar('registro, leitura e isolamento de faltas');

        const removerFalta = await requisicao('/pagamentos/remover-registro-dia', {
            token: tokenLojas,
            method: 'POST',
            body: { usuario_id: 9, data: dataFalta },
        });
        assert.equal(removerFalta.status, 200);
        registrar('remoção empresarial de registro diário');

        const registrarRecibo = await requisicao('/pagamentos/recibos/registrar', {
            token: tokenLojas,
            method: 'POST',
            body: { usuario_id: 9, data_inicio: dataFalta, data_fim: dataVt },
        });
        assert.equal(registrarRecibo.status, 201, JSON.stringify(registrarRecibo.payload));

        const verificarRecibo = await requisicao(
            `/pagamentos/recibos/verificar?usuario_id=9&data_inicio=${dataFalta}&data_fim=${dataVt}`,
            { token: tokenLojas }
        );
        assert.equal(verificarRecibo.status, 200);
        assert.equal(verificarRecibo.payload.jaExiste, true);

        const periodos = await requisicao(
            '/pagamentos/recibos/historico-periodos?usuario_id=9&ano=2098',
            { token: tokenLojas }
        );
        assert.equal(periodos.status, 200);
        assert.equal(periodos.payload.length, 1);

        const reciboCruzado = await requisicao(
            `/pagamentos/recibos/verificar?usuario_id=9&data_inicio=${dataFalta}&data_fim=${dataVt}`,
            { token: tokenNeila }
        );
        assert.equal(reciboCruzado.status, 404);
        registrar('registro, verificação, períodos e isolamento de recibos');

        const reciboDados = await requisicao(
            `/pagamentos/recibos/dados?usuario_id=9&data_inicio=${dataFalta}&data_fim=${dataVt}`,
            { token: tokenLojas }
        );
        assert.equal(reciboDados.status, 200, JSON.stringify(reciboDados.payload));
        assert.ok(Array.isArray(reciboDados.payload));
        registrar('dados de recibo na cadeia legada');

        const contaLojas = await dbClient.query(
            `SELECT id FROM fc_contas_bancarias WHERE empresa_id = 1 AND ativo ORDER BY id LIMIT 1`
        );
        const calculoSalario = await requisicao(
            '/pagamentos/calcular?usuario_id=9&tipo_pagamento=SALARIO&mes_referencia=Novembro%2F2098',
            { token: tokenLojas }
        );
        calculoSalario.payload.detalhes.ciclo.nome = marcador;
        const efetuar = await requisicao('/pagamentos/efetuar', {
            token: tokenLojas,
            method: 'POST',
            body: {
                calculo: calculoSalario.payload,
                id_conta_debito: contaLojas.rows[0].id,
                datas_pagas: [],
                valor_passagem_diaria: 0,
            },
        });
        assert.equal(efetuar.status, 201, JSON.stringify(efetuar.payload));
        registrar('pagamento salarial e lançamento financeiro');

        const concessionaria = await dbClient.query(
            `SELECT id FROM config_concessionarias_vt WHERE empresa_id = 1 AND ativo ORDER BY id LIMIT 1`
        );
        const loteVt = await requisicao('/pagamentos/lote-vt', {
            token: tokenLojas,
            method: 'POST',
            body: {
                id_conta_debito: contaLojas.rows[0].id,
                id_concessionaria: concessionaria.rows[0].id,
                data_referencia_inicio: dataVt,
                data_referencia_fim: dataVt,
                valor_total_vt: 16.9,
                valor_total_taxa: 0,
                itens: [
                    {
                        usuario_id: 9,
                        nome_funcionario: marcador,
                        dias_qtd: 1,
                        valor_total: 16.9,
                        datas_lista: [dataVt],
                    },
                ],
            },
        });
        assert.equal(loteVt.status, 201, JSON.stringify(loteVt.payload));
        registrar('lote de VT empresarial');

        const historicoVt = await requisicao('/pagamentos/historico-vt?usuario_id=9', {
            token: tokenLojas,
        });
        assert.equal(historicoVt.status, 200);
        const recarga = historicoVt.payload.find((item) =>
            item.detalhes_pagamento?.datas_pagas?.includes(dataVt)
        );
        assert.ok(recarga);

        const estornoCruzado = await requisicao('/pagamentos/estornar-vt', {
            token: tokenNeila,
            method: 'POST',
            body: { recarga_id: recarga.id },
        });
        assert.equal(estornoCruzado.status, 404);

        const estorno = await requisicao('/pagamentos/estornar-vt', {
            token: tokenLojas,
            method: 'POST',
            body: { recarga_id: recarga.id },
        });
        assert.equal(estorno.status, 200, JSON.stringify(estorno.payload));
        registrar('histórico e estorno de VT isolados');

        const lotes = await requisicao('/pagamentos/lotes-vt-agrupados', {
            token: tokenLojas,
        });
        assert.equal(lotes.status, 200);
        assert.ok(Array.isArray(lotes.payload));
        registrar('listagem agrupada de lotes de VT');

        const fixtures = await dbClient.query(
            `WITH inserido_lojas AS (
                INSERT INTO historico_pagamentos_funcionarios
                    (usuario_id, descricao, valor_liquido_pago, id_usuario_pagador,
                     detalhes_pagamento, id_conta_debito, empresa_id)
                VALUES (9, $1, 1, 2, '{}'::jsonb, $2, 1)
                RETURNING id, empresa_id
             ),
             inserido_neila AS (
                INSERT INTO historico_pagamentos_funcionarios
                    (usuario_id, descricao, valor_liquido_pago, id_usuario_pagador,
                     detalhes_pagamento, id_conta_debito, empresa_id)
                VALUES (4, $1, 1, 2, '{}'::jsonb, 12, 2)
                RETURNING id, empresa_id
             )
             SELECT * FROM inserido_lojas
             UNION ALL
             SELECT * FROM inserido_neila`,
            [marcador, contaLojas.rows[0].id]
        );
        idsHistoricoFixtures = fixtures.rows.map((row) => row.id);
        const idLojas = fixtures.rows.find((row) => row.empresa_id === 1).id;
        const idNeila = fixtures.rows.find((row) => row.empresa_id === 2).id;

        const loteMisto = await requisicao('/pagamentos/marcar-lote-impresso', {
            token: tokenLojas,
            method: 'POST',
            body: { ids: [idLojas, idNeila] },
        });
        assert.equal(loteMisto.status, 404);
        const naoAlterou = await dbClient.query(
            `SELECT recibo_impresso_em
               FROM historico_pagamentos_funcionarios
              WHERE id = $1`,
            [idLojas]
        );
        assert.equal(naoAlterou.rows[0].recibo_impresso_em, null);

        const loteProprio = await requisicao('/pagamentos/marcar-lote-impresso', {
            token: tokenLojas,
            method: 'POST',
            body: { ids: [idLojas] },
        });
        assert.equal(loteProprio.status, 200);
        registrar('marcação de impressão atômica contra lote misto');

        const lancamentos = await dbClient.query(
            `SELECT id
               FROM fc_lancamentos
              WHERE empresa_id = 1
                AND id > $2
                AND (
                    descricao LIKE '%' || $1 || '%'
                    OR (
                        descricao LIKE 'Recarga VT (%'
                        AND id_usuario_lancamento = 2
                    )
                )`,
            [marcador, idInicialLancamentos]
        );
        idsLancamentosCriados = lancamentos.rows.map((row) => row.id);
    } finally {
        try {
            await dbClient.query('BEGIN');
            await dbClient.query(
                `DELETE FROM recibos_conferencia
                  WHERE empresa_id = 1
                    AND usuario_id = 9
                    AND data_inicio = $1
                    AND data_fim = $2`,
                [dataFalta, dataVt]
            );
            await dbClient.query(
                `DELETE FROM registro_dias_trabalhados
                  WHERE empresa_id = 1
                    AND usuario_id = 9
                    AND data IN ($1, $2)`,
                [dataFalta, dataVt]
            );
            await dbClient.query(
                `DELETE FROM historico_pagamentos_funcionarios
                  WHERE id = ANY($1::int[])
                     OR descricao = $2
                     OR (
                        empresa_id = 1
                        AND usuario_id = 9
                        AND detalhes_pagamento::text LIKE '%' || $3 || '%'
                     )`,
                [idsHistoricoFixtures, marcador, dataVt]
            );
            if (idsLancamentosCriados.length > 0) {
                await dbClient.query(
                    `DELETE FROM fc_lancamento_itens
                      WHERE id_lancamento_pai = ANY($1::int[])`,
                    [idsLancamentosCriados]
                );
                await dbClient.query(
                    `DELETE FROM fc_lancamentos WHERE id = ANY($1::int[])`,
                    [idsLancamentosCriados]
                );
            }
            await dbClient.query(
                `UPDATE usuarios_empresas
                    SET elegivel_pagamento = FALSE
                  WHERE usuario_id = 4
                    AND empresa_id = 2`
            );
            if (estadoModulo) {
                await dbClient.query(
                    `UPDATE modulos_sistema
                        SET multiempresa_pronto = $1
                      WHERE codigo = 'central-pagamentos'`,
                    [estadoModulo.multiempresa_pronto]
                );
                await dbClient.query(
                    `UPDATE empresas_modulos
                        SET habilitado = $1
                      WHERE empresa_id = 2
                        AND modulo_codigo = 'central-pagamentos'`,
                    [estadoModulo.habilitado]
                );
            }
            await dbClient.query('COMMIT');
        } catch (error) {
            await dbClient.query('ROLLBACK');
            throw error;
        }
        dbClient.release();
    }

    console.log(
        JSON.stringify(
            {
                aprovado: true,
                banco: 'sistema_lv_fase7@127.0.0.1:55437',
                cenarios_aprovados: resultados.length,
                resultados,
                limpeza_local_concluida: true,
            },
            null,
            2
        )
    );
}

try {
    await executar();
} finally {
    await pool.end();
}
