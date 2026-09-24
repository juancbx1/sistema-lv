import { useEffect, useMemo, useRef, useState } from 'react';
import useOPMonitoramento from '../hooks/useOPMonitoramento';
import {
  adiarMonitoramentoOps,
  finalizarOpsMonitoradas,
  registrarImpedimentoOp,
  resolverImpedimentoOp,
} from '../utils/op-monitoramento-api';
import type { OPMonitoramentoItem } from '../utils/op-monitoramento-types';
import OPMonitoramentoFinalizacao from './OPMonitoramentoFinalizacao';
import OPMonitoramentoLista from './OPMonitoramentoLista';
import UICarregando from './UICarregando';
import '../../css/monitoramento-ops.css';

interface Props {
  modo?: 'drawer' | 'inline';
  obrigatorio?: boolean;
  onClose?: () => void;
}

function itensObrigatorios(ops: OPMonitoramentoItem[]) {
  return ops.filter((op) => (
    !op.impedimento && (op.faixa === 'OBRIGATORIA' || op.faixa === 'CRITICA')
  ));
}

export default function OPMonitoramentoPainel({
  modo = 'drawer',
  obrigatorio = false,
  onClose,
}: Props) {
  const { dados, carregando, atualizando, erro, atualizar } = useOPMonitoramento();
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [opImpedimento, setOpImpedimento] = useState<OPMonitoramentoItem | null>(null);
  const [motivo, setMotivo] = useState('');
  const [expandido, setExpandido] = useState(modo !== 'inline');
  const painelRef = useRef<HTMLElement>(null);

  const opsObrigatorias = useMemo(() => itensObrigatorios(dados?.ops || []), [dados?.ops]);
  const opsSelecionadas = useMemo(
    () => (dados?.ops || []).filter((op) => selecionadas.has(op.id) && !op.impedimento),
    [dados?.ops, selecionadas],
  );

  useEffect(() => {
    if (!dados) return;
    setSelecionadas((atuais) => {
      const idsValidos = new Set(dados.ops.filter((op) => !op.impedimento).map((op) => op.id));
      const preservadas = new Set([...atuais].filter((id) => idsValidos.has(id)));
      if (preservadas.size > 0) return preservadas;
      return new Set((obrigatorio ? itensObrigatorios(dados.ops) : dados.ops.filter((op) => !op.impedimento)).map((op) => op.id));
    });
  }, [dados, obrigatorio]);

  useEffect(() => {
    if (modo !== 'drawer') return undefined;
    document.body.classList.add('opm-painel-aberto');
    if (obrigatorio) document.body.classList.add('opm-obrigatorio-ativo');
    const painel = painelRef.current;
    const focaveis = () => Array.from(
      painel?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [],
    );
    const teclado = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!obrigatorio) onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const itens = focaveis();
      if (itens.length === 0) return;
      const primeiro = itens[0];
      const ultimo = itens[itens.length - 1];
      if (event.shiftKey && document.activeElement === primeiro) {
        event.preventDefault();
        ultimo.focus();
      } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener('keydown', teclado);
    window.setTimeout(() => focaveis()[0]?.focus(), 0);
    return () => {
      document.body.classList.remove('opm-painel-aberto', 'opm-obrigatorio-ativo');
      document.removeEventListener('keydown', teclado);
    };
  }, [modo, obrigatorio, onClose]);

  useEffect(() => {
    if (!confirmando) return undefined;
    const timer = window.setTimeout(() => {
      painelRef.current?.querySelector<HTMLElement>('.opm-confirmacao button:not(:disabled)')?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [confirmando]);

  const alternarSelecao = (opId: number) => {
    setSelecionadas((atuais) => {
      const proximas = new Set(atuais);
      if (proximas.has(opId)) proximas.delete(opId);
      else proximas.add(opId);
      return proximas;
    });
  };

  const finalizar = async () => {
    if (opsSelecionadas.length === 0) return;
    setExecutando(true);
    setFeedback(null);
    try {
      const resultado = await finalizarOpsMonitoradas(opsSelecionadas.map((op) => op.id));
      const mensagem = resultado.erro > 0
        ? `${resultado.sucesso} finalizadas; ${resultado.erro} permanecem para revisão.`
        : `${resultado.sucesso} ${resultado.sucesso === 1 ? 'OP finalizada' : 'OPs finalizadas'} com sucesso.`;
      setFeedback(mensagem);
      setConfirmando(false);
      setSelecionadas(new Set());
      window.dispatchEvent(new CustomEvent('op-encerrada'));
      await atualizar();
    } catch (errorFinalizacao) {
      setFeedback(errorFinalizacao instanceof Error ? errorFinalizacao.message : 'Não foi possível finalizar as OPs.');
    } finally {
      setExecutando(false);
    }
  };

  const registrarImpedimento = async () => {
    if (!opImpedimento || motivo.trim().length < 10) return;
    setExecutando(true);
    setFeedback(null);
    try {
      await registrarImpedimentoOp(opImpedimento.id, motivo.trim());
      setOpImpedimento(null);
      setMotivo('');
      setFeedback(`Impedimento da OP #${opImpedimento.numero} registrado.`);
      await atualizar();
    } catch (errorImpedimento) {
      setFeedback(errorImpedimento instanceof Error ? errorImpedimento.message : 'Não foi possível registrar o impedimento.');
    } finally {
      setExecutando(false);
    }
  };

  const resolverImpedimento = async (op: OPMonitoramentoItem) => {
    if (!op.impedimento || executando) return;
    setExecutando(true);
    setFeedback(null);
    try {
      await resolverImpedimentoOp(op.impedimento.id);
      setFeedback(`Impedimento da OP #${op.numero} resolvido. A OP voltou para análise.`);
      await atualizar();
    } catch (errorResolucao) {
      setFeedback(errorResolucao instanceof Error ? errorResolucao.message : 'Não foi possível resolver o impedimento.');
    } finally {
      setExecutando(false);
    }
  };

  const adiar = async () => {
    setExecutando(true);
    setFeedback(null);
    try {
      const resultado = await adiarMonitoramentoOps();
      const horario = new Date(resultado.vence_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      setFeedback(`Revisão adiada até ${horario}.`);
      await atualizar();
    } catch (errorAdiamento) {
      setFeedback(errorAdiamento instanceof Error ? errorAdiamento.message : 'Não foi possível adiar a revisão.');
    } finally {
      setExecutando(false);
    }
  };

  if (dados && !dados.persistencia_disponivel) return null;

  const conteudo = (
    <section
      ref={painelRef}
      className={`opm-painel opm-painel--${modo}${obrigatorio ? ' opm-painel--obrigatorio' : ''}`}
      role={modo === 'drawer' ? 'dialog' : 'region'}
      aria-modal={modo === 'drawer' ? 'true' : undefined}
      aria-labelledby="opm-titulo"
    >
      {confirmando ? (
        <OPMonitoramentoFinalizacao
          ops={opsSelecionadas}
          executando={executando}
          obrigatorio={obrigatorio}
          onVoltar={() => setConfirmando(false)}
          onConfirmar={() => void finalizar()}
        />
      ) : (
        <>
          <header className="opm-header">
            <div className="opm-header-icone"><i className="fas fa-tower-broadcast" aria-hidden="true" /></div>
            <div>
              <p className="opm-eyebrow">Produção em acompanhamento</p>
              <h2 id="opm-titulo">Monitor de OPs</h2>
              <p>{obrigatorio ? 'Existem ordens que precisam de uma decisão agora.' : 'Acompanhe e resolva o encerramento das ordens em um só lugar.'}</p>
            </div>
            {modo === 'inline' && (
              <button
                className="opm-acordeon"
                type="button"
                aria-expanded={expandido}
                aria-label={expandido ? 'Recolher Monitor de OPs' : 'Expandir Monitor de OPs'}
                onClick={() => setExpandido((aberto) => !aberto)}
              >
                <i className={`fas fa-chevron-${expandido ? 'up' : 'down'}`} aria-hidden="true" />
              </button>
            )}
            {modo === 'drawer' && !obrigatorio && (
              <button className="opm-fechar" type="button" onClick={onClose} aria-label="Fechar Monitor de OPs">
                <i className="fas fa-times" aria-hidden="true" />
              </button>
            )}
          </header>

          {expandido && obrigatorio && (
            <div className="opm-obrigatorio-aviso" role="alert">
              <i className="fas fa-shield-halved" aria-hidden="true" />
              <div>
                <strong>Revisão obrigatória</strong>
                <p>Finalize cada OP ou registre o motivo que impede o encerramento. Sair da página não elimina a pendência.</p>
              </div>
            </div>
          )}

          {expandido && carregando && <div className="opm-carregando"><UICarregando variante="bloco" texto="Atualizando ordens..." /></div>}
          {expandido && erro && !dados && (
            <div className="opm-erro">
              <i className="fas fa-wifi" aria-hidden="true" />
              <p>{erro}</p>
              <button type="button" onClick={() => void atualizar()}>Tentar novamente</button>
            </div>
          )}

          {expandido && dados && (
            <>
              <div className="opm-resumo" aria-label="Resumo do monitoramento">
                <div><span>Total</span><strong>{dados.resumo.total}</strong></div>
                <div className="opm-resumo--atencao"><span>Atenção</span><strong>{dados.resumo.atencao}</strong></div>
                <div className="opm-resumo--obrigatoria"><span>Obrigatórias</span><strong>{dados.resumo.obrigatorias}</strong></div>
                <div className="opm-resumo--critica"><span>Críticas</span><strong>{dados.resumo.criticas}</strong></div>
                <button type="button" onClick={() => void atualizar()} disabled={atualizando} aria-label="Atualizar monitoramento">
                  <i className={`fas fa-rotate${atualizando ? ' fa-spin' : ''}`} aria-hidden="true" />
                </button>
              </div>

              {feedback && <div className="opm-feedback" role="status">{feedback}</div>}

              <OPMonitoramentoLista
                ops={dados.ops}
                selecionadas={selecionadas}
                podeFinalizar={dados.pode_finalizar}
                onSelecionar={alternarSelecao}
                onSelecionarTodas={() => setSelecionadas(new Set(dados.ops.filter((op) => !op.impedimento).map((op) => op.id)))}
                onLimparSelecao={() => setSelecionadas(new Set())}
                onImpedimento={(op) => { setOpImpedimento(op); setMotivo(''); setFeedback(null); }}
                onResolverImpedimento={(op) => void resolverImpedimento(op)}
              />

              {opImpedimento && (
                <div className="opm-motivo" role="dialog" aria-modal="true" aria-labelledby="opm-motivo-titulo">
                  <div>
                    <p className="opm-eyebrow">OP #{opImpedimento.numero}</p>
                    <h3 id="opm-motivo-titulo">O que impede o encerramento?</h3>
                    <p>Este registro mantém a OP visível e cria uma análise formal. Ele não altera saldo ou produção.</p>
                    <label htmlFor="opm-motivo-texto">Motivo obrigatório</label>
                    <textarea
                      id="opm-motivo-texto"
                      value={motivo}
                      onChange={(event) => setMotivo(event.target.value)}
                      minLength={10}
                      maxLength={1000}
                      autoFocus
                      placeholder="Descreva objetivamente o que precisa ser corrigido..."
                    />
                    <small>{motivo.trim().length}/1000 · mínimo de 10 caracteres</small>
                    <div>
                      <button type="button" className="opm-btn opm-btn--secundario" onClick={() => setOpImpedimento(null)} disabled={executando}>Voltar à análise</button>
                      <button type="button" className="opm-btn opm-btn--primario" onClick={() => void registrarImpedimento()} disabled={executando || motivo.trim().length < 10}>Registrar impedimento</button>
                    </div>
                  </div>
                </div>
              )}

              <footer className="opm-acoes">
                <div>
                  {obrigatorio && <strong>{opsObrigatorias.length} {opsObrigatorias.length === 1 ? 'decisão pendente' : 'decisões pendentes'}</strong>}
                  {!dados.pode_finalizar && <span>Seu acesso é somente para consulta e registro de impedimentos.</span>}
                </div>
                {obrigatorio && dados.pode_adiar && (
                  <button type="button" className="opm-btn opm-btn--secundario" onClick={() => void adiar()} disabled={executando}>
                    <i className="far fa-clock" aria-hidden="true" /> Adiar 30 min
                  </button>
                )}
                {dados.pode_finalizar && (
                  <button
                    type="button"
                    className="opm-btn opm-btn--primario"
                    disabled={selecionadas.size === 0 || executando}
                    onClick={() => setConfirmando(true)}
                  >
                    <i className="fas fa-check-double" aria-hidden="true" />
                    Revisar finalização ({selecionadas.size})
                  </button>
                )}
              </footer>
            </>
          )}
        </>
      )}
    </section>
  );

  if (modo === 'inline') return conteudo;
  return (
    <div
      className={`opm-overlay${obrigatorio ? ' opm-overlay--obrigatorio' : ''}`}
      onMouseDown={(event) => {
        if (!obrigatorio && event.target === event.currentTarget) onClose?.();
      }}
    >
      {conteudo}
    </div>
  );
}
