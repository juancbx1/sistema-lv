import 'dotenv/config';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
});

const SECRET_KEY = process.env.JWT_SECRET;
const router = express.Router();

const MODULOS_POR_PREFIXO = [
    ['/configuracao-pontos', 'permissoes'],
    ['/gincanas-pagamentos', 'incentivos'],
    ['/gerenciar-producao', 'gerenciar-producao'],
    ['/ops-para-embalagem', 'embalagem'],
    ['/ordens-de-producao', 'ordens-producao'],
    ['/producao-promessas', 'ordens-producao'],
    ['/central-pagamentos', 'central-pagamentos'],
    ['/pontos-extras', 'producao-geral'],
    ['/real-producao', 'producao-geral'],
    ['/avisos-popup', 'alertas'],
    ['/audit-log', 'permissoes'],
    ['/niveis-estoque', 'estoque'],
    ['/embalagens', 'embalagem'],
    ['/financeiro', 'financeiro'],
    ['/pagamentos', 'central-pagamentos'],
    ['/inventario', 'inventario'],
    ['/calendario', 'calendario'],
    ['/dashboard', 'dashboard'],
    ['/arremates', 'arremates'],
    ['/producoes', 'gerenciar-producao'],
    ['/producao', 'gerenciar-producao'],
    ['/produtos', 'produtos'],
    ['/gestao-organizacional', 'gestao-organizacional'],
    ['/usuarios', 'gestao-organizacional'],
    ['/perfis', 'gestao-organizacional'],
    ['/avatares', 'gestao-organizacional'],
    ['/cortes', 'cortes'],
    ['/estoque', 'estoque'],
    ['/kits', 'produtos'],
    ['/metas', 'incentivos'],
    ['/gincanas', 'incentivos'],
    ['/alertas', 'alertas'],
    ['/demandas', 'ordens-producao'],
    ['/ponto', 'dashboard'],
    ['/historico', 'producao-geral'],
    ['/configuracoes', 'home-admin'],
];

const ROTAS_PUBLICAS_SEM_CONTEXTO = [
    '/login',
    '/cron',
    '/ping',
];

const ROTAS_SEM_BLOQUEIO_MODULO = [
    '/contexto-empresa',
];

const ROTAS_USUARIO_SEM_BLOQUEIO_MODULO = [
    '/usuarios/me',
];

function erroHttp(statusCode, codigo, mensagem) {
    const error = new Error(mensagem);
    error.statusCode = statusCode;
    error.codigo = codigo;
    return error;
}

export function extrairTokenBearer(req) {
    const authorization = req.headers.authorization;
    if (!authorization) return null;

    const [tipo, token, ...restante] = authorization.trim().split(/\s+/);
    if (tipo?.toLowerCase() !== 'bearer' || !token || restante.length > 0) {
        throw erroHttp(401, 'TOKEN_INVALIDO', 'Cabeçalho de autenticação inválido.');
    }

    return token;
}

export function normalizarEmpresaId(valor) {
    if (valor === undefined || valor === null || valor === '') return null;
    const numero = Number(valor);
    if (!Number.isSafeInteger(numero) || numero <= 0) {
        throw erroHttp(400, 'EMPRESA_INVALIDA', 'A empresa informada é inválida.');
    }
    return numero;
}

function caminhoDaApi(req) {
    const original = String(req.originalUrl || req.url || '/').split('?')[0];
    const semApi = original.startsWith('/api/') ? original.slice(4) : original;
    return semApi.startsWith('/') ? semApi : `/${semApi}`;
}

function correspondeRota(caminho, rota) {
    return caminho === rota || caminho.startsWith(`${rota}/`);
}

export function rotaDispensaContexto(req) {
    const caminho = caminhoDaApi(req);
    return ROTAS_PUBLICAS_SEM_CONTEXTO.some((rota) => correspondeRota(caminho, rota));
}

export function resolverModuloDaRequisicao(req) {
    const caminho = caminhoDaApi(req);

    if (
        ROTAS_PUBLICAS_SEM_CONTEXTO.some((rota) => correspondeRota(caminho, rota))
        || ROTAS_SEM_BLOQUEIO_MODULO.some((rota) => correspondeRota(caminho, rota))
    ) {
        return null;
    }

    if (
        ROTAS_USUARIO_SEM_BLOQUEIO_MODULO.some(
            (rota) => correspondeRota(caminho, rota)
        )
    ) {
        return null;
    }

    return MODULOS_POR_PREFIXO.find(
        ([prefixo]) => caminho === prefixo || caminho.startsWith(`${prefixo}/`)
    )?.[1] || '__rota_nao_mapeada__';
}

