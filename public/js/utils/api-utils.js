// public/js/utils/api-utils.js

/**
 * Função centralizada para fazer chamadas à API, incluindo o token de autenticação.
 * @param {string} endpoint - O endpoint da API (ex: '/api/usuarios').
 * @param {object} options - Opções da requisição fetch (method, body, etc.).
 * @returns {Promise<any>} A resposta da API em formato JSON.
 * @throws {Error} Lança um erro se a resposta não for 'ok'.
 */
export async function fetchAPI(endpoint, options = {}) {
    // Em modo impersonação, a aba usa sessionStorage para não afetar o token do admin
    const token = sessionStorage.getItem('impersonation_token') || localStorage.getItem('token');
    
    // Se não tiver token e não for login, redireciona (ajuste conforme sua rota de login)
    if (!token && !endpoint.includes('login')) {
        window.location.href = '/login.html'; 
        throw new Error('Sessão expirada');
    }

    const defaultHeaders = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    const config = {
        ...options,
        headers: {
            ...defaultHeaders,
            ...options.headers,
        },
    };

    try {
        const response = await fetch(endpoint, config);

        // Tratamento para 401 (Não autorizado/Token expirado)
        if (response.status === 401) {
            localStorage.removeItem('token');
            window.location.href = '/login.html';
            throw new Error('Sessão expirada. Faça login novamente.');
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: response.statusText }));
            const error = new Error(errorData.error || `Erro HTTP ${response.status}`);
            error.status = response.status;
            error.codigo = errorData.codigo;
            error.detalhes = errorData;
            throw error;
        }

        // Se for 204 No Content
        if (response.status === 204) return null;

        return await response.json();
    } catch (error) {
        console.error(`Erro na API (${endpoint}):`, error);
        throw error;
    }
}
