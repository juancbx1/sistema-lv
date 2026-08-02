import type { MouseEvent } from 'react';
// @ts-expect-error utilitario JS legado sem declaracao TypeScript
import { mostrarConfirmacao } from '/js/utils/popups.js';
// @ts-expect-error utilitario JS legado sem declaracao TypeScript
import { calcularStatusDemanda, STATUS_META } from '/src/utils/demandaStatus.js';
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio';
import type { OpInicioProducaoDados } from '../utils/op-types';

type DemandaStatus = 'AGUARDANDO' | 'COSTURA' | 'ARREMATE' | 'EMBALAGEM';
type ClasseCorte = 'vinculado' | 'completo' | 'parcial' | 'pendente' | null;

interface PainelDemandaItem {
  demanda_id: number;
  produto_id: number;
  variante?: string | null;
  prioridade?: number | string | null;
  produto_nome?: string | null;
  imagem?: string | null;
  data_solicitacao?: string | null;
  demanda_total?: number | string | null;
  saldo_em_producao?: number | string | null;
  saldo_disponivel_arremate?: number | string | null;
  saldo_disponivel_embalagem?: number | string | null;
  saldo_disponivel_estoque?: number | string | null;
  saldo_perda?: number | string | null;
  corte_cortado?: number | string | null;
  corte_pendente?: number | string | null;
  corte_vinculado?: number | string | null;
}

interface PainelDemandaCardProps {
  item: PainelDemandaItem;
  onDelete?: (demandaId: number) => void | Promise<void>;
  permissoes?: string[];
  onRefresh?: () => void | Promise<void>;
  onIniciarProducao?: (dados: OpInicioProducaoDados) => void;
}

function numero(valor: unknown): number {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}

