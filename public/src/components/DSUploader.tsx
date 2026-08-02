// public/src/components/DSUploader.tsx
import { useRef, type ChangeEvent } from 'react';
import imgDefaultAvatar from '../assets/default-avatar.png';

const isMobile = (): boolean => typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;

export type DSUploaderVariant = 'dropzone' | 'avatar' | 'inline';

export interface DSUploaderArquivo {
    id: string | number;
    url_blob?: string | null;
    url?: string | null;
    ativo?: boolean | null;
}

export interface DSUploaderProps {
    variant?: DSUploaderVariant;
    maxFiles?: number;
    maxSizeMB?: number;
    accept?: string;
    /** Array de objetos { id, url_blob, url, ativo } */
    value?: DSUploaderArquivo[];
    /** Callback com array atualizado (para dropzone) */
    onChange?: (value: DSUploaderArquivo[]) => void;
    /** async fn(file) → void — chamada ao selecionar arquivo */
    onUpload?: (file: File) => void | Promise<void>;
    /** fn(id) — chamada ao clicar no × */
    onRemove?: (id: string | number) => void;
    /** fn(id) — chamada ao clicar numa thumb */
    onSelect?: (id: string | number) => void;
    label?: string;
    hint?: string;
    chips?: string[];
    nomeUsuario?: string;
    uploading?: boolean;
    uploadProgress?: number;
}

export default function DSUploader({
    variant = 'dropzone',
    maxFiles = 3,
    maxSizeMB = 5,
    accept = 'image/*',
    value = [],
    onUpload,
    onRemove,
    onSelect,
    label = 'Adicionar foto',
    hint,
    chips = [],
    nomeUsuario,
    uploading = false,
    uploadProgress = 0,
}: DSUploaderProps) {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (maxSizeMB && file.size > maxSizeMB * 1024 * 1024) {
            alert(`Arquivo muito grande. Máximo: ${maxSizeMB} MB.`);
            e.target.value = '';
            return;
        }
        if (onUpload) await onUpload(file);
        e.target.value = '';
    };

    const openPicker = () => inputRef.current?.click();

    // ── Variante: dropzone ──────────────────────────────────────────────────
    if (variant === 'dropzone') {
        const hintTexto = hint || (isMobile()
            ? 'Toque para escolher da galeria ou câmera'
            : 'ou clique para selecionar do seu computador');

        return (
            <div>
                {label && <div className="dsu-secao-titulo">{label}</div>}

                {value.length > 0 && (
                    <div className="dsu-thumbs">
                        {value.map((av) => (
                            <div
                                key={av.id}
                                className={`dsu-thumb${av.ativo ? ' ativo' : ''}`}
                                onClick={() => onSelect && onSelect(av.id)}
                                title={av.ativo ? 'Foto atual' : 'Definir como foto de perfil'}
                            >
                                <img src={av.url_blob || av.url || ''} alt="" />
                                {onRemove && (
                                    <button
                                        type="button"
                                        className="dsu-thumb-remove"
                                        onClick={(e) => { e.stopPropagation(); onRemove(av.id); }}
                                        title="Remover"
                                    >
                                        <i className="fas fa-times" />
                                    </button>
                                )}
                            </div>
                        ))}

                        {value.length < maxFiles && (
                            <button type="button" className="dsu-add-thumb" onClick={openPicker} title="Adicionar foto">
                                <i className="fas fa-plus" />
                            </button>
                        )}
                    </div>
                )}

                {value.length === 0 && (
                    <div className="dsu-dropzone" onClick={openPicker}>
                        <div className="dsu-icon"><i className="fas fa-image" /></div>
                        <div className="dsu-label">{label}</div>
                        <div className="dsu-hint">{hintTexto}</div>
                        {chips.length > 0 && (
                            <div className="dsu-chips">
                                {chips.map((c, i) => <span key={i} className="dsu-chip">{c}</span>)}
                            </div>
                        )}
                    </div>
                )}

                {uploading && (
                    <div className="dsu-progress">
                        <div className="dsu-progress-fill" style={{ width: `${uploadProgress}%` }} />
                    </div>
                )}

                <input
                    ref={inputRef}
                    type="file"
                    accept={accept}
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                />
            </div>
        );
    }

    // ── Variante: avatar ────────────────────────────────────────────────────
    if (variant === 'avatar') {
        const avatarAtivo = value.find((v) => v.ativo);
        const avatarUrl = avatarAtivo?.url_blob || avatarAtivo?.url || imgDefaultAvatar;

        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                    <img
                        src={avatarUrl}
                        alt="Avatar"
                        style={{
                            width: 72, height: 72, borderRadius: '50%',
                            objectFit: 'cover', border: '3px solid var(--ds-cor-cinza-borda)',
                        }}
                    />
                    <button
                        type="button"
                        onClick={openPicker}
                        style={{
                            position: 'absolute', bottom: 0, right: 0,
                            width: 26, height: 26, borderRadius: '50%',
                            background: 'var(--ds-cor-primaria)', border: '2px solid #fff',
                            color: '#fff', fontSize: '0.7rem', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                        title="Trocar foto"
                    >
                        <i className="fas fa-camera" />
                    </button>
                </div>
                <div>
                    {nomeUsuario && (
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 4 }}>
                            {nomeUsuario}
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={openPicker}
                        style={{
                            background: 'none', border: '1.5px solid var(--ds-cor-primaria)',
                            color: 'var(--ds-cor-primaria)', borderRadius: 8,
                            padding: '5px 12px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                        }}
                    >
                        {value.length > 0 ? 'Trocar foto' : 'Escolher foto'}
                    </button>
                </div>
                <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }} onChange={handleFileChange} />
            </div>
        );
    }

    // ── Variante: inline ────────────────────────────────────────────────────
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="fas fa-paperclip" style={{ color: 'var(--ds-cor-cinza-texto-secundario)' }} />
            <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--ds-cor-cinza-texto-secundario)' }}>
                {label}
            </span>
            <button
                type="button"
                onClick={openPicker}
                style={{
                    background: 'var(--ds-cor-cinza-claro-fundo)',
                    border: '1px solid var(--ds-cor-cinza-borda)',
                    borderRadius: 8, padding: '6px 12px',
                    fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600,
                }}
            >
                Selecionar
            </button>
            <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }} onChange={handleFileChange} />
        </div>
    );
}
