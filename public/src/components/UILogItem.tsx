interface Log {
  acao?: string;
  detalhes?: string;
  nome_usuario?: string;
  data_evento?: string;
  dados_alterados?: {
    antes?: Record<string, unknown> | null;
    depois?: Record<string, unknown> | null;
    [key: string]: unknown;
  } | null;
}

interface Props { log: Log; }

interface LogConfig {
  icon: string;
  color: string;
  label: string;
  sentido?: 'receita' | 'despesa' | 'neutro';
}

const logConfig: Record<string, LogConfig> = {
  default: { icon: 'fa-info-circle', color: '#7f8c8d', label: 'Atividade', sentido: 'neutro' },
  CRIACAO_LANCAMENTO: { icon: 'fa-plus', color: '#27ae60', label: 'Criou lançamento', sentido: 'neutro' },
  CRIACAO_LANCAMENTO_DETALHADO: { icon: 'fa-shopping-cart', color: '#c0392b', label: 'Criou lançamento detalhado', sentido: 'despesa' },
  CRIACAO_TRANSFERENCIA: { icon: 'fa-exchange-alt', color: '#2980b9', label: 'Transferência', sentido: 'neutro' },
  EDICAO_LANCAMENTO: { icon: 'fa-pencil-alt', color: '#2980b9', label: 'Editou lançamento', sentido: 'neutro' },
  EXCLUSAO_LANCAMENTO: { icon: 'fa-trash', color: '#c0392b', label: 'Excluiu lançamento', sentido: 'despesa' },
  REGISTRO_ESTORNO: { icon: 'fa-undo', color: '#27ae60', label: 'Registrou estorno', sentido: 'receita' },
  REVERSAO_ESTORNO: { icon: 'fa-history', color: '#8e44ad', label: 'Reverteu estorno', sentido: 'neutro' },
  SOLICITACAO_EDICAO: { icon: 'fa-question-circle', color: '#f39c12', label: 'Solicitou edição', sentido: 'neutro' },
  SOLICITACAO_EXCLUSAO: { icon: 'fa-question-circle', color: '#f39c12', label: 'Solicitou exclusão', sentido: 'neutro' },
  SOLICITACAO_ESTORNO: { icon: 'fa-question-circle', color: '#f39c12', label: 'Solicitou estorno', sentido: 'neutro' },
  SOLICITACAO_REVERSAO_ESTORNO: { icon: 'fa-question-circle', color: '#f39c12', label: 'Solicitou reversão', sentido: 'neutro' },
  SOLICITACAO_CRIACAO: { icon: 'fa-question-circle', color: '#f39c12', label: 'Solicitou criação', sentido: 'neutro' },
  APROVACAO_SOLICITACAO: { icon: 'fa-check-double', color: '#16a085', label: 'Aprovou solicitação', sentido: 'neutro' },
  REJEICAO_SOLICITACAO: { icon: 'fa-times-circle', color: '#a32316', label: 'Rejeitou solicitação', sentido: 'neutro' },
  CRIACAO_AGENDAMENTO: { icon: 'fa-calendar-plus', color: '#64748b', label: 'Agendou conta', sentido: 'neutro' },
  CRIACAO_LOTE_AGENDAMENTO: { icon: 'fa-layer-group', color: '#64748b', label: 'Agendou lote', sentido: 'neutro' },
  BAIXA_AGENDAMENTO: { icon: 'fa-check-circle', color: '#94a3b8', label: 'Baixa de agendamento', sentido: 'despesa' },
  EDICAO_AGENDAMENTO: { icon: 'fa-pencil-alt', color: '#2980b9', label: 'Editou agendamento', sentido: 'neutro' },
  EXCLUSAO_AGENDAMENTO: { icon: 'fa-trash', color: '#c0392b', label: 'Excluiu agendamento', sentido: 'neutro' },
  EXCLUSAO_LOTE_AGENDAMENTO: { icon: 'fa-trash', color: '#c0392b', label: 'Excluiu lote agendado', sentido: 'neutro' },
  RECUPERACAO_AGENDAMENTO: { icon: 'fa-rotate-left', color: '#2563eb', label: 'Recuperou agendamento', sentido: 'neutro' },
  RECUPERACAO_LOTE_AGENDAMENTO: { icon: 'fa-rotate-left', color: '#2563eb', label: 'Recuperou lote agendado', sentido: 'neutro' },
  EXCLUSAO_AGENDAMENTO_FORCADA: { icon: 'fa-trash-alt', color: '#922b21', label: 'Exclusão forçada', sentido: 'neutro' },
  EDICAO_LOTE_DESCRICAO: { icon: 'fa-edit', color: '#2980b9', label: 'Editou lote', sentido: 'neutro' },
  CRIACAO_ENTIDADE: { icon: 'fa-folder-plus', color: '#27ae60', label: 'Criou cadastro', sentido: 'neutro' },
  EDICAO_ENTIDADE: { icon: 'fa-pencil-alt', color: '#2980b9', label: 'Editou cadastro', sentido: 'neutro' },
  ALTERACAO_STATUS_CONTATO: { icon: 'fa-toggle-on', color: '#2980b9', label: 'Status de favorecido', sentido: 'neutro' },
  CRIACAO_CONCESSIONARIA_VT: { icon: 'fa-bus', color: '#27ae60', label: 'Cadastrou VT', sentido: 'neutro' },
  EDICAO_CONCESSIONARIA_VT: { icon: 'fa-bus', color: '#2980b9', label: 'Editou VT', sentido: 'neutro' },
};

