# AGENTS.md — Sistema LV

Este arquivo é lido automaticamente pelo Codex ao iniciar. Contém o contexto permanente do projeto: stack, arquitetura, padrões e regras de negócio. **Sempre atualize este arquivo quando uma nova decisão importante for tomada.**

---

## Visão Geral do Projeto

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
G1–G12 fica registrado em `_planejamento/sistema-multiempresas.md` e
`_planejamento/plano-op-reorganizacao-ponto-jornada-e-redesign.md`.
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
- Métricas de membros e gestores por empresa devem excluir usuários com
  `is_test = true` ou `arquivado = true`, usando a mesma população da listagem.
- Na Gestão Organizacional, a edição de identidade global e vínculo empresarial
  ocorre pelo único botão Editar vínculo e deve ser transacional no backend.
- O staging foi abandonado. Mudanças de banco devem ser ensaiadas em uma restauração local validada do backup e só podem seguir diretamente para produção após autorização explícita.
- O contexto empresarial do backend fica centralizado em `api/contexto-empresa.js`. Tokens legados sem `empresa_id` resolvem temporariamente o vínculo principal; rotas não mapeadas falham fechadas para empresas secundárias.
- Alterações multiempresa devem ser publicadas em commits seletivos, com revisão
  do diff e validação antes do push. O procedimento fica em
  `_planejamento/multiempresas-controle-de-arquivos.md`.

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
- O plano executável dessa frente fica em
  `_planejamento/plano-op-reorganizacao-ponto-jornada-e-redesign.md`.
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

| Embalagem de Produtos | `embalagem-de-produtos.css` | ❓ | ❓ | ❌ | ❌ | ❓ | Verificar migração React |

| Estoque | `estoque.css` | ❓ | ❓ | ❌ | ❌ | ❓ | Verificar migração React |

| Financeiro | `financeiro.css` | ✅ | ✅ | ✅ | ✅ | ✅ | Migração React+TS **encerrada** (2026-07-27). Árvore única (`main-financeiro.tsx` + `FinanceiroPage` + `FinanceiroContext`), sem multi-root/bridges/legado. Troca empresarial sem reload concluída na `1.40.3`: atualiza token/contexto no mesmo documento, remonta apenas o `FinanceiroProvider` e mantém a transição até `lv:financeiro-pronto`. CSS limpo. Typecheck/build OK; validação manual das abas OK. **Novas features liberadas.** Plano: `_planejamento/migrando-financeiro-para-typescript.md`. |

| Gerenciar Permissões | `permissoes-usuarios.css` | ✅ | ❌ | ✅ | ✅ | ❓ | Concluída 2026-05-23. Duas abas: Permissões + Auditoria. Prefixo `Permissoes*`. Editor: lista plana com search bar (substituiu acordeão) — filtra permissões em tempo real; exclui ex-membros e prestadores da lista de usuários. Auditoria: paginação clássica 12/pág com `gs-paginacao-*`; dropdown de usuários busca tabela `usuarios` (não só audit_log). Infraestrutura: `api/audit.js` + `api/audit-log.js` + tabela `audit_log`. JS legado `admin-permissoes-usuarios.js` deletado. |

| Gestão Organizacional | `gestao-organizacional.css` | ✅ | ✅ | ✅ | ✅ | ❓ | Fase 5 concluída e aprovada em produção em 2026-07-28. Prefixo `GO*`. Migrado para TypeScript em 02/08/2026 (`main-gestao-organizacional.tsx` + árvore `GO*`/`GestaoOrganizacionalPage` + `go-types.ts`). Typecheck ok. Identidade e vínculo editados juntos, múltiplas empresas, encerramento contextual, cópia opcional de permissões e URL antiga compatível. |

| Home / Admin | `home.css` | ✅ | ✅ | ❌ | ❌ | ❓ | Migrada para TypeScript em 02/08/2026 (`main-home.tsx` + `HOMEHeader` / `HOMENews` / `HOMEQuickActions` + `home-types.ts`). Typecheck ok. `AlertasFAB` permanece em JSX. |

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

## Identidade Visual — Borda-Charme

