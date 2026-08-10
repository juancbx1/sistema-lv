import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const connectionString = process.argv[2];
if (!connectionString) throw new Error('Informe a URL PostgreSQL local temporária.');
const url = new URL(connectionString);
if (!['127.0.0.1', 'localhost'].includes(url.hostname)
    || !url.pathname.slice(1).startsWith('sistema_lv_origens_produto_pronto_test_')) {
    throw new Error('O teste aceita somente uma base local temporária com o prefixo aprovado.');
}

const jwtSecret = 'segredo-local-origens-produto-pronto';
process.env.POSTGRES_URL = connectionString;
process.env.JWT_SECRET = jwtSecret;
const pool = new pg.Pool({ connectionString, max: 4 });

async function request(baseUrl, path, token, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });
    const payload = await response.json();
    return { status: response.status, payload };
}

let server;
try {
    await pool.query(`
        CREATE TABLE empresas (
            id INTEGER PRIMARY KEY,
            codigo TEXT NOT NULL,
            ativa BOOLEAN NOT NULL DEFAULT TRUE,
            eh_legada BOOLEAN NOT NULL DEFAULT FALSE
        );
        CREATE TABLE produtos (
            id INTEGER PRIMARY KEY,
            empresa_id INTEGER NOT NULL,
            nome TEXT,
            imagem TEXT,
            sku TEXT,
            grade JSONB,
            UNIQUE (empresa_id, id)
        );
        CREATE TABLE ordens_de_producao (
            id INTEGER PRIMARY KEY,
            empresa_id INTEGER NOT NULL,
            numero VARCHAR(255) NOT NULL,
            produto_id INTEGER,
            variante TEXT,
            quantidade INTEGER NOT NULL,
            etapas JSONB NOT NULL DEFAULT '[]'::jsonb,
            data_final TIMESTAMP,
            UNIQUE (empresa_id, id),
            UNIQUE (empresa_id, numero)
        );
        CREATE TABLE processos_producao (
            id BIGINT PRIMARY KEY,
            empresa_id INTEGER NOT NULL,
            UNIQUE (empresa_id, id)
        );
        CREATE TABLE usuarios (
            id INTEGER PRIMARY KEY,
            nome TEXT,
            tipos TEXT[] DEFAULT '{}',
            permissoes TEXT[] DEFAULT '{}'
        );
        CREATE TABLE usuarios_empresas (
            id SERIAL PRIMARY KEY,
            usuario_id INTEGER NOT NULL,
            empresa_id INTEGER NOT NULL,
            tipos TEXT[] DEFAULT '{}',
            permissoes TEXT[] DEFAULT '{}',
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            UNIQUE (usuario_id, empresa_id)
        );
        CREATE TABLE usuarios_acessos_globais (
            usuario_id INTEGER PRIMARY KEY,
            superadministrador BOOLEAN DEFAULT FALSE,
            permissoes TEXT[] DEFAULT '{}'
        );
        CREATE TABLE producoes (
            id TEXT PRIMARY KEY,
            empresa_id INTEGER NOT NULL,
            op_numero TEXT NOT NULL,
            produto_id INTEGER,
            variacao TEXT NOT NULL DEFAULT '-',
            processo TEXT NOT NULL,
            funcionario_id INTEGER,
            funcionario TEXT NOT NULL,
            quantidade INTEGER NOT NULL,
            valor_ponto_aplicado NUMERIC,
            pontos_gerados NUMERIC,
            lancado_por TEXT,
            data TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE sessoes_trabalho_producao (
            id INTEGER PRIMARY KEY,
            empresa_id INTEGER NOT NULL,
            funcionario_id INTEGER NOT NULL,
            op_numero VARCHAR(255) NOT NULL,
            produto_id INTEGER NOT NULL,
            variante TEXT,
            processo TEXT NOT NULL,
            quantidade_atribuida INTEGER NOT NULL,
            quantidade_finalizada INTEGER,
            status VARCHAR(50) NOT NULL,
            data_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            data_fim TIMESTAMPTZ,
            fase TEXT NOT NULL DEFAULT 'OP',
            processo_id BIGINT,
            etapa_id TEXT,
            origens_pos_op JSONB,
            UNIQUE (empresa_id, id)
        );
        CREATE TABLE ajustes_producao (
            id BIGINT PRIMARY KEY,
            empresa_id INTEGER NOT NULL,
            observacao TEXT,
            tipo_ajuste TEXT,
            UNIQUE (empresa_id, id)
        );
        CREATE TABLE arremate_perdas (
            id INTEGER PRIMARY KEY,
            empresa_id INTEGER NOT NULL,
            motivo TEXT,
            observacao TEXT,
            UNIQUE (empresa_id, id)
        );
        CREATE TABLE arremates (
            id SERIAL PRIMARY KEY,
            empresa_id INTEGER NOT NULL,
            op_numero VARCHAR(255) NOT NULL,
            produto_id INTEGER,
            variante TEXT,
            quantidade_arrematada INTEGER NOT NULL,
            quantidade_ja_embalada INTEGER NOT NULL DEFAULT 0,
            usuario_tiktik_id INTEGER,
            usuario_tiktik TEXT NOT NULL,
            data_lancamento TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            lancado_por TEXT,
            tipo_lancamento TEXT,
            id_perda_origem INTEGER,
            fase TEXT NOT NULL DEFAULT 'POS_OP',
            processo TEXT NOT NULL DEFAULT 'Arrematar',
            processo_id BIGINT,
            etapa_id TEXT,
            executor_id INTEGER,
            executor_nome TEXT,
            executor_tipo TEXT,
            id_sessao_producao INTEGER,
            id_ajuste_producao BIGINT,
            valor_ponto_aplicado NUMERIC,
            pontos_gerados NUMERIC,
            UNIQUE (empresa_id, id)
        );
        CREATE TABLE estoque_movimentos (
            id SERIAL PRIMARY KEY,
            empresa_id INTEGER NOT NULL,
            idempotency_key TEXT,
            produto_id INTEGER,
            variante_nome TEXT,
            quantidade INTEGER NOT NULL,
            tipo_movimento TEXT NOT NULL,
            data_movimento TIMESTAMPTZ DEFAULT NOW(),
            origem_arremate_id INTEGER,
            usuario_responsavel TEXT,
            observacao TEXT,
            estornado BOOLEAN DEFAULT FALSE,
            quantidade_estornada INTEGER DEFAULT 0,
            UNIQUE (empresa_id, id)
        );
        CREATE TABLE embalagens_realizadas (
            id SERIAL PRIMARY KEY,
            empresa_id INTEGER NOT NULL,
            idempotency_key TEXT,
            tipo_embalagem VARCHAR(50) NOT NULL,
            produto_embalado_id INTEGER NOT NULL,
            variante_embalada_nome TEXT,
            quantidade_embalada INTEGER NOT NULL,
            usuario_responsavel_id INTEGER,
            data_embalagem TIMESTAMPTZ DEFAULT NOW(),
            observacao TEXT,
            movimento_estoque_id INTEGER,
            status VARCHAR(50) NOT NULL,
            componentes_consumidos JSONB,
            produto_ref_id TEXT,
            UNIQUE (empresa_id, id),
            UNIQUE (empresa_id, idempotency_key)
        );
        CREATE TABLE sistema_migrations (
            id TEXT PRIMARY KEY,
            descricao TEXT,
            detalhes JSONB,
            executada_em TIMESTAMPTZ DEFAULT NOW()
        );

        INSERT INTO empresas VALUES (1, 'teste', TRUE, TRUE);
        INSERT INTO produtos (id, empresa_id, nome, sku, grade)
        VALUES
            (10, 1, 'Produto Teste', 'SKU-BASE', '[{"variacao":"Azul","sku":"SKU-AZUL"}]'),
            (20, 1, 'Kit Teste', 'KIT-BASE', '[{"variacao":"Kit Azul","sku":"KIT-AZUL"}]');
        INSERT INTO ordens_de_producao
            (id, empresa_id, numero, produto_id, variante, quantidade, data_final)
        VALUES
            (100, 1, 'OP-100', 10, 'Azul', 10, NOW()),
            (101, 1, 'OP-101', 10, 'Azul', 5, NOW());
        INSERT INTO processos_producao VALUES (11, 1);
        INSERT INTO usuarios (id, nome, tipos) VALUES (1, 'Administrador Teste', ARRAY['administrador']);
        INSERT INTO usuarios_empresas (usuario_id, empresa_id, tipos)
        VALUES (1, 1, ARRAY['administrador']);
        INSERT INTO sessoes_trabalho_producao
            (id, empresa_id, funcionario_id, op_numero, produto_id, variante,
             processo, quantidade_atribuida, quantidade_finalizada, status,
             data_fim, fase, processo_id, etapa_id)
        VALUES
            (200, 1, 1, 'OP-100', 10, 'Azul', 'Arrematar', 10, 10,
             'FINALIZADA', NOW(), 'POS_OP', 11, 'etapa-pos-op');
        INSERT INTO arremates
            (empresa_id, op_numero, produto_id, variante, quantidade_arrematada,
             usuario_tiktik_id, usuario_tiktik, lancado_por, tipo_lancamento,
             fase, processo, processo_id, etapa_id, executor_id, executor_nome,
             executor_tipo, id_sessao_producao, valor_ponto_aplicado, pontos_gerados,
             data_lancamento)
        VALUES
            (1, 'OP-100', 10, 'Azul', 10, 1, 'Administrador Teste',
             'Administrador Teste', 'PRODUCAO', 'POS_OP', 'Arrematar', 11,
             'etapa-pos-op', 1, 'Administrador Teste', 'tiktik', 200, 1.5, 15,
             NOW() - INTERVAL '1 minute'),
            (1, 'OP-101', 10, 'Azul', 5, 1, 'Administrador Teste',
             'Administrador Teste', 'PRODUCAO', 'POS_OP', 'Arrematar', 11,
             'etapa-pos-op', 1, 'Administrador Teste', 'tiktik', NULL, 1.5, 7.5,
             NOW() + INTERVAL '1 minute');
    `);

    const {
        alocarOrigensProdutoPronto,
        construirCteOrigensProdutoPronto,
        registrarOrigemProdutoPronto,
    } = await import(`../api/utils/origens-produto-pronto.js?teste=${Date.now()}`);
    const legadoAntesMigration = await pool.query(`
        ${construirCteOrigensProdutoPronto(false)}
        SELECT SUM(quantidade_disponibilizada - quantidade_consumida) AS saldo
          FROM OrigensProdutoProntoCompat
         WHERE empresa_id = 1
    `);
    assert.equal(Number(legadoAntesMigration.rows[0].saldo), 15);
    const compatClient = await pool.connect();
    try {
        await compatClient.query('BEGIN');
        const compat = await alocarOrigensProdutoPronto(compatClient, {
            empresaId: 1,
            produtoId: 10,
            variante: 'Azul',
            quantidade: 3,
        });
        assert.equal(compat.estrutura.origens, false);
        assert.equal(compat.alocacoes.length, 1);
        await compatClient.query('ROLLBACK');
    } finally {
        compatClient.release();
    }

    const migration = await fs.readFile(
        new URL('../_planejamento/migration-origens-produto-pronto-v1.sql', import.meta.url),
        'utf8',
    );
    await pool.query(migration);

    const origemClient = await pool.connect();
    try {
        await registrarOrigemProdutoPronto(origemClient, {
            empresaId: 1,
            produtoId: 10,
            variante: 'Azul',
            opNumero: 'OP-100',
            processo: 'Arrematar',
            processoId: 11,
            etapaId: 'etapa-pos-op',
            sessaoProducaoId: 200,
            arremateIdLegado: 1,
            quantidade: 10,
            valorPontoAplicado: 1.5,
            pontosGerados: 15,
            executorId: 1,
            executorNome: 'Administrador Teste',
            executorTipo: 'tiktik',
        });
    } finally {
        origemClient.release();
    }

    const origensAntes = await pool.query(`
        SELECT
            (SELECT COUNT(*) FROM origens_produto_pronto) AS canonicas,
            (SELECT SUM(quantidade_disponibilizada - quantidade_consumida)
               FROM origens_produto_pronto) AS saldo_canonico,
            (SELECT SUM(quantidade_arrematada - quantidade_ja_embalada)
               FROM arremates a
              WHERE NOT EXISTS (
                    SELECT 1 FROM origens_produto_pronto o
                     WHERE o.empresa_id = a.empresa_id
                       AND o.arremate_id_legado = a.id
              )) AS saldo_legado
    `);
    assert.deepEqual(origensAntes.rows[0], {
        canonicas: '1',
        saldo_canonico: '10',
        saldo_legado: '5',
    });

    const [
        { default: embalagensRouter },
        { default: producoesRouter },
        { default: kitsRouter },
    ] = await Promise.all([
        import(`../api/embalagens.js?teste=${Date.now()}`),
        import(`../api/producoes.js?teste=${Date.now()}`),
        import(`../api/kits.js?teste=${Date.now()}`),
    ]);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.empresaId = 1;
        req.moduloEmpresa = { multiempresa_pronto: true, habilitado: true };
        next();
    });
    app.use('/embalagens', embalagensRouter);
    app.use('/producoes', producoesRouter);
    app.use('/kits', kitsRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ id: 1, empresa_id: 1, nome: 'Administrador Teste' }, jwtSecret);

    const filaAntes = await request(baseUrl, '/embalagens/fila?todos=true', token);
    assert.equal(filaAntes.status, 200);
    assert.equal(Number(filaAntes.payload.rows[0].total_disponivel_para_embalar), 15);

    const chave = 'embalagem-unidade-teste-1';
    const embalagem = await request(baseUrl, '/embalagens/unidade', token, {
        method: 'POST',
        headers: { 'Idempotency-Key': chave },
        body: JSON.stringify({
            produto_id: 10,
            variante_nome: 'Azul',
            quantidade_embalada: 12,
            observacao: 'smoke origem canônica + legado',
        }),
    });
    assert.equal(embalagem.status, 201, JSON.stringify(embalagem.payload));
    assert.equal(embalagem.payload.origens_consumidas, 2);

    const repeticao = await request(baseUrl, '/embalagens/unidade', token, {
        method: 'POST',
        headers: { 'Idempotency-Key': chave },
        body: JSON.stringify({
            produto_id: 10,
            variante_nome: 'Azul',
            quantidade_embalada: 12,
        }),
    });
    assert.equal(repeticao.status, 200);
    assert.equal(repeticao.payload.idempotente, true);

    const estadoConsumido = await pool.query(`
        SELECT
            (SELECT quantidade_consumida FROM origens_produto_pronto WHERE id = 1) AS canonico,
            (SELECT quantidade_ja_embalada FROM arremates WHERE id = 1) AS projecao,
            (SELECT quantidade_ja_embalada FROM arremates WHERE id = 2) AS legado,
            (SELECT COUNT(*) FROM embalagens_realizadas) AS embalagens,
            (SELECT COUNT(*) FROM embalagens_origens_produto_pronto) AS alocacoes,
            (SELECT COUNT(*) FROM estoque_movimentos WHERE embalagem_origem_id IS NOT NULL) AS movimentos
    `);
    assert.deepEqual(estadoConsumido.rows[0], {
        canonico: 10,
        projecao: 10,
        legado: 2,
        embalagens: '1',
        alocacoes: '2',
        movimentos: '1',
    });

    const filaDepois = await request(baseUrl, '/embalagens/fila?todos=true', token);
    assert.equal(filaDepois.status, 200);
    assert.equal(Number(filaDepois.payload.rows[0].total_disponivel_para_embalar), 3);

    const historico = await request(baseUrl, '/producoes/historico?periodo=todos', token);
    assert.equal(historico.status, 200, JSON.stringify(historico.payload));
    assert.ok(historico.payload.rows.some((item) => item.tipo_evento === 'CONCLUSAO_POS_OP'));
    assert.ok(historico.payload.rows.some((item) => item.tipo_evento === 'EMBALAGEM_UNIDADE'));
    assert.ok(historico.payload.rows.some((item) => item.tipo_evento === 'ESTOQUE_ENTRADA_PRODUCAO'));

    const estorno = await request(baseUrl, '/embalagens/estornar', token, {
        method: 'POST',
        body: JSON.stringify({ id_embalagem_realizada: embalagem.payload.embalagem_id }),
    });
    assert.equal(estorno.status, 200, JSON.stringify(estorno.payload));

    const estadoEstornado = await pool.query(`
        SELECT
            (SELECT quantidade_consumida FROM origens_produto_pronto WHERE id = 1) AS canonico,
            (SELECT quantidade_ja_embalada FROM arremates WHERE id = 1) AS projecao,
            (SELECT quantidade_ja_embalada FROM arremates WHERE id = 2) AS legado,
            (SELECT status FROM embalagens_realizadas WHERE id = $1) AS status,
            (SELECT COUNT(*) FROM embalagens_origens_produto_pronto WHERE estornada_em IS NOT NULL) AS alocacoes_estornadas
    `, [embalagem.payload.embalagem_id]);
    assert.deepEqual(estadoEstornado.rows[0], {
        canonico: 0,
        projecao: 0,
        legado: 0,
        status: 'ESTORNADO',
        alocacoes_estornadas: '2',
    });

    const kit = await request(baseUrl, '/kits/montar', token, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'embalagem-kit-teste-1' },
        body: JSON.stringify({
            kit_produto_id: 20,
            kit_variante: 'Kit Azul',
            quantidade_kits_montados: 2,
            componentes_consumidos: [{
                produto_id: 10,
                variacao: 'Azul',
                quantidade_usada: 4,
            }],
        }),
    });
    assert.equal(kit.status, 200, JSON.stringify(kit.payload));
    assert.ok(kit.payload.embalagem_id);
    const estadoKit = await pool.query(`
        SELECT
            (SELECT quantidade_consumida FROM origens_produto_pronto WHERE id = 1) AS canonico,
            (SELECT quantidade_ja_embalada FROM arremates WHERE id = 1) AS projecao,
            (SELECT COUNT(*) FROM embalagens_origens_produto_pronto
              WHERE embalagem_id = $1 AND estornada_em IS NULL) AS alocacoes,
            (SELECT embalagem_origem_id FROM estoque_movimentos WHERE id = $2) AS embalagem_origem_id
    `, [kit.payload.embalagem_id, kit.payload.movimento_estoque_id]);
    assert.deepEqual(estadoKit.rows[0], {
        canonico: 4,
        projecao: 4,
        alocacoes: '1',
        embalagem_origem_id: kit.payload.embalagem_id,
    });
    const estornoKit = await request(baseUrl, '/embalagens/estornar', token, {
        method: 'POST',
        body: JSON.stringify({ id_embalagem_realizada: kit.payload.embalagem_id }),
    });
    assert.equal(estornoKit.status, 200, JSON.stringify(estornoKit.payload));

    console.log(JSON.stringify({
        aprovado: true,
        verificacoes: {
            migrationAditiva: true,
            semBackfillAutomatico: true,
            compatibilidadeAntesDaMigration: true,
            filaSemDuplicidade: true,
            consumoMistoCanonicoLegado: true,
            embalagemEstoqueAtomicos: true,
            idempotencia: true,
            estornoPorAlocacao: true,
            kitComOrigemGenerica: true,
            historicoGeral: true,
        },
    }, null, 2));
} finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
}
