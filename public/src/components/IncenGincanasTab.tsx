// public/src/components/IncenGincanasTab.tsx
import { useState, useEffect, useCallback } from 'react';
// @ts-expect-error popups JS legados sem declaração TypeScript
import { mostrarMensagem, mostrarConfirmacao } from '/js/utils/popups.js';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import IncenGincanaCard from './IncenGincanaCard';
import IncenGincanaModal from './IncenGincanaModal';
import IncenGincanaRankingModal from './IncenGincanaRankingModal';
import type {
    Gincana,
    GincanaEditando,
    IncenGincanaFiltro,
} from '../utils/incentivos-types';

const FILTROS: Array<{ id: IncenGincanaFiltro; label: string; icon: string }> = [
    { id: 'ativas',    label: 'Ao Vivo',   icon: 'fas fa-circle' },
    { id: 'proximas',  label: 'Próximas',  icon: 'fas fa-clock' },
    { id: 'rascunhos', label: 'Rascunhos', icon: 'fas fa-pencil-alt' },
    { id: 'arquivo',   label: 'Arquivo',   icon: 'fas fa-archive' },
];

export interface IncenGincanasTabProps {
    modalNovaGincanaAberto?: boolean;
    onFecharModalNova?: () => void;
}

export default function IncenGincanasTab({ modalNovaGincanaAberto, onFecharModalNova }: IncenGincanasTabProps) {
    const [filtro, setFiltro] = useState<IncenGincanaFiltro>('ativas');
    const [gincanas, setGincanas] = useState<Gincana[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [contagens, setContagens] = useState<Partial<Record<IncenGincanaFiltro, number>>>({});

    // Modais
    const [gincanaEditando, setGincanaEditando] = useState<GincanaEditando | null>(null);
    const [gincanaRanking, setGincanaRanking] = useState<Gincana | null>(null);
    const [gincanaPublicando, setGincanaPublicando] = useState<Gincana | null>(null);

    const token = localStorage.getItem('token');

    const buscarGincanas = useCallback(async (filtroAtual: IncenGincanaFiltro) => {
        setCarregando(true);
        try {
            const res = await fetch(`/api/gincanas?filtro=${filtroAtual}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json() as Gincana[] | { error?: string };
            if (!res.ok) throw new Error((data as { error?: string }).error || 'Erro ao buscar gincanas');
            setGincanas(Array.isArray(data) ? data : []);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        } finally {
            setCarregando(false);
        }
    }, [token]);

    const buscarContagens = useCallback(async () => {
        const filtroIds: IncenGincanaFiltro[] = ['ativas', 'proximas', 'rascunhos'];
        try {
            const resultados = await Promise.all(
                filtroIds.map(f =>
                    fetch(`/api/gincanas?filtro=${f}`, { headers: { Authorization: `Bearer ${token}` } })
                        .then(r => r.json())
                        .then((d: unknown) => ({ [f]: Array.isArray(d) ? d.length : 0 } as Partial<Record<IncenGincanaFiltro, number>>))
                        .catch(() => ({ [f]: 0 } as Partial<Record<IncenGincanaFiltro, number>>))
                )
            );
            setContagens(Object.assign({}, ...resultados));
        } catch (_) { /* ignore */ }
    }, [token]);

    useEffect(() => {
        void buscarGincanas(filtro);
        void buscarContagens();
    }, [filtro]);

    // Abre modal de nova gincana via prop do pai
    useEffect(() => {
        if (modalNovaGincanaAberto) {
            setGincanaEditando({ _novo: true });
        }
    }, [modalNovaGincanaAberto]);

    // Fecha modal de nova gincana quando o componente de modal fechar
    const handleFecharModal = () => {
        setGincanaEditando(null);
        onFecharModalNova?.();
        void buscarGincanas(filtro);
        void buscarContagens();
    };

    const handlePublicar = (g: Gincana) => setGincanaPublicando(g);

    const handleCancelar = async (g: Gincana) => {
        const ok = await mostrarConfirmacao(
            `Cancelar a gincana "${g.nome}"? Esta ação não pode ser desfeita.`
        );
        if (!ok) return;
        try {
            const res = await fetch(`/api/gincanas/${g.id}/cancelar`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json() as { error?: string };
            if (!res.ok) throw new Error(data.error);
            mostrarMensagem('Gincana cancelada.', 'sucesso');
            void buscarGincanas(filtro);
            void buscarContagens();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        }
    };

    const handleDeletar = async (g: Gincana) => {
        const ok = await mostrarConfirmacao(
            `Deletar o rascunho "${g.nome}"? Não é possível desfazer.`
        );
        if (!ok) return;
        try {
            const res = await fetch(`/api/gincanas/${g.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json() as { error?: string };
            if (!res.ok) throw new Error(data.error);
            mostrarMensagem('Rascunho deletado.', 'sucesso');
            void buscarGincanas(filtro);
            void buscarContagens();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        }
    };

    const handleConfirmarPublicacao = async (g: Gincana, notificar: boolean) => {
        try {
            const res = await fetch(`/api/gincanas/${g.id}/publicar`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ notificar }),
            });
            const data = await res.json() as { error?: string };
            if (!res.ok) throw new Error(data.error);
            mostrarMensagem('Gincana publicada!', 'sucesso');
            setGincanaPublicando(null);
            void buscarGincanas(filtro);
            void buscarContagens();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro';
            mostrarMensagem(`Erro: ${msg}`, 'erro');
        }
    };

    return (
        <>
            <div className="gs-card">
                <div className="incen-subfiltros">
                    {FILTROS.map(f => (
                        <button
                            key={f.id}
                            className={`incen-subfiltro-btn ${filtro === f.id ? 'ativo' : ''}`}
                            onClick={() => setFiltro(f.id)}
                        >
                            <i className={f.icon}></i>
                            {f.label}
                            {(contagens[f.id] ?? 0) > 0 && (
                                <span className="incen-subfiltro-badge">{contagens[f.id]}</span>
                            )}
                        </button>
                    ))}
                </div>

                {carregando ? (
                    <UICarregando variante="bloco" />
                ) : gincanas.length === 0 ? (
                    <UIFeedbackNotFound
                        variante="compacto"
                        icon="fa-trophy"
                        titulo="Nenhuma gincana encontrada"
                        mensagem="Não há gincanas correspondentes ao filtro atual."
                    />
                ) : (
                    <div className="incen-gincana-grid">
                        {gincanas.map(g => (
                            <IncenGincanaCard
                                key={g.id}
                                gincana={g}
                                onEditar={setGincanaEditando}
                                onPublicar={handlePublicar}
                                onCancelar={(g) => void handleCancelar(g)}
                                onDeletar={(g) => void handleDeletar(g)}
                                onVerRanking={setGincanaRanking}
                            />
                        ))}
                    </div>
                )}
            </div>

            {gincanaEditando && (
                <IncenGincanaModal
                    gincana={gincanaEditando}
                    onFechar={handleFecharModal}
                    onSalvo={handleFecharModal}
                />
            )}

            {gincanaRanking && (
                <IncenGincanaRankingModal
                    gincana={gincanaRanking}
                    onFechar={() => setGincanaRanking(null)}
                />
            )}

            {/* Modal de confirmação de publicação */}
            {gincanaPublicando && (
                <ModalPublicacao
                    gincana={gincanaPublicando}
                    onFechar={() => setGincanaPublicando(null)}
                    onConfirmar={handleConfirmarPublicacao}
                />
            )}
        </>
    );
}

// Modal de confirmação de publicação
interface ModalPublicacaoProps {
    gincana: Gincana;
    onFechar: () => void;
    onConfirmar: (g: Gincana, notificar: boolean) => Promise<void>;
}

function ModalPublicacao({ gincana, onFechar, onConfirmar }: ModalPublicacaoProps) {
    const [notificar, setNotificar] = useState(true);
    const [salvando, setSalvando] = useState(false);

    const handleConfirmar = async () => {
        setSalvando(true);
        await onConfirmar(gincana, notificar);
        setSalvando(false);
    };

    const formatarDataHora = (iso: string | null | undefined) => {
        if (!iso) return '';
        return new Date(iso).toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            day: '2-digit', month: '2-digit',
            hour: '2-digit', minute: '2-digit',
        });
    };

    return (
        <div className="gs-modal-overlay" onClick={onFechar}>
            <div className="gs-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
                <div className="gs-modal-cabecalho">
                    <h2>Publicar Gincana</h2>
                    <button className="gs-btn-fechar" onClick={onFechar}><i className="fas fa-times"></i></button>
                </div>
                <div className="gs-modal-corpo">
                    <p style={{ fontWeight: 600, marginBottom: 4 }}>
                        {gincana.banner_emoji} {gincana.nome}
                    </p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--gs-texto-secundario)', marginBottom: 16 }}>
                        {formatarDataHora(gincana.datetime_inicio)} → {formatarDataHora(gincana.datetime_fim)}
                    </p>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.9rem' }}>
                        <input
                            type="checkbox"
                            checked={notificar}
                            onChange={e => setNotificar(e.target.checked)}
                            style={{ width: 16, height: 16 }}
                        />
                        Notificar participantes via popup ao publicar
                    </label>
                    <p style={{ fontSize: '0.78rem', color: 'var(--gs-texto-secundario)', marginTop: 4, paddingLeft: 26 }}>
                        Aparecerá na dashboard delas ao abrir.
                    </p>
                </div>
                <div className="gs-modal-rodape">
                    <button className="gs-btn gs-btn-secundario" onClick={onFechar} disabled={salvando}>
                        Cancelar
                    </button>
                    <button className="gs-btn gs-btn-primario" onClick={() => void handleConfirmar()} disabled={salvando}>
                        {salvando ? 'Publicando...' : <><i className="fas fa-play"></i> Publicar</>}
                    </button>
                </div>
            </div>
        </div>
    );
}
