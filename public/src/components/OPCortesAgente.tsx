import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import UIAgenteIA from './UIAgenteIA';
import useTypewriter from '../hooks/useTypewriter';
import useContador from '../hooks/useContador.js';
import OPAgenteFaseScan from './OPAgenteFaseScan.jsx';
import UIBloqueio from './UIBloqueio';
import UIFeedbackNotFound from './UIFeedbackNotFound';

interface ProdutoGrade {
  variacao?: string | null;
  imagem?: string | null;
}

interface ProdutoCorte {
  id: number;
  nome: string;
  sku?: string | null;
  imagem?: string | null;
  grade?: ProdutoGrade[] | null;
}

interface CorteEmEstoque {
  [key: string]: unknown;
}

interface RadarAlerta {
  produto_id: number;
  variante?: string | null;
  pecas_necessarias?: number | string | null;
  pecas_em_estoque?: number | string | null;
}

interface RadarResponse {
  alertasDeficit?: RadarAlerta[];
  error?: string;
}

interface PlanoCorte extends RadarAlerta {
  imagem: string | null;
  deficit: number;
  produtoCompleto: ProdutoCorte | null;
}

interface ScanMensagem {
  texto: string;
  contador?: { alvo: number; sufixo: string };
}

interface MemoriaCortes {
  timestamp: number;
  encontrados: number;
  voltouParcial: boolean;
}

interface SondagemSilenciosa {
  timestamp: number;
  encontrou: boolean;
  quantidade: number;
}

interface OPCortesAgenteProps {
  produtos: ProdutoCorte[];
  onCortarAgora: (dados: {
    produto: ProdutoCorte | null;
    variante: string | null;
    quantidadeSugerida: number;
  }) => void;
  rescanKey: number;
  cortesEmEstoque: CorteEmEstoque[];
  nomeUsuario?: string | null;
}

type EstadoAgente = 'idle' | 'scanning' | 'avaliando' | 'done';

const FRASES_MONITORANDO = [
  'Estou monitorando o estoque de cortes. Quer cortar agora?',
  'Acompanhando as demandas de corte em tempo real.',
  'Nada detectado ainda. Posso analisar o plano de corte quando quiser.',
  'Sistemas ativos. Aguardo seu comando para verificar os cortes pendentes.',
  'Estou de olho nas pendências de cortes. Devo verificar agora?',
  'Tudo dentro do esperado até agora. Quer um plano de corte atualizado?',
];

const FRASES_PARCIAL = [
  '{nome}, reparei que ficaram itens no plano sem corte registrado. Verifico agora?',
  'Você não cortou todos os itens do plano, {nome}. Quer resolver o restante?',
  'Ainda há déficit de corte na linha. Posso rever o plano?',
  '{nome}, percebo que ficaram pendências de corte. Revejo o plano agora?',
  'Missão incompleta! Ainda há itens aguardando corte no plano.',
  'Deixou alguns para depois? Posso verificar o que ainda precisa de corte.',
];

const FRASES_SONDAGEM_ENCONTROU = [
  '{nome}, acabei de verificar por conta própria... há {qtd} {item} com déficit de corte.',
  'Enquanto você estava aqui, dei uma olhada rápida. {qtd} {item} precisa{m} de corte.',
  '{nome}, atenção — encontrei déficit em {qtd} {item} sem você precisar pedir.',
  'Fiz uma verificação silenciosa agora. {qtd} {item} no plano de corte. Quer o relatório?',
];

const MENSAGENS_SCAN: ScanMensagem[] = [
  { texto: 'Verificando demandas abertas...' },
  { texto: 'Cruzando com estoque de cortes...' },
  {
    texto: 'Calculando solicitações de produção...',
    contador: { alvo: 15, sufixo: 'produtos analisados' },
  },
  { texto: 'Gerando plano de corte...' },
];

const INTERVALO_AO_VIVO_MS = 90_000;
const DELAY_SONDAGEM_MS = 12_000;
const MIN_INTERVALO_MS = 300_000;

function lerMemoria(chave: string): MemoriaCortes | null {
  try {
    const bruto = sessionStorage.getItem(chave);
    if (!bruto) return null;
    const memoria = JSON.parse(bruto) as Partial<MemoriaCortes>;
    if (
      typeof memoria.timestamp !== 'number' ||
      Date.now() - memoria.timestamp > 2 * 3600 * 1000
    ) {
      return null;
    }
    return {
      timestamp: memoria.timestamp,
      encontrados: Number(memoria.encontrados || 0),
      voltouParcial: Boolean(memoria.voltouParcial),
    };
  } catch {
    return null;
  }
}