export default function PainelDemandaCard({
  item,
  onDelete,
  permissoes: _permissoes,
  onRefresh: _onRefresh,
  onIniciarProducao,
}: PainelDemandaCardProps) {
  const totalPedido = numero(item.demanda_total);
  const emProducao = numero(item.saldo_em_producao);
  const emArremate = numero(item.saldo_disponivel_arremate);
  const emEmbalagem = numero(item.saldo_disponivel_embalagem);
  const emEstoque = numero(item.saldo_disponivel_estoque);
  const emPerda = numero(item.saldo_perda);
  const totalConsumido = emProducao + emArremate + emEmbalagem + emEstoque + emPerda;
  const pendenteFila = Math.max(0, totalPedido - totalConsumido);
  const pct = (valor: number) => totalPedido > 0 ? Math.min(100, (valor / totalPedido) * 100) : 0;

  const statusCalculado = calcularStatusDemanda(item) as DemandaStatus;
  const meta = STATUS_META[statusCalculado] || STATUS_META.AGUARDANDO;
  const eUrgente = numero(item.prioridade) === 1;

  const corteCortado = numero(item.corte_cortado);
  const cortePendente = numero(item.corte_pendente);
  const corteVinculado = numero(item.corte_vinculado);
  const corteTotal = corteCortado + cortePendente;
  const mostrarBadgeCorte = statusCalculado === 'AGUARDANDO' && corteTotal > 0;

  const classeCorte: ClasseCorte = (() => {
    if (corteTotal === 0) return null;
    if (corteVinculado >= totalPedido) return 'vinculado';
    if (corteCortado >= totalPedido) return 'completo';
    if (corteCortado > 0) return 'parcial';
    return 'pendente';
  })();

  const textoBadgeCorte = (() => {
    if (classeCorte === 'vinculado') return 'Corte pronto — gerar OP!';
    if (classeCorte === 'completo') {
      return corteCortado === 1 ? '1 pc Cortada' : `${corteCortado} pcs Cortadas`;
    }
    const faltam = totalPedido - corteCortado;
    return faltam === 1 ? 'Falta 1 pc no Corte' : `Faltam ${faltam} pcs no Corte`;
  })();

  const nomeVariante = item.variante && item.variante !== '-' ? item.variante : '';
  const tituloLimpo = nomeVariante
    ? (item.produto_nome || '').replace(`(${nomeVariante})`, '').replace('()', '').trim()
    : (item.produto_nome || '');
  const dataFormatada = item.data_solicitacao
    ? new Date(item.data_solicitacao).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    : null;
  const podeDeletar = temPermissao('deletar-demanda');

  const handleDeleteClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!podeDeletar) {
      mostrarPopupSemPermissao('Você não tem permissão para deletar demandas.');
      return;
    }
    const ok = await mostrarConfirmacao(
      `Apagar demanda de "${tituloLimpo}"?`,
      { tipo: 'perigo', textoConfirmar: 'Apagar', textoCancelar: 'Cancelar' },
    );
    if (ok && onDelete) await onDelete(item.demanda_id);
  };

  const handleCriarOP = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (onIniciarProducao) {
      onIniciarProducao({
        produto_id: item.produto_id,
        variante: item.variante === '-' ? null : item.variante,
        quantidade: pendenteFila,
        demanda_id: item.demanda_id,
      });
      return;
    }
    const params = new URLSearchParams({
      demanda_id: String(item.demanda_id),
      produto_id: String(item.produto_id),
      quantidade: String(pendenteFila),
      auto_abrir: 'true',
    });
    if (item.variante && item.variante !== '-') params.set('variante', item.variante);
    window.location.href = `/admin/ordens-de-producao.html?${params.toString()}`;
  };

  const handleIrArremate = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const params = new URLSearchParams({ produto_id: String(item.produto_id) });
    if (item.variante && item.variante !== '-') params.set('variante', item.variante);
    window.location.href = `/admin/arremates.html?${params.toString()}`;
  };

  const handleIrEmbalagem = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const params = new URLSearchParams({ produto_id: String(item.produto_id) });
    if (item.variante && item.variante !== '-') params.set('variante', item.variante);
    window.location.href = `/admin/embalagem-de-produtos.html?${params.toString()}`;
  };

  const renderCTA = () => {
    if (statusCalculado === 'AGUARDANDO' && pendenteFila > 0) {
      return <button className="pd-cta criar-op" onClick={handleCriarOP}><i className="fas fa-cut"></i>Criar OP</button>;
    }
    if (statusCalculado === 'ARREMATE') {
      return <button className="pd-cta arremate" onClick={handleIrArremate}><i className="fas fa-clipboard-check"></i>Arremate</button>;
    }
    if (statusCalculado === 'EMBALAGEM') {
      return <button className="pd-cta embalagem" onClick={handleIrEmbalagem}><i className="fas fa-box-open"></i>Embalar</button>;
    }
    if (statusCalculado === 'COSTURA') {
      return <span className="pd-status-badge costura"><i className="fas fa-cut"></i>Em costura</span>;
    }
    return null;
  };

  return (
    <div className={`pd-card${eUrgente ? ' urgente' : ''}`}>
      <div className="card-borda-charme" style={!eUrgente ? { backgroundColor: meta.cor } : {}} />
      <button
        className="pd-card-del"
        onClick={handleDeleteClick}
        title={podeDeletar ? 'Apagar demanda' : 'Sem permissão para apagar demanda'}
      >
        {podeDeletar ? <i className="fas fa-trash"></i> : (
          <span className="gs-bloqueio-icone-duplo"><i className="fas fa-trash"></i><i className="fas fa-lock"></i></span>
        )}
      </button>

      <div className="pd-card-topo">
        <img src={item.imagem || '/img/placeholder-image.png'} className="pd-card-img" alt={tituloLimpo} />
        <div className="pd-card-info">
          {eUrgente && <span className="pd-urgente-pill"><i className="fas fa-star"></i> Urgente</span>}
          <span className="pd-card-nome">{tituloLimpo}</span>
          {nomeVariante && <span className="pd-card-variante">{nomeVariante}</span>}
          {dataFormatada && <span className="pd-card-meta"><i className="fas fa-calendar-alt"></i>{dataFormatada}</span>}
        </div>
      </div>

      <div className="pd-card-bar">
        <div className="seg-estoque" style={{ width: `${pct(emEstoque)}%` }} />
        <div className="seg-embalagem" style={{ width: `${pct(emEmbalagem)}%` }} />
        <div className="seg-arremate" style={{ width: `${pct(emArremate)}%` }} />
        <div className="seg-producao" style={{ width: `${pct(emProducao)}%` }} />
        <div className="seg-perda" style={{ width: `${pct(emPerda)}%` }} />
      </div>

      <div className="pd-card-rodape" onClick={(event) => event.stopPropagation()}>
        <div className="pd-card-qtd">
          <div className="pd-card-qtd-bloco pedido" title="Quantidade solicitada pelo gerente">
            <span className="pd-card-qtd-num">{totalPedido}</span>
            <span className="pd-card-qtd-label">pedidas</span>
          </div>
          {totalConsumido > 0 && (
            <>
              <span className="pd-card-qtd-sep">·</span>
              <div
                className={`pd-card-qtd-bloco producao${totalConsumido > totalPedido ? ' excedente' : ''}`}
                title={totalConsumido > totalPedido
                  ? `${totalConsumido} peças em produção — ${totalConsumido - totalPedido} acima do pedido`
                  : `${totalConsumido} peças no pipeline`}
              >
                <span className="pd-card-qtd-num">{totalConsumido}</span>
                <span className="pd-card-qtd-label">
                  {totalConsumido > totalPedido ? `prod. (+${totalConsumido - totalPedido})` : 'prod.'}
                </span>
              </div>
            </>
          )}
        </div>
        {mostrarBadgeCorte && (
          <span className={`pd-corte-badge pd-corte-badge--${classeCorte}`}>
            <i className="fas fa-ruler"></i>{textoBadgeCorte}
          </span>
        )}
        {renderCTA()}
      </div>
    </div>
  );
}
