import { useEffect, useMemo, useState } from 'react';
import Select, { type StylesConfig } from 'react-select';
import { formatarMoeda } from '../utils/cpag-format';
import { mostrarConfirmacao, mostrarToast } from '../utils/cpag-feedback';
import { fetchCpag } from '../utils/cpag-api';
import type { CpagContaFinanceira, CpagUsuario } from '../utils/cpag-types';

interface Props { usuarios: CpagUsuario[]; contas: CpagContaFinanceira[]; }
interface SelectOption { value: number | string; label: string; }
interface HistoricoSalario { usuario_id: number | string; ciclo_nome?: string; descricao?: string; }
interface FolhaItem { id: number | string; nome: string; base: number; inss: number; vt: number; liquidoFinal: string; selecionado: boolean; pago: boolean; }
interface PagamentoResponse { error?: string; }

const selectStyles: StylesConfig<SelectOption, false> = { control: (base) => ({ ...base, borderColor: '#ced4da', borderRadius: '6px' }) };

function gerarReferencias(): SelectOption[] {
  const opcoes: SelectOption[] = [];
  const cursor = new Date(new Date().getFullYear(), new Date().getMonth() + 2, 1);
  for (let i = 0; i < 15; i += 1) {
    const mes = cursor.toLocaleString('pt-BR', { month: 'long' });
    const label = `${mes.charAt(0).toUpperCase()}${mes.slice(1)}/${cursor.getFullYear()}`;
    opcoes.push({ value: label, label });
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return opcoes;
}

function referenciaPadrao(): SelectOption {
  const data = new Date(); data.setMonth(data.getMonth() - 1);
  const mes = data.toLocaleString('pt-BR', { month: 'long' });
  const label = `${mes.charAt(0).toUpperCase()}${mes.slice(1)}/${data.getFullYear()}`;
  return { value: label, label };
}

export default function CPAGSalario({ usuarios, contas }: Props) {
  const [selectedConta, setSelectedConta] = useState<SelectOption | null>(null);
  const [selectedReferencia, setSelectedReferencia] = useState<SelectOption>(referenciaPadrao);
  const [historicoSalarios, setHistoricoSalarios] = useState<HistoricoSalario[]>([]);
  const [folha, setFolha] = useState<FolhaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const opcoesReferencia = useMemo(gerarReferencias, []);
  const contaOptions = useMemo<SelectOption[]>(() => contas.map((conta) => ({ value: conta.id, label: conta.nome_conta })), [contas]);

  useEffect(() => {
    let ativo = true;
    const carregarHistorico = async () => {
      try {
        const data = await fetchCpag<HistoricoSalario[]>('/api/pagamentos/historico');
        if (ativo) setHistoricoSalarios(Array.isArray(data) ? data.filter((item) => Boolean(item.ciclo_nome?.includes(String(selectedReferencia.value)) && item.descricao?.includes('Salário') || item.descricao?.includes(`Salário ${selectedReferencia.value}`))) : []);
      } catch (error) { console.error('Erro ao buscar histórico de salários', error); }
    };
    void carregarHistorico();
    return () => { ativo = false; };
  }, [selectedReferencia]);

  useEffect(() => {
    setFolha(usuarios.map((usuario) => {
      const base = Number(usuario.salario_fixo) || 0;
      const pINSS = Number(usuario.desconto_inss_percentual) || 0;
      const pVT = Number(usuario.desconto_vt_percentual) || 0;
      const inss = base * (pINSS / 100); const vt = base * (pVT / 100); const liquido = base - inss - vt;
      const pago = historicoSalarios.some((item) => item.usuario_id === usuario.id);
      return { id: usuario.id, nome: usuario.nome, base, inss, vt, liquidoFinal: liquido.toFixed(2), selecionado: !pago, pago };
    }));
  }, [usuarios, historicoSalarios]);

  const selecionados = folha.filter((item) => item.selecionado);
  const totalPagar = selecionados.reduce((total, item) => total + (Number.parseFloat(item.liquidoFinal) || 0), 0);
  const alterarItem = (id: number | string, alterar: (item: FolhaItem) => FolhaItem) => setFolha((atual) => atual.map((item) => item.id === id ? alterar(item) : item));

  const handleProcessarFolha = async () => {
    if (!selectedConta) { mostrarToast('Selecione a conta de débito.', 'aviso'); return; }
    if (!selecionados.length) { mostrarToast('Selecione pelo menos um empregado.', 'aviso'); return; }
    const confirmado = await mostrarConfirmacao(`Confirma o pagamento da folha para <strong>${selecionados.length} empregados</strong>?<br><br>Total: <strong>${formatarMoeda(totalPagar)}</strong><br>Ref: ${selectedReferencia.label}`, { tipo: 'aviso', textoConfirmar: 'Confirmar Folha' });
    if (!confirmado) return;
    setLoading(true);
    try {
      await Promise.all(selecionados.map(async (item) => {
        const valorFinal = Number.parseFloat(item.liquidoFinal) || 0;
        await fetchCpag<PagamentoResponse>('/api/pagamentos/efetuar', { method: 'POST', body: JSON.stringify({ calculo: { detalhes: { funcionario: { id: item.id, nome: item.nome }, ciclo: { nome: `Salário ${selectedReferencia.value}` }, tipoPagamento: 'SALARIO' }, proventos: { salarioProporcional: item.base, comissao: 0, valeTransporte: 0, beneficios: 0 }, descontos: { inss: item.inss, valeTransporte: item.vt }, totais: { totalLiquidoAPagar: valorFinal } }, id_conta_debito: selectedConta.value }) });
      }));
      mostrarToast('Folha de pagamento processada com sucesso!', 'sucesso');
      setFolha((atual) => atual.map((item) => item.selecionado ? { ...item, selecionado: false, pago: true } : item));
    } catch (error) { console.error(error); mostrarToast(error instanceof Error ? error.message : 'Erro ao processar alguns pagamentos. Verifique o console.', 'erro'); }
    finally { setLoading(false); }
  };

  const todosSelecionaveis = folha.filter((item) => !item.pago);
  const todosMarcados = todosSelecionaveis.length > 0 && selecionados.length === todosSelecionaveis.length;

  return <div className="cpg-card"><h2 className="cpg-section-title">Folha de Pagamento Mensal</h2>
    <div className="cpg-form-row" style={{ alignItems: 'flex-end' }}><div className="cpg-form-group" style={{ minWidth: '200px' }}><label>Referência</label><Select options={opcoesReferencia} value={selectedReferencia} onChange={(value) => value && setSelectedReferencia(value)} placeholder="Selecione..." styles={selectStyles} /></div><div className="cpg-form-group"><label>Conta de Saída</label><Select options={contaOptions} value={selectedConta} onChange={setSelectedConta} placeholder="Selecione..." /></div><div className="cpg-form-group"><div style={{ background: '#f8f9fa', padding: '10px', borderRadius: '6px', textAlign: 'right' }}><small>Total Selecionado</small><div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--cpg-cor-despesa)' }}>{formatarMoeda(totalPagar)}</div></div></div></div>
    <div className="cpg-tabela-container" style={{ marginTop: '20px' }}><table className="cpg-tabela-detalhes"><thead><tr><th style={{ textAlign: 'center', width: '40px' }}><input type="checkbox" onChange={(event) => setFolha((atual) => atual.map((item) => item.pago ? item : { ...item, selecionado: event.target.checked }))} checked={todosMarcados} /></th><th>Empregado</th><th>Salário Base</th><th>(-) INSS</th><th>(-) VT</th><th>Líquido (Editável)</th><th>Status</th></tr></thead><tbody>{folha.map((item) => <tr key={item.id} style={{ opacity: item.pago ? 0.5 : 1, background: item.selecionado ? '#f0f8ff' : 'transparent' }}><td><input type="checkbox" checked={item.selecionado} disabled={item.pago} onChange={() => alterarItem(item.id, (atual) => ({ ...atual, selecionado: !atual.selecionado }))} /></td><td>{item.nome}</td><td>{formatarMoeda(item.base)}</td><td style={{ color: '#e74c3c' }}>{formatarMoeda(item.inss)}</td><td style={{ color: '#e74c3c' }}>{formatarMoeda(item.vt)}</td><td><input type="number" step="0.01" className="cpg-input" style={{ width: '100px', textAlign: 'right', padding: '5px', fontWeight: 'bold' }} value={item.liquidoFinal} disabled={item.pago} onChange={(event) => alterarItem(item.id, (atual) => ({ ...atual, liquidoFinal: event.target.value }))} /></td><td>{item.pago ? <span style={{ color: 'green', fontWeight: 'bold' }}>PAGO</span> : '-'}</td></tr>)}</tbody></table></div>
    <button type="button" className="cpg-btn cpg-btn-primario" style={{ width: '100%', marginTop: '20px', height: '50px', fontSize: '1.1rem' }} onClick={() => void handleProcessarFolha()} disabled={loading || !selecionados.length}>{loading ? 'Processando...' : `Confirmar Pagamento (${selecionados.length})`}</button>
  </div>;
}
