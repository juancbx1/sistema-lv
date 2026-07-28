// public/src/components/OPFormulario.jsx

import React, { useState, useEffect } from 'react';
import { mostrarMensagem } from '/js/utils/popups.js';
import { obterProdutos as obterProdutosDoStorage } from '/js/utils/storage.js';

export default function OPFormulario({ corteSelecionado, onOPCriada, onSetGerando, demandaId }) {
    const [numeroOP, setNumeroOP] = useState('');
    const [dataEntrega, setDataEntrega] = useState(new Date().toISOString().split('T')[0]);
    const [observacoes, setObservacoes] = useState('');
    const [carregando, setCarregando] = useState(true);
    const [imagemVariante, setImagemVariante] = useState('/img/placeholder-image.png');

    // Novo Estado para Quantidade (Editável)
    // Começa com o total do corte, mas permite reduzir (Split)
    const [quantidadeOP, setQuantidadeOP] = useState(corteSelecionado?.quantidade || 0);

    // Limite máximo é o que tem no corte
    const maxQuantidade = corteSelecionado?.quantidade || 0;

    useEffect(() => {
        async function inicializarDados() {
            try {
                setCarregando(true);
                const token = localStorage.getItem('token');
                
                const numResponse = await fetch(`/api/ordens-de-producao?getNextNumber=true`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!numResponse.ok) throw new Error('Falha ao buscar numeração.');
                const numeros = await numResponse.json();
                const proximoNumero = (numeros.map(n => parseInt(n)).filter(n => !isNaN(n)).reduce((max, cur) => Math.max(max, cur), 0) || 0) + 1;
                setNumeroOP(proximoNumero.toString());

                const todosProdutos = await obterProdutosDoStorage();
                const produtoPai = todosProdutos.find(p => p.id === corteSelecionado.produto_id);
                
                if (produtoPai) {
                    let img = produtoPai.imagem; 
                    if (corteSelecionado.variante && produtoPai.grade) {
                        const variacaoItem = produtoPai.grade.find(g => g.variacao === corteSelecionado.variante);
                        if (variacaoItem && variacaoItem.imagem) img = variacaoItem.imagem;
                    }
                    setImagemVariante(img || '/img/placeholder-image.png');
                }

            } catch (err) {
                console.error(err);
                mostrarMensagem(err.message, 'erro');
                setNumeroOP((8000 + Math.floor(Math.random() * 1000)).toString());
            } finally {
                setCarregando(false);
            }
        }
        
        if (corteSelecionado) {
            inicializarDados();
        }
    }, [corteSelecionado]);

    // --- FUNÇÕES DO SELETOR DE QUANTIDADE ---
    const handleQuantidadeChange = (e) => {
        const valor = e.target.value;
        const valorNum = valor === '' ? 0 : parseInt(valor, 10);
        // Trava: Não permite digitar mais que o disponível
        if (valor === '' || (!isNaN(valorNum) && valorNum >= 0 && valorNum <= maxQuantidade)) {
            setQuantidadeOP(valor);
        }
    };

    const ajustarQuantidade = (ajuste) => {
        const atual = Number(quantidadeOP) || 0;
        const novoValor = Math.max(1, Math.min(maxQuantidade, atual + ajuste));
        setQuantidadeOP(novoValor);
    };

    const handleSalvarOP = async () => {
        if (!dataEntrega) return mostrarMensagem("Selecione uma data de entrega.", "aviso");
        
        const qtdFinal = parseInt(quantidadeOP);
        if (!qtdFinal || qtdFinal <= 0) return mostrarMensagem("Quantidade inválida.", "aviso");

        setCarregando(true);
        if(onSetGerando) onSetGerando(corteSelecionado.id);

        try {
            const token = localStorage.getItem('token');
            
            const opPayload = {
                numero: numeroOP,
                produto_id: corteSelecionado.produto_id,
                variante: corteSelecionado.variante,
                quantidade: qtdFinal,
                data_entrega: dataEntrega,
                observacoes: observacoes,
                // O backend define o status como produzindo ao criar a OP vinculada ao corte.
                                     // O backend do Split já trata status='usado' no corte.
                                     // Vamos manter 'produzindo' se já tiver corte.
                                     // Na verdade, a API POST decide o status.
                                     // Mas o payload pede status. Vamos mandar 'produzindo' pois já tem corte.
                corte_origem_id: corteSelecionado.id,
                demanda_id: demandaId || null
            };

            const response = await fetch('/api/ordens-de-producao', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(opPayload)
            });
            
            const opCriada = await response.json();
            if (opCriada.error) throw new Error(opCriada.error);
            
            mostrarMensagem(`OP #${opCriada.numero} criada com sucesso (${qtdFinal} pçs)!`, 'sucesso');
            onOPCriada();

        } catch (err) {
            if(onSetGerando) onSetGerando(null);
            console.error("Erro ao salvar OP:", err);
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        } finally {
            setCarregando(false);
        }
    };

    return (
        <div className="op-corte-registro-container">
            <div className="op-corte-resumo-card">
                <img src={imagemVariante} alt={corteSelecionado.produto} />
                <div className="op-corte-resumo-info">
                    <h4>{corteSelecionado.produto}</h4>
                    <p>{corteSelecionado.variante || 'Padrão'}</p>
                    <div style={{fontSize: '0.8rem', color: '#555', marginTop: '5px'}}>
                        PC Origem: <strong>{corteSelecionado.pn}</strong>
                    </div>
                </div>
            </div>

            <div className="op-form-estilizado" style={{ maxWidth: '500px', margin: '20px auto' }}>
                
                {/* --- SELETOR DE QUANTIDADE --- */}
                <div className="seletor-quantidade-wrapper" style={{boxShadow: 'none', border: '1px solid #eee', borderRadius: '8px', padding: '15px', marginBottom: '20px', backgroundColor: '#fdfdfd'}}>
                    <label style={{display: 'block', textAlign: 'center', marginBottom: '10px', color: '#555', fontWeight: '600'}}>Quantidade da OP</label>
                    
                    <div className="input-container">
                        <button type="button" className="ajuste-qtd-btn" onClick={() => ajustarQuantidade(-1)}>-</button>
                        <input 
                            type="number" 
                            className="op-input-tarefas"
                            value={quantidadeOP} 
                            onChange={handleQuantidadeChange}
                            max={maxQuantidade}
                        />
                        <button type="button" className="ajuste-qtd-btn" onClick={() => ajustarQuantidade(1)}>+</button>
                    </div>
                    
                    <div className="atalhos-qtd-container" style={{justifyContent: 'center', marginTop: '10px'}}>
                        <button type="button" className="atalho-qtd-btn" onClick={() => ajustarQuantidade(10)}>+10</button>
                        <button type="button" className="atalho-qtd-btn" onClick={() => ajustarQuantidade(50)}>+50</button>
                        <button type="button" className="atalho-qtd-btn" onClick={() => setQuantidadeOP(maxQuantidade)} style={{backgroundColor: '#eafaf1', color: '#27ae60', borderColor: '#27ae60'}}>Usar Tudo ({maxQuantidade})</button>
                    </div>
                    
                    <div style={{textAlign: 'center', fontSize: '0.8rem', color: '#999', marginTop: '10px'}}>
                        Disponível no Corte: <strong>{maxQuantidade}</strong> pçs
                    </div>
                </div>

                <div className="op-form-linha">
                    <div className="op-form-grupo">
                        <label>Número da OP</label>
                        <input type="text" className="op-input" value={numeroOP} readOnly disabled />
                    </div>
                    <div className="op-form-grupo">
                        <label htmlFor="dataEntregaOP">Data de Entrega</label>
                        <input type="date" id="dataEntregaOP" className="op-input" value={dataEntrega} onChange={(e) => setDataEntrega(e.target.value)} />
                    </div>
                </div>
                
                <div className="op-form-grupo">
                    <label htmlFor="observacoesOP">Observações (Opcional)</label>
                    <textarea id="observacoesOP" className="op-input" rows="3" value={observacoes} onChange={(e) => setObservacoes(e.target.value)}></textarea>
                </div>

                <div className="op-form-botoes" style={{ justifyContent: 'center', marginTop: '30px' }}>
                    <button className="op-botao op-botao-principal" onClick={handleSalvarOP} disabled={carregando}>
                        {carregando ? <div className="spinner-btn-interno"></div> : <i className="fas fa-check"></i>}
                        {carregando ? 'Aguarde...' : 'Confirmar e Criar OP'}
                    </button>
                </div>
            </div>
        </div>
    );
}
