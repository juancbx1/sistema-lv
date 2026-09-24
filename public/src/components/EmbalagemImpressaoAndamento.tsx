import type { ResultadoEmbalagem } from '../utils/etiqueta-resultado';

interface EmbalagemImpressaoAndamentoProps {
  fase: 'imprimindo' | 'resultado';
  quantidade: number;
  resultado: ResultadoEmbalagem | null;
  onFechar: () => void;
}

export default function EmbalagemImpressaoAndamento({
  fase,
  quantidade,
  resultado,
  onFechar,
}: EmbalagemImpressaoAndamentoProps) {
  const imprimindo = fase === 'imprimindo';
  const tituloImpressao = quantidade === 1
    ? 'Imprimindo etiqueta...'
    : 'Imprimindo etiquetas...';

  return (
    <div className="ep-print-overlay" role="dialog" aria-modal="true" aria-labelledby="ep-print-titulo">
      <section className="ep-print-card">
        {imprimindo ? (
          <>
            <div className="ep-print-cena" aria-hidden="true">
              <div className="ep-print-maquina">
                <span className="ep-print-luz" />
                <span className="ep-print-boca" />
                <span className="ep-print-papel" />
              </div>
              <span className="ep-print-folha ep-print-folha-1" />
              <span className="ep-print-folha ep-print-folha-2" />
              <span className="ep-print-folha ep-print-folha-3" />
            </div>
            <h2 id="ep-print-titulo">{tituloImpressao}</h2>
            <p>A etiqueta está saindo agora.</p>
          </>
        ) : (
          <>
            <div className={`ep-print-resultado ${resultado?.tom ?? (resultado?.impresso ? 'ok' : 'falha')}`} aria-hidden="true">
              <i className={`fas ${resultado?.tom === 'falha' || (!resultado?.tom && !resultado?.impresso) ? 'fa-triangle-exclamation' : resultado?.impresso ? 'fa-check' : 'fa-box'}`} />
            </div>
            <h2 id="ep-print-titulo">{resultado?.titulo}</h2>
            <p>{resultado?.detalhe}</p>
            <button className="gs-btn gs-btn-primario" type="button" onClick={onFechar}>
              Continuar
            </button>
          </>
        )}
      </section>
    </div>
  );
}
