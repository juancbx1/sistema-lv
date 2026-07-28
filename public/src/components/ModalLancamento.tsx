import { useEffect, useState } from 'react';
import UISearchableSelect, { type SearchableOption } from './UISearchableSelect.tsx';
import UIAutocompleteAPI, { type AutocompleteItem } from './UIAutocompleteAPI.tsx';
import { mostrarMensagem, mostrarPromptTexto } from '../../js/utils/popups.js';
import type {
  FinanceiroCategoria,
  FinanceiroConta,
  FinanceiroGrupo,
  FinanceiroLancamento,
  FinanceiroLancamentoItem,
} from '../utils/financeiro-types';

type AbaLancamento = 'simples' | 'compra' | 'rateio';
type ItemField = 'descricao_item' | 'quantidade' | 'valor_unitario' | 'valor_item' | 'id_categoria' | 'favorecido';

interface ModalItem {
  id: string | number;
  descricao_item?: string;
  quantidade?: string | number;
  valor_unitario?: string | number;
  valor_item?: string | number;
  id_categoria?: string | number | null;
  favorecido?: AutocompleteItem | null;
}

interface ModalForm {
  tipo?: string;
  valor?: string | number;
  data?: string;
  data_transacao?: string;
  id_conta_bancaria?: string | number | null;
  id_categoria?: string | number | null;
  id_categoria_geral?: string | number | null;
  favorecido?: AutocompleteItem | null;
  descricao?: string;
  desconto?: string | number;
  itens: ModalItem[];
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  lancamentoParaEditar?: FinanceiroLancamento | null;
  permissoes?: string[];
  contas?: FinanceiroConta[];
  categorias?: FinanceiroCategoria[];
  grupos?: FinanceiroGrupo[];
}

interface SimplesPayload {
  tipo?: string;
  valor: number;
  data_transacao?: string;
  id_categoria?: string | number | null;
  id_conta_bancaria?: string | number | null;
  id_contato: string | number | null;
  descricao?: string;
  justificativa?: string;
}

interface DetalhadoPayload {
  tipo_rateio: 'COMPRA' | 'DETALHADO';
  dados_pai: {
    data_transacao?: string;
    id_conta_bancaria?: string | number | null;
    id_contato: string | number | null;
    id_categoria?: string | number | null;
    descricao?: string;
    valor_desconto?: number;
  };
  itens_filho: Array<Record<string, string | number | null | undefined>>;
  justificativa?: string;
}

interface SolicitacaoCriacaoPayload {
  lancamento_proposto: SimplesPayload | DetalhadoPayload;
  justificativa: string;
}

type SubmitPayload = SimplesPayload | DetalhadoPayload | SolicitacaoCriacaoPayload;

const getLocalDateString = () => {
  const date = new Date();
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().split('T')[0];
};

const ItemCompraRow = ({
  item,
  onItemChange,
  onItemRemove,
  categoryOptions,
}: {
  item: ModalItem;
  onItemChange: (id: string | number, field: ItemField, value: string | number | AutocompleteItem | null) => void;
  onItemRemove: (id: string | number) => void;
  categoryOptions: SearchableOption[];
}) => {
  const valorTotalItem = (parseFloat(String(item.quantidade ?? '')) || 0) * (parseFloat(String(item.valor_unitario ?? '')) || 0);
  return (
    <div className="fc-rateio-linha" style={{ gridTemplateColumns: 'minmax(0, 2.5fr) 90px 110px 110px minmax(0, 2fr) 40px' }}>
      <input type="text" className="fc-input" placeholder="Nome do Produto" value={item.descricao_item || ''} onChange={(e) => onItemChange(item.id, 'descricao_item', e.target.value)} />
      <input type="number" className="fc-input" placeholder="Qtd" step="0.001" min="0" required value={item.quantidade || ''} onChange={(e) => onItemChange(item.id, 'quantidade', e.target.value)} />
      <input type="number" className="fc-input" placeholder="V. Unitário" step="0.01" min="0" required value={item.valor_unitario || ''} onChange={(e) => onItemChange(item.id, 'valor_unitario', e.target.value)} />
      <input type="text" className="fc-input" value={valorTotalItem.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} disabled />
      <UISearchableSelect options={categoryOptions} placeholder="Categoria..." onChange={(val) => onItemChange(item.id, 'id_categoria', val)} initialValue={item.id_categoria} />
      <button type="button" className="remover-item-btn" onClick={() => onItemRemove(item.id)}><i className="fas fa-trash" /></button>
    </div>
  );
};

