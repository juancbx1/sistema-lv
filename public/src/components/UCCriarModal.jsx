import React, { useState } from 'react';
import Select from 'react-select';
import { mostrarToast } from '/js/utils/popups.js';
import { fetchAPI } from '/js/utils/api-utils.js';

const TIPOS_DISPONIVEIS = [
    { id: 'socio', label: 'Sócio' },
    { id: 'ex_socio', label: 'Ex-sócio' },
    { id: 'administrador', label: 'Administrador' },
    { id: 'supervisor', label: 'Supervisor' },
    { id: 'lider_setor', label: 'Líder de Setor' },
    { id: 'costureira', label: 'Costureira' },
    { id: 'tiktik', label: 'TikTik' },
    { id: 'cortador', label: 'Cortador' },
    { id: 'prestador_externo', label: 'Prestador Externo' },
];

const PRODUTIVOS = ['costureira', 'tiktik', 'cortador', 'supervisor', 'lider_setor'];

export default function UCCriarModal({ onClose, aoSalvar, concessionarias }) {
    const [formData, setFormData] = useState({
        nome: '',
        nomeUsuario: '',
        email: '',
        senha: '',
        tipos: [],
        nivel: '',
        salario_fixo: 0,
        valor_passagem_diaria: 0,
        desconto_inss_percentual: 9.0,
        desconto_vt_percentual: 6.0,
        concessionaria_ids: [],
    });
    const [mostrarSenha, setMostrarSenha] = useState(false);
    const [loading, setLoading] = useState(false);

    const tipos = formData.tipos;
    const ehSocio = tipos.includes('socio');
    const ehExterno = tipos.includes('prestador_externo');
    const temProdutivo = tipos.some(t => PRODUTIVOS.includes(t));
    const mostrarFinanceiro = temProdutivo && !ehSocio && !ehExterno;

    let hintFinanceiro = '';
    if (ehSocio) hintFinanceiro = 'Sócios não possuem dados financeiros no sistema.';
    else if (ehExterno) hintFinanceiro = 'Prestadores externos não possuem dados financeiros.';
    else if (!temProdutivo && tipos.includes('administrador')) hintFinanceiro = 'Administradores não possuem dados financeiros.';

    const concessOptions = (concessionarias || []).map(c => ({ value: c.id, label: c.nome }));

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleTipoChange = (tipoId) => {
        setFormData(prev => {
            if (prev.tipos.includes(tipoId)) {
                return { ...prev, tipos: prev.tipos.filter(t => t !== tipoId) };
            }
            let novosTipos = [...prev.tipos, tipoId];
            if (tipoId === 'socio') novosTipos = novosTipos.filter(t => t !== 'ex_socio');
            if (tipoId === 'ex_socio') novosTipos = novosTipos.filter(t => t !== 'socio');
            return { ...prev, tipos: novosTipos };
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.nome || !formData.nomeUsuario || !formData.email || !formData.senha || formData.tipos.length === 0) {
            mostrarToast('Preencha todos os campos obrigatórios.', 'erro');
            return;
        }
        if (formData.senha.length < 6) {
            mostrarToast('A senha deve ter no mínimo 6 caracteres.', 'aviso');
            return;
        }
        setLoading(true);
        try {
            const payload = {
                ...formData,
                nivel: formData.nivel ? parseInt(formData.nivel) : null,
                salario_fixo: parseFloat(formData.salario_fixo),
                valor_passagem_diaria: parseFloat(formData.valor_passagem_diaria),
                desconto_inss_percentual: parseFloat(formData.desconto_inss_percentual),
                desconto_vt_percentual: parseFloat(formData.desconto_vt_percentual),
            };
            await fetchAPI('/api/usuarios', { method: 'POST', body: JSON.stringify(payload) });
            mostrarToast('Usuário cadastrado com sucesso!', 'sucesso');
            aoSalvar();
        } catch (error) {
            mostrarToast(error.message, 'erro');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="uc-modal-overlay" onClick={onClose}>
            <div className="uc-modal-content" onClick={e => e.stopPropagation()}>
                <div className="uc-modal-header">
                    <h2>Novo usuário</h2>
                    <button className="uc-modal-fechar" onClick={onClose} aria-label="Fechar">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <form className="uc-modal-corpo" onSubmit={handleSubmit}>

                    <div className="uc-modal-secao">
                        <h3 className="uc-modal-secao-titulo">Identificação</h3>
                        <div className="uc-form-grid">
                            <div className="uc-form-campo uc-form-campo--full">
                                <label>Nome completo *</label>
                                <input type="text" name="nome" className="gs-input" value={formData.nome} onChange={handleChange} placeholder="Ex: Maria Silva" />
                            </div>
                            <div className="uc-form-campo">
                                <label>Usuário (login) *</label>
                                <input type="text" name="nomeUsuario" className="gs-input" value={formData.nomeUsuario} onChange={handleChange} placeholder="Ex: maria.silva" />
                            </div>
                            <div className="uc-form-campo">
                                <label>Email *</label>
                                <input type="email" name="email" className="gs-input" value={formData.email} onChange={handleChange} placeholder="email@exemplo.com" />
                            </div>
                            <div className="uc-form-campo uc-form-campo--full">
                                <label>Senha *</label>
                                <div className="uc-senha-wrapper">
                                    <input
                                        type={mostrarSenha ? 'text' : 'password'}
                                        name="senha"
                                        className="gs-input"
                                        value={formData.senha}
                                        onChange={handleChange}
                                        placeholder="Mínimo 6 caracteres"
                                    />
                                    <button
                                        type="button"
                                        className="uc-senha-toggle"
                                        onClick={() => setMostrarSenha(p => !p)}
                                        tabIndex={-1}
                                    >
                                        <i className={`fas ${mostrarSenha ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="uc-modal-secao">
                        <h3 className="uc-modal-secao-titulo">Tipos de acesso *</h3>
                        <div className="uc-tipos-chips">
                            {TIPOS_DISPONIVEIS.map(tipo => (
                                <button
                                    key={tipo.id}
                                    type="button"
                                    className={`uc-tipo-chip${formData.tipos.includes(tipo.id) ? ' uc-tipo-chip--ativo' : ''}`}
                                    onClick={() => handleTipoChange(tipo.id)}
                                >
                                    {tipo.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {mostrarFinanceiro && (
                        <div className="uc-modal-secao uc-modal-secao--financeiro">
                            <h3 className="uc-modal-secao-titulo">Dados financeiros</h3>
                            <div className="uc-form-grid">
                                <div className="uc-form-campo">
                                    <label>Nível</label>
                                    <select name="nivel" className="gs-input" value={formData.nivel} onChange={handleChange}>
                                        <option value="">Selecione</option>
                                        <option value="1">Nível 1</option>
                                        <option value="2">Nível 2</option>
                                        <option value="3">Nível 3</option>
                                        <option value="4">Nível 4</option>
                                    </select>
                                </div>
                                <div className="uc-form-campo">
                                    <label>Salário fixo (R$)</label>
                                    <input type="number" name="salario_fixo" className="gs-input" step="0.01" value={formData.salario_fixo} onChange={handleChange} />
                                </div>
                                <div className="uc-form-campo">
                                    <label>Passagem/dia (R$)</label>
                                    <input type="number" name="valor_passagem_diaria" className="gs-input" step="0.01" value={formData.valor_passagem_diaria} onChange={handleChange} />
                                </div>
                                <div className="uc-form-campo">
                                    <label>% Desc. INSS</label>
                                    <input type="number" name="desconto_inss_percentual" className="gs-input" step="0.1" value={formData.desconto_inss_percentual} onChange={handleChange} />
                                </div>
                                <div className="uc-form-campo">
                                    <label>% Desc. VT</label>
                                    <input type="number" name="desconto_vt_percentual" className="gs-input" step="0.1" value={formData.desconto_vt_percentual} onChange={handleChange} />
                                </div>
                                <div className="uc-form-campo uc-form-campo--full">
                                    <label>Concessionárias VT</label>
                                    <Select
                                        isMulti
                                        options={concessOptions}
                                        placeholder="Selecione..."
                                        onChange={(opts) => setFormData(prev => ({ ...prev, concessionaria_ids: opts.map(o => o.value) }))}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {hintFinanceiro && (
                        <p className="uc-hint-financeiro">
                            <i className="fas fa-info-circle"></i> {hintFinanceiro}
                        </p>
                    )}

                    <div className="uc-modal-footer">
                        <button type="button" className="gs-btn gs-btn-secundario" onClick={onClose} disabled={loading}>
                            Cancelar
                        </button>
                        <button type="submit" className="gs-btn gs-btn-primario" disabled={loading}>
                            {loading ? 'Criando...' : 'Criar usuário'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
