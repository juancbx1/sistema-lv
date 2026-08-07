import React, { useState, useMemo } from 'react';
import { mostrarToast } from '/js/utils/popups.js';
import UICarregando from './UICarregando';

function hojeEmSP() {
    return new Date().toLocaleDateString('sv', { timeZone: 'America/Sao_Paulo' });
}

function PGPontosExtrasModal({ funcionarios, todasMetas, dataReferencia, onFechar, onSucesso }) {
    const [funcionarioId, setFuncionarioId] = useState(null); // integer
    const [pontos, setPontos]               = useState('');
    const [motivo, setMotivo]               = useState('');
    const [dataRef, setDataRef]             = useState(dataReferencia || hojeEmSP());
    const [loading, setLoading]             = useState(false);
    const [erro, setErro]                   = useState(null);

    const funcionarioSel = useMemo(
        () => funcionarios.find(f => f.id === funcionarioId) || null,
        [funcionarios, funcionarioId]
    );

    const aviso = useMemo(() => {
        if (!funcionarioSel || !pontos || parseFloat(pontos) <= 0) return null;
        const prodReal = funcionarioSel.pontos_hoje || 0;
        if (prodReal <= 0) return null;
        const pct = (parseFloat(pontos) / prodReal) * 100;
        if (pct <= 5) return null;
        return `Atenção: ${pct.toFixed(0)}% da produção real do dia (${prodReal.toFixed(0)} pts)`;
    }, [funcionarioSel, pontos]);

    const podeConfirmar =
        funcionarioId !== null &&
        parseFloat(pontos) > 0 &&
        motivo.trim().length >= 10 &&
        dataRef &&
        !loading;

    async function confirmar() {
        setErro(null);
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/pontos-extras', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    funcionario_id: funcionarioId,
                    pontos: parseFloat(pontos),
                    motivo: motivo.trim(),
                    data_referencia: dataRef,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao lançar pontos extras.');

            const primeiroNome = funcionarioSel?.nome?.split(' ')[0] || 'funcionário';
            mostrarToast(
                `✨ ${parseFloat(pontos).toFixed(0)} pts lançados para ${primeiroNome}!`,
                'sucesso',
                2000
            );
            onSucesso();
        } catch (e) {
            setErro(e.message);
            setLoading(false);
        }
    }

    function fecharAoClicarFora(e) {
        if (loading) return;
        if (e.target === e.currentTarget) onFechar();
    }

    // ── Modal normal ─────────────────────────────────────────────
    return (
        <div className="pg-modal-overlay" onClick={fecharAoClicarFora}>
            <div className="pg-modal-conteudo pg-modal-pontos-extras">
                <div className="pg-modal-header">
                    <div className="pg-modal-identidade">
                        <i className="fas fa-star" style={{ fontSize: '1.4rem', color: '#f59e0b' }}></i>
                        <div>
                            <p className="pg-modal-nome">Lançar Pontos Extras</p>
                            <span className="pg-modal-sub">Compensação por fatores externos</span>
                        </div>
                    </div>
                    <button className="pg-modal-fechar" onClick={onFechar}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="pg-modal-bloco">

                    {/* ── Grid de funcionários ── */}
                    <div className="pg-pe-campo">
                        <label className="pg-pe-label">Selecione o funcionário</label>
                        <div className="pg-pe-grid-funcionarios">
                            {funcionarios.map(f => {
                                const foto     = f.foto_oficial || f.avatar_url;
                                const isTiktik = (Array.isArray(f.tipos) ? f.tipos : []).includes('tiktik');
                                const sel      = f.id === funcionarioId;
                                const iniciais = f.nome.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
                                const primeiroNome = f.nome.split(' ')[0];
                                return (
                                    <button
                                        key={f.id}
                                        type="button"
                                        className={[
                                            'pg-pe-avatar-btn',
                                            sel      ? 'pg-pe-avatar-btn--sel'    : '',
                                            isTiktik ? 'pg-pe-avatar-btn--tiktik' : '',
                                        ].join(' ')}
                                        onClick={() => setFuncionarioId(f.id)}
                                        title={`${f.nome} · ${isTiktik ? 'Tiktik' : 'Costureira'} Nv.${f.nivel}`}
                                    >
                                        <div className="pg-pe-avatar-circulo">
                                            {foto
                                                ? <img src={foto} alt={f.nome} className="pg-pe-avatar-img" />
                                                : <span className="pg-pe-avatar-iniciais">{iniciais}</span>
                                            }
                                            {sel && (
                                                <div className="pg-pe-avatar-check">
                                                    <i className="fas fa-check"></i>
                                                </div>
                                            )}
                                        </div>
                                        <span className="pg-pe-avatar-nome">{primeiroNome}</span>
                                    </button>
                                );
                            })}
                        </div>
                        {/* Nome completo do selecionado */}
                        {funcionarioSel && (
                            <p className="pg-pe-func-selecionado">
                                <i className="fas fa-circle-check" style={{ color: '#f59e0b' }}></i>
                                {' '}{funcionarioSel.nome}
                                {' '}·{' '}
                                {(Array.isArray(funcionarioSel.tipos) && funcionarioSel.tipos.includes('tiktik'))
                                    ? 'Tiktik' : 'Costureira'}
                                {' '}Nv.{funcionarioSel.nivel}
                                {funcionarioSel.pontos_hoje > 0 && (
                                    <span className="pg-pe-func-pontos-hoje">
                                        {' — '}{funcionarioSel.pontos_hoje.toFixed(0)} pts hoje
                                    </span>
                                )}
                            </p>
                        )}
                    </div>

                    {/* ── Pontos + Data ── */}
                    <div className="pg-pe-linha-2">
                        <div className="pg-pe-campo">
                            <label className="pg-pe-label">Pontos</label>
                            <input
                                type="number"
                                className="pg-pe-input"
                                min="0.1"
                                step="0.1"
                                placeholder="Ex: 50"
                                value={pontos}
                                onChange={e => setPontos(e.target.value)}
                            />
                        </div>
                        <div className="pg-pe-campo">
                            <label className="pg-pe-label">Data de referência</label>
                            <input
                                type="date"
                                className="pg-pe-input"
                                value={dataRef}
                                max={hojeEmSP()}
                                onChange={e => setDataRef(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* ── Motivo ── */}
                    <div className="pg-pe-campo">
                        <label className="pg-pe-label">
                            Motivo <span className="pg-pe-min">(mínimo 10 caracteres)</span>
                        </label>
                        <textarea
                            className="pg-pe-textarea"
                            rows={3}
                            placeholder="Ex: Máquina em manutenção por 1h, aguardou fila..."
                            value={motivo}
                            onChange={e => setMotivo(e.target.value)}
                        />
                    </div>

                    {aviso && (
                        <div className="pg-pontos-extras-aviso">
                            <i className="fas fa-triangle-exclamation"></i>
                            {aviso}
                        </div>
                    )}

                    {erro && (
                        <div className="pg-pe-erro">
                            <i className="fas fa-exclamation-circle"></i>
                            {erro}
                        </div>
                    )}
                </div>

                <div className="pg-modal-bloco pg-pe-acoes">
                    <button className="gs-btn gs-btn-secundario" onClick={onFechar} disabled={loading}>
                        Cancelar
                    </button>
                    <button
                        className="gs-btn pg-btn-pontos-extras"
                        onClick={confirmar}
                        disabled={!podeConfirmar}
                    >
                        {loading
                            ? <UICarregando variante="inline" />
                            : <i className="fas fa-star"></i>
                        }
                        Confirmar Lançamento
                    </button>
                </div>
            </div>
        </div>
    );
}

export default PGPontosExtrasModal;
