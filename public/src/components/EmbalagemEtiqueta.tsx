import { useEffect, useRef, useState } from 'react';
import UICarregando from './UICarregando';
import type { EtiquetaImpressao } from '../utils/etiqueta-embalagem';
import {
  AgenteIndisponivelError,
  listarImpressorasAgente,
  previewEtiqueta,
  selecionarImpressoraAgente,
} from '../utils/printnow-agente';

interface EmbalagemPreviewEtiquetaProps {
  etiqueta: EtiquetaImpressao | null;
}

export function EmbalagemPreviewEtiqueta({ etiqueta }: EmbalagemPreviewEtiquetaProps) {
  const [imagem, setImagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const assinatura = etiqueta
    ? [etiqueta.sku, etiqueta.variante, etiqueta.codigo_barras, etiqueta.qtd_pacote, etiqueta.fabricacao, etiqueta.cnpj].join('|')
    : '';

  useEffect(() => {
    if (!etiqueta) {
      setImagem(null);
      setErro(null);
      return;
    }

    let ativo = true;
    setCarregando(true);
    setImagem(null);
    setErro(null);
    const timer = window.setTimeout(() => {
      void previewEtiqueta(etiqueta)
        .then((preview) => {
          if (!ativo) return;
          setImagem(preview);
          setErro(null);
        })
        .catch((error: unknown) => {
          if (!ativo) return;
          setImagem(null);
          setErro(error instanceof Error ? error.message : 'Não foi possível montar a etiqueta.');
        })
        .finally(() => {
          if (ativo) setCarregando(false);
        });
    }, 200);

    return () => {
      ativo = false;
      window.clearTimeout(timer);
    };
  }, [assinatura]);

  if (!etiqueta) return null;

  return (
    <div className="ep-etiqueta">
      {carregando ? <UICarregando variante="bloco" tamanho="sm" /> : null}
      {!carregando && imagem ? (
        <img src={imagem} alt={`Etiqueta de ${etiqueta.variante}, SKU ${etiqueta.sku}`} />
      ) : null}
      {!carregando && erro ? (
        <p className="ep-etiqueta-erro" role="status">{erro}</p>
      ) : null}
      {!carregando && !etiqueta.codigo_barras ? (
        <p className="ep-etiqueta-aviso">Código de barras será o SKU.</p>
      ) : null}
      {!carregando && !etiqueta.cnpj ? (
        <p className="ep-etiqueta-aviso">Empresa sem CNPJ na etiqueta.</p>
      ) : null}
    </div>
  );
}

export function EmbalagemImpressora() {
  const raiz = useRef<HTMLDivElement>(null);
  const [impressoras, setImpressoras] = useState<string[]>([]);
  const [selecionada, setSelecionada] = useState('');
  const [aberta, setAberta] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let ativo = true;
    void listarImpressorasAgente()
      .then((lista) => {
        if (!ativo) return;
        setImpressoras(lista.impressoras);
        setSelecionada(lista.selecionada);
        setErro(null);
      })
      .catch((error: unknown) => {
        if (!ativo) return;
        setErro(error instanceof AgenteIndisponivelError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Não foi possível listar as impressoras.');
      });
    return () => {
      ativo = false;
    };
  }, []);

  useEffect(() => {
    if (!aberta) return;

    const fecharAoClicarFora = (event: MouseEvent) => {
      if (!raiz.current?.contains(event.target as Node)) setAberta(false);
    };
    const fecharComEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setAberta(false);
    };

    document.addEventListener('mousedown', fecharAoClicarFora);
    document.addEventListener('keydown', fecharComEscape, true);
    return () => {
      document.removeEventListener('mousedown', fecharAoClicarFora);
      document.removeEventListener('keydown', fecharComEscape, true);
    };
  }, [aberta]);

  const escolher = (nome: string) => {
    setSelecionada(nome);
    setAberta(false);
    setSalvando(true);
    setErro(null);
    void selecionarImpressoraAgente(nome)
      .catch((error: unknown) => {
        setErro(error instanceof Error ? error.message : 'Não foi possível salvar a impressora.');
      })
      .finally(() => setSalvando(false));
  };

  const rotulo = selecionada || (impressoras.length === 0 ? 'PrintNow fechado' : 'Escolher');

  return (
    <div className="ep-impressora" ref={raiz}>
      <span className="ep-impressora-rotulo">Impressora</span>
      <button
        className="ep-impressora-atual"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={aberta}
        disabled={salvando || impressoras.length === 0}
        onClick={() => setAberta((atual) => !atual)}
      >
        <i className="fas fa-print" aria-hidden="true" />
        <strong>{rotulo}</strong>
        <i className={`fas fa-chevron-${aberta ? 'up' : 'down'}`} aria-hidden="true" />
      </button>
      {aberta ? (
        <ul className="ep-impressora-lista" role="listbox" aria-label="Impressoras deste computador">
          {impressoras.map((nome) => (
            <li key={nome}>
              <button
                type="button"
                role="option"
                aria-selected={nome === selecionada}
                onClick={() => escolher(nome)}
              >
                {nome === selecionada ? <i className="fas fa-check" aria-hidden="true" /> : null}
                {nome}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {erro ? <small>{erro}</small> : null}
    </div>
  );
}
