import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import useDialogFocus from '../hooks/useDialogFocus';
import '../../css/perfil-avatar-studio.css';
import UICarregando from './UICarregando';

interface Avatar {
  id: number;
  url_blob: string;
  ativo: boolean;
}

interface Props {
  isOpen: boolean;
  token: string | null;
  nomeUsuario: string;
  onClose: () => void;
  onAvatarChanged?: (url: string | null) => void;
}

interface Offset {
  x: number;
  y: number;
}

const TAMANHO_SAIDA = 800;
const MAX_ARQUIVO_MB = 8;
const MIN_DIMENSAO = 256;

function obterIniciais(nome: string) {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join('')
    .toUpperCase();
}

function limitesOffset(
  imagem: HTMLImageElement,
  zoom: number,
  rotacao: number,
) {
  const trocado = Math.abs(rotacao % 180) === 90;
  const larguraEfetiva = trocado ? imagem.naturalHeight : imagem.naturalWidth;
  const alturaEfetiva = trocado ? imagem.naturalWidth : imagem.naturalHeight;
  const escalaBase = Math.max(
    TAMANHO_SAIDA / larguraEfetiva,
    TAMANHO_SAIDA / alturaEfetiva,
  );
  const escala = escalaBase * zoom;
  return {
    x: Math.max(0, (larguraEfetiva * escala - TAMANHO_SAIDA) / 2),
    y: Math.max(0, (alturaEfetiva * escala - TAMANHO_SAIDA) / 2),
  };
}

function desenharRecorte(
  canvas: HTMLCanvasElement,
  imagem: HTMLImageElement,
  zoom: number,
  rotacao: number,
  offset: Offset,
) {
  const contexto = canvas.getContext('2d');
  if (!contexto) return;
  canvas.width = TAMANHO_SAIDA;
  canvas.height = TAMANHO_SAIDA;
  contexto.clearRect(0, 0, TAMANHO_SAIDA, TAMANHO_SAIDA);
  contexto.fillStyle = '#ffffff';
  contexto.fillRect(0, 0, TAMANHO_SAIDA, TAMANHO_SAIDA);

  const trocado = Math.abs(rotacao % 180) === 90;
  const larguraEfetiva = trocado ? imagem.naturalHeight : imagem.naturalWidth;
  const alturaEfetiva = trocado ? imagem.naturalWidth : imagem.naturalHeight;
  const escalaBase = Math.max(
    TAMANHO_SAIDA / larguraEfetiva,
    TAMANHO_SAIDA / alturaEfetiva,
  );
  const escala = escalaBase * zoom;

  contexto.save();
  contexto.translate(
    TAMANHO_SAIDA / 2 + offset.x,
    TAMANHO_SAIDA / 2 + offset.y,
  );
  contexto.rotate((rotacao * Math.PI) / 180);
  contexto.drawImage(
    imagem,
    (-imagem.naturalWidth * escala) / 2,
    (-imagem.naturalHeight * escala) / 2,
    imagem.naturalWidth * escala,
    imagem.naturalHeight * escala,
  );
  contexto.restore();
}

