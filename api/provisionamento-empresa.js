/**
 * Provisionamento de catálogos empresariais.
 *
 * Cada catálogo possui sua própria função SQL idempotente. O helper verifica
 * se a migration correspondente já foi executada para manter o cadastro de
 * empresas compatível durante a janela de rollout da migration.
 */
export async function provisionarCatalogosEmpresa(client, empresaId) {
    const resultado = {
        processos: {
            disponivel: false,
            criados: 0,
        },
    };

    const funcaoProcessos = await client.query(
        `SELECT to_regprocedure(
            'public.provisionar_processos_producao_empresa(integer)'
        ) IS NOT NULL AS disponivel`
    );

    if (!funcaoProcessos.rows[0]?.disponivel) {
        return resultado;
    }

    const processos = await client.query(
        `SELECT public.provisionar_processos_producao_empresa($1)::integer AS criados`,
        [empresaId]
    );

    resultado.processos.disponivel = true;
    resultado.processos.criados = Number(processos.rows[0]?.criados || 0);
    return resultado;
}
