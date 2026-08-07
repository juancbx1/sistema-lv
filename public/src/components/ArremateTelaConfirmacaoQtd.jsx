// public/src/components/TelaConfirmacaoQtd.jsx

import React, { useState } from 'react';

import { getImagemVariacao } from '../utils/ArremateProdutoHelpers.js';
import UICarregando from './UICarregando';


export default function TelaConfirmacaoQtd({ item, tiktik, onVoltar, onConfirmar }) {
    // --- ESTADOS DO COMPONENTE ---
    const [quantidade, setQuantidade] = useState(item.saldo_para_arrematar);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState('');

    // --- VARIÁVEIS E HELPERS ---
    const imagemSrc = getImagemVariacao(item, item.variante);

    const saldoDisponivel = item.saldo_para_arrematar;
    const quantidadeNumerica = Number(quantidade) || 0;
    const saldoRestante = saldoDisponivel - quantidadeNumerica;

    // Função para lidar com os cliques nos botões de atalho (+10, +50, TUDO)
    const handleAtalhoQtd = (atalho) => {
        if (atalho === 'tudo') {
            setQuantidade(saldoDisponivel);
        } else {
            const incremento = Number(atalho);
            setQuantidade(valorAtual => Math.min(saldoDisponivel, (Number(valorAtual) || 0) + incremento));
        }
    };

    // Função chamada ao clicar no botão principal "Confirmar Atribuição"
    const handleConfirmar = async () => {
        setCarregando(true);
        setErro('');
        try {
            const token = localStorage.getItem('token');

            if (tiktik.id === null) {
                // P. Externo: distribui a quantidade pelas OPs e usa /api/arremates/externo
                let quantidadeRestante = quantidadeNumerica;
                const opsOrdenadas = (item.ops_detalhe || []).sort((a, b) => a.numero - b.numero);
                const itensPayload = [];

                for (const op of opsOrdenadas) {
                    if (quantidadeRestante <= 0) break;
                    const qtdParaOp = Math.min(quantidadeRestante, op.saldo_op);
                    if (qtdParaOp > 0) {
                        itensPayload.push({
                            op_numero: op.numero,
                            op_edit_id: op.edit_id,
                            produto_id: item.produto_id,
                            variante: item.variante === '-' ? null : item.variante,
                            quantidade_arrematada: qtdParaOp,
                        });
                        quantidadeRestante -= qtdParaOp;
                    }
                }

                if (itensPayload.length === 0) throw new Error('Nenhuma OP disponível para este produto.');

                const response = await fetch('/api/arremates/externo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ itens: itensPayload }),
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Erro ao registrar arremate externo.');
                }
            } else {
                // Tiktik regular: usa sessão
                const payload = {
                    usuario_tiktik_id: tiktik.id,
                    produto_id: item.produto_id,
                    variante: item.variante === '-' ? null : item.variante,
                    quantidade_entregue: quantidade,
                    dados_ops: item.ops_detalhe,
                };

                const response = await fetch('/api/arremates/sessoes/iniciar', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Erro desconhecido ao atribuir tarefa');
                }
            }

            // Avisa o componente pai que a operação foi um sucesso
            onConfirmar();

        } catch (err) {
            console.error("Erro ao atribuir tarefa:", err);
            setErro(err.message);
            setCarregando(false);
        }
    };

    // --- RENDERIZAÇÃO DO COMPONENTE (JSX) ---
    return (
        <div className="coluna-confirmacao" style={{display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px', overflowY: 'auto'}}>
            {onVoltar && (
                <button className="btn-voltar-header" onClick={onVoltar} style={{ alignSelf: 'flex-start', marginBottom: '8px' }}>
                    <i className="fas fa-arrow-left"></i>
                    <span>Voltar</span>
                </button>
            )}
            <img src={imagemSrc} alt={item.produto_nome} className="img-confirmacao" />
            <h4>{item.produto_nome}</h4>
            <p>{item.variante && item.variante !== '-' ? item.variante : 'Padrão'}</p>
            
            <div className="info-saldo-atribuir">
                <div className="saldo-item">
                    <label>Disponível</label>
                    <span className="saldo-valor pendente">{saldoDisponivel}</span>
                </div>
                <div className="saldo-item">
                    <label>Restará</label>
                    <span className="saldo-valor restante">{saldoRestante >= 0 ? saldoRestante : '--'}</span>
                </div>
            </div>

            {/* <<< ESTE É O BLOCO COMPLETAMENTE REDESENHADO >>> */}
            <div className="seletor-quantidade-wrapper">
                <label htmlFor="inputQuantidadeAtribuir">Quantidade a Arrematar</label>
                <div className="input-container">
                    <button type="button" className="ajuste-qtd-btn" onClick={() => setQuantidade(q => Math.max(0, (Number(q) || 0) - 1))}>-</button>
                    <input 
                        type="number" 
                        id="inputQuantidadeAtribuir"
                        className="oa-input-tarefas"
                        value={quantidade}
                        onChange={(e) => {
                            const valor = e.target.value;
                            if (valor === '' || (Number(valor) >= 0 && Number(valor) <= saldoDisponivel)) {
                                setQuantidade(valor);
                            }
                        }}
                        max={saldoDisponivel}
                    />
                    <button type="button" className="ajuste-qtd-btn" onClick={() => setQuantidade(q => Math.min(saldoDisponivel, (Number(q) || 0) + 1))}>+</button>
                </div>
                
                <div className="atalhos-qtd-container">
                    <button type="button" className="atalho-qtd-btn" onClick={() => handleAtalhoQtd(10)}>+10</button>
                    <button type="button" className="atalho-qtd-btn" onClick={() => handleAtalhoQtd(50)}>+50</button>
                    <button type="button" className="atalho-qtd-btn" onClick={() => handleAtalhoQtd('tudo')}>Máx.</button>
                </div>
            </div>
            
            {erro && <p className="erro-painel" style={{marginTop: '15px', color: 'red', textAlign: 'center'}}>{erro}</p>}

            <button 
                id="btnConfirmarAtribuicao" 
                className="oa-btn oa-btn-sucesso"
                style={{width: '100%', maxWidth: '280px', marginTop: 'auto', paddingTop: '12px', paddingBottom: '12px'}}
                onClick={handleConfirmar}
                disabled={carregando || quantidadeNumerica <= 0 || quantidadeNumerica > saldoDisponivel}
            >
                {carregando ? <UICarregando variante="inline" /> : <i className="fas fa-check"></i>}
                {carregando ? 'Atribuindo...' : ' Lançar Arremate'}
            </button>
        </div>
    );
}
