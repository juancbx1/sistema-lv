# AGENTS.md — Sistema LV

Este arquivo é lido automaticamente pelo Codex ao iniciar. Contém o contexto permanente do projeto: stack, arquitetura, padrões e regras de negócio. **Sempre atualize este arquivo quando uma nova decisão importante for tomada.**

---

## Visão Geral do Projeto

Sistema web interno de gestão industrial para uma confecção. Controla o ciclo completo de produção: Ordens de Produção (OPs), cortes, produção por etapas, arremates, embalagem, estoque, financeiro, pagamentos de funcionários e dashboard de desempenho.

---

## Projeto Multiempresas — decisão estrutural aprovada

O sistema está em transição planejada de empresa única para **multiempresas**. O documento mestre e checklist de execução ficam em:

`_planejamento/sistema-multiempresas.md`

**Estado atual:** Fases 6 e 6.1 concluídas; Fase 7 em encerramento operacional.
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
redesign completo da dashboard foi aprovado localmente, e a preparação da Fase 7
foi registrada na Neon com `aprovado: true`; publicação e smoke autenticado
final ainda estão pendentes.

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
- O plano executável da Fase 6, incluindo isolamento do Financeiro e redesign
  dos modais, fica em
  `_planejamento/financeiro-multiempresas-e-redesign-modais.md`.
- O redesign dos modais foi executado como **Fase 6.1**, antes da Fase 7,
  conforme `_planejamento/financeiro-fase-6.1-redesign-modais.md`. O novo
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
| Fase 7 — Empregados, dashboard e pagamentos | Dashboard concluída localmente; preparação estrutural executada e validada na Neon; publicação e smoke final pendentes |
| Fase 8 em diante | Não iniciada |

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

Cada página admin tem um `.html` em `public/admin/` que importa um `main-*.jsx` como módulo. O `.jsx` monta o componente raiz via `ReactDOM.createRoot`. Exemplo: `public/admin/ordens-de-producao.html` → `public/src/main-op.jsx`.

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

**Onde está hoje:** `ordens-de-producao.css` e `arremates.css`.  
**Ao criar ou migrar uma página nova** para `gs-card`, adicione isso no CSS da página. Está faltando em: `calendario.css`, `central-de-pagamentos.css`, `usuarios-cadastrados.css`, `home.css`, e outras páginas ainda não migradas.

---

## Fluxo de Trabalho por Área/Página

O desenvolvimento é organizado por **áreas** (cada área = uma página do sistema). Ao iniciar trabalho em uma área, o checklist obrigatório é:

1. **Migração React:** a página está 100% em React? Se não, migrar primeiro.
2. **⚠️ Checar double gs-card (bug recorrente de migração):** ao migrar uma página, o HTML antigo frequentemente tinha um `<div class="gs-card">` como root do componente React. Com a nova estrutura, o `<main id="root" class="gs-card">` já está no HTML — o componente raiz React **nunca** deve ter `<div className="gs-card">` como wrapper externo, apenas `<>` (Fragment). Verificar logo após criar o entry point. Ver seção "Anti-padrão crítico" abaixo.
3. **Limpeza de CSS:** fazer uma passagem no arquivo `.css` da área, removendo classes mortas, regras duplicadas e estilos de código legado que não são mais referenciados — **sem quebrar nada**. Consultar a tabela de status abaixo antes de fazer qualquer limpeza — se já estiver marcada como "limpo", não tocar.
4. **Feature:** só então implementar a nova funcionalidade.

---

## Estrutura Visual Padrão de Páginas

**Regra absoluta:** toda página nova ou refatorada deve seguir esta estrutura. A página de **Ordens de Produção** é a referência visual do sistema — todas as outras devem se parecer com ela, mudando apenas o conteúdo. **Não há exceções.**

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
    <nav className="gs-tab-nav">...</nav>

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
4. `op-card-estilizado` em `ordens-de-producao.css` é alias legado de `gs-card`. Novas páginas usam `gs-card` direto.
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

