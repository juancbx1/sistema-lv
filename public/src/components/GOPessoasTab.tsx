import React, { useMemo, useState } from 'react';
import UICarregando from './UICarregando';
import UIBloqueio from './UIBloqueio';
import GOPessoaCard from './GOPessoaCard';
import type { GOEmpresa, GOEscopo, GOPessoa, GOVinculo } from '../utils/go-types';

interface GOPessoasTabProps {
    pessoas: GOPessoa[];
    empresas: GOEmpresa[];
    empresaAtivaId: number | null;
    empresaFocoId: number | null;
    carregando: boolean;
    escopo: GOEscopo;
    onEscopo: (escopo: GOEscopo) => void;
    onNovaPessoa: () => void;
    onEditarVinculo: (pessoa: GOPessoa, vinculo: GOVinculo) => void;
    onNovoVinculo: (pessoa: GOPessoa) => void;
    onEncerrarVinculo: (pessoa: GOPessoa, vinculo: GOVinculo) => void;
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
}: GOPessoasTabProps) {
    const [busca, setBusca] = useState('');
    const [tipo, setTipo] = useState('');
    const filtradas = useMemo(() => {
        const termo = busca.trim().toLowerCase();
        const empresaDoContexto = empresaFocoId || (escopo === 'atual' ? empresaAtivaId : null);
        return pessoas.filter((pessoa) => {
            const vinculos = pessoa.vinculos || [];
            const encontrou = !termo || [pessoa.nome, pessoa.nome_usuario, pessoa.email]
                .some((valor) => String(valor || '').toLowerCase().includes(termo));
            const vinculosDoEscopo = empresaDoContexto
                ? vinculos.filter((item) => item.empresa_id === empresaDoContexto)
                : escopo === 'global'
                ? vinculos
                : vinculos.filter((item) => item.empresa_id === empresaAtivaId);
            return encontrou
                && vinculosDoEscopo.length > 0
                && (!tipo || vinculosDoEscopo.some((item) => item.tipos?.includes(tipo)));
        });
    }, [pessoas, busca, tipo, escopo, empresaAtivaId, empresaFocoId]);

    const ativos = filtradas.filter((pessoa) => (pessoa.vinculos || []).some((item) =>
        item.ativo && (
            empresaFocoId
                ? item.empresa_id === empresaFocoId
                : (escopo === 'global' || item.empresa_id === empresaAtivaId)
        )));
    const antigos = filtradas.filter((pessoa) => !ativos.includes(pessoa));
    const empresaContextoId = empresaFocoId || (escopo === 'atual' ? empresaAtivaId : null);
    const empresaContextoNome = empresas.find((item) => item.id === empresaContextoId)?.nome_fantasia;
    const vinculosEncerradosDoContexto = antigos.flatMap((pessoa) =>
        (pessoa.vinculos || []).filter((vinculo) =>
            !vinculo.ativo
            && (!empresaContextoId || vinculo.empresa_id === empresaContextoId)
        )
    );
    const temExSocios = vinculosEncerradosDoContexto.some((vinculo) =>
        (vinculo.tipos || []).some((tipoVinculo) => tipoVinculo === 'socio' || tipoVinculo === 'ex_socio')
    );
    const temExPrestadores = vinculosEncerradosDoContexto.some((vinculo) =>
        (vinculo.tipos || []).includes('prestador_externo') || Boolean(vinculo.is_freelance)
    );
    const temExEmpregados = vinculosEncerradosDoContexto.some((vinculo) =>
        !(vinculo.tipos || []).some((tipoVinculo) =>
            tipoVinculo === 'socio'
            || tipoVinculo === 'ex_socio'
            || tipoVinculo === 'prestador_externo'
        )
        && !vinculo.is_freelance
    );
    const totalCategoriasAntigas = [temExSocios, temExPrestadores, temExEmpregados].filter(Boolean).length;
    const categoriaAntigos = totalCategoriasAntigas > 1
        ? 'Ex-integrantes'
        : temExSocios
            ? 'Ex-sócios'
            : temExPrestadores
                ? 'Ex-prestadores'
                : 'Ex-empregados';
    const rotuloAntigos = empresaContextoNome
        ? `${categoriaAntigos} — ${empresaContextoNome}`
        : `${categoriaAntigos} das empresas`;

    return (
        <>
            <section className="go-toolbar gs-card gs-card--compacto">
                <div className="go-toolbar-busca">
                    <i className="fas fa-search"></i>
                    <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, usuário ou e-mail" />
                </div>
                <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Filtrar por função">
                    <option value="">Todas as funções</option>
                    <option value="administrador">Administradores</option>
                    <option value="supervisor">Supervisores</option>
                    <option value="lider_setor">Líderes</option>
                    <option value="costureira">Costureiras</option>
                    <option value="tiktik">TikTik</option>
                    <option value="cortador">Cortadores</option>
                    <option value="prestador_externo">Prestadores externos</option>
                </select>
                <div className="go-segmentado">
                    <button className={escopo === 'atual' ? 'ativo' : ''} onClick={() => onEscopo('atual')}><i className="fas fa-building"></i> Empresa atual</button>
                    <UIBloqueio permissao="visualizar-todas-empresas">
                        <button className={escopo === 'global' ? 'ativo' : ''} onClick={() => onEscopo('global')}><i className="fas fa-sitemap"></i> Visão global</button>
                    </UIBloqueio>
                </div>
                <UIBloqueio permissao="acesso-cadastrar-usuarios">
                    <button className="gs-btn gs-btn-primario" onClick={onNovaPessoa}><i className="fas fa-user-plus"></i> Nova pessoa</button>
                </UIBloqueio>
            </section>

            {carregando ? <UICarregando variante="bloco" /> : (
                <>
                    <section className="go-secao">
                        <div className="go-secao-cabecalho">
                            <div><span className="go-eyebrow">{empresaFocoId ? empresas.find((item) => item.id === empresaFocoId)?.nome_fantasia : escopo === 'global' ? 'Organização completa' : empresas.find((item) => item.id === empresaAtivaId)?.nome_fantasia}</span><h2>Pessoas ativas <small>{ativos.length}</small></h2></div>
                        </div>
                        {ativos.length ? (
                            <div className="go-pessoas-grid">
                                {ativos.map((pessoa) => <GOPessoaCard key={pessoa.id} pessoa={pessoa} empresaAtivaId={empresaAtivaId} onEditarVinculo={onEditarVinculo} onNovoVinculo={onNovoVinculo} onEncerrarVinculo={onEncerrarVinculo} />)}
                            </div>
                        ) : <div className="go-vazio"><i className="fas fa-users"></i><p>Nenhuma pessoa encontrada neste contexto.</p></div>}
                    </section>
                    {antigos.length > 0 && (
                        <details className="go-ex-membros gs-card">
                            <summary><span><i className="fas fa-user-clock"></i> {rotuloAntigos}</span><strong>{antigos.length}</strong></summary>
                            <div className="go-pessoas-grid">
                                {antigos.map((pessoa) => <GOPessoaCard key={pessoa.id} pessoa={pessoa} empresaAtivaId={empresaAtivaId} onEditarVinculo={onEditarVinculo} onNovoVinculo={onNovoVinculo} onEncerrarVinculo={onEncerrarVinculo} />)}
                            </div>
                        </details>
                    )}
                </>
            )}
        </>
    );
}