const ItemRateioRow = ({
  item,
  onItemChange,
  onItemRemove,
  categoryOptions,
}: {
  item: ModalItem;
  onItemChange: (id: string | number, field: ItemField, value: string | number | AutocompleteItem | null) => void;
  onItemRemove: (id: string | number) => void;
  categoryOptions: SearchableOption[];
}) => (
  <div className="fc-rateio-linha" style={{ gridTemplateColumns: '2.5fr 2.5fr 2fr 130px 40px' }}>
    <UIAutocompleteAPI apiEndpoint="/api/financeiro/contatos" placeholder="Buscar funcionário/sócio..." onSelectionChange={(selection) => onItemChange(item.id, 'favorecido', selection)} initialSelection={item.favorecido} />
    <UISearchableSelect options={categoryOptions} placeholder="Categoria..." onChange={(val) => onItemChange(item.id, 'id_categoria', val)} initialValue={item.id_categoria} />
    <input type="text" className="fc-input" placeholder="Descrição (opcional)" value={item.descricao_item || ''} onChange={(e) => onItemChange(item.id, 'descricao_item', e.target.value)} />
    <input type="number" className="fc-input" placeholder="Valor" step="0.01" min="0.01" required value={item.valor_item || ''} onChange={(e) => onItemChange(item.id, 'valor_item', e.target.value)} />
    <button type="button" className="remover-item-btn" onClick={() => onItemRemove(item.id)}><i className="fas fa-trash" /></button>
  </div>
);

function mapItensEdicao(itens: FinanceiroLancamentoItem[] | undefined, tipo: 'COMPRA' | 'DETALHADO'): ModalItem[] {
  return (itens ?? []).map((item, index) => ({
    id: item.id || `${Date.now()}-${index}`,
    descricao_item: item.descricao_item,
    quantidade: item.quantidade,
    valor_unitario: item.valor_unitario,
    valor_item: tipo === 'DETALHADO' ? (item.valor_total_item ?? item.valor_item) : item.valor_item,
    id_categoria: item.id_categoria ?? null,
    favorecido: item.id_contato_item
      ? { id: item.id_contato_item, nome: item.nome_contato_item || '' }
      : null,
  }));
}