function gravarMemoria(
  chave: string,
  dados: Partial<Omit<MemoriaCortes, 'timestamp'>>,
): void {
  try {
    sessionStorage.setItem(
      chave,
      JSON.stringify({ ...dados, timestamp: Date.now() }),
    );
  } catch {
    // Memória de sessão é opcional.
  }
}

function calcularTempoRelativo(timestamp: number): string {
  const minutos = Math.floor((Date.now() - timestamp) / 60000);
  if (minutos < 2) return 'agora mesmo';
  if (minutos < 60) return `há ${minutos} minutos`;
  return `há ${Math.floor(minutos / 60)}h`;
}

function construirFraseMemoriaCortes(
  memoria: MemoriaCortes,
  nomeUsuario?: string | null,
): string | null {
  const nome = nomeUsuario ? `${nomeUsuario}, ` : '';
  const ha = calcularTempoRelativo(memoria.timestamp);

  if (memoria.encontrados > 0 && memoria.voltouParcial) {
    return `${nome}${ha} ainda havia déficit de corte. Quer que eu verifique de novo?`;
  }
  if (memoria.encontrados === 0) {
    return `${ha} o estoque de cortes estava em dia. Quer verificar se mudou algo?`;
  }
  return null;
}

function substituirPlaceholders(
  frase: string,
  nome?: string | null,
  extra: Record<string, string | number> = {},
): string {
  let resultado = frase;
  if (nome) {
    resultado = resultado.replace(/\{nome\}/g, nome);
  } else {
    resultado = resultado
      .replace(/\{nome\},?\s*/g, '')
      .replace(/,?\s*\{nome\}/g, '');
  }
  for (const [chave, valor] of Object.entries(extra)) {
    resultado = resultado.replace(new RegExp(`\\{${chave}\\}`, 'g'), String(valor));
  }
  return resultado;
}

function calcularConfiancaCortes(alertasDeficit: number, totalProdutos: number): number {
  if (!totalProdutos) return 88;
  const cobertura = Math.min((totalProdutos - alertasDeficit) / totalProdutos, 1);
  return Math.round(75 + cobertura * 22);
}

function ScoreCounter({ alvo }: { alvo: number }) {
  const valor = useContador(alvo, 1400, true);
  return <>{valor}</>;
}

