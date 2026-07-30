# Redesign do Menu Lateral — React, TypeScript e multiempresas

**Status:** Fases 0–5 concluídas; Fase 6 em homologação visual e QA
**Criado em:** 2026-07-29
**Escopo:** menu compartilhado das páginas administrativas e novo estúdio de
avatar reutilizável na Dashboard dos empregados
**Publicação:** entrega isolada das demais frentes em andamento; commit, push e
deploy serão executados pelo usuário, conforme a regra máxima do repositório

---

## 1. Objetivo

Substituir integralmente o menu lateral legado por uma navegação profissional,
tablet-first, acessível e preparada para o crescimento multiempresas do sistema.

O trabalho inclui:

- migração do menu para React + TypeScript;
- redesign visual e estrutural completo;
- destaque real para a empresa ativa, sem exibir tipo de usuário;
- favoritos de áreas, ordenáveis e persistidos por usuário e empresa;
- changelog em destaque no rodapé, sem a antiga assinatura fixa
  “Lojas Variara”;
- estúdio de avatar compartilhado entre menu administrativo e Dashboard;
- preservação do funcionamento das páginas JavaScript/JSX ainda não migradas;
- preservação do seletor universal de empresa no PC, tablet e celular;
- implantação faseada, com validação antes de remover o menu legado.

O menu deixa de ser uma lista estática de links e passa a ser a fundação global
de navegação do painel administrativo.

## 2. Decisões já aprovadas

- O novo menu será desenvolvido em React + TypeScript.
- Páginas consumidoras ainda em JavaScript ou JSX continuarão funcionando.
- O menu não exibirá tipo, função ou vínculo do usuário, como “Administrador”,
  “Sócio”, “Costureira” ou equivalentes.
- O bloco **Empresa ativa** continuará universal e ganhará maior destaque.
- O nome “Lojas Variara” será removido do rodapé.
- O changelog será promovido a uma ação visível, com versão e novidades não
  lidas.
- O menu terá favoritos de áreas.
- Os favoritos poderão ser reorganizados pelo usuário.
- A interface de avatar será modernizada e reutilizada na Dashboard.
- Busca universal, histórico de áreas recentes e modo compacto não fazem parte
  deste projeto.
- Ações rápidas e abertura de modais de outros domínios pelo menu não fazem
  parte deste projeto.
- A implementação e a publicação serão separadas das alterações paralelas que
  já existem no worktree.

## 3. Viabilidade da migração para TypeScript

### 3.1 Resposta curta

A migração é viável e não exige que as páginas existentes também sejam
TypeScript.

O Vite compila entradas `.js`, `.jsx`, `.ts` e `.tsx` no mesmo build. Cada
página pode continuar montando sua própria árvore React ou executar seu
JavaScript legado enquanto o menu ocupa uma raiz React independente.

### 3.2 Contrato de compatibilidade

O novo entry point será responsável por criar ou reutilizar:

```text
#menu-lateral-container
```

Ele será montado separadamente do `#root` da página. Assim, uma página JSX,
TypeScript ou JavaScript puro não precisa conhecer a implementação interna do
menu.

Durante a migração, o arquivo atual
`public/js/carregar-menu-lateral.js` poderá funcionar como bootstrap de
compatibilidade e importar o novo entry point. Depois que todas as páginas
administrativas estiverem validadas, os HTMLs passarão a importar diretamente
`/src/main-menu-lateral.tsx` e o bootstrap legado será removido.

### 3.3 Contratos que não podem ser quebrados

- `.hamburger-menu` existente nos HTMLs;
- `#menu-lateral-container`;
- comportamento de abertura e fechamento no limite de 1024 px;
- seletor compacto de empresa junto ao hamburger;
- marcação da página ativa;
- recarga após troca de empresa;
- atualização do JWT e do contexto local;
- logout e limpeza de contexto;
- importação dos agentes globais administrativos;
- margens e recuos globais hoje associados ao menu;
- bloqueio fechado de módulos não migrados em empresas secundárias.

