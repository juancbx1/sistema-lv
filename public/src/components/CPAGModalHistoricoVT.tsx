import { useEffect, useMemo, useState } from 'react';
import { mostrarConfirmacao, mostrarToast } from '../utils/cpag-feedback';
import { formatarMoeda } from '../utils/cpag-format';
import { fetchCpag } from '../utils/cpag-api';
import type { CpagHistoricoVT } from '../utils/cpag-types';
import CPAGPaginacao from './CPAGPaginacao';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UICarregando from './UICarregando';

interface Props { isOpen: boolean; onClose: () => void; usuarioId: number | string | null; }

export default function CPAGModalHistoricoVT({ isOpen, onClose, usuarioId }: Props) {
  const [historico, setHistorico] = useState<CpagHistoricoVT[]>([]);
  const [loading, setLoading] = useState(false);
  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 10;

  const carregarHistorico = async () => {
    if (!usuarioId) return;
    setLoading(true);
    try {
      const data = await fetchCpag<CpagHistoricoVT[]>(`/api/pagamentos/historico-vt?usuario_id=${encodeURIComponent(String(usuarioId))}`);
      setHistorico(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      mostrarToast(error instanceof Error ? error.message : 'Erro ao carregar histórico.', 'erro');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (isOpen) { setPaginaAtual(1); void carregarHistorico(); }
  }, [isOpen, usuarioId]);

  const totalPaginas = Math.ceil(historico.length / itensPorPagina);
  const itensVisiveis = useMemo(() => historico.slice((paginaAtual - 1) * itensPorPagina, paginaAtual * itensPorPagina), [historico, paginaAtual]);

  const handleEstornar = async (recargaId: number | string) => {
    const confirmado = await mostrarConfirmacao('Tem certeza que deseja estornar esta recarga? Os dias pagos serão liberados novamente.', { tipo: 'perigo', textoConfirmar: 'Sim, Estornar' });
    if (!confirmado) return;
    try {
      await fetchCpag('/api/pagamentos/estornar-vt', { method: 'POST', body: JSON.stringify({ recarga_id: recargaId }) });
      mostrarToast('Recarga estornada com sucesso!', 'sucesso');
      await carregarHistorico();
    } catch (error) { mostrarToast(error instanceof Error ? error.message : 'Erro ao estornar recarga.', 'erro'); }
  };

  if (!isOpen) return null;
  return (
    <div className="cpg-modal-overlay">
      <div className="cpg-modal-content" style={{ maxWidth: '700px' }}>
        <div className="cpg-modal-header"><h2>Histórico de Recargas</h2><button type="button" className="cpg-modal-close-btn" onClick={onClose} aria-label="Fechar">×</button></div>
        <div className="cpg-modal-body">
          {loading ? <UICarregando variante="bloco" tamanho="sm" texto="Carregando histórico..." /> : historico.length === 0 ? (
            <UIFeedbackNotFound
              variante="compacto"
              icon="fa-bus"
              titulo="Nenhuma recarga encontrada"
              mensagem="O histórico de recargas aparecerá aqui."
            />
          ) : (
            <table className="cpg-tabela-detalhes"><thead><tr><th>Data Pgto</th><th>Descrição</th><th>Valor</th><th>Ação</th></tr></thead>
              <tbody>{itensVisiveis.map((item) => <tr key={item.id} style={{ opacity: item.estornado_em ? 0.5 : 1 }}>
                <td>{new Date(item.data_pagamento).toLocaleDateString('pt-BR')}</td><td>{item.descricao}{item.estornado_em && <div style={{ color: 'red', fontSize: '0.8em' }}>Estornado em {new Date(item.estornado_em).toLocaleDateString('pt-BR')}</div>}</td><td>{formatarMoeda(item.valor_liquido_pago)}</td>
                <td>{!item.estornado_em && <button type="button" className="cpg-btn cpg-btn-aviso" onClick={() => void handleEstornar(item.id)}>Estornar</button>}</td>
              </tr>)}</tbody>
            </table>
          )}
          <CPAGPaginacao paginaAtual={paginaAtual} totalPaginas={totalPaginas} onPageChange={setPaginaAtual} />
        </div>
      </div>
    </div>
  );
}
