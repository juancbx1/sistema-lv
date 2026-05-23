// public/js/utils/auth.js

import { permissoesDisponiveis, permissoesPorTipo, permissoesValidas } from '/js/utils/permissoes.js';

export async function sincronizarPermissoesUsuario(usuario) {
  if (!usuario) return null;

  const tipos = Array.isArray(usuario.tipos) ? usuario.tipos : (typeof usuario.tipos === 'string' ? [usuario.tipos] : []);
  const tipoMap = {
    'administrador': 'admin', 'tiktik': 'tiktik', 'cortador': 'cortador',
    'costureira': 'costureira', 'lider_setor': 'lider_setor', 'supervisor': 'supervisor',
  };

  const tiposMapeados = tipos.map(tipo => tipoMap[tipo.toLowerCase()] || tipo.toLowerCase());
  const isAdmin = tiposMapeados.includes('admin');

  let permissoesBase = new Set();
  tiposMapeados.forEach(tipoMapeado => {
    (permissoesPorTipo[tipoMapeado] || []).forEach(p => permissoesBase.add(p));
  });

  (usuario.permissoes || []).forEach(p => permissoesBase.add(p));

  if (isAdmin) {
    (permissoesPorTipo['admin'] || []).forEach(permissao => permissoesBase.add(permissao));
  }
  
  usuario.permissoes = Array.from(permissoesBase).filter(p => permissoesValidas.has(p));
  return usuario;
}
/**
 * Verifica a autenticação do usuário e suas permissões para acessar uma página.
 * @param {string} pagina - O caminho da página (ex: 'dashboard/desempenho.html').
 * @param {string[]} permissoesRequeridas - Um array de permissões necessárias.
 * @param {'all' | 'any'} [modo='all'] - 'all' exige todas as permissões, 'any' exige pelo menos uma.
 * @returns {Promise<object|null>} Um objeto com {usuario, permissoes} ou null se a autenticação falhar.
 */
export async function verificarAutenticacao(pagina, permissoesRequeridas = [], modo = 'all') {
    // Em modo impersonação, a aba usa sessionStorage para não afetar o token do admin
    const token = sessionStorage.getItem('impersonation_token') || localStorage.getItem('token');
    if (!token) {
        console.log('[Auth] Token não encontrado, redirecionando para login.');
        window.location.href = '/index.html';
        return null;
    }

    // --- MUDANÇA 1: Identificar o "ambiente" da página (admin vs dashboard) ---
    const ambiente = pagina.startsWith('dashboard/') ? 'dashboard' : 'admin';
    const paginaAcessoNegado = '/admin/acesso-negado.html';

    try {
        const response = await fetch('/api/usuarios/me', {
            headers: { 'Authorization': `Bearer ${token}` },
        });

        if (!response.ok) {
            if (response.status === 401) throw new Error('Token expirado');
            throw new Error('Falha ao verificar usuário no servidor.');
        }

        let usuarioLogado = await response.json();
        localStorage.setItem('permissoes', JSON.stringify(usuarioLogado.permissoes || []));

        const permissoes = usuarioLogado.permissoes || [];

        // --- MUDANÇA 2: Verificação de permissões refatorada e centralizada ---
        // Esta verificação agora acontece ANTES da lógica de redirecionamento de tipo.
        // Isso garante que, se um usuário não tem a permissão específica, ele seja bloqueado primeiro.
        if (permissoesRequeridas.length > 0) {
            const temPermissao = (modo === 'any')
                ? permissoesRequeridas.some(p => permissoes.includes(p))
                : permissoesRequeridas.every(p => permissoes.includes(p));

            if (!temPermissao) {
                console.log(`[Auth API] Sem permissão (${modo}) para [${permissoesRequeridas.join(', ')}]. Redirecionando para ${paginaAcessoNegado}.`);
                window.location.href = paginaAcessoNegado; // << Usa a URL de acesso negado correta
                return null;
            }
        }

        // --- LÓGICA DE REDIRECIONAMENTO DE TIPO (continua parecida, mas mais limpa) ---
        const tipos = usuarioLogado.tipos || [];
        const isUsuarioProducao = tipos.includes('costureira') || tipos.includes('tiktik');
        const temAcessoAdmin = permissoes.includes('acesso-admin-geral');
        
        // Se é um usuário de produção e está tentando acessar uma página de admin
        if (isUsuarioProducao && !temAcessoAdmin && ambiente === 'admin') {
            console.log('[Auth] Usuário de produção tentando acessar área admin. Redirecionando...');
            window.location.href = '/dashboard/dashboard.html';
            return null;
        }

        // Se é um usuário admin/híbrido e está tentando acessar o dashboard diretamente
        if (!isUsuarioProducao && ambiente === 'dashboard') {
            console.log('[Auth] Usuário administrativo tentando acessar dashboard. Redirecionando...');
            window.location.href = '/admin/home.html';
            return null;
        }

        document.body.classList.add('autenticado');
        return { usuario: usuarioLogado, permissoes: permissoes };

    } catch (error) {
        console.error('[Auth] Erro final na verificação:', error.message);
        localStorage.removeItem('token');
        localStorage.removeItem('permissoes');
        window.location.href = error.message === 'Token expirado'
            ? '/admin/token-expirado.html'
            : '/index.html';
        return null;
    }
}

export function logout() {
  console.log('--- LOGOUT INICIADO ---');
  // O 'usuarioLogado' pode não estar disponível globalmente aqui, então tentamos pegar o nome de outra forma
  // ou simplesmente mostramos todas as chaves para depuração.
  console.log('Chaves no localStorage ANTES do logout:', Object.keys(localStorage));

  localStorage.removeItem('token');
  localStorage.removeItem('permissoes');

  console.log('Chaves no localStorage DEPOIS de remover itens de sessão:', Object.keys(localStorage));
  console.log('--- REDIRECIONANDO PARA LOGIN ---');
  window.location.href = '/index.html';
}