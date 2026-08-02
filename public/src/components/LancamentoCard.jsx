// public/src/components/LancamentoCard.jsx
import React from 'react';

// Função auxiliar para formatar moeda. Podemos criar um arquivo só para utils depois.
const formatCurrency = (value) => {
    const numberValue = parseFloat(value);
    if (isNaN(numberValue)) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numberValue);
};

// Função para formatar data e hora
const formatDateTime = (isoString) => {
    if (!isoString) return 'N/A';
    return new Date(isoString).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
};

const LancamentoCard = ({ lancamento, onEdit, onDelete, onShowDetails }) => {
    // Lógica de classes e cores
    const tipoClasse = lancamento.tipo ? lancamento.tipo.toLowerCase() : 'despesa';
    const isPendente = lancamento.status_edicao?.startsWith('PENDENTE');
    const classePendente = isPendente ? 'pendente' : '';
    const isDetalhado = lancamento.itens && lancamento.itens.length > 0;

    // Lógica para nome da categoria
    let categoriaExibida = lancamento.nome_categoria || 'Sem Categoria';
    if (isDetalhado) {
        if (lancamento.tipo_rateio === 'COMPRA') categoriaExibida = 'Compra Detalhada';
        else if (lancamento.tipo_rateio === 'DETALHADO') categoriaExibida = `Rateio: ${lancamento.nome_categoria || ''}`;
    } else if (lancamento.id_transferencia_vinculada) {
        categoriaExibida = 'Transferência';
    }

    // Renderização para Transferências
    if (lancamento.id_transferencia_vinculada) {
        // Esta parte do código espera que o backend já tenha feito o JOIN e traga os nomes.
        // Vamos assumir que `lancamento` já tem as informações de origem e destino se for o caso.
        // A lógica completa para agrupar as duas partes da transferência ficará no componente pai.
        // Aqui, apenas renderizamos o card de forma simples.
        return (
            <div className={`fc-lancamento-card transferencia ${classePendente}`}>
                <div className="card-main-line">
                    <div className="main-info">
                        <span className="lancamento-id">#{lancamento.id} (Transferência)</span>
                        <span className="descricao">{lancamento.descricao || 'Transferência entre Contas'}</span>
                    </div>
                    <span className="valor" style={{ color: tipoClasse === 'receita' ? 'var(--gs-sucesso)' : 'var(--gs-perigo)'}}>
                        {tipoClasse === 'receita' ? '+' : '-'} {formatCurrency(lancamento.valor)}
                    </span>
                </div>
                 <div className="card-details">
                    <span className="detail-item"><i className="fas fa-university"></i><b>Conta:</b> {lancamento.nome_conta}</span>
                    <span className="detail-item"><i className="fas fa-calendar-day"></i><b>Data:</b> {new Date(lancamento.data_transacao).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>
                </div>
                <div className="card-meta-line">
                    <div className="meta-info">
                        <span className="detail-item"><i className="fas fa-user-tie"></i><b>Criado por:</b> {lancamento.nome_usuario}</span>
                    </div>
                    <div className="actions">
                        {/* Ações para transferência podem ser adicionadas aqui no futuro */}
                    </div>
                </div>
            </div>
        );
    }
    
    // Renderização Padrão (Simples, Compra, Rateio)
    return (
        <div className={`fc-lancamento-card ${tipoClasse} ${classePendente}`}>
            {/* LINHA PRINCIPAL: ID, Descrição e Valor */}
            <div className="card-main-line">
                <div className="main-info">
                    <span className="lancamento-id">#{lancamento.id}</span>
                    <span className="descricao">{lancamento.descricao || 'Lançamento sem descrição'}</span>
                </div>
                <span className="valor">{lancamento.tipo === 'RECEITA' ? '+' : '-'} {formatCurrency(lancamento.valor)}</span>
            </div>

            {/* BLOCO DE DETALHES */}
            <div className="card-details">
                <span className="detail-item"><i className="fas fa-user-friends"></i><b>Favorecido:</b> {
                    (() => {
                        if (lancamento.tipo_rateio === 'DETALHADO' && Array.isArray(lancamento.itens) && lancamento.itens.length >= 2) {
                            const nomes = [...new Set(lancamento.itens.map((i) => i.nome_contato_item).filter(Boolean))];
                            if (nomes.length >= 2 || lancamento.itens.length >= 2) return 'Diversos';
                            if (nomes.length === 1) return nomes[0];
                        }
                        return lancamento.nome_favorecido || '-';
                    })()
                }</span>
                <span className="detail-item"><i className="fas fa-tag"></i><b>Categoria:</b> {categoriaExibida}</span>
                <span className="detail-item"><i className="fas fa-university"></i><b>Conta:</b> {lancamento.nome_conta}</span>
                <span className="detail-item"><i className="fas fa-calendar-day"></i><b>Data:</b> {new Date(lancamento.data_transacao).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>
                {lancamento.valor_desconto > 0 && (
                     <span className="detail-item" style={{ color: 'var(--gs-sucesso)' }}><i className="fas fa-percent"></i><b>Desconto:</b> - {formatCurrency(lancamento.valor_desconto)}</span>
                )}
            </div>

            {/* LINHA DE METADADOS E AÇÕES */}
            <div className="card-meta-line">
                <div className="meta-info">
                    <span className="detail-item" title={`Criado em ${formatDateTime(lancamento.data_lancamento)}`}>
                        <i className="fas fa-user-tie"></i>
                        <b>Criado por:</b> {lancamento.nome_usuario || 'N/A'}
                    </span>
                    {/* NOVO: Informação de Edição */}
                    {lancamento.nome_usuario_edicao && (
                         <span className="detail-item" title={`Editado em ${formatDateTime(lancamento.atualizado_em)}`} style={{color: 'var(--gs-perigo)'}}>
                            <i className="fas fa-history"></i>
                            <b>Editado por:</b> {lancamento.nome_usuario_edicao}
                        </span>
                    )}
                </div>

                <div className="actions">
                    {isDetalhado && (
                        <button className="fc-btn-icon" onClick={() => onShowDetails(lancamento.id)} title="Ver Detalhes">
                            <i className="fas fa-chevron-down"></i>
                        </button>
                    )}
                    <button 
                        className="fc-btn-icon btn-editar-lancamento" 
                        onClick={() => onEdit(lancamento)}
                        title="Editar"
                        disabled={isPendente || lancamento.status_edicao === 'ESTORNADO'}
                    >
                        <i className="fas fa-pencil-alt"></i>
                    </button>
                    <button 
                        className="fc-btn-icon btn-excluir-lancamento" 
                        onClick={() => onDelete(lancamento.id)}
                        title="Excluir"
                        disabled={isPendente || lancamento.status_edicao === 'ESTORNADO'}
                    >
                        <i className="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LancamentoCard;