export const HISTORICO_ACAO_OPCOES = Object.entries(logConfig)
  .filter(([key]) => key !== 'default')
  .map(([value, cfg]) => ({ value, label: cfg.label }));

export const HISTORICO_ACAO_GRUPOS: Array<{ id: string; label: string; acoes: string[] }> = [
  {
    id: 'lancamentos',
    label: 'Lançamentos',
    acoes: [
      'CRIACAO_LANCAMENTO', 'CRIACAO_LANCAMENTO_DETALHADO', 'CRIACAO_TRANSFERENCIA',
      'EDICAO_LANCAMENTO', 'EXCLUSAO_LANCAMENTO', 'REGISTRO_ESTORNO', 'REVERSAO_ESTORNO',
    ],
  },
  {
    id: 'agenda',
    label: 'Agenda',
    acoes: [
      'CRIACAO_AGENDAMENTO', 'CRIACAO_LOTE_AGENDAMENTO', 'BAIXA_AGENDAMENTO',
      'EDICAO_AGENDAMENTO', 'EXCLUSAO_AGENDAMENTO', 'EXCLUSAO_AGENDAMENTO_FORCADA', 'EDICAO_LOTE_DESCRICAO',
    ],
  },
  {
    id: 'aprovacoes',
    label: 'Aprovações',
    acoes: [
      'SOLICITACAO_EDICAO', 'SOLICITACAO_EXCLUSAO', 'SOLICITACAO_ESTORNO',
      'SOLICITACAO_REVERSAO_ESTORNO', 'SOLICITACAO_CRIACAO',
      'APROVACAO_SOLICITACAO', 'REJEICAO_SOLICITACAO',
    ],
  },
  {
    id: 'config',
    label: 'Cadastros',
    acoes: [
      'CRIACAO_ENTIDADE', 'EDICAO_ENTIDADE', 'ALTERACAO_STATUS_CONTATO',
      'CRIACAO_CONCESSIONARIA_VT', 'EDICAO_CONCESSIONARIA_VT',
    ],
  },
];

const formatMoney = (value: unknown) => {
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
};

const moneyRe = /R\$\s*[\d.]+,\d{2}/g;

