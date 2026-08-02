# Fase 7 — Empregados, pagamentos e dashboard

**Status:** concluída no escopo aprovado — preparação, pagamentos, ponto, sessões e dashboard publicados e aprovados
**Dependência:** Fases 6 e 6.1 concluídas
**Decisão de ordem:** a dashboard das costureiras será a última frente funcional

## Objetivo

Isolar por empresa todos os dados funcionais do vínculo do empregado, ponto,
pagamentos, metas, incentivos e consumidores relacionados. A identidade e o
login permanecem globais em `usuarios`, enquanto os fatos de trabalho pertencem
ao vínculo e à empresa ativa.

## Ordem executável

1. auditoria de rotas, tabelas, constraints e consumidores;
2. desenho aditivo do banco e regras de backfill;
3. vínculo empresarial como autoridade para dados trabalhistas;
4. ponto, intervalos e sessões de trabalho;
5. pagamentos, dias trabalhados, recibos, VT e benefícios;
6. metas, pontos, gincanas, premiações e conquistas;
7. avisos e calendário consumidos pelo empregado;
8. dashboard das costureiras, por último, junto do redesign mobile-first;
9. testes cruzados, liberação controlada e limpeza.

## Resultado da auditoria estática inicial

- `api/pagamentos.js` possui isolamento empresarial apenas nos fluxos
  financeiros migrados na Fase 6; consultas trabalhistas legadas continuam
  dependentes de `usuarios`;
- `api/ponto.js` ainda não possui contexto empresarial sistemático;
- `api/dashboard.js` agrega produção, ponto, pagamentos, metas, pontos e
  calendário sem isolamento integral;
- metas e pontos extras ainda não carregam empresa de forma sistemática;
- gincanas possuem partes empresariais, mas seus consumidores e premiações
  precisam de validação completa;
- produção e arremates são dependências da dashboard, porém sua migração
  estrutural pertence à Fase 8; a Fase 7 deverá usar contratos transitórios
  fechados para empresas secundárias até esses domínios estarem prontos.

## Resultado da auditoria do schema real

Auditoria somente leitura executada na Neon em 29/07/2026, com `ROLLBACK`:

- 20 de 20 tabelas previstas foram localizadas;
- apenas `usuarios_empresas` possui `empresa_id`;
- as outras 19 tabelas ainda não possuem isolamento empresarial;
- não existem constraints ou índices empresariais fora de
  `usuarios_empresas`;
- `producoes` possui aproximadamente 30.605 linhas;
- `sessoes_trabalho_producao` possui aproximadamente 10.460 linhas;
- `arremates` possui aproximadamente 9.220 linhas;
- ponto, pagamentos, recibos, pontos, metas, gincanas, avisos e calendário
  exigirão migration aditiva e backfill;
- produção e arremates não serão migrados antecipadamente nesta fase: seus
  consumidores permanecerão fechados para empresas secundárias até a Fase 8.

O resultado confirma que a primeira entrega não deve alterar a dashboard. O
primeiro bloco será a fundação empresarial das tabelas trabalhistas diretas,
começando por ponto e pagamentos.

## Matriz executiva consolidada

- 8 arquivos de API auditados;
- 65 rotas encontradas;
- somente 3 rotas usam `req.empresaId`;
- 62 rotas ainda não usam diretamente o contexto empresarial;
- `api/ponto.js`: 0 de 6 rotas isoladas;
- `api/pagamentos.js`: 3 de 15 rotas usam o contexto, porém apenas os trechos
  financeiros novos estão integralmente empresariais;
- `api/dashboard.js`: 0 de 9 rotas isoladas;
- metas, pontos extras, gincanas, premiações e avisos ainda não possuem
  isolamento sistemático.

## Fundação empresarial aprovada

Dezessete tabelas receberão `empresa_id` na preparação:

1. `ponto_diario`;
2. `sessoes_trabalho_producao`;
3. `historico_pagamentos_funcionarios`;
4. `registro_dias_trabalhados`;
5. `recibos_conferencia`;
6. `banco_pontos_saldo`;
7. `banco_pontos_log`;
8. `pontos_extras`;
9. `configuracoes_pontos_processos`;
10. `metas_versoes`;
11. `metas_regras`;
12. `gincanas`;
13. `gincanas_premiacoes`;
14. `gincanas_premios_ganhos`;
15. `avisos_popup`;
16. `avisos_popup_visualizacoes`;
17. `calendario_empresa`.

