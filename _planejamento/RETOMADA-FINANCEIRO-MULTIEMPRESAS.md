# Retomada — Financeiro multiempresas

## Situação em 28/07/2026

O trabalho foi interrompido de forma segura durante a Fase 6, antes de qualquer
commit ou publicação do isolamento do Financeiro.

Não existe ação emergencial pendente. A migration de preparação é compatível
com o código atualmente publicado, e o Financeiro permanece bloqueado para
empresas secundárias.

## Atualização em 29/07/2026

- o teste transacional foi executado integralmente na Neon;
- os sete cenários foram aprovados e o `ROLLBACK` foi confirmado pela ausência
  das empresas temporárias nas auditorias posteriores;
- auditorias estáticas, auditorias somente leitura da Neon, `node --check`,
  typecheck, build e `git diff --check` foram reexecutados e aprovados;
- uma auditoria adicional confirmou as 50 rotas do Financeiro, todas com uso
  explícito de `req.empresaId`;
- as integrações em `pagamentos.js`, `usuarios.js` e
  `gestao-organizacional.js` também apresentaram zero SQL financeiro suspeito;
- o commit seletivo chegou a ser preparado localmente, mas foi desfeito sem
  perda de alterações a pedido do responsável, para permitir testes adicionais;
- nenhum push, deploy, migration de finalização ou liberação da empresa
  secundária foi realizado.

### Publicação e smoke em 29/07/2026

- commit seletivo publicado: `5ef2096`;
- deployment da Vercel concluído com sucesso;
- dashboard, lançamentos, agenda, baixa, configurações, aprovações, histórico,
  notificações, logs e relatórios aprovados na Lojas Variara;
- um lançamento real foi criado com sucesso;
- recargas, saída e nova entrada na página foram aprovadas;
- Neila Confecções permaneceu corretamente bloqueada;
- nenhuma migration de finalização ou liberação foi executada;
- a auditoria pré-finalização encontrou 13 tabelas, zero linhas sem empresa,
  zero divergências nas 18 relações, zero constraints não validadas, zero
  índices inválidos e `multiempresa_pronto = false`.

### Conferência dos SQLs em 29/07/2026

- os seis arquivos SQL da Fase 6 estão novamente disponíveis no workspace;
- os SQLs de preparação, backfill e teste transacional recuperados foram
  conferidos integralmente;
- as validações de preparação e finalização foram executadas em transações
  `READ ONLY` e encerradas com `ROLLBACK`;
- o schema atual contém os 21 constraints legados previstos para remoção, os
  31 constraints empresariais previstos para validação e os 14 índices
  esperados;
- antes da finalização, permanecem os resultados esperados: 13 colunas
  `empresa_id` ainda anuláveis, zero registros sem empresa e a migration de
  finalização ausente;
- nenhum dos seis SQLs libera o Financeiro para empresas secundárias.

### Finalização executada em 29/07/2026

- `migration-financeiro-multiempresas-fase6-finalizacao-neon.sql` foi executada
  integralmente na Neon sem erros;
- a validação posterior retornou `aprovado: true`;
- as 13 colunas `empresa_id` estão obrigatórias;
- não existem linhas sem empresa nem divergências empresariais;
- os 21 constraints legados foram removidos;
- os 31 constraints empresariais estão validados;
- os totais foram preservados em 2.190 lançamentos, R$ 645.727,57, 152
  agendamentos e R$ 100.021,88;
- o Financeiro continuou bloqueado para a Neila após a finalização.

### Liberação controlada preparada

- migration:
  `_planejamento/migration-financeiro-multiempresas-fase6-liberacao-neila.sql`;
- validação:
  `_planejamento/validacao-financeiro-multiempresas-fase6-liberacao-neila.sql`;
- a auditoria pré-liberação confirmou Lojas Variara e Neila Confecções ativas,
  Lojas Variara habilitada, Neila bloqueada e com zero registros financeiros;
- o validador foi testado em `READ ONLY` e retornou o pré-estado esperado, sem
  alterações no banco.

### Liberação controlada executada em 29/07/2026

- a migration de liberação da Neila Confecções foi executada sem erros;
- a validação retornou `aprovado: true`;
- `multiempresa_pronto = true` para o Financeiro;
- Lojas Variara e Neila Confecções estão habilitadas;
- nenhuma outra empresa foi habilitada;
- Neila Confecções iniciou com zero registros financeiros;
- os totais preexistentes permaneceram em 2.190 lançamentos, R$ 645.727,57,
  152 agendamentos e R$ 100.021,88.

### Primeiro ciclo do teste manual

