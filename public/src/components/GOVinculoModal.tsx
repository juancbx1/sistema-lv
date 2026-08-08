import React, { useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import {
    normalizarPermissoesParaInterface,
    permissoesCatalogoVisivel,
} from '../../js/utils/permissoes.js';
import GOIdentidadeCampos from './GOIdentidadeCampos';
import UICarregando from './UICarregando';
import type {
    GOClassificacaoVinculo,
    GODiasTrabalho,
    GOEmpresa,
    GOIdentidadeForm,
    GOPermissaoCatalogo,
    GOPessoa,
    GOVinculo,
    GOVinculoForm,
} from '../utils/go-types';

const catalogoPermissoes = permissoesCatalogoVisivel as GOPermissaoCatalogo[];

export const TIPOS_VINCULO: Array<[string, string]> = [
    ['administrador', 'Administrador'],
    ['supervisor', 'Supervisor'],
    ['lider_setor', 'Líder de setor'],
    ['costureira', 'Costureira'],
    ['tiktik', 'TikTik'],
    ['cortador', 'Cortador'],
    ['socio', 'Sócio'],
    ['prestador_externo', 'Prestador externo'],
];

export const VINCULO_INICIAL: Omit<
    GOVinculoForm,
    | 'dias_trabalho'
    | 'horario_entrada_1'
    | 'horario_saida_1'
    | 'horario_entrada_2'
    | 'horario_saida_2'
    | 'horario_entrada_3'
    | 'horario_saida_3'
> = {
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

export const JORNADA_INICIAL: Pick<
    GOVinculoForm,
    | 'dias_trabalho'
    | 'horario_entrada_1'
    | 'horario_saida_1'
    | 'horario_entrada_2'
    | 'horario_saida_2'
    | 'horario_entrada_3'
    | 'horario_saida_3'
> = {
    dias_trabalho: { '0': false, '1': true, '2': true, '3': true, '4': true, '5': true, '6': false },
    horario_entrada_1: '07:30',
    horario_saida_1: '11:30',
    horario_entrada_2: '12:30',
    horario_saida_2: '17:18',
    horario_entrada_3: '',
    horario_saida_3: '',
};

const DIAS_SEMANA: Array<[string, string]> = [
    ['0', 'Dom'],
    ['1', 'Seg'],
    ['2', 'Ter'],
    ['3', 'Qua'],
    ['4', 'Qui'],
    ['5', 'Sex'],
    ['6', 'Sáb'],
];

const TIPOS_COM_JORNADA = new Set([
    'supervisor',
    'lider_setor',
    'costureira',
    'tiktik',
    'cortador',
]);

function normalizarDataInput(valor: unknown): string {
    return valor ? String(valor).slice(0, 10) : '';
}

function normalizarHoraInput(valor: unknown): string {
    return valor ? String(valor).slice(0, 5) : '';
}

function normalizarDiasInput(valor: GODiasTrabalho | null | undefined): GODiasTrabalho {
    return { ...JORNADA_INICIAL.dias_trabalho, ...(valor || {}) };
}

function minutos(hora: string | null | undefined): number | null {
    if (!hora) return null;
    const [horas, minutosHora] = String(hora).split(':').map(Number);
    return Number.isFinite(horas) && Number.isFinite(minutosHora)
        ? horas * 60 + minutosHora
        : null;
}

function validarJornada(valor: GOVinculoForm): string {
    const diasAtivos = DIAS_SEMANA.filter(([dia]) => valor.dias_trabalho?.[dia]).length;
    if (!diasAtivos) return 'Selecione pelo menos um dia de trabalho para este vínculo.';

    const horarioEntrada1 = minutos(valor.horario_entrada_1);
    const horarioSaida1 = minutos(valor.horario_saida_1);
    const horarioEntrada2 = minutos(valor.horario_entrada_2);
    const horarioSaida2 = minutos(valor.horario_saida_2);
    const horarioEntrada3 = minutos(valor.horario_entrada_3);
    const horarioSaida3 = minutos(valor.horario_saida_3);
    const possuiTerceiroPeriodo = Boolean(valor.horario_entrada_3 || valor.horario_saida_3);

    if (horarioEntrada1 === null || horarioSaida1 === null) return 'Informe a entrada e a saída principais da jornada.';
    if (horarioSaida1 <= horarioEntrada1) return 'A saída principal deve ser posterior à entrada.';
    if (Boolean(valor.horario_saida_1) !== Boolean(valor.horario_entrada_2)) return 'Informe a saída e o retorno do almoço juntos.';
    if (horarioEntrada2 !== null && horarioEntrada2 <= horarioSaida1) return 'O retorno do almoço deve ser posterior à saída do almoço.';
    if (Boolean(valor.horario_entrada_2) !== Boolean(valor.horario_saida_2)) return 'Informe a entrada e a saída do segundo período juntos.';
    if (horarioSaida2 !== null && horarioEntrada2 !== null && horarioSaida2 <= horarioEntrada2) return 'A saída do segundo período deve ser posterior ao retorno do almoço.';
    if (possuiTerceiroPeriodo) {
        if (Boolean(valor.horario_saida_2) !== Boolean(valor.horario_entrada_3)) return 'Informe a saída e o retorno da pausa juntos.';
        if (horarioEntrada3 !== null && horarioSaida2 !== null && horarioEntrada3 <= horarioSaida2) return 'O retorno da pausa deve ser posterior à saída do segundo período.';
        if (Boolean(valor.horario_entrada_3) !== Boolean(valor.horario_saida_3)) return 'Informe a entrada e a saída do terceiro período juntos.';
        if (horarioSaida3 !== null && horarioEntrada3 !== null && horarioSaida3 <= horarioEntrada3) return 'A saída final deve ser posterior ao retorno da pausa.';
    }
    return '';
}

function permissoesEfetivas(vinculo?: GOVinculo | GOVinculoForm | null): string[] {
    return (vinculo?.tipos || []).includes('administrador')
        ? catalogoPermissoes.map((item) => item.id)
        : normalizarPermissoesParaInterface(vinculo?.permissoes || []);
}

export function classificarVinculo(
    vinculo?: Partial<GOVinculo> | GOVinculoForm | null
): GOClassificacaoVinculo {
    const tipos = vinculo?.tipos || [];
    const socio = tipos.some((tipo) => tipo === 'socio' || tipo === 'ex_socio');
    const prestador = tipos.includes('prestador_externo') || Boolean(vinculo?.is_freelance);
    return {
        socio,
        prestador: !socio && prestador,
        empregado: !socio && !prestador,
    };
}

interface GOCopiaPermissoesProps {
    vinculos: GOVinculo[];
    permissoesSelecionadas?: string[] | null;
    onChange: (permissoes: string[]) => void;
}

type ModoCopia = 'nenhuma' | 'todas' | 'algumas';

function GOCopiaPermissoes({ vinculos, permissoesSelecionadas, onChange }: GOCopiaPermissoesProps) {
    const origens = useMemo(
        () => (vinculos || []).filter((vinculo) => vinculo.ativo),
        [vinculos]
    );
    const origemPadrao = origens.find((vinculo) => vinculo.empresa_principal) || origens[0];
    const [origemId, setOrigemId] = useState<string | number>(origemPadrao?.id || '');
    const [modo, setModo] = useState<ModoCopia>('nenhuma');
    const origem = origens.find((vinculo) => String(vinculo.id) === String(origemId)) || origemPadrao;
    const permissoesOrigem = useMemo(() => permissoesEfetivas(origem), [origem]);
    const permissoesOrigemSet = useMemo(() => new Set(permissoesOrigem), [permissoesOrigem]);
    const opcoesOrigem = useMemo(
        () => catalogoPermissoes.filter((item) => permissoesOrigemSet.has(item.id)),
        [permissoesOrigemSet]
    );

    if (!origens.length) return null;

    const mudarOrigem = (novaOrigemId: string) => {
        setOrigemId(novaOrigemId);
        setModo('nenhuma');
        onChange([]);
    };

    const mudarModo = (novoModo: ModoCopia) => {
        setModo(novoModo);
        onChange(novoModo === 'todas' ? permissoesOrigem : []);
    };

    const alternarPermissao = (permissaoId: string) => {
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

export interface GOVinculoCamposProps {
    valor: GOVinculoForm;
    onChange: (valor: GOVinculoForm) => void;
    mostrarPrincipal?: boolean;
    mostrarSaida?: boolean;
    vinculosOrigem?: GOVinculo[];
    focoInicialPermissoes?: boolean;
}

export function GOVinculoCampos({
    valor,
    onChange,
    mostrarPrincipal = true,
    mostrarSaida = false,
    vinculosOrigem = [],
    focoInicialPermissoes = false,
}: GOVinculoCamposProps) {
    const [mostrarPermissoes, setMostrarPermissoes] = useState(Boolean(focoInicialPermissoes));
    const [mostrarTodasAtribuidas, setMostrarTodasAtribuidas] = useState(false);
    const [buscaPermissao, setBuscaPermissao] = useState('');
    const administrador = (valor.tipos || []).includes('administrador');
    const prestadorPeloTipo = (valor.tipos || []).includes('prestador_externo');
    const { socio, prestador, empregado } = classificarVinculo(valor);
    const temJornada = !socio && !prestador && (valor.tipos || []).some((tipo) => TIPOS_COM_JORNADA.has(tipo));
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
            ? catalogoPermissoes.filter((item) =>
                item.label.toLowerCase().includes(busca) || item.id.includes(busca))
            : catalogoPermissoes;
    }, [buscaPermissao]);
    const permissoesAtribuidas = valor.permissoes || [];
    const permissoesVisiveis = mostrarTodasAtribuidas
        ? permissoesAtribuidas
        : permissoesAtribuidas.slice(0, 6);
    const permissoesAtribuidasExcedentes = Math.max(0, permissoesAtribuidas.length - permissoesVisiveis.length);

    const alternarCatalogo = () => {
        const proximoEstado = !mostrarPermissoes;
        setMostrarPermissoes(proximoEstado);
        if (!proximoEstado) {
            setBuscaPermissao('');
            setMostrarTodasAtribuidas(false);
        }
    };

    const alternarLista = (campo: 'tipos' | 'permissoes', item: string) => {
        const atual = (valor[campo] as string[] | undefined) || [];
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
            </section>

            {temJornada && (
                <section className="go-form-secao go-jornada-secao">
                    <div className="go-jornada-cabecalho">
                        <div>
                            <h3><i className="fas fa-clock"></i> Jornada de trabalho</h3>
                            <p>Defina os dias e horários ordinários deste vínculo. Esses dados serão usados pelo controle de ponto.</p>
                        </div>
                        <span className="go-selo-opcional">Por vínculo</span>
                    </div>

                    <div className="go-jornada-dias" aria-label="Dias de trabalho">
                        {DIAS_SEMANA.map(([dia, label]) => {
                            const ativo = Boolean(valor.dias_trabalho?.[dia]);
                            return (
                                <button
                                    key={dia}
                                    type="button"
                                    className={`go-jornada-dia${ativo ? ' ativo' : ''}`}
                                    aria-pressed={ativo}
                                    onClick={() => onChange({
                                        ...valor,
                                        dias_trabalho: {
                                            ...JORNADA_INICIAL.dias_trabalho,
                                            ...(valor.dias_trabalho || {}),
                                            [dia]: !ativo,
                                        },
                                    })}
                                >
                                    <span>{label}</span>
                                    <small>{ativo ? 'Trabalha' : 'Folga'}</small>
                                </button>
                            );
                        })}
                    </div>

                    <div className="go-jornada-horarios">
                        <label>
                            <span>Entrada (E1)</span>
                            <input type="time" value={valor.horario_entrada_1 || ''} onChange={(e) => onChange({ ...valor, horario_entrada_1: e.target.value })} required />
                        </label>
                        <label>
                            <span>Saída para almoço (S1)</span>
                            <input type="time" value={valor.horario_saida_1 || ''} onChange={(e) => onChange({ ...valor, horario_saida_1: e.target.value })} required />
                        </label>
                        <label>
                            <span>Retorno do almoço (E2)</span>
                            <input type="time" value={valor.horario_entrada_2 || ''} onChange={(e) => onChange({ ...valor, horario_entrada_2: e.target.value })} required />
                        </label>
                        <label>
                            <span>{valor.horario_entrada_3 || valor.horario_saida_3 ? 'Saída para pausa (S2)' : 'Saída final (S2)'}</span>
                            <input type="time" value={valor.horario_saida_2 || ''} onChange={(e) => onChange({ ...valor, horario_saida_2: e.target.value })} required />
                        </label>
                        <label>
                            <span>Retorno da pausa (E3)</span>
                            <input type="time" value={valor.horario_entrada_3 || ''} onChange={(e) => onChange({ ...valor, horario_entrada_3: e.target.value })} />
                        </label>
                        <label>
                            <span>Saída final (S3)</span>
                            <input type="time" value={valor.horario_saida_3 || ''} onChange={(e) => onChange({ ...valor, horario_saida_3: e.target.value })} />
                        </label>
                    </div>
                    <p className="go-jornada-legenda"><i className="fas fa-circle-info"></i> O almoço corresponde ao intervalo entre S1 e E2. A pausa corresponde ao intervalo entre S2 e E3.</p>
                </section>
            )}

            <section className="go-form-secao">
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
                <section className="go-form-secao go-permissoes-edicao">
                    <div className="go-permissoes-edicao-cabecalho">
                        <div>
                            <span className="go-modal-eyebrow">Acessos deste vínculo</span>
                            <h3><i className="fas fa-key"></i> Permissões individuais</h3>
                            <p>{(valor.permissoes || []).length ? `${(valor.permissoes || []).length} permissão(ões) já atribuída(s) a esta pessoa nesta empresa.` : 'Nenhuma permissão individual foi atribuída ainda.'}</p>
                        </div>
                        <button
                            type="button"
                            className="go-permissoes-toggle"
                            aria-expanded={mostrarPermissoes}
                            aria-controls="go-permissoes-catalogo"
                            onClick={alternarCatalogo}
                        >
                            <i className={`fas fa-${mostrarPermissoes ? 'chevron-up' : 'plus'}`}></i>
                            {mostrarPermissoes ? 'Ocultar catálogo' : 'Adicionar permissão'}
                        </button>
                    </div>
                    <div className="go-permissoes-selecionadas">
                        {permissoesAtribuidas.length ? (
                            <div className="go-permissoes-selecionadas-lista">
                                {permissoesVisiveis.map((id) => {
                                    const item = catalogoPermissoes.find((permissao) => permissao.id === id);
                                    return <span key={id} className="go-permissao-chip go-permissao-chip--editor"><strong>{item?.label || id}</strong><small>{item?.categoria || 'Catálogo'}</small></span>;
                                })}
                                {permissoesAtribuidasExcedentes > 0 && (
                                    <button
                                        type="button"
                                        className="go-permissao-chip go-permissao-chip--mais"
                                        onClick={() => setMostrarTodasAtribuidas((atual) => !atual)}
                                    >
                                        {mostrarTodasAtribuidas ? 'Recolher permissões' : `+${permissoesAtribuidasExcedentes} outras`}
                                    </button>
                                )}
                            </div>
                        ) : <span className="go-permissoes-editor-vazio"><i className="fas fa-circle-info"></i> Use o botão acima para carregar o catálogo completo do sistema.</span>}
                    </div>
                    {mostrarPermissoes && (
                        <div id="go-permissoes-catalogo" className="go-permissoes go-permissoes-catalogo">
                            <label className="go-permissoes-busca"><i className="fas fa-search"></i><input placeholder="Buscar no catálogo de permissões..." value={buscaPermissao} onChange={(e) => setBuscaPermissao(e.target.value)} /></label>
                            <div className="go-permissoes-lista">
                                {permissoesFiltradas.map((item) => (
                                    <label key={item.id} className={(valor.permissoes || []).includes(item.id) ? 'selecionada' : ''}>
                                        <input type="checkbox" checked={(valor.permissoes || []).includes(item.id)} onChange={() => alternarLista('permissoes', item.id)} />
                                        <span><strong>{item.label}</strong><small>{item.categoria}</small></span>
                                        {(valor.permissoes || []).includes(item.id) && <i className="fas fa-check"></i>}
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

export type GOVinculoSalvarPayload = GOVinculoForm & {
    empresa_id: number;
    nivel: number | null;
    pessoa?: GOIdentidadeForm;
};

interface GOVinculoModalProps {
    pessoa: GOPessoa;
    vinculo: GOVinculo | null;
    empresas: GOEmpresa[];
    focoInicialPermissoes?: boolean;
    onClose: () => void;
    onSalvar: (form: GOVinculoSalvarPayload) => Promise<void>;
}

export default function GOVinculoModal({ pessoa, vinculo, empresas, focoInicialPermissoes = false, onClose, onSalvar }: GOVinculoModalProps) {
    const [empresaId, setEmpresaId] = useState<string | number>(vinculo?.empresa_id || '');
    const [form, setForm] = useState<GOVinculoForm>(() => {
        const inicial = { ...VINCULO_INICIAL, ...JORNADA_INICIAL, ...(vinculo || {}) } as GOVinculoForm;
        return {
            ...inicial,
            permissoes: normalizarPermissoesParaInterface(inicial.permissoes),
            dias_trabalho: normalizarDiasInput(inicial.dias_trabalho),
            data_admissao: normalizarDataInput(inicial.data_admissao),
            data_demissao: normalizarDataInput(inicial.data_demissao),
            horario_entrada_1: normalizarHoraInput(inicial.horario_entrada_1),
            horario_saida_1: normalizarHoraInput(inicial.horario_saida_1),
            horario_entrada_2: normalizarHoraInput(inicial.horario_entrada_2),
            horario_saida_2: normalizarHoraInput(inicial.horario_saida_2),
            horario_entrada_3: normalizarHoraInput(inicial.horario_entrada_3),
            horario_saida_3: normalizarHoraInput(inicial.horario_saida_3),
        };
    });
    const [identidade, setIdentidade] = useState<GOIdentidadeForm>({
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

    const salvar = async (event: FormEvent) => {
        event.preventDefault();
        if (!vinculo && !empresaId) return setErro('Selecione uma empresa.');
        if (!form.tipos?.length) return setErro('Selecione ao menos uma função.');
        const classificacao = classificarVinculo(form);
        const temJornada = !classificacao.socio
            && !classificacao.prestador
            && (form.tipos || []).some((tipo) => TIPOS_COM_JORNADA.has(tipo));
        if (temJornada) {
            const erroJornada = validarJornada(form);
            if (erroJornada) return setErro(erroJornada);
        }
        setSalvando(true);
        setErro('');
        try {
            const {
                dias_trabalho,
                horario_entrada_1,
                horario_saida_1,
                horario_entrada_2,
                horario_saida_2,
                horario_entrada_3,
                horario_saida_3,
                ...formSemJornada
            } = form;
            const dadosVinculo = temJornada ? form : formSemJornada;
            await onSalvar({
                ...dadosVinculo,
                empresa_id: Number(vinculo?.empresa_id || empresaId),
                nivel: form.nivel === '' ? null : Number(form.nivel),
                ...(vinculo ? { pessoa: identidade } : {}),
            } as GOVinculoSalvarPayload);
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
                        vinculosOrigem={vinculo ? [] : (pessoa.vinculos || [])}
                        focoInicialPermissoes={focoInicialPermissoes}
                    />
                    {erro && <p className="go-form-erro"><i className="fas fa-exclamation-circle"></i> {erro}</p>}
                </div>
                <footer>
                    <button type="button" className="gs-btn gs-btn-secundario" onClick={onClose}>Cancelar</button>
                    <button className="gs-btn gs-btn-primario" disabled={salvando}>
                        {salvando
                            ? <><UICarregando variante="inline" /> Salvando...</>
                            : <><i className="fas fa-save"></i> {vinculo ? 'Salvar cadastro' : 'Salvar vínculo'}</>}
                    </button>
                </footer>
            </form>
        </div>
    );
}
