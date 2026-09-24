import { createRoot, type Root } from 'react-dom/client';
import OPMonitoramentoGlobal from './components/OPMonitoramentoGlobal';
import '../css/monitoramento-ops.css';

const ROOT_ID = 'op-monitoramento-global-root';
let root: Root | null = null;

export function montarMonitoramentoOps() {
  if (root || document.getElementById(ROOT_ID)) return;
  const container = document.createElement('div');
  container.id = ROOT_ID;
  document.body.appendChild(container);
  root = createRoot(container);
  root.render(<OPMonitoramentoGlobal />);
}

export function desmontarMonitoramentoOps() {
  root?.unmount();
  root = null;
  document.getElementById(ROOT_ID)?.remove();
}
