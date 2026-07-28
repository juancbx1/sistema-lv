import assert from 'node:assert/strict';
import {
    extrairTokenBearer,
    normalizarEmpresaId,
    obterEmpresaIdDoContexto,
    middlewareContextoEmpresa,
    resolverModuloDaRequisicao,
    rotaDispensaContexto,
    validarEmpresaDoRecurso,
} from '../api/contexto-empresa.js';

function req(url, authorization) {
    return {
        originalUrl: url,
        headers: authorization ? { authorization } : {},
    };
}

assert.equal(normalizarEmpresaId(1), 1);
assert.equal(normalizarEmpresaId('42'), 42);
assert.equal(normalizarEmpresaId(null), null);
assert.throws(() => normalizarEmpresaId(0), { codigo: 'EMPRESA_INVALIDA' });
assert.throws(() => normalizarEmpresaId('1.5'), { codigo: 'EMPRESA_INVALIDA' });
assert.throws(() => normalizarEmpresaId('abc'), { codigo: 'EMPRESA_INVALIDA' });

assert.equal(extrairTokenBearer(req('/', 'Bearer abc')), 'abc');
assert.equal(extrairTokenBearer(req('/')), null);
assert.throws(
    () => extrairTokenBearer(req('/', 'Basic abc')),
    { codigo: 'TOKEN_INVALIDO' }
);

assert.equal(rotaDispensaContexto(req('/api/login')), true);
assert.equal(rotaDispensaContexto(req('/api/cron/registrar-intervalos')), true);
assert.equal(rotaDispensaContexto(req('/api/financeiro')), false);

let cronSeguiu = false;
await middlewareContextoEmpresa(
    req('/api/cron/registrar-intervalos', 'Bearer segredo-do-cron'),
    {
        status() {
            throw new Error('A rota cron não deveria receber resposta do contexto empresarial.');
        },
    },
    () => {
        cronSeguiu = true;
    }
);
assert.equal(cronSeguiu, true);

assert.equal(resolverModuloDaRequisicao(req('/api/financeiro/lancamentos')), 'financeiro');
assert.equal(resolverModuloDaRequisicao(req('/api/ordens-de-producao/123')), 'ordens-producao');
assert.equal(resolverModuloDaRequisicao(req('/api/usuarios/me')), null);
assert.equal(resolverModuloDaRequisicao(req('/api/contexto-empresa')), null);
assert.equal(
    resolverModuloDaRequisicao(req('/api/rota-futura')),
    '__rota_nao_mapeada__'
);

assert.equal(obterEmpresaIdDoContexto({ empresaId: 7 }), 7);
assert.throws(
    () => obterEmpresaIdDoContexto({}),
    { codigo: 'CONTEXTO_EMPRESA_AUSENTE' }
);
assert.equal(validarEmpresaDoRecurso({ empresaId: 7 }, 7), 7);
assert.throws(
    () => validarEmpresaDoRecurso({ empresaId: 7 }, 8),
    { statusCode: 404, codigo: 'RECURSO_NAO_ENCONTRADO' }
);

console.log(JSON.stringify({
    passed: true,
    checks: 23,
}));
