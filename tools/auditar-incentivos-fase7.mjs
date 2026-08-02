import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const arquivos = [
    'api/metas.js',
    'api/pontos-extras.js',
    'api/configuracao-pontos.js',
    'api/gincanas.js',
    'api/gincanas-pagamentos.js',
].map((arquivo) => path.resolve(arquivo));

const tabelasEmpresariais = new Set([
    'metas_versoes',
    'metas_regras',
    'pontos_extras',
    'configuracoes_pontos_processos',
    'gincanas',
    'gincanas_premiacoes',
    'gincanas_premios_ganhos',
]);
const metodosHttp = new Set(['get', 'post', 'put', 'patch', 'delete']);
const rotas = [];
const consultasSemEmpresa = [];
const falhasArquivo = [];

function linhaDo(sourceFile, node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function tabelasDaConsulta(sql) {
    return Array.from(
        sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi),
        (match) => match[1].toLowerCase()
    );
}

for (const arquivo of arquivos) {
    const codigo = fs.readFileSync(arquivo, 'utf8');
    const sourceFile = ts.createSourceFile(
        arquivo,
        codigo,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
    );

    function visitar(node) {
        if (
            ts.isCallExpression(node)
            && ts.isPropertyAccessExpression(node.expression)
            && ts.isIdentifier(node.expression.expression)
            && node.expression.expression.text === 'router'
            && metodosHttp.has(node.expression.name.text)
        ) {
            const [caminhoNode, ...handlers] = node.arguments;
            const handler = handlers.find(
                (argumento) => ts.isArrowFunction(argumento) || ts.isFunctionExpression(argumento)
            );

            if (caminhoNode && handler && ts.isStringLiteral(caminhoNode)) {
                const corpo = handler.getText(sourceFile);
                const tabelas = [...new Set(tabelasDaConsulta(corpo))];
                const usaTabelaEmpresarial = tabelas.some((tabela) => tabelasEmpresariais.has(tabela));
                const rota = {
                    arquivo: path.relative(process.cwd(), arquivo).replaceAll('\\', '/'),
                    metodo: node.expression.name.text.toUpperCase(),
                    caminho: caminhoNode.text,
                    linha: linhaDo(sourceFile, node),
                    usa_req_empresa_id: /\breq\.empresaId\b/.test(corpo),
                    usa_empresa_id_sql: /\bempresa_id\b/.test(corpo),
                    tabelas,
                };
                rotas.push(rota);

                if (usaTabelaEmpresarial && (!rota.usa_req_empresa_id || !rota.usa_empresa_id_sql)) {
                    falhasArquivo.push(rota);
                }

                for (const match of corpo.matchAll(/`([\s\S]*?)`/g)) {
                    const sql = match[1];
                    if (
                        tabelasDaConsulta(sql).some((tabela) => tabelasEmpresariais.has(tabela))
                        && /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(sql)
                        && !/\bempresa_id\b/i.test(sql)
                    ) {
                        consultasSemEmpresa.push({
                            arquivo: rota.arquivo,
                            metodo: rota.metodo,
                            caminho: rota.caminho,
                            linha: rota.linha,
                            sql: sql.replace(/\s+/g, ' ').trim().slice(0, 220),
                        });
                    }
                }
            }
        }
        ts.forEachChild(node, visitar);
    }

    visitar(sourceFile);
}

const arquivosObrigatorios = [
    'api/metas.js',
    'api/pontos-extras.js',
    'api/configuracao-pontos.js',
    'api/gincanas.js',
    'api/gincanas-pagamentos.js',
];
const rotasSemContexto = rotas.filter((rota) => !rota.usa_req_empresa_id);
const hooksSemContrato = [];
const codigoGincanas = fs.readFileSync(path.resolve('api/gincanas.js'), 'utf8');
if (!/function exigirCadeiaProdutivaLegada/.test(codigoGincanas)) {
    hooksSemContrato.push('api/gincanas.js: trava de cadeia produtiva legada ausente');
}
if (!/verificarGincanasAposProducao\([^)]*empresaId/.test(codigoGincanas)) {
    hooksSemContrato.push('api/gincanas.js: hook pós-produção sem empresaId');
}

const aprovado =
    rotas.length === 28
    && arquivosObrigatorios.every((arquivo) => fs.existsSync(path.resolve(arquivo)))
    && rotasSemContexto.length === 0
    && consultasSemEmpresa.length === 0
    && falhasArquivo.length === 0
    && hooksSemContrato.length === 0;

process.stdout.write(`${JSON.stringify({
    aprovado,
    total_rotas: rotas.length,
    rotas_sem_contexto: rotasSemContexto,
    consultas_sem_empresa_id: consultasSemEmpresa,
    falhas_por_rota: falhasArquivo,
    contratos_ausentes: hooksSemContrato,
    resumo: Object.groupBy(rotas, (rota) => rota.arquivo),
}, null, 2)}\n`);

if (!aprovado) process.exitCode = 1;
