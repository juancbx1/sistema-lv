import { createRoot } from 'react-dom/client';
// @ts-expect-error autenticação compartilhada em JavaScript legado.
import { verificarAutenticacao } from '/js/utils/auth.js';
import EstoquePage from './components/EstoquePage';
import removerCarregamentoInicial from './utils/remover-carregamento-inicial';

interface AuthResult {
  permissoes?: string[];
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) return;

  try {
    const auth = await verificarAutenticacao('admin/estoque.html', ['acesso-estoque']) as AuthResult | null | false;
    if (!auth) return;

    document.body.classList.add('autenticado');
    removerCarregamentoInicial();
    createRoot(root).render(<EstoquePage permissoes={auth.permissoes || []} />);
  } catch (error) {
    console.error('[Estoque] Falha ao iniciar a página:', error);
    removerCarregamentoInicial();
    root.innerHTML = '<div class="estoque-inline-error" role="alert"><i class="fas fa-circle-exclamation" aria-hidden="true"></i><span>Não foi possível iniciar a página de estoque.</span><button type="button" onclick="window.location.reload()">Tentar novamente</button></div>';
  }
}

void bootstrap();
