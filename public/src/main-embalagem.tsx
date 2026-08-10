import ReactDOM from 'react-dom/client';
// @ts-expect-error módulo JS legado sem tipos
import { verificarAutenticacao } from '/js/utils/auth.js';
import EmbalagemPage from './pages/EmbalagemPage';
import removerCarregamentoInicial from './utils/remover-carregamento-inicial';

async function bootstrap() {
  const root = document.getElementById('root');
  if (!root) return;

  try {
    const auth = await verificarAutenticacao(
      'admin/embalagem-de-produtos.html',
      ['acesso-embalagem-de-produtos'],
    ) as { usuario?: unknown; permissoes?: string[] } | null | false;

    if (!auth) return;

    removerCarregamentoInicial();
    ReactDOM.createRoot(root).render(<EmbalagemPage />);
  } catch (error) {
    console.error('Falha ao iniciar a página de embalagens:', error);
    root.innerHTML = `
      <div class="ep-fila-estado ep-fila-erro" role="alert">
        <i class="fas fa-circle-exclamation" aria-hidden="true"></i>
        <strong>Não foi possível iniciar a página.</strong>
        <p>Atualize a página e tente novamente.</p>
      </div>
    `;
  }
}

void bootstrap();
