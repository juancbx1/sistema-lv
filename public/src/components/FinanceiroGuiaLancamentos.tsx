import { useMemo, useState } from 'react';

interface GuiaPasso {
  titulo: string;
  detalhe: string;
}

interface GuiaTopico {
  id: string;
  titulo: string;
  shortLabel: string;
  icon: string;
  tone: string;
  quandoUsar: string;
  passos: GuiaPasso[];
  errosComuns: GuiaPasso[];
  dica: string;
}

const GUIA_GERAL = {
  titulo: 'Como lançar do jeito certo',
  texto:
    'Tudo o que entra ou sai do caixa da empresa vira um lançamento. Escolha o tipo certo (simples, compra, rateio, transferência…) para o saldo e os relatórios ficarem corretos. Na dúvida entre “excluir” e “estornar”: se o dinheiro saiu de verdade e voltou, use estorno; se o lançamento nunca deveria ter existido, exclua.',
  hint: 'Toque em um assunto acima (Simples, Rateio, Estorno…) para ver o passo a passo só daquele caso.',
};

const TOPICOS: GuiaTopico[] = [
  {
    id: 'SIMPLES',
    titulo: 'Lançamento simples (gasto ou receita)',
    shortLabel: 'Simples',
    icon: 'fa-receipt',
    tone: 'simples',
    quandoUsar:
      'Um único valor, uma categoria, um favorecido. Ex.: aluguel, frete avulso, venda simples, reembolso único.',
    passos: [
      {
        titulo: '1. Abra o botão de novo lançamento (+)',
        detalhe: 'No canto da tela de Financeiro, toque no botão flutuante de novo lançamento.',
      },
      {
        titulo: '2. Aba “Simples”',
        detalhe: 'Escolha se é DESPESA (saiu dinheiro) ou RECEITA (entrou dinheiro).',
      },
      {
        titulo: '3. Preencha os campos',
        detalhe:
          'Valor, data, conta bancária, categoria e descrição. Favorecido (quem recebeu ou pagou) quando souber.',
      },
      {
        titulo: '4. Salve',
        detalhe:
          'Se a data for “especial” e você não tiver liberação total, o sistema pode pedir aprovação do gerente antes de valer no saldo.',
      },
    ],
    errosComuns: [
      {
        titulo: 'Categoria errada',
        detalhe: 'Escolha a categoria que o relatório e o DRE vão usar. “Outros” só quando realmente não encaixa.',
      },
      {
        titulo: 'Conta bancária errada',
        detalhe: 'O saldo da conta muda. Confira se é a conta de onde o dinheiro saiu/entrou de verdade.',
      },
      {
        titulo: 'Data errada',
        detalhe: 'Use a data do movimento no extrato, não a data em que você está digitando (salvo se for o mesmo dia).',
      },
    ],
    dica: 'Se a compra tem vários itens ou categorias, não force no simples — use Compra ou Rateio.',
  },
  {
    id: 'COMPRA',
    titulo: 'Compra detalhada',
    shortLabel: 'Compra',
    icon: 'fa-basket-shopping',
    tone: 'compra',
    quandoUsar:
      'Nota ou compra com vários produtos/linhas: quantidade × valor unitário, com desconto opcional no total. Tudo sai da mesma conta e em geral do mesmo fornecedor.',
    passos: [
      {
        titulo: '1. Novo lançamento → aba “Compra”',
        detalhe: 'Informe data, conta, fornecedor (favorecido) e uma descrição geral da compra.',
      },
      {
        titulo: '2. Adicione as linhas',
        detalhe:
          'Cada item: descrição, quantidade, valor unitário e categoria daquele item. O sistema multiplica qtd × unitário.',
      },
      {
        titulo: '3. Desconto (se houver)',
        detalhe: 'Informe o desconto no total da compra. O valor final = soma dos itens − desconto.',
      },
      {
        titulo: '4. Confira o total e salve',
        detalhe: 'O card do lançamento mostra o valor final. Use “Detalhes” no card para ver as linhas depois.',
      },
    ],
    errosComuns: [
      {
        titulo: 'Usar compra quando era só um valor solto',
        detalhe: 'Um frete único sem itens? Simples basta e é mais rápido.',
      },
      {
        titulo: 'Esquecer o desconto',
        detalhe: 'Se a nota deu desconto e você não lançou, o saldo fica maior que o extrato.',
      },
      {
        titulo: 'Categoria só no “pai” e nenhuma nas linhas',
        detalhe: 'Na compra, a categoria importa em cada item — preencha todas as linhas.',
      },
    ],
    dica: 'Compra = “lista de produtos da nota”. Rateio = “dividir um gasto em pedaços por categoria/área”, sem qtd × unitário.',
  },
  {
    id: 'RATEIO',
    titulo: 'Rateio detalhado',
    shortLabel: 'Rateio',
    icon: 'fa-code-branch',
    tone: 'rateio',
    quandoUsar:
      'Um gasto (ou valor) que precisa ser quebrado em várias categorias ou partes. Ex.: conta de energia dividida entre setores; um pagamento único com vários centros de custo.',
    passos: [
      {
        titulo: '1. Novo lançamento → aba “Rateio”',
        detalhe: 'Informe data, conta, descrição e, se fizer sentido, categoria geral e favorecido principal.',
      },
      {
        titulo: '2. Monte as partes',
        detalhe:
          'Cada linha do rateio tem valor e categoria (e favorecido da linha, se precisar). A soma das linhas é o total do lançamento.',
      },
      {
        titulo: '3. Confira se a soma fecha',
        detalhe: 'O total do rateio deve bater com o valor real que saiu da conta.',
      },
      {
        titulo: '4. Salve e use “Detalhes” no card',
        detalhe: 'Depois de lançado, o card marca “Rateio” e lista os pedaços ao expandir.',
      },
    ],
    errosComuns: [
      {
        titulo: 'Confundir rateio com compra',
        detalhe:
          'Rateio não usa quantidade × preço unitário. Se a nota tem peças com qtd e preço, use Compra.',
      },
      {
        titulo: 'Partes que não somam o total real',
        detalhe: 'Se a soma das linhas ≠ valor do extrato, o relatório de categorias fica mentiroso.',
      },
      {
        titulo: 'Rateio “de mentira” com uma linha só',
        detalhe: 'Uma linha única = lançamento simples. Rateio só vale a pena com 2+ partes.',
      },
    ],
    dica: 'Pense: “preciso fatiar este valor para o relatório?” → Rateio. “Tenho itens da nota fiscal?” → Compra.',
  },
  {
    id: 'TRANSFERENCIA',
    titulo: 'Transferência entre contas',
    shortLabel: 'Transferência',
    icon: 'fa-right-left',
    tone: 'transferencia',
    quandoUsar:
      'Dinheiro saindo de uma conta da empresa e entrando em outra conta da empresa (mesmo dono). Não é despesa nem receita de verdade — só muda de “bolso”.',
    passos: [
      {
        titulo: '1. Use o botão de transferência (não o de novo lançamento)',
        detalhe: 'Há um atalho específico de transferência no Financeiro. Evite lançar duas vezes “na mão”.',
      },
      {
        titulo: '2. Escolha conta de origem e conta de destino',
        detalhe: 'Origem perde o valor; destino ganha o mesmo valor. Data e descrição ajudam na conciliação.',
      },
      {
        titulo: '3. Salve',
        detalhe:
          'O sistema cria o par vinculado. Nos cards, aparece como Transferência. Edição/exclusão normal costuma ficar bloqueada — trate a transferência com cuidado.',
      },
    ],
    errosComuns: [
      {
        titulo: 'Lançar como despesa + receita',
        detalhe:
          'Isso “infla” o relatório: parece que a empresa gastou e ganhou, quando só moveu dinheiro entre contas.',
      },
      {
        titulo: 'Transferência para fornecedor',
        detalhe: 'Pagamento a terceiro é DESPESA (simples/compra/rateio), não transferência.',
      },
      {
        titulo: 'Valor diferente em cada ponta',
        detalhe: 'Na transferência interna o valor deve ser o mesmo nos dois lados (salvo regra futura de taxa).',
      },
    ],
    dica: 'Pergunta-chave: “o dinheiro ainda é nosso, só mudou de conta?” → Transferência. “Saiu da empresa?” → Despesa.',
  },
  {
    id: 'ESTORNO',
    titulo: 'Estornar um lançamento',
    shortLabel: 'Estorno',
    icon: 'fa-rotate-left',
    tone: 'estorno',
    quandoUsar:
      'O lançamento original está certo no histórico, mas o dinheiro (ou parte dele) voltou. Ex.: cliente devolveu mercadoria; fornecedor devolveu valor; chargeback. O original fica marcado como estornado e nasce um lançamento de estorno.',
    passos: [
      {
        titulo: '1. Ache o lançamento original na lista',
        detalhe: 'Só despesas “normais” (não transferência, não já estornado, não pendente) mostram o botão Estornar.',
      },
      {
        titulo: '2. Toque em Estornar',
        detalhe: 'Informe valor estornado (pode ser parcial), data e conta onde o dinheiro entrou de volta.',
      },
      {
        titulo: '3. Confirme',
        detalhe:
          'Se você não tiver permissão de liberar na hora, a solicitação vai para Aprovações. Depois de aprovado, o saldo reflete a volta do dinheiro.',
      },
    ],
    errosComuns: [
      {
        titulo: 'Estornar em vez de excluir um erro de digitação',
        detalhe:
          'Digitou R$ 1.000 em vez de R$ 100 e o dinheiro nunca saiu assim? Exclua (ou edite). Estorno é para movimento real que voltou.',
      },
      {
        titulo: 'Estornar transferência por este botão',
        detalhe: 'Transferência não usa o fluxo de estorno do card de despesa. Trate pelo fluxo de transferência.',
      },
      {
        titulo: 'Estornar receita pelo mesmo botão de despesa',
        detalhe: 'O botão de estorno do card é focado em gastos. Receita indevida costuma se corrigir com exclusão/edição ou lançamento inverso conforme a regra do time.',
      },
    ],
    dica: 'Estorno = “desfaz o efeito no saldo e mantém o rastro”. Exclusão = “some do extrato (soft delete)”. São caminhos diferentes.',
  },
  {
    id: 'REVERTER',
    titulo: 'Reverter um estorno',
    shortLabel: 'Reverter',
    icon: 'fa-history',
    tone: 'reversao',
    quandoUsar:
      'Você (ou alguém) estornou por engano. O estorno não deveria ter existido e o lançamento original precisa voltar a valer no saldo.',
    passos: [
      {
        titulo: '1. Ache o lançamento de estorno',
        detalhe:
          'Na lista, o card de estorno costuma ter descrição “Estorno do lançamento #…” e o botão Reverter (não o Estornar).',
      },
      {
        titulo: '2. Toque em Reverter',
        detalhe:
          'Confirme. O estorno é cancelado (some do extrato ativo) e o original deixa de ficar “estornado”.',
      },
      {
        titulo: '3. Se pedir aprovação',
        detalhe: 'Sem permissão direta, o pedido aparece em Aprovações como “Reversão de estorno”.',
      },
    ],
    errosComuns: [
      {
        titulo: 'Reverter o original em vez do estorno',
        detalhe: 'O botão Reverter fica no card do estorno, não no card que está com status “estornado”.',
      },
      {
        titulo: 'Reverter quando o dinheiro realmente voltou',
        detalhe: 'Se o estorno estava certo, não reverta — o saldo ficaria errado de novo.',
      },
    ],
    dica: 'Fluxo mental: errou o estorno → Reverter. Errou o lançamento original → Editar ou Excluir (não “inventar” estorno).',
  },
  {
    id: 'EDITAR',
    titulo: 'Editar um lançamento',
    shortLabel: 'Editar',
    icon: 'fa-pencil-alt',
    tone: 'edicao',
    quandoUsar:
      'Corrigir valor, data, conta, categoria, descrição ou itens de compra/rateio de um lançamento que ainda não está “travado” (pendente, estornado, estorno ou transferência).',
    passos: [
      {
        titulo: '1. No card, toque em Editar',
        detalhe: 'O formulário abre no tipo original (simples, compra ou rateio) com os dados atuais.',
      },
      {
        titulo: '2. Ajuste só o que precisa',
        detalhe: 'Em compra/rateio, confira se as linhas e o total ainda fecham depois da mudança.',
      },
      {
        titulo: '3. Salve (e justifique se o sistema pedir)',
        detalhe:
          'Em alguns casos a edição vira solicitação para o gerente aprovar. Enquanto estiver pendente, o card mostra status pendente e bloqueia novas ações.',
      },
    ],
    errosComuns: [
      {
        titulo: 'Editar o que já está pendente de aprovação',
        detalhe: 'Espere a decisão do gerente ou peça para rejeitarem e abrirem de novo.',
      },
      {
        titulo: 'Editar transferência pelo lápis do card',
        detalhe: 'Transferência costuma estar bloqueada para edição. Não force com “dois lançamentos avulsos”.',
      },
      {
        titulo: 'Mudar valor sem olhar o extrato',
        detalhe: 'Se o extrato já bateu, editar valor desfaz a conciliação mental do dia.',
      },
    ],
    dica: 'Edição corrige dados. Estorno corrige “dinheiro que voltou”. Exclusão tira o lançamento do extrato ativo.',
  },
  {
    id: 'EXCLUIR',
    titulo: 'Excluir um lançamento',
    shortLabel: 'Excluir',
    icon: 'fa-trash',
    tone: 'exclusao',
    quandoUsar:
      'O lançamento não deveria existir no extrato (digitação errada, teste, duplicado). A exclusão é lógica: some da lista e do saldo, mas o registro fica guardado no banco.',
    passos: [
      {
        titulo: '1. No card, toque em Excluir',
        detalhe: 'O sistema pede uma justificativa — escreva o motivo de forma clara para o gerente (se precisar aprovar).',
      },
      {
        titulo: '2. Confirme o pedido',
        detalhe:
          'Com permissão, some na hora. Sem permissão, vai para Aprovações como exclusão. Enquanto pendente, o card fica bloqueado.',
      },
      {
        titulo: '3. Se era baixa de Agenda',
        detalhe:
          'A parcela da Agenda volta a ficar pendente. Se o pagamento for real, dê baixa de novo depois; se o pagamento não existiu, deixe a agenda pendente ou trate o agendamento.',
      },
    ],
    errosComuns: [
      {
        titulo: 'Excluir quando o dinheiro realmente saiu e depois voltou',
        detalhe: 'Nesse caso o caminho é Estorno, não exclusão — o histórico precisa mostrar o ciclo completo.',
      },
      {
        titulo: 'Excluir transferência pelo botão do card',
        detalhe: 'Transferências costumam estar bloqueadas. Não apague só “um lado” na mão.',
      },
      {
        titulo: 'Justificativa vazia ou genérica',
        detalhe: '“Erro” sozinho atrasa a aprovação. Diga o que estava errado (valor, duplicado, teste…).',
      },
    ],
    dica: 'Depois de excluir, o lançamento some da lista filtrada. Não é “lixeira” na tela ainda — o importante é o saldo e a Agenda voltarem a bater.',
  },
  {
    id: 'AGENDA',
    titulo: 'Agenda e baixa (viram lançamento)',
    shortLabel: 'Agenda',
    icon: 'fa-calendar-check',
    tone: 'agenda',
    quandoUsar:
      'Contas a pagar/receber programadas. Quando você dá baixa na Agenda, o sistema cria o lançamento real nesta lista de Lançamentos.',
    passos: [
      {
        titulo: '1. Cadastre ou encontre o item na Agenda',
        detalhe: 'Pode ser simples, compra, rateio ou parcela de lote — o tipo da baixa segue o que foi agendado.',
      },
      {
        titulo: '2. Dê baixa no dia do pagamento/recebimento',
        detalhe: 'Confira conta e valor. A baixa gera o lançamento com descrição lembrando a conta agendada.',
      },
      {
        titulo: '3. Se excluir o lançamento da baixa',
        detalhe: 'A agenda volta a pendente. Você pode baixar de novo se o pagamento for verdadeiro.',
      },
    ],
    errosComuns: [
      {
        titulo: 'Lançar na mão e também baixar a agenda',
        detalhe: 'Gera duplicidade: dois gastos iguais no saldo. Prefira só a baixa da agenda.',
      },
      {
        titulo: 'Baixar com conta errada',
        detalhe: 'O lançamento criado herda a conta da baixa — corrija antes de confirmar.',
      },
    ],
    dica: 'Agenda = compromisso. Lançamento = dinheiro que de fato moveu. A baixa é a ponte entre os dois.',
  },
  {
    id: 'FILTROS',
    titulo: 'Filtros e leitura da lista',
    shortLabel: 'Filtros',
    icon: 'fa-sliders-h',
    tone: 'filtros',
    quandoUsar:
      'Para achar um lançamento, conferir o dia, separar despesas/receitas, ver só rateios ou transferências.',
    passos: [
      {
        titulo: '1. Período (datas)',
        detalhe: 'Por padrão a lista foca no dia de hoje. Alargue o intervalo para ver a semana ou o mês.',
      },
      {
        titulo: '2. Busca por texto',
        detalhe: 'Use parte da descrição, favorecido ou referência que você lembra.',
      },
      {
        titulo: '3. Tipo e formato',
        detalhe:
          'Filtre despesa/receita e chips como Rateio ou Transferência para não misturar operações diferentes.',
      },
      {
        titulo: '4. Conta bancária',
        detalhe: 'Ótimo para conciliar um extrato de uma conta só.',
      },
      {
        titulo: '5. Atualizar',
        detalhe: 'Depois de lançar em outra aba ou aprovar algo, use Atualizar se a lista não refrescou sozinha.',
      },
    ],
    errosComuns: [
      {
        titulo: '“Sumiu” o lançamento',
        detalhe:
          'Quase sempre é filtro de data ou conta. Limpe os filtros e busque de novo antes de relançar.',
      },
      {
        titulo: 'Relançar o que só estava filtrado',
        detalhe: 'Duplica o valor. Sempre limpe filtros antes de achar que “não entrou”.',
      },
    ],
    dica: 'Card com status pendente = esperando gerente. Estornado = já foi estornado. Expandir “Detalhes” mostra linhas de compra/rateio.',
  },
];