| Ordens de Produção | `ordens-de-producao.css` | ✅ | ❌ | ✅ | ✅ (via alias) | ❓ | Referência de qualidade. |

| Calendário da Empresa | `calendario.css` | ✅ | ❌ | ✅ | ✅ | ❓ | Página nova — estrutura padrão aplicada |

| Central de Alertas | `config-alertas.css` | ✅ | ❌ | ❌ | ✅ | ❓ | Redesenhada em 2026-05-16 com 2 abas: Alertas Gerais + Avisos Popups. `ConfigAlertasGerais.jsx` + `AvisosPopupAdmin.jsx` + `AvisosPopupModal.jsx`. Avisos Popup v1.0 completo (DB + API + UI). Permissão: `gerenciar-avisos-popup` em `permissoes.js`. |

| Centro de Incentivos | `incentivos.css` | ✅ | ❌ | ✅ | ✅ | ❓ | v5.1 concluído (2026-05-23). Todas as abas 100% React: Gincanas, Metas e Comissões, Pontos por Atividade, Pagamentos. Arquivos legados deletados (`ponto-por-processo.html/js/css`). Hook tiktik (`api/arremates.js`) deferido para v4.x — sem data. Testes de gincana corrida/equipe/produto_especifico/semanal pendentes de validação manual. |

| Central de Pagamentos | `central-de-pagamentos.css` | ✅ | ✅ | ✅ | ✅ | ❓ | React+TS desde 11/07/2026; **endurecimento TypeScript** em 01/08/2026 (tipos de domínio em `cpag-types.ts`, cliente único `fetchCpag`, sem `any`/`fetch` cru na árvore CPAG, payloads tipados). Shell padrão (`main.gs-card`, `UIHeaderPagina`, `gs-tab-nav`). Plano: `_planejamento/central-de-pagamentos-typescript.md`. Typecheck/build ok. Troca contínua multiempresa ainda `?`. |

| Dashboard Funcionário | `dashboard.css` | ✅ | ❌ | ❌ | ❌ | ❓ | Mobile-first, estrutura diferente. `DashFabGincana.jsx` (2026-05-20) substitui `DashGincanaCard` inline — gincanas agora em FAB + bottom sheet. Redesign completo 2026-05-24: `DashHeader` com dock (4 botões + divider), tipo+ciclo e avatar clicável; `DSUploader.jsx` (novo componente de upload compartilhado — variantes dropzone/avatar/inline); `DashPerfilModal` redesenhado com hero gradiente escuro, galeria DSUploader, streak de produção, conquistas do ciclo, melhor dia, gincanas vencidas; `DashPagamentosModal` com wallet topo dark + saldos lado a lado (Comissões / Premiações); `DashRankingCard` com mini pódio e estado campeã dourado. APIs novas: `GET /api/dashboard/streak`, `GET /api/dashboard/conquistas-ciclo`. |

| Arremates | `arremates.css` | ✅ | ❌ | ❌ | ✅ | ❓ | v1.0 (2026-05-04) + v2.0 (2026-05-05) + v3.0 Items 1-4 (2026-05-13/14) concluídos. v3.0: `PontoHelpers.js` e `UILinhaDoTempoDia.jsx` extraídos como compartilhados; `ArremateStatusCard` reescrito com layout `cracha-tiktik` idêntico ao OPStatusCard (cronômetro interval-aware, bottom sheets, tolerância S3, liberar intervalo); `ArreMatePainelAtividades` refatorado com estrutura `oa-*` idêntica ao OPPainelAtividades (ALMOCO/PAUSA no grid principal, inativos completos, todos os handlers de ponto). CSS: 4657 → 5850 linhas. v3.0 implementação 100% concluída (Items 1–5). Aguarda verificação manual em browser. Deletar manualmente: `ArremateToast.jsx` e `ArremateAcoesLote.jsx`. Ver `_planejamento/arremates-redesign.md`. |

