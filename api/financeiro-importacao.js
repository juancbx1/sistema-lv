// api/financeiro-importacao.js
// Importação inteligente de extratos (OFX + CSV + XLSX + PDF).
// Montado sob /api/financeiro (herda middleware de auth/permissões).

import express from 'express';
import multer from 'multer';
import pkg from 'pg';
import { parseOfx } from './lib/parse-ofx.js';
import { parseTabularExtrato, previewTabular } from './lib/parse-csv-extrato.js';
import { montarResumo, processarLoteImportacao } from './lib/importacao-processar-lote.js';
import {
    aprenderRegra,
    garantirCategoriasAClassificar,
    NOME_CATEGORIA_A_CLASSIFICAR,
} from './lib/importacao-extrato-helpers.js';

const { Pool } = pkg;
const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    timezone: 'UTC',
});

const EXT_OK = /\.(ofx|ofc|txt|csv|xlsx|xls|pdf)$/i;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const name = String(file.originalname || '');
        if (
            !EXT_OK.test(name)
            && file.mimetype
            && !/ofx|octet|text|csv|sheet|excel|xml|sgml|pdf/i.test(file.mimetype)
        ) {
            return cb(Object.assign(new Error('Formatos aceitos: OFX, CSV, XLSX, PDF.'), { statusCode: 400 }));
        }
        cb(null, true);
    },
});

function erro(statusCode, mensagem) {
    return Object.assign(new Error(mensagem), { statusCode });
}

function exigirPermissaoImportar(req) {
    if (!req.permissoesUsuario?.includes('importar-extrato')) {
        throw erro(403, 'Permissão negada para importar extratos bancários.');
    }
}

async function exigirConta(dbClient, idConta, empresaId) {
    const r = await dbClient.query(
        `SELECT * FROM fc_contas_bancarias WHERE id = $1 AND empresa_id = $2`,
        [idConta, empresaId]
    );
    if (!r.rows[0]) throw erro(404, 'Conta bancária não encontrada no contexto da empresa ativa.');
    return r.rows[0];
}

async function exigirLote(dbClient, idImportacao, empresaId, { forUpdate = false } = {}) {
    const r = await dbClient.query(
        `SELECT * FROM fc_importacoes_extrato
          WHERE id = $1 AND empresa_id = $2
          ${forUpdate ? 'FOR UPDATE' : ''}`,
        [idImportacao, empresaId]
    );
    if (!r.rows[0]) throw erro(404, 'Importação não encontrada no contexto da empresa ativa.');
    return r.rows[0];
}

