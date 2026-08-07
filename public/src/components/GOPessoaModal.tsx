import React, { useState, type FormEvent, type MouseEvent } from 'react';
import { GOVinculoCampos, JORNADA_INICIAL, VINCULO_INICIAL } from './GOVinculoModal';
import GOIdentidadeCampos, { IDENTIDADE_INICIAL } from './GOIdentidadeCampos';
import type {
    GOEmpresa,
    GOIdentidadeForm,
    GOPessoa,
    GOVinculoForm,
} from '../utils/go-types';
import UICarregando from './UICarregando';

export interface GOPessoaSalvarCreate {
    nome: string;
    nome_completo: string;
    nome_usuario: string;
    email: string;
    senha: string;
    empresa_id: number;
    vinculo: GOVinculoForm;
}

export type GOPessoaSalvarPayload = GOIdentidadeForm | GOPessoaSalvarCreate;

interface GOPessoaModalProps {
    pessoa: GOPessoa | null;
    empresas: GOEmpresa[];
    empresaAtivaId: number | null;
    onClose: () => void;
    onSalvar: (form: GOPessoaSalvarPayload) => Promise<void>;
}

export default function GOPessoaModal({ pessoa, empresas, empresaAtivaId, onClose, onSalvar }: GOPessoaModalProps) {
    const [identidade, setIdentidade] = useState<GOIdentidadeForm>(pessoa ? {
        nome: pessoa.nome || '',
        nome_completo: pessoa.nome_completo || '',
        nome_usuario: pessoa.nome_usuario || '',
        email: pessoa.email || '',
        senha: '',
    } : IDENTIDADE_INICIAL);
    const [empresaId, setEmpresaId] = useState<string | number>(empresaAtivaId || empresas.find((item) => item.ativa)?.id || '');
    const [vinculo, setVinculo] = useState<GOVinculoForm>({
        ...VINCULO_INICIAL,
        ...JORNADA_INICIAL,
        empresa_principal: true,
    } as GOVinculoForm);
    const [salvando, setSalvando] = useState(false);
    const [erro, setErro] = useState('');

    const salvar = async (event: FormEvent) => {
        event.preventDefault();
        if (!pessoa && !vinculo.tipos.length) return setErro('Selecione ao menos uma função.');
        setSalvando(true);
        setErro('');
        try {
            await onSalvar(pessoa
                ? identidade
                : { ...identidade, empresa_id: Number(empresaId), vinculo });
        } catch (error) {
            setErro(error instanceof Error ? error.message : 'Erro');
        } finally {
            setSalvando(false);
        }
    };

    const fecharOverlay = (e: MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
    };

    return (
        <div className="go-modal-overlay" role="presentation" onMouseDown={fecharOverlay}>
            <form className="go-modal go-modal--grande" onSubmit={salvar} autoComplete="off">
                <header>
                    <div>
                        <span className="go-modal-eyebrow">{pessoa ? 'Identidade global' : 'Cadastro completo'}</span>
                        <h2>{pessoa ? 'Editar pessoa' : 'Nova pessoa'}</h2>
                    </div>
                    <button type="button" className="go-btn-icone" onClick={onClose} aria-label="Fechar"><i className="fas fa-times"></i></button>
                </header>
                <div className="go-modal-corpo">
                    <GOIdentidadeCampos
                        identidade={identidade}
                        onChange={setIdentidade}
                        senhaObrigatoria={!pessoa}
                    />
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
                        {salvando ? <><UICarregando variante="inline" /> Salvando...</> : <><i className="fas fa-save"></i> Salvar pessoa</>}
                    </button>
                </footer>
            </form>
        </div>
    );
}
