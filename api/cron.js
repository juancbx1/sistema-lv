// api/cron.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import express from 'express';
import { dataLocalSaoPaulo } from './jornada.js';
import { reconciliarJornadaFuncionario } from './ponto-motor.js';

const router = express.Router();
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

async function obterEmpresaLegadaId(dbClient) {
    const result = await dbClient.query(
        `SELECT id
           FROM empresas
          WHERE eh_legada
            AND ativa
          ORDER BY id`
    );
    if (result.rows.length !== 1) {
        throw new Error(
            'O cron exige exatamente uma empresa legada ativa enquanto a cadeia produtiva não é multiempresa.'
        );
    }
    return result.rows[0].id;
}

// Endpoint que a Vercel vai chamar
router.get('/arquivar-concluidas', async (req, res) => {
    // SEGURANÇA: Verifica se quem chamou foi o Cron da Vercel
    // A Vercel envia esse header automaticamente. Isso impede que um usuário qualquer chame essa URL.
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
        // Em localhost (teste) permitimos, em produção bloqueamos se não tiver a senha
        return res.status(401).json({ error: 'Unauthorized' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        
        // Query Blindada com Fuso Horário do Brasil
        // Tradução: "Arquive onde data_conclusao é MENOR que o Início do Dia de Hoje em São Paulo"
        const result = await dbClient.query(`
            UPDATE demandas_producao 
            SET status = 'arquivada' 
            WHERE status = 'concluida' 
              AND empresa_id IS NOT NULL
              AND EXISTS (
                    SELECT 1
                      FROM empresas e
                     WHERE e.id = demandas_producao.empresa_id
                       AND e.ativa
              )
              AND data_conclusao::date < (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
        `);
        
        console.log(`[CRON] Sucesso! Demandas arquivadas: ${result.rowCount}`);
        
        res.status(200).json({ success: true, archived_count: result.rowCount });

    } catch (error) {
        console.error('[CRON] Erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/cron/registrar-intervalos
// Cron server-side que detecta S1/S2 cruzamentos e grava os horários AGENDADOS
// no ponto_diario — independente de qualquer supervisor estar com a tela aberta.
//
// Schedule no vercel.json: "*/5 10-20 * * *" (UTC) = a cada 5min das 7h às 17h30 SP.
// Adiciona guarda interna: aborta se hora SP estiver fora de 07:30–17:35 (margem de 5min).
//
// Regras:
//  - Só processa funcionários ativos (ativo=true) dos tipos costureira/tiktik
//  - Pula FALTOU e ALOCADO_EXTERNO (supervisor marcou ausência)
//  - Só processa se é dia de trabalho para o funcionário (dias_trabalho)
//  - Não processa DSR, feriado ou trabalho extra: esses dias usam blocos
//    especiais de tarefas e não a jornada ordinária
//  - Só processa se há evidência de atividade hoje (sessão ou status PRODUZINDO/ALMOCO/PAUSA)
//  - Grava sempre os horários AGENDADOS (não NOW()) para precisão histórica
//  - COALESCE: nunca sobrescreve entradas já existentes
router.get('/registrar-intervalos', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        const empresaId = await obterEmpresaLegadaId(dbClient);

        // Ativa o motor somente quando a fundação empresarial e o livro de
        // eventos estiverem presentes. Antes da migration, o caminho legado
        // continua disponível para evitar publicação parcial.
        const motorSchema = await dbClient.query(`
            SELECT
                to_regclass('public.ponto_eventos') IS NOT NULL AS possui_eventos,
                to_regclass('public.ponto_transicoes_pendentes') IS NOT NULL AS possui_transicoes,
                EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'ponto_diario'
                      AND column_name = 'empresa_id'
                ) AS ponto_empresarial,
                EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'calendario_empresa'
                      AND column_name = 'empresa_id'
                ) AS calendario_empresarial
        `);

        const motorAtivo = Object.values(motorSchema.rows[0] || {}).every(Boolean);
        if (motorAtivo) {
            const agora = new Date();
            const dataHojeSP = dataLocalSaoPaulo(agora);
            const funcionariosResult = await dbClient.query(`
                SELECT u.id, u.nome
                FROM usuarios u
                JOIN usuarios_empresas ue
                  ON ue.usuario_id = u.id
                 AND ue.empresa_id = $1
                 AND ue.ativo
                WHERE ue.tipos && ARRAY['costureira','tiktik']::text[]
                ORDER BY u.id
            `, [empresaId]);

            const resultados = [];
            for (const funcionario of funcionariosResult.rows) {
                try {
                    await dbClient.query('BEGIN');
                    const resultado = await reconciliarJornadaFuncionario(dbClient, {
                        empresaId,
                        funcionarioId: funcionario.id,
                        dataJornada: dataHojeSP,
                        agora,
                    });
                    await dbClient.query('COMMIT');
                    resultados.push({
                        funcionario_id: funcionario.id,
                        nome: funcionario.nome,
                        ...resultado,
                    });
                } catch (error) {
                    await dbClient.query('ROLLBACK').catch(() => undefined);
                    resultados.push({
                        funcionario_id: funcionario.id,
                        nome: funcionario.nome,
                        aplicado: false,
                        erro: error.message,
                    });
                }
            }

            const eventos = resultados.flatMap((resultado) => resultado.eventos || []);
            const erros = resultados.filter((resultado) => resultado.erro);
            console.log(`[CRON] motor de jornada ${dataHojeSP} — ${eventos.length} eventos, ${erros.length} erros`);
            return res.status(erros.length > 0 ? 207 : 200).json({
                success: erros.length === 0,
                motor: 'ponto-eventos-v1',
                data_jornada: dataHojeSP,
                total_eventos: eventos.length,
                erros: erros.length,
                resultados,
            });
        }

        // Hora atual em São Paulo
        const agora = new Date();
        const agoraSP = agora.toLocaleTimeString('en-GB', {
            timeZone: 'America/Sao_Paulo', hour12: false, hour: '2-digit', minute: '2-digit'
        });
        const dataHojeSP = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

        // Dia da semana em SP (0=Dom, 1=Seg, ..., 6=Sáb) — para checar dias_trabalho
        const dataBR = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const diaSemana = String(dataBR.getDay());

        const hhmmParaMin = (hhmm) => {
            if (!hhmm) return null;
            const [h, m] = String(hhmm).substring(0, 5).split(':').map(Number);
            return isNaN(h) || isNaN(m) ? null : h * 60 + m;
        };

        const agoraMin = hhmmParaMin(agoraSP);
        if (agoraMin === null) {
            return res.status(500).json({ error: 'Falha ao calcular hora atual em SP.' });
        }

        // Guarda de horário: só processa entre 07:30 e 17:35 SP.
        // 17:35 = 17:30 + 5min de margem para o último disparo ainda cobrir S3 mais tardios.
        const INICIO_MIN = 7 * 60 + 30;  // 07:30 = 450
        const FIM_MIN    = 17 * 60 + 35; // 17:35 = 1055
        if (agoraMin < INICIO_MIN || agoraMin > FIM_MIN) {
            console.log(`[CRON] registrar-intervalos ignorado fora do horário (${agoraSP} SP)`);
            return res.status(200).json({ success: true, ignorado: true, hora_sp: agoraSP, motivo: 'fora_do_horario' });
        }

        // Guarda de calendário: nenhum DSR, feriado, folga ou trabalho extra
        // recebe intervalo ordinário. O fluxo especial de trabalho nesses dias
        // é conduzido por blocos manuais de tarefas.
        const { rows: feriadoRows } = await dbClient.query(`
            SELECT 1 FROM calendario_empresa
            WHERE data = $1::date
              AND empresa_id = $2
              AND tipo IN ('feriado_nacional', 'feriado_regional', 'folga_empresa', 'trabalho_extra')
            LIMIT 1
        `, [dataHojeSP, empresaId]);

        if (feriadoRows.length > 0) {
            console.log(`[CRON] registrar-intervalos ignorado — feriado/folga em ${dataHojeSP}`);
            return res.status(200).json({ success: true, ignorado: true, hora_sp: agoraSP, motivo: 'feriado' });
        }

        // Busca todos os funcionários ativos com horários, ponto de hoje e sessões de hoje.
        // Sessões de arremate são verificadas via status_atual para simplicidade.
        const { rows: funcionarios } = await dbClient.query(`
            SELECT
                u.id,
                u.nome,
                ue.status_atual,
                COALESCE(ue.dias_trabalho, '{"1":true,"2":true,"3":true,"4":true,"5":true}'::jsonb) AS dias_trabalho,
                to_char(ue.horario_saida_1,  'HH24:MI') AS s1,
                to_char(ue.horario_entrada_2,'HH24:MI') AS e2,
                to_char(ue.horario_saida_2,  'HH24:MI') AS s2,
                to_char(ue.horario_entrada_3,'HH24:MI') AS e3,
                pd.horario_real_s1,
                pd.horario_real_s2,
                (
                    SELECT COUNT(*)::int
                    FROM sessoes_trabalho_producao sp
                    WHERE sp.funcionario_id = u.id
                      AND sp.empresa_id = ue.empresa_id
                      AND (sp.data_inicio AT TIME ZONE 'America/Sao_Paulo')::date = $1::date
                ) AS sessoes_hoje
            FROM usuarios u
            JOIN usuarios_empresas ue
              ON ue.usuario_id = u.id
             AND ue.empresa_id = $2
             AND ue.ativo
            LEFT JOIN ponto_diario pd
                ON pd.funcionario_id = u.id
               AND pd.data = $1
               AND pd.empresa_id = ue.empresa_id
            WHERE ue.tipos && ARRAY['costureira','tiktik']::text[]
              AND ue.status_atual NOT IN ('FALTOU','ALOCADO_EXTERNO')
        `, [dataHojeSP, empresaId]);

        const inserts = [];
        const logAlmoco = [];
        const logPausa  = [];

        for (const f of funcionarios) {
            // 1. Só processa se é dia de trabalho hoje
            const diasTrab = typeof f.dias_trabalho === 'object' ? f.dias_trabalho : {};
            if (diasTrab[diaSemana] !== true) continue;

            // 2. Só processa se há evidência de atividade hoje.
            //    Conta sessões de producao + detecta via status (cobre tiktiks em arremate).
            const statusAtivo = ['PRODUZINDO','ALMOCO','PAUSA','LIVRE','LIVRE_MANUAL'].includes(f.status_atual);
            const temAtividade = (f.sessoes_hoje || 0) > 0 || statusAtivo;
            if (!temAtividade) continue;

            // ── ALMOÇO (S1 → E2) ────────────────────────────────────────────────
            if (f.s1 && f.e2 && !f.horario_real_s1) {
                const s1Min = hhmmParaMin(f.s1);
                if (s1Min !== null && agoraMin >= s1Min) {
                    inserts.push(
                        dbClient.query(
                            `INSERT INTO ponto_diario
                                (funcionario_id, data, horario_real_s1,
                                 horario_real_e2, empresa_id)
                             VALUES ($1, $2, $3, $4, $5)
                             ON CONFLICT (empresa_id, funcionario_id, data) DO UPDATE SET
                                 horario_real_s1 = COALESCE(ponto_diario.horario_real_s1, EXCLUDED.horario_real_s1),
                                 horario_real_e2 = COALESCE(ponto_diario.horario_real_e2, EXCLUDED.horario_real_e2),
                                 updated_at      = NOW()`,
                            [f.id, dataHojeSP, f.s1, f.e2, empresaId]
                        )
                    );
                    logAlmoco.push(`${f.nome}(${f.id}):${f.s1}→${f.e2}`);
                }
            }

            // ── PAUSA (S2 → E3) ─────────────────────────────────────────────────
            if (f.s2 && f.e3 && !f.horario_real_s2) {
                const s2Min = hhmmParaMin(f.s2);
                if (s2Min !== null && agoraMin >= s2Min) {
                    inserts.push(
                        dbClient.query(
                            `INSERT INTO ponto_diario
                                (funcionario_id, data, horario_real_s2,
                                 horario_real_e3, empresa_id)
                             VALUES ($1, $2, $3, $4, $5)
                             ON CONFLICT (empresa_id, funcionario_id, data) DO UPDATE SET
                                 horario_real_s2 = COALESCE(ponto_diario.horario_real_s2, EXCLUDED.horario_real_s2),
                                 horario_real_e3 = COALESCE(ponto_diario.horario_real_e3, EXCLUDED.horario_real_e3),
                                 updated_at      = NOW()`,
                            [f.id, dataHojeSP, f.s2, f.e3, empresaId]
                        )
                    );
                    logPausa.push(`${f.nome}(${f.id}):${f.s2}→${f.e3}`);
                }
            }
        }

        if (inserts.length > 0) {
            // Promise.allSettled: uma falha não cancela os outros registros
            await Promise.allSettled(inserts);
        }

        const total = logAlmoco.length + logPausa.length;
        console.log(`[CRON] registrar-intervalos ${agoraSP} SP — ${total} inserts | almoco: [${logAlmoco.join(', ')}] | pausa: [${logPausa.join(', ')}]`);

        res.status(200).json({
            success: true,
            hora_sp: agoraSP,
            total_registros: total,
            almoco: logAlmoco,
            pausa: logPausa,
        });

    } catch (error) {
        console.error('[CRON] registrar-intervalos erro:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