### Autoridades e relações

- `usuarios` permanece identidade global e não recebe `empresa_id`;
- campos de emprego, horários, status e remuneração são lidos e atualizados em
  `usuarios_empresas`;
- fatos por empregado mantêm o ID global da pessoa e adicionam `empresa_id`,
  com FK composta para `(usuario_id, empresa_id)` do vínculo;
- IDs de atores como supervisor, pagador e criador continuam globais para
  auditoria e não exigem que o ator possua vínculo comum;
- filhos carregam `empresa_id` e usam FK composta para o pai;
- uniques de ponto, dias trabalhados, saldo, configuração e visualizações
  passam a incluir a empresa;
- referências a `produtos`, `producoes` e `arremates` só ganharão FK composta na
  Fase 8; até lá, os consumidores correspondentes falham fechados na empresa
  secundária;
- a preparação é aditiva: mantém constraints legados até o código estar
  isolado e validado.

## Auditoria de backfill

A auditoria somente leitura retornou `aprovado: true`:

- todas as linhas com empregado possuem vínculo na Lojas Variara;
- zero contas de pagamento pertencem a outra empresa;
- zero relações entre dias e pagamentos são incompatíveis;
- zero filhos órfãos em metas, gincanas e avisos;
- 3 vínculos divergem dos campos empresariais legados de `usuarios`.

As três divergências não serão corrigidas copiando o legado. O vínculo
empresarial atual é a autoridade, conforme a decisão estrutural da Fase 5.

## Regras obrigatórias

- nenhum dado trabalhista pode ser resolvido apenas por `usuarios.id`;
- desligamento de um vínculo não afeta outro vínculo da mesma identidade;
- inserts e buscas por ID validam `empresa_id`;
- o frontend não fornece a empresa como autoridade;
- backfill inicial atribui dados legados somente à Lojas Variara;
- migrations são aditivas antes de qualquer remoção;
- dashboard da empresa secundária permanece bloqueada até o fim da fase;
- o redesign da dashboard não começa antes da estabilização dos contratos.

## Ponto exato de retomada — 29/07/2026, antes da pausa

### O que já foi concluído

- release `1.39.0` / commit `9625034` do Financeiro foi aprovada pelo usuário em
  produção, sem erros;
- auditoria estática do escopo da Fase 7 foi concluída:
  8 APIs, 65 rotas e 17 tabelas empresariais diretas;
- auditoria de backfill somente leitura foi aprovada na Neon;
- backup pré-Fase 7 criado em
  `_backups/sistema-lv-pre-fase7-20260729-193345.dump`;
- SHA-256 do backup:
  `67F15C425396BBF547748A780FA44E110AF06DE4B477AA63572F3551497F2A8C`;
- o backup foi restaurado em PostgreSQL local 17.10, banco
  `sistema_lv_fase7`, porta `55437`;
- a migration de preparação foi executada **somente na restauração local**;
- o validador local retornou `aprovado: true`, com:
  17 colunas `empresa_id`, zero linhas sem empresa, 34 FKs `NOT VALID`,
  zero divergências e zero índices inválidos;
- a migration e o validador foram auditados estaticamente;
- `node --check api/pagamentos.js` está aprovado;
- `tools/auditar-rotas-fase7.mjs` agora encontra `15/15` rotas de
  `api/pagamentos.js` usando `req.empresaId` e SQL empresarial.

### Arquivos da Fase 7 criados

- `tools/auditar-schema-fase7.mjs`;
- `tools/auditar-rotas-fase7.mjs`;
- `tools/auditar-backfill-fase7.mjs`;
- `tools/auditar-migration-fase7.mjs`;
- `_planejamento/migration-multiempresas-fase7-preparacao.sql`;
- `_planejamento/validacao-multiempresas-fase7-preparacao.sql`;
- este documento.

### Implementação de `api/pagamentos.js`

As 15 rotas foram alteradas para:

- obter `req.empresaId` do contexto validado;
- resolver salário, nível, tipos, VT, elegibilidade e contato financeiro em
  `usuarios_empresas`;
