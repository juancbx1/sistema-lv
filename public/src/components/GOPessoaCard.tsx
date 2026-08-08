import React, { type CSSProperties } from 'react';
import UIBloqueio from './UIBloqueio';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import GOPermissoesResumo from './GOPermissoesResumo';
import { classificarVinculo } from './GOVinculoModal';
import { GO_FUNCOES } from './GOFuncaoFiltro';
import type { GOEscopo, GOPessoa, GOVinculo } from '../utils/go-types';

const ROTULOS_TIPO = Object.fromEntries(GO_FUNCOES) as Record<string, string>;
ROTULOS_TIPO.ex_socio = 'Ex-sócio';

function iniciais(nome: string | null | undefined): string {
    return String(nome || '?').split(/\s+/).slice(0, 2).map((parte) => parte[0]).join('').toUpperCase();
}

function formatarData(data: string | null | undefined): string {
    if (!data) return 'Não informada';
    const dataIso = String(data).slice(0, 10);
    return new Date(`${dataIso}T12:00:00`).toLocaleDateString('pt-BR');
}

function formatarMoeda(valor: number | string | null | undefined): string {
    const numero = Number(valor);
    return Number.isFinite(numero)
        ? numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : 'Não informado';
}

function rotuloData(vinculo: GOVinculo): string {
    const { socio, prestador } = classificarVinculo(vinculo);
    return socio ? 'Início da sociedade' : prestador ? 'Início da prestação' : 'Admissão';
}

function rotuloRemuneracao(vinculo: GOVinculo): string {
    const { socio, prestador } = classificarVinculo(vinculo);
    return socio
        ? 'Variável / societária'
        : prestador
            ? 'Variável / por serviço'
            : formatarMoeda(vinculo.salario_fixo);
}

function resumoDias(vinculo: GOVinculo): string {
    const dias = [
        ['1', 'Seg'], ['2', 'Ter'], ['3', 'Qua'], ['4', 'Qui'], ['5', 'Sex'], ['6', 'Sáb'], ['0', 'Dom'],
    ].filter(([id]) => vinculo.dias_trabalho?.[id]).map(([, label]) => label);
    if (!dias.length) return 'Não configurada';
    return dias.join(', ');
}

function resumoHorarios(vinculo: GOVinculo): string {
    const periodos = [
        [vinculo.horario_entrada_1, vinculo.horario_saida_1],
        [vinculo.horario_entrada_2, vinculo.horario_saida_2],
        [vinculo.horario_entrada_3, vinculo.horario_saida_3],
    ].filter(([entrada, saida]) => entrada || saida).map(([entrada, saida]) => `${String(entrada || '--:--').slice(0, 5)}–${String(saida || '--:--').slice(0, 5)}`);
    return periodos.length ? periodos.join(' · ') : 'Não configurada';
}

function papeisOperacionais(vinculo: GOVinculo): string {
    const papeis = (vinculo.tipos || [])
        .filter((tipo) => tipo !== 'socio' && tipo !== 'ex_socio')
        .map((tipo) => ROTULOS_TIPO[tipo] || tipo);
    return papeis.length ? papeis.join(' · ') : 'Societário';
}

function resumoAcesso(vinculo: GOVinculo): string {
    if ((vinculo.tipos || []).includes('administrador')) return 'Acesso total';
    const individuais = (vinculo.permissoes || []).length;
    return individuais ? `${individuais} individuais` : 'Por função';
}