- o Financeiro abriu corretamente na Neila Confecções;
- grupos, categorias, conta bancária e lançamento foram criados com sucesso;
- o agente global de encerramento de OP tentou consultar
  `/api/ordens-de-producao/prontas-para-encerrar` e recebeu o `403` esperado
  para um módulo ainda bloqueado;
- o frontend foi corrigido localmente em
  `public/src/main-agentes-globais.jsx` para não iniciar esse polling em empresa
  secundária;
- typecheck e build foram aprovados.

### Teste manual concluído

- agenda, baixa, configurações, logs, relatórios e demais fluxos solicitados
  foram aprovados;
- os dados permaneceram vinculados às respectivas empresas em todas as trocas;
- o console permaneceu sem erros após a correção do agente global;
- a Fase 6 está funcionalmente concluída;
- a release `1.38.0` deve publicar a correção final e o changelog antes do
  início do redesign dos modais.

### Release 1.38.0 publicada

- commit `919de6d` enviado para `main`;
- deployment de Production concluído pela Vercel com `success`;
- URL do deployment:
  `https://sistema-fp8jd40g4-lojas-variara.vercel.app`;
- página pública carregada e `/api/ping` respondeu `200`;
- falta somente o smoke autenticado final nas duas empresas antes do redesign.

### Fase 6.1 concluída em 29/07/2026

- o novo compositor financeiro foi aprovado em todos os fluxos previstos;
- lançamentos e Agenda reutilizam o mesmo modal, incluindo parcelamento;
- compra detalhada, rateio, transferência, edição e baixa foram aprovados;
- sugestões de histórico, Favorecido/Pagador e descrição automática foram
  ajustadas e aprovadas;
- soft delete de agendamentos, parcelas e lotes foi executado e validado;
- o validador confirmou cinco colunas, três índices e `aprovado: true`;
- histórico e recuperação foram aprovados nas duas empresas;
- exclusões exigem `permite-excluir-agendamentos` e recuperações exigem
  `recuperar-agendamentos-deletados`, ambas usando o bloqueio visual padrão;
- typecheck e build foram aprovados;
- a Fase 6.1 está oficialmente encerrada e aguarda commit/publicação;
- na Fase 7, a dashboard das costureiras será tratada por último para permitir
  seu redesign completo.

### Release 1.39.0 publicada

- commit `9625034` enviado para `main`;
- status da Vercel: `success`;
- descrição do deployment: `Deployment has completed`;
- o push não incluiu os arquivos paralelos do redesign do Menu Lateral nem os
  arquivos iniciais ainda não commitados da Fase 7;
- o smoke autenticado de produção foi aprovado sem erros;
- o Financeiro e a Fase 6.1 estão integralmente encerrados.

## Banco de produção

Executado e aprovado:

1. `migration-financeiro-multiempresas-fase6-preparacao-neon.sql`;
2. `validacao-financeiro-multiempresas-fase6-preparacao.sql`;
3. `backfill-contatos-financeiros-vinculos-fase6.sql`;
4. `teste-isolamento-financeiro-fase6-neon.sql`, com `ROLLBACK`;
5. `migration-financeiro-multiempresas-fase6-finalizacao-neon.sql`;
6. `validacao-financeiro-multiempresas-fase6.sql`, com `ROLLBACK`.

Último retorno do backfill:

```json
{
  "aprovado": true,
  "contatos_invalidos_ou_cruzados": 0,
  "vinculos_elegiveis_sem_contato": 0
}
```

Estado confirmado por auditoria somente leitura:

- 13 tabelas financeiras possuem `empresa_id`;
- nenhuma linha financeira está sem empresa após a preparação;
- constraints compostas e índices empresariais estão presentes;
- Lojas Variara é a empresa financeira legada;
- Neila Confecções está cadastrada, mas ainda não está liberada no Financeiro;
- a migration de finalização foi executada e validada;
- `modulos_sistema.financeiro.multiempresa_pronto` continua falso.

## Código local concluído

### `api/financeiro.js`

- todas as rotas recebem empresa pelo contexto autenticado;
- listagens, detalhes, updates, deletes e restaurações filtram empresa;
- inserts de lançamentos, itens, agenda, lotes, solicitações, notificações e
  logs gravam `empresa_id`;
- conta, categoria, contato e demais relações são validados na empresa ativa;
- transferências entre empresas são bloqueadas;
- aprovações revalidam os snapshots na empresa ativa.

### Integrações

