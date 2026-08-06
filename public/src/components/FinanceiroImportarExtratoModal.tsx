import { useRef, useState } from 'react';
import FinanceiroModalShell from './FinanceiroModalShell';
import UICarregando from './UICarregando';
import { fetchFinanceiro, FinanceiroApiException } from '../utils/financeiro-api';
import type {
  FinanceiroConta,
  FinanceiroImportacaoDetalhe,
} from '../utils/financeiro-types';

interface Props {
  isOpen: boolean;
  contas: FinanceiroConta[];
  onClose: () => void;
  onImported: (detalhe: FinanceiroImportacaoDetalhe) => void;
}

interface MapeamentoCols {
  hasHeader?: boolean;
  delimiter?: string | null;
  colunaData?: string | null;
  colunaValor?: string | null;
  colunaDescricao?: string | null;
  colunaDocumento?: string | null;
  colunaTipo?: string | null;
  colunaCredito?: string | null;
  colunaDebito?: string | null;
  formatoData?: string;
  sinalNegativoDebito?: boolean;
}

interface PreviewResponse {
  formato: string;
  precisa_mapeamento: boolean;
  colunas?: string[];
  amostra?: Array<Record<string, string>>;
  amostra_linhas?: Array<{ data: string; valor: number; sentido: string; descricao: string }>;
  total_linhas_dados?: number;
  periodo_inicio?: string;
  periodo_fim?: string;
  mapeamento_sugerido?: MapeamentoCols;
  aviso?: string;
  presets?: Array<{
    id: number;
    nome: string;
    formato: string;
    mapeamento_json: MapeamentoCols;
  }>;
}

function extOf(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith('.ofx') || n.endsWith('.ofc')) return 'OFX';
  if (n.endsWith('.xlsx') || n.endsWith('.xls')) return 'XLSX';
  if (n.endsWith('.csv') || n.endsWith('.txt')) return 'CSV';
  if (n.endsWith('.pdf')) return 'PDF';
  return 'OUTRO';
}

/** Rótulo amigável em PT-BR para cabeçalhos comuns de extratos em inglês. */
function rotuloColunaArquivo(nome: string): string {
  const original = String(nome || '').trim();
  if (!original) return '—';
  const n = original
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const mapaExato: Record<string, string> = {
    date: 'Data',
    posted: 'Data',
    'posting date': 'Data',
    'transaction date': 'Data',
    amount: 'Valor',
    value: 'Valor',
    credit: 'Crédito',
    credits: 'Créditos',
    debit: 'Débito',
    debits: 'Débitos',
    description: 'Descrição',
    memo: 'Histórico',
    details: 'Detalhes',
    detail: 'Detalhe',
    balance: 'Saldo',
    'running balance': 'Saldo',
    type: 'Tipo',
    nature: 'Natureza',
    document: 'Documento',
    reference: 'Referência',
    ref: 'Referência',
    check: 'Cheque',
    'check number': 'Nº do cheque',
    fitid: 'ID do banco',
    id: 'ID',
    name: 'Nome',
    payee: 'Favorecido',
  };

  if (mapaExato[n]) {
    const pt = mapaExato[n];
    // Se o arquivo já veio em português, não duplica
    if (original.localeCompare(pt, 'pt-BR', { sensitivity: 'accent' }) === 0) return original;
    return `${pt} (${original})`;
  }

  // Heurística parcial (ex.: "Credit Amount")
  if (/\bcredits?\b/.test(n) && /\bdebits?\b/.test(n)) return `Crédito/Débito (${original})`;
  if (/\bcredits?\b/.test(n)) return `Crédito (${original})`;
  if (/\bdebits?\b/.test(n)) return `Débito (${original})`;
  if (/\bamount\b|\bvalue\b/.test(n)) return `Valor (${original})`;
  if (/\bdate\b|\bposted\b/.test(n)) return `Data (${original})`;
  if (/\bdescription\b|\bmemo\b|\bdetail/.test(n)) return `Descrição (${original})`;
  if (/\bbalance\b/.test(n)) return `Saldo (${original})`;

  return original;
}

function rotuloSentido(sentido: string | undefined | null): string {
  const s = String(sentido || '').toUpperCase();
  if (s === 'CREDITO' || s === 'CREDIT') return 'Crédito';
  if (s === 'DEBITO' || s === 'DEBIT') return 'Débito';
  return sentido || '—';
}

