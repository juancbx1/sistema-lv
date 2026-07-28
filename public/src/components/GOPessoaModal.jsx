import React, { useState } from 'react';
import { GOVinculoCampos, VINCULO_INICIAL } from './GOVinculoModal.jsx';

const IDENTIDADE_INICIAL = {
    nome: '',
    nome_completo: '',
    nome_usuario: '',
    email: '',
    senha: '',
};

export default function GOPessoaModal({ pessoa, empresas, empresaAtivaId, onClose, onSalvar }) {
    const [identidade, setIdentidade] = useState(pessoa ? {
        nome: pessoa.nome || '',
        nome_completo: pessoa.nome_completo || '',
        nome_usuario: pessoa.nome_usuario || '',
        email: pessoa.email || '',
        senha: '',
    } : IDENTIDADE_INICIAL);
    const [empresaId, setEmpresaId] = useState(empresaAtivaId || empresas.find((item) => item.ativa)?.id || '');
    const [vinculo, setVinculo] = useState({ ...VINCULO_INICIAL, empresa_principal: true });
    const [salvando, setSalvando] = useState(false);
    const [erro, setErro] = useState('');

    const salvar = async (event) => {
        event.preventDefault();
        if (!pessoa && !vinculo.tipos.length) return setErro('Selecione ao menos uma função.');
        setSalvando(true);
        setErro('');
        try {
            await onSalvar(pessoa
                ? identidade
                : { ...identidade, empresa_id: Number(empresaId), vinculo });
        } catch (error) {
            setErro(error.message);
        } finally {
            setSalvando(false);
        }
    };

    return (
        <div className="go-modal-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <form className="go-modal go-modal--grande" onSubmit={salvar} autoComplete="off">
                <header>
                    <div>
                        <span className="go-modal-eyebrow">{pessoa ? 'Identidade global' : 'Cadastro completo'}</span>
                        <h2>{pessoa ? 'Editar pessoa' : 'Nova pessoa'}</h2>
                    </div>
                    <button type="button" className="go-btn-icone" onClick={onClose} aria-label="Fechar"><i className="fas fa-times"></i></button>
                </header>
                <div className="go-modal-corpo">
                    <section className="go-form-secao">
                        <h3>Dados de login</h3>
                        <div className="go-form-grid">
                            <label>Nome de exibição
                                <input value={identidade.nome} onChange={(e) => setIdentidade({ ...identidade, nome: e.target.value })} required />
                            </label>
                            <label>Nome completo
                                <input value={identidade.nome_completo} onChange={(e) => setIdentidade({ ...identidade, nome_completo: e.target.value })} />
                            </label>
                            <label>Nome de usuário
                                <input autoComplete="off" value={identidade.nome_usuario} onChange={(e) => setIdentidade({ ...identidade, nome_usuario: e.target.value })} required />
                            </label>
                            <label>E-mail
                                <input type="email" autoComplete="off" value={identidade.email} onChange={(e) => setIdentidade({ ...identidade, email: e.target.value })} required />
                            </label>
                            <label>{pessoa ? 'Nova senha (opcional)' : 'Senha inicial'}
                                <input type="password" autoComplete="new-password" minLength={6} value={identidade.senha} onChange={(e) => setIdentidade({ ...identidade, senha: e.target.value })} required={!pessoa} />
                            </label>
                        </div>
                    </section>
                    {!pessoa && (
                        <>
                            <label className="go-campo-destaque">Empresa inicial
                                <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} required>
                                    {empresas.filter((item) => item.ativa).map((empresa) => <option key={empresa.id} value={empresa.id}>{empresa.nome_fantasia}</option>)}
                                </select>
                            </label>
                            <GOVinculoCampos valor={vinculo} onChange={setVinculo} mostrarPrincipal={false} />
                        </>
                    )}
                    {erro && <p className="go-form-erro"><i className="fas fa-exclamation-circle"></i> {erro}</p>}
                </div>
                <footer>
                    <button type="button" className="gs-btn gs-btn-secundario" onClick={onClose}>Cancelar</button>
                    <button className="gs-btn gs-btn-primario" disabled={salvando}>
                        {salvando ? <><i className="fas fa-spinner fa-spin"></i> Salvando...</> : <><i className="fas fa-save"></i> Salvar pessoa</>}
                    </button>
                </footer>
            </form>
        </div>
    );
}
