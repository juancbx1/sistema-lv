import { useEffect, useMemo, useState } from 'react';
import { fetchCpag } from '../utils/cpag-api';
import { formatarMoeda } from '../utils/cpag-format';
import { mostrarToast } from '../utils/cpag-feedback';
import type { CpagVtAjustePayload, CpagVtSaldo } from '../utils/cpag-types';
import UICarregando from './UICarregando';

interface Props {
  aberto: boolean;
  usuarioId: number | string;
  nomeUsuario: string;
  valorPassagemDiaria: number;
  onClose: () => void;
  onSucesso: (saldo?: CpagVtSaldo) => void;
}

type UsoPreset = 'ambas' | 'so_ida' | 'so_volta' | 'nenhuma';

function dataLocalISO(offsetDias = 0): string {
  const base = new Date();
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDias, 12);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatarDataBR(iso: string): string {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function CPAGVtAjusteConsumoModal({
  aberto,
  usuarioId,
  nomeUsuario,
  valorPassagemDiaria,
  onClose,
  onSucesso,
}: Props) {
  const [dataRef, setDataRef] = useState(dataLocalISO(0));
  const [preset, setPreset] = useState<UsoPreset>('ambas');
  const [fato, setFato] = useState('');
  const [demora, setDemora] = useState('');
  const [salvando, setSalvando] = useState(false);

  const via = useMemo(
    () => Math.round((Number(valorPassagemDiaria || 0) / 2) * 100) / 100,
    [valorPassagemDiaria],
  );

  const hoje = dataLocalISO(0);
  const precisaDemora = dataRef < hoje;

  useEffect(() => {
    if (!aberto) return;
    setDataRef(dataLocalISO(0));
    setPreset('ambas');
    setFato('');
    setDemora('');
  }, [aberto, usuarioId]);

  if (!aberto) return null;

  const usouIda = preset === 'ambas' || preset === 'so_ida';
  const usouVolta = preset === 'ambas' || preset === 'so_volta';

  const handleSalvar = async () => {
    if (fato.trim().length < 5) {
      mostrarToast('Descreva o que aconteceu no dia (mín. 5 caracteres).', 'aviso');
      return;
    }
    if (precisaDemora && demora.trim().length < 5) {
      mostrarToast('Informe por que o ajuste não foi feito no dia do fato.', 'aviso');
      return;
    }

    const payload: CpagVtAjustePayload = {
      usuario_id: usuarioId,
      data_ref: dataRef,
      usou_ida: usouIda,
      usou_volta: usouVolta,
      justificativa_fato: fato.trim(),
      justificativa_demora: demora.trim(),
    };

    setSalvando(true);
    try {
      const res = await fetchCpag<{ saldo?: CpagVtSaldo; acoes?: unknown[] }>(
        '/api/pagamentos/vt-saldo/ajustar-consumo',
        { method: 'POST', body: JSON.stringify(payload) },
      );
      mostrarToast('Consumo de passagem ajustado com sucesso.', 'sucesso');
      onSucesso(res?.saldo);
      onClose();
    } catch (err) {
      mostrarToast(err instanceof Error ? err.message : 'Erro ao ajustar consumo.', 'erro');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="cpg-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="cpg-vt-ajuste-titulo">
      <div className="cpg-modal cpg-vt-ajuste-modal">
        <header className="cpg-modal-header">
          <div>
            <h3 id="cpg-vt-ajuste-titulo">Ajustar consumo do dia</h3>
            <p className="cpg-vt-ajuste-sub">
              {nomeUsuario} · via = {formatarMoeda(via)} (passagem do dia ÷ 2)
            </p>
          </div>
          <button type="button" className="cpg-modal-fechar" onClick={onClose} aria-label="Fechar">
            <i className="fas fa-times" />
          </button>
        </header>

        <div className="cpg-modal-body">
          <div className="cpg-form-group">
            <label htmlFor="cpg-vt-data-ref">Data do fato</label>
            <input
              id="cpg-vt-data-ref"
              type="date"
              className="cpg-input"
              value={dataRef}
              max={hoje}
              min={dataLocalISO(-60)}
              onChange={(e) => setDataRef(e.target.value)}
            />
            <small className="cpg-vt-hint">
              Janela máxima: 60 dias. Hoje é {formatarDataBR(hoje)}.
              {precisaDemora ? ' Ajuste retroativo — justificativa da demora obrigatória.' : ''}
            </small>
          </div>

          <fieldset className="cpg-vt-preset">
            <legend>Uso real do cartão nesse dia</legend>
            {(
              [
                ['ambas', 'Ida + volta (2 vias)'],
                ['so_ida', 'Só ida'],
                ['so_volta', 'Só volta (ex.: carona na ida)'],
                ['nenhuma', 'Nenhuma (carona o dia inteiro)'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="cpg-vt-preset-opcao">
                <input
                  type="radio"
                  name="vt-preset"
                  checked={preset === value}
                  onChange={() => setPreset(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>

          <div className="cpg-form-group">
            <label htmlFor="cpg-vt-fato">O que aconteceu? (obrigatório)</label>
            <textarea
              id="cpg-vt-fato"
              className="cpg-input cpg-vt-textarea"
              rows={3}
              value={fato}
              onChange={(e) => setFato(e.target.value)}
              placeholder="Ex.: Carona na ida; usou o cartão só na volta."
            />
          </div>

          <div className="cpg-form-group">
            <label htmlFor="cpg-vt-demora">
              Por que não foi ajustado no dia?{precisaDemora ? ' (obrigatório)' : ' (opcional se ainda for o mesmo dia)'}
            </label>
            <textarea
              id="cpg-vt-demora"
              className="cpg-input cpg-vt-textarea"
              rows={2}
              value={demora}
              onChange={(e) => setDemora(e.target.value)}
              placeholder="Ex.: RH só foi informado dois dias depois."
            />
          </div>

          <div className="cpg-vt-ajuste-resumo" role="status">
            <strong>Efeito previsto</strong>
            <ul>
              <li>Ida: {usouIda ? 'mantém / debita 1 via' : 'não debita · devolve se já debitou'}</li>
              <li>Volta: {usouVolta ? 'mantém / debita 1 via' : 'não debita · devolve se já debitou'}</li>
            </ul>
            <p>
              O extrato fica append-only: débitos das 18h permanecem e o saldo devolvido aparece com
              o motivo e a demora.
            </p>
          </div>
        </div>

        <footer className="cpg-modal-footer">
          <button type="button" className="cpg-btn cpg-btn-secundario" onClick={onClose} disabled={salvando}>
            Cancelar
          </button>
          <button type="button" className="cpg-btn cpg-btn-primario" onClick={handleSalvar} disabled={salvando}>
            {salvando ? <UICarregando variante="inline" /> : <><i className="fas fa-check" /> Confirmar ajuste</>}
          </button>
        </footer>
      </div>
    </div>
  );
}
