import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const arquivos = process.argv.slice(2);
if (arquivos.length === 0) {
    console.error('Uso: node tools/auditar-parametros-sql.mjs <arquivo.js> [...]');
    process.exit(2);
}

function textoSql(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return node.text;
    }
    if (ts.isTemplateExpression(node)) return null;
    return null;
}

function linhaDo(sourceFile, node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

const divergencias = [];
const revisaoManual = [];
let totalConsultasEstaticas = 0;

for (const arquivoInformado of arquivos) {
    const arquivo = path.resolve(arquivoInformado);
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
            && node.expression.name.text === 'query'
            && node.arguments.length >= 2
        ) {
            const sql = textoSql(node.arguments[0]);
            const parametros = node.arguments[1];

            if (sql !== null && ts.isArrayLiteralExpression(parametros)) {
                totalConsultasEstaticas += 1;
                const indices = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
                const maiorIndice = indices.length > 0 ? Math.max(...indices) : 0;
                const possuiSpread = parametros.elements.some(ts.isSpreadElement);

                if (possuiSpread) {
                    revisaoManual.push({
                        arquivo,
                        linha: linhaDo(sourceFile, node),
                        motivo: 'array de parâmetros contém spread',
                    });
                } else if (maiorIndice !== parametros.elements.length) {
                    divergencias.push({
                        arquivo,
                        linha: linhaDo(sourceFile, node),
                        maior_placeholder: maiorIndice,
                        parametros_informados: parametros.elements.length,
                        trecho: sql.replace(/\s+/g, ' ').trim().slice(0, 180),
                    });
                }
            }
        }
        ts.forEachChild(node, visitar);
    }

    visitar(sourceFile);
}

const resultado = {
    aprovado: divergencias.length === 0,
    arquivos: arquivos.map((arquivo) => path.resolve(arquivo)),
    consultas_estaticas_auditadas: totalConsultasEstaticas,
    divergencias,
    revisao_manual: revisaoManual,
};

console.log(JSON.stringify(resultado, null, 2));
process.exitCode = resultado.aprovado ? 0 : 1;