export default function ModalLancamento({
  isOpen,
  onClose,
  onSuccess,
  lancamentoParaEditar,
  permissoes = [],
  contas = [],
  categorias = [],
  grupos = [],
}: ModalProps) {
  const isEditMode = Boolean(lancamentoParaEditar);
  const isAdmin = permissoes.includes('aprovar-alteracao-financeira');

  const getInitialState = (formType: AbaLancamento): ModalForm => {
    const today = getLocalDateString();
    switch (formType) {
      case 'compra':
        return {
          data: today,
          id_conta_bancaria: '',
          favorecido: null,
          descricao: '',
          desconto: '0.00',
          itens: [{ id: Date.now(), descricao_item: '', quantidade: '1', valor_unitario: '', id_categoria: null }],
        };
      case 'rateio':
        return {
          data: today,
          id_conta_bancaria: '',
          favorecido: null,
          id_categoria_geral: null,
          descricao: '',
          itens: [{ id: Date.now(), favorecido: null, id_categoria: null, descricao_item: '', valor_item: '' }],
        };
      default:
        return {
          tipo: 'DESPESA',
          valor: '',
          data_transacao: today,
          id_categoria: null,
          id_conta_bancaria: '',
          favorecido: null,
          descricao: '',
          itens: [],
        };
    }
  };

  const [abaAtiva, setAbaAtiva] = useState<AbaLancamento>('simples');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formSimples, setFormSimples] = useState<ModalForm>(getInitialState('simples'));
  const [formCompra, setFormCompra] = useState<ModalForm>(getInitialState('compra'));
  const [formRateio, setFormRateio] = useState<ModalForm>(getInitialState('rateio'));

  useEffect(() => {
    if (!isOpen) return;
    if (isEditMode && lancamentoParaEditar) {
      const l = lancamentoParaEditar;
      const tipoRateio = l.tipo_rateio;
      if (!tipoRateio && !l.id_transferencia_vinculada) {
        setAbaAtiva('simples');
        const categoriaDoLancamento = categorias.find((c) => c.id === l.id_categoria);
        const grupoPai = grupos.find((g) => g.id === categoriaDoLancamento?.id_grupo);
        setFormSimples({
          tipo: grupoPai?.tipo || 'DESPESA',
          valor: l.valor,
          data_transacao: l.data_transacao?.split('T')[0] ?? getLocalDateString(),
          id_categoria: l.id_categoria,
          id_conta_bancaria: l.id_conta_bancaria,
          favorecido: l.id_contato ? { id: l.id_contato, nome: l.nome_favorecido || '' } : null,
          descricao: l.descricao || '',
          itens: [],
        });
      } else if (tipoRateio === 'COMPRA') {
        setAbaAtiva('compra');
        setFormCompra({
          data: l.data_transacao?.split('T')[0] ?? getLocalDateString(),
          id_conta_bancaria: l.id_conta_bancaria,
          favorecido: l.id_contato ? { id: l.id_contato, nome: l.nome_favorecido || '' } : null,
          descricao: l.descricao || '',
          desconto: l.valor_desconto || '0.00',
          itens: mapItensEdicao(l.itens, 'COMPRA'),
        });
      } else if (tipoRateio === 'DETALHADO') {
        setAbaAtiva('rateio');
        setFormRateio({
          data: l.data_transacao?.split('T')[0] ?? getLocalDateString(),
          id_conta_bancaria: l.id_conta_bancaria,
          favorecido: l.id_contato ? { id: l.id_contato, nome: l.nome_favorecido || '' } : null,
          id_categoria_geral: l.id_categoria,
          descricao: l.descricao || '',
          itens: mapItensEdicao(l.itens, 'DETALHADO'),
        });
      }
    } else {
      setFormSimples(getInitialState('simples'));
      setFormCompra(getInitialState('compra'));
      setFormRateio(getInitialState('rateio'));
      setAbaAtiva('simples');
    }
  }, [isOpen, isEditMode, lancamentoParaEditar, categorias, grupos]);

  const formatCurrency = (value: string | number | null | undefined) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseFloat(String(value ?? '')) || 0);

  const getCategoryOptions = (tipo: string): SearchableOption[] =>
    categorias
      .filter((c) => grupos.find((g) => g.id === c.id_grupo)?.tipo === tipo)
      .map((c) => ({ value: c.id, label: `${c.nome} [${grupos.find((g) => g.id === c.id_grupo)?.nome}]` }));

  const getAccountOptions = (): SearchableOption[] => contas.map((c) => ({ value: c.id, label: c.nome_conta }));
  const getPurchaseItemCategoryOptions = (): SearchableOption[] =>
    categorias
      .filter((c) => grupos.find((g) => g.id === c.id_grupo)?.tipo === 'DESPESA')
      .map((c) => ({ value: c.id, label: c.nome }));

  const handleItemCompraChange = (id: string | number, field: ItemField, value: string | number | AutocompleteItem | null) => {
    setFormCompra((prev) => ({
      ...prev,
      itens: prev.itens.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    }));
  };

  const handleItemRateioChange = (id: string | number, field: ItemField, value: string | number | AutocompleteItem | null) => {
    setFormRateio((prev) => ({
      ...prev,
      itens: prev.itens.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    }));
  };

  const somaItensCompra = formCompra.itens.reduce(
    (total, item) => total + ((parseFloat(String(item.quantidade ?? '')) || 0) * (parseFloat(String(item.valor_unitario ?? '')) || 0)),
    0,
  );
  const totalPagoCompra = somaItensCompra - (parseFloat(String(formCompra.desconto ?? '')) || 0);
  const totalRateio = formRateio.itens.reduce((total, item) => total + (parseFloat(String(item.valor_item ?? '')) || 0), 0);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      let finalPayload: SimplesPayload | DetalhadoPayload;
      if (abaAtiva === 'simples') {
        finalPayload = {
          ...formSimples,
          valor: parseFloat(String(formSimples.valor ?? '')),
          id_contato: formSimples.favorecido?.id || null,
        };
        if (!finalPayload.valor || !finalPayload.id_categoria || !finalPayload.id_conta_bancaria) {
          throw new Error('Valor, Categoria e Conta Bancária são obrigatórios.');
        }
      } else if (abaAtiva === 'compra') {
        finalPayload = {
          tipo_rateio: 'COMPRA',
          dados_pai: {
            data_transacao: formCompra.data,
            id_conta_bancaria: formCompra.id_conta_bancaria,
            id_contato: formCompra.favorecido?.id || null,
            descricao: formCompra.descricao,
            valor_desconto: parseFloat(String(formCompra.desconto ?? '')) || 0,
          },
          itens_filho: formCompra.itens.map((item) => ({
            descricao_item: item.descricao_item,
            quantidade: parseFloat(String(item.quantidade ?? '')),
            valor_unitario: parseFloat(String(item.valor_unitario ?? '')),
            id_categoria: item.id_categoria,
          })),
        };
        if (
          !finalPayload.dados_pai.id_conta_bancaria
          || !finalPayload.dados_pai.id_contato
          || !finalPayload.dados_pai.descricao
          || finalPayload.itens_filho.some((item) => !item.id_categoria)
        ) {
          throw new Error('Conta, Fornecedor, Descrição Geral e Categoria de todos os itens são obrigatórios.');
        }
      } else {
        finalPayload = {
          tipo_rateio: 'DETALHADO',
          dados_pai: {
            data_transacao: formRateio.data,
            id_conta_bancaria: formRateio.id_conta_bancaria,
            id_contato: formRateio.favorecido?.id || null,
            id_categoria: formRateio.id_categoria_geral,
            descricao: formRateio.descricao,
          },
          itens_filho: formRateio.itens.map((item) => ({
            valor_item: parseFloat(String(item.valor_item ?? '')),
            id_contato_item: item.favorecido?.id || null,
            id_categoria: item.id_categoria,
            descricao_item: item.descricao_item,
          })),
        };
        if (
          !finalPayload.dados_pai.id_conta_bancaria
          || !finalPayload.dados_pai.id_categoria
          || !finalPayload.dados_pai.descricao
          || finalPayload.itens_filho.some((item) => !item.id_contato_item || !item.id_categoria)
        ) {
          throw new Error('Conta, Categoria Geral, Descrição Geral e Favorecido/Categoria de todos os itens são obrigatórios.');
        }
      }

      let endpoint = '';
      const method = isEditMode ? 'PUT' : 'POST';
      let payloadParaEnviar: SubmitPayload = finalPayload;

      if (isEditMode && !isAdmin && lancamentoParaEditar) {
        const justificativa = await mostrarPromptTexto(
          `Qual o motivo para editar o lançamento #${lancamentoParaEditar.id}?`,
          { placeholder: 'Justificativa obrigatória', tipo: 'aviso' },
        );
        if (!justificativa) throw new Error('Edição cancelada. A justificativa é obrigatória.');
        payloadParaEnviar = { ...finalPayload, justificativa };
        endpoint = abaAtiva === 'simples'
          ? `/api/financeiro/lancamentos/${lancamentoParaEditar.id}`
          : `/api/financeiro/lancamentos/detalhado/${lancamentoParaEditar.id}`;
      } else if (!isEditMode && !isAdmin) {
        const dataSelecionada = abaAtiva === 'simples'
          ? (finalPayload as SimplesPayload).data_transacao
          : (finalPayload as DetalhadoPayload).dados_pai.data_transacao;
        const hoje = getLocalDateString();
        if (dataSelecionada !== hoje) {
          const dataFormatada = new Date(`${dataSelecionada}T12:00:00Z`).toLocaleDateString('pt-BR');
          const justificativa = await mostrarPromptTexto(
            `Justifique o motivo para lançar com data diferente de hoje (${dataFormatada}).`,
            { placeholder: 'Justificativa obrigatória', tipo: 'aviso' },
          );
          if (!justificativa) throw new Error('Lançamento cancelado. Justificativa é obrigatória para datas especiais.');
          endpoint = '/api/financeiro/lancamentos/solicitar-criacao';
          payloadParaEnviar = { lancamento_proposto: finalPayload, justificativa };
        } else {
          endpoint = abaAtiva === 'simples'
            ? '/api/financeiro/lancamentos'
            : '/api/financeiro/lancamentos/detalhado';
        }
      } else if (lancamentoParaEditar) {
        endpoint = isEditMode
          ? (abaAtiva === 'simples'
            ? `/api/financeiro/lancamentos/${lancamentoParaEditar.id}`
            : `/api/financeiro/lancamentos/detalhado/${lancamentoParaEditar.id}`)
          : (abaAtiva === 'simples' ? '/api/financeiro/lancamentos' : '/api/financeiro/lancamentos/detalhado');
      } else {
        endpoint = abaAtiva === 'simples' ? '/api/financeiro/lancamentos' : '/api/financeiro/lancamentos/detalhado';
      }

      const token = localStorage.getItem('token');
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payloadParaEnviar),
      });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error || `Erro ${response.status}`);

      mostrarMensagem(result.message || 'Operação realizada com sucesso!', 'sucesso', 3000);
      onSuccess?.();
      onClose();
    } catch (error: unknown) {
      console.error('Erro ao salvar lançamento:', error);
      mostrarMensagem(error instanceof Error ? error.message : 'Erro ao salvar lançamento.', 'erro');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fc-modal" style={{ display: 'flex' }}>
      <div className="fc-modal-content">
        <button type="button" onClick={onClose} className="fc-modal-close" disabled={isSubmitting}><i className="fas fa-times" /></button>
        <h3 className="fc-section-title" style={{ textAlign: 'center', border: 0 }}>
          {isEditMode ? 'Editar Lançamento' : 'Novo Lançamento'}
        </h3>
        <div className="fc-modal-body">
          <div className="fc-form-group">
            <label>Qual o tipo de lançamento?</label>
            <div className="fc-segmented-control" style={isEditMode ? { pointerEvents: 'none', opacity: 0.7 } : {}}>
              <button type="button" className={`fc-segment-btn ${abaAtiva === 'simples' ? 'active' : ''}`} onClick={() => setAbaAtiva('simples')}>Simples</button>
              <button type="button" className={`fc-segment-btn ${abaAtiva === 'compra' ? 'active' : ''}`} onClick={() => setAbaAtiva('compra')}>Compra Detalhada</button>
              <button type="button" className={`fc-segment-btn ${abaAtiva === 'rateio' ? 'active' : ''}`} onClick={() => setAbaAtiva('rateio')}>Rateio Detalhado</button>
            </div>
          </div>

          {abaAtiva === 'simples' && (
            <form id="formSimples">
              <div className="fc-form-row">
                <div className="fc-form-group"><label>Valor (R$)*</label><input type="number" className="fc-input" step="0.01" required value={formSimples.valor || ''} onChange={(e) => setFormSimples((p) => ({ ...p, valor: e.target.value }))} /></div>
                <div className="fc-form-group"><label>Data*</label><input type="date" className="fc-input" required value={formSimples.data_transacao || ''} onChange={(e) => setFormSimples((p) => ({ ...p, data_transacao: e.target.value }))} /></div>
              </div>
              <div className="fc-form-row">
                <div className="fc-form-group">
                  <label>Tipo*</label>
                  <select className="fc-select" value={formSimples.tipo || 'DESPESA'} onChange={(e) => setFormSimples((p) => ({ ...p, tipo: e.target.value, id_categoria: null }))} disabled={isEditMode}>
                    <option value="DESPESA">Despesa</option>
                    <option value="RECEITA">Receita</option>
                  </select>
                </div>
                <div className="fc-form-group">
                  <label>Categoria*</label>
                  <UISearchableSelect options={getCategoryOptions(formSimples.tipo ?? 'DESPESA')} placeholder="Buscar categoria..." onChange={(val) => setFormSimples((p) => ({ ...p, id_categoria: val }))} initialValue={formSimples.id_categoria} />
                </div>
              </div>
              <div className="fc-form-group"><label>Conta Bancária*</label><UISearchableSelect options={getAccountOptions()} placeholder="Buscar conta..." onChange={(val) => setFormSimples((p) => ({ ...p, id_conta_bancaria: val }))} initialValue={formSimples.id_conta_bancaria} /></div>
              <div className="fc-form-group"><label>Favorecido / Pagador</label><UIAutocompleteAPI apiEndpoint="/api/financeiro/contatos" placeholder="Buscar favorecido..." onSelectionChange={(sel) => setFormSimples((p) => ({ ...p, favorecido: sel }))} initialSelection={formSimples.favorecido} /></div>
              <div className="fc-form-group"><label>Descrição</label><textarea className="fc-input" rows={2} value={formSimples.descricao || ''} onChange={(e) => setFormSimples((p) => ({ ...p, descricao: e.target.value }))} /></div>
            </form>
          )}

          {abaAtiva === 'compra' && (
            <form id="formCompra">
              <div className="fc-form-row">
                <div className="fc-form-group"><label>Data*</label><input type="date" className="fc-input" value={formCompra.data || ''} onChange={(e) => setFormCompra((p) => ({ ...p, data: e.target.value }))} required /></div>
                <div className="fc-form-group"><label>Conta*</label><UISearchableSelect options={getAccountOptions()} onChange={(val) => setFormCompra((p) => ({ ...p, id_conta_bancaria: val }))} initialValue={formCompra.id_conta_bancaria} placeholder="Conta de saída..." /></div>
              </div>
              <div className="fc-form-row">
                <div className="fc-form-group" style={{ flex: 2 }}><label>Fornecedor*</label><UIAutocompleteAPI apiEndpoint="/api/financeiro/contatos" placeholder="Buscar fornecedor..." onSelectionChange={(sel) => setFormCompra((p) => ({ ...p, favorecido: sel }))} initialSelection={formCompra.favorecido} /></div>
                <div className="fc-form-group" style={{ flex: 1 }}><label>Desconto (R$)</label><input type="number" className="fc-input" step="0.01" value={formCompra.desconto || ''} onChange={(e) => setFormCompra((p) => ({ ...p, desconto: e.target.value }))} /></div>
              </div>
              <div className="fc-form-group"><label>Descrição Geral*</label><input type="text" className="fc-input" value={formCompra.descricao || ''} onChange={(e) => setFormCompra((p) => ({ ...p, descricao: e.target.value }))} required /></div>
              <hr style={{ margin: '20px 0' }} />
              <h4 className="fc-section-title" style={{ fontSize: '1.1rem', border: 0, marginBottom: '10px' }}>Itens da Compra</h4>
              <div className="fc-rateio-header" style={{ gridTemplateColumns: 'minmax(0, 2.5fr) 90px 110px 110px minmax(0, 2fr) 40px' }}>
                <span>Produto</span><span>Qtd</span><span>V. Unit.</span><span>V. Total</span><span>Categoria*</span><span>Ação</span>
              </div>
              <div className="grade-itens-rateio">
                {formCompra.itens.map((item) => (
                  <ItemCompraRow key={item.id} item={item} onItemChange={handleItemCompraChange} onItemRemove={(id) => setFormCompra((p) => ({ ...p, itens: p.itens.filter((i) => i.id !== id) }))} categoryOptions={getPurchaseItemCategoryOptions()} />
                ))}
              </div>
              <button type="button" className="fc-btn fc-btn-outline" style={{ marginTop: '10px' }} onClick={() => setFormCompra((p) => ({ ...p, itens: [...p.itens, { id: Date.now(), descricao_item: '', quantidade: '1', valor_unitario: '', id_categoria: null }] }))}>
                <i className="fas fa-plus" /> Adicionar Item
              </button>
              <div className="resumo-rateio" style={{ textAlign: 'right', marginTop: '20px', fontWeight: 'bold' }}>
                <span>Soma: <strong>{formatCurrency(somaItensCompra)}</strong></span> |
                <span> Desconto: <strong>- {formatCurrency(formCompra.desconto)}</strong></span> |
                <span style={{ color: 'var(--fc-cor-primaria)' }}> Total: <strong>{formatCurrency(totalPagoCompra)}</strong></span>
              </div>
            </form>
          )}

          {abaAtiva === 'rateio' && (
            <form id="formRateio">
              <div className="fc-form-row">
                <div className="fc-form-group"><label>Data*</label><input type="date" className="fc-input" value={formRateio.data || ''} onChange={(e) => setFormRateio((p) => ({ ...p, data: e.target.value }))} required /></div>
                <div className="fc-form-group"><label>Conta*</label><UISearchableSelect options={getAccountOptions()} onChange={(val) => setFormRateio((p) => ({ ...p, id_conta_bancaria: val }))} initialValue={formRateio.id_conta_bancaria} placeholder="Conta de saída..." /></div>
              </div>
              <div className="fc-form-group"><label>Favorecido (Órgão)</label><UIAutocompleteAPI apiEndpoint="/api/financeiro/contatos" placeholder="Buscar favorecido principal..." onSelectionChange={(sel) => setFormRateio((p) => ({ ...p, favorecido: sel }))} initialSelection={formRateio.favorecido} /></div>
              <div className="fc-form-group"><label>Categoria Geral*</label><UISearchableSelect options={getCategoryOptions('DESPESA')} onChange={(val) => setFormRateio((p) => ({ ...p, id_categoria_geral: val }))} initialValue={formRateio.id_categoria_geral} placeholder="Categoria principal..." /></div>
              <div className="fc-form-group"><label>Descrição Geral*</label><input type="text" className="fc-input" value={formRateio.descricao || ''} onChange={(e) => setFormRateio((p) => ({ ...p, descricao: e.target.value }))} required /></div>
              <hr style={{ margin: '20px 0' }} />
              <h4 className="fc-section-title" style={{ fontSize: '1.1rem', border: 0, marginBottom: '10px' }}>Detalhamento dos Custos</h4>
              <div className="fc-rateio-header" style={{ gridTemplateColumns: '2.5fr 2.5fr 2fr 130px 40px' }}>
                <span>Favorecido*</span><span>Categoria*</span><span>Descrição</span><span>Valor (R$)*</span><span>Ação</span>
              </div>
              <div className="grade-itens-rateio">
                {formRateio.itens.map((item) => (
                  <ItemRateioRow key={item.id} item={item} onItemChange={handleItemRateioChange} onItemRemove={(id) => setFormRateio((p) => ({ ...p, itens: p.itens.filter((i) => i.id !== id) }))} categoryOptions={getCategoryOptions('DESPESA')} />
                ))}
              </div>
              <button type="button" className="fc-btn fc-btn-outline" style={{ marginTop: '10px' }} onClick={() => setFormRateio((p) => ({ ...p, itens: [...p.itens, { id: Date.now(), favorecido: null, id_categoria: null, descricao_item: '', valor_item: '' }] }))}>
                <i className="fas fa-plus" /> Adicionar Rateio
              </button>
              <div className="resumo-rateio" style={{ textAlign: 'right', marginTop: '20px', fontWeight: 'bold' }}>
                <span style={{ color: 'var(--fc-cor-primaria)' }}>Total Distribuído: <strong>{formatCurrency(totalRateio)}</strong></span>
              </div>
            </form>
          )}
        </div>
        <div className="fc-modal-footer">
          <button type="button" onClick={onClose} className="fc-btn fc-btn-secundario" disabled={isSubmitting}>Cancelar</button>
          <button type="button" onClick={() => void handleSubmit()} className="fc-btn fc-btn-primario" disabled={isSubmitting}>
            {isSubmitting ? <><i className="fas fa-spinner fa-spin" /> Salvando...</> : (isEditMode ? 'Salvar Alterações' : 'Salvar')}
          </button>
        </div>
      </div>
    </div>
  );
}
