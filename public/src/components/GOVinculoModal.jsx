import React, { useMemo, useState } from 'react';
import { permissoesDisponiveis } from '../../js/utils/permissoes.js';
import GOIdentidadeCampos from './GOIdentidadeCampos.jsx';

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

function normalizarDataInput(valor) {
    return valor ? String(valor).slice(0, 10) : '';
}

function permissoesEfetivas(vinculo) {
    return (vinculo?.tipos || []).includes('administrador')
        ? permissoesDisponiveis.map((item) => item.id)
        : (vinculo?.permissoes || []);
}

export function classificarVinculo(vinculo) {
    const tipos = vinculo?.tipos || [];
    const socio = tipos.some((tipo) => tipo === 'socio' || tipo === 'ex_socio');
    const prestador = tipos.includes('prestador_externo') || Boolean(vinculo?.is_freelance);
    return {
        socio,
        prestador: !socio && prestador,
        empregado: !socio && !prestador,
    };
}

function GOCopiaPermissoes({ vinculos, permissoesSelecionadas, onChange }) {
    const origens = useMemo(
        () => (vinculos || []).filter((vinculo) => vinculo.ativo),
        [vinculos]
    );
    const origemPadrao = origens.find((vinculo) => vinculo.empresa_principal) || origens[0];
    const [origemId, setOrigemId] = useState(origemPadrao?.id || '');
    const [modo, setModo] = useState('nenhuma');
    const origem = origens.find((vinculo) => String(vinculo.id) === String(origemId)) || origemPadrao;
    const permissoesOrigem = useMemo(() => permissoesEfetivas(origem), [origem]);
    const permissoesOrigemSet = useMemo(() => new Set(permissoesOrigem), [permissoesOrigem]);
    const opcoesOrigem = useMemo(
        () => permissoesDisponiveis.filter((item) => permissoesOrigemSet.has(item.id)),
        [permissoesOrigemSet]
    );

    if (!origens.length) return null;

    const mudarOrigem = (novaOrigemId) => {
        setOrigemId(novaOrigemId);
        setModo('nenhuma');
        onChange([]);
    };

    const mudarModo = (novoModo) => {
        setModo(novoModo);
        onChange(novoModo === 'todas' ? permissoesOrigem : []);
    };

    const alternarPermissao = (permissaoId) => {
        const atuais = permissoesSelecionadas || [];
        onChange(
            atuais.includes(permissaoId)
                ? atuais.filter((id) => id !== permissaoId)
                : [...atuais, permissaoId]
        );
    };

    return (
        <section className="go-form-secao go-copia-permissoes">
            <div className="go-copia-permissoes-titulo">
                <div>
                    <i className="fas fa-copy"></i>
                    <span><strong>Copiar permissões de outro vínculo</strong><small>Opcional — as permissões escolhidas serão registradas somente na nova empresa.</small></span>
                </div>
                <span className="go-selo-opcional">Opcional</span>
            </div>

            <label className="go-copia-origem">Empresa de origem
                <select value={origem?.id || ''} onChange={(e) => mudarOrigem(e.target.value)}>
                    {origens.map((vinculo) => (
                        <option key={vinculo.id} value={vinculo.id}>
                            {vinculo.empresa_nome}{vinculo.empresa_principal ? ' — principal' : ''}
                        </option>
                    ))}
                </select>
            </label>

            <div className="go-copia-modos">
                <label className={modo === 'nenhuma' ? 'ativo' : ''}>
                    <input type="radio" name="go-copia-permissoes" checked={modo === 'nenhuma'} onChange={() => mudarModo('nenhuma')} />
                    <span><strong>Não copiar</strong><small>Começar sem permissões adicionais</small></span>
                </label>
                <label className={modo === 'todas' ? 'ativo' : ''}>
                    <input type="radio" name="go-copia-permissoes" checked={modo === 'todas'} onChange={() => mudarModo('todas')} />
                    <span><strong>Copiar todas</strong><small>{permissoesOrigem.length} permissões da origem</small></span>
                </label>
                <label className={modo === 'algumas' ? 'ativo' : ''}>
                    <input type="radio" name="go-copia-permissoes" checked={modo === 'algumas'} onChange={() => mudarModo('algumas')} />
                    <span><strong>Escolher algumas</strong><small>Selecionar individualmente</small></span>
                </label>
            </div>

            {modo === 'algumas' && (
                opcoesOrigem.length ? (
                    <div className="go-permissoes-lista go-copia-lista">
                        {opcoesOrigem.map((item) => (
                            <label key={item.id}>
                                <input
                                    type="checkbox"
                                    checked={(permissoesSelecionadas || []).includes(item.id)}
                                    onChange={() => alternarPermissao(item.id)}
                                />
                                <span><strong>{item.label}</strong><small>{item.categoria}</small></span>
                            </label>
                        ))}
                    </div>
                ) : (
                    <p className="go-copia-vazia"><i className="fas fa-circle-info"></i> O vínculo de origem não possui permissões adicionais para copiar.</p>
                )
            )}
        </section>
    );
}