### 3.4 Riscos reais

O risco não está na convivência entre JS e TS. Os riscos são:

- alterar o contrato de DOM que o CSS global e os HTMLs esperam;
- duplicar listeners ao manter menu novo e legado ativos simultaneamente;
- importar duas vezes os agentes globais;
- exibir ação ou favorito de módulo indisponível na empresa ativa;
- permitir que CSS do menu escape para o conteúdo da página;
- remover o fallback antes de validar todas as páginas administrativas.

Esses riscos serão tratados com migração por paridade, catálogo tipado, lazy
loading e smoke test por página.

---

## 4. Arquitetura visual do novo menu

### 4.1 Hierarquia

```text
Identidade neutra do sistema
Usuário + avatar + menu de conta
Empresa ativa
Favoritos
Módulos por área
Novidades / versão
Preferências e sair
```

O nome do produto deve ser neutro em relação às empresas. A empresa atual
aparece somente no seletor de contexto.

### 4.2 Usuário

O bloco do usuário mostrará somente:

- avatar;
- nome;
- ação para abrir o estúdio de avatar;
- menu de conta com preferências e sair.

Não mostrará tipos, funções, permissões ou nível hierárquico.

### 4.3 Empresa ativa

O seletor terá:

- logo ou iniciais;
- cor de identificação;
- nome fantasia;
- rótulo explícito **Empresa ativa**;
- indicador visual inequívoco de contexto;
- lista de empresas autorizadas;
- empresa atual marcada;
- mensagem de que a troca recarregará o sistema;
- estado de troca e tratamento de falha;
- retorno do foco ao gatilho após cancelamento.

No tablet e celular, o gatilho compacto continuará próximo ao hamburger. A
empresa nunca será escolhida na tela pública de login.

### 4.4 Favoritos

Os favoritos serão áreas de navegação, não ações executáveis.

Regras:

- favoritar ou desfavoritar pelo próprio item do menu;
- reorganizar por arrastar e soltar;
- oferecer alternativa acessível **Mover para cima** e **Mover para baixo**;
- manter IDs estáveis, sem persistir URLs como autoridade;
- persistir ordem por `usuario_id + empresa_id`;
- mostrar somente itens permitidos e disponíveis na empresa ativa;
- preservar no banco um favorito temporariamente indisponível, sem exibi-lo no
  contexto incompatível;
- estado vazio com orientação curta;
- limite visual inicial de seis itens, com expansão quando necessário.

### 4.5 Módulos

Os links continuarão agrupados por domínio. O catálogo do menu deverá ser
tipado e conter, no mínimo:

- ID estável;
- rótulo;
- ícone;
- URL;
- grupo;
- permissão de página;
- módulo empresarial requerido;
- aliases de compatibilidade de URL.

O frontend controla visibilidade e experiência. O backend continua sendo a
autoridade do contexto empresarial e deve falhar fechado.

### 4.6 Changelog

O rodapé não exibirá nome de empresa.

O changelog será um botão real:

```text
Novidades do sistema
Versão 1.38.0 · 3 novidades
```

O fluxo terá:

- badge de conteúdo não lido;
- resumo da versão atual;
- histórico de versões;
- categorias Novo, Melhoria e Correção quando disponíveis;
- marcação de versão lida por usuário;
- operação por teclado e leitor de tela;
- modal ou bottom sheet conforme o dispositivo.

---

## 5. Estúdio de avatar compartilhado

### 5.1 Situação atual

Existem duas experiências simples:

- modal montado manualmente por `carregar-menu-lateral.js`;
- `DSUploader.jsx`, utilizado no `DashPerfilModal`.

O `DSUploader` já oferece seleção, galeria e variações visuais, mas não entrega
o fluxo completo de edição desejado. O novo projeto não criará uma terceira
experiência concorrente.

### 5.2 Arquitetura proposta

Criar o componente compartilhado:

```text
PerfilAvatarStudio.tsx
```

Ele poderá reutilizar uma versão tipada do `DSUploader` como controle de seleção
de arquivo, mas será a autoridade da experiência de avatar.

