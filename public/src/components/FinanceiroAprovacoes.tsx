import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import { fetchFinanceiro } from '../utils/financeiro-api';
import { useFinanceiro } from './FinanceiroContext';
import { mostrarConfirmacao } from '../../js/utils/popups.js';

type TipoSolicitacao =
  | 'EXCLUSAO'
  | 'ESTORNO'
  | 'REVERSAO_ESTORNO'
  | 'EDICAO'
  | 'CRIACAO_DATAS_ESPECIAIS'
  | string;

interface ContextoAgenda {
  id_agenda: number;
  descricao?: string;
  status?: string;
  id_efetivado?: number | null;
  baixa_substituta_ativa?: boolean;
  id_baixa_substituta?: number | null;
  data_vencimento?: string | null;
  valor?: number | null;
}

interface Solic {
  id: string | number;
  tipo_solicitacao: TipoSolicitacao;
  status?: 'PENDENTE' | 'APROVADO' | 'REJEITADO' | string;
  nome_solicitante?: string;
  nome_aprovador?: string | null;
  data_solicitacao: string;
  data_decisao?: string | null;
  justificativa_solicitante?: string;
  motivo_rejeicao?: string | null;
  id_lancamento?: number | null;
  dados_antigos?: Record<string, unknown> | null;
  dados_novos?: Record<string, unknown> | null;
  lancamento_excluido_em?: string | null;
  /** 'lancamento' = lançamento avulso; 'agenda' = baixa de parcela da Agenda */
  origem_exclusao?: 'lancamento' | 'agenda' | null;
  contexto_agenda?: ContextoAgenda | null;
  resumo_origem?: {
    label: string;
    detalhe?: string;
    efeito?: string;
  } | null;
  pode_desfazer_exclusao?: boolean;
  bloqueio_desfazer?: string | null;
  mensagem_desfazer?: string | null;
}

type AbaAprovacoes = 'pendentes' | 'historico';
type FiltroHistorico = '' | 'APROVADO' | 'REJEITADO';

interface HistoricoResponse {
  rows: Solic[];
  total: number;
  page: number;
  limit: number;
  totalPaginas: number;
}

const HIST_LIMIT = 12;

interface TipoMeta {
  label: string;
  shortLabel: string;
  icon: string;
  tone: 'exclusao' | 'estorno' | 'reversao' | 'edicao' | 'criacao' | 'outro';
  /** Menor = mais urgente na fila */
  prioridade: number;
  descricaoFila: string;
}

interface GuiaPasso {
  titulo: string;
  detalhe: string;
}

interface GuiaTipo {
  tipo: TipoSolicitacao;
  titulo: string;
  oQueAcontece: string;
  seAprovouErrado: GuiaPasso[];
  seRejeitouErrado: GuiaPasso[];
  dica: string;
}

const TIPO_META: Record<string, TipoMeta> = {
  EXCLUSAO: {
    label: 'Exclusão de lançamento',
    shortLabel: 'Exclusão',
    icon: 'fa-trash-alt',
    tone: 'exclusao',
    prioridade: 1,
    descricaoFila: 'Remove o lançamento do extrato e do saldo',
  },
  ESTORNO: {
    label: 'Estorno',
    shortLabel: 'Estorno',
    icon: 'fa-undo',
    tone: 'estorno',
    prioridade: 2,
    descricaoFila: 'Devolve o valor e marca o lançamento original como estornado',
  },
  REVERSAO_ESTORNO: {
    label: 'Reversão de estorno',
    shortLabel: 'Reverter estorno',
    icon: 'fa-redo',
    tone: 'reversao',
    prioridade: 3,
    descricaoFila: 'Cancela o estorno e o lançamento original volta a valer',
  },
  EDICAO: {
    label: 'Edição de lançamento',
    shortLabel: 'Edição',
    icon: 'fa-pen',
    tone: 'edicao',
    prioridade: 4,
    descricaoFila: 'Altera valor, data, conta, categoria ou descrição',
  },
  CRIACAO_DATAS_ESPECIAIS: {
    label: 'Novo lançamento (data especial)',
    shortLabel: 'Criação',
    icon: 'fa-plus-circle',
    tone: 'criacao',
    prioridade: 5,
    descricaoFila: 'Cria um lançamento em data que exige aprovação',
  },
};

const TIPO_FALLBACK: TipoMeta = {
  label: 'Solicitação',
  shortLabel: 'Outro',
  icon: 'fa-question-circle',
  tone: 'outro',
  prioridade: 99,
  descricaoFila: 'Solicitação financeira pendente',
};