export function GOVinculoCampos({
    valor,
    onChange,
    mostrarPrincipal = true,
    mostrarSaida = false,
    vinculosOrigem = [],
}) {
    const [mostrarPermissoes, setMostrarPermissoes] = useState(false);
    const [buscaPermissao, setBuscaPermissao] = useState('');
    const administrador = (valor.tipos || []).includes('administrador');
    const prestadorPeloTipo = (valor.tipos || []).includes('prestador_externo');
    const { socio, prestador, empregado } = classificarVinculo(valor);
    const rotuloInicio = socio
        ? 'Início da sociedade'
        : prestador
            ? 'Início da prestação de serviços'
            : 'Data de admissão';
    const rotuloSaida = socio
        ? 'Saída da empresa'
        : prestador
            ? 'Fim da prestação de serviços'
            : 'Data de demissão';
    const permissoesFiltradas = useMemo(() => {
        const busca = buscaPermissao.trim().toLowerCase();
        return busca
            ? permissoesDisponiveis.filter((item) =>
                item.label.toLowerCase().includes(busca) || item.id.includes(busca))
            : permissoesDisponiveis;
    }, [buscaPermissao]);

    const alternarLista = (campo, item) => {
        const atual = valor[campo] || [];
        const proximaLista = atual.includes(item)
            ? atual.filter((id) => id !== item)
            : [...atual, item];
        onChange({
            ...valor,
            [campo]: proximaLista,
            ...(campo === 'tipos' && item === 'administrador' && proximaLista.includes(item)
                ? { permissoes: [] }
                : {}),
            ...(campo === 'tipos' && item === 'prestador_externo'
                ? { is_freelance: proximaLista.includes(item) }
                : {}),
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
                    <label>{rotuloInicio}
                        <input type="date" value={valor.data_admissao || ''} onChange={(e) => onChange({ ...valor, data_admissao: e.target.value })} />
                    </label>
                    {mostrarSaida && (
                        <label>{rotuloSaida}
                            <input type="date" value={valor.data_demissao || ''} onChange={(e) => onChange({ ...valor, data_demissao: e.target.value })} required />
                        </label>
                    )}
                    {empregado && (
                        <label>Salário fixo
                            <input type="number" min="0" step="0.01" value={valor.salario_fixo ?? 0} onChange={(e) => onChange({ ...valor, salario_fixo: e.target.value })} />
                        </label>
                    )}
                    {socio && (
                        <div className="go-campo-informativo">
                            <i className="fas fa-chart-pie"></i>
                            <span><strong>Remuneração societária</strong>Valores variáveis conforme retiradas e distribuições da sociedade.</span>
                        </div>
                    )}
                    {prestador && (
                        <div className="go-campo-informativo">
                            <i className="fas fa-file-invoice-dollar"></i>
                            <span><strong>Remuneração por serviço</strong>Valores variáveis, sem salário fixo ou vínculo empregatício.</span>
                        </div>
                    )}
                    <label>Passagem diária
                        <input type="number" min="0" step="0.01" value={valor.valor_passagem_diaria ?? 0} onChange={(e) => onChange({ ...valor, valor_passagem_diaria: e.target.value })} />
                    </label>
                    {!prestador && (
                        <>
                            <label>INSS (%)
                                <input type="number" min="0" step="0.01" value={valor.desconto_inss_percentual ?? 9} onChange={(e) => onChange({ ...valor, desconto_inss_percentual: e.target.value })} />
                            </label>
                            <label>VT (%)
                                <input type="number" min="0" step="0.01" value={valor.desconto_vt_percentual ?? 6} onChange={(e) => onChange({ ...valor, desconto_vt_percentual: e.target.value })} />
                            </label>
                        </>
                    )}
                </div>
                <div className="go-switches">
                    <label><input type="checkbox" checked={Boolean(valor.elegivel_pagamento)} onChange={(e) => onChange({ ...valor, elegivel_pagamento: e.target.checked })} /> Elegível para pagamentos</label>
                    <label>
                        <input
                            type="checkbox"
                            checked={prestadorPeloTipo || Boolean(valor.is_freelance)}
                            disabled={prestadorPeloTipo}
                            onChange={(e) => onChange({ ...valor, is_freelance: e.target.checked })}
                        /> Prestação de serviços / freelancer
                    </label>
                    {mostrarPrincipal && (
                        <label><input type="checkbox" checked={Boolean(valor.empresa_principal)} onChange={(e) => onChange({ ...valor, empresa_principal: e.target.checked })} /> Empresa principal</label>
                    )}
                </div>
            </section>

            {!administrador && vinculosOrigem.length > 0 && (
                <GOCopiaPermissoes
                    vinculos={vinculosOrigem}
                    permissoesSelecionadas={valor.permissoes}
                    onChange={(permissoes) => onChange({ ...valor, permissoes })}
                />
            )}

            {administrador ? (
                <section className="go-form-secao">
                    <div className="go-permissoes-total">
                        <i className="fas fa-shield-halved"></i>
                        <div>
                            <strong>Possui todas as permissões</strong>
                            <span>Administradores recebem automaticamente todo o catálogo de acessos do sistema.</span>
                        </div>
                    </div>
                </section>
            ) : (
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
            )}
        </div>
    );
}

export default function GOVinculoModal({ pessoa, vinculo, empresas, onClose, onSalvar }) {
    const [empresaId, setEmpresaId] = useState(vinculo?.empresa_id || '');
    const [form, setForm] = useState(vinculo ? {
        ...VINCULO_INICIAL,
        ...vinculo,
        data_admissao: normalizarDataInput(vinculo.data_admissao),
        data_demissao: normalizarDataInput(vinculo.data_demissao),
    } : VINCULO_INICIAL);
    const [identidade, setIdentidade] = useState({
        nome: pessoa.nome || '',
        nome_completo: pessoa.nome_completo || '',
        nome_usuario: pessoa.nome_usuario || '',
        email: pessoa.email || '',
        senha: '',
    });
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
                ...(vinculo ? { pessoa: identidade } : {}),
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
                        <span className="go-modal-eyebrow">{vinculo ? 'Cadastro completo' : 'Novo vínculo'}</span>
                        <h2>{vinculo ? 'Editar pessoa e vínculo' : pessoa.nome}</h2>
                    </div>
                    <button type="button" className="go-btn-icone" onClick={onClose} aria-label="Fechar"><i className="fas fa-times"></i></button>
                </header>
                <div className="go-modal-corpo">
                    {vinculo && (
                        <GOIdentidadeCampos
                            identidade={identidade}
                            onChange={setIdentidade}
                        />
                    )}
                    {!vinculo && (
                        <label className="go-campo-destaque">Empresa
                            <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} required>
                                <option value="">Selecione...</option>
                                {empresasDisponiveis.map((empresa) => <option key={empresa.id} value={empresa.id}>{empresa.nome_fantasia}</option>)}
                            </select>
                        </label>
                    )}
                    {vinculo && <div className="go-empresa-contexto"><i className="fas fa-building"></i> {vinculo.empresa_nome}</div>}
                    <GOVinculoCampos
                        valor={form}
                        onChange={setForm}
                        mostrarSaida={Boolean(vinculo && !form.ativo)}
                        vinculosOrigem={vinculo ? [] : pessoa.vinculos}
                    />
                    {erro && <p className="go-form-erro"><i className="fas fa-exclamation-circle"></i> {erro}</p>}
                </div>
                <footer>
                    <button type="button" className="gs-btn gs-btn-secundario" onClick={onClose}>Cancelar</button>
                    <button className="gs-btn gs-btn-primario" disabled={salvando}>
                        {salvando
                            ? <><i className="fas fa-spinner fa-spin"></i> Salvando...</>
                            : <><i className="fas fa-save"></i> {vinculo ? 'Salvar cadastro' : 'Salvar vínculo'}</>}
                    </button>
                </footer>
            </form>
        </div>
    );
}