Consumidores iniciais:

- bloco de usuário do novo menu;
- `DashPerfilModal`.

### 5.3 Capacidades

- seleção por arquivo;
- arrastar e soltar em dispositivos compatíveis;
- uso da câmera ou galeria em tablet/celular;
- recorte quadrado com máscara circular de prévia;
- zoom;
- reposicionamento;
- rotação;
- correção de orientação;
- prévias em tamanhos pequeno, médio e grande;
- compressão antes do envio;
- progresso de preparação e upload;
- galeria dos três avatares;
- seleção inequívoca do avatar ativo;
- exclusão com confirmação;
- recuperação amigável de erro;
- validação de formato, tamanho e resolução;
- placeholders com iniciais quando não houver foto;
- foco preso no modal, fechamento por `Esc` e labels acessíveis.

### 5.4 Identidade global e multiempresas

Avatar pertence à identidade global em `usuarios`, não ao vínculo empresarial.
Hoje `/api/avatares` está associado ao módulo `gestao-organizacional` em
`api/contexto-empresa.js`. Isso pode bloquear a edição da própria foto em uma
empresa sem esse módulo.

Antes do redesign, a rota deverá ser reclassificada como recurso autenticado de
identidade global, disponível em qualquer empresa válida. Essa mudança não
autoriza acesso a avatares de terceiros e não altera isolamento de entidades
empresariais.

---

## 6. Persistência proposta

Uma migration aditiva criará preferências do menu sem alterar tabelas
empresariais existentes.

Modelo conceitual:

```text
usuarios_menu_preferencias
- usuario_id
- empresa_id
- favoritos
- atualizado_em
```

Regras:

- chave única `usuario_id + empresa_id`;
- arrays armazenam somente IDs conhecidos e sua ordem;
- IDs inválidos são ignorados, não causam falha do menu;
- empresa e usuário são validados pelo backend, nunca aceitos cegamente;
- preferência removida do catálogo pode continuar no JSON, mas não é exibida;
- migration ensaiada em restauração local antes de qualquer autorização de
  produção.

O estado de leitura do changelog é global por usuário e não deve ser duplicado
por empresa. Ele poderá ficar em preferência global separada ou em estrutura
equivalente já existente, após auditoria do banco.

---

## 7. Componentes planejados

Todos ficam diretamente em `public/src/components/`, sem subpastas.

```text
MenuLateral.tsx
MenuUsuario.tsx
MenuEmpresaAtiva.tsx
MenuEmpresaSeletor.tsx
MenuFavoritos.tsx
MenuModulos.tsx
MenuNovidades.tsx
MenuConta.tsx
PerfilAvatarStudio.tsx
```

Outros arquivos:

```text
public/src/main-menu-lateral.tsx
public/src/utils/menu-catalogo.ts
public/src/utils/menu-types.ts
public/src/hooks/useMenuContexto.ts
public/src/hooks/useMenuPreferencias.ts
public/css/menu-lateral.css
api/preferencias-menu.js
```

Os nomes podem ser ajustados durante a implementação, mantendo o prefixo
semântico `Menu*` para navegação e `Perfil*` para o estúdio compartilhado.

---

## 8. Plano de execução por fases

### Fase 0 — Fechar decisões visuais

**Objetivo:** eliminar ambiguidades antes de alterar código.

- aprovar arquitetura visual;
- aprovar comportamento dos favoritos;
- decidir limite visual de favoritos;
- aprovar comportamento do changelog não lido;
- registrar decisões finais neste documento e no `AGENTS.md`.

**Saída:** especificação funcional congelada para o primeiro corte.

### Fase 1 — Fundação e rede de segurança

**Objetivo:** registrar o comportamento atual e preparar compatibilidade.

- mapear todos os HTMLs que carregam o menu;
- mapear seletores globais e dependências de CSS;
- registrar smoke matrix de páginas administrativas;
- conferir permissões e módulos de cada item;
- corrigir a classificação global de `/api/avatares`;
- definir tipos do usuário contextual, empresa e catálogo;
- criar bootstrap React/TS sem alterar o visual;
- garantir importação única dos agentes globais.

