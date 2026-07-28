import { useState } from 'react';
import { fetchFinanceiro } from '../utils/financeiro-api';
import { useFinanceiro } from './FinanceiroContext';

export default function FinanceiroConcessionariaModal() {
  const { concessionariaOpen, closeConcessionariaModal } = useFinanceiro();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!concessionariaOpen) return null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const raw = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement).entries());
      await fetchFinanceiro('/concessionarias-vt', {
        method: 'POST',
        body: JSON.stringify({
          nome: raw.nome,
          taxa_recarga_percentual: Number(raw.taxa_recarga_percentual),
        }),
      });
      closeConcessionariaModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a concessionária.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fc-modal" style={{ display: 'flex' }} role="dialog" aria-modal="true">
      <div className="fc-modal-content">
        <button type="button" className="fc-modal-close" onClick={closeConcessionariaModal}>X</button>
        <h3 className="fc-section-title">Nova concessionária</h3>
        <form id="financeiro-concessionaria-form" className="fc-modal-body" onSubmit={(event) => void save(event)}>
          <div className="fc-form-group"><label>Nome</label><input className="fc-input" name="nome" required /></div>
          <div className="fc-form-group">
            <label>Taxa de recarga (%)</label>
            <input className="fc-input" name="taxa_recarga_percentual" type="number" step="0.01" defaultValue="5" required />
          </div>
          {error && <p style={{ color: 'var(--gs-perigo)' }}>{error}</p>}
        </form>
        <div className="fc-modal-footer">
          <button type="button" className="fc-btn fc-btn-secundario" onClick={closeConcessionariaModal}>Cancelar</button>
          <button type="submit" form="financeiro-concessionaria-form" className="fc-btn fc-btn-primario" disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
