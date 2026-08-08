import React, { useCallback, useEffect, useMemo, useState } from 'react';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import type { GOEmpresa, GOEscopo } from '../utils/go-types';

const LIMIT = 12;

type GOAuditoriaDetalhes = Record<string, unknown>;

interface GOAuditoriaLog {
    id: number;
    usuario_id?: number | null;
    usuario_nome?: string | null;
    acao: string;
    entidade_id?: number | string | null;
    detalhes?: GOAuditoriaDetalhes | null;
    criado_em: string;
}

interface GOAuditoriaUsuario {
    usuario_id: number;
    usuario_nome: string;
}

interface GOAuditoriaTabProps {
    empresas: GOEmpresa[];
    empresaAtivaId: number | null;
    empresaFocoId: number | null;
    escopo: GOEscopo;
}

interface GOAuditoriaFiltros {
    usuario_id: string;
    acao: string;
    data_inicio: string;
    data_fim: string;
}

interface GOAuditoriaAcao {
    value: string;
    label: string;
}

const OPCOES_ACAO: GOAuditoriaAcao[] = [
    { value: '', label: 'Todas as ações' },
    { value: 'op.encerrada', label: 'OP: Encerrada' },
    { value: 'op.cancelada', label: 'OP: Cancelada' },
    { value: 'op.gerada_do_estoque', label: 'OP: Gerada do Estoque' },
    { value: 'producao.lancada', label: 'Produção: Lançada' },
    { value: 'producao.excluida', label: 'Produção: Excluída (direto)' },
    { value: 'producao.editada', label: 'Produção: Editada' },
    { value: 'producao.exclusao_solicitada', label: 'Produção: Exclusão solicitada' },
    { value: 'producao.exclusao_aprovada', label: 'Produção: Exclusão aprovada' },
    { value: 'producao.exclusao_rejeitada', label: 'Produção: Exclusão rejeitada' },
    { value: 'corte.registrado', label: 'Corte: Registrado' },
    { value: 'arremate.lancado', label: 'Arremate: Lançado' },
    { value: 'arremate.estornado', label: 'Arremate: Estornado' },
    { value: 'permissoes.alteradas', label: 'Permissões: Alteradas' },
    { value: 'tarefa_freelance.atribuida', label: 'Tarefa freelance: Atribuída' },
];

function buscarDetalhe(log: GOAuditoriaLog, chave: string): string {
    const valor = log.detalhes?.[chave];
    return valor === null || valor === undefined ? '' : String(valor);
}

function descreverAcao(log: GOAuditoriaLog): string {
    const detalhe = (chave: string) => buscarDetalhe(log, chave);
    const mapa: Record<string, () => string> = {
        'op.encerrada': () => `encerrou a OP #${log.entidade_id || ''}`,
        'op.cancelada': () => `cancelou a OP #${log.entidade_id || ''}`,
        'op.gerada_do_estoque': () => `gerou a OP #${log.entidade_id || ''} do estoque de cortes`,
        'op.criada': () => `criou a OP #${log.entidade_id || ''}`,
        'producao.lancada': () => `lançou ${detalhe('quantidade')} peças para ${detalhe('funcionario_nome')} (${detalhe('etapa_processo')})`,
        'producao.excluida': () => `excluiu diretamente ${detalhe('quantidade')} peças de ${detalhe('funcionario_nome')}`,
        'producao.editada': () => `editou produção de ${detalhe('funcionario_nome')}: ${detalhe('quantidade_antes')} → ${detalhe('quantidade_depois')} peças`,
        'producao.exclusao_solicitada': () => `solicitou exclusão de ${detalhe('quantidade')} peças de produção de ${detalhe('funcionario_nome')}`,
        'producao.exclusao_aprovada': () => `aprovou exclusão de ${detalhe('quantidade')} peças de ${detalhe('funcionario_nome')}`,
        'producao.exclusao_rejeitada': () => `rejeitou exclusão de ${detalhe('quantidade')} peças de ${detalhe('funcionario_nome')}`,
        'corte.registrado': () => `registrou o corte PC${log.entidade_id || ''} (${detalhe('quantidade')} unidades)`,
        'arremate.lancado': () => `lançou ${detalhe('quantidade')} arremates para ${detalhe('funcionario_nome')} — OP #${detalhe('op_numero')}`,
        'arremate.estornado': () => `estornou arremate da OP #${detalhe('op_numero')}`,
        'permissoes.alteradas': () => `alterou as permissões de ${detalhe('usuario_alvo_nome')}`,
        'tarefa_freelance.atribuida': () => `atribuiu tarefa de ${detalhe('etapa')} para freelance — OP #${detalhe('op_numero')}`,
    };
    return mapa[log.acao]?.() || log.acao;
}

