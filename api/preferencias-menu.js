import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const router = express.Router();

const MAX_FAVORITOS = 20;
const ID_VALIDO = /^[a-z0-9][a-z0-9-]{0,79}$/;
const VERSAO_VALIDA = /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i;

function contextoObrigatorio(req) {
    const usuarioId = Number(req.usuarioLogado?.id);
    const empresaId = Number(req.empresaId);
    if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) {
        const error = new Error('Autenticação obrigatória.');
        error.statusCode = 401;
        throw error;
    }
    if (!Number.isSafeInteger(empresaId) || empresaId <= 0) {
        const error = new Error('Contexto empresarial obrigatório.');
        error.statusCode = 400;
        throw error;
    }
    return { usuarioId, empresaId };
}

function normalizarFavoritos(valor) {
    if (!Array.isArray(valor)) {
        const error = new Error('A lista de favoritos é inválida.');
        error.statusCode = 400;
        throw error;
    }

    const unicos = [];
    for (const item of valor) {
        if (typeof item !== 'string' || !ID_VALIDO.test(item)) {
            const error = new Error('A lista contém um favorito inválido.');
            error.statusCode = 400;
            throw error;
        }
        if (!unicos.includes(item)) unicos.push(item);
    }
    if (unicos.length > MAX_FAVORITOS) {
        const error = new Error(`Use no máximo ${MAX_FAVORITOS} favoritos.`);
        error.statusCode = 400;
        throw error;
    }
    return unicos;
}

function tabelaAusente(error) {
    return error?.code === '42P01';
}

router.get('/', async (req, res) => {
    let dbClient;
    try {
        const { usuarioId, empresaId } = contextoObrigatorio(req);
        dbClient = await pool.connect();
        const [menuResult, interfaceResult] = await Promise.all([
            dbClient.query(
                `
                    SELECT favoritos
                    FROM usuarios_menu_preferencias
                    WHERE usuario_id = $1
                      AND empresa_id = $2
                `,
                [usuarioId, empresaId]
            ),
            dbClient.query(
                `
                    SELECT changelog_versao_lida
                    FROM usuarios_preferencias_interface
                    WHERE usuario_id = $1
                `,
                [usuarioId]
            ),
        ]);

        const menu = menuResult.rows[0];
        const preferenciaGlobal = interfaceResult.rows[0];
        res.status(200).json({
            favoritos: Array.isArray(menu?.favoritos) ? menu.favoritos : [],
            personalizado: Boolean(menu),
            changelogVersaoLida: preferenciaGlobal?.changelog_versao_lida || null,
            persistenciaDisponivel: true,
        });
    } catch (error) {
        if (tabelaAusente(error)) {
            return res.status(200).json({
                favoritos: [],
                personalizado: false,
                changelogVersaoLida: null,
                persistenciaDisponivel: false,
            });
        }
        console.error('[preferencias-menu GET]', error);
        res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao carregar preferências do menu.',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.put('/favoritos', async (req, res) => {
    let dbClient;
    try {
        const { usuarioId, empresaId } = contextoObrigatorio(req);
        const favoritos = normalizarFavoritos(req.body?.favoritos);
        dbClient = await pool.connect();
        const result = await dbClient.query(
            `
                INSERT INTO usuarios_menu_preferencias (
                    usuario_id,
                    empresa_id,
                    favoritos,
                    atualizado_em
                )
                VALUES ($1, $2, $3::jsonb, NOW())
                ON CONFLICT (usuario_id, empresa_id)
                DO UPDATE SET
                    favoritos = EXCLUDED.favoritos,
                    atualizado_em = NOW()
                RETURNING favoritos
            `,
            [usuarioId, empresaId, JSON.stringify(favoritos)]
        );
        res.status(200).json({
            favoritos: result.rows[0].favoritos,
            persistenciaDisponivel: true,
        });
    } catch (error) {
        if (tabelaAusente(error)) {
            return res.status(503).json({
                error: 'A migration de preferências do menu ainda não foi aplicada.',
                codigo: 'MIGRATION_PENDENTE',
            });
        }
        console.error('[preferencias-menu PUT favoritos]', error);
        res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao salvar favoritos.',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.put('/changelog', async (req, res) => {
    let dbClient;
    try {
        const { usuarioId } = contextoObrigatorio(req);
        const versao = String(req.body?.versao || '').trim();
        if (!VERSAO_VALIDA.test(versao)) {
            return res.status(400).json({ error: 'A versão informada é inválida.' });
        }

        dbClient = await pool.connect();
        await dbClient.query(
            `
                INSERT INTO usuarios_preferencias_interface (
                    usuario_id,
                    changelog_versao_lida,
                    atualizado_em
                )
                VALUES ($1, $2, NOW())
                ON CONFLICT (usuario_id)
                DO UPDATE SET
                    changelog_versao_lida = EXCLUDED.changelog_versao_lida,
                    atualizado_em = NOW()
            `,
            [usuarioId, versao]
        );
        res.status(200).json({ changelogVersaoLida: versao });
    } catch (error) {
        if (tabelaAusente(error)) {
            return res.status(503).json({
                error: 'A migration de preferências do menu ainda não foi aplicada.',
                codigo: 'MIGRATION_PENDENTE',
            });
        }
        console.error('[preferencias-menu PUT changelog]', error);
        res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao salvar leitura do changelog.',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
