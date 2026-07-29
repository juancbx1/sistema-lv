// api/financeiro.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import express from 'express';
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';
import { obterEmpresaIdDoContexto } from './contexto-empresa.js';
import etag from 'etag';

const formatCurrency = (value) => {
    // Converte para número, tratando null, undefined ou strings vazias como 0.
    const numberValue = parseFloat(value);
    if (isNaN(numberValue)) {
        return 'R$ 0,00'; // Se a conversão falhar, retorna 0.
    }
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numberValue);
};


const router = express.Router();
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    timezone: 'UTC',
});
const TABELAS_FINANCEIRAS_EMPRESARIAIS = new Set([
    'fc_contas_bancarias',
    'fc_grupos_financeiros',
    'fc_categorias',
    'fc_contatos',
    'fc_lancamentos',
    'fc_contas_agendadas',
    'fc_lotes_agendamento',
    'fc_solicitacoes_alteracao',
    'config_concessionarias_vt',
]);

function erroFinanceiro(statusCode, mensagem) {
    return Object.assign(new Error(mensagem), { statusCode });
}

async function exigirRecursoDaEmpresa(
    dbClient,
    tabela,
    id,
    empresaId,
    { nome = 'Recurso', forUpdate = false } = {}
) {
    if (!TABELAS_FINANCEIRAS_EMPRESARIAIS.has(tabela)) {
        throw new Error(`Tabela financeira não autorizada no helper: ${tabela}`);
    }

    const result = await dbClient.query(
        `SELECT *
           FROM ${tabela}
          WHERE id = $1
            AND empresa_id = $2
          ${forUpdate ? 'FOR UPDATE' : ''}`,
        [id, empresaId]
    );

    if (result.rows.length === 0) {
        throw erroFinanceiro(404, `${nome} não encontrado no contexto da empresa ativa.`);
    }
    return result.rows[0];
}

async function validarReferenciasLancamento(
    dbClient,
    empresaId,
    dadosPai,
    itens = [],
    tipoRateio = null
) {
    await exigirRecursoDaEmpresa(
        dbClient,
        'fc_contas_bancarias',
        dadosPai.id_conta_bancaria,
        empresaId,
        { nome: 'Conta bancária' }
    );

    if (tipoRateio !== 'COMPRA' && dadosPai.id_categoria) {
        await exigirRecursoDaEmpresa(
            dbClient,
            'fc_categorias',
            dadosPai.id_categoria,
            empresaId,
            { nome: 'Categoria' }
        );
    }
    if (dadosPai.id_contato) {
        await exigirRecursoDaEmpresa(
            dbClient,
            'fc_contatos',
            dadosPai.id_contato,
            empresaId,
            { nome: 'Favorecido' }
        );
    }

    for (const item of itens) {
        await exigirRecursoDaEmpresa(
            dbClient,
            'fc_categorias',
            item.id_categoria,
            empresaId,
            { nome: 'Categoria do item' }
        );
        if (item.id_contato_item) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_contatos',
                item.id_contato_item,
                empresaId,
                { nome: 'Favorecido do item' }
            );
        }
    }
}

/** Lançamentos ativos = soft delete ausente */
const SQL_LANC_ATIVO = 'excluido_em IS NULL';
const SQL_LANC_ATIVO_ALIAS = (alias = 'l') => `${alias}.excluido_em IS NULL`;

/**
 * Soft delete de um ou mais lançamentos (e vínculos de transferência / estornos filhos).
 * Não apaga linhas nem itens — permite auditoria e futura reativação.
 */
async function softDeleteLancamento(
    dbClient,
    idLancamento,
    idUsuario,
    empresaId,
    { cascade = true } = {}
) {
    const atualRes = await dbClient.query(
        `SELECT *
           FROM fc_lancamentos
          WHERE id = $1
            AND empresa_id = $2
            AND excluido_em IS NULL
          FOR UPDATE`,
        [idLancamento, empresaId]
    );
    if (atualRes.rows.length === 0) return null;
    const atual = atualRes.rows[0];
    if (atual.excluido_em) return atual;

    const ids = new Set([Number(idLancamento)]);

    if (cascade) {
        if (atual.id_transferencia_vinculada) {
            ids.add(Number(atual.id_transferencia_vinculada));
        }
        const estornosRes = await dbClient.query(
            `SELECT id
               FROM fc_lancamentos
              WHERE id_estorno_de = $1
                AND empresa_id = $2
                AND excluido_em IS NULL`,
            [idLancamento, empresaId]
        );
        for (const row of estornosRes.rows) ids.add(Number(row.id));
    }

    // Agenda que apontava para estes lançamentos volta a pendente
    for (const id of ids) {
        await dbClient.query(
            `UPDATE fc_contas_agendadas
             SET id_lancamento_efetivado = NULL, status = 'PENDENTE'
             WHERE id_lancamento_efetivado = $1
               AND empresa_id = $2`,
            [id, empresaId]
        );
    }

    // Soft delete é marcado só por excluido_em — status_edicao NÃO pode ser 'EXCLUIDO'
    // (constraint status_edicao_check: OK, PENDENTE_*, ESTORNADO, EDITADO_APROVADO, EDICAO_REJEITADA).
    const idsArr = [...ids];
    const result = await dbClient.query(
        `UPDATE fc_lancamentos
         SET excluido_em = NOW(),
             id_usuario_exclusao = $2
         WHERE id = ANY($1::int[])
           AND empresa_id = $3
           AND excluido_em IS NULL
         RETURNING *`,
        [idsArr, idUsuario, empresaId]
    );

    return result.rows.find((r) => Number(r.id) === Number(idLancamento)) || result.rows[0] || null;
}

