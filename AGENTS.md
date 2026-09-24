# AGENTS.md — Sistema LV

Este arquivo é lido automaticamente pelo Codex ao iniciar. Contém o contexto permanente do projeto: stack, arquitetura, padrões e regras de negócio. **Sempre atualize este arquivo quando uma nova decisão importante for tomada.**

---

## Visão Geral do Projeto

### Provisionamento do catalogo de processos — decisao aprovada em 2026-08-08

- O catalogo empresarial de processos e provisionado pela funcao SQL
  `public.provisionar_processos_producao_empresa(integer)`.
- A criacao de qualquer nova empresa chama o provisionador na mesma transacao
  do cadastro. Isso atende a terceira, quarta e demais empresas sem copiar
  produtos ou dados de outra empresa.
- O provisionamento e idempotente e usa `ON CONFLICT DO NOTHING`: nao
  sobrescreve nomes personalizados nem duplica processos.
- A migration `_planejamento/migration-processos-producao-provisionamento-v2.sql`
  deve ser executada apos a migration v1. Durante a janela entre deploy e
  migration, o backend detecta a ausencia da funcao e preserva compatibilidade.
- As migrations `processos-producao-catalogo-v1` e
  `processos-producao-provisionamento-v2` foram executadas e validadas na Neon
  em 2026-08-08. Os marcadores registrados foram `2026-08-08
  21:12:21.308653-03` e `2026-08-08 21:13:39.514808-03`, respectivamente.
- Inclusoes futuras no conjunto padrao devem entrar em nova migration, que
  atualiza a funcao e a executa para as empresas existentes; novas empresas
  passam a recebe-las automaticamente.
- A auditoria read-only da receita executada na Neon em 2026-08-08 encontrou,
  na empresa 1, 8 produtos e 30 etapas com `processo_id` valido; apenas 4
  etapas ja possuem `id`, fase validada e `feitoPor` como array. A empresa 2
  ainda nao possui produtos, conforme esperado no inicio da migracao. As 26
  etapas restantes exigem saneamento funcional antes do gate da receita
  canonica; nenhuma classificacao de fase deve ser inferida silenciosamente.
- O servidor Express local tambem deve montar `/api/processos-producao`, assim
  como o entrypoint serverless em `api/index.js`. Sem essa montagem, o editor
  de produtos cai na lista legada de contingencia; a reconciliacao da etapa
  deve continuar aceitando tanto `processo_id` quanto nome para evitar que o
  select volte a exibir o placeholder em dados legados.
- Em 2026-08-08, o usuario revisou e salvou as etapas dos produtos pelo editor
  de Cadastros de Produtos. A configuracao salva e a autoridade para fase e
  `feitoPor`; nenhuma migration de saneamento pode substituir esses valores.
  A matriz `_planejamento/matriz-classificacao-etapas-fase1.md` e apenas uma
  proposta anterior e nao deve ser aplicada.
- A semantica correta da fase e: `OP` sao os processos internos da ordem de
  producao; `POS_OP` e o arremate/acabamento feito depois do encerramento da OP
  e antes da embalagem. `POS_OP` nao e um setor ou uma etapa adicional ao
  arremate. Como o usuario nao configurou `POS_OP` nos produtos, as receitas
  atuais contem somente processos `OP`; os arremates legados ainda precisam
  ser auditados e configurados explicitamente quando a migracao for iniciada.
- Regra operacional aprovada: o antigo setor de arremates sera representado
  por etapas `POS_OP`. Essas tarefas somente entram na fila depois que a OP for
  finalizada. `costureira` e `tiktik` podem executar uma etapa `POS_OP` quando
  ambos estiverem listados no `feitoPor` do produto; nao existe bloqueio por
  tipo de empregado baseado no nome historico arremate.

Sistema web interno de gestão industrial para uma confecção. Controla o ciclo completo de produção: Ordens de Produção (OPs), cortes, produção por etapas, arremates, embalagem, estoque, financeiro, pagamentos de funcionários e dashboard de desempenho.

---

## Projeto Multiempresas — decisão estrutural aprovada

O sistema está em transição planejada de empresa única para **multiempresas**. O documento mestre e checklist de execução ficam em:

`_planejamento/sistema-multiempresas.md`

**Estado atual:** Fases 6, 6.1 e 7 concluídas no escopo aprovado; a Fase 8 da
cadeia produtiva foi liberada para todas as empresas ativas no escopo dos 11
módulos aprovados. A migration `multiempresas-fase8-liberacao-v1` foi
executada e validada na Neon em 2026-08-06, habilitando os módulos aprovados
para as empresas existentes e deixando o provisionamento de novas empresas
automático para módulos já marcados como prontos. O fechamento dos gates
G1–G12 fica registrado em `_planejamento/sistema-multiempresas.md`.
A fundação multiempresa e a Gestão Organizacional já estão em produção. A
migration de preparação do Financeiro foi executada e validada na Neon em
28/07/2026; a API foi isolada e validada, e o teste transacional das constraints
empresariais foi aprovado com sete de sete cenários em 29/07/2026. A migration
de finalização foi executada e validada na Neon em 29/07/2026. A liberação
controlada do Financeiro para Neila Confecções também foi executada e validada;
o teste manual entre as duas empresas foi aprovado, com dados isolados e console
sem erros. O código estrutural foi publicado no commit `5ef2096`, e a correção
final do agente global foi publicada no commit `919de6d`, release `1.38.0`. O
redesign da Fase 6.1, incluindo Agenda, parcelamento, soft delete e recuperação,
foi aprovado integralmente em smoke autenticado em 29/07/2026 e publicado no
commit `9625034`, release `1.39.0`.
Na Fase 7, a preparação estrutural do banco foi executada e validada na Neon, a
API de pagamentos foi aprovada por 17 cenários HTTP autenticados e a migração
coordenada de ponto, sessões e estado operacional foi aprovada por 15 cenários
HTTP autenticados em 30/07/2026. O código do bloco de metas, banco de pontos,
pontos extras, configurações de pontos, gincanas, premiações, avisos popup e
calendário foi implementado e aprovado em HTTP na restauração local em
01/08/2026. O limite transitório da dashboard foi aprovado por 6 cenários HTTP,
mantendo a dashboard legada disponível e a cadeia fechada na secundária. O
redesign completo da dashboard foi publicado e aprovado pelo usuário em smoke
autenticado de produção. A cadeia produtiva está liberada para empresas ativas
no escopo aprovado da Fase 8; módulos fora desse escopo continuam sujeitos aos
próprios gates.

O primeiro ensaio aditivo da cadeia foi aprovado apenas localmente em
03/08/2026: Produtos e Demandas receberam `empresa_id`, as demandas receberam
`produto_id`, a aplicação foi idempotente e o rollback foi validado por hashes
iguais aos da restauração. O ensaio HTTP com dois contextos também foi aprovado:
criação, leitura e mutação ficaram isoladas, o body não alterou a empresa e a
cadeia ainda não migrada permaneceu bloqueada na secundária. Esse ensaio não
autoriza alteração na Neon nem liberação de qualquer domínio produtivo. No
mesmo dia, a migration estrutural de OPs e Cortes foi ensaiada em clone derivado:
9.763 OPs e 9.531 cortes receberam `empresa_id`, com 48 OPs sem demanda pai, 20
cortes sem demanda pai e 7 cortes sem OP pai preservados para classificação; a
aplicação idempotente, rollback e hashes das cinco tabelas foram aprovados.
O smoke HTTP legado também aprovou listagem, radar, próximo PN, criação de corte,
criação de OP, detalhe e checagem de OP filha; a empresa secundária continuou
bloqueada. O caso de corte sem variante corrigiu a gravação técnica de
`producoes.variacao` para `'-'`. Os fixtures do smoke foram removidos e não houve
Neon, commit ou deploy.

### Decisões obrigatórias

- `usuarios` continuará representando a identidade global da pessoa e suas credenciais.
- O vínculo com cada empresa ficará em `usuarios_empresas`, incluindo tipos/funções, permissões, situação, admissão/demissão, salário, nível e contato financeiro específicos daquele vínculo.
- Um usuário poderá pertencer a uma ou mais empresas, mantendo um único login.
- A tela pública de login deve ser neutra quanto às empresas: não exibe nomes,
  seletores ou mensagens que revelem a existência de outras organizações. A
  empresa ativa e qualquer troca de contexto aparecem somente após autenticação.
- A empresa ativa será validada no backend e transportada no JWT. Por padrão, a
  troca de empresa emite novo token e recarrega a página. No Financeiro, a troca
  atualiza token, contexto, permissões e providers no mesmo documento, mantendo
  a transição visual ativa até a página sinalizar que o novo contexto está
  pronto; essa exceção evita o intervalo sem pintura causado pela navegação.
- O seletor universal ficará no menu lateral no PC e próximo ao hamburger no tablet/celular.
- A página Usuários Cadastrados será evoluída para **Gestão Organizacional**, com abas **Pessoas e Acessos** e **Empresas**.
- O Financeiro será o primeiro módulo de negócio migrado integralmente.
- O isolamento do Financeiro e o redesign dos modais da Fase 6 foram concluídos
  e permanecem registrados no histórico do projeto e no plano mestre.
- O redesign dos modais foi executado como **Fase 6.1**, antes da Fase 7. O novo
  compositor começa pela intenção **Paguei / Recebi / Transferi**, mantém o
  lançamento manual como fluxo principal, usa Favorecido para despesas e
  Pagador para receitas, substitui selects extensos por buscas e prepara
  componentes reutilizáveis pela futura importação/conciliação de extratos sem
  implementar o importador nesta fase.
- Lançamentos e Agenda reutilizam o mesmo `FinanceiroCompositorModal`: a aba
  define apenas o estado inicial Agora/Agendar. Parcelamento é uma variação de
  **Agendar + Valor único**, persistida como lote de agendamentos; compra e
  rateio mantêm seus editores próprios e a baixa continua em confirmação
  separada por transformar previsão em lançamento real.
- Exclusões comuns de agendamentos e lotes são lógicas e recuperáveis. A
  listagem, dashboard e header ignoram `excluido_em`; o Histórico da Agenda
  permite restaurar registro individual ou lote mediante a permissão
  `recuperar-agendamentos-deletados`. Uma parcela removida junto do lote usa
  `excluido_por_lote = true` e só volta pela recuperação do lote. A migration é
  `_planejamento/migration-financeiro-fase6.1-soft-delete-agendamentos.sql`.
- Excluir lote, agendamento avulso ou parcela exige
  `permite-excluir-agendamentos`. Sem essa permissão, a ação permanece visível
  com o bloqueio universal `UIBloqueio`.
- Na Fase 7 — Empregados, dashboard e pagamentos — a dashboard das costureiras
  será a última frente funcional. Seu isolamento será concluído depois dos
  domínios de vínculo, ponto e pagamentos, preservando espaço para um redesign
  completo da experiência mobile.
- Enquanto produção e arremates permanecerem na Fase 8, respostas com
  `CADEIA_PRODUTIVA_NAO_MIGRADA` na dashboard secundária devem renderizar o
  bloqueio neutro `DashCadeiaNaoMigrada`, sem tentar pintar dados legados.
- Enquanto produção e arremates permanecerem na Fase 8, os próprios routers
  `/api/producao` e `/api/arremates` devem falhar fechados para empresas
  secundárias com `CADEIA_PRODUTIVA_NAO_MIGRADA`, mesmo que um flag de módulo
  seja habilitado temporariamente para teste.
- O fluxo integrado usa `sessoes_trabalho_producao.fase = 'OP'` para etapas
  internas e `fase = 'POS_OP'` para o antigo arremate. POS_OP só pode ser
  atribuído quando a OP estiver `finalizado`; a autorização do executor vem da
  etapa salva no produto (`feitoPor`) e o lançamento concluído permanece em
  `arremates` para alimentar embalagem durante a transição. A migration
  `_planejamento/migration-pos-op-sessoes-producao-v1.sql` é aditiva e preserva
  o histórico legado.
- Toda entidade empresarial deverá possuir vínculo explícito com `empresa_id`, direto ou garantido por uma entidade pai.
- Toda consulta por ID, alteração ou exclusão empresarial deverá validar também `empresa_id`; filtrar apenas listagens não é suficiente.
- O frontend nunca será a autoridade de isolamento. `empresa_id` não deve ser aceito cegamente do body.
- Durante a migração, empresas secundárias não podem acessar módulos ainda não convertidos. Esses módulos devem ser bloqueados, nunca exibir dados da empresa principal.
- Migrações serão aditivas primeiro. Campos empresariais legados de `usuarios` só poderão ser removidos na fase final, depois da migração de todos os consumidores.
- O `codigo` de uma nova empresa é gerado exclusivamente a partir do nome
  fantasia: minúsculas, sem acentos, grupos separados por hífen e unicidade
  obrigatória. O backend é a autoridade e o código não muda na edição.
- Encerrar um vínculo empresarial representa a demissão daquela empresa. A ação
  grava a data corrente no fuso `America/Sao_Paulo`, desativa somente o vínculo
  correspondente e preserva identidade, login e vínculos com outras empresas.
- Para vínculos com tipo `socio` ou `ex_socio`, o encerramento é uma saída
  societária, nunca uma demissão. O campo técnico `data_demissao` é reutilizado
  como data de saída, com terminologia societária em toda a interface.
- Para vínculos societários, o campo técnico `data_admissao` representa o
  início da sociedade e deve usar essa terminologia na interface.
- Sócios não possuem salário fixo na Gestão Organizacional. O campo técnico
  `salario_fixo` deve ser normalizado para zero e a interface deve comunicar
  remuneração societária variável por retiradas ou distribuições.
- Vínculos `prestador_externo` ou marcados como freelance representam prestação
  de serviços, nunca emprego: `data_admissao` significa início da prestação,
  `data_demissao` significa fim da prestação, `salario_fixo`, INSS e VT devem
  ficar zerados, passagem continua opcional e permissões individuais continuam
  disponíveis. O encerramento deve usar Encerrar prestação, nunca Demitir.
- Cadastro inicial, novo vínculo com outra empresa e edição devem reutilizar as
  mesmas regras e o mesmo componente de campos por tipo de vínculo.
- Ao criar vínculo adicional para uma pessoa, a Gestão Organizacional deve
  oferecer cópia opcional das permissões de um vínculo ativo existente: nenhuma,
  todas ou seleção parcial. A empresa de origem é escolhida pelo operador e a
  lista final é persistida diretamente no novo registro de `usuarios_empresas`.
  Administradores não usam essa cópia porque o acesso total deriva do tipo.
- O tipo `administrador` recebe automaticamente todo o catálogo definido em
  `permissoes.js`. Não exibir nem armazenar permissões individuais redundantes
  para esse tipo; usar `permissoes = []` e comunicar acesso total.
- O login emite sessões de 30 dias por padrão. A troca de empresa deve preservar
  o tempo restante do JWT e tokens legados sem `exp` recebem a política atual de
  30 dias; não reintroduzir a antiga duração de 8 horas.
- Hashes de senha ausentes ou fora do formato bcrypt devem ser tratados como
  credencial inválida no login, nunca como erro interno HTTP 500. O sistema não
  deve criar fallback de comparação em texto puro para contas legadas.
- Métricas de membros e gestores por empresa devem excluir usuários com
  `is_test = true` ou `arquivado = true`, usando a mesma população da listagem.
- Na Gestão Organizacional, a edição de identidade global e vínculo empresarial
  ocorre pelo único botão Editar vínculo e deve ser transacional no backend.
- O staging foi abandonado. Mudanças de banco devem ser ensaiadas em uma restauração local validada do backup e só podem seguir diretamente para produção após autorização explícita.
- O contexto empresarial do backend fica centralizado em `api/contexto-empresa.js`. Tokens legados sem `empresa_id` resolvem temporariamente o vínculo principal; rotas não mapeadas falham fechadas para empresas secundárias.
- Alterações multiempresa devem ser publicadas em commits seletivos, com revisão
  do diff e validação antes do push. O procedimento fica em
  `_planejamento/multiempresas-controle-de-arquivos.md`.

### Home administrativa — redesign aprovado em 2026-08-09

- A Home administrativa foi reconstruída como cockpit de trabalho responsivo,
  com código próprio da página integralmente em React + TypeScript. Utilitários
  globais compartilhados, como autenticação e a fonte do changelog, continuam
  em JavaScript e não devem ser duplicados apenas para atender essa página.
- O bloco Novidades no ar deve consumir `public/js/utils/changelog-data.js`, que
  permanece como fonte de verdade das notas. O histórico e o estado de leitura
  reutilizam `/api/preferencias-menu` e a mesma preferência do menu lateral.
- Em 2026-08-09, o bloco de atalhos e favoritos foi removido integralmente da
  Home por decisão do usuário. A área não deve receber um substituto até novo
  direcionamento.
- `MENU_ITENS`, permissões do usuário e módulos habilitados continuam
  alimentando a central de comandos, as sugestões contextuais e os acessos
  recentes, sem criar um catálogo paralelo de páginas ou permissões na Home.
- A experiência atual inclui central de novidades dinâmica, busca/central de
  comandos, acessos recentes, foco diário e sugestões contextuais por horário.
- Foco diário e acessos recentes não criam domínio empresarial nem API nova:
  são preferências locais isoladas por usuário e empresa. A lista de foco usa
  também a data local na chave para começar vazia a cada novo dia.
- O redesign deve continuar funcional em desktop, tablet e celular, respeitar
  navegação por teclado, foco de dialogs e `prefers-reduced-motion`.
- No resumo de contexto, a empresa ativa deve ser identificada como “Empresa
  selecionada”.

### Dashboard dos empregados — decisões de interface aprovadas em 2026-08-03

- A sidebar deve manter os cards Meu cartão VT e Ranking da semana, mas o
  ranking não recebe redesign nesta etapa; sua identidade e seus três painéis
  permanecem preservados.
- O topo da sidebar não exibe o texto “Sistema LV”. O título da seção dos dois
  cards deve ser “Informações úteis”.
- O rodapé da sidebar mantém os recursos existentes, incluindo versão e
  Preferências, adaptados à paleta da nova sidebar.
- O botão Sair fica no header junto do perfil, tanto na sidebar desktop quanto
  no header do drawer mobile; não fica mais no rodapé desktop.
- O cartão Meu cartão VT usa hierarquia própria da dashboard, com saldo,
  status de cobertura e mensagens de provisionamento/devolução, sem alterar a
  origem ou a regra dos dados do VT.
- O carregamento inicial deve possuir uma camada estática no HTML antes do
  bundle React, evitando tela branca até a montagem do primeiro componente.
- A barra de foco diário usa carregamento contínuo enquanto nenhuma meta foi
  atingida; depois assume as cores Bronze, Prata ou Ouro conforme o maior nível
  alcançado no dia.
- A celebração de meta é não cumulativa: ao abrir a dashboard, somente o maior
  nível novo do dia recebe mensagem personalizada, confetes e efeitos de festa;
  o nível exibido é persistido por empregado, empresa e data para não repetir.
- Ouro recebe brilho, pulsos e glitters saindo da barra; Bronze e Prata recebem
  explosão de confetes em escala crescente. As animações respeitam
  `prefers-reduced-motion`.
- Pontos lançados pelo supervisor contam para a meta visual do dia e para a
  elegibilidade do resgate, mas não entram no ranking nem geram sobra no banco
  de resgate. A auditoria automática do cofre usa somente produção real.
- Cada ganho automático do cofre possui `data_referencia` e deve ser único por
  empresa, empregado e dia de produção. A gravação ocorre em transação com
  lock por vínculo; correções financeiras preservam o movimento original e
  registram o tipo `CORRECAO`.
- A migration de idempotência do banco de resgate e a correção dos cinco
  lançamentos indevidos da Milena Silva foram aplicadas e validadas na Neon em
  2026-08-05: índice único persistido, cinco movimentos classificados como
  `CORRECAO` e saldo corrigido de 386,80 para 41,80 pontos.

### Jornada e controle de ponto — decisões aprovadas em 2026-08-01

- A jornada de trabalho por vínculo, incluindo dias, entrada, almoço, pausa e
  saída, deve ser a fonte de verdade do controle de ponto e será estabilizada
  antes da migração multiempresa da cadeia de produção.
- Dia não trabalhado, DSR ou feriado não gera transições ordinárias automáticas.
  Trabalho nesses dias ocorre somente pelo fluxo especial já adotado de blocos
  manuais de tarefas atribuídas; ao terminar um bloco, o empregado volta a
  disponível/ocioso e pode receber outro.
- A entrada ordinária E1 é automática. Falta não é inferida por ausência de
  tarefa: o empregado permanece disponível até o supervisor registrar
  explicitamente a falta, que pode ser lançada em qualquer momento do dia.
- No horário planejado de almoço ou pausa, o backend deve criar uma transição
  pendente. O supervisor tem 30 segundos para confirmar ou registrar uma
  exceção; sem resposta, o backend aplica o horário planejado, mesmo sem tela
  aberta, registrando origem, horário planejado e horário de processamento.
- Antecipação ou atraso de saída/retorno exige exceção explícita, motivo e
  auditoria. Correções de transições automáticas serão protegidas pela
  permissão provisória `corrigir-transicoes-ponto`.
- Ao registrar falta, os compromissos restantes do dia são cancelados para o
  vínculo. Eventos anteriores, como E1, não são apagados: permanecem no
  histórico e são invalidados por causalidade.
- O controle será evoluído para eventos de domínio append-only com
  `ponto_diario` e status do vínculo como projeções rápidas. O motor deve ser a
  única autoridade de transições ordinárias; React, polling, cron, produção e
  arremates não podem manter regras concorrentes.
- O plano executável dessa frente ainda não está versionado no repositório.
- A auditoria dos escritores e consumidores da cadeia produtiva para a Fase 8
  foi aberta em `_planejamento/auditoria-cadeia-produtiva-fase8.md`. Enquanto
  ela não for concluída, nenhum domínio da cadeia pode ser liberado para uma
  empresa secundária.
- A fundação do motor foi implementada em `api/ponto-eventos.js` e
  `api/ponto-motor.js`; a migration `_planejamento/migration-ponto-eventos-transicoes.sql`
  foi ensaiada na restauração local isolada e executada/validada na Neon em
  2026-08-02. `ponto_eventos` é append-only; `ponto_diario` e o
  status do vínculo permanecem projeções durante a transição. O cron tem
  ativação condicionada à presença do schema, o polling React não cria mais
  intervalos silenciosamente e a confirmação manual opera somente uma
  transição pendente dentro da janela de 30 segundos.
- A política aprovada para esta etapa é que o cron aplique o fallback no
  primeiro ciclo após `vence_em`, preservando o horário planejado e registrando
  o atraso de processamento; não será criado worker adicional agora.
- O livro de eventos também registra `TAREFA_ATRIBUIDA`, `TAREFA_INICIADA`,
  `TAREFA_FINALIZADA` e `TAREFA_CANCELADA`, com `idempotency_key`, empresa,
  vínculo, origem, autor, motivo e payload. Os fluxos de produção e arremate
  emitem esses fatos na mesma transação que cria, finaliza ou cancela a sessão;
  a falta emite cancelamento causal para sessões ativas.
- A saída ordinária automática em `horario_real_s3` não é uma saída antecipada.
  A UI só pode exibir `Saída antecipada` e oferecer `Desfazer Saída` quando
  `ponto_diario.tipo_excecao = 'SAIDA_ANTECIPADA'` e o registro ainda não foi
  desfeito; o backend também deve rejeitar o desfazer de um S3 ordinário.
- A falta, o cron, a atribuição, o cancelamento de produção, as exceções de
  atraso, o retorno manual e a correção de retorno foram aprovados em HTTP no
  clone local. A validação ampliada também aprovou falta antes da jornada sem
  E1, DSR/folga sem eventos, fallback com confirmação tardia idempotente,
  motivo obrigatório para exceção e concorrência de supervisores.
- A migration de eventos/transições foi executada na Neon em 2026-08-02. A
  validação pós-migration confirmou registro em `sistema_migrations`, tabelas
  vazias, constraints, índices, trigger append-only e rollback de ensaio sem
  deixar fixtures. O código compatível foi publicado no commit `8286e07`.
- A migração do frontend para TypeScript está em andamento por fases (ver
  seção “Migração progressiva para TypeScript”). Em 2026-08-02 foram concluídas
  e revisadas as fases de UI compartilhados, Calendário, Gestão Organizacional,
  Central de Alertas, Centro de Incentivos, Dashboard das empregadas (todos
  os componentes `Dash*`) e Home administrativa.
  A trilha TS da página de Ordens de Produção foi encerrada no escopo atual e
  publicada no commit `4a0da29`; os componentes ligados diretamente ao ponto
  permanecem em JSX de forma intencional até o redesign desse domínio. A
  conversão não pode alterar a lógica de jornada/ponto já validada. A migração
  de `api/*.js` fica fora do escopo inicial.
- Em 2026-08-09, a migração específica da página de Embalagem foi concluída:
  `embalagem-de-produtos.html` monta `main-embalagem.tsx`, a fila, filtros,
  cards, modais, controles e helpers estão em React/TypeScript, e o legado
  específico da página foi removido. Auth, popups, paginação, menu, agentes
  globais e APIs permanecem como dependências compartilhadas por decisão.

### Estado executivo em 2026-07-29

| Frente | Estado |
|---|---|
| Fase 0 — auditoria e desenho | Concluída |
| Fase 1 — fundação do banco | Executada e validada na Neon |
| Fase 2 — contexto empresarial | Publicada e validada em produção |
| Fase 3 — login e sessão | Publicada e validada em produção |
| Fase 4 — seletor universal | Publicada e validada em produção |
| Fase 5 — Gestão Organizacional | Concluída, publicada e aprovada em produção |
| Fase 6 — Financeiro como piloto | Concluída, publicada e aprovada nas duas empresas |
| Fase 6.1 — Redesign dos modais do Financeiro | Concluída, publicada e aprovada em produção na release 1.39.0 |
| Fase 7 — Empregados, dashboard e pagamentos | Concluída, publicada e aprovada em produção no escopo atual; produção e arremates permanecem na Fase 8 |
| Fase 8 — cadeia produtiva multiempresa | Concluída no escopo dos 11 módulos aprovados; liberação validada na Neon |
| Fase 9 em diante | Não iniciada |

Situação operacional:

- a infraestrutura multiempresa está ativa; `Lojas Variara` e
  `Neila Confecções` operam o Financeiro com dados isolados;
- a Neon já contém as tabelas fundamentais, a empresa `Lojas Variara`, os 18
  vínculos iniciais e o catálogo de 18 módulos;
- o Financeiro possui `empresa_id NOT NULL` nas 13 tabelas; a finalização
  removeu os 21 constraints legados e validou os 31 constraints empresariais;
- o teste transacional das constraints empresariais foi aprovado com sete de
  sete cenários e `ROLLBACK`, sem deixar fixtures na Neon;
- o isolamento foi publicado no commit `5ef2096`; dashboard, lançamentos,
  agenda, baixa, configurações, menus auxiliares, lançamento real, recargas e
  nova sessão foram aprovados no smoke da Lojas Variara;
- `Neila Confecções` está cadastrada e habilitada no Financeiro, iniciando com
  zero registros financeiros;
- a migration separada de liberação da Neila e seu validador foram executados
  e retornaram `aprovado: true`;
- no teste manual da Neila, grupos, categorias, conta bancária, agenda,
  lançamentos, baixas, configurações, logs e relatórios funcionaram corretamente;
- a troca entre as empresas foi aprovada nos dois sentidos, preservando os dados
  de cada contexto e sem erros no console;
- o compositor único da Fase 6.1 foi aprovado para lançamento simples, compra,
  rateio, transferência, agendamento, parcelamento, edição e baixa;
- a migration de soft delete da Agenda foi executada e validada com cinco
  colunas, três índices e `aprovado: true`; exclusão, histórico, recuperação,
  cores por vencimento e permissões foram aprovados em smoke manual;
- a release `1.39.0`, commit `9625034`, foi aprovada no smoke de produção sem
  erros no Financeiro;
- o agente global de encerramento de OP fazia uma chamada bloqueada e gerava
  `403` no console da empresa secundária;
- `public/src/main-agentes-globais.jsx` foi ajustado localmente para não iniciar
  polling de OP em empresa secundária enquanto esse módulo não for migrado;
  a correção foi aprovada e publicada no commit `919de6d`;
- o backend possui contexto universal, troca de empresa, JWT
  contextual, `/usuarios/me` contextual e impersonação por empresa;
- o menu compartilhado possui seletor no PC, tablet e celular;
- a troca entre duas empresas foi validada localmente e módulos legados falharam
  fechados com `403` na empresa secundária;
- as Fases 2–4 foram publicadas e aprovadas em smoke test em 2026-07-28;
- a Fase 5 — **Gestão Organizacional** — foi publicada e aprovada em produção,
  incluindo seletor universal, Pessoas e Acessos, Empresas e release
  administrativa `1.36.0`;
- a rota oficial é `/admin/gestao-organizacional.html`; a URL antiga
  `/admin/usuarios-cadastrados.html` permanece compatível;
- a API dedicada é `/api/gestao-organizacional`;
- a migration de liberação do módulo é
  `_planejamento/migration-multiempresas-fase5-gestao-organizacional.sql`;
- nenhuma empresa secundária real poderá ser liberada antes da migração de pelo
  menos um módulo de negócio.

---

## Decisão aprovada — unificação de Produções e Arremates (2026-08-08)

O plano executável da transição está em
`_planejamento/plano-unificacao-producoes-arremates.md`.

O usuário aprovou a substituição da página de Arremates por uma página única de
Produções. A cadeia passa a ser modelada como OP aberta, processos internos da
OP, encerramento da OP, arremates pós-OP, embalagem e estoque. TikTiks e
costureiras podem executar etapas internas quando estiverem na lista de
`feitoPor`; arremates pós-OP também passam a ser etapas de produção, com fase
explícita `POS_OP`.

Decisões obrigatórias desta frente:

- Produtos terão uma única receita canônica `etapas`; a antiga
  `etapastiktik` será normalizada de forma aditiva e permanecerá compatível
  até a migração de todos os consumidores.
- Cada etapa terá identificador estável, ordem, processo, máquina, fase
  (`OP` ou `POS_OP`) e lista de executores permitidos.
- A seleção de tarefas separará explicitamente “Processos da OP” de
  “Arremates pós-OP”; o backend será a autoridade para fase, executor,
  saldo, empresa e concorrência.
- Novos trabalhos usarão uma sessão operacional canônica. Produção e arremate
  não poderão manter escritores concorrentes para o status do mesmo empregado.
- O ponto será configurado por produto e etapa, com snapshot do valor aplicado;
  costureira e TikTik terão o mesmo ponto-base quando fizerem a mesma etapa
  autorizada.
- Perdas deixarão de ser exclusivas de arremates e terão somente as categorias
  `QUANTIDADE_ERRADA` e `PRODUTO_AVARIADO`; perdas não geram pontos.
- Embalagem e estoque receberão uma origem genérica de produto pronto, com
  compatibilidade temporária para `arremates` e sem duplicidade de saldo.
- O histórico antigo de arremates será somente leitura durante a transição.
  O histórico geral de Produções será uma fase posterior.

A execução deve seguir migrations aditivas, ensaio em restauração local
validada, gates por fase, isolamento por `empresa_id`, commits seletivos e
autorização explícita antes de qualquer alteração na Neon ou remoção de legado.

Primeiro incremento implementado localmente em 2026-08-08: a API de Produtos
passou a expor `etapasCanonicas` como visão derivada, sem alterar ainda os
campos legados no banco; a API aceita `etapasTiktik` e `etapastiktik`; a fila
de atribuição aceita `feitoPor` como string ou lista; e a área de etapas do
cadastro foi migrada para um componente React com tabela única, fase explícita
e executores múltiplos. O restante da página de cadastro permanece em
migração progressiva.

