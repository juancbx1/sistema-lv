import { useEffect, useState, type FormEvent } from 'react';
import { fetchFinanceiro } from '../utils/financeiro-api';
import type { FinanceiroCategoria, FinanceiroConta } from '../utils/financeiro-types';
import { useFinanceiro } from './FinanceiroContext';

export default function FinanceiroTransferenciaModal() {
  const { transferenciaOpen, closeTransferenciaModal, refresh, config } = useFinanceiro();
  const [contas, setContas] = useState<FinanceiroConta[]>(config.contas);
  const [categorias, setCategorias] = useState<FinanceiroCategoria[]>(config.categorias);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!transferenciaOpen) return;
    setError(null);
    void fetchFinanceiro<{ saldos: FinanceiroConta[] }>('/dashboard').then((data) => setContas(data.saldos));
    void fetchFinanceiro<{ categorias: FinanceiroCategoria[] }>('/configuracoes').then((data) => setCategorias(data.categorias));
  }, [transferenciaOpen]);

  if (!transferenciaOpen) return null;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const raw = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement).entries());
      const categoria = categorias.find((item) => item.nome.toLowerCase().includes('transfer'));
      if (!categoria) throw new Error('Categoria de transferência entre contas não encontrada.');
      if (raw.id_conta_origem === raw.id_conta_destino) throw new Error('As contas de origem e destino devem ser diferentes.');
      await fetchFinanceiro('/transferencias', {
        method: 'POST',
        body: JSON.stringify({
          ...raw,
          valor: Number(raw.valor),
          id_categoria_transferencia: categoria.id,
        }),
      });
      closeTransferenciaModal();
      refresh('dashboard');
      refresh('lancamentos');
      refresh('header');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível realizar a transferência.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fc-modal" style={{ display: 'flex' }} role="dialog" aria-modal="true">
      <div className="fc-modal-content">
        <button type="button" className="fc-modal-close" onClick={closeTransferenciaModal}>X</button>
        <h3 className="fc-section-title" style={{ textAlign: 'center', border: 0 }}>Transferir dinheiro entre contas</h3>
        <form id="financeiro-transferencia-form" className="fc-modal-body" onSubmit={(event) => void save(event)}>
          <div className="fc-form-group"><label>Valor</label><input className="fc-input" name="valor" type="number" step="0.01" min="0.01" required /></div>
          <div className="fc-form-group"><label>Data</label><input className="fc-input" name="data_transacao" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></div>
          <div className="fc-form-group">
            <label>Conta de origem</label>
            <select className="fc-select" name="id_conta_origem" required>
              <option value="">Selecione...</option>
              {contas.map((conta) => (
                <option value={conta.id} key={conta.id}>
                  {conta.nome_conta} — R$ {Number(conta.saldo_atual ?? 0).toFixed(2)}
                </option>
              ))}
            </select>
          </div>
          <div className="fc-form-group">
            <label>Conta de destino</label>
            <select className="fc-select" name="id_conta_destino" required>
              <option value="">Selecione...</option>
              {contas.map((conta) => <option value={conta.id} key={conta.id}>{conta.nome_conta}</option>)}
            </select>
          </div>
          <div className="fc-form-group"><label>Descrição</label><textarea className="fc-input" name="descricao" rows={2} /></div>
          {error && <p style={{ color: 'var(--gs-perigo)' }}>{error}</p>}
        </form>
        <div className="fc-modal-footer">
          <button type="button" className="fc-btn fc-btn-secundario" onClick={closeTransferenciaModal}>Cancelar</button>
          <button type="submit" form="financeiro-transferencia-form" className="fc-btn fc-btn-primario" disabled={saving}>
            {saving ? 'Transferindo...' : 'Confirmar transferência'}
          </button>
        </div>
      </div>
    </div>
  );
}
