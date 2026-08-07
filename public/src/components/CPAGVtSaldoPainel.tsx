import { useCallback, useEffect, useState } from 'react';
import Select from 'react-select';
import { fetchCpag } from '../utils/cpag-api';
import { formatarMoeda } from '../utils/cpag-format';
import { mostrarToast } from '../utils/cpag-feedback';
import type { CpagSelectOption, CpagUsuario, CpagVtMovimento, CpagVtSaldo } from '../utils/cpag-types';
import { temPermissao } from '../utils/bloqueio';
import UICarregando from './UICarregando';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import UIBloqueio from './UIBloqueio';
import CPAGVtAjusteConsumoModal from './CPAGVtAjusteConsumoModal';

interface Props {
  usuarios: CpagUsuario[];
}

function formatarDataHora(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

function formatarDataBR(iso?: string | null): string {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

function classeMovimento(tipo?: string): string {
  if (tipo === 'credito_recarga') return 'cpg-vt-mov--credito';
  if (tipo === 'debito_consumo') return 'cpg-vt-mov--debito';
  if (tipo === 'devolucao_saldo') return 'cpg-vt-mov--devolucao';
  if (tipo === 'transferencia_origem' || tipo === 'transferencia_destino') return 'cpg-vt-mov--transf';
  if (tipo === 'estorno') return 'cpg-vt-mov--estorno';
  return '';
}

export default function CPAGVtSaldoPainel({ usuarios }: Props) {
  const elegiveis = usuarios.filter(
    (u) => Number(u.valor_passagem_diaria || 0) > 0 && u.elegivel_pagamento !== false,
  );
  const options: CpagSelectOption[] = elegiveis.map((u) => ({
    value: u.id,
    label: u.nome,
  }));

  const [sel, setSel] = useState<CpagSelectOption | null>(null);
  const [saldo, setSaldo] = useState<CpagVtSaldo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [modalAjuste, setModalAjuste] = useState(false);
  const [modalSaldo, setModalSaldo] = useState(false);
  const [saldoAlvoInput, setSaldoAlvoInput] = useState('');
  const [justSaldo, setJustSaldo] = useState('');
  const [salvandoSaldo, setSalvandoSaldo] = useState(false);
  const podeAjustar = temPermissao('ajustar-consumo-vt');

  const carregar = useCallback(async (usuarioId: number | string) => {
    setCarregando(true);
    try {
      const data = await fetchCpag<CpagVtSaldo>(
        `/api/pagamentos/vt-saldo?usuario_id=${encodeURIComponent(String(usuarioId))}`,
      );
      setSaldo(data);
    } catch (err) {
      setSaldo(null);
      mostrarToast(err instanceof Error ? err.message : 'Erro ao carregar saldo VT.', 'erro');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (sel?.value != null) {
      void carregar(sel.value);
    } else {
      setSaldo(null);
    }
  }, [sel, carregar]);

  const usuarioAtual = elegiveis.find((u) => String(u.id) === String(sel?.value));

  return (
    <section className="cpg-vt-saldo-painel" aria-label="Saldo do cartão VT">
      <div className="cpg-vt-saldo-painel__header">
        <div>
          <h3 className="cpg-section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
            <i className="fas fa-id-card" aria-hidden="true" /> Saldo do cartão VT
          </h3>
          <p className="cpg-vt-saldo-painel__desc">
            Créditos de recarga menos vias consumidas (ida + volta às 18h). Provisionado = até 48h no cartão.
          </p>
        </div>
      </div>

      <div className="cpg-vt-saldo-painel__controles">
        <div className="cpg-form-group" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
          <label>Empregado</label>
          <Select
            options={options}
            value={sel}
            onChange={(v) => setSel(v)}
            placeholder="Selecione para ver o saldo..."
            isClearable
          />
        </div>
        {sel && (
          <UIBloqueio
            permissao="ajustar-consumo-vt"
            mensagem="Você precisa da permissão para ajustar consumo de passagem (VT)."
          >
            <button
              type="button"
              className="cpg-btn cpg-btn-secundario"
              onClick={() => {
                if (!podeAjustar) return;
                setModalAjuste(true);
              }}
              disabled={!saldo?.schema_ok}
            >
              <i className="fas fa-sliders-h" /> Ajustar consumo
            </button>
          </UIBloqueio>
        )}
        {sel && (
          <UIBloqueio
            permissao="ajustar-consumo-vt"
            mensagem="Você precisa da permissão para definir o saldo do cartão VT."
          >
            <button
              type="button"
              className="cpg-btn cpg-btn-secundario"
              onClick={() => {
                if (!podeAjustar) return;
                setSaldoAlvoInput(
                  saldo?.schema_ok
                    ? String(Math.max(0, Number(saldo.saldo_disponivel) || 0).toFixed(2)).replace('.', ',')
                    : '',
                );
                setJustSaldo('');
                setModalSaldo(true);
              }}
              disabled={!saldo?.schema_ok}
            >
              <i className="fas fa-wallet" /> Definir saldo do cartão
            </button>
          </UIBloqueio>
        )}
        {sel && (
          <button
            type="button"
            className="cpg-btn cpg-btn-secundario"
            onClick={() => sel && void carregar(sel.value)}
            disabled={carregando}
          >
            <i className="fas fa-sync-alt" /> Atualizar
          </button>
        )}
      </div>

      {carregando && <UICarregando variante="bloco" texto="Calculando saldo..." />}

      {!carregando && saldo && !saldo.schema_ok && (
        <div className="cpg-vt-saldo-aviso">
          <i className="fas fa-database" /> Schema do cartão VT ainda não instalado.
          Execute a migration <code>vt-cartao-saldo-v1</code> no ambiente autorizado.
        </div>
      )}

      {!carregando && saldo?.schema_ok && (
        <>
          <div className="cpg-vt-saldo-kpis">
            <article className="cpg-vt-kpi cpg-vt-kpi--disp">
              <span>Disponível</span>
              <strong>{formatarMoeda(saldo.saldo_disponivel)}</strong>
              <small>
                ≈ {saldo.dias_restantes_estimados ?? 0} dia(s) · {saldo.vias_restantes_estimadas ?? 0} via(s)
              </small>
            </article>
            <article className="cpg-vt-kpi cpg-vt-kpi--prov">
              <span>Provisionado</span>
              <strong>{formatarMoeda(saldo.saldo_provisionado)}</strong>
              <small>Recarga a caminho (até 48h)</small>
            </article>
            <article className="cpg-vt-kpi">
              <span>Passagem do dia</span>
              <strong>{formatarMoeda(saldo.valor_passagem_diaria)}</strong>
              <small>Via = {formatarMoeda(saldo.valor_via ?? saldo.valor_passagem_diaria / 2)}</small>
            </article>
          </div>

          {!!saldo.transferencias?.length && (
            <div className="cpg-vt-transf-bloco">
              <h4>Passagens transferidas (falta)</h4>
              <ul>
                {saldo.transferencias.map((t, idx) => (
                  <li key={`${t.data_origem}-${t.data_destino}-${idx}`}>
                    <i className="fas fa-exchange-alt" />{' '}
                    {formatarDataBR(t.data_origem)} → {formatarDataBR(t.data_destino)}{' '}
                    <em>({t.motivo || 'falta'})</em>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="cpg-vt-extrato">
            <h4>Extrato recente</h4>
            {!saldo.ultimos_movimentos?.length && (
              <UIFeedbackNotFound
                variante="compacto"
                icon="fa-receipt"
                titulo="Nenhum movimento ainda"
                mensagem="Após a migration e as recargas, o extrato aparecerá aqui."
              />
            )}
            <ul className="cpg-vt-mov-lista">
              {(saldo.ultimos_movimentos || []).map((m: CpagVtMovimento) => (
                <li key={String(m.id)} className={`cpg-vt-mov ${classeMovimento(m.tipo)}`}>
                  <div className="cpg-vt-mov-topo">
                    <strong>{m.rotulo || m.tipo}</strong>
                    <span className="cpg-vt-mov-valor">
                      {m.tipo === 'debito_consumo' || m.tipo === 'estorno' || Number(m.valor) < 0
                        ? '−'
                        : '+'}
                      {formatarMoeda(Math.abs(Number(m.valor) || 0))}
                    </span>
                  </div>
                  <div className="cpg-vt-mov-meta">
                    {m.data_ref ? `Ref. ${formatarDataBR(m.data_ref)} · ` : ''}
                    {formatarDataHora(m.ocorreu_em)}
                    {m.autor_nome ? ` · ${m.autor_nome}` : ''}
                  </div>
                  {m.justificativa_fato && (
                    <p className="cpg-vt-mov-just">
                      <strong>Motivo:</strong> {m.justificativa_fato}
                    </p>
                  )}
                  {m.justificativa_demora && (
                    <p className="cpg-vt-mov-just">
                      <strong>Demora:</strong> {m.justificativa_demora}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {!carregando && !sel && (
        <UIFeedbackNotFound
          variante="compacto"
          icon="fa-user-check"
          titulo="Selecione um empregado"
          mensagem="Escolha alguém com passagem configurada para consultar o extrato."
        />
      )}

      <CPAGVtAjusteConsumoModal
        aberto={modalAjuste}
        usuarioId={sel?.value ?? ''}
        nomeUsuario={usuarioAtual?.nome || String(sel?.label || '')}
        valorPassagemDiaria={Number(usuarioAtual?.valor_passagem_diaria || saldo?.valor_passagem_diaria || 0)}
        onClose={() => setModalAjuste(false)}
        onSucesso={(s) => {
          if (s) setSaldo(s);
          else if (sel) void carregar(sel.value);
        }}
      />

      {modalSaldo && (
        <div className="cpg-modal-overlay" role="dialog" aria-modal="true">
          <div className="cpg-modal cpg-vt-ajuste-modal">
            <header className="cpg-modal-header">
              <div>
                <h3>Definir saldo do cartão</h3>
                <p className="cpg-vt-ajuste-sub">
                  {usuarioAtual?.nome || sel?.label} · use o valor real do cartão físico (pode ser
                  quebrado, não precisa fechar dia).
                </p>
              </div>
              <button type="button" className="cpg-modal-fechar" onClick={() => setModalSaldo(false)} aria-label="Fechar">
                <i className="fas fa-times" />
              </button>
            </header>
            <div className="cpg-modal-body">
              <div className="cpg-form-group">
                <label htmlFor="cpg-vt-saldo-alvo">Saldo real no cartão (R$)</label>
                <input
                  id="cpg-vt-saldo-alvo"
                  className="cpg-input"
                  inputMode="decimal"
                  value={saldoAlvoInput}
                  onChange={(e) => setSaldoAlvoInput(e.target.value)}
                  placeholder="Ex.: 38,20"
                />
                <small className="cpg-vt-hint">
                  O livro será zerado e este valor vira o saldo inicial validado (go-live / correção).
                </small>
              </div>
              <div className="cpg-form-group">
                <label htmlFor="cpg-vt-saldo-just">Justificativa (obrigatória)</label>
                <textarea
                  id="cpg-vt-saldo-just"
                  className="cpg-input cpg-vt-textarea"
                  rows={3}
                  value={justSaldo}
                  onChange={(e) => setJustSaldo(e.target.value)}
                  placeholder="Ex.: Saldo conferido no app da concessionária em 03/08 — go-live do módulo."
                />
              </div>
            </div>
            <footer className="cpg-modal-footer">
              <button type="button" className="cpg-btn cpg-btn-secundario" onClick={() => setModalSaldo(false)} disabled={salvandoSaldo}>
                Cancelar
              </button>
              <button
                type="button"
                className="cpg-btn cpg-btn-primario"
                disabled={salvandoSaldo}
                onClick={async () => {
                  const normalizado = saldoAlvoInput.replace(/\s/g, '').replace(',', '.');
                  const valor = Number.parseFloat(normalizado);
                  if (!Number.isFinite(valor) || valor < 0) {
                    mostrarToast('Informe um valor de saldo válido (>= 0).', 'aviso');
                    return;
                  }
                  if (justSaldo.trim().length < 5) {
                    mostrarToast('Informe a justificativa do saldo.', 'aviso');
                    return;
                  }
                  setSalvandoSaldo(true);
                  try {
                    const res = await fetchCpag<{ saldo?: CpagVtSaldo }>(
                      '/api/pagamentos/vt-saldo/definir-saldo',
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          usuario_id: sel?.value,
                          saldo_alvo: valor,
                          justificativa_fato: justSaldo.trim(),
                          zerar_livro: true,
                        }),
                      },
                    );
                    mostrarToast('Saldo do cartão definido com sucesso.', 'sucesso');
                    if (res?.saldo) setSaldo(res.saldo);
                    else if (sel) void carregar(sel.value);
                    setModalSaldo(false);
                  } catch (err) {
                    mostrarToast(err instanceof Error ? err.message : 'Erro ao definir saldo.', 'erro');
                  } finally {
                    setSalvandoSaldo(false);
                  }
                }}
              >
                {salvandoSaldo ? <UICarregando variante="inline" /> : <><i className="fas fa-check" /> Confirmar saldo</>}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
