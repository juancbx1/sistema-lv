import { useEffect, useMemo, useState, type FormEvent } from 'react';
import UIAutocompleteAPI, { type AutocompleteItem } from './UIAutocompleteAPI.tsx';
import UISearchableSelect, { type SearchableOption } from './UISearchableSelect.tsx';
import FinanceiroModalShell, { FinanceiroResumoOperacao } from './FinanceiroModalShell';
import { fetchFinanceiro } from '../utils/financeiro-api';
import { mostrarMensagem, mostrarPromptTexto } from '../../js/utils/popups.js';
import type {
  FinanceiroAgendaItem,
  FinanceiroCategoria,
  FinanceiroConta,
  FinanceiroGrupo,
  FinanceiroLancamento,
  FinanceiroLancamentoItem,
} from '../utils/financeiro-types';

type Momento = 'agora' | 'agendar';
type Intencao = 'paguei' | 'recebi';
type Estrutura = 'unico' | 'compra' | 'rateio';
type IdValue = string | number | null;

interface CompositorItem {
  id: string;
  descricao: string;
  categoriaId: IdValue;
  contato: AutocompleteItem | null;
  quantidade: string;
  valorUnitario: string;
  valor: string;
}

interface Parcela {
  id: string;
  data: string;
  valor: string;
}

interface CategoriaSugerida {
  id: string | number;
  nome: string;
  nome_grupo?: string;
  frequencia: number;
  confianca: number;
  explicacao: string;
}

interface ContatoSugerido {
  id: string | number;
  nome: string;
  frequencia: number;
  confianca: number;
  explicacao: string;
}

interface SugestaoResponse {
  categorias: CategoriaSugerida[];
  descricoes: Array<{ texto: string; frequencia: number; origem: string }>;
  contatos: ContatoSugerido[];
}

interface Props {
  isOpen: boolean;
  momentoInicial: Momento;
  onClose: () => void;
  onSuccess: () => void;
  lancamento?: FinanceiroLancamento | null;
  agendamento?: FinanceiroAgendaItem | null;
  permissoes: string[];
  contas: FinanceiroConta[];
  categorias: FinanceiroCategoria[];
  grupos: FinanceiroGrupo[];
}

interface SimplesPayload {
  tipo: 'DESPESA' | 'RECEITA';
  valor: number;
  data_transacao: string;
  id_categoria: IdValue;
  id_conta_bancaria: IdValue;
  id_contato: string | number | null;
  descricao: string;
  justificativa?: string;
}

interface DetalhadoPayload {
  tipo_rateio: 'COMPRA' | 'DETALHADO';
  dados_pai: {
    data_transacao: string;
    id_conta_bancaria: IdValue;
    id_contato: string | number | null;
    id_categoria?: IdValue;
    descricao: string;
    valor_desconto?: number;
  };
  itens_filho: Array<Record<string, string | number | null>>;
  justificativa?: string;
}

const FORM_ID = 'financeiro-compositor-form';
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function hojeLocal(): string {
  const data = new Date();
  return new Date(data.getTime() - data.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function criarId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function itemVazio(): CompositorItem {
  return {
    id: criarId(),
    descricao: '',
    categoriaId: null,
    contato: null,
    quantidade: '1',
    valorUnitario: '',
    valor: '',
  };
}

function numero(valor: unknown): number {
  const convertido = Number(String(valor ?? '').replace(',', '.'));
  return Number.isFinite(convertido) ? convertido : 0;
}

function adicionarMeses(dataIso: string, meses: number): string {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const data = new Date(ano, mes - 1 + meses, 1);
  const ultimoDia = new Date(data.getFullYear(), data.getMonth() + 1, 0).getDate();
  data.setDate(Math.min(dia, ultimoDia));
  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, '0'),
    String(data.getDate()).padStart(2, '0'),
  ].join('-');
}

function mapearItensLancamento(itens: FinanceiroLancamentoItem[] | undefined, estrutura: Estrutura): CompositorItem[] {
  if (!itens?.length) return [itemVazio()];
  return itens.map((item) => ({
    id: String(item.id ?? criarId()),
    descricao: item.descricao_item ?? '',
    categoriaId: item.id_categoria ?? null,
    contato: item.id_contato_item
      ? { id: item.id_contato_item, nome: item.nome_contato_item ?? '' }
      : null,
    quantidade: estrutura === 'compra' ? String(item.quantidade ?? 1) : '1',
    valorUnitario: estrutura === 'compra'
      ? String(item.valor_unitario ?? item.valor_total_item ?? '')
      : '',
    valor: estrutura === 'rateio'
      ? String(item.valor_total_item ?? item.valor_item ?? '')
      : '',
  }));
}

function mapearItensAgenda(agendamento: FinanceiroAgendaItem | null | undefined, estrutura: Estrutura): CompositorItem[] {
  if (!agendamento?.itens?.length) return [itemVazio()];
  return agendamento.itens.map((item) => ({
    id: String(item.id ?? criarId()),
    descricao: item.descricao_item ?? '',
    categoriaId: item.id_categoria ?? null,
    contato: item.id_contato_item
      ? { id: item.id_contato_item, nome: item.nome_contato_item ?? '' }
      : null,
    quantidade: '1',
    valorUnitario: estrutura === 'compra' ? String(item.valor_item ?? '') : '',
    valor: estrutura === 'rateio' ? String(item.valor_item ?? '') : '',
  }));
}

function estruturaDoRegistro(tipoRateio?: string | null): Estrutura {
  if (tipoRateio === 'COMPRA') return 'compra';
  if (tipoRateio === 'DETALHADO') return 'rateio';
  return 'unico';
}