Segundo incremento implementado localmente em 2026-08-08: processos passaram a
ter catálogo empresarial em `processos_producao`, com `codigo` imutável, `nome`
editável, inativação lógica e isolamento por `empresa_id`. As etapas passam a
transportar `processo_id` junto do nome exibido; o nome é atualizado pelo
catálogo sem reescrever referências históricas. A configuração de processos
foi incorporada ao editor React de etapas, com criação e renomeação, mantendo
fallback temporário para a lista JS durante indisponibilidade do catálogo. As
migrations `_planejamento/migration-processos-producao-catalogo.sql` e
`_planejamento/migration-processos-producao-provisionamento-v2.sql` foram
executadas e validadas na Neon. A API correspondente é `/api/processos-producao`;
não existe
exclusão física de processos.

O ensaio local do catálogo foi ampliado em 2026-08-08: a migration também
adota automaticamente nomes legados encontrados nas etapas, converte entradas
legadas em string para objetos canônicos e preenche `processo_id` em `etapas` e
`etapastiktik`. Processos desconhecidos recebem código determinístico com
prefixo `legado-`, sem perder a etapa. Uma guard clause impede execução antes
de Produtos possuir `empresa_id`; o validador exige que cada etapa com processo
tenha um ID pertencente à mesma empresa. O trigger de banco impede alteração
direta do código. O ensaio passou em PostgreSQL temporário com duas empresas,
processos legados adicionais, entradas string, validação read-only e testes de
imutabilidade/duplicidade. A Neon não foi acessada nem alterada.

---

## Central de Monitoramento de OPs v2 — decisão aprovada em 2026-08-12

O plano executável está em
`_planejamento/plano-monitoramento-ops-v2.md`. A implementação foi concluída
localmente em 2026-08-12 no código de frontend e backend. A migration foi
executada e validada na Neon em 2026-08-12; não houve deploy. Publicação e smoke
produtivo continuam exigindo autorização explícita e gate separado.

Decisões obrigatórias:

- A ferramenta atual de encerramento será substituída por uma única Central de
  Monitoramento de OPs, compartilhada entre o acesso global e a aba de OPs.
- A nova permissão canônica será `acesso-monitoramento-ops`, do tipo `escopo`.
  Quem não a possuir não verá FAB, central, badge, bloqueio, mensagem, espaço
  reservado nem chamada de rede relacionada à ferramenta.
- `finalizar-op` continuará protegendo o encerramento. O interceptor obrigatório
  só será aplicado a quem tiver a nova permissão e poder de finalizar, evitando
  bloquear usuários de consulta.
- `usar-agente-encerrador` e `usar-agente-central-ops` serão legadas e não
  concederão acesso ao v2. Elas não serão apagadas ou fundidas sem auditoria e
  nova decisão explícita.
- O backend será a única autoridade para elegibilidade, faixa, empresa, saldo e
  concorrência. O tempo começa quando a última etapa `OP` obrigatória recebe o
  primeiro lançamento válido; `POS_OP` não bloqueia o encerramento da OP e a
  fase nunca pode ser inferida pelo nome.
- As faixas aprovadas são: menos de 3h, apenas acompanhamento; a partir de 3h,
  atenção; a partir de 8h, revisão obrigatória; e a partir de 24h, crítica sem
  adiamento.
- No modo obrigatório não haverá Cancelar, fechar, clique externo, `Esc` ou
  seleção vazia como saída. Recarga, navegação e troca de dispositivo não
  resolvem a pendência.
- Uma OP obrigatória só recebe decisão por finalização ou impedimento com motivo
  persistido. Entre 8h e 24h, cada usuário pode adiar 30 minutos no máximo duas
  vezes por empresa e dia; esse estado fica no backend. A partir de 24h não há
  adiamento.
- O lote enviará somente IDs e chave de idempotência. O backend relê e bloqueia
  cada OP por `empresa_id`, usa um serviço canônico também consumido pela
  finalização individual e nunca confia no objeto completo enviado pelo
  navegador.
- Toda a nova ferramenta será React + TypeScript. Fantasminha, varredura
  simulada, textos digitados, tremores, componentes JSX e pollings duplicados
  serão removidos somente depois dos gates do plano.
- Score operacional, checklist inteligente avançado, responsável/prazo de
  divergências e indicadores históricos foram descartados por enquanto e não
  devem ser implementados sem nova aprovação.

Estado local obrigatório desta frente:

- `acesso-monitoramento-ops` foi incluída no catálogo; permissões antigas são
  apenas compatibilidade oculta e não concedem acesso ao v2;
- a fila canônica, impedimentos, adiamentos e lotes ficam em
  `api/utils/monitoramento-ops.js`; a finalização individual e em lote reutiliza
  `api/utils/finalizar-op.js`;
- a migration aditiva e o validador são
  `_planejamento/migration-monitoramento-ops-v2.sql` e
  `_planejamento/validacao-monitoramento-ops-v2.sql`;
- FAB, painel, lista e confirmação são React + TypeScript e só recebem import,
  montagem e polling depois da nova permissão; os agentes JSX, o lote antigo,
  o polling duplicado e o storage operacional legado foram removidos;
- por decisão visual de 2026-08-12, o FAB global é compacto e sem texto
  visível: 56 x 56 px no desktop, 52 x 52 px no celular e badge de contagem
  externo de 22 x 22 px. O nome do recurso permanece apenas no rótulo
  acessível para leitores de tela;
- seis testes automatizados, typecheck, sintaxe Node e build Vite passaram. O
  fluxo visual isolado foi aprovado em desktop e 390 px, incluindo `Esc`
  bloqueado, impedimento, adiamento, finalização parcial e fechamento somente
  depois da decisão;
- a migration foi aplicada duas vezes em PostgreSQL 18.4 local sobre clone com
  9.763 OPs. A restauração disponível era anterior à Fase 8, portanto somente
  no clone foi reproduzido o pré-requisito atual
  `ordens_de_producao.empresa_id NOT NULL`. O validador aprovou três tabelas,
  FK composta, sete índices, zero objetos inválidos e os testes transacionais;
  hashes dos dados existentes não mudaram e o rollback deixou zero fixtures;
- com autorização explícita, um `pg_dump` read-only da Neon foi restaurado sem
  adaptação de schema. A comparação PostgreSQL 15.18 → 18.4 aprovou 100
  tabelas, 132.213 linhas, 85 sequências e catálogo com `exactMatch: true`;
- nessa restauração pós-Fase 8, a migration passou duas vezes, o validador e os
  testes SQL passaram, e a consulta canônica do backend aprovou isolamento
  entre as duas empresas, impedimento e finalização transacional com rollback;
- o gate HTTP autenticado foi aprovado em 2026-08-12 com 10 de 10 cenários em
  clone local limpo: a nova permissão e as permissões legadas foram isoladas,
  usuário somente consulta não recebeu interceptor diante de OP obrigatória,
  o contexto do JWT prevaleceu sobre o body, duas empresas ficaram isoladas,
  adiamento e lote foram idempotentes e a faixa crítica recusou adiamento;
- duas finalizações HTTP concorrentes da mesma OP produziram somente um
  encerramento efetivo e exatamente um evento canônico `op.encerrada`. O banco
  local usado pelo teste é descartável e deve ser removido ao final;
- o dump e sua evidência ficam em `_backups` sob o prefixo
  `sistema-lv-pre-monitoramento-ops-v2-20260812-223305`;
- após autorização explícita, a migration foi executada na Neon em 2026-08-12
  às `23:01:29.147-03`, com SHA-256
  `ee2e896da718846f0bec2a2f7899ad42875b53a5dd0c12e5c9a0119a66e24b6a`;
- a validação interna e a validação independente `READ ONLY` retornaram
  `aprovado: true`: três tabelas presentes, uma FK empresarial composta, sete
  índices esperados, zero índices inválidos, zero constraints novas não
  validadas e um marcador `monitoramento-ops-v2` em `sistema_migrations`;
- o pós-flight confirmou 9.895 OPs antes e depois da migration e zero registros
  em impedimentos, adiamentos e lotes; nenhum fixture foi deixado na Neon;
- nenhum deploy foi executado. O próximo gate exige autorização separada para
  publicação e smoke autenticado de produção.

---

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, Vite 7 |
| Backend | Node.js, Express 5 |
| Banco de dados | PostgreSQL (Neon / Vercel Postgres) |
| Deploy | Vercel (serverless functions em `/api`) |
| Dev local | `npm run dev` (Vite) + `npm run server` (Express na porta 3000) |
| Autenticação | JWT (armazenado no `localStorage` como `token`) |
| Libs UI | react-select, react-tooltip, recharts, FullCalendar, jsPDF |

---

## Arquitetura e Estrutura de Pastas

```
/
├── api/                        # Routers Express (um arquivo por domínio)
├── public/
│   ├── admin/                  # Páginas HTML do painel administrativo
│   ├── dashboard/              # HTML da dashboard do funcionário
│   ├── css/                    # Estilos globais e por página
│   ├── js/                     # JS utilitário legado (auth.js, permissoes.js, etc.)
│   └── src/
│       ├── components/         # Componentes React — TODOS aqui, sem subpastas
│       ├── hooks/              # Custom hooks React
│       ├── pages/              # Páginas React (quando existirem)
│       ├── utils/              # Utilitários JS do frontend
│       └── main-*.jsx          # Entry points React (um por página)
├── server.js                   # Express local (dev)
├── vite.config.js              # Build config — root é /public
├── vercel.json                 # Config de produção (Vercel)
└── AGENTS.md                   # Este arquivo
```

### Como o Vite está configurado

- **Root do Vite:** `public/` — o dev server serve arquivos a partir daí
- **Build output:** `dist/` na raiz do projeto
- **Multi-page:** o `vite.config.js` usa `globSync` para encontrar todos os `.html` em `public/**` e os trata como entry points do Rollup
- **Proxy dev:** chamadas a `/api/*` são proxiadas para `http://localhost:3000`

### Padrão de entrada React por página

Cada página admin tem um `.html` em `public/admin/` que importa um `main-*.jsx` como módulo. O `.jsx` monta o componente raiz via `ReactDOM.createRoot`. Exemplo: `public/admin/minha-pagina.html` → `public/src/main-minha-pagina.jsx`.

---

## Convenções de Nomenclatura

### Componentes React

**Regra absoluta de localização:** todos os componentes ficam em `public/src/components/`, sem exceção e sem subpastas. O Vite apresenta problemas com subpastas de componentes — esse padrão plano foi adotado desde o início e nunca causou conflito. Jamais criar componentes em outro lugar.

O prefixo do nome do componente é sempre a **abreviação da página/área** à qual ele pertence, em PascalCase. O objetivo é bater o olho no nome e saber imediatamente de qual área ele faz parte.

| Prefixo | Página / Área |
|---|---|
| `OP*` | Ordens de Produção |
| `CPAG*` | Central de Pagamentos |
| `Dash*` | Dashboard do funcionário |
| `Arremate*` | Tela de arremates |
| `Embalagem*` | Embalagem de produtos |
| `Botao*` | Botões com lógica própria |
| `UI*` | ⚠️ Prefixo legado usado para componentes reutilizáveis entre páginas — o nome não é ideal e será revisado progressivamente. Por enquanto, mantê-lo para não quebrar imports existentes. |
| `Permissoes*` | Tela de Gerenciar Permissões |

**Componentes reutilizados entre páginas:** quando um componente precisar ser usado em mais de uma área, o prefixo deve deixar claro que é compartilhado — a forma exata será definida caso a caso conforme o projeto avança, evoluindo o prefixo `UI*` para algo mais semântico.

### Navegação por abas padronizada

`UITabNav`, em `public/src/components/UITabNav.tsx`, é o componente oficial para navegação de nível de página com múltiplas visões. Toda página que possuir abas deve reutilizá-lo; não criar manualmente `nav.gs-tab-nav` ou botões `gs-tab-btn`.

Cada item deve informar `id`, `label` e, quando fizer sentido, `icon`, `badge` ou `dot`. Bloqueios de permissão devem usar a propriedade `locked` do componente. O estilo e as animações ficam centralizados em `public/css/global-style.css`; páginas não devem criar sobrescritas locais para `.gs-tab-nav` ou `.gs-tab-btn`. Subnavegações internas podem ter componentes próprios quando não representarem a navegação principal da página.

### Estados vazios padronizados

`UIFeedbackNotFound` é o componente oficial para estados de listas, tabelas, buscas e resultados sem dados em toda a aplicação. Usar `variante="compacto"` em modais, tabelas, dropdowns e regiões internas. Não usar para carregamento, erros, bloqueios de módulo, placeholders de avatar/imagem ou mensagens de status operacional; esses estados mantêm seus componentes e tratamentos próprios.

As páginas legadas que ainda montam HTML diretamente usam `htmlUIFeedbackNotFound` em `public/js/utils/ui-feedback.js`, que reproduz a mesma marcação e as mesmas classes visuais até a migração definitiva para React.

### APIs

Arquivos em `api/` com kebab-case. Um arquivo por domínio, usando Express Router. Exemplo: `api/ordens-de-producao.js`.

### Banco de dados

Conexão via `@neondatabase/serverless` / `@vercel/postgres`. String de conexão em `process.env.POSTGRES_URL`. Timezone configurado como UTC no servidor (`process.env.TZ = 'UTC'` em `server.js`).

---

## Padrões de Código

### Autenticação nas APIs

Todo router verifica o JWT via `verificarToken` antes de processar qualquer rota. O token vem no header `Authorization: Bearer <token>`. O payload decodificado fica em `req.usuarioLogado`.

```js
// Padrão de verificação de token nas APIs
router.use(async (req, res, next) => {
    try {
        req.usuarioLogado = verificarToken(req);
        next();
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});
```

### Fetch autenticado no Frontend

```js
const token = localStorage.getItem('token');
const res = await fetch('/api/rota', {
    headers: { 'Authorization': `Bearer ${token}` }
});
```

### Tratamento de erros nas APIs

Usar `try/catch` com `dbClient` obtido via `pool.connect()` e `dbClient.release()` no `finally`. Retornar `res.status(xxx).json({ error: '...' })`.

### Controle de acesso nas APIs — regra do sistema

**As APIs NÃO fazem checagem de permissão ou tipo de usuário além do JWT.** O controle de acesso fica inteiramente na camada de página, via `verificarAutenticacao('caminho/pagina.html', ['permissao-necessaria'])` no entry point React.

Isso significa que toda rota em `/api/*` verifica apenas se o token é válido (middleware de autenticação). Nunca adicionar `if (!isAdmin(req))`, `if (!req.usuarioLogado.tipos.includes('x'))` ou similares nas rotas — é trabalho duplicado que vai contra o padrão e vai gerar bugs de acesso.


Referência: `api/alertas.js` segue esse padrão desde sempre.

### Migração JS → React

O projeto foi iniciado com JavaScript puro e está em migração progressiva para React. Toda página nova ou refatorada usa 100% React. **Ao entrar em qualquer área/página para trabalhar, garantir que ela esteja 100% em React antes de avançar com novas features.**

---

## Dispositivos e Responsividade

O sistema é usado majoritariamente em **tablets (80%)**, seguido de celulares (10%) e PCs (10%). Toda interface deve ser projetada com essa prioridade:

1. **Tablet primeiro** — layout, tamanho de botões, espaçamentos e touch targets devem funcionar perfeitamente em telas de ~768–1024px com uso por toque.
2. **Celular** — deve funcionar sem quebrar, mesmo que seja experiência secundária.
3. **PC** — suportado, mas não é o foco principal.
4. Válido para todo sistema da parte admin. A parte de Dashboard ((acesso das costureiras e tiktiks)) deve seguir sempre **mobile first**

Regras práticas:
- Botões de ação devem ter área de toque mínima de 44px de altura
- Evitar hover-only interactions (touch não tem hover)
- Preferir layouts em coluna única ou grid de 2 colunas para cards em tablet
- Modais devem caber na tela sem scroll excessivo em tablets

### ⚠️ CSS obrigatório em TODA página que usa `main.gs-card` (tablet)

O `global-style.css` remove o `margin-left` do body no tablet (`@media max-width: 1024px`), mas **não adiciona o padding**. Sem o padding abaixo, o `main.gs-card` fica "colado nos cantos" no tablet (sem respiro em volta do card). **Cada página com `gs-card` precisa ter esse bloco no seu arquivo CSS:**

```css
@media (max-width: 1024px) {
    body {
        padding: 40px 40px 10px 40px;
    }
}
```

**Regra de criação e migração:** toda página nova ou migrada que use `main.gs-card` deve declarar esse bloco no próprio CSS da página. O `global-style.css` não substitui essa declaração, porque cada página é responsável pelo respiro externo do seu card principal.

---

## Fluxo de Trabalho por Área/Página

O desenvolvimento é organizado por **áreas** (cada área = uma página do sistema). Ao iniciar trabalho em uma área, o checklist obrigatório é:

1. **Migração React:** a página está 100% em React? Se não, migrar primeiro.
2. **⚠️ Checar double gs-card (bug recorrente de migração):** ao migrar uma página, o HTML antigo frequentemente tinha um `<div class="gs-card">` como root do componente React. Com a nova estrutura, o `<main id="root" class="gs-card">` já está no HTML — o componente raiz React **nunca** deve ter `<div className="gs-card">` como wrapper externo, apenas `<>` (Fragment). Verificar logo após criar o entry point. Ver seção "Anti-padrão crítico" abaixo.
3. **Limpeza de CSS:** fazer uma passagem no arquivo `.css` da área, removendo classes mortas, regras duplicadas e estilos de código legado que não são mais referenciados — **sem quebrar nada**. Consultar a tabela de status abaixo antes de fazer qualquer limpeza — se já estiver marcada como "limpo", não tocar.
4. **Feature:** só então implementar a nova funcionalidade.

---

## Estrutura Visual Padrão de Páginas

**Regra absoluta:** toda página nova ou refatorada deve seguir esta estrutura visual e os mesmos valores de espaçamento. A identidade, os componentes e o conteúdo podem variar por área, mas a moldura estrutural da página é única para todo o sistema. **Não há exceções.**

### Esqueleto HTML obrigatório (arquivo `.html`)

```html
<body>
    <div class="hamburger-menu">...</div>
    <main id="root" class="gs-card"></main>  <!-- gs-card SEMPRE no main -->
    <script src="/src/main-menu-lateral.tsx" type="module"></script>
    <script src="/src/main-nomepagina.jsx" type="module"></script>
</body>
```

### Esqueleto JSX obrigatório (componente raiz)

```jsx
<>
    <UIHeaderPagina titulo="Nome da Página">
        <button className="gs-btn gs-btn-primario">Ação Principal</button>
        <button className="gs-btn gs-btn-secundario"><i className="fas fa-cog"></i></button>
    </UIHeaderPagina>

    {/* tabs — apenas se a página tiver múltiplas visões */}
    <UITabNav items={tabs} activeId={visaoAtual} onChange={setVisaoAtual} />

    <div className="gs-conteudo-pagina">
        <div className="gs-card">
            {/* seção de conteúdo A */}
        </div>
        <div className="gs-card">
            {/* seção de conteúdo B */}
        </div>
    </div>
</>
```

### Como funciona o espaçamento

O `main.gs-card` tem `padding: 25px` e `margin: 20px`. Dentro dele:
- `gs-cabecalho-pagina` (via UIHeaderPagina) tem `margin` zerado — o padding do card já fornece o recuo
- `gs-conteudo-pagina` tem `padding: 20px 0 0` dentro do main — o lateral vem do card
- `gs-card` interno (seções) tem `padding: 25px` próprio e `margin-bottom: 0` (gap do flex cuida do espaço)

### Valores responsivos obrigatórios

- Em telas de até `1024px`, o `body` deve usar `padding: 40px 40px 10px` para preservar o respiro externo do card principal.
- Em telas de até `768px`, `main.gs-card` deve usar `margin: 10px` e `padding: 15px`.
- Em telas de até `480px`, o `body` deve usar `padding: 15px 10px`.
- Esses valores pertencem à estrutura global da página e devem ser mantidos em qualquer CSS específico que sobrescreva o layout da página.

### Classes globais de estrutura (`global-style.css`)

| Classe | Onde usar | Descrição |
|---|---|---|
| `main.gs-card` | `<main id="root">` no HTML | Card de página inteira. Sempre presente. |
| `gs-cabecalho-pagina` | Gerado por `UIHeaderPagina` | Header com título e botões. Não instanciar diretamente. |
| `gs-conteudo-pagina` | Direto no JSX | Wrapper de conteúdo após header/tabs — flex-column, gap 16px |
| `gs-card` | Seções de conteúdo | Card branco elevado — shadow, border-radius, padding 25px |
| `gs-card--compacto` | Seções menores | Variante com padding reduzido (14px 20px) |
| `gs-btn gs-btn-primario` | Botões de ação principal | Cor primária do sistema |
| `gs-btn gs-btn-secundario` | Botões secundários/config | Cinza |

### Regras de aplicação

1. **Todo arquivo `.html` de admin** deve ter `<main id="root" class="gs-card">` — sem exceção.
2. **Todo componente raiz React** deve começar com `UIHeaderPagina` como primeiro filho.
3. **Nunca** colocar conteúdo fora da estrutura `UIHeaderPagina → gs-conteudo-pagina → gs-card`.
4. Classes específicas legadas de uma página não substituem `gs-card`. Novas páginas usam `gs-card` diretamente.
5. O componente `UIHeaderPagina` fica em `public/src/components/UIHeaderPagina.jsx`.

### ⚠️ Anti-padrão crítico — onde o `gs-card` NÃO vai

O erro mais comum ao redesenhar páginas é colocar `gs-card` no **lugar errado**. A regra é simples: `gs-card` existe em dois lugares e apenas nesses dois.

**CORRETO — `gs-card` no `<main>` do HTML (a página inteira como card):**
```html
<!-- arquivo .html -->
<main id="root" class="gs-card"></main>
```
```jsx
// componente raiz — usa Fragment, NUNCA div com gs-card

export default function MinhaPage() {
    return (
        <>
            <UIHeaderPagina titulo="..." />
            <div className="gs-conteudo-pagina">
                <div className="gs-card">{/* seção A */}</div>
                <div className="gs-card">{/* seção B */}</div>
            </div>
        </>
    );
}
```

**ERRADO — `gs-card` dentro do componente React raiz (cria double-nesting):**
```html
<!-- arquivo .html — SEM gs-card -->
<main id="root"></main>
```
```jsx
// ❌ ERRADO: wrapping no componente raiz
export default function MinhaPage() {
    return (
        <div className="gs-card">  {/* ← NUNCA FAZER ISSO no componente raiz */}
            <UIHeaderPagina titulo="..." />
            ...
        </div>
    );
}
```

**Por que acontece o double-nesting?** Quando a página já tem `class="gs-card"` no `<main>` E o componente raiz adiciona outro `<div class="gs-card">`, o resultado é um card dentro de um card — padding duplicado, sombra dentro de sombra, visual quebrado.

**Por que acontece durante migrações?** O HTML legado tinha um `<div class="gs-card">` como container principal do JS. Ao portar para React, esse div é copiado junto como wrapper do componente raiz — mas na nova estrutura ele já existe no `<main>`. O componente raiz React deve usar `<>` (Fragment) e nunca um div externo.

**Checklist de migração de página (evitar este bug):**
1. No `.html`: trocar a tag raiz para `<main id="root" class="gs-card"></main>`
2. No componente React raiz: garantir que retorna `<>...</>`, nunca `<div className="gs-card">...</div>`
3. Confirmar visualmente que não há card duplo (padding excessivo nas bordas é o sintoma mais fácil de detectar)

**Componentes de aba também devem usar `<>` (Fragment) como raiz** — nunca `<div className="gs-card">`. O conteúdo da aba vive diretamente dentro de `gs-conteudo-pagina`, que já está dentro do `main.gs-card`. Adicionar um `gs-card` na raiz de um componente de aba cria card-dentro-de-card (padding duplo, sombra dupla — visual quebrado).

A **única exceção** é quando a aba tem sub-seções visualmente independentes: nesses casos, cada sub-seção pode ser um `gs-card` separado. Exemplo correto: `GPAprovacoesTab` tem duas sub-seções ("Pendentes" e "Histórico") que são `gs-card`s individuais dentro de um Fragment raiz. Exemplo errado: `GPRegistrosTab` (antes da correção) envolvia filtros + lista em um único `gs-card`, gerando card-dentro-de-card desnecessário.

---

## Status das Áreas

Tabela de controle para evitar retrabalho. Atualizar sempre que uma etapa for concluída.
A coluna **Troca contínua** indica se a página já elimina o intervalo vazio entre
“Mudando para…” e “Ambiente pronto” durante a troca de empresa.

| Área | Arquivo CSS | React 100% | TypeScript | CSS Limpo | Usa gs-card | Troca contínua | Observações |
|---|---|---|---|---|---|---|---|
| Login / Index | `login.css` | ✅ | ❌ | ✅ | N/A | N/A | Redesign aprovado e aplicado em 2026-07-28. React 100%, tablet-first, painel editorial de confecção sem pessoas e formulário claro com a paleta oficial. Login público neutro quanto às empresas. Token persistente de 30 dias; demitidos → tela de despedida + cooldown crescente. |

| Ordens de Produção | `ordens-de-producao.css` | ✅ | ⚠️ | ✅ | ✅ (via alias) | ❓ | Referência de qualidade. Trilha TS encerrada no escopo atual e publicada em `4a0da29`; componentes diretamente ligados ao ponto permanecem em JSX para a frente de jornada/redesign. |

| Calendário da Empresa | `calendario.css` | ✅ | ✅ | ✅ | ✅ | ❓ | Migrado para TypeScript em 02/08/2026 (`main-calendario.tsx` + `CalendarioCompleto.tsx` + `calendario-types.ts`). Typecheck ok. |

| Central de Alertas | `config-alertas.css` | ✅ | ✅ | ❌ | ✅ | ❓ | Redesenhada em 2026-05-16 com 2 abas: Alertas Gerais + Avisos Popups. Migrada para TypeScript em 02/08/2026 (`main-config-alertas.tsx` + `ConfigAlertasPage` + `ConfigAlertasGerais` + árvore `AvisosPopup*` + `alertas-types.ts`). Typecheck ok. `AlertasFAB` permanece em JSX (FAB compartilhado). Permissão: `configurar-alertas` / `gerenciar-avisos-popup`. |

| Centro de Incentivos | `incentivos.css` | ✅ | ✅ | ✅ | ✅ | ❓ | v5.1 concluído (2026-05-23). Migrado para TypeScript em 02/08/2026 (`main-incentivos.tsx` + árvore `Incen*` + `incentivos-types.ts`). Typecheck/build ok. Abas: Gincanas, Metas e Comissões, Pontos por Atividade, Pagamentos. Gincanas na dashboard migradas na Fase 6 (`DashGincana*` / `DashFabGincana`). |

| Central de Pagamentos | `central-de-pagamentos.css` | ✅ | ✅ | ✅ | ✅ | ❓ | React+TS desde 11/07/2026; **endurecimento TypeScript** em 01/08/2026 (tipos de domínio em `cpag-types.ts`, cliente único `fetchCpag`, sem `any`/`fetch` cru na árvore CPAG, payloads tipados). Shell padrão (`main.gs-card`, `UIHeaderPagina`, `gs-tab-nav`). Typecheck/build ok. Troca contínua multiempresa ainda `?`. |

| Dashboard Funcionário | `dashboard.css` | ✅ | ✅ | ❌ | ❌ | ❓ | Mobile-first. Migrada para TypeScript em 02/08/2026 (`index-dashboard.tsx` + `main-dashboard.tsx` + 27 componentes `Dash*` + `dashboard-types.ts`). Typecheck/build ok. Inclui gincanas (FAB/card), perfil, pagamentos, ranking, status ao vivo, avisos popup e bloqueio `DashCadeiaNaoMigrada`. |

| Arremates | `arremates.css` | ✅ | ❌ | ❌ | ✅ | ❓ | v1.0 (2026-05-04) + v2.0 (2026-05-05) + v3.0 Items 1-4 (2026-05-13/14) concluídos. v3.0: `PontoHelpers.js` e `UILinhaDoTempoDia.tsx` (compartilhado tipado) extraídos; `ArremateStatusCard` reescrito com layout `cracha-tiktik` idêntico ao OPStatusCard (cronômetro interval-aware, bottom sheets, tolerância S3, liberar intervalo); `ArreMatePainelAtividades` refatorado com estrutura `oa-*` idêntica ao OPPainelAtividades (ALMOCO/PAUSA no grid principal, inativos completos, todos os handlers de ponto). CSS: 4657 → 5850 linhas. v3.0 implementação 100% concluída (Items 1–5). Aguarda verificação manual em browser. Deletar manualmente: `ArremateToast.jsx` e `ArremateAcoesLote.jsx`. Ver `_planejamento/arremates-redesign.md`. |

| Embalagem de Produtos | `embalagem-page.css` | ✅ | ✅ | ✅ | ✅ | ❓ | Migração específica concluída em 2026-08-09: `main-embalagem.tsx` + `EmbalagemPage` + componentes `Embalagem*` + `embalagem-types.ts`/`embalagem-api.ts`. Legado específico removido; APIs e dependências compartilhadas em JS permanecem fora do escopo. Typecheck/build ok. Troca contínua ainda não validada manualmente em browser. |

| Estoque | `estoque.css` | ❓ | ❓ | ❌ | ❌ | ❓ | Verificar migração React |

| Financeiro | `financeiro.css` | ✅ | ✅ | ✅ | ✅ | ✅ | Migração React+TS **encerrada** (2026-07-27). Árvore única (`main-financeiro.tsx` + `FinanceiroPage` + `FinanceiroContext`), sem multi-root/bridges/legado. Troca empresarial sem reload concluída na `1.40.3`: atualiza token/contexto no mesmo documento, remonta apenas o `FinanceiroProvider` e mantém a transição até `lv:financeiro-pronto`. CSS limpo. Typecheck/build OK; validação manual das abas OK. **Novas features liberadas.** Plano: `_planejamento/migrando-financeiro-para-typescript.md`. |

| Auditoria da Gestão Organizacional | `gestao-organizacional.css` | ✅ | ✅ | ✅ | ✅ | ❓ | Migrada em 2026-08-07 para a aba Auditoria da Gestão Organizacional. O histórico usa `api/audit-log.js`, paginação, filtros por usuário/ação/período e isolamento pela empresa em foco. A rota independente e os componentes `Permissoes*` foram removidos. |

| Gestão Organizacional | `gestao-organizacional.css` | ✅ | ✅ | ✅ | ✅ | ❓ | Fase 5 concluída e aprovada em produção em 2026-07-28. Prefixo `GO*`. Migrado para TypeScript em 02/08/2026 (`main-gestao-organizacional.tsx` + árvore `GO*`/`GestaoOrganizacionalPage` + `go-types.ts`). Typecheck ok. Identidade e vínculo editados juntos, múltiplas empresas, encerramento contextual, cópia opcional de permissões e URL antiga compatível. |

| Home / Admin | `home.css` | ✅ | ✅ | ❌ | ❌ | ❓ | Migrada para TypeScript em 02/08/2026 (`main-home.tsx` + componentes `HOME*` + `home-types.ts`). O bloco `HOMEQuickActions` foi removido em 09/08/2026 por decisão do usuário. `AlertasFAB` permanece em JSX. |

| Gerenciar Produção | `gerenciar-producao.css` | ✅ | ❌ | ✅ | ✅ | ❓ | Concluída 2026-05-27. Prefixo `GP*`. Carregamento automático últimos 3 dias ao abrir. Fluxo duplo de exclusão: direta (`excluir-registro-producao-direto`) ou solicitação com aprovação (`excluir-registro-producao`). Painel de Aprovações com fila pendentes + histórico paginado + filtros. Permissões: `excluir-registro-producao`, `excluir-registro-producao-direto`, `ver-painel-aprovacoes-producao`, `aprovar-exclusao-producao`. Tabela `producoes_solicitacoes_exclusao` com snapshot JSONB e lock FOR UPDATE. Migration: `_planejamento/migration-gerenciar-producao-solicitacoes.sql`. API: `api/gerenciar-producao.js`. |

