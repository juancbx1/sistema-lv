import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
// @ts-expect-error módulo JS legado sem tipos
import { fetchAPI } from '/js/utils/api-utils';
import type { DashTabelaProduto } from '../utils/dashboard-types';

export default function DashTabelaPontosModal({ onClose }: { onClose: () => void }) {
    const [dados, setDados] = useState<DashTabelaProduto[] | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAPI('/api/dashboard/minha-tabela-pontos')
            .then(setDados)
            .catch(() => setDados([] as DashTabelaProduto[]))
            .finally(() => setLoading(false));
    }, []);

    return ReactDOM.createPortal(
        <div className="ds-popup-overlay ativo" onClick={onClose}>
            <div
                className="ds-modal-assinatura-content"
                onClick={e => e.stopPropagation()}
                style={{ textAlign: 'left', padding: '24px', maxWidth: '420px', position: 'relative' }}
            >
                <button className="ds-modal-close-simple" onClick={onClose}>
                    <i className="fas fa-times"></i>
                </button>

                <h3 style={{ margin: '0 0 4px', color: 'var(--ds-cor-azul-escuro)', fontSize: '1.1rem' }}>
                    <i className="fas fa-star" style={{ marginRight: '8px', color: 'var(--ds-cor-aviso)' }}></i>
                    Minha Tabela de Pontos
                </h3>
                <p style={{ fontSize: '0.78rem', color: '#999', margin: '0 0 20px' }}>
                    Quanto vale cada processo que você produz
                </p>

                {loading ? (
                    <div style={{ padding: '30px', textAlign: 'center' }}>
                        <div className="ds-spinner"></div>
                    </div>
                ) : !dados || dados.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '0.88rem' }}>
                        Nenhum produto encontrado no seu histórico recente.
                    </div>
                ) : (
                    <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: '4px' }}>
                        {dados.map((produto, pi) => {
                            const totalPorPeca = (produto.processos || []).reduce((s, p) => s + Number(p.pontos || 0), 0);
                            return (
                                <div key={pi} style={{
                                    padding: '14px 0',
                                    borderTop: pi > 0 ? '1px solid #f0f0f0' : 'none'
                                }}>
                                    {/* Cabeçalho do produto */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                                        {produto.produto_imagem ? (
                                            <img
                                                src={produto.produto_imagem}
                                                alt={produto.produto_nome || undefined}
                                                style={{ width: 44, height: 44, borderRadius: '8px', objectFit: 'cover', flexShrink: 0, border: '1px solid #eee' }}
                                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                            />
                                        ) : (
                                            <div style={{ width: 44, height: 44, borderRadius: '8px', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                <i className="fas fa-box" style={{ color: '#ccc' }}></i>
                                            </div>
                                        )}
                                        <div style={{ fontWeight: '700', fontSize: '0.95rem', color: 'var(--ds-cor-azul-escuro)' }}>
                                            {produto.produto_nome}
                                        </div>
                                    </div>

                                    {/* Processos */}
                                    <div style={{ paddingLeft: '4px' }}>
                                        {(produto.processos || []).map((proc, ci) => (
                                            <div key={ci} style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                padding: '6px 0',
                                                borderBottom: ci < (produto.processos || []).length - 1 ? '1px dashed #f0f0f0' : 'none'
                                            }}>
                                                <span style={{ fontSize: '0.88rem', color: '#555' }}>
                                                    <i className="fas fa-circle" style={{ fontSize: '0.35rem', marginRight: '8px', color: '#ccc', verticalAlign: 'middle' }}></i>
                                                    {proc.nome}
                                                </span>
                                                <strong style={{ fontSize: '0.9rem', color: 'var(--ds-cor-primaria)', whiteSpace: 'nowrap', marginLeft: '8px' }}>
                                                    {Number(proc.pontos || 0).toFixed(2)} pts
                                                </strong>
                                            </div>
                                        ))}
                                        {/* Total por peça */}
                                        <div style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            marginTop: '8px',
                                            paddingTop: '8px',
                                            borderTop: '2px solid #eee'
                                        }}>
                                            <span style={{ fontSize: '0.85rem', fontWeight: '700', color: '#333' }}>Total por peça</span>
                                            <strong style={{ fontSize: '1rem', color: 'var(--ds-cor-sucesso)' }}>
                                                {totalPorPeca.toFixed(2)} pts
                                            </strong>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