**Validação:**

- `npm run typecheck`;
- `npm run build`;
- menu atual funcional em página JS, JSX e TSX;
- troca de empresa nos dois sentidos;
- empresa secundária continua falhando fechada em módulos não migrados.

### Fase 2 — Migração do menu por paridade para React + TypeScript

**Objetivo:** remover manipulação manual de DOM sem acumular redesign e migração
na mesma mudança.

- migrar usuário, logout, links, item ativo e hamburger;
- migrar seletor de empresa;
- migrar changelog existente;
- manter visual equivalente temporariamente;
- eliminar listeners e HTML injetado do legado;
- trocar progressivamente os HTMLs para `main-menu-lateral.tsx`;
- remover `public/admin/menu-lateral.html`;
- remover o loader legado somente após smoke completo.

**Gate:** nenhuma alteração visual estrutural avança com regressão funcional.

### Fase 3 — Redesign visual e multiempresas

**Objetivo:** aplicar a nova hierarquia.

- identidade neutra do sistema;
- novo bloco de usuário sem tipo;
- novo cartão de empresa ativa;
- drawer tablet-first;
- grupos de módulos;
- novo rodapé com changelog em destaque;
- estados de carregamento, vazio, erro e troca;
- foco, teclado, leitores de tela e touch targets.

### Fase 4 — Estúdio de avatar

**Objetivo:** substituir as duas experiências simples pela solução compartilhada.

- criar `PerfilAvatarStudio.tsx`;
- tipar/evoluir o seletor de arquivos;
- recorte, zoom, rotação e previews;
- compressão e progresso;
- integrar no menu;
- integrar no `DashPerfilModal`;
- remover modal de avatar legado;
- validar identidade global nas duas empresas.

### Fase 5 — Favoritos persistentes

**Objetivo:** personalização por usuário e empresa.

- migration aditiva;
- API autenticada de preferências;
- catálogo estável de áreas;
- favoritar/desfavoritar;
- reordenação por toque, mouse e teclado;
- estados incompatíveis com empresa/módulo;
- sincronização entre sessões e dispositivos.

### Fase 6 — Limpeza, QA e entrega isolada

- remover código e CSS mortos do menu antigo;
- revisar bundle e lazy chunks;
- validar todas as páginas administrativas;
- validar Dashboard com o estúdio de avatar;
- `npm run typecheck`;
- `npm run build`;
- smoke autenticado das duas empresas;
- revisão seletiva do diff;
- preparar lista exata de arquivos para o commit isolado;
- entregar ao usuário as instruções de commit, push e deploy.

---

## 9. Matriz mínima de validação

| Cenário | Validação |
|---|---|
| Página JavaScript legado | menu monta e página continua funcionando |
| Página React JSX | raízes independentes sem conflito |
| Página React TSX | typecheck e runtime aprovados |
| PC | menu fixo e seletor completo |
| Tablet | drawer, seletor compacto e toque |
| Celular | drawer sem overflow e modal/bottom sheet |
| Empresa principal | todos os módulos autorizados |
| Empresa secundária | somente módulos liberados |
| Troca de empresa | novo JWT, recarga e preferências corretas |
| Sem avatar | iniciais e upload |
| Três avatares | limite e substituição claros |
| Teclado | ordem de foco, Escape e reordenação |
| Leitor de tela | nomes, estados e diálogo anunciados |
---

## 10. Fora de escopo

- busca universal;
- histórico de páginas recentes;
- modo compacto do menu;
- ações rápidas;
- abertura de modais de outras páginas pelo menu;
- exibição de tipo/função do usuário;
- migração para TypeScript das páginas consumidoras;
- liberação de módulos de negócio ainda não migrados para empresas secundárias;
- commit, push ou deploy executados pelo Codex.

---

## 11. Próxima decisão

