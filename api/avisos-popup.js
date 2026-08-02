// api/avisos-popup.js
import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { put, del, list } from '@vercel/blob';

const { Pool } = pg;
const router = express.Router();
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const SECRET_KEY = process.env.JWT_SECRET;

// Multer: mantém arquivo em memória para enviar ao Vercel Blob
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB (compressão já foi feita no browser)
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Formato não suportado. Use JPG, PNG ou WebP.'));
        }
    },
});

// ---------------------------------------------------------------------------
// Middleware de autenticação
// ---------------------------------------------------------------------------
router.use((req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) throw new Error('Token não fornecido');
        const token = authHeader.split(' ')[1];
        req.usuarioLogado = jwt.verify(token, SECRET_KEY);
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Monta a cláusula WHERE de destinatários para a query de pendentes.
 * Retorna { clause, params } para ser interpolado na query principal.
 */
function buildDestinatariosClause(tipo, userId, startParamIndex) {
    // tipo = string do tipo do usuário logado (ex: 'costureira')
    // Retorna SQL que adiciona ao WHERE existente
    return `(
        ap.destinatarios = 'todos'
        OR (ap.destinatarios = 'costureiras' AND $${startParamIndex} = 'costureira')
        OR (ap.destinatarios = 'tiktiks'     AND $${startParamIndex} = 'tiktik')
        OR (ap.destinatarios = 'individuais' AND $${startParamIndex + 1} = ANY(ap.ids_individuais))
    )`;
}

// ---------------------------------------------------------------------------
// ROTA: GET /api/avisos-popup/pendentes
// Retorna avisos não vistos pelo usuário logado.
// Usado pela dashboard das funcionárias.
// ---------------------------------------------------------------------------
router.get('/pendentes', async (req, res) => {
    const empresaId = req.empresaId;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const userId = req.usuarioLogado.id;
        const tipos = req.vinculoEmpresa?.tipos || req.usuarioLogado.tipos || [];
        // Pega o primeiro tipo relevante (costureira, tiktik, etc.)
        const tipoUsuario = Array.isArray(tipos) ? (tipos[0] || '') : tipos;

        const result = await dbClient.query(
            `SELECT ap.id, ap.titulo, ap.tipo, ap.mensagem, ap.url_imagem,
                    ap.cor_fundo, ap.urgente, ap.criado_em
             FROM avisos_popup ap
             WHERE ap.ativo = TRUE
               AND ap.data_inicio <= CURRENT_DATE
               AND (ap.data_fim IS NULL OR ap.data_fim >= CURRENT_DATE)
               AND (
                   ap.destinatarios = 'todos'
                   OR (ap.destinatarios = 'costureiras' AND $1 = 'costureira')
                   OR (ap.destinatarios = 'tiktiks'     AND $1 = 'tiktik')
                   OR (ap.destinatarios = 'individuais' AND $2 = ANY(ap.ids_individuais))
               )
               AND ap.id NOT IN (
                   SELECT aviso_id
                   FROM avisos_popup_visualizacoes
                   WHERE usuario_id = $2
                     AND empresa_id = $3
               )
               AND ap.empresa_id = $3
             ORDER BY ap.urgente DESC, ap.criado_em DESC`,
            [tipoUsuario, userId, empresaId]
        );

        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[API /avisos-popup/pendentes GET] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar avisos pendentes.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// ROTA: POST /api/avisos-popup/:id/marcar-visto
// Registra que o usuário logado visualizou/dispensou o aviso.
// Usado pela dashboard ao fechar o popup.
// ---------------------------------------------------------------------------
router.post('/:id/marcar-visto', async (req, res) => {
    const empresaId = req.empresaId;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const avisoId = parseInt(req.params.id, 10);
        const userId = req.usuarioLogado.id;

        if (isNaN(avisoId)) {
            return res.status(400).json({ error: 'ID de aviso inválido.' });
        }

        const avisoRes = await dbClient.query(
            'SELECT id FROM avisos_popup WHERE id = $1 AND empresa_id = $2',
            [avisoId, empresaId]
        );
        if (!avisoRes.rows.length) return res.status(404).json({ error: 'Aviso não encontrado.' });

        // INSERT com ON CONFLICT para ser idempotente (double-tap seguro)
        await dbClient.query(
            `INSERT INTO avisos_popup_visualizacoes (empresa_id, aviso_id, usuario_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (empresa_id, aviso_id, usuario_id) DO NOTHING`,
            [empresaId, avisoId, userId]
        );

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[API /avisos-popup/:id/marcar-visto POST] Erro:', error);
        res.status(500).json({ error: 'Erro ao registrar visualização.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// ROTA: GET /api/avisos-popup/
// Lista todos os avisos para o painel admin, com stats de visualização.
// Apenas admins.
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
    const empresaId = req.empresaId;

    let dbClient;
    try {
        dbClient = await pool.connect();

        const result = await dbClient.query(
            `SELECT
                ap.id,
                ap.titulo,
                ap.tipo,
                ap.mensagem,
                ap.url_imagem,
                ap.cor_fundo,
                ap.destinatarios,
                ap.ids_individuais,
                ap.urgente,
                ap.ativo,
                ap.is_template,
                ap.data_inicio,
                ap.data_fim,
                ap.criado_por,
                ap.criado_em,
                u.nome AS criado_por_nome,
                -- Total de usuários elegíveis (exclui admins e usuários de teste)
                (
                    SELECT COUNT(*)
                    FROM usuarios ue
                    JOIN usuarios_empresas ue_empresa
                      ON ue_empresa.usuario_id = ue.id
                     AND ue_empresa.empresa_id = $1
                     AND ue_empresa.ativo
                    WHERE (ue.is_test IS FALSE OR ue.is_test IS NULL)
                      AND ue_empresa.data_demissao IS NULL
                      AND (
                          ap.destinatarios = 'todos'
                          OR (ap.destinatarios = 'costureiras' AND 'costureira' = ANY(ue_empresa.tipos))
                          OR (ap.destinatarios = 'tiktiks'     AND 'tiktik'     = ANY(ue_empresa.tipos))
                          OR (ap.destinatarios = 'individuais' AND ue.id = ANY(ap.ids_individuais))
                      )
                ) AS total_destinatarios,
                -- Total que já visualizou
                (
                    SELECT COUNT(*)
                    FROM avisos_popup_visualizacoes apv
                    WHERE apv.aviso_id = ap.id
                      AND apv.empresa_id = ap.empresa_id
                  ) AS total_visualizacoes
             FROM avisos_popup ap
             LEFT JOIN usuarios u ON u.id = ap.criado_por
             WHERE ap.empresa_id = $1
             ORDER BY
                ap.is_template ASC,
                ap.ativo DESC,
                ap.urgente DESC,
            ap.criado_em DESC`,
            [empresaId]
        );

        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[API /avisos-popup GET] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar avisos.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// ROTA: GET /api/avisos-popup/:id/visualizacoes
// Retorna quem já visualizou e quem ainda não visualizou um aviso.
// Usado pelo painel admin para acompanhamento gerencial.
// ---------------------------------------------------------------------------
router.get('/:id/visualizacoes', async (req, res) => {
    const empresaId = req.empresaId;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const avisoId = parseInt(req.params.id, 10);
        if (isNaN(avisoId)) return res.status(400).json({ error: 'ID inválido.' });

        // Busca o aviso para saber os destinatários
        const { rows: [aviso] } = await dbClient.query(
            'SELECT destinatarios, ids_individuais FROM avisos_popup WHERE id = $1 AND empresa_id = $2',
            [avisoId, empresaId]
        );
        if (!aviso) return res.status(404).json({ error: 'Aviso não encontrado.' });

        // Busca todos que visualizaram
        const visResult = await dbClient.query(
            `SELECT u.id, u.nome, apv.visto_em
             FROM avisos_popup_visualizacoes apv
             JOIN usuarios u ON u.id = apv.usuario_id
             WHERE apv.aviso_id = $1
               AND apv.empresa_id = $2
             ORDER BY apv.visto_em ASC`,
            [avisoId, empresaId]
        );

        // Busca todos os destinatários elegíveis que AINDA NÃO viram
        const naoVisResult = await dbClient.query(
            `SELECT u.id, u.nome
             FROM usuarios u
             JOIN usuarios_empresas ue
               ON ue.usuario_id = u.id
              AND ue.empresa_id = $3
              AND ue.ativo
             WHERE (u.is_test IS FALSE OR u.is_test IS NULL)
               AND ue.data_demissao IS NULL
               AND (
                   $1 = 'todos'
                   OR ($1 = 'costureiras' AND 'costureira' = ANY(ue.tipos))
                   OR ($1 = 'tiktiks'     AND 'tiktik'     = ANY(ue.tipos))
                   OR ($1 = 'individuais' AND u.id = ANY($2::int[]))
               )
               AND u.id NOT IN (
                   SELECT usuario_id
                   FROM avisos_popup_visualizacoes
                   WHERE aviso_id = $4
                     AND empresa_id = $3
               )
             ORDER BY u.nome ASC`,
            [aviso.destinatarios, aviso.ids_individuais, empresaId, avisoId]
        );

        res.status(200).json({
            visualizaram: visResult.rows,
            nao_visualizaram: naoVisResult.rows,
        });
    } catch (error) {
        console.error('[API /avisos-popup/:id/visualizacoes GET] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar visualizações.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// ROTA: POST /api/avisos-popup/upload-imagem
// Recebe uma imagem já comprimida pelo browser e envia ao Vercel Blob.
// Retorna { url } para ser salva no campo url_imagem do aviso.
// Apenas admins.
// ---------------------------------------------------------------------------
router.post('/upload-imagem', upload.single('imagem'), async (req, res) => {
    const empresaId = req.empresaId;
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo recebido.' });
    }

    try {
        const ext = req.file.mimetype === 'image/webp' ? 'webp'
                  : req.file.mimetype === 'image/png'  ? 'png'
                  : 'jpg';
        const nomeArquivo = `avisos-popup/empresa-${empresaId}/aviso-${Date.now()}.${ext}`;

        const blob = await put(nomeArquivo, req.file.buffer, {
            access: 'public',
            contentType: req.file.mimetype,
        });

        res.status(201).json({ url: blob.url });
    } catch (error) {
        console.error('[API /avisos-popup/upload-imagem POST] Erro:', error);
        res.status(500).json({ error: 'Erro ao fazer upload da imagem.' });
    }
});

// ---------------------------------------------------------------------------
// ROTA: POST /api/avisos-popup/
// Cria um novo aviso. Apenas admins.
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
    const empresaId = req.empresaId;

    let dbClient;
    try {
        dbClient = await pool.connect();
        const {
            titulo,
            tipo,
            mensagem,
            url_imagem,
            cor_fundo = 'azul',
            destinatarios = 'todos',
            ids_individuais = [],
            urgente = false,
            ativo = true,
            is_template = false,
            data_inicio,
            data_fim,
        } = req.body;

        // Validações básicas
        if (!titulo || !tipo) {
            return res.status(400).json({ error: 'Campos obrigatórios: titulo, tipo.' });
        }
        if (!['texto', 'imagem', 'misto'].includes(tipo)) {
            return res.status(400).json({ error: 'Tipo inválido. Use: texto, imagem, misto.' });
        }
        if (!['todos', 'costureiras', 'tiktiks', 'individuais'].includes(destinatarios)) {
            return res.status(400).json({ error: 'Destinatários inválido.' });
        }
        if ((tipo === 'imagem' || tipo === 'misto') && !url_imagem) {
            return res.status(400).json({ error: 'url_imagem é obrigatória para tipo imagem ou misto.' });
        }

        // Templates nunca ficam ativos (não aparecem para funcionárias)
        const ativoFinal = is_template ? false : ativo;

        const result = await dbClient.query(
            `INSERT INTO avisos_popup
                (empresa_id, titulo, tipo, mensagem, url_imagem, cor_fundo, destinatarios,
                 ids_individuais, urgente, ativo, is_template, data_inicio, data_fim, criado_por)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             RETURNING *`,
            [
                empresaId,
                titulo,
                tipo,
                mensagem || null,
                url_imagem || null,
                cor_fundo,
                destinatarios,
                ids_individuais,
                urgente,
                ativoFinal,
                is_template,
                data_inicio || new Date().toISOString().split('T')[0],
                data_fim || null,
                req.usuarioLogado.id,
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('[API /avisos-popup POST] Erro:', error);
        res.status(500).json({ error: 'Erro ao criar aviso.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// ROTA: PUT /api/avisos-popup/:id
// Edita um aviso existente. Apenas admins.
// Se a imagem mudar (nova url_imagem diferente da atual), deleta a antiga do Blob.
// ---------------------------------------------------------------------------
router.put('/:id', async (req, res) => {
    const empresaId = req.empresaId;

    let dbClient;
    try {
        dbClient = await pool.connect();
        const avisoId = parseInt(req.params.id, 10);
        if (isNaN(avisoId)) return res.status(400).json({ error: 'ID inválido.' });

        // Buscar aviso atual para comparar url_imagem
        const { rows: [atual] } = await dbClient.query(
            'SELECT url_imagem FROM avisos_popup WHERE id = $1 AND empresa_id = $2',
            [avisoId, empresaId]
        );
        if (!atual) return res.status(404).json({ error: 'Aviso não encontrado.' });

        const {
            titulo,
            tipo,
            mensagem,
            url_imagem,
            cor_fundo,
            destinatarios,
            ids_individuais,
            urgente,
            ativo,
            is_template,
            data_inicio,
            data_fim,
        } = req.body;

        // Templates nunca ficam ativos
        const ativoFinal = is_template === true ? false : (ativo ?? null);

        const result = await dbClient.query(
            `UPDATE avisos_popup SET
                titulo          = COALESCE($1, titulo),
                tipo            = COALESCE($2, tipo),
                mensagem        = $3,
                url_imagem      = $4,
                cor_fundo       = COALESCE($5, cor_fundo),
                destinatarios   = COALESCE($6, destinatarios),
                ids_individuais = COALESCE($7, ids_individuais),
                urgente         = COALESCE($8, urgente),
                ativo           = COALESCE($9, ativo),
                is_template     = COALESCE($10, is_template),
                data_inicio     = COALESCE($11, data_inicio),
                data_fim        = $12
             WHERE id = $13
               AND empresa_id = $14
             RETURNING *`,
            [
                titulo || null,
                tipo || null,
                mensagem ?? null,
                url_imagem ?? null,
                cor_fundo || null,
                destinatarios || null,
                ids_individuais || null,
                urgente ?? null,
                ativoFinal,
                is_template ?? null,
                data_inicio || null,
                data_fim ?? null,
                avisoId,
                empresaId,
            ]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Aviso não encontrado.' });
        }

        // Se a imagem mudou (e havia uma antiga no Vercel Blob), deletar a antiga
        if (
            url_imagem !== undefined &&
            atual.url_imagem &&
            atual.url_imagem !== url_imagem &&
            atual.url_imagem.includes('vercel-storage.com')
        ) {
            try {
                await del(atual.url_imagem);
            } catch (blobErr) {
                // Não bloquear a resposta por falha no cleanup do Blob
                console.warn('[API /avisos-popup PUT] Falha ao deletar imagem antiga do Blob:', blobErr.message);
            }
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('[API /avisos-popup/:id PUT] Erro:', error);
        res.status(500).json({ error: 'Erro ao editar aviso.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// ROTA: PUT /api/avisos-popup/:id/toggle-ativo
// Ativa ou desativa um aviso sem precisar enviar todos os campos.
// Apenas admins.
// ---------------------------------------------------------------------------
router.put('/:id/toggle-ativo', async (req, res) => {
    const empresaId = req.empresaId;

    let dbClient;
    try {
        dbClient = await pool.connect();
        const avisoId = parseInt(req.params.id, 10);
        if (isNaN(avisoId)) return res.status(400).json({ error: 'ID inválido.' });

        const result = await dbClient.query(
            `UPDATE avisos_popup
             SET ativo = NOT ativo
             WHERE id = $1
               AND empresa_id = $2
             RETURNING id, ativo`,
            [avisoId, empresaId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Aviso não encontrado.' });
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('[API /avisos-popup/:id/toggle-ativo PUT] Erro:', error);
        res.status(500).json({ error: 'Erro ao alterar status do aviso.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// ROTA: DELETE /api/avisos-popup/:id
// Deleta aviso e suas visualizações (CASCADE). Se tiver imagem no Blob, deleta também.
// Apenas admins.
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
    const empresaId = req.empresaId;

    let dbClient;
    try {
        dbClient = await pool.connect();
        const avisoId = parseInt(req.params.id, 10);
        if (isNaN(avisoId)) return res.status(400).json({ error: 'ID inválido.' });

        // Buscar url_imagem antes de deletar
        const { rows: [aviso] } = await dbClient.query(
            'SELECT url_imagem FROM avisos_popup WHERE id = $1 AND empresa_id = $2',
            [avisoId, empresaId]
        );
        if (!aviso) return res.status(404).json({ error: 'Aviso não encontrado.' });

        // Deletar do banco (CASCADE cuida das visualizações)
        await dbClient.query(
            'DELETE FROM avisos_popup WHERE id = $1 AND empresa_id = $2',
            [avisoId, empresaId]
        );

        // Se tiver imagem no Vercel Blob, deletar
        if (aviso.url_imagem && aviso.url_imagem.includes('vercel-storage.com')) {
            try {
                await del(aviso.url_imagem);
            } catch (blobErr) {
                console.warn('[API /avisos-popup DELETE] Falha ao deletar imagem do Blob:', blobErr.message);
            }
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[API /avisos-popup/:id DELETE] Erro:', error);
        res.status(500).json({ error: 'Erro ao deletar aviso.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// ROTA: GET /api/avisos-popup/blob-imagens
// Lista todas as imagens em Vercel Blob com prefixo "avisos-popup/".
// Cruza com a tabela avisos_popup para indicar quais estão em uso.
// ---------------------------------------------------------------------------
router.get('/blob-imagens', async (req, res) => {
    const empresaId = req.empresaId;
    let dbClient;
    try {
        dbClient = await pool.connect();

        // Busca as imagens da empresa no Blob com paginação automática. A
        // empresa legada também consulta o prefixo antigo para preservar os
        // avisos criados antes da adoção do namespace empresarial.
        const blobs = [];
        const prefixEmpresa = `avisos-popup/empresa-${empresaId}/`;
        const prefixes = [prefixEmpresa];
        if (req.empresaAtiva?.eh_legada) prefixes.push('avisos-popup/');
        for (const prefix of prefixes) {
            let cursor;
            do {
                const page = await list({ prefix, cursor, limit: 100 });
                blobs.push(...page.blobs);
                cursor = page.cursor;
            } while (cursor);
        }

        // Busca todas as urls_imagem atualmente referenciadas na tabela
        const { rows: emUso } = await dbClient.query(
            `SELECT url_imagem, titulo, ativo
             FROM avisos_popup
             WHERE empresa_id = $1
               AND url_imagem IS NOT NULL`,
            [empresaId]
        );
        const emUsoMap = new Map(emUso.map(r => [r.url_imagem, r]));

        const blobsUnicos = [...new Map(blobs.map((blob) => [blob.url, blob])).values()];
        const resultado = blobsUnicos
            .filter(b =>
                emUsoMap.has(b.url)
                || b.pathname.startsWith(prefixEmpresa)
                || (req.empresaAtiva?.eh_legada
                    && !/^avisos-popup\/empresa-\d+\//.test(b.pathname))
            )
            .map(b => ({
            url:         b.url,
            pathname:    b.pathname,
            size:        b.size,
            uploadedAt:  b.uploadedAt,
            emUso:       emUsoMap.has(b.url) ? emUsoMap.get(b.url).titulo : null,
            avisoAtivo:  emUsoMap.has(b.url) ? emUsoMap.get(b.url).ativo : false,
            }));

        // Ordena por data desc (mais recente primeiro)
        resultado.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

        res.status(200).json(resultado);
    } catch (error) {
        console.error('[API /avisos-popup/blob-imagens GET] Erro:', error);
        res.status(500).json({ error: 'Erro ao listar imagens.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// ROTA: DELETE /api/avisos-popup/blob-imagens
// Deleta uma imagem específica do Vercel Blob pelo campo url no body.
// Bloqueia se a imagem estiver referenciada por um aviso ativo.
// ---------------------------------------------------------------------------
router.delete('/blob-imagens', async (req, res) => {
    const empresaId = req.empresaId;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const { url } = req.body;

        if (!url || !url.includes('vercel-storage.com')) {
            return res.status(400).json({ error: 'URL inválida.' });
        }

        // Verifica se está em uso por algum aviso ativo
        const { rows } = await dbClient.query(
            `SELECT id, titulo
             FROM avisos_popup
             WHERE url_imagem = $1
               AND empresa_id = $2
               AND ativo = TRUE`,
            [url, empresaId]
        );
        if (rows.length > 0) {
            return res.status(409).json({
                error: `Imagem em uso pelo aviso ativo "${rows[0].titulo}". Desative ou edite o aviso antes de deletar a imagem.`,
            });
        }

        await del(url);

        // Limpa a referência em avisos inativos que ainda apontam para ela
        await dbClient.query(
            `UPDATE avisos_popup
                SET url_imagem = NULL
              WHERE url_imagem = $1
                AND empresa_id = $2`,
            [url, empresaId]
        );

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[API /avisos-popup/blob-imagens DELETE] Erro:', error);
        res.status(500).json({ error: 'Erro ao deletar imagem.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