- filtrar leituras, alterações e exclusões por empresa;
- persistir `empresa_id` em histórico, dias trabalhados e recibos;
- validar conta, contato e vínculo na empresa ativa;
- bloquear comissões e recibos baseados em produção para empresas não legadas,
  até a cadeia produtiva ser migrada na Fase 8;
- preservar códigos HTTP de vínculos ausentes ou inelegíveis.

Esse bloco foi concluído localmente em 30/07/2026. Além do isolamento das 15
rotas, os testes HTTP reais encontraram e corrigiram:

- normalização dos campos monetários e percentuais vindos do PostgreSQL, que
  eram strings e faziam o cálculo de salário falhar em `toFixed`;
- atomicidade de `/marcar-lote-impresso`, impedindo alteração parcial quando o
  payload mistura IDs válidos e IDs de outra empresa;
- validação estrutural do array de itens do lote de VT.

O executor reproduzível é `tools/testar-pagamentos-fase7.mjs`. Ele recusa
qualquer banco diferente de `sistema_lv_fase7` em `127.0.0.1:55437`, habilita o
módulo secundário apenas durante o teste, usa fixtures descartáveis e restaura o
estado original no `finally`.

### Validação HTTP concluída em 30/07/2026

A API foi executada na porta `3017`, apontada exclusivamente para a restauração
local na porta `55437`. O teste autenticado retornou `aprovado: true` em 17
cenários:

- histórico isolado nas duas empresas;
- cálculo de salário, passagens e benefícios;
- rejeição de vínculo pertencente a outra empresa;
- comissão fechada na secundária e disponível na cadeia legada;
- registro, leitura, isolamento e remoção de faltas;
- registro, verificação, períodos, dados e isolamento de recibos;
- pagamento salarial com lançamento financeiro;
- lote, histórico, agrupamento e estorno de VT;
- impressão de lote atômica, inclusive no cenário com ID cruzado.

Após o teste:

- todas as fixtures foram removidas;
- `central-pagamentos.multiempresa_pronto` voltou a `false`;
- a habilitação da Neila voltou a `false`;
- não restaram dias ou recibos nas datas futuras usadas pela suíte;
- `node --check`, auditoria das 27 consultas SQL, auditoria das rotas,
  auditoria da migration, `npm run typecheck`, `npm run build` e
  `git diff --check` foram aprovados.

## Linha de base da frente de ponto — 30/07/2026

O auditor `tools/auditar-escritores-ponto-fase7.mjs` foi criado antes de qualquer
alteração funcional dessa frente. Ele encontrou:

- 9 APIs relacionadas ao ponto ou ao estado operacional do vínculo;
- 5 escritores diretos de `ponto_diario` ou
  `sessoes_trabalho_producao`: `cron.js`, `ordens-de-producao.js`, `ponto.js`,
  `producao.js` e `producoes.js`;
- 9 consumidores do estado operacional ainda armazenado em `usuarios`:
  `alertas.js`, `arremates.js`, `cron.js`, `ordens-de-producao.js`, `ponto.js`,
  `producao.js`, `producoes.js`, `real-producao.js` e `usuarios.js`;
- `api/cron.js` não recebe contexto autenticado e precisará resolver
  explicitamente a empresa legada enquanto produção e arremates permanecerem
  bloqueados para empresas secundárias;
- a migration aditiva mantém o unique legado
  `ponto_diario(funcionario_id, data)` junto do novo unique
  `(empresa_id, funcionario_id, data)`. Isso é compatível com o código
  publicado, mas impede que a mesma identidade tenha ponto no mesmo dia em duas
  empresas até a futura migration de finalização remover o unique legado;
- `id_sessao_trabalho_atual` também aponta hoje para sessões de arremate, cuja
  cadeia pertence à Fase 8. A migração deve preservar o bloqueio das empresas
  secundárias e não criar uma falsa disponibilidade dessa cadeia.

Essa linha de base confirma que alterar somente `api/ponto.js` deixaria
escritores sem `empresa_id` e estados operacionais globais. O bloco deverá ser
executado de forma coordenada e testado primeiro na restauração local.

## Ponto e sessões — bloco concluído localmente em 30/07/2026

A migração coordenada foi concluída nos escritores e consumidores operacionais
de:

