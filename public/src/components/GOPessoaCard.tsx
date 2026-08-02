import React, { type CSSProperties } from 'react';
import UIBloqueio from './UIBloqueio';
import { classificarVinculo } from './GOVinculoModal';
import type { GOPessoa, GOVinculo } from '../utils/go-types';

const ROTULOS_TIPO: Record<string, string> = {
    administrador: 'Administrador',
    supervisor: 'Supervisor',
    lider_setor: 'Líder',
    costureira: 'Costureira',
    tiktik: 'TikTik',
    cortador: 'Cortador',
    socio: 'Sócio',
    ex_socio: 'Ex-sócio',
    prestador_externo: 'Prestador externo',
};

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

interface DadosVinculoProps {
    vinculo: GOVinculo;
    encerrado?: boolean;
}

function DadosVinculo({ vinculo, encerrado = false }: DadosVinculoProps) {
    const { socio, prestador } = classificarVinculo(vinculo);
    const rotuloInicio = socio ? 'Início da sociedade' : prestador ? 'Início da prestação' : 'Admissão';
    const rotuloSaida = socio ? 'Saída da empresa' : prestador ? 'Fim da prestação' : 'Demissão';
    return (
        <div className="go-vinculo-dados">
            <div>
                <span>{rotuloInicio}</span>
                <strong>{formatarData(vinculo.data_admissao)}</strong>
            </div>
            {encerrado ? (
                <div>
                    <span>{rotuloSaida}</span>
                    <strong>{formatarData(vinculo.data_demissao)}</strong>
                </div>
            ) : (
                <div>
                    <span>Nível</span>
                    <strong>{vinculo.nivel !== null && vinculo.nivel !== undefined ? `Nível ${vinculo.nivel}` : 'Não informado'}</strong>
                </div>
            )}
            <div>
                <span>{socio ? 'Remuneração' : prestador ? 'Pagamento' : 'Salário'}</span>
                <strong>{socio ? 'Variável / societária' : prestador ? 'Variável / por serviço' : formatarMoeda(vinculo.salario_fixo)}</strong>
            </div>
        </div>
    );
}

interface GOPessoaCardProps {
    pessoa: GOPessoa;
    empresaAtivaId: number | null;
    onEditarVinculo: (pessoa: GOPessoa, vinculo: GOVinculo) => void;
    onNovoVinculo: (pessoa: GOPessoa) => void;
    onEncerrarVinculo: (pessoa: GOPessoa, vinculo: GOVinculo) => void;
}

