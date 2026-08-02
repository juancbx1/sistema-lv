# Sistema Multiempresas

## Objetivo

Transformar o Sistema LV, originalmente construído para uma única empresa, em uma plataforma multiempresas com isolamento integral de dados, contexto empresarial explícito e administração centralizada de empresas, pessoas, vínculos e acessos.

Ao final:

- várias empresas poderão ser cadastradas no mesmo banco;
- cada empresa terá perfil, identidade e configurações próprias;
- um usuário poderá pertencer a uma ou mais empresas;
- cargos, permissões e dados empregatícios poderão variar por empresa;
- administradores poderão trocar a empresa ativa pelo menu compartilhado;
- empregados com um único vínculo entrarão diretamente na sua empresa;
- Financeiro, OPs, produção, estoque e demais módulos terão dados isolados;
- nenhuma consulta ou alteração poderá atravessar empresas sem autorização.

---

## Decisões arquiteturais aprovadas

| Decisão | Estado |
|---|---|
| Banco PostgreSQL único, com isolamento por `empresa_id` | Aprovado |
| `usuarios` representa a identidade global da pessoa | Aprovado |
| `usuarios_empresas` representa o vínculo da pessoa com cada empresa | Aprovado |
| Username permanece globalmente único | Aprovado |
| Empresa ativa será transportada no JWT | Aprovado |
| Trocar empresa emitirá novo JWT e recarregará a página | Aprovado |
| Seletor no menu lateral para PC | Aprovado |
| Seletor compacto junto ao hamburger para tablet/celular | Aprovado |
| Empregado com um vínculo não terá etapa extra no login | Aprovado |
| A página atual de usuários será convertida em `Gestão Organizacional` | Aprovado |
| Abas da Gestão Organizacional: `Pessoas e Acessos` e `Empresas` | Aprovado |
| Financeiro será o primeiro módulo de negócio multiempresa | Aprovado |
| Empresa secundária não acessa módulo ainda não migrado | Aprovado |
| Migrações serão aditivas antes de qualquer remoção de campo legado | Aprovado |

---

## Princípios obrigatórios

### Isolamento no backend

O frontend nunca será a autoridade sobre o isolamento. Toda API empresarial deve obter a empresa do contexto autenticado e aplicar o filtro no backend.

Consultas por ID também devem validar a empresa:

```sql
SELECT *
FROM entidade
WHERE id = $1
  AND empresa_id = $2;
```

O padrão vale para leitura, edição, exclusão, baixa, aprovação, estorno, relatórios e jobs automáticos.

### Empresa não vem livremente do body

O `empresa_id` de novas entidades não deve ser aceito cegamente do corpo da requisição. O backend deve usar `req.empresaId`, preenchido por middleware após validar token, empresa e vínculo.

### Migração gradual segura

Durante a transição:

- a empresa atual será a empresa principal;
- os dados legados serão associados a ela;
- campos antigos serão mantidos até todos os consumidores migrarem;
- módulos não migrados serão bloqueados para empresas secundárias;
- nenhuma empresa secundária poderá enxergar dados da principal em uma tela legada.

### Integridade entre empresas

Relacionamentos devem permanecer dentro da mesma empresa. Exemplos:

- OP e produto;
- corte e OP;
- produção e empregado;
- lançamento e conta bancária;
- agendamento e categoria;
- pagamento e contato financeiro.

Sempre que viável, essa regra deve existir tanto na aplicação quanto em constraints do banco.

---

## Modelo conceitual

```text
usuarios
└── identidade, login, senha, nome, email e foto

empresas
└── identidade, perfil, configurações e situação da empresa

usuarios_empresas
├── vínculo entre pessoa e empresa
├── tipos/funções
├── permissões
├── admissão/demissão
├── salário/nível
├── contato financeiro
└── empresa principal
```

### Estrutura inicial de `empresas`

