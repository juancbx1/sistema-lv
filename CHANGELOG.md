# Changelog — Sistema LV

Todas as mudanças relevantes do sistema são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/).
Versionamento segue [SemVer](https://semver.org/lang/pt-BR/): `MAJOR.MINOR.PATCH`

---

## Como versionar

```bash
npm version patch   # bug fix:      1.21.0 → 1.21.1
npm version minor   # feature nova: 1.21.0 → 1.22.0
npm version major   # breaking:     1.21.0 → 2.0.0
```

Depois: `git push && git push --tags` → Vercel faz o deploy automaticamente.

---

## [1.43.2] — 2026-08-03

### Dashboard dos empregados
- Foco de hoje reconhece a maior meta alcançada e indica o próximo nível.
- Barra de progresso acompanha a meta selecionada com gradientes próprios para Bronze, Prata e Ouro.
- Celebrações com emojis, confetes, mensagens personalizadas e festa especial para o Ouro.
- Bloco de potencial reorganizado para mostrar o valor garantido e o caminho até o Ouro.

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
