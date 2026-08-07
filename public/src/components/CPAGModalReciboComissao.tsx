import { useState, useEffect, useMemo } from 'react';
import type {
  CpagIntervaloRecibo,
  CpagReciboDia,
  CpagSelectOption,
  CpagUsuario,
} from '../utils/cpag-types';
import Select, { components, type NoticeProps } from 'react-select';
import { formatarMoeda } from '../utils/cpag-format';
import { mostrarToast, mostrarConfirmacao } from '../utils/cpag-feedback';
import { fetchCpag } from '../utils/cpag-api';
import {
  DATA_INICIO_RECIBOS_SEMANAIS,
  dataLocalISO,
  diasCobertosPorIntervalos,
  labelSemana,
  listarSemanasFechadas,
  parseDataLocal,
  semanaAnteriorAoSistemaRecibos,
  semanaEstaFechada,
} from '../utils/cpag-recibos';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UICarregando from './UICarregando';
import CPAGMultiDatePicker from './CPAGMultiDatePicker.tsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

type PdfComTabela = jsPDF & { lastAutoTable?: { finalY: number } };

const CustomNoOptions = (props: NoticeProps<CpagSelectOption, false>) => (
  <components.NoOptionsMessage {...props}>
    <div style={{ padding: '10px' }}>
      <UIFeedbackNotFound icon="fa-search" titulo="Sem resultados" mensagem="Nenhum registro." />
    </div>
  </components.NoOptionsMessage>
);

interface Props {
  isOpen: boolean;
  onClose: () => void;
  usuarios: CpagUsuario[];
  /** Usuário pré-selecionado (ex.: o da aba comissão). */
  usuarioInicialId?: number | string | null;
  /** Disparado após gerar/registrar recibo — útil para atualizar o badge. */
  onRecibosAlterados?: () => void;
}

