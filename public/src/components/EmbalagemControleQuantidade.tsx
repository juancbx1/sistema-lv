import type { ChangeEvent } from 'react';

interface EmbalagemControleQuantidadeProps {
  value: number | null;
  max: number;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  id?: string;
  autoFocus?: boolean;
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
}: EmbalagemControleQuantidadeProps) {
  const limite = Math.max(0, Math.floor(max));
  const quantidade = limitarQuantidade(value, limite);
  const restante = Math.max(0, limite - quantidade);
  const progresso = limite > 0 ? Math.min(100, (quantidade / limite) * 100) : 0;
  const semSaldo = limite <= 0;

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

  return (
    <div className="ep-controle-quantidade">
      <div className="ep-controle-quantidade-cabecalho">
        <label htmlFor={id}>
          Quantidade a embalar
          <small>Use os atalhos ou informe manualmente</small>
        </label>
        <strong>
          {quantidade} / {limite} un.
        </strong>
      </div>

      <div className="ep-controle-quantidade-atalhos" aria-label="Atalhos de quantidade">
        <button
          className="ep-controle-quantidade-atalho"
          type="button"
          onClick={() => atualizar(quantidade + 1)}
          disabled={disabled || semSaldo || quantidade >= limite}
        >
          +1
        </button>
        <button
          className="ep-controle-quantidade-atalho"
          type="button"
          onClick={() => atualizar(quantidade + 5)}
          disabled={disabled || semSaldo || quantidade >= limite}
        >
          +5
        </button>
        <button
          className="ep-controle-quantidade-atalho ep-controle-quantidade-tudo"
          type="button"
          onClick={() => atualizar(limite)}
          disabled={disabled || semSaldo || quantidade >= limite}
        >
          Tudo
        </button>
        <button
          className="ep-controle-quantidade-atalho ep-controle-quantidade-limpar"
          type="button"
          onClick={() => atualizar(0)}
          disabled={disabled || quantidade === 0}
        >
          LIMPAR
        </button>
      </div>

      <div className="ep-controle-quantidade-manual">
        <label htmlFor={id}>Ou digite a quantidade exata</label>
        <div className="ep-controle-quantidade-input">
          <input
            id={id}
            type="number"
            min="0"
            max={limite}
            value={value === null ? '' : quantidade}
            onChange={handleInputChange}
            inputMode="numeric"
            disabled={disabled || semSaldo}
            autoFocus={autoFocus}
          />
          <span>un.</span>
        </div>
      </div>

      <div className="ep-controle-quantidade-progresso" aria-hidden="true">
        <span style={{ width: `${progresso}%` }} />
      </div>

      <div className="ep-controle-quantidade-resumo">
        <span>{quantidade} selecionadas</span>
        <span>{restante} restantes</span>
      </div>
    </div>
  );
}
