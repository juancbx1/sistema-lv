// public/src/components/OPTelaSelecaoEtapa.tsx

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
// @ts-expect-error utilitario JS legado sem declaracao TypeScript
import { obterProdutos as obterProdutosDoStorage } from '/js/utils/storage.js';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UICarregando from './UICarregando';
import OPPaginacaoWrapper from './OPPaginacaoWrapper.tsx';
import UIBuscaInteligente, { filtrarListaInteligente } from './UIBuscaInteligente';
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio';
import { etapaPermiteExecutor } from '../utils/etapas-produto';
import { obterChaveTarefa } from '../utils/op-tarefas';

type OpTipoFuncionario = 'costureira' | 'tiktik';
type OpFaseFiltro = 'TODAS' | 'OP' | 'POS_OP';

interface OpEtapaUnificada {
  processo: string;
  etapa_index?: number;
  etapa_id?: string | null;
  processo_id?: string | number | null;
  maquina?: string | null;
  feitoPor?: string[];
}

interface OpGrupoUnificacao {
  grupo_id: string;
  etapas: OpEtapaUnificada[];
  muda_maquina?: boolean;
}

export interface OpTarefa extends Record<string, unknown> {
  produto_id: number | string;
  variante?: string | null;
  processo: string;
  processo_id?: string | number | null;
  etapa_id?: string | null;
  fase?: string | null;
  quantidade_disponivel: number | string;
  produto_nome: string;
  imagem_produto?: string | null;
  origem_ops?: Array<number | string>;
  origens_pos_op?: Array<{
    op_numero?: number | string;
    quantidade?: number | string;
    quantidade_disponivel?: number | string;
  }>;
  feito_por?: string | string[];
  _unificada?: boolean;
  _grupo_unificacao?: OpGrupoUnificacao;
}

interface OpEtapaConfiguracao {
  id?: string | null;
  processo_id?: string | number | null;
  ordem?: number | null;
  maquina?: string | null;
  fase?: string | null;
  processo?: string;
  feitoPor?: string | string[];
}

interface OpProdutoSelecao extends Record<string, unknown> {
  id: number | string;
  nome?: string;
  imagem?: string | null;
  grade?: Array<{ variacao?: string | null; imagem?: string | null }> | null;
  etapas?: Array<string | OpEtapaConfiguracao> | null;
  etapasTiktik?: Array<string | OpEtapaConfiguracao> | null;
  etapastiktik?: Array<string | OpEtapaConfiguracao> | null;
  etapasCanonicas?: Array<string | OpEtapaConfiguracao> | null;
}

interface OpFuncionarioSelecao {
  id: number | null;
  nome: string;
  tipos: string[];
}

export interface OpTelaSelecaoEtapaProps {
  onEtapaSelect: (etapa: OpTarefa | OpTarefa[]) => void;
  funcionario?: OpFuncionarioSelecao | null;
  selecionadosIniciais?: OpTarefa | OpTarefa[] | null;
  onSelectionChange?: (etapas: OpTarefa[]) => void;
  fasesPermitidas?: Array<Exclude<OpFaseFiltro, 'TODAS'>>;
}

interface OpGrupoInfo {
  grupo: OpGrupoUnificacao;
  idxNoGrupo: number;
}

interface OpEtapaCardV4Props {
  etapa: OpTarefa;
  funcionarioNome?: string;
  onToggle: (etapa: OpTarefa) => void;
  stepLabel: string;
  isFinal: boolean;
  imagemUrl?: string | null;
  selecionado: boolean;
  grupoInfo: OpGrupoInfo | null;
  percursoAberto: boolean;
  totalPercurso: number;
  fluxoSelecionadoPendente: boolean;
  onTogglePercurso: (grupoId: string) => void;
  onDefinirFinalPercurso: (etapa: OpTarefa, grupo: OpGrupoUnificacao, totalEtapas: number) => void;
}

const ROTULOS_EXECUTORES: Record<string, string> = {
  costureira: 'Costureira',
  tiktik: 'TikTik',
  cortador: 'Cortador',
};

function obterTextoExecutores(etapa: OpTarefa): string {
  const executores = Array.isArray(etapa.feito_por)
    ? etapa.feito_por
    : etapa.feito_por ? [etapa.feito_por] : [];
  const nomes = executores
    .filter(Boolean)
    .map((tipo) => ROTULOS_EXECUTORES[tipo] || tipo);
  return nomes.length > 0 ? nomes.join(' / ') : 'Executor configurado';
}

