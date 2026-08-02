import assert from 'node:assert/strict';
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const baseUrl = process.env.FASE7_API_URL || 'http://127.0.0.1:3017/api';
const connectionString =
    process.env.FASE7_POSTGRES_URL
    || 'postgresql://postgres@127.0.0.1:55437/sistema_lv_fase7';
const banco = new URL(connectionString);

if (
    !['127.0.0.1', 'localhost'].includes(banco.hostname)
    || banco.port !== '55437'
    || banco.pathname !== '/sistema_lv_fase7'
) {
    throw new Error(
        'Teste recusado: use exclusivamente a restauração local sistema_lv_fase7 na porta 55437.'
    );
}
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET não configurado.');

const pool = new Pool({ connectionString });
const marcador = `FASE7_PONTO_${Date.now()}`;
const resultados = [];
let estadoModulo;
let estadoHabilitacao;
let estadosCadeiaLegadaSecundaria = [];
const idsUsuarios = [];

function registrar(nome) {
    resultados.push(nome);
}

async function requisicao(caminho, { token, method = 'POST', body } = {}) {
    const resposta = await fetch(`${baseUrl}${caminho}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
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
          AND ue.ativo = TRUE
    `, [empresaId]);
    assert.equal(rows.length, 1);
    return jwt.sign({
        id: rows[0].id,
        nome: rows[0].nome,
        nome_usuario: rows[0].nome_usuario,
        tipos: rows[0].tipos,
        empresa_id: empresaId,
        vinculo_empresa_id: rows[0].vinculo_empresa_id,
    }, process.env.JWT_SECRET, { expiresIn: '30m' });
}

async function criarFuncionario(dbClient, empresaId, sufixoVinculo) {
    const usuarioResult = await dbClient.query(`
        INSERT INTO usuarios (
            nome, nome_usuario, email, senha, tipos, status_atual, is_test
        )
        VALUES ($1, $2, $3, 'fixture-sem-login', ARRAY['costureira'], 'GLOBAL_SENTINEL', TRUE)
        RETURNING id
    `, [
        `${marcador}_${empresaId}`,
        `${marcador.toLowerCase()}_${empresaId}`,
        `${marcador.toLowerCase()}_${empresaId}@teste.local`,
    ]);
    const usuarioId = usuarioResult.rows[0].id;
    idsUsuarios.push(usuarioId);

    const idResult = await dbClient.query(
        'SELECT COALESCE(MAX(id), 0) + $1 AS id FROM usuarios_empresas',
        [sufixoVinculo]
    );
    await dbClient.query(`
        INSERT INTO usuarios_empresas (
            id, usuario_id, empresa_id, tipos, status_atual, ativo,
            empresa_principal, data_admissao,
            horario_entrada_1, horario_saida_1,
            horario_entrada_2, horario_saida_2,
            horario_entrada_3, horario_saida_3
        )
        VALUES (
            $1, $2, $3, ARRAY['costureira'], 'LIVRE', TRUE, TRUE, CURRENT_DATE,
            '07:30', '11:30', '12:30', '15:00', '15:15', '17:30'
        )
    `, [idResult.rows[0].id, usuarioId, empresaId]);
    return usuarioId;
}