- `api/pagamentos.js` deixou de usar IDs fixos de categorias;
- categorias de pagamento são resolvidas semanticamente por nome e empresa;
- conta, concessionária, vínculo e contato são validados;
- lançamentos e itens de pagamentos gravam `empresa_id`;
- `api/usuarios.js` usa `usuarios_empresas.id_contato_financeiro`;
- `api/gestao-organizacional.js` cria contato financeiro empresarial para
  vínculos ativos e elegíveis a pagamento.

### Ferramentas adicionadas

- `tools/auditar-schema-financeiro.mjs`;
- `tools/auditar-isolamento-financeiro.mjs`;
- `tools/auditar-parametros-sql.mjs`;
- `tools/auditar-categorias-pagamentos.mjs`;
- `tools/auditar-contatos-financeiros-vinculos.mjs`.

## Validações locais aprovadas

- `node --check` nas quatro APIs alteradas;
- auditoria estática com zero SQL financeiro suspeito;
- três consultas dinâmicas de `api/financeiro.js` revisadas manualmente e
  iniciadas por filtro empresarial;
- 151 consultas estáticas sem divergência entre placeholders e parâmetros;
- `npm run typecheck`;
- `npm run build`;
- `git diff --check`.

## Arquivos de banco prontos

- teste transacional, com rollback:
  `_planejamento/teste-isolamento-financeiro-fase6-neon.sql`;
- finalização:
  `_planejamento/migration-financeiro-multiempresas-fase6-finalizacao-neon.sql`;
- validação da finalização:
  `_planejamento/validacao-financeiro-multiempresas-fase6.sql`.

## Ordem obrigatória para retomar

Os itens 1 a 10 foram concluídos. O próximo item é o 11: testar o isolamento
real alternando entre Lojas Variara e Neila Confecções.

1. Não criar commit ainda.
2. Revisar este documento e
   `_planejamento/financeiro-multiempresas-e-redesign-modais.md`.
3. Pedir ao responsável para executar integralmente
   `teste-isolamento-financeiro-fase6-neon.sql`.
4. Confirmar no retorno `aprovado: true`, sete testes aprovados e o `ROLLBACK`
   executado.
5. Reexecutar as auditorias locais, typecheck e build.
6. Executar os testes adicionais solicitados pelo responsável em uma restauração
   segura do banco; o `.env` atual aponta para produção e não deve ser usado para
   testes locais de escrita.
7. Após aprovação explícita do responsável, preparar o commit seletivo e
   publicar primeiro o código compatível com a migration de preparação.
8. Fazer smoke da Lojas Variara em produção.
9. Somente depois do código publicado e estável, executar a migration de
   finalização e sua validação.
10. Criar separadamente a migration de liberação do módulo
   (`multiempresa_pronto` e habilitação controlada para Neila Confecções).
11. Testar isolamento real alternando entre Lojas Variara e Neila Confecções.

## Proibições e cuidados

- não habilitar qualquer empresa além de Lojas Variara e Neila Confecções;
- não fazer commit geral;
- não aceitar `empresa_id` enviado pelo frontend;
- não misturar neste futuro commit ajustes de redesign dos modais;
- preservar alterações locais não relacionadas do usuário.

## Estado do Git

Arquivos rastreados alterados:

- `AGENTS.md`;
- `public/css/menu-lateral.css` (alteração do responsável, fora deste escopo);
- `public/src/components/FinanceiroTransferenciaModal.tsx` (rascunho local do
  redesign, fora do próximo passo).

Ferramentas novas ainda não rastreadas:

- `tools/auditar-finalizacao-financeiro.mjs`;
- `tools/executar-validacao-sql.mjs`.

Componente novo ainda não rastreado:

- `public/src/components/FinanceiroModalShell.tsx` (rascunho local do redesign,
  fora do próximo passo).

Os arquivos de `_planejamento` são ignorados pelo Git, mas permanecem no
workspace local.

---

## Atualização de retomada — Fase 7 iniciada em 29/07/2026

Este documento registra o histórico da Fase 6, que já foi concluída, publicada
e aprovada em produção. A retomada atual não deve seguir a antiga lista acima.

O ponto vigente e detalhado está em:

`_planejamento/fase7-empregados-pagamentos-dashboard.md`

Resumo do estado atual:

- Financeiro e Fase 6.1 aprovados em produção na release `1.39.0`;
- Fase 7 iniciada;
- migration de preparação criada e aprovada somente em restauração local;
- nenhuma migration da Fase 7 foi executada na Neon;
- `api/pagamentos.js` está migrado localmente, com 15 de 15 rotas
  empresarializadas na auditoria estática;
- a revisão do diff e os testes HTTP contra a restauração local foram
  concluídos em 30/07/2026, com 17 cenários aprovados e limpeza integral das
  fixtures;
