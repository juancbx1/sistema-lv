# Changelog — Sistema LV

Todas as mudanças relevantes do sistema são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/).
Versionamento segue [SemVer](https://semver.org/lang/pt-BR/): `MAJOR.MINOR.PATCH`

---

## [1.48.0] — 2026-09-25

### Adicionado
- Redesign completo da aba **Embalar unidades** em grid de 2 colunas com controle ergonômico de quantidade (stepper central, botões +5, Tudo e Limpar) e barra de progresso minimalista.
- Pré-visualização do **Impacto no Estoque** em tempo real no modal de embalagem, calculando saldo atual, entrada e saldo previsto com status visual dinâmico.
- Campo de observação compactado para uma única linha horizontal no modal de embalagem, eliminando rolagem interna.
- Redesign da aba **Montar e embalar kit** com seletor em chips horizontais para kits de destino e grid visual de variações com thumbnail, SKU e saldo físico.
- Grid compacta de 2 colunas de mini-cards para os componentes necessários do kit, com proporção da receita, saldo em estoque e alertas coloridos para gargalos de montagem.
- Novo compositor da **Grade de Kits** no cadastro de produtos, com seleção em 2 níveis e dropdown visual com fotos, buscas e sem rolagem horizontal.

---

## [1.47.1] — 2026-09-24

### Corrigido
- As etapas da OP sem lançamento deixam de usar o bloco grande de “não
  encontrado” e passam a uma linha, para o cartão da fase não ficar cortado.
- O Monitor de OPs na aba de OPs abre fechado e expande pela seta à direita.
- A foto do monitor passa a ser a da variação da ordem. Sem imagem na
  variação, continua a do produto pai.

---

## [1.47.0] — 2026-09-24

### Adicionado
- Embalagem imprime a etiqueta do produto e do kit pelo agente local
  PrintNow, só grava o estoque depois que a impressão confirma, e permite
  estocar sem etiquetar.
- Etiquetas avulsas, no cabeçalho da embalagem, listam os produtos e as
  variações para imprimir ou imprimir e lançar no estoque.
- A grade do cadastro de produto passou a guardar GTIN/EAN e quantidade do
  pacote de cada variação.
- Central de Monitoramento de OPs substitui os agentes antigos de
  encerramento, com permissão própria.
- Página de estoque passou a carregar a interface em React.

### Alterado
- A fila de embalagem voltou a paginar abaixo dos produtos.
- O documento mestre de multiempresas permanece no repositório.

---

## [1.46.0] — 2026-08-09

### Alterado
- Página de Embalagem de Produtos migrada para React + TypeScript, com cards
  responsivos, filtros compactos, modal de unidades e kits, histórico e
  inteligência de estoque.
- Embalagem unitária e montagem de kits agora possuem confirmação, feedback de
  sucesso/erro, controle de quantidade aprimorado e limpeza do legado específico
  da página.

---

## Como versionar

```bash
npm version patch   # bug fix:      1.21.0 → 1.21.1
npm version minor   # feature nova: 1.21.0 → 1.22.0
npm version major   # breaking:     1.21.0 → 2.0.0
```

Depois: `git push && git push --tags` → Vercel faz o deploy automaticamente.

---

## [1.44.0] — 2026-08-06

### Adicionado
- Tela de login migrada para TypeScript, preservando o fluxo de autenticação existente.
- Importação de extratos para criação em lote de lançamentos financeiros, com processamento de arquivos, revisão e regras de classificação.

### Alterado
- Painel de atividades da página de Ordens de Produção completamente redesenhado, com resumo operacional, filtros, cards de acompanhamento, fila de tarefas e jornada integrada.
- Controle de ponto aprimorado com contexto da jornada, transições de intervalo, registro de falta, saída antecipada, atraso e ações com bloqueios coerentes ao calendário de trabalho.

---

## [1.43.5] — 2026-08-05

### Alterado
- Menu lateral administrativo agora diferencia visualmente as áreas-pai, como Produtividade, Produção e Estoque, dos itens internos, com hierarquia, recuo e destaque da área ativa.

## [1.43.4] — 2026-08-05

### Corrigido
- Correção de Bugs

## [1.43.3] — 2026-08-03

### Corrigido
- Card decorado de celebração restaurado para a maior meta atingida, com mensagem, emoji e confetes sem acumular níveis.
- Aviso de pontos restantes agora acompanha corretamente a meta selecionada entre Bronze, Prata e Ouro.

---

## [1.43.2] — 2026-08-03

### Dashboard dos empregados
- Foco de hoje reconhece a maior meta alcançada e indica o próximo nível.
- Barra de progresso acompanha a meta selecionada com gradientes próprios para Bronze, Prata e Ouro.
- Celebrações com emojis, confetes, mensagens personalizadas e festa especial para o Ouro.
- Bloco de potencial reorganizado para mostrar o valor garantido e o caminho até o Ouro.
- Ouro conquistado permanece como estado máximo, mantendo o fill dourado e os glitters mesmo ao selecionar outra meta.

---

## [1.21.0] — 2026-05-01

### Marco inicial do SemVer
Esta é a versão de referência que marca a adoção do versionamento semântico formal.
O sistema já estava funcional e em produção com as funcionalidades abaixo.

### Funcionalidades presentes

**Ordens de Produção**
- Criação, edição e finalização de OPs com quantidade real produzida
- Cálculo correto de saldo de arremate (sem saldo fantasma)
- Modal de etapas redesenhado com blocos abertos e borda-charme
- Finalização em lote com recálculo de etapas a partir das produções reais

**Arremates**
- Fila de arremate calculada via bulk data (sem N+1 queries)
- Sessões de arremate com controle de saldo por OP

**Embalagem de Produtos**
- Montagem de kits a partir de produtos simples arrematados
- Suporte a grade de variações por kit

**Produção Geral**
- Dashboard de produtividade com recharts
- Filtros client-side por período
- Timeline de metadados (PGMetaTimeline)
- Banner histórico e Pontos Extras

**Central de Pagamentos**
- Controle de pagamentos por funcionário

**Financeiro**
- Controle de lançamentos financeiros

**Calendário da Empresa**
- Calendário de eventos via FullCalendar

**Dashboard dos Funcionários**
- Acesso mobile-first para costureiras e tiktiks
- Registro de produção por etapa

**Gestão de Usuários**
- Cadastro, edição e controle de permissões
- Login com JWT (8h padrão, 30d com "manter conectado")
- Tela de despedida para usuários demitidos

**Infraestrutura**
- Frontend: React 19 + Vite 7
- Backend: Node.js + Express 5
- Banco: PostgreSQL via Neon
- Deploy: Vercel (serverless)
- Cron jobs: arquivamento diário e registro de intervalos de ponto

---

<!-- Template para próximas versões:

## [X.Y.Z] — AAAA-MM-DD

### Adicionado
- 

### Corrigido
- 

### Alterado
- 

### Removido
- 

-->