/** Guia em linguagem simples: o que fazer se o gerente errar cada tipo. */
const GUIAS: GuiaTipo[] = [
  {
    tipo: 'EXCLUSAO',
    titulo: 'Exclusão de lançamento',
    oQueAcontece:
      'Ao aprovar, o lançamento some da lista e para de contar no saldo. Ele não some do banco de verdade: fica “escondido”. Se era baixa de uma conta da Agenda, a parcela volta a aparecer como pendente.',
    seAprovouErrado: [
      {
        titulo: '1. Use “Desfazer exclusão” no Histórico (quando ainda der)',
        detalhe:
          'Na aba Histórico desta tela, abra a exclusão aprovada e toque em “Desfazer exclusão”. O lançamento volta ao extrato e ao saldo. Se for baixa de Agenda e a parcela ainda estiver pendente, a Agenda volta a “paga”.',
      },
      {
        titulo: '2. Se o botão não aparecer ou der erro',
        detalhe:
          'Provavelmente já existe uma baixa nova na mesma parcela da Agenda (saldo dobraria se reativasse a antiga). Exclua a baixa nova primeiro, ou relance o valor correto sem desfazer o fantasma.',
      },
      {
        titulo: '3. Lançamento normal (não agenda)',
        detalhe:
          'Se o desfazer falhar, peça o cadastro de um lançamento novo com os mesmos dados — ou confira se o item já não voltou sozinho no extrato.',
      },
    ],
    seRejeitouErrado: [
      {
        titulo: '1. A rejeição não pode ser reaberta',
        detalhe:
          'O pedido some da fila e o funcionário recebe o aviso com o motivo que você escreveu.',
      },
      {
        titulo: '2. Peça para solicitar de novo',
        detalhe:
          'Peça que a pessoa faça outra solicitação de exclusão no mesmo lançamento. Quando aparecer de novo nesta tela, você aprova.',
      },
    ],
    dica: 'Exclusão é a ação mais forte da fila. Só aprove se tiver certeza de que o lançamento não deveria existir no extrato.',
  },
  {
    tipo: 'ESTORNO',
    titulo: 'Estorno',
    oQueAcontece:
      'Ao aprovar, o sistema registra uma “devolução” do valor e marca o lançamento original como estornado. O saldo muda como se o dinheiro tivesse voltado.',
    seAprovouErrado: [
      {
        titulo: '1. Ache o lançamento de estorno',
        detalhe:
          'Em Lançamentos, procure a linha de estorno (descrição tipo “Estorno do lançamento #…”).',
      },
      {
        titulo: '2. Peça para reverter o estorno',
        detalhe:
          'O funcionário (ou você, se tiver permissão) solicita a reversão desse estorno. Quando o pedido aparecer aqui, aprove a “Reversão de estorno”.',
      },
      {
        titulo: '3. Resultado esperado',
        detalhe:
          'O estorno some e o lançamento original volta a valer no saldo — como se o estorno nunca tivesse acontecido.',
      },
    ],
    seRejeitouErrado: [
      {
        titulo: '1. Peça um novo estorno',
        detalhe:
          'A rejeição não reabre sozinha. Peça que façam de novo a solicitação de estorno no lançamento original.',
      },
      {
        titulo: '2. Aprove o pedido novo nesta tela',
        detalhe: 'Quando a fila mostrar o estorno de novo, confira valor e conta e aprove.',
      },
    ],
    dica: 'Estorno e exclusão são coisas diferentes: estorno “desfaz o efeito no saldo” mantendo o histórico; exclusão esconde o lançamento.',
  },
  {
    tipo: 'REVERSAO_ESTORNO',
    titulo: 'Reversão de estorno',
    oQueAcontece:
      'Ao aprovar, o estorno deixa de valer e o lançamento original volta a contar no saldo (como se o estorno tivesse sido cancelado).',
    seAprovouErrado: [
      {
        titulo: '1. O original voltou a valer',
        detalhe:
          'O lançamento antigo (que estava estornado) volta a aparecer no extrato e no saldo.',
      },
      {
        titulo: '2. Se o estorno era o correto',
        detalhe:
          'Peça um novo estorno sobre esse lançamento original. Quando a solicitação chegar aqui, aprove o estorno de novo.',
      },
    ],
    seRejeitouErrado: [
      {
        titulo: '1. Peça a reversão novamente',
        detalhe:
          'O funcionário deve solicitar outra vez a reversão do estorno. Depois você aprova o pedido novo.',
      },
    ],
    dica: 'Use reversão só quando o estorno foi feito por engano. Se o dinheiro realmente “voltou”, o estorno deve permanecer.',
  },
  {
    tipo: 'EDICAO',
    titulo: 'Edição de lançamento',
    oQueAcontece:
      'Ao aprovar, os dados do lançamento (valor, data, conta, categoria, descrição etc.) são trocados pelos valores novos do pedido.',
    seAprovouErrado: [
      {
        titulo: '1. Abra o lançamento em Lançamentos',
        detalhe: 'Confira o que ficou errado (valor, data, conta…).',
      },
      {
        titulo: '2. Peça uma nova edição com os valores certos',
        detalhe:
          'O funcionário edita de novo e manda para aprovação. Quando o pedido aparecer aqui, aprove a correção.',
      },
      {
        titulo: '3. Se a edição “estragou” demais',
        detalhe:
          'Outra saída é excluir o lançamento errado e cadastrar um novo correto (cada passo pode pedir aprovação, conforme a permissão de cada um).',
      },
    ],
    seRejeitouErrado: [
      {
        titulo: '1. Peça a edição de novo',
        detalhe:
          'A rejeição não reabre o pedido. Peça que a pessoa envie outra solicitação de edição com os mesmos dados.',
      },
      {
        titulo: '2. Aprove o pedido novo',
        detalhe: 'Na fila, confira se os valores batem e aprove.',
      },
    ],
    dica: 'Nas edições, olhe o “antes → depois”. Se o valor ou a conta mudaram, confira se o saldo da conta faz sentido.',
  },
  {
    tipo: 'CRIACAO_DATAS_ESPECIAIS',
    titulo: 'Novo lançamento (data especial)',
    oQueAcontece:
      'Ao aprovar, o sistema cria de verdade o lançamento na data pedida e ele passa a contar no saldo e no extrato.',
    seAprovouErrado: [
      {
        titulo: '1. Ache o lançamento criado',
        detalhe:
          'Em Lançamentos, busque pela descrição e pela data do pedido. O número (#id) pode aparecer no histórico de atividades.',
      },
      {
        titulo: '2. Exclua o lançamento se ele não deveria existir',
        detalhe:
          'Peça (ou faça) a exclusão desse lançamento. Se precisar de aprovação, o pedido de exclusão volta para esta mesma tela.',
      },
      {
        titulo: '3. Se os dados estavam quase certos',
        detalhe:
          'Em vez de excluir, peça uma edição do lançamento para corrigir valor, conta ou descrição.',
      },
    ],
    seRejeitouErrado: [
      {
        titulo: '1. Peça um novo cadastro',
        detalhe:
          'A criação rejeitada não vira lançamento. Peça que a pessoa lance de novo na data especial e mande para aprovação.',
      },
    ],
    dica: 'Datas especiais existem para o gerente revisar. Se a data ou o valor parecerem estranhos, rejeite com um motivo claro.',
  },
];

const GUIA_GERAL = {
  titulo: 'Regra de ouro',
  texto:
    'Na dúvida, rejeite com um motivo escrito. Rejeitar é mais fácil de corrigir: o funcionário só manda o pedido de novo. Aprovar errado mexe no saldo e exige um caminho de correção (editar, excluir, estornar ou reverter).',
};

function metaDoTipo(tipo: TipoSolicitacao): TipoMeta {
  return TIPO_META[tipo] || { ...TIPO_FALLBACK, label: String(tipo) };
}

const currency = (value: unknown) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);

const dateTime = (value?: unknown) =>
  typeof value === 'string' && value
    ? new Date(value).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

