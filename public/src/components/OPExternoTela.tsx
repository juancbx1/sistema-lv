// public/src/components/OPExternoTela.tsx
// Versao inline (aba) do OPLancamentoExterno - sem modal/overlay

import { Fragment, type ComponentType, useCallback, useState } from 'react';
// @ts-expect-error popups JS legado sem declaracao TypeScript
import { mostrarMensagem, mostrarConfirmacao } from '/js/utils/popups.js';
import OPTelaSelecaoEtapa from './OPTelaSelecaoEtapa.tsx';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio';
import UIBloqueio from './UIBloqueio';

type OpTelaExterna = 'tipo' | 'selecao' | 'confirmacao' | 'historico';
type OpFreelanceTipo = 'costureira' | 'tiktik';

interface OpEtapaUnificada {
  processo: string;
  etapa_index?: number;
  maquina?: string | null;
}

interface OpGrupoUnificacao {
  grupo_id: string;
  etapas: OpEtapaUnificada[];
}

interface OpEtapaExterna {
  produto_id: number;
  variante?: string | null;
  processo: string;
  quantidade_disponivel: number | string;
  produto_nome: string;
  imagem_produto?: string | null;
  origem_ops?: Array<number | string>;
  _unificada?: boolean;
  _grupo_unificacao?: OpGrupoUnificacao;
}

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

interface OpFuncionarioExterno {
  id: null;
  nome: string;
  tipos: OpFreelanceTipo[];
}

interface OpTelaSelecaoEtapaProps {
  onEtapaSelect: (etapa: OpEtapaExterna | OpEtapaExterna[]) => void;
  funcionario: OpFuncionarioExterno;
}