/** Extrai id da agenda a partir da descrição gerada na baixa: "Baixa da conta agendada #123: ..." */
function parseAgendaIdFromDescricaoBaixa(descricao) {
    const m = String(descricao || '').match(/Baixa da conta agendada #(\d+)/i);
    return m ? Number(m[1]) : null;
}

/**
 * Impede reativar baixa se a parcela da Agenda já tiver outra baixa ativa (evita saldo duplicado).
 */
async function assertPodeRestaurarBaixaAgenda(dbClient, lancamento, empresaId) {
    const agendaId = parseAgendaIdFromDescricaoBaixa(lancamento.descricao);
    if (!agendaId) return null;

    const agRes = await dbClient.query(
        `SELECT id, status, id_lancamento_efetivado, descricao
         FROM fc_contas_agendadas
         WHERE id = $1
           AND empresa_id = $2
         FOR UPDATE`,
        [agendaId, empresaId]
    );
    if (agRes.rows.length === 0) return null;

    const agenda = agRes.rows[0];
    const efetivadoId = agenda.id_lancamento_efetivado != null ? Number(agenda.id_lancamento_efetivado) : null;
    if (efetivadoId && efetivadoId !== Number(lancamento.id)) {
        const outroAtivo = await dbClient.query(
            `SELECT id
               FROM fc_lancamentos
              WHERE id = $1
                AND empresa_id = $2
                AND excluido_em IS NULL`,
            [efetivadoId, empresaId]
        );
        if (outroAtivo.rows.length > 0) {
            const err = new Error(
                `Não é possível reativar o lançamento #${lancamento.id}: a parcela #${agendaId} da Agenda já tem outra baixa ativa (#${efetivadoId}). ` +
                `Exclua a baixa nova antes de desfazer esta exclusão, ou deixe o histórico como está.`
            );
            err.statusCode = 409;
            throw err;
        }
    }
    return agenda;
}

/**
 * Reativa lançamento soft-deleted (e vínculos de transferência / estornos filhos soft-deletados).
 * Tenta religar Agenda quando a descrição for de baixa de conta agendada.
 */
async function softRestoreLancamento(
    dbClient,
    idLancamento,
    empresaId,
    { cascade = true } = {}
) {
    const atualRes = await dbClient.query(
        `SELECT *
           FROM fc_lancamentos
          WHERE id = $1
            AND empresa_id = $2
            AND excluido_em IS NOT NULL
          FOR UPDATE`,
        [idLancamento, empresaId]
    );
    if (atualRes.rows.length === 0) return null;
    const atual = atualRes.rows[0];

    const agenda = await assertPodeRestaurarBaixaAgenda(dbClient, atual, empresaId);

    const ids = new Set([Number(idLancamento)]);
    if (cascade) {
        if (atual.id_transferencia_vinculada) {
            ids.add(Number(atual.id_transferencia_vinculada));
        }
        const estornosRes = await dbClient.query(
            `SELECT id
               FROM fc_lancamentos
              WHERE id_estorno_de = $1
                AND empresa_id = $2
                AND excluido_em IS NOT NULL`,
            [idLancamento, empresaId]
        );
        for (const row of estornosRes.rows) ids.add(Number(row.id));
    }

    // Limpa flags de pendência de exclusão/aprovação que ficaram na solicitação;
    // preserva ESTORNADO / EDITADO_APROVADO / etc.
    const result = await dbClient.query(
        `UPDATE fc_lancamentos
         SET excluido_em = NULL,
             id_usuario_exclusao = NULL,
             status_edicao = CASE
                 WHEN status_edicao IN ('PENDENTE_EXCLUSAO', 'PENDENTE_APROVACAO') THEN 'OK'
                 ELSE status_edicao
             END,
             motivo_rejeicao = CASE
                 WHEN status_edicao IN ('PENDENTE_EXCLUSAO', 'PENDENTE_APROVACAO') THEN NULL
                 ELSE motivo_rejeicao
             END
         WHERE id = ANY($1::int[])
           AND empresa_id = $2
           AND excluido_em IS NOT NULL
         RETURNING *`,
        [[...ids], empresaId]
    );

    const restaurado = result.rows.find((r) => Number(r.id) === Number(idLancamento)) || result.rows[0] || null;

    // Religa Agenda se era baixa e a parcela ainda está livre / aponta para este id (ou efetivado soft-deleted)
    if (restaurado && agenda) {
        const agendaId = Number(agenda.id);
        await dbClient.query(
            `UPDATE fc_contas_agendadas
             SET id_lancamento_efetivado = $1,
                 status = 'PAGO',
                 atualizado_em = NOW()
             WHERE id = $2
               AND empresa_id = $3
               AND (
                 id_lancamento_efetivado IS NULL
                 OR id_lancamento_efetivado = $1
                 OR NOT EXISTS (
                   SELECT 1 FROM fc_lancamentos l
                   WHERE l.id = fc_contas_agendadas.id_lancamento_efetivado
                     AND l.empresa_id = fc_contas_agendadas.empresa_id
                     AND l.excluido_em IS NULL
                 )
               )`,
            [restaurado.id, agendaId, empresaId]
        );
    }

    return restaurado;
}

async function registrarLog(dbClient, idUsuario, nomeUsuario, acao, dados = {}, empresaId) {
    try {
        if (!Number.isSafeInteger(Number(empresaId)) || Number(empresaId) <= 0) {
            throw new Error('Contexto empresarial ausente ao registrar log financeiro.');
        }
        let detalhes = '';
        let dadosAlterados = { antes: dados.antes || null, depois: dados.depois || null };

        const getInfoEntidade = (entidade) => {
            if (!entidade) return { nome: 'N/A', tipo: 'N/A' };
            if (entidade.nome_conta) return { nome: entidade.nome_conta, tipo: 'Conta Bancária' };
            if (entidade.taxa_recarga_percentual !== undefined && entidade.taxa_recarga_percentual !== null && !entidade.id_grupo) {
                // Concessionária VT (não confundir com categoria)
                if (entidade.nome && !entidade.tipo) return { nome: entidade.nome, tipo: 'Concessionária VT' };
            }
            if (Object.prototype.hasOwnProperty.call(entidade, 'id_grupo')) return { nome: entidade.nome, tipo: 'Categoria' };
            if (entidade.tipo === 'DESPESA' || entidade.tipo === 'RECEITA') return { nome: entidade.nome, tipo: 'Grupo' };
            if (entidade.nome) return { nome: entidade.nome, tipo: 'Favorecido' };
            return { nome: 'Entidade Desconhecida', tipo: 'N/A' };
        };

        const descLanc = (l) => l?.descricao || 'sem descrição';
        const fmtData = (d) => {
            if (!d) return 'data não informada';
            const raw = String(d).slice(0, 10);
            return new Date(`${raw}T12:00:00Z`).toLocaleDateString('pt-BR');
        };

        switch (acao) {
            // --- LANÇAMENTOS ---
            case 'CRIACAO_LANCAMENTO':
                detalhes = `Criou ${(dados.depois?.tipo || 'lançamento').toLowerCase()} de ${formatCurrency(dados.depois?.valor)} ("${descLanc(dados.depois)}").`;
                break;
            case 'CRIACAO_LANCAMENTO_DETALHADO': {
                const tipoRateio = dados.depois?.tipo_rateio === 'COMPRA' ? 'compra detalhada' : 'rateio';
                const qtdItens = Array.isArray(dados.depois?.itens) ? dados.depois.itens.length : 0;
                detalhes = `Criou ${tipoRateio} de ${formatCurrency(dados.depois?.valor)} ("${descLanc(dados.depois)}") com ${qtdItens} itens.`;
                break;
            }
            case 'CRIACAO_TRANSFERENCIA':
                detalhes = `Realizou transferência de ${formatCurrency(dados.valor)} da conta "${dados.contaOrigem}" para "${dados.contaDestino}".`;
                dadosAlterados = { depois: dados };
                break;
            case 'EDICAO_LANCAMENTO':
                detalhes = `Editou o lançamento #${dados.depois?.id}. O valor foi de ${formatCurrency(dados.antes?.valor)} para ${formatCurrency(dados.depois?.valor)}.`;
                break;
            case 'EXCLUSAO_LANCAMENTO':
                detalhes = `Excluiu (cancelamento lógico) o lançamento #${dados.antes?.id} ("${descLanc(dados.antes)}") no valor de ${formatCurrency(dados.antes?.valor)}.`;
                break;
            case 'REATIVACAO_LANCAMENTO':
                detalhes = `Reativou o lançamento #${dados.depois?.id} ("${descLanc(dados.depois)}") anteriormente excluído.`;
                break;
            case 'REGISTRO_ESTORNO':
                detalhes = `Registrou estorno de ${formatCurrency(dados.lancamento_estorno?.valor || dados.valor_estornado)} sobre o lançamento #${dados.lancamento_original?.id} ("${descLanc(dados.lancamento_original)}").`;
                dadosAlterados = { antes: dados.lancamento_original || null, depois: dados.lancamento_estorno || dados };
                break;
            case 'REVERSAO_ESTORNO':
                detalhes = `Reverteu o estorno #${dados.lancamento_estorno?.id}, restaurando o lançamento original #${dados.lancamento_original_id || dados.lancamento_estorno?.id_estorno_de}.`;
                dadosAlterados = { antes: dados.lancamento_estorno || null, depois: { id_original: dados.lancamento_original_id } };
                break;

            // --- FLUXO DE APROVAÇÃO / SOLICITAÇÕES ---
            case 'SOLICITACAO_EDICAO':
                detalhes = `Solicitou edição do lançamento #${dados.id_lancamento}. Justificativa: "${dados.justificativa || 'não informada'}".`;
                dadosAlterados = { depois: dados };
                break;
            case 'SOLICITACAO_EXCLUSAO':
                detalhes = `Solicitou exclusão do lançamento #${dados.id_lancamento}. Justificativa: "${dados.justificativa || 'não informada'}".`;
                dadosAlterados = { depois: dados };
                break;
            case 'SOLICITACAO_ESTORNO':
                detalhes = `Solicitou estorno do lançamento #${dados.id_lancamento} no valor de ${formatCurrency(dados.valor_estornado)}.`;
                dadosAlterados = { depois: dados };
                break;
            case 'SOLICITACAO_REVERSAO_ESTORNO':
                detalhes = `Solicitou reversão do estorno #${dados.id_lancamento}.`;
                dadosAlterados = { depois: dados };
                break;
            case 'SOLICITACAO_CRIACAO': {
                const proposto = dados.lancamento_proposto || {};
                const descProp = proposto.descricao || proposto.dados_pai?.descricao || 'sem descrição';
                const dataProp = proposto.data_transacao || proposto.dados_pai?.data_transacao;
                detalhes = `Solicitou criação de lançamento com data especial (${fmtData(dataProp)}): "${descProp}". Justificativa: "${dados.justificativa || 'não informada'}".`;
                dadosAlterados = { depois: dados };
                break;
            }
            case 'APROVACAO_SOLICITACAO': {
                const s = dados.solicitacao || {};
                const tipo = (s.tipo_solicitacao || 'solicitação').toLowerCase();
                if (s.tipo_solicitacao === 'CRIACAO_DATAS_ESPECIAIS') {
                    const desc = s.dados_novos?.lancamento_proposto?.descricao
                        || s.dados_novos?.lancamento_proposto?.dados_pai?.descricao
                        || 'sem descrição';
                    detalhes = `Aprovou a solicitação de criação de lançamento ("${desc}"), feita por ${s.nome_solicitante || 'usuário'}.`;
                } else {
                    const desc = s.dados_antigos?.descricao || 'sem descrição';
                    detalhes = `Aprovou a solicitação de ${tipo} do lançamento #${s.id_lancamento} ("${desc}"), feita por ${s.nome_solicitante || 'usuário'}.`;
                }
                dadosAlterados = { depois: { solicitacao: s } };
                break;
            }
            case 'REJEICAO_SOLICITACAO': {
                const s = dados.solicitacao || {};
                const tipo = (s.tipo_solicitacao || 'solicitação').toLowerCase();
                if (s.tipo_solicitacao === 'CRIACAO_DATAS_ESPECIAIS') {
                    detalhes = `Rejeitou a solicitação de criação de lançamento. Motivo: "${dados.motivo || 'não informado'}".`;
                } else {
                    detalhes = `Rejeitou a solicitação de ${tipo} do lançamento #${s.id_lancamento}. Motivo: "${dados.motivo || 'não informado'}".`;
                }
                dadosAlterados = { depois: { solicitacao: s, motivo: dados.motivo } };
                break;
            }

            // --- AGENDAMENTOS ---
            case 'CRIACAO_AGENDAMENTO':
                detalhes = `Agendou ${(dados.depois?.tipo || '').replace('A_', '').toLowerCase() || 'conta'} de ${formatCurrency(dados.depois?.valor)} para ${fmtData(dados.depois?.data_vencimento)} ("${descLanc(dados.depois)}").`;
                break;
            case 'CRIACAO_LOTE_AGENDAMENTO':
                detalhes = `Agendou ${dados.depois?.parcelas || 0} parcelas ("${dados.depois?.descricao_lote || 'lote'}") totalizando ${formatCurrency(dados.depois?.valor_total)}.`;
                break;
            case 'BAIXA_AGENDAMENTO':
                detalhes = `Deu baixa no agendamento #${dados.agendamento?.id} ("${descLanc(dados.agendamento)}") no valor de ${formatCurrency(dados.agendamento?.valor)}.`;
                dadosAlterados = { depois: { agendamento: dados.agendamento, lancamentoGeradoId: dados.lancamentoGeradoId } };
                break;
            case 'EDICAO_AGENDAMENTO':
                detalhes = `Editou o agendamento #${dados.depois?.id || dados.antes?.id}. Valor: ${formatCurrency(dados.antes?.valor)} → ${formatCurrency(dados.depois?.valor)}.`;
                break;
            case 'EXCLUSAO_AGENDAMENTO':
                detalhes = `Excluiu o agendamento pendente #${dados.antes?.id} ("${descLanc(dados.antes)}") de ${formatCurrency(dados.antes?.valor)}.`;
                break;
            case 'EXCLUSAO_AGENDAMENTO_FORCADA':
                detalhes = `Excluiu permanentemente o agendamento #${dados.antes?.id} ("${descLanc(dados.antes)}", status: ${dados.antes?.status || 'N/A'}) de ${formatCurrency(dados.antes?.valor)}.`;
                break;
            case 'EDICAO_LOTE_DESCRICAO':
                detalhes = `Alterou a descrição do lote #${dados.id_lote} para "${dados.nova_descricao_base}".`;
                dadosAlterados = { antes: { id_lote: dados.id_lote, descricao_exemplo: dados.descricao_antes }, depois: { nova_descricao_base: dados.nova_descricao_base } };
                break;

            // --- CONFIGURAÇÕES ---
            case 'CRIACAO_ENTIDADE': {
                const infoCriacao = getInfoEntidade(dados.depois);
                detalhes = `Criou ${infoCriacao.tipo.toLowerCase()} "${infoCriacao.nome}".`;
                break;
            }
            case 'EDICAO_ENTIDADE': {
                const infoEdicaoAntes = getInfoEntidade(dados.antes);
                const infoEdicaoDepois = getInfoEntidade(dados.depois);
                detalhes = `Alterou ${infoEdicaoDepois.tipo.toLowerCase()} de "${infoEdicaoAntes.nome}" para "${infoEdicaoDepois.nome}".`;
                break;
            }
            case 'ALTERACAO_STATUS_CONTATO': {
                const novoStatus = dados.depois?.ativo ? 'Ativo' : 'Inativo';
                detalhes = `Alterou o status do favorecido "${dados.depois?.nome}" para ${novoStatus}.`;
                break;
            }
            case 'CRIACAO_CONCESSIONARIA_VT':
                detalhes = `Cadastrou concessionária de VT "${dados.depois?.nome}" com taxa de ${dados.depois?.taxa_recarga_percentual}%.`;
                break;
            case 'EDICAO_CONCESSIONARIA_VT':
                detalhes = `Atualizou concessionária de VT "${dados.depois?.nome}" (taxa ${dados.depois?.taxa_recarga_percentual}%, ${dados.depois?.ativo ? 'ativa' : 'inativa'}).`;
                break;

            default:
                detalhes = `Ação de auditoria não especificada para o tipo: ${acao}`;
        }

        const query = `
            INSERT INTO fc_logs_auditoria (
                id_usuario, nome_usuario, acao, detalhes, dados_alterados, empresa_id
            )
            VALUES ($1, $2, $3, $4, $5, $6);
        `;
        await dbClient.query(
            query,
            [idUsuario, nomeUsuario, acao, detalhes, dadosAlterados, empresaId]
        );
    } catch (logError) {
        console.error('ERRO CRÍTICO AO REGISTRAR LOG DE AUDITORIA:', logError);
    }
}


// --- Middleware de Autenticação e Conexão para o Módulo Financeiro ---
// Este "porteiro" verifica se o usuário tem a permissão MÍNIMA para acessar qualquer coisa do financeiro.
router.use(async (req, res, next) => {
    try {
        const empresaId = obterEmpresaIdDoContexto(req);
        if (!req.usuarioLogado?.id) {
            throw erroFinanceiro(401, 'Usuário autenticado não encontrado.');
        }
        const dbClient = await pool.connect();
        try {
            const permissoesCompletas = await getPermissoesCompletasUsuarioDB(
                dbClient,
                req.usuarioLogado.id,
                empresaId
            );
            // A permissão base para este módulo
            if (!permissoesCompletas.includes('acesso-financeiro')) {
                return res.status(403).json({ error: 'Permissão negada para acessar o módulo financeiro.' });
            }
            req.permissoesUsuario = permissoesCompletas; // Anexa as permissões para uso nas rotas
            next(); // Se tiver permissão, pode prosseguir para a rota específica
        } finally {
            dbClient.release();
        }
    } catch (error) {
        console.error('[router/financeiro MID] Erro no middleware:', error.message);
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({ error: error.message, details: error.details });
    }
});

// GET /api/financeiro/concessionarias-vt
router.get('/concessionarias-vt', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(
            `SELECT *
               FROM config_concessionarias_vt
              WHERE empresa_id = $1
              ORDER BY nome`,
            [req.empresaId]
        );
                
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("[BACKEND /concessionarias-vt] ERRO:", error); // LOG
        res.status(500).json({ error: 'Erro ao buscar concessionárias.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/financeiro/concessionarias-vt
router.post('/concessionarias-vt', async (req, res) => {
    // Vamos criar uma permissão específica para isso
    if (!req.permissoesUsuario.includes('gerenciar-taxas-vt')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    const { nome, taxa_recarga_percentual } = req.body;
    if (!nome || taxa_recarga_percentual === undefined) {
        return res.status(400).json({ error: 'Nome e taxa são obrigatórios.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        const query = `
            INSERT INTO config_concessionarias_vt (
                nome, taxa_recarga_percentual, empresa_id
            )
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        const result = await dbClient.query(
            query,
            [nome, taxa_recarga_percentual, req.empresaId]
        );
        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'CRIACAO_CONCESSIONARIA_VT',
            { depois: result.rows[0] },
            req.empresaId
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') { // Erro de nome único
            return res.status(409).json({ error: 'Já existe uma concessionária com este nome.' });
        }
        res.status(500).json({ error: 'Erro ao criar concessionária.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PUT /api/financeiro/concessionarias-vt/:id
router.put('/concessionarias-vt/:id', async (req, res) => {
    if (!req.permissoesUsuario.includes('gerenciar-taxas-vt')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    const { id } = req.params;
    const { nome, taxa_recarga_percentual, ativo } = req.body;

    if (!nome || taxa_recarga_percentual === undefined || ativo === undefined) {
        return res.status(400).json({ error: 'Nome, taxa e status de ativo são obrigatórios.' });
    }
    
    let dbClient;
    try {
        dbClient = await pool.connect();
        const antes = await exigirRecursoDaEmpresa(
            dbClient,
            'config_concessionarias_vt',
            id,
            req.empresaId,
            { nome: 'Concessionária' }
        );
        const query = `
            UPDATE config_concessionarias_vt
               SET nome = $1,
                   taxa_recarga_percentual = $2,
                   ativo = $3,
                   updated_at = NOW()
             WHERE id = $4
               AND empresa_id = $5
             RETURNING *
        `;
        const result = await dbClient.query(
            query,
            [nome, taxa_recarga_percentual, ativo, id, req.empresaId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Concessionária não encontrada.' });
        }
        await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'EDICAO_CONCESSIONARIA_VT', {
            antes,
            depois: result.rows[0],
        }, req.empresaId);
        res.status(200).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Já existe uma concessionária com este nome.' });
        }
        res.status(500).json({ error: 'Erro ao atualizar concessionária.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- ROTA PARA O DASHBOARD (FERRAMENTA 4) ---
router.get('/dashboard', async (req, res) => {
    if (!req.permissoesUsuario.includes('visualizar-financeiro')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();

        // 1. Calcular saldos de todas as contas ativas
        // Esta query é mais complexa: ela soma todas as entradas e subtrai todas as saídas para cada conta.
        const saldosQuery = `
            SELECT 
                cb.id,
                cb.nome_conta,
                cb.saldo_inicial + COALESCE(SUM(
                    CASE 
                        WHEN l.tipo = 'RECEITA' THEN l.valor 
                        ELSE -l.valor 
                    END
                ), 0) as saldo_atual
            FROM fc_contas_bancarias cb
            LEFT JOIN fc_lancamentos l
              ON l.id_conta_bancaria = cb.id
             AND l.empresa_id = cb.empresa_id
             AND l.excluido_em IS NULL
            WHERE cb.ativo = true
              AND cb.empresa_id = $1
            GROUP BY cb.id, cb.nome_conta, cb.saldo_inicial
            ORDER BY cb.nome_conta;
        `;

        // 2. Contar alertas de contas a pagar
        const alertasQuery = `
            SELECT 
                -- Contas a pagar hoje
                COUNT(*) FILTER (WHERE tipo = 'A_PAGAR' AND data_vencimento = CURRENT_DATE) as a_pagar_hoje_count,
                COALESCE(SUM(valor) FILTER (WHERE tipo = 'A_PAGAR' AND data_vencimento = CURRENT_DATE), 0) as a_pagar_hoje_total,
                
                -- Contas a pagar nos próximos 3 dias (incluindo amanhã)
                COUNT(*) FILTER (WHERE tipo = 'A_PAGAR' AND data_vencimento > CURRENT_DATE AND data_vencimento <= CURRENT_DATE + INTERVAL '3 days') as a_pagar_3d_count,
                COALESCE(SUM(valor) FILTER (WHERE tipo = 'A_PAGAR' AND data_vencimento > CURRENT_DATE AND data_vencimento <= CURRENT_DATE + INTERVAL '3 days'), 0) as a_pagar_3d_total,

                -- Contas a pagar nos próximos 5 dias (depois dos 3 dias)
                COUNT(*) FILTER (WHERE tipo = 'A_PAGAR' AND data_vencimento > CURRENT_DATE + INTERVAL '3 days' AND data_vencimento <= CURRENT_DATE + INTERVAL '5 days') as a_pagar_5d_count,
                COALESCE(SUM(valor) FILTER (WHERE tipo = 'A_PAGAR' AND data_vencimento > CURRENT_DATE + INTERVAL '3 days' AND data_vencimento <= CURRENT_DATE + INTERVAL '5 days'), 0) as a_pagar_5d_total

            FROM fc_contas_agendadas
            WHERE status = 'PENDENTE'
              AND empresa_id = $1;
        `;

        // Executa as duas queries em paralelo
        const [saldosResult, alertasResult] = await Promise.all([
            dbClient.query(saldosQuery, [req.empresaId]),
            dbClient.query(alertasQuery, [req.empresaId])
        ]);
        
        res.status(200).json({
            saldos: saldosResult.rows,
            alertas: alertasResult.rows[0] // Alertas query sempre retorna uma única linha
        });

    } catch (error) {
        console.error('[API GET /dashboard] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar dados do dashboard.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ROTA PARA ALIMENTAR O HEADER COM DADOS EM TEMPO REAL
router.get('/header-status', async (req, res) => {
    // A permissão 'acesso-financeiro' já foi validada no middleware principal
    let dbClient;
    try {
        dbClient = await pool.connect();

        // Query para os alertas de contas (atrasadas e vencendo hoje)
        const alertasQuery = `
            SELECT 
                COUNT(*) FILTER (WHERE data_vencimento < CURRENT_DATE) as atrasadas_count,
                COALESCE(SUM(valor) FILTER (WHERE data_vencimento < CURRENT_DATE), 0) as atrasadas_total,
                COUNT(*) FILTER (WHERE data_vencimento = CURRENT_DATE) as hoje_count,
                COALESCE(SUM(valor) FILTER (WHERE data_vencimento = CURRENT_DATE), 0) as hoje_total
            FROM fc_contas_agendadas
            WHERE status = 'PENDENTE'
              AND tipo = 'A_PAGAR'
              AND empresa_id = $1;
        `;

        // Query para a última atividade (log mais recente)
        const ultimaAtividadeQuery = `
            SELECT id, detalhes, data_evento
            FROM fc_logs_auditoria
            WHERE empresa_id = $1
            ORDER BY data_evento DESC, id DESC
            LIMIT 1;
        `;
        
        // Query para aprovações pendentes
        const aprovacoesQuery = `
            SELECT COUNT(*) as pendentes_count
              FROM fc_solicitacoes_alteracao
             WHERE status = 'PENDENTE'
               AND empresa_id = $1
        `;

        // Executa as queries em paralelo para máxima eficiência
        const [alertasResult, atividadeResult, aprovacoesResult] = await Promise.all([
            dbClient.query(alertasQuery, [req.empresaId]),
            dbClient.query(ultimaAtividadeQuery, [req.empresaId]),
            req.permissoesUsuario.includes('aprovar-alteracao-financeira') 
                ? dbClient.query(aprovacoesQuery, [req.empresaId])
                : Promise.resolve({ rows: [{ pendentes_count: 0 }] })
        ]);

        const responseData = {
            contasAtrasadas: { count: parseInt(alertasResult.rows[0].atrasadas_count, 10), total: parseFloat(alertasResult.rows[0].atrasadas_total) },
            contasVencendoHoje: { count: parseInt(alertasResult.rows[0].hoje_count), total: parseFloat(alertasResult.rows[0].hoje_total) },
            ultimaAtividade: atividadeResult.rows[0] || { id: 0, detalhes: "Nenhuma atividade registrada.", data_evento: new Date() },
            aprovacoesPendentes: parseInt(aprovacoesResult.rows[0].pendentes_count, 10)
        };
        
        // Gera o ETag a partir do conteúdo da resposta
        const currentEtag = etag(JSON.stringify(responseData));

        // Compara com o ETag enviado pelo cliente
        if (req.headers['if-none-match'] === currentEtag) {
            // Se forem iguais, nada mudou. Responde 304 Not Modified.
            return res.status(304).send();
        }

        // Se forem diferentes (ou se o cliente não enviou ETag), envia a resposta completa
        res.setHeader('ETag', currentEtag);
        res.status(200).json(responseData);

    } catch (error) {
        console.error('[API GET /header-status] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar dados de status do header.' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/financeiro/relatorios/dre-simplificado
router.get('/relatorios/dre-simplificado', async (req, res) => {
    // 1. Verifica se o usuário tem permissão para ver os relatórios
    if (!req.permissoesUsuario.includes('acesso-relatorios-financeiros')) {
        return res.status(403).json({ error: 'Permissão negada para acessar relatórios.' });
    }

    // 2. Pega as datas da URL. Se não vierem, usa um padrão (ex: últimos 30 dias)
    const { dataInicio, dataFim } = req.query;
    if (!dataInicio || !dataFim) {
        return res.status(400).json({ error: 'As datas de início e fim são obrigatórias.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();

        // 3. Query SQL Inteligente:
        // - Usa FILTER para somar receitas e despesas em uma única passagem.
        // - Usa COALESCE para garantir que o resultado seja 0 em vez de nulo se não houver lançamentos.
        // - Exclui as transferências, pois elas não são receitas ou despesas reais.
        const dreQuery = `
            SELECT
                COALESCE(SUM(valor) FILTER (WHERE tipo = 'RECEITA'), 0) AS "totalReceitas",
                COALESCE(SUM(valor) FILTER (WHERE tipo = 'DESPESA'), 0) AS "totalDespesas"
            FROM fc_lancamentos
            WHERE
                empresa_id = $1
                AND data_transacao BETWEEN $2 AND $3
                AND id_transferencia_vinculada IS NULL
                AND excluido_em IS NULL;
        `;

        const result = await dbClient.query(
            dreQuery,
            [req.empresaId, dataInicio, dataFim]
        );
        
        const { totalReceitas, totalDespesas } = result.rows[0];

        // 4. Calcula o resultado final no backend
        const resultado = parseFloat(totalReceitas) - parseFloat(totalDespesas);

        // 5. Envia os dados prontos para o frontend
        res.status(200).json({
            totalReceitas: parseFloat(totalReceitas),
            totalDespesas: parseFloat(totalDespesas),
            resultado: resultado
        });

    } catch (error) {
        console.error("[API /relatorios/dre-simplificado] Erro:", error);
        res.status(500).json({ error: 'Erro ao gerar o relatório DRE.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// GET /api/financeiro/relatorios/despesas-por-categoria
router.get('/relatorios/despesas-por-categoria', async (req, res) => {
    if (!req.permissoesUsuario.includes('acesso-relatorios-financeiros')) {
        return res.status(403).json({ error: 'Permissão negada para acessar relatórios.' });
    }

    const { dataInicio, dataFim } = req.query;
    if (!dataInicio || !dataFim) {
        return res.status(400).json({ error: 'As datas de início e fim são obrigatórias.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        const categoriasQuery = `
            SELECT
                cat.nome AS "nome",
                SUM(l.valor)::numeric AS "valor"
            FROM fc_lancamentos l
            JOIN fc_categorias cat
              ON l.id_categoria = cat.id
             AND l.empresa_id = cat.empresa_id
            WHERE
                l.empresa_id = $1
                AND l.tipo = 'DESPESA'
                AND l.data_transacao BETWEEN $2 AND $3
                AND l.id_transferencia_vinculada IS NULL
                AND l.excluido_em IS NULL
            GROUP BY
                cat.nome
            ORDER BY
                "valor" DESC
            LIMIT 10;
        `;
        
        const result = await dbClient.query(
            categoriasQuery,
            [req.empresaId, dataInicio, dataFim]
        );

        res.status(200).json(result.rows);

    } catch (error) {
        console.error("[API /relatorios/despesas-por-categoria] Erro:", error);
        res.status(500).json({ error: 'Erro ao gerar o relatório de despesas por categoria.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// --- ROTAS DA FERRAMENTA 1: CONFIGURAÇÕES ---

// GET /api/financeiro/configuracoes - Rota para buscar todas as configurações iniciais
router.get('/configuracoes', async (req, res) => {
    let dbClient;
    try {
        dbClient = await pool.connect();
        
        const [contasResult, gruposResult, categoriasResult] = await Promise.all([
            dbClient.query(
                `SELECT *
                   FROM fc_contas_bancarias
                  WHERE ativo = true
                    AND empresa_id = $1
                  ORDER BY nome_conta`,
                [req.empresaId]
            ),
            dbClient.query(
                `SELECT *
                   FROM fc_grupos_financeiros
                  WHERE empresa_id = $1
                  ORDER BY tipo, nome`,
                [req.empresaId]
            ),
            dbClient.query(
                `SELECT *
                   FROM fc_categorias
                  WHERE empresa_id = $1
                  ORDER BY nome`,
                [req.empresaId]
            )
        ]);

        res.status(200).json({
            contas: contasResult.rows,
            grupos: gruposResult.rows,
            categorias: categoriasResult.rows
        });

    } catch (error) {
        console.error('[API /financeiro/configuracoes] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar configurações financeiras.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- ROTAS PARA GERENCIAR CONTAS BANCÁRIAS ---
router.post('/contas', async (req, res) => {
    if (!req.permissoesUsuario.includes('gerenciar-contas')) {
        return res.status(403).json({ error: 'Permissão negada para criar contas bancárias.' });
    }
    const { nome_conta, banco, agencia, numero_conta, saldo_inicial } = req.body;
    if (!nome_conta) {
        return res.status(400).json({ error: 'O nome da conta é obrigatório.' });
    }
    
    let dbClient;
    try {
        dbClient = await pool.connect();
        const query = `
            INSERT INTO fc_contas_bancarias (
                nome_conta, banco, agencia, numero_conta, saldo_inicial, empresa_id
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;
        const result = await dbClient.query(
            query,
            [nome_conta, banco, agencia, numero_conta, saldo_inicial || 0, req.empresaId]
        );
        const novaConta = result.rows[0]; // Guarda o resultado em uma variável para usar no log

    await registrarLog(
        dbClient,
        req.usuarioLogado.id,
        req.usuarioLogado.nome,
        'CRIACAO_ENTIDADE',
        { depois: novaConta },
        req.empresaId
    );

    res.status(201).json(novaConta);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao criar conta bancária.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.put('/contas/:id', async (req, res) => {
    if (!req.permissoesUsuario.includes('gerenciar-contas')) {
        return res.status(403).json({ error: 'Permissão negada para editar contas bancárias.' });
    }
    const { id } = req.params;
    const { nome_conta, banco, agencia, numero_conta, ativo } = req.body;

    if (!nome_conta) {
        return res.status(400).json({ error: 'O nome da conta é obrigatório.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        // 1. Busque o estado original ANTES de atualizar
        const contaOriginal = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_contas_bancarias',
            id,
            req.empresaId,
            { nome: 'Conta bancária', forUpdate: true }
        );

        // 2. Execute a atualização
        const query = `
            UPDATE fc_contas_bancarias
            SET nome_conta = $1, banco = $2, agencia = $3, numero_conta = $4, ativo = $5, atualizado_em = NOW()
            WHERE id = $6
              AND empresa_id = $7
            RETURNING *;
        `;
        const result = await dbClient.query(
            query,
            [nome_conta, banco, agencia, numero_conta, ativo, id, req.empresaId]
        );
        const contaAtualizada = result.rows[0];

        // 3. REGISTRE O LOG
        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'EDICAO_ENTIDADE',
            { antes: contaOriginal, depois: contaAtualizada },
            req.empresaId
        );

        await dbClient.query('COMMIT');
        res.status(200).json(contaAtualizada);

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao atualizar conta bancária.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// --- ROTAS PARA GERENCIAR GRUPOS FINANCEIROS ---
router.post('/grupos', async (req, res) => {
    if (!req.permissoesUsuario.includes('gerenciar-categorias')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    const { nome, tipo } = req.body;
    if (!nome || !tipo || !['RECEITA', 'DESPESA'].includes(tipo)) {
        return res.status(400).json({ error: 'Nome e tipo (RECEITA ou DESPESA) são obrigatórios.' });
    }
    let dbClient;
    try {
        dbClient = await pool.connect();
        const query = `
            INSERT INTO fc_grupos_financeiros (nome, tipo, empresa_id)
            VALUES ($1, $2, $3)
            RETURNING *;
        `;
        const result = await dbClient.query(query, [nome, tipo, req.empresaId]);
        const novaConta = result.rows[0]; // Pega a nova entidade criada

        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'CRIACAO_ENTIDADE',
            { depois: novaConta },
            req.empresaId
        );

        res.status(201).json(novaConta);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao criar grupo financeiro.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.put('/grupos/:id', async (req, res) => {
    if (!req.permissoesUsuario.includes('gerenciar-categorias')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    const { id } = req.params;
    const { nome, tipo } = req.body;
    if (!nome || !tipo || !['RECEITA', 'DESPESA'].includes(tipo)) {
        return res.status(400).json({ error: 'Nome e tipo (RECEITA ou DESPESA) são obrigatórios.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        // 1. Busca o estado original
        const grupoOriginal = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_grupos_financeiros',
            id,
            req.empresaId,
            { nome: 'Grupo financeiro', forUpdate: true }
        );

        // 2. Executa a atualização
        const query = `
            UPDATE fc_grupos_financeiros
               SET nome = $1, tipo = $2, atualizado_em = NOW()
             WHERE id = $3
               AND empresa_id = $4
             RETURNING *;
        `;
        const result = await dbClient.query(query, [nome, tipo, id, req.empresaId]);
        const grupoAtualizado = result.rows[0];

        // 3. Registra o log
        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'EDICAO_ENTIDADE',
            { antes: grupoOriginal, depois: grupoAtualizado },
            req.empresaId
        );
        
        await dbClient.query('COMMIT');
        res.status(200).json(grupoAtualizado);

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao atualizar grupo financeiro.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// --- ROTAS PARA GERENCIAR CATEGORIAS ---
router.post('/categorias', async (req, res) => {
    if (!req.permissoesUsuario.includes('gerenciar-categorias')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    const { nome, id_grupo } = req.body;
    if (!nome || !id_grupo) {
        return res.status(400).json({ error: 'Nome da categoria e ID do grupo são obrigatórios.' });
    }
    let dbClient;
    try {
        dbClient = await pool.connect();
        await exigirRecursoDaEmpresa(
            dbClient,
            'fc_grupos_financeiros',
            id_grupo,
            req.empresaId,
            { nome: 'Grupo financeiro' }
        );
        const query = `
            INSERT INTO fc_categorias (nome, id_grupo, empresa_id)
            VALUES ($1, $2, $3)
            RETURNING *;
        `;
        const result = await dbClient.query(query, [nome, id_grupo, req.empresaId]);
        const novaConta = result.rows[0]; // Pega a nova entidade criada

        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'CRIACAO_ENTIDADE',
            { depois: novaConta },
            req.empresaId
        );

        res.status(201).json(novaConta);
    } catch (error) {
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao criar categoria.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.put('/categorias/:id', async (req, res) => {
    if (!req.permissoesUsuario.includes('gerenciar-categorias')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    const { id } = req.params;
    const { nome, id_grupo } = req.body;
    if (!nome || !id_grupo) {
        return res.status(400).json({ error: 'Nome da categoria e ID do grupo são obrigatórios.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        // 1. Busca o estado original
        const categoriaOriginal = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_categorias',
            id,
            req.empresaId,
            { nome: 'Categoria', forUpdate: true }
        );
        await exigirRecursoDaEmpresa(
            dbClient,
            'fc_grupos_financeiros',
            id_grupo,
            req.empresaId,
            { nome: 'Grupo financeiro' }
        );

        // 2. Executa a atualização
        const query = `
            UPDATE fc_categorias
               SET nome = $1, id_grupo = $2, atualizado_em = NOW()
             WHERE id = $3
               AND empresa_id = $4
             RETURNING *;
        `;
        const result = await dbClient.query(query, [nome, id_grupo, id, req.empresaId]);
        const categoriaAtualizada = result.rows[0];

        // 3. Registra o log
        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'EDICAO_ENTIDADE',
            { antes: categoriaOriginal, depois: categoriaAtualizada },
            req.empresaId
        );

        await dbClient.query('COMMIT');
        res.status(200).json(categoriaAtualizada);

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao atualizar categoria.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// --- ROTAS PARA LANÇAMENTOS (FERRAMENTA 2) ---
router.get('/lancamentos', async (req, res) => {
    if (!req.permissoesUsuario.includes('visualizar-financeiro')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    
    const { limit = 50, page = 1, dataInicio, dataFim, tipo, idConta, termoBusca, tipoRateio } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let dbClient;
    try {
        dbClient = await pool.connect();

        let whereClauses = ['l.excluido_em IS NULL', 'l.empresa_id = $1'];
        let params = [req.empresaId];
        let paramIndex = 2;

        if (dataInicio) {
            whereClauses.push(`l.data_transacao >= $${paramIndex++}`);
            params.push(dataInicio);
        }
        if (dataFim) {
            whereClauses.push(`l.data_transacao <= $${paramIndex++}`);
            params.push(dataFim);
        }
        if (tipo) {
            whereClauses.push(`l.tipo = $${paramIndex++}`);
            params.push(tipo);
        }
        if (idConta) {
            whereClauses.push(`l.id_conta_bancaria = $${paramIndex++}`);
            params.push(idConta);
        }

        if (tipoRateio) {
        switch (tipoRateio) {
            case 'simples':
                // Lançamento simples é aquele que NÃO tem um tipo_rateio e NÃO é uma transferência.
                whereClauses.push(`l.tipo_rateio IS NULL AND l.id_transferencia_vinculada IS NULL`);
                break;
            case 'transferencia':
                // Lançamento de transferência é aquele que tem o campo id_transferencia_vinculada preenchido.
                whereClauses.push(`l.id_transferencia_vinculada IS NOT NULL`);
                break;
            case 'COMPRA':
            case 'DETALHADO':
                // Para 'COMPRA' e 'DETALHADO', o filtro é direto na coluna tipo_rateio.
                whereClauses.push(`l.tipo_rateio = $${paramIndex++}`);
                params.push(tipoRateio);
                break;
        }
    }


        if (termoBusca) {
            // 1. Tratamento para busca por ID (ex: #123)
            if (termoBusca.startsWith('#')) {
                const idNumerico = parseInt(termoBusca.substring(1), 10);
                if (!isNaN(idNumerico)) {
                    whereClauses.push(`l.id = $${paramIndex++}`);
                    params.push(idNumerico);
                }
            } 
            // 2. Tratamento para busca por VALOR
            else if (!isNaN(parseFloat(termoBusca.replace(',', '.')))) {
                const valorNumerico = parseFloat(termoBusca.replace(',', '.'));
                whereClauses.push(`ROUND(l.valor::numeric, 2) = ROUND($${paramIndex++}::numeric, 2)`);
                params.push(valorNumerico);
            }
            // 3. Fallback: Se não for ID nem valor, busca por descrição ou favorecido (como antes)
            else {
                whereClauses.push(`(l.descricao ILIKE $${paramIndex} OR fav.nome ILIKE $${paramIndex})`);
                params.push(`%${termoBusca}%`);
                paramIndex++;
            }
        }

        const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const baseQuery = `
            FROM fc_lancamentos l
            JOIN fc_contas_bancarias cb
              ON l.id_conta_bancaria = cb.id
             AND l.empresa_id = cb.empresa_id
            LEFT JOIN fc_categorias cat
              ON l.id_categoria = cat.id
             AND l.empresa_id = cat.empresa_id
            LEFT JOIN fc_contatos fav
              ON l.id_contato = fav.id
             AND l.empresa_id = fav.empresa_id
            JOIN usuarios u_criador ON l.id_usuario_lancamento = u_criador.id
            LEFT JOIN usuarios u_editor ON l.id_usuario_edicao = u_editor.id 
        `;
        
        const query = `
            SELECT 
                l.*, 
                cb.nome_conta,
                cat.nome as nome_categoria,
                u_criador.nome as nome_usuario,
                u_editor.nome as nome_usuario_edicao,
                fav.nome as nome_favorecido,
                (
                    SELECT json_agg(json_build_object(
                        'id', li.id,
                        'descricao_item', li.descricao_item,
                        'quantidade', li.quantidade,
                        'valor_unitario', li.valor_unitario,
                        'valor_total_item', li.valor_total_item,
                        'id_categoria', li.id_categoria,
                        'nome_categoria', cat_item.nome,
                        'id_contato_item', li.id_contato_item,
                        'nome_contato_item', contato_item.nome
                    ))
                    FROM fc_lancamento_itens li
                    LEFT JOIN fc_categorias cat_item
                      ON li.id_categoria = cat_item.id
                     AND li.empresa_id = cat_item.empresa_id
                    LEFT JOIN fc_contatos contato_item
                      ON li.id_contato_item = contato_item.id
                     AND li.empresa_id = contato_item.empresa_id
                    WHERE li.id_lancamento_pai = l.id
                      AND li.empresa_id = l.empresa_id
                ) as itens
            ${baseQuery}
            ${whereString}
            ORDER BY l.data_transacao DESC, l.id DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++};
        `;
        params.push(limit, offset);
        
        const countQuery = `SELECT COUNT(l.id) ${baseQuery} ${whereString};`;
        const countParams = params.slice(0, -2);
        
        const [result, countResult] = await Promise.all([
             dbClient.query(query, params),
             dbClient.query(countQuery, countParams)
        ]);

        const total = parseInt(countResult.rows[0].count, 10);
        
        res.status(200).json({
            lancamentos: result.rows,
            total,
            page: parseInt(page),
            pages: Math.ceil(total / limit) || 1
        });

    } catch (error) {
        console.error('[API GET /lancamentos] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar lançamentos.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

/**
 * Info gerencial do lançamento (clique no card):
 * quem criou, alterações/solicitações (edição, exclusão, estorno…), quem aprovou/rejeitou.
 */
router.get('/lancamentos/:id/info-gerencial', async (req, res) => {
    if (!req.permissoesUsuario.includes('exibir-informacao-gerencial')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
        return res.status(400).json({ error: 'ID de lançamento inválido.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();

        const lancRes = await dbClient.query(
            `SELECT
                l.id,
                l.descricao,
                l.status_edicao,
                l.motivo_rejeicao,
                l.data_lancamento,
                l.atualizado_em,
                l.id_estorno_de,
                l.id_transferencia_vinculada,
                l.id_usuario_lancamento,
                l.id_usuario_edicao,
                u_criador.nome AS nome_usuario,
                u_editor.nome AS nome_usuario_edicao
             FROM fc_lancamentos l
             JOIN usuarios u_criador ON l.id_usuario_lancamento = u_criador.id
             LEFT JOIN usuarios u_editor ON l.id_usuario_edicao = u_editor.id
             WHERE l.id = $1
               AND l.empresa_id = $2
               AND l.excluido_em IS NULL`,
            [id, req.empresaId]
        );

        if (lancRes.rows.length === 0) {
            return res.status(404).json({ error: 'Lançamento não encontrado.' });
        }

        const lanc = lancRes.rows[0];

        const solRes = await dbClient.query(
            `SELECT
                sa.id,
                sa.tipo_solicitacao,
                sa.status,
                sa.data_solicitacao,
                sa.data_decisao,
                sa.justificativa_solicitante,
                sa.motivo_rejeicao,
                u_sol.nome AS nome_solicitante,
                u_apr.nome AS nome_aprovador
             FROM fc_solicitacoes_alteracao sa
             JOIN usuarios u_sol ON sa.id_usuario_solicitante = u_sol.id
             LEFT JOIN usuarios u_apr ON sa.id_usuario_aprovador = u_apr.id
             WHERE sa.id_lancamento = $1
               AND sa.empresa_id = $2
             ORDER BY sa.data_solicitacao DESC, sa.id DESC`,
            [id, req.empresaId]
        );

        res.status(200).json({
            id: lanc.id,
            descricao: lanc.descricao,
            status_edicao: lanc.status_edicao,
            motivo_rejeicao: lanc.motivo_rejeicao,
            criado_por: lanc.nome_usuario,
            criado_em: lanc.data_lancamento,
            editado_por: lanc.nome_usuario_edicao || null,
            editado_em: lanc.atualizado_em || null,
            eh_estorno: Boolean(lanc.id_estorno_de),
            id_estorno_de: lanc.id_estorno_de || null,
            eh_transferencia: Boolean(lanc.id_transferencia_vinculada),
            solicitacoes: solRes.rows,
        });
    } catch (error) {
        console.error(`[API GET /lancamentos/${req.params.id}/info-gerencial] Erro:`, error);
        res.status(500).json({ error: 'Erro ao buscar informação gerencial.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.post('/lancamentos', async (req, res) => {
    if (!req.permissoesUsuario.includes('lancar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada para criar lançamentos.' });
    }
    
    const { id_conta_bancaria, id_categoria, tipo, valor, data_transacao, descricao, id_contato } = req.body;
    
    if (!id_conta_bancaria || !id_categoria || !tipo || !valor || !data_transacao) {
        return res.status(400).json({ error: 'Campos obrigatórios estão faltando.' });
    }
    
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        await exigirRecursoDaEmpresa(
            dbClient,
            'fc_contas_bancarias',
            id_conta_bancaria,
            req.empresaId,
            { nome: 'Conta bancária' }
        );
        await exigirRecursoDaEmpresa(
            dbClient,
            'fc_categorias',
            id_categoria,
            req.empresaId,
            { nome: 'Categoria' }
        );
        if (id_contato) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_contatos',
                id_contato,
                req.empresaId,
                { nome: 'Favorecido' }
            );
        }

        const query = `
            INSERT INTO fc_lancamentos 
                (id_conta_bancaria, id_categoria, tipo, valor, data_transacao,
                 descricao, id_contato, id_usuario_lancamento, empresa_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *;
        `;
        const result = await dbClient.query(query, [
            id_conta_bancaria,
            id_categoria,
            tipo,
            valor,
            data_transacao,
            descricao,
            id_contato || null,
            req.usuarioLogado.id,
            req.empresaId
        ]);
        const novoLancamento = result.rows[0];

        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'CRIACAO_LANCAMENTO',
            { depois: novoLancamento },
            req.empresaId
        );

        await dbClient.query('COMMIT');
        res.status(201).json(novoLancamento);

    } catch (error) {
        if(dbClient) await dbClient.query('ROLLBACK');
        console.error("[API POST /lancamentos] Erro:", error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao criar lançamento.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- ROTAS PARA CONTATOS (CLIENTES/FORNECEDORES) ---
router.get('/contatos', async (req, res) => {
    // A verificação de permissão é mantida, pois é uma boa prática de segurança.
    if (!req.permissoesUsuario.includes('visualizar-financeiro')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    
    const termoBusca = req.query.q;
    
    if (!termoBusca || termoBusca.trim() === '') {
        return res.status(200).json([]); 
    }

    let dbClient;
    try {
        dbClient = await pool.connect();

        // Alteramos a query para selecionar também a coluna 'tipo'
        const query = `
            SELECT id, nome, tipo
              FROM fc_contatos
             WHERE nome ILIKE $1
               AND ativo = true
               AND empresa_id = $2
             ORDER BY nome
             LIMIT 10
        `;
        const params = [`%${termoBusca.trim()}%`, req.empresaId];

        const result = await dbClient.query(query, params);
        
        res.status(200).json(result.rows);

    } catch (error) {
        console.error('[API GET /contatos] Erro na execução da query:', error);
        res.status(500).json({ error: 'Erro interno ao buscar favorecidos.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// Listar TODOS os contatos para a tela de gerenciamento
router.get('/contatos/all', async (req, res) => {
    if (!req.permissoesUsuario.includes('visualizar-financeiro')) { // Usando uma permissão base
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    let dbClient;
    try {
        dbClient = await pool.connect();
        const result = await dbClient.query(
            `SELECT *
               FROM fc_contatos
              WHERE empresa_id = $1
              ORDER BY nome`,
            [req.empresaId]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar todos os contatos.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.post('/contatos', async (req, res) => {
    if (!req.permissoesUsuario.includes('criar-favorecido')) {
        return res.status(403).json({ error: 'Permissão negada para criar novos favorecidos.' });
    }
    
    const { nome, tipo, cpf_cnpj, observacoes } = req.body;
    const tiposValidos = ['CLIENTE', 'FORNECEDOR', 'EMPREGADO', 'EX_EMPREGADO', 'SOCIOS', 'AMBOS'];
    
    if (!nome || !tipo || !tiposValidos.includes(tipo)) {
        return res.status(400).json({ error: `Nome e tipo são obrigatórios. O tipo deve ser um de: ${tiposValidos.join(', ')}.` });
    }
    
    let dbClient;
    try {
        dbClient = await pool.connect();

        // 1. VERIFICA SE JÁ EXISTE um contato com o mesmo nome e tipo.
        const checkQuery = `
            SELECT id
              FROM fc_contatos
             WHERE nome = $1
               AND tipo = $2
               AND empresa_id = $3
        `;
        const existingContact = await dbClient.query(
            checkQuery,
            [nome, tipo, req.empresaId]
        );

        // 2. SE EXISTIR, retorna um erro amigável (409 Conflict).
        if (existingContact.rows.length > 0) {
            return res.status(409).json({ error: 'Este contato já está cadastrado com este tipo.' });
        }

        // 3. SE NÃO EXISTIR, prossegue com a criação.
        const insertQuery = `
            INSERT INTO fc_contatos (nome, tipo, cpf_cnpj, observacoes, empresa_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *;
        `;
        const result = await dbClient.query(
            insertQuery,
            [nome, tipo, cpf_cnpj, observacoes, req.empresaId]
        );
        
        const novaConta = result.rows[0]; // Pega a nova entidade criada
        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'CRIACAO_ENTIDADE',
            { depois: novaConta },
            req.empresaId
        );

        res.status(201).json(novaConta);

    } catch (error) {
        // Este catch agora é para erros inesperados, não para duplicidade.
        console.error('[API POST /contatos] Erro inesperado:', error);
        res.status(500).json({ error: 'Erro ao criar contato.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// NOVA ROTA: Atualizar um contato
router.put('/contatos/:id', async (req, res) => {
    if (!req.permissoesUsuario.includes('gerenciar-categorias')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    const { id } = req.params;
    const { nome, tipo, cpf_cnpj, observacoes } = req.body;
    const tiposValidos = ['CLIENTE', 'FORNECEDOR', 'EMPREGADO', 'EX_EMPREGADO', 'SOCIOS', 'AMBOS'];
    if (!nome || !tipo || !tiposValidos.includes(tipo)) {
        return res.status(400).json({ error: 'Dados inválidos.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        // 1. Busca o estado original
        const contatoOriginal = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_contatos',
            id,
            req.empresaId,
            { nome: 'Contato', forUpdate: true }
        );

        // 2. Executa a atualização
        const query = `
            UPDATE fc_contatos 
            SET nome = $1, tipo = $2, cpf_cnpj = $3, observacoes = $4 
            WHERE id = $5
              AND empresa_id = $6
            RETURNING *;
        `;
        const result = await dbClient.query(
            query,
            [nome, tipo, cpf_cnpj, observacoes, id, req.empresaId]
        );
        const contatoAtualizado = result.rows[0];

        // 3. Registra o log
        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'EDICAO_ENTIDADE',
            { antes: contatoOriginal, depois: contatoAtualizado },
            req.empresaId
        );

        await dbClient.query('COMMIT');
        res.status(200).json(contatoAtualizado);

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao atualizar contato.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// INATIVAR/REATIVAR em vez de deletar
router.put('/contatos/:id/status', async (req, res) => {
    if (!req.permissoesUsuario.includes('gerenciar-categorias')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    const { id } = req.params;
    const { ativo } = req.body; 

    if (typeof ativo !== 'boolean') {
        return res.status(400).json({ error: 'O status "ativo" (true/false) é obrigatório.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const contatoOriginal = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_contatos',
            id,
            req.empresaId,
            { nome: 'Favorecido', forUpdate: true }
        );

        const query = `
            UPDATE fc_contatos
               SET ativo = $1
             WHERE id = $2
               AND empresa_id = $3
             RETURNING *;
        `;
        const result = await dbClient.query(query, [ativo, id, req.empresaId]);
        const contatoAtualizado = result.rows[0];

        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'ALTERACAO_STATUS_CONTATO',
            { antes: contatoOriginal, depois: contatoAtualizado },
            req.empresaId
        );

        await dbClient.query('COMMIT');
        res.status(200).json(contatoAtualizado);

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao alterar status do favorecido.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.put('/lancamentos/:id', async (req, res) => {
    if (!req.permissoesUsuario.includes('editar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada para editar lançamentos.' });
    }

    const { id } = req.params;
    const novosDados = req.body; // O corpo agora contém apenas os novos dados do lançamento
    
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const lancamentoOriginal = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_lancamentos',
            id,
            req.empresaId,
            { nome: 'Lançamento', forUpdate: true }
        );
        if (lancamentoOriginal.excluido_em) {
            throw erroFinanceiro(404, 'Lançamento não encontrado no contexto da empresa ativa.');
        }

        if (lancamentoOriginal.status_edicao === 'PENDENTE_APROVACAO' || lancamentoOriginal.status_edicao === 'PENDENTE_EXCLUSAO') {
             await dbClient.query('ROLLBACK');
             return res.status(409).json({ error: 'Este lançamento já possui uma solicitação pendente e não pode ser editado.' });
        }
        
        if (req.permissoesUsuario.includes('aprovar-alteracao-financeira')) {
            // FLUXO DO ADMIN: Edita diretamente
            const { valor, data_transacao, id_categoria, id_conta_bancaria, descricao, id_contato } = novosDados;
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_contas_bancarias',
                id_conta_bancaria,
                req.empresaId,
                { nome: 'Conta bancária' }
            );
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_categorias',
                id_categoria,
                req.empresaId,
                { nome: 'Categoria' }
            );
            if (id_contato) {
                await exigirRecursoDaEmpresa(
                    dbClient,
                    'fc_contatos',
                    id_contato,
                    req.empresaId,
                    { nome: 'Favorecido' }
                );
            }
            
            const queryUpdate = `
                UPDATE fc_lancamentos 
                SET valor=$1, data_transacao=$2, id_categoria=$3, id_conta_bancaria=$4, descricao=$5, id_contato=$6, 
                    status_edicao='OK', motivo_rejeicao=NULL, 
                    id_usuario_edicao = $7, -- Adiciona o ID do editor
                    atualizado_em = NOW()    -- Adiciona a data/hora atual
                WHERE id = $8
                  AND empresa_id = $9
                RETURNING *;`;
            
            // <<< MUDANÇA NOS PARÂMETROS >>>
            const updatedResult = await dbClient.query(queryUpdate, [
                valor, data_transacao, id_categoria, id_conta_bancaria, descricao, id_contato, 
                req.usuarioLogado.id, // Parâmetro $7
                id,
                req.empresaId
            ]);
            
            await registrarLog(
                dbClient,
                req.usuarioLogado.id,
                req.usuarioLogado.nome,
                'EDICAO_LANCAMENTO',
                { antes: lancamentoOriginal, depois: updatedResult.rows[0] },
                req.empresaId
            );
            
            await dbClient.query('COMMIT');
            return res.status(200).json({ 
                message: 'Lançamento atualizado com sucesso.',
                lancamento: updatedResult.rows[0]
            });
        } else {
            const { justificativa } = novosDados; 

            const solRes = await dbClient.query(
                `INSERT INTO fc_solicitacoes_alteracao 
                    (id_lancamento, tipo_solicitacao, dados_antigos, dados_novos,
                     id_usuario_solicitante, justificativa_solicitante, empresa_id)
                VALUES ($1, 'EDICAO', $2, $3, $4, $5, $6) RETURNING *;`,
                // Adicionamos a justificativa no insert também
                [
                    id,
                    JSON.stringify(lancamentoOriginal),
                    JSON.stringify(novosDados),
                    req.usuarioLogado.id,
                    justificativa,
                    req.empresaId,
                ]
            );
            await dbClient.query(
                `UPDATE fc_lancamentos
                    SET status_edicao = 'PENDENTE_APROVACAO', motivo_rejeicao = NULL
                  WHERE id = $1
                    AND empresa_id = $2`,
                [id, req.empresaId]
            );
            
            // CORREÇÃO AQUI: Passamos a justificativa para o log
            await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'SOLICITACAO_EDICAO', { 
                id_lancamento: id, 
                justificativa: justificativa,
                solicitacao: solRes.rows[0]
            }, req.empresaId);
            
            await dbClient.query('COMMIT');
            return res.status(202).json({ message: 'Edição solicitada e aguardando aprovação.' });
        }
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error("[API PUT /lancamentos/:id] Erro:", error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao processar edição do lançamento.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.post('/lancamentos/:id/solicitar-exclusao', async (req, res) => {
    if (!req.permissoesUsuario.includes('editar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada para solicitar exclusão.' });
    }
    const { id } = req.params;
    const { justificativa } = req.body;

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const lancamentoOriginal = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_lancamentos',
            id,
            req.empresaId,
            { nome: 'Lançamento', forUpdate: true }
        );
        if (lancamentoOriginal.excluido_em) {
            throw erroFinanceiro(404, 'Lançamento não encontrado no contexto da empresa ativa.');
        }

        if (['PENDENTE_APROVACAO', 'PENDENTE_EXCLUSAO'].includes(lancamentoOriginal.status_edicao)) {
            await dbClient.query('ROLLBACK');
            return res.status(409).json({ error: 'Este lançamento já possui uma solicitação pendente e não pode ser excluído.' });
        }

        if (req.permissoesUsuario.includes('aprovar-alteracao-financeira')) {
            
            // Cria uma cópia do objeto para enriquecer com dados para o log
            const lancamentoParaLog = { ...lancamentoOriginal };
            if (lancamentoParaLog.tipo_rateio) {
                const primeiroItemRes = await dbClient.query(
                    `SELECT id_categoria
                       FROM fc_lancamento_itens
                      WHERE id_lancamento_pai = $1
                        AND empresa_id = $2
                      LIMIT 1`,
                    [id, req.empresaId]
                );
                if (primeiroItemRes.rows.length > 0) {
                    lancamentoParaLog.id_categoria = primeiroItemRes.rows[0].id_categoria;
                }
            }

            // Soft delete (mantém itens e linha para auditoria / futura reativação)
            await softDeleteLancamento(
                dbClient,
                id,
                req.usuarioLogado.id,
                req.empresaId,
                { cascade: true }
            );

            await registrarLog(
                dbClient,
                req.usuarioLogado.id,
                req.usuarioLogado.nome,
                'EXCLUSAO_LANCAMENTO',
                { antes: lancamentoParaLog },
                req.empresaId
            );
            
            await dbClient.query('COMMIT');
            return res.status(200).json({ message: 'Lançamento excluído com sucesso (cancelamento lógico). A conta agendada original, se existir, voltou a ficar pendente.' });
        
        } else {
            // FLUXO DO USUÁRIO COMUM: Cria solicitação
            if (!justificativa || justificativa.trim() === '') {
                await dbClient.query('ROLLBACK');
                return res.status(400).json({ error: 'A justificativa é obrigatória para solicitar a exclusão.' });
            }
            await dbClient.query(
                `UPDATE fc_lancamentos
                    SET status_edicao = 'PENDENTE_EXCLUSAO', motivo_rejeicao = NULL
                  WHERE id = $1
                    AND empresa_id = $2`,
                [id, req.empresaId]
            );
            const solRes = await dbClient.query(
                `INSERT INTO fc_solicitacoes_alteracao (
                    id_lancamento, tipo_solicitacao, dados_antigos,
                    id_usuario_solicitante, justificativa_solicitante, empresa_id
                )
                VALUES ($1, 'EXCLUSAO', $2, $3, $4, $5)
                RETURNING *;`,
                [
                    id,
                    JSON.stringify(lancamentoOriginal),
                    req.usuarioLogado.id,
                    justificativa.trim(),
                    req.empresaId,
                ]
            );
          
            await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'SOLICITACAO_EXCLUSAO', {
                id_lancamento: id,
                justificativa: justificativa.trim(), // Garantir que a justificativa seja passada
                solicitacao: solRes.rows[0]
            }, req.empresaId);

            await dbClient.query('COMMIT');
            return res.status(202).json({ message: 'Solicitação de exclusão enviada para aprovação.' });
        }
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error(`[API /solicitar-exclusao] ERRO CRÍTICO no processamento da exclusão do lançamento #${id}:`, error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode
                ? error.message
                : 'Erro interno ao processar solicitação de exclusão.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ROTA PARA REGISTRAR UM ESTORNO
router.post('/lancamentos/:id/estornar', async (req, res) => {
    if (!req.permissoesUsuario.includes('estornar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada para solicitar estornos.' });
    }

    const { id: idLancamentoOriginal } = req.params;
    const dadosEstorno = req.body;
    
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const lancamentoOriginal = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_lancamentos',
            idLancamentoOriginal,
            req.empresaId,
            { nome: 'Lançamento original', forUpdate: true }
        );
        if (lancamentoOriginal.excluido_em) {
            throw erroFinanceiro(404, 'Lançamento original não encontrado.');
        }

        if (lancamentoOriginal.status_edicao !== 'OK' && lancamentoOriginal.status_edicao !== 'ESTORNADO' && lancamentoOriginal.status_edicao !== 'EDITADO_APROVADO' && lancamentoOriginal.status_edicao !== 'EDICAO_REJEITADA') {
            await dbClient.query('ROLLBACK'); 
            return res.status(409).json({ error: `Este lançamento já possui uma ação pendente (${lancamentoOriginal.status_edicao}) e não pode ser alterado.` });
        }

        // FLUXO DO ADMIN: Executa diretamente (sem mudanças aqui)
        if (req.permissoesUsuario.includes('aprovar-alteracao-financeira')) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_contas_bancarias',
                dadosEstorno.id_conta_bancaria,
                req.empresaId,
                { nome: 'Conta bancária' }
            );

            const estornoQuery = `
                INSERT INTO fc_lancamentos (
                    id_conta_bancaria, id_categoria, tipo, valor,
                    data_transacao, descricao, id_contato,
                    id_usuario_lancamento, id_estorno_de, empresa_id
                )
                VALUES ($1, $2, 'RECEITA', $3, $4, $5, $6, $7, $8, $9)
                RETURNING *;
            `;
            const descricaoEstorno = `Estorno do lançamento #${idLancamentoOriginal}: ${lancamentoOriginal.descricao}`;
            const estornoResult = await dbClient.query(estornoQuery, [
                dadosEstorno.id_conta_bancaria,
                lancamentoOriginal.id_categoria,
                dadosEstorno.valor_estornado,
                dadosEstorno.data_transacao,
                descricaoEstorno,
                lancamentoOriginal.id_contato,
                req.usuarioLogado.id,
                idLancamentoOriginal,
                req.empresaId,
            ]);
            
            await dbClient.query(
                `UPDATE fc_lancamentos
                    SET status_edicao = 'ESTORNADO'
                  WHERE id = $1
                    AND empresa_id = $2`,
                [idLancamentoOriginal, req.empresaId]
            );
            
            await registrarLog(
                dbClient,
                req.usuarioLogado.id,
                req.usuarioLogado.nome,
                'REGISTRO_ESTORNO',
                {
                    lancamento_original: lancamentoOriginal,
                    lancamento_estorno: estornoResult.rows[0],
                },
                req.empresaId
            );
            
            await dbClient.query('COMMIT');
            return res.status(201).json({ message: 'Estorno registrado com sucesso!' });
        } 
        // FLUXO DO USUÁRIO COMUM: Cria uma solicitação
        else {

            const solRes = await dbClient.query(
                `INSERT INTO fc_solicitacoes_alteracao (
                    id_lancamento, tipo_solicitacao, dados_antigos,
                    dados_novos, id_usuario_solicitante, empresa_id
                )
                VALUES ($1, 'ESTORNO', $2, $3, $4, $5)
                RETURNING *;`,
                [
                    idLancamentoOriginal, 
                    JSON.stringify(lancamentoOriginal),
                    JSON.stringify(dadosEstorno),
                    req.usuarioLogado.id,
                    req.empresaId
                ]
            );

            // Muda o status para indicar que há uma ação pendente
            await dbClient.query(
                `UPDATE fc_lancamentos
                    SET status_edicao = 'PENDENTE_APROVACAO'
                  WHERE id = $1
                    AND empresa_id = $2`,
                [idLancamentoOriginal, req.empresaId]
            );

            await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'SOLICITACAO_ESTORNO', {
                id_lancamento: idLancamentoOriginal,
                valor_estornado: dadosEstorno.valor_estornado,
                dados_estorno: dadosEstorno,
                solicitacao: solRes.rows[0],
            }, req.empresaId);
            
            await dbClient.query('COMMIT');
            return res.status(202).json({ message: 'Solicitação de estorno enviada para aprovação.' });
        }

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error(`[API /lancamentos/${idLancamentoOriginal}/estornar] Erro:`, error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao processar o estorno.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// NOVA ROTA PARA REVERTER UM ESTORNO
router.post('/lancamentos/:id/reverter-estorno', async (req, res) => {
    if (!req.permissoesUsuario.includes('estornar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada para solicitar reversão.' });
    }

    const { id: idLancamentoEstorno } = req.params;

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const lancamentoEstorno = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_lancamentos',
            idLancamentoEstorno,
            req.empresaId,
            { nome: 'Lançamento de estorno', forUpdate: true }
        );
        if (lancamentoEstorno.excluido_em) {
            throw erroFinanceiro(404, 'Lançamento de estorno não encontrado.');
        }
        if (!lancamentoEstorno.id_estorno_de) throw new Error('Este lançamento não é um estorno.');

        if (lancamentoEstorno.status_edicao !== 'OK' && lancamentoEstorno.status_edicao !== 'EDITADO_APROVADO' && lancamentoEstorno.status_edicao !== 'EDICAO_REJEITADA') {
            await dbClient.query('ROLLBACK');
            return res.status(409).json({ error: `Este lançamento já possui uma ação pendente (${lancamentoEstorno.status_edicao}) e não pode ser alterado.` });
        }
        
        // FLUXO DO ADMIN: Executa diretamente
        if (req.permissoesUsuario.includes('aprovar-alteracao-financeira')) {
            
            // Soft delete do lançamento de estorno (não apaga a linha)
            await softDeleteLancamento(
                dbClient,
                idLancamentoEstorno,
                req.usuarioLogado.id,
                req.empresaId,
                { cascade: false }
            );
            await dbClient.query(
                `UPDATE fc_lancamentos
                    SET status_edicao = 'OK'
                  WHERE id = $1
                    AND empresa_id = $2
                    AND excluido_em IS NULL`,
                [lancamentoEstorno.id_estorno_de, req.empresaId]
            );

            await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'REVERSAO_ESTORNO', {
                lancamento_estorno: lancamentoEstorno,
                lancamento_original_id: lancamentoEstorno.id_estorno_de,
            }, req.empresaId);
            
            await dbClient.query('COMMIT');
            return res.status(200).json({ message: 'Estorno revertido com sucesso.' });
        }
        // FLUXO DO USUÁRIO COMUM: Cria uma solicitação
        else {
            // Aqui, o 'id_lancamento' na solicitação é o ID do ESTORNO (que queremos apagar)
            const solRes = await dbClient.query(
                `INSERT INTO fc_solicitacoes_alteracao (
                    id_lancamento, tipo_solicitacao, dados_antigos,
                    id_usuario_solicitante, empresa_id
                )
                VALUES ($1, 'REVERSAO_ESTORNO', $2, $3, $4)
                RETURNING *;`,
                [
                    idLancamentoEstorno,
                    lancamentoEstorno,
                    req.usuarioLogado.id,
                    req.empresaId,
                ]
            );

            await dbClient.query(
                `UPDATE fc_lancamentos
                    SET status_edicao = 'PENDENTE_APROVACAO'
                  WHERE id = $1
                    AND empresa_id = $2`,
                [idLancamentoEstorno, req.empresaId]
            );

            await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'SOLICITACAO_REVERSAO_ESTORNO', {
                id_lancamento: idLancamentoEstorno,
                solicitacao: solRes.rows[0],
            }, req.empresaId);
            
            await dbClient.query('COMMIT');
            return res.status(202).json({ message: 'Solicitação de reversão de estorno enviada para aprovação.' });
        }
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error(`[API /reverter-estorno] Erro:`, error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao reverter o estorno.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});


router.post('/lancamentos/detalhado', async (req, res) => {
    if (!req.permissoesUsuario.includes('lancar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }

    const { dados_pai, itens_filho, tipo_rateio } = req.body;

    if (!dados_pai || !Array.isArray(itens_filho) || itens_filho.length === 0) {
        return res.status(400).json({ error: 'Estrutura de dados inválida.' });
    }
    
    let valor_total_lancamento;
    const { valor_desconto = 0 } = dados_pai; // Pega o desconto, se houver

    // Lógica de cálculo do valor total agora depende do tipo_rateio
    if (tipo_rateio === 'COMPRA') {
        const soma_itens = itens_filho.reduce((acc, item) => {
            if (!item.quantidade || !item.valor_unitario) {
                // Mantém a validação para Compra Detalhada
                throw new Error('Cada item de uma Compra Detalhada deve ter quantidade e valor unitário.');
            }
            const valor_total_item = parseFloat(item.quantidade) * parseFloat(item.valor_unitario);
            return acc + valor_total_item;
        }, 0);
        valor_total_lancamento = soma_itens - parseFloat(valor_desconto);
    } else { // Para 'DETALHADO' e outros tipos
        valor_total_lancamento = itens_filho.reduce((acc, item) => {
            if (!item.valor_item) {
                // Nova validação específica para Rateio
                throw new Error('Cada item de um Rateio Detalhado deve ter um valor_item.');
            }
            return acc + parseFloat(item.valor_item);
        }, 0);
    }

    if (valor_total_lancamento < 0) {
        return res.status(400).json({ error: 'O valor total do lançamento (após desconto) não pode ser negativo.' });
    }

    const { id_conta_bancaria, data_transacao, id_contato, id_categoria, descricao } = dados_pai;
    if (!id_conta_bancaria || !data_transacao) {
        return res.status(400).json({ error: 'Conta bancária e data são obrigatórios.' });
    }
    if (tipo_rateio === 'COMPRA' && !id_contato) {
         return res.status(400).json({ error: 'Para compra detalhada, o fornecedor é obrigatório.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        await exigirRecursoDaEmpresa(
            dbClient,
            'fc_contas_bancarias',
            id_conta_bancaria,
            req.empresaId,
            { nome: 'Conta bancária' }
        );
        if (id_contato) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_contatos',
                id_contato,
                req.empresaId,
                { nome: 'Favorecido' }
            );
        }
        if (tipo_rateio !== 'COMPRA' && id_categoria) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_categorias',
                id_categoria,
                req.empresaId,
                { nome: 'Categoria' }
            );
        }
        for (const item of itens_filho) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_categorias',
                item.id_categoria,
                req.empresaId,
                { nome: 'Categoria do item' }
            );
            if (item.id_contato_item) {
                await exigirRecursoDaEmpresa(
                    dbClient,
                    'fc_contatos',
                    item.id_contato_item,
                    req.empresaId,
                    { nome: 'Favorecido do item' }
                );
            }
        }

        const lancamentoPaiQuery = `
            INSERT INTO fc_lancamentos 
                (id_conta_bancaria, tipo, valor, valor_desconto, data_transacao,
                 descricao, id_contato, id_categoria, id_usuario_lancamento,
                 tipo_rateio, empresa_id)
            VALUES ($1, 'DESPESA', $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id;
        `;
        const lancamentoPaiResult = await dbClient.query(lancamentoPaiQuery, [
            id_conta_bancaria, 
            valor_total_lancamento,
            valor_desconto,
            data_transacao, 
            descricao, 
            id_contato, 
            tipo_rateio === 'COMPRA' ? null : id_categoria,
            req.usuarioLogado.id, 
            tipo_rateio || null,
            req.empresaId
        ]);
        const novoLancamentoId = lancamentoPaiResult.rows[0].id;

        // A lógica de inserção dos filhos também precisa ser diferenciada
        for (const item of itens_filho) {
            if (tipo_rateio === 'COMPRA') {
                const valor_total_item = parseFloat(item.quantidade) * parseFloat(item.valor_unitario);
                await dbClient.query(
                    `INSERT INTO fc_lancamento_itens (
                        id_lancamento_pai, id_categoria, descricao_item,
                        quantidade, valor_unitario, valor_total_item,
                        id_contato_item, empresa_id
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
                    [
                        novoLancamentoId,
                        item.id_categoria,
                        item.descricao_item,
                        item.quantidade,
                        item.valor_unitario,
                        valor_total_item,
                        item.id_contato_item || null,
                        req.empresaId,
                    ]
                );
            } else { // Para 'DETALHADO'
                 await dbClient.query(
                    `INSERT INTO fc_lancamento_itens (
                        id_lancamento_pai, id_categoria, descricao_item,
                        valor_total_item, id_contato_item, empresa_id
                    )
                    VALUES ($1, $2, $3, $4, $5, $6);`,
                    [
                        novoLancamentoId,
                        item.id_categoria,
                        item.descricao_item,
                        item.valor_item,
                        item.id_contato_item || null,
                        req.empresaId,
                    ]
                );
            }
        }
        
        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'CRIACAO_LANCAMENTO_DETALHADO',
            { 
                depois: { // O objeto 'depois' contém os dados da nova entidade
                    id: novoLancamentoId, 
                    descricao: descricao, 
                    valor: valor_total_lancamento, 
                    itens: itens_filho, // Passamos os itens para o log também
                    tipo_rateio: tipo_rateio 
                } 
            },
            req.empresaId
        );

        await dbClient.query('COMMIT');
        res.status(201).json({ message: `Lançamento detalhado #${novoLancamentoId} com ${itens_filho.length} itens registrado com sucesso.` });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error("[API POST /lancamentos/detalhado] Erro:", error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode
                ? error.message
                : 'Erro ao registrar lançamento detalhado.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PUT /api/financeiro/lancamentos/detalhado/:id - ATUALIZAR UM LANÇAMENTO DETALHADO
router.put('/lancamentos/detalhado/:id', async (req, res) => {
    if (!req.permissoesUsuario.includes('editar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }

    const { id: idLancamentoPai } = req.params;
    const { dados_pai, itens_filho, tipo_rateio, justificativa } = req.body;

    if (!idLancamentoPai || !dados_pai || !Array.isArray(itens_filho) || itens_filho.length === 0) {
        return res.status(400).json({ error: 'Estrutura de dados inválida para atualização.' });
    }
    
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        // Lógica para checar se já existe uma solicitação pendente
        const lancamentoOriginal = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_lancamentos',
            idLancamentoPai,
            req.empresaId,
            { nome: 'Lançamento', forUpdate: true }
        );
        if (lancamentoOriginal.excluido_em) {
            throw erroFinanceiro(404, 'Lançamento não encontrado.');
        }

         // Precisa também dos itens originais para o log "antes"
        const itensOriginaisRes = await dbClient.query(
            `SELECT *
               FROM fc_lancamento_itens
              WHERE id_lancamento_pai = $1
                AND empresa_id = $2`,
            [idLancamentoPai, req.empresaId]
        );
        const dadosAntigosCompletos = { ...lancamentoOriginal, itens: itensOriginaisRes.rows };


        if (['PENDENTE_APROVACAO', 'PENDENTE_EXCLUSAO'].includes(lancamentoOriginal.status_edicao)) {
             await dbClient.query('ROLLBACK');
             return res.status(409).json({ error: 'Este lançamento já possui uma solicitação pendente.' });
        }
        
        // Se o usuário for ADMIN, edita diretamente
        if (req.permissoesUsuario.includes('aprovar-alteracao-financeira')) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_contas_bancarias',
                dados_pai.id_conta_bancaria,
                req.empresaId,
                { nome: 'Conta bancária' }
            );
            if (dados_pai.id_contato) {
                await exigirRecursoDaEmpresa(
                    dbClient,
                    'fc_contatos',
                    dados_pai.id_contato,
                    req.empresaId,
                    { nome: 'Favorecido' }
                );
            }
            if (tipo_rateio !== 'COMPRA' && dados_pai.id_categoria) {
                await exigirRecursoDaEmpresa(
                    dbClient,
                    'fc_categorias',
                    dados_pai.id_categoria,
                    req.empresaId,
                    { nome: 'Categoria' }
                );
            }
            for (const item of itens_filho) {
                await exigirRecursoDaEmpresa(
                    dbClient,
                    'fc_categorias',
                    item.id_categoria,
                    req.empresaId,
                    { nome: 'Categoria do item' }
                );
                if (item.id_contato_item) {
                    await exigirRecursoDaEmpresa(
                        dbClient,
                        'fc_contatos',
                        item.id_contato_item,
                        req.empresaId,
                        { nome: 'Favorecido do item' }
                    );
                }
            }

            await dbClient.query(
                `DELETE FROM fc_lancamento_itens
                  WHERE id_lancamento_pai = $1
                    AND empresa_id = $2`,
                [idLancamentoPai, req.empresaId]
            );

            if (tipo_rateio === 'COMPRA') {
                const soma_itens = itens_filho.reduce((acc, item) => (acc + (parseFloat(item.quantidade) * parseFloat(item.valor_unitario))), 0);
                const valor_total_lancamento = soma_itens - parseFloat(dados_pai.valor_desconto || 0);

                await dbClient.query(
                    `UPDATE fc_lancamentos 
                     SET id_conta_bancaria=$1, valor=$2, valor_desconto=$3, data_transacao=$4, descricao=$5, id_contato=$6, id_categoria=$7, tipo_rateio=$8, 
                         status_edicao='OK', id_usuario_edicao = $9, atualizado_em = NOW() 
                     WHERE id=$10
                       AND empresa_id=$11;`,
                    [dados_pai.id_conta_bancaria, valor_total_lancamento, dados_pai.valor_desconto || 0, dados_pai.data_transacao, dados_pai.descricao, dados_pai.id_contato, null, tipo_rateio, req.usuarioLogado.id, idLancamentoPai, req.empresaId]
                );
                for (const item of itens_filho) {
                    const valor_total_item = parseFloat(item.quantidade) * parseFloat(item.valor_unitario);
                    await dbClient.query(
                        `INSERT INTO fc_lancamento_itens (
                            id_lancamento_pai, id_categoria, descricao_item,
                            quantidade, valor_unitario, valor_total_item,
                            id_contato_item, empresa_id
                        )
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8);`,
                        [idLancamentoPai, item.id_categoria, item.descricao_item, item.quantidade, item.valor_unitario, valor_total_item, item.id_contato_item || null, req.empresaId]
                    );
                }
            } else if (tipo_rateio === 'DETALHADO') {
                const valor_total_lancamento = itens_filho.reduce((acc, item) => acc + parseFloat(item.valor_item || 0), 0);

                await dbClient.query(
                    `UPDATE fc_lancamentos 
                     SET id_conta_bancaria=$1, valor=$2, valor_desconto=$3, data_transacao=$4, descricao=$5, id_contato=$6, id_categoria=$7, tipo_rateio=$8, 
                         status_edicao='OK', id_usuario_edicao = $9, atualizado_em = NOW() 
                     WHERE id=$10
                       AND empresa_id=$11;`,
                    [dados_pai.id_conta_bancaria, valor_total_lancamento, 0, dados_pai.data_transacao, dados_pai.descricao, dados_pai.id_contato, dados_pai.id_categoria, tipo_rateio, req.usuarioLogado.id, idLancamentoPai, req.empresaId]
                );
                for (const item of itens_filho) {
                    await dbClient.query(
                        `INSERT INTO fc_lancamento_itens (
                            id_lancamento_pai, id_categoria, descricao_item,
                            valor_total_item, id_contato_item, empresa_id
                        )
                        VALUES ($1,$2,$3,$4,$5,$6);`,
                        [idLancamentoPai, item.id_categoria, item.descricao_item, item.valor_item, item.id_contato_item || null, req.empresaId]
                    );
                }
            }
            
             const lancamentoAtualizadoRes = await dbClient.query(
                `SELECT * FROM fc_lancamentos WHERE id = $1 AND empresa_id = $2`,
                [idLancamentoPai, req.empresaId]
            );
            const itensAtualizadosRes = await dbClient.query(
                `SELECT *
                   FROM fc_lancamento_itens
                  WHERE id_lancamento_pai = $1
                    AND empresa_id = $2`,
                [idLancamentoPai, req.empresaId]
            );
            const dadosDepoisCompletos = { ...lancamentoAtualizadoRes.rows[0], itens: itensAtualizadosRes.rows };

            await registrarLog(
                dbClient,
                req.usuarioLogado.id,
                req.usuarioLogado.nome,
                'EDICAO_LANCAMENTO', 
                { antes: dadosAntigosCompletos, depois: dadosDepoisCompletos },
                req.empresaId
            );

            await dbClient.query('COMMIT');
            return res.status(200).json({ message: 'Lançamento detalhado atualizado com sucesso.' });
        } else {
            // Se for usuário comum, cria uma solicitação (lógica que você já tinha)
            if (!justificativa) return res.status(400).json({ error: 'A justificativa é obrigatória.' });
    
            // O seu código que busca os itens originais e monta o dadosAntigosCompletos está perfeito.
            const solRes = await dbClient.query(
                `INSERT INTO fc_solicitacoes_alteracao (
                    id_lancamento, tipo_solicitacao, dados_antigos, dados_novos,
                    id_usuario_solicitante, justificativa_solicitante, empresa_id
                )
                VALUES ($1, 'EDICAO', $2, $3, $4, $5, $6)
                RETURNING *;`,
                [
                    idLancamentoPai,
                    dadosAntigosCompletos,
                    req.body,
                    req.usuarioLogado.id,
                    justificativa,
                    req.empresaId,
                ]
            );
            
            await dbClient.query(
                `UPDATE fc_lancamentos
                    SET status_edicao = 'PENDENTE_APROVACAO', motivo_rejeicao = NULL
                  WHERE id = $1
                    AND empresa_id = $2`,
                [idLancamentoPai, req.empresaId]
            );
            
            await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'SOLICITACAO_EDICAO', {
                id_lancamento: idLancamentoPai,
                justificativa: justificativa,
                solicitacao: solRes.rows[0]
            }, req.empresaId);

            await dbClient.query('COMMIT');
            return res.status(202).json({ message: 'Solicitação de edição enviada para aprovação.' });
        }
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error(`[API PUT /lancamentos/detalhado/${idLancamentoPai}] Erro:`, error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode
                ? error.message
                : 'Erro ao processar a atualização do lançamento detalhado.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/financeiro/contas-agendadas - Listar contas
router.get('/contas-agendadas', async (req, res) => {
    if (!req.permissoesUsuario.includes('visualizar-financeiro')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    
    const { status = 'PENDENTE', limit = 15, page = 1, vencimento } = req.query; 
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let dbClient;

    try {
        dbClient = await pool.connect();

        let whereClauses = ["ca.status = $1", "ca.empresa_id = $2"];
        const queryParams = [status, req.empresaId];
        let paramIndex = 3;

        if (vencimento === 'atrasadas') {
            whereClauses.push("ca.data_vencimento < CURRENT_DATE");
        } else if (vencimento === 'hoje') {
            whereClauses.push("ca.data_vencimento = CURRENT_DATE");
        }
        const whereString = whereClauses.join(' AND ');

        // 1. Busca TODAS as contas pendentes, sem paginação no SQL. A ordenação é importante!
        const queryTodosPendentes = `
            SELECT 
                ca.*, 
                cat.nome as nome_categoria, 
                c.nome as nome_favorecido,
                u_agenda.nome as nome_usuario_agendamento,
                u_edicao.nome as nome_usuario_edicao,
                (
                    SELECT json_agg(json_build_object(
                        'id', i.id, 'id_categoria', i.id_categoria, 'nome_categoria', cat_item.nome,
                        'id_contato_item', i.id_contato_item, 'nome_contato_item', contato_item.nome,
                        'descricao_item', i.descricao_item, 'valor_item', i.valor_item
                    ))
                    FROM fc_contas_agendadas_itens i
                    LEFT JOIN fc_categorias cat_item
                      ON i.id_categoria = cat_item.id
                     AND i.empresa_id = cat_item.empresa_id
                    LEFT JOIN fc_contatos contato_item
                      ON i.id_contato_item = contato_item.id
                     AND i.empresa_id = contato_item.empresa_id
                    WHERE i.id_conta_agendada_pai = ca.id
                      AND i.empresa_id = ca.empresa_id
                ) as itens
            FROM fc_contas_agendadas ca
            LEFT JOIN fc_categorias cat
              ON ca.id_categoria = cat.id
             AND ca.empresa_id = cat.empresa_id
            LEFT JOIN fc_contatos c
              ON ca.id_contato = c.id
             AND ca.empresa_id = c.empresa_id
            LEFT JOIN usuarios u_agenda ON ca.id_usuario_agendamento = u_agenda.id
            LEFT JOIN usuarios u_edicao ON ca.id_usuario_ultima_edicao = u_edicao.id
            WHERE ${whereString}
            ORDER BY ca.data_vencimento ASC, ca.id_lote;
        `;
        const todosResult = await dbClient.query(queryTodosPendentes, queryParams);

        // 2. Agrupa os resultados em JavaScript (RESOLVE O BUG DOS LOTES)
        const contasAgrupadas = todosResult.rows.reduce((acc, conta) => {
            const chave = conta.id_lote || `avulso_${conta.id}`;
            if (!acc[chave]) {
                acc[chave] = [];
            }
            acc[chave].push(conta);
            return acc;
        }, {});
        
        // Converte o objeto de grupos em um array
        const listaDeGrupos = Object.values(contasAgrupadas);

        // 3. Pagina o ARRAY de grupos em JavaScript
        const totalGrupos = listaDeGrupos.length;
        const gruposPaginados = listaDeGrupos.slice(offset, offset + parseInt(limit));
        
        // 4. Envia a resposta paginada
        res.status(200).json({
            // A resposta agora é um array de grupos (que são arrays de contas)
            contasAgendadas: gruposPaginados, 
            total: totalGrupos, // O total é de grupos, não de contas individuais
            page: parseInt(page),
            pages: Math.ceil(totalGrupos / limit) || 1
        });

    } catch (error) {
        console.error("[API GET /contas-agendadas] Erro:", error);
        res.status(500).json({ error: 'Erro ao buscar contas agendadas.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/financeiro/contas-agendadas - Agendar nova conta
router.post('/contas-agendadas', async (req, res) => {
    if (!req.permissoesUsuario.includes('lancar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada para agendar contas.' });
    }
    const { id_categoria, id_contato, tipo, descricao, valor, data_vencimento } = req.body;
    if (!id_categoria || !tipo || !descricao || !valor || !data_vencimento) {
        return res.status(400).json({ error: 'Campos obrigatórios estão faltando.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await exigirRecursoDaEmpresa(
            dbClient,
            'fc_categorias',
            id_categoria,
            req.empresaId,
            { nome: 'Categoria' }
        );
        if (id_contato) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_contatos',
                id_contato,
                req.empresaId,
                { nome: 'Favorecido' }
            );
        }
        const query = `
            INSERT INTO fc_contas_agendadas (
                id_categoria, id_contato, tipo, descricao, valor,
                data_vencimento, id_usuario_agendamento, empresa_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *;
        `;
        const result = await dbClient.query(query, [
            id_categoria, id_contato || null, tipo, descricao, valor,
            data_vencimento, req.usuarioLogado.id, req.empresaId
        ]);
        const novoAgendamento = result.rows[0];
        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'CRIACAO_AGENDAMENTO',
            { depois: novoAgendamento },
            req.empresaId
        );

        res.status(201).json(novoAgendamento);
    } catch (error) {
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao agendar conta.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PUT /api/financeiro/contas-agendadas/:id - EDITAR um agendamento PENDENTE
router.put('/contas-agendadas/:id', async (req, res) => {
    if (!req.permissoesUsuario.includes('lancar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada para editar agendamentos.' });
    }
    const { id } = req.params;
    const { id_categoria, id_contato, tipo, descricao, valor, data_vencimento } = req.body;
    if (!id_categoria || !tipo || !descricao || !valor || !data_vencimento) {
        return res.status(400).json({ error: 'Campos obrigatórios estão faltando.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const agendamentoOriginal = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_contas_agendadas',
            id,
            req.empresaId,
            { nome: 'Agendamento', forUpdate: true }
        );
        if (agendamentoOriginal.status !== 'PENDENTE') {
            throw erroFinanceiro(404, 'Agendamento não encontrado ou já foi baixado.');
        }
        await exigirRecursoDaEmpresa(
            dbClient,
            'fc_categorias',
            id_categoria,
            req.empresaId,
            { nome: 'Categoria' }
        );
        if (id_contato) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_contatos',
                id_contato,
                req.empresaId,
                { nome: 'Favorecido' }
            );
        }

        const query = `
            UPDATE fc_contas_agendadas 
            SET id_categoria = $1, id_contato = $2, tipo = $3, descricao = $4, valor = $5, data_vencimento = $6, id_usuario_ultima_edicao = $7, atualizado_em = NOW()
            WHERE id = $8
              AND empresa_id = $9
            RETURNING *;
        `;
        const result = await dbClient.query(query, [
            id_categoria, id_contato || null, tipo, descricao, valor,
            data_vencimento, req.usuarioLogado.id, id, req.empresaId
        ]);
        const agendamentoAtualizado = result.rows[0];

        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'EDICAO_AGENDAMENTO',
            { antes: agendamentoOriginal, depois: agendamentoAtualizado },
            req.empresaId
        );

        await dbClient.query('COMMIT');
        res.status(200).json(agendamentoAtualizado);
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error(`[API PUT /contas-agendadas/${id}] Erro:`, error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao atualizar agendamento.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/financeiro/contas-agendadas/:id/baixar - Dar baixa (pagar/receber)
router.post('/contas-agendadas/:id/baixar', async (req, res) => {
    if (!req.permissoesUsuario.includes('aprovar-pagamento')) {
        return res.status(403).json({ error: 'Permissão negada para dar baixa em contas.' });
    }

    const { id } = req.params;
    const { id_conta_bancaria, data_transacao } = req.body;
    if (!id_conta_bancaria || !data_transacao) {
        return res.status(400).json({ error: 'É necessário informar a conta bancária e a data do pagamento/recebimento.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN'); // INICIA A TRANSAÇÃO

        // 1. Busca a conta agendada e bloqueia a linha para evitar dupla baixa (FOR UPDATE)
        const contaAgendada = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_contas_agendadas',
            id,
            req.empresaId,
            { nome: 'Conta agendada', forUpdate: true }
        );
        if (contaAgendada.status !== 'PENDENTE') throw new Error(`Esta conta já possui o status "${contaAgendada.status}".`);
        await exigirRecursoDaEmpresa(
            dbClient,
            'fc_contas_bancarias',
            id_conta_bancaria,
            req.empresaId,
            { nome: 'Conta bancária' }
        );

        // 2. Cria o lançamento real na tabela fc_lancamentos
        const tipoLancamento = contaAgendada.tipo === 'A_PAGAR' ? 'DESPESA' : 'RECEITA';
        const lancamentoQuery = `
            INSERT INTO fc_lancamentos (
                id_conta_bancaria, id_categoria, tipo, valor, data_transacao,
                descricao, id_contato, id_usuario_lancamento, empresa_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id;
        `;
        const lancamentoRes = await dbClient.query(lancamentoQuery, [
            id_conta_bancaria,
            contaAgendada.id_categoria,
            tipoLancamento,
            contaAgendada.valor,
            data_transacao,
            `Baixa da conta agendada #${id}: ${contaAgendada.descricao}`,
            contaAgendada.id_contato,
            req.usuarioLogado.id,
            req.empresaId
        ]);
        const novoLancamentoId = lancamentoRes.rows[0].id;

        // 3. Atualiza a conta agendada com o status "PAGO" e o ID do lançamento
        const updateQuery = `
            UPDATE fc_contas_agendadas
               SET status = $1,
                   id_lancamento_efetivado = $2,
                   atualizado_em = NOW()
             WHERE id = $3
               AND empresa_id = $4
        `;
        await dbClient.query(
            updateQuery,
            ['PAGO', novoLancamentoId, id, req.empresaId]
        );

        await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'BAIXA_AGENDAMENTO', {
            agendamento: contaAgendada,
            lancamentoGeradoId: novoLancamentoId
        }, req.empresaId);

        await dbClient.query('COMMIT'); // FINALIZA A TRANSAÇÃO
        res.status(200).json({ message: 'Baixa da conta realizada com sucesso!' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK'); // DESFAZ TUDO EM CASO DE ERRO
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao dar baixa na conta.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/financeiro/contas-agendadas/lote - Cria múltiplas parcelas
router.post('/contas-agendadas/lote', async (req, res) => {
    if (!req.permissoesUsuario.includes('lancar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada para agendar contas.' });
    }

    const { descricao_lote, valor_total, parcelas } = req.body;
    if (!descricao_lote || !valor_total || !Array.isArray(parcelas) || parcelas.length === 0) {
        return res.status(400).json({ error: 'Dados inválidos para agendamento em lote.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN'); // INICIA A TRANSAÇÃO

        // 1. Cria o registro do Lote principal
        const loteQuery = `
            INSERT INTO fc_lotes_agendamento (
                descricao_lote, valor_total, id_usuario_criacao, empresa_id
            )
            VALUES ($1, $2, $3, $4)
            RETURNING id;
        `;
        const loteResult = await dbClient.query(
            loteQuery,
            [descricao_lote, valor_total, req.usuarioLogado.id, req.empresaId]
        );
        const novoLoteId = loteResult.rows[0].id;

        // 2. Itera sobre cada parcela e a insere no banco, vinculando ao Lote
        for (const parcela of parcelas) {
            const { id_categoria, id_contato, tipo, descricao, valor, data_vencimento } = parcela;
        if (!id_categoria || !tipo || !descricao || !valor || !data_vencimento) {
            throw new Error(`Dados incompletos para uma das parcelas: ${descricao}`);
        }
        await exigirRecursoDaEmpresa(
            dbClient,
            'fc_categorias',
            id_categoria,
            req.empresaId,
            { nome: 'Categoria da parcela' }
        );
        if (id_contato) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_contatos',
                id_contato,
                req.empresaId,
                { nome: 'Favorecido da parcela' }
            );
        }
        const parcelaQuery = `
            INSERT INTO fc_contas_agendadas 
                (id_lote, id_categoria, id_contato, tipo, descricao, valor,
                 data_vencimento, id_usuario_agendamento, empresa_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
        `;
        await dbClient.query(parcelaQuery, [
            novoLoteId, id_categoria, id_contato || null, tipo, descricao,
            valor, data_vencimento, req.usuarioLogado.id, req.empresaId
        ]);
        }
        
        // 3. Registra um único log de auditoria para a criação do lote
        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'CRIACAO_LOTE_AGENDAMENTO',
            { depois: { id: novoLoteId, descricao_lote: descricao_lote, parcelas: parcelas.length, valor_total: valor_total } },
            req.empresaId
        );

        await dbClient.query('COMMIT'); // FINALIZA A TRANSAÇÃO
        res.status(201).json({ message: `${parcelas.length} parcelas agendadas com sucesso no lote #${novoLoteId}.` });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK'); // DESFAZ TUDO EM CASO DE ERRO
        console.error("[API POST /contas-agendadas/lote] Erro:", error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao agendar parcelas.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/financeiro/contas-agendadas/detalhado - Agendar lançamento detalhado
router.post('/contas-agendadas/detalhado', async (req, res) => {
    if (!req.permissoesUsuario.includes('lancar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada para agendar contas.' });
    }

    const { dados_pai, itens_filho, tipo_rateio } = req.body;

    if (!dados_pai || !Array.isArray(itens_filho) || itens_filho.length === 0) {
        return res.status(400).json({ error: 'Estrutura de dados inválida.' });
    }

    const valor_total_calculado = itens_filho.reduce((acc, item) => acc + parseFloat(item.valor_item || 0), 0);
    const { data_vencimento, id_contato, id_categoria, descricao, tipo } = dados_pai;

    if (!data_vencimento || !tipo || valor_total_calculado <= 0) {
        return res.status(400).json({ error: 'Dados do agendamento principal são obrigatórios.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        if (tipo_rateio !== 'COMPRA' && id_categoria) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_categorias',
                id_categoria,
                req.empresaId,
                { nome: 'Categoria' }
            );
        }
        if (id_contato) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_contatos',
                id_contato,
                req.empresaId,
                { nome: 'Favorecido' }
            );
        }
        for (const item of itens_filho) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_categorias',
                item.id_categoria,
                req.empresaId,
                { nome: 'Categoria do item' }
            );
            if (item.id_contato_item) {
                await exigirRecursoDaEmpresa(
                    dbClient,
                    'fc_contatos',
                    item.id_contato_item,
                    req.empresaId,
                    { nome: 'Favorecido do item' }
                );
            }
        }

        // 1. Cria o agendamento "pai"
        const paiQuery = `
            INSERT INTO fc_contas_agendadas 
                (tipo, descricao, valor, data_vencimento, id_categoria,
                 id_contato, id_usuario_agendamento, tipo_rateio, empresa_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id;
        `;
        const paiResult = await dbClient.query(paiQuery, [
            tipo, descricao, valor_total_calculado, data_vencimento, 
            tipo_rateio === 'COMPRA' ? null : id_categoria, 
            id_contato, req.usuarioLogado.id, tipo_rateio, req.empresaId
        ]);
        const novoPaiId = paiResult.rows[0].id;

        // 2. Insere os itens "filho"
        for (const item of itens_filho) {
            const itemQuery = `
                INSERT INTO fc_contas_agendadas_itens 
                    (id_conta_agendada_pai, id_categoria, id_contato_item,
                     descricao_item, valor_item, empresa_id)
                VALUES ($1, $2, $3, $4, $5, $6);
            `;
            await dbClient.query(itemQuery, [
                novoPaiId, item.id_categoria, item.id_contato_item || null,
                item.descricao_item, item.valor_item, req.empresaId
            ]);
        }

        // Buscam o agendamento pai que acabamos de criar para ter todos os dados
        const novoAgendamentoRes = await dbClient.query(
            `SELECT *
               FROM fc_contas_agendadas
              WHERE id = $1
                AND empresa_id = $2`,
            [novoPaiId, req.empresaId]
        );

        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'CRIACAO_AGENDAMENTO',
            { depois: novoAgendamentoRes.rows[0] },
            req.empresaId
        );

        await dbClient.query('COMMIT');
        res.status(201).json({ message: `Agendamento detalhado #${novoPaiId} criado com sucesso.` });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error("[API POST /contas-agendadas/detalhado] Erro:", error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode
                ? error.message
                : 'Erro ao criar agendamento detalhado.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// DELETE /api/financeiro/contas-agendadas/:id - Excluir um agendamento
router.delete('/contas-agendadas/:id', async (req, res) => {
    if (!req.permissoesUsuario.includes('lancar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada para excluir agendamentos.' });
    }
    const { id } = req.params;
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN'); 

        // 1. Busque o que será deletado
        const agendamentoRes = await dbClient.query(
            `SELECT *
               FROM fc_contas_agendadas
              WHERE id = $1
                AND empresa_id = $2
                AND status = 'PENDENTE'`,
            [id, req.empresaId]
        );
        
        if (agendamentoRes.rowCount === 0) {
            // Se não encontrou, não precisa fazer rollback, só retorna o erro
            return res.status(404).json({ error: 'Agendamento não encontrado ou já foi baixado.' });
        }
        const agendamentoExcluido = agendamentoRes.rows[0];

        // 2. Delete
        await dbClient.query(
            `DELETE FROM fc_contas_agendadas
              WHERE id = $1
                AND empresa_id = $2`,
            [id, req.empresaId]
        );
        
        // 3. REGISTRE O LOG
        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'EXCLUSAO_AGENDAMENTO',
            { antes: agendamentoExcluido },
            req.empresaId
        );

        await dbClient.query('COMMIT');
        res.status(200).json({ message: 'Agendamento excluído com sucesso.' });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error(`[API DELETE /contas-agendadas/${id}] Erro:`, error);
        res.status(500).json({ error: 'Erro ao excluir agendamento.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PUT /api/financeiro/contas-agendadas/detalhado/:id - Editar agendamento detalhado
router.put('/contas-agendadas/detalhado/:id', async (req, res) => {
    if (!req.permissoesUsuario.includes('lancar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    const { id: idPai } = req.params;
    const { dados_pai, itens_filho, tipo_rateio } = req.body;
    
    // Validações... (semelhante ao POST)
    const valor_total_calculado = itens_filho.reduce((acc, item) => acc + parseFloat(item.valor_item || 0), 0);
    const { data_vencimento, id_contato, id_categoria, descricao, tipo } = dados_pai;
    if (!data_vencimento || !tipo || valor_total_calculado <= 0) {
        return res.status(400).json({ error: 'Dados do agendamento principal são obrigatórios.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const antes = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_contas_agendadas',
            idPai,
            req.empresaId,
            { nome: 'Agendamento', forUpdate: true }
        );
        if (antes.status !== 'PENDENTE') {
            throw erroFinanceiro(404, 'Agendamento pendente não encontrado.');
        }
        if (tipo_rateio !== 'COMPRA' && id_categoria) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_categorias',
                id_categoria,
                req.empresaId,
                { nome: 'Categoria' }
            );
        }
        if (id_contato) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_contatos',
                id_contato,
                req.empresaId,
                { nome: 'Favorecido' }
            );
        }
        for (const item of itens_filho) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_categorias',
                item.id_categoria,
                req.empresaId,
                { nome: 'Categoria do item' }
            );
            if (item.id_contato_item) {
                await exigirRecursoDaEmpresa(
                    dbClient,
                    'fc_contatos',
                    item.id_contato_item,
                    req.empresaId,
                    { nome: 'Favorecido do item' }
                );
            }
        }

        // 1. Apaga os filhos antigos
        await dbClient.query(
            `DELETE FROM fc_contas_agendadas_itens
              WHERE id_conta_agendada_pai = $1
                AND empresa_id = $2`,
            [idPai, req.empresaId]
        );
        
        // 2. Atualiza o pai
        const paiQuery = `
            UPDATE fc_contas_agendadas
            SET tipo = $1, descricao = $2, valor = $3, data_vencimento = $4, id_categoria = $5, id_contato = $6, tipo_rateio = $7, atualizado_em = NOW()
            WHERE id = $8
              AND empresa_id = $9
              AND status = 'PENDENTE'
            RETURNING *;
        `;
        const depoisRes = await dbClient.query(paiQuery, [
            tipo, descricao, valor_total_calculado, data_vencimento,
            tipo_rateio === 'COMPRA' ? null : id_categoria,
            id_contato, tipo_rateio, idPai, req.empresaId
        ]);

        // 3. Reinsere os filhos
        for (const item of itens_filho) {
            const itemQuery = `
                INSERT INTO fc_contas_agendadas_itens 
                    (id_conta_agendada_pai, id_categoria, id_contato_item,
                     descricao_item, valor_item, empresa_id)
                VALUES ($1, $2, $3, $4, $5, $6);
            `;
            await dbClient.query(itemQuery, [
                idPai, item.id_categoria, item.id_contato_item || null,
                item.descricao_item, item.valor_item, req.empresaId
            ]);
        }

        await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'EDICAO_AGENDAMENTO', {
            antes,
            depois: depoisRes.rows[0],
        }, req.empresaId);

        await dbClient.query('COMMIT');
        res.status(200).json({ message: 'Agendamento detalhado atualizado com sucesso.' });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        res.status(error.statusCode || 500).json({
            error: error.statusCode
                ? error.message
                : 'Erro ao atualizar agendamento detalhado.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/financeiro/contas-agendadas/info/:id - Busca detalhes de um agendamento para confirmação
router.get('/contas-agendadas/info/:id', async (req, res) => {
    // Apenas usuários com a nova permissão podem usar esta ferramenta
    if (!req.permissoesUsuario.includes('permite-excluir-agendamentos')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    const { id } = req.params;
    let dbClient;
    try {
        dbClient = await pool.connect();
        // Query que busca o agendamento sem filtrar pelo status 'PENDENTE'
        const result = await dbClient.query(
            `SELECT id, descricao, valor, status, id_lancamento_efetivado
               FROM fc_contas_agendadas
              WHERE id = $1
                AND empresa_id = $2`,
            [id, req.empresaId]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Agendamento não encontrado com este ID.' });
        }
        
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error(`[API GET /contas-agendadas/info/${id}] Erro:`, error);
        res.status(500).json({ error: 'Erro ao buscar informações do agendamento.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// DELETE /api/financeiro/contas-agendadas/:id/force - Exclui permanentemente um agendamento
router.delete('/contas-agendadas/:id/force', async (req, res) => {
    if (!req.permissoesUsuario.includes('permite-excluir-agendamentos')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    const { id } = req.params;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const antesRes = await dbClient.query(
            `SELECT *
               FROM fc_contas_agendadas
              WHERE id = $1
                AND empresa_id = $2`,
            [id, req.empresaId]
        );
        if (antesRes.rowCount === 0) {
            return res.status(404).json({ error: 'Agendamento não encontrado com este ID.' });
        }
        // Deleta o agendamento-pai. O 'ON DELETE CASCADE' cuidará dos filhos.
        // Esta query NÃO verifica o status, permitindo apagar agendamentos já baixados.
        const result = await dbClient.query(
            `DELETE FROM fc_contas_agendadas
              WHERE id = $1
                AND empresa_id = $2`,
            [id, req.empresaId]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Agendamento não encontrado com este ID.' });
        }

        await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'EXCLUSAO_AGENDAMENTO_FORCADA', {
            antes: antesRes.rows[0],
        }, req.empresaId);
        
        res.status(200).json({ message: 'Agendamento excluído permanentemente com sucesso.' });
    } catch (error) {
        console.error(`[API DELETE /contas-agendadas/${id}/force] Erro:`, error);
        res.status(500).json({ error: 'Erro ao excluir agendamento permanentemente.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// PUT /api/financeiro/lotes/:id/descricao - Atualiza a descrição de um lote de agendamento
router.put('/lotes/:id/descricao', async (req, res) => {
    // Apenas usuários que podem lançar podem editar a descrição
    if (!req.permissoesUsuario.includes('lancar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    const { id: idLote } = req.params;
    const { nova_descricao_base } = req.body;

    if (!nova_descricao_base || nova_descricao_base.trim() === '') {
        return res.status(400).json({ error: 'A nova descrição não pode estar vazia.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        // 1. Busca todas as parcelas pendentes para reconstruir a descrição
        const parcelasRes = await dbClient.query(
            `SELECT id, descricao
               FROM fc_contas_agendadas
              WHERE id_lote = $1
                AND empresa_id = $2
                AND status = 'PENDENTE'
              ORDER BY data_vencimento ASC`,
            [idLote, req.empresaId]
        );
        if (parcelasRes.rowCount === 0) {
            throw new Error('Nenhuma parcela pendente encontrada para este lote.');
        }

        const descricaoAntes = parcelasRes.rows[0]?.descricao || null;

        // 2. Atualiza cada parcela com a nova descrição base + número da parcela
        const totalParcelas = parcelasRes.rowCount;
        for (let i = 0; i < totalParcelas; i++) {
            const parcela = parcelasRes.rows[i];
            const novaDescricaoCompleta = `${nova_descricao_base.trim()} - Parcela ${i + 1}/${totalParcelas}`;
            await dbClient.query(
                `UPDATE fc_contas_agendadas
                    SET descricao = $1
                  WHERE id = $2
                    AND empresa_id = $3`,
                [novaDescricaoCompleta, parcela.id, req.empresaId]
            );
        }

        await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'EDICAO_LOTE_DESCRICAO', {
            id_lote: idLote,
            nova_descricao_base: nova_descricao_base.trim(),
            descricao_antes: descricaoAntes,
            parcelas_atualizadas: totalParcelas,
        }, req.empresaId);

        await dbClient.query('COMMIT');
        res.status(200).json({ message: 'Descrição do lote atualizada com sucesso.' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error(`[API PUT /lotes/${idLote}/descricao] Erro:`, error);
        res.status(500).json({ error: 'Erro ao atualizar a descrição do lote.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

/**
 * Para solicitações de EXCLUSAO: detecta se o lançamento é baixa de Agenda
 * e carrega dados da parcela (batch).
 * @returns {Map<number, object>} chave = id do lançamento
 */
async function carregarContextoAgendaPorExclusoes(dbClient, exclusoes, empresaId) {
    /** @type {Map<number, object>} */
    const porLancamento = new Map();
    if (!exclusoes.length) return porLancamento;

    const lancToAgenda = new Map();
    for (const item of exclusoes) {
        const idLanc = Number(item.id_lancamento);
        if (!idLanc) continue;
        const desc =
            item.descricao_lancamento
            || item.lancamento_descricao_atual
            || item.dados_antigos?.descricao
            || '';
        const agendaId = parseAgendaIdFromDescricaoBaixa(desc);
        if (agendaId) lancToAgenda.set(idLanc, agendaId);
    }
    if (lancToAgenda.size === 0) return porLancamento;

    const uniqAgendaIds = [...new Set([...lancToAgenda.values()])];
    const agRes = await dbClient.query(
        `SELECT ca.id,
                ca.descricao,
                ca.status,
                ca.id_lancamento_efetivado,
                ca.data_vencimento,
                ca.valor,
                CASE
                  WHEN ca.id_lancamento_efetivado IS NOT NULL
                   AND EXISTS (
                     SELECT 1 FROM fc_lancamentos lx
                     WHERE lx.id = ca.id_lancamento_efetivado
                       AND lx.empresa_id = ca.empresa_id
                       AND lx.excluido_em IS NULL
                   )
                  THEN true
                  ELSE false
                END AS tem_baixa_ativa
         FROM fc_contas_agendadas ca
         WHERE ca.id = ANY($1::int[])
           AND ca.empresa_id = $2`,
        [uniqAgendaIds, empresaId]
    );
    const agendaById = new Map(agRes.rows.map((a) => [Number(a.id), a]));

    for (const [idLanc, agendaId] of lancToAgenda.entries()) {
        const ag = agendaById.get(Number(agendaId));
        if (!ag) {
            porLancamento.set(idLanc, {
                id_agenda: agendaId,
                descricao: '',
                status: 'DESCONHECIDO',
                id_efetivado: null,
                baixa_substituta_ativa: false,
                id_baixa_substituta: null,
                data_vencimento: null,
                valor: null,
            });
            continue;
        }
        const efetivadoId = ag.id_lancamento_efetivado != null ? Number(ag.id_lancamento_efetivado) : null;
        const temBaixaAtiva = Boolean(ag.tem_baixa_ativa);
        const eOutraBaixa = temBaixaAtiva && efetivadoId != null && efetivadoId !== Number(idLanc);
        porLancamento.set(idLanc, {
            id_agenda: Number(ag.id),
            descricao: ag.descricao || '',
            status: ag.status || '',
            id_efetivado: efetivadoId,
            baixa_substituta_ativa: eOutraBaixa,
            id_baixa_substituta: eOutraBaixa ? efetivadoId : null,
            data_vencimento: ag.data_vencimento || null,
            valor: ag.valor != null ? Number(ag.valor) : null,
        });
    }
    return porLancamento;
}

// GET /api/financeiro/aprovacoes-pendentes
router.get('/aprovacoes-pendentes', async (req, res) => {

    if (!req.permissoesUsuario || !req.permissoesUsuario.includes('aprovar-alteracao-financeira')) {
        console.error('[API GET /aprovacoes-pendentes] Falha de permissão. Usuário não tem "aprovar-alteracao-financeira".');
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    
    let dbClient;
    try {
        dbClient = await pool.connect();
        const query = `
            SELECT sa.*,
                   u.nome AS nome_solicitante,
                   l.descricao AS descricao_lancamento
            FROM fc_solicitacoes_alteracao sa
            JOIN usuarios u ON sa.id_usuario_solicitante = u.id
            LEFT JOIN fc_lancamentos l
              ON sa.id_lancamento = l.id
             AND sa.empresa_id = l.empresa_id
            WHERE sa.status = 'PENDENTE'
              AND sa.empresa_id = $1
            ORDER BY sa.data_solicitacao ASC;
        `;     
        const result = await dbClient.query(query, [req.empresaId]);

        const exclusoes = result.rows.filter((r) => r.tipo_solicitacao === 'EXCLUSAO' && r.id_lancamento);
        const agendaMap = await carregarContextoAgendaPorExclusoes(
            dbClient,
            exclusoes,
            req.empresaId
        );

        const rows = result.rows.map((row) => {
            if (row.tipo_solicitacao !== 'EXCLUSAO' || !row.id_lancamento) {
                return { ...row, origem_exclusao: null, contexto_agenda: null, resumo_origem: null };
            }
            const idLanc = Number(row.id_lancamento);
            const infoAgenda = agendaMap.get(idLanc) || null;
            const desc = row.descricao_lancamento || row.dados_antigos?.descricao || '';
            const agendaIdParsed = parseAgendaIdFromDescricaoBaixa(desc);

            if (infoAgenda || agendaIdParsed) {
                const ctx = infoAgenda || {
                    id_agenda: agendaIdParsed,
                    descricao: '',
                    status: '',
                    data_vencimento: null,
                };
                return {
                    ...row,
                    origem_exclusao: 'agenda',
                    contexto_agenda: ctx,
                    resumo_origem: {
                        label: `Agenda · parcela #${ctx.id_agenda}`,
                        detalhe: ctx.descricao
                            ? `Baixa da parcela: ${ctx.descricao}`
                            : 'Baixa de uma conta da Agenda',
                        efeito: 'Se aprovar: some do extrato e a parcela volta como pendente na Agenda.',
                    },
                };
            }

            return {
                ...row,
                origem_exclusao: 'lancamento',
                contexto_agenda: null,
                resumo_origem: {
                    label: 'Lançamento normal',
                    detalhe: 'Não veio de uma baixa da Agenda',
                    efeito: 'Se aprovar: some do extrato e do saldo (fica oculto no banco).',
                },
            };
        });
        
        res.status(200).json(rows);

    } catch (error) {
        // Este log é o mais importante em caso de erro 500
        console.error('[API GET /aprovacoes-pendentes] ERRO CRÍTICO DURANTE EXECUÇÃO:', error);
        res.status(500).json({ error: 'Erro interno no servidor ao buscar solicitações pendentes.', details: error.message });
    } finally {
        if (dbClient) {
            dbClient.release();
        }
    }
});

// GET /api/financeiro/aprovacoes-historico?status=APROVADO|REJEITADO&page=1&limit=12
router.get('/aprovacoes-historico', async (req, res) => {
    if (!req.permissoesUsuario || !req.permissoesUsuario.includes('aprovar-alteracao-financeira')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }

    const pageNum = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '12'), 10) || 12));
    const offset = (pageNum - 1) * limitNum;
    const statusRaw = String(req.query.status || '').trim().toUpperCase();
    const statusFilter = statusRaw === 'APROVADO' || statusRaw === 'REJEITADO' ? statusRaw : null;

    let dbClient;
    try {
        dbClient = await pool.connect();

        // Histórico = tudo que já saiu da fila (não pendente).
        // Aceita variações de capitalização legadas.
        const whereParts = [
            `sa.empresa_id = $1`,
            `UPPER(TRIM(sa.status::text)) <> 'PENDENTE'`,
        ];
        const countParams = [req.empresaId];
        const listParams = [req.empresaId];

        if (statusFilter) {
            countParams.push(statusFilter);
            listParams.push(statusFilter);
            whereParts.push(`UPPER(TRIM(sa.status::text)) = $${countParams.length}`);
        }

        const whereSql = whereParts.join(' AND ');

        const countRes = await dbClient.query(
            `SELECT COUNT(*)::int AS total
             FROM fc_solicitacoes_alteracao sa
             WHERE ${whereSql}`,
            countParams
        );
        const total = Number(countRes.rows[0]?.total) || 0;

        listParams.push(limitNum, offset);
        const limitIdx = listParams.length - 1;
        const offsetIdx = listParams.length;

        const listRes = await dbClient.query(
            `SELECT sa.id,
                    sa.id_lancamento,
                    sa.tipo_solicitacao,
                    sa.status,
                    sa.dados_antigos,
                    sa.dados_novos,
                    sa.id_usuario_solicitante,
                    sa.justificativa_solicitante,
                    sa.id_usuario_aprovador,
                    sa.motivo_rejeicao,
                    sa.data_solicitacao,
                    sa.data_decisao,
                    COALESCE(u.nome, 'Usuário removido') AS nome_solicitante,
                    ua.nome AS nome_aprovador,
                    l.excluido_em AS lancamento_excluido_em,
                    l.status_edicao AS lancamento_status_edicao,
                    l.descricao AS lancamento_descricao_atual
             FROM fc_solicitacoes_alteracao sa
             LEFT JOIN usuarios u ON sa.id_usuario_solicitante = u.id
             LEFT JOIN usuarios ua ON sa.id_usuario_aprovador = ua.id
             LEFT JOIN fc_lancamentos l
               ON sa.id_lancamento = l.id
              AND sa.empresa_id = l.empresa_id
             WHERE ${whereSql}
             ORDER BY COALESCE(sa.data_decisao, sa.data_solicitacao) DESC NULLS LAST, sa.id DESC
             LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
            listParams
        );

        // Para exclusões: descobrir se veio de baixa de Agenda e se a parcela já tem outra baixa ativa
        const exclusoesOcultas = listRes.rows.filter(
            (row) =>
                row.tipo_solicitacao === 'EXCLUSAO'
                && row.id_lancamento != null
                && row.lancamento_excluido_em != null
        );

        /** @type {Map<number, { id_agenda: number, descricao: string, status: string, id_efetivado: number|null, baixa_substituta_ativa: boolean, id_baixa_substituta: number|null }>} */
        const agendaInfoPorLancamento = new Map();

        if (exclusoesOcultas.length > 0) {
            const descricoes = exclusoesOcultas.map((r) => ({
                idLanc: Number(r.id_lancamento),
                desc: r.lancamento_descricao_atual
                    || r.dados_antigos?.descricao
                    || '',
            }));

            const agendaIds = [];
            const lancToAgenda = new Map();
            for (const { idLanc, desc } of descricoes) {
                const agendaId = parseAgendaIdFromDescricaoBaixa(desc);
                if (agendaId) {
                    lancToAgenda.set(idLanc, agendaId);
                    agendaIds.push(agendaId);
                }
            }

            if (agendaIds.length > 0) {
                const uniqAgendaIds = [...new Set(agendaIds)];
                const agRes = await dbClient.query(
                    `SELECT ca.id,
                            ca.descricao,
                            ca.status,
                            ca.id_lancamento_efetivado,
                            CASE
                              WHEN ca.id_lancamento_efetivado IS NOT NULL
                               AND EXISTS (
                                 SELECT 1 FROM fc_lancamentos lx
                                 WHERE lx.id = ca.id_lancamento_efetivado
                                   AND lx.empresa_id = ca.empresa_id
                                   AND lx.excluido_em IS NULL
                               )
                              THEN true
                              ELSE false
                            END AS tem_baixa_ativa
                     FROM fc_contas_agendadas ca
                     WHERE ca.id = ANY($1::int[])
                       AND ca.empresa_id = $2`,
                    [uniqAgendaIds, req.empresaId]
                );
                const agendaById = new Map(agRes.rows.map((a) => [Number(a.id), a]));

                for (const [idLanc, agendaId] of lancToAgenda.entries()) {
                    const ag = agendaById.get(Number(agendaId));
                    if (!ag) continue;
                    const efetivadoId = ag.id_lancamento_efetivado != null ? Number(ag.id_lancamento_efetivado) : null;
                    const temBaixaAtiva = Boolean(ag.tem_baixa_ativa);
                    const eOutraBaixa = temBaixaAtiva && efetivadoId != null && efetivadoId !== Number(idLanc);
                    agendaInfoPorLancamento.set(Number(idLanc), {
                        id_agenda: Number(ag.id),
                        descricao: ag.descricao || '',
                        status: ag.status || '',
                        id_efetivado: efetivadoId,
                        baixa_substituta_ativa: eOutraBaixa,
                        id_baixa_substituta: eOutraBaixa ? efetivadoId : null,
                    });
                }
            }
        }

        const rows = listRes.rows.map((row) => {
            const statusUp = String(row.status || '').trim().toUpperCase();
            const statusNorm = statusUp === 'APROVADA' ? 'APROVADO' : statusUp === 'REJEITADA' ? 'REJEITADO' : statusUp;
            const oculto = row.lancamento_excluido_em != null;
            const eExclusaoAprovada = statusNorm === 'APROVADO' && row.tipo_solicitacao === 'EXCLUSAO' && row.id_lancamento != null;

            let origem_exclusao = null; // 'lancamento' | 'agenda'
            let contexto_agenda = null;
            let pode_desfazer_exclusao = false;
            let bloqueio_desfazer = null;
            let mensagem_desfazer = null;

            if (eExclusaoAprovada) {
                const desc = row.lancamento_descricao_atual || row.dados_antigos?.descricao || '';
                const agendaIdParsed = parseAgendaIdFromDescricaoBaixa(desc);
                const infoAgenda = agendaInfoPorLancamento.get(Number(row.id_lancamento)) || null;

                if (agendaIdParsed || infoAgenda) {
                    origem_exclusao = 'agenda';
                    contexto_agenda = infoAgenda || {
                        id_agenda: agendaIdParsed,
                        descricao: '',
                        status: 'DESCONHECIDO',
                        id_efetivado: null,
                        baixa_substituta_ativa: false,
                        id_baixa_substituta: null,
                    };

                    if (!oculto) {
                        mensagem_desfazer = 'Esta baixa já está de volta no extrato (exclusão já desfeita).';
                        pode_desfazer_exclusao = false;
                    } else if (contexto_agenda.baixa_substituta_ativa) {
                        bloqueio_desfazer = 'agenda_com_outra_baixa';
                        pode_desfazer_exclusao = false;
                        mensagem_desfazer =
                            `Esta exclusão era a baixa da parcela #${contexto_agenda.id_agenda} da Agenda` +
                            (contexto_agenda.descricao ? ` (“${contexto_agenda.descricao}”)` : '') +
                            `. A parcela já foi paga de novo (baixa #${contexto_agenda.id_baixa_substituta}). ` +
                            `Não dá para reativar a antiga — o dinheiro contaria duas vezes. Se a baixa nova estiver errada, exclua a nova em Lançamentos.`;
                    } else {
                        pode_desfazer_exclusao = true;
                        const parcelaLivre = !contexto_agenda.id_efetivado || String(contexto_agenda.status).toUpperCase() === 'PENDENTE';
                        mensagem_desfazer = parcelaLivre
                            ? `Esta exclusão era a baixa da parcela #${contexto_agenda.id_agenda} da Agenda` +
                              (contexto_agenda.descricao ? ` (“${contexto_agenda.descricao}”)` : '') +
                              `. A parcela está de novo como pendente — ao desfazer, o lançamento volta e a Agenda volta a “paga”.`
                            : `Esta exclusão era a baixa da parcela #${contexto_agenda.id_agenda} da Agenda. Pode reativar com segurança: não há outra baixa ativa nessa parcela.`;
                    }
                } else {
                    origem_exclusao = 'lancamento';
                    if (!oculto) {
                        mensagem_desfazer = 'Este lançamento já está de volta no extrato (exclusão já desfeita).';
                        pode_desfazer_exclusao = false;
                    } else {
                        pode_desfazer_exclusao = true;
                        mensagem_desfazer =
                            'Esta exclusão era de um lançamento normal (não veio da Agenda). Ao desfazer, ele volta a aparecer no extrato e no saldo.';
                    }
                }
            }

            return {
                ...row,
                status: statusNorm,
                origem_exclusao,
                contexto_agenda,
                pode_desfazer_exclusao,
                bloqueio_desfazer,
                mensagem_desfazer,
            };
        });

        res.status(200).json({
            rows,
            total,
            page: pageNum,
            limit: limitNum,
            totalPaginas: Math.max(1, Math.ceil(total / limitNum) || 1),
        });
    } catch (error) {
        console.error('[API GET /aprovacoes-historico] ERRO:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico de decisões.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/financeiro/aprovacoes/:id/desfazer-exclusao
// Reativa lançamento soft-deletado após exclusão APROVADA (não reabre a solicitação).
router.post('/aprovacoes/:id/desfazer-exclusao', async (req, res) => {
    if (!req.permissoesUsuario || !req.permissoesUsuario.includes('aprovar-alteracao-financeira')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }

    const { id } = req.params;
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const solRes = await dbClient.query(
            `SELECT sa.*, u.nome AS nome_solicitante
             FROM fc_solicitacoes_alteracao sa
             JOIN usuarios u ON sa.id_usuario_solicitante = u.id
             WHERE sa.id = $1
               AND sa.empresa_id = $2
             FOR UPDATE OF sa`,
            [id, req.empresaId]
        );
        if (solRes.rows.length === 0) {
            throw Object.assign(new Error('Solicitação não encontrada.'), { statusCode: 404 });
        }
        const solicitacao = solRes.rows[0];

        if (solicitacao.tipo_solicitacao !== 'EXCLUSAO') {
            throw Object.assign(new Error('Só é possível desfazer exclusões aprovadas.'), { statusCode: 400 });
        }
        if (solicitacao.status !== 'APROVADO') {
            throw Object.assign(new Error('A exclusão só pode ser desfeita se a solicitação estiver aprovada.'), { statusCode: 400 });
        }
        if (!solicitacao.id_lancamento) {
            throw Object.assign(new Error('Solicitação sem lançamento vinculado.'), { statusCode: 400 });
        }

        const lancAntes = await dbClient.query(
            `SELECT *
               FROM fc_lancamentos
              WHERE id = $1
                AND empresa_id = $2`,
            [solicitacao.id_lancamento, req.empresaId]
        );
        if (lancAntes.rows.length === 0) {
            throw Object.assign(new Error('Lançamento não encontrado.'), { statusCode: 404 });
        }
        if (lancAntes.rows[0].excluido_em == null) {
            throw Object.assign(
                new Error('Este lançamento já está ativo (a exclusão já foi desfeita ou o lançamento foi reativado).'),
                { statusCode: 409 }
            );
        }

        const restaurado = await softRestoreLancamento(
            dbClient,
            solicitacao.id_lancamento,
            req.empresaId,
            { cascade: true }
        );
        if (!restaurado) {
            throw Object.assign(new Error('Não foi possível reativar o lançamento.'), { statusCode: 500 });
        }

        await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'REATIVACAO_LANCAMENTO', {
            depois: restaurado,
            solicitacao_id: solicitacao.id,
            motivo: 'Desfazer exclusão aprovada',
        }, req.empresaId);

        await dbClient.query(
            `INSERT INTO fc_notificacoes (
                id_usuario_destino, tipo, mensagem, empresa_id
             )
             VALUES ($1, 'INFO', $2, $3)`,
            [
                solicitacao.id_usuario_solicitante,
                `A exclusão do lançamento <strong>#${restaurado.id}</strong> ("${restaurado.descricao || 'sem descrição'}") foi <strong>desfeita</strong> por ${req.usuarioLogado.nome}. O lançamento voltou ao extrato e ao saldo.`,
                req.empresaId,
            ]
        );

        await dbClient.query('COMMIT');
        res.status(200).json({
            message: 'Exclusão desfeita. O lançamento voltou a aparecer no extrato e no saldo.',
            lancamento: restaurado,
        });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        const status = error.statusCode || 500;
        if (status >= 500) {
            console.error(`[API /aprovacoes/${id}/desfazer-exclusao] ERRO:`, error);
        }
        res.status(status).json({
            error: error.message || 'Erro ao desfazer exclusão.',
            details: error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// POST /api/financeiro/aprovacoes/:id/aprovar
router.post('/aprovacoes/:id/aprovar', async (req, res) => {
    if (!req.permissoesUsuario.includes('aprovar-alteracao-financeira')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    const { id } = req.params;
    let dbClient;

    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const solQuery = `
            SELECT sa.*, u.nome as nome_solicitante 
            FROM fc_solicitacoes_alteracao sa
            JOIN usuarios u ON sa.id_usuario_solicitante = u.id
            WHERE sa.id = $1
              AND sa.empresa_id = $2
              AND sa.status = 'PENDENTE'
            FOR UPDATE;
        `;
        const solRes = await dbClient.query(solQuery, [id, req.empresaId]);

        if (solRes.rows.length === 0) {
            throw new Error(`Solicitação #${id} não encontrada ou já processada.`);
        }
        const solicitacao = solRes.rows[0];
        const idLancamento = solicitacao.id_lancamento;
        if (idLancamento) {
            await exigirRecursoDaEmpresa(
                dbClient,
                'fc_lancamentos',
                idLancamento,
                req.empresaId,
                { nome: 'Lançamento', forUpdate: true }
            );
        }

        let mensagemNotificacao = '';

        // --- ETAPA 1: Executar a Ação Principal (Edição, Exclusão, etc.) ---
         switch (solicitacao.tipo_solicitacao) {
            case 'EDICAO': {
                const dadosNovos = solicitacao.dados_novos;
                if (dadosNovos.dados_pai) { // Lançamento Detalhado (Compra ou Rateio)
                    const { dados_pai, itens_filho, tipo_rateio } = dadosNovos;
                    await validarReferenciasLancamento(
                        dbClient,
                        req.empresaId,
                        dados_pai,
                        itens_filho,
                        tipo_rateio
                    );
                    await dbClient.query(
                        `DELETE FROM fc_lancamento_itens
                          WHERE id_lancamento_pai = $1
                            AND empresa_id = $2`,
                        [idLancamento, req.empresaId]
                    );
                    if (tipo_rateio === 'COMPRA') {
                        const soma_itens = itens_filho.reduce((acc, item) => (acc + (parseFloat(item.quantidade) * parseFloat(item.valor_unitario))), 0);
                        const valor_total = soma_itens - parseFloat(dados_pai.valor_desconto || 0);
                        await dbClient.query(`UPDATE fc_lancamentos SET id_conta_bancaria=$1, valor=$2, valor_desconto=$3, data_transacao=$4, descricao=$5, id_contato=$6, id_categoria=$7, tipo_rateio=$8, status_edicao='EDITADO_APROVADO', id_usuario_edicao=$9, atualizado_em=NOW() WHERE id=$10 AND empresa_id=$11;`, [dados_pai.id_conta_bancaria, valor_total, dados_pai.valor_desconto || 0, dados_pai.data_transacao, dados_pai.descricao, dados_pai.id_contato, null, tipo_rateio, req.usuarioLogado.id, idLancamento, req.empresaId]);
                        for (const item of itens_filho) {
                            const valor_total_item = parseFloat(item.quantidade) * parseFloat(item.valor_unitario);
                            await dbClient.query(`INSERT INTO fc_lancamento_itens (id_lancamento_pai, id_categoria, descricao_item, quantidade, valor_unitario, valor_total_item, id_contato_item, empresa_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8);`, [idLancamento, item.id_categoria, item.descricao_item, item.quantidade, item.valor_unitario, valor_total_item, item.id_contato_item || null, req.empresaId]);
                        }
                    } else if (tipo_rateio === 'DETALHADO') {
                        const valor_total = itens_filho.reduce((acc, item) => acc + parseFloat(item.valor_item || 0), 0);
                        await dbClient.query(`UPDATE fc_lancamentos SET id_conta_bancaria=$1, valor=$2, data_transacao=$3, descricao=$4, id_contato=$5, id_categoria=$6, tipo_rateio=$7, status_edicao='EDITADO_APROVADO', id_usuario_edicao=$8, atualizado_em=NOW() WHERE id=$9 AND empresa_id=$10;`, [dados_pai.id_conta_bancaria, valor_total, dados_pai.data_transacao, dados_pai.descricao, dados_pai.id_contato, dados_pai.id_categoria, tipo_rateio, req.usuarioLogado.id, idLancamento, req.empresaId]);
                        for (const item of itens_filho) {
                            await dbClient.query(`INSERT INTO fc_lancamento_itens (id_lancamento_pai, id_categoria, descricao_item, valor_total_item, id_contato_item, empresa_id) VALUES ($1,$2,$3,$4,$5,$6);`, [idLancamento, item.id_categoria, item.descricao_item, item.valor_item, item.id_contato_item || null, req.empresaId]);
                        }
                    }
                } else { // Lançamento Simples
                    const { valor, data_transacao, id_categoria, id_conta_bancaria, descricao, id_contato } = dadosNovos;
                    await validarReferenciasLancamento(
                        dbClient,
                        req.empresaId,
                        dadosNovos
                    );
                    await dbClient.query(`UPDATE fc_lancamentos SET valor=$1, data_transacao=$2, id_categoria=$3, id_conta_bancaria=$4, descricao=$5, id_contato=$6, status_edicao='EDITADO_APROVADO', motivo_rejeicao=NULL, id_usuario_edicao=$7, atualizado_em=NOW() WHERE id = $8 AND empresa_id = $9;`, [valor, data_transacao, id_categoria, id_conta_bancaria, descricao, id_contato, req.usuarioLogado.id, idLancamento, req.empresaId]);
                }
                mensagemNotificacao = `Sua edição para o lançamento <strong>#${idLancamento}</strong> foi APROVADA.`;
                break;
            }

            case 'EXCLUSAO': {
                await softDeleteLancamento(dbClient, idLancamento, req.usuarioLogado.id, req.empresaId, { cascade: true });
                mensagemNotificacao = `Sua solicitação para excluir o lançamento <strong>#${idLancamento}</strong> foi APROVADA (cancelamento lógico).`;
                break;
            }
            
            case 'ESTORNO': {
                const lancamentoOriginalEstorno = solicitacao.dados_antigos;
                const dadosEstorno = solicitacao.dados_novos;
                await exigirRecursoDaEmpresa(dbClient, 'fc_contas_bancarias', dadosEstorno.id_conta_bancaria, req.empresaId, { nome: 'Conta bancária' });
                await dbClient.query(`INSERT INTO fc_lancamentos (id_conta_bancaria, id_categoria, tipo, valor, data_transacao, descricao, id_contato, id_usuario_lancamento, id_estorno_de, empresa_id) VALUES ($1, $2, 'RECEITA', $3, $4, $5, $6, $7, $8, $9);`, [dadosEstorno.id_conta_bancaria, lancamentoOriginalEstorno.id_categoria, dadosEstorno.valor_estornado, dadosEstorno.data_transacao, `Estorno do lançamento #${idLancamento}: ${lancamentoOriginalEstorno.descricao}`, lancamentoOriginalEstorno.id_contato, solicitacao.id_usuario_solicitante, idLancamento, req.empresaId]);
                await dbClient.query("UPDATE fc_lancamentos SET status_edicao = 'ESTORNADO' WHERE id = $1 AND empresa_id = $2", [idLancamento, req.empresaId]);
                mensagemNotificacao = `Sua solicitação para estornar o lançamento <strong>#${idLancamento}</strong> foi APROVADA.`;
                break;
            }
        
            case 'REVERSAO_ESTORNO': {
                const lancamentoEstorno = solicitacao.dados_antigos;
                const idLancamentoOriginal = lancamentoEstorno.id_estorno_de;
                await softDeleteLancamento(dbClient, idLancamento, req.usuarioLogado.id, req.empresaId, { cascade: false });
                await dbClient.query(
                    "UPDATE fc_lancamentos SET status_edicao = 'OK' WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL",
                    [idLancamentoOriginal, req.empresaId]
                );
                mensagemNotificacao = `Sua solicitação para reverter o estorno <strong>#${idLancamento}</strong> foi APROVADA.`;
                break;
            }

            case 'CRIACAO_DATAS_ESPECIAIS': {
                const lancamentoProposto = solicitacao.dados_novos.lancamento_proposto;
                let novoLancamento;
                
                if (!lancamentoProposto.tipo_rateio) { // Simples
                    const { tipo, valor, data_transacao, id_categoria, id_conta_bancaria, id_contato, descricao } = lancamentoProposto;
                    await validarReferenciasLancamento(dbClient, req.empresaId, lancamentoProposto);
                    const res = await dbClient.query(`INSERT INTO fc_lancamentos (id_conta_bancaria, id_categoria, tipo, valor, data_transacao, descricao, id_contato, id_usuario_lancamento, empresa_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;`, [id_conta_bancaria, id_categoria, tipo, valor, data_transacao, descricao, id_contato, solicitacao.id_usuario_solicitante, req.empresaId]);
                    novoLancamento = res.rows[0];
                } else { // Detalhado
                    const { dados_pai, itens_filho, tipo_rateio } = lancamentoProposto;
                    await validarReferenciasLancamento(dbClient, req.empresaId, dados_pai, itens_filho, tipo_rateio);
                    const lancamentoPaiRes = await dbClient.query(`INSERT INTO fc_lancamentos (tipo, tipo_rateio, data_transacao, id_conta_bancaria, id_contato, id_categoria, descricao, valor, valor_desconto, id_usuario_lancamento, empresa_id) VALUES ('DESPESA', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;`, [ tipo_rateio, dados_pai.data_transacao, dados_pai.id_conta_bancaria, dados_pai.id_contato, tipo_rateio === 'COMPRA' ? null : dados_pai.id_categoria, dados_pai.descricao, 0, dados_pai.valor_desconto || 0, solicitacao.id_usuario_solicitante, req.empresaId ]);
                    const lancamentoPai = lancamentoPaiRes.rows[0];
                    let somaTotalItens = 0;
                    for (const item of itens_filho) {
                        let valorDoItem = 0;
                        if (tipo_rateio === 'COMPRA') {
                            valorDoItem = (item.quantidade || 0) * (item.valor_unitario || 0);
                            await dbClient.query('INSERT INTO fc_lancamento_itens (id_lancamento_pai, id_categoria, descricao_item, quantidade, valor_unitario, valor_total_item, id_contato_item, empresa_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);', [lancamentoPai.id, item.id_categoria, item.descricao_item, item.quantidade, item.valor_unitario, valorDoItem, item.id_contato_item || null, req.empresaId]);
                        } else {
                            valorDoItem = item.valor_item || 0;
                            await dbClient.query('INSERT INTO fc_lancamento_itens (id_lancamento_pai, id_categoria, descricao_item, valor_total_item, id_contato_item, empresa_id) VALUES ($1, $2, $3, $4, $5, $6);', [lancamentoPai.id, item.id_categoria, item.descricao_item, valorDoItem, item.id_contato_item, req.empresaId]);
                        }
                        somaTotalItens += valorDoItem;
                    }
                    const valorFinalPai = somaTotalItens - (dados_pai.valor_desconto || 0);
                    await dbClient.query('UPDATE fc_lancamentos SET valor = $1 WHERE id = $2 AND empresa_id = $3', [valorFinalPai, lancamentoPai.id, req.empresaId]);
                    novoLancamento = { ...lancamentoPai, valor: valorFinalPai, data_transacao: dados_pai.data_transacao };
                }
                
                await dbClient.query('UPDATE fc_solicitacoes_alteracao SET id_lancamento = $1 WHERE id = $2 AND empresa_id = $3', [novoLancamento.id, id, req.empresaId]);
                mensagemNotificacao = `Sua lançamento proposto para a data <strong>${new Date((novoLancamento.data_transacao || '') + 'T12:00:00Z').toLocaleDateString('pt-BR')}</strong> foi APROVADO.`;
                break;
            }

            default:
                throw new Error(`Tipo de solicitação desconhecido: ${solicitacao.tipo_solicitacao}`);
        }

        // --- ETAPA 2: Finalizar a Solicitação, Notificar e LOGAR ---
        
        // Atualiza o status da solicitação para APROVADO
        await dbClient.query("UPDATE fc_solicitacoes_alteracao SET status = 'APROVADO', id_usuario_aprovador = $1, data_decisao = NOW() WHERE id = $2 AND empresa_id = $3", [req.usuarioLogado.id, id, req.empresaId]);
        
        // Envia notificação para o usuário que solicitou
        await dbClient.query("INSERT INTO fc_notificacoes (id_usuario_destino, tipo, mensagem, empresa_id) VALUES ($1, 'SUCESSO', $2, $3);", [solicitacao.id_usuario_solicitante, mensagemNotificacao, req.empresaId]);

        await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'APROVACAO_SOLICITACAO', { solicitacao }, req.empresaId);
        
        // Se tudo ocorreu bem, confirma a transação
        await dbClient.query('COMMIT');
        res.status(200).json({ message: 'Solicitação aprovada com sucesso.' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error(`[API /aprovacoes/aprovar] ERRO CRÍTICO ao aprovar solicitação #${id}:`, error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro interno ao aprovar solicitação.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// POST /api/financeiro/aprovacoes/:id/rejeitar
router.post('/aprovacoes/:id/rejeitar', async (req, res) => {
    if (!req.permissoesUsuario.includes('aprovar-alteracao-financeira')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }
    const { id } = req.params;
    const { motivo } = req.body;
    if (!motivo || motivo.trim() === '') {
        return res.status(400).json({error: 'O motivo da rejeição é obrigatório.'});
    }
    
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const solRes = await dbClient.query(
            `SELECT *
               FROM fc_solicitacoes_alteracao
              WHERE id = $1
                AND empresa_id = $2
                AND status = 'PENDENTE'
              FOR UPDATE`,
            [id, req.empresaId]
        );
        if (solRes.rows.length === 0) throw new Error('Solicitação não encontrada ou já processada.');
        const solicitacao = solRes.rows[0];
        
        // Se for uma solicitação de criação, não há lançamento original para atualizar.
        if (solicitacao.tipo_solicitacao !== 'CRIACAO_DATAS_ESPECIAIS') {
            await dbClient.query(
                "UPDATE fc_lancamentos SET status_edicao = 'EDICAO_REJEITADA', motivo_rejeicao = $1 WHERE id = $2 AND empresa_id = $3",
                [motivo.trim(), solicitacao.id_lancamento, req.empresaId]
            );
        }
        
        await dbClient.query(
            "UPDATE fc_solicitacoes_alteracao SET status = 'REJEITADO', id_usuario_aprovador = $1, motivo_rejeicao = $2, data_decisao = NOW() WHERE id = $3 AND empresa_id = $4",
            [req.usuarioLogado.id, motivo.trim(), id, req.empresaId]
        );
        
        // Monta a mensagem de notificação de forma segura
        let mensagemNotificacao = '';
        if (solicitacao.tipo_solicitacao === 'CRIACAO_DATAS_ESPECIAIS') {
            const descricaoProposta = solicitacao.dados_novos.lancamento_proposto?.dados_pai?.descricao || solicitacao.dados_novos.lancamento_proposto?.descricao || 'sem descrição';
            mensagemNotificacao = `Sua proposta de novo lançamento ("${descricaoProposta}") foi REJEITADA. Motivo: ${motivo.trim()}`;
        } else {
            const descricaoAntiga = solicitacao.dados_antigos?.descricao || 'sem descrição';
            mensagemNotificacao = `Sua solicitação para alterar o lançamento <strong>#${solicitacao.id_lancamento} ("${descricaoAntiga}")</strong> foi REJEITADA. Motivo: ${motivo.trim()}`;
        }

        await dbClient.query(
            "INSERT INTO fc_notificacoes (id_usuario_destino, tipo, mensagem, empresa_id) VALUES ($1, 'REJEICAO', $2, $3);",
            [solicitacao.id_usuario_solicitante, mensagemNotificacao, req.empresaId]
        );
        
        await registrarLog(
            dbClient,
            req.usuarioLogado.id,
            req.usuarioLogado.nome,
            'REJEICAO_SOLICITACAO',
            { solicitacao, motivo: motivo.trim() },
            req.empresaId
        );
        
        await dbClient.query('COMMIT');
        res.status(200).json({ message: 'Solicitação rejeitada com sucesso.' });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error("[API /aprovacoes/rejeitar] Erro:", error);
        res.status(500).json({ error: 'Erro ao rejeitar solicitação.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/financeiro/notificacoes - Busca as notificações do usuário logado (paginado)
router.get('/notificacoes', async (req, res) => {
    const { id: idUsuario } = req.usuarioLogado;
    const pageNum = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '10'), 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    let dbClient;
    try {
        dbClient = await pool.connect();
        const listQuery = `
            SELECT id, tipo, mensagem, criado_em, lida
            FROM fc_notificacoes
            WHERE id_usuario_destino = $1
              AND empresa_id = $2
            ORDER BY criado_em DESC, id DESC
            LIMIT $3 OFFSET $4;
        `;
        const countQuery = `
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE lida = false)::int AS nao_lidas
            FROM fc_notificacoes
            WHERE id_usuario_destino = $1
              AND empresa_id = $2;
        `;
        const [listResult, countResult] = await Promise.all([
            dbClient.query(listQuery, [idUsuario, req.empresaId, limitNum, offset]),
            dbClient.query(countQuery, [idUsuario, req.empresaId]),
        ]);

        const total = countResult.rows[0]?.total || 0;
        const naoLidas = countResult.rows[0]?.nao_lidas || 0;
        const totalPages = Math.ceil(total / limitNum) || 1;

        // Compatível com o frontend antigo (array) se não pedir page explicitamente?
        // Agora sempre retorna objeto paginado — o front foi atualizado junto.
        res.status(200).json({
            notificacoes: listResult.rows,
            currentPage: pageNum,
            totalPages,
            total,
            naoLidas,
            limit: limitNum,
        });
    } catch (error) {
        console.error('[API GET /notificacoes] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar notificações.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/financeiro/notificacoes/:id/marcar-como-lida
router.post('/notificacoes/:id/marcar-como-lida', async (req, res) => {
    const { id: idUsuario } = req.usuarioLogado;
    const { id: idNotificacao } = req.params;
    let dbClient;
    try {
        dbClient = await pool.connect();
        const query = `
            UPDATE fc_notificacoes
               SET lida = true
             WHERE id = $1
               AND id_usuario_destino = $2
               AND empresa_id = $3
        `;
        await dbClient.query(query, [idNotificacao, idUsuario, req.empresaId]);
        res.status(204).send(); // 204 No Content, sucesso sem corpo de resposta
    } catch (error) {
        console.error('[API POST /notificacoes/marcar-como-lida] Erro:', error);
        res.status(500).json({ error: 'Erro ao marcar notificação como lida.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// POST /api/financeiro/notificacoes/marcar-todas-como-lidas
router.post('/notificacoes/marcar-todas-como-lidas', async (req, res) => {
    const { id: idUsuario } = req.usuarioLogado;
    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query(
            `UPDATE fc_notificacoes
                SET lida = true
              WHERE id_usuario_destino = $1
                AND empresa_id = $2`,
            [idUsuario, req.empresaId]
        );
        res.status(204).send();
    } catch (error) {
        console.error('[API POST /notificacoes/marcar-todas-como-lidas] Erro:', error);
        res.status(500).json({ error: 'Erro ao marcar todas as notificações como lidas.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// GET /api/financeiro/logs - Busca os logs de auditoria (com busca e filtros)
router.get('/logs', async (req, res) => {
    if (!req.permissoesUsuario.includes('aprovar-alteracao-financeira')) {
        return res.status(403).json({ error: 'Permissão negada.' });
    }

    const {
        limit = 15,
        page = 1,
        q = '',
        acao = '',
        usuario = '',
        dataInicio = '',
        dataFim = '',
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(String(limit), 10) || 15));
    const offset = (pageNum - 1) * limitNum;

    const where = ['empresa_id = $1'];
    const params = [req.empresaId];

    if (String(q).trim()) {
        const termo = '%' + String(q).trim() + '%';
        params.push(termo, termo, termo);
        where.push('(detalhes ILIKE $' + (params.length - 2) + ' OR nome_usuario ILIKE $' + (params.length - 1) + ' OR acao ILIKE $' + params.length + ')');
    }
    if (String(acao).trim()) {
        params.push(String(acao).trim());
        where.push('acao = $' + params.length);
    }
    if (String(usuario).trim()) {
        params.push('%' + String(usuario).trim() + '%');
        where.push('nome_usuario ILIKE $' + params.length);
    }
    if (String(dataInicio).trim()) {
        params.push(String(dataInicio).trim());
        where.push('data_evento::date >= $' + params.length + '::date');
    }
    if (String(dataFim).trim()) {
        params.push(String(dataFim).trim());
        where.push('data_evento::date <= $' + params.length + '::date');
    }

    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';

    let dbClient;
    try {
        dbClient = await pool.connect();

        const logsQuery = `
            SELECT id, id_usuario, nome_usuario, acao, detalhes, dados_alterados, data_evento
            FROM fc_logs_auditoria
            ${whereSql}
            ORDER BY data_evento DESC, id DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2};
        `;
        const countQuery = `SELECT COUNT(*)::int AS total FROM fc_logs_auditoria ${whereSql}`;

        const [logsResult, countResult] = await Promise.all([
            dbClient.query(logsQuery, [...params, limitNum, offset]),
            dbClient.query(countQuery, params),
        ]);

        const totalLogs = countResult.rows[0]?.total || 0;
        const totalPages = Math.ceil(totalLogs / limitNum) || 1;

        res.status(200).json({
            logs: logsResult.rows,
            currentPage: pageNum,
            totalPages,
            total: totalLogs,
            limit: limitNum,
        });
    } catch (error) {
        console.error('[API GET /logs] Erro:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico de auditoria.', details: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.post('/transferencias', async (req, res) => {
    // Validação de permissão (vamos usar 'lancar-transacao' por enquanto)
    if (!req.permissoesUsuario.includes('lancar-transacao')) {
        return res.status(403).json({ error: 'Permissão negada para realizar transferências.' });
    }

    const { id_conta_origem, id_conta_destino, valor, data_transacao, descricao, id_categoria_transferencia } = req.body;

    // Validação dos dados recebidos
    if (!id_conta_origem || !id_conta_destino || !valor || !data_transacao || !id_categoria_transferencia) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
    }
    if (id_conta_origem === id_conta_destino) {
        return res.status(400).json({ error: 'A conta de origem e destino não podem ser a mesma.' });
    }
    if (valor <= 0) {
        return res.status(400).json({ error: 'O valor da transferência deve ser positivo.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN'); // Inicia a transação

        const contaOrigem = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_contas_bancarias',
            id_conta_origem,
            req.empresaId,
            { nome: 'Conta de origem', forUpdate: true }
        );
        const contaDestino = await exigirRecursoDaEmpresa(
            dbClient,
            'fc_contas_bancarias',
            id_conta_destino,
            req.empresaId,
            { nome: 'Conta de destino', forUpdate: true }
        );
        await exigirRecursoDaEmpresa(
            dbClient,
            'fc_categorias',
            id_categoria_transferencia,
            req.empresaId,
            { nome: 'Categoria de transferência' }
        );

        // 1. Cria o lançamento de SAÍDA (Despesa)
        const saidaQuery = `
            INSERT INTO fc_lancamentos (
                id_conta_bancaria, id_categoria, tipo, valor, data_transacao,
                descricao, id_usuario_lancamento, empresa_id
            )
            VALUES ($1, $2, 'DESPESA', $3, $4, $5, $6, $7)
            RETURNING id;
        `;
        const descricaoSaida = `Transferência para conta destino. ${descricao || ''}`;
        const resSaida = await dbClient.query(saidaQuery, [id_conta_origem, id_categoria_transferencia, valor, data_transacao, descricaoSaida, req.usuarioLogado.id, req.empresaId]);
        const idLancamentoSaida = resSaida.rows[0].id;

        // 2. Cria o lançamento de ENTRADA (Receita)
        const entradaQuery = `
            INSERT INTO fc_lancamentos (
                id_conta_bancaria, id_categoria, tipo, valor, data_transacao,
                descricao, id_usuario_lancamento, empresa_id
            )
            VALUES ($1, $2, 'RECEITA', $3, $4, $5, $6, $7)
            RETURNING id;
        `;
        const descricaoEntrada = `Transferência entre contas. ${descricao || ''}`;
        const resEntrada = await dbClient.query(entradaQuery, [id_conta_destino, id_categoria_transferencia, valor, data_transacao, descricaoEntrada, req.usuarioLogado.id, req.empresaId]);
        const idLancamentoEntrada = resEntrada.rows[0].id;

        // 3. ATUALIZA os dois lançamentos para VINCULÁ-LOS
        await dbClient.query('UPDATE fc_lancamentos SET id_transferencia_vinculada = $1 WHERE id = $2 AND empresa_id = $3', [idLancamentoEntrada, idLancamentoSaida, req.empresaId]);
        await dbClient.query('UPDATE fc_lancamentos SET id_transferencia_vinculada = $1 WHERE id = $2 AND empresa_id = $3', [idLancamentoSaida, idLancamentoEntrada, req.empresaId]);

        // ADICIONE AQUI O REGISTRO DE LOG
        await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'CRIACAO_TRANSFERENCIA', {
            valor: valor,
            contaOrigem: contaOrigem.nome_conta,
            contaDestino: contaDestino.nome_conta,
            descricao: descricao
        }, req.empresaId);

        await dbClient.query('COMMIT'); // Confirma a transação
        res.status(201).json({ message: 'Transferência realizada com sucesso!' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK'); // Desfaz tudo em caso de erro
        console.error('[API POST /transferencias] Erro:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Erro ao processar transferência.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// NOVA ROTA PARA SOLICITAR CRIAÇÃO COM DATA ESPECIAL
router.post('/lancamentos/solicitar-criacao', async (req, res) => {
    // Apenas pegamos o corpo da requisição inteiro
    const { lancamento_proposto, justificativa } = req.body;
    
    if (!lancamento_proposto || !justificativa || justificativa.trim() === '') {
        return res.status(400).json({ error: 'Os dados do lançamento e a justificativa são obrigatórios.' });
    }

    let dbClient;
    try {
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        if (lancamento_proposto.dados_pai) {
            await validarReferenciasLancamento(
                dbClient,
                req.empresaId,
                lancamento_proposto.dados_pai,
                lancamento_proposto.itens_filho || [],
                lancamento_proposto.tipo_rateio
            );
        } else {
            await validarReferenciasLancamento(
                dbClient,
                req.empresaId,
                lancamento_proposto
            );
        }

        const solQuery = `
            INSERT INTO fc_solicitacoes_alteracao 
                (id_lancamento, tipo_solicitacao, dados_novos,
                 id_usuario_solicitante, justificativa_solicitante, empresa_id)
            VALUES (NULL, 'CRIACAO_DATAS_ESPECIAIS', $1, $2, $3, $4)
            RETURNING *;
        `;

        const solRes = await dbClient.query(solQuery, [
            JSON.stringify({ lancamento_proposto: lancamento_proposto }), // Salva a estrutura { lancamento_proposto: ... }
            req.usuarioLogado.id,
            justificativa,
            req.empresaId
        ]);

        await registrarLog(dbClient, req.usuarioLogado.id, req.usuarioLogado.nome, 'SOLICITACAO_CRIACAO', {
            lancamento_proposto,
            justificativa,
            solicitacao: solRes.rows[0],
        }, req.empresaId);

        await dbClient.query('COMMIT');
        res.status(202).json({ message: 'Solicitação de lançamento com data especial enviada para aprovação.' });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error("[API /lancamentos/solicitar-criacao] Erro:", error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode
                ? error.message
                : 'Erro ao processar solicitação de criação.',
            details: error.statusCode ? undefined : error.message,
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});


export default router;
