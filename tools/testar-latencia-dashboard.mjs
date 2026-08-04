/**
 * Mede latência dos endpoints da dashboard inicial (paralelo e sequencial).
 * Uso: node tools/testar-latencia-dashboard.mjs
 * Requer POSTGRES_URL + JWT_SECRET. Servidor em BASE_URL (default http://127.0.0.1:3000).
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import pkg from 'pg';

const { Pool } = pkg;
const BASE = process.env.DASH_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:3000';
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

if (!process.env.JWT_SECRET) {
    console.error(JSON.stringify({ ok: false, erro: 'JWT_SECRET ausente' }, null, 2));
    process.exit(1);
}

const db = await pool.connect();
let token;
let meta;

try {
    const u = await db.query(`
        SELECT u.id, u.nome, ue.empresa_id, e.nome_fantasia, ue.tipos
          FROM usuarios u
          JOIN usuarios_empresas ue ON ue.usuario_id = u.id AND ue.ativo
          JOIN empresas e ON e.id = ue.empresa_id
         WHERE COALESCE(ue.valor_passagem_diaria, 0) > 0
         ORDER BY ue.empresa_id, u.id
         LIMIT 1
    `);
    if (!u.rows.length) throw new Error('Nenhum usuário de teste encontrado');
    const row = u.rows[0];
    meta = {
        usuario_id: row.id,
        nome: row.nome,
        empresa_id: row.empresa_id,
        empresa: row.nome_fantasia,
        base: BASE,
    };
    token = jwt.sign(
        {
            id: row.id,
            nome: row.nome,
            tipos: row.tipos || ['costureira'],
            empresa_id: row.empresa_id,
        },
        process.env.JWT_SECRET,
        { expiresIn: '30m' }
    );
} finally {
    db.release();
    await pool.end();
}

const rotas = [
    { id: 'desempenho', path: '/api/dashboard/desempenho' },
    { id: 'avisos', path: '/api/avisos-popup/pendentes' },
    { id: 'contexto-empresa', path: '/api/contexto-empresa' },
    { id: 'meu-status', path: '/api/producao/meu-status' },
    { id: 'ranking-semana', path: '/api/dashboard/ranking-semana' },
    { id: 'meu-vt', path: '/api/dashboard/meu-vt' },
    { id: 'usuarios-me', path: '/api/usuarios/me' },
];

async function medir(path) {
    const t0 = performance.now();
    let status = 0;
    let bytes = 0;
    let erro = null;
    try {
        const res = await fetch(`${BASE}${path}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        status = res.status;
        const text = await res.text();
        bytes = text.length;
        if (!res.ok) erro = text.slice(0, 200);
    } catch (e) {
        erro = e.message;
        status = 0;
    }
    const ms = Math.round(performance.now() - t0);
    return { path, status, ms, bytes, erro };
}

// Warm-up (descarta 1ª chamada fria de TLS/pool)
await medir('/api/contexto-empresa');

const sequencial = [];
for (const r of rotas) {
    sequencial.push({ id: r.id, ...(await medir(r.path)) });
}

const tPar0 = performance.now();
const paraleloRaw = await Promise.all(rotas.map((r) => medir(r.path).then((m) => ({ id: r.id, ...m }))));
const msParaleloTotal = Math.round(performance.now() - tPar0);

const somaSeq = sequencial.reduce((a, b) => a + b.ms, 0);
const lento = [...sequencial].sort((a, b) => b.ms - a.ms);

const inconsistencias = [];
for (const item of sequencial) {
    if (item.status === 0) {
        inconsistencias.push({
            tipo: 'servidor_indisponivel',
            detalhe: `${item.id}: ${item.erro || 'connection failed'} — suba o server local (npm run server) ou defina DASH_BASE_URL`,
        });
    } else if (item.status >= 400) {
        inconsistencias.push({
            tipo: 'http_erro',
            detalhe: `${item.id}: HTTP ${item.status}`,
            amostra: item.erro,
        });
    } else if (item.ms > 1500) {
        inconsistencias.push({
            tipo: 'lento',
            detalhe: `${item.id}: ${item.ms}ms (>1.5s)`,
        });
    }
}

// Cascata legada vs bootstrap paralelo
inconsistencias.push({
    tipo: 'arquitetura',
    detalhe:
        'Antes: paint após desempenho; ranking/VT/status/empresa só depois (cascata). Agora bootstrap paralelo no main-dashboard.',
});

// Double-fetch residual
inconsistencias.push({
    tipo: 'double_fetch_residual',
    detalhe:
        'useMenuContexto ainda chama /usuarios/me + /contexto-empresa após o mount (redundante com bootstrap). Não causa pop-in se empresa já veio no bootstrap, mas gasta rede.',
});

if (sequencial.find((s) => s.id === 'meu-status' && s.ms > 800)) {
    inconsistencias.push({
        tipo: 'backend_pesado',
        detalhe:
            'meu-status reconcilia jornada no ponto-motor antes de responder — costuma ser o endpoint mais lento da tela inicial.',
    });
}

const rel = {
    ok: sequencial.every((s) => s.status > 0 && s.status < 400),
    meta,
    sequencial_ms: sequencial.map((s) => ({
        id: s.id,
        ms: s.ms,
        status: s.status,
        bytes: s.bytes,
    })),
    soma_sequencial_ms: somaSeq,
    paralelo_total_ms: msParaleloTotal,
    ganho_paralelo_ms: Math.max(0, somaSeq - msParaleloTotal),
    ranking_lentidao: lento.map((s) => `${s.id}:${s.ms}ms`),
    paralelo: paraleloRaw.map((s) => ({ id: s.id, ms: s.ms, status: s.status })),
    inconsistencias,
};

console.log(JSON.stringify(rel, null, 2));
process.exit(rel.ok ? 0 : 1);
