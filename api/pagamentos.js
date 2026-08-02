// api/pagamentos.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import express from 'express';
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';
import { obterEmpresaIdDoContexto } from './contexto-empresa.js';

const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    timezone: 'UTC',
});
const NOMES_CATEGORIAS_PAGAMENTO = {
    SALARIO: 'Salário',
    BONUS_PREMIACOES: 'Bônus e Premiações',
    VALE_TRANSPORTE: 'Vale Transporte',
    COMISSAO: 'Comissão',
    BENEFICIOS_DIVERSOS: 'Vale Alimentação',
    TAXA_VT: 'Taxas de VT',
};

function erroPagamento(statusCode, message) {
    return Object.assign(new Error(message), { statusCode });
}

function numeroPagamento(valor) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : 0;
}

async function carregarVinculoEmpregado(
    dbClient,
    usuarioId,
    empresaId,
    { exigirAtivo = true, exigirElegivel = false } = {}
) {
    const result = await dbClient.query(
        `SELECT
            u.id,
            u.nome,
            u.nome_completo,
            ue.tipos,
            ue.nivel,
            ue.salario_fixo,
            ue.valor_passagem_diaria,
            ue.elegivel_pagamento,
            ue.id_contato_financeiro,
            ue.desconto_inss_percentual,
            ue.desconto_vt_percentual,
            ue.data_admissao,
            ue.data_demissao,
            ue.dias_trabalho,
            ue.ativo,
            e.eh_legada
         FROM usuarios_empresas ue
         JOIN usuarios u ON u.id = ue.usuario_id
         JOIN empresas e ON e.id = ue.empresa_id
         WHERE ue.usuario_id = $1
           AND ue.empresa_id = $2
           AND ($3::boolean = FALSE OR ue.ativo)`,
        [usuarioId, empresaId, exigirAtivo]
    );
    if (result.rows.length === 0) {
        throw erroPagamento(404, 'Empregado não encontrado na empresa ativa.');
    }
    const vinculo = {
        ...result.rows[0],
        salario_fixo: numeroPagamento(result.rows[0].salario_fixo),
        valor_passagem_diaria: numeroPagamento(result.rows[0].valor_passagem_diaria),
        desconto_inss_percentual: numeroPagamento(
            result.rows[0].desconto_inss_percentual
        ),
        desconto_vt_percentual: numeroPagamento(
            result.rows[0].desconto_vt_percentual
        ),
    };
    if (exigirElegivel && !vinculo.elegivel_pagamento) {
        throw erroPagamento(409, 'Este vínculo não está elegível para pagamentos.');
    }
    return vinculo;
}

function exigirProducaoDisponivel(vinculo) {
    if (!vinculo.eh_legada) {
        throw erroPagamento(
            409,
            'Comissões baseadas em produção serão liberadas após a migração da cadeia produtiva desta empresa.'
        );
    }
}

async function carregarCategoriasPagamento(dbClient, empresaId, chavesNecessarias) {
    const nomes = chavesNecessarias.map((chave) => {
        const nome = NOMES_CATEGORIAS_PAGAMENTO[chave];
        if (!nome) {
            throw new Error(`Categoria lógica de pagamento inválida: "${chave}".`);
        }
        return nome;
    });
    const result = await dbClient.query(
        `SELECT c.id, c.nome
           FROM fc_categorias c
           JOIN fc_grupos_financeiros g
             ON g.id = c.id_grupo
            AND g.empresa_id = c.empresa_id
          WHERE c.empresa_id = $1
            AND c.nome = ANY($2::text[])
            AND g.tipo = 'DESPESA'`,
        [empresaId, nomes]
    );

    const porNome = new Map();
    for (const categoria of result.rows) {
        if (porNome.has(categoria.nome)) {
            throw new Error(
                `A empresa possui mais de uma categoria financeira chamada "${categoria.nome}".`
            );
        }
        porNome.set(categoria.nome, categoria.id);
    }

    const mapa = {};
    for (const chave of chavesNecessarias) {
        const nome = NOMES_CATEGORIAS_PAGAMENTO[chave];
        const id = porNome.get(nome);
        if (!id) {
            throw new Error(
                `A categoria financeira obrigatória "${nome}" não está configurada para a empresa ativa.`
            );
        }
        mapa[chave] = id;
    }
    return mapa;
}

// --- Middleware de Autenticação para este Módulo ---
router.use(async (req, res, next) => {

    let dbClient;
    try {
        const empresaId = obterEmpresaIdDoContexto(req);
        if (!req.usuarioLogado?.id) {
            return res.status(401).json({ error: 'Usuário autenticado não encontrado.' });
        }

        dbClient = await pool.connect();
        req.permissoesUsuario = await getPermissoesCompletasUsuarioDB(
            dbClient,
            req.usuarioLogado.id,
            empresaId
        );
        req.empresaId = empresaId;
        
        next(); // Passa para a rota específica (ex: /efetuar, /registros-dias)

    } catch (error) {
        console.error('[PAGAMENTOS MIDDLEWARE] Erro:', error);
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao validar o contexto empresarial.',
        });
    } finally {
        // IMPORTANTE: O middleware libera a conexão.
        // As rotas que o seguem precisarão de sua própria conexão.
        if (dbClient) dbClient.release();
    }
});

