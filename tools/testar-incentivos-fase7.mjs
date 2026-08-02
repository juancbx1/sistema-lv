import assert from 'node:assert/strict';
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const baseUrl = process.env.FASE7_API_URL || 'http://127.0.0.1:3017/api';
const connectionString = process.env.FASE7_POSTGRES_URL ||
    'postgresql://postgres@127.0.0.1:55437/sistema_lv_fase7';
const banco = new URL(connectionString);

if (
    !['127.0.0.1', 'localhost'].includes(banco.hostname) ||
    banco.port !== '55437' ||
    banco.pathname !== '/sistema_lv_fase7'
) {
    throw new Error(
        'Teste recusado: use exclusivamente a restauração local sistema_lv_fase7 na porta 55437.'
    );
}
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET não configurado.');

const pool = new Pool({ connectionString });
const marcador = `FASE7_INCENTIVOS_${Date.now()}`;
const dataHoje = new Date().toLocaleDateString('sv', { timeZone: 'America/Sao_Paulo' });
const dataInicio = '2098-12-01T00:00:00-03:00';
const dataFim = '2098-12-31T23:59:59-03:00';
const codigosModulos = ['incentivos', 'permissoes', 'producao-geral', 'dashboard'];
const resultados = [];
const idsGincanas = [];
const idsGanhos = [];
const idsPontosExtras = [];
const idsConfiguracoes = [];
const idsVersoes = [];
const idsBancoLog = [];
let estadoModulos = [];
let idVinculoFuncionarioFixture = null;

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
    const { rows } = await dbClient.query(`
        SELECT u.id, u.nome, u.nome_usuario, ue.id AS vinculo_empresa_id, ue.tipos
        FROM usuarios u
        JOIN usuarios_empresas ue ON ue.usuario_id = u.id
        WHERE u.id = 2
          AND ue.empresa_id = $1
          AND ue.ativo
    `, [empresaId]);
    assert.equal(rows.length, 1, `Administrador sem vínculo ativo na empresa ${empresaId}.`);
    const usuario = rows[0];
    return jwt.sign({
        id: usuario.id,
        nome: usuario.nome,
        nome_usuario: usuario.nome_usuario,
        tipos: usuario.tipos,
        empresa_id: empresaId,
        vinculo_empresa_id: usuario.vinculo_empresa_id,
    }, process.env.JWT_SECRET, { expiresIn: '30m' });
}

async function funcionarioAtivo(dbClient, empresaId) {
    const { rows } = await dbClient.query(`
        SELECT ue.usuario_id
        FROM usuarios_empresas ue
        JOIN usuarios u ON u.id = ue.usuario_id
        WHERE ue.empresa_id = $1
          AND ue.ativo
          AND ue.data_admissao IS NOT NULL
          AND ue.data_demissao IS NULL
          AND COALESCE(u.is_test, FALSE) = FALSE
          AND u.id <> 2
        ORDER BY CASE WHEN 'costureira' = ANY(ue.tipos) THEN 0 ELSE 1 END,
                 ue.usuario_id
        LIMIT 1
    `, [empresaId]);
    assert.equal(rows.length, 1, `Nenhum vÃ­nculo ativo elegÃ­vel encontrado na empresa ${empresaId}.`);
    return rows[0].usuario_id;
}

async function prepararFuncionarioExclusivoNeila(dbClient) {
    const { rows } = await dbClient.query(`
        WITH candidato AS (
            SELECT u.id AS usuario_id
            FROM usuarios u
            JOIN usuarios_empresas ue1
              ON ue1.usuario_id = u.id
             AND ue1.empresa_id = 1
            WHERE (NOT ue1.ativo OR ue1.data_demissao IS NOT NULL)
              AND COALESCE(u.is_test, FALSE) = FALSE
              AND NOT EXISTS (
                  SELECT 1
                  FROM usuarios_empresas ue2
                  WHERE ue2.usuario_id = u.id
                    AND ue2.empresa_id = 2
              )
            ORDER BY u.id
            LIMIT 1
        )
        INSERT INTO usuarios_empresas (
            usuario_id, empresa_id, tipos, data_admissao, data_demissao,
            ativo, empresa_principal
        )
        SELECT usuario_id, 2, ARRAY['costureira']::text[], CURRENT_DATE,
               NULL, TRUE, FALSE
        FROM candidato
        RETURNING id, usuario_id
    `);
    assert.equal(rows.length, 1, 'NÃ£o foi possÃ­vel criar o vÃ­nculo temporÃ¡rio exclusivo da Neila.');
    idVinculoFuncionarioFixture = rows[0].id;
    return rows[0].usuario_id;
}

