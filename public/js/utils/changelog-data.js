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
        versao: '1.43.4',
        versao_dashboard: '1.31.2',
        data: '05/08/2026',
        admin: [],
        dashboard: [
            'Correção de Bugs',
        ],
    },
    {
        versao: '1.43.3',
        versao_dashboard: '1.31.1',
        data: '03/08/2026',
        admin: [],
        dashboard: [
            'O card decorado de celebração voltou a aparecer para a maior meta atingida, com mensagem, emoji e confetes sem acumular níveis',
            'O aviso de pontos restantes agora acompanha corretamente a meta selecionada entre Bronze, Prata e Ouro',
        ],
    },
    {
        versao: '1.43.2',
        versao_dashboard: '1.31.0',
        data: '03/08/2026',
        admin: [],
        dashboard: [
            'Seu foco de hoje agora reconhece automaticamente a maior meta alcançada e mostra o próximo nível a perseguir',
            'A barra de progresso acompanha a cor da meta selecionada, com gradientes próprios para Bronze, Prata e Ouro',
            'Cada meta ganhou uma celebração visual com emoji, confetes e mensagem personalizada; o Ouro tem uma festa especial com glitters',
            'O bloco de potencial ficou mais inteligente: mostra o valor garantido e o caminho até o Ouro sem repetir o saldo de pontos',
            'Depois de conquistar o Ouro, o fill dourado e os glitters permanecem mesmo que outra meta seja selecionada',
        ],
    },
    {
        versao: '1.43.1',
        versao_dashboard: '1.30.1',
        data: '03/08/2026',
        admin: [],
        dashboard: [
            'A tela inicial carrega de uma vez: empresa, status ao vivo, Meu cartão VT e ranking não “piscam” mais depois dos outros blocos',
        ],
    },
    {
        versao: '1.43.0',
        versao_dashboard: '1.30.0',
        data: '03/08/2026',
        admin: [
            'Cartão VT na Central de Pagamentos: painel de saldo, extrato, definir saldo do cartão e ajuste de consumo (carona / ida-volta) com justificativas e teto de 60 dias',
            'Nova permissão: Ajustar consumo de passagem (VT) — carona / retroativo',
            'Motor de saldo VT: recargas provisionadas (48h), consumo por jornada (E1 soft / S3+1h real), transferência por falta e isolamento por empresa',
            'Calendário: Falta Individual substituída por Falta justificada e Falta injustificada (impactam o VT)',
            'Previsão de pagamento de comissões: 1 dia útil após o 5º dia útil (seg–sáb, calendário da empresa) — salário permanece no 5º dia útil',
        ],
        dashboard: [
            'Novo bloco Meu cartão VT no menu (acima do ranking): veja o saldo da passagem e quanto ainda dá para ir e voltar',
            'Durante o dia, se a ida já contou, o valor do cartão aparece riscado e ao lado o disponível agora (estilo banco)',
            'Na carteira (Comissões), a data de recebimento aparece como Previsão e pode ser antecipada pela empresa',
            'Menu da dashboard no PC: removida a marca fixa; avatar e espaçamento da página corrigidos',
        ],
    },
    {
        versao: '1.42.0',
        versao_dashboard: '1.29.0',
        data: '01/08/2026',
        admin: [
            'Central de Pagamentos reforçada em TypeScript, com abas de comissão, salário, benefícios e passagem mais claras e seguras',
            'Comissão: competências em cards, sem trava artificial de data, status sem comissão e mês previsto de pagamento em destaque',
            'Recibos semanais: badge de pendências, histórico de semanas fechadas e corte a partir de 08/03/2026',
            'Passagem (VT): layout tablet-first, calendário sincronizado, confirmação detalhada do lote e lançamento simples (1 pessoa) ou rateio Diversos (2+)',
            'Após recarga de VT, cada empregada recebe aviso popup individual com o modelo Recarga VT (imagem + detalhes)',
            'Salário e VA com referências mensais, status em aberto / a pagar / pendente / pago; VA no dia 25 ou próximo útil pelo calendário da empresa',
            'Central de Alertas entende avisos individuais do Financeiro e mostra o nome da pessoa ao editar',
        ],
        dashboard: [
            'Quando o VT for recarregado, você recebe um aviso na hora com os dias e o valor da recarga',
            'O aviso usa o visual oficial de Recarga VT e aparece só para quem recebeu a recarga',
        ],
    },
    {
        versao: '1.41.0',
        versao_dashboard: '1.28.0',
        data: '01/08/2026',
        admin: [],
        dashboard: [
            'A tela inicial foi totalmente redesenhada para celular e tablet, com menu lateral, navegação mais clara e hambúrguer sempre acessível',
            'Seu foco diário agora destaca a meta escolhida, o ritmo do ciclo e quanto ainda falta para avançar',
            'Bronze, Prata e Ouro ganharam cores próprias e pequenas celebrações animadas ao serem selecionados',
            'Atividades recentes agora aparecem em uma linha do tempo com filtros, paginação padrão e pontos de cada etapa em destaque',
            'O ranking foi levado para o menu lateral e passou a mostrar a posição completa dos participantes de forma organizada',
            'Minha tabela de pontos ganhou uma nova visualização, mais clara e confortável para consultar produtos, etapas e pontos',
            'O status de produção agora aparece em um resumo vivo na saudação e abre um painel completo com produção, pausas, folgas e próximas tarefas',
        ],
    },
    {
        versao: '1.40.4',
        data: '29/07/2026',
        admin: [
            'Corrigido o botão do menu no Financeiro após trocar de empresa: o hamburger permanece funcional e não é mais substituído por um ícone de fechar',
        ],
        dashboard: [],
    },
    {
        versao: '1.40.3',
        data: '29/07/2026',
        admin: [
            'A troca de empresa no Financeiro agora atualiza token, contexto e dados no mesmo documento, eliminando o intervalo sem pintura causado pelo recarregamento da página',
            'O seletor fecha ao confirmar a troca; preferências universais continuam disponíveis em todas as empresas, enquanto páginas de módulos não liberados exibem o bloqueio correspondente',
        ],
        dashboard: [],
    },
    {
        versao: '1.40.2',
        data: '29/07/2026',
        admin: [
            'A troca de empresa no Financeiro agora mantém a animação visível continuamente até o novo ambiente ficar pronto, sem intervalo vazio',
        ],
        dashboard: [],
    },
    {
        versao: '1.40.1',
        data: '29/07/2026',
        admin: [
            'Carregamento inicial do Financeiro agora usa a identidade visual padrão do sistema, sem o spinner legado',
            'Troca de empresa no Financeiro ganhou uma transição contínua, sem spinner intermediário ou exibição prematura da interface',
        ],
        dashboard: [],
    },
    {
        versao: '1.40.0',
        versao_dashboard: '1.27.0',
        data: '29/07/2026',
        admin: [
            'Menu lateral totalmente redesenhado em React e TypeScript, com navegação tablet-first, acessível e preparada para múltiplas empresas',
            'Áreas favoritas agora podem ser adicionadas, removidas e reorganizadas, com preferências independentes por usuário e empresa',
            'Empresa ativa ganhou mais destaque, seletor responsivo e uma nova animação de contexto durante a troca entre organizações',
            'Novidades do sistema ganharam destaque no rodapé do menu, com contador de itens não lidos e histórico de versões',
            'Novo estúdio de foto compartilhado pelo painel administrativo e pela Dashboard, com recorte, zoom, rotação, compressão e prévias antes do envio',
            'Carregamentos do sistema receberam uma nova identidade visual contextual, usando as iniciais e a cor da empresa ativa',
        ],
        dashboard: [
            'Sua foto de perfil ganhou um novo estúdio: agora você pode recortar, reposicionar, ampliar e conferir a imagem antes de salvar',
        ],
    },
    {
        versao: '1.39.0',
        data: '29/07/2026',
        admin: [
            'Financeiro ganhou um novo compositor de lançamentos, com escolhas claras entre Paguei, Recebi e Transferi e o mesmo fluxo para lançamentos e agendamentos',
            'Campos extensos de conta, categoria e favorecido ou pagador agora usam buscas inteligentes, sugestões pelo histórico e descrições automáticas editáveis',
            'Compra detalhada, rateio, transferência, parcelamento, edição e baixa foram reorganizados com resumos de conferência mais claros e layout tablet-first',
            'Agenda aprimorada com identificação visual de vencimentos, exclusão recuperável de lotes e parcelas e novo histórico protegido por permissões',
            'Transferência entre empresas ganhou um caminho visual preparado e bloqueado para implementação futura, sem permitir movimentações entre organizações nesta versão',
        ],
        dashboard: [],
    },
    {
        versao: '1.38.0',
        versao_dashboard: '1.26.0',
        data: '29/07/2026',
        admin: [
            'Financeiro multiempresa concluído: lançamentos, agenda, contas, categorias, contatos, configurações, relatórios e auditoria agora respeitam integralmente a empresa ativa',
            'Neila Confecções liberada para operar o Financeiro com dados próprios e totalmente separados da Lojas Variara',
            'Troca de empresa validada nos dois sentidos, preservando os dados de cada organização sem resíduos da empresa anterior',
            'Agentes globais de Ordens de Produção deixaram de consultar módulos ainda indisponíveis para empresas secundárias',
        ],
        dashboard: [
            'A tela de entrada ganhou um novo visual, mais claro e adaptado para celulares e tablets',
        ],
    },
    {
        versao: '1.37.0',
        data: '28/07/2026',
        admin: [
            'Tela de login completamente redesenhada, com nova identidade visual responsiva para computadores, tablets e celulares',
            'Sessões agora permanecem válidas por 30 dias por padrão, inclusive após a troca da empresa ativa',
            'Gestão Organizacional aprimorada com cards mais completos e edição unificada dos dados pessoais e do vínculo empresarial',
            'Sócios, empregados e prestadores externos agora possuem campos, remunerações e encerramentos de vínculo adequados a cada relação',
            'Novos vínculos podem copiar todas ou apenas algumas permissões de outra empresa, de forma totalmente opcional',
            'Cadastro de empresas ganhou código interno automático e os indicadores de membros passaram a desconsiderar contas de teste e arquivadas',
        ],
        dashboard: [],
    },
    {
        versao: '1.36.0',
        data: '28/07/2026',
        admin: [
            'Sistema preparado para operar com múltiplas empresas, com contexto empresarial seguro e seletor universal no menu',
            'Nova página "Gestão Organizacional", reunindo as abas "Pessoas e Acessos" e "Empresas"',
            'Agora uma pessoa pode possuir vínculos, funções e permissões diferentes em uma ou mais empresas, mantendo um único login',
            'Novo cadastro de empresas com perfil organizacional, identidade visual, dados fiscais e configuração de módulos disponíveis',
        ],
        dashboard: [],
    },
    {
        versao: '1.35.0',
        data: '27/05/2026',
        admin: [
            'Página "Gerenciar Produção" totalmente reconstruída em React',
            'Abas sempre visíveis — aba de Aprovações usa cadeado de permissão (UIBloqueio) em vez de sumir',
            'Correção: bug antigo no DELETE de produção que retornava 500 por comparação de tipo incorreta',
        ],
        dashboard: [],
    },
    {
        versao: '1.34.0',
        versao_dashboard: '1.25.0',
        data: '26/05/2026',
        admin: [
            'Repadronizacao dos popups do fluxo de jornada de trabalho dos empregados',
            'Ajuste do bug que nao permitia cancelar tarefa atribuida',
            'Novas permissoes inseridas para cancelar tarefa e finalizar tarefa',
            'Ajuste do bug que impedia lancar producao para P.Externo',
            'Acoes sao registradas na aba auditoria, da pagina de permissao de usuarios'

        ],
        dashboard: [
            // Vazio — esta atualização não afeta a dahsboard
        ],
    },
    {
        versao: '1.33.0',
        versao_dashboard: '1.25.0',
        data: '25/05/2026',
        admin: [
            // Vazio — esta atualização não afeta a area admin
        ],
        dashboard: [
            'Ajuste na wallet, que agora aparece o próximo pagamento do ciclo atual (se fechado)'
        ],
    },

    {
        versao: '1.33.0',
        versao_dashboard: '1.24.0',
        data: '24/05/2026',
        admin: [
            'Redesign da pagina de permissoes de usuarios. Agora tb filtra e nao exibe ex-empregados.',
            'Bugs ajustados na aba "auditoria", como o bug que nao registrava os logs de todos os usuarios',
            'Redesign na pagina de usuarios cadastrados. Nova badge para "prestador_externo".',
        ],
        dashboard: [
            'Novo visual do perfil: foto, sequencia de producao, conquistas e gincanas ganhas no ciclo',
            'Carteira redesenhada: ver saldo de comissoes e premiacoes separados em destaque',
            'Card de ranking com podio dos top 3 e mensagem motivacional',
            'Botoes do topo reorganizados com visual mais moderno',
        ],
    },
    
    {
        versao: '1.32.0',
        versao_dashboard: '1.23.0',
        data: '22/05/2026',
        admin: [
            'Redesign dos cards de gincana, redesign completo do wizard de criacao de gincanas',
            'Implementado novo padrao de permissoes do sistema, comecando pela pagina de OPS',
            
        ],
        dashboard: [
            'Redesign do modal de gincanas com destaque no valor do premio',
            'Correcao de bugs menores'
        ],
    },

    {
        versao: '1.31.1',
        data: '21/05/2026',
        admin: [
            'O agente de Encerramento de OPs agora busca ops com mais de 3h aguardando encerramento e nao a todo momento, assim que a OP fica disponivel para ser encerrada'
        ],
        dashboard: [
            // Vazio — esta atualização não afeta as funcionárias
        ],
    },
    {
        versao: '1.31.1',
        data: '21/05/2026',
        admin: [
            'O agente de Encerramento de OPs agora busca ops com mais de 3h aguardando encerramento e nao a todo momento, assim que a OP fica disponivel para ser encerrada'
        ],
        dashboard: [
            // Vazio — esta atualização não afeta as funcionárias
        ],
    },
    
    {
        versao: '1.31.0',
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