function tempoRelativo(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const minutos = Math.floor(diff / 60000);
    if (minutos < 1) return 'agora mesmo';
    if (minutos < 60) return `há ${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `há ${horas}h`;
    return `há ${Math.floor(horas / 24)}d`;
}

function iniciais(nome: string | null | undefined): string {
    if (!nome) return '?';
    const partes = nome.trim().split(/\s+/);
    if (partes.length === 1) return partes[0][0].toUpperCase();
    return `${partes[0][0]}${partes[partes.length - 1][0]}`.toUpperCase();
}

function dataFimInclusiva(data: string): string {
    const fim = new Date(`${data}T00:00:00`);
    fim.setDate(fim.getDate() + 1);
    return fim.toISOString().slice(0, 10);
}

function contextoEmpresa(
    empresas: GOEmpresa[],
    empresaAtivaId: number | null,
    empresaFocoId: number | null,
    escopo: GOEscopo
): GOEmpresa | null {
    if (empresaFocoId) return empresas.find((empresa) => empresa.id === empresaFocoId) || null;
    if (escopo === 'atual' && empresaAtivaId) return empresas.find((empresa) => empresa.id === empresaAtivaId) || null;
    return empresaAtivaId ? empresas.find((empresa) => empresa.id === empresaAtivaId) || null : null;
}

export default function GOAuditoriaTab({
    empresas,
    empresaAtivaId,
    empresaFocoId,
    escopo,
}: GOAuditoriaTabProps) {
    const empresaContextoId = empresaFocoId || empresaAtivaId;
    const empresa = contextoEmpresa(empresas, empresaAtivaId, empresaFocoId, escopo);
    const [logs, setLogs] = useState<GOAuditoriaLog[]>([]);
    const [total, setTotal] = useState(0);
    const [totalPaginas, setTotalPaginas] = useState(0);
    const [pagina, setPagina] = useState(1);
    const [carregando, setCarregando] = useState(true);
    const [usuarios, setUsuarios] = useState<GOAuditoriaUsuario[]>([]);
    const [logExpandido, setLogExpandido] = useState<number | null>(null);
    const [filtros, setFiltros] = useState<GOAuditoriaFiltros>({
        usuario_id: '',
        acao: '',
        data_inicio: '',
        data_fim: '',
    });

    const buscarUsuarios = useCallback(async () => {
        const token = localStorage.getItem('token');
        const params = new URLSearchParams();
        if (empresaContextoId) params.set('empresa_id', String(empresaContextoId));
        try {
            const resposta = await fetch(`/api/audit-log/usuarios?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!resposta.ok) return;
            setUsuarios(await resposta.json() as GOAuditoriaUsuario[]);
        } catch {
            setUsuarios([]);
        }
    }, [empresaContextoId]);

    const buscarLogs = useCallback(async (paginaParam = 1) => {
        setCarregando(true);
        const token = localStorage.getItem('token');
        try {
            const params = new URLSearchParams({ page: String(paginaParam), limit: String(LIMIT) });
            if (empresaContextoId) params.set('empresa_id', String(empresaContextoId));
            if (filtros.usuario_id) params.set('usuario_id', filtros.usuario_id);
            if (filtros.acao) params.set('acao', filtros.acao);
            if (filtros.data_inicio) params.set('data_inicio', filtros.data_inicio);
            if (filtros.data_fim) params.set('data_fim', dataFimInclusiva(filtros.data_fim));

            const resposta = await fetch(`/api/audit-log?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!resposta.ok) throw new Error('Erro ao buscar auditoria.');
            const dados = await resposta.json() as {
                logs?: GOAuditoriaLog[];
                total?: number;
                totalPaginas?: number;
            };
            setLogs(dados.logs || []);
            setTotal(Number(dados.total || 0));
            setTotalPaginas(Number(dados.totalPaginas || 0));
            setPagina(paginaParam);
        } catch {
            setLogs([]);
            setTotal(0);
            setTotalPaginas(0);
        } finally {
            setCarregando(false);
        }
    }, [empresaContextoId, filtros]);

    useEffect(() => {
        void buscarUsuarios();
    }, [buscarUsuarios]);

    useEffect(() => {
        void buscarLogs(1);
    }, [buscarLogs]);

    const nomeEmpresa = empresa?.nome_fantasia || 'Empresa ativa';
    const atualizarFiltro = (campo: keyof GOAuditoriaFiltros, valor: string) => {
        setFiltros((atual) => ({ ...atual, [campo]: valor }));
    };
    const limparFiltros = () => setFiltros({ usuario_id: '', acao: '', data_inicio: '', data_fim: '' });
    const acaoSelecionada = useMemo(
        () => OPCOES_ACAO.find((opcao) => opcao.value === filtros.acao)?.label || 'Todas as ações',
        [filtros.acao]
    );

    return (
        <section className="go-auditoria">
            <div className="go-auditoria-cabecalho">
                <div>
                    <span className="go-eyebrow">Auditoria da empresa em foco</span>
                    <h2>{nomeEmpresa}</h2>
                    <p>Histórico das ações realizadas neste contexto empresarial.</p>
                </div>
                <div className="go-auditoria-total-contexto">
                    <i className="fas fa-building-shield"></i>
                    <strong>{total} evento{total === 1 ? '' : 's'}</strong>
                    <small>{empresa ? 'contexto isolado' : 'carregando contexto'}</small>
                </div>
            </div>

            <div className="go-auditoria-filtros">
                <label>
                    <span>Usuário</span>
                    <select value={filtros.usuario_id} onChange={(event) => atualizarFiltro('usuario_id', event.target.value)}>
                        <option value="">Todos os usuários</option>
                        {usuarios.map((usuario) => <option key={usuario.usuario_id} value={usuario.usuario_id}>{usuario.usuario_nome}</option>)}
                    </select>
                </label>
                <label>
                    <span>Ação</span>
                    <select value={filtros.acao} onChange={(event) => atualizarFiltro('acao', event.target.value)} aria-label={`Filtrar ação: ${acaoSelecionada}`}>
                        {OPCOES_ACAO.map((opcao) => <option key={opcao.value} value={opcao.value}>{opcao.label}</option>)}
                    </select>
                </label>
                <label>
                    <span>De</span>
                    <input type="date" value={filtros.data_inicio} onChange={(event) => atualizarFiltro('data_inicio', event.target.value)} />
                </label>
                <label>
                    <span>Até</span>
                    <input type="date" value={filtros.data_fim} onChange={(event) => atualizarFiltro('data_fim', event.target.value)} />
                </label>
                <button type="button" className="go-auditoria-limpar" onClick={limparFiltros}>
                    <i className="fas fa-rotate-left"></i> Limpar filtros
                </button>
            </div>

            {carregando ? <UICarregando variante="bloco" /> : !logs.length ? (
                <UIFeedbackNotFound
                    variante="compacto"
                    icon="fa-history"
                    titulo="Nenhum evento de auditoria encontrado"
                    mensagem="Não há eventos para os filtros selecionados neste contexto."
                />
            ) : (
                <>
                    <ul className="go-auditoria-lista">
                        {logs.map((log) => (
                            <li key={log.id} className="go-auditoria-item">
                                <div className="go-auditoria-avatar">{iniciais(log.usuario_nome)}</div>
                                <div className="go-auditoria-corpo">
                                    <div className="go-auditoria-linha-principal">
                                        <strong>{log.usuario_nome || 'Usuário não identificado'}</strong>
                                        <span>{descreverAcao(log)}</span>
                                        <time dateTime={log.criado_em}>{tempoRelativo(log.criado_em)}</time>
                                    </div>
                                    <button type="button" className="go-auditoria-detalhes-botao" onClick={() => setLogExpandido((atual) => atual === log.id ? null : log.id)}>
                                        {logExpandido === log.id ? 'Ocultar detalhes' : 'Ver detalhes'}
                                    </button>
                                    {logExpandido === log.id && (
                                        <div className="go-auditoria-detalhes">
                                            {Object.entries(log.detalhes || {}).map(([chave, valor]) => (
                                                <div key={chave}>
                                                    <strong>{chave}</strong>
                                                    <span>{Array.isArray(valor) ? valor.join(', ') || '—' : String(valor ?? '—')}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                    {totalPaginas > 1 && (
                        <div className="go-auditoria-paginacao">
                            <button type="button" onClick={() => void buscarLogs(pagina - 1)} disabled={pagina <= 1}>Anterior</button>
                            <span>Página {pagina} de {totalPaginas}</span>
                            <button type="button" onClick={() => void buscarLogs(pagina + 1)} disabled={pagina >= totalPaginas}>Próxima</button>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
