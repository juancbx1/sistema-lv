import { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatarMoeda } from '../utils/cpag-format';
import { mostrarToast } from '../utils/cpag-feedback';
import { fetchCpag } from '../utils/cpag-api';
import type { CpagLoteVT } from '../utils/cpag-types';
import CPAGPaginacao from './CPAGPaginacao';

interface Props { isOpen: boolean; onClose: () => void; }
interface UsuarioLogado { nome?: string; }
interface PdfDocument extends jsPDF { lastAutoTable?: { finalY: number }; }

export default function CPAGGerenciadorRecibosVT({ isOpen, onClose }: Props) {
  const [lotes, setLotes] = useState<CpagLoteVT[]>([]);
  const [loading, setLoading] = useState(false);
  const [nomeAdmin, setNomeAdmin] = useState('Administrador');
  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 10;

  const carregarDados = async () => {
    setLoading(true);
    try {
      const [lotesData, usuario] = await Promise.all([
        fetchCpag<CpagLoteVT[]>('/api/pagamentos/lotes-vt-agrupados'),
        fetchCpag<UsuarioLogado>('/api/usuarios/me'),
      ]);
      setLotes(Array.isArray(lotesData) ? lotesData : []);
      if (usuario?.nome) setNomeAdmin(usuario.nome);
    } catch (error) {
      console.error(error);
      mostrarToast(error instanceof Error ? error.message : 'Erro ao carregar dados.', 'erro');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (isOpen) { setPaginaAtual(1); void carregarDados(); }
  }, [isOpen]);

  const totalPaginas = Math.ceil(lotes.length / itensPorPagina);
  const lotesVisiveis = useMemo(() => lotes.slice((paginaAtual - 1) * itensPorPagina, paginaAtual * itensPorPagina), [lotes, paginaAtual]);

  const gerarPDFLote = async (lote: CpagLoteVT) => {
    try {
      await fetchCpag('/api/pagamentos/marcar-lote-impresso', { method: 'POST', body: JSON.stringify({ ids: lote.itens.map((item) => item.id) }) });
      setLotes((atual) => atual.map((item) => item.data_pagamento === lote.data_pagamento && item.descricao === lote.descricao ? { ...item, ja_impresso: true } : item));
      const doc = new jsPDF() as PdfDocument;

      lote.itens.forEach((item, index) => {
        if (index > 0) doc.addPage();
        let detalhes: { datas_pagas?: string[] } = {};
        try { detalhes = typeof item.detalhes === 'string' ? JSON.parse(item.detalhes) : item.detalhes ?? {}; } catch { detalhes = {}; }
        const datasPagas = detalhes.datas_pagas ?? [];
        const valorTotal = Number(item.valor) || 0;
        const valorDiario = datasPagas.length ? valorTotal / datasPagas.length : 0;
        doc.setFontSize(16); doc.text('RECIBO DE VALE TRANSPORTE', 105, 20, { align: 'center' });
        doc.setFontSize(10); doc.text(`Data do Pagamento: ${new Date(lote.data_pagamento).toLocaleDateString('pt-BR')}`, 14, 30); doc.text(`Empregado: ${item.nome_funcionario}`, 14, 36);
        autoTable(doc, { startY: 45, head: [['Referente ao Dia', 'Valor Repassado']], body: datasPagas.map((data) => [new Date(data).toLocaleDateString('pt-BR', { timeZone: 'UTC' }), formatarMoeda(valorDiario)]), theme: 'grid', foot: [['TOTAL RECEBIDO', formatarMoeda(valorTotal)]], headStyles: { fillColor: [41, 128, 185], halign: 'center' }, footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'right' }, styles: { cellPadding: 4, fontSize: 10 } });
        const finalY = (doc.lastAutoTable?.finalY ?? 45) + 40;
        doc.line(60, finalY, 150, finalY); doc.text(item.nome_funcionario, 105, finalY + 5, { align: 'center' }); doc.text('Assinatura do Empregado', 105, finalY + 10, { align: 'center' });
        doc.setFontSize(7); doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')} por ${nomeAdmin}`, 14, doc.internal.pageSize.height - 10); doc.setFontSize(10);
      });
      const dataNome = new Date(lote.data_pagamento).toLocaleDateString('pt-BR').replace(/\//g, '-');
      doc.save(`Recibos_VT_Lote_${dataNome}.pdf`);
      mostrarToast('Recibos gerados e lote marcado como impresso!', 'sucesso');
    } catch (error) { console.error(error); mostrarToast(error instanceof Error ? error.message : 'Erro ao gerar PDF.', 'erro'); }
  };

  if (!isOpen) return null;
  return <div className="cpg-modal-overlay"><div className="cpg-modal-content" style={{ maxWidth: '900px' }}>
    <div className="cpg-modal-header"><h2>Gerenciador de Recibos de VT</h2><button type="button" className="cpg-modal-close-btn" onClick={onClose} aria-label="Fechar">×</button></div>
    <div className="cpg-modal-body">{loading ? <div className="cpg-spinner">Carregando...</div> : lotes.length === 0 ? <p>Nenhum lote encontrado.</p> : <table className="cpg-tabela-detalhes"><thead><tr><th>Data Lote</th><th>Descrição</th><th>Qtd. Emp.</th><th>Total</th><th>Status</th><th>Ação</th></tr></thead><tbody>{lotesVisiveis.map((lote) => <tr key={`${lote.data_pagamento}-${lote.descricao}`}><td>{new Date(lote.data_pagamento).toLocaleDateString('pt-BR')}</td><td>{lote.descricao}</td><td>{lote.qtd_funcionarios}</td><td>{formatarMoeda(lote.valor_total)}</td><td>{lote.ja_impresso ? 'Impresso' : 'Pendente'}</td><td><button type="button" className="cpg-btn cpg-btn-secundario" onClick={() => void gerarPDFLote(lote)}><i className="fas fa-print" /> PDF</button></td></tr>)}</tbody></table>}<CPAGPaginacao paginaAtual={paginaAtual} totalPaginas={totalPaginas} onPageChange={setPaginaAtual} /></div>
  </div></div>;
}
