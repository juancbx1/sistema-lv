import { type FormEvent, useState } from 'react';
import { fetchFinanceiro } from '../utils/financeiro-api';
import { useFinanceiro } from './FinanceiroContext';

export default function FinanceiroEstornoModal() {
  const { estornoItem, closeEstornoModal, refresh, config } = useFinanceiro();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!estornoItem) return null;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const raw = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement).entries());
      await fetchFinanceiro(`/lancamentos/${estornoItem.id}/estornar`, {
        method: 'POST',
        body: JSON.stringify({
          valor_estornado: Number(raw.valor_estornado),
          data_transacao: raw.data_transacao,
          id_conta_bancaria: Number(raw.id_conta_bancaria),
        }),
      });
      closeEstornoModal();
      refresh('lancamentos');
      refresh('dashboard');
      refresh('header');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível registrar o estorno.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fc-modal" style={{ display: 'flex' }} role="dialog" aria-modal="true">
      <div className="fc-modal-content">
        <button type="button" className="fc-modal-close" onClick={closeEstornoModal}>X</button>
        <h3 className="fc-section-title" style={{ textAlign: 'center' }}>Registrar estorno</h3>
        <p style={{ textAlign: 'center' }}>
          Lançamento #{estornoItem.id}: <strong>{estornoItem.descricao || 'sem descrição'}</strong>
        </p>
        <form id="financeiro-estorno-form" className="fc-modal-body" onSubmit={(event) => void save(event)}>
          <div className="fc-form-group">
            <label>Valor estornado</label>
            <input className="fc-input" name="valor_estornado" type="number" step="0.01" min="0.01" defaultValue={estornoItem.valor} required />
          </div>
          <div className="fc-form-group">
            <label>Data do recebimento</label>
            <input className="fc-input" name="data_transacao" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
          </div>
          <div className="fc-form-group">
            <label>Conta bancária</label>
            <select className="fc-select" name="id_conta_bancaria" defaultValue={estornoItem.id_conta_bancaria ?? ''} required>
              <option value="">Selecione...</option>
              {config.contas.map((conta) => <option key={conta.id} value={conta.id}>{conta.nome_conta}</option>)}
            </select>
          </div>
          {error && <p style={{ color: 'var(--gs-perigo)' }}>{error}</p>}
        </form>
        <div className="fc-modal-footer">
          <button type="button" className="fc-btn fc-btn-secundario" onClick={closeEstornoModal}>Cancelar</button>
          <button type="submit" form="financeiro-estorno-form" className="fc-btn fc-btn-primario" disabled={saving}>
            {saving ? 'Salvando...' : 'Confirmar estorno'}
          </button>
        </div>
      </div>
    </div>
  );
}