async function criarVersaoFixture(dbClient, empresaId, nome) {
    const versao = await dbClient.query(`
        INSERT INTO metas_versoes (empresa_id, nome_versao, data_inicio_vigencia)
        VALUES ($1, $2, '2098-01-01')
        RETURNING id
    `, [empresaId, nome]);
    const id = versao.rows[0].id;
    idsVersoes.push(id);
    await dbClient.query(`
        INSERT INTO metas_regras (
            empresa_id, id_versao, tipo_usuario, nivel, pontos_meta,
            valor_comissao, descricao_meta
        )
        VALUES ($1, $2, 'costureira', 1, 10, 1, $3)
    `, [empresaId, id, nome]);
    return id;
}

async function criarGincana(token, nome) {
    const resposta = await requisicao('/gincanas', {
        token,
        method: 'POST',
        body: {
            nome,
            descricao: `Fixture ${nome}`,
            participantes: 'costureiras',
            modalidade: 'individual',
            tipo_premiacao: 'meta',
            escopo_atividade: 'tudo',
            tipo_recorrencia: 'unica',
            datetime_inicio: dataInicio,
            datetime_fim: dataFim,
            visivel_dashboard: true,
            premiacoes: [{
                nivel_label: 'Fixture',
                emoji_icone: '🏅',
                meta_valor: 10,
                descricao_premio: `Prêmio ${nome}`,
                valor_premio_reais: 1,
                ordem: 0,
            }],
        },
    });
    assert.equal(resposta.status, 201, JSON.stringify(resposta.payload));
    idsGincanas.push(resposta.payload.id);
    return resposta.payload.id;
}

