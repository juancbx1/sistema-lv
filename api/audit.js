// api/audit.js
// Helper de auditoria — insere registro no audit_log sem bloquear o fluxo principal.
// Nunca lança erro para o chamador — falha silenciosa por design.

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    timezone: 'UTC',
});

/**
 * @param {object|null} dbClient - cliente de pool já aberto (preferido) ou null para abrir novo
 * @param {object} usuarioLogado - { id, nome } do req.usuarioLogado
 * @param {string} acao - ex: 'op.encerrada', 'producao.lancada'
 * @param {string|null} entidade - ex: 'op', 'producao', 'arremate', 'corte'
 * @param {string|number|null} entidadeId - número/ID da entidade
 * @param {object} detalhes - payload livre com contexto adicional
 */
export async function registrarAuditoria(dbClient, usuarioLogado, acao, entidade = null, entidadeId = null, detalhes = {}) {
    try {
        const useExternalClient = !!dbClient;
        const client = dbClient || await pool.connect();
        try {
            const empresaInformada = Number(usuarioLogado?.empresa_id);
            let empresaId = Number.isSafeInteger(empresaInformada) && empresaInformada > 0
                ? empresaInformada
                : null;

            if (!empresaId && usuarioLogado?.id) {
                const empresaResult = await client.query(`
                    SELECT ue.empresa_id
                      FROM usuarios_empresas ue
                      JOIN empresas e ON e.id = ue.empresa_id
                     WHERE ue.usuario_id = $1
                       AND ue.ativo
                       AND e.ativa
                     ORDER BY e.eh_legada DESC, ue.empresa_principal DESC, ue.id
                     LIMIT 1
                `, [usuarioLogado.id]);
                empresaId = empresaResult.rows[0]?.empresa_id || null;
            }

            if (!empresaId) {
                console.warn('[audit_log] Contexto empresarial ausente; auditoria ignorada:', acao);
                return;
            }

            await client.query(
                `INSERT INTO audit_log
                    (empresa_id, usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    empresaId,
                    usuarioLogado?.id ?? null,
                    usuarioLogado?.nome ?? 'Sistema',
                    acao,
                    entidade ?? null,
                    entidadeId != null ? String(entidadeId) : null,
                    JSON.stringify(detalhes),
                ]
            );
        } finally {
            if (!useExternalClient) client.release();
        }
    } catch (err) {
        console.warn('[audit_log] Falha ao registrar auditoria:', acao, err.message);
    }
}
