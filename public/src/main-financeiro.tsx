import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import FinanceiroPage from './components/FinanceiroPage';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Elemento root '#root' não encontrado na página Financeiro.");

const root = createRoot(rootElement);
flushSync(() => {
  root.render(<StrictMode><FinanceiroPage /></StrictMode>);
});
