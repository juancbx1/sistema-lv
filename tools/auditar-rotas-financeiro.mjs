import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const arquivo = path.resolve(process.argv[2] || 'api/financeiro.js');
const codigo = fs.readFileSync(arquivo, 'utf8');
const sourceFile = ts.createSourceFile(
    arquivo,
    codigo,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
);

const metodosHttp = new Set(['get', 'post', 'put', 'delete']);
const rotas = [];

function linhaDo(node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

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

        if (
            caminhoNode
            && (ts.isStringLiteral(caminhoNode) || ts.isNoSubstitutionTemplateLiteral(caminhoNode))
            && handler
        ) {
            const corpo = handler.getText(sourceFile);
            rotas.push({
                metodo: node.expression.name.text.toUpperCase(),
                caminho: caminhoNode.text,
                linha: linhaDo(node),
                usa_contexto_empresarial: /\breq\.empresaId\b/.test(corpo),
            });
        }
    }

    ts.forEachChild(node, visitar);
}

visitar(sourceFile);

const contagemPorMetodo = rotas.reduce((acc, rota) => {
    acc[rota.metodo] = (acc[rota.metodo] || 0) + 1;
    return acc;
}, {});
const semContextoEmpresarial = rotas.filter((rota) => !rota.usa_contexto_empresarial);
const esperado = {
    total: 50,
    por_metodo: {
        GET: 16,
        POST: 21,
        PUT: 11,
        DELETE: 2,
    },
};
const inventarioConfere = rotas.length === esperado.total
    && Object.entries(esperado.por_metodo).every(
        ([metodo, quantidade]) => contagemPorMetodo[metodo] === quantidade
    );
const aprovado = inventarioConfere && semContextoEmpresarial.length === 0;

process.stdout.write(JSON.stringify({
    arquivo,
    aprovado,
    inventario_confere: inventarioConfere,
    total_rotas: rotas.length,
    contagem_por_metodo: contagemPorMetodo,
    rotas_sem_contexto_empresarial: semContextoEmpresarial,
    rotas,
}, null, 2));

if (!aprovado) {
    process.exitCode = 1;
}
