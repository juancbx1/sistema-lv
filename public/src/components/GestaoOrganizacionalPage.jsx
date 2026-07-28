import React, { useCallback, useEffect, useState } from 'react';
import { fetchAPI } from '../../js/utils/api-utils.js';
import { verificarAutenticacao } from '../../js/utils/auth.js';
import { mostrarConfirmacao, mostrarMensagem } from '../../js/utils/popups.js';
import UIHeaderPagina from './UIHeaderPagina.jsx';
import GOPessoasTab from './GOPessoasTab.jsx';
import GOEmpresasTab from './GOEmpresasTab.jsx';
import GOPessoaModal from './GOPessoaModal.jsx';
import GOVinculoModal from './GOVinculoModal.jsx';
import GOEmpresaModal from './GOEmpresaModal.jsx';
import UIBloqueio from './UIBloqueio.jsx';

export default function GestaoOrganizacionalPage() {
    const [aba, setAba] = useState('pessoas');
    const [escopo, setEscopo] = useState('atual');
    const [empresaFocoId, setEmpresaFocoId] = useState(null);
    const [empresaAtivaId, setEmpresaAtivaId] = useState(null);
    const [empresas, setEmpresas] = useState([]);
    const [pessoas, setPessoas] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [modalPessoa, setModalPessoa] = useState(null);
    const [modalEmpresa, setModalEmpresa] = useState(null);
    const [modalVinculo, setModalVinculo] = useState(null);

    const carregarEmpresas = useCallback(async () => {
        const dados = await fetchAPI('/api/gestao-organizacional/empresas');
        setEmpresas(dados);
        return dados;
    }, []);

    const carregarPessoas = useCallback(async (escopoAtual = 'atual') => {
        const dados = await fetchAPI(`/api/gestao-organizacional/pessoas?escopo=${escopoAtual}`);
        setPessoas(dados);
    }, []);

    useEffect(() => {
        const iniciar = async () => {
            const auth = await verificarAutenticacao(
                'gestao-organizacional.html',
                ['acesso-gestao-organizacional', 'acesso-usuarios-cadastrados'],
                'any'
            );
            if (!auth) return;
            setEmpresaAtivaId(auth.usuario.empresa_ativa?.id || null);
            try {
                await Promise.all([carregarEmpresas(), carregarPessoas('atual')]);
            } catch (error) {
                mostrarMensagem(error.message, 'erro');
            } finally {
                setCarregando(false);
            }
        };
        iniciar();
    }, [carregarEmpresas, carregarPessoas]);

    const atualizarTudo = async () => {
        await Promise.all([carregarEmpresas(), carregarPessoas(escopo === 'atual' ? 'atual' : 'global')]);
    };

    const mudarEscopo = async (novoEscopo) => {
        if (novoEscopo === escopo && !empresaFocoId) return;
        setEscopo(novoEscopo);
        setEmpresaFocoId(null);
        setCarregando(true);
        try {
            await carregarPessoas(novoEscopo);
        } catch (error) {
            mostrarMensagem(error.message, 'erro');
        } finally {
            setCarregando(false);
        }
    };

    const salvarEmpresa = async (form) => {
        const endpoint = modalEmpresa?.id
            ? `/api/gestao-organizacional/empresas/${modalEmpresa.id}`
            : '/api/gestao-organizacional/empresas';
        await fetchAPI(endpoint, {
            method: modalEmpresa?.id ? 'PUT' : 'POST',
            body: JSON.stringify(form),
        });
        setModalEmpresa(null);
        await atualizarTudo();
        mostrarMensagem('Perfil da empresa salvo com sucesso.', 'sucesso', 2500);
    };

    const salvarPessoa = async (form) => {
        const endpoint = modalPessoa?.id
            ? `/api/gestao-organizacional/pessoas/${modalPessoa.id}`
            : '/api/gestao-organizacional/pessoas';
        await fetchAPI(endpoint, {
            method: modalPessoa?.id ? 'PUT' : 'POST',
            body: JSON.stringify(form),
        });
        setModalPessoa(null);
        await atualizarTudo();
        mostrarMensagem('Pessoa salva com sucesso.', 'sucesso', 2500);
    };

    const salvarVinculo = async (form) => {
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
        mostrarMensagem('Vínculo salvo com sucesso.', 'sucesso', 2500);
    };

    const encerrarVinculo = async (pessoa, vinculo) => {
        const confirmou = await mostrarConfirmacao(
            `Encerrar o vínculo de ${pessoa.nome} com ${vinculo.empresa_nome}? Os outros vínculos e o login serão preservados.`,
            { tipo: 'perigo', textoConfirmar: 'Encerrar vínculo', textoCancelar: 'Cancelar' }
        );
        if (!confirmou) return;
        try {
            await fetchAPI(`/api/gestao-organizacional/vinculos/${vinculo.id}/encerrar`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            await atualizarTudo();
            mostrarMensagem('Vínculo encerrado sem afetar as outras empresas.', 'sucesso', 3000);
        } catch (error) {
            mostrarMensagem(error.message, 'erro');
        }
    };

    const verPessoasEmpresa = async (empresa) => {
        setAba('pessoas');
        setEscopo('global');
        setEmpresaFocoId(empresa.id);
        setCarregando(true);
        try {
            await carregarPessoas('global');
        } catch (error) {
            mostrarMensagem(error.message, 'erro');
        } finally {
            setCarregando(false);
        }
    };

    return (
        <>
            <UIHeaderPagina titulo="Gestão Organizacional">
                <span className="go-header-contexto"><i className="fas fa-building"></i> {empresas.find((item) => item.id === empresaAtivaId)?.nome_fantasia || 'Empresa ativa'}</span>
            </UIHeaderPagina>
            <nav className="gs-tab-nav" aria-label="Áreas da gestão organizacional">
                <button className={aba === 'pessoas' ? 'ativo' : ''} onClick={() => setAba('pessoas')}>
                    <i className="fas fa-users"></i> Pessoas e Acessos
                </button>
                <UIBloqueio permissao="visualizar-empresas">
                    <button className={aba === 'empresas' ? 'ativo' : ''} onClick={() => setAba('empresas')}>
                        <i className="fas fa-building"></i> Empresas
                    </button>
                </UIBloqueio>
            </nav>
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
                        onEditarPessoa={setModalPessoa}
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
                    pessoa={modalPessoa.id ? modalPessoa : null}
                    empresas={empresas}
                    empresaAtivaId={empresaAtivaId}
                    onClose={() => setModalPessoa(null)}
                    onSalvar={salvarPessoa}
                />
            )}
            {modalEmpresa && (
                <GOEmpresaModal
                    empresa={modalEmpresa.id ? modalEmpresa : null}
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
