import React from 'react';
import { createRoot } from 'react-dom/client';
import ProdutoEtapasEditor from './components/ProdutoEtapasEditor.tsx';

const container = document.getElementById('etapasProducaoReact');

if (container) {
  createRoot(container).render(<ProdutoEtapasEditor />);
}

