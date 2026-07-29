import { useEffect, type ReactNode } from 'react';

interface FinanceiroModalShellProps {
  children: ReactNode;
  titulo: string;
  descricao: string;
  icone: string;
  onClose: () => void;
  formId?: string;
  textoAcao?: string;
  textoProcessando?: string;
  processando?: boolean;
  acaoDesabilitada?: boolean;
  erro?: string | null;
  tamanho?: 'md' | 'lg';
  somenteFechar?: boolean;
}

interface FinanceiroResumoOperacaoProps {
  children: ReactNode;
  titulo?: string;
  className?: string;
}

function lerEmpresaAtiva(): string {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      const empresa = JSON.parse(storage.getItem('empresaAtiva') || 'null') as {
        nome_fantasia?: string;
        razao_social?: string;
      } | null;
      const nome = empresa?.nome_fantasia || empresa?.razao_social;
      if (nome) return nome;
    } catch {
      // Contexto inválido será substituído na próxima autenticação.
    }
  }
  return 'Empresa ativa';
}

export function FinanceiroModalHeader({
  titulo,
  descricao,
  icone,
  onClose,
}: Pick<FinanceiroModalShellProps, 'titulo' | 'descricao' | 'icone' | 'onClose'>) {
  return (
    <header className="fc-modal-shell__header">
      <div className="fc-modal-shell__icon" aria-hidden="true">
        <i className={`fas ${icone}`} />
      </div>
      <div className="fc-modal-shell__heading">
        <span className="fc-modal-shell__eyebrow">
          <i className="fas fa-building" aria-hidden="true" />
          {lerEmpresaAtiva()}
        </span>
        <h2 id="fc-modal-shell-title">{titulo}</h2>
        <p>{descricao}</p>
      </div>
      <button
        type="button"
        className="fc-modal-shell__close"
        onClick={onClose}
        aria-label={`Fechar ${titulo}`}
      >
        <i className="fas fa-times" aria-hidden="true" />
      </button>
    </header>
  );
}

export function FinanceiroModalFooter({
  onClose,
  formId,
  textoAcao = 'Confirmar',
  textoProcessando = 'Salvando...',
  processando = false,
  acaoDesabilitada = false,
  somenteFechar = false,
}: Pick<
  FinanceiroModalShellProps,
  'onClose' | 'formId' | 'textoAcao' | 'textoProcessando' | 'processando' | 'acaoDesabilitada' | 'somenteFechar'
>) {
  return (
    <footer className="fc-modal-shell__footer">
      <button
        type="button"
        className="fc-btn fc-btn-secundario"
        onClick={onClose}
        disabled={processando}
      >
        {somenteFechar ? 'Fechar' : 'Cancelar'}
      </button>
      {!somenteFechar && (
        <button
          type="submit"
          form={formId}
          className="fc-btn fc-btn-primario"
          disabled={processando || acaoDesabilitada}
        >
          {processando ? (
            <>
              <i className="fas fa-circle-notch fa-spin" aria-hidden="true" />
              {textoProcessando}
            </>
          ) : (
            <>
              <i className="fas fa-check" aria-hidden="true" />
              {textoAcao}
            </>
          )}
        </button>
      )}
    </footer>
  );
}

export function FinanceiroResumoOperacao({
  children,
  titulo = 'Resumo da operação',
  className = '',
}: FinanceiroResumoOperacaoProps) {
  return (
    <aside className={`fc-modal-resumo ${className}`.trim()} aria-label={titulo}>
      <span className="fc-modal-resumo__titulo">{titulo}</span>
      {children}
    </aside>
  );
}

export default function FinanceiroModalShell({
  children,
  titulo,
  descricao,
  icone,
  onClose,
  formId,
  textoAcao,
  textoProcessando,
  processando,
  acaoDesabilitada,
  erro,
  tamanho = 'md',
  somenteFechar = false,
}: FinanceiroModalShellProps) {
  useEffect(() => {
    const overflowAnterior = document.body.style.overflow;
    const fecharComEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !processando) onClose();
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', fecharComEscape);
    return () => {
      document.body.style.overflow = overflowAnterior;
      document.removeEventListener('keydown', fecharComEscape);
    };
  }, [onClose, processando]);

  return (
    <div
      className="fc-modal fc-modal--aberto"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !processando) onClose();
      }}
    >
      <section
        className={`fc-modal-shell fc-modal-shell--${tamanho}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fc-modal-shell-title"
      >
        <FinanceiroModalHeader
          titulo={titulo}
          descricao={descricao}
          icone={icone}
          onClose={onClose}
        />
        {erro && (
          <div className="fc-modal-shell__erro" role="alert">
            <i className="fas fa-circle-exclamation" aria-hidden="true" />
            <span>{erro}</span>
          </div>
        )}
        <div className="fc-modal-shell__body">{children}</div>
        <FinanceiroModalFooter
          onClose={onClose}
          formId={formId}
          textoAcao={textoAcao}
          textoProcessando={textoProcessando}
          processando={processando}
          acaoDesabilitada={acaoDesabilitada}
          somenteFechar={somenteFechar}
        />
      </section>
    </div>
  );
}