export default function OPCortesAgente({
  produtos,
  onCortarAgora,
  rescanKey,
  cortesEmEstoque,
  nomeUsuario,
}: OPCortesAgenteProps) {
  const [agentState, setAgentState] = useState<EstadoAgente>('idle');
  const [mensagensVisiveis, setMensagensVisiveis] = useState<ScanMensagem[]>([]);
  const [scoreAlvo, setScoreAlvo] = useState(0);
  const [plano, setPlano] = useState<PlanoCorte[]>([]);
  const [ultimoScan, setUltimoScan] = useState<Date | null>(null);
  const [voltouParcial, setVoltouParcial] = useState(false);
  const [sondagemSilenciosa, setSondagemSilenciosa] = useState<SondagemSilenciosa | null>(null);
  const [memoriaCortes, setMemoriaCortes] = useState<MemoriaCortes | null>(() =>
    lerMemoria('agente_cortes_memoria'),
  );

  const ultimaSondagemRef = useRef<number | null>(null);
  const avaliandoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const iniciarScan = useCallback(async () => {
    setSondagemSilenciosa(null);
    setAgentState('scanning');
    setMensagensVisiveis([]);
    setPlano([]);

    try {
      const token = localStorage.getItem('token');
      const fetchPromise = fetch('/api/cortes/radar', {
        headers: { Authorization: `Bearer ${token}` },
      }).then((response) => response.json() as Promise<RadarResponse>);

      for (let i = 0; i < MENSAGENS_SCAN.length; i += 1) {
        if (i > 0) await new Promise((resolve) => setTimeout(resolve, 580));
        setMensagensVisiveis((anterior) => [...anterior, MENSAGENS_SCAN[i]]);
      }

      const data = await fetchPromise;
      if (data.error) throw new Error(data.error);

      const planoEnriquecido: PlanoCorte[] = (data.alertasDeficit || []).map((item) => {
        const produtoCompleto = produtos.find((produto) => produto.id === item.produto_id) || null;
        let imagem = produtoCompleto?.imagem || null;
        if (produtoCompleto && item.variante && produtoCompleto.grade) {
          const grade = produtoCompleto.grade.find((itemGrade) => itemGrade.variacao === item.variante);
          if (grade?.imagem) imagem = grade.imagem;
        }
        return {
          ...item,
          imagem,
          deficit: Number(item.pecas_necessarias || 0) - Number(item.pecas_em_estoque || 0),
          produtoCompleto,
        };
      });

      await new Promise((resolve) => setTimeout(resolve, 380));
      const count = planoEnriquecido.length;
      const finalMsg = count > 0
        ? `${count} item${count > 1 ? 's' : ''} no plano de corte de hoje.`
        : 'Estoque em dia! Nenhuma demanda pendente sem corte.';
      setMensagensVisiveis((anterior) => [...anterior, { texto: finalMsg }]);

      await new Promise((resolve) => setTimeout(resolve, 440));
      gravarMemoria('agente_cortes_memoria', {
        encontrados: planoEnriquecido.length,
        voltouParcial: false,
      });

      setPlano(planoEnriquecido);
      setUltimoScan(new Date());
      setScoreAlvo(calcularConfiancaCortes(count, produtos?.length || 0));
      setAgentState('avaliando');
      if (avaliandoTimerRef.current) clearTimeout(avaliandoTimerRef.current);
      avaliandoTimerRef.current = setTimeout(() => setAgentState('done'), 1800);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : 'Falha ao analisar cortes.';
      setMensagensVisiveis((anterior) => [...anterior, { texto: `Erro: ${mensagem}` }]);
      setTimeout(() => setAgentState('idle'), 2500);
    }
  }, [produtos]);

  useEffect(() => {
    if (agentState !== 'idle') return;

    const agora = Date.now();
    const ultima = ultimaSondagemRef.current || 0;
    const tempoEspera = Math.max(DELAY_SONDAGEM_MS, MIN_INTERVALO_MS - (agora - ultima));

    const timer = setTimeout(async () => {
      if (agentState !== 'idle' || document.visibilityState !== 'visible') return;
      ultimaSondagemRef.current = Date.now();

      try {
        const token = localStorage.getItem('token');
        const data = (await fetch('/api/cortes/radar', {
          headers: { Authorization: `Bearer ${token}` },
        }).then((response) => response.json())) as RadarResponse;
        const quantidade = data.alertasDeficit?.length || 0;
        setSondagemSilenciosa({
          timestamp: Date.now(),
          encontrou: quantidade > 0,
          quantidade,
        });
      } catch {
        // Sondagem silenciosa não pode interromper a experiência.
      }
    }, tempoEspera);

    return () => clearTimeout(timer);
  }, [agentState]);

  const resetar = useCallback(() => {
    if (avaliandoTimerRef.current) clearTimeout(avaliandoTimerRef.current);
    const foiParcial = plano.length > 0;
    const memoriaAtual = lerMemoria('agente_cortes_memoria');
    gravarMemoria('agente_cortes_memoria', {
      ...memoriaAtual,
      voltouParcial: foiParcial,
    });
    setVoltouParcial(foiParcial);
    setMemoriaCortes(lerMemoria('agente_cortes_memoria'));
    setSondagemSilenciosa(null);
    setAgentState('idle');
    setMensagensVisiveis([]);
    setPlano([]);
    setUltimoScan(null);
  }, [plano]);

  useEffect(() => {
    if (rescanKey > 0) void iniciarScan();
  }, [rescanKey, iniciarScan]);

  useEffect(() => {
    if (agentState !== 'done') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void iniciarScan();
    }, INTERVALO_AO_VIVO_MS);
    return () => clearInterval(timer);
  }, [agentState, iniciarScan]);

  useEffect(() => {
    const handlePainelFechado = () => {
      if (agentState === 'done') void iniciarScan();
    };
    window.addEventListener('painel-demandas-fechado', handlePainelFechado);
    return () => window.removeEventListener('painel-demandas-fechado', handlePainelFechado);
  }, [agentState, iniciarScan]);

  const classeCard = voltouParcial ? ' parcial' : '';
  const frasesEmbaralhadas = useMemo(() => {
    const base = voltouParcial ? FRASES_PARCIAL : FRASES_MONITORANDO;
    const comNome = base.map((frase) => substituirPlaceholders(frase, nomeUsuario));
    const inicio = Math.floor(Math.random() * comNome.length);
    return [...comNome.slice(inicio), ...comNome.slice(0, inicio)];
  }, [voltouParcial, nomeUsuario]);

  const sondagemEncontrou = sondagemSilenciosa?.encontrou || false;
  const sondagemQtd = sondagemSilenciosa?.quantidade || 0;
  const fraseSondagem = useMemo(() => {
    if (!sondagemEncontrou || !sondagemQtd) return null;
    const base = FRASES_SONDAGEM_ENCONTROU[
      Math.floor(Math.random() * FRASES_SONDAGEM_ENCONTROU.length)
    ];
    return substituirPlaceholders(base, nomeUsuario, {
      qtd: sondagemQtd,
      item: sondagemQtd === 1 ? 'item' : 'itens',
      m: sondagemQtd === 1 ? '' : 'm',
    });
  }, [sondagemEncontrou, sondagemQtd, nomeUsuario]);

  const fraseMemoria = useMemo(
    () => (memoriaCortes ? construirFraseMemoriaCortes(memoriaCortes, nomeUsuario) : null),
    [memoriaCortes, nomeUsuario],
  );

  const fraseContextual = useMemo(() => {
    if (!cortesEmEstoque || cortesEmEstoque.length === 0) return null;
    const prefixo = nomeUsuario ? `${nomeUsuario}, ` : '';
    const quantidade = cortesEmEstoque.length;
    return `${prefixo}vejo ${quantidade} ${quantidade === 1 ? 'lote' : 'lotes'} no estoque de cortes. Quer que eu verifique se há déficit?`;
  }, [cortesEmEstoque, nomeUsuario]);

  const frasesParaUsar = useMemo(() => {
    if (voltouParcial) return frasesEmbaralhadas;
    if (fraseSondagem) return [fraseSondagem];
    if (fraseMemoria) return [fraseMemoria];
    if (fraseContextual) return [fraseContextual];
    return frasesEmbaralhadas;
  }, [voltouParcial, fraseSondagem, fraseMemoria, fraseContextual, frasesEmbaralhadas]);

  const typewriter = useTypewriter(frasesParaUsar, 38, 3000, false) as {
    texto: string;
    fase: 'typing' | 'waiting' | 'fading';
    completo: boolean;
  };

  const tickerTokens = useMemo(() => {
    const tokens: string[] = [];
    produtos?.slice(0, 12).forEach((produto) => {
      if (produto.grade && produto.grade.length > 0) {
        produto.grade.slice(0, 2).forEach((grade) => {
          tokens.push(`${produto.sku || (produto.nome || '').slice(0, 6).toUpperCase()} · ${grade.variacao || 'PAD'}`);
        });
      } else {
        tokens.push(produto.sku || (produto.nome || '').slice(0, 8).toUpperCase());
      }
    });
    if (tokens.length < 6) {
      tokens.push(
        'ANALISANDO REGISTROS',
        'CRUZANDO TABELAS',
        'VERIFICANDO ESTOQUE',
        'CALCULANDO DÉFICIT',
        'BUSCANDO DEMANDAS',
        'ATUALIZANDO ÍNDICE',
      );
    }
    return tokens;
  }, [produtos]);

  const horaUltimoScan = ultimoScan
    ? ultimoScan.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="op-cortes-agente">
      {agentState === 'idle' && (
        <div className={`op-agente-idle-card${classeCard}`}>
          <div className="op-agente-avatar-wrapper">
            <UIAgenteIA tamanho="lg" scanning={false} />
          </div>
          <div className={`op-agente-waveform${typewriter.completo ? ' pausado' : ''}`}>
            <span /><span /><span /><span /><span />
          </div>
          <div className="op-agente-idle-pensamento">
            <span className={`op-agente-idle-texto${typewriter.fase === 'fading' ? ' fading' : ''}`}>
              {typewriter.texto}
              {(typewriter.fase === 'typing' || typewriter.completo) && (
                <span className="op-agente-idle-cursor">▌</span>
              )}
            </span>
          </div>
          <UIBloqueio permissao="usar-agente-cortes">
            <button className="op-agente-idle-btn" onClick={() => void iniciarScan()}>
              <i className={`fas ${voltouParcial ? 'fa-redo' : 'fa-search'}`}></i>
              {voltouParcial ? 'Verificar pendências' : 'Analisar agora'}
            </button>
          </UIBloqueio>
        </div>
      )}

      {(agentState === 'scanning' || agentState === 'avaliando') && (
        <div className="op-agente-terminal">
          {mensagensVisiveis.map((fase, indice) => (
            <OPAgenteFaseScan
              key={indice}
              fase={fase}
              isCurrent={agentState === 'scanning' && indice === mensagensVisiveis.length - 1}
              isCompleted={indice < mensagensVisiveis.length - 1 || agentState === 'avaliando'}
            />
          ))}

          {agentState === 'scanning' && (
            <div className="op-agente-ticker-wrapper">
              <div className="op-agente-ticker">
                {tickerTokens.join('  ·  ')}
                {'  ·  ' + tickerTokens.join('  ·  ')}
              </div>
            </div>
          )}

          {agentState === 'avaliando' && (
            <div className="op-agente-avaliando">
              <div className="op-agente-avaliando-titulo">
                <i className="fas fa-check-circle"></i>
                Scan completo. Avaliando confiabilidade...
              </div>
              <div className="op-agente-score-wrapper">
                <div className="op-agente-score-label">
                  <span>Confiança da análise</span>
                  <span className="op-agente-score-pct">
                    <ScoreCounter alvo={scoreAlvo} />%
                  </span>
                </div>
                <div className="op-agente-score-barra-bg">
                  <div
                    className="op-agente-score-barra-fill"
                    style={{ width: `${scoreAlvo}%` }}
                  ></div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {agentState === 'done' && (
        <div className="op-cortes-agente-resultado">
          <div className="op-agente-res-header">
            <div className={`op-agente-res-badge${plano.length === 0 ? ' vazio' : ''}`}>
              <i className={`fas ${plano.length === 0 ? 'fa-check-circle' : 'fa-clipboard-list'}`}></i>
              {plano.length === 0
                ? 'Estoque em dia'
                : `${plano.length} ${plano.length === 1 ? 'item' : 'itens'} para cortar`}
            </div>
            {horaUltimoScan && (
              <div className="op-agente-res-ao-vivo">
                <span className="op-cortes-agente-ao-vivo-dot"></span>
                <span>{horaUltimoScan}</span>
              </div>
            )}
            <button
              className="op-agente-res-fechar"
              onClick={resetar}
              title="Fechar agente / novo scan"
              aria-label="Fechar agente"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>

          {plano.length === 0 && (
            <UIFeedbackNotFound
              variante="compacto"
              icon="fa-check-circle"
              titulo="Estoque de cortes em dia"
              mensagem="Todas as demandas pendentes têm corte disponível."
            />
          )}

          {plano.length > 0 && (
            <>
              <div className="op-cortes-agente-plano-header">
                <span className="op-cortes-agente-hint">Clique em &quot;Cortar&quot; para registrar cada lote</span>
              </div>
              <div className="op-cortes-agente-lista">
                {plano.map((item, indice) => {
                  const cobertoParcial = Number(item.pecas_em_estoque || 0) > 0;
                  const variante = item.variante || 'Padrão';
                  return (
                    <div
                      key={`${item.produto_id}-${item.variante || ''}-${indice}`}
                      className={`op-cortes-agente-card ${cobertoParcial ? 'parcial' : ''}`}
                      style={{ '--card-idx': indice } as CSSProperties}
                    >
                      <div className="card-borda-charme"></div>
                      <div className="op-cortes-agente-card-corpo">
                        <img
                          src={item.imagem || '/img/placeholder-image.png'}
                          alt={variante}
                          className="op-cortes-agente-card-img"
                        />
                        <div className="op-cortes-agente-card-info">
                          <span className="op-cortes-agente-card-variante">{variante}</span>
                          <div className="op-cortes-agente-card-deficit">
                            <span className="deficit-falta">{item.deficit} pçs</span>
                            {cobertoParcial && (
                              <span className="deficit-tem">{item.pecas_em_estoque} em estoque</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <UIBloqueio permissao="usar-agente-cortes">
                        <button
                          className="op-cortes-agente-card-btn"
                          onClick={() =>
                            onCortarAgora({
                              produto: item.produtoCompleto,
                              variante: item.variante || null,
                              quantidadeSugerida: item.deficit,
                            })
                          }
                          disabled={!item.produtoCompleto}
                          title={!item.produtoCompleto ? 'Produto não encontrado' : 'Registrar corte para este item'}
                        >
                          <i className="fas fa-bolt"></i>
                          Cortar
                        </button>
                      </UIBloqueio>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
