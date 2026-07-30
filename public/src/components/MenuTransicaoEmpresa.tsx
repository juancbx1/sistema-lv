import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type {
  MenuEmpresa,
  MenuTransicaoEmpresaEstado,
} from '../utils/menu-types';
import { obterIniciais, obterNome } from './MenuEmpresaSeletor';

interface Props {
  transicao: MenuTransicaoEmpresaEstado | null;
}

function MarcaEmpresa({
  empresa,
  destino = false,
}: {
  empresa: MenuEmpresa;
  destino?: boolean;
}) {
  return (
    <div className={`ml-transition-company${destino ? ' is-destination' : ''}`}>
      <span
        className="ml-transition-company-brand"
        style={
          {
            '--ml-transition-company-color':
              empresa.cor_identificacao || '#2563eb',
          } as React.CSSProperties
        }
        aria-hidden="true"
      >
        {empresa.logo_url ? (
          <img src={empresa.logo_url} alt="" />
        ) : (
          obterIniciais(empresa)
        )}
      </span>
      <span className="ml-transition-company-copy">
        <small>{destino ? 'Novo ambiente' : 'Empresa atual'}</small>
        <strong>{obterNome(empresa)}</strong>
      </span>
      {destino && (
        <span className="ml-transition-ready" aria-hidden="true">
          <i className="fa-solid fa-check" />
        </span>
      )}
    </div>
  );
}

export default function MenuTransicaoEmpresa({ transicao }: Props) {
  const ativa = Boolean(transicao);

  useEffect(() => {
    document.getElementById('ml-transition-bootstrap-overlay')?.remove();
    document.documentElement.classList.toggle('ml-transition-bootstrap', ativa);
    return () => {
      if (ativa) document.documentElement.classList.remove('ml-transition-bootstrap');
    };
  }, [ativa]);

  if (!transicao) return null;

  const concluindo = transicao.fase === 'concluindo';
  const recarregando = transicao.fase === 'recarregando';
  const nomeDestino = obterNome(transicao.destino);

  return createPortal(
    <div
      className={`ml-transition-overlay is-${transicao.fase}`}
      role="status"
      aria-live="polite"
      aria-busy={!concluindo}
      aria-label={
        concluindo
          ? `Ambiente pronto. Você está em ${nomeDestino}.`
          : `Mudando para ${nomeDestino}.`
      }
    >
      <div className="ml-transition-ambient is-origin" aria-hidden="true" />
      <div className="ml-transition-ambient is-destination" aria-hidden="true" />

      <div className="ml-transition-content">
        <span className="ml-transition-kicker">
          <i
            className="fa-solid fa-building-circle-arrow-right"
            aria-hidden="true"
          />
          {concluindo ? 'Contexto atualizado' : 'Alterando contexto'}
        </span>

        <div className="ml-transition-route">
          <MarcaEmpresa empresa={transicao.origem} />
          <span className="ml-transition-stitch" aria-hidden="true">
            <svg viewBox="0 0 260 58" preserveAspectRatio="none">
              <path d="M8 29 C66 3 194 55 252 29" />
              <path className="is-thread" d="M8 29 C66 3 194 55 252 29" />
            </svg>
            <i className="fa-solid fa-arrow-right ml-transition-needle" />
          </span>
          <MarcaEmpresa empresa={transicao.destino} destino />
        </div>

        <div className="ml-transition-message">
          <strong>
            {concluindo
              ? 'Ambiente pronto'
              : recarregando
                ? 'Contexto atualizado'
                : `Mudando para ${nomeDestino}`}
          </strong>
          <span>
            {concluindo
              ? `Você está em ${nomeDestino}`
              : recarregando
                ? 'Abrindo o novo ambiente…'
                : 'Preparando dados, permissões e preferências…'}
          </span>
        </div>

        {!concluindo && (
          <span className="ml-transition-progress" aria-hidden="true">
            <span />
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
}