function criarDescricaoDeterministica({
  estrutura,
  intencao,
  categoriaNome,
  contatoNome,
  quantidadeItens,
}: {
  estrutura: Estrutura;
  intencao: Intencao;
  categoriaNome?: string;
  contatoNome?: string;
  quantidadeItens: number;
}): string {
  if (estrutura === 'compra') {
    return contatoNome
      ? `Compra em ${contatoNome} — ${quantidadeItens} ${quantidadeItens === 1 ? 'item' : 'itens'}`
      : '';
  }
  if (estrutura === 'rateio') {
    if (!categoriaNome) return '';
    return `${categoriaNome}${contatoNome ? ` — ${contatoNome}` : ''} — ${quantidadeItens} partes`;
  }
  if (!categoriaNome) return '';
  if (intencao === 'recebi') {
    return contatoNome
      ? `${categoriaNome} — recebido de ${contatoNome}`
      : `Recebimento — ${categoriaNome}`;
  }
  return contatoNome
    ? `${categoriaNome} — ${contatoNome}`
    : `Pagamento — ${categoriaNome}`;
}

export default function FinanceiroCompositorModal({
  isOpen,
  momentoInicial,
  onClose,
  onSuccess,
  lancamento = null,
  agendamento = null,
  permissoes,
  contas,
  categorias,
  grupos,
}: Props) {
  const editando = Boolean(lancamento || agendamento);
  const isAdmin = permissoes.includes('aprovar-alteracao-financeira');
  const [momento, setMomento] = useState<Momento>(momentoInicial);
  const [intencao, setIntencao] = useState<Intencao>('paguei');
  const [estrutura, setEstrutura] = useState<Estrutura>('unico');
  const [valor, setValor] = useState('');
  const [data, setData] = useState(hojeLocal);
  const [contaId, setContaId] = useState<IdValue>(null);
  const [categoriaId, setCategoriaId] = useState<IdValue>(null);
  const [contato, setContato] = useState<AutocompleteItem | null>(null);
  const [descricao, setDescricao] = useState('');
  const [descricaoEditada, setDescricaoEditada] = useState(false);
  const [desconto, setDesconto] = useState('0');
  const [itens, setItens] = useState<CompositorItem[]>([itemVazio()]);
  const [parcelado, setParcelado] = useState(false);
  const [quantidadeParcelas, setQuantidadeParcelas] = useState(2);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [sugestoes, setSugestoes] = useState<SugestaoResponse>({ categorias: [], descricoes: [], contatos: [] });
  const [chaveSugestoes, setChaveSugestoes] = useState('');
  const [buscandoSugestoes, setBuscandoSugestoes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tipoLancamento = intencao === 'paguei' ? 'DESPESA' : 'RECEITA';
  const tipoAgenda = intencao === 'paguei' ? 'A_PAGAR' : 'A_RECEBER';
  const contatoLabel = estrutura === 'compra' ? 'Fornecedor' : intencao === 'paguei' ? 'Favorecido' : 'Pagador';
  const categoriaAtual = categorias.find((item) => String(item.id) === String(categoriaId ?? ''));
  const contaAtual = contas.find((item) => String(item.id) === String(contaId ?? ''));

  const categoryOptions = useMemo<SearchableOption[]>(() => {
    const gruposDoTipo = new Set(
      grupos.filter((grupo) => grupo.tipo === tipoLancamento).map((grupo) => String(grupo.id)),
    );
    return categorias
      .filter((categoria) => gruposDoTipo.has(String(categoria.id_grupo)))
      .map((categoria) => {
        const grupo = grupos.find((item) => String(item.id) === String(categoria.id_grupo));
        return { value: categoria.id, label: grupo ? `${categoria.nome} · ${grupo.nome}` : categoria.nome };
      });
  }, [categorias, grupos, tipoLancamento]);

  const expenseCategoryOptions = useMemo<SearchableOption[]>(() => {
    const gruposDespesa = new Set(
      grupos.filter((grupo) => grupo.tipo === 'DESPESA').map((grupo) => String(grupo.id)),
    );
    return categorias
      .filter((categoria) => gruposDespesa.has(String(categoria.id_grupo)))
      .map((categoria) => ({ value: categoria.id, label: categoria.nome }));
  }, [categorias, grupos]);

  const accountOptions = useMemo<SearchableOption[]>(
    () => contas.map((conta) => ({
      value: conta.id,
      label: `${conta.nome_conta}${conta.saldo_atual != null ? ` · ${moeda.format(numero(conta.saldo_atual))}` : ''}`,
    })),
    [contas],
  );

  const somaCompra = itens.reduce(
    (total, item) => total + numero(item.quantidade) * numero(item.valorUnitario),
    0,
  );
  const descontoAplicado = momento === 'agora' ? numero(desconto) : 0;
  const totalCompra = Math.max(0, somaCompra - descontoAplicado);
  const totalRateio = itens.reduce((total, item) => total + numero(item.valor), 0);
  const totalOperacao = estrutura === 'compra'
    ? totalCompra
    : estrutura === 'rateio'
      ? numero(valor)
      : numero(valor);
  const diferencaRateio = numero(valor) - totalRateio;
  const chaveConsultaSugestoes = [
    tipoLancamento,
    contato?.id ?? '',
    contaId ?? '',
    categoriaId ?? '',
  ].join(':');
  const possuiCategoriaParaDescricao = estrutura === 'compra'
    ? itens.some((item) => Boolean(item.categoriaId))
    : Boolean(categoriaId);
  const podeGerarDescricao = totalOperacao > 0
    && Boolean(data)
    && (momento === 'agendar' || Boolean(contaId))
    && possuiCategoriaParaDescricao
    && (estrutura !== 'compra' || Boolean(contato?.id));

  useEffect(() => {
    if (!isOpen) return;
    const registro = lancamento ?? agendamento;
    const estruturaInicial = estruturaDoRegistro(registro?.tipo_rateio);
    const intencaoInicial: Intencao = lancamento
      ? (lancamento.tipo === 'RECEITA' ? 'recebi' : 'paguei')
      : agendamento
        ? (agendamento.tipo === 'A_RECEBER' ? 'recebi' : 'paguei')
        : 'paguei';

    setMomento(momentoInicial);
    setIntencao(intencaoInicial);
    setEstrutura(estruturaInicial);
    setValor(registro?.valor != null ? String(registro.valor) : '');
    setData(
      lancamento?.data_transacao?.slice(0, 10)
      ?? agendamento?.data_vencimento?.slice(0, 10)
      ?? hojeLocal(),
    );
    setContaId(lancamento?.id_conta_bancaria ?? null);
    setCategoriaId(registro?.id_categoria ?? null);
    setContato(
      registro?.id_contato
        ? { id: registro.id_contato, nome: registro.nome_favorecido ?? '' }
        : null,
    );
    setDescricao(registro?.descricao ?? '');
    setDescricaoEditada(Boolean(registro?.descricao));
    setDesconto(lancamento?.valor_desconto != null ? String(lancamento.valor_desconto) : '0');
    setItens(
      lancamento
        ? mapearItensLancamento(lancamento.itens, estruturaInicial)
        : mapearItensAgenda(agendamento, estruturaInicial),
    );
    setParcelado(false);
    setQuantidadeParcelas(2);
    setParcelas([]);
    setSugestoes({ categorias: [], descricoes: [], contatos: [] });
    setChaveSugestoes('');
    setError(null);
  }, [isOpen, momentoInicial, lancamento, agendamento]);

  useEffect(() => {
    if (!isOpen || (!contato?.id && !contaId && !categoriaId)) {
      setSugestoes({ categorias: [], descricoes: [], contatos: [] });
      setChaveSugestoes('');
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ tipo: tipoLancamento });
    if (contato?.id) params.set('contato_id', String(contato.id));
    if (contaId) params.set('conta_id', String(contaId));
    if (categoriaId) params.set('categoria_id', String(categoriaId));
    setBuscandoSugestoes(true);
    const token = localStorage.getItem('token');
    void fetch(`/api/financeiro/sugestoes-lancamento?${params}`, {
      headers: { Authorization: `Bearer ${token ?? ''}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        const dataResponse = await response.json() as SugestaoResponse & { error?: string };
        if (!response.ok) throw new Error(dataResponse.error || 'Falha ao buscar sugestões.');
        setSugestoes({
          categorias: dataResponse.categorias ?? [],
          descricoes: dataResponse.descricoes ?? [],
          contatos: dataResponse.contatos ?? [],
        });
        setChaveSugestoes(chaveConsultaSugestoes);
      })
      .catch((err: unknown) => {
        if ((err as Error).name !== 'AbortError') {
          setSugestoes({ categorias: [], descricoes: [], contatos: [] });
          setChaveSugestoes('');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBuscandoSugestoes(false);
      });
    return () => controller.abort();
  }, [isOpen, contato?.id, contaId, categoriaId, tipoLancamento, chaveConsultaSugestoes]);

  useEffect(() => {
    if (!isOpen || descricaoEditada) return;
    if (!podeGerarDescricao) {
      setDescricao('');
      return;
    }
    const contatoNome = contato?.nome?.trim();
    const categoriaNome = categoriaAtual?.nome?.trim();
    const historica = chaveSugestoes === chaveConsultaSugestoes
      ? sugestoes.descricoes[0]?.texto
      : '';
    const proxima = historica || criarDescricaoDeterministica({
      estrutura,
      intencao,
      categoriaNome,
      contatoNome,
      quantidadeItens: itens.length,
    });
    setDescricao(proxima);
  }, [
    isOpen,
    descricaoEditada,
    estrutura,
    intencao,
    contato?.nome,
    categoriaAtual?.nome,
    itens.length,
    sugestoes.descricoes,
    chaveSugestoes,
    chaveConsultaSugestoes,
    podeGerarDescricao,
  ]);

  const atualizarItem = (id: string, patch: Partial<CompositorItem>) => {
    setItens((atuais) => atuais.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const gerarParcelas = () => {
    const totalCentavos = Math.round(numero(valor) * 100);
    if (totalCentavos <= 0) {
      setError('Informe o valor total antes de gerar as parcelas.');
      return;
    }
    const quantidade = Math.max(2, Math.min(60, Math.floor(quantidadeParcelas)));
    const base = Math.floor(totalCentavos / quantidade);
    const resto = totalCentavos - base * quantidade;
    setParcelas(Array.from({ length: quantidade }, (_, index) => ({
      id: criarId(),
      data: adicionarMeses(data, index),
      valor: ((base + (index === quantidade - 1 ? resto : 0)) / 100).toFixed(2),
    })));
    setQuantidadeParcelas(quantidade);
    setError(null);
  };

  const aplicarCategoriaSugerida = (sugestao: CategoriaSugerida) => {
    if (!categoriaId) setCategoriaId(sugestao.id);
    const contatoSugerido = sugestoes.contatos[0];
    if (!contato?.id && contatoSugerido) {
      setContato({ id: contatoSugerido.id, nome: contatoSugerido.nome });
    }
    setDescricaoEditada(false);
  };

  const gerarOutraDescricao = () => {
    if (!podeGerarDescricao) {
      setError('Preencha valor, conta e categoria antes de gerar uma descrição. O favorecido ou pagador é opcional.');
      return;
    }
    const alternativasHistoricas = chaveSugestoes === chaveConsultaSugestoes
      ? sugestoes.descricoes.map((item) => item.texto.trim()).filter(Boolean)
      : [];
    const alternativa = alternativasHistoricas.find((texto) => texto !== descricao.trim());
    const fallback = criarDescricaoDeterministica({
      estrutura,
      intencao,
      categoriaNome: categoriaAtual?.nome?.trim(),
      contatoNome: contato?.nome?.trim(),
      quantidadeItens: itens.length,
    });
    const proxima = alternativa || descricao.trim() || fallback;
    if (proxima) {
      setDescricao(proxima);
      setDescricaoEditada(false);
      setError(null);
    }
  };

  const validarBase = () => {
    if (!data) throw new Error(momento === 'agora' ? 'Informe a data do lançamento.' : 'Informe o primeiro vencimento.');
    if (!descricao.trim()) {
      throw new Error('Preencha a descrição ou use as ferramentas de sugestão antes de salvar.');
    }
    if (momento === 'agora' && !contaId) throw new Error('Selecione a conta bancária.');
    if (estrutura === 'unico') {
      if (numero(valor) <= 0 || !categoriaId) throw new Error('Informe valor e categoria.');
    }
    if (estrutura === 'compra') {
      if (!contato?.id) throw new Error('Selecione o fornecedor da compra.');
      if (!itens.length || itens.some((item) => (
        !item.descricao.trim()
        || !item.categoriaId
        || numero(item.quantidade) <= 0
        || numero(item.valorUnitario) <= 0
      ))) {
        throw new Error('Preencha produto, categoria, quantidade e valor unitário de todos os itens.');
      }
    }
    if (estrutura === 'rateio') {
      if (numero(valor) <= 0 || !categoriaId) throw new Error('Informe o total e a categoria geral do rateio.');
      if (!itens.length || itens.some((item) => !item.categoriaId || !item.contato?.id || numero(item.valor) <= 0)) {
        throw new Error('Preencha favorecido, categoria e valor de todas as partes.');
      }
      if (Math.abs(diferencaRateio) > 0.009) {
        throw new Error(`O rateio ainda não fecha. Diferença: ${moeda.format(diferencaRateio)}.`);
      }
    }
    if (parcelado) {
      if (momento !== 'agendar' || estrutura !== 'unico') {
        throw new Error('Parcelamento está disponível somente para agendamentos de valor único.');
      }
      if (parcelas.length < 2) throw new Error('Gere ao menos duas parcelas.');
      if (parcelas.some((parcela) => !parcela.data || numero(parcela.valor) <= 0)) {
        throw new Error('Preencha vencimento e valor de todas as parcelas.');
      }
      const somaParcelas = parcelas.reduce((total, parcela) => total + numero(parcela.valor), 0);
      if (Math.abs(somaParcelas - numero(valor)) > 0.009) {
        throw new Error(
          `As parcelas somam ${moeda.format(somaParcelas)}, mas o valor informado é ${moeda.format(numero(valor))}.`,
        );
      }
    }
  };

  const montarPayloadAtual = (): SimplesPayload | DetalhadoPayload => {
    if (estrutura === 'unico') {
      return {
        tipo: tipoLancamento,
        valor: numero(valor),
        data_transacao: data,
        id_categoria: categoriaId,
        id_conta_bancaria: contaId,
        id_contato: contato?.id ?? null,
        descricao: descricao.trim(),
      };
    }
    if (estrutura === 'compra') {
      return {
        tipo_rateio: 'COMPRA',
        dados_pai: {
          data_transacao: data,
          id_conta_bancaria: contaId,
          id_contato: contato?.id ?? null,
          descricao: descricao.trim(),
          valor_desconto: numero(desconto),
        },
        itens_filho: itens.map((item) => ({
          descricao_item: item.descricao.trim(),
          quantidade: numero(item.quantidade),
          valor_unitario: numero(item.valorUnitario),
          id_categoria: item.categoriaId,
          id_contato_item: null,
        })),
      };
    }
    return {
      tipo_rateio: 'DETALHADO',
      dados_pai: {
        data_transacao: data,
        id_conta_bancaria: contaId,
        id_contato: contato?.id ?? null,
        id_categoria: categoriaId,
        descricao: descricao.trim(),
      },
      itens_filho: itens.map((item) => ({
        valor_item: numero(item.valor),
        id_contato_item: item.contato?.id ?? null,
        id_categoria: item.categoriaId,
        descricao_item: item.descricao.trim(),
      })),
    };
  };

  const salvarAtual = async () => {
    const payload = montarPayloadAtual();
    let body: unknown = payload;
    let endpoint = estrutura === 'unico' ? '/lancamentos' : '/lancamentos/detalhado';
    let method = lancamento ? 'PUT' : 'POST';

    if (lancamento) {
      endpoint = estrutura === 'unico'
        ? `/lancamentos/${lancamento.id}`
        : `/lancamentos/detalhado/${lancamento.id}`;
      if (!isAdmin) {
        const justificativa = await mostrarPromptTexto(
          `Qual o motivo para editar o lançamento #${lancamento.id}?`,
          { placeholder: 'Justificativa obrigatória', tipo: 'aviso' },
        );
        if (!justificativa) throw new Error('Edição cancelada. A justificativa é obrigatória.');
        body = { ...payload, justificativa };
      }
    } else if (!isAdmin && data !== hojeLocal()) {
      const dataFormatada = new Date(`${data}T12:00:00Z`).toLocaleDateString('pt-BR');
      const justificativa = await mostrarPromptTexto(
        `Justifique o motivo para lançar com data diferente de hoje (${dataFormatada}).`,
        { placeholder: 'Justificativa obrigatória', tipo: 'aviso' },
      );
      if (!justificativa) throw new Error('Lançamento cancelado. A justificativa é obrigatória para datas especiais.');
      endpoint = '/lancamentos/solicitar-criacao';
      method = 'POST';
      body = { lancamento_proposto: payload, justificativa };
    }

    await fetchFinanceiro(endpoint, { method, body: JSON.stringify(body) });
  };

  const salvarAgendado = async () => {
    if (parcelado) {
      const valorTotal = parcelas.reduce((total, parcela) => total + numero(parcela.valor), 0);
      await fetchFinanceiro('/contas-agendadas/lote', {
        method: 'POST',
        body: JSON.stringify({
          descricao_lote: descricao.trim(),
          valor_total: valorTotal,
          parcelas: parcelas.map((parcela, index) => ({
            parcela: index + 1,
            data_vencimento: parcela.data,
            valor: numero(parcela.valor),
            descricao: `${descricao.trim()} — Parcela ${index + 1}/${parcelas.length}`,
            id_categoria: categoriaId,
            id_contato: contato?.id ?? null,
            tipo: tipoAgenda,
          })),
        }),
      });
      return;
    }

    if (estrutura === 'unico') {
      await fetchFinanceiro(`/contas-agendadas${agendamento ? `/${agendamento.id}` : ''}`, {
        method: agendamento ? 'PUT' : 'POST',
        body: JSON.stringify({
          tipo: tipoAgenda,
          data_vencimento: data,
          descricao: descricao.trim(),
          valor: numero(valor),
          id_categoria: categoriaId,
          id_contato: contato?.id ?? null,
        }),
      });
      return;
    }

    const itensFilho = itens.map((item) => ({
      descricao_item: item.descricao.trim(),
      valor_item: estrutura === 'compra'
        ? numero(item.quantidade) * numero(item.valorUnitario)
        : numero(item.valor),
      id_categoria: item.categoriaId,
      id_contato_item: estrutura === 'rateio' ? item.contato?.id ?? null : null,
    }));
    await fetchFinanceiro(`/contas-agendadas/detalhado${agendamento ? `/${agendamento.id}` : ''}`, {
      method: agendamento ? 'PUT' : 'POST',
      body: JSON.stringify({
        tipo_rateio: estrutura === 'compra' ? 'COMPRA' : 'DETALHADO',
        dados_pai: {
          data_vencimento: data,
          id_contato: contato?.id ?? null,
          descricao: descricao.trim(),
          tipo: 'A_PAGAR',
          id_categoria: estrutura === 'rateio' ? categoriaId : null,
        },
        itens_filho: itensFilho,
      }),
    });
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      validarBase();
      await (momento === 'agora' ? salvarAtual() : salvarAgendado());
      mostrarMensagem(
        momento === 'agora' ? 'Lançamento salvo com sucesso!' : 'Agendamento salvo com sucesso!',
        'sucesso',
        3000,
      );
      onSuccess();
      onClose();
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : 'Não foi possível salvar a operação.';
      setError(mensagem);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const titulo = editando
    ? (momento === 'agora' ? `Editar lançamento #${lancamento?.id}` : `Editar agendamento #${agendamento?.id}`)
    : intencao === 'paguei'
      ? (momento === 'agora' ? 'Novo pagamento' : 'Agendar pagamento')
      : (momento === 'agora' ? 'Novo recebimento' : 'Agendar recebimento');
  const textoAcao = editando
    ? 'Salvar alterações'
    : momento === 'agora'
      ? (intencao === 'paguei' ? 'Lançar despesa' : 'Registrar recebimento')
      : parcelado
        ? `Agendar ${parcelas.length || quantidadeParcelas} parcelas`
        : (intencao === 'paguei' ? 'Agendar pagamento' : 'Agendar recebimento');

  return (
    <FinanceiroModalShell
      titulo={titulo}
      descricao={momento === 'agora'
        ? 'Registre uma movimentação manual da empresa ativa.'
        : 'Crie uma previsão futura; o saldo só muda quando houver baixa.'}
      icone={momento === 'agora' ? 'fa-wallet' : 'fa-calendar-check'}
      onClose={onClose}
      formId={FORM_ID}
      textoAcao={textoAcao}
      textoProcessando="Salvando..."
      processando={saving}
      erro={error}
      tamanho="lg"
    >
      <form id={FORM_ID} className="fc-composer" onSubmit={(event) => void save(event)}>
        <section className="fc-composer-section">
          <div className="fc-composer-section__heading">
            <div>
              <span className="fc-composer-kicker">1. O que aconteceu?</span>
              <p>Escolha em linguagem do dia a dia.</p>
            </div>
            <div className="fc-composer-toggle" aria-label="Momento da operação">
              <button
                type="button"
                className={momento === 'agora' ? 'active' : ''}
                onClick={() => {
                  if (!editando) {
                    setMomento('agora');
                    setParcelado(false);
                  }
                }}
                disabled={editando}
              >
                Agora
              </button>
              <button
                type="button"
                className={momento === 'agendar' ? 'active' : ''}
                onClick={() => {
                  if (!editando) setMomento('agendar');
                }}
                disabled={editando}
              >
                <i className="fas fa-calendar-clock" aria-hidden="true" /> Agendar
              </button>
            </div>
          </div>
          <div className="fc-composer-intents">
            <button
              type="button"
              className={intencao === 'paguei' ? 'active despesa' : ''}
              onClick={() => {
                if (!editando) {
                  setIntencao('paguei');
                  setCategoriaId(null);
                  setDescricaoEditada(false);
                }
              }}
              disabled={editando}
            >
              <i className="fas fa-arrow-up" aria-hidden="true" />
              <span><strong>Paguei</strong><small>Dinheiro saiu</small></span>
            </button>
            <button
              type="button"
              className={intencao === 'recebi' ? 'active receita' : ''}
              onClick={() => {
                if (!editando) {
                  setIntencao('recebi');
                  setEstrutura('unico');
                  setCategoriaId(null);
                  setDescricaoEditada(false);
                }
              }}
              disabled={editando}
            >
              <i className="fas fa-arrow-down" aria-hidden="true" />
              <span><strong>Recebi</strong><small>Dinheiro entrou</small></span>
            </button>
          </div>
        </section>

        <section className="fc-composer-section">
          <div className="fc-composer-section__heading">
            <div>
              <span className="fc-composer-kicker">2. Como registrar?</span>
              <p>Escolha a estrutura que representa a operação.</p>
            </div>
          </div>
          <div className="fc-composer-structures">
            {([
              { id: 'unico' as const, icon: 'fa-receipt', label: 'Valor único', desc: 'Um valor e uma categoria' },
              { id: 'compra' as const, icon: 'fa-basket-shopping', label: 'Compra com itens', desc: 'Produtos, quantidade e preço' },
              { id: 'rateio' as const, icon: 'fa-chart-pie', label: 'Ratear valor', desc: 'Distribuir entre categorias' },
            ]).map((option) => {
              const bloqueado = intencao === 'recebi' && option.id !== 'unico';
              return (
                <button
                  type="button"
                  key={option.id}
                  className={estrutura === option.id ? 'active' : ''}
                  onClick={() => {
                    if (!editando && !bloqueado) {
                      setEstrutura(option.id);
                      if (option.id !== 'unico') setParcelado(false);
                      setDescricaoEditada(false);
                    }
                  }}
                  disabled={editando || bloqueado}
                >
                  <i className={`fas ${bloqueado ? 'fa-lock' : option.icon}`} aria-hidden="true" />
                  <span><strong>{option.label}</strong><small>{bloqueado ? 'Somente para pagamentos' : option.desc}</small></span>
                </button>
              );
            })}
          </div>
        </section>

        {momento === 'agendar' && estrutura === 'unico' && !editando && (
          <section className="fc-composer-section fc-composer-schedule">
            <div className="fc-composer-section__heading">
              <div>
                <span className="fc-composer-kicker">3. É uma previsão única ou parcelada?</span>
                <p>Parcelas viram um lote de vencimentos ligados pela mesma descrição.</p>
              </div>
            </div>
            <div className="fc-composer-toggle fc-composer-toggle--wide">
              <button type="button" className={!parcelado ? 'active' : ''} onClick={() => setParcelado(false)}>
                Vencimento único
              </button>
              <button type="button" className={parcelado ? 'active' : ''} onClick={() => setParcelado(true)}>
                <i className="fas fa-layer-group" aria-hidden="true" /> Parcelamento
              </button>
            </div>
          </section>
        )}

        <section className="fc-composer-section fc-composer-fields">
          <div className="fc-composer-grid fc-composer-grid--primary">
            <label className="fc-form-group">
              <span>{estrutura === 'compra' ? 'Total calculado' : estrutura === 'rateio' ? 'Valor a distribuir' : 'Valor'}</span>
              <div className="fc-composer-money">
                <span>R$</span>
                <input
                  className="fc-input"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={estrutura === 'compra' ? totalCompra || '' : valor}
                  onChange={(event) => setValor(event.target.value)}
                  disabled={estrutura === 'compra'}
                  required
                />
              </div>
            </label>
            <label className="fc-form-group">
              <span>{momento === 'agora' ? 'Data' : parcelado ? 'Primeiro vencimento' : 'Vencimento'}</span>
              <input className="fc-input" type="date" value={data} onChange={(event) => setData(event.target.value)} required />
            </label>
            {momento === 'agora' && (
              <label className="fc-form-group fc-form-group--account">
                <span>Conta</span>
                <UISearchableSelect
                  options={accountOptions}
                  placeholder="Buscar conta..."
                  onChange={setContaId}
                  initialValue={contaId}
                />
              </label>
            )}
          </div>

          <div className="fc-composer-grid fc-composer-grid--secondary">
            <label className="fc-form-group">
              <span>{contatoLabel}</span>
              <UIAutocompleteAPI
                apiEndpoint="/api/financeiro/contatos"
                placeholder={`Buscar ${contatoLabel.toLowerCase()}...`}
                onSelectionChange={(selection) => {
                  setContato(selection);
                }}
                initialSelection={contato}
              />
            </label>
            {estrutura !== 'compra' && (
              <label className="fc-form-group">
                <span>{estrutura === 'rateio' ? 'Categoria geral' : 'Categoria'}</span>
                <UISearchableSelect
                  options={categoryOptions}
                  placeholder="Buscar categoria ou grupo..."
                  onChange={(selection) => {
                    setCategoriaId(selection);
                  }}
                  initialValue={categoriaId}
                />
              </label>
            )}
            {estrutura === 'compra' && momento === 'agora' && (
              <label className="fc-form-group">
                <span>Desconto</span>
                <div className="fc-composer-money">
                  <span>R$</span>
                  <input
                    className="fc-input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={desconto}
                    onChange={(event) => setDesconto(event.target.value)}
                  />
                </div>
              </label>
            )}
          </div>

          {((!categoriaId && sugestoes.categorias[0]) || (!contato?.id && sugestoes.contatos[0]))
            && estrutura !== 'compra' && (
            <div className="fc-composer-suggestion">
              <i className={`fas ${buscandoSugestoes ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`} aria-hidden="true" />
              <div>
                <strong>
                  Sugestão do histórico:
                  {' '}
                  {!categoriaId ? sugestoes.categorias[0]?.nome : ''}
                  {!categoriaId && !contato?.id && sugestoes.categorias[0] && sugestoes.contatos[0] ? ' + ' : ''}
                  {!contato?.id ? sugestoes.contatos[0]?.nome : ''}
                </strong>
                <small>
                  {!categoriaId
                    ? sugestoes.categorias[0]?.explicacao
                    : sugestoes.contatos[0]?.explicacao}
                </small>
              </div>
              <button
                type="button"
                onClick={() => {
                  const categoriaSugerida = !categoriaId ? sugestoes.categorias[0] : null;
                  if (categoriaSugerida) aplicarCategoriaSugerida(categoriaSugerida);
                  else if (!contato?.id && sugestoes.contatos[0]) {
                    setContato({ id: sugestoes.contatos[0].id, nome: sugestoes.contatos[0].nome });
                    setDescricaoEditada(false);
                  }
                }}
              >
                Usar sugestão
              </button>
            </div>
          )}

          <label className="fc-form-group fc-composer-description">
            <span>
              Descrição sugerida
              <small>{descricaoEditada ? 'Editada manualmente' : sugestoes.descricoes[0] ? 'Baseada no histórico' : 'Gerada pelos campos'}</small>
            </span>
            <div>
              <input
                className="fc-input"
                value={descricao}
                maxLength={240}
                onChange={(event) => {
                  setDescricao(event.target.value);
                  setDescricaoEditada(true);
                }}
                placeholder="A descrição será sugerida automaticamente"
                required
              />
              <button
                type="button"
                className="fc-btn fc-btn-outline"
                onClick={gerarOutraDescricao}
              >
                <i className="fas fa-rotate" aria-hidden="true" /> Gerar outra
              </button>
            </div>
          </label>
        </section>

        {estrutura === 'compra' && (
          <section className="fc-composer-section fc-composer-editor">
            <div className="fc-composer-section__heading">
              <div>
                <span className="fc-composer-kicker">Itens da compra</span>
                <p>Os produtos são o centro deste lançamento.</p>
              </div>
              <strong>{moeda.format(totalCompra)}</strong>
            </div>
            <div className="fc-composer-items">
              {itens.map((item, index) => (
                <div className="fc-composer-item fc-composer-item--purchase" key={item.id}>
                  <span className="fc-composer-item__number">{index + 1}</span>
                  <label><span>Produto</span><input className="fc-input" value={item.descricao} onChange={(event) => atualizarItem(item.id, { descricao: event.target.value })} /></label>
                  <label><span>Categoria</span><UISearchableSelect options={expenseCategoryOptions} placeholder="Buscar..." onChange={(selection) => atualizarItem(item.id, { categoriaId: selection })} initialValue={item.categoriaId} /></label>
                  <label><span>Qtd.</span><input className="fc-input" type="number" min="0.001" step="0.001" value={item.quantidade} onChange={(event) => atualizarItem(item.id, { quantidade: event.target.value })} /></label>
                  <label><span>Valor unit.</span><input className="fc-input" type="number" min="0.01" step="0.01" value={item.valorUnitario} onChange={(event) => atualizarItem(item.id, { valorUnitario: event.target.value })} /></label>
                  <div className="fc-composer-item__total"><span>Total</span><strong>{moeda.format(numero(item.quantidade) * numero(item.valorUnitario))}</strong></div>
                  <button type="button" className="fc-composer-remove" onClick={() => setItens((atuais) => atuais.filter((atual) => atual.id !== item.id))} aria-label={`Remover item ${index + 1}`}><i className="fas fa-trash" /></button>
                </div>
              ))}
            </div>
            <button type="button" className="fc-btn fc-btn-outline" onClick={() => setItens((atuais) => [...atuais, itemVazio()])}>
              <i className="fas fa-plus" aria-hidden="true" /> Adicionar item
            </button>
            <div className="fc-composer-totals">
              <span>Subtotal <strong>{moeda.format(somaCompra)}</strong></span>
              {momento === 'agora' && <span>Desconto <strong>- {moeda.format(descontoAplicado)}</strong></span>}
              <span>Total <strong>{moeda.format(totalCompra)}</strong></span>
            </div>
          </section>
        )}

        {estrutura === 'rateio' && (
          <section className="fc-composer-section fc-composer-editor">
            <div className="fc-composer-section__heading">
              <div>
                <span className="fc-composer-kicker">Distribua {moeda.format(numero(valor))}</span>
                <p>O lançamento só pode ser salvo quando a distribuição fechar.</p>
              </div>
              <strong className={Math.abs(diferencaRateio) < 0.009 ? 'fc-composer-ok' : ''}>
                {Math.abs(diferencaRateio) < 0.009
                  ? 'Rateio fechado'
                  : `${diferencaRateio > 0 ? 'Faltam' : 'Excedeu'} ${moeda.format(Math.abs(diferencaRateio))}`}
              </strong>
            </div>
            <div className="fc-composer-progress" aria-label={`${Math.min(100, numero(valor) ? (totalRateio / numero(valor)) * 100 : 0)}% distribuído`}>
              <span style={{ width: `${Math.min(100, numero(valor) ? (totalRateio / numero(valor)) * 100 : 0)}%` }} />
            </div>
            <div className="fc-composer-items">
              {itens.map((item, index) => (
                <div className="fc-composer-item fc-composer-item--allocation" key={item.id}>
                  <span className="fc-composer-item__number">{index + 1}</span>
                  <label><span>Favorecido</span><UIAutocompleteAPI apiEndpoint="/api/financeiro/contatos" placeholder="Buscar..." onSelectionChange={(selection) => atualizarItem(item.id, { contato: selection })} initialSelection={item.contato} /></label>
                  <label><span>Categoria</span><UISearchableSelect options={expenseCategoryOptions} placeholder="Buscar..." onChange={(selection) => atualizarItem(item.id, { categoriaId: selection })} initialValue={item.categoriaId} /></label>
                  <label><span>Descrição</span><input className="fc-input" value={item.descricao} onChange={(event) => atualizarItem(item.id, { descricao: event.target.value })} placeholder="Gerada ou opcional" /></label>
                  <label><span>Valor</span><input className="fc-input" type="number" min="0.01" step="0.01" value={item.valor} onChange={(event) => atualizarItem(item.id, { valor: event.target.value })} /></label>
                  <button type="button" className="fc-composer-remove" onClick={() => setItens((atuais) => atuais.filter((atual) => atual.id !== item.id))} aria-label={`Remover rateio ${index + 1}`}><i className="fas fa-trash" /></button>
                </div>
              ))}
            </div>
            <div className="fc-composer-editor__actions">
              <button type="button" className="fc-btn fc-btn-outline" onClick={() => setItens((atuais) => [...atuais, itemVazio()])}>
                <i className="fas fa-plus" aria-hidden="true" /> Adicionar parte
              </button>
              {diferencaRateio > 0.009 && itens.length > 0 && (
                <button
                  type="button"
                  className="fc-btn fc-btn-outline"
                  onClick={() => {
                    const ultimo = itens[itens.length - 1];
                    atualizarItem(ultimo.id, { valor: (numero(ultimo.valor) + diferencaRateio).toFixed(2) });
                  }}
                >
                  Distribuir restante
                </button>
              )}
            </div>
          </section>
        )}

        {momento === 'agendar' && parcelado && estrutura === 'unico' && (
          <section className="fc-composer-section fc-composer-editor">
            <div className="fc-composer-section__heading">
              <div>
                <span className="fc-composer-kicker">Parcelamento</span>
                <p>Gere as parcelas e ajuste datas ou valores individualmente.</p>
              </div>
              <div className="fc-composer-installment-generator">
                <label>
                  <span>Parcelas</span>
                  <input
                    className="fc-input"
                    type="number"
                    min="2"
                    max="60"
                    value={quantidadeParcelas}
                    onChange={(event) => setQuantidadeParcelas(Number(event.target.value))}
                  />
                </label>
                <button type="button" className="fc-btn fc-btn-outline" onClick={gerarParcelas}>Gerar parcelas</button>
              </div>
            </div>
            <div className="fc-composer-installments">
              {parcelas.map((parcela, index) => (
                <div key={parcela.id}>
                  <span>{index + 1}/{parcelas.length}</span>
                  <label><span>Vencimento</span><input className="fc-input" type="date" value={parcela.data} onChange={(event) => setParcelas((atuais) => atuais.map((atual) => atual.id === parcela.id ? { ...atual, data: event.target.value } : atual))} /></label>
                  <label><span>Valor</span><input className="fc-input" type="number" min="0.01" step="0.01" value={parcela.valor} onChange={(event) => setParcelas((atuais) => atuais.map((atual) => atual.id === parcela.id ? { ...atual, valor: event.target.value } : atual))} /></label>
                  <button type="button" className="fc-composer-remove" onClick={() => setParcelas((atuais) => atuais.filter((atual) => atual.id !== parcela.id))} aria-label={`Remover parcela ${index + 1}`}><i className="fas fa-trash" /></button>
                </div>
              ))}
            </div>
            {parcelas.length === 0 && (
              <div className="fc-composer-empty">
                <i className="fas fa-layer-group" aria-hidden="true" />
                <span>Informe valor, primeiro vencimento e quantidade; depois gere as parcelas.</span>
              </div>
            )}
            {parcelas.length > 0 && (
              <div className="fc-composer-totals">
                <span>Total das parcelas <strong>{moeda.format(parcelas.reduce((total, parcela) => total + numero(parcela.valor), 0))}</strong></span>
                <span>Valor informado <strong>{moeda.format(numero(valor))}</strong></span>
              </div>
            )}
          </section>
        )}

        <FinanceiroResumoOperacao titulo="Resumo antes de confirmar" className="fc-modal-resumo--confirmation">
          <p className="fc-composer-confirmation-lead">
            <i className="fas fa-circle-check" aria-hidden="true" />
            Confira todos os dados. Esta é a última etapa antes de registrar a operação.
          </p>
          <div className="fc-composer-summary">
            <span>
              <small>Operação</small>
              <strong>{estrutura === 'compra' ? 'Compra com itens' : estrutura === 'rateio' ? 'Rateio' : 'Valor único'}</strong>
            </span>
            <span>
              <small>Total {intencao === 'paguei' ? 'a pagar' : 'a receber'}</small>
              <strong className={intencao === 'paguei' ? 'fc-summary-expense' : 'fc-summary-income'}>
                {moeda.format(totalOperacao)}
              </strong>
            </span>
            <span>
              <small>{momento === 'agora' ? 'Data' : parcelado ? 'Parcelamento' : 'Vencimento'}</small>
              <strong>{parcelado ? `${parcelas.length || quantidadeParcelas} parcelas a partir de ${data}` : data}</strong>
            </span>
            <span>
              <small>{momento === 'agora' ? 'Conta' : 'Efeito no saldo'}</small>
              <strong>{momento === 'agora' ? contaAtual?.nome_conta || 'Não selecionada' : 'Somente após a baixa'}</strong>
            </span>
            <span>
              <small>{contatoLabel}</small>
              <strong>{contato?.nome || 'Não informado'}</strong>
            </span>
            <span>
              <small>Categoria</small>
              <strong>{estrutura === 'compra' ? 'Definida por item' : categoriaAtual?.nome || 'Não selecionada'}</strong>
            </span>
            <span className="fc-composer-summary__description">
              <small>Descrição que será registrada</small>
              <strong>{descricao || 'Aguardando preenchimento'}</strong>
            </span>
          </div>
          {momento === 'agendar' && (
            <p className="fc-composer-balance-note">
              <i className="fas fa-circle-info" aria-hidden="true" />
              Este agendamento não movimenta saldo até a baixa.
            </p>
          )}
        </FinanceiroResumoOperacao>
      </form>
    </FinanceiroModalShell>
  );
}
