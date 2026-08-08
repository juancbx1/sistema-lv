import { useState, type ChangeEvent } from 'react';
// @ts-expect-error utilitario JS legado sem declaracao TypeScript
import { mostrarMensagem } from '/js/utils/popups.js';

interface ProdutoGrade {
  variacao?: string | null;
  imagem?: string | null;
}

interface ProdutoCorte {
  id: number;
  nome: string;
  imagem?: string | null;
  grade?: ProdutoGrade[] | null;
}

interface UsuarioCorte {
  nome?: string | null;
}

interface OPRegistroCorteProps {
  produto: ProdutoCorte | null;
  variante?: string | null;
  usuario: UsuarioCorte | null;
  onCorteRegistrado: (corte?: unknown) => void;
  quantidadeInicial?: number | string | null;
  demandaId?: number | null;
}

export default function OPRegistroCorte({
  produto,
  variante,
  usuario,
  onCorteRegistrado,
  quantidadeInicial,
  demandaId,
}: OPRegistroCorteProps) {
  const [quantidade, setQuantidade] = useState<number | string>(quantidadeInicial || '');
  const [dataCorte, setDataCorte] = useState(
    new Date().toISOString().split('T')[0] ?? '',
  );
  const [carregando, setCarregando] = useState(false);

  if (!produto) return null;

  const imagemSrc = produto.grade?.find((grade) => grade.variacao === variante)?.imagem;
  const imagemFinal = imagemSrc || produto.imagem || '/img/placeholder-image.png';

  const handleQuantidadeChange = (evento: ChangeEvent<HTMLInputElement>) => {
    const valor = evento.target.value;
    if (valor === '' || Number.parseInt(valor, 10) >= 0) {
      setQuantidade(valor);
    }
  };

  const ajustarQuantidade = (delta: number) => {
    setQuantidade((anterior) => {
      const atual = Number.parseInt(String(anterior), 10) || 0;
      return Math.max(0, atual + delta).toString();
    });
  };

  const handleRegistrar = async () => {
    const quantidadeNumerica = Number.parseInt(String(quantidade), 10);
    if (!quantidade || quantidadeNumerica <= 0) {
      mostrarMensagem('Por favor, insira uma quantidade válida.', 'aviso');
      return;
    }
    if (!usuario?.nome) {
      mostrarMensagem('Erro: Usuário não identificado.', 'erro');
      return;
    }

    setCarregando(true);
    try {
      const token = localStorage.getItem('token');
      const pcResponse = await fetch('/api/cortes/next-pc-number', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!pcResponse.ok) throw new Error('Falha ao obter número do PC.');
      const pcData = (await pcResponse.json()) as { nextPC?: number | string };

      const payload = {
        produto_id: produto.id,
        variante,
        quantidade: quantidadeNumerica,
        data: dataCorte,
        pn: pcData.nextPC,
        status: 'cortados',
        op: null,
        cortador: usuario.nome,
        demanda_id: demandaId,
      };

      const response = await fetch('/api/cortes', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const erro = (await response.json()) as { error?: string };
        throw new Error(erro.error || 'Erro ao registrar corte.');
      }

      const corteCriado = await response.json();
      mostrarMensagem(`Corte (PC: ${pcData.nextPC}) registrado com sucesso!`, 'sucesso');
      onCorteRegistrado(corteCriado);
    } catch (erro) {
      console.error('Erro em OPRegistroCorte:', erro);
      const mensagem = erro instanceof Error ? erro.message : 'Erro ao registrar corte.';
      mostrarMensagem(`Erro: ${mensagem}`, 'erro');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="op-corte-registro-container">
      <div className="op-corte-resumo-card">
        <div className="card-borda-charme" aria-hidden="true"></div>
        <img src={imagemFinal} alt={produto.nome} />
        <div className="op-corte-resumo-info">
          <h4>{produto.nome}</h4>
          <p>{variante}</p>
        </div>
      </div>

      <div className="op-form-estilizado" style={{ maxWidth: '400px', margin: '0 auto' }}>
        <div
          className="item-controles-qtd"
          style={{ border: 'none', padding: '0 0 20px 0' }}
        >
          <label style={{ fontWeight: '600', color: '#555', marginBottom: '5px' }}>
            Quantidade Cortada
          </label>

          <div className="qtd-display-linha">
            <button className="btn-ajuste mini" onClick={() => ajustarQuantidade(-1)}>
              -
            </button>
            <input
              type="number"
              value={quantidade}
              onChange={handleQuantidadeChange}
              placeholder="0"
              style={{ width: '100px', fontSize: '1.6rem' }}
            />
            <button className="btn-ajuste mini" onClick={() => ajustarQuantidade(1)}>
              +
            </button>
          </div>

          <div className="qtd-atalhos-linha" style={{ marginTop: '10px' }}>
            <button onClick={() => ajustarQuantidade(10)}>+10</button>
            <button onClick={() => ajustarQuantidade(50)}>+50</button>
            <button onClick={() => ajustarQuantidade(100)}>+100</button>
          </div>

          {quantidadeInicial && (
            <div style={{ fontSize: '0.8rem', color: '#27ae60', marginTop: '8px' }}>
              <i className="fas fa-check-circle"></i> Sugerido: {quantidadeInicial} pçs
            </div>
          )}
        </div>

        <div className="op-form-grupo">
          <label htmlFor="dataCorte">Data do Corte</label>
          <input
            type="date"
            id="dataCorte"
            className="op-input"
            style={{ textAlign: 'center', fontSize: '1.1rem', padding: '10px' }}
            value={dataCorte}
            onChange={(evento) => setDataCorte(evento.target.value)}
          />
        </div>

        <div
          className="op-form-botoes"
          style={{ justifyContent: 'center', marginTop: '30px' }}
        >
          <button
            className="op-botao op-botao-sucesso"
            onClick={handleRegistrar}
            disabled={carregando}
            style={{ width: '100%', padding: '15px', fontSize: '1.1rem' }}
          >
            {carregando ? <div className="spinner-btn-interno"></div> : <i className="fas fa-check"></i>}
            {carregando ? 'Salvando...' : 'Confirmar Corte'}
          </button>
        </div>
      </div>
    </div>
  );
}
