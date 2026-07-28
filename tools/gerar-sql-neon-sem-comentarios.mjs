import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [arquivoOrigem, arquivoDestino] = process.argv.slice(2);

if (!arquivoOrigem || !arquivoDestino) {
    console.error(
        'Uso: node tools/gerar-sql-neon-sem-comentarios.mjs <origem.sql> <destino.sql>'
    );
    process.exit(1);
}

const origem = resolve(arquivoOrigem);
const destino = resolve(arquivoDestino);
const conteudo = await readFile(origem, 'utf8');

const sqlLimpo = conteudo
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((linha) => !/^\s*--/.test(linha))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .concat('\n');

const marcadoresProibidos = ['--', '/*', '*/'];
const marcadorEncontrado = marcadoresProibidos.find((marcador) =>
    sqlLimpo.includes(marcador)
);

if (marcadorEncontrado) {
    console.error(
        `Falha: o SQL gerado ainda contém o marcador de comentário ${marcadorEncontrado}.`
    );
    process.exit(1);
}

await writeFile(destino, sqlLimpo, { encoding: 'utf8' });

console.log(`SQL sem comentários gerado em ${destino}`);
