// api/utils/diagnosticoProducao.js

export async function gerarDiagnosticoCompleto(dbClient, empresaId) {
    // 1. BULK DATA
    const [
        demandasResult,
        opsResult,
        arrematesResult,
        produtosResult,
        cortesResult,
        cortesVinculadosResult
    ] = await Promise.all([
        dbClient.query(`SELECT * FROM demandas_producao WHERE empresa_id = $1 AND status NOT IN ('cancelada') AND arquivada_em IS NULL ORDER BY prioridade ASC, data_solicitacao ASC`, [empresaId]),
        dbClient.query(`SELECT op.id, op.numero, op.demanda_id, op.produto_id, op.variante, op.quantidade, op.status, op.etapas
                        FROM ordens_de_producao op
                        JOIN demandas_producao d ON d.id = op.demanda_id AND d.empresa_id = $1
                        WHERE op.demanda_id IS NOT NULL`, [empresaId]),
        dbClient.query(`SELECT arremates.op_numero, arremates.quantidade_arrematada, arremates.quantidade_ja_embalada
                        FROM arremates
                        JOIN ordens_de_producao op ON arremates.op_numero = op.numero
                        JOIN demandas_producao d ON d.id = op.demanda_id AND d.empresa_id = $1
                        WHERE op.demanda_id IS NOT NULL AND arremates.tipo_lancamento = 'PRODUCAO'`, [empresaId]),
        dbClient.query("SELECT id, nome, sku, is_kit, grade, imagem FROM produtos WHERE empresa_id = $1", [empresaId]),
        // Agrega cortes DISPONÍVEIS por produto+variante para exibir no painel
        // op IS NULL = corte ainda não consumido por nenhuma OP
        // Não filtra por demanda_id pois cortes históricos podem ter sido criados sem vínculo de demanda
        dbClient.query(`
            SELECT
                c.produto_id,
                COALESCE(c.variante, '-') AS variante,
                COALESCE(SUM(c.quantidade) FILTER (WHERE c.status = 'cortados'), 0)::int  AS cortado,
                COALESCE(SUM(c.quantidade) FILTER (WHERE c.status = 'pendente'), 0)::int  AS pendente
            FROM cortes c
            JOIN produtos p ON p.id = c.produto_id AND p.empresa_id = $1
            WHERE c.status != 'excluido' AND c.op IS NULL
            GROUP BY c.produto_id, c.variante
        `, [empresaId]),
        // Cortes em estoque DIRETAMENTE vinculados a uma demanda (demanda_id IS NOT NULL)
        // Usado para mostrar o badge "corte vinculado" no card da demanda no painel
        dbClient.query(`
            SELECT
                c.demanda_id,
                COALESCE(SUM(c.quantidade) FILTER (WHERE c.status = 'cortados'), 0)::int AS cortado_vinculado
            FROM cortes c
            JOIN demandas_producao d ON d.id = c.demanda_id AND d.empresa_id = $1
            WHERE c.status = 'cortados'
              AND c.op IS NULL
              AND c.demanda_id IS NOT NULL
            GROUP BY c.demanda_id
        `, [empresaId])
    ]);

    // 2. MAPAS DE PRODUTOS
    const produtosMapById = new Map(produtosResult.rows.map(p => [p.id, p]));
    const produtosMapBySku = new Map();
    
    produtosResult.rows.forEach(p => {
        if (p.sku) produtosMapBySku.set(p.sku.trim().toUpperCase(), p);
        let grade = p.grade;
        if (typeof grade === 'string') try { grade = JSON.parse(grade); } catch(e){}
        if (Array.isArray(grade)) {
            grade.forEach(g => {
                if(g.sku) produtosMapBySku.set(g.sku.trim().toUpperCase(), { ...p, gradeInfo: g });
            });
        }
    });

    // 3. MAPA DE CORTES — chave: "produto_id|variante"
    // Não usa demanda_id pois cortes históricos podem não ter esse vínculo
    const cortesMap = new Map();
    cortesResult.rows.forEach(c => {
        const chave = `${c.produto_id}|${c.variante}`;
        cortesMap.set(chave, {
            cortado: c.cortado || 0,
            pendente: c.pendente || 0,
        });
    });

    // 3b. MAPA DE CORTES VINCULADOS — chave: demanda_id
    // Cortes em estoque que têm demanda_id apontando para uma demanda específica
    const cortesVinculadosMap = new Map();
    cortesVinculadosResult.rows.forEach(c => {
        cortesVinculadosMap.set(c.demanda_id, (cortesVinculadosMap.get(c.demanda_id) || 0) + (c.cortado_vinculado || 0));
    });

    // 4. HELPERS DE CÁLCULO
    const obterQuantidadeFinalProduzida = (op) => {
        if (!op || !Array.isArray(op.etapas) || op.etapas.length === 0) return parseInt(op?.quantidade, 10) || 0;
        for (let i = op.etapas.length - 1; i >= 0; i--) { 
            const etapa = op.etapas[i]; 
            if (etapa && etapa.lancado && etapa.quantidade !== null) { 
                const qtd = parseInt(etapa.quantidade, 10);
                if (!isNaN(qtd) && qtd >= 0) return qtd;
            } 
        }
        return parseInt(op.quantidade, 10) || 0;
    };

    const arrematadoPorOp = new Map();
    const embaladoPorOp = new Map();
    arrematesResult.rows.forEach(ar => {
        const opNum = String(ar.op_numero);
        arrematadoPorOp.set(opNum, (arrematadoPorOp.get(opNum) || 0) + ar.quantidade_arrematada);
        embaladoPorOp.set(opNum, (embaladoPorOp.get(opNum) || 0) + ar.quantidade_ja_embalada);
    });

    // 4. MAPA DE PROGRESSO DETALHADO
    // Chave: DemandaID|ProdutoID|Variante
    // (Importante para diferenciar componentes diferentes dentro de um mesmo Kit/Demanda)
    const progressoMap = new Map();
    const getProg = (dId, pId, vari) => {
        const chave = `${dId}|${pId}|${vari || '-'}`;
        if (!progressoMap.has(chave)) progressoMap.set(chave, { costura: 0, arremate: 0, embalagem: 0, estoque: 0, perda: 0 });
        return progressoMap.get(chave);
    };

    opsResult.rows.forEach(op => {
        if (!op.demanda_id) return;
        const prog = getProg(op.demanda_id, op.produto_id, op.variante);

        if (op.status === 'em-aberto' || op.status === 'produzindo') {
            prog.costura += parseInt(op.quantidade) || 0;
        } 
        else if (op.status === 'finalizado') {
            const opNum = String(op.numero);
            const qtdProduzidaReal = obterQuantidadeFinalProduzida(op);
            const qtdOriginal = parseInt(op.quantidade) || 0;
            
            // Perda/Quebra
            prog.perda += Math.max(0, qtdOriginal - qtdProduzidaReal);

            const qtdArrematada = arrematadoPorOp.get(opNum) || 0;
            const qtdEmbalada = embaladoPorOp.get(opNum) || 0;

            prog.estoque += qtdEmbalada;
            prog.embalagem += Math.max(0, qtdArrematada - qtdEmbalada);
            prog.arremate += Math.max(0, qtdProduzidaReal - qtdArrematada);
        }
    });

    // 5. MONTAR LISTA FINAL (AGREGADOS)
    const agregadosMap = new Map();

    const processarItem = (demandaOriginal, produtoId, variante, quantidadeNecessaria) => {
        const produtoInfo = produtosMapById.get(produtoId);
        if (!produtoInfo) return;

        // Chave Única Visual: DemandaID + ProdutoID + Variante
        const chaveUnica = `${demandaOriginal.id}|${produtoId}|${variante || '-'}`;
        
        // Busca o progresso específico deste componente nesta demanda
        const prog = getProg(demandaOriginal.id, produtoId, variante);
        
        const totalProcessado = prog.costura + prog.arremate + prog.embalagem + prog.estoque + prog.perda;
        const saldoFila = Math.max(0, quantidadeNecessaria - totalProcessado);

        const gradeInfo = produtoInfo.grade?.find(g => g.variacao === (variante === '-' ? null : variante));

        // Dados de corte para este produto/variante (independe de demanda_id)
        const chaveCorte = `${produtoId}|${variante || '-'}`;
        const corteInfo  = cortesMap.get(chaveCorte) || { cortado: 0, pendente: 0 };

        // Cortes DIRETAMENTE vinculados a esta demanda (pelo campo demanda_id do corte)
        const corteVinculadoQtd = cortesVinculadosMap.get(demandaOriginal.id) || 0;

        // LÓGICA DE NORMALIZAÇÃO DE PRIORIDADE:
        // O banco pode ter 1, 2, 99 ou null.
        // Queremos entregar pro frontend apenas:
        // 1 = Urgente
        // 2 = Normal (inclui o antigo 99 e nulls)
        
        let prioridadeBruta = parseInt(demandaOriginal.prioridade);
        let prioridadeFinal = (prioridadeBruta === 1) ? 1 : 2;

        agregadosMap.set(chaveUnica, {
            // Rastreio
            demanda_id: demandaOriginal.id,
            produto_id: produtoId,
            produto_sku: demandaOriginal.produto_sku,
            variante: variante === '-' ? null : variante,

            // Visual
            produto_nome: gradeInfo ? `${produtoInfo.nome} (${gradeInfo.variacao})` : produtoInfo.nome,
            imagem: gradeInfo?.imagem || produtoInfo.imagem,

            prioridade: prioridadeFinal,

            // Metadados da demanda original
            data_solicitacao: demandaOriginal.data_solicitacao,
            solicitado_por: demandaOriginal.solicitado_por,
            observacoes: demandaOriginal.observacoes,

            // Números do Pipeline
            demanda_total: quantidadeNecessaria,
            saldo_em_fila: saldoFila,
            saldo_em_producao: prog.costura,
            saldo_disponivel_arremate: prog.arremate,
            saldo_disponivel_embalagem: prog.embalagem,
            saldo_disponivel_estoque: prog.estoque,
            saldo_perda: prog.perda,

            credito_total: totalProcessado + saldoFila,
            demandas_dependentes_ids: [demandaOriginal.id],

            // Dados de corte — usados no badge do card e no sub-filtro da aba Aguardando
            // corte_cortado   : pçs cortadas e prontas (qualquer corte do produto+variante)
            // corte_pendente  : pçs com corte registrado mas ainda não executado
            // corte_vinculado : pçs de cortes que têm demanda_id apontando para ESTA demanda
            //                   → indica que há um corte em estoque "guardado" para esta demanda
            corte_cortado:    corteInfo.cortado,
            corte_pendente:   corteInfo.pendente,
            corte_vinculado:  corteVinculadoQtd
        });
    };

    for (const demanda of demandasResult.rows) {
        const skuBusca = demanda.produto_sku ? demanda.produto_sku.trim().toUpperCase() : '';
        const produtoPrincipal = produtosMapBySku.get(skuBusca);
        if (!produtoPrincipal) continue;

        if (produtoPrincipal.is_kit) {
            // --- EXPLOSÃO DE KIT ---
            const gradeInfo = produtoPrincipal.gradeInfo;
            if (gradeInfo && gradeInfo.composicao && Array.isArray(gradeInfo.composicao)) {
                gradeInfo.composicao.forEach(comp => {
                    const qtdTotalComp = demanda.quantidade_solicitada * comp.quantidade;
                    processarItem(demanda, comp.produto_id, comp.variacao, qtdTotalComp);
                });
            }
        } else {
            // --- PRODUTO SIMPLES ---
            const variante = produtoPrincipal.gradeInfo?.variacao;
            processarItem(demanda, produtoPrincipal.id, variante, demanda.quantidade_solicitada);
        }
    }

    // Auto-Conclusão no Banco (Por Demanda)
    // Uma demanda só acaba quando TODOS os seus componentes acabam (sem perdas críticas)
    // Para simplificar: se o estoque >= total demandado, consideramos ok.
    const statusPorDemanda = new Map();
    agregadosMap.forEach(item => {
        if (!statusPorDemanda.has(item.demanda_id)) statusPorDemanda.set(item.demanda_id, { ok: true });
        // Se qualquer componente ainda tem fila ou está no meio do processo, não acabou.
        if (item.saldo_disponivel_estoque < item.demanda_total) {
            statusPorDemanda.get(item.demanda_id).ok = false;
        }
    });

    statusPorDemanda.forEach((status, demandaId) => {
        if (status.ok) {
             const demandaOriginal = demandasResult.rows.find(d => d.id === demandaId);
             if (demandaOriginal && demandaOriginal.status !== 'concluida') {
                 dbClient.query(`UPDATE demandas_producao SET status = 'concluida', data_conclusao = NOW() WHERE id = $1 AND empresa_id = $2`, [demandaId, empresaId]).catch(console.error);
             }
        }
    });

    // Ordenação Final
    const listaFinal = Array.from(agregadosMap.values());
    listaFinal.sort((a, b) => {
        const aConcluido = a.saldo_disponivel_estoque >= a.demanda_total;
        const bConcluido = b.saldo_disponivel_estoque >= b.demanda_total;
        if (aConcluido && !bConcluido) return 1;
        if (!aConcluido && bConcluido) return -1;
        return a.prioridade - b.prioridade;
    });

    return {
        diagnosticoPorDemanda: [],
        diagnosticoAgregado: listaFinal
    };
}

export async function verificarEAtualizarDemandasPorSKU() { return; }
export async function limparAtribuicoesOrfas() { return 0; }