O mockup foi aprovado integralmente e as Fases 1–5 foram implementadas em
29/07/2026. A Fase 6 está em execução com testes e ajustes conduzidos pelo
usuário. O corte local inclui:

- menu compartilhado em React + TypeScript nos 16 HTMLs administrativos;
- remoção do HTML e do carregador legado;
- catálogo tipado, visibilidade por permissão e módulo empresarial;
- seletor multiempresa responsivo;
- favoritos ordenáveis e API de persistência;
- fallback local por usuário e empresa enquanto a migration ainda não estiver
  aplicada;
- changelog em destaque com leitura por usuário;
- `PerfilAvatarStudio.tsx` compartilhado pelo menu e pela Dashboard;
- API de avatar baseada na identidade global autenticada;
- migration aditiva
  `_planejamento/migration-menu-lateral-preferencias.sql`;
- `npm run typecheck` e `npm run build` aprovados;
- smoke visual isolado aprovado em 1440×900, 820×1180 e 390×844.

Antes da publicação ainda é obrigatório:

1. concluir a rodada atual de feedback visual do usuário;
2. ensaiar e autorizar a migration em restauração local;
3. executar a migration no ambiente autorizado;
4. realizar smoke autenticado com Lojas Variara e Neila Confecções;
5. validar upload/ativação/exclusão de avatar com o Blob real;
6. revisar e selecionar apenas os arquivos desta frente para o commit do usuário.

---

## 12. Extensão aprovada — transições do sistema

**Aprovada em:** 2026-07-29

Antes do fechamento da Fase 6, foram incorporadas duas experiências globais:

### 12.1 Troca de empresa

- overlay integral iniciado imediatamente após a escolha da nova empresa;
- representação exclusiva da origem e do destino, independente da quantidade
  total de empresas disponíveis;
- linha costurada conectando os dois contextos;
- mensagens distintas para processamento, recarga e ambiente pronto;
- persistência mínima em `sessionStorage` para concluir a animação depois do
  reload;
- remoção do estado persistido na conclusão ou em qualquer falha;
- progresso indeterminado, sem porcentagem artificial;
- suporte a tablet, celular, leitores de tela e movimento reduzido.

### 12.2 Carregamento universal

- reformulação visual do `UICarregando` como um núcleo operacional com órbitas,
  nós e indicadores sequenciais;
- iniciais e cor de identificação obtidas do contexto local da empresa ativa,
  com contraste automático e fallback neutro `LV`;
- preservação integral das props `variante`, `tamanho` e `texto`;
- variante `pagina` imersiva com mensagem padrão;
- variante `bloco` transparente e compatível com cards, abas e modais;
- variante `inline` reduzida a três pontos costurados;
- implementação vetorial em SVG e CSS, sem dependência de imagem remota;
- composição visível desde o primeiro frame, com varredura imediata e ciclo
  curto, adequada aos carregamentos comuns de aproximadamente dois segundos;
- `prefers-reduced-motion` obrigatório.

Essas experiências compartilham a metáfora visual da costura, mas não o mesmo
comportamento: a transição empresarial comunica mudança de contexto; o
`UICarregando` comunica preparação de dados e montagem da interface.

---

## 13. Fechamento da release 1.40.0

**Estado em 29/07/2026:** implementação concluída e aprovada pelo usuário.

- menu lateral React + TypeScript aprovado;
- favoritos, changelog, multiempresas e estúdio de avatar aprovados;
- transição entre empresas aprovada;
- `UICarregando` final aprovado como núcleo operacional contextual, usando
  iniciais e cor da empresa ativa;
- versão administrativa preparada como `1.40.0`;
- versão da Dashboard preparada como `1.27.0`;
- `npm run typecheck`, `npm run build` e `git diff --check` aprovados;
- publicação deve excluir `api/pagamentos.js` e os auditores
  `tools/auditar-*-fase7.mjs`, pertencentes à frente paralela da Fase 7;
- commit, push e confirmação do deploy permanecem sob execução pessoal do
  usuário conforme a regra máxima do repositório.
