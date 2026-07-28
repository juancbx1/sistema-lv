import React, { useMemo, useState } from 'react';
import { permissoesDisponiveis } from '../../js/utils/permissoes.js';

export const TIPOS_VINCULO = [
    ['administrador', 'Administrador'],
    ['supervisor', 'Supervisor'],
    ['lider_setor', 'Líder de setor'],
    ['costureira', 'Costureira'],
    ['tiktik', 'TikTik'],
    ['cortador', 'Cortador'],
    ['socio', 'Sócio'],
    ['prestador_externo', 'Prestador externo'],
];

export const VINCULO_INICIAL = {
    tipos: [],
    permissoes: [],
    nivel: '',
    salario_fixo: 0,
    valor_passagem_diaria: 0,
    elegivel_pagamento: true,
    desconto_inss_percentual: 9,
    desconto_vt_percentual: 6,
    data_admissao: '',
    data_demissao: '',
    is_freelance: false,
    ativo: true,
    empresa_principal: false,
};

export function GOVinculoCampos({ valor, onChange, mostrarPrincipal = true }) {
    const [mostrarPermissoes, setMostrarPermissoes] = useState(false);
    const [buscaPermissao, setBuscaPermissao] = useState('');
    const permissoesFiltradas = useMemo(() => {
        const busca = buscaPermissao.trim().toLowerCase();
        return busca
            ? permissoesDisponiveis.filter((item) =>
                item.label.toLowerCase().includes(busca) || item.id.includes(busca))
            : permissoesDisponiveis;
    }, [buscaPermissao]);

    const alternarLista = (campo, item) => {
        const atual = valor[campo] || [];
        onChange({
            ...valor,
            [campo]: atual.includes(item)
                ? atual.filter((id) => id !== item)
                : [...atual, item],
        });
    };

    return (
        <div className="go-form-secoes">
            <section className="go-form-secao">
                <h3>Funções nesta empresa</h3>
                <div className="go-check-grid">
                    {TIPOS_VINCULO.map(([id, label]) => (
                        <label key={id} className="go-check-card">
                            <input
                                type="checkbox"
                                checked={(valor.tipos || []).includes(id)}
                                onChange={() => alternarLista('tipos', id)}
                            />
                            <span>{label}</span>
                        </label>
                    ))}
                </div>
            </section>

            <section className="go-form-secao">
                <h3>Dados do vínculo</h3>
                <div className="go-form-grid">
                    <label>Nível
                        <input type="number" min="0" value={valor.nivel ?? ''} onChange={(e) => onChange({ ...valor, nivel: e.target.value })} />
                    </label>
                    <label>Data de admissão
                        <input type="date" value={valor.data_admissao || ''} onChange={(e) => onChange({ ...valor, data_admissao: e.target.value })} />
                    </label>
                    <label>Salário fixo
                        <input type="number" min="0" step="0.01" value={valor.salario_fixo ?? 0} onChange={(e) => onChange({ ...valor, salario_fixo: e.target.value })} />
                    </label>
                    <label>Passagem diária
                        <input type="number" min="0" step="0.01" value={valor.valor_passagem_diaria ?? 0} onChange={(e) => onChange({ ...valor, valor_passagem_diaria: e.target.value })} />
                    </label>
                    <label>INSS (%)
                        <input type="number" min="0" step="0.01" value={valor.desconto_inss_percentual ?? 9} onChange={(e) => onChange({ ...valor, desconto_inss_percentual: e.target.value })} />
                    </label>
                    <label>VT (%)
                        <input type="number" min="0" step="0.01" value={valor.desconto_vt_percentual ?? 6} onChange={(e) => onChange({ ...valor, desconto_vt_percentual: e.target.value })} />
                    </label>
                </div>
                <div className="go-switches">
                    <label><input type="checkbox" checked={Boolean(valor.elegivel_pagamento)} onChange={(e) => onChange({ ...valor, elegivel_pagamento: e.target.checked })} /> Elegível para pagamentos</label>
                    <label><input type="checkbox" checked={Boolean(valor.is_freelance)} onChange={(e) => onChange({ ...valor, is_freelance: e.target.checked })} /> Prestação freelance</label>
                    {mostrarPrincipal && (
                        <label><input type="checkbox" checked={Boolean(valor.empresa_principal)} onChange={(e) => onChange({ ...valor, empresa_principal: e.target.checked })} /> Empresa principal</label>
                    )}
                </div>
            </section>

            <section className="go-form-secao">
                <button type="button" className="go-acordeao-btn" onClick={() => setMostrarPermissoes((atual) => !atual)}>
                    <span><i className="fas fa-key"></i> Permissões individuais <small>{(valor.permissoes || []).length} selecionadas</small></span>
                    <i className={`fas fa-chevron-${mostrarPermissoes ? 'up' : 'down'}`}></i>
                </button>
                {mostrarPermissoes && (
                    <div className="go-permissoes">
                        <input
                            className="go-busca"
                            placeholder="Buscar permissão..."
                            value={buscaPermissao}
                            onChange={(e) => setBuscaPermissao(e.target.value)}
                        />
                        <div className="go-permissoes-lista">
                            {permissoesFiltradas.map((item) => (
                                <label key={item.id}>
                                    <input
                                        type="checkbox"
                                        checked={(valor.permissoes || []).includes(item.id)}
                                        onChange={() => alternarLista('permissoes', item.id)}
                                    />
                                    <span><strong>{item.label}</strong><small>{item.categoria}</small></span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}

export default function GOVinculoModal({ pessoa, vinculo, empresas, onClose, onSalvar }) {
    const [empresaId, setEmpresaId] = useState(vinculo?.empresa_id || '');
    const [form, setForm] = useState(vinculo ? { ...VINCULO_INICIAL, ...vinculo } : VINCULO_INICIAL);
    const [salvando, setSalvando] = useState(false);
    const [erro, setErro] = useState('');
    const empresasDisponiveis = vinculo
        ? empresas
        : empresas.filter((empresa) =>
            empresa.ativa && !(pessoa.vinculos || []).some((item) => item.empresa_id === empresa.id));

    const salvar = async (event) => {
        event.preventDefault();
        if (!vinculo && !empresaId) return setErro('Selecione uma empresa.');
        if (!form.tipos?.length) return setErro('Selecione ao menos uma função.');
        setSalvando(true);
        setErro('');
        try {
            await onSalvar({
                ...form,
                empresa_id: Number(vinculo?.empresa_id || empresaId),
                nivel: form.nivel === '' ? null : Number(form.nivel),
            });
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
                        <span className="go-modal-eyebrow">{vinculo ? 'Editar vínculo' : 'Novo vínculo'}</span>
                        <h2>{pessoa.nome}</h2>
                    </div>
                    <button type="button" className="go-btn-icone" onClick={onClose} aria-label="Fechar"><i className="fas fa-times"></i></button>
                </header>
                <div className="go-modal-corpo">
                    {!vinculo && (
                        <label className="go-campo-destaque">Empresa
                            <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} required>
                                <option value="">Selecione...</option>
                                {empresasDisponiveis.map((empresa) => <option key={empresa.id} value={empresa.id}>{empresa.nome_fantasia}</option>)}
                            </select>
                        </label>
                    )}
                    {vinculo && <div className="go-empresa-contexto"><i className="fas fa-building"></i> {vinculo.empresa_nome}</div>}
                    <GOVinculoCampos valor={form} onChange={setForm} />
                    {erro && <p className="go-form-erro"><i className="fas fa-exclamation-circle"></i> {erro}</p>}
                </div>
                <footer>
                    <button type="button" className="gs-btn gs-btn-secundario" onClick={onClose}>Cancelar</button>
                    <button className="gs-btn gs-btn-primario" disabled={salvando}>
                        {salvando ? <><i className="fas fa-spinner fa-spin"></i> Salvando...</> : <><i className="fas fa-save"></i> Salvar vínculo</>}
                    </button>
                </footer>
            </form>
        </div>
    );
}