| Embalagem de Produtos | `embalagem-de-produtos.css` | ❓ | ❓ | ❌ | ❌ | ❓ | Verificar migração React |

| Estoque | `estoque.css` | ❓ | ❓ | ❌ | ❌ | ❓ | Verificar migração React |

| Financeiro | `financeiro.css` | ✅ | ✅ | ✅ | ✅ | ✅ | Migração React+TS **encerrada** (2026-07-27). Árvore única (`main-financeiro.tsx` + `FinanceiroPage` + `FinanceiroContext`), sem multi-root/bridges/legado. Troca empresarial sem reload concluída na `1.40.3`: atualiza token/contexto no mesmo documento, remonta apenas o `FinanceiroProvider` e mantém a transição até `lv:financeiro-pronto`. CSS limpo. Typecheck/build OK; validação manual das abas OK. **Novas features liberadas.** Plano: `_planejamento/migrando-financeiro-para-typescript.md`. |

| Gerenciar Permissões | `permissoes-usuarios.css` | ✅ | ❌ | ✅ | ✅ | ❓ | Concluída 2026-05-23. Duas abas: Permissões + Auditoria. Prefixo `Permissoes*`. Editor: lista plana com search bar (substituiu acordeão) — filtra permissões em tempo real; exclui ex-membros e prestadores da lista de usuários. Auditoria: paginação clássica 12/pág com `gs-paginacao-*`; dropdown de usuários busca tabela `usuarios` (não só audit_log). Infraestrutura: `api/audit.js` + `api/audit-log.js` + tabela `audit_log`. JS legado `admin-permissoes-usuarios.js` deletado. |

| Gestão Organizacional | `gestao-organizacional.css` | ✅ | ❌ | ✅ | ✅ | ❓ | Fase 5 concluída e aprovada em produção em 2026-07-28. Prefixo `GO*`. Identidade e vínculo editados juntos, múltiplas empresas, encerramento contextual para empregados, sócios e prestadores, cópia opcional de permissões entre vínculos e URL antiga compatível. Código da empresa automático/imutável; administradores com acesso total derivado do tipo. Blocos pós-publicação 1–5 implementados localmente; aguardam validação manual. |

| Home / Admin | `home.css` | ✅ | ❌ | ❌ | ❌ | ❓ | |

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

**Arquivo:** `public/src/components/UICarregando.jsx`

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
- Features novas devem continuar em `.ts`/`.tsx` na árvore única. Plano histórico: `_planejamento/migrando-financeiro-para-typescript.md`.

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
- Plano executável:
  `_planejamento/menu-lateral-typescript-redesign.md`.
- Estado local: implementação concluída, `typecheck`, build e smoke visual
  responsivo aprovados; migration de preferências e smoke autenticado ainda
  pendentes.

---

## REGRA MAXIMA — CONTROLE DE ALTERACOES

**NUNCA COMMITAR. NUNCA FAZER PUSH. NUNCA PUBLICAR OU FAZER DEPLOY EM PRODUCAO.**

---

## HANDOFF DA FASE 7 — 01/08/2026

A Fase 7 foi implementada e aprovada na restauração local. A preparação
estrutural também foi executada e validada na Neon; o banco local usado nos
testes foi `sistema_lv_fase7` em `127.0.0.1:55437`, com a API local em `3017`.
Ainda não houve commit, push ou deploy dessa frente.

Suítes HTTP aprovadas: pagamentos (17 cenários), ponto/sessões (15),
incentivos (7), avisos/calendário (2) e limite da dashboard (6). Typecheck,
build, auditorias estáticas e `git diff --check` também foram aprovados.

O próximo passo é publicar seletivamente a Fase 7 e realizar o smoke autenticado
final. Produção e arremates permanecem bloqueados para empresas secundárias com
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
