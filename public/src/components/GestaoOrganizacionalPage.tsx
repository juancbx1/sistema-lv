import React, { useCallback, useEffect, useState } from 'react';
import { fetchAPI } from '../../js/utils/api-utils.js';
import { verificarAutenticacao } from '../../js/utils/auth.js';
import { mostrarConfirmacao, mostrarMensagem } from '../../js/utils/popups.js';
import UIHeaderPagina from './UIHeaderPagina';
import UITabNav from './UITabNav';
import GOPessoasTab from './GOPessoasTab';
import GOEmpresasTab from './GOEmpresasTab';
import GOPessoaModal from './GOPessoaModal';
import GOVinculoModal, { classificarVinculo } from './GOVinculoModal';
import GOEmpresaModal from './GOEmpresaModal';
import type {
    GOAba,
    GOAuthResult,
    GOEmpresa,
    GOEmpresaForm,
    GOEscopo,
    GOModalEmpresa,
    GOModalPessoa,
    GOModalVinculo,
    GOPessoa,
    GOVinculo,
} from '../utils/go-types';
import type { GOPessoaSalvarPayload } from './GOPessoaModal';
import type { GOVinculoSalvarPayload } from './GOVinculoModal';

export default function GestaoOrganizacionalPage() {
    const [aba, setAba] = useState<GOAba>('pessoas');
    const [escopo, setEscopo] = useState<GOEscopo>('atual');
    const [empresaFocoId, setEmpresaFocoId] = useState<number | null>(null);
    const [empresaAtivaId, setEmpresaAtivaId] = useState<number | null>(null);
    const [empresas, setEmpresas] = useState<GOEmpresa[]>([]);
    const [pessoas, setPessoas] = useState<GOPessoa[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [modalPessoa, setModalPessoa] = useState<GOModalPessoa | null>(null);
    const [modalEmpresa, setModalEmpresa] = useState<GOModalEmpresa | null>(null);
    const [modalVinculo, setModalVinculo] = useState<GOModalVinculo | null>(null);

    const carregarEmpresas = useCallback(async () => {
        const dados = await fetchAPI('/api/gestao-organizacional/empresas') as GOEmpresa[];
        setEmpresas(dados);
        return dados;
    }, []);

    const carregarPessoas = useCallback(async (escopoAtual: GOEscopo = 'atual') => {
        const dados = await fetchAPI(`/api/gestao-organizacional/pessoas?escopo=${escopoAtual}`) as GOPessoa[];
        setPessoas(dados);
    }, []);

    useEffect(() => {
        const iniciar = async () => {
            const auth = await verificarAutenticacao(
                'gestao-organizacional.html',
                ['acesso-gestao-organizacional', 'acesso-usuarios-cadastrados'],
                'any'
            ) as GOAuthResult | null | false | undefined;
            if (!auth) return;
            document.getElementById('lv-initial-page-loader')?.remove();
            setEmpresaAtivaId(auth.usuario.empresa_ativa?.id || null);
            try {
                await Promise.all([carregarEmpresas(), carregarPessoas('atual')]);
            } catch (error) {
                mostrarMensagem(error instanceof Error ? error.message : 'Erro', 'erro');
            } finally {
                setCarregando(false);
            }
        };
        void iniciar();
    }, [carregarEmpresas, carregarPessoas]);

    const atualizarTudo = async () => {
        await Promise.all([carregarEmpresas(), carregarPessoas(escopo === 'atual' ? 'atual' : 'global')]);
    };

    const mudarEscopo = async (novoEscopo: GOEscopo) => {
        if (novoEscopo === escopo && !empresaFocoId) return;
        setEscopo(novoEscopo);
        setEmpresaFocoId(null);
        setCarregando(true);
        try {
            await carregarPessoas(novoEscopo);
        } catch (error) {
            mostrarMensagem(error instanceof Error ? error.message : 'Erro', 'erro');
        } finally {
            setCarregando(false);
        }
    };

    const salvarEmpresa = async (form: GOEmpresaForm) => {
        const endpoint = modalEmpresa && 'id' in modalEmpresa && modalEmpresa.id
            ? `/api/gestao-organizacional/empresas/${modalEmpresa.id}`
            : '/api/gestao-organizacional/empresas';
        await fetchAPI(endpoint, {
            method: modalEmpresa && 'id' in modalEmpresa && modalEmpresa.id ? 'PUT' : 'POST',
            body: JSON.stringify(form),
        });
        setModalEmpresa(null);
        await atualizarTudo();
        mostrarMensagem('Perfil da empresa salvo com sucesso.', 'sucesso', 2500);
    };

    const salvarPessoa = async (form: GOPessoaSalvarPayload) => {
        const endpoint = modalPessoa && 'id' in modalPessoa && modalPessoa.id
            ? `/api/gestao-organizacional/pessoas/${modalPessoa.id}`
            : '/api/gestao-organizacional/pessoas';
        await fetchAPI(endpoint, {
            method: modalPessoa && 'id' in modalPessoa && modalPessoa.id ? 'PUT' : 'POST',
            body: JSON.stringify(form),
        });
        setModalPessoa(null);
        await atualizarTudo();
        mostrarMensagem('Pessoa salva com sucesso.', 'sucesso', 2500);
    };

    const salvarVinculo = async (form: GOVinculoSalvarPayload) => {
        if (!modalVinculo) return;
        const { pessoa, vinculo } = modalVinculo;
        const endpoint = vinculo
            ? `/api/gestao-organizacional/vinculos/${vinculo.id}`
            : `/api/gestao-organizacional/pessoas/${pessoa.id}/vinculos`;
        await fetchAPI(endpoint, {
            method: vinculo ? 'PUT' : 'POST',
            body: JSON.stringify(form),
        });
        setModalVinculo(null);
        await atualizarTudo();
        mostrarMensagem(
            vinculo ? 'Cadastro e vínculo salvos com sucesso.' : 'Novo vínculo criado com sucesso.',
            'sucesso',
            2500
        );
    };

    const encerrarVinculo = async (pessoa: GOPessoa, vinculo: GOVinculo) => {
        const { socio, prestador } = classificarVinculo(vinculo);
        const dataDemissao = new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo',
        }).format(new Date());
        const mensagemConfirmacao = socio
            ? `Registrar a saída de ${pessoa.nome} do quadro societário da ${vinculo.empresa_nome} em ${dataDemissao}? O vínculo será encerrado, mas os outros vínculos e o login serão preservados.`
            : prestador
                ? `Encerrar a prestação de serviços de ${pessoa.nome} para a ${vinculo.empresa_nome} em ${dataDemissao}? Os outros vínculos e o acesso global da pessoa serão preservados.`
                : `Registrar a demissão de ${pessoa.nome} da ${vinculo.empresa_nome} em ${dataDemissao}? O vínculo será encerrado, mas os outros vínculos e o login serão preservados.`;
        const confirmou = await mostrarConfirmacao(
            mensagemConfirmacao,
            {
                tipo: socio || prestador ? 'aviso' : 'perigo',
                textoConfirmar: socio ? 'Registrar saída' : prestador ? 'Encerrar prestação' : 'Registrar demissão',
                textoCancelar: 'Cancelar',
            }
        ) as boolean;
        if (!confirmou) return;
        try {
            await fetchAPI(`/api/gestao-organizacional/vinculos/${vinculo.id}/encerrar`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            await atualizarTudo();
            mostrarMensagem(
                socio
                    ? 'Saída societária registrada sem afetar os outros vínculos.'
                    : prestador
                        ? 'Prestação de serviços encerrada sem afetar os outros vínculos.'
                        : 'Demissão registrada e vínculo encerrado sem afetar as outras empresas.',
                'sucesso',
                3000
            );
        } catch (error) {
            mostrarMensagem(error instanceof Error ? error.message : 'Erro', 'erro');
        }
    };

    const verPessoasEmpresa = async (empresa: GOEmpresa) => {
        setAba('pessoas');
        setEscopo('global');
        setEmpresaFocoId(empresa.id);
        setCarregando(true);
        try {
            await carregarPessoas('global');
        } catch (error) {
            mostrarMensagem(error instanceof Error ? error.message : 'Erro', 'erro');
        } finally {
            setCarregando(false);
        }
    };

    const empresaAtiva = empresas.find((item) => item.id === empresaAtivaId);
    const pessoaModal = modalPessoa && 'id' in modalPessoa && modalPessoa.id
        ? modalPessoa as GOPessoa
        : null;
    const empresaModal = modalEmpresa && 'id' in modalEmpresa && modalEmpresa.id
        ? modalEmpresa as GOEmpresa
        : null;

    return (
        <>
            <UIHeaderPagina titulo="Gestão Organizacional">
                <span className="go-header-contexto">
                    <i className="fas fa-building"></i>
                    <span>
                        <strong>{empresaAtiva?.nome_fantasia || 'Empresa ativa'}</strong>
                        <code>{empresaAtiva?.codigo || 'carregando-contexto'}</code>
                    </span>
                </span>
            </UIHeaderPagina>
            <UITabNav
                ariaLabel="Áreas da gestão organizacional"
                activeId={aba}
                onChange={(id) => setAba(id as GOAba)}
                items={[
                    { id: 'pessoas', label: 'Pessoas e Acessos', icon: 'fa-users' },
                    {
                        id: 'empresas',
                        label: 'Empresas',
                        icon: 'fa-building',
                        locked: { permissao: 'visualizar-empresas' },
                    },
                ]}
            />
            <div className="gs-conteudo-pagina">
                {aba === 'pessoas' ? (
                    <GOPessoasTab
                        pessoas={pessoas}
                        empresas={empresas}
                        empresaAtivaId={empresaAtivaId}
                        empresaFocoId={empresaFocoId}
                        carregando={carregando}
                        escopo={escopo}
                        onEscopo={mudarEscopo}
                        onNovaPessoa={() => setModalPessoa({})}
                        onEditarVinculo={(pessoa, vinculo) => setModalVinculo({ pessoa, vinculo })}
                        onNovoVinculo={(pessoa) => setModalVinculo({ pessoa, vinculo: null })}
                        onEncerrarVinculo={encerrarVinculo}
                    />
                ) : (
                    <GOEmpresasTab
                        empresas={empresas}
                        empresaAtivaId={empresaAtivaId}
                        carregando={carregando}
                        onNova={() => setModalEmpresa({})}
                        onEditar={setModalEmpresa}
                        onVerPessoas={verPessoasEmpresa}
                    />
                )}
            </div>
            {modalPessoa && (
                <GOPessoaModal
                    pessoa={pessoaModal}
                    empresas={empresas}
                    empresaAtivaId={empresaAtivaId}
                    onClose={() => setModalPessoa(null)}
                    onSalvar={salvarPessoa}
                />
            )}
            {modalEmpresa && (
                <GOEmpresaModal
                    empresa={empresaModal}
                    onClose={() => setModalEmpresa(null)}
                    onSalvar={salvarEmpresa}
                />
            )}
            {modalVinculo && (
                <GOVinculoModal
                    pessoa={modalVinculo.pessoa}
                    vinculo={modalVinculo.vinculo}
                    empresas={empresas}
                    onClose={() => setModalVinculo(null)}
                    onSalvar={salvarVinculo}
                />
            )}
        </>
    );
}