export default function FinanceiroImportarExtratoModal({
  isOpen,
  contas,
  onClose,
  onImported,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [idConta, setIdConta] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [passo, setPasso] = useState<'arquivo' | 'mapeamento'>('arquivo');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [map, setMap] = useState<MapeamentoCols>({});
  const [salvarPreset, setSalvarPreset] = useState(false);
  const [nomePreset, setNomePreset] = useState('');
  const [idPreset, setIdPreset] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!isOpen) return null;

  const reset = () => {
    setArquivo(null);
    setPasso('arquivo');
    setPreview(null);
    setMap({});
    setSalvarPreset(false);
    setNomePreset('');
    setIdPreset('');
    setErro(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => {
    if (enviando) return;
    reset();
    onClose();
  };

  const avancar = async () => {
    if (!idConta || !arquivo) return;
    setEnviando(true);
    setErro(null);
    try {
      const tipo = extOf(arquivo.name);
      if (tipo === 'OFX') {
        await importar(null);
        return;
      }
      if (tipo === 'PDF') {
        // Preview leve opcional; importa direto (heurística)
        const formPrev = new FormData();
        formPrev.append('arquivo', arquivo);
        formPrev.append('id_conta_bancaria', idConta);
        try {
          const prev = await fetchFinanceiro<PreviewResponse>('/importacoes/extrato/preview', {
            method: 'POST',
            body: formPrev,
          });
          setPreview(prev);
        } catch {
          // se preview falhar, tenta importar mesmo assim
        }
        await importar(null);
        return;
      }
      const form = new FormData();
      form.append('arquivo', arquivo);
      form.append('id_conta_bancaria', idConta);
      const data = await fetchFinanceiro<PreviewResponse>('/importacoes/extrato/preview', {
        method: 'POST',
        body: form,
      });
      setPreview(data);
      setMap(data.mapeamento_sugerido || {});
      setPasso('mapeamento');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no preview.');
    } finally {
      setEnviando(false);
    }
  };

  const importar = async (mapeamento: MapeamentoCols | null) => {
    if (!idConta || !arquivo) return;
    setEnviando(true);
    setErro(null);
    try {
      const form = new FormData();
      form.append('id_conta_bancaria', idConta);
      form.append('arquivo', arquivo);
      if (mapeamento) form.append('mapeamento', JSON.stringify(mapeamento));
      if (idPreset) form.append('id_mapeamento_preset', idPreset);
      if (salvarPreset && nomePreset.trim()) {
        form.append('salvar_preset', '1');
        form.append('nome_preset', nomePreset.trim());
      }
      const data = await fetchFinanceiro<FinanceiroImportacaoDetalhe>('/importacoes/extrato', {
        method: 'POST',
        body: form,
      });
      reset();
      onImported(data);
    } catch (err) {
      const msg = err instanceof FinanceiroApiException
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Falha ao importar extrato.';
      setErro(msg);
    } finally {
      setEnviando(false);
    }
  };

  const cols = preview?.colunas || [];
  const mapCompleto = Boolean(map.colunaData && map.colunaDescricao && (map.colunaValor || map.colunaCredito || map.colunaDebito));

  return (
    <FinanceiroModalShell
      titulo={passo === 'mapeamento' ? 'Mapear colunas do extrato' : 'Importar extrato'}
      descricao={
        passo === 'mapeamento'
          ? 'Indique qual coluna é data, valor e descrição. O mapeamento pode ser salvo para a próxima vez.'
          : 'OFX, CSV, XLSX e PDF. PDF é melhor esforço (layouts de bancos variam) — prefira OFX quando existir.'
      }
      icone="fa-file-import"
      onClose={handleClose}
      textoAcao={
        enviando
          ? 'Processando...'
          : passo === 'mapeamento'
            ? 'Importar e revisar'
            : arquivo && extOf(arquivo.name) !== 'OFX'
              ? 'Continuar'
              : 'Importar e revisar'
      }
      processando={enviando}
      acaoDesabilitada={
        enviando
        || !idConta
        || !arquivo
        || (passo === 'mapeamento' && !mapCompleto)
      }
      erro={erro}
      tamanho={passo === 'mapeamento' ? 'lg' : 'md'}
      formId="fc-importar-extrato-form"
    >
      <form
        id="fc-importar-extrato-form"
        className="fc-import-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (passo === 'arquivo') void avancar();
          else void importar(map);
        }}
      >
        {enviando && passo === 'arquivo' ? (
          <UICarregando variante="bloco" tamanho="md" texto="Lendo arquivo..." />
        ) : passo === 'arquivo' ? (
          <>
            <label className="fc-import-field">
              <span>Conta bancária</span>
              <select
                className="fc-input"
                value={idConta}
                onChange={(e) => setIdConta(e.target.value)}
                required
              >
                <option value="">Selecione a conta do extrato…</option>
                {contas.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.nome_conta}</option>
                ))}
              </select>
            </label>

            <label className="fc-import-field">
              <span>Arquivo (OFX, CSV, XLSX ou PDF)</span>
              <input
                ref={fileRef}
                type="file"
                accept=".ofx,.ofc,.csv,.xlsx,.xls,.txt,.pdf,application/pdf,application/x-ofx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="fc-input fc-import-file"
                onChange={(e) => {
                  setArquivo(e.target.files?.[0] ?? null);
                  setPasso('arquivo');
                  setPreview(null);
                }}
              />
              {arquivo ? (
                <small className="fc-import-file-meta">
                  <i className="fas fa-paperclip" aria-hidden /> {arquivo.name}
                  {' · '}
                  {extOf(arquivo.name)}
                  {' · '}
                  {(arquivo.size / 1024).toFixed(1)} KB
                </small>
              ) : (
                <small className="fc-import-hint">Máx. 8 MB. PDF escaneado (imagem) pode não funcionar.</small>
              )}
            </label>

            <div className="fc-import-tips">
              <div className="card-borda-charme" />
              <p>
                <strong>Dica:</strong> OFX é o mais confiável (traz ID único do banco). CSV/XLSX usam mapeamento de colunas.
                PDF extrai texto e tenta reconhecer data + valor + histórico — revise sempre.
              </p>
            </div>
          </>
        ) : (
          <>
            <p className="fc-import-hint">
              {preview?.formato} · {preview?.total_linhas_dados ?? 0} linhas de dados · arquivo{' '}
              <strong>{arquivo?.name}</strong>
            </p>

            {preview?.presets && preview.presets.length > 0 && (
              <label className="fc-import-field">
                <span>Usar mapeamento salvo</span>
                <select
                  className="fc-input"
                  value={idPreset}
                  onChange={(e) => {
                    const id = e.target.value;
                    setIdPreset(id);
                    const p = preview.presets?.find((x) => String(x.id) === id);
                    if (p?.mapeamento_json) setMap(p.mapeamento_json);
                  }}
                >
                  <option value="">— sugerido automaticamente —</option>
                  {preview.presets.map((p) => (
                    <option key={p.id} value={String(p.id)}>{p.nome}</option>
                  ))}
                </select>
              </label>
            )}

            <div className="fc-import-map-grid">
              {([
                ['colunaData', 'Data *'],
                ['colunaValor', 'Valor'],
                ['colunaDescricao', 'Descrição / Histórico *'],
                ['colunaDocumento', 'Documento'],
                ['colunaTipo', 'Tipo (C/D)'],
                ['colunaCredito', 'Crédito (coluna separada)'],
                ['colunaDebito', 'Débito (coluna separada)'],
              ] as const).map(([key, label]) => (
                <label key={key} className="fc-import-field">
                  <span>{label}</span>
                  <select
                    className="fc-input"
                    value={(map[key] as string) || ''}
                    onChange={(e) => setMap((m) => ({ ...m, [key]: e.target.value || null }))}
                  >
                    <option value="">—</option>
                    {cols.map((c) => (
                      <option key={c} value={c}>{rotuloColunaArquivo(c)}</option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="fc-import-field">
                <span>Formato da data</span>
                <select
                  className="fc-input"
                  value={map.formatoData || 'DD/MM/YYYY'}
                  onChange={(e) => setMap((m) => ({ ...m, formatoData: e.target.value }))}
                >
                  <option value="DD/MM/YYYY">DD/MM/AAAA</option>
                  <option value="MM/DD/YYYY">MM/DD/AAAA</option>
                </select>
              </label>
            </div>

            {preview?.amostra && preview.amostra.length > 0 && (
              <div className="fc-import-amostra">
                <strong>Amostra do arquivo</strong>
                <p className="fc-import-hint">
                  Cabeçalhos em inglês do banco aparecem traduzidos; o nome original fica entre parênteses.
                </p>
                <div className="fc-import-amostra-scroll">
                  <table>
                    <thead>
                      <tr>
                        {cols.slice(0, 6).map((c) => <th key={c}>{rotuloColunaArquivo(c)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.amostra.map((row, i) => (
                        <tr key={i}>
                          {cols.slice(0, 6).map((c) => (
                            <td key={c}>{row[c]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {preview?.amostra_linhas && preview.amostra_linhas.length > 0 && (
              <div className="fc-import-amostra">
                <strong>Amostra interpretada</strong>
                <div className="fc-import-amostra-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Valor</th>
                        <th>Tipo</th>
                        <th>Descrição</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.amostra_linhas.map((row, i) => (
                        <tr key={i}>
                          <td>{row.data}</td>
                          <td>
                            {Number(row.valor).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })}
                          </td>
                          <td>{rotuloSentido(row.sentido)}</td>
                          <td>{row.descricao}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <label className="fc-import-check-preset">
              <input
                type="checkbox"
                checked={salvarPreset}
                onChange={(e) => setSalvarPreset(e.target.checked)}
              />
              <span>Salvar este mapeamento para reutilizar</span>
            </label>
            {salvarPreset && (
              <label className="fc-import-field">
                <span>Nome do mapeamento</span>
                <input
                  className="fc-input"
                  value={nomePreset}
                  onChange={(e) => setNomePreset(e.target.value)}
                  placeholder="Ex.: Inter CSV, Bradesco XLSX…"
                />
              </label>
            )}

            <button
              type="button"
              className="gs-btn gs-btn-secundario"
              onClick={() => { setPasso('arquivo'); setErro(null); }}
              disabled={enviando}
            >
              Voltar
            </button>
          </>
        )}
      </form>
    </FinanceiroModalShell>
  );
}
