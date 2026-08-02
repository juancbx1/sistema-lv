// public/src/components/OPModalTempos.tsx
// Modal de configuracao de TPP (Tempo Padrao de Producao)

import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
// @ts-expect-error popups JS legado sem declaracao TypeScript
import { mostrarMensagem } from '/js/utils/popups.js';
import UIBuscaInteligente from './UIBuscaInteligente';
import UICarregando from './UICarregando';

interface TppEtapaConfig {
  processo?: string | null;
  maquina?: string | null;
}

interface TppProduto {
  id: number;
  nome: string;
  imagem?: string | null;
  is_kit?: boolean;
  etapas?: Array<string | TppEtapaConfig> | null;
}

type TppTempos = Record<string, string | number>;

interface TppEtapa {
  processo: string;
  maquina: string | null;
}

interface TppProdutoCardProps {
  produto: TppProduto;
  tempos: TppTempos;
  onTempoChange: (chave: string, valor: string) => void;
}

interface OpModalTemposProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FetchOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

async function fetchApiWithToken<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const response = await fetch(endpoint, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const errorData = (await response.json()) as { error?: string };
    throw new Error(errorData.error || 'Erro na requisição');
  }
  return (await response.json()) as T;
}

function obterEtapas(produto: TppProduto): TppEtapa[] {
  return (produto.etapas || []).map((etapa) => {
    if (typeof etapa === 'string') return { processo: etapa, maquina: null };
    return { processo: etapa.processo || '', maquina: etapa.maquina || null };
  });
}

