import { useState, useEffect, useMemo } from 'react';
import Select, { components, type NoticeProps } from 'react-select';
import { formatarMoeda } from '../utils/cpag-format';
import { mostrarConfirmacao, mostrarToast } from '../utils/cpag-feedback';
import { fetchCpag } from '../utils/cpag-api';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UICarregando from './UICarregando.jsx';
import CPAGMultiDatePicker from './CPAGMultiDatePicker.tsx';
import CPAGModalHistoricoVT from './CPAGModalHistoricoVT.tsx';
import CPAGGerenciadorRecibosVT from './CPAGGerenciadorRecibosVT.tsx';
import type {
  CpagConcessionaria,
  CpagConcessionariaOption,
  CpagContaFinanceira,
  CpagLinhaTabelaVT,
  CpagLoteVTPayload,
  CpagRegistroDiaEvento,
  CpagSelectOption,
  CpagUsuario,
} from '../utils/cpag-types';

interface Props {
  usuarios: CpagUsuario[];
  contas: CpagContaFinanceira[];
}

const CustomNoOptions = (props: NoticeProps<CpagSelectOption, false>) => (
  <components.NoOptionsMessage {...props}>
    <div style={{ padding: '10px' }}>
      <UIFeedbackNotFound
        icon="fa-search"
        titulo="Sem resultados"
        mensagem="Nenhum registro encontrado."
      />
    </div>
  </components.NoOptionsMessage>
);

const CustomNoOptionsMulti = (props: NoticeProps<CpagSelectOption, true>) => (
  <components.NoOptionsMessage {...props}>
    <div style={{ padding: '10px' }}>
      <UIFeedbackNotFound
        icon="fa-search"
        titulo="Sem resultados"
        mensagem="Nenhum registro encontrado."
      />
    </div>
  </components.NoOptionsMessage>
);

function formatarDataCurta(iso: string): string {
  const partes = String(iso).slice(0, 10).split('-');
  if (partes.length !== 3) return iso;
  return `${partes[2]}/${partes[1]}`;
}

function formatarListaDatas(datas: string[]): string {
  if (!datas.length) return 'nenhuma data';
  return [...datas].sort().map(formatarDataCurta).join(', ');
}

