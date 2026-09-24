import { useEffect, useState } from 'react';
import useOPMonitoramento from '../hooks/useOPMonitoramento';
import OPMonitoramentoFab from './OPMonitoramentoFab';
import OPMonitoramentoPainel from './OPMonitoramentoPainel';

export default function OPMonitoramentoGlobal() {
  const { dados } = useOPMonitoramento();
  const [aberto, setAberto] = useState(false);
  const obrigatorio = Boolean(dados?.intercepcao_obrigatoria);

  useEffect(() => {
    if (!obrigatorio) return;
    setAberto(false);
  }, [obrigatorio]);

  // Permite deploy compatível antes da migration. A ferramenta só fica visível
  // quando a persistência que sustenta obrigação e idempotência está presente.
  if (!dados?.persistencia_disponivel) return null;

  return (
    <>
      <OPMonitoramentoFab dados={dados} onClick={() => setAberto(true)} />
      {(aberto || obrigatorio) && (
        <OPMonitoramentoPainel
          modo="drawer"
          obrigatorio={obrigatorio}
          onClose={() => setAberto(false)}
        />
      )}
    </>
  );
}

