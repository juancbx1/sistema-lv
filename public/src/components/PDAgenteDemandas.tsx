import { useMemo } from 'react';
import UIAgenteIA from './UIAgenteIA';
import useTypewriter from '../hooks/useTypewriter.js';

type DiagnosticoTipo = 'ok' | 'atencao' | 'urgente';
type FaseTypewriter = 'typing' | 'waiting' | 'fading';

interface DiagnosticoDemandas {
  tipo?: DiagnosticoTipo;
}

interface ContagensPorEstagio {
  AGUARDANDO?: number;
  COSTURA?: number;
  ARREMATE?: number;
  EMBALAGEM?: number;
}

interface PDAgenteDemandasProps {
  diagnostico?: DiagnosticoDemandas | null;
  contagensPorEstagio?: ContagensPorEstagio | null;
  totalUrgentes?: number;
  nomeUsuario?: string | null;
  onRefresh?: () => void | Promise<void>;
  onFiltrarUrgentes?: () => void;
  carregando?: boolean;
}

interface TypewriterResult {
  texto: string;
  fase: FaseTypewriter;
  completo: boolean;
}

const useTypewriterTipado = useTypewriter as unknown as (
  frases: string[],
  velocidade?: number,
  pausaMs?: number,
  loop?: boolean,
) => TypewriterResult;

function sub(frase: string, nome: string | null | undefined): string {
  if (!nome) {
    return frase
      .replace(/\{nome\},\s*/g, '')
      .replace(/,\s*\{nome\}/g, '')
      .replace(/\{nome\}\s*/g, '');
  }
  return frase.replace(/\{nome\}/g, nome);
}

function construirFrasesOk(nome: string | null | undefined): string[] {
  return [
    sub('Pipeline limpo, {nome}. Nenhuma demanda aguardando início.', nome),
    sub('Tudo em ordem — sem pendências no momento.', nome),
    sub('{nome}, está tudo fluindo bem. Continuo monitorando.', nome),
    sub('Nenhuma ação necessária agora. O pipeline está limpo.', nome),
  ];
}

function construirFrasesAtencao(
  contagens: ContagensPorEstagio | null | undefined,
  nome: string | null | undefined,
): string[] {
  const ag = contagens?.AGUARDANDO || 0;
  const cost = contagens?.COSTURA || 0;
  const arr = contagens?.ARREMATE || 0;
  const frases: string[] = [];

  if (ag > 0 && cost > 0) {
    frases.push(sub(`{nome}, pipeline ativo: ${ag} aguardando, ${cost} em costura.`, nome));
  }
  if (ag > 0) {
    frases.push(sub(`{nome}, ${ag} demanda${ag > 1 ? 's' : ''} aguardando início. Quer analisar prioridades?`, nome));
    frases.push(sub(`Há ${ag} item${ag > 1 ? 'ns' : ''} parado${ag > 1 ? 's' : ''} no pipeline, {nome}. Posso ajudar a priorizar.`, nome));
  }
  if (cost > 0) {
    frases.push(sub(`${cost} demanda${cost > 1 ? 's' : ''} em costura. Estou acompanhando o andamento.`, nome));
  }
  if (arr > 0) {
    frases.push(sub(`${arr} demanda${arr > 1 ? 's' : ''} prontas para arremate, {nome}.`, nome));
  }
  if (frases.length === 0) frases.push(sub('Pipeline em andamento, {nome}. Monitorando os estágios.', nome));
  return frases;
}

function construirFrasesUrgente(totalUrgentes: number | undefined, nome: string | null | undefined): string[] {
  const quantidade = totalUrgentes || 1;
  return [
    sub(`{nome}, atenção! ${quantidade} demanda${quantidade > 1 ? 's' : ''} prioritária${quantidade > 1 ? 's' : ''} exige${quantidade > 1 ? 'm' : ''} ação imediata.`, nome),
    sub(`Prioridade máxima detectada, {nome}. Não posso ignorar isso.`, nome),
    sub(`${quantidade} item${quantidade > 1 ? 'ns' : ''} urgente${quantidade > 1 ? 's' : ''} parado${quantidade > 1 ? 's' : ''} no pipeline. Aja agora, {nome}.`, nome),
    sub(`Alerta! ${quantidade} demanda${quantidade > 1 ? 's' : ''} urgente${quantidade > 1 ? 's' : ''} sem início de produção.`, nome),
  ];
}

export default function PDAgenteDemandas({
  diagnostico,
  contagensPorEstagio,
  totalUrgentes,
  nomeUsuario,
  onRefresh,
  onFiltrarUrgentes,
  carregando = false,
}: PDAgenteDemandasProps) {
  const tipo = diagnostico?.tipo || 'ok';
  const classeEstado = tipo === 'urgente' ? ' alerta' : tipo === 'atencao' ? ' parcial' : '';

  const frases = useMemo(() => {
    let base: string[];
    if (tipo === 'urgente') base = construirFrasesUrgente(totalUrgentes, nomeUsuario);
    else if (tipo === 'atencao') base = construirFrasesAtencao(contagensPorEstagio, nomeUsuario);
    else base = construirFrasesOk(nomeUsuario);

    const inicio = Math.floor(Math.random() * base.length);
    return [...base.slice(inicio), ...base.slice(0, inicio)];
    // As contagens só mudam a lista quando o tipo do diagnóstico muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, totalUrgentes, nomeUsuario]);

  const { texto, fase, completo } = useTypewriterTipado(frases, 42, 0, false);
  const mostrarBotao = tipo !== 'ok';

  const handleBotao = () => {
    if (carregando) return;
    if (tipo === 'urgente') onFiltrarUrgentes?.();
    else void onRefresh?.();
  };

  const iconeBotao = carregando ? 'fa-circle-notch fa-spin' : tipo === 'urgente' ? 'fa-bolt' : 'fa-search';
  const textoBotao = tipo === 'urgente' ? 'Ver demandas urgentes' : 'Analisar prioridades';

  return (
    <div className="pd-agente-bloco">
      <div className={`pd-agente-idle-card${classeEstado}`}>
        <div className="pd-agente-avatar-wrapper">
          <UIAgenteIA tamanho="lg" scanning={false} />
        </div>
        <div className={`pd-agente-waveform${completo && tipo === 'ok' ? ' pausado' : ''}`}>
          <span /><span /><span /><span /><span />
        </div>
        <div className="pd-agente-idle-pensamento">
          <span className={`pd-agente-idle-texto${fase === 'fading' ? ' fading' : ''}`}>
            {texto}
            {(fase === 'typing' || completo) && <span className="pd-agente-idle-cursor">▮</span>}
          </span>
        </div>
        {mostrarBotao && (
          <button className="pd-agente-idle-btn" onClick={handleBotao} disabled={carregando}>
            <i className={`fas ${iconeBotao}`}></i>
            {textoBotao}
          </button>
        )}
      </div>
    </div>
  );
}