function DadosVinculo({ vinculo, encerrado }: { vinculo: GOVinculo; encerrado: boolean }) {
    const { socio, prestador } = classificarVinculo(vinculo);
    const rotuloSaida = socio ? 'Saída da empresa' : prestador ? 'Fim da prestação' : 'Demissão';
    const rotuloSegundoCampo = encerrado ? rotuloSaida : socio ? 'Funções' : 'Nível';
    const valorSegundoCampo = encerrado
        ? formatarData(vinculo.data_demissao)
        : socio
            ? papeisOperacionais(vinculo)
            : vinculo.nivel !== null && vinculo.nivel !== undefined ? `Nível ${vinculo.nivel}` : 'Não informado';
    return (
        <div className="go-vinculo-dados go-vinculo-dados--redesign">
            <div>
                <span>{rotuloData(vinculo)}</span>
                <strong>{formatarData(vinculo.data_admissao)}</strong>
            </div>
            <div>
                <span>{rotuloSegundoCampo}</span>
                <strong>{valorSegundoCampo}</strong>
            </div>
            <div>
                <span>Remuneração</span>
                <strong>{rotuloRemuneracao(vinculo)}</strong>
            </div>
            <div>
                <span>{socio ? 'Acesso' : 'Passagem diária'}</span>
                <strong>{socio ? resumoAcesso(vinculo) : formatarMoeda(vinculo.valor_passagem_diaria)}</strong>
            </div>
        </div>
    );
}

interface GOPessoaCardProps {
    pessoa: GOPessoa;
    empresaAtivaId: number | null;
    empresaFocoId: number | null;
    escopo: GOEscopo;
    onEditarVinculo: (pessoa: GOPessoa, vinculo: GOVinculo, foco?: 'permissoes') => void;
    onNovoVinculo: (pessoa: GOPessoa) => void;
    onEncerrarVinculo: (pessoa: GOPessoa, vinculo: GOVinculo) => void;
    onSelecionarEmpresa: (empresaId: number) => void;
}

