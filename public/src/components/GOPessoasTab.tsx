import React, { useMemo, useState } from 'react';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UIBloqueio from './UIBloqueio';
import GOPessoaCard from './GOPessoaCard';
import GOFuncaoFiltro, { GO_FUNCOES } from './GOFuncaoFiltro';
import type { GOEmpresa, GOEscopo, GOPessoa, GOVinculo } from '../utils/go-types';

type GOStatusPessoas = 'ativos' | 'todos';

interface GOPessoasTabProps {
    pessoas: GOPessoa[];
    empresas: GOEmpresa[];
    empresaAtivaId: number | null;
    empresaFocoId: number | null;
    carregando: boolean;
    escopo: GOEscopo;
    onEscopo: (escopo: GOEscopo) => void;
    onNovaPessoa: () => void;
    onEditarVinculo: (pessoa: GOPessoa, vinculo: GOVinculo, foco?: 'permissoes') => void;
    onNovoVinculo: (pessoa: GOPessoa) => void;
    onEncerrarVinculo: (pessoa: GOPessoa, vinculo: GOVinculo) => void;
    onSelecionarEmpresa: (empresaId: number) => void;
}

const rotulosFuncoes = Object.fromEntries(GO_FUNCOES) as Record<string, string>;

function empresaDoContexto(empresas: GOEmpresa[], empresaAtivaId: number | null, empresaFocoId: number | null, escopo: GOEscopo) {
    if (empresaFocoId) return empresas.find((empresa) => empresa.id === empresaFocoId) || null;
    if (escopo === 'atual' && empresaAtivaId) return empresas.find((empresa) => empresa.id === empresaAtivaId) || null;
    return null;
}