async function buscarIdentidade(dbClient, usuarioId) {
    const result = await dbClient.query(
        `
            SELECT
                u.id,
                u.nome,
                u.nome_usuario,
                COALESCE(u.arquivado, FALSE) AS arquivado,
                COALESCE(uag.superadministrador, FALSE) AS superadministrador,
                COALESCE(uag.permissoes, '{}'::text[]) AS permissoes_globais
            FROM usuarios u
            LEFT JOIN usuarios_acessos_globais uag
              ON uag.usuario_id = u.id
            WHERE u.id = $1
        `,
        [usuarioId]
    );

    const identidade = result.rows[0];
    if (!identidade) {
        throw erroHttp(401, 'USUARIO_NAO_ENCONTRADO', 'Usuário do token não foi encontrado.');
    }
    if (identidade.arquivado) {
        throw erroHttp(403, 'IDENTIDADE_INATIVA', 'Esta identidade de usuário está inativa.');
    }
    return identidade;
}

async function buscarEmpresaEValidaVinculo(
    dbClient,
    identidade,
    empresaIdSolicitada
) {
    let result;

    if (empresaIdSolicitada) {
        result = await dbClient.query(
            `
                SELECT
                    e.id,
                    e.codigo,
                    e.razao_social,
                    e.nome_fantasia,
                    e.logo_url,
                    e.cor_identificacao,
                    e.timezone,
                    e.ativa,
                    e.eh_legada,
                    ue.id AS vinculo_id,
                    ue.tipos,
                    ue.permissoes,
                    ue.nivel,
                    ue.ativo AS vinculo_ativo,
                    ue.empresa_principal
                FROM empresas e
                LEFT JOIN usuarios_empresas ue
                  ON ue.empresa_id = e.id
                 AND ue.usuario_id = $1
                WHERE e.id = $2
            `,
            [identidade.id, empresaIdSolicitada]
        );
    } else {
        result = await dbClient.query(
            `
                SELECT
                    e.id,
                    e.codigo,
                    e.razao_social,
                    e.nome_fantasia,
                    e.logo_url,
                    e.cor_identificacao,
                    e.timezone,
                    e.ativa,
                    e.eh_legada,
                    ue.id AS vinculo_id,
                    ue.tipos,
                    ue.permissoes,
                    ue.nivel,
                    ue.ativo AS vinculo_ativo,
                    ue.empresa_principal
                FROM usuarios_empresas ue
                JOIN empresas e ON e.id = ue.empresa_id
                WHERE ue.usuario_id = $1
                  AND ue.ativo
                  AND e.ativa
                ORDER BY ue.empresa_principal DESC, e.eh_legada DESC, e.nome_fantasia
                LIMIT 1
            `,
            [identidade.id]
        );

        if (result.rows.length === 0 && identidade.superadministrador) {
            result = await dbClient.query(
                `
                    SELECT
                        e.id,
                        e.codigo,
                        e.razao_social,
                        e.nome_fantasia,
                        e.logo_url,
                        e.cor_identificacao,
                        e.timezone,
                        e.ativa,
                        e.eh_legada,
                        NULL::integer AS vinculo_id,
                        '{}'::text[] AS tipos,
                        '{}'::text[] AS permissoes,
                        NULL::integer AS nivel,
                        NULL::boolean AS vinculo_ativo,
                        FALSE AS empresa_principal
                    FROM empresas e
                    WHERE e.ativa
                    ORDER BY e.eh_legada DESC, e.nome_fantasia
                    LIMIT 1
                `
            );
        }
    }

    const contexto = result.rows[0];
    const vinculoAtivo = contexto?.vinculo_id && contexto?.vinculo_ativo;
    if (
        !contexto
        || !contexto.ativa
        || (!vinculoAtivo && !identidade.superadministrador)
    ) {
        throw erroHttp(
            403,
            'EMPRESA_NAO_AUTORIZADA',
            'Você não possui vínculo ativo com esta empresa.'
        );
    }

    return contexto;
}

async function validarModuloDaEmpresa(dbClient, empresa, moduloCodigo) {
    if (!moduloCodigo || empresa.eh_legada) {
        return {
            codigo: moduloCodigo,
            habilitado: true,
            multiempresa_pronto: Boolean(empresa.eh_legada),
            liberacao_transitoria_legada: Boolean(empresa.eh_legada),
        };
    }

    const result = await dbClient.query(
        `
            SELECT
                ms.codigo,
                ms.nome,
                ms.multiempresa_pronto,
                COALESCE(em.habilitado, FALSE) AS habilitado
            FROM modulos_sistema ms
            LEFT JOIN empresas_modulos em
              ON em.modulo_codigo = ms.codigo
             AND em.empresa_id = $1
            WHERE ms.codigo = $2
        `,
        [empresa.id, moduloCodigo]
    );

    const modulo = result.rows[0];
    if (!modulo?.multiempresa_pronto || !modulo?.habilitado) {
        throw erroHttp(
            403,
            'MODULO_NAO_DISPONIVEL_EMPRESA',
            'Este módulo ainda não está disponível para a empresa ativa.'
        );
    }

    return modulo;
}

