import { useEffect, useState } from 'react';
import { fetchFinanceiro } from '../utils/financeiro-api';
import type { FinanceiroConfigModalKind, FinanceiroConfigModalRequest } from '../utils/financeiro-types';
import { useFinanceiro } from './FinanceiroContext';

const EMPTY: Record<FinanceiroConfigModalKind, Record<string, string>> = {
  conta: { nome_conta: '', banco: '', agencia: '', numero_conta: '' },
  contato: { nome: '', tipo: '', cpf_cnpj: '', observacoes: '' },
  grupo: { nome: '', tipo: 'DESPESA' },
  categoria: { nome: '', id_grupo: '' },
};

const TITLES: Record<FinanceiroConfigModalKind, string> = {
  conta: 'Conta bancária',
  contato: 'Favorecido',
  grupo: 'Grupo financeiro',
  categoria: 'Categoria',
};

function valuesFor(kind: FinanceiroConfigModalKind, item?: FinanceiroConfigModalRequest['item']) {
  const base = { ...EMPTY[kind] };
  Object.keys(base).forEach((key) => {
    const value = item?.[key as keyof NonNullable<FinanceiroConfigModalRequest['item']>];
    base[key] = value == null ? base[key] : String(value);
  });
  return base;
}

export default function FinanceiroConfiguracaoModal() {
  const { configModal, closeConfigModal, refresh, config } = useFinanceiro();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configModal) return;
    setValues(valuesFor(configModal.kind, configModal.item));
    setError(null);
  }, [configModal]);

  if (!configModal) return null;

  const { kind, item } = configModal;
  const change = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const endpoint = kind === 'conta' ? '/contas' : kind === 'contato' ? '/contatos' : kind === 'grupo' ? '/grupos' : '/categorias';
      const payload: Record<string, unknown> = { ...values };
      if (kind === 'categoria') payload.id_grupo = Number(values.id_grupo);
      await fetchFinanceiro(endpoint + (item?.id ? `/${item.id}` : ''), {
        method: item?.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      closeConfigModal();
      refresh('config');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fc-modal" style={{ display: 'flex' }} role="dialog" aria-modal="true">
      <div className="fc-modal-content">
        <button type="button" className="fc-modal-close" onClick={closeConfigModal}>X</button>
        <h3 className="fc-section-title" style={{ textAlign: 'center' }}>
          {item?.id ? `Editar ${TITLES[kind]}` : `Adicionar ${TITLES[kind]}`}
        </h3>
        <form id="financeiro-config-form" onSubmit={(event) => void save(event)} className="fc-modal-body">
          {kind === 'conta' && (
            <>
              <div className="fc-form-group"><label>Nome da conta</label><input className="fc-input" required value={values.nome_conta ?? ''} onChange={(e) => change('nome_conta', e.target.value)} /></div>
              <div className="fc-form-group"><label>Banco</label><input className="fc-input" value={values.banco ?? ''} onChange={(e) => change('banco', e.target.value)} /></div>
              <div className="fc-form-group"><label>Agência</label><input className="fc-input" value={values.agencia ?? ''} onChange={(e) => change('agencia', e.target.value)} /></div>
              <div className="fc-form-group"><label>Número da conta</label><input className="fc-input" value={values.numero_conta ?? ''} onChange={(e) => change('numero_conta', e.target.value)} /></div>
            </>
          )}
          {kind === 'contato' && (
            <>
              <div className="fc-form-group"><label>Nome</label><input className="fc-input" required value={values.nome ?? ''} onChange={(e) => change('nome', e.target.value)} /></div>
              <div className="fc-form-group">
                <label>Tipo</label>
                <select className="fc-select" value={values.tipo ?? ''} onChange={(e) => change('tipo', e.target.value)}>
                  <option value="">Selecione...</option>
                  <option value="CLIENTE">Cliente</option>
                  <option value="FORNECEDOR">Fornecedor</option>
                  <option value="FUNCIONARIO">Funcionário</option>
                  <option value="SOCIO">Sócio</option>
                  <option value="OUTRO">Outro</option>
                </select>
              </div>
              <div className="fc-form-group"><label>CPF/CNPJ</label><input className="fc-input" value={values.cpf_cnpj ?? ''} onChange={(e) => change('cpf_cnpj', e.target.value)} /></div>
              <div className="fc-form-group"><label>Observações</label><input className="fc-input" value={values.observacoes ?? ''} onChange={(e) => change('observacoes', e.target.value)} /></div>
            </>
          )}
          {kind === 'grupo' && (
            <>
              <div className="fc-form-group"><label>Nome</label><input className="fc-input" required value={values.nome ?? ''} onChange={(e) => change('nome', e.target.value)} /></div>
              <div className="fc-form-group">
                <label>Tipo</label>
                <select className="fc-select" required value={values.tipo ?? 'DESPESA'} onChange={(e) => change('tipo', e.target.value)}>
                  <option value="DESPESA">Despesa</option>
                  <option value="RECEITA">Receita</option>
                </select>
              </div>
            </>
          )}
          {kind === 'categoria' && (
            <>
              <div className="fc-form-group"><label>Nome</label><input className="fc-input" required value={values.nome ?? ''} onChange={(e) => change('nome', e.target.value)} /></div>
              <div className="fc-form-group">
                <label>Grupo</label>
                <select className="fc-select" required value={values.id_grupo ?? ''} onChange={(e) => change('id_grupo', e.target.value)}>
                  <option value="">Selecione...</option>
                  {config.grupos.map((grupo) => <option key={grupo.id} value={grupo.id}>{grupo.nome} ({grupo.tipo})</option>)}
                </select>
              </div>
            </>
          )}
          {error && <p style={{ color: 'var(--gs-perigo)' }}>{error}</p>}
        </form>
        <div className="fc-modal-footer">
          <button type="button" className="fc-btn fc-btn-secundario" onClick={closeConfigModal}>Cancelar</button>
          <button type="submit" form="financeiro-config-form" className="fc-btn fc-btn-primario" disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