export default function GOPessoasTab({
    pessoas,
    empresas,
    empresaAtivaId,
    empresaFocoId,
    carregando,
    escopo,
    onEscopo,
    onNovaPessoa,
    onEditarVinculo,
    onNovoVinculo,
    onEncerrarVinculo,
    onSelecionarEmpresa,
}: GOPessoasTabProps) {
    const [busca, setBusca] = useState('');
    const [funcoes, setFuncoes] = useState<string[]>([]);
    const [status, setStatus] = useState<GOStatusPessoas>('ativos');
    const empresaContextoId = empresaFocoId || (escopo === 'atual' ? empresaAtivaId : null);
    const empresaContexto = empresaDoContexto(empresas, empresaAtivaId, empresaFocoId, escopo);

    const filtradas = useMemo(() => {
        const termo = busca.trim().toLowerCase();
        return pessoas.filter((pessoa) => {
            const vinculos = pessoa.vinculos || [];
            const vinculosDoEscopo = empresaContextoId
                ? vinculos.filter((item) => item.empresa_id === empresaContextoId)
                : escopo === 'global'
                    ? vinculos
                    : vinculos.filter((item) => item.empresa_id === empresaAtivaId);
            const encontrou = !termo || [
                pessoa.nome,
                pessoa.nome_usuario,
                pessoa.email,
                ...vinculosDoEscopo.map((vinculo) => vinculo.empresa_nome),
            ].some((valor) => String(valor || '').toLowerCase().includes(termo));
            const encontrouFuncao = !funcoes.length || vinculosDoEscopo.some((vinculo) =>
                (vinculo.tipos || []).some((tipo) => funcoes.includes(tipo))
            );
            return encontrou && encontrouFuncao && vinculosDoEscopo.length > 0;
        });
    }, [pessoas, busca, funcoes, escopo, empresaAtivaId, empresaContextoId]);

    const possuiVinculoAtivoNoEscopo = (pessoa: GOPessoa) => {
        const vinculos = pessoa.vinculos || [];
        return vinculos.some((item) => item.ativo && (
            empresaContextoId ? item.empresa_id === empresaContextoId : escopo === 'global' || item.empresa_id === empresaAtivaId
        ));
    };

    const ativos = filtradas.filter(possuiVinculoAtivoNoEscopo);
    const antigos = filtradas.filter((pessoa) => !possuiVinculoAtivoNoEscopo(pessoa));
    const pessoasVisiveis = status === 'todos' ? filtradas : ativos;
    const nomeContexto = empresaContexto?.nome_fantasia || 'Todas as empresas';
    const temFiltros = Boolean(busca.trim() || funcoes.length);

    return (
        <>
            <section className="go-toolbar gs-card gs-card--compacto">
                <label className="go-toolbar-busca go-toolbar-busca--redesign">
                    <i className="fas fa-search"></i>
                    <input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar por nome, usuário, e-mail ou empresa" aria-label="Buscar pessoas" />
                </label>
                <GOFuncaoFiltro selecionadas={funcoes} onChange={setFuncoes} />
                <div className="go-status-filtro" aria-label="Filtrar status">
                    <button type="button" className={status === 'ativos' ? 'ativo' : ''} onClick={() => setStatus('ativos')}><i className="fas fa-user-check"></i> Ativas</button>
                    <button type="button" className={status === 'todos' ? 'ativo' : ''} onClick={() => setStatus('todos')}><i className="fas fa-layer-group"></i> Todos</button>
                </div>
                <div className="go-segmentado">
                    <button type="button" className={escopo === 'atual' && !empresaFocoId ? 'ativo' : ''} onClick={() => onEscopo('atual')}><i className="fas fa-building"></i> Empresa atual</button>
                    <UIBloqueio permissao="visualizar-todas-empresas">
                        <button type="button" className={escopo === 'global' && !empresaFocoId ? 'ativo' : ''} onClick={() => onEscopo('global')}><i className="fas fa-sitemap"></i> Visão global</button>
                    </UIBloqueio>
                </div>
                <UIBloqueio permissao="acesso-cadastrar-usuarios">
                    <button type="button" className="gs-btn gs-btn-primario go-nova-pessoa" onClick={onNovaPessoa}><i className="fas fa-user-plus"></i> Nova pessoa</button>
                </UIBloqueio>
            </section>

            {carregando ? <UICarregando variante="bloco" /> : (
                <>
                    <section className="go-secao go-secao--pessoas">
                        <div className="go-secao-cabecalho go-secao-cabecalho--contexto">
                            <div className="go-secao-cabecalho-titulo">
                                <span className="go-contexto-icone"><i className="fas fa-building"></i></span>
                                <div>
                                    <span className="go-eyebrow">Empresa em foco</span>
                                    <h2>{nomeContexto} <small>{pessoasVisiveis.length}</small></h2>
                                    <p>{empresaContexto ? 'Visualizando os vínculos desta empresa' : 'Visão consolidada da organização'}</p>
                                </div>
                            </div>
                            <div className="go-secao-cabecalho-contexto">
                                <span><i className="fas fa-shield-halved"></i> Contexto empresarial</span>
                                <strong>{empresaContexto ? 'Empresa em foco' : 'Organização completa'}</strong>
                                <small>{ativos.length} com vínculo ativo · {antigos.length} encerrado(s)</small>
                            </div>
                        </div>
                        {pessoasVisiveis.length ? (
                            <div className="go-pessoas-grid go-pessoas-grid--redesign">
                                {pessoasVisiveis.map((pessoa) => (
                                    <GOPessoaCard
                                        key={pessoa.id}
                                        pessoa={pessoa}
                                        empresaAtivaId={empresaAtivaId}
                                        empresaFocoId={empresaFocoId}
                                        escopo={escopo}
                                        onEditarVinculo={onEditarVinculo}
                                        onNovoVinculo={onNovoVinculo}
                                        onEncerrarVinculo={onEncerrarVinculo}
                                        onSelecionarEmpresa={onSelecionarEmpresa}
                                    />
                                ))}
                            </div>
                        ) : (
                            <UIFeedbackNotFound
                                variante="compacto"
                                icon="fa-users"
                                titulo="Nenhuma pessoa encontrada"
                                mensagem={temFiltros ? 'Ajuste a busca ou os filtros para encontrar outras pessoas.' : 'Não há pessoas ativas neste contexto.'}
                            />
                        )}
                    </section>

                    {status === 'ativos' && antigos.length > 0 && (
                        <details className="go-ex-membros gs-card go-ex-membros--redesign">
                            <summary><span><i className="fas fa-clock-rotate-left"></i> Vínculos encerrados neste contexto</span><strong>{antigos.length}</strong></summary>
                            <div className="go-pessoas-grid go-pessoas-grid--redesign">
                                {antigos.map((pessoa) => (
                                    <GOPessoaCard
                                        key={pessoa.id}
                                        pessoa={pessoa}
                                        empresaAtivaId={empresaAtivaId}
                                        empresaFocoId={empresaFocoId}
                                        escopo={escopo}
                                        onEditarVinculo={onEditarVinculo}
                                        onNovoVinculo={onNovoVinculo}
                                        onEncerrarVinculo={onEncerrarVinculo}
                                        onSelecionarEmpresa={onSelecionarEmpresa}
                                    />
                                ))}
                            </div>
                        </details>
                    )}
                </>
            )}
        </>
    );
}