function arraysIguais(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function dataLocalISOHojeMais(diasOffset: number): string {
  const base = new Date();
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + diasOffset, 12, 0, 0, 0);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function normalizarDataIso(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const s = String(valor).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function carregarDiasPagosUsuario(usuarioId: number | string): Promise<string[]> {
  const start = dataLocalISOHojeMais(-180);
  const end = dataLocalISOHojeMais(120);
  const eventos = await fetchCpag<CpagRegistroDiaEvento[]>(
    `/api/pagamentos/registros-dias?usuario_id=${usuarioId}&start=${start}&end=${end}`,
  );
  return (Array.isArray(eventos) ? eventos : [])
    .filter((e) => e.extendedProps?.status === 'PAGO')
    .map((e) => normalizarDataIso(e.start))
    .filter((d): d is string => Boolean(d));
}

export default function CPAGPassagem({ usuarios, contas }: Props) {
  const [concessionarias, setConcessionarias] = useState<CpagConcessionaria[]>([]);
  const [selConcessionaria, setSelConcessionaria] = useState<CpagConcessionariaOption | null>(
    null,
  );
  const [selConta, setSelConta] = useState<CpagSelectOption | null>(null);
  const [diasGlobais, setDiasGlobais] = useState<string[]>([]);
  const [selFuncionarios, setSelFuncionarios] = useState<CpagSelectOption[]>([]);
  const [diasEspecificos, setDiasEspecificos] = useState<Record<string, string[]>>({});
  const [modalUserAberto, setModalUserAberto] = useState<number | string | null>(null);
  const [modalRecibosAberto, setModalRecibosAberto] = useState(false);
  const [diasPagosUsuarioAtual, setDiasPagosUsuarioAtual] = useState<string[]>([]);
  const [loadingDiasUser, setLoadingDiasUser] = useState(false);
  const [modalHistoricoAberto, setModalHistoricoAberto] = useState(false);
  const [usuarioParaHistorico, setUsuarioParaHistorico] = useState<number | string | null>(null);
  const [taxaManual, setTaxaManual] = useState('');
  const [loading, setLoading] = useState(false);
  const [dadosTabela, setDadosTabela] = useState<CpagLinhaTabelaVT[]>([]);

  const handleAbrirEdicaoUsuario = async (usuarioId: number | string) => {
    setModalUserAberto(usuarioId);
    setDiasPagosUsuarioAtual([]);
    setLoadingDiasUser(true);

    try {
      const diasPagos = await carregarDiasPagosUsuario(usuarioId);
      setDiasPagosUsuarioAtual(diasPagos);

      // Remove da seleção qualquer dia já pago (evita azul por cima do “já pago”)
      setDiasEspecificos((prev) => {
        const chave = String(usuarioId);
        const atuais = prev[chave] || [...diasGlobais];
        const limpos = atuais.filter((d) => !diasPagos.includes(d));
        if (arraysIguais(atuais, limpos) && prev[chave]) return prev;
        if (selFuncionarios.length === 1) {
          setDiasGlobais((g) => g.filter((d) => !diasPagos.includes(d)));
        }
        return { ...prev, [chave]: limpos };
      });
    } catch (error) {
      console.error('Erro ao buscar dias pagos:', error);
      mostrarToast('Não foi possível carregar os dias já pagos.', 'erro');
    } finally {
      setLoadingDiasUser(false);
    }
  };

  useEffect(() => {
    async function loadData() {
      try {
        const data = await fetchCpag<CpagConcessionaria[]>('/api/financeiro/concessionarias-vt');
        setConcessionarias((Array.isArray(data) ? data : []).filter((c) => c.ativo));
      } catch (err) {
        console.error(err);
      }
    }
    void loadData();
  }, []);

  /**
   * Calendário mestre → tabela (todos usam o padrão).
   * Limpa exceções individuais para manter sincronismo.
   * Dias já pagos do contexto atual (1 empregado) não entram.
   */
  const toggleDiaGlobal = (dataStr: string) => {
    if (diasPagosUsuarioAtual.includes(dataStr) && selFuncionarios.length === 1) {
      mostrarToast('Este dia já foi pago para o empregado.', 'aviso');
      return;
    }
    setDiasGlobais((prev) => {
      if (prev.includes(dataStr)) return prev.filter((d) => d !== dataStr).sort();
      return [...prev, dataStr].sort();
    });
    setDiasEspecificos({});
  };

  /**
   * Dias do empregado (modal/tabela) → estado individual + espelha no calendário mestre
   * quando há um único funcionário, ou quando todos ficam com o mesmo conjunto de dias.
   */
  const toggleDiaUsuario = (usuarioId: number | string, dataStr: string) => {
    if (diasPagosUsuarioAtual.includes(dataStr)) {
      mostrarToast('Este dia já foi pago e não pode ser selecionado de novo.', 'aviso');
      return;
    }
    setDiasEspecificos((prev) => {
      const chave = String(usuarioId);
      const diasAtuais = prev[chave] || [...diasGlobais];
      let novosDias: string[];
      if (diasAtuais.includes(dataStr)) {
        novosDias = diasAtuais.filter((d) => d !== dataStr);
      } else {
        novosDias = [...diasAtuais, dataStr];
      }
      novosDias.sort();
      const proximo = { ...prev, [chave]: novosDias };

      // Espelha no calendário mestre quando possível (1 pessoa ou todos iguais)
      const idsSelecionados = selFuncionarios.map((f) => String(f.value));
      if (idsSelecionados.length === 1 && idsSelecionados[0] === chave) {
        setDiasGlobais(novosDias);
      } else if (idsSelecionados.length > 1) {
        const conjuntos = idsSelecionados.map((id) =>
          id === chave ? novosDias : proximo[id] || [...diasGlobais],
        );
        const todosIguais = conjuntos.every((c) => arraysIguais(c, conjuntos[0]));
        if (todosIguais) {
          setDiasGlobais(conjuntos[0]);
          // Todos iguais → limpa exceções e volta ao padrão global
          return {};
        }
      }

      return proximo;
    });
  };

  // Com 1 empregado na lista, carrega “já pago” também no calendário mestre
  useEffect(() => {
    if (selFuncionarios.length !== 1) {
      if (modalUserAberto == null) setDiasPagosUsuarioAtual([]);
      return;
    }
    const uid = selFuncionarios[0].value;
    let ativo = true;
    void (async () => {
      try {
        const pagos = await carregarDiasPagosUsuario(uid);
        if (!ativo) return;
        setDiasPagosUsuarioAtual(pagos);
        setDiasGlobais((prev) => prev.filter((d) => !pagos.includes(d)));
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [selFuncionarios]);

  const totalVT = dadosTabela.reduce(
    (acc, item) => acc + (Number.parseFloat(String(item.total)) || 0),
    0,
  );

  const taxaPercentual = selConcessionaria
    ? Number.parseFloat(String(selConcessionaria.taxa_recarga_percentual || 0))
    : 0;
  const taxaCalculada = totalVT * (taxaPercentual / 100);
  const valorTaxaFinal = taxaManual !== '' ? Number.parseFloat(taxaManual) : taxaCalculada;
  const totalBoleto = totalVT + valorTaxaFinal;

  const usersFiltrados = usuarios.filter(
    (u) =>
      selConcessionaria &&
      u.concessionarias_vt &&
      u.concessionarias_vt.some(
        (id) =>
          Number.parseInt(String(id), 10) ===
          Number.parseInt(String(selConcessionaria.value), 10),
      ),
  );
  const userOptions = usersFiltrados.map((u) => ({ value: u.id, label: u.nome }));
  const contaOptions = contas.map((c) => ({ value: c.id, label: c.nome_conta }));
  const concessOptions: CpagConcessionariaOption[] = concessionarias.map((c) => ({
    value: c.id,
    label: c.nome ?? c.nome_concessionaria ?? String(c.id),
    taxa_recarga_percentual: c.taxa_recarga_percentual,
    id_contato_financeiro: c.id_contato_financeiro,
  }));

  useEffect(() => {
    const novosDados: CpagLinhaTabelaVT[] = selFuncionarios.map((sel) => {
      const usuarioId = sel.value;
      const usuario = usuarios.find((u) => u.id === usuarioId);
      const dias = diasEspecificos[String(usuarioId)] || diasGlobais;
      const valorDiario = Number.parseFloat(String(usuario?.valor_passagem_diaria || 0));

      const estadoAnterior = dadosTabela.find((d) => d.id === usuarioId);

      let total: number | string;
      if (estadoAnterior && estadoAnterior.totalManual) {
        total = estadoAnterior.total;
      } else {
        total = dias.length * valorDiario;
      }

      return {
        id: usuarioId,
        nome: usuario?.nome || '?',
        valorDiario,
        dias,
        total,
        totalManual: estadoAnterior?.totalManual || false,
      };
    });

    if (JSON.stringify(novosDados) !== JSON.stringify(dadosTabela)) {
      setDadosTabela(novosDados);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sincronização intencional da tabela
  }, [selFuncionarios, diasGlobais, diasEspecificos]);

  const handleChangeTotal = (id: number | string, novoValor: string) => {
    setDadosTabela((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          return {
            ...item,
            total: novoValor,
            totalManual: true,
          };
        }
        return item;
      }),
    );
  };

  const handleProcessarLote = async () => {
    if (!selConcessionaria || !selConta || dadosTabela.length === 0) {
      mostrarToast('Preencha os dados e selecione empregados.', 'aviso');
      return;
    }
    if (dadosTabela.every((d) => d.dias.length === 0)) {
      mostrarToast('Selecione ao menos um dia de recarga.', 'aviso');
      return;
    }

    const linhasFuncionarios = dadosTabela
      .map(
        (d) =>
          `<tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:left"><strong>${d.nome}</strong></td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:left;font-size:0.9em">${formatarListaDatas(d.dias)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${formatarMoeda(d.total)}</td>
          </tr>`,
      )
      .join('');

    const confirmado = await mostrarConfirmacao(
      `<div style="text-align:left">
        <p style="margin:0 0 10px">Confirma o pagamento do lote <strong>${selConcessionaria.label}</strong>?</p>
        <div style="max-height:220px;overflow:auto;margin:10px 0;border:1px solid #e9ecef;border-radius:8px">
          <table style="width:100%;border-collapse:collapse;font-size:0.92em">
            <thead>
              <tr style="background:#f8f9fa">
                <th style="padding:8px;text-align:left">Empregado</th>
                <th style="padding:8px;text-align:left">Datas da recarga</th>
                <th style="padding:8px;text-align:right">Valor</th>
              </tr>
            </thead>
            <tbody>${linhasFuncionarios}</tbody>
          </table>
        </div>
        <p style="margin:8px 0 0">Valor VT: <strong>${formatarMoeda(totalVT)}</strong></p>
        <p style="margin:4px 0">Taxa: <strong>${formatarMoeda(valorTaxaFinal)}</strong></p>
        <p style="margin:8px 0 0;font-size:1.05em"><strong>Total: ${formatarMoeda(totalBoleto)}</strong></p>
        <p style="margin:10px 0 0;font-size:0.85em;color:#64748b">Cada empregado receberá um aviso popup na dashboard confirmando a recarga.</p>
      </div>`,
      { tipo: 'aviso', textoConfirmar: 'Confirmar Lote' },
    );
    if (!confirmado) return;

    setLoading(true);
    try {
      const payload: CpagLoteVTPayload = {
        id_conta_debito: selConta.value,
        id_concessionaria: selConcessionaria.value,
        id_contato_concessionaria: selConcessionaria.id_contato_financeiro,
        nome_concessionaria: selConcessionaria.label,
        valor_total_vt: totalVT,
        valor_total_taxa: valorTaxaFinal,
        itens: dadosTabela.map((d) => {
          const userOriginal = usuarios.find((u) => u.id === d.id);
          return {
            usuario_id: d.id,
            id_contato_financeiro: userOriginal?.id_contato_financeiro,
            nome_funcionario: d.nome,
            dias_qtd: d.dias.length,
            valor_total: Number.parseFloat(String(d.total)) || 0,
            datas_lista: d.dias,
          };
        }),
      };

      await fetchCpag('/api/pagamentos/lote-vt', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      mostrarToast('Lote processado com sucesso! Avisos enviados às funcionárias.', 'sucesso');
      setSelFuncionarios([]);
      setDiasEspecificos({});
      setDiasGlobais([]);
      setTaxaManual('');
      setDadosTabela([]);
    } catch (err) {
      mostrarToast(err instanceof Error ? err.message : 'Erro ao processar lote.', 'erro');
    } finally {
      setLoading(false);
    }
  };

  const handleVerHistorico = (uId: number | string) => {
    setUsuarioParaHistorico(uId);
    setModalHistoricoAberto(true);
  };

  const resumoDiasGlobais = useMemo(
    () => (diasGlobais.length ? formatarListaDatas(diasGlobais) : 'Nenhum dia padrão'),
    [diasGlobais],
  );

  return (
    <div className="cpg-card cpg-passagem">
      <div className="cpg-passagem__header">
        <h2 className="cpg-section-title" style={{ border: 'none', margin: 0, padding: 0 }}>
          Lote de Vale Transporte
        </h2>
        <button
          type="button"
          className="cpg-btn cpg-btn-secundario"
          onClick={() => setModalRecibosAberto(true)}
        >
          <i className="fas fa-print"></i> Gerenciar Recibos
        </button>
      </div>

      {/* Configuração — largura total, tablet-first */}
      <section className="cpg-vt-config">
        <div className="cpg-vt-campos">
          <div className="cpg-form-group">
            <label>Concessionária</label>
            <Select
              options={concessOptions}
              value={selConcessionaria}
              onChange={(val) => {
                setSelConcessionaria(val);
                setSelFuncionarios([]);
                setDiasEspecificos({});
              }}
              placeholder="Selecione..."
              components={{ NoOptionsMessage: CustomNoOptions }}
            />
          </div>
          <div className="cpg-form-group">
            <label>Empregados ({selConcessionaria?.label || '…'})</label>
            <Select
              isMulti
              options={userOptions}
              value={selFuncionarios}
              onChange={(value) => setSelFuncionarios(Array.from(value ?? []))}
              placeholder={
                !selConcessionaria
                  ? 'Selecione a concessionária primeiro'
                  : 'Busque e selecione...'
              }
              isDisabled={!selConcessionaria}
              components={{ NoOptionsMessage: CustomNoOptionsMulti }}
              closeMenuOnSelect={false}
            />
          </div>
        </div>
      </section>

      {/* Calendário em bloco próprio — não espremido à esquerda */}
      <section className="cpg-vt-calendario">
        <div className="cpg-vt-calendario__cabecalho">
          <div>
            <h3>Dias de recarga (padrão para todos)</h3>
            <p>
              Clique nos dias do calendário. O mesmo conjunto preenche “Dias selecionados” na
              tabela. Ajuste individual permanece disponível por empregado.
            </p>
          </div>
          <span className="cpg-vt-calendario__resumo">{resumoDiasGlobais}</span>
        </div>
        <div className="cpg-vt-calendario__box">
          <CPAGMultiDatePicker
            diasSelecionados={diasGlobais}
            diasBloqueados={selFuncionarios.length === 1 ? diasPagosUsuarioAtual : []}
            onToggleDia={toggleDiaGlobal}
            legendaBloqueado="Já pago"
            legendaSelecionado="Selecionado"
          />
        </div>
        {selFuncionarios.length === 1 && diasPagosUsuarioAtual.length > 0 && (
          <p className="cpg-vt-calendario__hint">
            {diasPagosUsuarioAtual.length} dia(s) já pagos para este empregado (bloqueados no
            calendário).
          </p>
        )}
        {selFuncionarios.length > 1 && (
          <p className="cpg-vt-calendario__hint">
            Com vários empregados, os dias já pagos de cada um aparecem ao ajustar individualmente
            (“X dias”).
          </p>
        )}
      </section>

      {dadosTabela.length > 0 && (
        <section className="cpg-vt-tabela-wrap">
          <div className="cpg-tabela-container">
            <table className="cpg-tabela-detalhes cpg-vt-tabela">
              <thead>
                <tr>
                  <th>Empregado</th>
                  <th style={{ textAlign: 'center' }}>Valor / dia</th>
                  <th style={{ textAlign: 'center' }}>Dias selecionados</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ width: '48px' }}></th>
                </tr>
              </thead>
              <tbody>
                {dadosTabela.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.nome}</strong>
                      {item.dias.length > 0 && (
                        <div className="cpg-vt-datas-linha">{formatarListaDatas(item.dias)}</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>{formatarMoeda(item.valorDiario)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="cpg-btn cpg-btn-secundario cpg-vt-btn-dias"
                        onClick={() => void handleAbrirEdicaoUsuario(item.id)}
                      >
                        {item.dias.length} dia{item.dias.length === 1 ? '' : 's'}{' '}
                        <i className="fas fa-edit" aria-hidden="true" />
                      </button>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="cpg-vt-total-edit">
                        <span>R$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={item.total}
                          onChange={(e) => handleChangeTotal(item.id, e.target.value)}
                          className="cpg-input"
                          title={
                            item.totalManual
                              ? 'Valor editado manualmente'
                              : 'Calculado automaticamente'
                          }
                          style={{
                            border: item.totalManual
                              ? '1px solid #f39c12'
                              : '1px solid #ced4da',
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="cpg-btn-icon-small"
                        title="Ver histórico"
                        onClick={() => handleVerHistorico(item.id)}
                      >
                        <i className="fas fa-history" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cpg-vt-rodape">
            <div className="cpg-vt-rodape__item">
              <label>Subtotal VT</label>
              <strong>{formatarMoeda(totalVT)}</strong>
            </div>
            <div className="cpg-vt-rodape__item">
              <label>Taxa {taxaManual !== '' ? '(manual)' : ''}</label>
              <input
                type="number"
                step="0.01"
                className="cpg-input"
                placeholder={formatarMoeda(taxaCalculada)}
                value={taxaManual}
                onChange={(e) => setTaxaManual(e.target.value)}
              />
            </div>
            <div className="cpg-vt-rodape__item cpg-vt-rodape__item--conta">
              <label>Conta de saída</label>
              <Select
                options={contaOptions}
                value={selConta}
                onChange={setSelConta}
                placeholder="Selecione..."
                menuPlacement="top"
              />
            </div>
            <div className="cpg-vt-rodape__item cpg-vt-rodape__item--total">
              <label>Total</label>
              <strong className="cpg-vt-total-final">{formatarMoeda(totalBoleto)}</strong>
            </div>
          </div>

          <button
            type="button"
            className="cpg-btn cpg-btn-primario cpg-vt-confirmar"
            onClick={() => void handleProcessarLote()}
            disabled={loading}
          >
            {loading ? 'Processando…' : 'Confirmar lote'}
          </button>
        </section>
      )}

      {/* Modal de ajuste individual de dias */}
      {modalUserAberto != null && (
        <>
          <div
            className="cpg-vt-modal-backdrop"
            onClick={() => setModalUserAberto(null)}
            aria-hidden="true"
          />
          <div className="cpg-vt-modal-dias" role="dialog" aria-modal="true">
            <h4>
              Ajustar dias —{' '}
              {dadosTabela.find((d) => d.id === modalUserAberto)?.nome || 'Empregado'}
            </h4>
            {loadingDiasUser ? (
              <UICarregando variante="bloco" tamanho="md" texto="Carregando dias pagos…" />
            ) : (
              <CPAGMultiDatePicker
                diasSelecionados={
                  dadosTabela.find((d) => d.id === modalUserAberto)?.dias || []
                }
                diasBloqueados={diasPagosUsuarioAtual}
                onToggleDia={(d) => toggleDiaUsuario(modalUserAberto, d)}
                legendaBloqueado="Já pago"
                legendaSelecionado="Selecionado"
              />
            )}
            <button
              type="button"
              className="cpg-btn cpg-btn-primario"
              style={{ width: '100%', marginTop: 14 }}
              onClick={() => setModalUserAberto(null)}
            >
              Concluir
            </button>
          </div>
        </>
      )}

      <CPAGModalHistoricoVT
        isOpen={modalHistoricoAberto}
        onClose={() => setModalHistoricoAberto(false)}
        usuarioId={usuarioParaHistorico}
      />
      <CPAGGerenciadorRecibosVT
        isOpen={modalRecibosAberto}
        onClose={() => setModalRecibosAberto(false)}
      />
    </div>
  );
}
