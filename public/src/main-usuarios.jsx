import React, { useState, useEffect } from 'react';
import { fetchAPI } from '/js/utils/api-utils.js';
import { verificarAutenticacao } from '/js/utils/auth.js'; // Mantendo auth legado
import UserFiltros from './components/UserFiltros';
import UserListCards from './components/UserListCards';
import UserFeriasModal from './components/UserFeriasModal';
import UserFinanceiroModal from './components/UserFinanceiroModal';
import UserCreateModal from './components/UserCreateModal';
import UIBloqueio from './components/UIBloqueio.jsx';

export default function MainUsuarios() {
    const [usuarios, setUsuarios] = useState([]);
    const [usuariosFiltrados, setUsuariosFiltrados] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filtroTipo, setFiltroTipo] = useState('');
    const [permissoes, setPermissoes] = useState([]);
    const [concessionarias, setConcessionarias] = useState([]);
    
    // Paginação
    const [paginaAtual, setPaginaAtual] = useState(1);
    const ITENS_POR_PAGINA = 8;

    // Estados dos Modais
    const [modalFeriasUser, setModalFeriasUser] = useState(null); // Se não null, modal aberto
    const [modalVinculoUser, setModalVinculoUser] = useState(null); // Se não null, modal aberto
    const [modalCriarUser, setModalCriarUser] = useState(false);


    useEffect(() => {
        // Autenticação e Carregamento Inicial
        const init = async () => {
            const auth = await verificarAutenticacao('usuarios-cadastrados.html', ['acesso-usuarios-cadastrados']);
            if (!auth) return; // Redirecionado pelo auth
            
            setPermissoes(auth.permissoes || []);
            await carregarUsuarios();
        };
        init();
    }, []);

    const carregarUsuarios = async () => {
        setLoading(true);
        try {
            // Busca usuários e concessionárias em paralelo
            const [dadosUsuarios, dadosConcess] = await Promise.all([
                fetchAPI('/api/usuarios'),
                fetchAPI('/api/financeiro/concessionarias-vt')
            ]);
            
            setConcessionarias(dadosConcess); // Salva para passar aos modais
            const ordenados = dadosUsuarios.sort((a, b) => a.nome.localeCompare(b.nome));
            setUsuarios(ordenados);
        } catch (error) {
            console.error('Erro ao carregar usuários:', error);
        } finally {
            setLoading(false);
        }
    };

    // Efeito de Filtro e Paginação
    useEffect(() => {
        let filtrados = usuarios;
        if (filtroTipo) {
            filtrados = usuarios.filter(u => u.tipos && u.tipos.includes(filtroTipo));
        }
        setUsuariosFiltrados(filtrados);
        setPaginaAtual(1); // Reseta para pág 1 quando filtra
    }, [usuarios, filtroTipo]);

    // Cálculo da Paginação
    const totalPaginas = Math.ceil(usuariosFiltrados.length / ITENS_POR_PAGINA);
    const indiceInicial = (paginaAtual - 1) * ITENS_POR_PAGINA;
    const usuariosDaPagina = usuariosFiltrados.slice(indiceInicial, indiceInicial + ITENS_POR_PAGINA);

    // Callbacks para os Modais
    const handleFecharFerias = () => setModalFeriasUser(null);
    const handleFecharVinculo = () => setModalVinculoUser(null);
    const handleSalvarModal = () => {
        // Fecha os modais e recarrega a lista para atualizar os dados
        setModalFeriasUser(null);
        setModalVinculoUser(null);
        carregarUsuarios();
    };

    return (
        <div className="container uc-container">
            <section className="usuarios-cadastrados">
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                    <h1>Gerenciar Usuários</h1>
                    <UIBloqueio permissao="acesso-cadastrar-usuarios">
                        <button className="gs-btn gs-btn-primario" onClick={() => setModalCriarUser(true)}>
                            <i className="fas fa-plus"></i> Novo Usuário
                        </button>
                    </UIBloqueio>
                </div>
                
                <UserFiltros 
                    filtroAtual={filtroTipo} 
                    setFiltroAtual={setFiltroTipo} 
                />

                {loading ? (
                    <div className="uc-loading-spinner" style={{ display: 'block' }}>
                        <i className="fas fa-spinner fa-spin"></i> Carregando...
                    </div>
                ) : (
                    <>
                        <UserListCards 
                            usuarios={usuariosDaPagina} 
                            permissoesLogado={permissoes}
                            aoAtualizarLista={carregarUsuarios}
                            aoAbrirFerias={setModalFeriasUser}
                            aoAbrirVinculo={setModalVinculoUser}
                            concessionarias={concessionarias} 
                        />

                        {/* Controles de Paginação */}
                        {usuariosFiltrados.length > 0 && (
                            <div className="gs-paginacao-container" style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', gap: '15px', alignItems: 'center' }}>
                                <button 
                                    className="gs-paginacao-btn" 
                                    disabled={paginaAtual === 1}
                                    onClick={() => setPaginaAtual(p => p - 1)}
                                >
                                    Anterior
                                </button>
                                <span className="gs-paginacao-info">
                                    Página {paginaAtual} de {totalPaginas}
                                </span>
                                <button 
                                    className="gs-paginacao-btn" 
                                    disabled={paginaAtual === totalPaginas}
                                    onClick={() => setPaginaAtual(p => p + 1)}
                                >
                                    Próximo
                                </button>
                            </div>
                        )}
                    </>
                )}
            </section>

            {/* Renderização Condicional dos Modais */}
            {modalFeriasUser && (
                <UserFeriasModal 
                    usuario={modalFeriasUser} 
                    onClose={handleFecharFerias} 
                    aoSalvar={handleSalvarModal} 
                />
            )}
            
            {modalVinculoUser && (
                <UserFinanceiroModal 
                    usuario={modalVinculoUser} 
                    onClose={handleFecharVinculo} 
                    aoSalvar={handleSalvarModal} 
                />
            )}

            {modalCriarUser && (
                <UserCreateModal 
                    onClose={() => setModalCriarUser(false)} 
                    aoSalvar={() => { setModalCriarUser(false); carregarUsuarios(); }}
                    concessionarias={concessionarias}
                />
            )}
        </div>
    );
}