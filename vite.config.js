// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { globSync } from 'glob';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const empresaCarregamentoBootstrap = readFileSync(
  './public/js/utils/empresa-carregamento-bootstrap.js',
  'utf8',
);

// Encontra todos os arquivos .html dentro da pasta public
// e os prepara para o Rollup.
const htmlFiles = globSync('public/**/*.html').reduce((acc, file) => {
    // Ex: 'public/admin/home.html' -> 'admin/home'
    const name = file.replace('public/', '').replace('.html', '');
    acc[name] = resolve(__dirname, file);
    return acc;
}, {});

export default defineConfig({
  // A RAIZ DO NOSSO SITE É A PASTA 'public'.
  // O servidor de desenvolvimento vai rodar a partir daqui.
  root: 'public',

  // Injeta a versão do package.json como constante global em todo o JS/JSX.
  // Usar como: __APP_VERSION__ (string literal em tempo de build)
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  plugins: [
    react(),
    {
      name: 'inline-empresa-carregamento-bootstrap',
      transformIndexHtml(html) {
        return html.replace(
          '<script src="/js/utils/empresa-carregamento-bootstrap.js"></script>',
          `<script>${empresaCarregamentoBootstrap}</script>`,
        );
      },
    },
  ],
  
  server: {
    // A página raiz agora é encontrada automaticamente.
    open: true, // Apenas abre o navegador na raiz.
    proxy: {
      // Como o servidor roda de 'public', a chamada a /api/login será
      // feita a partir de public, mas o proxy a captura corretamente.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  
  build: {
    // O build será gerado na pasta 'dist' NA RAIZ DO PROJETO.
    // '../dist' significa "uma pasta acima da raiz (public), em um diretório chamado dist".
    outDir: '../dist',
    emptyOutDir: true,
    
    rollupOptions: {
      // Passamos todos os nossos HTMLs como pontos de entrada.
      input: htmlFiles,
    },
  },
});
