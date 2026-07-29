import { useEffect, useMemo, useState, type FormEvent } from 'react';
import UISearchableSelect, { type SearchableOption } from './UISearchableSelect.tsx';
import FinanceiroModalShell, { FinanceiroResumoOperacao } from './FinanceiroModalShell';
import { fetchFinanceiro } from '../utils/financeiro-api';
import { useFinanceiro } from './FinanceiroContext';

const FORM_ID = 'financeiro-baixa-agendamento-form';
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function hojeLocal(): string {
  const data = new Date();
  return new Date(data.getTime() - data.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export default function FinanceiroAgendaModal() {
  const { agendaModal, closeAgendaModal, refresh, config } = useFinanceiro();
  const [data, setData] = useState(hojeLocal);
  const [contaId, setContaId] = useState<string | number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (agendaModal?.mode !== 'baixa') return;
    setData(hojeLocal());
    setContaId(null);
    setError(null);
  }, [agendaModal]);

  const accountOptions = useMemo<SearchableOption[]>(
    () => config.contas.map((conta) => ({
      value: conta.id,
      label: `${conta.nome_conta}${conta.saldo_atual != null ? ` · ${moeda.format(Number(conta.saldo_atual))}` : ''}`,
    })),
    [config.contas],
  );

  if (agendaModal?.mode !== 'baixa' || !agendaModal.item) return null;
  const item = agendaModal.item;
  const isRecebimento = item.tipo === 'A_RECEBER';

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!contaId || !data) {
      setError('Selecione a conta e a data efetiva.');
      return;
    }
    setSaving(true);
    try {
      await fetchFinanceiro(`/contas-agendadas/${item.id}/baixar`, {
        method: 'POST',
        body: JSON.stringify({ data_transacao: data, id_conta_bancaria: contaId }),
      });
      closeAgendaModal();
      refresh('agenda');
      refresh('lancamentos');
      refresh('dashboard');
      refresh('header');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível confirmar a baixa.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FinanceiroModalShell
      titulo={isRecebimento ? 'Confirmar recebimento' : 'Confirmar pagamento'}
      descricao="Transforme esta previsão em um lançamento real."
      icone={isRecebimento ? 'fa-arrow-down' : 'fa-arrow-up'}
      onClose={closeAgendaModal}
      formId={FORM_ID}
      textoAcao={isRecebimento ? 'Confirmar recebimento' : 'Confirmar pagamento'}
      textoProcessando="Confirmando..."
      processando={saving}
      erro={error}
      tamanho="md"
    >
      <form id={FORM_ID} className="fc-baixa-form" onSubmit={(event) => void save(event)}>
        <FinanceiroResumoOperacao titulo="Compromisso previsto">
          <div className="fc-baixa-preview">
            <span><small>Descrição</small><strong>{item.descricao}</strong></span>
            <span><small>Vencimento</small><strong>{new Date(`${item.data_vencimento.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}</strong></span>
            <span><small>Valor previsto</small><strong>{moeda.format(Number(item.valor))}</strong></span>
            <span><small>{isRecebimento ? 'Pagador' : 'Favorecido'}</small><strong>{item.nome_favorecido || 'Não informado'}</strong></span>
          </div>
        </FinanceiroResumoOperacao>

        <section className="fc-modal-section">
          <div className="fc-modal-section__title">
            <span>1</span>
            <div>
              <h3>Informe como aconteceu de verdade</h3>
              <p>A conta e a data abaixo serão usadas no lançamento real.</p>
            </div>
          </div>
          <div className="fc-baixa-fields">
            <label className="fc-form-group">
              <span>Conta efetiva</span>
              <UISearchableSelect
                options={accountOptions}
                placeholder="Buscar conta..."
                onChange={setContaId}
                initialValue={contaId}
              />
            </label>
            <label className="fc-form-group">
              <span>Data efetiva</span>
              <input className="fc-input" type="date" value={data} onChange={(event) => setData(event.target.value)} required />
            </label>
          </div>
          <p className="fc-composer-balance-note">
            <i className="fas fa-circle-info" aria-hidden="true" />
            Ao confirmar, o agendamento será marcado como pago e um lançamento real será criado.
          </p>
        </section>
      </form>
    </FinanceiroModalShell>
  );
}
