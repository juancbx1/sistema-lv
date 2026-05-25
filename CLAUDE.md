# CLAUDE.md — Sistema LV

Este arquivo é lido automaticamente pelo Claude Code ao iniciar. Contém o contexto permanente do projeto: stack, arquitetura, padrões e regras de negócio. **Sempre atualize este arquivo quando uma nova decisão importante for tomada.**

---

## Visão Geral do Projeto

Sistema web interno de gestão industrial para uma confecção. Controla o ciclo completo de produção: Ordens de Produção (OPs), cortes, produção por etapas, arremates, embalagem, estoque, financeiro, pagamentos de funcionários e dashboard de desempenho.

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
└── CLAUDE.md                   # Este arquivo
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
    <script src="/js/carregar-menu-lateral.js" type="module"></script>
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

**Subcomponentes de aba (ex: renderizados dentro de `gs-conteudo-pagina`) podem e devem usar `gs-card`** para suas seções de conteúdo — isso é correto e segue o padrão. O anti-padrão se aplica apenas ao componente que é montado diretamente no `<main id="root">`.

---

## Status das Áreas

Tabela de controle para evitar retrabalho. Atualizar sempre que uma etapa for concluída.

| Área | Arquivo CSS | React 100% | CSS Limpo | Usa gs-card | Observações |
|---|---|---|---|---|---|
| Login / Index | `login.css` | ✅ | ✅ | N/A | React 100% (27/04). `LoginApp.jsx` único. Tablet-first (2 col), glassmorphism. Token 8h/30d via `manterConectado`. Demitidos → tela de despedida + cooldown crescente. |

| Ordens de Produção | `ordens-de-producao.css` | ✅ | ✅ | ✅ (via alias) | Referência de qualidade. 

| Calendário da Empresa | `calendario.css` | ✅ | ✅ | ✅ | Página nova — estrutura padrão aplicada |

| Central de Alertas | `config-alertas.css` | ✅ | ❌ | ✅ | Redesenhada em 2026-05-16 com 2 abas: Alertas Gerais + Avisos Popups. `ConfigAlertasGerais.jsx` + `AvisosPopupAdmin.jsx` + `AvisosPopupModal.jsx`. Avisos Popup v1.0 completo (DB + API + UI). Permissão: `gerenciar-avisos-popup` em `permissoes.js`. |

| Centro de Incentivos | `incentivos.css` | ✅ | ✅ | ✅ | v5.1 concluído (2026-05-23). Todas as abas 100% React: Gincanas, Metas e Comissões, Pontos por Atividade, Pagamentos. Arquivos legados deletados (`ponto-por-processo.html/js/css`). Hook tiktik (`api/arremates.js`) deferido para v4.x — sem data. Testes de gincana corrida/equipe/produto_especifico/semanal pendentes de validação manual. |

| Central de Pagamentos | `central-de-pagamentos.css` | ✅ | ❌ | ❌ | |

| Dashboard Funcionário | `dashboard.css` | ✅ | ❌ | ❌ | Mobile-first, estrutura diferente. `DashFabGincana.jsx` (2026-05-20) substitui `DashGincanaCard` inline — gincanas agora em FAB + bottom sheet. Redesign completo 2026-05-24: `DashHeader` com dock (4 botões + divider), tipo+ciclo e avatar clicável; `DSUploader.jsx` (novo componente de upload compartilhado — variantes dropzone/avatar/inline); `DashPerfilModal` redesenhado com hero gradiente escuro, galeria DSUploader, streak de produção, conquistas do ciclo, melhor dia, gincanas vencidas; `DashPagamentosModal` com wallet topo dark + saldos lado a lado (Comissões / Premiações); `DashRankingCard` com mini pódio e estado campeã dourado. APIs novas: `GET /api/dashboard/streak`, `GET /api/dashboard/conquistas-ciclo`. |

| Arremates | `arremates.css` | ✅ | ❌ | ✅ | v1.0 (2026-05-04) + v2.0 (2026-05-05) + v3.0 Items 1-4 (2026-05-13/14) concluídos. v3.0: `PontoHelpers.js` e `UILinhaDoTempoDia.jsx` extraídos como compartilhados; `ArremateStatusCard` reescrito com layout `cracha-tiktik` idêntico ao OPStatusCard (cronômetro interval-aware, bottom sheets, tolerância S3, liberar intervalo); `ArreMatePainelAtividades` refatorado com estrutura `oa-*` idêntica ao OPPainelAtividades (ALMOCO/PAUSA no grid principal, inativos completos, todos os handlers de ponto). CSS: 4657 → 5850 linhas. v3.0 implementação 100% concluída (Items 1–5). Aguarda verificação manual em browser. Deletar manualmente: `ArremateToast.jsx` e `ArremateAcoesLote.jsx`. Ver `_planejamento/arremates-redesign.md`. |

| Embalagem de Produtos | `embalagem-de-produtos.css` | ❓ | ❌ | ❌ | Verificar migração React |

| Estoque | `estoque.css` | ❓ | ❌ | ❌ | Verificar migração React |

