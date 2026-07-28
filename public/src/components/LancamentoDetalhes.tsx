import type { FinanceiroLancamento } from '../utils/financeiro-types';

interface Props { lancamento: FinanceiroLancamento; }
const formatCurrency = (value: unknown) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);

export default function LancamentoDetalhes({ lancamento }: Props) {
  const isCompra = lancamento.tipo_rateio === 'COMPRA';
  return <div className={`card-expanded-details ${isCompra ? 'compra' : 'rateio'}`}>
    <div className="fc-expanded-heading"><span>{isCompra ? 'Itens da compra' : 'Distribuição do rateio'}</span><small>{lancamento.itens?.length || 0} itens</small></div>
    <div className="fc-expanded-items">
      {(lancamento.itens ?? []).map((item) => <div className={`fc-expanded-item ${isCompra ? 'compra' : 'rateio'}`} key={item.id}><div className="card-borda-charme" />{isCompra ? <><div className="fc-expanded-item-top"><strong>{item.descricao_item || 'Produto sem descrição'}</strong><span>{item.quantidade ?? 0} un.</span></div><small>Categoria · {item.nome_categoria || 'Sem categoria'}</small><b>{formatCurrency(item.valor_total_item)}</b></> : <><div className="fc-expanded-item-top"><strong>{item.nome_contato_item || 'Favorecido não informado'}</strong><span>{item.nome_categoria || 'Sem categoria'}</span></div><small>{item.descricao_item || 'Sem descrição'}</small><b>{formatCurrency(item.valor_total_item)}</b></>}</div>)}
    </div>
    {isCompra && <div className="details-summary"><span>Subtotal: {formatCurrency(Number(lancamento.valor) + Number(lancamento.valor_desconto || 0))}</span>{Number(lancamento.valor_desconto || 0) > 0 && <span>Desconto: <span style={{ color: 'var(--gs-perigo)' }}>- {formatCurrency(lancamento.valor_desconto)}</span></span>}<span>Total pago: <strong>{formatCurrency(lancamento.valor)}</strong></span></div>}
  </div>;
}
