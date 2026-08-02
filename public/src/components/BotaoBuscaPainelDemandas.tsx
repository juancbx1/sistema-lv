import {
  type CSSProperties,
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
// @ts-expect-error utilitario JS legado sem declaracao TypeScript
import { mostrarMensagem } from '/js/utils/popups.js';
import BotaoBuscaModalAddDemanda from './BotaoBuscaModalAddDemanda.tsx';
import PainelDemandaCard from './BotaoBuscaPipelineProducao.tsx';
import BotaoBuscaModalConcluidas from './BotaoBuscaModalConcluidas.tsx';
// @ts-expect-error utilitario JS legado sem declaracao TypeScript
import { calcularStatusDemanda, STATUS_META } from '/src/utils/demandaStatus.js';
import { LoaderIA } from './UIAgenteIA';
import type { LoaderIAFase, LoaderIAMensagemFinal } from './UIAgenteIA';
import UICarregando from './UICarregando';
import PDAgenteDemandas from './PDAgenteDemandas.tsx';
import type { OpInicioProducaoDados } from '../utils/op-types';

type DemandaStatus = 'AGUARDANDO' | 'COSTURA' | 'ARREMATE' | 'EMBALAGEM';
type FiltroStatus = DemandaStatus | null;
type SubfiltroCorte = 'TODOS' | 'COM_CORTE' | 'SEM_CORTE';

interface DemandaAgregada {
  demanda_id: number;
  produto_id: number;
  variante?: string | null;
  prioridade?: number | string | null;
  produto_nome?: string | null;
  produto_sku?: string | null;
  imagem?: string | null;
  data_solicitacao?: string | null;
  corte_cortado?: number | string | null;
  corte_pendente?: number | string | null;
  [key: string]: unknown;
}

interface Pill {
  id: DemandaStatus;
  label: string;
  icone: string;
  cor: string;
}

interface Diagnostico {
  tipo: 'ok' | 'urgente' | 'atencao';
  icone: string;
  texto: string;
}

interface SecaoEstagio {
  id: DemandaStatus;
  label: string;
  icone: string;
  cor: string;
  items: DemandaAgregada[];
}

interface PainelDemandasProps {
  onIniciarProducao: (dados: OpInicioProducaoDados) => void;
  permissoes?: string[];
  onClose: () => void;
}

interface SecaoEstagioProps {
  secao: SecaoEstagio;
  expandido: boolean;
  onExpandir: () => void;
  onDelete: (demandaId: number) => void | Promise<void>;
  permissoes: string[];
  onRefresh: () => void | Promise<void>;
  onIniciarProducao: (dados: OpInicioProducaoDados) => void;
}

interface ModalAdicionarDemandaProps {
  onClose: () => void;
  onDemandaCriada: () => void | Promise<void>;
}

interface ModalConcluidasProps {
  isOpen: boolean;
  onClose: () => void;
}

const ModalAdicionarDemanda = BotaoBuscaModalAddDemanda as unknown as ComponentType<ModalAdicionarDemandaProps>;
const ModalConcluidas = BotaoBuscaModalConcluidas as unknown as ComponentType<ModalConcluidasProps>;

const normalizarTexto = (texto: string | null | undefined): string =>
  texto ? texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : '';

const FASES_CHATBOT: LoaderIAFase[] = [
  { texto: 'Conectando ao pipeline de produção...' },
  { texto: 'Lendo demandas em andamento...' },
  { texto: 'Analisando estágios do fluxo...' },
];

const PILLS: Pill[] = [
  { id: 'AGUARDANDO', label: 'Aguardando', icone: 'fa-hourglass-start', cor: '#e74c3c' },
  { id: 'COSTURA', label: 'Costura', icone: 'fa-cut', cor: '#3498db' },
  { id: 'ARREMATE', label: 'Arremate', icone: 'fa-clipboard-check', cor: '#8e44ad' },
  { id: 'EMBALAGEM', label: 'Embalagem', icone: 'fa-box-open', cor: '#e67e22' },
];

const ITENS_INICIAIS = 6;

function numero(valor: unknown): number {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}

function listaDiagnostico(data: unknown): DemandaAgregada[] {
  if (!data || typeof data !== 'object') return [];
  const lista = (data as { diagnosticoAgregado?: unknown }).diagnosticoAgregado;
  return Array.isArray(lista) ? lista as DemandaAgregada[] : [];
}

function mensagemDoErro(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function calcularDiagnostico(demandas: DemandaAgregada[]): Diagnostico {
  let urgentes = 0;
  let aguardando = 0;
  let totalAtivos = 0;

  demandas.forEach((item) => {
    const status = calcularStatusDemanda(item) as string;
    if (status === 'CONCLUIDO' || status === 'DIVERGENCIA') return;
    totalAtivos += 1;
    if (status === 'AGUARDANDO') {
      if (numero(item.prioridade) === 1) urgentes += 1;
      else aguardando += 1;
    }
  });

  if (totalAtivos === 0) {
    return {
      tipo: 'ok',
      icone: 'fa-check-circle',
      texto: 'Pipeline limpo — nenhuma demanda aguardando.',
    };
  }
  if (urgentes > 0) {
    return {
      tipo: 'urgente',
      icone: 'fa-exclamation-circle',
      texto: `${urgentes} demanda${urgentes > 1 ? 's' : ''} prioritária${urgentes > 1 ? 's' : ''} aguardando ação imediata.`,
    };
  }
  if (aguardando > 0) {
    return {
      tipo: 'atencao',
      icone: 'fa-tasks',
      texto: `${aguardando} demanda${aguardando > 1 ? 's' : ''} aguardando para iniciar produção.`,
    };
  }
  return {
    tipo: 'ok',
    icone: 'fa-check-double',
    texto: `Tudo em andamento — ${totalAtivos} demanda${totalAtivos > 1 ? 's' : ''} no pipeline.`,
  };
}

function extrairPrimeiroNome(): string | null {
  try {
    const token = localStorage.getItem('token');
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1])) as { nome?: string };
    return (payload.nome || '').split(' ')[0] || null;
  } catch {
    return null;
  }
}

