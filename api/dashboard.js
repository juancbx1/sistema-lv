// api/dashboard.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import express from 'express';
import { getPeriodoFiscalAtual, gerarBlocosSemanais, contarDiasUteis } from '../public/js/utils/periodos-fiscais.js';

const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    timezone: 'UTC',
});
const SECRET_KEY = process.env.JWT_SECRET;

router.use(async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Token ausente.' });
        const token = authHeader.split(' ')[1];
        req.usuarioLogado = jwt.verify(token, SECRET_KEY);
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Token inválido.' });
    }
});

// --- FUNÇÃO DE AUDITORIA DO COFRE (COM RESET DE CICLO) ---
async function auditarCofrePontos(dbClient, usuarioId, historicoDias, metasConfiguradas, periodoInicio) {
    // 0. Identifica o Ciclo Atual (Ex: "Janeiro/2026")
    const periodoAtual = getPeriodoFiscalAtual(new Date());
    const nomeCicloAtual = periodoAtual.nomeCompetencia; // Ex: "Janeiro 2026"
    
    // 1. Busca Saldo
    let saldoRes = await dbClient.query('SELECT * FROM banco_pontos_saldo WHERE usuario_id = $1', [usuarioId]);
    
    if (saldoRes.rows.length === 0) {
        // Cria novo com o ciclo atual marcado
        saldoRes = await dbClient.query(
            'INSERT INTO banco_pontos_saldo (usuario_id, ciclo_referencia) VALUES ($1, $2) RETURNING *', 
            [usuarioId, nomeCicloAtual]
        );
    }
    
    const saldoAtual = saldoRes.rows[0];
    let novoSaldo = parseFloat(saldoAtual.saldo_atual);
    let novosUsos = saldoAtual.usos_neste_ciclo;
    
    // 2. VERIFICAÇÃO DE VIRADA DE CICLO (RESET)
    // Se o ciclo salvo no banco for diferente do atual, ZERA TUDO.
    if (saldoAtual.ciclo_referencia !== nomeCicloAtual) {        
        // Zera variáveis locais
        novoSaldo = 0;
        novosUsos = 0;
        
        // Registra o reset no log para auditoria
        await dbClient.query(
            `INSERT INTO banco_pontos_log (usuario_id, tipo, quantidade, descricao) VALUES ($1, 'RESET', 0, $2)`,
            [usuarioId, `Início do ciclo ${nomeCicloAtual}`]
        );
        
        // Atualiza a referência no banco imediatamente
        await dbClient.query(
            `UPDATE banco_pontos_saldo SET saldo_atual = 0, usos_neste_ciclo = 0, ciclo_referencia = $1, ultimo_calculo = NOW() WHERE usuario_id = $2`,
            [nomeCicloAtual, usuarioId]
        );
    }

    // 3. Define a Meta Máxima (Para cálculo de sobras)
    const metaMaxima = metasConfiguradas[metasConfiguradas.length - 1];
    if (!metaMaxima) return { saldo: novoSaldo, usos: novosUsos };

    // Ordena metas
    const metasOrdenadas = [...metasConfiguradas].sort((a, b) => a.pontos_meta - b.pontos_meta);

    // 4. Varredura de Dias (Auditoria de Ganhos)
    const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    let houveAtualizacao = false;

    for (const dia of historicoDias) {
        if (dia.data >= hojeStr) continue;
        const dataDia = new Date(dia.data);
        if (dataDia < periodoInicio) continue;

        const pontosFeitos = parseFloat(dia.pontos);
        
        let indiceMetaBatida = -1;
        for (let i = metasOrdenadas.length - 1; i >= 0; i--) {
            if (pontosFeitos >= metasOrdenadas[i].pontos_meta) {
                indiceMetaBatida = i;
                break;
            }
        }

        if (indiceMetaBatida >= 1) {
            const metaBatida = metasOrdenadas[indiceMetaBatida];
            const sobra = pontosFeitos - metaBatida.pontos_meta;

            if (sobra > 0) {
                // Verifica se já foi pago
                const logRes = await dbClient.query(
                    `SELECT 1 FROM banco_pontos_log WHERE usuario_id = $1 AND tipo = 'GANHO' AND descricao LIKE $2`,
                    [usuarioId, `%${dia.data}%`]
                );

                if (logRes.rowCount === 0) {
                    await dbClient.query(
                        `INSERT INTO banco_pontos_log (usuario_id, tipo, quantidade, descricao) VALUES ($1, 'GANHO', $2, $3)`,
                        [usuarioId, sobra, `Sobra do dia ${dia.data} (${metaBatida.descricao_meta})`]
                    );
                    novoSaldo += sobra;
                    houveAtualizacao = true;
                }
            }
        }
    }

    if (houveAtualizacao) {
        await dbClient.query(
            `UPDATE banco_pontos_saldo SET saldo_atual = $1, ultimo_calculo = NOW() WHERE usuario_id = $2`,
            [novoSaldo, usuarioId]
        );
    }

    // Conta resgates da semana atual (Seg–Dom, horário SP)
    const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const diaSemana = agoraSP.getDay();
    const diasDesdeSegunda = diaSemana === 0 ? 6 : diaSemana - 1;
    const inicioSemanaAtual = new Date(agoraSP);
    inicioSemanaAtual.setDate(agoraSP.getDate() - diasDesdeSegunda);
    inicioSemanaAtual.setHours(0, 0, 0, 0);

    const resgatesSemanaisRes = await dbClient.query(
        `SELECT COUNT(*)::int as total FROM banco_pontos_log
         WHERE usuario_id = $1 AND tipo = 'RESGATE' AND data_evento >= $2`,
        [usuarioId, inicioSemanaAtual]
    );
    const usosEssaSemana = resgatesSemanaisRes.rows[0].total;

    return { saldo: novoSaldo, usos: novosUsos, usosEssaSemana };
}

