// index.js
import express from 'express';

// Importar todos os routers
import loginRouter from './login.js';
import usuariosRouter from './usuarios.js';
import cortesRouter from './cortes.js';
import producoesRouter from './producoes.js';
import configuracaoPontosRouter from './configuracao-pontos.js';
import produtosRouter from './produtos.js';
import ordensDeProducaoRouter from './ordens-de-producao.js';
import arrematesRouter from './arremates.js';
import opsParaEmbalagemRouter from './ops-para-embalagem.js';
import estoqueRouter from './estoque.js';
import kitsRouter from './kits.js';
import niveisEstoqueRouter from './niveis-estoque.js'; 
import uploadRouter from './upload.js';
import promessasRouter from './producao-promessas.js';
import embalagensRouter from './embalagens.js';
import dashboardRouter from './dashboard.js';
import inventarioRouter from './inventario.js';
import financeiroRouter from './financeiro.js';
import pagamentosRouter from './pagamentos.js';
import avataresRouter from './avatares.js';
import perfisRouter from './perfis.js'; 
import historicoRouter from './historico.js'; 
import metasRouter from './metas.js';
import realProducaoRouter from './real-producao.js';
import contextoEmpresaRouter, { middlewareContextoEmpresa } from './contexto-empresa.js';
import gestaoOrganizacionalRouter from './gestao-organizacional.js';
import preferenciasMenuRouter from './preferencias-menu.js';

const app = express();

// Middlewares essenciais para a API
app.use(express.json());

// --- Montar os roteadores da API ---
// Note que o caminho agora é relativo à raiz da API
app.use('/login', loginRouter);
app.use(middlewareContextoEmpresa);
app.use('/contexto-empresa', contextoEmpresaRouter);
app.use('/gestao-organizacional', gestaoOrganizacionalRouter);
app.use('/preferencias-menu', preferenciasMenuRouter);
app.use('/usuarios', usuariosRouter);
app.use('/cortes', cortesRouter);
app.use('/producoes', producoesRouter);
app.use('/configuracao-pontos', configuracaoPontosRouter);
app.use('/produtos', produtosRouter);
app.use('/ordens-de-producao', ordensDeProducaoRouter);
app.use('/arremates', arrematesRouter);
app.use('/ops-para-embalagem', opsParaEmbalagemRouter);
app.use('/estoque', estoqueRouter);
app.use('/kits', kitsRouter);
app.use('/niveis-estoque', niveisEstoqueRouter);
app.use('/upload', uploadRouter);
app.use('/producao-promessas', promessasRouter);
app.use('/embalagens', embalagensRouter);
app.use('/dashboard', dashboardRouter);
app.use('/inventario', inventarioRouter)
app.use('/financeiro', financeiroRouter);
app.use('/pagamentos', pagamentosRouter);
app.use('/avatares', avataresRouter);
app.use('/perfis', perfisRouter);
app.use('/historico', historicoRouter);
app.use('/metas', metasRouter);
app.use('/real-producao', realProducaoRouter);

// Exporta o app Express para a Vercel usar como uma única função serverless
export default app;