// --- ROTA PRINCIPAL DE CÁLCULO ---
router.get('/calcular', async (req, res) => {
    // Agora aceita 'competencia' (Ex: "Janeiro/2026") em vez de ciclo_index
    const { usuario_id, tipo_pagamento, competencia, data_inicio, data_fim, mes_referencia } = req.query;

    if (!usuario_id || !tipo_pagamento) {
        return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });
    }

    // Variáveis de Retorno
    let valorComissao = 0;
    let totalPontosComissao = 0;
    let totalPontosResgatados = 0;
    let periodoDetalhe = "";
    let detalhesDias = []; // Substitui detalhesSemanas
    
    // Outros tipos (mantidos simples)
    let salarioProporcional = 0;
    let valorTotalPassagens = 0;
    let valorBeneficios = 0;
    let descontoVT = 0;

    let dbClient;
    try {
        dbClient = await pool.connect();

        const usuario = await carregarVinculoEmpregado(
            dbClient,
            usuario_id,
            req.empresaId,
            { exigirAtivo: true, exigirElegivel: true }
        );

        switch (tipo_pagamento) {
            case 'COMISSAO':
                exigirProducaoDisponivel(usuario);
                if (!competencia) return res.status(400).json({ error: 'Competência (Mês/Ano) é obrigatória.' });
                periodoDetalhe = competencia; // Ex: "Janeiro/2026"

                // 1. Calcular Início e Fim da Competência (21 a 20)
                // Competência "Janeiro/2026" vai de 21/Dez/2025 a 20/Jan/2026
                const [mesNome, anoStr] = competencia.split('/');
                const anoInt = parseInt(anoStr);
                const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
                const mesIndex = meses.indexOf(mesNome); // 0 a 11
                
                if (mesIndex === -1) throw new Error("Mês inválido.");

                // Data Final: 20 do mês da competência
                const fimCompetencia = new Date(anoInt, mesIndex, 20, 23, 59, 59, 999);
                
                // Data Inicial: 21 do mês anterior
                // Se mês for Janeiro (0), mês anterior é Dezembro (11) do ano anterior
                let anoInicio = anoInt;
                let mesInicio = mesIndex - 1;
                if (mesInicio < 0) { mesInicio = 11; anoInicio--; }
                const inicioCompetencia = new Date(anoInicio, mesInicio, 21, 0, 0, 0, 0);

                // *** CORTE LIMPO: Ignora tudo antes de 13/12/2025 ***
                const dataCorte = new Date('2025-12-13T00:00:00');
                
                // Se o fim da competência for antes do corte, nem calcula.
                if (fimCompetencia < dataCorte) {
                    valorComissao = 0;
                    detalhesDias = [];
                    break;
                }

                // Ajusta o início se cair antes do corte
                let cursor = new Date(inicioCompetencia);
                if (cursor < dataCorte) cursor = new Date(dataCorte);

                // 2. Busca Dados (Produção + Arremates + Resgates)
                const tipoUsuario = usuario.tipos?.includes('tiktik') ? 'tiktik' : 'costureira';
                
                // Busca Metas
                // Usamos a data de fim da competência para pegar a regra vigente
                const versaoQuery = `
                    SELECT id
                    FROM metas_versoes
                    WHERE empresa_id = $1
                      AND data_inicio_vigencia <= $2
                    ORDER BY data_inicio_vigencia DESC
                    LIMIT 1
                `;
                const versaoRes = await dbClient.query(
                    versaoQuery,
                    [req.empresaId, fimCompetencia.toISOString().substring(0, 10)]
                );
                
                let metasDoNivel = [];
                if (versaoRes.rows.length > 0) {
                    const regrasRes = await dbClient.query(
                        `SELECT pontos_meta, valor_comissao, descricao_meta
                           FROM metas_regras
                          WHERE id_versao = $1
                            AND empresa_id = $2
                            AND tipo_usuario = $3
                            AND nivel = $4
                          ORDER BY pontos_meta ASC`,
                        [versaoRes.rows[0].id, req.empresaId, tipoUsuario, usuario.nivel]
                    );
                    metasDoNivel = regrasRes.rows;
                }

                // Busca Produção
                let queryAtiv = `
                    SELECT data, pontos_gerados FROM producoes WHERE funcionario_id = $1 AND data BETWEEN $2 AND $3
                `;
                if (tipoUsuario === 'tiktik') {
                    queryAtiv += ` UNION ALL SELECT data_lancamento as data, pontos_gerados FROM arremates WHERE usuario_tiktik_id = $1 AND data_lancamento BETWEEN $2 AND $3 AND tipo_lancamento = 'PRODUCAO'`;
                }
                queryAtiv += ` UNION ALL
                    SELECT data_referencia::timestamptz as data, pontos as pontos_gerados
                    FROM pontos_extras
                    WHERE funcionario_id = $1
                      AND empresa_id = $4
                      AND data_referencia BETWEEN $2::date AND $3::date
                      AND cancelado = FALSE`;
                const ativRes = await dbClient.query(
                    queryAtiv,
                    [usuario.id, inicioCompetencia, fimCompetencia, req.empresaId]
                );

                // Busca Resgates
                const resgatesRes = await dbClient.query(
                    `SELECT data_evento, quantidade
                       FROM banco_pontos_log
                      WHERE usuario_id = $1
                        AND empresa_id = $2
                        AND tipo = 'RESGATE'
                        AND data_evento BETWEEN $3 AND $4`,
                    [usuario.id, req.empresaId, inicioCompetencia, fimCompetencia]
                );

                // Busca Ganhos (Pontos Extras creditados no Cofre)
                const ganhosRes = await dbClient.query(
                    `SELECT data_evento, quantidade
                       FROM banco_pontos_log
                      WHERE usuario_id = $1
                        AND empresa_id = $2
                        AND tipo = 'GANHO'
                        AND data_evento BETWEEN $3 AND $4`,
                    [usuario.id, req.empresaId, inicioCompetencia, fimCompetencia]
                );
                
                // Mapeia por dia (YYYY-MM-DD)
                const mapaProducao = {};
                const mapaResgate = {};
                const mapaGanhos = {}; // >>> ADICIONE ESTA LINHA

                ativRes.rows.forEach(r => {
                    const d = new Date(r.data).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
                    if (!mapaProducao[d]) mapaProducao[d] = 0;
                    mapaProducao[d] += parseFloat(r.pontos_gerados);
                });

                // Para resgates, a query de log pode ter vindo com nome 'quantidade'
                const resgatesRows = await dbClient.query(
                    `SELECT data_evento, quantidade
                       FROM banco_pontos_log
                      WHERE usuario_id = $1
                        AND empresa_id = $2
                        AND tipo = 'RESGATE'
                        AND data_evento BETWEEN $3 AND $4`,
                    [usuario.id, req.empresaId, inicioCompetencia, fimCompetencia]
                );
                
                resgatesRows.rows.forEach(r => {
                    const d = new Date(r.data_evento).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
                    if (!mapaResgate[d]) mapaResgate[d] = 0;
                    mapaResgate[d] += parseFloat(r.quantidade);
                });

                ganhosRes.rows.forEach(r => {
                    const d = new Date(r.data_evento).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
                    if (!mapaGanhos[d]) mapaGanhos[d] = 0;
                    mapaGanhos[d] += parseFloat(r.quantidade);
                });

                // 3. Itera Dia a Dia
                const dataLimiteIteracao = new Date(fimCompetencia);
                // Garante que o cursor tenha hora zerada para loop limpo
                cursor.setHours(0,0,0,0);
                
                while (cursor <= dataLimiteIteracao) {
                    const diaStr = cursor.toLocaleDateString('en-CA'); // YYYY-MM-DD
                    const ptsProd = mapaProducao[diaStr] || 0;
                    const ptsResg = mapaResgate[diaStr] || 0;
                    const ptsExtras = mapaGanhos[diaStr] || 0;
                    const totalDia = ptsProd + ptsResg;
                    
                    let valorDia = 0;
                    let metaNome = '-';

                    if (totalDia > 0) {
                        // Verifica qual meta bateu
                        for (let i = metasDoNivel.length - 1; i >= 0; i--) {
                            if (totalDia >= metasDoNivel[i].pontos_meta) {
                                valorDia = parseFloat(metasDoNivel[i].valor_comissao);
                                metaNome = metasDoNivel[i].descricao_meta;
                                break;
                            }
                        }
                    }

                    // Só adiciona na lista se teve movimento ou ganho
                    if (totalDia > 0 || valorDia > 0) {
                        detalhesDias.push({
                            data: cursor.toLocaleDateString('pt-BR'),
                            pontosProduzidos: ptsProd,
                            pontosResgatados: ptsResg,
                            pontosExtras: ptsExtras, 
                            totalPontos: totalDia,
                            meta: metaNome,
                            valor: valorDia
                        });
                        valorComissao += valorDia;
                        totalPontosComissao += ptsProd;
                        totalPontosResgatados += ptsResg;
                    }

                    cursor.setDate(cursor.getDate() + 1);
                }

                // Armazena dados extras para o frontend
                res.dadosDetalhados = { 
                    dias: detalhesDias,
                    resumo: {
                        totalProduzido: totalPontosComissao,
                        totalResgatado: totalPontosResgatados
                    }
                };
                break;

            case 'SALARIO':
                if (!mes_referencia) return res.status(400).json({ error: 'Mês obrigatório.' });
                salarioProporcional = usuario.salario_fixo;
                descontoVT = usuario.salario_fixo * ((usuario.desconto_vt_percentual || 0) / 100);
                periodoDetalhe = mes_referencia;
                break;

            case 'PASSAGENS':
                if (!data_inicio || !data_fim) return res.status(400).json({ error: 'Data de início e fim são obrigatórias para adiantamento de passagens.' });
                
                let diasUteis = 0;
                let dataCorrente = new Date(data_inicio + 'T00:00:00');
                const dataFinal = new Date(data_fim + 'T00:00:00');
                while (dataCorrente <= dataFinal) {
                    const diaDaSemana = dataCorrente.getUTCDay(); // 0 = Domingo, 6 = Sábado
                    if (diaDaSemana > 0 && diaDaSemana < 6) { // Se não for Domingo ou Sábado
                        diasUteis++;
                    }
                    dataCorrente.setUTCDate(dataCorrente.getUTCDate() + 1);
                }

                valorTotalPassagens = diasUteis * usuario.valor_passagem_diaria;
                // Para passagens, o desconto é aplicado no pagamento do salário, não aqui.
                // Aqui apenas calculamos o valor do adiantamento.
                periodoDetalhe = `${new Date(data_inicio + 'T00:00:00').toLocaleDateString('pt-BR')} a ${new Date(data_fim + 'T00:00:00').toLocaleDateString('pt-BR')}`;
                break;

            case 'BENEFICIOS':
                // Exemplo: buscando um valor fixo de cesta básica do JSONB (a fazer no futuro)
                valorBeneficios = (usuario.config_beneficios?.cesta_basica) || 150.00; // Valor fixo de exemplo
                periodoDetalhe = "Benefícios Diversos";
                break;

            default:
                return res.status(400).json({ error: 'Tipo de pagamento inválido.' });
        }

        // 3. Calcular Descontos (APENAS se o pagamento for de SALÁRIO)
        if (tipo_pagamento === 'SALARIO') {
            descontoVT = usuario.salario_fixo * (usuario.desconto_vt_percentual / 100);
        }

        // 4. Montar o resultado final
        const proventos = salarioProporcional + valorComissao + valorTotalPassagens + valorBeneficios;
        const descontos = descontoVT;
        const totalLiquido = proventos - descontos;

        // <<< O objeto de detalhes da comissão ANTES de montar a resposta final >>>
        const detalhesComissaoCalculada = res.dadosDetalhados 
            ? { ...res.dadosDetalhados, totalPontos: totalPontosComissao, totalComissao: valorComissao }
            : null;

        res.status(200).json({
            detalhes: {
                funcionario: { id: usuario.id, nome: usuario.nome },
                ciclo: { nome: periodoDetalhe }, // Agora é a competência (Ex: "Janeiro/2026")
                tipoPagamento: tipo_pagamento,
            },
            proventos: {
                salarioProporcional: parseFloat(salarioProporcional.toFixed(2)),
                comissao: parseFloat(valorComissao.toFixed(2)),
                valeTransporte: parseFloat(valorTotalPassagens.toFixed(2)),
                beneficios: parseFloat(valorBeneficios.toFixed(2)),
            },
            descontos: {
                valeTransporte: parseFloat(descontoVT.toFixed(2))
            },
            totais: {
                totalProventos: parseFloat(proventos.toFixed(2)),
                totalDescontos: parseFloat(descontos.toFixed(2)),
                totalLiquidoAPagar: parseFloat(totalLiquido.toFixed(2))
            },
            dadosDetalhados: res.dadosDetalhados // Envia os dias detalhados
        });

    } catch (error) {
        console.error('[API /pagamentos/calcular] Erro:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro interno ao calcular pagamento.',
            details: error.message
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.post('/efetuar', async (req, res) => {
    // <<<< CORREÇÃO: Leitura segura do tipo de pagamento >>>>
    const tipoPagamento = req.body.calculo?.detalhes?.tipoPagamento;

    if (!tipoPagamento) {
        return res.status(400).json({ error: "Payload inválido. 'tipoPagamento' não encontrado nos detalhes do cálculo." });
    }

    // Lógica de permissão refinada
    const permissoesNecessarias = {
        COMISSAO: 'permitir-pagar-comissao',
        BONUS: 'permitir-conceder-bonus',
        VALE_TRANSPORTE: 'permitir-pagar-passagens',
        SALARIO: 'permitir-pagar-salarios',
        BENEFICIOS: 'permitir-pagar-beneficios'
    };
    const permissaoRequerida = permissoesNecessarias[tipoPagamento];

    if (!permissaoRequerida || !req.permissoesUsuario.includes(permissaoRequerida)) {
        return res.status(403).json({ error: `Permissão negada para efetuar pagamento do tipo '${tipoPagamento}'.` });
    }

    // <<<< FIM DA CORREÇÃO DE PERMISSÃO >>>>

    const { calculo, id_conta_debito, datas_pagas, valor_passagem_diaria } = req.body;
    const id_usuario_pagador = req.usuarioLogado.id;
    
    // A validação completa continua aqui para garantir a integridade dos dados
    if (!calculo || !calculo.detalhes || !calculo.totais || !id_conta_debito) {
        return res.status(400).json({ error: 'Dados do cálculo ou conta de débito ausentes ou malformados.' });
    }

    const { detalhes, totais } = calculo;
    const { funcionario, ciclo } = detalhes;
    const id_funcionario = funcionario.id;
    const nome_funcionario = funcionario.nome;
    const nomeCicloOuMotivo = ciclo.nome || '';

    let dbClient;
    try {
        dbClient = await pool.connect();
        const categoriaPorTipoPagamento = {
            COMISSAO: 'COMISSAO',
            BONUS: 'BONUS_PREMIACOES',
            VALE_TRANSPORTE: 'VALE_TRANSPORTE',
            SALARIO: 'SALARIO',
            BENEFICIOS: 'BENEFICIOS_DIVERSOS',
        };
        const chaveCategoria = categoriaPorTipoPagamento[tipoPagamento];
        const categoriasPagamento = await carregarCategoriasPagamento(
            dbClient,
            req.empresaId,
            [chaveCategoria]
        );
        const contaRes = await dbClient.query(
            `SELECT id
               FROM fc_contas_bancarias
              WHERE id = $1
                AND empresa_id = $2
                AND ativo`,
            [id_conta_debito, req.empresaId]
        );
        if (contaRes.rows.length === 0) {
            throw new Error('Conta de débito não encontrada na empresa ativa.');
        }

        const vinculo = await carregarVinculoEmpregado(
            dbClient,
            id_funcionario,
            req.empresaId,
            { exigirAtivo: true, exigirElegivel: true }
        );
        if (tipoPagamento === 'COMISSAO') {
            exigirProducaoDisponivel(vinculo);
        }
        if (!vinculo.id_contato_financeiro) {
            throw erroPagamento(
                409,
                `O empregado ${vinculo.nome} não possui um contato financeiro vinculado.`
            );
        }
        const contatoRes = await dbClient.query(
            `SELECT id
               FROM fc_contatos
              WHERE id = $1
                AND empresa_id = $2`,
            [vinculo.id_contato_financeiro, req.empresaId]
        );
        if (contatoRes.rows.length === 0) {
            throw erroPagamento(
                409,
                `O contato financeiro de ${vinculo.nome} não pertence à empresa ativa.`
            );
        }
        const id_contato_financeiro = vinculo.id_contato_financeiro;
        
        await dbClient.query('BEGIN');

        const fazerLancamento = async (idCategoria, valor, descricao, idContato) => {
        if (valor <= 0) return;
        if (!idCategoria) throw new Error(`ID de categoria para "${descricao}" não configurado ou nulo.`);
                
        //    Isso garante que o timestamp salvo é o do servidor do banco de dados.
        //    Os parâmetros foram reordenados.
        await dbClient.query(
            `INSERT INTO fc_lancamentos (
                id_conta_bancaria, id_categoria, tipo, valor, data_transacao,
                descricao, id_contato, id_usuario_lancamento, empresa_id
            )
            VALUES ($1, $2, 'DESPESA', $3, NOW(), $4, $5, $6, $7)`,
            [
                id_conta_debito,
                idCategoria,
                valor,
                descricao,
                idContato,
                id_usuario_pagador,
                req.empresaId,
            ]
        );
    };

        if (tipoPagamento === 'COMISSAO') {
            const { proventos } = calculo;
            
            const checkQuery = `
                SELECT id
                FROM historico_pagamentos_funcionarios
                WHERE usuario_id = $1
                  AND ciclo_nome = $2
                  AND empresa_id = $3
            `;
            const checkResult = await dbClient.query(
                checkQuery,
                [id_funcionario, nomeCicloOuMotivo, req.empresaId]
            );
            if (checkResult.rowCount > 0) {
                await dbClient.query('ROLLBACK');
                return res.status(409).json({ error: `Pagamento de comissão para o ciclo "${nomeCicloOuMotivo}" já foi registrado.` });
            }
            
            await fazerLancamento(categoriasPagamento.COMISSAO, proventos.comissao, `Pgto Comissão (${nomeCicloOuMotivo}) para ${nome_funcionario}`, id_contato_financeiro);

        } else if (tipoPagamento === 'BONUS') {
            const { proventos } = calculo;
            await fazerLancamento(categoriasPagamento.BONUS_PREMIACOES, proventos.beneficios, `Bônus/Premiação: ${nomeCicloOuMotivo}`, id_contato_financeiro);
        
        } else if (tipoPagamento === 'SALARIO') {
            // Lançamento Financeiro Simples
            // O valor total já vem calculado do frontend em totais.totalLiquidoAPagar
            await fazerLancamento(
                categoriasPagamento.SALARIO,
                totais.totalLiquidoAPagar, 
                `Pagamento de Salário (${nomeCicloOuMotivo}) para ${nome_funcionario}`, 
                id_contato_financeiro
            );

        } else if (tipoPagamento === 'BENEFICIOS') {
            await fazerLancamento(
                categoriasPagamento.BENEFICIOS_DIVERSOS,
                totais.totalLiquidoAPagar, 
                `Pagamento de (${nomeCicloOuMotivo})`, 
                id_contato_financeiro
            );    
        
        } else if (tipoPagamento === 'VALE_TRANSPORTE') {
            if (!datas_pagas || !Array.isArray(datas_pagas) || datas_pagas.length === 0) {
                throw new Error("A lista de 'datas_pagas' é obrigatória para o pagamento de Vale-Transporte.");
            }
            if (valor_passagem_diaria === undefined || valor_passagem_diaria <= 0) {
                throw new Error("O 'valor_passagem_diaria' é obrigatório e deve ser maior que zero.");
            }

            const descricaoLancamento = `Recarga VT (${datas_pagas.length} dias)`;
            await fazerLancamento(categoriasPagamento.VALE_TRANSPORTE, totais.totalLiquidoAPagar, descricaoLancamento, id_contato_financeiro);

            for (const data of datas_pagas) {
                await dbClient.query(
                    `INSERT INTO registro_dias_trabalhados
                        (usuario_id, data, status, valor_referencia, observacao, empresa_id)
                     VALUES ($1, $2, 'PAGO', $3, $4, $5)`,
                    [
                        id_funcionario,
                        data,
                        valor_passagem_diaria,
                        `Pagamento efetuado em lote por ${req.usuarioLogado.nome}`,
                        req.empresaId
                    ]
                );
            }
        }
        
        if (totais.totalLiquidoAPagar > 0) {
            // Comissão, salário e benefícios gravam a referência em ciclo_nome para a UI bater o status PAGO
            const cicloParaSalvar =
                (tipoPagamento === 'COMISSAO' ||
                    tipoPagamento === 'SALARIO' ||
                    tipoPagamento === 'BENEFICIOS')
                    ? nomeCicloOuMotivo
                    : null;
            
            let descricaoParaSalvar = nomeCicloOuMotivo;
            if (tipoPagamento === 'COMISSAO') descricaoParaSalvar = 'Pagamento de Comissão';
            if (tipoPagamento === 'SALARIO') descricaoParaSalvar = nomeCicloOuMotivo || 'Pagamento de Salário';
            if (tipoPagamento === 'BENEFICIOS') descricaoParaSalvar = nomeCicloOuMotivo || 'Vale Alimentação';
            if (tipoPagamento === 'VALE_TRANSPORTE') descricaoParaSalvar = `Recarga VT (${datas_pagas.length} dias)`;
            
            const detalhesParaSalvar = { ...calculo, datas_pagas: datas_pagas, valor_passagem_diaria: valor_passagem_diaria };
            
            await dbClient.query(
                `INSERT INTO historico_pagamentos_funcionarios
                    (usuario_id, ciclo_nome, descricao, valor_liquido_pago,
                     id_usuario_pagador, detalhes_pagamento, id_conta_debito, empresa_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    id_funcionario,
                    cicloParaSalvar,
                    descricaoParaSalvar,
                    totais.totalLiquidoAPagar,
                    id_usuario_pagador,
                    JSON.stringify(detalhesParaSalvar),
                    id_conta_debito,
                    req.empresaId
                ]
            );
        }

        await dbClient.query('COMMIT');        
        res.status(201).json({ message: `Pagamento para ${nome_funcionario} efetuado com sucesso!` });

    } catch (error) {
        if (dbClient) {
            await dbClient.query('ROLLBACK');
            console.error('[API /efetuar] ERRO NA TRANSAÇÃO, ROLLBACK EXECUTADO.');
        }
        console.error('[API /efetuar] DETALHES DO ERRO:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao efetuar pagamento.',
            details: error.message
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});


router.get('/historico', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        
        const query = `
            SELECT 
                h.id,
                h.usuario_id,
                h.data_pagamento,
                h.ciclo_nome,
                h.descricao,
                h.valor_liquido_pago,
                u.nome as nome_empregado,
                p.nome as nome_pagador
            FROM 
                historico_pagamentos_funcionarios h
            JOIN usuarios u ON h.usuario_id = u.id
            JOIN usuarios p ON h.id_usuario_pagador = p.id
            WHERE h.empresa_id = $1
            ORDER BY h.data_pagamento DESC;
        `;

        const result = await dbClient.query(query, [req.empresaId]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[API /historico] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico de pagamentos.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/pagamentos/registros-dias?usuario_id=X&inicio=YYYY-MM-DD&fim=YYYY-MM-DD
router.get('/registros-dias', async (req, res) => {
    // A rota agora espera que req.usuarioLogado já exista (do middleware)
    const { usuarioLogado } = req;
    const { usuario_id, start, end } = req.query;

    if (!usuario_id || !start || !end) {
        return res.status(400).json({ error: 'Parâmetros usuario_id, start e end são obrigatórios.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();

        // <<< A VERIFICAÇÃO DE PERMISSÃO AGORA ACONTECE AQUI DENTRO >>>
        const permissoesUsuario = await getPermissoesCompletasUsuarioDB(
            dbClient,
            usuarioLogado.id,
            req.empresaId
        );
        if (!permissoesUsuario.includes('acessar-central-pagamentos')) {
            return res.status(403).json({ error: 'Permissão negada para acessar esta funcionalidade.' });
        }
        await carregarVinculoEmpregado(
            dbClient,
            usuario_id,
            req.empresaId,
            { exigirAtivo: false }
        );
        
        // O resto da lógica da rota continua a mesma
        const query = `
            SELECT data, status, valor_referencia, observacao 
            FROM registro_dias_trabalhados
            WHERE usuario_id = $1
              AND empresa_id = $2
              AND data BETWEEN $3 AND $4
        `;
        const result = await dbClient.query(
            query,
            [usuario_id, req.empresaId, start, end]
        );
        
        // DATE do Postgres não deve passar por toISOString() (UTC desloca o dia no BR).
        const formatarDataPg = (valor) => {
            if (!valor) return null;
            if (typeof valor === 'string') return valor.slice(0, 10);
            if (valor instanceof Date) {
                const y = valor.getUTCFullYear();
                const m = String(valor.getUTCMonth() + 1).padStart(2, '0');
                const d = String(valor.getUTCDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            }
            return String(valor).slice(0, 10);
        };

        const eventos = result.rows.map(row => {
            let color = '#7f8c8d';
            let title = row.status.replace(/_/g, ' '); // Padrão
            const dataIso = formatarDataPg(row.data);

            if (row.status === 'PAGO') color = '#27ae60';
            if (row.status === 'FALTA_COMPENSAR') color = '#8e44ad';
            if (row.status === 'COMPENSADO') color = '#bdc3c7';

            if (row.status === 'FALTA_NAO_JUSTIFICADA') {
                color = '#f39c12';
                title = 'FNJ'; // Abreviação para Falta Não Justificada
            }

            return {
                id: dataIso,
                title: title, // Usa a variável title
                start: dataIso,
                allDay: true,
                backgroundColor: color,
                borderColor: color,
                extendedProps: {
                    status: row.status,
                    valor: row.valor_referencia,
                    observacao: row.observacao
                }
            };
        });

        res.status(200).json(eventos);

    } catch (error) {
        console.error('[API /registros-dias] Erro:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao buscar registros de dias.'
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/pagamentos/registrar-falta
router.post('/registrar-falta', async (req, res) => {
    // A permissão para registrar falta pode ser a mesma de efetuar pagamento
    if (!req.permissoesUsuario.includes('efetuar-pagamento-empregado')) {
        return res.status(403).json({ error: 'Permissão negada para registrar faltas.' });
    }

    const { usuario_id, datas } = req.body;
    const { id: id_usuario_logado, nome: nome_usuario_logado } = req.usuarioLogado;

    if (!usuario_id || !Array.isArray(datas) || datas.length === 0) {
        return res.status(400).json({ error: 'Parâmetros usuario_id e datas (array) são obrigatórios.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await carregarVinculoEmpregado(
            dbClient,
            usuario_id,
            req.empresaId,
            { exigirAtivo: true }
        );
        await dbClient.query('BEGIN');
        for (const data of datas) {
            // Verifica se já existe um registro para esse dia, para evitar duplicatas
            const checkQuery = `
                SELECT id
                FROM registro_dias_trabalhados
                WHERE usuario_id = $1
                  AND data = $2
                  AND empresa_id = $3
            `;
            const checkResult = await dbClient.query(
                checkQuery,
                [usuario_id, data, req.empresaId]
            );

            if (checkResult.rowCount > 0) {
                // Se já existe, apenas pulamos para o próximo, sem dar erro.
                // Isso torna a operação "idempotente": rodá-la várias vezes com os mesmos dados tem o mesmo resultado.
                continue; 
            }

            // Se não existe, insere o novo registro de falta
            const insertQuery = `
                INSERT INTO registro_dias_trabalhados
                    (usuario_id, data, status, valor_referencia, observacao, empresa_id)
                VALUES ($1, $2, 'FALTA_NAO_JUSTIFICADA', $3, $4, $5)
            `;
            const observacao = `Falta registrada por: ${nome_usuario_logado}`;
            
            // Adicionamos o valor 0 como quarto parâmetro para o valor_referencia
            await dbClient.query(
                insertQuery,
                [usuario_id, data, 0, observacao, req.empresaId]
            );
        }

        await dbClient.query('COMMIT');
        res.status(201).json({ message: 'Faltas registradas com sucesso!' });

    } catch (error) {
        if (dbClient) {
            await dbClient.query('ROLLBACK');
            console.error('[API /registrar-falta] ERRO NA TRANSAÇÃO, ROLLBACK EXECUTADO.');
        }
        console.error('[API /registrar-falta] DETALHES DO ERRO:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao registrar faltas.',
            details: error.message
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/pagamentos/historico-vt?usuario_id=X
router.get('/historico-vt', async (req, res) => {
    // Reutilizando a permissão de acesso à central
    if (!req.permissoesUsuario.includes('acessar-central-pagamentos')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }

    const { usuario_id } = req.query;
    if (!usuario_id) {
        return res.status(400).json({ error: 'O parâmetro usuario_id é obrigatório.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await carregarVinculoEmpregado(
            dbClient,
            usuario_id,
            req.empresaId,
            { exigirAtivo: false }
        );

        // Buscamos no histórico todos os pagamentos cuja descrição começa com "Recarga VT"
        // e que não foram estornados ainda.
        const query = `
            SELECT 
                id,
                data_pagamento,
                descricao,
                valor_liquido_pago,
                detalhes_pagamento,
                estornado_em -- Coluna que vamos adicionar ao banco
            FROM 
                historico_pagamentos_funcionarios
            WHERE 
                usuario_id = $1 
                AND empresa_id = $2
                AND descricao LIKE 'Recarga VT%'
            ORDER BY data_pagamento DESC;
        `;

        const result = await dbClient.query(query, [usuario_id, req.empresaId]);
        res.status(200).json(result.rows);

    } catch (error) {
        console.error('[API /historico-vt] Erro:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao buscar histórico de recargas de VT.',
            details: error.message
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/pagamentos/estornar-vt
router.post('/estornar-vt', async (req, res) => {
    // Permissão para estornar pode ser a mesma de efetuar o pagamento
    if (!req.permissoesUsuario.includes('efetuar-pagamento-empregado')) {
        return res.status(403).json({ error: 'Permissão negada para estornar pagamentos.' });
    }

    const { recarga_id } = req.body; // Recebe o ID do registro do histórico

    // --- VALIDAÇÕES ---
    if (!recarga_id) {
        return res.status(400).json({ error: 'O parâmetro recarga_id é obrigatório.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        // 1. Busca o registro do histórico para obter os detalhes do pagamento original
        const historicoQuery = `
            SELECT usuario_id, detalhes_pagamento, estornado_em 
            FROM historico_pagamentos_funcionarios 
            WHERE id = $1
              AND empresa_id = $2
            FOR UPDATE; -- FOR UPDATE bloqueia a linha para evitar duplos estornos
        `;
        const historicoResult = await dbClient.query(
            historicoQuery,
            [recarga_id, req.empresaId]
        );

        if (historicoResult.rowCount === 0) {
            throw erroPagamento(
                404,
                `Registro de pagamento com ID ${recarga_id} não encontrado na empresa ativa.`
            );
        }
        
        const recarga = historicoResult.rows[0];
        if (recarga.estornado_em) {
            throw new Error(`Este pagamento já foi estornado em ${new Date(recarga.estornado_em).toLocaleString('pt-BR')}.`);
        }

        // 2. Extrai a lista de datas pagas do JSON salvo (COM PARSE)
        let detalhes;
        if (typeof recarga.detalhes_pagamento === 'string') {
            try {
                detalhes = JSON.parse(recarga.detalhes_pagamento);
            } catch (e) {
                throw new Error('Falha ao analisar os detalhes do pagamento. O JSON está malformado.');
            }
        } else {
            detalhes = recarga.detalhes_pagamento; // Já é um objeto
        }
                
        const datasPagas = detalhes?.datas_pagas;
        if (!datasPagas || !Array.isArray(datasPagas) || datasPagas.length === 0) {
            throw new Error('Não foi possível encontrar a lista de dias pagos nos detalhes deste registro. Não é possível estornar.');
        }

        // 3. Deleta os registros de dias da tabela de controle
        const deleteQuery = `
            DELETE FROM registro_dias_trabalhados 
            WHERE usuario_id = $1
              AND empresa_id = $2
              AND data = ANY($3::date[])
              AND status = 'PAGO'
        `;
        await dbClient.query(
            deleteQuery,
            [recarga.usuario_id, req.empresaId, datasPagas]
        );

        // 4. Marca o registro do histórico como estornado
        const updateHistoricoQuery = `
            UPDATE historico_pagamentos_funcionarios 
            SET estornado_em = NOW() 
            WHERE id = $1
              AND empresa_id = $2
        `;
        await dbClient.query(
            updateHistoricoQuery,
            [recarga_id, req.empresaId]
        );
        
        await dbClient.query('COMMIT');

        res.status(200).json({ message: 'Recarga estornada e dias liberados com sucesso!' });

    } catch (error) {
        if (dbClient) {
            await dbClient.query('ROLLBACK');
            console.error('[API /estornar-vt] ERRO NA TRANSAÇÃO, ROLLBACK EXECUTADO.');
        }
        // Este é o log mais importante para depuração
        console.error('[API /estornar-vt] DETALHES DO ERRO:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao processar estorno.',
            details: error.message
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/pagamentos/remover-registro-dia
// Endpoint genérico para remover qualquer registro de dia (FNJ, Atestado, etc.)
router.post('/remover-registro-dia', async (req, res) => {
    if (!req.permissoesUsuario.includes('efetuar-pagamento-empregado')) {
        return res.status(403).json({ error: 'Permissão negada para remover registros de dias.' });
    }

    const { usuario_id, data } = req.body;

    if (!usuario_id || !data) {
        return res.status(400).json({ error: 'Parâmetros usuario_id e data são obrigatórios.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await carregarVinculoEmpregado(
            dbClient,
            usuario_id,
            req.empresaId,
            { exigirAtivo: false }
        );
        
        // Simplesmente deleta a linha. Não precisa de transação para uma única operação.
        const deleteQuery = `
            DELETE FROM registro_dias_trabalhados
            WHERE usuario_id = $1
              AND data = $2
              AND empresa_id = $3
        `;
        const result = await dbClient.query(
            deleteQuery,
            [usuario_id, data, req.empresaId]
        );

        if (result.rowCount === 0) {
            // Isso pode acontecer se o usuário clicar rápido duas vezes. Não é um erro crítico.
        } else {
        }

        res.status(200).json({ message: 'Registro de dia removido com sucesso!' });

    } catch (error) {
        console.error('[API /remover-registro-dia] DETALHES DO ERRO:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao remover registro de dia.',
            details: error.message
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- MÓDULO DE RECIBOS E CONFERÊNCIA ---

// GET /api/pagamentos/recibos/dados
// Busca os dados detalhados para o recibo (Intervalo Livre)
router.get('/recibos/dados', async (req, res) => {
    const { usuario_id, data_inicio, data_fim } = req.query;

    if (!usuario_id || !data_inicio || !data_fim) {
        return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();

        // 1. Busca o vínculo empresarial e as metas da empresa ativa.
        const usuario = await carregarVinculoEmpregado(
            dbClient,
            usuario_id,
            req.empresaId,
            { exigirAtivo: false }
        );
        exigirProducaoDisponivel(usuario);
        const tipoUsuario = usuario.tipos?.includes('tiktik') ? 'tiktik' : 'costureira';
        const nivelUsuario = usuario.nivel || 1;

        // Busca a versão da meta vigente na DATA FIM do recibo
        const versaoMetaRes = await dbClient.query(
            `SELECT id
               FROM metas_versoes
              WHERE empresa_id = $1
                AND data_inicio_vigencia <= $2
              ORDER BY data_inicio_vigencia DESC
              LIMIT 1`,
            [req.empresaId, data_fim]
        );
        
        let metasConfiguradas = [];
        if (versaoMetaRes.rows.length > 0) {
            const regrasRes = await dbClient.query(
                `SELECT pontos_meta, valor_comissao, descricao_meta
                   FROM metas_regras
                  WHERE id_versao = $1
                    AND empresa_id = $2
                    AND tipo_usuario = $3
                    AND nivel = $4
                  ORDER BY pontos_meta ASC`,
                [versaoMetaRes.rows[0].id, req.empresaId, tipoUsuario, nivelUsuario]
            );
            metasConfiguradas = regrasRes.rows;
        }

        // 2. Busca Produção + Arremates + Pontos Extras
        let queryText = `
            SELECT data, pontos_gerados FROM producoes WHERE funcionario_id = $1 AND data BETWEEN $2 AND $3
        `;
        if (tipoUsuario === 'tiktik') {
            queryText += ` UNION ALL SELECT data_lancamento as data, pontos_gerados FROM arremates WHERE usuario_tiktik_id = $1 AND data_lancamento BETWEEN $2 AND $3 AND tipo_lancamento = 'PRODUCAO'`;
        }
        queryText += ` UNION ALL
            SELECT data_referencia::timestamptz as data, pontos as pontos_gerados
            FROM pontos_extras
            WHERE funcionario_id = $1
              AND empresa_id = $4
              AND data_referencia BETWEEN $2::date AND $3::date
              AND cancelado = FALSE`;

        const producaoRes = await dbClient.query(
            queryText,
            [
                usuario_id,
                data_inicio + ' 00:00:00',
                data_fim + ' 23:59:59',
                req.empresaId
            ]
        );

        // 3. Busca Resgates e Ganhos (Cofre)
        const cofreRes = await dbClient.query(
            `SELECT data_evento, quantidade, tipo
               FROM banco_pontos_log
              WHERE usuario_id = $1
                AND empresa_id = $2
                AND tipo IN ('RESGATE', 'GANHO')
                AND data_evento BETWEEN $3 AND $4`,
            [
                usuario_id,
                req.empresaId,
                data_inicio + ' 00:00:00',
                data_fim + ' 23:59:59'
            ]
        );

        // 4. Compila Dia a Dia
        const mapaDias = {};

        // Helper para inicializar dia
        const getDia = (dataStr) => {
            if (!mapaDias[dataStr]) mapaDias[dataStr] = { pontos: 0, resgate: 0, ganhoCofre: 0, data: dataStr };
            return mapaDias[dataStr];
        };

        producaoRes.rows.forEach(r => {
            const d = new Date(r.data).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
            getDia(d).pontos += parseFloat(r.pontos_gerados);
        });

        cofreRes.rows.forEach(r => {
            const d = new Date(r.data_evento).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
            const qtd = parseFloat(r.quantidade);
            if (r.tipo === 'RESGATE') getDia(d).resgate += qtd;
            if (r.tipo === 'GANHO') getDia(d).ganhoCofre += qtd;
        });

        // 5. Calcula Valores Finais
        const relatorio = Object.values(mapaDias).sort((a, b) => a.data.localeCompare(b.data)).map(dia => {
            const totalDia = dia.pontos + dia.resgate; // GanhoCofre não soma para meta do dia, é sobra
            let valor = 0;
            let metaNome = '-';

            // Verifica Meta
            for (let i = metasConfiguradas.length - 1; i >= 0; i--) {
                if (totalDia >= metasConfiguradas[i].pontos_meta) {
                    valor = parseFloat(metasConfiguradas[i].valor_comissao);
                    metaNome = metasConfiguradas[i].descricao_meta;
                    break;
                }
            }

            return { ...dia, totalDia, valor, metaNome };
        });

        res.status(200).json(relatorio);

    } catch (error) {
        console.error('[API Recibos Dados] Erro:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao gerar dados.'
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/pagamentos/recibos/registrar
// Marca que um recibo foi gerado
router.post('/recibos/registrar', async (req, res) => {
    const { usuario_id, data_inicio, data_fim } = req.body;
    const adminId = req.usuarioLogado.id;

    let dbClient;
    try {
        dbClient = await pool.connect();
        await carregarVinculoEmpregado(
            dbClient,
            usuario_id,
            req.empresaId,
            { exigirAtivo: false }
        );
        
        await dbClient.query(
            `INSERT INTO recibos_conferencia
                (usuario_id, data_inicio, data_fim, gerado_por, empresa_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [usuario_id, data_inicio, data_fim, adminId, req.empresaId]
        );

        res.status(201).json({ message: 'Recibo registrado.' });
    } catch (error) {
        console.error('[API Recibos Registrar] Erro:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao registrar.'
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/pagamentos/recibos/verificar
// Verifica se já existe recibo para o período (ou sobreposição)
router.get('/recibos/verificar', async (req, res) => {
    const { usuario_id, data_inicio, data_fim } = req.query;
    let dbClient;
    try {
        dbClient = await pool.connect();
        await carregarVinculoEmpregado(
            dbClient,
            usuario_id,
            req.empresaId,
            { exigirAtivo: false }
        );

        // Procura intersecção de datas
        const result = await dbClient.query(`
            SELECT data_inicio, data_fim, data_geracao 
            FROM recibos_conferencia 
            WHERE usuario_id = $1 
              AND empresa_id = $2
              AND (data_inicio <= $4 AND data_fim >= $3)
        `, [usuario_id, req.empresaId, data_inicio, data_fim]);

        res.status(200).json({ 
            jaExiste: result.rowCount > 0,
            conflitos: result.rows 
        });

    } catch (error) {
        console.error('[API Recibos Verificar] Erro:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao verificar.'
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/pagamentos/recibos/cobertos
// Lista usuários que já possuem recibo cobrindo o período (para badge / resumo da semana)
router.get('/recibos/cobertos', async (req, res) => {
    const { data_inicio, data_fim } = req.query;
    if (!data_inicio || !data_fim) {
        return res.status(400).json({ error: 'data_inicio e data_fim são obrigatórios.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(
            `SELECT DISTINCT usuario_id
             FROM recibos_conferencia
             WHERE empresa_id = $1
               AND data_inicio <= $3
               AND data_fim >= $2`,
            [req.empresaId, data_inicio, data_fim]
        );
        res.status(200).json({
            data_inicio,
            data_fim,
            usuario_ids: result.rows.map((row) => row.usuario_id),
        });
    } catch (error) {
        console.error('[API Recibos Cobertos] Erro:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao consultar cobertura de recibos.',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/pagamentos/recibos/intervalos-empresa
// Todos os períodos de recibo da empresa ativa (para somar pendências por semana × usuário)
router.get('/recibos/intervalos-empresa', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(
            `SELECT usuario_id, data_inicio, data_fim
             FROM recibos_conferencia
             WHERE empresa_id = $1
             ORDER BY data_inicio DESC`,
            [req.empresaId]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[API Recibos Intervalos Empresa] Erro:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao listar intervalos de recibos.',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- ROTA DE PAGAMENTO EM LOTE DE VT (NOVA) ---
router.post('/lote-vt', async (req, res) => {
    // 1. Permissão
    if (!req.permissoesUsuario.includes('permitir-pagar-passagens')) {
        return res.status(403).json({ error: 'Permissão negada para pagar passagens.' });
    }

    const { 
        id_conta_debito, 
        id_concessionaria,
        data_referencia_inicio,
        data_referencia_fim,
        valor_total_vt, // Soma dos VTs dos empregados
        valor_total_taxa, // Valor da taxa (separado)
        itens // Array de { usuario_id, dias_pagos (int), valor_total (float), datas_lista (array de strings) }
    } = req.body;

    // 2. Validações Básicas
    if (
        !id_conta_debito ||
        !id_concessionaria ||
        !Array.isArray(itens) ||
        itens.length === 0 ||
        itens.some(
            (item) =>
                !Number.isSafeInteger(Number(item?.usuario_id)) ||
                Number(item.usuario_id) <= 0
        )
    ) {
        return res.status(400).json({ error: 'Dados incompletos para o lote.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const idUsuarioPagador = req.usuarioLogado.id;
        const dataHoje = new Date();
        const categoriasPagamento = await carregarCategoriasPagamento(
            dbClient,
            req.empresaId,
            ['VALE_TRANSPORTE', 'TAXA_VT']
        );
        const contaRes = await dbClient.query(
            `SELECT id
               FROM fc_contas_bancarias
              WHERE id = $1
                AND empresa_id = $2
                AND ativo`,
            [id_conta_debito, req.empresaId]
        );
        if (contaRes.rows.length === 0) {
            throw new Error('Conta de débito não encontrada na empresa ativa.');
        }
        const concessionariaRes = await dbClient.query(
            `SELECT id, nome, id_contato_financeiro
               FROM config_concessionarias_vt
              WHERE id = $1
                AND empresa_id = $2
                AND ativo`,
            [id_concessionaria, req.empresaId]
        );
        if (concessionariaRes.rows.length === 0) {
            throw new Error('Concessionária não encontrada na empresa ativa.');
        }
        const concessionaria = concessionariaRes.rows[0];
        const nomeConcessionaria = concessionaria.nome;
        const idsUsuarios = itens.map((item) => Number(item.usuario_id));
        const contatosRes = await dbClient.query(
            `SELECT ue.usuario_id, ue.id_contato_financeiro
               FROM usuarios_empresas ue
               LEFT JOIN fc_contatos c
                 ON c.id = ue.id_contato_financeiro
                AND c.empresa_id = ue.empresa_id
              WHERE ue.usuario_id = ANY($1::int[])
                AND ue.empresa_id = $2
                AND ue.ativo
                AND ue.elegivel_pagamento
                AND (
                    ue.id_contato_financeiro IS NULL
                    OR c.id IS NOT NULL
                )`,
            [idsUsuarios, req.empresaId]
        );
        const contatoPorUsuario = new Map(
            contatosRes.rows.map((row) => [
                Number(row.usuario_id),
                row.id_contato_financeiro,
            ])
        );
        if (contatoPorUsuario.size !== new Set(idsUsuarios).size) {
            throw new Error('O lote contém pessoa sem vínculo ativo com a empresa.');
        }

        // --- PASSO A: Lançamento Financeiro do MONTANTE DE VT ---
        // 1 empregado → lançamento simples (sem rateio)
        // 2+ empregados no mesmo lote → rateio DETALHADO (favorecido visual: "Diversos" no card)
        if (valor_total_vt > 0) {
            if (itens.length === 1) {
                const unico = itens[0];
                const idContatoUnico = contatoPorUsuario.get(Number(unico.usuario_id)) || null;
                const descSimples =
                    `Recarga VT (${nomeConcessionaria}) — ${unico.nome_funcionario || 'empregado'}` +
                    (unico.dias_qtd ? ` (${unico.dias_qtd} dia${Number(unico.dias_qtd) === 1 ? '' : 's'})` : '');

                await dbClient.query(
                    `INSERT INTO fc_lancamentos
                     (id_conta_bancaria, id_categoria, tipo, valor,
                      data_transacao, descricao, id_contato,
                      id_usuario_lancamento, empresa_id)
                     VALUES ($1, $2, 'DESPESA', $3, NOW(), $4, $5, $6, $7)`,
                    [
                        id_conta_debito,
                        categoriasPagamento.VALE_TRANSPORTE,
                        valor_total_vt,
                        descSimples,
                        idContatoUnico,
                        idUsuarioPagador,
                        req.empresaId,
                    ]
                );
            } else {
                const resPai = await dbClient.query(
                    `INSERT INTO fc_lancamentos 
                     (id_conta_bancaria, id_categoria, tipo, tipo_rateio, valor,
                      data_transacao, descricao, id_usuario_lancamento, empresa_id)
                     VALUES ($1, $2, 'DESPESA', 'DETALHADO', $3, NOW(), $4, $5, $6)
                     RETURNING id`,
                    [
                        id_conta_debito, 
                        categoriasPagamento.VALE_TRANSPORTE,
                        valor_total_vt, 
                        `Recarga VT (${nomeConcessionaria}) - ${itens.length} funcionários`,
                        idUsuarioPagador,
                        req.empresaId
                    ]
                );
                
                const idPai = resPai.rows[0].id;

                for (const item of itens) {
                    const descItem = `VT: ${item.nome_funcionario} (${item.dias_qtd} dias)`;
                    
                    await dbClient.query(
                        `INSERT INTO fc_lancamento_itens 
                         (id_lancamento_pai, id_categoria, id_contato_item,
                          descricao_item, valor_total_item, empresa_id)
                         VALUES ($1, $2, $3, $4, $5, $6)`,
                        [
                            idPai,
                            categoriasPagamento.VALE_TRANSPORTE,
                            contatoPorUsuario.get(Number(item.usuario_id)) || null,
                            descItem,
                            item.valor_total,
                            req.empresaId
                        ]
                    );
                }
            }
        }

        // --- PASSO B: Lançamento Financeiro da TAXA (SEPARADO) ---
        if (valor_total_taxa > 0) {
            await dbClient.query(
                `INSERT INTO fc_lancamentos (
                    id_conta_bancaria, id_categoria, tipo, valor,
                    data_transacao, descricao, id_usuario_lancamento,
                    id_contato, empresa_id
                 )
                 VALUES ($1, $2, 'DESPESA', $3, NOW(), $4, $5, $6, $7)`,
                [
                    id_conta_debito, 
                    categoriasPagamento.TAXA_VT,
                    valor_total_taxa, 
                    `Taxa Adm. VT (${nomeConcessionaria})`,
                    idUsuarioPagador,
                    concessionaria.id_contato_financeiro || null,
                    req.empresaId
                ]
            );
        }

        // Modelo visual de aviso popup "Recarga VT" (Central de Alertas)
        const tplVtRes = await dbClient.query(
            `SELECT titulo, tipo, mensagem, cor_fundo, url_imagem, urgente
               FROM avisos_popup
              WHERE empresa_id = $1
                AND is_template = TRUE
                AND titulo ILIKE '%Recarga VT%'
              LIMIT 1`,
            [req.empresaId]
        );
        const tplVt = tplVtRes.rows[0] || null;

        // --- PASSO C: Registrar Histórico Individual e Bloquear Dias ---
        for (const item of itens) {
            const { usuario_id, dias_qtd, valor_total, datas_lista, nome_funcionario } = item;

            // 1. Salva no histórico do funcionário (Para ele ver no holerite/recibo)
            // Criamos um objeto "detalhes" simulado para manter compatibilidade com o sistema antigo
            const detalhesSimulados = {
                tipoPagamento: 'VALE_TRANSPORTE',
                detalhes: { ciclo: { nome: `${nomeConcessionaria} (${dias_qtd} dias)` } },
                datas_pagas: datas_lista
            };

            await dbClient.query(
                `INSERT INTO historico_pagamentos_funcionarios
                (usuario_id, descricao, valor_liquido_pago, id_usuario_pagador,
                 detalhes_pagamento, id_conta_debito, data_pagamento, empresa_id)
                VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
                [
                    usuario_id, 
                    `Recarga VT (${nomeConcessionaria})`,
                    valor_total, 
                    idUsuarioPagador, 
                    JSON.stringify(detalhesSimulados), 
                    id_conta_debito,
                    req.empresaId
                ]
            );

            // 2. Marca os dias como PAGOS na tabela de controle (evita pagamento duplicado)
            if (datas_lista && datas_lista.length > 0) {
                for (const dataStr of datas_lista) {
                    // Verifica se já existe registro (idempotência simples)
                    const check = await dbClient.query(
                        `SELECT id
                           FROM registro_dias_trabalhados
                          WHERE usuario_id = $1
                            AND data = $2
                            AND empresa_id = $3`,
                        [usuario_id, dataStr, req.empresaId]
                    );
                    if (check.rowCount === 0) {
                        await dbClient.query(
                            `INSERT INTO registro_dias_trabalhados
                                (usuario_id, data, status, valor_referencia, observacao, empresa_id)
                             VALUES ($1, $2, 'PAGO', $3, $4, $5)`,
                            [
                                usuario_id,
                                dataStr,
                                (valor_total / dias_qtd) || 0,
                                `Lote VT ${nomeConcessionaria}`,
                                req.empresaId
                            ]
                        );
                    }
                }
            }

            // 3. Aviso popup individual — modelo "Recarga VT" (imediato, fuso SP)
            const datasFmt = Array.isArray(datas_lista) && datas_lista.length
                ? [...datas_lista]
                    .sort()
                    .map((dataStr) => {
                        const partes = String(dataStr).slice(0, 10).split('-');
                        if (partes.length === 3) {
                            return `${partes[2]}/${partes[1]}/${partes[0]}`;
                        }
                        return String(dataStr);
                    })
                    .join(', ')
                : `${dias_qtd} dia(s)`;
            const valorFmt = Number(valor_total || 0).toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
            });
            const baseModelo = (tplVt?.mensagem && String(tplVt.mensagem).trim())
                ? String(tplVt.mensagem).trim()
                : 'Sua recarga de Vale Transporte foi realizada!';
            const mensagemAviso =
                `${baseModelo}\n\n` +
                `Concessionária: ${nomeConcessionaria}\n` +
                `Dias recarregados: ${datasFmt}\n` +
                `Valor: ${valorFmt}`;

            // Nunca usar tipo "imagem" puro com mensagem customizada: na dashboard
            // o corpo some e, se a URL falhar, o card fica preto/vazio.
            // Com imagem do modelo → "misto"; sem imagem → "texto".
            const urlImagem = tplVt?.url_imagem || null;
            const tipoAviso = urlImagem ? 'misto' : 'texto';
            const corFundo = (tplVt?.cor_fundo && String(tplVt.cor_fundo).trim())
                ? String(tplVt.cor_fundo).trim()
                : 'azul';
            const idDestinatario = Number(usuario_id);
            if (!Number.isSafeInteger(idDestinatario) || idDestinatario <= 0) {
                throw new Error(`ID de usuário inválido para aviso de recarga: ${usuario_id}`);
            }

            await dbClient.query(
                `INSERT INTO avisos_popup
                    (empresa_id, titulo, tipo, mensagem, url_imagem, cor_fundo, destinatarios,
                     ids_individuais, urgente, ativo, is_template, data_inicio, data_fim, criado_por)
                 VALUES (
                    $1, $2, $3, $4, $5, $6, 'individuais',
                    $7::int[], $8, TRUE, FALSE,
                    (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date,
                    NULL, $9
                 )`,
                [
                    req.empresaId,
                    tplVt?.titulo || 'Recarga VT',
                    tipoAviso,
                    mensagemAviso,
                    urlImagem,
                    corFundo,
                    [idDestinatario],
                    Boolean(tplVt?.urgente),
                    idUsuarioPagador,
                ]
            );
        }

        await dbClient.query('COMMIT');
        res.status(201).json({ message: 'Lote de VT processado com sucesso!', total_funcionarios: itens.length });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /lote-vt] Erro:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao processar lote.',
            details: error.message
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/pagamentos/lotes-vt-agrupados
// Busca histórico agrupado por data e descrição para simular "Lotes"
router.get('/lotes-vt-agrupados', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        // Agrupa por timestamp exato e descrição. 
        // Se created_at for igual, é do mesmo lote.
        const query = `
            SELECT 
                data_pagamento,
                descricao,
                COUNT(*) as qtd_funcionarios,
                SUM(valor_liquido_pago) as valor_total,
                -- Se pelo menos um registro do lote foi impresso, consideramos impresso
                BOOL_OR(recibo_impresso_em IS NOT NULL) as ja_impresso,
                json_agg(json_build_object(
                    'id', id,
                    'usuario_id', usuario_id,
                    'nome_funcionario', (SELECT nome FROM usuarios WHERE id = historico_pagamentos_funcionarios.usuario_id),
                    'valor', valor_liquido_pago,
                    'detalhes', detalhes_pagamento
                )) as itens
            FROM historico_pagamentos_funcionarios
            WHERE detalhes_pagamento::text LIKE '%VALE_TRANSPORTE%'
              AND empresa_id = $1
            GROUP BY data_pagamento, descricao
            ORDER BY data_pagamento DESC
            LIMIT 50;
        `;
        const result = await dbClient.query(query, [req.empresaId]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('[API GET /lotes-vt-agrupados] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar lotes.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/pagamentos/marcar-lote-impresso
router.post('/marcar-lote-impresso', async (req, res) => {
    const { ids } = req.body; // Agora esperamos um array de IDs: [10, 11, 12]
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Lista de IDs inválida.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        const idsNormalizados = ids.map(Number);
        if (
            idsNormalizados.some((id) => !Number.isSafeInteger(id) || id <= 0)
        ) {
            return res.status(400).json({ error: 'Lista de IDs inválida.' });
        }
        const idsUnicos = [...new Set(idsNormalizados)];

        await dbClient.query('BEGIN');
        const registros = await dbClient.query(
            `SELECT id
               FROM historico_pagamentos_funcionarios
              WHERE id = ANY($1::int[])
                AND empresa_id = $2
              FOR UPDATE`,
            [idsUnicos, req.empresaId]
        );
        if (registros.rowCount !== idsUnicos.length) {
            throw erroPagamento(
                404,
                'Um ou mais pagamentos não foram encontrados na empresa ativa.'
            );
        }
        await dbClient.query(
            `UPDATE historico_pagamentos_funcionarios 
             SET recibo_impresso_em = NOW() 
             WHERE id = ANY($1::int[])
               AND empresa_id = $2`,
            [idsUnicos, req.empresaId]
        );
        await dbClient.query('COMMIT');
        res.status(200).json({ message: 'Lote marcado como impresso.' });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[API /marcar-lote-impresso] Erro:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao marcar lote.'
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/pagamentos/recibos/historico-periodos
// Retorna lista de dias já cobertos por recibos para um usuário
router.get('/recibos/historico-periodos', async (req, res) => {
    const { usuario_id, ano } = req.query; // Filtro por ano para não pesar
    if (!usuario_id) return res.status(400).json({ error: 'Usuario ID obrigatório' });

    let dbClient;
    try {
        dbClient = await pool.connect();
        await carregarVinculoEmpregado(
            dbClient,
            usuario_id,
            req.empresaId,
            { exigirAtivo: false }
        );
        // Busca data_inicio e data_fim de todos os recibos do usuário
        const query = `
            SELECT data_inicio, data_fim 
            FROM recibos_conferencia 
            WHERE usuario_id = $1 
              AND empresa_id = $2
              AND EXTRACT(YEAR FROM data_inicio) = $3
        `;
        const result = await dbClient.query(
            query,
            [usuario_id, req.empresaId, ano || new Date().getFullYear()]
        );
        
        // Vamos expandir os intervalos no backend ou frontend? 
        // Frontend é mais leve pro banco. Retornamos os intervalos.
        res.status(200).json(result.rows);
    } catch (error) {
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao buscar histórico.'
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
