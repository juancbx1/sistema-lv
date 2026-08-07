import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import { fetchFinanceiro } from '../utils/financeiro-api';

interface DadosDRE { totalReceitas: number; totalDespesas: number; resultado: number; }
interface CategoriaDespesa { id?: string | number; nome?: string; valor: number; }
interface Datas { inicio: string; fim: string; }

const formatCurrency = (value: unknown) => (
  typeof value === 'number'
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
    : 'R$ 0,00'
);

const formatPercent = (value: number) => (
  `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: value < 10 ? 1 : 0 })}%`
);

function useDatePresets() {
  const today = new Date();
  const formatDate = (date: Date) => date.toISOString().split('T')[0];
  return {
    today: formatDate(today),
    firstDayOfMonth: formatDate(new Date(today.getFullYear(), today.getMonth(), 1)),
  };
}

export default function RelatoriosView() {
  const { today, firstDayOfMonth } = useDatePresets();
  const [datas, setDatas] = useState<Datas>({ inicio: firstDayOfMonth, fim: today });
  const [dadosDRE, setDadosDRE] = useState<DadosDRE | null>(null);
  const [dadosCategorias, setDadosCategorias] = useState<CategoriaDespesa[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRelatorios = useCallback(async (periodo: Datas = datas) => {
    setIsLoading(true);
    setError(null);
    try {
      if (!periodo.inicio || !periodo.fim) throw new Error('Por favor, selecione as datas de início e fim.');
      const params = new URLSearchParams({ dataInicio: periodo.inicio, dataFim: periodo.fim });
      const [dre, categorias] = await Promise.all([
        fetchFinanceiro<DadosDRE>(`/relatorios/dre-simplificado?${params}`),
        fetchFinanceiro<Array<{ valor: string | number; nome?: string; id?: string | number }>>(`/relatorios/despesas-por-categoria?${params}`),
      ]);
      setDadosDRE(dre);
      setDadosCategorias(categorias.map((categoria) => ({ ...categoria, valor: Number(categoria.valor) })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao buscar os dados dos relatórios.');
      setDadosDRE(null);
      setDadosCategorias(null);
    } finally {
      setIsLoading(false);
    }
  }, [datas]);

  useEffect(() => { void fetchRelatorios(); }, []); // eslint-disable-line react-hooks/exhaustive-deps — carga inicial

  const handleDateChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDatas((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void fetchRelatorios(datas);
  };

  const ranking = useMemo(() => {
    const itens = [...(dadosCategorias ?? [])]
      .filter((item) => Number(item.valor) > 0)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10);
    const total = itens.reduce((sum, item) => sum + item.valor, 0);
    const maximo = itens[0]?.valor || 1;
    const top3Valor = itens.slice(0, 3).reduce((sum, item) => sum + item.valor, 0);
    const top3Qtd = Math.min(3, itens.length);
    const linhas = itens.map((item, index) => {
      const razao = item.valor / maximo;
      // 5 = maior impacto (mais quente) … 1 = menor
      const intensidade = Math.max(1, Math.min(5, Math.ceil(razao * 5)));
      return {
        ...item,
        posicao: index + 1,
        percentual: total > 0 ? (item.valor / total) * 100 : 0,
        largura: Math.max(8, razao * 100),
        intensidade,
      };
    });
    return {
      linhas,
      total,
      top3Qtd,
      top3Valor,
      top3Percentual: total > 0 ? (top3Valor / total) * 100 : 0,
    };
  }, [dadosCategorias]);

  const resultadoPositivo = (dadosDRE?.resultado ?? 0) >= 0;

  return (
    <div className="fc-relatorios-shell">
      <header className="fc-relatorios-shell-header">
        <h2 className="fc-relatorios-shell-title">Central de Relatórios</h2>
      </header>

      <form className="fc-relatorios-filtros" onSubmit={handleSubmit}>
        <div className="fc-relatorios-filtro">
          <label htmlFor="relatorio-inicio">De</label>
          <input
            type="date"
            name="inicio"
            id="relatorio-inicio"
            className="fc-input"
            value={datas.inicio}
            onChange={handleDateChange}
            required
          />
        </div>
        <div className="fc-relatorios-filtro">
          <label htmlFor="relatorio-fim">Até</label>
          <input
            type="date"
            name="fim"
            id="relatorio-fim"
            className="fc-input"
            value={datas.fim}
            onChange={handleDateChange}
            required
          />
        </div>
        <div className="fc-relatorios-filtro fc-relatorios-filtro-acao">
          <label className="fc-relatorios-filtro-label-fantasma" aria-hidden>Ação</label>
          <button type="submit" className="fc-btn fc-btn-primario fc-relatorios-gerar" disabled={isLoading}>
            {isLoading ? (
              <><UICarregando variante="inline" /> Gerando...</>
            ) : (
              <><i className="fas fa-chart-bar" /> Gerar Relatório</>
            )}
          </button>
        </div>
      </form>

      <div className="fc-relatorios-panel">
        {isLoading && <UICarregando variante="bloco" tamanho="md" texto="Carregando dados..." />}
        {error && !isLoading && <p className="fc-relatorios-erro">{error}</p>}

        {!isLoading && !error && dadosDRE && (
          <>
            <section className="fc-relatorios-kpis" aria-label="Resumo do período">
              <article className="fc-relatorios-kpi is-receita">
                <div className="fc-relatorios-kpi-topo">
                  <span className="fc-relatorios-kpi-icone" aria-hidden><i className="fas fa-arrow-down" /></span>
                  <span className="fc-relatorios-kpi-label">Receitas</span>
                </div>
                <strong className="fc-relatorios-kpi-valor">{formatCurrency(dadosDRE.totalReceitas)}</strong>
              </article>

              <article className="fc-relatorios-kpi is-despesa">
                <div className="fc-relatorios-kpi-topo">
                  <span className="fc-relatorios-kpi-icone" aria-hidden><i className="fas fa-arrow-up" /></span>
                  <span className="fc-relatorios-kpi-label">Despesas</span>
                </div>
                <strong className="fc-relatorios-kpi-valor">{formatCurrency(dadosDRE.totalDespesas)}</strong>
              </article>

              <article className={`fc-relatorios-kpi is-resultado ${resultadoPositivo ? 'is-positivo' : 'is-negativo'}`}>
                <div className="fc-relatorios-kpi-topo">
                  <span className="fc-relatorios-kpi-icone" aria-hidden>
                    <i className={`fas ${resultadoPositivo ? 'fa-balance-scale' : 'fa-exclamation-triangle'}`} />
                  </span>
                  <span className="fc-relatorios-kpi-label">Resultado</span>
                </div>
                <strong className="fc-relatorios-kpi-valor">{formatCurrency(dadosDRE.resultado)}</strong>
                <span className="fc-relatorios-kpi-hint">Receitas − Despesas</span>
              </article>
            </section>

            <section className="fc-relatorios-ranking" aria-label="Top 10 despesas por categoria">
              <header className="fc-relatorios-ranking-header">
                <div>
                  <h3 className="fc-relatorios-ranking-title">Maiores despesas por categoria</h3>
                  <p className="fc-relatorios-ranking-sub">
                    Quanto mais vermelho, maior o peso daquela categoria no período
                  </p>
                </div>
                {ranking.linhas.length > 0 && (
                  <span className="fc-relatorios-ranking-badge">Até 10 categorias</span>
                )}
              </header>

              {ranking.linhas.length > 0 ? (
                <>
                  {ranking.top3Qtd > 0 && (
                    <div className="fc-relatorios-concentracao" role="status">
                      <div className="fc-relatorios-concentracao-destaque">
                        <span className="fc-relatorios-concentracao-numero">
                          {formatPercent(ranking.top3Percentual)}
                        </span>
                        <span className="fc-relatorios-concentracao-rotulo">
                          {ranking.top3Qtd === 1
                            ? 'da despesa abaixo está em 1 categoria'
                            : `da despesa abaixo está em só ${ranking.top3Qtd} categorias`}
                        </span>
                      </div>
                      <div className="fc-relatorios-concentracao-detalhe">
                        <div className="fc-relatorios-concentracao-barra" aria-hidden>
                          <span style={{ width: `${Math.min(100, ranking.top3Percentual)}%` }} />
                        </div>
                        <p className="fc-relatorios-concentracao-explicacao">
                          Em valores: <strong>{formatCurrency(ranking.top3Valor)}</strong>
                          {' '}de um total de{' '}
                          <strong>{formatCurrency(ranking.total)}</strong>
                          {' '}listado neste ranking.
                        </p>
                      </div>
                    </div>
                  )}

                  <ol className="fc-relatorios-ranking-lista">
                    {ranking.linhas.map((item) => (
                      <li
                        key={String(item.id ?? `${item.nome}-${item.posicao}`)}
                        className={`fc-relatorios-ranking-item heat-${item.intensidade}`}
                      >
                        <div className="fc-relatorios-ranking-pos" aria-label={`Posição ${item.posicao}`}>
                          #{item.posicao}
                        </div>
                        <div className="fc-relatorios-ranking-corpo">
                          <div className="fc-relatorios-ranking-meta">
                            <span className="fc-relatorios-ranking-nome" title={item.nome || 'Sem nome'}>
                              {item.nome || 'Sem nome'}
                            </span>
                            <span className="fc-relatorios-ranking-valor">{formatCurrency(item.valor)}</span>
                          </div>
                          <div className="fc-relatorios-ranking-barra-track" aria-hidden>
                            <div
                              className="fc-relatorios-ranking-barra-fill"
                              style={{ width: `${item.largura}%` }}
                            />
                          </div>
                        </div>
                        <div className="fc-relatorios-ranking-pct" title="Participação neste ranking">
                          <strong>{formatPercent(item.percentual)}</strong>
                          <small>do ranking</small>
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <UIFeedbackNotFound
                  variante="compacto"
                  icon="fa-chart-pie"
                  titulo="Nenhuma despesa por categoria"
                  mensagem="Não há despesas no período selecionado."
                />
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