const OPTelaSelecaoEtapaTipado = OPTelaSelecaoEtapa as unknown as ComponentType<OpTelaSelecaoEtapaProps>;

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
  const [itensSelecionados, setItensSelecionados] = useState<OpEtapaExterna[]>([]);
  const [quantidades, setQuantidades] = useState<Record<string, number | string>>({});
  const [carregando, setCarregando] = useState(false);
  const [historico, setHistorico] = useState<OpHistoricoExterno[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [desfazendoId, setDesfazendoId] = useState<number | null>(null);

  const resetar = () => {
    setTela('tipo');
    setFreelanceTipo(null);
    setItensSelecionados([]);
    setQuantidades({});
  };

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

  const fakeFuncionario: OpFuncionarioExterno | null = freelanceTipo
    ? {
        id: null,
        nome: `Freelance ${freelanceTipo === 'costureira' ? 'Costureira' : 'TikTik'}`,
        tipos: [freelanceTipo],
      }
    : null;

  const handleTipoSelect = (tipo: OpFreelanceTipo) => {
    setFreelanceTipo(tipo);
    setTela('selecao');
  };

  const handleEtapaSelect = (etapa: OpEtapaExterna | OpEtapaExterna[]) => {
    const itens = Array.isArray(etapa) ? etapa : [etapa];
    const quantidadesIniciais: Record<string, number | string> = {};
    itens.forEach((item) => {
      quantidadesIniciais[`${item.produto_id}-${item.variante}-${item.processo}`] = item.quantidade_disponivel;
    });
    setItensSelecionados(itens);
    setQuantidades(quantidadesIniciais);
    setTela('confirmacao');
  };

  const ajustarQtd = (key: string, delta: number, max: number | string) => {
    setQuantidades((prev) => ({
      ...prev,
      [key]: Math.max(0, Math.min(Number(max), (parseInt(String(prev[key]), 10) || 0) + delta)),
    }));
  };

  const podeConfirmar = temPermissao('confirmar-lancamento');

  const handleConfirmar = async () => {
    setCarregando(true);
    try {
      const token = localStorage.getItem('token');
      const itensPayload = itensSelecionados
        .map((item) => {
          const key = `${item.produto_id}-${item.variante}-${item.processo}`;
          const qtd = parseInt(String(quantidades[key]), 10) || 0;
          if (qtd <= 0) return null;
          return {
            op_numero: item.origem_ops?.[0],
            produto_id: item.produto_id,
            variante: item.variante || null,
            processo: item.processo,
            quantidade: qtd,
            ...(item._unificada && item._grupo_unificacao?.etapas
              ? { etapas_unificadas: item._grupo_unificacao.etapas }
              : {}),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      if (itensPayload.length === 0) throw new Error('Defina pelo menos uma quantidade válida.');

      const res = await fetch('/api/producoes/externo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ freelance_tipo: freelanceTipo, itens: itensPayload }),
      });
      if (!res.ok) {
        const errorData = (await res.json()) as { error?: string };
        throw new Error(errorData.error || 'Erro ao registrar produção externa.');
      }
      mostrarMensagem('Produção externa registrada com sucesso!', 'sucesso');
      resetar();
    } catch (error) {
      mostrarMensagem(mensagemDoErro(error, 'Erro ao registrar produção externa.'), 'erro');
    } finally {
      setCarregando(false);
    }
  };

  const handleVoltar = () => {
    if (tela === 'confirmacao') return setTela('selecao');
    if (tela === 'selecao') return setTela('tipo');
    if (tela === 'historico') return setTela('tipo');
    setTela('tipo');
  };

  const titulos: Record<OpTelaExterna, string> = {
    tipo: 'Lançamento Externo',
    selecao: 'Selecionar Tarefa',
    confirmacao: 'Confirmar Quantidade',
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

        {tela === 'selecao' && fakeFuncionario && (
          <OPTelaSelecaoEtapaTipado onEtapaSelect={handleEtapaSelect} funcionario={fakeFuncionario} />
        )}

        {tela === 'confirmacao' && (
          <div className="op-confirmacao-container">
            <div className="op-confirmacao-lista">
              {itensSelecionados.map((item) => {
                const key = `${item.produto_id}-${item.variante}-${item.processo}`;
                const qtd = quantidades[key] !== undefined ? quantidades[key] : item.quantidade_disponivel;
                return (
                  <div key={key} className="op-item-confirmacao-card borda-etapa-normal">
                    <div className="card-borda-charme" aria-hidden="true"></div>
                    <div className="item-info-visual">
                      <img
                        src={item.imagem_produto || '/img/placeholder-image.png'}
                        alt={item.produto_nome}
                      />
                      <div>
                        <h4>{item.produto_nome}</h4>
                        {item.variante && <p className="variante">{item.variante}</p>}
                        {item._unificada && item._grupo_unificacao?.etapas ? (
                          <div className="op-confirmacao-processos-unif">
                            {item._grupo_unificacao.etapas.map((etapa, index) => (
                              <Fragment key={etapa.processo}>
                                <span className="op-confirmacao-etapa-chip">{etapa.processo}</span>
                                {index < item._grupo_unificacao!.etapas.length - 1 && (
                                  <i className="fas fa-arrow-right op-confirmacao-unif-seta"></i>
                                )}
                              </Fragment>
                            ))}
                          </div>
                        ) : (
                          <p className="processo">{item.processo}</p>
                        )}
                        {item.origem_ops && item.origem_ops.length > 0 && (
                          <p className="op-confirmacao-op-link">
                            <i className="fas fa-link"></i>
                            {' OP #'}
                            {item.origem_ops.slice(0, 2).join(' • #')}
                            {item.origem_ops.length > 2 ? ` +${item.origem_ops.length - 2}` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="item-controles-qtd">
                      <div className="qtd-display-linha">
                        <button
                          className="btn-ajuste mini"
                          onClick={() => ajustarQtd(key, -1, item.quantidade_disponivel)}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          value={qtd}
                          onChange={(event) => {
                            const n = parseInt(event.target.value, 10);
                            if (
                              event.target.value === '' ||
                              (!Number.isNaN(n) && n >= 0 && n <= Number(item.quantidade_disponivel))
                            ) {
                              setQuantidades((prev) => ({
                                ...prev,
                                [key]: event.target.value === '' ? '' : n,
                              }));
                            }
                          }}
                        />
                        <button
                          className="btn-ajuste mini"
                          onClick={() => ajustarQtd(key, 1, item.quantidade_disponivel)}
                        >
                          +
                        </button>
                      </div>
                      <div className="qtd-atalhos-linha">
                        <button onClick={() => ajustarQtd(key, 10, item.quantidade_disponivel)}>+10</button>
                        <button
                          className="btn-max"
                          onClick={() =>
                            setQuantidades((prev) => ({
                              ...prev,
                              [key]: item.quantidade_disponivel,
                            }))
                          }
                        >
                          Max ({item.quantidade_disponivel})
                        </button>
                      </div>
                    </div>
                    {item._unificada && item._grupo_unificacao?.etapas && (
                      <div className="op-confirmacao-unif-detalhe">
                        <div className="op-confirmacao-unif-titulo">
                          <i className="fas fa-link"></i> {item._grupo_unificacao.etapas.length} etapas — registradas juntas
                        </div>
                        {item._grupo_unificacao.etapas.map((etapa, index) => {
                          const isLast = index === item._grupo_unificacao!.etapas.length - 1;
                          return (
                            <div key={etapa.processo} className="op-confirmacao-unif-item">
                              <span className="op-confirmacao-unif-step-label">
                                {isLast ? 'Etapa Final' : `Etapa ${etapa.etapa_index! + 1}`}
                              </span>
                              <span className="op-confirmacao-etapa-chip">{etapa.processo}</span>
                              {etapa.maquina && etapa.maquina !== 'Não Definida' && (
                                <span className="op-confirmacao-unif-maquina">
                                  <i className="fas fa-cog"></i> {etapa.maquina}
                                </span>
                              )}
                              <span className="op-confirmacao-unif-qtd-label">{parseInt(String(qtd), 10) || 0} pçs</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              className={`op-selecao-fab${!podeConfirmar ? ' op-selecao-fab--bloqueado' : ''}`}
              onClick={() => {
                if (!podeConfirmar) {
                  mostrarPopupSemPermissao('Você não tem permissão para confirmar lançamentos de produção.');
                  return;
                }
                void handleConfirmar();
              }}
              disabled={carregando}
            >
              {carregando ? (
                <>
                  <div className="spinner-btn-interno"></div> Registrando...
                </>
              ) : !podeConfirmar ? (
                <>
                  <i className="fas fa-lock"></i> Sem permissão
                </>
              ) : (
                <>
                  <i className="fas fa-check-double"></i> Confirmar Lançamento
                </>
              )}
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
    </div>
  );
}