A **borda-charme** é um dos elementos visuais mais marcantes e consistentes do sistema. É uma barra vertical de **6px de largura** posicionada na lateral esquerda de todos os cards de produto e popups. Ela muda de cor para indicar o status ou contexto do item.

### Implementação obrigatória

**JSX — sempre um `<div>` vazio com a classe global:**

```jsx
<div className="meu-card">
    <div className="card-borda-charme"></div>
    {/* restante do conteúdo */}
</div>
```

**CSS — o posicionamento completo deve ser declarado no contexto do card pai, dentro do CSS da página:**

```css
/* O card pai precisa de position:relative e overflow:hidden */
.meu-card {
    position: relative;
    overflow: hidden;       /* essencial: garante que as bordas arredondadas funcionem */
    border-radius: 10px;    /* o valor pode variar, mas deve existir */
}

/* Declaração completa da borda-charme no contexto do card.
   ATENÇÃO: .card-borda-charme NÃO tem definição global de posicionamento —
   cada página/contexto precisa declarar os estilos de posicionamento e tamanho.
   Copie sempre este bloco completo ao criar um novo card. */
.meu-card .card-borda-charme {
    position: absolute;
    left: 0;
    top: 0;
    width: 6px;
    height: 100%;
    background-color: var(--cor-padrao);
    border-radius: 10px 0 0 10px; /* DEVE acompanhar o border-radius do card pai */
}

/* Variações de cor por status/modificador no pai */
.meu-card.status-a .card-borda-charme { background-color: var(--cor-a); }
.meu-card.status-b .card-borda-charme { background-color: var(--cor-b); }
```

### Regras críticas

1. **`border-radius` da borda-charme deve ser igual ao do card pai** — se o card tem `border-radius: 10px`, a borda-charme usa `border-radius: 10px 0 0 10px`. Se o card tem `8px`, usa `8px 0 0 8px`. Sem isso os cantos superiores e inferiores esquerdos ficam quadrados.

2. **O card pai obrigatoriamente precisa de `overflow: hidden`** — sem isso a borda-charme pode vazar para fora dos cantos arredondados em alguns browsers (especialmente Safari/iOS).

3. **Nunca colocar a cor diretamente na classe global** — a cor sempre vai no contexto do pai (`.meu-card .card-borda-charme { background-color: ... }`), nunca em `.card-borda-charme { background-color: ... }` sozinha.

4. **Nunca implementar variações de cor via classe na própria borda** (ex: `.card-borda-charme.status-x`) — use sempre o modificador no elemento pai e descenda o seletor.

5. **`card-borda-charme` é o nome padrão e único** — não criar outras classes de borda charme (ex: `.minha-borda`, `.borda-esquerda`). Padronização é o ponto.

6. **Todo novo card deve incluir a borda-charme** — não é opcional. Faz parte da identidade visual estabelecida.

### Exemplo real — Estoque de Cortes (`op-corte-item`)

```css
.op-corte-item {
    position: relative;
    overflow: hidden;
    border-radius: 10px;
}

.op-corte-item .card-borda-charme {
    position: absolute;
    left: 0;
    top: 0;
    width: 6px;
    height: 100%;
    background-color: #22c55e;      /* verde: disponível */
    border-radius: 10px 0 0 10px;   /* acompanha os 10px do card */
}

.op-corte-item--com-demanda .card-borda-charme { background-color: #3b82f6; } /* azul */
.op-corte-item--urgente     .card-borda-charme { background-color: #f97316; } /* laranja */
```

