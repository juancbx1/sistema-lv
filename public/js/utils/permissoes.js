// public/js/utils/permissoes.js

export const PERMISSAO_AUDITORIA_GESTAO = 'acesso-auditoria-gestao-organizacional';
export const PERMISSAO_AUDITORIA_GESTAO_LEGADA = 'acesso-permissoes-usuarios';
export const PERMISSOES_AUDITORIA_GESTAO = Object.freeze([
    PERMISSAO_AUDITORIA_GESTAO,
    PERMISSAO_AUDITORIA_GESTAO_LEGADA,
]);

// Durante a transição, o banco pode conter qualquer um dos dois identificadores.
// A interface trabalha apenas com o identificador canônico; a persistência
// expande o alias para manter versões antigas compatíveis.
export function normalizarPermissoesParaInterface(permissoes = []) {
    const normalizadas = new Set(Array.isArray(permissoes) ? permissoes : []);
    if (PERMISSOES_AUDITORIA_GESTAO.some((id) => normalizadas.has(id))) {
        normalizadas.delete(PERMISSAO_AUDITORIA_GESTAO_LEGADA);
        normalizadas.add(PERMISSAO_AUDITORIA_GESTAO);
    }
    return Array.from(normalizadas);
}

export function expandirAliasesPermissoes(permissoes = []) {
    const expandidas = new Set(Array.isArray(permissoes) ? permissoes : []);
    if (PERMISSOES_AUDITORIA_GESTAO.some((id) => expandidas.has(id))) {
        expandidas.add(PERMISSAO_AUDITORIA_GESTAO);
        expandidas.add(PERMISSAO_AUDITORIA_GESTAO_LEGADA);
    }
    return Array.from(expandidas);
}

export function temPermissaoAuditoriaGestao(permissoes = []) {
    const lista = Array.isArray(permissoes) ? permissoes : [];
    return PERMISSOES_AUDITORIA_GESTAO.some((id) => lista.includes(id));
}

/**
 * Cada permissão possui uma localização visual e um tipo de controle.
 *
 * `aba` é usado inclusive quando a página não possui abas reais. Nesse caso,
 * o valor padrão é `Principal`, evitando a antiga ambiguidade de localização.
 */
function criarPermissao(id, campos) {
    const modulo = campos.modulo || 'Outros';
    return {
        id,
        label: campos.label,
        descricao: campos.descricao,
        modulo,
        categoria: campos.categoria || modulo,
        pagina: campos.pagina || 'Principal',
        aba: campos.aba || 'Principal',
        tipo: campos.tipo || 'acao',
        ...campos,
    };
}

// ============================================================================
// CATÁLOGO DE PERMISSÕES
//
// Regra obrigatória: os IDs são contratos permanentes. Labels, descrições,
// módulos, páginas e abas podem evoluir; os IDs não devem ser renomeados,
// fundidos ou excluídos sem auditoria e decisão explícita.
// ============================================================================

