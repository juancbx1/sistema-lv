import { useMemo, useState } from 'react';
import Select, { components, type NoticeProps, type StylesConfig } from 'react-select';
import { formatarMoeda } from '../utils/cpag-format';
import { mostrarConfirmacao, mostrarToast } from '../utils/cpag-feedback';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import { fetchCpag } from '../utils/cpag-api';
import type {
  CpagContaFinanceira,
  CpagPayloadEfetuar,
  CpagRespostaEfetuar,
  CpagSelectOption,
  CpagUsuario,
} from '../utils/cpag-types';

interface Props {
  usuarios: CpagUsuario[];
  contas: CpagContaFinanceira[];
}

function NoOptionsMessage(props: NoticeProps<CpagSelectOption, false>) {
  return (
    <components.NoOptionsMessage {...props}>
      <div style={{ padding: '10px' }}>
        <UIFeedbackNotFound
          icon="fa-search"
          titulo="Sem resultados"
          mensagem="Tente buscar por outro termo."
        />
      </div>
    </components.NoOptionsMessage>
  );
}

const selectStyles: StylesConfig<CpagSelectOption, false> = {
  control: (base) => ({ ...base, borderRadius: '8px', minHeight: '45px' }),
};

export default function CPAGBonus({ usuarios, contas }: Props) {
  const [selectedUser, setSelectedUser] = useState<CpagSelectOption | null>(null);
  const [selectedConta, setSelectedConta] = useState<CpagSelectOption | null>(null);
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);

  const userOptions = useMemo<CpagSelectOption[]>(
    () => usuarios.map((usuario) => ({ value: usuario.id, label: usuario.nome })),
    [usuarios],
  );
  const contaOptions = useMemo<CpagSelectOption[]>(
    () => contas.map((conta) => ({ value: conta.id, label: conta.nome_conta })),
    [contas],
  );

  const ajustarValor = (delta: number) =>
    setValor(Math.max(0, (Number.parseFloat(valor) || 0) + delta).toFixed(2));

  const handleConcederBonus = async () => {
    const valorNumerico = Number.parseFloat(valor);
    if (!selectedUser || !valor || !motivo || !selectedConta) {
      mostrarToast('Preencha todos os campos obrigatórios.', 'aviso');
      return;
    }
    if (valorNumerico <= 0) {
      mostrarToast('O valor deve ser maior que zero.', 'aviso');
      return;
    }
    const confirmado = await mostrarConfirmacao(
      `Confirma o bônus de ${formatarMoeda(valor)} para ${selectedUser.label}?`,
      { tipo: 'aviso', textoConfirmar: 'Sim, Conceder' },
    );
    if (!confirmado) return;

    setLoading(true);
    try {
      const payload: CpagPayloadEfetuar = {
        calculo: {
          detalhes: {
            funcionario: { id: selectedUser.value, nome: selectedUser.label },
            ciclo: { nome: motivo },
            tipoPagamento: 'BONUS',
          },
          proventos: {
            salarioProporcional: 0,
            comissao: 0,
            valeTransporte: 0,
            beneficios: valorNumerico,
          },
          descontos: { valeTransporte: 0 },
          totais: { totalLiquidoAPagar: valorNumerico },
        },
        id_conta_debito: selectedConta.value,
      };
      await fetchCpag<CpagRespostaEfetuar>('/api/pagamentos/efetuar', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      mostrarToast('Bônus registrado com sucesso!', 'sucesso');
      setValor('');
      setMotivo('');
    } catch (error) {
      mostrarToast(error instanceof Error ? error.message : 'Erro ao conceder bônus.', 'erro');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="cpg-bonus-container">
        <div className="cpg-money-card">
          <h3 style={{ color: '#7f8c8d', fontSize: '1rem', fontWeight: '500' }}>Valor do Bônus</h3>
          <div className="cpg-money-display">
            <div className="cpg-money-input-wrapper">
              <span style={{ fontSize: '1.5rem', color: '#aaa', fontWeight: '600' }}>R$</span>
              <input
                type="number"
                className="cpg-money-input"
                placeholder="0.00"
                value={valor}
                onChange={(event) => setValor(event.target.value)}
              />
            </div>
          </div>
          <div className="cpg-money-shortcuts">
            {[10, 50, 100, 200, 500].map((valorAtalho) => (
              <button
                type="button"
                key={valorAtalho}
                className="cpg-btn-shortcut plus"
                onClick={() => ajustarValor(valorAtalho)}
              >
                +{valorAtalho}
              </button>
            ))}
            <button type="button" className="cpg-btn-shortcut minus" onClick={() => setValor('')}>
              Limpar
            </button>
          </div>
        </div>
        <div className="cpg-card" style={{ border: '1px solid #e9ecef', boxShadow: 'none' }}>
          <h3
            className="cpg-section-title"
            style={{ border: 'none', paddingBottom: 0, marginBottom: 15 }}
          >
            Detalhes
          </h3>
          <div className="cpg-form-group">
            <label htmlFor="cpag-bonus-usuario">Empregado*</label>
            <Select
              inputId="cpag-bonus-usuario"
              options={userOptions}
              value={selectedUser}
              onChange={setSelectedUser}
              placeholder="Buscar..."
              styles={selectStyles}
            />
          </div>
          <div className="cpg-form-group">
            <label htmlFor="cpag-bonus-motivo">Motivo*</label>
            <textarea
              id="cpag-bonus-motivo"
              className="cpg-input"
              rows={2}
              placeholder="Ex: Premiação por meta extra"
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              style={{ resize: 'none' }}
            />
          </div>
          <div className="cpg-form-group">
            <label htmlFor="cpag-bonus-conta">Conta de Débito*</label>
            <Select
              inputId="cpag-bonus-conta"
              options={contaOptions}
              value={selectedConta}
              onChange={setSelectedConta}
              placeholder="Selecione..."
              components={{ NoOptionsMessage }}
              styles={selectStyles}
            />
          </div>
          <button
            type="button"
            className="cpg-btn cpg-btn-primario"
            style={{ width: '100%', marginTop: '15px', height: '50px', fontSize: '1.1rem' }}
            onClick={() => void handleConcederBonus()}
            disabled={loading}
          >
            {loading ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-check" />}
            {loading ? ' Processando...' : ' Confirmar Bônus'}
          </button>
        </div>
      </div>
    </div>
  );
}
