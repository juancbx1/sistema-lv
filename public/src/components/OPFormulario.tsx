import { useEffect, useState, type ChangeEvent } from 'react';
// @ts-expect-error utilitario JS legado sem declaracao TypeScript
import { mostrarMensagem } from '/js/utils/popups.js';
// @ts-expect-error utilitario JS legado sem declaracao TypeScript
import { obterProdutos as obterProdutosDoStorage } from '/js/utils/storage.js';

interface CorteSelecionado {
  id: number;
  produto_id: number;
  produto?: string | null;
  variante?: string | null;
  quantidade?: number | string | null;
  pn?: number | string | null;
}

interface ProdutoGrade {
  variacao?: string | null;
  imagem?: string | null;
}

interface ProdutoStorage {
  id: number;
  imagem?: string | null;
  grade?: ProdutoGrade[] | null;
}

interface OPFormularioProps {
  corteSelecionado: CorteSelecionado | null;
  onOPCriada: () => void;
  onSetGerando?: (id: number | null) => void;
  demandaId?: number | null;
}

export default function OPFormulario({
  corteSelecionado,
  onOPCriada,
  onSetGerando,
  demandaId,
}: OPFormularioProps) {
  const [numeroOP, setNumeroOP] = useState('');
  const [dataEntrega, setDataEntrega] = useState(
    new Date().toISOString().split('T')[0] ?? '',
  );
  const [observacoes, setObservacoes] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [imagemVariante, setImagemVariante] = useState('/img/placeholder-image.png');
  const [quantidadeOP, setQuantidadeOP] = useState<number | string>(
    corteSelecionado?.quantidade || 0,
  );

  const maxQuantidade = Number(corteSelecionado?.quantidade || 0);

  useEffect(() => {
    async function inicializarDados() {
      if (!corteSelecionado) return;

      try {
        setCarregando(true);
        const token = localStorage.getItem('token');
        const numResponse = await fetch('/api/ordens-de-producao?getNextNumber=true', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!numResponse.ok) throw new Error('Falha ao buscar numeração.');

        const numeros = (await numResponse.json()) as unknown[];
        const proximoNumero =
          (numeros
            .map((numero) => Number.parseInt(String(numero), 10))
            .filter((numero) => !Number.isNaN(numero))
            .reduce((max, atual) => Math.max(max, atual), 0) || 0) + 1;
        setNumeroOP(proximoNumero.toString());

        const todosProdutos = (await obterProdutosDoStorage()) as ProdutoStorage[];
        const produtoPai = todosProdutos.find((produto) => produto.id === corteSelecionado.produto_id);

        if (produtoPai) {
          let imagem = produtoPai.imagem;
          if (corteSelecionado.variante && produtoPai.grade) {
            const variacaoItem = produtoPai.grade.find(
              (grade) => grade.variacao === corteSelecionado.variante,
            );
            if (variacaoItem?.imagem) imagem = variacaoItem.imagem;
          }
          setImagemVariante(imagem || '/img/placeholder-image.png');
        }
      } catch (erro) {
        console.error(erro);
        const mensagem = erro instanceof Error ? erro.message : 'Falha ao carregar dados.';
        mostrarMensagem(mensagem, 'erro');
        setNumeroOP((8000 + Math.floor(Math.random() * 1000)).toString());
      } finally {
        setCarregando(false);
      }
    }

    void inicializarDados();
  }, [corteSelecionado]);

  if (!corteSelecionado) return null;

  const handleQuantidadeChange = (evento: ChangeEvent<HTMLInputElement>) => {
    const valor = evento.target.value;
    const valorNumerico = valor === '' ? 0 : Number.parseInt(valor, 10);
    if (valor === '' || (!Number.isNaN(valorNumerico) && valorNumerico >= 0 && valorNumerico <= maxQuantidade)) {
      setQuantidadeOP(valor);
    }
  };

  const ajustarQuantidade = (ajuste: number) => {
    const atual = Number(quantidadeOP) || 0;
    setQuantidadeOP(Math.max(1, Math.min(maxQuantidade, atual + ajuste)));
  };

  const handleSalvarOP = async () => {
    if (!dataEntrega) {
      mostrarMensagem('Selecione uma data de entrega.', 'aviso');
      return;
    }

    const quantidadeFinal = Number.parseInt(String(quantidadeOP), 10);
    if (!quantidadeFinal || quantidadeFinal <= 0) {
      mostrarMensagem('Quantidade inválida.', 'aviso');
      return;
    }

    setCarregando(true);
    onSetGerando?.(corteSelecionado.id);

    try {
      const token = localStorage.getItem('token');
      const opPayload = {
        numero: numeroOP,
        produto_id: corteSelecionado.produto_id,
        variante: corteSelecionado.variante,
        quantidade: quantidadeFinal,
        data_entrega: dataEntrega,
        observacoes,
        corte_origem_id: corteSelecionado.id,
        demanda_id: demandaId || null,
      };

      const response = await fetch('/api/ordens-de-producao', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(opPayload),
      });

      const opCriada = (await response.json()) as { error?: string; numero?: number | string };
      if (!response.ok || opCriada.error) {
        throw new Error(opCriada.error || 'Erro ao criar OP.');
      }

      mostrarMensagem(
        `OP #${opCriada.numero} criada com sucesso (${quantidadeFinal} pçs)!`,
        'sucesso',
      );
      onOPCriada();
    } catch (erro) {
      onSetGerando?.(null);
      console.error('Erro ao salvar OP:', erro);
      const mensagem = erro instanceof Error ? erro.message : 'Erro ao salvar OP.';
      mostrarMensagem(`Erro: ${mensagem}`, 'erro');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="op-corte-registro-container">
      <div className="op-corte-resumo-card">
        <img src={imagemVariante} alt={corteSelecionado.produto || ''} />
        <div className="op-corte-resumo-info">
          <h4>{corteSelecionado.produto}</h4>
          <p>{corteSelecionado.variante || 'Padrão'}</p>
          <div style={{ fontSize: '0.8rem', color: '#555', marginTop: '5px' }}>
            PC Origem: <strong>{corteSelecionado.pn}</strong>
          </div>
        </div>
      </div>

      <div className="op-form-estilizado" style={{ maxWidth: '500px', margin: '20px auto' }}>
        <div
          className="seletor-quantidade-wrapper"
          style={{
            boxShadow: 'none',
            border: '1px solid #eee',
            borderRadius: '8px',
            padding: '15px',
            marginBottom: '20px',
            backgroundColor: '#fdfdfd',
          }}
        >
          <label
            style={{
              display: 'block',
              textAlign: 'center',
              marginBottom: '10px',
              color: '#555',
              fontWeight: '600',
            }}
          >
            Quantidade da OP
          </label>

          <div className="input-container">
            <button type="button" className="ajuste-qtd-btn" onClick={() => ajustarQuantidade(-1)}>
              -
            </button>
            <input
              type="number"
              className="op-input-tarefas"
              value={quantidadeOP}
              onChange={handleQuantidadeChange}
              max={maxQuantidade}
            />
            <button type="button" className="ajuste-qtd-btn" onClick={() => ajustarQuantidade(1)}>
              +
            </button>
          </div>

          <div className="atalhos-qtd-container" style={{ justifyContent: 'center', marginTop: '10px' }}>
            <button type="button" className="atalho-qtd-btn" onClick={() => ajustarQuantidade(10)}>
              +10
            </button>
            <button type="button" className="atalho-qtd-btn" onClick={() => ajustarQuantidade(50)}>
              +50
            </button>
            <button
              type="button"
              className="atalho-qtd-btn"
              onClick={() => setQuantidadeOP(maxQuantidade)}
              style={{ backgroundColor: '#eafaf1', color: '#27ae60', borderColor: '#27ae60' }}
            >
              Usar Tudo ({maxQuantidade})
            </button>
          </div>

          <div style={{ textAlign: 'center', fontSize: '0.8rem', color: '#999', marginTop: '10px' }}>
            Disponível no Corte: <strong>{maxQuantidade}</strong> pçs
          </div>
        </div>

        <div className="op-form-linha">
          <div className="op-form-grupo">
            <label>Número da OP</label>
            <input type="text" className="op-input" value={numeroOP} readOnly disabled />
          </div>
          <div className="op-form-grupo">
            <label htmlFor="dataEntregaOP">Data de Entrega</label>
            <input
              type="date"
              id="dataEntregaOP"
              className="op-input"
              value={dataEntrega}
              onChange={(evento) => setDataEntrega(evento.target.value)}
            />
          </div>
        </div>

        <div className="op-form-grupo">
          <label htmlFor="observacoesOP">Observações (Opcional)</label>
          <textarea
            id="observacoesOP"
            className="op-input"
            rows={3}
            value={observacoes}
            onChange={(evento) => setObservacoes(evento.target.value)}
          ></textarea>
        </div>

        <div className="op-form-botoes" style={{ justifyContent: 'center', marginTop: '30px' }}>
          <button className="op-botao op-botao-principal" onClick={handleSalvarOP} disabled={carregando}>
            {carregando ? <div className="spinner-btn-interno"></div> : <i className="fas fa-check"></i>}
            {carregando ? 'Aguarde...' : 'Confirmar e Criar OP'}
          </button>
        </div>
      </div>
    </div>
  );
}
