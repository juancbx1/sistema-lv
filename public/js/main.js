// js/main.js
import { logout } from './utils/auth.js';

document.addEventListener('DOMContentLoaded', () => {
    const caminhoPagina = window.location.pathname;
    console.log('Caminho da página:', caminhoPagina); // Depuração

    // Mapeamento dos caminhos das páginas para os scripts correspondentes
    const pageScripts = {
        '/index.html': '/js/pages/login.js',
        '/costureira/assinar-producao.html': '/js/pages/costureira-assinar-producao.js',
        // '/admin/cadastrar-usuario.html': '/js/pages/admin-cadastrar-usuario.js',
        '/admin/usuarios-cadastrados.html': '/js/pages/admin-usuarios-cadastrados.js',
        '/admin/cadastrar-produto.html': '/js/pages/admin-cadastrar-produto.js',
        '/admin/producao-diaria.html': '/js/pages/admin-producao-diaria.js',
        '/costureira/dashboard.html': '/js/pages/costureira-dashboard.js',
        '/admin/embalagem-de-produtos.html': '/js/pages/admin-embalagem-de-produtos.js', // Ajustado para o caminho correto
        '/admin/ponto-por-processo.html': '/js/pages/admin-ponto-por-processo.js', // Mantido como está
    };

    // Normalizar o caminho removendo possíveis prefixos ou ajustando para o ambiente
    let caminhoNormalizado = caminhoPagina;
    if (caminhoPagina.includes('/costureira-system')) {
        caminhoNormalizado = caminhoPagina.replace('/costureira-system', '');
    }

    // Adicionar uma verificação para caminhos relativos (ex.: /admin/embalagem-de-produtos.html)
    let scriptPath = pageScripts[caminhoNormalizado];
    if (!scriptPath) {
        // Tenta encontrar o caminho com base no último segmento do URL
        const ultimoSegmento = '/' + caminhoNormalizado.split('/').pop();
        scriptPath = pageScripts[ultimoSegmento];
        console.log('Tentando último segmento:', ultimoSegmento);
    }

    // Se ainda não encontrou, tenta com o prefixo /admin/
    if (!scriptPath) {
        const caminhoComAdmin = '/admin' + caminhoNormalizado;
        scriptPath = pageScripts[caminhoComAdmin];
        console.log('Tentando com prefixo /admin:', caminhoComAdmin);
    }

    // Usa o script padrão se ainda não encontrar
    scriptPath = scriptPath || pageScripts['/index.html'];

    // Normalizar o caminho do script para comparação
    const normalizePath = (path) => {
        return path.startsWith('/') ? path : `/${path}`.replace(/\/\.\.\//g, '/').replace(/\/+/g, '/');
    };

    // Verifica se o script já está no HTML
    const scriptsExistentes = document.querySelectorAll('script[src]');
    const scriptJaCarregado = Array.from(scriptsExistentes).some(script => {
        const srcNormalizado = normalizePath(script.getAttribute('src'));
        const scriptPathNormalizado = normalizePath(scriptPath);
        return srcNormalizado === scriptPathNormalizado || srcNormalizado.endsWith(scriptPathNormalizado);
    });

    if (scriptJaCarregado) {
        console.log(`Script ${scriptPath} já está no HTML (normalizado), ignorando carregamento dinâmico.`);
        return;
    }

    if (scriptPath) {
        console.log('Carregando script:', scriptPath);
        const script = document.createElement('script');
        script.src = scriptPath;
        script.type = 'module'; // Garante que o script seja carregado como módulo
        script.async = true;
        script.onload = () => console.log(`${scriptPath} carregado com sucesso`);
        script.onerror = () => console.error(`Erro ao carregar ${scriptPath}`);
        document.body.appendChild(script);
    } else {
        console.warn('Nenhum script encontrado para o caminho:', caminhoPagina);
    }
});

window.logout = logout;