- `api/ponto.js`;
- `api/producao.js`;
- `api/producoes.js`;
- `api/ordens-de-producao.js`;
- `api/cron.js`;
- `api/alertas.js`;
- `api/arremates.js`;
- `api/real-producao.js`;
- `api/usuarios.js`.

O vínculo em `usuarios_empresas` passou a ser a autoridade para status,
horários e sessão atual. As consultas e mutações de `ponto_diario` e
`sessoes_trabalho_producao` carregam `empresa_id`; o cron resolve explicitamente
a única empresa legada ativa enquanto a cadeia produtiva da Fase 8 permanece
bloqueada para empresas secundárias.

O auditor `tools/auditar-escritores-ponto-fase7.mjs` agora retorna
`aprovado: true`: oito APIs possuem consultas diretas às duas tabelas
operacionais, nenhuma consulta está sem `empresa_id` e não resta acesso SQL aos
campos operacionais globais de `usuarios`.

O executor `tools/testar-ponto-sessoes-fase7.mjs` foi aprovado contra
`sistema_lv_fase7` em `127.0.0.1:55437`, com 15 cenários autenticados:

- cinco leituras reais dos consumidores operacionais;
- alteração manual de status isolada por vínculo;
- rejeição de IDs pertencentes à outra empresa;
- atraso, liberação, retomada e desfazimentos;
- ponto da empresa secundária persistido somente no contexto correto;
- produção e arremates rejeitados na empresa secundária mesmo com os flags
  legados habilitados temporariamente;
- confirmação de que o estado operacional global permaneceu intocado.

As fixtures e habilitações temporárias foram restauradas no `finally`. A suíte
de pagamentos continuou aprovada em 17 cenários, e `node --check`,
`npm run typecheck` e `npm run build` também foram aprovados. Nenhuma migration
da Fase 7 foi executada na Neon.

### Alertas obrigatórios para o próximo Codex

- **não executar** a migration da Fase 7 na Neon sem autorização explícita;
- **não fazer commit, push ou deploy** sem nova autorização do usuário;
- a dashboard das costureiras deve permanecer por último;
- não iniciar ponto isoladamente: `ponto_diario` e
  `sessoes_trabalho_producao` também são escritos por produção, arremates,
  cron, alertas e ordens de produção;
- existem alterações simultâneas do redesign do Menu Lateral no worktree.
  Não editar, reverter nem incluir esses arquivos em commit da Fase 7;
- `AGENTS.md` contém mudanças compartilhadas das duas frentes; qualquer staging
  futuro deverá ser seletivo e revisar esse arquivo manualmente;
- o banco local na porta `55437` pode continuar ativo, mas isso deve ser
  confirmado antes de reutilizá-lo.

## Metas, pontos extras, configurações, gincanas e premiações — isolamento aprovado localmente

Em 01/08/2026, o próximo bloco foi implementado localmente; a preparação
estrutural correspondente foi validada posteriormente na Neon.
As cinco APIs administrativas e de premiações agora usam o contexto validado de
`req.empresaId` em leituras, inserções, updates, deletes, joins por entidade pai
e verificações de permissão:

- `api/metas.js`;
- `api/pontos-extras.js`;
- `api/configuracao-pontos.js`;
- `api/gincanas.js`;
- `api/gincanas-pagamentos.js`.

O `api/dashboard.js` também recebeu isolamento dos consumidores de metas, banco
de pontos, pontos extras, configurações, calendário e pagamentos que já podem
ser contextualizados. As rotas que dependem de `producoes` ou `arremates`
continuam falhando fechadas para empresas não legadas, com o código
`CADEIA_PRODUTIVA_NAO_MIGRADA`. Isso preserva a decisão de deixar a cadeia
produtiva e a dashboard completa para as etapas posteriores.

Também foi corrigido o pagamento em lote de premiações: listas com IDs de mais
de uma empresa são rejeitadas antes de qualquer baixa parcial.

Ferramentas criadas para este bloco:

- `tools/auditar-incentivos-fase7.mjs`, com 28 rotas e 92 consultas estáticas;
- `tools/testar-incentivos-fase7.mjs`, executor HTTP com fixtures descartáveis,
  alternância entre Lojas Variara e Neila e restauração de flags no `finally`.

Validações concluídas no código:

- `node --check` das APIs e do executor;
- auditoria das 28 rotas: `rotas_sem_contexto=0`;
- auditoria de 92 consultas SQL: sem divergências;
- `npm run typecheck` aprovado;
- `npm run build` aprovado;
- `git diff --check` aprovado.

