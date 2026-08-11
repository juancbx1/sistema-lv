import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
// @ts-expect-error catálogo JS legado sem declaração TypeScript
import { MAQUINAS, PROCESSOS } from '/js/utils/prod-proc-maq.js';
import type { EtapaProdutoLike, ModoExecucaoEtapa } from '../utils/etapas-produto';
import { obterExecutoresEtapa } from '../utils/etapas-produto';
import UIBloqueio from './UIBloqueio';

type FaseEtapa = 'OP' | 'POS_OP' | null;
type TipoExecutor = 'costureira' | 'tiktik' | 'cortador';

interface NovaEtapaConfig {
  fase: Exclude<FaseEtapa, null>;
  executores: TipoExecutor[];
  processoCodigoPreferido?: string;
  maquina?: string | null;
}

interface EtapaEditor extends Record<string, unknown> {
  id: string | null;
  processo_id: string | number | null;
  ordem: number;
  processo: string;
  maquina: string | null;
  feitoPor: string[];
  fase: FaseEtapa;
  modoExecucao: ModoExecucaoEtapa;
  origem?: string;
}

interface ProdutoComEtapas {
  etapas?: EtapaProdutoLike[] | null;
  etapasTiktik?: EtapaProdutoLike[] | null;
  etapastiktik?: EtapaProdutoLike[] | null;
  etapasCanonicas?: EtapaProdutoLike[] | null;
}

interface ProcessoCatalogo {
  id: string | number | null;
  codigo: string;
  nome: string;
  ativo: boolean;
}

declare global {
  interface Window {
    sincronizarEtapasProduto?: (produto: ProdutoComEtapas | null) => void;
    obterEtapasCanonicas?: () => EtapaEditor[];
    __produtoEtapasPendente?: ProdutoComEtapas | null;
  }
}

const TIPOS_EXECUTORES: Array<{ value: TipoExecutor; label: string }> = [
  { value: 'costureira', label: 'Costureira' },
  { value: 'tiktik', label: 'TikTik' },
  { value: 'cortador', label: 'Cortador' },
];

function gerarIdEtapa(origem: string, indice: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `etapa-${origem || 'nova'}-${Date.now()}-${indice}`;
}

function chaveProcesso(processo: ProcessoCatalogo): string {
  return processo.id === null || processo.id === undefined
    ? `nome:${processo.nome}`
    : `id:${processo.id}`;
}

function encontrarProcesso(
  processos: ProcessoCatalogo[],
  etapa: Pick<EtapaEditor, 'processo_id' | 'processo'>,
): ProcessoCatalogo | undefined {
  if (etapa.processo_id !== null && etapa.processo_id !== undefined) {
    const porId = processos.find((processo) => (
      processo.id !== null
      && processo.id !== undefined
      && String(processo.id) === String(etapa.processo_id)
    ));
    if (porId) return porId;
  }

  return processos.find((processo) => (
    processo.nome.localeCompare(etapa.processo, 'pt-BR', { sensitivity: 'base' }) === 0
  ));
}