async function executar() {
    const dbClient = await pool.connect();
    try {
        const bancoResult = await dbClient.query(`
            SELECT current_database() AS banco, inet_server_port() AS porta
        `);
        assert.equal(bancoResult.rows[0].banco, 'sistema_lv_fase7');
        assert.equal(bancoResult.rows[0].porta, 55437);

        const moduloResult = await dbClient.query(`
            SELECT multiempresa_pronto
            FROM modulos_sistema
            WHERE codigo = 'dashboard'
        `);
        estadoModulo = moduloResult.rows[0]?.multiempresa_pronto;
        const habilitacaoResult = await dbClient.query(`
            SELECT habilitado
            FROM empresas_modulos
            WHERE empresa_id = 2
              AND modulo_codigo = 'dashboard'
        `);
        estadoHabilitacao = habilitacaoResult.rows[0]?.habilitado;
        await dbClient.query(`
            UPDATE modulos_sistema SET multiempresa_pronto = TRUE WHERE codigo = 'dashboard'
        `);
        await dbClient.query(`
            UPDATE empresas_modulos
            SET habilitado = TRUE
            WHERE empresa_id = 2
              AND modulo_codigo = 'dashboard'
        `);

        const cadeiaLegadaResult = await dbClient.query(`
            SELECT ms.codigo, ms.multiempresa_pronto, em.habilitado
            FROM modulos_sistema ms
            JOIN empresas_modulos em
              ON em.modulo_codigo = ms.codigo
             AND em.empresa_id = 2
            WHERE ms.codigo = ANY($1::text[])
            ORDER BY ms.codigo
        `, [['arremates', 'gerenciar-producao']]);
        assert.equal(cadeiaLegadaResult.rows.length, 2);
        estadosCadeiaLegadaSecundaria = cadeiaLegadaResult.rows;
        await dbClient.query(`
            UPDATE modulos_sistema
               SET multiempresa_pronto = TRUE
             WHERE codigo = ANY($1::text[])
        `, [['arremates', 'gerenciar-producao']]);
        await dbClient.query(`
            UPDATE empresas_modulos
               SET habilitado = TRUE
             WHERE empresa_id = 2
               AND modulo_codigo = ANY($1::text[])
        `, [['arremates', 'gerenciar-producao']]);

        const funcionarioLojas = await criarFuncionario(dbClient, 1, 1);
        const funcionarioNeila = await criarFuncionario(dbClient, 2, 2);
        const tokenLojas = await tokenEmpresa(dbClient, 1);
        const tokenNeila = await tokenEmpresa(dbClient, 2);

        for (const [nome, caminho] of [
            ['producao bloqueada na empresa secundaria', '/producao/meu-status'],
            ['arremates bloqueados na empresa secundaria', '/arremates/status-tiktiks'],
        ]) {
            const bloqueio = await requisicao(caminho, {
                token: tokenNeila,
                method: 'GET',
            });
            assert.equal(bloqueio.status, 403, JSON.stringify(bloqueio.payload));
            assert.equal(bloqueio.payload?.codigo, 'CADEIA_PRODUTIVA_NAO_MIGRADA');
            registrar(nome);
        }

        for (const [nome, caminho] of [
            ['painel de produção geral', '/real-producao/diaria'],
            ['verificação de alertas operacionais', '/alertas/verificar-status'],
            ['status da equipe de produção', '/producao/status-funcionarios'],
            ['status da equipe de arremate', '/arremates/status-tiktiks'],
            ['listagem contextual de usuários', '/usuarios'],
        ]) {
            const leitura = await requisicao(caminho, {
                token: tokenLojas,
                method: 'GET',
            });
            assert.equal(
                leitura.status,
                200,
                `${nome} retornou ${leitura.status}: ${JSON.stringify(leitura.payload)}`
            );
            registrar(nome);
        }

        const statusCruzado = await requisicao(`/usuarios/${funcionarioLojas}/status`, {
            token: tokenNeila,
            method: 'PUT',
            body: { status: 'LIVRE_MANUAL' },
        });
        assert.equal(
            statusCruzado.status,
            404,
            JSON.stringify(statusCruzado.payload)
        );
        const statusContextual = await requisicao(`/usuarios/${funcionarioLojas}/status`, {
            token: tokenLojas,
            method: 'PUT',
            body: { status: 'LIVRE_MANUAL' },
        });
        assert.equal(statusContextual.status, 200);
        registrar('alteração manual de status isolada por vínculo');

        const cruzadoLojasNaNeila = await requisicao('/ponto/excecao', {
            token: tokenNeila,
            body: {
                funcionario_id: funcionarioLojas,
                tipo_excecao: 'ATRASO',
                horario: '08:10',
            },
        });
        assert.equal(cruzadoLojasNaNeila.status, 404);
        registrar('ID da Lojas recusado no contexto da Neila');

        const atrasoLojas = await requisicao('/ponto/excecao', {
            token: tokenLojas,
            body: {
                funcionario_id: funcionarioLojas,
                tipo_excecao: 'ATRASO',
                horario: '08:10',
                motivo: marcador,
            },
        });
        assert.equal(atrasoLojas.status, 200);
        registrar('exceção de atraso gravada na empresa ativa');

        const liberarLojas = await requisicao('/ponto/liberar-intervalo', {
            token: tokenLojas,
            body: { funcionario_id: funcionarioLojas, tipo: 'ALMOCO' },
        });
        assert.equal(liberarLojas.status, 200);
        const statusAlmoco = await dbClient.query(`
            SELECT status_atual
            FROM usuarios_empresas
            WHERE usuario_id = $1 AND empresa_id = 1
        `, [funcionarioLojas]);
        assert.equal(statusAlmoco.rows[0].status_atual, 'ALMOCO');
        registrar('liberação atualiza apenas o vínculo empresarial');

        const desfazerLiberacao = await requisicao('/ponto/desfazer-liberacao', {
            token: tokenLojas,
            body: { funcionario_id: funcionarioLojas },
        });
        assert.equal(desfazerLiberacao.status, 200);

        const retomar = await requisicao('/ponto/retomar-trabalho', {
            token: tokenLojas,
            body: { funcionario_id: funcionarioLojas, tipo: 'ALMOCO' },
        });
        assert.equal(retomar.status, 200);
        const desfazerRetomada = await requisicao('/ponto/desfazer-retomada', {
            token: tokenLojas,
            body: { funcionario_id: funcionarioLojas, tipo: 'ALMOCO' },
        });
        assert.equal(desfazerRetomada.status, 200);
        registrar('retomada e desfazimento preservam a chave empresarial');

        const saidaNeila = await requisicao('/ponto/excecao', {
            token: tokenNeila,
            body: {
                funcionario_id: funcionarioNeila,
                tipo_excecao: 'SAIDA_ANTECIPADA',
                motivo: marcador,
            },
        });
        assert.equal(saidaNeila.status, 200);
        const pontoNeila = await dbClient.query(`
            SELECT empresa_id, tipo_excecao
            FROM ponto_diario
            WHERE funcionario_id = $1
        `, [funcionarioNeila]);
        assert.deepEqual(
            pontoNeila.rows.map((row) => [row.empresa_id, row.tipo_excecao]),
            [[2, 'SAIDA_ANTECIPADA']]
        );
        registrar('ponto da empresa secundária persistido isoladamente');

        const cruzadoNeilaNasLojas = await requisicao('/ponto/desfazer-retomada', {
            token: tokenLojas,
            body: { funcionario_id: funcionarioNeila, tipo: 'ALMOCO' },
        });
        assert.equal(cruzadoNeilaNasLojas.status, 404);
        registrar('mutação cruzada por ID recusada');

        const desfazerSaida = await requisicao('/ponto/desfazer-saida', {
            token: tokenNeila,
            body: { funcionario_id: funcionarioNeila, motivo: marcador },
        });
        assert.equal(desfazerSaida.status, 200);

        const globais = await dbClient.query(`
            SELECT status_atual
            FROM usuarios
            WHERE id = ANY($1::int[])
            ORDER BY id
        `, [idsUsuarios]);
        assert.deepEqual(globais.rows.map((row) => row.status_atual), [
            'GLOBAL_SENTINEL',
            'GLOBAL_SENTINEL',
        ]);
        registrar('estado operacional global permaneceu intocado');

        process.stdout.write(`${JSON.stringify({
            aprovado: true,
            banco: 'sistema_lv_fase7@127.0.0.1:55437',
            cenarios: resultados.length,
            resultados,
        }, null, 2)}\n`);
    } finally {
        if (idsUsuarios.length > 0) {
            await dbClient.query(
                'DELETE FROM ponto_diario WHERE funcionario_id = ANY($1::int[])',
                [idsUsuarios]
            );
            await dbClient.query(
                'DELETE FROM sessoes_trabalho_producao WHERE funcionario_id = ANY($1::int[])',
                [idsUsuarios]
            );
            await dbClient.query(
                'DELETE FROM usuarios_empresas WHERE usuario_id = ANY($1::int[])',
                [idsUsuarios]
            );
            await dbClient.query(
                'DELETE FROM usuarios WHERE id = ANY($1::int[])',
                [idsUsuarios]
            );
        }
        if (estadoModulo !== undefined) {
            await dbClient.query(`
                UPDATE modulos_sistema
                SET multiempresa_pronto = $1
                WHERE codigo = 'dashboard'
            `, [estadoModulo]);
        }
        if (estadoHabilitacao !== undefined) {
            await dbClient.query(`
                UPDATE empresas_modulos
                SET habilitado = $1
                WHERE empresa_id = 2
                  AND modulo_codigo = 'dashboard'
            `, [estadoHabilitacao]);
        }
        if (estadosCadeiaLegadaSecundaria.length > 0) {
            for (const estado of estadosCadeiaLegadaSecundaria) {
                await dbClient.query(`
                    UPDATE modulos_sistema
                       SET multiempresa_pronto = $1
                     WHERE codigo = $2
                `, [estado.multiempresa_pronto, estado.codigo]);
                await dbClient.query(`
                    UPDATE empresas_modulos
                       SET habilitado = $1
                     WHERE empresa_id = 2
                       AND modulo_codigo = $2
                `, [estado.habilitado, estado.codigo]);
            }
        }
        dbClient.release();
        await pool.end();
    }
}

executar().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