export const permissoesDisponiveis = [

    // ========================================================================
    // MÓDULO: ACESSO GERAL
    // ========================================================================
    criarPermissao('acesso-admin-geral', {
        label: 'Acessar página: Área Administrativa',
        descricao: 'Permite entrar na área administrativa do Sistema LV.',
        modulo: 'Acesso Geral',
        pagina: 'Área Administrativa',
        tipo: 'pagina',
    }),

    // ========================================================================
    // MÓDULO: PRODUÇÃO
    // ========================================================================
    criarPermissao('acesso-ordens-de-producao', {
        label: 'Acessar página: Ordens de Produção',
        descricao: 'Permite abrir a página de ordens, cortes e tarefas de produção.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        tipo: 'pagina',
    }),
    criarPermissao('gerar-op', {
        label: 'Gerar OP a partir de um corte',
        descricao: 'Permite transformar um corte selecionado em uma ordem de produção.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Cortes',
        tipo: 'acao',
    }),
    criarPermissao('criar-op', {
        label: 'Criar OP com corte novo',
        descricao: 'Permite criar uma ordem de produção iniciando também o corte de origem no mesmo fluxo.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Ordens de Produção',
        tipo: 'acao',
    }),
    criarPermissao('editar-op', {
        label: 'Editar ordem de produção',
        descricao: 'Permite atualizar dados operacionais de uma ordem de produção existente.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Ordens de Produção',
        tipo: 'acao',
    }),
    criarPermissao('marcar-como-cortado', {
        label: 'Atualizar corte registrado',
        descricao: 'Permite marcar ou ajustar os dados de um corte já registrado.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Cortes',
        tipo: 'acao',
    }),
    criarPermissao('finalizar-op', {
        label: 'Finalizar ordem de produção',
        descricao: 'Permite encerrar uma OP após a conclusão das etapas permitidas.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Ordens de Produção',
        tipo: 'acao',
    }),
    criarPermissao('cancelar-op', {
        label: 'Cancelar ordem de produção',
        descricao: 'Permite cancelar uma OP e interromper seu fluxo produtivo.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Ordens de Produção',
        tipo: 'acao',
    }),
    criarPermissao('finalizar-tarefa-producao', {
        label: 'Finalizar tarefa de produção',
        descricao: 'Permite confirmar a conclusão de uma tarefa atribuída no painel.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Painel de Atividades',
        tipo: 'acao',
    }),
    criarPermissao('cancelar-tarefa-producao', {
        label: 'Cancelar tarefa de produção',
        descricao: 'Permite cancelar uma tarefa atribuída no painel de atividades.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Painel de Atividades',
        tipo: 'acao',
    }),
    criarPermissao('registrar-corte', {
        label: 'Registrar corte',
        descricao: 'Permite cadastrar um novo corte para iniciar a produção.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Cortes',
        tipo: 'acao',
    }),
    criarPermissao('excluir-estoque-corte', {
        label: 'Excluir corte do estoque',
        descricao: 'Permite retirar um corte do estoque de cortes na aba Cortes.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Cortes',
        tipo: 'acao',
    }),
    criarPermissao('atribuir-tarefa', {
        label: 'Atribuir tarefa de produção',
        descricao: 'Permite distribuir uma tarefa de produção a um empregado autorizado.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Painel de Atividades',
        tipo: 'acao',
    }),
    criarPermissao('confirmar-lancamento', {
        label: 'Confirmar lançamento de produção',
        descricao: 'Permite confirmar quantidades e concluir um lançamento de produção.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Painel de Atividades',
        tipo: 'acao',
    }),
    criarPermissao('usar-agente-encerrador', {
        label: 'Usar Agente Encerrador de OPs',
        descricao: 'Permite executar o agente automático de encerramento de OPs.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Principal',
        tipo: 'acao',
    }),
    criarPermissao('usar-agente-central-ops', {
        label: 'Usar Agente de Encerramento Central',
        descricao: 'Permite executar o agente central de encerramento na aba de OPs.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Ordens de Produção',
        tipo: 'acao',
    }),
    criarPermissao('usar-agente-cortes', {
        label: 'Usar Agente de Planejamento de Cortes',
        descricao: 'Permite executar o agente que planeja e organiza os cortes.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Cortes',
        tipo: 'acao',
    }),
    criarPermissao('configurar-tempos-padrao', {
        label: 'Configurar tempos padrão de produção',
        descricao: 'Permite alterar os tempos padrão usados no planejamento produtivo.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Configurações',
        tipo: 'acao',
    }),
    criarPermissao('permite-estender-horario', {
        label: 'Autorizar hora extra na produção',
        descricao: 'Permite estender o horário de trabalho de um empregado em uma tarefa.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Painel de Atividades',
        tipo: 'acao',
    }),
    criarPermissao('desfazer-lancamento-p-externo', {
        label: 'Desfazer lançamento de produção externa',
        descricao: 'Permite desfazer um lançamento realizado por prestador externo.',
        modulo: 'Produção',
        pagina: 'Ordens de Produção',
        aba: 'Produção Externa',
        tipo: 'acao',
    }),
    criarPermissao('deletar-demanda', {
        label: 'Excluir demanda',
        descricao: 'Permite excluir uma demanda do painel de demandas.',
        modulo: 'Produção',
        pagina: 'Painel de Demandas',
        aba: 'Principal',
        tipo: 'acao',
    }),
    criarPermissao('acesso-gerenciar-producao', {
        label: 'Acessar página: Gerenciar Produção',
        descricao: 'Permite abrir a página de gerenciamento e auditoria dos lançamentos.',
        modulo: 'Produção',
        pagina: 'Gerenciar Produção',
        tipo: 'pagina',
    }),
    criarPermissao('editar-registro-producao', {
        label: 'Editar registro de produção',
        descricao: 'Permite alterar um registro de produção já lançado.',
        modulo: 'Produção',
        pagina: 'Gerenciar Produção',
        aba: 'Registros de Produção',
        tipo: 'acao',
    }),
    criarPermissao('excluir-registro-producao', {
        label: 'Solicitar exclusão de produção',
        descricao: 'Permite solicitar a exclusão de um registro, sujeita à aprovação.',
        modulo: 'Produção',
        pagina: 'Gerenciar Produção',
        aba: 'Registros de Produção',
        tipo: 'acao',
    }),
    criarPermissao('excluir-registro-producao-direto', {
        label: 'Excluir produção diretamente',
        descricao: 'Permite excluir um registro de produção sem aprovação intermediária.',
        modulo: 'Produção',
        pagina: 'Gerenciar Produção',
        aba: 'Registros de Produção',
        tipo: 'acao',
    }),
    criarPermissao('ver-painel-aprovacoes-producao', {
        label: 'Acessar aba: Aprovações de Produção',
        descricao: 'Permite visualizar o painel de solicitações de exclusão de produção.',
        modulo: 'Produção',
        pagina: 'Gerenciar Produção',
        aba: 'Aprovações',
        tipo: 'aba',
    }),
    criarPermissao('aprovar-exclusao-producao', {
        label: 'Aprovar exclusões de produção',
        descricao: 'Permite aprovar ou rejeitar solicitações de exclusão de produção.',
        modulo: 'Produção',
        pagina: 'Gerenciar Produção',
        aba: 'Aprovações',
        tipo: 'acao',
    }),

    // ========================================================================
    // MÓDULO: DASHBOARDS E DESEMPENHO
    // ========================================================================
    criarPermissao('acesso-dashboard', {
        label: 'Acessar página: Dashboard de Produção',
        descricao: 'Permite abrir o dashboard operacional do empregado.',
        modulo: 'Dashboards e Desempenho',
        pagina: 'Dashboard de Produção',
        tipo: 'pagina',
    }),
    criarPermissao('assinar-producao-costureira', {
        label: 'Assinar a própria produção como costureira',
        descricao: 'Permite confirmar a própria produção realizada como costureira.',
        modulo: 'Dashboards e Desempenho',
        pagina: 'Dashboard de Produção',
        aba: 'Minhas tarefas',
        tipo: 'acao',
    }),
    criarPermissao('assinar-producao-tiktik', {
        label: 'Assinar produção de OP como TikTik',
        descricao: 'Permite confirmar a produção de OP realizada como TikTik.',
        modulo: 'Dashboards e Desempenho',
        pagina: 'Dashboard de Produção',
        aba: 'Minhas tarefas',
        tipo: 'acao',
    }),
    criarPermissao('assinar-arremate-tiktik', {
        label: 'Assinar arremate como TikTik',
        descricao: 'Permite confirmar os próprios arremates realizados como TikTik.',
        modulo: 'Dashboards e Desempenho',
        pagina: 'Dashboard de Produção',
        aba: 'Minhas tarefas',
        tipo: 'acao',
    }),
    criarPermissao('ver-proprias-producoes', {
        label: 'Visualizar as próprias produções',
        descricao: 'Restringe a visualização de produções aos registros do próprio empregado.',
        modulo: 'Dashboards e Desempenho',
        pagina: 'Dashboard de Produção',
        aba: 'Minhas produções',
        tipo: 'escopo',
    }),

    // ========================================================================
    // MÓDULO: PESSOAS E GESTÃO ORGANIZACIONAL
    // ========================================================================
    criarPermissao('acesso-usuarios-cadastrados', {
        label: 'Acessar página: Gestão Organizacional (compatibilidade legada)',
        descricao: 'Mantém o acesso usado pela rota antiga de Usuários Cadastrados.',
        modulo: 'Pessoas e Gestão Organizacional',
        pagina: 'Gestão Organizacional',
        tipo: 'pagina',
        status: 'legado-em-uso',
    }),
    criarPermissao('acesso-auditoria-gestao-organizacional', {
        label: 'Acessar aba: Auditoria da Gestão Organizacional',
        descricao: 'Permite consultar o histórico de alterações da gestão organizacional.',
        modulo: 'Pessoas e Gestão Organizacional',
        pagina: 'Gestão Organizacional',
        aba: 'Auditoria',
        tipo: 'aba',
    }),
    criarPermissao('acesso-cadastrar-usuarios', {
        label: 'Cadastrar pessoa ou usuário',
        descricao: 'Permite criar uma nova pessoa e seu vínculo empresarial.',
        modulo: 'Pessoas e Gestão Organizacional',
        pagina: 'Gestão Organizacional',
        aba: 'Pessoas e Acessos',
        tipo: 'acao',
    }),
    criarPermissao('editar-usuarios', {
        label: 'Editar pessoa ou vínculo',
        descricao: 'Permite editar dados da identidade e do vínculo empresarial.',
        modulo: 'Pessoas e Gestão Organizacional',
        pagina: 'Gestão Organizacional',
        aba: 'Pessoas e Acessos',
        tipo: 'acao',
    }),
    criarPermissao('adicionar-ferias', {
        label: 'Registrar férias',
        descricao: 'Permite adicionar um período de férias ao vínculo de uma pessoa.',
        modulo: 'Pessoas e Gestão Organizacional',
        pagina: 'Gestão Organizacional',
        aba: 'Pessoas e Acessos',
        tipo: 'acao',
    }),
    criarPermissao('excluir-usuarios', {
        label: 'Arquivar pessoa ou usuário',
        descricao: 'Permite retirar uma pessoa do uso operacional conforme as regras do sistema.',
        modulo: 'Pessoas e Gestão Organizacional',
        pagina: 'Gestão Organizacional',
        aba: 'Pessoas e Acessos',
        tipo: 'acao',
    }),
    criarPermissao('gerenciar-permissoes', {
        label: 'Gerenciar permissões individuais',
        descricao: 'Permite adicionar ou remover permissões individuais de um vínculo.',
        modulo: 'Pessoas e Gestão Organizacional',
        pagina: 'Gestão Organizacional',
        aba: 'Pessoas e Acessos',
        tipo: 'acao',
    }),
    criarPermissao('acesso-gestao-organizacional', {
        label: 'Acessar página: Gestão Organizacional',
        descricao: 'Permite abrir a página de pessoas, acessos, empresas e auditoria.',
        modulo: 'Pessoas e Gestão Organizacional',
        pagina: 'Gestão Organizacional',
        tipo: 'pagina',
    }),
    criarPermissao('visualizar-empresas', {
        label: 'Visualizar empresas cadastradas',
        descricao: 'Permite consultar a aba Empresas da Gestão Organizacional.',
        modulo: 'Pessoas e Gestão Organizacional',
        pagina: 'Gestão Organizacional',
        aba: 'Empresas',
        tipo: 'aba',
    }),
    criarPermissao('gerenciar-empresas', {
        label: 'Criar e editar empresas',
        descricao: 'Permite cadastrar e alterar empresas da organização.',
        modulo: 'Pessoas e Gestão Organizacional',
        pagina: 'Gestão Organizacional',
        aba: 'Empresas',
        tipo: 'acao',
    }),
    criarPermissao('vincular-usuarios-empresas', {
        label: 'Gerenciar vínculos entre pessoas e empresas',
        descricao: 'Permite criar, editar e encerrar vínculos empresariais.',
        modulo: 'Pessoas e Gestão Organizacional',
        pagina: 'Gestão Organizacional',
        aba: 'Pessoas e Acessos',
        tipo: 'acao',
    }),
    criarPermissao('visualizar-todas-empresas', {
        label: 'Visualizar pessoas de todas as empresas',
        descricao: 'Permite ampliar a consulta para pessoas fora da empresa ativa.',
        modulo: 'Pessoas e Gestão Organizacional',
        pagina: 'Gestão Organizacional',
        aba: 'Pessoas e Acessos',
        tipo: 'escopo',
    }),

    // ========================================================================
    // MÓDULO: PRODUTOS E CATÁLOGO
    // ========================================================================
    criarPermissao('acesso-cadastrar-produto', {
        label: 'Acessar página: Cadastro de Produtos',
        descricao: 'Permite abrir a página de produtos, kits e etapas de produção.',
        modulo: 'Produtos e Catálogo',
        pagina: 'Cadastro de Produtos',
        tipo: 'pagina',
    }),
    criarPermissao('ver-lista-produtos', {
        label: 'Consultar produtos',
        descricao: 'Permite consultar a lista de produtos usada pelos fluxos do sistema.',
        modulo: 'Produtos e Catálogo',
        pagina: 'Cadastro de Produtos',
        aba: 'Principal',
        tipo: 'escopo',
    }),
    criarPermissao('gerenciar-produtos', {
        label: 'Criar e editar produtos e kits',
        descricao: 'Permite criar ou alterar produtos, kits e suas configurações.',
        modulo: 'Produtos e Catálogo',
        pagina: 'Cadastro de Produtos',
        aba: 'Principal',
        tipo: 'acao',
    }),
    // ========================================================================
    // MÓDULO: EMBALAGEM E ESTOQUE
    // ========================================================================
    criarPermissao('acesso-ordens-de-arremates', {
        label: 'Acessar página: Ordens de Arremate',
        descricao: 'Permite abrir a página legada de ordens de arremate durante a transição.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Ordens de Arremate',
        tipo: 'pagina',
        status: 'legado-em-uso',
    }),
    criarPermissao('acesso-embalagem-de-produtos', {
        label: 'Acessar página: Embalagem de Produtos',
        descricao: 'Permite abrir a fila de produtos prontos para embalagem.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Embalagem de Produtos',
        tipo: 'pagina',
    }),
    criarPermissao('lancar-arremate', {
        label: 'Registrar arremate',
        descricao: 'Permite registrar a conclusão de um arremate.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Ordens de Arremate',
        aba: 'Principal',
        tipo: 'acao',
    }),
    criarPermissao('estornar-arremate', {
        label: 'Estornar arremate',
        descricao: 'Permite desfazer um arremate já registrado.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Ordens de Arremate',
        aba: 'Histórico',
        tipo: 'acao',
    }),
    criarPermissao('registrar-perda-arremate', {
        label: 'Registrar perda no arremate',
        descricao: 'Permite registrar uma perda associada ao fluxo de arremate.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Ordens de Arremate',
        aba: 'Principal',
        tipo: 'acao',
    }),
    criarPermissao('lancar-embalagem', {
        label: 'Registrar embalagem de produtos',
        descricao: 'Permite registrar a embalagem de produtos prontos.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Embalagem de Produtos',
        aba: 'Principal',
        tipo: 'acao',
    }),
    criarPermissao('cancelar-tarefa-arremate', {
        label: 'Cancelar tarefa de arremate',
        descricao: 'Permite cancelar uma tarefa atribuída no fluxo de arremate.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Ordens de Arremate',
        aba: 'Principal',
        tipo: 'acao',
    }),
    criarPermissao('acesso-estoque', {
        label: 'Acessar página: Controle de Estoque',
        descricao: 'Permite abrir a página de saldo, movimentações e inventário.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Controle de Estoque',
        tipo: 'pagina',
    }),
    criarPermissao('gerenciar-estoque', {
        label: 'Gerenciar estoque',
        descricao: 'Permite executar operações gerais de gestão do estoque.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Controle de Estoque',
        aba: 'Principal',
        tipo: 'acao',
    }),
    criarPermissao('gerenciar-fila-de-producao', {
        label: 'Gerenciar fila de produção',
        descricao: 'Permite alterar a fila e as promessas de produção do estoque.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Controle de Estoque',
        aba: 'Fila de Produção',
        tipo: 'acao',
    }),
    criarPermissao('anular-promessa-producao', {
        label: 'Anular promessa de produção',
        descricao: 'Permite retirar uma promessa de produção do saldo planejado.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Controle de Estoque',
        aba: 'Fila de Produção',
        tipo: 'acao',
    }),
    criarPermissao('gerenciar-niveis-alerta-estoque', {
        label: 'Gerenciar níveis de alerta de estoque',
        descricao: 'Permite configurar os limites usados nos alertas de estoque.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Controle de Estoque',
        aba: 'Configurações',
        tipo: 'acao',
    }),
    criarPermissao('arquivar-produto-do-estoque', {
        label: 'Arquivar produto do estoque',
        descricao: 'Permite arquivar um produto na área de estoque.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Controle de Estoque',
        aba: 'Produtos',
        tipo: 'acao',
    }),
    criarPermissao('editar-itens-arquivados', {
        label: 'Editar ou retirar itens arquivados',
        descricao: 'Permite alterar ou devolver itens que foram arquivados.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Controle de Estoque',
        aba: 'Arquivados',
        tipo: 'acao',
    }),
    criarPermissao('fazer-inventario', {
        label: 'Realizar inventário',
        descricao: 'Permite executar e confirmar um inventário de estoque.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Controle de Estoque',
        aba: 'Inventário',
        tipo: 'acao',
    }),
    criarPermissao('registrar-entrada-manual', {
        label: 'Registrar entrada manual',
        descricao: 'Permite lançar uma entrada manual no estoque.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Controle de Estoque',
        aba: 'Movimentações',
        tipo: 'acao',
    }),
    criarPermissao('registrar-saida-manual', {
        label: 'Registrar saída manual',
        descricao: 'Permite lançar uma saída manual no estoque.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Controle de Estoque',
        aba: 'Movimentações',
        tipo: 'acao',
    }),
    criarPermissao('registrar-devolucao', {
        label: 'Registrar devolução',
        descricao: 'Permite registrar a devolução de produtos ao estoque.',
        modulo: 'Embalagem e Estoque',
        pagina: 'Controle de Estoque',
        aba: 'Movimentações',
        tipo: 'acao',
    }),

    // ========================================================================
    // MÓDULO: FINANCEIRO
    // ========================================================================
    criarPermissao('acesso-financeiro', {
        label: 'Acessar página: Controle Financeiro',
        descricao: 'Permite abrir o módulo financeiro da empresa.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        tipo: 'pagina',
    }),
    criarPermissao('visualizar-financeiro', {
        label: 'Visualizar dashboard e extratos',
        descricao: 'Permite consultar indicadores, saldos e extratos financeiros.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        aba: 'Dashboard e Extratos',
        tipo: 'aba',
    }),
    criarPermissao('lancar-transacao', {
        label: 'Lançar receitas e despesas',
        descricao: 'Permite registrar novas receitas, despesas e lançamentos financeiros.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        aba: 'Lançamentos',
        tipo: 'acao',
    }),
    criarPermissao('importar-extrato', {
        label: 'Importar e conciliar extrato bancário',
        descricao: 'Permite importar extratos OFX e revisar sua conciliação.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        aba: 'Importação de Extratos',
        tipo: 'acao',
    }),
    criarPermissao('editar-transacao', {
        label: 'Editar lançamento financeiro',
        descricao: 'Permite alterar um lançamento financeiro existente.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        aba: 'Lançamentos',
        tipo: 'acao',
    }),
    criarPermissao('estornar-transacao', {
        label: 'Estornar lançamento financeiro',
        descricao: 'Permite estornar um lançamento financeiro já registrado.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        aba: 'Lançamentos',
        tipo: 'acao',
    }),
    criarPermissao('aprovar-pagamento', {
        label: 'Dar baixa em conta a pagar ou receber',
        descricao: 'Permite transformar uma previsão financeira em lançamento realizado.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        aba: 'Agenda',
        tipo: 'acao',
    }),
    criarPermissao('gerenciar-contas', {
        label: 'Criar e editar contas bancárias',
        descricao: 'Permite cadastrar e alterar contas bancárias da empresa.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        aba: 'Configurações',
        tipo: 'acao',
    }),
    criarPermissao('gerenciar-categorias', {
        label: 'Criar e editar categorias financeiras',
        descricao: 'Permite cadastrar e alterar categorias de receitas e despesas.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        aba: 'Configurações',
        tipo: 'acao',
    }),
    criarPermissao('criar-favorecido', {
        label: 'Cadastrar favorecido ou pagador',
        descricao: 'Permite cadastrar pessoas e empresas usadas nos lançamentos.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        aba: 'Lançamentos',
        tipo: 'acao',
    }),
    criarPermissao('aprovar-alteracao-financeira', {
        label: 'Aprovar alterações financeiras',
        descricao: 'Permite aprovar ou rejeitar edições e exclusões financeiras pendentes.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        aba: 'Aprovações',
        tipo: 'acao',
    }),
    criarPermissao('exibir-informacao-gerencial', {
        label: 'Visualizar informação gerencial',
        descricao: 'Permite ver informações gerenciais adicionais nos cards financeiros.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        aba: 'Lançamentos',
        tipo: 'bloco',
    }),
    criarPermissao('permite-excluir-agendamentos', {
        label: 'Excluir agendamentos',
        descricao: 'Permite excluir logicamente agendamentos e parcelas da Agenda.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        aba: 'Agenda',
        tipo: 'acao',
    }),
    criarPermissao('acesso-relatorios-financeiros', {
        label: 'Acessar aba: Relatórios Financeiros',
        descricao: 'Permite visualizar os relatórios financeiros da empresa.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        aba: 'Relatórios Financeiros',
        tipo: 'aba',
    }),
    criarPermissao('recuperar-agendamentos-deletados', {
        label: 'Recuperar agendamentos excluídos',
        descricao: 'Permite restaurar agendamentos ou lotes no Histórico da Agenda.',
        modulo: 'Financeiro',
        pagina: 'Controle Financeiro',
        aba: 'Histórico da Agenda',
        tipo: 'acao',
    }),

    // ========================================================================
    // MÓDULO: PAGAMENTOS, PONTO E INCENTIVOS
    // ========================================================================
    criarPermissao('acessar-central-pagamentos', {
        label: 'Acessar página: Central de Pagamentos',
        descricao: 'Permite abrir a central de pagamentos a empregados.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        pagina: 'Central de Pagamentos',
        tipo: 'pagina',
    }),
    criarPermissao('efetuar-pagamento-empregado', {
        label: 'Acessar aba: Pagamentos a Empregados',
        descricao: 'Permite consultar e operar pagamentos destinados aos empregados.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        pagina: 'Central de Pagamentos',
        aba: 'Pagamentos a Empregados',
        tipo: 'aba',
    }),
    criarPermissao('permitir-pagar-comissao', {
        label: 'Pagar comissões',
        descricao: 'Permite efetivar pagamentos de comissões.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        pagina: 'Central de Pagamentos',
        aba: 'Comissões',
        tipo: 'acao',
    }),
    criarPermissao('permitir-pagar-salarios', {
        label: 'Pagar salários',
        descricao: 'Permite efetivar pagamentos de salários.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        pagina: 'Central de Pagamentos',
        aba: 'Salários',
        tipo: 'acao',
    }),
    criarPermissao('permitir-pagar-beneficios', {
        label: 'Pagar benefícios',
        descricao: 'Permite efetivar pagamentos de benefícios aos empregados.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        pagina: 'Central de Pagamentos',
        aba: 'Benefícios',
        tipo: 'acao',
    }),
    criarPermissao('permitir-conceder-bonus', {
        label: 'Conceder bônus e premiações',
        descricao: 'Permite lançar bônus, premiações e outros incentivos.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        pagina: 'Central de Pagamentos',
        aba: 'Bônus e Premiações',
        tipo: 'acao',
    }),
    criarPermissao('permitir-pagar-passagens', {
        label: 'Pagar vales-transporte',
        descricao: 'Permite efetivar pagamentos de passagens e vales-transporte.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        pagina: 'Central de Pagamentos',
        aba: 'Vale-transporte',
        tipo: 'acao',
    }),
    criarPermissao('ajustar-consumo-vt', {
        label: 'Ajustar consumo de vale-transporte',
        descricao: 'Permite corrigir consumo de passagem por carona ou retroativo.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        pagina: 'Central de Pagamentos',
        aba: 'Vale-transporte',
        tipo: 'acao',
    }),
    criarPermissao('gerenciar-taxas-vt', {
        label: 'Gerenciar concessionárias e taxas de VT',
        descricao: 'Permite configurar concessionárias e taxas de vale-transporte.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        pagina: 'Central de Pagamentos',
        aba: 'Vale-transporte',
        tipo: 'acao',
    }),
    criarPermissao('acesso-ponto-por-processo', {
        label: 'Acessar página: Centro de Incentivos',
        descricao: 'Permite abrir a página de pontos, metas, gincanas e premiações.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        pagina: 'Centro de Incentivos',
        tipo: 'pagina',
    }),
    criarPermissao('gerenciar-gincanas', {
        label: 'Criar e publicar gincanas',
        descricao: 'Permite criar, editar e publicar gincanas de incentivo.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        pagina: 'Centro de Incentivos',
        aba: 'Gincanas',
        tipo: 'acao',
    }),
    criarPermissao('gerenciar-metas-incentivos', {
        label: 'Gerenciar metas e comissões',
        descricao: 'Permite criar versões e editar regras de metas e comissões.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        pagina: 'Centro de Incentivos',
        aba: 'Metas e Comissões',
        tipo: 'acao',
    }),
    criarPermissao('gerenciar-pontos-atividade', {
        label: 'Gerenciar pontos por atividade',
        descricao: 'Permite cadastrar, editar, ativar e excluir pontos padrão por atividade.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        pagina: 'Centro de Incentivos',
        aba: 'Pontos por Atividade',
        tipo: 'acao',
    }),
    criarPermissao('pagar-premiacoes-gincanas', {
        label: 'Pagar premiações de gincanas',
        descricao: 'Permite consultar a fila e marcar premiações de gincanas como pagas.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        pagina: 'Centro de Incentivos',
        aba: 'Pagamentos',
        tipo: 'acao',
    }),

    // ========================================================================
    // MÓDULO: COMUNICAÇÕES E ALERTAS
    // ========================================================================
    criarPermissao('configurar-alertas', {
        label: 'Acessar página: Central de Alertas',
        descricao: 'Permite abrir a página de configurações de alertas da empresa.',
        modulo: 'Comunicações e Alertas',
        pagina: 'Central de Alertas',
        tipo: 'pagina',
    }),
    criarPermissao('salvar-alteracoes-de-alertas', {
        label: 'Salvar alterações de alertas',
        descricao: 'Permite salvar as configurações da aba Alertas Gerais.',
        modulo: 'Comunicações e Alertas',
        pagina: 'Central de Alertas',
        aba: 'Alertas Gerais',
        tipo: 'acao',
    }),
    criarPermissao('criar-novo-aviso', {
        label: 'Criar novo aviso popup',
        descricao: 'Permite criar e publicar um novo aviso popup na Central de Alertas.',
        modulo: 'Comunicações e Alertas',
        pagina: 'Central de Alertas',
        aba: 'Avisos Popups',
        tipo: 'acao',
    }),
    criarPermissao('editar-aviso', {
        label: 'Editar aviso popup',
        descricao: 'Permite editar um aviso popup existente na Central de Alertas.',
        modulo: 'Comunicações e Alertas',
        pagina: 'Central de Alertas',
        aba: 'Avisos Popups',
        tipo: 'acao',
    }),
    criarPermissao('reaproveitar-aviso', {
        label: 'Reaproveitar aviso popup',
        descricao: 'Permite usar um aviso popup existente como base para um novo aviso.',
        modulo: 'Comunicações e Alertas',
        pagina: 'Central de Alertas',
        aba: 'Avisos Popups',
        tipo: 'acao',
    }),
    criarPermissao('excluir-aviso', {
        label: 'Excluir aviso popup',
        descricao: 'Permite excluir permanentemente um aviso popup da Central de Alertas.',
        modulo: 'Comunicações e Alertas',
        pagina: 'Central de Alertas',
        aba: 'Avisos Popups',
        tipo: 'acao',
    }),
    criarPermissao('arquivar-aviso', {
        label: 'Arquivar aviso popup',
        descricao: 'Permite arquivar um aviso popup ativo na Central de Alertas.',
        modulo: 'Comunicações e Alertas',
        pagina: 'Central de Alertas',
        aba: 'Avisos Popups',
        tipo: 'acao',
    }),

    // ========================================================================
    // MÓDULO: CALENDÁRIO
    // ========================================================================
    criarPermissao('acesso-calendario', {
        label: 'Acessar página: Calendário da Empresa',
        descricao: 'Permite abrir o calendário de feriados, folgas e eventos da empresa.',
        modulo: 'Calendário',
        pagina: 'Calendário da Empresa',
        tipo: 'pagina',
    }),
    criarPermissao('criar-novo-evento', {
        label: 'Criar novo evento',
        descricao: 'Permite criar eventos no Calendário da Empresa.',
        modulo: 'Calendário',
        pagina: 'Calendário da Empresa',
        aba: 'Principal',
        tipo: 'acao',
    }),
    criarPermissao('editar-evento', {
        label: 'Editar evento',
        descricao: 'Permite editar um evento existente no Calendário da Empresa.',
        modulo: 'Calendário',
        pagina: 'Calendário da Empresa',
        aba: 'Principal',
        tipo: 'acao',
    }),
    criarPermissao('deletar-evento', {
        label: 'Deletar evento',
        descricao: 'Permite deletar um evento do Calendário da Empresa.',
        modulo: 'Calendário',
        pagina: 'Calendário da Empresa',
        aba: 'Principal',
        tipo: 'acao',
    }),

    // ========================================================================
    // MÓDULO: PRODUÇÃO GERAL
    // ========================================================================
    criarPermissao('acesso-producao-geral', {
        label: 'Acessar página: Produção Geral',
        descricao: 'Permite abrir a visão geral da produção dos empregados.',
        modulo: 'Produção Geral',
        pagina: 'Produção Geral',
        tipo: 'pagina',
    }),
    criarPermissao('cancelar-pontos-extras', {
        label: 'Cancelar pontos extras',
        descricao: 'Permite cancelar pontos extras lançados para um empregado.',
        modulo: 'Produção Geral',
        pagina: 'Produção Geral',
        aba: 'Pontos Extras',
        tipo: 'acao',
    }),

    // ========================================================================
    // ALIAS DE COMPATIBILIDADE E IDS NAO EXISTENTES
    //
    // Estes IDs foram encontrados no catálogo, mas não possuem referência fora
    // de permissoes.js em public/src, public/js ou api na auditoria de
    // 2026-08-09. Eles continuam válidos e não foram excluídos. A classificação
    // é apenas informativa até decisão posterior sobre cada ID.
    // ========================================================================
    criarPermissao('acesso-home', {
        label: 'Acessar página: Home Administrativa',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Acesso Geral',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Home Administrativa',
        tipo: 'pagina',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('acesso-desempenho', {
        label: 'Acessar página: Meu Desempenho',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Dashboards e Desempenho',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Meu Desempenho',
        tipo: 'pagina',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('ver-proprios-arremates', {
        label: 'Visualizar os próprios arremates',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Dashboards e Desempenho',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Dashboard de Produção',
        aba: 'Meus arremates',
        tipo: 'escopo',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('acesso-cadastrar-usuario', {
        label: 'Acessar página: Cadastro de Usuário',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Pessoas e Gestão Organizacional',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Cadastro de Usuário',
        tipo: 'pagina',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('cadastrar-produto', {
        label: 'Cadastrar produto',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Produtos e Catálogo',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Cadastro de Produtos',
        aba: 'Principal',
        tipo: 'acao',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao(PERMISSAO_AUDITORIA_GESTAO_LEGADA, {
        label: 'Acessar aba: Auditoria de Permissões (legado)',
        descricao: 'Alias técnico preservado para compatibilidade com acessos legados à Auditoria.',
        modulo: 'Pessoas e Gestão Organizacional',
        categoria: 'Compatibilidade',
        pagina: 'Gestão Organizacional',
        aba: 'Auditoria',
        tipo: 'aba',
        somenteCompatibilidade: true,
    }),
    criarPermissao('lancar-embalagem-unidade', {
        label: 'Registrar embalagem de unidade',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Embalagem e Estoque',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Embalagem de Produtos',
        aba: 'Principal',
        tipo: 'acao',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('montar-kit', {
        label: 'Montar ou desmontar kit',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Embalagem e Estoque',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Controle de Estoque',
        aba: 'Kits',
        tipo: 'acao',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('ajustar-saldo', {
        label: 'Ajustar saldo de estoque',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Embalagem e Estoque',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Controle de Estoque',
        aba: 'Movimentações',
        tipo: 'acao',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('visualizar-relatorios', {
        label: 'Gerar relatórios financeiros',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Financeiro',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Controle Financeiro',
        aba: 'Relatórios Financeiros',
        tipo: 'aba',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('acesso-precificacao', {
        label: 'Acessar página: Precificação',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Financeiro',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Precificação',
        tipo: 'pagina',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('acesso-relatorio-de-comissao', {
        label: 'Acessar página: Relatório de Comissão',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Financeiro',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Relatório de Comissão',
        tipo: 'pagina',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('acesso-conferencia-e-auditoria', {
        label: 'Acessar página: Conferência e Auditoria',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Financeiro',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Conferência e Auditoria',
        tipo: 'pagina',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('acesso-producao-geral-costura', {
        label: 'Acessar página: Produção Geral de Costura',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Financeiro',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Produção Geral de Costura',
        tipo: 'pagina',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('gerenciar-precificacao', {
        label: 'Editar configurações de precificação',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Financeiro',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Precificação',
        aba: 'Principal',
        tipo: 'acao',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('confirmar-pagamento-comissao', {
        label: 'Marcar comissões como pagas',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Financeiro',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Relatório de Comissão',
        aba: 'Comissões',
        tipo: 'acao',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('permitir-lancar-falta-nao-justificada', {
        label: 'Lançar falta não justificada',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Calendário da Empresa',
        aba: 'Principal',
        tipo: 'acao',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('permitir-estornar-passagens', {
        label: 'Estornar pagamento de passagens',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Pagamentos, Ponto e Incentivos',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Central de Pagamentos',
        aba: 'Vale-transporte',
        tipo: 'acao',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('gerenciar-comunicacoes', {
        label: 'Acessar página: Gerenciar Comunicações',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Comunicações e Alertas',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Gerenciar Comunicações',
        tipo: 'pagina',
        status: 'nao-existe-no-codigo',
    }),
    criarPermissao('gerenciar-avisos-popup', {
        label: 'Gerenciar avisos popup',
        descricao: 'ID preservado; nenhuma referência foi encontrada fora deste catálogo.',
        modulo: 'Comunicações e Alertas',
        categoria: 'NAO EXISTEM NO CODIGO',
        pagina: 'Central de Alertas',
        aba: 'Avisos Popup',
        tipo: 'acao',
        status: 'nao-existe-no-codigo',
    }),
];

export const permissoesNaoExistemNoCodigo = Object.freeze(
    permissoesDisponiveis
        .filter((permissao) => permissao.status === 'nao-existe-no-codigo')
        .map((permissao) => permissao.id)
);

export const permissoesCatalogoVisivel = permissoesDisponiveis.filter(
    (permissao) => !permissao.somenteCompatibilidade
);

// ============================================================================
// PERMISSÕES PADRÃO POR TIPO DE USUÁRIO
// ============================================================================

export const permissoesPorTipo = {
    costureira: [
        'ver-lista-produtos',
        'acesso-dashboard',
        'ver-proprias-producoes',
    ],
    tiktik: [
        'ver-lista-produtos',
        'acesso-dashboard',
        'ver-proprias-producoes',
        'assinar-producao-tiktik',
        'assinar-arremate-tiktik',
        'ver-proprios-arremates',
    ],
    cortador: [],

    lider_setor: [
        'acesso-admin-geral',
        'acesso-home',
        'acesso-ordens-de-producao',
        'acesso-ordens-de-arremates',
        'acesso-estoque',
    ],
    supervisor: [
        'acesso-admin-geral',
        'acesso-home',
        'acesso-gestao-organizacional',
        'visualizar-empresas',
        'acesso-ordens-de-producao',
        'acesso-ordens-de-arremates',
        'acesso-estoque',
    ],

    // Administradores recebem o catálogo visível completo. O alias técnico
    // da auditoria continua fora da seleção manual, mas segue válido para
    // compatibilidade de dados antigos.
    admin: permissoesCatalogoVisivel.map((permissao) => permissao.id),
};

// ============================================================================
// ESTRUTURA CATEGORIZADA PARA O FRONTEND
// ============================================================================

export const permissoesCategorizadas = permissoesCatalogoVisivel.reduce((acc, permissao) => {
    const categoria = permissao.categoria || 'Outras';
    if (!acc[categoria]) acc[categoria] = [];
    acc[categoria].push(permissao);
    return acc;
}, {});

export const permissoesValidas = new Set(permissoesDisponiveis.map((permissao) => permissao.id));
