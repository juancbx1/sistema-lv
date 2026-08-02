import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const arquivos = [
    'api/avisos-popup.js',
    'api/calendario.js',
].map((arquivo) => path.resolve(arquivo));

const tabelasEmpresariais = new Set([
    'avisos_popup',
    'avisos_popup_visualizacoes',
    'calendario_empresa',
]);
const metodosHttp = new Set(['get', 'post', 'put', 'patch', 'delete']);
const rotas = [];
const falhas = [];

function tabelasDaConsulta(sql) {
    return Array.from(
        sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi),
        (match) => match[1].toLowerCase()
    );
}

for (const arquivo of arquivos) {
    const codigo = fs.readFileSync(arquivo, 'utf8');
    const sourceFile = ts.createSourceFile(arquivo, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

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
                    usa_req_empresa_id: /\breq\.empresaId\b/.test(corpo),
                    usa_empresa_id_sql: /\bempresa_id\b/.test(corpo),
                    tabelas,
                };
                rotas.push(rota);
                if (usaTabelaEmpresarial && (!rota.usa_req_empresa_id || !rota.usa_empresa_id_sql)) {
                    falhas.push(rota);
                }
            }
        }
        ts.forEachChild(node, visitar);
    }

    visitar(sourceFile);
}

const aprovado =
    rotas.length === 17
    && falhas.length === 0
    && arquivos.every((arquivo) => fs.existsSync(arquivo));

process.stdout.write(`${JSON.stringify({
    aprovado,
    total_rotas: rotas.length,
    rotas_sem_contexto: rotas.filter((rota) => !rota.usa_req_empresa_id),
    rotas_com_tabela_empresarial_sem_empresa: falhas,
}, null, 2)}\n`);

if (!aprovado) process.exitCode = 1;
