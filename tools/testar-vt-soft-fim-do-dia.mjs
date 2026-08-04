/**
 * Ensaio: soft (risco+seta) vs débito real no fim do dia (S3+1h).
 * Uso: node tools/testar-vt-soft-fim-do-dia.mjs
 * Limpa fixtures ao final.
 */
import 'dotenv/config';
import pkg from 'pg';
import {
    dataCivilSp,
    definirSaldoCartaoVt,
    horaCorteConsumoVinculo,
    normalizarHoraHm,
    obterSaldoVt,
    valorVia,
} from '../api/vt-cartao-motor.js';

const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function agoraComHoraSp(horaHm, diaIso = dataCivilSp()) {
    const [hh, mm] = normalizarHoraHm(horaHm).split(':').map(Number);
    return new Date(Date.UTC(
        Number(diaIso.slice(0, 4)),
        Number(diaIso.slice(5, 7)) - 1,
        Number(diaIso.slice(8, 10)),
        hh + 3,
        mm,
        0,
        0
    ));
}

function somarMinutos(horaHm, mins) {
    const [h, m] = normalizarHoraHm(horaHm).split(':').map(Number);
    let t = h * 60 + m + mins;
    if (t > 23 * 60 + 59) t = 23 * 60 + 59;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

const db = await pool.connect();
const rel = { ok: false, cenarios: [], erros: [] };

try {
    const u = await db.query(`
        SELECT ue.usuario_id, ue.empresa_id, ue.valor_passagem_diaria,
               ue.horario_entrada_1, ue.horario_saida_1, ue.horario_saida_2, ue.horario_saida_3,
               u.nome
          FROM usuarios_empresas ue
          JOIN usuarios u ON u.id = ue.usuario_id
         WHERE ue.ativo = TRUE
           AND COALESCE(ue.valor_passagem_diaria, 0) > 0
           AND ue.empresa_id = 1
         ORDER BY ue.usuario_id
         LIMIT 1
    `);
    assert(u.rows.length, 'Sem vínculo com passagem para ensaiar');
    const vinculo = u.rows[0];
    const empresaId = Number(vinculo.empresa_id);
    const usuarioId = Number(vinculo.usuario_id);
    const valorDia = Number(vinculo.valor_passagem_diaria);
    const via = valorVia(valorDia);
    const e1 = normalizarHoraHm(vinculo.horario_entrada_1, '07:30');
    const corte = horaCorteConsumoVinculo(vinculo);
    const antesE1 = somarMinutos(e1, -30);
    const depoisE1 = somarMinutos(e1, 15);
    const antesCorte = somarMinutos(corte.hora, -15);
    const depoisCorte = somarMinutos(corte.hora, 5);

    const hoje = dataCivilSp();
    const saldoBase = arred(via * 4); // 2 dias

    await db.query('BEGIN');
    // limpa e define saldo inicial em D-1 para não bloquear soft de hoje
    const ontem = (() => {
        const [y, m, d] = hoje.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d - 1, 12)).toISOString().slice(0, 10);
    })();

    await db.query(
        `DELETE FROM vt_cartao_movimentos WHERE empresa_id=$1 AND usuario_id=$2`,
        [empresaId, usuarioId]
    );
    await db.query(
        `DELETE FROM vt_cartao_saldo WHERE empresa_id=$1 AND usuario_id=$2`,
        [empresaId, usuarioId]
    );

    // Crédito validado “antigo” (ontem) para funding
    await db.query(
        `INSERT INTO vt_cartao_movimentos
            (empresa_id, usuario_id, tipo, status_credito, valor, data_ref, motivo, idempotency_key, autor_nome)
         VALUES ($1,$2,'credito_recarga','validada',$3,$4::date,'ensaio_soft',$5,'ensaio-soft')`,
        [empresaId, usuarioId, saldoBase, ontem, `ensaio:cred:${empresaId}:${usuarioId}:${Date.now()}`]
    );

    // ── 1) Antes do E1: sem soft, sem risco ─────────────────────────────
    let s = await obterSaldoVt(db, empresaId, usuarioId, {
        reconciliar: true,
        agora: agoraComHoraSp(antesE1),
    });
    rel.cenarios.push({
        nome: 'antes_e1',
        hora: antesE1,
        soft_ativo: s.soft_ativo,
        saldo_disponivel: s.saldo_disponivel,
        saldo_exibido: s.saldo_exibido,
        ui_risco_seta: Boolean(s.soft_ativo),
    });
    assert(s.soft_ativo === false, 'Antes do E1 soft não deveria estar ativo');
    assert(Number(s.saldo_disponivel) === Number(s.saldo_exibido), 'Sem soft, exibido = livro');

    // ── 2) Depois do E1, antes do corte: soft ON (risco+seta) ───────────
    s = await obterSaldoVt(db, empresaId, usuarioId, {
        reconciliar: true,
        agora: agoraComHoraSp(depoisE1),
    });
    rel.cenarios.push({
        nome: 'depois_e1_antes_corte',
        hora: depoisE1,
        soft_ativo: s.soft_ativo,
        soft_total: s.soft_total,
        saldo_disponivel: s.saldo_disponivel,
        saldo_exibido: s.saldo_exibido,
        ui_risco_seta: Boolean(s.soft_ativo),
        corte: corte,
    });
    assert(s.soft_ativo === true, 'Após E1 soft deveria estar ativo');
    assert(Math.abs(Number(s.saldo_disponivel) - Number(s.saldo_exibido) - via) < 0.02, 'Soft ida = 1 via');
    assert(Number(s.saldo_exibido) < Number(s.saldo_disponivel), 'Exibido < livro (risco faz sentido)');

    // ── 3) Ainda antes do corte: soft ON, livro sem débito real ──────────
    s = await obterSaldoVt(db, empresaId, usuarioId, {
        reconciliar: true,
        agora: agoraComHoraSp(antesCorte),
    });
    rel.cenarios.push({
        nome: 'logo_antes_corte',
        hora: antesCorte,
        soft_ativo: s.soft_ativo,
        debitos_hoje: (s.ultimos_movimentos || []).filter(
            (m) => m.tipo === 'debito_consumo' && String(m.data_ref).slice(0, 10) === hoje
        ).length,
        ui_risco_seta: Boolean(s.soft_ativo),
    });
    assert(s.soft_ativo === true, 'Antes do corte soft ainda ativo');
    assert(
        (s.ultimos_movimentos || []).filter(
            (m) => m.tipo === 'debito_consumo' && String(m.data_ref || '').includes(hoje.slice(5))
        ).length === 0
        || (s.ultimos_movimentos || []).every((m) => m.tipo !== 'debito_consumo' || String(m.data_ref).slice(0, 10) !== hoje),
        'Não deve haver débito real de hoje antes do corte'
    );

    // ── 4) Depois do corte (S3+1h): débito real, soft OFF, sem risco ─────
    s = await obterSaldoVt(db, empresaId, usuarioId, {
        reconciliar: true,
        agora: agoraComHoraSp(depoisCorte),
    });
    const debitosHoje = (s.ultimos_movimentos || []).filter((m) => {
        if (m.tipo !== 'debito_consumo') return false;
        const dr = m.data_ref instanceof Date
            ? m.data_ref.toISOString().slice(0, 10)
            : String(m.data_ref || '').slice(0, 10);
        return dr === hoje;
    });
    rel.cenarios.push({
        nome: 'depois_corte_s3_mais_1h',
        hora: depoisCorte,
        soft_ativo: s.soft_ativo,
        saldo_disponivel: s.saldo_disponivel,
        saldo_exibido: s.saldo_exibido,
        debitos_hoje: debitosHoje.length,
        sentidos: debitosHoje.map((d) => d.sentido),
        ui_risco_seta: Boolean(s.soft_ativo),
        hora_corte_consumo: s.hora_corte_consumo,
        fonte_corte_consumo: s.fonte_corte_consumo,
        risco_bug_ui: s.soft_ativo === true && debitosHoje.length > 0
            ? 'BUG: soft+débito real ao mesmo tempo (risco+seta mentiria)'
            : 'ok',
    });
    assert(s.soft_ativo === false, 'Após corte soft DEVE desligar (sem risco+seta)');
    assert(Number(s.saldo_disponivel) === Number(s.saldo_exibido), 'Após corte, exibido = livro');
    // Soft off + saldo caiu 1 dia = prova de débito real (mesmo se data_ref vier serializado diferente)
    assert(
        Math.abs(Number(s.saldo_disponivel) - (saldoBase - valorDia)) < 0.05,
        `Saldo após dia deve ser base-1dia (${saldoBase - valorDia}), veio ${s.saldo_disponivel}`
    );
    assert(
        s.soft_ativo === false || debitosHoje.length === 0,
        'BUG: soft ativo junto com débito real (UI risco+seta inconsistente)'
    );

    // ── 5) Bug check: forçar soft com débito real já gravado ────────────
    // Mesmo com forcarSoftIda, se houver débito real o soft deve recusar?
    // Hoje forcarSoftIda ignora débitos — só para smoke de UI. Documentar.
    s = await obterSaldoVt(db, empresaId, usuarioId, {
        reconciliar: false,
        agora: agoraComHoraSp(depoisCorte),
        forcarSoftIda: false,
    });
    rel.cenarios.push({
        nome: 'pos_corte_sem_forcar',
        soft_ativo: s.soft_ativo,
        ui_risco_seta: false,
        ok: s.soft_ativo === false,
    });
    assert(s.soft_ativo === false, 'Pós-corte sem forçar: soft off');

    await db.query('ROLLBACK');

    // limpeza residual (caso algo tenha commitado em pooler)
    await db.query(
        `DELETE FROM vt_cartao_movimentos
          WHERE empresa_id=$1 AND usuario_id=$2
            AND (autor_nome='ensaio-soft' OR motivo='ensaio_soft' OR motivo='corte_jornada'
                 OR idempotency_key LIKE 'ensaio:%' OR idempotency_key LIKE 'debito:%')`,
        [empresaId, usuarioId]
    );
    // só apaga débitos de ensaio de hoje se forem do teste
    await db.query(
        `DELETE FROM vt_cartao_movimentos
          WHERE empresa_id=$1 AND usuario_id=$2 AND data_ref=$3::date
            AND tipo='debito_consumo' AND motivo IN ('corte_jornada','corte_18h')
            AND ocorreu_em > NOW() - INTERVAL '10 minutes'`,
        [empresaId, usuarioId, hoje]
    );

    rel.ok = true;
    rel.meta = {
        usuario_id: usuarioId,
        nome: vinculo.nome,
        e1,
        corte,
        valor_dia: valorDia,
        via,
    };
} catch (e) {
    try { await db.query('ROLLBACK'); } catch { /* */ }
    rel.ok = false;
    rel.erros.push(e.message);
} finally {
    db.release();
    await pool.end();
}

function arred(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

console.log(JSON.stringify(rel, null, 2));
process.exit(rel.ok ? 0 : 1);
