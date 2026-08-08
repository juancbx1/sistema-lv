// public/src/components/OPTelaSelecaoEtapa.tsx

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
// @ts-expect-error utilitario JS legado sem declaracao TypeScript
import { obterProdutos as obterProdutosDoStorage } from '/js/utils/storage.js';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UICarregando from './UICarregando';
import OPPaginacaoWrapper from './OPPaginacaoWrapper.tsx';
import UIBuscaInteligente, { filtrarListaInteligente } from './UIBuscaInteligente';
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio';

type OpTipoFuncionario = 'costureira' | 'tiktik';

interface OpEtapaUnificada {
  processo: string;
  etapa_index?: number;
  maquina?: string | null;
}

interface OpGrupoUnificacao {
  grupo_id: string;
  etapas: OpEtapaUnificada[];
}

interface OpTarefa extends Record<string, unknown> {
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

interface OpSugestao extends OpTarefa {
  motivos?: string[];
  sessoesHistorico?: number;
}

interface OpEtapaConfiguracao {
  processo?: string;
  feitoPor?: string;
}

interface OpProdutoSelecao extends Record<string, unknown> {
  id: number;
  nome?: string;
  imagem?: string | null;
  grade?: Array<{ variacao?: string | null; imagem?: string | null }> | null;
  etapas?: Array<string | OpEtapaConfiguracao> | null;
}

interface OpFuncionarioSelecao {
  id: number | null;
  nome: string;
  tipos: string[];
}

interface OpTelaSelecaoEtapaProps {
  onEtapaSelect: (etapa: OpTarefa | OpTarefa[]) => void;
  funcionario?: OpFuncionarioSelecao | null;
}

interface OpGrupoInfo {
  grupo: OpGrupoUnificacao;
  idxNoGrupo: number;
}

interface OpEtapaCardProps {
  etapa: OpTarefa;
  onToggle: (etapa: OpTarefa) => void;
  stepLabel: string;
  isFinal: boolean;
  imagemUrl?: string | null;
  selecionado: boolean;
  grupoInfo: OpGrupoInfo | null;
  unificacaoAtiva: boolean;
  onToggleUnificacao: (grupoId: string) => void;
}

function OPEtapaCard({
  etapa,
  onToggle,
  stepLabel,
  isFinal,
  imagemUrl,
  selecionado,
  grupoInfo,
  unificacaoAtiva,
  onToggleUnificacao,
}: OpEtapaCardProps) {
  const bordaClasse = etapa.processo.toLowerCase() === 'corte'
    ? 'borda-corte'
    : isFinal
      ? 'borda-etapa-final'
      : 'borda-etapa-normal';

  const ops = etapa.origem_ops || [];
  const opsTexto = ops.length > 0
    ? `OP #${ops.slice(0, 3).join(' • #')}${ops.length > 3 ? ` +${ops.length - 3}` : ''}`
    : null;

  const ehPrimaria = grupoInfo?.idxNoGrupo === 0;
  const ehSecundaria = Boolean(grupoInfo && grupoInfo.idxNoGrupo > 0 && unificacaoAtiva);
  const outrasEtapas = ehPrimaria && grupoInfo
    ? grupoInfo.grupo.etapas.slice(1).map((item) => item.processo).join(' + ')
    : '';

  if (ehSecundaria) return null;

  const unificadoAtivo = ehPrimaria && unificacaoAtiva;

  return (
    <div
      className={`op-card-react ${bordaClasse} ${selecionado ? 'selecionado-lote' : ''} ${unificadoAtivo ? 'op-card-unificado' : ''}`}
      onClick={() => onToggle(etapa)}
      style={{
        cursor: 'pointer',
      }}
    >
      <div className="card-borda-charme" aria-hidden="true"></div>
      <div className="op-card-checkbox-wrapper">
        <div className={`op-card-checkbox ${selecionado ? 'marcado' : ''}`}></div>
      </div>

      <img
        src={imagemUrl || '/img/placeholder-image.png'}
        alt={etapa.produto_nome}
        className="card-imagem-produto"
      />

      <div className="card-info-principal">
        {unificadoAtivo ? (
          <span className="op-unif-ativo-label">
            <i className="fas fa-link"></i> Etapas Unificadas
          </span>
        ) : (
          <span className={`op-etapa-step-badge ${isFinal ? 'final' : 'normal'}`}>
            {stepLabel}
          </span>
        )}
        <h3>{etapa.produto_nome}</h3>
        {etapa.variante && <p>{etapa.variante}</p>}
        {unificadoAtivo && grupoInfo ? (
          <div className="op-unif-processos-linha">
            {grupoInfo.grupo.etapas.map((item, index) => (
              <Fragment key={item.processo}>
                <span className="op-processo-chip">{item.processo}</span>
                {index < grupoInfo.grupo.etapas.length - 1 && (
                  <i className="fas fa-arrow-right op-unif-seta"></i>
                )}
              </Fragment>
            ))}
          </div>
        ) : (
          <span className="op-processo-chip">{etapa.processo}</span>
        )}
      </div>

      <div className="card-bloco-pendente">
        <span className="label">DISPONÍVEL</span>
        <span className="valor">{etapa.quantidade_disponivel}</span>
      </div>

      {ehPrimaria && !unificacaoAtiva && grupoInfo && (
        <div className="op-etapa-unificavel-badge">
          <i className="fas fa-link"></i>
          <span>Unificável com: {outrasEtapas}</span>
          <button
            className="op-unificacao-toggle"
            onClick={(event) => {
              event.stopPropagation();
              onToggleUnificacao(grupoInfo.grupo.grupo_id);
            }}
          >
            Unificar
          </button>
        </div>
      )}

      {unificadoAtivo && grupoInfo && (
        <div className="op-etapa-unificavel-badge op-etapa-unificavel-badge--ativo">
          <i className="fas fa-check-circle"></i>
          <span>Ambas as etapas serão registradas juntas</span>
          <button
            className="op-unificacao-toggle op-unificacao-toggle--separar"
            onClick={(event) => {
              event.stopPropagation();
              onToggleUnificacao(grupoInfo.grupo.grupo_id);
            }}
          >
            <i className="fas fa-unlink"></i> Separar
          </button>
        </div>
      )}

      {opsTexto && (
        <div className="op-card-ops-footer">
          <i className="fas fa-link"></i> {opsTexto}
        </div>
      )}
    </div>
  );
}

function mensagemDoErro(error: unknown) {
  return error instanceof Error ? error.message : 'Erro ao carregar tarefas.';
}

export default function OPTelaSelecaoEtapa({
  onEtapaSelect,
  funcionario,
}: OpTelaSelecaoEtapaProps) {
  const [filaDeTarefas, setFilaDeTarefas] = useState<OpTarefa[]>([]);
  const [todosProdutos, setTodosProdutos] = useState<OpProdutoSelecao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [termoFiltro, setTermoFiltro] = useState('');
  const [selecionados, setSelecionados] = useState<OpTarefa[]>([]);
  const [sugestao, setSugestao] = useState<OpSugestao | null>(null);
  const [gruposUnificaveis, setGruposUnificaveis] = useState<Record<string, OpGrupoUnificacao[]>>({});
  const [unificacoesAtivas, setUnificacoesAtivas] = useState<Set<string>>(new Set());
  const candidatosKeyRef = useRef('');
  const ITENS_POR_PAGINA = 6;

  const tipoFuncionario: OpTipoFuncionario | null = funcionario?.tipos?.includes('costureira')
    ? 'costureira'
    : funcionario?.tipos?.includes('tiktik')
      ? 'tiktik'
      : null;

  useEffect(() => {
    async function buscarDados() {
      setCarregando(true);
      try {
        const token = localStorage.getItem('token');
        const [dataFilaRaw, dataProdutosRaw] = await Promise.all([
          fetch('/api/producao/fila-de-tarefas', {
            headers: { Authorization: `Bearer ${token}` },
          }).then((res) => res.json()),
          obterProdutosDoStorage(),
        ]);

        setFilaDeTarefas(Array.isArray(dataFilaRaw) ? (dataFilaRaw as OpTarefa[]) : []);
        setTodosProdutos(Array.isArray(dataProdutosRaw) ? (dataProdutosRaw as OpProdutoSelecao[]) : []);
      } catch (error) {
        console.error('[DEBUG ATRIBUIR] Erro:', error);
        setErro(mensagemDoErro(error));
      } finally {
        setCarregando(false);
      }
    }

    void buscarDados();
  }, []);

  const tarefasFiltradasParaFuncionario = useMemo(() => {
    if (!funcionario?.tipos || todosProdutos.length === 0) return [];

    return filaDeTarefas.filter((tarefa) => {
      const produto = todosProdutos.find((item) => item.id === tarefa.produto_id);
      if (!produto?.etapas) return false;

      const etapaConfig = produto.etapas.find((item) => {
        const processo = typeof item === 'string' ? item : item.processo;
        return processo === tarefa.processo;
      });
      if (!etapaConfig || typeof etapaConfig === 'string') return false;
      return Boolean(etapaConfig.feitoPor && funcionario.tipos.includes(etapaConfig.feitoPor));
    });
  }, [filaDeTarefas, todosProdutos, funcionario]);

  useEffect(() => {
    if (!tipoFuncionario || tarefasFiltradasParaFuncionario.length === 0) {
      setGruposUnificaveis({});
      candidatosKeyRef.current = '';
      return;
    }

    const candidatos = [...new Set(
      tarefasFiltradasParaFuncionario.map((tarefa) => `${tarefa.produto_id}__${tarefa.variante || ''}`),
    )].sort();
    const candidatosKey = `${tipoFuncionario}:${candidatos.join(',')}`;
    if (candidatosKey === candidatosKeyRef.current) return;
    candidatosKeyRef.current = candidatosKey;

    if (candidatos.length === 0) {
      setGruposUnificaveis({});
      return;
    }

    const token = localStorage.getItem('token');
    void Promise.all(
      candidatos.map(async (pvKey): Promise<[string, OpGrupoUnificacao[]]> => {
        const sepIdx = pvKey.indexOf('__');
        const produtoId = pvKey.substring(0, sepIdx);
        const variante = pvKey.substring(sepIdx + 2);
        const params = new URLSearchParams({ produto_id: produtoId, tipo_funcionario: tipoFuncionario });
        if (variante) params.append('variante', variante);

        const res = await fetch(`/api/producao/grupos-unificaveis?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const gruposRaw = res.ok ? await res.json() : [];
        const grupos = Array.isArray(gruposRaw) ? (gruposRaw as OpGrupoUnificacao[]) : [];
        const gruposRemapeados = grupos
          .filter((grupo) => grupo.etapas.length >= 2)
          .map((grupo) => ({ ...grupo, grupo_id: `${pvKey}::${grupo.grupo_id}` }));
        return [pvKey, gruposRemapeados];
      }),
    )
      .then((results) => {
        const mapa: Record<string, OpGrupoUnificacao[]> = {};
        results.forEach(([key, grupos]) => {
          if (grupos.length > 0) mapa[key] = grupos;
        });
        setGruposUnificaveis(mapa);
        setUnificacoesAtivas(new Set());
      })
      .catch(() => {
        // Falha no endpoint de unificacao nao impede a selecao individual.
      });
  }, [tarefasFiltradasParaFuncionario, tipoFuncionario, funcionario?.id]);

  const getGrupoInfo = useCallback((tarefa: OpTarefa): OpGrupoInfo | null => {
    const pvKey = `${tarefa.produto_id}__${tarefa.variante || ''}`;
    const grupos = gruposUnificaveis[pvKey] || [];
    for (const grupo of grupos) {
      const idxNoGrupo = grupo.etapas.findIndex((item) => item.processo === tarefa.processo);
      if (idxNoGrupo !== -1) return { grupo, idxNoGrupo };
    }
    return null;
  }, [gruposUnificaveis]);

  const handleToggleUnificacao = useCallback((grupoId: string) => {
    setUnificacoesAtivas((prev) => {
      const next = new Set(prev);
      if (next.has(grupoId)) next.delete(grupoId);
      else next.add(grupoId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!funcionario?.id || tarefasFiltradasParaFuncionario.length === 0) {
      setSugestao(null);
      return;
    }

    const token = localStorage.getItem('token');
    void fetch('/api/producao/sugestao-tarefa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ funcionario_id: funcionario.id, candidatas: tarefasFiltradasParaFuncionario }),
    })
      .then((response) => response.json())
      .then((data: { sugestao?: OpSugestao | null }) => setSugestao(data.sugestao || null))
      .catch(() => setSugestao(null));
  }, [tarefasFiltradasParaFuncionario, funcionario?.id]);

  const listaFinalFiltrada = useMemo(() => {
    return filtrarListaInteligente<OpTarefa>(
      tarefasFiltradasParaFuncionario,
      termoFiltro,
      ['produto_nome', 'variante', 'processo'],
    );
  }, [tarefasFiltradasParaFuncionario, termoFiltro]);

  const listaParaExibir = useMemo(() => {
    if (!sugestao || termoFiltro) return listaFinalFiltrada;
    const chaveSugestao = `${sugestao.produto_id}-${sugestao.variante}-${sugestao.processo}`;
    return listaFinalFiltrada.filter((tarefa) =>
      `${tarefa.produto_id}-${tarefa.variante}-${tarefa.processo}` !== chaveSugestao,
    );
  }, [listaFinalFiltrada, sugestao, termoFiltro]);

  const getEtapaInfo = (tarefa: OpTarefa) => {
    const produto = todosProdutos.find((item) => item.id === tarefa.produto_id);
    if (!produto?.etapas) return { label: 'Etapa ?', isFinal: false, imagemUrl: null as string | null };

    const index = produto.etapas.findIndex((item) => {
      const processo = typeof item === 'string' ? item : item.processo;
      return processo === tarefa.processo;
    });
    const isFinal = index === produto.etapas.length - 1;
    const label = isFinal ? 'Etapa Final' : `Etapa ${index + 1}`;
    let imagemUrl = produto.imagem || null;
    if (tarefa.variante && produto.grade) {
      const variacaoItem = produto.grade.find((item) => item.variacao === tarefa.variante);
      if (variacaoItem?.imagem) imagemUrl = variacaoItem.imagem;
    }
    return { label, isFinal, imagemUrl };
  };

  const handleToggleSelect = (etapa: OpTarefa) => {
    const grupoInfo = getGrupoInfo(etapa);
    const unificacaoAtiva = Boolean(grupoInfo && unificacoesAtivas.has(grupoInfo.grupo.grupo_id));
    const etapaParaSelecionar = grupoInfo && unificacaoAtiva && grupoInfo.idxNoGrupo === 0
      ? { ...etapa, _unificada: true, _grupo_unificacao: grupoInfo.grupo }
      : etapa;

    const etapaId = `${etapa.produto_id}-${etapa.variante}-${etapa.processo}`;
    setSelecionados((prev) => {
      const jaSelecionado = prev.find(
        (item) => `${item.produto_id}-${item.variante}-${item.processo}` === etapaId,
      );
      if (jaSelecionado) {
        return prev.filter(
          (item) => `${item.produto_id}-${item.variante}-${item.processo}` !== etapaId,
        );
      }
      if (prev.length >= 6) return prev;
      return [...prev, etapaParaSelecionar];
    });
  };

  const handleAvancarLote = () => {
    if (selecionados.length > 0) onEtapaSelect(selecionados);
  };

  const totalPaginas = Math.ceil(listaParaExibir.length / ITENS_POR_PAGINA);
  const tarefasPaginadas = listaParaExibir.slice(
    (pagina - 1) * ITENS_POR_PAGINA,
    pagina * ITENS_POR_PAGINA,
  );

  useEffect(() => {
    setPagina(1);
  }, [termoFiltro]);

  if (carregando) return <UICarregando variante="bloco" />;
  if (erro) return <p style={{ color: 'red', textAlign: 'center' }}>{erro}</p>;

  const totalDisponivel = tarefasFiltradasParaFuncionario.length;
  const totalFiltrado = listaFinalFiltrada.length;
  const textoMeta = termoFiltro
    ? `${totalFiltrado} resultado${totalFiltrado !== 1 ? 's' : ''} de ${totalDisponivel}`
    : `${totalDisponivel} tarefa${totalDisponivel !== 1 ? 's' : ''} disponível${totalDisponivel !== 1 ? 'is' : ''}`;
  const buscaTarefa = termoFiltro.trim();
  const qtdSelecionados = selecionados.length;
  const textoBotao = qtdSelecionados === 1 ? 'Atribuir 1 Tarefa' : `Atribuir ${qtdSelecionados} Tarefas`;
  const podeAtribuir = temPermissao('atribuir-tarefa');

  return (
    <div className="coluna-lista-produtos">
      {sugestao && !termoFiltro && (() => {
        const { label: sLabel, imagemUrl: sImg } = getEtapaInfo(sugestao);
        return (
          <div className="op-sugestao-destaque">
            <div className="op-sugestao-header">
              <i className="fas fa-magic"></i> Sugestão para {funcionario?.nome?.split(' ')[0]}
            </div>
            <div className="op-sugestao-corpo">
              <img
                src={sImg || '/img/placeholder-image.png'}
                alt={sugestao.produto_nome}
                className="op-sugestao-img"
              />
              <div className="op-sugestao-info">
                <span className="op-sugestao-produto">{sugestao.produto_nome}</span>
                {sugestao.variante && <span className="op-sugestao-variante">{sugestao.variante}</span>}
                <span className="op-sugestao-processo">{sugestao.processo}</span>
                <div className="op-sugestao-tags">
                  <span className="op-sugestao-tag etapa">{sLabel}</span>
                  {sugestao.motivos?.includes('especialista') && (
                    <span className="op-sugestao-tag especialista">
                      <i className="fas fa-star"></i> Especialista ({sugestao.sessoesHistorico} sess.)
                    </span>
                  )}
                  {sugestao.motivos?.includes('urgente') && (
                    <span className="op-sugestao-tag urgente">
                      <i className="fas fa-fire"></i> OP aguardando
                    </span>
                  )}
                </div>
              </div>
              {(() => {
                const chaveSug = `${sugestao.produto_id}-${sugestao.variante}-${sugestao.processo}`;
                const estaSelecionada = selecionados.some(
                  (item) => `${item.produto_id}-${item.variante}-${item.processo}` === chaveSug,
                );
                return (
                  <button
                    className={`op-sugestao-btn${estaSelecionada ? ' selecionado' : ''}`}
                    onClick={() => handleToggleSelect(sugestao)}
                  >
                    {estaSelecionada ? (
                      <><i className="fas fa-check-circle"></i> Selecionada</>
                    ) : (
                      <><i className="fas fa-check"></i> Selecionar</>
                    )}
                  </button>
                );
              })()}
            </div>
          </div>
        );
      })()}

      <div style={{ marginBottom: '6px' }}>
        <UIBuscaInteligente
          onSearch={setTermoFiltro}
          placeholder="Buscar por produto, variante ou processo..."
        />
      </div>

      <p className="op-busca-meta">{textoMeta}</p>

      <div className="op-cards-container-modal">
        {tarefasPaginadas.length > 0 ? (
          tarefasPaginadas.map((etapa) => {
            const { label, isFinal, imagemUrl } = getEtapaInfo(etapa);
            const etapaId = `${etapa.produto_id}-${etapa.variante}-${etapa.processo}`;
            const isSelected = selecionados.some(
              (item) => `${item.produto_id}-${item.variante}-${item.processo}` === etapaId,
            );
            const grupoInfo = getGrupoInfo(etapa);
            const unificacaoAtiva = Boolean(
              grupoInfo && unificacoesAtivas.has(grupoInfo.grupo.grupo_id),
            );

            return (
              <OPEtapaCard
                key={etapaId}
                etapa={etapa}
                stepLabel={label}
                isFinal={isFinal}
                imagemUrl={imagemUrl}
                selecionado={isSelected}
                onToggle={handleToggleSelect}
                grupoInfo={grupoInfo}
                unificacaoAtiva={unificacaoAtiva}
                onToggleUnificacao={handleToggleUnificacao}
              />
            );
          })
        ) : (
          <UIFeedbackNotFound
            icon="fa-clipboard-list"
            titulo={buscaTarefa
              ? 'Nenhuma tarefa encontrada'
              : sugestao
                ? 'Nenhuma outra tarefa'
                : 'Nenhuma tarefa disponível'}
            mensagem={buscaTarefa
              ? `Não encontramos tarefas para “${buscaTarefa}”. Tente outro produto, variante ou processo.`
              : sugestao
                ? 'A sugestão acima é a única tarefa disponível no momento.'
                : 'Não há tarefas compatíveis com este funcionário no momento.'}
          />
        )}
      </div>

      {totalPaginas > 1 && (
        <OPPaginacaoWrapper totalPages={totalPaginas} currentPage={pagina} onPageChange={setPagina} />
      )}

      {qtdSelecionados > 0 && (
        <button
          className={`op-selecao-fab${!podeAtribuir ? ' op-selecao-fab--bloqueado' : ''}`}
          onClick={() => {
            if (!podeAtribuir) {
              mostrarPopupSemPermissao('Você não tem permissão para atribuir tarefas de produção.');
              return;
            }
            handleAvancarLote();
          }}
        >
          <span className="op-selecao-fab-badge">
            {podeAtribuir ? qtdSelecionados : <i className="fas fa-lock" style={{ fontSize: '0.7rem' }}></i>}
          </span>
          {textoBotao}
          <i className={`fas ${podeAtribuir ? 'fa-arrow-right' : 'fa-lock'}`}></i>
        </button>
      )}
    </div>
  );
}