function ordenarProcessos(processos: ProcessoCatalogo[]): ProcessoCatalogo[] {
  return [...processos].sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

function normalizarProcessoCatalogo(processo: Partial<ProcessoCatalogo>): ProcessoCatalogo {
  return {
    id: processo.id ?? null,
    codigo: String(processo.codigo || ''),
    nome: String(processo.nome || '').trim(),
    ativo: processo.ativo !== false,
  };
}

async function requisitarProcessos(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const dados = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(dados.error || 'Não foi possível acessar o catálogo de processos.');
  return dados;
}

function normalizarEtapas(produto: ProdutoComEtapas | null): EtapaEditor[] {
  const etapasBase = Array.isArray(produto?.etapasCanonicas)
    ? produto.etapasCanonicas
    : [
        ...(Array.isArray(produto?.etapas) ? produto.etapas : []).map((etapa) => ({
          ...(typeof etapa === 'string' ? { processo: etapa } : etapa),
          fase: typeof etapa === 'string' || !etapa?.fase ? 'OP' : etapa.fase,
          origem: 'etapas',
        })),
        ...(Array.isArray(produto?.etapasTiktik)
          ? produto.etapasTiktik
          : Array.isArray(produto?.etapastiktik) ? produto.etapastiktik : []),
      ];

  return etapasBase.map((etapa, indice) => {
    const objeto = typeof etapa === 'string' ? { processo: etapa } : (etapa || {});
    const executores = obterExecutoresEtapa(objeto);
    const fase = objeto.fase === 'OP' || objeto.fase === 'POS_OP' ? objeto.fase : null;
    const modoExecucao: ModoExecucaoEtapa = fase === 'POS_OP'
      && String(objeto.modoExecucao ?? objeto.modo_execucao ?? '').toUpperCase() === 'LIBERACAO_AUTOMATICA'
      ? 'LIBERACAO_AUTOMATICA'
      : 'MANUAL';

    return {
      ...objeto,
      id: typeof objeto.id === 'string' && objeto.id ? objeto.id : gerarIdEtapa(String(objeto.origem || 'legado'), indice),
      processo_id: objeto.processo_id ?? null,
      ordem: Number.isInteger(objeto.ordem) && Number(objeto.ordem) > 0 ? Number(objeto.ordem) : indice + 1,
      processo: typeof objeto.processo === 'string' ? objeto.processo : '',
      maquina: typeof objeto.maquina === 'string' && objeto.maquina ? objeto.maquina : null,
      feitoPor: executores,
      fase,
      modoExecucao,
      origem: typeof objeto.origem === 'string' ? objeto.origem : 'etapas',
    };
  });
}

function reordenar(etapas: EtapaEditor[]): EtapaEditor[] {
  return etapas.map((etapa, indice) => ({ ...etapa, ordem: indice + 1 }));
}

export default function ProdutoEtapasEditor() {
  const [etapas, setEtapas] = useState<EtapaEditor[]>([]);
  const [processos, setProcessos] = useState<ProcessoCatalogo[]>([]);
  const [catalogoDisponivel, setCatalogoDisponivel] = useState(false);
  const [catalogoErro, setCatalogoErro] = useState<string | null>(null);
  const [novoProcessoNome, setNovoProcessoNome] = useState('');
  const [salvandoProcesso, setSalvandoProcesso] = useState(false);

  useEffect(() => {
    const sincronizar = (produto: ProdutoComEtapas | null) => {
      setEtapas(normalizarEtapas(produto));
    };

    window.sincronizarEtapasProduto = sincronizar;
    if (window.__produtoEtapasPendente) {
      sincronizar(window.__produtoEtapasPendente);
      window.__produtoEtapasPendente = null;
    }

    return () => {
      delete window.sincronizarEtapasProduto;
      delete window.obterEtapasCanonicas;
    };
  }, []);

  useEffect(() => {
    let desmontado = false;
    const processosFallback = PROCESSOS.map((nome: string) => ({
      id: null,
      codigo: nome,
      nome,
      ativo: true,
    }));

    requisitarProcessos('/api/processos-producao?incluir_inativos=true')
      .then((dados) => {
        if (desmontado) return;
        const lista = Array.isArray(dados)
          ? dados.map((processo) => normalizarProcessoCatalogo(processo))
          : [];
        setProcessos(ordenarProcessos(lista));
        setCatalogoDisponivel(true);
        setCatalogoErro(null);
      })
      .catch((error: Error) => {
        if (desmontado) return;
        setProcessos(processosFallback);
        setCatalogoDisponivel(false);
        setCatalogoErro(error.message);
      });

    return () => { desmontado = true; };
  }, []);

  useEffect(() => {
    if (processos.length === 0) return;
    setEtapas((atuais) => {
      let mudou = false;
      const atualizadas = atuais.map((etapa) => {
        const encontrado = encontrarProcesso(processos, etapa);
        if (!encontrado) return etapa;

        const processoId = encontrado.id ?? etapa.processo_id;
        if (etapa.processo_id === processoId && etapa.processo === encontrado.nome) return etapa;
        mudou = true;
        return { ...etapa, processo_id: processoId, processo: encontrado.nome };
      });
      return mudou ? atualizadas : atuais;
    });
  }, [processos]);

  useEffect(() => {
    window.obterEtapasCanonicas = () => etapas.map((etapa, indice) => ({
      ...etapa,
      ordem: indice + 1,
      // Uma etapa automática não pode carregar executores, para que nenhum
      // fluxo antigo tente oferecê-la como tarefa de funcionário.
      feitoPor: etapa.modoExecucao === 'LIBERACAO_AUTOMATICA' ? [] : [...etapa.feitoPor],
    }));
  }, [etapas]);

  const etapasPendentes = useMemo(
    () => etapas.filter((etapa) => (
      !etapa.fase
      || !etapa.processo
      || (etapa.modoExecucao !== 'LIBERACAO_AUTOMATICA' && etapa.feitoPor.length === 0)
    )),
    [etapas],
  );

  const atualizarEtapa = (indice: number, alteracoes: Partial<EtapaEditor>) => {
    setEtapas((atuais) => atuais.map((etapa, index) => (
      index === indice ? { ...etapa, ...alteracoes } : etapa
    )));
  };

  const adicionarEtapa = (config: NovaEtapaConfig = {
    fase: 'OP',
    executores: ['costureira'],
  }) => {
    const processoCodigoPreferido = config.processoCodigoPreferido;
    const processoPadrao = processoCodigoPreferido
      ? processos.find((processo) => (
        processo.codigo === processoCodigoPreferido
        || processo.nome.localeCompare(processoCodigoPreferido, 'pt-BR', { sensitivity: 'base' }) === 0
      ))
      : processos[0];

    setEtapas((atuais) => reordenar([
      ...atuais,
      {
        id: gerarIdEtapa('nova', atuais.length),
        processo_id: processoPadrao?.id ?? null,
        ordem: atuais.length + 1,
        processo: processoPadrao?.nome || PROCESSOS[0] || '',
        maquina: config.maquina ?? (config.fase === 'POS_OP' ? 'Não Usa' : MAQUINAS[0] || null),
        feitoPor: [...config.executores],
        fase: config.fase,
        modoExecucao: 'MANUAL',
        origem: 'etapas',
      },
    ]));
  };

  const removerEtapa = (indice: number) => {
    setEtapas((atuais) => reordenar(atuais.filter((_, index) => index !== indice)));
  };

  const moverEtapa = (indice: number, deslocamento: -1 | 1) => {
    setEtapas((atuais) => {
      const destino = indice + deslocamento;
      if (destino < 0 || destino >= atuais.length) return atuais;
      const proxima = [...atuais];
      [proxima[indice], proxima[destino]] = [proxima[destino], proxima[indice]];
      return reordenar(proxima);
    });
  };

  const alternarExecutor = (indice: number, tipo: TipoExecutor) => {
    const etapa = etapas[indice];
    if (!etapa) return;
    if (etapa.modoExecucao === 'LIBERACAO_AUTOMATICA') return;
    const feitoPor = etapa.feitoPor.includes(tipo)
      ? etapa.feitoPor.filter((executor) => executor !== tipo)
      : [...etapa.feitoPor, tipo];
    atualizarEtapa(indice, { feitoPor });
  };

  const alterarFase = (indice: number, valor: string) => {
    const fase = (valor || null) as FaseEtapa;
    atualizarEtapa(indice, {
      fase,
      modoExecucao: fase === 'POS_OP' ? etapas[indice]?.modoExecucao || 'MANUAL' : 'MANUAL',
    });
  };

  const alterarModoExecucao = (indice: number, valor: string) => {
    const modoExecucao: ModoExecucaoEtapa = valor === 'LIBERACAO_AUTOMATICA'
      ? 'LIBERACAO_AUTOMATICA'
      : 'MANUAL';
    atualizarEtapa(indice, { modoExecucao });
  };

  const alterarProcesso = (indice: number, valor: string) => {
    const selecionado = processos.find((processo) => chaveProcesso(processo) === valor);
    if (!selecionado) {
      atualizarEtapa(indice, { processo_id: null, processo: valor });
      return;
    }
    atualizarEtapa(indice, { processo_id: selecionado.id, processo: selecionado.nome });
  };

  const adicionarProcesso = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nome = novoProcessoNome.trim();
    if (!nome || !catalogoDisponivel) return;
    setSalvandoProcesso(true);
    try {
      const criado = await requisitarProcessos('/api/processos-producao', {
        method: 'POST',
        body: JSON.stringify({ nome }),
      });
      setProcessos((atuais) => ordenarProcessos([...atuais, normalizarProcessoCatalogo(criado)]));
      setNovoProcessoNome('');
      setCatalogoErro(null);
    } catch (error) {
      setCatalogoErro(error instanceof Error ? error.message : 'Erro ao criar processo.');
    } finally {
      setSalvandoProcesso(false);
    }
  };

  const renomearProcesso = async (processo: ProcessoCatalogo) => {
    if (!catalogoDisponivel || processo.id === null) return;
    const novoNome = window.prompt('Novo nome do processo:', processo.nome)?.trim();
    if (!novoNome || novoNome === processo.nome) return;
    setSalvandoProcesso(true);
    try {
      const atualizado = await requisitarProcessos(`/api/processos-producao/${processo.id}`, {
        method: 'PUT',
        body: JSON.stringify({ nome: novoNome }),
      });
      setProcessos((atuais) => ordenarProcessos(atuais.map((item) => (
        String(item.id) === String(processo.id) ? normalizarProcessoCatalogo(atualizado) : item
      ))));
      setCatalogoErro(null);
    } catch (error) {
      setCatalogoErro(error instanceof Error ? error.message : 'Erro ao renomear processo.');
    } finally {
      setSalvandoProcesso(false);
    }
  };

  const processosParaSelecao = (etapa: EtapaEditor) => {
    const ativos = processos.filter((processo) => processo.ativo);
    const atual = encontrarProcesso(processos, etapa);
    if (atual && !atual.ativo) return [atual, ...ativos.filter((processo) => String(processo.id) !== String(atual.id))];
    return ativos;
  };

  return (
    <div className="cp-form-group cp-etapas-editor">
      <div className="cp-etapas-editor__cabecalho">
        <div>
          <h3>Etapas da produção</h3>
          <p className="cp-etapas-editor__descricao">
            Cadastre o fluxo completo. A fase define quando a tarefa poderá ser atribuída.
          </p>
        </div>
        <span className="cp-etapas-editor__contador">
          {etapas.length} etapa{etapas.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="cp-etapas-editor__legenda" aria-label="Legenda das fases">
        <span><strong>Liberacao automatica:</strong> libera embalagem sem criar tarefa ou pontos de arremate.</span>
        <span><strong>Dentro da OP:</strong> continua o fluxo da ordem de produção.</span>
        <span><strong>Arremate pós-OP:</strong> só aparece depois do encerramento e libera embalagem.</span>
      </div>

      {etapasPendentes.length > 0 && (
        <div className="cp-etapas-editor__alerta" role="alert">
          <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>
          <span>
            {etapasPendentes.length} etapa{etapasPendentes.length === 1 ? '' : 's'} precisa{etapasPendentes.length === 1 ? '' : 'm'} de revisão: informe processo, fase e pelo menos um executor.
          </span>
        </div>
      )}

      <UIBloqueio
        permissao="gerenciar-produtos"
        mensagem="Você não tem permissão para criar ou renomear processos do catálogo."
        style={{ display: 'block', width: '100%' }}
      >
      <details className="cp-processos-configuracao">
        <summary><i className="fas fa-sliders" aria-hidden="true"></i> Configuração de processos</summary>
        <div className="cp-processos-configuracao__conteudo">
          <p>
            O código do processo é permanente. Você pode alterar o nome sem quebrar produtos, OPs ou históricos.
          </p>
          {catalogoErro && (
            <div className="cp-processos-configuracao__aviso" role="status">
              Catálogo backend indisponível. A lista atual do sistema está sendo usada como contingência; criação e renomeação ficam bloqueadas.
            </div>
          )}
          <form className="cp-processos-configuracao__form" onSubmit={adicionarProcesso}>
            <input
              className="cp-input"
              value={novoProcessoNome}
              onChange={(event) => setNovoProcessoNome(event.target.value)}
              placeholder="Novo processo"
              maxLength={120}
              disabled={!catalogoDisponivel || salvandoProcesso}
            />
            <button type="submit" className="cp-btn cp-btn-primary" disabled={!catalogoDisponivel || salvandoProcesso || !novoProcessoNome.trim()}>
              <i className="fas fa-plus" aria-hidden="true"></i> Adicionar
            </button>
          </form>
          <ul className="cp-processos-configuracao__lista">
            {processos.map((processo) => (
              <li key={processo.id === null ? processo.codigo : String(processo.id)}>
                <span>
                  <strong>{processo.nome}</strong>
                  <small>{processo.codigo}{processo.ativo ? '' : ' · inativo'}</small>
                </span>
                <button type="button" className="cp-btn cp-btn-secondary" onClick={() => renomearProcesso(processo)} disabled={!catalogoDisponivel || processo.id === null || salvandoProcesso}>
                  Renomear
                </button>
              </li>
            ))}
          </ul>
        </div>
      </details>
      </UIBloqueio>

      <UIBloqueio
        permissao="gerenciar-produtos"
        mensagem="Você não tem permissão para editar as etapas de produção deste produto."
        style={{ display: 'block', width: '100%' }}
      >
      <>
      <div className="cp-etapas-editor__tabela-wrapper">
        <table className="cp-table cp-etapas-editor__tabela" aria-label="Etapas da produção">
          <thead>
            <tr>
              <th scope="col">Ordem</th>
              <th scope="col">Processo</th>
              <th scope="col">Máquina</th>
              <th scope="col">Fase</th>
              <th scope="col">Execucao</th>
              <th scope="col">Feita por</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {etapas.length === 0 ? (
              <tr>
                <td colSpan={7} className="cp-etapas-editor__vazio">Nenhuma etapa cadastrada.</td>
              </tr>
            ) : etapas.map((etapa, indice) => (
              <tr key={etapa.id || `${etapa.processo}-${indice}`} className={!etapa.fase ? 'cp-etapa-linha--pendente' : ''}>
                <td data-label="Ordem">
                  <div className="cp-etapa-ordem">
                    <span>{indice + 1}</span>
                    <div className="cp-etapa-ordem__acoes">
                      <button type="button" title="Subir etapa" aria-label="Subir etapa" disabled={indice === 0} onClick={() => moverEtapa(indice, -1)}>↑</button>
                      <button type="button" title="Descer etapa" aria-label="Descer etapa" disabled={indice === etapas.length - 1} onClick={() => moverEtapa(indice, 1)}>↓</button>
                    </div>
                  </div>
                </td>
                <td data-label="Processo">
                  <select
                    className="cp-select"
                    value={(() => {
                      const atual = encontrarProcesso(processos, etapa);
                      return atual ? chaveProcesso(atual) : etapa.processo;
                    })()}
                    onChange={(event) => alterarProcesso(indice, event.target.value)}
                  >
                    <option value="">Selecione o processo</option>
                    {processosParaSelecao(etapa).map((processo) => (
                      <option key={chaveProcesso(processo)} value={chaveProcesso(processo)}>
                        {processo.nome}{processo.ativo ? '' : ' (inativo)'}
                      </option>
                    ))}
                  </select>
                </td>
                <td data-label="Máquina">
                  <select
                    className="cp-select"
                    value={etapa.maquina || ''}
                    onChange={(event) => atualizarEtapa(indice, { maquina: event.target.value || null })}
                  >
                    <option value="">Selecione a máquina</option>
                    {MAQUINAS.map((maquina: string) => <option key={maquina} value={maquina}>{maquina}</option>)}
                  </select>
                </td>
                <td data-label="Fase">
                  <select
                    className={`cp-select cp-etapa-fase cp-etapa-fase--${etapa.fase || 'pendente'}`}
                    value={etapa.fase || ''}
                    onChange={(event) => alterarFase(indice, event.target.value)}
                  >
                    <option value="">Classificar fase</option>
                    <option value="OP">Dentro da OP</option>
                    <option value="POS_OP">Arremate pós-OP</option>
                  </select>
                </td>
                <td data-label="Execucao">
                  {etapa.fase === 'POS_OP' ? (
                    <>
                      <select
                        className="cp-select cp-etapa-execucao"
                        value={etapa.modoExecucao}
                        onChange={(event) => alterarModoExecucao(indice, event.target.value)}
                      >
                        <option value="MANUAL">Arremate manual</option>
                        <option value="LIBERACAO_AUTOMATICA">Liberacao automatica</option>
                      </select>
                      {etapa.modoExecucao === 'LIBERACAO_AUTOMATICA' && (
                        <small className="cp-etapa-execucao__ajuda">
                          Ao encerrar a OP, libera para embalagem sem tarefa nem pontos.
                        </small>
                      )}
                    </>
                  ) : (
                    <span className="cp-etapa-execucao__op">Trabalho da OP</span>
                  )}
                </td>
                <td data-label="Feita por">
                  <div className={`cp-etapa-executores${etapa.modoExecucao === 'LIBERACAO_AUTOMATICA' ? ' cp-etapa-executores--desabilitados' : ''}`}>
                    {TIPOS_EXECUTORES.map((tipo) => (
                      <label key={tipo.value} className="cp-etapa-executor">
                        <input
                          type="checkbox"
                          checked={etapa.feitoPor.includes(tipo.value)}
                          onChange={() => alternarExecutor(indice, tipo.value)}
                          disabled={etapa.modoExecucao === 'LIBERACAO_AUTOMATICA'}
                        />
                        <span>{tipo.label}</span>
                      </label>
                    ))}
                  </div>
                  {etapa.modoExecucao === 'LIBERACAO_AUTOMATICA' && (
                    <small className="cp-etapa-execucao__ajuda">Sistema</small>
                  )}
                </td>
                <td data-label="Ações">
                  <button type="button" className="cp-remove-btn" onClick={() => removerEtapa(indice)} aria-label={`Remover etapa ${indice + 1}`}>
                    <i className="fas fa-trash" aria-hidden="true"></i>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cp-etapas-editor__acoes-adicionar">
        <button
          type="button"
          className="cp-btn cp-btn-add"
          onClick={() => adicionarEtapa()}
        >
          <i className="fas fa-plus" aria-hidden="true"></i> Adicionar processo da OP
        </button>
        <button
          type="button"
          className="cp-btn cp-btn-add-pos"
          onClick={() => adicionarEtapa({
            fase: 'POS_OP',
            processoCodigoPreferido: 'arrematar',
            maquina: 'Não Usa',
            executores: ['costureira', 'tiktik'],
          })}
        >
          <i className="fas fa-scissors" aria-hidden="true"></i> Adicionar arremate pós-OP
        </button>
      </div>
      </>
      </UIBloqueio>
    </div>
  );
}