async function executar() {
    const dbClient = await pool.connect();
    try {
        const bancoResult = await dbClient.query(`
            SELECT current_database() AS banco, inet_server_addr()::text AS host,
                   inet_server_port() AS porta
        `);
        assert.equal(bancoResult.rows[0].banco, 'sistema_lv_fase7');
        assert.match(bancoResult.rows[0].host, /^127\.0\.0\.1(?:\/32)?$/);
        assert.equal(bancoResult.rows[0].porta, 55437);

        const modulos = await dbClient.query(`
            SELECT ms.codigo, ms.multiempresa_pronto, em.habilitado
            FROM modulos_sistema ms
            JOIN empresas_modulos em
              ON em.modulo_codigo = ms.codigo
             AND em.empresa_id = 2
            WHERE ms.codigo = ANY($1::text[])
            ORDER BY ms.codigo
        `, [codigosModulos]);
        assert.equal(modulos.rows.length, codigosModulos.length);
        estadoModulos = modulos.rows;
        await dbClient.query(`
            UPDATE modulos_sistema
               SET multiempresa_pronto = TRUE
             WHERE codigo = ANY($1::text[])
        `, [codigosModulos]);
        await dbClient.query(`
            UPDATE empresas_modulos
               SET habilitado = TRUE
             WHERE empresa_id = 2
               AND modulo_codigo = ANY($1::text[])
        `, [codigosModulos]);

        const funcionarioLojas = await funcionarioAtivo(dbClient, 1);
        const funcionarioNeila = await prepararFuncionarioExclusivoNeila(dbClient);
        const produto = await dbClient.query('SELECT id FROM produtos ORDER BY id LIMIT 1');
        assert.equal(produto.rows.length, 1, 'A restauração não possui produtos para testar a configuração.');
        const produtoId = produto.rows[0].id;
        const tokenLojas = await tokenEmpresa(dbClient, 1);
        const tokenNeila = await tokenEmpresa(dbClient, 2);

        const versaoLojas = await criarVersaoFixture(dbClient, 1, `${marcador}_LOJAS`);
        const versaoNeila = await criarVersaoFixture(dbClient, 2, `${marcador}_NEILA`);

        const versoesLojas = await requisicao('/metas/versoes', { token: tokenLojas });
        const versoesNeila = await requisicao('/metas/versoes', { token: tokenNeila });
        assert.equal(versoesLojas.status, 200);
        assert.equal(versoesNeila.status, 200);
        assert.ok(versoesLojas.payload.some((item) => item.id === versaoLojas));
        assert.ok(versoesNeila.payload.some((item) => item.id === versaoNeila));
        assert.ok(!versoesLojas.payload.some((item) => item.id === versaoNeila));
        assert.ok(!versoesNeila.payload.some((item) => item.id === versaoLojas));

        const cloneCruzado = await requisicao('/metas/versoes', {
            token: tokenLojas,
            method: 'POST',
            body: {
                nome_versao: `${marcador}_CLONE_CRUZADO`,
                data_inicio_vigencia: '2098-02-01',
                id_versao_origem_clone: versaoNeila,
            },
        });
        assert.equal(cloneCruzado.status, 404);
        const cloneProprio = await requisicao('/metas/versoes', {
            token: tokenNeila,
            method: 'POST',
            body: {
                nome_versao: `${marcador}_CLONE_NEILA`,
                data_inicio_vigencia: '2098-02-01',
                id_versao_origem_clone: versaoNeila,
            },
        });
        assert.equal(cloneProprio.status, 201, JSON.stringify(cloneProprio.payload));
        idsVersoes.push(cloneProprio.payload.id_nova_versao);
        registrar('metas isoladas e clone cruzado recusado');

        const pontoExtra = await requisicao('/pontos-extras', {
            token: tokenNeila,
            method: 'POST',
            body: {
                funcionario_id: funcionarioNeila,
                pontos: 7,
                motivo: `${marcador} motivo de teste`,
                data_referencia: dataHoje,
            },
        });
        assert.equal(pontoExtra.status, 201, JSON.stringify(pontoExtra.payload));
        idsPontosExtras.push(pontoExtra.payload.id);
        const historicoProprio = await requisicao(`/pontos-extras/historico?data=${dataHoje}`, { token: tokenNeila });
        const historicoCruzado = await requisicao(`/pontos-extras/historico?data=${dataHoje}`, { token: tokenLojas });
        assert.equal(historicoProprio.status, 200);
        assert.equal(historicoCruzado.status, 200);
        assert.ok(historicoProprio.payload.some((item) => item.id === pontoExtra.payload.id));
        assert.ok(!historicoCruzado.payload.some((item) => item.id === pontoExtra.payload.id));
        const pontoCruzado = await requisicao('/pontos-extras', {
            token: tokenLojas,
            method: 'POST',
            body: {
                funcionario_id: funcionarioNeila,
                pontos: 7,
                motivo: `${marcador} tentativa cruzada`,
                data_referencia: dataHoje,
            },
        });
        assert.equal(pontoCruzado.status, 404);
        const cancelamentoCruzado = await requisicao(`/pontos-extras/${pontoExtra.payload.id}/cancelar`, {
            token: tokenLojas,
            method: 'PATCH',
            body: { motivo_cancelamento: `${marcador} tentativa cruzada` },
        });
        assert.equal(cancelamentoCruzado.status, 404);
        const cancelamento = await requisicao(`/pontos-extras/${pontoExtra.payload.id}/cancelar`, {
            token: tokenNeila,
            method: 'PATCH',
            body: { motivo_cancelamento: `${marcador} limpeza do fixture` },
        });
        assert.equal(cancelamento.status, 200);
        registrar('pontos extras gravados, lidos e cancelados no contexto correto');

        const processoFixture = `${marcador}_PROCESSO`;
        const config = await requisicao('/configuracao-pontos/padrao', {
            token: tokenNeila,
            method: 'POST',
            body: {
                produto_id: produtoId,
                processo_nome: processoFixture,
                tipo_atividade: 'processo_op_tiktik',
                pontos_padrao: 3.5,
                ativo: true,
            },
        });
        assert.equal(config.status, 201, JSON.stringify(config.payload));
        idsConfiguracoes.push(config.payload.id);
        const configsNeila = await requisicao(`/configuracao-pontos/padrao?processo_nome=${encodeURIComponent(processoFixture)}`, { token: tokenNeila });
        const configsLojas = await requisicao(`/configuracao-pontos/padrao?processo_nome=${encodeURIComponent(processoFixture)}`, { token: tokenLojas });
        assert.equal(configsNeila.status, 200);
        assert.equal(configsLojas.status, 200);
        assert.ok(configsNeila.payload.some((item) => item.id === config.payload.id));
        assert.ok(!configsLojas.payload.some((item) => item.id === config.payload.id));
        const configCruzada = await requisicao(`/configuracao-pontos/padrao/${config.payload.id}`, {
            token: tokenLojas,
            method: 'PUT',
            body: { pontos_padrao: 9 },
        });
        assert.equal(configCruzada.status, 404);
        registrar('configuração de pontos isolada por empresa');

        const logsBanco = await dbClient.query(`
            INSERT INTO banco_pontos_log
                (empresa_id, usuario_id, tipo, quantidade, descricao)
            VALUES
                (1, 2, 'GANHO', 1, $1),
                (2, 2, 'GANHO', 2, $1)
            RETURNING id, empresa_id
        `, [marcador]);
        idsBancoLog.push(...logsBanco.rows.map((row) => row.id));
        const extratoLojas = await requisicao('/dashboard/cofre/extrato?page=1&limit=50', { token: tokenLojas });
        const extratoNeila = await requisicao('/dashboard/cofre/extrato?page=1&limit=50', { token: tokenNeila });
        assert.equal(extratoLojas.status, 200);
        assert.equal(extratoNeila.status, 200);
        assert.deepEqual(
            extratoLojas.payload.rows.filter((row) => row.descricao === marcador).map((row) => Number(row.quantidade)),
            [1]
        );
        assert.deepEqual(
            extratoNeila.payload.rows.filter((row) => row.descricao === marcador).map((row) => Number(row.quantidade)),
            [2]
        );
        registrar('banco de pontos isolado no extrato das duas empresas');

        const gincanaLojas = await criarGincana(tokenLojas, `${marcador}_LOJAS`);
        const gincanaNeila = await criarGincana(tokenNeila, `${marcador}_NEILA`);
        const listaLojas = await requisicao('/gincanas?filtro=todos', { token: tokenLojas });
        const listaNeila = await requisicao('/gincanas?filtro=todos', { token: tokenNeila });
        assert.equal(listaLojas.status, 200);
        assert.equal(listaNeila.status, 200);
        assert.ok(listaLojas.payload.some((item) => item.id === gincanaLojas));
        assert.ok(!listaLojas.payload.some((item) => item.id === gincanaNeila));
        assert.ok(listaNeila.payload.some((item) => item.id === gincanaNeila));
        assert.ok(!listaNeila.payload.some((item) => item.id === gincanaLojas));
        const detalheCruzado = await requisicao(`/gincanas/${gincanaNeila}`, { token: tokenLojas });
        assert.equal(detalheCruzado.status, 404);
        const rankingBloqueado = await requisicao(`/gincanas/${gincanaNeila}/ranking`, { token: tokenNeila });
        assert.equal(rankingBloqueado.status, 403);
        const publicarBloqueado = await requisicao(`/gincanas/${gincanaNeila}/publicar`, {
            token: tokenNeila,
            method: 'PATCH',
            body: { notificar: false },
        });
        assert.equal(publicarBloqueado.status, 403);
        const dashboardBloqueado = await requisicao('/gincanas/dashboard', { token: tokenNeila });
        assert.equal(dashboardBloqueado.status, 403);
        registrar('gincanas isoladas e cadeia produtiva secundária fechada');

        const ganhos = await dbClient.query(`
            INSERT INTO gincanas_premios_ganhos
                (empresa_id, gincana_id, usuario_id, nivel_label, descricao_premio, ganho_em)
            VALUES
                (1, $1, $2, 'Fixture', $3, NOW()),
                (2, $4, $5, 'Fixture', $3, NOW())
            RETURNING id, empresa_id
        `, [gincanaLojas, funcionarioLojas, marcador, gincanaNeila, funcionarioNeila]);
        idsGanhos.push(...ganhos.rows.map((row) => row.id));
        const ganhoLojas = ganhos.rows.find((row) => row.empresa_id === 1).id;
        const ganhoNeila = ganhos.rows.find((row) => row.empresa_id === 2).id;
        const filaLojas = await requisicao('/gincanas-pagamentos/fila', { token: tokenLojas });
        const filaNeila = await requisicao('/gincanas-pagamentos/fila', { token: tokenNeila });
        assert.equal(filaLojas.status, 200);
        assert.equal(filaNeila.status, 200);
        assert.ok(filaLojas.payload.pendentes_semana_atual.concat(filaLojas.payload.pendentes_atrasados).some((item) => item.id === ganhoLojas));
        assert.ok(!filaLojas.payload.pendentes_semana_atual.concat(filaLojas.payload.pendentes_atrasados).some((item) => item.id === ganhoNeila));
        const pagarCruzado = await requisicao(`/gincanas-pagamentos/${ganhoNeila}/pagar`, {
            token: tokenLojas,
            method: 'POST',
        });
        assert.equal(pagarCruzado.status, 404);
        const loteMisto = await requisicao('/gincanas-pagamentos/pagar-lote', {
            token: tokenLojas,
            method: 'POST',
            body: { ids: [ganhoLojas, ganhoNeila] },
        });
        assert.equal(loteMisto.status, 404);
        const naoBaixou = await dbClient.query(`
            SELECT id, pago_em
            FROM gincanas_premios_ganhos
            WHERE id = ANY($1::int[])
            ORDER BY id
        `, [[ganhoLojas, ganhoNeila]]);
        assert.deepEqual(naoBaixou.rows.map((row) => row.pago_em), [null, null]);
        const pagarProprio = await requisicao(`/gincanas-pagamentos/${ganhoNeila}/pagar`, {
            token: tokenNeila,
            method: 'POST',
        });
        assert.equal(pagarProprio.status, 200, JSON.stringify(pagarProprio.payload));
        registrar('premiações isoladas e lote misto recusado antes da baixa');

        for (const rota of [
            ['/dashboard/desempenho', 'GET'],
            ['/dashboard/atividades', 'GET'],
            ['/dashboard/resgatar-pontos', 'POST'],
            ['/dashboard/minha-tabela-pontos', 'GET'],
            ['/dashboard/ranking-semana', 'GET'],
            ['/dashboard/streak', 'GET'],
            ['/dashboard/conquistas-ciclo', 'GET'],
        ]) {
            const bloqueio = await requisicao(rota[0], {
                token: tokenNeila,
                method: rota[1],
                ...(rota[1] === 'POST' ? { body: { quantidade: 1 } } : {}),
            });
            assert.equal(bloqueio.status, 403, `${rota[0]}: ${JSON.stringify(bloqueio.payload)}`);
            assert.equal(bloqueio.payload.codigo, 'CADEIA_PRODUTIVA_NAO_MIGRADA');
        }
        registrar('dashboard secundária falha fechada enquanto a cadeia não foi migrada');

        process.stdout.write(`${JSON.stringify({
            aprovado: true,
            banco: 'sistema_lv_fase7@127.0.0.1:55437',
            cenarios_aprovados: resultados.length,
            resultados,
            limpeza_local_concluida: true,
        }, null, 2)}\n`);
    } finally {
        try {
            await dbClient.query('BEGIN');
            await dbClient.query(
                'DELETE FROM gincanas_premios_ganhos WHERE id = ANY($1::int[]) OR descricao_premio LIKE $2',
                [idsGanhos.length ? idsGanhos : [0], `%${marcador}%`]
            );
            await dbClient.query(
                `DELETE FROM gincanas_premiacoes
                  WHERE gincana_id IN (
                      SELECT id FROM gincanas
                       WHERE id = ANY($1::int[]) OR nome LIKE $2
                  )`,
                [idsGincanas.length ? idsGincanas : [0], `%${marcador}%`]
            );
            await dbClient.query(
                'DELETE FROM gincanas WHERE id = ANY($1::int[]) OR nome LIKE $2',
                [idsGincanas.length ? idsGincanas : [0], `%${marcador}%`]
            );
            await dbClient.query(
                'DELETE FROM pontos_extras WHERE id = ANY($1::int[]) OR motivo LIKE $2',
                [idsPontosExtras.length ? idsPontosExtras : [0], `%${marcador}%`]
            );
            await dbClient.query(
                'DELETE FROM configuracoes_pontos_processos WHERE id = ANY($1::int[]) OR processo_nome LIKE $2',
                [idsConfiguracoes.length ? idsConfiguracoes : [0], `%${marcador}%`]
            );
            await dbClient.query(
                'DELETE FROM banco_pontos_log WHERE id = ANY($1::int[]) OR descricao = $2',
                [idsBancoLog.length ? idsBancoLog : [0], marcador]
            );
            await dbClient.query('DELETE FROM metas_regras WHERE id_versao = ANY($1::int[])', [idsVersoes.length ? idsVersoes : [0]]);
            await dbClient.query('DELETE FROM metas_versoes WHERE id = ANY($1::int[])', [idsVersoes.length ? idsVersoes : [0]]);
            if (idVinculoFuncionarioFixture) {
                await dbClient.query('DELETE FROM usuarios_empresas WHERE id = $1', [idVinculoFuncionarioFixture]);
            }
            for (const modulo of estadoModulos) {
                await dbClient.query(
                    'UPDATE modulos_sistema SET multiempresa_pronto = $1 WHERE codigo = $2',
                    [modulo.multiempresa_pronto, modulo.codigo]
                );
                await dbClient.query(
                    `UPDATE empresas_modulos
                        SET habilitado = $1
                      WHERE empresa_id = 2
                        AND modulo_codigo = $2`,
                    [modulo.habilitado, modulo.codigo]
                );
            }
            await dbClient.query('COMMIT');
        } catch (error) {
            await dbClient.query('ROLLBACK');
            throw error;
        } finally {
            dbClient.release();
        }
    }
}

try {
    await executar();
} finally {
    await pool.end();
}
