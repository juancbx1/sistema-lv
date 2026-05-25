import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { fetchAPI } from '/js/utils/api-utils.js';
import { verificarAutenticacao } from '/js/utils/auth.js';
import UIHeaderPagina from './components/UIHeaderPagina.jsx';
import UICarregando from './components/UICarregando.jsx';
import UIBloqueio from './components/UIBloqueio.jsx';
import UCCard from './components/UCCard.jsx';
import UCDrawerEdicao from './components/UCDrawerEdicao.jsx';
import UCCriarModal from './components/UCCriarModal.jsx';

const PRODUTIVOS = ['costureira', 'tiktik', 'cortador', 'supervisor', 'lider_setor'];

export function getCategoriaUsuario(usuario) {
    const tipos = usuario.tipos || [];
    if (tipos.includes('prestador_externo')) return 'prestador_externo';
    if (tipos.includes('ex_socio')) return 'ex_socio';
    // Compat: sócio com data_demissao preenchida → ex_socio
    if (usuario.data_demissao && tipos.includes('socio')) return 'ex_socio';
    if (usuario.data_demissao) return 'ex_empregado';
    if (tipos.includes('socio')) return 'socio';
    if (tipos.some(t => PRODUTIVOS.includes(t))) return 'empregado';
    return 'administrador';
}

const FILTROS = [
    { id: '', label: 'Todos' },
    { id: 'costureira', label: 'Costureiras' },
    { id: 'tiktik', label: 'TikTik' },
    { id: 'cortador', label: 'Cortadores' },
    { id: 'supervisor', label: 'Supervisores' },
    { id: 'socio', label: 'Sócios' },
    { id: 'prestador_externo', label: 'Externos' },
    { id: 'administrador', label: 'Administradores' },
];

export default function MainUsuarios() {
    const [usuarios, setUsuarios] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filtroTipo, setFiltroTipo] = useState('');
    const [concessionarias, setConcessionarias] = useState([]);
    const [drawerUsuario, setDrawerUsuario] = useState(null);
    const [modalCriar, setModalCriar] = useState(false);
    const [exAberto, setExAberto] = useState(false);

    useEffect(() => {
        const init = async () => {
            const auth = await verificarAutenticacao('usuarios-cadastrados.html', ['acesso-usuarios-cadastrados']);
            if (!auth) return;
            await carregarUsuarios();
        };
        init();
    }, []);

    const carregarUsuarios = async () => {
        setLoading(true);
        try {
            const [dadosUsuarios, dadosConcess] = await Promise.all([
                fetchAPI('/api/usuarios'),
                fetchAPI('/api/financeiro/concessionarias-vt'),
            ]);
            setConcessionarias(dadosConcess);
            setUsuarios(dadosUsuarios.sort((a, b) => a.nome.localeCompare(b.nome)));
        } catch (error) {
            console.error('Erro ao carregar usuários:', error);
        } finally {
            setLoading(false);
        }
    };

    const filtrados = filtroTipo
        ? usuarios.filter(u => u.tipos && u.tipos.includes(filtroTipo))
        : usuarios;

    const EX_CATEGORIAS = ['ex_empregado', 'ex_socio'];
    const ativos = filtrados.filter(u => !EX_CATEGORIAS.includes(getCategoriaUsuario(u)));
    const exMembros = filtrados.filter(u => EX_CATEGORIAS.includes(getCategoriaUsuario(u)));

    return (
        <>
            <UIHeaderPagina titulo="Usuários cadastrados">
                <UIBloqueio permissao="acesso-cadastrar-usuarios">
                    <button className="gs-btn gs-btn-primario" onClick={() => setModalCriar(true)}>
                        <i className="fas fa-plus"></i> Novo usuário
                    </button>
                </UIBloqueio>
            </UIHeaderPagina>

            <div className="gs-conteudo-pagina">
                <div className="uc-filtros-chips">
                    {FILTROS.map(f => (
                        <button
                            key={f.id}
                            className={`uc-filtro-chip${filtroTipo === f.id ? ' uc-filtro-chip--ativo' : ''}`}
                            onClick={() => setFiltroTipo(f.id)}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <UICarregando variante="bloco" />
                ) : (
                    <>
                        {/* Seção Ativos */}
                        <div className="uc-secao">
                            <h2 className="uc-secao-titulo">
                                Ativos <span className="uc-secao-count">{ativos.length}</span>
                            </h2>
                            {ativos.length === 0 ? (
                                <p className="uc-sem-resultados">Nenhum usuário ativo encontrado.</p>
                            ) : (
                                <div className="uc-grid">
                                    {ativos.map(u => (
                                        <UCCard
                                            key={u.id}
                                            usuario={u}
                                            categoria={getCategoriaUsuario(u)}
                                            onEditar={setDrawerUsuario}
                                            aoAtualizarLista={carregarUsuarios}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Seção Ex-membros — acordeão (fechado por padrão) */}
                        {exMembros.length > 0 && (
                            <>
                                <div className="uc-divisor"></div>
                                <div className="uc-secao">
                                    <button
                                        className="uc-acordeao-trigger"
                                        onClick={() => setExAberto(p => !p)}
                                        aria-expanded={exAberto}
                                    >
                                        <h2 className="uc-secao-titulo" style={{ marginBottom: 0 }}>
                                            Ex-membros <span className="uc-secao-count">{exMembros.length}</span>
                                        </h2>
                                        <i className={`fas fa-chevron-${exAberto ? 'up' : 'down'} uc-acordeao-icone`}></i>
                                    </button>

                                    {exAberto && (
                                        <div className="uc-grid uc-grid--ex" style={{ marginTop: 16 }}>
                                            {exMembros.map(u => (
                                                <UCCard
                                                    key={u.id}
                                                    usuario={u}
                                                    categoria={getCategoriaUsuario(u)}
                                                    onEditar={setDrawerUsuario}
                                                    aoAtualizarLista={carregarUsuarios}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>

            {drawerUsuario && (
                <UCDrawerEdicao
                    usuario={drawerUsuario}
                    onClose={() => setDrawerUsuario(null)}
                    aoSalvar={() => { setDrawerUsuario(null); carregarUsuarios(); }}
                    aoAtualizarLista={carregarUsuarios}
                    concessionarias={concessionarias}
                />
            )}
            {modalCriar && (
                <UCCriarModal
                    onClose={() => setModalCriar(false)}
                    aoSalvar={() => { setModalCriar(false); carregarUsuarios(); }}
                    concessionarias={concessionarias}
                />
            )}
        </>
    );
}

const rootEl = document.getElementById('root');
if (rootEl) {
    ReactDOM.createRoot(rootEl).render(
        <React.StrictMode>
            <MainUsuarios />
        </React.StrictMode>
    );
}