export default function PainelDemandas({
  onIniciarProducao,
  permissoes = [],
  onClose,
}: PainelDemandasProps) {
  const nomeUsuario = extrairPrimeiroNome();
  const [demandasAgregadas, setDemandasAgregadas] = useState<DemandaAgregada[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [recarregando, setRecarregando] = useState(false);
  const [chatbotFase, setChatbotFase] = useState(0);
  const [mensagemFinal, setMensagemFinal] = useState<LoaderIAMensagemFinal | null>(null);
  const [ultimaAtt, setUltimaAtt] = useState<Date | null>(null);
  const [modalAddAberto, setModalAddAberto] = useState(false);
  const [modalHistoricoAberto, setModalHistoricoAberto] = useState(false);
  const [termoBusca, setTermoBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('AGUARDANDO');
  const [filtroPrioridade, setFiltroPrioridade] = useState(false);
  const [subfiltroCorte, setSubfiltroCorte] = useState<SubfiltroCorte>('TODOS');
  const [pendentesArquivamento, setPendentesArquivamento] = useState(0);
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({});
  const [tempoTexto, setTempoTexto] = useState('—');
  const timersRef = useRef<number[]>([]);

  const fetchDiagnostico = useCallback(async (silencioso = false) => {
    if (!silencioso) {
      setCarregando(true);
      setChatbotFase(0);
      setMensagemFinal(null);

      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];

      const t1 = window.setTimeout(() => setChatbotFase(1), 500);
      const t2 = window.setTimeout(() => setChatbotFase(2), 1000);
      timersRef.current = [t1, t2];
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/demandas/diagnostico-completo', {
        headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) throw new Error('Falha ao buscar diagnóstico.');
      const lista = listaDiagnostico(await res.json());

      setDemandasAgregadas(lista);
      setUltimaAtt(new Date());
      setPendentesArquivamento(lista.filter((item) => {
        const status = calcularStatusDemanda(item) as string;
        return status === 'CONCLUIDO' || status === 'DIVERGENCIA';
      }).length);

      if (!silencioso) {
        const diagnostico = calcularDiagnostico(lista);
        const t3 = window.setTimeout(() => {
          setMensagemFinal(diagnostico);
          setChatbotFase(FASES_CHATBOT.length);
          const t4 = window.setTimeout(() => setCarregando(false), 700);
          timersRef.current.push(t4);
        }, 2200);
        timersRef.current.push(t3);
      }
    } catch (error) {
      console.error('[PainelDemandas]', error);
      mostrarMensagem(mensagemDoErro(error), 'erro');
      if (!silencioso) setCarregando(false);
    }
  }, []);

  const fetchParcial = useCallback(async () => {
    setRecarregando(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/demandas/diagnostico-completo', {
        headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) throw new Error('Falha ao buscar diagnóstico.');
      const lista = listaDiagnostico(await res.json());
      setDemandasAgregadas(lista);
      setUltimaAtt(new Date());
      setPendentesArquivamento(lista.filter((item) => {
        const status = calcularStatusDemanda(item) as string;
        return status === 'CONCLUIDO' || status === 'DIVERGENCIA';
      }).length);
    } catch (error) {
      console.error('[PainelDemandas] fetchParcial:', error);
      mostrarMensagem(mensagemDoErro(error), 'erro');
    } finally {
      setRecarregando(false);
    }
  }, []);

  useEffect(() => {
    void fetchDiagnostico();
    return () => timersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, [fetchDiagnostico]);

  useEffect(() => {
    const atualizar = () => {
      if (!ultimaAtt) {
        setTempoTexto('—');
        return;
      }
      const diff = Math.floor((Date.now() - ultimaAtt.getTime()) / 60000);
      setTempoTexto(diff === 0 ? 'agora' : `há ${diff} min`);
    };
    atualizar();
    const id = window.setInterval(atualizar, 30000);
    return () => window.clearInterval(id);
  }, [ultimaAtt]);

  const { pendentes, concluidas } = useMemo(() => {
    const pendentesLocais: DemandaAgregada[] = [];
    const concluidasLocais: DemandaAgregada[] = [];
    const vistas = new Set<string>();
    const unica: DemandaAgregada[] = [];

    demandasAgregadas.forEach((item) => {
      const chave = `${item.demanda_id}-${item.produto_id}-${item.variante || 'padrao'}`;
      if (!vistas.has(chave)) {
        vistas.add(chave);
        unica.push(item);
      }
    });
    unica.sort((a, b) => numero(a.prioridade) - numero(b.prioridade) || a.demanda_id - b.demanda_id);
    unica.forEach((item) => {
      const status = calcularStatusDemanda(item) as string;
      if (status === 'CONCLUIDO' || status === 'DIVERGENCIA') concluidasLocais.push(item);
      else pendentesLocais.push(item);
    });
    return { pendentes: pendentesLocais, concluidas: concluidasLocais };
  }, [demandasAgregadas]);

  const contagensPorEstagio = useMemo<Record<DemandaStatus, number>>(() => {
    const contagens: Record<DemandaStatus, number> = {
      AGUARDANDO: 0,
      COSTURA: 0,
      ARREMATE: 0,
      EMBALAGEM: 0,
    };
    pendentes.forEach((item) => {
      const status = calcularStatusDemanda(item) as DemandaStatus;
      if (status in contagens) contagens[status] += 1;
    });
    return contagens;
  }, [pendentes]);

  const totalUrgentes = useMemo(
    () => pendentes.filter((item) =>
      calcularStatusDemanda(item) === 'AGUARDANDO' && numero(item.prioridade) === 1,
    ).length,
    [pendentes],
  );

  const diagnostico = useMemo(() => calcularDiagnostico(demandasAgregadas), [demandasAgregadas]);
  const termoLimpo = normalizarTexto(termoBusca);

  const filtrarItem = useCallback((item: DemandaAgregada, estagio: DemandaStatus) => {
    if (filtroPrioridade && numero(item.prioridade) !== 1) return false;
    if (estagio === 'AGUARDANDO' && subfiltroCorte !== 'TODOS') {
      const temCorte = numero(item.corte_cortado) + numero(item.corte_pendente) > 0;
      if (subfiltroCorte === 'COM_CORTE' && !temCorte) return false;
      if (subfiltroCorte === 'SEM_CORTE' && temCorte) return false;
    }
    if (!termoLimpo) return true;
    const textoItem = normalizarTexto(
      [item.produto_nome, item.variante, item.produto_sku].filter(Boolean).join(' '),
    );
    return termoLimpo.split(/\s+/).filter(Boolean).every((palavra) => textoItem.includes(palavra));
  }, [filtroPrioridade, subfiltroCorte, termoLimpo]);

  const contagensCorte = useMemo(() => {
    const aguardando = pendentes.filter((item) => calcularStatusDemanda(item) === 'AGUARDANDO');
    const comCorte = aguardando.filter((item) =>
      numero(item.corte_cortado) + numero(item.corte_pendente) > 0,
    ).length;
    return { total: aguardando.length, comCorte, semCorte: aguardando.length - comCorte };
  }, [pendentes]);

  const secoesVisiveis = useMemo<SecaoEstagio[]>(() => PILLS
    .filter((pill) => filtroStatus === null || filtroStatus === pill.id)
    .map((pill) => ({
      ...pill,
      items: pendentes.filter((item) =>
        calcularStatusDemanda(item) === pill.id && filtrarItem(item, pill.id),
      ),
    }))
    .filter((secao) => secao.items.length > 0), [pendentes, filtroStatus, filtrarItem]);

  const handleDeleteDemanda = async (demandaId: number) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/demandas/${demandaId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Falha ao deletar.');
      mostrarMensagem('Demanda apagada.', 'sucesso');
      await fetchDiagnostico(true);
    } catch (error) {
      mostrarMensagem(mensagemDoErro(error), 'erro');
    }
  };

  const handleFiltrarUrgentes = () => {
    setFiltroStatus('AGUARDANDO');
    setFiltroPrioridade(true);
  };

  // Mantido para preservar o contrato visual e evitar reintroduzir um filtro duplicado.
  void concluidas;

  return (
    <>
      <div className="pd-header">
        <span className="pd-header-label">Painel de Demandas</span>

        <button
          className="pd-btn-historico"
          onClick={() => setModalHistoricoAberto(true)}
          title="Histórico de demandas concluídas"
        >
          <i className="fas fa-history"></i>
          {pendentesArquivamento > 0 && (
            <span className="pd-historico-badge">{pendentesArquivamento}</span>
          )}
        </button>

        <button
          className={`pd-btn-refresh${carregando ? ' carregando' : ''}`}
          onClick={() => void fetchDiagnostico(false)}
          disabled={carregando}
          title={`Atualizar — ${tempoTexto}`}
        >
          <i className="fas fa-sync-alt pd-btn-refresh-icone"></i>
        </button>

        <button className="pd-btn-nova" onClick={() => setModalAddAberto(true)}>
          <i className="fas fa-plus"></i>
          Nova
        </button>

        <button className="pd-btn-fechar" onClick={onClose} title="Fechar">
          <i className="fas fa-times"></i>
        </button>
      </div>

      {carregando ? (
        <div className="pd-loader-centrado">
          <LoaderIA fases={FASES_CHATBOT} faseAtual={chatbotFase} mensagemFinal={mensagemFinal} />
        </div>
      ) : (
        <>
          <div className="pd-summary-bar">
            {PILLS.map((pill) => {
              const count = contagensPorEstagio[pill.id] || 0;
              const ativo = filtroStatus === pill.id;
              return (
                <button
                  key={pill.id}
                  className={`pd-summary-pill${ativo ? ' ativo' : ''}${pill.id === 'AGUARDANDO' ? ' aguardando' : ''}`}
                  style={{ '--pd-pill-cor': pill.cor } as CSSProperties}
                  onClick={() => {
                    const novoStatus: FiltroStatus = ativo ? null : pill.id;
                    setFiltroStatus(novoStatus);
                    if (novoStatus !== 'AGUARDANDO') setSubfiltroCorte('TODOS');
                  }}
                >
                  <i className={`fas ${pill.icone}`}></i>
                  {pill.label}
                  <span className="pd-summary-pill-count">{count}</span>
                </button>
              );
            })}
            <button
              className={`pd-summary-pill${filtroPrioridade ? ' ativo' : ''}`}
              style={{ '--pd-pill-cor': '#e74c3c' } as CSSProperties}
              onClick={() => setFiltroPrioridade((filtro) => !filtro)}
            >
              <i className="fas fa-star"></i>
              Urgentes
            </button>
          </div>

          {filtroStatus === 'AGUARDANDO' && contagensCorte.total > 0 && (
            <div className="pd-subfiltro-corte">
              <button
                className={`pd-subfiltro-chip${subfiltroCorte === 'TODOS' ? ' ativo' : ''}`}
                onClick={() => setSubfiltroCorte('TODOS')}
              >
                Todos <span className="pd-subfiltro-chip-count">{contagensCorte.total}</span>
              </button>
              <button
                className={`pd-subfiltro-chip com-corte${subfiltroCorte === 'COM_CORTE' ? ' ativo' : ''}`}
                onClick={() => setSubfiltroCorte(subfiltroCorte === 'COM_CORTE' ? 'TODOS' : 'COM_CORTE')}
                title="Demandas que já têm corte registrado"
              >
                <i className="fas fa-cut"></i> Com corte
                <span className="pd-subfiltro-chip-count">{contagensCorte.comCorte}</span>
              </button>
              <button
                className={`pd-subfiltro-chip sem-corte${subfiltroCorte === 'SEM_CORTE' ? ' ativo' : ''}`}
                onClick={() => setSubfiltroCorte(subfiltroCorte === 'SEM_CORTE' ? 'TODOS' : 'SEM_CORTE')}
                title="Demandas sem nenhum corte registrado"
              >
                <i className="fas fa-scissors"></i> Sem corte
                <span className="pd-subfiltro-chip-count">{contagensCorte.semCorte}</span>
              </button>
            </div>
          )}

          <div className="pd-busca-outer">
            <div className="pd-busca-wrapper">
              <i className="fas fa-search pd-busca-icone"></i>
              <input
                type="text"
                className={`pd-busca-input${termoBusca ? ' com-limpar' : ''}`}
                placeholder="Buscar produto..."
                value={termoBusca}
                onChange={(event) => setTermoBusca(event.target.value)}
              />
              {termoBusca && (
                <button
                  type="button"
                  className="pd-busca-limpar"
                  onClick={() => setTermoBusca('')}
                  tabIndex={-1}
                >
                  <i className="fas fa-times"></i>
                </button>
              )}
            </div>
          </div>

          <PDAgenteDemandas
            diagnostico={diagnostico}
            contagensPorEstagio={contagensPorEstagio}
            totalUrgentes={totalUrgentes}
            nomeUsuario={nomeUsuario}
            onRefresh={fetchParcial}
            onFiltrarUrgentes={handleFiltrarUrgentes}
            carregando={recarregando}
          />

          <div className="pd-body">
            {recarregando ? (
              <UICarregando variante="bloco" texto="Atualizando pipeline..." />
            ) : secoesVisiveis.length === 0 ? (
              <div className="pd-vazio">
                <i className="fas fa-search"></i>
                <div className="pd-vazio-titulo">Nenhuma demanda encontrada</div>
                <div className="pd-vazio-sub">
                  {termoBusca || filtroPrioridade ? 'Tente ajustar os filtros.' : 'Tudo em dia!'}
                </div>
              </div>
            ) : (
              secoesVisiveis.map((secao) => (
                <SecaoEstagio
                  key={secao.id}
                  secao={secao}
                  expandido={!!expandidos[secao.id]}
                  onExpandir={() => setExpandidos((estado) => ({ ...estado, [secao.id]: !estado[secao.id] }))}
                  onDelete={handleDeleteDemanda}
                  permissoes={permissoes}
                  onRefresh={() => fetchDiagnostico(true)}
                  onIniciarProducao={onIniciarProducao}
                />
              ))
            )}
          </div>
        </>
      )}

      {modalAddAberto && (
        <ModalAdicionarDemanda
          onClose={() => setModalAddAberto(false)}
          onDemandaCriada={() => fetchDiagnostico(true)}
        />
      )}
      <ModalConcluidas
        isOpen={modalHistoricoAberto}
        onClose={() => setModalHistoricoAberto(false)}
      />
    </>
  );
}