async function registrarLogImportacao(dbClient, req, acao, detalhes, dadosAlterados = {}) {
    try {
        await dbClient.query(
            `INSERT INTO fc_logs_auditoria
                (id_usuario, nome_usuario, acao, detalhes, dados_alterados, empresa_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [req.usuarioLogado.id, req.usuarioLogado.nome, acao, detalhes, dadosAlterados, req.empresaId]
        );
    } catch (e) {
        console.error('[importacao] falha ao registrar log:', e.message);
    }
}

function detectarFormatoArquivo(nome) {
    const n = String(nome || '').toLowerCase();
    if (n.endsWith('.ofx') || n.endsWith('.ofc')) return 'OFX';
    if (n.endsWith('.xlsx') || n.endsWith('.xls')) return 'XLSX';
    if (n.endsWith('.csv') || n.endsWith('.txt')) return 'CSV';
    if (n.endsWith('.pdf')) return 'PDF';
    return null;
}

function parseMapeamentoBody(body) {
    if (!body?.mapeamento) return null;
    if (typeof body.mapeamento === 'string') {
        try {
            return JSON.parse(body.mapeamento);
        } catch {
            throw erro(400, 'mapeamento JSON inválido.');
        }
    }
    if (typeof body.mapeamento === 'object') return body.mapeamento;
    return null;
}

// O parser PDF carrega pdfjs-dist e dependências nativas de canvas.
// O import sob demanda mantém as demais rotas da API compatíveis com o runtime
// serverless quando a infraestrutura de PDF não está disponível.
async function parsePdfExtratoSobDemanda(buffer, nomeArquivo) {
    const { parsePdfExtrato } = await import('./lib/parse-pdf-extrato.js');
    return parsePdfExtrato(buffer, nomeArquivo);
}

// ---------------------------------------------------------------------------
// POST /importacoes/extrato/preview — colunas + amostra (CSV/XLSX)
// ---------------------------------------------------------------------------
router.post('/importacoes/extrato/preview', (req, res) => {
    upload.single('arquivo')(req, res, async (multerErr) => {
        if (multerErr) {
            return res.status(multerErr.statusCode || 400).json({
                error: multerErr.message || 'Falha no upload.',
            });
        }
        let dbClient;
        try {
            exigirPermissaoImportar(req);
            if (!req.file?.buffer?.length) {
                return res.status(400).json({ error: 'Arquivo obrigatório.' });
            }
            const nome = req.file.originalname || 'extrato.csv';
            const formato = detectarFormatoArquivo(nome);
            if (formato === 'OFX') {
                const parsed = parseOfx(req.file.buffer);
                return res.json({
                    formato: 'OFX',
                    precisa_mapeamento: false,
                    total_linhas_dados: parsed.linhas.length,
                    periodo_inicio: parsed.periodoInicio,
                    periodo_fim: parsed.periodoFim,
                });
            }
            if (formato === 'PDF') {
                const parsed = await parsePdfExtratoSobDemanda(req.file.buffer, nome);
                return res.json({
                    formato: 'PDF',
                    precisa_mapeamento: false,
                    total_linhas_dados: parsed.linhas.length,
                    periodo_inicio: parsed.periodoInicio,
                    periodo_fim: parsed.periodoFim,
                    amostra_linhas: parsed.linhas.slice(0, 5).map((l) => ({
                        data: l.data,
                        valor: l.valor,
                        // Código interno (CREDITO/DEBITO); a UI traduz para Crédito/Débito
                        sentido: l.sentido,
                        descricao: l.descricao,
                    })),
                    aviso: 'PDF é melhor esforço. Confira as linhas na revisão. Preferir OFX/CSV quando possível.',
                });
            }
            if (formato !== 'CSV' && formato !== 'XLSX') {
                return res.status(400).json({ error: 'Preview disponível para CSV, XLSX e PDF. Use OFX direto no importar.' });
            }

            const preview = previewTabular(req.file.buffer, nome);
            dbClient = await pool.connect();
            const idConta = Number(req.body?.id_conta_bancaria) || null;
            const presets = await dbClient.query(
                `SELECT id, nome, formato, mapeamento_json, id_conta_bancaria, uso_count
                   FROM fc_importacao_mapeamentos
                  WHERE empresa_id = $1
                    AND formato = $2
                    AND ($3::int IS NULL OR id_conta_bancaria IS NULL OR id_conta_bancaria = $3)
                  ORDER BY uso_count DESC, atualizado_em DESC
                  LIMIT 10`,
                [req.empresaId, preview.formato, idConta]
            );

            res.json({
                formato: preview.formato,
                precisa_mapeamento: true,
                colunas: preview.colunas,
                amostra: preview.amostra,
                total_linhas_dados: preview.total_linhas_dados,
                mapeamento_sugerido: preview.mapeamento_sugerido,
                presets: presets.rows,
            });
        } catch (error) {
            console.error('[POST preview extrato]', error);
            res.status(error.statusCode || 500).json({
                error: error.statusCode ? error.message : 'Erro no preview do extrato.',
                details: error.statusCode ? undefined : error.message,
            });
        } finally {
            if (dbClient) dbClient.release();
        }
    });
});

// ---------------------------------------------------------------------------
// POST /importacoes/extrato — upload + parse + match (OFX/CSV/XLSX)
// ---------------------------------------------------------------------------
router.post('/importacoes/extrato', (req, res) => {
    upload.single('arquivo')(req, res, async (multerErr) => {
        if (multerErr) {
            return res.status(multerErr.statusCode || 400).json({
                error: multerErr.message || 'Falha no upload do arquivo.',
            });
        }

        let dbClient;
        try {
            exigirPermissaoImportar(req);

            const idConta = Number(req.body?.id_conta_bancaria);
            if (!Number.isSafeInteger(idConta) || idConta <= 0) {
                return res.status(400).json({ error: 'Informe a conta bancária (id_conta_bancaria).' });
            }
            if (!req.file?.buffer?.length) {
                return res.status(400).json({ error: 'Arquivo de extrato obrigatório.' });
            }

            const nomeArquivo = req.file.originalname || 'extrato';
            let formato = detectarFormatoArquivo(nomeArquivo) || String(req.body?.formato || '').toUpperCase();
            if (!['OFX', 'CSV', 'XLSX', 'PDF'].includes(formato)) {
                // tenta sniff
                const head = req.file.buffer.slice(0, 200).toString('utf8');
                if (head.startsWith('%PDF')) formato = 'PDF';
                else if (/OFXHEADER|<OFX/i.test(head)) formato = 'OFX';
                else if (req.file.buffer[0] === 0x50 && req.file.buffer[1] === 0x4b) formato = 'XLSX';
                else formato = 'CSV';
            }

            let parsed;
            let mapeamento = null;
            if (formato === 'OFX') {
                parsed = parseOfx(req.file.buffer);
            } else if (formato === 'PDF') {
                parsed = await parsePdfExtratoSobDemanda(req.file.buffer, nomeArquivo);
            } else {
                mapeamento = parseMapeamentoBody(req.body);
                if (!mapeamento) {
                    return res.status(400).json({
                        error: 'CSV/XLSX exigem mapeamento de colunas. Use /importacoes/extrato/preview primeiro.',
                        code: 'MAPEAMENTO_OBRIGATORIO',
                    });
                }
                parsed = parseTabularExtrato(req.file.buffer, nomeArquivo, mapeamento);
                formato = parsed.formato || formato;
            }

            dbClient = await pool.connect();
            await dbClient.query('BEGIN');
            await exigirConta(dbClient, idConta, req.empresaId);

            const resultado = await processarLoteImportacao({
                dbClient,
                empresaId: req.empresaId,
                idUsuario: req.usuarioLogado.id,
                idConta,
                formato,
                nomeArquivo,
                fileBuffer: req.file.buffer,
                parsed,
                mapeamento,
            });

            // Incrementa uso do preset se informado
            const idPreset = Number(req.body?.id_mapeamento_preset);
            if (Number.isSafeInteger(idPreset) && idPreset > 0) {
                await dbClient.query(
                    `UPDATE fc_importacao_mapeamentos
                        SET uso_count = uso_count + 1, atualizado_em = NOW()
                      WHERE id = $1 AND empresa_id = $2`,
                    [idPreset, req.empresaId]
                );
            } else if (mapeamento && req.body?.salvar_preset === '1' && req.body?.nome_preset) {
                const nomePreset = String(req.body.nome_preset).slice(0, 80);
                const existe = await dbClient.query(
                    `SELECT id FROM fc_importacao_mapeamentos
                      WHERE empresa_id = $1 AND lower(nome) = lower($2)
                      LIMIT 1`,
                    [req.empresaId, nomePreset]
                );
                if (existe.rows[0]) {
                    await dbClient.query(
                        `UPDATE fc_importacao_mapeamentos
                            SET mapeamento_json = $1::jsonb,
                                formato = $2,
                                id_conta_bancaria = $3,
                                uso_count = uso_count + 1,
                                atualizado_em = NOW()
                          WHERE id = $4 AND empresa_id = $5`,
                        [JSON.stringify(mapeamento), formato, idConta, existe.rows[0].id, req.empresaId]
                    );
                } else {
                    await dbClient.query(
                        `INSERT INTO fc_importacao_mapeamentos
                            (empresa_id, nome, formato, mapeamento_json, id_conta_bancaria, uso_count)
                         VALUES ($1, $2, $3, $4::jsonb, $5, 1)`,
                        [req.empresaId, nomePreset, formato, JSON.stringify(mapeamento), idConta]
                    );
                }
            }

            await registrarLogImportacao(
                dbClient,
                req,
                'IMPORTACAO_EXTRATO',
                `Importou extrato ${formato} "${nomeArquivo}" com ${resultado.linhas.length} linha(s) na conta #${idConta}.`,
                { depois: { lote: resultado.importacao, resumo: resultado.resumo } }
            );

            await dbClient.query('COMMIT');
            res.status(201).json(resultado);
        } catch (error) {
            if (dbClient) await dbClient.query('ROLLBACK');
            console.error('[POST /importacoes/extrato]', error);
            res.status(error.statusCode || 500).json({
                error: error.statusCode ? error.message : 'Erro ao importar extrato.',
                details: error.statusCode ? undefined : error.message,
            });
        } finally {
            if (dbClient) dbClient.release();
        }
    });
});