Validação HTTP aprovada em 01/08/2026 na restauração local, com a API isolada
na porta `3017` e o banco `sistema_lv_fase7` na porta `55437`:

- `node tools/testar-incentivos-fase7.mjs`: `aprovado: true`, 7 cenários;
- fixtures, flags de módulos e vínculo temporário exclusivo da Neila removidos
  no `finally`;
- a preparação estrutural foi registrada na Neon, mas o módulo ainda não foi
  liberado para a empresa secundária.

## Avisos popup e calendário — isolamento aprovado localmente

O item 7 também foi implementado em 01/08/2026:

- `api/avisos-popup.js` agora filtra avisos e visualizações por empresa,
  calcula destinatários usando o vínculo ativo, rejeita IDs cruzados e grava
  `empresa_id` nas visualizações; uploads novos usam namespace empresarial e a
  empresa legada preserva a leitura das imagens antigas;
- `api/calendario.js` agora filtra eventos e cálculos por empresa, valida o
  funcionário no vínculo ativo e mantém a autorização de administrador ou
  supervisor baseada no vínculo da empresa ativa;
- `tools/auditar-avisos-calendario-fase7.mjs` audita as 17 rotas do bloco;
- `tools/testar-avisos-calendario-fase7.mjs` cobre isolamento de eventos,
  dias úteis, avisos pendentes, visualizações e mutações cruzadas.

A auditoria estática aprovou as 17 rotas e 22 consultas SQL desse bloco. A
validação HTTP também foi aprovada em 01/08/2026:

- `node tools/testar-avisos-calendario-fase7.mjs`: `aprovado: true`, 2 cenários;
- isolamento de calendário, dias úteis, avisos pendentes e visualizações;
- fixtures e flags de módulos removidos no `finally`;
- a suíte foi executada exclusivamente contra a restauração local.

## Dashboard — limite transitório implementado e redesign local aprovado

Com os contratos da Fase 7 aprovados, a dashboard recebeu o primeiro bloco de
integração segura para empresas secundárias:

- `fetchAPI` agora preserva `status`, `codigo` e detalhes do erro HTTP;
- `main-dashboard.jsx` reconhece `CADEIA_PRODUTIVA_NAO_MIGRADA` antes de renderizar
  qualquer card ou widget dependente de produção;
- `DashCadeiaNaoMigrada.jsx` apresenta um bloqueio mobile-first neutro, sem
  nomes, dados ou referências a outras empresas;
- produção e arremates continuam fechados para empresas secundárias até a Fase 8.

O executor `tools/testar-dashboard-fase7.mjs` foi adicionado e aprovado na
restauração local com 6 cenários autenticados: a dashboard da empresa legada
continua disponível, enquanto `/dashboard/desempenho`, `/dashboard/streak`,
`/dashboard/atividades`, `/producao/meu-status` e
`/arremates/status-tiktiks` falham fechados na empresa secundária mesmo com os
flags dos módulos habilitados temporariamente. Os flags foram restaurados no
`finally` e nenhuma fixture foi criada.

`npm run typecheck`, `npm run build` e `git diff --check` foram aprovados após
essa integração. O redesign funcional completo da dashboard foi concluído e
aprovado localmente, mas ainda não foi publicado.

## Próxima ação

Os blocos de pagamentos, ponto/sessões, incentivos, avisos, calendário e
dashboard possuem isolamento implementado e aprovado localmente. Somente
pagamentos está liberado em produção para a empresa secundária; incentivos,
avisos e calendário continuam bloqueados até uma decisão de liberação. A
dashboard, produção e arremates continuam protegidos na empresa secundária.
Nenhum commit, push, deploy ou migration de produção deve ocorrer sem
autorização explícita.

## Handoff para o próximo Codex — 01/08/2026

### Estado confirmado

Esta frente foi trabalhada somente na restauração local do backup
`_backups/sistema-lv-pre-fase7-20260729-193345.dump`:

- banco local: `sistema_lv_fase7`;
- PostgreSQL local: `127.0.0.1:55437`;
- API local: `http://127.0.0.1:3017/api`;
- a migration de preparação foi executada somente nesse banco local;
- nenhuma migration da Fase 7 foi executada na Neon;
- nenhum commit, push ou deploy foi feito para esta frente.

