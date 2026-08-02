import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const arquivosPadrao = [
    'api/ponto.js',
    'api/pagamentos.js',
    'api/dashboard.js',
    'api/metas.js',
    'api/pontos-extras.js',
    'api/gincanas.js',
    'api/gincanas-pagamentos.js',
    'api/avisos-popup.js',
];

const arquivos = (process.argv.slice(2).length ? process.argv.slice(2) : arquivosPadrao)
    .map((arquivo) => path.resolve(arquivo));
const metodosHttp = new Set(['get', 'post', 'put', 'patch', 'delete']);
const rotas = [];

for (const arquivo of arquivos) {
    const codigo = fs.readFileSync(arquivo, 'utf8');
    const sourceFile = ts.createSourceFile(
        arquivo,
        codigo,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
    );

    const linhaDo = (node) =>
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

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
                const tabelas = Array.from(
                    corpo.matchAll(
                        /\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi
                    ),
                    (match) => match[1].toLowerCase()
                );

                rotas.push({
                    arquivo: path.relative(process.cwd(), arquivo).replaceAll('\\', '/'),
                    metodo: node.expression.name.text.toUpperCase(),
                    caminho: caminhoNode.text,
                    linha: linhaDo(node),
                    usa_req_empresa_id: /\breq\.empresaId\b/.test(corpo),
                    usa_empresa_id_sql: /\bempresa_id\b/.test(corpo),
                    usa_usuarios_empresas: /\busuarios_empresas\b/.test(corpo),
                    usa_usuario_global:
                        /\bFROM\s+usuarios\b/i.test(corpo)
                        || /\bJOIN\s+usuarios\b/i.test(corpo)
                        || /\bUPDATE\s+usuarios\b/i.test(corpo),
                    tabelas: [...new Set(tabelas)].sort(),
                });
            }
        }

        ts.forEachChild(node, visitar);
    }

    visitar(sourceFile);
}

const porArquivo = Object.groupBy(rotas, (rota) => rota.arquivo);
const resumoArquivos = Object.entries(porArquivo).map(([arquivo, rotasArquivo]) => ({
    arquivo,
    total_rotas: rotasArquivo.length,
    com_req_empresa_id: rotasArquivo.filter((rota) => rota.usa_req_empresa_id).length,
    com_empresa_id_sql: rotasArquivo.filter((rota) => rota.usa_empresa_id_sql).length,
    com_usuarios_empresas: rotasArquivo.filter((rota) => rota.usa_usuarios_empresas).length,
    com_usuario_global: rotasArquivo.filter((rota) => rota.usa_usuario_global).length,
}));

process.stdout.write(JSON.stringify({
    total_arquivos: arquivos.length,
    total_rotas: rotas.length,
    rotas_com_req_empresa_id: rotas.filter((rota) => rota.usa_req_empresa_id).length,
    rotas_sem_req_empresa_id: rotas.filter((rota) => !rota.usa_req_empresa_id).length,
    resumo_arquivos: resumoArquivos,
    rotas_sem_contexto_empresarial: rotas.filter((rota) => !rota.usa_req_empresa_id),
    rotas,
}, null, 2));
