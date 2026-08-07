import { useCallback, useEffect, useState } from 'react';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import { fetchFinanceiro } from '../utils/financeiro-api';
import type { FinanceiroCategoria, FinanceiroRegraImportacao } from '../utils/financeiro-types';
import { useFinanceiro } from './FinanceiroContext';

export default function FinanceiroRegrasImportacao() {
  const { config } = useFinanceiro();
  const [regras, setRegras] = useState<FinanceiroRegraImportacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [padrao, setPadrao] = useState('');
  const [idCategoria, setIdCategoria] = useState('');
  const [tipo, setTipo] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const data = await fetchFinanceiro<{ regras: FinanceiroRegraImportacao[] }>('/regras-importacao');
      setRegras(data.regras || []);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao carregar regras.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const criar = async () => {
    if (!padrao.trim() || !idCategoria) return;
    setSalvando(true);
    setErro(null);
    try {
      await fetchFinanceiro('/regras-importacao', {
        method: 'POST',
        body: JSON.stringify({
          padrao: padrao.trim(),
          id_categoria: Number(idCategoria),
          tipo: tipo || null,
          prioridade: 50,
        }),
      });
      setPadrao('');
      setIdCategoria('');
      setTipo('');
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao criar regra.');
    } finally {
      setSalvando(false);
    }
  };

  const toggleAtivo = async (regra: FinanceiroRegraImportacao) => {
    try {
      await fetchFinanceiro(`/regras-importacao/${regra.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ativo: !regra.ativo }),
      });
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao atualizar.');
    }
  };

  const excluir = async (id: string | number) => {
    try {
      await fetchFinanceiro(`/regras-importacao/${id}`, { method: 'DELETE' });
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao excluir.');
    }
  };

  const categorias: FinanceiroCategoria[] = config.categorias || [];

  return (
    <div className="fc-config-panel">
      <header className="fc-table-header" style={{ marginBottom: 12 }}>
        <div>
          <h3 className="fc-section-title" style={{ border: 0, margin: 0 }}>Regras de importação</h3>
          <p className="fc-import-hint" style={{ margin: '4px 0 0' }}>
            Quando o histórico normalizado contém o padrão, a categoria é sugerida automaticamente.
            Regras aprendidas também aparecem aqui (origem Aprendido).
          </p>
        </div>
        <button type="button" className="fc-btn-atualizar" onClick={() => void carregar()}>
          <i className="fas fa-sync-alt" /> Atualizar
        </button>
      </header>

      <div className="fc-regras-form">
        <label className="fc-import-field">
          <span>Padrão no histórico (ex.: mercado livre, enel, uber)</span>
          <input
            className="fc-input"
            value={padrao}
            onChange={(e) => setPadrao(e.target.value)}
            placeholder="texto contido na descrição normalizada"
          />
        </label>
        <label className="fc-import-field">
          <span>Categoria</span>
          <select className="fc-input" value={idCategoria} onChange={(e) => setIdCategoria(e.target.value)}>
            <option value="">Selecione…</option>
            {categorias.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.nome}</option>
            ))}
          </select>
        </label>
        <label className="fc-import-field">
          <span>Forçar tipo (opcional)</span>
          <select className="fc-input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Qualquer</option>
            <option value="DESPESA">Despesa</option>
            <option value="RECEITA">Receita</option>
          </select>
        </label>
        <button
          type="button"
          className="gs-btn gs-btn-primario"
          style={{ minHeight: 44 }}
          disabled={salvando || !padrao.trim() || !idCategoria}
          onClick={() => void criar()}
        >
          {salvando ? 'Salvando…' : 'Adicionar regra'}
        </button>
      </div>

      {erro && <p className="fc-import-erro" role="alert">{erro}</p>}

      {loading ? (
        <UICarregando variante="bloco" tamanho="md" texto="Carregando regras..." />
      ) : regras.length === 0 ? (
        <UIFeedbackNotFound
          variante="compacto"
          icon="fa-wand-magic-sparkles"
          titulo="Nenhuma regra ainda"
          mensagem="Crie uma regra manualmente ou aprove importações para aprender."
        />
      ) : (
        <ul className="fc-regras-lista">
          {regras.map((r) => (
            <li key={r.id} className={`fc-regras-item${!r.ativo ? ' is-inativo' : ''}`}>
              <div className="card-borda-charme" />
              <div className="fc-regras-item__main">
                <strong>“{r.padrao}”</strong>
                <span>
                  → {r.nome_categoria || `categoria #${r.id_categoria || '—'}`}
                  {r.tipo === 'DESPESA' ? ' · Despesa' : r.tipo === 'RECEITA' ? ' · Receita' : r.tipo ? ` · ${r.tipo}` : ''}
                  {' · '}
                  <em>
                    {String(r.origem || 'MANUAL').toUpperCase() === 'APRENDIDO'
                      ? 'Aprendido'
                      : String(r.origem || 'MANUAL').toUpperCase() === 'MANUAL'
                        ? 'Manual'
                        : r.origem}
                  </em>
                  {r.uso_count ? ` · usado ${r.uso_count}x` : ''}
                </span>
              </div>
              <div className="fc-regras-item__acoes">
                <button type="button" className="gs-btn gs-btn-secundario" onClick={() => void toggleAtivo(r)}>
                  {r.ativo ? 'Desativar' : 'Ativar'}
                </button>
                <button type="button" className="gs-btn gs-btn-secundario" onClick={() => void excluir(r.id)}>
                  Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
