import { useEffect, useMemo, useState } from 'react';
import UICarregando from './UICarregando';
import { fetchFinanceiro } from '../utils/financeiro-api';
import type { FinanceiroConfigPanel, FinanceiroContato } from '../utils/financeiro-types';
import { useFinanceiro } from './FinanceiroContext';

const TABS: Array<{ id: FinanceiroConfigPanel; label: string; icon: string }> = [
  { id: 'contas', label: 'Contas Bancárias', icon: 'fa-university' },
  { id: 'favorecidos', label: 'Favorecidos', icon: 'fa-user-friends' },
  { id: 'categorias', label: 'Categorias e Grupos', icon: 'fa-tags' },
  { id: 'taxas-vt', label: 'Taxas de VT', icon: 'fa-bus' },
];

function normalize(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function ConfigBusca({
  id,
  value,
  onChange,
  placeholder,
  label,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  const inputId = `fc-config-busca-${id}`;
  return (
    <div className="fc-config-busca" role="search" aria-label={label}>
      <label className="fc-config-busca-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="fc-config-busca-campo">
        <i className="fas fa-search fc-config-busca-icone" aria-hidden />
        <input
          id={inputId}
          type="search"
          className="fc-input fc-config-busca-input"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
        />
        {value ? (
          <button
            type="button"
            className="fc-config-busca-limpar"
            onClick={() => onChange('')}
            title="Limpar busca"
            aria-label="Limpar busca"
          >
            &times;
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function FinanceiroConfiguracoes() {
  const { config, reloadConfig, tokens, openConfigModal, openConcessionariaModal } = useFinanceiro();
  const [active, setActive] = useState<FinanceiroConfigPanel>('contas');
  const [contatos, setContatos] = useState<FinanceiroContato[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [buscaFavorecidos, setBuscaFavorecidos] = useState('');
  const [buscaCategorias, setBuscaCategorias] = useState('');

  const carregar = async () => {
    setLoading(true);
    setError(null);
    try {
      await reloadConfig();
      setContatos(await fetchFinanceiro<FinanceiroContato[]>('/contatos/all'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar configurações.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tokens.config > 0) void carregar(); }, [tokens.config]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTab = (tab: FinanceiroConfigPanel) => {
    setActive(tab);
    if (tab !== 'favorecidos') setBuscaFavorecidos('');
    if (tab !== 'categorias') setBuscaCategorias('');
  };

  const favorecidosFiltrados = useMemo(() => {
    const termo = normalize(buscaFavorecidos);
    if (!termo) return contatos;
    return contatos.filter((contato) => {
      const status = contato.ativo === false ? 'inativo' : 'ativo';
      return (
        normalize(contato.nome).includes(termo)
        || normalize(contato.tipo).includes(termo)
        || normalize(status).includes(termo)
        || normalize(contato.cpf_cnpj).includes(termo)
      );
    });
  }, [contatos, buscaFavorecidos]);

  const gruposFiltrados = useMemo(() => {
    const termo = normalize(buscaCategorias);
    if (!termo) {
      return config.grupos.map((grupo) => ({
        grupo,
        categorias: config.categorias.filter((categoria) => categoria.id_grupo === grupo.id),
      }));
    }

    return config.grupos
      .map((grupo) => {
        const categoriasDoGrupo = config.categorias.filter((categoria) => categoria.id_grupo === grupo.id);
        const grupoMatch = normalize(grupo.nome).includes(termo) || normalize(grupo.tipo).includes(termo);
        const categorias = grupoMatch
          ? categoriasDoGrupo
          : categoriasDoGrupo.filter((categoria) => normalize(categoria.nome).includes(termo));
        return { grupo, categorias };
      })
      .filter(({ grupo, categorias }) => {
        const grupoMatch = normalize(grupo.nome).includes(termo) || normalize(grupo.tipo).includes(termo);
        return grupoMatch || categorias.length > 0;
      });
  }, [config.grupos, config.categorias, buscaCategorias]);

  if (error) return <p style={{ color: 'red', padding: '20px' }}>{error}</p>;
  if (loading && !config.contas.length) {
    return <UICarregando variante="bloco" tamanho="md" texto="Carregando configurações..." />;
  }

  const tabAtiva = TABS.find((tab) => tab.id === active);

  return (
    <div className="fc-config-shell">
      <header className="fc-config-shell-header">
        <h2 className="fc-config-shell-title">Configurações financeiras</h2>
      </header>

      <nav className="fc-config-subnav" aria-label="Seções de configuração">
        {TABS.map((tab) => {
          const ativo = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`fc-config-subnav-btn${ativo ? ' is-ativo' : ''}`}
              aria-current={ativo ? 'page' : undefined}
              onClick={() => setTab(tab.id)}
            >
              <span className="fc-config-subnav-icone" aria-hidden>
                <i className={`fas ${tab.icon}`} />
              </span>
              <span className="fc-config-subnav-label">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="fc-config-panel">
        {active === 'contas' && (
          <section className="fc-config-secao">
            <header className="fc-table-header">
              <h3 className="fc-table-title">{tabAtiva?.label}</h3>
              <button type="button" className="fc-btn fc-btn-primario" onClick={() => openConfigModal({ kind: 'conta' })}>
                <i className="fas fa-plus" /> Nova Conta
              </button>
            </header>
            <div className="fc-tabela-responsiva">
              <table className="fc-tabela-estilizada">
                <thead>
                  <tr>
                    <th>Conta</th>
                    <th>Banco</th>
                    <th>Agência</th>
                    <th>Número</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {config.contas.map((conta) => (
                    <tr key={conta.id}>
                      <td>{conta.nome_conta}</td>
                      <td>{conta.banco || '-'}</td>
                      <td>{conta.agencia || '-'}</td>
                      <td>{conta.numero_conta || '-'}</td>
                      <td>
                        <button type="button" className="fc-btn-icon" onClick={() => openConfigModal({ kind: 'conta', item: conta })}>
                          <i className="fas fa-pencil-alt" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!config.contas.length && (
              <p className="fc-config-vazio">Nenhuma conta bancária cadastrada.</p>
            )}
          </section>
        )}

        {active === 'favorecidos' && (
          <section className="fc-config-secao">
            <header className="fc-table-header">
              <h3 className="fc-table-title">{tabAtiva?.label}</h3>
              <button type="button" className="fc-btn fc-btn-primario" onClick={() => openConfigModal({ kind: 'contato' })}>
                <i className="fas fa-plus" /> Novo Favorecido
              </button>
            </header>

            <ConfigBusca
              id="favorecidos"
              label="Buscar favorecidos"
              placeholder="Buscar por nome, tipo, status ou CPF/CNPJ..."
              value={buscaFavorecidos}
              onChange={setBuscaFavorecidos}
            />

            <div className="fc-tabela-responsiva">
              <table className="fc-tabela-estilizada">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {favorecidosFiltrados.map((contato) => (
                    <tr key={contato.id}>
                      <td>{contato.nome}</td>
                      <td>{contato.tipo || '-'}</td>
                      <td>{contato.ativo === false ? 'Inativo' : 'Ativo'}</td>
                      <td>
                        <button type="button" className="fc-btn-icon" onClick={() => openConfigModal({ kind: 'contato', item: contato })}>
                          <i className="fas fa-pencil-alt" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!favorecidosFiltrados.length && (
              <p className="fc-config-vazio">
                {buscaFavorecidos
                  ? 'Nenhum favorecido encontrado para esta busca.'
                  : 'Nenhum favorecido cadastrado.'}
              </p>
            )}
          </section>
        )}

        {active === 'categorias' && (
          <section className="fc-config-secao">
            <header className="fc-table-header">
              <h3 className="fc-table-title">{tabAtiva?.label}</h3>
              <div className="fc-config-secao-acoes">
                <button type="button" className="fc-btn fc-btn-outline" onClick={() => openConfigModal({ kind: 'grupo' })}>
                  <i className="fas fa-plus" /> Novo Grupo
                </button>
                <button type="button" className="fc-btn fc-btn-primario" onClick={() => openConfigModal({ kind: 'categoria' })}>
                  <i className="fas fa-plus" /> Nova Categoria
                </button>
              </div>
            </header>

            <ConfigBusca
              id="categorias"
              label="Buscar categorias e grupos"
              placeholder="Buscar por grupo, tipo ou nome da categoria..."
              value={buscaCategorias}
              onChange={setBuscaCategorias}
            />

            {gruposFiltrados.map(({ grupo, categorias }) => (
              <div className="fc-config-grupo-item" key={grupo.id}>
                <div className="fc-config-grupo-header">
                  <span className="fc-config-grupo-nome">{grupo.nome}</span>
                  <span className="fc-config-grupo-tipo">{grupo.tipo}</span>
                  <span className="fc-config-grupo-count">{categorias.length} categoria(s)</span>
                </div>
                <div className="fc-tabela-responsiva">
                  <table className="fc-tabela-estilizada">
                    <tbody>
                      {categorias.length ? categorias.map((categoria) => (
                        <tr key={categoria.id}>
                          <td>{categoria.nome}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="fc-btn-icon"
                              onClick={() => openConfigModal({ kind: 'categoria', item: categoria })}
                            >
                              <i className="fas fa-pencil-alt" />
                            </button>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={2} className="fc-config-vazio-inline">
                            Nenhuma categoria neste grupo.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {!gruposFiltrados.length && (
              <p className="fc-config-vazio">
                {buscaCategorias
                  ? 'Nenhum grupo ou categoria encontrado para esta busca.'
                  : 'Nenhum grupo cadastrado.'}
              </p>
            )}
          </section>
        )}

        {active === 'taxas-vt' && (
          <section className="fc-config-secao">
            <header className="fc-table-header">
              <h3 className="fc-table-title">{tabAtiva?.label}</h3>
            </header>
            <p className="fc-config-secao-texto">
              Use esta seção para gerenciar as concessionárias e taxas de vale-transporte.
            </p>
            <button type="button" className="fc-btn fc-btn-primario" onClick={openConcessionariaModal}>
              Gerenciar Taxas de VT
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