async function canvasParaArquivo(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (resultado) =>
        resultado ? resolve(resultado) : reject(new Error('Falha ao preparar a imagem.')),
      'image/jpeg',
      0.9,
    );
  });
  return new File([blob], `avatar-${Date.now()}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

export default function PerfilAvatarStudio({
  isOpen,
  token,
  nomeUsuario,
  onClose,
  onAvatarChanged,
}: Props) {
  const dialogRef = useDialogFocus(isOpen, onClose);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagemRef = useRef<HTMLImageElement | null>(null);
  const urlObjetoRef = useRef<string | null>(null);
  const arrasteRef = useRef<{ x: number; y: number; offset: Offset } | null>(null);

  const [avatares, setAvatares] = useState<Avatar[]>([]);
  const [carregandoGaleria, setCarregandoGaleria] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotacao, setRotacao] = useState(0);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [confirmarExclusao, setConfirmarExclusao] = useState<number | null>(null);
  const [arrastandoArquivo, setArrastandoArquivo] = useState(false);

  const avatarAtivo = avatares.find((avatar) => avatar.ativo);
  const iniciais = useMemo(() => obterIniciais(nomeUsuario), [nomeUsuario]);

  const authHeaders = useMemo(
    () => ({ Authorization: `Bearer ${token || ''}` }),
    [token],
  );

  const carregarGaleria = useCallback(async () => {
    if (!token) return;
    setCarregandoGaleria(true);
    setErro(null);
    try {
      const response = await fetch('/api/avatares', { headers: authHeaders });
      const dados = await response.json().catch(() => []);
      if (!response.ok) throw new Error(dados.error || 'Falha ao carregar suas fotos.');
      setAvatares(Array.isArray(dados) ? dados : []);
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Falha ao carregar suas fotos.');
    } finally {
      setCarregandoGaleria(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    if (!isOpen) return;
    void carregarGaleria();
    setErro(null);
    setMensagem(null);
    setConfirmarExclusao(null);
  }, [carregarGaleria, isOpen]);

  useEffect(
    () => () => {
      if (urlObjetoRef.current) URL.revokeObjectURL(urlObjetoRef.current);
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const imagem = imagemRef.current;
    if (!canvas || !imagem) return;
    const limites = limitesOffset(imagem, zoom, rotacao);
    const ajustado = {
      x: Math.max(-limites.x, Math.min(limites.x, offset.x)),
      y: Math.max(-limites.y, Math.min(limites.y, offset.y)),
    };
    if (ajustado.x !== offset.x || ajustado.y !== offset.y) {
      setOffset(ajustado);
      return;
    }
    desenharRecorte(canvas, imagem, zoom, rotacao, ajustado);
    setPreviewUrl(canvas.toDataURL('image/jpeg', 0.78));
  }, [arquivo, offset, rotacao, zoom]);

  const limparEdicao = useCallback(() => {
    if (urlObjetoRef.current) {
      URL.revokeObjectURL(urlObjetoRef.current);
      urlObjetoRef.current = null;
    }
    imagemRef.current = null;
    setArquivo(null);
    setZoom(1);
    setRotacao(0);
    setOffset({ x: 0, y: 0 });
    setPreviewUrl(null);
  }, []);

  const prepararArquivo = useCallback(
    async (novoArquivo?: File) => {
      if (!novoArquivo) return;
      setErro(null);
      setMensagem(null);
      if (!novoArquivo.type.startsWith('image/')) {
        setErro('Escolha um arquivo de imagem JPG, PNG ou WEBP.');
        return;
      }
      if (novoArquivo.size > MAX_ARQUIVO_MB * 1024 * 1024) {
        setErro(`A imagem deve ter no máximo ${MAX_ARQUIVO_MB} MB.`);
        return;
      }

      if (urlObjetoRef.current) URL.revokeObjectURL(urlObjetoRef.current);
      const url = URL.createObjectURL(novoArquivo);
      urlObjetoRef.current = url;
      const imagem = new Image();
      imagem.onload = () => {
        if (
          imagem.naturalWidth < MIN_DIMENSAO ||
          imagem.naturalHeight < MIN_DIMENSAO
        ) {
          URL.revokeObjectURL(url);
          urlObjetoRef.current = null;
          setErro(`Use uma imagem com pelo menos ${MIN_DIMENSAO} × ${MIN_DIMENSAO} px.`);
          return;
        }
        imagemRef.current = imagem;
        setZoom(1);
        setRotacao(0);
        setOffset({ x: 0, y: 0 });
        setArquivo(novoArquivo);
      };
      imagem.onerror = () => {
        URL.revokeObjectURL(url);
        urlObjetoRef.current = null;
        setErro('Não foi possível abrir esta imagem.');
      };
      imagem.src = url;
    },
    [],
  );

  const salvarNovaFoto = async () => {
    if (!canvasRef.current || !arquivo || !token) return;
    setProcessando(true);
    setErro(null);
    setMensagem(null);
    setProgresso(15);
    try {
      const arquivoFinal = await canvasParaArquivo(canvasRef.current);
      setProgresso(45);
      const formData = new FormData();
      formData.append('foto', arquivoFinal);
      const uploadResponse = await fetch('/api/avatares/upload', {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });
      const novoAvatar = await uploadResponse.json().catch(() => ({}));
      if (!uploadResponse.ok) {
        throw new Error(novoAvatar.error || 'Não foi possível enviar a foto.');
      }
      setProgresso(78);
      const ativarResponse = await fetch(
        `/api/avatares/definir-ativo/${novoAvatar.id}`,
        { method: 'PUT', headers: authHeaders },
      );
      const ativado = await ativarResponse.json().catch(() => ({}));
      if (!ativarResponse.ok) {
        throw new Error(ativado.error || 'A foto foi enviada, mas não pôde ser ativada.');
      }
      setProgresso(100);
      onAvatarChanged?.(ativado.newAvatarUrl || novoAvatar.url_blob);
      await carregarGaleria();
      limparEdicao();
      setMensagem('Foto de perfil atualizada com sucesso.');
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Erro ao salvar a foto.');
    } finally {
      setProcessando(false);
      setTimeout(() => setProgresso(0), 400);
    }
  };

  const definirAtivo = async (avatar: Avatar) => {
    if (avatar.ativo || !token || processando) return;
    setProcessando(true);
    setErro(null);
    try {
      const response = await fetch(`/api/avatares/definir-ativo/${avatar.id}`, {
        method: 'PUT',
        headers: authHeaders,
      });
      const dados = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(dados.error || 'Não foi possível ativar a foto.');
      onAvatarChanged?.(dados.newAvatarUrl || avatar.url_blob);
      await carregarGaleria();
      setMensagem('Foto atualizada.');
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Erro ao ativar a foto.');
    } finally {
      setProcessando(false);
    }
  };

  const excluirAvatar = async (avatarId: number) => {
    if (!token || processando) return;
    setProcessando(true);
    setErro(null);
    try {
      const response = await fetch(`/api/avatares/${avatarId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const dados = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(dados.error || 'Não foi possível excluir a foto.');
      await carregarGaleria();
      if (dados.avatarUrlCleared) onAvatarChanged?.(null);
      setMensagem('Foto excluída.');
      setConfirmarExclusao(null);
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Erro ao excluir a foto.');
    } finally {
      setProcessando(false);
    }
  };

  const iniciarArraste = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!imagemRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    arrasteRef.current = {
      x: event.clientX,
      y: event.clientY,
      offset,
    };
  };

  const moverRecorte = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const inicio = arrasteRef.current;
    if (!inicio || !canvasRef.current || !imagemRef.current) return;
    const escalaTela = TAMANHO_SAIDA / canvasRef.current.getBoundingClientRect().width;
    const limites = limitesOffset(imagemRef.current, zoom, rotacao);
    const proximo = {
      x: inicio.offset.x + (event.clientX - inicio.x) * escalaTela,
      y: inicio.offset.y + (event.clientY - inicio.y) * escalaTela,
    };
    setOffset({
      x: Math.max(-limites.x, Math.min(limites.x, proximo.x)),
      y: Math.max(-limites.y, Math.min(limites.y, proximo.y)),
    });
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="perfil-avatar-overlay"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !processando) onClose();
      }}
    >
      <section
        ref={dialogRef as React.RefObject<HTMLElement>}
        className="perfil-avatar-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="perfil-avatar-title"
      >
        <header className="perfil-avatar-header">
          <div>
            <span>Perfil pessoal</span>
            <h2 id="perfil-avatar-title">Sua foto de perfil</h2>
            <p>Ajuste como sua foto aparecerá em todo o sistema.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={processando}
            aria-label="Fechar estúdio de avatar"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className="perfil-avatar-body">
          {erro && (
            <div className="perfil-avatar-feedback is-error" role="alert">
              <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
              {erro}
            </div>
          )}
          {mensagem && (
            <div className="perfil-avatar-feedback is-success" role="status">
              <i className="fa-solid fa-circle-check" aria-hidden="true" />
              {mensagem}
            </div>
          )}

          {arquivo ? (
            <div className="perfil-avatar-editor">
              <div className="perfil-avatar-crop-column">
                <div className="perfil-avatar-canvas-wrap">
                  <canvas
                    ref={canvasRef}
                    onPointerDown={iniciarArraste}
                    onPointerMove={moverRecorte}
                    onPointerUp={() => {
                      arrasteRef.current = null;
                    }}
                    onPointerCancel={() => {
                      arrasteRef.current = null;
                    }}
                    aria-label="Arraste a imagem para ajustar o recorte"
                  />
                  <span className="perfil-avatar-mask" aria-hidden="true" />
                  <span className="perfil-avatar-drag-hint">
                    <i className="fa-solid fa-arrows-up-down-left-right" aria-hidden="true" />
                    Arraste para reposicionar
                  </span>
                </div>
              </div>

              <aside className="perfil-avatar-preview-column">
                <strong>Prévia real</strong>
                <div className="perfil-avatar-previews">
                  {[88, 52, 32].map((tamanho) => (
                    <span
                      className="perfil-avatar-preview"
                      style={{ width: tamanho, height: tamanho }}
                      key={tamanho}
                    >
                      {previewUrl ? <img src={previewUrl} alt="" /> : iniciais}
                    </span>
                  ))}
                </div>
                <small>Menu, cards e ranking</small>
              </aside>

              <div className="perfil-avatar-controls">
                <label htmlFor="perfil-avatar-zoom">
                  <span>Zoom</span>
                  <output>{Math.round(zoom * 100)}%</output>
                </label>
                <input
                  id="perfil-avatar-zoom"
                  type="range"
                  min="1"
                  max="3"
                  step="0.01"
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
                <div className="perfil-avatar-editor-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setRotacao((valor) => (valor - 90) % 360);
                      setOffset({ x: 0, y: 0 });
                    }}
                  >
                    <i className="fa-solid fa-rotate-left" aria-hidden="true" />
                    Girar
                  </button>
                  <button type="button" onClick={() => inputRef.current?.click()}>
                    <i className="fa-regular fa-image" aria-hidden="true" />
                    Escolher outra
                  </button>
                  <button type="button" onClick={() => cameraInputRef.current?.click()}>
                    <i className="fa-solid fa-camera" aria-hidden="true" />
                    Usar câmera
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              className={`perfil-avatar-dropzone${arrastandoArquivo ? ' is-dragging' : ''}`}
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event: DragEvent<HTMLButtonElement>) => {
                event.preventDefault();
                setArrastandoArquivo(true);
              }}
              onDragOver={(event: DragEvent<HTMLButtonElement>) => event.preventDefault()}
              onDragLeave={() => setArrastandoArquivo(false)}
              onDrop={(event: DragEvent<HTMLButtonElement>) => {
                event.preventDefault();
                setArrastandoArquivo(false);
                void prepararArquivo(event.dataTransfer.files[0]);
              }}
            >
              <span><i className="fa-regular fa-images" aria-hidden="true" /></span>
              <strong>Escolha uma nova foto</strong>
              <small>Toque para abrir a galeria ou arraste uma imagem</small>
              <span className="perfil-avatar-chips">
                <em>JPG, PNG ou WEBP</em>
                <em>Máx. {MAX_ARQUIVO_MB} MB</em>
                <em>Até 3 fotos</em>
              </span>
            </button>
          )}

          <section className="perfil-avatar-gallery" aria-labelledby="perfil-gallery-title">
            <header>
              <div>
                <h3 id="perfil-gallery-title">Suas fotos</h3>
                <p>Selecione qual deve aparecer no sistema.</p>
              </div>
              <span>{avatares.length}/3</span>
            </header>

            {carregandoGaleria ? (
              <div className="perfil-avatar-loading" aria-label="Carregando fotos">
                <UICarregando variante="inline" />
              </div>
            ) : (
              <div className="perfil-avatar-thumbs">
                {avatares.map((avatar) => (
                  <div
                    className={`perfil-avatar-thumb${avatar.ativo ? ' is-active' : ''}`}
                    key={avatar.id}
                  >
                    <button
                      type="button"
                      onClick={() => void definirAtivo(avatar)}
                      disabled={processando}
                      aria-label={
                        avatar.ativo
                          ? 'Foto de perfil atual'
                          : 'Definir como foto de perfil'
                      }
                      aria-pressed={avatar.ativo}
                    >
                      <img src={avatar.url_blob} alt="" />
                      {avatar.ativo && (
                        <span>
                          <i className="fa-solid fa-check" aria-hidden="true" />
                          Atual
                        </span>
                      )}
                    </button>
                    <button
                      className="perfil-avatar-delete"
                      type="button"
                      onClick={() => setConfirmarExclusao(avatar.id)}
                      disabled={processando}
                      aria-label="Excluir foto"
                    >
                      <i className="fa-solid fa-trash" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                {avatares.length < 3 && (
                  <button
                    className="perfil-avatar-add"
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={processando}
                  >
                    <i className="fa-solid fa-plus" aria-hidden="true" />
                    <span>Adicionar</span>
                  </button>
                )}
              </div>
            )}
          </section>

          {confirmarExclusao && (
            <div className="perfil-avatar-delete-confirm" role="alert">
              <span>
                <strong>Excluir esta foto?</strong>
                Esta ação é permanente.
              </span>
              <button type="button" onClick={() => setConfirmarExclusao(null)}>
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void excluirAvatar(confirmarExclusao)}
              >
                Excluir
              </button>
            </div>
          )}

          {progresso > 0 && (
            <div
              className="perfil-avatar-progress"
              role="progressbar"
              aria-label="Salvando foto"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progresso}
            >
              <span style={{ width: `${progresso}%` }} />
            </div>
          )}
        </div>

        <footer className="perfil-avatar-footer">
          <button type="button" onClick={onClose} disabled={processando}>
            Fechar
          </button>
          {arquivo && (
            <button
              className="is-primary"
              type="button"
              onClick={() => void salvarNovaFoto()}
              disabled={processando}
            >
              {processando ? (
                <>
                  <UICarregando variante="inline" />
                  Preparando...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-check" aria-hidden="true" />
                  Salvar como foto atual
                </>
              )}
            </button>
          )}
        </footer>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(event) => {
            void prepararArquivo(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="user"
          hidden
          onChange={(event) => {
            void prepararArquivo(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
      </section>
    </div>,
    document.body,
  );
}
