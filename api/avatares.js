import express from 'express';
import multer from 'multer';
import { put, del } from '@vercel/blob';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        if (!file.mimetype?.startsWith('image/')) {
            return callback(new Error('Envie somente arquivos de imagem.'));
        }
        callback(null, true);
    },
});

function usuarioIdDoContexto(req) {
    const usuarioId = Number(req.usuarioLogado?.id);
    if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) {
        const error = new Error('Acesso não autorizado.');
        error.statusCode = 401;
        throw error;
    }
    return usuarioId;
}

router.get('/', async (req, res) => {
    let dbClient;
    try {
        const usuarioId = usuarioIdDoContexto(req);
        dbClient = await pool.connect();
        const result = await dbClient.query(
            `
                SELECT id, url_blob, ativo
                FROM avatares_usuarios
                WHERE id_usuario = $1
                ORDER BY ativo DESC, data_criacao DESC
            `,
            [usuarioId]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[avatares GET]', error);
        res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao buscar fotos.',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.post('/upload', (req, res, next) => {
    upload.single('foto')(req, res, (error) => {
        if (error) {
            return res.status(400).json({
                error: error.code === 'LIMIT_FILE_SIZE'
                    ? 'A imagem deve ter no máximo 8 MB.'
                    : error.message || 'Arquivo inválido.',
            });
        }
        next();
    });
}, async (req, res) => {
    let dbClient;
    let blob;
    try {
        const usuarioId = usuarioIdDoContexto(req);
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhuma imagem foi recebida.' });
        }

        dbClient = await pool.connect();
        const quantidade = await dbClient.query(
            'SELECT COUNT(*)::integer AS total FROM avatares_usuarios WHERE id_usuario = $1',
            [usuarioId]
        );
        if (quantidade.rows[0].total >= 3) {
            return res.status(409).json({
                error: 'Você já possui três fotos. Exclua uma para adicionar outra.',
            });
        }

        blob = await put(
            `avatares/usuario-${usuarioId}-${Date.now()}.jpg`,
            req.file.buffer,
            { access: 'public', contentType: req.file.mimetype }
        );
        const result = await dbClient.query(
            `
                INSERT INTO avatares_usuarios (id_usuario, url_blob, ativo)
                VALUES ($1, $2, FALSE)
                RETURNING id, url_blob, ativo
            `,
            [usuarioId, blob.url]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (blob?.url) {
            try {
                await del(blob.url);
            } catch (blobError) {
                console.error('[avatares upload rollback blob]', blobError);
            }
        }
        console.error('[avatares POST upload]', error);
        res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao enviar a foto.',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.put('/definir-ativo/:id', async (req, res) => {
    let dbClient;
    try {
        const usuarioId = usuarioIdDoContexto(req);
        const avatarId = Number(req.params.id);
        if (!Number.isSafeInteger(avatarId) || avatarId <= 0) {
            return res.status(400).json({ error: 'Foto inválida.' });
        }

        dbClient = await pool.connect();
        await dbClient.query('BEGIN');
        const avatarResult = await dbClient.query(
            `
                SELECT id, url_blob
                FROM avatares_usuarios
                WHERE id = $1
                  AND id_usuario = $2
                FOR UPDATE
            `,
            [avatarId, usuarioId]
        );
        const avatar = avatarResult.rows[0];
        if (!avatar) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Foto não encontrada.' });
        }

        await dbClient.query(
            'UPDATE avatares_usuarios SET ativo = FALSE WHERE id_usuario = $1',
            [usuarioId]
        );
        await dbClient.query(
            'UPDATE avatares_usuarios SET ativo = TRUE WHERE id = $1 AND id_usuario = $2',
            [avatarId, usuarioId]
        );
        await dbClient.query(
            'UPDATE usuarios SET avatar_url = $1 WHERE id = $2',
            [avatar.url_blob, usuarioId]
        );
        await dbClient.query('COMMIT');
        res.status(200).json({ success: true, newAvatarUrl: avatar.url_blob });
    } catch (error) {
        if (dbClient) {
            try {
                await dbClient.query('ROLLBACK');
            } catch {}
        }
        console.error('[avatares PUT definir ativo]', error);
        res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao atualizar a foto.',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.delete('/:id', async (req, res) => {
    let dbClient;
    let avatar;
    try {
        const usuarioId = usuarioIdDoContexto(req);
        const avatarId = Number(req.params.id);
        if (!Number.isSafeInteger(avatarId) || avatarId <= 0) {
            return res.status(400).json({ error: 'Foto inválida.' });
        }

        dbClient = await pool.connect();
        await dbClient.query('BEGIN');
        const result = await dbClient.query(
            `
                SELECT id, url_blob, ativo
                FROM avatares_usuarios
                WHERE id = $1
                  AND id_usuario = $2
                FOR UPDATE
            `,
            [avatarId, usuarioId]
        );
        avatar = result.rows[0];
        if (!avatar) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Foto não encontrada.' });
        }

        await dbClient.query(
            'DELETE FROM avatares_usuarios WHERE id = $1 AND id_usuario = $2',
            [avatarId, usuarioId]
        );
        if (avatar.ativo) {
            await dbClient.query(
                'UPDATE usuarios SET avatar_url = $1 WHERE id = $2',
                [process.env.DEFAULT_AVATAR_URL || null, usuarioId]
            );
        }
        await dbClient.query('COMMIT');

        try {
            await del(avatar.url_blob);
        } catch (blobError) {
            console.error('[avatares DELETE blob]', blobError);
        }

        res.status(200).json({
            success: true,
            avatarUrlCleared: Boolean(avatar.ativo),
        });
    } catch (error) {
        if (dbClient) {
            try {
                await dbClient.query('ROLLBACK');
            } catch {}
        }
        console.error('[avatares DELETE]', error);
        res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao excluir a foto.',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
