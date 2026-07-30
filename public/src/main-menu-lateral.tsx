import { createRoot } from 'react-dom/client';
import MenuLateral from './components/MenuLateral';

function montarMenu() {
  if (!window.location.pathname.includes('/admin/')) return;
  if (document.getElementById('menu-lateral-container')) return;

  const container = document.createElement('div');
  container.id = 'menu-lateral-container';
  document.body.prepend(container);
  createRoot(container).render(<MenuLateral />);

  void import('./main-agentes-globais.jsx');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', montarMenu, { once: true });
} else {
  montarMenu();
}