interface Props {
  onClose: () => void;
}

export default function FinanceiroGuiaLancamentos({ onClose }: Props) {
  const [pill, setPill] = useState('GERAL');

  const ativo = useMemo(() => TOPICOS.find((t) => t.id === pill) ?? null, [pill]);

  return (
    <aside id="fc-lancamentos-guia" className="fc-aprovacoes-guia fc-lancamentos-guia" aria-label="Guia de lançamentos">
      <div className="fc-aprovacoes-guia-topo">
        <div className="fc-aprovacoes-guia-topo-texto">
          <h3 className="fc-aprovacoes-guia-titulo">
            <i className="fas fa-circle-info" aria-hidden />
            Guia: como lançar corretamente
          </h3>
          <p className="fc-aprovacoes-guia-intro">
            Escolha o tipo de operação. Só o conteúdo daquele assunto aparece. Fechar o guia não sai de Lançamentos.
          </p>
        </div>
      </div>

      <div className="fc-aprovacoes-guia-pills" role="tablist" aria-label="Assuntos do guia de lançamentos">
        <button
          type="button"
          role="tab"
          aria-selected={pill === 'GERAL'}
          className={`fc-aprovacoes-guia-pill is-geral${pill === 'GERAL' ? ' is-ativo' : ''}`}
          onClick={() => setPill('GERAL')}
        >
          <i className="fas fa-lightbulb" aria-hidden />
          Visão geral
        </button>
        {TOPICOS.map((topico) => {
          const selecionado = pill === topico.id;
          return (
            <button
              key={topico.id}
              type="button"
              role="tab"
              aria-selected={selecionado}
              className={`fc-aprovacoes-guia-pill is-${topico.tone}${selecionado ? ' is-ativo' : ''}`}
              onClick={() => setPill(topico.id)}
            >
              <i className={`fas ${topico.icon}`} aria-hidden />
              {topico.shortLabel}
            </button>
          );
        })}
      </div>

      <div className="fc-aprovacoes-guia-conteudo" role="tabpanel">
        {pill === 'GERAL' && (
          <div className="fc-aprovacoes-guia-regra">
            <div className="fc-aprovacoes-guia-regra-icon" aria-hidden>
              <i className="fas fa-lightbulb" />
            </div>
            <div>
              <strong>{GUIA_GERAL.titulo}</strong>
              <p>{GUIA_GERAL.texto}</p>
              <p className="fc-aprovacoes-guia-regra-hint">{GUIA_GERAL.hint}</p>
            </div>
          </div>
        )}

        {ativo && (
          <article className={`fc-aprovacoes-guia-card is-${ativo.tone}`}>
            <header className="fc-aprovacoes-guia-card-head">
              <span className={`fc-aprovacoes-tipo-badge is-${ativo.tone}`}>
                <i className={`fas ${ativo.icon}`} aria-hidden />
                {ativo.shortLabel}
              </span>
              <h3>{ativo.titulo}</h3>
            </header>

            <div className="fc-aprovacoes-guia-bloco is-info">
              <div className="fc-aprovacoes-guia-bloco-label">
                <i className="fas fa-bullseye" aria-hidden /> Quando usar
              </div>
              <p>{ativo.quandoUsar}</p>
            </div>

            <div className="fc-aprovacoes-guia-bloco is-info">
              <div className="fc-aprovacoes-guia-bloco-label">
                <i className="fas fa-list-ol" aria-hidden /> Como fazer
              </div>
              <ol className="fc-aprovacoes-guia-passos">
                {ativo.passos.map((passo) => (
                  <li key={passo.titulo}>
                    <strong>{passo.titulo}</strong>
                    <span>{passo.detalhe}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="fc-aprovacoes-guia-bloco is-perigo">
              <div className="fc-aprovacoes-guia-bloco-label">
                <i className="fas fa-exclamation-triangle" aria-hidden /> Erros comuns
              </div>
              <ol className="fc-aprovacoes-guia-passos">
                {ativo.errosComuns.map((passo) => (
                  <li key={passo.titulo}>
                    <strong>{passo.titulo}</strong>
                    <span>{passo.detalhe}</span>
                  </li>
                ))}
              </ol>
            </div>

            <p className="fc-aprovacoes-guia-dica">
              <i className="fas fa-check" aria-hidden /> {ativo.dica}
            </p>
          </article>
        )}
      </div>

      <div className="fc-aprovacoes-guia-rodape">
        <button type="button" className="fc-aprovacoes-guia-fechar-cta" onClick={onClose}>
          <i className="fas fa-chevron-up" aria-hidden />
          Fechar este guia
        </button>
      </div>
    </aside>
  );
}