| Produção Geral | `producao-geral.css` | ✅ | ❌ | ✅ | ✅ | ❓ | v1.0 + v2.0 + v3.0 implementados (2026-04-26). Prefixo `PG*`, recharts, filtros client-side, PGMetaTimeline, banner histórico, Pontos Extras |

> Status de TypeScript: ✅ migrado para TypeScript | ⚠️ parcial/em transição | ❌ ainda não migrado | ❓ não verificado.

> ✅ Concluído | ⚠️ TS = em transição para TypeScript | ❌ Pendente | ❓ Não verificado — checar antes de trabalhar na área

> Troca contínua: ✅ sem intervalo vazio | ❌ bug confirmado | ❓ ainda não
> validado. Não marcar ✅ apenas porque o ambiente local foi rápido; validar com
> latência semelhante à produção.

---

## Componentes de Sistema — Padrões Obrigatórios

### `PontoHelpers.js` — Utilitários de Ponto/Tempo

**Arquivo:** `public/src/utils/PontoHelpers.js`

Funções puras compartilhadas entre `OPStatusCard` e `ArremateStatusCard` (e qualquer futuro card de funcionário).

| Export | Assinatura | Descrição |
|---|---|---|
| `calcularTempoEfetivo` | `(dataInicio, pontoHoje) → { ms, pausado, motivo }` | Cronômetro interval-aware: desconta almoço/pausa registrados no `ponto_diario`. Retorna `pausado: true` e `motivo: 'ALMOCO'\|'PAUSA'` quando o relógio deve estar congelado. |
| `formatarHora` | `(t) → string` | Converte 'HH:MM:SS' ou 'HH:MM' para exibição curta 'HH:MM'. Retorna '--:--' para null. |
| `formatarTempo` | `(ms) → string` | Converte ms para 'HH:MM:SS'. |

**Regra:** qualquer cronômetro de funcionário no sistema deve usar `calcularTempoEfetivo` — nunca calcular elapsed time bruto sem descontar intervalos.

---

### `UIAgenteIA` — Identidade Visual de IA

**Arquivo:** `public/src/components/UIAgenteIA.jsx`

**Regra absoluta:** qualquer funcionalidade que comunique processamento ou análise de IA ao usuário **deve usar este componente**. Não criar novos estilos de robô, terminal de IA, botão de agente ou loader de IA do zero — usar os exports deste arquivo.

**Exports disponíveis:**

| Export | Uso |
|---|---|
| `default UIAgenteIA` | Avatar standalone (círculo gradiente com robô). Tamanhos: `sm` / `md` / `lg`. |
| `BotaoIA` | Botão que aciona/desativa um agente. Props: `estado` (`idle`/`scanning`/`done`), `textoIdle`, `textoScanning`, `textoDone`, `onClick`. |
| `LoaderIA` | Carregamento com avatar + terminal monospace. Props: `fases` (array de `{texto}`), `faseAtual`, `mensagemFinal` (`{tipo, icone, texto}`). |

**Onde já é usado:** PainelDemandas (ChatbotLoader), OPCentralEncerramento (botão "Finalizar OPs"), OPCortesTela (botão "Plano de Corte").

**Identidade visual:**
- Avatar: gradiente `var(--gs-primaria) → #8e44ad`, circular, pulsa quando idle (tamanho lg), gira quando scanning
- Terminal: fundo `#f4f8fb`, fonte `Courier New`, prompt `›` / `✓`, cursor `▌` piscante
- Botão: neutro (cinza) no idle → azul no scanning/done


---

### `UIBloqueio` — Padrão Universal de Bloqueio por Permissão

**Arquivos:** `public/src/components/UIBloqueio.jsx` + `public/src/utils/bloqueio.js`

**Regra absoluta:** nunca sumir com elementos por falta de permissão. O elemento permanece visível, em estado bloqueado — com cadeado visual e popup ao clicar. Isso vale para botões, links de ação e qualquer elemento interativo.

**Três padrões de uso — escolha conforme o contexto CSS do elemento:**

#### Padrão A — Wrapper `<UIBloqueio>` (elementos em fluxo normal: flex, grid, block)

```jsx
import UIBloqueio from './UIBloqueio.jsx';

<UIBloqueio permissao="finalizar-op">
    <button onClick={handleFinalizar}>Finalizar OP</button>
</UIBloqueio>

// Com mensagem customizada:
<UIBloqueio permissao="cancelar-op" mensagem="Apenas supervisores podem cancelar OPs.">
    <button>Cancelar</button>
</UIBloqueio>
```

Quando bloqueado: renderiza um `div` wrapper (`display: inline-flex`) com overlay semitransparente + ícone de cadeado centralizado. O clique no overlay mostra o popup de "Acesso restrito" e não propaga para o filho.

**⚠️ NUNCA use quando o elemento tem layout que seria destruído pelo wrapper:**
- `position: absolute/fixed` — o wrapper cria `position: relative` que destrói o contexto de posicionamento
- `position: sticky` — o sticky perde a referência ao scroll container
- Flex item com `width: X%; align-self: Y` — o wrapper quebra essas constraints

Nesses casos, usar Padrão B ou C.

**⚠️ Bug "column stretch":** se o botão é flex item em `flex-direction: column` e esticava para preencher a largura (`align-self: stretch` padrão), adicionar `width: 100%` no CSS do botão — isso garante que ele preencha o wrapper após ser envolvido. Sem `width: 100%`, o botão fica com largura de conteúdo enquanto o wrapper ocupa a linha toda.

#### Padrão B — Inline com ícone duplo (elementos `position: absolute`, geralmente ícones)

Para botões absolutamente posicionados que mostram apenas ícone. Usa o "ícone duplo" — original esmaecido + cadeadinho badge.

```jsx
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio.js';

const podeExecutar = temPermissao('cancelar-op');

const handleClick = (e) => {
    e.stopPropagation();
    if (!podeExecutar) {
        mostrarPopupSemPermissao('Você não tem permissão para cancelar OPs.');
        return;
    }
    // lógica real...
};

// JSX: ícone duplo quando bloqueado (ação original esmaecida + cadeadinho badge)
<button className="meu-btn-absoluto" onClick={handleClick}>
    {podeExecutar ? (
        <i className="fas fa-trash-alt"></i>
    ) : (
        <span className="op-btn-cancelar-bloqueado">
            <i className="fas fa-trash-alt"></i>
            <i className="fas fa-lock"></i>
        </span>
    )}
</button>
```

O ícone duplo deixa claro que é **aquele botão** que está bloqueado, não o card inteiro.

**Referência:** `OPCard.jsx` (botão cancelar OP).

#### Padrão C — Inline com texto "Sem permissão" (botões com texto e layout restrito)

Para botões com texto visível que têm constraints de layout impeditivas para o wrapper (ex: `position: sticky`, `width: 50%` em flex column, FABs especiais). O botão fica visível em estado cinza com `<i className="fas fa-lock"></i> Sem permissão`.

```jsx
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio.js';

const podeExecutar = temPermissao('confirmar-lancamento');

<button
    className={`meu-btn${!podeExecutar ? ' meu-btn--bloqueado' : ''}`}
    onClick={() => {
        if (!podeExecutar) {
            mostrarPopupSemPermissao('Você não tem permissão para confirmar lançamentos.');
            return;
        }
        handleAcao();
    }}
    disabled={carregando}
>
    {carregando
        ? <><div className="spinner-btn-interno"></div> Processando...</>
        : !podeExecutar
            ? <><i className="fas fa-lock"></i> Sem permissão</>
            : <><i className="fas fa-check-double"></i> Confirmar</>
    }
</button>
```

**CSS necessário** (na página do botão):
```css
.meu-btn--bloqueado {
    background: linear-gradient(135deg, #94a3b8, #64748b) !important;
    /* ou cinza neutro, conforme a cor base do botão */
    cursor: not-allowed;
    opacity: 0.7;
}
.meu-btn--bloqueado:hover { /* mesma cor, sem hover effect */ }
```

**Referências:** `OPTelaConfirmacaoQtd.jsx`, `OPExternoTela.jsx`, `OPLancamentoExterno.jsx`, `OPCorteEstoqueCard.jsx`.

---

**Árvore de decisão — qual padrão usar:**

```
O botão tem position: absolute/fixed?
├── SIM + só ícone → Padrão B (ícone duplo)
└── NÃO
    ├── O wrapper UIBloqueio quebraria o layout?
    │   (sticky, width:%, align-self, FAB especial)
    │   ├── SIM → Padrão C (inline + "Sem permissão")
    │   └── NÃO → Padrão A (wrapper UIBloqueio)
    └── ← segue para Padrão A
```


**Checklist ao implementar qualquer bloqueio:**
1. Qual padrão? → Ver árvore de decisão acima.
2. Algum componente PAI passa o handler condicionalmente (`onHandler={temPermissao ? fn : null}`)? → Remover a condição do pai, o filho cuida do bloqueio.
3. Padrão A em flex column com botão que esticava? → Adicionar `width: 100%` no CSS do botão (ver Bug 5 no planejamento).

**Utilitários standalone** (`public/src/utils/bloqueio.js`) — funcionam fora do React:
- `temPermissao(permissao)` → `boolean` — lê `localStorage.permissoes`
- `mostrarPopupSemPermissao(mensagem?)` → void — cria popup de "Acesso restrito" no DOM diretamente

**CSS:** classes `gs-bloqueio-*` em `global-style.css`. Disponíveis em todas as páginas admin.

**Referências de implementação:**
- Padrão A: `OPEtapasModal.jsx` (Finalizar OP), `OPCortesRadar.jsx` (Registrar Corte)
- Padrão B: `OPCard.jsx` (Cancelar OP — lixeira absoluta)
- Padrão C: `OPTelaConfirmacaoQtd.jsx` (FAB Confirmar), `OPCorteEstoqueCard.jsx` (botão Gerar OP)

---

### `UICarregando` — Spinner Universal do Sistema

**Arquivo:** `public/src/components/UICarregando.tsx`

**Regra absoluta:** qualquer carregamento genérico de dados (busca de API, carregamento de página, atualização de aba) **deve usar este componente**. Nunca usar `<div className="spinner">`, textos de "Carregando..." ou implementações ad-hoc.

**⚠️ Diferença crítica com UIAgenteIA:** `UICarregando` é para **dados sendo buscados**. `UIAgenteIA.LoaderIA` é para **agente de IA processando ativamente** (com mensagens contextuais e identidade de robô). Não trocar um pelo outro.

**Props:**

| Prop | Valores | Padrão | Descrição |
|---|---|---|---|
| `variante` | `'bloco'` / `'pagina'` / `'inline'` | `'bloco'` | bloco = centraliza no pai; pagina = tela cheia; inline = compacto sem LV |
| `tamanho` | `'sm'` / `'md'` / `'lg'` | auto por variante | Tamanho do spinner (omitir para usar o padrão da variante) |
| `texto` | string | — | Texto opcional abaixo do spinner |

**Exemplos de uso:**
```jsx
// Aba carregando (mais comum)
{carregando && <UICarregando variante="bloco" />}

// Carregamento inicial de página
if (carregando) return <UICarregando variante="pagina" />;

// Dentro de um botão
<UICarregando variante="inline" />
```

**Para trocar o visual:** editar apenas as classes CSS `.ui-cg-*` em `global-style.css`. A lógica do componente não muda — assim toda a UI atualiza de uma vez.

**Visual aprovado em 2026-07-29:** núcleo operacional com marca central, órbitas,
nós e indicadores sequenciais, todos visíveis desde o primeiro frame. A marca
usa as iniciais e a `cor_identificacao` da empresa ativa já persistida pelo
contexto universal, com contraste calculado automaticamente; na ausência de
contexto usa `LV` e a cor primária como fallback. A variante `pagina` usa fundo
imersivo e mensagem padrão; `bloco` preserva fundo transparente; `inline` usa
três pontos compactos. O componente respeita `prefers-reduced-motion` e sua API
pública permanece inalterada.

**Regra de percepção imediata:** estrutura, módulos e marca devem estar visíveis
desde o primeiro frame. Animações do `UICarregando` não podem começar com
conteúdo central em `opacity: 0`, pois a maioria dos carregamentos termina em
aproximadamente dois segundos.

**Bootstrap visual obrigatório:** páginas administrativas devem incluir no HTML
um loader estático com as mesmas classes `.ui-cg-*` antes dos módulos React,
identificado por `#lv-initial-page-loader`. A entrada da página remove esse
loader somente depois da autenticação e/ou do primeiro estado React pronto;
páginas legadas usam `htmlUICarregando` e `removerCarregamentoInicial` em
`public/js/utils/ui-carregando.js`. A regra de visibilidade do `body` deve
permitir que esse overlay apareça antes de `body.autenticado`.

### Transição universal entre empresas

**Arquivos:** `MenuTransicaoEmpresa.tsx`, `useMenuContexto.ts` e
`menu-lateral.css`.

Ao trocar a empresa ativa, o sistema deve exibir a transição de contexto
aprovada, mostrando somente a empresa de origem e a empresa de destino. A
animação começa antes da chamada à API, permanece durante a emissão do novo JWT
e termina depois do reload com a confirmação do novo ambiente. O estado
necessário para atravessar a recarga usa `sessionStorage` e deve ser removido ao
concluir ou falhar. Não usar porcentagem falsa de progresso. A experiência deve
continuar acessível com `role="status"`, `aria-live` e movimento reduzido.

**Débito conhecido — intervalo vazio na troca:** páginas que ainda dependem de
`window.location.reload()` podem revelar apenas o fundo do documento entre a
fase “Mudando para…” e a retomada “Ambiente pronto”, sobretudo com a latência de
produção. O Financeiro não usa mais reload e é a implementação de referência:
`useMenuContexto` atualiza token, usuário, contexto e permissões no documento
atual, dispara `lv:empresa-contexto-alterado`; `FinanceiroPage` remonta somente o
provider empresarial; e a transição permanece até `lv:financeiro-pronto`.
Ao corrigir outra página, ela precisa recarregar integralmente os próprios dados
no novo contexto e emitir um sinal real de prontidão antes de ser marcada como
✅ na coluna **Troca contínua**. Não resolver apenas com atraso artificial,
spinner intermediário ou ocultação por CSS.

---

## Identidade Visual — Borda-Charme (padrão global)

A **borda-charme** é parte obrigatória da identidade visual dos cards que representam produtos, variantes ou ordens de produção. O padrão aprovado é o mesmo usado no grupo selecionado do menu lateral: contorno externo suave, cantos arredondados e uma faixa interna de destaque que acompanha o recorte arredondado do card.

A adoção ocorre em duas camadas:

1. **Regra estrutural global:** todo card novo ou refatorado de produto deve obedecer ao contrato abaixo.
2. **Migração visual gradual:** cards existentes serão convertidos página por página, preservando a semântica de cada domínio e validando as cores com o usuário.

Arremates, Embalagens de Produto e Estoque permanecem fora da migração visual desta iniciativa até autorização específica. Isso não libera a criação de cards novos nesses módulos fora do padrão.

### Implementação obrigatória

**JSX — todo card de produto deve conter a classe padrão única:**

```jsx
<div className="meu-card status-a">
    <div className="card-borda-charme" aria-hidden="true"></div>
    {/* restante do conteúdo */}
</div>
```

**CSS — geometria padrão do card e da borda:**

```css
.meu-card {
    --card-charme-cor: var(--gs-primaria, #3b82f6);
    position: relative;
    overflow: hidden;
    border: 1px solid var(--gs-borda, #dcdfe4);
    border-radius: 14px;
    background: #fff;
    box-shadow: 0 2px 7px rgba(15, 23, 42, 0.05);
}

/* Overlay completo: o box-shadow inset acompanha automaticamente o raio do pai. */
.meu-card .card-borda-charme {
    position: absolute;
    inset: 0;
    z-index: 2;
    border-radius: inherit;
    background: transparent;
    box-shadow: inset 3px 0 0 var(--card-charme-cor);
    pointer-events: none;
}

/* A cor sempre é definida no pai. */
.meu-card.status-a { --card-charme-cor: var(--cor-a); }
.meu-card.status-b { --card-charme-cor: var(--cor-b); }
```

### Regras críticas

1. **Todo card que representa produto, variante ou OP deve usar `card-borda-charme`.** Filtros, agentes, radares, painéis, containers, modais gerais e botões de escolha não devem usar a borda charme apenas por possuírem contorno ou sombra.
2. **A geometria padrão é `border: 1px solid var(--gs-borda, #dcdfe4)`, `border-radius: 14px`, sombra discreta e faixa interna de 3px.** A borda externa cinza é fixa e independente da cor da borda-charme. O padrão vale para cards pequenos e grandes.
3. **A borda deve ser um overlay com `inset: 0`, `border-radius: inherit` e `box-shadow: inset 3px 0 0`.** Não usar uma barra independente com `width`, `height: 100%` ou cantos hardcoded, pois ela não acompanha corretamente o arco do card.
4. **O card pai precisa de `position: relative` e `overflow: hidden`.** Isso garante que o contorno e a faixa respeitem os quatro cantos arredondados.
5. **A cor fica em uma variável/modificador do card pai**, nunca em classe de variante na própria borda e nunca como estilo inline no elemento `card-borda-charme`.
6. **As cores são definidas por página e contexto.** A geometria é global; a semântica de azul, verde, âmbar, vermelho etc. deve ser documentada no CSS da página e não inferida pela classe global.
7. **A faixa não pode bloquear interação.** Manter `pointer-events: none` e usar `aria-hidden="true"` quando ela for puramente decorativa.
8. **Cards legados de produto podem permanecer temporariamente fora do padrão somente durante uma migração aprovada.** Ao criar ou refatorar um card de produto, aplicar imediatamente o contrato novo; cards de interface que não representam produto permanecem sem a borda charme.

### Estado do piloto

A aba **OPs** de Ordens de Produção foi a primeira implementação aprovada. Seu padrão está em `public/css/ordens-de-producao.css`, escopado ao wrapper `.op-aba-gerenciamento`. As próximas páginas devem seguir o contrato global acima e ser migradas individualmente antes de qualquer alteração ampla no sistema.

O plano executável, a ordem das páginas, os gates de validação e os critérios de conclusão ficam em `_planejamento/plano-borda-charme-global.md`. Atualizar esse arquivo após cada frente aprovada.

---

## Estrutura de Produtos

### Produto Simples (`is_kit = false`)

É o produto físico que a costureira fabrica na máquina. Toda a lógica produtiva do sistema — OPs, cortes, arremates — opera **exclusivamente sobre produtos simples**.

Campos relevantes:
- `variacoes`: array com um objeto contendo `chave` (geralmente "cor") e `valores` (string com as cores separadas por vírgula).
- `etapas`: fases do processo produtivo. Cada etapa define `processo`, `maquina` e `feitoPor` (costureira, cortador, tiktik, etc.).
- `estrutura`: **sempre vazio e deve ser ignorado.** Foi uma ideia abandonada de registrar matéria-prima durante o desenvolvimento. O campo ainda existe no banco mas não tem significado funcional. Será removido futuramente.

### Kit (`is_kit = true`)

É um agrupamento comercial de produtos simples. **Kits não são fabricados — são montados.** Uma costureira nunca produz um kit; ela produz os produtos simples que depois compõem o kit.

Campos relevantes:
- `grade`: array de variações do kit. Cada item da grade tem seu próprio `sku`, `imagem`, `variacao` (nome temático, ex: "Tudo Preto") e `composicao` — que lista quais produtos simples entram, em quais variações e em quais quantidades.
- `etapas`: sempre vazio `[]`. Kits não têm etapas produtivas.

### Onde cada tipo aparece no sistema

| Área | Produto Simples | Kit |
|---|---|---|
| Ordens de Produção | ✅ Sempre | ❌ Nunca |
| Arremates | ✅ Sempre | ❌ Nunca |
| Cortes | ✅ Sempre | ❌ Nunca |
| Embalagem de Produtos | ✅ Como componente | ✅ Como produto final montado |

Um kit só entra em cena na tela de **Embalagem de Produtos**, onde os produtos simples já arrematados são montados conforme a composição definida na `grade` do kit.

---

## Regras de Negócio Críticas

### OPs — Ordens de Produção

#### Saldo Fantasma

Uma OP é criada com uma `quantidade` estimada, mas pode ser **finalizada** com uma quantidade diferente (`quantidade_real_produzida`). A diferença entre a quantidade da abertura e a `quantidade_real_produzida` é chamada de **saldo fantasma** — esse valor **não existe fisicamente**, não foi produzido nem arrematado, e deve ser **sempre ignorado** em cálculos de estoque e arremate.

```
saldo_fantasma = quantidade_abertura - quantidade_real_produzida
// Deve ser descartado. Não representa nada físico.
```

#### Saldo de Arremate

O saldo disponível para arremate de uma OP é:
```
saldo_arremate_op = quantidade_real_produzida - total_ja_arrematado
// Só considerar se saldo_arremate_op > 0
```

O campo `saldo_op` que possa existir no banco **não deve ser usado** — ele inclui o saldo fantasma e causa erros.

#### Estratégia "Bulk Data" (Performance)

Para calcular saldos de múltiplos produtos ao mesmo tempo, **não fazer N+1 queries**. O padrão adotado é:

1. Buscar em paralelo (`Promise.all`) todos os dados brutos necessários: OPs finalizadas, arremates, sessões ativas, saldos de estoque, produtos, itens arquivados.
2. Criar `Map`s JavaScript para acesso O(1).
3. Calcular toda a lógica de negócio em memória no Node.js.
4. Retornar o resultado montado.

Esse padrão existe em `api/arremates.js` e deve ser replicado onde houver necessidade de cálculos cruzados de OPs.

---

## Informações de Deploy

- **Produção:** Vercel (serverless). As funções em `api/` viram serverless functions automaticamente via `vercel.json`.
- **Variáveis de ambiente necessárias:** `POSTGRES_URL`, `JWT_SECRET`, `CRON_SECRET` e outras definidas no `.env` (não comitar o `.env`).
- **Build:** `npm run build` gera o `dist/` que o Vercel serve.
- **Vercel Cron Jobs (plano Pro):** configurados em `vercel.json` → `"crons"`. Dois jobs ativos:
  - `GET /api/cron/arquivar-concluidas` — `48 2 * * *` (2h48 UTC, diário) — arquiva demandas concluídas
  - `GET /api/cron/registrar-intervalos` — `*/5 10-20 * * *` (a cada 5min, 10h–20h UTC = 7h–17h SP) — detecta S1/S2 e grava intervalos no `ponto_diario` independente de qualquer supervisor estar com a tela aberta. Auth via header `Authorization: Bearer CRON_SECRET`.

### Ambiente de produção

O staging foi abandonado e não faz parte do fluxo do projeto. O ambiente ativo é
a produção na branch `main`, com banco Neon `sistema_lv_db` em `sa-east-1`.

Para mudanças de banco, o fluxo obrigatório é: backup completo validado,
restauração e ensaio local, autorização explícita, execução em produção e
validação pós-migration.

---

## Cortes — Número do PC (pn) e a Sequence `cortes_pn_seq`

### Por que existe a sequence

O campo `pn` (número do Pedido de Corte) em cada registro da tabela `cortes` deve ser **único**. O sistema antigo gerava esse número no Node.js com `SELECT MAX(pn) + 1` — uma operação leia-depois-escreva sem lock, sujeita a race condition: se dois cortes fossem registrados simultaneamente (ex: Modo Express registrando 6 de uma vez), ambos podiam ler o mesmo MAX e tentar inserir o mesmo pn, resultando em erro de chave duplicada.

### Como a sequence resolve

Uma **sequence do PostgreSQL** é um objeto atômico do banco — incrementar e retornar o próximo valor é uma operação indivisível. Não importa quantos clientes chamem `nextval('cortes_pn_seq')` ao mesmo tempo: cada um recebe um número diferente, sem colisão e sem necessidade de lock ou transação extra.

### Como está implementado (2026-05-16)


**`POST /api/cortes`** — o campo `pn` é **opcional** no body. O INSERT usa:
```sql
COALESCE($7, nextval('cortes_pn_seq')::text)
```
- Se `pn` é enviado (código legado ainda ativo): usa o valor enviado.
- Se `pn` é `null`/não enviado: o banco gera atomicamente via sequence.

**Frontend — quem NÃO envia `pn` (usa sequence automaticamente):**
- `OPQuickLogModal.jsx` — registro rápido avulso (Normal e Express)
- `OPCriarModal.jsx` — criação de corte+OP pelo Painel de Demandas

**Frontend — quem ainda ENVIA `pn` (código legado):**
- `OPRegistroCorte.jsx` — wizard de 3 passos (planejado para deleção após `OPQuickLogModal` ser validado em produção)

**Migration rodada em produção (2026-05-16):** `_planejamento/migration-cortes-pn-seq.sql`

### Regra para código novo

Qualquer novo código que crie cortes via `POST /api/cortes` **não deve enviar `pn`**. O banco gera o número. Não chamar `GET /api/cortes/next-pc-number` — esse endpoint existe apenas por compatibilidade com `OPRegistroCorte.jsx` e será removido junto com ele.

---

## Funcionalidades Implementadas — OPs (referência)


### Correção crítica — Finalização e Arremate (PUT `/api/ordens-de-producao`)
- Ao finalizar uma OP, o PUT **sempre recalcula `etapas`** a partir da tabela `producoes`
- Isso garante que `etapa.quantidade` no JSON salvo reflita o real produzido, não o valor estimado
- Sem essa correção, OPs finalizadas em lote não chegavam à fila de arremates (quantidade era 0)

### global-style.css — Dependência obrigatória para todas as páginas admin
O `global-style.css` define `body { visibility: hidden }` e `body.autenticado { visibility: visible }`. Páginas sem ele ficam com o body visível mas **sem os estilos dos agentes globais** (FAB + modal sem formatação). Todas as páginas `/admin/*.html` devem incluir `global-style.css` antes dos outros CSS. Páginas que estavam sem e foram corrigidas: `gerenciar-producao.html`, `ponto-por-processo.html`, `cadastrar-produto.html`.

---


## Versionamento

O projeto usa **SemVer** (`MAJOR.MINOR.PATCH`). A versão fica em `package.json` e é injetada no build pelo Vite como `__APP_VERSION__`, exibida no rodapé do menu lateral.

**Fluxo de release (PowerShell — rodar separado):**
```bash
# 1. Atualizar changelog-data.js com as novidades (admin e/ou dashboard)
# 2. Commitar todas as alterações:
git add .
git commit -m "feat: descrição do que mudou"
# 3. Bumpar a versão (escolher um):
npm version patch   # bug fix:      1.21.0 → 1.21.1
npm version minor   # feature nova: 1.21.0 → 1.22.0
npm version major   # breaking:     1.21.0 → 2.0.0
# 4. Push (dois comandos separados no PowerShell):
git push
git push --tags
# 5. Vercel faz o deploy automaticamente
```

### Versioning por audiência — como funciona

O arquivo `public/js/utils/changelog-data.js` é a **fonte de verdade** das notas de versão. Cada entrada tem campos independentes:

- `versao` — versão do admin; vem do `package.json` via `npm version`
- `versao_dashboard` — versão independente da dashboard; **campo opcional**, preencher apenas quando `dashboard[]` não estiver vazio. Incrementar manualmente (ex: `1.21.0` → `1.22.0`), sem se preocupar com o número do admin
- `admin` — novidades para o painel administrativo (linguagem técnica/funcional)
- `dashboard` — novidades para as funcionárias (linguagem simples)

Deixar `dashboard: []` significa que aquela versão não teve mudanças para as funcionárias — ela não aparece na dashboard.

**Admin (`UIHeaderPagina` / menu lateral):** exibe `__APP_VERSION__` do `package.json`. O modal mostra todas as entradas com `admin.length > 0`, marcando a primeira como "Atual".

**Dashboard (`DashVersionFooter`):** exibe `versao_dashboard` da última entrada com conteúdo de dashboard (com fallback para `versao` se o campo não existir). As sequências de versão são completamente independentes: o admin pode estar em `1.35.0` enquanto a dashboard está em `1.24.0`, e isso é intencional.

> **Regra prática:** ao fazer um release só de admin, deixe `dashboard: []` e não coloque `versao_dashboard`. Quando houver novidade para as funcionárias, preencha `dashboard[]` e adicione `versao_dashboard` com o próximo número da sequência da dashboard (olhe a última entrada que tem `versao_dashboard` e incremente).

Repositório: `https://github.com/juancbx1/sistema-lv`

---

## Sistema de Gincanas — Centro de Incentivos (v3.0 — 2026-05-19)

### Regras absolutas (nunca violar)

- Gincanas **só leem** dados de produção — a única exceção é escrever em `gincanas`, `gincanas_premios_ganhos` (registro de premiações). Nunca alteram `producoes`, `arremates`, `banco_pontos_log`.
- **Exceção única à regra de isolamento (v4.0):** `api/producoes.js` chama `verificarGincanasAposProducao` (exportado de `api/gincanas.js`) **após** o COMMIT da transação principal de produção. Falha no hook nunca afeta a resposta da API de produção (try/catch silencioso). Hook executado apenas para costureiras; tiktiks aguardam implementação do hook em `api/arremates.js`.
- **Dois mundos financeiros completamente separados** — comissões e premiações nunca se misturam (exigência legal trabalhista)
- **Anonimato total** na dashboard — funcionária só vê sua posição numérica, nunca nomes ou pontuações alheias
- `banco_pontos_log` é exclusivo de comissões — gincanas não tocam nessa tabela

### Tabelas do banco

```sql
-- Tabela principal
gincanas (id, nome, descricao, banner_emoji, participantes, modalidade, tipo_premiacao,
           escopo_atividade, produto_id, tipo_recorrencia,
           datetime_inicio, datetime_fim, hora_inicio_semana, hora_fim_semana,
           status, visivel_dashboard,
           vencedor_id, encerrada_com_ganhador,   -- para tipo corrida
           criado_por, criado_em, atualizado_em)

-- Premiações por nível (meta_valor = pontos OU unidades, depende do escopo)
-- valor_premio_reais = valor monetário do prêmio em R$ (adicionado em v5.1 — migration-gincanas-valor-premio.sql)
-- descricao_premio = texto de chamada ex: "Faça 500 pts e receba R$ 20,00." (auto-gerado pelo wizard)
gincanas_premiacoes (id, gincana_id, nivel_label, emoji_icone, meta_valor, descricao_premio, valor_premio_reais, ordem, criado_em)

-- Prêmios ganhos — rastreamento de pagamentos (SEPARADO de banco_pontos_log)
gincanas_premios_ganhos (id, gincana_id, usuario_id, nivel_label, descricao_premio, valor_reais,
                          ganho_em, pago_em, pago_por, semana_ref, criado_em)
```

**Migrations:** `_planejamento/migration-gincanas.sql` (v1.0) + `_planejamento/migration-gincanas-v3.sql` (v3.0) + `_planejamento/migration-gincanas-valor-premio.sql` (v5.1 — todas já rodadas em produção)

**Valores de enum:**
- `status`: `'rascunho'` | `'publicada'` | `'cancelada'`
- `tipo_premiacao`: `'meta'` (todos que atingirem ganham) | `'corrida'` (primeiro a atingir ganha)
- `modalidade`: `'individual'` | `'equipe'` (meta coletiva, prêmio individual)
- `escopo_atividade`: `'tudo'` | `'apenas_processos_op'` | `'apenas_arremates'` | `'produto_especifico'`
- `participantes`: `'costureiras'` | `'tiktiks'` | `'ambos'`
- `tipo_recorrencia`: `'unica'` | `'semanal'`

**Idempotência de prêmios:** índices únicos em `gincanas_premios_ganhos` garantem 1 prêmio por (gincana, usuário) em únicas e 1 por (gincana, usuário, semana_ref) em semanais.