| Financeiro | `financeiro.css` | ❓ | ❌ | ❌ | Verificar migração React |

| Gerenciar Permissões | `permissoes-usuarios.css` | ✅ | ✅ | ✅ | Concluída 2026-05-23. Duas abas: Permissões + Auditoria. Prefixo `Permissoes*`. Editor: lista plana com search bar (substituiu acordeão) — filtra permissões em tempo real; exclui ex-membros e prestadores da lista de usuários. Auditoria: paginação clássica 12/pág com `gs-paginacao-*`; dropdown de usuários busca tabela `usuarios` (não só audit_log). Infraestrutura: `api/audit.js` + `api/audit-log.js` + tabela `audit_log`. JS legado `admin-permissoes-usuarios.js` deletado. |

| Usuários Cadastrados | `usuarios-cadastrados.css` | ✅ | ✅ | ✅ | Redesenhado 2026-05-23. Prefixo `UC*`. Cards com borda-charme por categoria, drawer de edição com férias+vínculo internos, acordeão "Ex-membros". Tipo `ex_socio` como campo em `tipos[]` (sem datas). Tipo `prestador_externo` implementado. Migration `_planejamento/migration-prestador-externo.sql` executada em produção e staging (2026-05-23). |

| Home / Admin | `home.css` | ✅ | ❌ | ❌ | |

| Gerenciar Produção | `gerenciar-producao.css` | ❓ | ❌ | ❌ | Verificar migração React |

| Produção Geral | `producao-geral.css` | ✅ | ✅ | ✅ | v1.0 + v2.0 + v3.0 implementados (2026-04-26). Prefixo `PG*`, recharts, filtros client-side, PGMetaTimeline, banner histórico, Pontos Extras |

> ✅ Concluído | ❌ Pendente | ❓ Não verificado — checar antes de trabalhar na área

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

**Visual:** spinner de dois arcos (azul + roxo, mesmos tons do UIAgenteIA) girando sobre trilha cinza. Letras "LV" em gradiente no centro, com pulso suave. Fundo transparente (herda do container).

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

### Ambientes (Staging)

O projeto tem dois ambientes configurados no Vercel desde 2026-05-01:

| Ambiente | Branch git | URL | Banco |
|---|---|---|---|
| Produção | `main` | URL principal do projeto | `sistema_lv_db` (Neon, sa-east-1) |
| Staging | `staging` | `sistema-lv-git-staging-lojas-variara.vercel.app` | `sistema-lv-staging` (Neon, us-east-1) |

**Fluxo de trabalho atual:** desenvolvimento direto na `main` (push → produção). O staging existe para quando for necessário testar mudanças arriscadas antes de ir à produção.

**Para usar o staging quando necessário:**
```bash
git checkout staging      # muda para o trilho de teste
# ... faz as alterações ...
git push origin staging   # publica no ambiente de preview (banco de staging)
git checkout main
git merge staging
git push origin main      # manda para produção
git checkout staging      # volta ao staging para continuar
```

**Utilitários de staging em `_planejamento/`:**
- `gerar-schema-staging.js` — exporta schema da produção → `schema-staging.sql`
- `testar-staging.js` — compara tabelas e colunas entre produção e staging
- `seed-staging.js` — cria usuário admin de teste no staging (login: `admin_staging` / `staging123`)

**Banner visual:** quando `VITE_ENV=staging`, o componente `UIHeaderPagina` exibe um banner laranja fixo no topo de todas as páginas admin. Em produção, `VITE_ENV=production` — banner não aparece.

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

**Migration rodada em produção e staging (2026-05-16):** `_planejamento/migration-cortes-pn-seq.sql`

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

## Observações para o Claude

- Ao criar novos componentes React, seguir o padrão de prefixo por domínio e colocar **sempre** em `public/src/components/` — nunca em subpastas.
- Ao criar novas rotas de API, adicionar o import e o `app.use` correspondente no `server.js`.
- **Nunca usar `saldo_op` diretamente** — calcular sempre a partir de `quantidade_real_produzida - total_ja_arrematado`.
- O arquivo `regra de negocio das OP.txt` na raiz contém exemplos concretos das regras de OP com dados reais do banco.
- Ao tomar uma decisão arquitetural importante ou implementar uma regra de negócio nova, **atualizar este CLAUDE.md**.
- A pasta `_planejamento/` na raiz contém planos detalhados por funcionalidade (spec, checklist, decisões). **Sempre ler o arquivo relevante antes de começar a implementar qualquer coisa**. Arquivos existentes: `central-de-alertas.md`, `horario-empregados.md`, `producao-geral.md`, `organizacao-sistemica.md`, `gincanas.md`.
- **Nunca usar `is_test` users em cálculos, listagens ou relatórios** — o filtro já está nas queries principais, mas atentar ao criar novas queries que listem funcionários.
- **A tabela `usuarios` NÃO tem coluna `ativo`** — usar `data_demissao IS NULL` para filtrar funcionários ativos. O campo `ativo` existe em outras tabelas (avatares, configuracoes, etc.), nunca em `usuarios`.

---