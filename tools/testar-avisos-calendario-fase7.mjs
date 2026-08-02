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
    throw new Error('Teste recusado: use exclusivamente a restauração local sistema_lv_fase7 na porta 55437.');
}
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET não configurado.');

const pool = new Pool({ connectionString });
const marcador = `FASE7_AVISOS_CAL_${Date.now()}`;
const dataFixture = '2098-11-17';
const hoje = new Date().toLocaleDateString('sv', { timeZone: 'America/Sao_Paulo' });
const codigosModulos = ['alertas', 'calendario'];
const resultados = [];
let estadoModulos = [];
let idCalendario;
let idAviso;

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
        await dbClient.query(
            'UPDATE modulos_sistema SET multiempresa_pronto = TRUE WHERE codigo = ANY($1::text[])',
            [codigosModulos]
        );
        await dbClient.query(
            `UPDATE empresas_modulos SET habilitado = TRUE
              WHERE empresa_id = 2 AND modulo_codigo = ANY($1::text[])`,
            [codigosModulos]
        );

        const tokenLojas = await tokenEmpresa(dbClient, 1);
        const tokenNeila = await tokenEmpresa(dbClient, 2);

        const evento = await requisicao('/calendario', {
            token: tokenNeila,
            method: 'POST',
            body: {
                data: dataFixture,
                tipo: 'folga_empresa',
                descricao: marcador,
                visivel_dashboard: true,
            },
        });
        assert.equal(evento.status, 201, JSON.stringify(evento.payload));
        idCalendario = evento.payload.id;
        const calendarioNeila = await requisicao(`/calendario?inicio=${dataFixture}&fim=${dataFixture}`, { token: tokenNeila });
        const calendarioLojas = await requisicao(`/calendario?inicio=${dataFixture}&fim=${dataFixture}`, { token: tokenLojas });
        assert.equal(calendarioNeila.status, 200);
        assert.equal(calendarioLojas.status, 200);
        assert.ok(calendarioNeila.payload.some((item) => item.id === idCalendario));
        assert.ok(!calendarioLojas.payload.some((item) => item.id === idCalendario));
        const eventoCruzado = await requisicao(`/calendario/${idCalendario}`, {
            token: tokenLojas,
            method: 'PUT',
            body: { data: dataFixture, tipo: 'folga_empresa', descricao: `${marcador}_CRUZADO` },
        });
        assert.equal(eventoCruzado.status, 404);
        const diasNeila = await requisicao(`/calendario/dias-uteis?inicio=${dataFixture}&fim=${dataFixture}`, { token: tokenNeila });
        const diasLojas = await requisicao(`/calendario/dias-uteis?inicio=${dataFixture}&fim=${dataFixture}`, { token: tokenLojas });
        assert.equal(diasNeila.status, 200);
        assert.equal(diasLojas.status, 200);
        assert.equal(diasNeila.payload.diasUteis, 0);
        assert.equal(diasLojas.payload.diasUteis, 1);
        registrar('calendário isolado em leitura, cálculo de dias úteis e mutação cruzada');

        const aviso = await requisicao('/avisos-popup', {
            token: tokenNeila,
            method: 'POST',
            body: {
                titulo: marcador,
                tipo: 'texto',
                mensagem: marcador,
                destinatarios: 'todos',
                ativo: true,
                data_inicio: hoje,
            },
        });
        assert.equal(aviso.status, 201, JSON.stringify(aviso.payload));
        idAviso = aviso.payload.id;
        const avisosNeila = await requisicao('/avisos-popup', { token: tokenNeila });
        const avisosLojas = await requisicao('/avisos-popup', { token: tokenLojas });
        assert.equal(avisosNeila.status, 200);
        assert.equal(avisosLojas.status, 200);
        assert.ok(avisosNeila.payload.some((item) => item.id === idAviso));
        assert.ok(!avisosLojas.payload.some((item) => item.id === idAviso));
        const pendentesNeila = await requisicao('/avisos-popup/pendentes', { token: tokenNeila });
        assert.equal(pendentesNeila.status, 200);
        assert.ok(pendentesNeila.payload.some((item) => item.id === idAviso));
        const marcarCruzado = await requisicao(`/avisos-popup/${idAviso}/marcar-visto`, {
            token: tokenLojas,
            method: 'POST',
        });
        assert.equal(marcarCruzado.status, 404);
        const marcar = await requisicao(`/avisos-popup/${idAviso}/marcar-visto`, {
            token: tokenNeila,
            method: 'POST',
        });
        assert.equal(marcar.status, 200);
        const pendentesDepois = await requisicao('/avisos-popup/pendentes', { token: tokenNeila });
        assert.equal(pendentesDepois.status, 200);
        assert.ok(!pendentesDepois.payload.some((item) => item.id === idAviso));
        const visualizacoesCruzadas = await requisicao(`/avisos-popup/${idAviso}/visualizacoes`, { token: tokenLojas });
        assert.equal(visualizacoesCruzadas.status, 404);
        registrar('avisos popup isolados em listagem, pendências, visualização e marcação');

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
            if (idAviso) {
                await dbClient.query('DELETE FROM avisos_popup_visualizacoes WHERE aviso_id = $1', [idAviso]);
                await dbClient.query('DELETE FROM avisos_popup WHERE id = $1 AND empresa_id = 2', [idAviso]);
            }
            if (idCalendario) {
                await dbClient.query('DELETE FROM calendario_empresa WHERE id = $1 AND empresa_id = 2', [idCalendario]);
            }
            for (const modulo of estadoModulos) {
                await dbClient.query(
                    'UPDATE modulos_sistema SET multiempresa_pronto = $1 WHERE codigo = $2',
                    [modulo.multiempresa_pronto, modulo.codigo]
                );
                await dbClient.query(
                    `UPDATE empresas_modulos SET habilitado = $1
                      WHERE empresa_id = 2 AND modulo_codigo = $2`,
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
