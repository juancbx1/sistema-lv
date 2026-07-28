import { useState, type ReactNode } from 'react';
import type { FinanceiroFilters } from '../utils/financeiro-types';
import UISearchableSelect from './UISearchableSelect.tsx';

interface Props {
  filtros: FinanceiroFilters;
  onFiltrosChange: (campo: keyof FinanceiroFilters, valor: string) => void;
  onLimparFiltros: () => void;
  contas?: Array<{ id: string | number; nome_conta: string }>;
  /** Slot no fim da linha da toolbar (ex.: botão “Como lançar”), após Filtros/Limpar */
  toolbarExtra?: ReactNode;
}

const TIPOS = [
  { value: '', label: 'Todos' },
  { value: 'RECEITA', label: 'Receita' },
  { value: 'DESPESA', label: 'Despesa' },
] as const;

const FORMATOS = [
  { value: '', label: 'Todos' },
  { value: 'simples', label: 'Simples' },
  { value: 'COMPRA', label: 'Compra' },
  { value: 'DETALHADO', label: 'Rateio' },
  { value: 'transferencia', label: 'Transferência' },
] as const;

function countFiltrosAvancados(filtros: FinanceiroFilters) {
  let n = 0;
  if (filtros.dataInicio) n += 1;
  if (filtros.dataFim) n += 1;
  if (filtros.tipo) n += 1;
  if (filtros.idConta) n += 1;
  if (filtros.tipoRateio) n += 1;
  return n;
}

export default function FiltrosLancamentos({
  filtros,
  onFiltrosChange,
  onLimparFiltros,
  contas = [],
  toolbarExtra = null,
}: Props) {
  const [painelAberto, setPainelAberto] = useState(false);
  const avancadosAtivos = countFiltrosAvancados(filtros);
  const contaOptions = contas.map((c) => ({ value: c.id, label: c.nome_conta }));
  const temFiltroAtivo = Boolean(filtros.termoBusca || avancadosAtivos > 0);

  return (
    <div className="fc-filtro-toolbar">
      <div className="fc-filtro-toolbar-linha">
        <div className="fc-filtro-busca" role="search">
          <i className="fas fa-search fc-filtro-busca-icone" aria-hidden />
          <input
            type="search"
            className="fc-input fc-filtro-busca-input"
            name="termoBusca"
            placeholder="Buscar por #ID, descrição, favorecido ou valor..."
            value={filtros.termoBusca}
            onChange={(e) => onFiltrosChange('termoBusca', e.target.value)}
            autoComplete="off"
          />
          {filtros.termoBusca ? (
            <button
              type="button"
              className="fc-filtro-busca-limpar"
              onClick={() => onFiltrosChange('termoBusca', '')}
              title="Limpar busca"
              aria-label="Limpar busca"
            >
              &times;
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className={`fc-filtro-toolbar-btn${painelAberto ? ' is-ativo' : ''}${avancadosAtivos ? ' has-badge' : ''}`}
          onClick={() => setPainelAberto((v) => !v)}
        >
          <i className="fas fa-sliders-h" />
          <span>Filtros{avancadosAtivos ? ` · ${avancadosAtivos}` : ''}</span>
        </button>

        {temFiltroAtivo && (
          <button type="button" className="fc-filtro-toolbar-btn is-ghost" onClick={onLimparFiltros} title="Limpar tudo">
            <i className="fas fa-times" />
            <span>Limpar</span>
          </button>
        )}

        {toolbarExtra}
      </div>

      {painelAberto && (
        <div className="fc-filtro-painel">
          <div className="fc-filtro-bloco">
            <span className="fc-filtro-bloco-label">Tipo</span>
            <div className="fc-filtro-chips" role="group" aria-label="Tipo">
              {TIPOS.map((op) => (
                <button
                  key={op.value || 'todos-tipo'}
                  type="button"
                  className={`fc-filtro-chip${filtros.tipo === op.value ? ' is-ativo' : ''}`}
                  onClick={() => onFiltrosChange('tipo', op.value)}
                >
                  {op.label}
                </button>
              ))}
            </div>
          </div>

          <div className="fc-filtro-bloco">
            <span className="fc-filtro-bloco-label">Formato</span>
            <div className="fc-filtro-chips" role="group" aria-label="Formato do lançamento">
              {FORMATOS.map((op) => (
                <button
                  key={op.value || 'todos-formato'}
                  type="button"
                  className={`fc-filtro-chip${filtros.tipoRateio === op.value ? ' is-ativo' : ''}`}
                  onClick={() => onFiltrosChange('tipoRateio', op.value)}
                >
                  {op.label}
                </button>
              ))}
            </div>
          </div>

          <div className="fc-filtro-bloco fc-filtro-bloco-grid">
            <div className="fc-filtro-campo">
              <label>Conta</label>
              <UISearchableSelect
                options={contaOptions}
                placeholder="Buscar conta..."
                initialValue={filtros.idConta || null}
                onChange={(val) => onFiltrosChange('idConta', val == null ? '' : String(val))}
              />
            </div>
            <div className="fc-filtro-campo">
              <label htmlFor="fc-lanc-data-inicio">De</label>
              <input
                id="fc-lanc-data-inicio"
                type="date"
                className="fc-input"
                value={filtros.dataInicio}
                onChange={(e) => onFiltrosChange('dataInicio', e.target.value)}
              />
            </div>
            <div className="fc-filtro-campo">
              <label htmlFor="fc-lanc-data-fim">Até</label>
              <input
                id="fc-lanc-data-fim"
                type="date"
                className="fc-input"
                value={filtros.dataFim}
                onChange={(e) => onFiltrosChange('dataFim', e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
