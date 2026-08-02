import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { fetchFinanceiro } from '../utils/financeiro-api';
import type { FinanceiroCategoria, FinanceiroConta } from '../utils/financeiro-types';
import { useFinanceiro } from './FinanceiroContext';
import UICarregando from './UICarregando';
import FinanceiroModalShell, { FinanceiroResumoOperacao } from './FinanceiroModalShell';
import UISearchableSelect, { type SearchableOption } from './UISearchableSelect.tsx';

const FORM_ID = 'financeiro-transferencia-form';
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function dataLocalHoje(): string {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function saldoDaConta(conta?: FinanceiroConta): number {
  return Number(conta?.saldo_atual ?? 0);
}

export default function FinanceiroTransferenciaModal() {
  const { transferenciaOpen, closeTransferenciaModal, refresh, config } = useFinanceiro();
  const [contas, setContas] = useState<FinanceiroConta[]>(config.contas);
  const [categorias, setCategorias] = useState<FinanceiroCategoria[]>(config.categorias);
  const [origemId, setOrigemId] = useState<string | number | null>(null);
  const [destinoId, setDestinoId] = useState<string | number | null>(null);
  const [valor, setValor] = useState('');
  const [dataTransacao, setDataTransacao] = useState(dataLocalHoje);
  const [descricao, setDescricao] = useState('');
  const [descricaoEditada, setDescricaoEditada] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!transferenciaOpen) return;
    let ativo = true;
    setOrigemId(null);
    setDestinoId(null);
    setValor('');
    setDataTransacao(dataLocalHoje());
    setDescricao('');
    setDescricaoEditada(false);
    setError(null);
    setLoading(true);
    void Promise.all([
      fetchFinanceiro<{ saldos: FinanceiroConta[] }>('/dashboard'),
      fetchFinanceiro<{ categorias: FinanceiroCategoria[] }>('/configuracoes'),
    ])
      .then(([dashboard, configuracoes]) => {
        if (!ativo) return;
        setContas(dashboard.saldos ?? []);
        setCategorias(configuracoes.categorias ?? []);
      })
      .catch((err) => {
        if (ativo) setError(err instanceof Error ? err.message : 'Não foi possível carregar as contas.');
      })
      .finally(() => {
        if (ativo) setLoading(false);
      });
    return () => {
      ativo = false;
    };
  }, [transferenciaOpen]);

  const contaOrigem = useMemo(
    () => contas.find((conta) => String(conta.id) === String(origemId ?? '')),
    [contas, origemId]
  );
  const contaDestino = useMemo(
    () => contas.find((conta) => String(conta.id) === String(destinoId ?? '')),
    [contas, destinoId]
  );
  const valorNumerico = Number(valor);
  const valorValido = Number.isFinite(valorNumerico) && valorNumerico > 0;
  const formularioValido = Boolean(
    origemId
    && destinoId
    && String(origemId) !== String(destinoId)
    && valorValido
    && dataTransacao
    && !loading
  );
  const accountOptions = useMemo<SearchableOption[]>(
    () => contas.map((conta) => ({
      value: conta.id,
      label: `${conta.nome_conta} · ${moeda.format(saldoDaConta(conta))}`,
    })),
    [contas],
  );
  const destinationOptions = useMemo(
    () => accountOptions.filter((option) => String(option.value) !== String(origemId ?? '')),
    [accountOptions, origemId],
  );

  useEffect(() => {
    if (descricaoEditada || !contaOrigem || !contaDestino) return;
    setDescricao(`Transferência ${contaOrigem.nome_conta} → ${contaDestino.nome_conta}`);
  }, [descricaoEditada, contaOrigem, contaDestino]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const categoria = categorias.find((item) => item.nome.toLowerCase().includes('transfer'));
    if (!categoria) {
      setError('A categoria de transferência entre contas não foi encontrada nas configurações desta empresa.');
      return;
    }
    if (!formularioValido) {
      setError('Preencha origem, destino, valor e data para continuar.');
      return;
    }

    setSaving(true);
    try {
      await fetchFinanceiro('/transferencias', {
        method: 'POST',
        body: JSON.stringify({
          id_conta_origem: origemId,
          id_conta_destino: destinoId,
          valor: valorNumerico,
          data_transacao: dataTransacao,
          descricao: descricao.trim(),
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

  if (!transferenciaOpen) return null;

  return (
    <FinanceiroModalShell
      titulo="Transferir entre contas"
      descricao="Movimente saldo entre duas contas da empresa ativa."
      icone="fa-right-left"
      onClose={closeTransferenciaModal}
      formId={FORM_ID}
      textoAcao="Transferir agora"
      textoProcessando="Transferindo..."
      processando={saving}
      acaoDesabilitada={!formularioValido}
      erro={error}
      tamanho="lg"
    >
      {loading ? (
        <UICarregando variante="bloco" tamanho="md" texto="Carregando contas da empresa..." />
      ) : (
        <form id={FORM_ID} className="fc-transfer-form" onSubmit={(event) => void save(event)}>
          <section className="fc-modal-section">
            <div className="fc-composer-structures fc-transfer-kinds">
              <button type="button" className="active">
                <i className="fas fa-building-columns" aria-hidden="true" />
                <span><strong>Entre minhas contas</strong><small>Disponível agora</small></span>
              </button>
              <button type="button" disabled>
                <i className="fas fa-lock" aria-hidden="true" />
                <span><strong>Entre empresas</strong><small>Em breve</small></span>
              </button>
            </div>
            <div className="fc-modal-section__title">
              <span>1</span>
              <div>
                <h3>Defina o caminho do dinheiro</h3>
                <p>As duas contas são validadas na empresa ativa.</p>
              </div>
            </div>

            <div className="fc-transfer-route">
              <label className="fc-transfer-account">
                <span className="fc-transfer-account__label">Conta de origem</span>
                <UISearchableSelect
                  options={accountOptions}
                  placeholder="Buscar conta que envia..."
                  initialValue={origemId}
                  onChange={(proximaOrigem) => {
                    setOrigemId(proximaOrigem);
                    if (String(proximaOrigem) === String(destinoId)) setDestinoId(null);
                    setDescricaoEditada(false);
                  }}
                />
                <small>
                  Saldo disponível
                  <strong>{contaOrigem ? moeda.format(saldoDaConta(contaOrigem)) : '—'}</strong>
                </small>
              </label>

              <span className="fc-transfer-route__arrow" aria-hidden="true">
                <i className="fas fa-arrow-right" />
              </span>

              <label className="fc-transfer-account">
                <span className="fc-transfer-account__label">Conta de destino</span>
                <UISearchableSelect
                  options={destinationOptions}
                  placeholder={origemId ? 'Buscar conta que recebe...' : 'Escolha primeiro a origem'}
                  initialValue={destinoId}
                  onChange={(proximoDestino) => {
                    setDestinoId(proximoDestino);
                    setDescricaoEditada(false);
                  }}
                />
                <small>
                  Saldo atual
                  <strong>{contaDestino ? moeda.format(saldoDaConta(contaDestino)) : '—'}</strong>
                </small>
              </label>
            </div>
          </section>

          <section className="fc-modal-section">
            <div className="fc-modal-section__title">
              <span>2</span>
              <div>
                <h3>Informe os dados da movimentação</h3>
                <p>O saldo das contas será atualizado na data informada.</p>
              </div>
            </div>

            <div className="fc-transfer-details">
              <label className="fc-form-group">
                <span>Valor da transferência</span>
                <div className="fc-money-input">
                  <span>R$</span>
                  <input
                    className="fc-input"
                    value={valor}
                    onChange={(event) => setValor(event.target.value)}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    placeholder="0,00"
                    required
                  />
                </div>
              </label>
              <label className="fc-form-group">
                <span>Data da transferência</span>
                <input
                  className="fc-input"
                  value={dataTransacao}
                  onChange={(event) => setDataTransacao(event.target.value)}
                  type="date"
                  required
                />
              </label>
            </div>
            <label className="fc-form-group">
              <span>Descrição <small>(opcional)</small></span>
              <textarea
                className="fc-input"
                value={descricao}
                onChange={(event) => {
                  setDescricao(event.target.value);
                  setDescricaoEditada(true);
                }}
                rows={2}
                maxLength={240}
                placeholder="Ex.: Reforço de saldo para pagamentos da semana"
              />
            </label>
          </section>

          <FinanceiroResumoOperacao>
            <div className="fc-transfer-summary__route">
              <span>{contaOrigem?.nome_conta || 'Conta de origem'}</span>
              <i className="fas fa-arrow-right" aria-hidden="true" />
              <span>{contaDestino?.nome_conta || 'Conta de destino'}</span>
            </div>
            <strong className="fc-transfer-summary__amount">
              {valorValido ? moeda.format(valorNumerico) : moeda.format(0)}
            </strong>
            {formularioValido && contaOrigem && contaDestino && (
              <div className="fc-transfer-summary__balances">
                <span>
                  Origem após a operação
                  <strong>{moeda.format(saldoDaConta(contaOrigem) - valorNumerico)}</strong>
                </span>
                <span>
                  Destino após a operação
                  <strong>{moeda.format(saldoDaConta(contaDestino) + valorNumerico)}</strong>
                </span>
              </div>
            )}
          </FinanceiroResumoOperacao>
        </form>
      )}
    </FinanceiroModalShell>
  );
}
