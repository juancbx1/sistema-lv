import { useEffect, useState } from 'react';
import UIAutocompleteAPI, { type AutocompleteItem } from './UIAutocompleteAPI.tsx';
import { fetchFinanceiro } from '../utils/financeiro-api';
import { useFinanceiro } from './FinanceiroContext';

type Kind = 'simple' | 'compra' | 'rateio' | 'lote' | 'baixa';
interface ItemRow { descricao: string; valor: string; categoria: string; contato: AutocompleteItem | null; }
interface Parcela { data: string; valor: string; }

const today = () => new Date().toISOString().slice(0, 10);
const emptyItem = (): ItemRow => ({ descricao: '', valor: '', categoria: '', contato: null });

export default function FinanceiroAgendaModal() {
  const { agendaModal, closeAgendaModal, refresh, config } = useFinanceiro();
  const [kind, setKind] = useState<Kind>('simple');
  const [data, setData] = useState(today());
  const [conta, setConta] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ItemRow[]>([emptyItem()]);
  const [parcelas, setParcelas] = useState<Parcela[]>([{ data: today(), valor: '' }]);
  const [favorecido, setFavorecido] = useState<AutocompleteItem | null>(null);
  const [categoria, setCategoria] = useState('');
  const [tipo, setTipo] = useState('A_PAGAR');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [vencimento, setVencimento] = useState(today());

  useEffect(() => {
    if (!agendaModal) return;
    setKind(agendaModal.mode === 'baixa' ? 'baixa' : 'simple');
    setData(today());
    setError(null);
    setItems([emptyItem()]);
    setParcelas([{ data: today(), valor: '' }]);
    setConta('');
    setCategoria(agendaModal.item?.id_categoria != null ? String(agendaModal.item.id_categoria) : '');
    setTipo(agendaModal.item?.tipo ?? 'A_PAGAR');
    setDescricao(agendaModal.item?.descricao ?? '');
    setValor(agendaModal.item?.valor != null ? String(agendaModal.item.valor) : '');
    setVencimento(agendaModal.item?.data_vencimento?.slice(0, 10) ?? today());
    setFavorecido(
      agendaModal.item?.id_contato
        ? { id: agendaModal.item.id_contato, nome: agendaModal.item.nome_favorecido || '' }
        : null,
    );
  }, [agendaModal]);

  if (!agendaModal) return null;

  const isBaixa = kind === 'baixa';
  const isAdvanced = kind === 'compra' || kind === 'rateio';
  const updateItem = (index: number, field: keyof ItemRow, value: string | AutocompleteItem | null) => {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)));
  };
  const updateParcela = (index: number, field: keyof Parcela, value: string) => {
    setParcelas((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (isBaixa) {
        if (!conta) throw new Error('Selecione a conta bancária.');
        await fetchFinanceiro(`/contas-agendadas/${agendaModal.item?.id}/baixar`, {
          method: 'POST',
          body: JSON.stringify({ data_transacao: data, id_conta_bancaria: Number(conta) }),
        });
      } else if (isAdvanced) {
        const dadosPai = {
          data_vencimento: vencimento,
          id_contato: favorecido?.id ?? null,
          descricao,
          tipo: 'A_PAGAR',
          id_categoria: kind === 'rateio' ? Number(categoria) : null,
        };
        const itens_filho = items.map((item) => ({
          descricao_item: item.descricao,
          valor_item: Number(item.valor),
          id_categoria: Number(item.categoria),
          id_contato_item: item.contato?.id ?? null,
        }));
        if (!descricao || itens_filho.some((item) => !item.valor_item || !item.id_categoria)) {
          throw new Error('Preencha descrição, categoria e valor de todos os itens.');
        }
        await fetchFinanceiro(`/contas-agendadas/detalhado${agendaModal.item?.id ? `/${agendaModal.item.id}` : ''}`, {
          method: agendaModal.item?.id ? 'PUT' : 'POST',
          body: JSON.stringify({
            tipo_rateio: kind === 'compra' ? 'COMPRA' : 'DETALHADO',
            dados_pai: dadosPai,
            itens_filho,
          }),
        });
      } else if (kind === 'lote') {
        if (!categoria || !descricao) throw new Error('Preencha descrição e categoria do lote.');
        const payload = {
          descricao_lote: descricao,
          valor_total: parcelas.reduce((sum, parcela) => sum + Number(parcela.valor || 0), 0),
          parcelas: parcelas.map((parcela, index) => ({
            parcela: index + 1,
            data_vencimento: parcela.data,
            valor: Number(parcela.valor),
            descricao: `${descricao} - Parcela ${index + 1}/${parcelas.length}`,
            id_categoria: Number(categoria),
            id_contato: favorecido?.id ?? null,
            tipo,
          })),
        };
        if (payload.parcelas.some((parcela) => !parcela.data_vencimento || !parcela.valor || !parcela.id_categoria)) {
          throw new Error('Preencha data, valor e categoria de todas as parcelas.');
        }
        await fetchFinanceiro('/contas-agendadas/lote', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        if (!valor || !categoria || !descricao) throw new Error('Preencha valor, categoria e descrição.');
        const body = {
          tipo,
          data_vencimento: vencimento,
          descricao,
          valor: Number(valor),
          id_categoria: Number(categoria),
          id_contato: favorecido?.id ?? null,
        };
        await fetchFinanceiro(`/contas-agendadas${agendaModal.item?.id ? `/${agendaModal.item.id}` : ''}`, {
          method: agendaModal.item?.id ? 'PUT' : 'POST',
          body: JSON.stringify(body),
        });
      }
      closeAgendaModal();
      refresh('agenda');
      refresh('dashboard');
      refresh('header');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o agendamento.');
    } finally {
      setSaving(false);
    }
  };

  const title = isBaixa
    ? 'Confirmar baixa'
    : agendaModal.item?.id
      ? 'Editar agendamento'
      : kind === 'lote'
        ? 'Parcelamento'
        : isAdvanced
          ? (kind === 'compra' ? 'Compra detalhada' : 'Rateio detalhado')
          : 'Novo agendamento';

  return (
    <div className="fc-modal" style={{ display: 'flex' }} role="dialog" aria-modal="true">
      <div className="fc-modal-content">
        <button type="button" className="fc-modal-close" onClick={closeAgendaModal}>X</button>
        <h3 className="fc-section-title" style={{ textAlign: 'center' }}>{title}</h3>

        {!isBaixa && !agendaModal.item?.id && (
          <div className="fc-segmented-control">
            <button type="button" className={`fc-segment-btn ${kind === 'simple' ? 'active' : ''}`} onClick={() => setKind('simple')}>Simples</button>
            <button type="button" className={`fc-segment-btn ${kind === 'compra' ? 'active' : ''}`} onClick={() => setKind('compra')}>Compra detalhada</button>
            <button type="button" className={`fc-segment-btn ${kind === 'rateio' ? 'active' : ''}`} onClick={() => setKind('rateio')}>Rateio</button>
            <button type="button" className={`fc-segment-btn ${kind === 'lote' ? 'active' : ''}`} onClick={() => setKind('lote')}>Parcelas</button>
          </div>
        )}

        <form id="financeiro-agenda-form" className="fc-modal-body" onSubmit={(event) => void save(event)}>
          {isBaixa ? (
            <>
              <p>Informe a data e a conta para registrar a baixa.</p>
              <div className="fc-form-group">
                <label>Data</label>
                <input className="fc-input" type="date" required value={data} onChange={(e) => setData(e.target.value)} />
              </div>
              <div className="fc-form-group">
                <label>Conta bancária</label>
                <select className="fc-select" required value={conta} onChange={(e) => setConta(e.target.value)}>
                  <option value="">Selecione...</option>
                  {config.contas.map((item) => <option key={item.id} value={item.id}>{item.nome_conta}</option>)}
                </select>
              </div>
            </>
          ) : kind === 'lote' ? (
            <>
              <div className="fc-form-group">
                <label>Descrição do lote</label>
                <input className="fc-input" required value={descricao} onChange={(e) => setDescricao(e.target.value)} />
              </div>
              <div className="fc-form-row">
                <div className="fc-form-group">
                  <label>Tipo</label>
                  <select className="fc-select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                    <option value="A_PAGAR">A Pagar</option>
                    <option value="A_RECEBER">A Receber</option>
                  </select>
                </div>
                <div className="fc-form-group">
                  <label>Categoria</label>
                  <select className="fc-select" required value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                    <option value="">Selecione...</option>
                    {config.categorias.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
                  </select>
                </div>
              </div>
              <div className="fc-form-group">
                <label>Favorecido</label>
                <UIAutocompleteAPI apiEndpoint="/api/financeiro/contatos" placeholder="Buscar favorecido..." onSelectionChange={setFavorecido} initialSelection={favorecido} />
              </div>
              {parcelas.map((parcela, index) => (
                <div className="fc-form-row" key={index}>
                  <input className="fc-input" type="date" value={parcela.data} onChange={(e) => updateParcela(index, 'data', e.target.value)} required />
                  <input className="fc-input" type="number" step="0.01" placeholder="Valor da parcela" value={parcela.valor} onChange={(e) => updateParcela(index, 'valor', e.target.value)} required />
                  <button type="button" className="fc-btn fc-btn-outline" onClick={() => setParcelas((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>
                </div>
              ))}
              <button type="button" className="fc-btn fc-btn-outline" onClick={() => setParcelas((current) => [...current, { data: today(), valor: '' }])}>Adicionar parcela</button>
            </>
          ) : (
            <>
              <div className="fc-form-row">
                <div className="fc-form-group">
                  <label>Tipo</label>
                  <select className="fc-select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                    <option value="A_PAGAR">A Pagar</option>
                    <option value="A_RECEBER">A Receber</option>
                  </select>
                </div>
                <div className="fc-form-group">
                  <label>Vencimento</label>
                  <input className="fc-input" type="date" required value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
                </div>
              </div>
              <div className="fc-form-group">
                <label>Descrição</label>
                <input className="fc-input" required value={descricao} onChange={(e) => setDescricao(e.target.value)} />
              </div>
              {isAdvanced ? (
                <>
                  <div className="fc-form-group">
                    <label>Favorecido</label>
                    <UIAutocompleteAPI apiEndpoint="/api/financeiro/contatos" placeholder="Buscar favorecido..." onSelectionChange={setFavorecido} initialSelection={favorecido} />
                  </div>
                  {kind === 'rateio' && (
                    <div className="fc-form-group">
                      <label>Categoria geral</label>
                      <select className="fc-select" required value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                        <option value="">Selecione...</option>
                        {config.categorias.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="fc-form-group">
                    <label>Itens</label>
                    {items.map((item, index) => (
                      <div className="fc-form-row" key={index} style={{ flexWrap: 'wrap' }}>
                        <input className="fc-input" placeholder="Descrição" value={item.descricao} onChange={(e) => updateItem(index, 'descricao', e.target.value)} />
                        <input className="fc-input" placeholder="Valor" type="number" step="0.01" value={item.valor} onChange={(e) => updateItem(index, 'valor', e.target.value)} />
                        <select className="fc-select" value={item.categoria} onChange={(e) => updateItem(index, 'categoria', e.target.value)}>
                          <option value="">Categoria...</option>
                          {config.categorias.map((cat) => <option key={cat.id} value={cat.id}>{cat.nome}</option>)}
                        </select>
                        <button type="button" className="fc-btn fc-btn-outline" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>
                      </div>
                    ))}
                    <button type="button" className="fc-btn fc-btn-outline" onClick={() => setItems((current) => [...current, emptyItem()])}>Adicionar item</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="fc-form-group">
                    <label>Valor</label>
                    <input className="fc-input" type="number" step="0.01" required value={valor} onChange={(e) => setValor(e.target.value)} />
                  </div>
                  <div className="fc-form-group">
                    <label>Categoria</label>
                    <select className="fc-select" required value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                      <option value="">Selecione...</option>
                      {config.categorias.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
                    </select>
                  </div>
                  <div className="fc-form-group">
                    <label>Favorecido</label>
                    <UIAutocompleteAPI apiEndpoint="/api/financeiro/contatos" placeholder="Buscar favorecido..." onSelectionChange={setFavorecido} initialSelection={favorecido} />
                  </div>
                </>
              )}
            </>
          )}
        </form>

        {error && <p style={{ color: 'var(--gs-perigo)', padding: '0 20px' }}>{error}</p>}
        <div className="fc-modal-footer">
          <button type="button" className="fc-btn fc-btn-secundario" onClick={closeAgendaModal}>Cancelar</button>
          <button type="submit" form="financeiro-agenda-form" className="fc-btn fc-btn-primario" disabled={saving}>
            {saving ? 'Salvando...' : isBaixa ? 'Confirmar baixa' : 'Salvar agendamento'}
          </button>
        </div>
      </div>
    </div>
  );
}
