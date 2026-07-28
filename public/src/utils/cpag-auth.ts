import type { CpagAuthResult } from './cpag-types';

export async function verificarAutenticacaoCpag(permissoesRequeridas: string[] = []): Promise<CpagAuthResult | null> {
  const token = sessionStorage.getItem('impersonation_token') || localStorage.getItem('token');
  if (!token) { window.location.href = '/index.html'; return null; }
  try {
    const response = await fetch('/api/usuarios/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(response.status === 401 ? 'Token expirado' : 'Falha ao verificar usuário.');
    const usuario = await response.json() as CpagAuthResult['usuario'];
    const permissoes = usuario?.permissoes ?? [];
    localStorage.setItem('permissoes', JSON.stringify(permissoes));
    if (!permissoesRequeridas.every((permissao) => permissoes.includes(permissao))) { window.location.href = '/admin/acesso-negado.html'; return null; }
    const tipos = Array.isArray(usuario?.tipos) ? usuario.tipos : [];
    if ((tipos.includes('costureira') || tipos.includes('tiktik')) && !permissoes.includes('acesso-admin-geral')) { window.location.href = '/dashboard/dashboard.html'; return null; }
    document.body.classList.add('autenticado');
    return { usuario, permissoes };
  } catch (error) {
    localStorage.removeItem('token'); localStorage.removeItem('permissoes');
    window.location.href = error instanceof Error && error.message === 'Token expirado' ? '/admin/token-expirado.html' : '/index.html';
    return null;
  }
}