router.get('/desempenho', async (req, res) => {
    const { id: usuarioId } = req.usuarioLogado;
    let dbClient;
    try {
        dbClient = await pool.connect();

        // 1. Busca Usuário (Com ID explícito)
        const userRes = await dbClient.query('SELECT id, nome, tipos, nivel, avatar_url, dias_trabalho, horario_saida_3 FROM usuarios WHERE id = $1', [usuarioId]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
        const usuario = userRes.rows[0];
        const tipoUsuario = usuario.tipos?.[0] || 'costureira';
        const nivelUsuario = usuario.nivel || 1;

        // 2. Busca Metas
        const hojeSP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        const versaoMetaRes = await dbClient.query(
            `SELECT id FROM metas_versoes WHERE data_inicio_vigencia <= $1 ORDER BY data_inicio_vigencia DESC LIMIT 1`, 
            [hojeSP]
        );
        let metasConfiguradas = [];
        if (versaoMetaRes.rows.length > 0) {
            const regrasRes = await dbClient.query(
                `SELECT pontos_meta, valor_comissao, descricao_meta FROM metas_regras WHERE id_versao = $1 AND tipo_usuario = $2 AND nivel = $3 ORDER BY pontos_meta ASC`,
                [versaoMetaRes.rows[0].id, tipoUsuario, nivelUsuario]
            );
            metasConfiguradas = regrasRes.rows;
        }

        // 3. Período Fiscal
        const periodo = getPeriodoFiscalAtual(new Date());
        
        // 4. Busca Atividades (CORRIGIDO: USANDO ID)
        let queryText = `
            SELECT pr.id::text as id_original, pr.data, pr.pontos_gerados, pr.op_numero, pr.processo, p.nome as produto, pr.quantidade, pr.variacao, 'OP' as tipo_origem
            FROM producoes pr JOIN produtos p ON pr.produto_id = p.id 
            WHERE pr.funcionario_id = $1 AND pr.data BETWEEN $2 AND $3
        `;
        if (tipoUsuario === 'tiktik') {
            queryText += `
                UNION ALL
                SELECT ar.id::text as id_original, ar.data_lancamento as data, ar.pontos_gerados, ar.op_numero, 'Arremate' as processo, p.nome as produto, ar.quantidade_arrematada as quantidade, ar.variante as variacao, 'Arremate' as tipo_origem
                FROM arremates ar JOIN produtos p ON ar.produto_id = p.id
                WHERE ar.usuario_tiktik_id = $1 AND ar.tipo_lancamento = 'PRODUCAO' AND ar.data_lancamento BETWEEN $2 AND $3
            `;
        }
        queryText += `
            UNION ALL
            SELECT pe.id::text as id_original, pe.data_referencia as data, pe.pontos as pontos_gerados, NULL::text as op_numero, 'Pontos Extras' as processo, 'Bônus' as produto, 0 as quantidade, NULL as variacao, 'PontosExtra' as tipo_origem
            FROM pontos_extras pe
            WHERE pe.funcionario_id = $1 AND pe.data_referencia BETWEEN $2::date AND $3::date AND pe.cancelado = FALSE
        `;

        const atividadesRes = await dbClient.query(queryText, [usuario.id, periodo.inicio, periodo.fim]);
        const atividades = atividadesRes.rows;

        // Total de peças produzidas no ciclo (exclui Pontos Extras que têm quantidade = 0)
        const totalPecasCiclo = atividades
            .filter(a => a.tipo_origem !== 'PontosExtra')
            .reduce((sum, a) => sum + (parseInt(a.quantidade) || 0), 0);

        // 5. Cálculo Diário
        const diasCalculados = {};
        atividades.forEach(atv => {
            const diaStr = new Date(atv.data).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
            if (!diasCalculados[diaStr]) diasCalculados[diaStr] = 0;
            diasCalculados[diaStr] += parseFloat(atv.pontos_gerados || 0);
        });

        // Busca Resgates
        const resgatesRes = await dbClient.query(
            `SELECT data_evento, quantidade FROM banco_pontos_log WHERE usuario_id = $1 AND tipo = 'RESGATE' AND data_evento BETWEEN $2 AND $3`,
            [usuario.id, periodo.inicio, periodo.fim]
        );
        resgatesRes.rows.forEach(r => {
            const diaResgateStr = new Date(r.data_evento).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
            if (!diasCalculados[diaResgateStr]) diasCalculados[diaResgateStr] = 0;
            diasCalculados[diaResgateStr] += parseFloat(r.quantidade);
        });

        let totalGanhoPeriodo = 0;
        const historicoDias = Object.keys(diasCalculados).map(diaStr => {
            const pontosFeitos = diasCalculados[diaStr];
            let metaBatida = null;
            for (let i = metasConfiguradas.length - 1; i >= 0; i--) {
                if (pontosFeitos >= metasConfiguradas[i].pontos_meta) {
                    metaBatida = metasConfiguradas[i];
                    break;
                }
            }
            const ganhoDia = metaBatida ? parseFloat(metaBatida.valor_comissao) : 0;
            totalGanhoPeriodo += ganhoDia;
            // Nível da meta atingida naquele dia (para o calendário)
            const idxMeta = metaBatida ? metasConfiguradas.findIndex(m => m.pontos_meta === metaBatida.pontos_meta) : -1;
            const ultimoIdx = metasConfiguradas.length - 1;
            const nivelMeta = idxMeta < 0
                ? (pontosFeitos > 0 ? 'nao_bateu' : null)
                : idxMeta === ultimoIdx ? 'ouro'
                : idxMeta === ultimoIdx - 1 && ultimoIdx >= 2 ? 'prata'
                : 'bronze';
            return { data: diaStr, pontos: pontosFeitos, ganho: ganhoDia, nivelMeta };
        });

        // 6. MÉTRICAS DO CICLO
        const inicioCicloStr = periodo.inicio.toISOString().slice(0, 10);
        const fimCicloStr    = periodo.fim.toISOString().slice(0, 10);

        // Feriados e folgas gerais visíveis na dashboard — usados em 12-D e 12-E
        const feriadosCicloRes = await dbClient.query(`
            SELECT data::text AS data FROM calendario_empresa
            WHERE data BETWEEN $1 AND $2
              AND tipo IN ('feriado_nacional', 'feriado_regional', 'folga_empresa')
              AND funcionario_id IS NULL
              AND visivel_dashboard = true
        `, [inicioCicloStr, fimCicloStr]);
        const datasExcluidas = new Set(feriadosCicloRes.rows.map(r => r.data.slice(0, 10)));

        // Todos os eventos do ciclo visíveis ao empregado (para o calendário da dashboard)
        const eventosCalendarioRes = await dbClient.query(`
            SELECT data::text AS data, tipo, descricao
            FROM calendario_empresa
            WHERE data BETWEEN $1 AND $2
              AND visivel_dashboard = true
              AND (funcionario_id IS NULL OR funcionario_id = $3)
            ORDER BY data
        `, [inicioCicloStr, fimCicloStr, usuario.id]);
        const eventosCalendario = eventosCalendarioRes.rows.map(r => ({ ...r, data: r.data.slice(0, 10) }));

        // 12-E: dias úteis genéricos do ciclo (Seg-Sex, sem feriados visíveis)
        const diasUteisNoCiclo = (() => {
            let count = 0;
            let cursor = new Date(periodo.inicio.toISOString().slice(0,10) + 'T12:00:00');
            const fimDate = new Date(periodo.fim.toISOString().slice(0,10) + 'T12:00:00');
            while (cursor <= fimDate) {
                const dow = cursor.getDay();
                const dateStr = cursor.toISOString().slice(0, 10);
                if (dow !== 0 && dow !== 6 && !datasExcluidas.has(dateStr)) count++;
                cursor.setDate(cursor.getDate() + 1);
            }
            return count;
        })();

        // 12-D: dias úteis reais do empregado (considera dias_trabalho + feriados visíveis)
        const diasTrabalhoMap = usuario.dias_trabalho || { "1": true, "2": true, "3": true, "4": true, "5": true };
        const diasUteisRealDoEmpregadoNoCiclo = (() => {
            let count = 0;
            let cursor = new Date(periodo.inicio.toISOString().slice(0,10) + 'T12:00:00');
            const fimDate = new Date(periodo.fim.toISOString().slice(0,10) + 'T12:00:00');
            while (cursor <= fimDate) {
                const dow = cursor.getDay();
                const dateStr = cursor.toISOString().slice(0, 10);
                if (diasTrabalhoMap[String(dow)] === true && !datasExcluidas.has(dateStr)) count++;
                cursor.setDate(cursor.getDate() + 1);
            }
            return count;
        })();

        const diasTrabalhadosNoCiclo = historicoDias.filter(d => d.pontos > 0).length;

        // Detectar se o expediente de hoje já encerrou (horario_saida_3 + 15min de buffer)
        const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        let diaHojeJaEncerrado = false;
        if (usuario.horario_saida_3) {
            const [hSaida, mSaida] = usuario.horario_saida_3.split(':').map(Number);
            const saidaComBuffer = new Date(agoraSP);
            saidaComBuffer.setHours(hSaida, mSaida + 15, 0, 0);
            diaHojeJaEncerrado = agoraSP >= saidaComBuffer;
        }

        // Dias úteis restantes no ciclo — considera dias_trabalho + feriados + expediente encerrado
        // Se o expediente de hoje já acabou, começa a contagem a partir de amanhã
        const diasRestantesNoCiclo = (() => {
            const baseDate = new Date(agoraSP);
            if (diaHojeJaEncerrado) baseDate.setDate(baseDate.getDate() + 1);
            const baseStr = baseDate.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
            let count = 0;
            let cursor = new Date(baseStr + 'T12:00:00');
            const fimDate = new Date(fimCicloStr + 'T12:00:00');
            while (cursor <= fimDate) {
                const dow = cursor.getDay();
                const dateStr = cursor.toISOString().slice(0, 10);
                if (diasTrabalhoMap[String(dow)] === true && !datasExcluidas.has(dateStr)) count++;
                cursor.setDate(cursor.getDate() + 1);
            }
            return count;
        })();

        // 7. PROCESSA O COFRE AUTOMATICAMENTE
        const dadosCofre = await auditarCofrePontos(dbClient, usuario.id, historicoDias, metasConfiguradas, periodo.inicio);

        // 7. Blocos Semanais
        const blocos = gerarBlocosSemanais(periodo.inicio, periodo.fim);
        const blocosComDados = blocos.map(bloco => {
            const diasNoBloco = historicoDias.filter(d => {
                const dataDia = new Date(d.data + 'T00:00:00');
                return dataDia >= bloco.inicio && dataDia <= bloco.fim;
            });
            return {
                ...bloco,
                ganho: diasNoBloco.reduce((acc, d) => acc + d.ganho, 0),
                pontos: diasNoBloco.reduce((acc, d) => acc + d.pontos, 0),
            };
        });

        const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        const dadosHoje = historicoDias.find(d => d.data === hojeStr) || { pontos: 0, ganho: 0 };
        const proximaMetaHoje = metasConfiguradas.find(m => m.pontos_meta > dadosHoje.pontos) || metasConfiguradas[metasConfiguradas.length - 1];

        // 8. CÁLCULO DO CICLO ANTERIOR (LIMPO E SEM LOGS)
        const fimCicloAnterior = new Date(periodo.inicio);
        fimCicloAnterior.setDate(fimCicloAnterior.getDate() - 1); // 20/12
        fimCicloAnterior.setHours(23, 59, 59, 999);

        const inicioCicloAnterior = new Date(fimCicloAnterior);
        inicioCicloAnterior.setDate(21);
        inicioCicloAnterior.setMonth(inicioCicloAnterior.getMonth() - 1);
        inicioCicloAnterior.setHours(0, 0, 0, 0);
        
        let valorCicloAnterior = 0;
        let dataPagamentoAnterior = null;

        if (fimCicloAnterior >= inicioCicloAnterior) {
            const dPag = new Date(fimCicloAnterior);
            dPag.setMonth(dPag.getMonth() + 1);
            dPag.setDate(15);
            dataPagamentoAnterior = dPag.toLocaleDateString('pt-BR');

            // Busca Produção Anterior (POR ID)
            const ativAntRes = await dbClient.query(queryText, [usuario.id, inicioCicloAnterior, fimCicloAnterior]);
            
            // Busca Resgates Anteriores (Com cast de data para segurança)
            const resgAntRes = await dbClient.query(
                `SELECT data_evento, quantidade 
                 FROM banco_pontos_log 
                 WHERE usuario_id = $1 
                   AND tipo = 'RESGATE' 
                   AND data_evento::date >= $2::date 
                   AND data_evento::date <= $3::date`,
                [usuario.id, inicioCicloAnterior, fimCicloAnterior]
            );

            // Mapeia Pontos
            const mapaAnt = {};

            ativAntRes.rows.forEach(r => {
                const d = new Date(r.data).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
                if (!mapaAnt[d]) mapaAnt[d] = 0;
                mapaAnt[d] += parseFloat(r.pontos_gerados);
            });

            resgAntRes.rows.forEach(r => {
                const d = new Date(r.data_evento).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
                if (!mapaAnt[d]) mapaAnt[d] = 0;
                mapaAnt[d] += parseFloat(r.quantidade);
            });

            // Busca Metas da Época
            const versaoAntRes = await dbClient.query(
                `SELECT id FROM metas_versoes WHERE data_inicio_vigencia <= $1 ORDER BY data_inicio_vigencia DESC LIMIT 1`,
                [fimCicloAnterior.toISOString().substring(0,10)]
            );
            
            let metasAnt = [];
            if (versaoAntRes.rows.length > 0) {
                const regrasAntRes = await dbClient.query(
                    `SELECT pontos_meta, valor_comissao, descricao_meta FROM metas_regras WHERE id_versao = $1 AND tipo_usuario = $2 AND nivel = $3 ORDER BY pontos_meta ASC`,
                    [versaoAntRes.rows[0].id, tipoUsuario, nivelUsuario]
                );
                metasAnt = regrasAntRes.rows;
            }

            // Calcula Valor
            Object.values(mapaAnt).forEach(pontosDia => {
                let valDia = 0;
                for (let i = metasAnt.length - 1; i >= 0; i--) {
                    if (pontosDia >= metasAnt[i].pontos_meta) {
                        valDia = parseFloat(metasAnt[i].valor_comissao);
                        break;
                    }
                }
                valorCicloAnterior += valDia;
            });
        }

        // 9. BUSCA PARA LISTA DE DETALHAMENTO (LIVRE DE CICLO)
        // Busca as últimas 100 atividades independente da data (para histórico visual)
        let queryLista = `
            SELECT pr.id::text as id_original, pr.data, pr.pontos_gerados, pr.op_numero, pr.processo, p.nome as produto, pr.quantidade, pr.variacao, 'OP' as tipo_origem
            FROM producoes pr JOIN produtos p ON pr.produto_id = p.id 
            WHERE pr.funcionario_id = $1
        `;
        if (tipoUsuario === 'tiktik') {
            queryLista += `
                UNION ALL
                SELECT ar.id::text as id_original, ar.data_lancamento as data, ar.pontos_gerados, ar.op_numero, 'Arremate' as processo, p.nome as produto, ar.quantidade_arrematada as quantidade, ar.variante as variacao, 'Arremate' as tipo_origem
                FROM arremates ar JOIN produtos p ON ar.produto_id = p.id
                WHERE ar.usuario_tiktik_id = $1 AND ar.tipo_lancamento = 'PRODUCAO'
            `;
        }
        queryLista += `
            UNION ALL
            SELECT pe.id::text as id_original, pe.data_referencia as data, pe.pontos as pontos_gerados, NULL::text as op_numero, 'Pontos Extras' as processo, 'Bônus' as produto, 0 as quantidade, NULL as variacao, 'PontosExtra' as tipo_origem
            FROM pontos_extras pe
            WHERE pe.funcionario_id = $1 AND pe.cancelado = FALSE
        `;
        // Ordena por data decrescente e limita
        queryLista += ` ORDER BY data DESC LIMIT 100`;

        const listaRes = await dbClient.query(queryLista, [usuario.id]);
        const atividadesParaLista = listaRes.rows;

        // 10. DATA EXATA DE PAGAMENTO DO CICLO FECHADO
        // Sempre calculada com base em fimCicloAnterior (ciclo que já encerrou).
        // Dois mundos distintos: ciclo aberto (acumulando) vs ciclo fechado (a pagar).
        let dataPagamentoExata = null;
        let dataPagamentoFormatada = null;

        {
            const fimStr = fimCicloAnterior.toISOString().slice(0, 10);
            let [anoRef, mesRef] = fimStr.split('-').map(Number);
            mesRef += 1;
            if (mesRef > 12) { mesRef = 1; anoRef++; }

            const primeiroDiaPgto = new Date(Date.UTC(anoRef, mesRef - 1, 1));
            const ultimoDiaPgto   = new Date(Date.UTC(anoRef, mesRef, 0));

            // Feriados do mês de pagamento visíveis na dashboard
            const feriadosPgtoRes = await dbClient.query(`
                SELECT data::text AS data FROM calendario_empresa
                WHERE data BETWEEN $1 AND $2
                  AND tipo IN ('feriado_nacional', 'feriado_regional', 'folga_empresa')
                  AND funcionario_id IS NULL
            `, [primeiroDiaPgto.toISOString().slice(0, 10), ultimoDiaPgto.toISOString().slice(0, 10)]);

            const datasExcluidasPgto = new Set(feriadosPgtoRes.rows.map(r => r.data.slice(0, 10)));

            // 5º dia útil — CLT Art. 459: Seg–Sab contam, domingo não
            let diasContados = 0;
            let cursorPgto = new Date(primeiroDiaPgto);
            while (diasContados < 5) {
                const dow = cursorPgto.getUTCDay();
                const dateStr = cursorPgto.toISOString().slice(0, 10);
                if (dow !== 0 && !datasExcluidasPgto.has(dateStr)) {
                    diasContados++;
                    if (diasContados === 5) break;
                }
                cursorPgto.setUTCDate(cursorPgto.getUTCDate() + 1);
            }

            dataPagamentoExata = cursorPgto.toISOString().slice(0, 10);
            dataPagamentoFormatada = new Date(dataPagamentoExata + 'T12:00:00Z')
                .toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
        }

        res.status(200).json({
            usuario: { ...usuario, tipo: tipoUsuario },
            competencia: periodo.nomeCompetencia,
            hoje: {
                pontos: dadosHoje.pontos,
                ganho: dadosHoje.ganho,
                proximaMeta: proximaMetaHoje
            },
            acumulado: {
                totalGanho: totalGanhoPeriodo,
                totalPecasCiclo,
                blocos: blocosComDados,
                diasUteisNoCiclo,
                diasTrabalhadosNoCiclo,
                diasDetalhes: historicoDias,
                diasUteisRealDoEmpregadoNoCiclo,
                eventosCalendario,
                diaHojeJaEncerrado,
                diasRestantesNoCiclo,
            },
            // Ciclo aberto: o que a funcionária está acumulando AGORA (ainda não é pagamento)
            acumuladoCicloAtual: {
                valor: totalGanhoPeriodo,
                periodoInicio: periodo.inicio.toISOString().split('T')[0],
                periodoFim: periodo.fim.toISOString().split('T')[0],
            },
            // Ciclo fechado: o que vai ser PAGO no próximo 5º dia útil
            pagamentoCicloFechado: {
                valor: valorCicloAnterior,
                periodoInicio: inicioCicloAnterior.toISOString().split('T')[0],
                periodoFim: fimCicloAnterior.toISOString().split('T')[0],
                dataPagamentoExata,
                dataPagamentoFormatada,
            },
            // Mantido para retrocompatibilidade (não usado na wallet redesenhada)
            pagamentoPendente: (() => {
                if (totalGanhoPeriodo > 0) {
                    const d = new Date(periodo.fim);
                    d.setMonth(d.getMonth() + 1);
                    return {
                        valor: totalGanhoPeriodo,
                        periodo: `${periodo.inicio.toLocaleDateString('pt-BR')} a ${periodo.fim.toLocaleDateString('pt-BR')}`,
                        mesReferencia: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
                        dataPagamentoExata,
                        dataPagamentoFormatada
                    };
                }
                if (valorCicloAnterior > 0) {
                    const d = new Date(fimCicloAnterior);
                    d.setMonth(d.getMonth() + 1);
                    return {
                        valor: valorCicloAnterior,
                        periodo: `${inicioCicloAnterior.toLocaleDateString('pt-BR')} a ${fimCicloAnterior.toLocaleDateString('pt-BR')}`,
                        mesReferencia: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
                        dataPagamentoExata,
                        dataPagamentoFormatada
                    };
                }
                return { valor: 0, periodo: null, mesReferencia: '', dataPagamentoExata: null, dataPagamentoFormatada: null };
            })(),
            periodo: {
                inicio: periodo.inicio.toISOString().split('T')[0],
                fim: periodo.fim.toISOString().split('T')[0]
            },
            cofre: dadosCofre,
            atividadesRecentes: atividadesParaLista,
            metasPossiveis: metasConfiguradas
        });

    } catch (error) {
        console.error('[API Desempenho] Erro:', error);
        res.status(500).json({ error: 'Erro interno.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/dashboard/atividades
// GET /api/dashboard/atividades
router.get('/atividades', async (req, res) => {
    const { id: usuarioId } = req.usuarioLogado;
    // Se não passar 'limit', assumimos que quer tudo para o front paginar
    const { data, busca } = req.query;

    let dbClient;
    try {
        dbClient = await pool.connect();
        
        const userRes = await dbClient.query('SELECT tipos FROM usuarios WHERE id = $1', [usuarioId]);
        const tipoUsuario = userRes.rows[0]?.tipos?.[0] || 'costureira';

        // 1. Monta a Subquery
        let subQuery = `
            SELECT pr.id, pr.data, pr.pontos_gerados, pr.op_numero, pr.processo, p.nome as nome_produto, pr.quantidade, pr.variacao, 'OP' as tipo_origem, pr.funcionario_id as uid
            FROM producoes pr JOIN produtos p ON pr.produto_id = p.id
        `;

        if (tipoUsuario === 'tiktik') {
            subQuery += `
                UNION ALL
                SELECT ar.id::text as id, ar.data_lancamento as data, ar.pontos_gerados, ar.op_numero, 'Arremate' as processo, p.nome as nome_produto, ar.quantidade_arrematada as quantidade, ar.variante as variacao, 'Arremate' as tipo_origem, ar.usuario_tiktik_id as uid
                FROM arremates ar JOIN produtos p ON ar.produto_id = p.id
                WHERE ar.tipo_lancamento = 'PRODUCAO'
            `;
        }

        // Pontos extras para todos os tipos (costureira e tiktik)
        // Usa data_lancamento (TIMESTAMPTZ) como data para que fmtHora() mostre o horário real
        // e não 00:00 como aconteceria com data_referencia (DATE sem horário)
        subQuery += `
            UNION ALL
            SELECT pe.id::text as id, pe.data_lancamento as data, pe.pontos as pontos_gerados,
                   NULL::text as op_numero, 'Pontos Extras' as processo, 'Bônus' as nome_produto,
                   0 as quantidade, NULL as variacao, 'PontosExtra' as tipo_origem,
                   pe.funcionario_id as uid
            FROM pontos_extras pe
            WHERE pe.cancelado = FALSE
        `;

        // 2. Filtros
        let whereClauses = [];
        let params = [];
        let paramIndex = 1;

        whereClauses.push(`uid = $${paramIndex++}`);
        params.push(usuarioId);

        if (data) {
            whereClauses.push(`data::date = $${paramIndex++}::date`);
            params.push(data);
        }

        // Filtro de Busca Inteligente
        if (busca) {
            // Remove acentos do termo de busca no Javascript antes de enviar
            const termoNormalizado = busca.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const termoBuscaLike = `%${termoNormalizado.trim().replace(/\s+/g, '%')}%`;

            // Na query, tentamos converter o banco para sem acento também (se possível)
            // Se não tiver unaccent, usamos um translate simples para as vogais mais comuns
            // TRANSLATE(campo, 'áàãâéêíóôõúüçÁÀÃÂÉÊÍÓÔÕÚÜÇ', 'aaaaeeiooouucAAAAEEIOOOUUC')
            
            const campoBusca = `
                TRANSLATE(
                    (op_numero || ' ' || nome_produto || ' ' || COALESCE(variacao, '')),
                    'áàãâéêíóôõúüçÁÀÃÂÉÊÍÓÔÕÚÜÇ',
                    'aaaaeeiooouucAAAAEEIOOOUUC'
                )
            `;

            whereClauses.push(`${campoBusca} ILIKE $${paramIndex}`);
            params.push(termoBuscaLike);
            paramIndex++;
        }

        const whereString = `WHERE ${whereClauses.join(' AND ')}`;
        
        // 3. Query Final (SEM PAGINAÇÃO)
        // Buscamos tudo para o frontend calcular totais e paginar
        const dataQuery = `
            SELECT * FROM (${subQuery}) as uniao_atividades 
            ${whereString}
            ORDER BY data DESC
        `;

        const result = await dbClient.query(dataQuery, params);

        res.status(200).json({
            rows: result.rows,
            totalItems: result.rowCount
        });

    } catch (error) {
        console.error('[API Atividades] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar atividades.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// NOVA ROTA: RESGATAR PONTOS
router.post('/resgatar-pontos', async (req, res) => {
    const { id: usuarioId } = req.usuarioLogado;
    const { quantidade } = req.body;
    let dbClient;

    if (!quantidade || quantidade <= 0) return res.status(400).json({ error: 'Quantidade inválida.' });

    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        // 1. Verifica saldo
        const saldoRes = await dbClient.query('SELECT * FROM banco_pontos_saldo WHERE usuario_id = $1 FOR UPDATE', [usuarioId]);
        if (saldoRes.rows.length === 0) throw new Error('Cofre não encontrado.');

        const saldoAtual = parseFloat(saldoRes.rows[0].saldo_atual);
        if (saldoAtual < quantidade) throw new Error('Saldo insuficiente no cofre.');

        // 2. Verifica limite semanal (2 por semana Seg–Dom, horário SP)
        const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const diaSemana = agoraSP.getDay();
        const diasDesdeSegunda = diaSemana === 0 ? 6 : diaSemana - 1;
        const inicioSemanaAtual = new Date(agoraSP);
        inicioSemanaAtual.setDate(agoraSP.getDate() - diasDesdeSegunda);
        inicioSemanaAtual.setHours(0, 0, 0, 0);

        const resgatesSemanaisRes = await dbClient.query(
            `SELECT COUNT(*)::int as total FROM banco_pontos_log
             WHERE usuario_id = $1 AND tipo = 'RESGATE' AND data_evento >= $2`,
            [usuarioId, inicioSemanaAtual]
        );
        if (resgatesSemanaisRes.rows[0].total >= 2) {
            throw new Error('Você já usou seus 2 resgates desta semana. Volta na segunda-feira!');
        }

        // 3. Verifica produção mínima hoje (500 pts)
        const tipoRes = await dbClient.query('SELECT tipos FROM usuarios WHERE id = $1', [usuarioId]);
        const tipoUsuario = tipoRes.rows[0]?.tipos?.[0] || 'costureira';
        const hojeStrSP = agoraSP.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

        const pontosHojeProd = await dbClient.query(
            `SELECT COALESCE(SUM(pontos_gerados), 0)::float as total FROM producoes
             WHERE funcionario_id = $1 AND data::date = $2::date`,
            [usuarioId, hojeStrSP]
        );
        let pontosHoje = pontosHojeProd.rows[0].total;

        if (tipoUsuario === 'tiktik') {
            const pontosHojeArr = await dbClient.query(
                `SELECT COALESCE(SUM(pontos_gerados), 0)::float as total FROM arremates
                 WHERE usuario_tiktik_id = $1 AND tipo_lancamento = 'PRODUCAO' AND data_lancamento::date = $2::date`,
                [usuarioId, hojeStrSP]
            );
            pontosHoje += pontosHojeArr.rows[0].total;
        }
        const pontosHojeExtras = await dbClient.query(
            `SELECT COALESCE(SUM(pontos), 0)::float as total FROM pontos_extras
             WHERE funcionario_id = $1 AND data_referencia = $2::date AND cancelado = FALSE`,
            [usuarioId, hojeStrSP]
        );
        pontosHoje += pontosHojeExtras.rows[0].total;

        if (pontosHoje < 500) {
            throw new Error(`Produção insuficiente hoje (${Math.round(pontosHoje)} pts). São necessários pelo menos 500 pts para resgatar.`);
        }

        // 4. Deduz do Saldo
        await dbClient.query(
            `UPDATE banco_pontos_saldo SET saldo_atual = saldo_atual - $1, usos_neste_ciclo = usos_neste_ciclo + 1 WHERE usuario_id = $2`,
            [quantidade, usuarioId]
        );

        // 3. Registra no Log
        const hojeStr = new Date().toLocaleDateString('pt-BR');
        await dbClient.query(
            `INSERT INTO banco_pontos_log (usuario_id, tipo, quantidade, descricao) VALUES ($1, 'RESGATE', $2, $3)`,
            [usuarioId, quantidade, `Resgate manual para o dia ${hojeStr}`]
        );

        await dbClient.query('COMMIT');
        res.status(200).json({ message: 'Pontos resgatados com sucesso! Atualize a página.' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.get('/cofre/extrato', async (req, res) => {
    const { id: usuarioId } = req.usuarioLogado;
    const { page = 1, limit = 8 } = req.query; // Adicionado paginação
    let dbClient;
    try {
        dbClient = await pool.connect();
        
        const limitNum = parseInt(limit);
        const offset = (parseInt(page) - 1) * limitNum;

        // 1. Busca Total de Itens (para saber se tem mais páginas)
        const countRes = await dbClient.query('SELECT COUNT(*) FROM banco_pontos_log WHERE usuario_id = $1', [usuarioId]);
        const totalItems = parseInt(countRes.rows[0].count);

        // 2. Busca os Dados Paginados
        const result = await dbClient.query(`
            SELECT tipo, quantidade, descricao, data_evento 
            FROM banco_pontos_log 
            WHERE usuario_id = $1 
            ORDER BY data_evento DESC 
            LIMIT $2 OFFSET $3
        `, [usuarioId, limitNum, offset]);

        res.status(200).json({
            rows: result.rows,
            pagination: {
                page: parseInt(page),
                totalPages: Math.ceil(totalItems / limitNum),
                totalItems
            }
        });
    } catch (error) {
        console.error('[API Cofre Extrato] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar extrato.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/dashboard/meus-pagamentos
router.get('/meus-pagamentos', async (req, res) => {
    const { id: usuarioId } = req.usuarioLogado;
    let dbClient;
    try {
        dbClient = await pool.connect();
        
        const historicoRes = await dbClient.query(`
            SELECT
                data_pagamento,
                ciclo_nome,
                valor_liquido_pago,
                descricao
            FROM historico_pagamentos_funcionarios
            WHERE usuario_id = $1
              AND descricao ILIKE '%Comissão%'
              AND data_pagamento >= '2025-12-14 00:00:00'
            ORDER BY data_pagamento DESC
            LIMIT 12
        `, [usuarioId]);

        res.status(200).json(historicoRes.rows);

    } catch (error) {
        console.error('[API Meus Pagamentos] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar pagamentos.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// GET /api/dashboard/minha-tabela-pontos
router.get('/minha-tabela-pontos', async (req, res) => {
    const { id: usuarioId } = req.usuarioLogado;
    let dbClient;
    try {
        dbClient = await pool.connect();

        // 1. Tipo do usuário
        const tipoRes = await dbClient.query('SELECT tipos FROM usuarios WHERE id = $1', [usuarioId]);
        const tipoUsuario = tipoRes.rows[0]?.tipos?.[0] || 'costureira';

        // costureiras usam 'costura_op_costureira'; tiktiks usam 'processo_op_tiktik' e 'arremate_tiktik'
        const tiposAtividade = tipoUsuario === 'tiktik'
            ? ['processo_op_tiktik', 'arremate_tiktik']
            : ['costura_op_costureira'];

        // 2. Produtos que o empregado trabalhou nos últimos 90 dias
        const queryProdutos = tipoUsuario === 'tiktik'
            ? `SELECT DISTINCT produto_id FROM arremates
               WHERE usuario_tiktik_id = $1 AND data_lancamento >= NOW() - INTERVAL '90 days'`
            : `SELECT DISTINCT produto_id FROM producoes
               WHERE funcionario_id = $1 AND data >= NOW() - INTERVAL '90 days'`;

        const produtosRes = await dbClient.query(queryProdutos, [usuarioId]);
        const produtosIds = produtosRes.rows.map(r => r.produto_id);

        if (produtosIds.length === 0) return res.status(200).json([]);

        // 3. Configurações de pontos para esses produtos e tipos de atividade
        const tabelaRes = await dbClient.query(`
            SELECT
                cpp.produto_id,
                p.nome          AS produto_nome,
                p.imagem        AS produto_imagem,
                cpp.processo_nome,
                cpp.pontos_padrao
            FROM configuracoes_pontos_processos cpp
            JOIN produtos p ON cpp.produto_id = p.id
            WHERE cpp.produto_id = ANY($1::int[])
              AND cpp.tipo_atividade = ANY($2::text[])
              AND cpp.ativo = true
            ORDER BY p.nome ASC, cpp.pontos_padrao DESC
        `, [produtosIds, tiposAtividade]);

        // 4. Agrupa por produto
        const mapaGrupo = {};
        tabelaRes.rows.forEach(row => {
            if (!mapaGrupo[row.produto_id]) {
                mapaGrupo[row.produto_id] = {
                    produto_id: row.produto_id,
                    produto_nome: row.produto_nome,
                    produto_imagem: row.produto_imagem,
                    processos: []
                };
            }
            mapaGrupo[row.produto_id].processos.push({
                nome: row.processo_nome,
                pontos: parseFloat(row.pontos_padrao)
            });
        });

        res.status(200).json(Object.values(mapaGrupo));

    } catch (error) {
        console.error('[API Tabela Pontos] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar tabela de pontos.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/dashboard/ranking-semana
router.get('/ranking-semana', async (req, res) => {
    const { id: usuarioId } = req.usuarioLogado;
    let dbClient;
    try {
        dbClient = await pool.connect();

        // 1. Tipo do usuário logado
        const tipoRes = await dbClient.query('SELECT tipos FROM usuarios WHERE id = $1', [usuarioId]);
        const tipoUsuario = tipoRes.rows[0]?.tipos?.[0] || 'costureira';

        // 2. Início da semana (domingo 00:00 SP → semana Dom–Sab)
        const semanaAnterior = req.query.semana === 'anterior';
        const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const diaSemana = agoraSP.getDay(); // 0=Dom, 1=Seg, ..., 6=Sab
        const inicioSemanaAtual = new Date(agoraSP);
        inicioSemanaAtual.setDate(agoraSP.getDate() - diaSemana);
        inicioSemanaAtual.setHours(0, 0, 0, 0);

        // Se ?semana=anterior, recua a janela 7 dias
        const inicioSemana = new Date(inicioSemanaAtual);
        if (semanaAnterior) inicioSemana.setDate(inicioSemana.getDate() - 7);
        const fimJanela = semanaAnterior ? new Date(inicioSemanaAtual) : null; // null = sem limite superior

        // Label da semana para o header do card
        const fimSemana = new Date(inicioSemana);
        fimSemana.setDate(inicioSemana.getDate() + 6);
        const fmtDia = (d) => `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}`;
        const labelSemana = `${fmtDia(inicioSemana)}–${fmtDia(fimSemana)}`;

        // 3. Buscar todos os usuários ativos do mesmo tipo
        // data_admissao NOT NULL = empregado formalmente admitido
        // data_demissao IS NULL  = ainda na empresa
        const usuariosRes = await dbClient.query(
            `SELECT id FROM usuarios
             WHERE $1 = ANY(tipos)
               AND data_admissao IS NOT NULL
               AND data_demissao IS NULL`,
            [tipoUsuario]
        );
        const todosIds = usuariosRes.rows.map(r => r.id);

        if (todosIds.length <= 1) {
            return res.status(200).json({ totalParticipantes: todosIds.length, ranking: [] });
        }

        // 4. Somar pontos de cada usuário na semana
        // NOTA: pontos_extras propositalmente excluídos do ranking — seria injusto
        // com quem não recebeu bônus. O card exibe um 'i' explicando isso ao usuário.
        let queryPontos;
        const paramsPontos = fimJanela ? [todosIds, inicioSemana, fimJanela] : [todosIds, inicioSemana];
        const clausulaFim  = fimJanela ? 'AND data_lancamento < $3' : '';
        const clausulaFimP = fimJanela ? 'AND data < $3' : '';
        if (tipoUsuario === 'tiktik') {
            queryPontos = `
                SELECT usuario_tiktik_id AS uid, COALESCE(SUM(pontos_gerados), 0)::int AS pontos
                FROM arremates
                WHERE usuario_tiktik_id = ANY($1::int[])
                AND tipo_lancamento = 'PRODUCAO'
                AND data_lancamento >= $2
                ${clausulaFim}
                GROUP BY uid
            `;
        } else {
            queryPontos = `
                SELECT funcionario_id AS uid, COALESCE(SUM(pontos_gerados), 0)::int AS pontos
                FROM producoes
                WHERE funcionario_id = ANY($1::int[])
                AND data >= $2
                ${clausulaFimP}
                GROUP BY uid
            `;
        }
        const pontosRes = await dbClient.query(queryPontos, paramsPontos);

        // 5. Incluir usuários com 0 pontos e ordenar
        const mapaRanking = new Map(pontosRes.rows.map(r => [r.uid, r.pontos]));
        todosIds.forEach(id => { if (!mapaRanking.has(id)) mapaRanking.set(id, 0); });

        const rankingOrdenado = [...mapaRanking.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([uid, pontos], idx) => ({ uid, pontos, posicao: idx + 1, isEu: uid === usuarioId }));

        const minhaEntrada = rankingOrdenado.find(r => r.isEu);
        const minhaPosicao = minhaEntrada?.posicao || rankingOrdenado.length;
        const meusPontos = minhaEntrada?.pontos || 0;

        // 6. Slice visível
        // Times pequenos (≤ 8): mostrar todos.
        // Times grandes: top 3 sempre presentes + contexto do usuário (1 acima, eu, 1 abaixo).
        const indiceEu = rankingOrdenado.findIndex(r => r.isEu);
        let slice;
        if (rankingOrdenado.length <= 8) {
            slice = rankingOrdenado;
        } else {
            const top3 = rankingOrdenado.slice(0, Math.min(3, rankingOrdenado.length));

            if (indiceEu < 3) {
                // Usuário está no top 3 — mostrar top 5 para dar contexto
                slice = rankingOrdenado.slice(0, Math.min(6, rankingOrdenado.length));
            } else {
                // Usuário fora do top 3 — top 3 + separador + contexto do usuário
                const contextStart = Math.max(3, indiceEu - 1);
                const contextEnd = Math.min(rankingOrdenado.length, indiceEu + 2);
                const context = rankingOrdenado.slice(contextStart, contextEnd);
                slice = [
                    ...top3,
                    { posicao: null, pontos: null, uid: null, isEu: false, separador: true },
                    ...context,
                ];
            }
        }

        // 7. Anonimizar (não enviar uid de outros)
        const rankingFinal = slice.map(r => ({
            posicao: r.posicao,
            pontos: r.pontos,
            isEu: r.isEu,
            separador: r.separador || false
        }));

        // 8. Gap para motivação
        const proximoAcima = rankingOrdenado[indiceEu - 1];
        const gapParaProximo = proximoAcima ? proximoAcima.pontos - meusPontos : 0;
        const posicaoAcima = proximoAcima ? proximoAcima.posicao : null;
        const gapParaPrimeiro = rankingOrdenado[0].pontos - meusPontos;
        const todosZerados = rankingOrdenado[0].pontos === 0;

        // 9. semanasNoTopo — quantas semanas passadas completas o usuário ficou em 1°
        let semanasNoTopo = null;
        if (minhaPosicao === 1 && !todosZerados) {
            semanasNoTopo = 0;
            try {
                // Buscar 8 semanas para trás (antes do início da semana atual)
                const oitoSemanasAtras = new Date(inicioSemana.getTime() - 8 * 7 * 86400000);

                let queryHist;
                if (tipoUsuario === 'tiktik') {
                    queryHist = `
                        SELECT usuario_tiktik_id AS uid,
                               (data_lancamento AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
                               SUM(pontos_gerados)::int AS pontos
                        FROM arremates
                        WHERE usuario_tiktik_id = ANY($1::int[])
                          AND tipo_lancamento = 'PRODUCAO'
                          AND data_lancamento >= $2 AND data_lancamento < $3
                        GROUP BY uid, dia
                    `;
                } else {
                    queryHist = `
                        SELECT funcionario_id AS uid,
                               (data AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
                               SUM(pontos_gerados)::int AS pontos
                        FROM producoes
                        WHERE funcionario_id = ANY($1::int[])
                          AND data >= $2 AND data < $3
                        GROUP BY uid, dia
                    `;
                }
                const histRes = await dbClient.query(queryHist, [todosIds, oitoSemanasAtras, inicioSemana]);

                // Agrupar por semana (Domingo–Sábado)
                // r.dia é uma DATE SP retornada como Date UTC midnight — getUTCDay() dá o dia correto
                const mapaSemanas = {};
                histRes.rows.forEach(r => {
                    const diaDate = new Date(r.dia);
                    const dow = diaDate.getUTCDay(); // 0=Dom
                    const domingoMs = diaDate.getTime() - dow * 86400000;
                    const weekKey = new Date(domingoMs).toISOString().slice(0, 10);
                    if (!mapaSemanas[weekKey]) mapaSemanas[weekKey] = {};
                    mapaSemanas[weekKey][r.uid] = (mapaSemanas[weekKey][r.uid] || 0) + r.pontos;
                });

                // Contar semanas consecutivas em 1° lugar, da mais recente para a mais antiga
                for (let i = 1; i <= 8; i++) {
                    const domingoSemana = new Date(inicioSemana.getTime() - i * 7 * 86400000);
                    const weekKey = domingoSemana.toISOString().slice(0, 10);
                    const semana = mapaSemanas[weekKey];
                    if (!semana) break;
                    const entries = Object.entries(semana);
                    if (entries.length === 0) break;
                    const todosZeradosHist = entries.every(([, pts]) => pts === 0);
                    if (todosZeradosHist) break;
                    const [vencedorId] = entries.sort((a, b) => b[1] - a[1])[0];
                    if (parseInt(vencedorId) !== usuarioId) break;
                    semanasNoTopo++;
                }
            } catch (_) {
                semanasNoTopo = null;
            }
        }

        res.status(200).json({
            minhaPosicao,
            totalParticipantes: rankingOrdenado.length,
            meusPontos,
            tipoUsuario,
            gapParaProximo,
            posicaoAcima,
            gapParaPrimeiro,
            labelSemana,
            diaSemana,
            todosZerados,
            ranking: rankingFinal,
            semanasNoTopo,
        });

    } catch (error) {
        console.error('[API Ranking] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar ranking.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/dashboard/streak
// Retorna quantos dias seguidos com produção o usuário tem
router.get('/streak', async (req, res) => {
    const { id: usuarioId } = req.usuarioLogado;
    let dbClient;
    try {
        dbClient = await pool.connect();

        const tipoRes = await dbClient.query('SELECT tipos FROM usuarios WHERE id = $1', [usuarioId]);
        const tipoUsuario = tipoRes.rows[0]?.tipos?.[0] || 'costureira';

        const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const hojeStr = agoraSP.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

        let queryDias;
        if (tipoUsuario === 'tiktik') {
            queryDias = `
                SELECT data_lancamento::date AS dia, SUM(pontos_gerados) AS pontos
                FROM arremates
                WHERE usuario_tiktik_id = $1
                  AND tipo_lancamento = 'PRODUCAO'
                  AND data_lancamento >= NOW() - INTERVAL '50 days'
                GROUP BY dia
            `;
        } else {
            queryDias = `
                SELECT data::date AS dia, SUM(pontos_gerados) AS pontos
                FROM producoes
                WHERE funcionario_id = $1
                  AND data >= NOW() - INTERVAL '50 days'
                GROUP BY dia
            `;
        }
        const diasRes = await dbClient.query(queryDias, [usuarioId]);
        const diasComProducao = new Set(
            diasRes.rows
                .filter(r => parseFloat(r.pontos) > 0)
                .map(r => new Date(r.dia).toLocaleDateString('en-CA', { timeZone: 'UTC' }))
        );

        // Dias não úteis: domingos são tratados no loop; feriados/folgas vêm do calendário da empresa
        const ini50 = new Date(agoraSP);
        ini50.setDate(ini50.getDate() - 52); // margem extra para cobrir fins de semana
        const feriadosRes = await dbClient.query(`
            SELECT data::date AS dia FROM calendario_empresa
            WHERE data BETWEEN $1 AND $2
              AND tipo IN ('feriado_nacional', 'feriado_regional', 'folga_empresa', 'falta')
              AND (funcionario_id IS NULL OR funcionario_id = $3)
        `, [ini50.toISOString().slice(0, 10), hojeStr, usuarioId]);
        const diasNaoUteis = new Set(
            feriadosRes.rows.map(r => new Date(r.dia).toLocaleDateString('en-CA', { timeZone: 'UTC' }))
        );

        // Conta dias úteis seguidos para trás a partir de hoje
        // Domingos e dias do calendário (feriados/folgas) não quebram nem contam a sequência
        let diasSeguidos = 0;
        const cursor = new Date(agoraSP);

        for (let guard = 0; guard < 100; guard++) {
            const str = cursor.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
            const dow = cursor.getDay(); // 0 = domingo no fuso SP

            // Domingo ou dia não útil do calendário → pula sem quebrar streak
            if (dow === 0 || diasNaoUteis.has(str)) {
                cursor.setDate(cursor.getDate() - 1);
                continue;
            }

            // Dia útil sem produção → streak encerrada
            if (!diasComProducao.has(str)) break;

            diasSeguidos++;
            cursor.setDate(cursor.getDate() - 1);
        }

        const THRESHOLDS = [
            { dias: 21, badge: 'Lendária' },
            { dias: 15, badge: 'Imparável' },
            { dias: 10, badge: 'Constante' },
            { dias: 5,  badge: 'Determinada' },
        ];
        const badgeAtual = THRESHOLDS.find(t => diasSeguidos >= t.dias)?.badge || null;
        const proximo = THRESHOLDS.slice().reverse().find(t => t.dias > diasSeguidos);
        const proximoBadge = proximo?.badge || null;
        const diasParaBadge = proximo ? proximo.dias - diasSeguidos : null;

        res.json({ diasSeguidos, badgeAtual, proximoBadge, diasParaBadge });
    } catch (error) {
        console.error('[API Streak] Erro:', error);
        res.status(500).json({ error: 'Erro ao calcular streak.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/dashboard/conquistas-ciclo
// Retorna conquistas gamificadas para o ciclo atual
router.get('/conquistas-ciclo', async (req, res) => {
    const { id: usuarioId } = req.usuarioLogado;
    let dbClient;
    try {
        dbClient = await pool.connect();

        const tipoRes = await dbClient.query('SELECT tipos FROM usuarios WHERE id = $1', [usuarioId]);
        const tipoUsuario = tipoRes.rows[0]?.tipos?.[0] || 'costureira';

        const periodo = getPeriodoFiscalAtual(new Date());

        let queryDias;
        if (tipoUsuario === 'tiktik') {
            queryDias = `
                SELECT data_lancamento::date AS dia,
                       SUM(pontos_gerados)::float AS pontos,
                       COUNT(*)::int AS registros
                FROM arremates
                WHERE usuario_tiktik_id = $1
                  AND tipo_lancamento = 'PRODUCAO'
                  AND data_lancamento BETWEEN $2 AND $3
                GROUP BY dia
            `;
        } else {
            queryDias = `
                SELECT data::date AS dia,
                       SUM(pontos_gerados)::float AS pontos,
                       COUNT(*)::int AS registros
                FROM producoes
                WHERE funcionario_id = $1
                  AND data BETWEEN $2 AND $3
                GROUP BY dia
            `;
        }
        const diasRes = await dbClient.query(queryDias, [usuarioId, periodo.inicio, periodo.fim]);
        const dias = diasRes.rows;

        // Meta mínima do ciclo
        const hojeSP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        const versaoRes = await dbClient.query(
            `SELECT id FROM metas_versoes WHERE data_inicio_vigencia <= $1 ORDER BY data_inicio_vigencia DESC LIMIT 1`,
            [hojeSP]
        );
        let metaMinima = 1000;
        if (versaoRes.rows.length > 0) {
            const regraRes = await dbClient.query(
                `SELECT pontos_meta FROM metas_regras WHERE id_versao = $1 AND tipo_usuario = $2 ORDER BY pontos_meta ASC LIMIT 1`,
                [versaoRes.rows[0].id, tipoUsuario]
            );
            if (regraRes.rows.length > 0) metaMinima = parseFloat(regraRes.rows[0].pontos_meta);
        }

        const maxPontosDia = Math.max(...dias.map(d => parseFloat(d.pontos)), 0);
        const diasAcimaMeta = dias.filter(d => parseFloat(d.pontos) >= metaMinima).length;
        const diasAtivos = dias.filter(d => parseFloat(d.pontos) > 0).length;

        const limiarTurbinado = tipoUsuario === 'tiktik' ? 1500 : 1200;

        const lista = [
            {
                id: 'producao_turbinada',
                nome: tipoUsuario === 'tiktik' ? 'Arremate Turbinado' : 'Produção Turbinada',
                descricao: `${limiarTurbinado.toLocaleString('pt-BR')} pts em um dia`,
                icone: '⚡',
                desbloqueada: maxPontosDia >= limiarTurbinado,
            },
            {
                id: 'acima_da_meta',
                nome: 'Acima da Meta',
                descricao: 'Meta batida em 5 dias ou mais',
                icone: '🎯',
                desbloqueada: diasAcimaMeta >= 5,
            },
            {
                id: 'sequencia_de_ouro',
                nome: 'Sequência de Ouro',
                descricao: '10 dias ativos no ciclo',
                icone: '🏅',
                desbloqueada: diasAtivos >= 10,
            },
            {
                id: 'recorde_pessoal',
                nome: 'Primeiro Recorde',
                descricao: 'Primeiro dia com produção',
                icone: '🌟',
                desbloqueada: diasAtivos >= 1,
            },
        ];

        res.json({
            total: lista.length,
            desbloqueadas: lista.filter(c => c.desbloqueada).length,
            lista,
        });
    } catch (error) {
        console.error('[API Conquistas] Erro:', error);
        res.status(500).json({ error: 'Erro ao calcular conquistas.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;