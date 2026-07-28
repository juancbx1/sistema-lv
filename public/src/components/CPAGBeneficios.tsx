import { useEffect, useMemo, useState } from 'react';
import Select from 'react-select';
import { formatarMoeda } from '../utils/cpag-format';
import { mostrarConfirmacao, mostrarToast } from '../utils/cpag-feedback';
import { fetchCpag } from '../utils/cpag-api';
import type { CpagContaFinanceira, CpagUsuario } from '../utils/cpag-types';

interface Props { usuarios: CpagUsuario[]; contas: CpagContaFinanceira[]; }
interface Option { value: number | string; label: string; }
interface Historico { usuario_id: number | string; descricao?: string; ciclo_nome?: string; }
interface FolhaItem { id: number | string; nome: string; valor: string; selecionado: boolean; pago: boolean; }

function referencias(): Option[] {
  const result: Option[] = []; const cursor = new Date(new Date().getFullYear(), new Date().getMonth() + 2, 1);
  for (let i = 0; i < 15; i += 1) { const mes = cursor.toLocaleString('pt-BR', { month: 'long' }); const label = `${mes.charAt(0).toUpperCase()}${mes.slice(1)}/${cursor.getFullYear()}`; result.push({ value: label, label }); cursor.setMonth(cursor.getMonth() - 1); }
  return result;
}

function referenciaInicial(): Option { const data = new Date(); data.setMonth(data.getMonth() + 1); const mes = data.toLocaleString('pt-BR', { month: 'long' }); const label = `${mes.charAt(0).toUpperCase()}${mes.slice(1)}/${data.getFullYear()}`; return { value: label, label }; }

