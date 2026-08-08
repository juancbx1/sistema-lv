import React, { useMemo, useState } from 'react';
import UIBloqueio from './UIBloqueio';
import {
    normalizarPermissoesParaInterface,
    permissoesCatalogoVisivel,
    permissoesDisponiveis,
    permissoesPorTipo,
} from '../../js/utils/permissoes.js';
import type { GOPessoa, GOVinculo } from '../utils/go-types';

interface CatalogoPermissao {
    id: string;
    label: string;
    categoria: string;
}

interface GOPermissoesResumoProps {
    pessoa: GOPessoa;
    vinculo: GOVinculo;
    onEditarVinculo: (pessoa: GOPessoa, vinculo: GOVinculo, foco?: 'permissoes') => void;
}

const catalogo = permissoesDisponiveis as CatalogoPermissao[];
const catalogoVisivel = permissoesCatalogoVisivel as CatalogoPermissao[];

const permissoesPorTipoSeguro = permissoesPorTipo as Record<string, string[]>;

function permissoesHerdadas(vinculo: GOVinculo): string[] {
    if ((vinculo.tipos || []).includes('administrador')) return catalogoVisivel.map((item) => item.id);
    return [...new Set((vinculo.tipos || []).flatMap((tipo) => permissoesPorTipoSeguro[tipo] || []))];
}

function rotuloPermissao(id: string): string {
    return catalogo.find((item) => item.id === id)?.label || id;
}

export default function GOPermissoesResumo({ pessoa, vinculo, onEditarVinculo }: GOPermissoesResumoProps) {
    const [expandido, setExpandido] = useState(false);
    const administrador = (vinculo.tipos || []).includes('administrador');
    const individuais = normalizarPermissoesParaInterface(vinculo.permissoes || []);
    const herdadas = useMemo(() => permissoesHerdadas(vinculo), [vinculo]);
    const exibidas = expandido ? individuais : individuais.slice(0, 5);
    const excedentes = Math.max(0, individuais.length - exibidas.length);

    if (administrador) {
        return (
            <section className="go-permissoes-resumo go-permissoes-resumo--total">
                <div className="go-permissoes-resumo-cabecalho">
                    <div className="go-permissoes-resumo-icone"><i className="fas fa-shield-halved"></i></div>
                    <div>
                        <strong>Acesso total por Administrador</strong>
                        <small>Este vínculo recebe automaticamente todo o catálogo de permissões.</small>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="go-permissoes-resumo">
            <div className="go-permissoes-resumo-cabecalho">
                <div className="go-permissoes-resumo-icone"><i className="fas fa-key"></i></div>
                <div className="go-permissoes-resumo-titulo">
                    <strong>Permissões individuais</strong>
                    <small>{individuais.length ? `${individuais.length} atribuída(s) neste vínculo` : 'Nenhuma permissão individual atribuída'}</small>
                </div>
                <UIBloqueio permissao="gerenciar-permissoes">
                    <button type="button" className="go-permissoes-adicionar" onClick={() => onEditarVinculo(pessoa, vinculo, 'permissoes')}>
                        <i className="fas fa-plus"></i> Adicionar permissão
                    </button>
                </UIBloqueio>
            </div>
            {individuais.length ? (
                <div className="go-permissoes-resumo-lista">
                    {exibidas.map((id) => <span key={id} className="go-permissao-chip">{rotuloPermissao(id)}</span>)}
                    {excedentes > 0 && (
                        <button type="button" className="go-permissao-chip go-permissao-chip--mais" onClick={() => setExpandido(true)}>
                            +{excedentes} outras
                        </button>
                    )}
                    {expandido && individuais.length > 5 && (
                        <button type="button" className="go-permissao-chip go-permissao-chip--mais" onClick={() => setExpandido(false)}>
                            Recolher
                        </button>
                    )}
                </div>
            ) : (
                <div className="go-permissoes-vazio">
                    <i className="fas fa-circle-info"></i>
                    <span>Nenhuma permissão individual atribuída. Use “Adicionar permissão” para incluir uma.</span>
                </div>
            )}
            <div className="go-permissoes-efetivas">
                <i className="fas fa-circle-check"></i>
                <span><strong>{new Set([...herdadas, ...individuais]).size} acessos efetivos</strong> <small>incluindo permissões herdadas das funções</small></span>
            </div>
        </section>
    );
}