O processo local pode ser iniciado com `POSTGRES_URL` apontando para o banco
local, sem editar o `.env` de produção. A senha não deve ser registrada em
documentos ou comandos versionados.

### Suítes HTTP aprovadas

Executar sequencialmente, sempre contra a restauração local:

```powershell
$env:FASE7_POSTGRES_URL='postgresql://postgres:<senha-local>@127.0.0.1:55437/sistema_lv_fase7'
node tools/testar-pagamentos-fase7.mjs
node tools/testar-ponto-sessoes-fase7.mjs
node tools/testar-incentivos-fase7.mjs
node tools/testar-avisos-calendario-fase7.mjs
node tools/testar-dashboard-fase7.mjs
```

Resultados aprovados em 01/08/2026:

- pagamentos: 17 cenários;
- ponto/sessões e bloqueio explícito de produção/arremates: 15 cenários;
- metas, pontos extras, configurações, gincanas e premiações: 7 cenários;
- avisos e calendário: 2 cenários;
- limite transitório da dashboard: 6 cenários.

As suítes usam fixtures descartáveis e restauram flags no `finally`. Não
executar duas suítes simultaneamente, pois elas alternam habilitações de
módulos na mesma restauração.

### Validações estáticas aprovadas

```powershell
node tools/auditar-migration-fase7.mjs
node tools/auditar-escritores-ponto-fase7.mjs
node tools/auditar-incentivos-fase7.mjs
node tools/auditar-avisos-calendario-fase7.mjs
npm run typecheck
npm run build
git diff --check
```

Também foram aprovados o validador SQL da preparação, a auditoria de schema,
a auditoria de rotas e a auditoria dos parâmetros SQL. Após os testes, a
restauração local ficou sem fixtures `FASE7_`, sem usuários temporários e com
as habilitações da empresa secundária restauradas.

### Proteções que não podem ser removidas

- produção e arremates continuam bloqueados para empresas secundárias;
- `/api/producao` e `/api/arremates` respondem
  `403 / CADEIA_PRODUTIVA_NAO_MIGRADA` na empresa secundária;
- `/api/dashboard/desempenho`, `/api/dashboard/streak`,
  `/api/dashboard/atividades`, `/api/producao/meu-status` e
  `/api/arremates/status-tiktiks` foram testados com esse bloqueio;
- `DashCadeiaNaoMigrada` deve ser renderizado antes de qualquer card ou widget
  dependente da cadeia legada;
- a dashboard legada continua disponível;
- não habilitar a dashboard completa na secundária como atalho para teste.

### Próxima sequência recomendada

1. Fazer o redesign funcional da dashboard legada, mantendo a prioridade
   mobile-first e sem alterar o bloqueio da empresa secundária.
2. Fazer smoke manual no navegador da dashboard legada e do bloqueio neutro.
3. Revisar novamente o diff completo, separando a frente Fase 7 das mudanças
   paralelas do Financeiro e do Menu.
4. Somente após autorização explícita, preparar o commit seletivo da Fase 7.
5. Só depois da aprovação do commit e da validação final, planejar a execução
   da migration na Neon e a liberação controlada da empresa secundária.

### Arquivos da frente Fase 7

Backend principal: `api/alertas.js`, `api/arremates.js`, `api/avisos-popup.js`,
`api/calendario.js`, `api/configuracao-pontos.js`, `api/cron.js`,
`api/dashboard.js`, `api/gincanas-pagamentos.js`, `api/gincanas.js`,
`api/metas.js`, `api/ordens-de-producao.js`, `api/pagamentos.js`,
`api/ponto.js`, `api/pontos-extras.js`, `api/producao.js`, `api/producoes.js`,
`api/real-producao.js` e `api/usuarios.js`.

Dashboard: `public/js/utils/api-utils.js`, `public/css/dashboard.css`,
`public/src/main-dashboard.jsx` e
`public/src/components/DashCadeiaNaoMigrada.jsx`.

Auditoria e testes: os arquivos `tools/auditar-*-fase7.mjs` e
`tools/testar-*-fase7.mjs` relacionados a pagamentos, ponto, incentivos,
avisos/calendário, schema, migration, rotas e dashboard.