export default function CPAGBeneficios({ usuarios, contas }: Props) {
  const [selectedConta, setSelectedConta] = useState<Option | null>(null);
  const [selectedReferencia, setSelectedReferencia] = useState<Option>(referenciaInicial);
  const [valorPadrao, setValorPadrao] = useState('200.00');
  const [folha, setFolha] = useState<FolhaItem[]>([]);
  const [historicoBeneficios, setHistoricoBeneficios] = useState<Historico[]>([]);
  const [loading, setLoading] = useState(false);
  const opcoesReferencia = useMemo(referencias, []);
  const contaOptions = useMemo<Option[]>(() => contas.map((conta) => ({ value: conta.id, label: conta.nome_conta })), [contas]);

  useEffect(() => { let ativo = true; const carregar = async () => { try { const data = await fetchCpag<Historico[]>('/api/pagamentos/historico'); const ref = String(selectedReferencia.value); const pagos = (Array.isArray(data) ? data : []).filter((item) => { const desc = item.descricao?.toLowerCase() ?? ''; const beneficio = desc.includes('va ') || desc.includes('vale alimentação') || desc.includes('benefício'); return Boolean((item.descricao?.includes(ref) && beneficio) || item.ciclo_nome?.includes(ref)); }); if (ativo) setHistoricoBeneficios(pagos); } catch (error) { console.error(error); } }; void carregar(); return () => { ativo = false; }; }, [selectedReferencia]);
  useEffect(() => { setFolha(usuarios.map((usuario) => { const pago = historicoBeneficios.some((item) => item.usuario_id === usuario.id); return { id: usuario.id, nome: usuario.nome, valor: valorPadrao, selecionado: !pago, pago }; })); }, [usuarios, historicoBeneficios]);

  const selecionados = folha.filter((item) => item.selecionado);
  const alterarItem = (id: number | string, alterar: (item: FolhaItem) => FolhaItem) => setFolha((atual) => atual.map((item) => item.id === id ? alterar(item) : item));
  const aplicarValorPadrao = () => setFolha((atual) => atual.map((item) => item.pago ? item : { ...item, valor: valorPadrao }));

  const handleProcessar = async () => {
    if (!selectedConta) { mostrarToast('Selecione a conta.', 'aviso'); return; }
    if (!selecionados.length) { mostrarToast('Selecione alguém.', 'aviso'); return; }
    const total = selecionados.reduce((soma, item) => soma + (Number.parseFloat(item.valor) || 0), 0);
    if (!await mostrarConfirmacao(`Pagar VA para <strong>${selecionados.length} pessoas</strong>?<br>Total: <strong>${formatarMoeda(total)}</strong>`, { tipo: 'aviso', textoConfirmar: 'Confirmar' })) return;
    setLoading(true);
    try { await Promise.all(selecionados.map((item) => fetchCpag('/api/pagamentos/efetuar', { method: 'POST', body: JSON.stringify({ calculo: { detalhes: { funcionario: { id: item.id, nome: item.nome }, ciclo: { nome: `VA ${selectedReferencia.value}` }, tipoPagamento: 'BENEFICIOS' }, proventos: { beneficios: Number.parseFloat(item.valor) || 0, salarioProporcional: 0, comissao: 0, valeTransporte: 0 }, totais: { totalLiquidoAPagar: Number.parseFloat(item.valor) || 0 } }, id_conta_debito: selectedConta.value }) }))); mostrarToast('Vale Alimentação pago com sucesso!', 'sucesso'); setFolha((atual) => atual.map((item) => item.selecionado ? { ...item, selecionado: false, pago: true } : item)); } catch (error) { mostrarToast(error instanceof Error ? error.message : 'Erro ao processar.', 'erro'); } finally { setLoading(false); }
  };

  return <div className="cpg-card"><h2 className="cpg-section-title">Vale Alimentação (VA)</h2><div className="cpg-form-row" style={{ alignItems: 'flex-end' }}><div className="cpg-form-group" style={{ minWidth: '200px' }}><label>Referência</label><Select options={opcoesReferencia} value={selectedReferencia} onChange={(value) => value && setSelectedReferencia(value)} placeholder="Selecione..." /></div><div className="cpg-form-group"><label>Valor Padrão (R$)</label><div style={{ display: 'flex', gap: '10px' }}><input type="number" className="cpg-input" value={valorPadrao} onChange={(event) => setValorPadrao(event.target.value)} /><button type="button" className="cpg-btn cpg-btn-secundario" onClick={aplicarValorPadrao} title="Aplicar a todos"><i className="fas fa-sync-alt" /></button></div></div><div className="cpg-form-group"><label>Conta Saída</label><Select options={contaOptions} value={selectedConta} onChange={setSelectedConta} placeholder="Selecione..." /></div></div>
    <div className="cpg-tabela-container" style={{ marginTop: '20px' }}><table className="cpg-tabela-detalhes"><thead><tr><th><input type="checkbox" onChange={(event) => setFolha((atual) => atual.map((item) => item.pago ? item : { ...item, selecionado: event.target.checked }))} /></th><th>Empregado</th><th>Valor (R$)</th><th>Status</th></tr></thead><tbody>{folha.map((item) => <tr key={item.id} style={{ opacity: item.pago ? 0.5 : 1, background: item.selecionado ? '#f0f8ff' : 'transparent' }}><td><input type="checkbox" checked={item.selecionado} disabled={item.pago} onChange={() => alterarItem(item.id, (atual) => ({ ...atual, selecionado: !atual.selecionado }))} /></td><td>{item.nome}</td><td><input type="number" className="cpg-input" style={{ width: '100px', textAlign: 'right' }} value={item.valor} disabled={item.pago} onChange={(event) => alterarItem(item.id, (atual) => ({ ...atual, valor: event.target.value }))} /></td><td>{item.pago ? <span style={{ color: 'green', fontWeight: 'bold' }}>PAGO</span> : '-'}</td></tr>)}</tbody></table></div><button type="button" className="cpg-btn cpg-btn-primario" style={{ width: '100%', marginTop: '20px', height: '50px' }} onClick={() => void handleProcessar()} disabled={loading || !selecionados.length}>{loading ? 'Processando...' : 'Pagar Selecionados'}</button>
  </div>;
}