function VinculoPainel({
    pessoa,
    vinculo,
    contexto,
    onEditarVinculo,
    onEncerrarVinculo,
}: {
    pessoa: GOPessoa;
    vinculo: GOVinculo;
    contexto: boolean;
    onEditarVinculo: GOPessoaCardProps['onEditarVinculo'];
    onEncerrarVinculo: GOPessoaCardProps['onEncerrarVinculo'];
}) {
    const { socio, prestador } = classificarVinculo(vinculo);
    const encerrado = !vinculo.ativo;
    const administrador = (vinculo.tipos || []).includes('administrador');
    const estiloEmpresa = { '--go-empresa-cor': vinculo.empresa_cor || '#64748b' } as CSSProperties;
    const rotuloSaida = socio ? 'Registrar saída' : prestador ? 'Encerrar prestação' : 'Demitir';

    return (
        <section className={`go-vinculo go-vinculo--redesign${contexto ? ' go-vinculo--contexto' : ''}${encerrado ? ' go-vinculo--encerrado' : ''}`} style={estiloEmpresa}>
            <div className="go-vinculo-topo go-vinculo-topo--redesign">
                <div className="go-vinculo-empresa">
                    <span className="go-vinculo-empresa-icone"><i className="fas fa-building"></i></span>
                    <span>
                        <strong>{vinculo.empresa_nome || 'Empresa não informada'}</strong>
                        <small>{vinculo.empresa_codigo || 'código não informado'}</small>
                    </span>
                </div>
                <div className="go-vinculo-selos">
                    {vinculo.empresa_principal && <span className="go-selo-principal"><i className="fas fa-star"></i> Principal</span>}
                    <span className={encerrado ? 'go-selo-desligado' : 'go-selo-ativo'}><i className={`fas ${encerrado ? 'fa-clock' : 'fa-circle-check'}`}></i> {encerrado ? 'Encerrado' : 'Ativo'}</span>
                </div>
            </div>

            <div className="go-tipos go-tipos--redesign">
                {(vinculo.tipos || []).map((tipo) => <span key={tipo}>{ROTULOS_TIPO[tipo] || tipo}</span>)}
                {prestador && <span className="go-tipo-destaque"><i className="fas fa-briefcase"></i> Prestação de serviços</span>}
            </div>

            <DadosVinculo vinculo={vinculo} encerrado={encerrado} />

            <div className="go-vinculo-indicadores">
                <span><i className={`fas ${socio ? 'fa-people-arrows' : 'fa-wallet'}`}></i> {socio ? 'Participação societária' : vinculo.elegivel_pagamento ? 'Elegível para pagamentos' : 'Fora dos pagamentos'}</span>
                {administrador
                    ? <span className="go-acesso-total"><i className="fas fa-shield-halved"></i> Acesso total</span>
                    : <span><i className="fas fa-key"></i> {(vinculo.permissoes || []).length} individuais</span>}
            </div>

            {!encerrado && (
                <GOPermissoesResumo pessoa={pessoa} vinculo={vinculo} onEditarVinculo={onEditarVinculo} />
            )}

            <details className="go-vinculo-detalhes">
                <summary><span><i className="fas fa-list-check"></i> Ver todos os dados do vínculo</span><i className="fas fa-chevron-down"></i></summary>
                <div className="go-vinculo-detalhes-grid">
                    {socio ? (
                        <>
                            <div><span>Natureza</span><strong>Societário</strong></div>
                            <div><span>Funções</span><strong>{papeisOperacionais(vinculo)}</strong></div>
                            <div><span>Acessos</span><strong>{resumoAcesso(vinculo)}</strong></div>
                            <div><span>Remuneração</span><strong>Variável / societária</strong></div>
                            <div><span>Situação</span><strong>{encerrado ? 'Saída registrada' : 'No quadro societário'}</strong></div>
                            <div><span>Data de saída</span><strong>{formatarData(vinculo.data_demissao)}</strong></div>
                        </>
                    ) : (
                        <>
                            <div><span>Nível</span><strong>{vinculo.nivel !== null && vinculo.nivel !== undefined ? `Nível ${vinculo.nivel}` : 'Não informado'}</strong></div>
                            <div><span>Jornada</span><strong>{resumoDias(vinculo)}</strong></div>
                            <div><span>Horários</span><strong>{resumoHorarios(vinculo)}</strong></div>
                            <div><span>INSS</span><strong>{vinculo.desconto_inss_percentual ?? 0}%</strong></div>
                            <div><span>VT</span><strong>{vinculo.desconto_vt_percentual ?? 0}%</strong></div>
                            <div><span>Freelance</span><strong>{vinculo.is_freelance ? 'Sim' : 'Não'}</strong></div>
                            <div><span>Data de saída</span><strong>{formatarData(vinculo.data_demissao)}</strong></div>
                        </>
                    )}
                </div>
            </details>

            <div className="go-vinculo-acoes go-vinculo-acoes--redesign">
                <UIBloqueio permissao="vincular-usuarios-empresas" style={{ flex: 1 }}>
                    <button type="button" className="go-acao-editar" onClick={() => onEditarVinculo(pessoa, vinculo)}>
                        <i className="fas fa-pen"></i> Editar vínculo
                    </button>
                </UIBloqueio>
                {!encerrado && (
                    <UIBloqueio permissao="vincular-usuarios-empresas" style={{ flex: 1 }}>
                        <button type="button" className={socio || prestador ? 'go-acao-saida' : 'go-acao-perigo'} onClick={() => onEncerrarVinculo(pessoa, vinculo)}>
                            <i className={`fas ${socio ? 'fa-door-open' : prestador ? 'fa-handshake-slash' : 'fa-user-minus'}`}></i> {rotuloSaida}
                        </button>
                    </UIBloqueio>
                )}
            </div>
        </section>
    );
}