### Dois mundos financeiros

| | Comissões | Premiações |
|---|---|---|
| Origem | Produção real (pontos) | Gincanas (R$ fixo) |
| Tabela fonte | `banco_pontos_log` (intocada por gincanas) | `gincanas_premios_ganhos` |
| Cadência de pagamento | 5º dia útil do mês | Toda sexta-feira |
| Dashboard | Bolso "Comissões" em `DashPagamentosModal` | Bolso "Premiações" em `DashPagamentosModal` |


### Fase calculada em runtime

A `fase` **não é armazenada** — derivada em `calcularFase()` comparando `NOW()` com os timestamps:

| Fase | Significado |
|---|---|
| `proxima` | Antes do início |
| `ao_vivo` | Dentro do período |
| `encerrada` | Até 48h após o fim |
| `arquivada` | Mais de 48h após o fim |
| `encerrada_semana` | Gincana semanal: semana acabou, campanha ainda ativa |

**Exceção corrida:** quando `encerrada_com_ganhador = TRUE`, a fase passa a `encerrada` imediatamente (independente do datetime).

### Race detection — tipo corrida

Detecção lazy: acontece no momento do fetch de `/api/gincanas/dashboard`. Quando `meu_valor >= meta_valor`:
1. `UPDATE gincanas SET vencedor_id=$userId, encerrada_com_ganhador=TRUE WHERE id=$id AND encerrada_com_ganhador=FALSE RETURNING id` — atômico
2. Se 0 linhas: alguém ganhou antes. Se 1 linha: sou o vencedor → INSERT em `gincanas_premios_ganhos`

**Idempotência:** `ON CONFLICT DO NOTHING` garante que não registra duas vezes.

### Escopo produto_especifico

Quando `escopo_atividade = 'produto_especifico'`:
- A métrica é `producoes.quantidade` (unidades físicas), não pontos
- `produto_id` em `gincanas` identifica o produto monitorado
- `meta_valor` em `gincanas_premiacoes` representa unidades (não pontos)
- A UI troca "pontos" por "unidades" em todos os lugares

### Registro lazy de vencedores (tipo meta)

Para gincanas do tipo `meta` que já estão `encerrada` ou `encerrada_semana`, os vencedores são registrados em `gincanas_premios_ganhos` no momento em que qualquer usuário acessa `/dashboard` ou `/ranking`. Usa `ON CONFLICT DO NOTHING` — seguro chamar múltiplas vezes.

### APIs

**`api/gincanas.js`** — CRUD + dashboard + ranking:

| Rota | Permissão | Descrição |
|---|---|---|
| `GET /api/gincanas?filtro=` | `acesso-ponto-por-processo` | Lista admin com fase calculada |
| `GET /api/gincanas/dashboard` | JWT válido | Gincanas visíveis + progresso + race detection |
| `GET /api/gincanas/:id` | `acesso-ponto-por-processo` | Detalhes + premiações |
| `GET /api/gincanas/:id/ranking` | `acesso-ponto-por-processo` | Ranking completo + status pagamento |
| `POST /api/gincanas` | `gerenciar-gincanas` | Cria rascunho |
| `PUT /api/gincanas/:id` | `gerenciar-gincanas` | Edita (só rascunho) |
| `PATCH /api/gincanas/:id/publicar` | `gerenciar-gincanas` | Publica + aviso popup |
| `PATCH /api/gincanas/:id/cancelar` | `gerenciar-gincanas` | Cancela |
| `DELETE /api/gincanas/:id` | `gerenciar-gincanas` | Deleta (rascunho ou cancelada) |

**`api/gincanas-pagamentos.js`** — fila de pagamento de premiações:

| Rota | Permissão | Descrição |
|---|---|---|
| `GET /api/gincanas-pagamentos/fila` | `pagar-premiacoes-gincanas` | Prêmios pendentes (semana atual + atrasados) |
| `GET /api/gincanas-pagamentos/historico` | `pagar-premiacoes-gincanas` | Prêmios pagos (últimos 200) |
| `POST /api/gincanas-pagamentos/pagar-lote` | `pagar-premiacoes-gincanas` | Paga todos os pendentes (ou IDs específicos) |
| `POST /api/gincanas-pagamentos/:id/pagar` | `pagar-premiacoes-gincanas` | Paga prêmio individual |
| `GET /api/gincanas-pagamentos/meus-premios` | JWT válido | Prêmios da funcionária logada (para a wallet) |

### Componentes admin (prefixo `Incen*`)

| Componente | Descrição |
|---|---|
| `IncenGincanasTab` | Aba de gincanas com sub-filtros (Ao Vivo / Próximas / Rascunhos / Arquivo) |
| `IncenGincanaCard` | Card com badges de fase, tipo (🏁 CORRIDA / 👥 EQUIPE), borda-charme por fase |
| `IncenGincanaModal` | **Wizard 3 passos:** O Básico → As Regras → O Prêmio |
| `IncenGincanaRankingModal` | Ranking completo com suporte a corrida/equipe/produto_especifico + coluna 💰 de pagamento |
| `IncenPagamentosTab` | Fila de pagamento semanal + botão "Pagar todos" + histórico |
| `IncenMetasTab` | Aba React/TypeScript para versões, regras, grupos e condições de metas |
| `IncenPontosTab` | Aba React/TypeScript para pontos padrão por atividade e produto |

**Atenção no card:** `gincana.status` controla botões de ação. `gincana.fase` é só visual. Rascunho com datetime passado ainda mostra "Publicar" — correto por design.

### Componentes dashboard (prefixo `Dash*`)

- `DashGincanaCard` — lista de cards de gincanas para a funcionária. Suporta todos os tipos: proxima (countdown), ao_vivo (barra progresso), encerrada (resultado). Lida com corrida (vencedor/sem ganhador), equipe (progresso coletivo), produto_especifico (unidades). Mostra `InfoPagamento` quando prêmio foi registrado.
- `DashPagamentosModal` — **dois bolsos separados:** aba "Comissões" (fonte: `banco_pontos_log`) e aba "Premiações" (fonte: `gincanas_premios_ganhos` via `/meus-premios`).

### Página admin

- **HTML:** `public/admin/incentivos.html`
- **Entry point:** `public/src/main-incentivos.tsx` — 4 abas: Gincanas / Metas / Pontos / Pagamentos
- **CSS:** `public/css/incentivos.css`

### Arquivos legados auditados

- A auditoria de 2026-08-09 confirmou que
  `public/admin/ponto-por-processo.html`,
  `public/js/admin-ponto-por-processo.js`,
  `public/css/ponto-por-processo.css` e
  `public/js/pages/admin-ponto-por-processo.js` não existem mais no workspace.
- As abas Metas e Pontos são atendidas pelos componentes TSX atuais. O utilitário
  compartilhado `public/js/utils/metas.js` permanece ativo para consumidores de
  cálculo, e o ID `acesso-ponto-por-processo` continua preservado.

### Fluxo de publicação

1. Criar (→ rascunho)
2. Publicar → aviso popup inserido em `avisos_popup` (se checkbox marcado)
3. Gincana aparece na dashboard das participantes
4. Gincana encerra → vencedores registrados em `gincanas_premios_ganhos` (lazy)
5. Supervisor acessa aba Pagamentos no admin → paga em lote toda sexta
6. Funcionária vê prêmio pago no bolso "Premiações" do `DashPagamentosModal`

---

## Observações para o Codex

- Ao criar novos componentes React, seguir o padrão de prefixo por domínio e colocar **sempre** em `public/src/components/` — nunca em subpastas.
- Ao criar novas rotas de API, adicionar o import e o `app.use` correspondente no `server.js`.
- **Nunca usar `saldo_op` diretamente** — calcular sempre a partir de `quantidade_real_produzida - total_ja_arrematado`.
- O arquivo `regra de negocio das OP.txt` na raiz contém exemplos concretos das regras de OP com dados reais do banco.
- Ao tomar uma decisão arquitetural importante ou implementar uma regra de negócio nova, **atualizar este AGENTS.md**.
- A pasta `_planejamento/` na raiz contém planos detalhados por funcionalidade (spec, checklist, decisões). **Sempre ler o arquivo relevante antes de começar a implementar qualquer coisa**. Arquivos existentes: `central-de-alertas.md`, `horario-empregados.md`, `producao-geral.md`, `organizacao-sistemica.md`, `gincanas.md`.
- **Nunca usar `is_test` users em cálculos, listagens ou relatórios** — o filtro já está nas queries principais, mas atentar ao criar novas queries que listem funcionários.
- **A tabela `usuarios` NÃO tem coluna `ativo`** — usar `data_demissao IS NULL` para filtrar funcionários ativos. O campo `ativo` existe em outras tabelas (avatares, configuracoes, etc.), nunca em `usuarios`.

### Decisão arquitetural — Financeiro em React + TypeScript (encerrada)

- A página `public/admin/financeiro.html` é integralmente React + TypeScript: `main-financeiro.tsx` + `FinanceiroPage` + `FinanceiroContext`.
- Sem `admin-financeiro.js`, sem multi-root e sem bridges `window`/`CustomEvent` para comunicação interna da página.
- **Migração encerrada em 2026-07-27** (validação manual OK; CSS limpo). **Novas features liberadas.**
- Features novas devem continuar em `.ts`/`.tsx` na árvore única.

### Migração progressiva para TypeScript (em andamento — 2026-08-02)

Objetivo: migrar o frontend React de JSX/JS para TypeScript por fases, sem
alterar comportamento de negócio. Validação mínima de cada fase: `npm run
typecheck` (`tsc --noEmit`). Sem commit/push automático (regra do projeto).

#### Já estavam em TypeScript (antes desta frente)

| Domínio | Entry / raiz | Tipos / utils |
|---|---|---|
| Financeiro | `main-financeiro.tsx` + `FinanceiroPage` + `FinanceiroContext` | `financeiro-api.ts`, `financeiro-types.ts` |
| Central de Pagamentos | `main-cpag.tsx` + árvore `CPAG*` | `cpag-api.ts`, `cpag-types.ts`, `cpag-auth.ts`, etc. |
| Menu Lateral (compartilhado) | `main-menu-lateral.tsx` + `Menu*` | `menu-types.ts`, `menu-catalogo.ts`, `useMenuContexto.ts` |

#### Fases 1–7 concluídas e revisadas em 2026-08-02

Ordem executada: (1) UI compartilhados → (2) Calendário → (3) Gestão
Organizacional → (4) Central de Alertas → (5) Centro de Incentivos →
(6) Dashboard das empregadas (+ todos os `Dash*`) → (7) Home admin.
Revisão: typecheck ok; HTMLs das páginas migradas apontam para entry `.tsx`.

**Fase 1 — UI compartilhados**

| Arquivo | Notas |
|---|---|
| `UIHeaderPagina.tsx` | Header padrão de página admin |
| `UICarregando.tsx` | Spinner universal (variantes bloco/página/inline + marca da empresa) |
| `UIBloqueio.tsx` | Wrapper de bloqueio por permissão |
| `UIFeedbackNotFound.tsx` | Estado vazio / sem resultados |
| `UIPaginacao.tsx` | Ponte para `window.renderizarPaginacao` (tipado em `vite-env.d.ts`) |
| `UIFiltrosAtivos.tsx` | Pílulas de filtros ativos |
| `UIAgenteIA.tsx` | Avatar + `BotaoIA` + `LoaderIA` |
| `UIBuscaInteligente.tsx` | Busca com debounce/histórico + `filtrarListaInteligente` / `normalizarTexto` |
| `UILinhaDoTempoDia.tsx` | Timeline de jornada (OP/Arremates) |
| `DSUploader.tsx` | Upload de imagem (dropzone/avatar/inline) |
| `utils/bloqueio.ts` | `temPermissao`, `mostrarPopupSemPermissao` |
| `utils/searchHelpers.ts` | `normalizeText`, histórico de buscas |

Já estavam em TS nesta família: `UIAutocompleteAPI`, `UIBadge`, `UILogItem`,
`UINaoEncontradoBusca`, `UISearchableSelect`, `PerfilAvatarStudio`.

Imports de consumidores atualizados para o módulo sem extensão `.jsx` (ex.:
`from './UICarregando'`). Os `.jsx`/`.js` equivalentes foram removidos.

**Fase 2 — Calendário da Empresa**

| Arquivo | Notas |
|---|---|
| `main-calendario.tsx` | Entry + ErrorBoundary + auth |
| `CalendarioCompleto.tsx` | FullCalendar, modais, CRUD de eventos |
| `utils/calendario-types.ts` | Tipos de evento, form, JWT, day modal, etc. |
| `admin/calendario.html` | Script: `/src/main-calendario.tsx` |

**Fase 3 — Gestão Organizacional**

| Arquivo | Notas |
|---|---|
| `main-gestao-organizacional.tsx` | Entry (StrictMode) |
| `GestaoOrganizacionalPage.tsx` | Shell, abas, orquestração de modais |
| `GOPessoasTab.tsx` / `GOEmpresasTab.tsx` | Abas |
| `GOPessoaCard.tsx` / `GOEmpresaCard.tsx` | Cards |
| `GOPessoaModal.tsx` / `GOEmpresaModal.tsx` | Modais de cadastro/edição |
| `GOVinculoModal.tsx` | Vínculo + `GOVinculoCampos`, `classificarVinculo`, `VINCULO_INICIAL`, `JORNADA_INICIAL`, `TIPOS_VINCULO` |
| `GOIdentidadeCampos.tsx` | Identidade global + `IDENTIDADE_INICIAL` |
| `utils/go-types.ts` | Tipos de pessoa, empresa, vínculo, escopo, forms |
| `admin/gestao-organizacional.html` | Script: `/src/main-gestao-organizacional.tsx` |
| `admin/usuarios-cadastrados.html` | URL legada compatível — mesmo entry `.tsx` |

**Fase 4 — Central de Alertas**

| Arquivo | Notas |
|---|---|
| `main-config-alertas.tsx` | Entry + auth (`configurar-alertas`) |
| `pages/ConfigAlertas/ConfigAlertasPage.tsx` | Shell com abas Alertas Gerais / Avisos Popups |
| `pages/ConfigAlertas/AlertaCard.tsx` | Card de configuração por tipo de alerta |
| `pages/ConfigAlertas/DiasTrabalhoCard.tsx` | Calendário de operação (dias da semana) |
| `pages/ConfigAlertas/HorariosCard.tsx` | Expediente + janela de polling |
| `ConfigAlertasGerais.tsx` | Aba Alertas Gerais (load/save configs) |
| `AvisosPopupAdmin.tsx` | Aba Avisos: modelos / ativos / arquivados |
| `AvisosPopupModal.tsx` | Criar/editar/duplicar/usar-template + preview |
| `AvisosPopupGaleria.tsx` | Galeria de imagens no Vercel Blob |
| `AvisosPopupViewersModal.tsx` | Quem visualizou / não visualizou |
| `utils/alertas-types.ts` | Tipos de alertas, avisos, galeria e viewers |
| `admin/config-alertas.html` | Script: `/src/main-config-alertas.tsx` |

Fora do escopo desta fase (permanece JSX): `AlertasFAB.jsx` — FAB compartilhado
por várias páginas admin, não é a árvore da Central de Alertas.

**Fase 5 — Centro de Incentivos**

| Arquivo | Notas |
|---|---|
| `main-incentivos.tsx` | Entry + auth + shell de abas + botão Nova Gincana |
| `IncenGincanasTab.tsx` | Lista/filtros de gincanas + integração com modal/ranking |
| `IncenGincanaCard.tsx` | Card com fase, badges e ações |
| `IncenGincanaModal.tsx` | Wizard de criação/edição (3 passos) |
| `IncenGincanaRankingModal.tsx` | Ranking + status de pagamento |
| `IncenMetasTab.tsx` | Metas e comissões |
| `IncenPontosTab.tsx` | Pontos por atividade |
| `IncenPagamentosTab.tsx` | Fila e histórico de premiações |
| `utils/incentivos-types.ts` | Tipos de gincana, metas, pontos e pagamentos |
| `admin/incentivos.html` | Script: `/src/main-incentivos.tsx` |

Fora do escopo da Fase 5 (APIs): `api/gincanas*.js` permanecem em JS.

**Fase 6 — Dashboard das empregadas (+ todos os `Dash*`)**

| Arquivo | Notas |
|---|---|
| `index-dashboard.tsx` | Entry React no `#root-dashboard` |
| `main-dashboard.tsx` | Shell: menu, foco, projeção, atividades, modais, avisos |
| `DashMenuLateral.tsx` | Menu + ranking + empresa + versão |
| `DashFocoHoje.tsx` / `DashProjecaoCiclo*.tsx` | Meta do dia e projeção do ciclo |
| `DashAtividades*`.tsx / `DashTabelaPontos*`.tsx | Timeline e tabela de pontos |
| `DashStatusAtualModal.tsx` / `DashStatusAtualFab.tsx` | Status ao vivo |
| `DashFabGincana.tsx` / `DashGincanaCard.tsx` | Gincanas na dashboard |
| `DashPagamentosModal.tsx` / `DashCofreModal.tsx` | Carteira e cofre |
| `DashPerfil*`.tsx | Perfil, streak, conquistas, gincanas do ciclo |
| `DashRankingMenu.tsx` / `DashRankingCard.tsx` | Ranking anônimo |
| `DashAvisoPopup.tsx` / `DashCadeiaNaoMigrada.tsx` | Avisos e bloqueio multiempresa |
| `DashDesempenhoModal.tsx` / `DashTabelaCiclo.tsx` | Desempenho do ciclo |
| `DashHeader.tsx` / `DashVersionFooter.tsx` | Header legado + rodapé de versão |
| `utils/dashboard-types.ts` | Tipos de desempenho, meta, status, gincana, etc. |
| `dashboard/dashboard.html` | Script: `/src/index-dashboard.tsx` |

**Fase 7 — Home administrativa**

| Arquivo | Notas |
|---|---|
| `main-home.tsx` | Entry + auth + montagem no `#home-react-root` |
| `HOMEHeader.tsx` | Saudação por horário + data por extenso |
| `HOMENews.tsx` | Card de novidades |
| `HOMEFocus.tsx` / `HOMERecents.tsx` | Foco diário e acessos recentes |
| `HOMECommandPalette.tsx` | Central de comandos filtrada por contexto |
| `utils/home-types.ts` | Usuário, autenticação e workspace da Home |
| `admin/home.html` | Script: `/src/main-home.tsx` |

Fora do escopo desta fase (permanece JSX): `AlertasFAB.jsx` — FAB compartilhado.

**Fase 8 — Login (iniciada em 2026-08-03)**

- O entry point público foi migrado de `main-login.jsx` para
  `main-login.tsx`, e o componente raiz de autenticação foi migrado de
  `LoginApp.jsx` para `LoginApp.tsx`.
- A migração preservou o fluxo de autenticação, bloqueio temporário, estados de
  carregamento/despedida e redirecionamento. `npm run typecheck`, `npm run build`
  e `git diff --check` passaram após a conclusão da fatia.

#### Entry points React em TypeScript (estado atual)

Em TS: `main-financeiro`, `main-cpag`, `main-menu-lateral`, `main-calendario`,
`main-gestao-organizacional`, `main-config-alertas`, `main-incentivos`,
`index-dashboard` / `main-dashboard`, `main-home`, `main-login`.

Ainda em JSX: OP, arremates, embalagem, estoque, permissões, produção geral,
gerenciar produção, usuários legado (`main-usuarios`), agentes globais.
`AlertasFAB` continua em JSX (FAB admin compartilhado).

#### Regras desta migração

- Preferir tipagem de domínio em `public/src/utils/*-types.ts` (padrão já usado
  por Financeiro/CPAG/Menu).
- Componentes continuam em `public/src/components/` sem subpastas (exceção
  legada: `pages/ConfigAlertas/*` já existia antes da migração TS e foi tipado
  no lugar — não criar novas subpastas de componentes).
- Comportamento de negócio não muda na migração JSX→TSX; só tipagem e
  extensões de arquivo.
- `npm run typecheck` deve permanecer verde após cada fase.
- Próximas fases serão definidas pelo usuário (candidatos naturais: Login,
  Permissões, Embalagem, GP/PG, Arremates/OP, Estoque ainda parcial em React).

### Decisão arquitetural — redesign do Menu Lateral em React + TypeScript

- O menu administrativo compartilhado foi migrado integralmente para React +
  TypeScript e recebeu o redesign visual aprovado em 29/07/2026.
- Páginas consumidoras em JavaScript ou JSX não precisam ser migradas: o menu
  usa uma raiz React independente e preserva os contratos globais existentes.
- O menu não exibirá tipo, função ou vínculo do usuário.
- O seletor de empresa ativa continuará universal no PC e junto ao hamburger no
  tablet/celular, com maior destaque e sem transformar o frontend em autoridade
  do contexto empresarial.
- O rodapé não exibirá “Lojas Variara”; o changelog e a versão do sistema
  receberão destaque.
- Favoritos de áreas são ordenáveis e persistidos por usuário e empresa.
- O novo `PerfilAvatarStudio` é compartilhado pelo menu e pela Dashboard. O
  avatar é identidade global e sua API não deve depender da liberação do módulo
  Gestão Organizacional na empresa ativa.
- Busca universal, histórico de páginas recentes, modo compacto e ações rápidas
  foram descartados deste escopo.
- O redesign foi concluído; a migration de preferências permanece separada e
  ainda não executada.
- Estado local: implementação concluída, `typecheck`, build e smoke visual
  responsivo aprovados; migration de preferências e smoke autenticado ainda
  pendentes.

---

## REGRA MAXIMA — CONTROLE DE ALTERACOES

**NUNCA COMMITAR. NUNCA FAZER PUSH. NUNCA PUBLICAR OU FAZER DEPLOY EM PRODUCAO.**

---

## FECHAMENTO DA FASE 7 — 01/08/2026

A Fase 7 foi implementada, publicada e aprovada em smoke autenticado de
produção. A preparação estrutural também foi executada e validada na Neon; o
banco local usado nos testes foi `sistema_lv_fase7` em `127.0.0.1:55437`, com a
API local em `3017`.

Suítes HTTP aprovadas: pagamentos (17 cenários), ponto/sessões (15),
incentivos (7), avisos/calendário (2) e limite da dashboard (6). Typecheck,
build, auditorias estáticas e `git diff --check` também foram aprovados.

Produção e arremates permanecem bloqueados para empresas secundárias com
`CADEIA_PRODUTIVA_NAO_MIGRADA`; não remover os guards de `/api/producao` e
`/api/arremates` nem o bloqueio `DashCadeiaNaoMigrada`.

O worktree contém mudanças paralelas do Financeiro/importação de extratos e do
Menu. Elas pertencem ao usuário, não devem ser revertidas e não devem entrar
no commit seletivo da Fase 7. Os arquivos de `_planejamento` são ignorados
por `.gitignore`; o commit final precisará adicioná-los com `git add -f`.

O usuario revisa todas as alteracoes e executa pessoalmente os commits, pushes e deploys. Esta regra vale para todo o projeto, sem excecao, mesmo quando uma tarefa parecer concluida ou quando uma ferramenta sugerir automatizar essas operacoes.

Atualizacao em 2026-08-01: o redesign funcional da tela inicial da Dashboard
foi aprovado pelo usuario e implementado localmente sem alterar os modais. A
tela removeu o topo tradicional, ganhou menu lateral/drawer, foco de meta como
palco principal, resumo de ciclo e timeline animada de atividades preservando
produto, variacao, OP, processo, data, horario, quantidade e pontos. O menu
mantem os acessos existentes a carteira, desempenho, perfil, cofre e saida.
Ainda falta smoke manual visual antes de qualquer commit, push ou deploy.

Atualizacao em 2026-08-01: o refinamento dos blocos principais da tela inicial
tambem foi aprovado e codado localmente. O header nao exibe mais “ciclo atual”;
saudacao e periodo foram divididos em duas colunas; o periodo calcula o ultimo
dia trabalhado considerando jornada e folgas do calendario; a projecao e o
resumo de dias foram unificados; e o antigo link de contexto virou um painel
de cenarios com carteira clicavel e explicacao do calculo. `typecheck`, build e
`git diff --check` passaram. Ainda falta smoke manual visual antes de qualquer
commit, push ou deploy.

Atualizacao em 2026-08-01: o segundo refinamento visual foi implementado
localmente. O bloco de periodo agora exibe uma unica data de fechamento,
acompanhada de progresso do ciclo; os botoes Bronze, Prata e Ouro receberam
cores proprias e celebracoes temporarias em escala crescente; o icone da
carteira foi incorporado ao valor ja conquistado da projecao; e o bloco
`ds-projecao-metricas` foi removido para evitar repeticao. `typecheck`, build e
`git diff --check` passaram. Ainda falta smoke manual visual antes de qualquer
commit, push ou deploy.

Atualizacao em 2026-08-01: o terceiro refinamento visual incorporou o fechamento
do ciclo ao eixo da barra de ritmo, eliminando `ds-dashboard-periodo-rodape`;
as estrelinhas da celebracao Prata agora usam tratamento visual prateado; o
`ds-projecao-selo` foi removido; e os cenarios da estrategia passaram a ter a
mesma celebracao temporaria dos botoes de meta. A validacao local deve ser
refeita antes de qualquer commit, push ou deploy.

Atualizacao em 2026-08-01: a celebracao dos cenarios da estrategia recebeu
escala, contraste e sombra maiores para continuar visivel no card escuro, e o
hamburger mobile da dashboard passou de absoluto para fixo durante a rolagem.
O ranking permanece na tela inicial por enquanto; foi criada uma proposta
visual separada para substituir o bloco de atividades recentes por uma linha
do tempo responsiva, mantendo produto, variacao, OP, processo, data, horario,
quantidade e pontos. O mockup aguarda aprovacao antes da implementacao.

Atualizacao em 2026-08-01: o bloco de atividades recentes passou a usar a linha
do tempo do mockup, mantendo busca, Hoje, Ontem, data especifica, atualizacao,
paginação e abertura da tabela de pontos. O titulo agora se adapta ao dia
consultado (hoje, ontem, dia da semana, semanas atras ou data completa), e os
filtros enviam o dia civil no fuso America/Sao_Paulo para tambem funcionar em
historico antigo. O ranking continua sem mudancas enquanto a nova destinacao
da area e avaliada. `typecheck`, build e `git diff --check` passaram.

Atualizacao em 2026-08-01: cada etapa da linha do tempo agora destaca os pontos
gerados em um selo maior, e a navegacao das atividades reutiliza a paginacao
padrao `gs-paginacao-container` / `gs-paginacao-btn` / `gs-paginacao-info` do
sistema por meio do wrapper React que chama `public/js/utils/Paginacao.js`, sem
alterar a implementacao legada. `typecheck` e `git diff --check` passaram.

Atualizacao em 2026-08-01: o ranking foi removido da grade principal e passou
para o menu lateral. A dashboard agora usa uma sidebar fixa de 250px no
desktop, ocupando toda a altura e absorvendo o antigo `margin-left` global; em
mobile e tablet o drawer recebe a mesma galeria horizontal por toque. O novo
ranking exibe posicao, podio e proxima conquista, preservando anonimato e a
API semanal existente. A validacao de codigo passou; o smoke visual autenticado
deve ser feito no ambiente do usuario.

Atualizacao em 2026-08-01: o podio da galeria do ranking passou a exibir a
posicao numerica explicita (`1º`, `2º`, `3º`) junto dos identificadores
anonimos `Colega #N`, sem alterar a regra de anonimato da API.

Atualizacao em 2026-08-01: a posicao individual do ranking foi reorganizada
em um bloco sem corte visual, e o painel `Quem esta puxando o ritmo` passou a
usar `rankingCompleto` para exibir todos os participantes anonimizados, do
primeiro ao ultimo, em lista rolavel dentro da galeria.

Atualizacao em 2026-08-01: o menu da dashboard passou a concentrar o contexto
empresarial com o componente oficial `MenuEmpresaAtiva` e o hook
`useMenuContexto`. Com um unico vinculo ativo, o botao informa o contrato ativo
com a empresa; com mais de um, abre o seletor oficial e permite a troca. O
drawer mobile agora possui a saida no cabecalho, enquanto versao e
`Preferencias` ficam no rodape (Preferencias permanece desativado e mostra
`Em breve!`). A validacao local passou em typecheck e build.

Atualizacao em 2026-08-01: o hamburger da dashboard permanece fixo, mas o
controle compacto da empresa e seu aviso acompanham o fluxo da pagina; o aviso
fecha ao clicar fora. A projecao agora usa uma mensagem condensada, apresenta
Ouro como alvo principal e comunica Bronze/Prata como alternativas quando o
alvo principal nao for alcancado. A validacao local passou em typecheck, build
e `git diff --check`.

Atualizacao em 2026-08-01: o foco diario deixou de exibir o potencial fixo do
ciclo e passou a mostrar quanto falta para a meta selecionada, ou que a meta
foi alcançada. O badge `ds-foco-stage-nivel` agora recebe a cor do nivel e uma
celebracao temporaria ao trocar de meta. Bronze usa 👍 no foco e na projecao.
A validacao local passou em typecheck e build.

Atualizacao em 2026-08-01: `Minha tabela de pontos` ganhou o componente
`DashTabelaPontosRedesign`, mantendo a mesma API e todos os dados de produto,
etapas e pontos. O modal agora possui cabecalho visual, resumo, cards por
produto, barras proporcionais por etapa, estados de carregamento/vazio e
layout mobile-first. As entradas da dashboard passaram a usar o redesign.
A validacao local passou em typecheck e build.

Atualizacao em 2026-08-01: o resumo intermediario foi removido da tabela de
pontos. O subtitulo do cabecalho ganhou uma area propria e a decoracao lateral
foi removida para garantir a leitura completa do texto em telas pequenas.
A validacao local passou em typecheck, build e `git diff --check`.

Atualizacao em 2026-08-01: o antigo `DashStatusAtualFab` deixou de ser
renderizado como botao flutuante fixo. O novo `DashStatusAtualModal` foi
implementado com cartao de status vivo, modal responsivo e estados para
producao, almoco, pausa, sem tarefa, folga, fora do horario e tarefa concluida.
O redesign preserva cronometro, pausa, previsao de termino, tarefa, processo,
quantidade, pontos da tarefa, progresso de pontos do dia, retorno de intervalos
e proxima tarefa. O endpoint `/api/producao/meu-status` agora tambem entrega
`dias_trabalho` para distinguir folga de fora do horario. O cartao esta
temporariamente dentro do `ds-dashboard-intro-copy`; o refinamento final dessa
composicao fica para a proxima etapa. `typecheck`, build e `git diff --check`
passaram.

Atualizacao em 2026-08-01: o cartao de status foi refinado para funcionar como
um sneak peek compacto no pequeno espaco lateral do `ds-dashboard-intro-copy`.
O modal agora e renderizado via portal diretamente no `document.body`, evitando
que ele fique preso, recortado ou visualmente limitado pelo bloco do cabecalho.

Atualizacao em 2026-08-01: o sneak peek foi reorganizado em duas colunas
internas no `ds-dashboard-intro-copy`: textos da saudacao na primeira e um
cartao quase quadrado na segunda. O card adapta o destaque ao status atual,
usando tempo percorrido na producao, retorno previsto nos intervalos e
mensagens de proximo passo, descanso ou encerramento nos demais estados.

Atualizacao em 2026-08-01: a composicao foi corrigida para manter o sneak peek
dentro do proprio bloco azul da saudacao, ocupando somente a area direita com
fundo translucido, borda arredondada e leitura de status/tempo. Ele nao e mais
uma caixa branca externa nem uma nova linha da dashboard.