function formatDateTime(value?: string) {
  if (!value) return { data: '—', hora: '' };
  const d = new Date(value);
  return {
    data: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    hora: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
}

function iniciais(nome?: string) {
  if (!nome?.trim()) return '?';
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function pickTipo(log: Log): 'RECEITA' | 'DESPESA' | null {
  const depois = log.dados_alterados?.depois as Record<string, unknown> | null | undefined;
  const antes = log.dados_alterados?.antes as Record<string, unknown> | null | undefined;
  const tipo = String(depois?.tipo || antes?.tipo || '').toUpperCase();
  if (tipo === 'RECEITA' || tipo === 'DESPESA') return tipo;
  const txt = (log.detalhes || '').toLowerCase();
  if (txt.includes('receita')) return 'RECEITA';
  if (txt.includes('despesa')) return 'DESPESA';
  return null;
}

function resolveDisplay(log: Log): LogConfig {
  const base = logConfig[log.acao ?? ''] ?? logConfig.default;
  const tipo = pickTipo(log);
  const depois = log.dados_alterados?.depois as Record<string, unknown> | null | undefined;

  if (log.acao === 'CRIACAO_LANCAMENTO') {
    if (tipo === 'RECEITA') {
      return { icon: 'fa-plus', color: '#27ae60', label: 'Criou receita', sentido: 'receita' };
    }
    if (tipo === 'DESPESA') {
      return { icon: 'fa-minus', color: '#c0392b', label: 'Criou despesa', sentido: 'despesa' };
    }
  }

  if (log.acao === 'CRIACAO_LANCAMENTO_DETALHADO') {
    const rateio = String(depois?.tipo_rateio || '');
    if (rateio === 'COMPRA') {
      return { icon: 'fa-minus', color: '#c0392b', label: 'Criou compra detalhada', sentido: 'despesa' };
    }
    if (rateio === 'DETALHADO') {
      return { icon: 'fa-minus', color: '#c0392b', label: 'Criou rateio', sentido: 'despesa' };
    }
    return { icon: 'fa-minus', color: '#c0392b', label: 'Criou despesa detalhada', sentido: 'despesa' };
  }

  if (log.acao === 'BAIXA_AGENDAMENTO') {
    // Agendamento A_PAGAR = despesa; A_RECEBER = receita
    const ag = (log.dados_alterados?.depois as { agendamento?: { tipo?: string } } | undefined)?.agendamento
      || (log.dados_alterados as { agendamento?: { tipo?: string } } | null | undefined)?.agendamento;
    const agTipo = String(ag?.tipo || '');
    if (agTipo === 'A_RECEBER') {
      return { icon: 'fa-check-circle', color: '#94a3b8', label: 'Baixa de agendamento', sentido: 'receita' };
    }
    return { icon: 'fa-check-circle', color: '#94a3b8', label: 'Baixa de agendamento', sentido: 'despesa' };
  }

  if (log.acao === 'EXCLUSAO_LANCAMENTO' && tipo === 'RECEITA') {
    return { ...base, sentido: 'receita' };
  }

  return base;
}

type ValorView =
  | { kind: 'single'; texto: string; sentido: 'receita' | 'despesa' | 'neutro' }
  | { kind: 'mudanca'; antes: string; depois: string };

function withSign(moneyLabel: string, sentido: 'receita' | 'despesa' | 'neutro') {
  const clean = moneyLabel.replace(/^\s*[+\-]\s*/, '');
  if (sentido === 'receita') return `+ ${clean}`;
  if (sentido === 'despesa') return `− ${clean}`;
  return clean;
}

function buildValorView(log: Log, sentido: 'receita' | 'despesa' | 'neutro'): ValorView | null {
  const dados = log.dados_alterados;
  const antesObj = (dados?.antes || null) as Record<string, unknown> | null;
  const depoisObj = (dados?.depois || null) as Record<string, unknown> | null;

  // Edição: seta antes → depois
  if (log.acao === 'EDICAO_LANCAMENTO' || log.acao === 'EDICAO_AGENDAMENTO') {
    const antesMoney = formatMoney(antesObj?.valor);
    const depoisMoney = formatMoney(depoisObj?.valor);
    if (antesMoney && depoisMoney) {
      return { kind: 'mudanca', antes: antesMoney, depois: depoisMoney };
    }
    const m = (log.detalhes || '').match(/de\s+(R\$\s*[\d.]+,\d{2})\s+para\s+(R\$\s*[\d.]+,\d{2})/i);
    if (m) return { kind: 'mudanca', antes: m[1], depois: m[2] };
  }

  // Estorno admin
  if (log.acao === 'REGISTRO_ESTORNO') {
    const estorno = (dados as { lancamento_estorno?: { valor?: unknown } } | null)?.lancamento_estorno;
    const money = formatMoney(estorno?.valor ?? depoisObj?.valor);
    if (money) return { kind: 'single', texto: withSign(money, 'receita'), sentido: 'receita' };
  }

  // Baixa
  if (log.acao === 'BAIXA_AGENDAMENTO') {
    const ag = (dados?.depois as { agendamento?: { valor?: unknown; tipo?: string } } | undefined)?.agendamento
      || (dados as { agendamento?: { valor?: unknown; tipo?: string } } | null)?.agendamento;
    const money = formatMoney(ag?.valor);
    if (money) {
      const s = ag?.tipo === 'A_RECEBER' ? 'receita' as const : 'despesa' as const;
      return { kind: 'single', texto: withSign(money, s), sentido: s };
    }
  }

  // Criação / genérico com depois.valor
  const valorDepois = formatMoney(depoisObj?.valor);
  if (log.acao === 'CRIACAO_LOTE_AGENDAMENTO') {
    const total = formatMoney(depoisObj?.valor_total);
    if (total) return { kind: 'single', texto: total, sentido: 'neutro' };
  }

  if (valorDepois && (
    log.acao === 'CRIACAO_LANCAMENTO'
    || log.acao === 'CRIACAO_LANCAMENTO_DETALHADO'
    || log.acao === 'EXCLUSAO_LANCAMENTO'
    || log.acao === 'CRIACAO_AGENDAMENTO'
  )) {
    const tipo = pickTipo(log);
    const s = sentido !== 'neutro' ? sentido : tipo === 'RECEITA' ? 'receita' : tipo === 'DESPESA' ? 'despesa' : 'neutro';
    if (log.acao === 'CRIACAO_LANCAMENTO' || log.acao === 'CRIACAO_LANCAMENTO_DETALHADO' || log.acao === 'EXCLUSAO_LANCAMENTO') {
      const final = s === 'neutro' ? 'despesa' : s;
      return { kind: 'single', texto: withSign(valorDepois, final), sentido: final };
    }
    return { kind: 'single', texto: valorDepois, sentido: 'neutro' };
  }

  if (log.acao === 'CRIACAO_TRANSFERENCIA') {
    const valor = formatMoney((dados as { valor?: unknown } | null)?.valor ?? depoisObj?.valor);
    if (valor) return { kind: 'single', texto: valor, sentido: 'neutro' };
  }

  // Fallback: textos R$ no detalhe
  const matches = (log.detalhes || '').match(moneyRe);
  if (!matches?.length) return null;
  if (matches.length >= 2 && (log.acao === 'EDICAO_LANCAMENTO' || log.acao === 'EDICAO_AGENDAMENTO' || /de .+ para /i.test(log.detalhes || ''))) {
    return { kind: 'mudanca', antes: matches[0], depois: matches[1] };
  }
  const s = sentido === 'neutro' ? 'neutro' : sentido;
  const signed = s === 'receita' || s === 'despesa' ? withSign(matches[0], s) : matches[0];
  return { kind: 'single', texto: signed, sentido: s };
}

export default function UILogItem({ log }: Props) {
  const display = resolveDisplay(log);
  const { data, hora } = formatDateTime(log.data_evento);
  const valorView = buildValorView(log, display.sentido || 'neutro');
  const usuario = log.nome_usuario || 'Usuário desconhecido';

  return (
    <article className="fc-historico-card">
      <div className="fc-historico-card-topo">
        <div className="fc-historico-card-acao">
          <span className="fc-historico-card-icone" style={{ backgroundColor: display.color }} aria-hidden>
            <i className={`fas ${display.icon}`} />
          </span>
          <span className="fc-historico-card-acao-label">{display.label}</span>
        </div>
        <div className="fc-historico-card-quando" title={`${data} ${hora}`}>
          <strong>{data}</strong>
          <span>{hora}</span>
        </div>
      </div>

      <div className="fc-historico-card-destaques">
        <div className="fc-historico-card-quem">
          <span className="fc-historico-card-avatar" aria-hidden>{iniciais(usuario)}</span>
          <div>
            <small>Executado por</small>
            <strong>{usuario}</strong>
          </div>
        </div>

        {valorView ? (
          <div className="fc-historico-card-valores">
            <small>
              {valorView.kind === 'mudanca' ? 'Alteração de valor' : 'Valor movimentado'}
            </small>
            {valorView.kind === 'mudanca' ? (
              <div className="fc-historico-valor-mudanca" aria-label={`De ${valorView.antes} para ${valorView.depois}`}>
                <span className="fc-historico-valor-pill is-neutro is-antes">{valorView.antes}</span>
                <span className="fc-historico-valor-seta" aria-hidden>
                  <i className="fas fa-arrow-right" />
                </span>
                <span className="fc-historico-valor-pill is-depois">{valorView.depois}</span>
              </div>
            ) : (
              <div className="fc-historico-card-valores-lista">
                <span className={`fc-historico-valor-pill is-${valorView.sentido}`}>
                  {valorView.texto}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="fc-historico-card-valores is-vazio">
            <small>Valor movimentado</small>
            <strong className="fc-historico-valor-ausente">Sem valor monetário</strong>
          </div>
        )}
      </div>

      {log.detalhes ? (
        <p className="fc-historico-card-detalhe" dangerouslySetInnerHTML={{ __html: log.detalhes }} />
      ) : null}
    </article>
  );
}