function maquinaRepresentaUsoFisico(maquina?: string | null): boolean {
  const normalizada = String(maquina || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return normalizada !== '' && normalizada !== 'nao usa';
}

function percursoMudaMaquinaFisica(etapas: OpEtapaUnificada[]): boolean {
  return etapas.some((etapa, indice) => {
    if (indice === 0) return false;
    const anterior = etapas[indice - 1];
    if (!maquinaRepresentaUsoFisico(etapa.maquina) || !maquinaRepresentaUsoFisico(anterior.maquina)) {
      return false;
    }
    return String(etapa.maquina).trim() !== String(anterior.maquina).trim();
  });
}

function recortarGrupoPercurso(grupo: OpGrupoUnificacao, totalEtapas: number): OpGrupoUnificacao {
  const etapas = grupo.etapas.slice(0, totalEtapas);
  return {
    ...grupo,
    etapas,
    muda_maquina: percursoMudaMaquinaFisica(etapas),
  };
}

function agruparTarefasPosOp(tarefas: OpTarefa[]): OpTarefa[] {
  const grupos = new Map<string, OpTarefa>();
  const resultado: OpTarefa[] = [];

  tarefas.forEach((tarefa) => {
    if (tarefa.fase !== 'POS_OP') {
      resultado.push(tarefa);
      return;
    }

    const opNumero = tarefa.origem_ops?.[0];
    if (opNumero === undefined || opNumero === null || opNumero === '') {
      resultado.push(tarefa);
      return;
    }

    const variante = tarefa.variante == null ? '-' : String(tarefa.variante);
    const identidadeEtapa = tarefa.etapa_id
      ? `etapa:${tarefa.etapa_id}`
      : tarefa.processo_id
        ? `processo:${tarefa.processo_id}`
        : `nome:${tarefa.processo}`;
    const chave = ['POS_OP', tarefa.produto_id, variante, identidadeEtapa].join('|');
    const grupoExistente = grupos.get(chave);
    const quantidade = Number(tarefa.quantidade_disponivel) || 0;

    if (!grupoExistente) {
      const grupo: OpTarefa = {
        ...tarefa,
        quantidade_disponivel: quantidade,
        origem_ops: [opNumero],
        origens_pos_op: [{ op_numero: String(opNumero), quantidade_disponivel: quantidade }],
      };
      grupos.set(chave, grupo);
      resultado.push(grupo);
      return;
    }

    grupoExistente.quantidade_disponivel = Number(grupoExistente.quantidade_disponivel) + quantidade;
    grupoExistente.origem_ops = [...(grupoExistente.origem_ops || []), opNumero];
    grupoExistente.origens_pos_op = [
      ...(grupoExistente.origens_pos_op || []),
      { op_numero: String(opNumero), quantidade_disponivel: quantidade },
    ];
  });

  return resultado;
}

function OPEtapaCardV4({
  etapa,
  funcionarioNome,
  onToggle,
  stepLabel,
  isFinal,
  imagemUrl,
  selecionado,
  grupoInfo,
  percursoAberto,
  totalPercurso,
  fluxoSelecionadoPendente,
  onTogglePercurso,
  onDefinirFinalPercurso,
}: OpEtapaCardV4Props) {
  const ehPosOp = etapa.fase === 'POS_OP';
  const ops = etapa.origem_ops || [];
  const opsTexto = ops.length > 0
    ? `OP #${ops.slice(0, 3).join(' • #')}${ops.length > 3 ? ` +${ops.length - 3}` : ''}`
    : null;
  const variante = etapa.variante && etapa.variante !== '-' ? etapa.variante : 'Sem variação';
  const classeLegendaVariante = variante.length > 28
    ? ' op-task-card-v4__imagem-legenda--longa'
    : variante.length > 19 ? ' op-task-card-v4__imagem-legenda--media' : '';
  const executoresTexto = obterTextoExecutores(etapa);
  const classeEtapa = etapa.processo.toLowerCase() === 'corte'
    ? 'op-task-card-v4--corte'
    : isFinal ? 'op-task-card-v4--final' : '';
  const etapasPercurso = grupoInfo?.grupo.etapas || [];
  const percursoAtivo = totalPercurso >= 2;
  const nomeFinal = percursoAtivo
    ? etapasPercurso[totalPercurso - 1]?.processo
    : etapa.processo;

  return (
    <article
      className={`op-card-react op-task-card-v4 op-task-card-v4--${ehPosOp ? 'pos-op' : 'op'} ${classeEtapa} ${selecionado ? 'selecionado-lote' : ''} ${percursoAberto ? 'op-task-card-v4--percurso-aberto' : ''}`}
      data-fase={ehPosOp ? 'POS_OP' : 'OP'}
      aria-label={`${ehPosOp ? 'Arremate pós-OP' : 'Processo da OP'}: ${variante}, ${etapa.processo}`}
    >
      <div className="card-borda-charme" aria-hidden="true"></div>

      <div className="op-task-card-v4__grid">
        <div className="op-task-card-v4__imagem-wrap">
          <img
            src={imagemUrl || '/img/placeholder-image.png'}
            alt={`Variação ${variante}`}
            className="card-imagem-produto"
          />
          <span className={`op-task-card-v4__imagem-legenda${classeLegendaVariante}`} title={variante}>{variante}</span>
        </div>

        <div className="op-task-card-v4__conteudo">
          <div className="op-task-card-v4__identidade-etapa">
            <span className={`op-etapa-step-badge ${ehPosOp ? 'pos-op' : isFinal ? 'final' : 'normal'}`}>
              <i className={`fas ${ehPosOp ? 'fa-sparkles' : 'fa-list-ol'}`}></i>
              {ehPosOp ? 'Arremate pós-OP' : stepLabel}
            </span>
            <span className={`op-processo-chip ${ehPosOp ? 'op-processo-chip--pos-op' : ''}`}>
              {etapa.processo}
            </span>
          </div>

          <h3 className="op-task-card-v4__variante">{variante}</h3>

          <div className="op-task-card-v4__metadados">
            {opsTexto && <span><i className="fas fa-link"></i>{opsTexto}</span>}
            {ehPosOp && <span className="op-task-card-v4__op-finalizada"><i className="fas fa-circle-check"></i> OP encerrada</span>}
            <span><i className="fas fa-user-check"></i>{executoresTexto}</span>
          </div>

          <div className={`op-card-fluxo-efeito-v4 ${ehPosOp ? 'op-card-fluxo-efeito-v4--pos-op' : ''}`}>
            <span><i className="fas fa-route"></i> Efeito no fluxo</span>
            <strong>
              <i className={`fas ${ehPosOp ? 'fa-box-open' : percursoAtivo ? 'fa-code-branch' : 'fa-arrow-right'}`}></i>
              {ehPosOp
                ? 'Libera para embalagem'
                : percursoAtivo
                  ? `Executa até ${nomeFinal}`
                  : 'Continua dentro da OP'}
            </strong>
          </div>
        </div>

        <div className="op-task-card-v4__acoes">
          <div className="op-task-card-v4__saldo">
            <span>Disponível</span>
            <strong>{etapa.quantidade_disponivel}</strong>
            <small>peças</small>
          </div>

          {grupoInfo && (
            <button
              type="button"
              className={`op-task-card-v4__fluxo-btn ${percursoAtivo ? 'ativo' : ''}`}
              onClick={() => onTogglePercurso(grupoInfo.grupo.grupo_id)}
              aria-expanded={percursoAberto}
            >
              <i className={`fas ${percursoAberto ? 'fa-chevron-up' : 'fa-code-branch'}`}></i>
              {percursoAberto ? 'Recolher fluxo' : percursoAtivo ? 'Editar fluxo' : 'Definir fluxo'}
            </button>
          )}

          <button
            type="button"
            className={`op-task-card-v4__selecionar-btn ${selecionado ? 'ativo' : ''}${fluxoSelecionadoPendente ? ' op-task-card-v4__selecionar-btn--atencao' : ''}`}
            onClick={() => onToggle(etapa)}
            title={fluxoSelecionadoPendente
              ? 'Fluxo escolhido. Clique aqui para adicionar esta tarefa.'
              : undefined}
            aria-label={fluxoSelecionadoPendente
              ? 'Clique para selecionar a tarefa com o fluxo escolhido'
              : undefined}
          >
            <i className={`fas ${selecionado ? 'fa-check' : fluxoSelecionadoPendente ? 'fa-hand-pointer' : 'fa-plus'}`}></i>
            {selecionado ? 'Selecionada' : fluxoSelecionadoPendente ? 'Selecionar agora' : 'Selecionar'}
          </button>
        </div>
      </div>

      {grupoInfo && percursoAberto && (
        <div className="op-percurso-v4">
          <div className="op-percurso-v4__cabecalho">
            <div>
              <strong>Até onde {(funcionarioNome || 'o empregado').split(' ')[0]} fará esta quantidade?</strong>
              <span>A sequência é contínua e nenhuma etapa intermediária pode ser pulada.</span>
            </div>
            <span className="op-percurso-v4__autorizado"><i className="fas fa-shield-halved"></i> Percurso autorizado</span>
          </div>

          <div className="op-percurso-v4__linha" aria-label="Etapas possíveis do percurso">
            {etapasPercurso.map((item, indice) => (
              <Fragment key={item.etapa_id || item.processo_id || `${item.processo}-${indice}`}>
                <span className={`op-percurso-v4__etapa ${indice < totalPercurso ? 'incluida' : ''}`}>
                  <b>{(item.etapa_index ?? indice) + 1}</b>
                  <span>{item.processo}</span>
                </span>
                {indice < etapasPercurso.length - 1 && <i className="fas fa-arrow-right op-percurso-v4__seta"></i>}
              </Fragment>
            ))}
          </div>

          <div className="op-percurso-v4__opcoes" role="radiogroup" aria-label="Ponto final do percurso">
            {etapasPercurso.map((item, indice) => {
              const total = indice + 1;
              return (
                <label key={item.etapa_id || item.processo_id || `${item.processo}-opcao`} className={`op-percurso-v4__opcao ${totalPercurso === total ? 'ativa' : ''}`}>
                  <input
                    type="radio"
                    name={`percurso-${grupoInfo.grupo.grupo_id}`}
                    checked={totalPercurso === total}
                    onChange={() => onDefinirFinalPercurso(etapa, grupoInfo.grupo, total)}
                  />
                  <span>
                    <strong>{indice === 0 ? `Somente ${item.processo}` : `Até ${item.processo}`}</strong>
                    <small>{indice === etapasPercurso.length - 1
                      ? 'Conclui todo o percurso disponível.'
                      : `${etapasPercurso[indice + 1].processo} ficará disponível depois.`}</small>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="op-percurso-v4__resultado">
            <i className={`fas ${totalPercurso === etapasPercurso.length ? 'fa-check-double' : 'fa-code-branch'}`}></i>
            {totalPercurso === etapasPercurso.length
              ? 'Depois: todo o percurso disponível estará concluído.'
              : `Depois: ${etapasPercurso[totalPercurso]?.processo} ficará disponível para outro empregado autorizado.`}
          </div>
        </div>
      )}
    </article>
  );
}

function mensagemDoErro(error: unknown) {
  return error instanceof Error ? error.message : 'Erro ao carregar tarefas.';
}

function obterEtapasProduto(produto: OpProdutoSelecao): Array<string | OpEtapaConfiguracao> {
  if (Array.isArray(produto.etapasCanonicas) && produto.etapasCanonicas.length > 0) {
    return produto.etapasCanonicas;
  }
  return [
    ...(Array.isArray(produto.etapas) ? produto.etapas : []),
    ...(Array.isArray(produto.etapasTiktik)
      ? produto.etapasTiktik
      : Array.isArray(produto.etapastiktik) ? produto.etapastiktik : []),
  ];
}

export default function OPTelaSelecaoEtapa({
  onEtapaSelect,
  funcionario,
  selecionadosIniciais = null,
  onSelectionChange,
  fasesPermitidas,
}: OpTelaSelecaoEtapaProps) {
  const [filaDeTarefas, setFilaDeTarefas] = useState<OpTarefa[]>([]);
  const [todosProdutos, setTodosProdutos] = useState<OpProdutoSelecao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [faseFiltro, setFaseFiltro] = useState<OpFaseFiltro>('TODAS');
  const [termoFiltro, setTermoFiltro] = useState('');
  const [selecionados, setSelecionados] = useState<OpTarefa[]>(() => (
    Array.isArray(selecionadosIniciais)
      ? selecionadosIniciais
      : selecionadosIniciais ? [selecionadosIniciais] : []
  ));
  const [gruposUnificaveis, setGruposUnificaveis] = useState<Record<string, OpGrupoUnificacao[]>>({});
  const [percursosAbertos, setPercursosAbertos] = useState<Set<string>>(new Set());
  const [finaisPercurso, setFinaisPercurso] = useState<Record<string, number>>({});
  const candidatosKeyRef = useRef('');
  const ITENS_POR_PAGINA = 6;

  const tipoFuncionario: OpTipoFuncionario | null = funcionario?.tipos?.includes('costureira')
    ? 'costureira'
    : funcionario?.tipos?.includes('tiktik')
      ? 'tiktik'
      : null;

  useEffect(() => {
    setSelecionados(
      Array.isArray(selecionadosIniciais)
        ? selecionadosIniciais
        : selecionadosIniciais ? [selecionadosIniciais] : [],
    );
  }, [selecionadosIniciais]);

  useEffect(() => {
    async function buscarDados() {
      setCarregando(true);
      setErro(null);
      try {
        const token = localStorage.getItem('token');
        const [dataFilaRaw, dataProdutosRaw] = await Promise.all([
          fetch('/api/producao/fila-de-tarefas', {
            headers: { Authorization: `Bearer ${token}` },
          }).then(async (res) => {
            if (!res.ok) throw new Error(`Não foi possível carregar a fila (${res.status}).`);
            return res.json();
          }),
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
      const faseTarefa: Exclude<OpFaseFiltro, 'TODAS'> = tarefa.fase === 'POS_OP' ? 'POS_OP' : 'OP';
      if (fasesPermitidas && !fasesPermitidas.includes(faseTarefa)) return false;
      const produto = todosProdutos.find((item) => String(item.id) === String(tarefa.produto_id));
      const etapasProduto = produto ? obterEtapasProduto(produto) : [];
      if (etapasProduto.length === 0) return false;

      const etapaConfig = etapasProduto.find((item) => {
        if (typeof item === 'string') return item === tarefa.processo;
        if (tarefa.fase && item.fase && String(item.fase).toUpperCase() !== String(tarefa.fase).toUpperCase()) {
          return false;
        }
        if (tarefa.etapa_id && item.id) return String(item.id) === String(tarefa.etapa_id);
        if (tarefa.processo_id && item.processo_id) return String(item.processo_id) === String(tarefa.processo_id);
        return item.processo === tarefa.processo;
      });
      if (!etapaConfig || typeof etapaConfig === 'string') return false;
      return etapaPermiteExecutor(etapaConfig, funcionario.tipos);
    });
  }, [filaDeTarefas, todosProdutos, funcionario, fasesPermitidas]);

  useEffect(() => {
    if (!tipoFuncionario || tarefasFiltradasParaFuncionario.length === 0) {
      setGruposUnificaveis({});
      setPercursosAbertos(new Set());
      setFinaisPercurso({});
      candidatosKeyRef.current = '';
      return;
    }

    const candidatos = [...new Set(
      tarefasFiltradasParaFuncionario.map((tarefa) => `${tarefa.produto_id}__${tarefa.variante || ''}`),
    )].sort();
    const candidatosKey = `${tipoFuncionario}:${candidatos.join(',')}`;
    if (candidatosKey === candidatosKeyRef.current) return;
    candidatosKeyRef.current = candidatosKey;

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
        return [
          pvKey,
          grupos
            .filter((grupo) => Array.isArray(grupo.etapas) && grupo.etapas.length >= 2)
            .map((grupo) => ({ ...grupo, grupo_id: `${pvKey}::${grupo.grupo_id}` })),
        ];
      }),
    )
      .then((results) => {
        const mapa: Record<string, OpGrupoUnificacao[]> = {};
        results.forEach(([key, grupos]) => {
          if (grupos.length > 0) mapa[key] = grupos;
        });
        setGruposUnificaveis(mapa);
        setPercursosAbertos(new Set());
        setFinaisPercurso({});
      })
      .catch(() => {
        // A indisponibilidade do endpoint nao impede a selecao individual.
      });
  }, [tarefasFiltradasParaFuncionario, tipoFuncionario, funcionario?.id]);

  const getGrupoInfo = useCallback((tarefa: OpTarefa): OpGrupoInfo | null => {
    if (tarefa.fase === 'POS_OP') return null;
    const pvKey = `${tarefa.produto_id}__${tarefa.variante || ''}`;
    const grupos = gruposUnificaveis[pvKey] || [];
    return grupos.reduce<OpGrupoInfo | null>((encontrado, grupo) => {
      if (encontrado) return encontrado;
      const inicial = grupo.etapas[0];
      const corresponde = tarefa.etapa_id && inicial.etapa_id
        ? String(tarefa.etapa_id) === String(inicial.etapa_id)
        : tarefa.processo_id && inicial.processo_id
          ? String(tarefa.processo_id) === String(inicial.processo_id)
          : tarefa.processo === inicial.processo;
      return corresponde ? { grupo, idxNoGrupo: 0 } : null;
    }, null);
  }, [gruposUnificaveis]);

  const handleTogglePercurso = useCallback((grupoId: string) => {
    setPercursosAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(grupoId)) next.delete(grupoId);
      else next.add(grupoId);
      return next;
    });
  }, []);

  const handleDefinirFinalPercurso = useCallback((tarefa: OpTarefa, grupo: OpGrupoUnificacao, totalEtapas: number) => {
    setFinaisPercurso((prev) => ({ ...prev, [grupo.grupo_id]: totalEtapas }));
    const chave = obterChaveTarefa(tarefa);
    setSelecionados((prev) => prev.map((item) => {
      if (obterChaveTarefa(item) !== chave) return item;
      if (totalEtapas < 2) {
        const { _unificada: _removerUnificada, _grupo_unificacao: _removerGrupo, ...tarefaSimples } = item;
        return tarefaSimples;
      }
      return {
        ...item,
        _unificada: true,
        _grupo_unificacao: recortarGrupoPercurso(grupo, totalEtapas),
      };
    }));
  }, []);

  const listaFinalFiltrada = useMemo(() => filtrarListaInteligente(
    tarefasFiltradasParaFuncionario,
    termoFiltro,
    ['produto_nome', 'variante', 'processo'],
  ), [tarefasFiltradasParaFuncionario, termoFiltro]);

  const tarefasAgrupadas = useMemo(
    () => agruparTarefasPosOp(tarefasFiltradasParaFuncionario),
    [tarefasFiltradasParaFuncionario],
  );
  const listaFinalAgrupada = useMemo(
    () => agruparTarefasPosOp(listaFinalFiltrada),
    [listaFinalFiltrada],
  );
  const contagemFases = useMemo(() => ({
    OP: tarefasAgrupadas.filter((tarefa) => tarefa.fase !== 'POS_OP').length,
    POS_OP: tarefasAgrupadas.filter((tarefa) => tarefa.fase === 'POS_OP').length,
  }), [tarefasAgrupadas]);
  const listaFiltradaPorFase = useMemo(() => {
    if (faseFiltro === 'TODAS') return listaFinalAgrupada;
    return listaFinalAgrupada.filter((tarefa) => (
      faseFiltro === 'POS_OP' ? tarefa.fase === 'POS_OP' : tarefa.fase !== 'POS_OP'
    ));
  }, [faseFiltro, listaFinalAgrupada]);
  const listaParaExibir = useMemo(() => [...listaFiltradaPorFase].sort((a, b) => (
    (a.fase === 'POS_OP' ? 1 : 0) - (b.fase === 'POS_OP' ? 1 : 0)
  )), [listaFiltradaPorFase]);

  const getEtapaInfo = (tarefa: OpTarefa) => {
    const produto = todosProdutos.find((item) => String(item.id) === String(tarefa.produto_id));
    if (!produto) return { label: 'Etapa ?', isFinal: false, imagemUrl: null as string | null };

    let imagemUrl = produto.imagem || null;
    if (tarefa.variante && produto.grade) {
      const variacaoItem = produto.grade.find((item) => item.variacao === tarefa.variante);
      if (variacaoItem?.imagem) imagemUrl = variacaoItem.imagem;
    }
    if (tarefa.fase === 'POS_OP') return { label: 'Arremate pós-OP', isFinal: false, imagemUrl };

    const etapasOp = obterEtapasProduto(produto).filter((item) => (
      typeof item === 'string' || !item.fase || item.fase === 'OP'
    ));
    const index = etapasOp.findIndex((item) => {
      if (typeof item === 'string') return item === tarefa.processo;
      if (tarefa.etapa_id && item.id) return String(item.id) === String(tarefa.etapa_id);
      if (tarefa.processo_id && item.processo_id) return String(item.processo_id) === String(tarefa.processo_id);
      return item.processo === tarefa.processo;
    });
    const isFinal = index >= 0 && index === etapasOp.length - 1;
    return { label: isFinal ? 'Etapa Final' : `Etapa ${index + 1}`, isFinal, imagemUrl };
  };

  const handleToggleSelect = (etapa: OpTarefa) => {
    const grupoInfo = getGrupoInfo(etapa);
    const selecionadoAtual = selecionados.find((item) => obterChaveTarefa(item) === obterChaveTarefa(etapa));
    const totalPercurso = grupoInfo
      ? (finaisPercurso[grupoInfo.grupo.grupo_id]
        || selecionadoAtual?._grupo_unificacao?.etapas.length
        || 1)
      : 1;
    const etapaParaSelecionar = grupoInfo && totalPercurso >= 2
      ? {
        ...etapa,
        _unificada: true,
        _grupo_unificacao: recortarGrupoPercurso(grupoInfo.grupo, totalPercurso),
      }
      : etapa;
    const etapaId = obterChaveTarefa(etapa);

    const jaSelecionado = selecionados.some((item) => obterChaveTarefa(item) === etapaId);
    if (jaSelecionado) {
      const proximosSelecionados = selecionados.filter((item) => obterChaveTarefa(item) !== etapaId);
      setSelecionados(proximosSelecionados);
      onSelectionChange?.(proximosSelecionados);
      return;
    }
    if (selecionados.length >= 6) return;
    const proximosSelecionados = [...selecionados, etapaParaSelecionar];
    setSelecionados(proximosSelecionados);
    onSelectionChange?.(proximosSelecionados);
  };

  const totalPaginas = Math.ceil(listaParaExibir.length / ITENS_POR_PAGINA);
  const tarefasPaginadas = listaParaExibir.slice(
    (pagina - 1) * ITENS_POR_PAGINA,
    pagina * ITENS_POR_PAGINA,
  );

  useEffect(() => {
    setPagina(1);
  }, [termoFiltro, faseFiltro]);

  if (carregando) return <UICarregando variante="bloco" />;
  if (erro) return <p style={{ color: 'red', textAlign: 'center' }}>{erro}</p>;

  const totalDisponivel = tarefasAgrupadas.length;
  const totalFiltrado = listaFiltradaPorFase.length;
  const nomeFase = faseFiltro === 'POS_OP' ? 'arremates pós-OP' : 'processos da OP';
  const textoMeta = termoFiltro
    ? `${totalFiltrado} resultado${totalFiltrado !== 1 ? 's' : ''} de ${totalDisponivel}`
    : `${totalDisponivel} tarefa${totalDisponivel !== 1 ? 's' : ''} disponível${totalDisponivel !== 1 ? 'is' : ''}`;
  const buscaTarefa = termoFiltro.trim();
  const qtdSelecionados = selecionados.length;
  const textoBotao = qtdSelecionados === 1 ? 'Atribuir 1 Tarefa' : `Atribuir ${qtdSelecionados} Tarefas`;
  const podeAtribuir = temPermissao('atribuir-tarefa');

  return (
    <div className="coluna-lista-produtos op-selecao-tela">
      <div className="op-selecao-fases-v4" role="tablist" aria-label="Fase da tarefa">
        {[
          { id: 'TODAS' as const, label: 'Todas', detalhe: 'tarefas', count: totalDisponivel, icon: 'fa-layer-group' },
          { id: 'OP' as const, label: 'Processos da OP', detalhe: 'trabalho interno', count: contagemFases.OP, icon: 'fa-gears' },
          { id: 'POS_OP' as const, label: 'Arremates pós-OP', detalhe: 'antes da embalagem', count: contagemFases.POS_OP, icon: 'fa-box-open' },
        ].map((fase) => (
          <button
            key={fase.id}
            type="button"
            role="tab"
            aria-selected={faseFiltro === fase.id}
            className={`op-selecao-fase-btn-v4 op-selecao-fase-btn-v4--${fase.id.toLowerCase()}${faseFiltro === fase.id ? ' ativo' : ''}`}
            onClick={() => setFaseFiltro(fase.id)}
            disabled={fase.id !== 'TODAS' && fase.count === 0}
          >
            <span className="op-selecao-fase-icone-v4"><i className={`fas ${fase.icon}`}></i></span>
            <span className="op-selecao-fase-copy-v4"><strong>{fase.label}</strong><small>{fase.detalhe}</small></span>
            <span className="op-selecao-fase-contagem-v4">{fase.count}</span>
            {faseFiltro === fase.id && (
              <span className="op-selecao-fase-selecionada-v4" aria-hidden="true">
                <i className="fas fa-check"></i>
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="op-selecao-busca-v4">
        <UIBuscaInteligente onSearch={setTermoFiltro} placeholder="Buscar por produto, variante ou processo..." />
      </div>

      <p className="op-busca-meta">
        {textoMeta}
        {faseFiltro !== 'TODAS' && <span className="op-busca-meta-fase"> · filtrando {nomeFase}</span>}
      </p>

      <div className="op-cards-container-modal">
        {tarefasPaginadas.length > 0 ? (
          tarefasPaginadas.map((etapa, indice) => {
            const { label, isFinal, imagemUrl } = getEtapaInfo(etapa);
            const etapaId = obterChaveTarefa(etapa);
            const selecionadoAtual = selecionados.find((item) => obterChaveTarefa(item) === etapaId);
            const isSelected = Boolean(selecionadoAtual);
            const grupoInfo = getGrupoInfo(etapa) || (
              selecionadoAtual?._unificada && selecionadoAtual._grupo_unificacao
                ? { grupo: selecionadoAtual._grupo_unificacao, idxNoGrupo: 0 }
                : null
            );
            const percursoAberto = Boolean(grupoInfo && percursosAbertos.has(grupoInfo.grupo.grupo_id));
            const totalPercurso = grupoInfo
              ? (finaisPercurso[grupoInfo.grupo.grupo_id]
                || selecionadoAtual?._grupo_unificacao?.etapas.length
                || 1)
              : 1;
            const fluxoSelecionadoPendente = Boolean(
              grupoInfo
              && !isSelected
              && Object.prototype.hasOwnProperty.call(finaisPercurso, grupoInfo.grupo.grupo_id),
            );
            const grupoAtual = etapa.fase === 'POS_OP' ? 'POS_OP' : 'OP';
            const grupoAnterior = indice > 0
              ? tarefasPaginadas[indice - 1].fase === 'POS_OP' ? 'POS_OP' : 'OP'
              : null;

            return (
              <Fragment key={etapaId}>
                {grupoAtual !== grupoAnterior && (
                  <div className={`op-fila-secao-v4 op-fila-secao-v4--${grupoAtual.toLowerCase()}`}>
                    <span className="op-fila-secao-v4__icone"><i className={`fas ${grupoAtual === 'POS_OP' ? 'fa-box-open' : 'fa-gears'}`}></i></span>
                    <div>
                      <strong>{grupoAtual === 'POS_OP' ? 'Arremates pós-OP' : 'Processos da OP'}</strong>
                      <span>{grupoAtual === 'POS_OP'
                        ? 'A OP já foi encerrada; estas tarefas liberam a embalagem.'
                        : 'Etapas internas da ordem de produção.'}</span>
                    </div>
                    <span className="op-fila-secao-v4__efeito">
                      <i className={`fas ${grupoAtual === 'POS_OP' ? 'fa-box-open' : 'fa-arrow-right'}`}></i>
                      {grupoAtual === 'POS_OP' ? 'Libera embalagem' : 'Continua na OP'}
                    </span>
                  </div>
                )}
                <OPEtapaCardV4
                  etapa={etapa}
                  funcionarioNome={funcionario?.nome}
                  stepLabel={label}
                  isFinal={isFinal}
                  imagemUrl={imagemUrl}
                  selecionado={isSelected}
                  onToggle={handleToggleSelect}
                  grupoInfo={grupoInfo}
                  percursoAberto={percursoAberto}
                  totalPercurso={totalPercurso}
                  fluxoSelecionadoPendente={fluxoSelecionadoPendente}
                  onTogglePercurso={handleTogglePercurso}
                  onDefinirFinalPercurso={handleDefinirFinalPercurso}
                />
              </Fragment>
            );
          })
        ) : (
          <UIFeedbackNotFound
            icon="fa-clipboard-list"
            titulo={buscaTarefa ? 'Nenhuma tarefa encontrada' : 'Nenhuma tarefa disponível'}
            mensagem={buscaTarefa
              ? `Não encontramos tarefas para “${buscaTarefa}”. Tente outro produto, variante ou processo.`
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
            onEtapaSelect(selecionados);
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