Atualizacao em 2026-08-01: o usuario aprovou o encerramento funcional do
redesign da dashboard e definiu que a Fase 8 nao sera executada neste ciclo. O
objetivo passa a ser fechar 100% da Fase 7, preservando os bloqueios de producao
e arremates para empresas secundarias. A dashboard passou por typecheck, build,
node --check, diff check, auditorias estaticas e smoke visual aprovado pelo
usuario. O encerramento restante e operacional: autorizacao da migration da
Fase 7 na Neon, validacao controlada, publicacao e smoke autenticado final.

Atualizacao em 2026-08-01: a preparacao da Fase 7 foi executada na Neon e o
validador retornou `aprovado: true`: 17 colunas empresa_id, zero linhas sem
empresa, zero divergencias, 17 constraints de empresa, 17 constraints de
relacoes, 17 uniques de identidade e 5 uniques empresariais. A migration ficou
registrada em sistema_migrations e nenhum modulo foi liberado para empresas
secundarias. Avisos de coluna ja existente sao notices de reexecucao; nao rodar
a migration novamente. O estado ainda possui colunas anulaveis e FKs NOT VALID,
conforme o desenho aditivo da preparacao.

Atualizacao em 2026-08-01: foi esclarecida a diferenca entre isolamento
implementado e modulo liberado. Pagamentos e a dashboard legada foram as frentes
funcionais aprovadas para o uso atual. Metas, pontos extras, configuracoes,
gincanas, premiacoes, avisos e calendario possuem APIs isoladas e testes locais,
mas continuam deliberadamente indisponiveis para a segunda empresa porque os
modulos ainda nao foram liberados em `modulos_sistema` e `empresas_modulos`. A
mensagem de modulo nao disponivel nessas paginas e, portanto, o bloqueio
esperado, nao uma falha de isolamento.

Regra expressa de dashboard multiempresa: para liberar a dashboard completa em
uma empresa secundaria, nao basta habilitar o modulo `dashboard`. A dashboard
depende de producao e arremates para pontos, atividades, desempenho, status ao
vivo, ranking e projecoes. Esses dominios precisam primeiro ser migrados,
validados e liberados com isolamento empresarial; somente depois o modulo
`dashboard` pode ser habilitado e submetido ao smoke completo. Ate la,
`/api/producao` e `/api/arremates` devem continuar fechados com
`CADEIA_PRODUTIVA_NAO_MIGRADA`, mesmo se flags forem alteradas temporariamente,
e `DashCadeiaNaoMigrada` deve permanecer visivel. Neste ciclo, a dashboard esta
concluida para a empresa legada, mas nao sera liberada integralmente para a
empresa secundaria porque a Fase 8 esta fora do escopo.

### Estado da trilha TypeScript de Ordens de Producao em 2026-08-02

- A migracao incremental de OP esta em andamento e nao altera a logica de
  jornada, ponto, agentes globais ou APIs.
- `main-op.tsx`, `op-types.ts`, `OPFiltros.tsx`, `OPPaginacaoWrapper.tsx`,
  `OPEtapaRow.tsx`, `OPGerenciamentoTela.tsx` e `OPCortesTela.tsx` foram
  validados localmente com `npm run typecheck` e `npm run build`.
- Na aba de Cortes, os componentes filhos continuam em JSX e sao consumidos
  por fronteiras tipadas temporarias; a smoke manual dessa aba ainda deve ser
  repetida antes da aprovacao funcional da fatia.
- Os arquivos JSX antigos permanecem como fallback local. Nenhum staging,
  commit, push ou deploy deve ser feito enquanto houver alteracoes paralelas no
  workspace.

- Quinta fatia concluida localmente: `OPExternoTela.tsx` tipa a aba de producao
  externa, incluindo selecao, confirmacao, unificacao, historico e desfazer.
  `OPTelaSelecaoEtapa.jsx` permanece em JSX por enquanto. Typecheck e build
  passaram; falta apenas repetir o smoke manual da aba antes da aprovacao.

- Sexta fatia concluida localmente: `OPTelaSelecaoEtapa.tsx` tipa a fila de
  tarefas externas, filtros, sugestao, selecao multipla, paginacao e
  unificacao. A aba externa agora consome a versao TSX. Typecheck e build
  passaram; falta o smoke manual da selecao de tarefas externas.

- Setima fatia iniciada: `OPModalTempos.tsx` tipa o modal de TPP e `main-op.tsx`
  passou a carrega-lo. O build passou, mas o typecheck global foi bloqueado por
  dezenas de erros em componentes `Dash*` de outra migracao paralela. Nenhum
  erro foi apontado nos arquivos OP desta fatia. Pausar novas fatias ate o gate
  global de TypeScript voltar a ficar verde.

- Oitava fatia local: `BotaoBuscaFunil.tsx` tipa o FAB/drawer de demandas,
  polling e callback de inicio de producao; `main-op.tsx` passou a carrega-lo.
  Build passou. O typecheck global continua bloqueado pelos erros `Dash*` e o
  smoke manual do FAB ainda esta pendente.

- Nona fatia local: `OPCriarModal.tsx` tipa os modos de criacao por demanda e
  por corte existente, incluindo cenarios de estoque, vinculo de demanda,
  split/expansao e salvamento. `main-op.tsx` e `OPCortesTela.tsx` passaram a
  carrega-lo. Typecheck e build voltaram a passar; smoke dos cenarios do modal
  ainda esta pendente.

- Decima fatia local: `BotaoBuscaPainelDemandas.tsx` tipa a casca do Painel de
  Demandas, incluindo carregamento, diagnostico, filtros, busca, secoes,
  refresh parcial e fronteiras dos modais/cards/agente JSX. `BotaoBuscaFunil.tsx`
  passou a consumir a versao TSX. Typecheck e build passaram; smoke do FAB,
  drawer, filtros, historico e inicio de producao ainda esta pendente.

- Validacao da decima fatia: em 2026-08-02, o usuario confirmou que o Painel de
  Demandas abriu, carregou e funcionou corretamente. A migracao continua local,
  sem staging, commit, push ou deploy.

- Estrategia aprovada em 2026-08-02: TypeScript pode avancar em paralelo com o
  plano de jornada, ponto e redesign. Cada bloco deve tipar componentes nao
  criticos sem alterar comportamento; componentes ligados a estados de ponto,
  sessoes, producao ou arremates ficam condicionados a validacao do backend.
  A trilha TS nao bloqueia a retomada do motor de jornada nem sua publicacao
  seletiva quando o worktree permitir separar o diff.

- Decima primeira fatia local: `BotaoBuscaPipelineProducao.tsx` tipa o card do
  pipeline de demandas, incluindo saldos, corte, exclusao, inicio de OP e
  navegacao para arremate/embalagem. O painel passou a consumir o card TSX.
  Typecheck e build passaram; smoke visual dos CTAs e badges ainda pendente.

- Decima segunda fatia local: `BotaoBuscaModalConcluidas.tsx` tipa o historico
  de demandas, incluindo abas, subabas, agrupamento, paginacao, carregamento
  sob demanda e arquivamento em lote. `BotaoBuscaPainelDemandas.tsx` passou a
  consumir o modal TSX. Typecheck e build passaram; smoke manual do historico
  ainda pendente.

- Decima terceira fatia local: `BotaoBuscaModalAddDemanda.tsx` tipa o modal de
  nova demanda, incluindo busca, recentes, duplicidade, prioridade, quantidade,
  modo Express, carrinho e criacao individual/em lote. O painel passou a
  consumir o modal TSX. Typecheck e build passaram; smoke manual ainda pendente.

- Decima quarta fatia local: `PDAgenteDemandas.tsx` tipa o agente do Painel de
  Demandas, incluindo frases por estado, typewriter, refresh e filtro de
  urgentes. O painel passou a consumir o agente TSX. Typecheck e build
  passaram; smoke manual dos estados do agente ainda pendente.

- Decima quinta fatia local: `OPCard.tsx` tipa o card resumido da aba de
  Gerenciamento, incluindo status visual, radar, data, quantidade,
  cancelamento com permissao e tiras de encerramento completo/parcial.
  `OPGerenciamentoTela.tsx` passou a consumir o card TSX e o contrato de OP
  recebeu os campos opcionais correspondentes. Typecheck e build passaram;
  smoke manual dos cards e do cancelamento ainda pendente.

- Decima sexta fatia local: `OPSelecaoProdutoCorte.tsx` tipa a vitrine de
  produtos da aba de Cortes, incluindo imagem, fallback, nome e selecao.
  `OPCortesTela.tsx` passou a consumir a vitrine TSX. A fatia nao altera
  gravacao de cortes, ponto ou sessoes. Typecheck e build passaram; o smoke
  manual da vitrine ainda esta pendente.

- Decima setima fatia local: `OPSelecaoVarianteCorte.tsx` tipa a selecao de
  variante, cor e tamanho, incluindo busca inteligente, historico, fallback e
  escolha da variacao completa. `OPCortesTela.tsx` passou a consumir a versao
  TSX. A fatia nao grava corte nem altera ponto ou sessoes. Typecheck e build
  passaram; o smoke manual da selecao ainda esta pendente.

- Validacao da decima setima fatia: em 2026-08-02, o usuario aprovou o smoke
  da selecao de variantes, incluindo busca, tamanhos e confirmacao.

- Decima oitava fatia local, em bloco maior: `OPRegistroCorte.tsx`,
  `OPCorteEstoqueCard.tsx`, `OPFormulario.tsx` e `OPCortesRadar.tsx` foram
  migrados e `OPCortesTela.tsx` passou a consumi-los. O comportamento de
  registro, estoque, Gerar OP, split, radar, permissoes e callbacks foi
  preservado. Typecheck e build passaram; smoke manual do nucleo de Cortes
  ainda pendente. Restam para a proxima fatia maior o agente de planejamento e
  `OPQuickLogModal`.

- Validacao da decima oitava fatia: em 2026-08-02, o usuario aprovou todos os
  cenarios do nucleo operacional de Cortes, incluindo registro, estoque,
  exclusao, Gerar OP, split, radar e carregamento/erro.

- Decima nona fatia local, fechamento de Cortes: `OPCortesAgente.tsx` e
  `OPQuickLogModal.tsx` foram migrados em conjunto e `OPCortesTela.tsx` passou
  a consumi-los. Foram preservados agente, scan, memoria, typewriter,
  preenchimento, lancamento normal, Express, fila, resultado e endpoints.
  Typecheck e build passaram; smoke manual final do agente e QuickLog ainda
  pendente. A arvore principal da aba de Cortes agora esta integralmente em
  TSX, sem alterar ponto ou sessoes.

- Validacao da decima nona fatia: em 2026-08-02, o usuario aprovou o smoke
  final do bloco de Cortes, incluindo agente, plano, Cortar, QuickLog normal,
  preenchimento pelo agente e Express.

- Retomada do ponto/jornada: a trilha TS da pagina de OP foi encerrada no
  escopo atual. O gate local de pre-publicacao do motor verificou com
  `node --check` `api/jornada.js`, `api/ponto-eventos.js`,
  `api/ponto-motor.js`, `api/ponto.js`, `api/cron.js`, `api/producao.js`,
  `api/producoes.js` e `api/arremates.js`; `git diff --check`, typecheck e
  build tambem passaram. O bloco foi publicado seletivamente no commit
  `8286e07`, mantendo a cadeia produtiva bloqueada para empresas secundarias.
  O smoke autenticado foi adiado ate a migration append-only ser executada e
  validada na Neon.

### Atualizacao operacional em 2026-08-02 — migration append-only executada

- O usuario executou na Neon a migration
  `_planejamento/migration-ponto-eventos-transicoes.sql` sem erros.
- A validacao das colunas de `ponto_eventos` e
  `ponto_transicoes_pendentes` foi aprovada; `autor_nome` esta como `text` nas
  duas tabelas e os tipos restantes correspondem ao contrato.
- O motor de ponto publicado em `8286e07` passa a encontrar as tabelas
  aditivas e pode usar o livro append-only e as transicoes pendentes. O gate
  estrutural foi aprovado com 14 constraints, 8 indices, trigger
  `trg_ponto_eventos_append_only` habilitado e marcador
  `ponto-eventos-transicoes-v1` registrado.
- A simulacao local ampliada foi aprovada em 2026-08-02 nos niveis de dominio,
  motor e HTTP, cobrindo cron, E1, almoco, pausas, fallback, DSR/feriado,
  falta, excecoes, concorrencia, idempotencia e eventos de tarefa. Ela usou um
  clone isolado do banco e nao alterou a restauracao original nem a Neon.
- O smoke autenticado controlado em producao permanece pendente por depender de
  um dia util e de uma fixture/escopo seguro. Os mockups do redesign visual do
  ponto foram aprovados e a codificacao avancou ate o ajuste da terceira fatia
  do card de execucao.
- Em 2026-08-02, o usuario aprovou a direcao visual do primeiro mockup do painel
  de jornada e atividades: tablet-first, foco na proxima acao valida, estados e
  motivos explicitos, transicoes pendentes acionaveis e regras mantidas no
  backend. O codigo do redesign foi iniciado localmente; os proximos mockups
  detalharao card, confirmacao/excecao, timeline e configuracao da jornada.
- O usuario tambem aprovou o mockup do detalhe de interacao de uma transicao,
  com confirmacao, excecao com motivo obrigatorio e historico no mesmo contexto.
- O usuario tambem aprovou o mockup da timeline diaria, com planejado,
  processado, efetivo, origem, fallback e preservacao causal do historico.
- O usuario tambem aprovou o mockup do editor de Jornada de Trabalho por
  vinculo, incluindo dias, horarios, resumo, validacoes e impacto em registros
  futuros sem reescrita automatica do historico.
- A validacao responsiva consolidada para tablet paisagem, tablet retrato e
  celular, incluindo estados operacionais de borda, tambem foi aprovada. A
  etapa de mockups esta encerrada.
- A primeira fatia visual implementada preserva handlers, endpoints e regras
  atuais: novo resumo do painel, KPIs de jornada, filtros com contagem e
  separacao entre pessoas em operacao e fora da operacao.
- A segunda fatia mantém o corpo operacional existente e reorganiza o topo de
  cada card com papel, estado atual e proxima referencia de jornada. Cronometro,
  pausa, liberacao, cancelamento, finalizacao e bottom sheets continuam usando
  os mesmos handlers e contratos.
- A terceira fatia redesenha o card de tarefa atribuida: remove o rotulo
  redundante de atividade, transforma a pausa em controle compacto animado ao
  lado do cronometro, integra as acoes ao botao Jornada, concentra a area do
  produto e trata a fila como bloco compacto independente. A fila vazia informa
  apenas que nao ha tarefas agendadas; nao sugere que o empregado esteja ocioso.
  A saida planejada foi removida do cabecalho da tarefa para manter o foco no
  processo e no produto.
- O ajuste da fila implementa acordeao por card, fechado por padrao: o cabecalho
  mostra a quantidade e "Clique para expandir" quando existem tarefas, enquanto
  a lista abre com animacao apenas no card acionado. Cards sem fila mostram
  "Nenhuma tarefa agendada" e permanecem sem acao. Typecheck, build e diff check
  foram aprovados; falta o smoke manual do acordeao.
- O item da fila usa o indice como marcador no canto superior esquerdo, sem
  reservar uma coluna exclusiva, e combina variante e processo na mesma linha
  com espacamento e truncamento responsivo.
- No cabecalho da tarefa unificada, o badge foi reduzido para `UNIF` e fica na
  mesma linha do processo, economizando uma linha sem perder a identificacao.
- A tolerancia S3 e as acoes de liberar intervalo agora ficam restritas a dias de
  jornada ordinaria. `/api/producao/status-funcionarios` envia
  `jornada_ordinaria_hoje`, considerando escala e calendario especial; o card
  usa esse campo com fallback local pela escala. Em DSR, feriado ou hora extra,
  esses indicadores nao aparecem.
- A quarta fatia visual do redesign fecha os estados sem tarefa e fora da
  operacao: disponibilidade, almoco e pausa usam composicao compacta, enquanto
  os cards inativos adotam cor de estado, identidade enxuta e acoes touch-first.
  Os handlers, permissoes, bottom sheets e regras de negocio foram preservados;
  typecheck, build e diff check foram aprovados. A validacao visual manual ainda
  depende de uma sessao autenticada.
- No card em operacao, o processo atual usa um cartao proprio para separar
  contexto de etapa e percurso unificado, com chips legiveis e o badge `UNIF`
  preservado. A fila compacta exibe somente thumbnail, nome da variacao,
  processo/etapa e quantidade; etapas `OP` usam azul e `POS_OP` usam laranja.
  A secao Fora da operacao ocupa toda a largura disponivel com duas colunas
  flexiveis em todas as larguras responsivas previstas para esse painel.
- O status do painel de OP tambem informa o tipo do dia e se a janela ordinaria
  esta aberta. Falta, saida antecipada e atraso sao bloqueados na interface em
  DSR, folga, trabalho extra ou fora da janela; hora extra usa somente tarefas.
  Alocar em outro setor e rejeitado pelo backend quando ha tarefa produtiva em
  andamento, evitando confirmacao sem efeito. O bloco de acoes usa duas colunas
  e o modal de Jornada chega a 620px em tablets.
- No desktop, o modal de Jornada e seus sheets ficam centralizados na area util
  apos o menu lateral fixo de 296px; em tablet e celular continuam centralizados
  na viewport.
- Os cards de Fora de operacao usam duas colunas flexiveis, sem sobra lateral,
  em tablet, desktop e telas pequenas.
- O modal de atribuicao de tarefa usa duas colunas em tablet e desktop, com
  contexto e disponibilidade compactos; a confirmacao de quantidade usa produto
  e controles lado a lado. Em celular, ambos retornam para uma coluna.
- A rota `/api/producao/status-funcionarios` reconcilia o motor de jornada antes
  de ler `ponto_diario`, em transacoes isoladas por funcionario; falhas isoladas
  fazem rollback e nao impedem o painel. O fallback legado permanece quando as
  tabelas aditivas nao estao disponiveis.
- A reconciliação foi extraída para `reconciliarJornadaFuncionarios`, em
  `api/ponto-motor.js`, e também é executada antes da leitura das projeções no
  status individual de produção e no painel de TikTiks em arremates. Os três
  caminhos compartilham a mesma regra, com transação por vínculo, rollback e
  fallback legado quando o motor ainda não está disponível.
- O ensaio transacional do motor foi concluído em 2026-08-03. A base local
  `sistema_lv_ponto_motor_test` foi criada como cópia de
  `sistema_lv_restore_test`; a preparação multiempresa da Fase 7 foi aplicada
  somente nessa cópia porque a restauração de origem ainda não tinha
  `empresa_id` em `ponto_diario` e `calendario_empresa`. O script
  `node tools/testar-ponto-motor-local.mjs` retornou `aprovado: true`, com
  11 eventos e todos os cenários previstos. O helper
  `reconciliarJornadaFuncionarios` também foi aprovado com os vínculos 4 e 9:
  o vínculo 4 confirmou evento e projeção, a falha isolada do vínculo 9 fez
  rollback da transação desse vínculo e a resposta continuou com
  `eventosAplicados: 1` e um erro.
- A base `sistema_lv_ponto_simulacao` continua contendo eventos nas datas fixas
  do script; por ser append-only, novos ensaios devem usar uma cópia fresca de
  `sistema_lv_restore_test` (ou outra restauração), não a simulação diretamente.
- O grid de inativos usa largura maxima controlada para que um unico card nao
  ocupe a linha inteira. A fatia seguinte tambem padronizou visualmente a
  Jornada, a timeline diaria e os popups de intervalo, confirmacao de
  saida/retorno e desfazer, preservando callbacks, permissoes e countdown.

Atualização em 2026-08-03: o bloco de Produção da Fase 8 foi ensaiado somente
em clones PostgreSQL locais. A base `sistema_lv_cadeia_producao_test` foi
derivada de `sistema_lv_ponto_motor_test`; Produtos/Demandas e OPs/Cortes foram
reaplicados antes da migration de Produção. `producoes` e
`producoes_solicitacoes_exclusao` receberam `empresa_id` obrigatório, o
backfill preservou 7 lançamentos e 2 sessões sem OP pai, a aplicação foi
idempotente e o rollback preservou hashes das oito tabelas. O smoke HTTP com
duas empresas aprovou sessão, finalização, isolamento e solicitações de
exclusão; as regressões anteriores também passaram sequencialmente. O fluxo
não cria mais OP fictícia `0000`, normaliza variante ausente para `'-'`, monta
Gerenciar Produção no índice serverless e mantém o bloqueio secundário até o
marcador `multiempresas-fase8-producao-ensaio-v1` existir no banco. Nenhuma
migration foi executada na Neon; não houve commit, push ou deploy.

## Handoff obrigatório para a próxima sessão — 2026-08-03

O estado detalhado da retomada da Fase 8 multiempresas está em
`_planejamento/RETOMADA-FASE8-MULTIEMPRESAS-2026-08-03.md`. O próximo Codex
deve ler esse arquivo junto com a seção 13.19 do plano operacional e a
auditoria da cadeia produtiva. O bloco de Produção de lançamentos/sessões,
assim como Produtos/Demandas e OPs/Cortes, já foi aprovado localmente com
idempotência, rollback e smoke HTTP de dois contextos; não deve ser refeito sem
regressão concreta. O próximo trabalho é fechar os consumidores restantes de
Produção (`api/producao.js`, `api/real-producao.js`, promessas, cron, alertas,
agentes e relatórios), depois migrar Arremates, Embalagem e Estoque e só então
fechar G11/G12. Nenhuma migration na Neon, commit, push ou deploy está
autorizado sem decisão explícita do usuário. O worktree e as bases locais
existentes devem ser preservados.

### AtualizaÃ§Ã£o operacional em 2026-08-04 â€” consumidores de ProduÃ§Ã£o

- `api/producao.js` foi revisado rota por rota no clone local: status individual,
  status coletivo, grupos, fila, sugestÃ£o, tempos padrÃ£o e cancelamento agora
  qualificam produto, OP, produÃ§Ã£o, sessÃ£o, funcionÃ¡rio e configuraÃ§Ã£o pela
  empresa ativa quando a tabela Ã© empresarial ou herda o vÃ­nculo do produto.
- `api/real-producao.js` passou a falhar fechado para empresas secundÃ¡rias e
  seus totais, histÃ³rico e comparativos filtram as produÃ§Ãµes pelo contexto; os
  arremates continuam consumidos apenas no caminho legado atÃ© a migraÃ§Ã£o desse
  domÃ­nio.
- `producao_promessas` recebeu ensaio aditivo local em
  `_planejamento/migration-cadeia-fase8-promessas-ensaio.sql`, com
  `empresa_id NOT NULL`, unicidade `(empresa_id, produto_ref_id)`, backfill da
  empresa legada, rollback e marcador
  `multiempresas-fase8-promessas-ensaio-v1`. A API valida SKU/grade no produto
  da empresa ativa, ignora `empresa_id` do body e bloqueia empresas secundÃ¡rias.
- O índice serverless passou a montar `/producao`, garantindo paridade com o
  Express local para os consumidores revisados.
- O ensaio HTTP de consumidores foi aprovado em clone local com status, grupos,
  fila, sugestÃ£o, tempos, promessas, histÃ³rico de desempenho e dashboard de
  produÃ§Ã£o legados; os mesmos caminhos retornaram
  `CADEIA_PRODUTIVA_NAO_MIGRADA` no contexto secundÃ¡rio. NÃ£o houve Neon,
  commit, push ou deploy.

### Atualizacao operacional em 2026-08-04 — cron e alertas da Fase 8

- O cron de arquivamento agora atualiza somente demandas com `empresa_id` e
  empresa ativa. A reconciliacao ordinaria de ponto continua limitada a uma
  empresa legada enquanto a cadeia produtiva nao for migrada.
- `eventos_sistema` e `historico_alertas` receberam ensaio aditivo local com
  `empresa_id NOT NULL`, backfill para a empresa legada, indices empresariais,
  FKs `NOT VALID` e marcador `multiempresas-fase8-alertas-ensaio-v1`.
- `alertas_configuracoes_gerais` passou a usar chave primaria
  `(empresa_id, chave)`. `configuracoes_alertas` permanece catalogo global;
  seus valores operacionais foram separados para
  `configuracoes_alertas_empresas`, com overrides por empresa.
- O router de alertas agora filtra eventos, historico, demandas e parametros
  pelo contexto ativo, grava eventos/historico com empresa e falha fechado para
  empresas secundarias enquanto Arremates ainda nao foi migrado. Demandas e o
  evento de meta de Arremates tambem passaram a gravar `empresa_id`.
- O indice serverless passou a montar `/alertas` e `/cron`, garantindo paridade
  com o Express local.
- A migration foi aplicada duas vezes no clone `sistema_lv_cadeia_alertas_test`;
  o rollback no clone `sistema_lv_cadeia_alertas_rollback_test` preservou os
  hashes das 4.479 linhas originais e removeu tabela, colunas e marcador.
- O smoke HTTP final foi aprovado no clone
  `sistema_lv_cadeia_alertas_smoke_final`, cobrindo arquivamento, overrides,
  dias/janela, eventos, historico, hora extra, body spoof e bloqueio
  secundario. O clone terminou sem fixtures temporarios.
- `npm run typecheck`, `npm run build`, `node --check` dos routers alterados e
  `git diff --check` passaram. O build manteve somente o aviso conhecido de
  chunk grande do Financeiro. Nenhuma migration foi executada na Neon; nao
  houve commit, push ou deploy.
- Proximo passo: fechar agentes, polling, dashboard e relatorios transversais;
  depois iniciar a migration completa de Arremates.

### Atualizacao operacional em 2026-08-04 - agentes, polling, dashboard e relatorios

- A dashboard foi revisada rota por rota. Producoes, arremates, produtos,
  ranking, calendario, streak, conquistas e tabela de pontos agora usam o
  `empresa_id` do contexto ativo; a selecao do ranking usa
  `usuarios_empresas`, nao a identidade global de `usuarios`.
- Os consumidores React de OP, cortes e Arremates passaram a consultar o
  contexto local antes de iniciar buscas ou polling. Em empresa secundaria,
  os timers sao interrompidos e a UI exibe bloqueio neutro sem dados de outra
  empresa. A mudanca cobre o monitor de OP, painel de producao, painel de
  cortes, radar/agente de cortes e painel de atividades de Arremates.
- Producao Geral passou a interpretar `CADEIA_PRODUTIVA_NAO_MIGRADA`, parar a
  atualizacao automatica e renderizar bloqueio neutro. O helper
  `obterEmpresaAtivaLocal` foi centralizado em `public/js/utils/auth.js`.
- O smoke `tools/testar-consumidores-dashboard-http-local.mjs` foi aprovado no
  clone `sistema_lv_cadeia_consumidores_dashboard_test`. As rotas de dashboard
  e os relatorios de `real-producao` retornaram 200 na empresa legada e 403
  com `CADEIA_PRODUTIVA_NAO_MIGRADA` na empresa secundaria. O smoke habilitou
  temporariamente os modulos necessarios no clone e restaurou os flags ao fim.
- Comandos executados: `npm run typecheck`, `npm run build`, `git diff --check`
  e `node tools/testar-consumidores-dashboard-http-local.mjs
  postgresql://postgres@127.0.0.1:55432/sistema_lv_cadeia_consumidores_dashboard_test`.
  Todos passaram; o build manteve somente o aviso conhecido de chunk grande do
  Financeiro. Nenhuma migration foi executada na Neon; nao houve commit, push
  ou deploy.
- Proximo passo: iniciar Arremates, preservando o gate secundario ate a
  migration e os consumidores do dominio serem aprovados localmente.
## Atualizacao operacional em 2026-08-04 - Arremates

O bloco local de Arremates foi concluido sem alterar a base fonte
`sistema_lv_cadeia_producao_test`. O clone `sistema_lv_cadeia_arremates_test`
recebeu migration aditiva para `arremates`, `arremate_perdas`,
`sessoes_trabalho_arremate`, `tempos_padrao_arremate`, `log_assinaturas` e
`log_divergencias`.

- 9.607 arremates e 4.290 sessoes herdaram empresa da OP; as 202 perdas e os
  7 tempos receberam empresa, com duas perdas sem arremate de origem
  preservadas na empresa legada.
- `api/arremates.js` foi revisada rota a rota; leituras, buscas por ID,
  estornos, sessoes, perdas, tempos, logs, fila, status e relatorios usam o
  contexto empresarial. O body nao escolhe empresa.
- Os dois writers compartilhados de `log_assinaturas` em `api/producoes.js`
  foram ajustados para acompanhar o novo `NOT NULL`; `api/alertas.js` e
  `api/ponto.js` qualificam sessoes e tempos de Arremates.
- O gate secundario foi preservado: a empresa secundaria retorna
  `CADEIA_PRODUTIVA_NAO_MIGRADA`.

Evidencias: migration aplicada duas vezes; rollback no clone
`sistema_lv_cadeia_arremates_rollback_test` com hashes iguais nas seis tabelas;
smoke HTTP de nove rotas legadas e nove bloqueios secundarios; body spoof e
tres FKs de isolamento aprovados. A primeira execucao encontrou e corrigiu a
falta do parametro empresarial em `contagem-hoje`; a segunda passou. Nao houve
Neon, commit, push ou deploy.

Proximo passo recomendado: iniciar Embalagem, incluindo
`embalagens_realizadas`, `api/embalagens.js`, fila de OPs e o consumo de
Arremates por embalagem.

## Atualizacao operacional em 2026-08-04 - Embalagem

O bloco local de Embalagem foi concluido sem alterar a base fonte
`sistema_lv_cadeia_arremates_test`. O clone principal foi
`sistema_lv_cadeia_embalagem_test`; os clones de baseline e rollback foram
preservados.

- `embalagens_realizadas` recebeu `empresa_id NOT NULL`, backfill das 4.781
  linhas pelo produto, FKs/indices empresariais e `idempotency_key` opcional
  com unicidade por empresa.
- `api/embalagens.js` e `api/ops-para-embalagem.js` qualificam as rotas pelo
  contexto. `api/kits.js`, `api/estoque.js` e o consumidor de Embalagens em
  `api/demandas.js` foram ajustados; writers secundários permanecem fechados
  porque `estoque_movimentos` ainda e global.
- Entrada unitária e montagem de kit usam lock transacional e
  `Idempotency-Key`; body spoof nao escolhe empresa.
- A migration foi aplicada duas vezes, o rollback preservou hashes e os
  smokes HTTP/constraints foram aprovados. `node --check`, `git diff --check`,
  `npm run typecheck` e `npm run build` passaram; o build manteve apenas o
  aviso conhecido de chunk grande do Financeiro.
- Nenhuma migration foi executada na Neon; nao houve commit, push ou deploy.

Proximo passo recomendado: Estoque e Inventario, cobrindo movimentos,
arquivados, niveis, inventario e consumidores de saldo global.

## Atualizacao operacional em 2026-08-04 - Estoque e Inventario

O bloco local de Estoque e Inventario foi concluido sem alterar a base fonte
`sistema_lv_cadeia_embalagem_test`. O clone limpo de trabalho foi
`sistema_lv_cadeia_estoque_clean_test`; o clone antigo
`sistema_lv_cadeia_estoque_test`, criado antes da limpeza de um resíduo de
smoke, foi preservado e não foi usado como fonte de evidência.

- `estoque_movimentos` (13.235), `estoque_itens_arquivados` (10),
  `produto_niveis_estoque_alerta` (163), `inventario_sessoes` (36),
  `inventario_itens` (5.399) e `log_montagem_kits` (145) receberam
  `empresa_id NOT NULL`; o backfill terminou com zero nulos e todos os dados
  locais classificados na empresa legada.
- Movimentos receberam `idempotency_key` opcional com unicidade por empresa;
  sessões de inventário também receberam chave idempotente empresarial.
  FKs compostas validam empresa/produto, empresa/arremate,
  empresa/sessão, empresa/vínculo e embalagem/movimento.
