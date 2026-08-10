import {
    construirCteOrigensProdutoPronto,
    obterEstruturaOrigensProdutoPronto,
} from './origens-produto-pronto.js';

function obterQuantidadeFinalProduzida(op) {
    if (!op || !Array.isArray(op.etapas) || op.etapas.length === 0) {
        return Number.parseInt(op?.quantidade, 10) || 0;
    }
    for (let i = op.etapas.length - 1; i >= 0; i -= 1) {
        const etapa = op.etapas[i];
        const quantidade = Number.parseInt(etapa?.quantidade, 10);
        if (etapa?.lancado && Number.isFinite(quantidade) && quantidade >= 0) return quantidade;
    }
    return Number.parseInt(op.quantidade, 10) || 0;
}

/**
 * Lista o saldo disponível para registrar perdas por produto/variante.
 * A consulta é compartilhada pela rota canônica de Produções e pelo alias
 * legado de Arremates.
 */
export async function listarFilaPerdasProducao({ dbClient, query = {}, empresaId }) {
    const {
        search,
        sortBy = 'data_op_mais_recente',
        page = 1,
        limit = 6,
        fetchAll = 'false',
    } = query;

    const mediasResult = await dbClient.query(`
        SELECT produto_id,
               AVG((EXTRACT(EPOCH FROM (data_fim - data_inicio)) - tempo_pausado_segundos)
                   / NULLIF(quantidade_finalizada, 0)) AS media_tempo_por_peca
          FROM sessoes_trabalho_arremate
         WHERE empresa_id = $1
           AND status = 'FINALIZADA'
           AND quantidade_finalizada > 0
         GROUP BY produto_id
    `, [empresaId]);
    const mapaDeMedias = new Map(
        mediasResult.rows.map(row => [row.produto_id, parseFloat(row.media_tempo_por_peca)]),
    );

    const opsResult = await dbClient.query(`
        SELECT op.produto_id, op.variante, p.nome AS produto,
               p.imagem AS imagem_produto, p.grade,
               op.etapas, op.quantidade, op.data_final, op.numero, op.edit_id
          FROM ordens_de_producao op
          JOIN produtos p ON op.produto_id = p.id AND p.empresa_id = op.empresa_id
         WHERE op.empresa_id = $1
           AND op.status = 'finalizado'
    `, [empresaId]);

    // A origem canônica é a autoridade para produções POS_OP. Perdas ainda
    // ficam em `arremates` porque possuem metadados de ajuste próprios; a
    // CTE de compatibilidade evita duplicar o arremate legado que já recebeu
    // uma origem canônica.
    const estruturaOrigens = await obterEstruturaOrigensProdutoPronto(dbClient);
    const cteOrigens = construirCteOrigensProdutoPronto(estruturaOrigens.origens);
    const arrematesResult = await dbClient.query(`
        ${cteOrigens}, LancamentosPorOp AS (
            SELECT produto_id, variante, op_numero,
                   quantidade_disponibilizada AS quantidade
              FROM OrigensProdutoProntoCompat
             WHERE empresa_id = $1

            UNION ALL

            SELECT produto_id, variante, op_numero,
                   quantidade_arrematada AS quantidade
              FROM arremates
             WHERE empresa_id = $1
               AND tipo_lancamento = 'PERDA'
        )
        SELECT produto_id, variante, op_numero,
               SUM(quantidade) AS total_arrematado
          FROM LancamentosPorOp
         GROUP BY produto_id, variante, op_numero
    `, [empresaId]);
    const arrematadoPorOp = new Map();
    arrematesResult.rows.forEach((arr) => {
        const chave = `${arr.op_numero}|${arr.variante || '-'}`;
        arrematadoPorOp.set(chave, Number.parseInt(arr.total_arrematado, 10) || 0);
    });

    const sessoesProducaoColunasResult = await dbClient.query(`
        SELECT
            EXISTS (
                SELECT 1
                  FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'sessoes_trabalho_producao'
                   AND column_name = 'fase'
            ) AS possui_fase,
            EXISTS (
                SELECT 1
                  FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'sessoes_trabalho_producao'
                   AND column_name = 'funcionario_id'
            ) AS possui_funcionario
    `);
    const possuiSessoesProducaoPosOp = sessoesProducaoColunasResult.rows[0]?.possui_fase
        && sessoesProducaoColunasResult.rows[0]?.possui_funcionario;
    const sessoesCanonicasResult = possuiSessoesProducaoPosOp
        ? await dbClient.query(`
            SELECT s.produto_id, s.variante, s.quantidade_atribuida,
                   u.nome AS executor_nome
              FROM sessoes_trabalho_producao s
              LEFT JOIN usuarios u ON u.id = s.funcionario_id
             WHERE s.empresa_id = $1
               AND s.fase = 'POS_OP'
               AND s.status = 'EM_ANDAMENTO'
        `, [empresaId])
        : { rows: [] };

    const sessoesAtivasResult = await dbClient.query(`
        SELECT s.produto_id, s.variante, s.quantidade_entregue,
               u.nome AS tiktik_nome
          FROM sessoes_trabalho_arremate s
          JOIN usuarios u ON s.usuario_tiktik_id = u.id
         WHERE s.empresa_id = $1
           AND s.status = 'EM_ANDAMENTO'
    `, [empresaId]);
    const emTrabalhoAgregado = new Map();
    sessoesCanonicasResult.rows.forEach((sessao) => {
        const chaveAgregada = `${sessao.produto_id}|${sessao.variante || '-'}`;
        if (!emTrabalhoAgregado.has(chaveAgregada)) {
            emTrabalhoAgregado.set(chaveAgregada, { quantidade: 0, tiktiks: [] });
        }
        const item = emTrabalhoAgregado.get(chaveAgregada);
        item.quantidade += Number(sessao.quantidade_atribuida) || 0;
        if (sessao.executor_nome) item.tiktiks.push(sessao.executor_nome);
    });
    sessoesAtivasResult.rows.forEach((sessao) => {
        const chaveAgregada = `${sessao.produto_id}|${sessao.variante || '-'}`;
        if (!emTrabalhoAgregado.has(chaveAgregada)) {
            emTrabalhoAgregado.set(chaveAgregada, { quantidade: 0, tiktiks: [] });
        }
        const item = emTrabalhoAgregado.get(chaveAgregada);
        item.quantidade += Number(sessao.quantidade_entregue) || 0;
        item.tiktiks.push(sessao.tiktik_nome);
    });

    const pendenciasAgregadas = new Map();
    opsResult.rows.forEach((op) => {
        const qtdProduzida = obterQuantidadeFinalProduzida(op);
        const chaveOp = `${op.numero}|${op.variante || '-'}`;
        const qtdArrematada = arrematadoPorOp.get(chaveOp) || 0;
        const saldoOpBruto = qtdProduzida - qtdArrematada;
        if (saldoOpBruto <= 0) return;

        const chaveAgregada = `${op.produto_id}|${op.variante || '-'}`;
        if (!pendenciasAgregadas.has(chaveAgregada)) {
            const tarefaAtivaInfo = emTrabalhoAgregado.get(chaveAgregada);
            pendenciasAgregadas.set(chaveAgregada, {
                produto_id: op.produto_id,
                produto_nome: op.produto,
                imagem: op.imagem_produto,
                grade: op.grade,
                variante: op.variante || '-',
                saldo_total_bruto: 0,
                quantidade_em_trabalho: tarefaAtivaInfo ? tarefaAtivaInfo.quantidade : 0,
                tarefa_ativa_por: tarefaAtivaInfo ? tarefaAtivaInfo.tiktiks.join(', ') : null,
                ops_detalhe: [],
                data_op_mais_recente: new Date(0),
                data_op_mais_antiga: new Date('2999-12-31'),
                media_tempo_por_peca: mapaDeMedias.get(op.produto_id) || null,
            });
        }

        const item = pendenciasAgregadas.get(chaveAgregada);
        item.saldo_total_bruto += saldoOpBruto;
        const dataOp = op.data_final ? new Date(op.data_final) : new Date(0);
        item.ops_detalhe.push({
            numero: op.numero,
            edit_id: op.edit_id,
            saldo_op: saldoOpBruto,
            data_final: dataOp.toISOString(),
        });
        if (dataOp > item.data_op_mais_recente) item.data_op_mais_recente = dataOp;
        if (dataOp < item.data_op_mais_antiga) item.data_op_mais_antiga = dataOp;
    });

    let resultadosFinais = Array.from(pendenciasAgregadas.values())
        .map(item => ({
            ...item,
            saldo_para_arrematar: item.saldo_total_bruto - item.quantidade_em_trabalho,
        }))
        .filter(item => item.saldo_total_bruto > 0);

    const totalGruposDeProdutos = resultadosFinais.length;
    const totalPecasPendentes = resultadosFinais.reduce(
        (total, item) => total + item.saldo_para_arrematar,
        0,
    );

    if (search) {
        const searchTermLower = String(search).toLowerCase();
        resultadosFinais = resultadosFinais.filter(item => (
            item.produto_nome.toLowerCase().includes(searchTermLower)
            || (item.variante && item.variante.toLowerCase().includes(searchTermLower))
        ));
    }

    switch (sortBy) {
        case 'maior_quantidade':
            resultadosFinais.sort((a, b) => b.saldo_para_arrematar - a.saldo_para_arrematar);
            break;
        case 'menor_quantidade':
            resultadosFinais.sort((a, b) => a.saldo_para_arrematar - b.saldo_para_arrematar);
            break;
        case 'alfabetica':
            resultadosFinais.sort((a, b) => a.produto_nome.localeCompare(b.produto_nome));
            break;
        default:
            resultadosFinais.sort(
                (a, b) => new Date(b.data_op_mais_recente) - new Date(a.data_op_mais_recente),
            );
            break;
    }

    if (fetchAll === 'true') return { rows: resultadosFinais };

    const limitNum = Number.parseInt(limit, 10);
    const pagina = Number.parseInt(page, 10);
    const offset = (pagina - 1) * limitNum;
    const totalPages = Math.ceil(resultadosFinais.length / limitNum) || 1;
    return {
        rows: resultadosFinais.slice(offset, offset + limitNum),
        pagination: {
            currentPage: pagina,
            totalPages,
            totalItems: totalGruposDeProdutos,
            totalPecas: totalPecasPendentes,
            limit: limitNum,
        },
    };
}