export default function GOPessoaCard({ pessoa, empresaAtivaId, onEditarVinculo, onNovoVinculo, onEncerrarVinculo }: GOPessoaCardProps) {
    const vinculosAtivos = (pessoa.vinculos || []).filter((item) => item.ativo);
    const vinculosEncerrados = (pessoa.vinculos || []).filter((item) => !item.ativo);
    const ativoNaEmpresa = vinculosAtivos.some((item) => item.empresa_id === empresaAtivaId);

    return (
        <article className={`go-pessoa-card${ativoNaEmpresa ? '' : ' go-pessoa-card--fora-contexto'}`}>
            <header>
                <div className="go-avatar">
                    {pessoa.avatar_url
                        ? <img src={pessoa.avatar_url} alt="" />
                        : <span>{iniciais(pessoa.nome)}</span>}
                </div>
                <div className="go-pessoa-identidade">
                    <h3>{pessoa.nome}</h3>
                    <p>@{pessoa.nome_usuario} · {pessoa.email}</p>
                </div>
            </header>

            <div className="go-vinculos">
                {vinculosAtivos.map((vinculo) => {
                    const { socio, prestador } = classificarVinculo(vinculo);
                    const administrador = (vinculo.tipos || []).includes('administrador');
                    const estiloEmpresa = { '--go-empresa-cor': vinculo.empresa_cor || '#64748b' } as CSSProperties;
                    return (
                        <div
                            key={vinculo.id}
                            className={`go-vinculo${vinculo.empresa_id === empresaAtivaId ? ' go-vinculo--contexto' : ''}`}
                            style={estiloEmpresa}
                        >
                            <div className="go-vinculo-topo">
                                <strong><i className="fas fa-building"></i> {vinculo.empresa_nome}</strong>
                                {vinculo.empresa_principal && <span className="go-selo-principal"><i className="fas fa-star"></i> Principal</span>}
                            </div>
                            <div className="go-tipos">
                                {(vinculo.tipos || []).map((tipo) => <span key={tipo}>{ROTULOS_TIPO[tipo] || tipo}</span>)}
                            </div>
                            <DadosVinculo vinculo={vinculo} />
                            <div className="go-vinculo-meta">
                                {prestador && <span><i className="fas fa-briefcase"></i> Prestação de serviços</span>}
                                <span><i className="fas fa-wallet"></i> {vinculo.elegivel_pagamento ? 'Elegível para pagamentos' : 'Fora dos pagamentos'}</span>
                                {administrador
                                    ? <span className="go-acesso-total"><i className="fas fa-shield-halved"></i> Possui todas as permissões</span>
                                    : <span><i className="fas fa-key"></i> {(vinculo.permissoes || []).length} permissões adicionais</span>}
                            </div>
                            <div className="go-vinculo-acoes">
                                <UIBloqueio permissao="vincular-usuarios-empresas">
                                    <button onClick={() => onEditarVinculo(pessoa, vinculo)}><i className="fas fa-pen"></i> Editar vínculo</button>
                                </UIBloqueio>
                                <UIBloqueio permissao="vincular-usuarios-empresas">
                                    <button className={socio || prestador ? 'go-acao-saida' : 'go-acao-perigo'} onClick={() => onEncerrarVinculo(pessoa, vinculo)}>
                                        <i className={`fas ${socio ? 'fa-door-open' : prestador ? 'fa-handshake-slash' : 'fa-user-minus'}`}></i>{' '}
                                        {socio ? 'Registrar saída' : prestador ? 'Encerrar prestação' : 'Demitir'}
                                    </button>
                                </UIBloqueio>
                            </div>
                        </div>
                    );
                })}
                {vinculosAtivos.length === 0 && <p className="go-sem-vinculo">Nenhum vínculo ativo.</p>}
                {vinculosEncerrados.length > 0 && (
                    <details className="go-vinculos-encerrados" open={vinculosAtivos.length === 0}>
                        <summary>{vinculosEncerrados.length} vínculo(s) encerrado(s)</summary>
                        {vinculosEncerrados.map((vinculo) => {
                            const { socio, prestador } = classificarVinculo(vinculo);
                            const estiloEmpresa = { '--go-empresa-cor': vinculo.empresa_cor || '#94a3b8' } as CSSProperties;
                            return (
                                <div
                                    key={vinculo.id}
                                    className="go-vinculo go-vinculo--encerrado"
                                    style={estiloEmpresa}
                                >
                                    <div className="go-vinculo-topo">
                                        <strong><i className="fas fa-building"></i> {vinculo.empresa_nome}</strong>
                                        <span className="go-selo-desligado"><i className={`fas ${socio || prestador ? 'fa-handshake-slash' : 'fa-user-clock'}`}></i> {socio ? 'Ex-sócio' : prestador ? 'Ex-prestador' : 'Ex-empregado'}</span>
                                    </div>
                                    <div className="go-tipos">
                                        {(vinculo.tipos || []).map((tipo) => <span key={tipo}>{ROTULOS_TIPO[tipo] || tipo}</span>)}
                                    </div>
                                    <DadosVinculo vinculo={vinculo} encerrado />
                                    <div className="go-vinculo-meta">
                                        {vinculo.nivel !== null && vinculo.nivel !== undefined && <span><i className="fas fa-layer-group"></i> Nível {vinculo.nivel}</span>}
                                        {prestador && <span><i className="fas fa-briefcase"></i> Prestação de serviços encerrada</span>}
                                    </div>
                                    <div className="go-vinculo-acoes">
                                        <UIBloqueio permissao="vincular-usuarios-empresas">
                                            <button onClick={() => onEditarVinculo(pessoa, vinculo)}><i className="fas fa-pen"></i> Editar vínculo</button>
                                        </UIBloqueio>
                                    </div>
                                </div>
                            );
                        })}
                    </details>
                )}
            </div>

            <footer>
                <UIBloqueio permissao="vincular-usuarios-empresas" style={{ width: '100%' }}>
                    <button onClick={() => onNovoVinculo(pessoa)}><i className="fas fa-link"></i> Vincular a outra empresa</button>
                </UIBloqueio>
            </footer>
        </article>
    );
}
