// public/src/components/GOIdentidadeCampos.tsx
import type { GOIdentidadeForm } from '../utils/go-types';

export const IDENTIDADE_INICIAL: GOIdentidadeForm = {
    nome: '',
    nome_completo: '',
    nome_usuario: '',
    email: '',
    senha: '',
};

interface GOIdentidadeCamposProps {
    identidade: GOIdentidadeForm;
    onChange: (identidade: GOIdentidadeForm) => void;
    senhaObrigatoria?: boolean;
}

export default function GOIdentidadeCampos({
    identidade,
    onChange,
    senhaObrigatoria = false,
}: GOIdentidadeCamposProps) {
    return (
        <section className="go-form-secao">
            <h3>Dados pessoais e de login</h3>
            <div className="go-form-grid">
                <label>Nome de exibição
                    <input value={identidade.nome} onChange={(e) => onChange({ ...identidade, nome: e.target.value })} required />
                </label>
                <label>Nome completo
                    <input value={identidade.nome_completo} onChange={(e) => onChange({ ...identidade, nome_completo: e.target.value })} />
                </label>
                <label>Nome de usuário
                    <input autoComplete="off" value={identidade.nome_usuario} onChange={(e) => onChange({ ...identidade, nome_usuario: e.target.value })} required />
                </label>
                <label>E-mail
                    <input type="email" autoComplete="off" value={identidade.email} onChange={(e) => onChange({ ...identidade, email: e.target.value })} required />
                </label>
                <label>{senhaObrigatoria ? 'Senha inicial' : 'Nova senha (opcional)'}
                    <input
                        type="password"
                        autoComplete="new-password"
                        minLength={6}
                        value={identidade.senha}
                        onChange={(e) => onChange({ ...identidade, senha: e.target.value })}
                        required={senhaObrigatoria}
                    />
                </label>
            </div>
        </section>
    );
}
