// public/src/components/EmbalagemPainelFiltros.jsx

import React, { useState } from 'react';
import EmbalagemFiltrosAtivos from './EmbalagemFiltrosAtivos.jsx'; // Usaremos este componente em breve
import { getBuscasRecentes, addBuscaRecente, removeBuscaRecente } from '/src/utils/EmbalagemSearchHelpers';
import EmbalagemLegendaStatus from './EmbalagemLegendaStatus.jsx'

// Sub-componente para cada seção de filtro (reutilizável)
function SecaoFiltro({ titulo, opcoes, filtrosSelecionados, onFiltroChange }) {
  if (!opcoes || opcoes.length === 0) {
    return null;
  }
  return (
    <div className="gs-filtro-secao">
      <h4 className="gs-filtro-titulo">{titulo}</h4>
      <ul className="gs-filtro-lista">
        {opcoes.map(opcao => (
          <li key={opcao}>
            <label>
              <input
                type="checkbox"
                checked={filtrosSelecionados.includes(opcao)}
                onChange={() => onFiltroChange(opcao)}
              />
              <span>{opcao}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Componente Principal do Painel
function EmbalagemPainelFiltros({ opcoesDeFiltro, filtros, onFiltrosChange, onAtualizarClick, atualizando }) {
  const [filtrosMobileAberto, setFiltrosMobileAberto] = useState(false);
  
  // -- LÓGICA DAS BUSCAS RECENTES (INÍCIO) --
  const [mostrarRecentes, setMostrarRecentes] = useState(false);
  const [buscasRecentes, setBuscasRecentes] = useState([]);

  const handleFocoNaBusca = () => {
    setBuscasRecentes(getBuscasRecentes());
    setMostrarRecentes(true);
  };

  const handleBlurDaBusca = () => {
    // Adiciona a busca atual ao histórico quando o usuário sai do campo
    addBuscaRecente(filtros.termoBusca);
    // Um pequeno delay para permitir o clique nas pílulas antes de esconder
    setTimeout(() => setMostrarRecentes(false), 150);
  };
  
  const handleSelecionarRecente = (termo) => {
    onFiltrosChange({ ...filtros, termoBusca: termo });
    setMostrarRecentes(false);
  };

  const handleRemoverRecente = (e, termo) => {
    e.stopPropagation(); // Impede que o clique na lixeira selecione o termo
    removeBuscaRecente(termo);
    setBuscasRecentes(getBuscasRecentes()); // Atualiza a lista visível
  };
  // -- LÓGICA DAS BUSCAS RECENTES (FIM) --


  const handleBuscaChange = (e) => {
    onFiltrosChange({ ...filtros, termoBusca: e.target.value });
  };

  const handleOrdenacaoChange = (e) => {
    onFiltrosChange({ ...filtros, ordenacao: e.target.value });
  };
  
  const handleFiltroCheckboxChange = (tipo, opcao) => {
    const filtrosAtuais = filtros[tipo] || [];
    const novosFiltros = filtrosAtuais.includes(opcao) 
      ? filtrosAtuais.filter(item => item !== opcao) 
      : [...filtrosAtuais, opcao];
    onFiltrosChange({ ...filtros, [tipo]: novosFiltros });
  };

  const handleRemoverFiltro = (tipo, valor) => {
    handleFiltroCheckboxChange(tipo, valor); // A lógica é a mesma
  };

  const handleLimparTodos = () => {
    onFiltrosChange({
      termoBusca: '',
      ordenacao: 'mais_recentes',
      produtos: [],
      cores: [],
      tamanhos: [],
    });
  };

  const filtrosAtivosCount = (filtros.produtos?.length || 0) + (filtros.cores?.length || 0) + (filtros.tamanhos?.length || 0);

  return (
    <div className="gs-card gs-filtros-container" style={{ position: 'sticky', top: '20px', padding: '20px 10px 5px 20px'}}>
      
      <h3 className="gs-header-titulo">Produtos na Fila</h3>

      {/* --- MODIFICAÇÃO NO WRAPPER DA BUSCA --- */}
      <div className="gs-busca-wrapper" style={{ margin: '15px 0' }} onMouseLeave={handleBlurDaBusca}>
          <input 
            type="text" 
            className="gs-input gs-input-busca" 
            placeholder="Buscar por produto, variação ou SKU..." 
            value={filtros.termoBusca} 
            onChange={handleBuscaChange}
            onFocus={handleFocoNaBusca} // Mostra o histórico ao focar
          />
          {filtros.termoBusca && (
            <button className="gs-btn-limpar-busca" title="Limpar busca" onClick={() => onFiltrosChange({ ...filtros, termoBusca: '' })}>&times;</button>
          )}

          {/* Container das pílulas de busca recente */}
          {mostrarRecentes && buscasRecentes.length > 0 && (
              <div className="gs-buscas-recentes-container">
                <h4 className="gs-buscas-recentes-titulo">BUSCAS RECENTES</h4>
                <div className="gs-buscas-recentes-lista">
                  {buscasRecentes.map((termo) => (
                    <div key={termo} className="gs-pilula-recente" onClick={() => handleSelecionarRecente(termo)}>
                      <span>{termo}</span>
                      <span className="remover" onClick={(e) => handleRemoverRecente(e, termo)}>&times;</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
      </div>

      <button className="gs-btn-atualizar" onClick={onAtualizarClick} disabled={atualizando} style={{ marginBottom: '20px' }}>
          {atualizando ? <><i className="fas fa-sync-alt gs-spin"></i><span>Atualizando...</span></> : <><i className="fas fa-sync-alt"></i><span>Atualizar</span></>}
      </button>

      <hr style={{ border: 'none', borderTop: '1px solid var(--ep-cor-cinza-borda)', margin: '0 0 20px 0' }} />
      
      <EmbalagemFiltrosAtivos filtros={filtros} onRemoverFiltro={handleRemoverFiltro} onLimparTudo={handleLimparTodos} />
      
      {/* BOTÃO MOBILE */}
      <div className="gs-filtros-mobile-toggle">
        <button className="gs-btn gs-btn-secundario" onClick={() => setFiltrosMobileAberto(!filtrosMobileAberto)}>
          <i className="fas fa-filter"></i>
          <span>{filtrosMobileAberto ? 'Fechar Filtros' : 'Abrir Filtros'}</span>
          {filtrosAtivosCount > 0 && <span className="gs-filtro-badge">{filtrosAtivosCount}</span>}
        </button>
      </div>

      {/* CONTEÚDO DOS FILTROS */}
      <div className={`gs-filtros-acordeao-conteudo ${filtrosMobileAberto ? 'aberto' : ''}`}>
        <div className="gs-filtros-paineis">
          <SecaoFiltro titulo="Produto" opcoes={opcoesDeFiltro?.produtos || []} filtrosSelecionados={filtros.produtos || []} onFiltroChange={(opcao) => handleFiltroCheckboxChange('produtos', opcao)} />
          <SecaoFiltro titulo="Cor" opcoes={opcoesDeFiltro?.cores || []} filtrosSelecionados={filtros.cores || []} onFiltroChange={(opcao) => handleFiltroCheckboxChange('cores', opcao)} />
          <SecaoFiltro titulo="Tamanho" opcoes={opcoesDeFiltro?.tamanhos || []} filtrosSelecionados={filtros.tamanhos || []} onFiltroChange={(opcao) => handleFiltroCheckboxChange('tamanhos', opcao)} />
          
          <div className="gs-filtro-secao">
            <h4 className="gs-filtro-titulo">Ordenar por</h4>
            <select className="gs-select" value={filtros.ordenacao} onChange={handleOrdenacaoChange}>
              <option value="mais_recentes">Mais Recentes</option>
              <option value="mais_antigos">Mais Antigos</option>
              <option value="maior_quantidade">Maior Quantidade</option>
              <option value="menor_quantidade">Menor Quantidade</option>
            </select>
          </div>
        </div>
        <div className="gs-filtros-footer">
          <button className="gs-btn-link" onClick={handleLimparTodos}><i className="fas fa-times-circle"></i> Limpar todos os filtros</button>
        </div>
      </div>
       <EmbalagemLegendaStatus />
    </div>
  );
}

export default EmbalagemPainelFiltros;