Os arquivos de `_planejamento` são ignorados pelo Git. No commit final, os
planos precisarão ser adicionados seletivamente com `git add -f`.

## Atualização de encerramento da dashboard — 01/08/2026

O redesign funcional da dashboard das costureiras foi concluído e aprovado pelo
usuário. A entrega inclui a experiência mobile-first da tela inicial, menu
lateral responsivo, ranking no menu, projeção de ciclo, foco de meta, atividades
recentes com filtros e paginação padrão, tabela de pontos redesenhada, modal de
status operacional e sneak peek de produção dentro da saudação.

As validações locais finais passaram em `npm run typecheck`, `npm run build`,
`node --check api/producao.js`, `git diff --check` e nas auditorias estáticas
da migration, ponto/sessões, incentivos e avisos/calendário. O smoke visual foi
aprovado pelo usuário no ambiente local.

### Escopo aprovado para o fechamento da Fase 7

A Fase 8 não será executada neste ciclo. A Fase 7 será encerrada com a cadeia
de produção e arremates preservando o bloqueio para empresas secundárias por
`CADEIA_PRODUTIVA_NAO_MIGRADA`. Permanecem como etapas operacionais do
encerramento: autorização da migration de preparação na Neon, validação da
estrutura em produção, liberação controlada dos módulos da Fase 7 e smoke
autenticado final. Nenhuma dessas etapas deve ser executada sem solicitação ou
autorização explícita do usuário.

### Preparação executada e validada na Neon — 01/08/2026

O validador executado pelo usuário retornou `aprovado: true`. O resultado
confirma 17 colunas `empresa_id`, zero linhas sem empresa, zero divergências,
17 constraints de empresa e 17 constraints de relações, além das 17 uniques de
identidade e 5 uniques empresariais. A preparação está registrada em
`sistema_migrations` e nenhum módulo foi liberado para empresas secundárias.

Os avisos de coluna já existente correspondem à reexecução de uma preparação
que já estava aplicada; a confirmação objetiva é
`preparacao_registrada: true`. A migration não deve ser executada novamente.
As colunas ainda anuláveis e as FKs `NOT VALID` são o estado aditivo esperado
da preparação, não uma falha.

## Regra expressa de liberação da dashboard secundária

A dashboard completa de uma empresa secundária não pode ser liberada apenas
marcando o módulo `dashboard` como pronto em `modulos_sistema` e habilitado em
`empresas_modulos`.

Ela depende diretamente da cadeia produtiva para consultar e apresentar pontos,
atividades, desempenho, status ao vivo, ranking e projeções. A liberação
completa exige primeiro a migração multiempresa dos domínios de produção e
arremates, incluindo schema, backfill, APIs, escritores, consumidores e testes
de isolamento. Só depois os módulos de produção, arremates e dashboard podem ser
validados e liberados.

Enquanto a cadeia produtiva não for migrada, `/api/producao` e `/api/arremates`
devem continuar respondendo com `CADEIA_PRODUTIVA_NAO_MIGRADA`, mesmo que flags
de módulo sejam alteradas temporariamente. O componente `DashCadeiaNaoMigrada`
deve permanecer como bloqueio neutro.

Assim, neste ciclo a dashboard está concluída para a empresa legada, mas a
dashboard completa da empresa secundária permanece deliberadamente bloqueada.
Liberá-la integralmente exigiria executar a Fase 8, que está fora do escopo
aprovado.

## Encerramento operacional da Fase 7 — 01/08/2026

A Fase 7 foi encerrada dentro do escopo aprovado. A preparação estrutural foi
executada e validada na Neon; pagamentos, ponto, sessões, incentivos, avisos,
calendário e os contratos de dashboard foram isolados por empresa e aprovados
nas validações previstas. A dashboard da empresa legada recebeu o redesign
mobile-first completo, incluindo menu lateral, ranking, projeção de ciclo,
atividades recentes, tabela de pontos e status operacional.

A publicação final desta frente inclui também a substituição dos spinners do
redesign pelo componente padrão `UICarregando`. O smoke autenticado em produção
foi aprovado pelo usuário. Produção e arremates continuam deliberadamente
bloqueados para empresas secundárias por `CADEIA_PRODUTIVA_NAO_MIGRADA`; sua
migração pertence à Fase 8 e não faz parte deste ciclo.