// ---------------------------------------------------------------------------
// GET /importacoes/extrato — lista lotes recentes
// ---------------------------------------------------------------------------
router.get('/importacoes/extrato', async (req, res) => {
    let dbClient;
    try {
        if (
            !req.permissoesUsuario?.includes('importar-extrato')
            && !req.permissoesUsuario?.includes('visualizar-financeiro')
        ) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }
        dbClient = await pool.connect();
        const limit = Math.min(Number(req.query.limit) || 20, 50);
        const r = await dbClient.query(
            `SELECT i.*, cb.nome_conta
               FROM fc_importacoes_extrato i
               JOIN fc_contas_bancarias cb
                 ON cb.id = i.id_conta_bancaria
                AND cb.empresa_id = i.empresa_id
              WHERE i.empresa_id = $1
              ORDER BY i.criado_em DESC
              LIMIT $2`,
            [req.empresaId, limit]
        );
        res.json({ importacoes: r.rows });
    } catch (error) {
        console.error('[GET /importacoes/extrato]', error);
        res.status(500).json({ error: 'Erro ao listar importações.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// GET /importacoes/a-classificar — pendências de classificação
// ---------------------------------------------------------------------------
router.get('/importacoes/a-classificar', async (req, res) => {
    let dbClient;
    try {
        if (!req.permissoesUsuario?.includes('visualizar-financeiro')
            && !req.permissoesUsuario?.includes('importar-extrato')
            && !req.permissoesUsuario?.includes('acesso-financeiro')) {
            return res.status(403).json({ error: 'Permissão negada.' });
        }
        dbClient = await pool.connect();
        const limit = Math.min(Number(req.query.limit) || 50, 100);
        const r = await dbClient.query(
            `SELECT l.id, l.tipo, l.valor, l.data_transacao, l.descricao,
                    l.id_categoria, l.id_conta_bancaria, l.id_contato,
                    cat.nome AS nome_categoria,
                    cb.nome_conta
               FROM fc_lancamentos l
               JOIN fc_categorias cat
                 ON cat.id = l.id_categoria
                AND cat.empresa_id = l.empresa_id
               JOIN fc_contas_bancarias cb
                 ON cb.id = l.id_conta_bancaria
                AND cb.empresa_id = l.empresa_id
              WHERE l.empresa_id = $1
                AND l.excluido_em IS NULL
                AND cat.nome = $2
              ORDER BY l.data_transacao DESC, l.id DESC
              LIMIT $3`,
            [req.empresaId, NOME_CATEGORIA_A_CLASSIFICAR, limit]
        );
        const countR = await dbClient.query(
            `SELECT COUNT(*)::int AS total
               FROM fc_lancamentos l
               JOIN fc_categorias cat
                 ON cat.id = l.id_categoria
                AND cat.empresa_id = l.empresa_id
              WHERE l.empresa_id = $1
                AND l.excluido_em IS NULL
                AND cat.nome = $2`,
            [req.empresaId, NOME_CATEGORIA_A_CLASSIFICAR]
        );
        res.json({
            total: countR.rows[0]?.total || 0,
            lancamentos: r.rows,
            nome_categoria: NOME_CATEGORIA_A_CLASSIFICAR,
        });
    } catch (error) {
        console.error('[GET /importacoes/a-classificar]', error);
        res.status(500).json({ error: 'Erro ao buscar pendências de classificação.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// GET /importacoes/extrato/:id/export — resultado da conciliação (json|csv)
// ---------------------------------------------------------------------------
router.get('/importacoes/extrato/:id/export', async (req, res) => {
    let dbClient;
    try {
        exigirPermissaoImportar(req);
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
        const formatoOut = String(req.query.formato || 'json').toLowerCase();

        dbClient = await pool.connect();
        const lote = await exigirLote(dbClient, id, req.empresaId);
        const linhas = await dbClient.query(
            `SELECT il.id, il.data_transacao, il.valor, il.tipo_movimento, il.descricao_original,
                    il.descricao_final, il.status_linha, il.score_match,
                    il.id_lancamento_sugerido, il.id_lancamento_vinculado,
                    il.id_categoria, il.payload_bruto_json,
                    cat.nome AS nome_categoria
               FROM fc_importacao_linhas il
               LEFT JOIN fc_categorias cat
                 ON cat.id = COALESCE(il.id_categoria, il.id_categoria_sugerida)
                AND cat.empresa_id = il.empresa_id
              WHERE il.empresa_id = $1 AND il.id_importacao = $2
              ORDER BY il.data_transacao ASC, il.id ASC`,
            [req.empresaId, id]
        );

        const rotuloTipo = (tipo) => {
            const t = String(tipo || '').toUpperCase();
            if (t === 'CREDITO' || t === 'CREDIT') return 'Crédito';
            if (t === 'DEBITO' || t === 'DEBIT') return 'Débito';
            return tipo || '';
        };
        const rotuloStatus = (status) => {
            const mapa = {
                PENDENTE: 'Pendente',
                CONCILIADO: 'Conciliado',
                NOVO_APROVADO: 'Criado',
                IGNORADO: 'Ignorado',
                DESCARTADO: 'Descartado',
                DUPLICATA: 'Duplicata',
            };
            return mapa[String(status || '').toUpperCase()] || status || '';
        };

        const rows = linhas.rows.map((l) => {
            const flags = l.payload_bruto_json?.flags_fase3 || {};
            return {
                id: l.id,
                data: String(l.data_transacao).slice(0, 10),
                valor: Number(l.valor),
                tipo: rotuloTipo(l.tipo_movimento),
                tipo_codigo: l.tipo_movimento,
                descricao: l.descricao_final || l.descricao_original,
                status: rotuloStatus(l.status_linha),
                status_codigo: l.status_linha,
                score_correspondencia: l.score_match != null ? Number(l.score_match) : null,
                id_lancamento: l.id_lancamento_vinculado || l.id_lancamento_sugerido || null,
                categoria: l.nome_categoria || null,
                transferencia_interna: Boolean(flags.transferencia_interna) ? 'Sim' : 'Não',
                id_agenda_sugerida: flags.id_agenda_sugerida || null,
                motivo: flags.motivo_sugestao || null,
            };
        });

        if (formatoOut === 'csv') {
            const colunas = [
                { chave: 'id', titulo: 'ID' },
                { chave: 'data', titulo: 'Data' },
                { chave: 'valor', titulo: 'Valor' },
                { chave: 'tipo', titulo: 'Tipo' },
                { chave: 'descricao', titulo: 'Descrição' },
                { chave: 'status', titulo: 'Status' },
                { chave: 'score_correspondencia', titulo: 'Score de correspondência' },
                { chave: 'id_lancamento', titulo: 'ID lançamento' },
                { chave: 'categoria', titulo: 'Categoria' },
                { chave: 'transferencia_interna', titulo: 'Transferência interna' },
                { chave: 'id_agenda_sugerida', titulo: 'ID agenda sugerida' },
                { chave: 'motivo', titulo: 'Motivo' },
            ];
            const esc = (v) => {
                const s = v == null ? '' : String(v);
                if (/[;"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
                return s;
            };
            const lines = [colunas.map((c) => c.titulo).join(';')];
            for (const r of rows) {
                lines.push(colunas.map((c) => esc(r[c.chave])).join(';'));
            }
            const csv = `\uFEFF${lines.join('\n')}`;
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="importacao-${id}-resultado.csv"`
            );
            return res.send(csv);
        }

        res.json({
            importacao: {
                id: lote.id,
                nome_arquivo: lote.nome_arquivo,
                formato: lote.formato,
                status: lote.status,
                periodo_inicio: lote.periodo_inicio,
                periodo_fim: lote.periodo_fim,
                resumo: lote.resumo_json,
            },
            linhas: rows,
        });
    } catch (error) {
        console.error('[export importacao]', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao exportar resultado.',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// GET /importacoes/extrato/:id
// ---------------------------------------------------------------------------
router.get('/importacoes/extrato/:id', async (req, res) => {
    let dbClient;
    try {
        exigirPermissaoImportar(req);
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id)) return res.status(400).json({ error: 'ID inválido.' });

        dbClient = await pool.connect();
        const lote = await exigirLote(dbClient, id, req.empresaId);

        const statusFiltro = req.query.status ? String(req.query.status) : null;
        const params = [req.empresaId, id];
        let extra = '';
        if (statusFiltro) {
            params.push(statusFiltro);
            extra = ` AND il.status_linha = $${params.length}`;
        }
        if (req.query.apenas_pendentes === '1') {
            extra += ` AND il.status_linha IN ('PENDENTE')`;
        }

        const linhas = await dbClient.query(
            `SELECT il.*,
                    ls.descricao AS desc_lancamento_sugerido,
                    ls.valor AS valor_lancamento_sugerido,
                    ls.data_transacao AS data_lancamento_sugerido,
                    ls.tipo AS tipo_lancamento_sugerido,
                    lv.descricao AS desc_lancamento_vinculado,
                    cat.nome AS nome_categoria,
                    cont.nome AS nome_contato
               FROM fc_importacao_linhas il
               LEFT JOIN fc_lancamentos ls
                 ON ls.id = il.id_lancamento_sugerido AND ls.empresa_id = il.empresa_id
               LEFT JOIN fc_lancamentos lv
                 ON lv.id = il.id_lancamento_vinculado AND lv.empresa_id = il.empresa_id
               LEFT JOIN fc_categorias cat
                 ON cat.id = COALESCE(il.id_categoria, il.id_categoria_sugerida)
                AND cat.empresa_id = il.empresa_id
               LEFT JOIN fc_contatos cont
                 ON cont.id = COALESCE(il.id_contato, il.id_contato_sugerido)
                AND cont.empresa_id = il.empresa_id
              WHERE il.empresa_id = $1
                AND il.id_importacao = $2
                ${extra}
              ORDER BY il.data_transacao ASC, il.id ASC`,
            params
        );

        const conta = await exigirConta(dbClient, lote.id_conta_bancaria, req.empresaId);

        res.json({
            importacao: { ...lote, nome_conta: conta.nome_conta },
            linhas: linhas.rows,
            resumo: lote.resumo_json || montarResumo(linhas.rows),
        });
    } catch (error) {
        console.error('[GET /importacoes/extrato/:id]', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao buscar importação.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// PATCH /importacoes/extrato/:id/linhas/:linhaId
// ---------------------------------------------------------------------------
router.patch('/importacoes/extrato/:id/linhas/:linhaId', async (req, res) => {
    let dbClient;
    try {
        exigirPermissaoImportar(req);
        const idImportacao = Number(req.params.id);
        const linhaId = Number(req.params.linhaId);
        if (!Number.isSafeInteger(idImportacao) || !Number.isSafeInteger(linhaId)) {
            return res.status(400).json({ error: 'IDs inválidos.' });
        }

        const {
            id_categoria,
            id_contato,
            descricao_final,
            id_lancamento_sugerido,
            status_linha,
            limpar_match,
        } = req.body || {};

        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const lote = await exigirLote(dbClient, idImportacao, req.empresaId, { forUpdate: true });
        if (!['EM_REVISAO', 'PARCIAL', 'PROCESSANDO'].includes(lote.status)) {
            throw erro(400, 'Esta importação não está aberta para edição.');
        }

        const linhaR = await dbClient.query(
            `SELECT * FROM fc_importacao_linhas
              WHERE id = $1 AND id_importacao = $2 AND empresa_id = $3
              FOR UPDATE`,
            [linhaId, idImportacao, req.empresaId]
        );
        if (!linhaR.rows[0]) throw erro(404, 'Linha de importação não encontrada.');
        const linha = linhaR.rows[0];
        if (['NOVO_APROVADO', 'CONCILIADO'].includes(linha.status_linha) && linha.id_lancamento_vinculado) {
            throw erro(400, 'Linha já aprovada não pode ser editada.');
        }

        const sets = [];
        const params = [];
        let p = 1;

        if (id_categoria !== undefined) {
            if (id_categoria != null) {
                const c = await dbClient.query(
                    `SELECT id FROM fc_categorias WHERE id = $1 AND empresa_id = $2`,
                    [id_categoria, req.empresaId]
                );
                if (!c.rows[0]) throw erro(404, 'Categoria não encontrada na empresa ativa.');
            }
            sets.push(`id_categoria = $${p++}`);
            params.push(id_categoria);
        }
        if (id_contato !== undefined) {
            if (id_contato != null) {
                const c = await dbClient.query(
                    `SELECT id FROM fc_contatos WHERE id = $1 AND empresa_id = $2`,
                    [id_contato, req.empresaId]
                );
                if (!c.rows[0]) throw erro(404, 'Contato não encontrado na empresa ativa.');
            }
            sets.push(`id_contato = $${p++}`);
            params.push(id_contato);
        }
        if (descricao_final !== undefined) {
            sets.push(`descricao_final = $${p++}`);
            params.push(descricao_final);
        }
        if (limpar_match) {
            sets.push(`id_lancamento_sugerido = NULL`);
            sets.push(`score_match = NULL`);
            if (!status_linha) {
                sets.push(`status_linha = 'PENDENTE'`);
            }
        } else if (id_lancamento_sugerido !== undefined) {
            if (id_lancamento_sugerido != null) {
                const l = await dbClient.query(
                    `SELECT id FROM fc_lancamentos
                      WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL`,
                    [id_lancamento_sugerido, req.empresaId]
                );
                if (!l.rows[0]) throw erro(404, 'Lançamento sugerido não encontrado.');
            }
            sets.push(`id_lancamento_sugerido = $${p++}`);
            params.push(id_lancamento_sugerido);
        }
        if (status_linha) {
            const permitidos = ['PENDENTE', 'IGNORADO', 'DESCARTADO', 'DUPLICATA'];
            if (!permitidos.includes(status_linha)) {
                throw erro(400, `status_linha inválido. Use: ${permitidos.join(', ')}`);
            }
            sets.push(`status_linha = $${p++}`);
            params.push(status_linha);
        }

        if (sets.length === 0) {
            throw erro(400, 'Nenhum campo para atualizar.');
        }
        sets.push('atualizado_em = NOW()');
        params.push(linhaId, idImportacao, req.empresaId);

        const upd = await dbClient.query(
            `UPDATE fc_importacao_linhas
                SET ${sets.join(', ')}
              WHERE id = $${p++}
                AND id_importacao = $${p++}
                AND empresa_id = $${p}
              RETURNING *`,
            params
        );

        await dbClient.query('COMMIT');
        res.json(upd.rows[0]);
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[PATCH linha importacao]', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao atualizar linha.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// POST /importacoes/extrato/:id/aprovar
// body: { linhaIds?: number[] }
// ---------------------------------------------------------------------------
router.post('/importacoes/extrato/:id/aprovar', async (req, res) => {
    let dbClient;
    try {
        exigirPermissaoImportar(req);
        const idImportacao = Number(req.params.id);
        if (!Number.isSafeInteger(idImportacao)) {
            return res.status(400).json({ error: 'ID inválido.' });
        }

        const linhaIds = Array.isArray(req.body?.linhaIds)
            ? req.body.linhaIds.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0)
            : null;

        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const lote = await exigirLote(dbClient, idImportacao, req.empresaId, { forUpdate: true });
        if (!['EM_REVISAO', 'PARCIAL'].includes(lote.status)) {
            throw erro(400, 'Importação não está disponível para aprovação.');
        }

        const catsAClassificar = await garantirCategoriasAClassificar(dbClient, req.empresaId);

        let queryLinhas = `
            SELECT * FROM fc_importacao_linhas
             WHERE empresa_id = $1
               AND id_importacao = $2
               AND status_linha IN ('PENDENTE', 'DUPLICATA')
               AND id_lancamento_vinculado IS NULL`;
        const paramsLinhas = [req.empresaId, idImportacao];
        if (linhaIds && linhaIds.length > 0) {
            queryLinhas += ` AND id = ANY($3::int[])`;
            paramsLinhas.push(linhaIds);
        }
        queryLinhas += ` ORDER BY data_transacao ASC, id ASC FOR UPDATE`;

        const linhasR = await dbClient.query(queryLinhas, paramsLinhas);
        if (linhasR.rows.length === 0) {
            throw erro(400, 'Nenhuma linha elegível para aprovação.');
        }

        const criados = [];
        const conciliados = [];
        const ignoradosDup = [];
        const erros = [];

        for (const linha of linhasR.rows) {
            try {
                if (linha.status_linha === 'DUPLICATA') {
                    // Duplicata: só confirma vínculo se já tinha lançamento; senão ignora
                    if (linha.id_lancamento_sugerido) {
                        await dbClient.query(
                            `UPDATE fc_importacao_linhas
                                SET status_linha = 'CONCILIADO',
                                    id_lancamento_vinculado = COALESCE(id_lancamento_vinculado, id_lancamento_sugerido),
                                    atualizado_em = NOW()
                              WHERE id = $1 AND empresa_id = $2`,
                            [linha.id, req.empresaId]
                        );
                        conciliados.push(linha.id);
                    } else {
                        await dbClient.query(
                            `UPDATE fc_importacao_linhas
                                SET status_linha = 'IGNORADO', atualizado_em = NOW()
                              WHERE id = $1 AND empresa_id = $2`,
                            [linha.id, req.empresaId]
                        );
                        ignoradosDup.push(linha.id);
                    }
                    continue;
                }

                // Match com lançamento existente → conciliar
                if (linha.id_lancamento_sugerido && Number(linha.score_match || 0) >= 0.55) {
                    const lanc = await dbClient.query(
                        `SELECT id FROM fc_lancamentos
                          WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL`,
                        [linha.id_lancamento_sugerido, req.empresaId]
                    );
                    if (!lanc.rows[0]) {
                        // cai para criar novo
                    } else {
                        await dbClient.query(
                            `UPDATE fc_importacao_linhas
                                SET status_linha = 'CONCILIADO',
                                    id_lancamento_vinculado = $1,
                                    atualizado_em = NOW()
                              WHERE id = $2 AND empresa_id = $3`,
                            [linha.id_lancamento_sugerido, linha.id, req.empresaId]
                        );
                        await dbClient.query(
                            `UPDATE fc_lancamentos
                                SET id_importacao_linha = COALESCE(id_importacao_linha, $1)
                              WHERE id = $2 AND empresa_id = $3`,
                            [linha.id, linha.id_lancamento_sugerido, req.empresaId]
                        );
                        conciliados.push(linha.id);
                        continue;
                    }
                }

                // Criar lançamento novo
                const tipo = linha.tipo_movimento === 'CREDITO' ? 'RECEITA' : 'DESPESA';
                let idCategoria = linha.id_categoria || linha.id_categoria_sugerida;
                if (!idCategoria) {
                    idCategoria = catsAClassificar[tipo];
                }

                // Valida categoria na empresa
                const catCheck = await dbClient.query(
                    `SELECT c.id, c.nome
                       FROM fc_categorias c
                      WHERE c.id = $1 AND c.empresa_id = $2`,
                    [idCategoria, req.empresaId]
                );
                if (!catCheck.rows[0]) {
                    idCategoria = catsAClassificar[tipo];
                }
                const nomeCat = catCheck.rows[0]?.nome || NOME_CATEGORIA_A_CLASSIFICAR;

                if (linha.id_contato) {
                    const cont = await dbClient.query(
                        `SELECT id FROM fc_contatos WHERE id = $1 AND empresa_id = $2`,
                        [linha.id_contato, req.empresaId]
                    );
                    if (!cont.rows[0]) {
                        throw erro(400, `Contato inválido na linha #${linha.id}.`);
                    }
                }

                const desc = linha.descricao_final || linha.descricao_original || 'Importação OFX';
                const insLanc = await dbClient.query(
                    `INSERT INTO fc_lancamentos
                        (id_conta_bancaria, id_categoria, tipo, valor, data_transacao,
                         descricao, id_contato, id_usuario_lancamento, empresa_id, id_importacao_linha)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                     RETURNING *`,
                    [
                        lote.id_conta_bancaria,
                        idCategoria,
                        tipo,
                        linha.valor,
                        linha.data_transacao,
                        desc,
                        linha.id_contato || null,
                        req.usuarioLogado.id,
                        req.empresaId,
                        linha.id,
                    ]
                );
                const novo = insLanc.rows[0];

                await dbClient.query(
                    `UPDATE fc_importacao_linhas
                        SET status_linha = 'NOVO_APROVADO',
                            id_lancamento_vinculado = $1,
                            id_categoria = $2,
                            atualizado_em = NOW()
                      WHERE id = $3 AND empresa_id = $4`,
                    [novo.id, idCategoria, linha.id, req.empresaId]
                );

                await aprenderRegra(dbClient, req.empresaId, {
                    descricaoNormalizada: linha.descricao_normalizada,
                    idCategoria,
                    idContato: linha.id_contato,
                    tipo,
                    nomeCategoria: nomeCat,
                });

                criados.push({ linhaId: linha.id, lancamentoId: novo.id });
            } catch (lineErr) {
                console.error(`[aprovar] linha ${linha.id}:`, lineErr);
                erros.push({ linhaId: linha.id, error: lineErr.message });
            }
        }

        // Atualiza resumo e status do lote
        const todas = await dbClient.query(
            `SELECT status_linha FROM fc_importacao_linhas
              WHERE empresa_id = $1 AND id_importacao = $2`,
            [req.empresaId, idImportacao]
        );
        const pendentesRestantes = todas.rows.filter((r) => r.status_linha === 'PENDENTE').length;
        const processadas = todas.rows.filter((r) =>
            ['CONCILIADO', 'NOVO_APROVADO', 'IGNORADO', 'DESCARTADO', 'DUPLICATA'].includes(r.status_linha)
        ).length;
        let novoStatus = 'PARCIAL';
        let finalizadoEm = null;
        if (pendentesRestantes === 0) {
            novoStatus = 'CONCLUIDO';
            finalizadoEm = new Date();
        } else if (processadas === 0) {
            novoStatus = 'EM_REVISAO';
        }

        const resumo = {
            total: todas.rows.length,
            criados: criados.length,
            conciliados: conciliados.length,
            ignorados_duplicata: ignoradosDup.length,
            pendentes: pendentesRestantes,
            erros: erros.length,
        };

        const loteUpd = await dbClient.query(
            `UPDATE fc_importacoes_extrato
                SET status = $1,
                    resumo_json = $2,
                    finalizado_em = COALESCE($3, finalizado_em)
              WHERE id = $4 AND empresa_id = $5
              RETURNING *`,
            [
                novoStatus,
                JSON.stringify(resumo),
                finalizadoEm,
                idImportacao,
                req.empresaId,
            ]
        );

        await registrarLogImportacao(
            dbClient,
            req,
            'IMPORTACAO_EXTRATO',
            `Aprovou importação #${idImportacao}: ${criados.length} criado(s), ${conciliados.length} conciliado(s).`,
            { depois: { resumo, lote: loteUpd.rows[0] } }
        );

        await dbClient.query('COMMIT');
        res.json({
            importacao: loteUpd.rows[0],
            criados,
            conciliados,
            ignorados_duplicata: ignoradosDup,
            erros,
            resumo,
        });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[POST aprovar importacao]', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao aprovar importação.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// POST /importacoes/extrato/:id/aplicar-categoria-memo
// body: { linhaId } ou { descricao_normalizada, id_categoria, id_contato? }
// Aplica a mesma categoria a todas as linhas PENDENTE com o mesmo memo.
// ---------------------------------------------------------------------------
router.post('/importacoes/extrato/:id/aplicar-categoria-memo', async (req, res) => {
    let dbClient;
    try {
        exigirPermissaoImportar(req);
        const idImportacao = Number(req.params.id);
        if (!Number.isSafeInteger(idImportacao)) {
            return res.status(400).json({ error: 'ID inválido.' });
        }

        dbClient = await pool.connect();
        await dbClient.query('BEGIN');
        const lote = await exigirLote(dbClient, idImportacao, req.empresaId, { forUpdate: true });
        if (!['EM_REVISAO', 'PARCIAL', 'PROCESSANDO'].includes(lote.status)) {
            throw erro(400, 'Importação não está aberta para edição.');
        }

        let memo = req.body?.descricao_normalizada ? String(req.body.descricao_normalizada) : null;
        let idCategoria = req.body?.id_categoria != null ? Number(req.body.id_categoria) : null;
        let idContato = req.body?.id_contato !== undefined
            ? (req.body.id_contato == null ? null : Number(req.body.id_contato))
            : undefined;

        if (req.body?.linhaId != null) {
            const lr = await dbClient.query(
                `SELECT * FROM fc_importacao_linhas
                  WHERE id = $1 AND id_importacao = $2 AND empresa_id = $3`,
                [Number(req.body.linhaId), idImportacao, req.empresaId]
            );
            if (!lr.rows[0]) throw erro(404, 'Linha não encontrada.');
            memo = lr.rows[0].descricao_normalizada;
            if (idCategoria == null) idCategoria = lr.rows[0].id_categoria || lr.rows[0].id_categoria_sugerida;
            if (idContato === undefined) idContato = lr.rows[0].id_contato ?? null;
        }

        if (!memo) throw erro(400, 'Informe descricao_normalizada ou linhaId.');
        if (!idCategoria || !Number.isSafeInteger(idCategoria)) {
            throw erro(400, 'Informe id_categoria.');
        }

        const cat = await dbClient.query(
            `SELECT id FROM fc_categorias WHERE id = $1 AND empresa_id = $2`,
            [idCategoria, req.empresaId]
        );
        if (!cat.rows[0]) throw erro(404, 'Categoria não encontrada na empresa.');

        if (idContato != null) {
            const cont = await dbClient.query(
                `SELECT id FROM fc_contatos WHERE id = $1 AND empresa_id = $2`,
                [idContato, req.empresaId]
            );
            if (!cont.rows[0]) throw erro(404, 'Contato não encontrado na empresa.');
        }

        const upd = await dbClient.query(
            `UPDATE fc_importacao_linhas
                SET id_categoria = $1,
                    id_contato = COALESCE($2, id_contato),
                    atualizado_em = NOW()
              WHERE empresa_id = $3
                AND id_importacao = $4
                AND descricao_normalizada = $5
                AND status_linha = 'PENDENTE'
                AND id_lancamento_vinculado IS NULL
                AND (id_lancamento_sugerido IS NULL OR score_match IS NULL OR score_match < 0.55)
              RETURNING id`,
            [idCategoria, idContato === undefined ? null : idContato, req.empresaId, idImportacao, memo]
        );

        await dbClient.query('COMMIT');
        res.json({
            atualizadas: upd.rows.length,
            ids: upd.rows.map((r) => r.id),
            descricao_normalizada: memo,
            id_categoria: idCategoria,
        });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[aplicar-categoria-memo]', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao aplicar categoria em lote.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// CRUD regras de importação
// ---------------------------------------------------------------------------
router.get('/regras-importacao', async (req, res) => {
    let dbClient;
    try {
        exigirPermissaoImportar(req);
        dbClient = await pool.connect();
        const r = await dbClient.query(
            `SELECT r.*,
                    cat.nome AS nome_categoria,
                    cont.nome AS nome_contato
               FROM fc_regras_importacao r
               LEFT JOIN fc_categorias cat
                 ON cat.id = r.id_categoria AND cat.empresa_id = r.empresa_id
               LEFT JOIN fc_contatos cont
                 ON cont.id = r.id_contato AND cont.empresa_id = r.empresa_id
              WHERE r.empresa_id = $1
              ORDER BY r.ativo DESC, r.prioridade ASC, r.uso_count DESC, r.id DESC`,
            [req.empresaId]
        );
        res.json({ regras: r.rows });
    } catch (error) {
        console.error('[GET regras-importacao]', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao listar regras.',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.post('/regras-importacao', async (req, res) => {
    let dbClient;
    try {
        exigirPermissaoImportar(req);
        const padrao = String(req.body?.padrao || '').trim().toLowerCase();
        if (padrao.length < 2) return res.status(400).json({ error: 'Padrão mínimo de 2 caracteres.' });
        const idCategoria = req.body?.id_categoria != null ? Number(req.body.id_categoria) : null;
        const idContato = req.body?.id_contato != null ? Number(req.body.id_contato) : null;
        const tipo = req.body?.tipo || null;
        const prioridade = Number(req.body?.prioridade) || 100;

        dbClient = await pool.connect();
        if (idCategoria) {
            const c = await dbClient.query(
                `SELECT id FROM fc_categorias WHERE id = $1 AND empresa_id = $2`,
                [idCategoria, req.empresaId]
            );
            if (!c.rows[0]) throw erro(404, 'Categoria não encontrada.');
        }
        const r = await dbClient.query(
            `INSERT INTO fc_regras_importacao
                (empresa_id, padrao, id_categoria, id_contato, tipo, prioridade, ativo, origem)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'MANUAL')
             RETURNING *`,
            [req.empresaId, padrao, idCategoria, idContato, tipo, prioridade]
        );
        res.status(201).json(r.rows[0]);
    } catch (error) {
        console.error('[POST regras-importacao]', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao criar regra.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.put('/regras-importacao/:id', async (req, res) => {
    let dbClient;
    try {
        exigirPermissaoImportar(req);
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id)) return res.status(400).json({ error: 'ID inválido.' });

        dbClient = await pool.connect();
        const atual = await dbClient.query(
            `SELECT * FROM fc_regras_importacao WHERE id = $1 AND empresa_id = $2`,
            [id, req.empresaId]
        );
        if (!atual.rows[0]) throw erro(404, 'Regra não encontrada.');

        const padrao = req.body?.padrao != null
            ? String(req.body.padrao).trim().toLowerCase()
            : atual.rows[0].padrao;
        const idCategoria = req.body?.id_categoria !== undefined
            ? (req.body.id_categoria == null ? null : Number(req.body.id_categoria))
            : atual.rows[0].id_categoria;
        const idContato = req.body?.id_contato !== undefined
            ? (req.body.id_contato == null ? null : Number(req.body.id_contato))
            : atual.rows[0].id_contato;
        const tipo = req.body?.tipo !== undefined ? req.body.tipo : atual.rows[0].tipo;
        const prioridade = req.body?.prioridade !== undefined
            ? Number(req.body.prioridade)
            : atual.rows[0].prioridade;
        const ativo = req.body?.ativo !== undefined ? Boolean(req.body.ativo) : atual.rows[0].ativo;

        const r = await dbClient.query(
            `UPDATE fc_regras_importacao
                SET padrao = $1,
                    id_categoria = $2,
                    id_contato = $3,
                    tipo = $4,
                    prioridade = $5,
                    ativo = $6,
                    atualizado_em = NOW()
              WHERE id = $7 AND empresa_id = $8
              RETURNING *`,
            [padrao, idCategoria, idContato, tipo, prioridade, ativo, id, req.empresaId]
        );
        res.json(r.rows[0]);
    } catch (error) {
        console.error('[PUT regras-importacao]', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao atualizar regra.',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.delete('/regras-importacao/:id', async (req, res) => {
    let dbClient;
    try {
        exigirPermissaoImportar(req);
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
        dbClient = await pool.connect();
        const r = await dbClient.query(
            `DELETE FROM fc_regras_importacao
              WHERE id = $1 AND empresa_id = $2
              RETURNING id`,
            [id, req.empresaId]
        );
        if (!r.rows[0]) throw erro(404, 'Regra não encontrada.');
        res.status(204).send();
    } catch (error) {
        console.error('[DELETE regras-importacao]', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao excluir regra.',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ---------------------------------------------------------------------------
// POST /importacoes/extrato/:id/cancelar
// ---------------------------------------------------------------------------
router.post('/importacoes/extrato/:id/cancelar', async (req, res) => {
    let dbClient;
    try {
        exigirPermissaoImportar(req);
        const idImportacao = Number(req.params.id);
        if (!Number.isSafeInteger(idImportacao)) {
            return res.status(400).json({ error: 'ID inválido.' });
        }

        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const lote = await exigirLote(dbClient, idImportacao, req.empresaId, { forUpdate: true });
        if (lote.status === 'CANCELADO') {
            throw erro(400, 'Importação já cancelada.');
        }
        if (lote.status === 'CONCLUIDO') {
            throw erro(400, 'Importação concluída não pode ser cancelada. Lançamentos já criados permanecem.');
        }

        await dbClient.query(
            `UPDATE fc_importacao_linhas
                SET status_linha = CASE
                    WHEN status_linha IN ('NOVO_APROVADO', 'CONCILIADO') THEN status_linha
                    ELSE 'DESCARTADO'
                END,
                atualizado_em = NOW()
              WHERE id_importacao = $1 AND empresa_id = $2`,
            [idImportacao, req.empresaId]
        );

        const upd = await dbClient.query(
            `UPDATE fc_importacoes_extrato
                SET status = 'CANCELADO',
                    finalizado_em = NOW()
              WHERE id = $1 AND empresa_id = $2
              RETURNING *`,
            [idImportacao, req.empresaId]
        );

        await registrarLogImportacao(
            dbClient,
            req,
            'IMPORTACAO_EXTRATO',
            `Cancelou a importação de extrato #${idImportacao}.`,
            { depois: upd.rows[0] }
        );

        await dbClient.query('COMMIT');
        res.json({ importacao: upd.rows[0] });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[POST cancelar importacao]', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao cancelar importação.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
