// public/src/components/OPExternoTela.tsx
// Aba de lançamento externo que reutiliza o modal canônico de produção.

import { useCallback, useState } from 'react';
// @ts-expect-error popups JS legado sem declaracao TypeScript
import { mostrarMensagem, mostrarConfirmacao } from '/js/utils/popups.js';
import OPAtribuicaoModal from './OPAtribuicaoModal.jsx';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UIBloqueio from './UIBloqueio';

type OpTelaExterna = 'tipo' | 'historico';
type OpFreelanceTipo = 'costureira' | 'tiktik';

interface OpHistoricoExterno {
  id: number;
  produto_nome: string;
  variacao?: string | null;
  processo: string;
  quantidade: number | string;
  freelance_tipos?: string[];
  data: string;
  lancado_por?: string | null;
  freelance_nome?: string | null;
}

function fmtHora(iso?: string | null) {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDataHora(iso?: string | null) {
  if (!iso) return '';
  const dataHora = new Date(iso);
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const data = dataHora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  if (data === hoje) return `hoje ${fmtHora(iso)}`;
  return `${data} ${fmtHora(iso)}`;
}

function mensagemDoErro(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function OPExternoTela() {
  const [tela, setTela] = useState<OpTelaExterna>('tipo');
  const [freelanceTipo, setFreelanceTipo] = useState<OpFreelanceTipo | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [historico, setHistorico] = useState<OpHistoricoExterno[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [desfazendoId, setDesfazendoId] = useState<number | null>(null);

  const carregarHistorico = useCallback(async () => {
    setCarregandoHistorico(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/producoes/externos-recentes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const dados = (await res.json()) as unknown;
        setHistorico(Array.isArray(dados) ? (dados as OpHistoricoExterno[]) : []);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setCarregandoHistorico(false);
    }
  }, []);

  const handleVerHistorico = () => {
    setTela('historico');
    void carregarHistorico();
  };

  const handleDesfazer = async (item: OpHistoricoExterno) => {
    const confirmado = await mostrarConfirmacao(
      `Desfazer lançamento de ${item.quantidade}x ${item.produto_nome} — ${item.processo} (${item.freelance_nome})?`,
      'aviso',
    );
    if (!confirmado) return;

    setDesfazendoId(item.id);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/producoes/externo/${item.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errorData = (await res.json()) as { error?: string };
        throw new Error(errorData.error || 'Erro ao desfazer.');
      }
      mostrarMensagem('Lançamento desfeito com sucesso.', 'sucesso');
      void carregarHistorico();
    } catch (error) {
      mostrarMensagem(mensagemDoErro(error, 'Erro ao desfazer.'), 'erro');
    } finally {
      setDesfazendoId(null);
    }
  };

  const fakeFuncionario = freelanceTipo
    ? {
        id: null,
        nome: `Freelance ${freelanceTipo === 'costureira' ? 'Costureira' : 'TikTik'}`,
        tipos: [freelanceTipo],
      }
    : null;

  const handleTipoSelect = (tipo: OpFreelanceTipo) => {
    setFreelanceTipo(tipo);
    setModalAberto(true);
  };

  const handleFecharModal = () => {
    setModalAberto(false);
    setFreelanceTipo(null);
  };

  const handleConfirmarExterno = async (payloadItens: Array<Record<string, unknown>>) => {
    if (!freelanceTipo) throw new Error('Selecione o tipo do prestador externo.');

    const itens = payloadItens.map((item) => ({
      op_numero: item.opNumero,
      produto_id: item.produto_id,
      variante: item.variante === '-' ? null : item.variante || null,
      processo: item.processo,
      processo_id: item.processo_id ?? null,
      etapa_id: item.etapa_id ?? null,
      fase: item.fase || 'OP',
      quantidade: item.quantidade,
      ...(item.fase === 'POS_OP' && Array.isArray(item.origens_pos_op)
        ? { origens_pos_op: item.origens_pos_op }
        : {}),
      ...(Array.isArray(item.etapas_unificadas)
        ? { etapas_unificadas: item.etapas_unificadas }
        : {}),
    }));

    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/producoes/externo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ freelance_tipo: freelanceTipo, itens }),
      });
      if (!res.ok) {
        const errorData = (await res.json()) as { error?: string };
        throw new Error(errorData.error || 'Erro ao registrar produção externa.');
      }
      mostrarMensagem('Produção externa registrada com sucesso!', 'sucesso');
    } catch (error) {
      throw new Error(mensagemDoErro(error, 'Erro ao registrar produção externa.'));
    }
  };

  const handleVoltar = () => {
    if (tela === 'historico') return setTela('tipo');
    setTela('tipo');
  };

  const titulos: Record<OpTelaExterna, string> = {
    tipo: 'Lançamento Externo',
    historico: 'Histórico de Lançamentos',
  };

  return (
    <div className="op-aba-externo">
      <div className="gs-card op-externo-tela-wrapper">
        <div className="op-modal-header op-externo-tela-header">
        <div className="op-modal-header-esquerda">
          {tela !== 'tipo' && (
            <button className="btn-voltar-header" onClick={handleVoltar}>
              <i className="fas fa-arrow-left"></i> Voltar
            </button>
          )}
        </div>
        <div className="op-modal-header-centro">
          <h3 className="op-modal-titulo">{titulos[tela]}</h3>
          <div className="op-modal-header-info">
            <span className="op-externo-badge">
              <i className="fas fa-user-tie"></i> Prestador Externo
            </span>
            {freelanceTipo && tela !== 'historico' && (
              <span
                className={`op-modal-role-badge ${
                  freelanceTipo === 'costureira' ? 'badge-costureira' : 'badge-tiktik'
                }`}
              >
                <i className={`fas ${freelanceTipo === 'costureira' ? 'fa-tshirt' : 'fa-cut'}`}></i>
                {freelanceTipo === 'costureira' ? 'Costureira' : 'TikTik'}
              </span>
            )}
          </div>
        </div>
        <div className="op-modal-header-direita"></div>
        </div>

        {tela !== 'historico' && (
          <div
            className="op-modal-aviso-hora-extra"
            style={{ background: '#f0f9ff', borderLeftColor: '#0ea5e9', color: '#0c4a6e' }}
          >
            <i className="fas fa-info-circle"></i> Produção realizada por prestador externo — registrada com rastreabilidade completa
          </div>
        )}

        <div className="op-modal-body op-externo-tela-body">
        {tela === 'tipo' && (
          <div className="op-externo-tipo-wrapper">
            <div className="op-externo-tipo-grid">
              <button className="op-externo-tipo-card" onClick={() => handleTipoSelect('costureira')}>
                <i className="fas fa-tshirt op-externo-tipo-icone"></i>
                <span className="op-externo-tipo-label">Freelance Costureira</span>
              </button>
              <button className="op-externo-tipo-card" onClick={() => handleTipoSelect('tiktik')}>
                <i className="fas fa-cut op-externo-tipo-icone"></i>
                <span className="op-externo-tipo-label">Freelance TikTik</span>
              </button>
            </div>
            <button className="op-externo-ver-historico" onClick={handleVerHistorico}>
              <i className="fas fa-history"></i> Ver lançamentos recentes (desfazer)
            </button>
          </div>
        )}

        {tela === 'historico' && (
          <div className="op-externo-historico">
            {carregandoHistorico ? (
              <div className="spinner" style={{ margin: '40px auto' }}>Carregando...</div>
            ) : historico.length === 0 ? (
              <UIFeedbackNotFound
                variante="compacto"
                icon="fa-inbox"
                titulo="Nenhum lançamento externo recente"
                mensagem="Não há lançamentos externos nas últimas 24 horas."
              />
            ) : (
              <div className="op-externo-historico-lista">
                {historico.map((item) => {
                  const tipoCostureira = item.freelance_tipos?.includes('costureira');
                  const tipoLabel = tipoCostureira ? 'Costureira' : 'TikTik';
                  const tipoClasse = tipoCostureira ? 'badge-costureira' : 'badge-tiktik';
                  const tipoIcone = tipoCostureira ? 'fa-tshirt' : 'fa-cut';
                  return (
                    <div key={item.id} className="op-externo-historico-item">
                      <div className="card-borda-charme" aria-hidden="true"></div>
                      <div className="op-externo-historico-info">
                        <span className="op-externo-historico-produto">{item.produto_nome}</span>
                        {item.variacao && <span className="op-externo-historico-variante">{item.variacao}</span>}
                        <span className="op-externo-historico-processo">{item.processo}</span>
                        <div className="op-externo-historico-meta">
                          <span className="op-externo-historico-qtd">
                            <i className="fas fa-layer-group"></i> {item.quantidade} pçs
                          </span>
                          <span
                            className={`op-modal-role-badge ${tipoClasse}`}
                            style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                          >
                            <i className={`fas ${tipoIcone}`}></i> {tipoLabel}
                          </span>
                          <span className="op-externo-historico-hora">
                            <i className="fas fa-clock"></i> {fmtDataHora(item.data)}
                          </span>
                          <span className="op-externo-historico-lancador">por {item.lancado_por}</span>
                        </div>
                      </div>
                      <UIBloqueio permissao="desfazer-lancamento-p-externo">
                        <button
                          className="op-externo-historico-btn-desfazer"
                          onClick={() => void handleDesfazer(item)}
                          disabled={desfazendoId === item.id}
                          title="Desfazer este lançamento"
                        >
                          {desfazendoId === item.id ? (
                            <div className="spinner-btn-interno"></div>
                          ) : (
                            <>
                              <i className="fas fa-undo"></i> Desfazer
                            </>
                          )}
                        </button>
                      </UIBloqueio>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        </div>
      </div>
      {modalAberto && fakeFuncionario && (
        <OPAtribuicaoModal
          funcionario={fakeFuncionario}
          isOpen={modalAberto}
          onClose={handleFecharModal}
          tpp={undefined}
          onConfirmarLote={handleConfirmarExterno}
          fasesPermitidas={freelanceTipo === 'costureira' ? ['OP'] : ['POS_OP']}
        />
      )}
    </div>
  );
}
