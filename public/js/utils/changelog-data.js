// /js/utils/changelog-data.js
//
// Fonte de verdade das notas de versão do Sistema LV.
// Cada entrada tem duas seções:
//   admin         → novidades para quem gerencia o sistema
//   dashboard     → novidades para os funcionários (linguagem simples)
//   versao_dashboard (opcional) → versão independente exibida na dashboard
//
// Versões são INDEPENDENTES por audiência:
//   - Admin usa 'versao' (vem do package.json via npm version patch/minor/major)
//   - Dashboard usa 'versao_dashboard' quando presente, ou cai em 'versao' como fallback
//   - Só preencher 'versao_dashboard' quando dashboard[] não estiver vazio
//   - Incrementar versao_dashboard manualmente (ex: 1.21 → 1.22) sem se preocupar com o número do admin
//
// Ao fazer um release:
//   1. Adicione uma nova entrada no INÍCIO do array
//   2. Preencha admin e/ou dashboard conforme o que mudou
//   3. Deixe vazio [] se a versão não teve mudanças para aquela audiência
//   4. Se dashboard[] não estiver vazio, adicione versao_dashboard com o próximo número da sequência da dashboard

export const changelog = [
    {
        versao: '1.31',
        data: '21/05/2026',
        admin: [
            'Novo agente interceptador de OPS. Agora existe a obrigatoriedade de encerrar as OPs em aberto, principalmente OPs com muitas horas após todas as etapas de producao atribuidas/realizadas.',
            'Removido filtro "Em aberto" da aba OPs. Filtro nao tinha usabilidade. Agora as ops finalizadas sao exibidas da mais recente para a mais antiga.'
        ],
        dashboard: [
            // Vazio — esta atualização não afeta as funcionárias
        ],
    },
    {
        versao: '1.30.1',
        data: '20/05/2026',
        admin: [
            'Ajustado bug ao atribuir tarefas/lancar producoes para prestador externo'
        ],
        dashboard: [
            // Vazio — esta atualização não afeta as funcionárias
        ],
    },
    {
        versao: '1.30.0',
        versao_dashboard: '1.22.0',
        data: '20/05/2026',
        admin: [
            'Novo sistema de gincanas e disparo de avisos popup 100% configuráveis',
            'Gincanas podem acontecer a qualquer hora do dia de trabalho, entre gincana de equipes, individuais, do tipo "race" etc...'
        ],
        dashboard: [
            'Novo Sistema de Gincanas no ar',
            'Redesign de algumas areas da dashboard',
            'Sistema de Alertas Popup funcionando'
        ],
    },
    {
        versao: '1.29.0',
        data: '16/05/2026',
        admin: [
            'Redesenhado agente do sistema. Já esta presente em: OPs, cortes (PG ordens de producao) e no painel de demandas',
            'Nova forma de registrar cortes avulsos no sistema. Redesign feito.',
            'Painel de demanda reajustado para receber o agente do sistema'
        ],
        dashboard: [
            // Vazio — esta atualização não afeta as funcionárias
        ],
    },
    {
        versao: '1.28.0',
        data: '14/05/2026',
        admin: [
            'Tela de arremates completamente refeita. Pendente testes exaustivos'
        ],
        dashboard: [
            // Vazio — esta atualização não afeta as funcionárias
        ],
    },
    {
        versao: '1.27.1',
        data: '11/05/2026',
        admin: [
            'Bug de renderizacao do bloco de agente de cortes resolvido'
        ],
        dashboard: [
            // Vazio — esta atualização não afeta as funcionárias
        ],
    },
    {
        versao: '1.27.0',
        data: '11/05/2026',
        admin: [
            'Correçäo de bug/desvinculo entre um corte (gerar op a partir do estoque) e uma demanda criada (painel de demandas)',
            'Cards do estoque de cortes agora exibe se o corte pode ser/estar vinculado a uma demanda',
            'Lógica aprimorada na criacao de demandas. Agora, ao tentar criar uma demanda ja existente em algum lugar do fluxo, o sistema exibe onde essa demanda está, orientando o usuario a como prosseguir e qual opcao escolher',
            
        ],
        dashboard: [
            // Vazio — esta atualização não afeta as funcionárias
        ],
    },

    {
        versao: '1.26.0',
        data: '06/05/2026',
        admin: [
            'Ajustes finos de design na aba de "Cortes" da página de OPS',
            'Sistema de cortes e ops busca as informacoes automaticamente',
            'Ao realizar gerar uma OP a partir da aba de cortes, o sistema verifica se existe demanda para o produto, e se tiver mantem o vinculo automaticamente'
            
        ],
        dashboard: [
            // Vazio — esta atualização não afeta as funcionárias
        ],
    },
    {
        versao: '1.25.0',
        data: '05/05/2026',
        admin: [
            'Quantidade de peças já cortadas agora sao exibidas no card de demanda (Painel de Demandas)',
            'Ajustes de interface e "integracao" entre o modo lote e modo simples de atribuir tarefas da pagina de arremates',
            
        ],
        dashboard: [
            // Vazio — esta atualização não afeta as funcionárias
        ],
    },
    {
        versao: '1.24.0',
        data: '04/05/2026',
        admin: [
            'Redesign inicial da pagina de arremates implementado, espelho da pagina de OPS',
            'Ajustes pequenos no painel de demandas, incluindo telas de transicao ao criar uma OP',
            'Implementado logica de prestador externo para arremates, funciona bem',
            
        ],
        dashboard: [
            // Vazio — esta atualização não afeta as funcionárias
        ],
    },

    {
        versao: '1.23.0',
        data: '03/05/2026',
        admin: [
            'Painel de demandas completamente redesenhado',
            '"Modo IA" implementado em algumas areas',
            'Nova tela de carregamento padrao do sistema',
            'Ajustes finais de design na pagina de ordens de producao',
            'Modo avançado de cortes foi reimplementado com busca inteligente',
        ],
        dashboard: [
            // Vazio — esta atualização não afeta as funcionárias
        ],
    },


    {
        versao: '1.22.0',
        data: '02/05/2026',
        admin: [
            'Agora é possível unificar tarefas atribuidas em ordens de producao e lancar tarefas no mesmo "bloco". ',
            'O sistema reconhece finais de semana, e entende que após o horario de trabalho qualquer lancamento será "hora extra"', 
            'Ajustes na logica das bordas do cards da aba "OPs" da pagina ordens de producao', 
            'Cronometro agora "reseta/reinicia" quando troca de tarefa em um lote de tarefas', 
            'Após cancelar a sessão atual, verifica se há sessões restantes. Se sim atualiza, se nao libera pra LIVRE'
        ],
        dashboard: [
            // Vazio — esta atualização não afeta as funcionárias
        ],
    },

    {
        versao: '1.21.1',
        data: '01/05/2026',
        admin: [
            'Ambiente de staging configurado para testes seguros antes de ir à produção',
        ],
        dashboard: [
            // Vazio — esta atualização não afeta as funcionárias
        ],
    },
    
    {
        versao: '1.21.0',
        versao_dashboard: '1.21.0',
        data: '01/05/2026',
        admin: [
            'Versionamento semântico implementado — versão agora aparece no menu e segue o padrão SemVer',
            'Tela de Acesso Negado redesenhada e corrigida (agora desloga corretamente)',
            'Usuário de teste criado para desenvolvimento da dashboard sem usar senha real',
            'Notas de versão disponíveis agora — clique na versão para ver o que mudou',
        ],
        dashboard: [
            'Versão do sistema agora aparece na tela',
            'Clique na versão para ver as novidades de cada atualização',
        ],
    },


    // Template para próximas versões:
    // {
    //     versao: 'X.Y.Z',           ← vem do npm version (package.json) — só admin
    //     versao_dashboard: 'A.B.C', ← só quando dashboard[] não estiver vazio; incrementar manualmente
    //     data: 'DD/MM/AAAA',
    //     admin: [],
    //     dashboard: [],
    // },
];
