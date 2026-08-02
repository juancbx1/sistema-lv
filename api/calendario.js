// api/calendario.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';

const router = express.Router();
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const SECRET_KEY = process.env.JWT_SECRET;

router.use((req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token ausente.' });
        req.usuarioLogado = jwt.verify(authHeader.split(' ')[1], SECRET_KEY);
        next();
    } catch {
        res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
});

const tiposDoVinculo = (req) => req.vinculoEmpresa?.tipos || req.usuarioLogado?.tipos || [];
const isAdminOuSupervisor = (req) =>
    tiposDoVinculo(req).some(t => ['administrador', 'supervisor'].includes(t));

async function validarFuncionarioDaEmpresa(dbClient, funcionarioId, empresaId) {
    if (funcionarioId == null || funcionarioId === '') return true;
    const funcionarioIdNormalizado = Number.parseInt(funcionarioId, 10);
    if (!Number.isInteger(funcionarioIdNormalizado) || funcionarioIdNormalizado <= 0) return false;
    const result = await dbClient.query(
        `SELECT 1
           FROM usuarios_empresas
          WHERE usuario_id = $1
            AND empresa_id = $2
            AND ativo`,
        [funcionarioIdNormalizado, empresaId]
    );
    return result.rows.length > 0;
}

// ─── GET / — lista eventos num intervalo ───────────────────────────────────
router.get('/', async (req, res) => {
    const empresaId = req.empresaId;
    const { inicio, fim, contexto, funcionario_id } = req.query;
    if (!inicio || !fim) return res.status(400).json({ error: 'Parâmetros inicio e fim são obrigatórios.' });

    let dbClient;
    try {
        dbClient = await pool.connect();
        const isAdmin = isAdminOuSupervisor(req);
        const filtroVisivel  = contexto === 'dashboard' ? 'AND visivel_dashboard = true' : '';
        const params = [inicio, fim, empresaId];
        let proximoParametro = 4;
        const filtroFunc = isAdmin
            ? ''
            : `AND (c.funcionario_id IS NULL OR c.funcionario_id = $${proximoParametro++})`;
        if (!isAdmin) params.push(req.usuarioLogado.id);

        let filtroFuncParam = '';
        if (funcionario_id) {
            const funcionarioId = Number.parseInt(funcionario_id, 10);
            if (!Number.isInteger(funcionarioId) || funcionarioId <= 0) {
                return res.status(400).json({ error: 'funcionario_id inválido.' });
            }
            filtroFuncParam = `AND (c.funcionario_id IS NULL OR c.funcionario_id = $${proximoParametro++})`;
            params.push(funcionarioId);
        }

        const result = await dbClient.query(`
            SELECT c.id, c.data, c.tipo, c.funcionario_id, c.descricao,
                   c.conta_como_dia_util_pagamento, c.visivel_dashboard, c.criado_em,
                   u.nome AS funcionario_nome
            FROM calendario_empresa c
            LEFT JOIN usuarios u ON u.id = c.funcionario_id
            WHERE c.empresa_id = $3
              AND c.data BETWEEN $1 AND $2
            ${filtroVisivel} ${filtroFunc} ${filtroFuncParam}
            ORDER BY c.data ASC
        `, params);

        res.json(result.rows);
    } catch (err) {
        console.error('[Calendário GET /]', err);
        res.status(500).json({ error: 'Erro ao buscar eventos.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ─── GET /dias-uteis — conta dias úteis descontando feriados ───────────────
router.get('/dias-uteis', async (req, res) => {
    const empresaId = req.empresaId;
    const { inicio, fim, funcionario_id, conta_sabado } = req.query;
    if (!inicio || !fim) return res.status(400).json({ error: 'Parâmetros inicio e fim são obrigatórios.' });

    const contarSabado = conta_sabado === 'true';
    let dbClient;
    try {
        dbClient = await pool.connect();

        const eventosRes = await dbClient.query(`
            SELECT data FROM calendario_empresa
            WHERE empresa_id = $3
              AND data BETWEEN $1 AND $2
              AND tipo IN ('feriado_nacional', 'feriado_regional', 'folga_empresa', 'falta')
              AND (funcionario_id IS NULL OR funcionario_id = $4)
        `, [inicio, fim, empresaId, funcionario_id || null]);

        const datasExcluidas = new Set(
            eventosRes.rows.map(r => {
                const d = new Date(r.data);
                return d.toISOString().slice(0, 10);
            })
        );

        let count = 0;
        let cursor = new Date(inicio + 'T12:00:00Z');
        const fimDate = new Date(fim + 'T12:00:00Z');

        while (cursor <= fimDate) {
            const dow = cursor.getUTCDay();
            const dateStr = cursor.toISOString().slice(0, 10);
            if (dow !== 0 && (!( dow === 6) || contarSabado) && !datasExcluidas.has(dateStr)) {
                count++;
            }
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        res.json({ diasUteis: count, inicio, fim, contarSabado });
    } catch (err) {
        console.error('[Calendário GET /dias-uteis]', err);
        res.status(500).json({ error: 'Erro ao calcular dias úteis.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ─── GET /proximo-dia-util-pagamento — 5º dia útil (Seg–Sab) do mês ───────
router.get('/proximo-dia-util-pagamento', async (req, res) => {
    const empresaId = req.empresaId;
    const { mes } = req.query; // "2026-04"
    if (!mes) return res.status(400).json({ error: 'Parâmetro mes obrigatório (YYYY-MM).' });

    const [ano, mesNum] = mes.split('-').map(Number);
    const primeiroDia   = new Date(Date.UTC(ano, mesNum, 1));     // 1º do mês seguinte
    const ultimoDia     = new Date(Date.UTC(ano, mesNum + 1, 0)); // último dia do mês seguinte
    const inicioStr     = primeiroDia.toISOString().slice(0, 10);
    const fimStr        = ultimoDia.toISOString().slice(0, 10);

    let dbClient;
    try {
        dbClient = await pool.connect();

        const eventosRes = await dbClient.query(`
            SELECT data FROM calendario_empresa
            WHERE empresa_id = $3
              AND data BETWEEN $1 AND $2
              AND tipo IN ('feriado_nacional', 'feriado_regional', 'folga_empresa')
              AND funcionario_id IS NULL
        `, [inicioStr, fimStr, empresaId]);

        const datasExcluidas = new Set(
            eventosRes.rows.map(r => new Date(r.data).toISOString().slice(0, 10))
        );

        let diasContados = 0;
        let cursor = new Date(primeiroDia);

        while (diasContados < 5) {
            const dow = cursor.getUTCDay();
            const dateStr = cursor.toISOString().slice(0, 10);
            // CLT Art.459: Seg–Sab contam (domingo não)
            if (dow !== 0 && !datasExcluidas.has(dateStr)) {
                diasContados++;
                if (diasContados === 5) break;
            }
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        const dataPagamento = cursor.toISOString().slice(0, 10);
        const dataFormatada = new Date(dataPagamento + 'T12:00:00Z')
            .toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

        res.json({ dataPagamento, dataFormatada, mesReferencia: mes });
    } catch (err) {
        console.error('[Calendário GET /proximo-dia-util-pagamento]', err);
        res.status(500).json({ error: 'Erro ao calcular data de pagamento.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ─── POST / — cria evento (admin/supervisor) ──────────────────────────────
router.post('/', async (req, res) => {
    const empresaId = req.empresaId;
    if (!isAdminOuSupervisor(req)) return res.status(403).json({ error: 'Sem permissão.' });

    const { data, tipo, funcionario_id, descricao, conta_como_dia_util_pagamento, visivel_dashboard } = req.body;
    if (!data || !tipo || !descricao) return res.status(400).json({ error: 'Campos obrigatórios: data, tipo, descricao.' });

    let dbClient;
    try {
        dbClient = await pool.connect();
        if (!(await validarFuncionarioDaEmpresa(dbClient, funcionario_id, empresaId))) {
            return res.status(404).json({ error: 'Funcionário não encontrado na empresa ativa.' });
        }
        const result = await dbClient.query(`
            INSERT INTO calendario_empresa
                (empresa_id, data, tipo, funcionario_id, descricao, conta_como_dia_util_pagamento, visivel_dashboard, criado_por)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [
            empresaId,
            data,
            tipo,
            funcionario_id || null,
            descricao,
            conta_como_dia_util_pagamento ?? false,
            visivel_dashboard ?? true,
            req.usuarioLogado.id,
        ]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Já existe um evento desse tipo nessa data para esse funcionário.' });
        console.error('[Calendário POST /]', err);
        res.status(500).json({ error: 'Erro ao criar evento.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ─── PUT /:id — edita evento (admin/supervisor) ───────────────────────────
router.put('/:id', async (req, res) => {
    const empresaId = req.empresaId;
    if (!isAdminOuSupervisor(req)) return res.status(403).json({ error: 'Sem permissão.' });

    const { id } = req.params;
    const { data, tipo, funcionario_id, descricao, conta_como_dia_util_pagamento, visivel_dashboard } = req.body;

    let dbClient;
    try {
        dbClient = await pool.connect();
        if (!(await validarFuncionarioDaEmpresa(dbClient, funcionario_id, empresaId))) {
            return res.status(404).json({ error: 'Funcionário não encontrado na empresa ativa.' });
        }
        const result = await dbClient.query(`
            UPDATE calendario_empresa
            SET data = $1, tipo = $2, funcionario_id = $3, descricao = $4,
                conta_como_dia_util_pagamento = $5, visivel_dashboard = $6
            WHERE id = $7
              AND empresa_id = $8
            RETURNING *
        `, [data, tipo, funcionario_id || null, descricao, conta_como_dia_util_pagamento ?? false, visivel_dashboard ?? true, id, empresaId]);

        if (result.rowCount === 0) return res.status(404).json({ error: 'Evento não encontrado.' });
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Conflito: já existe um evento desse tipo nessa data.' });
        console.error('[Calendário PUT /:id]', err);
        res.status(500).json({ error: 'Erro ao atualizar evento.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ─── DELETE /:id — remove evento (admin/supervisor) ───────────────────────
router.delete('/:id', async (req, res) => {
    const empresaId = req.empresaId;
    if (!isAdminOuSupervisor(req)) return res.status(403).json({ error: 'Sem permissão.' });

    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(
            'DELETE FROM calendario_empresa WHERE id = $1 AND empresa_id = $2 RETURNING id',
            [req.params.id, empresaId]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Evento não encontrado.' });
        res.json({ ok: true });
    } catch (err) {
        console.error('[Calendário DELETE /:id]', err);
        res.status(500).json({ error: 'Erro ao deletar evento.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
