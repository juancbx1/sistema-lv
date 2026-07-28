import React, { useState } from 'react';

const VAZIA = {
    codigo: '',
    razao_social: '',
    nome_fantasia: '',
    cnpj: '',
    logo_url: '',
    cor_identificacao: '#2C3E50',
    telefone: '',
    email: '',
    cep: '',
    logradouro: '',
    numero_endereco: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
    timezone: 'America/Sao_Paulo',
    prefixo_op: '',
    numero_inicial_op: 1,
    ativa: true,
};

export default function GOEmpresaModal({ empresa, onClose, onSalvar }) {
    const [form, setForm] = useState({ ...VAZIA, ...(empresa || {}) });
    const [salvando, setSalvando] = useState(false);
    const [erro, setErro] = useState('');
    const alterar = (campo, valor) => setForm((atual) => ({ ...atual, [campo]: valor }));

    const salvar = async (event) => {
        event.preventDefault();
        setSalvando(true);
        setErro('');
        try {
            await onSalvar(form);
        } catch (error) {
            setErro(error.message);
        } finally {
            setSalvando(false);
        }
    };

    return (
        <div className="go-modal-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <form className="go-modal go-modal--grande" onSubmit={salvar}>
                <header>
                    <div>
                        <span className="go-modal-eyebrow">Perfil empresarial</span>
                        <h2>{empresa ? 'Editar empresa' : 'Nova empresa'}</h2>
                    </div>
                    <button type="button" className="go-btn-icone" onClick={onClose} aria-label="Fechar"><i className="fas fa-times"></i></button>
                </header>
                <div className="go-modal-corpo">
                    <section className="go-form-secao">
                        <h3>Identificação</h3>
                        <div className="go-form-grid">
                            <label>Nome fantasia
                                <input value={form.nome_fantasia} onChange={(e) => alterar('nome_fantasia', e.target.value)} required />
                            </label>
                            <label>Razão social
                                <input value={form.razao_social || ''} onChange={(e) => alterar('razao_social', e.target.value)} />
                            </label>
                            <label>Código interno
                                <input value={form.codigo} onChange={(e) => alterar('codigo', e.target.value.toLowerCase().replace(/\s+/g, '-'))} disabled={Boolean(empresa)} required />
                            </label>
                            <label>CNPJ
                                <input inputMode="numeric" value={form.cnpj || ''} onChange={(e) => alterar('cnpj', e.target.value)} />
                            </label>
                            <label>Cor de identificação
                                <span className="go-cor-input"><input type="color" value={form.cor_identificacao || '#2C3E50'} onChange={(e) => alterar('cor_identificacao', e.target.value)} /><input value={form.cor_identificacao || ''} onChange={(e) => alterar('cor_identificacao', e.target.value)} /></span>
                            </label>
                            <label>URL da logo
                                <input type="url" value={form.logo_url || ''} onChange={(e) => alterar('logo_url', e.target.value)} />
                            </label>
                        </div>
                    </section>
                    <section className="go-form-secao">
                        <h3>Contato e endereço</h3>
                        <div className="go-form-grid">
                            <label>Telefone<input value={form.telefone || ''} onChange={(e) => alterar('telefone', e.target.value)} /></label>
                            <label>E-mail<input type="email" value={form.email || ''} onChange={(e) => alterar('email', e.target.value)} /></label>
                            <label>CEP<input inputMode="numeric" value={form.cep || ''} onChange={(e) => alterar('cep', e.target.value)} /></label>
                            <label>Logradouro<input value={form.logradouro || ''} onChange={(e) => alterar('logradouro', e.target.value)} /></label>
                            <label>Número<input value={form.numero_endereco || ''} onChange={(e) => alterar('numero_endereco', e.target.value)} /></label>
                            <label>Complemento<input value={form.complemento || ''} onChange={(e) => alterar('complemento', e.target.value)} /></label>
                            <label>Bairro<input value={form.bairro || ''} onChange={(e) => alterar('bairro', e.target.value)} /></label>
                            <label>Cidade<input value={form.cidade || ''} onChange={(e) => alterar('cidade', e.target.value)} /></label>
                            <label>UF<input maxLength={2} value={form.estado || ''} onChange={(e) => alterar('estado', e.target.value.toUpperCase())} /></label>
                        </div>
                    </section>
                    <section className="go-form-secao">
                        <h3>Configuração operacional</h3>
                        <div className="go-form-grid">
                            <label>Fuso horário<input value={form.timezone} onChange={(e) => alterar('timezone', e.target.value)} required /></label>
                            <label>Prefixo de OP<input value={form.prefixo_op || ''} onChange={(e) => alterar('prefixo_op', e.target.value.toUpperCase())} /></label>
                            <label>Número inicial da OP<input type="number" min="1" value={form.numero_inicial_op} onChange={(e) => alterar('numero_inicial_op', e.target.value)} required /></label>
                        </div>
                        <div className="go-switches">
                            <label><input type="checkbox" checked={Boolean(form.ativa)} onChange={(e) => alterar('ativa', e.target.checked)} /> Empresa ativa</label>
                        </div>
                    </section>
                    {erro && <p className="go-form-erro"><i className="fas fa-exclamation-circle"></i> {erro}</p>}
                </div>
                <footer>
                    <button type="button" className="gs-btn gs-btn-secundario" onClick={onClose}>Cancelar</button>
                    <button className="gs-btn gs-btn-primario" disabled={salvando}>
                        {salvando ? <><i className="fas fa-spinner fa-spin"></i> Salvando...</> : <><i className="fas fa-save"></i> Salvar empresa</>}
                    </button>
                </footer>
            </form>
        </div>
    );
}