- `api/estoque.js`, `api/inventario.js` e `api/niveis-estoque.js` foram
  revisadas rota a rota. Kits, estorno de Embalagem e o consumidor de saldo em
  `api/demandas.js` passaram a gravar/consultar por empresa. O body não troca
  contexto; produto, origem e sessão são validados pelo backend.
- `auditoria_eventos` permanece global e foi explicitamente mantida no bloco
  transversal seguinte. A rota de auditoria do Estoque falha fechada para
  empresas secundárias e writers secundários não gravam eventos globais até
  essa migração.

Evidências locais: migration aplicada duas vezes no clone limpo; rollback em
`sistema_lv_cadeia_estoque_rollback2_test` devolveu hashes e colunas idênticos
ao baseline; `tools/testar-estoque-constraints-local.mjs` aprovou zero nulos,
FK cruzada rejeitada e unicidade de idempotência; o smoke
`tools/testar-estoque-inventario-http-local.mjs` aprovou cinco leituras
isoladas, body spoof, movimento manual/lote/estorno idempotentes e inventário
isolado. `node --check`, `npm run typecheck` e `npm run build` passaram; o
build manteve apenas o aviso conhecido de chunk grande.

Comandos executados ficaram registrados nos scripts locais de inspeção,
migration, rollback, constraints e HTTP. Nenhuma migration foi executada na
Neon; não houve commit, push ou deploy.

Próximo passo recomendado: fechar os consumidores transversais, começando por
`auditoria_eventos`, `eventos_sistema`, `historico_alertas`, cron, alertas,
agentes, dashboard e relatórios; depois revisar os gates G11/G12.

## Atualizacao operacional em 2026-08-04 - Consumidores transversais

O bloco transversal foi concluido somente em clones PostgreSQL locais. O clone
principal foi `sistema_lv_cadeia_transversal_test`, derivado do clone limpo de
Estoque; baseline e rollback foram criados e preservados. A base principal de
Produção e todos os clones anteriores permaneceram intactos.

- A migration de Alertas aprovada foi reaplicada na nova linhagem, e
  `comissoes_pagas`, `audit_log` e `auditoria_eventos` receberam
  `empresa_id NOT NULL`, FKs `NOT VALID`, unicidades compostas e índices.
  O backfill preservou 6, 3.457 e 295 registros, respectivamente, todos na
  empresa legada.
- A unicidade global antiga de `comissoes_pagas` por nome/ciclo foi trocada por
  unicidade empresarial; a regressão foi encontrada e corrigida no smoke de
  constraints antes do rollback final.
- `api/audit.js` grava o contexto empresarial no `audit_log`; `api/audit-log.js`
  filtra histórico e usuários pela empresa ativa; `api/estoque.js` grava e lê
  `auditoria_eventos` por empresa. O endpoint `audit-log` foi montado também
  em `api/index.js`.
- O HTTP transversal aprovou isolamento de audit-log, usuários e auditoria de
  Estoque em dois contextos, inclusive writer empresarial. Os smokes de cron/
  alertas e Estoque/Inventário foram repetidos na nova linhagem como regressão
  e retornaram `aprovado: true`.
- Constraints, backfill e rollback conjunto foram aprovados; typecheck, build,
  checagens sintáticas e diff check passaram. O build mantém somente o aviso
  conhecido de chunks grandes.
- Não houve migration na Neon, commit, push ou deploy. O próximo passo é
  preparar o diff reproduzível do G11; G12 continua condicionado à autorização
  operacional explícita.

## Plano de fechamento da Fase 8 — decisão operacional em 2026-08-05

Os ensaios locais da cadeia produtiva até consumidores transversais estão
aprovados nos clones PostgreSQL preservados. Antes de qualquer commit, o
worktree será congelado e uma bateria integrada de G1–G6 será executada somente
em clones locais, cobrindo invariantes de quantidade, perdas, arremates,
embalagem, estoque, inventário, comissões, retry, concorrência, idempotência,
auditoria e isolamento entre empresas.

O staging permanece fora do fluxo. G11 só será fechado após essa bateria e a
revisão do diff reproduzível. G12 continuará pendente até autorização explícita
para commit, deploy, migration na Neon, smoke produtivo controlado e eventual
liberação de empresa secundária.
Na primeira rodada da bateria integrada, o clone preservado
`sistema_lv_g6_integrada_test` aprovou os fluxos de Producao, Arremates,
Estoque/Inventario, Transversais, Cron/Alertas, consumidores da Dashboard,
constraints empresariais e, apos migration local de Promessas aplicada somente
nesse clone, os consumidores de Producao. A rodada nao fechou G6: `api/estoque.js`
tem uma query de `entrada-producao` com os placeholders deslocados, o clone
transversal principal nao contem `empresa_id` em `producao_promessas`, e o script
de cadeia deixou no clone G6 a empresa temporaria 70 com dois registros de
`audit_log`. `npm run typecheck` e `git diff --check` passaram. Esses bloqueios
devem ser resolvidos e revalidados antes do congelamento G11; nenhuma correcao
de codigo, commit, push, deploy ou migration na Neon foi feita nesta auditoria.

Atualizacao da bateria v5: as correcoes de `api/estoque.js`, do guard
secundario de `entrada-producao` e dos cleanups de Embalagem, Estoque e cadeia
foram validadas no clone local preservado
`sistema_lv_g6_integrada_v5_test`. A bateria completa G6 passou 12/12, as
contagens dos dominios mutaveis retornaram iguais as da origem, `npm run
typecheck`, build e `git diff --check` passaram. Permanecem somente tres
eventos de tarefa em `ponto_eventos` da empresa temporaria: o livro e
append-only e o trigger impede sua exclusao. Esses eventos, a empresa e o
vinculo correspondente foram mantidos como evidencia no clone candidato; nao
houve desativacao de trigger, alteracao dos clones protegidos, migration na
Neon, commit, push ou deploy. G6 funcional e G6.8 estao aprovados; G6.7 possui
essa excecao documentada para revisao durante G11.

Atualizacao do G11 em 2026-08-05: a matriz seletiva foi consolidada no
`_planejamento/multiempresas-controle-de-arquivos.md`, com 28 arquivos puros,
seis arquivos mistos e os diffs paralelos explicitamente fora do pacote. O
typecheck, o build e o `git diff --check` passaram novamente; a bateria G6 v5
nao foi repetida porque nao houve regressao concreta. O G11 esta preparado
para aceite manual do diff, mas continua sem commit, push, deploy, migration
na Neon ou liberacao de empresa secundaria.

Achado adicional do G11 em 2026-08-05: a auditoria estrutural read-only do
clone local confirmou zero nulos, orfaos ou duplicidades de idempotencia nos
dados empresariais verificados, mas os probes transacionais confirmaram que
`demandas_componentes_atribuidos` ainda aceita `empresa_id` nulo e conserva
`UNIQUE (componente_chave)` global. Tambem permanecem unicidades globais
legadas para nome de produto, numero de OP e PN de corte. Isso decorre do
ensaio aditivo com `constraints_legadas_preservadas = true`; nao houve escrita
persistente, migration na Neon ou alteracao de runtime. A migration final deve
substituir essas unicidades quando a regra empresarial exigir e normalizar os
campos obrigatorios antes da liberacao de empresa secundaria.

Atualizacao estrutural do G11 em 2026-08-05: a pendencia foi ensaiada e
corrigida somente em `sistema_lv_g11_constraints_test`, derivado do clone G6 v5.
A migration local
`_planejamento/migration-cadeia-fase8-finalizacao-chaves-empresariais-ensaio.sql`
tornou `empresa_id` obrigatorio em Produtos, Demandas, componentes atribuidos,
OPs e Cortes, removeu as sete unicidades globais conflitantes e preservou as
chaves empresariais compostas. A aplicacao repetida foi idempotente. O teste
estrutural passou 5/5 probes; o rollback em
`sistema_lv_g11_constraints_rollback_test` passou 2/2 probes e restaurou a
estrutura aditiva anterior com snapshots identicos. As ferramentas de teste e
os dois SQLs sao evidencias de ensaio local e nao autorizam migration na Neon.
O G11 segue preparado para aceite manual da separacao seletiva do worktree; o
G12 continua pendente. Nao houve staging, commit, push, deploy ou alteracao dos
clones protegidos.

Atualizacao operacional local em 2026-08-05: os erros HTTP 500 observados ao
abrir Ordens de Producao foram reproduzidos quando o servidor local carregou o
`.env` apontado para a Neon, que ainda nao recebeu a Fase 8. O `.env` permanece
intocado por decisao do projeto. O desenvolvimento e os smokes locais devem
usar `tools/iniciar-dev-clone-local.ps1`, que sobrescreve `POSTGRES_URL` apenas
nos processos filhos com o clone PostgreSQL local escolhido. O agente global de
OP agora falha fechado enquanto o contexto empresarial ainda nao estiver
carregado e volta a consultar somente apos o evento de contexto carregado.
Essa protecao evita 500 transitivo durante a primeira pintura sem alterar a
regra de staging, Neon ou producao.

Validacao final do iniciador: com um clone local novo, a API respondeu HTTP 200
em `/api/ping` e o Vite entregou HTTP 200 para
`/admin/ordens-de-producao.html`. O argumento da porta do Vite foi ajustado
para a forma compativel com `Start-Process` no PowerShell do Windows.

Aceite manual local do G11 em 2026-08-05: o usuario confirmou que nao encontrou
erros e que os fluxos estao funcionando corretamente. O G11 fica aceito no
escopo local, mas qualquer commit, push, deploy, migration na Neon, smoke
produtivo, liberacao secundaria ou abertura do G12 continua dependendo de
autorizacao explicita.

Revisao seletiva final em 2026-08-05: o hunk de `api/dashboard.js:1209-1210`
que apenas reescreve `paramsPontos` foi identificado como paralelo e deve ficar
fora do pacote da Fase 8. As alteracoes de pontos em `api/producoes.js` e
`api/real-producao.js` foram confirmadas como filtros e escritores empresariais
da cadeia. Nenhum staging ou commit foi feito.

Fechamento final do G11 em 2026-08-05: o usuario confirmou console limpo no
ambiente local iniciado por `tools/iniciar-dev-clone-local.ps1` com o clone
`sistema_lv_cadeia_transversal_test`. Typecheck, build e diff-check passaram
novamente, as referencias dos blocos `op-redesign-kpis` e
`op-redesign-leitura` nao existem mais, e o staging continua vazio. O G11 esta
aceito no escopo local. O handoff operacional para o proximo Codex esta em
`_planejamento/RETOMADA-G12-FASE8-MULTIEMPRESAS-2026-08-05.md`.

O proximo trabalho e preparar, sem staging, a composicao seletiva do pacote e
aguardar autorizacao do usuario. G12 permanece pendente: commit, push, deploy,
migration na Neon, smoke produtivo e liberacao de empresa secundaria sao
decisoes separadas e nao recebem autorizacao implicita do fechamento local.

Fechamento do G12 em 2026-08-06: após autorização explícita, a migration
`multiempresas-fase8-liberacao-v1` foi ensaiada duas vezes no clone descartável
`sistema_lv_g12_liberacao_test` e validada localmente com `aprovado: true`. O
preflight da Neon confirmou os dez marcadores estruturais e os onze módulos do
escopo. A migration foi executada e validada na Neon com `aprovado: true`,
deixando 11 módulos habilitados em cada empresa ativa. O cadastro de novas
empresas agora habilita automaticamente os módulos cujo catálogo esteja
marcado como `multiempresa_pronto`; módulos fora do escopo da Fase 8 continuam
bloqueados.

Decisao de UX multiempresa em 2026-08-06: a identidade visual do carregamento
deve usar a empresa ativa do contexto do token, respeitando a mesma sigla e
`cor_identificacao` exibidas no `ml-company-compact`. O bootstrap sincronico
`public/js/utils/empresa-carregamento-bootstrap.js` e carregado nas paginas
comuns antes dos bundles React, hidrata loaders estaticos e expoe a mesma
identidade para `UICarregando` e `htmlUICarregando`. Em impersonacao,
`sessionStorage` tem prioridade; no fluxo normal, `localStorage` e a fonte
primaria. A troca de empresa nao deve limpar `empresaAtiva` antes de gravar o
novo contexto, pois esse intervalo causa o fallback visual para LV. A pagina
de Ordens de Producao permanece sem alteracao estrutural no HTML inicial.

## Estado operacional consolidado — 2026-08-06

Esta secao e a referencia atual para continuidade; os blocos anteriores que
descrevem ensaios pendentes permanecem como historico da execucao.

- O G11 foi aceito localmente e o G12 foi executado com autorizacao explicita.
  A migration `multiempresas-fase8-liberacao-v1` foi executada e validada na
  Neon com `aprovado: true`, deixando os 11 modulos da cadeia habilitados para
  `lojas-variara` e `neila-confeccoes`. Novas empresas recebem esses modulos
  quando o catalogo correspondente estiver marcado como
  `multiempresa_pronto`.
- O pacote da cadeia produtiva foi publicado no commit `47ae4dd`.
  Permanecem fora dele o hunk `api/dashboard.js:1209-1210`, os diffs paralelos
  do worktree e as remocoes visuais de OP.
- Calendario foi publicado nos commits `46663d0` e `b9acd29`; a migration e a
  correcao de unicidade foram executadas e validadas na Neon.
- Incentivos foi publicado no commit `4511b6f`. A migration
  `multiempresas-fase9-incentivos-v1` foi executada e validada na Neon com
  `aprovado: true`, sem linhas sem empresa, sem usuarios ou produtos fora do
  contexto e sem unicidades globais conflitantes.
- Central de Pagamentos foi publicada no commit `705dd13`. A migration
  `multiempresas-fase9-central-pagamentos-v1` foi executada e validada na Neon
  com `aprovado: true`: as tres tabelas estao sem nulos, as oito constraints
  empresariais estao validas, a unicidade global de registro de dia foi
  removida, a unicidade empresarial permanece presente e as duas empresas
  estao habilitadas. O usuario tambem confirmou testes manuais sem vazamento.
- O typecheck, build, `node --check` da API da Central e `git diff --check`
  passaram no pacote da Central. O build manteve apenas os avisos conhecidos
  do bootstrap nao-module e do chunk grande da Central.
- O worktree compartilhado continua sujo por redesign, migracao progressiva
  para TypeScript e outros diffs paralelos. O staging esta vazio; nenhum desses
  diffs deve ser incluido automaticamente no proximo commit.

Nao ha incidente urgente conhecido neste momento. Nao repetir smokes de dominio
ja aprovados, nao executar novas migrations e nao publicar novo commit sem
autorizacao. O proximo ponto de partida esta em
`_planejamento/RETOMADA-FASE9-POS-CENTRAL-2026-08-06.md`.

## Atualizacao operacional — Home/Admin — 2026-08-07

- A migration `multiempresas-fase9-home-admin-v1` foi executada e validada na
  Neon com `aprovado: true`.
- O catalogo marcou `home-admin` como `multiempresa_pronto` e as empresas
  ativas `lojas-variara` e `neila-confeccoes` ficaram habilitadas.
- O Home/Admin nao possui tabelas empresariais proprias nesta etapa. O endpoint
  contextualizado e `/api/configuracoes/publicas`, que retorna configuracoes
  publicas do ambiente.
- A validacao confirmou zero empresas ativas pendentes e a migration registrada
  em `sistema_migrations`. Os SQLs de migration e validacao ficam em
  `_planejamento/migration-multiempresas-fase9-home-admin.sql` e
  `_planejamento/validacao-multiempresas-fase9-home-admin.sql`.
- Nenhum commit, push, deploy ou staging foi feito. A rota independente de
  permissoes de usuarios foi removida apos a integracao da auditoria na Gestao
  Organizacional.
- O `audit-log` agora e exposto pela aba Auditoria da Gestao Organizacional,
  respeitando a empresa em foco. O identificador de permissao
  `acesso-permissoes-usuarios` foi mantido apenas por compatibilidade com
  registros existentes e passou a representar a visualizacao dessa auditoria.

## Migração do identificador de auditoria da Gestão Organizacional — 2026-08-07

- O identificador canônico passou a ser
  `acesso-auditoria-gestao-organizacional`.
- A aplicação opera em dual-read e dual-write durante a transição: aceita o
  identificador canônico e o alias `acesso-permissoes-usuarios`, oculta o alias
  no catálogo da interface e persiste ambos quando a permissão é atribuída.
- O editor normaliza registros antigos para o identificador canônico na tela;
  ao remover a permissão, os dois aliases são removidos, evitando que o código
  legado reapareça silenciosamente.
- A migration aditiva e a validação somente leitura ficam em
  `_planejamento/migration-permissao-auditoria-go-canonica-v1.sql` e
  `_planejamento/validar-permissao-auditoria-go-canonica-v1.sql`.
- A remoção definitiva do alias ainda não foi feita. Ela só poderá ocorrer
  depois de uma janela de observação com a dual-read/dual-write funcionando.
- O ensaio local foi concluído em 2026-08-07 sobre uma restauração UTF-8
  descartável do backup pré-Fase 7. A migration foi executada duas vezes e o
  validador retornou `aprovado: true` nas duas execuções, com zero linhas
  somente com um dos identificadores e um único marcador em
  `sistema_migrations`. O clone e as portas isoladas foram removidos ao final.
- A migration foi executada e validada na Neon em 2026-08-08 após autorização
  explícita: a pré-validação encontrou 2 registros somente com o alias antigo;
  a pós-validação retornou `aprovado: true`, com 2 linhas contendo ambos os
  identificadores, zero linhas parciais e um único marcador em
  `sistema_migrations`.

## Atualizacao operacional — primeira fatia da Embalagem — 2026-08-08

- `public/admin/embalagem-de-produtos.html` agora usa o shell padrao
  `main#root.gs-card` e monta uma unica arvore React por
  `public/src/main-embalagem.tsx`.
- A fila inicial foi migrada para componentes TSX tipados, com busca, filtros
  compactos, ordenacao, cards responsivos e imagem especifica da variacao.
  A API permaneceu em JavaScript e nao foi alterada.
- Cards nao exibem `Descartar`, `Abrir fila` ou `Arrematado em`; o card inteiro
  abre o modal de opcoes, com quantidade disponivel em destaque.
- `Registrar perda` fica no header, fora dos cards, e abre uma entrada
  conceitual que sera conectada ao fluxo generico de perdas da Producao/OP. O
  endpoint legado de perdas de Arremates nao e reutilizado e nenhum descarte
  foi criado aqui.
- A conferência operacional foi tipada para embalagem unitária; kits e
  histórico continuam como próximas fatias. O HTML novo nao carrega mais o
  entry legado da pagina.

## Atualizacao operacional — modal e refresh da Embalagem — 2026-08-08

- O modal de um produto abre diretamente na aba `Embalar unidades`; a tela
  intermediaria de opcoes foi removida.
- O modal agora possui as abas internas `Embalar unidades`, `Montar e embalar
  kit` e `Historico`. A montagem consulta os componentes do catalogo, calcula
  saldo por variacao em lotes FIFO e usa `/api/kits/montar`; o historico usa
  `/api/embalagens/historico`. Nenhum fluxo de retorno ao arremate foi levado
  para a nova arvore React.
- `EmbalagemControleQuantidade` e compartilhado pela embalagem unitaria e pela
  montagem de kits, com `+1`, `+5`, `Tudo`, `LIMPAR` e entrada manual.
- O estilo do antigo `.op-redesign-refresh` foi promovido para o global
  `.gs-btn-refresh`. Ordens de Producao e Embalagem agora usam a mesma classe;
  a classe especifica de OP foi removida.
- A quantidade da fila preserva a precedencia do contrato da API:
  `total_disponivel_para_embalar ?? quantidade_disponivel ?? quantidade`.
  Typecheck e build foram validados localmente apos esta fatia.

## Atualizacao operacional — refinamento visual do modal de Embalagem — 2026-08-08

- O modal passou a usar largura maior e um cabecalho unico de identidade do
  produto, com imagem destacada, nome, variacao, SKU e saldo disponivel.
- A selecao de kits deixou de usar `select`: cada kit e um cartao expansivel
  que mostra suas variacoes no proprio contexto, com imagem, nome e SKU.
- A exibicao de kits deve usar o nome vindo de `ProdutoCadastro.nome`; nao
  passar um fallback como segundo argumento de `getNomeProduto`, pois esse
  argumento tem precedencia e pode sobrescrever o nome real.

## Atualizacao operacional — grade de kits e estabilidade de selecao — 2026-08-08

- A quantidade de variacoes agora usa singular/plural corretamente: `1
  variacao compativel` e `2 variacoes compativeis`.
- A selecao de kit/variacao preserva o `scrollTop` do modal durante o
  carregamento assincrono dos componentes, evitando o salto visual para o
  cabecalho.
- Os componentes exibem imagem no lado esquerdo da celula de componente.
- A grade de kits usa duas colunas em tablets, tres em desktop e uma em
  celulares; o kit ativo ocupa a largura da linha para revelar as variacoes.

## Atualizacao operacional — perdas na cadeia produtiva — 2026-08-08

- O formulario legado de perda agora usa somente `QUANTIDADE_ERRADA` e
  `PRODUTO_AVARIADO`; `DIVERGENCIA_SALDO` e `LANCAMENTO_ERRADO` continuam sendo
  aceitos como aliases de compatibilidade e normalizados para
  `QUANTIDADE_ERRADA`.
- A observacao passou a ser obrigatoria. O backend recalcula o saldo real das
  OPs dentro de transacao com lock por produto, considera sessoes ativas,
  impede saldo negativo e nao gera pontos para perdas.
- A migration aditiva `_planejamento/migration-ajustes-producao-perdas-v1.sql`
  cria `ajustes_producao` e `ajustes_producao_itens`; durante a transicao, o
  endpoint preserva o lancamento `PERDA` em `arremates` e grava o vinculo
  `id_ajuste_producao`. Ela foi executada e validada na Neon em 2026-08-08,
  com o marcador `ajustes-producao-perdas-v1` registrado as 23:37:11-03.

## Atualizacao operacional — inteligencia de estoque na Embalagem — 2026-08-08

- A aba `Montar e embalar kit` cruza o saldo real de `/api/estoque/saldo` com
  a meta ideal de `/api/niveis-estoque`, sempre por `produto_ref_id`/SKU da
  variacao do kit.
- O modal exibe estoque atual, meta ideal, deficit, progresso e limite
  montavel pelos componentes. A sugestao de reposicao e manual: `Usar
  sugestao` apenas preenche o componente compartilhado de quantidade e nao
  confirma a montagem automaticamente.
- A fila continua operacional quando o usuario nao possui permissao de
  consulta a uma das fontes de estoque: a falha e degradada para saldo/meta
  nao disponivel, sem bloquear a embalagem. Nenhum endpoint da API foi
  migrado para TypeScript ou alterado nesta fatia.

## Atualizacao operacional — grade dos cards da Embalagem — 2026-08-08

- A fila inicial usa duas colunas em desktop e tablet, mantendo uma coluna em
  celulares para preservar leitura e toque.
- O card inteiro continua sendo o alvo de abertura do modal; o indicador
  visual legado `ep-card-abrir` foi removido.

## Atualizacao operacional — hierarquia dos cards da Embalagem — 2026-08-08

- Os cards nao exibem mais o nome do produto visualmente: a variacao ocupa a
  primeira linha, o SKU fica em linha propria e `Disponivel desde` usa uma
  data/hora compacta na linha seguinte.
- A quantidade usa a unidade contextual `und` para uma unidade e `unds` para
  mais de uma, sempre encostada ao numero principal.
- A borda charme dos cards segue o contrato oficial: elemento
  `card-borda-charme` com `inset: 0`, `border-radius: inherit` e
  `box-shadow: inset 3px 0 0`; o rodape de quantidade usa bloco de largura total
  para preservar o recuo do conteudo sob o overlay.
## Atualizacao operacional - nomes longos nos cards da Embalagem - 2026-08-08

- A variacao do card pode ocupar uma ou duas linhas, com altura reservada
  para duas linhas em todos os cards; isso preserva o alinhamento da grade.
- O excedente e ocultado sem reticencias visuais, e o nome completo fica
  disponivel no tooltip nativo do navegador.

## Atualizacao operacional - feedback das operacoes de embalagem - 2026-08-09

- Embalagem unitária e montagem de kit exibem `mostrarMensagem` com tipo
  `sucesso` e botão `OK` após a API concluir.
- Falhas da operação exibem o mesmo popup com tipo `erro` e mantêm a mensagem
  detalhada dentro do modal.

## Atualizacao operacional - limpeza do legado especifico da Embalagem - 2026-08-09

- O entrypoint ativo da Embalagem permanece exclusivamente em
  `public/src/main-embalagem.tsx`; o entrypoint JSX antigo, o script de pagina
  legado, o CSS antigo e as duplicatas JSX/JS de cards, filtros e helpers foram
  removidos.
- Dependencias compartilhadas e seus mapeamentos foram preservados: auth,
  popups, paginação, menu, agentes globais e APIs não fazem parte desta limpeza.

## Atualizacao operacional - edicao vazia da quantidade - 2026-08-09

- O input compartilhado de quantidade aceita ficar vazio durante a edicao;
  apagar o conteudo nao injeta `0` automaticamente.
- O valor vazio e representado por `null` no componente e continua invalido
  para envio; `0` permanece o valor explicito do comando `LIMPAR`.

## Atualizacao operacional - escritores legados POS_OP - 2026-08-08

- A validacao pos-migration encontrou 17 lancamentos `PRODUCAO` novos sem
  `executor_id`; todos tinham `usuario_tiktik_id`, portanto o problema era um
  escritor legado sem dual-write, nao perda de dados.
- As rotas manual, finalizacao de sessao, prestador externo e estorno agora
  gravam executor, tipo, fase POS_OP e a identidade da etapa configurada no
  produto quando `pos-op-sessoes-producao-v1` esta ativo.
- A correcao dos registros ja criados fica em
  `_planejamento/migration-pos-op-executores-legados-v1.sql`, com validador
  correspondente. A migration e idempotente e nao altera quantidade, pontos,
  data ou perdas.

## Atualizacao operacional — carregamentos do modal de Embalagem — 2026-08-08

- Os estados de busca de lotes, componentes e historico do modal usam
  `UICarregando` em variante `bloco`, sem textos de carregamento ad-hoc.

## Atualizacao operacional — paginação da fila de Embalagem — 2026-08-08

- A fila voltou a exibir seis cards por página usando o helper legado
  `public/js/utils/Paginacao.js` e as classes globais `gs-paginacao-*`.
- A lógica de paginação permanece em JavaScript; o React apenas fatia os
  dados, fornece o container e reage à página escolhida.

## Atualizacao operacional — confirmação das embalagens — 2026-08-09

- Embalagem unitária e montagem de kit exibem o popup sistêmico
  `mostrarConfirmacao` antes de consumir lotes ou chamar a API.
- A confirmação mantém `popups.css` no HTML da página e usa textos de ação
  específicos (`Embalar` e `Montar e embalar`), sem alterar os endpoints.

## Atualização operacional — remoção da sugestão automática — 2026-08-09

- A seleção de tarefa voltou a ser manual. Não chamar
  `/api/producao/sugestao-tarefa`, manter estado de sugestão ou enviar listas
  de candidatas ao backend.

## Atualizacao operacional - redesign dos modais OP/POS_OP - 2026-08-09

- A selecao de tarefa agora oferece filtros explicitos para Producao da OP e
  Arremate pos-OP, com contagem, executor autorizado e efeito no fluxo.
- A confirmacao de quantidade mostra a fase e comunica se a tarefa continua na
  OP ou libera a peca para embalagem; os payloads e limites foram preservados.
- O redesign foi aplicado somente aos modais de atribuicao; configuracoes de
  produtos, saldos e regras de lancamento nao foram alterados.

## Atualizacao operacional - validacao da etapa POS_OP - 2026-08-09

- Na atribuicao, `etapa_id` e a identidade principal da etapa da receita.
  `processo_id` e o nome sao fallbacks para compatibilidade com dados antigos
  e renomeacoes do catalogo.
- Depois da resolucao, a sessao grava o nome canonico do processo, evitando que
  o legado `Arrematar` cause rejeicao quando a etapa POS_OP ja foi identificada.
- A finalizacao da sessao reutiliza o mesmo resolvedor canonico para determinar
  maquina, pontos e identidade do lancamento POS_OP.

## Atualizacao operacional - consolidacao segura de POS_OP - 2026-08-09

- A fila pode consolidar tarefas POS_OP somente com o mesmo `produto_id`,
  variante exata e identidade da etapa. SKU isolado nao e criterio suficiente.
- A consolidacao cria uma unica sessao POS_OP com `origens_pos_op` no formato
  `[{op_numero, quantidade}]`; a quantidade e redistribuida em ordem FIFO,
  usando o saldo real travado de cada OP dentro da transacao.
- A finalizacao continua sendo uma unica acao do supervisor, mas grava um
  lancamento POS_OP por OP de origem na mesma transacao, preservando pontos,
  executor, auditoria e rastreabilidade para a embalagem.
- A migration correspondente e
  `_planejamento/migration-pos-op-origens-sessao-v1.sql`, com validador em
  `_planejamento/validacao-pos-op-origens-sessao-v1.sql`.

## Handoff operacional — Produções/POS_OP — 2026-08-09

- A migration `pos-op-origens-sessao-v1` foi executada na Neon às
  01:40:45-03 e validada. O usuário testou 171 peças do Scrunchie marrom
  distribuídas em quatro OPs (49 + 60 + 60 + 2); o sistema criou uma única
  tarefa consolidada.
- O handoff completo para a próxima retomada está em
  `_planejamento/HANDOFF-PRODUCOES-POS-OP-2026-08-09.md`.
- Antes de continuar, o próximo Codex deve ler esse handoff, não repetir as
  migrations, não alterar receitas de produtos já revisadas e confirmar o
  smoke de finalização multi-origem, pontos, fila, embalagem e saldo.
- A página de Arremates, a origem genérica de Embalagem/Estoque e o histórico
  geral de Produções ainda não foram encerrados; manter compatibilidade legada
  até esses consumidores serem migrados e validados.

## Atualizacao operacional - gate multi-origem e retomada da origem generica - 2026-08-09

- O gate read-only de finalizacao multi-origem foi confirmado na Neon sem
  executar migration nem alterar dados. As sessoes POS_OP `11093`, `11092` e
  `11088` finalizaram respectivamente 33, 138 e 151 pecas, totalizando 322.
- Cada sessao gerou um lancamento legado em `arremates` por OP de origem, com
  a mesma sessao, executor preenchido, fase POS_OP e tipo PRODUCAO. Os pontos
  fecharam em 33, 207 e 151; a soma de cada sessao corresponde ao snapshot de
  pontos multiplicado pela quantidade finalizada.
- A fila ficou zerada para as origens integralmente consumidas. Na ultima
  origem parcial da sessao `11088`, a OP `11848` preservou corretamente saldo
  residual de 7 pecas. As 322 pecas ficaram liberadas para embalagem, sem
  movimento fisico de estoque ainda; portanto o gate confirma saldo pronto,
  nao uma entrada em estoque ja realizada.
- A retomada foi implementada de forma aditiva pela migration ainda local
  `_planejamento/migration-origens-produto-pronto-v1.sql`. Ela cria a origem
  generica `origens_produto_pronto`, as alocacoes normalizadas de embalagem e
  o vinculo opcional do movimento de estoque com a embalagem. Nao existe
  backfill automatico e a migration nao foi executada na Neon.
- Antes da nova migration, Embalagem e Kits continuam operando pelo contrato
  legado de `arremates`. Depois dela, origens canonicas e legadas podem ser
  consumidas juntas em FIFO, sem duplicar um arremate ja vinculado a uma
  origem canonica; o saldo legado continua atualizado como projecao de
  compatibilidade.
- A embalagem unitaria passa a confirmar consumo, embalagem e entrada de
  estoque na mesma transacao e com chave de idempotencia. Kits usam o mesmo
  alocador generico por produto e variante. O estorno desfaz as alocacoes
  normalizadas e preserva o fallback legado para registros anteriores.
