interface ProdutoCorte {
  id: number;
  nome: string;
  imagem?: string | null;
}

interface OPSelecaoProdutoCorteProps {
  produtos: ProdutoCorte[];
  onProdutoSelect: (produto: ProdutoCorte) => void;
}

interface ProdutoCardProps {
  produto: ProdutoCorte;
  onSelect: (produto: ProdutoCorte) => void;
}

// Card individual de cada produto na vitrine de cortes.
function ProdutoCard({ produto, onSelect }: ProdutoCardProps) {
  return (
    <div className="op-corte-produto-card" onClick={() => onSelect(produto)}>
      <div className="card-borda-charme" aria-hidden="true"></div>
      <div className="op-corte-produto-imagem-container">
        <img src={produto.imagem || '/img/placeholder-image.png'} alt={produto.nome} />
      </div>
      <div className="op-corte-produto-nome">{produto.nome}</div>
    </div>
  );
}

// Vitrine principal da seleção de produtos.
export default function OPSelecaoProdutoCorte({
  produtos,
  onProdutoSelect,
}: OPSelecaoProdutoCorteProps) {
  return (
    <div className="op-corte-vitrine-container">
      {produtos.map((produto) => (
        <ProdutoCard key={produto.id} produto={produto} onSelect={onProdutoSelect} />
      ))}
    </div>
  );
}