export default function GOPessoaCard({
    pessoa,
    empresaAtivaId,
    empresaFocoId,
    escopo,
    onEditarVinculo,
    onNovoVinculo,
    onEncerrarVinculo,
    onSelecionarEmpresa,
}: GOPessoaCardProps) {
    const todosVinculos = pessoa.vinculos || [];
    const contextoId = empresaFocoId || (escopo === 'atual' ? empresaAtivaId : null);
    const vinculosContexto = contextoId
        ? todosVinculos.filter((item) => item.empresa_id === contextoId)
        : todosVinculos.filter((item) => item.ativo);
    const outrosAtivos = contextoId
        ? todosVinculos.filter((item) => item.ativo && item.empresa_id !== contextoId)
        : [];
    const encerradosContexto = contextoId
        ? todosVinculos.filter((item) => !item.ativo && item.empresa_id === contextoId)
        : todosVinculos.filter((item) => !item.ativo);
    const ativoNaEmpresa = vinculosContexto.some((item) => item.ativo);

    return (
        <article className={`go-pessoa-card go-pessoa-card--redesign${ativoNaEmpresa ? '' : ' go-pessoa-card--fora-contexto'}`}>
            <header className="go-pessoa-header--redesign">
                <div className="go-avatar">
                    {pessoa.avatar_url
                        ? <img src={pessoa.avatar_url} alt="" />
                        : <span>{iniciais(pessoa.nome)}</span>}
                </div>
                <div className="go-pessoa-identidade">
                    <h3>{pessoa.nome}</h3>
                    <p>@{pessoa.nome_usuario} <span>·</span> {pessoa.email}</p>
                </div>
            </header>

            <div className="go-pessoa-corpo">
                {vinculosContexto.length ? vinculosContexto.map((vinculo) => (
                    <VinculoPainel
                        key={vinculo.id}
                        pessoa={pessoa}
                        vinculo={vinculo}
                        contexto={Boolean(contextoId)}
                        onEditarVinculo={onEditarVinculo}
                        onEncerrarVinculo={onEncerrarVinculo}
                    />
                )) : (
                    <UIFeedbackNotFound
                        variante="compacto"
                        icon="fa-link-slash"
                        titulo="Nenhum vínculo neste contexto"
                        mensagem="Esta pessoa não possui vínculo ativo nesta empresa."
                    />
                )}

                {outrosAtivos.length > 0 && (
                    <div className="go-outros-vinculos">
                        <div className="go-outros-vinculos-cabecalho">
                            <span><i className="fas fa-sitemap"></i> Outros vínculos desta pessoa</span>
                            <small>Acesso rápido a outra empresa</small>
                        </div>
                        <div className="go-outros-vinculos-lista">
                            {outrosAtivos.map((vinculo) => (
                                <button key={vinculo.id} type="button" className="go-outro-vinculo" onClick={() => onSelecionarEmpresa(vinculo.empresa_id)}>
                                    <span className="go-outro-vinculo-cor" style={{ background: vinculo.empresa_cor || '#64748b' }}></span>
                                    <span><strong>{vinculo.empresa_nome || 'Empresa'}</strong><small>{(vinculo.tipos || []).map((tipo) => ROTULOS_TIPO[tipo] || tipo).join(' · ')}</small></span>
                                    <i className="fas fa-arrow-right"></i>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {encerradosContexto.length > 0 && (
                    <details className="go-vinculos-encerrados go-vinculos-encerrados--redesign" open={!ativoNaEmpresa}>
                        <summary><span><i className="fas fa-clock-rotate-left"></i> Vínculos encerrados</span><strong>{encerradosContexto.length}</strong></summary>
                        <div className="go-vinculos-encerrados-lista">
                            {encerradosContexto.map((vinculo) => (
                                <VinculoPainel
                                    key={vinculo.id}
                                    pessoa={pessoa}
                                    vinculo={vinculo}
                                    contexto={false}
                                    onEditarVinculo={onEditarVinculo}
                                    onEncerrarVinculo={onEncerrarVinculo}
                                />
                            ))}
                        </div>
                    </details>
                )}
            </div>

            <footer className="go-pessoa-footer--redesign">
                <UIBloqueio permissao="vincular-usuarios-empresas" style={{ width: '100%' }}>
                    <button type="button" onClick={() => onNovoVinculo(pessoa)}><i className="fas fa-link"></i> Vincular a outra empresa</button>
                </UIBloqueio>
            </footer>
        </article>
    );
}