- O endpoint `GET /api/producoes/historico` fornece o historico geral de
  Producoes, unificando OP, POS_OP, cancelamentos, perdas, embalagem, estoque e
  estornos. Finalizacoes POS_OP multi-origem sao agrupadas pela sessao, e o
  modal historico antigo permanece apenas como alias visual compativel.
- O smoke em PostgreSQL descartavel aprovou migration aditiva, ausencia de
  backfill, fallback pre-migration, fila sem duplicidade, consumo misto,
  atomicidade embalagem/estoque, idempotencia, estorno, kit e historico. Antes
  de qualquer execucao na Neon, a nova migration ainda deve ser ensaiada na
  restauracao local validada e receber autorizacao explicita do usuario.

## Atualizacao operacional - pre-gate de migration de origem generica - 2026-08-09

- A consulta read-only do schema atual confirmou na Neon a presenca de
  `empresa_id` em Produtos, OPs, sessoes, arremates, embalagem e estoque;
  confirmou tambem `processos_producao`, `origens_pos_op` e todas as chaves
  compostas empresariais exigidas pelos FKs da nova migration.
- O marcador `pos-op-origens-sessao-v1` existe e
  `origens-produto-pronto-v1` ainda nao existe. A nova migration esta pronta
  para execucao manual pelo usuario; o agente nao deve executa-la na Neon.
- O dump local disponivel de 29/07 e anterior ao isolamento produtivo e nao
  representa o schema atual. Ele nao deve ser usado para repetir migrations ou
  validar receitas. O smoke descartavel continua sendo a validacao local dos
  fluxos aditivos ate existir uma restauracao atualizada autorizada.

## Atualizacao operacional - migration de origem generica executada - 2026-08-09

- O usuario executou `_planejamento/migration-origens-produto-pronto-v1.sql`
  na Neon em `2026-08-09 13:54:35.820227-03` e retornou o validador com
  `aprovado` estrutural: marcador presente, duas tabelas criadas, coluna
  `estoque_movimentos.embalagem_origem_id` presente e todos os FKs esperados.
- Os contadores `origens_canonicas = 0` e `consumos = 0` estao corretos:
  `backfill_automatico = false` preserva os arremates antigos sem copiar
  registros. As origens canonicas passam a nascer nas novas finalizacoes POS_OP.
- `saldos_invalidos`, `arremates_cruzados` e `embalagens_cruzadas` retornaram
  zero. Os FKs foram criados como `NOT VALID`, conforme a migration aditiva;
  novas escritas sao protegidas e a validacao historica completa exige um gate
  separado de saneamento, nao deve ser improvisada durante este smoke.
- O proximo gate e funcional: embalagem unitaria, kit, idempotencia, estorno,
  fila, saldo, origem canonica/legada e historico geral, usando fixtures
  controladas e sem alterar receitas.

## Atualizacao operacional - smoke local pos-migration de origem generica - 2026-08-09

- O smoke local em PostgreSQL temporario, executado contra o schema novo,
  retornou `aprovado: true` em todas as verificacoes: migration aditiva,
  ausencia de backfill, compatibilidade pre-migration, fila sem duplicidade,
  consumo misto canonico/legado, atomicidade embalagem/estoque, idempotencia,
  estorno por alocacao, kit com origem generica e historico geral.
- O proximo gate nao e mais estrutural. Falta somente o smoke autenticado
  controlado com fixtures reais de embalagem, kit, estorno, fila, saldo e
  historico; ele exige escrita temporaria e nao deve ser executado na Neon sem
  autorizacao explicita do usuario.

## Atualizacao operacional - smoke autenticado Neon da origem generica - 2026-08-09

- O smoke `tools/testar-origens-produto-pronto-neon.mjs` foi executado com
  autorizacao explicita e retornou `aprovado: true`.
- Foram aprovados: consumo de origem canonica, atualizacao da projecao legada,
  embalagem unitaria atomica, idempotencia da unidade, historico geral,
  estorno da unidade, montagem de kit, idempotencia do kit, estorno do kit e
  restauracao do saldo final.
- A auditoria independente `READ ONLY` posterior retornou zero residuos para
  origem temporaria, embalagens, movimentos de estoque e alocacoes. Nenhuma
  receita foi alterada e nenhuma migration foi repetida.
- O smoke Neon exige `SMOKE_NEON_CONFIRM=SIM` e recusa URLs locais, mantendo a
  trava para evitar execucao acidental contra outro ambiente.

## Catalogo de permissoes — reorganizacao por modulos aprovada em 2026-08-09

- O catalogo em `public/js/utils/permissoes.js` continua sendo a fonte da
  verdade dos IDs. Nenhum ID pode ser renomeado, fundido ou excluido sem
  auditoria e autorizacao explicita.
- A organizacao visual das permissoes e por modulo, com localizacao em
  `pagina` e `aba`. Quando a pagina nao possui abas, `aba = 'Principal'`.
  O termo `sessao` nao deve ser usado para essa finalidade.
- Cada item tambem informa `tipo` (`pagina`, `aba`, `bloco`, `acao` ou
  `escopo`) e uma descricao curta. Acesso a paginas usa sempre o padrao
  `Acessar pagina: [nome da pagina]`.
- O editor da Gestao Organizacional agrupa o catalogo por modulo/categoria e
  exibe pagina, aba, tipo e descricao. O padrao `UIBloqueio` continua sendo a
  referencia para abas, blocos e acoes bloqueadas.
- Os IDs sem referencia encontrada fora do catalogo durante a auditoria de
  2026-08-09 ficam preservados em uma secao marcada `NAO EXISTEM NO CODIGO`.
  Essa classificacao e informativa e nao autoriza exclusao ou invalidacao.
- Foi criado o ID `acesso-calendario`; ele protege a entrada da pagina
  Calendario da Empresa e esta incluido no acesso padrao de supervisores.

## Atualizacao operacional - historico geral na Producao Geral - 2026-08-09

- A pagina `admin/producao-geral.html` agora abre o historico geral de
  Producoes pelo botao `Historico de Producoes`, reutilizando o modal filtravel
  que permanece como alias compativel na pagina antiga de Arremates.
- `GET /api/producoes/historico` aceita `acesso-producao-geral` alem das
  permissoes legadas de OP e Arremates; o backend continua sendo a autoridade
  de empresa e permissao.
- O modal usa o token de impersonacao quando esse contexto estiver ativo. A
  fila, as receitas e as migrations nao foram alteradas nesta etapa.
- `npm run typecheck`, `npm run build` e `git diff --check` passaram. O build
  manteve apenas os avisos conhecidos de scripts sem `type=module` e chunks
  grandes.
- A auditoria read-only dos consumidores confirmou que Embalagem e Kits usam
  o alocador canonico com fallback legado. As rotas manuais de `api/estoque.js`,
  incluindo `entrada-producao`, continuam registrando estoque manual sem
  origem de produto pronto quando chamadas diretamente; isso e compatibilidade
  legada, nao um caminho novo da fila de embalagem.

## Atualizacao operacional - filtros detalhados do historico - 2026-08-09

- O modal de historico geral agora oferece filtros detalhados opcionais por
  produto, empregado, OP e processo, mantendo evento, fase, periodo e busca
  ampla.
- O endpoint `GET /api/producoes/historico` aplica esses filtros com parametros
  SQL e sempre preserva o predicado de `empresa_id` do contexto autenticado.
- A pagina legada de Arremates continua usando o mesmo componente e contrato;
  nenhuma receita, migration ou dado externo foi alterado.
- `npm run typecheck`, `npm run build`, `node --check api/producoes.js` e
  `git diff --check` passaram.

## Bloqueio de paginas sem permissao no menu aprovado em 2026-08-09

- O menu lateral deve manter todos os modulos e paginas do catalogo visiveis,
  mesmo quando o vinculo atual nao possui a permissao correspondente. Itens
  bloqueados nao podem desaparecer nem revelar o conteudo da pagina protegida.
- A variante de pagina do `UIBloqueio` e usada nesses itens e nos favoritos do
  menu lateral.
  Ao clicar em um item bloqueado do menu, abre um popup modal explicando o
  bloqueio e a pagina solicitada. O popup nao fecha por clique externo e oferece
  somente o botao para voltar a area inicial adequada (Home administrativa ou
  Dashboard), sem logout e sem abrir a pagina protegida. A tela
  `admin/acesso-negado.html` fica reservada para bloqueios de acesso direto
  feitos pelos guards das paginas.
- O contexto temporario fica em `sessionStorage` e informa a area solicitada,
  a permissao necessaria e uma explicacao curta. A verificacao de autenticacao
  de acesso direto tambem deve registrar esse contexto antes de redirecionar;
  a pagina protegida nunca deve ser renderizada para um usuario bloqueado.
- `admin/acesso-negado.html` usa `main-acesso-negado.tsx` e a paleta global do
  sistema. A tela e responsiva, acessivel, nao oferece logout e nao depende de
  JavaScript inline. Ela tambem sobrescreve a visibilidade global do `body`,
  que por padrao fica oculto ate a autenticacao das paginas do sistema.
- A Home administrativa reutiliza o mesmo catalogo do menu e tambem deve manter
  areas sem permissao visiveis nos acessos recentes, recomendacoes e central de
  comandos. A abertura de qualquer item bloqueado usa o popup modal de pagina e
  retorna para a area inicial pelo botao unico. A Home nao possui mais bloco de
  atalhos ou favoritos.
- No Estoque, os botoes `Ver Arquivados` e `Inventario` permanecem visiveis
  quando bloqueados. Eles usam `aria-disabled` e o popup modal padrao; nao usar
  `disabled = true`, pois isso impediria a explicacao do bloqueio ao usuario.
- No historico compartilhado de Producoes, o botao contextual de estorno
  permanece visivel durante a janela de desfazer mesmo sem
  `estornar-arremate`. Nesse caso ele mostra cadeado, usa `aria-disabled` e
  abre o popup padrao; o `disabled` real fica reservado somente ao estado de
  processamento da requisicao.
- O agente global de encerramento de OP falha fechado quando a API confirma
  que o vinculo nao possui `acesso-ordens-de-producao` ou quando ainda nao ha
  empresa ativa carregada; ele nao e uma pagina do menu. Com acesso a
  Producoes, mas sem `usar-agente-encerrador`, o FAB permanece visivel em
  estado bloqueado e explica a restricao ao clique.
- As acoes internas legadas do Estoque que continuam visiveis — abrir fila,
  configurar niveis, anular promessa e abrir movimentacao — usam o popup
  universal de acao bloqueada quando falta a permissao correspondente. O
  bloqueio de pagina continua reservado a `Ver Arquivados` e `Inventario`.
- O catalogo do menu aceita uma lista de IDs equivalentes para compatibilidade.
  Gestao Organizacional considera os IDs canonico, legado e de auditoria,
  porque o guard da pagina tambem aceita qualquer um deles. A pagina de
  Embalagem exige explicitamente `acesso-embalagem-de-produtos`, alinhada ao
  item correspondente do menu; autenticar sem esse ID nao e permitido.

## Atualizacao operacional - pagina Producoes e historico compartilhado - 2026-08-09

- `admin/ordens-de-producao.html` agora se apresenta como `Producoes` e abre o
  historico geral de OP, POS_OP, perdas, cancelamentos, embalagem, estoque e
  estornos pelo endpoint canonico.
- URL, item de menu, permissao de acesso e rota legada de Arremates permanecem
  estaveis durante a transicao; o componente de historico continua sendo um
  alias compativel.
- O estorno fica visivel somente quando o vinculo possui
  `estornar-arremate`. O escritor operacional continua sendo o fluxo canonico
  de OP/POS_OP, sem reintroduzir o painel antigo de Arremates na pagina de OP.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhuma
  escrita externa foi feita nesta etapa.
- `npm run typecheck`, `npm run build`, `node --check api/producoes.js` e
  `git diff --check` passaram; o build manteve apenas os avisos conhecidos.

## Atualizacao operacional - imagem da variante no historico - 2026-08-09

- O endpoint `GET /api/producoes/historico` resolve `produto_imagem` pela
  variante do evento, procurando `grade[].imagem` pelo valor de `h.variante`.
- `produtos.imagem` continua sendo somente o fallback quando a variante nao
  possui imagem; nenhuma receita ou dado persistido foi alterado.
- A regra vale para producao OP, POS_OP, embalagem, estoque e registros
  legados projetados no historico unificado.
- `node --check api/producoes.js`, `npm run build` e `npm run typecheck` passaram.

## Atualizacao operacional - transicao assistida de Arremates - 2026-08-09

- `admin/arremates.html` continua operacional e preserva os escritores legados,
  mas agora informa que o fluxo unificado esta em Producoes e oferece link
  direto para `admin/ordens-de-producao.html`.
- Nenhum escritor legado foi desligado, nenhuma permissao foi alterada e nao
  houve mudanca em receitas, migrations ou dados externos.

## Atualizacao operacional - entrada do pipeline para Producoes - 2026-08-09

- Os CTAs do pipeline de demandas que encontravam estado de arremate agora
  abrem `admin/ordens-de-producao.html` e exibem `Producoes`.
- A rota antiga, suas permissoes e escritores permanecem ativos para
  compatibilidade; apenas o novo ponto de entrada foi redirecionado.
- `npm run build` e `git diff --check` passaram. O `typecheck` ficou bloqueado
  por erro preexistente e nao relacionado em `public/src/main-home.tsx`, na
  tipagem do predicado de `MenuItem`.

## Atualizacao operacional - aba externa no componente canonico - 2026-08-09

- A aba externa de `admin/arremates.html` agora monta `OPExternoTela.tsx`,
  compartilhando o fluxo de `/api/producoes/externo` com Producoes.
- O endpoint legado `/api/arremates/externo` e os demais escritores da pagina
  antiga permanecem ativos para compatibilidade e serao tratados em gates
  posteriores.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
externo foi escrito nesta etapa.

- `npm run typecheck`, `npm run build`, `node --check` dos routers/utilitário e
  `git diff --check` passaram após a remoção dos componentes órfãos.

## Atualizacao operacional - fila de perdas sem atribuicao legada - 2026-08-09

- `ArremateTelaSelecaoProduto` agora renderiza somente a fila paginada de
  perdas; foram removidos seleção múltipla, modal de lote e a referência a
  `/api/arremates/sessoes/iniciar-lote`.
- Os endpoints legados de sessões continuam preservados no backend, mas não há
  referências no frontend ativo. Nenhuma receita foi alterada, nenhuma
  migration foi repetida e nenhum dado externo foi escrito.

## Atualizacao operacional - componentes visuais orfaos removidos - 2026-08-09

- A auditoria de imports confirmou que os componentes antigos de painel,
  atribuição, externo, tempos, status, confirmação e modal de perda não eram
  usados por páginas ativas; eles foram removidos.
- O seletor e o formulário compartilhados de perdas permanecem porque são
  usados pelo fluxo canônico. Os aliases de backend de sessões, tempos e
  externo continuam preservados para compatibilidade.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - isolamento dos leitores de status - 2026-08-09

- O leitor de status de producao agora restringe imagens, nomes e TPP ao
  produto da empresa ativa, incluindo as sessoes exibidas no historico do dia.
- A soma de pontos do dia em `GET /api/producao/meu-status` tambem aplica
  `empresa_id`, evitando que um mesmo usuario receba pontos de outro contexto.
- O ramo de alertas das costureiras passou a carregar TPP somente pelos
  produtos da empresa ativa, em alinhamento com o ramo canonico dos TikTiks.
- As rotas manuais de `api/estoque.js` permanecem sem origem de produto pronto
  quando chamadas diretamente: sao compatibilidade para ajustes manuais e nao
  devem ser reinterpretadas como consumo automatico da fila. O consumo
  canonico continua em `/api/embalagens/unidade` e `/api/kits/montar`, com
  alocacao FIFO, embalagem e movimento na mesma transacao.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhuma
  escrita externa ocorreu nesta etapa.

## Atualizacao operacional - escritores legados bloqueados - 2026-08-09

- A auditoria estaticamente confirmou que o frontend ativo nao chama mais os
  escritores de Arremates para atribuicao, finalizacao, cancelamento,
  estorno de sessao, lote, assinatura, TPP, embalagem direta ou lancamento
  externo. Esses fluxos usam Producoes/Embalagem canonicos.
- O router `api/arremates.js` agora bloqueia esses caminhos com HTTP 410 e o
  codigo `ARREMATES_LEGADO_SOMENTE_LEITURA`. A habilitacao temporaria de uma
  integracao externa antiga exige `PERMITIR_ESCRITORES_ARREMATES_LEGADOS=true`;
  isso nao reabre a pagina antiga. Os aliases `registrar-perda` e `estornar`,
  que ja delegam para transacoes canonicas, permanecem ativos.
- Os aliases de leitura e as tabelas historicas continuam preservados. A
  limpeza estrutural sera autorizada somente depois da auditoria read-only em
  `_planejamento/validacao-legado-producoes-pos-op-readonly.sql`, pois
  `etapastiktik`, sessoes antigas e arremates ainda sustentam fallbacks e
  historico.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - bloqueio do Cadastro de Produtos - 2026-08-09

- O Cadastro de Produtos mantém a entrada protegida por
  `acesso-cadastrar-produto`. A consulta da lista e a abertura de um produto
  usam `ver-lista-produtos`.
- Criação e edição do produto, imagens, variações, grade, kits, etapas,
  processos e salvamentos usam `gerenciar-produtos`. Os controles continuam
  visíveis e o legado HTML/JS mostra o mesmo popup padrão quando a ação é
  bloqueada.
- `ProdutoEtapasEditor.tsx` aplica `UIBloqueio` ao catálogo de processos e a
  toda a área editável de etapas. `api/processos-producao.js` repete a
  separação entre consulta e mutação no backend.
- `api/produtos.js` passou a proteger também `GET /por-nome`; `api/upload.js`
  passou a exigir `gerenciar-produtos` para imagens do catálogo e teve a
  validação do cabeçalho Bearer corrigida.
- O ID legado `cadastrar-produto` foi preservado na categoria
  `NAO EXISTEM NO CODIGO`; nenhum ID foi renomeado ou excluído. Nenhuma
  migration foi executada e nenhum dado externo foi alterado nesta etapa.

## Atualizacao operacional - tempos padrao com contratos separados - 2026-08-09

- `api/utils/tempos-padrao.js` concentra as consultas e os upserts dos tempos
  sem misturar os contratos: o legado usa `tempos_padrao_arremate` e o
  canonico usa `tempos_padrao_producao`.
- `api/arremates.js` e `api/producao.js` continuam expondo seus payloads e
  permissoes originais, mas agora compartilham o acesso SQL correspondente.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - limpeza visual adicional de Producoes - 2026-08-09

- A pagina ativa usa exclusivamente `public/src/main-op.tsx`; o entrypoint
  `main-op.jsx` e os componentes JSX antigos de externo/tempos foram removidos
  por nao terem HTML ou imports consumidores.
- `OPExternoTela.tsx` e `OPModalTempos.tsx` continuam como implementacoes
  ativas, e a URL `admin/arremates.html` e os aliases de API permanecem
  preservados. O historico ativo importa `ProducaoHistoricoModal`, enquanto
  `ArremateHistoricoModal.jsx` continua como alias de compatibilidade.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - Demandas usa origem generica com fallback - 2026-08-09

- `GET /api/demandas/buscar-produto` agora consulta a CTE
  `OrigensProdutoProntoCompat`, incluindo origens canonicas de produto pronto e
  evitando duplicidade quando o registro legado ja foi materializado.
- Embalagens e movimentos de estoque continuam participando da busca; em
  bases sem a estrutura nova, a CTE volta automaticamente para `arremates`.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - historico geral usa origem POS_OP canonica - 2026-08-09

- `GET /api/producoes/historico` passou a montar a conclusao `POS_OP` a partir
  de `OrigensProdutoProntoCompat`, consolidando sessoes e mantendo o
  `arremate_id` legado somente quando existe uma unica origem.
- Perdas, estornos e cancelamentos antigos continuam sendo lidos no ramo
  legado, porque seus detalhes de ajuste nao existem na origem generica.
- Em bases sem a tabela nova, a CTE usa `arremates` automaticamente; nenhuma
  receita foi alterada, nenhuma migration foi repetida e nenhum dado externo
  foi escrito nesta etapa.

## Atualizacao operacional - pontos da dashboard usam origem compatível - 2026-08-09

- `GET /api/dashboard/desempenho` passou a somar atividades `POS_OP` por
  `OrigensProdutoProntoCompat` para qualquer executor autorizado, mantendo
  pontos históricos e incluindo a empresa ativa explicitamente também nas
  linhas de `producoes`.
- A lista de atividades recentes usa o mesmo contrato, com fallback legado e
  filtro empresarial no produto e na produção.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - fallback preserva executor legado - 2026-08-09

- A CTE `OrigensProdutoProntoCompat` usa `COALESCE` entre `executor_id` /
  `usuario_tiktik_id` e entre `executor_nome` / `usuario_tiktik` no ramo
  legado.
- Assim, pontos e histórico continuam visíveis para lançamentos antigos que
  ainda não possuíam os campos de executor canônicos.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - comissoes usam pontos POS_OP canonicos - 2026-08-09

- Os cálculos de comissão e os dados de recibos em `api/pagamentos.js` agora
  somam `OrigensProdutoProntoCompat` por executor e empresa, além de
  `producoes` e pontos extras.
- O filtro não fica restrito ao tipo histórico TikTik; costureiras autorizadas
  a executar `POS_OP` também entram no cálculo, sem duplicar arremates já
  materializados na origem canônica.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - fila POS_OP usa saldo canonico - 2026-08-09

- `GET /api/producao/fila-de-tarefas` agora calcula lançamentos concluídos
  `POS_OP` a partir de `OrigensProdutoProntoCompat`.
- Perdas continuam sendo somadas da tabela `arremates`, pois ainda não há
  origem genérica de ajuste; a união é agrupada novamente por OP/etapa para
  evitar duplicidade.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - atribuicao POS_OP usa saldo canonico - 2026-08-09

- A validação de atribuição em `api/producoes.js` agora calcula o total já
  concluído pela mesma combinação de origem canônica e perdas legadas usada na
  fila.
- O bloqueio transacional, a validação de etapa e o contrato legado da rota
  permanecem iguais.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - gincanas usam pontos POS_OP canonicos - 2026-08-09

- O cálculo individual e o ranking de gincanas agora leem `POS_OP` pela CTE
  `OrigensProdutoProntoCompat`, mantendo os escopos de processos e arremates.
- A filtragem continua por empresa e executor; a compatibilidade legada é
  resolvida pela própria CTE sem somar duas vezes o mesmo arremate.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - alinhamento dos guards de permissoes no backend - 2026-08-09

- O catalogo passou a incluir `criar-op`, `editar-op` e
  `marcar-como-cortado`, que ainda sao consumidos pelas rotas legadas de OP e
  cortes. Nenhum identificador existente foi renomeado ou removido.
- A API de alertas aceita `configurar-alertas` e preserva
  `gerenciar-permissoes` como alias administrativo. As APIs de tempos padrao
  seguem a mesma regra com `configurar-tempos-padrao`.
- Atribuicao, finalizacao e cancelamento de tarefas, lancamento externo e
  desfazimento externo agora conferem no backend as mesmas permissoes exibidas
  pelo `UIBloqueio`.
- O CTA `Criar OP` do painel de demandas passou a permanecer visivel e abrir
  o bloqueio padrao quando falta `gerar-op`.

## Atualizacao operacional - aliases de backend preservados por contrato - 2026-08-09

- A auditoria confirmou que `sessoes/iniciar`, `sessoes/finalizar` e
  `sessoes/cancelar` legados usam `sessoes_trabalho_arremate`, enquanto o
  canonico usa `sessoes_trabalho_producao`.
- Os tempos legados usam `tempos_padrao_arremate`; o contrato canonico usa
  `tempos_padrao_producao`. O lancamento externo legado grava `arremates`; o
  canonico grava `producoes`. Sem equivalencia transacional direta, esses
  aliases permanecem intactos para compatibilidade.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - entrypoint visual legado removido - 2026-08-09

- Depois que `admin/arremates.html` virou redirecionamento e
  `public/js/admin-arremates.js` foi removido, a auditoria confirmou que
  `public/src/main-arremates.jsx` nao era carregado por nenhum HTML ou entrada
  do build; o entrypoint morto foi removido.
- A URL legada, aliases de API, permissoes e componentes compartilhados ficam
  preservados para compatibilidade. O CSS legado continua sendo usado pelo
  historico compartilhado de Producoes.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - painel legado usando componentes canonicos - 2026-08-09

- O painel principal de `admin/arremates.html` agora monta
  `OPPainelAtividades` e `OPModalTempos`, compartilhando atribuicao, fila,
  finalizacao e configuracao de tempos com Producoes.
- A leitura de status do backend aceita temporariamente
  `acesso-ordens-de-arremates` ou `acesso-ordens-de-producao`; isso preserva
  usuarios legados sem ampliar escopo de empresa.
- A aba de perdas e os endpoints legados permanecem para o proximo gate.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.
- `npm run typecheck`, `npm run build`, `node --check api/producao.js` e
  `git diff --check` passaram; o build manteve apenas os avisos conhecidos.

## Atualizacao operacional - fluxo de perdas na superficie canonica - 2026-08-09

- A aba de perdas de `admin/arremates.html` agora monta
  `OPRegistrarPerdaTela` e usa `/api/producoes/fila-perdas` e
  `/api/producoes/registrar-perda`.
- Os endpoints canonicos passam pelo gate empresarial antes de encaminhar
  temporariamente para a mesma transacao legada, preservando saldo,
  categorias de perda e compatibilidade.
- A implementacao transacional ainda sera extraida de `api/arremates.js` em
  gate posterior; a rota antiga continua ativa.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

- `npm run typecheck`, `npm run build`, `node --check api/producoes.js` e
  `git diff --check` passaram; o build manteve apenas os avisos conhecidos.

## Atualizacao operacional - escritor de perdas compartilhado - 2026-08-09

- `api/utils/registrar-perda-producao.js` agora concentra a transacao de
  perdas; Producoes e o endpoint legado chamam o mesmo utilitario.
- O bloco antigo foi renomeado para `registrar-perda-legado-interno` como
  referencia de rollback, sem ser usado pela interface.
- A fila mantem alias de leitura legado ate a limpeza dos consumidores
  restantes. Nenhuma receita foi alterada, nenhuma migration foi repetida e
  nenhum dado externo foi escrito.
- `npm run typecheck`, `npm run build`, `node --check api/arremates.js`,
  `node --check api/producoes.js`, `node --check api/utils/registrar-perda-producao.js`
  e `git diff --check` passaram.

## Atualizacao operacional - fila de perdas compartilhada - 2026-08-09

- `api/utils/fila-perdas-producao.js` agora concentra a leitura da fila.
- `GET /api/producoes/fila-perdas` e `GET /api/arremates/fila` usam o mesmo
  utilitario, sem encaminhamento entre routers.
- O bloco antigo foi renomeado para `fila-legado-interno` como referencia de
  rollback. Nenhuma receita foi alterada, nenhuma migration foi repetida e
  nenhum dado externo foi escrito.
- `npm run typecheck`, `npm run build`, `node --check api/arremates.js`,
  `node --check api/producoes.js`, `node --check api/utils/fila-perdas-producao.js`
  e `git diff --check` passaram.

## Atualizacao operacional - script legado de Arremates removido - 2026-08-09

- `admin/arremates.html` deixou de carregar `public/js/admin-arremates.js`.
- O painel, a atribuicao, a fila, as perdas, o externo e o historico ja sao
  controlados pelos componentes e rotas canonicos; a URL antiga e os aliases
  de API continuam preservados.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - liberacao antecipada de intervalo - 2026-08-09

- O endpoint `/api/ponto/liberar-intervalo` agora pode abrir e resolver a
  transicao canonica diretamente nos 20 minutos anteriores a S1/S2, que e a
  mesma janela exibida pelo `OPStatusCard`. Isso elimina o conflito causado
  pela espera indevida da reconciliacao no horario programado.
- A liberacao antecipada preserva a saida efetiva do momento da confirmacao,
  calcula o retorno pela duracao configurada do intervalo e registra a origem,
  o supervisor e a idempotencia na transicao/eventos existentes. A jornada
  ordinaria, o fallback automatico de 30 segundos e o isolamento empresarial
  permanecem inalterados.
- Nenhuma migration ou dado externo foi alterado nesta correcao; o ensaio
  deterministico foi acrescentado a `tools/testar-ponto-motor-local.mjs`.

## Atualizacao operacional - retorno manual e janela ordinaria - 2026-08-09

- O endpoint `/api/ponto/retomar-trabalho` e o escritor canonico do retorno
  manual para empregados PRODUZINDO e para empregados ociosos em ALMOCO/PAUSA.
  Nos dois casos E2/E3 e registrado; quando nao existe sessao, o vinculo passa
  a `LIVRE_MANUAL` para ficar disponivel imediatamente.
- O retorno manual e identificado no livro de eventos para impedir que o motor
  crie um retorno automatico duplicado. O desfazimento grava a correcao e
  permite que a transicao automatica volte a valer quando necessario.
- `janela_ordinaria_aberta` representa a faixa continua entre E1 e S3. Almoco e
  pausas sao intervalos internos e nao tornam o empregado fora da jornada;
  dias nao ordinarios continuam sujeitos ao fluxo de hora extra.

## Atualizacao operacional - preservacao do retorno manual na leitura - 2026-08-09

- O safety-net de `api/producao.js` usa `COALESCE` no banco e preserva tambem o
  valor ja carregado em memoria. Ele nao pode devolver E3 programado quando o
  supervisor registrou E3 antecipadamente.
- O escritor legado de finalizacao em `api/producoes.js` tambem preserva E3/E2
  ja existentes. O motor continua sendo a autoridade quando o livro de eventos
  esta disponivel; nenhuma escrita legada pode sobrescrever retorno manual.
- O caso de regressao e: S2=16:00, E3 programado=16:15, retorno manual=16:05;
  apos polling/cron, a leitura e o banco devem continuar exibindo E3=16:05.
- O teste HTTP de ponto tambem cobre o endpoint real `/api/ponto/retomar-trabalho`
  para PAUSA ociosa, valida o horario efetivo retornado e confirma que o cron
  nao duplica `RETORNO_PAUSA_AUTOMATICO`.
- Quando o safety-net escreve um fallback, `/api/producao/status-funcionarios`
  relê `ponto_diario` antes de montar a resposta. Isso fecha a janela de corrida
  entre o polling e uma ação manual do supervisor.

## Validacao local da bateria de ponto - 2026-08-09

- O PostgreSQL local foi disponibilizado em `127.0.0.1:55437` com clones
  descartaveis derivados de `sistema_lv_fase7`; a base original nao foi alterada.
- `tools/testar-ponto-eventos-local.mjs` foi aprovado, cobrindo idempotencia,
  append-only, rollback e concorrencia de abertura/resolucao.
- `tools/testar-ponto-motor-local.mjs` foi aprovado com 25 eventos, incluindo o
  caso S2=16:00, E3=16:15 e retorno manual efetivo=16:05, sem retorno automatico
  duplicado e preservando E3=16:05.
- O teste HTTP aprovou todos os cenarios de jornada/ponto, inclusive o endpoint
  real de retorno manual da PAUSA e o cron sem duplicidade. Ele parou depois na
  atribuicao de producao porque a restauracao antiga nao possui `empresa_id` em
  `produtos`; a cadeia produtiva exige uma restauracao multiempresa mais recente.

## Atualizacao operacional - pagina legada convertida em redirecionamento - 2026-08-09

- `POST /api/producoes/estornar` agora concentra o escritor de estorno em
  `api/utils/estornar-producao.js`; `/api/arremates/estornar` permanece como
  alias compatível sem escritor independente ativo.