- os testes encontraram e corrigiram a conversão dos campos monetários do
  vínculo e a alteração parcial de lotes impressos com IDs cruzados;
- a migração coordenada dos escritores e consumidores de ponto e sessões foi
  concluída localmente e aprovada em 15 cenários HTTP autenticados, incluindo
  o bloqueio explícito de produção e arremates na empresa secundária;
- o bloco de metas, banco de pontos, pontos extras, configurações de pontos,
  gincanas e premiações foi implementado e aprovado por 7 cenários HTTP na
  restauração local em 01/08/2026; fixtures e flags temporárias foram
  restauradas no `finally`;
- avisos popup e calendário também foram isolados no código em 01/08/2026,
  com 17 rotas, 22 consultas e 2 cenários HTTP aprovados na restauração local;
- as auditorias estáticas desse bloco aprovaram 28 rotas e 92 consultas, e
  `npm run typecheck`, `npm run build` e `git diff --check` foram aprovados;
- pagamentos, ponto/sessões, incentivos, avisos e calendário estão aprovados
  somente na restauração local; a migration da Fase 7 continua sem execução na
  Neon;
- a dashboard completa das costureiras e a cadeia produtiva permanecem
  bloqueadas para empresas secundárias até as etapas planejadas;
- o limite transitório da dashboard foi coberto por 6 cenários HTTP: a empresa
  legada segue disponível e os endpoints dependentes da cadeia falham fechados
  na empresa secundária, mesmo com flags temporários habilitados;
- dashboard das costureiras permanece obrigatoriamente como a última frente;
- não fazer commit, push, deploy ou alteração em produção sem nova autorização.

## Handoff operacional para o próximo Codex — 01/08/2026

O trabalho atual não deve ser retomado pela lista antiga da Fase 6. O documento
vigente é `_planejamento/fase7-empregados-pagamentos-dashboard.md`.

Situação de entrega:

- Fase 6 e Fase 6.1 continuam aprovadas em produção;
- Fase 7 está aprovada somente na restauração local;
- pagamentos, ponto/sessões, incentivos, avisos, calendário e o limite da
  dashboard foram validados por HTTP local;
- a dashboard legada continua disponível;
- produção e arremates permanecem bloqueados na empresa secundária;
- nenhuma migration, publicação ou commit da Fase 7 foi executado.

Ambiente local validado:

- banco `sistema_lv_fase7` em `127.0.0.1:55437`;
- API em `127.0.0.1:3017`;
- usar `FASE7_POSTGRES_URL` para os executores, sem alterar o `.env` de
  produção e sem registrar a senha local.

Executores aprovados: `testar-pagamentos-fase7.mjs` (17),
`testar-ponto-sessoes-fase7.mjs` (15), `testar-incentivos-fase7.mjs` (7),
`testar-avisos-calendario-fase7.mjs` (2) e `testar-dashboard-fase7.mjs` (6).
As execuções devem ser sequenciais e deixam flags e fixtures restaurados.

Próximo passo: concluir o redesign funcional mobile-first da dashboard legada,
fazer smoke manual e somente depois preparar um commit seletivo. O worktree
tem alterações paralelas do Financeiro/importação de extratos e do Menu; elas
não devem ser revertidas nem incluídas no commit da Fase 7. Os arquivos de
`_planejamento` são ignorados pelo Git e precisarão de `git add -f` no commit
final. Não fazer commit, push, deploy ou migration sem autorização explícita.

## Atualização de escopo — 01/08/2026

O redesign mobile-first da dashboard foi concluído e aprovado. A partir desta
retomada, o objetivo é finalizar 100% da Fase 7; a Fase 8 não será executada
neste ciclo. Produção e arremates continuam protegidos para empresas
secundárias pelo bloqueio `CADEIA_PRODUTIVA_NAO_MIGRADA`.

O próximo marco não é uma nova frente funcional: é o encerramento operacional
da Fase 7, com autorização do usuário para a migration na Neon, validação
controlada, publicação e smoke autenticado final. A migration não deve ser
executada automaticamente.

### Preparação da Fase 7 confirmada na Neon — 01/08/2026

O usuário executou a preparação e o validador retornou `aprovado: true`. A
Neon confirmou as 17 colunas `empresa_id`, zero linhas sem empresa, zero
divergências, 34 FKs `NOT VALID`, 17 uniques de identidade e 5 uniques
empresariais. A preparação está registrada em `sistema_migrations` e os
módulos secundários continuam sem liberação.

Não executar a migration novamente. Os avisos de coluna já existente são
notices de uma reexecução; `preparacao_registrada: true` confirma que a
preparação está aplicada.