> **Atenção a cards legados:** cards mais antigos do sistema (como `oa-card-arremate-react`) usam `border-radius: var(--gs-raio-borda-card)` no pai e `border-radius: 8px 0 0 8px` na borda-charme. Estão funcionando, mas não precisam ser corrigidos agora. **Ao criar ou refatorar qualquer card, aplique o padrão acima com o `border-radius` alinhado.**

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
O `global-style.css` define `body { visibility: hidden }` e `body.autenticado { visibility: visible }`. Páginas sem ele ficam com o body visível mas **sem os estilos dos agentes globais** (FAB + modal sem formatação). Todas as páginas `/admin/*.html` devem incluir `global-style.css` antes dos outros CSS. Páginas que estavam sem e foram corrigidas: `gerenciar-producao.html`, `permissoes-usuarios.html`, `ponto-por-processo.html`, `cadastrar-produto.html`.

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
| `GET /api/gincanas-pagamentos/fila` | `gerenciar-gincanas` | Prêmios pendentes (semana atual + atrasados) |
| `GET /api/gincanas-pagamentos/historico` | `gerenciar-gincanas` | Prêmios pagos (últimos 200) |
| `POST /api/gincanas-pagamentos/pagar-lote` | `gerenciar-gincanas` | Paga todos os pendentes (ou IDs específicos) |
| `POST /api/gincanas-pagamentos/:id/pagar` | `gerenciar-gincanas` | Paga prêmio individual |
| `GET /api/gincanas-pagamentos/meus-premios` | JWT válido | Prêmios da funcionária logada (para a wallet) |

### Componentes admin (prefixo `Incen*`)

| Componente | Descrição |
|---|---|
| `IncenGincanasTab` | Aba de gincanas com sub-filtros (Ao Vivo / Próximas / Rascunhos / Arquivo) |
| `IncenGincanaCard` | Card com badges de fase, tipo (🏁 CORRIDA / 👥 EQUIPE), borda-charme por fase |
| `IncenGincanaModal` | **Wizard 3 passos:** O Básico → As Regras → O Prêmio |
| `IncenGincanaRankingModal` | Ranking completo com suporte a corrida/equipe/produto_especifico + coluna 💰 de pagamento |
| `IncenPagamentosTab` | Fila de pagamento semanal + botão "Pagar todos" + histórico |
| `IncenMetasTab` | **Stub** — migração pendente do JS legado |
| `IncenPontosTab` | **Stub** — migração pendente do JS legado |

**Atenção no card:** `gincana.status` controla botões de ação. `gincana.fase` é só visual. Rascunho com datetime passado ainda mostra "Publicar" — correto por design.

### Componentes dashboard (prefixo `Dash*`)

- `DashGincanaCard` — lista de cards de gincanas para a funcionária. Suporta todos os tipos: proxima (countdown), ao_vivo (barra progresso), encerrada (resultado). Lida com corrida (vencedor/sem ganhador), equipe (progresso coletivo), produto_especifico (unidades). Mostra `InfoPagamento` quando prêmio foi registrado.
- `DashPagamentosModal` — **dois bolsos separados:** aba "Comissões" (fonte: `banco_pontos_log`) e aba "Premiações" (fonte: `gincanas_premios_ganhos` via `/meus-premios`).

### Página admin

- **HTML:** `public/admin/incentivos.html`
- **Entry point:** `public/src/main-incentivos.jsx` — 4 abas: Gincanas / Metas / Pontos / Pagamentos
- **CSS:** `public/css/incentivos.css`

### Arquivos legados (aguardam migração das abas Metas e Pontos)

- `public/admin/ponto-por-processo.html`
- `public/js/admin-ponto-por-processo.js`
- `public/css/ponto-por-processo.css`

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
| `HOMEQuickActions.tsx` | Atalhos filtrados por permissão |
| `utils/home-types.ts` | Usuário, auth e ações rápidas |
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
- O status do painel de OP tambem informa o tipo do dia e se a janela ordinaria
  esta aberta. Falta, saida antecipada e atraso sao bloqueados na interface em
  DSR, folga, trabalho extra ou fora da janela; hora extra usa somente tarefas.
  Alocar em outro setor e rejeitado pelo backend quando ha tarefa produtiva em
  andamento, evitando confirmacao sem efeito. O bloco de acoes usa duas colunas
  e o modal de Jornada chega a 620px em tablets.
- No desktop, o modal de Jornada e seus sheets ficam centralizados na area util
  apos o menu lateral fixo de 296px; em tablet e celular continuam centralizados
  na viewport.
- Os cards de Fora de operacao usam duas colunas flexiveis em tablet e desktop,
  e uma coluna em telas pequenas.
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
