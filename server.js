// server.js
process.env.TZ = 'UTC';
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';

// Importar todos os routers
import loginRouter from './api/login.js';
import usuariosRouter from './api/usuarios.js';
import cortesRouter from './api/cortes.js';
import producoesRouter from './api/producoes.js';
import configuracaoPontosRouter from './api/configuracao-pontos.js';
import produtosRouter from './api/produtos.js';
import ordensDeProducaoRouter from './api/ordens-de-producao.js';
import arrematesRouter from './api/arremates.js';
import opsParaEmbalagemRouter from './api/ops-para-embalagem.js';
import estoqueRouter from './api/estoque.js';
import kitsRouter from './api/kits.js';
import niveisEstoqueRouter from './api/niveis-estoque.js'; 
import uploadRouter from './api/upload.js';
import promessasRouter from './api/producao-promessas.js';
import embalagensRouter from './api/embalagens.js';
import dashboardRouter from './api/dashboard.js';
import inventarioRouter from './api/inventario.js';
import financeiroRouter from './api/financeiro.js';
import pagamentosRouter from './api/pagamentos.js';
import avataresRouter from './api/avatares.js';
import perfisRouter from './api/perfis.js'; 
import historicoRouter from './api/historico.js'; 
import metasRouter from './api/metas.js';
import realProducaoRouter from './api/real-producao.js';
import configuracoesRouter from './api/configuracoes.js';
import alertasRouter from './api/alertas.js';
import demandasRouter from './api/demandas.js';
import producaoRouter from './api/producao.js';
import pontoRouter from './api/ponto.js';
import calendarioRouter from './api/calendario.js';
import cronRoutes from './api/cron.js';
import pontosExtrasRouter from './api/pontos-extras.js';
import avisosPopupRouter from './api/avisos-popup.js';
import gincanasRouter from './api/gincanas.js';
import gincanasPagamentosRouter from './api/gincanas-pagamentos.js';
import auditLogRouter from './api/audit-log.js';
import gerenciarProducaoRouter from './api/gerenciar-producao.js';


const app = express();
console.log('Aplicação Express inicializada.');
const PORT = process.env.PORT || 3000;

// Middlewares globais
app.use(express.json());
console.log('Middleware express.json configurado.');

// Servimos 'public' para o desenvolvimento local com `node server.js` continuar funcionando
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static('public'));
}

// Checagem se os routers foram carregados
const routers = {
    loginRouter,
    usuariosRouter,
    cortesRouter,
    producoesRouter,
    configuracaoPontosRouter,
    produtosRouter,
    ordensDeProducaoRouter,
    arrematesRouter,
    opsParaEmbalagemRouter,
    estoqueRouter,
    kitsRouter,
    niveisEstoqueRouter,
    embalagensRouter,
    dashboardRouter,
    inventarioRouter,
    financeiroRouter,
    pagamentosRouter,
    avataresRouter,
    perfisRouter,
    historicoRouter,
    metasRouter,
    realProducaoRouter,
    configuracoesRouter,
    alertasRouter,
    demandasRouter,
    producaoRouter,
    gerenciarProducaoRouter,
};
for (const routerName in routers) {
    if (!routers[routerName] || typeof routers[routerName] !== 'function') {
        console.error(`ERRO FATAL: ${routerName} não foi carregado corretamente ou não é uma função router válida! Valor:`, routers[routerName]);
    }
}

// --- Montar os roteadores da API ---
app.use('/api/login', loginRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/cortes', cortesRouter);
app.use('/api/producoes', producoesRouter);
app.use('/api/configuracao-pontos', configuracaoPontosRouter);
app.use('/api/produtos', produtosRouter);
app.use('/api/ordens-de-producao', ordensDeProducaoRouter);
app.use('/api/arremates', arrematesRouter);
app.use('/api/ops-para-embalagem', opsParaEmbalagemRouter);
app.use('/api/estoque', estoqueRouter);
app.use('/api/kits', kitsRouter);
app.use('/api/niveis-estoque', niveisEstoqueRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/producao-promessas', promessasRouter);
app.use('/api/embalagens', embalagensRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/inventario', inventarioRouter)
app.use('/api/financeiro', financeiroRouter);
app.use('/api/pagamentos', pagamentosRouter);
app.use('/api/avatares', avataresRouter);
app.use('/api/perfis', perfisRouter);
app.use('/api/historico', historicoRouter);
app.use('/api/metas', metasRouter);
app.use('/api/real-producao', realProducaoRouter);
app.use('/api/configuracoes', configuracoesRouter);
app.use('/api/alertas', alertasRouter);
app.use('/api/demandas', demandasRouter);
app.use('/api/producao', producaoRouter);
app.use('/api/ponto', pontoRouter);
app.use('/api/calendario', calendarioRouter);
app.use('/api/cron', cronRoutes);
app.use('/api/pontos-extras', pontosExtrasRouter);
app.use('/api/avisos-popup', avisosPopupRouter);
app.use('/api/gincanas', gincanasRouter);
app.use('/api/gincanas-pagamentos', gincanasPagamentosRouter);
app.use('/api/audit-log', auditLogRouter);
app.use('/api/gerenciar-producao', gerenciarProducaoRouter);


app.get('/api/ping', (req, res) => res.status(200).json({ message: 'pong do server.js' }));
console.log("Rota /api/ping configurada.");


app.use((err, req, res, next) => {
    console.error("[server.js] Erro não tratado:", err.stack || err.message || err);
    if (!res.headersSent) {
        res.status(err.statusCode || 500).json({
            error: "Erro interno do servidor",
            message: err.message || "Ocorreu um erro inesperado."
        });
    }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
export default app;