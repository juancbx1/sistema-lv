// public/src/components/FormularioPerda.jsx

import React, { useState } from 'react';
import { getImagemVariacao } from '../utils/ArremateProdutoHelpers.js';
import UICarregando from './UICarregando';

import { mostrarMensagem } from '/js/utils/popups.js';

export default function FormularioPerda({ item, onConfirmar }) {
    const [motivo, setMotivo] = useState('');
    const [quantidade, setQuantidade] = useState(1);
    const [observacao, setObservacao] = useState('');
    const [carregando, setCarregando] = useState(false);
    

    const saldoDisponivel = item.saldo_para_arrematar;
    const imagemSrc = getImagemVariacao(item, item.variante);

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Validações iniciais com feedback para o usuário
        if (!motivo) {
            mostrarMensagem('Por favor, selecione um motivo para a perda.', 'aviso');
            return;
        }
        const qtdNum = Number(quantidade);
        if (isNaN(qtdNum) || qtdNum <= 0 || qtdNum > saldoDisponivel) {
            mostrarMensagem(`A quantidade deve ser um número entre 1 e ${saldoDisponivel}.`, 'aviso');
            return;
        }

        setCarregando(true);

        try {
            const token = localStorage.getItem('token');
            const payload = {
                produto_id: item.produto_id,
                variante: item.variante === '-' ? null : item.variante,
                quantidadePerdida: qtdNum,
                motivo: motivo,
                observacao: observacao,
                opsOrigem: item.ops_detalhe
            };

            console.log("Enviando payload para registrar perda:", payload); // Log para depuração

            const response = await fetch('/api/arremates/registrar-perda', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                // Lança um erro para ser pego pelo bloco catch
                throw new Error(errorData.error || 'Erro desconhecido ao registrar perda.');
            }

            // Se a requisição foi bem-sucedida
            mostrarMensagem('Perda registrada com sucesso!', 'sucesso', 2500);
            
            // Chama a função do componente pai para fechar o modal e atualizar a lista
            onConfirmar();

        } catch (err) {
            console.error("Erro ao registrar perda:", err);
            // Mostra o erro da API para o usuário
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        } finally {
            setCarregando(false);
        }
    };

    return (
        <div className="coluna-confirmacao" style={{display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px'}}>
            <img src={imagemSrc} alt={item.produto_nome} className="img-confirmacao" />
            <h4>{item.produto_nome}</h4>
            <p style={{marginBottom: '20px'}}>{item.variante && item.variante !== '-' ? item.variante : 'Padrão'}</p>

            <form onSubmit={handleSubmit} className="form-card-perda">
                <div className="oa-form-grupo">
                    <label htmlFor="selectMotivoPerda">Motivo da Perda</label>
                    <select id="selectMotivoPerda" className="oa-select" value={motivo} onChange={e => setMotivo(e.target.value)} required>
                        <option value="" disabled>Selecione um motivo...</option>
                        <option value="PRODUTO_AVARIADO">Produto Avariado</option>
                        <option value="DIVERGENCIA_SALDO">Divergência de Saldo</option>
                        <option value="LANCAMENTO_ERRADO">Lançamento Errado</option>
                    </select>
                </div>

                <div className="oa-form-grupo seletor-quantidade-perda">
                    <label>Quantidade a ser Descontada</label>
                    <div className="input-container-perda">
                        <button type="button" className="ajuste-qtd-btn" onClick={() => setQuantidade(q => Math.max(1, (Number(q) || 1) - 1))}>-</button>
                        <input 
                            type="number" 
                            className="oa-input-tarefas" 
                            min="1" 
                            max={saldoDisponivel}
                            value={quantidade}
                            onChange={e => setQuantidade(e.target.value)}
                            required 
                        />
                        <button type="button" className="ajuste-qtd-btn" onClick={() => setQuantidade(q => Math.min(saldoDisponivel, (Number(q) || 0) + 1))}>+</button>
                    </div>
                    <span className="saldo-maximo-info">Saldo máximo disponível: {saldoDisponivel}</span>
                </div>

                <div className="oa-form-grupo">
                    <label htmlFor="textareaObservacaoPerda">Observação (Opcional)</label>
                    <textarea 
                        id="textareaObservacaoPerda" 
                        className="oa-textarea" 
                        rows="3" 
                        placeholder="Ex: Peça rasgada, contagem errada..."
                        value={observacao}
                        onChange={e => setObservacao(e.target.value)}
                    ></textarea>
                </div>

                <button type="submit" className="oa-btn oa-btn-perigo" disabled={carregando} style={{width: '100%', marginTop: '10px'}}>
                    {carregando ? <UICarregando variante="inline" /> : <i className="fas fa-save"></i>}
                    {carregando ? 'Registrando...' : 'Confirmar Perda'}
                </button>
            </form>
        </div>
    );
}