export default function CPAGModalReciboComissao({
  isOpen,
  onClose,
  usuarios,
  usuarioInicialId = null,
  onRecibosAlterados,
}: Props) {
  const [selectedUser, setSelectedUser] = useState<CpagSelectOption | null>(null);
  const [diasSelecionados, setDiasSelecionados] = useState<string[]>([]);
  const [diasBloqueados, setDiasBloqueados] = useState<string[]>([]);
  const [intervalos, setIntervalos] = useState<CpagIntervaloRecibo[]>([]);
  const [dadosRecibo, setDadosRecibo] = useState<CpagReciboDia[] | null>(null);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [loadingDados, setLoadingDados] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);

  const userOptions = useMemo(
    () => usuarios.map((u) => ({ value: u.id, label: u.nome })),
    [usuarios],
  );

  const usuarioCompleto = useMemo(
    () =>
      selectedUser
        ? usuarios.find((u) => String(u.id) === String(selectedUser.value))
        : undefined,
    [usuarios, selectedUser],
  );

  const diasCobertos = useMemo(() => diasCobertosPorIntervalos(intervalos), [intervalos]);

  const historicoSemanas = useMemo(() => {
    if (!selectedUser) return [];
    return listarSemanasFechadas({
      maxSemanas: 20,
      dataAdmissao: usuarioCompleto?.data_admissao,
      diasCobertos,
    });
  }, [selectedUser, usuarioCompleto?.data_admissao, diasCobertos]);

  const qtdPendentesHistorico = historicoSemanas.filter((s) => !s.gerado).length;
  const qtdGeradosHistorico = historicoSemanas.filter((s) => s.gerado).length;

  useEffect(() => {
    if (!isOpen) return;
    setDiasSelecionados([]);
    setDadosRecibo(null);
    setIntervalos([]);
    setDiasBloqueados([]);

    if (usuarioInicialId != null) {
      const encontrado = usuarios.find((u) => String(u.id) === String(usuarioInicialId));
      setSelectedUser(
        encontrado ? { value: encontrado.id, label: encontrado.nome } : null,
      );
    } else {
      setSelectedUser(null);
    }
  }, [isOpen, usuarioInicialId, usuarios]);

  useEffect(() => {
    if (!selectedUser || !isOpen) {
      setDiasBloqueados([]);
      setIntervalos([]);
      return;
    }

    let ativo = true;
    async function loadHistorico() {
      setLoadingHistorico(true);
      try {
        const anoAtual = new Date().getFullYear();
        const [int1, int2] = await Promise.all([
          fetchCpag<CpagIntervaloRecibo[]>(
            `/api/pagamentos/recibos/historico-periodos?usuario_id=${selectedUser!.value}&ano=${anoAtual}`,
          ),
          fetchCpag<CpagIntervaloRecibo[]>(
            `/api/pagamentos/recibos/historico-periodos?usuario_id=${selectedUser!.value}&ano=${anoAtual - 1}`,
          ),
        ]);

        const todos = [
          ...(Array.isArray(int1) ? int1 : []),
          ...(Array.isArray(int2) ? int2 : []),
        ];
        if (!ativo) return;
        setIntervalos(todos);
        setDiasBloqueados([...diasCobertosPorIntervalos(todos)]);
      } catch (err) {
        console.error(err);
        if (ativo) mostrarToast('Não foi possível carregar o histórico de recibos.', 'erro');
      } finally {
        if (ativo) setLoadingHistorico(false);
      }
    }
    void loadHistorico();
    return () => {
      ativo = false;
    };
  }, [selectedUser, isOpen]);

  const buscarDadosRecibo = async (inicio: string, fim: string, uid: number | string) => {
    setLoadingDados(true);
    try {
      const data = await fetchCpag<CpagReciboDia[]>(
        `/api/pagamentos/recibos/dados?usuario_id=${uid}&data_inicio=${inicio}&data_fim=${fim}`,
      );
      setDadosRecibo(Array.isArray(data) ? data : []);
    } catch {
      mostrarToast('Erro ao buscar dados.', 'erro');
      setDadosRecibo(null);
    } finally {
      setLoadingDados(false);
    }
  };

  const selecionarSemana = (dataInicio: string, dataFim: string) => {
    if (!selectedUser) {
      mostrarToast('Selecione um empregado primeiro.', 'aviso');
      return;
    }
    if (!semanaEstaFechada(dataInicio)) {
      mostrarToast(
        'Só é possível gerar recibo de semanas já fechadas (domingo a sábado completo).',
        'aviso',
      );
      return;
    }
    if (semanaAnteriorAoSistemaRecibos(dataFim)) {
      mostrarToast(
        `Recibos semanais valem a partir de ${parseDataLocal(DATA_INICIO_RECIBOS_SEMANAIS).toLocaleDateString('pt-BR')}. Semanas anteriores não se aplicam.`,
        'aviso',
      );
      return;
    }

    const semana: string[] = [];
    let cursor = parseDataLocal(dataInicio);
    const fim = parseDataLocal(dataFim);
    while (cursor <= fim) {
      semana.push(dataLocalISO(cursor));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 12, 0, 0, 0);
    }

    if (diasSelecionados[0] === semana[0]) {
      setDiasSelecionados([]);
      setDadosRecibo(null);
      return;
    }

    setDiasSelecionados(semana);
    void buscarDadosRecibo(semana[0], semana[6], selectedUser.value);
  };

  const handleToggleDia = (dataStr: string) => {
    if (!selectedUser) {
      mostrarToast('Selecione um empregado primeiro.', 'aviso');
      return;
    }

    const dataClicada = parseDataLocal(dataStr);
    const diaSemana = dataClicada.getDay();
    const domingo = new Date(
      dataClicada.getFullYear(),
      dataClicada.getMonth(),
      dataClicada.getDate() - diaSemana,
      12,
      0,
      0,
      0,
    );
    const sabado = new Date(domingo.getFullYear(), domingo.getMonth(), domingo.getDate() + 6, 12, 0, 0, 0);
    const dataInicio = dataLocalISO(domingo);
    const dataFim = dataLocalISO(sabado);

    if (!semanaEstaFechada(dataInicio)) {
      mostrarToast(
        'Semana ainda em andamento. Só é possível gerar recibo após o sábado.',
        'aviso',
      );
      return;
    }

    selecionarSemana(dataInicio, dataFim);
  };

  const handleGerarPDF = async () => {
    if (!selectedUser || !dadosRecibo || diasSelecionados.length === 0) return;

    const confirmado = await mostrarConfirmacao(
      'Gerar o recibo e marcar este período como conferido?',
      { tipo: 'aviso', textoConfirmar: 'Gerar Recibo' },
    );
    if (!confirmado) return;

    setGerandoPdf(true);
    try {
      const doc = new jsPDF() as PdfComTabela;

      const inicioStr = parseDataLocal(diasSelecionados[0]).toLocaleDateString('pt-BR');
      const fimStr = parseDataLocal(diasSelecionados[6]).toLocaleDateString('pt-BR');
      const emissaoStr = new Date().toLocaleDateString('pt-BR');

      doc.setFontSize(16);
      doc.text('CONFERÊNCIA DE PRODUÇÃO SEMANAL', 105, 20, { align: 'center' });

      doc.setFontSize(10);
      doc.text(`Empregado: ${selectedUser.label}`, 14, 35);
      doc.text(`Período: ${inicioStr} a ${fimStr}`, 14, 40);
      doc.text(`Data de Emissão: ${emissaoStr}`, 14, 45);

      const dadosFiltrados = dadosRecibo.filter((d) => d.totalDia > 0 || d.valor > 0);
      const totalValor = dadosRecibo.reduce((acc, d) => acc + d.valor, 0);

      const bodyTable1 = dadosFiltrados.map((d) => {
        const dataFmt = parseDataLocal(d.data).toLocaleDateString('pt-BR');
        const resgateFmt = d.resgate > 0 ? `+${Math.round(d.resgate)}` : '-';
        return [dataFmt, Math.round(d.pontos), resgateFmt, Math.round(d.totalDia), d.metaNome];
      });

      autoTable(doc, {
        startY: 55,
        head: [['Data', 'Prod.', 'Resgate', 'Total Dia', 'Meta']],
        body: bodyTable1,
        theme: 'grid',
        foot: [['', '', '', 'VALOR TOTAL:', formatarMoeda(totalValor)]],
        headStyles: { fillColor: [41, 128, 185], halign: 'center', valign: 'middle' },
        columnStyles: {
          0: { halign: 'center' },
          1: { halign: 'center' },
          2: { halign: 'center' },
          3: { halign: 'center', fontStyle: 'bold' },
          4: { halign: 'center' },
        },
        footStyles: {
          fillColor: [240, 240, 240],
          textColor: [0, 0, 0],
          fontStyle: 'bold',
          halign: 'right',
        },
        styles: { cellPadding: 3, fontSize: 10 },
      });

      let finalY = (doc.lastAutoTable?.finalY ?? 55) + 15;

      const movCofre = dadosRecibo.filter((d) => d.ganhoCofre > 0 || d.resgate > 0);
      if (movCofre.length > 0) {
        if (finalY > 230) {
          doc.addPage();
          finalY = 40;
        }

        doc.setFontSize(11);
        doc.text('Movimentações do Banco de Pontos (Cofre)', 14, finalY);
        finalY += 5;

        const bodyCofreSimples = movCofre.map((d) => {
          const dataRegObj = parseDataLocal(d.data);
          const dataFmt = dataRegObj.toLocaleDateString('pt-BR');

          if (d.ganhoCofre > 0) {
            const dataRefObj = new Date(dataRegObj);
            dataRefObj.setDate(dataRefObj.getDate() - 1);
            const dataRefStr = dataRefObj.toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
            });
            return [dataFmt, `Sobra de Produção (Ref. ${dataRefStr})`, `+${Math.round(d.ganhoCofre)}`];
          }

          return [dataFmt, 'Resgate para Meta (Débito)', `-${Math.round(d.resgate)}`];
        });

        autoTable(doc, {
          startY: finalY,
          head: [['Data', 'Descrição', 'Pontos']],
          body: bodyCofreSimples,
          theme: 'striped',
          headStyles: { fillColor: [100, 100, 100] },
          columnStyles: { 2: { halign: 'right', fontStyle: 'bold' } },
          styles: { fontSize: 9 },
        });
        finalY = (doc.lastAutoTable?.finalY ?? finalY) + 20;
      } else {
        finalY += 10;
      }

      if (finalY > 250) {
        doc.addPage();
        finalY = 40;
      }

      doc.setLineWidth(0.5);
      doc.line(60, finalY, 150, finalY);
      doc.setFontSize(10);
      doc.text('Assinatura do Empregado', 105, finalY + 5, { align: 'center' });

      doc.setFontSize(8);
      doc.text(
        'Declaro que conferi os dados acima e estou de acordo com TODOS os valores apresentados.',
        105,
        finalY + 15,
        { align: 'center' },
      );

      doc.save(`Recibo_Comissao_${selectedUser.label}_${inicioStr.replace(/\//g, '-')}.pdf`);

      const ehReimpressao = diasBloqueados.includes(diasSelecionados[0]);

      if (!ehReimpressao) {
        await fetchCpag('/api/pagamentos/recibos/registrar', {
          method: 'POST',
          body: JSON.stringify({
            usuario_id: selectedUser.value,
            data_inicio: diasSelecionados[0],
            data_fim: diasSelecionados[6],
          }),
        });

        setDiasBloqueados((prev) => [...prev, ...diasSelecionados]);
        setIntervalos((prev) => [
          ...prev,
          { data_inicio: diasSelecionados[0], data_fim: diasSelecionados[6] },
        ]);
        mostrarToast('Recibo gerado e registrado!', 'sucesso');
        onRecibosAlterados?.();
      } else {
        mostrarToast('Recibo reimpresso com sucesso (Registro mantido).', 'info');
      }

      setDiasSelecionados([]);
      setDadosRecibo(null);
    } catch {
      mostrarToast('Erro ao processar.', 'erro');
    } finally {
      setGerandoPdf(false);
    }
  };

  if (!isOpen) return null;

  const semanaSelecionadaLabel =
    diasSelecionados.length === 7
      ? labelSemana(diasSelecionados[0], diasSelecionados[6])
      : null;

  return (
    <div className="cpg-modal-overlay">
      <div className="cpg-modal-content cpg-modal-recibos">
        <div className="cpg-modal-header">
          <div>
            <h2>Gerador de Recibos Semanais</h2>
            <p className="cpg-modal-subtitulo">
              Conferência de produção por semana fechada (domingo a sábado). Válido a partir de{' '}
              {parseDataLocal(DATA_INICIO_RECIBOS_SEMANAIS).toLocaleDateString('pt-BR')}; a semana
              atual e a próxima não entram no histórico.
            </p>
          </div>
          <button type="button" className="cpg-modal-close-btn" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className="cpg-modal-body cpg-recibos-body">
          <div className="cpg-recibos-topo">
            <div className="cpg-form-group" style={{ marginBottom: 0, maxWidth: 420 }}>
              <label>Empregado</label>
              <Select
                options={userOptions}
                value={selectedUser}
                onChange={(val) => {
                  setSelectedUser(val);
                  setDiasSelecionados([]);
                  setDadosRecibo(null);
                }}
                placeholder="Buscar empregado..."
                components={{ NoOptionsMessage: CustomNoOptions }}
              />
            </div>
          </div>

          <div className="cpg-recibos-grade">
            <div className="cpg-recibos-calendario">
              <label>Selecionar semana (clique em um dia)</label>
              <div className="cpg-recibos-calendario__box">
                <CPAGMultiDatePicker
                  diasSelecionados={diasSelecionados}
                  diasBloqueados={diasBloqueados}
                  onToggleDia={handleToggleDia}
                  legendaBloqueado="Recibo já gerado"
                  legendaSelecionado="Semana selecionada"
                />
              </div>
              <p className="cpg-recibos-dica">
                Só semanas já fechadas podem ser geradas. Dias com recibo aparecem bloqueados.
              </p>
            </div>

            <div className="cpg-recibos-preview">
              {!selectedUser ? (
                <div className="cpg-recibos-placeholder">
                  <i className="fas fa-user" aria-hidden="true" />
                  <p>Selecione um empregado para começar.</p>
                </div>
              ) : loadingDados || gerandoPdf ? (
                <UICarregando
                  variante="bloco"
                  tamanho="md"
                  texto={gerandoPdf ? 'Gerando recibo…' : 'Calculando semana…'}
                />
              ) : diasSelecionados.length === 0 ? (
                <div className="cpg-recibos-placeholder">
                  <i className="fas fa-calendar-week" aria-hidden="true" />
                  <p>Selecione uma semana fechada no calendário ou no histórico abaixo.</p>
                </div>
              ) : (
                <div className="cpg-recibos-resumo">
                  <h3>Resumo da semana</h3>
                  <p className="cpg-recibos-resumo__periodo">{semanaSelecionadaLabel}</p>

                  <div className="cpg-recibos-resumo__kpis">
                    <div>
                      <span>Dias produtivos</span>
                      <strong>{dadosRecibo?.filter((d) => d.totalDia > 0).length || 0}</strong>
                    </div>
                    <div>
                      <span>Valor total</span>
                      <strong className="positivo">
                        {formatarMoeda(dadosRecibo?.reduce((acc, d) => acc + d.valor, 0) || 0)}
                      </strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="cpg-btn cpg-btn-primario"
                    style={{ width: '100%', height: '50px' }}
                    onClick={() => void handleGerarPDF()}
                    disabled={gerandoPdf}
                  >
                    {diasBloqueados.includes(diasSelecionados[0])
                      ? 'Reimprimir recibo'
                      : 'Gerar e salvar recibo'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Histórico em largura total — abaixo do bloco calendário/preview */}
          <section className="cpg-recibos-historico" aria-label="Histórico de recibos semanais">
            <div className="cpg-recibos-historico__cabecalho">
              <div>
                <h3>Histórico de semanas</h3>
                <p>
                  Somente semanas fechadas. A semana atual e a próxima não aparecem aqui.
                </p>
              </div>
              {selectedUser && !loadingHistorico && (
                <div className="cpg-recibos-historico__contadores">
                  <span className="cpg-badge-recibo cpg-badge-recibo--pendente">
                    {qtdPendentesHistorico} pendente{qtdPendentesHistorico === 1 ? '' : 's'}
                  </span>
                  <span className="cpg-badge-recibo cpg-badge-recibo--gerado">
                    {qtdGeradosHistorico} gerado{qtdGeradosHistorico === 1 ? '' : 's'}
                  </span>
                </div>
              )}
            </div>

            {!selectedUser ? (
              <UIFeedbackNotFound
                variante="compacto"
                icon="fa-clipboard-list"
                titulo="Escolha um empregado"
                mensagem="Aqui você verá o que já foi gerado e o que ainda falta."
              />
            ) : loadingHistorico ? (
              <UICarregando variante="bloco" tamanho="md" texto="Carregando histórico…" />
            ) : historicoSemanas.length === 0 ? (
              <UIFeedbackNotFound
                variante="compacto"
                icon="fa-inbox"
                titulo="Nenhuma semana fechada disponível"
                mensagem="Não há histórico de semanas para este empregado."
              />
            ) : (
              <div className="cpg-recibos-historico__lista">
                {historicoSemanas.map((semana) => {
                  const selecionada = diasSelecionados[0] === semana.dataInicio;
                  return (
                    <button
                      key={semana.dataInicio}
                      type="button"
                      className={[
                        'cpg-recibo-semana',
                        semana.gerado ? 'cpg-recibo-semana--gerado' : 'cpg-recibo-semana--pendente',
                        selecionada ? 'cpg-recibo-semana--ativa' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => selecionarSemana(semana.dataInicio, semana.dataFim)}
                      aria-pressed={selecionada}
                    >
                      <span className="cpg-recibo-semana__status">
                        <i
                          className={`fas ${semana.gerado ? 'fa-check-circle' : 'fa-exclamation-circle'}`}
                          aria-hidden="true"
                        />
                        {semana.gerado ? 'Gerado' : 'Pendente'}
                      </span>
                      <strong className="cpg-recibo-semana__label">{semana.label}</strong>
                      <span className="cpg-recibo-semana__acao">
                        {semana.gerado ? 'Reimprimir' : 'Selecionar'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