export async function carregarContextoEmpresa(
    dbClient,
    tokenClaims,
    { empresaId = tokenClaims.empresa_id, moduloCodigo = null } = {}
) {
    const usuarioId = Number(tokenClaims.id);
    if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) {
        throw erroHttp(401, 'TOKEN_INVALIDO', 'O token não identifica um usuário válido.');
    }

    const empresaIdNormalizada = normalizarEmpresaId(empresaId);
    const identidade = await buscarIdentidade(dbClient, usuarioId);
    const empresa = await buscarEmpresaEValidaVinculo(
        dbClient,
        identidade,
        empresaIdNormalizada
    );
    const modulo = await validarModuloDaEmpresa(dbClient, empresa, moduloCodigo);

    return {
        identidade,
        empresa,
        vinculo: empresa.vinculo_id
            ? {
                id: empresa.vinculo_id,
                usuario_id: identidade.id,
                empresa_id: empresa.id,
                tipos: empresa.tipos || [],
                permissoes: empresa.permissoes || [],
                nivel: empresa.nivel,
                ativo: empresa.vinculo_ativo,
                empresa_principal: empresa.empresa_principal,
            }
            : null,
        modulo,
        tokenLegado: !tokenClaims.empresa_id,
    };
}

export async function middlewareContextoEmpresa(req, res, next) {
    let dbClient;

    try {
        if (rotaDispensaContexto(req)) return next();
        const token = extrairTokenBearer(req);
        if (!token) return next();
        if (!SECRET_KEY) {
            throw erroHttp(500, 'JWT_NAO_CONFIGURADO', 'JWT_SECRET não está configurado.');
        }

        let tokenClaims;
        try {
            tokenClaims = jwt.verify(token, SECRET_KEY);
        } catch (error) {
            const tokenError = erroHttp(401, 'TOKEN_INVALIDO', 'Token inválido ou expirado.');
            if (error.name === 'TokenExpiredError') tokenError.codigo = 'TOKEN_EXPIRADO';
            throw tokenError;
        }

        dbClient = await pool.connect();
        const moduloCodigo = resolverModuloDaRequisicao(req);
        const contexto = await carregarContextoEmpresa(dbClient, tokenClaims, {
            moduloCodigo,
        });

        req.usuarioTokenClaims = tokenClaims;
        req.usuarioLogado = {
            ...tokenClaims,
            id: contexto.identidade.id,
            nome: contexto.identidade.nome,
            nome_usuario: contexto.identidade.nome_usuario,
            empresa_id: contexto.empresa.id,
            vinculo_empresa_id: contexto.vinculo?.id || null,
            superadministrador: contexto.identidade.superadministrador,
        };
        req.empresaId = contexto.empresa.id;
        req.empresaAtiva = {
            id: contexto.empresa.id,
            codigo: contexto.empresa.codigo,
            razao_social: contexto.empresa.razao_social,
            nome_fantasia: contexto.empresa.nome_fantasia,
            logo_url: contexto.empresa.logo_url,
            cor_identificacao: contexto.empresa.cor_identificacao,
            timezone: contexto.empresa.timezone,
            eh_legada: contexto.empresa.eh_legada,
        };
        req.vinculoEmpresa = contexto.vinculo;
        req.superadministrador = contexto.identidade.superadministrador;
        req.contextoEmpresaTokenLegado = contexto.tokenLegado;
        req.moduloEmpresa = contexto.modulo;

        next();
    } catch (error) {
        console.error('[contexto-empresa middleware]', error);
        res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao validar o contexto empresarial.',
            codigo: error.codigo || 'ERRO_CONTEXTO_EMPRESA',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
}

export function obterEmpresaIdDoContexto(req) {
    const empresaId = normalizarEmpresaId(req.empresaId);
    if (!empresaId) {
        throw erroHttp(
            500,
            'CONTEXTO_EMPRESA_AUSENTE',
            'O contexto empresarial não foi carregado para esta requisição.'
        );
    }
    return empresaId;
}

export function validarEmpresaDoRecurso(req, empresaIdDoRecurso) {
    const empresaId = obterEmpresaIdDoContexto(req);
    const empresaRecurso = normalizarEmpresaId(empresaIdDoRecurso);
    if (empresaRecurso !== empresaId) {
        throw erroHttp(
            404,
            'RECURSO_NAO_ENCONTRADO',
            'O recurso não foi encontrado na empresa ativa.'
        );
    }
    return empresaId;
}

async function listarEmpresasDisponiveis(dbClient, usuarioId, superadministrador) {
    const result = await dbClient.query(
        superadministrador
            ? `
                SELECT
                    e.id,
                    e.codigo,
                    e.nome_fantasia,
                    e.razao_social,
                    e.logo_url,
                    e.cor_identificacao,
                    e.eh_legada,
                    COALESCE(ue.empresa_principal, FALSE) AS empresa_principal,
                    ue.id AS vinculo_id
                FROM empresas e
                LEFT JOIN usuarios_empresas ue
                  ON ue.empresa_id = e.id
                 AND ue.usuario_id = $1
                 AND ue.ativo
                WHERE e.ativa
                ORDER BY ue.empresa_principal DESC NULLS LAST, e.eh_legada DESC, e.nome_fantasia
            `
            : `
                SELECT
                    e.id,
                    e.codigo,
                    e.nome_fantasia,
                    e.razao_social,
                    e.logo_url,
                    e.cor_identificacao,
                    e.eh_legada,
                    ue.empresa_principal,
                    ue.id AS vinculo_id
                FROM usuarios_empresas ue
                JOIN empresas e ON e.id = ue.empresa_id
                WHERE ue.usuario_id = $1
                  AND ue.ativo
                  AND e.ativa
                ORDER BY ue.empresa_principal DESC, e.eh_legada DESC, e.nome_fantasia
            `,
        [usuarioId]
    );

    return result.rows;
}

function exigirContexto(req) {
    if (!req.usuarioTokenClaims || !req.empresaId) {
        throw erroHttp(401, 'AUTENTICACAO_OBRIGATORIA', 'Autenticação obrigatória.');
    }
}

function emitirTokenParaContexto(tokenClaims, contexto) {
    const agora = Math.floor(Date.now() / 1000);
    // Tokens sem exp pertencem a uma compatibilidade legada. A nova sessão
    // contextual deve seguir a política atual de 30 dias, sem reintroduzir o
    // antigo prazo de 8 horas durante a troca de empresa.
    const segundosRestantes = tokenClaims.exp
        ? Math.max(Number(tokenClaims.exp) - agora, 1)
        : 30 * 24 * 60 * 60;
    const {
        iat,
        exp,
        nbf,
        jti,
        empresa_id,
        vinculo_empresa_id,
        superadministrador,
        tipos,
        ...claimsPreservadas
    } = tokenClaims;

    return jwt.sign(
        {
            ...claimsPreservadas,
            id: contexto.identidade.id,
            nome: contexto.identidade.nome,
            nome_usuario: contexto.identidade.nome_usuario,
            tipos: contexto.vinculo?.tipos || [],
            empresa_id: contexto.empresa.id,
            vinculo_empresa_id: contexto.vinculo?.id || null,
            superadministrador: contexto.identidade.superadministrador,
        },
        SECRET_KEY,
        { expiresIn: segundosRestantes }
    );
}

router.get('/', async (req, res) => {
    let dbClient;
    try {
        exigirContexto(req);
        dbClient = await pool.connect();
        const empresas = await listarEmpresasDisponiveis(
            dbClient,
            req.usuarioLogado.id,
            req.superadministrador
        );

        res.status(200).json({
            empresaAtiva: req.empresaAtiva,
            vinculoEmpresa: req.vinculoEmpresa,
            superadministrador: req.superadministrador,
            tokenLegado: req.contextoEmpresaTokenLegado,
            empresas,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao consultar o contexto empresarial.',
            codigo: error.codigo || 'ERRO_CONTEXTO_EMPRESA',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

router.post('/trocar', async (req, res) => {
    let dbClient;
    try {
        exigirContexto(req);
        const empresaId = normalizarEmpresaId(req.body?.empresaId ?? req.body?.empresa_id);
        if (!empresaId) {
            throw erroHttp(400, 'EMPRESA_OBRIGATORIA', 'Informe a empresa desejada.');
        }

        dbClient = await pool.connect();
        const contexto = await carregarContextoEmpresa(
            dbClient,
            req.usuarioTokenClaims,
            { empresaId }
        );
        const token = emitirTokenParaContexto(req.usuarioTokenClaims, contexto);

        res.status(200).json({
            token,
            empresaAtiva: {
                id: contexto.empresa.id,
                codigo: contexto.empresa.codigo,
                razao_social: contexto.empresa.razao_social,
                nome_fantasia: contexto.empresa.nome_fantasia,
                logo_url: contexto.empresa.logo_url,
                cor_identificacao: contexto.empresa.cor_identificacao,
                timezone: contexto.empresa.timezone,
                eh_legada: contexto.empresa.eh_legada,
            },
            vinculoEmpresa: contexto.vinculo,
            recarregar: true,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            error: error.message || 'Erro ao trocar a empresa ativa.',
            codigo: error.codigo || 'ERRO_TROCA_EMPRESA',
        });
    } finally {
        if (dbClient) dbClient.release();
    }
});

export default router;