- O menu exibe somente `Produções` e aceita temporariamente as permissões
  `acesso-ordens-de-producao` e `acesso-ordens-de-arremates`.
- `public/admin/arremates.html` não renderiza mais a página antiga: preserva a
  URL apenas como redirecionamento para Produções, mantendo query e hash.
- Routers, permissões e componentes legados permanecem preservados até a
  auditoria final dos consumidores. Nenhuma receita foi alterada, nenhuma
  migration foi repetida e nenhum dado externo foi escrito.

## Atualizacao operacional - mapa de permissoes e bloqueio de interface - 2026-08-09

- O inventario completo de guards de pagina, menu, Home, abas, blocos e
  botoes foi registrado em `_planejamento/mapa-permissoes-ui.md`.
- A regra aprovada e manter controles visiveis e aplicar `UIBloqueio`; o
  bloqueio inline continua reservado a botoes `position: absolute` e aos
  arquivos HTML/JS legados que nao podem receber wrapper React.
- Financeiro, Gestao da Producao, Gestao Organizacional, Producoes,
  Historico Geral, Estoque e Arremates tiveram os pontos que escondiam ou
  desabilitavam acoes por falta de permissao alinhados ao popup padrao.
- Os guards das URLs canonica e legada da Gestao Organizacional aceitam os
  aliases existentes; a pagina de Embalagem exige `acesso-embalagem-de-produtos`.
- Os IDs da secao `NAO EXISTEM NO CODIGO` continuam preservados. O ID
  `acesso-permissoes-usuarios` permanece apenas como alias tecnico de auditoria.
- Nenhuma permissao foi renomeada ou excluida, nenhuma migration foi repetida
  e nenhum dado externo foi escrito nesta etapa.
- `npm run typecheck`, `npm run build` e `git diff --check` foram executados
  novamente apos a validacao final desta rodada.
- `node --check` dos arquivos tocados passou. O `typecheck` tambem passou apos a
  restauracao da referencia `permissoes` em `FinanceiroPage.tsx`.

## Atualizacao operacional - bundle antigo sem consumidores removido - 2026-08-09

- A auditoria confirmou que `public/js/admin-arremates.js` não era mais
  referenciado por nenhum HTML ou componente ativo depois do redirecionamento
  de `admin/arremates.html`; o arquivo foi removido.
- A compatibilidade legada continua nos aliases de API, permissões,
  componentes compartilhados e na URL antiga. Nenhuma receita foi alterada,
nenhuma migration foi repetida e nenhum dado externo foi escrito.

## Atualizacao operacional - defaults de perdas canonicos - 2026-08-09

- `ArremateRegistrarPerdaTela`, `ArremateFormularioPerda` e
  `ArremateTelaSelecaoProduto` usam por padrão `/api/producoes/fila-perdas` e
  `/api/producoes/registrar-perda`.
- Os aliases de Arremates continuam disponíveis para compatibilidade; sessões,
  tempos e externo antigos permanecem somente nos componentes órfãos ainda
  preservados para auditoria.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Atualizacao operacional - bloqueio das acoes de configuracao financeira - 2026-08-09

- Os FABs de novo lancamento, transferencia e agendamento permanecem visiveis
  no Financeiro e usam o guard inline de `lancar-transacao`, porque sao
  controles fixos e nao devem receber wrapper que altere o posicionamento.
- As abas de Configuracoes Financeiras permanecem visiveis para consulta; os
  controles de mutacao usam `UIBloqueio` com `gerenciar-contas`,
  `criar-favorecido`, `gerenciar-categorias` e `gerenciar-taxas-vt` conforme
  o tipo da acao.
- Os modais de configuracao repetem o guard no botao Salvar para manter a
  protecao visual mesmo em estado aberto por fluxo antigo ou stale.
- Nenhum ID de permissao foi renomeado ou removido e nenhuma migration foi
  executada nesta etapa.

## Atualizacao operacional - bloqueio da Central de Pagamentos - 2026-08-09

- A Central de Pagamentos mantém as cinco abas visíveis. Cada aba usa o ID de
  pagamento correspondente em `CPAGTabs.tsx` e abre o popup padrão quando o
  vínculo não possui a permissão.
- Os botões de pagamento de comissão, bônus, salário, benefícios e lote de VT
  permanecem renderizados e usam `UIBloqueio` com os mesmos IDs que o backend
  valida em `/api/pagamentos/efetuar` e `/api/pagamentos/lote-vt`.
- Recibos de comissão e recibos de VT também permanecem visíveis, mas seus
  botões de geração, registro e impressão são bloqueados com a permissão do
  respectivo tipo de pagamento. Os endpoints correspondentes receberam a
  mesma validação no backend.
- Ajuste de consumo e definição do saldo do cartão VT repetem
  `ajustar-consumo-vt` na abertura e na confirmação dos modais.
- O estorno de recarga continua usando `efetuar-pagamento-empregado`, porque
  esse é o ID legado já validado pelo endpoint `/estornar-vt`; não foi criado
  nem substituído nenhum identificador.
- Nenhuma permissão foi renomeada ou excluída, nenhuma migration foi
  executada e nenhum dado externo foi escrito nesta etapa.

## Atualizacao operacional - bloqueio do Centro de Incentivos - 2026-08-09

- O Centro de Incentivos mantem a pagina e todas as abas visiveis. Gincanas,
  Metas e Comissoes e Pontos por Atividade continuam consultaveis com
  `acesso-ponto-por-processo`; Pagamentos usa
  `pagar-premiacoes-gincanas` como aba bloqueada, sem disparar consulta quando
  o vinculo nao possui essa permissao.
- `gerenciar-gincanas` continua sendo o ID existente para criar, editar,
  publicar, cancelar e excluir gincanas. Nenhum ID antigo foi renomeado ou
  removido.
- Foram criados tres IDs especificos, todos no catalogo de permissoes:
  `gerenciar-metas-incentivos`, `gerenciar-pontos-atividade` e
  `pagar-premiacoes-gincanas`. Eles protegem respectivamente as mutacoes de
  metas/comissoes, pontos por atividade e pagamentos de premiacoes.
- `UIBloqueio` permanece nos botoes de mutacao em
  `IncenGincanaCard.tsx`, `IncenGincanaModal.tsx`, `IncenMetasTab.tsx`,
  `IncenPontosTab.tsx` e `IncenPagamentosTab.tsx`. O backend repete a mesma
  separacao em `api/metas.js`, `api/configuracao-pontos.js` e
  `api/gincanas-pagamentos.js`.
- Nenhuma migration foi executada e nenhum dado externo foi alterado nesta
  etapa. O mapa detalhado permanece em
  `_planejamento/mapa-permissoes-ui.md`.

## Atualizacao operacional - auditoria do legado de Ponto/Incentivos - 2026-08-09

- A auditoria confirmou que a antiga pagina `ponto-por-processo` e seus
  scripts/CSS administrativos nao existem mais no workspace. As abas Metas e
  Pontos atuais sao atendidas por `main-incentivos.tsx` e componentes TSX.
- O utilitario compartilhado `public/js/utils/metas.js` permanece ativo para
  calculos e leituras; o ID `acesso-ponto-por-processo` foi preservado.
- A referencia morta para `admin-ponto-por-processo.js` foi removida de
  `public/js/main.js`, que tambem nao possui consumidores HTML ativos. Nenhum
  ID de permissao foi removido ou renomeado.

## Atualizacao operacional - leitores de origem canonica ampliados - 2026-08-09

- `api/real-producao.js` passou a usar `OrigensProdutoProntoCompat` na diaria e
  no historico de desempenho, mantendo o fallback legado e o executor
  normalizado para registros antigos.
- `api/dashboard.js` passou a usar a mesma visao em atividades, desempenho,
  resgate minimo, tabela de pontos, ranking, streak e conquistas; os filtros
  empresariais foram mantidos explicitos nas consultas de producao.
- Os indicadores de pontos combinam producoes internas e `POS_OP` canonico
  para qualquer executor autorizado, inclusive costureiras que executem uma
  etapa `POS_OP`.
- `api/produtos.js` usa a origem canonica para calcular saldo pendente de
  produto pronto. Perdas continuam somadas a partir de `arremates` somente
  como ajuste legado, sem duplicar producao canonica.
- O diagnostico agregado de Demandas (`api/utils/diagnosticoProducao.js`) usa
  a mesma origem para progresso e consumo de embalagem, preservando o
  fallback automatico quando a estrutura canonica nao existe.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa. A proxima liberacao exige smoke HTTP local
  com dados canonicos e auditoria final dos leitores legados antes da remocao
  de aliases.

## Atualizacao operacional - erros recuperaveis no painel de Producoes - 2026-08-09

- `OPPainelAtividades` agora trata respostas de erro e respostas 500 sem JSON,
  exibindo a mensagem em popup e em um estado de erro recuperavel com botao
  `Tentar novamente`; o polling nao deixa a tela em estado aparentemente
  travado nem exige F5.
- Finalizacao e cancelamento de tarefas validam `res.ok`, aguardam a
  atualizacao do painel e bloqueiam cliques duplicados enquanto a mesma sessao
  esta em processamento, inclusive durante o popup de confirmacao. A mensagem
  de sucesso so aparece apos a API e a recarga concluirem.
- Ao sair da aba Painel, popups legados montados diretamente no `body` sao
  removidos e respostas tardias nao reabrem um overlay sobre outra aba.
- O aviso de `AudioContext` bloqueado pelo navegador continua sendo tratado
  como aviso nao fatal. Nenhuma receita foi alterada, nenhuma migration foi
  repetida e nenhum dado externo foi escrito nesta etapa.

## Validacao manual do bloqueio de permissoes - 2026-08-09

- O usuario aprovou o smoke autenticado com acesso completo no Centro de
  Incentivos: Home, menu, navegacao, quatro abas, carregamento de dados e
  abertura/fechamento do modal de nova gincana funcionaram sem erros no
  console.
- O usuario tambem validou com acesso restrito: a pagina permaneceu acessivel
  quando permitido, as areas sem permissao continuaram visiveis e os popups de
  bloqueio funcionaram para Gincanas, Metas, Pontos por Atividade e Pagamentos.
- Nenhuma migration ou dado externo foi alterado nesta validacao. O bloco de
  permissao do Centro de Incentivos fica concluido; a proxima frente pode ser
  escolhida pelo usuario.

## Atualizacao operacional - alertas alinhados a sessoes canonicas - 2026-08-09

- O motor de alertas de ociosidade/lentidao dos TikTiks prioriza
  `sessoes_trabalho_producao` e `tempos_padrao_producao`, incluindo
  `FINALIZADA_FORCADA` no historico do dia.
- `sessoes_trabalho_arremate` e `tempos_padrao_arremate` continuam como
  fallback explicito para dados legados; a escolha da sessao valida empregado,
  empresa e status para evitar colisao de IDs entre tabelas.
- A ausencia de uma tabela de tempos opcional em restauracoes antigas nao
  derruba o endpoint de alertas; outros erros continuam sendo reportados.
- Nenhuma receita foi alterada, nenhuma migration foi repetida e nenhum dado
  externo foi escrito nesta etapa.

## Validacao read-only do legado pos-OP - 2026-08-09

- O relatorio executado pelo usuario na Neon encontrou zero
  `sessoes_arremate_ativas`; os escritores antigos continuam bloqueados por
  HTTP 410 e nao ha sessao legada ativa para drenar.
- Foram encontrados 9.730 arremates de producao sem origem canonica e 558 com
  origem canonica. A diferenca representa historico legado preservado; nao
  deve ser backfillada automaticamente nem usada como motivo para apagar a
  tabela `arremates`.
- As oito receitas ainda possuem `etapastiktik` e tambem possuem etapas
  canonicas. O campo legado continua somente como compatibilidade de leitura e
  escrita ate a migracao final dos consumidores; nenhuma receita foi alterada.
- Permanecem sete tempos em `tempos_padrao_arremate`, 766 alocacoes ativas de
  embalagem e 75 movimentos de estoque com origem de embalagem. Esses dados
  bloqueiam a remocao estrutural das tabelas/colunas correspondentes.
- O resultado fecha o gate de desligamento dos escritores, mas nao o gate de
  DROP. O proximo bloco e migrar os leitores/fallbacks restantes e preparar um
  plano de remocao com rollback; qualquer migration destrutiva dependera de
  autorizacao explicita do usuario para execucao na Neon.

## Atualizacao operacional - bloqueios de Embalagem, Alertas e Calendario - 2026-08-09

- Embalagem preserva `acesso-embalagem-de-produtos` para a pagina e usa
  `lancar-embalagem` nos botoes de registrar unidade e montar kit. Os botoes
  permanecem visiveis com `UIBloqueio`, e os handlers validam a permissao antes
  da submissao.
- A Central de Alertas aceita `configurar-alertas` e o alias administrativo
  ativo `gerenciar-permissoes`. As configuracoes de alertas e os avisos popup
  receberam bloqueios visiveis nos controles de gravacao, e as rotas de
  administracao de avisos popup passaram a validar o mesmo conjunto no backend.
- O Calendario aceita `acesso-calendario` e o alias administrativo ativo
  `gerenciar-permissoes`. Criacao, edicao e exclusao mantem os controles
  visiveis com bloqueio para vinculos que nao sejam administrador ou supervisor;
  o backend valida permissao e tipo de vinculo.
- Nenhum ID foi renomeado, removido ou reativado na secao `NAO EXISTEM NO
  CODIGO`; nenhum dado externo foi escrito e nenhuma migration foi executada.

## Atualizacao operacional - fila de perdas usa origem generica - 2026-08-09

- `api/utils/fila-perdas-producao.js` passou a calcular o total produzido por
  OP com `OrigensProdutoProntoCompat`, incluindo a origem canônica e o
  fallback legado sem duplicar o arremate já vinculado.
- Perdas continuam sendo lidas de `arremates` porque possuem metadados de
  ajuste próprios. Sessões POS_OP ativas de `sessoes_trabalho_producao` agora
  também são abatidas quando o schema está disponível; as sessões de
  `sessoes_trabalho_arremate` permanecem como fallback histórico.
- A alteração não modifica receitas, saldos ou migrations. `node --check`,
  `npm run typecheck` e `npm run build` passaram; o build manteve somente os
  avisos conhecidos de scripts sem `type="module"` e chunks grandes.

## Atualizacao operacional - blocos 1, 2 e 3 da limpeza pos-OP - 2026-08-09

- O escritor de perdas canônico passou a calcular o saldo produzido por OP
  com `OrigensProdutoProntoCompat`; perdas continuam em `arremates` apenas
  como ajustes, e sessões de produção ativas continuam sendo abatidas.
- A origem genérica recebeu a auditoria somente leitura
  `auditarOrigensProdutoPronto`. A rota autenticada
  `GET /api/embalagens/origens/auditoria` informa referências inexistentes,
  divergências de quantidade em embalagens de unidade, movimentos sem
  embalagem e saldos inválidos, sem alterar dados.
- O estorno canônico de embalagem agora rejeita uma embalagem de unidade cuja
  soma das alocações ativas não corresponda à quantidade registrada. Kits
  continuam sem essa comparação porque suas alocações representam componentes.
- O histórico geral de Produções passa a expor também `embalagem_id` nos
  eventos de embalagem e estoque, preservando o vínculo rastreável sem remover
  `arremate_id` legado.
- A tipagem da permissão de salvamento da Central de Alertas foi corrigida para
  manter o typecheck global. Nenhuma receita foi alterada, nenhuma migration
  foi repetida e nenhum dado externo foi escrito.

## Atualizacao operacional - permissoes granulares de Calendario e Alertas - 2026-08-09

- Foram adicionados ao catalogo, sem alterar IDs existentes, os IDs
  `criar-novo-evento`, `editar-evento`, `deletar-evento`,
  `salvar-alteracoes-de-alertas`, `criar-novo-aviso`,
  `editar-aviso`, `reaproveitar-aviso`, `excluir-aviso` e `arquivar-aviso`.
- `criar-novo-evento` protege os pontos de entrada de criacao do Calendario;
  o backend exige tambem acesso ao Calendario e vinculo administrador ou
  supervisor. `editar-evento` protege a edicao e `deletar-evento` protege a
  remocao. A leitura do evento e do detalhe do dia nao recebe bloqueio; a
  confirmacao de remocao usa o popup padrao do sistema.
- Na Central de Alertas, o salvamento de Alertas Gerais exige
  `salvar-alteracoes-de-alertas`. Na aba Avisos Popups, criar, editar,
  reaproveitar, arquivar e excluir usam seus IDs granulares; reenviar e
  reativar permanecem com o acesso geral existente.
- UI e APIs validam os novos IDs. A secao `NAO EXISTEM NO CODIGO` permanece
  intacta, sem exclusao ou reativacao de permissoes legadas.

## Correcao de Freelance Costureira no POS_OP - 2026-08-09

- A selecao de P. Externo passou a resolver a receita pela visao canônica
  (`etapasCanonicas`) e pelos fallbacks `etapasTiktik`/`etapastiktik`, usando a
  identidade da etapa (`etapa_id`/`processo_id`) e respeitando `feitoPor`.
  Isso mantém o arremate pós-OP visível para o perfil Freelance Costureira,
  sem alterar nenhuma receita.
- O lançamento externo de uma tarefa `POS_OP` agora usa a mesma validação de
  fase, saldo e executor do fluxo interno. O perfil placeholder
  `prestador_externo` recebe apenas um override transitório do tipo escolhido
  (`costureira` ou `tiktik`), grava sessão POS_OP, pontos, arremate legado e
  origem canônica de produto pronto.
- O payload preserva `fase`, `processo_id`, `etapa_id` e as origens da OP; o
  fluxo OP legado permanece inalterado. Nenhuma migration foi executada ou
  repetida; `node --check`, `npm run typecheck` e `npm run build` passaram.

## Decisao permanente - preservacao fisica do legado - 2026-08-09

O usuario decidiu que, por enquanto, **nenhuma tabela, coluna, endpoint ou
estrutura legada sera removida fisicamente**. Essa decisao vale mesmo com a
migracao funcional da cadeia produtiva concluida.

### O que foi migrado

- OP e arremate foram unificados na experiencia de Producoes, com etapas
  `OP` e `POS_OP`, sessoes operacionais canonicas, fila, saldo, pontos e
  executor autorizado pela receita.
- A origem generica de produto pronto passou a alimentar Embalagem e Estoque,
  mantendo compatibilidade temporaria com `arremates`.
- O historico geral de Producoes passou a reunir OP, POS_OP, perdas,
  cancelamentos, embalagem, estoque e estornos, incluindo a imagem correta da
  variante.
- Leitores transversais de dashboard, comissoes, gincanas, alertas, demandas
  e perdas passaram a priorizar a origem canonica com fallback legado.
- A pagina operacional de Arremates foi substituida por Producoes; a URL
  antiga e aliases de API continuam preservados para compatibilidade.
- O smoke final de POS_OP foi aprovado pelo usuario tanto para empregado
  normal quanto para Freelance Costureira.

### Por que nada sera deletado agora

- Existe historico legado real que nao deve ser apagado nem reescrito; nao foi
  feito backfill automatico das receitas ou dos arremates antigos.
- Ainda existem consumidores, aliases, integracoes e fallbacks de leitura que
  dependem de tabelas e colunas antigas, especialmente para perdas, estornos,
  tempos, sessoes antigas, embalagem e estoque manual.
- Ha alocacoes de embalagem e movimentos de estoque ja existentes que exigem
  rastreabilidade e rollback, alem de registros de arremate sem origem
  canonica que devem permanecer como historico.
- A preservacao permite auditoria, recuperacao e compatibilidade durante a
  transicao, sem risco de quebra por uma remocao destrutiva prematura.

As estruturas legadas permanecem, portanto, como camada de compatibilidade e
historico. Nenhuma nova migration destrutiva, `DROP`, limpeza de dados ou
backfill deve ser criada ou executada sem uma nova decisao explicita do
usuario. A meta atual e estabilidade funcional, testes, revisao seletiva e
publicacao do codigo, nao a remocao fisica do legado.

### Configuracao POS_OP de liberacao automatica — 2026-08-09

- Uma etapa `POS_OP` pode usar `modoExecucao = LIBERACAO_AUTOMATICA` quando o
  produto ja sair pronto da ultima etapa `OP`.
- Essa configuracao mantem o gate `POS_OP`, mas nao cria tarefa, sessao ou
  pontos de funcionario. Ao encerrar a OP, o backend projeta uma origem de
  produto pronto idempotente, com pontos zero, para liberar a embalagem.
- O modo padrao continua sendo `MANUAL`; a regra vale por etapa e pode ser
  usada por qualquer produto. Nenhuma receita existente e alterada
  automaticamente.

### Atividades recentes da dashboard apos a unificacao — 2026-08-09

- A rota `/api/dashboard/atividades` deve unir `producoes` e
  `OrigensProdutoProntoCompat` para qualquer executor autorizado, incluindo
  costureiras e freelancers em `POS_OP`; a filtragem final por `uid` e
  `empresa_id` continua obrigatoria.
- O filtro de dia deve aplicar uma unica conversao de `timestamptz` para
  `America/Sao_Paulo`; a conversao dupla via UTC desloca atividades da noite
  para o dia seguinte e deixa o filtro Hoje vazio.

- No resumo “pontos no periodo”, o arredondamento ocorre somente depois da
  soma: valores individuais como `1,5` continuam com decimal, enquanto um
  total de `4,5` e exibido como `5`.

### Pontuacao individual na Producao detalhada - 2026-08-09

- Ao abrir o card de um empregado em `producao-geral`, a lista
  “Producao detalhada” deve exibir a pontuacao de cada produto sem
  arredondamento para inteiro. A soma agregada pode seguir a regra do resumo,
  mas o valor individual deve preservar decimais como `1,5`.

### Ajuste do catalogo de permissoes da Gestao Organizacional - 2026-08-10

- Os cards de permissoes individuais devem expandir conforme o conteudo, sem
  sobrepor titulos, localizacao ou descricao de cards vizinhos.
- A busca do catalogo normaliza maiusculas, acentos, cedilha, aspas e demais
  sinais, e tambem considera o tipo da permissao (por exemplo, `pagina` e
  `Página`).
- Busca sem resultados usa `UIFeedbackNotFound`, mantendo o retorno visual
  padronizado do sistema.

### Percurso unificado e redesign da atribuicao de Producoes - 2026-08-10

O handoff executável para concluir esta frente em uma única leva está em
`_planejamento/plano-finalizacao-selecao-tarefas-quantidades-producao.md`.
Ele deve ser lido integralmente antes de novas alterações na seleção de tarefas,
percurso unificado ou confirmação de quantidades.

- A unificacao de etapas `OP` e definida como um percurso continuo iniciado na
  etapa que possui saldo. O supervisor escolhe ate qual etapa o mesmo empregado
  executara a mesma quantidade; nenhuma etapa intermediaria pode ser pulada.
- Toda etapa `OP` autorizada ao empregado pode iniciar um percurso. O backend
  reconstrói a sequencia pela receita canonica, valida identidade estavel,
  ordem, executor permitido em todas as etapas, saldo e concorrencia. O JSON do
  navegador nunca e autoridade para a composicao do percurso.
- As etapas da receita continuam obrigatorias para a OP; elas nao recebem flag
  opcional. A flexibilidade esta na atribuicao: na Touca de Cetim, Fechamento e
  Finalizacao podem ser concluidos juntos e Passar Elastico permanecer para
  outra costureira; no Scrunchie Padrao, Passar Elastico pode iniciar um novo
  percurso junto com Finalizacao depois que Fechamento ja foi concluido.
- `Não Usa` representa uma etapa manual executada no mesmo posto, sem uso da
  máquina. Ao calcular troca de máquina para o alerta de percurso unificado,
  transições que envolvam `Não Usa` devem ser ignoradas; trocas físicas entre
  máquinas configuradas, como Reta para Overloque/Interloque na fronha de cetim,
  continuam exigindo confirmação.
- Ao finalizar uma sessao unificada, a quantidade e lancada individualmente em
  cada etapa do percurso, com pontos proprios e distribuicao FIFO entre OPs que
  realmente possuem saldo. Nao e permitido gerar estouro artificial.
- O redesign de Selecionar tarefa e Selecionar quantidade e tablet-first, pois
  tablets representam aproximadamente 80% do uso operacional. Tablet paisagem
  e retrato sao gates primarios; desktop e celular continuam obrigatorios.
- A selecao separa explicitamente Processos da OP e Arremates pos-OP. Nos cards,
  a imagem e o nome da variante recebem destaque; o nome do produto nao aparece
  na selecao; badge da etapa e processo ficam conectados; o efeito no fluxo fica
  evidente; os demais dados operacionais permanecem presentes.
- A confirmacao de quantidade agrupa as tarefas por fase quando o lote for
  misto, preserva todos os dados do card e explicita que a mesma quantidade e
  aplicada a cada etapa do percurso unificado.
- Os novos cards seguem o contrato `card-borda-charme`: o card controla cor,
  borda, raio e sombra; o filho `.card-borda-charme` e apenas o overlay interno
  absoluto, sem classes adicionais de cor.
- O header do modal de atribuição usa uma régua horizontal enxuta com as duas
  partes do fluxo: `Selecionar tarefa` e `Confirmar quantidades`. As duas telas
  exibem `PARTE 1 DE 2`; somente o número da parte atual recebe a bolinha de
  destaque. A etapa oposta fica visualmente ofuscada, com tipografia adaptativa,
  enquanto o perfil da funcionária permanece preservado.
- Na confirmação de quantidade, o percurso unificado fica abaixo da imagem do
  produto, preservando a paleta roxa e usando `pç`/`pçs` conforme o número. O
  painel de controles fica centralizado horizontal e verticalmente na própria
  coluna, independentemente de o card possuir percurso.
- Depois de escolher um fluxo na seleção, o botão manual `Selecionar` recebe o
  estado de atenção `Selecionar agora`, com animação e destaque forte. A tarefa
  nunca é selecionada automaticamente; o supervisor ainda precisa clicar no
  botão.
- O detalhe de percurso unificado fica no painel direito, abaixo dos controles
  de quantidade, e mantém integralmente o título e a explicação do lançamento.
  Os atalhos de quantidade são `+1`, `+5` e `MAX`; `Limpar` fica centralizado e
  apenas esvazia o campo, sem enviar quantidade zero.
- O lançamento externo reutiliza exatamente o `OPAtribuicaoModal` e seus
  componentes canônicos de seleção e confirmação. Para freelance costureira,
  somente tarefas `OP` são permitidas; para freelance TikTik, somente tarefas
  `POS_OP` são permitidas. A restrição é refletida nas abas da interface e
  validada novamente no endpoint externo.

### Ocorrências no fluxo de Embalagem — decisão aprovada em 2026-08-10

- A ferramenta da página de Embalagem se chama `Registrar ocorrência` e não
  reutiliza a perda de Produções/Arremates. Os motivos são
  `QUANTIDADE_DIVERGENTE`, `LANCAMENTO_ERRADO`, `PRODUTO_AVARIADO` e
  `ENVIAR_CONSERTO`.
- Uma ocorrência consome o saldo da origem de produto pronto com lock e
  idempotência, sem excluir ou editar OP, POS_OP, pontos ou comissões. Perdas
  definitivas não criam movimento de estoque porque acontecem antes da
  embalagem.
- O conserto é uma quarentena controlada: a peça sai da fila, pode retornar à
  mesma origem sem gerar nova comissão e, se não for recuperada, pode ser
  convertida em produto avariado. Retornos e conversões são eventos próprios.
- `ocorrencias_embalagem_eventos` é append-only. Todas as ações de negócio da
  ocorrência entram no Histórico geral, que será acessível pelo header de
  Embalagem usando o endpoint canônico de histórico de Produções.
- As três ferramentas adicionais propostas — conferência avançada, origem por
  QR/lote e painel de qualidade — ficam fora deste incremento e não devem ser
  implementadas sem nova aprovação.
- A migration `_planejamento/migration-embalagem-ocorrencias-v1.sql` foi
  ensaiada duas vezes em clone local isolado e executada/validada na Neon em
  2026-08-10. O marcador `embalagem-ocorrencias-v1` foi registrado, as três
  tabelas iniciaram vazias, a FK canônica para `origens_produto_pronto` foi
  criada e o trigger append-only ficou ativo. Nenhum commit foi criado neste
  passo.

## Atualização operacional — primeira fatia do redesign de Estoque — 2026-08-12

- `public/admin/estoque.html` passou a usar o shell padrão `main#root.gs-card`.
  A página principal é montada por `public/src/main-estoque.tsx` e
  `public/src/components/EstoquePage.tsx`, com `UIHeaderPagina`,
  `gs-conteudo-pagina`, busca, filtros, alertas, paginação e cards de saldo.
- A página principal não aceita mais o HTML legado como fonte visual. Os cards
  de produto/variação usam `card-borda-charme` com cor semântica por status.
- `public/js/admin-estoque.js` permanece somente como compatibilidade das
  rotinas secundárias ainda não migradas (separação, fila, inventário,
  movimentação e modais). O contêiner `.estoque-legado` fica oculto na visão
  principal e recebe apenas pontes explícitas para abertura/retorno.
- Nenhuma API, regra de saldo, estrutura de banco ou serviço compartilhado de
  outras páginas foi alterado nesta fatia. `npm run typecheck` e `npm run build`
  foram aprovados localmente; a validação visual autenticada ainda é necessária
  antes de commit, push ou deploy.

### Atualizacao operacional - painel Saude do Estoque - 2026-08-12

- O bloco introdutorio da pagina principal nao e renderizado no novo shell.
- O antigo `estoque-alert-grid` foi substituido visualmente pelo painel
  `estoque-health-section`, com indicadores clicaveis de total, itens em dia,
  estoque baixo e reposicao urgente, alem de uma lista das prioridades.
- Os indicadores reutilizam os saldos e filtros ja carregados pela pagina; nao
  foi criada API nova nem alterada a regra de estoque.

### Atualizacao operacional - conformidade do shell principal de Estoque - 2026-08-12

- O `main#root.gs-card` de Estoque segue diretamente as dimensoes globais, sem
  `max-width` local que altere o alinhamento do card principal.
- `public/css/estoque-page.css` declara o respiro obrigatorio do `body` em
  tablets e os breakpoints padrao de `main.gs-card` em 768px e 480px.
- A grade de itens usa tres cards por linha no desktop e dois no tablet.
- A paginacao da listagem reutiliza `public/js/utils/Paginacao.js` e as classes
  globais `gs-paginacao-container`, `gs-paginacao-btn` e `gs-paginacao-info`.

### Atualizacao operacional - separacao manual por pedidos impressos - 2026-08-12

- A separacao foi redesenhada em `public/src/components/SeparacaoPage.tsx` e
  entra pelo fluxo React/TypeScript da pagina de Estoque; o menu lateral e os
  servicos compartilhados permanecem externos a esta migracao.
- Shopee, Shein e TikTok Shop sao apenas o contexto da sessao. Os pedidos sao
  impressos fora do sistema e nao existe integracao ou calculo de pedidos
  pendentes nesta etapa.
- A busca por SKU, produto ou variacao substitui selects. O operador acumula
  varias unidades do mesmo SKU, revisa a lista, confirma a conferencia fisica e
  registra uma unica baixa em lote.
- `POST /api/estoque/movimento-em-lote` agrega itens repetidos, valida saldo
  novamente dentro da transacao com lock por produto e preserva idempotencia.
  A nova operacao `SAIDA_PEDIDO_TIKTOK_SHOP` segue o mesmo fluxo das demais
  saidas de pedidos.
- O catalogo da separacao e agrupado por produto. A primeira camada exibe um
  card por produto; o operador entra na segunda camada para escolher a
  variacao, com busca por SKU, abertura direta de SKU exato pelo Enter e
  retorno explicito por `Todos os produtos`. Variacoes sem saldo ficam fora da
  lista operacional, mas os lancamentos da sessao continuam preservados.