function SecaoEstagio({
  secao,
  expandido,
  onExpandir,
  onDelete,
  permissoes,
  onRefresh,
  onIniciarProducao,
}: SecaoEstagioProps) {
  const visiveis = expandido ? secao.items : secao.items.slice(0, ITENS_INICIAIS);
  const restantes = secao.items.length - ITENS_INICIAIS;
  const iconeMap: Record<DemandaStatus, string> = {
    AGUARDANDO: 'fa-hourglass-start',
    COSTURA: 'fa-cut',
    ARREMATE: 'fa-clipboard-check',
    EMBALAGEM: 'fa-box-open',
  };
  const subtituloMap: Record<DemandaStatus, string> = {
    AGUARDANDO: 'aguardando início de produção',
    COSTURA: 'em costura',
    ARREMATE: 'prontos para arremate',
    EMBALAGEM: 'prontos para embalar',
  };

  return (
    <div className="pd-secao">
      <div className={`pd-secao-header ${secao.id.toLowerCase()}`}>
        <i className={`fas ${iconeMap[secao.id]} pd-secao-icone`}></i>
        <span className="pd-secao-titulo">
          {secao.label}
          <span className="pd-secao-subtitulo"> — {subtituloMap[secao.id]}</span>
        </span>
        <span className="pd-secao-count">{secao.items.length}</span>
      </div>

      <div className="pd-grid">
        {visiveis.map((item) => {
          const chave = `${item.demanda_id}-${item.produto_id}-${item.variante || 'padrao'}`;
          return (
            <PainelDemandaCard
              key={chave}
              item={item}
              onDelete={() => onDelete(item.demanda_id)}
              permissoes={permissoes}
              onRefresh={onRefresh}
              onIniciarProducao={onIniciarProducao}
            />
          );
        })}
      </div>

      {!expandido && restantes > 0 && (
        <button className="pd-ver-mais" onClick={onExpandir}>
          <i className="fas fa-chevron-down"></i>
          Ver mais {restantes} demanda{restantes !== 1 ? 's' : ''}
        </button>
      )}
      {expandido && secao.items.length > ITENS_INICIAIS && (
        <button className="pd-ver-mais" onClick={onExpandir}>
          <i className="fas fa-chevron-up"></i>
          Recolher
        </button>
      )}
    </div>
  );
}
