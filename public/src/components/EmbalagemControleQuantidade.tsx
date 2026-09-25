import type { ChangeEvent, KeyboardEvent } from 'react';

interface EmbalagemControleQuantidadeProps {
  value: number | null;
  max: number;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  id?: string;
  autoFocus?: boolean;
  label?: string;
  badgeTexto?: string;
}

function limitarQuantidade(value: number | null, max: number): number {
  const limite = Math.max(0, Math.floor(max));
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.min(limite, Math.max(0, Math.floor(value)));
}

export default function EmbalagemControleQuantidade({
  value,
  max,
  onChange,
  disabled = false,
  id = 'ep-quantidade-embalar',
  autoFocus = false,
  label = 'Quantidade a embalar',
  badgeTexto,
}: EmbalagemControleQuantidadeProps) {
  const limite = Math.max(0, Math.floor(max));
  const quantidade = limitarQuantidade(value, limite);
  const restante = Math.max(0, limite - quantidade);
  const progresso = limite > 0 ? Math.min(100, (quantidade / limite) * 100) : 0;
  const semSaldo = limite <= 0;
  const textoBadge = badgeTexto ?? `${limite} ${limite === 1 ? 'un. disponível' : 'un. disponíveis'}`;

  const atualizar = (nextValue: number) => {
    onChange(limitarQuantidade(nextValue, limite));
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const valorDigitado = event.target.value;
    if (valorDigitado === '') {
      onChange(null);
      return;
    }
    atualizar(Number(valorDigitado));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 't' || event.key === 'T') {
      event.preventDefault();
      atualizar(limite);
    }
  };

  return (
    <div className="ep-controle-quantidade">
      <div className="ep-controle-quantidade-topo">
        <div className="ep-controle-quantidade-titulo">
          <label htmlFor={id}>
            <span>{label}</span>
          </label>
          <span className="ep-controle-badge-disponivel">
            {textoBadge}
          </span>
        </div>

        {/* Stepper e Atalhos rápidos */}
        <div className="ep-controle-quantidade-linha-acoes">
          {/* Stepper com Input Central */}
          <div className="ep-stepper-grupo">
            <button
              className="ep-stepper-btn ep-stepper-btn--menos"
              type="button"
              title="Diminuir 1"
              aria-label="Diminuir 1"
              onClick={() => atualizar(quantidade - 1)}
              disabled={disabled || semSaldo || quantidade <= 0}
            >
              <i className="fas fa-minus" aria-hidden="true" />
            </button>

            <div className="ep-stepper-campo">
              <input
                id={id}
                type="number"
                min="0"
                max={limite}
                value={value === null ? '' : quantidade}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                inputMode="numeric"
                disabled={disabled || semSaldo}
                autoFocus={autoFocus}
              />
              <span className="ep-stepper-unidade">un.</span>
            </div>

            <button
              className="ep-stepper-btn ep-stepper-btn--mais"
              type="button"
              title="Aumentar 1"
              aria-label="Aumentar 1"
              onClick={() => atualizar(quantidade + 1)}
              disabled={disabled || semSaldo || quantidade >= limite}
            >
              <i className="fas fa-plus" aria-hidden="true" />
            </button>
          </div>

          {/* Pílulas de Ação Rápida */}
          <div className="ep-atalhos-inline" aria-label="Atalhos rápidos de quantidade">
            <button
              className="ep-atalho-pill"
              type="button"
              title="Adicionar 5 unidades"
              onClick={() => atualizar(quantidade + 5)}
              disabled={disabled || semSaldo || quantidade >= limite}
            >
              +5
            </button>

            <button
              className="ep-atalho-pill ep-atalho-pill--tudo"
              type="button"
              title={`Embalar lote completo (${limite} un.) [Atalho: tecla T]`}
              onClick={() => atualizar(limite)}
              disabled={disabled || semSaldo || quantidade >= limite}
            >
              <i className="fas fa-check" aria-hidden="true" />
              <span>Tudo ({limite})</span>
            </button>

            <button
              className="ep-atalho-pill ep-atalho-pill--limpar"
              type="button"
              title="Zerar quantidade"
              onClick={() => atualizar(0)}
              disabled={disabled || quantidade === 0}
            >
              Limpar
            </button>
          </div>
        </div>
      </div>

      {/* Barra de Progresso Fina e Elegante */}
      <div className="ep-controle-progresso-wrapper">
        <div className="ep-controle-progresso-trilha" aria-hidden="true">
          <div
            className="ep-controle-progresso-preenchimento"
            style={{ width: `${progresso}%` }}
          />
        </div>
        <div className="ep-controle-progresso-detalhe">
          <span>{quantidade} de {limite} un. selecionadas</span>
          <span className="ep-controle-progresso-fracao">
            {restante} restantes
          </span>
        </div>
      </div>
    </div>
  );
}
