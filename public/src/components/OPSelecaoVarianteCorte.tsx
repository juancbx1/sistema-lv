import { useMemo, useState } from 'react';
import UIBuscaInteligente, { normalizarTexto } from './UIBuscaInteligente';
import UIFeedbackNotFound from './UIFeedbackNotFound';

interface GradeItem {
  variacao?: string | null;
  imagem?: string | null;
}

interface ProdutoCorte {
  imagem?: string | null;
  grade?: GradeItem[] | null;
}

interface OPSelecaoVarianteCorteProps {
  produto: ProdutoCorte | null;
  onVarianteSelect: (variante: string) => void;
}

interface TamanhoVariante {
  nome: string;
  variacaoCompleta: string;
}

interface GrupoVariante {
  cor?: string;
  variacao?: string;
  imagem?: string | null;
  tamanhos?: TamanhoVariante[];
}

export default function OPSelecaoVarianteCorte({
  produto,
  onVarianteSelect,
}: OPSelecaoVarianteCorteProps) {
  const [termoFiltrado, setTermoFiltrado] = useState('');
  const [corSelecionada, setCorSelecionada] = useState<string | null>(null);

  const { temTamanhos, gruposDeVariantes } = useMemo<{
    temTamanhos: boolean;
    gruposDeVariantes: GrupoVariante[];
  }>(() => {
    const grade = produto?.grade ?? [];
    if (grade.length === 0) {
      return { temTamanhos: false, gruposDeVariantes: [] };
    }

    const temGradeComTamanhos = grade.some((item) =>
      (item.variacao ?? '').includes('|'),
    );

    if (!temGradeComTamanhos) {
      return {
        temTamanhos: false,
        gruposDeVariantes: grade.map((item) => ({
          variacao: item.variacao ?? '',
          imagem: item.imagem,
        })),
      };
    }

    const grupos = grade.reduce<Record<string, GrupoVariante>>((acc, item) => {
      const variacaoCompleta = item.variacao ?? '';
      const partes = variacaoCompleta.split('|').map((parte) => parte.trim());
      const cor = partes[0] ?? '';
      const tamanho = partes[1] || '';

      if (!acc[cor]) {
        acc[cor] = { cor, imagem: item.imagem, tamanhos: [] };
      }

      acc[cor].tamanhos?.push({ nome: tamanho, variacaoCompleta });
      return acc;
    }, {});

    return { temTamanhos: true, gruposDeVariantes: Object.values(grupos) };
  }, [produto]);

  const variantesFiltradas = useMemo(() => {
    if (!termoFiltrado) return gruposDeVariantes;

    const termoLimpo = normalizarTexto(termoFiltrado);

    return gruposDeVariantes.filter((item) => {
      const textoPrincipal = normalizarTexto(item.cor || item.variacao);
      if (textoPrincipal.includes(termoLimpo)) return true;

      return Boolean(
        item.tamanhos?.some((tamanho) =>
          normalizarTexto(tamanho.nome).includes(termoLimpo),
        ),
      );
    });
  }, [gruposDeVariantes, termoFiltrado]);

  const buscaVariante = termoFiltrado.trim();

  return (
    <div className="op-corte-variante-container">
      <div className="op-corte-filtro-wrapper">
        <UIBuscaInteligente
          onSearch={setTermoFiltrado}
          placeholder={`Buscar por ${temTamanhos ? 'cor' : 'variação'}...`}
          historicoKey="variantes"
        />
      </div>

      {variantesFiltradas.length === 0 ? (
        <UIFeedbackNotFound
          icon="fa-search"
          titulo={buscaVariante ? 'Nenhuma variação encontrada' : 'Nenhuma variação cadastrada'}
          mensagem={buscaVariante
            ? `Não encontramos cores ou variações para “${buscaVariante}”. Tente outro termo.`
            : 'Este produto ainda não possui cores ou variações cadastradas.'}
        />
      ) : (
        <div className="op-corte-vitrine-container">
          {variantesFiltradas.map((item, index) => {
            const isSelected = corSelecionada === item.cor;
            const nomeVariante = item.cor || item.variacao || '';

            return (
              <div
                key={`${nomeVariante}-${index}`}
                className="op-corte-variante-card"
                style={{ position: 'relative' }}
              >
                <div
                  className="op-corte-produto-imagem-container"
                  onClick={() =>
                    !temTamanhos
                      ? onVarianteSelect(item.variacao ?? '')
                      : setCorSelecionada(item.cor ?? null)
                  }
                >
                  <img
                    src={item.imagem || produto?.imagem || '/img/placeholder-image.png'}
                    alt={nomeVariante}
                  />
                </div>
                <div className="op-corte-produto-nome">{nomeVariante}</div>

                {temTamanhos && isSelected && (
                  <div
                    className="op-corte-tamanhos-container"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      backgroundColor: 'rgba(255, 255, 255, 0.98)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 10,
                      animation: 'fadeIn 0.2s ease-out',
                    }}
                    onClick={(evento) => evento.stopPropagation()}
                  >
                    <button
                      onClick={() => setCorSelecionada(null)}
                      style={{
                        position: 'absolute',
                        top: 5,
                        right: 5,
                        background: 'none',
                        border: 'none',
                        fontSize: '1.2rem',
                        color: '#666',
                        cursor: 'pointer',
                      }}
                    >
                      <i className="fas fa-times"></i>
                    </button>
                    <h4 style={{ marginBottom: '15px', color: '#333' }}>
                      Selecione o Tamanho
                    </h4>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '10px',
                        justifyContent: 'center',
                        width: '90%',
                      }}
                    >
                      {item.tamanhos?.map((tamanho) => (
                        <button
                          key={tamanho.nome}
                          className="op-botao-tamanho"
                          style={{ width: 'auto', minWidth: '60px', padding: '8px 15px' }}
                          onClick={() => onVarianteSelect(tamanho.variacaoCompleta)}
                        >
                          {tamanho.nome}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