function TPPProdutoCard({ produto, tempos, onTempoChange }: TppProdutoCardProps) {
  const etapas = useMemo(() => obterEtapas(produto), [produto]);
  const totalPreenchido = etapas.filter((etapa) => {
    const chave = `${produto.id}-${etapa.processo}`;
    return tempos[chave] !== undefined && parseFloat(String(tempos[chave])) > 0;
  }).length;
  const progresso = etapas.length > 0 ? Math.round((totalPreenchido / etapas.length) * 100) : 0;

  return (
    <div className="tpp-produto-card">
      <div className="tpp-produto-card-borda"></div>

      <div className="tpp-produto-header">
        <img
          src={produto.imagem || '/img/placeholder-image.png'}
          alt={produto.nome}
          className="tpp-produto-img"
          onError={(event: SyntheticEvent<HTMLImageElement>) => {
            event.currentTarget.src = '/img/placeholder-image.png';
          }}
        />
        <div className="tpp-produto-info">
          <h4 className="tpp-produto-nome">{produto.nome}</h4>
          <div className="tpp-produto-meta">
            <span className="tpp-etapas-count">
              <i className="fas fa-layer-group"></i>
              {etapas.length} etapa{etapas.length !== 1 ? 's' : ''}
            </span>
            <span className={`tpp-progresso-badge ${progresso === 100 ? 'completo' : progresso > 0 ? 'parcial' : ''}`}>
              {progresso === 100 ? (
                <><i className="fas fa-check-circle"></i> Completo</>
              ) : (
                `${totalPreenchido}/${etapas.length} configurado${totalPreenchido !== 1 ? 's' : ''}`
              )}
            </span>
          </div>
          {progresso > 0 && progresso < 100 && (
            <div className="tpp-barra-progresso">
              <div className="tpp-barra-preenchida" style={{ width: `${progresso}%` }}></div>
            </div>
          )}
        </div>
      </div>

      <div className="tpp-etapas-lista">
        {etapas.map((etapa, index) => {
          const chave = `${produto.id}-${etapa.processo}`;
          const isFinal = index === etapas.length - 1;
          const tempoAtual = tempos[chave] ?? '';
          const temValor = tempoAtual !== '' && parseFloat(String(tempoAtual)) > 0;
          return (
            <div key={chave} className={`tpp-etapa-row ${temValor ? 'tem-valor' : ''}`}>
              <div className="tpp-etapa-info">
                <span className={`tpp-etapa-badge ${isFinal ? 'final' : 'normal'}`}>
                  {isFinal ? 'Final' : `E${index + 1}`}
                </span>
                <div className="tpp-etapa-texto">
                  <span className="tpp-etapa-processo">{etapa.processo}</span>
                  {etapa.maquina && etapa.maquina !== 'Não Definida' && (
                    <span className="tpp-etapa-maquina">
                      <i className="fas fa-cog"></i> {etapa.maquina}
                    </span>
                  )}
                </div>
              </div>
              <div className="tpp-etapa-controle">
                <input
                  type="number"
                  className={`tpp-tempo-input ${temValor ? 'preenchido' : ''}`}
                  value={tempoAtual}
                  onChange={(event) => onTempoChange(chave, event.target.value)}
                  placeholder="—"
                  min="0.1"
                  step="0.1"
                />
                <span className="tpp-tempo-unidade">seg</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function mensagemDoErro(error: unknown) {
  return error instanceof Error ? error.message : 'Erro desconhecido';
}

export default function OPModalTempos({ isOpen, onClose }: OpModalTemposProps) {
  const [produtos, setProdutos] = useState<TppProduto[]>([]);
  const [tempos, setTempos] = useState<TppTempos>({});
  const [termoBusca, setTermoBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCarregando(true);
    setTermoBusca('');
    void Promise.all([
      fetchApiWithToken<TppProduto[]>('/api/produtos'),
      fetchApiWithToken<TppTempos>('/api/producao/tempos-padrao'),
    ])
      .then(([produtosData, temposData]) => {
        setProdutos(
          produtosData
            .filter((produto) => !produto.is_kit && (produto.etapas?.length || 0) > 0)
            .sort((a, b) => a.nome.localeCompare(b.nome)),
        );
        setTempos(temposData);
      })
      .catch((error: unknown) => {
        mostrarMensagem(`Erro ao carregar dados: ${mensagemDoErro(error)}`, 'erro');
      })
      .finally(() => {
        setCarregando(false);
      });
  }, [isOpen]);

  const handleTempoChange = (chave: string, valor: string) => {
    setTempos((prev) => ({ ...prev, [chave]: valor }));
  };

  const handleSalvar = async () => {
    setSalvando(true);
    try {
      await fetchApiWithToken('/api/producao/tempos-padrao', {
        method: 'POST',
        body: JSON.stringify({ tempos }),
      });
      mostrarMensagem('Tempos Padrão de Produção (TPP) salvos com sucesso!', 'sucesso');
      onClose();
    } catch (error: unknown) {
      mostrarMensagem(`Erro ao salvar: ${mensagemDoErro(error)}`, 'erro');
    } finally {
      setSalvando(false);
    }
  };

  const produtosFiltrados = useMemo(() => {
    if (!termoBusca) return produtos;
    const termo = termoBusca.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return produtos.filter((produto) => {
      const nome = produto.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (nome.includes(termo)) return true;
      return obterEtapas(produto).some((etapa) =>
        etapa.processo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(termo),
      );
    });
  }, [produtos, termoBusca]);

  const statsGeral = useMemo(() => {
    let total = 0;
    let preenchidos = 0;
    produtos.forEach((produto) => {
      obterEtapas(produto).forEach((etapa) => {
        const chave = `${produto.id}-${etapa.processo}`;
        total += 1;
        if (tempos[chave] !== undefined && parseFloat(String(tempos[chave])) > 0) preenchidos += 1;
      });
    });
    return { total, preenchidos };
  }, [produtos, tempos]);

  if (!isOpen) return null;

  return (
    <div className="popup-container" style={{ display: 'flex' }}>
      <div className="popup-overlay" onClick={onClose}></div>
      <div className="op-modal tpp-modal">
        <div className="op-modal-header">
          <div className="tpp-modal-titulo-grupo">
            <div className="tpp-modal-icone">
              <i className="fas fa-stopwatch"></i>
            </div>
            <div>
              <h3 className="op-modal-titulo">Tempos Padrão de Produção</h3>
              {!carregando && (
                <p className="tpp-modal-subtitulo">
                  {statsGeral.preenchidos} de {statsGeral.total} etapas configuradas
                  {statsGeral.total > 0 && (
                    <span className={`tpp-stats-pill ${statsGeral.preenchidos === statsGeral.total ? 'completo' : ''}`}>
                      {Math.round((statsGeral.preenchidos / statsGeral.total) * 100)}%
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
          <button className="op-modal-fechar-btn" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="tpp-modal-busca">
          <UIBuscaInteligente onSearch={setTermoBusca} placeholder="Buscar produto ou processo..." />
          {!carregando && termoBusca && (
            <span className="tpp-busca-meta">
              {produtosFiltrados.length} de {produtos.length}
            </span>
          )}
        </div>

        <div className="tpp-modal-corpo">
          {carregando ? (
            <UICarregando variante="bloco" texto="Carregando produtos..." />
          ) : produtosFiltrados.length === 0 ? (
            <div className="tpp-vazio">
              <i className="fas fa-search"></i>
              <p>Nenhum produto encontrado para "{termoBusca}"</p>
            </div>
          ) : (
            <div className="tpp-cards-grid">
              {produtosFiltrados.map((produto) => (
                <TPPProdutoCard
                  key={produto.id}
                  produto={produto}
                  tempos={tempos}
                  onTempoChange={handleTempoChange}
                />
              ))}
            </div>
          )}
        </div>

        <div className="op-modal-footer">
          <button className="op-botao op-botao-secundario" onClick={onClose} disabled={salvando}>
            Cancelar
          </button>
          <button className="op-botao op-botao-principal" onClick={() => void handleSalvar()} disabled={salvando}>
            {salvando ? (
              <><div className="spinner-btn-interno"></div> Salvando...</>
            ) : (
              <><i className="fas fa-save"></i> Salvar Alterações</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
