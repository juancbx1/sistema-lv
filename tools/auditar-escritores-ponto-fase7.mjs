import fs from 'node:fs';
import path from 'node:path';

const raizApi = path.resolve('api');
const arquivos = fs
    .readdirSync(raizApi)
    .filter((nome) => nome.endsWith('.js'))
    .map((nome) => path.join(raizApi, nome));

const camposOperacionais =
    '(?:status_atual|status_data_modificacao|id_sessao_trabalho_atual)';
const padraoTabelaOperacional = /\b(ponto_diario|sessoes_trabalho_producao)\b/i;
const padraoEscritaOperacional =
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(ponto_diario|sessoes_trabalho_producao)\b/i;

function linhaDo(codigo, indice) {
    return codigo.slice(0, indice).split(/\r?\n/).length;
}

function resumir(codigo, indice) {
    const inicio = codigo.lastIndexOf('\n', indice) + 1;
    const fimEncontrado = codigo.indexOf('\n', indice);
    const fim = fimEncontrado === -1 ? codigo.length : fimEncontrado;
    return {
        linha: linhaDo(codigo, indice),
        trecho: codigo.slice(inicio, fim).trim().slice(0, 180),
    };
}

function templatesSql(codigo) {
    const templates = [];
    const padrao = /`([\s\S]*?)`/g;
    let match;
    while ((match = padrao.exec(codigo)) !== null) {
        if (/\b(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(match[1])) {
            templates.push({ sql: match[1], indice: match.index });
        }
    }
    return templates;
}

function detectarStatusGlobal(codigo, templates) {
    const achados = [];
    const aliasGlobal = new RegExp(`\\bu\\.${camposOperacionais}\\b`, 'gi');
    let match;
    while ((match = aliasGlobal.exec(codigo)) !== null) {
        achados.push(resumir(codigo, match.index));
    }

    for (const template of templates) {
        const escritaGlobal = /\b(?:UPDATE|INSERT\s+INTO)\s+usuarios(?!_empresas)\b/gi;
        let escritaMatch;
        while ((escritaMatch = escritaGlobal.exec(template.sql)) !== null) {
            const restante = template.sql.slice(escritaMatch.index);
            const limiteWhere = restante.search(/\bWHERE\b/i);
            const cabecalhoEscrita =
                limiteWhere === -1 ? restante : restante.slice(0, limiteWhere);
            if (new RegExp(`\\b${camposOperacionais}\\b`, 'i').test(cabecalhoEscrita)) {
                achados.push(resumir(codigo, template.indice + escritaMatch.index));
            }
        }
    }
    return achados;
}

const resultados = [];
for (const arquivo of arquivos) {
    const codigo = fs.readFileSync(arquivo, 'utf8');
    const templates = templatesSql(codigo);
    const sqlOperacional = templates.filter(({ sql }) => padraoTabelaOperacional.test(sql));
    const escritas = sqlOperacional.filter(({ sql }) => padraoEscritaOperacional.test(sql));
    const semEmpresa = sqlOperacional.filter(({ sql }) => !/\bempresa_id\b/i.test(sql));
    const statusGlobal = detectarStatusGlobal(codigo, templates);

    if (sqlOperacional.length === 0 && statusGlobal.length === 0) continue;

    resultados.push({
        arquivo: path.relative(process.cwd(), arquivo).replaceAll('\\', '/'),
        consultas_operacionais: sqlOperacional.length,
        escritas_operacionais: escritas.length,
        consultas_sem_empresa_id: semEmpresa.map(({ indice }) => resumir(codigo, indice)),
        referencias_status_global: statusGlobal,
        usa_req_empresa_id: /\breq\.empresaId\b/.test(codigo),
        usa_empresa_id_local: /\bempresaId\b/.test(codigo),
        usa_usuarios_empresas: /\busuarios_empresas\b/.test(codigo),
    });
}

const falhas = resultados.filter(
    (item) =>
        item.consultas_sem_empresa_id.length > 0
        || item.referencias_status_global.length > 0
        || (!item.usa_req_empresa_id && !item.usa_empresa_id_local)
);
const aprovado = falhas.length === 0;

process.stdout.write(
    `${JSON.stringify(
        {
            aprovado,
            motivo: aprovado
                ? 'Todas as consultas de ponto/sessão carregam empresa_id e não há acesso SQL ao estado operacional global.'
                : 'Ainda existem consultas operacionais sem empresa_id ou acesso SQL ao estado operacional global.',
            total_arquivos_relacionados: resultados.length,
            total_falhas: falhas.length,
            arquivos_com_falha: falhas.map((item) => item.arquivo),
            resultados,
        },
        null,
        2
    )}\n`
);

if (!aprovado) process.exitCode = 1;