const dateOnly = (value?: unknown) => {
  if (typeof value !== 'string' || !value) return '—';
  const raw = value.includes('T') ? value : `${value}T12:00:00`;
  return new Date(raw).toLocaleDateString('pt-BR');
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extrairResumo(item: Solic) {
  const antigos = asRecord(item.dados_antigos);
  const novos = asRecord(item.dados_novos);
  const tipo = item.tipo_solicitacao;

  if (tipo === 'CRIACAO_DATAS_ESPECIAIS') {
    const proposto = asRecord(novos.lancamento_proposto);
    const pai = asRecord(proposto.dados_pai);
    const base = Object.keys(pai).length ? pai : proposto;
    return {
      descricao: String(base.descricao || 'Lançamento proposto'),
      valor: base.valor,
      data: base.data_transacao,
      tipoLanc: base.tipo,
      idLancamento: item.id_lancamento ?? null,
      antes: null as Record<string, unknown> | null,
      depois: base,
    };
  }

  if (tipo === 'EDICAO') {
    const depois = novos.dados_pai ? asRecord(novos.dados_pai) : novos;
    const antes = antigos.dados_pai ? asRecord(antigos.dados_pai) : antigos;
    return {
      descricao: String(depois.descricao || antes.descricao || 'Lançamento'),
      valor: depois.valor ?? antes.valor,
      data: depois.data_transacao ?? antes.data_transacao,
      tipoLanc: depois.tipo ?? antes.tipo,
      idLancamento: item.id_lancamento ?? null,
      antes,
      depois,
    };
  }

  if (tipo === 'ESTORNO') {
    return {
      descricao: String(antigos.descricao || 'Lançamento a estornar'),
      valor: novos.valor_estornado ?? antigos.valor,
      data: novos.data_transacao ?? antigos.data_transacao,
      tipoLanc: antigos.tipo,
      idLancamento: item.id_lancamento ?? null,
      antes: antigos,
      depois: novos,
    };
  }

  return {
    descricao: String(antigos.descricao || novos.descricao || 'Lançamento'),
    valor: antigos.valor ?? novos.valor ?? novos.valor_estornado,
    data: antigos.data_transacao ?? novos.data_transacao,
    tipoLanc: antigos.tipo ?? novos.tipo,
    idLancamento: item.id_lancamento ?? null,
    antes: Object.keys(antigos).length ? antigos : null,
    depois: Object.keys(novos).length ? novos : null,
  };
}

function ordenarFila(items: Solic[]): Solic[] {
  return [...items].sort((a, b) => {
    const pa = metaDoTipo(a.tipo_solicitacao).prioridade;
    const pb = metaDoTipo(b.tipo_solicitacao).prioridade;
    if (pa !== pb) return pa - pb;
    return new Date(a.data_solicitacao).getTime() - new Date(b.data_solicitacao).getTime();
  });
}

export default function FinanceiroAprovacoes() {
  const { permissoes, refresh } = useFinanceiro();
  const canApprove = permissoes.includes('aprovar-alteracao-financeira');

  const [aba, setAba] = useState<AbaAprovacoes>('pendentes');
  const [items, setItems] = useState<Solic[]>([]);
  const [loading, setLoading] = useState(canApprove);
  const [error, setError] = useState<string | null>(null);

  const [historico, setHistorico] = useState<Solic[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState<string | null>(null);
  const [histFiltro, setHistFiltro] = useState<FiltroHistorico>('');
  const [histPage, setHistPage] = useState(1);
  const [histTotal, setHistTotal] = useState(0);
  const [histTotalPaginas, setHistTotalPaginas] = useState(1);

  const [guiaAberto, setGuiaAberto] = useState(false);
  /** Pill ativa no guia: 'GERAL' = regra de ouro; demais = tipo de solicitação */
  const [guiaPill, setGuiaPill] = useState<string>('GERAL');
  const [busyId, setBusyId] = useState<string | number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Solic | null>(null);
  const [rejectMotivo, setRejectMotivo] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const loadPendentes = useCallback(async () => {
    if (!canApprove) {
      setLoading(false);
      setItems([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFinanceiro<Solic[]>('/aprovacoes-pendentes');
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as aprovações.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [canApprove]);

  const loadHistorico = useCallback(async (page = 1, status: FiltroHistorico = '') => {
    if (!canApprove) {
      setHistorico([]);
      setHistLoading(false);
      setHistTotal(0);
      return;
    }
    setHistLoading(true);
    setHistError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(HIST_LIMIT),
      });
      if (status) params.set('status', status);
      const data = await fetchFinanceiro<HistoricoResponse>(`/aprovacoes-historico?${params}`);
      const rows = Array.isArray(data?.rows)
        ? data.rows
        : Array.isArray(data)
          ? (data as unknown as Solic[])
          : [];
      setHistorico(rows);
      setHistTotal(Number(data?.total) || rows.length || 0);
      setHistTotalPaginas(Math.max(1, Number(data?.totalPaginas) || 1));
      if (data?.page) setHistPage(Number(data.page) || page);
    } catch (err) {
      console.error('[FinanceiroAprovacoes] histórico:', err);
      setHistError(err instanceof Error ? err.message : 'Não foi possível carregar o histórico.');
      setHistorico([]);
      setHistTotal(0);
    } finally {
      setHistLoading(false);
    }
  }, [canApprove]);

  useEffect(() => {
    void loadPendentes();
  }, [loadPendentes]);

  useEffect(() => {
    if (aba !== 'historico' || !canApprove) return;
    void loadHistorico(histPage, histFiltro);
  }, [aba, canApprove, histPage, histFiltro, loadHistorico]);

  const irParaHistorico = () => {
    setActionError(null);
    setActionSuccess(null);
    setAba('historico');
    // força reload mesmo se já estiver na aba
    void loadHistorico(histPage, histFiltro);
  };

  const irParaPendentes = () => {
    setActionError(null);
    setActionSuccess(null);
    setAba('pendentes');
    void loadPendentes();
  };

  const fila = useMemo(() => ordenarFila(items), [items]);

  const guiaAtivo = useMemo(
    () => GUIAS.find((g) => g.tipo === guiaPill) ?? null,
    [guiaPill],
  );
  const metaGuiaAtivo = guiaAtivo ? metaDoTipo(guiaAtivo.tipo) : null;

  const contagemPorTipo = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const key = item.tipo_solicitacao || 'OUTRO';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()]
      .map(([tipo, total]) => ({ tipo, total, meta: metaDoTipo(tipo) }))
      .sort((a, b) => a.meta.prioridade - b.meta.prioridade);
  }, [items]);

  const refreshAll = async () => {
    await loadPendentes();
    if (aba === 'historico') await loadHistorico(histPage, histFiltro);
    refresh('lancamentos');
    refresh('header');
    refresh('dashboard');
    refresh('agenda');
  };

  const decidir = async (id: string | number, action: 'aprovar' | 'rejeitar', motivo?: string) => {
    setActionError(null);
    setActionSuccess(null);
    setBusyId(id);
    try {
      await fetchFinanceiro(`/aprovacoes/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(action === 'rejeitar' ? { motivo } : {}),
      });
      setRejectTarget(null);
      setRejectMotivo('');
      await refreshAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível processar a solicitação.';
      if (action === 'rejeitar') setRejectError(msg);
      else setActionError(msg);
    } finally {
      setBusyId(null);
    }
  };

  const confirmarAprovar = async (item: Solic) => {
    const meta = metaDoTipo(item.tipo_solicitacao);
    let extra = 'Isso altera o financeiro de verdade (saldo / extrato).<br>Na dúvida, rejeite e peça um novo pedido.';
    if (item.tipo_solicitacao === 'EXCLUSAO' && item.origem_exclusao === 'agenda') {
      extra =
        `Isso é a <strong>baixa da parcela #${item.contexto_agenda?.id_agenda}</strong> da Agenda` +
        (item.contexto_agenda?.descricao ? ` (“${item.contexto_agenda.descricao}”)` : '') +
        `.<br>Ao aprovar: some do extrato e a parcela <strong>volta pendente</strong> na Agenda.`;
    } else if (item.tipo_solicitacao === 'EXCLUSAO' && item.origem_exclusao === 'lancamento') {
      extra = 'É um <strong>lançamento normal</strong> (não Agenda). Ao aprovar, some do extrato e do saldo.';
    }
    const ok = await mostrarConfirmacao(
      `Aprovar <strong>${meta.shortLabel.toLowerCase()}</strong>?<br><br>${extra}`,
      {
        tipo: meta.tone === 'exclusao' || meta.tone === 'estorno' ? 'perigo' : 'aviso',
        textoConfirmar: 'Aprovar',
        textoCancelar: 'Cancelar',
      },
    );
    if (!ok) return;
    void decidir(item.id, 'aprovar');
  };

  const confirmarDesfazerExclusao = async (item: Solic) => {
    const resumo = extrairResumo(item);
    const eAgenda = item.origem_exclusao === 'agenda';
    const detalheAgenda = eAgenda
      ? `Era a <strong>baixa da parcela #${item.contexto_agenda?.id_agenda}</strong> da Agenda` +
        (item.contexto_agenda?.descricao ? ` (“${item.contexto_agenda.descricao}”)` : '') +
        `. A parcela volta a “paga” e o valor volta ao saldo.`
      : `Era um <strong>lançamento normal</strong> (não veio da Agenda). Ele volta ao extrato e ao saldo.`;

    const ok = await mostrarConfirmacao(
      `Desfazer a exclusão do lançamento <strong>#${item.id_lancamento}</strong>?<br><br>` +
        `<em>${resumo.descricao}</em> · ${currency(resumo.valor)}<br><br>` +
        detalheAgenda,
      {
        tipo: 'aviso',
        textoConfirmar: 'Desfazer exclusão',
        textoCancelar: 'Cancelar',
      },
    );
    if (!ok) return;

    setActionError(null);
    setActionSuccess(null);
    setBusyId(item.id);
    try {
      const resp = await fetchFinanceiro<{ message?: string }>(`/aprovacoes/${item.id}/desfazer-exclusao`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setActionSuccess(resp?.message || 'Exclusão desfeita. O lançamento voltou ao extrato.');
      await refreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível desfazer a exclusão.');
    } finally {
      setBusyId(null);
    }
  };

  const enviarRejeicao = () => {
    if (!rejectTarget) return;
    const motivo = rejectMotivo.trim();
    if (motivo.length < 3) {
      setRejectError('Escreva um motivo claro (mínimo 3 caracteres) para o funcionário entender.');
      return;
    }
    setRejectError(null);
    void decidir(rejectTarget.id, 'rejeitar', motivo);
  };

  const mudarFiltroHistorico = (status: FiltroHistorico) => {
    setHistFiltro(status);
    setHistPage(1);
  };

  if (!canApprove) {
    return (
      <div className="fc-aprovacoes-shell">
        <header className="fc-aprovacoes-shell-header">
          <h2 className="fc-aprovacoes-shell-title">Aprovações</h2>
        </header>
        <div className="fc-aprovacoes-shell-body">
          <UIFeedbackNotFound
            icon="fa-lock"
            titulo="Acesso restrito"
            mensagem="Você não tem permissão para ver ou decidir solicitações financeiras. Peça ao administrador a permissão “aprovar alteração financeira”."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fc-aprovacoes-shell">
      <header className="fc-aprovacoes-shell-header">
        <div className="fc-aprovacoes-shell-heading">
          <h2 className="fc-aprovacoes-shell-title">Aprovações</h2>
          <p className="fc-aprovacoes-shell-sub">
            {aba === 'pendentes'
              ? 'Fila ordenada do mais sensível (exclusão) ao mais leve (criação). Confira sempre valor e data.'
              : 'Decisões já tomadas. Exclusões aprovadas ainda “escondidas” podem ser reativadas com Desfazer exclusão.'}
          </p>
        </div>
        <div className="fc-aprovacoes-shell-actions">
          {aba === 'pendentes' && !loading && !error && (
            <span className="fc-aprovacoes-shell-badge">
              {items.length} pendente{items.length === 1 ? '' : 's'}
            </span>
          )}
          {aba === 'historico' && !histLoading && !histError && (
            <span className="fc-aprovacoes-shell-badge is-muted">
              {histTotal} registro{histTotal === 1 ? '' : 's'}
            </span>
          )}
          {!guiaAberto && (
            <button
              type="button"
              className="fc-aprovacoes-info-btn"
              onClick={() => {
                setGuiaPill('GERAL');
                setGuiaAberto(true);
              }}
              aria-expanded={false}
              aria-controls="fc-aprovacoes-guia"
              title="Abrir guia: o que fazer se errar uma aprovação"
              aria-label="Abrir guia se errar"
            >
              <i className="fas fa-circle-info" aria-hidden />
              <span>Guia se errar</span>
            </button>
          )}
        </div>
      </header>

      <nav className="fc-aprovacoes-subnav" aria-label="Seções de aprovações">
        <button
          type="button"
          className={`fc-aprovacoes-subnav-btn${aba === 'pendentes' ? ' is-ativo' : ''}`}
          onClick={irParaPendentes}
          aria-pressed={aba === 'pendentes'}
        >
          <i className="fas fa-hourglass-half" aria-hidden />
          Pendentes
          {items.length > 0 && <em>{items.length}</em>}
        </button>
        <button
          type="button"
          className={`fc-aprovacoes-subnav-btn${aba === 'historico' ? ' is-ativo' : ''}`}
          onClick={irParaHistorico}
          aria-pressed={aba === 'historico'}
        >
          <i className="fas fa-history" aria-hidden />
          Histórico de decisões
        </button>
      </nav>

      {guiaAberto && (
        <aside id="fc-aprovacoes-guia" className="fc-aprovacoes-guia" aria-label="Guia do gerente">
          <div className="fc-aprovacoes-guia-topo">
            <div className="fc-aprovacoes-guia-topo-texto">
              <h3 className="fc-aprovacoes-guia-titulo">
                <i className="fas fa-circle-info" aria-hidden />
                Guia: o que fazer se errar
              </h3>
              <p className="fc-aprovacoes-guia-intro">
                Escolha o tipo de pedido abaixo. Só o conteúdo daquele tipo aparece. Isto não fecha a tela de Aprovações.
              </p>
            </div>
          </div>

          <div className="fc-aprovacoes-guia-pills" role="tablist" aria-label="Tipo de solicitação no guia">
            <button
              type="button"
              role="tab"
              aria-selected={guiaPill === 'GERAL'}
              className={`fc-aprovacoes-guia-pill is-geral${guiaPill === 'GERAL' ? ' is-ativo' : ''}`}
              onClick={() => setGuiaPill('GERAL')}
            >
              <i className="fas fa-lightbulb" aria-hidden />
              Regra de ouro
            </button>
            {GUIAS.map((guia) => {
              const meta = metaDoTipo(guia.tipo);
              const ativo = guiaPill === guia.tipo;
              return (
                <button
                  key={guia.tipo}
                  type="button"
                  role="tab"
                  aria-selected={ativo}
                  className={`fc-aprovacoes-guia-pill is-${meta.tone}${ativo ? ' is-ativo' : ''}`}
                  onClick={() => setGuiaPill(guia.tipo)}
                >
                  <i className={`fas ${meta.icon}`} aria-hidden />
                  {meta.shortLabel}
                </button>
              );
            })}
          </div>

          <div className="fc-aprovacoes-guia-conteudo" role="tabpanel">
            {guiaPill === 'GERAL' && (
              <div className="fc-aprovacoes-guia-regra">
                <div className="fc-aprovacoes-guia-regra-icon" aria-hidden>
                  <i className="fas fa-lightbulb" />
                </div>
                <div>
                  <strong>{GUIA_GERAL.titulo}</strong>
                  <p>{GUIA_GERAL.texto}</p>
                  <p className="fc-aprovacoes-guia-regra-hint">
                    Toque em um tipo acima (Exclusão, Estorno, Edição…) para ver o passo a passo daquele caso.
                  </p>
                </div>
              </div>
            )}

            {guiaAtivo && metaGuiaAtivo && (
              <article className={`fc-aprovacoes-guia-card is-${metaGuiaAtivo.tone}`}>
                <header className="fc-aprovacoes-guia-card-head">
                  <span className={`fc-aprovacoes-tipo-badge is-${metaGuiaAtivo.tone}`}>
                    <i className={`fas ${metaGuiaAtivo.icon}`} aria-hidden />
                    {metaGuiaAtivo.shortLabel}
                  </span>
                  <h3>{guiaAtivo.titulo}</h3>
                </header>

                <div className="fc-aprovacoes-guia-bloco is-info">
                  <div className="fc-aprovacoes-guia-bloco-label">
                    <i className="fas fa-play-circle" aria-hidden /> O que acontece se aprovar
                  </div>
                  <p>{guiaAtivo.oQueAcontece}</p>
                </div>

                <div className="fc-aprovacoes-guia-bloco is-perigo">
                  <div className="fc-aprovacoes-guia-bloco-label">
                    <i className="fas fa-exclamation-triangle" aria-hidden /> Aprovei por engano — o que fazer
                  </div>
                  <ol className="fc-aprovacoes-guia-passos">
                    {guiaAtivo.seAprovouErrado.map((passo) => (
                      <li key={passo.titulo}>
                        <strong>{passo.titulo}</strong>
                        <span>{passo.detalhe}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="fc-aprovacoes-guia-bloco is-aviso">
                  <div className="fc-aprovacoes-guia-bloco-label">
                    <i className="fas fa-times-circle" aria-hidden /> Rejeitei por engano — o que fazer
                  </div>
                  <ol className="fc-aprovacoes-guia-passos">
                    {guiaAtivo.seRejeitouErrado.map((passo) => (
                      <li key={passo.titulo}>
                        <strong>{passo.titulo}</strong>
                        <span>{passo.detalhe}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <p className="fc-aprovacoes-guia-dica">
                  <i className="fas fa-check" aria-hidden /> {guiaAtivo.dica}
                </p>
              </article>
            )}
          </div>

          <div className="fc-aprovacoes-guia-rodape">
            <button
              type="button"
              className="fc-aprovacoes-guia-fechar-cta"
              onClick={() => setGuiaAberto(false)}
            >
              <i className="fas fa-chevron-up" aria-hidden />
              Fechar este guia
            </button>
          </div>
        </aside>
      )}

      <div className="fc-aprovacoes-shell-body">
        {actionError && (
          <div className="fc-aprovacoes-action-error" role="alert">
            <i className="fas fa-exclamation-circle" aria-hidden />
            <span>{actionError}</span>
            <button type="button" onClick={() => setActionError(null)} aria-label="Fechar">
              &times;
            </button>
          </div>
        )}

        {actionSuccess && (
          <div className="fc-aprovacoes-action-success" role="status">
            <i className="fas fa-check-circle" aria-hidden />
            <span>{actionSuccess}</span>
            <button type="button" onClick={() => setActionSuccess(null)} aria-label="Fechar">
              &times;
            </button>
          </div>
        )}

        {aba === 'pendentes' && (
          <>
            {contagemPorTipo.length > 0 && !loading && !error && (
              <div className="fc-aprovacoes-hierarquia" aria-label="Ordem de prioridade da fila">
                <span className="fc-aprovacoes-hierarquia-label">
                  <i className="fas fa-layer-group" aria-hidden /> Prioridade na fila
                </span>
                <div className="fc-aprovacoes-hierarquia-chips">
                  {contagemPorTipo.map(({ tipo, total, meta }, index) => (
                    <span key={tipo} className={`fc-aprovacoes-hierarquia-chip is-${meta.tone}`}>
                      <span className="fc-aprovacoes-hierarquia-ordem">{index + 1}º</span>
                      <i className={`fas ${meta.icon}`} aria-hidden />
                      {meta.shortLabel}
                      <em>{total}</em>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {loading && <UICarregando variante="bloco" tamanho="md" texto="Buscando solicitações..." />}

            {!loading && error && (
              <UIFeedbackNotFound
                icon="fa-exclamation-triangle"
                titulo="Não foi possível carregar"
                mensagem={error}
              >
                <button type="button" className="fc-btn fc-btn-primario" onClick={() => void loadPendentes()}>
                  <i className="fas fa-sync-alt" /> Tentar de novo
                </button>
              </UIFeedbackNotFound>
            )}

            {!loading && !error && fila.length === 0 && (
              <UIFeedbackNotFound
                icon="fa-check-double"
                titulo="Nenhuma aprovação pendente"
                mensagem="Quando um funcionário pedir exclusão, edição, estorno ou criação em data especial, o pedido aparece aqui — do mais sensível para o mais leve."
              />
            )}

            {!loading && !error && fila.length > 0 && (
              <div className="fc-aprovacoes-lista">
                {fila.map((item, index) => {
                  const meta = metaDoTipo(item.tipo_solicitacao);
                  const resumo = extrairResumo(item);
                  const busy = busyId === item.id;
                  const mostrarDiff = item.tipo_solicitacao === 'EDICAO' && resumo.antes && resumo.depois;
                  const eExclusao = item.tipo_solicitacao === 'EXCLUSAO';
                  const eAgenda = eExclusao && item.origem_exclusao === 'agenda';
                  const eLancNormal = eExclusao && item.origem_exclusao === 'lancamento';

                  return (
                    <article
                      key={item.id}
                      className={`fc-aprovacao-card is-${meta.tone}${eAgenda ? ' is-origem-agenda' : ''}`}
                      style={{ '--fc-aprov-ordem': index + 1 } as CSSProperties}
                    >
                      <div className="card-borda-charme" aria-hidden />

                      <div className="fc-aprovacao-card-topo">
                        <div className="fc-aprovacao-card-topo-esq">
                          <span className={`fc-aprovacoes-tipo-badge is-${meta.tone}`}>
                            <i className={`fas ${meta.icon}`} aria-hidden />
                            {meta.shortLabel}
                          </span>
                          {eAgenda && (
                            <span className="fc-aprovacoes-origem-badge is-agenda">
                              <i className="fas fa-calendar-check" aria-hidden />
                              {item.resumo_origem?.label || `Agenda · parcela #${item.contexto_agenda?.id_agenda}`}
                            </span>
                          )}
                          {eLancNormal && (
                            <span className="fc-aprovacoes-origem-badge is-lancamento">
                              <i className="fas fa-receipt" aria-hidden />
                              Lançamento normal
                            </span>
                          )}
                          <span className="fc-aprovacao-prioridade" title="Posição na fila (mais sensível primeiro)">
                            {index + 1}º na fila
                          </span>
                        </div>
                        <time className="fc-aprovacao-quando" dateTime={item.data_solicitacao}>
                          {dateTime(item.data_solicitacao)}
                        </time>
                      </div>

                      <header className="fc-aprovacao-card-header">
                        <h3 className="fc-aprovacao-titulo">{resumo.descricao}</h3>
                        <p className="fc-aprovacao-tipo-desc">{meta.descricaoFila}</p>
                        <div className="fc-aprovacao-meta-linha">
                          <span>
                            <i className="fas fa-user" aria-hidden />
                            {item.nome_solicitante || 'Solicitante'}
                          </span>
                          {resumo.idLancamento != null && (
                            <span>
                              <i className="fas fa-hashtag" aria-hidden />
                              Lanç. {resumo.idLancamento}
                            </span>
                          )}
                          {resumo.tipoLanc != null && (
                            <span className={`fc-aprovacao-pill-tipo is-${String(resumo.tipoLanc).toLowerCase()}`}>
                              {String(resumo.tipoLanc)}
                            </span>
                          )}
                        </div>
                      </header>

                      <div className="fc-aprovacao-card-body">
                        <div className="fc-aprovacao-destaques">
                          <div className="fc-aprovacao-destaque">
                            <small>Valor</small>
                            <strong>{currency(resumo.valor)}</strong>
                          </div>
                          <div className="fc-aprovacao-destaque">
                            <small>Data</small>
                            <strong>{dateOnly(resumo.data)}</strong>
                          </div>
                          {eAgenda && item.contexto_agenda?.data_vencimento != null && (
                            <div className="fc-aprovacao-destaque">
                              <small>Venc. agenda</small>
                              <strong>{dateOnly(String(item.contexto_agenda.data_vencimento))}</strong>
                            </div>
                          )}
                        </div>

                        {mostrarDiff && (
                          <ul className="fc-aprovacao-alteracoes-lista">
                            {(['valor', 'data_transacao', 'descricao'] as const).map((campo) => {
                              const labels = {
                                valor: 'Valor',
                                data_transacao: 'Data',
                                descricao: 'Descrição',
                              };
                              const antes = resumo.antes?.[campo];
                              const depois = resumo.depois?.[campo];
                              if (antes == null && depois == null) return null;
                              if (String(antes ?? '') === String(depois ?? '')) return null;
                              const fmt = (v: unknown) => {
                                if (campo === 'valor') return currency(v);
                                if (campo === 'data_transacao') return dateOnly(v);
                                return String(v ?? '—');
                              };
                              return (
                                <li key={campo}>
                                  <span className="label">{labels[campo]}</span>
                                  <div className="fc-aprovacao-diff">
                                    <span className="valor-antigo">{fmt(antes)}</span>
                                    <span className="seta-indicador" aria-hidden>
                                      →
                                    </span>
                                    <span className="valor-novo">{fmt(depois)}</span>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}

                        {item.tipo_solicitacao === 'ESTORNO' && (
                          <div className="fc-aprovacao-aviso-tipo">
                            <i className="fas fa-info-circle" aria-hidden />
                            Será criado um lançamento de estorno de {currency(resumo.valor)} e o original #
                            {resumo.idLancamento} ficará marcado como estornado.
                          </div>
                        )}

                        {eAgenda && (
                          <div className="fc-aprovacao-aviso-tipo is-agenda-ctx">
                            <i className="fas fa-calendar-check" aria-hidden />
                            <span>
                              <strong>Isso é uma baixa da Agenda</strong>
                              {item.contexto_agenda?.descricao
                                ? ` — parcela #${item.contexto_agenda.id_agenda}: “${item.contexto_agenda.descricao}”.`
                                : ` — parcela #${item.contexto_agenda?.id_agenda}.`}{' '}
                              Se você aprovar a exclusão, o valor some do extrato e a parcela <strong>volta como pendente</strong> na Agenda (pode ser baixada de novo).
                            </span>
                          </div>
                        )}

                        {eLancNormal && (
                          <div className="fc-aprovacao-aviso-tipo is-perigo">
                            <i className="fas fa-receipt" aria-hidden />
                            <span>
                              <strong>Lançamento normal</strong> (não veio da Agenda). Se aprovar, some do extrato e do saldo.
                            </span>
                          </div>
                        )}

                        {eExclusao && !eAgenda && !eLancNormal && (
                          <div className="fc-aprovacao-aviso-tipo is-perigo">
                            <i className="fas fa-info-circle" aria-hidden />
                            O lançamento some do extrato e do saldo. Se for baixa de Agenda, a parcela volta a pendente.
                          </div>
                        )}

                        <div className="fc-aprovacao-justificativa">
                          <small>Justificativa do solicitante</small>
                          <p>{item.justificativa_solicitante?.trim() || 'Não informada'}</p>
                        </div>
                      </div>

                      <div className="acoes-aprovacao">
                        <div className="fc-aprovacao-acoes-contexto" aria-live="polite">
                          {eAgenda ? (
                            <>
                              <i className="fas fa-calendar-check" aria-hidden />
                              <span>
                                <strong>Agenda</strong>
                                {item.contexto_agenda?.id_agenda != null && <> · parcela #{item.contexto_agenda.id_agenda}</>}
                                {item.contexto_agenda?.descricao
                                  ? <> — {item.contexto_agenda.descricao}</>
                                  : null}
                              </span>
                            </>
                          ) : eLancNormal ? (
                            <>
                              <i className="fas fa-receipt" aria-hidden />
                              <span>
                                <strong>Lançamento normal</strong> — não é Agenda
                              </span>
                            </>
                          ) : (
                            <span className="fc-aprovacao-acoes-contexto-vazio" aria-hidden />
                          )}
                        </div>
                        <div className="fc-aprovacao-acoes-botoes">
                          <button
                            type="button"
                            className="fc-btn fc-btn-secundario"
                            disabled={busy}
                            onClick={() => {
                              setRejectTarget(item);
                              setRejectMotivo('');
                              setRejectError(null);
                            }}
                          >
                            <i className="fas fa-times" /> Rejeitar
                          </button>
                          <button
                            type="button"
                            className="fc-btn fc-btn-primario"
                            disabled={busy}
                            onClick={() => void confirmarAprovar(item)}
                          >
                            {busy ? (
                              <>
                                <UICarregando variante="inline" /> Processando…
                              </>
                            ) : (
                              <>
                                <i className="fas fa-check" /> Aprovar
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}

        {aba === 'historico' && (
          <>
            <div className="fc-aprovacoes-hist-toolbar">
              <div className="fc-aprovacoes-hist-filtros" role="group" aria-label="Filtrar histórico">
                {(
                  [
                    { value: '' as FiltroHistorico, label: 'Todos' },
                    { value: 'APROVADO' as FiltroHistorico, label: 'Aprovadas' },
                    { value: 'REJEITADO' as FiltroHistorico, label: 'Rejeitadas' },
                  ] as const
                ).map((op) => (
                  <button
                    key={op.value || 'todos'}
                    type="button"
                    className={`fc-aprovacoes-hist-filtro${histFiltro === op.value ? ' is-ativo' : ''}`}
                    onClick={() => mudarFiltroHistorico(op.value)}
                  >
                    {op.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="fc-btn-atualizar"
                title="Atualizar histórico de decisões"
                disabled={histLoading}
                onClick={() => void loadHistorico(histPage, histFiltro)}
              >
                <i className={`fas fa-sync-alt ${histLoading ? 'fa-spin' : ''}`} /> Atualizar
              </button>
            </div>

            {histLoading && <UICarregando variante="bloco" tamanho="md" texto="Carregando histórico de decisões..." />}

            {!histLoading && histError && (
              <UIFeedbackNotFound
                icon="fa-exclamation-triangle"
                titulo="Não foi possível carregar o histórico"
                mensagem={histError}
              >
                <button
                  type="button"
                  className="fc-btn fc-btn-primario"
                  onClick={() => void loadHistorico(histPage, histFiltro)}
                >
                  <i className="fas fa-sync-alt" /> Tentar de novo
                </button>
              </UIFeedbackNotFound>
            )}

            {!histLoading && !histError && historico.length === 0 && (
              <UIFeedbackNotFound
                icon="fa-clipboard-check"
                titulo="Nenhuma decisão registrada"
                mensagem={
                  histFiltro
                    ? `Não há solicitações com status “${histFiltro === 'APROVADO' ? 'Aprovada' : 'Rejeitada'}” neste filtro. Tente “Todos”.`
                    : 'Aqui só entram pedidos que passaram pela fila de aprovação (aprovados ou rejeitados). Exclusões/edições feitas com permissão direta (sem pedir aprovação) não aparecem neste histórico. O número de “registros” no monitoramento de contas (topo da página) é outra coisa — contas atrasadas/vencendo, não aprovações.'
                }
              />
            )}

            {!histLoading && !histError && historico.length > 0 && (
              <>
                <div className="fc-aprovacoes-lista">
                  {historico.map((item) => {
                    const meta = metaDoTipo(item.tipo_solicitacao);
                    const resumo = extrairResumo(item);
                    const busy = busyId === item.id;
                    const aprovado = item.status === 'APROVADO';
                    const rejeitado = item.status === 'REJEITADO';

                    return (
                      <article
                        key={item.id}
                        className={`fc-aprovacao-card is-historico is-${meta.tone} ${aprovado ? 'is-decisao-aprovado' : ''} ${rejeitado ? 'is-decisao-rejeitado' : ''}`}
                      >
                        <div className="card-borda-charme" aria-hidden />

                        <div className="fc-aprovacao-card-topo">
                          <div className="fc-aprovacao-card-topo-esq">
                            <span className={`fc-aprovacoes-tipo-badge is-${meta.tone}`}>
                              <i className={`fas ${meta.icon}`} aria-hidden />
                              {meta.shortLabel}
                            </span>
                            <span
                              className={`fc-aprovacoes-status-badge is-${aprovado ? 'aprovado' : rejeitado ? 'rejeitado' : 'outro'}`}
                            >
                              <i className={`fas ${aprovado ? 'fa-check' : rejeitado ? 'fa-times' : 'fa-circle'}`} aria-hidden />
                              {aprovado ? 'Aprovada' : rejeitado ? 'Rejeitada' : item.status || '—'}
                            </span>
                          </div>
                          <time
                            className="fc-aprovacao-quando"
                            dateTime={item.data_decisao || item.data_solicitacao}
                          >
                            {dateTime(item.data_decisao || item.data_solicitacao)}
                          </time>
                        </div>

                        <header className="fc-aprovacao-card-header">
                          <h3 className="fc-aprovacao-titulo">{resumo.descricao}</h3>
                          <div className="fc-aprovacao-meta-linha">
                            <span>
                              <i className="fas fa-user" aria-hidden />
                              Pediu: {item.nome_solicitante || '—'}
                            </span>
                            <span>
                              <i className="fas fa-user-check" aria-hidden />
                              Decidiu: {item.nome_aprovador || '—'}
                            </span>
                            {resumo.idLancamento != null && (
                              <span>
                                <i className="fas fa-hashtag" aria-hidden />
                                Lanç. {resumo.idLancamento}
                              </span>
                            )}
                            {item.tipo_solicitacao === 'EXCLUSAO' && item.origem_exclusao === 'agenda' && (
                              <span className="fc-aprovacoes-origem-badge is-agenda" title="Veio de uma baixa na Agenda">
                                <i className="fas fa-calendar-check" aria-hidden />
                                Agenda · parcela #{item.contexto_agenda?.id_agenda}
                              </span>
                            )}
                            {item.tipo_solicitacao === 'EXCLUSAO' && item.origem_exclusao === 'lancamento' && (
                              <span className="fc-aprovacoes-origem-badge is-lancamento" title="Lançamento avulso">
                                <i className="fas fa-receipt" aria-hidden />
                                Lançamento normal
                              </span>
                            )}
                          </div>
                        </header>

                        <div className="fc-aprovacao-card-body">
                          <div className="fc-aprovacao-destaques">
                            <div className="fc-aprovacao-destaque">
                              <small>Valor</small>
                              <strong>{currency(resumo.valor)}</strong>
                            </div>
                            <div className="fc-aprovacao-destaque">
                              <small>Data do lanç.</small>
                              <strong>{dateOnly(resumo.data)}</strong>
                            </div>
                            <div className="fc-aprovacao-destaque">
                              <small>Pedido em</small>
                              <strong>{dateTime(item.data_solicitacao)}</strong>
                            </div>
                          </div>

                          {item.justificativa_solicitante?.trim() && (
                            <div className="fc-aprovacao-justificativa">
                              <small>Justificativa do solicitante</small>
                              <p>{item.justificativa_solicitante.trim()}</p>
                            </div>
                          )}

                          {rejeitado && item.motivo_rejeicao?.trim() && (
                            <div className="fc-aprovacao-justificativa is-rejeicao">
                              <small>Motivo da rejeição</small>
                              <p>{item.motivo_rejeicao.trim()}</p>
                            </div>
                          )}

                          {aprovado && item.tipo_solicitacao === 'EXCLUSAO' && item.mensagem_desfazer && (
                            <div
                              className={
                                `fc-aprovacao-aviso-tipo` +
                                (item.pode_desfazer_exclusao
                                  ? ' is-info-desfazer'
                                  : item.bloqueio_desfazer
                                    ? ' is-bloqueio-desfazer'
                                    : '')
                              }
                            >
                              <i
                                className={`fas ${
                                  item.pode_desfazer_exclusao
                                    ? 'fa-undo'
                                    : item.bloqueio_desfazer
                                      ? 'fa-ban'
                                      : 'fa-info-circle'
                                }`}
                                aria-hidden
                              />
                              <span>{item.mensagem_desfazer}</span>
                            </div>
                          )}
                        </div>

                        {item.pode_desfazer_exclusao && (
                          <div className="acoes-aprovacao">
                            <button
                              type="button"
                              className="fc-btn fc-btn-primario fc-aprovacoes-btn-desfazer"
                              disabled={busy}
                              onClick={() => void confirmarDesfazerExclusao(item)}
                            >
                              {busy ? (
                                <>
                                  <UICarregando variante="inline" /> Reativando…
                                </>
                              ) : (
                                <>
                                  <i className="fas fa-undo" />{' '}
                                  {item.origem_exclusao === 'agenda'
                                    ? 'Desfazer exclusão (reativar baixa)'
                                    : 'Desfazer exclusão'}
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

                {histTotalPaginas > 1 && (
                  <div className="gs-paginacao-container" aria-label="Paginação do histórico">
                    <button
                      type="button"
                      className="gs-paginacao-btn"
                      disabled={histPage <= 1 || histLoading}
                      onClick={() => setHistPage((p) => Math.max(1, p - 1))}
                    >
                      Anterior
                    </button>
                    <span className="gs-paginacao-info">
                      Pág. {histPage} de {histTotalPaginas}
                    </span>
                    <button
                      type="button"
                      className="gs-paginacao-btn"
                      disabled={histPage >= histTotalPaginas || histLoading}
                      onClick={() => setHistPage((p) => Math.min(histTotalPaginas, p + 1))}
                    >
                      Próximo
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {rejectTarget && (
        <div className="fc-modal" style={{ display: 'flex' }} role="dialog" aria-modal="true" aria-labelledby="fc-aprov-rejeitar-titulo">
          <div className="fc-modal-content fc-aprovacoes-reject-modal">
            <button
              type="button"
              className="fc-modal-close"
              onClick={() => {
                if (busyId) return;
                setRejectTarget(null);
              }}
            >
              X
            </button>
            <h3 id="fc-aprov-rejeitar-titulo" className="fc-section-title" style={{ textAlign: 'center' }}>
              Rejeitar solicitação
            </h3>
            <p className="fc-aprovacoes-reject-resumo">
              {metaDoTipo(rejectTarget.tipo_solicitacao).shortLabel} ·{' '}
              <strong>{extrairResumo(rejectTarget).descricao}</strong>
            </p>
            <p className="fc-aprovacoes-reject-hint">
              O funcionário verá este motivo. A rejeição <strong>não reabre sozinha</strong> — se errar, peça um pedido novo.
            </p>
            <div className="fc-modal-body">
              <div className="fc-form-group">
                <label htmlFor="fc-aprov-motivo">Motivo da rejeição</label>
                <textarea
                  id="fc-aprov-motivo"
                  className="fc-input fc-aprovacoes-reject-textarea"
                  rows={4}
                  value={rejectMotivo}
                  onChange={(e) => setRejectMotivo(e.target.value)}
                  placeholder="Ex.: valor não confere com o comprovante; data incorreta; falta anexo…"
                  disabled={busyId === rejectTarget.id}
                />
              </div>
              {rejectError && (
                <p className="fc-aprovacoes-reject-error" role="alert">
                  {rejectError}
                </p>
              )}
            </div>
            <div className="fc-modal-footer">
              <button
                type="button"
                className="fc-btn fc-btn-secundario"
                disabled={busyId === rejectTarget.id}
                onClick={() => setRejectTarget(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="fc-btn fc-btn-primario"
                disabled={busyId === rejectTarget.id}
                onClick={enviarRejeicao}
              >
                {busyId === rejectTarget.id ? 'Enviando…' : 'Confirmar rejeição'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