```sql
CREATE TABLE empresas (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) UNIQUE NOT NULL,
    razao_social VARCHAR(160),
    nome_fantasia VARCHAR(120) NOT NULL,
    cnpj VARCHAR(18),
    logo_url TEXT,
    cor_identificacao VARCHAR(7),
    telefone VARCHAR(30),
    email VARCHAR(160),
    endereco JSONB,
    timezone VARCHAR(60) NOT NULL DEFAULT 'America/Sao_Paulo',
    configuracoes JSONB NOT NULL DEFAULT '{}',
    ativa BOOLEAN NOT NULL DEFAULT TRUE,
    criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Estrutura inicial de `usuarios_empresas`

Esta estrutura é preliminar e será confirmada na Fase 0 após o inventário completo do schema.

```sql
CREATE TABLE usuarios_empresas (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    tipos TEXT[] NOT NULL DEFAULT '{}',
    permissoes TEXT[] NOT NULL DEFAULT '{}',
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    empresa_principal BOOLEAN NOT NULL DEFAULT FALSE,
    data_admissao DATE,
    data_demissao DATE,
    salario_fixo NUMERIC,
    nivel INTEGER,
    id_contato_financeiro INTEGER,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (usuario_id, empresa_id)
);
```

---

## Contexto empresarial e sessão

O JWT passará a transportar, no mínimo:

```js
{
    id: usuario.id,
    nome: usuario.nome,
    nome_usuario: usuario.nome_usuario,
    empresa_id: empresaAtiva.id,
    vinculo_id: vinculo.id
}
```

O middleware empresarial disponibilizará:

```js
req.usuarioLogado
req.empresaId
req.empresaAtiva
req.vinculoEmpresa
```

Endpoints planejados:

```text
GET  /api/contexto-empresa
POST /api/contexto-empresa/selecionar
```

Ao trocar de empresa:

1. o backend valida o vínculo;
2. emite um novo JWT;
3. o frontend substitui o token;
4. caches empresariais são descartados;
5. a página atual é recarregada.

Como os tokens atuais podem durar 30 dias, as APIs críticas não devem depender somente da informação gravada no token: o vínculo ativo precisa ser revalidado pelo middleware compartilhado.

---

## Gestão Organizacional

Nova página:

```text
/admin/gestao-organizacional.html
```

Título:

```text
Gestão Organizacional
```

Abas:

```text
[ Pessoas e Acessos ] [ Empresas ]
```

Estrutura planejada:

```text
GestaoOrganizacionalPage
├── GOPessoasTab
└── GOEmpresasTab
```

Os componentes novos usarão prefixo `GO*`. Componentes `UC*` existentes poderão ser mantidos durante a transição e renomeados somente quando isso for seguro e útil.

### Pessoas e Acessos

- listar membros da empresa ativa;
- permitir visão global apenas com permissão;
- cadastrar pessoa nova;
- localizar pessoa existente e criar novo vínculo;
- editar vínculos por empresa;
- definir empresa principal;
- encerrar vínculo sem encerrar outros vínculos;
- mostrar empresa principal e vínculos adicionais nos cards;
- manter ativos e ex-membros separados.

### Empresas

- listar todas as empresas administráveis;
- cadastrar e editar empresas;
- manter logo, cor, razão social, nome fantasia e CNPJ;
- manter contato e endereço;
- manter timezone e configurações operacionais;
- mostrar totais de membros e gestores;
- ativar ou desativar empresa;
- acessar membros vinculados.

### Permissões previstas

```text
acesso-gestao-organizacional
visualizar-empresas
gerenciar-empresas
vincular-usuarios-empresas
visualizar-todas-empresas
```

Elementos sem permissão continuarão visíveis e bloqueados conforme o padrão `UIBloqueio`.

---

## Seletor universal

### PC

O seletor será renderizado no menu lateral, abaixo do bloco do usuário.

### Tablet e celular

Será exibido um controle compacto próximo ao hamburger. A seleção abrirá um bottom sheet touch-first.

### Regras

- uma única empresa: contexto visível, sem ação de troca;
- várias empresas: seletor habilitado;
- atalho para Gestão Organizacional somente com permissão;
- troca bloqueada durante operações não salvas;
- recarga obrigatória após troca para evitar estado residual;
- dashboard do empregado só terá seletor quando houver vários vínculos.

---

# Fases de execução

## Fase 0 — Auditoria e desenho definitivo

### Objetivo

Mapear banco, APIs, páginas, jobs e vínculos antes de executar migrations.

### Entregas

- inventário de tabelas;
- classificação global/empresarial/filha/indefinida;
- inventário de endpoints;
- mapa de campos empresariais hoje existentes em `usuarios`;
- mapa de constraints que precisarão incluir `empresa_id`;
- mapa de consultas por ID vulneráveis a cruzamento;
- sequência definitiva de migrations;
- matriz de módulos e ordem de liberação.

### Critério de conclusão

- modelo confirmado com o schema real;
- nenhuma migration executada;
- riscos e decisões pendentes documentados.

### Auditoria executada em 2026-07-27

O schema configurado em `POSTGRES_URL` foi consultado em transação `READ ONLY` pelo utilitário:

```text
tools/auditar-multiempresas.mjs
```

Nenhum dado ou estrutura foi alterado.

#### Dimensão encontrada

| Item | Total |
|---|---:|
| Tabelas no schema `public` | 75 |
| Colunas | 696 |
| Constraints PK/UK/FK | 211 |
| Índices | 199 |
| Tabelas que já possuem `empresa_id` | 0 |
| Arquivos principais de router em `api/` | 39 |
| Rotas Express declaradas | 267 |
| Chamadas frontend para APIs encontradas | 127 |
| Arquivos frontend com chamadas para APIs | 61 |

#### Conclusões imediatas

1. Multiempresa ainda não existe em nenhuma camada do banco.
2. A mudança não pode ficar restrita ao Financeiro: autenticação, usuários, ponto, produção e configurações já compartilham dados diretamente.
3. O JWT é a melhor via de transporte do contexto neste projeto porque todas as chamadas existentes já enviam `Authorization`, evitando alterar centenas de `fetches` apenas para adicionar um header.
4. As 267 rotas exigem middleware empresarial centralizado. Implementações independentes por router aumentariam muito o risco de esquecimento.
5. Existem diversos relacionamentos por texto, sem FK, que podem colidir quando duas empresas reutilizarem números, nomes ou referências.
6. O banco possui várias constraints únicas globais que precisarão se tornar únicas por empresa.

### Classificação preliminar das 75 tabelas

Legenda:

- **Global:** identidade ou infraestrutura compartilhada.
- **Empresarial direta:** deve possuir `empresa_id`.
- **Empresarial derivada:** pertence a uma entidade pai empresarial; será decidido se recebe `empresa_id` também para defesa em profundidade.
- **Política pendente:** precisa de decisão funcional antes da migration.

#### Identidade global

| Tabela | Destino |
|---|---|
| `usuarios` | Manter somente identidade e credenciais globais após a transição |
| `avatares_usuarios` | Global por usuário |

#### Estrutura organizacional nova

| Tabela | Destino |
|---|---|
| `empresas` | Nova tabela global de controle |
| `usuarios_empresas` | Nova tabela de vínculos |

#### Financeiro e pagamentos

| Tabela | Classificação |
|---|---|
| `fc_contas_bancarias` | Empresarial direta |
| `fc_grupos_financeiros` | Empresarial direta |
| `fc_categorias` | Empresarial direta |
| `fc_contatos` | Empresarial direta |
| `fc_lancamentos` | Empresarial direta |
| `fc_lancamento_itens` | Empresarial derivada de lançamento |
| `fc_contas_agendadas` | Empresarial direta |
| `fc_contas_agendadas_itens` | Empresarial derivada de agendamento |
| `fc_lotes_agendamento` | Empresarial direta |
| `fc_solicitacoes_alteracao` | Empresarial derivada de lançamento |
| `fc_logs_auditoria` | Empresarial direta |
| `fc_notificacoes` | Empresarial direta |
| `config_concessionarias_vt` | Empresarial direta |
| `usuario_concessionaria_vt` | Substituir referência simples ao usuário por vínculo empresarial |
| `historico_pagamentos_funcionarios` | Empresarial direta |
| `registro_dias_trabalhados` | Empresarial direta |
| `comissoes_pagas` | Empresarial direta |
| `recibos_conferencia` | Empresarial direta |
| `despesas_operacionais` | Empresarial direta |
| `canais_venda_config` | Empresarial direta |
| `materias_primas` | Empresarial direta |
| `produto_composicao_mp` | Empresarial derivada, mas usa referência textual de produto |
| `produto_custo_mao_de_obra` | Empresarial derivada, mas usa referência textual de produto |
| `produto_precificacao_configs` | Empresarial derivada, mas usa referência textual de produto |
| `tipos_mao_de_obra` | Empresarial direta |

#### Pessoas, ponto e incentivos

| Tabela | Classificação |
|---|---|
| `ponto_diario` | Empresarial direta |
| `ferias_empregados` | Empresarial direta |
| `pontos_extras` | Empresarial direta |
| `banco_pontos_saldo` | Empresarial direta |
| `banco_pontos_log` | Empresarial direta |
| `metas_versoes` | Empresarial direta |
| `metas_regras` | Empresarial derivada da versão |
| `periodos_pontos_especiais` | Empresarial direta |
| `gincanas` | Empresarial direta |
| `gincanas_premiacoes` | Empresarial derivada de gincana |
| `gincanas_premios_ganhos` | Empresarial derivada de gincana e vínculo |

#### Produtos, produção e estoque

| Tabela | Classificação |
|---|---|
| `produtos` | Empresarial direta |
| `ordens_de_producao` | Empresarial direta |
| `demandas_producao` | Empresarial direta |
| `demandas_componentes_atribuidos` | Empresarial direta |
| `cortes` | Empresarial direta |
| `producoes` | Empresarial direta |
| `producoes_solicitacoes_exclusao` | Empresarial derivada de produção |
| `sessoes_trabalho_producao` | Empresarial direta |
| `arremates` | Empresarial direta |
| `arremate_perdas` | Empresarial direta |
| `sessoes_trabalho_arremate` | Empresarial direta |
| `embalagens_realizadas` | Empresarial direta |
| `estoque_movimentos` | Empresarial direta |
| `estoque_itens_arquivados` | Empresarial direta |
| `inventario_sessoes` | Empresarial direta |
| `inventario_itens` | Empresarial derivada da sessão |
| `produto_niveis_estoque_alerta` | Empresarial direta; referência textual exige revisão |
| `producao_promessas` | Empresarial direta; referência textual exige revisão |
| `configuracoes_pontos_processos` | Empresarial derivada de produto |
| `tempos_padrao_producao` | Empresarial derivada de produto |
| `tempos_padrao_arremate` | Empresarial derivada de produto |
| `log_assinaturas` | Empresarial derivada de produção/arremate |
| `log_divergencias` | Empresarial derivada de produção/arremate |
| `log_montagem_kits` | Empresarial direta |

#### Calendário, alertas, comunicação e auditoria

| Tabela | Classificação |
|---|---|
| `calendario_empresa` | Empresarial direta |
| `alertas_configuracoes_gerais` | Empresarial direta |
| `configuracoes_alertas` | Empresarial direta |
| `historico_alertas` | Empresarial direta |
| `avisos_popup` | Política pendente: empresarial com opção futura de aviso global |
| `avisos_popup_visualizacoes` | Derivada de aviso e vínculo |
| `comunicacoes` | Política pendente: empresarial com opção futura de publicação global |
| `comunicacao_comentarios` | Derivada de comunicação |
| `comunicacao_reacoes` | Derivada de comunicação |
| `comunicacoes_lidos` | Derivada de comunicação e vínculo |
| `audit_log` | Empresarial direta |
| `auditoria_eventos` | Empresarial direta |
| `eventos_sistema` | Política pendente: evento empresarial ou global conforme tipo |

### Campos atuais de `usuarios`

O schema real possui 35 colunas em `usuarios`.

#### Permanecem globais

- `id`;
- `nome`;
- `nome_completo`;
- `nome_usuario`;
- `email`;
- `senha`;
- `avatar_url`;
- `foto_oficial`;
- `is_test`.

#### Devem migrar para `usuarios_empresas`

- `tipos`;
- `nivel`;
- `permissoes`;
- `salario_fixo`;
- `valor_passagem_diaria`;
- `elegivel_pagamento`;
- `id_contato_financeiro`;
- `data_admissao`;
- `data_demissao`;
- `horario_entrada_1`;
- `horario_saida_1`;
- `horario_entrada_2`;
- `horario_saida_2`;
- `horario_entrada_3`;
- `horario_saida_3`;
- `status_atual`;
- `id_sessao_trabalho_atual`;
- `status_data_modificacao`;
- `ultimo_alerta_ociosidade_em`;
- `ultimo_alerta_lentidao_em`;
- `desconto_inss_percentual`;
- `desconto_vt_percentual`;
- `dias_trabalho`;
- `is_freelance`.

#### Decisão pendente

- `badge_destaque_id`: provavelmente empresarial, pois conquistas e rankings serão empresariais.
- `arquivado`: definir se representa identidade global desativada ou apenas encerramento de todos os vínculos.

### Constraints únicas que exigem revisão

| Tabela | Constraint atual | Destino provável |
|---|---|---|
| `ordens_de_producao` | `numero` | `(empresa_id, numero)` |
| `ordens_de_producao` | `edit_id` | `(empresa_id, edit_id)` ou identificador global técnico |
| `produtos` | `nome` | `(empresa_id, nome)` |
| `cortes` | `pn` | `(empresa_id, pn)` |
| `fc_contatos` | `(nome, tipo)` | `(empresa_id, nome, tipo)` |
| `fc_grupos_financeiros` | `nome` | `(empresa_id, nome)` |
| `config_concessionarias_vt` | `nome` | `(empresa_id, nome)` |
| `ponto_diario` | `(funcionario_id, data)` | `(empresa_id, funcionario_id, data)` |
| `registro_dias_trabalhados` | `(usuario_id, data)` | `(empresa_id, usuario_id, data)` |
| `banco_pontos_saldo` | `usuario_id` | `(empresa_id, usuario_id)` |
| `comissoes_pagas` | `(costureira_nome, ciclo_nome)` | substituir nome por vínculo/usuário e incluir empresa |
| `canais_venda_config` | `nome_canal` | `(empresa_id, nome_canal)` |
| `materias_primas` | `nome` | `(empresa_id, nome)` |
| `periodos_pontos_especiais` | `nome_periodo` | `(empresa_id, nome_periodo)` |
| `calendario_empresa` | índice funcional por data/tipo/funcionário | incluir `empresa_id` |
| Tabelas `produto_*` | `produto_ref_id` e combinações | incluir empresa ou substituir referência textual |

### Riscos técnicos confirmados

#### 1. Relacionamentos por texto

Há vínculos operacionais sem FK, incluindo:

- `op_numero`;
- `op_edit_id`;
- nomes de funcionários;
- `produto_ref_id`;
- `produto_sku`;
- usuários registrados por nome.

Esses relacionamentos funcionam em empresa única, mas podem se tornar ambíguos quando duas empresas reutilizarem números ou nomes. A estratégia preferida será migrar gradualmente para IDs/FKs, mantendo campos textuais apenas como snapshot quando necessário.

#### 2. Estado operacional dentro de `usuarios`

`status_atual`, sessão ativa, horários e alertas estão na identidade global. Um usuário em duas empresas não pode ter seu estado operacional representado corretamente por esses campos. Eles precisam migrar para o vínculo ou para uma entidade empresarial própria.

#### 3. Login usa demissão global

O login atual bloqueia quando `usuarios.data_demissao` está preenchido. No modelo novo, o bloqueio deve considerar vínculos ativos: desligamento da Empresa A não pode impedir acesso à Empresa B.

#### 4. Permissões são globais

`getPermissoesCompletasUsuarioDB` lê `tipos` e `permissoes` diretamente de `usuarios`. Durante a transição ele precisará receber ou descobrir `empresa_id` e consultar `usuarios_empresas`.

#### 5. Pagamentos usam contato global

`api/pagamentos.js` busca `usuarios.id_contato_financeiro`. Esse campo precisa ser obtido do vínculo, para evitar lançar pagamento da Empresa A no contato configurado pela Empresa B.

#### 6. Muitos middlewares independentes

Ao menos 32 routers possuem `router.use` próprio. O contexto empresarial deverá ser encapsulado em utilitário/middleware compartilhado e aplicado de maneira verificável a todos os routers empresariais.

#### 7. Dois pontos de montagem de APIs

Existem montagens em `server.js` e `api/index.js`. A implementação deve validar os dois caminhos para evitar diferenças entre desenvolvimento local e produção/Vercel.

#### 8. Módulos parcialmente migrados

Enquanto um módulo não estiver pronto, o seletor global poderá colocar a sessão em empresa secundária. Por isso, a trava de “módulo não disponível para esta empresa” deve existir antes de liberar o seletor em produção.

### Decisões finais da Fase 0

| Tema | Decisão aprovada |
|---|---|
| Numeração de OP | Única por empresa; empresas diferentes poderão repetir o mesmo número |
| Produtos | Específicos por empresa, com cópia futura entre empresas |
| Matérias-primas, fornecedores e contatos | Específicos por empresa |
| Avisos e comunicações | Empresariais por padrão, com opção global reservada ao superadministrador |
| Superadministrador | Acesso global restrito e separado das permissões empresariais |
| `usuarios.arquivado` | Desativação da identidade global; demissão continua sendo por vínculo |
| `badge_destaque_id` | Dado específico do vínculo empresarial |
| Tabelas filhas | Recebem `empresa_id` quando consultadas diretamente ou quando houver risco financeiro/operacional |
| Referências textuais | Conversão gradual para IDs/FKs; texto permanece apenas como snapshot quando necessário |
| Empresa legada inicial | Código `lojas-variara`, nome fantasia inicial `Lojas Variara`; dados jurídicos poderão ser completados na Gestão Organizacional |
| Ambiente de implantação | O staging foi abandonado; toda migration será ensaiada em restauração local validada antes de qualquer execução direta em produção |

### Encerramento da Fase 0

- auditoria do schema concluída;
- 75 tabelas classificadas;
- riscos e constraints mapeados;
- decisões funcionais aprovadas;
- backup completo criado;
- restauração real e comparação exata concluídas;
- nenhuma migration multiempresa executada.

**Fase 0 concluída em 2026-07-28.**

## Fase 1 — Fundação do banco

### Entregas

- migration de `empresas`;
- migration de `usuarios_empresas`;
- cadastro da empresa atual;
- vínculo de todos os usuários atuais;
- cópia dos dados empresariais atuais;
- validação de contagens e divergências;
- índices e constraints iniciais.

### Critério de conclusão

- todos os usuários possuem vínculo principal válido;
- comportamento do sistema permanece inalterado;
- nenhum campo legado foi removido.

### Desenho executável preparado

Artefatos:

```text
_planejamento/migration-multiempresas-fase1-fundacao.sql
_planejamento/migration-multiempresas-fase1-fundacao-neon.sql
tools/validar-fase1-multiempresas.mjs
```

O primeiro arquivo é a fonte documentada da migration. O arquivo com sufixo
`-neon.sql` contém o mesmo SQL executável sem comentários, em UTF-8 sem BOM,
para uso no editor SQL da Neon.

Novas estruturas aditivas:

| Tabela | Responsabilidade |
|---|---|
| `sistema_migrations` | Registro de migrations estruturais |
| `empresas` | Perfil, identidade e situação das empresas |
| `usuarios_empresas` | Vínculos, funções, permissões e dados empregatícios por empresa |
| `usuarios_acessos_globais` | Superadministrador e permissões verdadeiramente globais |
| `modulos_sistema` | Catálogo de módulos e estado de prontidão multiempresa |
| `empresas_modulos` | Liberação gradual de módulos por empresa |

A migration:

- é transacional;
- usa advisory lock;
- possui timeout de lock e statement;
- não remove nem altera colunas existentes;
- não adiciona ainda `empresa_id` às tabelas de negócio;
- cria a empresa legada `lojas-variara`;
- copia os 18 usuários atuais para 18 vínculos;
- marca todos os vínculos iniciais como principais;
- cadastra 18 módulos;
- mantém os 18 módulos liberados para a empresa legada;
- não promove superadministrador automaticamente;
- possui guardas finais antes do `COMMIT`;
- pode ser executada novamente sem duplicar empresa, vínculo ou migration.

### Ensaio local da migration

Executado em 2026-07-28 sobre uma restauração integral do backup:

- variante Neon sem comentários: aprovada;
- equivalência exata com o SQL executável da fonte documentada: aprovada;
- codificação UTF-8 sem BOM: aprovada;
- marcadores de comentário encontrados: 0;
- SHA-256 da variante Neon:
  `cca4dae5ccab30bd5a74a92fd47fe62a97297f9511bf4826903ca1bdffd2994c`;
- primeira execução: aprovada;
- segunda execução para testar idempotência: aprovada;
- usuários: 18;
- vínculos criados: 18;
- vínculos principais: 18;
- divergências entre campos originais e vínculo: 0;
- módulos esperados/cadastrados: 18/18;
- constraints não validadas: 0;
- índices inválidos: 0;
- migration registrada: 1;
- Neon alterado durante o ensaio: não.

O ambiente PostgreSQL temporário do ensaio foi encerrado e removido. O backup
pré-multiempresa permaneceu preservado em `_backups/`.

### Execução e validação em produção

Executadas manualmente na Neon pelo responsável em 2026-07-28:

- migration executada integralmente com sucesso;
- transação concluída com `COMMIT`;
- validação pós-migration executada em transação somente leitura;
- resultado geral: `aprovado: true`;
- 6 tabelas obrigatórias presentes;
- empresa `Lojas Variara` ativa e marcada como legada;
- 18 usuários e 18 vínculos empresariais;
- 18 vínculos principais;
- nenhum usuário sem vínculo;
- nenhum vínculo principal inconsistente;
- zero divergências nos campos copiados;
- 18 módulos cadastrados e habilitados para a empresa legada;
- zero módulos ausentes ou inesperados;
- migration registrada exatamente uma vez;
- zero constraints não validadas;
- zero índices inválidos;
- validação encerrada com `ROLLBACK`, sem mutação adicional.

**Fase 1 concluída em produção em 2026-07-28.**

### Critérios de rollback da Fase 1

Como a migration é apenas aditiva, o rollback imediato consiste em remover somente
as seis tabelas novas. Ele só poderá ser considerado enquanto:

- existir apenas a empresa legada;
- nenhuma API depender das tabelas novas;
- nenhum usuário tiver vínculo com empresa secundária;
- nenhum superadministrador global tiver sido configurado;
- nenhum módulo estiver marcado como `multiempresa_pronto`;
- nenhuma tabela de negócio tiver recebido `empresa_id`.

Depois da Fase 2, rollback estrutural não será a estratégia principal. A reversão
deverá ser feita por migration corretiva ou, em incidente grave, pela restauração
do backup validado.

## Fase 2 — Contexto empresarial no backend

### Entregas

- middleware universal;
- `req.empresaId`, `req.empresaAtiva` e `req.vinculoEmpresa`;
- APIs de consulta e troca de contexto;
- proteção para módulos não migrados;
- utilitários compartilhados para queries empresariais.

### Critério de conclusão

- empresa e vínculo validados no servidor;
- empresa inativa ou não autorizada é rejeitada;
- módulo legado não expõe dados sob contexto incorreto.

### Implementação local

Implementada em 2026-07-28:

- middleware universal em `api/contexto-empresa.js`;
- montagem antes dos routers existentes em `server.js` e `api/index.js`;
- compatibilidade com tokens anteriores à multiempresa: ausência de
  `empresa_id` resolve o vínculo principal ativo;
- contexto confiável disponibilizado em `req.empresaId`, `req.empresaAtiva`,
  `req.vinculoEmpresa`, `req.superadministrador` e `req.moduloEmpresa`;
- `GET /api/contexto-empresa` para consultar empresa ativa e empresas
  disponíveis;
- `POST /api/contexto-empresa/trocar` para validar o vínculo e emitir um novo
  JWT sem prolongar a validade da sessão;
- empresa informada pelo cliente nunca é aceita sem validação do vínculo no
  banco;
- empresas inativas, vínculos inativos e empresas sem vínculo retornam erro;
- empresa legada mantém compatibilidade durante a migração;
- empresa secundária só acessa módulo simultaneamente habilitado em
  `empresas_modulos` e marcado como `multiempresa_pronto`;
- rotas futuras ainda não mapeadas falham fechadas para empresas secundárias;
- login, cron e ping não são interceptados pelo contexto; em especial, o Bearer
  de `CRON_SECRET` não é tratado como JWT de usuário;
- utilitários `obterEmpresaIdDoContexto` e `validarEmpresaDoRecurso` preparados
  para o isolamento das queries dos módulos de negócio.

Validações locais:

- 23 verificações unitárias aprovadas;
- token legado resolve `Lojas Variara`;
- troca de empresa emite JWT contextual;
- tipos do novo token vêm do vínculo empresarial;
- tentativa de troca para empresa sem vínculo é bloqueada;
- módulo não migrado é bloqueado para empresa secundária;
- rota não mapeada é bloqueada para empresa secundária;
- empresa legada mantém o comportamento atual;
- token inválido é rejeitado;
- fluxo aprovado por `api/index.js`;
- fluxo aprovado pelo `server.js` usado na Vercel;
- `npm run typecheck`: aprovado;
- `npm run build`: aprovado;
- banco temporário encerrado e removido;
- backup pré-multiempresa preservado.

### Validação em produção

Publicada no commit `ab61bbd` e validada em 2026-07-28:

- deployment Vercel concluído com status `success`;
- `/api/ping` respondeu normalmente;
- `/api/contexto-empresa` sem token respondeu `401`;
- login e contexto de `Lojas Variara` aprovados pelo responsável;
- nenhuma empresa secundária real foi liberada.

**Fase 2 concluída em produção em 2026-07-28.**

## Fase 3 — Login e sessão

### Entregas

- empresa principal no login;
- novo JWT com contexto;
- renovação do token ao trocar;
- `/api/usuarios/me` contextual;
- logout e impersonação ajustados;
- tratamento de usuário sem vínculo.

### Critério de conclusão

- usuário com uma empresa entra diretamente;
- usuário com várias empresas entra na principal;
- troca não exige novo login;
- impersonação respeita empresa e vínculo.

### Implementação local

Implementada em 2026-07-28:

- login resolve o vínculo principal ativo no banco;
- JWT novo inclui `empresa_id`, `vinculo_empresa_id`, tipos do vínculo e estado
  de superadministrador;
- resposta do login já informa a empresa ativa;
- opção “manter conectado” continua emitindo sessão de 30 dias;
- troca de empresa preserva o prazo restante do token e nunca prolonga a
  sessão;
- `GET /api/usuarios/me` retorna tipos, nível e permissões do vínculo da empresa
  ativa;
- `/api/usuarios/me` retorna também `empresa_ativa`,
  `vinculo_empresa_id`, `empresa_id` e `superadministrador`;
- usuário com várias empresas entra diretamente na principal;
- usuário sem empresa ativa recebe `SEM_EMPRESA_ATIVA`;
- desligamento específico do vínculo continua retornando
  `CONTRATO_ENCERRADO`, preservando a tela de despedida;
- identidade global arquivada recebe `CONTA_INATIVA`;
- impersonação só encontra o usuário-alvo dentro da empresa ativa e emite token
  com o mesmo contexto empresarial;
- permissões de `/usuarios/me`, status, foto oficial e impersonação já podem ser
  calculadas pelo vínculo empresarial;
- contexto visual local é separado entre sessão normal e impersonação;
- logout e expiração limpam os caches locais de empresa.

Validação local em restauração integral do backup:

- 18 cenários de login, sessão, vínculo, troca e isolamento aprovados;
- token anterior à multiempresa continua compatível;
- tipos legados diferentes dos tipos do vínculo não vazam para o token novo;
- login com duas empresas escolhe a principal;
- perfil contextual aprovado na empresa principal e na secundária fictícia;
- impersonação contextual aprovada;
- empresa sem vínculo e usuário sem empresa bloqueados;
- vínculo desligado preserva o fluxo de despedida;
- módulo não migrado e rota futura bloqueados para empresa secundária;
- nenhum dado fictício gravado na Neon;
- banco temporário e servidor temporário encerrados e removidos;
- backup pré-multiempresa preservado.

### Validação em produção

- login anterior e novo login validados pelo responsável;
- sessão contextual de `Lojas Variara` operando normalmente;
- Financeiro e Central de Pagamentos abriram sem regressão aparente;
- nenhum erro crítico foi relatado no smoke test.

**Fase 3 concluída em produção em 2026-07-28.**

## Fase 4 — Seletor universal

### Entregas

- seletor desktop no menu;
- seletor tablet/mobile próximo ao hamburger;
- bottom sheet de empresas;
- limpeza de cache e reload;
- identificação da empresa na dashboard.

### Critério de conclusão

- empresa ativa sempre identificável;
- troca funcional em PC, tablet e celular;
- empresa não autorizada não pode ser selecionada.

### Registro de execução

#### Etapa 4.1 — Auditoria e desenho

Iniciada em 2026-07-28:

- o menu administrativo é injetado universalmente por
  `public/js/carregar-menu-lateral.js`;
- o template compartilhado fica em `public/admin/menu-lateral.html`;
- os estilos isolados ficam em `public/css/menu-lateral.css`;
- esses três arquivos estavam limpos no Git antes da edição e foram adicionados
  à lista branca multiempresa;
- `public/css/global-style.css` possui alterações paralelas e permanecerá
  intocado;
- `public/js/utils/menu-hamburguer.js` não será alterado porque a inicialização
  efetiva do menu já é feita pelo carregador compartilhado;
- no PC, o seletor completo ficará dentro do menu lateral, entre o perfil e a
  navegação;
- em tablet e celular, um identificador compacto ficará ao lado do hamburger;
- a lista de empresas será aberta em diálogo compacto no PC/tablet e em bottom
  sheet no celular;
- ambos os gatilhos usarão o mesmo estado e o mesmo endpoint;
- nomes de empresa serão inseridos com `textContent`, sem interpolação de HTML;
- a troca chamará `POST /api/contexto-empresa/trocar`, substituirá somente o
  token da sessão correspondente, limpará caches empresariais e recarregará a
  página;
- nenhuma empresa será confiada a partir do cache local; a lista e a autorização
  virão sempre do backend;
- nenhum arquivo do Financeiro será alterado.

#### Etapa 4.2 — Implementação local

Concluída em 2026-07-28:

- o menu lateral passou a exibir a empresa ativa entre o perfil do usuário e a
  navegação;
- um seletor compacto foi adicionado ao lado do hamburger em telas de até
  1024 px;
- o seletor compacto é ocultado enquanto o menu lateral está aberto, evitando
  sobreposição;
- PC e tablet usam diálogo centralizado;
- celular com até 480 px usa bottom sheet ancorado ao rodapé;
- os dois gatilhos compartilham o mesmo estado, a mesma lista e a mesma ação de
  troca;
- a lista é obtida por `GET /api/contexto-empresa`;
- a troca usa `POST /api/contexto-empresa/trocar`;
- o novo token substitui somente o token da sessão correspondente, inclusive no
  fluxo de impersonação;
- caches conhecidos que podem carregar dados empresariais são limpos antes do
  reload;
- a página é recarregada após a troca para impedir a permanência de estado da
  empresa anterior;
- nomes, siglas e textos vindos do backend são renderizados com `textContent`;
- opções possuem área de toque de 68 px e o gatilho compacto possui 44 px;
- nenhuma mudança foi feita em `global-style.css` ou nos arquivos do
  Financeiro.

Arquivos funcionais alterados nesta etapa:

```text
public/admin/menu-lateral.html
public/css/menu-lateral.css
public/js/carregar-menu-lateral.js
```

Foi criada temporariamente uma ferramenta local para montar dados descartáveis
de teste sem alterar a Neon. Ela foi removida após a validação para não
versionar credenciais e cadastros fictícios.

#### Etapa 4.3 — Validação funcional e visual

Executada em 2026-07-28 com PostgreSQL local restaurado, API local e Vite local:

- login contextual realizado com um usuário descartável vinculado a duas
  empresas;
- PC validado em 1440 × 900;
- tablet validado em 900 × 1100;
- celular validado em 390 × 844;
- seletor completo aprovado no menu lateral do PC;
- seletor compacto aprovado ao lado do hamburger no tablet e celular;
- ocultação do seletor compacto durante a abertura do menu confirmada;
- diálogo central aprovado em PC e tablet;
- bottom sheet aprovado no celular;
- nenhuma rolagem horizontal causada pelo seletor;
- gatilho móvel medido com 44 px de altura;
- opções móveis medidas com 68 px de altura;
- troca real de `Lojas Variara` para a empresa fictícia `Fábrica Aurora`
  aprovada;
- interface recarregada com nome e sigla da nova empresa;
- módulo legado respondeu `403` sob a empresa secundária, confirmando o
  bloqueio seguro preparado na Fase 2;
- retorno para `Lojas Variara` aprovado;
- `npm run build` aprovado;
- `npm run typecheck` aprovado;
- erros antigos de sintaxe em `arremates.css` e `dashboard.css` corrigidos antes
  da publicação;
- nenhum dado fictício foi enviado à Neon;
- portas locais 3210, 4173 e 55434 encerradas;
- banco, logs e configuração Vite descartáveis removidos;
- backup pré-multiempresa preservado.

#### Etapa 4.4 — Smoke test em produção

Concluída em 2026-07-28:

- deployment associado ao commit `8699331` confirmado como Production/success;
- tela de login carregada pela URL publicada;
- seletor de empresa e contexto de `Lojas Variara` validados pelo responsável;
- Financeiro e Central de Pagamentos aprovados no teste manual;
- nenhuma empresa secundária real disponível;
- nenhum erro crítico relatado.

**Fase 4 concluída em produção em 2026-07-28.**

## Fase 5 — Gestão Organizacional

### Entregas

- nova página e rota;
- abas Pessoas e Acessos / Empresas;
- cadastro e edição de empresa;
- criação de pessoa e vínculo;
- vínculo de pessoa existente;
- cards contextuais;
- compatibilidade com URL antiga;
- permissões novas.

### Critério de conclusão

- empresas administráveis pela interface;
- usuários vinculáveis a múltiplas empresas;
- desligamento ocorre por vínculo;
- layout validado em tablet e celular.

### Registro de execução

#### Etapa 5.1 — Auditoria e contratos

Concluída em 2026-07-28:

- `usuarios` foi mantida como identidade e credencial global;
- `usuarios_empresas` passou a ser a autoridade dos vínculos empresariais;
- foi definido que encerrar um vínculo não arquiva a identidade nem encerra os
  demais vínculos;
- os campos legados de `usuarios` só são sincronizados quando a alteração
  pertence à empresa marcada como `eh_legada`, impedindo que uma empresa
  secundária contamine módulos ainda não migrados;
- a URL oficial definida foi
  `/admin/gestao-organizacional.html`;
- `/admin/usuarios-cadastrados.html` foi preservada como URL compatível e monta
  a mesma aplicação;
- o prefixo `GO*` foi adotado para os novos componentes React;
- nenhuma tabela nova foi necessária porque a fundação da Fase 1 já continha
  todos os campos de empresa e vínculo exigidos.

#### Etapa 5.2 — Backend

Implementação local concluída em 2026-07-28:

- criado `api/gestao-organizacional.js`;
- criada listagem de empresas com totais de membros e gestores;
- criada inclusão e edição de perfis empresariais;
- novas empresas recebem registros em `empresas_modulos`, com somente Gestão
  Organizacional liberada quando o módulo estiver marcado como pronto;
- criada listagem de pessoas no contexto atual e na visão global;
- criada inclusão de identidade global com vínculo inicial;
- criada edição separada da identidade global;
- criada inclusão e edição de vínculos em empresas adicionais;
- criado encerramento de vínculo sem arquivamento da identidade;
- troca de empresa principal é transacional e mantém uma principal quando há
  vínculo ativo disponível;
- código, CNPJ, CEP, UF, cor, funções, permissões e valores financeiros são
  normalizados e validados no backend;
- a nova rota foi montada em `server.js` e `api/index.js`;
- o contexto empresarial passou a mapear `/gestao-organizacional` para o módulo
  `gestao-organizacional`.

#### Etapa 5.3 — Frontend

Implementação local concluída em 2026-07-28:

- criada a página React `GestaoOrganizacionalPage`;
- criadas as abas `Pessoas e Acessos` e `Empresas`;
- criados cards de pessoas com destaque por empresa, empresa principal,
  funções, admissões e permissões adicionais;
- criados cards de empresas com cor, identidade, membros, gestores e prefixo de
  OP;
- criados formulários de identidade, vínculo e perfil empresarial;
- permissões individuais por vínculo ficam em seção expansível pesquisável;
- ações permanecem visíveis e usam `UIBloqueio`;
- encerramento de vínculo usa confirmação explícita e informa que outros
  vínculos serão preservados;
- o menu foi renomeado para Gestão Organizacional e aponta para a nova URL;
- implementado layout tablet-first, card em duas colunas no tablet e uma coluna
  no celular;
- modais usam bottom sheet no celular, rolagem interna e rodapé de ações fixo;
- campos de senha usam `autocomplete="new-password"` para reduzir
  preenchimento automático indevido.

#### Etapa 5.4 — Permissões

Implementação local concluída em 2026-07-28:

- `acesso-gestao-organizacional`;
- `visualizar-empresas`;
- `gerenciar-empresas`;
- `vincular-usuarios-empresas`;
- `visualizar-todas-empresas`;
- a permissão legada `acesso-usuarios-cadastrados` permanece aceita para acesso
  à página durante a transição;
- administradores recebem as novas permissões pelo catálogo completo;
- supervisores recebem acesso e visualização de empresas por padrão.

#### Etapa 5.5 — Validação local e somente leitura

Concluída em 2026-07-28:

- `node --check api/gestao-organizacional.js`: aprovado;
- `npm run typecheck`: aprovado;
- `npm run build`: aprovado;
- build reconheceu as duas URLs da Gestão Organizacional;
- interface validada com dados simulados, sem escrita na Neon;
- aba Pessoas e Acessos validada;
- aba Empresas validada;
- modal de empresa validado;
- modal de pessoa e vínculo validado;
- layout celular validado visualmente;
- layout tablet em 1024 × 768 validado visualmente;
- smoke real somente leitura executado contra a Neon;
- `GET /api/gestao-organizacional/empresas`: `200`, uma empresa;
- `GET /api/gestao-organizacional/pessoas?escopo=atual`: `200`, 15 identidades
  visíveis depois da exclusão correta de testes e arquivados;
- `GET /api/gestao-organizacional/pessoas?escopo=global`: `200`, 15 identidades;
- nenhuma rota de escrita foi executada na Neon;
- servidores locais antigos encontrados durante o teste foram identificados e
  encerrados.

#### Etapa 5.6 — Migration de liberação do módulo

Executada e validada na Neon em 2026-07-28:

```text
_planejamento/migration-multiempresas-fase5-gestao-organizacional.sql
_planejamento/validacao-multiempresas-fase5-gestao-organizacional.sql
```

A migration:

- marca `gestao-organizacional` como `multiempresa_pronto`;
- habilita o módulo em todas as empresas ativas;
- registra a execução em `sistema_migrations`;
- contém guardas que abortam a transação se o módulo ou alguma empresa ativa
  ficar inconsistente;
- não possui comentários, para compatibilidade com a execução pela Neon.

O arquivo de validação retorna `aprovado: true`, confirma o módulo pronto,
compara empresas ativas com empresas habilitadas e confirma o registro em
`sistema_migrations`.

Resultado confirmado:

```json
{
  "aprovado": true,
  "modulo_pronto": true,
  "empresas_ativas": 1,
  "empresas_ativas_habilitadas": 1,
  "migration_registrada": true
}
```

#### Etapa 5.7 — Commit e publicação

Concluída em 2026-07-28:

- commit seletivo criado: `46faaca`;
- mensagem: `feat(multiempresa): implementar gestao organizacional`;
- push para `origin/main` confirmado;
- deployment de Production criado na Vercel a partir do commit `46faaca`;
- Vercel confirmou o commit como publicado em produção;
- nenhum arquivo alheio ao escopo foi incluído no commit;
- changelog administrativo preparado em correção complementar como versão
  `1.36.0`, sem incremento da versão da dashboard.

#### Etapa 5.8 — Smoke test final em produção

Concluída em 2026-07-28:

- release complementar `1.36.0` publicada na Vercel;
- seletor universal de empresa aprovado;
- página Gestão Organizacional acessível pelo menu;
- abas Pessoas e Acessos / Empresas carregando corretamente;
- cards de pessoas e da empresa `Lojas Variara` carregando;
- changelog administrativo `1.36.0` visível;
- funcionamento geral aprovado pelo responsável;
- nenhum erro funcional relatado.

**Fase 5 concluída e validada em produção em 2026-07-28.**

### Correções pós-publicação — bloco 1

Implementadas localmente em 2026-07-28:

- abas corrigidas com a classe global `gs-tab-btn`; o `global-style.css` já
  estava vinculado corretamente;
- código interno da empresa passou a ser gerado automaticamente a partir do
  nome fantasia;
- espaços e separadores viram hífens, acentos são removidos e o resultado usa
  apenas letras minúsculas e números;
- o backend é a autoridade da geração do código e bloqueia códigos repetidos;
- o código existente permanece imutável na edição da empresa;
- contexto do cabeçalho passou a exibir nome fantasia e código interno em linhas
  separadas;
- seção de antigos membros foi renomeada para identificar ex-empregados da
  empresa consultada;
- cards passaram a mostrar admissão, demissão, nível, salário, situação de
  pagamento e prestação freelance conforme o vínculo;
- históricos de desligamento ficam abertos por padrão quando a pessoa não
  possui vínculo ativo;
- ação Encerrar foi convertida visualmente em Demitir;
- a demissão usa obrigatoriamente a data corrente do backend no fuso
  `America/Sao_Paulo`;
- o vínculo é desativado e recebe a data de demissão na mesma transação;
- na empresa legada, a data continua sincronizada com `usuarios`, preservando a
  compatibilidade temporária;
- vínculos com outras empresas e a identidade de login continuam preservados;
- nenhuma migration de banco é necessária para este bloco;
- `node --check api/gestao-organizacional.js`, `npm run typecheck`,
  `npm run build` e `git diff --check` aprovados.

**Pendente:** validação visual/manual e teste funcional controlado antes da
publicação.

### Correções pós-publicação — bloco 2

Implementadas localmente em 2026-07-28:

- divergência no total de membros da `Lojas Variara` investigada diretamente na
  Neon, somente em leitura;
- causa confirmada: o vínculo ativo de `Funcionário Teste`, marcado com
  `is_test = true`, era somado pelo card da empresa, embora a listagem de pessoas
  já o excluísse;
- consulta antiga confirmada com 7 vínculos ativos, sendo 1 teste;
- nova regra confirmada com 6 membros reais;
- totais de membros e gestores agora excluem usuários de teste e arquivados;
- sócios deixaram de receber a ação Demitir;
- vínculos societários usam Registrar saída, Saída da empresa e Ex-sócio;
- vínculos empregatícios continuam usando Demitir, Demissão e Ex-empregado;
- agrupamentos históricos alternam entre Ex-empregados, Ex-sócios e
  Ex-integrantes conforme os registros exibidos;
- edição separada da identidade foi removida dos cards;
- Editar vínculo passou a abrir dados pessoais, login, funções, permissões,
  datas e dados financeiros no mesmo modal;
- identidade global e vínculo empresarial são atualizados na mesma transação;
- históricos encerrados também podem ser consultados e editados pelo editor
  unificado;
- datas devolvidas pela Neon são normalizadas para `YYYY-MM-DD` antes de
  preencher inputs e formatar cards;
- criado `GOIdentidadeCampos.jsx` para compartilhar os campos de identidade
  entre cadastro e edição;
- nenhuma migration de banco é necessária para este bloco;
- `node --check api/gestao-organizacional.js`, `npm run typecheck`,
  `npm run build` e `git diff --check` aprovados.

**Pendente:** validação visual/manual e teste funcional controlado antes da
publicação.

### Correções pós-publicação — bloco 3

Implementadas localmente em 2026-07-28:

- vínculos com `socio` ou `ex_socio` passaram a exibir Início da sociedade no
  lugar de Admissão;
- o campo técnico `data_admissao` continua sendo reutilizado como data inicial
  do vínculo societário;
- mensagens de validação societária também usam início da sociedade e saída da
  empresa;
- regra de Administrador confirmada em `permissoes.js`, `auth.js` e
  `api/usuarios.js`: o tipo recebe automaticamente todo o catálogo de
  permissões;
- cards de administradores deixaram de mostrar quantidade de permissões
  adicionais e exibem Possui todas as permissões;
- seletor de permissões individuais foi removido do editor quando o vínculo
  possui o tipo Administrador;
- ao selecionar Administrador, permissões adicionais do formulário são
  descartadas;
- o backend grava `permissoes = []` para administradores porque o acesso total é
  derivado do tipo;
- a API também representa administradores com lista adicional vazia, evitando
  exibir dados legados redundantes;
- nenhuma migration de banco é necessária para este bloco;
- `node --check api/gestao-organizacional.js`, `npm run typecheck`,
  `npm run build` e `git diff --check` aprovados.

**Pendente:** conferência visual/manual antes da publicação.

### Correções pós-publicação — bloco 4

Implementadas localmente em 2026-07-28:

- sócios deixaram de possuir salário fixo na Gestão Organizacional;
- cards e formulários societários passaram a comunicar remuneração variável por
  retiradas e distribuições da sociedade;
- ao salvar vínculo societário, o backend normaliza `salario_fixo` para zero;
- prestadores externos e freelancers passaram a ter início e fim da prestação
  de serviços no lugar de admissão e demissão;
- prestadores não possuem salário fixo, INSS ou desconto de VT; esses campos são
  ocultados no formulário e normalizados para zero pelo backend;
- passagem diária permanece disponível e opcional para prestadores;
- permissões individuais permanecem disponíveis para prestadores, incluindo
  acessos à dashboard conforme o catálogo existente;
- o encerramento desse tipo de vínculo usa Encerrar prestação e preserva login
  e demais vínculos;
- cards e históricos distinguem Ex-prestador de Ex-empregado e Ex-sócio;
- o componente compartilhado `GOVinculoCampos` passou a derivar as regras
  diretamente dos tipos selecionados;
- cadastro inicial, criação de vínculo com outra empresa e edição agora exibem
  exatamente os mesmos campos e adaptações por tipo;
- nenhuma migration de banco é necessária para este bloco;
- `node --check api/gestao-organizacional.js`, `npm run typecheck`,
  `npm run build` e `git diff --check` aprovados.

**Pendente:** conferência visual/manual antes da publicação.

### Correções pós-publicação — bloco 5

Implementadas localmente em 2026-07-28:

- o fluxo Vincular a outra empresa passou a oferecer cópia opcional de
  permissões de um vínculo ativo já existente;
- o operador escolhe a empresa de origem;
- a empresa principal da pessoa é sugerida como origem inicial;
- existem três modos explícitos: Não copiar, Copiar todas e Escolher algumas;
- no modo seletivo, somente permissões existentes no vínculo de origem são
  oferecidas para seleção;
- vínculos de origem com tipo Administrador são interpretados com todo o
  catálogo de permissões, embora armazenem a lista adicional vazia;
- se o novo vínculo também for Administrador, o bloco de cópia é ocultado porque
  o acesso total já é derivado do tipo;
- a seleção final continua disponível no editor de permissões individuais para
  conferência e ajustes;
- as permissões são enviadas no mesmo `POST` do novo vínculo e persistidas
  diretamente em `usuarios_empresas.permissoes`;
- nenhuma migration ou endpoint adicional é necessário;
- `node --check api/gestao-organizacional.js`, `npm run typecheck`,
  `npm run build` e `git diff --check` aprovados.

**Pendente:** conferência visual/manual antes da publicação.

## Fase 6 — Financeiro como piloto

### Escopo inicial a confirmar na auditoria

- `fc_contas_bancarias`;
- `fc_grupos_financeiros`;
- `fc_categorias`;
- `fc_contatos`;
- `fc_lancamentos`;
- `fc_lancamento_itens`;
- `fc_contas_agendadas`;
- `fc_contas_agendadas_itens`;
- `fc_lotes_agendamento`;
- `fc_solicitacoes_alteracao`;
- `fc_logs_auditoria`;
- notificações;
- `config_concessionarias_vt`;
- integrações com pagamentos.

### Critério de conclusão

- listas, detalhes, inserts, updates e deletes isolados;
- contas, categorias, contatos e relatórios isolados;
- pagamentos usam o contato do vínculo empresarial;
- testes automatizados de acesso cruzado aprovados;
- segunda empresa liberada para o Financeiro.

### Estado executivo em 29/07/2026

- migration de preparação e backfill executados;
- isolamento do código publicado no commit `5ef2096` e aprovado em smoke;
- teste transacional aprovado em sete de sete cenários, com `ROLLBACK`;
- migration de finalização executada e validada com 13 colunas empresariais
  obrigatórias, 31 constraints empresariais validadas e zero constraints
  legados;
- migration separada de liberação da Neila Confecções e seu validador
  executados com `aprovado: true`;
- Neila Confecções está habilitada e iniciou com zero registros financeiros;
- teste manual aprovado nas duas empresas, incluindo escritas, troca de contexto
  e console sem erros;
- correção final do agente global publicada na release `1.38.0`, commit
  `919de6d`; smoke autenticado final pendente.

## Fase 7 — Empregados, dashboard e pagamentos

### Escopo

- ponto;
- produção individual;
- metas;
- ranking;
- comissões;
- benefícios;
- vale-transporte;
- calendário;
- gincanas;
- perfil e conquistas;
- avisos empresariais.
- dashboard.

### Ordem aprovada

A dashboard das costureiras será a última frente funcional da Fase 7. Primeiro
serão isolados os domínios de vínculo empresarial, ponto, pagamentos e seus
consumidores. A dashboard será conectada aos contratos já estabilizados no fim
da fase, junto de seu redesign completo mobile-first.

### Critério de conclusão

- dashboard e pagamentos isolados;
- desligamento em uma empresa não encerra outro vínculo;
- impersonação e uso mobile validados.

### Dependência da dashboard em empresas secundárias

A dashboard completa depende dos domínios de produção e arremates para pontos,
atividades, desempenho, status ao vivo, ranking e projeções. Habilitar somente o
módulo `dashboard` não é suficiente. Produção e arremates devem ser migrados e
validados primeiro; até lá, os endpoints permanecem fechados com
`CADEIA_PRODUTIVA_NAO_MIGRADA`. A dashboard da empresa legada pode operar sem
essa liberação secundária. A liberação completa em empresas secundárias pertence
à Fase 8 e não faz parte do ciclo atual.

## Fase 8 — OPs e cadeia produtiva

### Ordem

```text
Empresa
→ Produtos
→ Demandas
→ Ordens de Produção
→ Cortes
→ Produção
→ Arremates
→ Embalagem
→ Estoque
```

### Numeração aprovada

O número da OP será único por empresa, com destino `(empresa_id, numero)`.

### Critério de conclusão

- ciclo produtivo completo isolado;
- nenhum relacionamento cruza empresas;
- agentes, contadores e relatórios respeitam a empresa ativa.

## Fase 9 — Demais módulos

Migrar, módulo a módulo:

- Calendário;
- Alertas e Avisos Popup;
- Incentivos;
- Central de Pagamentos;
- Gerenciar Produção;
- Produção Geral;
- Estoque;
- Embalagem;
- Home/Admin;
- auditoria;
- relatórios e ferramentas restantes.

Cada módulo só será liberado para empresa secundária depois de passar pelo checklist de isolamento.

## Fase 10 — Permissões por empresa

### Entregas

- tipos e permissões obtidos do vínculo atual;
- `localStorage.permissoes` atualizado na troca;
- editor de permissões contextual;
- acessos diferentes por empresa;
- separação explícita de permissões verdadeiramente globais.

### Critério de conclusão

- permissões não vazam entre vínculos;
- frontend e backend usam o vínculo atual.

## Fase 11 — Segurança, testes e desempenho

### Matriz mínima por domínio

- listagem;
- busca por ID;
- criação;
- edição;
- exclusão;
- relacionamentos;
- relatórios;
- auditoria;
- empresa inativa;
- vínculo inativo;
- token/contexto inválido;
- troca de empresa;
- impersonação.

### Desempenho

Revisar índices compostos, conforme cada consulta:

```sql
(empresa_id, id)
(empresa_id, status)
(empresa_id, data)
(empresa_id, usuario_id)
```

### Critério de conclusão

- testes de isolamento aprovados;
- consultas críticas sem regressão relevante;
- logs identificam empresa, usuário e vínculo.

## Fase 12 — Limpeza e ativação definitiva

### Entregas

- remoção de campos empresariais legados de `usuarios`;
- remoção de fallbacks temporários;
- `empresa_id` obrigatório;
- limpeza de rotas e componentes transitórios;
- atualização final do `AGENTS.md`;
- ativação gradual da segunda empresa.

### Sequência de ativação

1. criar e validar backup completo da produção;
2. restaurar o backup em PostgreSQL local temporário;
3. executar e validar a migration no banco local restaurado;
4. obter autorização explícita para a execução em produção;
5. executar a migration em produção e rodar o validador imediatamente;
6. manter a produção operando somente com a empresa atual;
7. cadastrar a segunda empresa;
8. liberar o Financeiro;
9. liberar a cadeia produtiva;
10. liberar os módulos restantes;
11. remover as travas transitórias.

---

## Checklist de acompanhamento

- [x] Fase 0 — Auditoria e desenho definitivo
- [x] Fase 1 — Fundação do banco
- [x] Fase 2 — Contexto empresarial no backend
- [x] Fase 3 — Login e sessão
- [x] Fase 4 — Seletor universal
- [x] Fase 5 — Gestão Organizacional
- [x] Fase 6 — Financeiro como piloto
- [x] Fase 7 — Empregados, dashboard e pagamentos
- [ ] Fase 8 — OPs e cadeia produtiva
- [ ] Fase 9 — Demais módulos
- [ ] Fase 10 — Permissões por empresa
- [ ] Fase 11 — Segurança, testes e desempenho
- [ ] Fase 12 — Limpeza e ativação definitiva

---

## Estado atual

**Fase em andamento:** Fase 8 — OPs e cadeia produtiva. Ela não faz parte do
escopo deste ciclo.

**Checkpoint atual:** Fases 0–7 concluídas e aprovadas dentro do escopo atual.
A dashboard da Fase 7 foi publicada e aprovada em smoke autenticado; a
preparação estrutural foi executada e validada na Neon.

**Próxima frente funcional:** Fase 8, quando for retomada pelo usuário, para
migrar a cadeia produtiva e permitir a futura liberação da dashboard completa
em empresas secundárias.

**Situação operacional:** o sistema publicado possui infraestrutura
multiempresa e o Financeiro foi liberado para Lojas Variara e Neila Confecções;
os demais módulos de negócio continuam bloqueados na empresa secundária.

**Última atualização:** 2026-08-01.

**Banco alterado:** sim. Fundação multiempresa, schema financeiro final e
preparação estrutural da Fase 7 executados e validados em produção.

**Empresa secundária liberada:** sim, somente no Financeiro.

**Empresa inicial confirmada:** `Lojas Variara` (`lojas-variara`).

**Estratégia de ambiente:** staging abandonado; ensaio local restaurado e
validado antes de execução direta em produção.

### Checkpoint de publicação das Fases 2–4

Preparado em 2026-07-28 após a conclusão dos ajustes paralelos:

| Ordem | Commit | Conteúdo |
|---|---|---|
| 1 | `c31bbc8` | Financeiro e Central de Pagamentos em React/TypeScript |
| 2 | `7c6a64c` | Correções de CSS e criação de OP vinculada |
| 3 | `ab61bbd` | Contexto, sessão e seletor universal multiempresa |
| 4 | `8699331` | Migração da documentação permanente para `AGENTS.md` |

Validação do `HEAD` completo:

- `npm run typecheck`: aprovado;
- `npm run build`: aprovado, sem avisos de sintaxe CSS;
- 23 verificações unitárias do contexto empresarial: aprovadas;
- integridade do repositório com `git fsck --no-dangling`: aprovada;
- worktree versionado: limpo;
- `_backups/` e `_planejamento/`: preservados localmente e ignorados;
- push e deploy: ainda não realizados;
- Fase 5: iniciada somente depois da publicação e do smoke test deste checkpoint,
  conforme planejado.

Ordem de publicação:

1. enviar os quatro commits juntos para `origin/main`;
2. aguardar o único deploy correspondente na Vercel;
3. confirmar login com token anterior ao deploy;
4. confirmar login novo e identificação de `Lojas Variara`;
5. abrir Financeiro e Central de Pagamentos;
6. confirmar o seletor universal em PC e tablet/celular;
7. validar `GET /api/contexto-empresa`;
8. confirmar que não há empresa secundária real liberada;
9. somente após o smoke test iniciar a Fase 5 — cumprido em 2026-07-28.

### Backup pré-multiempresa

Backup lógico completo criado antes de qualquer migration:

```text
_backups/sistema-lv-pre-multiempresa-20260728-164846.dump
```

Validação:

- formato: PostgreSQL custom;
- `pg_dump`: PostgreSQL 17.10;
- compressão: gzip;
- tamanho: 4.043.056 bytes (3,86 MB);
- entradas de catálogo lidas: 796;
- SHA-256: `552AD15BF2CBEC0751C6579ABBF1CBA1D95FEA2B6BA7541D29BD9A743F95CE08`;
- catálogo validado com `pg_restore --list`;
- restauração integral executada com sucesso em PostgreSQL 17.10 temporário e local;
- comparação com a origem PostgreSQL 15.18: 75/75 tabelas e 124.779/124.779 linhas;
- hashes de conteúdo por tabela: correspondência exata, zero divergências;
- catálogo, constraints, índices e sequências: correspondência exata;
- constraints não validadas e índices inválidos no restaurado: zero;
- ambiente restaurado usado somente para validação e removido após o teste;
- `_backups/` incluído no `.gitignore` por conter dados sensíveis.

---

## Diário de decisões

| Data | Decisão | Estado |
|---|---|---|
| 2026-07-27 | Adotar arquitetura multiempresas no banco atual | Aprovado |
| 2026-07-27 | Separar identidade (`usuarios`) de vínculo (`usuarios_empresas`) | Aprovado |
| 2026-07-27 | Transportar empresa ativa no JWT e renovar token na troca | Aprovado |
| 2026-07-27 | Criar seletor responsivo no menu compartilhado | Aprovado |
| 2026-07-27 | Substituir Usuários Cadastrados por Gestão Organizacional com duas abas | Aprovado |
| 2026-07-27 | Usar Financeiro como primeiro módulo piloto | Aprovado |
| 2026-07-27 | Bloquear módulos ainda não migrados para empresas secundárias | Aprovado |
| 2026-07-27 | Criar e validar backup completo antes da primeira migration | Concluído |
| 2026-07-28 | Concluir Fase 0 após auditoria, decisões e restauração do backup | Concluído |
| 2026-07-28 | Numeração de OP será única por empresa | Aprovado |
| 2026-07-28 | Produtos, matérias-primas, contatos e fornecedores serão empresariais | Aprovado |
| 2026-07-28 | Superadministrador será global e separado dos vínculos empresariais | Aprovado |
| 2026-07-28 | Concluir implementação e validação local do seletor universal | Concluído localmente |
